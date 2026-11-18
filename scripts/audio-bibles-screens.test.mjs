// AUDIO BIBLES, BUILD 1 — AT THE POINT OF USE: the Bible reader's Listen button, the player's Next/Previous, the Reading
// settings sheet, the Audio Bibles screen ("Add your own", Remove, "Downloaded"), and "Open with TrinityOne".
// Run: node --test scripts/audio-bibles-screens.test.mjs
//
// CLAUDE.md rule 1: each feature here is driven through the screen a member uses — the REAL ReadScreen / SettingsSheet
// from app/screens-read.jsx, the REAL AudioBiblesScreen and player from app/screens-audio.jsx, the REAL install handler
// from app/install-bible.jsx and the REAL App() from app/app.jsx — over the REAL store (app/audio-store.jsx). Rule 3:
// nothing matches text in app/*.jsx; what is read is the rendered tree, the audio element and the stored bytes.
// FAKED, and named (scripts/audio-bibles-harness.mjs): IndexedDB, the Capacitor Filesystem plugin (the shim — the native
// file path is proved against it here, and on the phone only by the owner's device test), fetch, the <audio> element.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';
import { audioWorld, storeWorld, zipOf, mp3, text, readerOf, tagOf, settle, fflate, Stub } from './audio-bibles-harness.mjs';

const blobTag = async (url) => { const b = resolveObjectURL(url); if (!b) return null; return tagOf(new Uint8Array(await b.arrayBuffer())); };
const imported = async (w, entries, name = 'My Reading') => {
  const id = await w.S.beginImport();
  const res = await w.S.importSources(id, [{ name: 'x.zip', head: [], reader: readerOf(zipOf(entries), 4096) }]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal((await w.S.finishImport(id, { name })).ok, true);
  return id;
};
const byLabel = (tree, label) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === label);
const press = (tree, label) => { const b = byLabel(tree, label); assert.equal(b.length, 1, `expected one control "${label}", found ${b.length}`); b[0].props.onClick({ stopPropagation() {} }); };
const rowName = (b) => texts(find(b, n => n.type === 'span')[0]).join('');
const btnText = (tree, words) => find(tree, n => n.type === 'button' && texts(n).join(' ').includes(words));

// the REAL ReadScreen at John 3, sharing the world's React, store and player (as audio-controls-are-the-same-on-every-surface does)
function reader(w) {
  const NAME = { 1: 'Genesis', 43: 'John', 66: 'Revelation' }, MAXCH = { 1: 50, 43: 21, 66: 22 }, BOOKS = [1, 43, 66];
  Object.assign(w.win.Bible, {
    loaded: true, activeVersion: 'WEB', books: () => BOOKS, maxChapter: b => MAXCH[b], bookName: b => NAME[b], versions: () => [{ abbr: 'WEB' }],
    getVerses: () => [{ v: 1, text: 'In the beginning', html: 'In the beginning' }],
    bookMeta: () => BOOKS.map(n => ({ num: n, name: NAME[n], abbr: NAME[n].slice(0, 3), group: 'g', ch: MAXCH[n] })),
    getCommentary: () => [], commentaryList: () => [], searchDict: () => [], subscribe: () => () => {}, defaultLoc: () => ({ book: 43, chap: 1 }),
    refLabel: (l, v) => NAME[l.book] + ' ' + l.chap + (v != null ? ':' + v : ''), refKey: (l, v) => l.book + '.' + l.chap + '.' + v, step: () => null });
  Object.assign(w.win, { speechSynthesis: null, innerWidth: 360, sanitizeHtml: h => h, getSelection: () => ({ toString: () => '' }), TrinityData: { CROSSREFS: {} } });
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React: w.React, window: {} });
  const globals = { ...w.base, Icon, document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' }, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams,
    SpeechSynthesisUtterance: class {}, cx: (...a) => a.filter(Boolean).join(' '), useTrinityAudio: w.audio.useTrinityAudio,
    ReadPlansTabs: Stub('ReadPlansTabs'), BottomSheet: ({ open, children }) => (open ? w.React.createElement('div', { 'data-sheet': true }, children) : null),
    useBackLayer: () => {}, Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'), Halo: Stub('Halo'), IconBtn: Stub('IconBtn') };
  const mod = loadScreen('app/screens-read.jsx', ['ReadScreen', 'SettingsSheet'], globals);
  const ctx = { loc: { book: 43, chap: 3 }, version: 'WEB', setLoc() {}, toast() {}, highlights: {}, notes: {}, bookmarks: [], toggleBookmark() {}, setHighlight() {}, setNote() {},
    openShareSheet() {}, desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {}, toggleDark() {}, dark: false };
  const page = () => { w.draw(mod.ReadScreen, { ctx }); return w.draw(mod.ReadScreen, { ctx }); };
  const listen = () => { const b = find(page(), n => n.type && n.type.name === 'IconBtn' && n.props.name === 'headphones'); assert.equal(b.length, 1, 'no Listen button on the reader — re-anchor'); b[0].props.onClick(); };
  const settings = (open) => { const p = { open, onClose() {}, scale: 1, setScale() {}, serif: true, setSerif() {}, showStrongs: false, setShowStrongs() {}, ctx }; w.draw(mod.SettingsSheet, p); return w.draw(mod.SettingsSheet, p); };
  return { mod, ctx, page, listen, settings };
}
const player = (w) => { w.draw(w.audio.MiniPlayer, { ctx: {} }); return w.draw(w.audio.MiniPlayer, { ctx: {} }); };

