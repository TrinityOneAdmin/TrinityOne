// CROSS-REFERENCE SHEET — tapping a row navigates, tapping its share button shares.
// Run: node --test scripts/cross-reference-sheet-shares-and-navigates.test.mjs
//
// Rule 1: test at the point of USE — the CrossRefSheet component in screens-read.jsx.
// Rule 3: no text matching against app/*.jsx; the component is loaded through loadScreen and rendered
// through miniReact, so it runs the real compiled code.
//
// What this covers:
//   · Tapping a cross-reference row calls gotoRef with the parsed book/chap/verse
//   · Tapping the share button on a row calls openShareSheet with { ref, text, version }
//   · The share button tap does NOT trigger the row's onClick (stopPropagation)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, find, button } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ENGINE = readFileSync(ROOT + 'engine.js', 'utf8');

// ── lift engine.js's own parseRef with its book tables ──
const realParseRef = (() => {
  const preamble = ENGINE.slice(ENGINE.indexOf('const BOOK_NAMES = ['), ENGINE.indexOf('function parseRef(str){'));
  const src = preamble + fnBody(ENGINE, 'function parseRef(str){') + '\nreturn parseRef;';
  return new Function(src)();
})();

// Seed data: two cross-references for John 1:1 (verse index 1)
const SEED_REFS = [
  { ref: 'Genesis 1:1', text: 'In the beginning God created the heavens and the earth.' },
  { ref: 'Proverbs 8:22', text: 'The LORD possessed me at the beginning of His work.' },
];

function renderSheet() {
  const gotoCalls = [];
  const shareCalls = [];
  const closeCalls = [];
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = {
    Bible: { parseRef: realParseRef },
    TrinityData: { CROSSREFS: { 1: SEED_REFS } },
  };
  const globals = {
    React, window: win,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' },
    setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams,
    SpeechSynthesisUtterance: class {},
    Icon, cx: (...a) => a.filter(Boolean).join(' '),
    lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', {}, children) : null),
    IconBtn: ({ name, onClick }) => React.createElement('button', { onClick, 'aria-label': name }),
    Overlay: () => null, Sheet: () => null, Modal: () => null, Pill: () => null, Row: () => null,
    Halo: () => null, SectionLabel: () => null, ReadPlansTabs: () => null,
  };
  const { CrossRefSheet } = loadScreen('app/screens-read.jsx', ['CrossRefSheet'], globals);
  const ctx = {
    gotoRef: (book, chap, verse) => gotoCalls.push({ book, chap, verse }),
    openShareSheet: (payload) => shareCalls.push(payload),
    version: 'BSB',
    toast: () => {},
  };
  const onClose = () => closeCalls.push(true);
  const props = { loc: { book: 43, chap: 1 }, v: 1, label: 'John 1:1', open: true, onClose, ctx };
  const tree = draw(CrossRefSheet, props);
  return { tree, gotoCalls, shareCalls, closeCalls };
}

test('tapping a cross-reference row calls gotoRef with the parsed reference', () => {
  const { tree, gotoCalls, closeCalls } = renderSheet();
  // Find rows — they are divs with an onClick and padding (the row container), not buttons
  const rows = find(tree, n => n.type === 'div' && n.props && n.props.onClick && n.props.style && n.props.style.padding === '14px 0');
  assert.ok(rows.length >= 2, `expected at least 2 cross-reference rows but found ${rows.length}`);
  // Tap the first row (Genesis 1:1)
  rows[0].props.onClick();
  assert.deepEqual(gotoCalls, [{ book: 1, chap: 1, verse: 1 }],
    'tapping "Genesis 1:1" did not call gotoRef(1, 1, 1)');
  assert.ok(closeCalls.length >= 1, 'tapping a row did not close the sheet');
});

test('tapping the share button calls openShareSheet with ref, text and version', () => {
  const { tree, shareCalls } = renderSheet();
  // The share buttons have aria-label "Share <ref>"
  const shareBtn = button(tree, 'Share Genesis 1:1');
  assert.ok(shareBtn.length >= 1, 'no share button found for Genesis 1:1');
  // The button's onClick expects an event with stopPropagation
  const stopped = [];
  shareBtn[0].props.onClick({ stopPropagation: () => stopped.push(true) });
  assert.equal(shareCalls.length, 1, 'openShareSheet was not called');
  assert.deepEqual(shareCalls[0], {
    ref: 'Genesis 1:1',
    text: 'In the beginning God created the heavens and the earth.',
    // 'KJV' DELIBERATELY, not ctx.version: e4951189 (audit F6, 2026-11-20) hardcoded the crossref share
    // payload's version because the seeded crossref TEXT is KJV whatever the reader reads in. ctx.version
    // stays 'BSB' above so this proves the payload ignores it.
    version: 'KJV',
  }, 'openShareSheet was called with wrong payload');
});

test('share button tap does NOT trigger the row onClick (stopPropagation)', () => {
  const { tree, gotoCalls, closeCalls } = renderSheet();
  const shareBtn = button(tree, 'Share Genesis 1:1');
  assert.ok(shareBtn.length >= 1, 'no share button found');
  shareBtn[0].props.onClick({ stopPropagation: () => {} });
  assert.deepEqual(gotoCalls, [], 'share button tap triggered gotoRef — stopPropagation is not working');
  assert.deepEqual(closeCalls, [], 'share button tap closed the sheet — stopPropagation is not working');
});

test('a second cross-reference row also navigates correctly', () => {
  const { tree, gotoCalls } = renderSheet();
  const rows = find(tree, n => n.type === 'div' && n.props && n.props.onClick && n.props.style && n.props.style.padding === '14px 0');
  assert.ok(rows.length >= 2, 'expected at least 2 rows');
  // Tap the second row (Proverbs 8:22)
  rows[1].props.onClick();
  assert.deepEqual(gotoCalls, [{ book: 20, chap: 8, verse: 22 }],
    'tapping "Proverbs 8:22" did not call gotoRef(20, 8, 22)');
});

test('share button for the second row sends the correct payload', () => {
  const { tree, shareCalls } = renderSheet();
  const shareBtn = button(tree, 'Share Proverbs 8:22');
  assert.ok(shareBtn.length >= 1, 'no share button found for Proverbs 8:22');
  shareBtn[0].props.onClick({ stopPropagation: () => {} });
  assert.equal(shareCalls.length, 1);
  assert.deepEqual(shareCalls[0], {
    ref: 'Proverbs 8:22',
    text: 'The LORD possessed me at the beginning of His work.',
    version: 'KJV',   // e4951189: seeded crossref text is KJV — see the note on the first payload test
  });
});
