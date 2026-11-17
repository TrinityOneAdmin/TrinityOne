// INSTALL A BIBLE FROM A FILE — THE SCREENS (the button, the sheet, the mount, the Android listener).
// Run: node --test scripts/install-bible-from-file-screens.test.mjs
//
// The engine half is install-bible-from-file-engine.test.mjs; the Android manifest and the Console strip are
// install-bible-from-file-manifest.test.mjs. THIS FILE IS CLAUDE.md RULE 1: every test here fails if the feature is
// deleted FROM THE SCREEN, not only if the engine behind it is broken.
//   · the REAL App() from app/app.jsx (scripts/app-screens.mjs loads every script index.html lists, so a global
//     collision or a missing script tag shows up here too) is drawn, and the sheet is found IN ITS TREE;
//   · the REAL ModuleStore / StoreRow / VersionSheet from app/screens-library.jsx and app/screens-read.jsx, drawn
//     through scripts/render-jsx-screen.mjs and driven by pressing their buttons;
//   · the REAL InstallFromFileSheet, handleIncomingFile and ifsRunInstall from app/install-bible.jsx;
//   · and for one test, the REAL engine.js (scripts/install-bible-harness.mjs): its real pickFile result lands on the
//     sheet in the real App.
// Rule 3: nothing here matches text in app/*.jsx. A sabotage that puts `false &&` in front of something leaves its
// words in the file and this still goes red, because what is read is the rendered tree.
// FAKED, and named: the Capacitor App plugin (it records its listeners and lets a test fire them), fetch for the
// content:// read, Capacitor.Plugins.Filesystem (a spy that must never be called), and window.Bible in the App tests
// (except where the real engine is plugged in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find, texts as rtexts } from './render-jsx-screen.mjs';
import { fakeReact, appBrowser, loadApp, nodes, texts } from './app-screens.mjs';
import { phone, until, bibleDb, ROOT } from './install-bible-harness.mjs';

const CATALOG = JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8'));
const tick = (n = 6) => (async () => { for (let i = 0; i < n; i++) await Promise.resolve(); })();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const plain = (x) => JSON.parse(JSON.stringify(x));   // the App runs in a vm: its objects carry another realm's prototypes

// ════════════════════════════════ A. the Library button, and the devotional row ════════════════════════════════

function store({ category = null, view = 'featured' } = {}) {
  const { React, draw } = miniReact();
  const calls = { pick: 0 };
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = {
    Bible: {
      subscribe: () => () => {}, getCatalog: async () => CATALOG, getMirror: async () => null, pickFile: () => { calls.pick++; },
      isInstalling: () => false, isInstalled: () => false, isLoaded: () => false, installedMap: () => ({}), versions: () => [], installModule: async () => ({}),
    },
    TrinityData: {}, addEventListener() {}, removeEventListener() {},
  };
  const S = loadScreen('app/screens-library.jsx', ['ModuleStore'], {
    React, window: win, Icon, document: { addEventListener() {}, removeEventListener() {} },
    Overlay: ({ open, children }) => (open ? children : null),
    IconBtn: ({ name, onClick }) => React.createElement('button', { 'data-iconbtn': name, onClick }),
    SectionLabel: ({ children }) => React.createElement('h3', {}, children),
    Chip: ({ children }) => React.createElement('span', {}, children),
    ScreenScroll: (p) => p.children, safeCssColor: (c) => c || 'var(--clay)',
  });
  const props = { open: true, onClose() {}, ctx: { toast() {} }, category, initialView: view };
  return { calls, draw: async () => { draw(S.ModuleStore, props); await tick(); return draw(S.ModuleStore, props); } };
}
const pressable = (tree, label) => find(tree, n => n.type === 'button' && rtexts(n).join(' ').includes(label));

// The owner chose option A (2026-11-17): the big card above the tabs is replaced by ONE quiet line under them, on every category and tab.
const LINK = { bibles: 'Have a Bible file? Install it', dictionaries: 'Have a file? Install it', commentaries: 'Have a file? Install it', none: 'Have a file? Install it' };
const linkOf = (tree) => pressable(tree, 'Install it');
const wordsOf = (btn) => find(btn, n => n.type === 'span').map(n => rtexts(n).join('')).join('').trim();   // the words, not the icon's drawing

test('S1 — the quiet "Have a … file? Install it" line is on every category and every tab with the right words, and pressing it opens the file picker', async () => {
  for (const category of [null, 'bibles', 'dictionaries', 'commentaries']) {
    for (const view of (category === 'bibles' || category === null) ? ['featured', 'language', 'installed'] : ['featured', 'installed']) {
      const s = store({ category, view });
      const tree = await s.draw();
      const btn = linkOf(tree);
      const where = `category ${category}, tab ${view}`;
      assert.equal(btn.length, 1, `${where}: the link is not on the Library screen`);
      const want = (category === null && view === 'language') ? LINK.bibles : LINK[category || 'none'];   // no category + All bibles tab shows only Bibles (round 2, N2)
      assert.equal(wordsOf(btn[0]), want, `${where}: wrong words`);
      assert.equal(s.calls.pick, 0, 'the picker opened before anyone pressed anything');
      btn[0].props.onClick();
      assert.equal(s.calls.pick, 1, `${where}: pressing the link did not reach Bible.pickFile`);
    }
  }
});

