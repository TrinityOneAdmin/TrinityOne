// WORD DEFINITIONS REACH THE READER — a "Define" button on the verse card, a sheet of word chips, WordNet meanings.
// Run: node --test scripts/word-definitions-reach-the-reader.test.mjs
//
// Owner 2026-10-14 (roadmap "word definitions without Strong's"): the Strong's lexicon answers only on TAGGED
// Bibles; BSB has no tags, so a member reading BSB could look nothing up. scripts/build-worddefs.mjs turns
// WordNet 3.0 (filtered to the shipped Bibles' vocabulary) into modules/worddefs-wordnet.json; engine.js
// getDefinition/defineText query it; the verse card's Define button opens DefineSheet.
//
// Chain asserted (CLAUDE.md rules 1 and 3): the build script over a tiny real-format WordNet fixture; the file
// that SHIPS against its catalogue pin; engine.js's OWN getDefinition/defineText lifted and run over that file;
// then the REAL ActionSheet and DefineSheet drawn through the repo's mini-React, a real tap on Define, a real
// tap on a chip. Nothing here matches text in app/*.jsx.
//
// NOT ON A DEVICE: rule 6 still applies. Removal/restore of the installed module is in
// every-installed-module-can-be-removed.test.mjs (the WORDDEF tests at the end).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fnBody, stmt } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts, reads, button } from './render-jsx-screen.mjs';
import { build, usfmWords, cleanGloss, MAX_SENSES } from './build-worddefs.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ENGINE = readFileSync(ROOT + 'engine.js', 'utf8');
const CATALOG = JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8'));
const MODULE_URL = 'modules/worddefs-wordnet.json';
const MODULE = JSON.parse(readFileSync(ROOT + MODULE_URL, 'utf8'));

// ── a tiny WordNet in the REAL file format ────────────────────────────────────────────────
const LICENCE_LINE = '  1 This software and database is being provided to you, the LICENSEE, by  \n';
const FIXTURE = {
  'data.noun': LICENCE_LINE +
    '00000010 03 n 01 love 0 000 | a strong positive emotion; "she felt love for him"\n' +
    '00000020 05 n 01 lamb 0 000 | young sheep; "the lamb was white"\n' +
    '00000030 05 n 01 Paul 0 000 | apostle to the Gentiles\n' +
    '00000040 05 n 02 grace 0 00 favor 0 000 | elegance of movement\n' +
    '00000050 05 n 01 grace 0 000 | a prayer before a meal\n' +
    '00000060 05 n 01 grace 0 000 | divine favour\n' +
    '00000070 05 n 01 grace 0 000 | a period of respite\n',
  'index.noun': LICENCE_LINE +
    'love n 1 1 @ 1 1 00000010  \n' +
    'lamb n 1 1 @ 1 0 00000020  \n' +
    'paul n 1 1 @ 1 0 00000030  \n' +
    'grace n 4 1 @ 4 0 00000040 00000050 00000060 00000070  \n',
  'data.verb': LICENCE_LINE +
    '00000110 32 v 01 love 0 000 | have a great affection for\n' +
    '00000120 38 v 01 walk 0 000 | use one\'s feet to advance\n' +
    '00000130 38 v 01 beget 0 000 | make children\n',
  'index.verb': LICENCE_LINE +
    'love v 1 1 @ 1 1 00000110  \n' + 'walk v 1 1 @ 1 0 00000120  \n' + 'beget v 1 1 @ 1 0 00000130  \n',
  'data.adj': '', 'index.adj': '', 'data.adv': '', 'index.adv': '',
  'verb.exc': 'begat beget\n', 'noun.exc': 'lambs lamb\n', 'adj.exc': '', 'adv.exc': '',
  // love as a verb is the tagged (common) sense; as a noun it is never tagged
  'index.sense': 'love%2:37:00:: 00000110 1 5\nlove%1:12:00:: 00000010 2 0\n',
};
const FIXTURE_VOCAB = new Set(['love', 'loved', 'loves', 'lambs', 'paul', 'walked', 'walketh', 'begat', 'zzzz', 'grace']);

