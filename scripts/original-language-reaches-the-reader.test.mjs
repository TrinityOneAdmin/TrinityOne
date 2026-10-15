// ORIGINAL LANGUAGE REACHES THE READER (D10 phase 1b) — the screen half of original-language-modules.test.mjs.
// Run: node --test scripts/original-language-reaches-the-reader.test.mjs
//
// Chain: engine.js's OWN getOriginal/hasOriginal/originalList lifted and run over a small fixture module, then the REAL
// ReadScreen drawn through the repo's mini-React: a real tap on a Strong's superscript opens WordStudySheet with the
// verse's original form; a real tap on the verse card's Original tile lists the verse's words on an UNTAGGED Bible and a
// word opens the lexicon sheet; with no module installed the download offer calls installModule. Nothing here matches
// text in app/*.jsx (CLAUDE.md rule 3). NOT ON A DEVICE (rule 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ENGINE = readFileSync(ROOT + 'engine.js', 'utf8');
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// engine.js's own original-language functions over a fixture `originals` map (John 1:1 Greek)
function liftOriginals(installed) {
  const a = ENGINE.indexOf('  function _strongBase(s)');
  const b = ENGINE.indexOf('\n', ENGINE.indexOf('  function hasOriginal(lang)'));
  assert.ok(a > 0 && b > a, 're-anchor: engine.js original helpers moved');
  const originals = installed ? {
    TAGNT: { name: 'Greek NT', lang: 'greek', license: 'STEPBible.org CC BY', v: { '43.1.1': [['Ἐν', 'En', 'G1722', 'PREP'], ['λόγος', 'logos', 'G3056G', 'N-NSM'], ['θεόν', 'theon', 'G2316', 'N-ASM']] } },
  } : {};
  const api = new Function('originals', ENGINE.slice(a, b) + '\nreturn { getOriginal, hasOriginal, originalList };')(originals);
  return { api, originals };
}

function reader({ installed, tagged }) {
  const { api, originals } = liftOriginals(installed);
  const { React, draw } = miniReact();
  const subs = [];
  const installs = [];
  const base = {
    React, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null },
    navigator: { userAgent: '', clipboard: { writeText: () => Promise.resolve() } }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    history: { back() {}, pushState() {}, replaceState() {}, state: null }, fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage: base.localStorage,
    TrinityData: { PLANS: [], VOTD_POOL: [], CROSSREFS: {} }, Fellowship: {}, speechSynthesis: null, sanitizeHtml: h => h,
  };
  base.window = win;
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { BottomSheet, useBackLayer, IconBtn } = loadScreen('app/ui.jsx', ['BottomSheet', 'useBackLayer', 'IconBtn'], { ...base, Icon });
  const verseHtml = tagged ? 'In the beginning was the Word<sup class="st" data-s="G3056">G3056</sup>' : 'In the beginning was the Word';
  win.Bible = {
    loaded: true, activeVersion: 'X', books: () => [43], bookMeta: () => [{ n: 43, name: 'John', chapters: 21, group: 'nt' }],
    bookName: () => 'John', getVerses: () => [{ v: 1, text: 'In the beginning was the Word', html: verseHtml }],
    maxChapter: () => 21, refLabel: (l, v) => 'John ' + l.chap + (v ? ':' + v : ''), parseRef: () => null, refKey: (l, v) => l.book + '.' + l.chap + '.' + v,
    defaultLoc: () => ({ book: 43, chap: 1 }), versions: () => [{ abbr: 'X', name: 'X' }], step: () => null,
    subscribe: fn => { subs.push(fn); return () => {}; }, getCommentary: () => null,
    lex: id => (id === 'G3056' ? { id, lang: 'GREEK', lemma: 'λόγος', translit: 'logos', pos: 'noun', short: 'word', def: 'a word', gloss: 'a word' } : { id, missing: true }),
    getCatalog: async () => ({ categories: [{ id: 'dictionaries', items: [{ id: 'original-greek', kind: 'original', lang: 'Greek', url: 'modules/original-greek.json' }] }] }),
    isInstalled: () => true, isInstalling: () => false,
    installModule: async item => { installs.push(item.id); originals.TAGNT = { name: 'Greek NT', lang: 'greek', license: 'STEPBible.org CC BY', v: { '43.1.1': [['λόγος', 'logos', 'G3056', 'N-NSM']] } }; subs.forEach(f => f()); return {}; },
    defineText: () => [], getDefinition: () => null, worddefsLicense: () => '', worddefsState: () => 'ready', retryWorddefs() {},
    getOriginal: api.getOriginal, hasOriginal: api.hasOriginal, originalList: api.originalList,
  };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], {
    ...base, BottomSheet, useBackLayer, IconBtn, Icon, Bible: win.Bible,
    Sheet: Stub('Sheet'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'), EmptyState: Stub('EmptyState'), ReadPlansTabs: Stub('ReadPlansTabs'),
    ChurchBadge: Stub('ChurchBadge'), Overlay: Stub('Overlay'),
    cx: (...a) => a.filter(Boolean).join(' '), lsGet: (k, d) => d, lsSet: () => {}, todayISO: () => '2026-10-15',
    useTrinityAudio: () => ({ track: null, playing: false }),
  });
  const ctx = { loc: { book: 43, chap: 1 }, version: 'X', setLoc(x) { ctx.loc = { ...x }; }, toast() {}, toggleBookmark() {}, bookmarks: [], highlights: {},
    openShareSheet() {}, plans: [], planProgress: {}, church: { name: 'T' }, notes: {}, setNote() {}, setHighlight() {} };
  let tree = draw(ReadScreen, { ctx });
  const redraw = async () => { await new Promise(r => setTimeout(r, 5)); tree = draw(ReadScreen, { ctx }); return tree; };
  const rowOf = () => find(tree, x => x.props && x.props.id === 'rv-1')[0];
  return {
    installs, tree: () => tree, redraw,
    tapStrongs() { (find(rowOf(), x => x.props && typeof x.props.onClick === 'function')[0]).props.onClick({ target: { closest: () => ({ dataset: { s: 'G3056' } }) }, stopPropagation() {} }); return redraw(); },
    tapVerse() { (find(rowOf(), x => x.props && typeof x.props.onClick === 'function')[0]).props.onClick({ target: {}, stopPropagation() {} }); return redraw(); },
    tile(label) { return find(tree, x => x.type === 'button' && x.props && x.props.style && x.props.style.borderRadius === 16 && reads(x) === label)[0]; },
    byId(id) { return find(tree, n => n.props && n.props['data-testid'] === id); },
    press(b) { b.props.onClick(); return redraw(); },
  };
}

