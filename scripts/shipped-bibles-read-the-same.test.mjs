// THE FIVE BIBLES WE SHIP MUST READ EXACTLY AS THEY DID — every verse's number, text and html, every footnote, the
// book list and every book's chapter count.
// Run: node --test scripts/shipped-bibles-read-the-same.test.mjs
//
// Guards the USFM reader (engine.js inlineUSFM / parseUSFM / buildFromUSFM / usfmText) against changes made for OTHER
// files. 2026-11-18: parseUSFM learned to read several verses on one line, `<`/`>` as text, \va/\vp, and footnotes keyed
// by position (reference/PLAN-bible-midline-verses-2026-11-18.md). None of that may move a shipped Bible by one byte:
// a highlight, a note or a bookmark is keyed by verse, and Today's verse, search and share read `text`.
//
// The constants were MEASURED on integration/2026-11-17 @ ab1ec8a5 (before that change) by this same hashing, over the
// shipped modules/*.zip, and re-confirmed against the plan's independent measurement (plan §6, audit §1). If one of
// them moves, a shipped Bible now reads differently: find out why before touching the constant.
//
// The six functions are lifted from the shipped engine.js by their exact first lines (scripts/test-slice.mjs fnBody)
// and RUN; nothing is matched as text. Pure node, no port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fnBody } from './test-slice.mjs';
const require = createRequire(import.meta.url);
const fflate = require('fflate');
const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(ROOT + 'engine.js', 'utf8');

function lift(src) {
  const s0 = src.indexOf('const USFM_BOOK = {');
  assert.ok(s0 > 0, 'USFM_BOOK is gone from engine.js — re-anchor');
  const usfmBook = src.slice(s0, src.indexOf('};', s0) + 2);
  const heb0 = src.indexOf('const _HEB = ');
  assert.ok(heb0 > 0, '_HEB is gone from engine.js — re-anchor');
  const heb = src.slice(heb0, src.indexOf('\n', src.indexOf('const HEBREW_LETTER', heb0)));
  const fns = ['function inlineUSFM(s){', 'function _balancedInline(html){', 'function parseUSFM(text){', 'function stripTags(s){',
    'function usfmText(html){', 'function buildFromUSFM(files, fallbackName){'].map(n => fnBody(src, n));
  return new Function([usfmBook, heb, ...fns].join('\n') + '\nreturn { buildFromUSFM };')();
}

function fingerprint(eng, zipPath) {
  const files = fflate.unzipSync(new Uint8Array(readFileSync(zipPath)));
  const b = eng.buildFromUSFM(files, zipPath.split('/').pop());
  const T = createHash('sha1'), H = createHash('sha1'), F = createHash('sha1'), S = createHash('sha1');
  S.update(JSON.stringify(b.books)); S.update(JSON.stringify(b.books.map(k => b.maxChap[k])));
  let verses = 0, notes = 0;
  for (const bk of b.books) for (let c = 1; c <= b.maxChap[bk]; c++) {
    for (const x of b.getVerses(bk, c)) { verses++; T.update(x.v + '\u0000' + x.text + '\u0001'); H.update(x.html + '\u0001'); }
    if (b.footnotes) { const f = b.footnotes(bk, c); notes += f.reduce((a, y) => a + y.notes.length, 0); F.update(JSON.stringify(f)); }
  }
  const h = (x) => x.digest('hex').slice(0, 16);
  return { books: b.books.length, verses, notes, shape: h(S), text: h(T), html: h(H), footnotes: h(F) };
}

// measured at ab1ec8a5 (the engine BEFORE the mid-line change)
const EXPECTED = {
  engbsb: { books: 66, verses: 31086, notes: 4846, shape: '85577a2859b72cef', text: '41769b18fdcc1d63', html: '9ea1bd084796eefe', footnotes: '80cd8d5b420886e2' },
  'eng-kjv': { books: 80, verses: 36822, notes: 6959, shape: '3f5746737ec3f9eb', text: '7543751a98fbceb2', html: '6f453615b8b32aec', footnotes: 'fd3c858eb3901331' },
  'eng-web': { books: 80, verses: 37528, notes: 1839, shape: '838bd8ef96c6f11b', text: '0433a87f1b1cd28f', html: '836fdf36e0aa953f', footnotes: '4746291f7a614718' },
  'eng-asv': { books: 66, verses: 31102, notes: 16, shape: '85577a2859b72cef', text: '0bd417815cb9b4ef', html: '23ec977166ccd008', footnotes: '9a3eed3f1da1520c' },
  'ahirani-usfm': { books: 38, verses: 14539, notes: 202, shape: '068c5945d77c4ecb', text: '7afca5b7523dc72e', html: 'e0221f318680b60a', footnotes: '59004a94668dc0e6' },
};

const eng = lift(SRC);
for (const id of Object.keys(EXPECTED)) {
  test(`${id}: every verse, footnote, book and chapter count reads exactly as before`, () => {
    assert.deepEqual(fingerprint(eng, ROOT + 'modules/' + id + '.zip'), EXPECTED[id]);
  });
}
