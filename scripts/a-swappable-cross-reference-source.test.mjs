// SWAPPABLE CROSS-REFERENCE SOURCES — real engine, real Study-panel Cross refs tab, driven through the UI.
// Run: node --test scripts/a-swappable-cross-reference-source.test.mjs
//
// Owner 2026-11-03: a member can CHOOSE which cross-reference set the reader shows (TSK, the Geneva 1599
// notes, an imported set, or "All (merge)"), the credit always follows the chosen set, and removing the
// chosen set falls back without a reload.
//
// CLAUDE.md rule 3: this does not match text in app/*.jsx (they ship unbundled, so `false && ` leaves the
// words in place and a text assertion still passes). It lifts engine.js's OWN loadCrossrefsJSON, getCrossRefs,
// crossrefLicense, crossrefList, removeModule and catOf as source text, runs them over fixtures, and draws
// the REAL CommentaryPanel through the repo's mini-React. Every claim is read off the rendered screen or the
// behaviour of shipped code — switching source is done by TAPPING THE RENDERED PICKER, not by calling the
// engine directly, so deleting the picker wiring turns these red.
//
// NOT ON A DEVICE: rule 6 still applies before this merges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts, reads, button } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ENGINE = readFileSync(ROOT + 'engine.js', 'utf8');
const CROSSREF_ALL = 'all';

// ── engine.js's own parseRef, lifted with its book tables (the block from BOOK_NAMES down to parseRef) ──
const realParseRef = (() => {
  const preamble = ENGINE.slice(ENGINE.indexOf('const BOOK_NAMES = ['), ENGINE.indexOf('function parseRef(str){'));
  const src = preamble + fnBody(ENGINE, 'function parseRef(str){') + '\nreturn parseRef;';
  return new Function(src)();
})();

// ── a working slice of the engine: the cross-ref store + list + query + licence, AND the real removeModule,
// wired to in-memory stand-ins for the installed map and the byte cache. removeModule is the SHIPPED function
// (so the crossrefs-deletion case it must carry is exercised, not re-implemented); subscribe() fires the real
// notify() the engine calls, so a removal reaches an open panel exactly as it does on a phone. ──
function mkEngine() {
  const crossrefs = {}, modules = {}, commentaries = {}, urlOf = {};
  const installing = new Set();
  const order = [], active = null;
  const subs = [];
  const notify = () => subs.forEach(f => { try { f(); } catch (e) {} });
  const subscribe = (f) => { subs.push(f); return () => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; };
  const ensureCrossrefs = () => {};
  const urlKey = (cat, abbr) => (cat || 'bibles') + '|' + abbr;
  let installedMap = {};
  const getInstalled = () => JSON.parse(JSON.stringify(installedMap));
  const setInstalled = (m) => { installedMap = JSON.parse(JSON.stringify(m)); };
  const byteCache = new Set();
  const cacheDelete = async (url) => { byteCache.delete(url); };
  const cacheHas = async (url) => byteCache.has(url);
  const hasDict = () => false, removeWorddefs = () => {}, removeOriginal = () => {}, removeDict = () => {};

  const body = [
    fnBody(ENGINE, 'function catOf(item){'),
    fnBody(ENGINE, 'function loadCrossrefsJSON(obj, abbr){'),
    fnBody(ENGINE, 'function crossrefList(){'),
    fnBody(ENGINE, 'function getCrossRefs(b, c, source){'),
    fnBody(ENGINE, 'function crossrefLicense(source){'),
    fnBody(ENGINE, 'async function removeModule(id, category){'),
    'return { loadCrossrefsJSON, crossrefList, getCrossRefs, crossrefLicense, removeModule, catOf };',
  ].join('\n');
  const names = ['CROSSREF_ALL', 'crossrefs', 'notify', 'ensureCrossrefs', 'getInstalled', 'setInstalled',
    'urlOf', 'urlKey', 'modules', 'commentaries', 'hasDict', 'active', 'installing',
    'cacheDelete', 'cacheHas', 'removeWorddefs', 'removeOriginal', 'removeDict', 'order'];
  const vals = [CROSSREF_ALL, crossrefs, notify, ensureCrossrefs, getInstalled, setInstalled,
    urlOf, urlKey, modules, commentaries, hasDict, active, installing,
    cacheDelete, cacheHas, removeWorddefs, removeOriginal, removeDict, order];
  const api = new Function(...names, body)(...vals);

  // install a cross-ref source the way the app's module path does: register it, record it as installed, note
  // where it loaded from, and put its bytes in the cache so removeModule's read-back can prove the delete.
  const install = (moduleObj, url) => {
    const abbr = api.loadCrossrefsJSON(moduleObj, moduleObj.meta.abbr);
    const m = getInstalled(); m[url] = { url, id: abbr, abbr, kind: 'crossref', category: 'crossrefs' }; setInstalled(m);
    urlOf[urlKey('crossrefs', abbr)] = url;
    byteCache.add(url);
    return abbr;
  };
  return { api, install, subscribe, crossrefs };
}

