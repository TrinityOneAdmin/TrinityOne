// The backup screen must state the rule it enforces — it is the only flow that saves the church key to a file.
// Run: node --test scripts/backup-ceremony-rules.test.mjs
//
// UX audit 2026-08-04. backup.jsx sets PASS_MIN = 12 and says so in a comment: "THE FLOOR LIVES HERE, not in
// the screens." The console's backup modal restated it as 4 in the error text, enabled its button at 4, and
// gated on 12 — so a steward typing 4-11 characters was told to "Use at least 4 characters (a numeric PIN is
// fine)" and refused, in a loop, with no way forward. The label and placeholder invited a PIN that checkPass
// rejects outright. And the helper said "Store it with the file", which under a seizure threat model instructs
// the steward to keep the key beside the lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const BK = readFileSync(new URL('../app/backup.jsx', import.meta.url), 'utf8');

test('the screen READS the floor instead of restating it', () => {
  assert.match(BK, /const PASS_MIN = \d+/, 'PASS_MIN moved — re-anchor this test');
  assert.ok(!/Use at least 4 characters/.test(DASH),
    'the backup modal states a floor of 4 while enforcing 12 — the steward is told to type at least 4 and refused');
  const at = DASH.indexOf('const _min = (window.TrinityBackup');
  assert.notEqual(at, -1, 'the modal no longer reads TrinityBackup.PASS_MIN — it has gone back to restating the rule');
});

test('the button does not enable below the real floor', () => {
  assert.ok(!/disabled=\{busy \|\| done \|\| pass\.length < 4 \b/.test(DASH),
    'the Save button enables at 4 characters and then refuses — it must gate on PASS_MIN');
});

test('the all-digit rule is enforced where the steward can see it', () => {
  assert.match(DASH, /\^\\d\+\$.*pass\.length < 20|pass\.length < 20/,
    'checkPass rejects an all-numbers passphrase under 20 chars; the screen must say so before submit, not ' +
    'after — otherwise a 12-digit PIN passes the button and dies in a toast');
});

test('the steward is not told to store the passphrase with the file', () => {
  assert.ok(!/Store it with the file/.test(DASH),
    'the modal tells the steward to keep the passphrase alongside the encrypted church key. Under this ' +
    'product\'s threat model — seizure and lawful compulsion — that nullifies the encryption.');
});
