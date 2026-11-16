// SHARING THE APP AND SHARING A BIBLE ARE TWO SEPARATE, SINGLE-FILE SHARES.
// Run: node --test scripts/sharing-the-app-and-a-bible-are-separate.test.mjs
//
// THE DEFECT (shipped 0.9.72 / vc 222). "Share the app" offered a Bible picker and sent the APK and the chosen
// Bible as ONE two-file share — @capacitor/share turns that into ACTION_SEND_MULTIPLE typed */*. Signal's
// multi-file path keeps only images and videos, so it was left with nothing and closed its share screen without
// a word: the member picked Signal and nothing was sent. A single file goes as ACTION_SEND, which Signal takes
// whatever its type. (That Signal behaviour is read from Signal's source, not proved here — the device test is.)
//
// THE FIX. "Share the app" sends the APK alone. Each importable module gets its own Share button on
// Library → Installed, which sends that one file. Both go through share-app.jsx's shareOneFile.
//
// WHAT RUNS FOR REAL (CLAUDE.md rules 1 and 3 — nothing here matches text in app/*.jsx):
//   · the real ShareAppSheet, shareTrinityOneApp, shareOneFile and isShareableModule, compiled from
//     app/share-app.jsx; the real InstalledBrowser from app/screens-library.jsx; both drawn through
//     scripts/render-jsx-screen.mjs and driven by pressing their buttons;
//   · the real engine.js, whole, in a vm, for the IMPORT side: every module the screen offers a Share for is
//     fed — as the exact bytes the share wrote — to the engine's own loadModuleBytes, which is what a
//     recipient's Library → Import runs. "Offered" is tied to "importable", not to a list in this file.
//   · the module bytes are the real files in modules/ (a USFM zip, a MySword .bbl.mybible, a .cmt.mybible.zip,
//     JSON dictionaries), plus a MySword dictionary built with the app's own vendored sql.js.
// FAKED, and named: the Capacitor Filesystem and Share plugins (they record what they are given), fetch for
// the APK, navigator/document for the web path, and window.Bible on the SCREEN side (installedMap +
// exportModule serving the module bytes) — engine.js's exportModule is a two-line cacheGet and is not changed.
//
// NOT PROVED HERE (rule 6): that Signal / Quick Share accept the single files on a phone. That is the device test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const require = createRequire(import.meta.url);
const ROOT = new URL('../', import.meta.url).pathname;
const realInitSqlJs = require(ROOT + 'vendor/sqljs/sql-wasm.js');
const initSqlJs = () => realInitSqlJs({ locateFile: f => ROOT + 'vendor/sqljs/' + f });
const file = (rel) => new Uint8Array(readFileSync(ROOT + rel));

// ── the recipient: the REAL engine.js, run whole ─────────────────────────────────────────────────────────────
// As verse-of-the-day-reads-as-scripture does: `document.readyState: 'loading'` holds autoLoad back; fflate and
// sql.js are what the page loads before engine.js.
function realBible() {
  const win = { addEventListener() {}, location: { search: '' } };
  const c = {
    window: win, document: { readyState: 'loading', addEventListener() {} }, location: { search: '' },
    console: { error() {}, warn() {}, log() {} }, TextDecoder, TextEncoder, URLSearchParams, URL,
    setTimeout, clearTimeout, Promise, Uint8Array, fflate: require('fflate'), initSqlJs,
  };
  win.window = win;
  vm.createContext(c);
  vm.runInContext(readFileSync(ROOT + 'engine.js', 'utf8'), c, { filename: 'engine.js' });
  assert.ok(win.Bible && typeof win.Bible.loadModuleBytes === 'function', 'engine.js no longer exposes Bible.loadModuleBytes — re-anchor');
  return win.Bible;
}

// A MySword dictionary, as a member might have imported one — built with the app's own sql.js.
async function mySwordDictionary() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE Details (Title TEXT, Abbreviation TEXT); INSERT INTO Details VALUES ('Easton Bible Dictionary', 'EAS');" +
    "CREATE TABLE Dictionary (topic TEXT, definition TEXT); INSERT INTO Dictionary VALUES ('AARON', 'The eldest son of Amram'), ('ABEL', 'Breath, vapour');");
  const u8 = db.export(); db.close();
  return u8;
}

// ── the modules on the sender's phone ────────────────────────────────────────────────────────────────────────
// Records in the shape engine.js's recordInstalled writes (url, abbr, name, kind, category). OFFERED are the
// ones the owner's rule allows; HELD BACK is one of each excluded type.
const OFFERED = [
  { url: 'modules/eng-kjv.zip', abbr: 'KJV', name: 'King James Version', kind: 'bible', category: 'bibles', src: 'modules/eng-kjv.zip' },
  { url: 'modules/eng-akjv.bbl.mybible', abbr: 'AKJV', name: 'American King James Version', kind: 'bible', category: 'bibles', src: 'modules/eng-akjv.bbl.mybible' },
  { url: 'modules/geneva-notes.cmt.mybible.zip', abbr: 'GNV', name: 'Geneva Study Notes', kind: 'comment', category: 'commentaries', src: 'modules/geneva-notes.cmt.mybible.zip' },
  { url: 'imported/eng-web.zip', abbr: 'WEB', name: 'World English Bible', kind: 'bible', category: 'bibles', src: 'modules/eng-web.zip' },
  { url: 'imported/easton.dct.mybible', abbr: 'EAS', name: 'Easton Bible Dictionary', kind: 'dict', category: 'dictionaries', src: 'sqlite-dict' },
];
const HELD_BACK = [
  { url: 'modules/lex-bdb.json', abbr: 'BDB', name: 'Brown-Driver-Briggs', kind: 'dict', category: 'dictionaries', src: 'modules/lex-bdb.json', refused: true },
  { url: 'modules/worddefs-wordnet.json', abbr: 'WN', name: 'Word Definitions (WordNet)', kind: 'worddef', category: 'dictionaries', src: 'modules/worddefs-wordnet.json', refused: true },
  { url: 'modules/original-greek.json', abbr: 'TAGNT', name: 'Greek New Testament (original words)', kind: 'original', category: 'dictionaries', src: 'modules/original-greek.json', refused: true },
  // Cross-references DO import on this build; they are held back because builds older than 2026-11-03 refuse
  // them (owner, v1). So this pair is asserted not offered, and NOT asserted unimportable.
  { url: 'modules/crossrefs-geneva.json', abbr: 'GNVX', name: 'Geneva cross-references', kind: 'crossref', category: 'crossrefs', src: 'modules/crossrefs-geneva.json' },
  { url: 'imported/my-refs.json', abbr: 'MINE', name: 'My own cross-references', kind: 'crossref', category: 'crossrefs', src: 'json-refs' },
  { url: 'modules/daily-light.json', abbr: 'DL', name: 'Daily Light', kind: 'devotional', category: 'devotionals', src: null },
  { url: 'modules/legacy-record.zip', abbr: 'OLD', name: 'A record with no category', kind: 'bible', src: 'modules/eng-asv.zip' },
  { url: 'modules/a-map-pack.zip', abbr: 'MAP', name: 'A category nobody knows', kind: 'map', category: 'maps', src: 'modules/eng-asv.zip' },
];
const ALL = [...OFFERED, ...HELD_BACK];
let DICT_BYTES = null;
async function bytesOf(rec) {
  if (rec.src === 'sqlite-dict') return DICT_BYTES || (DICT_BYTES = await mySwordDictionary());
  if (rec.src === 'json-refs') return new TextEncoder().encode(JSON.stringify({ meta: { abbr: 'MINE', kind: 'crossref' }, refs: { '43.3.16': ['Rom 5:8'] } }));
  return rec.src ? file(rec.src) : null;
}

