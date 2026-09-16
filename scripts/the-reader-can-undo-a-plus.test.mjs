// THE BIBLE READER'S VERSE CARD: ONE "+", A "−" THAT REALLY UNDOES IT, AND A + THAT CROSSES CHAPTERS.
//   Run: node --test scripts/the-reader-can-undo-a-plus.test.mjs
//
// Three changes, all asked for by the owner, all about the little card that appears when you tap a verse.
// (3 was added on 2026-09-16 and is written up in its own banner further down the file.)
//
// 1. ONE PLUS INSTEAD OF TWO. The card used to carry "＋ before" and "＋ after". The owner: *"lets just have
//    a Plus, that adds the next verse, users can select the first one and either manually select more in the
//    text page itself, or just hit the +"*.
//
//    The two buttons were a workaround for a dark backdrop that stopped the reader tapping more verses —
//    and the history says the workaround outlived the problem by a long way. Measured from git, not assumed:
//      c6d269a  2026-06-27 11:44  adds "+ after" AND the comment "the backdrop blocks tapping more verses"
//      6958ae7  2026-06-27 18:15  makes this sheet `passthrough` — "no dimming backdrop, Bible scrolls +
//                                 verses stay tappable behind it" — i.e. SEVEN HOURS LATER, same day
//      8a7b9f1  2026-07-02        adds "+ before", five days AFTER the backdrop had already gone
//    The comment beside them still described the vanished backdrop until this branch.
//
//    The passage really is tappable behind the card, and that is asserted below rather than taken on trust:
//    BottomSheet's `passthrough` arm draws no dimming layer and sets `pointerEvents: 'none'` on its wrapper,
//    so only the card itself takes taps.
//
// 2. MINUS NOW UNDOES THE LAST TAP. It used to remove the HIGHEST-NUMBERED verse, whichever end had grown.
//    So a reader who tapped verse 5 and then tapped verse 4 in the text, and pressed minus to take back the
//    4, was left holding VERSE 4: minus deleted the verse they had actually chosen. And because Note,
//    Bookmark and Highlight all attach to the LOWEST selected verse, they could then annotate verse 4 having
//    never deliberately picked it. That is silent, and it puts a person's note on the wrong verse.
//
// ── HOW THIS ASSERTS ──────────────────────────────────────────────────────────────────────────────────────
// CLAUDE.md rule 3: app/screens-read.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves every
// word in place and a text-matching assertion still passes. NOTHING HERE READS THE SOURCE. The real
// ReadScreen — with the real ActionSheet, the real BottomSheet and the real Verse rows — is compiled with the
// same esbuild the packaged build uses and rendered through the miniature React in
// scripts/render-jsx-screen.mjs. Every selection below is made by CALLING THE HANDLER THE SCREEN PUT ON A
// REAL VERSE ROW or ON A REAL BUTTON and drawing again; every answer is read off the redrawn tree.
//
// MEASURED RED/GREEN, 2026-09-16, against app/screens-read.jsx. Each sabotage was SCOPED — ActionSheet or
// ReadScreen sliced out first, the anchor asserted to occur exactly once inside that slice, then replaced
// there, and the file's md5 checked to have actually moved (an inert sabotage reads exactly like a test
// that does not bite). The BASELINE row is here on purpose: a broken harness fails every row, which looks
// identical to every sabotage biting.
//
// ROUND 1 — the one + and the true −, over the 5 tests this file opened with:
//   sabotage                                                   pass  fail
//   BASELINE — nothing sabotaged                                 5     0
//   the code as it shipped, before either fix                    1     4
//   _shrink back to "remove the highest-numbered verse"          4     1
//   "＋ before" put back on the card (with its handler)          4     1
//   the + relabelled "＋ after" with its old title               2     3
//   the + deleted from the card                                  2     3
//   the sheet's `passthrough` removed (backdrop returns)         4     1
//
// ROUND 2 — the roll onto the next chapter, over all 16:
//   sabotage                                                   pass  fail
//   BASELINE — nothing sabotaged                                16     0
//   the roll-over deleted from + (today's "nothing happens")     5    11
//   + rolls on but CARRIES NOTHING (earlier verses dropped)      8     8
//   + carries the passage but does NOT move the reader           8     8
//   + at the end of the Bible silently ignores the press again  14     2
//   − loses its roll-back arm (the reader is stranded)          13     3
//   − hands the carried chapter back SORTED, not in tap order   15     1
//   − comes back but does not MOVE the reader back              13     3
//   the card counts only the chapter on screen (`multi`)        12     4
//   Copy/Share take only the chapter on screen                  15     1
//   the reference names only the chapter on screen               9     7
//   the reference calls the new book by the old one's name      15     1
//   a fresh tap keeps the carried chapter                       15     1
//   an ordinary page turn keeps the carried chapter             15     1
//
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// ⚠ THE FIXTURE SERVES A WHOLE BOOK, NOT ONE CHAPTER, and it has to: the + now rolls the reader on into the
// NEXT chapter, so a fixture that answers with the same twenty verses whatever chapter it is asked for
// cannot tell a roll-over from standing still. Every verse names its own chapter for the same reason —
// Copy and Share across a chapter line are checked by reading the words back.
const verseText = (c, v) => 'Chapter ' + c + ' verse ' + v + ', with enough words in it to wrap on a phone.';

