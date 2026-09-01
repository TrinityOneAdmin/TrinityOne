// A MEMBER CAN TELL A BROADCAST ROOM APART BEFORE THEY TAP IT, AND IS TOLD WHY ONCE THEY HAVE.
// Run: node --test scripts/a-broadcast-room-says-what-it-is.test.mjs
//
// The only thing marking a broadcast room in the Community list was a small pill reading "Broadcast". That
// is jargon: it names the mechanism, not the thing. It does not tell a churchwarden the one fact they need
// before they tap — that there will be no message box in there — and there was no other cue in the row at
// all, so the room was indistinguishable at a glance from every conversation above and below it. Inside,
// `isBroadcast` hid the composer, and the sentence that replaced it also led with the jargon.
//
// So a member tapped into the one room every church has, found nowhere to type, and the screen offered no
// account of itself. The reading available to them is "this is broken", or "I have done something wrong",
// or "I am being kept out" — and the last of those is the one least likely to be asked about out loud.
//
// WHAT THIS IS NOT. It is not a restriction notice. A broadcast room is the church speaking to everyone,
// which is a normal and useful thing for a church to have, and the wording must read as an account of what
// the room is rather than as something being withheld. And it changes nobody's permission: who may post is
// the relay's decision (BROADCAST in scripts/gateway.mjs) and it is correct. This file asserts the wording
// is calm as well as present, because "make it obvious" is easy to satisfy with a warning nobody wants.
//
// USERS OF THE FIELD THE CUES ARE BUILT ON (CLAUDE.md rule 2). `kind` is deliberately left as it was, and a
// label and a boolean added beside it, because three things read `kind` and would break if it changed:
//   app/screens-chat.jsx  groupHits   the search filter matches g.kind, so "broadcast" still finds the room
//   app/screens-chat.jsx  isBroadcast the room-level check
//   app/screens-chat.jsx  postable    the share sheet's case-insensitive exclusion
// The first and second are asserted below; the third excludes broadcasts by the same lowercased `kind` it
// always did and is untouched.
//
// HOW IT ASSERTS. CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves
// every word of it in place and a text-matching assertion still passes. Nothing here matches text in
// app/*.jsx. ChatScreen and ChatRoom are compiled with the build's own esbuild and rendered through the
// miniature React in scripts/render-jsx-screen.mjs, and every assertion reads the tree that came back. Icon
// is stubbed as an element carrying its own name, so "a distinct icon" is a fact about the tree rather than
// about the source.
//
// Measured red/green at the foot of this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const CAST = { id: 'g1', name: 'Notices', kind: 'broadcast', visibility: 'open', childsafe: true, sub: 'Dates, news and what’s on' };
const ROOM = { id: 'g2', name: 'Whole Church', kind: 'group', visibility: 'open', childsafe: true, sub: 'One room for everyone, and everyone can post' };

// Icon stubbed as a real node carrying its name, so the tree records which icon a row drew.
const iconStub = (React) => ({ name }) => React.createElement('i', { 'data-icon': name });
const iconsIn = (n) => find(n, x => x.type === 'i' && x.props['data-icon']).map(x => x.props['data-icon']);

// ── the Community list ────────────────────────────────────────────────────────────────────────────────────
function chatList({ rooms = [ROOM, CAST], q = '' } = {}) {
  const { React, draw } = miniReact();
  const win = {
    Fellowship: {
      myPubkey: 'mehex',
      relays: ['wss://relay.example'],
      subscribeChurchGroups: (_np, cb) => { cb(rooms); return () => {}; },
      subscribeChurchCategories: (_np, cb) => { cb([]); return () => {}; },
      subscribeGroups: () => () => {},
      displayFor: () => ({ handle: 'sam', color: '#888' }),
      assumeMinor: async () => false,
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
    todayISO: () => '2026-09-01',
    Icon: iconStub(React),
    // the real IconBtn forwards its click and prefers an explicit title; a stub that dropped either
    // would make every control on the screen unreachable and unnameable
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ open, children }) => (open ? children : null),
    ScreenScroll: ({ children }) => children,
    ChurchPill: () => null,
    UserAvatar: () => null,
    SectionLabel: ({ children }) => children,
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c,
    relTime: () => 'now',
    D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast: () => {},
    church: { npub: 'npub1church', name: 'St Aidan’s', id: 'c1' },
    joinState: { loaded: true, isPending: false, removed: false, offline: false, unknown: false },
    myLeaderGroups: [], churchEvents: [], myPubkey: 'mehex',
    safeguard: { isMinor: false, clearanceKnown: true },
    openPeople: () => {}, openDM: () => {}, openDMInbox: () => {}, openGroup: () => {},
  };
  const render = () => draw(mod.ChatScreen, { ctx });
  render();                 // the church's group list arrives through an effect, so the FIRST draw is empty
  let tree = render();
  if (q) {
    // open the search box and type, so the search-results branch is the one under test
    const open = find(tree, n => n.type === 'button' && n.props.title === 'Search');
    assert.ok(open.length, 'the search control is gone from the Community screen — re-anchor');
    open[0].props.onClick();
    tree = render();
    const box = find(tree, n => n.type === 'input' && /Search/i.test(String(n.props.placeholder || '')))[0];
    assert.ok(box, 'the search input is gone — re-anchor');
    box.props.onChange({ target: { value: q } });
    tree = render();
  }
  return tree;
}

