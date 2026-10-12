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
  const timers = [];
  const lists = { members: [], groups: [], stewards: [], blocked: [] };
  // the rooms' key envelopes as the engine last saw them, per church: env[church][roomId] = recipients. absent = no
  // ring held (the engine's groupKeyRecipients answers null). Set by the tests.
  const env = {};
  const churchNow = () => g.window.Steward.actingChurch || g.window.Steward.churchPub;
  const approval = { on: false, admitted: [], loaded: { subscribeJoinPolicy: true, subscribeAdmitted: true, subscribeBlocked: true } };
  const record = (name) => (...a) => { calls.push({ name, members: (a[0] || []).slice(), second: a[1] }); return Promise.resolve(null); };
  const g = {
    React, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},   // the mount re-check timers, fired by hand
    window: {
      Steward: {
        listIsCurrent: (l) => !!l && current.has(l),
        subscribeMediaKey: () => () => {}, subscribeCareKey: () => () => {}, subscribeNameKey: () => () => {},
        subscribeWebsiteShare: () => () => {}, setCareRoster: () => {},
        ensureMediaKeyForMembers: record('media'), ensureCareKeyForMembers: record('care'), ensureNameKeyForMembers: record('name'),
        ensureGroupKeys: record('groups'),
        publishGroupKey: (gid, recips, opts) => { calls.push({ name: 'groupkey', gid, members: (recips || []).slice(), opts }); return Promise.resolve(null); },
        groupKeyRecipients: (gid) => { const e = (env[churchNow()] || {})[gid]; return e ? e.slice() : null; },
        groupKeyMissing: (gid, pubs) => { const e = (env[churchNow()] || {})[gid]; return e ? (pubs || []).filter(p => !e.includes(p)) : null; },
        actingChurch: '', activePub: 'a'.repeat(64), churchPub: 'a'.repeat(64),
      },
      useStewardJoinPolicy: () => approval.on, useStewardAdmitted: () => approval.admitted,
      stewardStreamLoaded: (m) => !!approval.loaded[m],
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
  return { set, render, calls, timers, steward: g.window.Steward, env, approval };
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

// THE KEY DISTRIBUTOR'S MEMORY IS PER CHURCH (audit of 5276297, HIGH 1). It used to remember the recipients it last
// keyed each room to, and that memo survived a church switch. Since 2026-10-12 it keeps no such memo: it reconciles
// every room against the room's OWN newest envelope (Steward.groupKeyRecipients), which is per room and so per church.
// These rows keep the three switch scenarios the memo was guarding, against that envelope.
const A = 'a'.repeat(64), BCH = 'e'.repeat(64);
test('a room whose envelope already holds everyone is not re-keyed — in this church or after a switch', async () => {
  const k = await keyDistributor();
  const room = { id: 'room-x', name: 'Sealed', encrypted: true };
  k.env[A] = { 'room-x': [A, MB] };
  k.env[BCH] = { 'room-x': [BCH, MB2] };
  k.set('members', [{ pubkey: MB }], true); k.set('groups', [room], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();
  assert.equal(k.calls.filter(c => c.name === 'groupkey').length, 0, 'CONTROL: a room whose envelope already holds every member was re-keyed');
  k.steward.actingChurch = BCH;                   // the console switches church; the same room id is on the list it sees
  k.set('members', [{ pubkey: MB2 }], true); k.set('groups', [{ ...room }], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();
  const keyed = k.calls.filter(c => c.name === 'groupkey');
  assert.deepEqual(keyed, [], 'THE ROOM\'S KEY WAS RE-PUBLISHED after a switch although its envelope already holds every member: ' + JSON.stringify(keyed));
  // CONTROL: in one church, a member the envelope lacks IS keyed
  k.set('members', [{ pubkey: MB2 }, { pubkey: MB }], true); k.set('groups', [{ ...room }], true);
  k.render();
  assert.equal(k.calls.filter(c => c.name === 'groupkey').length, 1, 'CONTROL: a member the room\'s envelope lacks was not keyed');
});
// …a member who joined A while the console was elsewhere is keyed on the way back (audit of 831dcea). (The browser row:
// a-member-who-joined-while-the-console-was-away-gets-the-room-key.)
test('a member who joined church A while the console was on church B is given A\'s room key when it comes back to A', async () => {
  const k = await keyDistributor();
  const room = { id: 'room-a', name: 'Sealed', encrypted: true };
  k.env[A] = { 'room-a': [A, MB] };
  k.set('members', [{ pubkey: MB }], true); k.set('groups', [room], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();                                     // church A: the room, keyed to MB
  k.steward.actingChurch = BCH;                   // the console acts for church B
  k.set('members', [{ pubkey: ST }], true); k.set('groups', [], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();
  assert.equal(k.calls.filter(c => c.name === 'groupkey').length, 0, 'CONTROL: a room key was published before anyone joined');
  k.steward.actingChurch = '';                    // back to A — where MB2 joined while the console was away
  k.set('members', [{ pubkey: MB }, { pubkey: MB2 }], true); k.set('groups', [{ ...room }], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();
  const keyed = k.calls.filter(c => c.name === 'groupkey');
  assert.equal(keyed.length, 1, 'A MEMBER WHO JOINED CHURCH A WHILE THE CONSOLE WAS ON B WAS NEVER GIVEN A\'S ROOM KEY (audit of 831dcea)');
});
// …and a room-key publish that answers after a switch settles ITS church's memo, not the one the console is on now:
// written into B's, A's "in flight" mark would stay set and A's room would never be re-keyed again.
test('a room-key publish that answers after a switch is recorded for the church it was made for', async () => {
  const k = await keyDistributor();
  const room = { id: 'room-a', name: 'Sealed', encrypted: true };
  k.env[A] = { 'room-a': [A, MB] };
  let answer; const inFlight = new Promise(r => { answer = r; });
  k.steward.publishGroupKey = () => { k.calls.push({ name: 'groupkey' }); return inFlight; };
  k.set('members', [{ pubkey: MB }], true); k.set('groups', [room], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();                                     // A: everyone keyed
  k.set('members', [{ pubkey: MB }, { pubkey: MB2 }], true); k.render();   // A grows: the publish starts…
  assert.equal(k.calls.filter(c => c.name === 'groupkey').length, 1, 'CONTROL: the grown room was not re-keyed');
  k.steward.actingChurch = BCH;                   // …the console switches to B before it answers
  k.set('members', [{ pubkey: ST }], true); k.set('groups', [], true); k.render();
  k.env[A]['room-a'] = [A, MB, MB2];              // what the engine records when the publish lands
  answer({ ok: true }); await new Promise(r => setTimeout(r, 0));   // …and it answers, keyed
  k.steward.actingChurch = '';                    // back on A, a third member joins
  k.set('members', [{ pubkey: MB }, { pubkey: MB2 }, { pubkey: ST }], true); k.set('groups', [{ ...room }], true); k.render();
  assert.equal(k.calls.filter(c => c.name === 'groupkey').length, 2, 'THE PUBLISH THAT ANSWERED ON B LEFT A\'S ROOM MARKED "IN FLIGHT" — nobody who joins A is given its key again');
});

// ── 2026-10-12: RECONCILE, NOT "FIRST SIGHTING = ALREADY KEYED" ─────────────────────────────────────────────────────
// A console that had never seen the room before — a new device, a reinstall, cleared data, a delegate — recorded the
// members it first saw as already keyed. A member who joined while no console was open was among them and never got
// the key. The FIRST render must already key whoever the room's envelope lacks, and must keep everyone it holds.
test('the FIRST render keys a member the room\'s envelope lacks, and an open room never drops anyone it already holds', async () => {
  const k = await keyDistributor();
  const OLD = '9'.repeat(64);                     // in the envelope, not (yet) in the streamed member list
  k.env[A] = { 'room-o': [A, MB, OLD] };
  k.set('members', [{ pubkey: MB }, { pubkey: MB2 }], true);
  k.set('groups', [{ id: 'room-o', name: 'Prayer', encrypted: true }], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();
  const keyed = k.calls.filter(c => c.name === 'groupkey');
  assert.equal(keyed.length, 1, 'A MEMBER WHO JOINED WHILE NO CONSOLE WAS OPEN WAS COUNTED AS KEYED ON FIRST SIGHT and never given the room key');
  assert.ok(keyed[0].members.includes(MB2), 'the member the envelope lacks is not among the recipients: ' + JSON.stringify(keyed[0].members));
  assert.ok(keyed[0].members.includes(OLD), 'AN OPEN ROOM DROPPED SOMEBODY IT ALREADY HELD — the member list streams in pieces and the phone deletes its key when an envelope leaves it out');
  assert.equal(keyed[0].opts && keyed[0].opts.reuseOnly, true, 'the background re-key must never mint');
  // an INVITE room is keyed to its own list, not a union — a union would re-add somebody just taken out
  const k2 = await keyDistributor();
  k2.env[A] = { 'room-i': [A, MB, OLD] };
  k2.set('members', [{ pubkey: MB }, { pubkey: MB2 }], true);
  k2.set('groups', [{ id: 'room-i', name: 'Leaders', encrypted: true, visibility: 'invite', members: [MB, MB2] }], true); k2.set('stewards', [ST], true); k2.set('blocked', [], true);
  k2.render();
  const ik = k2.calls.filter(c => c.name === 'groupkey');
  assert.equal(ik.length, 1, 'CONTROL: an invite member the envelope lacks was not keyed');
  assert.deepEqual([...ik[0].members].sort(), [MB, MB2].sort(), 'an invite room was keyed to something other than its own list');
  // nobody missing → nothing published (it must not loop)
  const k3 = await keyDistributor();
  k3.env[A] = { 'room-o': [A, MB] };
  k3.set('members', [{ pubkey: MB }], true); k3.set('groups', [{ id: 'room-o', encrypted: true }], true); k3.set('stewards', [ST], true); k3.set('blocked', [], true);
  k3.render(); k3.render();
  assert.equal(k3.calls.filter(c => c.name === 'groupkey').length, 0, 'a room whose envelope holds everyone was re-published');
});

// A MEMBER AWAITING APPROVAL is not a member: the relay already says so (gateway.mjs rebuildMembers). The open-room, care
// and sermon keys — and the healer that mints a missing room key — go to APPROVED members only; the NAME key still
// reaches them (they seal their name for the approval queue).
test('with approval on, a member awaiting approval gets no open-room, care, sermon or healer key — but does get the name key', async () => {
  const k = await keyDistributor();
  k.approval.on = true; k.approval.admitted = [MB];   // MB admitted, MB2 waiting
  k.env[A] = { 'room-o': [A] };
  k.set('members', [{ pubkey: MB }, { pubkey: MB2 }], true);
  k.set('groups', [{ id: 'room-o', name: 'Prayer', encrypted: true }], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();
  for (const name of ['care', 'media']) {
    const c = k.calls.filter(x => x.name === name);
    assert.ok(c.length >= 1, `CONTROL: the ${name} enrolment did not run`);
    for (const x of c) assert.deepEqual(x.members, [MB], `THE ${name.toUpperCase()} KEY WAS OFFERED TO A MEMBER STILL WAITING FOR APPROVAL`);
  }
  const heal = k.calls.filter(x => x.name === 'groups');
  assert.ok(heal.length >= 1, 'CONTROL: the healer (ensureGroupKeys) did not run');
  for (const x of heal) assert.deepEqual(x.second, [MB], 'THE HEALER WOULD MINT A ROOM KEY FOR A MEMBER STILL WAITING FOR APPROVAL');
  const gk = k.calls.filter(c => c.name === 'groupkey');
  assert.equal(gk.length, 1, 'CONTROL: the admitted member was not keyed to the open room');
  assert.ok(!gk[0].members.includes(MB2), 'THE OPEN ROOM\'S KEY WAS WRAPPED TO A MEMBER STILL WAITING FOR APPROVAL');
  const nm = k.calls.filter(c => c.name === 'name');
  assert.ok(nm.length && nm.every(c => c.members.includes(MB2)), 'the NAME key must still reach a pending member — they seal their name for the approval queue');
  // approving them keys them at once
  await new Promise(r => setTimeout(r, 0));     // the first publish answers (in-flight guard clears)
  k.approval.admitted = [MB, MB2]; k.env[A]['room-o'] = [A, MB];
  k.render();
  const after = k.calls.filter(c => c.name === 'groupkey');
  assert.equal(after.length, 2, 'APPROVING A MEMBER DID NOT KEY THEM — the enrolment does not re-run on the admitted list');
  assert.ok(after[1].members.includes(MB2), 'the newly approved member is not among the recipients');
  const care = k.calls.filter(c => c.name === 'care');
  assert.deepEqual([...care[care.length - 1].members].sort(), [MB, MB2].sort(), 'the newly approved member was not offered the care key');
});
test('with approval on, nobody new is keyed until the admitted and blocked lists have arrived (fail closed)', async () => {
  const k = await keyDistributor();
  k.approval.on = true; k.approval.admitted = []; k.approval.loaded.subscribeAdmitted = false;
  k.env[A] = { 'room-o': [A] };
  k.set('members', [{ pubkey: MB }], true);
  k.set('groups', [{ id: 'room-o', name: 'Prayer', encrypted: true }], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();
  for (const t of k.timers.splice(0)) t.fn();
  for (const name of ['care', 'media', 'groups', 'groupkey'])
    assert.deepEqual(k.calls.filter(c => c.name === name), [], `the ${name} key was handed out before the admitted list had arrived`);
  assert.ok(k.calls.some(c => c.name === 'name'), 'CONTROL: the name key enrolment must not wait on the approval lists');
  // the policy itself not yet known counts the same — "approval off" must not be read from "not arrived"
  const k2 = await keyDistributor();
  k2.approval.loaded.subscribeJoinPolicy = false;
  k2.env[A] = { 'room-o': [A] };
  k2.set('members', [{ pubkey: MB }], true);
  k2.set('groups', [{ id: 'room-o', encrypted: true }], true); k2.set('stewards', [ST], true); k2.set('blocked', [], true);
  k2.render();
  for (const name of ['care', 'media', 'groupkey'])
    assert.deepEqual(k2.calls.filter(c => c.name === name), [], `the ${name} key was handed out before the join policy had arrived`);
  // CONTROL: approval off and known → everyone not blocked
  k2.approval.loaded.subscribeJoinPolicy = true; k2.set('members', [{ pubkey: MB }], true); k2.render();
  assert.ok(k2.calls.some(c => c.name === 'groupkey' && c.members.includes(MB)), 'CONTROL: with approval off the member was not keyed');
});

// THE MOUNT RE-CHECK TIMERS (3.5 s and 9 s) go through the same two rules as the effect (audits of 3bc8905 and 5276297:
// with either rule deleted from them, no test failed). They call ensureMediaKeyForMembers on their own.
test('the mount re-check timers do nothing while a list is not the current church\'s', async () => {
  const k = await keyDistributor();
  k.set('members', [{ pubkey: MB }], false); k.set('groups', [], true); k.set('stewards', [ST], true); k.set('blocked', [], true);
  k.render();
  assert.ok(k.timers.length >= 2, 're-anchor: the distributor no longer re-checks on mount');
  for (const t of k.timers.splice(0)) t.fn();
  assert.deepEqual(k.calls.filter(c => c.name === 'media'), [], 'A RE-CHECK TIMER WRAPPED THE SERMON KEY with a member list from another church');
});
test('…and when they do run, they leave out the members the church has blocked', async () => {
  const k = await keyDistributor();
  k.set('members', [{ pubkey: MB }, { pubkey: MB2 }], true); k.set('groups', [], true); k.set('stewards', [ST], true); k.set('blocked', [MB2], true);
  k.render();
  const before = k.calls.length;
  for (const t of k.timers.splice(0)) t.fn();
  const fromTimers = k.calls.slice(before).filter(c => c.name === 'media');
  assert.ok(fromTimers.length >= 1, 'CONTROL: the re-check timers did not run the sermon-key check');
  for (const c of fromTimers) assert.deepEqual(c.members, [MB], 'A RE-CHECK TIMER OFFERED THE SERMON KEY TO A MEMBER THE CHURCH HAS BLOCKED');
});

// THE MEMBER LIST FOLLOWS A KEY RESTORE (8aa8fc1's useStewardMembers change: no test failed with it removed). The
// enrolment uses the list only while it is stamped with the current church, so a stream that never re-opened for the
// restored church would leave nobody enrolled until a reload.
test('useStewardMembers re-subscribes when the church changes without a switch (a key restore)', () => {
  const ROOTJ = readFileSync(join(ROOT, 'app/steward-root.jsx'), 'utf8');
  const { React, draw } = miniReact();
  let subs = 0;
  const window = { Steward: { churchPub: 'a'.repeat(64), actingChurch: '', subscribeMembers: () => { subs++; return () => {}; } } };
  const useStewardMembers = new Function('useStewardIdv', 'useStewardConn', 'useSt', 'useStE', 'localStorage', 'window',
    fnBody(ROOTJ, 'function useStewardMembers() {', 'useStewardMembers') + '\nreturn useStewardMembers;')(
    () => 0, () => 0, React.useState, React.useEffect, { getItem: () => null }, window);
  const C = () => { useStewardMembers(); return null; };
  draw(C, {});
  assert.equal(subs, 1, 'CONTROL: the member list did not subscribe');
  draw(C, {});
  assert.equal(subs, 1, 'CONTROL: it re-subscribed with nothing changed');
  window.Steward.churchPub = 'c'.repeat(64);       // a key restore: the church changes, no switch event
  draw(C, {});
  assert.equal(subs, 2, 'THE MEMBER LIST STAYED ON THE OLD CHURCH after a key restore — nobody would be enrolled until a reload');
});
