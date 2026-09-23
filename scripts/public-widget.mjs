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
        const bm = /BYDAY=(?:1)?(SU|MO|TU|WE|TH|FR|SA)/.exec(value);
        cur.rrule = { freq: fm[1], interval, byday: bm ? bm[1] : null };
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
      const anchor = new Date(isoToUtc(ev.dtstart.date));
      let y = anchor.getUTCFullYear(), m = anchor.getUTCMonth();
      for (let n = 0; n < 60; n++) {
        const t = firstWeekdayOnOrAfter(y, m, 1, byday);
        const iso = utcToIso(t);
        if (iso > until) break;
        if (iso >= from) out.push(occFrom(ev, iso));
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
    + '.tw-cell{aspect-ratio:1/1;border-radius:7px;background:var(--tw-paper);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:0}'
    + '.tw-cell.tw-out{opacity:.35}'
    + '.tw-cell.tw-today{box-shadow:inset 0 0 0 1.5px var(--tw-accent)}'
    + '.tw-num{font:700 11px/1 inherit;color:var(--tw-ink)}'
    + '.tw-dots{display:flex;gap:2px;height:6px;align-items:center}'
    + '.tw-dot{width:5px;height:5px;border-radius:50%;display:inline-block}'
    + '.tw-dot.tw-oneoff{border-radius:1px;transform:rotate(45deg)}'
    + '.tw-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:12px;padding-top:10px;border-top:1px solid var(--tw-line2)}'
    + '.tw-legend-item{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--tw-ink2)}'
    + '.tw-compact{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}'
    + '.tw-compact li{font-size:13px;display:flex;gap:7px;align-items:baseline}'
    + '.tw-compact .tw-cday{font-weight:700;color:var(--tw-accent);min-width:28px}'
    + '.tw-compact .tw-rest{color:var(--tw-ink2)}'
    + '.tw-compact .tw-rest b{color:var(--tw-ink);font-weight:700}';
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
    const dots = el('span', 'tw-dots');
    (byDate[iso] || []).forEach((o) => {
      const dot = el('span', 'tw-dot' + (o.recur ? '' : ' tw-oneoff'));
      dot.style.background = paletteFor(o.summary || 'Event', seen);
      dot.title = (o.summary || 'Event') + (o.time ? ', ' + formatTime(o.time) : '');
      dots.appendChild(dot);
    });
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
  const mode = ['list', 'month', 'compact'].indexOf(script.getAttribute('data-mode')) >= 0 ? script.getAttribute('data-mode') : 'list';
  const accent = safeAccent(script.getAttribute('data-accent'));
  injectWidgetStyle();
  const root = document.createElement('div');
  root.className = 'tw-root';
  if (accent) root.style.setProperty('--tw-accent', accent);
  const loading = el('div', 'tw-empty', 'Loading…');
  root.appendChild(loading);
  script.insertAdjacentElement('afterend', root);
  fetch(base + '/calendar.ics', { credentials: 'omit', mode: 'cors' }).then((r) => {
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

// The functions that make up the shipped script, in the order they must be defined (each only calls ones
// listed before or after it — function declarations hoist, so order does not matter to execution, only to
// keeping this list a complete and honest inventory of what ships).
const WIDGET_FUNCTIONS = [
  unfoldIcsLines, unescapeIcsText, parseIcs, bydayIndex, isoToUtc, utcToIso, firstWeekdayOnOrAfter, occFrom,
  expandOccurrences, weekdayAbbrev, dayMonthLabel, recurLabel, paletteFor, injectWidgetStyle, el,
  renderList, formatTime, renderCompact, renderMonth, baseFromScriptSrc, safeAccent, initWidget,
];

// The file. Identical for every church — see the module comment for why. `'use strict'` and one top-level
// IIFE so two widgets on the same page never collide on a variable name.
export function buildWidgetScript() {
  return '(function(){\n"use strict";\n' + WIDGET_FUNCTIONS.map((f) => f.toString()).join('\n') + '\ninitWidget();\n})();\n';
}
