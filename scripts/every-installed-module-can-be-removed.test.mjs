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
// AND THE SECOND DEFECT, FOUND BY AUDIT ON TOP OF THE FIRST: there were TWO NAMES for one module. The
// installed record stored the CATALOGUE abbr while the engine registered a DEDUPED one (addSource,
// addCommentary and now addDict all turn a second "NT" into "NT2"), so two modules sharing a catalogue abbr
// produced two records saying the same thing, one of them naming a module that is not there. That is not
// exotic: 260 of the 1,290 entries in ebible-catalog.json are abbr "NT". T12-T15 below are that case, from
// the screen. The record now carries what was registered, and a record written by an older build is
// repaired on the next launch by restoreInstalled.
//
// WHY THE ENGINE RUNS FOR REAL HERE. "Removed" is a claim about bytes, so a stubbed cache would answer the
// question the test is named after (memory/stub-answers-the-question). engine.js's own installModule,
// restoreInstalled, removeModule, addSource/addCommentary/addDict/applyMeta, recordInstalled/getInstalled/
// setInstalled/noteRegisteredAbbr, cacheGet/cachePut/cacheDelete/cacheHas/cacheKeys, lex/searchDict/
// getCommentary and notify/subscribe are lifted with fnBody/stmt and RUN, over an in-memory IndexedDB and
// localStorage. Those two are stores, not deciders, and the assertions read them afterwards.
//
// TWO STUBS, BOTH NAMED. `publishedPins()` returns {} (what the catalogue publishes is
// a-republished-module-reaches-a-phone-that-has-the-old-one's subject), and the download-and-parse half —
// fetchAsset/loadModuleBytes/fetchAndCacheModule — serves fixture bytes and builds a plain source object
// instead of unzipping a real module and reading its SQLite (proved in a real browser by
// a-tampered-module-is-refused and aquifer-study-notes-reach-the-study-panel). Everything they hand over
// goes through the engine's own addSource/addCommentary/addDict/applyMeta, which is where the name that
// ends up in the installed record is decided — the thing under test.
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
//     passes no meta, so addDict registers it under "" and loadModuleBytes hands back an empty abbr, and
//     that path records a module only `if(r && r.abbr)`. An imported dict is therefore neither cached nor
//     listed and does not survive a restart. A defect in IMPORT, upstream of removal, left alone here.
//     It is also why removeDict keeps its `if(!abbr) return;` guard: an anonymous dictionary cannot be
//     told apart from any other anonymous dictionary, and no path records one, so there is nothing that
//     reaches it. If import ever starts naming them, that guard must be revisited with this note.
//   · ONE NARROW WINDOW SURVIVES THE COLLISION FIX, and it is worth writing down: between boot and the
//     idle parse of a deferred JSON dictionary, two colliding dictionaries whose records were written by an
//     older build both sit in _pendingDicts under the same abbr, so removing either drops both from memory
//     until the next launch. The record and the bytes of the kept one are untouched and the repair lands
//     when the parse runs, and no screen removes a dictionary by abbr (the Library passes the url), so
//     nothing in the product reaches it — but a future caller passing an abbr would.
//   · A MODULE LOADED BUT NEVER RECORDED still leaves memory and still reports success, and any bytes it
//     cached under a url nothing wrote down stay where they are. The one shipped path that landed there —
//     autoLoad's `?module=<url>`, which cached bytes and recorded nothing — now records what it caches, so
//     what is left is a localStorage write that failed (setInstalled swallows it), where nothing could
//     have been listed in the first place.
//
// AND IT IS DRIVEN FROM THE SCREENS (CLAUDE.md rule 1). The removals below are performed by tapping the real
// Remove button on the real InstalledBrowser and the real VersionSheet, with the real CommentaryPanel and
// SearchScreen watching — all four compiled out of app/*.jsx by esbuild and rendered through
// scripts/render-jsx-screen.mjs. Delete the Remove button and nine of these fail. Nothing here matches text
// in app/*.jsx (rule 3).
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
function fakeIndexedDB({ breakDeleteOf = null, unavailable = false } = {}) {
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
        count: (k) => settle(req(), m.has(k) ? 1 : 0),
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
      // `unavailable` is a store that will not open — private browsing, a corrupt database, a quota
      // refusal. engine.js's idb() rejects, so cacheDelete does nothing AND cacheGet answers null: the
      // two failures a removal must never read as "the bytes are gone".
      if (unavailable) { r.error = new Error('IndexedDB is unavailable'); setTimeout(() => { if (r.onerror) r.onerror(); }, 0); return r; }
      setTimeout(() => { if (!upgraded) { upgraded = true; if (r.onupgradeneeded) r.onupgradeneeded(); } if (r.onsuccess) r.onsuccess(); }, 0);
      return r;
    },
  };
  // what is on disk, as the test sees it
  api._breakOpen = (v) => { unavailable = !!v; };
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
function engine({ breakDeleteOf = null, unavailable = false, search = '' } = {}) {
  const idb = fakeIndexedDB({ breakDeleteOf, unavailable });
  // what each url serves, by basename — see FIXTURE below
  const fixture = (nameOrUrl) => {
    const f = FIXTURE.get(String(nameOrUrl).split('/').pop());
    assert.ok(f, 'no fixture for ' + nameOrUrl + ' — re-anchor this test');
    return f;
  };
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
    fnBody(ENGINE, 'function applyMeta(src, meta){'),
    stmt(ENGINE, 'const KNOWN_HASHES = {'),
    fnBody(ENGINE, 'async function sha256hex(u8){'),
    fnBody(ENGINE, 'async function verifyIntegrity(url, u8, declaredHash){'),
    fnBody(ENGINE, 'async function cachedCopyIsCurrent(url, u8, declaredHash){'),
    // THE ONE STUB IN THE INSTALL PATH, and it is the download-and-parse half ONLY: unzipping a real
    // module and reading its SQLite is proved in a real browser by a-tampered-module-is-refused and
    // aquifer-study-notes-reach-the-study-panel. Everything this hands to the engine goes through the
    // engine's own addSource / addCommentary / addDict / applyMeta, which is where the abbr that ends up
    // in the installed record is decided — the thing under test. Shaped like the real pair so installModule
    // and restoreInstalled call exactly what they call in the app.
    `const fetchAsset = async (url) => ({ headers: { get: () => String(FIXTURE(url).bytes.length) },
        arrayBuffer: async () => FIXTURE(url).bytes.buffer.slice(0) });
     async function loadModuleBytes(u8, srcName, meta){
       const f = FIXTURE(srcName);
       if(f.kind === "comment") return { kind: "comment", abbr: addCommentary(applyMeta({ abbr: f.declares, name: (meta && meta.name) || srcName, getComment: () => [] }, meta)) };
       if(f.kind === "dict")    return { kind: "dict",    abbr: addDict(JSON.parse(new TextDecoder().decode(u8)).entries, meta && meta.abbr) };
       return { kind: "bible", abbr: addSource(applyMeta({ abbr: f.declares, name: (meta && meta.name) || srcName, books: [], maxChap: {} }, meta)) };
     }
     async function fetchAndCacheModule(url, meta){
       const cached = await cacheGet(url);
       if(cached && await cachedCopyIsCurrent(url, cached, meta && meta.sha256)) return loadModuleBytes(cached, url.split("/").pop(), meta);
       const res = await fetchAsset(url);
       const u8 = new Uint8Array(await res.arrayBuffer());
       await verifyIntegrity(url, u8, meta && meta.sha256);
       await cachePut(url, u8);
       return loadModuleBytes(u8, url.split("/").pop(), meta);
     }
     const publishedPins = async () => ({});`,
    fnBody(ENGINE, 'async function installModule(item){'),
    fnBody(ENGINE, 'async function restoreInstalled(){'),
    stmt(ENGINE, 'const DEFAULT_MODULE = {'),
    'let loadingFlag = false;',
    fnBody(ENGINE, 'async function autoLoad(){'),
    fnBody(ENGINE, 'function idb(){'),
    fnBody(ENGINE, 'function idbStore(db, mode){'),
    fnBody(ENGINE, 'async function cacheGet(key){'),
    fnBody(ENGINE, 'async function cachePut(key, u8){'),
    fnBody(ENGINE, 'async function cacheKeys(){'),
    fnBody(ENGINE, 'async function cacheDelete(key){'),
    fnBody(ENGINE, 'async function cacheHas(key){'),
    fnBody(ENGINE, 'function getInstalled(){'),
    fnBody(ENGINE, 'function setInstalled(map){'),
    fnBody(ENGINE, 'function catOf(item){'),
    fnBody(ENGINE, 'function recordInstalled(item, registered){'),
    fnBody(ENGINE, 'function noteRegisteredAbbr(url, abbr){'),
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
    fnBody(ENGINE, 'function searchDict(query, cap){'),
  ];
  const win = { Bible: {}, addEventListener() {}, removeEventListener() {} };
  const api = new Function('indexedDB', 'localStorage', 'console', 'FIXTURE', 'window', 'requestIdleCallback', 'location',
    parts.join('\n') +
    '\nreturn { modules, dicts, _pendingDicts, commentaries, installing, addDict, _ensureDicts, loadDictJSON,' +
    ' addCommentary, addSource, cacheGet, cachePut, cacheKeys, cacheDelete, getInstalled, recordInstalled,' +
    ' isInstalled, removeModule, getCommentary, lex, searchDict, cacheHas, noteRegisteredAbbr, installModule,' +
    ' restoreInstalled, autoLoad, subscribe: _sub.subscribe,' +
    ' order: () => order, active: () => active, setActive: (a) => { active = a; } };'
  )(idb, fakeLocalStorage(), console, fixture, win, undefined, { search });
  // The vacuity counter goes through the engine's OWN notify/subscribe, so it also proves the harness is
  // running engine.js's pub/sub rather than a stand-in.
  let notified = 0;
  api.subscribe(() => { notified++; });
  return { ...api, idb, notified: () => notified };
}