// The reader, standing up with a real book in it. A name the screen needs that is not supplied here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends up
// asserting about something that is not the code.
//
//   opts.chapters  { <chapter>: <how many verses> } — any chapter not named has 20
//   opts.lastChap  the last chapter this fixture has (default 21). step() returns null past it, which is
//                  what the real engine does at the end of the Bible.
//   opts.start     where the reader opens (default John 3, as every test written before 2026-09-16 assumes)
//   opts.nextBook  give the fixture a SECOND book (Acts), so step() rolls off the end of John into it the
//                  way the real engine does. Off by default: every test written before 2026-09-16 assumes
//                  one book and would see a different label at the end of it.
const BOOKNAME = { 43: 'John', 44: 'Acts' };
function reader(opts = {}) {
  const chapters = opts.chapters || {};
  const lastChap = opts.lastChap == null ? 21 : opts.lastChap;
  const start = opts.start || { book: 43, chap: 3 };
  const versesIn = (c) => Array.from({ length: chapters[c] == null ? 20 : chapters[c] },
    (_, i) => ({ v: i + 1, text: verseText(c, i + 1), html: verseText(c, i + 1) }));
  const toasts = [], shared = [], copied = [];
  const { React, draw } = miniReact();
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // CROSSREFS is read by CrossRefSheet whenever the reader is in John 1 — which these tests now are.
    // Leaving it out is a TypeError inside the real component, not a finding about it.
    TrinityData: { PLANS: [], VOTD_POOL: [], CROSSREFS: {} }, Fellowship: {},
    speechSynthesis: null, sanitizeHtml: (h) => h,
  };
  const base = {
    React, window: win, localStorage: win.localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null },
    navigator: { userAgent: '', clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } },
    location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    history: { back() {}, pushState() {}, replaceState() {}, state: null },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { BottomSheet } = loadScreen('app/ui.jsx', ['BottomSheet'], base);
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  win.Bible = {
    loaded: true, activeVersion: 'WEB',
    books: () => [{ n: 43, name: 'John', chapters: 21 }],
    bookMeta: () => [{ n: 43, name: 'John', chapters: 21, group: 'nt' }],
    bookName: (b) => BOOKNAME[b] || 'John', getVerses: (b, c) => versesIn(c), maxChapter: () => lastChap,
    refLabel: (l, v) => (BOOKNAME[l.book] || 'John') + ' ' + l.chap + (v != null ? ':' + v : ''), parseRef: () => null,
    defaultLoc: () => ({ ...start }),
    versions: () => [{ abbr: 'WEB', name: 'World English Bible' }],
    // the real engine rolls into the neighbouring BOOK at the ends of one, and returns NULL only at the
    // ends of the whole Bible. Both are reproduced here, because the + inherits this function wholesale.
    step: (l, d) => {
      const c = l.chap + d;
      if (c >= 1 && c <= lastChap) return { book: l.book, chap: c };
      if (!opts.nextBook) return null;
      if (d > 0 && l.book === 43) return { book: 44, chap: 1 };
      if (d < 0 && l.book === 44) return { book: 43, chap: lastChap };
      return null;
    },
    refKey: (l, v) => l.book + '.' + l.chap + '.' + v,
    subscribe: () => () => {}, getCommentary: () => null, lex: () => ({ missing: true }),
    getCatalog: async () => [], isInstalled: () => true, isInstalling: () => false, installModule: async () => ({}),
  };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], {
    ...base, BottomSheet, Icon, Bible: win.Bible,
    IconBtn: Stub('IconBtn'), Sheet: Stub('Sheet'), Halo: Stub('Halo'),
    SectionLabel: Stub('SectionLabel'), EmptyState: Stub('EmptyState'), ReadPlansTabs: Stub('ReadPlansTabs'),
    ChurchBadge: Stub('ChurchBadge'), Overlay: Stub('Overlay'),
    cx: (...a) => a.filter(Boolean).join(' '),
    lsGet: (k, d) => d, lsSet: () => {},
    todayISO: () => '2026-09-16',
    useTrinityAudio: () => ({ track: null, playing: false }),
  });
  // The reader's place in the Bible is REAL STATE here, moved only by the screen calling ctx.setLoc — which
  // is the whole point: the + is now allowed to move it, and a fixture that pinned `loc` could not see that.
  const ctx = {
    loc: { ...start }, version: 'WEB',
    setLoc(x) { ctx.loc = { ...x }; },
    toast: (m) => toasts.push(m), toggleBookmark() {}, bookmarks: [], notes: {}, highlights: {},
    openShareSheet: (pl) => shared.push(pl), plans: [], planProgress: {}, church: { name: 'Test Church' },
  };
  let tree = draw(ReadScreen, { ctx });
  const redraw = () => { tree = draw(ReadScreen, { ctx }); return tree; };

  // TAP A VERSE IN THE CHAPTER, the way a reader does: find the row the screen rendered for that verse and
  // fire the handler the screen put on it. Verse rows carry `id="rv-<n>"`, which is how ReadScreen's own
  // narration scrolls to them — so it is the screen's identifier, not one invented here.
  const tapVerse = (n) => {
    const row = find(tree, x => x.props && x.props.id === 'rv-' + n)[0];
    assert.ok(row, 'no verse row id="rv-' + n + '" on the chapter — re-anchor this test');
    // the tappable element is the row itself or the first descendant carrying an onClick
    const hit = find(row, x => x.props && typeof x.props.onClick === 'function')[0] || row;
    assert.ok(hit.props && hit.props.onClick, 'verse ' + n + ' has nothing to tap');
    hit.props.onClick({ target: {}, stopPropagation() {} });
    return redraw();
  };

  // The verse card's own controls, found by the title the screen put on each — never by source text, and a
  // control removed from the screen is simply not in this list.
  const cardButtons = () => find(tree, x => x.type === 'button' && x.props && typeof x.props.title === 'string')
    // ⚠ reads(), NOT texts(). texts() also collects string PROPS, so a button's own `title` would be glued
    // onto the label a reader sees and every label assertion below would be measuring the tooltip too.
    .map(b => ({ title: b.props.title, label: reads(b), press: b.props.onClick, disabled: !!b.props.disabled }));

  const pressTitled = (title) => {
    const b = cardButtons().find(x => x.title === title);
    assert.ok(b, 'no control titled "' + title + '" on the verse card; there are: ' +
      JSON.stringify(cardButtons().map(x => x.title)));
    assert.equal(b.disabled, false, '"' + title + '" is disabled');
    b.press();
    return redraw();
  };

  // WHICH VERSES ARE SELECTED, read off the screen: the reference line the card shows ("John 3:5-6"), which
  // is what the reader sees and what Copy and Share will use.
  const selectionLabel = () => {
    const refs = find(tree, x => x.props && x.props.style
      && String(x.props.style.fontFamily || '') === 'var(--font-display)'
      && /^(John|Acts) \d+:/.test(reads(x)))[0];
    return refs ? reads(refs) : null;
  };

  // And which rows the screen is actually painting as selected, so the label cannot pass on its own.
  // ⚠ THE TINT IS ON THE CHILD, NOT ON THE ROW. VerseRow paints `id="rv-N"` with nothing but
  // `position: relative` and puts the selection colour on the span inside it — the first version of this
  // looked at the row itself, found no colour anywhere, and reported "nothing is selected" for every case.
  const selectedRows = () => find(tree, x => x.props && typeof x.props.id === 'string' && /^rv-\d+$/.test(x.props.id))
    .filter(row => find(row, x => x.props && x.props.style
      && /var\(--clay\) 30%/.test(String(x.props.style.background || ''))).length > 0)
    .map(x => Number(x.props.id.slice(3))).sort((a, b) => a - b);

  // WHICH CHAPTER IS ON SCREEN, read off the heading the reader sees ("Chapter 2"), so a claim that the +
  // moved the view cannot be satisfied by state nobody is shown.
  const chapterHeading = () => { const h = find(tree, x => x.type === 'h1')[0]; return h ? reads(h) : null; };

  // The card's own count line — "Verse selected" / "N verses selected". This is what decides which arm of
  // the card a reader gets: the per-verse arm (Note / Bookmark / Highlight / Cross-refs) all anchor on the
  // lowest verse IN THE CHAPTER ON SCREEN, so it must not be offered for a passage that began earlier.
  const cardCount = () => { const d = find(tree, x => x.props && x.props.style && x.props.style.fontSize === 12
    && String(x.props.style.color) === 'var(--ink-3)' && /selected$/.test(reads(x)))[0]; return d ? reads(d) : null; };

  // The action tiles at the bottom of the card, by the words on them.
  const actionLabels = () => find(tree, x => x.type === 'button' && x.props && x.props.style
    && x.props.style.borderRadius === 16).map(b => reads(b));

  // The footer chapter buttons — ANY other way of moving the reader, for the case that must NOT keep a
  // carried passage.
  const pressFooter = (which) => {
    const bs = find(tree, x => x.type === 'button' && x.props && x.props.style && x.props.style.borderRadius === 15);
    assert.equal(bs.length, 2, 'expected two footer chapter buttons, found ' + bs.length);
    bs[which === 'next' ? 1 : 0].props.onClick();
    // ⚠ TWO DRAWS, AND THE REASON IS THE HARNESS, NOT THE SCREEN. An ordinary page turn clears the
    // selection from inside an EFFECT (it has to: the reader may equally have arrived from Search or the
    // book picker). Real React re-renders after an effect calls setState; this miniature React runs effects
    // after a draw and stops, so the first draw still shows the selection the reader had a moment ago.
    // The + and − need no such thing — they set the selection in the handler itself, in the same breath as
    // moving the reader, so one draw shows the finished answer.
    redraw();
    return redraw();
  };

  return { tapVerse, pressTitled, cardButtons, selectionLabel, selectedRows, chapterHeading, cardCount,
    actionLabels, pressFooter, toasts, shared, copied, loc: () => ctx.loc, tree: () => tree };
}

