// EVERY INSTALLED MODULE CAN BE REMOVED, AND THE SPACE COMES BACK.
// Run: node --test scripts/every-installed-module-can-be-removed.test.mjs
//
// HANDOFF item 7: "Make commentaries and dictionaries uninstallable — removeModule only works for Bibles."
//
// THE DEFECT. The Library's Installed tier lists everything on the device — Bibles, dictionaries,
// commentaries — and offers Remove on all of them. engine.js's removeModule began:
//
//     if(!modules[abbr] || abbr === active) return false;
//
// and `modules` holds BIBLES ONLY. A commentary lives in `commentaries`, a dictionary in `dicts`. So every
// non-Bible row returned false at the first line: nothing left memory, the installed record stayed, and the
// megabytes stayed in IndexedDB. A member could download a commentary and never get the space back, on a
// product whose first audience is phones with very little storage on thin, expensive connections. (The
// TOAST over that failure was fixed on 2026-09-10 — small-fixes-round4 V2 — so since then the app said
// "Couldn't remove" honestly. Honest, and still no way to remove it.)
//
// WHERE EACH CATEGORY ACTUALLY LIVES, measured rather than assumed — this is what the fix had to cover:
//   · bytes, every category          IndexedDB "bible-modules"/"modules", keyed by the module's url
//   · the record that makes it       localStorage "trinityone.installed", a url -> meta map; this is what
//     "installed"                    installedMap() lists and what restoreInstalled() reloads at boot
//   · a Bible, loaded                `modules[abbr]` + `order` + possibly `active`
//   · a commentary, loaded           `commentaries[abbr]`
//   · a dictionary, loaded           an entry in `dicts` — which until this branch carried NO identity at
//                                    all, so nothing could ever find one again; and, between boot and the
//                                    first word-tap, a deferred parse in `_pendingDicts` holding its bytes
//   · a devotional                   nothing can install one: loadModuleBytes has no devotional branch and
//                                    catalog.json offers only an Import placeholder, so the category is
//                                    reachable in catOf() and empty in practice (see the last test)
//   · service-worker caches          NOT involved: sw.js caches the app shell, never a module
//
// WHY THE ENGINE RUNS FOR REAL HERE. "Removed" is a claim about bytes, so a stubbed cache would answer the
// question the test is named after (memory/stub-answers-the-question). The real cacheGet/cachePut/
// cacheDelete/cacheKeys, the real getInstalled/setInstalled/recordInstalled, the real addDict/addCommentary/
// addSource and the real removeModule are lifted out of engine.js with fnBody/stmt and run over a plain
// in-memory IndexedDB and localStorage. Those two are stores, not deciders: every decision in these tests is
// made by engine.js's own code, and the assertions read the store afterwards.
//
// WHAT THIS DOES NOT PROVE, stated rather than papered over:
//   · NOT A DEVICE (CLAUDE.md rule 6). IndexedDB here is an in-memory Map, not the WebView's store, and
//     nothing measures free space on a phone. What is proved is that the bytes leave the store the engine
//     keeps them in and that the record and the loaded copy go with them.
//   · REMOVING THE STRONG'S LEXICON CAN BE UNDONE BY A LATER WORD-TAP, and that is the shipped policy
//     rather than anything this branch does. _ensureFullLexicon() downloads modules/strongs-dict.json on
//     the FIRST lex() lookup of a session when it is not installed; its one-shot flag holds only for the
//     rest of that session, so a tap on a Strong's number in a later session installs it again. The space
//     does come back at the moment of removal, and every other module stays removed. Giving a member a way
//     to say "and do not fetch it again" is a product decision, not this fix.
//   · AN IMPORTED DICTIONARY IS NOT REMOVABLE HERE BECAUSE IT IS NEVER INSTALLED: the file-import path
//     records a module only `if(r && r.abbr)`, and loadModuleBytes returns `{kind:"dict"}` with no abbr for
//     a dictionary, so an imported dict is neither cached nor listed and does not survive a restart. That is
//     a defect in IMPORT, upstream of removal, and it is left alone on this branch.
//
// AND IT IS DRIVEN FROM THE SCREEN (CLAUDE.md rule 1). The removals below are performed by tapping the real
// Remove button on the real InstalledBrowser, compiled out of app/screens-library.jsx by esbuild and
// rendered through scripts/render-jsx-screen.mjs. Delete the button, or stop it calling removeModule, and
// T2/T3/T5/T7/T8 fail. Nothing here matches text in app/*.jsx (rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ENGINE = readFileSync(ROOT + 'engine.js', 'utf8');

