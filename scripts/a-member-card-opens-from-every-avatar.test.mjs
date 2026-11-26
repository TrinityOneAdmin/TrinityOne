// EVERY OTHER MEMBER'S PICTURE OPENS THEIR CARD, AND NOTHING ELSE HAPPENS WHEN YOU TAP IT.
//   Run: node --test scripts/a-member-card-opens-from-every-avatar.test.mjs
//
// Extension of a-member-card-opens-from-an-avatar.test.mjs (which covers the chat bubble, the DM list and the people
// list). Each case here MOUNTS the shipped component (app/*.jsx compiled by scripts/render-jsx-screen.mjs, with the
// REAL UserAvatar inside it) and taps the avatar the way a thumb does: click dispatch BUBBLES, innermost first, and
// honours stopPropagation. So "tapping the avatar does not also fire the row" is tested as a browser behaves.
// Rule 3: nothing matches source text. The parent comparison reads `git show d1599250:<file>` and RUNS it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ME = 'a'.repeat(64), ANNA = 'b'.repeat(64), CHURCH = 'c'.repeat(64);
const safeImgUrl = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return /^data:image\/[a-zA-Z0-9.+-]+;/.test(s) ? s : ''; };
const iconStub = (React) => ({ name }) => React.createElement('i', { 'data-icon': name });

function pathTo(n, pred, acc = []) {
  if (!n || typeof n !== 'object') return null;
  if (Array.isArray(n)) { for (const c of n) { const r = pathTo(c, pred, acc); if (r) return r; } return null; }
  const here = [...acc, n];
  if (pred(n)) return here;
  for (const c of (n.kids || [])) { const r = pathTo(c, pred, here); if (r) return r; }
  return null;
}
function click(path) {
  const ev = { stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} };
  for (let i = path.length - 1; i >= 0 && !ev.stopped; i--) {
    const h = path[i].props && path[i].props.onClick;
    if (typeof h === 'function') h(ev);
  }
  return ev;
}
const isTap = (n) => n.type === 'span' && n.props && n.props.role === 'button' && /^View .*profile$/.test(n.props['aria-label'] || '');
const words = (n, out = []) => { if (n == null || n === false) return out; if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; } if (Array.isArray(n)) { n.forEach(c => words(c, out)); return out; } (n.kids || []).forEach(c => words(c, out)); return out; };
const flush = () => new Promise(r => setTimeout(r, 0));

function realAvatar(React) { return loadScreen('app/identity-avatar.jsx', ['UserAvatar'], { React, window: {}, safeImgUrl }).UserAvatar; }
const chatGlobals = (React, F, extra = {}) => ({
  React,
  window: { matchMedia: () => ({ matches: true }), Fellowship: F, addEventListener() {}, removeEventListener() {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] }, TrinityIdentity: { current: { handle: 'me', color: '#123456' } } },
  document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
  location: { search: '', href: 'https://app.trinityone.church/' },
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-26',
  Icon: iconStub(React),
  IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
  Overlay: ({ open, children }) => (open === false ? null : children), ScreenScroll: ({ children }) => children,
  ChurchPill: () => null, SectionLabel: ({ children }) => children, UserAvatar: realAvatar(React),
  BottomSheet: ({ open, children }) => (open === false ? null : children),
  safeCssColor: (c, f) => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()) ? c.trim() : (f || 'var(--clay)')), safeImgUrl, relTime: () => 'now',
  D: { GROUPS: [], RELAYS: [] },
  ...extra,
});
const baseF = (over = {}) => ({
  myPubkey: ME, relays: ['wss://relay.example'], requestProfiles() {},
  displayFor: (pk) => ({ handle: pk === ANNA ? 'Anna' : 'Me', av: { kind: 'monogram', color: '#5E8C6A' } }),
  ...over,
});
const mkCtx = (log, extra = {}) => ({
  church: { id: CHURCH, name: 'St Bride', npub: 'npub1church', accent: '#C25A38', initials: 'SB' }, toast() {}, shareText() {}, openShare() {},
  openDM: (pk) => log.push(['dm', pk]), openMember: (pk) => log.push(['member', pk]), canDMPeer: () => true, myPubkey: ME,
  joinState: { loaded: true, isPending: false, removed: false, offline: false, unknown: false }, myLeaderGroups: [], churchEvents: [],
  safeguard: { isMinor: false, clearanceKnown: true }, openPeople() {}, openDMInbox() {}, openGroup(g) { log.push(['group', g.id]); },
  ...extra,
});

