// THE STEWARD WHO CREATED THE EVENT MUST BE ABLE TO SEE IT.
// Run: node --test scripts/group-events-unseal.test.mjs
//
// Confirmed on the live console, 2026-08-28. A steward scheduled "SEAL CHECK — group event" in a group's
// window. It published correctly — the sealed envelope is on the relay — and the very window that posted it
// showed NOTHING: no title, no date, no place, no upcoming block. The member's phone showed it perfectly.
//
//     publishEvent            -> _sealChurchDoc(doc)          the event is sealed under the church name key
//     subscribeGroupEvents    -> JSON.parse(e.content)        the envelope parsed as if it were the event
//
// So every field came back undefined and the row rendered empty. Broken since c592abb, 15 Aug. The church
// CALENDAR reader beside it had already been fixed the same way and this one was missed, which is why
// members were rescued by accident: the merged calendar dedups against the reader that does unseal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const SRC = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const VEN = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const between = (from, to, src = SRC) => {
  const a = src.indexOf(from);
  assert.ok(a > 0, `re-anchor: could not find ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `re-anchor: could not find ${to} after it`);
  return src.slice(a, b);
};

test('the group-event reader unseals rather than bare-parsing', () => {
  const fn = stripComments(between('subscribeGroupEvents(groupId, onEvents)', 'oneose()'));
  assert.match(fn, /_openChurchDoc\(e\.content\)/,
    'the reader parses the sealed envelope as if it were the event, so the steward who created it sees an ' +
    'empty row while every member sees it fine');
  assert.doesNotMatch(fn, /JSON\.parse\(e\.content\)/,
    'it still bare-parses the content somewhere in this reader');
});

test('an event it cannot open is kept and marked, not dropped', () => {
  // Dropping it would silently shorten the list for anyone whose name key has not arrived yet — the same
  // failure the availability list already learned: leave the person alone, do not delete them.
  const fn = stripComments(between('subscribeGroupEvents(groupId, onEvents)', 'oneose()'));
  assert.match(fn, /c === null/, 'an unopenable event is not detected at all');
  assert.match(fn, /_locked: true/, 'an unopenable event is dropped rather than marked, so the list just gets shorter');
});

test('the church calendar reader still unseals too — it was already right', () => {
  const fn = stripComments(between('_subAddr(prefix, map, onItems)', 'subscribeRosters'));
  assert.match(fn, /_openChurchDoc\(e\.content\)/,
    'the calendar reader lost its unsealing — this is the one that was rescuing members by accident');
});

test('the shipped console bundle carries it', () => {
  assert.match(VEN, /_openChurchDoc/, 'vendor/steward.js predates this fix — run: bash scripts/build-steward.sh');
});