// ─────────────────────────── 1. Listen plays the imported chapter ───────────────────────────
test('POINT OF USE — the Bible reader\'s Listen button plays the IMPORTED chapter from app file storage (phone) and from IndexedDB (web/Suite)', async () => {
  for (const native of [true, false]) {
    const w = audioWorld({ native });
    const id = await imported(w, [['John_3.mp3', mp3('john3')], ['John_4.mp3', mp3('john4')], ['John_7.mp3', mp3('john7')]], 'Grandad reads John');
    w.lsSet('trinityone.audioVoice', id + '/david');
    const r = reader(w);
    r.listen(); await settle();
    const cur = w.A.current;
    assert.equal(cur.id, 'bible:43:3');
    assert.equal(cur.subtitle, 'Audio Bible · Grandad reads John', 'the subtitle is not the set\'s own name');
    assert.match(w.el.src, /^blob:/, (native ? 'phone' : 'web') + ': the player is not playing from a Blob');
    assert.equal(await blobTag(w.el.src), 'john3', 'the player is not playing the imported John 3');
    assert.deepEqual(w.A.current && (await new Promise(res => w.A.subscribe(s => res(s.q.map(t => t.title))))), ['John 3', 'John 4', 'John 7'], 'the queue is not the chapters this set has');
    if (native) {
      assert.ok(w.fs.fetched.length >= 1, 'the chapter was not read through convertFileSrc');
      assert.ok(w.fs.fetched.every(f => !f.range), 'a Range header was sent (Capacitor 6 Android range bug)');
      assert.ok(!/_capacitor_file_/.test(w.el.src), '<audio> was pointed at convertFileSrc directly');
    }
  }
});

test('POINT OF USE — a chapter the chosen set does not have plays Berean Standard and says so, naming the set', async () => {
  const w = audioWorld({ native: true });
  const id = await imported(w, [['John_1.mp3', mp3('j1')]], 'Only John 1');
  w.lsSet('trinityone.audioVoice', id + '/david');
  const r = reader(w);
  r.listen(); await settle();
  assert.equal(w.el.src, 'https://audio.bible.helloao.org/api/BSB/JHN/3/audio/david.mp3');
  assert.match(w.toasts.join(' | '), /Only John 1 has no recording of John 3/);
});

test('getAudioChoice accepts only READY sets: a pending (half-imported) or removed set falls back to Berean Standard', async () => {
  const w = audioWorld();
  const id = await w.S.beginImport();
  w.lsSet('trinityone.audioVoice', id + '/david');
  assert.equal(w.audio.getAudioChoice().translation, 'BSB');
  w.lsSet('trinityone.audioVoice', 'WEB/david');
  assert.equal(w.audio.getAudioChoice().translation, 'WEB', 'the saved World English choice stopped working');
  w.lsSet('trinityone.audioVoice', 'BSB/hays');
  assert.deepEqual([w.audio.getAudioChoice().translation, w.audio.getAudioChoice().reader], ['BSB', 'hays']);
});

