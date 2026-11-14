// INSTALL A BIBLE FROM A FILE — THE FIXES FROM THE 2026-11-14 AUDIT OF 67c49830.
// Run: node --test scripts/install-bible-from-file-audit-fixes.test.mjs
//
// Audit: TrinityOne-internal/reference/AUDIT-install-bible-from-file-67c49830-2026-11-14.html. Every test here was
// written FIRST and run against 67c49830, where it fails (the red run is in the commit message). Fixtures are small:
// crafted headers and bounded streams, never gigabytes. Same real engine.js in a vm as the engine tests; the screens
// half of the fixes (marker expiry, own FileProvider, wider hash) is in install-bible-from-file-screens.test.mjs and
// the manifest half (stale backup after a hard kill) in install-bible-from-file-manifest.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen } from './render-jsx-screen.mjs';
import { realFflate, file, enc, sleep, readyPhone, phone, until, usfmBook, sqliteBytes, bibleDb, VIEW_BOMB, crossrefJson, held, ROOT } from './install-bible-harness.mjs';

const shareable = loadScreen('app/share-app.jsx', ['isShareableModule'], { React: {}, window: {}, btoa }).isShareableModule;

test('E19 — H1: A ZIP THAT DECLARES A BIBLE AND INFLATES TO 24 MB is refused, not installed (and so not re-decoded on every boot)', async () => {
  const p = await readyPhone();
  const real = await bibleDb('BMB', 'Bomb Bible');
  const payload = new Uint8Array(real.length + 24 * 1024 * 1024); payload.set(real);        // a valid Bible, then 24 MB of zeros
  const z = realFflate.zipSync({ 'bomb.bbl.mybible': payload });
  assert.ok(z.length < 200 * 1024, 'fixture is not small: ' + z.length);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let cd = -1; for (let i = z.length - 4; i >= 0; i--) if (dv.getUint32(i, true) === 0x02014b50) { cd = i; break; }
  dv.setUint32(cd + 24, real.length, true);                                                  // the central directory LIES: "this entry is Bible-sized"
  const before = held(p.Bible), puts = p.state.puts.length;
  const t0 = Date.now();
  const r = await p.Bible.installFromBytes(z, 'bomb.zip');
  assert.deepEqual(r, { ok: false, reason: 'unusable' }, 'a decode bomb installed: ' + JSON.stringify(r));
  assert.equal(held(p.Bible), before); assert.equal(p.state.puts.length, puts); assert.equal(Object.keys(p.installed()).length, 0);
  assert.ok(Date.now() - t0 < 3000);
  // control: the same Bible honestly zipped installs
  const honest = await p.Bible.installFromBytes(realFflate.zipSync({ 'bomb.bbl.mybible': real }), 'honest.zip');
  assert.equal(honest.ok, true, JSON.stringify(honest));
});

test('E20 — M1: A ZIP64 HEADER CLAIMING MILLIONS OF ENTRIES is refused after at most 2,001 are looked at, not after all of them', async () => {
  const calls = [];
  const p = await readyPhone({ unzipCalls: calls });
  const COUNT = 4_000_000;
  const base = Buffer.from(realFflate.zipSync({ 'a.txt': enc('hello') }, { level: 0 }));
  const eocdAt = base.length - 22; const cdOff = base.readUInt32LE(eocdAt + 16); const cdSize = base.readUInt32LE(eocdAt + 12);
  const body = base.subarray(0, eocdAt);
  const z64 = Buffer.alloc(56); z64.writeUInt32LE(0x06064b50, 0); z64.writeBigUInt64LE(44n, 4); z64.writeUInt16LE(45, 12); z64.writeUInt16LE(45, 14);
  z64.writeUInt32LE(COUNT >>> 0, 24); z64.writeUInt32LE(COUNT >>> 0, 32); z64.writeBigUInt64LE(BigInt(cdSize), 40); z64.writeUInt32LE(cdOff, 48);
  const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0); loc.writeUInt32LE(body.length, 8); loc.writeUInt32LE(1, 16);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0xffff, 8); eocd.writeUInt16LE(0xffff, 10); eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(0xffffffff, 16);
  const zip = new Uint8Array(Buffer.concat([body, z64, loc, eocd]));
  assert.ok(zip.length < 400, 'fixture is not a crafted header: ' + zip.length);
  const r = await p.Bible.installFromBytes(zip, 'x.zip');
  assert.equal(r.ok, false);
  assert.ok((calls.entryCount || 0) <= 2002, `fflate walked ${calls.entryCount} claimed entries before the cap stopped it`);
});

