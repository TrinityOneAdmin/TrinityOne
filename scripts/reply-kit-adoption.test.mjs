// THE SHARED REPLY PIECES (app/reply-kit.jsx) ARE WHAT THE THREE CHAT SURFACES ACTUALLY USE.
// Run: node --test scripts/reply-kit-adoption.test.mjs
//
// Point-of-use (CLAUDE.md rule 1/3): the real Row and DMSwipe are loaded from app/screens-chat.jsx through the
// mini React with the REAL kit injected by loadScreen, and RENDERED; the tests drive the touch handlers a finger
// would and read the tree. The console DM window's equivalent is in reply-affordances-on-console-dm.test.mjs.
//
// Users of the kit (rule 2): Row (group rooms) · DMSwipe + DMThread (member DM) · ChatRoom's reply bar ·
// StewDmWindow (console DM). Care chats and the console GROUP chat are not adopters yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });

function screens() {
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-chat.jsx', ['Row', 'DMSwipe'], {
    React,
    window: { Fellowship: { displayFor: (pk) => ({ handle: pk === 'pk-bob' ? 'Bob' : 'Sam' }) }, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    UserAvatar: () => null, avOf: () => ({}),
  });
  return { mod, draw };
}
const swiper = (tree) => find(tree, n => n.type === 'div' && n.props && typeof n.props.onTouchStart === 'function')[0];
const cues = (tree) => find(tree, n => n.props && n.props['data-reply-cue']);
const body = { type: 'p', props: {}, kids: ['hello'] };

// ── Row (group rooms) ─────────────────────────────────────────────────────────────────────────────────────

test('Row: dragging right shows the arrow and moves the row; touch-action is pan-y; lifting past the arm replies', () => {
  const { mod, draw } = screens();
  let replied = 0;
  const props = { me: false, m: { pubkey: 'pk-bob', handle: 'Bob', when: 'now' }, ctx: {}, mod: { onReply: () => { replied++; } }, children: body };
  let t = draw(mod.Row, props);
  assert.equal(cues(t).length, 0);
  const s = swiper(t);
  assert.equal(s.props.style.touchAction, 'pan-y', 'Row lost touch-action: pan-y');
  s.props.onTouchStart(touch(100, 300));
  s.props.onTouchMove(touch(130, 301));
  t = draw(mod.Row, props);
  assert.equal(cues(t).length, 1, 'no reply arrow while dragging a group message');
  assert.match(swiper(t).props.style.translate, /^30px\b/, 'the row follows the finger via the `translate` property');
  assert.ok(!swiper(t).props.style.transform, 'the slide must NOT use `transform` — the trinityFade mount animation (to{transform:none}, fill both) overrides it, so the message never slid (bug 2026-10-15)');
  // lift past the arm with NO redraw between move and lift
  const s2 = swiper(t);
  s2.props.onTouchMove(touch(170, 302));
  s2.props.onTouchEnd();
  assert.equal(replied, 1, 'a swipe past the arm did not reply in a group room');
  assert.equal(cues(draw(mod.Row, props)).length, 0, 'the arrow stayed after the reply');
});

test('Row: a short drag, and a Row with no onReply, do nothing', () => {
  const { mod, draw } = screens();
  let replied = 0;
  let props = { me: true, m: { pubkey: 'pk-me', when: 'now' }, ctx: {}, mod: { onReply: () => { replied++; } }, children: body };
  let s = swiper(draw(mod.Row, props));
  s.props.onTouchStart(touch(100, 300)); s.props.onTouchMove(touch(120, 300)); s.props.onTouchEnd();
  assert.equal(replied, 0);
  props = { ...props, mod: {} };
  s = swiper(draw(mod.Row, props));
  s.props.onTouchStart(touch(100, 300)); s.props.onTouchMove(touch(190, 300));
  assert.equal(cues(draw(mod.Row, props)).length, 0, 'a message that cannot be answered still draws a reply arrow');
});

test('Row: a reply shows the quoted message (who + words), or "an earlier message" when it is not loaded', () => {
  const { mod, draw } = screens();
  const parent = { pubkey: 'pk-bob', text: 'Anyone free Sunday?' };
  const withParent = draw(mod.Row, { me: false, m: { pubkey: 'pk-sam', when: 'now', replyTo: 'p1' }, ctx: {}, mod: { replyParent: parent }, children: body });
  const said = texts(withParent).join(' | ');
  assert.match(said, /Bob/); assert.match(said, /Anyone free Sunday\?/);
  const orphan = draw(mod.Row, { me: false, m: { pubkey: 'pk-sam', when: 'now', replyTo: 'gone' }, ctx: {}, mod: {}, children: body });
  assert.match(texts(orphan).join(' | '), /replying to an earlier message/);
  const plain = draw(mod.Row, { me: false, m: { pubkey: 'pk-sam', when: 'now' }, ctx: {}, mod: {}, children: body });
  assert.doesNotMatch(texts(plain).join(' | '), /replying to|Anyone free/);
});

// ── DMSwipe (member private chat) ─────────────────────────────────────────────────────────────────────────

test('DMSwipe: the same arrow, pan-y and reply-past-the-arm as Row — and a cancel past the arm still replies', () => {
  const { mod, draw } = screens();
  let replied = 0;
  const props = { mine: false, onReply: () => { replied++; }, menuOpen: false, onOpenMenu() {}, children: body };
  let t = draw(mod.DMSwipe, props);
  const s = swiper(t);
  assert.equal(s.props.style.touchAction, 'pan-y');
  s.props.onTouchStart(touch(10, 10)); s.props.onTouchMove(touch(40, 11));
  t = draw(mod.DMSwipe, props);
  assert.equal(cues(t).length, 1, 'no reply arrow while dragging a private message');
  const s2 = swiper(t);
  s2.props.onTouchMove(touch(80, 12));
  s2.props.onTouchCancel();
  assert.equal(replied, 1, 'touchcancel past the arm lost the reply');
});

// ── the kit is actually loaded where it is used ───────────────────────────────────────────────────────────

test('index.html and steward.html load the kit BEFORE the file that uses it', () => {
  const order = (html, a, b) => { const i = html.indexOf('src="app/' + a + '"'), j = html.indexOf('src="app/' + b + '"'); assert.ok(i > -1 && j > -1, a + ' / ' + b + ' not both loaded'); return i < j; };
  assert.ok(order(readFileSync(ROOT + 'index.html', 'utf8'), 'reply-kit.jsx', 'screens-chat.jsx'), 'member app: kit loads after screens-chat');
  assert.ok(order(readFileSync(ROOT + 'steward.html', 'utf8'), 'reply-kit.jsx', 'stew-dashboard.jsx'), 'console: kit loads after stew-dashboard');
  // sync-web strips stew-* from the member build, so the kit must not carry that prefix
  assert.ok(!/^stew-/.test('reply-kit.jsx'));
});