// ── DM thread header ─────────────────────────────────────────────────────────────────────────────────────────
function thread(peer, ctxOver = {}) {
  const { React, draw } = miniReact();
  const F = baseF({ subscribeThread: () => () => {}, outboxForPeer: () => [], onOutbox: () => () => {}, dmPlaintextOf: () => '', reactDM() {}, sendDM: async () => ({}), requeue: () => true, dropQueued() {}, ready: Promise.resolve() });
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread'], chatGlobals(React, F));
  const log = [];
  const ctx = mkCtx(log, ctxOver);
  const props = { peer, open: true, onClose() { log.push(['close']); }, ctx, docked: false };
  draw(mod.DMThread, props);
  return { tree: draw(mod.DMThread, props), log };
}
test('POINT OF USE, DM thread header: the other person\'s picture opens their card; it is not a tap target on your own thread, and a missing openMember leaves it plain', () => {
  const { tree, log } = thread(ANNA);
  const path = pathTo(tree, isTap);
  assert.ok(path, 'no tappable avatar in the DM header');
  assert.equal(find(tree, isTap).length, 1);
  click(path);
  assert.deepEqual(log, [['member', ANNA]]);
  assert.equal(find(thread(ME).tree, isTap).length, 0, 'a thread with yourself must not offer a card of yourself');
  assert.equal(find(thread(ANNA, { openMember: undefined }).tree, isTap).length, 0, 'without ctx.openMember the avatar must stay plain');
});

