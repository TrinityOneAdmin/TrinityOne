// MEMBER APP: TAPPING THE PINNED BANNER SCROLLS TO THE PINNED MESSAGE. Run:
//   node --test scripts/a-pinned-banner-scrolls-to-the-message-member.test.mjs
//
// Point of use (CLAUDE.md rules 1, 3): the real Bubble/Row and the real ChatRoom are compiled from
// app/screens-chat.jsx and RENDERED; assertions read the drawn tree. scrollIntoView can't run in the fake DOM,
// so this asserts the WIRING: each message Row carries data-msg-id; Row applies a flash style when flash is set;
// the pinned banner body is a tappable control with an onClick; the Unpin X stops propagation.
//
// What was touched (rule 2): app/screens-chat.jsx —
//   - Row's outer div gains data-msg-id={m.id} and a brief gold flash when M.flash;
//   - Bubble threads a `flash` prop into `mod` (one consumer: Row);
//   - ChatRoom gains flashMsgId state + scrollToPinned (querySelects the row in the scroll container and
//     scrollIntoViews it); passes flash={flashMsgId===m.id} to each Bubble; the pinned banner body is a
//     role="button" onClick={scrollToPinned}; the Unpin button's onClick now stopPropagation()s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ESBUILD = join(ROOT, 'node_modules/.bin/esbuild');
const CHAT_SRC = readFileSync(join(ROOT, 'app/screens-chat.jsx'), 'utf8');

// Compile a given SOURCE string (default = the real file) the way loadScreen does, and hand back named
// components. A sabotage passes a modified copy. Classic-script file → one new Function with a param per global.
function compileFrom(exportNames, globals, src = CHAT_SRC) {
  const names = Object.keys(globals);
  const tmp = join(tmpdir(), 'pin-chat-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try { writeFileSync(tmp, src); js = execFileSync(ESBUILD, [tmp, '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 }); }
  finally { rmSync(tmp, { force: true }); }
  if (!names.includes('TrinityReplyKit') && js.includes('TrinityReplyKit')) {
    js = execFileSync(ESBUILD, [join(ROOT, 'app/reply-kit.jsx'), '--jsx=transform', '--log-level=error'], { encoding: 'utf8' }) + '\n' + js;
  }
  return new Function(...names, js + '\nreturn { ' + exportNames.join(', ') + ' };')(...names.map(k => globals[k]));
}

