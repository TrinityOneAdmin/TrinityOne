// build-original.mjs — turn STEPBible's TAGNT (Greek NT) / TAHOT (Hebrew OT) into TrinityOne "original-language" modules.
//
// Source (CC BY 4.0, STEPBible.org / Tyndale House Cambridge), under
//   https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Translators%20Amalgamated%20OT+NT/
//   TAGNT Mat-Jhn …CC-BY.txt, TAGNT Act-Rev …CC-BY.txt                       -> modules/original-greek.json
//   TAHOT Gen-Deu / Jos-Est / Job-Sng / Isa-Mal …CC BY.txt                   -> modules/original-hebrew.json
// (exact file names are in the repo listing; download each into its OWN empty directory — the data is untrusted —
// and pass the paths here. This script never downloads and never reads the current directory.)
//
// Run:  node scripts/build-original.mjs greek  modules/original-greek.json  <TAGNT file>…
//       node scripts/build-original.mjs hebrew modules/original-hebrew.json <TAHOT file>…
//
// Output module (installed by engine.js installModule as kind "original", format "JSON"):
//   { meta:{ abbr, name, license:"STEPBible.org CC BY", kind:"original", lang:"greek"|"hebrew", source },
//     v:{ "<book>.<chap>.<verse>": [ [form, translit, strongs, morph], … ] } }
// The verse key is the SAME key the cross-reference module and Bible.refKey use: TrinityOne book number (1 = Genesis …
// 66 = Revelation), chapter, verse — "43.1.1" is John 1:1. Words are in reading order (Hebrew: right-to-left order of
// the text, i.e. the order the file gives them). No glosses: those already live in the Strong's lexicon.
//
// Which words are kept (the file marks each word with the manuscript editions that carry it):
//   Greek  — words in the Nestle-Aland text (type contains an UPPER-CASE "N": N, NK, N(k)O …). Words only some
//            other edition has (K/O/lower-case n) are dropped, so the verse reads as the critical text does.
//   Hebrew — words in the Leningrad text as read (type starts with L, or Q for a Qere reading). Ketiv-only (K),
//            restored (R) and apparatus-only (X) words are dropped.
// `strongs` is STEPBible's EXTENDED number (G0976, H7225G): the lexicon modules key on the plain number (G976, H7225),
// so engine.js compares by base number (leading zeros and the trailing letter removed).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// TrinityOne book order (engine.js BOOK_ABBR) — STEPBible's code is the same except John (Jhn).
const BOOKS = ['Gen','Exo','Lev','Num','Deu','Jos','Jdg','Rut','1Sa','2Sa','1Ki','2Ki','1Ch','2Ch','Ezr','Neh',
  'Est','Job','Psa','Pro','Ecc','Sng','Isa','Jer','Lam','Ezk','Dan','Hos','Jol','Amo','Oba','Jon',
  'Mic','Nam','Hab','Zep','Hag','Zec','Mal','Mat','Mrk','Luk','Jhn','Act','Rom','1Co','2Co','Gal',
  'Eph','Php','Col','1Th','2Th','1Ti','2Ti','Tit','Phm','Heb','Jas','1Pe','2Pe','1Jn','2Jn','3Jn','Jud','Rev'];
export const BOOK_NUM = Object.fromEntries(BOOKS.map((b, i) => [b, i + 1]));

// "Psa.3.1(3.2)" = English ref (Hebrew ref); "Act.19.40[19.41]" / "Jhn.7.53{8.1}" carry a variant-numbering ref. The FIRST ref is
// the English one the reader uses; the bracketed one is dropped.
const REF = /^([1-3]?[A-Za-z]{2,3})\.(\d+)\.(\d+)(?:[(\[{][^)\]}]*[)\]}])?#\d+=(\S+)$/;

export const META = {
  greek: { abbr: 'TAGNT', name: 'Greek New Testament (original words, STEPBible)', lang: 'greek' },
  hebrew: { abbr: 'TAHOT', name: 'Hebrew Old Testament (original words, STEPBible)', lang: 'hebrew' },
};
const LICENSE = 'STEPBible.org CC BY';
const SOURCE = 'github.com/STEPBible/STEPBible-Data (TAGNT / TAHOT), CC BY 4.0, STEPBible.org and Tyndale House Cambridge';

// Hebrew: drop the "/" and "\\" morpheme separators and the cantillation (trope) marks U+0591-05AF — vowel points stay.
// The trope marks are a fifth of the file and no use to a reader who is not chanting.
const clean = s => s.replace(/[\/\\]/g, '').replace(/[\u0591-\u05AF]/g, '').trim();

// one data line -> { key, word:[form, translit, strongs, morph] } or null (header, comment, variant-only word)
export function parseLine(line, lang) {
  if (!line || line[0] === '#') return null;
  const c = line.split('\t');
  const m = REF.exec(c[0]);
  if (!m) return null;
  const book = BOOK_NUM[m[1]];
  if (!book) return null;
  const type = m[4];
  let form, translit, strongs, morph;
  if (lang === 'greek') {
    if (!/N/.test(type)) return null;
    const w = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(c[1] || '');
    form = (w ? w[1] : (c[1] || '')).replace(/¶/g, '');   // a pilcrow is a paragraph mark, not part of the word
    translit = w ? w[2] : '';
    const g = (c[3] || '').split('=');
    strongs = g[0].split('|').pop().split('«').pop();
    morph = g[1] || '';
  } else {
    if (!/^[LQ]/.test(type)) return null;
    form = clean(c[1] || '');
    translit = clean(c[2] || '');
    const s = c[4] || '';
    const br = /\{([^}]+)\}/.exec(s);
    strongs = br ? br[1] : ((/H(?!9\d{3})\d{4}[A-Za-z]?/.exec(s) || [''])[0]);
    morph = c[5] || '';
  }
  if (!form || !strongs) return null;
  // NFC, so a word compares equal to the same word typed or stored elsewhere (STEPBible's Greek is decomposed).
  return { key: book + '.' + m[2] + '.' + m[3], word: [form.trim().normalize('NFC'), translit.trim().normalize('NFC'), strongs.trim(), morph.trim()] };
}

export function build(lang, texts) {
  const v = {};
  for (const t of texts) for (const line of t.split('\n')) {
    const r = parseLine(line.replace(/\r$/, ''), lang);
    if (r) (v[r.key] || (v[r.key] = [])).push(r.word);
  }
  return { meta: { ...META[lang], license: LICENSE, kind: 'original', source: SOURCE }, v };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [lang, out, ...ins] = process.argv.slice(2);
  if (!META[lang] || !out || !ins.length) { console.error('usage: build-original.mjs <greek|hebrew> <out.json> <input.txt>…'); process.exit(1); }
  const mod = build(lang, ins.map(p => readFileSync(p, 'utf8')));
  writeFileSync(out, JSON.stringify(mod));
  const verses = Object.keys(mod.v).length, words = Object.values(mod.v).reduce((n, a) => n + a.length, 0);
  console.log(`${out}: ${verses} verses, ${words} words`);
}
