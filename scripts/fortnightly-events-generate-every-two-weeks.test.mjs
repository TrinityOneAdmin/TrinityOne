// A FORTNIGHTLY (EVERY-2-WEEKS) REPEAT GENERATES DATES 14 DAYS APART, AND THE COMPOSE FORM OFFERS IT.
// Run: node --test scripts/fortnightly-events-generate-every-two-weeks.test.mjs
//
// THE GAP (calendar-pilot-2026-11-05, item 1). Fortnightly was already supported BELOW the compose forms —
// app/recur.jsx expandEvents walks step=14 with phase correction, src/steward.src.js publishEvent passes
// `recur` through, and _webCopyBody + scripts/public-calendar.mjs already whitelist 'fortnightly'. The only
// gap was the compose UI (SchRepeatRow offered only Once/Weekly/Monthly) and the date generator schGenDates,
// whose non-monthly branch hard-coded a 7-day step. This build adds 'Fortnightly' to SchRepeatRow and a
// fortnightly path in schGenDates that routes through the SAME expandEvents walk the monthly branch uses.
//
// POINT OF USE (CLAUDE.md rule 1) and NO TEXT-MATCHING JSX (rule 3): app/stew-schedule.jsx ships UNBUNDLED, so
// a `false &&` in front of a condition would leave its words in the file and any grep would still pass. These
// tests LIFT the real schGenDates / schPlanned out of the file and RUN them (the fortnightly months are walked
// by the real app/recur.jsx, executed here), and RENDER the real SchRepeatRow and CLICK its real buttons —
// nothing asserts behaviour by matching source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCHED = read('../app/stew-schedule.jsx');
const RECUR = read('../app/recur.jsx');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

// The real window.expandEvents out of app/recur.jsx (the step-14, phase-aligned walk schGenDates delegates to).
function realExpandEvents() {
  const win = {};
  new Function('window', jsx(RECUR))(win);
  assert.equal(typeof win.expandEvents, 'function', 'app/recur.jsx did not define expandEvents — re-anchor');
  return win.expandEvents;
}

// Build the REAL app/stew-schedule.jsx module and hand back the symbols under test. schGenDates/schPlanned are
// module-level functions that read window.expandEvents at call time; SchRepeatRow is the real component.
function buildSched() {
  const React = { useState: () => [], useEffect() {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: 'Frag' };
  const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat() } });
  const window = { expandEvents: realExpandEvents() };
  const scope = {
    React, h, Frag: 'Frag', window, Icon: () => null, useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-01',
    SchModal: (p) => h('modal', {}, p.footer, p.children), CustomEvent: class {},
  };
  const names = Object.keys(scope);
  return new Function(...names, jsx(SCHED) + '\nreturn { schGenDates, schPlanned, SchRepeatRow };')(...names.map(n => scope[n]));
}

const { schGenDates, schPlanned, SchRepeatRow } = buildSched();

// Days between two YYYY-MM-DD dates, read at noon so a DST midnight shift cannot round to 13 or 15.
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5); }
function diffs(dates) { return dates.slice(1).map((d, i) => daysBetween(dates[i], d)); }

// ── schGenDates: the date generator ─────────────────────────────────────────────────────────────────────────
test('fortnightly yields dates spaced exactly 14 days from the start', () => {
  const dates = schGenDates('2026-10-13', 'fortnightly', '2026-12-31');
  assert.deepEqual(dates, ['2026-10-13', '2026-10-27', '2026-11-10', '2026-11-24', '2026-12-08', '2026-12-22'],
    'fortnightly did not step by 14 days from 13 Oct (start, +14, +28, ...)');
  assert.ok(diffs(dates).every(d => d === 14), 'two fortnightly dates were not 14 days apart: ' + diffs(dates).join(','));
});

test('fortnightly starts ON the start date and Until is inclusive', () => {
  // 2026-11-24 is start + 42 days (3 fortnights); Until exactly on it must keep it.
  const dates = schGenDates('2026-10-13', 'fortnightly', '2026-11-24');
  assert.deepEqual(dates, ['2026-10-13', '2026-10-27', '2026-11-10', '2026-11-24'],
    'a fortnightly date falling ON Until (24 Nov) was dropped, or the start was not included');
});

test('fortnightly with Until on or before the start publishes just the start, like weekly', () => {
  assert.deepEqual(schGenDates('2026-10-13', 'fortnightly', '2026-10-01'), ['2026-10-13'],
    'Until before the start should add just the start day');
  assert.deepEqual(schGenDates('2026-10-13', 'fortnightly', '2026-10-13'), ['2026-10-13'],
    'Until equal to the start should add just the start day');
});