// ── the phone's plugins ──────────────────────────────────────────────────────────────────────────────────────
// `shareRejects` makes Share.share reject with that message; `shareHangs` makes it never settle (the activity
// recreated under memory pressure while the member is in the other app). `App` records appStateChange listeners
// so a test can bring the app back to the foreground.
function fakeCapacitor({ native = true, shareRejects = null, shareHangs = false } = {}) {
  const shares = [], writes = [], deletes = [], appListeners = [];
  const Plugins = {
    App: { addListener: (ev, cb) => { appListeners.push([ev, cb]); return { remove() {} }; } },
    Filesystem: {
      deleteFile: async ({ path, directory }) => { deletes.push([path, directory]); },
      stat: async () => { throw new Error('File does not exist'); },
      writeFile: async ({ path, data, directory }) => { writes.push({ path, directory, bytes: new Uint8Array(Buffer.from(data, 'base64')) }); return { uri: 'file:///data/cache/' + path }; },
    },
    Share: { share: async (args) => { shares.push(args); if (shareHangs) return new Promise(() => {}); if (shareRejects) throw new Error(shareRejects); return { activityType: 'x' }; } },
  };
  const resume = () => appListeners.filter(([ev]) => ev === 'appStateChange').forEach(([, cb]) => cb({ isActive: true }));
  return { Capacitor: { isNativePlatform: () => native, Plugins }, shares, writes, deletes, resume };
}
const APK = new Uint8Array(1_200_000).fill(7);
const apkFetch = (ok = true) => async (url) => {
  assert.equal(url, 'https://app.trinityone.church/trinityone.apk', 'the app fetched something other than the member APK');
  if (!ok) throw new TypeError('Failed to fetch');
  return { ok: true, status: 200, arrayBuffer: async () => APK.buffer.slice(0) };
};

// A browser, for the web/PWA path: navigator.share/canShare and an <a download> that records its click.
function fakeBrowser({ canShare = true, shareRejects = null } = {}) {
  const shared = [], clicked = [];
  const navigator = {
    canShare: canShare ? (d) => !!(d && d.files && d.files.length === 1) : undefined,
    share: async (d) => { shared.push(d); if (shareRejects) { const e = new Error(shareRejects); e.name = shareRejects; throw e; } },
  };
  const document = {
    createElement: (tag) => { const el = { tag, click() { clicked.push({ tag, href: el.href, download: el.download }); }, remove() {} }; return el; },
    body: { appendChild() {} }, addEventListener() {}, removeEventListener() {},
  };
  const URLx = { createObjectURL: () => 'blob:fake/1', revokeObjectURL() {} };
  return { navigator, document, URL: URLx, shared, clicked };
}

// ── the screens ──────────────────────────────────────────────────────────────────────────────────────────────
function app({ cap, records = ALL, exportOverride = null, fetchOk = true, browser = fakeBrowser() } = {}) {
  const { React, draw } = miniReact();
  const toasts = [], opened = [], warns = [];
  let closed = 0;
  const win = {
    Capacitor: cap ? cap.Capacitor : undefined,
    Bible: {
      installedMap: () => Object.fromEntries(records.map(r => { const { src, refused, ...rec } = r; return [r.url, rec]; })),
      activeVersion: 'KJV', activeUrl: 'modules/eng-kjv.zip',
      removeModule: async () => true, isInstalled: () => true, subscribe: () => () => {}, versions: () => [],
      exportModule: async (url) => {
        if (exportOverride && url in exportOverride) return exportOverride[url]();
        const r = records.find(x => x.url === url);
        const bytes = r && await bytesOf(r);
        return bytes ? { bytes, filename: url.split('/').pop() } : null;
      },
    },
    TrinityData: {}, addEventListener() {}, removeEventListener() {},
  };
  const Icon = ({ name }) => React.createElement('i', { 'data-icon': name });
  const shared = {
    React, window: win, Icon, btoa, fetch: apkFetch(fetchOk), File, Blob,
    console: { warn: (...a) => warns.push(a.join(' ')), log() {}, error() {} },
    navigator: browser.navigator, document: browser.document, URL: browser.URL,
    setTimeout: () => 0,
  };
  const S = loadScreen('app/share-app.jsx', ['ShareAppSheet', 'shareTrinityOneApp', 'shareOneFile', 'isShareableModule'], {
    ...shared,
    BottomSheet: ({ open, children }) => (open ? children : null),
    IconBtn: ({ name, onClick }) => React.createElement('button', { 'data-iconbtn': name, onClick }),
  });
  const { InstalledBrowser } = loadScreen('app/screens-library.jsx', ['InstalledBrowser'], {
    ...shared,
    Spinner: () => React.createElement('i', { 'data-icon': 'spinner' }),
    ScreenScroll: (p) => p.children,
    safeCssColor: (c) => c || 'var(--clay)',
  });
  const ctx = { toast: (t) => toasts.push(t), openStore: (...a) => opened.push(a), go() {}, closeStore() {} };
  const sheet = () => draw(S.ShareAppSheet, { open: true, onClose: () => { closed++; }, ctx });
  const installed = () => draw(InstalledBrowser, { ctx, category: null, force: () => {} });
  const labelled = (tree, label) => find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));
  // the Installed row for a module: the div carrying its name and exactly one Remove button
  const rowFor = (tree, name) => {
    const rows = find(tree, n => n.type === 'div' && texts(n).join(' ').includes(name) && labelled(n, 'Remove').length === 1);
    assert.ok(rows.length, `no Installed row for ${name} — re-anchor this test`);
    return rows[rows.length - 1];
  };
  const shareBtnOf = (tree, name) => labelled(rowFor(tree, name), 'Share');
  return { S, win, toasts, opened, warns, closed: () => closed, sheet, installed, labelled, rowFor, shareBtnOf, browser };
}

// ════════════════════════════════════════ A. "Share the app" ════════════════════════════════════════════════

