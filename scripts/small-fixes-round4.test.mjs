// FIVE SMALL DEFECTS, EACH OF WHICH COST A REAL MEMBER SOMETHING.
// Run: node --test scripts/small-fixes-round4.test.mjs
//
// From three sessions of a simulated congregation, all verified against the source by an independent pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const CHURCH = stripComments(readFileSync(new URL('../app/screens-church.jsx', import.meta.url), 'utf8'));
const TODAY  = stripComments(readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8'));
const READ   = stripComments(readFileSync(new URL('../app/screens-read.jsx', import.meta.url), 'utf8'));
const LIB    = stripComments(readFileSync(new URL('../app/screens-library.jsx', import.meta.url), 'utf8'));

test('M4 — a church with one member does not say "1 members"', () => {
  // Bridget, Lorna and Patrick each read it as an empty church. A pending member sees only themselves, so
  // the NUMBER is right; the word is not.
  assert.equal(/\{c\.members\}<\/b> members/.test(CHURCH), false,
    'the church card still hard-codes the plural');
});

test('C14 — "Nobody has listed themselves" does not deny the person reading it', () => {
  // Callum saw this directly above "You're ready to help — DIY · Moving · Rides". The list is deliberately
  // "who could help YOU", so the exclusion is right and only the wording is wrong.
  assert.equal(/Nobody has listed themselves as available yet/.test(TODAY), false,
    'the empty-state still says nobody, to somebody who has just listed themselves');
});

test('B3 — the highlight colours are named', () => {
  // Marta could not highlight at all: five unnamed circles with nothing to choose between them. The names
  // already exist as ids; they were simply never surfaced.
  const i = READ.indexOf('HL_COLORS.map');
  assert.ok(i > 0, 'highlight swatches not found');
  const block = READ.slice(i, i + 420);
  assert.match(block, /aria-label|title=/,
    'the swatches carry no name of any kind, so neither a screen reader nor a person can tell them apart');
});

test('V1 — the notes panel New note does not throw', () => {
  // `sel` is not in scope in CommentaryPanel; pressing New note threw a ReferenceError. Found by review,
  // never reported by a member — because nobody got that far.
  const i = READ.indexOf('function CommentaryPanel');
  const fn = READ.slice(i, READ.indexOf('\nfunction ', i + 10));
  assert.equal(/setCVerse\(String\(\(sel \|\| 1\)\)\)/.test(fn), false,
    'CommentaryPanel still references `sel`, which is not in its scope');
});

test('V2 — "Removed" is not claimed over a removal that cannot happen', () => {
  // removeModule cannot remove a commentary, yet the UI toasts "Removed". Same family as every other
  // control in this programme that reported success over nothing.
  // The real mechanism, sharper than filed: removeModule is `async`, so `if (removeModule(...))` tested a
  // PROMISE — always truthy — and the success toast fired whatever the removal returned.
  const i = LIB.indexOf('const remove = ');
  assert.ok(i > 0, 'remove handler not found');
  const fn = LIB.slice(i, i + 620);
  assert.equal(/if \(window\.Bible\.removeModule\(/.test(fn), false,
    'the removal result is still used as a synchronous boolean, so it is a Promise and always truthy');
  assert.match(fn, /await window\.Bible\.removeModule/,
    'removeModule is async and must be awaited before its result is believed');
});

test('the Care card is mounted on Today, and shows the ask even with no open needs', () => {
  // Owner's decision 2026-08-23: "Only on the today screen when Care is switched on."
  //
  // CareCard already had a Today variant and it was DEAD CODE — mounted in exactly one place
  // (screens-serving.jsx, `embedded`), the other branch commented "Today-card variant (currently unused)".
  // Three members failed to find Care; all three read Today first. Verity, 71, with a broken wrist:
  // "I'd never have thought to look for it under Serving & events. If I'd needed help badly I'd have
  // telephoned Miriam."
  //
  // The old branch returned null on `!live.length`, which would have hidden it in exactly her situation:
  // nobody had asked yet, and she was the one needing to ask.
  assert.match(TODAY, /<CareCard ctx=\{ctx\} \/>/,
    'the Today variant of CareCard is still not mounted anywhere');
  const i = TODAY.indexOf('function CareCard');
  const fn = TODAY.slice(i, TODAY.indexOf('\n// Emergency', i));
  assert.equal(/if \(!live\.length\) return null;/.test(fn), false,
    'the Today card still hides itself when nobody has asked for help yet — the one moment somebody needs ' +
    'to ask');
  assert.match(fn, /if \(!s\.enabled\) return null;/,
    'it must still stay hidden for a church that has not switched care on');
});

test('M1 — Today says you are waiting for approval', () => {
  // Six members across four rounds looked at Today first and saw a normal, working app. The waiting page
  // itself is praised by everyone who reaches it — it just lives on one tab out of five.
  // Bridget, 74: "at a glance I'd have believed I was already in." Eunice put the tablet down.
  assert.match(TODAY, /joinState && ctx\.joinState\.isPending/,
    'Today never reads the pending state');
  assert.match(TODAY, /Waiting to be let in/,
    'Today does not say you are waiting');
});

test('C17 — the RSVP row states your answer and marks the pressed button', () => {
  const SERV = stripComments(readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8'));
  const i = SERV.indexOf('function svEventRsvpRow');
  // Slice to the function's end, not a fixed byte count — the explanatory comment pushed
  // aria-pressed past 1600 chars and the assertion failed on window size, not on the code.
  const fn = SERV.slice(i, SERV.indexOf('\nfunction ', i + 10));
  assert.match(fn, /aria-pressed=\{on\}/, 'the chosen button is not marked as pressed');
  assert.match(fn, /You’re going|You're going/, 'your answer is still never stated in words');
});
