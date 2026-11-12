// The Suite-auto-update settings coercion: opt-in default OFF, a validated "HH:MM" apply time.
// Run: node --test scripts/suite-autoupdate-settings.test.mjs
//
// Lifts the REAL coerceHHMM / coerceSuiteAutoUpdate out of gateway.mjs (the SUITE-AUTOUPDATE-SETTINGS slice)
// and runs them — the same functions loadSettings() and POST /settings both call. Goes red if the slice is
// deleted or the opt-in/validation is broken (CLAUDE.md rule 1, lifted + executed, not text-matched).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'gateway.mjs'), 'utf8');
const m = SRC.match(/\/\/ SUITE-AUTOUPDATE-SETTINGS-BEGIN[^\n]*\n([\s\S]*?)\/\/ SUITE-AUTOUPDATE-SETTINGS-END/);
assert.ok(m, 'SUITE-AUTOUPDATE-SETTINGS markers are gone from gateway.mjs — the settings coercion was removed; re-anchor this test');
const api = new Function(m[1] + '\nreturn { coerceHHMM, coerceSuiteAutoUpdate };')();

test('defaults: absent keys ⇒ OFF and 03:00', () => {
  const out = {};
  api.coerceSuiteAutoUpdate({}, out);
  assert.equal(out.autoUpdate, false, 'auto-update must default OFF (opt-in)');
  assert.equal(out.autoUpdateAt, '03:00', 'the apply time must default to 03:00');
});

test('explicit set: true + a valid time is taken verbatim', () => {
  const out = {};
  api.coerceSuiteAutoUpdate({ autoUpdate: true, autoUpdateAt: '02:15' }, out);
  assert.equal(out.autoUpdate, true);
  assert.equal(out.autoUpdateAt, '02:15');
});

test('only an explicit boolean true enables it (truthy strings do not)', () => {
  for (const v of ['true', 1, 'yes', {}]) {
    const out = {};
    api.coerceSuiteAutoUpdate({ autoUpdate: v }, out);
    assert.equal(out.autoUpdate, false, JSON.stringify(v) + ' must NOT enable auto-update');
  }
  const out = {}; api.coerceSuiteAutoUpdate({ autoUpdate: true }, out);
  assert.equal(out.autoUpdate, true);
});

test('an invalid time is ignored, keeping the prior value (never corrupted)', () => {
  const out = { autoUpdateAt: '22:30' };
  api.coerceSuiteAutoUpdate({ autoUpdateAt: '25:99' }, out);
  assert.equal(out.autoUpdateAt, '22:30', 'a bad HH:MM must not overwrite a good one');
  const fresh = {};
  api.coerceSuiteAutoUpdate({ autoUpdateAt: 'nonsense' }, fresh);
  assert.equal(fresh.autoUpdateAt, '03:00', 'with no prior value, a bad time falls back to the default');
});

test('coerceHHMM validates the 24-hour clock', () => {
  assert.equal(api.coerceHHMM('00:00'), '00:00');
  assert.equal(api.coerceHHMM('23:59'), '23:59');
  assert.equal(api.coerceHHMM(' 09:05 '), '09:05', 'surrounding whitespace is trimmed');
  for (const bad of ['24:00', '09:60', '9:00', '0900', '', null, undefined, '12:3']) {
    assert.equal(api.coerceHHMM(bad), '', JSON.stringify(bad) + ' is not a valid HH:MM');
  }
});
