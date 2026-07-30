// A member's PIN must not accept unlimited instant guesses. Run: node --test scripts/member-pin-throttle.test.mjs
//
// AUDIT-2026-07-30 U4 / S6b. The two apps had opposite protections, and the audit's own security pass got this
// backwards — it reported "no attempt throttling anywhere in either app". The UI/UX pass said otherwise and the
// code settled it:
//
//     CONSOLE  app/steward-root.jsx — a persisted escalating cooldown: 5 misses -> 30s, doubling, capped at
//              1h, stored in localStorage so it SURVIVES A RELOAD.
//     MEMBER   app/identity.jsx tryUnlock() — no counter, no delay, no lockout. Unlimited instant guesses.
//
// The asymmetry ran the wrong way, and in the worse direction. There are twenty members and one steward, and it
// is members' phones that get taken — this product's threat model is seizure, not remote attack. A 6-character
// PIN with unlimited instant guesses is a very different proposition from one with an escalating lockout.
//
// Two things this must NOT do, both asserted below: it must not lock a member out of their Bible (the lock
// screen deliberately still offers the reader), and the counter must be clearable only by SUCCEEDING — not by
// force-quitting, relocking, or waiting for the locked-boot wipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const IDENTITY = read('app/identity.jsx');
const FELLOW = read('src/fellowship.src.js');

// The member app's unlock handler.
const unlockBody = (() => {
  const at = IDENTITY.indexOf('const tryUnlock = async');
  assert.notEqual(at, -1, 'tryUnlock is gone — re-anchor this test');
  return IDENTITY.slice(at, IDENTITY.indexOf('\n  };', at));
})();

test('the member unlock gate has a persisted attempt guard', () => {
  assert.match(unlockBody, /GUARD|guard/,
    'tryUnlock() still has no attempt guard. A 6-character PIN with unlimited instant guesses is minutes of ' +
    'work for anyone holding the phone, and this product is designed against seizure.');
  assert.match(IDENTITY, /trinityone\.pinguard/,
    'no persisted guard key — a counter held only in memory resets on every app restart, so it stops nobody');
  // Assert the WRITE, not the constant. My first version matched the key name anywhere in the file, so deleting
  // the setItem — leaving an in-memory counter that a force-quit resets — sabotaged nothing.
  assert.match(unlockBody, /localStorage\.setItem\(GUARD_KEY/,
    'the failure count is never written to storage. An in-memory counter resets on every app restart, so anyone ' +
    'holding the phone force-quits and starts again — the throttle would be theatre.');
  assert.match(unlockBody, /readPinGuard\(\)/, 'tryUnlock never READS the persisted count, so it always starts from zero');
});

test('the cooldown escalates, and is capped', () => {
  // Lift the real formula and run it, rather than trusting that it looks right.
  const m = IDENTITY.match(/const until = fails >= 5 \?[^;]*;/);
  assert.ok(m, 'the escalation formula is missing or reshaped — re-anchor this test');
  const at = (fails) => {
    // eslint-disable-next-line no-new-func
    const f = new Function('fails', 'Date', 'Math', m[0] + '\nreturn until;');
    return f(fails, { now: () => 0 }, Math);
  };
  assert.equal(at(1), 0, 'a first wrong PIN should not lock anyone out');
  assert.equal(at(4), 0, 'four attempts should still be free — a member mistyping is not an attacker');
  assert.equal(at(5), 30 * 1000, 'the 5th miss should start a 30s cooldown');
  assert.equal(at(6), 60 * 1000, 'the 6th should double to 60s');
  assert.equal(at(7), 120 * 1000, 'the 7th should double again');
  assert.ok(at(20) <= 3600 * 1000, 'the cooldown is uncapped — a mistyping member could be locked out for days');
  assert.equal(at(20), 3600 * 1000, 'the cap should be 1h, matching the console');
});

test('a correct PIN clears the counter', () => {
  assert.match(unlockBody, /removeItem\(GUARD_KEY\)|removeItem\('trinityone\.pinguard'\)/,
    'a successful unlock does not clear the guard, so a member who mistyped four times then got it right stays ' +
    'one miss away from a lockout for ever');
});

test('a locked-out member can STILL read their Bible', () => {
  // The whole point of the lock screen is that the app degrades to a Bible reader rather than a brick. A
  // throttle that takes that away would be a worse bug than the one being fixed.
  const at = IDENTITY.indexOf('const tryUnlock = async');
  const screen = IDENTITY.slice(at, at + 6000);
  assert.match(screen, /without unlocking|Read the Bible/i,
    'the lock screen no longer offers the Bible. A throttled member must still be able to read Scripture — that ' +
    'is what makes the lock screen humane rather than a brick.');
});

test('the Unlock button SHOWS the cooldown, rather than silently doing nothing', () => {
  // Leaving the button enabled during a lockout means a tap does nothing visible. That is the silent-failure
  // class this codebase keeps being bitten by, and it would be self-inflicted here.
  const at = IDENTITY.indexOf('onClick={tryUnlock}');
  assert.notEqual(at, -1, 'the Unlock button is gone — re-anchor this test');
  const btn = IDENTITY.slice(at, IDENTITY.indexOf('</button>', at));
  assert.match(btn, /disabled=\{[^}]*waitLeft > 0/, 'the button stays enabled during the cooldown, so a tap does nothing');
  assert.match(btn, /waitLeft > 0 \? 'Wait '/, 'the button does not tell the member how long to wait');
});

test('the counter cannot be reset by relocking — the wipe must NOT clear it', () => {
  // clearCommunityCache runs on a LOCKED BOOT. If it cleared the guard, an attacker would reset the cooldown by
  // force-quitting the app, and the throttle would be theatre.
  const at = FELLOW.indexOf('    const PREFIXES = [');
  assert.notEqual(at, -1, 'the wipe rules are gone — re-anchor this test');
  const m = /IDENTIFIER\.test\(k\)\)+;/.exec(FELLOW.slice(at));
  // eslint-disable-next-line no-new-func
  const doomed = new Function(FELLOW.slice(at, at + m.index + m[0].length) + '\nreturn doomed;')();
  assert.equal(doomed('trinityone.pinguard'), false,
    'the locked-boot wipe deletes the PIN guard, so an attacker resets the cooldown by force-quitting the app. ' +
    'The throttle would count for nothing.');
  // control: the wipe must still be doing its job
  assert.equal(doomed('trinityone.groups.abc'), true, 'the wipe has stopped clearing cached church data');
});
