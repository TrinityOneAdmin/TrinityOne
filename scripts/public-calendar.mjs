// public-calendar.mjs — a church's PUBLIC calendar as an iCalendar file, built by the relay.
//
// reference/DESIGN-embeddable-church-info.md, phase 1. A church that has switched "share our calendar" on
// gets `<base>/public/<npub>/calendar.ics` served by its own relay, so its website builder (or a member's
// phone calendar) can subscribe to it. This module is the file's SHAPE and nothing else: no I/O, no store,
// no knowledge of who may read what. gateway.mjs decides whether to serve at all and what goes in.
//
// WHY THIS IS NOT app/screens-serving.jsx's builder. The design doc says "the builder already exists" there.
// It does, and it cannot be reused: `svDownloadICS` is an inline string inside an unbundled browser file,
// describes a SERVING slot (team, role) rather than a calendar event, and ends in Blob/window.open. The
// escaping and the DTSTAMP shape are carried over so a member's phone sees the same dialect from both.
//
// WHAT AN EVENT IS HERE — the noticeboard fields and only those (design doc, "what is safe"): title, date,
// time, place, a one-line description, and the repeat rule. Never an attendee, an RSVP, a group id, an
// image (a data: URI can be megabytes) or an accent colour. The console publishes exactly these as the
// `pubevent:` copy; this builder drops anything else it is handed rather than trusting its caller.
//
// TIMES ARE FLOATING. An event carries a calendar date and a wall-clock time in the church's own place, with
// no zone (the app has never stored one). `DTSTART:20260922T193000` with no Z and no TZID means "19:30 local
// wherever this is read", which is what a parish noticeboard means too. Attaching a zone would be inventing
// one. No DTEND either: nothing stores a duration, and RFC 5545 §3.6.1 says a DATE-TIME start with no end is
// an event that ends when it starts — the same shape the member app's own "Add to my calendar" writes.

// RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, and a newline as the two characters `\n`.
export const icsEscape = (s) => String(s == null ? '' : s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// §3.1: a content line is at most 75 OCTETS; longer ones fold onto a continuation line beginning with one
// space. Folding is on octets, not characters, so a UTF-8 multi-byte sequence must never be split.
export function foldLine(line) {
  const bytes = Buffer.from(String(line), 'utf8');
  if (bytes.length <= 75) return String(line);
  const out = [];
  let start = 0, first = true;
  while (start < bytes.length) {
    const max = first ? 75 : 74;                 // continuation lines spend one octet on the leading space
    let end = Math.min(start + max, bytes.length);
    while (end < bytes.length && end > start && (bytes[end] & 0xC0) === 0x80) end--;   // back off a split code point
    out.push((first ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
    start = end; first = false;
  }
  return out.join('\r\n');
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// A DATE IS A RANGE AS WELL AS A SHAPE. The pattern above admits `2026-02-31`, `2026-13-01` and `2026-00-10`,
// and Date.UTC then normalises them into some other month — which is how an anchor of 31 February reached the
// feed as `DTSTART:20260231T193000`, a string no calendar can read (audit R7), and how a month of 13 became a
// meeting in January 2027. So the parse is the range check: anything that does not survive the round trip is
// not a date this module will place on a calendar. (`\d{4}` also means a year like `0026`, which Date.UTC
// reads as 1926; that fails the round trip too, which is the fail-closed answer.)
function isoParts(date) {
  const m = ISO_DATE.exec(String(date == null ? '' : date));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d, t };
}
// AND SO IS A COMPUTED OCCURRENCE (audit AUDIT-feeds-round3-2026-09-22 F3). isoParts() range-checks the
// anchor a steward typed; it says nothing about the date the two walks below STEP TO. A weekly meeting
// anchored on 9999-12-31 steps forward into the year 10000, where Date's toISOString() switches to ISO 8601's
// expanded-year form (`+010000-01-01T…`) — and `.slice(0, 10).replace(/-/g, '')` turned that into
// `DTSTART:+01000001T193000`, a string no calendar can read. Reachable from the console's own event date
// field, which has a `max` of 9999-12-31 but no guarantee (a `pubevent:` copy can also arrive from /import or
// a seed script, and this module is written to distrust its caller). So every occurrence goes back through
// the same round trip the anchor did, and anything that fails it is not a date this module will place on a
// calendar: dtstart() answers null and buildCalendar() writes no VEVENT at all rather than a broken one.
function isoOf(d) {
  const t = d instanceof Date ? d.getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  const s = new Date(t).toISOString().slice(0, 10);
  return ISO_DATE.test(s) ? s : null;
}
const HHMM = /^(\d{2}):(\d{2})$/;
const RECUR = new Set(['weekly', 'fortnightly', 'monthly']);
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
// Both occurrence walks step forward until `cur.getUTCDay() === day`. A `day` that no weekday can equal would
// spin for ever, so neither walk is entered without this. seriesDay() below is what makes it always true.
const DAY_OK = (day) => Number.isInteger(day) && day >= 0 && day <= 6;

// Read one event down to the fields this file may carry. Returns null for anything that cannot be placed on
// a calendar at all (no id, no valid date), which the builder then skips rather than emitting a broken VEVENT.
export function publicEventFields(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const id = String(ev.id || '');
  const date = String(ev.date || '');
  if (!ID_OK.test(id) || !isoParts(date)) return null;
  const time = HHMM.test(String(ev.time || '')) ? String(ev.time) : '';
  const recur = RECUR.has(ev.recur) ? ev.recur : '';
  const day = (recur && DAY_OK(ev.day)) ? ev.day : null;
  const nth = (recur === 'monthly' && typeof ev.nth === 'number' && ev.nth >= 1 && ev.nth <= 5) ? ev.nth : null;
  return {
    id, date, time,
    title: String(ev.title || '').slice(0, 200),
    where: String(ev.where || '').slice(0, 200),
    blurb: String(ev.blurb || '').slice(0, 2000),
    recur, day, nth,
  };
}

// A recurring meeting's anchor is the date the steward set; its occurrences fall on `day` (0 = Sunday).
//
// WEEKLY: the first occurrence is the first `day` on or after the anchor.
//
// FORTNIGHTLY IS NOT THAT, and the comment that stood here said it was. app/recur.jsx's expandEvents takes
// the first `day` on or after the anchor and THEN pulls it a week forward when that lands an odd number of
// weeks from the anchor — `Math.round((cur - anchor) / (7 * 864e5))`, which is 1 for an offset of 4, 5 or 6
// days. So for 3 of the 7 possible weekdays the app's series runs a week later than the anchor's own week,
// and a feed that skipped the correction advertised the WHOLE series a week early for ever, because
// INTERVAL=2 carries the phase: measured at 7671 of 17899 anchors (42.9%) over 2024-2030, against controls
// of 0 for weekly and 0 for monthly. A church's website and the church's own app named different nights.
//
// WHY THIS IS NOT `import { expandEvents }`. app/recur.jsx has no exports — it is a browser IIFE that
// assigns window.expandEvents, loaded by index.html and steward.html through <script type="text/babel">.
// Importing it here would mean reading a file and evaluating it inside the relay's request path, and the
// file is not there to read: scripts/build-strict-tgz.sh transpiles app/*.jsx to app/*.js and DROPS the
// .jsx from the payload every desktop relay ships and runs (build-relay-payload.sh step 1). So the rule is
// written twice, and the test holds the two together: the sweep in
// scripts/the-public-calendar-file-says-what-it-means.test.mjs executes the REAL expandEvents out of
// app/recur.jsx and asserts the two never disagree, over every anchor of seven years × every weekday.
//
// `day` is always a number here — dtstart() resolves it through seriesDay() below before calling.
function firstOccurrence(date, day, fortnightly) {
  const p = isoParts(date);
  if (!p || !DAY_OK(day)) return date;
  const anchor = p.t;
  const cur = new Date(anchor);
  for (let i = 0; i < 7 && cur.getUTCDay() !== day; i++) cur.setUTCDate(cur.getUTCDate() + 1);
  if (fortnightly && Math.round((cur.getTime() - anchor) / (7 * 864e5)) % 2 !== 0) cur.setUTCDate(cur.getUTCDate() + 7);
  return isoOf(cur);
}

// A MONTHLY MEETING'S DTSTART MUST BE AN INSTANCE OF ITS OWN RRULE. `FREQ=MONTHLY;BYDAY=1TU` means "the
// first Tuesday of the month", and a meeting anchored on the 15th (audit F5: anchor 2026-09-15, a Tuesday)
// took the anchor itself as DTSTART — the THIRD Tuesday. RFC 5545 §3.8.5.3 says a DTSTART that is not
// synchronised with the recurrence rule gives an undefined set; Google and Apple render it as an extra
// occurrence, so a subscriber saw a phantom meeting on the 15th that the app's own expandEvents never shows.
// The first occurrence is the first `day` of the anchor's OWN month if that is not before the anchor, else
// the first `day` of the next month — which is exactly what expandEvents walks ("once a month, on the first
// matching weekday of the month", occurrences before the anchor skipped).
function nthMonthlyOccurrence(date, day, nth) {
  const n = (typeof nth === 'number' && nth >= 1 && nth <= 5) ? nth : 1;
  const p = isoParts(date);
  if (!p || !DAY_OK(day)) return date;
  const limit = n >= 5 ? 6 : 2;
  for (let ahead = 0; ahead < limit; ahead++) {
    const cur = new Date(Date.UTC(p.y, p.mo - 1 + ahead, 1));
    while (cur.getUTCDay() !== day) cur.setUTCDate(cur.getUTCDate() + 1);
    for (let w = 1; w < n; w++) cur.setUTCDate(cur.getUTCDate() + 7);
    if (cur.getUTCMonth() === (p.mo - 1 + ahead) % 12 && cur.getTime() >= p.t) return isoOf(cur);
  }
  return date;
}
// WHAT WEEKDAY A SERIES FALLS ON, read the same way in the DTSTART and in the RRULE. app/recur.jsx's
// expandEvents falls back to the anchor's own weekday for a series with no usable `day`
// (`const day = (typeof e.day === 'number') ? e.day : anchor.getDay()`), and rrule() below already did — but
// nthMonthlyOccurrence was handed the raw `day`, saw null and returned the anchor untouched, so the file
// carried `BYDAY=1TU` over a DTSTART that was not an instance of it for 281 of 365 anchors (audit R3).
// publicEventFields nulls `day` for anything that is not an integer 0-6 — a string '2', 2.5, 7, -1 — and
// src/steward.src.js publishEvent is where that `null` is minted (`typeof ev.day === 'number' ? ev.day :
// null`), with scripts/seed-church.mjs and /import as the other two ways in. This module is written to
// distrust its caller; that is the part it was not distrusting.
const seriesDay = (ev) => {
  if (typeof ev.day === 'number') return ev.day;
  const p = isoParts(ev.date);
  return p ? new Date(p.t).getUTCDay() : 0;
};

function dtstart(ev) {
  const day = seriesDay(ev);
  const date = !ev.recur ? ev.date
    : ev.recur === 'monthly' ? nthMonthlyOccurrence(ev.date, day, ev.nth)
      : firstOccurrence(ev.date, day, ev.recur === 'fortnightly');
  if (!date) return null;                        // the series steps off the end of the calendar — see isoOf
  const d = date.replace(/-/g, '');
  if (!ev.time) return 'DTSTART;VALUE=DATE:' + d;
  return 'DTSTART:' + d + 'T' + ev.time.replace(':', '') + '00';
}

// The inverse of foldLine, for anyone reading a file this module produced — including this repo's own tests.
// A content line is folded at 75 OCTETS, so a 64-character hex pubkey inside a long description is SPLIT
// across a fold, and a naive `text.includes(pubkey)` over the raw bytes answers "not there" while it is
// there (audit F6 — the scans that assert no key reaches a church's website were reading folded text).
// Unfold first, then scan. RFC 5545 §3.1: a CRLF followed by one space or tab is a fold and nothing else.
export const unfoldIcs = (text) => String(text == null ? '' : text).replace(/\r\n[ \t]/g, '');

function rrule(ev) {
  if (!ev.recur) return '';
  const day = seriesDay(ev);
  const nth = (typeof ev.nth === 'number' && ev.nth >= 1 && ev.nth <= 5) ? ev.nth : 1;
  if (ev.recur === 'monthly') return 'RRULE:FREQ=MONTHLY;BYDAY=' + nth + BYDAY[day];
  return 'RRULE:FREQ=WEEKLY' + (ev.recur === 'fortnightly' ? ';INTERVAL=2' : '') + ';BYDAY=' + BYDAY[day];
}

const p2 = (n) => String(n).padStart(2, '0');
export function icsStamp(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
}

// The file. `events` is anything; only what publicEventFields() admits is written. `name` is the church's
// display name, used for X-WR-CALNAME when `calName` is not set. `calName` is the steward's own choice of
// what the feed calls itself (Settings → Your website, phase 2) and wins when given — a church may want
// "St Mary's — What's On" rather than its legal name. `detail: 'short'` (default 'full') drops LOCATION and
// DESCRIPTION, leaving only the title and time — the phase-2 "how much of each event" setting, for a church
// whose event notes are franker than it wants on a public feed. `uidScope` makes UIDs unique across churches
// — pass the church's npub. NOTHING ELSE goes in: no URL, no host, no contact, no ATTENDEE, no ORGANIZER.
// The mirror mode planned for phase 3 must be able to serve these bytes with no trace of which machine
// built them, so nothing here may name one.
export function buildCalendar(events, { name = '', uidScope = 'trinityone', stamp = icsStamp(), calName = '', detail = 'full' } = {}) {
  const rows = (Array.isArray(events) ? events : []).map(publicEventFields).filter(Boolean)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id.localeCompare(b.id));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TrinityOne//Church//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const label = calName || name;
  if (label) lines.push('X-WR-CALNAME:' + icsEscape(label));
  const full = detail !== 'short';
  for (const ev of rows) {
    // NO HALF-WRITTEN VEVENT: the range check on the computed occurrence is asked BEFORE anything is pushed,
    // so an event whose series steps past 9999-12-31 is simply not in the file (isoOf above).
    const ds = dtstart(ev);
    if (!ds) continue;
    lines.push('BEGIN:VEVENT');
    lines.push('UID:trinityone-' + ev.id + '@' + uidScope);
    lines.push('DTSTAMP:' + stamp);
    lines.push(ds);
    const rr = rrule(ev); if (rr) lines.push(rr);
    lines.push('SUMMARY:' + icsEscape(ev.title || 'Event'));
    if (full && ev.where) lines.push('LOCATION:' + icsEscape(ev.where));
    if (full && ev.blurb) lines.push('DESCRIPTION:' + icsEscape(ev.blurb));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
