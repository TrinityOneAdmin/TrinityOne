// THE MEMBER CARD'S MESSAGE BUTTON IS GATED, AND A SPLIT ROW STILL FIRES ANYWHERE BUT ON THE PICTURE.
//   Run: node --test scripts/member-card-message-gate-and-row-hits.test.mjs
// Mounts the shipped components (app/*.jsx compiled by scripts/render-jsx-screen.mjs, REAL UserAvatar/MemberCard);
// clicks bubble innermost-first and honour stopPropagation. openMember and the <MemberCard> mount are SLICED out of
// app/app.jsx and run (never text-matched for behaviour), so the DM-header -> card wiring is exercised end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  for (let i = path.length - 1; i >= 0 && !ev.stopped; i--) { const h = path[i].props && path[i].props.onClick; if (typeof h === 'function') h(ev); }
  return ev;
}
const isTap = (n) => n.type === 'span' && n.props && n.props.role === 'button' && /^View .*profile$/.test(n.props['aria-label'] || '');
const words = (n, out = []) => { if (n == null || n === false) return out; if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; } if (Array.isArray(n)) { n.forEach(c => words(c, out)); return out; } (n.kids || []).forEach(c => words(c, out)); return out; };
const flush = () => new Promise(r => setTimeout(r, 0));
const hasMessage = (tree) => find(tree, n => n.props && n.props['data-member-message']).length > 0;
const padOf = (tree) => pathTo(tree, n => n.type === 'div' && n.props.style && n.props.style.paddingLeft > 0 && n.props.style.flexShrink === 0 && find(n, isTap).length > 0);

function realAvatar(React) { return loadScreen('app/identity-avatar.jsx', ['UserAvatar'], { React, window: {}, safeImgUrl }).UserAvatar; }
const chatGlobals = (React, F) => ({
  React,
  window: { matchMedia: () => ({ matches: true }), Fellowship: F, addEventListener() {}, removeEventListener() {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] }, TrinityIdentity: { current: { handle: 'me', color: '#123456' } } },
  document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
  location: { search: '', href: 'https://app.trinityone.church/' },
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-26',
  Icon: iconStub(React), IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
  Overlay: ({ open, children }) => (open === false ? null : children), ScreenScroll: ({ children }) => children,
  ChurchPill: () => null, SectionLabel: ({ children }) => children, UserAvatar: realAvatar(React),
  BottomSheet: ({ open, children }) => (open === false ? null : children),
  safeCssColor: (c, f) => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()) ? c.trim() : (f || 'var(--clay)')), safeImgUrl, relTime: () => 'now',
  D: { GROUPS: [], RELAYS: [] },
});
const baseF = (over = {}) => ({ myPubkey: ME, relays: ['wss://relay.example'], requestProfiles() {},
  displayFor: (pk) => ({ handle: pk === ANNA ? 'Anna' : 'Me', name: pk === ANNA ? 'Anna' : 'Me', color: '#5E8C6A', av: { kind: 'monogram', color: '#5E8C6A' } }), ...over });
const mkCtx = (log, extra = {}) => ({
  church: { id: CHURCH, name: 'St Bride', npub: 'npub1church', accent: '#C25A38', initials: 'SB' }, toast() {}, shareText() {}, openShare() {},
  openDM: (pk) => log.push(['dm', pk]), openMember: (pk, o) => log.push(['member', pk, o]), canDMPeer: () => true, myPubkey: ME, minorState: 'adult',
  joinState: { loaded: true, isPending: false, removed: false, offline: false, unknown: false }, myLeaderGroups: [], churchEvents: [],
  safeguard: { isMinor: false, clearanceKnown: true }, openPeople() {}, openDMInbox() {}, openGroup() {}, ...extra });