// The card for one room, located by the room's own name in a clickable row.
function card(tree, name) {
  const rows = find(tree, n => n.props && n.props.role === 'button' && n.props.onClick && texts(n).some(t => t === name));
  assert.equal(rows.length, 1, `expected exactly one row for "${name}", found ${rows.length} — re-anchor this test`);
  return rows[0];
}
const said = (n) => texts(n).join(' | ');
// The strings one row shows that the other does not. Asserting on a row's whole text is not enough: wording
// applied to EVERY row reads as a cue and distinguishes nothing, and a whole-row assertion passes over it
// happily. (Measured: giving Group and Team the broadcast's own label was the one sabotage of nine that this
// file failed to catch until the assertions moved onto this set.)
const onlyOn = (a, b) => { const other = new Set(texts(b)); return texts(a).filter(t => !other.has(t)); };

test('CONTROL: both rooms render as rows in the member’s list', () => {
  // If this fails, every assertion below is about a screen with nothing on it.
  const tree = chatList();
  assert.ok(card(tree, 'Notices'), 'the broadcast room is not in the list');
  assert.ok(card(tree, 'Whole Church'), 'the ordinary room is not in the list');
});

test('the broadcast row says WHO SPEAKS there, in words, not "Broadcast"', () => {
  const tree = chatList();
  const castRow = card(tree, 'Notices'), roomRow = card(tree, 'Whole Church');
  assert.doesNotMatch(said(castRow), /\bBroadcast\b/,
    'the row still leads with the word "Broadcast". It names the mechanism, not the thing, and tells a ' +
    'churchwarden nothing about what will happen when they tap it');
  // asserted on what this row says AND THE OTHER ONE DOES NOT, so a phrase given to every room fails here
  assert.ok(onlyOn(castRow, roomRow).some(t => /your church/i.test(t)),
    'nothing that is unique to the broadcast row says whose voice this room is. Either there is no cue at ' +
    'all, or the same wording is on every row — and wording on every row distinguishes nothing');
});

test('…and the ordinary room does NOT, so the two rows actually differ', () => {
  const tree = chatList();
  const castRow = card(tree, 'Notices'), roomRow = card(tree, 'Whole Church');
  assert.ok(onlyOn(castRow, roomRow).length,
    'the broadcast row shows nothing the ordinary room row does not');
  assert.equal(onlyOn(roomRow, castRow).filter(t => /your church/i.test(t)).length, 0,
    'an ordinary conversation is described in the broadcast room’s words — the opposite of true, and it ' +
    'makes the two rooms indistinguishable in the one line meant to tell them apart');
});

test('the broadcast row carries a different icon from a conversation', () => {
  // Wording alone is a line of small grey text. The row's one large graphic must differ too, or the two
  // rooms still look the same at arm's length.
  const tree = chatList();
  const cast = iconsIn(card(tree, 'Notices'));
  const room = iconsIn(card(tree, 'Whole Church'));
  assert.ok(cast.length && room.length, 'a room row draws no icon at all — re-anchor this test');
  assert.notDeepEqual(cast, room,
    'the broadcast room and the ordinary room draw the same icon, so the only difference between them is ' +
    'a line of small grey text');
});