// ─────────────────────────── 2. the player lets a chapter go (P1) ───────────────────────────
test('PLAYER (P1) — Bible chapter 2 → Next → Previous plays chapter 2 again; the address it left is let go', async () => {
  const w = audioWorld({ native: true });
  const id = await imported(w, [['John_1.mp3', mp3('j1')], ['John_2.mp3', mp3('j2')], ['John_3.mp3', mp3('j3')]]);
  w.lsSet('trinityone.audioVoice', id + '/david');
  await w.audio.playBibleChapter(43, 2); await settle();
  const first = w.el.src;
  assert.equal(await blobTag(first), 'j2');
  press(player(w), 'Next track'); await settle();
  assert.equal(await blobTag(w.el.src), 'j3');
  assert.equal(resolveObjectURL(first), undefined, 'chapter 2\'s blob address was kept after the player moved on');
  press(player(w), 'Previous track'); await settle();
  assert.equal(w.A.current.id, 'bible:43:2');
  assert.match(w.el.src, /^blob:/);
  assert.equal(await blobTag(w.el.src), 'j2', 'Previous did not play chapter 2 again');
});

test('PLAYER (P1) — a sermon queue is untouched: Next → Previous still plays the first sermon from its own blob address', async () => {
  const w = audioWorld();
  const first = URL.createObjectURL(new Blob([mp3('sermon1')]));
  const s1 = { id: 's1', title: 'Sermon A', src: first };
  const s2 = { id: 's2', title: 'Sermon B', resolve: async () => URL.createObjectURL(new Blob([mp3('sermon2')])) };
  w.A.play(s1, [s1, s2]); await settle();
  press(player(w), 'Next track'); await settle();
  assert.equal(await blobTag(w.el.src), 'sermon2');
  const second = w.el.src;
  press(player(w), 'Previous track'); await settle();
  // a sermon WITH resolve() is not a Bible chapter either: its downloaded (decrypted) address is kept, not thrown away
  assert.equal(s2.src, second, 'the second sermon\'s address was dropped — Next would download it again');
  assert.equal(await blobTag(second), 'sermon2', 'the second sermon\'s blob was revoked');
  assert.equal(w.el.src, first, 'the first sermon lost its address');
  assert.equal(await blobTag(first), 'sermon1', 'the first sermon\'s blob was revoked — it has nothing to rebuild it from');
});

// ─────────────────────────── 3. the Reading settings sheet ───────────────────────────
test('SETTINGS — five audio Bibles on a 360 px phone: a list of full-width rows, every one there and pickable', async () => {
  const w = audioWorld();
  const ids = [];
  for (const n of ['Alpha', 'Beta', 'Gamma with a rather long name that has to wrap on a small phone']) ids.push(await imported(w, [['John_1.mp3', mp3(n)]], n));
  const r = reader(w);
  let tree = r.settings(true);
  const group = find(tree, n => n.props && n.props.role === 'radiogroup' && n.props['aria-label'] === 'Audio Bible');
  assert.equal(group.length, 1, 'no audio Bible list on the sheet');
  assert.equal(group[0].props.style.flexDirection, 'column', 'the choices are not stacked: five will not fit a 360 px row');
  const rows = find(group[0], n => n.type === 'button' && n.props.role === 'radio');
  assert.deepEqual(rows.map(b => rowName(b)), ['Berean Standard', 'World English', 'Alpha', 'Beta', 'Gamma with a rather long name that has to wrap on a small phone']);
  for (const b of rows) { assert.equal(b.props.style.width, '100%'); assert.equal(typeof b.props.onClick, 'function'); }
  rows[4].props.onClick();
  assert.equal(w.lsGet('trinityone.audioVoice'), ids[2] + '/david');
  tree = r.settings(true);
  const on = find(tree, n => n.type === 'button' && n.props.role === 'radio' && n.props['aria-checked'] === true);
  assert.deepEqual(on.map(b => rowName(b)), ['Gamma with a rather long name that has to wrap on a small phone']);
  // each row has its own caption, generated per set
  assert.match(texts(rows[2]).join(' '), /1 chapters/);
});