test('weekly STILL steps by 7 (unchanged)', () => {
  const dates = schGenDates('2026-10-13', 'weekly', '2026-11-10');
  assert.deepEqual(dates, ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'],
    'the weekly 7-day step was disturbed by the fortnightly branch');
  assert.ok(diffs(dates).every(d => d === 7), 'weekly dates were not 7 days apart');
});

test('monthly is UNCHANGED (same weekday, same week of the month)', () => {
  assert.deepEqual(schGenDates('2026-10-13', 'monthly', '2027-01-31'),
    ['2026-10-13', '2026-11-10', '2026-12-08', '2027-01-12'],
    'the monthly branch changed — 13 Oct is the 2nd Tuesday, so the 2nd Tuesday of each month');
});

test('the 400-date guard holds for a far-off Until', () => {
  const dates = schGenDates('2026-01-01', 'fortnightly', '9999-12-31');
  assert.equal(dates.length, 400, 'fortnightly to 9999 was not capped at the 400-date ceiling the weekly walk has');
  assert.equal(dates[0], '2026-01-01');
  assert.ok(diffs(dates).every(d => d === 14), 'the capped fortnightly run was not evenly 14 days apart');
  // start + 399 * 14 days = the 400th date
  assert.equal(daysBetween('2026-01-01', dates[399]), 399 * 14, 'the 400th date is not 399 fortnights after the start');
});

// ── schPlanned: confirm it forwards 'fortnightly' unchanged ──────────────────────────────────────────────────
test('schPlanned forwards fortnightly to schGenDates unchanged', () => {
  // schPlanned(date, repeat, until, nth) === schGenDates(date, repeat, until, nth) for a repeating cadence.
  assert.deepEqual(schPlanned('2026-10-13', 'fortnightly', '2026-12-31'),
    schGenDates('2026-10-13', 'fortnightly', '2026-12-31', undefined),
    'schPlanned did not pass the fortnightly cadence straight through');
  // and it is NOT collapsed to the single-date 'none' path
  assert.ok(schPlanned('2026-10-13', 'fortnightly', '2026-12-31').length > 1, 'schPlanned treated fortnightly as a one-off');
});

// ── SchRepeatRow: point of use — the real compose-form control offers Fortnightly ───────────────────────────
// Render the REAL component and flatten every expanded function component onto the tree, so the repeat buttons
// are here exactly as they are on the screen.
function renderRepeatRow(onSetRepeat = () => {}) {
  const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat() } });
  const expand = (n) => {
    if (Array.isArray(n)) return n.map(expand);
    if (!n || typeof n !== 'object') return n;
    if (typeof n.type === 'function') return expand(n.type(n.props));
    return { ...n, props: { ...n.props, children: expand(n.props.children) } };
  };
  const flat = (n, out = []) => { if (Array.isArray(n)) n.forEach(x => flat(x, out)); else if (n && typeof n === 'object') { out.push(n); flat(n.props.children, out); } return out; };
  const text = (n) => (Array.isArray(n) ? n.map(text).join('') : (n && typeof n === 'object') ? text(n.props.children) : (n == null || n === false ? '' : String(n)));
  const tree = SchRepeatRow({ repeat: 'none', setRepeat: onSetRepeat, until: '', setUntil: () => {}, nth: 1, setNth: () => {}, date: '2026-10-13', planned: ['2026-10-13'] });
  const nodes = flat(expand(tree));
  // the repeat buttons are exactly the ones carrying aria-pressed
  const buttons = nodes.filter(n => n.type === 'button' && 'aria-pressed' in n.props);
  return { buttons, text };
}

test('the compose Repeat control offers Fortnightly, between Weekly and Monthly', () => {
  const { buttons, text } = renderRepeatRow();
  const labels = buttons.map(text);
  assert.deepEqual(labels, ['Once', 'Weekly', 'Fortnightly', 'Monthly'],
    'the Repeat row does not render Once/Weekly/Fortnightly/Monthly in order: ' + labels.join('/'));
});

test('clicking the Fortnightly button sets the repeat value to "fortnightly"', () => {
  let picked = null;
  const { buttons, text } = renderRepeatRow((v) => { picked = v; });
  const fn = buttons.find(b => text(b) === 'Fortnightly');
  assert.ok(fn, 'no Fortnightly button to click — the option is missing from the compose form');
  fn.props.onClick();
  assert.equal(picked, 'fortnightly', 'the Fortnightly button does not select the value "fortnightly"');
});
