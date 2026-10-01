// THE VERSE OF THE DAY, FROM A USFM BIBLE, READS AS THE VERSE — NOT AS ITS MARKUP OR THE NEXT HEADING.
// Run: node --test scripts/verse-of-the-day-reads-as-scripture.test.mjs
//
// FIX-PLAN-2026-10-01 item 3, confirmed by running before the fix. With an open.bible (USFM) translation
// active, Today's Verse of the Day for Isaiah 40:8 read:
//
//     “The grass withers and the flowers fall,&emsp;but the word of our God stands forever.”Here Is Your God!(Romans 11:33–36)”
//
// Three defects, all in the `text` engine.js's USFM builder produced with stripTags(html): the poetry break
// `<br>` became nothing ("fall,but"), the indent entity `&emsp;` was printed as six characters, and the
// section heading and parallel reference that parseUSFM attaches to the END of the verse before them kept
// their words. Every reader of `text` showed the same thing: the verse card, share, copy, read-aloud, the
// compare pane, the USFM search.
//
// THIS DRIVES THE SHIPPED CODE AT THE POINT OF USE. The REAL engine.js runs in a vm and loads a real USFM book
// through its own Bible.loadModuleBytes; the REAL TodayScreen is compiled with the build's esbuild and drawn
// through scripts/render-jsx-screen.mjs with that window.Bible; the assertions read the verse card off the
// rendered tree, and what the card hands to the share sheet when tapped. Nothing matches source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

// Isaiah 40, as an open.bible USFM file lays it out: verse 8 in two poetry lines, then a section heading and a
// parallel-passage reference BEFORE verse 9 — which parseUSFM appends to verse 8's html. A heading with a
// nested character style (\nd … \nd*) and an `&amp;` in the scripture are there so the cleaner is tested on
// the shapes it has to survive, not only the one that was reported.
const ISAIAH_40 = [
  '\\id ISA',
  '\\c 40',
  '\\q1',
  '\\v 7 The grass withers and the flowers fall',
  '\\q2 when the breath of the \\nd Lord\\nd* blows on them;',
  '\\q2 indeed, the people are grass.',
  '\\q1',
  '\\v 8 The grass withers and the flowers fall,',
  '\\q2 but the word of our God stands forever.”',
  '\\s1 Here Is Your God!',
  '\\r (Romans 11:33–36)',
  '\\q1',
  '\\v 9 Go up on a high mountain, O Zion, herald of good news. Lift up your voice loudly, O Jerusalem.',
  '\\s1 The \\nd Lord\\nd* Reigns',
  '\\p',
  '\\v 10 Here comes the Lord God &amp; his arm rules for Him.',
  // Audit of 3fe46eb, finding 5: a break between two \q1 lines (no &emsp; indent to hide behind) and a
  // paragraph break INSIDE a verse — each must read as a word break.
  '\\q1',
  '\\v 11 He tends his flock like a shepherd;',
  '\\q1 he gathers the lambs in his arms',
  '\\v 12 Who has measured the waters',
  '\\p in the hollow of his hand?',
  // Finding 7: a heading MID-VERSE with an unclosed character style. The verse's words after it must survive.
  '\\v 13 Who has understood the Spirit of the Lord,',
  '\\s1 The \\nd Lord',
  '\\q1 or instructed him as his counselor?',
].join('\n');

// The REAL engine.js, run whole in a vm. `document.readyState: 'loading'` holds autoLoad back (it would try to
// download the default Bible); nothing else is stubbed that the USFM path reaches.
function realBible() {
  const win = { addEventListener() {}, location: { search: '' } };
  const ctx = {
    window: win, document: { readyState: 'loading', addEventListener() {} }, location: { search: '' },
    console: { error() {}, warn() {}, log() {} }, TextDecoder, TextEncoder, URLSearchParams, URL,
    setTimeout, clearTimeout, Promise, Uint8Array,
  };
  win.window = win;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(ROOT + 'engine.js', 'utf8'), ctx, { filename: 'engine.js' });
  assert.ok(win.Bible && typeof win.Bible.loadModuleBytes === 'function', 'engine.js no longer exposes Bible.loadModuleBytes — re-anchor');
  return win.Bible;
}

async function bibleWithIsaiah() {
  const Bible = realBible();
  const r = await Bible.loadModuleBytes(new TextEncoder().encode(ISAIAH_40), 'isa.usfm', { abbr: 'OBT', name: 'Open Bible Test', category: 'bibles' });
  assert.equal(r.kind, 'bible', 'the engine did not load the USFM book as a Bible');
  assert.equal(Bible.activeVersion, 'OBT', 'the USFM Bible is not the active translation — the screen would not read from it');
  return Bible;
}

// The real TodayScreen, with the verse card OPEN ('trinityone.votd-min' = '0', a member who tapped it open)
// and the pool forced to the one verse that showed the bug.
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
function today(Bible) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'], { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const date = new Date('2026-10-01T09:00:00Z');
  const store = new Map([['trinityone.votd-min', '0']]);
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem(k, v) { store.set(k, String(v)); }, removeItem(k) { store.delete(k); } };
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }],
      VOTD_POOL: [{ ref: 'Isaiah 40:8', text: 'FALLBACK — the engine was not consulted' }] },
    Bible,
  };
  const globals = {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge,
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => date.toISOString().slice(0, 10),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const shared = [];
  const ctx = {
    church: { name: 'Grace', initials: 'G', npub: 'np1' },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openListen() {}, openShareSheet(v) { shared.push(v); }, openServing() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
    churchEvents: [], myRsvps: {}, servPending: [], servNext: null, servingSeenTs: null,
  };
  return { shared, draw: () => draw(TodayScreen, { ctx }) };
}