test('REMOVE (point of use) — the Audio Bibles screen\'s Remove deletes the set and says how much space came back; reopening Reading settings: gone, Berean Standard selected', async () => {
  const w = audioWorld({ native: true });
  const id = await imported(w, [['John_1.mp3', mp3('a', 2 * 1048576)], ['John_2.mp3', mp3('b', 1048576)]], 'Going soon');
  const r = reader(w);
  r.settings(false);
  const picks = find(r.settings(true), n => n.type === 'button' && n.props.role === 'radio');
  picks.find(b => rowName(b) === 'Going soon').props.onClick();
  r.settings(false);
  const toasts = [];
  const screen = () => { const p = { open: true, onClose() {}, ctx: { toast: m => toasts.push(m) } }; w.draw(w.audio.AudioBiblesScreen, p); return w.draw(w.audio.AudioBiblesScreen, p); };
  w.win.fetchOverride = async (u) => { if (/web-audio-manifest/.test(u)) return { ok: true, json: async () => ({ chapters: {} }) }; return w.fs.fsFetch(u); };
  screen(); await settle();
  press(screen(), 'Remove Going soon'); await settle();
  assert.match(toasts.join(' | '), /Removed .Going soon. · 3 MB freed/);
  assert.equal(w.S.row(id), null);
  assert.equal(w.disk.size, 0, 'the files are still on the phone');
  assert.equal(find(screen(), n => n.props && n.props['data-own-set'] === id).length, 0, 'the removed set is still listed');
  const tree = r.settings(true);
  const rows = find(tree, n => n.type === 'button' && n.props.role === 'radio');
  assert.ok(!rows.some(b => rowName(b) === 'Going soon'), 'the removed set is still offered');
  assert.deepEqual(rows.filter(b => b.props['aria-checked'] === true).map(b => rowName(b)), ['Berean Standard']);
});

// ─────────────────────────── 4. the Audio Bibles screen ───────────────────────────
function libraryScreen(w, { manifest = { chapters: {} }, props = {} } = {}) {
  const toasts = [];
  w.win.fetchOverride = async (u, i) => { if (/web-audio-manifest/.test(String(u))) return { ok: true, json: async () => manifest }; return w.win.netFetch ? w.win.netFetch(u, i) : w.fs.fsFetch(u, i); };
  const p = { open: true, onClose() {}, ctx: { toast: m => toasts.push(m) }, ...props };
  const draw = () => { w.draw(w.audio.AudioBiblesScreen, p); return w.draw(w.audio.AudioBiblesScreen, p); };
  return { draw, toasts, p };
}
const bookLine = (tree, num) => texts(find(tree, n => n.props && n.props['data-book'] === num)[0]).join(' ');

test('"DOWNLOADED" MEANS EVERY CHAPTER — a book whose download stopped part-way is not "Downloaded"; a complete one is', async () => {
  for (const native of [true, false]) {
    const w = audioWorld({ native });
    const put = (b, c) => w.idbData.set('WEB/' + b + '/' + c, new Blob([mp3('w')], { type: 'audio/mpeg' }));
    put(40, 1); put(57, 1);                               // Matthew: 1 of 2 chapters; Philemon: its only chapter
    if (native) w.disk.set('audio/WEB/41/1.mp3', mp3('w'));  // Mark: one in files…
    put(41, 2);                                           // …and one still in IndexedDB (mid-migration): complete
    const L = libraryScreen(w, { manifest: { chapters: { 40: { 1: [0, 1], 2: [0, 1] }, 41: { 1: [0, 1], 2: [0, 1] }, 57: { 1: [0, 1] } } } });
    L.draw(); await settle(); const tree = L.draw();
    assert.doesNotMatch(bookLine(tree, 40), /Downloaded/, 'a part-downloaded book says Downloaded');
    assert.match(bookLine(tree, 57), /Downloaded/);
    if (native) assert.match(bookLine(tree, 41), /Downloaded/, 'a book split across both stores mid-migration is not seen whole');
  }
});

