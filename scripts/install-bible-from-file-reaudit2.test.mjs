// INSTALL A BIBLE FROM A FILE — THE FIXES FROM THE SECOND RE-AUDIT (9bcdab07, 2026-11-16).
// Run: node --test scripts/install-bible-from-file-reaudit2.test.mjs
//
// Report: TrinityOne-internal/reference/AUDIT-install-bible-fixes-9bcdab07-2026-11-16.html. A1 (HIGH) was the third time the
// install check and the loader read a zip DIFFERENTLY (a zip64 locator sends fflate to a second central directory). The
// fix is structural: ONE reader, engine.js _zipParse/_zipExtract, for every file a member hands us, and nothing on that path
// calls fflate.unzipSync. These tests assert that structure (the wrapped fflate is never asked) as well as the fixtures.
// Every test was written first and run against 9bcdab07, where it fails. Fixtures are under about 200 KB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { realFflate, file, enc, sleep, readyPhone, phone, bibleDb, sqliteBytes, newStores, held, sha, ROOT } from './install-bible-harness.mjs';
import { loadScreen, miniReact, find, texts as rtexts } from './render-jsx-screen.mjs';

// ── A1: the auditor's fixture, rebuilt: a zip64 LOCATOR points fflate at central directory A, the classic end record
// points everyone else at central directory B. Same count, method and sizes; different OFFSETS. ──────────────────────────
async function locatorZip(zeroMB = 24, { locator = true } = {}) {
  const db = Buffer.from(await bibleDb('ZB', 'Zip Bomb Bible', 'In the beginning'));
  const d = zlib.createDeflateRaw({ level: 9 }); const out = []; d.on('data', c => out.push(c)); const done = new Promise(r => d.on('end', r));
  d.write(db); const chunk = Buffer.alloc(8 << 20); for (let w = 0; w < zeroMB * 1048576; w += chunk.length) d.write(chunk.subarray(0, Math.min(chunk.length, zeroMB * 1048576 - w))); d.end(); await done;
  const bomb = Buffer.concat(out); const C = bomb.length, U = 200 * 1024;
  const benignParts = []; let left = C;     // stored deflate blocks of the same compressed length that yield well under U
  while (left > 0) { const take = Math.min(65535 + 5, left); const L = take - 5; const h = Buffer.alloc(5); h[0] = left - take === 0 ? 1 : 0; h.writeUInt16LE(L, 1); h.writeUInt16LE((~L) & 0xffff, 3); benignParts.push(h, Buffer.concat([db, Buffer.alloc(Math.max(0, L - db.length))]).subarray(0, L)); left -= take; }
  const benign = Buffer.concat(benignParts);
  const X = Buffer.from('bomb.bbl.mybible');
  const lhdr = (csz, usz) => { const b = Buffer.alloc(30); b.writeUInt32LE(0x04034b50, 0); b.writeUInt16LE(20, 4); b.writeUInt16LE(8, 8); b.writeUInt32LE(csz, 18); b.writeUInt32LE(usz, 22); b.writeUInt16LE(X.length, 26); return Buffer.concat([b, X]); };
  const cdr = (off) => { const b = Buffer.alloc(46); b.writeUInt32LE(0x02014b50, 0); b.writeUInt16LE(45, 4); b.writeUInt16LE(20, 6); b.writeUInt16LE(8, 10); b.writeUInt32LE(C, 20); b.writeUInt32LE(U, 24); b.writeUInt16LE(X.length, 28); b.writeUInt32LE(off, 42); return Buffer.concat([b, X]); };
  const LA = Buffer.concat([lhdr(C, U), bomb]), LB = Buffer.concat([lhdr(C, U), benign]);
  const body = Buffer.concat([LA, LB]);
  const cdA = cdr(0), cdB = cdr(LA.length);
  const cdAoff = body.length, cdBoff = cdAoff + cdA.length, z64off = cdBoff + cdB.length;
  const z64 = Buffer.alloc(56); z64.writeUInt32LE(0x06064b50, 0); z64.writeBigUInt64LE(44n, 4); z64.writeUInt16LE(45, 12); z64.writeUInt16LE(45, 14);
  z64.writeBigUInt64LE(1n, 24); z64.writeBigUInt64LE(1n, 32); z64.writeBigUInt64LE(BigInt(cdA.length), 40); z64.writeBigUInt64LE(BigInt(cdAoff), 48);
  const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(z64off), 8); loc.writeUInt32LE(1, 16);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cdB.length, 12); eocd.writeUInt32LE(cdBoff, 16);
  const plain = Buffer.alloc(22); plain.writeUInt32LE(0x06054b50, 0); plain.writeUInt16LE(1, 8); plain.writeUInt16LE(1, 10); plain.writeUInt32LE(cdA.length, 12); plain.writeUInt32LE(cdAoff, 16);
  return {
    both: new Uint8Array(Buffer.concat([body, cdA, cdB, z64, loc, eocd])),
    bombOnly: new Uint8Array(Buffer.concat([body, cdA, plain])),     // the control: the bomb's own directory, no locator
    db,
  };
}