test('the verse card offers ONE way to grow the passage, a single +', () => {
  const R = reader();
  R.tapVerse(5);
  const titles = R.cardButtons().map(b => b.title);
  const adders = R.cardButtons().filter(b => /^Add /.test(b.title));
  assert.deepEqual(adders.map(b => b.title), ['Add the next verse'],
    'the card should offer exactly one "add" control. Found: ' + JSON.stringify(titles));
  assert.equal(adders[0].label, '+',
    'the add control should read as a single plus. U+002B PLUS SIGN is deliberate: its partner on the left ' +
    'is U+2212 MINUS SIGN, which type designers draw to match U+002B — the old label used U+FF0B FULLWIDTH ' +
    'PLUS, a wide CJK form that sits differently in the same circle. Found: ' + JSON.stringify(adders[0].label));
  assert.ok(!titles.includes('Add the verse before'),
    '"＋ before" is still on the card. It was a workaround for a dimming backdrop that was removed on ' +
    '2026-06-27 (6958ae7); a reader reaches an earlier verse by tapping it in the text.');
});

test('the + adds the NEXT verse, and says so on the card', () => {
  const R = reader();
  R.tapVerse(5);
  assert.equal(R.selectionLabel(), 'John 3:5', 'tapping verse 5 should select verse 5');
  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 3:5-6', 'the + should have added verse 6');
  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 3:5-7');
});