test('S1b — it is a real button, 44 px to tap, sits UNDER the tabs, and the old big card is gone', async () => {
  const tree = await store({ category: 'bibles' }).draw();
  const all = rtexts(tree).join(' | ');
  assert.doesNotMatch(all, /Install a Bible from a file|Got one over Signal/, 'the old big card is still on the page');
  const btn = linkOf(tree)[0];
  assert.equal(btn.type, 'button', 'the link is not a real button');
  assert.ok(parseInt(btn.props.style.minHeight, 10) >= 44, 'tap height under 44: ' + btn.props.style.minHeight);
  assert.ok(!/\d/.test(String(btn.props.style.width || '')) || /%/.test(String(btn.props.style.width)), 'a fixed width could overflow a 320 px phone');
  // order in the drawn page: the tab buttons first, then the link
  const order = find(tree, n => n.type === 'button').map(n => (n.props['data-install-from-file'] !== undefined ? wordsOf(n) : rtexts(n).join('').trim()));
  const iTab = order.findIndex(t => /Featured$/.test(t)), iLink = order.indexOf('Have a Bible file? Install it');
  assert.ok(iTab >= 0 && iLink > iTab, 'the link is not under the tabs: ' + order.slice(0, 8));
  // the segmented tabs still work and the link is on every one of them (checked in S1)
  assert.ok(order.some(t => /All bibles$/.test(t)) && order.some(t => /Installed$/.test(t)));
});

test('S2 — the devotional import row is hidden (with its section); the dictionary, commentary and cross-reference import rows stay', async () => {
  const s = store();
  const all = rtexts(await s.draw()).join(' | ');
  assert.doesNotMatch(all, /Import a devotional/, 'the dead devotional import row is still offered');
  assert.doesNotMatch(all, /Devotionals/, 'an empty Devotionals section is still shown');
  for (const keep of ['Import a dictionary', 'Import a commentary', 'Import cross-references']) assert.match(all, new RegExp(keep), `${keep} disappeared`);
  // the control: the catalogue really does carry the row, so hiding is the screen's doing, not the data's
  assert.ok(CATALOG.categories.some(c => (c.items || []).some(i => i.id === 'import-dvt')), 'the catalogue no longer has the devotional row — this test proves nothing');
  // the catalogue import row is still wired to the picker
  const rowBtn = pressable(await s.draw(), 'Import').filter(b => b.props.onClick);
  assert.equal(rowBtn.length, 3, 'expected exactly the dictionary, commentary and cross-reference Import buttons, got ' + rowBtn.length);
  rowBtn[0].props.onClick();
  assert.equal(s.calls.pick, 1, 'a catalogue import row no longer reaches Bible.pickFile');
});

// ════════════════════════════════ B. the sheet itself ═══════════════════════════════════════════════════════════

function sheet() {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const store = new Map();
  const win = { Bible: { setActive: (a) => { win.set.push(a); } }, set: [] };
  const mod = loadScreen('app/install-bible.jsx', ['InstallFromFileSheet', 'handleIncomingFile', 'ifsRunInstall', 'ifsReadContent'], {
    React, window: win, Icon, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', { 'data-sheet': true }, children) : null),
    Spinner: () => React.createElement('i', { 'data-spin': true }), fetch: async () => { throw new Error('no fetch here'); },
  });
  const log = { closed: 0, installs: 0, go: [], store: [] };
  const ctx = { go: (t) => log.go.push(t), closeStore: () => log.store.push('closed'), openStore: (...a) => log.store.push(a) };
  const render = (state) => draw(mod.InstallFromFileSheet, { state, onInstall: () => { log.installs++; }, onClose: () => { log.closed++; }, ctx });
  return { win, log, render, mod };
}
const words = (tree) => rtexts(tree).join(' | ');

test('S3 — CONFIRM shows no file name, size or type, and nothing is installed until the Install button is pressed', () => {
  const s = sheet();
  const tree = s.render({ phase: 'confirm', url: 'content://media/external/file/BSB-bible.zip' });
  const w = words(tree);
  assert.match(w, /Install this file\?/);
  assert.doesNotMatch(w, /BSB|\.zip|content:|MB|KB|USFM|mybible/i, 'the confirm step shows something about the file: ' + w);
  assert.equal(s.log.installs, 0);
  pressable(tree, 'Not now')[0].props.onClick();
  assert.equal(s.log.closed, 1); assert.equal(s.log.installs, 0, '"Not now" installed the file');
  pressable(tree, 'Install')[0].props.onClick();
  assert.equal(s.log.installs, 1, 'the Install button does not start the install');
});

test('S4 — the result screens name the KIND, and "already here", "name taken", too big, no room and "cannot use" each say their own thing', () => {
  const s = sheet();
  const w = (state) => words(s.render(state));
  assert.match(w({ phase: 'result', result: { ok: true, kind: 'bible', abbr: 'X', name: 'Berean Standard Bible' } }), /Bible installed.*Berean Standard Bible/);
  assert.match(w({ phase: 'result', result: { ok: true, kind: 'comment', abbr: 'X', name: 'Henry' } }), /Commentary installed/);
  assert.match(w({ phase: 'result', result: { ok: true, kind: 'dict', abbr: 'X', name: 'Easton' } }), /Dictionary installed/);
  assert.match(w({ phase: 'result', result: { ok: true, kind: 'crossref', abbr: 'X', name: 'TSK' } }), /Cross-references installed/);
  const same = w({ phase: 'result', result: { ok: true, already: true, kind: 'bible', abbr: 'BSB', name: 'Berean Standard Bible' } });
  assert.match(same, /You already have this Bible/); assert.match(same, /Nothing was changed/);
  const renamed = w({ phase: 'result', result: { ok: true, renamed: true, kind: 'bible', abbr: 'K-F', name: 'King James Version (from a file)' } });
  assert.match(renamed, /King James Version \(from a file\)/); assert.match(renamed, /different Bible with this name/);
  assert.match(w({ phase: 'result', result: { ok: false, reason: 'too-big' } }), /too big.*50 MB/);
  assert.match(w({ phase: 'result', result: { ok: false, reason: 'no-space' } }), /Not enough room/);
  assert.match(w({ phase: 'result', result: { ok: false, reason: 'unreadable' } }), /couldn.t read that file/);
  const bad = w({ phase: 'result', result: { ok: false, reason: 'unusable' } });
  assert.match(bad, /can.t use this file/); assert.match(bad, /Nothing was installed/); assert.doesNotMatch(bad, /Error|Exception|undefined/);
  assert.match(bad, /How do I get a Bible\?/);
  // Read it now: makes the new Bible the active one and goes to the reader
  const tree = s.render({ phase: 'result', result: { ok: true, kind: 'bible', abbr: 'NEW', name: 'New Bible' } });
  pressable(tree, 'Read it now')[0].props.onClick();
  assert.deepEqual(s.win.set, ['NEW']); assert.deepEqual(s.log.go, ['read']);
});

