// THE MEMBER APP'S CHAT POP-OVERS CLOSE WHEN YOU TAP OFF THEM (owner 2026-10-15).
// Run: node --test scripts/member-chat-popovers-close-on-tap-off.test.mjs
//
// Point of use (CLAUDE.md rules 1 and 3): the REAL ChatRoom and DMThread from app/screens-chat.jsx are
// compiled with the build's own esbuild and rendered through the miniature React. The screen registers its
// own `pointerdown` listener on a `document` stub that records it; the test fires that listener with a target
// that is inside or outside the pop-over, exactly as the capture handler would see a real press. Nothing
// matches text in app/*.jsx.
//
// Owner's device report: in the member app the reactions picker and the ⋯ menu stayed open, in BOTH a group
// room and a private message, until tapped a second time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const ME = 'mehex', THEM = 'themhex';

// A recording document, shared by both screens' effects.
function recDoc() {
  const listeners = [];
  return {
    listeners,
    doc: {
      createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} },
      addEventListener: (t, f, c) => listeners.push({ t, f, c }),
      removeEventListener: (t, f) => { const n = listeners.findIndex(l => l.t === t && l.f === f); if (n >= 0) listeners.splice(n, 1); },
    },
  };
}
const outside = { closest: () => null };
const insideSel = (want) => ({ closest: (sel) => (sel === want ? {} : null) });
const pressAll = (listeners, target) => listeners.filter(l => l.t === 'pointerdown').forEach(l => l.f({ target }));
// The actionable Reply button's visible text ENDS in "Reply" (icon props can leak into the text, and the
// sibling "Reply privately" ends in "privately" — so a trailing-word match picks the right one).
const named = (tree, label) => find(tree, n => n.type === 'button' && texts(n).join(' ').trim().endsWith(label));

// ── GROUP ROOM (ChatRoom) ───────────────────────────────────────────────────────────────────────────────

function room() {
  const { React, draw } = miniReact();
  const { doc, listeners } = recDoc();
  const group = { id: 'g1', name: 'Youth', kind: 'Group', accent: '#888' };
  const Fellowship = {
    myPubkey: ME, relays: ['wss://relay.example'], relayReady: () => true, groupEncState: () => 'clear',
    subscribeGroup: (_g, add) => { add({ id: 'm1', pubkey: THEM, kind: 1, created_at: 1756500000, tags: [], content: 'hello church' }); return () => {}; },
    subscribeReactions: () => () => {},
    subscribeGroupPin: (_g, cb) => { cb(null); return () => {}; },
    subscribeHidden: (_g, cb) => { cb(new Set()); return () => {}; },
    subscribeMessageTags: () => () => {},
    displayFor: () => ({ handle: 'sam', color: '#888' }),
    requestProfiles: () => {}, outboxFor: () => [], onOutbox: () => () => {},
    canAddGroupEvent: () => false, react: () => {},
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatRoom'], {
    React,
    window: { Fellowship, TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
      TrinityIdentity: { current: { handle: 'me', color: '#123456' } }, addEventListener: () => {}, removeEventListener: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, confirm: () => true },
    document: doc,
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-09-01',
    Icon: () => null, IconBtn: ({ name }) => React.createElement('button', { title: name }),
    Overlay: ({ open, children }) => (open ? children : null), UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ children }) => children, safeCssColor: (c) => c, D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = { toast: () => {}, church: { npub: 'npub1church', name: 'St Aidan’s', id: 'c1' }, myLeaderGroups: [],
    churchEvents: [], safeguard: {}, myPubkey: ME, openDM: () => {}, canDMPeer: () => true, connTick: 0,
    joinState: { loaded: true, isPending: false, removed: false, offline: false } };
  let tree;
  const render = () => { tree = draw(mod.ChatRoom, { group, open: true, onClose: () => {}, ctx, docked: true }); return tree; };
  render();
  return { render, tree: () => tree, listeners };
}

const reactBtn = (t) => find(t, n => n.type === 'button' && n.props.title === 'React')[0];
const rxPopButtons = (t) => { const w = find(t, n => n.props && n.props['data-rx-pop'])[0]; return w ? find(w, n => n.type === 'button').length : 0; };
const msgMenuBtn = (t) => find(t, n => n.type === 'button' && n.props['aria-label'] === 'Message actions')[0];

test('CONTROL: the group room renders a message with a React button and a ⋯ menu button', () => {
  const r = room();
  const t = r.render();
  assert.ok(reactBtn(t), 're-anchor: no React (reactions) button on a live group message');
  assert.ok(msgMenuBtn(t), 're-anchor: no ⋯ Message-actions button on a group message');
});

