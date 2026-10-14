// CROSS REFERENCES REACH THE READER — real data, in the Study panel's own tab, tap opens the verse.
// Run: node --test scripts/a-cross-reference-in-the-reader-opens-that-verse.test.mjs
//
// Owner 2026-10-14: build cross-references into the main reader, in the same panel as the notes, from a real
// dataset (openbible.info / Treasury of Scripture Knowledge) — "no hard-coded stuff for the pilot".
// scripts/build-crossrefs.mjs turns the openbible.info set into modules/crossrefs-openbible.json; catalog.json
// offers it as a download; engine.js loadCrossrefsJSON/getCrossRefs load and query it; and CommentaryPanel's
// new "Cross refs" tab shows it, each reference tappable to that verse.
//
// WHAT THIS REFUSES TO DO (CLAUDE.md rule 3): it does not re-implement the loader or the parser, and it does
// not match text in app/*.jsx (those ship unbundled, so `false && ` leaves the words in place and a text
// assertion still passes). It lifts engine.js's OWN loadCrossrefsJSON, getCrossRefs and parseRef as source
// text and runs them over the FILE THAT SHIPS, then draws the REAL CommentaryPanel through the repo's
// mini-React. Chain asserted: file on disk -> shipped loader -> shipped query -> shipped panel -> a control a
// member taps -> shipped parseRef -> gotoRef(book,chap,verse).
//
// NOT ON A DEVICE: rule 6 still applies before this merges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts, reads, button } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ENGINE = readFileSync(ROOT + 'engine.js', 'utf8');
const CATALOG = JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8'));
const MODULE_URL = 'modules/crossrefs-openbible.json';
const MODULE = JSON.parse(readFileSync(ROOT + MODULE_URL, 'utf8'));

// ── engine.js's own parseRef, lifted with its book tables (the block from BOOK_NAMES down to parseRef) ──
const realParseRef = (() => {
  const preamble = ENGINE.slice(ENGINE.indexOf('const BOOK_NAMES = ['), ENGINE.indexOf('function parseRef(str){'));
  const src = preamble + fnBody(ENGINE, 'function parseRef(str){') + '\nreturn parseRef;';
  return new Function(src)();
})();

// ── engine.js's own cross-ref loader + query, lifted and run over the shipped module ──
function xrEngine() {
  const crossrefs = {};
  let notified = 0;
  const factory = new Function('crossrefs', 'ensureCrossrefs', 'notify',
    fnBody(ENGINE, 'function loadCrossrefsJSON(obj, abbr){') + '\n' +
    fnBody(ENGINE, 'function getCrossRefs(b, c){') + '\n' +
    'return { loadCrossrefsJSON, getCrossRefs };');
  const api = factory(crossrefs, () => {}, () => { notified++; });
  const abbr = api.loadCrossrefsJSON(MODULE, 'TSK');
  assert.ok(notified > 0, 'loadCrossrefsJSON never called notify — the harness reached nothing');
  return { ...api, crossrefs, abbr };
}

// ── the catalogue offers the real file, pinned ──
test('the cross-reference set is offered as a download, and the catalogue describes the file on disk', () => {
  const cat = (CATALOG.categories || []).find(c => c.id === 'crossrefs');
  assert.ok(cat, 'catalog.json has no crossrefs category — nobody can install the set');
  const it = (cat.items || []).find(x => x.id === 'crossrefs-openbible');
  assert.ok(it, 'the openbible cross-reference set is not offered');
  assert.equal(it.url, MODULE_URL);
  assert.equal(it.kind, 'crossref', 'the wrong kind sends it down the wrong branch of installModule');
  assert.equal(it.format, 'JSON', 'the format decides which branch of installModule runs');
  const bytes = readFileSync(ROOT + MODULE_URL);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), it.sha256,
    'catalog.json pins a different sha256 than the module on disk — rerun scripts/build-crossrefs.mjs');
  assert.ok(bytes.length < 50 * 1024 * 1024, 'over the 50 MB ceiling installModule enforces');
  assert.match(it.license, /CC BY 4\.0/, 'the store row does not name the licence');
  assert.match(it.license, /openbible\.info/, 'the store row does not credit openbible.info (CC BY requires it)');
});

// ── the engine reads it, and every reference round-trips through the SHIPPED parser ──
test("engine.js's own getCrossRefs returns a chapter's references, keyed by verse", () => {
  const eng = xrEngine();
  const john1 = eng.getCrossRefs(43, 1);                 // John 1
  assert.ok(Object.keys(john1).length >= 3, 'John 1 came back with almost no cross-referenced verses');
  assert.ok(Array.isArray(john1[1]) && john1[1].length, 'John 1:1 has no cross references');
  assert.ok(john1[1].includes('Genesis 1:1'), 'John 1:1 -> Genesis 1:1 (its best-voted link) is missing: ' + JSON.stringify(john1[1]));
  // a different chapter is genuinely different, not the same list echoed back
  const rom8 = eng.getCrossRefs(45, 8);
  assert.ok(rom8[28] && rom8[28].length, 'Romans 8:28 has no cross references');
  assert.notDeepEqual(rom8[28], john1[1], 'two different verses returned the same cross-reference list');
});

