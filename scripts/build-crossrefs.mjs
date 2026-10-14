// build-crossrefs.mjs — turn the openbible.info cross-reference dataset into a TrinityOne module.
//
// Source: https://a.openbible.info/data/cross-references.zip  (cross_references.txt, TSV)
//   columns: "From Verse" \t "To Verse" \t "Votes"
//   verses are OSIS ("Gen.1.1"); "To Verse" may be a range ("John.1.1-John.1.3"); votes can be negative
//   (community DOWNvotes — a poor cross-reference). Primary source is the public-domain Treasury of
//   Scripture Knowledge; the dataset is CC BY 4.0 (credit "www.openbible.info CC-BY", from the file header).
//
// Output: modules/crossrefs-openbible.json — the download-on-demand module, same shape idea as the JSON
// dictionaries (strongs-dict.json): installed through installModule(format:"JSON", kind:"crossref").
//   { meta: { abbr, name, license, kind:"crossref" },
//     refs: { "<book>.<chap>.<verse>": ["Display Ref", ...] } }   // book = TrinityOne 1..66; refs sorted best-first
//
// The "From Verse" key uses TrinityOne's own book numbering so the engine can collect a chapter's rows by
// prefix. Each target is a DISPLAY STRING built from the app's own book names (engine.js BOOK_NAMES order),
// so it round-trips through Bible.parseRef() for navigation with no second mapping at read time.
//
// Run: node scripts/build-crossrefs.mjs            (downloads the source)
//      node scripts/build-crossrefs.mjs <path>     (uses a local cross_references.txt instead)
import { unzipSync } from 'fflate';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'modules', 'crossrefs-openbible.json');
const SRC_URL = 'https://a.openbible.info/data/cross-references.zip';
const TOP_N = 8;            // most-voted cross-references kept per source verse
const MIN_VOTES = 1;        // drop zero/negative-vote links (community rejected them)

// OSIS book code -> TrinityOne book number (1..66). Verified to cover exactly the 66 codes present in the
// dataset; an unknown code is a hard error below so a dataset change can never silently drop a book.
const OSIS = {
  Gen:1, Exod:2, Lev:3, Num:4, Deut:5, Josh:6, Judg:7, Ruth:8,
  '1Sam':9, '2Sam':10, '1Kgs':11, '2Kgs':12, '1Chr':13, '2Chr':14, Ezra:15, Neh:16,
  Esth:17, Job:18, Ps:19, Prov:20, Eccl:21, Song:22, Isa:23, Jer:24,
  Lam:25, Ezek:26, Dan:27, Hos:28, Joel:29, Amos:30, Obad:31, Jonah:32,
  Mic:33, Nah:34, Hab:35, Zeph:36, Hag:37, Zech:38, Mal:39, Matt:40,
  Mark:41, Luke:42, John:43, Acts:44, Rom:45, '1Cor':46, '2Cor':47, Gal:48,
  Eph:49, Phil:50, Col:51, '1Thess':52, '2Thess':53, '1Tim':54, '2Tim':55, Titus:56,
  Phlm:57, Heb:58, Jas:59, '1Pet':60, '2Pet':61, '1John':62, '2John':63, '3John':64,
  Jude:65, Rev:66,
};
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

// "Gen.1.1" -> { num, chap, verse }; throws on an unknown book so nothing is silently dropped.
function parseOsis(ref) {
  const [bk, ch, vs] = ref.split('.');
  const num = OSIS[bk];
  if (!num) throw new Error('unknown OSIS book code: ' + bk + ' (in ' + ref + ')');
  return { num, chap: Number(ch), verse: Number(vs) };
}

// A "To Verse" cell -> a display string the app's parseRef can read. Same-chapter ranges become
// "Book C:V1-V2"; anything spanning chapters/books shows only the start verse (parseRef ignores the tail),
// which is what the reader navigates to.
function targetDisplay(cell) {
  const [start, end] = cell.split('-');
  const s = parseOsis(start);
  const base = NAMES[s.num - 1] + ' ' + s.chap + ':' + s.verse;
  if (end) {
    const e = parseOsis(end);
    if (e.num === s.num && e.chap === s.chap && e.verse > s.verse) return base + '-' + e.verse;
  }
  return base;
}

async function sourceText(argPath) {
  if (argPath) return readFileSync(argPath, 'utf8');
  process.stderr.write('downloading ' + SRC_URL + ' …\n');
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error('download failed: ' + res.status);
  const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const name = Object.keys(zip).find(n => /cross_references\.txt$/.test(n));
  if (!name) throw new Error('cross_references.txt not found in the archive');
  return new TextDecoder().decode(zip[name]);
}

const txt = await sourceText(process.argv[2]);
const lines = txt.split('\n');
const byKey = new Map();   // "num.chap.verse" -> [{ disp, votes }]
let kept = 0, dropped = 0;
for (let i = 1; i < lines.length; i++) {        // skip header
  const line = lines[i];
  if (!line) continue;
  const [from, to, votesStr] = line.split('\t');
  if (!from || !to) continue;
  const votes = parseInt(votesStr, 10);
  if (!(votes >= MIN_VOTES)) { dropped++; continue; }
  const f = parseOsis(from);
  const key = f.num + '.' + f.chap + '.' + f.verse;
  let arr = byKey.get(key); if (!arr) { arr = []; byKey.set(key, arr); }
  arr.push({ disp: targetDisplay(to), votes });
  kept++;
}

// Best-first, de-duplicated, capped. Store just the display strings.
const refs = {};
for (const [key, arr] of byKey) {
  arr.sort((a, b) => b.votes - a.votes);
  const seen = new Set(); const out = [];
  for (const r of arr) { if (seen.has(r.disp)) continue; seen.add(r.disp); out.push(r.disp); if (out.length >= TOP_N) break; }
  refs[key] = out;
}

const module = {
  meta: {
    abbr: 'TSK',
    name: 'Cross References (openbible.info)',
    license: 'CC BY 4.0 · www.openbible.info, from the Treasury of Scripture Knowledge (public domain)',
    kind: 'crossref',
  },
  refs,
};

mkdirSync(join(ROOT, 'modules'), { recursive: true });
const json = JSON.stringify(module);
writeFileSync(OUT, json);
const sha = createHash('sha256').update(json).digest('hex');
const mb = (Buffer.byteLength(json) / (1024 * 1024)).toFixed(1);
process.stderr.write(
  `wrote ${OUT}\n` +
  `  source verses: ${byKey.size}   links kept: ${kept}   dropped (votes<${MIN_VOTES}): ${dropped}\n` +
  `  size: ${mb} MB   sha256: ${sha}\n`);
