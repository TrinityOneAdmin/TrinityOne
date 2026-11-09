// THE SCREEN HALF of work item A (plan §3): the "Keep your relays in sync" control is a REAL TOGGLE bound to
// the persisted state, and the Relays list shows a per-relay "Synced ✓ / Catching up…" indicator.
// Run: node --test scripts/sync-toggle-and-indicator-on-screen.test.mjs
//
// Rule 1 (point of use) + rule 3 (never text-match app/*.jsx): the engine test
// (sync-readback-reads-the-gated-doc-authenticated.test.mjs) proves backupState computes syncOn from the
// authenticated read and relaySyncState classifies a box — but deleting the toggle's binding, or the per-relay
// chip, from the SCREEN leaves those engine tests green. So this RENDERS the real DashRelayHistoryCard and
// DashRelaysCard (sliced from app/stew-dashboard.jsx, compiled with the same --jsx=transform the build uses)
// and reads the rendered tree. Nothing here matches text in a .jsx file.
//
// node_modules is hard-linked in the worktree so esbuild runs; a bare worktree would fail on esbuild ENOENT,
// which is not a code failure (CLAUDE.md audit-briefs note).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

// Slice a TOP-LEVEL component out by source boundary — from its `function X()` to the next top-level
// `\nfunction ` — rather than brace-walking. fnBody (test-slice.mjs) is deliberately NOT regex-aware, and
// DashRelayHistoryCard carries regexes that END in `//` (`/^wss?:\/\//i`, `/:\/\//`), which its brace walker
// reads as a line comment and mis-balances on. The real file compiles; only the slicer trips. Every component
// here is a column-0 `function`, and inner helpers are indented or arrow-assigned, so `\nfunction ` marks only
// the next top-level definition — a robust boundary that needs no source normalisation.
function sliceComponent(src, anchor) {
  const start = src.indexOf(anchor);
  assert.ok(start > 0, `${anchor} is not in app/stew-dashboard.jsx — re-anchor`);
  const end = src.indexOf('\nfunction ', start + anchor.length);
  assert.ok(end > start, `no top-level function follows ${anchor} — re-anchor`);
  return src.slice(start, end);
}

// A miniature React honouring call-order state, memo/callback deps and effects — the console-screen test pattern.
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
const find = (n, p, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => find(c, p, out)); return out; }
  if (p(n)) out.push(n);
  (n.kids || []).forEach(c => find(c, p, out));
  return out;
};
const texts = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; }
  if (n.props) Object.values(n.props).forEach(v => { if (typeof v === 'string') out.push(v); else if (v && (v.kids || Array.isArray(v))) texts(v, out); });
  (n.kids || []).forEach(c => texts(c, out));
  return out;
};

async function compileComponent(anchor, name, globals) {
  const src = sliceComponent(DASH, anchor);
  const tmp = join(tmpdir(), name + '-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__ui_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const b64 = Buffer.from(pre + '\n' + js).toString('base64');
  return (await import('data:text/javascript;base64,' + b64))[name];
}

// ── TOGGLE: DashRelayHistoryCard ───────────────────────────────────────────────────────────────────────────
async function toggleCard({ syncOn, owner = true }) {
  const { React, reset, flush } = mini();
  const Steward = {
    syncEnable: async () => ({ relays: 2 }), syncDisable: async () => ({ relays: 0 }),
    ownRelay: () => 'wss://box.example/relay', resolveRelayName: async () => null, cloneFromRelay: async () => ({ imported: 0 }),
  };
  const globals = {
    React,
    window: { Steward, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} },
    useRelayBackupState: () => ({ backup: { boxes: 2, online: 2, syncOn } }),
    stewCapState: () => ({ owner }),
    SYNC_OWNER_ONLY: 'owner only',
    Panel: ({ title, children }) => ({ type: 'section', props: { title }, kids: [children] }),
    Icon: () => null,
  };
  const Comp = await compileComponent('function DashRelayHistoryCard()', 'DashRelayHistoryCard', globals);
  const draw = () => { reset(); const t = Comp({}); flush(); return t; };
  return draw();
}
const theSwitch = (tree) => {
  const hits = find(tree, n => n && n.props && n.props.role === 'switch');
  assert.ok(hits.length, 're-anchor: no role="switch" control in the sync card — the toggle was removed or unbound');
  return hits[0];
};

