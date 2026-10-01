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


// ── OWNER, 2026-10-01 (audit of 3fe46eb, finding 6): A PSALM TITLE IS SCRIPTURE ──────────────────────────────
// parseUSFM renders \d like a heading, and the first version of usfmText dropped it with the headings. The
// owner's ruling: keep the Psalm title's words in the verse text (it is part of the canonical text, numbered as
// verse 1 in the Hebrew); keep dropping section headings (\s), parallel references (\r) and the major-section
// headings \ms / \mr, which are editorial.
const PSALMS = [
  '\\id PSA',
  '\\c 1',
  '\\ms BOOK I',
  '\\mr (Psalms 1–41)',
  '\\q1',
  '\\v 1 Blessed is the man who does not walk in the counsel of the wicked,',
  // Re-audit of 3fe46eb finding 7: a heading whose character style is never closed, directly before a \v (no
  // poetry line between them), and another mid-verse directly before a \qc line.
  '\\c 2',
  '\\s1 The \\nd Lord’s Anointed',
  '\\v 1 Why do the nations rage',
  '\\q2 and the peoples plot in vain?',
  '\\v 2 The kings of the earth take their stand',
  '\\s1 Against the \\nd Lord',
  '\\qc and the rulers gather together,',
  '\\q1 against the Lord.',
  '\\c 3',
  '\\d A Psalm of David, when he fled from his son Absalom.',
  '\\q1',
  '\\v 1 O Lord, how my foes have increased!',
  '\\q2 How many rise up against me!',
  // Audit of a3c7c9b (2026-10-01): a Psalm title and verse 1 on ONE line, both shapes.
  '\\c 4',
  '\\d \\v 1 For the director of music. With stringed instruments. A psalm of David.',
  '\\q1',
  '\\v 2 Answer me when I call to you,',
  '\\c 5',
  '\\d For the director of music. \\v 1 Listen to my words, Lord,',
  '\\q2 consider my lament.',
  // …a Psalm title whose character style is never closed (SB16), and a heading with two STRAY closers (SB15).
  '\\c 10',
  '\\d A song of \\nd David',
  '\\q1',
  '\\v 1 Why, Lord, do you stand far off?',
  '\\c 11',
  '\\q1',
  '\\v 1 In the Lord I take refuge.',
  '\\s1 Selah \\wj* Interlude\\nd*',
  '\\q1 How can you say to me,',
].join('\n');
// The Song of Songs, with speaker labels (\sp) as the World English Bible carries them.
const SONG = [
  '\\id SNG',
  '\\c 1',
  '\\sp Beloved',
  '\\q1',
  '\\v 2 Let him kiss me with the kisses of his mouth;',
  '\\sp Lover',
  '\\q1',
  '\\v 3 Your oils have a pleasing fragrance.',
].join('\n');
// span / i balance over one verse's html — what inlineUSFM and parseUSFM emit
function unbalanced(html) {
  const st = [], bad = []; const re = /<(\/?)(span|i)\b[^>]*>/g; let t;
  while ((t = re.exec(html))) { if (!t[1]) st.push(t[2]); else if (st.length && st.at(-1) === t[2]) st.pop(); else bad.push('stray </' + t[2] + '>'); }
  return [...st.map(x => 'unclosed <' + x + '>'), ...bad];
}

test('a Psalm title stays in the verse text and can be searched; major-section headings still go', async () => {
  const Bible = realBible();
  const r = await Bible.loadModuleBytes(new TextEncoder().encode(PSALMS), 'psa.usfm', { abbr: 'PST', name: 'Psalms Test', category: 'bibles' });
  assert.equal(r.kind, 'bible', 'fixture: the Psalms did not load');
  const v31 = Bible.getVerses(19, 3, 'PST').find(x => String(x.v) === '1');
  assert.ok(v31, 'fixture: Psalm 3:1 is missing');
  assert.equal(v31.text, 'A Psalm of David, when he fled from his son Absalom. O Lord, how my foes have increased! How many rise up against me!',
    'THE PSALM TITLE IS NOT IN PSALM 3:1’s TEXT — copy, share, read-aloud and Verse of the Day drop scripture: ' + JSON.stringify(v31.text));
  const hits = Bible.search('Absalom', 10, 'PST');
  assert.equal(hits.length, 1, 'a word found only in a Psalm title is not found by search: ' + JSON.stringify(hits.map(h => h.ref)));
  assert.equal(hits[0].chap, 3, 'the title search found the wrong psalm');
  const v11 = Bible.getVerses(19, 1, 'PST').find(x => String(x.v) === '1');
  assert.equal(v11.text, 'Blessed is the man who does not walk in the counsel of the wicked,',
    'a major-section heading (\\ms / \\mr) leaked into Psalm 1:1: ' + JSON.stringify(v11.text));
  // the reader still renders the title as a heading (the .sec rule in index.html matches it)
  assert.match(v31.html, /<span class="sec d">A Psalm of David/, 'the Psalm title no longer renders as a heading in the reader');
});