test('the − is a true undo of the +', () => {
  const R = reader();
  R.tapVerse(5);
  R.pressTitled('Add the next verse');
  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 3:5-7');
  R.pressTitled('Remove the last verse');
  assert.equal(R.selectionLabel(), 'John 3:5-6', 'minus should take back the verse the + just added');
  R.pressTitled('Remove the last verse');
  assert.equal(R.selectionLabel(), 'John 3:5', 'minus should get back to the verse the reader chose');
});

// ⚠ THIS IS THE REAL BUG, AND IT IS REACHABLE WITHOUT ANY BUTTON AT ALL. The reader taps a verse, then taps
// an EARLIER one in the text (which the owner's instruction assumes they will: "users can select the first
// one and either manually select more in the text page itself"). Minus used to remove the highest-numbered
// verse, so it deleted the verse they had chosen and kept the one they were trying to take back.
test('minus takes back the verse just tapped, not the one the reader chose first', () => {
  const R = reader();
  R.tapVerse(5);
  R.tapVerse(4);
  assert.equal(R.selectionLabel(), 'John 3:4-5', 'tapping 5 then 4 should select both');
  R.pressTitled('Remove the last verse');
  assert.equal(R.selectionLabel(), 'John 3:5',
    'the reader tapped 5, then tapped 4, then pressed minus to take the 4 back — and was left holding ' +
    'VERSE 4. Note, Bookmark and Highlight all attach to the LOWEST selected verse, so they could then ' +
    'annotate a verse they never deliberately chose.');
  assert.deepEqual(R.selectedRows(), [5],
    'the label and the painted chapter must agree about which verse is selected');
});