// ── the modules on the phone ──────────────────────────────────────────────────────────────────────────────
// Catalogue entries in the shape catalog.json / ebible-catalog.json really use. NT_A and NT_B are the case
// that blocks everything else: TWO MODULES, ONE CATALOGUE ABBR. 260 of the 1,290 entries in
// ebible-catalog.json carry abbr "NT" (9 more are "NTPO", 7 "BL"), so two minority-language New Testaments
// on one phone is the ordinary case for this product's stated first audience, not a corner.
const BIBLE = { id: 'engbsb', abbr: 'BSB', name: 'Berean Standard Bible', kind: 'bible', format: 'USFM', category: 'bibles', url: 'modules/engbsb-fixture.zip' };
const SECOND = { id: 'eng-kjv', abbr: 'KJV', name: 'King James Version', kind: 'bible', format: 'USFM', category: 'bibles', url: 'modules/eng-kjv-fixture.zip' };
const CMT = { id: 'matthew-henry', abbr: 'MHC', name: "Matthew Henry's Commentary", kind: 'comment', format: 'MySword', category: 'commentaries', url: 'modules/matthew-henry.cmt.mybible.zip' };
const DICT = { id: 'bdb', abbr: 'BDB', name: 'Brown-Driver-Briggs', kind: 'dict', format: 'JSON', category: 'dictionaries', url: 'modules/lex-bdb.json' };
const NT_A = { id: 'ahi-nt', abbr: 'NT', name: 'Ahirani New Testament', kind: 'bible', format: 'USFM', category: 'bibles', url: 'modules/ahi-nt.zip' };
const NT_B = { id: 'bhi-nt', abbr: 'NT', name: 'Bhili New Testament', kind: 'bible', format: 'USFM', category: 'bibles', url: 'modules/bhi-nt.zip' };

