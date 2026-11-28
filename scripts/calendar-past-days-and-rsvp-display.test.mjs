// CALENDAR: past days grayed out, DashCalendar "RSVP off" display, SchEventEdit noRsvp checkbox.
// Run: node --test scripts/calendar-past-days-and-rsvp-display.test.mjs
//
// Point-of-use (CLAUDE.md rule 1): the REAL DashCalendar and SchEventEdit are loaded from
// app/stew-schedule.jsx via eval and DRAWN through a minimal React harness. Tests read the
// rendered tree — nothing matches text in app/*.jsx (rule 3).
//
// Users of what changed (rule 2): DashCalendar's cell renderer reads isPast for opacity.
// SchEventEdit reads/writes noRsvp state from the event prop and passes it to publishEvent.
// No other caller of these rendering paths is affected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCHED = read('../app/stew-schedule.jsx');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat(Infinity) } });
const walk = (n, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(x => walk(x, out)); return out; }
  out.push(n); walk(n.props && n.props.children, out); return out;
};
const text = (n) => (Array.isArray(n) ? n.map(text).join('') : (n && typeof n === 'object') ? text(n.props && n.props.children) : (n == null || n === false ? '' : String(n)));
const expand = (n) => {
  if (Array.isArray(n)) return n.map(expand);
  if (!n || typeof n !== 'object') return n;
  if (typeof n.type === 'function') try { return expand(n.type(n.props)); } catch { return n; }
  return { ...n, props: { ...n.props, children: expand(n.props.children) } };
};
const flat = (n, out = []) => { if (Array.isArray(n)) n.forEach(x => flat(x, out)); else if (n && typeof n === 'object') { out.push(n); flat(n.props.children, out); } return out; };

// ── DashCalendar mount ───────────────────────────────────────────────────────────────────────────────
function mountDashCalendar(opts = {}) {
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: 'Frag',
  };
  const events = opts.events || [];
  const window = {
    useStewardServices: () => opts.services || [],
    useStewardEvents: () => events,
    expandEvents: (evs) => evs,
    useStewardRotas: () => [], useStewardRosters: () => [],
    useStewardGroups: () => [], useStewardRsvps: () => opts.rsvps || {},
    useStewardRequests: () => [], useStewardRequestReplies: () => [],
    useStewardBlocked: () => [], useStewardMembers: () => [],
    useStewardBookings: () => [], useStewardRooms: () => [],
    useStewardRunsheets: () => [],
    Steward: { publishEvent: async () => ({}), removeEvent: async () => {}, publishService: async () => ({}), setWebsiteHeld: null, isDelegated: () => false },
    matchMedia: () => ({ matches: false }),
  };
  const scope = {
    React, h, Frag: 'Frag', window, Icon: () => null,
    useStewDialog: () => ({ current: null }),
    SkConfirm: () => null, CustomEvent: class {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => '' }), addEventListener() {}, removeEventListener() {} },
    Image: class { set src(v) {} },
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(SCHED) + '\nreturn { DashCalendar };')(...names.map(n => scope[n]));
  const render = () => { idx = 0; return mod.DashCalendar({}); };
  return { render, states };
}

// ── 1. Past days render at reduced opacity ───────────────────────────────────────────────────────────
test('DashCalendar: past day cells have opacity 0.4, today and future have opacity 1', () => {
  const { render } = mountDashCalendar();
  const tree = render();
  const all = flat(tree);
  const dayCells = all.filter(n => n.type === 'button' && n.props && n.props.title && n.props.title.startsWith('See what'));
  assert.ok(dayCells.length > 0, 'no day cells found');

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayDay = today.getDate();

  let foundPast = false;
  let foundFutureOrToday = false;
  for (const cell of dayCells) {
    const dayNum = flat(expand(cell)).find(n => n.type === 'div' && n.props && n.props.style && n.props.style.fontSize === 12 && n.props.style.fontWeight === 700);
    if (!dayNum) continue;
    const d = Number(text(dayNum));
    if (isNaN(d)) continue;
    const op = cell.props.style.opacity;
    if (d < todayDay) {
      assert.equal(op, 0.4, `day ${d} is past but opacity is ${op}, expected 0.4`);
      foundPast = true;
    } else if (d >= todayDay) {
      assert.equal(op, 1, `day ${d} is today or future but opacity is ${op}, expected 1`);
      foundFutureOrToday = true;
    }
  }
  assert.ok(foundPast, 'no past day cells found to verify — test needs a date with past days in the month');
  assert.ok(foundFutureOrToday, 'no future/today cells found');
});