test('ADD YOUR OWN (point of use) — the button opens a picker for .zip and audio; a picked zip goes check → name → saved, and is offered in Reading settings', async () => {
  const w = audioWorld({ native: true });
  const L = libraryScreen(w);
  let tree = L.draw(); await settle(); tree = L.draw();
  const input = find(tree, n => n.type === 'input' && n.props.type === 'file');
  assert.equal(input.length, 1, 'no file picker on the Audio Bibles screen');
  assert.deepEqual([input[0].props.accept, input[0].props.multiple], ['.zip,audio/*', true]);
  let clicked = 0;
  const addBtn = btnText(tree, 'Add your own');
  assert.equal(addBtn.length, 1, 'no "Add your own" button');
  // the button clicks the hidden input (its ref is set by the real DOM; here the ref object is shared through props)
  input[0].props.ref.current = { click: () => { clicked++; } };
  addBtn[0].props.onClick();
  assert.equal(clicked, 1, '"Add your own" does not open the picker');
  const zip = zipOf([['40_Matthew_001.mp3', mp3('m1')], ['40_Matthew_002.mp3', mp3('m2')], ['bonus.mp3', mp3('b')], ['readme.txt', text('hi')]]);
  input[0].props.onChange({ target: { files: [new File([zip], 'matthew.zip')], value: 'x' } });
  await settle(40); tree = L.draw();
  assert.match(texts(tree).join(' '), /Found 2 chapters across 1 books · 1 not recognised/);
  assert.ok(texts(tree).includes('bonus.mp3'), 'the unrecognised file is not listed by name');
  btnText(tree, 'Leave out')[0].props.onClick(); await settle(); tree = L.draw();
  btnText(tree, 'Next')[0].props.onClick(); tree = L.draw();
  find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Name')[0].props.onChange({ target: { value: 'Matthew, read at home' } }); tree = L.draw();
  btnText(tree, 'Save')[0].props.onClick(); await settle(); tree = L.draw();
  const set = w.S.readySets().find(r => r.source === 'own');
  assert.ok(set, 'Save did not make a ready set');
  assert.deepEqual([set.name, set.chapters], ['Matthew, read at home', 2]);
  assert.match(L.toasts.join(' | '), /Added/);
  assert.equal(find(tree, n => n.props && n.props['data-own-set'] === set.id).length, 1, 'the new set is not listed on the screen');
  assert.deepEqual([...w.disk.keys()].filter(k => /_unplaced/.test(k)), []);
  assert.ok(w.win.audioBibleChoices().some(c => c.id === set.id && c.name === 'Matthew, read at home'), 'Reading settings does not offer the new set');
});

test('ADD YOUR OWN — Cancel on the check screen deletes the whole folder and the row; a zip with no audio says so and leaves nothing', async () => {
  const w = audioWorld({ native: true });
  const L = libraryScreen(w);
  let tree = L.draw(); await settle(); tree = L.draw();
  const pick = (zip) => find(L.draw(), n => n.type === 'input' && n.props.type === 'file')[0].props.onChange({ target: { files: [new File([zip], 'a.zip')] } });
  const evil = '<img src=x onerror=alert(1)>.mp3';
  pick(zipOf([['odd.mp3', mp3('o')], [evil, mp3('e')]])); await settle(40); tree = L.draw();
  assert.match(texts(tree).join(' '), /not recognised/);
  assert.ok(texts(tree).includes(evil), 'a file name from inside the zip is not shown as plain text');
  assert.equal(find(tree, n => n.type === 'img' || (n.props && n.props.dangerouslySetInnerHTML)).length, 0, 'a name from a zip became markup');
  btnText(tree, 'Cancel')[0].props.onClick(); await settle(); tree = L.draw();
  assert.deepEqual([w.disk.size, w.S.rows().length], [0, 0], 'Cancel left files or a row');
  pick(zipOf([['readme.txt', text('only words')]])); await settle(40); tree = L.draw();
  assert.match(texts(tree).join(' '), /No audio files were found in it\. Nothing was added\./);
  assert.deepEqual([w.disk.size, w.S.rows().length], [0, 0]);
});

