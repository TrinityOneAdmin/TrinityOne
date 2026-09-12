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
// AND THE THIRD, FOUND BY THE SECOND AUDIT: a name is only unique INSIDE ITS CATEGORY, and the code that
// mapped a name back to a module did not know it. addSource, addCommentary and addDict dedupe within their
// own store — deliberately, because "KJV" on a commentary is how a member reads "notes on the KJV" — so a
// Bible and a commentary can both be KJV. Three places treated the name as unique across the phone:
// removeModule's lookup scanned the whole installed map (measured: removing the KJV BIBLE from the reader
// deleted a 27.6 MB imported COMMENTARY instead, record and bytes, no undo), and both the Library's
// `isActive` and the engine's active-Bible refusal compared any record's name to the active BIBLE's. Every
// one of them is scoped by category now; an ambiguous name with no category is refused rather than guessed
// at; and "is this row the Bible being read?" is answered by the url the active module was really loaded
// from (`urlOf`), so a record whose module never loaded can no longer borrow its identity. T19-T23.
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
//   · AN IMPORTED DICTIONARY USED NOT TO BE INSTALLED AT ALL, and now is. The file-import path and
//     `?module=<url>` pass no metadata, addDict registered such a dictionary under "", and both paths
//     record a module only `if(r && r.abbr)` — so an imported lexicon was never cached, never listed,
//     never restored and never removable. addDict names it (Dict, Dict2…) exactly as addCommentary has
//     always named a commentary, which makes it an ordinary installed module. T25 and T28 cover it.
//   · A CORRECTION TO WHAT THE PREVIOUS COMMIT CLAIMED HERE, since it is the permanent record: it said the
//     deferred-parse window was unreachable because "no screen removes a dictionary by abbr — the Library
//     passes the url". That was false. The Library does pass the url, but removeModule turns the url into
//     the RECORD'S NAME to find the copy in memory, so the shipped Remove button reached removeDict and a
//     removal really could throw away another dictionary's queued parse. It is fixed rather than argued
//     away: a pending parse carries its url and is matched by it (T29).
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
import { fnBody, stmt, stripComments } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';
import { createRequire } from 'node:module';
import * as fflate from 'fflate';

const require = createRequire(import.meta.url);

const ROOT = new URL('../', import.meta.url).pathname;
const ENGINE = readFileSync(ROOT + 'engine.js', 'utf8');

