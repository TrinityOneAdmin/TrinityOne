// THE .ics A CHURCH PUTS ON ITS WEBSITE MUST MEAN WHAT IT SAYS, AND THE SCANS OVER IT MUST BE ABLE TO SEE.
//   Run: node --test scripts/the-public-calendar-file-says-what-it-means.test.mjs
//
// scripts/public-calendar.mjs is the pure builder behind /public/<npub>/calendar.ics. Two findings from
// AUDIT-feeds-phase1-2026-09-22, both about the FILE rather than about who may read it:
//
//   F5 — a monthly meeting anchored mid-month emitted a DTSTART that is not an instance of its own RRULE.
//        `FREQ=MONTHLY;BYDAY=1TU` means "the first Tuesday of the month"; an elders' meeting anchored on
//        Tuesday 15 September took the 15th — the THIRD Tuesday — as DTSTART. RFC 5545 §3.8.5.3 says a
//        DTSTART not synchronised with the rule gives an undefined set, and Google/Apple render DTSTART as
//        an extra occurrence: the church's own website then advertised a meeting on a night the app's
//        expandEvents never shows. Asserted here as the PROPERTY ("DTSTART is the first <BYDAY> of its
//        month, and not before the anchor"), not as one memorised date, and across a year of anchors.
//
//   F6 — the "no hex pubkey reached the feed" scans in the two feed test files ran `includes()` over the RAW
//        file. Content lines fold at 75 OCTETS (RFC 5545 §3.1), so a 64-character key inside a long blurb is
//        split across a fold and the scan answered "not there" while it was there. The builder now exports
//        the inverse of its own fold, and this file measures that the unfolded scan catches what the naive
//        one misses. Both feed test files now scan through it.
//
// AND WHAT THE FEED DELIBERATELY DOES NOT DO, decided here rather than left implicit: it does not strip or
// refuse a 64-hex token in a steward's free text. The design's "names nobody" is about what the SOFTWARE
// puts in the file — no ATTENDEE, no ORGANIZER, no member key, no group id, and _webCopyBody carries only
// the seven noticeboard fields — not about censoring what a church chose to write on its own noticeboard.
// Silently mangling a steward's words would be the worse failure, and there is no path by which a member's
// key reaches a blurb except somebody typing it. What is asserted is that nothing the CONSOLE produces
// carries one, with a scan that can now actually see it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, unfoldIcs, publicEventFields, foldLine } from './public-calendar.mjs';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const lines = (text) => unfoldIcs(text).split('\r\n').filter(Boolean);
const prop = (text, name) => lines(text).filter(l => l.split(':')[0].split(';')[0] === name).map(l => l.slice(l.indexOf(':') + 1));
const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const dayOf = (compact) => new Date(Date.UTC(+compact.slice(0, 4), +compact.slice(4, 6) - 1, +compact.slice(6, 8))).getUTCDay();
// The first <day> of the month the compact date falls in — computed here, independently of the builder.
const firstSuchWeekdayOfMonth = (compact) => {
  const d = new Date(Date.UTC(+compact.slice(0, 4), +compact.slice(4, 6) - 1, 1));
  while (d.getUTCDay() !== dayOf(compact)) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};

test('F5: a monthly meeting\'s DTSTART is an instance of its own RRULE, whatever day of the month it was anchored on', () => {
  // Every anchor of a year, each one a Tuesday meeting: the audit's case is 2026-09-15 (a Tuesday anchored
  // on the third Tuesday), and the same shape hides on any anchor past the first <day> of its month.
  for (let m = 1; m <= 12; m++) {
    for (const dom of [1, 2, 6, 7, 15, 28]) {
      const date = `2026-${String(m).padStart(2, '0')}-${String(dom).padStart(2, '0')}`;
      const text = buildCalendar([{ id: 'elders', title: 'Elders', date, time: '19:00', recur: 'monthly', day: 2 }], { uidScope: 'x' });
      const start = prop(text, 'DTSTART')[0], rule = prop(text, 'RRULE')[0];
      assert.equal(rule, 'FREQ=MONTHLY;BYDAY=1TU', 'the rule changed for ' + date);
      const compact = start.slice(0, 8);
      assert.equal(BYDAY[dayOf(compact)], 'TU', `DTSTART ${start} for anchor ${date} is not even the right weekday`);
      assert.equal(compact, firstSuchWeekdayOfMonth(compact),
        `DTSTART ${start} (anchor ${date}) is NOT AN INSTANCE OF FREQ=MONTHLY;BYDAY=1TU — every subscriber's calendar shows a meeting on that date that the app itself never shows`);
      assert.ok(utc(compact.slice(0, 4) + '-' + compact.slice(4, 6) + '-' + compact.slice(6, 8)) >= utc(date),
        `DTSTART ${start} is BEFORE the anchor ${date} — the meeting starts before the steward said it does`);
      assert.equal(start.slice(8), 'T190000', 'the time was lost: ' + start);
    }
  }
});