// ── the real MemberCard, mounted through the REAL <MemberCard> line of app.jsx ───────────────────────────────
function appCard(member, memberInDM, ctx) {
  const APP = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
  const i = APP.indexOf('<MemberCard ');
  assert.ok(i > 0 && APP.indexOf('<MemberCard ', i + 1) === -1, 'the <MemberCard> mount is missing or not unique');
  const js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), ['--loader=jsx', '--jsx=transform', '--log-level=error'],
    { input: 'function Mount() { return (' + APP.slice(i, APP.indexOf('\n', i)) + '); }', encoding: 'utf8' });
  const { React, draw } = miniReact();
  const MemberCard = loadScreen('app/identity-extras.jsx', ['MemberCard'], {
    React, window: { Fellowship: { myPubkey: ME, displayFor: () => ({ handle: 'Anna', av: { kind: 'monogram', color: '#5E8C6A' } }) } }, UserAvatar: realAvatar(React),
    BottomSheet: ({ open, children }) => (open ? children : null), IconBtn: ({ name, onClick }) => React.createElement('button', { onClick }), Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
  }).MemberCard;
  return draw(new Function('React', 'MemberCard', 'member', 'setMember', 'ctx', 'memberInDM', js + '\nreturn Mount;')(React, MemberCard, member, () => {}, ctx, memberInDM), {});
}
// the REAL openMember line of app.jsx: returns what it stored, so the card can be drawn from it
function realOpenMember() {
  const APP = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
  const i = APP.indexOf('openMember: (pk, opts) =>');
  assert.ok(i > 0 && APP.indexOf('openMember: (pk, opts) =>', i + 1) === -1, 'openMember not found exactly once');
  const line = APP.slice(i, APP.indexOf('\n', i)).replace(/,\s*$/, '');
  const st = { member: null, inDM: false };
  const o = new Function('window', 'setMember', 'setMemberInDM', 'return { ' + line + ' };')({ Fellowship: { myPubkey: ME } }, (v) => { st.member = v; }, (v) => { st.inDM = v; });
  return { st, openMember: o.openMember };
}

