// A MEMBER CAN DELETE THEIR OWN PRIVATE (1:1) MESSAGE — AND IS NOT PROMISED MORE THAN THAT.
//   Run: node --test scripts/a-private-message-can-be-deleted-by-its-author.test.mjs
//
// Group rooms have had delete for ever (deleteOwnMessage → kind-5, honoured live by subscribeGroup, so the
// room can honestly say "removed for everyone"). The DM thread offered only Reply. A 1:1 DM is different and
// the wording has to be honest about it: a kind-4 is already received and decrypted by the recipient, and the
// thread/inbox subscriptions request kinds [4]/[7], never kind-5 — so a deletion is DURABLE FOR THE SENDER
// (the relay tombstones their own copy, self-authorship enforced) but only BEST-EFFORT for the other person.
//
// v1 (owner 2026-10-28) is "delete for you": a Delete row on your OWN messages, local removal + dropQueued for
// an unsent copy, and a best-effort NIP-09 kind-5 to dmSendRelays(peer). The confirm must NOT reuse the group
// room's "removed for everyone".
//
// CLAUDE.md rule 3: the engine claim LIFTS deleteOwnDM out of vendor/fellowship.js and RUNS it; the UI claims
// RENDER the real DMThread and read what is on it. Nothing asserts behaviour by matching text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
const PEER = 'b'.repeat(64);
const MINE = 'a'.repeat(64);

function lift(src, scope) {
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('scope', `with (scope) { return ${src}; }`)(proxy);
}

