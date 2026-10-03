// MOUNT THE STEWARD'S ROTA BOARD (DashRota) AND ROSTER DIALOG (RosterModal) IN NODE, AND DRIVE THEM.
//
// Not a test (no `.test.mjs` suffix, so the runner does not collect it). Written for the Block B3 fixes of
// 2026-10-03 — a declined slot is not covered, auto-fill rotates, a roster save notices someone else's change —
// each of which has to be proved AT THE SCREEN (CLAUDE.md rule 1), and which cannot be proved by text-matching
// app/stew-schedule.jsx (rule 3: it ships unbundled, so `false &&` leaves every word in place).
//
// It compiles the REAL app/stew-schedule.jsx with esbuild, evaluates it with the handful of names it takes from
// other scripts, and hands back a render() that re-draws from the hook state the previous click left behind.
// The element shape is `{ type, props, kids }`, which is what scripts/render-jsx-screen.mjs's readers expect, so
// reads()/find()/button() from there work on the tree unchanged.
//
// What it is NOT: React. useEffect never runs (the board seeds its draft from the published rota in an effect,
// but falls back to the published rota when there is no draft, so nothing is lost for what these tests ask),
// function components are not expanded, and every draw is synchronous.
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { find, reads, texts } from './render-jsx-screen.mjs';

const JS = transformSync(readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8'),
  { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

export const h = (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) });

export function loadSchedule(extraScope = {}, extraWindow = {}, names = ['DashRota']) {
  const winBase = { confirm: () => true, ...extraWindow };
  const win = new Proxy(winBase, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && k.startsWith('useSteward')) return () => [];
      return undefined;
    },
    has: () => true,
  });
  let states = [], idx = 0, refs = [], ridx = 0;
  const React = {
    useState(init) {
      const i = idx++;
      if (states.length <= i) states[i] = (typeof init === 'function' ? init() : init);
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useEffect() {},
    useRef(init) { const i = ridx++; if (!refs[i]) refs[i] = { current: init === undefined ? null : init }; return refs[i]; },
    useMemo: (f) => f(),
    createElement: h,
    Fragment: 'Fragment',
  };
  const scope = {
    React, h, Frag: 'Fragment', Icon: function Icon() { return null; }, SchModal: function SchModal(p) { return null; },
    SchNotSaved: function SchNotSaved() { return null; },
    useStewDialog: () => ({ current: null }), useStewNarrow: () => false, todayISO: () => '2026-09-05',
    window: win, document: { addEventListener() {}, removeEventListener() {} },
    setTimeout: () => 0, clearTimeout() {},
    ...extraScope,
  };
  const keys = Object.keys(scope);
  const mod = new Function(...keys, JS + '\nreturn { ' + names.join(', ') + ' };')(...keys.map(k => scope[k]));
  const reset = () => { idx = 0; ridx = 0; };
  const resetAll = () => { states = []; refs = []; idx = 0; ridx = 0; };
  return { mod, reset, resetAll, win, get states() { return states; } };
}

// The standard fixture: one team ("Welcome", one role "Greeter"), one service, one published rota with `who` on it.
export const PUB_A = 'aa'.repeat(32), PUB_B = 'bb'.repeat(32), PUB_C = 'cc'.repeat(32);
export const SERVICE = { id: 'svc1', date: '2026-09-13', time: '10:30', name: 'Sunday Gathering' };

export function mountBoard({
  teams = [{ id: 't1', kind: 'team', name: 'Welcome', accent: 'var(--clay)' }],
  rosters = [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [{ id: 'p1', name: 'Ruth Bexley', pub: PUB_A }], pods: [] }],
  services = [SERVICE],
  rotas = [{ id: 'svc1', service: 'svc1', published: true, assign: { 't1::r1': { id: 'p1', name: 'Ruth Bexley', pub: PUB_A } } }],
  requests = [], replies = [], unavail = {}, steward = {}, confirm,
} = {}) {
  const calls = { publishRota: [], sendServingRequest: [], publishService: [] };
  const Steward = {
    publishService: async (s) => { calls.publishService.push(s); return { id: s.id || ('svc-' + s.date), ...s }; },
    publishRota: async (r) => { calls.publishRota.push(r); return { id: r.service }; },
    sendServingRequest: async (r) => { calls.sendServingRequest.push(r); return true; },
    nameKeyReady: () => true,
    ...steward,
  };
  const sch = loadSchedule({}, {
    useStewardGroups: () => teams, useStewardRosters: () => rosters, useStewardServices: () => services,
    useStewardRotas: () => rotas, useStewardRequests: () => requests, useStewardRequestReplies: () => replies,
    useStewardUnavail: () => unavail, Steward, ...(confirm ? { confirm } : {}),
  });
  const draw = () => { sch.reset(); return sch.mod.DashRota({ onNewTeam() {} }); };
  return {
    draw, calls, sch,
    text: () => reads(draw()),
    // a button whose visible text contains `label`; throws (not returns undefined) when there is none, so a
    // test can never pass because it clicked nothing
    press: async (label) => {
      const b = find(draw(), n => n.type === 'button' && reads(n).includes(label));
      if (!b.length) throw new Error('no button reading ' + JSON.stringify(label) + ' on the rota board');
      return b[0].props.onClick();
    },
    has: (label) => find(draw(), n => n.type === 'button' && reads(n).includes(label)).length > 0,
  };
}
