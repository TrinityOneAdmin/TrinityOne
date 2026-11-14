// INSTALL A BIBLE FROM A FILE — THE ENGINE HALF (Bible.installFromBytes and the picker that feeds it).
// Run: node --test scripts/install-bible-from-file-engine.test.mjs
//
// WHAT THIS IS. The member app's receiving side: a Bible, commentary or dictionary arrives as a file (Signal, Quick
// Share, Bluetooth, a cable) and has to go onto the phone SAFELY. Plan, audit and mockups:
// TrinityOne-internal/reference/{PLAN,AUDIT-PLAN,MOCKUPS}-install-bible-from-file-2026-11-14.html. The screens are
// tested in install-bible-from-file-screens.test.mjs; this file is everything under them.
//
// WHAT RUNS FOR REAL (rules 1 and 3 — no assertion matches text in app/*.jsx or engine.js):
//   · the real engine.js, whole, in a vm, over an in-memory IndexedDB and localStorage (stores, not deciders — the
//     assertions read them afterwards), with the real vendored fflate and sql.js;
//   · real modules from modules/ (a USFM zip, a MySword .bbl.mybible, a .cmt.mybible.zip) and bytes built with the
//     app's own sql.js / fflate for the rest; real NON-modules (a PNG, a PDF, random bytes, an empty file, a zip of
//     photos, JSON that is not a cross-reference set) for the refusals;
//   · the real share-app.jsx (isShareableModule, shareOneFile) for "what leaves the phone again".
// FAKED, and named: the network (fetch serves catalog.json and modules/engbsb.zip from disk, with an optional delay),
// the Capacitor Filesystem/Share plugins (they record what they are given), IndexedDB itself (a Map).
//
// USERS OF THE SHARED CODE THIS TOUCHES (rule 2): see the commit message. pickFile (4 places), ensureInput, the
// _error writers, restoreInstalled/exportModule/shareOneFile (the key's last part), addSource/addCommentary (never
// reached with a name that is held), autoLoad (waited on, not edited).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { loadScreen } from './render-jsx-screen.mjs';

import { realFflate, file, enc, sleep, newStores, records, cached, phone, readyPhone, until, usfmBook, usfmZip, sqliteBytes, bibleSql, bibleDb, dictDb, VIEW_BOMB, crossrefJson, sha, held, KEY, initSqlJs, ROOT } from './install-bible-harness.mjs';
const shareable = loadScreen('app/share-app.jsx', ['isShareableModule', 'shareOneFile'], { React: {}, window: {}, btoa }).isShareableModule;


// ════════════════════════════════ 1. real modules install, and are shareable again ═════════════════════════════

test('E1 — a USFM zip, a .bbl.mybible, a .cmt.mybible.zip, a SQLite dictionary and a cross-reference file install with the right kind, saved under imported/<hash>/<clean name>', async () => {
  const p = await readyPhone();
  const cases = [
    ['eng-kjv.zip', file('modules/eng-kjv.zip'), 'bible', 'bibles', /\.zip$/],
    ['eng-akjv.bbl.mybible', file('modules/eng-akjv.bbl.mybible'), 'bible', 'bibles', /\.bbl\.mybible$/],
    ['adam-clarke.cmt.mybible.zip', file('modules/adam-clarke.cmt.mybible.zip'), 'comment', 'commentaries', /\.cmt\.mybible\.zip$/],
    ['easton.dct.mybible', await dictDb('EAS', 'Easton Bible Dictionary'), 'dict', 'dictionaries', /\.dct\.mybible$/],
    ['my-refs.json', crossrefJson('MYX', 'My cross references'), 'crossref', 'crossrefs', /\.json$/],
  ];
  for (const [name, bytes, kind, cat, ext] of cases) {
    const r = await p.Bible.installFromBytes(bytes, name);
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r)}`);
    assert.equal(r.kind, kind, `${name} was filed as ${r.kind}`);
    const h12 = (await sha(bytes)).slice(0, 12);
    const rec = Object.values(p.installed()).find(x => x.abbr === r.abbr && x.category === cat);
    assert.ok(rec, `${name}: no installed record of category ${cat}`);
    assert.match(rec.url, KEY, `${name}: key ${rec.url} is not imported/<hash>/<clean>.<ext>`);
    assert.ok(rec.url.startsWith('imported/' + h12 + '/'), `${name}: the key is not made from the bytes' hash`);
    assert.match(rec.url, ext, `${name}: extension does not match what the file turned out to be`);
    assert.ok(cached(p.state, rec.url) && cached(p.state, rec.url).length === bytes.length, `${name}: the bytes were not saved under ${rec.url}`);
    if (kind !== 'crossref') assert.equal(shareable(rec), true, `${name}: its own Share button would not be offered`);
  }
  // and the Bible really reads
  const kjv = p.Bible.versions().find(v => v.name !== undefined && /kjv/i.test(v.abbr + v.name));
  assert.ok(p.Bible.getVerses(1, 1, kjv.abbr).length > 5, 'the installed KJV has no Genesis 1');
});

