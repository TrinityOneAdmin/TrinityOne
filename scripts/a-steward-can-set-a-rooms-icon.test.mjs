// A STEWARD CAN CHOOSE A CHAT ROOM'S ICON, AND EVERY SCREEN THAT DRAWS THE ROOM SHOWS IT.
//   Run: node --test scripts/a-steward-can-set-a-rooms-icon.test.mjs
//
// Owner decision (task #7): ALL room kinds (group, team, broadcast), ICON ONLY. Storage already existed —
// Steward.publishGroup writes `icon`, subscribeChurchGroups spreads it — but nothing on either surface
// READ it except the console for kind 'team', and nothing let a steward SET it.
//
// What is asserted, each at the point of use (CLAUDE.md rule 1) and none by matching text in app/*.jsx
// (rule 3 — the components are compiled with esbuild and rendered through scripts/render-jsx-screen.mjs):
//   - the allowlist validator (app/icons.jsx, compiled and run): an allowlisted name passes, anything else
//     (unknown, a non-string, a prototype key, markup) is refused;
//   - EVERY allowlisted name is a real icon in Icon (otherwise a picker button would draw nothing);
//   - console: the group list (DashGroups items), the room's settings sheet header, the new-post target
//     chips and the group-chat header all draw a set icon, for every kind, and fall back to the kind's
//     default for an absent or unknown one;
//   - console picker: the settings sheet carries the picker, and picking publishes the WHOLE raw document
//     with only `icon` changed;
//   - member: the Community list draws a set icon for every kind and falls back per kind otherwise; a
//     forged/unknown icon in a church-signed document is not drawn.
// The validator is shared by both surfaces (both pages load app/icons.jsx) so there is one allowlist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, loadScreen, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const esm = (file) => execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [file, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
const plain = (rel) => execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [join(ROOT, rel), '--jsx=transform', '--log-level=error'], { encoding: 'utf8' });

// ── the REAL shared icons file, run ──────────────────────────────────────────────────────────────────────
function realIcons() {
  const win = {};
  const React = { createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }) };
  new Function('React', 'window', plain('app/icons.jsx'))(React, win);
  return win;
}
const ICONS = realIcons();

test('the allowlist: a listed name passes, everything else is refused', () => {
  assert.equal(ICONS.roomIconOk('heart'), 'heart');
  for (const bad of ['', 'nope', undefined, null, 7, {}, [], '__proto__', 'constructor', 'toString', '<img onerror=x>', 'Heart', 'heart '])
    assert.equal(ICONS.roomIconOk(bad), '', 'accepted ' + JSON.stringify(bad));
  assert.ok(ICONS.ROOM_ICONS.length >= 12, 'the allowlist shrank below a useful picker');
});

test('every allowlisted icon is a real icon (a picker button must draw something)', () => {
  const draw = (name) => JSON.stringify(ICONS.Icon({ name }));
  const blank = draw('definitely-not-an-icon');
  for (const n of ICONS.ROOM_ICONS) assert.notEqual(draw(n), blank, n + ' is allowlisted but Icon draws nothing for it');
});

test('every icon a team preset already publishes is allowlisted, so no existing team loses its icon', () => {
  const win = {};
  const presets = (() => {
    const js = plain('app/stew-data.jsx');
    try { new Function('React', 'window', 'document', 'localStorage', js)({ createElement() {} }, win, {}, { getItem: () => null, setItem() {} }); } catch (e) { /* fall through: assert below */ }
    return win.TEAM_PRESETS || [];
  })();
  assert.ok(presets.length, 'could not load the team presets - re-anchor');
  for (const p of presets) assert.equal(ICONS.roomIconOk(p.icon), p.icon, 'preset ' + p.name + ' uses ' + p.icon);
});

