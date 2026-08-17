// GETTING YOUR NAME BACK, GETTING BACK IN, AND NOT LEAVING BY ACCIDENT.
// Run: node --test scripts/rejoin-name-and-leaving.test.mjs
//
// Three defects a simulated congregation found on 2026-08-17, all on the path a member takes when something
// has gone wrong — which is the worst place for the app to be unhelpful.
//
// 1. A RESTORE DID NOT BRING BACK YOUR NAME. `trinityone.profile` was never in the backup set at all (checked
//    with `git log -S`: not a regression, an original omission). A member restored on a new phone, got their
//    journal, church, reading plan and streak back — and came back "Anonymous" to everyone at their church,
//    one tap after a screen promising "you come back as the same person — your church will know you".
//
//    The app DOES have a recovery path for this (_recoverOwnName reads the name back from the member's own
//    sealed copy on the relay) — and it needs the church name key, which the console had silently stopped
//    handing out. Two defects interlocking, which is why neither showed up alone.
//
// 2. YOU COULD NOT TYPE YOUR CHURCH'S NAME. Two separate problems, one after the other:
//      · the "joinable" character class had no apostrophe and no comma, so "St Aidan's, Netherby" left the
//        button dead grey with NO message. Saint names are possessive more often than not.
//      · and when the regex did pass, the normalisations disagreed: the console registers a church by
//        STRIPPING punctuation ("St Aidan's, Netherby" → "staidansnetherby") while this screen replaced
//        spaces with hyphens ("st-aidan's,-netherby"). They could never match.
//
// 3. LEAVING WAS TWO TAPS OF THE SAME SMALL BUTTON. `Leave` turned into `Confirm leave` in the same place, so
//    a careless double tap left the church outright — taking the member's children's accounts with it, with
//    no warning of either, and (because of 2) no way back in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const BACKUP = readFileSync(new URL('../app/backup.jsx', import.meta.url), 'utf8');
const CHURCH = readFileSync(new URL('../app/screens-church.jsx', import.meta.url), 'utf8');
const DASH   = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

test('a backup carries the member’s own name — and NOT the church directory', () => {
  const src = stripComments(BACKUP);
  assert.match(src, /const MEMBER_EXACT = \['trinityone\.profile'\]/,
    'the member’s own display name must be in the backup, or a restore comes back Anonymous');
  // THE TRAP. snapshot() matches by PREFIX, and `trinityone.profile` is a prefix of `trinityone.profiles` —
  // the cached directory of everyone else in the church, measured at 8.4 KB of names bolted to public keys.
  // Adding it to MEMBER_PREFIXES would put the congregation's roster into every member's backup file, in
  // whatever cloud folder they saved it to. That is a worse bug than the one being fixed.
  const prefixes = src.match(/const MEMBER_PREFIXES = \[([^\]]+)\]/)[1];
  assert.doesNotMatch(prefixes, /trinityone\.profile/,
    'as a PREFIX this also sweeps in trinityone.profiles — the whole church directory — so it must be exact');

  const snap = stripComments(fnBody(BACKUP, 'function snapshot(prefixes, exact) {'));
  assert.match(snap, /ex\.has\(k\)/, 'snapshot must honour the exact list');
  const rl = stripComments(fnBody(BACKUP, 'function restoreLocal(map, allow, exact) {'));
  assert.match(rl, /exSet\.has\(String\(k\)\)/,
    'and it must stay EXACT on import too — as a prefix, a crafted file could overwrite the member’s whole ' +
    'view of who is in their church');
});

test('a church can be found by the name the app actually shows', () => {
  const src = stripComments(CHURCH);
  const re = src.match(/const joinable = hasNpub \|\| (\/[^\n]+\/i)\.test/);
  assert.ok(re, 're-anchor: the joinable test has moved');
  const rx = new RegExp(re[1].slice(1, -2), 'i');
  for (const name of ["St Aidan's, Netherby", 'St Mary & All Saints', 'Grace Chapel']) {
    assert.ok(rx.test(name), `"${name}" must enable the button — it is a church's real name`);
  }
  assert.ok(!rx.test('a'), 'a single character is still not a church name');

  // …and the lookup must try the form the console REGISTERED.
  const resolve = stripComments(fnBody(CHURCH, 'const resolve = async (raw) => {'));
  assert.match(resolve, /replace\(\/\[\^a-z0-9\._-\]\+\/g, ''\)/,
    'steward.src.js builds a nice-name by stripping everything outside [a-z0-9._-]; this must try that form, ' +
    'or typing a church’s real name can never resolve');
  assert.match(resolve, /for \(const nice of/, 'try each form rather than betting on one');
});

test('leaving a church asks first, and says what goes', () => {
  const src = stripComments(CHURCH);
  assert.doesNotMatch(src, /Confirm leave/,
    'the in-place two-tap form is what let a careless member leave by tapping the same spot twice');
  assert.match(src, /role="dialog" aria-modal="true"/, 'it needs a real dialog, away from the finger');
  assert.match(src, /children’s accounts you look after here/,
    'name what actually goes — a member lost two child accounts and was not told');
  assert.match(src, /you’ll need the church’s invite link or code/,
    'and say how to come back BEFORE they leave, not after');
  assert.match(src, />Stay</, 'the safe choice must be a real button, not just dismissing the dialog');
});

test('the console catches up on enrolment when it is unlocked', () => {
  const kd = stripComments(DASH.slice(DASH.indexOf('function KeyDistributor()')));
  assert.match(kd.slice(0, 4000), /window\.addEventListener\('steward-key', onKey\)/,
    'the console auto-locks after 10 minutes idle and forgets the key, so envelopes published in that window ' +
    'are refused. Nothing in this effect’s dependencies changes on unlock, so it never ran again — measured ' +
    'at 33 admitted members and 4 name-key recipients, with the whole congregation showing as "Member"');
  assert.match(kd.slice(0, 4000), /nextTry\.current = \{\}; failCount\.current = \{\}/,
    'clear the backoff on unlock: those refusals were the lock, not the relay, and a returning steward must ' +
    'not wait out a penalty for an outage they caused by walking away');
  assert.match(kd, /unlockTick\]\);/, 'and the enrolment effect must actually depend on it');
});
