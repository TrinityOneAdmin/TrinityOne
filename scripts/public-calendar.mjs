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
const HHMM = /^(\d{2}):(\d{2})$/;
const RECUR = new Set(['weekly', 'fortnightly', 'monthly']);
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;

// Read one event down to the fields this file may carry. Returns null for anything that cannot be placed on
// a calendar at all (no id, no valid date), which the builder then skips rather than emitting a broken VEVENT.
export function publicEventFields(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const id = String(ev.id || '');
  const date = String(ev.date || '');
  if (!ID_OK.test(id) || !ISO_DATE.test(date)) return null;
  const time = HHMM.test(String(ev.time || '')) ? String(ev.time) : '';
  const recur = RECUR.has(ev.recur) ? ev.recur : '';
  const day = (recur && Number.isInteger(ev.day) && ev.day >= 0 && ev.day <= 6) ? ev.day : null;
  return {
    id, date, time,
    title: String(ev.title || '').slice(0, 200),
    where: String(ev.where || '').slice(0, 200),
    blurb: String(ev.blurb || '').slice(0, 2000),
    recur, day,
  };
}

// A recurring meeting's anchor is the date the steward set; its occurrences fall on `day` (0 = Sunday). The
// first occurrence is the first `day` on or after the anchor — the same walk app/recur.jsx's expandEvents does.
function firstOccurrence(date, day) {
  const [, y, m, d] = ISO_DATE.exec(date);
  const cur = new Date(Date.UTC(+y, +m - 1, +d));
  if (day == null) return date;
  for (let i = 0; i < 7 && cur.getUTCDay() !== day; i++) cur.setUTCDate(cur.getUTCDate() + 1);
  return cur.toISOString().slice(0, 10);
}

function dtstart(ev) {
  const date = ev.recur ? firstOccurrence(ev.date, ev.day) : ev.date;
  const d = date.replace(/-/g, '');
  if (!ev.time) return 'DTSTART;VALUE=DATE:' + d;
  return 'DTSTART:' + d + 'T' + ev.time.replace(':', '') + '00';
}

function rrule(ev) {
  if (!ev.recur) return '';
  const day = ev.day == null ? new Date(ev.date + 'T00:00:00Z').getUTCDay() : ev.day;
  if (ev.recur === 'monthly') return 'RRULE:FREQ=MONTHLY;BYDAY=1' + BYDAY[day];   // first <weekday> of the month, as expandEvents reads it
  return 'RRULE:FREQ=WEEKLY' + (ev.recur === 'fortnightly' ? ';INTERVAL=2' : '') + ';BYDAY=' + BYDAY[day];
}

const p2 = (n) => String(n).padStart(2, '0');
export function icsStamp(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
}

// The file. `events` is anything; only what publicEventFields() admits is written. `name` is the church's
// display name (X-WR-CALNAME, so a subscriber's calendar app names the feed after the church). `uidScope`
// makes UIDs unique across churches — pass the church's npub. NOTHING ELSE goes in: no URL, no host, no
// contact, no ATTENDEE, no ORGANIZER. The mirror mode planned for phase 3 must be able to serve these
// bytes with no trace of which machine built them, so nothing here may name one.
export function buildCalendar(events, { name = '', uidScope = 'trinityone', stamp = icsStamp() } = {}) {
  const rows = (Array.isArray(events) ? events : []).map(publicEventFields).filter(Boolean)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id.localeCompare(b.id));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TrinityOne//Church//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (name) lines.push('X-WR-CALNAME:' + icsEscape(name));
  for (const ev of rows) {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:trinityone-' + ev.id + '@' + uidScope);
    lines.push('DTSTAMP:' + stamp);
    lines.push(dtstart(ev));
    const rr = rrule(ev); if (rr) lines.push(rr);
    lines.push('SUMMARY:' + icsEscape(ev.title || 'Event'));
    if (ev.where) lines.push('LOCATION:' + icsEscape(ev.where));
    if (ev.blurb) lines.push('DESCRIPTION:' + icsEscape(ev.blurb));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