// ── Community list: DM rows + search hits ────────────────────────────────────────────────────────────────────
const GROUP = { id: 'g1', name: 'Whole Church', kind: 'Group', visibility: 'open', childsafe: true, sub: 's', accent: '#C25A38' };
function community(ctxOver = {}, fOver = {}) {
  const { React, draw } = miniReact();
  const evt = { id: 'e1', pubkey: ANNA, created_at: 1763000000, tags: [['t', 'trinityone'], ['t', 'g1'], ['p', CHURCH]], content: 'hello world' };
  const F = baseF({ subscribeChurchGroups: (_n, cb) => { cb([GROUP]); return () => {}; }, subscribeChurchCategories: (_n, cb) => { cb([]); return () => {}; },
    subscribeGroups: (ids, cb) => { cb('g1', evt); return () => {}; }, assumeMinor: async () => false, ...fOver });
  const mod = loadScreen('app/screens-chat.jsx', ['ChatScreen'], chatGlobals(React, F));
  const log = [];
  const ctx = mkCtx(log, ctxOver);
  const redraw = () => draw(mod.ChatScreen, { ctx });
  redraw();
  return { log, redraw, tree: redraw() };
}
test('POINT OF USE, Community "Messages" rows: the picture opens the card and NOT the thread; the row still opens the thread (mouse and keyboard); your own thread has no avatar button', () => {
  const dm = [{ peer: ANNA, preview: 'hi', lastTs: 1763000000 }];
  const { tree, log } = community({ dmThreads: dm });
  const path = pathTo(tree, isTap);
  assert.ok(path, 'no tappable avatar on the Messages row');
  assert.equal(find(tree, n => n.type === 'button' && find(n, isTap).length).length, 0, 'the avatar must not sit INSIDE a <button> (invalid nesting)');
  const ev = click(path);
  assert.deepEqual(log, [['member', ANNA]], 'avatar tap must open the card only');
  assert.equal(ev.stopped, true);
  // the row's own action is untouched: tapping the name, or the row\'s button (which is how Enter/Space arrives), opens the DM
  log.length = 0;
  click(pathTo(tree, n => n.type === 'div' && words(n).join('') === 'Anna'));
  assert.deepEqual(log, [['dm', ANNA]]);
  log.length = 0;
  const rowBtn = pathTo(tree, n => n.type === 'button' && words(n).includes('Anna'));
  assert.ok(rowBtn, 'the row lost its button (keyboard users)');
  click(rowBtn);
  assert.deepEqual(log, [['dm', ANNA]], 'activating the row\'s button must still open the DM');
  const mine = community({ dmThreads: [{ peer: ME, preview: 'note', lastTs: 1 }] });
  assert.equal(find(mine.tree, isTap).length, 0, 'your own thread must not offer a card of yourself');
});
test('POINT OF USE, Community search hit: the author\'s picture opens their card, not the room; your own message has none', () => {
  const run = (author) => {
    const { React, draw } = miniReact();
    const evt = { id: 'e1', pubkey: author, created_at: 1763000000, tags: [['t', 'trinityone'], ['t', 'g1'], ['p', CHURCH]], content: 'hello world' };
    const F = baseF({ subscribeChurchGroups: (_n, cb) => { cb([GROUP]); return () => {}; }, subscribeChurchCategories: (_n, cb) => { cb([]); return () => {}; },
      subscribeGroups: (ids, cb) => { cb('g1', evt); return () => {}; }, assumeMinor: async () => false });
    const mod = loadScreen('app/screens-chat.jsx', ['ChatScreen'], chatGlobals(React, F));
    const log = []; const ctx = mkCtx(log);
    draw(mod.ChatScreen, { ctx });
    let tree = draw(mod.ChatScreen, { ctx });
    click(pathTo(tree, n => n.props && n.props['data-hdr-more'] === 'chevron'));
    tree = draw(mod.ChatScreen, { ctx });
    const pick = pathTo(tree, n => n.type === 'button' && words(n).join('') === 'Search');
    assert.ok(pick, 'could not find the Search entry in the header menu - re-anchor this test');
    click(pick);
    tree = draw(mod.ChatScreen, { ctx });
    const input = find(tree, n => n.props && n.props['data-chat-search-input'] === '1')[0];
    assert.ok(input, 'search bar did not open');
    input.props.onChange({ target: { value: 'hello' } });
    tree = draw(mod.ChatScreen, { ctx });
    return { tree, log };
  };
  const a = run(ANNA);
  const path = pathTo(a.tree, isTap);
  assert.ok(path, 'no tappable avatar on a search hit');
  assert.ok(path.some(n => n.props && n.props.role === 'button' && n.type === 'div'), 're-anchor: the hit is a role=button row');
  click(path);
  assert.deepEqual(a.log, [['member', ANNA]], 'avatar tap must not also open the room');
  assert.equal(find(run(ME).tree, isTap).length, 0, 'your own search hit must not offer a card of yourself');
});

// ── VerseShareSheet "send to someone" ────────────────────────────────────────────────────────────────────────
test('POINT OF USE, share-to-person picker: the picture opens the card and does NOT send; the row still sends (mouse and keyboard)', async () => {
  const { React, draw } = miniReact();
  const sent = [];
  const F = baseF({ publishMessage: async () => ({}), sendDM: async (pk) => { sent.push(pk); return {}; },
    subscribeChurchGroups: (_c, cb) => { cb([]); return () => {}; }, subscribeChurchMembers: (_c, cb) => { cb([{ pubkey: ME, name: 'Me' }, { pubkey: ANNA, name: 'Anna' }], true); return () => {}; } });
  const mod = loadScreen('app/screens-chat.jsx', ['VerseShareSheet'], chatGlobals(React, F));
  const log = [];
  const ctx = mkCtx(log);
  const props = { payload: { ref: 'John 3:16', text: 'For God so loved', version: 'BSB' }, open: true, onClose() {}, ctx };
  draw(mod.VerseShareSheet, props);
  await flush();
  const tree = draw(mod.VerseShareSheet, props);
  assert.equal(find(tree, isTap).length, 1, 'exactly one avatar button: Anna (not you)');
  assert.equal(find(tree, n => n.type === 'button' && find(n, isTap).length).length, 0, 'avatar must not sit inside a <button>');
  click(pathTo(tree, isTap));
  await flush();
  assert.deepEqual(log, [['member', ANNA]]);
  assert.deepEqual(sent, [], 'tapping the avatar sent the verse');
  click(pathTo(tree, n => n.type === 'button' && words(n).includes('Anna')));
  await flush();
  assert.deepEqual(sent, [ANNA], 'the row no longer sends when its button is activated');
});