test('A1 — "Share the app" sends ONE file, the APK, with no text or url beside it', async () => {
  const cap = fakeCapacitor();
  const a = app({ cap });
  const go = a.labelled(a.sheet(), 'Share the app').filter(b => typeof b.props.onClick === 'function' && !b.props['data-iconbtn']);
  assert.equal(go.length, 1, 'the sheet has no single "Share the app" button — re-anchor this test');
  await go[0].props.onClick();

  assert.equal(cap.shares.length, 1, `Share.share was called ${cap.shares.length} times`);
  const s = cap.shares[0];
  assert.ok(Array.isArray(s.files) && s.files.length === 1, `the share carried ${JSON.stringify(s.files)} — a multi-file share is what Signal drops`);
  assert.match(s.files[0], /\/TrinityOne\.apk$/);
  assert.equal(s.text, undefined, 'text alongside the file makes Quick Share / Bluetooth send only the text');
  assert.equal(s.url, undefined, 'a url alongside the file makes Quick Share / Bluetooth send only the url');
  assert.deepEqual(cap.writes.map(w => [w.path, w.directory, w.bytes.length]), [['TrinityOne.apk', 'CACHE', APK.length]]);
  assert.deepEqual(a.toasts, []);
});

test('A2 — the sheet has no Bible picker; "Choose a Bible" opens Library → Installed → Bibles', async () => {
  const a = app({ cap: fakeCapacitor() });
  const tree = a.sheet();
  assert.equal(find(tree, n => n.type === 'select').length, 0, 'a Bible <select> is still on the Share-the-app sheet');
  const choose = a.labelled(tree, 'Choose a Bible');
  assert.equal(choose.length, 1, 'no pointer to the Library on the sheet');
  choose[0].props.onClick();
  assert.deepEqual(a.opened, [['installed', 'bibles']], 'the pointer did not open Library → Installed → Bibles');
  assert.equal(a.closed(), 1, 'the Share-the-app sheet stayed open under the Library');

  // nothing on the phone that can be passed on → no pointer
  const b = app({ cap: fakeCapacitor(), records: HELD_BACK });
  assert.equal(b.labelled(b.sheet(), 'Choose a Bible').length, 0, 'the pointer is offered on a phone with nothing shareable');
});

test('A3 — backing out of the share sheet is not an error: no toast', async () => {
  const cap = fakeCapacitor({ shareRejects: 'Share canceled' });
  const a = app({ cap });
  await a.labelled(a.sheet(), 'Share the app').find(b => !b.props['data-iconbtn']).props.onClick();
  assert.equal(cap.shares.length, 1, 'the share sheet was never opened — re-anchor this test');
  assert.deepEqual(a.toasts, [], `backing out showed ${JSON.stringify(a.toasts)}`);
});

test('A4 — an APK that cannot be prepared says so, and nothing is shared', async () => {
  const cap = fakeCapacitor();
  const a = app({ cap, fetchOk: false });
  await a.labelled(a.sheet(), 'Share the app').find(b => !b.props['data-iconbtn']).props.onClick();
  assert.equal(cap.shares.length, 0, 'a share was opened with no APK prepared');
  assert.equal(a.toasts.length, 1);
  assert.match(a.toasts[0], /Couldn.t prepare the share/);
});

// ═════════════════════════════════ B. Library → Installed → Share ═══════════════════════════════════════════

test('B4 — Share on a Bible row sends that ONE file, byte-for-byte', async () => {
  const cap = fakeCapacitor();
  const a = app({ cap });
  const btn = a.shareBtnOf(a.installed(), 'King James Version');
  assert.equal(btn.length, 1, 'the King James Version row has no Share button');
  await btn[0].props.onClick();

  assert.equal(cap.shares.length, 1);
  const s = cap.shares[0];
  assert.ok(s.files.length === 1 && /\/eng-kjv\.zip$/.test(s.files[0]), `the share carried ${JSON.stringify(s.files)}`);
  assert.equal(s.text, undefined); assert.equal(s.url, undefined);
  assert.equal(cap.writes.length, 1);
  assert.equal(cap.writes[0].path, 'eng-kjv.zip'); assert.equal(cap.writes[0].directory, 'CACHE');
  assert.deepEqual(cap.writes[0].bytes, file('modules/eng-kjv.zip'), 'the file shared is not the module on this phone');
  assert.deepEqual(a.toasts, []);
});

test('B5 — Share is offered exactly on the modules a recipient can import, and each one really imports', async () => {
  const a = app({ cap: fakeCapacitor() });
  const tree = a.installed();
  const offered = ALL.filter(r => a.shareBtnOf(tree, r.name).length === 1);
  assert.deepEqual(offered.map(r => r.url).sort(), OFFERED.map(r => r.url).sort(),
    'the rows offering Share are not the importable ones');
  for (const r of HELD_BACK) assert.equal(a.shareBtnOf(tree, r.name).length, 0, `${r.name} (${r.url}) is offered a Share`);

  // EVERY offered row, driven through the screen, and the bytes it wrote handed to the real engine import.
  const Bible = realBible();
  for (const r of offered) {
    const cap = fakeCapacitor();
    const b = app({ cap });
    await b.shareBtnOf(b.installed(), r.name)[0].props.onClick();
    assert.equal(cap.writes.length, 1, `${r.name}: Share wrote ${cap.writes.length} files (toasts ${JSON.stringify(b.toasts)})`);
    assert.equal(cap.shares.length, 1, `${r.name}: Share opened ${cap.shares.length} share sheets`);
    const w = cap.writes[0];
    const got = await Bible.loadModuleBytes(w.bytes, w.path);
    assert.ok(got && got.abbr, `${r.name}: the recipient's import returned ${JSON.stringify(got)}`);
    assert.equal(got.kind, { bible: 'bible', comment: 'comment', dict: 'dict' }[r.kind], `${r.name} imported as a ${got.kind}`);
  }
  // And the held-back JSON data really is refused by that import — this is why it is not offered.
  for (const r of HELD_BACK.filter(x => x.refused)) {
    await assert.rejects(() => Bible.loadModuleBytes(file(r.src), r.url.split('/').pop()), /unrecognized file/,
      `${r.name} imports after all — re-examine isShareableModule`);
  }
});

test('B5b — isShareableModule is an allowlist: every unknown or partial record is refused', () => {
  const { S } = app({ cap: fakeCapacitor() });
  for (const r of OFFERED) assert.equal(S.isShareableModule(r), true, r.url);
  for (const r of HELD_BACK) assert.equal(S.isShareableModule(r), false, r.url);
  for (const r of [null, undefined, {}, { category: 'bibles' }, { url: '', category: 'bibles' }, { url: 'modules/x.json', category: 'bibles' },
    { url: 'imported/x.json', category: 'crossrefs' }, { url: 'imported/d.json', category: 'devotionals' }, { url: 'imported/q.zip' }])
    assert.equal(S.isShareableModule(r), false, JSON.stringify(r));
});