test('BUILD: inflections resolve to headwords, including KJV endings and irregulars', () => {
  const m = build(FIXTURE, FIXTURE_VOCAB);
  assert.equal(m.meta.kind, 'worddef');
  assert.equal(m.forms.loved, 'love', 'loved -> love');
  assert.equal(m.forms.loves, 'love', 'loves -> love');
  assert.equal(m.forms.lambs, 'lamb', 'a noun.exc irregular -> its lemma');
  assert.equal(m.forms.walked, 'walk', 'walked -> walk');
  assert.equal(m.forms.walketh, 'walk', 'KJV -eth -> base');
  assert.equal(m.forms.begat, 'beget', 'a verb.exc irregular -> its lemma');
  assert.ok(!('love' in m.forms), 'a headword must not point at itself');
});

test('BUILD: the dictionary only covers words that are in the Bibles, drops proper nouns, strips examples, caps senses', () => {
  const m = build(FIXTURE, FIXTURE_VOCAB);
  assert.ok(m.defs.love && m.defs.lamb && m.defs.walk && m.defs.beget);
  assert.ok(!('zzzz' in m.defs) && !('zzzz' in m.forms), 'a word WordNet does not know appeared');
  assert.ok(!('paul' in m.defs), 'a proper noun (Paul) was given a common-noun definition');
  assert.equal(m.defs.lamb[0][1], 'young sheep', 'the quoted example sentence was not stripped');
  assert.ok(m.defs.grace.length <= MAX_SENSES && m.defs.grace.length === 3, 'senses are not capped at ' + MAX_SENSES);
  assert.deepEqual(m.defs.love[0], ['v', 'have a great affection for'], 'the tagged (most-used) sense is not first');
  assert.equal(cleanGloss('a thing; "an example"; "another"'), 'a thing');
});

test('BUILD: usfmWords reads verse text only - no footnotes, Strong\'s tags, headings or markers', () => {
  const usfm = '\\id JHN - Berean\n\\h John\n\\s1 The Beginning Heading\n\\c 1\n\\p\n' +
    '\\v 1 \\w In|strong="G1722"\\w* the beginning \\f + \\ft footnote words here \\f* was the \\w Word|strong="G3056"\\w*.\n';
  const w = usfmWords(usfm);
  assert.deepEqual(w, ['in', 'the', 'beginning', 'was', 'the', 'word']);
});

// ── the file that ships ─────────────────────────────────────────────────────────────────
test('SHIPPED: the module is a pinned dictionaries entry of kind worddef, under 4 MB, with the Princeton notice', () => {
  const cat = CATALOG.categories.find(c => c.id === 'dictionaries');
  const it = cat.items.find(x => x.id === 'worddefs-wordnet');
  assert.ok(it, 'not offered in the Dictionaries category');
  assert.equal(it.kind, 'worddef', 'kind "dict" would put it in the Strong\'s lookup; anything else routes it wrongly');
  assert.equal(it.format, 'JSON');
  assert.equal(it.url, MODULE_URL);
  const bytes = readFileSync(ROOT + MODULE_URL);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), it.sha256, 'catalog pin differs from the file - rerun scripts/build-worddefs.mjs');
  assert.ok(bytes.length < 4 * 1024 * 1024, 'over the 4 MB budget: ' + bytes.length);
  assert.equal(MODULE.meta.kind, 'worddef');
  assert.match(MODULE.meta.license, /WordNet 3\.0/);
  assert.match(MODULE.meta.license, /Princeton University/);
  const sync = readFileSync(ROOT + 'scripts/sync-web.sh', 'utf8');
  assert.ok(sync.includes('modules/worddefs-wordnet.json'), 'not in the BUNDLE_MODULES list in sync-web.sh');
});

test('SHIPPED: the vocabulary covers ordinary Bible words, inflections and KJV forms', () => {
  for (const w of ['love', 'mercy', 'faith', 'shepherd', 'righteousness', 'beginning']) assert.ok(MODULE.defs[w], w + ' has no definition');
  assert.equal(MODULE.forms.loved, 'love');
  assert.equal(MODULE.forms.lambs, 'lamb');
  assert.equal(MODULE.forms.hath, 'have');
  assert.equal(MODULE.forms.cometh, 'come');
  assert.equal(MODULE.forms.begat, 'beget');
  assert.equal(MODULE.forms.men, 'man');
  assert.ok(Object.keys(MODULE.defs).length > 7000, 'suspiciously small dictionary');
  for (const w of Object.keys(MODULE.defs).slice(0, 2000)) assert.ok(MODULE.defs[w].length <= MAX_SENSES);
  for (const [w, h] of Object.entries(MODULE.forms)) assert.ok(MODULE.defs[h], `form ${w} -> ${h} points at nothing`);
});

