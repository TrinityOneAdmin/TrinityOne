// public-widget.mjs — the embeddable calendar widget, built the same way public-calendar.mjs builds the
// .ics file: a pure function producing a string, with no I/O, no store, no knowledge of who may read what.
// gateway.mjs decides whether to serve it at all; scripts/gateway.mjs's route is the only caller.
//
// reference/DESIGN-embeddable-church-info.md phase 3 ("widget"), owner go-ahead 2026-09-23. A church pastes
// `<script src=".../public/<npub>/widget.js" data-mode="list"></script>` into its own site. THIS FILE never
// sees a church, a npub or a feed — it is one script, identical for every church, that at RUNTIME reads its
// own `src` to find the calendar.ics next to it and its own `data-*` attributes for how to render. See
// design/widget-mock/README.md for the look this follows and the open questions it does not try to answer
// (event counts, "add to calendar", a subscribe link, empty-vs-unreachable wording, timezone captions, and
// working month navigation) — this build picks a plain, defensible default for each and does not claim more.
//
// WHY toString()'D FUNCTIONS. The functions below are ordinary, exported, directly-testable ESM functions —
// scripts/*.test.mjs imports parseIcs and expandOccurrences and runs them exactly as shipped, no mirror
// (memory: tests-must-drive-shipped-code). buildWidgetScript() then serialises each one with .toString()
// into the actual browser bundle, so the function a test calls IS the function that ships; there is no
// second copy of the parsing or expansion logic to drift from it. This is why every function here is a
// plain top-level `function name() {}` declaration (not an arrow function bound to outer state) that only
// calls OTHER functions in this same file: `export` is a module-record keyword and does not appear in
// `fn.toString()`, but a closure over an outer variable would not survive being pasted into a fresh IIFE.
//
// THE NO-THIRD-PARTY RULE (design doc, "What it must never do"; design/widget-mock/README.md, "the
// no-third-party rule"). This script's only network request is a same-origin fetch of ITS OWN calendar.ics,
// computed from its own src. No font, no image, no analytics, no CDN — CSS is one inline <style> this script
// injects itself, built from string literals in this file, and every visible field is written with
// textContent, never innerHTML, so a steward's own free text can never inject markup into a visitor's page.
//
// BRANDING (design doc, "Widget branding — the church's COLOUR only", owner 2026-09-23): `data-accent`
// only. No logo, no banner — deliberately not read from anywhere, because the only way to add one honestly
// would be a data: URI a church pastes into the tag itself, which is not asked for here.

// ── unfold + unescape (RFC 5545 §3.1 / §3.3.11), duplicated rather than imported from public-calendar.mjs:
// this file has to serialise into a browser bundle with no import of its own, so it carries its own tiny
// copies rather than depending on another module's internals surviving a toString(). ────────────────────
export function unfoldIcsLines(text) {
  return String(text == null ? '' : text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}
export function unescapeIcsText(s) {
  return String(s == null ? '' : s).replace(/\\[nN]/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// The parser. Reads exactly the properties scripts/public-calendar.mjs's buildCalendar() ever writes
// (SUMMARY, LOCATION, DESCRIPTION, UID, DTSTART, RRULE, X-WR-CALNAME) and ignores everything else, so an
// unrecognised line is skipped rather than thrown on — a future feed field must not blank a widget that
// predates it. Returns { calname, events: [{ uid, summary, location, description, dtstart:
// {date,time,allDay}, rrule: {freq,interval,byday}|null }] }.
export function parseIcs(text) {
  const lines = unfoldIcsLines(text).split(/\r\n|\n/).filter((l) => l.length > 0);
  let calname = '';
  const events = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const head = line.slice(0, ci);
    const value = line.slice(ci + 1);
    const semi = head.indexOf(';');
    const name = semi < 0 ? head : head.slice(0, semi);
    const params = semi < 0 ? '' : head.slice(semi + 1);
    if (!cur) { if (name === 'X-WR-CALNAME') calname = unescapeIcsText(value); continue; }
    if (name === 'SUMMARY') cur.summary = unescapeIcsText(value);
    else if (name === 'LOCATION') cur.location = unescapeIcsText(value);
    else if (name === 'DESCRIPTION') cur.description = unescapeIcsText(value);
    else if (name === 'UID') cur.uid = value;
    else if (name === 'DTSTART') {
      const allDay = /VALUE=DATE\b/.test(params) || value.length <= 8;
      const date = value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8);
      const time = (!allDay && value.length >= 15) ? value.slice(9, 11) + ':' + value.slice(11, 13) : null;
      cur.dtstart = { date, time, allDay };
    } else if (name === 'RRULE') {
      const fm = /FREQ=(WEEKLY|MONTHLY)/.exec(value);
      if (fm) {
        const interval = /INTERVAL=2/.test(value) ? 2 : 1;
        const bm = /BYDAY=(-?\d)?(SU|MO|TU|WE|TH|FR|SA)/.exec(value);   // -1FR = the last Friday
        const nth = fm[1] === 'MONTHLY' ? (bm && bm[1] ? parseInt(bm[1], 10) : 1) : undefined;
        cur.rrule = { freq: fm[1], interval, byday: bm ? bm[2] : null, ...(nth !== undefined && { nth }) };
      }
    }
  }
  return { calname, events };
}

export function bydayIndex(code) { return { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }[code]; }
export function isoToUtc(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
export function utcToIso(t) { return new Date(t).toISOString().slice(0, 10); }
export function firstWeekdayOnOrAfter(y, m, day, byday) {
  let d = Date.UTC(y, m, day);
  while (new Date(d).getUTCDay() !== byday) d += 86400000;
  return d;
}
function nthWeekdayOf(y, m, byday, nth) {
  if (nth === -1) {                              // BYDAY=-1<day>: the LAST such weekday of the month
    let e = Date.UTC(y, m + 1, 0);
    while (new Date(e).getUTCDay() !== byday) e -= 86400000;
    return e;
  }
  let d = Date.UTC(y, m, 1);
  while (new Date(d).getUTCDay() !== byday) d += 86400000;
  d += (nth - 1) * 7 * 86400000;
  return new Date(d).getUTCMonth() === m ? d : 0;
}
function occFrom(ev, date) {
  return { date, time: ev.dtstart.time, allDay: ev.dtstart.allDay, summary: ev.summary || '', location: ev.location || '', description: ev.description || '', recur: ev.rrule ? ev.rrule.freq : '', uid: ev.uid || '' };
}

// Every occurrence of every event that falls in [from, until] (inclusive, both 'YYYY-MM-DD'), sorted, and
// capped at `limit` (0 = no cap). A non-recurring event contributes at most one row; DTSTART is already the
// first instance of its own RRULE (public-calendar.mjs's own guarantee), so weekly/fortnightly just steps by
// 7 or 14 days from it and monthly steps a month at a time re-deriving the first <byday> of each — no walk
// here re-decides which weekday a series falls on, it only repeats forward what the feed already computed.
export function expandOccurrences(events, opts) {
  const from = (opts && opts.from) || '0000-01-01';
  const until = (opts && opts.until) || '9999-12-31';
  const limit = (opts && opts.limit) || 0;
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev.dtstart) continue;
    if (!ev.rrule) {
      if (ev.dtstart.date >= from && ev.dtstart.date <= until) out.push(occFrom(ev, ev.dtstart.date));
      continue;
    }
    if (ev.rrule.freq === 'WEEKLY') {
      const step = ev.rrule.interval === 2 ? 14 : 7;
      let t = isoToUtc(ev.dtstart.date);
      for (let n = 0; n < 400; n++) {
        const iso = utcToIso(t);
        if (iso > until) break;
        if (iso >= from) out.push(occFrom(ev, iso));
        t += step * 86400000;
      }
    } else if (ev.rrule.freq === 'MONTHLY') {
      const byday = bydayIndex(ev.rrule.byday);
      if (byday === undefined) continue;
      const nth = ev.rrule.nth || 1;
      const anchor = new Date(isoToUtc(ev.dtstart.date));
      let y = anchor.getUTCFullYear(), m = anchor.getUTCMonth();
      for (let n = 0; n < 60; n++) {
        const t = nthWeekdayOf(y, m, byday, nth);
        if (t) {
          const iso = utcToIso(t);
          if (iso > until) break;
          if (iso >= from) out.push(occFrom(ev, iso));
        }
        m += 1; if (m > 11) { m = 0; y += 1; }
      }
    }
  }
  out.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  return limit ? out.slice(0, limit) : out;
}

