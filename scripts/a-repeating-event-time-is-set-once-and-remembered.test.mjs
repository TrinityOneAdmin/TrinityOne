// A REPEATING EVENT'S TIME IS SET ONCE, SAID SO, AND REMEMBERED. Sim round 2026-10-02, finding #50 ("monthly event time
// defaults to 19:30, and fixing it means editing each occurrence").
// Run: node --test scripts/a-repeating-event-time-is-set-once-and-remembered.test.mjs
//
// (HISTORY - superseded 2026-11-23, see the last test: a repeat is now ONE recurring event, not one event per date.)
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
// The Title is now a SchAutoInput component (autocomplete), not a bare <input>: this harness does not expand children, so
// the real setter the modal hands it is called with the typed text - the same call its inner <input> onChange makes.
const typeTitle = (m, v) => { const f = m.nodes().find(n => n && n.type && n.type.name === 'SchAutoInput' && n.props && n.props.label === 'Title'); assert.ok(f, 'the form has no Title field - re-anchor this test'); f.props.onChange(v); };
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
  typeTitle(m, 'Prayer breakfast');
  m.input('Time').props.onChange({ target: { value: '09:00' } });
  await press(m, /^\s*Add\b|Save|Add event|Publish/i);
  assert.equal(m.published.length, 1, 'the save did not publish - re-anchor this test (button label?)');
  assert.deepEqual(m.writes, [['trinityone.steward.eventTime', '09:00']]);
});

// CHANGED 2026-11-23 (fix/suite-confirm-dialogs): a repeat in the New event form is now ONE recurring event (recur/day
// on a single document), not one event per date. So there are no "N dates" for the one Time to apply to: the "All N
// dates use this time" note and the Until box are gone for a repeat, the form says the event repeats instead, and the
// one Time typed is the series' time. This used to assert the "all 4 dates use this time" note.
test('a repeat is ONE recurring event at the one Time typed; the form says it repeats and carries no "all N dates" note', async () => {
  const once = mount();
  assert.doesNotMatch(once.text(), /all use this time|every date|dates use this time|This event repeats/i, 'a one-off event carries a note about repeats');
  const rep = mount();
  // The Repeat control is its own component (SchRepeatRow); this harness does not expand children, so the real
  // setter the modal hands it is called directly - the same function its Weekly button calls.
  const findRow = () => rep.nodes().find(n => n && n.type && n.type.name === 'SchRepeatRow');
  assert.ok(findRow(), 'the form has no repeat control - re-anchor this test');
  assert.ok(!findRow().props.hideUntil, 'a one-off form hides Until before any repeat is chosen');
  findRow().props.setRepeat('weekly');
  assert.equal(findRow().props.hideUntil, true, 'a repeating event still offers an Until box, though it is saved as one open-ended series');
  assert.doesNotMatch(rep.text(), /dates use this time/i, 'a series still talks about "N dates". On screen: ' + rep.text().slice(0, 400));
  assert.match(rep.text(), /This event repeats weekly/i, 'a weekly repeat does not say that it repeats. On screen: ' + rep.text().slice(0, 400));
  typeTitle(rep, 'Prayer breakfast');
  rep.input('Time').props.onChange({ target: { value: '09:00' } });
  await press(rep, /^\s*Add\b|Save|Add event|Publish/i);
  assert.equal(rep.published.length, 1, 'a weekly repeat must publish ONE recurring event, not one per date');
  const ev = rep.published[0];
  assert.equal(ev.recur, 'weekly');
  assert.equal(ev.date, '2026-11-06');
  assert.equal(ev.day, new Date('2026-11-06T12:00:00').getDay(), 'the series repeats on the weekday of its first date');
  assert.equal(ev.time, '09:00', 'the one Time typed is the time of the whole series');
  assert.deepEqual(rep.writes, [['trinityone.steward.eventTime', '09:00']], 'saving a series remembers its time too');
});