// ── engine.js's own lookup, lifted and run over the shipped file ─────────────────────────────
function wdEngine(mod = MODULE, { installed = null } = {}) {
  let ensured = 0, notified = 0;
  const src = 'const worddefs = {}; let _worddefsState = "idle"; let _worddefsRequested = false;\n' +
    stmt(ENGINE, 'const _WD_STOP = new Set(') + '\n' +
    fnBody(ENGINE, 'function loadWorddefsJSON(obj, abbr){') + '\n' +
    fnBody(ENGINE, 'function removeWorddefs(abbr){') + '\n' +
    fnBody(ENGINE, 'function worddefsLicense(){') + '\n' +
    fnBody(ENGINE, 'function worddefsState(){') + '\n' +
    fnBody(ENGINE, 'function _wdStems(w){') + '\n' +
    fnBody(ENGINE, 'function getDefinition(word){') + '\n' +
    fnBody(ENGINE, 'function defineText(text){') + '\n' +
    'return { worddefs, loadWorddefsJSON, removeWorddefs, worddefsLicense, worddefsState, getDefinition, defineText };';
  const api = new Function('ensureWorddefs', 'notify', src)(() => { ensured++; }, () => { notified++; });
  if (mod) api.loadWorddefsJSON(mod, 'WN');
  return { ...api, ensured: () => ensured, notified: () => notified };
}

test('ENGINE: getDefinition resolves inflections, KJV forms and falls back to stemming', () => {
  const e = wdEngine();
  const loved = e.getDefinition('Loved');
  assert.equal(loved.word, 'loved'); assert.equal(loved.head, 'love');
  assert.ok(loved.senses.length >= 1 && loved.senses[0].pos && loved.senses[0].gloss);
  assert.match(loved.license, /Princeton/);
  assert.equal(e.getDefinition('hath').head, 'have');
  assert.equal(e.getDefinition("shepherd’s").head, 'shepherd', 'a possessive is not looked up with its \'s');
  assert.equal(e.getDefinition('zxqvw'), null);
  assert.equal(e.getDefinition(''), null);
  assert.ok(e.ensured() >= 1, 'getDefinition never asked for the module to be installed');
  // the fallback stemmer, over a module with NO forms table
  const bare = wdEngine({ meta: { abbr: 'WN', license: 'L' }, defs: { walk: [['v', 'move on foot']], happy: [['adj', 'glad']], stop: [['v', 'halt']] }, forms: {} });
  assert.equal(bare.getDefinition('walking').head, 'walk');
  assert.equal(bare.getDefinition('walked').head, 'walk');
  assert.equal(bare.getDefinition('stopped').head, 'stop', 'a doubled consonant was not undone');
  assert.equal(bare.getDefinition('walks').head, 'walk');
});

test('ENGINE: defineText drops stopwords, short words, markup and repeats, in verse order', () => {
  const e = wdEngine();
  const out = e.defineText('<sup>1</sup> In the beginning God loved the world; and he loved it. <i>Thou</i> hath G3056 an of!');
  const words = out.map(d => d.word);
  assert.ok(words.includes('beginning') && words.includes('loved') && words.includes('world'));
  assert.ok(words.indexOf('beginning') < words.indexOf('loved') && words.indexOf('loved') < words.indexOf('world'), 'not in verse order');
  for (const stop of ['the', 'and', 'he', 'it', 'thou', 'hath', 'an', 'of', 'in']) assert.ok(!words.includes(stop), stop + ' should be hidden');
  assert.equal(words.filter(w => w === 'loved').length, 1, 'a repeated word was listed twice');
  assert.ok(!words.some(w => /^\d|^g\d/.test(w)), 'markup leaked in as a word');
  assert.deepEqual(e.defineText(''), []);
  assert.deepEqual(e.defineText(null), []);
  // loved and love are one headword: one chip, not two
  const two = e.defineText('love loved loves').map(d => d.head);
  assert.deepEqual(two, ['love']);
});

