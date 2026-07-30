// The console's church key must always end up encrypted, and a new church must not be open by accident.
// Run: node --test scripts/steward-pin-policy.test.mjs
//
// Both found by creating a church from scratch on 2026-07-28, which nothing had ever done on a clean relay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const wizard = (() => {
  const at = DASH.indexOf('function StewSetupWizard');
  assert.notEqual(at, -1, 'the setup wizard is gone');
  return DASH.slice(at, DASH.indexOf('\nfunction ', at + 10));
})();

test('the PIN step cannot be skipped', () => {
  // The key signs as the whole church. "Skip for now" is how a laptop in a church office ends up holding it
  // unencrypted, and the people most likely to skip are the ones for whom it matters most.
  const at = wizard.indexOf('Lock this device with a PIN');
  assert.notEqual(at, -1, 'the PIN step is gone from the wizard');
  // Stop at the NEXT wizard step. A fixed-size window ran past the end into the groups step, which is
  // allowed to be skippable, and reported a correct fix as broken — the same fixed-window trap that has
  // now bitten this repo four times. AUDIT-2026-07-28.
  const end = wizard.indexOf('if (step ===', at);
  assert.ok(end > at, 'could not find the end of the PIN step');
  // Strip comments: the note explaining WHY the skip was removed quotes the button's old label, so matching
  // it in prose rather than in code fails against a correct fix. Third time today. AUDIT-2026-07-28.
  const step = wizard.slice(at, end)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  assert.doesNotMatch(step, /Skip for now/, 'the PIN step is skippable again');
  assert.match(step, /savePin/, 'the PIN step no longer offers a way to set one');
});

test('the PIN has a real minimum, matched by the keyboard', () => {
  // Was 'digits alone are refused, and a phrase is asked for'. Reverted 2026-07-28: the stricter rule
  // demanded a passphrase on the set screen while the unlock screen still offered a numeric keypad, which
  // locked the owner out of the account he had just created — and a PIN cannot be reset. The guard left behind
  // was `doesNotMatch(fn, /length < 8/)` — literally "do not raise this to 8 without the keyboard to match it".
  //
  // AUDIT-2026-07-30: raised to 8 for STEWARDS by the owner's decision, and the keyboard WAS checked first —
  // no steward PIN field sets inputMode at all, so every one of them gets the ordinary text keyboard. The
  // console's only numeric field is a pairing code (placeholder "0000"), which is not a password field.
  //
  // The guard is now stated as the thing it actually protects — a minimum, AND a keyboard that can type it —
  // instead of a number that must never appear. A rule phrased as "never 8" cannot survive a deliberate change
  // to 8; a rule phrased as "whatever the minimum, the keys must exist" survives every future change.
  const at = wizard.indexOf('const savePin');
  const fn = wizard.slice(at, at + 900);
  assert.match(fn, /length < 8/, 'the wizard minimum is gone');
  const numericPassword = /inputMode=["']numeric["'][^>]*type=["']password["']|type=["']password["'][^>]*inputMode=["']numeric["']/;
  assert.doesNotMatch(wizard, numericPassword,
    'a password field forces the numeric keypad. The minimum now allows letters, so a keypad without them ' +
    'locks out anyone who set one — the 2026-07-28 incident, exactly.');
});

test('a new church requires approval to join', () => {
  // The relay reads "no join policy published" as OPEN, so a church that never visited the setting let
  // anyone with the join code straight in — and, once the name key reached them, to every member's name.
  // AUDIT-2026-07-28 F10: this used to assert setJoinPolicy(true) here, and that call was REFUSED by every
  // relay that already hosts a church — the relay does not accept documents from a church it has not been
  // told about, and at this point in the wizard it has not. The wizard swallowed the refusal and advanced, so
  // the church was created open-join anyway. The one-shot is replaced by ensureJoinPolicy, which converges:
  // see scripts/join-policy.test.mjs, which drives it against a relay that already hosts a congregation.
  const at = wizard.indexOf('const saveName');
  const fn = wizard.slice(at, at + 900);
  assert.match(fn, /ensureJoinPolicy\(\)/, 'church setup no longer gates joins, so a new church is open to anyone holding the code');
  assert.doesNotMatch(fn, /setJoinPolicy\(true\)/,
    'the one-shot is back — it is refused by any relay that already hosts a church, and the refusal is swallowed here');
  const policyAt = fn.indexOf('ensureJoinPolicy');
  const nextAt = fn.indexOf('next()');
  assert.ok(policyAt < nextAt, 'the policy must be published before the wizard moves on');
});
