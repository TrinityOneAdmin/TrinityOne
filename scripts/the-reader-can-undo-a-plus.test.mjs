// THE BIBLE READER'S VERSE CARD: ONE "+", AND A "−" THAT REALLY UNDOES THE LAST TAP.
//   Run: node --test scripts/the-reader-can-undo-a-plus.test.mjs
//
// Two changes, both asked for by the owner, both about the little card that appears when you tap a verse.
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
// there. The BASELINE row is here on purpose: a broken harness fails every row, which looks identical to
// every sabotage biting.
//
//   sabotage                                                   pass  fail
//   BASELINE — nothing sabotaged                                 5     0
//   the code as it shipped, before either fix                    1     4
//   _shrink back to "remove the highest-numbered verse"          4     1
//   "＋ before" put back on the card (with its handler)          4     1
//   the + relabelled "＋ after" with its old title               2     3
//   the + deleted from the card                                  2     3
//   the sheet's `passthrough` removed (backdrop returns)         4     1
//
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const VERSES = Array.from({ length: 20 }, (_, i) => ({
  v: i + 1, text: 'Verse ' + (i + 1) + ' of this chapter, with enough words in it to wrap on a phone.',
}));

// The reader, standing up with a real chapter in it. A name the screen needs that is not supplied here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends up
// asserting about something that is not the code.
function reader() {
  const { React, draw } = miniReact();
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    TrinityData: { PLANS: [], VOTD_POOL: [] }, Fellowship: {},
    speechSynthesis: null, sanitizeHtml: (h) => h,
  };
  const base = {
    React, window: win, localStorage: win.localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '', hostname: 'x' },
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
    bookName: () => 'John', getVerses: () => VERSES, maxChapter: () => 21,
    refLabel: () => 'John 3', parseRef: () => null, defaultLoc: () => ({ book: 43, chap: 3 }),
    versions: () => [{ abbr: 'WEB', name: 'World English Bible' }],
    step: (l, d) => ({ book: l.book, chap: l.chap + d }),
    refKey: (b, c, v) => b + '.' + c + '.' + v,
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
  const ctx = {
    toast() {}, toggleBookmark() {}, bookmarks: [], notes: {}, highlights: {},
    openShareSheet() {}, plans: [], planProgress: {}, church: { name: 'Test Church' },
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
      && /^John 3:/.test(reads(x)))[0];
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

  return { tapVerse, pressTitled, cardButtons, selectionLabel, selectedRows, tree: () => tree };
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
// NOTE ON WHAT THIS DOES *NOT* SAY. Today `+` at the last verse of a chapter simply does nothing — an
// enabled, full-opacity button that ignores the press. The owner has asked for it to roll on into the next
// chapter instead ("chapter markings are sometimes a pain anyway"), which needs the reader's selection to
// carry a chapter and is a separate piece of work. This row asserts only the invariant that survives either
// decision: the selection never contains a verse that is not there.
test('the + never selects a verse the chapter does not have', () => {
  const R = reader();
  R.tapVerse(20);                       // the fixture chapter ends at 20
  assert.equal(R.selectionLabel(), 'John 3:20', 'fixture: tapping the last verse should select it');
  R.pressTitled('Add the next verse');
  assert.equal(R.selectionLabel(), 'John 3:20',
    'the + ran past the end of the chapter and put verse 21 in the selection. The chapter has no verse 21, ' +
    'so the reference line names a verse that does not exist and Copy/Share would carry it.');
  assert.deepEqual(R.selectedRows(), [20],
    'the painted chapter and the reference line disagree about what is selected');

  // …and the control: one verse from the end it MUST still extend, or a "fix" that disabled the button
  // near the end of every chapter would pass the row above.
  const R2 = reader();
  R2.tapVerse(19);
  R2.pressTitled('Add the next verse');
  assert.equal(R2.selectionLabel(), 'John 3:19-20',
    'the + stopped working one verse from the end — the bounds check is off by one and the reader cannot ' +
    'reach the last verse of any chapter with it');
});