const TSK = {
  meta: { abbr: 'TSK', name: 'Cross References (openbible.info)', kind: 'crossref',
    license: 'CC BY 4.0 · openbible-test-credit' },
  refs: { '43.1.1': ['Genesis 1:1'], '43.1.4': ['Psalms 36:9'] },      // John 1
};
const GNV = {
  meta: { abbr: 'GNV', name: 'Geneva Notes (test)', kind: 'crossref',
    license: 'Public Domain · geneva-test-credit' },
  refs: { '43.1.1': ['Revelation 22:13'], '43.1.14': ['Exodus 33:20'] }, // John 1 — DELIBERATELY different
};

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// Draw the real CommentaryPanel's Cross refs tab over a given engine, with a working in-memory localStorage
// so the persist + fallback resolver runs for real.
function studyPanel(eng, loc, label, startSource) {
  const ls = {};
  if (startSource !== undefined) ls['trinityone.crossrefSource'] = startSource;
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = {
    Bible: {
      getCrossRefs: (b, c, source) => eng.api.getCrossRefs(b, c, source),
      crossrefList: () => eng.api.crossrefList(),
      crossrefLicense: (s) => eng.api.crossrefLicense(s),
      removeModule: (id, cat) => eng.api.removeModule(id, cat),
      parseRef: realParseRef,
      getCommentary: () => [], subscribe: eng.subscribe,
      refKey: (l, v) => l.book + '.' + l.chap + '.' + v,
      getVerses: () => [],
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
    lsGet: (k, d) => (k in ls ? ls[k] : d), lsSet: (k, v) => { ls[k] = v; },
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'),
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', {}, children) : null),
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'),
    IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
  };
  const { CommentaryPanel } = loadScreen('app/screens-read.jsx', ['CommentaryPanel'], globals);
  const ctx = { notes: {}, setNote() {}, gotoRef() {}, version: 'BSB', bookmarks: [] };
  const props = { loc, label, open: true, onClose() {}, ctx, docked: true };
  const render = () => draw(CommentaryPanel, props);
  let tree = render();
  const tab = button(tree, 'Cross refs');
  assert.equal(tab.length, 1, 'there is no "Cross refs" tab in the Study panel');
  tab[0].props.onClick();
  render();          // view -> crossrefs; the effect reads crossrefList + resolves source + getCrossRefs
  tree = render();   // the refs + picker are now on screen
  return { tree, render, ls };
}

// A ref pill carries a chevR icon beside the reference text; this is how many references are drawn.
const refPills = (tree) => button(tree, 'chevR').map(b => texts(b).join('')).filter(Boolean);

test('(a) switching source THROUGH THE PICKER changes the rendered reference list', () => {
  const eng = mkEngine();
  eng.install(TSK, 'modules/crossrefs-openbible.json');
  eng.install(GNV, 'modules/crossrefs-geneva.json');
  const { tree, render } = studyPanel(eng, { book: 43, chap: 1 }, 'John 1');

  // starts on TSK (the default) — its reference, not Geneva's, is on screen
  assert.match(reads(tree), /Genesis 1:1/, 'the default (TSK) reference is not shown');
  assert.doesNotMatch(reads(tree), /Revelation 22:13/, 'a Geneva-only reference is showing before Geneva was chosen');

  // open the picker and choose Geneva — the picker only renders with two sources, so finding it IS the test
  const toggle = button(tree, 'Cross References (openbible.info)');
  assert.ok(toggle.length >= 1, 'the source picker does not show the active source');
  toggle[0].props.onClick();
  let t = render();
  const gnvOpt = button(t, 'Geneva Notes (test)').filter(b => texts(b).join('').includes('GNV'));
  assert.equal(gnvOpt.length, 1, 'the Geneva option (name + abbr) is not in the picker');
  gnvOpt[0].props.onClick();
  t = render();

  assert.match(reads(t), /Revelation 22:13/, 'choosing Geneva did not switch the reference list');
  assert.doesNotMatch(reads(t), /Genesis 1:1/, 'TSK references still show after switching to Geneva (source is not filtered)');
});

test('(b) the licence follows the active source, and "All (merge)" concatenates every credit', () => {
  const eng = mkEngine();
  eng.install(TSK, 'modules/crossrefs-openbible.json');
  eng.install(GNV, 'modules/crossrefs-geneva.json');
  const { tree, render } = studyPanel(eng, { book: 43, chap: 1 }, 'John 1');

  // TSK active → its credit, and ONLY its credit
  assert.match(reads(tree), /openbible-test-credit/, 'the active source credit (TSK) is not rendered');
  assert.doesNotMatch(reads(tree), /geneva-test-credit/, 'another source\'s credit shows while TSK is active');

  // switch to "All (merge)" → BOTH credits (CC BY obliges each source\'s attribution)
  button(tree, 'Cross References (openbible.info)')[0].props.onClick();
  let t = render();
  const allOpt = button(t, 'All (merge)');
  assert.equal(allOpt.length, 1, 'there is no "All (merge)" option in the picker');
  allOpt[0].props.onClick();
  t = render();
  const page = reads(t);
  assert.match(page, /openbible-test-credit/, 'the TSK credit is missing from the merged view');
  assert.match(page, /geneva-test-credit/, 'the Geneva credit is missing from the merged view — a CC BY violation');
  // the merge shows both sources\' references too
  assert.match(page, /Genesis 1:1/, 'the merge dropped TSK references');
  assert.match(page, /Revelation 22:13/, 'the merge dropped Geneva references');
});

test('(c) removing the ACTIVE source falls back to another, live, with no reload', async () => {
  const eng = mkEngine();
  eng.install(TSK, 'modules/crossrefs-openbible.json');
  eng.install(GNV, 'modules/crossrefs-geneva.json');
  // start with Geneva as the active, persisted source
  const { tree, render, ls } = studyPanel(eng, { book: 43, chap: 1 }, 'John 1', 'GNV');
  assert.match(reads(tree), /Revelation 22:13/, 'Geneva was not the active source at the start');

  // remove Geneva through the REAL removeModule — it must delete crossrefs['GNV'] and notify()
  const removed = await eng.api.removeModule('modules/crossrefs-geneva.json', 'crossrefs');
  assert.equal(removed, true, 'removeModule refused to remove the cross-ref source');
  assert.ok(!('GNV' in eng.crossrefs), 'removeModule did not delete the source from the live crossrefs map (the §4 patch is missing)');

  // the panel re-read on the removal\'s notify(); draw again and it must now show TSK, and have rewritten the pref
  const t = render();
  assert.match(reads(t), /Genesis 1:1/, 'the panel did not fall back to TSK after Geneva was removed');
  assert.doesNotMatch(reads(t), /Revelation 22:13/, 'the removed source\'s references are still on screen');
  assert.equal(ls['trinityone.crossrefSource'], 'TSK', 'the fallback was not persisted, so the UI would not reflect it');
});

test('(d) a chapter with no references shows an empty state that NAMES the active source', () => {
  const eng = mkEngine();
  eng.install(TSK, 'modules/crossrefs-openbible.json');   // one source → no picker, so the empty state must name it some other way
  const { tree } = studyPanel(eng, { book: 43, chap: 99 }, 'John 99');
  const page = reads(tree);
  assert.match(page, /No cross references/, 'the empty state is not shown for a chapter with no refs');
  assert.match(page, /Cross References \(openbible\.info\)/, 'the empty state does not name the active source');
});

// ── supporting: the SHIPPED engine functions behave as the UI relies on ──
test('crossrefList + crossrefLicense: filtering and the "all" concat, at the engine', () => {
  const eng = mkEngine();
  eng.install(TSK, 'a'); eng.install(GNV, 'b');
  assert.deepEqual(eng.api.crossrefList().map(s => s.abbr).sort(), ['GNV', 'TSK']);
  assert.equal(eng.api.crossrefLicense('TSK'), TSK.meta.license);
  assert.equal(eng.api.crossrefLicense('GNV'), GNV.meta.license);
  const all = eng.api.crossrefLicense(CROSSREF_ALL);
  assert.match(all, /openbible-test-credit/);
  assert.match(all, /geneva-test-credit/);
  // a named source reads ONLY itself; "all" merges
  assert.deepEqual(eng.api.getCrossRefs(43, 1, 'GNV'), { 1: ['Revelation 22:13'], 14: ['Exodus 33:20'] });
  assert.deepEqual(eng.api.getCrossRefs(43, 1, 'TSK')[1], ['Genesis 1:1']);
  assert.deepEqual(eng.api.getCrossRefs(43, 1, CROSSREF_ALL)[1].sort(), ['Genesis 1:1', 'Revelation 22:13']);
});

test('the "all" sentinel can never be registered as a real source abbr', () => {
  const eng = mkEngine();
  const abbr = eng.api.loadCrossrefsJSON({ meta: { abbr: 'all', name: 'sneaky', kind: 'crossref' }, refs: {} }, 'all');
  assert.notEqual(abbr, 'all', 'a source registered under the merge sentinel would shadow the "All" option');
  assert.ok(!('all' in eng.crossrefs), 'the store holds a source keyed "all" — it collides with the merge');
});

// ── §5: a member imports their OWN cross-reference JSON. It arrives through the file-import path
// (loadModuleBytes) with no sha256 pin — TLS trust, as every file import is — and must be shape-validated and
// registered so it appears in crossrefList() and is selectable, while a non-cross-ref JSON is refused. This
// lifts the SHIPPED loadModuleBytes and runs it over real bytes (isSqlite/isZip stubbed false, since a JSON
// file is neither). ──
function importEngine() {
  const crossrefs = {};
  const notify = () => {};
  const isSqlite = () => false, isZip = () => false;
  const body = [
    fnBody(ENGINE, 'function loadCrossrefsJSON(obj, abbr){'),
    fnBody(ENGINE, 'function crossrefList(){'),
    fnBody(ENGINE, 'async function loadModuleBytes(u8, srcName, meta){'),
    'return { loadModuleBytes, loadCrossrefsJSON, crossrefList };',
  ].join('\n');
  const api = new Function('CROSSREF_ALL', 'crossrefs', 'notify', 'isSqlite', 'isZip', body)(CROSSREF_ALL, crossrefs, notify, isSqlite, isZip);
  return { api, crossrefs };
}

test('(§5) an imported cross-reference JSON is shape-validated, registered and selectable; other JSON is refused', async () => {
  const e = importEngine();
  const bytes = (o) => new TextEncoder().encode(JSON.stringify(o));
  const r = await e.api.loadModuleBytes(bytes({ meta: { abbr: 'MINE', name: 'My own refs', kind: 'crossref' }, refs: { '43.1.1': ['John 3:16'] } }), 'my-refs.json');
  assert.equal(r.kind, 'crossref');
  assert.equal(r.abbr, 'MINE');
  // it is in the live store that crossrefList() maps over → it shows in the picker and is selectable
  assert.ok(e.api.crossrefList().some(s => s.abbr === 'MINE'), 'the imported source is not offered by crossrefList()');
  // the shape guard: a JSON that is not a cross-ref set is refused rather than registered as one
  await assert.rejects(() => e.api.loadModuleBytes(bytes({ meta: { kind: 'dict' }, entries: {} }), 'not-xrefs.json'),
    /unrecognized file/, 'a non-cross-ref JSON was accepted as a cross-ref set');
  await assert.rejects(() => e.api.loadModuleBytes(bytes({ meta: { kind: 'crossref' } }), 'no-refs.json'),
    /unrecognized file/, 'a cross-ref JSON with no refs object was accepted');
});
