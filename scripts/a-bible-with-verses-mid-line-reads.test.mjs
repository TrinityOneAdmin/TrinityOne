// A BIBLE WHOSE VERSES SHARE A LINE MUST READ — AND ONE WITH NO READABLE TEXT MUST NOT INSTALL.
// Run: node --test scripts/a-bible-with-verses-mid-line-reads.test.mjs
//
// Device report 2026-11-18 (reference/INVESTIGATION-browser-bible-install-empty-2026-11-18.md). Bible-society USFM
// ("release" bundles from eBible / the Digital Bible Library) writes `\p \v 1 … \v 2 …` — several verses on one line.
// parseUSFM only saw a verse when `\v` began a line, so every chapter of such a file was empty, and since the lazy
// parse (E1, 18c58333) a book is counted from its `\c` lines alone, so the file still "installed": a Bible with no text.
// Three owner files read 0 verses; after this fix 5,657 / 7,958 / 7,959 (measured in node; the files themselves are
// not committed — their licences are unknown — so the fixture below is written for this test, CC0).
//
// Everything here drives the REAL engine.js (in the install harness: a real install through installFromBytes, a real
// boot through restoreInstalled) and the REAL screens (ReadScreen, InstallFromFileSheet, SearchScreen compiled out of
// app/*.jsx and rendered through the miniature React). Nothing matches text in app/*.jsx (CLAUDE.md rule 3). Verse
// words are read from what the reader actually puts in the page — the dangerouslySetInnerHTML.__html of its nodes —
// never from a component's props.
//
// Plan: reference/PLAN-bible-midline-verses-2026-11-18.md; audit: reference/AUDIT-plan-bible-midline-verses-2026-11-18.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readyPhone, phone, newStores, records, cached, realFflate, enc, sqliteBytes } from './install-bible-harness.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

// ── the fixture: every shape the parser must handle on one line ──────────────────────────────────────────────
// v2 carries a footnote that itself contains `\v 9` (not a verse) and `<<x>>` (text, not markup); v3-4 is a range;
// v5 has a poetry break mid-line; v6 has \vp/\va numbers that are not verse text; v7 quotes with << >> (the Adele
// Old Testament's quotation marks) and carries a cross-reference; chapter 2 has a Psalm-style \d title and a note
// that is never closed; chapter 3 puts the chapter marker, the paragraph and the verse on one line.
const MIDLINE = [
  '\\id GEN Midline Test Bible',
  '\\h Genesis',
  '\\c 1',
  '\\s1 The start',
  '\\p \\v 1 In the beginning \\wj the word\\wj* was. \\v 2 Second verse\\f + \\fr 1:2 \\ft a note that names <<x>> and \\v 9 inside it\\f* ends. \\v 3-4 A joined pair.',
  '\\q1 \\v 5 Poetry line one \\q2 poetry line two',
  '\\p \\v 6 \\vp 6a\\vp* Six with a published number \\va 7\\va* here.',
  '\\p \\v 7 He said, <<Come.>> \\x - \\xo 1:7 \\xt Jn 1:1\\x* Done.',
  '\\c 2',
  '\\d A title \\v 1 Title verse.',
  '\\p \\v 2 Unclosed note \\f + \\ft never closed \\v 3 Three.',
  '\\c 3 \\p \\v 1 Chapter marker and verse on one line.',
  '',
].join('\n');
const zipOf = (files) => realFflate.zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc(v)])));
const midlineZip = () => zipOf({ '02-GEN.usfm': MIDLINE });
// chapters, no verses: what these files looked like to the old parser
const NO_TEXT = '\\id GEN Empty Test Bible\n\\c 1\n\\p Words with no verse marker.\n\\c 2\n\\c 3\n';
// Genesis has chapters but no text; Exodus has text
const GEN_EMPTY_EXO_TEXT = () => zipOf({
  '02-GEN.usfm': '\\id GEN Half Test Bible\n\\c 1\n\\p\n\\c 2\n',
  '03-EXO.usfm': '\\id EXO Half Test Bible\n\\c 1\n\\p\n\\v 1 These are the names.\n',
});
const GEN = 1, EXO = 2;

