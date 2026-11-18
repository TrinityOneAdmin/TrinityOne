// AUDIO BIBLES, BUILD 1 — THE STORE: "Add your own" import, name matching, caps, the boot sweep, World English moving
// into app file storage, Remove, and the one gate that keeps the web build, the Suite and iOS on IndexedDB.
// Run: node --test scripts/audio-bibles-store.test.mjs
//
// Plan: TrinityOne-internal/PLAN-AUDIO-BIBLES-2026-11-18.html (v5). The REAL app/audio-store.jsx runs here (compiled
// from source); IndexedDB and the Capacitor Filesystem plugin are in-memory fakes (scripts/audio-bibles-harness.mjs).
// The native file path is proved against that shim only; on a phone it is the owner's device test.
// Nothing here matches text in app/*.jsx (rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeWorld, zipOf, mp3, m4a, text, readerOf, tagOf, settle } from './audio-bibles-harness.mjs';

const PATH_OK = /^audio\/([0-9a-f]{16}|WEB)\/(\d+\/\d+|_unplaced\/\d+)\.(mp3|m4a|ogg)$/;
const imp = async (w, entries, { chunk = 4096, zip = {} } = {}) => {
  const id = await w.S.beginImport();
  const res = await w.S.importSources(id, [{ name: 'x.zip', head: [], reader: readerOf(zipOf(entries, zip), chunk) }]);
  return { id, res };
};
const bytesAt = async (w, id, b, c) => { const blob = await w.S.chapterBlob(id, b, c); return blob ? tagOf(new Uint8Array(await blob.arrayBuffer())) : null; };

test('NAMES — the real file-name shapes: book code or name first, then the chapter (digits or words); a leading number is never decisive', () => {
  const { S } = storeWorld();
  const want = {
    'eng-webbe_002_GEN_01.mp3': [1, 1], '71_MRK_01.mp3': [41, 1], '50_EPH_001.mp3': [49, 1], '01_01_Genesis_Chapter_One.mp3': [1, 1],
    '57_Philemon.mp3': [57, 1], '25_Lam5.mp3': [25, 5], '40_Matthew_001.mp3': [40, 1],
    '19_Psalms_Chapter_One_Hundred_Fifty.mp3': [19, 150], '62_1John_03.mp3': [62, 3], 'Song_of_Solomon_02.mp3': [22, 2], 'Twenty-Three/Psalm_Twenty-Three.mp3': [19, 23],
  };
  for (const [name, [book, chap]] of Object.entries(want)) {
    const m = S.matchName(name);
    assert.ok(m, name + ' was not recognised');
    assert.deepEqual([m.book, m.chap], [book, chap], name);
  }
  // the leading number is recorded only as a cross-check
  assert.equal(S.matchName('71_MRK_01.mp3').lead, 71);
  for (const bad of ['readme.txt', 'track01.mp3', 'Genesis.mp3' /* many chapters, none named */, 'Jude_2.mp3' /* Jude has one */, '40_041_001.mp3', '']) assert.equal(S.matchName(bad), null, bad + ' was matched');
  assert.equal(S.CHAPTERS.reduce((a, b) => a + b, 0), 1189, 'the chapter table does not add up to 1,189');
});

