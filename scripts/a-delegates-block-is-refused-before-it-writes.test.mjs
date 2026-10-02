// A DELEGATE'S BLOCK IS REFUSED BEFORE IT WRITES — AND AN OWNER'S WAITS FOR ITS WRITE (sim finding 28).
//   Run: node --test scripts/a-delegates-block-is-refused-before-it-writes.test.mjs
//
// THE DEFECT. The relay refuses a delegated steward's blocklist (it is the church key's alone), yet a delegate's Block
// ran on regardless: the person greyed out, the console wrote them into its OWN remembered blocklist (left out of every
// key list it built, kept across reloads) while the church had blocked nobody, and the only words shown said "removed
// from the roster". block() also dropped setBlocked's promise and rotated whatever the relay answered.
//
// THE FIX. block() (app/stew-dashboard.jsx, DashMembers) refuses a delegate up front, before anything is written or
// remembered; an owner's Block waits for the write, reads the answer, and says what happened. setBlocked itself also
// refuses (false) when acting for another church, before it touches the remembered list.
//
// Rule 1: the REAL DashMembers is rendered and its real "Remove / block" and "Confirm" controls pressed. Rule 3:
// nothing here matches text in app/*.jsx.
//
// Users of the shared code (rule 2): block() is reached from the desktop member row's confirm button and the phone
// sheet's `memberActions` (both call the same block). setBlocked callers: block(), unblock (DashMembers) and
// reseatMember (steward.src.js); the engine guard changes only a delegated console's answer, and that is the refusal the
// relay already gave (reseatMember turns a falsy answer into its own message — covered by the existing reseat tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled, membersGlobals, press, reads } from './dash-render-kit.mjs';

const CHURCH = 'c'.repeat(64);
const MEMBER = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const NOW = Math.floor(Date.now() / 1000);   // recent, or the page files them under 'inactive' and hides the row
const members = [
  { pubkey: MEMBER, npub: 'npub1aa', name: 'Bram Whitlock', count: 2, lastTs: NOW - 3600, joined: NOW - 86400 },
  { pubkey: OTHER, npub: 'npub1bb', name: 'Cleo Ashby', count: 1, lastTs: NOW - 3600, joined: NOW - 86400 },
];

function rig({ delegated = false, setBlocked } = {}) {
  const calls = { setBlocked: [], rotate: [], order: [] };
  const fired = [];
  const steward = {
    actingChurch: delegated ? CHURCH : '',
    setBlocked: (l, o) => { calls.setBlocked.push(l); calls.order.push('setBlocked'); return setBlocked ? setBlocked() : Promise.resolve(true); },
    rotateCareKey: () => { calls.rotate.push('care'); calls.order.push('rotate'); return Promise.resolve(true); },
    rotateMediaKey: () => { calls.rotate.push('media'); return Promise.resolve(true); },
    ensureNameKeyForMembers: () => { calls.rotate.push('name'); return Promise.resolve({ rotated: true }); },
    publishGroupKey: () => { calls.rotate.push('group'); return Promise.resolve({}); },
    publishGroup: () => Promise.resolve(true),
  };
  const g = membersGlobals({ steward, members, groups: [{ id: 'g', name: 'All', encrypted: true, visibility: 'open' }],
    extraWindow: { dispatchEvent: (e) => { fired.push(e); return true; } } });
  return { calls, fired, g };
}

async function blockBram(r) {
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys']);
  let tree = draw(C, {});
  await press(tree, /Remove \/ block this member/, { which: 0 });
  tree = draw(C, {});
  await press(tree, /Confirm — bans them/);
  tree = draw(C, {});
  return { said: reads(tree), draw: () => draw(C, {}) };
}

test('a DELEGATE’s Block is refused up front: nothing written, nothing rotated, and the screen says why', async () => {
  const r = rig({ delegated: true });
  const p = await blockBram(r);
  assert.equal(r.calls.setBlocked.length, 0, 'A DELEGATE’S BLOCK REACHED setBlocked — the console would remember the person as blocked while the church blocked nobody');
  assert.equal(r.calls.rotate.length, 0, 'a refused delegate Block still rotated keys');
  assert.match(p.said, /Only the church owner can block someone\. Nothing was changed — ask them to block Bram Whitlock from their own console\./,
    'the delegate is not told it was refused: ' + p.said.slice(0, 400));
  assert.doesNotMatch(p.said, /Removed them|removed from the roster/, 'the screen says someone was removed: ' + p.said.slice(0, 400));
  assert.equal(r.fired.filter(e => e.type === 'steward-write-blocked').length, 0, 'the old "removed from the roster" event is back');
});

test('an OWNER’s Block rotates only AFTER the blocklist write has landed', async () => {
  let land;
  const r = rig({ setBlocked: () => new Promise(res => { land = res; }) });
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys']);
  let tree = draw(C, {});
  await press(tree, /Remove \/ block this member/);
  tree = draw(C, {});
  await press(tree, /Confirm — bans them/);
  assert.equal(r.calls.setBlocked.length, 1, 'CONTROL: Block did not write the blocklist');
  assert.equal(r.calls.rotate.length, 0, 'KEYS WERE ROTATED BEFORE THE BLOCKLIST WRITE ANSWERED — rotating for a block that may never land');
  land(true);
  for (let i = 0; i < 8; i++) await new Promise(res => setImmediate(res));
  assert.deepEqual(r.calls.rotate.sort(), ['care', 'group', 'media', 'name'], 'a landed Block did not rotate the care, sermon and name keys and the encrypted room');
  assert.ok(r.calls.order.indexOf('setBlocked') < r.calls.order.indexOf('rotate'), 'rotation did not follow the write');
});

test('an OWNER whose write every relay refused is not told they were removed, and is told it may be only partly saved', async () => {
  const r = rig({ setBlocked: () => Promise.resolve(false) });
  const p = await blockBram(r);
  assert.match(p.said, /Couldn’t save the block on every relay, so Bram Whitlock may not be blocked everywhere yet/, 'a refused write said nothing: ' + p.said.slice(0, 400));
  assert.doesNotMatch(p.said, /Removed them from the church/, 'a refused write is reported as a removal: ' + p.said.slice(0, 400));
  // the safe direction: the console holds them as blocked, so the keys are still taken away from them
  assert.deepEqual(r.calls.rotate.sort(), ['care', 'group', 'media', 'name'], 'a partly-saved Block left the keys with the person');
});

test('an OWNER whose console cannot sign (null) changes nothing and says so', async () => {
  const r = rig({ setBlocked: () => Promise.resolve(null) });
  const p = await blockBram(r);
  assert.equal(r.calls.rotate.length, 0, 'keys were rotated for a Block that wrote nothing');
  assert.match(p.said, /Couldn’t block Bram Whitlock — this console isn’t signed in to your church, so nothing was changed/, 'nothing said: ' + p.said.slice(0, 400));
});

test('CONTROL: an OWNER whose write landed and every key rotated sees no warning', async () => {
  const r = rig();
  const p = await blockBram(r);
  assert.doesNotMatch(p.said, /Couldn’t|could not change|Only the church owner/, 'a clean Block raised a warning: ' + p.said.slice(0, 400));
});