// ── the stores the engine writes to ───────────────────────────────────────────────────────────────────────
// A plain Map behind the exact IndexedDB surface engine.js uses (open/createObjectStore/transaction/
// objectStore + get/put/delete/getAllKeys, each an async request object). `breakDeleteOf` makes one key
// undeletable, which is how the honest-failure path is exercised — that is a broken store, not a broken
// engine, and the engine must notice and say so.
function fakeIndexedDB({ breakDeleteOf = null } = {}) {
  const stores = new Map();
  let upgraded = false;
  const req = () => ({ onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined, error: null });
  const settle = (r, value) => { setTimeout(() => { r.result = value; if (r.onsuccess) r.onsuccess(); }, 0); return r; };
  const db = {
    createObjectStore(name) { if (!stores.has(name)) stores.set(name, new Map()); return {}; },
    transaction(name) {
      const m = stores.get(name) || stores.set(name, new Map()).get(name);
      return { objectStore: () => ({
        get: (k) => settle(req(), m.has(k) ? m.get(k) : undefined),
        put: (v, k) => { m.set(k, v); return settle(req(), k); },
        delete: (k) => { if (k !== breakDeleteOf) m.delete(k); return settle(req(), undefined); },
        getAllKeys: () => settle(req(), [...m.keys()]),
      }) };
    },
  };
  const api = {
    open(name) {
      const r = req();
      r.result = db;
      setTimeout(() => { if (!upgraded) { upgraded = true; if (r.onupgradeneeded) r.onupgradeneeded(); } if (r.onsuccess) r.onsuccess(); }, 0);
      return r;
    },
  };
  // what is on disk, as the test sees it
  api._keys = () => [...(stores.get('modules') || new Map()).keys()];
  api._bytes = () => [...(stores.get('modules') || new Map()).values()].reduce((n, v) => n + (v.byteLength || v.length || 0), 0);
  return api;
}

function fakeLocalStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// ── the engine, lifted and run ────────────────────────────────────────────────────────────────────────────
// Declarations first (taken from engine.js as source text, not retyped), then the functions that close over
// them. `notify` is counted so a harness that never reaches engine.js cannot pass vacuously.
function engine({ breakDeleteOf = null } = {}) {
  const idb = fakeIndexedDB({ breakDeleteOf });
  const parts = [
    stmt(ENGINE, 'const modules = {};'),
    stmt(ENGINE, 'let order = [];'),
    stmt(ENGINE, 'let active = null;'),
    stmt(ENGINE, 'const dicts = [];'),
    stmt(ENGINE, 'const _pendingDicts = [];'),
    'let _dictsLoaded = false;',
    stmt(ENGINE, 'const commentaries = {};'),
    stmt(ENGINE, 'const subs = new Set();'),
    stmt(ENGINE, 'const notify = ('),
    // the real subscribe, lifted out of the window.Bible literal as an object method
    'const _sub = { ' + fnBody(ENGINE, 'subscribe(fn){') + ' };',
    'const src = () => null;',   // getCommentary's footnote half: no active Bible in this harness
    stmt(ENGINE, 'const INSTALLED_KEY = '),
    stmt(ENGINE, 'const installing = new Set();'),
    fnBody(ENGINE, 'function addDict(entries, abbr){'),
    fnBody(ENGINE, 'function _ensureDicts(){'),
    fnBody(ENGINE, 'function hasDict(abbr){'),
    fnBody(ENGINE, 'function removeDict(abbr){'),
    fnBody(ENGINE, 'function loadDictJSON(obj, abbr){'),
    fnBody(ENGINE, 'function addCommentary(src){'),
    fnBody(ENGINE, 'function addSource(src){'),
    fnBody(ENGINE, 'function idb(){'),
    fnBody(ENGINE, 'function idbStore(db, mode){'),
    fnBody(ENGINE, 'async function cacheGet(key){'),
    fnBody(ENGINE, 'async function cachePut(key, u8){'),
    fnBody(ENGINE, 'async function cacheKeys(){'),
    fnBody(ENGINE, 'async function cacheDelete(key){'),
    fnBody(ENGINE, 'function getInstalled(){'),
    fnBody(ENGINE, 'function setInstalled(map){'),
    fnBody(ENGINE, 'function catOf(item){'),
    fnBody(ENGINE, 'function recordInstalled(item){'),
    fnBody(ENGINE, 'function isInstalled(url){'),
    fnBody(ENGINE, 'async function removeModule(id){'),
    fnBody(ENGINE, 'function getCommentary(b, c, version){'),
    // lex() is how a dictionary is actually consulted — a tap on a Strong's number. It needs the built-in
    // fallback set and the tag stripper; the lazy full-lexicon install is stubbed out because it downloads.
    stmt(ENGINE, 'const LEX = {'),
    stmt(ENGINE, "const _LEX_FIELDS = ["),
    fnBody(ENGINE, 'function _stripTags(s){'),
    'function _ensureFullLexicon(){}',
    fnBody(ENGINE, 'function lex(id){'),
  ];
  const api = new Function('indexedDB', 'localStorage', 'console',
    parts.join('\n') +
    '\nreturn { modules, dicts, _pendingDicts, commentaries, installing, addDict, _ensureDicts, loadDictJSON,' +
    ' addCommentary, addSource, cacheGet, cachePut, cacheKeys, cacheDelete, getInstalled, recordInstalled,' +
    ' isInstalled, removeModule, getCommentary, lex, subscribe: _sub.subscribe,' +
    ' order: () => order, active: () => active, setActive: (a) => { active = a; } };'
  )(idb, fakeLocalStorage(), console);
  // The vacuity counter goes through the engine's OWN notify/subscribe, so it also proves the harness is
  // running engine.js's pub/sub rather than a stand-in.
  let notified = 0;
  api.subscribe(() => { notified++; });
  return { ...api, idb, notified: () => notified };
}

// ── a phone with four modules on it ───────────────────────────────────────────────────────────────────────
const BIBLE = { id: 'engbsb', abbr: 'BSB', name: 'Berean Standard Bible', kind: 'bible', format: 'USFM', category: 'bibles', url: 'modules/engbsb.zip' };
const SECOND = { id: 'eng-kjv', abbr: 'KJV', name: 'King James Version', kind: 'bible', format: 'USFM', category: 'bibles', url: 'modules/eng-kjv.zip' };
const CMT = { id: 'matthew-henry', abbr: 'MHC', name: "Matthew Henry's Commentary", kind: 'comment', format: 'MySword', category: 'commentaries', url: 'modules/matthew-henry.cmt.mybible.zip' };
const DICT = { id: 'strongs', abbr: "Strong's", name: "Strong's Greek & Hebrew Dictionary", kind: 'dict', format: 'JSON', category: 'dictionaries', url: 'modules/strongs-dict.json' };

const bytes = (n) => new Uint8Array(n);