test('S5 — THE MODULE NAME IS PLAIN TEXT: markup in a name is a text node, never an element, never dangerouslySetInnerHTML', () => {
  const s = sheet();
  const evil = '<img src=x onerror=alert(1)>';
  const tree = s.render({ phase: 'result', result: { ok: true, kind: 'bible', abbr: 'E', name: evil } });
  assert.ok(rtexts(tree).includes(evil), 'the name is not on the screen at all');
  assert.equal(find(tree, n => n.type === 'img').length, 0, 'a name created an <img> element');
  assert.equal(find(tree, n => n.props && n.props.dangerouslySetInnerHTML).length, 0, 'the sheet renders HTML from a stranger\'s file');
  // and the node that holds it carries it as a string child
  const holder = find(tree, n => n.type === 'div' && (n.kids || []).includes(evil));
  assert.equal(holder.length, 1, 'the name is not a plain string child of one element');
});

test('S6 — WHILE INSTALLING the sheet cannot be dismissed (there is no cancel in v1) and shows no buttons', () => {
  const s = sheet();
  const tree = s.render({ phase: 'installing' });
  assert.match(words(tree), /Installing/);
  assert.equal(find(tree, n => n.type === 'button').length, 0);
});

// ═══════════════════ C. the incoming file: URL rules, the tap, the streaming read, the marker ═══════════════════

function incoming({ fetchImpl, filesystemSpy = [] } = {}) {
  const { React } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const store = new Map();
  const bibleCalls = [];
  const win = {
    Bible: { installFromBytes: async (u8, hint) => { bibleCalls.push([u8, hint]); return { ok: true, kind: 'bible', abbr: 'X', name: 'Got It' }; } },
    Capacitor: { convertFileSrc: (u) => 'https://localhost/_capacitor_content_/' + encodeURIComponent(u), Plugins: { Filesystem: { readFile: async () => { filesystemSpy.push('readFile'); return { data: '' }; } } } },
  };
  const mod = loadScreen('app/install-bible.jsx', ['handleIncomingFile', 'ifsRunInstall', 'ifsReadContent'], {
    React, window: win, Icon, BottomSheet: () => null, Spinner: () => null,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    fetch: fetchImpl || (async () => { throw new Error('no fetch'); }),
  });
  return { mod, store, bibleCalls, filesystemSpy };
}

test('S7 — INCOMING URL RULES: content:// opens the confirm step and touches nothing; https, file:, http: and javascript: are ignored', () => {
  const i = incoming(); const shown = [];
  const show = (s) => shown.push(s);
  assert.equal(i.mod.handleIncomingFile('content://com.android.providers.downloads.documents/document/12', false, show), 'shown');
  assert.deepEqual(shown, [{ phase: 'confirm', url: 'content://com.android.providers.downloads.documents/document/12' }]);
  assert.equal(i.bibleCalls.length, 0, 'the engine was touched before the tap');
  for (const url of ['https://app.trinityone.church/join?follow=npub1abc', 'file:///sdcard/Download/x.zip', 'http://evil.tld/x.zip', 'javascript:alert(1)', 'intent://x', '', null, undefined, 42]) {
    assert.notEqual(i.mod.handleIncomingFile(url, false, show), 'shown', `${url} opened the sheet`);
  }
  assert.equal(shown.length, 1);
});

test('S8 — RELAUNCH FROM RECENTS: the same launch URL re-delivered after a reload does not reopen the sheet (marker in localStorage); a live tap on the same file still does', () => {
  const url = 'content://media/external/file/77';
  const a = incoming(); const shown1 = [];
  assert.equal(a.mod.handleIncomingFile(url, true, s => shown1.push(s)), 'shown', 'the first cold start must show the sheet');
  assert.ok([...a.store.keys()].includes('trinityone.handledFiles'), 'the marker is not in localStorage');
  assert.doesNotMatch([...a.store.values()].join(''), /content:/, 'the marker stores the URL itself');
  // "reload": a fresh page with the SAME localStorage
  const b = incoming(); a.store.forEach((v, k) => b.store.set(k, v));
  const shown2 = [];
  assert.equal(b.mod.handleIncomingFile(url, true, s => shown2.push(s)), 'handled');
  assert.deepEqual(shown2, [], 'the old intent reopened the sheet');
  assert.equal(b.mod.handleIncomingFile(url, false, s => shown2.push(s)), 'shown', 'a live tap on the same file was swallowed');
});

// 'forever' is 80 MB here (80 reads of 1 MB), so a reader with no cap ends instead of eating the box
function streamOf(chunks, { forever = false, state = {} } = {}) {
  let i = 0;
  return { ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => ({
    read: async () => { state.reads = (state.reads || 0) + 1; if (forever ? state.reads > 80 : i >= chunks.length) return { done: true }; return { done: false, value: forever ? new Uint8Array(1024 * 1024) : chunks[i++] }; },
    cancel: async () => { state.cancelled = true; } }) } };
}

