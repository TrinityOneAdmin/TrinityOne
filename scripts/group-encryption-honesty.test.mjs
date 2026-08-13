// A ROOM MUST NOT PROMISE ENCRYPTION IT IS NOT ABOUT TO DELIVER.
// Run: node --test scripts/group-encryption-honesty.test.mjs
//
// THE DEFECT (owner's question, 2026-08-13: "is each pill accurate to whether or not encryption is on?").
// It was not, and could not be, because the label and the encryption were reading two different facts.
//
//   the label   read `group.encrypted` — the setting the STEWARD chose for the room
//   the send    read `_gkeys[...]`     — whether THIS member happens to hold the room's key
//
// Nothing tied them together, and the gap opens in the dangerous direction. A member who does not have the
// key — newly admitted with the envelope still in flight, skipped by the console's per-member sealing (it
// catches and continues past a pubkey it cannot seal to), or left behind by a rotation that failed silently
// — typed into a room captioned "End-to-end encrypted", and `if (gkey)` was simply false, so the words went
// to the relay in clear. The seal throwing did the same thing: caught, ignored, sent unencrypted.
//
// Note the asymmetry that hid it. Reading fails SAFE — a message you have no key for is not shown at all, so
// the room looks quiet. Writing failed OPEN. A member could not read the room they were publishing plaintext
// into, and nothing anywhere said so.
//
// Both now come from one place, fellowship.groupEncState():
//   'sealed' — a key is held, the next message WILL be encrypted
//   'nokey'  — the room is meant to be encrypted, no key here; the send is refused
//   'clear'  — an ordinary church room, the relay can read it
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// Drive the REAL groupEncState against a fake key map and a fake group cache.
function rig({ keyHeld = false, flagged = false } = {}) {
  const CP = 'ab'.repeat(32), GID = 'g-readings';
  const store = { ['trinityone.groups.' + CP]: JSON.stringify([{ id: GID, name: 'Readings', encrypted: flagged }]) };
  const scope = {
    window: { Fellowship: { churchPub: CP } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    _gkeys: keyHeld ? { [CP + '|' + GID]: [new Uint8Array(32)] } : {},
    _gkKey: (cp, gid) => cp + '|' + gid,
  };
  const body = stripComments(fnBody(SRC, 'function _groupDoc(gid)', '_groupDoc'))
    + '\nfunction loadDocCache(prefix, cp){ try { const a = JSON.parse(localStorage.getItem("trinityone." + prefix + "." + cp) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }\n'
    + 'const api = { ' + fnBody(SRC, '  groupEncState(groupId) {', 'groupEncState') + ' };';
  const names = Object.keys(scope);
  const api = new Function(...names, body + '\nreturn (id) => api.groupEncState(id);')(...names.map(n => scope[n]));
  return { state: api(GID) };
}

test('a key in hand means the label says encrypted', () => {
  assert.equal(rig({ keyHeld: true, flagged: true }).state, 'sealed');
});

test('a room meant to be encrypted, with no key here, does NOT claim to be encrypted', () => {
  assert.equal(rig({ keyHeld: false, flagged: true }).state, 'nokey',
    'THE BUG: the label came from the steward\'s setting, so it read "End-to-end encrypted" while this ' +
    'member had no key — and the send, which checks the key and not the setting, would have published their ' +
    'words in clear underneath it');
});

test('an ordinary church room says so', () => {
  assert.equal(rig({ keyHeld: false, flagged: false }).state, 'clear');
});

test('a key held in a room not marked encrypted still reports sealed, because that is what happens', () => {
  // A member keeps the key when a room is switched back to unencrypted, so their messages really are sealed.
  // The label follows the message, not the setting — claiming "Not encrypted" over ciphertext is the same
  // class of lie in the opposite direction, and it would teach members the label cannot be trusted.
  assert.equal(rig({ keyHeld: true, flagged: false }).state, 'sealed');
});

test('the send refuses rather than publishing in clear, and refuses BEFORE queueing', () => {
  const fn = stripComments(fnBody(SRC, 'async publishMessage(groupId, content, extraTags = [])', 'publishMessage'));
  assert.match(fn, /if \(wantsEnc && !gkey\) return \{ _refused: 'nokey' \};/,
    'a member without the room\'s key still publishes plaintext into a room that says it is encrypted');
  assert.match(fn, /if \(wantsEnc\) return \{ _refused: 'sealfailed' \};/,
    'the seal throwing is swallowed again, which sends the message unencrypted by a second route — the ' +
    'catch block was empty for exactly this reason and it looked deliberate');
  // ORDER MATTERS AND IS THE WHOLE POINT. Queue first, refuse second, and the outbox flush publishes the
  // plaintext copy on the next reconnect: the same leak, delayed, and now impossible to see coming.
  const refuseAt = fn.indexOf("_refused: 'nokey'");
  const queueAt = fn.indexOf('_outbox.push');
  assert.ok(refuseAt !== -1 && queueAt !== -1 && refuseAt < queueAt,
    'the message is queued to the outbox BEFORE the refusal, so a refused message is still sitting in the ' +
    'queue and goes out in clear on the next flush');
});

test('the label is read from the shared answer, not from the room setting', () => {
  assert.match(CHAT, /window\.Fellowship\.groupEncState\(group\.id\)/,
    'the chat screen computes the label itself again. Two places deciding what "encrypted" means is how the ' +
    'label and the send came apart in the first place');
  assert.doesNotMatch(CHAT, /\{group && group\.encrypted \? 'End-to-end encrypted'/,
    'the pill is back on the steward\'s setting, which is a statement about intent, not about this message');
  assert.match(CHAT, /encState === 'nokey' \? 'Encrypted · no key yet'/,
    'the waiting state has no label of its own, so it falls back to claiming one of the other two');
});

test('an offline refusal is not promised a fix that cannot come', () => {
  // The key for an encrypted room is only ever delivered BY THE RELAY. A member with no signal will not get
  // one however long they wait, so "it should sort itself out shortly" — which both refusals used to say —
  // is a confident claim about something the app never checked. Same defect as an empty room announcing the
  // church is unreachable, in the opposite direction.
  assert.match(CHAT, /window\.Fellowship\.relayReady\(\)/,
    'the refusal message does not distinguish offline from waiting-for-a-key');
  assert.match(CHAT, /send them once you’re back online/,
    'an offline member is told their key is on its way. It is not: nothing arrives until they reconnect');
  assert.doesNotMatch(CHAT, /It should sort itself out shortly/,
    'the promise that cannot be kept is back');
});

test('a refused message is NOT written to disk', () => {
  // Deliberate: a refused message is by definition one meant for an ENCRYPTED room, so it is the most
  // sensitive text the app handles, and the threat model is seizure of the phone. Keeping it in the composer
  // loses it if they navigate away; persisting it leaves an unsent, unencrypted message in storage
  // indefinitely. If this is ever revisited, revisit it on purpose.
  assert.doesNotMatch(CHAT, /localStorage\.setItem\(['"`]trinityone\.draft/,
    'unsent drafts are being persisted — see the note at the refusal handler before allowing this');
});

test('a member who cannot send is told why, and keeps their words', () => {
  assert.match(CHAT, /evt\._refused/, 'the composer treats a refusal as an ordinary failure');
  assert.match(CHAT, /setDraft\(d => d \|\| extra\.text\)/,
    'the refused message is not handed back, so the member watches their words vanish with a toast — the ' +
    'composer clears optimistically, which is fine only because the words come back');
});

test('blocking waits for the group-key rotations it fires', () => {
  const fn = stripComments(fnBody(DASH, 'const block = (pk) =>', 'block'));
  assert.match(fn, /rotations\.push\(Promise\.resolve\(window\.Steward\.publishGroupKey\(/,
    'group-key rotation is fired and forgotten. That mattered before because the blocked member kept the ' +
    'key; it matters MORE now, because a silent failure leaves the remaining members unable to send into ' +
    'the room at all, while the app tells them it will sort itself out shortly');
  const loopAt = fn.indexOf('for (const g of grps)');
  const awaitAt = fn.indexOf('Promise.all(rotations)');
  assert.ok(loopAt !== -1 && awaitAt !== -1 && awaitAt > loopAt,
    'Promise.all(rotations) runs BEFORE the loop that pushes the group rotations, so those are collected ' +
    'into an array nothing is waiting on — fire-and-forget wearing the shape of a fix');
});

test('the shipped bundle carries it', () => {
  assert.match(VENDOR, /groupEncState/,
    'vendor/fellowship.js predates this, so the app still labels rooms from the steward setting and still ' +
    'sends in clear — run bash scripts/build-fellowship.sh');
  assert.match(VENDOR, /_refused/, 'the shipped send does not refuse');
});