test('OPEN-WITH HAND-OVER — the screen takes a stream it is handed and runs the same import, once', async () => {
  const w = audioWorld({ native: true });
  const zip = zipOf([['John_1.mp3', mp3('j1')], ['John_2.mp3', mp3('j2')]]);
  let taken = 0;
  const head = [zip.slice(0, 100)]; const rest = readerOf(zip.slice(100), 50);
  const L = libraryScreen(w, { props: { incoming: { head, reader: rest }, onIncomingTaken: () => { taken++; } } });
  L.draw(); await settle(40); const tree = L.draw();
  assert.equal(taken, 1);
  assert.match(texts(tree).join(' '), /Name it/);
  assert.match(texts(tree).join(' '), /2 chapters across 1 books/);
});

test('WORLD ENGLISH DOWNLOAD ON A PHONE (B4, M4) — chapters already in either store are not fetched again; new ones go to app file storage', async () => {
  const w = audioWorld({ native: true });
  const one = fflate.zipSync({ 'x.mp3': [mp3('new3'), { level: 1 }] });
  const csize = one[18] | (one[19] << 8) | (one[20] << 16) | (one[21] << 24);
  w.disk.set('audio/WEB/40/1.mp3', mp3('old1'));                                     // already moved
  w.idbData.set('WEB/40/2', new Blob([mp3('old2')], { type: 'audio/mpeg' }));      // not moved yet
  const hits = [];
  w.win.Fellowship = { relays: ['wss://relay.example'], CANONICAL_RELAYS: [] };
  w.win.netFetch = async (u) => { hits.push(String(u)); return { ok: true, arrayBuffer: async () => one.buffer.slice(0) }; };
  libraryScreen(w, { manifest: { chapters: { 40: { 1: [0, csize], 2: [0, csize], 3: [0, csize] } } } });
  await w.win.TrinityAudioBible.downloadWebBook(40);
  assert.deepEqual(hits.filter(u => /start=0&len=/.test(u) && !/len=4$/.test(u)).length, 1, 'chapters this phone already has were downloaded again: ' + hits);
  assert.equal(tagOf(w.disk.get('audio/WEB/40/3.mp3')), 'new3', 'the downloaded chapter is not in app file storage');
  assert.equal(w.idbData.has('WEB/40/3'), false);
});

// ─────────────────────────── 5. "Open with TrinityOne" ───────────────────────────
function installer({ fetchImpl } = {}) {
  const { React } = miniReact();
  const bibleCalls = [];
  const win = { fflate, Bible: { installFromBytes: async (u8) => { bibleCalls.push(u8); return { ok: true, kind: 'bible', abbr: 'X', name: 'Got It' }; } },
    Capacitor: { convertFileSrc: (u) => 'https://localhost/_capacitor_content_/' + encodeURIComponent(u), Plugins: { Filesystem: {} } } };
  const store = new Map();
  const mod = loadScreen('app/install-bible.jsx', ['ifsRunInstall', 'ifsReadContent'], { React, window: win, Icon: Stub('Icon'), BottomSheet: () => null, Spinner: () => null,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }, fetch: fetchImpl });
  return { mod, bibleCalls };
}
// a response that can be opened ONCE: a second fetch of the same file throws
function oneShot(u8, { chunk = 16384, declared = null } = {}) {
  let opened = 0; const st = {};
  const fetchImpl = async () => { if (++opened > 1) throw new Error('THE FILE WAS OPENED TWICE'); return { ok: true, status: 200, headers: { get: (h) => (h === 'content-length' && declared != null ? String(declared) : null) }, body: { getReader: () => readerOf(u8, chunk, st) } }; };
  return { fetchImpl, st, opened: () => opened };
}
const drain = async (h) => { const parts = [...h.head]; for (;;) { const { done, value } = await h.reader.read(); if (done) break; parts.push(value); } const n = parts.reduce((a, p) => a + p.length, 0); const u = new Uint8Array(n); let at = 0; for (const p of parts) { u.set(p, at); at += p.length; } return u; };
const run = async (u8, opts) => { const s = oneShot(u8, opts); const i = installer({ fetchImpl: s.fetchImpl }); const shown = []; const handed = [];
  await i.mod.ifsRunInstall('content://x/1', (st) => shown.push(st), { onAudio: (h) => handed.push(h) }); return { ...i, shown, handed, s }; };