// ── 2. DashCalendar event card shows "RSVP off" when noRsvp is true ──────────────────────────────────
test('DashCalendar: event card shows "RSVP off" when noRsvp is true', () => {
  const today = new Date();
  const futureDay = today.getDate() + 2 > 28 ? today.getDate() - 2 : today.getDate() + 2;
  const futureKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(futureDay).padStart(2, '0')}`;
  const { render, states } = mountDashCalendar({
    events: [{ id: 'ev-rsvp-off', title: 'No-RSVP Event', date: futureKey, noRsvp: true, accent: '#888' }],
  });
  render();
  // states[4] is pickedDay (useState #5 in DashCalendar: moves, dragOverKey, view, pickedDay)
  // Find pickedDay index: moves=0, dragOverKey=1, view=2, pickedDay=3
  states[3] = futureKey;
  const tree2 = render();
  const nodes = flat(expand(tree2));
  const allText = nodes.map(n => text(n)).join(' ');
  assert.ok(allText.includes('RSVP off'), 'DashCalendar picked-day detail should show "RSVP off" for a noRsvp event; got: ' + allText.slice(0, 300));
});

// ── 3. SchEventEdit: noRsvp checkbox exists and respects the event prop ──────────────────────────────
function mountSchEventEdit(event, steward = {}) {
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: 'Frag',
  };
  const window = {
    Steward: { publishEvent: steward.publishEvent || (async () => ({ id: 'evt1' })), removeEvent: async () => {}, setWebsiteHeld: null, isDelegated: () => false, ...steward },
    useStewardEvents: () => [], useStewardGroups: () => [], NETWORKS_ENABLED: false,
  };
  const scope = {
    React, h, Frag: 'Frag', window, Icon: () => null,
    useStewDialog: () => ({ current: null }),
    SchModal: (p) => h('modal', {}, p.footer, p.children),
    SkConfirm: () => null, CustomEvent: class {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => '' }) },
    Image: class { set src(v) {} },
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(SCHED) + '\nreturn { SchEventEdit };')(...names.map(n => scope[n]));
  const render = () => { idx = 0; return flat(expand(mod.SchEventEdit({ event, onClose: () => {} }))); };
  return { render, states };
}

test('SchEventEdit: noRsvp checkbox is checked when event has noRsvp true', () => {
  const { render } = mountSchEventEdit({ id: 'ev1', title: 'Picnic', date: '2026-12-01', noRsvp: true, accent: '#888' });
  const nodes = render();
  const checkbox = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === 'No RSVP');
  assert.ok(checkbox, 'No RSVP checkbox not found in SchEventEdit');
  assert.equal(checkbox.props.checked, true, 'No RSVP checkbox should be checked when event.noRsvp is true');
});

test('SchEventEdit: toggling noRsvp on and saving passes noRsvp to publishEvent', async () => {
  const published = [];
  const { render } = mountSchEventEdit(
    { id: 'ev2', title: 'Picnic', date: '2026-12-01', noRsvp: false, accent: '#888' },
    { publishEvent: async (ev) => { published.push(ev); return { id: 'ev2', ...ev }; } },
  );
  let nodes = render();
  const checkbox = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === 'No RSVP');
  assert.ok(checkbox, 'No RSVP checkbox not found');
  checkbox.props.onChange({ target: { checked: true } });

  nodes = render();
  const saveBtn = nodes.find(n => n.type === 'button' && text(n).includes('Save'));
  assert.ok(saveBtn, 'Save button not found');
  await saveBtn.props.onClick();

  assert.ok(published.length > 0, 'publishEvent was not called');
  assert.equal(published[0].noRsvp, true, 'noRsvp should be true after toggling on');
});
