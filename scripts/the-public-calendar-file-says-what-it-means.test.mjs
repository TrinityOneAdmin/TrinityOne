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
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { buildCalendar, unfoldIcs, publicEventFields, foldLine } from './public-calendar.mjs';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ── THE APP'S OWN EXPANSION, EXECUTED, NOT TRANSCRIBED ───────────────────────────────────────────────────
// The feed and the app must name the same night, and the only way to be sure is to RUN the app's expansion
// rather than re-derive it here: a transcription of expandEvents is a second copy of the rule that can drift,
// and the audit that found the fortnightly defect flagged its own transcription as the one place its number
// could be wrong. app/recur.jsx is a browser IIFE with no exports (it assigns window.expandEvents and is
// loaded by index.html/steward.html through <script type="text/babel">), so it is transpiled and executed
// here with a `window` of our own. scripts/public-calendar.mjs deliberately does NOT import it — the .jsx is
// dropped from the payload every desktop relay ships (build-strict-tgz.sh transpiles app/*.jsx to app/*.js),
// so the rule is written twice and THIS FILE is what holds the two together.
const RECUR_SRC = readFileSync(new URL('../app/recur.jsx', import.meta.url), 'utf8');
assert.match(RECUR_SRC, /const weeks = Math\.round\(\(cur - anchor\) \/ \(7 \* 864e5\)\)/,
  'app/recur.jsx no longer applies the fortnightly phase correction this sweep exists to hold the feed to — re-anchor rather than delete');
const expandEvents = (() => {
  const js = transformSync(RECUR_SRC, { loader: 'jsx', jsx: 'transform' }).code;
  const win = {};
  new Function('window', js)(win);
  assert.equal(typeof win.expandEvents, 'function', 'app/recur.jsx did not define expandEvents — the lift is reading nothing');
  return win.expandEvents;
})();
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

test('F5/R2: weekly starts on the first matching day after its anchor; fortnightly stays IN PHASE with it', () => {
  const weekly = buildCalendar([{ id: 'sun', title: 'Sunday service', date: '2026-09-02', time: '10:30', recur: 'weekly', day: 0 }], { uidScope: 'x' });
  assert.equal(prop(weekly, 'DTSTART')[0], '20260906T103000', 'a weekly meeting no longer starts on the first matching day after its anchor');
  assert.equal(prop(weekly, 'RRULE')[0], 'FREQ=WEEKLY;BYDAY=SU');
  // Thursday is ONE day after this Wednesday anchor: an even number of weeks, so the fortnightly series
  // starts in the anchor's own week. This is one of the 4 of 7 offsets that were always right, and it is
  // named as such because it was the ONLY fortnightly fixture in this file while the other 3 were wrong.
  const fort = buildCalendar([{ id: 'pray', title: 'Prayer', date: '2026-09-02', time: '20:00', recur: 'fortnightly', day: 4 }], { uidScope: 'x' });
  assert.equal(prop(fort, 'DTSTART')[0], '20260903T200000');
  assert.equal(prop(fort, 'RRULE')[0], 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH');
  // …and a Sunday is FOUR days after it, which rounds to one week, so the app's series runs a week later and
  // so must the feed. Before the fix this said 20260906 — the church's site a fortnight out of step for ever.
  const off = buildCalendar([{ id: 'pray2', title: 'Prayer', date: '2026-09-02', time: '20:00', recur: 'fortnightly', day: 0 }], { uidScope: 'x' });
  assert.equal(prop(off, 'DTSTART')[0], '20260913T200000',
    'A FORTNIGHTLY MEETING IS ADVERTISED A WEEK OUT OF PHASE with the church\'s own app');
  assert.equal(expandEvents([{ id: 'pray2', date: '2026-09-02', time: '20:00', recur: 'fortnightly', day: 0 }], '2026-09-02', 70)[0].date, '2026-09-13',
    're-anchor: the app itself no longer starts this series where this row says it does');
  const once = buildCalendar([{ id: 'fair', title: 'Fair', date: '2026-12-05' }], { uidScope: 'x' });
  assert.equal(prop(once, 'DTSTART')[0], '20261205', 'a one-off event moved');
  assert.deepEqual(prop(once, 'RRULE'), [], 'a one-off event grew a repeat rule');
});

// ── THE SWEEP: the church's website and the church's own app must name the same night ────────────────────
// AUDIT-feeds-round2-2026-09-22 R2. `firstOccurrence` took the first `day` on or after the anchor for
// fortnightly too, but expandEvents then pulls that a week forward when it lands an odd number of weeks from
// the anchor (offsets of 4, 5 and 6 days — 3 of the 7 weekdays), and INTERVAL=2 carries the error through the
// whole series for ever. Measured on the tip that added a comment claiming the two agreed: 7671 of 17899
// anchors, 42.9%, with weekly 0 and monthly 0 as controls.
//
// A single memorised date could not have caught it — the fixture the F5 row below pins happens to be one of
// the 4 of 7 offsets that agree. So this is a property over EVERY anchor of seven years and EVERY weekday,
// and the controls are in the same loop: if the reader or the lift breaks, weekly and monthly go red too.
const YEARS = [2024, 2025, 2026, 2027, 2028, 2029, 2030];
const anchors = (() => {
  const out = [];
  for (const y of YEARS) for (let m = 1; m <= 12; m++) {
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let dom = 1; dom <= dim; dom++) out.push(`${y}-${String(m).padStart(2, '0')}-${String(dom).padStart(2, '0')}`);
  }
  return out;
})();

