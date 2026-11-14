// Shared harness for the install-a-Bible-from-a-file tests: the REAL engine.js in a vm over an in-memory
// IndexedDB/localStorage, plus the byte builders. Stores, not deciders: assertions read them afterwards.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
export const ROOT = new URL('../', import.meta.url).pathname;
export const realFflate = require('fflate');
const realInitSqlJs = require(ROOT + 'vendor/sqljs/sql-wasm.js');
export const initSqlJs = () => realInitSqlJs({ locateFile: f => ROOT + 'vendor/sqljs/' + f });
export const file = (rel) => new Uint8Array(readFileSync(ROOT + rel));
export const enc = (s) => new TextEncoder().encode(s);
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── the stores ───────────────────────────────────────────────────────────────────────────────────────────────
function fakeIndexedDB(state) {
  const stores = state.stores || (state.stores = new Map());
  const req = () => ({ onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined, error: null });
  const settle = (r, value) => { setTimeout(() => { r.result = value; if (r.onsuccess) r.onsuccess(); }, 0); return r; };
  const db = {
    createObjectStore(name) { if (!stores.has(name)) stores.set(name, new Map()); return {}; },
    transaction(name, mode) {
      const m = stores.get(name) || stores.set(name, new Map()).get(name);
      const tx = { oncomplete: null, onabort: null, onerror: null, error: null };
      const commit = (ms = 0) => setTimeout(() => {
        if (state.quotaFull && mode === 'readwrite') { tx.error = new Error('QuotaExceededError'); if (tx.onabort) tx.onabort(); }
        else if (tx.oncomplete) tx.oncomplete();
      }, ms);
      const store = {
        transaction: tx,
        get: (k) => { const r = settle(req(), m.has(k) ? m.get(k) : undefined); commit(); return r; },
        put: (v, k) => { if (!state.quotaFull) { m.set(k, v); state.puts.push(k); } const r = settle(req(), k); commit((state.putDelay && state.putDelay[k]) || 0); return r; },
        delete: (k) => { m.delete(k); const r = settle(req(), undefined); commit(); return r; },
        getAllKeys: () => { const r = settle(req(), [...m.keys()]); commit(); return r; },
      };
      tx.objectStore = () => store;
      return tx;
    },
  };
  return { open() { const r = req(); setTimeout(() => { r.result = db; if (r.onupgradeneeded) r.onupgradeneeded(); if (r.onsuccess) r.onsuccess(); }, 0); return r; } };
}
export function newStores() { return { stores: new Map(), puts: [], quotaFull: false, ls: new Map() }; }
const lsOf = (state) => ({ getItem: (k) => (state.ls.has(k) ? state.ls.get(k) : null), setItem: (k, v) => { state.ls.set(k, String(v)); }, removeItem: (k) => { state.ls.delete(k); } });
export const records = (state) => JSON.parse(state.ls.get('trinityone.installed') || '{}');
export const cached = (state, key) => ((state.stores.get('modules') || new Map()).get(key)) || null;