// ── the stores the engine writes to ───────────────────────────────────────────────────────────────────────
// A plain Map behind the exact IndexedDB surface engine.js uses (open/createObjectStore/transaction/
// objectStore + get/put/delete/getAllKeys, each an async request object). `breakDeleteOf` makes one key
// undeletable, which is how the honest-failure path is exercised — that is a broken store, not a broken
// engine, and the engine must notice and say so.
function fakeIndexedDB({ breakDeleteOf = null, unavailable = false, missingStore = false, abortReads = false } = {}) {
  const stores = new Map();
  let upgraded = false;
  const req = () => ({ onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined, error: null });
  const settle = (r, value) => { setTimeout(() => { r.result = value; if (r.onsuccess) r.onsuccess(); }, 0); return r; };
  const db = {
    createObjectStore(name) { if (!stores.has(name)) stores.set(name, new Map()); return {}; },
    transaction(name) {
      // A store that is not there throws SYNCHRONOUSLY from transaction(), exactly as IndexedDB does.
      if (missingStore) { const e = new Error('no object store named ' + name); e.name = 'NotFoundError'; throw e; }
      const m = stores.get(name) || stores.set(name, new Map()).get(name);
      // `abortReads` models a transaction that dies without the REQUEST ever firing: a version change, the
      // database being deleted, the quota withdrawn mid-read. Only tx.onabort is called — which is why a
      // reader that listens for onsuccess/onerror alone simply never settles.
      const tx = { onabort: null, onerror: null, error: null };
      const store = {
        transaction: tx,
        get: (k) => { const r = req(); if (abortReads) setTimeout(() => { if (tx.onabort) tx.onabort(); }, 0); else settle(r, m.has(k) ? m.get(k) : undefined); return r; },
        count: (k) => settle(req(), m.has(k) ? 1 : 0),
        put: (v, k) => { m.set(k, v); return settle(req(), k); },
        delete: (k) => { if (k !== breakDeleteOf) m.delete(k); return settle(req(), undefined); },
        getAllKeys: () => settle(req(), [...m.keys()]),
      };
      tx.objectStore = () => store;
      return tx;
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
  api._loseStore = (v) => { missingStore = !!v; };
  api._abortReads = (v) => { abortReads = !!v; };
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
    stmt(ENGINE, 'const urlOf = {};'),
    stmt(ENGINE, 'const urlKey = ('),
    fnBody(ENGINE, 'function noteLoadedFrom(url, abbr, cat){'),
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
    fnBody(ENGINE, 'function removeDict(abbr, url){'),
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
       if(f.kind === "corrupt") throw new Error("unrecognized file — " + srcName);
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
    fnBody(ENGINE, 'function recordInstalled(item){'),
    fnBody(ENGINE, 'function noteRegisteredAbbr(url, abbr){'),
    fnBody(ENGINE, 'function isInstalled(url){'),
    fnBody(ENGINE, 'async function removeModule(id, category){'),
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
  const loc = { search };   // mutable, so a test can drive a second launch with a different query string
  const api = new Function('indexedDB', 'localStorage', 'console', 'FIXTURE', 'window', 'requestIdleCallback', 'location',
    parts.join('\n') +
    '\nreturn { modules, dicts, _pendingDicts, commentaries, installing, addDict, _ensureDicts, loadDictJSON,' +
    ' addCommentary, addSource, cacheGet, cachePut, cacheKeys, cacheDelete, getInstalled, recordInstalled,' +
    ' isInstalled, removeModule, getCommentary, lex, searchDict, cacheHas, noteRegisteredAbbr, installModule, setInstalled,' +
    ' noteLoadedFrom, activeUrl: () => (active && urlOf[urlKey("bibles", active)]) || null,' +
    ' restoreInstalled, autoLoad, subscribe: _sub.subscribe,' +
    ' order: () => order, active: () => active, setActive: (a) => { active = a; } };'
  )(idb, fakeLocalStorage(), console, fixture, win, undefined, loc);
  // The vacuity counter goes through the engine's OWN notify/subscribe, so it also proves the harness is
  // running engine.js's pub/sub rather than a stand-in.
  let notified = 0;
  api.subscribe(() => { notified++; });
  // `win` is returned so a test can read `window.Bible._error`, which is where autoLoad records a failed
  // default install. The harness cannot satisfy KNOWN_HASHES for the real default module — the pin is a
  // sha256 of bytes this repo does not ship to tests — so "the branch was REACHED" is the honest thing to
  // assert there, and that error is the proof it ran.
  return { ...api, idb, win, setSearch: (q) => { loc.search = q; }, notified: () => notified };
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

// ctx.removeTranslation, LIFTED OUT OF app/app.jsx AND RUN rather than retyped here. It is the one hop
// between the Translations sheet and the engine, and what it passes is now load-bearing: the sheet means a
// BIBLE, and without that word removeModule resolves the name against whichever record was written first
// and can delete a commentary of the same name. A copy of the line in this file would keep passing after
// somebody deleted the word from the app (CLAUDE.md rule 3 is the same lesson one level up).
const APP = stripComments(readFileSync(ROOT + 'app/app.jsx', 'utf8'));
function liftRemoveTranslation(e) {
  const m = /removeTranslation:\s*(\([^)]*\)\s*=>\s*Bible\.removeModule\([^)]*\))/.exec(APP);
  assert.ok(m, 'app.jsx no longer wires ctx.removeTranslation to Bible.removeModule — re-anchor this test');
  return new Function('Bible', 'return ' + m[1])({ removeModule: e.removeModule });
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
        get activeUrl() { return e.activeUrl(); },
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
  const ctx = { toast: (t) => toasts.push(t), setVersion() {}, removeTranslation: liftRemoveTranslation(e) };
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

// ── T20-T22: A NAME IS ONLY UNIQUE INSIDE ITS CATEGORY ────────────────────────────────────────────────────
// Found by audit 2026-09-12, and it pre-dates this branch. A member imports a MySword commentary whose own
// Details table calls it KJV — ordinary, since buildCommentaryFromDb takes the abbr from the module and
// Import is offered in the Share sheet — and now has a Bible and a commentary both called KJV. That is
// CORRECT: "KJV" on a commentary is how a member reads "notes on the KJV", and the three stores dedupe
// separately on purpose. What was wrong was every piece of code that mapped a name back to a module as if
// it were unique across the phone.
const CMT_KJV = { id: 'notes-on-kjv', abbr: 'KJV', name: 'Notes on the KJV', kind: 'comment', format: 'MySword',
                  category: 'commentaries', url: 'modules/notes-on-kjv.cmt.mybible.zip' };
FIXTURE.set('notes-on-kjv.cmt.mybible.zip', { kind: 'comment', bytes: new Uint8Array(27_600_000), declares: 'KJV' });

test('REMOVING THE KJV BIBLE DOES NOT DELETE THE KJV COMMENTARY', async () => {
  // The measured defect: the app toasted "Removed KJV", the Bible stayed on the phone and in the reader,
  // and 27.6 MB of the member's commentary was deleted — record, bytes and all, with no undo.
  const e = await phone({ modules: [BIBLE, SECOND, CMT_KJV] });   // BSB is active; SECOND is the KJV Bible
  assert.equal(e.getInstalled()[SECOND.url].abbr, 'KJV');
  assert.equal(e.getInstalled()[CMT_KJV.url].abbr, 'KJV', 'the commentary did not keep its own name — re-anchor');

  const v = versionSheet(e);
  await v.byLabel(new RegExp('Remove ' + SECOND.name))[0].props.onClick({ stopPropagation() {} });

  assert.equal(e.idb._keys().includes(CMT_KJV.url), true, 'the member\'s commentary was deleted instead');
  assert.ok(e.commentaries.KJV, 'the commentary was unloaded instead');
  assert.ok(e.getInstalled()[CMT_KJV.url], 'the commentary\'s record was deleted instead');
  assert.equal(e.idb._keys().includes(SECOND.url), false, 'the Bible the member asked to remove is still here');
  assert.equal(e.modules.KJV, undefined, 'the Bible is still loaded, so the reader still offers it');
  assert.deepEqual(v.toasts, ['Removed KJV']);
});

test('…AND A NAME WITH NO CATEGORY IS REFUSED, NOT GUESSED AT', async () => {
  // Any future caller that hands removeModule a bare name gets a refusal rather than whichever record was
  // written first. The Library passes the url and the Translations sheet passes "bibles", so nothing in the
  // app relies on the guess that used to happen here.
  const e = await phone({ modules: [BIBLE, SECOND, CMT_KJV] });
  assert.equal(await e.removeModule('KJV'), false, 'an ambiguous name still deletes something');
  assert.ok(e.idb._keys().includes(SECOND.url) && e.idb._keys().includes(CMT_KJV.url), 'something was deleted anyway');
  assert.equal(await e.removeModule('KJV', 'commentaries'), true, 'naming the category does not work');
  assert.equal(e.idb._keys().includes(CMT_KJV.url), false, 'the commentary was not the one removed');
  assert.ok(e.idb._keys().includes(SECOND.url), 'the Bible went too');
});

test('A COMMENTARY NAMED AFTER THE BIBLE BEING READ IS STILL REMOVABLE', async () => {
  // B1 case (a), one shelf along: `r.abbr === active` disabled Remove on ANY row whose name matched the
  // active Bible's. 27.6 MB behind "Switch to another Bible before removing this one" — and if that Bible
  // is the member's only one, as it is for a congregation with one minority-language New Testament, there
  // is nothing to switch to and the row is dead for ever.
  const e = await phone({ modules: [SECOND, CMT_KJV] });          // the KJV Bible is the ONLY Bible, and active
  assert.equal(e.active(), 'KJV', 'fixture: the KJV Bible should be the active one');
  const s = screen(e);
  assert.equal(s.removeBtn(SECOND.name).props.disabled, true, 'the only Bible can be removed');
  assert.equal(s.removeBtn(CMT_KJV.name).props.disabled, false,
    'the commentary cannot be removed because it shares the active Bible\'s name');

  await s.tapRemove(CMT_KJV.name);

  assert.deepEqual(s.toasts, ['Removed KJV']);
  assert.equal(e.idb._keys().includes(CMT_KJV.url), false, 'the 27.6 MB did not come back');
  assert.ok(e.modules.KJV && e.idb._keys().includes(SECOND.url), 'the Bible being read went with it');

  // …and the same scope on the FALLBACK branch of that guard — the one that compares names, used when the
  // active Bible was loaded from no url to compare. Nothing in the app reaches that today (every load path
  // notes its url), which is exactly why it is worth pinning: it is the branch that would rot unnoticed.
  const e2 = engine();
  e2.addSource({ abbr: 'KJV', name: SECOND.name, books: [], maxChap: {} });   // loaded, from nowhere
  e2.addCommentary({ abbr: 'KJV', name: CMT_KJV.name, getComment: () => [] });
  await e2.cachePut(CMT_KJV.url, rawOf(CMT_KJV));
  e2.recordInstalled(CMT_KJV);
  assert.equal(e2.activeUrl(), null, 'fixture: the active Bible must have been loaded from no url');
  assert.equal(await e2.removeModule(CMT_KJV.url), true,
    'with no url to compare the guard falls back to the name, and refuses a commentary that merely shares it');
  assert.ok(e2.modules.KJV, 'it removed the Bible instead');
});

// ── T23: a record whose module never loaded ───────────────────────────────────────────────────────────────
test('A RECORD WHOSE MODULE COULD NOT LOAD IS STILL REMOVABLE', async () => {
  // restoreInstalled cannot repair a record it could not load — `if(!bytes) continue;` and the enclosing
  // catch both skip the repair — so such a record keeps whatever name was written at install time. If that
  // name is also the active Bible's (two "NT" records, one of them stale), the name comparison made the
  // Library disable Remove on it and removeModule refuse it: its megabytes, if any, were unreclaimable.
  // The active check asks the url the ACTIVE module was really loaded from, so a record that loaded nothing
  // can no longer borrow its identity.
  const e = engine();
  await e.cachePut(NT_A.url, rawOf(NT_A));
  await e.cachePut(NT_B.url, rawOf(NT_B));
  e.recordInstalled(NT_A);            // both written by an older build, both saying "NT"
  e.recordInstalled(NT_B);
  FIXTURE.set('bhi-nt.zip', { kind: 'corrupt', bytes: rawOf(NT_B), declares: 'NT' });   // this one will not parse

  await e.restoreInstalled();

  assert.equal(e.getInstalled()[NT_A.url].abbr, 'NT', 'the loadable one was not repaired — re-anchor this test');
  assert.equal(e.getInstalled()[NT_B.url].abbr, 'NT', 'the unloadable one was repaired, which cannot happen');
  assert.equal(e.active(), 'NT');
  const s = screen(e);
  assert.equal(s.removeBtn(NT_B.name).props.disabled, false,
    'a record that loaded nothing is treated as the Bible being read, so its bytes can never be reclaimed');

  await s.tapRemove(NT_B.name);

  assert.deepEqual(s.toasts, ['Removed NT']);
  assert.equal(e.idb._keys().includes(NT_B.url), false, 'the unloadable module\'s bytes are still on the phone');
  assert.ok(e.modules.NT && e.idb._keys().includes(NT_A.url), 'the Bible being read was removed instead');
  FIXTURE.set('bhi-nt.zip', { kind: NT_B.kind, bytes: rawOf(NT_B), declares: NT_B.abbr });
});

test('?module= OVER A MODULE THAT IS ALREADY INSTALLED DOES NOTHING', async () => {
  // Found by audit 2026-09-12. Recording what this path caches was right; doing it over an existing record
  // was not. fetchAndCacheModule is called with NO catalogue metadata, so the module is named from its own
  // file; addSource sees a second name for one abbr and registers a DUPLICATE, and the new record then
  // named the duplicate — leaving the originally-loaded copy in the reader with no record at all, so Remove
  // would strip its bytes while it went on being readable.
  const e = await phone({ modules: [BIBLE] });
  const before = JSON.stringify(e.getInstalled());
  const loadedBefore = e.order().slice();

  e.setSearch('?module=' + BIBLE.url);
  await e.autoLoad();

  assert.equal(JSON.stringify(e.getInstalled()), before, 'the good record was overwritten');
  assert.deepEqual(e.order(), loadedBefore, 'the module was loaded a second time under another name');
  assert.equal(e.getInstalled()[BIBLE.url].name, BIBLE.name, 'the record lost the catalogue name');
});

test('A DICTIONARY OPENED WITH ?module= IS RECORDED TOO, and can be removed', async () => {
  // The other half of the same finding: addDict returned "" when nothing named the dictionary, so the
  // `if(r && r.abbr)` guard skipped it and it was never recorded — cached bytes nothing could reclaim.
  // Every dictionary gets a name now, the same way a commentary always has.
  const e = engine({ search: '?module=' + DICT.url });
  await e.autoLoad();
  const rec = e.getInstalled()[DICT.url];
  assert.ok(rec, 'the dictionary was cached and not recorded — its bytes are unreachable');
  assert.equal(rec.category, 'dictionaries');
  assert.equal(rec.abbr, 'Dict', 'it was not given a name, so removeDict cannot find it');
  assert.equal(e.lex('G26').short, 'love', 'it did not actually load — re-anchor this test');

  const s = screen(e);
  await s.tapRemove(rec.name);
  assert.deepEqual(s.toasts, ['Removed Dict']);
  assert.equal(e.lex('G26').missing, true, 'the dictionary is still answering lookups');
  assert.equal(e.idb._keys().includes(DICT.url), false, 'the bytes stayed');
});

test('A STORE WHOSE OBJECT STORE IS GONE IS A PROVABLE ABSENCE, not an unknown', async () => {
  // cacheHas refuses on anything it cannot answer, which is right — but a MISSING object store is an
  // answer: bytes cannot be in a store that does not exist. Refusing there would leave a phone that lost
  // its store unable to clear a single record, for ever.
  const e = await phone();
  e.idb._loseStore(true);
  const s = screen(e);
  await s.tapRemove(CMT.name);
  assert.deepEqual(s.toasts, [`Removed ${CMT.abbr}`],
    `the screen said ${JSON.stringify(s.toasts)} about bytes that provably are not there`);
  assert.equal(e.getInstalled()[CMT.url], undefined, 'the record stayed, so the row is stuck for ever');
});

test('AN ABORTED READ IS AN HONEST FAILURE, NOT A BUTTON THAT NEVER COMES BACK', async () => {
  // An IndexedDB transaction can die without the REQUEST ever firing — a version change, the database being
  // deleted, the quota withdrawn mid-read. Only tx.onabort is called, so a reader that waits on
  // onsuccess/onerror alone never settles: `await window.Bible.removeModule(...)` hangs and the member's
  // Remove button spins with no toast, for ever. A dead control is the failure this whole programme exists
  // to stop, so the read rejects and the screen says so.
  const e = await phone();
  e.idb._abortReads(true);
  const s = screen(e);

  const settled = await Promise.race([
    s.tapRemove(CMT.name).then(() => 'settled'),
    new Promise(r => setTimeout(() => r('HUNG'), 3000)),
  ]);

  assert.equal(settled, 'settled', 'the Remove button never came back — no toast, no failure, nothing');
  assert.deepEqual(s.toasts, [`Couldn't remove ${CMT.name}`]);
  assert.ok(e.getInstalled()[CMT.url], 'the record was dropped over a read that never completed');
});

// ── T28: the REAL loadModuleBytes, on a real SQLite dictionary ────────────────────────────────────────────
// Named by the audit as the one thing the harness above could not reach: the install path is driven through
// the engine's own installModule, but loadModuleBytes itself is stood in for, so the two lines this branch
// changed INSIDE it — the SQLite dict branch and the zip-SQLite dict branch — were exercised by nothing, and
// sabotaging either scored a clean 19/0. This closes that: a MySword-shaped dictionary is built with the
// same sql.js the app ships, handed to the REAL loadModuleBytes raw and then zipped, and what comes back is
// what the record is written from.
const loadModuleBytesChain = (() => {
  const parts = [
    stmt(ENGINE, 'const SQLITE_MAGIC = '),
    fnBody(ENGINE, 'function isSqlite(u8){'),
    fnBody(ENGINE, 'function isZip(u8){'),
    fnBody(ENGINE, 'async function openDb(dbBytes){'),
    fnBody(ENGINE, 'function stripTags(s){'),
    fnBody(ENGINE, 'function detailsOf(db, fb){'),
    fnBody(ENGINE, 'function buildCommentaryFromDb(db, fb){'),
    fnBody(ENGINE, 'function buildDictFromDb(db){'),
    fnBody(ENGINE, 'function applyMeta(src, meta){'),
    fnBody(ENGINE, 'function addDict(entries, abbr){'),
    fnBody(ENGINE, 'function hasDict(abbr){'),
    fnBody(ENGINE, 'function removeDict(abbr, url){'),
    stmt(ENGINE, 'const dicts = [];'),
    stmt(ENGINE, 'const _pendingDicts = [];'),
    fnBody(ENGINE, 'async function loadModuleBytes(u8, srcName, meta){'),
  ];
  return () => {
    const api = new Function('initSqlJs', 'SQLJS_BASE', 'fflate', 'notify', 'commentaries', 'addCommentary',
      'addSource', 'parseVerse', 'buildBibleFromDb', 'buildFromUSFM', 'console',
      parts.join('\n') +
      '\nreturn { loadModuleBytes, dicts, _pendingDicts, removeDict, hasDict };')(
      require(ROOT + 'vendor/sqljs/sql-wasm.js'), ROOT + 'vendor/sqljs/', fflate, () => {},
      {}, () => 'CMT', () => 'BIB', (s) => s, () => null, () => null, console);
    return api;
  };
})();

// A MySword dictionary: one table matching /dictionary/i, a topic column and a definition column — which is
// all buildDictFromDb looks for.
async function sqliteDictionary() {
  const SQL = await require(ROOT + 'vendor/sqljs/sql-wasm.js')({ locateFile: (f) => ROOT + 'vendor/sqljs/' + f });
  const db = new SQL.Database();
  db.run('CREATE TABLE dictionary (topic TEXT, definition TEXT);');
  db.run("INSERT INTO dictionary VALUES ('H1', '<b>father</b>, ancestor');");
  db.run("INSERT INTO dictionary VALUES ('H2', 'to perish');");
  const bytes = new Uint8Array(db.export());
  db.close();
  return bytes;
}

test('THE REAL loadModuleBytes NAMES A SQLITE DICTIONARY, raw and inside a zip', async () => {
  const raw = await sqliteDictionary();

  // (1) the bare .mybible branch
  const a = loadModuleBytesChain();
  const r1 = await a.loadModuleBytes(raw, 'bdb.dct.mybible', { abbr: 'BDB', name: 'Brown-Driver-Briggs', category: 'dictionaries' });
  assert.equal(r1.kind, 'dict');
  assert.equal(r1.abbr, 'BDB',
    'loadModuleBytes does not report the name the dictionary was registered under, so recordInstalled ' +
    'writes the catalogue name and removeDict can be pointed at the wrong dictionary');
  assert.equal(a.dicts.length, 1);
  assert.equal(a.dicts[0].entries.H1.short.slice(0, 6), 'father', 'the module did not really parse');
  // a second one under the same catalogue name is deduped, and the caller is told the real name
  const r2 = await a.loadModuleBytes(raw, 'bdb.dct.mybible', { abbr: 'BDB', name: 'Another lexicon', category: 'dictionaries' });
  assert.equal(r2.abbr, 'BDB2');
  a.removeDict('BDB2');
  assert.deepEqual(a.dicts.map(d => d.abbr), ['BDB'], 'removeDict took the wrong one');

  // (2) the zip branch, which is a separate line in the same function
  const b = loadModuleBytesChain();
  const zipped = fflate.zipSync({ 'bdb.dct.mybible': raw });
  const r3 = await b.loadModuleBytes(zipped, 'bdb.zip', { abbr: 'BDB', name: 'Brown-Driver-Briggs', category: 'dictionaries' });
  assert.equal(r3.kind, 'dict');
  assert.equal(r3.abbr, 'BDB', 'the zip branch does not report the registered name either');
  assert.equal(b.dicts.length, 1);

  // (3) and with NO metadata — a file import, or ?module= — it still gets a name, which is what makes it
  // recordable and therefore removable at all.
  const c = loadModuleBytesChain();
  const r4 = await c.loadModuleBytes(raw, 'unknown.dct.mybible');
  assert.equal(r4.abbr, 'Dict', 'an unnamed dictionary is still unnamed, so it can never be removed');
});

test('REMOVING ONE DEFERRED DICTIONARY DOES NOT THROW AWAY THE OTHER ONE\'S PARSE', async () => {
  // Written after the audit corrected a claim in the previous commit message. The Library's Remove passes a
  // url, but removeModule turns it into the record's NAME to find the copy in memory — so the button really
  // does reach removeDict, and two records written by an older build under one name ("BDB" and "BDB") had
  // one removal splice BOTH queued parses. The member kept a dictionary that then answered nothing until
  // the next launch. The pending entries carry their url, and that is not ambiguous.
  const B = { ...DICT, id: 'lex-2', name: 'Abbott-Smith', url: 'modules/lex-abbott.json' };
  FIXTURE.set('lex-abbott.json', { kind: 'dict', bytes: new TextEncoder().encode(
    JSON.stringify({ entries: { H1: { lemma: 'אָב', short: 'father' } } })) });
  const e = engine();
  await e.cachePut(DICT.url, rawOf(DICT));
  await e.cachePut(B.url, rawOf(B));
  e.recordInstalled(DICT);          // both written by an older build, both saying "BDB"
  e.recordInstalled(B);
  await e.restoreInstalled();       // a JSON lexicon is queued, not parsed, at boot
  assert.equal(e.dicts.length, 0, 'the lexicons were parsed at boot — re-anchor this test');
  assert.equal(e._pendingDicts.length, 2, 'both parses should be queued');

  await screen(e).tapRemove(B.name);
  e._ensureDicts();                 // the idle callback fires

  assert.equal(e.lex('G26').short, 'love',
    'the dictionary the member KEPT never parsed: removing the other one threw its queued parse away too');
  assert.equal(e.lex('H1').missing, true, 'the removed dictionary parsed anyway');
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
  await e.cachePut('modules/a-devotional.zip', new Uint8Array(1000));
  assert.equal(await e.removeModule('modules/a-devotional.zip'), true);
  assert.equal(e.idb._keys().includes('modules/a-devotional.zip'), false, 'the bytes stayed');
});

// ── THREE DEFECTS FOUND BY AUDIT, 2026-09-12 — two of them introduced by the fixes above ──────────────────
//
// The first is the one that matters: a member opening the app to an EMPTY READER, with no error and nothing
// on screen to act on. This codebase's most expensive failure class is the app that looks completely normal
// and is completely blank, and closing a record hole on the boot path opened one.

// Two catalogue entries that share an abbr AND a name at different urls. `addSource`'s dedupe is
// `while(modules[abbr] && modules[abbr].name !== src.name)`, so an identical NAME skips the rename and both
// are registered under one abbr. ebible-catalog.json really ships two such groups — "NT | Nuevo Testamento
// Guaraní Pe" (2 urls) and "NT | Mushog Testamento" (3) — five minority-language New Testaments, which is
// this product's stated first audience rather than a corner case.
const TWIN_A = { id: 'gui-nt', abbr: 'NT', name: 'Nuevo Testamento Guaraní Pe', kind: 'bible', format: 'USFM', category: 'bibles', url: 'modules/guiNT_usfm.zip' };
const TWIN_B = { id: 'gnw-nt', abbr: 'NT', name: 'Nuevo Testamento Guaraní Pe', kind: 'bible', format: 'USFM', category: 'bibles', url: 'modules/gnwNT_usfm.zip' };
// Real USFM bytes, borrowed from the Bible fixture — `rawOf` reads the fixture map, so it cannot bootstrap
// its own entry. What matters here is only that both declare the same abbr AND carry the same name.
// The engine's own first-run default. The harness's fixture() asserts on an unknown url, so without this
// entry the self-heal below cannot complete and the test would be measuring the harness, not the fix.
FIXTURE.set('engbsb.zip', { kind: 'bible', bytes: rawOf(BIBLE), declares: 'BSB' });
FIXTURE.set('guiNT_usfm.zip', { kind: 'bible', bytes: rawOf(BIBLE), declares: 'NT' });
FIXTURE.set('gnwNT_usfm.zip', { kind: 'bible', bytes: rawOf(BIBLE), declares: 'NT' });
const TWIN_C = { id: 'qvh-nt', abbr: 'NT', name: 'Nuevo Testamento Guaraní Pe', kind: 'bible', format: 'USFM', category: 'bibles', url: 'modules/qvhNT_usfm.zip' };
FIXTURE.set('qvhNT_usfm.zip', { kind: 'bible', bytes: rawOf(BIBLE), declares: 'NT' });

test('A RECORD WITHOUT ITS BYTES MUST NOT LEAVE THE MEMBER WITH AN EMPTY READER', () => {
  // ⚠ THE FIRST VERSION OF THIS TEST WAS VACUOUS, and it is worth saying how, because the shape is easy to
  // repeat: it called `installModule(BIBLE)` and then `cacheDelete(BIBLE.url)`. Deleting the cached BYTES
  // does not unload the module — `modules` and `order` still held it — so `order.length > 0` was already
  // true before `autoLoad()` ran, and the assertion could not fail. Both sabotage rows for this fix left it
  // green; only the dictionary test below ever bit. A test that cannot fail is not a guard, and CLAUDE.md
  // rule 1 is exactly about this.
  //
  // The state has to be a real COLD BOOT: a record on disk, no bytes, nothing loaded. `setInstalled` writes
  // the record without loading anything, which is precisely the state a phone reaches when `cachePut`
  // swallows a quota failure — the record lands, the bytes never do.
  return (async () => {
    const e = engine();
    e.setInstalled({ [BIBLE.url]: { url: BIBLE.url, id: BIBLE.id, abbr: BIBLE.abbr, name: BIBLE.name, kind: 'bible', category: 'bibles' } });
    assert.ok(e.getInstalled()[BIBLE.url], 're-anchor: the record was not written, so this tests nothing');
    assert.equal(await e.cacheGet(BIBLE.url), null, 're-anchor: bytes exist, so restoreInstalled will load it');
    assert.equal(e.order().length, 0, 're-anchor: something is already loaded, so the assertion below is free');

    e.setSearch('?module=' + BIBLE.url);
    await e.autoLoad();

    // EITHER outcome proves the self-heal ran: a Bible loaded (the shipped app, where the default really
    // installs), or the integrity refusal that names it (this harness, which cannot satisfy KNOWN_HASHES for
    // the default module). Asserting only the second would break the day the product gets BETTER.
    const healed = e.order().length > 0 || /engbsb/.test(String(e.win.Bible._error || ''));
    assert.ok(healed,
      'THE MEMBER OPENED THE APP AND HAS NO BIBLE AT ALL. A record survived without its bytes, so the ' +
      '`?module=` branch skipped (already recorded) and — before this fix — the default-Bible branch skipped ' +
      'too (a url was asked for). Neither fired. No error, nothing on screen: the silent-blank-app class. ' +
      'order=' + JSON.stringify(e.order()) + ' _error=' + JSON.stringify(e.win.Bible._error || null));
  })();
});

test('…and a ?module= DICTIONARY on a fresh phone still tries to give the member a Bible', async () => {
  // The same line's older face: a dictionary never enters `order`, so a member following a link to a lexicon
  // used to land on an empty reader holding a dictionary they cannot open anything with.
  //
  // ⚠ WHAT THIS ASSERTS AND WHY. The default module is sha256-pinned in KNOWN_HASHES and this harness cannot
  // produce bytes matching that pin, so the install cannot COMPLETE here — and it should not: the integrity
  // check refusing our substitute is the shipped gate doing its job. What is under test is the GUARD, and
  // the recorded integrity failure is proof the branch was reached at all. Before the fix the branch was
  // skipped outright and `_error` stayed undefined.
  const e = engine();
  e.setSearch('?module=' + DICT.url);
  await e.autoLoad();
  assert.ok(e.dicts.length > 0, 're-anchor: the dictionary itself did not install, so nothing below follows');
  assert.equal(e.order().length, 0, 're-anchor: a dictionary entered `order`, which holds Bibles only');
  assert.ok(e.order().length > 0 || /engbsb/.test(String(e.win.Bible._error || '')),
    'THE DEFAULT BIBLE WAS NEVER EVEN ATTEMPTED. A member followed a link to a dictionary and the reader was ' +
    'left with nothing to read, because the self-heal was skipped whenever a `?module=` was present.');
});

test('the reader can remove one of two translations that share BOTH name and abbr', async () => {
  // The Translations sheet has only a name: `versions()` carries abbr/name/kind and no url. Refusing
  // outright (safer than the guess that preceded it) made Remove permanently dead for five shipped
  // translations — "Couldn't remove NT", for ever, megabytes unreclaimable.
  // A THIRD Bible is active, because the active one is refused on purpose and the reader never offers Remove
  // for it — so leaving one of the twins active would measure that refusal instead of the name collision.
  const e = engine();
  await e.installModule(BIBLE);
  e.setActive(BIBLE.abbr);
  await e.installModule(TWIN_A);
  await e.installModule(TWIN_B);
  const loaded = e.order().filter(a => a !== BIBLE.abbr);
  assert.equal(loaded.length, 1,
    're-anchor: an identical NAME no longer collapses these into one registered module, so this test is ' +
    'not measuring the case it was written for. Registered: ' + JSON.stringify(loaded));

  const removeTranslation = liftRemoveTranslation(e);
  assert.equal(await removeTranslation('NT'), true,
    'THE READER CAN NEVER REMOVE THIS TRANSLATION. Two records share the name and the category, so the ' +
    'name does not resolve — and the reader has nothing else to give. Five shipped minority-language New ' +
    'Testaments are in exactly this state.');
  // …and it removed exactly ONE of them — the one the member was looking at, not whichever record happened
  // to be written first.
  const left = e.getInstalled();
  const still = [TWIN_A.url, TWIN_B.url].filter(u => left[u]);
  assert.equal(still.length, 1, 'it removed ' + (2 - still.length) + ' records, not one: ' + JSON.stringify(still));
  assert.ok(!left[TWIN_B.url], 'it removed the record the member was NOT reading');
  assert.ok(await e.cacheGet(TWIN_B.url) === null, 'the bytes of the removed translation are still on the phone');
  assert.ok(await e.cacheGet(TWIN_A.url) !== null, 'it deleted the OTHER translation\'s bytes');

  // ⚠ AND THE HONEST LIMIT, asserted rather than left to be discovered. Both records registered under ONE
  // abbr (addSource's dedupe skips the rename when the NAME matches too), so the loaded copy was the one we
  // just removed. Nothing is loaded under 'NT' until the next launch, when restoreInstalled brings the
  // surviving record back. The member's remaining translation is not lost — it is not readable this session.
  // Fixing that means making addSource rename on url as well as name, which renames modules already on
  // phones; it is a bigger decision than this file.
  assert.ok(!e.modules['NT'],
    're-anchor: a copy survived in memory, so the limit described above no longer holds and this comment ' +
    'is stale — check whether addSource now renames on url');
});

test('the active Bible is refused even when its record was never written', async () => {
  // `setInstalled` swallows a localStorage failure, so a Bible can be loaded and active with no record. The
  // refusal must not depend on THIS call having resolved a url — otherwise it is skipped, `loadedHere` is
  // true, and `delete modules[active]` runs with `active` still naming it: a blank reader over a dangling
  // pointer. Defence in depth — no shipped screen offers Remove for the active Bible — but it is one of the
  // two refusals this file exists to hold.
  const e = engine();
  await e.installModule(BIBLE);
  e.setActive(BIBLE.abbr);
  // ⚠ getInstalled() RETURNS A FRESH PARSE of localStorage, so mutating what it hands back changes nothing.
  // An earlier version of this test did exactly that, built none of the state it describes, and the
  // sabotage row for this fix correctly refused to bite — which is how the blindness was found.
  const inst = e.getInstalled();
  delete inst[BIBLE.url];
  e.setInstalled(inst);                                  // the record vanishes; the module stays loaded
  assert.ok(!e.getInstalled()[BIBLE.url], 're-anchor: the record survived, so this tests nothing');
  assert.ok(e.modules[BIBLE.abbr], 're-anchor: the module is not loaded, so there is nothing to protect');
  assert.equal(await e.removeModule(BIBLE.abbr, 'bibles'), false,
    'THE BIBLE BEING READ WAS REMOVED. Its record was missing, so the url comparison could not fire and the ' +
    'name fallback was skipped — leaving `active` pointing at a module that is no longer loaded.');
  assert.ok(e.modules[BIBLE.abbr], 'the active Bible was dropped from memory');
});

test('an ambiguous name is still REFUSED when the loaded copy is not one of the candidates', () => {
  // The `named.includes(loadedFrom)` half of the ambiguity fix. Without this row the clause is
  // unfalsifiable — dropping it leaves every other test green — and CLAUDE.md rule 4 says a claim in the
  // permanent record needs a test behind it.
  //
  // ⚠ REACHING IT TAKES A SPECIFIC STATE, and an earlier version of this test did not reach it: pointing
  // `urlOf` at a url with NO record resolves to a record that does not exist, which `removeModule` refuses
  // further down for its own reasons — so the row passed either way and proved nothing. The state that
  // actually exercises the clause is `urlOf` pointing at a REAL record that is no longer a CANDIDATE:
  // `urlOf` is rebuilt each launch from what loaded, the installed map outlives it, and
  // `noteRegisteredAbbr` can rewrite a record's abbr afterwards. Then resolving to it would delete a real
  // module's real bytes — one the member never pointed at.
  return (async () => {
    // A FOURTH, UNRELATED Bible is the one being read. Without it the module this resolves to IS the active
    // Bible, and the active-Bible refusal answers first — which is what an earlier version of this row
    // measured while believing it was measuring the candidacy guard.
    const e = engine();
    await e.installModule(BIBLE);
    e.setActive(BIBLE.abbr);
    await e.installModule(TWIN_A);
    await e.installModule(TWIN_B);
    await e.installModule(TWIN_C);                       // urlOf['bibles|NT'] now names TWIN_C
    e.noteRegisteredAbbr(TWIN_C.url, 'NTX');             // …and TWIN_C's record stops being an 'NT'

    const named = Object.values(e.getInstalled()).filter(r => r.abbr === 'NT');
    assert.equal(named.length, 2, 're-anchor: the candidate set is not ambiguous, so the clause is not reached');
    assert.ok(e.getInstalled()[TWIN_C.url] && e.getInstalled()[TWIN_C.url].abbr === 'NTX',
      're-anchor: TWIN_C is still a candidate, so `named.includes` cannot be what refuses');

    assert.equal(await e.removeModule('NT', 'bibles'), false,
      'AN AMBIGUOUS NAME RESOLVED TO A MODULE THAT IS NOT ONE OF THE CANDIDATES. `urlOf` outlived the abbr ' +
      'it was keyed under, and the removal followed it — deleting a real module the member never pointed at. ' +
      'A guess is never better than a refusal on a destructive action.');
    assert.ok(await e.cacheGet(TWIN_C.url) !== null,
      "it deleted the bytes of a module that was not even a candidate for the name it was given");
    assert.ok(e.getInstalled()[TWIN_C.url], 'it removed the record of a module that was not a candidate');
  })();
});