test('OPEN-WITH — a Bible zip still installs as a Bible, from ONE read of the file; the audio route is not taken', async () => {
  const bibleZip = zipOf([['readme.txt', text('about')], ['kjv/bible.usfm', text('\\id GEN\n\\c 1\n\\v 1 In the beginning')]]);
  const r = await run(bibleZip, { chunk: 7 });
  assert.equal(r.handed.length, 0, 'a Bible zip was sent to the audio route');
  assert.equal(r.bibleCalls.length, 1);
  assert.deepEqual([...r.bibleCalls[0]], [...bibleZip], 'the Bible engine did not get the whole file');
  assert.deepEqual(r.shown.map(s => s && s.phase), ['installing', 'result']);
});

test('OPEN-WITH — an audio zip reaches the audio route: the SAME reader is handed over (never re-opened), the sheet closes, the Bible engine is not called', async () => {
  const cases = {
    'named .mp3': zipOf([['John_1.mp3', mp3('j1', 50000)], ['John_2.mp3', mp3('j2', 50000)]]),
    'readme, __MACOSX and a folder first, then audio known only by its bytes, sizes behind data descriptors': zipOf([['readme.txt', text('read me')], ['__MACOSX/._x', text('mac')], ['disc1/', new Uint8Array(0)], ['disc1/track01.dat', mp3('t1', 50000)]], { descriptor: true }),
  };
  for (const [label, z] of Object.entries(cases)) {
    const r = await run(z, { chunk: 5 });
    assert.equal(r.handed.length, 1, label + ': not handed to the audio route');
    assert.equal(r.bibleCalls.length, 0, label + ': the Bible engine was called');
    assert.deepEqual(r.shown.map(s => s && s.phase), ['installing', null], label + ': the Install sheet was not closed by hand');
    assert.equal(r.shown[1], null);
    assert.equal(r.s.opened(), 1);
    assert.deepEqual([...(await drain(r.handed[0]))], [...z], label + ': head + live reader do not add up to the whole file');
  }
});

test('OPEN-WITH (B1) — a passed-over entry STORED with a data descriptor ends the peek: the Bible route carries on, unchanged', async () => {
  const z = zipOf([['readme.txt', text('read me')], ['John_1.mp3', mp3('j1')]], { descriptor: true, stored: true });
  const r = await run(z, { chunk: 64 });
  assert.equal(r.handed.length, 0);
  assert.equal(r.bibleCalls.length, 1);
});

test('OPEN-WITH — a 60 MB file that is not audio still says "too big"; a large AUDIO zip that declares 80 MB is handed over', async () => {
  const big = new Uint8Array(60 * 1024 * 1024); big[0] = 0x50; big[1] = 0x4B; big[2] = 0x05; big[3] = 0x06;   // not a local-file zip
  const a = await run(big, { chunk: 1024 * 1024 });
  assert.deepEqual(a.shown[1].result, { ok: false, reason: 'too-big' });
  assert.equal(a.handed.length, 0);
  const b = await run(new Uint8Array(1024), { declared: 60 * 1024 * 1024 });
  assert.deepEqual(b.shown[1].result, { ok: false, reason: 'too-big' }, 'a declared 60 MB non-audio file was not refused');
  assert.ok((b.s.st.reads || 0) <= 2, 'more than the peek was read from a file that declared itself too big');
  const z = zipOf([['John_1.mp3', mp3('j1', 4000)]]);
  const c = await run(z, { declared: 80 * 1024 * 1024 });
  assert.equal(c.handed.length, 1, 'a big audio zip was refused before it could be peeked');
});

