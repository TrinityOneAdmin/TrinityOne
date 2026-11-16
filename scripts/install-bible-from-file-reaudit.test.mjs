// INSTALL A BIBLE FROM A FILE — THE FIXES FROM THE RE-AUDIT OF e1cdf997 (2026-11-14).
// Run: node --test scripts/install-bible-from-file-reaudit.test.mjs
//
// Report: TrinityOne-internal/reference/AUDIT-install-bible-fixes-e1cdf997-2026-11-14.html (R1 hidden zip entry, R2
// lookalike names, L-a mirror abbreviations, L-b catalogue slot, L-e boot of an unsafe stored module). Every test was
// written first and run against e1cdf997, where it fails. Fixtures are under about 200 KB: crafted headers and a
// bounded stream, never gigabytes. Same real engine.js in a vm as the other install-from-file tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { realFflate, file, enc, sleep, readyPhone, phone, until, sqliteBytes, bibleDb, VIEW_BOMB, held, newStores, ROOT } from './install-bible-harness.mjs';

// ── R1: a central-directory entry the local-header walk never meets ─────────────────────────────────────────────
function rawDeflate(parts) { return zlib.deflateRawSync(Buffer.concat(parts), { level: 9 }); }
const lhdr = (name, method, csz, usz) => { const b = Buffer.alloc(30); b.writeUInt32LE(0x04034b50, 0); b.writeUInt16LE(20, 4); b.writeUInt16LE(method, 8); b.writeUInt32LE(csz, 18); b.writeUInt32LE(usz, 22); b.writeUInt16LE(name.length, 26); return Buffer.concat([b, name]); };
const cdr = (name, method, csz, usz, off) => { const b = Buffer.alloc(46); b.writeUInt32LE(0x02014b50, 0); b.writeUInt16LE(20, 4); b.writeUInt16LE(20, 6); b.writeUInt16LE(method, 10); b.writeUInt32LE(csz, 20); b.writeUInt32LE(usz, 24); b.writeUInt16LE(name.length, 28); b.writeUInt32LE(off, 42); return Buffer.concat([b, name]); };
const eocd = (n, cdlen, cdoff) => { const b = Buffer.alloc(22); b.writeUInt32LE(0x06054b50, 0); b.writeUInt16LE(n, 8); b.writeUInt16LE(n, 10); b.writeUInt32LE(cdlen, 12); b.writeUInt32LE(cdoff, 16); return b; };

async function hiddenEntryZip(zeroMB = 24) {
  const db = await bibleDb('ZB', 'Zip Bomb Bible', 'In the beginning');
  const comp = rawDeflate([Buffer.from(db), Buffer.alloc(zeroMB * 1024 * 1024)]);              // a valid Bible, then zeros
  const X = Buffer.from('bomb.bbl.mybible'), Y = Buffer.from('a.txt');
  const inner = Buffer.concat([lhdr(X, 8, comp.length, db.length), comp]);                       // a whole local entry, INSIDE Y's data
  const yl = lhdr(Y, 0, inner.length, inner.length);
  const body = Buffer.concat([yl, inner]);
  const cd = Buffer.concat([cdr(Y, 0, inner.length, inner.length, 0), cdr(X, 8, comp.length, db.length, yl.length)]);   // the CD lists BOTH
  return { zip: new Uint8Array(Buffer.concat([body, cd, eocd(2, cd.length, body.length)])), db };
}

test('R1 — THE HIDDEN ENTRY: a central-directory record pointing INSIDE another entry\'s data is refused (the loader follows the central directory, so the check must too)', async () => {
  const { zip, db } = await hiddenEntryZip(24);
  assert.ok(zip.length < 200 * 1024, 'fixture is not small: ' + zip.length);
  // control: the loader (unzipSync, central directory) really does reach the hidden entry and decode it
  const seen = realFflate.unzipSync(zip);
  assert.ok(Object.keys(seen).includes('bomb.bbl.mybible'), 'fixture does not hide an entry the loader can reach');
  const p = await readyPhone();
  const before = held(p.Bible), puts = p.state.puts.length;
  const t0 = Date.now();
  const r = await p.Bible.installFromBytes(zip, 'bomb.bbl.mybible.zip');
  assert.deepEqual(r, { ok: false, reason: 'unusable' }, 'a hidden-entry decode bomb installed: ' + JSON.stringify(r));
  assert.equal(held(p.Bible), before); assert.equal(p.state.puts.length, puts); assert.equal(Object.keys(p.installed()).length, 0);
  assert.ok(Date.now() - t0 < 3000);
  // the same Bible, honestly, still installs; and so do two real USFM zips (a zip is not refused for being a zip)
  assert.equal((await p.Bible.installFromBytes(realFflate.zipSync({ 'ok.bbl.mybible': db }), 'ok.zip')).ok, true);
  assert.equal((await readyPhone().then(q => q.Bible.installFromBytes(file('modules/eng-kjv.zip'), 'eng-kjv.zip'))).ok, true);
});