// Install the four the way engine.js does: cache the bytes, load the thing into its own store, record it.
async function phone(opts) {
  const e = engine(opts);
  await e.cachePut(BIBLE.url, bytes(3_000_000));
  e.addSource({ abbr: BIBLE.abbr, name: BIBLE.name, books: [], maxChap: {} });
  e.recordInstalled(BIBLE);

  await e.cachePut(SECOND.url, bytes(2_600_000));
  e.addSource({ abbr: SECOND.abbr, name: SECOND.name, books: [], maxChap: {} });
  e.recordInstalled(SECOND);

  await e.cachePut(CMT.url, bytes(25_000_000));
  e.addCommentary({ abbr: CMT.abbr, name: CMT.name, getComment: () => [] });
  e.recordInstalled(CMT);

  await e.cachePut(DICT.url, bytes(4_010_000));
  e.loadDictJSON({ entries: { G26: { lemma: 'ἀγάπη', short: 'love' } } }, DICT.abbr);
  e.recordInstalled(DICT);
  return e;
}

// ── the screen ────────────────────────────────────────────────────────────────────────────────────────────
// The real InstalledBrowser, compiled from app/screens-library.jsx, over the real engine above.
function screen(e) {
  const { React, draw } = miniReact();
  const toasts = [];
  const g = {
    React,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    Spinner: () => React.createElement('i', { 'data-icon': 'spinner' }),
    ScreenScroll: (p) => p.children,
    safeCssColor: (c) => c || 'var(--clay)',
    window: {
      Bible: {
        installedMap: e.getInstalled,
        get activeVersion() { return e.active(); },
        removeModule: e.removeModule,
        isInstalled: e.isInstalled,
        versions: () => e.order().map(a => ({ abbr: a, name: e.modules[a].name })),
        subscribe: () => () => {},
      },
      TrinityData: {},
      addEventListener() {}, removeEventListener() {},
    },
    document: { addEventListener() {}, removeEventListener() {} },
  };
  const { InstalledBrowser } = loadScreen('app/screens-library.jsx', ['InstalledBrowser'], g);
  const ctx = { toast: (t) => toasts.push(t), go() {}, closeStore() {} };
  let tree = draw(InstalledBrowser, { ctx, category: null, force: () => {} });
  const redraw = () => { tree = draw(InstalledBrowser, { ctx, category: null, force: () => {} }); return tree; };
  // The row for a module is the one whose text carries its name; its Remove button is the button inside it.
  const rowFor = (name) => {
    const rows = find(tree, n => n.type === 'div' && texts(n).join(' ').includes(name) && find(n, x => x.type === 'button').length === 1);
    assert.ok(rows.length >= 1, `no Installed row for ${name} — re-anchor this test`);
    return rows[rows.length - 1];
  };
  const removeBtn = (name) => find(rowFor(name), n => n.type === 'button')[0];
  return {
    toasts, redraw, removeBtn,
    tapRemove: async (name) => { const b = removeBtn(name); await b.props.onClick(); return redraw(); },
    words: () => texts(tree).join(' '),
  };
}

// ── T1: the control row ───────────────────────────────────────────────────────────────────────────────────
test('CONTROL — the Installed tier lists all four modules with a Remove on each, and the bytes are on disk', async () => {
  const e = await phone();
  const s = screen(e);
  for (const m of [BIBLE, SECOND, CMT, DICT]) {
    assert.ok(s.words().includes(m.name), `${m.name} is not listed as installed — re-anchor this test`);
    assert.match(texts(s.removeBtn(m.name)).join(' '), /Remove/, `${m.name}'s row has no Remove control`);
  }
  assert.deepEqual(e.idb._keys().sort(), [BIBLE.url, SECOND.url, CMT.url, DICT.url].sort());
  assert.equal(e.idb._bytes(), 34_610_000, 'the harness is not holding the module bytes it thinks it is');
  assert.ok(e.notified() > 0, 'the harness never reached engine.js notify() — every assertion here would be vacuous');
});