// The bytes each url serves, keyed by BASENAME because that is what loadModuleBytes is given. The dictionary
// is real JSON because the engine parses it; the rest are opaque blobs of a plausible size, since what this
// file measures about them is how many bytes leave the store.
const DICT_JSON = JSON.stringify({ entries: { G26: { lemma: 'ἀγάπη', short: 'love' } } });
const FIXTURE = new Map([
  [BIBLE, 3_000_000], [SECOND, 2_600_000], [CMT, 25_000_000], [NT_A, 1_100_000], [NT_B, 1_200_000],
].map(([m, n]) => [m.url.split('/').pop(), { kind: m.kind, bytes: new Uint8Array(n), declares: m.abbr }]));
FIXTURE.set(DICT.url.split('/').pop(), { kind: DICT.kind, bytes: new TextEncoder().encode(DICT_JSON) });
const SIZE = (m) => FIXTURE.get(m.url.split('/').pop()).bytes.length;
const rawOf = (m) => FIXTURE.get(m.url.split('/').pop()).bytes;

// Install through the engine's OWN installModule, so the line that decides what goes in the installed
// record — `recordInstalled(item, loaded && loaded.abbr)` — is the shipped one and the abbr it records is
// whatever addSource/addCommentary/addDict really registered.
async function phone(opts = {}) {
  const e = engine(opts);
  for (const m of opts.modules || [BIBLE, SECOND, CMT, DICT]) await e.installModule(m);
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
  assert.equal(e.idb._bytes(), [BIBLE, SECOND, CMT, DICT].reduce((n, m) => n + SIZE(m), 0),
    'the harness is not holding the module bytes it thinks it is');
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
  assert.equal(e.idb._bytes(), [BIBLE, SECOND, DICT].reduce((n, m) => n + SIZE(m), 0), 'the space did not come back');
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
  assert.equal(e.idb._bytes(), [BIBLE, SECOND, CMT].reduce((n, m) => n + SIZE(m), 0), 'the space did not come back');
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

// ── T12: two modules, one catalogue abbr ──────────────────────────────────────────────────────────────────
// THE CASE THAT BLOCKED THIS BRANCH AT AUDIT, and it is reachable from the shipped Library today: 260 of the
// 1,290 entries in ebible-catalog.json are abbr "NT". `addSource` has always deduped a colliding name in
// memory (NT -> NT2) while `recordInstalled` stored the CATALOGUE abbr, so both records said "NT" and:
//   (a) the Library disabled Remove on BOTH rows whenever either was the Bible being read, because the
//       guard is `r.abbr === active` — the exact "you cannot remove it" defect this branch exists to end;
//   (b) removing either ran `delete modules["NT"]` and evicted the one the member KEPT from the reader,
//       while the one they removed stayed readable with its bytes already deleted;
//   (c) the reader's Translations sheet passes the REGISTERED abbr ("NT2"), which matched no record at all,
//       so nothing was deleted, nothing was freed, and it said "Removed NT2".
// All three are one root cause — two names for one module — and the fix is that the record carries the name
// the engine registered. Everything below is driven through the screens.
test('TWO MODULES SHARING A CATALOGUE ABBR ARE TWO MODULES, on the screen and in the store', async () => {
  const e = await phone({ modules: [NT_A, NT_B] });
  assert.equal(e.active(), 'NT', 'the first-loaded Bible should be active — re-anchor this test');
  assert.deepEqual(Object.values(e.getInstalled()).map(r => r.abbr), ['NT', 'NT2'],
    'the installed records do not carry the names the engine registered, so one of them names a module ' +
    'that is not there');
  const s = screen(e);

  // (a) the one being read is refused; THE OTHER ONE IS OFFERED.
  assert.equal(s.removeBtn(NT_A.name).props.disabled, true, 'the Bible being read can be removed');
  assert.equal(s.removeBtn(NT_B.name).props.disabled, false,
    'the second New Testament cannot be removed while the first is being read — both rows say "NT", so ' +
    'the active-Bible guard disables a module that is not active');

  // (b) removing it leaves the other one readable.
  await s.tapRemove(NT_B.name);
  assert.deepEqual(s.toasts, ['Removed NT2']);
  assert.ok(e.modules.NT, 'removing the second New Testament evicted the FIRST from the reader');
  assert.deepEqual(e.order(), ['NT'], 'the reader\'s version order lost the module the member kept');
  assert.equal(e.modules.NT2, undefined, 'the removed module is still loaded');
  assert.ok(e.idb._keys().includes(NT_A.url), 'the kept module\'s bytes were deleted');
  assert.equal(e.idb._keys().includes(NT_B.url), false, 'the removed module\'s bytes are still on the phone');
  assert.equal(e.idb._bytes(), SIZE(NT_A), 'the wrong module\'s space came back');
});

test('…AND THE READER\'S TRANSLATIONS SHEET REMOVES THE ONE IT NAMES', async () => {
  // (c). The sheet lists `Bible.versions()`, which is the REGISTERED abbr — "NT2" — and that has to reach a
  // record, or the removal frees nothing and says it did.
  const e = await phone({ modules: [NT_A, NT_B] });
  const v = versionSheet(e);
  await v.byLabel(new RegExp('Remove ' + NT_B.name))[0].props.onClick({ stopPropagation() {} });
  v.redraw();
  assert.deepEqual(v.toasts, ['Removed NT2']);
  assert.equal(e.getInstalled()[NT_B.url], undefined, 'the record is still there, so it is still "installed"');
  assert.equal(e.idb._keys().includes(NT_B.url), false,
    'the sheet reported a removal that freed nothing: the bytes are still on the phone and the module is ' +
    'back at the next launch');
  assert.ok(e.modules.NT && e.idb._keys().includes(NT_A.url), 'the other New Testament went with it');
});

test('A RECORD WRITTEN BY AN OLDER BUILD IS REPAIRED AT THE NEXT LAUNCH', async () => {
  // A phone that already has both New Testaments has two records saying "NT" written by a build before this
  // branch. Nothing can repair that until the modules are loaded and the collision is visible, which is
  // exactly what restoreInstalled does on every launch — so the repair lives there, and this runs the real
  // one (only `publishedPins` is stubbed: what the catalogue publishes is another file's subject).
  const e = engine();
  await e.cachePut(NT_A.url, rawOf(NT_A));
  await e.cachePut(NT_B.url, rawOf(NT_B));
  e.recordInstalled(NT_A);                    // the old call shape: the CATALOGUE abbr, for both
  e.recordInstalled(NT_B);
  assert.deepEqual(Object.values(e.getInstalled()).map(r => r.abbr), ['NT', 'NT'], 'fixture is not the old shape');

  await e.restoreInstalled();

  assert.deepEqual(Object.values(e.getInstalled()).map(r => r.abbr), ['NT', 'NT2'],
    'the launch did not repair the records, so the collision defects survive the update');
  const s = screen(e);
  assert.equal(s.removeBtn(NT_B.name).props.disabled, false, 'the repaired record still cannot be removed');
  await s.tapRemove(NT_B.name);
  assert.equal(e.idb._keys().includes(NT_B.url), false, 'the repaired record removed the wrong bytes, or none');
  assert.ok(e.modules.NT, 'the module the member kept was evicted');
});

test('TWO COMMENTARIES SHARING AN ABBR DO NOT REMOVE EACH OTHER', async () => {
  // The same shape one shelf along: `delete commentaries[abbr]`. addCommentary dedupes exactly as addSource
  // does, so recording what it returned closes this at the same root. Latent in the shipped catalogue
  // (its four commentaries have distinct abbrs) and not latent at all for a church publishing its own.
  const A = { ...CMT, id: 'cmt-a', url: 'modules/matthew-henry.cmt.mybible.zip' };
  const B = { ...CMT, id: 'cmt-b', name: 'Gill on the Whole Bible', url: 'modules/gill.cmt.mybible.zip' };
  FIXTURE.set('gill.cmt.mybible.zip', { kind: 'comment', bytes: new Uint8Array(9_000_000) });
  const e = await phone({ modules: [A, B] });
  assert.deepEqual(Object.keys(e.commentaries), ['MHC', 'MHC2'], 'addCommentary no longer dedupes — re-anchor');
  assert.deepEqual(Object.values(e.getInstalled()).map(r => r.abbr), ['MHC', 'MHC2']);

  await screen(e).tapRemove(B.name);
  assert.ok(e.commentaries.MHC, 'removing one commentary evicted the other from the notes panel');
  assert.equal(e.commentaries.MHC2, undefined, 'the removed commentary is still loaded');
  assert.equal(e.idb._bytes(), SIZE(A), 'the wrong commentary\'s bytes were freed');
});

// ── T16: a store that cannot be opened is not a proof ──────────────────────────────────────────────────────
test('A STORE THAT CANNOT BE OPENED IS NOT "PROVED GONE" — the removal is refused, and nothing is orphaned', async () => {
  // Every other cache helper in engine.js swallows its errors and answers null, which is right for reading a
  // module and fatal for the read-back after a delete: cacheGet() returns null when the bytes are GONE and
  // when indexedDB.open() FAILED, and the delete that just ran swallowed the identical failure. Believing it
  // deletes the record over 25 MB that stay on the phone — and once no record lists them, nothing in the app
  // can ever offer to remove them again (cacheKeys() is exported and has no caller; there is no sweeper).
  const e = await phone();
  const before = e.idb._bytes();
  e.idb._breakOpen(true);                      // private browsing, a corrupt database, a quota refusal
  const s = screen(e);

  await s.tapRemove(CMT.name);

  assert.deepEqual(s.toasts, [`Couldn't remove ${CMT.name}`],
    `the screen said ${JSON.stringify(s.toasts)} over a store it could not even open`);
  assert.equal(e.idb._bytes(), before, 'the harness did not really block the store — re-anchor this test');
  assert.ok(e.getInstalled()[CMT.url],
    'the record was dropped while the bytes stayed: those megabytes are now unlisted and unreachable');
  assert.ok(s.words().includes(CMT.name), 'the module vanished from the screen over a removal that failed');
  // …and when the store comes back, the same tap works.
  e.idb._breakOpen(false);
  const s2 = screen(e);
  await s2.tapRemove(CMT.name);
  assert.deepEqual(s2.toasts, [`Removed ${CMT.abbr}`]);
  assert.equal(e.idb._keys().includes(CMT.url), false);
});

// ── T17: the search screen, holding a copy of a removed dictionary's definitions ───────────────────────────
// The reader's notes panel was not the only screen keeping a copy: SearchScreen's `dictHits` is a useMemo
// over searchDict(), and its deps were [active] alone. A dictionary uninstalled from the Library went on
// showing its definitions — read out of bytes that had just been deleted — until the member typed again.
test('A DICTIONARY REMOVED WHILE ITS DEFINITIONS ARE ON THE SEARCH SCREEN LEAVES THE SCREEN', async () => {
  const e = await phone();
  const { React, draw } = miniReact();
  const g = {
    React,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, onClick }) => React.createElement('button', { title: name, onClick }),
    Chip: (p) => React.createElement('button', { onClick: p.onClick }, p.children),
    ScreenScroll: (p) => p.children,
    Spinner: () => React.createElement('i', {}),
    safeCssColor: (c) => c || 'var(--clay)',
    location: { search: '' },
    window: {
      Bible: {
        versions: () => e.order().map(a => ({ abbr: a, name: e.modules[a].name })),
        get activeVersion() { return e.active(); },
        search: () => [], books: () => [], searchDict: e.searchDict, lex: e.lex, subscribe: e.subscribe,
      },
      TrinityData: {}, addEventListener() {}, removeEventListener() {},
    },
    document: { addEventListener() {}, removeEventListener() {} },
  };
  const { SearchScreen } = loadScreen('app/screens-search.jsx', ['SearchScreen'], g);
  const props = { ctx: { toast() {}, go() {} }, onBack: null };
  let tree = draw(SearchScreen, props);
  const redraw = () => (tree = draw(SearchScreen, props));
  redraw();
  // type the query, then press Enter on the REDRAWN box — the handler closes over the value it was drawn
  // with, exactly as React does, so searching from a stale closure would search for the empty string.
  find(tree, n => n.type === 'input')[0].props.onChange({ target: { value: 'love' } });
  redraw();
  find(tree, n => n.type === 'input')[0].props.onKeyDown({ key: 'Enter' });
  redraw();
  assert.ok(texts(tree).join(' ').includes('DICTIONARY'),
    'the search screen has no dictionary section at all — re-anchor this test');
  assert.ok(texts(tree).join(' ').includes('ἀγάπη'),
    'the installed dictionary is not answering the search — re-anchor this test');

  await screen(e).tapRemove(DICT.name);        // the member removes it from the Library
  redraw();

  assert.equal(texts(tree).join(' ').includes('ἀγάπη'), false,
    'the search screen is still showing definitions from a dictionary that has been removed and whose ' +
    'bytes are deleted');
});

