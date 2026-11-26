// A MEMBER'S AVATAR OPENS THEIR CARD; THE CARD SHOWS THEIR NAME AND BIO AND OFFERS A MESSAGE ONLY WHEN ALLOWED.
//   Run: node --test scripts/a-member-card-opens-from-an-avatar.test.mjs
//
// Phase 2 of TrinityOne-internal/PLAN-PROFILE-CARD-2026-11-26.md. Every piece is the SHIPPED component, compiled
// from app/*.jsx and rendered through scripts/render-jsx-screen.mjs; nothing matches source text (rule 3):
//   - MemberCard (app/identity-extras.jsx), real BottomSheet pass-through
//   - UserAvatar (app/identity-avatar.jsx), real
//   - Bubble/Row, DMInbox, PeopleScreen (app/screens-chat.jsx), real, with the REAL UserAvatar inside them
//   - openMember: the real line out of app/app.jsx, sliced and RUN (App itself is not mountable here)
// Click dispatch is simulated to BUBBLE (innermost handler first, stopPropagation honoured), so "the avatar tap
// does not also open the DM" is tested as a browser would behave, not by calling one handler in isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ME = 'a'.repeat(64), ANNA = 'b'.repeat(64), CHURCH = 'c'.repeat(64);
const safeImgUrl = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return /^data:image\/[a-zA-Z0-9.+-]+;/.test(s) ? s : ''; };

const ctors = (React) => ({
  React, window: {}, safeImgUrl,
});
function realAvatar(React) { return loadScreen('app/identity-avatar.jsx', ['UserAvatar'], ctors(React)).UserAvatar; }

// path of nodes from the root down to the first node matching pred (kids only: that is where elements live)
function pathTo(n, pred, acc = []) {
  if (!n || typeof n !== 'object') return null;
  if (Array.isArray(n)) { for (const c of n) { const r = pathTo(c, pred, acc); if (r) return r; } return null; }
  const here = [...acc, n];
  if (pred(n)) return here;
  for (const c of (n.kids || [])) { const r = pathTo(c, pred, here); if (r) return r; }
  return null;
}
// click the node at the end of `path` and bubble to its ancestors until stopPropagation
function click(path) {
  const ev = { stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} };
  for (let i = path.length - 1; i >= 0 && !ev.stopped; i--) {
    const h = path[i].props && path[i].props.onClick;
    if (typeof h === 'function') h(ev);
  }
  return ev;
}
// visible text only (render-jsx-screen's texts() also returns string PROPS such as aria-labels and data-*)
const words = (n, out = []) => { if (n == null || n === false) return out; if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; } if (Array.isArray(n)) { n.forEach(c => words(c, out)); return out; } (n.kids || []).forEach(c => words(c, out)); return out; };
const isTapAvatar = (n) => n.type === 'span' && n.props && n.props.role === 'button' && /^View .*profile$/.test(n.props['aria-label'] || '');

// ── UserAvatar ───────────────────────────────────────────────────────────────────────────────────────────────
test('UserAvatar without onTap renders exactly what it always did; with onTap it is a button that stops the click', () => {
  const { React, draw } = miniReact();
  const UserAvatar = realAvatar(React);
  const av = { kind: 'monogram', color: '#5E8C6A' };
  const plain = draw(UserAvatar, { av, name: 'Anna', size: 44 });
  assert.equal(find(plain, n => n.props && n.props.role === 'button').length, 0, 'an avatar with no onTap must not be a button');
  assert.equal(plain.kids[0].type, 'div', 'no-onTap output is the bare avatar disc');
  assert.deepEqual(words(plain), ['A']);

  const taps = [];
  const t = draw(UserAvatar, { av, name: 'Anna', size: 44, onTap: () => taps.push('tap') });
  const btn = find(t, isTapAvatar);
  assert.equal(btn.length, 1);
  assert.equal(btn[0].props.tabIndex, 0);
  assert.equal(btn[0].props['aria-label'], "View Anna's profile");
  assert.deepEqual(words(t).filter(x => x === 'A'), ['A'], 'the avatar disc is still inside the button');
  const ev = click(pathTo(t, isTapAvatar));
  assert.deepEqual(taps, ['tap']);
  assert.equal(ev.stopped, true, 'the tap must not reach the row behind it');
  // keyboard: Enter and Space activate, other keys do not
  const key = (k) => { const e = { key: k, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} }; btn[0].props.onKeyDown(e); return e; };
  key('Enter'); key(' '); key('a');
  assert.equal(taps.length, 3, 'Enter and Space activate it, a letter does not');
});