// ── console ──────────────────────────────────────────────────────────────────────────────────────────────
async function compileConsole(names, globals, tail) {
  const src = ['groupIcon', 'GroupIconPicker'].map(n => fnBody(STEW, 'function ' + n + '(', n)).join('\n') + '\n' + names.map(([n, a]) => fnBody(STEW, a, n)).join('\n') + (tail || '');
  const tmp = join(tmpdir(), 'roomicon-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try { writeFileSync(tmp, src + `\nexport { ${names.map(n => n[0]).concat(['GroupIconPicker', 'groupIcon']).join(', ')} };\n`); js = esm(tmp); } finally { rmSync(tmp, { force: true }); }
  const key = '__roomicon_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
}
const IconEl = function Icon() { return null; };
const iconNames = (tree) => find(tree, n => n.type === IconEl).map(n => n.props.name);
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

const ROOMS = [
  { id: 'g-plain', name: 'Plain', kind: 'group' },
  { id: 'g-set', name: 'Set', kind: 'group', icon: 'heart' },
  { id: 'g-bad', name: 'Bad', kind: 'group', icon: 'bogus' },
  { id: 't-plain', name: 'TPlain', kind: 'team' },
  { id: 't-set', name: 'TSet', kind: 'team', icon: 'music' },
  { id: 'b-plain', name: 'BPlain', kind: 'broadcast' },
  { id: 'b-set', name: 'BSet', kind: 'broadcast', icon: 'bell' },
  { id: 'b-bad', name: 'BBad', kind: 'broadcast', icon: '<x>' },
];
const WANT = { 'g-plain': 'chat', 'g-set': 'heart', 'g-bad': 'chat', 't-plain': 'shield', 't-set': 'music', 'b-plain': 'send', 'b-set': 'bell', 'b-bad': 'send' };

async function groupsTab(rooms = ROOMS) {
  const { React, draw } = miniReact();
  const published = [];
  let captured = null;
  const win = {
    ...ICONS,
    Steward: { publishGroup: (g) => { published.push(g); return Promise.resolve({ ...g, ts: 1 }); }, joinPolicyFresh: () => false, listIsFresh: () => true },
    useStewardGroups: () => rooms, useStewardRosters: () => [], useStewardMembers: () => [],
    Capacitor: { isNativePlatform: () => true },   // the settings sheet is the steward APP's surface (the web console uses inline row controls)
    useStewardCategories: () => [], dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  const stewKeys = ['stewKeyRecipients', 'stewKeyRecipientsOrAdmitted', 'useStewKeyRecipients'].map(n => fnBody(STEW, 'function ' + n + '(', n)).join('\n') + '\n' + STEW.match(/^const STEW_KEYS_LOADING = .*;$/m)[0];
  const mod = await compileConsole([['DashGroups', 'function DashGroups()'], ['groupLiveSub', 'function groupLiveSub(']], {
    React, window: win, CustomEvent, setTimeout, clearTimeout,
    location: { search: '', hostname: 'x' }, document: { addEventListener() {}, removeEventListener() {} },
    ListPanel: function ListPanel(p) { captured = p; return null; },
    Icon: IconEl, SkPill: Stub('SkPill'), SkConfirm: Stub('SkConfirm'), NewGroupModal: Stub('NewGroupModal'), CategoriesModal: Stub('CategoriesModal'),
    GroupChatModal: Stub('GroupChatModal'), GroupLeadersModal: Stub('GroupLeadersModal'), EditGroupMembersModal: Stub('EditGroupMembersModal'),
    KeyDistributor: Stub('KeyDistributor'), useRealMemberCount: () => 5, useStewDialog: () => ({}),
  }, '\n' + stewKeys);
  let tree = draw(mod.DashGroups, {});
  assert.ok(captured && Array.isArray(captured.items), 'DashGroups no longer renders its rows through ListPanel - re-anchor');
  return { mod, captured: () => captured, published, redraw: () => (tree = draw(mod.DashGroups, {})) };
}

test('console group list: a set icon is drawn for EVERY kind; absent or unknown falls back per kind', async () => {
  const g = await groupsTab();
  const got = Object.fromEntries(g.captured().items.map(i => [i.id, i.ic]));
  assert.deepEqual(got, WANT);
});

function openSettings(g, id) {
  const it = g.captured().items.find(i => i.id === id);
  const btn = find(g.captured().renderInline(it), n => n.type === 'button' && /^Settings for /.test(String((n.props || {})['aria-label'] || '')));
  assert.equal(btn.length, 1, 'the row has no Settings control - re-anchor');
  btn[0].props.onClick();
  return g.redraw();
}

test('console settings sheet: carries the picker, and its header honours a set icon on every kind', async () => {
  for (const id of ['g-set', 't-set', 'b-set', 'g-bad', 'b-plain']) {
    const g = await groupsTab();
    const tree = openSettings(g, id);
    assert.equal(find(tree, n => n.type === g.mod.GroupIconPicker).length, 1, 'the settings sheet for ' + id + ' carries no icon picker');
    // the header's icon is the one drawn at size 20 (the picker's own buttons draw EVERY allowlisted icon at 16,
    // so a bare "the tree contains it" check would pass whatever the header drew)
    const head = find(tree, n => n.type === IconEl && n.props.size === 20).map(n => n.props.name);
    assert.deepEqual(head, [WANT[id]], id + ': the sheet header drew ' + head);
  }
});

test('console picker, driven from the sheet: picking publishes the WHOLE raw document with only the icon changed', async () => {
  for (const id of ['g-plain', 't-set', 'b-plain']) {
    const g = await groupsTab();
    const picker = find(openSettings(g, id), n => n.type === g.mod.GroupIconPicker)[0];
    picker.props.onPick('flame');
    assert.equal(g.published.length, 1, 'picking an icon published nothing');
    const raw = ROOMS.find(r => r.id === id);
    assert.deepEqual(g.published[0], { ...raw, icon: 'flame' }, 'what was published was not the raw document + icon (display fields must not leak)');
    assert.deepEqual(find(g.redraw(), n => n.type === IconEl && n.props.size === 20).map(n => n.props.name), ['flame'], 'the sheet header does not show the new choice');
  }
});

test('the picker itself: one button per allowlisted icon, the current one pressed, a press reports its name', async () => {
  const g = await groupsTab();
  const { draw } = miniReact();
  const picked = [];
  const tree = draw(g.mod.GroupIconPicker, { group: { kind: 'broadcast', icon: 'bell' }, onPick: (n) => picked.push(n) });
  const btns = find(tree, n => n.type === 'button');
  assert.equal(btns.length, ICONS.ROOM_ICONS.length);
  assert.deepEqual(btns.filter(b => b.props['aria-pressed']).map(b => b.props['aria-label']), ['Icon bell']);
  btns.find(b => b.props['aria-label'] === 'Icon gift').props.onClick();
  assert.deepEqual(picked, ['gift']);
});

async function modal(name, anchor, rooms, props) {
  const { React, draw } = miniReact();
  const win = { ...ICONS, useStewardGroups: () => rooms, Steward: new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : (...a) => { const cb = a.find(x => typeof x === 'function'); if (cb && /^subscribe/.test(String(k))) { try { cb([]); } catch (e) { /* ignore */ } } return () => {}; }) }), addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true };
  const mod = await compileConsole([[name, anchor]], { React, window: win, Icon: IconEl, useStewDialog: () => ({ current: null }), setTimeout, clearTimeout, document: { addEventListener() {}, removeEventListener() {} }, location: { search: '' } });
  return draw(mod[name], props);
}