// ── T2: a commentary ──────────────────────────────────────────────────────────────────────────────────────
test('A COMMENTARY IS REMOVED BY THE BUTTON ON THE LIBRARY SCREEN, and its 25 MB come back', async () => {
  const e = await phone();
  const s = screen(e);
  assert.ok(e.commentaries[CMT.abbr], 'the commentary was not loaded — re-anchor this test');

  await s.tapRemove(CMT.name);

  assert.equal(e.commentaries[CMT.abbr], undefined,
    'the commentary is still loaded in memory, so the notes panel goes on reading it');
  assert.equal(e.getInstalled()[CMT.url], undefined,
    'the commentary is still in the installed map: it is still listed as installed and restoreInstalled() ' +
    'will load it again at the next boot');
  assert.equal(e.idb._keys().includes(CMT.url), false, 'the commentary bytes are still in IndexedDB');
  assert.equal(e.idb._bytes(), 34_610_000 - 25_000_000, 'the space did not come back');
  assert.deepEqual(s.toasts, [`Removed ${CMT.abbr}`], `the screen said ${JSON.stringify(s.toasts)}`);
  assert.equal(s.words().includes(CMT.name), false, 'the removed commentary is still listed on the screen');
});

// ── T3: a dictionary ──────────────────────────────────────────────────────────────────────────────────────
test('A DICTIONARY IS REMOVED THE SAME WAY, and stops answering lookups', async () => {
  const e = await phone();
  const s = screen(e);
  assert.equal(e.dicts.length, 1, 'the dictionary was not loaded — re-anchor this test');
  assert.equal(e.lex('G26').short, 'love', 'the installed dictionary is not answering lookups — re-anchor this test');

  await s.tapRemove(DICT.name);

  assert.equal(e.dicts.length, 0, 'the dictionary entries are still in memory');
  // A tap on that Strong's number now falls back to the small built-in set, which does not carry G26.
  assert.equal(e.lex('G26').missing, true, 'the removed dictionary is still answering lookups');
  assert.equal(e.lex('G26').short, undefined, 'the removed dictionary is still answering lookups');
  assert.equal(e.getInstalled()[DICT.url], undefined, 'the dictionary is still recorded as installed');
  assert.equal(e.idb._keys().includes(DICT.url), false, 'the dictionary bytes are still in IndexedDB');
  assert.equal(e.idb._bytes(), 34_610_000 - 4_010_000, 'the space did not come back');
  assert.deepEqual(s.toasts, [`Removed ${DICT.abbr}`]);
});

// ── T4: the deferred parse that would put it straight back ────────────────────────────────────────────────
test('A DICTIONARY REMOVED BEFORE ITS DEFERRED PARSE RAN DOES NOT COME BACK', async () => {
  // restoreInstalled() does not parse a JSON lexicon at boot — 14k entries is a measurable boot cost before
  // anyone has tapped a word — it queues the parse in _pendingDicts, holding the raw bytes, and runs it on
  // idle. Remove the dictionary inside that window and a removal that only emptied `dicts` would be undone
  // a second later by a timer, with the bytes already deleted from the cache.
  const e = await phone();
  e.dicts.length = 0;                                     // as at boot: recorded, cached, not yet parsed
  const raw = { entries: { G26: { lemma: 'ἀγάπη', short: 'love' } } };
  e._pendingDicts.push({ abbr: DICT.abbr, run: () => e.loadDictJSON(raw, DICT.abbr) });

  const s = screen(e);
  await s.tapRemove(DICT.name);
  assert.deepEqual(s.toasts, [`Removed ${DICT.abbr}`]);

  e._ensureDicts();                                        // the idle callback fires
  assert.equal(e.dicts.length, 0, 'the deferred parse put the removed dictionary back');
  assert.equal(e._pendingDicts.length, 0, 'the removed dictionary is still queued for parsing');
});