test('E2 — real NON-modules are refused, and refusing leaves nothing behind: no module, no cached bytes, no record', async () => {
  const p = await readyPhone();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(300).fill(7)]);
  const pdf = enc('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n' + 'x'.repeat(500));
  const noise = webcrypto.getRandomValues(new Uint8Array(4096));
  const photos = realFflate.zipSync({ 'IMG_1.jpg': png, 'IMG_2.jpg': noise });
  const notXref = enc(JSON.stringify({ hello: 'world', meta: { kind: 'shopping' } }));
  const before = held(p.Bible), putsBefore = p.state.puts.length, recsBefore = JSON.stringify(p.installed());
  for (const [what, bytes] of [['a PNG', png], ['a PDF', pdf], ['random bytes', noise], ['an empty file', new Uint8Array(0)], ['a zip of photos', photos], ['JSON that is not a cross-reference set', notXref]]) {
    const r = await p.Bible.installFromBytes(bytes, 'whatever.zip');
    assert.deepEqual(r, { ok: false, reason: 'unusable' }, `${what}: ${JSON.stringify(r)}`);
  }
  assert.equal(held(p.Bible), before, 'a refused file registered a module');
  assert.equal(p.state.puts.length, putsBefore, 'a refused file wrote bytes into the cache');
  assert.equal(JSON.stringify(p.installed()), recsBefore, 'a refused file left an installed record');
  assert.equal(p.Bible._error, null, 'a refused file wrote Bible._error (the old silent-failure channel)');
});

// ════════════════════════════════ 2. the caps ═══════════════════════════════════════════════════════════════════