test('S9 — THE STREAMING READ: bytes arrive through fetch(convertFileSrc) and reach the engine whole; the install is only the tap', async () => {
  let asked = null;
  const i = incoming({ fetchImpl: async (u) => { asked = u; return streamOf([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]); } });
  const shown = [];
  await i.mod.ifsRunInstall('content://x/1', (s) => shown.push(s));
  assert.equal(asked, 'https://localhost/_capacitor_content_/' + encodeURIComponent('content://x/1'), 'the read did not go through convertFileSrc');
  assert.deepEqual(shown.map(s => s.phase), ['installing', 'result']);
  assert.deepEqual([...i.bibleCalls[0][0]], [1, 2, 3, 4, 5]);
  assert.equal(i.bibleCalls[0][1], '', 'a file name was invented for a content:// file');
  assert.equal(shown[1].result.ok, true);
});

test('S10 — A STREAM THAT NEVER ENDS stops at 50 MB and is cancelled; the engine is never called and Filesystem.readFile is never touched', async () => {
  const st = {}; const fsSpy = [];
  const i = incoming({ fetchImpl: async () => streamOf([], { forever: true, state: st }), filesystemSpy: fsSpy });
  const shown = [];
  await i.mod.ifsRunInstall('content://x/2', (s) => shown.push(s));
  assert.deepEqual(shown[1].result, { ok: false, reason: 'too-big' });
  assert.equal(st.cancelled, true, 'the reader was not cancelled');
  assert.ok(st.reads <= 52, `read ${st.reads} MB of an endless stream`);
  assert.equal(i.bibleCalls.length, 0);
  assert.deepEqual(fsSpy, []);
});

test('S11 — A FETCH THAT FAILS says "couldn\'t read that file" and does nothing else: no Filesystem.readFile fallback, no engine call', async () => {
  const fsSpy = [];
  const i = incoming({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, filesystemSpy: fsSpy });
  const shown = [];
  await i.mod.ifsRunInstall('content://x/3', (s) => shown.push(s));
  assert.deepEqual(shown[1].result, { ok: false, reason: 'unreadable' });
  assert.deepEqual(fsSpy, [], 'the whole file was read through the bridge instead');
  assert.equal(i.bibleCalls.length, 0);
  // a 404 and a body-less response are the same story
  for (const res of [{ ok: false, status: 404 }, { ok: true, status: 200, headers: { get: () => null }, body: null }]) {
    const j = incoming({ fetchImpl: async () => res }); const sh = [];
    await j.mod.ifsRunInstall('content://x/4', (s) => sh.push(s));
    assert.equal(sh[1].result.reason, 'unreadable');
  }
  // a declared length over the cap is refused without reading a byte
  const st = {};
  const k = incoming({ fetchImpl: async () => ({ ...streamOf([new Uint8Array(5)], { state: st }), headers: { get: (h) => (h === 'content-length' ? String(80 * 1024 * 1024) : null) } }) });
  const sh2 = []; await k.mod.ifsRunInstall('content://x/5', (s) => sh2.push(s));
  assert.equal(sh2[1].result.reason, 'too-big'); assert.equal(st.reads || 0, 0, 'bytes were read from a stream that declared itself too big');
});

// ═══════════ AUDIT 2026-11-14 (67c49830): L1 marker expiry, N2 own FileProvider, N3 wider hash ═══════════

test('S18 — L1: THE HANDLED MARKER EXPIRES: a file declined or failed this morning can be opened again from a cold start tonight', () => {
  const url = 'content://media/external/file/321';
  const a = incoming(); const first = [];
  assert.equal(a.mod.handleIncomingFile(url, true, s => first.push(s)), 'shown');
  const stored = JSON.parse(a.store.get('trinityone.handledFiles'));
  assert.ok(stored.length === 1 && typeof stored[0].t === 'number');
  // five minutes later (a relaunch from Recents): still swallowed
  const soon = incoming(); soon.store.set('trinityone.handledFiles', JSON.stringify([{ ...stored[0], t: Date.now() - 5 * 60 * 1000 }]));
  assert.equal(soon.mod.handleIncomingFile(url, true, () => {}), 'handled', 'a replay within minutes reopened the sheet');
  // a day later: the marker has lapsed, so a file the member really did open again is shown
  const later = incoming(); later.store.set('trinityone.handledFiles', JSON.stringify([{ ...stored[0], t: Date.now() - 24 * 3600 * 1000 }]));
  const shown = [];
  assert.equal(later.mod.handleIncomingFile(url, true, s => shown.push(s)), 'shown', 'an old marker still hides the file');
  assert.equal(shown.length, 1);
});

test('S19 — N2: A CONTENT URL AIMED AT TRINITYONE\'S OWN FILEPROVIDER is ignored; other apps\' content URLs are not', () => {
  const i = incoming(); const shown = [];
  for (const own of ['content://com.trinityone.app.fileprovider/cache/TrinityOne.apk', 'content://com.trinityone.steward.fileprovider/x', 'content://COM.TRINITYONE.APP.FILEPROVIDER/x'])
    assert.equal(i.mod.handleIncomingFile(own, false, s => shown.push(s)), 'ignored', own + ' was offered for install');
  assert.deepEqual(shown, []);
  for (const other of ['content://org.thoughtcrime.securesms.provider/attachment/1', 'content://com.android.providers.downloads.documents/document/12'])
    assert.equal(i.mod.handleIncomingFile(other, false, s => shown.push(s)), 'shown');
});

