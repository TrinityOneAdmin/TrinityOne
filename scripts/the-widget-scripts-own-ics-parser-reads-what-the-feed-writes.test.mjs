// THE WIDGET'S PARSER READS EXACTLY WHAT scripts/public-calendar.mjs's buildCalendar() WRITES.
//   Run: node --test scripts/the-widget-scripts-own-ics-parser-reads-what-the-feed-writes.test.mjs
//
// scripts/public-widget.mjs exports parseIcs and expandOccurrences as plain, directly-testable functions,
// and buildWidgetScript() serialises those SAME function objects with .toString() into the script the relay
// serves (proved by scripts/the-widget-script-is-served-only-when-the-calendar-is-shared.test.mjs, which
// checks the served bytes are the IIFE this file builds). So importing and calling them here is testing the
// shipped parser, not a mirror of it (memory: tests-must-drive-shipped-code).
//
// Fixtures are built with the REAL buildCalendar(), not hand-written iCalendar text, so a change to either
// side of the seam is caught by whichever test runs first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar } from './public-calendar.mjs';
import { parseIcs, expandOccurrences, unescapeIcsText, recurLabel, weekdayAbbrev, dayMonthLabel, buildWidgetScript } from './public-widget.mjs';

test('a timed one-off, an all-day one-off, and a weekly meeting all round-trip through the parser', () => {
  const ics = buildCalendar([
    { id: 'supper', title: 'Harvest supper, all welcome', date: '2026-10-03', time: '19:30', where: 'The church hall', blurb: 'Bring a dish; drinks provided.' },
    { id: 'fair', title: 'Christmas fair', date: '2026-12-05' },
    { id: 'sun', title: 'Sunday service', date: '2026-09-06', time: '10:30', where: 'St Aidan’s', recur: 'weekly', day: 0 },
  ], { name: 'Grace Church', uidScope: 'npub1x' });
  const parsed = parseIcs(ics);
  assert.equal(parsed.calname, 'Grace Church', 're-anchor: X-WR-CALNAME did not round-trip');
  assert.equal(parsed.events.length, 3);
  const byUid = Object.fromEntries(parsed.events.map(e => [e.uid, e]));
  const supper = byUid['trinityone-supper@npub1x'];
  assert.equal(supper.summary, 'Harvest supper, all welcome');
  assert.equal(supper.location, 'The church hall');
  assert.equal(supper.description, 'Bring a dish; drinks provided.');
  assert.deepEqual(supper.dtstart, { date: '2026-10-03', time: '19:30', allDay: false });
  assert.equal(supper.rrule, undefined);
  const fair = byUid['trinityone-fair@npub1x'];
  assert.deepEqual(fair.dtstart, { date: '2026-12-05', time: null, allDay: true }, 'an all-day (VALUE=DATE) event was read as timed');
  const sun = byUid['trinityone-sun@npub1x'];
  assert.deepEqual(sun.rrule, { freq: 'WEEKLY', interval: 1, byday: 'SU' });
  assert.deepEqual(sun.dtstart, { date: '2026-09-06', time: '10:30', allDay: false });
});

test('a fortnightly and a monthly RRULE are read with the right interval and weekday', () => {
  const ics = buildCalendar([
    { id: 'youth', title: 'Youth night', date: '2026-09-02', time: '19:00', recur: 'fortnightly', day: 4 },
    { id: 'pcc', title: 'PCC meeting', date: '2026-09-15', time: '19:30', recur: 'monthly', day: 2 },
  ], { uidScope: 'x' });
  const parsed = parseIcs(ics);
  const [youth, pcc] = parsed.events;
  assert.deepEqual(youth.rrule, { freq: 'WEEKLY', interval: 2, byday: 'TH' });
  assert.deepEqual(pcc.rrule, { freq: 'MONTHLY', interval: 1, byday: 'TU' });
});

test('a long DESCRIPTION that folds across content lines still parses as one unfolded value', () => {
  const long = 'Please arrive fifteen minutes early so we can start on time and set out the chairs before everyone gets here.'.repeat(2);
  const ics = buildCalendar([{ id: 'e', title: 'Long note', date: '2026-10-03', time: '19:00', blurb: long }], { uidScope: 'x' });
  assert.match(ics, /\r\n /, 're-anchor: this fixture no longer folds — lengthen the blurb');
  const parsed = parseIcs(ics);
  assert.equal(parsed.events[0].description, long, 'a folded DESCRIPTION was not read back whole');
});

