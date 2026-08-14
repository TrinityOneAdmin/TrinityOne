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

// THE DECISION ITSELF, DRIVEN. Everything about the send used to be checked by grepping the source for the
// literal lines that implement it — which proves the strings are present, not that the guard can see the bug.
// An auditor replaced the whole check with `false`, in src AND vendor, reinstating the original defect, and
// all eleven tests here plus vendor-freshness stayed green. So the decision is now its own function and this
// runs it.
function wantsRig({ cache = null, hint = undefined, cp = 'ab'.repeat(32), gid = 'g1' } = {}) {
  const store = {};
  if (cache !== null) store['trinityone.groups.' + cp] = JSON.stringify(cache);
  const scope = {
    window: { Fellowship: { churchPub: cp } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
  };
  const body = stripComments(fnBody(SRC, 'function _wantsEncrypted(groupId, hint)', '_wantsEncrypted'))
    + '\n' + stripComments(fnBody(SRC, 'function _groupDoc(gid)', '_groupDoc'))
    + '\nfunction loadDocCache(prefix, cp2){ try { const a = JSON.parse(localStorage.getItem("trinityone." + prefix + "." + cp2) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }';
  const names = Object.keys(scope);
  const fn = new Function(...names, body + '\nreturn _wantsEncrypted;')(...names.map(n => scope[n]));
  return fn(gid, hint);
}

test('a warm cache saying encrypted is honoured', () => {
  assert.equal(wantsRig({ cache: [{ id: 'g1', encrypted: true }] }), true);
});

test('an ordinary room is not treated as encrypted', () => {
  assert.equal(wantsRig({ cache: [{ id: 'g1', encrypted: false }] }), false,
    'every ordinary room would refuse to send, which is the fix breaking normal messaging for everyone');
});

test('a cache MISS does not silently mean "send it in clear"', () => {
  // The four routes to a miss are all ordinary: a swallowed QuotaExceededError on write, caching disabled,
  // an empty list persisted after the roster filter, and the church-switch race.
  assert.equal(wantsRig({ cache: [], hint: true }), true,
    'THE BUG: the room is missing from the cache, so the decision answered "not encrypted" and the message ' +
    'went out in plain text under an "End-to-end encrypted" label — the original defect, surviving in ' +
    'exactly the conditions most likely to produce it');
  assert.equal(wantsRig({ cache: null, hint: true }), true, 'no cache at all must not mean "send in clear"');
});

test('the wrong church\'s cache cannot authorise cleartext', () => {
  // The church-switch race: churchPub has moved on, the cache under the new key has not arrived yet.
  assert.equal(wantsRig({ cache: null, cp: 'cd'.repeat(32), hint: true }), true);
});

test('a caller cannot talk the send INTO cleartext', () => {
  // hint:false must not override a cache that says encrypted — a caller wrong in that direction publishes
  // plaintext, and this function exists to make that impossible to do by accident.
  assert.equal(wantsRig({ cache: [{ id: 'g1', encrypted: true }], hint: false }), true,
    'a caller passing the wrong flag can downgrade a room to cleartext');
});

// THE SEND ITSELF, EXECUTED. Everything about publishMessage was still checked by grepping for the lines
// that implement it — and a re-audit showed exactly what that is worth: appending `&& false` to the wantsEnc
// line disables the whole refusal, restores BOTH original leaks (a keyless member publishing plaintext under
// an "End-to-end encrypted" label, and a thrown seal falling through to cleartext), rebuilds vendor, and
// leaves every test in this file green. The literal is still present, so every grep is satisfied.
//
// That is the second time a "behavioural" claim here was really a source-text claim. So this drives the real
// function against stubs and asserts on WHAT COMES OUT.
function sendRig({ cache = [{ id: 'g1', encrypted: true }], hint, key = null, sealThrows = false } = {}) {
  const CP = 'ab'.repeat(32);
  const store = { ['trinityone.groups.' + CP]: JSON.stringify(cache) };
  const outbox = [];
  const published = [];
  const scope = {
    sk: new Uint8Array(32),
    window: { Fellowship: { churchPub: CP, ready: Promise.resolve(), relays: ['wss://r'] } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    _gkeys: key ? { [CP + '|g1']: [key] } : {},
    _gkKey: (cp, gid) => cp + '|' + gid,
    // deliberately does NOT echo the plaintext — a stub that did would make the "is the plaintext on the
    // wire" assertion pass for the wrong reason, which is the whole failure mode this file is about
    nip44e: (plain) => { if (sealThrows) throw new Error('seal failed'); return 'SEALED[' + String(plain).length + ']'; },
    finalizeEvent: (e) => ({ ...e, id: 'evt1' }),
    NET: 'trinityone',
    _outbox: outbox,
    _outboxSave: () => {},
    _publishBounded: async (_r, e) => { published.push(e); return true; },
    console: { warn: () => {} },
  };
  const body = stripComments(fnBody(SRC, 'function _wantsEncrypted(groupId, hint)', '_wantsEncrypted'))
    + '\n' + stripComments(fnBody(SRC, 'function _groupDoc(gid)', '_groupDoc'))
    + '\nfunction loadDocCache(prefix, cp){ try { const a = JSON.parse(localStorage.getItem("trinityone." + prefix + "." + cp) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }'
    + '\nconst api = { ' + stripComments(fnBody(SRC, 'async publishMessage(groupId, content, extraTags = [], opts = {})', 'publishMessage')) + ' };';
  const names = Object.keys(scope);
  const api = new Function(...names, body + '\nreturn api;')(...names.map(n => scope[n]));
  return { send: (text) => api.publishMessage('g1', text, [], hint === undefined ? {} : { encrypted: hint }), outbox, published };
}

test('EXECUTED: a keyless member is refused, and nothing is queued or published', async () => {
  const r = sendRig({ key: null });
  const out = await r.send('secret words');
  assert.equal(out && out._refused, 'nokey',
    'the send published instead of refusing — a member with no key put their words on the relay in clear, ' +
    'under a room labelled encrypted. This is the original defect, and no grep-based test can see it');
  assert.equal(r.outbox.length, 0, 'a refused message was queued — it goes out in clear on the next flush');
  assert.equal(r.published.length, 0, 'a refused message was published anyway');
});

test('EXECUTED: with a key, the words are sealed before they leave', async () => {
  const r = sendRig({ key: new Uint8Array(32) });
  const evt = await r.send('secret words');
  assert.equal(evt._refused, undefined, 'a member holding the key was refused');
  assert.ok(!String(evt.content).includes('secret words'), 'the plaintext is on the wire');
  assert.ok(evt.tags.some(t => t[0] === 'enc'), 'the event is not marked encrypted, so readers will not decrypt it');
});

test('EXECUTED: a seal that throws refuses rather than falling through to cleartext', async () => {
  const r = sendRig({ key: new Uint8Array(32), sealThrows: true });
  const out = await r.send('secret words');
  assert.equal(out && out._refused, 'sealfailed',
    'the seal threw and the send carried on with the ORIGINAL text — the catch block was empty for exactly ' +
    'this reason and it looked deliberate');
  assert.equal(r.published.length, 0, 'the unencrypted message was published');
});

test('EXECUTED: an ordinary room still sends normally', async () => {
  const r = sendRig({ cache: [{ id: 'g1', encrypted: false }], key: null });
  const evt = await r.send('hello everyone');
  assert.equal(evt._refused, undefined, 'an ordinary unencrypted room now refuses to send — this breaks chat for everyone');
  assert.equal(evt.content, 'hello everyone');
  assert.ok(!evt.tags.some(t => t[0] === 'enc'));
});

test('EXECUTED: a cache miss does not become a cleartext publish', async () => {
  const r = sendRig({ cache: [], hint: true, key: null });
  const out = await r.send('secret words');
  assert.equal(out && out._refused, 'nokey',
    'the room was missing from the cache, so the send fell back to "not encrypted" and published in clear — ' +
    'the caller told it the room was encrypted and it did not listen');
});

test('EXECUTED: a caller cannot downgrade an encrypted room to cleartext', async () => {
  const r = sendRig({ cache: [{ id: 'g1', encrypted: true }], hint: false, key: null });
  const out = await r.send('secret words');
  assert.equal(out && out._refused, 'nokey', 'a caller passing the wrong flag published cleartext into an encrypted room');
});

test('the send asks the shared decision, not the cache directly', () => {
  const fn = stripComments(fnBody(SRC, 'async publishMessage(groupId, content, extraTags = [], opts = {})', 'publishMessage'));
  assert.match(fn, /_wantsEncrypted\(groupId, opts\.encrypted\)/,
    'publishMessage decides for itself again, so the caller\'s knowledge is thrown away and a cache miss ' +
    'once more means "send it in clear"');
});

test('every send path passes what it knows', () => {
  const calls = CHAT.match(/publishMessage\(/g) || [];
  const withHint = CHAT.match(/publishMessage\([^;]*?encrypted:/g) || [];
  assert.equal(withHint.length, calls.length,
    `${calls.length - withHint.length} of ${calls.length} send paths do not pass the room's encryption state. ` +
    'The room screen holds it and simply was not asked — that is how a cache miss became a cleartext publish');
});

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
  const fn = stripComments(fnBody(SRC, 'async publishMessage(groupId, content, extraTags = [], opts = {})', 'publishMessage'));
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

test('sharing into a room that refused it does not claim success', () => {
  // The share sheet fired and forgot, then toasted "Shared to <room>" unconditionally. Once the send started
  // REFUSING to publish into an encrypted room without its key, that turned a leak into silent LOSS wearing a
  // confirmation: the verse gone, the sheet closed, the member told it had been shared. Losing something
  // quietly while claiming it worked is the worst outcome this app can produce.
  const fn = stripComments(fnBody(CHAT, 'const sendToGroup = (g) =>', 'sendToGroup'));
  assert.match(fn, /_refused/,
    'the share path ignores a refusal and reports success — the shared item is unrecoverable and the member ' +
    'has no way to know');
  assert.match(fn, /encrypted: !!g\.encrypted/,
    'the share path does not tell the send what it knows about the room, so it falls back to the cache — ' +
    'and a cache miss there means publishing in clear');
  const okAt = fn.indexOf("'Shared to '");
  const refusedAt = fn.indexOf('_refused');
  assert.ok(refusedAt !== -1 && okAt !== -1 && refusedAt < okAt,
    'the success toast fires before the refusal is considered');
});

test('an offline refusal is not promised a fix that cannot come', () => {
  // CORRECTED 2026-08-13. An earlier version of this note said the room key "is only ever delivered by the
  // relay", and that is wrong: the docs hub persists its whole buffer — group-key envelopes included — and
  // re-absorbs it at boot, so a member who has already received the envelope unwraps it offline with their
  // own key and is in the 'sealed' state with no signal at all. What is on disk is the SEALED envelope, not
  // the key, which is why this is safe to keep.
  //
  // The narrower claim is the one that holds, and it is the one this test is about: a member who does NOT
  // already hold the envelope cannot obtain it while offline. For them "it should sort itself out shortly"
  // — which both refusals used to say — is a promise about something the app never checked. Same defect as
  // an empty room announcing the church is unreachable, in the opposite direction.
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
