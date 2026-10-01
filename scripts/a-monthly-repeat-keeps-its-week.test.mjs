// A MONTHLY REPEAT LANDS ON THE SAME WEEKDAY IN THE SAME WEEK OF EVERY MONTH.
// Run: node --test scripts/a-monthly-repeat-keeps-its-week.test.mjs
//
// THE DEFECT (FIX-PLAN-2026-10-01 item 2). The console's "Add a service" and "New event" dialogs publish a
// monthly repeat as one-off documents, one per month, and they stepped by CALENDAR DATE: a Tuesday meeting
// started on 13 Oct 2026 went out as Friday 13 Nov, and a start on 31 Jan landed on 3 Mar. Neither dialog
// passed a week to the "Which week" picker either, so it never showed. And the setup wizard let a steward
// pick "2nd" and then called publishMeeting without it, so every monthly meeting it made was the 1st.
//
// THE OWNER'S RULE (2026-10-01, DOMAIN.md): a monthly repeat defaults to the same weekday in the same week of
// the month as its start (13 Oct = 2nd Tuesday), and there is a "Last <weekday>" choice, which is the default
// for a start on the 29th-31st — a 5th weekday that skips most months is not what a church means.
//
// POINT OF USE (CLAUDE.md rule 1). These mount the REAL dialogs out of app/stew-schedule.jsx, type into the
// real fields, press the real Save, and read what reached Steward.publishService / publishEvent. The months
// are walked by the REAL app/recur.jsx (the dialogs call window.expandEvents), executed here — not a copy.
// The wizard test drives the real WizMeetings picker into the real saveMeetings and on into the shipped
// vendor/steward.js publishMeeting -> publishEvent, and reads the document it would seal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody, stripComments } from './test-slice.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCHED = read('../app/stew-schedule.jsx');
const RECUR = read('../app/recur.jsx');
const CONSOLE = read('../app/stew-console.jsx');
const DASH = read('../app/stew-dashboard.jsx');
const VENDOR = read('../vendor/steward.js');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

function realExpandEvents() {
  const win = {};
  new Function('window', jsx(RECUR))(win);
  assert.equal(typeof win.expandEvents, 'function', 'app/recur.jsx did not define expandEvents — re-anchor');
  return win.expandEvents;
}

// A small renderer: fake hooks real enough to hold state (by call order, re-read on every render), and EVERY
// function component expanded, so the picker inside SchRepeatRow is on the tree like it is on the screen.
function mountSched(componentName, props, steward) {
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: 'Frag',
  };
  const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat() } });
  const window = {
    Steward: steward, expandEvents: realExpandEvents(),
    useStewardGroups: () => [], useStewardEvents: () => [], dispatchEvent() {},
  };
  const scope = {
    React, h, Frag: 'Frag', window, Icon: () => null, useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-01',
    SchModal: (p) => h('modal', {}, p.footer, p.children), CustomEvent: class {},
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(SCHED) + `\nreturn { ${componentName} };`)(...names.map(n => scope[n]));
  const expand = (n) => {
    if (Array.isArray(n)) return n.map(expand);
    if (!n || typeof n !== 'object') return n;
    if (typeof n.type === 'function') return expand(n.type(n.props));
    return { ...n, props: { ...n.props, children: expand(n.props.children) } };
  };
  const flat = (n, out = []) => { if (Array.isArray(n)) n.forEach(x => flat(x, out)); else if (n && typeof n === 'object') { out.push(n); flat(n.props.children, out); } return out; };
  const nodes = () => { idx = 0; return flat(expand(mod[componentName](props))); };
  const text = (n) => (Array.isArray(n) ? n.map(text).join('') : (n && typeof n === 'object') ? text(n.props.children) : (n == null || n === false ? '' : String(n)));
  const byLabel = (l) => nodes().find(n => n.props['aria-label'] === l);
  return { nodes, byLabel, text, states };
}