test('S20 — N3: TWO URLS THAT COLLIDE UNDER THE OLD 32-BIT HASH are told apart by the marker', () => {
  const djb2 = (u) => { let x = 5381; for (let k = 0; k < u.length; k++) x = ((x << 5) + x + u.charCodeAt(k)) | 0; return x; };
  const seen = new Map(); let pair = null;
  let rng = 123456789; const next = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return rng >>> 0; };
  for (let n = 0; n < 400000 && !pair; n++) { let t = ''; for (let k = 0; k < 10; k++) t += String.fromCharCode(97 + (next() % 26)); const u = 'content://m/' + t; const h = djb2(u); if (seen.has(h) && seen.get(h) !== u) pair = [seen.get(h), u]; else seen.set(h, u); }
  assert.ok(pair, 'no djb2 collision found in 400k URLs');
  const i = incoming(); const shown = [];
  assert.equal(i.mod.handleIncomingFile(pair[0], true, s => shown.push(s)), 'shown');
  assert.equal(i.mod.handleIncomingFile(pair[1], true, s => shown.push(s)), 'shown', 'a different file was taken for the one already handled');
});

test('S21 — L-e: THE QUARANTINE NOTICE: the sheet names the file that was not opened, as plain text, and the real App shows it from the engine\'s event and from the mount-time list', async () => {
  const s = sheet();
  const evil = '<img src=x onerror=alert(1)>';
  const tree = s.render({ phase: 'result', result: { ok: false, reason: 'quarantined', name: evil } });
  const w = words(tree);
  assert.match(w, /stopped|not opened|wasn.t opened/i); assert.match(w, /Library/);
  assert.ok(rtexts(tree).includes(evil), 'the file name is not on the sheet'); assert.equal(find(tree, n => n.type === 'img').length, 0);
  assert.equal(find(tree, n => n.props && n.props.dangerouslySetInnerHTML).length, 0);
  let fire = null;
  const m = boot({ bible: { onFileInstall: (fn) => { fire = fn; return () => {}; }, takeQuarantineNotices: () => [] } });
  await settle(m);
  fire({ phase: 'quarantined', name: 'Old Import' });
  const st = m.sheetProps(m.draw()).state;
  assert.equal(st.phase, 'result'); assert.equal(st.result.reason, 'quarantined'); assert.equal(st.result.name, 'Old Import');
  const m2 = boot({ bible: { onFileInstall: () => () => {}, takeQuarantineNotices: () => ['Boot Found'] } });
  await settle(m2);
  assert.equal(m2.sheetProps(m2.draw()).state.result.name, 'Boot Found');
});

test('S22 — A6: SEVERAL quarantine events in a row accumulate: the sheet names every file, not the last', async () => {
  let fire = null;
  const m = boot({ bible: { onFileInstall: (fn) => { fire = fn; return () => {}; }, takeQuarantineNotices: () => [] } });
  await settle(m);
  fire({ phase: 'quarantined', name: 'First Old' });
  fire({ phase: 'quarantined', name: 'Second Old' });
  const r = m.sheetProps(m.draw()).state.result;
  assert.equal(r.reason, 'quarantined');
  assert.deepEqual(plain(r.names), ['First Old', 'Second Old']);
  const m2 = boot({ bible: { onFileInstall: () => () => {}, takeQuarantineNotices: () => ['One', 'Two', 'Three'] } });
  await settle(m2);
  assert.deepEqual(plain(m2.sheetProps(m2.draw()).state.result.names), ['One', 'Two', 'Three']);
});

test('S23 — A REFUSED ?module= LINK: the sheet says so in plain words, and the real App shows it from the engine\'s event and from the mount-time notice', async () => {
  const s = sheet();
  const tree = s.render({ phase: 'result', result: { ok: false, reason: 'link-refused' } });
  const w = words(tree);
  assert.match(w, /can.t open that link/i); assert.match(w, /nothing was downloaded/i); assert.doesNotMatch(w, /http|module=/i);
  let fire = null;
  const m = boot({ bible: { onFileInstall: (fn) => { fire = fn; return () => {}; }, takeQuarantineNotices: () => [], takeLinkNotice: () => false } });
  await settle(m);
  fire({ phase: 'link-refused' });
  assert.equal(m.sheetProps(m.draw()).state.result.reason, 'link-refused');
  const m2 = boot({ bible: { onFileInstall: () => () => {}, takeQuarantineNotices: () => [], takeLinkNotice: () => true } });
  await settle(m2);
  assert.equal(m2.sheetProps(m2.draw()).state.result.reason, 'link-refused');
});

// ════════════════════════════════ D. the REAL App: mount, listener, picker → sheet ══════════════════════════════

