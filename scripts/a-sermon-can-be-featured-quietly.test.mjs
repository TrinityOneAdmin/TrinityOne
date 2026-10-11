// A STEWARD CHOOSES, EACH TIME, WHETHER MEMBERS ARE NOTIFIED WHEN A SERMON IS FEATURED (owner, 2026-10-11).
//
// Readers of `trinityone/pinsermon:<church>` (CLAUDE.md rule 2), and what each does with `notify:false`:
//   writer   Steward.pinSermon (src/steward.src.js)         writes the field; opts.notify===false only
//   console  DashSermons (app/stew-dashboard.jsx)           the Feature / Featured control + the choice
//   console  Steward.subscribePinnedSermon                  reads id only (which sermon shows "Featured")
//   member   Fellowship.subscribePinnedSermon               passes the whole document through (...p)
//   member   App `pinnedSermon` -> Today card               shows in BOTH cases
//   member   App `notifications` (the bell)                 SKIPS a notify:false pin
//   relay    maybePushSermon (scripts/gateway.mjs)          SKIPS a notify:false pin (no push)
//   relay    ingest rules / read gates (gateway.mjs)        by d-tag only, content never read
// Absent field = notify, so every older document behaves as it always did.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniReact, find, reads, loadScreen } from './render-jsx-screen.mjs';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(ROOT + 'vendor/steward.js', 'utf8');
const GATEWAY = readFileSync(ROOT + 'scripts/gateway.mjs', 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
const ticks = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };

// ---------- console: the real DashSermons ----------
const SERMONS = [
  { id: 's1', title: 'Sunday morning', sha256: 'aa', size: 10, mime: 'audio/mp4' },
  { id: 's2', title: 'Evening prayer', sha256: 'bb', size: 20, mime: 'video/mp4' },
];
const STUB = () => function Stub(p) { return { type: 'div', props: {}, kids: [p && p.children].flat().filter(Boolean) }; };
function panel({ pinned }) {
  const { React, draw } = miniReact();
  const pinCalls = [];
  const win = {
    Steward: {
      subscribeSermons: (cb) => { cb(SERMONS); return () => {}; },
      subscribePinnedSermon: (cb) => { cb(pinned ? { id: pinned } : null); return () => {}; },
      subscribeMediaKey: () => () => {}, mediaHosts: () => [],
      removeSermon: async () => true, unpinSermon: async () => true,
      pinSermon: async (s, o) => { pinCalls.push([s && s.id, o]); return true; },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashSermons'], {
    React, window: win, Icon: () => null, SkBadge: STUB(), SkPill: STUB(), SkToggle: STUB(),
    Panel: ({ children }) => children, DismissibleNote: ({ children }) => children,
    useStewDialog: () => ({ current: null }), useStewModalOpen: () => {}, location: { search: '' },
    setTimeout, clearTimeout, URL, URLSearchParams, Blob,
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp,
  });
  let tree = draw(mod.DashSermons, {}); tree = draw(mod.DashSermons, {});
  const redraw = () => { tree = draw(mod.DashSermons, {}); };
  const row = (id) => { const h = find(tree, n => n.props && n.props.key === id && n.type === 'div'); assert.equal(h.length, 1, 're-anchor: row ' + id); return h[0]; };
  const btn = (node, label) => find(node, n => n.type === 'button' && reads(n).trim() === label && n.props.onClick);
  const press = async (node, label) => { const h = btn(node, label); assert.equal(h.length, 1, `expected exactly one "${label}" button, found ${h.length}`); h[0].props.onClick(); await ticks(); redraw(); };
  return { pinCalls, row, btn, press };
}

test('the control is LABELLED: "Feature" on a normal sermon, "Featured" on the featured one', () => {
  const p = panel({ pinned: 's1' });
  assert.equal(p.btn(p.row('s1'), 'Featured').length, 1, 'featured sermon does not say "Featured"');
  assert.equal(p.btn(p.row('s1'), 'Feature').length, 0);
  assert.equal(p.btn(p.row('s2'), 'Feature').length, 1, 'ordinary sermon does not say "Feature"');
  assert.equal(p.btn(p.row('s2'), 'Featured').length, 0);
});

test('tapping Feature offers the two buttons and publishes NOTHING until one is chosen', async () => {
  const p = panel({ pinned: null });
  assert.equal(p.btn(p.row('s2'), 'Feature quietly').length, 0, 'choice shown before Feature was tapped');
  await p.press(p.row('s2'), 'Feature');
  assert.equal(p.btn(p.row('s2'), 'Feature and notify').length, 1);
  assert.equal(p.btn(p.row('s2'), 'Feature quietly').length, 1);
  assert.deepEqual(p.pinCalls, [], 'Feature published straight away - there must be no default');
});

