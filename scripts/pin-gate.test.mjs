// A console must never reach the dashboard with the church key unencrypted, and must only be asked once.
// Run: node --test scripts/pin-gate.test.mjs
//
// AUDIT-2026-07-28. Two PIN prompts appear when creating a church, and the obvious tidy-up — delete the
// first, weaker one — would have opened a hole. The setup wizard only runs for a brand-new, not-yet-named
// church that has never dismissed it: a console restored from 12 words, a steward adopted onto an existing
// church, a network console, or anyone who dismissed it once, all reach the dashboard without it. The
// forced gate is the only thing every route passes through, so it was brought up to standard instead, and
// the wizard's step now steps aside when a PIN already exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const forced = (() => {
  const at = ROOT.indexOf('function StewardForcedPin');
  assert.notEqual(at, -1, 'the universal PIN gate is GONE — every route into the console can now reach the dashboard with the church key unencrypted');
  return ROOT.slice(at, ROOT.indexOf('\nfunction ', at + 10));
})();

test('the universal gate still blocks the dashboard', () => {
  assert.match(ROOT, /needsPin \? <StewardForcedPin \/>/,
    'the forced gate is no longer in the render chain, so a console with no PIN falls straight through to the dashboard');
});

test('it asks twice, like every other place that sets a secret', () => {
  assert.match(forced, /pin2/, 'no confirm field — one mistyped character locks the church key with a PIN nobody knows');
  assert.match(forced, /pin !== pin2/, 'the two entries are never compared');
});

test('it enforces the same strength as the wizard', () => {
  // Six characters, digits allowed — reverted from the stricter 8-and-no-bare-digits rule on 2026-07-28,
  // because that demanded a passphrase while the unlock screens still offered a numeric keypad and locked
  // the owner out of the account he had just made. What matters here is that this gate and the wizard agree.
  assert.match(forced, /length < 6/, 'the floor moved away from 6 — the wizard and this gate must match');
  assert.doesNotMatch(forced, /4\+ chars/, 'the old 4-character wording is still on screen');
});

test('a new church is not asked twice', () => {
  assert.match(DASH, /_alreadyLocked/, 'the wizard asks again even when the forced gate already set a PIN');
  const at = DASH.indexOf('if (step === 2 && _alreadyLocked)');
  assert.notEqual(at, -1, 'the wizard PIN step no longer steps aside when a PIN exists');
  assert.match(DASH.slice(at, at + 120), /next\(\)/, 'stepping aside must advance the wizard, not strand it');
});

test('and the wizard step is still there for anyone who somehow has no PIN', () => {
  assert.match(DASH, /Lock this device with a PIN/, 'the wizard PIN step was deleted rather than made conditional');
});
