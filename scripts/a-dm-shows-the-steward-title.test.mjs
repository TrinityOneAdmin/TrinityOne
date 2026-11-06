// A PRIVATE MESSAGE WITH A STEWARD MUST SHOW THE STEWARD'S NAME AND THEIR CHURCH-SIGNED TITLE.
//   Run: node --test scripts/a-dm-shows-the-steward-title.test.mjs
//
// A church pilot reported that in a direct message with a steward the member saw no steward title. The group
// room has shown the church-signed by-line under a notice for a long time (the `{d.signedBy ? …}` span in the
// bubble); the DM header never did — it rendered only the handle and "Direct message · encrypted". This file
// guards the DM-header render that was added to close that gap.
//
// HOUSE RULE 1 (test at the point of USE): these cases render the REAL DMThread off app/screens-chat.jsx and
// read its rendered tree. Deleting the title render FROM THE DM HEADER makes cases 1 and 2 go red — not only
// a broken engine. displayFor is STUBBED, so the test does not depend on how a name/title is resolved; it
// asserts that whatever displayFor returns actually reaches the private-thread header.
//
// HOUSE RULE 3 (never match text in app/*.jsx): nothing here greps the source. Every assertion is against the
// rendered output of the miniature React in render-jsx-screen.mjs.
//
// PRIVACY: signedBy/signedRole come only from the church-key-signed roster/voice document (see displayFor in
// src/fellowship.src.js); they are not the peer's own kind-0, and a member already sees them in group rooms.
// Rendering them in a DM exposes nothing new about anyone. This test deliberately does NOT touch displayFor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, reads } from './render-jsx-screen.mjs';

const PEER = 'b'.repeat(64);
const ME = 'a'.repeat(64);

// One incoming message is enough to render the thread; the by-line lives in the HEADER, which displayFor(peer)
// drives — so the display is what each case varies.
const THEIRS = { id: 'm-theirs', mine: false, pubkey: PEER, ts: 1760000000, content: 'Could we talk on Sunday?' };

// The REAL DMThread, with displayFor(peer) returning whatever this case wants to prove reaches the screen.
function thread(display) {
  const { React, draw } = miniReact();
  const F = {
    myPubkey: ME,
    relays: ['wss://relay.example'],
    ready: Promise.resolve(),
    subscribeThread: (_peer, add) => { add(THEIRS); return () => {}; },
    outboxForPeer: () => [],
    onOutbox: () => () => {},
    dmPlaintextOf: () => '',
    displayFor: () => display,
    requestProfiles: () => {},
    reactDM: () => {},
    sendDM: async () => ({}),
    requeue: () => true,
    dropQueued: () => {},
  };
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread', 'DMSwipe'], {
    React,
    window: { matchMedia: () => ({ matches: true }), Fellowship: F, addEventListener() {}, removeEventListener() {} },
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
  redraw();   // the subscription arrives through an effect
  return { redraw };
}

const AV = { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' };

test('a steward DM header shows the name AND the church-signed title', () => {
  // Church/steward key: displayFor sets handle === signedBy (both from voice.name) and a role in signedRole.
  const words = reads(thread({ handle: 'Rev Ada', signedBy: 'Rev Ada', signedRole: 'Vicar', av: AV }).redraw());
  assert.match(words, /Rev Ada/, 'the steward name is missing from the private-thread header');
  assert.match(words, /Vicar/,
    'the steward TITLE is not shown in a DM — deleting the by-line render from the DM header reproduces the '
    + 'pilot report. Header read: ' + words);
});

test('name and role both show when the name differs from the handle', () => {
  // A by-line whose person differs from the thread handle (handle is the member/account name, signedBy the steward).
  const words = reads(thread({ handle: 'Margaret', signedBy: 'Rev Ada', signedRole: 'Vicar', av: AV }).redraw());
  assert.match(words, /Rev Ada, Vicar/,
    'the full "Name, Role" by-line is not shown when it differs from the handle. Header read: ' + words);
});

test('an ordinary member DM header shows NO steward title line', () => {
  // No by-line: the guard must render nothing extra, and the name still shows.
  const words = reads(thread({ handle: 'Sam', signedBy: '', signedRole: '', av: AV }).redraw());
  assert.match(words, /Sam/, 'the peer name is missing from the private-thread header');
  assert.doesNotMatch(words, /Vicar/, 'a title line appeared for a member who has no church-signed by-line');
});