// The verse card is the tappable block that opens the share sheet; its scripture is the paragraph in quotes.
function verseCard(tree) {
  const cards = find(tree, n => typeof (n.props || {}).onClick === 'function' && texts(n).some(t => /Verse of the day/i.test(t)) && texts(n).some(t => t === '“'));
  assert.equal(cards.length >= 1, true, 'the Verse of the Day card is not on the screen (is it minimised?) — nothing below can be true');
  return cards[cards.length - 1];
}
const verseText = (card) => {
  const p = find(card, n => n.type === 'p')[0];
  assert.ok(p, 'the verse card has no paragraph of scripture');
  return texts(p).join('');
};

test('Today’s Verse of the Day from a USFM Bible reads as the verse: no markup, no heading, words spaced', async () => {
  const Bible = await bibleWithIsaiah();
  const t = today(Bible);
  const tree = t.draw();
  const card = verseCard(tree);
  const shown = verseText(card);
  assert.ok(!/FALLBACK/.test(shown), 'the card did not read from the active USFM Bible at all — the rig is wrong: ' + shown);
  assert.ok(!/&[a-z#0-9]+;/i.test(shown), 'AN HTML ENTITY IS PRINTED IN THE VERSE OF THE DAY: ' + JSON.stringify(shown));
  assert.ok(!/Here Is Your God/.test(shown), 'THE NEXT SECTION’S HEADING IS PRINTED AS PART OF THE VERSE: ' + JSON.stringify(shown));
  assert.ok(!/Romans 11/.test(shown), 'THE PARALLEL-PASSAGE REFERENCE IS PRINTED AS PART OF THE VERSE: ' + JSON.stringify(shown));
  assert.ok(!/fall,but/.test(shown), 'TWO POETRY LINES ARE GLUED TOGETHER WITH NO SPACE: ' + JSON.stringify(shown));
  // the card's own quotes around the verse's own closing quote — exactly as the module has it
  assert.equal(shown, '“The grass withers and the flowers fall, but the word of our God stands forever.””',
    'the Verse of the Day does not read exactly as Isaiah 40:8');

  // TAPPING THE CARD shares what it shows — the share sheet (and copy from it) gets the same clean text.
  card.props.onClick();
  assert.equal(t.shared.length, 1, 'tapping the verse card did not open the share sheet');
  assert.equal(t.shared[0].text, 'The grass withers and the flowers fall, but the word of our God stands forever.”',
    'the share sheet was handed a different text from the card: ' + JSON.stringify(t.shared[0].text));
});

test('…and the same holds for every reader of `text`: the chapter, a nested heading, an entity in scripture', async () => {
  const Bible = await bibleWithIsaiah();
  const rows = Bible.getVerses(23, 40);
  const byV = Object.fromEntries(rows.map(r => [String(r.v), r.text]));
  assert.equal(byV['7'], 'The grass withers and the flowers fall when the breath of the Lord blows on them; indeed, the people are grass.',
    'verse 7 (poetry lines + a \\nd name) does not read cleanly: ' + JSON.stringify(byV['7']));
  // A heading with a NESTED character style must go whole — a non-nesting cleaner leaves " Reigns" behind.
  assert.equal(byV['9'], 'Go up on a high mountain, O Zion, herald of good news. Lift up your voice loudly, O Jerusalem.',
    'a heading with a nested \\nd span leaked into the verse before it: ' + JSON.stringify(byV['9']));
  assert.equal(byV['10'], 'Here comes the Lord God & his arm rules for Him.', 'an escaped ampersand in scripture is not decoded: ' + JSON.stringify(byV['10']));
  assert.equal(byV['11'], 'He tends his flock like a shepherd; he gathers the lambs in his arms',
    'two \\q1 lines of one verse are glued at the line break: ' + JSON.stringify(byV['11']));
  assert.equal(byV['12'], 'Who has measured the waters in the hollow of his hand?',
    'a paragraph break inside a verse glued two words together: ' + JSON.stringify(byV['12']));
  assert.equal(byV['13'], 'Who has understood the Spirit of the Lord, or instructed him as his counselor?',
    'A HEADING WITH AN UNCLOSED STYLE ATE THE REST OF THE VERSE: ' + JSON.stringify(byV['13']));
  // THE HTML IS UNTOUCHED: the reader still renders the heading where the module put it.
  assert.match(rows.find(r => String(r.v) === '8').html, /<span class="sec">Here Is Your God!<\/span>/,
    'the heading was removed from the reader’s html too — only `text` was meant to change');
  // search() walks plain() → the same `text`, so a heading is no longer a search hit on the verse before it.
  const hits = Bible.search('Here Is Your God', 10).filter(h => h.chap === 40);
  assert.equal(hits.length, 0, 'searching for a heading still finds the verse before it: ' + JSON.stringify(hits));
  assert.equal(Bible.search('fall, but the word', 10).length, 1, 'a phrase that runs across a poetry break is not found');
});