for (const recur of ['weekly', 'fortnightly', 'monthly']) {
  test(`R2: a ${recur} meeting starts on the same night the app shows — every anchor of ${YEARS.length} years × every weekday`, () => {
    let cases = 0, bad = 0, first = '';
    for (const date of anchors) {
      for (let day = 0; day <= 6; day++) {
        const ev = { id: 'meeting', title: 'Meeting', date, time: '19:30', recur, day };
        const text = buildCalendar([ev], { uidScope: 'x' });
        const compact = prop(text, 'DTSTART')[0].slice(0, 8);
        const feed = compact.slice(0, 4) + '-' + compact.slice(4, 6) + '-' + compact.slice(6, 8);
        // 70 days is enough to hold the first occurrence of any of the three rules (the furthest is a monthly
        // whose first matching weekday falls at the end of the following month).
        const app = expandEvents([ev], date, 70)[0];
        cases++;
        if (!app || app.date !== feed) {
          bad++;
          if (!first) first = `anchor ${date} day ${day}: the feed's DTSTART is ${feed}, the app's own first occurrence is ${app ? app.date : '(none)'} — the church's website advertises a night the app never shows`;
        }
        // …and DTSTART must be an instance of its own RRULE (RFC 5545 §3.8.5.3), or Google and Apple render
        // it as an extra occurrence on top of the series.
        assert.equal(BYDAY[dayOf(compact)], BYDAY[day], `DTSTART ${compact} (anchor ${date}, ${recur}) is not even the right weekday`);
        if (recur === 'monthly') assert.equal(compact, firstSuchWeekdayOfMonth(compact), `DTSTART ${compact} (anchor ${date}) is not the first ${BYDAY[day]} of its month`);
        assert.ok(utc(feed) >= utc(date), `DTSTART ${compact} is before the anchor ${date}`);
      }
    }
    assert.equal(cases, anchors.length * 7, 're-anchor: the sweep stopped covering what it says it covers');
    assert.equal(bad, 0, `${bad} of ${cases} anchors DISAGREE WITH THE APP. e.g. ${first}`);
  });
}

