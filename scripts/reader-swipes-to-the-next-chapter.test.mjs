// SWIPE THE SCRIPTURE TO TURN THE CHAPTER — AND ONLY WHEN IT IS REALLY A SWIPE.
// Run: node --test scripts/reader-swipes-to-the-next-chapter.test.mjs
//
// The owner asked for what MySword does: drag left for the next chapter, right for the previous. The whole
// risk in that is the OTHER gestures the same surface already carries. Reading is vertical, so the reader is
// a scrolling column; a verse is tappable, selectable and long-pressable so it can be copied or shared; and
// the page pinch-zooms. A swipe handler that is even slightly greedy takes one of those away, and every one
// of them is a thing a member does far more often than turning a page.
//
// So the assertions below are mostly NEGATIVE, and the one that matters most is "a vertical drag changes
// nothing". They drive the REAL ReadScreen: app/screens-read.jsx is compiled with the same esbuild the build
// uses and rendered through the miniature React in scripts/render-jsx-screen.mjs, then the touch sequences are
// handed to the handlers the screen actually put on the element the scripture is drawn in. CLAUDE.md rule 3 —
// app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves every word of it in place and a
// text-matching assertion still passes. Nothing here matches text in app/*.jsx.
//
// The strongest assertion in the file is `a swipe and the footer button cannot diverge`: the chapter a swipe
// lands on is compared against the chapter the screen's own "next" BUTTON lands on, pressed in the same
// render. There is deliberately no second copy of the navigation to go stale.
//
// ENDS OF THE BIBLE — the decision, stated. Bible.step() (engine.js:660) already rolls into the neighbouring
// BOOK, and the swipe reuses it, so John 21 -> the next book chapter 1 exactly as the footer button does.
// step() returns null only at the two true ends, and there the swipe raises a toast rather than doing nothing
// silently. Both are asserted here.
//
// MEASURED RED/GREEN, 2026-09-01. Each sabotage is a SCOPED slice of ReadScreen — the enclosing function is
// cut out, the anchor asserted to appear exactly once inside it, and only then replaced (CLAUDE.md):
//   · with the swipe                                     14 pass /  0 fail
//   · the four handlers removed from the scroll container 0 pass / 14 fail
//   · the DOMINANCE half of the test deleted, distance kept
//                                                        12 pass /  2 fail — both vertical-drag tests
//   · the multi-touch guards deleted                     13 pass /  1 fail — the pinch-zoom test, alone
//
// WHAT THIS FILE DOES NOT PROVE. It drives the handlers the screen exposes; it does not run a WebView, so it
// cannot show that Android delivers those touches, that a click is really suppressed after a 60px drag, or
// that a long-press still selects. Those are for a device (CLAUDE.md rule 6) and have not been done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// A three-book Bible, so "rolls into the next book" and "the very end" are both a couple of steps away.
// step() here is engine.js's algorithm; nothing in this file asserts that ALGORITHM is right — what it
// asserts is that the swipe and the button reach for the same one.
const BOOKS = [1, 43, 66];
const MAXCH = { 1: 50, 43: 21, 66: 22 };
const NAME = { 1: 'Genesis', 43: 'John', 66: 'Revelation' };

function reader({ loc = { book: 43, chap: 3 }, selection = '' } = {}) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const Bible = {
    loaded: true, activeVersion: 'WEB',
    books: () => BOOKS, maxChapter: b => MAXCH[b], bookName: b => NAME[b],
    versions: () => [{ abbr: 'WEB' }],
    getVerses: () => [{ v: 1, text: 'In the beginning', html: 'In the beginning' }],
    bookMeta: () => BOOKS.map(n => ({ num: n, name: NAME[n], abbr: NAME[n].slice(0, 3), group: 'g', ch: MAXCH[n] })),
    getCommentary: () => [], commentaryList: () => [], searchDict: () => [], subscribe: () => () => {},
    defaultLoc: () => ({ book: 43, chap: 1 }),
    refLabel: (l, v) => NAME[l.book] + ' ' + l.chap + (v != null ? ':' + v : ''),
    refKey: (l, v) => l.book + '.' + l.chap + '.' + v,
    step(at, dir) {
      const idx = BOOKS.indexOf(at.book); let { book, chap } = at;
      if (dir > 0) { if (chap < MAXCH[book]) chap++; else if (idx < BOOKS.length - 1) { book = BOOKS[idx + 1]; chap = 1; } else return null; }
      else { if (chap > 1) chap--; else if (idx > 0) { book = BOOKS[idx - 1]; chap = MAXCH[BOOKS[idx - 1]]; } else return null; }
      return { book, chap };
    },
  };
  // Everything ReadScreen takes from OUTSIDE its own file. A name it needs that is not here is a
  // ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends
  // up asserting about something that is not the code.
  const win = {
    Bible, speechSynthesis: null, innerWidth: 360, sanitizeHtml: h => h,
    getSelection: () => ({ toString: () => selection }),
    TrinityData: { CROSSREFS: {} },
  };
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' },
    setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams,
    SpeechSynthesisUtterance: class {},
    Icon, cx: (...a) => a.filter(Boolean).join(' '),
    lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'), BottomSheet: Stub('BottomSheet'),
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'),
    IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
  };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], globals);
  const went = [], said = [];
  const ctx = {
    loc, version: 'WEB', setLoc: l => went.push(l), toast: m => said.push(m),
    highlights: {}, notes: {}, bookmarks: [], toggleBookmark() {}, setHighlight() {}, setNote() {},
    openShareSheet() {}, desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {},
  };
  const tree = draw(ReadScreen, { ctx });

  // THE POINT OF USE: the element the scripture is drawn in. Found by looking for the rendered VerseRow
  // components inside it, not by looking for the handlers — so "the gesture is on some other div" fails here.
  const scrollers = find(tree, n => n.type === 'div' && n.props && n.props.className === 'no-scrollbar'
    && find(n, x => typeof x.type === 'function' && x.type.name === 'VerseRow').length > 0);
  assert.equal(scrollers.length, 1, 'could not find exactly one scrolling element containing the verses — re-anchor this test');
  return { tree, page: scrollers[0], went, said, Bible };
}

