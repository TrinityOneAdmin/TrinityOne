// SERVING SCREEN: past events hidden from the "What's on" list on the member Events tab.
// Run: node --test scripts/serving-hides-past-events.test.mjs
//
// Point-of-use (CLAUDE.md rule 1): the REAL ServingScreen is loaded from app/screens-serving.jsx
// and DRAWN through a minimal React harness. Only future events should appear in the rendered
// output. If the filter is deleted from the screen, this test fails — that is the gate.
// No text-matching JSX (rule 3): assertions read the rendered tree.
//
// Users of changed code (rule 2): the past-event filter sits inline in ServingScreen's events tab
// rendering. No shared code changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SERVING = read('../app/screens-serving.jsx');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat(Infinity) } });
const text = (n) => (Array.isArray(n) ? n.map(text).join('') : (n && typeof n === 'object') ? text(n.props && n.props.children) : (n == null || n === false ? '' : String(n)));
const expand = (n) => {
  if (Array.isArray(n)) return n.map(expand);
  if (!n || typeof n !== 'object') return n;
  if (typeof n.type === 'function') try { return expand(n.type(n.props)); } catch { return n; }
  return { ...n, props: { ...n.props, children: expand(n.props.children) } };
};

// Build a today ISO string from the real clock (matches what svTodayIso() returns at render time).
function localISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Mount the REAL ServingScreen by evaluating the whole file (all module-scope helpers come along).
function mountServingScreen(events) {
  const states = []; let idx = 0;
  // Pre-seed first state (tab) to 'events' so the events section renders on the first pass.
  states.push('events');
  const React = {
    Fragment: 'Frag',
    useState(init) {
      const i = idx++;
      if (i >= states.length) states.push(typeof init === 'function' ? init() : init);
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useEffect() {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f,
  };
  const ctx = {
    churchEvents: events,
    churchServices: [],
    servConfirmed: [], servDeclined: [], servReqs: [],
    servNext: null, myRsvps: {}, myTeams: [],
    care: null, joinState: null, openEvent: () => {},
    church: { npub: 'npub1test' },
  };
  const scope = {
    React, h, Frag: 'Frag',
    Icon: () => null,
    IconBtn: () => null,
    BottomSheet: () => null,
    Overlay: (p) => h('overlay', {}, p.children),
    SectionLabel: (p) => h('section-label', {}, p.children),
    CareCard: () => null,
    SafetyBanner: () => null,
    QRScanner: () => null,
    window: { eventImgStyle: null, expandEvents: null, Fellowship: null,
              addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {} },
    navigator: { share: null },
    localStorage: { getItem: () => null, setItem: () => {} },
  };

  // Eval the WHOLE file so all module-scope helpers (svTodayIso, svParts, etc.) are defined.
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(SERVING) + '\nreturn { ServingScreen };')(...names.map(n => scope[n]));
  const render = () => { idx = 0; return mod.ServingScreen({ open: true, onClose: () => {}, ctx, docked: false }); };
  return { render };
}

test('ServingScreen events tab: past events are hidden, future events are shown', () => {
  const today = localISO(new Date());
  const d = new Date();
  const yesterday = new Date(d); yesterday.setDate(yesterday.getDate() - 1);
  const yIso = localISO(yesterday);
  const tomorrow = new Date(d); tomorrow.setDate(tomorrow.getDate() + 1);
  const tIso = localISO(tomorrow);
  const farFuture = '2099-12-31';

  const events = [
    { id: 'past1', title: 'Past Picnic', date: yIso, time: '10:00' },
    { id: 'past2', title: 'Old Meetup', date: '2020-01-01', time: '14:00' },
    { id: 'today1', title: 'Today Event', date: today, time: '19:00' },
    { id: 'future1', title: 'Tomorrow Gathering', date: tIso, time: '09:00' },
    { id: 'future2', title: 'Far Future Fest', date: farFuture, time: '11:00' },
  ];

  const { render } = mountServingScreen(events);
  const tree = render();
  const allText = text(expand(tree));

  // Future events and today's event MUST appear
  assert.ok(allText.includes('Today Event'), 'Today event should be visible');
  assert.ok(allText.includes('Tomorrow Gathering'), 'Tomorrow event should be visible');
  assert.ok(allText.includes('Far Future Fest'), 'Far future event should be visible');

  // Past events MUST NOT appear
  assert.ok(!allText.includes('Past Picnic'), 'Yesterday event should be hidden');
  assert.ok(!allText.includes('Old Meetup'), 'Old event from 2020 should be hidden');
});

test('ServingScreen events tab: locked events still show banner regardless of date', () => {
  const events = [
    { id: 'locked1', title: 'Locked Future', date: '2099-01-01', time: '10:00', _locked: true },
    { id: 'open1', title: 'Open Future', date: '2099-06-15', time: '14:00' },
  ];

  const { render } = mountServingScreen(events);
  const tree = render();
  const allText = text(expand(tree));

  assert.ok(allText.includes('Open Future'), 'Open future event should render');
  assert.ok(allText.includes("can’t open yet"), 'Locked events banner should appear');
});

test('ServingScreen events tab: an event with no date is hidden', () => {
  const events = [
    { id: 'nodate', title: 'No Date Event', date: '', time: '' },
    { id: 'good', title: 'Good Future Event', date: '2099-01-01', time: '12:00' },
  ];

  const { render } = mountServingScreen(events);
  const tree = render();
  const allText = text(expand(tree));

  assert.ok(!allText.includes('No Date Event'), 'Event with no date should be hidden');
  assert.ok(allText.includes('Good Future Event'), 'Future event should be visible');
});
