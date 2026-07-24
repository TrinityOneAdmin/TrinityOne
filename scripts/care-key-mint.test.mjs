// The care-key MINT GATE — the guard that stops a church silently losing its care records.
// Run: node --test scripts/care-key-mint.test.mjs
//
// Why this exists. A care need's name, notes and recipient are sealed with one per-church symmetric "care
// key". Mint a SECOND key and everything sealed with the first becomes permanently unopenable — the
// ciphertext is still there, but nothing on earth can read it. So the console may only mint after it has
// positively established that no key exists.
//
// The trap: the key envelope is a PRIVATE document, so a relay that is unreachable, or reached before NIP-42
// auth completes, answers with *nothing* — which is byte-for-byte the same answer as "this church has no key
// yet". This actually happened on 2026-07-24: a console reloaded while its relay was restarting concluded
// "no key", minted a throwaway, sealed a need with it, and lost the key on the next reload. That need's
// details are gone for good.
//
// What this test is, honestly: a STRUCTURAL guard, like steward-newest-wins.test.mjs. Driving the real mint
// would need a fake relay socket under SimplePool. It asserts the guards are present in the SHIPPED bundle
// (vendor/steward.js — what actually runs), and that the mint happens AFTER them, so deleting one turns the
// suite red. It cannot prove the guards are semantically perfect, only that they are still in force.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Body of a function/method in the bundle, bounded by brace matching (a fixed window would run into the
// neighbouring method — see the note in steward-newest-wins.test.mjs).
function body(name) {
  const at = BUNDLE.indexOf(name + '(');
  assert.notEqual(at, -1, `${name} is missing from the shipped bundle`);
  const open = BUNDLE.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < BUNDLE.length; i++) {
    const c = BUNDLE[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return BUNDLE.slice(at, i + 1);
  }
  assert.fail(`could not find the end of ${name}`);
}

test('minting is gated on having actually LOOKED for an envelope', () => {
  const b = body('ensureCareKeyForMembers');
  assert.match(b, /_careKeyChecked/, 'must not mint before a completed read — a cold null key is the normal state for the first second of every console open');
});

test('minting is gated on a genuinely AUTHENTICATED read', () => {
  const b = body('ensureCareKeyForMembers');
  assert.match(b, /_relayAuthed/,
    'must not conclude "no key exists" from an unauthenticated read: the envelope is private, so an unauthed ' +
    'or unreachable relay returns the same empty answer as a church that genuinely has no key. Minting on ' +
    'that answer orphans every sealed need.');
});

test('minting is refused when the church already has care needs', () => {
  const b = body('ensureCareKeyForMembers');
  assert.match(b, /_churchHasCareNeeds/,
    'if needs exist, a care key MUST exist — minting a fresh one would orphan them. This backstop catches ' +
    'every variant of the empty-answer race, whatever its cause.');
});

test('the guards come BEFORE the mint, not after it', () => {
  const b = body('ensureCareKeyForMembers');
  const mint = b.search(/getRandomValues/);
  assert.notEqual(mint, -1, 'the mint (random key generation) should be in this function');
  for (const guard of ['_careKeyChecked', '_relayAuthed', '_churchHasCareNeeds']) {
    const at = b.indexOf(guard);
    assert.ok(at !== -1 && at < mint, `${guard} must be checked BEFORE the key is generated, or it guards nothing`);
  }
});

test('_relayAuthed is set by a real auth signature, not hardcoded', () => {
  // It must be flipped inside the NIP-42 signer — i.e. it means "we really did authenticate", not "true".
  // anchor on OUR assignment (`pool.automaticallyAuth = …`), not nostr-tools' own class field of the same name
  const at = BUNDLE.indexOf('pool.automaticallyAuth =');
  assert.notEqual(at, -1, 'the NIP-42 auth hook is missing from the shipped bundle');
  const near = BUNDLE.slice(at, at + 400);
  assert.match(near, /_relayAuthed\s*=\s*true/, '_relayAuthed must be set where the auth event is actually signed');
  assert.doesNotMatch(BUNDLE, /let\s+_relayAuthed\s*=\s*true/, '_relayAuthed must start false, or it asserts auth that never happened');
});
