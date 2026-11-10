// THE OVERVIEW "WAITING TO JOIN" BANNER AND THE MEMBERS "REQUESTS TO JOIN" QUEUE STAY HIDDEN WHILE THE CONSOLE
// IS LOGGED OUT — they must not paint the whole church as "waiting to join" off an unauthenticated empty read.
//   Run: node --test scripts/the-join-queue-and-waiting-banner-hide-while-logged-out.test.mjs
//
// THE GAP (audit 2026-11-10). The stale-while-logged-out fix added window.rosterReadyFrom and gated three
// surfaces on it. useRealMemberCount (the Members TILE) is exercised at point of use by
// scripts/the-console-shows-checking-not-a-wrong-count-while-logged-out.test.mjs. The other two were NOT:
//   · DashOverview `pendingCount`  — the big "N people are waiting to join" banner, gated `&& rosterReady`;
//   · DashMembers  `pendingJoins`  — the join queue ("Requests to join · N", each row carrying Approve and
//                                    "mark as a child"), gated `&& mRosterLoaded`.
// Deleting the guard from either line reddened NO test. This file closes that: a logged-out console (the roster
// has NOT settled on a genuine authenticated read, so rosterReadyFrom() is false) must show neither surface,
// even though members exist and join-approval is on; a logged-in console (rosterReadyFrom() true) must show both.
//
// POINT OF USE, not the engine (CLAUDE.md rule 1), and NOT a text match against the .jsx (rule 3 — app/*.jsx
// ships UNBUNDLED, so `false && ` in front of a condition leaves every word in place and a text assertion still
// passes). The REAL DashOverview and DashMembers are compiled from app/stew-dashboard.jsx with the packaged
// esbuild (alongside app/stew-data.jsx, which supplies the real SK_TINT palette the rows read), and each
// component's OWN body is CALLED. The gate the screen actually consults runs, decides whether to emit the banner
// / the queue header, and we read the emitted tree. React here is deliberately NON-EXPANDING: createElement
// builds nodes without descending into child components, because the banner div and the "Requests to join"
// header live in the parent's own returned tree — so the whole dashboard's child surface need not be stubbed,
// and the one thing under test (did this body emit the feature?) is read directly.
//
// MEASURED RED/GREEN, 2026-11-10 (each sabotage scoped to the one line, anchor unique in the file, restored
// byte-for-byte after):
//   · shipped                                                           4 pass / 0 fail
//   · DashOverview `(joinApproval && rosterReady)`   -> drop `&& rosterReady`    3 pass / 1 fail (logged-out banner reappears)
//   · DashMembers  `(joinApproval && mRosterLoaded)` -> drop `&& mRosterLoaded`  3 pass / 1 fail (logged-out queue reappears)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const compile = (rel) => execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
  [join(ROOT, rel), '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
// stew-data.jsx first: it declares SK_TINT (the tint palette a join row reads `.fg` off) and the Sk* pieces.
const JS = compile('app/stew-data.jsx') + '\n' + compile('app/stew-dashboard.jsx');

// A tiny, NON-EXPANDING React: hooks return their initial value (effects are not run — the banner/queue do not
// depend on effect-set state), and createElement just builds a node without calling child components.
const React = {
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
  useEffect: () => {}, useRef: (i) => ({ current: i === undefined ? null : i }),
  useMemo: (f) => f(), useCallback: (f) => f,
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  Fragment: 'Fragment',
};
const CustomEvent = function (t, d) { this.type = t; this.detail = (d || {}).detail; };
const H = (v) => () => v;
const M = (n) => Array.from({ length: n }, (_, i) => ({ pubkey: 'pk' + i, name: 'Member ' + i }));

// A console whose roster hooks reflect ONE connection state. `ready` is what window.rosterReadyFrom returns:
// false = logged-out / unsettled (the relay withheld the private lists), true = a genuine authenticated read.
function windowFor({ ready, members, admitted, blocked, joinApproval }) {
  return {
    innerWidth: 1200, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    localStorage: { getItem() { return ''; }, setItem() {} },
    rosterReadyFrom: () => ready,
    useStewardMembers: H(members), useStewardAdmitted: H(admitted), useStewardBlocked: H(blocked),
    useStewardJoinPolicy: H(joinApproval),
    useStewardGroups: H([]), useStewardRosters: H([]), useStewardRotas: H([]), useStewardServices: H([]),
    useStewardStewards: H([]), useStewardChurch: H({ name: '' }), useStewardGuardians: H([]),
    useStewardGuardianRequests: H([]), useStewardSafeguard: H({ approved: [], expiry: {} }),
    useStewardCheckinPermissions: H({}), useMealsSettings: H({ enabled: false }), useStewardConn: H(0),
    useStewardIdv: H(0), useStewardDirectory: H({}), usePendingStewards: H([]),
    useStewardStats: H({}), useStewardActivity: H([]), useStewardRelays: H([]),
    Steward: { actingChurch: '', churchPub: '', activePub: '', myStewardCaps: () => null },
  };
}

// Render ONE component's own body and return every string on the tree it emitted. Icon and a couple of leaf
// cards that only ever appear in child position are stubbed (never called — non-expanding React); anything else
// the body truly needs is real, so an unstubbed dependency is a ReferenceError here, not a silent green.
function render(name, opts) {
  const g = {
    React, CustomEvent, window: windowFor(opts), Icon: () => null,
    DismissibleNote: () => null, StewHelpLink: () => null,
  };
  const names = Object.keys(g);
  const mod = new Function(...names, JS + `\nreturn { ${name} };`)(...names.map(k => g[k]));
  const props = name === 'DashMembers' ? { dmConvos: [] } : { onTab: () => {}, onNewPost: () => {}, onSettings: () => {} };
  return texts(mod[name](props)).join(' · ');
}

// 5 members, 0 admitted, approval ON: a logged-out console reads the private lists as EMPTY, so without the gate
// all 5 would look like they are queuing at the door.
const LOGGED_OUT = { ready: false, members: M(5), admitted: [], blocked: [], joinApproval: true };
// 5 members, 2 admitted, approval ON, logged in: 3 are genuinely still pending.
const LOGGED_IN = { ready: true, members: M(5), admitted: ['pk0', 'pk1'], blocked: [], joinApproval: true };

test('OVERVIEW: logged out, the "waiting to join" banner is NOT shown (no wrong count)', () => {
  const out = render('DashOverview', LOGGED_OUT);
  assert.ok(!/waiting to join/.test(out),
    'the Overview painted a "waiting to join" banner while logged out — an empty unauthenticated read read as the ' +
    'whole church queuing at the door');
});

test('OVERVIEW: logged in, the banner shows the real pending count', () => {
  const out = render('DashOverview', LOGGED_IN);
  assert.ok(/waiting to join/.test(out), 'the banner did not appear for a genuinely pending queue');
  assert.ok(/(^|[^0-9])3([^0-9]|$)/.test(out), 'the banner did not show 3 people waiting (5 members − 2 admitted)');
});

test('MEMBERS: logged out, the "Requests to join" queue is NOT shown', () => {
  const out = render('DashMembers', LOGGED_OUT);
  assert.ok(!/Requests to join/.test(out),
    'the Members tab showed a join queue while logged out — the whole church would appear in a queue that each ' +
    'row offers to Approve and to "mark as a child"');
});

test('MEMBERS: logged in, the "Requests to join" queue appears', () => {
  const out = render('DashMembers', LOGGED_IN);
  assert.ok(/Requests to join/.test(out), 'the join queue did not appear for a genuinely pending queue');
});
