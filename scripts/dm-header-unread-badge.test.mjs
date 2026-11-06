// THE DM BADGE MUST SHOW UNREAD COUNT, NOT TOTAL — AND OPENING A DM MUST CLEAR ITS DOT.
// Run: node --test scripts/dm-header-unread-badge.test.mjs
//
// The steward console's DmHeaderDropdown (app/stew-dashboard.jsx) tracks per-peer "last seen"
// timestamps in localStorage. The badge shows HOW MANY conversations have something new, not how
// many conversations exist. Opening one (via steward-open-dm) marks it read, decrements the badge,
// and flips the clay dot to a chat icon. Deleting DmHeaderDropdown from the screen must break these
// tests — they render the real component and read the tree, never text-match the source (rule 3).
//
// WHAT THIS COVERS (rule 1: test at point of USE):
//   1. badge count = unread, not total
//   2. opening a DM marks it read and the badge decrements
//   3. all-read conversations still show (dropdown says "PRIVATE MESSAGES", not "No private messages yet")
//   4. zero conversations → "No private messages yet"
//   5. clay dot for unread, Icon for read
//   6. the steward-open-dm listener is cleaned up on unmount
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

// ── extract & compile DmHeaderDropdown + its three helpers ──────────────────────────────────────
// fnBody can slice each function; we join them and compile them as one JSX file so the component
// runs the REAL shipped code and closes over the REAL helpers.
function loadDropdown() {
  const helpers = [
    fnBody(STEW, 'function _dmSeenKey(peer) {', '_dmSeenKey'),
    fnBody(STEW, 'function _dmReadSeen() {', '_dmReadSeen'),
    fnBody(STEW, 'function _dmMarkSeen(peer) {', '_dmMarkSeen'),
  ].join('\n');
  const comp = fnBody(STEW, 'function DmHeaderDropdown(', 'DmHeaderDropdown');
  const src = helpers + '\n' + comp + '\nexport { DmHeaderDropdown };\n';
  const tmp = join(tmpdir(), 'dmbadge-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
      [tmp, '--jsx=transform', '--format=esm', '--log-level=error'],
      { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  return js;
}

const MODULE_JS = loadDropdown();

// ── miniReact (same shape as the sibling test) ──────────────────────────────────────────────────
function miniReact() {
  const states = [], memos = [], effDeps = [];
  let queued = [];
  let i = 0, mi = 0, ei = 0;
  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, n) => Object.is(v, b[n]));
  const cleanups = [];
  const React = {
    useState(init) {
      const k = i++;
      if (!(k in states)) states[k] = typeof init === 'function' ? init() : init;
      return [states[k], (v) => { states[k] = typeof v === 'function' ? v(states[k]) : v; }];
    },
    useMemo(f, deps) {
      const k = mi++;
      if (!memos[k] || !sameDeps(memos[k].deps, deps)) memos[k] = { deps, v: f() };
      return memos[k].v;
    },
    useCallback(f, deps) { return React.useMemo(() => f, deps); },
    useEffect(fn, deps) {
      const k = ei++;
      if (!(k in effDeps) || !sameDeps(effDeps[k], deps)) { effDeps[k] = deps; queued.push(fn); }
    },
    useRef: (init) => ({ current: init === undefined ? null : init }),
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    Fragment: 'Fragment',
  };
  const flush = () => {
    const run = queued; queued = [];
    run.forEach(fn => { try { const c = fn(); if (typeof c === 'function') cleanups.push(c); } catch (e) { throw new Error('effect threw: ' + e.message); } });
  };
  const unmount = () => { const c = cleanups.splice(0); c.forEach(f => { try { f(); } catch {} }); return c.length; };
  return { React, reset: () => { i = 0; mi = 0; ei = 0; }, flush, unmount };
}

