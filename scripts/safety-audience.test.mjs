// "I need help" must be readable by the people the steward chose — and must not vanish with one phone.
// Run: node --test scripts/safety-audience.test.mjs
//
// UX audit 2026-08-04, tranche 1 item 3. markSafe sealed every reply with _dmEncrypt(sk, check.by, body) —
// to the event SIGNER, one key. startSafetyCheck signs via feChurch, which signs with `sk`, i.e. the
// DELEGATE's own key in delegated mode. So when a delegated steward ran a roll-call, exactly one volunteer's
// browser could ever open "I need help": other stewards and the church owner could fetch the events and see
// nothing. The member was told "Only your church's leaders can see your reply" — plural.
//
// A safety roll-call is the feature where the phone the answers are locked to is the phone most likely to be
// lost. So: the steward now chooses the audience when starting the check, it travels WITH the check so the
// member's app seals to exactly that set, and the CHURCH KEY is always a reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FELLOW = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const STEW = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const MEALS = readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8');
const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');

test('a reply is never sealed to one phone alone', () => {
  const fn = fnBody(FELLOW, 'async markSafe', 'markSafe');
  assert.ok(!/_dmEncrypt\(sk,\s*check\.by,\s*body\)/.test(fn),
    'markSafe seals only to the check\'s starter again — with a delegated steward that is one volunteer\'s ' +
    'browser, and "I need help" is unreadable by the church');
  // The unconditional church key moved into _safeReaders when the audience resolution stopped swallowing
  // its own failures. It is asserted BEHAVIOURALLY in safety-audience-narrowing.test.mjs ("the church key is
  // unconditional"); this only checks markSafe still routes through the helper, because a source-text match
  // cannot tell a working reader list from a decorative one.
  assert.match(fn, /_safeReaders\(/,
    'markSafe builds its reader list inline again — that is where the swallowed audience lookup lived, and ' +
    'where a failure silently became a narrower send reported as delivered');
  assert.match(fn, /v:\s*2/, 'the multi-reader envelope is gone');
});

test('the steward chooses the audience, and it travels with the check', () => {
  const fn = fnBody(STEW, 'async startSafetyCheck', 'startSafetyCheck');
  assert.match(fn, /audience:\s*aud/,
    'the audience is not written into the check, so a member\'s app cannot know who to seal to');
  assert.match(fn, /audience === 'care'/, 'the audience is no longer validated against a fixed set');
  assert.match(MEALS, /startSafetyCheck\(msg, audience\)/, 'the console no longer passes the chosen audience');
  assert.match(MEALS, /Who can read the replies/, 'the steward is given no choice in the UI');
});

test('the console still reads replies written before this change', () => {
  const fn = fnBody(STEW, 'subscribeSafetyResponses', 'subscribeSafetyResponses');
  assert.match(fn, /env\.v === 2/, 'the console cannot read the multi-reader envelope');
  assert.match(fn, /payload = e\.content/,
    'v1 replies are no longer readable — a check already running when this shipped would lose its answers');
});

test('the member is told who will actually read it', () => {
  assert.ok(!/Only your church’s leaders can see your reply/.test(TODAY),
    'the member is still promised "leaders", plural, regardless of who can actually open the reply');
  assert.match(TODAY, /the people your church chose for this check/,
    'the member is not told the audience');
  assert.match(TODAY, /relay can see that you replied/,
    'the member is not told the relay sees THAT they replied — this product does not overclaim');
});