export function weekdayAbbrev(iso) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(isoToUtc(iso)).getUTCDay()];
}
export function dayMonthLabel(iso) {
  const d = new Date(isoToUtc(iso));
  return d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
}
export function recurLabel(recur) { return recur === 'WEEKLY' ? 'Weekly' : recur === 'MONTHLY' ? 'Monthly' : ''; }

// A small fixed palette, assigned to a MONTH GRID's distinct titles in first-seen order, so the same
// meeting always draws the same dot on repeat visits within one page load. Never reads or trusts anything
// about the event beyond its title — there is no accent per event (design doc: that field is stripped
// before the feed is built) and no image.
export function paletteFor(title, seen) {
  const palette = ['#C25A38', '#C8962E', '#5E8C6A', '#736958', '#9C4327', '#4A7355'];
  if (!(title in seen)) seen[title] = palette[Object.keys(seen).length % palette.length];
  return seen[title];
}

function injectWidgetStyle() {
  if (document.getElementById('trinityone-widget-style')) return;
  const css = '.tw-root{--tw-accent:#C25A38;--tw-ink:#221C16;--tw-ink2:#6B6052;--tw-ink3:#736958;'
    + '--tw-line:rgba(34,28,22,.10);--tw-line2:rgba(34,28,22,.05);--tw-paper:#FBF6EC;--tw-surface:#FFFDF8;'
    + '--tw-accent-soft:color-mix(in oklab,var(--tw-accent) 16%,white);'
    + 'background:var(--tw-surface);border:1px solid var(--tw-line);border-radius:16px;'
    + 'box-shadow:0 1px 2px rgba(34,28,16,.05),0 6px 18px rgba(34,28,16,.06);padding:16px 18px 14px;'
    + 'color:var(--tw-ink);font:14px/1.5 -apple-system,"Segoe UI",Roboto,system-ui,sans-serif;max-width:100%;box-sizing:border-box}'
    + '.tw-root *{box-sizing:border-box}'
    + '.tw-h{font-weight:800;font-size:15.5px;letter-spacing:-.2px;margin:0 0 12px;color:var(--tw-ink)}'
    + '.tw-list{list-style:none;margin:0;padding:0}'
    + '.tw-row{display:grid;grid-template-columns:52px 1fr;gap:12px;padding:10px 0;border-top:1px solid var(--tw-line2)}'
    + '.tw-row:first-child{border-top:none;padding-top:0}'
    + '.tw-when{text-align:center}'
    + '.tw-day{display:block;font:700 10px/1.2 inherit;letter-spacing:.5px;text-transform:uppercase;color:var(--tw-accent)}'
    + '.tw-date{display:block;font:700 16px/1.2 inherit;color:var(--tw-ink)}'
    + '.tw-title{font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}'
    + '.tw-meta{font-size:12.5px;color:var(--tw-ink2);margin-top:2px}'
    + '.tw-desc{font-size:12.5px;color:var(--tw-ink2);margin-top:4px}'
    + '.tw-badge{font:700 9.5px/1 inherit;letter-spacing:.4px;text-transform:uppercase;background:var(--tw-accent-soft);color:var(--tw-accent);padding:2px 7px;border-radius:999px}'
    + '.tw-empty,.tw-error{color:var(--tw-ink2);font-size:13px;padding:6px 0}'
    + '.tw-month-nav{display:flex;align-items:center;justify-content:center;gap:14px;margin:0 0 10px;font-size:13px;color:var(--tw-ink3)}'
    + '.tw-month-nav strong{color:var(--tw-ink);font-weight:700}'
    + '.tw-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}'
    + '.tw-dow{text-align:center;font:700 9.5px/1 inherit;letter-spacing:.4px;text-transform:uppercase;color:var(--tw-ink3);padding-bottom:4px}'
    + '.tw-cell{min-height:60px;border-radius:7px;background:var(--tw-paper);display:flex;flex-direction:column;align-items:center;padding:4px 2px;gap:2px;min-width:0;overflow:hidden}'
    + '.tw-cell.tw-out{opacity:.35}'
    + '.tw-cell.tw-today{box-shadow:inset 0 0 0 1.5px var(--tw-accent)}'
    + '.tw-num{font:700 11px/1 inherit;color:var(--tw-ink)}'
    + '.tw-dots{display:flex;flex-direction:column;gap:1px;width:100%;padding:0 2px;overflow:hidden;flex:1}'
    + '.tw-ev{font-size:9px;line-height:1.2;border-radius:3px;padding:1px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff;width:100%}'
    + '.tw-dot{width:5px;height:5px;border-radius:50%;display:inline-block}'
    + '.tw-dot.tw-oneoff{border-radius:1px;transform:rotate(45deg)}'
    + '.tw-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:12px;padding-top:10px;border-top:1px solid var(--tw-line2)}'
    + '.tw-legend-item{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--tw-ink2)}'
    + '.tw-compact{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}'
    + '.tw-compact li{font-size:13px;display:flex;gap:7px;align-items:baseline}'
    + '.tw-compact .tw-cday{font-weight:700;color:var(--tw-accent);min-width:28px}'
    + '.tw-compact .tw-rest{color:var(--tw-ink2)}'
    + '.tw-compact .tw-rest b{color:var(--tw-ink);font-weight:700}'
    + '.tw-slist{list-style:none;margin:0;padding:0}'
    + '.tw-srow{padding:12px 0;border-top:1px solid var(--tw-line2)}'
    + '.tw-srow:first-child{border-top:none;padding-top:0}'
    + '.tw-stitle{font-weight:700;font-size:14px;color:var(--tw-ink)}'
    + '.tw-smeta{font-size:12px;color:var(--tw-ink2);margin-top:2px}'
    + '.tw-sdesc{font-size:12.5px;color:var(--tw-ink2);margin-top:4px;line-height:1.5}'
    + '.tw-saudio{margin-top:8px;width:100%}'
    + '.tw-saudio audio{width:100%;height:32px}'
    + '.tw-player{display:flex;align-items:center;gap:10px;margin-top:8px;padding:8px 12px;border-radius:10px;background:var(--tw-paper);border:1px solid var(--tw-line)}'
    + '.tw-play{width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;background:var(--tw-accent);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
    + '.tw-play svg{width:16px;height:16px;fill:currentColor}'
    + '.tw-pbar-wrap{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}'
    + '.tw-pbar{height:6px;border-radius:3px;background:var(--tw-line);cursor:pointer;position:relative;overflow:hidden}'
    + '.tw-pbar-fill{height:100%;border-radius:3px;background:var(--tw-accent);width:0%;transition:width .1s}'
    + '.tw-ptime{display:flex;justify-content:space-between;font-size:10.5px;color:var(--tw-ink3);font-variant-numeric:tabular-nums}'
    + '.tw-speed{font-size:11px;font-weight:700;border:1px solid var(--tw-line);border-radius:6px;padding:3px 7px;background:var(--tw-surface);color:var(--tw-ink2);cursor:pointer;white-space:nowrap}'
    + '.tw-srow-lg{padding:16px 0;border-top:1px solid var(--tw-line2)}'
    + '.tw-srow-lg:first-child{border-top:none;padding-top:0}'
    + '.tw-stitle-lg{font-weight:800;font-size:16px;color:var(--tw-ink);line-height:1.3}'
    + '.tw-smeta-lg{font-size:13px;color:var(--tw-ink2);margin-top:3px}'
    + '.tw-sdesc-lg{font-size:13.5px;color:var(--tw-ink2);margin-top:6px;line-height:1.6}'
    + '.tw-plist{list-style:none;margin:0;padding:0}'
    + '.tw-prow{padding:14px 0;border-top:1px solid var(--tw-line2)}'
    + '.tw-prow:first-child{border-top:none;padding-top:0}'
    + '.tw-ptitle{font-weight:800;font-size:15px;color:var(--tw-ink)}'
    + '.tw-psub{font-size:13px;color:var(--tw-ink2);margin-top:2px}'
    + '.tw-pblurb{font-size:13px;color:var(--tw-ink2);margin-top:6px;line-height:1.55}'
    + '.tw-pdays{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}'
    + '.tw-pday{font-size:11.5px;padding:3px 9px;border-radius:7px;background:var(--tw-paper);color:var(--tw-ink2);border:1px solid var(--tw-line)}'
    + '.tw-dscroll{max-height:520px;overflow-y:auto;scrollbar-width:thin}'
    + '.tw-drow{padding:14px 16px;border-radius:10px;background:var(--tw-paper);border:1px solid var(--tw-line);margin-bottom:10px}'
    + '.tw-drow:last-child{margin-bottom:0}'
    + '.tw-dhead{display:flex;align-items:flex-start;gap:8px;cursor:pointer;-webkit-user-select:none;user-select:none}'
    + '.tw-dhead:hover .tw-dtitle{color:var(--tw-accent,#8B6F47)}'
    + '.tw-dtitle{font-weight:800;font-size:15px;color:var(--tw-ink);flex:1;min-width:0;transition:color .15s}'
    + '.tw-dchev{flex-shrink:0;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--tw-ink2);transition:transform .2s;margin-top:2px}'
    + '.tw-dchev.tw-open{transform:rotate(180deg)}'
    + '.tw-dref{font-size:13px;color:var(--tw-accent,#8B6F47);margin-top:4px;font-weight:600}'
    + '.tw-dseries{font-size:12px;color:var(--tw-ink2);margin-top:2px;font-style:italic}'
    + '.tw-dbody{overflow:hidden;transition:max-height .3s ease,opacity .2s ease;max-height:0;opacity:0}'
    + '.tw-dbody.tw-open{max-height:2000px;opacity:1}'
    + '.tw-dtext{font-size:13.5px;color:var(--tw-ink);margin-top:10px;line-height:1.65}'
    + '.tw-dtext p{margin:0 0 10px}'
    + '.tw-dtext p:last-child{margin-bottom:0}'
    + '.tw-dtext h3,.tw-dtext h4,.tw-dtext h5,.tw-dtext h6{margin:16px 0 6px;line-height:1.3}'
    + '.tw-dtext h3{font-size:16px;font-weight:800}'
    + '.tw-dtext h4{font-size:14.5px;font-weight:700}'
    + '.tw-dtext h5{font-size:13.5px;font-weight:700}'
    + '.tw-dtext hr{border:none;border-top:1px solid var(--tw-line);margin:14px 0}'
    + '.tw-smaudio{margin-top:4px}'
    + '.tw-smaudio audio{width:100%;height:28px}';
  const style = document.createElement('style');
  style.id = 'trinityone-widget-style';
  style.textContent = css;
  document.head.appendChild(style);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderList(root, occs, calname) {
  root.appendChild(el('div', 'tw-h', calname || 'What’s on'));
  if (!occs.length) { root.appendChild(el('div', 'tw-empty', 'Nothing on the calendar right now.')); return; }
  const ol = el('ol', 'tw-list');
  occs.forEach((o) => {
    const li = el('li', 'tw-row');
    const when = el('div', 'tw-when');
    when.appendChild(el('span', 'tw-day', weekdayAbbrev(o.date)));
    when.appendChild(el('span', 'tw-date', String(dayMonthLabel(o.date))));
    const body = el('div');
    const title = el('div', 'tw-title');
    title.appendChild(document.createTextNode(o.summary || 'Event'));
    if (recurLabel(o.recur)) title.appendChild(el('span', 'tw-badge', recurLabel(o.recur)));
    body.appendChild(title);
    const metaParts = [];
    if (o.time) metaParts.push(formatTime(o.time));
    if (o.location) metaParts.push(o.location);
    if (metaParts.length) body.appendChild(el('div', 'tw-meta', metaParts.join(' · ')));
    if (o.description) body.appendChild(el('div', 'tw-desc', o.description));
    li.appendChild(when); li.appendChild(body);
    ol.appendChild(li);
  });
  root.appendChild(ol);
}
function formatTime(hhmm) {
  const h = +hhmm.slice(0, 2), m = hhmm.slice(3, 5);
  const h12 = ((h + 11) % 12) + 1;
  return h12 + (m === '00' ? '' : ':' + m) + (h < 12 ? 'am' : 'pm');
}

function renderCompact(root, occs, calname) {
  root.appendChild(el('div', 'tw-h', calname || 'What’s on'));
  if (!occs.length) { root.appendChild(el('div', 'tw-empty', 'Nothing coming up.')); return; }
  const ul = el('ul', 'tw-compact');
  occs.forEach((o) => {
    const li = document.createElement('li');
    li.appendChild(el('span', 'tw-cday', weekdayAbbrev(o.date)));
    const rest = el('span', 'tw-rest');
    rest.appendChild(document.createTextNode(String(dayMonthLabel(o.date)) + ' — '));
    const b = el('b', null, o.summary || 'Event');
    rest.appendChild(b);
    if (o.time) rest.appendChild(document.createTextNode(', ' + formatTime(o.time)));
    li.appendChild(rest);
    ul.appendChild(li);
  });
  root.appendChild(ul);
}

function renderMonth(root, allEvents, calname) {
  root.appendChild(el('div', 'tw-h', calname || 'What’s on'));
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();   // the VIEWER'S month — see the widget README's open question on timezone display
  const first = new Date(Date.UTC(y, m, 1));
  const startDow = (first.getUTCDay() + 6) % 7;   // Monday-first grid, to match design/widget-mock/calendar-widget-mock.html
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const gridStart = new Date(Date.UTC(y, m, 1 - startDow));
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const nav = el('div', 'tw-month-nav');
  nav.appendChild(document.createTextNode('‹ '));
  nav.appendChild(el('strong', null, monthNames[m] + ' ' + y));
  nav.appendChild(document.createTextNode(' ›'));
  root.appendChild(nav);
  const from = utcToIso(Date.UTC(y, m, 1)), until = utcToIso(Date.UTC(y, m + 1, 0));
  const occs = expandOccurrences(allEvents, { from: utcToIso(gridStart.getTime()), until, limit: 0 });
  const byDate = {};
  occs.forEach((o) => { (byDate[o.date] = byDate[o.date] || []).push(o); });
  const seen = {};
  const grid = el('div', 'tw-grid');
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => grid.appendChild(el('div', 'tw-dow', d)));
  const todayIso = utcToIso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  for (let i = 0; i < 42 && i < startDow + daysInMonth + 7; i++) {
    const t = gridStart.getTime() + i * 86400000;
    const iso = utcToIso(t);
    const inMonth = new Date(t).getUTCMonth() === m;
    if (!inMonth && i >= startDow + daysInMonth) break;
    const cell = el('div', 'tw-cell' + (inMonth ? '' : ' tw-out') + (iso === todayIso ? ' tw-today' : ''));
    cell.appendChild(el('span', 'tw-num', String(new Date(t).getUTCDate())));
    const dots = el('div', 'tw-dots');
    const dayEvts = byDate[iso] || [];
    dayEvts.slice(0, 3).forEach((o) => {
      const name = o.summary || 'Event';
      const bg = paletteFor(name, seen);
      const label = el('div', 'tw-ev');
      label.style.background = bg;
      label.textContent = (o.time ? formatTime(o.time) + ' ' : '') + name;
      label.title = name + (o.time ? ', ' + formatTime(o.time) : '');
      dots.appendChild(label);
    });
    if (dayEvts.length > 3) {
      const more = el('div', 'tw-ev');
      more.style.background = 'var(--tw-ink3)';
      more.textContent = '+' + (dayEvts.length - 3) + ' more';
      dots.appendChild(more);
    }
    cell.appendChild(dots);
    grid.appendChild(cell);
  }
  root.appendChild(grid);
  const names = Object.keys(seen);
  if (names.length) {
    const legend = el('div', 'tw-legend');
    names.forEach((n) => {
      const item = el('span', 'tw-legend-item');
      const dot = el('i', 'tw-dot'); dot.style.background = seen[n]; dot.style.display = 'inline-block';
      item.appendChild(dot); item.appendChild(document.createTextNode(n));
      legend.appendChild(item);
    });
    root.appendChild(legend);
  }
}