// ── GroupInfo roster ─────────────────────────────────────────────────────────────────────────────────────────
function groupInfo(rows) {
  const { React, draw } = miniReact();
  const F = baseF({ subscribeChurchMembers: (_np, cb) => { cb(rows, true); return () => {}; }, assumeMinor: () => Promise.resolve(false),
    displayFor: (pk) => ({ handle: pk === ANNA ? 'Anna' : 'Me', name: pk === ANNA ? 'Anna' : 'Me', color: '#5E8C6A' }) });
  const mod = loadScreen('app/screens-chat.jsx', ['GroupInfo'], chatGlobals(React, F));
  const log = [];
  const ctx = mkCtx(log);
  const group = { id: 'g1', name: 'Prayer Partners', kind: 'Group', invite: true, encrypted: true, childsafe: true, accent: '#7a5', memberPubs: rows.map(r => r.pubkey), members: rows.length, openToChurch: false };
  const props = { group, open: true, onClose() {}, ctx };
  const go = async () => { draw(mod.GroupInfo, props); await flush(); return draw(mod.GroupInfo, props); };
  return { log, go, draw: () => draw(mod.GroupInfo, props) };
}
test('POINT OF USE, group-info roster: the row picture opens the card and does NOT select the row; the row still selects; the selected panel picture opens the card too; you have none', async () => {
  const g = groupInfo([{ pubkey: ME, name: 'Me' }, { pubkey: ANNA, name: 'Anna' }]);
  let tree = await g.go();
  const cb = find(tree, n => n.type === 'button' && n.props && ('aria-expanded' in n.props))[0];
  assert.ok(cb, 'no members button - re-anchor');
  cb.props.onClick();
  tree = g.draw();
  const taps = find(tree, isTap);
  assert.equal(taps.length, 1, 'exactly one avatar button in the roster: Anna. Your own row has none');
  assert.equal(find(tree, n => n.type === 'button' && find(n, isTap).length).length, 0, 'avatar must not sit inside a <button>');
  click(pathTo(tree, isTap));
  assert.deepEqual(g.log, [['member', ANNA]]);
  tree = g.draw();
  assert.equal(find(tree, n => n.props && n.props.role === 'dialog').length, 0, 'tapping the avatar also selected the row');
  // the row still selects (its button, as Enter/Space would)
  click(pathTo(tree, n => n.type === 'button' && words(n).includes('Anna')));
  tree = g.draw();
  const dlg = find(tree, n => n.props && n.props.role === 'dialog');
  assert.equal(dlg.length, 1, 'the row no longer selects when its button is activated');
  // the selected-member panel: its picture is a second tap target for the same person
  g.log.length = 0;
  const panelTap = pathTo(dlg[0], isTap);
  assert.ok(panelTap, 'no tappable avatar in the selected-member panel');
  click(panelTap);
  assert.deepEqual(g.log, [['member', ANNA]]);
});

