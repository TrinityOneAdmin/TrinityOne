// THE FORGOT-PIN PANEL MUST ONLY PROMISE A RECOVERY THE DEVICE CAN PERFORM.
// Run: node --test scripts/recovery-reference.test.mjs
//
// THE DEFECT (pre-merge audit 2026-08-07, finding 5). unlockWithMnemonic refuses unless whoseMnemonic()
// answers 'match', which needs a stored public key to compare the typed phrase against. That key was written
// only by apply() — which does not run on a locked boot — so a member who set a PIN and later forgot it could
// be told, in new copy on this branch:
//
//     "your 12 words will open this account right here: type them below and nothing else is lost"
//
// then type the correct phrase and be answered "This phone can't check whose words those are, so it won't
// risk replacing the account." A worse dead end than the old "reinstall the app", because it first promises
// a way out.
//
// The refusal itself is right and stays: guessing would let a valid phrase that is NOT this member's destroy
// the account they were trying to open. What was wrong was promising first and checking afterwards.
//
// WHAT CHANGED SINCE. Finding 2's fix made setPin record the owner's pubkey in the encrypted-blob marker, and
// unlike the apply() one that reference IS readable on a locked boot. So the honest answer is no longer just
// "soften the copy" — most devices can now be given the recovery that was promised, and only those whose PIN
// predates this branch cannot. Those are the ones the panel must stop promising to, BEFORE the member types
// their phrase and learns it was for nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = readFileSync(ROOT + 'src/identity.src.js', 'utf8');
const VENDOR = readFileSync(ROOT + 'vendor/identity.js', 'utf8');
const UI = readFileSync(ROOT + 'app/identity.jsx', 'utf8');

const ALICE = 'a'.repeat(64);

function lift(store) {
  const at = SRC.indexOf('function _recoveryReference(');
  assert.notEqual(at, -1,
    '_recoveryReference() does not exist in src/identity.src.js.\n\n' +
    '  If this is the first run, that IS the defect: whoseMnemonic reads localStorage PUB_KEY directly, which\n' +
    '  apply() writes and a locked boot never runs — so a member with a forgotten PIN is promised a recovery\n' +
    '  and then refused, even though setPin now records the account on the encrypted blob itself.');
  let depth = 0, q = '', body;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    const c = SRC[i], prev = SRC[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && SRC[i + 1] === '/') { i = SRC.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) { body = SRC.slice(at, i + 1); break; }
  }
  assert.ok(body, 'could not find the end of _recoveryReference');
  const scope = {
    PUB_KEY: 'trinityone.nostr.pub',
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    encOwnerPub: () => store.__owner || null,
  };
  const names = Object.keys(scope);
  return new Function(...names, body + '\nreturn _recoveryReference;')(...names.map(n => scope[n]));
}

test('a device that has unlocked at least once can still recover', () => {
  assert.equal(lift({ 'trinityone.nostr.pub': ALICE })(), ALICE);
});

test('a PIN-locked device that has NEVER unlocked can now recover too', () => {
  // This is the case the whole finding was about. apply() never ran, so PUB_KEY is absent — but setPin
  // recorded the account on the blob marker, and that survives a locked boot.
  assert.equal(lift({ __owner: ALICE })(), ALICE,
    'THE DEAD END: the panel promises the 12 words will open this account, the member types them correctly, ' +
    'and the phone answers that it cannot check whose words they are');
});

test('a device with neither reference admits it, rather than guessing', () => {
  assert.equal(lift({})(), '',
    'with no reference at all this returned something to compare against anyway — and guessing here lets a ' +
    'valid phrase that is NOT this member\'s replace the account they were trying to open');
});

test('the two references agree, and the live one wins', () => {
  // PUB_KEY is written on every apply(); the marker is written once at setPin. If a device somehow holds
  // both and they disagree, the freshly-applied identity is the one on this phone now.
  assert.equal(lift({ 'trinityone.nostr.pub': ALICE, __owner: 'b'.repeat(64) })(), ALICE);
});

test('the panel does not promise what a device without a reference cannot do', () => {
  assert.match(UI, /canRecoverWithWords/,
    'app/identity.jsx never asks whether this device CAN check a phrase, so the promise ("your 12 words will ' +
    'open this account right here… nothing else is lost") is printed unconditionally — including on the ' +
    'devices that will refuse it after the member has typed their phrase');
});

test('the shipped bundle carries it', () => {
  assert.match(VENDOR, /_recoveryReference/,
    'vendor/identity.js predates this fix — run npm run build:bundles');
});
