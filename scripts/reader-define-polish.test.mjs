// DEFINE SHEET + LEXICON ENTRY POLISH, AND THE WORDNET BACKSTOP.
// Run: node --test scripts/reader-define-polish.test.mjs
//
// Point of use (CLAUDE.md rules 1 and 3): the REAL DefineSheet / LexDetail / OriginalWords are compiled out of
// app/screens-read.jsx and DRAWN through the repo's mini-React; engine.js's OWN getDefinition / defineText /
// ensureWorddefs are lifted and run. Nothing matches text in app/*.jsx.
//
// Users of what changed (rule 2):
//   LexDetail (new optional prop showLemma; root tile restyled; no-entry copy) <- WordStudySheet (no showLemma),
//     OriginalWords' matched-word branch (showLemma). Both live in app/screens-read.jsx.
//   morphPlain (new) <- OriginalWords head() and WordStudySheet's "In this verse" list; wraps morphText.
//   ensureWorddefs (engine.js) <- getDefinition (every Define lookup) and retryWorddefs. Its guard changed from
//     "any dictionary loaded" to "WordNet loaded".
// Not on a device (rule 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ENGINE = readFileSync(ROOT + 'engine.js', 'utf8');

const WEBSTER = { meta: { abbr: 'W1913', name: 'Word Definitions (Webster 1913)', license: 'Webster PD notice', kind: 'worddef' },
  defs: { mercy: [['n', 'WEBSTER mercy gloss']] }, forms: {} };
const WORDNET = { meta: { abbr: 'WN', name: 'Word Definitions (WordNet)', license: 'WordNet 3.0 Princeton University notice', kind: 'worddef' },
  defs: { mercy: [['n', 'WORDNET mercy gloss']], word: [['n', 'WORDNET word gloss']], lamb: [['n', 'WORDNET lamb gloss']] }, forms: { lambs: 'lamb' } };

// engine.js's own word-definition functions, lifted. `installs` records what ensureWorddefs asked to download; an
// install of the WordNet default lands WORDNET in worddefs exactly as engine.js's installModule -> loadWorddefsJSON does.
function engine(...mods) {
  const src = 'const worddefs = {}; let _worddefsState = "idle"; let _worddefsRequested = false;\n' +
    stmt(ENGINE, 'const _WD_STOP = new Set(') + '\n' +
    stmt(ENGINE, 'const DEFAULT_WORDDEFS = ') + '\n' +
    fnBody(ENGINE, 'function loadWorddefsJSON(obj, abbr){') + '\n' +
    fnBody(ENGINE, 'function removeWorddefs(abbr){') + '\n' +
    fnBody(ENGINE, 'function worddefsLicense(){') + '\n' +
    fnBody(ENGINE, 'function worddefsState(){') + '\n' +
    fnBody(ENGINE, 'function _wdStems(w){') + '\n' +
    fnBody(ENGINE, 'function getDefinition(word){') + '\n' +
    fnBody(ENGINE, 'function defineText(text){') + '\n' +
    fnBody(ENGINE, 'function ensureWorddefs(){') + '\n' +
    fnBody(ENGINE, 'function retryWorddefs(){') + '\n' +
    'return { worddefs, loadWorddefsJSON, removeWorddefs, worddefsLicense, worddefsState, getDefinition, defineText, retryWorddefs };';
  const installs = [];
  const api = new Function('notify', 'navigator', 'isInstalled', 'cacheGet', 'installModule', src)(
    () => {}, {}, () => false, async () => null,
    async item => { installs.push(item.abbr); if (item.abbr === 'WN') api.loadWorddefsJSON(WORDNET); return {}; });
  for (const m of mods) api.loadWorddefsJSON(m);
  api.installs = installs;
  return api;
}

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const LEX = {
  G3056: { id: 'G3056', lang: 'GREEK', lemma: 'λόγος', translit: 'logos', pos: 'noun', short: 'word', def: 'a word, speech, a message', occ: 330 },
  G9999: { id: 'G9999', missing: true },
};
function screens(eng) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const orig = [{ w: 'λόγον', t: 'logon', s: 'G3056', m: 'V-2API-3S', g: 'Word' }];   // fixture code only: a digit-prefixed aorist passive   // the SURFACE form (accusative) differs from the lemma
  const Bible = {
    defineText: eng.defineText, getDefinition: eng.getDefinition, worddefsLicense: eng.worddefsLicense, worddefsState: eng.worddefsState,
    retryWorddefs() {}, subscribe: () => () => {},
    lex: id => LEX[id] || { id, missing: true },
    hasOriginal: () => true, getOriginal: () => orig, originalList: () => [{ license: 'STEPBible.org CC BY' }],
  };
  const win = { Bible, sanitizeHtml: h => h, innerWidth: 360 };
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' },
    setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams, SpeechSynthesisUtterance: class {},
    Icon, cx: (...a) => a.filter(Boolean).join(' '), lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'),
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', {}, children) : null),
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'),
    IconBtn: ({ name, onClick }) => React.createElement('button', { onClick }, name), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
  };
  const mod = loadScreen('app/screens-read.jsx', ['DefineSheet', 'LexDetail', 'morphPlain'], globals);
  return {
    define: (text) => draw(mod.DefineSheet, { label: 'John 1:1', text, open: true, onClose() {}, verses: [{ book: 43, chap: 1, v: 1 }] }),
    lex: (id, extra) => draw(mod.LexDetail, { id, ...extra }),
    morphPlain: mod.morphPlain,
  };
}
const byId = (t, id) => find(t, n => n.props && n.props['data-testid'] === id);