const NPUB = 'npub1' + '0'.repeat(58);
function boot({ bible = {}, capApp = undefined, seedLs = {}, fetchImpl, withFs = [], churchAccent } = {}) {
  const r = fakeReact();
  const env = appBrowser(); const window = env.window;
  for (const [k, v] of Object.entries(seedLs)) window.localStorage.setItem(k, v);
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }),
    versions: () => [], installedMap: () => ({}), ...bible };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  if (capApp) window.Capacitor = { isNativePlatform: () => true, convertFileSrc: (u) => 'https://localhost/_capacitor_content_/' + u, Plugins: { App: capApp, Filesystem: { readFile: async () => { withFs.push('readFile'); } } } };
  if (fetchImpl) window.fetch = fetchImpl;
  const App = loadApp({ React: r.React, window, expr: 'App' });
  window.TrinityData.CHURCHES = [{ id: NPUB, npub: NPUB, name: 'Test Church', ...(churchAccent ? { accent: churchAccent } : {}) }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(NPUB));
  window.localStorage.setItem('trinityone.onboarded', 'true');
  window.Fellowship = new Proxy({ myPubkey: 'dd'.repeat(32), CANONICAL_RELAYS: [], hasRelays: true, toPub: (x) => x, subscribeAmBlocked: (cb) => { cb(false, ''); return () => {}; }, isBlockedChurch: () => false },
    { get: (t, k) => { if (k in t) return t[k]; if (k === 'then' || typeof k === 'symbol') return undefined; return () => () => {}; } });
  const draw = () => { r.reset(); const tree = App(); r.flush(); return tree; };
  const sheetProps = (tree) => { const n = nodes(tree).find(x => x.type === window.InstallFromFileSheet); return n ? n.props : null; };
  return { window, draw, sheetProps };
}
const settle = async (m) => { m.draw(); await sleep(60); m.draw(); return m.draw(); };
// a fake Capacitor App plugin: records every listener and lets a test fire them
function fakeAppPlugin({ launchUrl = null } = {}) {
  const listeners = [];
  return { listeners, getLaunchUrl: async () => (launchUrl ? { url: launchUrl } : null),
    addListener: async (ev, cb) => { listeners.push([ev, cb]); return { remove() {} }; },
    fire: (ev, payload) => listeners.filter(([e]) => e === ev).forEach(([, cb]) => cb(payload)) };
}

test('S12 — THE MOUNT: the real App() puts the install sheet in its tree, closed, in the loaded state AND the first-run state', async () => {
  const loaded = boot();
  const t1 = await settle(loaded);
  assert.ok(loaded.sheetProps(t1), 'the install sheet is not mounted in app.jsx');
  assert.equal(loaded.sheetProps(t1).state, null, 'the sheet is open on a fresh boot');
  const empty = boot({ bible: { loaded: false, loading: false, _error: null } });
  assert.ok(empty.sheetProps(await settle(empty)), 'the sheet is not mounted when no Bible is loaded yet (a first-run phone could never see its own result)');
});

test('S13 — PICKER RESULTS REACH THE SHEET: the engine\'s announcements put "installing" and then the result on it', async () => {
  let fire = null;
  const m = boot({ bible: { onFileInstall: (fn) => { fire = fn; return () => {}; } } });
  await settle(m);
  assert.equal(typeof fire, 'function', 'app.jsx never subscribed to Bible.onFileInstall');
  fire({ phase: 'installing' });
  assert.equal(m.sheetProps(m.draw()).state.phase, 'installing');
  fire({ phase: 'result', result: { ok: true, kind: 'bible', abbr: 'X', name: 'Picked' } });
  const st = m.sheetProps(m.draw()).state;
  assert.equal(st.phase, 'result'); assert.equal(st.result.name, 'Picked');
  m.sheetProps(m.draw()).onClose();
  assert.equal(m.sheetProps(m.draw()).state, null, 'closing the sheet does not close it');
});

test('S14 — END TO END with the REAL engine: a file chosen in the picker lands on the real App\'s sheet as an installed Bible', async () => {
  const p = phone(); await p.boot();
  const m = boot({ bible: { onFileInstall: p.Bible.onFileInstall } });
  await settle(m);
  p.Bible.pickFile();
  const bytes = await bibleDb('E2E', 'End To End Bible');
  const change = p.fakeInput.listeners.change;
  await change({ target: { files: [{ name: 'e2e.bbl.mybible', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }], value: '' } });
  const st = m.sheetProps(m.draw()).state;
  assert.equal(st.phase, 'result'); assert.equal(st.result.ok, true); assert.equal(st.result.name, 'End To End Bible');
  assert.equal(p.Bible.versions().length, 1);
});

test('S15 — EACH PLACE THAT OFFERS A FILE PICKER STILL REACHES Bible.pickFile: the first-run link, the app\'s addModule, the reader\'s "Install a Bible from a file", and the sheet\'s own routes', async () => {
  let picks = 0;
  const m = boot({ bible: { pickFile: () => { picks++; } } });
  const tree = await settle(m);
  // (1) app.jsx ctx.addModule — also what screens-read.jsx's VersionSheet calls after closing itself
  const ctx = nodes(tree).find(x => x.props && x.props.ctx && 'churchNetworks' in x.props.ctx).props.ctx;
  ctx.addModule();
  assert.equal(picks, 1, 'ctx.addModule no longer opens the picker');
  // (2) the first-run link on the empty state
  const env2 = appBrowser(); env2.window.Bible = { pickFile: () => { picks++; } }; env2.window.MyData = m.window.MyData; env2.window.TrinityData = {};
  const EmptyState = loadApp({ React: fakeReact().React, window: env2.window, expr: 'EmptyState' });
  const link = nodes(EmptyState({ loading: false, error: null, onBrowse() {} })).filter(n => n.type === 'button' && texts(n).join(' ').includes('install a Bible from a file'));
  assert.equal(link.length, 1, 'the first-run link is not "install a Bible from a file"');
  link[0].props.onClick();
  assert.equal(picks, 2, 'the first-run link no longer opens the picker');
  // (3) the reader's version sheet button hands control to ctx.addModule (it only carries the prop)
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const rwin = { Bible: { subscribe: () => () => {}, getCatalog: async () => CATALOG, versions: () => [], isInstalled: () => false, isLoaded: () => false, installedMap: () => ({}), removeModule: async () => true } };
  const { VersionSheet } = loadScreen('app/screens-read.jsx', ['VersionSheet'], new Proxy({ React, window: rwin, Icon, BottomSheet: ({ open, children }) => (open ? children : null) }, {
    has: () => false }));
  let added = 0;
  const vt = draw(VersionSheet, { open: true, onClose() {}, version: 'KJV', onPick() {}, onAdd: () => { added++; }, ctx });
  const add = find(vt, n => n.type === 'button' && rtexts(n).join(' ').includes('Install a Bible from a file'));
  assert.equal(add.length, 1, 'the reader\'s version sheet has no "Install a Bible from a file" button');
  add[0].props.onClick();
  assert.equal(added, 1);
});

