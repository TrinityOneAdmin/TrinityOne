// AN UNPUBLISHED ROTA DRAFT SURVIVES CLICKING AWAY AND BACK. Sim round 2026-10-02, finding #57.
// Run: node --test scripts/an-unsaved-rota-survives-leaving-the-page.test.mjs
//
// The rota board kept its edits in its own component state, so going to Calendar or Members and back unmounted
// it and every unpublished assignment went with it ("rota drafts vanish if you leave" - Ruth).
//
// The fix keeps drafts in a module-level store for as long as the console page is open, per church (memory
// only - a reload still clears it; Publish is still the only thing that asks anyone to do anything).
//
// Users of the changed code (rule 2): `draft` / `setDraft` are read and written only inside DashRota (assign,
// assignFor, copyLastWeek, applyPod, rotatePods, doAssign, clearSlot, autoFill). DashRota is mounted once, by the
// console's Rota page. The seeding effect now leaves an existing draft alone instead of replacing it with the
// published copy; for a first mount (empty store) it behaves as before.
//
// HOW IT RUNS (rule 3): the real stew-schedule.jsx is compiled ONCE and DashRota is drawn twice from the same
// module with fresh hook state each time - which is exactly what unmount-then-mount is. Nothing is matched in
// the source. The first mount presses the real "Copy last week" button; the second mount is read off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const JS = transformSync(readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8'),
  { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });

const EARLIER = { id: 'svc1', date: '2026-01-04', time: '10:30', name: 'Sunday Gathering' };
const LATER = { id: 'svc2', date: '2026-01-11', time: '10:30', name: 'Sunday Gathering' };
const ROSTER = { id: 't1', team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [{ id: 'p1', name: 'Ruth Bexley', pub: 'ab'.repeat(32) }], pods: [] };

let live = { church: 'church-A', rotas: [] };
const states = { cur: [], idx: 0, deps: [], ei: 0, queued: [] };
const React = {
  useState(init) {
    const i = states.idx++;
    if (states.cur.length <= i) states.cur.push(typeof init === 'function' ? init() : init);
    return [states.cur[i], (v) => { states.cur[i] = typeof v === 'function' ? v(states.cur[i]) : v; }];
  },
  // Effects REALLY RUN (after the draw that queued them, deps-compared): the draft is seeded from the published
  // rota by an effect, and a harness that skipped it would never see that seeding overwriting a restored draft.
  useEffect(fn, deps) {
    const i = states.ei++;
    const prev = states.deps[i];
    const same = Array.isArray(prev) && Array.isArray(deps) && prev.length === deps.length && prev.every((v, k) => Object.is(v, deps[k]));
    if (!same) { states.deps[i] = deps; states.queued.push(fn); }
  },
  useRef(init) { const i = states.idx++; if (states.cur.length <= i) states.cur.push({ current: init === undefined ? null : init }); return states.cur[i]; },
  useMemo: (f) => f(), createElement: h,
};
const real = {
  get Steward() { return { pubkey: live.church }; },
  useStewardGroups: () => [{ id: 't1', kind: 'team', name: 'Welcome', accent: 'var(--clay)' }],
  useStewardRosters: () => [ROSTER],
  useStewardServices: () => [EARLIER, LATER],
  useStewardRotas: () => live.rotas,
};
const win = new Proxy(real, {
  get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('useSteward')) return () => []; return undefined; },
  has: () => true,
});
const scope = {
  React, h, Frag: 'Frag', Icon: () => null, SchModal: (p) => h('modal', p), useStewDialog: () => ({ current: null }),
  todayISO: () => '2026-01-01', window: win, document: { addEventListener() {}, removeEventListener() {} },
};
const names = Object.keys(scope);
const { DashRota } = new Function(...names, JS + '\nreturn { DashRota };')(...names.map(n => scope[n]));

// A fresh mount: hook state is thrown away, the module (and so its store) is not.
const mount = () => { states.cur = []; states.idx = 0; states.deps = []; states.ei = 0; states.queued = []; };
const draw = () => {
  states.idx = 0; states.ei = 0; states.queued = [];
  const tree = DashRota({ onNewTeam() {} });
  const run = states.queued; states.queued = [];
  run.forEach(fn => fn());
  if (run.length) { states.idx = 0; states.ei = 0; states.queued = []; return DashRota({ onNewTeam() {} }); }   // the draw that sees what they set
  return tree;
};
const walk = (n, out = []) => {
  if (n == null || typeof n !== 'object') { if (typeof n === 'string' || typeof n === 'number') out.push(n); return out; }
  if (Array.isArray(n)) { n.forEach(x => walk(x, out)); return out; }
  out.push(n); walk(n.props && n.props.children, out); return out;
};
const textOf = (tree) => walk(tree).filter(x => typeof x === 'string' || typeof x === 'number').join(' ');
const press = (tree, title) => {
  const b = walk(tree).find(n => n && n.props && typeof n.props.onClick === 'function' && /Copy last week/.test(textOf(n.props.children)));
  assert.ok(b, 'no "Copy last week" button on the board - re-anchor this test');
  b.props.onClick();
};

test('an assignment made on the board is still there after leaving the page and coming back', () => {
  // svc1 has a published rota with Ruth on it; svc2 (the one the board opens on) has a published rota too, but
  // an empty one. That matters: the seeding effect copies a published rota into the draft, and the draft being
  // restored must not be overwritten by it - which only shows when the edited service HAS a published rota.
  live = { church: 'church-A', rotas: [
    { id: 'svc1', service: 'svc1', published: true, assign: { 't1::r1': { id: 'p1', name: 'Ruth Bexley', pub: 'ab'.repeat(32) } } },
    { id: 'svc2', service: 'svc2', published: true, assign: {} },
  ] };

  mount();
  let tree = draw();
  assert.doesNotMatch(textOf(tree), /Ruth Bexley/, 'control: svc2 should start with nobody on it - the fixture is wrong');
  press(tree, 'Copy last week');
  tree = draw();
  assert.match(textOf(tree), /Ruth Bexley/, 'control: Copy last week did not put anyone on svc2 - the test is not exercising the draft');

  mount();                       // leave the page and come back: the board is mounted from nothing
  tree = draw();
  assert.match(textOf(tree), /Ruth Bexley/,
    'THE DEFECT: the unpublished assignment was lost when the board was left and reopened');
});

test('a draft belongs to its church: another church’s board does not inherit it', () => {
  live = { church: 'church-B', rotas: [{ id: 'svc1', service: 'svc1', published: true, assign: {} }] };
  mount();
  const tree = draw();
  assert.doesNotMatch(textOf(tree), /Ruth Bexley/, 'church B opened church A’s unsaved rota');
});