// Type a monthly repeat into a dialog and press its save button. Returns the published dates, in order.
async function saveMonthly(component, { date, until, pick, changeDateTo, title = 'Elders' }) {
  const published = [];
  const steward = {
    publishService: async (s) => { published.push(s); return { id: 'svc' + published.length, ...s }; },
    publishEvent: async (e) => { published.push(e); return { id: 'evt' + published.length, ...e }; },
  };
  const m = mountSched(component, { onClose() {}, day: '' }, steward);
  if (m.byLabel('Title')) m.byLabel('Title').props.onChange({ target: { value: title } });
  m.byLabel('Date').props.onChange({ target: { value: date } });
  const monthly = m.nodes().find(n => n.type === 'button' && m.text(n) === 'Monthly');
  assert.ok(monthly, component + ': no "Monthly" button — re-anchor');
  monthly.props.onClick();
  m.byLabel('Until').props.onChange({ target: { value: until } });
  let sel = m.byLabel('Which week of the month');
  assert.ok(sel, component + ': THE DEFECT — a monthly repeat shows no "Which week" picker, so the steward cannot say which Tuesday');
  if (pick !== undefined) sel.props.onChange({ target: { value: String(pick) } });
  if (changeDateTo) m.byLabel('Date').props.onChange({ target: { value: changeDateTo } });
  sel = m.byLabel('Which week of the month');
  const shown = +sel.props.value;
  const saves = m.nodes().filter(n => n.type === 'button' && n.props.disabled === false);
  assert.equal(saves.length, 1, component + ': expected one enabled save button — re-anchor');
  await saves[0].props.onClick();
  return { dates: published.map(p => p.date), shown, options: m.nodes().filter(n => n.type === 'option' && n.props.value !== undefined), published };
}

for (const component of ['SchAddServiceModal', 'SchEventModal']) {
  test(`${component}: a 2nd-Tuesday start repeats on the 2nd Tuesday, not on the 13th`, async () => {
    const r = await saveMonthly(component, { date: '2026-10-13', until: '2027-01-31' });
    assert.equal(r.shown, 2, 'the picker did not default to the start date\'s week (13 Oct 2026 is the 2nd Tuesday)');
    assert.deepEqual(r.dates, ['2026-10-13', '2026-11-10', '2026-12-08', '2027-01-12'],
      'THE DEFECT: monthly stepped by calendar date (13 Nov 2026 is a Friday) instead of by "2nd Tuesday"');
  });

  test(`${component}: a start on the 30th is the LAST Friday, every month`, async () => {
    const r = await saveMonthly(component, { date: '2026-10-30', until: '2027-01-31' });
    assert.equal(r.shown, -1, 'a start on the 29th-31st should default to "Last", not a 5th that skips months');
    assert.deepEqual(r.dates, ['2026-10-30', '2026-11-27', '2026-12-25', '2027-01-29']);
  });

  test(`${component}: 31 January does not drift to 3 March`, async () => {
    const r = await saveMonthly(component, { date: '2027-01-31', until: '2027-04-30' });
    assert.ok(!r.dates.includes('2027-03-03'), 'THE DEFECT: 31 Jan + 1 month rolled over into March');
    assert.deepEqual(r.dates, ['2027-01-31', '2027-02-28', '2027-03-28', '2027-04-25'], 'the last Sunday of each month');
  });

  test(`${component}: the week follows the date until the steward picks one, and a pick is kept`, async () => {
    const reseeded = await saveMonthly(component, { date: '2026-10-13', changeDateTo: '2026-10-30', until: '2026-12-31' });
    assert.equal(reseeded.shown, -1, 'changing the date did not re-seed the week');
    assert.deepEqual(reseeded.dates, ['2026-10-30', '2026-11-27', '2026-12-25']);
    const picked = await saveMonthly(component, { date: '2026-10-13', pick: 1, changeDateTo: '2026-10-14', until: '2027-01-31' });
    assert.equal(picked.shown, 1, 'the steward\'s explicit pick was overwritten by a date change');
    // 14 Oct is a Wednesday; the 1st Wednesdays after it. The start is always kept — it is the date typed.
    assert.deepEqual(picked.dates, ['2026-10-14', '2026-11-04', '2026-12-02', '2027-01-06'],
      'the picked week did not reach the published dates');
    const labels = picked.options.map(o => [o.props.value, o.props.children.join('')]);
    assert.ok(labels.some(([v, l]) => v === -1 && l === 'Last'), 'the picker offers no "Last" option');
  });
}

test('SchEventEdit keeps a "Last" meeting as Last when it is saved', async () => {
  let sent = null;
  const m = mountSched('SchEventEdit', { onClose() {}, event: { id: 'e1', title: 'Prayer', date: '2026-10-30', time: '19:30', recur: 'monthly', day: 5, nth: -1 } },
    { publishEvent: async (e) => { sent = e; return { id: 'e1' }; } });
  const sel = m.byLabel('Which week');
  assert.ok(sel, 'the edit dialog has no "Which week" picker — re-anchor');
  assert.equal(sel.props.value, -1);
  assert.ok(m.nodes().some(n => n.type === 'option' && n.props.value === -1), 'the edit dialog cannot show "Last" — the select would show some other week');
  const save = m.nodes().find(n => n.type === 'button' && m.text(n) === 'Save changes');
  assert.ok(save, 're-anchor: no "Save changes" button');
  await save.props.onClick();
  assert.ok(sent, 're-anchor: Save did not publish');
  assert.equal(sent.nth, -1, 'saving the edit dialog changed a "Last" meeting');
});

