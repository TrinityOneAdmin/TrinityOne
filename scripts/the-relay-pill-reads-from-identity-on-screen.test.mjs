// THE RELAY PILL ON THE SCREEN READS THE PROVEN IDENTITY — not the page address. (CLAUDE.md rule 1.)
// Run: node --test scripts/the-relay-pill-reads-from-identity-on-screen.test.mjs
//
// scripts/a-relay-label-follows-proven-identity.test.mjs proves the ENGINE (classifyRelay) in isolation. It
// cannot prove the SCREEN uses it: deleting the pill's wiring from DashRelaysCard leaves that engine test
// green. This is the point-of-use half — it RENDERS DashRelaysCard and reads the pill text out of the tree.
//
// It renders the REAL DashRelaysCard (sliced from app/stew-dashboard.jsx, compiled with the same
// --jsx=transform the build uses) and feeds it the REAL classifyRelay lifted out of the shipped
// vendor/steward.js. The fake Steward supplies only the per-surface inputs the card consumes — the proven
// pub per address, the shipped shared keys, the church's signed set, and the own-box/self-host signals. So
// the chain under test is the shipped one: ownRelay/isSelfHosted + provenRelayPub + the relay-net
// pre-resolve + classifyRelay -> relayKind -> the pill. Nothing here matches text in a .jsx file (rule 3:
// app/*.jsx ships unbundled, so a text match passes even if the pill is deleted).
//
// THE FIXTURE IS CHOSEN SO THE OLD HOST-BASED LABEL IS WRONG ON EVERY ROW. The console is served FROM
// app.trinityone.church (location.host), which is a canonical/shared relay. The old pill
// (`r.url.includes(location.host)`) would call that row "Self-hosted" and both other rows "Shared". The
// identity-based pill calls them Shared / Self-hosted / Added. So reverting the one pill line to the old
// form flips all three — which is exactly what the instrument-validation note at the foot records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
// fnBody (test-slice.mjs) is quote-aware but not JSX-aware: a straight apostrophe in the card's footer TEXT
// opens a string literal the brace walk never closes, so it runs off the end and reports "could not find the
// end of DashRelaysCard". The app is valid JSX and renders that text correctly; only the slicer's INPUT is
// normalised here (never the shipped copy), and only that one sentence, and only while it is present.
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8')
  .replace("Your church's messages, groups and members live on the relays above", 'Your church’s messages, groups and members live on the relays above');

// The REAL classifier, lifted from the shipped bundle and run (pure — touches only String/Array/RegExp).
const classifyRelay = new Function(fnBody(SHIP, 'function classifyRelay(info) {', 'classifyRelay') + '\nreturn classifyRelay;')();

// SHARED_RELAY_KEYS[0] — the live canonical/shared relay's key.
const CANON = '6a4267558c9990d0391b3472bac9735d33a5e99b5c7cb0e49bdece7ea6b770f2';
const OWN = 'a'.repeat(64);        // the loopback self-host box's proven key — not canonical, not signed
const UNKNOWN = 'c'.repeat(64);    // a proven box that is neither canonical, own, nor church-signed

const ROW_SHARED = 'wss://app.trinityone.church/relay';   // canonical, AND the console's own serving address
const ROW_SELF = 'ws://127.0.0.1:8000/relay';             // the desktop Suite's own loopback box
const ROW_UNKNOWN = 'wss://unknown.example/relay';
const PROVEN = { [ROW_SHARED]: CANON, [ROW_SELF]: OWN, [ROW_UNKNOWN]: UNKNOWN };

// A miniature React that honours call-order state, memo/callback deps and effects — the pattern the console
// screen tests use (scripts/removing-a-relay-asks-first.test.mjs). Enough to answer: what does the card put
// on screen in this state?
function mini() {
  const states = []; const memos = []; const effDeps = []; let queued = [];
  let i = 0, mi = 0, ei = 0;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, n) => Object.is(v, b[n]));
  const React = {
    useState(init) { const k = i++; if (!(k in states)) states[k] = typeof init === 'function' ? init() : init;
      return [states[k], (v) => { states[k] = typeof v === 'function' ? v(states[k]) : v; }]; },
    useMemo(f, deps) { const k = mi++; if (!memos[k] || !same(memos[k].deps, deps)) memos[k] = { deps, v: f() }; return memos[k].v; },
    useCallback(f, deps) { return React.useMemo(() => f, deps); },
    useEffect(fn, deps) { const k = ei++; if (!(k in effDeps) || !same(effDeps[k], deps)) { effDeps[k] = deps; queued.push(fn); } },
    useRef: () => ({ current: null }),
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    Fragment: 'Fragment',
  };
  const flush = () => { const r = queued; queued = []; r.forEach(f => { try { f(); } catch (e) {} }); };
  return { React, reset: () => { i = 0; mi = 0; ei = 0; }, flush };
}