test('EVERY reference the set produces round-trips through engine.js parseRef — no wrong book, no junk', () => {
  // The display strings are built in build-crossrefs.mjs from the OSIS source; this proves the SHIPPED parser
  // reads each one back to a real location, so a tap navigates somewhere valid. Sampled across the whole set.
  let checked = 0;
  const keys = Object.keys(MODULE.refs);
  for (let i = 0; i < keys.length; i += 97) {            // ~300 verses spread across all 66 books
    for (const ref of MODULE.refs[keys[i]]) {
      const loc = realParseRef(ref);
      assert.ok(loc && loc.book >= 1 && loc.book <= 66 && loc.chap >= 1 && loc.verse >= 1,
        `a cross-reference does not parse to a real verse: ${JSON.stringify(ref)} -> ${JSON.stringify(loc)}`);
      checked++;
    }
  }
  assert.ok(checked > 500, `only ${checked} references were checked — the sample is too thin`);
  // a same-chapter range keeps its end verse (parseRef carries verseEnd); the key it sits under is a real verse
  const ranged = Object.values(MODULE.refs).flat().find(r => /:\d+-\d+$/.test(r));
  assert.ok(ranged, 'the set has no same-chapter ranges at all — the converter dropped them');
  const rl = realParseRef(ranged);
  assert.ok(rl && rl.verseEnd > rl.verse, `a range did not parse as a range: ${ranged} -> ${JSON.stringify(rl)}`);
});

// ── POINT OF USE: the reader's Study panel, its Cross refs tab, a real tap ──
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function studyPanel(loc, label) {
  const eng = xrEngine();
  const gotoCalls = [];
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = {
    Bible: {
      getCrossRefs: eng.getCrossRefs, parseRef: realParseRef,
      crossrefLicense: () => MODULE.meta.license,
      getCommentary: () => [], subscribe: () => () => {},
      refKey: (l, v) => l.book + '.' + l.chap + '.' + v,
    },
    sanitizeHtml: h => h, innerWidth: 360,
  };
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' },
    setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams,
    SpeechSynthesisUtterance: class {},
    Icon, cx: (...a) => a.filter(Boolean).join(' '),
    lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'), BottomSheet: Stub('BottomSheet'),
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'),
    IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
  };
  const { CommentaryPanel } = loadScreen('app/screens-read.jsx', ['CommentaryPanel'], globals);
  const ctx = { notes: {}, setNote() {}, gotoRef: (book, chap, verse) => gotoCalls.push({ book, chap, verse }), version: 'BSB' };
  const props = { loc, label, open: true, onClose() {}, ctx, docked: true };
  let tree = draw(CommentaryPanel, props);
  // the tab must be on the screen; switch to it, then let the effect fetch + the next paint render
  const tab = button(tree, 'Cross refs');
  assert.equal(tab.length, 1, 'there is no "Cross refs" tab in the Study panel');
  tab[0].props.onClick();
  draw(CommentaryPanel, props);          // view -> crossrefs, effect runs getCrossRefs -> setXrefs
  tree = draw(CommentaryPanel, props);   // xrefs now on screen
  return { tree, gotoCalls };
}

test('POINT OF USE: the Cross refs tab shows this chapter\'s references, with the openbible.info credit', () => {
  const { tree } = studyPanel({ book: 43, chap: 1 }, 'John 1');
  const page = reads(tree);
  assert.match(page, /Genesis 1:1/, 'John 1:1 -> Genesis 1:1 is not on the screen');
  // references are grouped under a per-verse heading ("John 1:1", "John 1:4", …), not dumped in one list
  assert.match(page, /John 1:1/, 'the panel does not label which verse a reference belongs to');
  assert.match(page, /John 1:4/, 'the references are not grouped per verse');
  assert.match(page, /openbible\.info/, 'the CC BY credit is not shown beside the references');
});

test('POINT OF USE: tapping a cross-reference opens THAT verse via gotoRef — not the last page', () => {
  const { tree, gotoCalls } = studyPanel({ book: 43, chap: 1 }, 'John 1');
  const b = button(tree, 'Genesis 1:1').filter(n => texts(n).join('').includes('Genesis 1:1'));
  assert.ok(b.length >= 1, 'Genesis 1:1 is not a tappable control in the Cross refs tab');
  b[0].props.onClick();
  assert.deepEqual(gotoCalls, [{ book: 1, chap: 1, verse: 1 }],
    'tapping a cross-reference did not navigate to that exact verse via gotoRef');
});
