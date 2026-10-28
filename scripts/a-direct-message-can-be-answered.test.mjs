// A MEMBER MUST BE ABLE TO ANSWER A PRIVATE MESSAGE — WITHOUT A GESTURE WORKING.
//   Run: node --test scripts/a-direct-message-can-be-answered.test.mjs
//
// Device report, Oppo, steward app 0.9.72, inside a direct message:
//   "reply is on a swipe, but it doesn't ever engage. I pull to the right, I see the reply icon on the left,
//    but then it hides again after I lift off the swipe… AND we should bring back the three dots on every
//    message. I still cant reply, or reply privately."
//
// Two separate defects, and the second is the one that matters:
//
//  1. THE DM THREAD HAD NO TAPPABLE WAY TO REPLY AT ALL. A group room has carried a three-dots menu since
//     1408c93; the DM path does not use Bubble/Row and never got one, so the ONLY route to a reply was a
//     touch gesture. When that gesture does not fire there is nothing left to press, which is exactly what
//     the member reported. A feature reachable only by a gesture is one operating-system decision away from
//     not existing.
//
//  2. THE SWIPE READ A STALE OFFSET. `onTouchEnd` tested `dx` from React STATE, i.e. whatever the last
//     COMPLETED RENDER captured — not what the finger last did. React schedules a touchmove update on
//     InputContinuousLane (a Scheduler macrotask, not a microtask) and Android coalesces touchmoves to the
//     frame, so the final move of a flick and the touchend that follows it routinely reach the handlers with
//     no render in between. The threshold test then runs against an old number and nothing replies.
//
// HOW THIS PROVES (2) WITHOUT A PHONE. The swipe tests below drive the REAL onTouchStart/onTouchMove/
// onTouchEnd off the rendered tree and deliberately DO NOT redraw between the move and the lift — which is
// precisely the ordering the race produces. The miniature React in render-jsx-screen.mjs writes a setState
// into its store without re-rendering, so a handler closure there is exactly as stale as a real one is in
// that window. A browser test cannot reproduce an Android WebView taking a gesture away mid-drag, and no
// test here claims to: see the touch-action note in the fix.
//
// CLAUDE.md rule 1: every claim below is about the RENDERED tree or a handler that was actually called.
// CLAUDE.md rule 3: nothing here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find, reads } from './render-jsx-screen.mjs';

const PEER = 'b'.repeat(64);
const ME = 'a'.repeat(64);

// Two messages in one conversation: one from the other person, one of mine.
const THEIRS = { id: 'm-theirs', mine: false, pubkey: PEER, ts: 1760000000, content: 'Could we talk on Sunday?' };
const MINE = { id: 'm-mine', mine: true, pubkey: ME, ts: 1760000100, content: 'Yes of course.' };