test('R3: a series whose `day` is not an integer 0-6 still starts on an instance of its own rule', () => {
  // publicEventFields NULLS `day` for anything that is not an integer 0-6, and src/steward.src.js publishEvent
  // is where that null is minted. rrule() always fell back to the anchor's own weekday; the DTSTART did not,
  // so BYDAY named one night and DTSTART another for 281 of 365 monthly anchors. Neither shipped dialog can
  // produce it (both hold `day` as a number) — which is why the file was green over it. The sweep above runs
  // only integers, so the null class is asserted HERE, for all three recurrences.
  for (const day of [undefined, null, '2', 2.5, 7, -1, NaN, {}]) {
    for (const recur of ['weekly', 'fortnightly', 'monthly']) {
      const ev = { id: 'elders', title: 'Elders', date: '2026-09-15', time: '19:30', recur, day };
      assert.equal(publicEventFields(ev).day, null, 're-anchor: publicEventFields now admits ' + JSON.stringify(day));
      const text = buildCalendar([ev], { uidScope: 'x' });
      const compact = prop(text, 'DTSTART')[0].slice(0, 8);
      // 2026-09-15 is a Tuesday, so the fallback weekday is Tuesday for every one of these.
      assert.equal(prop(text, 'RRULE')[0].endsWith('TU'), true, 'the rule stopped falling back to the anchor\'s weekday');
      assert.equal(BYDAY[dayOf(compact)], 'TU', `day=${JSON.stringify(day)} ${recur}: DTSTART ${compact} is not on the weekday its own BYDAY names`);
      if (recur === 'monthly') assert.equal(compact, firstSuchWeekdayOfMonth(compact),
        `day=${JSON.stringify(day)}: DTSTART ${compact} IS NOT AN INSTANCE OF FREQ=MONTHLY;BYDAY=1TU — the website shows a meeting the app never does`);
      assert.ok(utc(compact.slice(0, 4) + '-' + compact.slice(4, 6) + '-' + compact.slice(6, 8)) >= utc('2026-09-15'), 'DTSTART is before the anchor');
    }
  }
  // CONTROL: a real `day` is still honoured and is NOT the anchor's weekday here (2026-09-15 is a Tuesday).
  const ctl = buildCalendar([{ id: 'e', title: 'E', date: '2026-09-15', time: '19:30', recur: 'monthly', day: 5 }], { uidScope: 'x' });
  assert.equal(prop(ctl, 'RRULE')[0], 'FREQ=MONTHLY;BYDAY=1FR');
  assert.equal(prop(ctl, 'DTSTART')[0], '20261002T193000');
});

test('R7: an ISO-shaped date that is not a calendar date is dropped, not normalised into another month', () => {
  // `2026-02-31` matched ISO_DATE and Date.UTC turned it into 3 March. For a Sunday or Monday series both
  // candidates then fell before it and the "// unreachable" fallback fired, emitting DTSTART:20260231T193000
  // — a string no calendar can read, and a REGRESSION on the pre-F5 builder, which emitted a real date.
  for (const date of ['2026-02-31', '2026-02-30', '2026-02-29', '2026-04-31', '2026-06-31', '2026-13-01', '2026-00-10', '2026-01-32', '2026-01-00', '0026-01-01']) {
    assert.equal(publicEventFields({ id: 'e', date }), null, date + ' is still admitted as a date');
    for (let day = 0; day <= 6; day++) {
      const text = buildCalendar([{ id: 'e', title: 'E', date, time: '19:30', recur: 'monthly', day }], { uidScope: 'x' });
      assert.deepEqual(prop(text, 'DTSTART'), [], `anchor ${date} day ${day} still reaches the feed as ${prop(text, 'DTSTART')[0]}`);
    }
  }
  // CONTROL: the leap day that DOES exist is admitted, and so is the last day of a 31-day month.
  assert.ok(publicEventFields({ id: 'e', date: '2024-02-29' }), '29 February 2024 was dropped — the range check is too tight');
  assert.ok(publicEventFields({ id: 'e', date: '2026-01-31' }), '31 January was dropped');
  // …and the "unreachable" fallback is now genuinely unreachable: over every valid anchor of 2026 × every
  // weekday, no monthly DTSTART is the anchor unless the anchor really is the first such weekday of its month.
  let fired = 0;
  for (const date of anchors.filter(d => d.startsWith('2026-'))) {
    for (let day = 0; day <= 6; day++) {
      const c = prop(buildCalendar([{ id: 'e', title: 'E', date, time: '19:30', recur: 'monthly', day }], { uidScope: 'x' }), 'DTSTART')[0].slice(0, 8);
      if (c === date.replace(/-/g, '') && c !== firstSuchWeekdayOfMonth(c)) fired++;
    }
  }
  assert.equal(fired, 0, 'the fallback that calls itself unreachable fired ' + fired + ' times');
});