test('E3 — RAW CAP: 50 MB + 1 is refused as too-big and fflate is never asked to open it', async () => {
  const calls = [];
  const p = await readyPhone({ unzipCalls: calls });
  const big = new Uint8Array(50 * 1024 * 1024 + 1); big.set([0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual(await p.Bible.installFromBytes(big, 'huge.zip'), { ok: false, reason: 'too-big' });
  assert.deepEqual([...calls], [], 'unzipSync was called on a file over the raw cap');
});

test('E4 — INFLATE CAP: a small zip whose central directory claims > 128 MB is refused by the header-only pass, with nothing inflated', async () => {
  const calls = [];
  const p = await readyPhone({ unzipCalls: calls });
  const z = realFflate.zipSync({ 'a.usfm': enc(usfmBook('GEN', 'x')) });
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let cd = -1; for (let i = z.length - 4; i >= 0; i--) if (dv.getUint32(i, true) === 0x02014b50) { cd = i; break; }
  assert.ok(cd > 0, 'no central directory header found in the fixture');
  dv.setUint32(cd + 24, 200 * 1024 * 1024, true);   // declared uncompressed size
  assert.deepEqual(await p.Bible.installFromBytes(z, 'bomb.zip'), { ok: false, reason: 'too-big' });
  assert.deepEqual([...calls], ['filter'], 'something other than the header-only pass opened the zip: ' + calls);
});

test('E5 — ENTRY CAP: a zip of 2,001 tiny entries is refused before anything is inflated', async () => {
  const calls = [];
  const p = await readyPhone({ unzipCalls: calls });
  const files = {}; for (let i = 0; i < 2001; i++) files['f' + i + '.txt'] = new Uint8Array([49]);
  const z = realFflate.zipSync(files, { level: 0 });
  assert.deepEqual(await p.Bible.installFromBytes(z, 'many.zip'), { ok: false, reason: 'unusable' });
  assert.deepEqual([...calls], ['filter']);
  // and exactly 2,000 passes this guard (then fails later as "not a module", never as a cap)
  const f2 = {}; for (let i = 0; i < 2000; i++) f2['f' + i + '.txt'] = new Uint8Array([49]);
  const calls2 = []; const p2 = await readyPhone({ unzipCalls: calls2 });
  await p2.Bible.installFromBytes(realFflate.zipSync(f2, { level: 0 }), 'many.zip');
  assert.ok(calls2.length > 1, 'a 2,000-entry zip was stopped by the entry cap — the cap is below 2,000');
});

test('E6 — A VIEW OR A TRIGGER IS REFUSED, bare or inside a zip, fast; a normal module still installs', async () => {
  const p = await readyPhone();
  const bomb = await sqliteBytes(VIEW_BOMB);
  const trig = await sqliteBytes(bibleSql('TRG', 'Trigger Bible') + 'CREATE TRIGGER t AFTER INSERT ON Bible BEGIN SELECT 1; END;');
  const cases = [['a bare view', bomb], ['a view inside a zip', realFflate.zipSync({ 'evil.bbl.mybible': bomb })],
    ['a bare trigger', trig], ['a trigger inside a zip', realFflate.zipSync({ 'x.bbl.mybible': trig })],
    ['a view in a database with an odd name inside a zip', realFflate.zipSync({ 'data.bin': bomb })]];
  const before = held(p.Bible);
  for (const [what, bytes] of cases) {
    const t0 = Date.now();
    const r = await p.Bible.installFromBytes(bytes, 'x.bbl.mybible');
    assert.deepEqual(r, { ok: false, reason: 'unusable' }, `${what}: ${JSON.stringify(r)}`);
    assert.ok(Date.now() - t0 < 2500, `${what}: took ${Date.now() - t0} ms — the hostile query ran`);
  }
  assert.equal(held(p.Bible), before);
  assert.equal(Object.keys(p.installed()).length, 0);
  const ok = await p.Bible.installFromBytes(await bibleDb('OKB', 'A fine Bible'), 'fine.bbl.mybible');
  assert.equal(ok.ok, true, 'a normal module no longer installs');
});

// ════════════════════════════════ 3. identity: the bytes, never the name ═══════════════════════════════════════

test('E7 — (a)(b) THE SAME BYTES TWICE: "already here", ONE write, even under another file name', async () => {
  const p = await readyPhone();
  const bytes = await bibleDb('TWC', 'Twice Bible');
  const a = await p.Bible.installFromBytes(bytes, 'one.bbl.mybible');
  assert.equal(a.ok && !a.already, true);
  const putsAfterFirst = p.state.puts.length;
  const b = await p.Bible.installFromBytes(bytes, 'one.bbl.mybible');
  const c = await p.Bible.installFromBytes(bytes, 'something-else.bbl.mybible');
  for (const r of [b, c]) { assert.equal(r.ok, true); assert.equal(r.already, true); assert.equal(r.name, a.name); assert.equal(r.abbr, a.abbr); }
  assert.equal(p.state.puts.length, putsAfterFirst, 'an identical file was written again');
  assert.equal(Object.keys(p.installed()).length, 1, 'an identical file made a second record');
  assert.equal(p.Bible.versions().length, 1);
});

test('E8 — (c) TWO DIFFERENT USFM BIBLES WITH NO FILE NAME: both install, neither replaces the other', async () => {
  const p = await readyPhone();
  const a = await p.Bible.installFromBytes(usfmZip('GEN', 'FIRST Bible verse'), '');
  const b = await p.Bible.installFromBytes(usfmZip('GEN', 'SECOND Bible verse'), '');
  assert.equal(a.ok && b.ok, true, JSON.stringify([a, b]));
  assert.notEqual(a.abbr, b.abbr);
  assert.notEqual(a.name, b.name);
  assert.match(b.name, /\(from a file\)/);
  assert.equal(b.renamed, true);
  assert.equal(p.Bible.versions().length, 2, 'the second Bible replaced the first in memory');
  assert.match(p.Bible.getVerses(1, 1, a.abbr)[0].text, /FIRST/);
  assert.match(p.Bible.getVerses(1, 1, b.abbr)[0].text, /SECOND/);
  assert.equal(Object.keys(p.installed()).length, 2, 'the second Bible overwrote the first one\'s record or bytes');
});

test('E9 — (d) A MYSWORD FILE THAT COPIES AN INSTALLED BIBLE\'S ABBREVIATION AND DESCRIPTION cannot take its place', async () => {
  const p = await readyPhone();
  const real = await p.Bible.installFromBytes(await bibleDb('TRU', 'The True Bible', 'GENUINE text'), 'true.bbl.mybible');
  assert.equal(real.ok, true);
  const forged = await p.Bible.installFromBytes(await bibleDb('TRU', 'The True Bible', 'ALTERED text'), 'true.bbl.mybible');
  assert.equal(forged.ok, true, JSON.stringify(forged));
  assert.equal(forged.renamed, true);
  assert.match(forged.name, /^The True Bible \(from a file\)$/);
  assert.notEqual(forged.abbr, real.abbr);
  assert.equal(p.Bible.versions().length, 2);
  assert.match(p.Bible.getVerses(1, 1, real.abbr)[0].text, /GENUINE/, 'the genuine Bible now reads the forged text');
  assert.match(p.Bible.getVerses(1, 1, forged.abbr)[0].text, /ALTERED/);
  // it stays that way after a restart: both records, both names, nothing swapped
  const again = phone({ state: p.state }); await again.boot();
  assert.match(again.Bible.getVerses(1, 1, real.abbr)[0].text, /GENUINE/);
  assert.match(again.Bible.getVerses(1, 1, forged.abbr)[0].text, /ALTERED/);
});

test('E10 — a file may not borrow a CATALOGUE Bible\'s name even before that Bible is installed', async () => {
  const p = await readyPhone();
  const r = await p.Bible.installFromBytes(await bibleDb('KJV', 'King James Version', 'ALTERED'), 'kjv.bbl.mybible');
  assert.equal(r.ok, true);
  assert.equal(r.renamed, true, 'a file called "King James Version" took the catalogue\'s name');
  assert.match(r.name, /\(from a file\)/);
  assert.notEqual(r.abbr, 'KJV');
});

test('E11 — (e) THE REAL BSB BYTES TAKE THE CATALOGUE\'S NAME, and on a phone that already has BSB it is "already here"', async () => {
  const bsb = file('modules/engbsb.zip');
  assert.equal(await sha(bsb), 'a7f61bf7986aa11cf3ced7044af79dadce029053573ce99703c2a8d66601e41b', 'engbsb.zip is no longer the pinned build — re-anchor');
  const p = await readyPhone();
  const r = await p.Bible.installFromBytes(bsb, '');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.name, 'Berean Standard Bible');
  assert.equal(r.abbr, 'BSB');
  assert.equal(r.renamed, false);
  assert.deepEqual(Object.keys(p.installed()), ['modules/engbsb.zip'], 'pinned bytes are filed as the catalogue module (audit L2)');

  // a phone that got BSB the catalogue way: the file is the same bytes
  const q = await readyPhone({ serveBsb: true });
  await until(() => q.Bible.versions().length === 1 && q.installed()['modules/engbsb.zip']);   // boot installs the default BSB
  const putsBefore = q.state.puts.length;
  const again = await q.Bible.installFromBytes(bsb, 'BSB-bible.zip');
  assert.equal(again.ok && again.already, true, JSON.stringify(again));
  assert.equal(again.name, 'Berean Standard Bible');
  assert.equal(q.state.puts.length, putsBefore, 'a received BSB was saved a second time');
  assert.equal(q.Bible.versions().length, 1, 'BSB and BSB2');
});

test('E12 — (f) A USFM BIBLE IS NAMED FROM ITS OWN FILE: an \\id text that holds up, else the file name, else "USFM Bible"; \\toc1 and \\h are book titles (audit M3 retired them as fallbacks)', async () => {
  const names = async (zip, hint = '') => { const p = await readyPhone(); const r = await p.Bible.installFromBytes(zip, hint); assert.equal(r.ok, true, JSON.stringify(r)); return r.name; };
  assert.equal(await names(usfmZip('GEN - Berean Study Guide', 'v', '\\h Genesis\n\\toc1 The First Book\n')), 'Berean Study Guide', '\\id text is the Bible\'s name');
  assert.equal(await names(usfmZip('GEN Genesis', 'v', '\\h Genesis\n'), 'eng-kjv.zip'), 'eng-kjv', 'a \\id that just repeats the book title (as the shipped KJV does) was taken as the Bible\'s name');
  assert.equal(await names(usfmZip('GEN Genesis', 'v')), 'USFM Bible', 'nothing to go on: the plain fallback');
  assert.equal(await names(usfmZip('GEN', 'v', '\\h Genesis\n\\toc1 The First Book of Moses\n')), 'USFM Bible', '\\toc1 is a book title, not a Bible name');
  assert.equal(await names(usfmZip('GEN', 'v', '\\h Genesis\n')), 'USFM Bible', '\\h is a book title, not a Bible name');
  assert.equal(await names(usfmZip('GEN', 'v'), 'Grace Chapel NT.zip'), 'Grace Chapel NT', 'the picker\'s file name beats a book title');
  const front = realFflate.zipSync({ '00-FRT.usfm': enc('\\id FRT Preface to a Translation\n\\h Preface\n'), '02-GEN.usfm': enc(usfmBook('GEN - The Real Name', 'v')) });
  assert.equal(await names(front), 'The Real Name', 'front matter was taken as the Bible\'s name');
  assert.equal(await names(realFflate.zipSync({ '02-GEN.usfm': enc(usfmBook('GEN - <img src=x onerror=alert(1)>', 'v')) })), 'img src=x onerror=alert(1)', 'angle brackets reached a stored name');
});

test('E13 — a cross-reference file that would take a held name is rewritten, saved REWRITTEN, and comes back the same after a restart', async () => {
  const p = await readyPhone();
  const a = await p.Bible.installFromBytes(crossrefJson('MYX', 'My cross references'), 'a.json');
  const b = await p.Bible.installFromBytes(enc(JSON.stringify({ meta: { kind: 'crossref', abbr: 'MYX', name: 'My cross references' }, refs: { '1.1.1': ['FORGED 9:9'] } })), 'b.json');
  assert.equal(a.ok && b.ok, true);
  assert.notEqual(a.abbr, b.abbr, 'the second set took the first one\'s abbreviation');
  assert.equal(p.Bible.crossrefList().length, 2);
  assert.deepEqual([...p.Bible.getCrossRefs(1, 1, a.abbr)[1]], ['John 1:1']);
  assert.deepEqual([...p.Bible.getCrossRefs(1, 1, b.abbr)[1]], ['FORGED 9:9']);
  const again = phone({ state: p.state }); await again.boot();
  assert.equal(again.Bible.crossrefList().length, 2, 'after a restart the two sets collapsed into one');
  assert.deepEqual([...again.Bible.getCrossRefs(1, 1, a.abbr)[1]], ['John 1:1']);
});

// ════════════════════════════════ 4. names that reach file paths ═══════════════════════════════════════════════

test('E14 — NAME CLEANING: dots, slashes, 300 characters, a leading dot, emoji and nothing at all all end as a safe last part with the right extension, in the key, exportModule and shareOneFile', async () => {
  const p = await readyPhone();
  const hints = ['../../../etc/passwd.zip', 'a'.repeat(300) + '.zip', '.hidden.zip', '\u{1F4D6}\u{1F4D6}.zip', '', '..', 'x/y\\z q.zip', 'My Bible (final) v2.zip'];
  const caps = [], writes = [];
  const Cap = { isNativePlatform: () => true, Plugins: { Share: { share: async (a) => { caps.push(a); } }, Filesystem: { writeFile: async ({ path, data }) => { writes.push(path); return { uri: 'file:///c/' + path }; }, deleteFile: async () => {} } } };
  const { shareOneFile } = loadScreen('app/share-app.jsx', ['shareOneFile'], { React: {}, window: { Capacitor: Cap }, btoa, document: {}, navigator: {}, console });
  let n = 0;
  for (const hint of hints) {
    n++;
    const r = await p.Bible.installFromBytes(usfmZip('GEN - Bible number ' + n, 'verse ' + n), hint);
    assert.equal(r.ok, true, `${JSON.stringify(hint)}: ${JSON.stringify(r)}`);
    const rec = Object.values(p.installed()).find(x => x.abbr === r.abbr);
    assert.match(rec.url, KEY, `${JSON.stringify(hint).slice(0, 40)} -> ${rec.url}`);
    const last = rec.url.split('/').pop();
    assert.ok(last.length <= 40 + '.bbl.mybible.zip'.length);
    assert.doesNotMatch(last, /^\.|\.\./, `a leading dot or ".." survived: ${last}`);
    const ex = await p.Bible.exportModule(rec.url);
    assert.equal(ex.filename, last, 'exportModule hands the share a different file name');
    await shareOneFile({ bytes: ex.bytes, filename: ex.filename, title: r.name }, { toast() {} });
    assert.equal(writes[writes.length - 1], last, 'shareOneFile wrote to a path other than the cleaned name');
    assert.match(writes[writes.length - 1], /^[A-Za-z0-9._-]+$/);
  }
});

// ════════════════════════════════ 5. order: save, then record ══════════════════════════════════════════════════

test('E15 — SAVE ORDER: when the bytes cannot be saved the answer is no-space, the module is back out of memory, there is no record, and a restart is clean', async () => {
  const p = await readyPhone();
  p.state.quotaFull = true;
  const r = await p.Bible.installFromBytes(await bibleDb('FUL', 'Full Phone Bible'), 'full.bbl.mybible');
  assert.deepEqual(r, { ok: false, reason: 'no-space' });
  assert.equal(p.Bible.versions().length, 0, 'the module stayed in memory though it could not be saved');
  assert.equal(Object.keys(p.installed()).length, 0, 'a record was written for bytes that were never saved');
  assert.equal(p.Bible.loaded, false);
  const again = phone({ state: p.state }); await again.boot();
  assert.equal(again.Bible.versions().length, 0, 'after a restart the list is not clean');
  assert.equal(Object.keys(again.installed()).length, 0);
  // and a commentary: same rule, other store
  const c = await p.Bible.installFromBytes(file('modules/adam-clarke.cmt.mybible.zip'), 'c.zip');
  assert.deepEqual(c, { ok: false, reason: 'no-space' });
  assert.equal(p.Bible.commentaryList().length, 0, 'an unsaved commentary stayed in memory');
});

test('E16 — BOOT RACE: a file opened WHILE the boot restore is still downloading the default waits for it — one Bible, one record, never BSB and BSB2', async () => {
  const p = phone({ serveBsb: true, bsbDelay: 250 });
  await p.boot();                                            // autoLoad has started and is mid-download of the default BSB
  assert.equal(p.Bible.versions().length, 0, 'fixture: the default Bible should still be downloading');
  const r = await p.Bible.installFromBytes(file('modules/engbsb.zip'), '');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.already, true, 'the received BSB was installed on top of the one boot was already installing');
  assert.equal(p.Bible.versions().length, 1, JSON.stringify(p.Bible.versions()));
  assert.deepEqual(Object.keys(p.installed()), ['modules/engbsb.zip'], 'two records for one Bible: ' + Object.keys(p.installed()));
});

