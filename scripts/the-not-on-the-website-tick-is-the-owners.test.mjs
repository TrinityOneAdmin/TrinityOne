// THE "NOT ON THE WEBSITE" TICK IS DRAWN FOR THE CHURCH KEY AND FOR NOBODY ELSE, AND A TICK THAT DID NOT LAND IS SAID.
//   Run: node --test scripts/the-not-on-the-website-tick-is-the-owners.test.mjs
//
// The audit of 7ffcfaf (finding 5) showed the commit claimed "shown only when the console holds the church
// key" with nothing that bit: hiding the tick from a delegate could be deleted and every test stayed green.
// The relay refuses a delegate's share: write anyway, so the cost was a tick that silently did nothing — which
// is the failure this codebase specialises in. Two things are pinned here, both by RENDERING the real
// SchEventModal and SchEventEdit through a miniature React and reading the tree (CLAUDE.md rule 3: no text
// matching against app/*.jsx):
//   1. an owner console draws the tick; a delegated steward's console does not;
//   2. when the engine refuses to record the opt-out (it does so until it has read the church's share:
//      document), the dialog raises the console's steward-write-blocked banner rather than swallowing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const SRC = readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8');
const JS = transformSync(SRC, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

function mount(componentName, props, { steward = {}, preset = {}, events = [] } = {}) {
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(Object.prototype.hasOwnProperty.call(preset, i) ? preset[i] : (typeof init === 'function' ? init() : init)); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: () => ({ current: null }), useMemo: (f) => f(),
    Fragment: 'Frag',
  };
  const h = (type, props2, ...kids) => ({ type, props: { ...(props2 || {}), children: kids.flat() } });
  const dispatched = [];
  const win = { Steward: steward, useStewardGroups: () => [], useStewardEvents: () => events,
    dispatchEvent(e) { dispatched.push(e); return true; }, confirm: () => true };
  const scope = { React, h, Frag: 'Frag', Icon: () => null, SchModal: (p) => h('modal', p), useStewDialog: () => ({ current: null }), todayISO: () => '2026-09-22',
    window: win, CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } } };
  const names = Object.keys(scope);
  const mod = new Function(...names, JS + `\nreturn { ${componentName} };`)(...names.map(n => scope[n]));
  const render = () => { idx = 0; return mod[componentName](props); };
  // The walk EXPANDS function components (the tick lives in SchWebsiteHeldRow) and follows SchModal's `footer`
  // prop as well as `children` — the New event dialog's buttons sit in the footer, not the body.
  const nodes = (n, out = []) => {
    if (!n || typeof n !== 'object') return out;
    if (Array.isArray(n)) { n.forEach(x => nodes(x, out)); return out; }
    out.push(n);
    if (typeof n.type === 'function') { try { nodes(n.type(n.props), out); } catch (e) {} return out; }
    nodes(n.props && n.props.children, out); nodes(n.props && n.props.footer, out); return out;
  };
  return { render, states, nodes: () => nodes(render()), dispatched };
}
const tickOf = (m) => m.nodes().find(n => n.type === 'input' && n.props && n.props['aria-label'] === 'Not on the website');
const owner = (over = {}) => ({ isDelegated: () => false, setWebsiteHeld: async () => true, isWebsiteHeld: () => false, publishEvent: async (ev) => ({ id: 'evt1', ...ev }), ownedNetworks: () => [], ...over });

test('an owner console draws the tick in both dialogs', () => {
  assert.ok(tickOf(mount('SchEventModal', { day: '', onClose() {} }, { steward: owner() })), 'the New event dialog has no "Not on the website" tick for the church key');
  assert.ok(tickOf(mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01' }, onClose() {} }, { steward: owner() })), 'the Edit event dialog has no tick for the church key');
});

test('a delegated steward\'s console draws NO tick — the relay would refuse the write, so a tick would silently do nothing', () => {
  assert.equal(tickOf(mount('SchEventModal', { day: '', onClose() {} }, { steward: owner({ isDelegated: () => true }) })), undefined, 'THE TICK IS SHOWN TO A DELEGATE in the New event dialog');
  assert.equal(tickOf(mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01' }, onClose() {} }, { steward: owner({ isDelegated: () => true }) })), undefined, 'THE TICK IS SHOWN TO A DELEGATE in the Edit event dialog');
});

test('the Edit dialog opens with the tick reflecting what the church already recorded', () => {
  const held = tickOf(mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01' }, onClose() {} }, { steward: owner({ isWebsiteHeld: (id) => id === 'evt1' }) }));
  assert.equal(held.props.checked, true, 'an event the church holds off the website opens unticked');
});

test('a tick the engine refused to record is said through the console banner, and the event is still saved', async () => {
  let closed = false;
  // preset: SchEventModal's state order is title, date, time, where, blurb, accent, group, image, repeat, until, held
  const m = mount('SchEventModal', { day: '', onClose: () => { closed = true; } }, { steward: owner({ setWebsiteHeld: async () => false }), preset: { 0: 'Vestry meeting', 1: '2026-10-01', 10: true } });
  const add = m.nodes().find(n => n.props && typeof n.props.onClick === 'function' && n.props.disabled === false);
  assert.ok(add, 'no enabled Add button rendered — re-anchor (the preset state indices may have moved)');
  await add.props.onClick();
  assert.equal(closed, true, 'the event WAS saved, so the dialog must close as usual');
  const banner = m.dispatched.find(e => e.type === 'steward-write-blocked');
  assert.ok(banner, 'the opt-out was refused and nothing told the steward — the tick silently did nothing');
  assert.match(String(banner.detail && banner.detail.message), /Not on the website/, 'the banner does not name the tick that was lost');
});

test('CONTROL: a tick the engine recorded raises no banner', async () => {
  const m = mount('SchEventModal', { day: '', onClose() {} }, { steward: owner(), preset: { 0: 'Vestry meeting', 1: '2026-10-01', 10: true } });
  const add = m.nodes().find(n => n.props && typeof n.props.onClick === 'function' && n.props.disabled === false);
  await add.props.onClick();
  assert.equal(m.dispatched.some(e => e.type === 'steward-write-blocked'), false, 'a recorded tick raised the banner — the message would cry wolf');
});