test('TAGGED: tapping a Strong\'s number shows the original form in THIS verse, its transliteration, morphology and the CC-BY pill', async () => {
  const R = reader({ installed: true, tagged: true });
  await R.tapStrongs();
  const words = R.byId('original-word');
  assert.equal(words.length, 1, 'only the tapped Strong\'s word (G3056 matches G3056G by base) should show, got ' + words.length);
  const t = reads(words[0]);
  assert.match(t, /λόγος/); assert.match(t, /logos/); assert.match(t, /N-NSM/);
  assert.ok(!/Ἐν/.test(reads(R.tree())), 'a word with a different Strong\'s number was shown');
  const pill = R.byId('original-licence-pill');
  assert.equal(pill.length, 1, 'no STEPBible licence pill');
  await R.press(pill[0]);
  assert.match(reads(R.byId('original-licence-text')[0]), /STEPBible\.org.*CC BY/);
  assert.match(reads(R.tree()), /STRONG'S G3056/, 'the existing lexicon header was lost');
});

test('TAGGED, module NOT installed: a download offer appears, never an automatic download; tapping it calls installModule and the word then shows', async () => {
  const R = reader({ installed: false, tagged: true });
  await R.tapStrongs();
  assert.equal(R.installs.length, 0, 'the module was downloaded without being asked');
  assert.equal(R.byId('original-words').length, 0);
  const offer = R.byId('original-offer');
  assert.equal(offer.length, 1, 'no download affordance');
  const btn = find(offer[0], n => n.type === 'button')[0];
  assert.match(reads(btn), /Show the original \(download\)/);
  await R.press(btn);
  await R.redraw();
  assert.deepEqual(R.installs, ['original-greek'], 'installModule was not called with the catalogue\'s original-greek item');
  assert.match(reads(R.byId('original-word')[0]), /λόγος/, 'after the install the original form is not shown');
});

test('UNTAGGED: the verse card has an Original tile; it lists the verse\'s words; tapping one opens the lexicon sheet, and its close returns to the list', async () => {
  const R = reader({ installed: true, tagged: false });
  await R.tapVerse();
  const tile = R.tile('Original');
  assert.ok(tile, 'the verse card has no Original tile');
  assert.equal(R.byId('original-verse-words').length, 0, 'the sheet is open before it was asked for');
  await R.press(tile);
  const ws = R.byId('original-verse-word');
  assert.deepEqual(ws.map(w => reads(w)), ['Ἐν En', 'λόγος logos', 'θεόν theon'], 'words not the verse\'s, in order: ' + ws.map(w => reads(w)));
  assert.equal(R.byId('original-licence-pill').length, 1, 'no licence pill on the verse list');
  await R.press(ws[1]);
  assert.match(reads(R.tree()), /STRONG'S G3056/, 'tapping a word did not open its lexicon entry');
  assert.equal(R.byId('original-verse-words').length, 0);
  // the lexicon sheet's own X: the smallest node holding the Strong's header, then its close button
  const sheet = find(R.tree(), n => /STRONG'S G3056/.test(reads(n))).sort((x, y) => reads(x).length - reads(y).length);
  const xs = find(sheet.find(n => find(n, i => i.props && i.props.name === 'x').length), n => n.type === 'button' && n.props.onClick && find(n, i => i.props && i.props.name === 'x').length);
  assert.ok(xs.length, 'no close control on the lexicon sheet');
  await R.press(xs[xs.length - 1]);
  assert.equal(R.byId('original-verse-words').length, 1, 'closing the lexicon did not return to the verse\'s words');
});

test('UNTAGGED, module NOT installed: the Original sheet offers the download and calls installModule on tap', async () => {
  const R = reader({ installed: false, tagged: false });
  await R.tapVerse();
  await R.press(R.tile('Original'));
  assert.equal(R.installs.length, 0);
  const btn = find(R.byId('original-offer')[0], n => n.type === 'button')[0];
  await R.press(btn); await R.redraw();
  assert.deepEqual(R.installs, ['original-greek']);
  assert.equal(R.byId('original-verse-word').length, 1, 'the installed words did not appear after the download');
});