// ── Serving ──────────────────────────────────────────────────────────────────────────────────────────────────
function servGlobals(React) {
  const Stub = (n) => (p) => React.createElement('i', { 'data-stub': n });
  return {
    React, window: { Fellowship: { myPubkey: ME }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console,
    Icon: iconStub(React), IconBtn: ({ name, onClick }) => React.createElement('button', { title: name, onClick }), UserAvatar: Stub('UserAvatar'), ChurchBadge: Stub('ChurchBadge'),
    Overlay: ({ open, children }) => (open === false ? null : children), BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-26',
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat,
  };
}
test('POINT OF USE, swap picker: a teammate\'s initials open their card and do NOT pick them; a typed-name teammate (no pubkey) has no tap target', () => {
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-serving.jsx', ['SwapSheet'], servGlobals(React));
  const log = [];
  const item = { id: 'i1', date: '2026-12-06', teamName: 'Welcome', role: 'Greeter', teamId: 't1', accent: '#C25A38', service: 'Sunday', time: '10:00' };
  const ctx = { church: { id: CHURCH, name: 'St Bride', npub: CHURCH }, myPubkey: ME, toast() {}, openMember: (pk) => log.push(['member', pk]),
    churchRosters: [{ team: 't1', people: [{ pub: ME, name: 'Me' }, { pub: ANNA, name: 'Anna Smith' }, { pub: '', name: 'Typed Name' }], roles: [] }], churchRotas: [], canDMPeer: () => true };
  const props = { open: true, item, onClose() {}, ctx };
  draw(mod.SwapSheet, props);
  const tree = draw(mod.SwapSheet, props);
  const taps = find(tree, isTap);
  assert.equal(taps.length, 1, 'exactly one tap target: Anna. You and the typed-name teammate have none; got ' + taps.length);
  assert.equal(find(tree, n => n.type === 'button' && find(n, isTap).length).length, 0, 'avatar must not sit inside a <button>');
  click(pathTo(tree, isTap));
  assert.deepEqual(log, [['member', ANNA]]);
});

// ── Care "available to help" row ─────────────────────────────────────────────────────────────────────────────
test('POINT OF USE, care availability row: the letter-circle opens that member\'s card; yours does not', () => {
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-today.jsx', ['CareAvailRow'], careGlobals(React));
  const log = [];
  const ctx = { openMember: (pk) => log.push(['member', pk]), openDM: (pk) => log.push(['dm', pk]), canDMPeer: () => true };
  const row = (pk) => draw(mod.CareAvailRow, { a: { pubkey: pk, tags: [], note: '' }, ctx, myPub: ME });
  const t = row(ANNA);
  assert.equal(find(t, isTap).length, 1);
  click(pathTo(t, isTap));
  assert.deepEqual(log, [['member', ANNA]]);
  assert.equal(find(row(ME), isTap).length, 0, 'your own availability row must not offer a card of yourself');
});
function careGlobals(React) {
  const Stub = (n) => () => React.createElement('i', { 'data-stub': n });
  return {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: iconStub(React),
    ChurchBadge: Stub('ChurchBadge'), SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    lsGet: (k, d) => d, lsSet: () => {}, cx: (...a) => a.filter(Boolean).join(' '),
    useTrinityAudio: () => ({ track: null, playing: false }), todayISO: () => '2026-11-26',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 360, Fellowship: { myPubkey: ME, churchPub: CHURCH, displayFor: (pk) => ({ handle: pk === ANNA ? 'Anna' : 'Me' }) },
      TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } },
  };
}

