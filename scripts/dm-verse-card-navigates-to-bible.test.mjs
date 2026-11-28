// DM VERSE CARD: TAP NAVIGATES TO BIBLE; REACTION BUTTON EXISTS.
// Run: node --test scripts/dm-verse-card-navigates-to-bible.test.mjs
//
// Point-of-use (CLAUDE.md rule 1): the REAL DMThread is loaded from app/screens-chat.jsx and DRAWN
// with a verse-card message. The test taps the card and verifies ctx.gotoRef was called — the
// feature is dead if that call never fires. Nothing here matches text in app/*.jsx (rule 3).
//
// Users of what changed (rule 2): ChatShareCardView's ctx.openShare is overridden in DMThread
// (line ~3057) to call ctx.gotoRef + onClose instead of opening share-as-image. A heart button is
// added below the card for reactions. No other caller of ChatShareCardView is affected — the group
// Bubble (line 1274) still passes the original ctx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const PEER = 'b'.repeat(64);
const ME = 'a'.repeat(64);

const VERSE_CARD = {
  type: 'verse', ref: 'John 3:16',
  text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
  version: 'KJV',
};
const CARD_BODY = '“' + VERSE_CARD.text + '” — ' + VERSE_CARD.ref + ' · ' + VERSE_CARD.version;

function dmWithVerseCard(opts = {}) {
  const { React, draw } = miniReact();
  const calls = { gotoRef: [], closed: 0 };
  const content = opts.thoughts ? CARD_BODY + '\n\n' + opts.thoughts : CARD_BODY;
  const msg = { id: 'm-verse', mine: false, pubkey: PEER, ts: 1760000000, content, card: VERSE_CARD };
  const F = {
    myPubkey: ME,
    relays: ['wss://relay.example'],
    ready: Promise.resolve(),
    subscribeThread: (_peer, add) => { add(msg); return () => {}; },
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
    window: {
      matchMedia: () => ({ matches: true }),
      Fellowship: F,
      addEventListener() {}, removeEventListener() {},
      Bible: { parseRef: (ref) => ref === 'John 3:16' ? { book: 43, chap: 3, verse: 16 } : null },
    },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-26',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ children }) => children, ScreenScroll: ({ children }) => children,
    ChurchPill: () => null, UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast() {}, canDMPeer: () => true, connTick: 0, openDM() {},
    gotoRef: (book, chap, verse) => calls.gotoRef.push({ book, chap, verse }),
  };
  const props = { peer: PEER, open: true, onClose: () => { calls.closed++; }, ctx, docked: false };
  const redraw = () => draw(mod.DMThread, props);
  redraw();
  return { redraw, calls };
}

const verseCards = (tree) => find(tree, n => n.props && n.props['data-chat-card'] === 'verse');
const heartBtns = (tree) => find(tree, n => n.type === 'button' && n.props && n.props.title === 'React');

test('tapping a verse card in a DM navigates to the Bible verse via gotoRef', () => {
  const { redraw, calls } = dmWithVerseCard();
  const tree = redraw();
  const cards = verseCards(tree);
  assert.ok(cards.length > 0, 'no verse card rendered in DM');
  cards[0].props.onClick({ stopPropagation() {} });
  assert.equal(calls.gotoRef.length, 1, 'gotoRef was not called');
  assert.deepStrictEqual(calls.gotoRef[0], { book: 43, chap: 3, verse: 16 });
  assert.equal(calls.closed, 1, 'onClose was not called — the DM should close after navigating');
});

test('a reaction heart button appears below the verse card in a DM', () => {
  const { redraw } = dmWithVerseCard();
  const tree = redraw();
  const hearts = heartBtns(tree);
  assert.ok(hearts.length > 0, 'no reaction heart button found on the verse card in DM');
});

test('tapping the heart button toggles the reaction picker', () => {
  const { redraw } = dmWithVerseCard();
  let tree = redraw();
  const hearts = heartBtns(tree);
  assert.ok(hearts.length > 0, 'no heart button');
  hearts[0].props.onClick({ stopPropagation() {} });
  tree = redraw();
  const emojis = find(tree, n => n.type === 'button' && n.props && n.props.style && n.props.style.fontSize === 20 && n.props.style.lineHeight === 1);
  assert.ok(emojis.length >= 6, 'reaction picker did not appear; found ' + emojis.length + ' emoji buttons');
  const pickerContainer = find(tree, n => n.type === 'div' && n.props && n.props.style && n.props.style.position === 'absolute' && n.props.style.bottom === 28 && n.props.style.zIndex === 10);
  assert.ok(pickerContainer.length > 0, 'reaction picker should float above (position: absolute) not inline');
});

test('verse card with thoughts: thoughts text renders below the card', () => {
  const { redraw } = dmWithVerseCard({ thoughts: 'What a beautiful verse!' });
  const tree = redraw();
  const cards = verseCards(tree);
  assert.ok(cards.length > 0, 'no verse card');
  const allText = texts(tree).join(' ');
  assert.ok(allText.includes('What a beautiful verse!'), 'thoughts text not rendered; got: ' + allText.slice(0, 200));
});