// The REAL DMThread, with the messages delivered the way the engine delivers them.
function thread() {
  const { React, draw } = miniReact();
  const F = {
    myPubkey: ME,
    relays: ['wss://relay.example'],
    ready: Promise.resolve(),
    subscribeThread: (_peer, add) => { add(THEIRS); add(MINE); return () => {}; },
    outboxForPeer: () => [],
    onOutbox: () => () => {},
    dmPlaintextOf: () => '',
    displayFor: () => ({ handle: 'Sam', av: { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' } }),
    requestProfiles: () => {},
    reactDM: () => {},
    sendDM: async () => ({}),
    requeue: () => true,
    dropQueued: () => {},
  };
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread', 'DMSwipe'], {
    React,
    window: { matchMedia: () => ({ matches: !globalThis.__dmTouch }), Fellowship: F, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-10-13',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ children }) => children, ScreenScroll: ({ children }) => children,
    ChurchPill: () => null, UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = { toast() {}, canDMPeer: () => true, connTick: 0, openDM() {} };
  const props = { peer: PEER, open: true, onClose() {}, ctx, docked: false };
  const redraw = () => draw(mod.DMThread, props);
  redraw();            // the subscription and the outbox read arrive through effects
  return { redraw, mod, React };
}

// The composer only shows "Replying to …" while a message is being answered, so its presence IS the feature.
// `reads` is the harness's faithful read of the copy — children in order, inline pieces joined with NOTHING,
// blocks fenced with a newline. texts().join(' | ') would put a separator inside "Replying to Sam" and make
// every wording assertion below a lie in one direction or the other.
const replying = (tree) => reads(tree);

const dots = (tree) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === 'Message actions');
const swipers = (tree) => find(tree, n => n.type === 'div' && n.props && typeof n.props.onTouchStart === 'function');
const named = (tree, label) => find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));

// ── (a) the tappable route: three dots on every message ───────────────────────────────────────────────────

test('CONTROL: the thread renders both messages, and nothing is being replied to yet', () => {
  const t = thread();
  const words = replying(t.redraw());
  assert.match(words, /Could we talk on Sunday\?/, 're-anchor: the incoming message is not on the thread');
  assert.match(words, /Yes of course\./, 're-anchor: my own message is not on the thread');
  assert.doesNotMatch(words, /Replying to/, 'the reply composer is up before anything asked for it');
});

test('EVERY message in a private thread carries a three-dots control', () => {
  const t = thread();
  const tree = t.redraw();
  assert.equal(dots(tree).length, 2,
    'a private message has no three-dots control, so a member whose swipe does not fire cannot reply at all. '
    + 'Found ' + dots(tree).length + ' for 2 messages.');
});

test('…and pressing it opens a menu whose Reply sets the reply composer (the whole point of use)', () => {
  const t = thread();
  dots(t.redraw())[0].props.onClick();
  const open = t.redraw();
  const reply = named(open, 'Reply');
  assert.equal(reply.length, 1, 'the dots menu does not offer Reply. Menu read: ' + replying(open));
  reply[0].props.onClick();
  const after = replying(t.redraw());
  assert.match(after, /Replying to Sam/, 'Reply did not start a reply to the other person. Screen read: ' + after);
  assert.match(after, /Could we talk on Sunday\?/, 'the reply composer does not quote the message being answered');
});

test('the dots menu on MY OWN message replies to me, and the composer says so rather than naming the peer', () => {
  const t = thread();
  dots(t.redraw())[1].props.onClick();
  const open = t.redraw();
  named(open, 'Reply')[0].props.onClick();
  const after = replying(t.redraw());
  assert.match(after, /Replying to yourself/, 'Screen read: ' + after);
});

test('the menu is closed again once a reply has started — it does not sit over the thread', () => {
  const t = thread();
  dots(t.redraw())[0].props.onClick();
  named(t.redraw(), 'Reply')[0].props.onClick();
  const after = t.redraw();
  assert.equal(named(after, 'Reply').filter(b => b.props.onClick).length, 0,
    'the actions menu stayed open after Reply was pressed');
});

test('a second press on the same control closes the menu (it is a toggle, like the room)', () => {
  const t = thread();
  dots(t.redraw())[0].props.onClick();
  assert.equal(named(t.redraw(), 'Reply').length, 1, 're-anchor: the menu did not open');
  dots(t.redraw())[0].props.onClick();
  assert.equal(named(t.redraw(), 'Reply').length, 0, 'the control does not close the menu it opened');
});

test('"Reply privately" is NOT offered inside a direct message — it would be meaningless there', () => {
  const t = thread();
  dots(t.redraw())[0].props.onClick();
  const open = replying(t.redraw());
  assert.doesNotMatch(open, /Reply privately/, 'a DM offers to reply privately to a conversation that already is. Read: ' + open);
});

test('the control has an accessible name and a tooltip, not a bare icon', () => {
  const t = thread();
  const b = dots(t.redraw())[0];
  assert.equal(b.props.title, 'Message actions', 'the three-dots control has no tooltip');
  assert.equal(b.props['aria-label'], 'Message actions');
  assert.ok(b.props.style && b.props.style.width >= 30 && b.props.style.height >= 30,
    'the touch target is smaller than the room control it mirrors (30x30)');
});

// The actions menu is the only absolutely-positioned column in the open bubble, and it is the node that holds
// the Reply button — so find it by walking up from nothing: it is the positioned box whose text has Reply.
const menuCard = (tree) => find(tree, n => n.type === 'div' && n.props && n.props.style
  && n.props.style.position === 'absolute' && n.props.style.zIndex === 5 && texts(n).join(' ').includes('Reply'));

test('THE ACTIONS MENU DOES NOT COVER THE MESSAGE IT ACTS ON — it drops from the ⋯ button', () => {
  // a98b37ae re-anchored this: the menu drops FROM the ⋯ button (top:24, just under it) rather than being laid
  // over the bubble body, so the member can still read the message they are deciding whether to answer.
  const t = thread();
  dots(t.redraw())[0].props.onClick();
  const card = menuCard(t.redraw());
  assert.equal(card.length, 1, 're-anchor: the open actions menu is not a positioned card any more');
  const s = card[0].props.style;
  assert.equal(s.top, 24,
    'the menu no longer drops from just under the ⋯ button (top:24) — it is laid over the message body again, '
    + 'so the member cannot read what they are answering. top was: ' + JSON.stringify(s.top));
  assert.equal(s.bottom, undefined, 'the menu is anchored upward as well as downward, which is ambiguous');
});

test('…and its near edge is pinned to the ⋯ side, on BOTH sides of the conversation', () => {
  const t = thread();
  // their message: incoming bubble, ⋯ sits to its right; the menu's near edge hangs from that side (left:100%)
  dots(t.redraw())[0].props.onClick();
  const theirs = menuCard(t.redraw())[0].props.style;
  assert.equal(theirs.left, '100%', 'an incoming message opens its menu from the wrong edge');
  assert.equal(theirs.right, undefined);
  // my message: outgoing bubble, ⋯ sits to its left; the menu hangs from that side (right:100%) so a 150px-wide
  // card on a narrow phone does not run off the right edge (clampMenuIntoView then nudges it fully on-screen).
  const u = thread();
  dots(u.redraw())[1].props.onClick();
  const own = menuCard(u.redraw())[0].props.style;
  assert.equal(own.right, '100%',
    'my own message opens its menu from the wrong edge of a right-aligned bubble, which on a narrow phone '
    + 'pushes a 150px-wide card off the screen');
  assert.equal(own.left, undefined);
});

// ── (b) the swipe, driven for real ────────────────────────────────────────────────────────────────────────

const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });

test('A SWIPE PAST THE THRESHOLD REPLIES EVEN IF NO RENDER HAPPENED BETWEEN THE LAST MOVE AND THE LIFT', () => {
  const t = thread();
  const s = swipers(t.redraw())[0];
  assert.ok(s, 're-anchor: the DM bubble is no longer wrapped in a swipe handler');
  s.props.onTouchStart(touch(100, 300));
  s.props.onTouchMove(touch(130, 302));
  s.props.onTouchMove(touch(160, 303));   // 60px right — past ARM (48). NO redraw before the lift, on purpose.
  s.props.onTouchEnd();
  const after = replying(t.redraw());
  assert.match(after, /Replying to Sam/,
    'THE SWIPE DID NOT START A REPLY. onTouchEnd tested a stale offset — the exact race a flick produces on a '
    + 'phone, where the last touchmove and the touchend arrive with no render in between. Screen read: ' + after);
});

test('…and it still replies when the drag DID redraw on the way (the easy case must not regress)', () => {
  const t = thread();
  let s = swipers(t.redraw())[0];
  s.props.onTouchStart(touch(100, 300));
  s.props.onTouchMove(touch(120, 301));
  s = swipers(t.redraw())[0];
  s.props.onTouchMove(touch(155, 302));
  s = swipers(t.redraw())[0];
  s.props.onTouchEnd();
  assert.match(replying(t.redraw()), /Replying to Sam/, 'a swipe that redrew mid-drag no longer replies');
});