// ── POINT OF USE: the verse card and the sheet it opens ──────────────────────────────────
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function screens(eng, extraBible = {}) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const retries = [];
  const win = {
    Bible: {
      defineText: eng.defineText, getDefinition: eng.getDefinition, worddefsLicense: eng.worddefsLicense, worddefsState: eng.worddefsState,
      retryWorddefs: () => retries.push(1), subscribe: () => () => {}, ...extraBible,
    },
    sanitizeHtml: h => h, innerWidth: 360,
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
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'),
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', {}, children) : null),
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'),
    IconBtn: ({ name, onClick, title }) => React.createElement('button', { onClick, 'aria-label': title || name }, name),
    Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
  };
  const { ActionSheet, DefineSheet } = loadScreen('app/screens-read.jsx', ['ActionSheet', 'DefineSheet'], globals);
  return { React, draw, ActionSheet, DefineSheet, retries };
}

test('POINT OF USE: the verse card has a Define button (one verse and several), and tapping it calls the card\'s define action', () => {
  const eng = wdEngine();
  const s = screens(eng);
  for (const multi of [1, 3]) {
    let defined = 0;
    const ctx = { _define: () => { defined++; }, _copy() {}, _share() {}, _bm() {}, _shrink() {}, _extend() {} };
    const tree = s.draw(s.ActionSheet, { label: 'John 3:16', ctx, open: true, onClose() {}, onColor() {}, multi, hasNote: false });
    const b = button(tree, 'Define');
    assert.equal(b.length, 1, `no Define button on the card (multi=${multi})`);
    b[0].props.onClick();
    assert.equal(defined, 1, 'the Define button does not call ctx._define');
  }
});

test('POINT OF USE: the Define sheet shows word chips and a tapped chip\'s meanings, "loved -> love", and the WordNet notice', () => {
  const eng = wdEngine();
  const s = screens(eng);
  const props = { label: 'John 3:16', text: 'For God so loved the world, that he gave his only begotten Son', open: true, onClose() {} };
  let tree = s.draw(s.DefineSheet, props);
  const chips = find(tree, n => n.type === 'button' && n.props['aria-pressed'] !== undefined);
  assert.ok(chips.length >= 4, 'few or no word chips: ' + chips.length);
  const labels = chips.map(c => reads(c));
  assert.ok(labels.includes('loved') && labels.includes('world'), 'chips: ' + labels);
  assert.ok(!labels.includes('the') && !labels.includes('for') && !labels.includes('that'), 'stopwords were shown as chips');
  // The licence is a pill now (owner 2026-10-15): the full WordNet notice is behind a tap, not a standing line.
  const pill = find(tree, n => n.type === 'button' && n.props['data-testid'] === 'define-licence-pill');
  assert.equal(pill.length, 1, 'no licence pill');
  pill[0].props.onClick();
  tree = s.draw(s.DefineSheet, props);
  const page = reads(tree);
  assert.equal(chips[0].props['aria-pressed'], true, 'the first chip is not selected');
  const first = eng.defineText(props.text)[0];
  assert.ok(page.includes(first.senses[0].gloss), 'the first word\'s meaning is not shown');
  assert.match(page, /WordNet 3\.0/, 'the WordNet attribution is not shown');
  assert.match(page, /Princeton University/);
  // tap "loved": the heading shows the lemmatised form and the verb meaning
  chips[labels.indexOf('loved')].props.onClick();
  tree = s.draw(s.DefineSheet, props);
  const after = reads(tree);
  assert.match(after, /loved\s*\u2192\s*love/, 'a lemmatised word does not show "loved -> love"');
  assert.ok(after.includes(eng.getDefinition('loved').senses[0].gloss), 'the tapped word\'s meaning is not shown');
});

test('POINT OF USE: the WordNet licence is a small pill; the full text is hidden until it is tapped, and tapping again hides it', () => {
  const eng = wdEngine();
  const s = screens(eng);
  const props = { label: 'John 3:16', text: 'For God so loved the world', open: true, onClose() {} };
  let tree = s.draw(s.DefineSheet, props);
  const pill = () => find(tree, n => n.type === 'button' && n.props['data-testid'] === 'define-licence-pill');
  assert.equal(pill().length, 1, 'no licence pill');
  assert.equal(reads(pill()[0]), 'WordNet licence');
  assert.ok(!/Princeton University/.test(reads(tree)), 'the full licence is still a standing line under the definitions');
  assert.ok(/Princeton University/.test(String(pill()[0].props.title)), 'the licence is not reachable on hover');
  pill()[0].props.onClick();
  tree = s.draw(s.DefineSheet, props);
  assert.match(reads(tree), /WordNet 3\.0/);
  assert.match(reads(tree), /Princeton University/, 'tapping the pill does not show the licence');
  pill()[0].props.onClick();
  tree = s.draw(s.DefineSheet, props);
  assert.ok(!/Princeton University/.test(reads(tree)), 'a second tap does not hide it');
});

