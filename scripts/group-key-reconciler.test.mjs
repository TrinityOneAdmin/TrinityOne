// A ROOM CANNOT BE LEFT ENCRYPTED WITH NO KEY.
// Run: node --test scripts/group-key-reconciler.test.mjs
//
// SIMULATION ROUND 6, 2026-08-25. St Aidan's had four encrypted rooms and three key envelopes. Prayer had
// none, so every member's message to it was refused by their own phone — correctly, because the alternative
// is publishing a private prayer in cleartext — with a toast promising the key would arrive "in a moment".
// It never could. A woman's prayer request about her seriously ill mother died in that room, and the room
// looked completely normal from every seat, including the vicar's.
//
// HOW A ROOM IS BORN DEAD, and it is not exotic: the console waited 4.4 seconds for every relay to
// acknowledge a write. On a congested pipe a group document that WAS stored came back as a failure, and both
// creation paths read that as "nothing happened" — skipping the key publish AND the revert. What is left on
// the relay is a room flagged `encrypted: true` with no envelope anywhere, and nothing in the product has
// ever repaired one: the background re-key passes `reuseOnly`, which by design refuses to mint, and the seal
// buttons only appear for rooms not yet flagged.
//
// The reconciler both PREVENTS this and HEALS rooms already broken by older versions.
//
// WHAT THIS FILE GUARDS MOST CAREFULLY IS THE REFUSAL TO ACT. Minting a second key for a room that already
// has one makes everything sealed with the first permanently unreadable — the ciphertext survives and nothing
// can open it. That happened once already in this project, to a care key, on 2026-07-24. "The relay returned
// no envelope" is NOT proof that none exists: a private document reads back empty from an unauthenticated or
// half-connected relay too. So every guard must fail CLOSED, and the tests below are mostly tests that the
// code does NOTHING.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// the shipped console bundle, not src/ — a test that reads source proves nothing about what a steward runs
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
// BOUND THE FUNCTION EXACTLY, do not take a fixed slice. The first version of this file took 2200 characters
// from `ensureGroupKeys` onwards, which ran past the end of the function and into `publishGroupKey` — so the
// authentication-gate assertion matched the NEXT function's use of _isRelayAuthed and passed happily with the
// gate deleted. Caught by sabotage, not by being green. The mint gate is the most dangerous code in this file
// and its test was the vacuous one.
const fn = (() => {
  const i = VENDOR.indexOf('ensureGroupKeys');
  if (i < 0) return '';
  const j = VENDOR.indexOf('publishGroupKey', i);      // the next method — the reconciler ends before it
  return VENDOR.slice(i, j > i ? j : i + 2200);
})();

test('the shipped console HAS a reconciler at all', () => {
  assert.ok(fn, 'nothing reconciles group keys, so a room born without one stays dead for ever');
});

test('it refuses to conclude "no key" from an unauthenticated read', () => {
  // The guard that stops a reconnecting console from re-keying a healthy church and orphaning its history.
  assert.match(fn, /_isRelayAuthed\(\)/,
    'the reconciler acts without checking it is authenticated — an empty answer from an unauthenticated relay looks exactly like a missing key');
});

test('it asks the relay directly rather than trusting a local flag', () => {
  // A missed subscription frame and a genuinely absent envelope are indistinguishable from inside the client.
  // Only an authoritative read can tell them apart, and one of the two must never lead to a mint.
  assert.match(fn, /querySync/,
    'the reconciler decides from local state — a dropped frame would read as a missing key and trigger a mint');
});

test('an empty answer must be PROVEN, not assumed', () => {
  // This test used to assert a `catch { continue; }` and passed happily over a guard that could never fire:
  // querySync NEVER REJECTS — it resolves with whatever arrived — so an unreachable relay, a dropped frame and
  // a genuinely absent document are one and the same empty array. The authentication check is no help either,
  // because it records that we SIGNED the challenge, not that the relay ACCEPTED it, and this is an auth-gated
  // read. Rejected auth -> everything reads empty -> mint a second key -> every message ever sealed in that
  // room is permanently unreadable. A green test over a guard that cannot fire is worse than no test.
  // The canary is the group's own definition document: we are looking at this group because we read that
  // document, so if it does not come back, our reads are broken and nothing we read may be believed.
  assert.match(fn, /canary/,
    'nothing proves the reads are working, so an empty answer from a broken connection reads as "no key exists"');
  assert.match(fn, /!canary\.length\) continue/,
    'the canary is fetched but not acted on — an unreadable group still falls through to minting');
});

test('a room with sealed traffic is never silently re-keyed', () => {
  // Absence of encrypted messages is what makes the Prayer repair safe: nobody could ever post there. A room
  // that DOES hold sealed messages must go to a human instead.
  // NB match either quote style and either number form: esbuild rewrites '…' to "…" and 12000 to 12e3, and a
  // pattern that assumes the source's formatting tests the bundler rather than the behaviour.
  assert.match(fn, /["']enc["']/,
    'the reconciler does not check for existing encrypted messages, so healing one room could destroy another');
  assert.match(fn, /needs-decision/,
    'there is no path that defers to a steward — the only options are mint or ignore');
});

test('the console waits long enough for a slow relay to say yes', () => {
  // 4.4 seconds is how a stored document becomes a reported failure, which is how a room is born with no key.
  assert.match(VENDOR, /publishTimeout\s*<\s*(12000|12e3)/,
    'the console still gives up on an acknowledgement after the vendored 4.4s, so a congested pipe still turns "saved" into "couldn\'t save"');
});