function renderSermons(root, xmlText) {
  var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  var channel = doc.querySelector('channel');
  var title = channel && channel.querySelector('title') ? channel.querySelector('title').textContent : '';
  root.appendChild(el('div', 'tw-h', title || 'Sermons'));
  var items = doc.querySelectorAll('item');
  if (!items.length) { root.appendChild(el('div', 'tw-empty', 'No sermons yet.')); return; }
  var list = el('div', 'tw-slist');
  for (var i = 0; i < Math.min(items.length, 10); i++) {
    var item = items[i];
    var row = el('div', 'tw-srow');
    var t = item.querySelector('title') ? item.querySelector('title').textContent : 'Untitled';
    row.appendChild(el('div', 'tw-stitle', t));
    var parts = [];
    var pubDate = item.querySelector('pubDate') ? item.querySelector('pubDate').textContent : '';
    if (pubDate) { try { parts.push(new Date(pubDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })); } catch(e) { parts.push(pubDate); } }
    var dur = item.getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', 'duration');
    if (dur.length) parts.push(dur[0].textContent);
    if (parts.length) row.appendChild(el('div', 'tw-smeta', parts.join(' · ')));
    var desc = item.querySelector('description') ? item.querySelector('description').textContent : '';
    if (desc) { var d = el('div', 'tw-sdesc'); d.textContent = desc.slice(0, 200); row.appendChild(d); }
    var enc = item.querySelector('enclosure');
    if (enc && enc.getAttribute('url')) {
      var aw = el('div', 'tw-saudio');
      var audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'none';
      audio.src = enc.getAttribute('url');
      aw.appendChild(audio);
      row.appendChild(aw);
    }
    list.appendChild(row);
  }
  root.appendChild(list);
  if (items.length > 10) root.appendChild(el('div', 'tw-empty', '+ ' + (items.length - 10) + ' more'));
}

