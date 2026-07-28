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

test('digits alone are refused, and a phrase is asked for', () => {
  // Six digits is a million guesses — minutes of offline work against a stolen laptop even at 600k PBKDF2
  // rounds. The field already accepts a passphrase; the wording has to ask for one.
  const at = wizard.indexOf('const savePin');
  const fn = wizard.slice(at, at + 900);
  assert.match(fn, /length < 8/, 'the minimum is back below 8 characters');
  assert.match(fn, /\^\\d\+\$/, 'an all-digit PIN is accepted without a length penalty');
  assert.match(fn, /words/i, 'nothing tells the steward that a phrase is stronger than digits');
});

test('a new church requires approval to join', () => {
  // The relay reads "no join policy published" as OPEN, so a church that never visited the setting let
  // anyone with the join code straight in — and, once the name key reached them, to every member's name.
  const at = wizard.indexOf('const saveName');
  const fn = wizard.slice(at, at + 900);
  assert.match(fn, /setJoinPolicy\(true\)/, 'church setup no longer gates joins, so a new church is open to anyone holding the code');
  const policyAt = fn.indexOf('setJoinPolicy');
  const nextAt = fn.indexOf('next()');
  assert.ok(policyAt < nextAt, 'the policy must be published before the wizard moves on');
});
