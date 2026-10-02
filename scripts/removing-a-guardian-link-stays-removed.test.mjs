// A REMOVED PARENT LINK STAYS REMOVED — IT DOES NOT COME BACK AS A "CONFIRM" CARD.
//   Run: node --test scripts/removing-a-guardian-link-stays-removed.test.mjs
//
// Audit 2026-09-27, item 6 (the core defect, left open by 15a4bec; confirmed in the code 2026-09-30). The
// console's Confirm list shows any parent request that is neither linked nor in the `closed` map, and the
// parent's original request document stays on the relay. Decline writes `closed`; removing a link did not. So
// "Remove" put the parent's request straight back on screen as a fresh Confirm card — one tap from re-linking
// the adult the steward had just removed. Marking a linked parent as a child removes their links the same way.
//
// CLAUDE.md rules 1 + 3: unlinkParent and toggleMinor are compiled from the SHIPPED app/stew-dashboard.jsx and
// called; what they hand to setGuardians is then fed through the shipped pendingReqs filter, exactly as the
// console's own subscription echo would. Same technique as declining-a-guardian-request-hides-it.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody, stripComments } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const CHILD = 'cc'.padEnd(64, '0'), PARENT = 'aa'.padEnd(64, '0'), OTHER = 'bb'.padEnd(64, '0');

function pendingFilter() {
  const src = stripComments(STEW);
  const at = src.indexOf('const pendingReqs = guardReqs.filter(');
  assert.notEqual(at, -1, 're-anchor: the pendingReqs filter is gone from stew-dashboard.jsx');
  return new Function('guardReqs', 'guardians', 'guardiansClosed', src.slice(at, src.indexOf(';', at) + 1) + '\nreturn pendingReqs;');
}

// Compile one `const name = async (...) => {…}` from the shipped console and bind it to the given globals.
async function load(anchor, name, globals) {
  const src = fnBody(STEW, anchor, name);
  const tmp = join(tmpdir(), 'gunlink-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__gunlink_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  return mod[name];
}

function consoleWorld(links, closed = {}) {
  const calls = [];
  const w = {
    Promise, Math, Object, Set, Date,
    window: { Steward: {
      setGuardians: (m, c) => { calls.push([m, c]); return Promise.resolve(true); },
      setMinors: () => Promise.resolve(true),
      setNoPhoto: () => Promise.resolve(true),
      notifyGuardianRemoved: (parent, child) => { calls.notified = (calls.notified || []).concat([[parent, child]]); },
      revokeCheckinPermission: () => Promise.resolve(true),
      setApproved: () => Promise.resolve(true),
    } },
    guardians: links, guardiansClosed: closed,
    setMinorNotice: () => {}, _reseal: () => {},
    sg: { minors: [], approved: [], nophoto: [] },
    minorsSet: new Set(), nophotoSet: new Set(), ckClearedSet: new Set(), kidPhotosAllowed: true,
    parentSet: new Set(Object.values(links).flat()),
    nameByPub: {},
  };
  return { w, calls };
}
const REQS = [{ child: CHILD, parent: PARENT }, { child: CHILD, parent: OTHER }];

test('CONTROL: a linked parent is not on the Confirm list; an unlinked, unclosed request is', () => {
  const pending = pendingFilter()(REQS, { [CHILD]: [PARENT] }, {});
  assert.deepEqual(pending.map(r => r.parent), [OTHER]);
});

test('removing a parent link does not bring their request back as a Confirm card', async () => {
  const { w, calls } = consoleWorld({ [CHILD]: [PARENT] });
  const unlinkParent = await load('const unlinkParent = async (childPub, parentPub) => {', 'unlinkParent', w);
  await unlinkParent(CHILD, PARENT);
  assert.equal(calls.length, 1, 'unlinkParent did not save the guardian document');
  const [links, closed] = calls[0];
  assert.deepEqual(links, {}, 'CONTROL: the link was removed');
  // The console reads back what it saved: this is the list the steward sees next.
  const pending = pendingFilter()(REQS, links, closed);
  assert.ok(!pending.some(r => r.parent === PARENT), 'the removed parent is back on the Confirm list, one tap from being re-linked');
  assert.ok(pending.some(r => r.parent === OTHER), 'CONTROL: an unrelated request is still shown');
  assert.deepEqual(calls.notified, [[PARENT, CHILD]], "the parent's app was not told the link is gone");
});

test('marking a linked parent as a child does not bring their request back as a Confirm card', async () => {
  // PARENT is linked to CHILD; the steward marks PARENT as a child (a child is never a guardian).
  const { w, calls } = consoleWorld({ [CHILD]: [PARENT] });
  const toggleMinor = await load('const toggleMinor = async (pk) => {', 'toggleMinor', w);
  await toggleMinor(PARENT);
  const g = calls.find(([links]) => !(links[CHILD] || []).includes(PARENT));
  assert.ok(g, 'marking the parent as a child did not remove their link');
  const pending = pendingFilter()(REQS, g[0], g[1]);
  assert.ok(!pending.some(r => r.parent === PARENT), "a parent marked as a child is back on the Confirm list as someone's guardian");
});
