// "I'M HERE TO HELP" MUST NOT SIT ON THE RELAY IN PLAIN TEXT.
// Run: node --test scripts/careavail-is-sealed.test.mjs
//
// Two documents, one feature, opposite treatment — found 2026-08-18 by reading the store directly:
//
//   carereq:   (asking for help)   NIP-44 sealed per recipient. The form's promise — "This goes privately to
//                                  your care team — no one else sees it" — was verified true: no plaintext
//                                  trace of the medical detail anywhere on the relay.
//   careavail: (offering help)     bare JSON. Readable on the relay's disk:
//                                    "I'm at home with a baby so I'm around in the day…"
//                                    "I am a district nurse so please do not ask me for anything clinical…"
//                                    "im 15, free after school, happy to babysit or come round"
//
// And the sheet that writes the second one carries no privacy line at all, while the first one leads with a
// promise. The unprotected half is also the publicly-listed half.
//
// Reads were already default-deny over the wire — an unauthenticated stranger gets zero events, measured — so
// this is exposure AT REST, which is the half that matters when the threat model is seizure. A free-text note
// naming a nurse, a mother alone with a baby, or a child is the PII carrier here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stripComments } from './test-slice.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const FEL = stripComments(readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8'));
const VEN = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const fnOf = (src, anchor, stop) => {
  const a = src.indexOf(anchor); if (a === -1) return '';
  const b = src.indexOf(stop, a + anchor.length);
  return src.slice(a, b === -1 ? a + 1200 : b);
};

test('the availability note is SEALED when published', () => {
  const fn = fnOf(FEL, 'async setCareAvail(', 'async clearCareAvail(');
  assert.ok(fn, 're-anchor: setCareAvail has moved');
  assert.doesNotMatch(fn, /content: JSON\.stringify\(\{ available/,
    'the availability document is still written as bare JSON — a member\'s free-text note about their ' +
    'circumstances then sits readable on the relay\'s disk');
  assert.match(fn, /_sealChurchDocMember\(/, 'it must be sealed under the church name key');
});

test('and UNSEALED when read, without blanking anyone whose key has not arrived', () => {
  const fn = fnOf(FEL, 'subscribeCareAvail(', 'async setCareAvail(');
  assert.ok(fn, 're-anchor: subscribeCareAvail has moved');
  assert.match(fn, /_openChurchDoc\(/, 'the reader must unseal (it tries cleartext first, so old docs open)');
  assert.match(fn, /o === null/,
    'a document sealed with a key we do not hold yet must leave that person alone, not delete them from ' +
    'the list — otherwise a newly admitted member watches helpers vanish');
});

test('a late-arriving name key re-opens these, like the calendar', () => {
  const decl = (FEL.match(/const CHURCH_SEALED_PFXS = \[([\s\S]*?)\];/) || [])[1] || '';
  assert.match(decl, /careavail/,
    'without this the "Ready to help" list stays empty for a newly admitted member until they restart');
});

test('the shipped bundle carries it', () => {
  assert.match(VEN, /_sealChurchDocMember/, 'rebuild: bash scripts/build-fellowship.sh');
});

// PROVE IT WOULD HAVE CAUGHT THE BUG, against the commit where the bug actually lived.
// Pinned to a SHA, not HEAD: once the fix is committed, HEAD contains it and a HEAD-relative check
// starts failing for the opposite of the reason it was written. The sha below is the last commit
// before this fix, so this assertion keeps meaning the same thing for ever.
test('the pre-fix source would have failed this', () => {
  let old = '';
  try { old = execFileSync('git', ['show', '38f04d3ee75402bf8f36dc74dc6ca990a603b4b0:src/fellowship.src.js'], { encoding: 'utf8', cwd: ROOT }); }
  catch (e) { return; }   // no git in the sabotage sandbox — skip rather than fail for an unrelated reason
  const fn = fnOf(stripComments(old), 'async setCareAvail(', 'async clearCareAvail(');
  assert.match(fn, /content: JSON\.stringify\(\{ available/,
    're-anchor: the shipped version already sealed this, so this test is not proving what it claims');
});
