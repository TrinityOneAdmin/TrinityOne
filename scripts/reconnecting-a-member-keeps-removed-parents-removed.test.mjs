// RECONNECTING A MEMBER KEEPS REMOVED AND DECLINED PARENTS OFF THE CONFIRM LIST.
//   Run: node --test scripts/reconnecting-a-member-keeps-removed-parents-removed.test.mjs
//
// Audit of a00d265, F2. "Reconnect" (a member on a new phone) moves everything attached to their seat to the new
// key, parent links included. The engine (reseatMember) carries the guardian document's `closed` pairs across —
// but only when handed them, and the dialog never handed them. So it saved the document with `closed` empty,
// and every declined or removed parent came back as a "Confirm" card, one tap from being linked again.
//
// HOW IT ASSERTS. The dialog's own statements (ReseatModal in app/stew-dashboard.jsx, sliced from inside that
// function and run) build the real argument object; the SHIPPED reseatMember (vendor/steward.js) runs with it;
// what it saves is fed through the shipped pendingReqs filter, as the console's own echo would be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt, stripComments } from './test-slice.mjs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const P = 'a1'.repeat(32), P2 = 'a2'.repeat(32), C = 'c1'.repeat(32), R = 'b1'.repeat(32);

function sliceIn(src, anchor, what) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${what} is missing — re-anchor this test`);
  assert.equal(src.indexOf(anchor, at + 1), -1, `${what} appears twice`);
  return stmt(src, anchor);
}
const MODAL = fnBody(DASH, 'function ReseatModal(', 'ReseatModal');
const DIALOG = [
  sliceIn(MODAL, 'const _gdCheckin = window.useStewardGuardians', 'the dialog reading the guardian document'),
  sliceIn(MODAL, 'const guardiansNow = ', 'guardiansNow'),
  ...(MODAL.includes('const guardiansClosedNow = ') ? [sliceIn(MODAL, 'const guardiansClosedNow = ', 'guardiansClosedNow')] : []),
  sliceIn(MODAL, 'const r = await window.Steward.reseatMember(member, newPub, {', "the dialog's reseatMember call"),
].join('\n');
const RESEAT = (() => { const a = '    async reseatMember(oldPub, newPub, o) {'; const at = STEWARD.indexOf(a); assert.notEqual(at, -1, 'reseatMember is missing from vendor/steward.js'); return fnBody(STEWARD, at, 'reseatMember'); })();
const PENDING = (() => { const src = stripComments(DASH); const at = src.indexOf('const pendingReqs = guardReqs.filter('); assert.notEqual(at, -1); return new Function('guardReqs', 'guardians', 'guardiansClosed', src.slice(at, src.indexOf(';', at) + 1) + '\nreturn pendingReqs;'); })();

async function reconnect(guardianDoc) {
  const saved = [];
  const Steward = new Proxy({}, { get: (t, k) => k in t ? t[k] : (async () => true) });
  Steward.setGuardians = async (links, closed) => { saved.push({ links, closed }); return true; };
  const engine = new Function('toPubHex', 'now', 'window', `return { ${RESEAT} };`)((p) => p, () => 1000, { Steward });
  Steward.reseatMember = (...a) => engine.reseatMember(...a);
  const window = { Steward, useStewardGuardians: () => guardianDoc };
  await new Function('window', 'member', 'newPub', 'realName', 'reseats', 'admittedList', 'sgNow', 'blockedNow', 'taken',
    `return (async () => { ${DIALOG}\n return r; })();`)(window, P, P2, '', [], [P, C], { minors: [C], approved: [] }, [], false);
  return saved.at(-1);
}

test('CONTROL: before the reconnect, the removed parent is not on the Confirm list', () => {
  const pending = PENDING([{ child: C, parent: R }], { [C]: [P] }, { [C + '|' + R]: 900 });
  assert.equal(pending.length, 0);
});

test('reconnecting a linked parent keeps a removed parent off the Confirm list', async () => {
  const saved = await reconnect({ links: { [C]: [P] }, closed: { [C + '|' + R]: 900 } });
  assert.ok(saved, 'CONTROL: the reconnect saved the guardian document (P is a linked parent)');
  assert.ok((saved.links[C] || []).includes(P2), 'CONTROL: the link moved to the new key');
  const pending = PENDING([{ child: C, parent: R }], saved.links, saved.closed);
  assert.equal(pending.length, 0, 'reconnecting a member wiped the removal record: the removed parent is back as a Confirm card');
});