// One finger down, moved, lifted. Nothing here is invented: these are the three props the screen exposes.
function drag(page, { from = [300, 400], to, fingers = 1, extraFingerMidway = false } = {}) {
  const prevented = [];
  const ev = (touches, changedTouches) => ({ touches, changedTouches, preventDefault: () => prevented.push(1) });
  const pt = ([x, y]) => ({ clientX: x, clientY: y });
  const start = Array.from({ length: fingers }, (_, i) => pt([from[0] + i * 40, from[1]]));
  page.props.onTouchStart(ev(start, start));
  const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const moving = extraFingerMidway ? [pt(mid), pt([mid[0] + 60, mid[1]])] : [pt(mid)];
  page.props.onTouchMove(ev(moving, moving));
  page.props.onTouchEnd(ev([], [pt(to)]));
  return prevented.length;
}

// What the screen's OWN footer button does, pressed in the same render. Found by its rendered label.
function pressFooter(tree, label) {
  const btn = find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label)
    && String((n.props.style || {}).borderRadius) === '15');
  assert.equal(btn.length, 1, `expected exactly one footer chapter button labelled "${label}", found ${btn.length}`);
  btn[0].props.onClick();
}

test('the scripture itself carries the gesture', () => {
  const { page } = reader();
  for (const h of ['onTouchStart', 'onTouchMove', 'onTouchEnd']) {
    assert.equal(typeof page.props[h], 'function',
      `the reader's scrolling column has no ${h} — swiping to change chapter is not on the screen at all`);
  }
});

test('swiping LEFT goes to the next chapter', () => {
  const { page, went } = reader({ loc: { book: 43, chap: 3 } });
  drag(page, { to: [200, 410] });
  assert.deepEqual(went, [{ book: 43, chap: 4 }], 'a left swipe on John 3 did not open John 4');
});

test('swiping RIGHT goes to the previous chapter', () => {
  const { page, went } = reader({ loc: { book: 43, chap: 3 } });
  drag(page, { from: [80, 400], to: [200, 392] });
  assert.deepEqual(went, [{ book: 43, chap: 2 }], 'a right swipe on John 3 did not open John 2');
});

test('a swipe and the footer button CANNOT DIVERGE — both directions, in the same render', () => {
  // The reason to assert this rather than the chapter numbers alone: there is one navigation, and this is
  // what says so. Two copies of "what comes next" is exactly how a swipe and a button drift apart.
  for (const [dir, label, to] of [['next', 'John 4', [200, 410]], ['previous', 'John 2', null]]) {
    const a = reader({ loc: { book: 43, chap: 3 } });
    if (to) drag(a.page, { to }); else drag(a.page, { from: [80, 400], to: [200, 392] });
    const b = reader({ loc: { book: 43, chap: 3 } });
    pressFooter(b.tree, label);
    assert.deepEqual(a.went, b.went, `the ${dir} swipe and the ${dir} footer button went to different places`);
  }
});

test('a swipe rolls into the neighbouring book, exactly as the button does', () => {
  const a = reader({ loc: { book: 43, chap: 21 } });     // last chapter of John in this fixture
  drag(a.page, { to: [200, 410] });
  const b = reader({ loc: { book: 43, chap: 21 } });
  pressFooter(b.tree, 'Revelation 1');
  assert.deepEqual(a.went, [{ book: 66, chap: 1 }], 'a left swipe at the end of a book did not roll into the next one');
  assert.deepEqual(a.went, b.went, 'the swipe and the button disagreed about rolling into the next book');
});

