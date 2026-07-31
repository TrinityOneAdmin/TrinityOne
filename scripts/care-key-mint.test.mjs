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
  assert.match(b, /_isRelayAuthed\(\)/,
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
  for (const guard of ['_careKeyChecked', '_isRelayAuthed', '_churchHasCareNeeds']) {
    const at = b.indexOf(guard);
    assert.ok(at !== -1 && at < mint, `${guard} must be checked BEFORE the key is generated, or it guards nothing`);
  }
});

test('the authenticated-view signal is a real auth, not hardcoded — and it EXPIRES', () => {
  // It must be recorded inside the NIP-42 signer — i.e. it means "we really did authenticate", not "true".
  // Anchor on OUR assignment (`pool.automaticallyAuth = …`), not nostr-tools' own class field.
  //
  // HANDOFF-2026-07-31 (5): this used to assert a boolean `_relayAuthed = true`, which was the whole bug. That
  // flag was set on the first signed challenge and NEVER cleared — still true with the relay killed — so after
  // a socket dropped, every gate below it was open while the new connection was unauthenticated. The signal is
  // now the live question "are we connected to a relay we authenticated to", answered from the pool, so a
  // dropped relay clears it on its own. What this test protects is unchanged: the signal must come from a real
  // auth, and it must not be able to outlive the connection.
  const at = BUNDLE.indexOf('pool.automaticallyAuth =');
  assert.notEqual(at, -1, 'the NIP-42 auth hook is missing from the shipped bundle');
  const near = BUNDLE.slice(at, at + 500);
  assert.match(near, /_authedRelays\.add\(/,
    'the authenticated relay must be recorded where the auth event is actually signed');
  assert.doesNotMatch(BUNDLE, /_authedRelays = new Set\(\[[^\]]/,
    'the authed-relay set starts pre-populated, so it asserts an auth that never happened');
  // And the answer must be derived from the pool, not from "have we ever authed" — that is the sticky flag
  // again under a new name.
  // NOT body('_isRelayAuthed'): its first occurrence in the bundle is a CALL inside _requireTrustedView, so
  // brace-matching from there returns that function's tail and this assertion silently checks the wrong code.
  const decl = BUNDLE.indexOf('function _isRelayAuthed(');
  assert.notEqual(decl, -1, 'the trusted-view signal is gone from the shipped bundle');
  let d = 0, end = BUNDLE.indexOf('{', decl);
  for (; end < BUNDLE.length; end++) {
    if (BUNDLE[end] === '{') d++;
    else if (BUNDLE[end] === '}' && --d === 0) break;
  }
  const isAuthed = BUNDLE.slice(decl, end + 1);
  // The pool query must come BEFORE any `return true`, or an early-out short-circuits it and the signal is a
  // constant again. Checking only that listConnectionStatus() is PRESENT is not enough — verified by sabotage:
  // `if (1) return true;` at the top of the body left this file, and the other four structural files, green.
  const q = isAuthed.indexOf('listConnectionStatus()'), yes = isAuthed.indexOf('return true');
  assert.ok(q !== -1 && (yes === -1 || q < yes),
    'the trusted-view signal returns true without asking the pool whether the relay is still connected, so it ' +
    'cannot expire when the socket drops — which is exactly the never-cleared flag this replaced');
  // Structural checks can only go so far here. The behaviour — authed against a live relay, NOT authed once it
  // is killed, authed again after re-subscribe — is driven against a real relay in
  // scripts/console-relay-auth-state.test.mjs. That file is the real guard; this one catches a deletion.
});