test('Define tabs say what they are: "In English" and "In the original (Greek)"', () => {
  const t = screens(engine(WORDNET)).define('word mercy');
  const tabs = find(byId(t, 'define-pager-tabs')[0], n => n.type === 'button').map(b => reads(b));
  assert.deepEqual(tabs, ['In English', 'In the original (Greek)']);
});

test('Define, original page: a word with no one-word match says so in plain words (old "isn\'t a single original word" is gone)', () => {
  const t = screens(engine(WORDNET)).define('mercy');   // gloss "Word" never matches the pill "mercy"
  const head = reads(byId(t, 'define-original-head')[0]);
  assert.equal(head, 'There is no one-word match for "mercy" in the original. Here is the whole verse:');
  assert.ok(!/isn't a single/.test(head));
});

test('Define, original page: the matched word shows the LEMMA (dictionary form), not only the verse\'s inflected form', () => {
  const t = screens(engine(WORDNET)).define('word');    // pill "word" matches gloss "Word" -> LexDetail inline
  const lemma = byId(t, 'lex-lemma');
  assert.equal(lemma.length, 1, 'no dictionary-form line under the matched word');
  assert.match(reads(lemma[0]), /Dictionary form: λόγος/);
  assert.ok(reads(byId(t, 'define-original-word')[0]).includes('λόγον'), 'control: the verse form is still the big word');
  assert.match(reads(byId(t, 'define-original-word')[0]), /verb · aorist \(simple past\) · passive · indicative/, 'the grammar line on the screen is not the plain-English, digit-correct one');
});

test('LexDetail: the "Greek root" tile is a plain label, not a control (no handler, not a button, nothing tappable in it)', () => {
  const t = screens(engine(WORDNET)).lex('G3056');
  const tile = byId(t, 'lex-root-label');
  assert.equal(tile.length, 1, 'root tile missing');
  assert.match(reads(tile[0]), /Greek root/);
  assert.equal(tile[0].type, 'div');
  assert.equal(tile[0].props.onClick, undefined);
  assert.equal(tile[0].props.role, undefined);
  assert.equal(find(tile[0], n => n.type === 'button' || (n.props && (n.props.onClick || n.props.role === 'button'))).length, 0);
  // and the lemma line is off unless asked for (WordStudySheet already shows the lemma large)
  assert.equal(byId(t, 'lex-lemma').length, 0);
});

test('LexDetail: the no-entry copy no longer shows a .dct.mybible file name', () => {
  const page = reads(screens(engine(WORDNET)).lex('G9999'));
  assert.match(page, /No entry in the built-in lexicon/);
  assert.ok(!/mybible/i.test(page), 'a file extension is still in the copy: ' + page);
});

test('Grammar line explains the jargon (aorist, middle, optative...) and still decodes digit-prefixed codes', () => {
  const { morphPlain } = screens(engine(WORDNET));
  assert.equal(morphPlain('V-2API-3S', 'greek'), 'verb · aorist (simple past) · passive · indicative · 3rd person · singular');
  assert.match(morphPlain('V-AMO-3S', 'greek'), /middle \(done to or for oneself\) · optative \(a wish or possibility\)/);
  assert.match(morphPlain('V-PEI-3S', 'greek'), /middle or passive(?! \()/, '"middle or passive" must not get the middle-only gloss');
  assert.equal(morphPlain('N-NSF', 'greek'), 'noun · nominative · singular · feminine');
  assert.equal(morphPlain('HVqp3ms', 'hebrew'), 'verb · qal · perfect · 3rd person · masculine · singular', 'Hebrew perfect keeps its own meaning');
});

// ── WORDNET BACKSTOP ─────────────────────────────────────────────────────────────────────────────
test('BACKSTOP: with ONLY Webster installed, Define fetches WordNet, and a word Webster lacks then gets a WordNet definition', async () => {
  const eng = engine(WEBSTER);
  const s = screens(eng);
  const first = reads(s.define('lambs mercy'));
  assert.ok(first.includes('WEBSTER mercy gloss'), 'control: Webster answers what it has: ' + first);
  assert.ok(!first.includes('WORDNET lamb gloss'), 'control: WordNet is not there yet');
  await new Promise(r => setTimeout(r, 10));            // the install is deferred a tick; let it land
  assert.deepEqual(eng.installs, ['WN'], 'Define did not ask for WordNet while only Webster was installed');
  const t = s.define('lambs mercy');
  const page = reads(byId(t, 'define-senses')[0]) + ' ' + reads(t);
  assert.ok(page.includes('lambs') && reads(t).includes('WORDNET lamb gloss'), 'the word Webster lacks was not defined by WordNet: ' + page);
  assert.equal(eng.getDefinition('mercy').label, 'Webster 1913', 'Webster must still win where it has the word');
});

test('BACKSTOP: with both installed nothing is re-fetched', async () => {
  const eng = engine(WEBSTER, WORDNET);
  screens(eng).define('lambs');
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(eng.installs, []);
});
