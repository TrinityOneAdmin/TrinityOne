// WEBSTER 1913 AS A SECOND WORD-DEFINITIONS MODULE — installable on demand, preferred over WordNet when present.
// Run: node --test scripts/webster-definitions.test.mjs
//
// Chain asserted (CLAUDE.md rules 1 and 3): the build script over a tiny CIDE-format fixture; the module that
// SHIPS against its catalogue pin; engine.js's OWN getDefinition lifted and run with Webster and/or WordNet
// loaded; then the REAL DefineSheet drawn through the repo's mini-React. Nothing matches text in app/*.jsx.
// Not on a device (rule 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fnBody, stmt } from './test-slice.mjs';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';
import { parseCide, build, IRREGULAR, MAX_GLOSS } from './build-websterdefs.mjs';
import { MAX_SENSES } from './build-worddefs.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ENGINE = readFileSync(ROOT + 'engine.js', 'utf8');
const CATALOG = JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8'));
const URL_W = 'modules/worddefs-webster.json';

// ── a tiny GCIDE in the REAL file format (shapes copied from CIDE.L / CIDE.M) ────────────────────
const CIDE =
  '<p><ent>Mercy</ent><br/\n<hw>Mer"cy</hw> <pr>(m<etil/r"s<ycr/)</pr>, <pos>n.</pos> <ety>[OE. <ets>merci</ets>]</ety> ' +
  '<sn>1.</sn> <def>Forbearance to inflict harm; <as>as, to show <ex>mercy</ex></as>compassionate treatment; clemency.</def><br/\n[<source>1913 Webster</source>]</p>\n\n' +
  '<p><q>Examples of <qex>mercy</qex> for comfort.</q> <rj><qau>Bacon.</qau></rj><br/\n[<source>1913 Webster</source>]</p>\n\n' +
  '<p><sn>2.</sn> <def>Compassionate treatment of the unfortunate and helpless; sometimes, favor.</def><br/\n[<source>1913 Webster</source>]</p>\n\n' +
  '<p><sn>3.</sn> <def>A modern sense added later by someone else, not in 1913.</def><br/\n[<source>WordNet 2.0</source>]</p>\n\n' +
  '<p><ent>Love</ent><br/\n<hw>Love</hw>, <pos>n.</pos> <def>[Obs.] An old rare sense of love that ought to sort last.</def><br/\n[<source>1913 Webster</source>]</p>\n' +
  '<p><sn>2.</sn> <def>A feeling of strong attachment; affection; tenderness.</def><br/\n[<source>1913 Webster</source>]</p>\n\n' +
  '<p><ent>Love</ent><br/\n<hw>Love</hw>, <pos>v. t.</pos> <def>To have a feeling of love for; to regard with affection.</def><br/\n[<source>1913 Webster</source>]</p>\n\n' +
  '<p><ent>Loveable</ent><br/\n<hw>Love"a*ble</hw>, <pos>a.</pos> <def>See <er>Lovable</er>.</def><br/\n[<source>1913 Webster</source>]</p>\n\n' +
  '<p><ent>Saith</ent><br/\n<hw>Saith</hw>, <pos>v.</pos> <def>3d pers. sing. pres. of Say.</def><br/\n[<source>1913 Webster</source>]</p>\n\n' +
  '<p><ent>Say</ent><br/\n<hw>Say</hw>, <pos>v. t.</pos> <def>To utter or express in words; to tell; to speak.</def><br/\n[<source>1913 Webster</source>]</p>\n\n' +
  '<p><ent>Zzyzx</ent><br/\n<hw>Zzyzx</hw>, <pos>n.</pos> <def>A place nobody in the Bible mentions at all.</def><br/\n[<source>1913 Webster</source>]</p>\n\n' +
  '<p><ent>Sea Horse</ent><br/\n<hw>Sea horse</hw>, <pos>n.</pos> <def>A two-word headword, which a single tapped word never matches.</def><br/\n[<source>1913 Webster</source>]</p>\n';
const VOCAB = new Set(['mercy', 'mercies', 'love', 'loved', 'loves', 'saith', 'say', 'qqqq']);