test('item 1: the card offers Message only to a viewer whose child status is KNOWN and who may DM that person', () => {
  const m = (minorState, canDM) => appCard(ANNA, false, { openDM() {}, canDMPeer: () => canDM, minorState });
  assert.equal(hasMessage(m('maybe', true)), false, 'unknown child status + canDMPeer failing open must NOT show Message');
  assert.equal(hasMessage(m('adult', true)), true);
  assert.equal(hasMessage(m('minor', false)), false);
  assert.equal(hasMessage(m('adult', false)), false);
});
function servingRota(ctxOver) {
  const { React, draw } = miniReact();
  const Stub = (n) => () => React.createElement('i', { 'data-stub': n });
  const g = { React, window: { Fellowship: { myPubkey: ME }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console,
    Icon: iconStub(React), IconBtn: ({ name, onClick }) => React.createElement('button', { title: name, onClick }), UserAvatar: Stub('UserAvatar'), ChurchBadge: Stub('ChurchBadge'),
    Overlay: ({ open, children }) => (open === false ? null : children), BottomSheet: ({ open, children }) => (open ? children : null), safeCssColor: (c) => c, lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-26',
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat,
    SectionLabel: ({ children }) => React.createElement('h2', {}, children), CareCard: () => null, SafetyBanner: () => null };
  const mod = loadScreen('app/screens-serving.jsx', ['ServingScreen', 'SwapSheet'], g);
  const log = [];
  const ctx = { church: { name: 'St Bride', id: CHURCH, npub: CHURCH }, myPubkey: ME, openMember: (pk, o) => log.push(['member', pk]), rotaVis: 'church', toast() {},
    checkinRegister: { cleared: false, lapsed: false, notYet: false, withdrawn: false, from: null, until: null, lifetime: '', sessions: [], keysHeld: 0, unreadable: 0, foreign: 0, settled: true },
    churchRosters: [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }, { id: 'r2', name: 'Reader' }, { id: 'r3', name: 'Tea' }], people: [{ pub: ME, name: 'Me' }, { pub: ANNA, name: 'Anna Smith' }, { pub: '', name: 'Typed Name' }] }],
    churchEvents: [], churchServices: [{ id: 's1', name: 'Sunday', date: '2099-01-03', time: '10:00' }],
    churchRotas: [{ service: 's1', published: true, assign: { 't1::r1': { name: 'Anna Smith', pub: ANNA }, 't1::r2': { name: 'Me', pub: ME }, 't1::r3': { name: 'Typed Name', pub: '' } } }],
    churchTeams: [], servPending: [], servConfirmed: [], servDeclined: [], myRsvps: {}, care: { settings: { enabled: false }, needs: [], slots: [], myPub: ME }, myChildren: { children: [], askAtDesk: 0, settled: true },
    openHelp() {}, respondServing: async () => true, checkinAdd: async () => ({ ok: true }), checkinRelease: async () => ({ ok: true }), ...ctxOver };
  return { React, draw, mod, log, ctx };
}
test('item 1, rota route: opening a teammate from the rota with canDMPeer false gives a card with no Message (true gives one)', () => {
  for (const [canDM, want] of [[false, false], [true, true]]) {
    const s = servingRota({ servingTab: 'rota', canDMPeer: () => canDM, minorState: 'adult', openDM() {} });
    const props = { open: true, onClose() {}, ctx: s.ctx };
    s.draw(s.mod.ServingScreen, props);
    const tree = s.draw(s.mod.ServingScreen, props);
    assert.ok(words(tree).includes('Anna Smith'), 'rota did not render');
    const { st, openMember } = realOpenMember();
    s.ctx.openMember = openMember;
    const tap = pathTo(s.draw(s.mod.ServingScreen, props), n => n.type === 'span' && n.props && n.props.role === 'button' && /View/.test(n.props['aria-label'] || ''));
    assert.ok(tap, 'no avatar tap on the rota (ServAvatar is the real one here)');
    click(tap);
    assert.equal(st.member, ANNA);
    assert.equal(hasMessage(appCard(st.member, st.inDM, s.ctx)), want);
  }
});

// ── item 2: from the DM thread header the card has no Message; from a group bubble it does ───────────────────
function thread(peer, ctx) {
  const { React, draw } = miniReact();
  const F = baseF({ subscribeThread: () => () => {}, outboxForPeer: () => [], onOutbox: () => () => {}, dmPlaintextOf: () => '', reactDM() {}, sendDM: async () => ({}), requeue: () => true, dropQueued() {}, ready: Promise.resolve() });
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread'], chatGlobals(React, F));
  const props = { peer, open: true, onClose() {}, ctx, docked: false };
  draw(mod.DMThread, props);
  return draw(mod.DMThread, props);
}
test('item 2: the card opened from the DM header of THAT person has no Message; the same card from a group bubble has one', () => {
  const log = [];
  const { st, openMember } = realOpenMember();
  const ctx = mkCtx(log, { openMember });
  click(pathTo(thread(ANNA, ctx), isTap));
  assert.deepEqual([st.member, st.inDM], [ANNA, true]);
  assert.equal(hasMessage(appCard(st.member, st.inDM, ctx)), false, 'Message offered inside the thread with the same person');
  // the group-bubble route calls openMember(pk) with no context
  const b = realOpenMember();
  b.openMember(ANNA);
  assert.deepEqual([b.st.member, b.st.inDM], [ANNA, false]);
  assert.equal(hasMessage(appCard(b.st.member, b.st.inDM, ctx)), true);
  // a context naming someone ELSE does not hide it
  const c = realOpenMember(); c.openMember(ANNA, { inDMWith: ME });
  assert.equal(c.st.inDM, false);
});