// ── MemberCard ───────────────────────────────────────────────────────────────────────────────────────────────
function card({ about = 'Loves the Psalms', canDM = true, handle = 'Anna', pinnedVerse } = {}) {
  const { React, draw } = miniReact();
  const UserAvatar = realAvatar(React);
  const opened = [], closed = [];
  const F = { myPubkey: ME, displayFor: (pk) => (pk === ANNA ? { handle, about, pinnedVerse, av: { kind: 'monogram', color: '#5E8C6A' } } : { handle: 'Other' }) };
  const mod = loadScreen('app/identity-extras.jsx', ['MemberCard'], {
    React, window: { Fellowship: F }, UserAvatar,
    BottomSheet: ({ open, children }) => (open ? children : null),
    IconBtn: ({ name, onClick }) => React.createElement('button', { 'data-icon': name, onClick }),
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
  });
  const ctx = { openDM: (pk) => opened.push(pk), canDMPeer: (pk) => (pk === ANNA ? canDM : true) };
  const tree = draw(mod.MemberCard, { pubkey: ANNA, open: true, onClose: () => closed.push(1), ctx });
  return { tree, opened, closed, draw: (pk) => draw(mod.MemberCard, { pubkey: pk, open: true, onClose() {}, ctx }) };
}
test('MemberCard shows the name and the bio, and nothing about a role', () => {
  const { tree } = card();
  const t = words(tree).join(' | ');
  assert.equal(find(tree, n => n.props && n.props['data-member-name'] === '1').length, 1);
  assert.match(words(find(tree, n => n.props && n.props['data-member-name'] === '1')[0]).join(''), /^Anna$/);
  assert.equal(words(find(tree, n => n.props && n.props['data-member-bio'] === '1')[0]).join(''), 'Loves the Psalms');
  assert.doesNotMatch(t, /steward|role|Recently shared|No bio shared/i);
  // large avatar: the real UserAvatar was drawn at 80 (disc is 80px wide)
  assert.ok(find(tree, n => n.type === 'div' && n.props.style && n.props.style.width === 80).length === 1);
});
test('MemberCard with no bio shows no bio line at all', () => {
  const { tree } = card({ about: '' });
  assert.equal(find(tree, n => n.props && n.props['data-member-bio'] === '1').length, 0);
});
test('MemberCard renders a pinned verse only when the engine supplies one', () => {
  assert.equal(find(card().tree, n => n.props && n.props['data-member-pinned']).length, 0);
  const t = card({ pinnedVerse: { ref: 'John 3:16', text: 'For God so loved', version: 'BSB' } }).tree;
  assert.match(words(find(t, n => n.props && n.props['data-member-pinned'])[0]).join(' '), /For God so loved.*John 3:16/);
});
test('MemberCard offers Message only when canDMPeer says so; tapping it closes the card and opens that DM', () => {
  const yes = card({ canDM: true });
  const b = find(yes.tree, n => n.props && n.props['data-member-message'] === '1');
  assert.equal(b.length, 1);
  assert.match(words(b[0]).join(''), /Message Anna/);
  b[0].props.onClick();
  assert.deepEqual(yes.opened, [ANNA]);
  assert.equal(yes.closed.length, 1);
  assert.equal(find(card({ canDM: false }).tree, n => n.props && n.props['data-member-message']).length, 0);
});
test('MemberCard with no pubkey renders nothing', () => {
  assert.equal(card().draw(null).kids[0], null);
});

// ── the three avatars, in the REAL screens ───────────────────────────────────────────────────────────────────
function chatGlobals(React, F) {
  return {
    React,
    window: { matchMedia: () => ({ matches: true }), Fellowship: F, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-26',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ children }) => children, ScreenScroll: ({ children }) => children,
    ChurchPill: () => null, SectionLabel: ({ children }) => children, UserAvatar: realAvatar(React),
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c, f) => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()) ? c.trim() : (f || 'var(--clay)')), safeImgUrl,
    D: { GROUPS: [], RELAYS: [] },
  };
}
const FS = () => ({
  myPubkey: ME, requestProfiles() {},
  displayFor: (pk) => ({ handle: pk === ANNA ? 'Anna' : 'Me', av: { kind: 'monogram', color: '#5E8C6A' } }),
});
const mkCtx = (log) => ({
  church: { id: CHURCH, name: 'St Bride', accent: '#C25A38', initials: 'SB' }, shareText: (t) => log.push(['share', t]),
  openDM: (pk) => log.push(['dm', pk]), openMember: (pk) => log.push(['member', pk]), canDMPeer: () => true,
});