const CTE = (n) => `(select max(x) from (with recursive c(x) as (select 1 union all select x+1 from c where x < ${n}) select x from c))`;

test('E21 — H2a: A COLUMN NAMED LIKE A QUERY is refused at install, and is only a name to the SQL builders (hosted and boot paths)', async () => {
  const p = await readyPhone();
  const evil = await sqliteBytes(`CREATE TABLE Dictionary ("${CTE(3_000_000)}" TEXT, "zz" TEXT); INSERT INTO Dictionary VALUES ('A','B');`);
  const t0 = Date.now();
  const r = await p.Bible.installFromBytes(evil, 'evil.dct.mybible');
  assert.deepEqual(r, { ok: false, reason: 'unusable' }, JSON.stringify(r));
  assert.ok(Date.now() - t0 < 1500, 'the hostile column name ran as SQL (' + (Date.now() - t0) + ' ms)');
  assert.equal(Object.keys(p.installed()).length, 0);
  // loadModuleBytes is what boot and hosted installs call, with no install guard in front. The builder must not run it either.
  const calm = await sqliteBytes(`CREATE TABLE Dictionary ("${CTE(2)}" TEXT, "zz" TEXT); INSERT INTO Dictionary VALUES ('A','B');`);
  let t = Date.now(); await p.Bible.loadModuleBytes(calm, 'calm.dct.mybible'); const base = Date.now() - t;
  t = Date.now(); await p.Bible.loadModuleBytes(evil, 'evil.dct.mybible'); const bomb = Date.now() - t;
  assert.ok(bomb < base + 600, `loading the file ran its column name as a query: ${bomb} ms against ${base} ms`);
});

test('E22 — H2b: GENERATED columns, VIRTUAL tables and table or column names that are not plain are refused', async () => {
  const p = await readyPhone();
  const bible = (details, bibleCols = 'Book INT, Chapter INT, Verse INT, Scripture TEXT') => `${details} CREATE TABLE Bible (${bibleCols}); INSERT INTO Bible(Book, Chapter, Verse) VALUES (1,1,1);`;
  const heavy = `length(replace(hex(zeroblob(9000000)),'0','ab'))`;
  const cases = [
    ['a generated column in Details', bible(`CREATE TABLE Details (Abbreviation TEXT, Description TEXT GENERATED ALWAYS AS (${heavy}) VIRTUAL); INSERT INTO Details(Abbreviation) VALUES ('GEN1');`)],
    ['a STORED generated column in Details', bible(`CREATE TABLE Details (Abbreviation TEXT, Description TEXT GENERATED ALWAYS AS ('x') STORED); INSERT INTO Details(Abbreviation) VALUES ('GEN2');`)],
    ['a generated column on Bible.Scripture', bible(`CREATE TABLE Details (Abbreviation TEXT, Description TEXT); INSERT INTO Details VALUES ('GEN3','x');`, `Book INT, Chapter INT, Verse INT, Scripture TEXT GENERATED ALWAYS AS (${heavy}) VIRTUAL`)],
    ['a table whose name is not plain', bible(`CREATE TABLE Details (Abbreviation TEXT, Description TEXT); INSERT INTO Details VALUES ('X','y'); CREATE TABLE "Bible;select 1" (a TEXT);`)],
    ['a column whose name is code', bible(`CREATE TABLE Details (Abbreviation TEXT, "Description) -- " TEXT); INSERT INTO Details(Abbreviation) VALUES ('Z');`)],
  ];
  let fts = null;
  for (const mod of ['fts5', 'fts3', 'rtree']) { try { fts = await sqliteBytes(bible(`CREATE TABLE Details (Abbreviation TEXT, Description TEXT); INSERT INTO Details VALUES ('V','v'); CREATE VIRTUAL TABLE ft USING ${mod}(${mod === 'rtree' ? 'id, a, b' : 'a'});`)); break; } catch (e) { fts = null; } }
  const bytesOf = []; for (const [what, sql] of cases) bytesOf.push([what, await sqliteBytes(sql)]);
  if (fts) bytesOf.push(['a virtual table', fts]);
  assert.ok(bytesOf.length >= 5, 'fixtures did not build');
  for (const [what, bytes] of bytesOf) {
    const t0 = Date.now();
    const r = await p.Bible.installFromBytes(bytes, 'x.bbl.mybible');
    assert.deepEqual(r, { ok: false, reason: 'unusable' }, `${what}: ${JSON.stringify(r)}`);
    assert.ok(Date.now() - t0 < 2500, `${what}: ran it (${Date.now() - t0} ms)`);
  }
  assert.equal(Object.keys(p.installed()).length, 0);
});