test('S16 — THE LISTENER: a content:// intent opens the CONFIRM step in the real App and reads nothing; a cold-start launch URL does too', async () => {
  const bibleCalls = [], fsSpy = [], fetched = [];
  const plugin = fakeAppPlugin();
  const m = boot({ capApp: plugin, withFs: fsSpy, fetchImpl: async (u) => { fetched.push(u); throw new Error('must not fetch before the tap'); },
    bible: { installFromBytes: async (...a) => { bibleCalls.push(a); return { ok: true }; }, onFileInstall: () => () => {} } });
  await settle(m);
  assert.ok(plugin.listeners.filter(([e]) => e === 'appUrlOpen').length >= 2, 'the install listener is not registered next to the join listener: ' + plugin.listeners.map(l => l[0]));
  plugin.fire('appUrlOpen', { url: 'content://media/external/file/5' });
  const st = m.sheetProps(m.draw()).state;
  assert.deepEqual(plain(st), { phase: 'confirm', url: 'content://media/external/file/5' });
  assert.deepEqual([bibleCalls.length, fsSpy.length, fetched.length], [0, 0, 0], 'something was read or installed before the tap');
  // the tap runs the stream read through the REAL sheet handler
  m.sheetProps(m.draw()).onInstall();
  await sleep(20);
  assert.equal(fetched.length, 1, 'the Install tap did not read the file');
  assert.equal(m.sheetProps(m.draw()).state.result.reason, 'unreadable');

  // cold start: getLaunchUrl hands back the intent that started the app
  const plugin2 = fakeAppPlugin({ launchUrl: 'content://media/external/file/6' });
  const m2 = boot({ capApp: plugin2, bible: { onFileInstall: () => () => {} } });
  await settle(m2);
  assert.deepEqual(plain(m2.sheetProps(m2.draw()).state), { phase: 'confirm', url: 'content://media/external/file/6' }, 'a file the app was LAUNCHED with did not open the confirm step');
  // ...and reloading the app with the same launch URL does not reopen it
  const m3 = boot({ capApp: fakeAppPlugin({ launchUrl: 'content://media/external/file/6' }), seedLs: { 'trinityone.handledFiles': m2.window.localStorage.getItem('trinityone.handledFiles') }, bible: { onFileInstall: () => () => {} } });
  await settle(m3);
  assert.equal(m3.sheetProps(m3.draw()).state, null, 'a re-delivered launch URL reopened the sheet');
});

test('S17 — THE TWO LISTENERS HAVE DISJOINT SCHEMES: non-content links never open the install sheet, and the join link still applies', async () => {
  const plugin = fakeAppPlugin();
  const m = boot({ capApp: plugin, bible: { onFileInstall: () => () => {} } });
  await settle(m);
  for (const url of ['file:///sdcard/x.zip', 'http://evil.tld/x', 'javascript:alert(1)', 'https://evil.tld/join?follow=npub1abc']) {
    plugin.fire('appUrlOpen', { url });
    assert.equal(m.sheetProps(m.draw()).state, null, `${url} opened the install sheet`);
  }
  assert.equal(m.window.location.search, '', 'a hostile link changed the location');
  // the join regression: the real join listener still turns an invite into ?follow=
  plugin.fire('appUrlOpen', { url: 'https://app.trinityone.church/join?follow=npub1abc&name=Ada' });
  assert.match(m.window.location.search, /follow=npub1abc/, 'the join link is no longer applied');
  assert.equal(m.sheetProps(m.draw()).state, null, 'a join link opened the install sheet');
  // and a content:// link does not touch the location
  m.window.location.search = '';
  plugin.fire('appUrlOpen', { url: 'content://media/external/file/9' });
  assert.equal(m.window.location.search, '', 'a content:// link was treated as a join link');
});