// ── Serving: the "who is on today" card and the church rota ──────────────────────────────────────────────────
function servingScreen(ctxOver) {
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-serving.jsx', ['ServingScreen'], { ...servGlobals(React), SectionLabel: ({ children }) => React.createElement('h2', {}, children), CareCard: () => null, SafetyBanner: () => null });
  const log = [], toggles = [];
  const ctx = {
    church: { name: 'St Bride' }, myPubkey: ME, openMember: (pk) => log.push(['member', pk]), rotaVis: 'church',
    checkinRegister: { cleared: false, lapsed: false, notYet: false, withdrawn: false, from: null, until: null, lifetime: '', sessions: [], keysHeld: 0, unreadable: 0, foreign: 0, settled: true },
    churchRosters: [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }, { id: 'r2', name: 'Reader' }, { id: 'r3', name: 'Tea' }], people: [] }],
    churchEvents: [], churchServices: [{ id: 's1', name: 'Sunday', date: '2099-01-03', time: '10:00' }],
    churchRotas: [{ service: 's1', published: true, assign: { 't1::r1': { name: 'Anna Smith', pub: ANNA }, 't1::r2': { name: 'Me', pub: ME }, 't1::r3': { name: 'Typed Name', pub: '' } } }],
    churchTeams: [], servPending: [], servConfirmed: [], servDeclined: [], myRsvps: {},
    care: { settings: { enabled: false }, needs: [], slots: [], myPub: ME }, myChildren: { children: [], askAtDesk: 0, settled: true },
    openHelp() {}, toast() {}, respondServing: async () => true, checkinAdd: async () => ({ ok: true }), checkinRelease: async () => ({ ok: true }),
    ...ctxOver,
  };
  const props = { open: true, onClose() {}, ctx };
  draw(mod.ServingScreen, props);
  return { log, ctx, toggles, redraw: () => draw(mod.ServingScreen, props) };
}
test('POINT OF USE, church rota: a teammate\'s initials open their card; yours and a typed name (no pubkey) are not tap targets', () => {
  const s = servingScreen({ servingTab: 'rota' });
  s.redraw();
  const tree = s.redraw();
  assert.ok(words(tree).includes('Anna Smith'), 'the rota did not render - re-anchor this test');
  assert.equal(find(tree, isTap).length, 1, 'exactly one tap target: Anna');
  click(pathTo(tree, isTap));
  assert.deepEqual(s.log, [['member', ANNA]]);
});
test('POINT OF USE, "on the team today" card: the stacked avatars and the list open the card; the toggle button still toggles; your own initials are not a target', () => {
  const s = servingScreen({ servNext: { serviceId: 's1', date: '2099-01-03', time: '10:00', service: 'Sunday', teamName: 'Welcome', role: 'Greeter', accent: '#C25A38', icon: 'hand', teamId: 't1' } });
  s.redraw();
  let tree = s.redraw();
  assert.equal(find(tree, n => n.type === 'button' && find(n, isTap).length).length, 0, 'avatar must not sit inside a <button>');
  const stacked = find(tree, isTap);
  assert.equal(stacked.length, 1, 'stack: only Anna (you and the typed name are not targets)');
  click(pathTo(tree, isTap));
  assert.deepEqual(s.log, [['member', ANNA]]);
  // the toggle: its button still opens the list, and the avatar tap did NOT toggle it
  assert.equal(find(tree, n => n.type === 'span' && words(n).join('') === 'Anna Smith').length, 0, 'tapping the avatar opened the list');
  click(pathTo(tree, n => n.type === 'button' && words(n).join(' ').includes('on the team today')));
  tree = s.redraw();
  assert.ok(words(tree).includes('Anna Smith'), 'the toggle button no longer opens the list');
  s.log.length = 0;
  const taps = find(tree, isTap);
  assert.equal(taps.length, 2, 'stack + list row: Anna twice');
  click(pathTo(tree, n => n === taps[1]));
  assert.deepEqual(s.log, [['member', ANNA]], 'the list row picture did not open the card');
});

