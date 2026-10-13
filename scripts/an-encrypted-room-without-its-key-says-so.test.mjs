// AN ENCRYPTED ROOM THIS PHONE HOLDS NO KEY FOR SAYS SO — IT DOES NOT CLAIM TO BE EMPTY.
//   Run: node --test scripts/an-encrypted-room-without-its-key-says-so.test.mjs
//
// THE DEFECT (2026-10-12). A member the console had not yet given a room's key (see
// scripts/a-room-key-reaches-a-member-the-console-never-saw-join.test.mjs) opened an encrypted room full of
// conversation and read "No messages yet — Say hello". The messages were there; their phone simply could not open
// them, so it dropped them. The member was told nobody was talking, and invited to post a message their own phone
// then refuses to send. The empty state now reads the same answer as the header's lock label
// (Fellowship.groupEncState): 'nokey' → "Waiting for this room’s key". A room that is genuinely empty is unchanged.
//
// THE POINT OF USE (CLAUDE.md rules 1 and 3): the real ChatRoom, compiled out of app/screens-chat.jsx and rendered;
// nothing here matches text in the jsx. Rig copied from a-broadcast-room-says-what-it-is.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const ROOM = { id: 'g7', name: 'Prayer', accent: '#888', kind: 'Group', encrypted: true };

function room(encState) {
  const { React, draw } = miniReact();
  const Fellowship = {
    myPubkey: 'mehex', relays: ['wss://relay.example'], relayReady: () => true,
    groupEncState: () => encState,
    subscribeGroup: () => () => {}, subscribeReactions: () => () => {},
    subscribeGroupPin: (_g, cb) => { cb(null); return () => {}; },
    subscribeHidden: (_g, cb) => { cb(new Set()); return () => {}; },
    subscribeMessageTags: () => () => {},
    displayFor: () => ({ handle: 'sam', color: '#888' }),
    requestProfiles: () => {}, outboxFor: () => [], onOutbox: () => () => {},
    canAddGroupEvent: () => false, react: () => {},
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatRoom'], {
    React,
    window: {
      Fellowship,
      TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
      TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
      addEventListener: () => {}, removeEventListener: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      confirm: () => true,
    },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {},
    todayISO: () => '2026-10-12',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ open, children }) => (open ? children : null),
    UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ children }) => children,
    safeCssColor: (c) => c,
    D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast: () => {},
    church: { npub: 'npub1church', name: 'St Aidan’s', id: 'c1' },
    myLeaderGroups: [], churchEvents: [], safeguard: {}, myPubkey: 'mehex', openDM: () => {},
    joinState: { loaded: true, isPending: false, removed: false, offline: false },
  };
  const props = { group: ROOM, open: true, onClose: () => {}, ctx, docked: true };
  draw(mod.ChatRoom, props);               // the effects read the key state and the connection…
  return texts(draw(mod.ChatRoom, props)).join(' | ');   // …and the second draw shows what they read
}

test('an encrypted room with no key on this phone says it is waiting for the key — not that it is empty', () => {
  const said = room('nokey');
  assert.match(said, /Waiting for this room’s key/,
    'A MEMBER WITH NO KEY IS NOT TOLD WHY THE ROOM LOOKS EMPTY: ' + said);
  assert.doesNotMatch(said, /No messages yet|Say hello/,
    'THE ROOM CLAIMS TO BE EMPTY over messages this phone simply cannot open, and invites a post it will refuse: ' + said);
});

test('a room that is genuinely empty still says so — sealed or not', () => {
  for (const st of ['sealed', 'clear']) {
    const said = room(st);
    assert.match(said, /No messages yet/, `an empty ${st} room lost its empty state: ` + said);
    assert.doesNotMatch(said, /Waiting for this room/, `an empty ${st} room claims to be waiting for a key it holds or does not need: ` + said);
  }
});
