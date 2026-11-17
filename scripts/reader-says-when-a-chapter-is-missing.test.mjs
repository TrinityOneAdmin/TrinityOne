// THE READER MUST SAY SO WHEN THE ACTIVE BIBLE HAS THE BOOK BUT NOT THE CHAPTER — AND "READ IT NOW" MUST LAND ON TEXT.
// Run: node --test scripts/reader-says-when-a-chapter-is-missing.test.mjs
//
// Audit of c0421cca, F1. A member installs a partial Bible (a draft, a portion, a USFM whose chapters start at 2), taps
// "Read it now", and the reader stays on the place they were at: John 1. The new Bible has John, but only chapter 2, so
// the reader showed "John · Chapter 1" with NO text, NO message and NO button. The empty-state test only covered a missing
// BOOK. Reproduced in Chromium by the auditor (books:[43], ch1:0, ch2:2).
//
// These drive the REAL engine.js (in the install harness, a real USFM file installed through installFromBytes), the REAL
// ReadScreen (app/screens-read.jsx, compiled and rendered through the miniature React) and the REAL InstallFromFileSheet
// (app/install-bible.jsx). Nothing here matches text in app/*.jsx (CLAUDE.md rule 3): the screens are run and what they
// draw is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyPhone } from './install-bible-harness.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const usfm = (id, chapters) => new TextEncoder().encode(`\\id ${id} Draft\n` + chapters.map(([c, t]) => `\\c ${c}\n\\p\n\\v 1 ${t}\n`).join(''));
const JOHN = 43, THREE_JOHN = 64;

async function withBible(bytes, hint) {
  const p = await readyPhone();
  const r = await p.Bible.installFromBytes(bytes, hint);
  assert.equal(r.ok, true, JSON.stringify(r));
  return { p, abbr: r.abbr, Bible: p.Bible };
}

function reader(Bible, version, loc) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = { Bible, speechSynthesis: null, innerWidth: 360, sanitizeHtml: h => h, getSelection: () => ({ toString: () => '' }), TrinityData: { CROSSREFS: {} } };
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' },
    setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams, SpeechSynthesisUtterance: class {},
    Icon, cx: (...a) => a.filter(Boolean).join(' '), lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'), BottomSheet: Stub('BottomSheet'), useBackLayer: () => {},
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'), IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
  };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], globals);
  const went = [];
  const ctx = { loc, version, setLoc: l => went.push(l), toast() {}, highlights: {}, notes: {}, bookmarks: [], toggleBookmark() {}, setHighlight() {}, setNote() {},
    openShareSheet() {}, desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {} };
  const tree = draw(ReadScreen, { ctx });
  return { tree, went, said: texts(tree).join(' | ') };
}
const goButtons = (tree) => find(tree, n => n.type === 'button' && /^Go to /.test(texts(n).join('').trim()));

test('F1-1 — the Bible has John but only chapter 2; the reader on John 1 SAYS the chapter is not there and offers John 2', async () => {
  const { abbr, Bible } = await withBible(usfm('JHN', [[2, 'The third day there was a wedding']]), 'john-draft.usfm');
  const r = reader(Bible, abbr, { book: JOHN, chap: 1 });
  assert.match(r.said, new RegExp(`John 1 isn't in ${abbr}`), 'a blank reader: nothing says that this chapter is not in the Bible. Drew: ' + r.said);
  const b = goButtons(r.tree);
  assert.equal(b.length, 1, 'no button to the chapter this Bible has');
  assert.match(texts(b[0]).join(''), /Go to John 2/);
  b[0].props.onClick();
  assert.deepEqual(r.went, [{ book: JOHN, chap: 2 }], 'the button did not move the reader to the first chapter the Bible has');
});

test('F1-2 — control: on the chapter the Bible HAS, the reader shows the text and no "isn\'t in" message', async () => {
  const { abbr, Bible } = await withBible(usfm('JHN', [[2, 'The third day there was a wedding']]), 'john-draft.usfm');
  const r = reader(Bible, abbr, { book: JOHN, chap: 2 });
  assert.doesNotMatch(r.said, /isn't in/);
  assert.match(r.said, /wedding/, 'the chapter the Bible has is not shown');
});

test('F1-3 — a Bible without the BOOK still says so (the existing message is kept) and offers its first chapter', async () => {
  const { abbr, Bible } = await withBible(usfm('3JN', [[1, 'The elder to Gaius']]), '3john.usfm');
  const r = reader(Bible, abbr, { book: JOHN, chap: 1 });
  assert.match(r.said, new RegExp(`John isn't in ${abbr}`));
  assert.doesNotMatch(r.said, /John 1 isn't in/, 'the whole book is missing: the message must name the book, not a chapter');
  const b = goButtons(r.tree);
  assert.equal(b.length, 1);
  assert.match(texts(b[0]).join(''), /Go to 3 John 1/);
});

// ── "Read it now" ──
async function readItNow(Bible, abbr, here) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = { Bible };
  const mod = loadScreen('app/install-bible.jsx', ['InstallFromFileSheet'], {
    React, window: win, Icon, localStorage: { getItem: () => null, setItem() {} },
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', {}, children) : null),
    Spinner: () => null, fetch: async () => { throw new Error('no fetch'); },
  });
  const went = [], tabs = [];
  const ctx = { loc: here, setLoc: l => went.push(l), go: t => tabs.push(t), closeStore() {}, openStore() {} };
  const tree = draw(mod.InstallFromFileSheet, { state: { phase: 'result', result: { ok: true, kind: 'bible', abbr, name: 'Draft' } }, onInstall() {}, onClose() {}, ctx });
  const btn = find(tree, n => n.type === 'button' && texts(n).join('').includes('Read it now'));
  assert.equal(btn.length, 1, 'no "Read it now" button on the result sheet: ' + texts(tree).join(' | '));
  btn[0].props.onClick();
  return { went, tabs, active: Bible.activeVersion };
}

test('F1-4 — "Read it now" on a Bible that lacks the reader\'s chapter moves the reader to the first chapter it HAS', async () => {
  const { abbr, Bible } = await withBible(usfm('JHN', [[2, 'The third day there was a wedding']]), 'john-draft.usfm');
  const r = await readItNow(Bible, abbr, { book: JOHN, chap: 1 });
  assert.equal(r.active, abbr, 'the new Bible was not made active');
  assert.deepEqual(r.went, [{ book: JOHN, chap: 2 }], 'the reader was left on a chapter the new Bible does not have');
  assert.deepEqual(r.tabs, ['read']);
});

test('F1-5 — "Read it now" on a Bible with a DIFFERENT book moves the reader to that Bible\'s first book and chapter', async () => {
  const { abbr, Bible } = await withBible(usfm('3JN', [[1, 'The elder to Gaius']]), '3john.usfm');
  const r = await readItNow(Bible, abbr, { book: JOHN, chap: 3 });
  assert.deepEqual(r.went, [{ book: THREE_JOHN, chap: 1 }]);
});

test('F1-6 — "Read it now" leaves the reader where it is when the new Bible has text there', async () => {
  const { abbr, Bible } = await withBible(usfm('JHN', [[1, 'In the beginning was the Word'], [2, 'wedding']]), 'john.usfm');
  const r = await readItNow(Bible, abbr, { book: JOHN, chap: 2 });
  assert.deepEqual(r.went, [], 'the reader was moved off a passage the new Bible has');
  assert.equal(r.active, abbr);
});