test('F3: a series that steps past 9999-12-31 is dropped, not written as an expanded-year DTSTART', () => {
  // AUDIT-feeds-round3-2026-09-22 F3. isoParts() range-checks the ANCHOR; nothing range-checked the date the
  // occurrence walks STEP TO. An anchor in the last week of 9999 steps into the year 10000, where Date's
  // toISOString() switches to ISO 8601's expanded-year form (`+010000-01-01T…`), and `.slice(0, 10)` plus
  // `.replace(/-/g, '')` made `DTSTART:+01000001T193000` — a string no calendar can read. Measured against
  // the builder at 6c38421: 50 of 126 hostile rows, every one of them admitted and emitted.
  let emitted = 0, malformed = [], dropped = 0;
  for (const date of ['9999-12-24', '9999-12-25', '9999-12-26', '9999-12-27', '9999-12-28', '9999-12-29', '9999-12-30', '9999-12-31']) {
    for (const recur of ['weekly', 'fortnightly', 'monthly']) {
      for (let day = 0; day <= 6; day++) {
        const text = buildCalendar([{ id: 'e', title: 'E', date, time: '19:30', recur, day }], { uidScope: 'x' });
        const dt = prop(text, 'DTSTART');
        if (!text.includes('BEGIN:VEVENT')) { dropped++; assert.deepEqual(dt, [], 'a dropped event still wrote a DTSTART'); continue; }
        emitted++;
        if (!/^\d{8}(T\d{6})?$/.test(dt[0])) malformed.push(`${date} ${recur} day ${day} -> ${dt[0]}`);
      }
    }
  }
  assert.deepEqual(malformed, [],
    `A SERIES STEPPING OFF THE END OF THE CALENDAR IS ON A CHURCH'S PUBLIC FEED as a date no calendar can read: ${malformed.length} of ${emitted + dropped} rows, e.g. ${malformed.slice(0, 3).join(' | ')}`);
  assert.ok(dropped > 0, 're-anchor: none of these anchors steps past the end of the calendar any more, so this row measures nothing');
  // …and it is dropped WHOLE. Half a VEVENT is worse than none: a subscriber's parser would take the next
  // event's fields as this one's.
  const one = buildCalendar([{ id: 'e', title: 'E', date: '9999-12-31', time: '19:30', recur: 'weekly', day: 3 }], { uidScope: 'x' });
  for (const marker of ['BEGIN:VEVENT', 'END:VEVENT', 'UID:', 'DTSTAMP:', 'DTSTART', 'RRULE']) {
    assert.equal(one.includes(marker), false, 'the dropped event left ' + marker + ' in the file');
  }
  assert.ok(one.includes('BEGIN:VCALENDAR') && one.includes('END:VCALENDAR'), 'the file itself stopped being a calendar');
  // CONTROL, and the thing this row must not break: an anchor in 9999 that does NOT step past the end is
  // still a perfectly good series, and so is every ordinary one.
  const early = buildCalendar([{ id: 'e', title: 'E', date: '9999-01-05', time: '19:30', recur: 'weekly', day: 3 }], { uidScope: 'x' });
  assert.deepEqual(prop(early, 'DTSTART'), ['99990106T193000'], 'a far-future anchor that fits was dropped with the ones that do not');
  const ord = buildCalendar([{ id: 'e', title: 'E', date: '2026-09-15', time: '19:30', recur: 'monthly', day: 2 }], { uidScope: 'x' });
  assert.deepEqual(prop(ord, 'DTSTART'), ['20261006T193000'], 'an ordinary monthly meeting changed');
  // a ONE-OFF on the very last day is untouched — it computes no occurrence at all
  const once = buildCalendar([{ id: 'e', title: 'E', date: '9999-12-31', time: '19:30' }], { uidScope: 'x' });
  assert.deepEqual(prop(once, 'DTSTART'), ['99991231T193000'], 'a one-off on the last day of the calendar was dropped');
});

