// THE ROTA VISIBILITY / AUTO-CONFIRM MENU: a tap shows the new state AT ONCE and the menu stays open; a refused
// write reverts (no false "saved"). Run: node --test scripts/the-rota-visibility-menu-is-optimistic-and-stays-open.test.mjs
//
// POINT OF USE (CLAUDE.md rules 1 & 3). This MOUNTS the real DashRota out of app/stew-schedule.jsx and PRESSES its
// real controls; no text is matched in the .jsx (it ships unbundled, so `false && ` would leave every word in
// place). The handlers are EXECUTED, so deleting the fix fails the test:
//   • the old code called closeVisMenu() synchronously on tap, so the popup shut — this asserts the switch is STILL
//     in the tree after the tap (the menu stayed open);
//   • the old code had no optimistic state (autoConfirm/rotaVis came straight off the relay-round-tripped doc) — this
//     asserts the switch reads its new value immediately after the tap, before any ack;
//   • CRITICAL (two-controls-that-report-false-success): a publish no relay accepted (resolves null) must REVERT the
//     optimistic state — this taps with a failing publish and asserts the switch snaps back and an error shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const JS = transformSync(readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8'),
  { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });

const SERVICE = { id: 'svc1', date: '2026-09-13', time: '10:30', name: 'Sunday Gathering' };
const ROSTER = { id: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [], pods: [] };
const ROTAS = [{ id: SERVICE.id, service: SERVICE.id, published: false, assign: {} }];

function mount({ rotaSettings = { visibility: 'church' }, publish = async () => ({ visibility: 'church', autoConfirm: true }) } = {}) {
  const calls = [];       // every publishRotaSettings(patch)
  const states = [];
  let idx = 0;
  const React = {
    useState(init) {
      const i = idx++;
      if (states.length <= i) states.push(typeof init === 'function' ? init() : init);
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useEffect() {}, useRef: () => ({ current: null }), useMemo: (f) => f(), createElement: h,
  };
  const real = {
    useStewardGroups: () => [{ id: 't1', kind: 'team', name: 'Welcome', accent: 'var(--clay)' }],
    useStewardRosters: () => [ROSTER],
    useStewardServices: () => [SERVICE],
    useStewardRotas: () => ROTAS,
    useStewardRotaSettings: () => rotaSettings,
    Steward: {
      publishRotaSettings: async (patch) => { calls.push(patch); return publish(patch); },
    },
  };
  real.confirm = () => true;
  const win = new Proxy(real, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && k.startsWith('useSteward')) return () => [];
      return undefined;
    },
    has: () => true,
  });
  const scope = {
    React, h, Frag: 'Frag', Icon: () => null, SchModal: (p) => h('modal', p),
    useStewDialog: () => ({ current: null }), todayISO: () => '2026-09-05',
    window: win, document: { addEventListener() {}, removeEventListener() {} },
  };
  const names = Object.keys(scope);
  const { DashRota } = new Function(...names, JS + '\nreturn { DashRota };')(...names.map(n => scope[n]));
  const render = () => { idx = 0; return DashRota({ onNewTeam() {} }); };
  const walk = (n, out = []) => {
    if (!n || typeof n !== 'object') return out;
    if (Array.isArray(n)) { n.forEach(x => walk(x, out)); return out; }
    out.push(n); walk(n.props && n.props.children, out); return out;
  };
  const nodes = () => walk(render());
  const allText = () => {
    const out = [];
    const go = (v) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(go); else if (v && typeof v === 'object' && v.props) go(v.props.children); };
    nodes().forEach(n => { if (n.props) go(n.props.children); });
    return out.join(' ');
  };
  const opener = () => nodes().find(n => n.props && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('Who can see the rota'));
  const theSwitch = () => nodes().find(n => n.props && n.props.role === 'switch');
  const option = (label) => nodes().find(n => n.props && n.props['aria-pressed'] !== undefined && walk(n).some(x => x.props && Array.isArray(x.props.children) && x.props.children.some(c => typeof c === 'string' && c.includes(label))));
  const click = (node) => { assert.ok(node, 're-anchor: control not found'); node.props.onClick({ stopPropagation() {}, preventDefault() {} }); };
  return { render, nodes, allText, opener, theSwitch, option, click, calls };
}

test('anchor: the visibility opener and (once open) the auto-confirm switch are reachable', () => {
  const m = mount();
  assert.ok(m.opener(), 'no "Who can see the rota" opener on the rota board — re-anchor');
  m.click(m.opener()); m.render();
  assert.ok(m.theSwitch(), 'the auto-confirm switch did not appear when the menu opened');
});

test('tapping the auto-confirm switch keeps the menu OPEN and flips the state at once (optimistic)', () => {
  const m = mount({ rotaSettings: { visibility: 'church', autoConfirm: false } });
  m.click(m.opener()); m.render();
  assert.equal(m.theSwitch().props['aria-checked'], false, 'staging: auto-confirm should start OFF');
  m.click(m.theSwitch()); m.render();
  assert.ok(m.theSwitch(), 'the menu CLOSED on tap — the switch vanished (closeVisMenu must not run on the toggle)');
  assert.equal(m.theSwitch().props['aria-checked'], true, 'the switch did not flip immediately — no optimistic state');
  assert.equal(m.calls.length, 1, 'the real publishRotaSettings was not called');
  assert.equal(m.calls[0].autoConfirm, true, 'publishRotaSettings was not asked to turn auto-confirm on');
});

test('a visibility option flips optimistically and leaves the menu open', () => {
  const m = mount({ rotaSettings: { visibility: 'church', autoConfirm: false } });
  m.click(m.opener()); m.render();
  const team = m.option('People on the serving teams');
  assert.ok(team, 'the "serving teams" option is missing');
  assert.equal(team.props['aria-pressed'], false, 'staging: "team" should not be the current visibility');
  m.click(team); m.render();
  assert.ok(m.theSwitch(), 'the menu closed when a visibility option was chosen');
  assert.ok(m.option('People on the serving teams').props['aria-pressed'], 'the chosen visibility did not take effect optimistically');
  assert.equal(m.calls[0].visibility, 'team', 'publishRotaSettings was not asked for team visibility');
});

test('NO FALSE SUCCESS: a publish no relay accepted (null) reverts the switch and shows an error', async () => {
  const m = mount({ rotaSettings: { visibility: 'church', autoConfirm: false }, publish: async () => null });
  m.click(m.opener()); m.render();
  m.click(m.theSwitch()); m.render();
  assert.equal(m.theSwitch().props['aria-checked'], true, 'staging: the switch should show the optimistic ON before the ack');
  await new Promise(r => setImmediate(r));   // let the failing publish resolve
  m.render();
  assert.equal(m.theSwitch().props['aria-checked'], false,
    'THE SAFETY RULE: the write was refused by every relay, yet the switch stayed ON — a control reported success it never had');
  assert.ok(m.theSwitch(), 'the menu should stay open to show the revert');
  assert.match(m.allText(), /Couldn’t save/, 'no error was shown after the refused write');
});
