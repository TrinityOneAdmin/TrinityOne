// A REPEATING EVENT'S TIME IS SET ONCE, SAID SO, AND REMEMBERED. Sim round 2026-10-02, finding #50 ("monthly event time
// defaults to 19:30, and fixing it means editing each occurrence").
// Run: node --test scripts/a-repeating-event-time-is-set-once-and-remembered.test.mjs
//
// The New event form publishes one event PER DATE of a repeat, all with the one Time typed in the form - so the time IS
// editable once for every occurrence, but only before Save. Two things made that invisible: the field opened at 19:30
// whatever the church actually meets at, and nothing said the one time applied to every date. A steward who missed it
// had four published events and had to edit each. Now: the field opens at the time this console last saved an event with
// (falling back to 19:30 the first time), and when a repeat will publish more than one date the form says that all of
// them use this time.
//
// NOT CHANGED: editing an already-published event still changes only that event (each date is its own document).
// Offering "apply to the rest of the series" there would republish sibling events, each with its own image, group and
// website opt-out; that is a larger change than this fix and is left for the owner to ask for.
//
// Users of the changed code (rule 2): the default time and the hint are read only inside SchEventModal (its Time
// input, its clash check, its save). The remembered value is written by SchEventModal.save only, to
// localStorage 'trinityone.steward.eventTime', and read by SchEventModal only.
//
// HOW IT ASSERTS (rule 3): the real SchEventModal is compiled and drawn; the Time input and the words on the form are
// read, and the real Save button is pressed to see what is remembered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const JS = transformSync(readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8'),
  { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });

function mount({ stored = null } = {}) {
  const store = stored == null ? {} : { 'trinityone.steward.eventTime': stored };
  const writes = [];
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: () => ({ current: null }), useMemo: (f) => f(), createElement: h,
  };
  const published = [];
  const real = {
    useStewardGroups: () => [], useStewardEvents: () => [],
    Steward: { publishEvent: async (e) => { published.push(e); return { id: 'e' + published.length }; }, isDelegated: () => false },
    expandEvents: () => [],
  };
  const win = new Proxy(real, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('useSteward')) return () => []; return undefined; }, has: () => true });
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); writes.push([k, String(v)]); } };
  const scope = { React, h, Frag: 'Frag', Icon: () => null, SchModal: (p) => h('modal', p), useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-03', window: win, localStorage, document: { addEventListener() {}, removeEventListener() {} } };
  const names = Object.keys(scope);
  const { SchEventModal } = new Function(...names, JS + '\nreturn { SchEventModal };')(...names.map(n => scope[n]));
  const draw = () => { idx = 0; return SchEventModal({ day: '2026-11-06', onClose() {} }); };
  const walk = (n, out = []) => { if (n == null || typeof n !== 'object') { if (typeof n === 'string' || typeof n === 'number') out.push(n); return out; } if (Array.isArray(n)) { n.forEach(x => walk(x, out)); return out; } out.push(n); walk(n.props && n.props.children, out); return out; };
  // `footer` of the SchModal stub is a prop holding the Save button
  const nodes = () => { const t = draw(); const all = walk(t); (t.props && t.props.footer) && walk(t.props.footer, all); return all; };
  const text = () => nodes().filter(x => typeof x === 'string' || typeof x === 'number').join(' ').replace(/\s+/g, ' ');
  const input = (label) => nodes().find(n => n && n.props && n.props['aria-label'] === label);
  return { nodes, text, input, store, writes, published, states, draw };
}
const press = (m, re) => { const b = m.nodes().find(n => n && n.props && typeof n.props.onClick === 'function' && re.test(String(walkText(n)))); assert.ok(b, 'no button matching ' + re); return b.props.onClick(); };
const walkText = (n) => { const out = []; (function w(x) { if (x == null) return; if (typeof x === 'string' || typeof x === 'number') { out.push(x); return; } if (Array.isArray(x)) { x.forEach(w); return; } if (x.props) w(x.props.children); })(n); return out.join(' '); };

test('the first time, the Time field opens at 19:30', () => {
  assert.equal(mount().input('Time').props.value, '19:30');
});

test('after that it opens at the time this console last saved an event with', () => {
  assert.equal(mount({ stored: '10:30' }).input('Time').props.value, '10:30', 'THE DEFECT: the form ignores the time the church has been using');
});

test('a stored value that is not a time is ignored, not shown', () => {
  assert.equal(mount({ stored: 'later' }).input('Time').props.value, '19:30');
});

test('saving an event remembers its time', async () => {
  const m = mount();
  m.input('Title').props.onChange({ target: { value: 'Prayer breakfast' } });
  m.input('Time').props.onChange({ target: { value: '09:00' } });
  await press(m, /^\s*Add\b|Save|Add event|Publish/i);
  assert.equal(m.published.length, 1, 'the save did not publish - re-anchor this test (button label?)');
  assert.deepEqual(m.writes, [['trinityone.steward.eventTime', '09:00']]);
});

test('a repeat that will publish several dates says they all use this time; a single date does not', () => {
  const once = mount();
  assert.doesNotMatch(once.text(), /all use this time|every date/i, 'a one-off event carries a note about repeats');
  const rep = mount();
  // The Repeat control is its own component (SchRepeatRow); this harness does not expand children, so the real
  // setters the modal hands it are called directly - the same functions its Weekly button and Until box call.
  const row = rep.nodes().find(n => n && n.type && n.type.name === 'SchRepeatRow');
  assert.ok(row, 'the form has no repeat control - re-anchor this test');
  row.props.setRepeat('weekly'); row.props.setUntil('2026-11-27');
  assert.match(rep.text(), /all 4 dates use this time/i, 'a four-date repeat does not say the one time applies to every date. On screen: ' + rep.text().slice(0, 400));
});