test('R1b — two central-directory records on ONE local header (overlap), and a record whose sizes disagree with fflate\'s own walk, are refused', async () => {
  const db = await bibleDb('OV', 'Overlap Bible', 'x');
  const comp = rawDeflate([Buffer.from(db), Buffer.alloc(8 * 1024 * 1024)]);
  const X = Buffer.from('a.bbl.mybible'), X2 = Buffer.from('b.bbl.mybible');
  const body = Buffer.concat([lhdr(X, 8, comp.length, db.length), comp]);
  // both records point at offset 0; the second one lies about its size
  const cd = Buffer.concat([cdr(X, 8, comp.length, 8 * 1024 * 1024 + db.length, 0), cdr(X2, 8, comp.length, db.length, 0)]);
  const zip = new Uint8Array(Buffer.concat([body, cd, eocd(2, cd.length, body.length)]));
  const p = await readyPhone();
  const r = await p.Bible.installFromBytes(zip, 'o.zip');
  assert.deepEqual(r, { ok: false, reason: 'unusable' }, JSON.stringify(r));
  assert.equal(Object.keys(p.installed()).length, 0);
});

// ── R2: lookalike names ────────────────────────────────────────────────────────────────────────────────────────
test('R2 — LOOKALIKES of "King James Version" are labelled: Armenian o, Latin small-cap E, script g, dotless i, Cyrillic s, a soft hyphen; a plain unrelated name is not', async () => {
  const p = await readyPhone();
  const cases = [['KJ1', 'King James Versiօn'], ['KJ2', 'King James Verѕion'], ['KJ3', 'King James Vᴇrsion'], ['KJ4', 'Kinɡ James Version'], ['KJ5', 'King James Version­'], ['KJ6', 'Kıng James Version']];
  for (const [a, n] of cases) {
    const r = await p.Bible.installFromBytes(await bibleDb(a, n, 'x ' + a), '');
    assert.equal(r.renamed, true, `${JSON.stringify(n)} wore the catalogue's name with no label: ${JSON.stringify(r)}`);
    assert.match(r.name, /\(from a file/);
  }
});

test('R2b — LEGITIMATE non-English Bible names are NOT labelled (Spanish, Ukrainian, Greek, French, Chinese)', async () => {
  const p = await readyPhone();
  let i = 0;
  for (const n of ['Biblia Reina-Valera 1960', 'Святе Письмо', 'Η Αγία Γραφή', 'La Bible Louis Segond', '和合本圣经', 'Die Heilige Schrift']) {
    i++;
    const r = await p.Bible.installFromBytes(await bibleDb('X' + i, n, 'x ' + i), '');
    assert.equal(r.ok, true, n + ': ' + JSON.stringify(r));
    assert.equal(r.renamed, false, `${n} was labelled "(from a file)" though it imitates nothing: ${r.name}`);
  }
});

// ── L-a: the mirror's short abbreviations are not reserved ─────────────────────────────────────────────────────
test('L-a — A GENUINE "Amplified Bible" (AMP) and "Grace Chapel New Testament" (NT) are not labelled; the mirror\'s FULL names still are', async () => {
  const mirror = JSON.parse(readFileSync(ROOT + 'ebible-catalog.json', 'utf8')).items;
  assert.ok(mirror.some(m => m.abbr === 'AMP' || m.abbr === 'NT'), 'the mirror no longer has these short abbreviations — re-anchor');
  const p = await readyPhone();
  const a = await p.Bible.installFromBytes(await bibleDb('AMP', 'Amplified Bible', 'a'), '');
  const n = await p.Bible.installFromBytes(await bibleDb('NT', 'Grace Chapel New Testament', 'b'), '');
  assert.equal(a.renamed, false, 'a genuine Amplified Bible was labelled because the mirror has an abbreviation AMP: ' + JSON.stringify(a));
  assert.equal(n.renamed, false, JSON.stringify(n));
  const full = mirror.find(i => /^[A-Za-z ]{12,40}$/.test(i.name) && /^[A-Za-z0-9]{3,8}$/.test(i.abbr));
  const m = await p.Bible.installFromBytes(await bibleDb('ZZQ9', full.name, 'c'), '');
  assert.equal(m.renamed, true, 'a mirror translation\'s full name is no longer reserved');
});

// ── L-b: the catalogue slot ────────────────────────────────────────────────────────────────────────────────────
test('L-b — A REWRITTEN cross-reference file is never filed into a catalogue slot (only the very bytes that were received)', async () => {
  const cat = JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8'));              // a COPY, edited in memory; the real file is never touched
  const item = cat.categories.find(g => g.id === 'crossrefs').items.find(i => i.id === 'crossrefs-openbible');
  const realAbbr = item.abbr; item.abbr = 'OBX';                                     // the catalogue now names it differently from its own json
  const p = await readyPhone({ catalogJson: cat });
  const r = await p.Bible.installFromBytes(file('modules/crossrefs-openbible.json'), '');
  assert.equal(r.ok, true, JSON.stringify(r));
  const keys = Object.keys(p.installed());
  assert.ok(!keys.includes('modules/crossrefs-openbible.json'), 'rewritten bytes were saved in the catalogue\'s own slot, which a later restart would trust as the pinned copy');
  assert.ok(keys.every(k => k.startsWith('imported/')), keys);
  assert.equal(realAbbr, 'TSK');
});

// ── L-e: a stored unsafe module is quarantined at boot ─────────────────────────────────────────────────────────
function seeded(bytes, key = 'imported/old-import.bbl.mybible', name = 'Old Import') {
  const state = newStores();
  state.stores.set('modules', new Map([[key, bytes]]));
  state.ls.set('trinityone.installed', JSON.stringify({ [key]: { url: key, id: 'OLD', abbr: 'OLD', name, kind: 'bible', category: 'bibles' } }));
  return { state, key };
}

test('L-e — BOOT: a stored file under imported/ that holds a view, a trigger or a generated column is NOT loaded, is quarantined, and the member is told once', async () => {
  const bomb = await sqliteBytes(VIEW_BOMB);
  const generated = await sqliteBytes(`CREATE TABLE Details (Abbreviation TEXT, Description TEXT GENERATED ALWAYS AS (length(hex(zeroblob(100)))) VIRTUAL); INSERT INTO Details(Abbreviation) VALUES ('GG');
    CREATE TABLE Bible (Book INT, Chapter INT, Verse INT, Scripture TEXT); INSERT INTO Bible VALUES (1,1,1,'x');`);
  for (const [what, bytes] of [['a recursive view', bomb], ['a generated column', generated]]) {
    const { state, key } = seeded(bytes);
    const p = phone({ state }); const t0 = Date.now(); await p.boot();
    await sleep(60);
    assert.equal(p.Bible.versions().length, 0, `${what}: the unsafe module was loaded at boot`);
    assert.ok(Date.now() - t0 < 2500, `${what}: boot ran it (${Date.now() - t0} ms)`);
    const rec = JSON.parse(state.ls.get('trinityone.installed'))[key];
    assert.ok(rec && rec.quarantined === true, `${what}: the record was not marked quarantined (and must stay, so it can be removed): ${JSON.stringify(rec)}`);
    assert.deepEqual(JSON.parse(JSON.stringify(p.Bible.takeQuarantineNotices())), ['Old Import'], `${what}: the member was not told`);
    assert.deepEqual(JSON.parse(JSON.stringify(p.Bible.takeQuarantineNotices())), [], `${what}: the member is told again and again`);
    assert.ok(state.stores.get('modules').has(key), 'the bytes were deleted behind the member\'s back (they are removed from Library > Installed)');
  }
});

test('L-e2 — BOOT control: a SAFE stored import still loads, and is checked once (not on every boot)', async () => {
  const safe = await bibleDb('SAF', 'Safe Old Import', 'fine');
  const { state, key } = seeded(safe, 'imported/safe.bbl.mybible', 'Safe Old Import');
  const a = phone({ state }); await a.boot(); await until(() => a.Bible.versions().length === 1);
  assert.equal(JSON.parse(state.ls.get('trinityone.installed'))[key].checked, true, 'a passed stored import is not marked checked, so every boot re-opens it');
  assert.deepEqual(JSON.parse(JSON.stringify(a.Bible.takeQuarantineNotices())), []);
  const opened = a.sqlStats.opened;
  const b = phone({ state }); await b.boot(); await until(() => b.Bible.versions().length === 1);
  assert.equal(b.sqlStats.opened, 1, 'the second boot opened the stored module more than once (' + b.sqlStats.opened + ')');
  void opened;
});