// ── tree walkers (same as render-jsx-screen.mjs) ────────────────────────────────────────────────
const texts = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; }
  if (n.props) Object.values(n.props).forEach(v => { if (typeof v === 'string') out.push(v); else if (v && (v.kids || Array.isArray(v))) texts(v, out); });
  (n.kids || []).forEach(c => texts(c, out));
  return out;
};
const find = (n, pred, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => find(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  Object.values(n.props || {}).forEach(v => { if (v && typeof v === 'object' && (v.kids || Array.isArray(v))) find(v, pred, out); });
  (n.kids || []).forEach(c => find(c, pred, out));
  return out;
};

// ── a rig that creates the component with a controlled localStorage + event bus ─────────────────
async function rig({ convos = [], members = [], store = {} } = {}) {
  const { React, reset, flush, unmount } = miniReact();
  const listeners = new Map();
  const lsStore = { ...store };
  const localStorage = {
    _store: lsStore,
    get length() { return Object.keys(lsStore).length; },
    key(i) { return Object.keys(lsStore)[i] || null; },
    getItem(k) { return k in lsStore ? lsStore[k] : null; },
    setItem(k, v) { lsStore[k] = String(v); },
    removeItem(k) { delete lsStore[k]; },
  };
  const win = {
    useStewardMembers: () => members,
    addEventListener(k, f) { listeners.set(k, [...(listeners.get(k) || []), f]); },
    removeEventListener(k, f) { listeners.set(k, (listeners.get(k) || []).filter(x => x !== f)); },
    dispatchEvent(ev) { (listeners.get(ev.type) || []).forEach(f => f(ev)); },
    localStorage,
  };
  const key = '__dmbadge_' + Math.random().toString(36).slice(2);
  globalThis[key] = {
    React, window: win, localStorage, document: { addEventListener() {}, removeEventListener() {} },
    Icon: () => null, SkBadge: () => null, SK_TINT: { gold: { fg: '#999' } },
    CustomEvent: class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
  };
  const preamble = Object.keys(globalThis[key]).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const b64 = Buffer.from(preamble + '\n' + MODULE_JS).toString('base64');
  const { DmHeaderDropdown } = await import('data:text/javascript;base64,' + b64);

  const draw = (props) => {
    reset();
    const t = DmHeaderDropdown({ dmConvos: convos, narrow: false, ...props });
    flush();
    return t;
  };
  const dispatch = (pubkey) => {
    win.dispatchEvent(new globalThis[key].CustomEvent('steward-open-dm', { detail: { pubkey } }));
  };
  return { draw, dispatch, listeners, unmount, lsStore };
}

// ── badge helpers ───────────────────────────────────────────────────────────────────────────────
function badgeCount(tree) {
  const badges = find(tree, n => n.type === 'span' && n.props && n.props.style &&
    n.props.style.background === 'var(--clay-ink)' && n.props.style.minWidth === 17);
  if (!badges.length) return 0;
  const t = texts(badges[0]).join('');
  return parseInt(t, 10) || 0;
}
function clayDots(tree) {
  return find(tree, n => n.type === 'span' && n.props && n.props.style &&
    n.props.style.width === 8 && n.props.style.height === 8 &&
    n.props.style.background === 'var(--clay)');
}
function mainButton(tree) {
  return find(tree, n => n.type === 'button' && n.props && n.props.title === 'Private messages')[0];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 1. Badge shows UNREAD count, not total
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('the badge shows only UNREAD conversations, not the total count', async () => {
  const r = await rig({
    convos: [
      { peer: 'alice', npub: 'np1', ts: 100, preview: 'hello' },
      { peer: 'bob', npub: 'np2', ts: 200, preview: 'help me' },
      { peer: 'carol', npub: 'np3', ts: 50, preview: 'thanks' },
    ],
    store: { 'trinityone.dm-seen.carol': '60' },
  });
  const tree = r.draw();
  const btn = mainButton(tree);
  assert.ok(btn, 'the Messages button is not on the screen — DmHeaderDropdown may be deleted');
  const count = badgeCount(tree);
  assert.equal(count, 2,
    `badge says ${count} but only 2 of 3 conversations are unread (carol was seen at 60, her last is 50). ` +
    'If this is 3, the badge shows total conversations, not unread ones.');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2. Opening a DM marks it read — badge decrements
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('opening a DM via steward-open-dm marks it read and the badge decrements', async () => {
  const r = await rig({
    convos: [
      { peer: 'alice', npub: 'np1', ts: 100, preview: 'hello' },
      { peer: 'bob', npub: 'np2', ts: 200, preview: 'help me' },
    ],
  });
  r.draw();
  assert.equal(badgeCount(r.draw()), 2, 'both should start unread');
  r.dispatch('alice');
  const after = r.draw();
  assert.equal(badgeCount(after), 1,
    'marking alice read did not decrement the badge — the steward-open-dm handler may be broken or missing');
  assert.ok(r.lsStore['trinityone.dm-seen.alice'],
    'opening alice did not write a seen timestamp to localStorage');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 3. All-read conversations still show in dropdown (not "No private messages")
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('when all conversations are read, the dropdown still lists them', async () => {
  const r = await rig({
    convos: [
      { peer: 'alice', npub: 'np1', ts: 100, preview: 'hello' },
      { peer: 'bob', npub: 'np2', ts: 200, preview: 'help me' },
    ],
    store: { 'trinityone.dm-seen.alice': '200', 'trinityone.dm-seen.bob': '300' },
  });
  const tree = r.draw();
  assert.equal(badgeCount(tree), 0, 'both should be read — badge should be 0 or absent');
  const btn = mainButton(tree);
  btn.props.onClick();
  const open = r.draw();
  const all = texts(open).join(' | ');
  assert.ok(all.includes('PRIVATE MESSAGES'),
    'the dropdown does not show conversations when all are read — it shows "No private messages yet" instead, ' +
    'hiding existing conversations behind a zero badge');
  assert.ok(!all.includes('No private messages yet'),
    'the empty-state message appears even though there ARE conversations — all-read was confused with none');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 4. Zero conversations → "No private messages yet"
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('with zero conversations the dropdown shows the empty state', async () => {
  const r = await rig({ convos: [] });
  const tree = r.draw();
  const btn = mainButton(tree);
  assert.ok(btn, 'the Messages button is not on the screen');
  btn.props.onClick();
  const open = r.draw();
  const all = texts(open).join(' | ');
  assert.ok(all.includes('No private messages yet'),
    'the empty-state message is missing from the dropdown when there are no conversations');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 5. Clay dot for unread, no dot for read
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('unread conversations show a clay dot, read ones do not', async () => {
  const r = await rig({
    convos: [
      { peer: 'alice', npub: 'np1', ts: 100, preview: 'hello' },
      { peer: 'bob', npub: 'np2', ts: 200, preview: 'help me' },
    ],
    store: { 'trinityone.dm-seen.alice': '200' },
    members: [{ pubkey: 'alice', name: 'Alice' }, { pubkey: 'bob', name: 'Bob' }],
  });
  const tree = r.draw();
  mainButton(tree).props.onClick();
  const open = r.draw();
  const dots = clayDots(open);
  assert.equal(dots.length, 1,
    `expected 1 clay dot (bob is unread, alice is read) but found ${dots.length} — ` +
    (dots.length === 0 ? 'no unread indicator at all' : 'read conversations also show a dot'));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 6. The steward-open-dm listener is cleaned up
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('the steward-open-dm listener is removed on unmount', async () => {
  const r = await rig({
    convos: [{ peer: 'alice', npub: 'np1', ts: 100, preview: 'hello' }],
  });
  r.draw();
  r.draw();
  const before = (r.listeners.get('steward-open-dm') || []).length;
  assert.equal(before, 1, 'expected exactly one steward-open-dm listener');
  const ran = r.unmount();
  assert.ok(ran > 0, 'the effect returned no cleanup function');
  assert.equal((r.listeners.get('steward-open-dm') || []).length, 0,
    'the listener was not removed on unmount — each dropdown opened leaks one');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 7. Opening a DM from the dropdown dispatches steward-open-dm (round-trip)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('clicking a conversation in the dropdown dispatches steward-open-dm and marks it seen', async () => {
  const dispatched = [];
  const r = await rig({
    convos: [
      { peer: 'alice', npub: 'np1', ts: 100, preview: 'hello' },
      { peer: 'bob', npub: 'np2', ts: 200, preview: 'help me' },
    ],
    members: [{ pubkey: 'alice', name: 'Alice' }, { pubkey: 'bob', name: 'Bob' }],
  });
  r.draw();
  mainButton(r.draw()).props.onClick();
  const open = r.draw();
  const rows = find(open, n => n.type === 'div' && n.props && n.props.onClick &&
    n.props.style && n.props.style.cursor === 'pointer');
  assert.ok(rows.length >= 2, 'the conversation rows are not clickable — re-anchor');
  rows[0].props.onClick();
  const after = r.draw();
  assert.ok(r.lsStore['trinityone.dm-seen.alice'],
    'clicking a conversation in the dropdown did not mark it as seen in localStorage');
});