test('BUILD: parseCide keeps only 1913-Webster senses, strips tags/examples, skips "See X" and multi-word headwords, merges same-spelling entries', () => {
  const p = parseCide(CIDE);
  const mercy = p.get('mercy');
  assert.equal(mercy.length, 2, 'the WordNet-sourced sense must be dropped, the quotation paragraph is not a sense');
  assert.equal(mercy[0][1], 'Forbearance to inflict harm; compassionate treatment; clemency.', 'tags or the "as, ..." example leaked: ' + mercy[0][1]);
  assert.equal(mercy[0][0], 'n');
  assert.ok(!p.has('loveable'), 'a "See Lovable." cross-reference became a definition');
  assert.ok(!p.has('sea horse') && !p.has('seahorse'), 'a multi-word headword was kept');
  assert.deepEqual(p.get('love').map(s => s[0]), ['n', 'n', 'v'], 'noun and verb entries of "Love" were not merged');
});

test('BUILD: the emitted module has the shipped shape for a known headword, trims to the Bible vocabulary, caps senses and puts obsolete senses last', () => {
  const m = build(parseCide(CIDE), VOCAB);
  assert.deepEqual(Object.keys(m).sort(), ['defs', 'forms', 'meta']);
  assert.equal(m.meta.abbr, 'W1913');
  assert.equal(m.meta.kind, 'worddef');
  assert.equal(m.meta.name, 'Word Definitions (Webster 1913)');
  assert.match(m.meta.license, /public domain/i);
  assert.deepEqual(m.defs.mercy[0], ['n', 'Forbearance to inflict harm; compassionate treatment; clemency.'], 'defs shape is [pos, gloss]');
  assert.ok(!('zzyzx' in m.defs), 'a word not in the Bibles was kept');
  assert.ok(m.defs.love.length <= MAX_SENSES);
  assert.match(m.defs.love[0][1], /^A feeling of strong attachment/, 'the [Obs.] sense must sort after the current ones');
  assert.match(m.defs.love[m.defs.love.length - 1][1], /^\[Obs\.\]/);
  assert.equal(m.forms.mercies, 'mercy', 'plural -> headword');
  assert.equal(m.forms.loved, 'love');
  assert.equal(m.forms.saith, 'say', 'Webster files "Saith" as its own stub entry; it must point at the real word');
  assert.equal(IRREGULAR.saith, 'say');
  assert.ok(!('mercy' in m.forms), 'a headword must not point at itself');
  for (const [w, h] of Object.entries(m.forms)) assert.ok(m.defs[h], `form ${w} -> ${h} points at nothing`);
  const long = parseCide('<ent>Mercy</ent><br/\n<pos>n.</pos> <def>' + 'word '.repeat(100) + '</def>\n[<source>1913 Webster</source>]');
  assert.ok(build(long, VOCAB).defs.mercy[0][1].length <= MAX_GLOSS + 1, 'a long gloss was not cut');
});

// ── the file that ships ──────────────────────────────────────────────────────────────────────────
test('SHIPPED: Webster is offered in Dictionaries as an optional worddef, pinned to the file, public-domain, not featured/forced', () => {
  const items = CATALOG.categories.find(c => c.id === 'dictionaries').items;
  const it = items.find(x => x.id === 'worddefs-webster');
  assert.ok(it, 'not offered in the Dictionaries category');
  assert.equal(it.kind, 'worddef');
  assert.equal(it.format, 'JSON');
  assert.equal(it.url, URL_W);
  assert.equal(it.abbr, 'W1913');
  assert.ok(!it.featured, 'Webster must not be featured/forced');
  const bytes = readFileSync(ROOT + URL_W);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), it.sha256, 'catalog pin differs from the file - rerun scripts/build-websterdefs.mjs');
  assert.ok(bytes.length < 4 * 1024 * 1024, 'over the 4 MB budget: ' + bytes.length);
  const wn = items.find(x => x.id === 'worddefs-wordnet');
  assert.ok(wn && wn.url === 'modules/worddefs-wordnet.json' && wn.abbr === 'WN', 'WordNet entry was altered');
  const M = JSON.parse(bytes);
  assert.equal(M.meta.kind, 'worddef'); assert.equal(M.meta.abbr, 'W1913');
  for (const w of ['love', 'mercy', 'faith', 'shepherd', 'righteousness', 'beget']) assert.ok(M.defs[w], w + ' has no definition');
  assert.equal(M.forms.loved, 'love'); assert.equal(M.forms.hath, 'have'); assert.equal(M.forms.begat, 'beget');
  assert.ok(Object.keys(M.defs).length > 7000, 'suspiciously small dictionary');
  for (const [w, h] of Object.entries(M.forms)) assert.ok(M.defs[h], `form ${w} -> ${h} points at nothing`);
});