test('the sync control reads ON when sync is persisted on', async () => {
  const sw = theSwitch(await toggleCard({ syncOn: true }));
  assert.equal(sw.props['aria-checked'], true,
    'sync is persisted ON (backupState.syncOn true) but the toggle renders OFF — the control is not bound to the ' +
    'persisted state, which is the "reverts on refresh" bug on screen');
  assert.ok(texts(sw).join(' ').includes('on'), 'the label should say sync is on');
});

test('the sync control reads OFF when sync is persisted off (fails if the toggle is hard-wired on)', async () => {
  const sw = theSwitch(await toggleCard({ syncOn: false }));
  assert.equal(sw.props['aria-checked'], false,
    'sync is off but the toggle renders ON — it is not reading the persisted state');
});

test('a delegated (non-owner) console sees the toggle locked, not vanished', async () => {
  const sw = theSwitch(await toggleCard({ syncOn: false, owner: false }));
  assert.equal(sw.props['aria-disabled'], true, 'a delegate must see a locked control that says why, not a missing one');
});

// ── PER-RELAY INDICATOR: DashRelaysCard ──────────────────────────────────────────────────────────────────────
const A8 = '6a4267558c9990d0391b3472bac9735d33a5e99b5c7cb0e49bdece7ea6b770f2';
const DEV = 'a'.repeat(64);
const GOOD = 'wss://good.example/relay';     // reports a clean sync pass with peers
const BEHIND = 'wss://behind.example/relay'; // reports an island / failing pass

async function relaysCard(STATUS, SYNCSTATES) {
  const { React, reset, flush } = mini();
  const Steward = {
    provenRelayPub: (u) => ({ [GOOD]: A8, [BEHIND]: DEV })[u] || '',
    classifyRelay: () => 'neutral',
    sharedRelayKeys: () => [A8], relayNet: async () => [], ownRelay: () => '', isSelfHosted: () => false,
    relayNameFor: () => '', canRemoveRelay: () => true, removeRelay: () => true,
    relaySyncStates: async () => SYNCSTATES,
  };
  const globals = {
    React,
    window: { Steward, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} },
    Icon: () => null,
    SkPill: ({ children }) => ({ type: 'span', props: {}, kids: [children] }),
    SkCard: ({ children }) => ({ type: 'div', props: {}, kids: [children] }),
    relayRejectionActive: false, noteRelayRejection: () => {}, clearRelayRejection: () => {}, shortNpub: () => '',
    dropRefusalsNotListed: () => {},
    useRelayBackupState: () => ({ status: STATUS, backup: { boxes: 2, online: 2, syncOn: true } }),
    location: { host: 'app.trinityone.church' },
    relaysThatRefused: () => [],
    Panel: ({ children }) => ({ type: 'section', props: {}, kids: [children] }),
  };
  const Comp = await compileComponent('function DashRelaysCard()', 'DashRelaysCard', globals);
  const draw = () => { reset(); const t = Comp({}); flush(); return t; };
  draw();                                           // kicks the async relaySyncStates effect
  await new Promise(r => setTimeout(r, 0));          // let it resolve + setState
  return draw();                                     // render with the sync states settled
}
const on = (url) => ({ url, status: 'on', ms: 20, member: true });
const syncChips = (tree) => find(tree, n => n && n.props && n.props['data-sync']);

test('a box reporting a behind/island sync shows "Catching up…"/"Not syncing", a good box shows "Synced"', async () => {
  const tree = await relaysCard(
    [on(GOOD), on(BEHIND)],
    [{ url: GOOD, state: 'synced', label: 'Synced' }, { url: BEHIND, state: 'island', label: 'Not syncing' }],
  );
  const chips = syncChips(tree);
  assert.equal(chips.length, 2, 'both answering relays should carry a per-relay sync chip — the indicator is missing from the list');
  const behind = chips.find(c => c.props['data-sync'] === 'island');
  assert.ok(behind, 'the behind box has no "catching up/behind" chip — a steward cannot see which relay is stale');
  assert.ok(texts(behind).join(' ').includes('Not syncing'), 'the behind box must say it is not syncing');
  const good = chips.find(c => c.props['data-sync'] === 'synced');
  assert.ok(good && texts(good).join(' ').includes('Synced'), 'the healthy box must read Synced');
});

test('CONTROL: with no sync reading, no chip is shown (does not invent a state)', async () => {
  const tree = await relaysCard([on(GOOD)], []);
  assert.equal(syncChips(tree).length, 0, 'a relay with no /status.sync reading must show no chip, not a guessed one');
});