// ── quiet-link round 3: --clay-text on the REAL App root follows the church brand, then the member's accent, and always reads at >= 4.5:1 ──
const lumOf = (hex) => { const h = hex.replace('#', ''); const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratioOf = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const PAPER = { light: ['#F4EEE2', '#FFFDF8'], dark: ['#16120C', '#211B13'] };
async function clayText({ dark, accent, brand }) {
  const m = boot({ seedLs: { 'trinityone.settings': JSON.stringify({ dark, accent }) }, churchAccent: brand });
  const tree = await settle(m);
  const root = nodes(tree).find(n => n.props && typeof n.props.className === 'string' && /\btrinity\b/.test(n.props.className) && n.props.style && n.props.style['--clay-text'] !== undefined);
  assert.ok(root, 're-anchor: the App root draws no --clay-text');
  assert.equal(root.props.className.includes('dark'), dark);
  return { value: root.props.style['--clay-text'], clay: root.props.style['--clay'] };
}

test('S24 — --clay-text: every accent and arbitrary brand colours (pale, dark, 3-digit, with alpha) read at >= 4.5:1 on the paper, in light and dark', async () => {
  const cases = [...['clay', 'indigo', 'teal', 'berry'].map(a => ({ accent: a })),
    ...['#F5D76E', '#1F2A5A', '#abc', '#C25A38', '#2E7D32', '#ffffff', '#000000', '#8FA7FFcc'].map(b => ({ accent: 'clay', brand: b }))];
  for (const dark of [false, true]) for (const c of cases) {
    const { value } = await clayText({ dark, ...c });
    assert.match(value, /^#[0-9a-f]{6}$/, 'not a plain hex: ' + value);
    for (const paper of PAPER[dark ? 'dark' : 'light']) assert.ok(ratioOf(value, paper) >= 4.5, `${dark ? 'dark' : 'light'} ${JSON.stringify(c)}: ${value} on ${paper} is ${ratioOf(value, paper).toFixed(2)}:1`);
  }
});

test('S25 — --clay-text FOLLOWS A CHURCH BRAND when there is one (its hue), and the member\'s accent when there is not', async () => {
  const green = await clayText({ dark: false, accent: 'clay', brand: '#2E7D32' });
  const [r, g, b] = [1, 3, 5].map(i => parseInt(green.value.slice(i, i + 2), 16));
  assert.ok(g > r && g > b, `a green brand gave a non-green text colour ${green.value}`);
  const none = await clayText({ dark: false, accent: 'clay' });
  assert.notEqual(none.value, green.value, 'the brand made no difference');
  const indigo = await clayText({ dark: false, accent: 'indigo' });
  assert.notEqual(indigo.value, none.value, 'the member\'s accent made no difference');
  // dark mode: a brand colour that already reads is used AS IS
  const darkBrand = await clayText({ dark: true, accent: 'clay', brand: '#8fa7ff' });
  assert.equal(darkBrand.value, '#8fa7ff');
  const darkNone = await clayText({ dark: true, accent: 'clay' });
  assert.equal(darkNone.value, '#e68a66', 'dark clay text is no longer the accent itself');
});

test('S26 — the line\'s text has no trailing or leading whitespace (a JSX comment must not leave spaces in the button text)', async () => {
  for (const category of ['bibles', 'dictionaries', null]) {
    const tree = await store({ category, view: 'language' }).draw();
    const btn = linkOf(tree)[0];
    const span = find(btn, n => n.type === 'span')[0];
    const raw = rtexts(span).join('');
    assert.equal(raw, raw.trim(), `${category}: the words carry stray whitespace: ${JSON.stringify(raw)}`);
    assert.equal(span.kids.length, 1, `${category}: the span holds more than the words (${span.kids.length} children)`);
  }
});

test('S27 — a brand colour that is not valid CSS (5 or 7 hex digits) is refused: the real App keeps the member\'s accent', async () => {
  const none = await clayText({ dark: false, accent: 'indigo' });
  for (const bad of ['#12345', '#1234567', '#12', '#123456789', '#12345g']) {
    for (const dark of [false, true]) {
      const plain = await clayText({ dark, accent: 'indigo' });
      const r = await clayText({ dark, accent: 'indigo', brand: bad });
      assert.equal(r.value, plain.value, `${bad} (dark=${dark}): the invalid brand changed --clay-text`);
      assert.equal(r.clay, plain.clay, `${bad} (dark=${dark}): the invalid brand became --clay`);
    }
  }
  const ok = await clayText({ dark: false, accent: 'indigo', brand: '#2E7D32' });
  assert.notEqual(ok.value, none.value, 'control: a valid 6-digit brand must still be taken');
  for (const good of ['#abcd', '#2E7D32ff']) assert.notEqual((await clayText({ dark: false, accent: 'indigo', brand: good })).clay, none.clay, `${good} (4 and 8 digits are valid CSS) was refused`);
});

test('S28 — dark mode: a very dark brand (navy) is LIGHTENED without losing its hue, and reads at >= 4.5:1', async () => {
  const hueOf = (hex) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return -1;
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
  const navy = '#001F3F';
  const { value } = await clayText({ dark: true, accent: 'clay', brand: navy });
  assert.ok(ratioOf(value, '#211B13') >= 4.5, `navy in dark mode is ${ratioOf(value, '#211B13').toFixed(2)}:1 (${value})`);
  assert.ok(Math.abs(hueOf(value) - hueOf(navy)) <= 5, `navy lost its hue: ${value} is ${hueOf(value).toFixed(0)} deg, navy is ${hueOf(navy).toFixed(0)}`);
  const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
  assert.ok(b - Math.max(r, g) >= 60, `navy went grey, not blue: ${value}`);
  for (const dark2 of ['#3B0A45', '#0B3D2E']) {   // a dark purple and a dark green keep their hue too
    const v = (await clayText({ dark: true, accent: 'clay', brand: dark2 })).value;
    assert.ok(Math.abs(hueOf(v) - hueOf(dark2)) <= 6, `${dark2} -> ${v} changed hue (${hueOf(dark2).toFixed(0)} -> ${hueOf(v).toFixed(0)})`);
    assert.ok(ratioOf(v, '#211B13') >= 4.5);
  }
});

test('S29 — the shared safeCssColor (engine.js) takes 3, 4, 6 and 8 hex digits and refuses 5 and 7', () => {
  const { win } = phone();
  assert.equal(typeof win.safeCssColor, 'function', 're-anchor: the engine does not define window.safeCssColor');
  for (const ok of ['#abc', '#abcd', '#c25a38', '#c25a38cc']) assert.equal(win.safeCssColor(ok, 'FALLBACK'), ok);
  for (const bad of ['#ab', '#abcde', '#c25a38c', '#c25a38ccd', '#c25a3g', 'red', 'url(x)']) assert.equal(win.safeCssColor(bad, 'FALLBACK'), 'FALLBACK', bad + ' was accepted');
  assert.equal(win.safeCssColor('var(--clay)', 'FALLBACK'), 'var(--clay)');
});