function renderPlans(root, data) {
  var church = data.church || '';
  root.appendChild(el('div', 'tw-h', church ? church + ' — Reading Plans' : 'Reading Plans'));
  var plans = data.plans || [];
  if (!plans.length) { root.appendChild(el('div', 'tw-empty', 'No reading plans yet.')); return; }
  var list = el('div', 'tw-plist');
  plans.forEach(function(p) {
    var row = el('div', 'tw-prow');
    row.appendChild(el('div', 'tw-ptitle', p.title || 'Untitled'));
    var sub = [p.sub, p.tag].filter(Boolean).join(' · ');
    if (sub) row.appendChild(el('div', 'tw-psub', sub));
    if (p.blurb) { var b = el('div', 'tw-pblurb'); b.textContent = p.blurb; row.appendChild(b); }
    if (p.days && p.days.length) {
      var days = el('div', 'tw-pdays');
      var show = p.days.slice(0, 5);
      show.forEach(function(d) { days.appendChild(el('span', 'tw-pday', 'Day ' + d.d + ': ' + (d.ref || d.label || ''))); });
      if (p.days.length > 5) days.appendChild(el('span', 'tw-pday', '+' + (p.days.length - 5) + ' more'));
      row.appendChild(days);
    }
    list.appendChild(row);
  });
  root.appendChild(list);
}

