// THE "UPCOMING IN THIS GROUP" CARD FOLDS AWAY WHEN IT LISTS MORE THAN ONE EVENT (owner 2026-10-15).
// Run: node --test scripts/group-events-collapse.test.mjs
//
// Point of use (CLAUDE.md rules 1 and 3): the REAL member ChatRoom (app/screens-chat.jsx) and the REAL console
// GroupChatModal (app/stew-dashboard.jsx) are compiled with the build's esbuild and rendered through the
// miniature React. Collapsed shows "N events · next Sun 4 Oct"; one event has no chevron and stays shown; the
// choice is remembered per room. Nothing matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const EVS = [
  { id: 'e1', title: 'Pizza night', date: '2026-10-04', time: '18:00', groupId: 'g1', accent: '#888' },
  { id: 'e2', title: 'Quiz', date: '2026-10-11', time: '19:00', groupId: 'g1', accent: '#888' },
  { id: 'e3', title: 'Hike', date: '2026-10-18', groupId: 'g1', accent: '#888' },
];
const chev = (t) => find(t, n => n.type === 'button' && n.props && n.props['data-ev-chevron']);
const summary = (t) => find(t, n => n.type === 'button' && n.props && n.props['data-ev-summary']);
const all = (t) => texts(t).join(' | ');

// ── member app ──────────────────────────────────────────────────────────────────────────────────────────
function room(events, store = new Map()) {
  const { React, draw } = miniReact();
  const group = { id: 'g1', name: 'Youth', kind: 'Group', accent: '#888' };
  const Fellowship = {
    myPubkey: 'me', relays: ['wss://r'], relayReady: () => true, groupEncState: () => 'clear',
    subscribeGroup: () => () => {}, subscribeReactions: () => () => {}, subscribeGroupPin: (_g, cb) => { cb(null); return () => {}; },
    subscribeHidden: (_g, cb) => { cb(new Set()); return () => {}; }, subscribeMessageTags: () => () => {},
    displayFor: () => ({ handle: 'sam', color: '#888' }), requestProfiles: () => {}, outboxFor: () => [], onOutbox: () => () => {},
    canAddGroupEvent: () => false, react: () => {},
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatRoom'], {
    React,
    window: { Fellowship, TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
      TrinityIdentity: { current: { handle: 'me', color: '#123456' } }, addEventListener() {}, removeEventListener() {},
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => true },
    document: { createElement: () => ({ style: {} }), body: {}, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    lsGet: (k, d) => (store.has(k) ? store.get(k) : d), lsSet: (k, v) => store.set(k, v), todayISO: () => '2026-09-01',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }), IconBtn: () => null,
    Overlay: ({ open, children }) => (open ? children : null), UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ children }) => children, safeCssColor: (c) => c, D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = { toast() {}, church: { npub: 'npub1church', name: 'St Aidan', id: 'c1' }, myLeaderGroups: [], churchEvents: events,
    safeguard: {}, myPubkey: 'me', openDM() {}, canDMPeer: () => true, connTick: 0,
    joinState: { loaded: true, isPending: false, removed: false, offline: false } };
  let tree;
  const render = () => { tree = draw(mod.ChatRoom, { group, open: true, onClose() {}, ctx, docked: true }); return tree; };
  render();
  return { render, store };
}

test('member: >1 event shows a chevron; it folds to "3 events · next Sun 4 Oct" and unfolds again', () => {
  const r = room(EVS);
  let t = r.render();
  assert.equal(chev(t).length, 1, 'no chevron on a card with three events');
  assert.match(all(t), /Pizza night/, 'default is open');
  assert.equal(summary(t).length, 0);
  chev(t)[0].props.onClick();
  t = r.render();
  assert.equal(summary(t).length, 1, 'folding did not show the summary');
  assert.match(texts(summary(t)[0]).join(''), /^3 events · next Sun 4 Oct$/);
  assert.doesNotMatch(all(t), /Pizza night|Quiz/, 'the events are still listed while folded');
  assert.match(all(t), /UPCOMING IN THIS GROUP/, 'the header must stay');
  chev(t)[0].props.onClick();
  t = r.render();
  assert.match(all(t), /Pizza night/, 'unfolding did not bring the events back');
});

test('member: the fold is remembered per room', () => {
  const store = new Map();
  const a = room(EVS, store);
  chev(a.render())[0].props.onClick();
  const again = room(EVS, store).render();          // a fresh mount of the same room
  assert.equal(summary(again).length, 1, 'the folded state was not remembered');
  assert.deepEqual([...store.keys()], ['trinityone.groupEvOpen.g1']);
});

test('member: ONE event has no chevron and stays shown', () => {
  const t = room([EVS[0]]).render();
  assert.equal(chev(t).length, 0, 'a single event got a chevron');
  assert.match(all(t), /Pizza night/);
});

// ── console ─────────────────────────────────────────────────────────────────────────────────────────────
async function loadConsole(globals) {
  const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
  const name = 'GroupChatModal';
  const src = fnBody(STEW, 'function GroupChatModal({ group, onClose }) {', name) + '\n' + fnBody(STEW, 'function groupIcon(', 'groupIcon');   // + the room-icon helper it draws through
  const tmp = join(tmpdir(), 'gevc-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__gev_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

async function consoleModal(events, store = new Map()) {
  const { React, draw } = miniReact();
  const win = {
    Steward: {
      subscribeGroupChat: (id, cb) => { cb([]); return () => {}; }, subscribeGroupPin: (id, cb) => { cb(null); return () => {}; },
      subscribeGroupEvents: (id, cb) => { cb(events); return () => {}; },
    },
    useStewardMembers: () => [], dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
  };
  const Comp = await loadConsole({
    React, window: win, document: { addEventListener() {}, removeEventListener() {} }, CustomEvent, setTimeout, clearTimeout,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }), SkBadge: Stub('SkBadge'), SkConfirm: Stub('SkConfirm'),
    EventComposer: Stub('EventComposer'), useStewDialog: () => ({}),
    initialsFor: () => 'XX', avFor: () => '', nameFor: () => 'Ada', GROUP_EMOJI: ['x'],
  });
  let tree;
  const render = () => { tree = draw(Comp, { group: { id: 'g1', name: 'Whole Church', kind: 'group' }, onClose() {} }); return tree; };
  render(); render();
  return { render };
}

test('console: >1 event folds to the summary and unfolds; rows have breathing room', async () => {
  const c = await consoleModal(EVS);
  let t = c.render();
  assert.equal(chev(t).length, 1, 'no chevron on the console strip with three events');
  const rows = find(t, n => n.type === 'button' && n.props && n.props.title === 'See full details');
  assert.equal(rows.length, 3);
  rows.forEach(b => { assert.equal(b.props.style.padding, '7px 0'); assert.equal(b.props.style.minHeight, 36); });
  assert.ok(rows[1].props.style.borderTop && rows[1].props.style.borderTop !== 'none', 'no divider between events');
  chev(t)[0].props.onClick();
  t = c.render();
  assert.equal(texts(summary(t)[0]).join(''), '3 events · next Sun 4 Oct');
  assert.doesNotMatch(all(t), /Pizza night/);
  chev(t)[0].props.onClick();
  assert.match(all(c.render()), /Pizza night/);
});

test('console: ONE event has no chevron and stays shown', async () => {
  const t = (await consoleModal([EVS[0]])).render();
  assert.equal(chev(t).length, 0);
  assert.match(all(t), /Pizza night/);
});
