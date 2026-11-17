// SAMPLE FILES FOR "Install a Bible from a file": one small known-good file for EVERY format the importer accepts, plus three
// known-bad ones. Nothing here is stored in the repo as a binary: they are built from modules/eng-web.zip and modules/eng-kjv.zip
// (eBible.org USFM, public domain) and from text written for this purpose (CC0), by buildSamples(), which both the test
// (scripts/install-bible-samples.test.mjs) and the folder writer (scripts/make-test-bibles.mjs) call.
//
// What the importer accepts (engine.js loadModuleBytes / installFromBytes): a MySword SQLite Bible/commentary/dictionary, bare or
// zipped; a zip of USFM books; a single USFM book; a cross-reference JSON. NOT supported: OSIS, USX, Zefania, plain text.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = new URL('../', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const fflate = require('fflate');
const initSqlJs = () => require(ROOT + 'vendor/sqljs/sql-wasm.js')({ locateFile: f => ROOT + 'vendor/sqljs/' + f });
const enc = (s) => new TextEncoder().encode(s);
const dec = (u8) => new TextDecoder().decode(u8);

async function sqlite(sql) { const SQL = await initSqlJs(); const db = new SQL.Database(); db.run(sql); const u8 = db.export(); db.close(); return u8; }
// a zip records the time each file was added: a FIXED local-time stamp (built from parts, so the machine's time zone cannot change it)
// makes a rebuild byte-for-byte the same as the last one
const zipFixed = (files) => fflate.zipSync(files, { mtime: new Date(2026, 0, 1, 0, 0, 0) });
const q = (s) => String(s).replace(/'/g, "''");

// the books we keep: Ruth (8), John (43), 3 John (64) - the whole of each
const BOOKS = [['RUT', 8], ['JHN', 43], ['3JN', 64]];
function pickBooks(zipPath, codes) {
  const all = fflate.unzipSync(new Uint8Array(readFileSync(ROOT + zipPath)));
  const out = {};
  for (const n of Object.keys(all)) { const m = n.match(/^\d+-([1-3A-Z]{3})/); if (m && codes.includes(m[1])) out[n] = all[n]; }
  return out;
}
// USFM -> {chapter: {verse: plain text}} (good enough for a sample; strong's, footnotes, cross-refs and markers are dropped)
function plainVerses(usfm) {
  const out = {}; let ch = 0, v = 0;
  for (const raw of usfm.split(/\r?\n/)) {
    let line = raw;
    let m;
    if ((m = line.match(/^\\c\s+(\d+)/))) { ch = +m[1]; v = 0; out[ch] = out[ch] || {}; continue; }
    if (!ch) continue;
    if ((m = line.match(/^\\v\s+(\d+)\S*\s*(.*)$/))) { v = +m[1]; line = m[2]; out[ch][v] = ''; }
    else if (!v || /^\\(s\d?|r|d|ms\d?|mr|sp|b|h|toc\d|mt\d?|id|ide|rem|cl|cp)\b/.test(line)) continue;
    line = line.replace(/\\f\s.*?\\f\*/g, '').replace(/\\x\s.*?\\x\*/g, '').replace(/\\\+?w\s+/g, '').replace(/\|[^\\|]*\\\+?w\*/g, '').replace(/\\[a-z0-9+]+\*?/gi, '').replace(/\s+/g, ' ').trim();
    if (line) out[ch][v] = ((out[ch][v] || '') + ' ' + line).trim();
  }
  return out;
}
function mysword(zipPath, abbr, desc) {
  const files = pickBooks(zipPath, BOOKS.map(b => b[0]));
  const rows = [];
  for (const [code, num] of BOOKS) {
    const name = Object.keys(files).find(n => n.includes('-' + code));
    const verses = plainVerses(dec(files[name]));
    for (const c of Object.keys(verses)) for (const v of Object.keys(verses[c])) if (verses[c][v]) rows.push(`(${num}, ${c}, ${v}, '${q(verses[c][v])}')`);
  }
  return sqlite(`CREATE TABLE Details (Description TEXT, Abbreviation TEXT, Comments TEXT, Version INT, RightToLeft INT);
    INSERT INTO Details VALUES ('${q(desc)}', '${q(abbr)}', 'A sample cut from the public-domain eBible.org text', 1, 0);
    CREATE TABLE Bible (Book INT, Chapter INT, Verse INT, Scripture TEXT);
    INSERT INTO Bible VALUES ${rows.join(',')};`);
}

const WEB_SRC = 'eBible.org World English Bible (USFM, as shipped in modules/eng-web.zip). Public domain.';
const KJV_SRC = 'eBible.org King James Version (USFM, as shipped in modules/eng-kjv.zip). Public domain in the United States (in the UK the text is under the Crown\'s letters patent; it is a sample).';
const OWN = 'Written for this test folder by TrinityOne. CC0 (no rights reserved).';

// each sample: file, format, what it is, source, licence, how it is checked after installing, and what the tester should see
export async function buildSamples() {
  const web = pickBooks('modules/eng-web.zip', ['RUT', 'JHN', '3JN']);
  const kjv = pickBooks('modules/eng-kjv.zip', ['RUT', '3JN']);
  const usfm3jn = dec(web[Object.keys(web).find(n => n.includes('-3JN'))]).replace(/^\\id .*$/m, '\\id 3JN World English Bible - 3 John only (sample)');
  const wDb = await mysword('modules/eng-web.zip', 'WEBS', 'WEB sample (MySword)');
  const wDb2 = await mysword('modules/eng-web.zip', 'WEBZ', 'WEB sample (MySword, zipped)');
  const notes = await sqlite(`CREATE TABLE Details (Description TEXT, Abbreviation TEXT, Comments TEXT);
    INSERT INTO Details VALUES ('Sample Study Notes', 'SSN', 'Notes written for the test folder');
    CREATE TABLE Commentary (Book INT, Chapter INT, FromVerse INT, ToVerse INT, Comments TEXT);
    INSERT INTO Commentary VALUES (43, 3, 16, 16, 'SAMPLE NOTE: the whole gospel in one sentence.'), (8, 1, 1, 1, 'SAMPLE NOTE: a famine, and a family that leaves.');`);
  const dict = await sqlite(`CREATE TABLE Details (Description TEXT, Abbreviation TEXT);
    INSERT INTO Details VALUES ('Sample Word List', 'SWL');
    CREATE TABLE Dictionary (topic TEXT, definition TEXT);
    INSERT INTO Dictionary VALUES ('AGAPE', 'SAMPLE ENTRY: self-giving love.'), ('GRACE', 'SAMPLE ENTRY: undeserved favour.');`);
  const refs = enc(JSON.stringify({ meta: { kind: 'crossref', abbr: 'SXR', name: 'Sample Cross References', license: 'CC0' }, refs: { '43.3.16': ['Romans 5:8', '1 John 4:9'], '8.1.1': ['Judges 2:16'] } }));
  const good = zipFixed({ 'ok.bbl.mybible': wDb });
  const at = good.length - 22; const loc = new Uint8Array(20); new DataView(loc.buffer).setUint32(0, 0x07064b50, true);
  const refused = new Uint8Array([...good.subarray(0, at), ...loc, ...good.subarray(at)]);       // a zip64 locator: refused by design

  return [
    { file: '01-web-usfm-sample.zip', bytes: zipFixed(web), format: 'USFM, zipped (one .usfm per book)', kind: 'bible', source: WEB_SRC + ' Cut to Ruth, John, 3 John.', licence: 'Public domain',
      name: '01-web-usfm-sample', check: { book: 43, chapter: 3, verse: 16, text: 'For God so loved the world' }, see: 'Read it now, then John 3:16 reads "For God so loved the world, that he gave his only born Son…". Genesis is not in this file: the reader says so and offers a book that is.' },
    { file: '02-web-3john-single-book.usfm', bytes: enc(usfm3jn), format: 'USFM, a single book file', kind: 'bible', source: WEB_SRC + ' 3 John only; the \\id line was edited to carry a name.', licence: 'Public domain',
      name: 'World English Bible - 3 John only (sample)', check: { book: 64, chapter: 1, verse: 1, text: 'The elder to Gaius the beloved' }, see: 'Name on the result screen: "World English Bible - 3 John only (sample)" (this name is not one TrinityOne offers, so nothing is added to it). Read it now opens 3 John 1, because 3 John is the only book in the file. 3 John 1:1 reads "The elder to Gaius the beloved, whom I love in truth."' },
    { file: '03-kjv-usfm-sample.zip', bytes: zipFixed(kjv), format: 'USFM, zipped (King James text)', kind: 'bible', source: KJV_SRC + ' Cut to Ruth, 3 John.', licence: 'Public domain (see source)',
      name: '03-kjv-usfm-sample', check: { book: 8, chapter: 1, verse: 1, text: 'judges ruled' }, see: 'Read it now opens Ruth 1 (the first book in the file; John, which you may have been reading, is not in it). Ruth 1:1 reads "Now it came to pass in the days when the judges ruled, that there was a famine in the land…" (KJV wording).' },
    { file: '04-web-sample.bbl.mybible', bytes: wDb, format: 'MySword Bible (.bbl.mybible, SQLite)', kind: 'bible', source: 'Built from ' + WEB_SRC + ' Cut to Ruth, John, 3 John; markers stripped.', licence: 'Public domain',
      name: 'WEB sample (MySword)', check: { book: 43, chapter: 3, verse: 16, text: 'For God so loved the world' }, see: 'Result screen: "Bible installed - WEB sample (MySword)". John 3:16 as above.' },
    { file: '05-web-sample.bbl.mybible.zip', bytes: zipFixed({ '05-web-sample.bbl.mybible': wDb2 }), format: 'MySword Bible, zipped', kind: 'bible', source: 'Built from ' + WEB_SRC, licence: 'Public domain',
      name: 'WEB sample (MySword, zipped)', check: { book: 8, chapter: 1, verse: 1, text: 'judges judged' }, see: 'Result screen: "Bible installed - WEB sample (MySword, zipped)". Ruth 1:1 reads "Now it happened in the days when the judges judged…".' },
    { file: '06-notes-sample.cmt.mybible', bytes: notes, format: 'MySword commentary (.cmt.mybible)', kind: 'comment', source: OWN, licence: 'CC0',
      name: 'Sample Study Notes', check: { commentary: [43, 3], text: 'SAMPLE NOTE: the whole gospel' }, see: 'Result screen: "Commentary installed - Sample Study Notes". Read John 3, open the study panel: the note "SAMPLE NOTE: the whole gospel in one sentence." appears, marked as imported.' },
    { file: '07-notes-sample.cmt.mybible.zip', bytes: zipFixed({ '07-notes-sample.cmt.mybible': await sqlite(`CREATE TABLE Details (Description TEXT, Abbreviation TEXT);
      INSERT INTO Details VALUES ('Sample Study Notes (zipped)', 'SSZ');
      CREATE TABLE Commentary (Book INT, Chapter INT, FromVerse INT, ToVerse INT, Comments TEXT);
      INSERT INTO Commentary VALUES (8, 1, 1, 1, 'SAMPLE NOTE ZIPPED: a famine, and a family that leaves.');`) }), format: 'MySword commentary, zipped', kind: 'comment', source: OWN, licence: 'CC0',
      name: 'Sample Study Notes (zipped)', check: { commentary: [8, 1], text: 'SAMPLE NOTE ZIPPED' }, see: 'Ruth 1 study panel shows "SAMPLE NOTE ZIPPED: a famine, and a family that leaves."' },
    { file: '08-words-sample.dct.mybible', bytes: dict, format: 'MySword dictionary (.dct.mybible)', kind: 'dict', source: OWN, licence: 'CC0',
      name: 'Sample Word List', check: { dict: 'AGAPE', text: 'SAMPLE ENTRY: self-giving love' }, see: 'Result screen: "Dictionary installed - Sample Word List". Searching the dictionaries for "agape" finds "SAMPLE ENTRY: self-giving love."' },
    { file: '09-refs-sample.json', bytes: refs, format: 'Cross-reference JSON', kind: 'crossref', source: OWN, licence: 'CC0',
      name: 'Sample Cross References', check: { xref: [43, 3, 16], text: 'Romans 5:8' }, see: 'Result screen: "Cross-references installed - Sample Cross References". John 3:16 lists Romans 5:8 and 1 John 4:9 under Cross refs.' },
    // known-bad: each must be REFUSED, with nothing installed
    { file: 'BAD-1-refused-zip.zip', bytes: refused, bad: true, format: 'a zip the reader refuses (a zip64 locator)', source: OWN, licence: 'CC0',
      see: '"TrinityOne can\'t use this file ... Nothing was installed." (the same screen any zip that is not safe to open gets)' },
    { file: 'BAD-2-not-a-bible.zip', bytes: zipFixed({ 'holiday.txt': enc('Not a Bible.') }), bad: true, format: 'a zip with no Bible in it', source: OWN, licence: 'CC0',
      see: '"TrinityOne can\'t use this file ... Nothing was installed."' },
    { file: 'BAD-3-osis-not-supported.xml', bytes: enc('<?xml version="1.0" encoding="UTF-8"?><osis><osisText osisIDWork="Sample"><div type="book" osisID="3John"><chapter osisID="3John.1"><verse osisID="3John.1.1">The elder to Gaius.</verse></chapter></div></osisText></osis>'), bad: true, format: 'OSIS XML (not supported yet)', source: OWN, licence: 'CC0',
      see: '"TrinityOne can\'t use this file ... Nothing was installed." OSIS, USX and Zefania files are not supported; convert them to USFM or MySword first.' },
  ];
}