test('POINT OF USE: while the dictionary downloads the sheet says so; a failed download offers Try again; nothing-to-define is stated', () => {
  const empty = wdEngine(null);
  const s = screens(empty);
  const props = { label: 'John 1:1', text: 'In the beginning', open: true, onClose() {} };
  assert.match(reads(s.draw(s.DefineSheet, props)), /Downloading dictionary/, 'no downloading state');
  const failed = screens(empty, { worddefsState: () => 'failed' });
  const tree = failed.draw(failed.DefineSheet, props);
  assert.match(reads(tree), /Couldn't download the dictionary/);
  const retry = button(tree, 'Try again');
  assert.equal(retry.length, 1, 'no retry control after a failed download');
  const sawOnOpen = failed.retries.length;
  assert.equal(sawOnOpen, 1, 'opening the sheet after a failure should retry once (and only once, or it loops)');
  retry[0].props.onClick();
  assert.equal(failed.retries.length, sawOnOpen + 1, 'Try again does not call retryWorddefs');
  const ready = screens(wdEngine());
  assert.match(reads(ready.draw(ready.DefineSheet, { ...props, text: 'in the of and' })), /No common words to define/);
});

test('POINT OF USE: a closed sheet looks nothing up (the card must not download the dictionary until Define is tapped)', () => {
  const eng = wdEngine();
  const s = screens(eng);
  const before = eng.ensured();
  s.draw(s.DefineSheet, { label: 'x', text: 'In the beginning', open: false, onClose() {} });
  assert.equal(eng.ensured(), before, 'a closed DefineSheet still looked words up');
});

// ── POINT OF USE, WHOLE SCREEN: the real ReadScreen, a real verse tap, the real Define tile ───────────
// Delete the tile, the `_define` wiring or the <DefineSheet> mount in screens-read.jsx and this goes red.
function liftEngineRefs() {
  const a = ENGINE.indexOf('  const BOOK_NAMES = [');
  const b = ENGINE.indexOf('  const USFM_BOOK = {');
  const c = ENGINE.indexOf('  function refLabel(loc, v)');
  const d = ENGINE.indexOf('\n', ENGINE.indexOf('  function refKey(loc, v)'));
  assert.ok(a > 0 && b > a && c > b && d > c, 're-anchor: engine.js reference helpers moved');
  return new Function(ENGINE.slice(a, b) + ENGINE.slice(c, d) + '\nreturn { bookName, parseRef, refLabel, refKey };')();
}
function wholeReader(eng, verseTextFor) {
  const ENG = liftEngineRefs();
  const { React, draw } = miniReact();
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    TrinityData: { PLANS: [], VOTD_POOL: [], CROSSREFS: {} }, Fellowship: {}, speechSynthesis: null, sanitizeHtml: (h) => h,
  };
  const base = {
    React, window: win, localStorage: win.localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null },
    navigator: { userAgent: '', clipboard: { writeText: () => Promise.resolve() } },
    location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    history: { back() {}, pushState() {}, replaceState() {}, state: null },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { BottomSheet, useBackLayer, IconBtn } = loadScreen('app/ui.jsx', ['BottomSheet', 'useBackLayer', 'IconBtn'], { ...base, Icon });
  win.Bible = {
    loaded: true, activeVersion: 'BSB',
    books: () => [43], bookMeta: () => [{ n: 43, name: 'John', chapters: 21, group: 'nt' }],
    bookName: ENG.bookName, getVerses: (b, c) => Array.from({ length: 30 }, (_, i) => ({ v: i + 1, text: verseTextFor(i + 1), html: verseTextFor(i + 1) })),
    maxChapter: () => 21, refLabel: ENG.refLabel, parseRef: ENG.parseRef, refKey: ENG.refKey,
    defaultLoc: () => ({ book: 43, chap: 3 }), versions: () => [{ abbr: 'BSB', name: 'Berean Standard Bible' }],
    step: () => null, subscribe: () => () => {}, getCommentary: () => null, lex: () => ({ missing: true }),
    getCatalog: async () => [], isInstalled: () => true, isInstalling: () => false, installModule: async () => ({}),
    defineText: eng.defineText, getDefinition: eng.getDefinition, worddefsLicense: eng.worddefsLicense, worddefsState: eng.worddefsState,
    retryWorddefs() {},
  };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], {
    ...base, BottomSheet, useBackLayer, IconBtn, Icon, Bible: win.Bible,
    Sheet: Stub('Sheet'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'), EmptyState: Stub('EmptyState'), ReadPlansTabs: Stub('ReadPlansTabs'),
    ChurchBadge: Stub('ChurchBadge'), Overlay: Stub('Overlay'),
    cx: (...a) => a.filter(Boolean).join(' '), lsGet: (k, d) => d, lsSet: () => {}, todayISO: () => '2026-10-14',
    useTrinityAudio: () => ({ track: null, playing: false }),
  });
  const ctx = {
    loc: { book: 43, chap: 3 }, version: 'BSB', setLoc(x) { ctx.loc = { ...x }; }, toast() {}, toggleBookmark() {}, bookmarks: [], highlights: {},
    openShareSheet() {}, plans: [], planProgress: {}, church: { name: 'Test Church' }, notes: {}, setNote() {}, setHighlight() {},
  };
  let tree = draw(ReadScreen, { ctx });
  const redraw = () => { tree = draw(ReadScreen, { ctx }); return tree; };
  redraw();
  return {
    redraw, tree: () => tree,
    tapVerse(n) {
      const row = find(tree, x => x.props && x.props.id === 'rv-' + n)[0];
      assert.ok(row, 'no verse row ' + n);
      (find(row, x => x.props && typeof x.props.onClick === 'function')[0] || row).props.onClick({ target: {}, stopPropagation() {} });
      return redraw();
    },
    tile(label) { return find(tree, x => x.type === 'button' && x.props && x.props.style && x.props.style.borderRadius === 16 && reads(x) === label)[0]; },
    press(b) { b.props.onClick(); return redraw(); },
    chips: () => find(tree, n => n.type === 'button' && n.props['aria-pressed'] !== undefined),
    sheetOpen: () => find(tree, n => n.props && n.props['data-testid'] === 'define-chips').length > 0,
  };
}

