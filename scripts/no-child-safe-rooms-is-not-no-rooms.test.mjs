// "THE CHURCH HAS NO CHAT ROOMS" IS A LIE TO TELL A CHILD WHOSE CHURCH HAS TEN.
// Run: node --test scripts/no-child-safe-rooms-is-not-no-rooms.test.mjs
//
// A young person's chat list is filtered to rooms the church has marked child-safe (the safeguarding filter
// in ChatScreen). When that filter empties the list, the screen fell through to the ordinary empty state:
// "<church> hasn't opened any chat rooms yet — they'll appear here when it does."
//
// Every word of that is false for them. The church HAS opened rooms. Nothing is coming. And the sentence
// reads either as the app being broken or as being quietly shut out of something everyone else can see —
// which is precisely the reading a young person is most likely to take and least likely to ask about.
//
// The owner's steer (2026-08-30): a church may perfectly well decide its children get direct messages and no
// group rooms, and that is a NORMAL setup, not a misconfiguration. So the wording must read as ordinary,
// must not imply anyone is at fault, must not tell them to go and ask a leader — and must point at what they
// CAN do, which is message people at their church one to one. The People button sits directly above it.
//
// An adult in a church that genuinely has no rooms must still get the old sentence: that one is true for
// them, and losing it would trade one wrong empty state for another.
//
// CLAUDE.md rule 3: no assertion here matches text in app/*.jsx. The screen is compiled and RENDERED and the
// empty state is read out of the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const ADULT_ROOM = { id: 'g1', name: 'Whole Church', kind: 'group', visibility: 'open', childsafe: false };
const KIDS_ROOM = { id: 'g2', name: 'Youth', kind: 'group', visibility: 'open', childsafe: true };

// Render ChatScreen for a member of a church whose published rooms are `rooms`.
function chatList({ rooms = [], isMinor = false } = {}) {
  const { React, draw } = miniReact();
  const win = {
    Fellowship: {
      myPubkey: 'mehex',
      relays: ['wss://relay.example'],
      // the church's published group definitions — the relay serves these to everyone, child or not
      subscribeChurchGroups: (_np, cb) => { cb(rooms); return () => {}; },
      subscribeChurchCategories: (_np, cb) => { cb([]); return () => {}; },
      subscribeGroups: () => () => {},
      displayFor: () => ({ handle: 'sam', color: '#888' }),
      assumeMinor: async () => isMinor,
    },
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
    TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
    addEventListener: () => {}, removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatScreen'], {
    React,
    window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {},
    todayISO: () => '2026-08-30',
    Icon: () => null,
    IconBtn: ({ name }) => React.createElement('button', { title: name }),
    // the real Overlay renders nothing while `open` is false (app/ui.jsx) — a stub that always rendered
    // its children would put the closed identity sheet's own paragraphs into the empty-state assertions
    Overlay: ({ open, children }) => (open ? children : null),
    ScreenScroll: ({ children }) => children,
    ChurchPill: () => null,
    UserAvatar: () => null,
    SectionLabel: ({ children }) => children,
    // …same for BottomSheet: the identity sheet is closed on this screen, and its paragraphs are not part
    // of the empty state a member is looking at
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c,
    relTime: () => 'now',
    // No sample groups: an empty church here means an EMPTY church, not the demo set.
    D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast: () => {},
    church: { npub: 'npub1church', name: 'St Aidan’s', id: 'c1' },
    // an admitted member of a church whose state has arrived — anything else and the screen shows a spinner
    // or a join prompt instead of the room list
    joinState: { loaded: true, isPending: false, removed: false, offline: false, unknown: false },
    myLeaderGroups: [], churchEvents: [], myPubkey: 'mehex',
    // `isMinor` is what the church published about this account; the screen ALSO asks Fellowship.assumeMinor,
    // and both are set together here because in life they agree.
    safeguard: { isMinor, clearanceKnown: true },
    openPeople: () => {}, openDM: () => {}, openDMInbox: () => {}, openGroup: () => {},
  };
  const render = () => draw(mod.ChatScreen, { ctx });
  render();          // first pass: the effects deliver the church's group list
  return render;
}

// The list's empty state — the paragraph under the "No groups yet" heading. Read out of the tree.
function emptyState(tree) {
  const ps = find(tree, n => n.type === 'p').map(n => texts(n).join(' '));
  return ps.join(' | ');
}

test('CONTROL: a church WITH child-safe rooms shows the young person their rooms, not an empty state', () => {
  // If this fails, every assertion below is about a screen that never renders a list at all.
  const draw = chatList({ rooms: [ADULT_ROOM, KIDS_ROOM], isMinor: true });
  const tree = draw();
  assert.equal(emptyState(tree), '', 'the room list is empty even when a child-safe room exists — re-anchor');
  const shown = texts(tree).join(' | ');
  assert.match(shown, /Youth/, 'the child-safe room is not on the screen');
  assert.doesNotMatch(shown, /Whole Church/,
    'the adults-only room is on a child’s screen — this is the safeguarding filter itself, and it is broken');
});

test('a young person whose church has rooms is NOT told the church has none', () => {
  const draw = chatList({ rooms: [ADULT_ROOM], isMinor: true });
  const shown = emptyState(draw());
  assert.notEqual(shown, '', 'the list renders no empty state at all — the screen is simply blank for them');
  assert.doesNotMatch(shown, /hasn’t opened any chat rooms|opened any chat rooms/,
    'a young person was told their church has not opened any chat rooms. It has — they are on the relay, ' +
    'the child-safe filter removed them. The sentence reads as the app being broken or as being shut out');
  assert.doesNotMatch(shown, /St Aidan’s/,
    'the empty state still names the church as the party that has not done something');
});

test('…and it points them at what they CAN do, without implying anyone is at fault', () => {
  const shown = emptyState(chatList({ rooms: [ADULT_ROOM], isMinor: true })());
  assert.match(shown, /message people at your church directly|message .* directly/i,
    'nothing tells them direct messages are still open to them — the People button is right above this');
  // The owner was explicit: do not send them to a leader, that implies a fault. And nothing may suggest a
  // setting is wrong or that they have been excluded.
  assert.doesNotMatch(shown, /leader|steward|permission|not allowed|restricted|blocked|settings?/i,
    'the empty state reads as a fault to be reported or as exclusion. A church may legitimately give its ' +
    'children direct messages and no group rooms; this has to read as ordinary');
});

test('an adult in a church that really has no rooms still gets the true sentence', () => {
  const shown = emptyState(chatList({ rooms: [], isMinor: false })());
  assert.match(shown, /hasn’t opened any chat rooms/,
    'the original — and correct — empty state was traded away for the child wording');
  assert.match(shown, /St Aidan’s/, 'it no longer names the church');
});

test('a young person in a church that really has no rooms gets that same true sentence', () => {
  // Nothing was filtered here, so nothing was hidden from them, so there is nothing to soften.
  const shown = emptyState(chatList({ rooms: [], isMinor: true })());
  assert.match(shown, /hasn’t opened any chat rooms/,
    'the child wording is being shown whenever a minor’s list is empty, including when it is empty for the ' +
    'ordinary reason — which tells them rooms exist that they cannot see when none do');
});