test('a heading with an unclosed style never takes verse words with it — before a \\v, before a \\qc', async () => {
  const Bible = realBible();
  await Bible.loadModuleBytes(new TextEncoder().encode(PSALMS), 'psa.usfm', { abbr: 'PST', name: 'Psalms Test', category: 'bibles' });
  const ch2 = Bible.getVerses(19, 2, 'PST');
  const byV = Object.fromEntries(ch2.map(r => [String(r.v), r]));
  assert.equal(byV['1'].text, 'Why do the nations rage and the peoples plot in vain?',
    'PSALM 2:1 LOST ITS WORDS to the unclosed heading before it: ' + JSON.stringify(byV['1'].text));
  assert.equal(byV['2'].text, 'The kings of the earth take their stand and the rulers gather together, against the Lord.',
    'a mid-verse heading with an unclosed style ate the \\qc line after it: ' + JSON.stringify(byV['2'].text));
  // …and in the READER the heading closes before the verse: an open heading span would style the whole verse
  // as a heading. The heading's own markup is closed inside it.
  assert.ok(byV['1'].html.includes('<span class="sec">The <span class="nd">Lord’s Anointed</span></span>Why'),
    'the heading span is not closed before Psalm 2:1’s words in the reader’s html: ' + JSON.stringify(byV['1'].html));
});