test('POINT OF USE (whole reader): tap a verse -> Define -> a sheet of its words and their meanings; close returns to the card with the verse still selected', () => {
  const eng = wdEngine();
  const R = wholeReader(eng, (v) => v === 16 ? 'For God so loved the world that he gave his one and only Son' : 'Plain verse ' + v + ' text');
  R.tapVerse(16);
  const define = R.tile('Define');
  assert.ok(define, 'the verse card has no Define tile');
  assert.equal(R.sheetOpen(), false, 'the Define sheet is open before it was asked for');
  R.press(define);
  assert.equal(R.sheetOpen(), true, 'tapping Define did not open the Define sheet');
  const labels = R.chips().map(c => reads(c));
  assert.deepEqual(labels.slice(0, 3), ['god', 'loved', 'world'], 'chips are not this verse\'s words, in order: ' + labels);
  const licPill = find(R.tree(), n => n.type === 'button' && n.props['data-testid'] === 'define-licence-pill');
  assert.equal(licPill.length, 1, 'the licence pill is not on the sheet');
  R.press(licPill[0]);
  assert.match(reads(R.tree()), /Princeton University/, 'the attribution is not reachable from the sheet');
  // close with the sheet's own X: the card comes back and the verse is still the selection
  const xs = find(R.tree(), n => n.type === 'button' && n.props.onClick && find(n, i => i.props && i.props.name === 'x').length);
  assert.ok(xs.length, 'no close control on the Define sheet');
  R.press(xs[xs.length - 1]);
  assert.equal(R.sheetOpen(), false, 'the X did not close the Define sheet');
  assert.ok(R.tile('Copy'), 'closing Define did not return to the verse card');
  assert.match(reads(R.tree()), /John 3:16/, 'closing Define lost the selection');
});
