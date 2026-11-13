// The member count must not include people who were blocked or are still queuing.
// Run: node --test scripts/member-count.test.mjs
//
// Reported 2026-07-26: a church with a handful of real members read "26 members", and every group's
// "who can see this" said the same. `subscribeMembers` returns every member doc the relay has ever served,
// which includes BLOCKED people and people still waiting for approval. The Members tab already filtered both
// when listing them; the Overview stat and the group subtitles did not.
//
// This executes the real rule out of app/stew-dashboard.jsx rather than restating it, because the subtle part
// is the rosterLoaded guard: on a hard reload the admitted/blocked sets are briefly empty, and a naive filter
// would report every member in the church as pending for a moment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { texts } from './render-jsx-screen.mjs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// Lift the filter expression out of useRealMemberCount and run it against synthetic rosters.
function realRule() {
  const at = DASH.indexOf('function useRealMemberCount(');
  assert.notEqual(at, -1, 'useRealMemberCount is gone — the count rule has no single home again');
  // fnBody() reads to the function's real closing brace rather than a fixed window: useRealMemberCount grew
  // past the old 1400-char slice (now 1432), which truncated the body and defeated the match. (test-windows.)
  const m = fnBody(DASH, at, 'useRealMemberCount').match(/(?:return|const n =) members\.filter\(m =>([\s\S]*?)\)\.length;/);
  assert.ok(m, 'could not find the filter expression');
  return new Function('members', 'blockedSet', 'admittedSet', 'joinApproval', 'rosterLoaded',
    `return members.filter(m => ${m[1]}).length;`);
}
const count = realRule();
const M = (...pks) => pks.map(p => ({ pubkey: p }));