test('A1 — THE ZIP64 LOCATOR FIXTURE (49 KB, 24 MB of decode) is refused, and fflate.unzipSync is never asked to read a member\'s zip', async () => {
  const calls = [];
  const p = await readyPhone({ unzipCalls: calls });
  const { both, bombOnly } = await locatorZip(24);
  assert.ok(both.length < 100 * 1024, 'fixture is not small: ' + both.length);
  // control: fflate really does follow the locator to the OTHER directory (so the two readers can disagree)
  const seen = []; realFflate.unzipSync(both, { filter: (f) => { seen.push([f.size, f.originalSize]); return false; } });
  const classic = (() => { const dv = new DataView(both.buffer, both.byteOffset, both.byteLength); const e = both.length - 22; return dv.getUint32(e + 16, true); })();
  assert.ok(seen.length === 1 && classic > 0, 'fixture does not diverge fflate from the classic end record');
  const before = held(p.Bible), puts = p.state.puts.length;
  const t0 = Date.now();
  const r = await p.Bible.installFromBytes(both, 'bomb.bbl.mybible.zip');
  assert.deepEqual(r, { ok: false, reason: 'unusable' }, 'a locator-split decode bomb installed: ' + JSON.stringify(r));
  assert.equal(held(p.Bible), before); assert.equal(p.state.puts.length, puts); assert.equal(Object.keys(p.installed()).length, 0);
  assert.ok(Date.now() - t0 < 3000);
  assert.deepEqual([...calls], [], 'fflate.unzipSync was called on a received file: ' + calls);
  // the bomb's own directory with no locator is refused too (the earlier fix), also without unzipSync
  assert.deepEqual(await p.Bible.installFromBytes(bombOnly, 'b.zip'), { ok: false, reason: 'unusable' });
  assert.deepEqual([...calls], []);
});

test('A1b — TWO END-OF-DIRECTORY RECORDS, a zip64 locator alone, and disagreeing entry counts (e+8 vs e+10) are each refused', async () => {
  const p = await readyPhone();
  const db = await bibleDb('OK', 'Ok Bible', 'x');
  const good = realFflate.zipSync({ 'ok.bbl.mybible': db });
  assert.equal((await p.Bible.installFromBytes(good, 'ok.zip')).ok, true, 'control: the honest zip installs');
  const p2 = await readyPhone();
  const eocdAt = good.length - 22;
  // (1) a second end record hidden in the archive comment
  const second = Buffer.from(good.subarray(eocdAt)); const withComment = Buffer.from(good); withComment.writeUInt16LE(second.length, eocdAt + 20);
  const twoEnds = new Uint8Array(Buffer.concat([withComment, second]));
  assert.deepEqual(await p2.Bible.installFromBytes(twoEnds, 'two.zip'), { ok: false, reason: 'unusable' }, 'two end records');
  // (2) a zip64 locator signature 20 bytes before the end record, with nothing else different
  const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0);
  const withLoc = new Uint8Array(Buffer.concat([Buffer.from(good.subarray(0, eocdAt)), loc, Buffer.from(good.subarray(eocdAt))]));
  assert.deepEqual(await p2.Bible.installFromBytes(withLoc, 'loc.zip'), { ok: false, reason: 'unusable' }, 'a zip64 locator');
  // (3) the two entry counts differ
  const split = Buffer.from(good); split.writeUInt16LE(2, eocdAt + 8);
  assert.deepEqual(await p2.Bible.installFromBytes(new Uint8Array(split), 'cnt.zip'), { ok: false, reason: 'unusable' }, 'entry counts differ');
  assert.equal(Object.keys(p2.installed()).length, 0);
});