test('F5: weekly and fortnightly are untouched — their DTSTART is still the first matching day on or after the anchor', () => {
  const weekly = buildCalendar([{ id: 'sun', title: 'Sunday service', date: '2026-09-02', time: '10:30', recur: 'weekly', day: 0 }], { uidScope: 'x' });
  assert.equal(prop(weekly, 'DTSTART')[0], '20260906T103000', 'a weekly meeting no longer starts on the first matching day after its anchor');
  assert.equal(prop(weekly, 'RRULE')[0], 'FREQ=WEEKLY;BYDAY=SU');
  const fort = buildCalendar([{ id: 'pray', title: 'Prayer', date: '2026-09-02', time: '20:00', recur: 'fortnightly', day: 4 }], { uidScope: 'x' });
  assert.equal(prop(fort, 'DTSTART')[0], '20260903T200000');
  assert.equal(prop(fort, 'RRULE')[0], 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH');
  const once = buildCalendar([{ id: 'fair', title: 'Fair', date: '2026-12-05' }], { uidScope: 'x' });
  assert.equal(prop(once, 'DTSTART')[0], '20261205', 'a one-off event moved');
  assert.deepEqual(prop(once, 'RRULE'), [], 'a one-off event grew a repeat rule');
});

test('F6: a 64-hex pubkey inside a long blurb is INVISIBLE to a raw scan and caught by the unfolded one', () => {
  const key = 'd'.repeat(64);
  const blurb = 'Ring the office before Thursday if you need a lift to this one, or message us at ' + key + ' for details.';
  const text = buildCalendar([{ id: 'lift', title: 'Lifts to the meeting', date: '2026-10-03', time: '19:30', blurb }], { uidScope: 'x' });
  assert.equal(text.includes(key), false,
    're-anchor: the key is NOT split by a fold in this fixture, so this row would no longer measure anything — lengthen the blurb');
  assert.equal(unfoldIcs(text).includes(key), true,
    'THE UNFOLDED SCAN STILL CANNOT SEE A KEY THAT IS IN THE FILE — every "no pubkey reached the feed" assertion in this repo is reading folded text');
  // and the round trip is exact, so unfolding cannot itself hide or invent anything
  const long = 'x'.repeat(200) + ' ünïcödé ' + 'y'.repeat(200);
  assert.equal(unfoldIcs(foldLine('DESCRIPTION:' + long)), 'DESCRIPTION:' + long, 'fold → unfold is not the identity');
  for (const line of buildCalendar([{ id: 'l', title: long, date: '2026-10-03' }], { uidScope: 'x' }).split('\r\n')) {
    assert.ok(Buffer.from(line, 'utf8').length <= 75, 'a content line is longer than 75 octets: ' + line.slice(0, 40));
  }
});

test('F6: what the builder itself puts in the file names nobody — measured through the unfolded text', () => {
  // The seven noticeboard fields go in. Anything else handed to the builder is dropped rather than trusted,
  // which is the claim this row measures rather than assumes.
  const member = 'e'.repeat(64);
  const text = unfoldIcs(buildCalendar([{
    id: 'supper', title: 'Harvest supper', date: '2026-10-03', time: '19:30', where: 'The hall', blurb: 'All welcome',
    groupId: 'grpyouth', creator: member, attendees: [member], image: 'data:image/jpeg;base64,AAAA', url: 'https://church.example/x',
  }], { name: 'Grace Church', uidScope: 'npub1scope' }));
  for (const forbidden of [member, 'grpyouth', 'ATTENDEE', 'ORGANIZER', 'data:image', 'https://church.example']) {
    assert.equal(text.includes(forbidden), false, 'the feed carries ' + forbidden);
  }
  assert.deepEqual(Object.keys(publicEventFields({ id: 'supper', date: '2026-10-03', groupId: 'g', creator: member })).sort(),
    ['blurb', 'date', 'day', 'id', 'recur', 'time', 'title', 'where'], 'publicEventFields admits a field beyond the noticeboard ones');
});