test('POINT OF USE, chat bubble: tapping a sender avatar opens their card and NOT the DM; your own message has no avatar button', () => {
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-chat.jsx', ['Bubble', 'evtToMsg'], chatGlobals(React, FS()));
  const log = [];
  const evt = (by) => ({ id: 'e' + by[0], pubkey: by, created_at: 1763000000, tags: [['t', 'trinityone'], ['t', 'g1'], ['p', CHURCH]], content: 'hello' });
  const tree = draw(mod.Bubble, { m: mod.evtToMsg(evt(ANNA)), ctx: mkCtx(log), summary: [], live: false });
  const path = pathTo(tree, isTapAvatar);
  assert.ok(path, 'no tappable avatar on another member\'s bubble');
  assert.ok(path.some(n => n.type === 'div' && typeof n.props.onClick === 'function' && /Message/.test(n.props.title || '')), 'the row still has its DM handler (the name opens a DM)');
  click(path);
  assert.deepEqual(log, [['member', ANNA]], 'avatar tap = card only; the DM must not open');
  // the name still opens the DM
  log.length = 0;
  click(pathTo(tree, n => n.type === 'span' && words(n).join('') === 'Anna'));
  assert.deepEqual(log, [['dm', ANNA]]);
  // own message
  const mine = draw(mod.Bubble, { m: { ...mod.evtToMsg(evt(ME)) }, ctx: mkCtx([]), summary: [], live: false });
  assert.equal(find(mine, isTapAvatar).length, 0, 'your own bubble must not offer a card of yourself');
});

test('POINT OF USE, chat bubble: the long-press and swipe touch handlers are ancestors of the avatar, so they still see its touches', () => {
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-chat.jsx', ['Bubble', 'evtToMsg'], chatGlobals(React, FS()));
  const tree = draw(mod.Bubble, { m: mod.evtToMsg({ id: 'x', pubkey: ANNA, created_at: 1763000000, tags: [['t', 'trinityone'], ['t', 'g1'], ['p', CHURCH]], content: 'hi' }), ctx: mkCtx([]), summary: [], live: false });
  const path = pathTo(tree, isTapAvatar);
  assert.ok(path.some(n => n.props && typeof n.props.onTouchStart === 'function'), 'the touch handlers (long-press share, swipe reply) are ancestors of the avatar, so they still see its touches');
});

test('POINT OF USE, DM list: tapping a conversation avatar opens the card, not the thread; the row still opens the thread', () => {
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-chat.jsx', ['DMInbox'], chatGlobals(React, FS()));
  const log = [];
  const ctx = { ...mkCtx(log), dmThreads: [{ peer: ANNA, preview: 'hi', lastTs: 1763000000 }] };
  const tree = draw(mod.DMInbox, { open: true, onClose() {}, ctx });
  const path = pathTo(tree, isTapAvatar);
  assert.ok(path, 'no tappable avatar in the DM list');
  click(path);
  assert.deepEqual(log, [['member', ANNA]]);
  log.length = 0;
  click(pathTo(tree, n => n.type === 'span' && words(n).join('') === 'Anna'));
  assert.deepEqual(log, [['dm', ANNA]]);
});

test('POINT OF USE, people list: avatar opens the card, not the DM; own row has no avatar button; a blocked-DM row still opens the card', () => {
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-chat.jsx', ['PeopleScreen'], chatGlobals(React, FS()));
  const run = (canDM) => {
    const log = [];
    const ctx = { ...mkCtx(log), canDMPeer: () => canDM, churchPeople: [{ pubkey: ME, name: 'Me' }, { pubkey: ANNA, name: 'Anna' }], churchPeopleLoading: false,
      safeguard: {}, church: { id: CHURCH, name: 'St Bride' } };
    const tree = draw(mod.PeopleScreen, { open: true, onClose() {}, ctx });
    return { log, tree };
  };
  const a = run(true);
  const buttons = find(a.tree, isTapAvatar);
  assert.equal(buttons.length, 1, 'exactly one avatar button: Anna. Your own row has none');
  click(pathTo(a.tree, isTapAvatar));
  assert.deepEqual(a.log, [['member', ANNA]]);
  const b = run(false);
  click(pathTo(b.tree, isTapAvatar));
  assert.deepEqual(b.log, [['member', ANNA]], 'a member you may not message still has a card (without a Message button)');
});

// ── openMember in app.jsx ────────────────────────────────────────────────────────────────────────────────────
test('openMember (the real line from app.jsx) stores a pubkey, ignores yourself and junk', () => {
  const APP = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
  const i = APP.indexOf('openMember: (pk) =>');
  assert.ok(i > 0 && APP.indexOf('openMember: (pk) =>', i + 1) === -1, 'openMember definition not found exactly once');
  const line = APP.slice(i, APP.indexOf('\n', i)).replace(/,\s*$/, '');
  const set = [];
  const ctx = new Function('window', 'setMember', 'return { ' + line + ' };')({ Fellowship: { myPubkey: ME } }, (v) => set.push(v));
  ctx.openMember(ANNA); ctx.openMember(ME); ctx.openMember(''); ctx.openMember(undefined); ctx.openMember({ pubkey: ANNA });
  assert.deepEqual(set, [ANNA]);
});