test('A1c — NOTHING ON THE MEMBER PATH CALLS fflate.unzipSync: a real USFM zip, a MySword zip, the pinned BSB and a boot of a stored zip', async () => {
  const calls = [];
  const p = await readyPhone({ unzipCalls: calls });
  for (const [f, hint] of [['modules/eng-kjv.zip', 'eng-kjv.zip'], ['modules/adam-clarke.cmt.mybible.zip', ''], ['modules/engbsb.zip', '']]) {
    const r = await p.Bible.installFromBytes(file(f), hint);
    assert.equal(r.ok, true, f + ': ' + JSON.stringify(r));
  }
  const kjvRecord = Object.keys(p.installed()).find(k => k.startsWith('imported/'));
  assert.ok(kjvRecord, 'fixture: no imported zip record to boot');
  assert.deepEqual([...calls], [], 'fflate.unzipSync ran on a received file at install: ' + calls);
  const again = phone({ state: p.state, unzipCalls: calls }); await again.boot();
  await sleep(400);
  assert.ok(again.Bible.versions().length >= 1, 'the stored imports did not load at boot');
  // boot may still unzipSync the PINNED BSB (filed as the catalogue's own module, hash-verified), never an imported/ one
  assert.equal(calls.length <= 1, true, 'boot unzipSync-ed more than the one pinned catalogue module: ' + calls);
});

test('A7 — a zip that passes is DECODED ONCE per entry at install, and once per entry at boot (no second pass of the check)', async () => {
  const p = await readyPhone();
  const zip = realFflate.zipSync({ 'a.usfm': enc('\\id GEN - Once Bible\n\\c 1\n\\p\n\\v 1 x\n'), 'b.usfm': enc('\\id EXO - Once Bible\n\\c 1\n\\p\n\\v 1 y\n') });
  const entries = 2;
  const before = p.inflates.n;
  const r = await p.Bible.installFromBytes(zip, 'once.zip');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(p.inflates.n - before, entries, `the zip was inflated ${p.inflates.n - before} times for ${entries} entries`);
  const again = phone({ state: p.state }); await again.boot(); await sleep(100);
  assert.equal(again.inflates.n, entries, `boot inflated ${again.inflates.n} times for ${entries} entries`);
});

// ── A2: accents on non-Latin lookalikes ──────────────────────────────────────────────────────────────────────────────────
test('A2 — ACCENTED LOOKALIKES: Greek ό, Cyrillic ӧ, ё, ї and ӑ in "King James Version" are labelled', async () => {
  const p = await readyPhone();
  const cases = [['A1', 'King James Versiύn'.replace('ύ', 'ό')], ['A2', 'King James Versiӧn'], ['A3', 'King James Vёrsion'], ['A4', 'Kїng James Version'], ['A5', 'King Jӑmes Version']];
  for (const [a, n] of cases) {
    const r = await p.Bible.installFromBytes(await bibleDb(a, n, 'x ' + a), '');
    assert.equal(r.renamed, true, `${JSON.stringify(n)} wore the catalogue's name unlabelled: ${JSON.stringify(r)}`);
  }
});

