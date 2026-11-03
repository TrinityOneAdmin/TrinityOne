// build-geneva-crossrefs.mjs — turn the 1599 Geneva Bible marginal notes into a TrinityOne cross-ref module.
//
// Source: a MySword commentary DB (…/geneva-notes-1599.cmt.mybible). Its Commentary.Data HTML carries the
// cross-references as spans — `<span class="xref rBOOK.CHAP.VERSE">Display</span>` — where BOOK is already
// TrinityOne's 1..66 numbering (verified: r49.4.24 = Eph 4:24, r23.65.25 = Isa 65:25). A span may name a
// same-chapter verse range (`r4.12.7-8`). Every note is a single verse (ToVerse === FromVerse), so a note's
// key is simply Book.Chapter.FromVerse.
//
// Output: modules/crossrefs-geneva.json — the same shape as scripts/build-crossrefs.mjs (openbible/TSK), so
// engine.js loadCrossrefsJSON/getCrossRefs load and query it and the reader's Cross refs source picker offers
// it as a swap source:
//   { meta: { abbr:"GNV", name, license, kind:"crossref" },
//     refs: { "<book>.<chap>.<verse>": ["Display Ref", …] } }   // book = TrinityOne 1..66
//
// The display strings are rebuilt from the app's OWN book names (NOT the "Co2"-style abbreviations in the
// file), so each round-trips through Bible.parseRef() with no second mapping at read time. A book number
// outside 1..66 is a HARD ERROR, so a bad source can never silently drop or mis-file a reference.
//
// Run: node scripts/build-geneva-crossrefs.mjs [path-to.cmt.mybible]
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'modules', 'crossrefs-geneva.json');
const DEFAULT_DB = '/home/adminl/.claude/uploads/dbb39eae-bec7-4836-abd7-1953ec08fb37/1043e2d9-geneva-notes-1599.cmt.mybible';

// TrinityOne display names, in book order (must match engine.js BOOK_NAMES so parseRef() round-trips).
const NAMES = [
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
  '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah',
  'Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah',
  'Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah',
  'Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew',
  'Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians',
  'Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus',
  'Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John',
  'Jude','Revelation',
];

function name(num, ctx) {
  if (!(num >= 1 && num <= 66)) throw new Error('book number out of range 1..66: ' + num + ' (in ' + ctx + ')');
  return NAMES[num - 1];
}

const dbPath = process.argv[2] || DEFAULT_DB;
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare('SELECT Book AS b, Chapter AS c, FromVerse AS fv, ToVerse AS tv, Data AS d FROM Commentary').all();

const XREF = /class="xref r(\d+)\.(\d+)\.(\d+)(?:-(\d+))?"/g;
const refs = {};
let notesWithRefs = 0, spans = 0, ranges = 0;
for (const r of rows) {
  if (r.tv !== r.fv) throw new Error('a Geneva note spans more than one verse (' + r.b + '.' + r.c + '.' + r.fv + '-' + r.tv + ') — keying assumption broken');
  const data = String(r.d || '');
  let m, got = null;
  XREF.lastIndex = 0;
  while ((m = XREF.exec(data))) {
    const bk = Number(m[1]), ch = Number(m[2]), v1 = Number(m[3]), v2 = m[4] ? Number(m[4]) : 0;
    const ctx = r.b + '.' + r.c + '.' + r.fv;
    let disp = name(bk, ctx) + ' ' + ch + ':' + v1;
    if (v2 && v2 > v1) { disp += '-' + v2; ranges++; }
    (got || (got = [])).push(disp);
    spans++;
  }
  if (!got) continue;
  const key = r.b + '.' + r.c + '.' + r.fv;
  const arr = refs[key] || (refs[key] = []);
  for (const d of got) if (arr.indexOf(d) === -1) arr.push(d);
  notesWithRefs++;
}
db.close();

const module = {
  meta: {
    abbr: 'GNV',
    name: 'Geneva Notes 1599 cross-references',
    license: 'Public Domain · cross-references drawn from the marginal notes of the 1599 Geneva Bible (Ikram Hawramani modern-spelling ebook)',
    kind: 'crossref',
  },
  refs,
};

mkdirSync(join(ROOT, 'modules'), { recursive: true });
const json = JSON.stringify(module);
writeFileSync(OUT, json);
const sha = createHash('sha256').update(json).digest('hex');
const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
process.stderr.write(
  `wrote ${OUT}\n` +
  `  source verses with refs: ${notesWithRefs}   spans: ${spans}   same-chapter ranges: ${ranges}\n` +
  `  keys: ${Object.keys(refs).length}   size: ${kb} KB\n` +
  `  sha256: ${sha}\n`);