test('B6 — a module whose bytes are missing, or whose export throws, says so and shares nothing', async () => {
  const cap = fakeCapacitor();
  const a = app({ cap, exportOverride: {
    'modules/eng-kjv.zip': async () => null,
    'modules/geneva-notes.cmt.mybible.zip': async () => { throw new Error('IndexedDB is unavailable'); },
    'modules/eng-akjv.bbl.mybible': async () => ({ bytes: new Uint8Array(0), filename: 'eng-akjv.bbl.mybible' }),
  } });
  for (const name of ['King James Version', 'Geneva Study Notes', 'American King James Version']) {
    await a.shareBtnOf(a.installed(), name)[0].props.onClick();
  }
  assert.equal(cap.shares.length, 0, 'a share sheet opened with nothing to share');
  assert.equal(cap.writes.length, 0);
  assert.deepEqual(a.toasts, [
    "Couldn't share King James Version — it isn't saved on this phone",
    "Couldn't share Geneva Study Notes — it isn't saved on this phone",
    "Couldn't share American King James Version — it isn't saved on this phone",
  ]);
});

test('B7 — backing out of a module share is not an error: no toast; another failure does say so', async () => {
  const cap = fakeCapacitor({ shareRejects: 'Share canceled' });
  const a = app({ cap });
  await a.shareBtnOf(a.installed(), 'King James Version')[0].props.onClick();
  assert.equal(cap.shares.length, 1, 'the share sheet was never opened — re-anchor this test');
  assert.deepEqual(a.toasts, [], `backing out showed ${JSON.stringify(a.toasts)}`);

  const cap2 = fakeCapacitor({ shareRejects: 'No Activity found to handle Intent' });
  const b = app({ cap: cap2 });
  await b.shareBtnOf(b.installed(), 'King James Version')[0].props.onClick();
  assert.equal(b.toasts.length, 1, 'a share that really failed said nothing');
  assert.match(b.toasts[0], /Couldn.t share King James Version/);
});

// ═════════════════════════════════════════════ W. web / PWA ═══════════════════════════════════════════════

test('W8 — on the web, Share hands the browser ONE File where it can, and downloads it where it cannot', async () => {
  // canShare true → navigator.share with one File, named as the module
  const web = fakeBrowser({ canShare: true });
  const a = app({ cap: null, browser: web });
  await a.shareBtnOf(a.installed(), 'King James Version')[0].props.onClick();
  assert.equal(web.shared.length, 1, 'navigator.share was not used');
  assert.equal(web.shared[0].files.length, 1);
  assert.ok(web.shared[0].files[0] instanceof File);
  assert.equal(web.shared[0].files[0].name, 'eng-kjv.zip');
  assert.equal(web.shared[0].files[0].type, 'application/zip');
  assert.equal(web.clicked.length, 0, 'it shared AND downloaded');

  // canShare missing → an <a download> is clicked, named as the module
  const dl = fakeBrowser({ canShare: false });
  const b = app({ cap: null, browser: dl });
  await b.shareBtnOf(b.installed(), 'American King James Version')[0].props.onClick();
  assert.equal(dl.shared.length, 0);
  assert.deepEqual(dl.clicked.map(c => [c.tag, c.download]), [['a', 'eng-akjv.bbl.mybible']]);

  // backing out of the browser's sheet → nothing said, nothing downloaded
  const ab = fakeBrowser({ canShare: true, shareRejects: 'AbortError' });
  const c = app({ cap: null, browser: ab });
  await c.shareBtnOf(c.installed(), 'King James Version')[0].props.onClick();
  assert.deepEqual(c.toasts, []); assert.equal(ab.clicked.length, 0);
});

// ═══════════════════════════ audit follow-ups (AUDIT-share-app-split-d0de5349, 2026-11-13) ═══════════════════════
const ticks = () => new Promise(r => setTimeout(r, 30));
const appBtn = (a) => a.labelled(a.sheet(), 'Share the app').find(b => !b.props['data-iconbtn']);

test('L2 — a share that really failed says "Couldn’t share {name}" and nothing more; the plugin text goes to the log', async () => {
  const cap = fakeCapacitor({ shareRejects: 'No Activity found to handle Intent' });
  const a = app({ cap });
  await a.shareBtnOf(a.installed(), 'King James Version')[0].props.onClick();
  assert.deepEqual(a.toasts, ['Couldn’t share King James Version'], `the member was shown ${JSON.stringify(a.toasts)}`);
  assert.ok(a.warns.some(w => w.includes('No Activity found to handle Intent')), 'the plugin’s error was not logged');

  const cap2 = fakeCapacitor({ shareRejects: 'Can’t share while sharing is in progress' });
  const b = app({ cap: cap2 });
  await appBtn(b).props.onClick();
  assert.deepEqual(b.toasts, ['Couldn’t share TrinityOne'], `the member was shown ${JSON.stringify(b.toasts)}`);
});

test('L3 — a module copy is deleted at once only if the share FAILED; a shared or dismissed one at the next share; the APK never', async () => {
  // dismissed → KEPT for now: the Android chooser reports "Share canceled" for a pick that opens an overlay (the
  // Quick Share sheet), which may still be reading the file — then deleted when the next module is shared
  const c1 = fakeCapacitor({ shareRejects: 'Share canceled' });
  const a = app({ cap: c1 });
  await a.shareBtnOf(a.installed(), 'King James Version')[0].props.onClick();
  await ticks();
  assert.deepEqual(c1.deletes, [], 'a "dismissed" copy was deleted while Quick Share may still be reading it');
  await a.shareBtnOf(a.installed(), 'Geneva Study Notes')[0].props.onClick();
  await ticks();
  assert.deepEqual(c1.deletes, [['eng-kjv.zip', 'CACHE']], 'the dismissed copy was not cleared by the next share');

  // failed → deleted at once
  const c2 = fakeCapacitor({ shareRejects: 'No Activity found to handle Intent' });
  const b = app({ cap: c2 });
  await b.shareBtnOf(b.installed(), 'King James Version')[0].props.onClick();
  assert.deepEqual(c2.deletes, [['eng-kjv.zip', 'CACHE']], 'a failed module share left its copy in CACHE');

  // shared → NOT deleted while a background transfer may still be reading it; deleted when the next module is shared
  const c3 = fakeCapacitor();
  const c = app({ cap: c3 });
  await c.shareBtnOf(c.installed(), 'King James Version')[0].props.onClick();
  await ticks();
  assert.deepEqual(c3.deletes, [], 'a shared copy was deleted while Quick Share / Bluetooth may still be reading it');
  await c.shareBtnOf(c.installed(), 'Geneva Study Notes')[0].props.onClick();
  await ticks();
  assert.deepEqual(c3.deletes, [['eng-kjv.zip', 'CACHE']], 'the previous shared copy was not cleared by the next share');

  // the APK's cache-once copy is never deleted — shared, dismissed or failed
  for (const opts of [{}, { shareRejects: 'Share canceled' }, { shareRejects: 'boom' }]) {
    const ca = fakeCapacitor(opts);
    const d = app({ cap: ca });
    await appBtn(d).props.onClick();
    await ticks();
    assert.equal(ca.shares.length, 1, 're-anchor: the APK share never opened');
    assert.deepEqual(ca.deletes, [], `the APK copy was deleted (${JSON.stringify(opts)})`);
  }
});