// ── the negatives: everything the reader could already do, still doable ────────────────────────────────────

test('A VERTICAL DRAG CHANGES NOTHING — this is the regression that matters', () => {
  const clean = reader();
  drag(clean.page, { from: [300, 600], to: [310, 180] });   // straight down the page
  assert.deepEqual(clean.went, [], 'scrolling down the page changed the chapter');
  assert.deepEqual(clean.said, [], 'scrolling down the page produced a message');

  // The one that needs the DOMINANCE rule rather than the distance rule, and the one a real thumb produces:
  // a long scroll that also drifts 90px sideways — further across than the 60px a swipe needs. A handler
  // that only checked "did it travel far enough horizontally" would turn the page here, mid-scroll.
  const thumb = reader();
  drag(thumb.page, { from: [300, 640], to: [210, 200] });
  assert.deepEqual(thumb.went, [], 'a scroll that drifted 90px sideways changed the chapter mid-scroll');
  assert.deepEqual(thumb.said, [], 'a scroll that drifted 90px sideways produced a message');
});

test('a drag that is not CLEARLY horizontal changes nothing', () => {
  const { page, went } = reader();
  drag(page, { from: [300, 400], to: [230, 460] });   // 70 across, 60 down — long enough, not dominant enough
  assert.deepEqual(went, [], 'a diagonal drag during a scroll changed the chapter');
});

test('a short horizontal flick changes nothing', () => {
  const { page, went } = reader();
  drag(page, { from: [300, 400], to: [265, 402] });   // 35px — under the minimum
  assert.deepEqual(went, [], 'a 35px twitch changed the chapter');
});

test('PINCH-ZOOM IS UNTOUCHED — two fingers never turn a page', () => {
  const two = reader();
  drag(two.page, { from: [300, 400], to: [180, 400], fingers: 2 });
  assert.deepEqual(two.went, [], 'a two-finger gesture changed the chapter');
  const joined = reader();
  drag(joined.page, { from: [300, 400], to: [180, 400], extraFingerMidway: true });
  assert.deepEqual(joined.went, [], 'a second finger arriving mid-gesture still changed the chapter');
});

test('SELECTING A VERSE TO COPY IS NOT A SWIPE', () => {
  const { page, went } = reader({ selection: 'For God so loved the world' });
  drag(page, { to: [200, 410] });
  assert.deepEqual(went, [], 'dragging out a text selection to copy a verse turned the page instead');
});

test('nothing calls preventDefault, so the page scrolls exactly as before', () => {
  // The commonest way a swipe handler breaks reading is preventing the default on touchmove. Any of the
  // three doing it fails here.
  const { page } = reader();
  assert.equal(drag(page, { from: [300, 600], to: [310, 180] }), 0, 'a vertical drag had its default prevented — the page can no longer scroll');
  const b = reader();
  assert.equal(drag(b.page, { to: [200, 410] }), 0, 'a horizontal swipe prevented the default');
});

test('a cancelled touch is abandoned, not completed', () => {
  const { page, went } = reader();
  page.props.onTouchStart({ touches: [{ clientX: 300, clientY: 400 }], changedTouches: [], preventDefault() {} });
  page.props.onTouchCancel({ touches: [], changedTouches: [{ clientX: 200, clientY: 400 }], preventDefault() {} });
  page.props.onTouchEnd({ touches: [], changedTouches: [{ clientX: 200, clientY: 400 }], preventDefault() {} });
  assert.deepEqual(went, [], 'a touch the system cancelled (a call arriving, the app backgrounding) still turned the page');
});

// ── the two ends of the Bible ─────────────────────────────────────────────────────────────────────────────

test('at the very END, the swipe says so instead of doing nothing', () => {
  const { page, went, said } = reader({ loc: { book: 66, chap: 22 } });
  drag(page, { to: [200, 410] });
  assert.deepEqual(went, [], 'a left swipe past the last chapter navigated somewhere');
  assert.equal(said.length, 1, 'a left swipe past the last chapter did nothing at all, silently');
  assert.match(said[0], /last chapter/i, `the message at the end of the Bible reads "${said[0]}"`);
});

test('at the very BEGINNING, the swipe says so instead of doing nothing', () => {
  const { page, went, said } = reader({ loc: { book: 1, chap: 1 } });
  drag(page, { from: [80, 400], to: [200, 392] });
  assert.deepEqual(went, [], 'a right swipe before the first chapter navigated somewhere');
  assert.equal(said.length, 1, 'a right swipe before the first chapter did nothing at all, silently');
  assert.match(said[0], /beginning/i, `the message at the start of the Bible reads "${said[0]}"`);
});