// ── T5: the Bible that was already removable, still removable ─────────────────────────────────────────────
test('A BIBLE THAT IS NOT THE ONE BEING READ IS STILL REMOVED — the old behaviour is kept', async () => {
  const e = await phone();
  assert.equal(e.active(), BIBLE.abbr, 'the first-loaded Bible should be active — re-anchor this test');
  const s = screen(e);

  await s.tapRemove(SECOND.name);

  assert.equal(e.modules[SECOND.abbr], undefined, 'the Bible is still loaded');
  assert.equal(e.order().includes(SECOND.abbr), false, 'the Bible is still in the reader\'s version order');
  assert.equal(e.getInstalled()[SECOND.url], undefined, 'the Bible is still recorded as installed');
  assert.equal(e.idb._keys().includes(SECOND.url), false, 'the Bible bytes are still in IndexedDB');
  assert.deepEqual(s.toasts, [`Removed ${SECOND.abbr}`]);
});

// ── T6: the guard that was there before is not widened ────────────────────────────────────────────────────
test('THE BIBLE BEING READ IS STILL REFUSED, on the screen and in the engine', async () => {
  const e = await phone();
  const s = screen(e);
  assert.equal(s.removeBtn(BIBLE.name).props.disabled, true,
    'the active Bible\'s Remove is tappable — one tap and the member has nothing to read');
  assert.equal(await e.removeModule(BIBLE.url), false, 'the engine removed the Bible that is being read');
  assert.equal(await e.removeModule(BIBLE.abbr), false, 'the engine removed the Bible that is being read (by abbr)');
  assert.ok(e.idb._keys().includes(BIBLE.url), 'the active Bible\'s bytes were deleted underneath the reader');
  // and the refusal is specific to the ACTIVE Bible, not to Bibles, and not to anything else:
  assert.equal(await e.removeModule(CMT.url), true, 'the active-Bible guard is refusing a commentary too');
});

// ── T7: the honest failure path ───────────────────────────────────────────────────────────────────────────
test('A REMOVAL THAT CANNOT HAPPEN STILL SAYS SO, and does not orphan the bytes', async () => {
  // A store that will not delete. The bytes stay, so the removal has NOT happened, and the two things that
  // must follow are: the screen says so, and the module stays listed — because a module dropped from the
  // installed map with its bytes still on the device can never be offered for removal again.
  const e = await phone({ breakDeleteOf: CMT.url });
  const s = screen(e);

  await s.tapRemove(CMT.name);

  assert.deepEqual(s.toasts, [`Couldn't remove ${CMT.name}`],
    `the screen said ${JSON.stringify(s.toasts)} over a removal that did not happen`);
  assert.ok(e.idb._keys().includes(CMT.url), 'the harness did not actually block the delete — re-anchor this test');
  assert.ok(e.getInstalled()[CMT.url], 'the record was dropped while the bytes stayed: 25 MB now unreachable');
  assert.ok(s.words().includes(CMT.name), 'the module vanished from the screen over a removal that failed');
});

// ── T8: a download still running ──────────────────────────────────────────────────────────────────────────
test('A MODULE THAT IS STILL DOWNLOADING IS NOT "REMOVED" — installModule would put it straight back', async () => {
  const e = await phone();
  e.installing.add(CMT.url);                               // installModule holds this for the whole download
  const s = screen(e);

  await s.tapRemove(CMT.name);

  assert.deepEqual(s.toasts, [`Couldn't remove ${CMT.name}`]);
  assert.ok(e.idb._keys().includes(CMT.url), 'the bytes of a running download were deleted under it');
  assert.ok(e.getInstalled()[CMT.url], 'the record of a running download was dropped');
});