test('L4 + N5 — while one row prepares, EVERY row’s Share is disabled; coming back to the app clears a share that never settled', async () => {
  const cap = fakeCapacitor({ shareHangs: true });
  const a = app({ cap });
  a.installed();                                                   // mount: the foreground listener is attached
  a.shareBtnOf(a.installed(), 'King James Version')[0].props.onClick();   // never settles
  await ticks();
  assert.equal(cap.shares.length, 1, 'the share sheet never opened — re-anchor this test');
  let tree = a.installed();
  assert.equal(a.labelled(a.rowFor(tree, 'King James Version'), 'Preparing').length, 1, 'the row being shared does not say Preparing…');
  for (const r of OFFERED.filter(x => x.name !== 'King James Version')) {
    const b = a.shareBtnOf(tree, r.name);
    assert.equal(b.length, 1, `${r.name} lost its Share button`);
    assert.equal(b[0].props.disabled, true, `${r.name}'s Share looks tappable while another share is preparing, and does nothing`);
  }

  cap.resume();                                                    // the member comes back from the other app
  tree = a.installed();
  assert.equal(a.labelled(a.rowFor(tree, 'King James Version'), 'Preparing').length, 0, 'still "Preparing…" after coming back to the app');
  for (const r of OFFERED) assert.equal(a.shareBtnOf(tree, r.name)[0].props.disabled, false, `${r.name}'s Share is still locked after coming back`);
});

test('N6 — "Choose a Bible" is offered only when a shareable BIBLE is installed', () => {
  const onlyCommentary = [OFFERED.find(r => r.category === 'commentaries'), ...HELD_BACK];
  const a = app({ cap: fakeCapacitor(), records: onlyCommentary });
  assert.equal(a.labelled(a.sheet(), 'Choose a Bible').length, 0, 'the pointer leads to a Bibles list with nothing to share');
  const onlyDict = [OFFERED.find(r => r.category === 'dictionaries'), ...HELD_BACK];
  const b = app({ cap: fakeCapacitor(), records: onlyDict });
  assert.equal(b.labelled(b.sheet(), 'Choose a Bible').length, 0, 'the pointer leads to a Bibles list with nothing to share');
  const c = app({ cap: fakeCapacitor(), records: [OFFERED[0], ...HELD_BACK] });
  assert.equal(c.labelled(c.sheet(), 'Choose a Bible').length, 1, 'a phone with a shareable Bible is not offered the pointer');
});

test('L4b — coming back to the app while the file is still being PREPARED does not unlock the rows', async () => {
  // The share sheet has not been asked for yet (the export is still running), so a resume is not the sheet going
  // away; clearing then would let a second tap start a second share mid-preparation.
  const cap = fakeCapacitor();
  let release = null;
  const a = app({ cap, exportOverride: { 'modules/eng-kjv.zip': () => new Promise(r => { release = r; }) } });
  a.installed();
  const done = a.shareBtnOf(a.installed(), 'King James Version')[0].props.onClick();
  await ticks();
  assert.ok(release, 're-anchor: the export was never asked for');
  cap.resume();
  const tree = a.installed();
  assert.equal(a.labelled(a.rowFor(tree, 'King James Version'), 'Preparing').length, 1, 'a resume mid-preparation cleared "Preparing…"');
  assert.equal(a.shareBtnOf(tree, 'Geneva Study Notes')[0].props.disabled, true, 'a resume mid-preparation re-enabled the other rows');
  release({ bytes: file('modules/eng-kjv.zip'), filename: 'eng-kjv.zip' });
  await done;
  assert.equal(cap.shares.length, 1, 'the share did not go ahead once prepared');
});