test('the verse card does not block tapping the chapter behind it', () => {
  // The whole case for one + rather than two rests on the passage being tappable while the card is open.
  // BottomSheet's `passthrough` arm is what makes that true: no dimming layer, and the wrapper takes no
  // pointer events, so only the card itself does. Read off the rendered tree, not the source.
  const R = reader();
  R.tapVerse(5);
  const wrappers = find(R.tree(), n => n.props && n.props.style
    && n.props.style.position === 'absolute' && n.props.style.inset === 0
    && n.props.style.pointerEvents === 'none');
  assert.ok(wrappers.length >= 1,
    'the verse card is not passthrough: its wrapper takes pointer events, so the chapter behind it cannot ' +
    'be tapped — and a single + would then be the only way to grow a passage downward AND the reader would ' +
    'have no way at all to grow it upward.');
  const dimmers = find(R.tree(), n => n.props && n.props.style
    && n.props.style.position === 'absolute' && n.props.style.inset === 0
    && /rgba\(20,\s*14,\s*8/.test(String(n.props.style.background || '')));
  assert.deepEqual(dimmers.map(() => 'a dimming backdrop'), [],
    'a dimming backdrop is back over the chapter. That is the thing "＋ before" existed to work around.');
});

// ⚠ THE BOUNDS CHECK ON `+`, WHICH NOTHING GUARDED UNTIL A REVIEW SAID SO.
//
// `_extend` only appends when the next verse actually exists in the chapter. That check was untested:
// delete `verses.some(...)` from it and every other test in this file stays green — while the reader would
// hold a verse number the chapter does not contain. Copy, Share and the reference line would all name it,
// and `selRow` would be undefined, so Share-note would send an empty verse.
//
// With "＋ before" gone, `+` is the card's ONLY growth control, so this matters more than it did, not less.
//
// ⚠ RE-BASED 2026-09-16, AND NOT DELETED. It used to open on a fixture whose chapter 3 was simply the end
// of the world, because `+` at the last verse of a chapter did nothing at all. It now rolls on into the
// next chapter, so the "nothing happens" case had to be given a place where there genuinely IS no next
// chapter — `lastChap: 3`, the end of the Bible. The INVARIANT it exists for is untouched and still the
// point: the selection never contains a verse that is not there. The roll-over's own version of the same
// invariant is asserted below ("the + rolls on into the next chapter").
test('the + never selects a verse the chapter does not have', () => {
  const R = reader({ lastChap: 3 });    // John 3 is the last chapter this fixture has
  R.tapVerse(20);                       // the fixture chapter ends at 20
  assert.equal(R.selectionLabel(), 'John 3:20', 'fixture: tapping the last verse should select it');
  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 3:20',
    'the + ran past the end of the chapter and put verse 21 in the selection. The chapter has no verse 21, ' +
    'so the reference line names a verse that does not exist and Copy/Share would carry it.');
  assert.deepEqual(R.selectedRows(), [20],
    'the painted chapter and the reference line disagree about what is selected');
  assert.deepEqual(R.toasts, ['That\u2019s the last chapter of the Bible'],
    'at the very end of the Bible the + must SAY so, the way a swipe off the end already does, rather ' +
    'than being an enabled full-opacity button that silently ignores the press');
  assert.deepEqual(R.loc(), { book: 43, chap: 3 }, 'nothing should have moved the reader');

  // …and the control: one verse from the end it MUST still extend, or a "fix" that disabled the button
  // near the end of every chapter would pass the row above.
  const R2 = reader();
  R2.tapVerse(19);
  R2.pressTitled('Add the next verse');
  assert.equal(R2.selectionLabel(), 'John 3:19-20',
    'the + stopped working one verse from the end — the bounds check is off by one and the reader cannot ' +
    'reach the last verse of any chapter with it');
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// ROLLING ONTO THE NEXT CHAPTER WITH THE +  (2026-09-16)
//
// The owner: *"Roll onto the next chapter with the +, chapter markings are sometimes a pain anyway."* Offered
// three shapes, they chose **"carry the selection and move the view with it"** — so the + at the last verse
// of a chapter takes the reader to the next chapter, puts its first verse in the passage, and KEEPS the
// verses already chosen.
//
// `sel` is still verse numbers in the chapter on screen; the chapters already passed are parked in `carry`.
// Everything below is read off the redrawn screen — the reference line on the card, the chapter heading a
// reader sees, and which verse rows are painted as selected.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

test('the + rolls on into the next chapter, and takes the reader with it', () => {
  // The owner's own example: John 1:19, then + all the way past verse 51.
  const R = reader({ start: { book: 43, chap: 1 }, chapters: { 1: 51, 2: 25 } });
  R.tapVerse(19);
  for (let v = 19; v < 51; v++) R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 1:19-51', 'fixture: the + should reach the end of chapter 1');
  assert.equal(R.chapterHeading(), 'Chapter 1', 'nothing should have moved the reader yet');

  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 1:19-2:1',
    'the + at the last verse of a chapter must extend the passage into the next one AND keep the verses ' +
    'already chosen. A label of "John 2:1" means the earlier verses were dropped; "John 1:19-51" means ' +
    'the press was ignored, which is the bug this replaces.');
  assert.equal(R.chapterHeading(), 'Chapter 2',
    'the reader was not moved — the owner chose "carry the selection AND move the view with it"');
  assert.deepEqual(R.selectedRows(), [1],
    'the chapter now on screen should paint verse 1 as part of the passage');
  assert.ok(!/:52\b/.test(R.selectionLabel()),
    'the passage names verse 52 of a chapter that ends at 51');
});

test('and it keeps rolling, one verse at a time, on the far side of the line', () => {
  const R = reader({ start: { book: 43, chap: 1 }, chapters: { 1: 51, 2: 25 } });
  R.tapVerse(51);
  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 1:51-2:1');
  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 1:51-2:2', 'the + should go on growing the passage in the new chapter');
  assert.deepEqual(R.selectedRows(), [1, 2]);
});

test('the − is a true undo of a roll-over: back a chapter, with the passage intact', () => {
  // ⚠ THIS IS THE ONE THAT MATTERS. A − that does not walk back across the line leaves the reader holding
  // verses in a chapter they never asked for — and Note, Bookmark and Highlight all attach to the LOWEST
  // selected verse, so they would then annotate a verse they never deliberately chose. Silent, and wrong.
  const R = reader({ start: { book: 43, chap: 1 }, chapters: { 1: 51, 2: 25 } });
  R.tapVerse(49);
  R.pressTitled('Add the next verse');            // 50
  R.pressTitled('Add the next verse');            // 51
  R.pressTitled('Add the next verse');            // rolls into chapter 2
  assert.equal(R.selectionLabel(), 'John 1:49-2:1');
  assert.equal(R.chapterHeading(), 'Chapter 2');

  R.pressTitled('Remove the last verse');
  assert.equal(R.selectionLabel(), 'John 1:49-51',
    'the − must take back the verse the + just added, which means coming back across the chapter line');
  assert.equal(R.chapterHeading(), 'Chapter 1', 'the − must bring the reader back to the chapter they left');
  assert.deepEqual(R.selectedRows(), [49, 50, 51],
    'the selection the reader had before the roll-over must be handed back exactly');

  R.pressTitled('Remove the last verse');
  assert.equal(R.selectionLabel(), 'John 1:49-50', 'and the − goes on undoing inside the chapter as before');
});

test('the − restores the order the reader tapped in, not merely the numbers', () => {
  // `sel` is in TAP ORDER and the − pops the LAST ENTRY, so a carried chapter that came back sorted would
  // make the very next − delete the wrong verse — the exact defect this file was written for, one chapter
  // further along.
  const R = reader({ start: { book: 43, chap: 1 }, chapters: { 1: 51, 2: 25 } });
  R.tapVerse(51);
  R.tapVerse(50);                                  // tapped SECOND, so the − owes them this one back first
  assert.equal(R.selectionLabel(), 'John 1:50-51');
  R.pressTitled('Add the next verse');             // 51 is the last verse -> rolls into chapter 2
  assert.equal(R.selectionLabel(), 'John 1:50-2:1');
  R.pressTitled('Remove the last verse');          // undo the roll
  assert.equal(R.selectionLabel(), 'John 1:50-51');
  R.pressTitled('Remove the last verse');          // undo the tap on 50
  assert.equal(R.selectionLabel(), 'John 1:51',
    'the carried chapter came back with its taps re-sorted, so the − took away verse 51 — the verse the ' +
    'reader chose first — and left them holding the one they were undoing');
  assert.deepEqual(R.selectedRows(), [51]);
});

test('Copy and Share carry the words of BOTH chapters', () => {
  // The other chapter is not on screen and is not in the `verses` memo, so its words have to be fetched.
  // A passage that copies only what is painted is the quiet failure here: the reference says John 1:51-2:1
  // and the clipboard holds one verse.
  const tile = (R, label) => {
    const tiles = find(R.tree(), x => x.type === 'button' && x.props && x.props.style && x.props.style.borderRadius === 16);
    const i = R.actionLabels().indexOf(label);
    assert.ok(i >= 0, 'no ' + label + ' on the card; there are: ' + JSON.stringify(R.actionLabels()));
    tiles[i].props.onClick();
  };
  const R = reader({ start: { book: 43, chap: 1 }, chapters: { 1: 51, 2: 25 } });
  R.tapVerse(51);
  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 1:51-2:1');
  tile(R, 'Copy');
  assert.equal(R.copied.length, 1, 'Copy put nothing on the clipboard');
  assert.ok(R.copied[0].startsWith('John 1:51-2:1 — '),
    'the copied passage should be headed by the reference that spans the chapter line. Got: ' + R.copied[0]);
  assert.ok(R.copied[0].includes('Chapter 1 verse 51'), 'the copied text lost the chapter the passage began in');
  assert.ok(R.copied[0].includes('Chapter 2 verse 1'), 'the copied text lost the chapter the passage ran on into');

  const R2 = reader({ start: { book: 43, chap: 1 }, chapters: { 1: 51, 2: 25 } });
  R2.tapVerse(51);
  R2.pressTitled('Add the next verse');
  tile(R2, 'Share');
  assert.equal(R2.shared.length, 1, 'Share opened nothing');
  assert.equal(R2.shared[0].ref, 'John 1:51-2:1');
  assert.ok(R2.shared[0].text.includes('Chapter 1 verse 51') && R2.shared[0].text.includes('Chapter 2 verse 1'),
    'Share carried only one side of the chapter line. Got: ' + JSON.stringify(R2.shared[0].text));
});

test('a rolled passage is never offered the per-verse actions', () => {
  // Note / Bookmark / Highlight / Cross-refs all anchor on the LOWEST verse IN THE CHAPTER ON SCREEN. Once a
  // passage has crossed a chapter line its first verse is not on screen, so offering them would silently
  // attach a person's note to the wrong verse — which is the harm the whole file exists to prevent.
  const R = reader({ start: { book: 43, chap: 1 }, chapters: { 1: 51, 2: 25 } });
  R.tapVerse(51);
  assert.equal(R.cardCount(), 'Verse selected');
  assert.ok(R.actionLabels().includes('Note'), 'fixture: one verse should get the per-verse actions');

  R.pressTitled('Add the next verse');
  assert.equal(R.cardCount(), '2 verses selected',
    'the card counted only the verse on screen, so a passage spanning two chapters looked like a single verse');
  assert.deepEqual(R.actionLabels(), ['Copy', 'Share'],
    'a passage that has crossed a chapter line was offered per-verse actions anchored on the wrong chapter. ' +
    'Found: ' + JSON.stringify(R.actionLabels()));
});

test('tapping a verse starts a NEW passage, it does not lengthen the old one', () => {
  const R = reader({ start: { book: 43, chap: 1 }, chapters: { 1: 51, 2: 25 } });
  R.tapVerse(51);
  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 1:51-2:1');
  R.tapVerse(5);
  assert.equal(R.selectionLabel(), 'John 2:1,5',
    'a fresh tap must drop the chapter the passage was carrying — the reader is choosing a new passage, ' +
    'not extending one they left behind a chapter ago');
  assert.deepEqual(R.selectedRows(), [1, 5]);
});

test('turning the page any OTHER way drops the carried chapter', () => {
  // The + is the only thing allowed to move the reader and keep a passage. A footer button, a swipe, the
  // book picker, Search, Today — all of them are a fresh place in the Bible.
  const R = reader({ start: { book: 43, chap: 1 }, chapters: { 1: 51, 2: 25 } });
  R.tapVerse(51);
  R.pressTitled('Add the next verse');
  assert.equal(R.chapterHeading(), 'Chapter 2');
  R.pressFooter('next');                            // the ordinary "next chapter" button
  assert.equal(R.chapterHeading(), 'Chapter 3');
  assert.equal(R.selectionLabel(), null, 'the reader turned the page: nothing should still be selected');
  assert.deepEqual(R.selectedRows(), []);
});

test('at the very end of the Bible the + says so instead of doing nothing', () => {
  // `Bible.step` is the same function the swipe handler turns pages with. Where it returns null — the end of
  // the Bible — the + must speak, in the swipe's own words, rather than ignore the press as it used to.
  const R = reader({ start: { book: 43, chap: 3 }, lastChap: 3 });
  R.tapVerse(20);
  R.pressTitled('Add the next verse');
  assert.deepEqual(R.toasts, ['That’s the last chapter of the Bible']);
  assert.equal(R.selectionLabel(), 'John 3:20', 'nothing should have been added');
  assert.equal(R.chapterHeading(), 'Chapter 3', 'nothing should have moved');
});

test('the + rolls off the end of a BOOK into the next one, exactly as a swipe does', () => {
  // `Bible.step` already turns the page into the neighbouring book; the + uses that same function, so the
  // reference has to name the new book rather than carrying John's name across the join.
  const R = reader({ start: { book: 43, chap: 21 }, lastChap: 21, nextBook: true });
  R.tapVerse(20);
  assert.equal(R.selectionLabel(), 'John 21:20');
  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 21:20-Acts 1:1',
    'the + ran off the end of John. The passage must name the book it ran on into, not keep calling it John.');
  assert.deepEqual(R.toasts, [], 'the end of a BOOK is not the end of the Bible and must not say so');
  assert.deepEqual(R.selectedRows(), [1]);

  R.pressTitled('Remove the last verse');
  assert.equal(R.selectionLabel(), 'John 21:20', 'the − must walk back over a book line too');
  assert.deepEqual(R.selectedRows(), [20]);
});