test('E23 — H2 control: every MySword module this app ships still passes the unsafe-SQLite check (nothing real is refused)', async () => {
  const p = await readyPhone();
  for (const f of ['modules/eng-akjv.bbl.mybible', 'modules/geneva-notes.cmt.mybible.zip', 'modules/matthew-henry.cmt.mybible.zip', 'modules/jamieson-fausset-brown.cmt.mybible.zip', 'modules/aquifer-osn-eng.cmt.mybible.zip', 'modules/adam-clarke.cmt.mybible.zip']) {
    const r = await p.Bible.installFromBytes(file(f), f.split('/').pop());
    assert.equal(r.ok, true, `${f}: ${JSON.stringify(r)}`);
  }
});

test('E24 — M4: THE PEEK CLOSES ITS DATABASE, and a repeated file is recognised before anything is opened', async () => {
  const p = await readyPhone();
  const bytes = await bibleDb('LEK', 'Leak Bible');
  const r1 = await p.Bible.installFromBytes(bytes, 'leak.bbl.mybible');
  assert.equal(r1.ok, true);
  const unclosed = () => p.sqlStats.opened - p.sqlStats.closed;
  assert.equal(unclosed(), 1, 'after one install only the module itself may stay open (the check and the peek must close): ' + JSON.stringify(p.sqlStats));
  const opened = p.sqlStats.opened;
  for (let i = 0; i < 4; i++) assert.equal((await p.Bible.installFromBytes(bytes, 'leak.bbl.mybible')).already, true);
  assert.equal(p.sqlStats.opened, opened, 'an identical file was parsed again before "already here"');
  assert.equal(unclosed(), 1);
  const bomb = await sqliteBytes(VIEW_BOMB);
  await p.Bible.installFromBytes(bomb, 'bomb.bbl.mybible'); await p.Bible.installFromBytes(bomb, 'bomb.bbl.mybible');
  assert.equal(unclosed(), 1, 'a refused file left its database open: ' + JSON.stringify(p.sqlStats));
});