// ── ENGINE: the shipped deleteOwnDM, lifted and run ──────────────────────────────────────────────────────────
function liftDeleteOwnDM() {
  const body = fnBody(BUNDLE, 'async deleteOwnDM(peerPub, msgId) {', 'deleteOwnDM');
  const fin = (body.match(/\b(finalizeEvent\d*)\(/) || [])[1];   // the bundle renames finalizeEvent; bind whatever name it gave it
  assert.ok(fin, 're-anchor: deleteOwnDM no longer signs an event');
  const calls = [];
  const scope = {
    sk: new Uint8Array(32), NET: 'trinityone', console: { warn() {} },
    toPub: (x) => x,   // a pubkey normaliser, not the thing under test
    dmSendRelays: (peer) => { calls.push({ dmSendRelays: peer }); return ['wss://peer.relay/']; },
    _publishAny: async (relays, evt) => { calls.push({ _publishAny: { relays, evt } }); },
    window: { Fellowship: { ready: Promise.resolve() } },
  };
  scope[fin] = (t) => ({ ...t });   // sign = passthrough, so the test reads the real tags/kind/content
  const fn = lift('(' + body.replace(/^async deleteOwnDM/, 'async function deleteOwnDM') + ')', scope);
  return { fn, calls };
}

test('deleteOwnDM signs a kind-5 that deletes THIS message, carries the peer, and has NO content and NO group tag', async () => {
  const { fn } = liftDeleteOwnDM();
  const MSG = 'f'.repeat(64);
  const evt = await fn(PEER, MSG);
  assert.equal(evt.kind, 5, 'a deletion is a NIP-09 kind-5');
  assert.deepEqual(evt.tags.filter(t => t[0] === 'e').map(t => t[1]), [MSG], 'it must delete exactly the message asked for');
  assert.deepEqual(evt.tags.filter(t => t[0] === 'p').map(t => t[1]), [PEER], 'it carries the peer (a DM names its other party)');
  assert.ok(evt.tags.some(t => t[0] === 't' && t[1] === 'trinityone'), 'it stays inside the network tag');
  assert.equal(evt.tags.filter(t => t[0] === 't' && t[1] !== 'trinityone').length, 0, 'but it has NO group tag — a DM has no group');
  assert.equal(evt.content, '', 'a deletion carries no content — nothing of the message is re-leaked');
});

test('deleteOwnDM publishes to the SAME relays the DM went to — dmSendRelays(peer), not the group publish set', async () => {
  const { fn, calls } = liftDeleteOwnDM();
  await fn(PEER, 'f'.repeat(64));
  const relayCall = calls.find(c => 'dmSendRelays' in c);
  assert.ok(relayCall, 'it must resolve the peer relays with dmSendRelays(peer)');
  assert.equal(relayCall.dmSendRelays, PEER, 'with the peer, so the deletion reaches the boxes that hold the DM');
  const pub = calls.find(c => '_publishAny' in c);
  assert.ok(pub, 'it must actually publish the deletion');
  assert.deepEqual(pub._publishAny.relays, ['wss://peer.relay/'], 'to the DM relays, not publishSetFor(cp)');
});

// ── UI: the real DMThread, rendered, read ────────────────────────────────────────────────────────────────────
function thread() {
  const { React, draw } = miniReact();
  const calls = [];
  let threadOnMsg = null;
  const confirms = [];
  globalThis.confirm = (m) => { confirms.push(String(m)); return true; };
  const F = {
    myPubkey: MINE, ready: Promise.resolve(),
    displayFor: () => ({ handle: 'Sam', av: { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' } }),
    requestProfiles() {},
    subscribeThread: (_p, onMsg) => { threadOnMsg = onMsg; return () => {}; },
    onOutbox: () => () => {}, outboxForPeer: () => [], dmPlaintextOf: () => '',
    requeue: () => true,
    dropQueued: (id) => { calls.push({ dropQueued: id }); },
    deleteOwnDM: (peer, id) => { calls.push({ deleteOwnDM: { peer, id } }); return Promise.resolve({}); },
  };
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread'], {
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
    CareOfferAccept: () => null,
  });
  const ctx = { toast() {}, canDMPeer: () => true, connTick: 0, churchEvents: [] };
  const props = { peer: PEER, open: true, onClose() {}, ctx, docked: false };
  const redraw = () => draw(mod.DMThread, props);
  redraw();
  // two messages on the thread: one I sent, one they sent
  threadOnMsg({ id: 'mine1', mine: true, content: 'that worked, thanks', ts: 1000, pubkey: MINE });
  threadOnMsg({ id: 'their1', mine: false, content: 'glad it did', ts: 2000, pubkey: PEER });
  let tree = redraw();
  // open a message's ⋯ menu by clicking its dots button (they are in thread order: mine first)
  const openMenu = (idx) => { find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === 'Message actions')[idx].props.onClick(); tree = redraw(); };
  return { redraw, openMenu, tree: () => tree, calls, confirms, F };
}

test('POINT OF USE — Delete is offered on your OWN DM and NOT on the other person\'s', () => {
  const t = thread();
  // the dots exist for both bubbles
  const dots = find(t.tree(), n => n.type === 'button' && n.props && n.props['aria-label'] === 'Message actions');
  assert.equal(dots.length, 2, 're-anchor: a DM bubble no longer has a ⋯ menu');
  // my own message's menu has Delete
  t.openMenu(0);
  assert.equal(button(t.tree(), 'Delete').length, 1, 'I cannot delete my OWN private message');
  // the other person's message's menu does NOT
  t.openMenu(1);
  assert.equal(button(t.tree(), 'Delete').length, 0, 'the Delete row showed on a message I did not write');
  assert.ok(button(t.tree(), 'Reply').length >= 1, 're-anchor: Reply is gone from the DM menu');
});

test('POINT OF USE — deleting your own DM uses the honest "for you" wording, removes it, and asks the relay to tombstone', () => {
  const t = thread();
  t.openMenu(0);
  button(t.tree(), 'Delete')[0].props.onClick();
  // the EXACT wording the owner chose — and NOT the group room's "removed for everyone"
  assert.equal(t.confirms[t.confirms.length - 1],
    "Delete this message? It'll be removed for you. The other person may still have their copy.",
    'the confirm wording drifted from the owner\'s chosen text');
  assert.doesNotMatch(t.confirms.join(' '), /removed for everyone/, 'a DM must never promise "for everyone"');
  const tree = t.redraw();
  assert.doesNotMatch(texts(tree).join(' | '), /that worked, thanks/, 'the deleted message is still on my screen');
  assert.match(texts(tree).join(' | '), /glad it did/, 'it removed the wrong message — the peer\'s is gone');
  assert.ok(t.calls.some(c => c.deleteOwnDM && c.deleteOwnDM.peer === PEER && c.deleteOwnDM.id === 'mine1'),
    'the durable NIP-09 tombstone was not published for this message');
  assert.ok(t.calls.some(c => c.dropQueued === 'mine1'), 'an unsent copy in the outbox was not cancelled');
});

// ── wiring: DMThread actually passes onDelete for own messages ───────────────────────────────────────────────
test('DMThread wires onDelete on DMSwipe, gated on m.mine and FS.deleteOwnDM', () => {
  const src = stripComments(CHAT);
  assert.match(src, /onDelete=\{m\.mine && FS && FS\.deleteOwnDM \?/, 'the Delete row must be gated on m.mine and the engine method');
  assert.match(src, /function DMSwipe\(\{ mine, onReply, onDelete,/, 'DMSwipe must accept the onDelete prop');
});