test('TWO DICTIONARIES SHARING AN ABBR DO NOT REMOVE EACH OTHER', async () => {
  // The third shelf, and the one with no dedupe of its own until this branch: `dicts` had no identity at
  // all, and giving every entry the CATALOGUE abbr would have meant one name for two dictionaries — so
  // removing either emptied both from lex() while freeing one module's bytes. addDict now dedupes exactly
  // as addSource and addCommentary do, and the record carries what it returned.
  const B = { ...DICT, id: 'lex-2', name: 'Abbott-Smith', url: 'modules/lex-abbott.json' };   // same abbr, BDB
  FIXTURE.set('lex-abbott.json', { kind: 'dict', bytes: new TextEncoder().encode(
    JSON.stringify({ entries: { H1: { lemma: 'אָב', short: 'father' } } })) });
  const e = await phone({ modules: [DICT, B] });
  assert.deepEqual(e.dicts.map(d => d.abbr), ['BDB', 'BDB2'], 'addDict did not dedupe the second dictionary');
  assert.deepEqual(Object.values(e.getInstalled()).map(r => r.abbr), ['BDB', 'BDB2'],
    'the records do not carry what addDict registered, so one of them names a dictionary that is not there');
  assert.equal(e.lex('H1').short, 'father', 'the second dictionary is not answering — re-anchor this test');

  await screen(e).tapRemove(B.name);

  assert.equal(e.lex('H1').missing, true, 'the removed dictionary is still answering lookups');
  assert.equal(e.lex('G26').short, 'love', 'removing one dictionary emptied the other one too');
  assert.deepEqual(e.dicts.map(d => d.abbr), ['BDB']);
  assert.ok(e.idb._keys().includes(DICT.url), 'the kept dictionary\'s bytes were deleted');
  assert.equal(e.idb._keys().includes(B.url), false, 'the removed dictionary\'s bytes are still on the phone');
});