test('a drag that stops SHORT of the threshold does not reply — the gesture is not hair-trigger', () => {
  const t = thread();
  const s = swipers(t.redraw())[0];
  s.props.onTouchStart(touch(100, 300));
  s.props.onTouchMove(touch(120, 301));   // 20px — well short of 48
  s.props.onTouchMove(touch(140, 301));   // 40px — still short
  s.props.onTouchEnd();
  const after = replying(t.redraw());
  assert.doesNotMatch(after, /Replying to/, 'a short drag started a reply nobody asked for. Screen read: ' + after);
});

test('a mostly-VERTICAL drag is a scroll and never replies, however far it travels sideways afterwards', () => {
  const t = thread();
  const s = swipers(t.redraw())[0];
  s.props.onTouchStart(touch(100, 300));
  s.props.onTouchMove(touch(110, 360));   // down the list, not across it
  s.props.onTouchMove(touch(190, 380));   // and now 90px sideways — but the swipe was already abandoned
  s.props.onTouchEnd();
  assert.doesNotMatch(replying(t.redraw()), /Replying to/, 'scrolling the thread started a reply');
});

test('a LEFT drag never replies (the gesture is right-only, and a clamp at 0 must not read as armed)', () => {
  const t = thread();
  const s = swipers(t.redraw())[0];
  s.props.onTouchStart(touch(200, 300));
  s.props.onTouchMove(touch(120, 301));
  s.props.onTouchEnd();
  assert.doesNotMatch(replying(t.redraw()), /Replying to/, 'dragging the wrong way started a reply');
});

test('an abandoned drag leaves nothing behind: the next short drag still does not reply', () => {
  const t = thread();
  let s = swipers(t.redraw())[0];
  s.props.onTouchStart(touch(100, 300));
  s.props.onTouchMove(touch(170, 301));   // armed…
  s.props.onTouchEnd();                   // …and taken
  assert.match(replying(t.redraw()), /Replying to/, 're-anchor: the armed swipe did not reply');
  find(t.redraw(), n => n.type === 'button' && n.props && n.props['aria-label'] === 'Stop replying')[0].props.onClick();
  assert.doesNotMatch(replying(t.redraw()), /Replying to/, 're-anchor: Stop replying did not clear the composer');
  s = swipers(t.redraw())[0];
  s.props.onTouchStart(touch(100, 300));
  s.props.onTouchMove(touch(110, 301));   // 10px this time
  s.props.onTouchEnd();
  assert.doesNotMatch(replying(t.redraw()), /Replying to/,
    'the offset from the previous gesture survived into this one, so a 10px drag replied');
});

test('a system CANCEL past the threshold still replies — the filled arrow had already promised it would', () => {
  const t = thread();
  const s = swipers(t.redraw())[0];
  assert.equal(typeof s.props.onTouchCancel, 'function', 're-anchor: the swipe no longer handles touchcancel');
  s.props.onTouchStart(touch(100, 300));
  s.props.onTouchMove(touch(165, 302));
  s.props.onTouchCancel();
  assert.match(replying(t.redraw()), /Replying to Sam/,
    'Android taking the gesture away after the arrow filled in loses the reply — which is the reported bug');
});

test('…but a cancel BELOW the threshold replies to nothing', () => {
  const t = thread();
  const s = swipers(t.redraw())[0];
  s.props.onTouchStart(touch(100, 300));
  s.props.onTouchMove(touch(120, 301));
  s.props.onTouchCancel();
  assert.doesNotMatch(replying(t.redraw()), /Replying to/, 'a cancelled, unarmed drag replied anyway');
});

test('the swipe container declares touch-action: pan-y, so the list scrolls and the browser does not claim the drag', () => {
  const t = thread();
  const s = swipers(t.redraw())[0];
  assert.equal(s.props.style && s.props.style.touchAction, 'pan-y',
    'without pan-y the compositor may hand a horizontal drag to an ancestor scroller and fire touchcancel '
    + 'part-way through it. React attaches touch listeners passively, so preventDefault() cannot do this job.');
});