// ── A3: the table can be regenerated ─────────────────────────────────────────────────────────────────────────────────────
test('A3 — THE CONFUSABLES TABLE IN engine.js IS EXACTLY WHAT scripts/gen-confusables-table.py MAKES from the pinned copy of the Unicode file', () => {
  const py = spawnSync('python3', ['-I', ROOT + 'scripts/gen-confusables-table.py', ROOT + 'scripts/data/confusables-18.0.txt'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  assert.equal(py.status, 0, 'the generator failed: ' + py.stderr);
  const eng = readFileSync(ROOT + 'engine.js', 'utf8');
  const m = eng.match(/const _CONF_DATA = ("(?:[^"\\]|\\.)*");/);
  assert.ok(m, 'engine.js has no _CONF_DATA — re-anchor');
  assert.equal(JSON.parse(m[1]), py.stdout.trim(), 'the committed table differs from the generator\'s output: regenerate it');
  const sum = spawnSync('sha256sum', [ROOT + 'scripts/data/confusables-18.0.txt'], { encoding: 'utf8' }).stdout.split(' ')[0];
  assert.match(readFileSync(ROOT + 'scripts/gen-confusables-table.py', 'utf8'), new RegExp(sum), 'the generator does not pin the checksum of its input');
});

// ── A4: the boot check fails CLOSED ──────────────────────────────────────────────────────────────────────────────────────
function seeded(bytes, key, name) {
  const state = newStores();
  state.stores.set('modules', new Map([[key, bytes]]));
  state.ls.set('trinityone.installed', JSON.stringify({ [key]: { url: key, id: 'OLD', abbr: 'OLD', name, kind: 'bible', category: 'bibles' } }));
  return state;
}
test('A4 — BOOT FAILS CLOSED: a stored import the check cannot read (it throws) is quarantined, not loaded', async () => {
  const junk = new Uint8Array(4096); junk.set(enc('SQLite format 3\u0000')); junk.fill(0xff, 16);        // a SQLite header, then garbage: opening it throws
  const state = seeded(junk, 'imported/broken.bbl.mybible', 'Broken Import');
  const p = phone({ state }); await p.boot(); await sleep(80);
  assert.equal(p.Bible.versions().length, 0);
  const rec = JSON.parse(state.ls.get('trinityone.installed'))['imported/broken.bbl.mybible'];
  assert.equal(rec.quarantined, true, 'a file the check could not read was not quarantined: ' + JSON.stringify(rec));
  assert.deepEqual(JSON.parse(JSON.stringify(p.Bible.takeQuarantineNotices())), ['Broken Import']);
});

// ── A5, A6: what the member sees ─────────────────────────────────────────────────────────────────────────────────────────
test('A5 — A QUARANTINED FILE: the same bytes say "blocked", never "already installed"; its record is removable without touching a loaded module of the same name', async () => {
  const bomb = await sqliteBytes(`CREATE VIEW Details AS SELECT 'OLD' AS Abbreviation, 'Old' AS Description; CREATE TABLE Bible (Book INT, Chapter INT, Verse INT, Scripture TEXT);`);
  // the stored bytes hash to the key's prefix so the "same bytes" test finds them
  const h12 = (await sha(bomb)).slice(0, 12);
  const key = `imported/${h12}/old.bbl.mybible`;
  const st = seeded(bomb, key, 'Old Import');
  const p = phone({ state: st }); await p.boot(); await sleep(80);
  assert.equal(JSON.parse(st.ls.get('trinityone.installed'))[key].quarantined, true);
  const again = await p.Bible.installFromBytes(bomb, 'old.bbl.mybible');
  assert.deepEqual(again, { ok: false, reason: 'quarantined', name: 'Old Import' }, 'the blocked file was reported as: ' + JSON.stringify(again));
  // a loaded module with the quarantined record's own abbreviation survives its removal
  const keep = await p.Bible.installFromBytes(await bibleDb('OLD', 'Another Old Bible', 'kept'), 'k.bbl.mybible');
  assert.equal(keep.ok, true);
  assert.equal(await p.Bible.removeModule(key), true, 'a quarantined record could not be removed');
  assert.ok(!st.stores.get('modules').has(key), 'its bytes are still stored');
  assert.equal(p.Bible.versions().length, 1, 'removing a quarantined record removed a loaded module');
});

test('A5b — LIBRARY > INSTALLED shows a quarantined row as not opened, offers Remove and NOT Share', () => {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const recs = [
    { url: 'imported/aaa/old.bbl.mybible', abbr: 'OLD', name: 'Old Import', kind: 'bible', category: 'bibles', quarantined: true },
    { url: 'imported/bbb/fine.bbl.mybible', abbr: 'FIN', name: 'Fine Import', kind: 'bible', category: 'bibles' }];
  const win = { Bible: { installedMap: () => Object.fromEntries(recs.map(r => [r.url, r])), activeVersion: null, activeUrl: null, removeModule: async () => true, isInstalled: () => true, subscribe: () => () => {}, versions: () => [], exportModule: async () => null }, TrinityData: {}, addEventListener() {}, removeEventListener() {} };
  win.isShareableModule = loadScreen('app/share-app.jsx', ['isShareableModule'], { React, window: {}, btoa }).isShareableModule;
  const { InstalledBrowser } = loadScreen('app/screens-library.jsx', ['InstalledBrowser'], { React, window: win, Icon, document: { addEventListener() {}, removeEventListener() {} }, Spinner: () => null, ScreenScroll: (p) => p.children, safeCssColor: (c) => c || 'var(--clay)' });
  const tree = draw(InstalledBrowser, { ctx: { toast() {} }, category: null, force: () => {} });
  const row = (name) => find(tree, n => n.type === 'div' && rtexts(n).join(' ').includes(name) && find(n, x => x.type === 'button' && rtexts(x).join(' ').includes('Remove')).length === 1).pop();
  const bad = row('Old Import'), fine = row('Fine Import');
  assert.ok(bad && fine, 're-anchor: rows not found');
  const labels = (r) => find(r, x => x.type === 'button').map(b => rtexts(b).join(' ').trim());
  assert.ok(labels(bad).some(l => /Remove/.test(l)), 'a quarantined row has no Remove');
  assert.ok(!labels(bad).some(l => /Share/.test(l)), 'a quarantined row offers Share: the phone would hand an unsafe file on');
  assert.ok(labels(fine).some(l => /Share/.test(l)), 'control: a normal imported row still offers Share');
  assert.match(rtexts(bad).join(' '), /Not opened|unsafe/i, 'the row does not say it was not opened');
});

test('A6 — EVERY quarantined file is named: the engine hands back all of them, and the sheet lists them all as text', async () => {
  const bomb = await sqliteBytes(`CREATE VIEW Details AS SELECT 'X' AS Abbreviation, 'X' AS Description; CREATE TABLE Bible (Book INT, Chapter INT, Verse INT, Scripture TEXT);`);
  const state = newStores();
  state.stores.set('modules', new Map([['imported/one.bbl.mybible', bomb], ['imported/two.bbl.mybible', bomb]]));
  state.ls.set('trinityone.installed', JSON.stringify({
    'imported/one.bbl.mybible': { url: 'imported/one.bbl.mybible', id: 'A', abbr: 'A', name: 'First Old', kind: 'bible', category: 'bibles' },
    'imported/two.bbl.mybible': { url: 'imported/two.bbl.mybible', id: 'B', abbr: 'B', name: 'Second Old', kind: 'bible', category: 'bibles' } }));
  const p = phone({ state }); await p.boot(); await sleep(100);
  assert.deepEqual(JSON.parse(JSON.stringify(p.Bible.takeQuarantineNotices())).sort(), ['First Old', 'Second Old']);
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const mod = loadScreen('app/install-bible.jsx', ['InstallFromFileSheet'], { React, window: { Bible: {} }, Icon, localStorage: { getItem: () => null, setItem() {} }, BottomSheet: ({ open, children }) => (open ? children : null), Spinner: () => null, fetch: async () => { throw new Error('x'); } });
  const tree = draw(mod.InstallFromFileSheet, { state: { phase: 'result', result: { ok: false, reason: 'quarantined', name: 'First Old', names: ['First Old', 'Second Old'] } }, onInstall() {}, onClose() {}, ctx: {} });
  const t = rtexts(tree);
  assert.ok(t.includes('First Old') && t.includes('Second Old'), 'the sheet names only some of the files: ' + t.join(' | '));
});