test('IMPORT, PHONE — one streaming pass into a PENDING set: recognised chapters at audio/<id>/<book>/<chap>.<ext>, the rest in _unplaced/<n>, non-audio skipped', async () => {
  const w = storeWorld({ native: true });
  const { id, res } = await imp(w, [
    ['readme.txt', text('hello')], ['__MACOSX/._x', text('junk')], ['MAT/', new Uint8Array(0)],
    ['MAT/40_Matthew_001.mp3', mp3('mat1')], ['MAT/40_Matthew_002.m4a', m4a('mat2')], ['bonus track.mp3', mp3('bonus')], ['cover.jpg', new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
  ]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(w.S.row(id).state, 'pending', 'the set is not pending before it is named');
  assert.deepEqual([res.chapters, res.books], [2, 1]);
  assert.deepEqual(res.unplaced.map(u => u.name), ['bonus track.mp3']);
  const keys = [...w.disk.keys()].sort();
  assert.deepEqual(keys, ['audio/' + id + '/40/1.mp3', 'audio/' + id + '/40/2.m4a', 'audio/' + id + '/_unplaced/1.mp3'].sort());
  assert.equal(w.idbData.size, 0, 'the phone wrote audio into IndexedDB');
  // the original name lives only as text in the pending row
  assert.deepEqual(w.S.row(id).unplaced.map(u => u.name), ['bonus track.mp3']);
});

test('IMPORT — big chapters are written ~1 MB per bridge call, never as one base64 string', async () => {
  const w = storeWorld({ native: true });
  const { id, res } = await imp(w, [['40_Matthew_005.mp3', mp3('big', Math.floor(2.5 * 1024 * 1024))]], { chunk: 64 * 1024 });
  assert.equal(res.ok, true);
  const p = 'audio/' + id + '/40/5.mp3';
  assert.deepEqual(w.fs.calls.filter(c => c.endsWith(' ' + p + '.part')).map(c => c.split(' ')[0]), ['writeFile', 'appendFile', 'appendFile', 'stat', 'rename'],
    'not written in ~1 MB pieces to a .part file that is checked and then renamed');
  assert.equal(w.disk.get(p).length, Math.floor(2.5 * 1024 * 1024));
});

test('PATHS — a name can never reach a path: ../../x.mp3 and a/../../b stay inside the set; Gen01.html with MP3 bytes is stored as .mp3; a non-audio entry is never written', async () => {
  const w = storeWorld({ native: true });
  const { id, res } = await imp(w, [['../../x.mp3', mp3('x')], ['a/../../b', mp3('b')], ['Gen01.html', mp3('gen1')], ['../../../evil.sh', text('#!/bin/sh rm -rf /')], ['40_Matthew_001.mp3', text('not audio at all')]]);
  assert.equal(res.ok, true);
  for (const k of w.disk.keys()) { assert.match(k, PATH_OK, 'a stored path is not one the store chose: ' + k); assert.ok(k.startsWith('audio/' + id + '/'), k + ' escaped the set'); }
  assert.equal(w.disk.get('audio/' + id + '/1/1.mp3') && tagOf(w.disk.get('audio/' + id + '/1/1.mp3')), 'gen1', 'Gen01.html with MP3 bytes is not Genesis 1 as .mp3');
  assert.equal([...w.disk.keys()].length, 3, 'expected Genesis 1 + two unplaced: ' + [...w.disk.keys()]);
  assert.equal(res.skipped, 2, 'the two non-audio entries were not skipped');
  assert.equal(await w.S.hasChapter(id, 40, 1), false, 'a text file named like a chapter was stored as one');
});

test('MATCHING IN A SET — a leading number that disagrees with the set goes to the check screen; eBible-style numbering (MRK = 71) is not "wrong"', async () => {
  const w = storeWorld();
  const a = await imp(w, [['40_Matthew_001.mp3', mp3('m1')], ['40_Matthew_002.mp3', mp3('m2')], ['40_Matthew_003.mp3', mp3('m3')], ['41_Matthew_004.mp3', mp3('m4?')]]);
  assert.deepEqual([a.res.chapters, a.res.unplaced.map(u => u.name)], [3, ['41_Matthew_004.mp3']]);
  assert.equal(await w.S.hasChapter(a.id, 40, 4), false, 'the disagreeing file was placed anyway');
  const b = await imp(w, [['71_MRK_01.mp3', mp3('k1')], ['71_MRK_02.mp3', mp3('k2')], ['70_MAT_01.mp3', mp3('t1')]]);
  assert.deepEqual([b.res.chapters, b.res.unplaced.length], [3, 0], 'a consistently offset set was sent to the check screen');
  // two files for the same chapter: the second waits on the check screen instead of overwriting the first
  const c = await imp(w, [['John_3.mp3', mp3('first')], ['JHN_03.mp3', mp3('second')]]);
  assert.deepEqual([c.res.chapters, c.res.unplaced.length], [1, 1]);
  assert.equal(await bytesAt(w, c.id, 43, 3), 'first');
});

test('CHECK + NAME — Place moves an unplaced file (asking before replacing), Leave out deletes it, Save flips the row to READY and deletes _unplaced/', async () => {
  for (const native of [true, false]) {
    const w = storeWorld({ native });
    const { id, res } = await imp(w, [['John_3.mp3', mp3('j3')], ['mystery1.mp3', mp3('q1')], ['mystery2.mp3', mp3('q2')], ['mystery3.mp3', mp3('q3')]]);
    assert.equal(res.unplaced.length, 3);
    assert.deepEqual(await w.S.placeUnplaced(id, 1, 43, 3), { ok: false, exists: true }, 'placing on a taken chapter did not ask first');
    assert.equal(await bytesAt(w, id, 43, 3), 'j3');
    assert.deepEqual(await w.S.placeUnplaced(id, 1, 43, 3, { replace: true }), { ok: true });
    assert.equal(await bytesAt(w, id, 43, 3), 'q1', 'Replace did not replace');
    assert.deepEqual(await w.S.placeUnplaced(id, 2, 43, 4), { ok: true });
    assert.equal((await w.S.placeUnplaced(id, 3, 43, 99)).ok, false, 'a chapter John does not have was accepted');
    await w.S.leaveOut(id, 3);
    assert.deepEqual(w.S.row(id).unplaced, []);
    const done = await w.S.finishImport(id, { name: 'My <b>WEB</b>', lang: 'English', reader: 'Me', licence: 'free' });
    assert.equal(done.ok, true);
    const r = w.S.row(id);
    assert.deepEqual([r.state, r.chapters, r.name, r.licence, r.source, r.recording], ['ready', 2, 'My <b>WEB</b>', 'free', 'own', 'own-' + id]);
    assert.match(id, /^[0-9a-f]{16}$/, 'the id is not 16 hex characters');
    const left = native ? [...w.disk.keys()].filter(k => k.includes('_unplaced')) : [...w.idbData.keys()].filter(k => k.includes('_unplaced'));
    assert.deepEqual(left, [], (native ? 'phone' : 'web') + ': _unplaced/ survived Save');
    assert.ok(w.S.readySets().some(x => x.id === id));
  }
});

test('CAPS — a deflate bomb, an entry that says it is too big, too many entries and STORED-with-descriptor each abort and leave NOTHING behind', async () => {
  const big = new Uint8Array(65 * 1024 * 1024); big.set([0x49, 0x44, 0x33]);
  const cases = [
    ['bomb (sizes hidden behind a data descriptor)', [['40_Matthew_001.mp3', mp3('ok')], ['40_Matthew_002.mp3', big]], { descriptor: true }, 'entry-too-big'],
    ['entry that declares 65 MB', [['40_Matthew_002.mp3', big]], {}, 'entry-too-big'],
    ['5,001 entries', Array.from({ length: 5001 }, (_, i) => ['f' + i + '.txt', text('x')]), {}, 'too-many'],
    ['STORED with a data descriptor', [['40_Matthew_001.mp3', mp3('s')]], { descriptor: true, stored: true }, 'stored-descriptor'],
  ];
  for (const native of [true, false]) {
    for (const [label, entries, zip, reason] of cases) {
      const w = storeWorld({ native });
      const { id, res } = await imp(w, entries, { zip, chunk: 256 * 1024 });
      assert.deepEqual(res, { ok: false, reason }, label);
      assert.equal(w.S.row(id), null, label + ': the registry row was left');
      assert.equal(w.disk.size + w.idbData.size, 0, label + ': bytes were left behind');
    }
  }
});

test('ZIP SHAPES — DEFLATE with data descriptors, headers split across 3-byte chunks, still imports', async () => {
  const w = storeWorld({ native: true });
  const { id, res } = await imp(w, [['40_Matthew_001.mp3', mp3('a', 3000)], ['40_Matthew_002.mp3', mp3('b', 3000)]], { zip: { descriptor: true }, chunk: 3 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.chapters, 2);
  assert.equal(await bytesAt(w, id, 40, 2), 'b');
});

test('LOOSE FILES — several picked audio files go into one set; a picked file whose bytes are not audio is skipped', async () => {
  const w = storeWorld({ native: true });
  const id = await w.S.beginImport();
  const src = (name, u8) => ({ name, head: [], reader: readerOf(u8, 1000) });
  const res = await w.S.importSources(id, [src('Jhn_01.mp3', mp3('j1', 5000)), src('Jhn_02.mp3', mp3('j2', 5000)), src('Jhn_03.mp3', text('a text file'))]);
  assert.equal(res.ok, true);
  assert.deepEqual([res.chapters, res.skipped], [2, 1]);
  assert.equal(await bytesAt(w, id, 43, 2), 'j2');
});

test('CANCEL and RUNNING OUT OF SPACE — the set\'s folder and its row are deleted', async () => {
  const w = storeWorld({ native: true });
  let stop = false;
  const id = await w.S.beginImport();
  const z = zipOf(Array.from({ length: 20 }, (_, i) => ['40_Matthew_' + (i + 1) + '.mp3', mp3('m' + i, 20000)]));
  const r = w.S.importSources(id, [{ name: 'x.zip', head: [], reader: readerOf(z, 30000) }], { onProgress: (p) => { if (p.chapters >= 3) stop = true; }, getAborted: () => stop });
  assert.deepEqual(await r, { ok: false, reason: 'cancelled' });
  assert.deepEqual([w.S.row(id), w.disk.size], [null, 0]);
  const full = storeWorld({ native: true, fsOpts: { failWrite: (p) => /\/40\/3\./.test(p) } });
  const id2 = await full.S.beginImport();
  const r2 = await full.S.importSources(id2, [{ name: 'x.zip', head: [], reader: readerOf(z, 30000) }]);
  assert.deepEqual(r2, { ok: false, reason: 'no-space' });
  assert.deepEqual([full.S.row(id2), full.disk.size], [null, 0], 'a failed write left a half set');
});

// ──────────────── the boot sweep (N1, P3, B3) ────────────────
test('SWEEP, PHONE — a pending or unregistered folder is deleted, a ready set is kept (minus a leftover _unplaced/), audio/WEB is NEVER touched', async () => {
  const w = storeWorld({ native: true });
  const pend = await imp(w, [['John_1.mp3', mp3('p')]]);              // killed before Save: still pending
  const ready = await imp(w, [['John_2.mp3', mp3('r')], ['odd.mp3', mp3('o')]]);
  await w.S.finishImport(ready.id, { name: 'Kept' });
  w.disk.set('audio/' + ready.id + '/_unplaced/7.mp3', mp3('crash-after-ready'));   // B3: crash between "ready" and "delete _unplaced/"
  w.disk.set('audio/0123456789abcdef/43/1.mp3', mp3('orphan'));                      // no row at all
  w.disk.set('audio/WEB/43/1.mp3', mp3('web'));                                       // World English with NO registry row yet
  // relaunch: a fresh store over the same disk and localStorage
  const w2 = storeWorld({ native: true, ls: w.ls, disk: w.disk, idbData: w.idbData });
  await w2.S.boot();
  const keys = [...w2.disk.keys()].sort();
  assert.deepEqual(keys, ['audio/' + ready.id + '/43/2.mp3', 'audio/WEB/43/1.mp3'].sort());
  assert.equal(w2.S.row(pend.id), null, 'the pending row survived the sweep');
  assert.equal(w2.S.row(ready.id).state, 'ready');
});

test('SWEEP, WEB AND SUITE — the sweep runs there too, on IndexedDB keys: pending/absent ids go, WEB/… stays, no file call is made', async () => {
  const w = storeWorld({ native: false });
  const pend = await imp(w, [['John_1.mp3', mp3('p')]]);
  const ready = await imp(w, [['John_2.mp3', mp3('r')]]);
  await w.S.finishImport(ready.id, { name: 'Kept' });
  w.idbData.set(ready.id + '/_unplaced/4', new Blob([mp3('left')], { type: 'audio/mpeg' }));
  w.idbData.set('0123456789abcdef/1/1', new Blob([mp3('orphan')]));
  w.idbData.set('WEB/43/1', new Blob([mp3('web')], { type: 'audio/mpeg' }));
  const w2 = storeWorld({ native: false, ls: w.ls, idbData: w.idbData });
  await w2.S.boot();
  assert.deepEqual([...w2.idbData.keys()].sort(), [ready.id + '/43/2', 'WEB/43/1'].sort());
  assert.equal(w2.S.row(pend.id), null);
  assert.deepEqual(w2.fs.calls, [], 'the web build touched the Filesystem plugin');
});

// ──────────────── World English moves into file storage (Android) ────────────────
const seedWeb = (idbData, list) => { for (const [b, c] of list) idbData.set('WEB/' + b + '/' + c, new Blob([mp3('web' + b + '.' + c)], { type: 'audio/mpeg' })); };

test('MIGRATION — each chapter is written, checked, then its IndexedDB copy deleted; the WEB row (web-williams) is written first and cleared at the end', async () => {
  const idbData = new Map(); seedWeb(idbData, [[43, 1], [43, 2], [1, 1]]);
  const w = storeWorld({ native: true, idbData });
  const r = await w.S.migrateWeb();
  assert.equal(r.moved, 3);
  assert.deepEqual([...w.disk.keys()].sort(), ['audio/WEB/1/1.mp3', 'audio/WEB/43/1.mp3', 'audio/WEB/43/2.mp3']);
  assert.equal(idbData.size, 0);
  const row = w.S.row('WEB');
  assert.deepEqual([row.recording, row.source, row.state, row.migrating], ['web-williams', 'catalog', 'ready', false]);
  assert.equal(tagOf(w.disk.get('audio/WEB/43/2.mp3')), 'web43.2');
});

test('MIGRATION KILLED between write and delete → sweep → relaunch: every chapter is still there, in one store or the other, and none twice', async () => {
  const idbData = new Map(); seedWeb(idbData, [[43, 1], [43, 2], [43, 3], [43, 4]]);
  const ls = new Map(); const disk = new Map();
  // the process dies the moment chapter 3's file is in place (the rename happens, nothing after it): not an exception, a stop
  const w = storeWorld({ native: true, idbData, ls, disk, fsOpts: { hangAfter: (op, p) => op === 'rename' && p === 'audio/WEB/43/3.mp3' } });
  w.S.migrateWeb();
  await settle(60);
  assert.ok(disk.has('audio/WEB/43/3.mp3') && idbData.has('WEB/43/3'), 'the kill did not land between the write and the delete — re-anchor');
  assert.equal(JSON.parse(ls.get('trinityone.audioSets')).find(r => r.id === 'WEB').migrating, true);
  // relaunch: boot = the sweep, then the migration resumes
  const w2 = storeWorld({ native: true, idbData, ls, disk });
  const mid = await w2.S.listAll('WEB');
  assert.deepEqual([...mid.get(43)].sort(), [1, 2, 3, 4], 'mid-migration, play and Library do not see both stores');
  await w2.S.boot();
  assert.deepEqual([...disk.keys()].sort(), [1, 2, 3, 4].map(c => 'audio/WEB/43/' + c + '.mp3'), 'a chapter was lost or the sweep deleted World English');
  assert.equal(idbData.size, 0, 'a chapter is left in BOTH stores');
  for (const c of [1, 2, 3, 4]) assert.equal(tagOf(disk.get('audio/WEB/43/' + c + '.mp3')), 'web43.' + c);
  assert.equal(w2.S.row('WEB').migrating, false);
});

test('MIGRATION (B5) — if the WEB row cannot be written, nothing moves', async () => {
  const idbData = new Map(); seedWeb(idbData, [[43, 1]]);
  const w = storeWorld({ native: true, idbData });
  w.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  const r = await w.S.migrateWeb();
  assert.equal(r.reason, 'no-registry');
  assert.deepEqual([w.disk.size, idbData.size], [0, 1]);
});

test('THE GATE — web, the Suite and iOS (exclude-from-backup not built) stay on IndexedDB: migration never runs, imports go to IndexedDB keys', async () => {
  for (const env of [{ native: false }, { native: true, platform: 'ios' }]) {
    const idbData = new Map(); seedWeb(idbData, [[43, 1]]);
    const w = storeWorld({ ...env, idbData });
    assert.equal(w.S.filesOn(), false);
    await w.S.boot();
    assert.ok(idbData.has('WEB/43/1'), JSON.stringify(env) + ': World English left IndexedDB');
    assert.equal(w.S.row('WEB'), null, 'a WEB row was written where nothing migrates');
    const { id } = await imp(w, [['John_5.mp3', mp3('j5')]]);
    assert.ok(idbData.has(id + '/43/5'), 'the import did not use IndexedDB key <id>/<book>/<chap>');
    assert.equal(w.disk.size, 0);
    assert.deepEqual(w.fs.calls, []);
  }
  assert.equal(storeWorld({ native: true, platform: 'android' }).S.filesOn(), true, 'Android does not use file storage');
});

test('REMOVE (B2) — the row goes pending, then the files, then the row; the space freed is reported; the voice falls back to Berean Standard', async () => {
  const w = storeWorld({ native: true });
  const { id } = await imp(w, [['John_1.mp3', mp3('a', 1000)], ['John_2.mp3', mp3('b', 3000)]]);
  await w.S.finishImport(id, { name: 'Mine' });
  w.ls.set('trinityone.audioVoice', JSON.stringify(id + '/david'));
  const seen = [];
  const rmdir = w.fs.Filesystem.rmdir;
  w.fs.Filesystem.rmdir = async (a) => { seen.push(w.S.row(id) && w.S.row(id).state); return rmdir(a); };
  const r = await w.S.removeSet(id);
  assert.deepEqual(r, { ok: true, bytes: 4000 });
  assert.deepEqual(seen, ['pending'], 'the files were deleted while the row still said ready');
  assert.deepEqual([w.S.row(id), w.disk.size], [null, 0]);
  assert.equal(JSON.parse(w.ls.get('trinityone.audioVoice')), 'BSB/david');
  assert.equal((await w.S.removeSet('WEB')).ok, false, 'Remove can delete World English through the own-set path');
});

// ════════════════ build audit 2026-11-18 fixes (AUDIT-build-audio-bibles-own-2026-11-18.md) ════════════════
const BIG = 3 * 1024 * 1024;

test('AUDIT #1 — a chapter write that fails part-way (phone full) leaves NO file: not counted, not "Downloaded", fetched again next time', async () => {
  let full = true;
  const w = storeWorld({ native: true, fsOpts: { failWrite: (p, op) => full && op === 'appendFile' } });
  await assert.rejects(w.S.putWebChapter(40, 3, mp3('w403', BIG)), /ENOSPC/);
  assert.deepEqual([...w.disk.keys()], [], 'a part-written file (or its .part) was left behind');
  assert.equal(await w.S.hasChapter('WEB', 40, 3), false, 'a half-written chapter counts as present');
  full = false;
  await w.S.putWebChapter(40, 3, mp3('w403', BIG));
  assert.equal(w.disk.get('audio/WEB/40/3.mp3').length, BIG);
});

test('AUDIT #1 — a write KILLED part-way leaves only a .part: it never counts, and the boot sweep deletes it without touching finished files', async () => {
  const disk = new Map(), ls = new Map();
  const w = storeWorld({ native: true, disk, ls, fsOpts: { hang: (op, p) => op === 'appendFile' && /\/40\/4\.mp3(\.part)?$/.test(p) } });
  await w.S.putWebChapter(40, 3, mp3('done', 1000));
  w.S.putWebChapter(40, 4, mp3('dies', BIG));
  await settle(40);
  assert.ok(disk.has('audio/WEB/40/4.mp3.part') || disk.has('audio/WEB/40/4.mp3'), 're-anchor: the kill did not land mid-write');
  assert.equal(disk.has('audio/WEB/40/4.mp3'), false, 'the half-written chapter sits under its final name');
  assert.deepEqual((await w.S.listBook('WEB', 40)).map(x => x.chap), [3], 'a .part file counts as a chapter');
  const w2 = storeWorld({ native: true, disk, ls });
  await w2.S.boot();
  assert.deepEqual([...disk.keys()], ['audio/WEB/40/3.mp3'], 'the sweep did not clear the .part, or deleted a finished chapter');
  assert.equal(tagOf(disk.get('audio/WEB/40/3.mp3')), 'done');
});

test('AUDIT #1 — migration: a chapter whose file write fails keeps its IndexedDB copy, and nothing on disk hides it', async () => {
  const idbData = new Map();
  idbData.set('WEB/43/1', new Blob([mp3('web43.1', BIG)], { type: 'audio/mpeg' }));
  const w = storeWorld({ native: true, idbData, fsOpts: { failWrite: (p, op) => op === 'appendFile' } });
  const r = await w.S.migrateWeb();
  assert.equal(r.stopped, true);
  assert.ok(idbData.has('WEB/43/1'), 'the IndexedDB copy was deleted although the file never landed');
  assert.deepEqual([...w.disk.keys()], []);
  const b = await w.S.chapterBlob('WEB', 43, 1);
  assert.equal(b.size, BIG, 'playback does not get the whole chapter');
});

test('AUDIT #2 — an import waits only for the boot SWEEP, not for World English moving', async () => {
  const idbData = new Map(); seedWeb(idbData, [[43, 1], [43, 2]]);
  const w = storeWorld({ native: true, idbData, fsOpts: { hang: (op, p) => op === 'writeFile' && /^audio\/WEB\//.test(p) } });
  w.S.boot();                                    // the move starts and never finishes
  const id = await Promise.race([w.S.beginImport(), settle(80).then(() => 'STILL WAITING')]);
  assert.match(String(id), /^[0-9a-f]{16}$/, 'Add your own is held up by the World English move');
  const res = await w.S.importSources(id, [{ name: 'x.zip', head: [], reader: readerOf(zipOf([['John_5.mp3', mp3('j5')]])) }]);
  assert.equal(res.chapters, 1);
});

test('AUDIT #3 — a set numbered as one running track count (001 Genesis 1 … 090 Exodus 40) is placed, not sent to the check screen', async () => {
  const w = storeWorld();
  const files = [];
  for (let c = 1; c <= 50; c++) files.push([String(c).padStart(3, '0') + ' Genesis ' + c + '.mp3', mp3('g' + c)]);
  for (let c = 1; c <= 40; c++) files.push([String(50 + c).padStart(3, '0') + ' Exodus ' + c + '.mp3', mp3('e' + c)]);
  const { id, res } = await imp(w, files);
  assert.deepEqual([res.chapters, res.books, res.unplaced.length], [90, 2, 0]);
  assert.equal(await bytesAt(w, id, 2, 40), 'e40');
});

test('AUDIT #4 — book-folder layouts and Faith Comes By Hearing / Bible.is names', () => {
  const { S } = storeWorld();
  const want = {
    'Genesis/01.mp3': [1, 1], '01 Genesis/001.mp3': [1, 1], 'Psalms/150.mp3': [19, 150], 'My Bible/43 John/John 03.mp3': [43, 3],
    'B01___01_Matthew_____ENGKJVN1DA.mp3': [40, 1],         // confirmed shape (SIL Scripture App Builder forum, FCBH files)
    'A01___01_Genesis_____ENGKJVO1DA.mp3': [1, 1], 'B27___22_Revelation__ENGKJVN1DA.mp3': [66, 22], 'B07___16_1Corinthians_ENGESVN2DA.mp3': [46, 16],
    'A19__150_Psalms______ENGKJVO1DA.mp3': [19, 150],        // 3-digit chapter: assumed from the fixed-width pattern, not seen
  };
  for (const [name, [book, chap]] of Object.entries(want)) {
    const m = S.matchName(name);
    assert.ok(m, name + ' was not recognised');
    assert.deepEqual([m.book, m.chap], [book, chap], name);
  }
  for (const bad of ['B28___01_Nothing_____ENGKJVN1DA.mp3', 'A01___51_Genesis_____ENGKJVO1DA.mp3', 'Genesis/notes.mp3', 'disc1/track01.mp3']) assert.equal(S.matchName(bad), null, bad);
});

test('AUDIT #5 — the MP3 check wants ID3 or a real MPEG layer II/III frame: FF FE (UTF-16 BOM), FF FF and other near-misses are not audio', () => {
  const { S } = storeWorld();
  const b = (...x) => new Uint8Array([...x, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  for (const ok of [b(0xFF, 0xFB, 0x90), b(0xFF, 0xFA, 0x90), b(0xFF, 0xF3, 0x64), b(0xFF, 0xE3, 0x18), b(0xFF, 0xFD, 0x90) /* layer II */, b(0x49, 0x44, 0x33, 4)]) assert.equal(S.sniff(ok), 'mp3', [...ok.slice(0, 3)].map(x => x.toString(16)).join(' '));
  for (const no of [b(0xFF, 0xFE, 0x52, 0x00), b(0xFF, 0xFF, 0xFF, 0xFF), b(0xFF, 0xFB, 0xF0) /* bitrate 15 */, b(0xFF, 0xFB, 0x9C) /* sample rate 3 */, b(0xFF, 0xEB, 0x90) /* version reserved */, b(0xFF, 0xD8, 0xFF, 0xE0) /* JPEG */])
    assert.equal(S.sniff(no), null, [...no.slice(0, 3)].map(x => x.toString(16)).join(' ') + ' was taken for MP3');
});

test('AUDIT #6 — the 3 GB total and the 4 GB raw limits abort and leave nothing (limits lowered through the store\'s caps object); a zip64 entry under the caps imports', async () => {
  for (const [cap, value, reason] of [['total', 150, 'too-big'], ['raw', 400, 'over-4gb']]) {
    for (const native of [true, false]) {
      const w = storeWorld({ native });
      w.S.caps[cap] = value;
      const { id, res } = await imp(w, [['John_1.mp3', mp3('a', 100)], ['John_2.mp3', mp3('b', 100)], ['John_3.mp3', mp3('c', 100)]], { zip: { stored: true }, chunk: 64 });
      assert.deepEqual(res, { ok: false, reason }, cap);
      assert.deepEqual([w.S.row(id), w.disk.size + w.idbData.size], [null, 0], cap + ': something was left');
    }
  }
  // a hand-built zip64 local header: sizes 0xFFFFFFFF in the header, the real ones in a zip64 extra field
  const data = mp3('z64', 200), name = text('John_9.mp3');
  const h = new Uint8Array(30 + name.length + 20); const dv = new DataView(h.buffer);
  dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 45, true); dv.setUint32(18, 0xFFFFFFFF, true); dv.setUint32(22, 0xFFFFFFFF, true);
  dv.setUint16(26, name.length, true); dv.setUint16(28, 20, true); h.set(name, 30);
  const x = 30 + name.length; dv.setUint16(x, 1, true); dv.setUint16(x + 2, 16, true); dv.setBigUint64(x + 4, BigInt(data.length), true); dv.setBigUint64(x + 12, BigInt(data.length), true);
  const z = new Uint8Array(h.length + data.length); z.set(h); z.set(data, h.length);
  const w = storeWorld({ native: true });
  const id = await w.S.beginImport();
  const res = await w.S.importSources(id, [{ name: 'z.zip', head: [], reader: readerOf(z, 50) }]);
  assert.deepEqual([res.ok, res.chapters], [true, 1], 'a zip64 entry under the caps did not import');
  assert.equal(await bytesAt(w, id, 43, 9), 'z64');
});

test('AUDIT #7 — Save with unplaced files STILL LEFT deletes them (phone and web)', async () => {
  for (const native of [true, false]) {
    const w = storeWorld({ native });
    const { id, res } = await imp(w, [['John_3.mp3', mp3('j3')], ['mystery.mp3', mp3('q')], ['other.mp3', mp3('o')]]);
    assert.equal(res.unplaced.length, 2);
    const before = native ? [...w.disk.keys()] : [...w.idbData.keys()];
    assert.equal(before.filter(k => k.includes('_unplaced')).length, 2, 're-anchor: no unplaced files before Save');
    assert.equal((await w.S.finishImport(id, { name: 'X' })).ok, true);
    const left = (native ? [...w.disk.keys()] : [...w.idbData.keys()]).filter(k => k.includes('_unplaced'));
    assert.deepEqual(left, [], (native ? 'phone' : 'web') + ': unplaced files survived Save');
    assert.equal(await bytesAt(w, id, 43, 3), 'j3');
  }
});

// ════════════════ re-audit 2026-11-18 (AUDIT-build-audio-bibles-own-fixes-2026-11-18.md) N1–N3 ════════════════
test('RE-AUDIT N1 — only the folder DIRECTLY above the file, and only when its whole name is a book: a reader\'s name never picks the book', async () => {
  const { S } = storeWorld();
  for (const bad of ['Read by John Doe/01.mp3', 'Mark Smith reads the Bible/Disc 1/Track 07.mp3', 'John Doe/Genesis notes/01.mp3']) assert.equal(S.matchName(bad), null, bad + ' was filed without the check screen');
  for (const [name, bc] of Object.entries({ 'Genesis/01.mp3': [1, 1], '01 Genesis/001.mp3': [1, 1], 'Psalms/150.mp3': [19, 150], 'Read by John Doe/02_Exodus/03.mp3': [2, 3], 'Mark Smith/Matthew/Track 07.mp3': [40, 7] })) {
    const m = S.matchName(name); assert.ok(m, name); assert.deepEqual([m.book, m.chap], bc, name);
  }
  // at the point of use: such files go to the check screen
  const w = storeWorld();
  const { res } = await imp(w, [['Read by John Doe/01.mp3', mp3('a')], ['Mark Smith reads the Bible/Disc 1/Track 07.mp3', mp3('b')]]);
  assert.deepEqual([res.chapters, res.unplaced.length], [0, 2]);
});

test('RE-AUDIT N2 — an FCBH-shaped name must name THAT book: "A05_2_track" is not Deuteronomy 2', () => {
  const { S } = storeWorld();
  assert.equal(S.matchName('A05_2_track.mp3'), null);
  assert.equal(S.matchName('B01___01_Genesis_____ENGKJVN1DA.mp3'), null, 'B01 is Matthew, not Genesis');
  const m = S.matchName('A05___02_Deuteronomy_ENGKJVO1DA.mp3'); assert.deepEqual([m.book, m.chap], [5, 2]);
  const t = S.matchName('B13___02_1Thess_______ENGKJVN1DA.mp3'); assert.deepEqual([t && t.book, t && t.chap], [52, 2], 'a book name cut short to fit is refused');
});

test('RE-AUDIT N3 — where rename will not overwrite, the old copy is set aside, never deleted first: a rewrite lands, a failed rename keeps the old copy, a kill is repaired at boot', async () => {
  // 1. rewrite over an existing chapter on a platform whose rename refuses an existing target
  const a = storeWorld({ native: true, fsOpts: { noOverwrite: true } });
  await a.S.putWebChapter(43, 1, mp3('old', 500));
  await a.S.putWebChapter(43, 1, mp3('new', 700));
  assert.deepEqual([...a.disk.keys()], ['audio/WEB/43/1.mp3']);
  assert.equal(tagOf(a.disk.get('audio/WEB/43/1.mp3')), 'new');
  // 2. the second rename fails: the good old copy is still in place, nothing extra left
  const b = storeWorld({ native: true, fsOpts: { noOverwrite: true, failRename: (from, to) => from.endsWith('.part') && b.disk.has('audio/WEB/43/1.mp3.old') } });
  await b.S.putWebChapter(43, 1, mp3('old', 500));
  await assert.rejects(b.S.putWebChapter(43, 1, mp3('new', 700)));
  assert.deepEqual([...b.disk.keys()], ['audio/WEB/43/1.mp3'], 'the only good copy was lost or a leftover stayed');
  assert.equal(tagOf(b.disk.get('audio/WEB/43/1.mp3')), 'old');
  // 3. killed right after the old copy was set aside: at boot the .old (now the only copy) goes back; the .part is swept
  const disk = new Map(), ls = new Map();
  const c = storeWorld({ native: true, disk, ls, fsOpts: { noOverwrite: true, hangAfter: (op, p) => op === 'rename' && p.endsWith('.old') } });
  await c.S.putWebChapter(43, 1, mp3('old', 500));
  c.S.putWebChapter(43, 1, mp3('new', 700)); await settle(40);
  assert.deepEqual([...disk.keys()].sort(), ['audio/WEB/43/1.mp3.old', 'audio/WEB/43/1.mp3.part'], 're-anchor: the kill did not land between the two renames');
  await storeWorld({ native: true, disk, ls }).S.boot();
  assert.deepEqual([...disk.keys()], ['audio/WEB/43/1.mp3']);
  assert.equal(tagOf(disk.get('audio/WEB/43/1.mp3')), 'old');
});

// ════════════════ round-3 audit N5: a numbered book is not "John" ════════════════
test('ROUND-3 N5 — "1 John", "2 John", "3 John", "1 Kings" folders and file names land in THAT book, never in John or Kings by a dropped number', async () => {
  const { S } = storeWorld();
  const want = {
    '1 John/01.mp3': [62, 1], '2 John/01.mp3': [63, 1], '3 John/01.mp3': [64, 1], '01_1John/01.mp3': [62, 1], '1 Kings/03.mp3': [11, 3],
    '01 Genesis/001.mp3': [1, 1], 'Genesis/01.mp3': [1, 1], 'I John/02.mp3': [62, 2], 'II Kings/04.mp3': [12, 4],
    // file names, same trap
    '1 John 3.mp3': [62, 3], '1John_03.mp3': [62, 3], '01_1John_02.mp3': [62, 2], 'I John 4.mp3': [62, 4], 'II_Kings_05.mp3': [12, 5],
    'First Samuel 7.mp3': [9, 7], '3 John.mp3': [64, 1], '62_1John_05.mp3': [62, 5],
  };
  for (const [name, [book, chap]] of Object.entries(want)) {
    const m = S.matchName(name);
    assert.ok(m, name + ' was not recognised');
    assert.deepEqual([m.book, m.chap], [book, chap], name);
  }
  // on import, the 1 John folder fills 1 John, and John stays empty
  const w = storeWorld();
  const { id } = await imp(w, [['1 John/01.mp3', mp3('1j1')], ['1 John/02.mp3', mp3('1j2')]]);
  assert.deepEqual(await w.S.listBook(id, 43), [], '1 John was filed under John');
  assert.equal(await bytesAt(w, id, 62, 2), '1j2');
});

// ════════════════ round-4 audit N6: Roman prefixes only on full book names ════════════════
test('ROUND-4 N6 — "I Sa 3", "Ich 3", "Iki 2", "Ico 2" are never a wrong book; "Ich_Genesis_01" is Genesis 1; the digit forms still work', async () => {
  const { S } = storeWorld();
  for (const name of ['I Sa 3.mp3', 'Ich 3.mp3', 'Iki 2.mp3', 'Ico 2.mp3']) {
    const m = S.matchName(name);
    const right = { 'I Sa 3.mp3': [9, 3], 'Ich 3.mp3': [13, 3], 'Iki 2.mp3': [11, 2], 'Ico 2.mp3': [46, 2] }[name];
    assert.ok(m === null || (m.book === right[0] && m.chap === right[1]), name + ' was filed as book ' + (m && m.book) + ' chapter ' + (m && m.chap));
  }
  const g = S.matchName('Ich_Genesis_01.mp3'); assert.deepEqual([g && g.book, g && g.chap], [1, 1]);
  for (const [name, bc] of Object.entries({ '1Co_02.mp3': [46, 2], '1 Sa 3.mp3': [9, 3], '1Ch_03.mp3': [13, 3], 'IJohn_2.mp3': [62, 2], 'I Samuel 4.mp3': [9, 4], 'III John.mp3': [64, 1], 'Isa 53.mp3': [23, 53], 'I Kings/06.mp3': [11, 6] })) {
    const m = S.matchName(name); assert.ok(m, name); assert.deepEqual([m.book, m.chap], bc, name);
  }
});