test('"Feature quietly" publishes notify:false, "Feature and notify" does not; screen -> REAL pinSermon', async () => {
  const published = [];
  const engine = new Function('scope', `with (scope) { return { ${fnBody(STEW, 'pinSermon(s, opts) {', 'pinSermon')} }; }`)({
    sk: new Uint8Array(1), pub: 'cc', PINSERMON_D: 'trinityone/pinsermon:', NET: 'trinityone', JSON,
    now: () => 1000, feChurch: (e) => e, publish: (e) => { published.push(e); return Promise.resolve(true); },
  });
  for (const [label, expectNotify] of [['Feature quietly', false], ['Feature and notify', true]]) {
    const p = panel({ pinned: null });
    await p.press(p.row('s2'), 'Feature');
    await p.press(p.row('s2'), label);
    assert.equal(p.pinCalls.length, 1, label + ' did not reach pinSermon once');
    assert.equal(p.btn(p.row('s2'), 'Feature quietly').length, 0, 'choice stayed open after choosing');
    const [sid, opts] = p.pinCalls[0];
    assert.equal(sid, 's2');
    await engine.pinSermon(SERMONS[1], opts);
    const doc = JSON.parse(published.pop().content);
    if (expectNotify) assert.notEqual(doc.notify, false, 'Feature and notify wrote notify:false');
    else assert.equal(doc.notify, false, 'Feature quietly did not write notify:false');
    assert.equal(doc.sha256, 'bb');
  }
  await engine.pinSermon(SERMONS[0]);   // an old-style call with no options
  assert.equal('notify' in JSON.parse(published.pop().content), false, 'a plain pin must not add the field');
});

test('tapping Featured still unfeatures (no choice shown)', async () => {
  const p = panel({ pinned: 's1' });
  await p.press(p.row('s1'), 'Featured');
  assert.equal(p.btn(p.row('s1'), 'Feature quietly').length, 0);
  assert.deepEqual(p.pinCalls, []);
});

// ---------- member: the real App ----------
let App, window, reset, flush;
const calls = {};
before(() => {
  const r = fakeReact(); reset = r.reset; flush = r.flush;
  window = appBrowser().window;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  App = loadApp({ React: r.React, window, expr: 'App' });
  const np = 'npub1' + '0'.repeat(58);
  window.TrinityData.CHURCHES = [{ id: np, npub: np, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(np));
  window.Fellowship = new Proxy({ myPubkey: 'deadbeef', CANONICAL_RELAYS: [], hasRelays: true }, {
    get: (t, k) => { if (k in t) return t[k]; if (k === 'then' || typeof k === 'symbol') return undefined; return (...a) => { (calls[k] = calls[k] || []).push(a); return () => {}; }; },
  });
});
const drawApp = () => { reset(); const t = App(); flush(); return t; };
const deliver = (m, v) => (calls[m] || []).forEach(a => a.filter(x => typeof x === 'function').forEach(cb => cb(v)));
const ctxOf = (key) => { const s = nodes(drawApp()).find(n => n.props && n.props.ctx && key in n.props.ctx); assert.ok(s, 'no screen got ctx.' + key); return s.props.ctx; };
const NOW = Math.floor(Date.now() / 1000);
const pin = { id: 's1', title: 'Hope', sha256: 'aa'.repeat(32), hosts: ['https://h'], mime: 'video/mp4', ts: NOW };

test('member: App subscribes (re-anchor)', async () => {
  drawApp(); await new Promise(r => setTimeout(r, 1500)); drawApp();
  assert.ok(calls.subscribePinnedSermon);
});
test('member: a notify:false pin shows the Today card but adds NO bell entry', () => {
  deliver('subscribePinnedSermon', { ...pin, notify: false });
  const ctx = ctxOf('pinnedSermon');
  assert.equal(ctx.pinnedSermon && ctx.pinnedSermon.id, 's1', 'the Today card vanished');
  assert.equal(ctxOf('notifications').notifications.filter(n => n.kind === 'sermon').length, 0, 'a quiet feature still reached the bell');
});
test('member: an OLD pin (no field) and notify:true still notify', () => {
  for (const doc of [pin, { ...pin, notify: true }]) {
    deliver('subscribePinnedSermon', doc);
    assert.equal(ctxOf('pinnedSermon').pinnedSermon.id, 's1');
    const bell = ctxOf('notifications').notifications.filter(n => n.kind === 'sermon');
    assert.equal(bell.length, 1, 'a normal feature lost its bell entry: ' + JSON.stringify(doc));
  }
});

// ---------- relay push: maybePushSermon lifted from the shipped gateway ----------
function relay() {
  const pushed = [];
  const CP = 'cc'.repeat(32), M = 'dd'.repeat(32);
  const fn = new Function('scope', `with (scope) { ${fnBody(GATEWAY, 'function maybePushSermon(evt)', 'maybePushSermon')}\nreturn maybePushSermon; }`)({
    PINSERMON_D: 'trinityone/pinsermon:', CHURCH_PUBS: new Set([CP]), SERMON_PUSHED: new Set(),
    stewardCan: () => true, displayName: () => 'Church', MEMBERS: new Set([M]), memberIn: () => true,
    pushTo: (m, payload) => pushed.push([m, payload]), String, JSON,
  });
  let n = 0;
  return { pushed, send: (doc) => fn({ kind: 30078, id: 'e' + (++n), pubkey: CP, tags: [['d', 'trinityone/pinsermon:' + CP]], content: JSON.stringify(doc) }) };
}
test('relay: a notify:false pin pushes nobody; old / notify:true pins push the member', () => {
  const r = relay();
  r.send({ ...pin, notify: false }); assert.equal(r.pushed.length, 0, 'a quiet feature was pushed');
  r.send(pin); assert.equal(r.pushed.length, 1, 'an old pin (no field) no longer pushes');
  r.send({ ...pin, notify: true }); assert.equal(r.pushed.length, 2);
});