const texts = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; }
  if (n.props) Object.values(n.props).forEach(v => { if (typeof v === 'string') out.push(v); else if (v && (v.kids || Array.isArray(v))) texts(v, out); });
  (n.kids || []).forEach(c => texts(c, out));
  return out;
};
const find = (n, p, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => find(c, p, out)); return out; }
  if (p(n)) out.push(n);
  (n.kids || []).forEach(c => find(c, p, out));
  return out;
};

const STATUS = [
  { url: ROW_SHARED, status: 'on', ms: 20, member: true },
  { url: ROW_SELF, status: 'on', ms: 10, member: true },
  { url: ROW_UNKNOWN, status: 'on', ms: 30, member: true },
];

async function relayPanel() {
  const { React, reset, flush } = mini();
  const src = fnBody(DASH, 'function DashRelaysCard()', 'DashRelaysCard');
  const tmp = join(tmpdir(), 'relay-label-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashRelaysCard };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__rl_' + Math.random().toString(36).slice(2);
  // The REAL classifyRelay; provenRelayPub stands in for the verified-identity cache (per-URL), as the gate
  // would answer it on the phone. relayNet() is the church's signed set (empty here — the own box is caught
  // by the loopback-origin signal, which is the whole point of the audit's precedence).
  const Steward = {
    classifyRelay,
    provenRelayPub: (u) => PROVEN[u] || '',
    sharedRelayKeys: () => [CANON],
    relayNet: async () => [],
    ownRelay: () => ROW_SELF,
    isSelfHosted: () => true,
    relayNameFor: () => '',
    canRemoveRelay: () => true,
    removeRelay: () => true,
  };
  globalThis[key] = {
    React, window: { Steward, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} },
    Icon: () => null,
    SkPill: ({ children }) => ({ type: 'span', props: {}, kids: [children] }),
    SkCard: ({ children }) => ({ type: 'div', props: {}, kids: [children] }),
    relayRejectionActive: false, noteRelayRejection: () => {}, clearRelayRejection: () => {}, shortNpub: () => '',
    dropRefusalsNotListed: () => {},
    useRelayBackupState: () => ({ status: STATUS, backup: null }),
    location: { host: 'app.trinityone.church' },
    relaysThatRefused: () => [],
    Panel: () => null,
  };
  const pre = Object.keys(globalThis[key]).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const b64 = Buffer.from(pre + '\n' + js).toString('base64');
  const Comp = (await import('data:text/javascript;base64,' + b64)).DashRelaysCard;
  // Two draws: the first runs the relay-net pre-resolve effect; the second renders with its result settled.
  const draw = () => { reset(); const t = Comp({}); flush(); return t; };
  draw();
  return { draw };
}

// The pill row for a given address: the per-row <div key={r.url}>, whose SkPill child carries the label.
const rowFor = (tree, url) => find(tree, n => n.type === 'div' && n.props && n.props.key === url)[0];
const LABELS = ['Shared', 'Self-hosted', 'Added'];
const labelOf = (tree, url) => {
  const row = rowFor(tree, url);
  assert.ok(row, 're-anchor: no rendered row for ' + url + ' — the relay panel changed shape');
  const found = texts(row).filter(t => LABELS.includes(t));
  assert.equal(found.length, 1, 'expected exactly one identity pill on the row for ' + url + ', saw ' + JSON.stringify(found));
  return found[0];
};

test('a canonical relay served FROM the console reads "Shared" — not "Self-hosted" as the old host test said', async () => {
  const p = await relayPanel();
  assert.equal(labelOf(p.draw(), ROW_SHARED), 'Shared');
});

test('the loopback self-host box reads "Self-hosted"', async () => {
  const p = await relayPanel();
  assert.equal(labelOf(p.draw(), ROW_SELF), 'Self-hosted');
});

test('a proven but unknown box reads "Added" (neutral) — never guessed Shared or Self-hosted', async () => {
  const p = await relayPanel();
  assert.equal(labelOf(p.draw(), ROW_UNKNOWN), 'Added');
});

test('all three labels are present exactly once — the pill is wired to relayKind, per row', async () => {
  const p = await relayPanel();
  const tree = p.draw();
  const all = texts(tree).filter(t => LABELS.includes(t)).sort();
  assert.deepEqual(all, ['Added', 'Self-hosted', 'Shared'],
    'the rendered pills do not read one of each — the card is not labelling from the proven identity: ' + JSON.stringify(all));
});