test('group reactions picker: tap OFF closes it; a press on [data-rx-pop] does not', () => {
  const r = room();
  reactBtn(r.render()).props.onClick();        // open the emoji picker
  assert.ok(rxPopButtons(r.render()) > 1, 'precondition: the picker did not open');
  assert.ok(r.listeners.some(l => l.t === 'pointerdown'), 'an open picker registered no tap-off listener');
  pressAll(r.listeners, insideSel('[data-rx-pop]'));
  assert.ok(rxPopButtons(r.render()) > 1, 'a press inside [data-rx-pop] closed the picker');
  pressAll(r.listeners, outside);
  assert.equal(rxPopButtons(r.render()), 1, 'tapping off the picker left it open');
});

test('group ⋯ menu: tap OFF closes it; a press on [data-msg-menu] does not', () => {
  const r = room();
  msgMenuBtn(r.render()).props.onClick();       // open the actions menu
  assert.ok(named(r.render(), 'Reply').length > 0, 'precondition: the ⋯ menu did not open');
  pressAll(r.listeners, insideSel('[data-msg-menu]'));
  assert.ok(named(r.render(), 'Reply').length > 0, 'a press inside [data-msg-menu] closed the menu');
  pressAll(r.listeners, outside);
  assert.equal(named(r.render(), 'Reply').length, 0, 'tapping off the ⋯ menu left it open');
});

// ── PRIVATE MESSAGE (DMThread) ──────────────────────────────────────────────────────────────────────────

function thread() {
  const { React, draw } = miniReact();
  const { doc, listeners } = recDoc();
  const PEER = { pubkey: THEM, handle: 'Sam' };
  const F = {
    myPubkey: ME, relays: ['wss://relay.example'], ready: Promise.resolve(),
    subscribeThread: (_p, add) => { add({ id: 'd1', mine: false, pubkey: THEM, ts: 1, content: 'Could we talk?' }); return () => {}; },
    outboxForPeer: () => [], onOutbox: () => () => {}, dmPlaintextOf: () => '',
    displayFor: () => ({ handle: 'Sam', av: { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' } }),
    requestProfiles: () => {}, reactDM: () => {}, sendDM: async () => ({}), requeue: () => true, dropQueued: () => {},
  };
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread', 'DMSwipe'], {
    React,
    window: { Fellowship: F, addEventListener() {}, removeEventListener() {} },
    document: doc,
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
  let tree;
  const render = () => { tree = draw(mod.DMThread, { peer: PEER, open: true, onClose() {}, ctx, docked: false }); return tree; };
  render();
  return { render, tree: () => tree, listeners };
}

const dmRxCount = (t) => find(t, n => n.props && n.props['data-dm-rx']).length;
const dmBubble = (t) => find(t, n => n.type === 'div' && n.props['data-dm-rx'] && typeof n.props.onClick === 'function')[0];
const dmDots = (t) => find(t, n => n.type === 'button' && n.props['aria-label'] === 'Message actions')[0];

test('CONTROL: the DM thread renders a bubble (data-dm-rx) and a ⋯ menu button', () => {
  const d = thread();
  const t = d.render();
  assert.ok(dmBubble(t), 're-anchor: no data-dm-rx bubble in the DM thread');
  assert.ok(dmDots(t), 're-anchor: no ⋯ Message-actions button in the DM thread');
});

test('DM reactions picker: tap OFF closes it; a press on [data-dm-rx] does not', () => {
  const d = thread();
  const base = dmRxCount(d.render());            // bubbles only
  dmBubble(d.render()).props.onClick();          // open the picker on the bubble
  assert.ok(dmRxCount(d.render()) > base, 'precondition: the picker did not open (no extra data-dm-rx)');
  pressAll(d.listeners, insideSel('[data-dm-rx]'));
  assert.ok(dmRxCount(d.render()) > base, 'a press inside [data-dm-rx] closed the picker');
  pressAll(d.listeners, outside);
  assert.equal(dmRxCount(d.render()), base, 'tapping off the picker left it open');
});

test('DM ⋯ menu: tap OFF closes it; a press on [data-dm-menu] does not', () => {
  const d = thread();
  dmDots(d.render()).props.onClick();
  assert.ok(named(d.render(), 'Reply').length > 0, 'precondition: the ⋯ menu did not open');
  pressAll(d.listeners, insideSel('[data-dm-menu]'));
  assert.ok(named(d.render(), 'Reply').length > 0, 'a press inside [data-dm-menu] closed the menu');
  pressAll(d.listeners, outside);
  assert.equal(named(d.render(), 'Reply').length, 0, 'tapping off the ⋯ menu left it open');
});
