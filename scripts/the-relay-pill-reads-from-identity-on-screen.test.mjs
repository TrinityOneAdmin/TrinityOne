// THE RELAY PILL ON THE SCREEN SHOWS ONLY "Shared", FOR CANONICAL RELAYS. (CLAUDE.md rule 1.)
// Run: node --test scripts/the-relay-pill-reads-from-identity-on-screen.test.mjs
//
// scripts/a-relay-label-follows-proven-identity.test.mjs proves the ENGINE (classifyRelay) in isolation. It
// cannot prove the SCREEN uses it: deleting the pill's wiring from DashRelaysCard leaves that engine test
// green. This is the point-of-use half — it RENDERS DashRelaysCard and reads the pill text out of the tree.
//
// WHY THE OTHER LABELS ARE GONE. classifyRelay returns 'self' for ANY church-signed non-canonical relay, but
// the church signs EVERY relay it adds, so a merely-ADDED box (not one the church hosts) was mislabelled
// "Self-hosted" on screen. The data to tell "my box" from "an added box" is not reliably present. Only the
// canonical/shared classification ('shared', from the shipped SHARED_RELAY_KEYS) is reliable, so the card now
// renders the "Shared" pill ALONE and shows NOTHING for self/added rows. classifyRelay itself is UNCHANGED —
// still used for relayKind, and provenRelayPub is still load-bearing for the online/boxes count.
//
// It renders the REAL DashRelaysCard (sliced from app/stew-dashboard.jsx, compiled with the same
// --jsx=transform the build uses) and feeds it the REAL classifyRelay lifted out of the shipped
// vendor/steward.js. The fake Steward supplies only the per-surface inputs the card consumes — the proven
// pub per address, the shipped shared keys, the church's signed set, and the own-box/self-host signals. So
// the chain under test is the shipped one: ownRelay/isSelfHosted + provenRelayPub + the relay-net
// pre-resolve + classifyRelay -> relayKind -> the pill. Nothing here matches text in a .jsx file (rule 3:
// app/*.jsx ships unbundled, so a text match passes even if the pill is deleted).
//
// INSTRUMENT VALIDATION (foot of file matters as much as the body): the fixture carries one canonical row,
// one loopback self-host box, one CHURCH-SIGNED non-canonical ("added") box, and one proven-but-unknown box.
// Only the canonical row may show a pill, and it must read "Shared". Deleting the Shared pill line drops the
// count to zero and fails the first test; reverting to the old three-way pill (self -> "Self-hosted",
// neutral -> "Added") puts pills back on the self/signed/unknown rows and fails the exactly-one-pill test.
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
const SIGNED = 'b'.repeat(64);     // a box this church SIGNED into its relay-net doc — merely ADDED, not hosted
const UNKNOWN = 'c'.repeat(64);    // a proven box that is neither canonical, own, nor church-signed

const ROW_SHARED = 'wss://app.trinityone.church/relay';   // canonical, AND the console's own serving address
const ROW_SELF = 'ws://127.0.0.1:8000/relay';             // the desktop Suite's own loopback box
const ROW_SIGNED = 'wss://added.example/relay';           // church-signed, non-canonical — the mislabel bug
const ROW_UNKNOWN = 'wss://unknown.example/relay';
const PROVEN = { [ROW_SHARED]: CANON, [ROW_SELF]: OWN, [ROW_SIGNED]: SIGNED, [ROW_UNKNOWN]: UNKNOWN };

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
  { url: ROW_SIGNED, status: 'on', ms: 15, member: true },
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
  // would answer it on the phone. relayNet() is the church's signed set — it carries the ADDED box, so that
  // row classifies 'self' (the exact bug: every added relay is church-signed), and the card must still show
  // NO pill for it. The own loopback box is caught by the loopback-origin signal.
  const Steward = {
    classifyRelay,
    provenRelayPub: (u) => PROVEN[u] || '',
    sharedRelayKeys: () => [CANON],
    relayNet: async () => [{ pubkey: SIGNED }],
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
// The identity-pill text(s) on a row — 0 or 1 now that only canonical rows carry a pill.
const labelsOf = (tree, url) => {
  const row = rowFor(tree, url);
  assert.ok(row, 're-anchor: no rendered row for ' + url + ' — the relay panel changed shape');
  return texts(row).filter(t => LABELS.includes(t));
};

test('a canonical relay served FROM the console still shows the "Shared" pill', async () => {
  const p = await relayPanel();
  // This is the point of use: delete the `relayKind === "shared" ? <SkPill>Shared</SkPill> : null` line and
  // this row shows nothing and this assertion fails.
  assert.deepEqual(labelsOf(p.draw(), ROW_SHARED), ['Shared']);
});

test('a church-signed NON-canonical (added) box shows NO "Self-hosted"/"Added" pill', async () => {
  const p = await relayPanel();
  // classifyRelay returns 'self' for this row (every added relay is church-signed), but the screen must not
  // call it "Self-hosted" — nor "Added". No identity pill at all.
  assert.deepEqual(labelsOf(p.draw(), ROW_SIGNED), []);
});

test('the loopback self-host box shows NO pill (the "Self-hosted" label is gone)', async () => {
  const p = await relayPanel();
  assert.deepEqual(labelsOf(p.draw(), ROW_SELF), []);
});

test('a proven but unknown box shows NO pill (the "Added" label is gone)', async () => {
  const p = await relayPanel();
  assert.deepEqual(labelsOf(p.draw(), ROW_UNKNOWN), []);
});

test('exactly one identity pill is rendered across the whole card, and it reads "Shared"', async () => {
  const p = await relayPanel();
  const all = texts(p.draw()).filter(t => LABELS.includes(t));
  assert.deepEqual(all, ['Shared'],
    'the card should render the Shared pill alone — if this is empty the Shared line was deleted; if it ' +
    'carries Self-hosted/Added the old three-way pill is back: ' + JSON.stringify(all));
});