// ─────────────────────────── 6. the real App: the hand-over, and the boot sweep ───────────────────────────
const NPUB = 'npub1' + '0'.repeat(58);
function boot({ fetchImpl, capApp, idb } = {}) {
  const r = fakeReact();
  const env = appBrowser(); const window = env.window;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }),
    versions: () => [], installedMap: () => ({}), onFileInstall: () => () => {}, installFromBytes: async () => ({ ok: true, kind: 'bible', name: 'B' }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  window.fflate = fflate;
  if (idb) window.indexedDB = idb;
  if (capApp) window.Capacitor = { isNativePlatform: () => true, convertFileSrc: (u) => 'https://localhost/_capacitor_content_/' + u, Plugins: { App: capApp } };
  if (fetchImpl) window.fetch = fetchImpl;
  const App = loadApp({ React: r.React, window, expr: 'App' });
  window.TrinityData.CHURCHES = [{ id: NPUB, npub: NPUB, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(NPUB));
  window.localStorage.setItem('trinityone.onboarded', 'true');
  window.Fellowship = new Proxy({ myPubkey: 'dd'.repeat(32), CANONICAL_RELAYS: [], hasRelays: true, toPub: (x) => x, subscribeAmBlocked: (cb) => { cb(false, ''); return () => {}; }, isBlockedChurch: () => false },
    { get: (t, k) => { if (k in t) return t[k]; if (k === 'then' || typeof k === 'symbol') return undefined; return () => () => {}; } });
  const draw = () => { r.reset(); const tree = App(); r.flush(); return tree; };
  const propsOf = (tree, comp) => { const n = nodes(tree).find(x => x.type === comp); return n ? n.props : null; };
  return { window, draw, propsOf };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const appSettle = async (m) => { m.draw(); await sleep(60); m.draw(); return m.draw(); };
function fakeAppPlugin() {
  const listeners = [];
  return { listeners, getLaunchUrl: async () => null, addListener: async (ev, cb) => { listeners.push([ev, cb]); return { remove() {} }; },
    fire: (ev, payload) => listeners.filter(([e]) => e === ev).forEach(([, cb]) => cb(payload)) };
}

test('APP (point of use) — Open with → Install on an AUDIO zip: the real App closes the install sheet and opens Audio Bibles holding the stream', async () => {
  const z = zipOf([['John_1.mp3', mp3('j1', 30000)]]);
  const s = oneShot(z, { chunk: 4096 });
  const plugin = fakeAppPlugin();
  const m = boot({ capApp: plugin, fetchImpl: s.fetchImpl });
  await appSettle(m);
  plugin.fire('appUrlOpen', { url: 'content://media/external/file/9' });
  let tree = m.draw();
  assert.equal(m.propsOf(tree, m.window.InstallFromFileSheet).state.phase, 'confirm');
  assert.equal(m.propsOf(tree, m.window.AudioBiblesScreen).open, false);
  m.propsOf(tree, m.window.InstallFromFileSheet).onInstall();
  await sleep(40); tree = m.draw();
  assert.equal(m.propsOf(tree, m.window.InstallFromFileSheet).state, null, 'the install sheet is still open');
  const ab = m.propsOf(tree, m.window.AudioBiblesScreen);
  assert.equal(ab.open, true, 'Audio Bibles did not open');
  assert.ok(ab.incoming && Array.isArray(ab.incoming.head) && ab.incoming.reader, 'the stream did not reach the Audio Bibles screen');
  assert.equal(s.opened(), 1);
  ab.onIncomingTaken(); tree = m.draw();
  assert.equal(m.propsOf(tree, m.window.AudioBiblesScreen).incoming, null);
});

test('APP (point of use) — at start-up the real App runs the boot sweep: a half-imported set left by a killed app is gone', async () => {
  const { fakeIdb } = await import('./audio-bibles-harness.mjs');
  const idb = fakeIdb();
  idb.data.set('00112233aabbccdd/43/1', new Blob([mp3('half')]));
  idb.data.set('WEB/43/1', new Blob([mp3('web')]));
  const m = boot({ idb: idb.indexedDB });
  m.window.localStorage.setItem('trinityone.audioSets', JSON.stringify([{ id: '00112233aabbccdd', state: 'pending', source: 'own' }]));
  await appSettle(m); await sleep(60);
  assert.deepEqual([...idb.data.keys()], ['WEB/43/1'], 'the boot sweep did not run (or touched World English)');
  assert.deepEqual(JSON.parse(m.window.localStorage.getItem('trinityone.audioSets')), []);
});