// ── the mount in App (rule 1: delete it from the screen and a test must fail) ───────────────────────────────────
// App itself cannot be mounted here, so the REAL mount line is sliced out of app/app.jsx, compiled, and drawn with
// the real MemberCard. Deleting or mis-wiring that line (wrong prop, no <MemberCard>) fails this.
function appMount(member, setMember, opened) {
  const APP = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
  const i = APP.indexOf('<MemberCard ');
  assert.ok(i > 0 && APP.indexOf('<MemberCard ', i + 1) === -1, 'the <MemberCard> mount in app/app.jsx is missing or not unique');
  const el = APP.slice(i, APP.indexOf('\n', i));
  assert.ok(el.trimEnd().endsWith('/>'), 're-anchor: the mount is no longer a one-line self-closing element');
  const js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), ['--loader=jsx', '--jsx=transform', '--log-level=error'],
    { input: 'function Mount() { return (' + el + '); }', encoding: 'utf8' });
  const { React, draw } = miniReact();
  const UserAvatar = realAvatar(React);
  const F = { myPubkey: ME, displayFor: () => ({ handle: 'Anna', about: 'Loves the Psalms', av: { kind: 'monogram', color: '#5E8C6A' } }) };
  const MemberCard = loadScreen('app/identity-extras.jsx', ['MemberCard'], {
    React, window: { Fellowship: F }, UserAvatar,
    BottomSheet: ({ open, children }) => (open ? children : null),
    IconBtn: ({ name, onClick }) => React.createElement('button', { 'data-icon': name, onClick }),
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
  }).MemberCard;
  const ctx = { openDM: (pk) => opened.push(pk), canDMPeer: () => true };
  const Mount = new Function('React', 'MemberCard', 'member', 'setMember', 'ctx', js + '\nreturn Mount;')(React, MemberCard, member, setMember, ctx);
  return draw(Mount, {});
}
test('App mounts the member card: a pubkey in `member` shows that member, null shows nothing, and closing clears it', () => {
  const opened = [], set = [];
  const open = appMount(ANNA, (v) => set.push(v), opened);
  assert.ok(words(open).includes('Anna') && words(open).includes('Loves the Psalms'), 'App renders no card for a member pubkey');
  assert.equal(find(open, n => n.props && n.props['data-member-card'] === ANNA).length, 1);
  find(open, n => n.props && n.props['data-member-message'])[0].props.onClick();
  assert.deepEqual(opened, [ANNA]);
  assert.deepEqual(set, [null], 'closing the card does not clear `member` in App');
  const none = appMount(null, () => {}, []);
  assert.equal(find(none, n => n.props && n.props['data-member-card']).length, 0, 'a null member still renders a card');
});

// ── no onTap = the PARENT's output (rule 4: compare against what shipped before, not against itself) ────────────
test('UserAvatar without onTap renders the same tree as the parent commit (ebeb664c) for a range of inputs', (t) => {
  let parentSrc;
  try { parentSrc = execFileSync('git', ['show', 'ebeb664c:app/identity-avatar.jsx'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { t.skip('git or commit ebeb664c is not available here; the parent comparison cannot run'); return; }
  const load = (src, React) => {
    const js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), ['--loader=jsx', '--jsx=transform', '--log-level=error'], { input: src, encoding: 'utf8' });
    return new Function('React', 'window', 'safeImgUrl', js + '\nreturn UserAvatar;')(React, {}, safeImgUrl);
  };
  const { React, draw } = miniReact();
  const OLD = load(parentSrc, React);
  const NEW = realAvatar(React);
  const photo = 'data:image/png;base64,AAAA';
  const cases = [
    { av: { kind: 'monogram', color: '#5E8C6A' }, name: 'Anna', size: 44 },
    { av: { kind: 'monogram', color: '#5E8C6A' }, name: '', size: 44 },
    { av: { kind: 'symbol', color: '#123456', symbol: 'dove' }, name: 'Bo', size: 96, ring: true },
    { av: { kind: 'symbol', color: '#123456', symbol: 'nonexistent' }, name: 'Bo', size: 22 },
    { av: { kind: 'photo', photo, color: '#abc' }, name: 'Cy', size: 38 },
    { av: { kind: 'photo', photo: 'https://evil.example/x.png' }, name: 'Cy', size: 38 },
    { av: { kind: 'monogram', color: '#fff),url(https://evil/beacon)' }, name: 'Di', size: 30 },
    { av: undefined, name: undefined },
  ];
  for (const c of cases) {
    assert.equal(JSON.stringify(draw(NEW, c)), JSON.stringify(draw(OLD, c)), 'output without onTap differs from the parent for ' + JSON.stringify(c));
  }
  // the comparison can fail: with onTap the tree must differ from the parent
  assert.notEqual(JSON.stringify(draw(NEW, { ...cases[0], onTap() {} })), JSON.stringify(draw(OLD, cases[0])));
});