// ── item 3: the padding around a split-out avatar fires the row; the avatar alone opens the card ─────────────
function community(dm) {
  const { React, draw } = miniReact();
  const F = baseF({ subscribeChurchGroups: (_n, cb) => { cb([]); return () => {}; }, subscribeChurchCategories: (_n, cb) => { cb([]); return () => {}; }, subscribeGroups: () => () => {}, assumeMinor: async () => false });
  const mod = loadScreen('app/screens-chat.jsx', ['ChatScreen'], chatGlobals(React, F));
  const log = []; const ctx = mkCtx(log, { dmThreads: dm });
  draw(mod.ChatScreen, { ctx });
  return { log, tree: draw(mod.ChatScreen, { ctx }) };
}
test('item 3, Messages row: padding around the picture opens the thread; the picture opens the card only; the button fires once', () => {
  const { log, tree } = community([{ peer: ANNA, preview: 'hi', lastTs: 1763000000 }]);
  click(padOf(tree));
  assert.deepEqual(log, [['dm', ANNA]], 'the padding strip did nothing');
  log.length = 0; click(pathTo(tree, isTap));
  assert.deepEqual(log, [['member', ANNA, undefined]]);
  log.length = 0; click(pathTo(tree, n => n.type === 'button' && words(n).includes('Anna')));
  assert.deepEqual(log, [['dm', ANNA]], 'button click must fire the row exactly once (bubbling to the wrapper must not double it)');
  log.length = 0; pathTo(tree, n => n.type === 'button' && words(n).includes('Anna')).at(-1).props.onClick();
  assert.deepEqual(log, [['dm', ANNA]], 'a direct onClick call on the button (no event) must still work');
});
test('item 3, share-to-person row: padding sends; picture opens the card and does not send', async () => {
  const { React, draw } = miniReact();
  const sent = [];
  const F = baseF({ publishMessage: async () => ({}), sendDM: async (pk) => { sent.push(pk); return {}; },
    subscribeChurchGroups: (_c, cb) => { cb([]); return () => {}; }, subscribeChurchMembers: (_c, cb) => { cb([{ pubkey: ME, name: 'Me' }, { pubkey: ANNA, name: 'Anna' }], true); return () => {}; } });
  const mod = loadScreen('app/screens-chat.jsx', ['VerseShareSheet'], chatGlobals(React, F));
  const log = []; const ctx = mkCtx(log);
  const props = { payload: { ref: 'John 3:16', text: 'For God so loved', version: 'BSB' }, open: true, onClose() {}, ctx };
  draw(mod.VerseShareSheet, props); await flush();
  const tree = draw(mod.VerseShareSheet, props);
  click(pathTo(tree, isTap)); await flush();
  assert.deepEqual(sent, []); assert.equal(log.length, 1);
  click(padOf(tree)); await flush();
  assert.deepEqual(sent, [ANNA], 'the padding strip did not send');
});
test('item 3, group-info row: padding selects the row; the picture opens the card and does not select', async () => {
  const { React, draw } = miniReact();
  const rows = [{ pubkey: ME, name: 'Me' }, { pubkey: ANNA, name: 'Anna' }];
  const F = baseF({ subscribeChurchMembers: (_np, cb) => { cb(rows, true); return () => {}; }, assumeMinor: () => Promise.resolve(false) });
  const mod = loadScreen('app/screens-chat.jsx', ['GroupInfo'], chatGlobals(React, F));
  const log = []; const ctx = mkCtx(log);
  const group = { id: 'g1', name: 'Prayer Partners', kind: 'Group', invite: true, encrypted: true, childsafe: true, accent: '#7a5', memberPubs: rows.map(r => r.pubkey), members: 2, openToChurch: false };
  const props = { group, open: true, onClose() {}, ctx };
  draw(mod.GroupInfo, props); await flush();
  let tree = draw(mod.GroupInfo, props);
  find(tree, n => n.type === 'button' && n.props && ('aria-expanded' in n.props))[0].props.onClick();
  tree = draw(mod.GroupInfo, props);
  click(pathTo(tree, isTap));
  assert.equal(find(draw(mod.GroupInfo, props), n => n.props && n.props.role === 'dialog').length, 0, 'the picture selected the row');
  click(padOf(draw(mod.GroupInfo, props)));
  assert.equal(find(draw(mod.GroupInfo, props), n => n.props && n.props.role === 'dialog').length, 1, 'the padding strip did not select the row');
});
test('item 3, swap picker: padding picks; a typed-name teammate\'s picture picks them; Anna\'s picture opens the card and does not pick', () => {
  const s = servingRota({});
  s.ctx.canDMPeer = () => true;
  const item = { id: 'i1', date: '2026-12-06', teamName: 'Welcome', role: 'Greeter', teamId: 't1', accent: '#C25A38', service: 'Sunday', time: '10:00' };
  const props = { open: true, item, onClose() {}, ctx: s.ctx };
  s.draw(s.mod.SwapSheet, props);
  let tree = s.draw(s.mod.SwapSheet, props);
  assert.ok(words(tree).includes('Choose someone'));
  click(pathTo(tree, isTap));
  assert.deepEqual(s.log, [['member', ANNA]]);
  tree = s.draw(s.mod.SwapSheet, props);
  assert.ok(words(tree).includes('Choose someone'), 'the picture also picked the row');
  click(padOf(tree));
  tree = s.draw(s.mod.SwapSheet, props);
  assert.ok(words(tree).includes('Ask Anna to swap'), 'the padding strip did not pick');
  // typed-name teammate: the avatar has no tap target, so clicking it must do the row's action
  const disc = pathTo(tree, n => n.type === 'div' && n.props.style && n.props.style.width === 40 && words(n).join('') === 'TN');
  assert.ok(disc, 'typed-name avatar not found - re-anchor');
  click(disc);
  tree = s.draw(s.mod.SwapSheet, props);
  assert.ok(words(tree).includes('Ask my leader instead'), 'clicking a typed-name teammate\'s picture did not select them');
});
test('item 3, "on the team today": your own picture and the row\'s empty area toggle the list; Anna\'s picture opens the card only', () => {
  const next = { serviceId: 's1', date: '2099-01-03', time: '10:00', service: 'Sunday', teamName: 'Welcome', role: 'Greeter', accent: '#C25A38', icon: 'hand', teamId: 't1' };
  const s = servingRota({ servNext: next });
  const props = { open: true, onClose() {}, ctx: s.ctx };
  s.draw(s.mod.ServingScreen, props);
  const listShown = (t) => words(t).filter(w => w === 'Anna Smith').length > 0;
  let tree = s.draw(s.mod.ServingScreen, props);
  assert.equal(listShown(tree), false);
  click(pathTo(tree, isTap));
  assert.deepEqual(s.log, [['member', ANNA]]);
  assert.equal(listShown(s.draw(s.mod.ServingScreen, props)), false, 'the picture toggled the list');
  const own = pathTo(tree, n => n.type === 'div' && n.props.style && n.props.style.width === 30 && words(n).join('') === 'You');
  assert.ok(own, 'own face not found - re-anchor');
  click(own);
  tree = s.draw(s.mod.ServingScreen, props);
  assert.equal(listShown(tree), true, 'clicking your own picture did not toggle the list');
  const row = pathTo(tree, n => n.type === 'div' && n.props.style && n.props.style.width === '100%' && n.props.style.marginTop === 16 && find(n, x => x.type === 'button').length);
  assert.ok(row, 'row not found - re-anchor');
  click(row);
  assert.equal(listShown(s.draw(s.mod.ServingScreen, props)), false, 'clicking the row\'s empty area did not toggle the list');
  s.log.length = 0;
  click(pathTo(s.draw(s.mod.ServingScreen, props), n => n.type === 'button' && words(n).join(' ').includes('on the team today')));
  assert.equal(listShown(s.draw(s.mod.ServingScreen, props)), true, 'the toggle button fired twice or not at all');
});