async function installed(bytes, hint) {
  const p = await readyPhone();
  const r = await p.Bible.installFromBytes(bytes, hint);
  return { p, r, Bible: p.Bible };
}

// ── the screens ──────────────────────────────────────────────────────────────────────────────────────────────
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
// what a screen puts in the page as html — the reader's verse body and lead, a search result line
const drawnHtml = (tree) => find(tree, n => n.props && n.props.dangerouslySetInnerHTML).map(n => n.props.dangerouslySetInnerHTML.__html).join('\n');
// the only tags parseUSFM may emit; anything else in drawn html is file text read as markup
const ONLY_OUR_TAGS = /<(?!\/?span\b|br>|\/?i\b|\/?sup\b)[^>]*>/;

function reader(Bible, version, loc) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = { Bible, speechSynthesis: null, innerWidth: 360, sanitizeHtml: h => h, getSelection: () => ({ toString: () => '' }), TrinityData: { CROSSREFS: {} } };
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' },
    setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams, SpeechSynthesisUtterance: class {},
    Icon, cx: (...a) => a.filter(Boolean).join(' '), lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'), BottomSheet: Stub('BottomSheet'), useBackLayer: () => {},
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'), IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
  };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], globals);
  const went = [];
  const ctx = { loc, version, setLoc: l => went.push(l), toast() {}, highlights: {}, notes: {}, bookmarks: [], toggleBookmark() {}, setHighlight() {}, setNote() {},
    openShareSheet() {}, desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {} };
  const tree = draw(ReadScreen, { ctx });
  return { tree, went, said: texts(tree).join(' | '), html: drawnHtml(tree) };
}
const goButtons = (tree) => find(tree, n => n.type === 'button' && /^Go to /.test(texts(n).join('').trim()));

function sheet(result) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const mod = loadScreen('app/install-bible.jsx', ['InstallFromFileSheet'], {
    React, window: { Bible: {} }, Icon, localStorage: { getItem: () => null, setItem() {} },
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', {}, children) : null),
    Spinner: () => null, fetch: async () => { throw new Error('no fetch'); },
  });
  const tree = draw(mod.InstallFromFileSheet, { state: { phase: 'result', result }, onInstall() {}, onClose() {}, ctx: { closeStore() {}, openStore() {} } });
  return texts(tree).join(' | ');
}

// ── T0: the engine reads every verse at install (Step 0: this failed on the base — ok:true, 0 verses) ────────
test('T0 — a Bible with several verses on a line installs WITH its verses, each in the right place', async () => {
  const { r, Bible } = await installed(midlineZip(), 'midline.zip');
  assert.equal(r.ok, true, JSON.stringify(r));
  const c1 = Bible.getVerses(GEN, 1, r.abbr);
  assert.deepEqual(Array.from(c1, x => String(x.v)), ['1', '2', '3-4', '5', '6', '7'], 'chapter 1 verses: ' + JSON.stringify(c1.map(x => x.v)));
  const by = Object.fromEntries(c1.map(x => [String(x.v), x]));
  assert.equal(by['1'].text, 'In the beginning the word was.');
  assert.equal(by['2'].text, 'Second verse ends.', 'a \\v inside a footnote was read as a verse, or the note leaked into the text');
  assert.equal(by['3-4'].text, 'A joined pair.');
  assert.match(by['5'].html, /Poetry line one <br>&emsp;poetry line two/, 'a mid-line \\q2 lost its line break');
  assert.equal(by['6'].text, 'Six with a published number here.', '\\vp / \\va numbers were left in the verse');
  assert.equal(by['7'].text, 'He said, <<Come.>> Done.', 'a << >> quotation was not kept as text');
  assert.match(by['7'].html, /He said, &lt;&lt;Come\.&gt;&gt; Done\./);
  const c2 = Bible.getVerses(GEN, 2, r.abbr);
  assert.deepEqual(Array.from(c2, x => String(x.v)), ['1', '2', '3'], 'a note never closed swallowed a verse: ' + JSON.stringify(c2.map(x => x.v)));
  assert.equal(c2[0].text, 'A title Title verse.', 'the \\d title must stay in verse 1 (owner, 2026-10-01)');
  assert.equal(c2[2].text, 'Three.');
  const c3 = Bible.getVerses(GEN, 3, r.abbr);
  assert.deepEqual(Array.from(c3, x => x.text), ['Chapter marker and verse on one line.']);
});

