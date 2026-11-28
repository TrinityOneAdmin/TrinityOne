// RSVP TOGGLE: a steward can mark an event "No RSVP", which hides RSVP buttons from members.
// Run: node --test scripts/event-rsvp-toggle.test.mjs
//
// POINT OF USE (CLAUDE.md rule 1) and NO TEXT-MATCHING JSX (rule 3): these tests LIFT the real components
// out of their files and RUN them through a minimal React harness. Nothing asserts behaviour by matching
// source text — the assertions read the rendered tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody } from './test-slice.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SERVING = read('../app/screens-serving.jsx');
const SCHED = read('../app/stew-schedule.jsx');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

// ── tree helpers ──────────────────────────────────────────────────────────────────────────────────────────
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
  if (typeof n.type === 'function') return expand(n.type(n.props));
  return { ...n, props: { ...n.props, children: expand(n.props.children) } };
};
const flat = (n, out = []) => { if (Array.isArray(n)) n.forEach(x => flat(x, out)); else if (n && typeof n === 'object') { out.push(n); flat(n.props.children, out); } return out; };

// ── 1. EventDetail (screens-serving.jsx): noRsvp hides Going/Maybe/Can't ─────────────────────────────────
function renderEventDetail(event) {
  const src = jsx(fnBody(SERVING, 'function EventDetail(', 'EventDetail'));
  const scope = { h, Frag: 'Frag', React: { Fragment: 'Frag' }, Icon: () => null, ServDateBlock: () => null,
    BottomSheet: 'sheet', SvNetFrom: () => null };
  const names = Object.keys(scope);
  const EventDetail = new Function(...names, src + '\nreturn EventDetail;')(...names.map(n => scope[n]));
  const tree = EventDetail({ event, open: true, onClose: () => {}, ctx: { myRsvps: {} } });
  const nodes = walk(tree);
  const buttons = nodes.filter(n => n.type === 'button');
  const allText = nodes.map(n => (typeof n.props?.children === 'string' ? n.props.children : '')).join(' ');
  return { nodes, buttons, allText };
}

test('EventDetail: noRsvp hides Going/Maybe/Can\'t buttons', () => {
  const r = renderEventDetail({ id: 'ev1', title: 'Picnic', noRsvp: true });
  const rsvpButtons = r.buttons.filter(b => {
    const t = text(b);
    return t === 'Going' || t === 'Maybe' || t === "Can’t";
  });
  assert.equal(rsvpButtons.length, 0, 'RSVP buttons should be hidden when noRsvp is true, but found: ' + rsvpButtons.map(b => text(b)));
});

test('EventDetail: buttons present when noRsvp is absent', () => {
  const r = renderEventDetail({ id: 'ev2', title: 'Picnic' });
  const rsvpButtons = r.buttons.filter(b => {
    const t = text(b);
    return t === 'Going' || t === 'Maybe' || t === "Can’t";
  });
  assert.equal(rsvpButtons.length, 3, 'Going/Maybe/Can\'t buttons should be present when noRsvp is absent');
});

test('EventDetail: noRsvp false still shows buttons', () => {
  const r = renderEventDetail({ id: 'ev3', title: 'Picnic', noRsvp: false });
  const rsvpButtons = r.buttons.filter(b => {
    const t = text(b);
    return t === 'Going' || t === 'Maybe' || t === "Can’t";
  });
  assert.equal(rsvpButtons.length, 3, 'Going/Maybe/Can\'t buttons should be present when noRsvp is false');
});

// ── 2. svEventRsvpRow (screens-serving.jsx): returns null when noRsvp ─────────────────────────────────────
test('svEventRsvpRow returns null when e.noRsvp is true', () => {
  const src = jsx(fnBody(SERVING, 'function svEventRsvpRow(', 'svEventRsvpRow'));
  const RSVP_WORD = { going: "You’re going", maybe: 'You said maybe', no: "You can’t make it" };
  const scope = { h, Frag: 'Frag', React: { Fragment: 'Frag' }, Icon: () => null, RSVP_WORD };
  const names = Object.keys(scope);
  const svEventRsvpRow = new Function(...names, src + '\nreturn svEventRsvpRow;')(...names.map(n => scope[n]));
  const result = svEventRsvpRow({ e: { id: 'ev1', noRsvp: true }, rsvps: {}, ctx: {} });
  assert.equal(result, null, 'svEventRsvpRow should return null when noRsvp is true');
});

test('svEventRsvpRow renders when noRsvp is absent', () => {
  const src = jsx(fnBody(SERVING, 'function svEventRsvpRow(', 'svEventRsvpRow'));
  const RSVP_WORD = { going: "You’re going", maybe: 'You said maybe', no: "You can’t make it" };
  const scope = { h, Frag: 'Frag', React: { Fragment: 'Frag' }, Icon: () => null, RSVP_WORD };
  const names = Object.keys(scope);
  const svEventRsvpRow = new Function(...names, src + '\nreturn svEventRsvpRow;')(...names.map(n => scope[n]));
  const result = svEventRsvpRow({ e: { id: 'ev1' }, rsvps: {}, ctx: {} });
  assert.notEqual(result, null, 'svEventRsvpRow should render when noRsvp is absent');
});