test('E16b — a file asked for BEFORE boot has even started also waits for it', async () => {
  const p = phone({ serveBsb: true, bsbDelay: 100 });       // the page is still "loading"
  const pending = p.Bible.installFromBytes(file('modules/engbsb.zip'), '');
  await sleep(30);
  assert.equal(p.Bible.versions().length, 0, 'the install ran before boot finished');
  await p.boot();
  const r = await pending;
  assert.equal(r.ok && r.already, true, JSON.stringify(r));
  assert.deepEqual(Object.keys(p.installed()), ['modules/engbsb.zip']);
});

// ════════════════════════════════ 6. the picker feeds the same door ════════════════════════════════════════════

test('E17 — the browser picker: pickFile announces installing then the result, and a file over 50 MB is refused on its size alone', async () => {
  const p = await readyPhone();
  const ev = []; p.Bible.onFileInstall(e => ev.push(e));
  p.Bible.pickFile();
  const change = p.fakeInput.listeners.change;
  assert.equal(typeof change, 'function', 'pickFile created no file input');
  const bytes = await bibleDb('PCK', 'Picked Bible');
  await change({ target: { files: [{ name: 'picked.bbl.mybible', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }], value: 'x' } });
  assert.deepEqual(ev.map(e => e.phase), ['installing', 'result']);
  assert.equal(ev[1].result.ok, true);
  assert.equal(ev[1].result.name, 'Picked Bible');
  assert.equal(p.Bible._error, null);
  // too big on f.size alone: arrayBuffer must never be called
  ev.length = 0; let read = 0;
  await change({ target: { files: [{ name: 'huge.zip', size: 50 * 1024 * 1024 + 1, arrayBuffer: async () => { read++; return new ArrayBuffer(1); } }], value: 'x' } });
  assert.equal(read, 0, 'a file over the cap was read into memory');
  assert.deepEqual(ev[1].result, { ok: false, reason: 'too-big' });
  // cancelling the picker (no file) says nothing
  ev.length = 0; await change({ target: { files: [], value: 'x' } });
  assert.deepEqual(ev, []);
});

