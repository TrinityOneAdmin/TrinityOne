// A MESSAGE YOU JUST SENT MUST NOT BLINK OUT BETWEEN THE ACK AND THE ECHO.
//   Run: node --test scripts/a-just-sent-message-does-not-blink-out.test.mjs
//
// The bug (both group rooms and direct messages). A message is published; the relay ACKs it; the engine drops
// it from the outbox ON THAT ACK (sendMessage / sendDM clear `_outbox` and fire onOutbox), so the `queued`
// state loses it. The authoritative copy only lands in `msgs` a beat later, through the SEPARATE subscription
// echo. For that beat the message is in NEITHER `msgs` NOR `queued`, and the old
// `[...msgs, ...queued.filter(not-have)]` dropped it — it vanished and then reappeared. A one-frame flicker on
// every offline post that finally sends.
//
// The fix is a shared pure helper, reconcileVisible, that keeps a "delivered, awaiting echo" shadow of each
// pending item until its id turns up in `msgs`. ChatRoom.visibleMsgs and DMThread.shownMsgs both call it.
//
// CLAUDE.md rule 3: the behavioural claims LIFT reconcileVisible out of app/screens-chat.jsx and RUN it (no
// text-matching a condition). Rule 1: the point-of-use tests RENDER the real ChatRoom and DMThread and assert
// the bubble is actually on the screen through the gap — so deleting the helper's CALL from a screen, not only
// breaking the helper, turns them red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');

function lift(src, scope) {
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('scope', `with (scope) { return ${src}; }`)(proxy);
}
// the REAL reconcileVisible, in one piece, run as a function (not matched as text)
const reconcileVisible = lift('(' + fnBody(CHAT, 'function reconcileVisible(msgs, queued, retainedPrev) {', 'reconcileVisible').replace(/^function /, 'function ') + ')', {});

const M = (id, extra = {}) => ({ id, _ts: 1000, me: true, text: 'see you Sunday', ...extra });
const Q = (id, extra = {}) => ({ id, _ts: 1000, me: true, text: 'see you Sunday', _pending: true, _failed: false, ...extra });

// ── the three states, driven through the real helper ───────────────────────────────────────────────────────

test('STATE 1 — pending: the queued message is on the thread, as a waiting bubble', () => {
  const r = reconcileVisible([], [Q('m1')], {});
  assert.deepEqual(r.visible.map(m => m.id), ['m1'], 'a pending message must show while it waits');
  assert.equal(r.visible[0]._pending, true, 'and it must show AS waiting');
  assert.ok(r.retainedNext.m1, 'its shadow is recorded, ready for the moment it is delivered');
});

test('STATE 2 — ACK happened, echo NOT yet: the message STAYS rendered (the regression)', () => {
  // state 1 recorded the shadow; now the ACK removed it from the queue and the echo has not arrived.
  const prev = reconcileVisible([], [Q('m1')], {}).retainedNext;
  const r = reconcileVisible([], [], prev);
  assert.deepEqual(r.visible.map(m => m.id), ['m1'],
    'the message is in neither msgs nor queued for a beat — it must NOT disappear (this is the flicker)');
  assert.equal(r.visible[0]._pending, false, 'a delivered message must draw as a settled bubble, not "Waiting to send"');
  assert.equal(r.visible[0]._failed, false, 'and not as failed');
  assert.ok(r.retainedNext.m1, 'the shadow is carried forward until the echo lands');
});

test('STATE 3 — echo lands: exactly ONE copy, no duplicate, shadow released', () => {
  const prev = reconcileVisible([], [], reconcileVisible([], [Q('m1')], {}).retainedNext).retainedNext;
  const r = reconcileVisible([M('m1')], [], prev);
  assert.deepEqual(r.visible.map(m => m.id), ['m1'], 'the echo is the authoritative copy — it stays');
  assert.equal(r.visible.filter(m => m.id === 'm1').length, 1, 'the shadow must not double the echoed message');
  assert.deepEqual(Object.keys(r.retainedNext), [], 'once the echo is in msgs the shadow is dropped');
});

test('a message still PENDING and also already echoed is drawn once, from msgs', () => {
  // the overlap window the old code already handled — kept honest so the fix does not regress it
  const r = reconcileVisible([M('m1')], [Q('m1')], {});
  assert.equal(r.visible.filter(m => m.id === 'm1').length, 1, 'no duplicate while both the queue and msgs hold it');
});

test('a FAILED message is not shadowed — it keeps living in the queue, as failed', () => {
  // a permanent refusal stays in `queued` as _failed and must NOT be mistaken for delivered
  const r = reconcileVisible([], [{ id: 'm1', _ts: 1000, me: true, text: 'x', _pending: false, _failed: true }], {});
  assert.deepEqual(r.visible.map(m => m.id), ['m1'], 'the failed message still shows (from the queue)');
  assert.equal(r.visible[0]._failed, true, 'and it still shows AS failed');
  assert.deepEqual(Object.keys(r.retainedNext), [], 'a failed message is never retained as "delivered"');
});

// ── point of use: the REAL screens render the bubble through the gap (rule 1) ────────────────────────────────

function baseGlobals(React, extra) {
  return {
    React,
    window: { Fellowship: extra.F, TrinityData: { GROUP_MESSAGES: {} }, addEventListener() {}, removeEventListener() {} },
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
    ...extra.globals,
  };
}