// ── (c) TOUCH: Reply is the SOLE action here, so a touch phone shows NO ⋯ — the swipe replies ────────────────
// Owner 2026-10-15 (reverses the 2026-10-14 "keep the ⋯"). A POINTER device (the tests above) keeps the ⋯,
// because a mouse cannot swipe. These drive the real DMThread with matchMedia answering "no fine pointer".

const hiddenDots = (b) => !!b.props.style && b.props.style.width === '1px' && b.props.style.opacity === 0 && !!b.props.style.clip && b.props.style.display !== 'none' && !b.props.disabled && b.props.tabIndex === undefined && b.props['aria-label'] === 'Message actions';
test('TOUCH: a reply-only DM bubble has NO VISIBLE three-dots control (a hidden, focusable one remains for assistive tech), and the swipe still replies', () => {
  globalThis.__dmTouch = true;
  try {
    const t = thread();
    const tree = t.redraw();
    assert.ok(dots(tree).length > 0 && dots(tree).every(hiddenDots), 'a touch phone shows the reply-only ⋯, or has dropped the hidden assistive-tech route (' + dots(tree).length + ' found)');
    const s = swipers(tree)[0];
    assert.ok(s, 'the swipe handler is gone — with the ⋯ also gone there would be NO way to reply');
    s.props.onTouchStart(touch(100, 300));
    s.props.onTouchMove(touch(160, 303));
    s.props.onTouchEnd();
    assert.match(replying(t.redraw()), /Replying to Sam/, 'swipe did not reply on the touch render');
  } finally { globalThis.__dmTouch = false; }
});

test('POINTER: the same DM thread keeps its ⋯ and it replies (a mouse cannot swipe)', () => {
  globalThis.__dmTouch = false;
  const t = thread();
  const d = dots(t.redraw());
  assert.equal(d.length, 2, 'pointer device lost its only reply route');
  d[0].props.onClick();
  named(t.redraw(), 'Reply')[0].props.onClick();
  assert.match(replying(t.redraw()), /Replying to Sam/);
});

// ── ASSISTIVE TECH ON TOUCH (DMSwipe): the reply-only ⋯ stays reachable as a hidden, focusable node ─────────────
test('TOUCH POINT OF USE: the DM reply-only ⋯ is hidden but focusable and clickable; focus shows it; a click opens Reply', () => {
  globalThis.__dmTouch = true;
  try {
    const t = thread();
    const b = dots(t.redraw())[0];
    assert.ok(b, 'THE DEFECT: on touch the reply-only ⋯ is ABSENT, so TalkBack has no reply route at all');
    const st = b.props.style;
    assert.equal(st.width, '1px'); assert.equal(st.height, '1px'); assert.equal(st.opacity, 0); assert.match(String(st.clip), /rect\(0/);
    assert.notEqual(st.display, 'none'); assert.notEqual(st.pointerEvents, 'none');
    assert.ok(!b.props.disabled && b.props.tabIndex === undefined, 'the hidden ⋯ must stay focusable');
    const el = { style: {} };
    b.props.onFocus({ currentTarget: el });
    assert.equal(el.style.width, '30px'); assert.equal(el.style.opacity, '1');
    b.props.onBlur({ currentTarget: el });
    assert.equal(el.style.width, '1px');
    b.props.onClick();
    assert.ok(named(t.redraw(), 'Reply').length >= 1, 'the hidden ⋯ opened no Reply');
  } finally { globalThis.__dmTouch = false; }
});
test('POINTER: the DM reply-only ⋯ is the normal visible pill (not the hidden one)', () => {
  globalThis.__dmTouch = false;
  const b = dots(thread().redraw())[0];
  assert.equal(b.props.style.width, 30); assert.equal(b.props.style.opacity, undefined); assert.equal(b.props.onFocus, undefined);
});