test('escaped commas, semicolons and newlines in SUMMARY/DESCRIPTION are unescaped, not left literal', () => {
  assert.equal(unescapeIcsText('Bring a dish\\, or just yourself\\; either is fine'), 'Bring a dish, or just yourself; either is fine');
  assert.equal(unescapeIcsText('Line one\\nLine two'), 'Line one\nLine two');
  const ics = buildCalendar([{ id: 'e', title: 'A, B; C', date: '2026-10-03', blurb: 'line1\nline2' }], { uidScope: 'x' });
  const parsed = parseIcs(ics);
  assert.equal(parsed.events[0].summary, 'A, B; C');
  assert.equal(parsed.events[0].description, 'line1\nline2');
});

test('garbage before any BEGIN:VEVENT, and an unterminated VEVENT, do not throw', () => {
  assert.doesNotThrow(() => parseIcs('not an ics file at all'));
  assert.deepEqual(parseIcs('').events, []);
  assert.deepEqual(parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Unclosed\r\n').events, [], 'an unterminated VEVENT was still admitted');
});

test('expandOccurrences: a weekly series produces one row per week inside the window, ordered', () => {
  const parsed = parseIcs(buildCalendar([{ id: 'sun', title: 'Sunday service', date: '2026-09-06', time: '10:30', recur: 'weekly', day: 0 }], { uidScope: 'x' }));
  const occs = expandOccurrences(parsed.events, { from: '2026-09-01', until: '2026-09-30', limit: 0 });
  assert.deepEqual(occs.map(o => o.date), ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
  assert.equal(recurLabel(occs[0].recur), 'Weekly');
});

test('expandOccurrences: fortnightly steps by 14 days from DTSTART, monthly re-derives the first weekday of each month', () => {
  const parsed = parseIcs(buildCalendar([
    { id: 'youth', title: 'Youth night', date: '2026-09-03', time: '19:00', recur: 'fortnightly', day: 4 },
    { id: 'pcc', title: 'PCC meeting', date: '2026-09-15', time: '19:30', recur: 'monthly', day: 2 },
  ], { uidScope: 'x' }));
  const youth = expandOccurrences(parsed.events.filter(e => e.uid.includes('youth')), { from: '2026-09-01', until: '2026-10-31', limit: 0 });
  assert.deepEqual(youth.map(o => o.date), ['2026-09-03', '2026-09-17', '2026-10-01', '2026-10-15', '2026-10-29']);
  const pcc = expandOccurrences(parsed.events.filter(e => e.uid.includes('pcc')), { from: '2026-09-01', until: '2026-11-30', limit: 0 });
  assert.deepEqual(pcc.map(o => o.date), ['2026-10-06', '2026-11-03'], 're-anchor: the monthly walk should skip the anchor’s own month (it starts after `from`) and land on the first Tuesday of each later one');
});

test('expandOccurrences: a one-off outside [from, until] is dropped; `limit` caps the combined, sorted list', () => {
  const parsed = parseIcs(buildCalendar([
    { id: 'past', title: 'Past', date: '2026-01-01' },
    { id: 'sun', title: 'Sunday service', date: '2026-09-06', time: '10:30', recur: 'weekly', day: 0 },
    { id: 'fair', title: 'Fair', date: '2026-10-10' },
  ], { uidScope: 'x' }));
  const occs = expandOccurrences(parsed.events, { from: '2026-09-01', until: '2026-12-31', limit: 3 });
  assert.equal(occs.length, 3, 'the limit was not applied');
  assert.deepEqual(occs.map(o => o.date), [...occs.map(o => o.date)].sort(), 'the combined list is not sorted');
  assert.equal(occs.some(o => o.summary === 'Past'), false, 'an event before `from` was included');
});

test('weekdayAbbrev and dayMonthLabel read the date, not the clock the test runs on', () => {
  assert.equal(weekdayAbbrev('2026-10-03'), 'Sat');
  assert.equal(dayMonthLabel('2026-10-03'), '3 Oct');
});

test('the shipped script embeds these exact functions — re-anchor if the build stops matching what this file tests', () => {
  const script = buildWidgetScript();
  for (const name of ['function parseIcs', 'function expandOccurrences', 'function unescapeIcsText']) {
    assert.ok(script.includes(name), 're-anchor: ' + name + ' is no longer in the built widget script');
  }
});
