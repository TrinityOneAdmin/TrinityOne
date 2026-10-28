// THE RELAYS BADGE COUNTS DISTINCT BOXES, NOT ADDRESSES. (CLAUDE.md rule 1 — point of use.)
// Run: node --test scripts/the-relay-badge-counts-boxes-not-addresses.test.mjs
//
// The a8 "master-01" box answers at two addresses (Cloudflare app.trinityone.church + Tailscale
// master-01.*.ts.net) that both prove the SAME relay identity key. `window.useStewardRelays()` returns
// one row per URL, so a 2-box church (dev box + a8) is three rows and the console pill used to read
// "3/3 online" — counting ADDRESSES. The fix groups the rows by the identity each address PROVED
// (provenRelayPub — the gate's verified-identity cache, the same key the per-row label reads) so the pill
// counts BOXES: "2/2".
//
// This is the point-of-use half. scripts/redundancy-is-counted-from-the-proof.test.mjs proves the engine
// (relayIdentities/backupState) dedups by proof; it cannot prove the SCREEN does — deleting the box tally
// from DashRelaysCard's pill leaves that engine test green. So this RENDERS the real DashRelaysCard
// (sliced from app/stew-dashboard.jsx, compiled with the same --jsx=transform the build uses) and reads
// the pill text out of the rendered tree (Panel's `action` prop). Nothing here matches text in a .jsx
// file (rule 3: app/*.jsx ships unbundled, so a text match passes even if the pill is deleted).
//
// The fake Steward supplies only the per-surface inputs the card consumes; `provenRelayPub` stands in for
// the verified-identity cache (per-URL), as the gate would answer it on the phone. classifyRelay is a stub
// here because this file asserts the BADGE, not the per-row labels (those are
// scripts/the-relay-pill-reads-from-identity-on-screen.test.mjs).
//
// node_modules is hard-linked in the worktree, so esbuild runs; a bare worktree would fail on esbuild
// ENOENT, which is not a code failure (CLAUDE.md audit-briefs note).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
// fnBody (test-slice.mjs) is quote-aware but not JSX-aware: a straight apostrophe in the card's footer TEXT
// opens a string literal the brace walk never closes, so it runs off the end. The app is valid JSX and
// renders that text correctly; only the slicer's INPUT is normalised here (never the shipped copy), and
// only that one sentence, and only while it is present.
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8')
  .replace("Your church's messages, groups and members live on the relays above", 'Your church’s messages, groups and members live on the relays above');

// SHARED_RELAY_KEYS[0] — the live canonical/shared relay's key; here it is the a8's single proven identity.
const A8 = '6a4267558c9990d0391b3472bac9735d33a5e99b5c7cb0e49bdece7ea6b770f2';
const DEV = 'a'.repeat(64);     // the dev box's own proven key — a second, separate box
const THIRD = 'c'.repeat(64);   // a third distinct box, for the CONTROL

const A8_CF = 'wss://app.trinityone.church/relay';                    // a8 via Cloudflare
const A8_TS = 'wss://trinityone-master-01.tailbeaac0.ts.net/relay';   // a8 via Tailscale — SAME box
const DEV_URL = 'wss://dev.example/relay';                            // the dev box

// A miniature React that honours call-order state, memo/callback deps and effects — the pattern the console
// screen tests use (scripts/the-relay-pill-reads-from-identity-on-screen.test.mjs).
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

// The pill is passed as Panel's `action` prop (shown only when not "checking"). Read its text out of the
// rendered tree and normalise — "2/2 online".
const pillText = (tree) => {
  const hits = find(tree, n => n && n.props && n.props.action);
  assert.ok(hits.length, 're-anchor: no node carries an `action` prop — the Relays panel changed shape');
  return texts(hits[0].props.action).join('').replace(/\s+/g, ' ').trim();
};

async function relayPanel(PROVEN, STATUS) {
  const { React, reset, flush } = mini();
  const src = fnBody(DASH, 'function DashRelaysCard()', 'DashRelaysCard');
  const tmp = join(tmpdir(), 'relay-badge-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashRelaysCard };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__rb_' + Math.random().toString(36).slice(2);
  // provenRelayPub stands in for the verified-identity cache (per-URL). classifyRelay is a stub: this file
  // asserts the badge, not the per-row label.
  const Steward = {
    provenRelayPub: (u) => PROVEN[u] || '',
    classifyRelay: () => 'shared',
    sharedRelayKeys: () => [A8],
    relayNet: async () => [],
    ownRelay: () => '',
    isSelfHosted: () => false,
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

const on = (url) => ({ url, status: 'on', ms: 20, member: true });
const off = (url) => ({ url, status: 'off', ms: null, member: true });

test('two a8 routes sharing one proven key + the dev box, all up → "2/2 online" (boxes, not addresses)', async () => {
  const PROVEN = { [A8_CF]: A8, [A8_TS]: A8, [DEV_URL]: DEV };
  const p = await relayPanel(PROVEN, [on(A8_CF), on(A8_TS), on(DEV_URL)]);
  const txt = pillText(p.draw());
  assert.equal(txt, '2/2 online',
    'the badge counts three ADDRESSES as three relays — the a8\'s Cloudflare and Tailscale routes prove ' +
    'the same identity and are ONE box');
  assert.notEqual(txt, '3/3 online', 'the badge reverted to counting addresses');
});

test('a box is online if ANY of its addresses is answering, and a down box stays in the denominator', async () => {
  const PROVEN = { [A8_CF]: A8, [A8_TS]: A8, [DEV_URL]: DEV };
  // a8 reachable via Tailscale only (Cloudflare route down), dev box fully offline.
  let p = await relayPanel(PROVEN, [off(A8_CF), on(A8_TS), off(DEV_URL)]);
  assert.equal(pillText(p.draw()), '1/2 online',
    'the a8 must read online from its one answering route, and the offline dev box must remain counted');
  // both a8 routes down, dev up: the a8 is a known (cached) box that is simply offline — still 2 boxes.
  p = await relayPanel(PROVEN, [off(A8_CF), off(A8_TS), on(DEV_URL)]);
  assert.equal(pillText(p.draw()), '1/2 online',
    'a box whose every address is down must stay in the denominator (cached identity), so the badge can go red');
});

test('CONTROL: three addresses with three DISTINCT proven keys → "3/3 online"', async () => {
  const PROVEN = { [A8_CF]: A8, [A8_TS]: THIRD, [DEV_URL]: DEV };
  const p = await relayPanel(PROVEN, [on(A8_CF), on(A8_TS), on(DEV_URL)]);
  assert.equal(pillText(p.draw()), '3/3 online',
    'three genuinely separate boxes must read 3/3 — proving the test reflects the grouping and is not ' +
    'hard-wired to 2');
});