// ── the phone: the REAL engine.js ────────────────────────────────────────────────────────────────────────────
// `readyState: 'loading'` holds boot (autoLoad) back until `boot()` is called, exactly as a page that has not yet
// fired DOMContentLoaded does; that is what lets a test start an install DURING boot.
export function phone({ state = newStores(), serveBsb = false, bsbDelay = 0, catalogDelay = 0, hosted = {}, readyState = 'loading', unzipCalls = null } = {}) {
  const onlineCbs = [];
  const win = { addEventListener(t, fn) { if (t === 'online') onlineCbs.push(fn); }, location: { search: '' } };
  const net = { serveBsb };
  const sqlStats = { opened: 0, closed: 0 };
  const sqlJs = async (o) => {
    const SQL = await initSqlJs(o);
    const D = SQL.Database;
    return { Database: class extends D {
      constructor(bytes) { super(bytes); sqlStats.opened++; }
      close() { sqlStats.closed++; return super.close(); } } };
  };
  const bootCbs = [];
  const fakeInput = { listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; }, click() {}, style: {} };
  const document = {
    readyState,
    addEventListener(t, fn) { if (t === 'DOMContentLoaded') bootCbs.push(fn); },
    createElement: () => fakeInput, body: { appendChild() {} },
  };
  const fflate = unzipCalls ? { ...realFflate, unzipSync: (u8, o) => { unzipCalls.push(o && o.filter ? 'filter' : 'full'); if (o && o.filter) { const f = o.filter; o = { ...o, filter: (i) => { unzipCalls.entryCount = (unzipCalls.entryCount || 0) + 1; return f(i); } }; } return realFflate.unzipSync(u8, o); } } : realFflate;
  const fetched = [];
  const fetch = async (url) => {
    fetched.push(String(url));
    if (String(url) === 'catalog.json') { if (catalogDelay) await sleep(catalogDelay); }
    if (String(url) === 'catalog.json') return { ok: true, json: async () => JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8')) };
    if (String(url) === 'ebible-catalog.json') return { ok: true, json: async () => JSON.parse(readFileSync(ROOT + 'ebible-catalog.json', 'utf8')) };
    if (hosted[String(url)]) { const b = hosted[String(url)]; return { ok: true, status: 200, headers: { get: () => String(b.length) }, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; }
    if (net.serveBsb && String(url).endsWith('modules/engbsb.zip')) {
      if (bsbDelay) await sleep(bsbDelay);
      const b = readFileSync(ROOT + 'modules/engbsb.zip');
      return { ok: true, status: 200, headers: { get: () => String(b.length) }, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
    }
    throw new Error('no network in this test: ' + url);
  };
  const c = {
    window: win, document, location: { search: '' }, navigator: undefined,
    console: { error() {}, warn() {}, log() {} }, TextDecoder, TextEncoder, URLSearchParams, URL,
    setTimeout, clearTimeout, Promise, Uint8Array, fflate, initSqlJs: sqlJs, crypto: webcrypto,
    indexedDB: fakeIndexedDB(state), localStorage: lsOf(state), fetch, DOMException,
  };
  win.window = win; win.localStorage = c.localStorage;
  vm.createContext(c);
  vm.runInContext(readFileSync(ROOT + 'engine.js', 'utf8'), c, { filename: 'engine.js' });
  const Bible = win.Bible;
  assert.ok(typeof Bible.installFromBytes === 'function', 'engine.js no longer exposes Bible.installFromBytes — re-anchor');
  // the engine runs in a vm, so its objects have another realm's prototypes; hand results back as plain data
  const rawInstall = Bible.installFromBytes;
  Bible.installFromBytes = async (...a) => JSON.parse(JSON.stringify(await rawInstall.apply(Bible, a)));
  Bible.onFileInstall = ((raw) => (fn) => raw((ev) => fn(JSON.parse(JSON.stringify(ev)))))(Bible.onFileInstall);
  const boot = async () => { bootCbs.splice(0).forEach(fn => fn()); await sleep(20); };
  return { Bible, win, state, boot, fakeInput, fetched, net, sqlStats, goOnline: async () => { onlineCbs.slice().forEach(fn => fn()); await sleep(5); }, installed: () => records(state) };
}
// a phone that has finished booting with nothing installed (the default BSB cannot download: no network)
export async function readyPhone(opts) { const p = phone(opts); await p.boot(); p.Bible._error = null; return p; }   // boot's own failed default download is not the subject
export async function until(fn, ms = 4000) { for (let t = 0; t < ms; t += 25) { if (fn()) return; await sleep(25); } assert.fail('timed out waiting'); }

// ── bytes ────────────────────────────────────────────────────────────────────────────────────────────────────
export const usfmBook = (idLine, verse, extra = '') => `\\id ${idLine}\n${extra}\\c 1\n\\p\n\\v 1 ${verse}\n`;
export const usfmZip = (idLine, verse, extra = '') => realFflate.zipSync({ '02-GEN.usfm': enc(usfmBook(idLine, verse, extra)) });
export async function sqliteBytes(sql) { const SQL = await initSqlJs(); const db = new SQL.Database(); db.run(sql); const u8 = db.export(); db.close(); return u8; }
export const bibleSql = (abbr, desc, verse = 'In the beginning') => `CREATE TABLE Details (Description TEXT, Abbreviation TEXT); INSERT INTO Details VALUES ('${desc}', '${abbr}');
  CREATE TABLE Bible (Book INT, Chapter INT, Verse INT, Scripture TEXT); INSERT INTO Bible VALUES (1, 1, 1, '${verse}');`;
export const bibleDb = (abbr, desc, verse) => sqliteBytes(bibleSql(abbr, desc, verse));
export const dictDb = (abbr, desc) => sqliteBytes(`CREATE TABLE Details (Title TEXT, Abbreviation TEXT); INSERT INTO Details VALUES ('${desc}', '${abbr}');
  CREATE TABLE Dictionary (topic TEXT, definition TEXT); INSERT INTO Dictionary VALUES ('AARON', 'The eldest son of Amram'), ('ABEL', 'Breath');`);
export const VIEW_BOMB = `CREATE VIEW Details AS WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 3000000) SELECT 'EVIL' AS Abbreviation, count(*) AS Description FROM c;
  CREATE TABLE Bible (Book INT, Chapter INT, Verse INT, Scripture TEXT); INSERT INTO Bible VALUES (1, 1, 1, 'x');`;
export const crossrefJson = (abbr, name) => enc(JSON.stringify({ meta: { kind: 'crossref', abbr, name, license: 'CC' }, refs: { '1.1.1': ['John 1:1'] } }));
export const sha = async (u8) => [...new Uint8Array(await webcrypto.subtle.digest('SHA-256', u8))].map(b => b.toString(16).padStart(2, '0')).join('');
// What the engine holds right now, by kind — the "no module was registered" evidence.
export const held = (B) => JSON.stringify({ bibles: B.versions().map(v => v.abbr), cmts: B.commentaryList().map(c => c.abbr), xrefs: B.crossrefList().map(c => c.abbr) });
export const KEY = /^imported\/[0-9a-f]{12}\/[A-Za-z0-9._-]{1,40}\.(zip|usfm|json|bbl\.mybible|cmt\.mybible|dct\.mybible|bbl\.mybible\.zip|cmt\.mybible\.zip|dct\.mybible\.zip)$/;