test('the reader still styles a Psalm title as a heading — the .sec rule matches the two-class span', async () => {
  // index.html ships as-is (no bundler), and a CSS class selector matches any element whose class LIST holds
  // the class — so `.reader-body .sec` styles the title span as long as its class list contains `sec`.
  // Pinned on both sides: the rule in the shipped stylesheet, and the class list the shipped parser writes.
  const html = readFileSync(ROOT + 'index.html', 'utf8');
  assert.match(html, /\.reader-body \.sec \{[^}]*display: block/, 'the reader’s heading rule for .sec is gone or renamed');
  const Bible = realBible();
  await Bible.loadModuleBytes(new TextEncoder().encode(PSALMS), 'psa.usfm', { abbr: 'PST', name: 'Psalms Test', category: 'bibles' });
  const v31 = Bible.getVerses(19, 3, 'PST').find(x => String(x.v) === '1');
  const cls = ((v31.html.match(/<span class="([^"]*)">A Psalm of David/) || [])[1] || '').split(/\s+/);
  assert.ok(cls.includes('sec'), 'the Psalm title span no longer carries the `sec` class, so the reader no longer styles it as a heading: ' + JSON.stringify(cls));
});

test('usfmText, handed a heading span that never closes, keeps the words after it', () => {
  // parseUSFM always balances a heading (above), so this is the defensive half: if malformed html ever reaches
  // usfmText, the heading's opening tag goes and the words stay — dropping scripture is the worse failure.
  // Lifted from the shipped engine.js (which ships as-is, no bundler).
  const E = readFileSync(ROOT + 'engine.js', 'utf8');
  const fn = (name) => { const at = E.indexOf('function ' + name + '('); assert.notEqual(at, -1, name + ' is gone from engine.js');
    let d = 0; for (let i = E.indexOf('{', at); i < E.length; i++) { if (E[i] === '{') d++; else if (E[i] === '}' && --d === 0) return E.slice(at, i + 1); } };
  const usfmText = new Function(fn('stripTags') + fn('usfmText') + '; return usfmText;')();
  const out = usfmText('<span class="sec">Heading <span class="nd">Lord</span> and the words of the verse');
  assert.match(out, /and the words of the verse$/, 'malformed heading markup took the verse’s words with it: ' + JSON.stringify(out));
});

// ── AUDIT OF a3c7c9b (2026-10-01) ────────────────────────────────────────────────────────────────────────────
test('a Psalm title on the same line as verse 1: the title stays in verse 1, and verse 1 keeps its words', async () => {
  const Bible = realBible();
  await Bible.loadModuleBytes(new TextEncoder().encode(PSALMS), 'psa.usfm', { abbr: 'PST', name: 'Psalms Test', category: 'bibles' });
  const ch4 = Object.fromEntries(Bible.getVerses(19, 4, 'PST').map(r => [String(r.v), r.text]));
  assert.equal(ch4['1'], 'For the director of music. With stringed instruments. A psalm of David.',
    'PSALM 4:1 (`\\d \\v 1 …` on one line) LOST ITS WORDS: ' + JSON.stringify(ch4));
  assert.equal(ch4['2'], 'Answer me when I call to you,', 'Psalm 4:2 begins with the words of verse 1: ' + JSON.stringify(ch4['2']));
  const ch5 = Bible.getVerses(19, 5, 'PST');
  assert.ok(ch5.length, 'PSALM 5 HAS NO VERSES — `\\d Title \\v 1 words` on one line swallowed the chapter');
  assert.equal(ch5[0].text, 'For the director of music. Listen to my words, Lord, consider my lament.',
    'Psalm 5:1 does not read as its title and its words: ' + JSON.stringify(ch5[0].text));
});

test('a speaker label (\\sp) is a label, not scripture: shown as a heading, left out of the verse and search', async () => {
  const Bible = realBible();
  await Bible.loadModuleBytes(new TextEncoder().encode(SONG), 'sng.usfm', { abbr: 'SNT', name: 'Song Test', category: 'bibles' });
  const rows = Object.fromEntries(Bible.getVerses(22, 1, 'SNT').map(r => [String(r.v), r]));
  assert.equal(rows['2'].text, 'Let him kiss me with the kisses of his mouth;', 'a speaker label leaked into the verse: ' + JSON.stringify(rows['2'].text));
  assert.equal(rows['3'].text.includes('Lover'), false, 'a speaker label leaked into the verse after it: ' + JSON.stringify(rows['3'].text));
  assert.match(rows['2'].html, /<span class="sec sp">Beloved<\/span>/, 'the reader no longer shows the speaker label');
  assert.equal(Bible.search('Beloved', 10, 'SNT').length, 0, 'searching a speaker label finds a verse');
});

test('a heading’s markup is balanced inside it — a stray closer is dropped (SB15), an unclosed title is closed (SB16)', async () => {
  const Bible = realBible();
  await Bible.loadModuleBytes(new TextEncoder().encode(PSALMS), 'psa.usfm', { abbr: 'PST', name: 'Psalms Test', category: 'bibles' });
  const v111 = Bible.getVerses(19, 11, 'PST').find(r => String(r.v) === '1');
  assert.equal(v111.text, 'In the Lord I take refuge. How can you say to me,',
    'A HEADING WITH A STRAY CLOSER LEAKED INTO THE VERSE: ' + JSON.stringify(v111.text));
  const v101 = Bible.getVerses(19, 10, 'PST').find(r => String(r.v) === '1');
  assert.equal(v101.text, 'A song of David Why, Lord, do you stand far off?', 'Psalm 10:1 does not read as its title and its words');
  // every verse the reader renders is balanced, so no heading span stays open over the words after it
  for (const ch of [1, 2, 3, 4, 5, 10, 11]) {
    for (const r of Bible.getVerses(19, ch, 'PST')) {
      assert.deepEqual(unbalanced(r.html), [], `Psalm ${ch}:${r.v}'s html is unbalanced — the reader styles the verse as a heading: ${r.html}`);
    }
  }
});

// ── AUDIT OF b4ac50d, item 6: PSALM 119's ACROSTIC LETTERS ───────────────────────────────────────────────────
// The BSB marks them \qa (19 of its stanza letters glued onto the verse before: "…forsake me. BETH"); the World
// English Bible marks them \d (and 119:1 began "ALEPH"). Both are labels. A \d elsewhere stays scripture —
// Habakkuk 3:19 ends with one, in the ASV that ships.
const ACROSTIC = (mark) => [
  '\\id PSA', '\\c 119',
  mark + ' ALEPH', '\\q1', '\\v 1 Blessed are those whose way is blameless,',
  '\\q1', '\\v 8 I will keep your statutes; do not utterly forsake me.',
  mark + ' BETH', '\\q1', '\\v 9 How can a young man keep his way pure?',
].join('\n');
test('Psalm 119’s acrostic letters are labels, not scripture — the BSB’s \\qa and the WEB’s \\d alike', async () => {
  for (const [mark, abbr] of [['\\qa', 'QA'], ['\\d', 'DL']]) {
    const Bible = realBible();
    await Bible.loadModuleBytes(new TextEncoder().encode(ACROSTIC(mark)), abbr + '.usfm', { abbr, name: abbr + ' Test', category: 'bibles' });
    const byV = Object.fromEntries(Bible.getVerses(19, 119, abbr).map(r => [String(r.v), r]));
    assert.equal(byV['8'].text, 'I will keep your statutes; do not utterly forsake me.',
      mark + ': THE NEXT STANZA’S LETTER IS GLUED ONTO THE VERSE: ' + JSON.stringify(byV['8'].text));
    assert.equal(byV['1'].text, 'Blessed are those whose way is blameless,', mark + ': Psalm 119:1 begins with its letter: ' + JSON.stringify(byV['1'].text));
    assert.match(byV['8'].html, /<span class="sec qa">BETH<\/span>/, mark + ': the reader no longer shows the stanza letter');
    assert.equal(Bible.search('BETH', 10, abbr).length, 0, mark + ': searching a stanza letter finds a verse');
  }
});
test('…and a \\d that is not one of Psalm 119’s letters stays scripture (Habakkuk 3:19)', async () => {
  const HAB = ['\\id HAB', '\\c 3', '\\q1', '\\v 19 The Lord God is my strength.', '\\d For the Chief Musician, on my stringed instruments.'].join('\n');
  const Bible = realBible();
  await Bible.loadModuleBytes(new TextEncoder().encode(HAB), 'hab.usfm', { abbr: 'HB', name: 'Hab Test', category: 'bibles' });
  const v19 = Bible.getVerses(35, 3, 'HB').find(r => String(r.v) === '19');
  assert.equal(v19.text, 'The Lord God is my strength. For the Chief Musician, on my stringed instruments.',
    'HABAKKUK 3:19’s CLOSING LINE (a \\d) WAS DROPPED AS A LABEL: ' + JSON.stringify(v19.text));
});