// ── engine.js's own lookup, lifted ───────────────────────────────────────────────────────────────
const WEBSTER = { meta: { abbr: 'W1913', name: 'Word Definitions (Webster 1913)', license: 'Webster PD notice', kind: 'worddef' },
  defs: { mercy: [['n', 'WEBSTER mercy gloss']], faith: [['n', 'WEBSTER faith gloss']] }, forms: {} };
const WORDNET = { meta: { abbr: 'WN', name: 'Word Definitions (WordNet)', license: 'WordNet 3.0 Princeton University notice', kind: 'worddef' },
  defs: { mercy: [['n', 'WORDNET mercy gloss']], lamb: [['n', 'WORDNET lamb gloss']] }, forms: { lambs: 'lamb' } };
function wdEngine(...mods) {
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
  const api = new Function('ensureWorddefs', 'notify', src)(() => {}, () => {});
  for (const m of mods) api.loadWorddefsJSON(m);
  return api;
}

test('ENGINE: with both installed Webster answers (in either install order); a word Webster lacks falls back to WordNet; only-WordNet is unchanged', () => {
  for (const mods of [[WEBSTER, WORDNET], [WORDNET, WEBSTER]]) {
    const e = wdEngine(...mods);
    const d = e.getDefinition('mercy');
    assert.equal(d.senses[0].gloss, 'WEBSTER mercy gloss', 'Webster did not answer');
    assert.equal(d.source, 'W1913'); assert.equal(d.label, 'Webster 1913'); assert.match(d.license, /Webster PD/);
    const fb = e.getDefinition('lambs');
    assert.equal(fb.senses[0].gloss, 'WORDNET lamb gloss', 'WordNet did not answer a word Webster lacks');
    assert.equal(fb.label, 'WordNet'); assert.match(fb.license, /Princeton/);
  }
  const only = wdEngine(WORDNET).getDefinition('mercy');
  assert.equal(only.senses[0].gloss, 'WORDNET mercy gloss'); assert.equal(only.label, 'WordNet');
  const webOnly = wdEngine(WEBSTER);
  assert.equal(webOnly.getDefinition('faith').senses[0].gloss, 'WEBSTER faith gloss');
  assert.equal(webOnly.getDefinition('lamb'), null);
  webOnly.removeWorddefs('W1913');
  assert.equal(webOnly.getDefinition('faith'), null, 'a removed Webster still answers');
});

// ── POINT OF USE: the real DefineSheet ───────────────────────────────────────────────────────────
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
function sheet(eng) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = { Bible: { defineText: eng.defineText, getDefinition: eng.getDefinition, worddefsLicense: eng.worddefsLicense, worddefsState: eng.worddefsState,
      retryWorddefs() {}, subscribe: () => () => {} }, sanitizeHtml: h => h, innerWidth: 360 };
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
  const { DefineSheet } = loadScreen('app/screens-read.jsx', ['DefineSheet'], globals);
  const props = { label: 'Luke 6:36', text: 'Be merciful, mercy and faith', open: true, onClose() {} };
  return { tree: () => draw(DefineSheet, props) };
}
const pillOf = tree => find(tree, n => n.type === 'button' && n.props['data-testid'] === 'define-licence-pill')[0];

test('POINT OF USE: DefineSheet with Webster installed shows Webster\'s meaning and a "Webster 1913" source pill whose licence is Webster\'s', () => {
  const s = sheet(wdEngine(WORDNET, WEBSTER));
  let tree = s.tree();
  const page = reads(tree);
  assert.ok(page.includes('WEBSTER mercy gloss'), 'Webster\'s meaning is not shown: ' + page);
  assert.ok(!page.includes('WORDNET mercy gloss'), 'WordNet answered although Webster is installed');
  assert.equal(reads(pillOf(tree)), 'Webster 1913 licence', 'the pill does not say which dictionary answered');
  assert.match(String(pillOf(tree).props.title), /Webster PD/, 'the pill carries WordNet\'s licence for a Webster answer');
  pillOf(tree).props.onClick();
  tree = s.tree();
  assert.match(reads(tree), /Webster PD notice/);
  assert.ok(!/Princeton/.test(reads(tree)), 'WordNet\'s licence text is shown under a Webster answer');
});

test('POINT OF USE: DefineSheet with only WordNet installed shows WordNet\'s meaning and the WordNet licence pill', () => {
  const s = sheet(wdEngine(WORDNET));
  const tree = s.tree();
  assert.ok(reads(tree).includes('WORDNET mercy gloss'));
  assert.equal(reads(pillOf(tree)), 'WordNet licence');
  assert.match(String(pillOf(tree).props.title), /Princeton/);
});