test('POINT OF USE — DMThread keeps a just-sent message on screen through the ACK→echo gap', () => {
  const { React, draw } = miniReact();
  const PEER = 'b'.repeat(64);
  // the outbox the screen reads, and the thread echo it subscribes to — both driven by hand
  let queue = [{ id: 'd1', kind: 4, pubkey: 'a'.repeat(64), tags: [['p', PEER]], content: 'ct' }];
  const outSubs = new Set();
  let threadOnMsg = null;
  const F = {
    myPubkey: 'a'.repeat(64), ready: Promise.resolve(),
    displayFor: () => ({ handle: 'Sam', av: { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' } }),
    requestProfiles() {},
    subscribeThread: (_p, onMsg) => { threadOnMsg = onMsg; return () => {}; },
    onOutbox: (fn) => { outSubs.add(fn); return () => outSubs.delete(fn); },
    outboxForPeer: () => queue.map(e => ({ ...e, _pending: true, _failed: false })),
    dmPlaintextOf: () => 'see you Sunday',
    requeue: () => true, dropQueued: () => {},
  };
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread'], baseGlobals(React, { F }));
  const ctx = { toast() {}, canDMPeer: () => true, connTick: 0 };
  const props = { peer: PEER, open: true, onClose() {}, ctx, docked: false };
  const redraw = () => draw(mod.DMThread, props);
  redraw();
  // state 1: pending in the queue → on screen
  let tree = redraw();
  assert.match(texts(tree).join(' | '), /see you Sunday/, 're-anchor: a pending DM is not shown at all');
  // state 2: the ACK — the engine drops it from the outbox and notifies; the echo has NOT arrived yet
  queue = [];
  outSubs.forEach(fn => fn());
  tree = redraw();
  assert.match(texts(tree).join(' | '), /see you Sunday/,
    'THE JUST-SENT DM BLINKED OUT between the ACK and the echo — the flicker this fix exists to remove');
  // state 3: the echo lands in msgs → still exactly one copy
  threadOnMsg({ id: 'd1', mine: true, content: 'see you Sunday', ts: 1000, pubkey: 'a'.repeat(64) });
  tree = redraw();
  const shown = texts(tree).join(' | ').match(/see you Sunday/g) || [];
  assert.equal(shown.length, 1, 'the echo must not leave TWO copies on the thread');
});

test('POINT OF USE — ChatRoom keeps a just-sent message on screen through the ACK→echo gap', () => {
  const { React, draw } = miniReact();
  const group = { id: 'prayer', name: 'Prayer', encrypted: false };
  let queue = [{ id: 'g1', kind: 1, pubkey: 'a'.repeat(64), tags: [['t', 'prayer']], content: 'pray for Ada', created_at: 1000 }];
  const outSubs = new Set();
  let groupAdd = null;
  const F = {
    myPubkey: 'a'.repeat(64), ready: Promise.resolve(), churchPub: null, churchNpub: null,
    requestProfiles() {},
    subscribeGroup: (_g, add) => { groupAdd = add; return () => {}; },
    subscribeReactions: () => () => {}, subscribeGroupPin: () => () => {}, subscribeHidden: () => () => {},
    onOutbox: (fn) => { outSubs.add(fn); return () => outSubs.delete(fn); },
    outboxFor: () => queue.map(e => ({ ...e, _pending: true, _failed: false })),
    relayReady: () => true, groupEncState: () => 'clear',
    canPostHere: () => true,
  };
  const globals = baseGlobals(React, { F, globals: {
    Bubble: ({ m }) => React.createElement('div', { 'data-bubble': m.id }, m.text || ''),
    canModerateGroup: () => false,
  } });
  let mod;
  try { mod = loadScreen('app/screens-chat.jsx', ['ChatRoom'], globals); }
  catch (e) { assert.fail('ChatRoom could not be rendered in isolation — re-anchor its stubs: ' + e.message); }
  const ctx = { connTick: 0, church: {}, me: { pubkey: 'a'.repeat(64) }, canPostHere: true };
  const props = { group, ctx, open: true };
  const redraw = () => draw(mod.ChatRoom, props);
  redraw();
  let tree = redraw();
  assert.match(texts(tree).join(' | '), /pray for Ada/, 're-anchor: a pending group post is not shown at all');
  queue = [];
  outSubs.forEach(fn => fn());
  tree = redraw();
  assert.match(texts(tree).join(' | '), /pray for Ada/,
    'THE JUST-SENT GROUP POST BLINKED OUT between the ACK and the echo — the flicker this fix exists to remove');
  groupAdd({ kind: 1, id: 'g1', pubkey: 'a'.repeat(64), tags: [['t', 'prayer']], content: 'pray for Ada', created_at: 1000 });
  tree = redraw();
  const shown = texts(tree).join(' | ').match(/pray for Ada/g) || [];
  assert.equal(shown.length, 1, 'the echo must not leave TWO copies in the room');
});

// ── wiring: both screens actually CALL the shared helper (so a deleted call is caught) ───────────────────────

test('both ChatRoom and DMThread take their visible list from reconcileVisible', () => {
  const src = stripComments(CHAT);
  const calls = src.match(/reconcileVisible\(/g) || [];
  // one definition + one call in ChatRoom + one call in DMThread
  assert.equal(calls.length, 3, 'reconcileVisible must be defined once and called by BOTH screens (found ' + calls.length + ')');
  assert.match(src, /const visibleMsgs = React\.useMemo\(\(\) => \{\s*const shown = msgs\.filter[^;]*;\s*const \{ visible, retainedNext \} = reconcileVisible\(shown, queued,/,
    'ChatRoom.visibleMsgs must come from reconcileVisible');
  assert.match(src, /const shownMsgs = React\.useMemo\(\(\) => \{\s*const \{ visible, retainedNext \} = reconcileVisible\(msgs, dmQueued,/,
    'DMThread.shownMsgs must come from reconcileVisible');
});
