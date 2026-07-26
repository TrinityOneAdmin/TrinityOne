// What the steward is told when a save is refused. Executes the REAL mapping out of app/stew-dashboard.jsx.
// Run: node --test scripts/publish-error-msg.test.mjs
//
// AUDIT 2026-07-25. The banner tested three substrings and picked one of two sentences, so:
//   • "invalid: a newer version of this is already stored" -> "check the connection and try again". The
//     connection is fine; retrying fails identically forever.
//   • ANY reason containing "blocked" -> "this relay is set up for a different church. Restore this church's
//     key in Settings." Restoring a key is destructive, and it was being suggested for unrelated causes.
// The reasons below are copied from the strings gateway.mjs actually sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const GATEWAY = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');

function realMapper() {
  const at = DASH.indexOf('function publishErrorMessage(');
  assert.notEqual(at, -1, 'publishErrorMessage is gone — the banner is guessing again');
  let depth = 0, end = -1;
  for (let i = DASH.indexOf('{', at); i < DASH.length; i++) {
    const c = DASH[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  return new Function(DASH.slice(at, end) + '; return publishErrorMessage;')();
}
const map = realMapper();

test('only a real membership refusal is diagnosed as the wrong church', () => {
  assert.equal(map('blocked: not a member or not permitted for this group').wrongChurch, true);
  // These must NOT suggest restoring the church key.
  for (const r of ['blocked: this event was deleted by its author',
                   'invalid: a newer version of this is already stored — reload and edit again',
                   'invalid: timestamp is too far in the future — check this device’s clock',
                   'invalid: signature failed']) {
    const m = map(r);
    assert.equal(m.wrongChurch, false, `"${r}" was diagnosed as wrong-church`);
    assert.doesNotMatch(m.msg, /Restore this church’s key/,
      `"${r}" tells the steward to restore their church key — a destructive action for an unrelated cause`);
  }
});

test('a lost newest-wins race does not tell the steward to check the connection', () => {
  const m = map('invalid: a newer version of this is already stored — reload and edit again');
  assert.doesNotMatch(m.msg, /check the connection/i, 'retrying can never fix this');
  assert.match(m.msg, /reload/i, 'the steward needs to know reloading is the way out');
  // Without a dedicated case this still falls through to the quoted-reason branch, which happens to contain
  // "reload" — so assert the plain-English version too, or deleting the case goes unnoticed.
  assert.doesNotMatch(m.msg, /^The relay refused/,
    'the steward is being handed the relay’s raw wording for a case common enough to deserve a sentence of its own');
  assert.match(m.msg, /Someone else saved/i, 'say plainly what happened: another device won the race');
});

test('a genuine connection failure keeps the connection message, and is the only one that auto-dismisses', () => {
  const m = map('');
  assert.match(m.msg, /check the connection/i);
  assert.equal(m.sticky, false, 'a transient failure may auto-dismiss');
  for (const r of ['blocked: not a member or not permitted for this group',
                   'invalid: a newer version of this is already stored',
                   'blocked: this event was deleted by its author']) {
    assert.equal(map(r).sticky, true, `"${r}" needs action, so it must not vanish after 9s`);
  }
});

test('an unrecognised refusal is quoted, never invented', () => {
  const m = map('invalid: some brand new rule');
  assert.match(m.msg, /some brand new rule/, 'the relay’s own words must reach the steward');
  assert.doesNotMatch(m.msg, /check the connection/i, 'do not assert a cause we do not know');
});

test('every refusal gateway.mjs can send maps to something specific', () => {
  // Guard against the relay gaining a new reason that silently falls back to "check the connection".
  const reasons = [...GATEWAY.matchAll(/'((?:invalid|blocked|restricted|rejected):[^']*)'/g)].map(m => m[1]);
  assert.ok(reasons.length >= 4, `expected the relay's refusal strings, found ${reasons.length}`);
  for (const r of reasons) {
    const m = map(r);
    assert.doesNotMatch(m.msg, /check the connection/i,
      `the relay sends "${r}" but the steward is told to check the connection — add a case for it`);
  }
});