// ── THE WIZARD: picker -> saveMeetings -> the shipped publishMeeting/publishEvent ───────────────────────────
function realWizMeetings() {
  const src = fnBody(CONSOLE, 'function WizMeetings({ meetings, setMeetings })', 'WizMeetings');
  const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat() } });
  return new Function('React', 'h', 'Frag', 'Icon', '_wizMeetingId', jsx(src) + '\nreturn WizMeetings;')({}, h, 'Frag', () => null, () => 'id');
}
function realSaveMeetings(scope) {
  // the arrow's body, executed with its free names resolved from `scope` (as a-new-church-can-finish-its-own-setup does)
  const at = DASH.indexOf('const saveMeetings = async () => {');
  assert.notEqual(at, -1, 'saveMeetings is gone — re-anchor');
  const body = fnBody(DASH, at + 'const saveMeetings = '.length, 'saveMeetings');
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('saveMeetings needs `' + String(k) + '` — add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('scope', `with (scope) { return (${body}); }`)(proxy);
}
// The SHIPPED publishMeeting and publishEvent, lifted out of vendor/steward.js, with the relay and the seal
// replaced by a recorder: the document handed to the seal is exactly what would be stored.
function realSteward(sealed) {
  const pe = stripComments(fnBody(VENDOR, 'async publishEvent(ev, asPub) {', 'publishEvent'));
  const pm = stripComments(fnBody(VENDOR, 'publishMeeting(m) {', 'publishMeeting'));
  const scope = {
    skFor: () => 'sk', _evtSeq: 0, EVENT_D: 'trinityone/event:', NET: 'trinityone', actingChurch: '',
    _sealChurchDocReady: async (doc) => { sealed.push(doc); return JSON.stringify(doc); },
    publish: async () => true, feChurch: (x) => x, now: () => 1, _todayISO: () => '2026-10-01',
  };
  const names = Object.keys(scope);
  return new Function(...names, `return { ${pe}, ${pm} };`)(...names.map(n => scope[n]));
}

for (const [label, value] of [['2nd', 2], ['Last', -1]]) {
  test(`wizard: choosing "${label}" reaches the stored meeting as nth ${value}`, async () => {
    let meetings = [{ id: 'm1', title: 'Elders', day: 6, time: '10:00', recur: 'monthly' }];
    const setMeetings = (f) => { meetings = typeof f === 'function' ? f(meetings) : f; };
    const tree = realWizMeetings()({ meetings, setMeetings });
    const flat = (n, out = []) => { if (Array.isArray(n)) n.forEach(x => flat(x, out)); else if (n && typeof n === 'object') { out.push(n); flat(n.props.children, out); } return out; };
    const all = flat(tree);
    const week = all.find(n => n.type === 'select' && flat(n.props.children).some(o => o.type === 'option' && o.props.children.join('') === '2nd'));
    assert.ok(week, 'the wizard shows no "Which week" picker for a monthly meeting — re-anchor');
    const opt = flat(week.props.children).find(o => o.type === 'option' && o.props.children.join('') === label);
    assert.ok(opt, `the wizard's picker has no "${label}" option`);
    week.props.onChange({ target: { value: String(opt.props.value) } });
    assert.equal(meetings[0].nth, value, 're-anchor: the picker did not set nth on the row');

    const sealed = [];
    const st = { advanced: 0, err: '' };
    const save = realSaveMeetings({
      meetings, setBusy() {}, setMeetingErr: (v) => { st.err = v; }, next: () => { st.advanced++; },
      localStorage: { getItem: () => null }, window: { Steward: realSteward(sealed) }, setTimeout, Promise,
    });
    await save();
    assert.equal(st.advanced, 1, 're-anchor: the wizard did not advance (' + st.err + ')');
    assert.equal(sealed.length, 1);
    assert.equal(sealed[0].recur, 'monthly');
    assert.equal(sealed[0].nth, value,
      `THE DEFECT: the steward chose "${label}" and the stored meeting says nth ${sealed[0].nth} — every member's calendar shows the 1st`);
  });
}