test('F3: the whole hostile sweep — no spin, no throw, no malformed line, no DTSTART before its anchor', () => {
  // The audit's fuzz shape, re-taken here so the property is guarded rather than measured once. 85,176
  // combinations found exactly one defect class; this sweep covers the same ground and asserts the four
  // properties that were checked, including the two that hold only because DAY_OK bounds both walks.
  const DATES = [];
  for (const y of ['0001', '0026', '1969', '1970', '2024', '2026', '2100', '9998', '9999']) {
    for (const md of ['01-01', '02-28', '02-29', '06-15', '11-30', '12-01', '12-24', '12-25', '12-26', '12-27', '12-28', '12-29', '12-30', '12-31']) DATES.push(y + '-' + md);
  }
  const DAYS = [0, 1, 2, 3, 4, 5, 6, -1, 7, 2.5, '2', null, undefined, NaN, Infinity];
  const RECURS = ['weekly', 'fortnightly', 'monthly', '', 'daily', null];
  let n = 0, admitted = 0, emitted = 0;
  const bad = [];
  const t0 = Date.now();
  for (const date of DATES) for (const recur of RECURS) for (const day of DAYS) {
    n++;
    const ev = { id: 'e', title: 'E', date, time: '19:30', where: 'H', blurb: '', recur, day };
    let text;
    try { text = buildCalendar([ev], { uidScope: 'x' }); }
    catch (e) { bad.push(`${date} ${recur} ${String(day)} THREW ${e.message}`); continue; }
    if (publicEventFields(ev)) admitted++;
    if (!text.includes('BEGIN:VEVENT')) continue;
    emitted++;
    const dt = prop(text, 'DTSTART')[0];
    const rr = prop(text, 'RRULE')[0] || '';
    if (!/^\d{8}(T\d{6})?$/.test(dt)) { bad.push(`${date} ${recur} ${String(day)} DTSTART=${dt}`); continue; }
    if (rr && !/^FREQ=(WEEKLY|MONTHLY)(;INTERVAL=2)?;BYDAY=(1)?(SU|MO|TU|WE|TH|FR|SA)$/.test(rr)) bad.push(`${date} ${recur} ${String(day)} RRULE=${rr}`);
    if (dt.slice(0, 8) < date.replace(/-/g, '')) bad.push(`${date} ${recur} ${String(day)} DTSTART ${dt} is BEFORE its anchor`);
    // a DTSTART must be an instance of its own rule (RFC 5545 §3.8.5.3), which is the F5/R3 property
    const m = /BYDAY=(1)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(rr);
    if (m && dayOf(dt.slice(0, 8)) !== BYDAY.indexOf(m[2])) bad.push(`${date} ${recur} ${String(day)} DTSTART ${dt} is not a ${m[2]}`);
    if (m && m[1] && dt.slice(0, 8) !== firstSuchWeekdayOfMonth(dt.slice(0, 8))) bad.push(`${date} ${recur} ${String(day)} monthly DTSTART ${dt} is not the first ${m[2]} of its month`);
  }
  assert.deepEqual(bad, [], `${bad.length} of ${n} hostile combinations produced a feed a calendar cannot read, e.g.\n  ` + bad.slice(0, 6).join('\n  '));
  assert.ok(n > 1000 && emitted > 100 && admitted > 100, `re-anchor: the sweep measured almost nothing (n=${n} admitted=${admitted} emitted=${emitted})`);
  // DAY_OK is what stops both walks spinning for ever, and a spin here is a hang inside the relay's request
  // path rather than a wrong date. The whole sweep returning at all is the guard; the time bound makes it
  // fail loudly rather than hanging a CI run.
  assert.ok(Date.now() - t0 < 20000, 'the sweep took ' + (Date.now() - t0) + 'ms — an occurrence walk is spinning');
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