test('E18 — installs run one at a time: two files at once both land, neither lost', async () => {
  const p = await readyPhone();
  const [a, b] = await Promise.all([
    p.Bible.installFromBytes(await bibleDb('AAA', 'Bible A', 'a'), 'a.bbl.mybible'),
    p.Bible.installFromBytes(await bibleDb('BBB', 'Bible B', 'b'), 'b.bbl.mybible')]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(p.Bible.versions().length, 2);
  assert.equal(Object.keys(p.installed()).length, 2);
});

test('E18b — two DIFFERENT files claiming ONE name, installed at the same moment: the second still sees the first and is renamed, not replacing it', async () => {
  // a slow catalogue read parks both installs at the same step, so only the one-at-a-time chain keeps the second from checking names before the first has registered
  const p = await readyPhone({ catalogDelay: 120 });
  const [a, b] = await Promise.all([
    p.Bible.installFromBytes(await bibleDb('SAM', 'Same Name Bible', 'FIRST text'), 'one.bbl.mybible'),
    p.Bible.installFromBytes(await bibleDb('SAM', 'Same Name Bible', 'SECOND text'), 'two.bbl.mybible')]);
  assert.equal(a.ok && b.ok, true, JSON.stringify([a, b]));
  assert.equal(p.Bible.versions().length, 2, 'one of two simultaneous installs replaced the other');
  const texts = p.Bible.versions().map(v => p.Bible.getVerses(1, 1, v.abbr)[0].text).sort();
  assert.deepEqual(JSON.parse(JSON.stringify(texts)), ['FIRST text', 'SECOND text']);
});