// ── T1: the reader draws them ─────────────────────────────────────────────────────────────────────────────
test('T1 — the reader DRAWS the verses of a mid-line Bible, and its << >> quotation as text, not markup', async () => {
  const { r, Bible } = await installed(midlineZip(), 'midline.zip');
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = reader(Bible, r.abbr, { book: GEN, chap: 1 });
  assert.doesNotMatch(v.said, /isn't in/, 'the reader says Genesis 1 is not in a Bible that has it. Drew: ' + v.said);
  assert.match(v.html, /In the beginning/, 'verse 1 is not drawn');
  assert.match(v.html, /Second verse ends/, 'verse 2 is not drawn');
  assert.match(v.html, /&lt;&lt;Come\.&gt;&gt;/, 'the << >> quotation is not drawn as text');
  assert.doesNotMatch(v.html, ONLY_OUR_TAGS, 'file text reached the page as markup: ' + (v.html.match(ONLY_OUR_TAGS) || [])[0]);
});

// ── T2: footnotes reach the Study panel, under the verse they belong to ─────────────────────────────────────
// Stops at the engine: getCommentary is what the Study panel lists, row for row (the panel itself is not rendered here).
test('T2 — a footnote in a mid-line Bible is filed under ITS verse, with << >> kept as text', async () => {
  const { r, Bible } = await installed(midlineZip(), 'midline.zip');
  const fn = Bible.getCommentary(GEN, 1, r.abbr).find(x => x.kind === 'footnotes');
  assert.ok(fn, 'no footnotes block for Genesis 1');
  assert.deepEqual(Array.from(fn.rows, x => x.v), [2], 'the footnote is not under verse 2: ' + JSON.stringify(fn.rows.map(x => x.v)));
  assert.match(fn.rows[0].html, /&lt;&lt;x&gt;&gt;/, 'the << >> inside the footnote reached the Study panel as markup');
});

// ── T3: the install gate ────────────────────────────────────────────────────────────────────────────────────



// ── T4: the reader's "Go to" button ──────────────────────────────────────────────────────────────────────────

// a record + bytes exactly as _installOne writes them (imported/<sha12>/<name>, checked) — what an older build left
async function seeded(bytes, name, abbr) {
  const state = newStores();
  const h = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const url = 'imported/' + h.slice(0, 12) + '/' + name;
  state.stores.set('modules', new Map([[url, bytes]]));
  state.ls.set('trinityone.installed', JSON.stringify({ [url]: { url, id: abbr, abbr, name: abbr + ' Bible', kind: 'bible', category: 'bibles', checked: true } }));
  const p = phone({ state });
  await p.boot();
  return { p, url, Bible: p.Bible };
}


// ── T6: installed copies heal without a reinstall ───────────────────────────────────────────────────────────
test('T6a — an install keeps the bytes it was given, unchanged (what lets a later build re-read them)', async () => {
  const bytes = midlineZip();
  const { p, r } = await installed(bytes, 'midline.zip');
  assert.equal(r.ok, true);
  const key = Object.keys(records(p.state))[0];
  assert.ok(key && key.startsWith('imported/'), 'no imported/ record: ' + key);
  assert.deepEqual(Buffer.from(cached(p.state, key)), Buffer.from(bytes), 'the stored copy is not the file that was installed');
});

test('T6b — a mid-line Bible stored by an older build READS after the next launch, with no reinstall', async () => {
  const { Bible } = await seeded(midlineZip(), 'midline.zip', 'OLD');
  const v = reader(Bible, 'OLD', { book: GEN, chap: 1 });
  assert.doesNotMatch(v.said, /isn't in|no text/, 'the stored Bible still reads empty after boot. Drew: ' + v.said);
  assert.match(v.html, /In the beginning/);
  assert.match(v.html, /&lt;&lt;Come\.&gt;&gt;/);
});

// ── T9: Search shows the << >> quotation in a result line ────────────────────────────────────────────────────