// ── the REAL hook / screens, run (rule 1) ─────────────────────────────────────────────────────────────────────
// useRealMemberCount is plain JS: lift it by brace-match and call it against a stub window.
function hook({ ready, members, admitted, blocked, joinApproval }) {
  const window = { rosterReadyFrom: () => ready, useStewardMembers: () => members, useStewardAdmitted: () => admitted,
    useStewardBlocked: () => blocked, useStewardJoinPolicy: () => joinApproval, Steward: {} };
  return new Function('window', fnBody(DASH, 'function useRealMemberCount(', 'useRealMemberCount') + '\nreturn useRealMemberCount();')(window);
}
// The screens: the whole of app/stew-data.jsx + app/stew-dashboard.jsx compiled with the packaged esbuild, and ONE
// component's own body called with a NON-EXPANDING React (child components become nodes, not calls) — the same
// harness as the-join-queue-and-waiting-banner-hide-while-logged-out.test.mjs.
const ROOT = new URL('../', import.meta.url).pathname;
const compile = (rel) => execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
  [join(ROOT, rel), '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
let JS = null;
const React = {
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {}, useRef: (i) => ({ current: i === undefined ? null : i }),
  useMemo: (f) => f(), useCallback: (f) => f, useContext: () => null,
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  Fragment: 'Fragment',
};
const H = (v) => () => v;
function renderBody(name, { ready, members, admitted, blocked, joinApproval, groups }) {
  JS = JS || compile('app/stew-data.jsx') + '\n' + compile('app/stew-dashboard.jsx');
  const win = {
    innerWidth: 1200, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    localStorage: { getItem() { return ''; }, setItem() {} },
    rosterReadyFrom: () => ready,
    useStewardMembers: H(members), useStewardAdmitted: H(admitted), useStewardBlocked: H(blocked),
    useStewardJoinPolicy: H(joinApproval),
    useStewardGroups: H(groups), useStewardRosters: H([]), useStewardRotas: H([]), useStewardServices: H([]),
    useStewardStewards: H([]), useStewardChurch: H({ name: '', features: {} }), useStewardGuardians: H([]),
    useStewardGuardianRequests: H([]), useStewardSafeguard: H({ approved: [], expiry: {} }),
    useStewardCheckinPermissions: H({}), useMealsSettings: H({ enabled: false }), useStewardConn: H(0),
    useStewardIdv: H(0), useStewardDirectory: H({}), usePendingStewards: H([]),
    useStewardStats: H({}), useStewardActivity: H([]), useStewardRelays: H([]),
    Steward: { actingChurch: '', churchPub: '', activePub: '', myStewardCaps: () => null },
  };
  const w = new Proxy(win, { get: (o, k) => (k in o ? o[k] : (typeof k === 'string' && /^use[A-Z]/.test(k) ? () => [] : undefined)) });
  const g = { React, window: w, CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    Icon: () => null, DismissibleNote: () => null, StewHelpLink: () => null, localStorage: win.localStorage, location: { search: '', hash: '', href: '', hostname: 'x' }, useStewDialog: () => ({ current: null }), setTimeout, clearTimeout, navigator: { onLine: true },
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', querySelector: () => null, body: {} } };
  const names = Object.keys(g);
  const mod = new Function(...names, JS + `\nreturn { ${name} };`)(...names.map(k => g[k]));
  return mod[name]({ onTab: () => {}, onNewPost: () => {}, onSettings: () => {} });
}
function findNode(n, pred) {
  if (!n || typeof n !== 'object') return null;
  if (pred(n)) return n;
  for (const k of (n.kids || [])) { const r = findNode(k, pred); if (r) return r; }
  for (const v of Object.values(n.props || {})) if (v && typeof v === 'object' && v.type) { const r = findNode(v, pred); if (r) return r; }
  return null;
}

test('blocked members are never counted', () => {
  const n = count(M('a', 'b', 'blocked1'), new Set(['blocked1']), new Set(['a', 'b', 'blocked1']), true, true);
  assert.equal(n, 2, 'a blocked person is still being counted as a member');
});

test('people still waiting for approval are not counted', () => {
  const n = count(M('a', 'b', 'waiting'), new Set(), new Set(['a', 'b']), true, true);
  assert.equal(n, 2, 'someone who has requested but not been approved is being counted as a member');
});

test('with approval OFF, everyone who joined counts (there is no queue)', () => {
  const n = count(M('a', 'b', 'c'), new Set(), new Set(), false, true);
  assert.equal(n, 3, 'with approval off nobody is pending, so all members count');
});

test('before the rosters arrive, nobody is assumed pending', () => {
  // The dangerous direction: on a hard reload admitted/blocked are empty for a moment. Treating everyone as
  // pending would flash "— members" at a church that has plenty, and the Overview would look broken.
  // 78d0e813 moved this guard OUT of the filter into `if (!ready) return null` (the tile reads "Checking…"),
  // so it is checked by running the WHOLE hook, not the lifted filter: with the rosters not ready, the count is
  // null — never 0 (everyone pending), never a number read off empty lists.
  const run = (ready) => hook({ ready, members: M('a', 'b', 'c'), admitted: [], blocked: [], joinApproval: true });
  assert.equal(run(false), null, 'the count collapsed to a number while the rosters were still loading (want null = "Checking…")');
  assert.equal(run(true), 0, 'CONTROL: once ready, with nobody admitted and approval on, all three really are pending');
});

test('blocked wins over admitted', () => {
  // Someone approved and later blocked is still blocked.
  const n = count(M('a', 'gone'), new Set(['gone']), new Set(['a', 'gone']), true, true);
  assert.equal(n, 1);
});

test('the Overview stat and the group subtitles both use the shared rule', () => {
  // RENDERED, not matched (rule 3): the real DashOverview and DashGroups bodies are called with 5 member
  // documents, 1 of them blocked and 1 still waiting for approval, so the honest count is 3. The Members tile
  // and every open group's subtitle must say 3 — never 5 (members.length). Logged out, the tile says "Checking…".
  const world = { ready: true, members: M('a', 'b', 'c', 'gone', 'waiting'), admitted: ['a', 'b', 'c', 'gone'], blocked: ['gone'], joinApproval: true,
    groups: [{ id: 'g-open', name: 'Prayer', kind: 'group' }] };
  const ov = renderBody('DashOverview', world);
  const tile = findNode(ov, n => n.props && n.props.label === 'Members');
  assert.ok(tile, 're-anchor: the Overview has no Members stat card');
  assert.equal(tile.props.value, '3', 'the Members stat is not using the shared count (blocked/pending counted)');
  assert.ok(texts(ov).includes('3 members'), 'the Overview group subtitle does not use the shared count: ' + JSON.stringify(texts(ov).filter(t => /member/.test(t))));
  const out = renderBody('DashOverview', { ...world, ready: false });
  assert.equal(findNode(out, n => n.props && n.props.label === 'Members').props.value, 'Checking…', 'logged out, the Members tile must read "Checking…"');
  // the Groups page hands its rows to ListPanel as `items`, each carrying the `sub` line it prints under the name
  const list = findNode(renderBody('DashGroups', world), n => n.props && Array.isArray(n.props.items));
  assert.ok(list, 're-anchor: DashGroups no longer hands a list of rows to a panel');
  const row = list.props.items.find(it => it.id === 'g-open');
  assert.ok(row, 're-anchor: the open group is not among the Groups page rows');
  assert.equal(row.sub, '3 members', 'the Groups page subtitle does not use the shared count (blocked/pending people counted)');
});

test('the pending-requests list is bounded so it cannot push the page away', () => {
  // With a queue of requests the panel grew without limit and shoved the members list, the safeguarding note
  // and everything below it off-screen. The rows scroll inside the panel now.
  const at = DASH.indexOf('Requests to join · {pendingJoins.length}');
  assert.notEqual(at, -1, 'the requests panel is gone');
  // NOT a fixed window. A 900-char slice passed until an "Admit all" button was added to the same header and
  // pushed maxHeight out of range — the test then failed over a change that did not touch the bound at all.
  // Read to the end of the panel instead.
  const block = DASH.slice(at, DASH.indexOf('{pendingJoins.map(', at));
  assert.match(block, /maxHeight: 268, overflowY: 'auto'/, 'the requests list is unbounded again');
});