// ── Row / Bubble: the per-message DOM handle + the flash style ────────────────────────────────────────────
const CHURCH_PROFILE = { npub: 'npub1church', name: 'Grace', features: {} };
const bubbleGlobals = (React) => ({
  React,
  window: { Fellowship: { myPubkey: 'mehex', displayFor: () => ({ handle: 'Ruth' }) }, addEventListener() {}, removeEventListener() {} },
  Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
  UserAvatar: () => null,
  safeCssColor: (c, f) => (typeof c === 'string' && (/^#[0-9a-fA-F]{3,8}$/.test(c.trim()) || /^var\(--[\w-]+\)$/.test(c.trim())) ? c.trim() : (f || 'var(--clay)')),
  safeImgUrl: (v) => { const s = typeof v === 'string' ? v.trim() : ''; return /^data:image\/[a-zA-Z0-9.+-]+;/.test(s) ? s : ''; },
  setTimeout: () => 0, clearTimeout: () => {},
});
const CTX = { church: CHURCH_PROFILE, shareText() {} };
const MSG = { id: 'm1', text: 'Can someone bring chairs?', pubkey: 'ruthhex' };
const rowFor = (tree, id) => find(tree, n => n.props && n.props['data-msg-id'] === id)[0];

function drawBubble(flash, src) {
  const { React, draw } = miniReact();
  const mod = compileFrom(['Bubble', 'evtToMsg', 'shareTextOf', 'searchableText'], bubbleGlobals(React), src);
  return draw(mod.Bubble, { m: MSG, ctx: CTX, summary: [], live: false, flash });
}

test('a message Row carries data-msg-id equal to its id', () => {
  const row = rowFor(drawBubble(false), 'm1');
  assert.ok(row, 'the message Row has no data-msg-id handle');
});

test('Row applies a flash style only when flash is set', () => {
  assert.ok(!(rowFor(drawBubble(false), 'm1').props.style || {}).outline, 'the Row is flashed when it should not be');
  const flashed = rowFor(drawBubble(true), 'm1');
  assert.match(String((flashed.props.style || {}).outline || ''), /gold/, 'the Row shows no flash outline when flash is set');
});

test('SABOTAGE (member row): removing data-msg-id drops the handle from the Row', () => {
  const sab = CHAT_SRC.replace('<div {...sw.handlers} data-msg-id={m.id} onContextMenu=', '<div {...sw.handlers} onContextMenu=');
  assert.notEqual(sab, CHAT_SRC, 'the Row data-msg-id anchor did not match — re-scope');
  assert.ok(!rowFor(drawBubble(false, sab), 'm1'), 'the Row still had a data-msg-id with the handle removed — not pinned to it');
});

// ── ChatRoom: the pinned banner tap + the Unpin stopPropagation ───────────────────────────────────────────
function chatRoomGlobals(React) {
  let pinCb = null, groupAdd = null;
  const F = {
    myPubkey: 'mehex', ready: Promise.resolve(), churchPub: null, churchNpub: 'npub1church', requestProfiles() {},
    subscribeGroup: (_g, add) => { groupAdd = add; return () => {}; },
    subscribeReactions: () => () => {}, subscribeHidden: () => () => {},
    subscribeGroupPin: (_g, cb) => { pinCb = cb; cb({ msgId: 'm1', text: 'Can someone bring chairs?', by: 'ruthhex', ts: 1 }); return () => {}; },
    onOutbox: () => () => {}, outboxFor: () => [], relayReady: () => true, groupEncState: () => 'clear',
    canPostHere: () => true, pinPost: () => Promise.resolve({ ok: true }), unpin: () => Promise.resolve(true),
  };
  const g = {
    React,
    window: { Fellowship: F, TrinityData: { GROUP_MESSAGES: {} }, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-10-02',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ children }) => children, ScreenScroll: ({ children }) => children,
    ChurchPill: () => null, UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
    Bubble: ({ m }) => React.createElement('div', { 'data-bubble': m.id }, m.text || ''),
    canModerateGroup: () => true,
  };
  return g;
}
const CR_CTX = { connTick: 0, church: CHURCH_PROFILE, me: { pubkey: 'mehex' }, canPostHere: true, myLeaderGroups: [{ id: 'g1' }], toast: () => {} };
const CR_PROPS = { group: { id: 'g1', name: 'Prayer', encrypted: false }, ctx: CR_CTX, open: true };
const bannerBtn = (tree) => find(tree, n => n.props && n.props.title === 'Go to the pinned message')[0];
const unpinBtn = (tree) => find(tree, n => n.type === 'button' && n.props && n.props.title === 'Unpin')[0];

function drawChatRoom(src) {
  const { React, draw } = miniReact();
  const mod = compileFrom(['ChatRoom'], chatRoomGlobals(React), src);
  const paint = () => draw(mod.ChatRoom, CR_PROPS);
  paint(); return paint();
}

test('the pinned banner body is a tappable control with an onClick, distinct from the Unpin button', () => {
  const b = bannerBtn(drawChatRoom());
  assert.ok(b, 'the pinned banner body is not tappable (title "Go to the pinned message" missing)');
  assert.equal(typeof b.props.onClick, 'function', 'the pinned banner body has no onClick');
  assert.equal(b.props.role, 'button', 'the pinned banner body is not a button affordance');
  assert.notEqual(b.props.title, 'Unpin', 'the banner body must not be the Unpin button');
});

test('tapping Unpin stops propagation so it unpins without scrolling', () => {
  const x = unpinBtn(drawChatRoom());
  assert.ok(x, 'the Unpin button is missing (needs canModerate)');
  let stopped = 0;
  x.props.onClick({ stopPropagation: () => { stopped++; } });
  assert.equal(stopped, 1, 'the Unpin button does not stop propagation — tapping X would also scroll');
});

test('SABOTAGE (member banner): removing the banner onClick drops the tap handler', () => {
  const sab = CHAT_SRC.replace('onClick={scrollToPinned}', 'data-no-tap="1"');
  assert.notEqual(sab, CHAT_SRC, 'the banner onClick anchor did not match — re-scope');
  const b = bannerBtn(drawChatRoom(sab));
  assert.ok(!b || typeof b.props.onClick !== 'function', 'the banner still had a tap handler with scrollToPinned removed');
});

// ── #6: the pinned banner is operable by KEYBOARD (Enter/Space), not mouse/touch only ───────────────────────
test('the pinned banner body handles Enter/Space (keyboard a11y)', () => {
  const b = bannerBtn(drawChatRoom());
  assert.equal(typeof b.props.onKeyDown, 'function', 'the pinned banner has no onKeyDown — it is not keyboard-operable');
  let prevented = 0;
  b.props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented++; } });
  b.props.onKeyDown({ key: ' ', preventDefault: () => { prevented++; } });
  assert.equal(prevented, 2, 'Enter and Space are not handled by the banner');
  let other = 0;
  b.props.onKeyDown({ key: 'a', preventDefault: () => { other++; } });
  assert.equal(other, 0, 'a non-activation key should be ignored by the banner');
});

test('SABOTAGE (member banner keyboard): removing onKeyDown drops keyboard operation', () => {
  const sab = CHAT_SRC.replace(/onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); scrollToPinned\(\); \} \}\} title="Go to the pinned message"/, 'title="Go to the pinned message"');
  assert.notEqual(sab, CHAT_SRC, 'the banner onKeyDown anchor did not match — re-scope');
  const b = bannerBtn(drawChatRoom(sab));
  assert.ok(!b || typeof b.props.onKeyDown !== 'function', 'the banner still had onKeyDown after removal');
});
