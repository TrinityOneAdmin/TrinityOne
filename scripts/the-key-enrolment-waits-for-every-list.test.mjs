// THE KEY ENROLMENT WAITS UNTIL EVERY LIST IT USES IS THE CURRENT CHURCH'S — THE BLOCKED LIST INCLUDED.
//   Run: node --test scripts/the-key-enrolment-waits-for-every-list.test.mjs
//
// KeyDistributor (app/stew-dashboard.jsx) wraps the church's care, name and sermon keys to its members. The member,
// steward, group and blocked lists it reads come from four hooks that keep their last value until the new church's
// stream delivers — so after a switch, for a beat, it held another church's lists. The engine stamps every list
// with the church and epoch it was fetched for, and the enrolment runs only when all four are current
// (Steward.listIsCurrent). The audit of 3bc8905 named the BLOCKED list in particular: the engine's own blocklist
// is emptied on a switch and refilled only by a Block made on this console, so enrolling before the church's
// blocked list has arrived would wrap the keys to the very people the church blocked.
//
// The real KeyDistributor, compiled out of app/stew-dashboard.jsx and rendered with a small React (effects run);
// the engine is a recorder, and "current" is decided by which arrays the test has stamped. Rule 3: nothing here
// matches text in the jsx — the component runs and the calls it makes are counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const MB = 'b'.repeat(64), MB2 = 'c'.repeat(64), ST = 'd'.repeat(64);

async function keyDistributor() {
  const { React, draw } = miniReact();
  const src = fnBody(DASH, 'function KeyDistributor() {', 'KeyDistributor');
  const tmp = join(tmpdir(), 'kd-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { KeyDistributor };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const current = new WeakSet();
  const calls = [];
  const lists = { members: [], groups: [], stewards: [], blocked: [] };
  const record = (name) => (...a) => { calls.push({ name, members: (a[0] || []).slice() }); return Promise.resolve(null); };
  const g = {
    React, setTimeout: () => 0, clearTimeout: () => {},
    window: {
      Steward: {
        listIsCurrent: (l) => !!l && current.has(l),
        subscribeMediaKey: () => () => {}, subscribeCareKey: () => () => {}, subscribeNameKey: () => () => {},
        subscribeWebsiteShare: () => () => {}, setCareRoster: () => {},
        ensureMediaKeyForMembers: record('media'), ensureCareKeyForMembers: record('care'), ensureNameKeyForMembers: record('name'),
        ensureGroupKeys: record('groups'), publishGroupKey: record('groupkey'),
        actingChurch: '', activePub: 'a'.repeat(64), churchPub: 'a'.repeat(64),
      },
      useStewardChurch: () => ({ name: 'St Aidan' }),
      useStewardGroups: () => lists.groups, useStewardMembers: () => lists.members,
      useStewardStewards: () => lists.stewards, useStewardBlocked: () => lists.blocked,
      useStewardIdv: () => 0, useStewardConn: () => 0,
      addEventListener() {}, removeEventListener() {},
    },
  };
  const key = '__kd_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  delete globalThis[key];
  const set = (name, arr, isCurrent) => { if (isCurrent) current.add(arr); lists[name] = arr; };
  const render = () => draw(mod.KeyDistributor, {});
  return { set, render, calls, steward: g.window.Steward };
}
const enrolled = (calls) => calls.filter(c => c.name === 'care' || c.name === 'name' || c.name === 'media');

test('no enrolment while the BLOCKED list is still another church\'s — and once it arrives, the blocked are left out', async () => {
  const k = await keyDistributor();
  k.set('members', [{ pubkey: MB }, { pubkey: MB2 }], true);
  k.set('groups', [], true);
  k.set('stewards', [ST], true);
  k.set('blocked', [], false);                      // the blocked list on screen is not this church's yet
  k.render();
  assert.deepEqual(enrolled(k.calls), [], 'THE CHURCH\'S KEYS WERE WRAPPED BEFORE ITS BLOCKED LIST HAD ARRIVED — to the people it blocked, among others (audit of 3bc8905)');
  k.set('blocked', [MB2], true);                    // the church's own blocked list arrives
  k.render();
  const calls = enrolled(k.calls);
  assert.equal(calls.length, 3, 'CONTROL: once every list is current the care, name and sermon keys are enrolled: ' + JSON.stringify(calls.map(c => c.name)));
  for (const c of calls) assert.deepEqual(c.members, [MB], `the ${c.name} key was offered to a member the church has BLOCKED`);
});

test('no enrolment while the MEMBER list is another church\'s (the reload-into-B leak), nor the steward or group list', async () => {
  for (const stale of ['members', 'stewards', 'groups']) {
    const k = await keyDistributor();
    k.set('members', [{ pubkey: MB }], stale !== 'members');
    k.set('groups', [], stale !== 'groups');
    k.set('stewards', [ST], stale !== 'stewards');
    k.set('blocked', [], true);
    k.render();
    assert.deepEqual(enrolled(k.calls), [], `THE KEYS WERE ENROLLED WITH A ${stale.toUpperCase()} LIST FROM ANOTHER CHURCH`);
  }
});

// THE KEY DISTRIBUTOR'S MEMORY IS PER CHURCH (audit of 5276297, HIGH 1). Its `last` map — the recipients it last keyed
// each room to — survived a church switch, so a room id it had seen in one church was "already keyed" in the next,
// and that church's members looked like new recipients: it re-published the room's key to them.
test('a room the distributor saw in one church is a FIRST sighting in the next — no key is re-published to the new church\'s people', async () => {
  const k = await keyDistributor();
  const room = { id: 'room-x', name: 'Sealed', encrypted: true };
  k.set('members', [{ pubkey: MB }], true); k.set('groups', [room], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();                                     // church A: first sighting of the room, remembered
  assert.equal(k.calls.filter(c => c.name === 'groupkey').length, 0, 'CONTROL: a first sighting published a room key');
  k.steward.actingChurch = 'b'.repeat(64);        // the console switches church; the same room id is on the list it sees
  k.set('members', [{ pubkey: MB2 }], true); k.set('groups', [{ ...room }], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();
  const keyed = k.calls.filter(c => c.name === 'groupkey');
  assert.deepEqual(keyed, [], 'THE ROOM\'S KEY WAS RE-PUBLISHED TO THE NEXT CHURCH\'S MEMBERS because the distributor remembered it from the last church: ' + JSON.stringify(keyed));
  // CONTROL: in one church, a room whose members grew IS re-keyed — the memo still does its job
  k.set('members', [{ pubkey: MB2 }, { pubkey: MB }], true); k.set('groups', [{ ...room }], true);
  k.render();
  assert.equal(k.calls.filter(c => c.name === 'groupkey').length, 1, 'CONTROL: a room whose members grew in the same church was not re-keyed');
});