function fmtDuration(secs) {
  var m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function attachPlayer(container, audioUrl) {
  var audio = document.createElement('audio');
  audio.preload = 'none';
  audio.src = audioUrl;
  var playing = false;
  var speeds = [1, 1.5, 2];
  var si = 0;
  var pw = el('div', 'tw-player');
  var playBtn = el('button', 'tw-play');
  var playSvg = '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>';
  var pauseSvg = '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="5" height="16"/><rect x="14" y="4" width="5" height="16"/></svg>';
  playBtn.innerHTML = playSvg;
  var barWrap = el('div', 'tw-pbar-wrap');
  var bar = el('div', 'tw-pbar');
  var fill = el('div', 'tw-pbar-fill');
  bar.appendChild(fill);
  var timeRow = el('div', 'tw-ptime');
  var elapsed = el('span', null, '0:00');
  var total = el('span', null, '0:00');
  timeRow.appendChild(elapsed);
  timeRow.appendChild(total);
  barWrap.appendChild(bar);
  barWrap.appendChild(timeRow);
  var speedBtn = el('button', 'tw-speed', '1x');
  pw.appendChild(playBtn);
  pw.appendChild(barWrap);
  pw.appendChild(speedBtn);
  container.appendChild(pw);
  playBtn.onclick = function() {
    if (playing) { audio.pause(); } else { audio.play(); }
  };
  audio.onplay = function() { playing = true; playBtn.innerHTML = pauseSvg; };
  audio.onpause = function() { playing = false; playBtn.innerHTML = playSvg; };
  audio.ontimeupdate = function() {
    if (!audio.duration) return;
    fill.style.width = (audio.currentTime / audio.duration * 100) + '%';
    elapsed.textContent = fmtDuration(audio.currentTime);
  };
  audio.onloadedmetadata = function() { total.textContent = fmtDuration(audio.duration); };
  bar.onclick = function(e) {
    if (!audio.duration) return;
    var rect = bar.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  };
  speedBtn.onclick = function() {
    si = (si + 1) % speeds.length;
    audio.playbackRate = speeds[si];
    speedBtn.textContent = speeds[si] + 'x';
  };
}

function renderSermonsSm(root, xmlText) {
  var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  var channel = doc.querySelector('channel');
  var title = channel && channel.querySelector('title') ? channel.querySelector('title').textContent : '';
  root.appendChild(el('div', 'tw-h', title || 'Sermons'));
  var items = doc.querySelectorAll('item');
  if (!items.length) { root.appendChild(el('div', 'tw-empty', 'No sermons yet.')); return; }
  var list = el('div', 'tw-compact');
  for (var i = 0; i < Math.min(items.length, 10); i++) {
    var item = items[i];
    var li = document.createElement('li');
    var pubDate = item.querySelector('pubDate') ? item.querySelector('pubDate').textContent : '';
    var dateStr = '';
    if (pubDate) { try { dateStr = new Date(pubDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch(e) { dateStr = ''; } }
    if (dateStr) li.appendChild(el('span', 'tw-cday', dateStr));
    var rest = el('span', 'tw-rest');
    var t = item.querySelector('title') ? item.querySelector('title').textContent : 'Untitled';
    rest.appendChild(el('b', null, t));
    var author = item.getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', 'author');
    if (author.length) rest.appendChild(document.createTextNode(' — ' + author[0].textContent));
    li.appendChild(rest);
    var enc = item.querySelector('enclosure');
    if (enc && enc.getAttribute('url')) {
      var aw = el('div', 'tw-smaudio');
      var audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'none';
      audio.src = enc.getAttribute('url');
      aw.appendChild(audio);
      li.appendChild(aw);
    }
    list.appendChild(li);
  }
  root.appendChild(list);
  if (items.length > 10) root.appendChild(el('div', 'tw-empty', '+ ' + (items.length - 10) + ' more'));
}

function renderSermonsLg(root, xmlText) {
  var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  var channel = doc.querySelector('channel');
  var title = channel && channel.querySelector('title') ? channel.querySelector('title').textContent : '';
  root.appendChild(el('div', 'tw-h', title || 'Sermons'));
  var items = doc.querySelectorAll('item');
  if (!items.length) { root.appendChild(el('div', 'tw-empty', 'No sermons yet.')); return; }
  var list = el('div', 'tw-slist');
  for (var i = 0; i < Math.min(items.length, 10); i++) {
    var item = items[i];
    var row = el('div', 'tw-srow-lg');
    var t = item.querySelector('title') ? item.querySelector('title').textContent : 'Untitled';
    row.appendChild(el('div', 'tw-stitle-lg', t));
    var parts = [];
    var author = item.getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', 'author');
    if (author.length) parts.push(author[0].textContent);
    var pubDate = item.querySelector('pubDate') ? item.querySelector('pubDate').textContent : '';
    if (pubDate) { try { parts.push(new Date(pubDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })); } catch(e) { parts.push(pubDate); } }
    var dur = item.getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', 'duration');
    if (dur.length) parts.push(dur[0].textContent);
    if (parts.length) row.appendChild(el('div', 'tw-smeta-lg', parts.join(' · ')));
    var desc = item.querySelector('description') ? item.querySelector('description').textContent : '';
    if (desc) { var d = el('div', 'tw-sdesc-lg'); d.textContent = desc; row.appendChild(d); }
    var enc = item.querySelector('enclosure');
    if (enc && enc.getAttribute('url')) {
      attachPlayer(row, enc.getAttribute('url'));
    }
    list.appendChild(row);
  }
  root.appendChild(list);
  if (items.length > 10) root.appendChild(el('div', 'tw-empty', '+ ' + (items.length - 10) + ' more'));
}

function renderPlansSm(root, data) {
  var church = data.church || '';
  root.appendChild(el('div', 'tw-h', church ? church + ' — Reading Plans' : 'Reading Plans'));
  var plans = data.plans || [];
  if (!plans.length) { root.appendChild(el('div', 'tw-empty', 'No reading plans yet.')); return; }
  var list = el('div', 'tw-compact');
  plans.forEach(function(p) {
    var li = document.createElement('li');
    var rest = el('span', 'tw-rest');
    rest.appendChild(el('b', null, p.title || 'Untitled'));
    if (p.len) rest.appendChild(document.createTextNode(' — ' + p.len + ' days'));
    li.appendChild(rest);
    list.appendChild(li);
  });
  root.appendChild(list);
}

function renderPlansLg(root, data) {
  var church = data.church || '';
  root.appendChild(el('div', 'tw-h', church ? church + ' — Reading Plans' : 'Reading Plans'));
  var plans = data.plans || [];
  if (!plans.length) { root.appendChild(el('div', 'tw-empty', 'No reading plans yet.')); return; }
  var list = el('div', 'tw-plist');
  plans.forEach(function(p) {
    var row = el('div', 'tw-prow');
    row.appendChild(el('div', 'tw-ptitle', p.title || 'Untitled'));
    var sub = [p.sub, p.tag].filter(Boolean).join(' · ');
    if (sub) row.appendChild(el('div', 'tw-psub', sub));
    if (p.blurb) { var b = el('div', 'tw-pblurb'); b.textContent = p.blurb; row.appendChild(b); }
    if (p.days && p.days.length) {
      var days = el('div', 'tw-pdays');
      p.days.forEach(function(d) { days.appendChild(el('span', 'tw-pday', 'Day ' + d.d + ': ' + (d.ref || d.label || ''))); });
      row.appendChild(days);
    }
    list.appendChild(row);
  });
  root.appendChild(list);
}

function mdSkip(line) {
  var t = line.trim();
  if (!t) return 'blank';
  if (/═/.test(t)) return 'rule';
  if (/^---+$/.test(t) || /^===+$/.test(t)) return 'rule';
  if (/^(Title|Summary|Tags):\s/i.test(t)) return 'meta';
  return '';
}
function renderMd(container, text) {
  var lines = String(text || '').split('\n');
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    var sk = mdSkip(line);
    if (sk === 'rule') { container.appendChild(document.createElement('hr')); i++; continue; }
    if (sk === 'blank' || sk === 'meta') { i++; continue; }
    var hm = line.match(/^(#{1,4})\s+(.*)$/);
    if (hm) { var htag = 'h' + (hm[1].length + 2); var he = document.createElement(htag > 'h6' ? 'h6' : htag); mdInline(he, hm[2]); container.appendChild(he); i++; continue; }
    var para = document.createElement('p');
    var buf = [];
    while (i < lines.length) { var s = mdSkip(lines[i]); if (s === 'blank' || s === 'rule' || s === 'meta' || /^#{1,4}\s/.test(lines[i])) break; buf.push(lines[i]); i++; }
    mdInline(para, buf.join('\n'));
    container.appendChild(para);
  }
}
function mdInline(parent, text) {
  var parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  for (var j = 0; j < parts.length; j++) {
    var p = parts[j];
    if (p.length > 4 && p.charAt(0) === '*' && p.charAt(1) === '*' && p.charAt(p.length - 1) === '*' && p.charAt(p.length - 2) === '*') {
      var strong = document.createElement('strong'); strong.textContent = p.slice(2, -2); parent.appendChild(strong);
    } else if (p.length > 2 && p.charAt(0) === '*' && p.charAt(p.length - 1) === '*' && p.charAt(1) !== '*') {
      var em = document.createElement('em'); em.textContent = p.slice(1, -1); parent.appendChild(em);
    } else {
      parent.appendChild(document.createTextNode(p));
    }
  }
}

function devoCard(d, startOpen) {
  var row = el('div', 'tw-drow');
  var head = el('div', 'tw-dhead');
  head.appendChild(el('div', 'tw-dtitle', d.title || 'Untitled'));
  var chev = el('div', 'tw-dchev', '▼');
  if (startOpen) chev.className = 'tw-dchev tw-open';
  head.appendChild(chev);
  row.appendChild(head);
  if (d.ref) row.appendChild(el('div', 'tw-dref', d.ref));
  if (d.series) row.appendChild(el('div', 'tw-dseries', d.series));
  var body = el('div', startOpen ? 'tw-dbody tw-open' : 'tw-dbody');
  if (d.text) { var t = el('div', 'tw-dtext'); renderMd(t, d.text); body.appendChild(t); }
  row.appendChild(body);
  head.addEventListener('click', function() {
    var open = body.classList.toggle('tw-open');
    chev.className = open ? 'tw-dchev tw-open' : 'tw-dchev';
  });
  return row;
}

function renderDevosSm(root, data) {
  var church = data.church || '';
  root.appendChild(el('div', 'tw-h', church ? church + ' — Devotionals' : 'Devotionals'));
  var devos = data.devotionals || [];
  if (!devos.length) { root.appendChild(el('div', 'tw-empty', 'No devotionals yet.')); return; }
  var list = el('div', 'tw-dscroll');
  devos.forEach(function(d) { list.appendChild(devoCard(d, false)); });
  root.appendChild(list);
}

function renderDevos(root, data) {
  var church = data.church || '';
  root.appendChild(el('div', 'tw-h', church ? church + ' — Devotionals' : 'Devotionals'));
  var devos = data.devotionals || [];
  if (!devos.length) { root.appendChild(el('div', 'tw-empty', 'No devotionals yet.')); return; }
  var list = el('div', 'tw-dscroll');
  devos.forEach(function(d) { list.appendChild(devoCard(d, false)); });
  root.appendChild(list);
}

function renderDevosLg(root, data) {
  var church = data.church || '';
  root.appendChild(el('div', 'tw-h', church ? church + ' — Devotionals' : 'Devotionals'));
  var devos = data.devotionals || [];
  if (!devos.length) { root.appendChild(el('div', 'tw-empty', 'No devotionals yet.')); return; }
  var list = el('div', 'tw-dscroll');
  devos.forEach(function(d, i) { list.appendChild(devoCard(d, i === 0)); });
  root.appendChild(list);
}

function baseFromScriptSrc(src) {
  const i = src.lastIndexOf('/widget.js');
  return i < 0 ? '' : src.slice(0, i);
}
function safeAccent(v) {
  return v && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(v) ? v : '';
}

function initWidget() {
  const script = document.currentScript;
  if (!script || !script.src) return;
  const base = baseFromScriptSrc(script.src);
  if (!base) return;
  const mode = ['list', 'month', 'compact', 'sermons', 'sermons-sm', 'sermons-lg', 'plans', 'plans-sm', 'plans-lg', 'devos', 'devos-sm', 'devos-lg'].indexOf(script.getAttribute('data-mode')) >= 0 ? script.getAttribute('data-mode') : 'list';
  var cacheBust = script.getAttribute('data-preview') ? '?_=' + Date.now() : '';
  const accent = safeAccent(script.getAttribute('data-accent'));
  injectWidgetStyle();
  const root = document.createElement('div');
  root.className = 'tw-root';
  if (accent) root.style.setProperty('--tw-accent', accent);
  const loading = el('div', 'tw-empty', 'Loading…');
  root.appendChild(loading);
  script.insertAdjacentElement('afterend', root);
  if (mode === 'sermons' || mode === 'sermons-sm' || mode === 'sermons-lg') {
    var sRenderer = mode === 'sermons-sm' ? renderSermonsSm : mode === 'sermons-lg' ? renderSermonsLg : renderSermons;
    fetch(base + '/sermons.xml' + cacheBust, { credentials: 'omit', mode: 'cors' }).then(function(r) {
      if (!r.ok) throw new Error('bad status'); return r.text();
    }).then(function(text) {
      root.removeChild(loading); sRenderer(root, text);
    }).catch(function() { root.removeChild(loading); root.appendChild(el('div', 'tw-error', 'Sermons unavailable right now.')); });
  } else if (mode === 'plans' || mode === 'plans-sm' || mode === 'plans-lg') {
    var pRenderer = mode === 'plans-sm' ? renderPlansSm : mode === 'plans-lg' ? renderPlansLg : renderPlans;
    fetch(base + '/plans.json' + cacheBust, { credentials: 'omit', mode: 'cors' }).then(function(r) {
      if (!r.ok) throw new Error('bad status'); return r.json();
    }).then(function(data) {
      root.removeChild(loading); pRenderer(root, data);
    }).catch(function() { root.removeChild(loading); root.appendChild(el('div', 'tw-error', 'Reading plans unavailable right now.')); });
  } else if (mode === 'devos' || mode === 'devos-sm' || mode === 'devos-lg') {
    var dRenderer = mode === 'devos-sm' ? renderDevosSm : mode === 'devos-lg' ? renderDevosLg : renderDevos;
    fetch(base + '/devotionals.json' + cacheBust, { credentials: 'omit', mode: 'cors' }).then(function(r) {
      if (!r.ok) throw new Error('bad status'); return r.json();
    }).then(function(data) {
      root.removeChild(loading); dRenderer(root, data);
    }).catch(function() { root.removeChild(loading); root.appendChild(el('div', 'tw-error', 'Devotionals unavailable right now.')); });
  } else {
    fetch(base + '/calendar.ics' + cacheBust, { credentials: 'omit', mode: 'cors' }).then((r) => {
      if (!r.ok) throw new Error('bad status');
      return r.text();
    }).then((text) => {
      root.removeChild(loading);
      const parsed = parseIcs(text);
      if (mode === 'month') { renderMonth(root, parsed.events, parsed.calname); return; }
      const now = new Date();
      const from = utcToIso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      const until = utcToIso(Date.UTC(now.getFullYear(), now.getMonth() + 7, now.getDate()));
      const occs = expandOccurrences(parsed.events, { from, until, limit: mode === 'compact' ? 3 : 8 });
      if (mode === 'compact') renderCompact(root, occs, parsed.calname);
      else renderList(root, occs, parsed.calname);
    }).catch(() => {
      root.removeChild(loading);
      root.appendChild(el('div', 'tw-error', 'Calendar unavailable right now.'));
    });
  }
}

// The functions that make up the shipped script, in the order they must be defined (each only calls ones
// listed before or after it — function declarations hoist, so order does not matter to execution, only to
// keeping this list a complete and honest inventory of what ships).
const WIDGET_FUNCTIONS = [
  unfoldIcsLines, unescapeIcsText, parseIcs, bydayIndex, isoToUtc, utcToIso, firstWeekdayOnOrAfter, occFrom,
  expandOccurrences, weekdayAbbrev, dayMonthLabel, recurLabel, paletteFor, injectWidgetStyle, el,
  renderList, formatTime, renderCompact, renderMonth, fmtDuration, attachPlayer,
  renderSermons, renderSermonsSm, renderSermonsLg, renderPlans, renderPlansSm, renderPlansLg,
  mdSkip, renderMd, mdInline, devoCard, renderDevosSm, renderDevos, renderDevosLg,
  baseFromScriptSrc, safeAccent, initWidget,
];

// The file. Identical for every church — see the module comment for why. `'use strict'` and one top-level
// IIFE so two widgets on the same page never collide on a variable name.
export function buildWidgetScript() {
  return '(function(){\n"use strict";\n' + WIDGET_FUNCTIONS.map((f) => f.toString()).join('\n') + '\ninitWidget();\n})();\n';
}