// ── T10: the reader's notes panel, with a commentary open in it ───────────────────────────────────────────
// The other half of "removed means removed": the panel that is READING the commentary while the member
// removes it. CommentaryPanel copies getCommentary()'s rows into state, and that effect used to re-run only
// on a new chapter or a new translation — so an uninstalled commentary stayed on screen, out of a copy, with
// its bytes already deleted. Both screens here are the real ones, over one real engine.
function readerPanel(e) {
  const { React, draw } = miniReact();
  const g = {
    React,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Spinner: () => React.createElement('i', {}),
    BottomSheet: (p) => p.children,
    ScreenScroll: (p) => p.children,
    safeCssColor: (c) => c || 'var(--clay)',
    window: {
      Bible: { getCommentary: e.getCommentary, subscribe: e.subscribe, commentaryList: () => Object.keys(e.commentaries) },
      sanitizeHtml: (h) => h,
      TrinityData: {}, addEventListener() {}, removeEventListener() {},
    },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {} }) },
  };
  const { CommentaryPanel } = loadScreen('app/screens-read.jsx', ['CommentaryPanel'], g);
  const ctx = { notes: {}, setNote() {}, version: 'BSB', toast() {} };
  const props = { loc: { book: 43, chap: 1 }, label: 'John 1', open: true, onClose() {}, ctx, docked: false };
  let tree = draw(CommentaryPanel, props);
  const redraw = () => (tree = draw(CommentaryPanel, props));
  redraw();   // the first draw only queues the effect; the second reads what it set
  // The commentary's words reach the page through dangerouslySetInnerHTML, which is an OBJECT prop and so
  // is invisible to texts(). Read them out of the tree directly, or this test could only see the heading.
  const bodies = () => find(tree, n => n.props && n.props.dangerouslySetInnerHTML)
    .map(n => n.props.dangerouslySetInnerHTML.__html).join(' ');
  return { redraw, bodies, words: () => texts(tree).join(' ') };
}

test('A COMMENTARY REMOVED WHILE THE NOTES PANEL IS OPEN LEAVES THE PANEL', async () => {
  const e = await phone();
  e.commentaries[CMT.abbr].getComment = () => [{ v: 1, vTo: 1, html: '<p>In the beginning was the Word.</p>' }];
  const panel = readerPanel(e);
  assert.ok(panel.words().includes(CMT.name),
    'the open panel is not showing the commentary at all — re-anchor this test');
  assert.ok(panel.bodies().includes('In the beginning was the Word.'),
    'the commentary\'s words are not on the panel — re-anchor this test');

  await screen(e).tapRemove(CMT.name);   // the member removes it from the Library
  panel.redraw();

  assert.equal(panel.words().includes(CMT.name) || panel.bodies().includes('In the beginning was the Word.'), false,
    'the notes panel is still reading a commentary that has been removed and whose bytes are deleted');
  assert.ok(panel.words().includes('Install a commentary from the Library'),
    'the panel did not fall back to its empty state');
});

// ── T11: the reader's Translations sheet ──────────────────────────────────────────────────────────────────
// The OTHER Remove control in the app. It toasted "Removed BSB" the moment it was tapped, over a call it
// never waited for — the Library's Installed tier had exactly this bug and it was fixed there on 2026-09-10.
// It matters more now: a removal can genuinely fail (bytes that will not delete, a download still running),
// and this sheet is where a member removes a Bible.
//
// ctx.removeTranslation is wired to Bible.removeModule in app.jsx (`removeTranslation: (abbr) =>
// Bible.removeModule(abbr)`) and is mirrored here — that one hop is the only part of this path not executed
// by this test. Everything it decides comes from the real engine.
function versionSheet(e) {
  const { React, draw } = miniReact();
  const g = {
    React,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Spinner: () => React.createElement('i', {}),
    BottomSheet: (p) => p.children,
    ScreenScroll: (p) => p.children,
    safeCssColor: (c) => c || 'var(--clay)',
    window: {
      Bible: {
        versions: () => e.order().map(a => ({ abbr: a, name: e.modules[a].name, kind: 'bible' })),
        getCatalog: () => Promise.resolve({ categories: [] }),
        isInstalled: e.isInstalled,
        isInstalling: (u) => e.installing.has(u),
        subscribe: e.subscribe,
      },
      sanitizeHtml: (h) => h,
      TrinityData: {}, addEventListener() {}, removeEventListener() {},
    },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {} }) },
  };
  const { VersionSheet } = loadScreen('app/screens-read.jsx', ['VersionSheet'], g);
  const toasts = [];
  const ctx = { toast: (t) => toasts.push(t), setVersion() {}, removeTranslation: (abbr) => e.removeModule(abbr) };
  const props = { open: true, onClose() {}, version: BIBLE.abbr, onPick() {}, onAdd() {}, ctx };
  let tree = draw(VersionSheet, props);
  const redraw = () => (tree = draw(VersionSheet, props));
  const byLabel = (re) => find(tree, n => n.type === 'button' && n.props && re.test(String(n.props['aria-label'] || '')));
  return { toasts, redraw, byLabel, words: () => texts(tree).join(' ') };
}