// ── 3. SchEventModal (stew-schedule.jsx): "No RSVP" checkbox exists and passes noRsvp to publishEvent ─────
function mountSchEventModal(steward = {}) {
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: 'Frag',
  };
  const window = {
    Steward: { publishEvent: steward.publishEvent || (async () => ({ id: 'evt1' })), setWebsiteHeld: null, isDelegated: () => false, ...steward },
    useStewardGroups: () => [], useStewardEvents: () => [], dispatchEvent() {}, NETWORKS_ENABLED: false,
  };
  const scope = {
    React, h, Frag: 'Frag', window, Icon: () => null, useStewDialog: () => ({ current: null }),
    SchModal: (p) => h('modal', {}, p.footer, p.children), CustomEvent: class {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => '' }) },
    Image: class { set src(v) {} },
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(SCHED) + '\nreturn { SchEventModal };')(...names.map(n => scope[n]));
  const render = () => { idx = 0; return flat(expand(mod.SchEventModal({ day: '2026-12-01', onClose: () => {} }))); };
  return { render, states };
}

test('SchEventModal: "No RSVP" checkbox exists and defaults unchecked', () => {
  const { render } = mountSchEventModal();
  const nodes = render();
  const checkbox = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === 'No RSVP');
  assert.ok(checkbox, 'No RSVP checkbox not found in SchEventModal');
  assert.equal(checkbox.props.checked, false, 'No RSVP checkbox should default unchecked');
});

test('SchEventModal: toggling "No RSVP" on and saving passes noRsvp to publishEvent', async () => {
  const published = [];
  const { render, states } = mountSchEventModal({
    publishEvent: async (ev) => { published.push(ev); return { id: 'evt1', ...ev }; },
  });
  let nodes = render();

  // Find and toggle the checkbox
  const checkbox = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === 'No RSVP');
  assert.ok(checkbox, 'No RSVP checkbox not found');
  checkbox.props.onChange({ target: { checked: true } });

  // Fill required fields: title and date are needed for save
  nodes = render();
  const titleInput = nodes.find(n => n.type === 'input' && n.props['aria-label'] === 'Title');
  assert.ok(titleInput, 'Title input not found');
  titleInput.props.onChange({ target: { value: 'Youth Night' } });

  // Re-render and find the save button — it says "Add event" or "Add meeting", not "Save"
  nodes = render();
  const saveBtn = nodes.find(n => n.type === 'button' && (text(n).includes('Add event') || text(n).includes('Add meeting')));
  assert.ok(saveBtn, 'Add event/meeting button not found');
  await saveBtn.props.onClick();

  assert.ok(published.length > 0, 'publishEvent was not called');
  assert.equal(published[0].noRsvp, true, 'noRsvp should be true when the toggle is on');
});

// ── 4. SchEventDetail (stew-schedule.jsx): noRsvp shows "RSVP is off" and hides "Who's coming" ───────────
function mountSchEventDetail(event) {
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: 'Frag',
  };
  const window = {
    Steward: { removeEvent() {} },
    useStewardRsvps: () => ({}), useStewardMembers: () => [],
  };
  const scope = {
    React, h, Frag: 'Frag', window, Icon: () => null, useStewDialog: () => ({ current: null }),
    SkConfirm: () => null,
    // Stubs the sub-components that SchEventDetail may render
    SchEventEdit: () => null, SchEventMessage: () => null, SchAttendance: () => null,
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(SCHED) + '\nreturn { SchEventDetail };')(...names.map(n => scope[n]));
  const render = () => { idx = 0; return flat(expand(mod.SchEventDetail({ event, onClose: () => {} }))); };
  return { render };
}

test('SchEventDetail: noRsvp shows "RSVP is off" and hides "Who\'s coming"', () => {
  const { render } = mountSchEventDetail({ id: 'ev1', title: 'Picnic', noRsvp: true });
  const nodes = render();
  const allText = nodes.map(n => text(n)).join(' ');
  assert.ok(allText.includes('RSVP is off'), 'Should show "RSVP is off" when noRsvp is true');
  assert.ok(!allText.includes("Who’s coming"), '"Who\'s coming" should be hidden when noRsvp is true');
});

test('SchEventDetail: "Who\'s coming" shown when noRsvp is absent', () => {
  const { render } = mountSchEventDetail({ id: 'ev2', title: 'Picnic' });
  const nodes = render();
  const allText = nodes.map(n => text(n)).join(' ');
  assert.ok(allText.includes("Who’s coming"), '"Who\'s coming" should be shown when noRsvp is absent');
  assert.ok(!allText.includes('RSVP is off'), 'Should NOT show "RSVP is off" when noRsvp is absent');
});