test('E25 — M3: THE REAL KJV is not named after a book; a name must be the same across books, else the file name, else "USFM Bible"', async () => {
  const kjv = file('modules/eng-kjv.zip');
  const noHint = await readyPhone(); const a = await noHint.Bible.installFromBytes(kjv, '');
  assert.equal(a.ok, true); assert.equal(a.name, 'USFM Bible', 'the KJV with no file name was named: ' + a.name); assert.notEqual(a.abbr, 'TFBOS');
  const named = await readyPhone(); const b = await named.Bible.installFromBytes(kjv, 'eng-kjv.zip');
  assert.equal(b.name, 'eng-kjv'); assert.notEqual(b.abbr, 'TFBOS');
  const asv = await readyPhone(); assert.equal((await asv.Bible.installFromBytes(file('modules/eng-asv.zip'), '')).name, 'American Standard Version (from a file)');   // named right, and labelled because the catalogue's ASV holds that name
  const web = await readyPhone(); assert.match((await web.Bible.installFromBytes(file('modules/eng-web.zip'), '')).name, /World English Bible/);
  const shaped = realFflate.zipSync({
    '00-FRT.usfm': enc('\\id FRT Preface\n\\h Preface\n'),
    '02-GEN.usfm': enc(usfmBook('GEN Genesis', 'v', '\\h Genesis\n\\toc1 The First Book of Moses, called Genesis\n')),
    '10-1SA.usfm': enc(usfmBook('1SA The First Book of Samuel', 'v', '\\h 1 Samuel\n')),
    '20-PSA.usfm': enc(usfmBook('PSA The Book of Psalms', 'v', '\\h Psalms\n')) });
  const s1 = await readyPhone(); assert.equal((await s1.Bible.installFromBytes(shaped, '')).name, 'USFM Bible');
  const s2 = await readyPhone(); assert.equal((await s2.Bible.installFromBytes(shaped, 'My KJV.zip')).name, 'My KJV');
  const same = realFflate.zipSync({ '02-GEN.usfm': enc(usfmBook('GEN - Grace Chapel Bible', 'v')), '03-EXO.usfm': enc(usfmBook('EXO - Grace Chapel Bible', 'v')) });
  const s3 = await readyPhone(); assert.equal((await s3.Bible.installFromBytes(same, 'x.zip')).name, 'Grace Chapel Bible');
});

test('E26 — M2: A NAME WITH AN INVISIBLE CHARACTER, A CYRILLIC LOOKALIKE, OR AN eBIBLE MIRROR NAME gets the label like any held name', async () => {
  const p = await readyPhone();
  const hasCf = (s) => /\p{Cf}/u.test(s);
  const inv = await p.Bible.installFromBytes(await bibleDb('BSB2', 'Berean Standard Bible⁠'), 'a.bbl.mybible');
  assert.equal(inv.renamed, true, 'an invisible character let a file wear the catalogue name: ' + JSON.stringify(inv)); assert.match(inv.name, /\(from a file\)/);
  const zw = await p.Bible.installFromBytes(await bibleDb('KJ​V', 'King​ James Version'), 'b.bbl.mybible');
  assert.equal(zw.renamed, true); assert.ok(!hasCf(zw.name) && !hasCf(zw.abbr), 'a format character was stored');
  const cy = await p.Bible.installFromBytes(await bibleDb('KјВ', 'King James Versіon'), 'c.bbl.mybible');   // Cyrillic ј, В, і
  assert.equal(cy.renamed, true, 'a Cyrillic lookalike of "King James Version" was not labelled: ' + JSON.stringify(cy));
  const mirror = JSON.parse(readFileSync(ROOT + 'ebible-catalog.json', 'utf8')).items.find(i => /^[A-Za-z ]{12,40}$/.test(i.name) && /^[A-Za-z0-9]{3,8}$/.test(i.abbr));
  assert.ok(mirror, 'no usable mirror entry to test with');
  const m = await p.Bible.installFromBytes(await bibleDb(mirror.abbr, mirror.name), 'm.bbl.mybible');
  assert.equal(m.renamed, true, `the eBible mirror's "${mirror.name}" (${mirror.abbr}) was taken by a file`);
  const fine = await p.Bible.installFromBytes(await bibleDb('GRC', 'Grace Chapel Study Bible'), 'g.bbl.mybible');
  assert.equal(fine.renamed, false, 'a plain unrelated name was labelled');
});

test('E27 — L4: THE RECONNECT RETRY is waited on by an install, and does not start while one is in flight', async () => {
  const p = phone({ serveBsb: false, bsbDelay: 200 });
  await p.boot(); p.Bible._error = null;
  assert.equal(p.Bible.versions().length, 0);
  p.net.serveBsb = true;
  await p.goOnline();                                                        // autoLoad runs again and starts downloading the default
  const r = await p.Bible.installFromBytes(file('modules/engbsb.zip'), '');
  assert.equal(r.ok && r.already, true, 'the file was installed on top of the retry that was downloading the same Bible: ' + JSON.stringify(r));
  assert.deepEqual(Object.keys(p.installed()), ['modules/engbsb.zip']);
  assert.equal(p.Bible.versions().length, 1);
  // the retry does not start at all while an install is in flight
  const q = phone({ serveBsb: false, catalogDelay: 150 });
  await q.boot(); q.Bible._error = null;
  q.net.serveBsb = true; q.fetched.length = 0;
  const inflight = q.Bible.installFromBytes(await bibleDb('RTY', 'Retry Bible'), 'r.bbl.mybible');
  await sleep(40);
  await q.goOnline();
  await inflight;
  assert.ok(!q.fetched.some(u => /engbsb/.test(u)), 'the online retry started a default install under a file install: ' + q.fetched);
});