test('A MODULE OPENED WITH ?module=<url> IS LISTED, AND CAN THEREFORE BE REMOVED', async () => {
  // autoLoad's query-parameter path cached the bytes through fetchAndCacheModule and wrote no record, so
  // the module never appeared on the Installed tier: downloaded once, kept for ever, and nothing in the app
  // could offer to remove it. It records what it caches now, like the file-import path beside it.
  const e = engine({ search: '?module=' + NT_A.url });
  await e.autoLoad();
  assert.ok(e.idb._keys().includes(NT_A.url), 'autoLoad did not cache the module — re-anchor this test');
  assert.ok(e.getInstalled()[NT_A.url],
    'the module is on the phone and not in the installed map: its bytes are unreachable for ever');

  // No catalogue entry came with it, so the engine names it from the file — which is what the reader shows
  // for a module opened this way, and is enough to list it and remove it.
  const FILE = NT_A.url.split('/').pop();
  assert.equal(e.getInstalled()[NT_A.url].name, FILE);
  const s = screen(e);
  assert.ok(s.words().includes(FILE), 'it is not listed on the Installed tier');
  // it is the only Bible, so it is the active one and rightly refused; another one makes it removable
  await e.installModule(BIBLE);
  e.setActive('BSB');
  const s2 = screen(e);
  await s2.tapRemove(FILE);
  assert.deepEqual(s2.toasts, ['Removed NT']);
  assert.equal(e.idb._keys().includes(NT_A.url), false, 'the bytes stayed');
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
  e.recordInstalled({ url: 'modules/a-devotional.zip', id: 'dv', abbr: 'DVT', name: 'A devotional', kind: 'devotional' }, 'DVT');
  await e.cachePut('modules/a-devotional.zip', new Uint8Array(1000));
  assert.equal(await e.removeModule('modules/a-devotional.zip'), true);
  assert.equal(e.idb._keys().includes('modules/a-devotional.zip'), false, 'the bytes stayed');
});