test('console new-post target chips: every kind honours a set icon', async () => {
  const tree = await modal('NewPostModal', 'function NewPostModal({ onClose }) {', ROOMS, { onClose() {} });
  const names = iconNames(tree);
  for (const r of ROOMS) assert.ok(names.includes(WANT[r.id]), r.id + ' chip does not draw ' + WANT[r.id]);
  assert.equal(names.filter(n => n === 'heart').length, 1);
  assert.equal(names.filter(n => n === 'bell').length, 1);
});

test('console group-chat header: every kind honours a set icon', async () => {
  for (const id of ['g-set', 't-set', 'b-set', 'g-bad', 'b-plain']) {
    const tree = await modal('GroupChatModal', 'function GroupChatModal({ group, onClose }) {', [], { group: ROOMS.find(r => r.id === id), onClose() {} });
    assert.ok(iconNames(tree).includes(WANT[id]), id + ' chat header does not draw ' + WANT[id] + ' - drew ' + iconNames(tree).slice(0, 4));
  }
});

// ── member app ───────────────────────────────────────────────────────────────────────────────────────────
const iconStub = (React) => ({ name }) => React.createElement('i', { 'data-icon': name });
function communityList(rooms) {
  const { React, draw } = miniReact();
  const win = {
    ...ICONS,
    Fellowship: { myPubkey: 'mehex', relays: ['wss://relay.example'], subscribeChurchGroups: (_n, cb) => { cb(rooms); return () => {}; }, subscribeChurchCategories: (_n, cb) => { cb([]); return () => {}; }, subscribeGroups: () => () => {}, displayFor: () => ({ handle: 'sam', color: '#888' }), assumeMinor: async () => false },
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
    TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
    addEventListener: () => {}, removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatScreen'], {
    React, window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-09-01',
    Icon: iconStub(React),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ open, children }) => (open ? children : null), ScreenScroll: ({ children }) => children,
    ChurchPill: () => null, UserAvatar: () => null, SectionLabel: ({ children }) => children, BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = { toast: () => {}, church: { npub: 'npub1church', name: 'St Aidan’s', id: 'c1' }, joinState: { loaded: true, isPending: false, removed: false, offline: false, unknown: false }, myLeaderGroups: [], churchEvents: [], myPubkey: 'mehex', safeguard: { isMinor: false, clearanceKnown: true }, openPeople: () => {}, openDM: () => {}, openDMInbox: () => {}, openGroup: () => {} };
  draw(mod.ChatScreen, { ctx });
  return draw(mod.ChatScreen, { ctx });
}
const rowIcons = (tree, name) => {
  const rows = find(tree, n => n.props && n.props.role === 'button' && n.props.onClick && texts(n).some(t => t === name));
  assert.equal(rows.length, 1, 'expected exactly one row for ' + name);
  return find(rows[0], n => n.type === 'i' && n.props['data-icon']).map(n => n.props['data-icon']);
};
const MEMBER_ROOMS = ROOMS.map(r => ({ ...r, visibility: 'open', childsafe: true, sub: 's' }));

test('member Community list: a set icon is drawn for every kind; absent or unknown falls back per kind', () => {
  const tree = communityList(MEMBER_ROOMS);
  for (const r of ROOMS) {
    const icons = rowIcons(tree, r.name);
    assert.ok(icons.includes(WANT[r.id]), r.id + ' (' + r.name + ') drew ' + icons + ', wanted ' + WANT[r.id]);
  }
});

test('member Community list: an icon the church document carries but the allowlist does not is NOT drawn', () => {
  const icons = rowIcons(communityList(MEMBER_ROOMS), 'Bad');
  assert.ok(!icons.includes('bogus'));
});