// ═══════════════════════════ C. "Share as image" — the verse card (2026-11-16) ═══════════════════════════════
// The card used to go out as text + a /v link, and the messenger showed the WEBSITE's link preview, not the card.
// Owner (2026-11-16): send the PICTURE plus the verse words, and NO link. These drive the REAL ShareCard (app/
// share-app.jsx) by pressing its buttons; verseShareText is the REAL one, compiled from app/app.jsx (whole).
// FAKED, and named: the canvas (records every fillText; toBlob returns fixed bytes — that the real canvas code
// makes a real PNG is proved in a browser by scripts/the-verse-card-is-a-real-png.test.mjs), Overlay/IconBtn,
// and the plugins/browser above. window.Fellowship.relays is SET, so the old code WOULD have added a link.
const VERSE = { ref: 'John 3:16', version: 'WEB', text: 'For God so loved the world, that he gave his one and only Son.' };
const CANVAS_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3]);
function fakeCanvas(drawn, { noBlob = false } = {}) {
  let font = '10px serif', fill = '#000000';
  const cx = {
    get font() { return font; }, set font(v) { font = v; },
    // like a real canvas: a colour it cannot parse (e.g. "var(--clay)") leaves fillStyle unchanged
    get fillStyle() { return fill; }, set fillStyle(v) { if (typeof v === 'object' || /^#[0-9a-f]{6}$/i.test(v) || /^rgba?\(/.test(v)) fill = v; },
    strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1, textAlign: 'left', textBaseline: 'top', lineCap: '', lineJoin: '',
    measureText: (t) => ({ width: String(t).length * Number(/(\d+)px/.exec(font)[1]) * 0.5 }),
    fillText: (t) => { drawn.push(String(t)); },
    fillRect() {}, strokeRect() {}, save() {}, restore() {}, translate() {}, scale() {}, stroke() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  return { width: 0, height: 0, getContext: () => cx, toBlob: (cb, type) => cb(noBlob ? null : new Blob([CANVAS_BYTES], { type })) };
}
let VERSE_SHARE_TEXT = null;
function realVerseShareText() {
  if (VERSE_SHARE_TEXT) return VERSE_SHARE_TEXT;
  const { React } = miniReact();
  const noop = () => {};
  VERSE_SHARE_TEXT = loadScreen('app/app.jsx', ['verseShareText'], {
    React, window: {}, TrinityErrorBoundary: noop, ReactDOM: { createRoot: () => ({ render() {} }) }, document: { getElementById: () => null },
  }).verseShareText;
  return VERSE_SHARE_TEXT;
}
function verseCard({ cap = null, browser = fakeBrowser(), noBlob = false, fontsHang = false, verse = VERSE } = {}) {
  const { React, draw } = miniReact();
  const toasts = [], textShares = [], drawn = [], canvases = [];
  const win = { Capacitor: cap ? cap.Capacitor : undefined, Fellowship: { relays: ['wss://relay.example.org/relay'] } };
  // fontsHang: the font never finishes loading; then only the 2.5s timer lets the drawing go on — so the timer
  // here fires at once, and it is the ONLY timer that does (the download's 60s revoke is not run)
  const document = { ...browser.document, fonts: { load: fontsHang ? () => new Promise(() => {}) : async () => [] },
    createElement: (tag) => { if (tag !== 'canvas') return browser.document.createElement(tag); const c = fakeCanvas(drawn, { noBlob }); canvases.push(c); return c; } };
  const timers = [];
  const S = loadScreen('app/share-app.jsx', ['ShareCard', 'shareOneFile'], {
    React, window: win, btoa, File, Blob, fetch: apkFetch(), console: { warn() {}, log() {}, error() {} },
    navigator: browser.navigator, document, URL: browser.URL,
    setTimeout: (fn, ms) => { timers.push(ms); if (fontsHang && ms === 2500) Promise.resolve().then(fn); return 0; },
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, onClick, title }) => React.createElement('button', { 'data-iconbtn': name, onClick, title }),
    Overlay: ({ open, children }) => (open ? children : null), BottomSheet: () => null,
    verseShareText: realVerseShareText(),
  });
  const ctx = { toast: (t) => toasts.push(t), shareText: async (...a) => { textShares.push(a); } };
  const tree = (props = {}) => draw(S.ShareCard, { verse, open: true, onClose() {}, ctx, ...props });
  const buttons = () => {
    const t = tree();
    const main = find(t, n => n.type === 'button' && !n.props['data-iconbtn'] && texts(n).join(' ').includes('Share this verse'));
    const icon = find(t, n => n.type === 'button' && n.props['data-iconbtn'] === 'share');
    assert.equal(main.length, 1, 'no single "Share this verse" button on the card — re-anchor this test');
    assert.equal(icon.length, 1, 'no share icon in the card header — re-anchor this test');
    return { main: main[0], icon: icon[0] };
  };
  // let the drawing the card starts on open finish, and redraw so the button holds it
  const settle = async () => { tree(); await ticks(); tree(); };
  return { S, toasts, textShares, drawn, canvases, timers, buttons, tree, settle, win };
}
const noLink = (o) => { const s = JSON.stringify(o); return !/https?:|wss?:|\/v\?|relay\.example/i.test(s); };

test('C1 — "Share as image" (both buttons) sends ONE .png — the drawn card — with the verse words beside it, and NO link', async () => {
  for (const which of ['main', 'icon']) {
    const cap = fakeCapacitor();
    const v = verseCard({ cap });
    await v.buttons()[which].props.onClick();
    assert.equal(cap.shares.length, 1, `${which}: Share.share was called ${cap.shares.length} times`);
    const s = cap.shares[0];
    assert.ok(Array.isArray(s.files) && s.files.length === 1, `${which}: the share carried ${JSON.stringify(s.files)} — not exactly one file`);
    assert.match(s.files[0], /\.png$/, `${which}: the shared file is not a .png`);
    assert.equal(cap.writes.length, 1, `${which}: expected one file written`);
    assert.match(cap.writes[0].path, /\.png$/);
    assert.deepEqual([...cap.writes[0].bytes], [...CANVAS_BYTES], `${which}: the file shared is not the picture the canvas made`);
    assert.deepEqual([...cap.writes[0].bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
    assert.equal(typeof s.text, 'string', `${which}: the verse words are not beside the picture`);
    assert.ok(s.text.includes(VERSE.text) && s.text.includes(VERSE.ref), `${which}: the text beside the picture is ${JSON.stringify(s.text)}`);
    assert.equal(s.url, undefined, `${which}: a url went with the picture — that brings back the website preview`);
    const { files, ...rest } = s;
    assert.ok(noLink(rest), `${which}: a link is in the share: ${JSON.stringify(rest)}`);
    assert.deepEqual(v.textShares, [], `${which}: the old text share also ran`);
    const onCard = v.drawn.join(' ');
    assert.ok(onCard.includes('John 3:16') && onCard.includes('WEB'), `${which}: the reference is not drawn on the card: ${onCard}`);
    for (const w of ['loved', 'world', 'only', 'Son.']) assert.ok(onCard.includes(w), `${which}: "${w}" is not drawn on the card`);
    assert.deepEqual(v.toasts, []);
  }
});

test('C2 — on the web the picture goes to navigator.share as ONE image/png File, with the words and no link', async () => {
  const browser = fakeBrowser();
  const v = verseCard({ browser });
  await v.buttons().main.props.onClick();
  assert.equal(browser.shared.length, 1, 'navigator.share was not called once');
  const d = browser.shared[0];
  assert.equal(d.files.length, 1);
  assert.equal(d.files[0].type, 'image/png');
  assert.match(d.files[0].name, /\.png$/);
  assert.deepEqual([...new Uint8Array(await d.files[0].arrayBuffer())], [...CANVAS_BYTES], 'the File is not the picture the canvas made');
  assert.ok(typeof d.text === 'string' && d.text.includes(VERSE.text) && d.text.includes(VERSE.ref), `the words are not beside the picture: ${JSON.stringify(d.text)}`);
  assert.equal(d.url, undefined, 'a url went with the picture');
  const { files, ...rest } = d;
  assert.ok(noLink(rest), `a link is in the share: ${JSON.stringify(rest)}`);
});

test('C3 — a browser that cannot share files downloads the .png instead', async () => {
  const browser = fakeBrowser({ canShare: false });
  const v = verseCard({ browser });
  await v.buttons().main.props.onClick();
  assert.equal(browser.shared.length, 0);
  assert.equal(browser.clicked.length, 1, 'nothing was downloaded');
  assert.match(browser.clicked[0].download, /\.png$/);
  assert.equal(v.toasts.length, 1);
  assert.match(v.toasts[0], /words were not included/, `a download that drops the words must say so: ${v.toasts[0]}`);
});

test('C4 — if the picture cannot be made, the words alone go (still no link) and the member is told', async () => {
  const cap = fakeCapacitor();
  const v = verseCard({ cap, noBlob: true });
  await v.buttons().main.props.onClick();
  assert.equal(cap.shares.length, 0, 'a share went out with no picture to send');
  assert.equal(v.textShares.length, 1, 'the words were not shared');
  assert.ok(v.textShares[0][0].includes(VERSE.text));
  assert.ok(noLink(v.textShares[0]), `a link went with the words: ${JSON.stringify(v.textShares[0])}`);
  assert.equal(v.toasts.length, 1, 'the member was not told the picture failed');
});

// ═════════════════════ C, audit of b96d7c02 (2026-11-16): LOW 1-4 and the NITs ═════════════════════════════

test('C5 (LOW 1) — a verse card never deletes a module copy a transfer may still be reading, and a module share never deletes the card', async () => {
  const cap = fakeCapacitor();
  const v = verseCard({ cap });
  await v.S.shareOneFile({ bytes: new Uint8Array([1, 2, 3]), filename: 'eng-kjv.zip', title: 'KJV' }, {});   // what InstalledBrowser calls
  await v.buttons().main.props.onClick();
  await ticks();
  assert.equal(cap.shares.length, 2, 're-anchor: both shares should have opened');
  assert.deepEqual(cap.deletes, [], `the verse card share deleted ${JSON.stringify(cap.deletes)} — a Bluetooth transfer of the Bible may be cut short`);
  await v.S.shareOneFile({ bytes: new Uint8Array([4, 5]), filename: 'eng-web.zip', title: 'WEB' }, {});
  await ticks();
  assert.deepEqual(cap.deletes, [['eng-kjv.zip', 'CACHE']], 'a module share must clear the previous MODULE copy (unchanged) and nothing else');
});

test('C6 (LOW 3) — with no text, the web path is exactly as before: canShare({files}) then share({files, title}), no text key', async () => {
  const browser = fakeBrowser();
  const asked = [];
  const can = browser.navigator.canShare;
  browser.navigator.canShare = (d) => { asked.push(Object.keys(d).sort()); return can(d); };
  const v = verseCard({ browser });
  await v.S.shareOneFile({ bytes: new Uint8Array([1, 2, 3]), filename: 'eng-kjv.zip', title: 'KJV' }, { toast() {} });
  assert.deepEqual(asked, [['files']], `canShare was asked ${JSON.stringify(asked)}`);
  assert.equal(browser.shared.length, 1);
  assert.deepEqual(Object.keys(browser.shared[0]).sort(), ['files', 'title'], `the module share carried ${JSON.stringify(Object.keys(browser.shared[0]))}`);
  // and an EMPTY text is no text
  await v.S.shareOneFile({ bytes: new Uint8Array([1]), filename: 'x.zip', title: 'X', text: '' }, { toast() {} });
  assert.deepEqual(Object.keys(browser.shared[1]).sort(), ['files', 'title'], 'text: "" put a text key on the share');
});

test('C7 (LOW 2) — the picture is drawn when the card opens, so the tap reaches navigator.share with nothing awaited first', async () => {
  const browser = fakeBrowser();
  const v = verseCard({ browser });
  await v.settle();
  assert.equal(v.canvases.length, 1, 'the card did not draw its picture on opening');
  const done = v.buttons().main.props.onClick();     // NOT awaited: a browser allows share() only close to the tap
  assert.equal(browser.shared.length, 1, 'navigator.share was not called synchronously from the tap — the browser may refuse it');
  await done;
  assert.equal(v.canvases.length, 1, 'the tap drew the card again instead of using the one drawn on opening');
  // a new style draws a new picture, and the tap uses THAT one
  const t = v.tree();
  const swatches = find(t, n => n.type === 'button' && !n.props['data-iconbtn'] && !texts(n).join(' ').includes('Share'));
  assert.ok(swatches.length >= 2, 're-anchor: the style swatches are not buttons');
  swatches[1].props.onClick();
  await v.settle();
  assert.equal(v.canvases.length, 2, 'changing the style did not draw a new picture');
});

test('C8 (LOW 2) — a browser that refuses the share (NotAllowedError) says "tap Share again", and does not quietly download', async () => {
  const browser = fakeBrowser({ shareRejects: 'NotAllowedError' });
  const v = verseCard({ browser });
  await v.settle();
  await v.buttons().main.props.onClick();
  assert.equal(browser.clicked.length, 0, 'a refused share fell back to a download that drops the words');
  assert.equal(v.toasts.length, 1);
  assert.match(v.toasts[0], /tap Share again/);
});

test('C9 (LOW 4) — a font that never loads does not stop the share: after the wait the card is drawn anyway', async () => {
  const cap = fakeCapacitor();
  const v = verseCard({ cap, fontsHang: true });
  await v.buttons().main.props.onClick();
  assert.ok(v.timers.includes(2500), 're-anchor: the font wait is not a 2.5s timer');
  assert.equal(cap.shares.length, 1, 'with a font that never loads, nothing was shared');
  assert.match(cap.shares[0].files[0], /\.png$/);
});

test('C10 (LOW 4) — two taps while "Preparing…" share once', async () => {
  const cap = fakeCapacitor();
  const v = verseCard({ cap });
  const b = v.buttons().main;
  await Promise.all([b.props.onClick(), b.props.onClick()]);
  assert.equal(cap.shares.length, 1, `two taps shared ${cap.shares.length} times`);
});

test('C11 (NIT) — closing the card while the picture is still being drawn opens no share sheet', async () => {
  const cap = fakeCapacitor();
  const v = verseCard({ cap });
  const p = v.buttons().main.props.onClick();     // nothing drawn yet: the tap draws it
  v.tree({ verse: null, open: false });           // the member closes the card (App sets share to null)
  await p;
  assert.equal(cap.shares.length, 0, 'the share sheet opened over a card the member had closed');
});

test('C12 (NIT) — the share title (Android EXTRA_SUBJECT, an email subject) is the reference', async () => {
  const cap = fakeCapacitor();
  const v = verseCard({ cap });
  await v.buttons().main.props.onClick();
  assert.equal(cap.shares[0].title, 'John 3:16');
});

// ═════════════════ C, bug 1 (2026-11-16): "Add thoughts" reaches the card and the shared text ═════════════════
// The thoughts typed in VerseShareSheet used to go to a group or a DM but were dropped by "Share as image". This
// types them into the REAL VerseShareSheet (app/screens-chat.jsx), presses its real "Share as image" button, hands
// what that button gave ctx.openShare to the REAL ShareCard (as App does — scripts/the-app-mounts-the-share-card
// proves App passes it through unchanged), presses Share, and finds the thoughts both drawn on the card (the fake
// canvas's fillText) and in the text shared beside the picture.
function verseSheet(payloadExtra = {}) {
  const { React, draw } = miniReact();
  const opened = [];
  const mod = loadScreen('app/screens-chat.jsx', ['VerseShareSheet'], {
    React, window: { Fellowship: null, TrinityData: { GROUPS: [], RELAYS: [] }, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-16',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ open, children }) => (open ? children : null), ScreenScroll: ({ children }) => children, ChurchPill: () => null,
    UserAvatar: () => null, SectionLabel: ({ children }) => children, BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
  });
  let closed = 0;
  const ctx = { toast() {}, church: null, openShare: (p) => opened.push(p) };
  const payload = { type: 'verse', ...VERSE, ...payloadExtra };
  const render = () => draw(mod.VerseShareSheet, { payload, open: true, onClose: () => { closed++; }, ctx });
  return { render, opened, closed: () => closed };
}
const THOUGHTS = 'This carried me through a hard March.';

test('C13 (bug 1) — thoughts typed in the share sheet are drawn on the card and go in the text beside it', async () => {
  const sh = verseSheet();
  let tree = sh.render();
  const box = find(tree, n => n.type === 'textarea');
  assert.equal(box.length, 1, 're-anchor: no "Add thoughts" box on the share sheet');
  box[0].props.onChange({ target: { value: '  ' + THOUGHTS + '  ' } });
  tree = sh.render();
  const asImage = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Share as image'));
  assert.equal(asImage.length, 1, 're-anchor: no "Share as image" button');
  asImage[0].props.onClick();
  assert.equal(sh.closed(), 1, 'the sheet did not close');
  assert.equal(sh.opened.length, 1, '"Share as image" did not open the card');
  assert.equal(sh.opened[0].shareThoughts, THOUGHTS, `the card was opened without the thoughts: ${JSON.stringify(sh.opened[0])}`);

  const cap = fakeCapacitor();
  const v = verseCard({ cap, verse: sh.opened[0] });
  await v.settle();
  await v.buttons().main.props.onClick();
  assert.equal(cap.shares.length, 1);
  const s = cap.shares[0];
  assert.match(s.files[0], /\.png$/);
  assert.ok(s.text.includes(VERSE.text) && s.text.includes(VERSE.ref), 'the verse is not in the shared text');
  assert.ok(s.text.endsWith('\n\n' + THOUGHTS), `the thoughts are not under the verse in the shared text: ${JSON.stringify(s.text)}`);
  const onCard = v.drawn.join(' ');
  for (const w of ['carried', 'hard', 'March.']) assert.ok(onCard.includes(w), `"${w}" (the thoughts) is not drawn on the card`);
  const { files, ...rest } = s;
  assert.ok(noLink(rest), 'a link went with the picture');
});

test('C14 (bug 1) — with no thoughts the card opens with the payload as it was, and nothing extra is shared', async () => {
  const sh = verseSheet();
  const tree = sh.render();
  find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Share as image'))[0].props.onClick();
  assert.equal(sh.opened[0].shareThoughts, '', 'with no thoughts typed, shareThoughts must be empty (and set, so nothing else stands in for it)');
  const cap = fakeCapacitor();
  const v = verseCard({ cap, verse: sh.opened[0] });
  await v.buttons().main.props.onClick();
  assert.equal(cap.shares[0].text, realVerseShareText()(VERSE), 'with no thoughts the shared text is not just the verse');
});

// ═══════ C, audit of c8334475 (MEDIUM): someone else's thoughts never leave the app on "Share as image" ═══════
// A RECEIVED chat verse carries the SENDER's thoughts as `comment` (evtToMsg keeps the whole event payload). The chat
// bubble opens "Share as image" on tap. Two defences, each tested on its own: the bubble passes only ref/text/version,
// and ShareCard reads thoughts ONLY from `shareThoughts`, which only VerseShareSheet's button sets.
const SENDERS = 'Mum does not know I go to youth group — please keep this between us.';
function chatBubble() {
  const { React, draw } = miniReact();
  const opened = [];
  const mod = loadScreen('app/screens-chat.jsx', ['Bubble'], {
    React, window: { Fellowship: null, TrinityData: { GROUPS: [], RELAYS: [] }, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-16',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ open, children }) => (open ? children : null), ScreenScroll: ({ children }) => children, ChurchPill: () => null,
    UserAvatar: () => null, SectionLabel: ({ children }) => children, BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = { toast() {}, openShare: (p) => opened.push(p), openDM() {}, openPeople() {}, safeguard: { isMinor: false } };
  const m = { id: 'e1', kind: 'verse', me: false, who: 'Anna', pubkey: 'aa'.repeat(32), ts: 1, time: 'now',
    verse: { ref: VERSE.ref, text: VERSE.text, version: VERSE.version, comment: SENDERS, shareThoughts: SENDERS } };
  const tree = draw(mod.Bubble, { m, ctx, summary: [], onReact() {}, live: true });
  return { tree, opened };
}

test('C15 (MEDIUM) — tapping a RECEIVED verse bubble opens the card with the verse only, never the sender\'s thoughts', async () => {
  const b = chatBubble();
  assert.ok(texts(b.tree).join(' ').includes(SENDERS), 're-anchor: the bubble does not show the sender\'s thoughts, so this proves nothing');
  const tappable = find(b.tree, n => typeof n.props.onClick === 'function' && texts(n).join(' ').includes('SHARED A VERSE'));
  assert.ok(tappable.length >= 1, 're-anchor: no tappable verse bubble');
  tappable[tappable.length - 1].props.onClick();
  assert.equal(b.opened.length, 1, 'the bubble did not open "Share as image"');
  assert.deepEqual(Object.keys(b.opened[0]).sort(), ['ref', 'text', 'version'], `the bubble passed ${JSON.stringify(b.opened[0])}`);
  const cap = fakeCapacitor();
  const v = verseCard({ cap, verse: b.opened[0] });
  await v.settle();
  await v.buttons().main.props.onClick();
  assert.equal(cap.shares.length, 1);
  assert.ok(!cap.shares[0].text.includes('youth group'), 'the sender\'s thoughts went out in the shared text');
  assert.ok(!v.drawn.join(' ').includes('youth group'), 'the sender\'s thoughts were drawn on the card');
});

test('C16 (MEDIUM) — ShareCard ignores a `comment` it is handed: only shareThoughts is drawn or sent', async () => {
  const cap = fakeCapacitor();
  const v = verseCard({ cap, verse: { ...VERSE, comment: SENDERS } });
  await v.settle();
  await v.buttons().main.props.onClick();
  assert.equal(cap.shares[0].text, realVerseShareText()(VERSE), `a stray comment reached the shared text: ${JSON.stringify(cap.shares[0].text)}`);
  assert.ok(!v.drawn.join(' ').includes('youth group'), 'a stray comment was drawn on the card');
  // and the share sheet overwrites any shareThoughts a payload arrived with
  const sh = verseSheet({ shareThoughts: SENDERS });
  find(sh.render(), n => n.type === 'button' && texts(n).join(' ').includes('Share as image'))[0].props.onClick();
  assert.equal(sh.opened[0].shareThoughts, '', 'a shareThoughts the payload arrived with survived the sheet');
});