test('THE READER\'S TRANSLATIONS SHEET REPORTS WHAT REALLY HAPPENED', async () => {
  const ok = await phone();
  const s = versionSheet(ok);
  assert.equal(s.byLabel(new RegExp('Remove ' + BIBLE.name)).length, 0,
    'the Bible being read has a Remove in the sheet — re-anchor this test');
  const drop = s.byLabel(new RegExp('Remove ' + SECOND.name));
  assert.equal(drop.length, 1, 'there is no way to remove a translation from the reader — re-anchor this test');

  await drop[0].props.onClick({ stopPropagation() {} });
  s.redraw();
  assert.deepEqual(s.toasts, [`Removed ${SECOND.abbr}`]);
  assert.equal(ok.idb._keys().includes(SECOND.url), false, 'the bytes are still there');
  assert.equal(s.words().includes(SECOND.name), false, 'the removed translation is still in the reader\'s list');

  // and the same tap over a removal that cannot happen
  const bad = await phone({ breakDeleteOf: SECOND.url });
  const b = versionSheet(bad);
  await b.byLabel(new RegExp('Remove ' + SECOND.name))[0].props.onClick({ stopPropagation() {} });
  b.redraw();
  assert.deepEqual(b.toasts, [`Couldn't remove ${SECOND.abbr}`],
    `the sheet said ${JSON.stringify(b.toasts)} over a removal that did not happen`);
  assert.ok(b.words().includes(SECOND.name), 'the translation vanished from the list over a removal that failed');
});

// ── T9: what is NOT claimed ───────────────────────────────────────────────────────────────────────────────
test('NO DEVOTIONAL CAN BE INSTALLED, so there is none to remove — stated, not papered over', async () => {
  // catOf() knows the category and the Library has a Devotionals section, but nothing can put a module in
  // it: loadModuleBytes recognises a Bible, a commentary and a dictionary and throws on anything else, and
  // catalog.json offers only an Import placeholder under devotionals. If that ever changes, this test goes
  // red and removal must be proved for the new branch rather than assumed from this file.
  const cat = JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8'));
  const devo = (cat.categories || []).find(c => c.id === 'devotionals');
  assert.ok(devo, 'catalog.json no longer has a devotionals category — re-anchor this test');
  assert.deepEqual((devo.items || []).map(i => i.kind), ['import'],
    'a devotional is downloadable now — prove removal for it as T2/T3 do, do not assume it');
  const load = fnBody(ENGINE, 'async function loadModuleBytes(u8, srcName, meta){');
  assert.equal(/kind: "devotional"/.test(load), false,
    'loadModuleBytes has a devotional branch now — the same applies');
  // And a record in a category with nothing in memory is still removable: the record and the bytes go.
  const e = await phone();
  e.recordInstalled({ url: 'modules/a-devotional.zip', id: 'dv', abbr: 'DVT', name: 'A devotional', kind: 'devotional' });
  await e.cachePut('modules/a-devotional.zip', bytes(1000));
  assert.equal(await e.removeModule('modules/a-devotional.zip'), true);
  assert.equal(e.idb._keys().includes('modules/a-devotional.zip'), false, 'the bytes stayed');
});