test('the wording is an account of the room, not a warning or a refusal', () => {
  // The owner's register: this should read as "the church speaking to everyone", never as suspicion of the
  // member or as something being withheld from them. A cue that lands as a restriction is a worse outcome
  // than the jargon it replaced.
  const cast = said(card(chatList(), 'Notices'));
  assert.doesNotMatch(cast, /can(no|')?t|not allowed|read.?only|restricted|blocked|denied|permission|no posting|locked/i,
    'the broadcast room is described to a member in the language of refusal: ' + cast);
});

test('a member searching for "broadcast" still finds the room — `kind` was not repurposed', () => {
  // The search filter matches on g.kind. The cue was added ALONGSIDE it rather than replacing it, precisely
  // so this kept working; if kind had been overwritten with the new wording this would go quiet.
  const tree = chatList({ q: 'broadcast' });
  assert.match(texts(tree).join(' | '), /Notices/,
    'searching "broadcast" no longer finds the church’s broadcast room — kind was repurposed rather than ' +
    'added to, and the search filter reads kind');
});

// ── inside the room ───────────────────────────────────────────────────────────────────────────────────────
function memberRoom(group, { leader = false } = {}) {
  const { React, draw } = miniReact();
  const Fellowship = {
    myPubkey: 'mehex', relays: ['wss://relay.example'], relayReady: () => true,
    groupEncState: () => 'clear',
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
    todayISO: () => '2026-09-01',
    Icon: iconStub(React),
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
    myLeaderGroups: leader ? [{ id: group.id }] : [],
    churchEvents: [], safeguard: {}, myPubkey: 'mehex', openDM: () => {},
    joinState: { loaded: true, isPending: false, removed: false, offline: false },
  };
  return draw(mod.ChatRoom, { group, open: true, onClose: () => {}, ctx, docked: true });
}

// the room list's own mapping, mirrored: this is the shape ChatRoom is handed in life
const asListed = (g) => ({ id: g.id, name: g.name, sub: g.sub, accent: '#888',
  kind: g.kind === 'broadcast' ? 'Broadcast' : g.kind === 'team' ? 'Team' : 'Group',
  broadcast: g.kind === 'broadcast', team: g.kind === 'team', prayer: /prayer/i.test(g.name || '') });

const note = (tree) => find(tree, n => n.props && n.props.role === 'note').map(n => texts(n).join(' ')).join(' | ');

test('inside a broadcast room the screen SAYS who posts here — the composer is not an explanation', () => {
  const tree = memberRoom(asListed(CAST));
  assert.equal(find(tree, n => n.type === 'textarea').length, 0,
    'a member is offered a message box in a broadcast room — re-anchor this test, the premise has changed');
  const line = note(tree);
  assert.notEqual(line, '',
    'the room hides the composer and says nothing. A member taps in, finds nowhere to type, and is left to ' +
    'decide for themselves whether the app is broken or they are being kept out');
  assert.match(line, /your church/i, 'the line does not say whose voice this room is: ' + line);
  assert.doesNotMatch(line, /can(no|’)?t|not allowed|read.?only|restricted|blocked|denied|permission/i,
    'the room greets a member with the language of refusal: ' + line);
});

test('…and a LEADER, who can post here, is told the same thing', () => {
  // Someone posting in this room posts as the whole church, which is worth knowing before you type. The
  // composer-replacement line never reached them, because it only renders where the composer is hidden.
  const tree = memberRoom(asListed(CAST), { leader: true });
  assert.ok(find(tree, n => n.type === 'textarea').length,
    'a leader has no composer in a broadcast room — re-anchor this test');
  assert.notEqual(note(tree), '',
    'a leader gets no indication at all that what they type here goes out as the church to everyone');
});

test('an ordinary conversation carries none of it', () => {
  const tree = memberRoom(asListed(ROOM));
  assert.equal(note(tree), '', 'an ordinary room is being labelled as one only the church posts in');
  assert.ok(find(tree, n => n.type === 'textarea').length, 'an ordinary room has no composer — re-anchor');
});

test('a room reached without the list’s mapping is still treated as a broadcast', () => {
  // `broadcast` is carried by the room-list map. A room opened by any other route (a shared link, a cached
  // list from an older build) arrives with `kind` only, and the old string check is kept as the fallback so
  // the composer can never quietly reappear in a room the relay will refuse every send to.
  const tree = memberRoom({ id: 'g1', name: 'Notices', kind: 'Broadcast', accent: '#888' });
  assert.equal(find(tree, n => n.type === 'textarea').length, 0,
    'a broadcast room carrying only the old `kind` string now offers a composer. Every message written in ' +
    'it is refused by the relay and lost, against a screen that invited it');
  assert.notEqual(note(tree), '', 'that room is also given no explanation');
});

// ── measured red/green, 2026-09-01, this file against app/screens-chat.jsx ───────────────────────────────
//
// Each sabotage was applied inside a slice of the code that owns the thing under test — ChatScreen, ChatRoom
// or the module-level label helper — with its anchor asserted to occur exactly once in that slice first
// (CLAUDE.md "sabotage must be scoped"). This file has near-identical sibling rows in the list, the search
// results and the share sheet, so a plain string-replace hits the wrong one and a mis-aimed sabotage reports
// exactly what a blind test reports.
//
//   · the fixed screen                                                    10 pass / 0 fail
//   · the list pill put back to the word "Broadcast"                       9 pass / 1 fail
//   · the row rendering g.kind again instead of the label                  9 pass / 1 fail
//   · the broadcast icon undifferentiated (same icon as a conversation)    9 pass / 1 fail
//   · the `broadcast` flag not carried through the room-list map           9 pass / 1 fail
//   · the in-room line deleted with `null && isBroadcast ? (…)`, which
//     leaves every word of it in the file                                  7 pass / 3 fail
//        (a source-text assertion would have stayed green — CLAUDE.md rule 3)
//   · the in-room line reworded as a refusal ("You are not allowed…")      9 pass / 1 fail
//   · `kind` repurposed to hold the new wording instead of adding to it    9 pass / 1 fail
//        (caught by search, which matches on kind)
//   · isBroadcast's `kind === 'Broadcast'` fallback removed                9 pass / 1 fail
//   · the broadcast's label given to Group and Team as well, so the cue
//     sits on every row and distinguishes nothing                          9 pass / 1 fail
//
// That last one was BLIND on the first pass — the assertions read each row's whole text, which a phrase
// applied to every row satisfies. They now read `onlyOn(a, b)`, the strings one row shows that the other
// does not. No sabotage above goes uncaught.