test('E28 — L5: A LIBRARY "GET" AND A FILE INSTALL OF THE SAME NAME, AT THE SAME MOMENT, do not replace each other', async () => {
  const hostedBytes = await bibleDb('RAC', 'Race Bible', 'HOSTED text');
  const p = phone({ hosted: { 'modules/race.bbl.mybible': hostedBytes } });
  await p.boot(); p.Bible._error = null;
  p.state.putDelay = { 'modules/race.bbl.mybible': 250 };      // the hosted install is saving its bytes (inside the registration lock) while the file is checked
  const get = p.Bible.installModule({ id: 'race', abbr: 'RAC', name: 'Race Bible', kind: 'bible', format: 'MYBIBLE', category: 'bibles', url: 'modules/race.bbl.mybible' });
  await sleep(20);
  const file1 = await p.Bible.installFromBytes(await bibleDb('RAC', 'Race Bible', 'FILE text'), 'race.bbl.mybible');
  await get;
  assert.equal(file1.ok, true, JSON.stringify(file1));
  assert.equal(p.Bible.versions().length, 2, 'one of them replaced the other: ' + JSON.stringify(p.Bible.versions()));
  const texts = p.Bible.versions().map(v => p.Bible.getVerses(1, 1, v.abbr)[0].text).sort();
  assert.deepEqual(JSON.parse(JSON.stringify(texts)), ['FILE text', 'HOSTED text']);
});

test('E29 — N1: AN OBJECT-PROTOTYPE NAME is refused (modules["__proto__"] = ... would rewrite the store itself)', async () => {
  const p = await readyPhone();
  for (const [what, bytes] of [['a cross-reference set called __proto__', crossrefJson('__proto__', 'Proto')], ['a Bible whose abbreviation is __proto__', await bibleDb('__proto__', 'Proto Bible')], ['a Bible called constructor', await bibleDb('CTR', 'constructor')]]) {
    const r = await p.Bible.installFromBytes(bytes, 'p.bin');
    assert.deepEqual(r, { ok: false, reason: 'unusable' }, `${what}: ${JSON.stringify(r)}`);
  }
  assert.equal(Object.keys(p.installed()).length, 0);
});

test('E30 — L2: BYTES THAT ARE A CATALOGUE MODULE ARE FILED AS THAT MODULE, so the Library shows it Installed and no second copy can follow', async () => {
  const bsb = file('modules/engbsb.zip');
  const w = await readyPhone();
  const r = await w.Bible.installFromBytes(bsb, 'BSB-bible.zip');
  assert.equal(r.ok, true); assert.equal(r.name, 'Berean Standard Bible');
  assert.deepEqual(Object.keys(w.installed()), ['modules/engbsb.zip'], 'the received BSB is not the catalogue\'s own record: ' + Object.keys(w.installed()));
  assert.equal(w.Bible.isInstalled('modules/engbsb.zip'), true);
  assert.equal(w.Bible.isLoaded('modules/engbsb.zip'), true, 'the Library would still offer Get for a BSB that is already loaded');
  assert.equal(shareable(w.installed()['modules/engbsb.zip']), true);
  const again = phone({ state: w.state }); await again.boot();
  await until(() => again.Bible.versions().length === 1);   // restoreInstalled reads it back (throws if a restart cannot)
  const g = await w.Bible.installFromBytes(file('modules/geneva-notes.cmt.mybible.zip'), '');
  assert.equal(g.ok, true); assert.equal(g.name, 'Geneva Bible Notes 1599');
  assert.ok(w.installed()['modules/geneva-notes.cmt.mybible.zip'], 'a pinned commentary was not filed under its catalogue url: ' + Object.keys(w.installed()));
});
