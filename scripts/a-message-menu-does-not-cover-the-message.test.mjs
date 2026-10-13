// THE THREE DOTS ARE ON EVERY ROOM MESSAGE, AND THEIR MENU DOES NOT HIDE THE MESSAGE.
//   Run: node --test scripts/a-message-menu-does-not-cover-the-message.test.mjs
//
// Device report, Oppo, steward app 0.9.72, in a room ("Main chat"), with a screenshot at 411px CSS:
//   "The reply private from the three dots needs to be better placed."
// The menu opened at `top: 18, left: 0` — eighteen pixels DOWN FROM THE TOP OF THE BUBBLE, i.e. straight
// across it — so the words being answered were completely hidden behind the menu card. Somebody choosing
// between Reply and Reply privately needs to see what they are replying to. This repo has already shipped
// this exact mistake once: the Bible highlight action card covered the very verse the reader had selected.
//
// The owner also asked for "three dots on every message", so the gate on the control is checked here too —
// from the point of use, as an ORDINARY MEMBER with no moderation powers and on BOTH authors' messages,
// because that is the state in which a condition like
//   (M.onReply || M.canModerate || M.onDelete || (!me && canDM && ctx && ctx.openDM))
// would hide it. CLAUDE.md rule 3: that condition is not matched as text anywhere below — the room is
// rendered and the tree is read.
//
// WHAT THIS CANNOT PROVE. It reads the declared geometry (`top: 100%`, and which edge the card hangs from),
// not painted pixels: there is no layout engine here. "The bubble is still readable at 411px and 360px" is a
// claim only a device can settle, and nothing here makes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const GROUP = { id: 'g1', name: 'Youth', accent: 'var(--clay)', kind: 'Group' };
const THEIRS = { id: 'm-theirs', pubkey: 'themhex', kind: 1, created_at: 1756500000, tags: [], content: 'Could we talk on Sunday?' };
const MINE = { id: 'm-mine', pubkey: 'mehex', kind: 1, created_at: 1756500100, tags: [], content: 'Yes of course.' };

// A room with one message from each side, and no leadership — a plain member reading a group.
function room({ leader = false, canDM = true } = {}) {
  const { React, draw } = miniReact();
  const Fellowship = {
    myPubkey: 'mehex',
    relays: ['wss://relay.example'],
    relayReady: () => true,
    groupEncState: () => 'clear',
    pinPost: () => Promise.resolve({ ok: true }),
    unpin: () => Promise.resolve({ ok: true }),
    hideMessage: () => Promise.resolve({ ok: true }),
    react: () => {},
    requestProfiles: () => {},
    outboxFor: () => [],
    onOutbox: () => () => {},
    subscribeGroup: (_gid, add) => { add(THEIRS); add(MINE); return () => {}; },
    subscribeReactions: () => () => {},
    subscribeGroupPin: (_gid, cb) => { cb(null); return () => {}; },
    subscribeHidden: (_gid, cb) => { cb(new Set()); return () => {}; },
    subscribeMessageTags: (_np, cb) => { cb([]); return () => {}; },
    displayFor: () => ({ handle: 'sam', color: '#888' }),
    canAddGroupEvent: () => false,
  };
  const win = {
    Fellowship,
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
    TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
    addEventListener: () => {}, removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    confirm: () => true,
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatRoom'], {
    React,
    window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-10-13',
    Icon: () => null,
    IconBtn: ({ name }) => React.createElement('button', { title: name }),
    Overlay: ({ open, children }) => (open ? children : null),
    UserAvatar: () => null, SectionLabel: ({ children }) => children, BottomSheet: ({ children }) => children,
    safeCssColor: (c) => c,
    D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast: () => {},
    church: { npub: 'npub1church', name: 'Trinity LA', id: 'c1' },
    myLeaderGroups: leader ? [{ id: 'g1' }] : [],
    churchEvents: [],
    safeguard: {},
    myPubkey: 'mehex',
    canDMPeer: () => canDM,
    openDM: () => {},
  };
  const render = () => draw(mod.ChatRoom, { group: GROUP, open: true, onClose: () => {}, ctx, docked: true });
  render();                       // first pass: the effects deliver the messages, the pin and the hidden set
  return render;
}

const dots = (tree) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === 'Message actions');
const menuCard = (tree) => find(tree, n => n.type === 'div' && n.props && n.props.style
  && n.props.style.position === 'absolute' && n.props.style.zIndex === 5 && texts(n).join(' ').includes('Reply'));

test('CONTROL: an ordinary member sees both messages in the room', () => {
  const draw = room();
  const words = texts(draw()).join(' | ');
  assert.match(words, /Could we talk on Sunday\?/, 're-anchor: the incoming message is not in the room');
  assert.match(words, /Yes of course\./, 're-anchor: my own message is not in the room');
});