// ── no onTap = what shipped at d1599250 (rule 4: compare against the parent, not against itself) ─────────────
const BASE = 'd1599250';
function parentLoad(file, names, globals) {
  const src = execFileSync('git', ['show', BASE + ':' + file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), ['--loader=jsx', '--jsx=transform', '--log-level=error'], { input: src, encoding: 'utf8', maxBuffer: 1 << 26 });
  const keys = Object.keys(globals);
  return new Function(...keys, js + '\nreturn { ' + names.join(', ') + ' };')(...keys.map(k => globals[k]));
}
const haveBase = () => { try { execFileSync('git', ['cat-file', '-e', BASE + ':app/screens-chat.jsx'], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; } };
test('screens-chat Avatar without onTap renders the same tree as at d1599250; with onTap it is a button', (t) => {
  if (!haveBase()) { t.skip('commit ' + BASE + ' is not available here'); return; }
  const { React, draw } = miniReact();
  const g = chatGlobals(React, baseF());
  const OLD = parentLoad('app/screens-chat.jsx', ['Avatar'], g).Avatar;
  const NEW = loadScreen('app/screens-chat.jsx', ['Avatar'], g).Avatar;
  const photo = 'data:image/png;base64,AAAA';
  const cases = [{ handle: 'Anna Smith', color: '#5E8C6A', size: 40 }, { handle: '', color: '#123456' }, { handle: 'Bo', color: 'url(https://evil)', size: 54 },
    { handle: 'Cy', color: '#abc', src: photo, size: 40 }, { handle: 'Cy', src: 'https://evil.example/x.png' }, {}];
  for (const c of cases) assert.equal(JSON.stringify(draw(NEW, c)), JSON.stringify(draw(OLD, c)), 'Avatar output without onTap differs from d1599250 for ' + JSON.stringify(c));
  const tapped = draw(NEW, { ...cases[0], onTap() {} });
  assert.notEqual(JSON.stringify(tapped), JSON.stringify(draw(OLD, cases[0])));
  assert.equal(find(tapped, isTap).length, 1);
});
test('ServAvatar without onTap (and with onTap but me=true) renders the same tree as at d1599250; with onTap it is a button', (t) => {
  if (!haveBase()) { t.skip('commit ' + BASE + ' is not available here'); return; }
  const { React, draw } = miniReact();
  const g = servGlobals(React);
  const OLD = parentLoad('app/screens-serving.jsx', ['ServAvatar'], g).ServAvatar;
  const NEW = loadScreen('app/screens-serving.jsx', ['ServAvatar'], g).ServAvatar;
  const cases = [{ name: 'Anna Smith', size: 28, accent: '#C25A38' }, { name: '', size: 34 }, { name: 'Bo', me: true, size: 30 }, { name: 'Cy', accent: 'url(https://evil)' }];
  for (const c of cases) assert.equal(JSON.stringify(draw(NEW, c)), JSON.stringify(draw(OLD, c)), 'ServAvatar output without onTap differs from d1599250 for ' + JSON.stringify(c));
  assert.equal(JSON.stringify(draw(NEW, { name: 'Bo', me: true, size: 30, onTap() {} })), JSON.stringify(draw(OLD, { name: 'Bo', me: true, size: 30 })), 'your own initials became a button');
  assert.equal(find(draw(NEW, { ...cases[0], onTap() {} }), isTap).length, 1);
});

// ── guards that the rows above do not reach on their own ─────────────────────────────────────────────────────
test('screens-chat Avatar with onTap stops the click, so a row behind it never also fires; Enter and Space activate it', () => {
  const { React, draw } = miniReact();
  const Avatar = loadScreen('app/screens-chat.jsx', ['Avatar'], chatGlobals(React, baseF())).Avatar;
  const taps = [];
  const t = draw(Avatar, { handle: 'Anna', color: '#5E8C6A', size: 40, onTap: () => taps.push('tap') });
  const btn = find(t, isTap)[0];
  assert.ok(btn && btn.props.tabIndex === 0);
  const ev = click(pathTo(t, isTap));
  assert.equal(ev.stopped, true, 'the tap must not reach a row behind it');
  const key = (k) => { const e = { key: k, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} }; btn.props.onKeyDown(e); return e; };
  assert.equal(key('Enter').stopped, true, 'Enter on the avatar must not also fire the row\'s key handler');
  key(' '); key('a');
  assert.equal(taps.length, 3, 'click + Enter + Space activate it, a letter does not');
});
test('rota: your own row is not a tap target even when this phone has no ctx.myPubkey (the engine\'s own key decides)', () => {
  const s = servingScreen({ servingTab: 'rota', myPubkey: undefined });
  s.redraw();
  const tree = s.redraw();
  assert.ok(words(tree).includes('Anna Smith'));
  assert.equal(find(tree, isTap).length, 1, 'your own initials became a tap target when ctx.myPubkey was missing');
});
