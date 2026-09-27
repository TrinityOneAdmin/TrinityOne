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

// REWRITTEN 2026-09-26, and the old assertions are the reason. This row used to require the sentence to say
// "Someone else saved" and to point at RELOADING as the way out. Both were wrong, and the second sent the
// steward round a loop with no exit: the relay keeps whichever copy carries the later created_at, and that
// date is DERIVED, so a reload produces the same losing one. Measured against a real gateway while stage 4
// of the relay-corrected-time work was being audited — a console writes uncorrected, restarts, measures
// +601s, writes the correction, and is answered "a newer version of this is already stored" for ever until
// real time catches up. The row now holds the true version of the same claim.
test('a lost newest-wins race names both causes and does not send the steward round a loop', () => {
  const m = map('invalid: a newer version of this is already stored — reload and edit again');
  assert.doesNotMatch(m.msg, /check the connection/i, 'retrying can never fix this');
  // Without a dedicated case this falls through to the quoted-reason branch, so assert the plain-English
  // version too, or deleting the case goes unnoticed.
  assert.doesNotMatch(m.msg, /^The relay refused/,
    'the steward is being handed the relay’s raw wording for a case common enough to deserve a sentence of its own');
  assert.match(m.msg, /another console saved/i,
    'one of the two causes is another console winning the race, and the sentence must still say so');
  assert.match(m.msg, /clock running ahead|this console’s own/i,
    'THE COMMONER CAUSE IS MISSING. A copy stamped from a clock that was ahead — including this console’s ' +
    'own, before the relay-clock correction landed — beats the corrected write that follows. Telling the ' +
    'steward it must have been somebody else sends them looking for a colleague who did nothing.');
  assert.doesNotMatch(m.msg, /Reloading (the page )?(will|can) help|Reload the page and make your change again/i,
    'the banner still offers reloading as the way out. The stamp is derived, not typed, so a reload writes ' +
    'the same losing date — this is the loop the 2026-09-26 audit measured.');
  assert.match(m.msg, /fifteen minutes|15 minutes/i,
    'the one thing the steward can act on is missing: the stored copy stops winning once real time passes ' +
    'the date it carries, and put() in scripts/event-store.mjs bounds that at 900s. Without the bound the ' +
    'sentence is a refusal with no way forward.');
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

// A DELEGATED STEWARD IS NEVER TOLD TO RESTORE THE CHURCH KEY.
//
// 2026-09-07, found on a real delegated console the moment the discovery fix let one in: the sticky banner
// "this relay is set up for a different church. Restore this church's key in Settings" sat on EVERY tab
// while that console was reading and acting through the very relay it was calling somebody else's. The
// refused writes were carekey: (no care grant) and groupkey:, both while properly authenticated.
//
// "not a member or not permitted" is the relay's answer to a CAPABILITY refusal as well as to a wrong
// church. A delegate signs with their own key by design and never holds the church key, so a key mismatch
// is not a diagnosis that can apply to them — and restoring a church key would replace the church identity
// on their device. Same rule as the kind-10002 carve-out: only a refusal that could ONLY mean a key
// mismatch may raise that alarm.
test('a delegated steward is told what happened, never to restore the church key', () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prev = globalThis.window;
  try {
    globalThis.window = { Steward: { actingChurch: '53998834c6ce59bc5d08a52ebaa82e905d5d187b6fbad0ebc5b131be1e5dede0' } };
    const m = map('blocked: not a member or not permitted for this group');
    assert.equal(m.wrongChurch, false,
      'a delegated steward’s capability refusal was diagnosed as the wrong church key');
    assert.doesNotMatch(m.msg, /Restore this church’s key/,
      'the banner told a DELEGATED steward to restore the church key — they do not hold one, and doing it ' +
      'would replace the church identity on their device');
    assert.match(m.msg, /hasn’t been given to you/, 'the delegate is not told what actually happened');
    assert.equal(m.sticky, true, 'a refused save must not vanish on its own');

    // …and the owner still raises the alarm — that is what reveals the registration panel AND arms the
    // forced retry in useRegistrationRetry(). What CHANGED on 2026-09-08 is the advice. This reason covers
    // "wrong key" AND "this relay does not carry this church", and the second is what a relay reset or a
    // restore without church.json produces. Restoring a church key is destructive and irreversible and
    // cannot fix that, so it is no longer the instruction — it is a parenthetical, and the steward is sent
    // to the control that resolves both.
    globalThis.window = { Steward: { actingChurch: '' } };
    const owner = map('blocked: not a member or not permitted for this group');
    assert.equal(owner.wrongChurch, true,
      'an OWNER console lost the genuine wrong-church diagnosis — that alarm still has to fire');
    assert.doesNotMatch(owner.msg, /Restore this church’s key/,
      'the owner is told to restore the church key again. That is destructive, irreversible, and cannot fix ' +
      'the likelier cause of this refusal (the relay does not carry this church).');
    assert.match(owner.msg, /A relay is refusing our posts/,
      'the owner is not pointed at the control that actually fixes this');
  } finally {
    if (had) globalThis.window = prev; else delete globalThis.window;
  }
});