test('EVERY room message carries the three-dots control — for an ordinary member, on both sides', () => {
  const draw = room();                     // not a leader: no pin, no remove
  assert.equal(dots(draw()).length, 2,
    'the three-dots control is hidden on some room messages for a plain member. Found ' + dots(draw()).length + ' for 2.');
});

test('…and it is still on every message when a private reply is not allowed (the safeguarding gate)', () => {
  // canDMPeer false removes the "Reply privately" item. The CONTROL must survive that, because Reply remains.
  const draw = room({ canDM: false });
  assert.equal(dots(draw()).length, 2, 'the safeguarding gate took the whole actions control away, not just one item');
  dots(draw())[0].props.onClick();
  const open = draw();
  assert.equal(find(open, n => n.type === 'button' && texts(n).join(' ').includes('Reply privately')).length, 0,
    're-anchor: Reply privately is offered where the relay would refuse the DM');
  assert.ok(find(open, n => n.type === 'button' && texts(n).join(' ').includes('Reply')).length >= 1,
    'Reply went with it');
});

test('THE ROOM MENU OPENS BELOW THE BUBBLE, NOT ACROSS IT', () => {
  const draw = room();
  dots(draw())[0].props.onClick();
  const card = menuCard(draw());
  assert.equal(card.length, 1, 're-anchor: the open actions menu is not a positioned card any more');
  const s = card[0].props.style;
  assert.equal(s.top, '100%',
    'the menu is laid over the message it acts on, so the words being answered are hidden. top was: ' + JSON.stringify(s.top));
  assert.notEqual(s.top, 18, 'the menu is back at the offset that covered the bubble');
});

test('…anchored to the LEFT edge for someone else’s message and the RIGHT edge for my own', () => {
  const a = room();
  dots(a())[0].props.onClick();
  const theirs = menuCard(a())[0].props.style;
  assert.equal(theirs.left, 0, 'an incoming message opens its menu from the wrong edge');
  assert.equal(theirs.right, undefined);

  const b = room();
  dots(b())[1].props.onClick();
  const own = menuCard(b())[0].props.style;
  assert.equal(own.right, 0,
    'my own message hangs its menu off the LEFT edge of a RIGHT-aligned bubble, which pushes the card '
    + 'toward the screen edge on a narrow phone');
  assert.equal(own.left, undefined);
});

test('the menu is bounded in width, so a long item cannot stretch it off a narrow screen', () => {
  const draw = room();
  dots(draw())[0].props.onClick();
  const s = menuCard(draw())[0].props.style;
  assert.ok(s.maxWidth && s.maxWidth <= 260, 'the actions menu has no width ceiling: maxWidth was ' + s.maxWidth);
  assert.ok(s.minWidth <= s.maxWidth, 'the menu minimum is wider than its maximum');
});

test('a room message swipes to reply, and reads the offset the finger actually reached', () => {
  // The room has had swipe-to-reply since 1408c93 — inside Row, not DMSwipe — and it carried the same
  // stale-offset defect: no redraw between the last move and the lift means onTouchEnd tested an old number.
  const draw = room();
  const s = find(draw(), n => n.type === 'div' && n.props && typeof n.props.onTouchStart === 'function')[0];
  assert.ok(s, 're-anchor: a room message is no longer wrapped in a swipe handler');
  s.props.onTouchStart({ touches: [{ clientX: 100, clientY: 300 }] });
  s.props.onTouchMove({ touches: [{ clientX: 130, clientY: 301 }] });
  s.props.onTouchMove({ touches: [{ clientX: 160, clientY: 302 }] });   // 60px, past the 48px threshold
  s.props.onTouchEnd();                                                  // …with no redraw in between
  const after = texts(draw()).join(' | ');
  assert.match(after, /Replying to/,
    'a swipe in a ROOM did not start a reply. Room read: ' + after);
});

test('…and a short drag in a room does not reply', () => {
  const draw = room();
  const s = find(draw(), n => n.type === 'div' && n.props && typeof n.props.onTouchStart === 'function')[0];
  s.props.onTouchStart({ touches: [{ clientX: 100, clientY: 300 }] });
  s.props.onTouchMove({ touches: [{ clientX: 125, clientY: 301 }] });
  s.props.onTouchEnd();
  assert.doesNotMatch(texts(draw()).join(' | '), /Replying to/, 'a 25px drag in a room started a reply');
});

test('the room swipe declares touch-action: pan-y', () => {
  const draw = room();
  const s = find(draw(), n => n.type === 'div' && n.props && typeof n.props.onTouchStart === 'function')[0];
  assert.equal(s.props.style.touchAction, 'pan-y',
    'without pan-y the compositor may hand the horizontal drag to an ancestor scroller and cancel the touch');
});
