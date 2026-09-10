// AQUIFER OPEN STUDY NOTES REACH THE STUDY PANEL — WITH THEIR LICENCE.
// Run: node --test scripts/aquifer-study-notes-reach-the-study-panel.test.mjs
//
// Slice 1 of the Bible study-resource work: scripts/build-aquifer-studynotes.py turns the Aquifer Open Study
// Notes JSON into modules/aquifer-osn-eng.cmt.mybible.zip, catalog.json offers it as a download, and the
// reader's Study panel shows it. The notes are CC BY-SA 4.0, so the attribution is not decoration — a module
// whose licence notice cannot be reached from the Study panel is not finished (owner decision 5, 2026-09-10).
//
// WHAT THIS FILE REFUSES TO DO. It does not re-implement the loader, and it does not match text in
// app/*.jsx (CLAUDE.md rule 3 — those ship unbundled, so `false && ` in front of a condition leaves every
// word of it in place and a text assertion still passes). Instead:
//
//   · the module read here is THE FILE THAT SHIPS, modules/aquifer-osn-eng.cmt.mybible.zip, unzipped with
//     the same fflate the engine uses;
//   · it is opened by ENGINE.JS'S OWN openDb / detailsOf / buildCommentaryFromDb / parseVerse / addCommentary
//     / getCommentary, lifted out of engine.js as source text and run — not copies of them;
//   · the SQLite is read by the real sql.js the app ships in vendor/sqljs/;
//   · and the screen is the real CommentaryPanel out of app/screens-read.jsx, compiled by the same esbuild
//     the build uses and drawn through the miniature React in scripts/render-jsx-screen.mjs.
//
// So the chain asserted is: file on disk → shipped loader → shipped getCommentary → shipped panel → text a
// member can read. There are THREE point-of-use tests over that chain — the notes on the screen, the licence
// on the screen, and a cross-book note naming where it came from. Delete the licence line from the panel, or
// the `license` field from getCommentary, and the licence one goes red on its own.
//
// THE OFF-BY-ONE THAT WOULD HAVE PUT EVERY NOTE ONE BOOK OUT. Aquifer keys passages as BBBCCCVVV with 1-based
// book numbers, and so does this app (`bookName = n => BOOK_NAMES[n - 1]`, engine.js:66). That is asserted
// here rather than assumed, and not against a hand-typed table: the module's own lowest and highest chapter
// with notes, for all 66 books, is compared against the chapter counts of the Bible THIS APP SHIPS
// (modules/engbsb.zip), computed by engine.js's own buildFromUSFM. All 66 match exactly, and a shift of one
// book in either direction breaks dozens of them at once.
//
// THAT IS A CLAIM ABOUT CHAPTER COUNTS, NOT ABOUT VERSIFICATION, and the two are not the same. Four rows of
// 16,932 (0.024%) carry a verse number the shipped BSB's chapter does not reach — 3 John 1 assumes 15 verses
// where the BSB has 14, and Revelation 12 has two rows on v18 where the BSB's chapter ends at 17 because that
// material is 13:1 there. The content of all four is right; the label is one verse-boundary out. The test
// below pins that set at exactly those four, so it is a measured fact with a tripwire rather than a sentence
// in a comment that quietly stops being true.
//
// MEASURED RED/GREEN, 2026-09-10, re-measured after the audit follow-up added tests 6 and 9. Each sabotage
// is SCOPED — the enclosing function is sliced out, the anchor asserted to appear exactly once inside that
// slice, and only then replaced (CLAUDE.md), because near-identical siblings are the house style and a plain
// string-replace hits somebody else's function:
//   · as committed                                                       10 pass / 0 fail
//   · `license: s.license || ""` dropped from engine.js getCommentary      8 pass / 2 fail
//   · the licence line disabled in CommentaryPanel with `false && `,
//     leaving every word of it in app/screens-read.jsx                     9 pass / 1 fail  -- the licence
//                                                                         point-of-use test, ALONE. This is
//                                                                         the rule-1 check: the feature was
//                                                                         removed from the SCREEN only.
//   · `license: det.license` dropped from buildCommentaryFromDb            7 pass / 3 fail
//   · the cross-book title lead-in disabled in the converter and the
//     module rebuilt                                                       8 pass / 2 fail  -- test 9 and
//                                                                         the catalogue hash. The rebuild's
//                                                                         hash reverted exactly to the
//                                                                         pre-title build's, which is its
//                                                                         own proof that the lead-in is the
//                                                                         only difference between them.
//   · decode_ref shifted +1 in the converter and the module rebuilt        4 pass / 6 fail
//
// And the harness cannot be silently empty: `entered` counts calls into engine.js's own notify() from its
// own addCommentary, and loadedNotes() refuses to continue at zero (see the note above engineChain).
//
// WHAT THIS FILE DOES NOT PROVE. It never downloads the module — nothing here touches the network (see
// CLAUDE.md on ASSET_BASE and app.trinityone.church) — so installModule, fetchAndCacheModule, the IndexedDB
// cache and verifyIntegrity are all outside it. Those are proved in a real browser against a real gateway by
// scripts/a-tampered-module-is-refused.test.mjs. And NOTHING HERE HAS BEEN ON A DEVICE: rule 6 still applies
// before this merges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { unzipSync } from 'fflate';
import { fnBody, stmt } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const require = createRequire(import.meta.url);
const ROOT = new URL('../', import.meta.url).pathname;
const ENGINE = readFileSync(ROOT + 'engine.js', 'utf8');
const CATALOG = JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8'));

const MODULE_URL = 'modules/aquifer-osn-eng.cmt.mybible.zip';
const DB_ENTRY = 'aquifer-osn-eng.cmt.mybible';

const entry = () => {
  const cat = (CATALOG.categories || []).find(c => c.id === 'commentaries');
  assert.ok(cat, 'catalog.json has no commentaries category');
  const it = (cat.items || []).find(x => x.id === 'aquifer-osn-eng');
  assert.ok(it, 'catalog.json does not offer the Aquifer study notes — nobody can install them');
  return it;
};

// ── the engine, lifted and run ────────────────────────────────────────────────────────────────────────────
// Concatenated as TOP-LEVEL declarations inside one `new Function`, then returned by name. Deliberately NOT
// nested inside an object literal: fnBody() hands back the whole construct INCLUDING its signature, so
// `{ openDb: fnBody(...) }` is a syntax error at best and, wrapped a little differently, a harness that
// silently runs nothing while every negative test passes vacuously. `entered` below is the counter that
// proves this harness really got inside the engine's code.
let entered = 0;
function engineChain() {
  const parts = [
    stmt(ENGINE, 'const BOOK_NAMES = [', 'BOOK_NAMES'),
    stmt(ENGINE, 'const USFM_BOOK = {', 'USFM_BOOK'),
    fnBody(ENGINE, 'function parseVerse(s){'),
    fnBody(ENGINE, 'async function openDb(dbBytes){'),
    fnBody(ENGINE, 'function detailsOf(db, fb){'),
    fnBody(ENGINE, 'function buildCommentaryFromDb(db, fb){'),
    fnBody(ENGINE, 'function addCommentary(src){'),
    fnBody(ENGINE, 'function getCommentary(b, c, version){'),
    fnBody(ENGINE, 'function buildFromUSFM(files, fallbackName){'),
    // The BSB's per-chapter VERSE counts need buildFromUSFM's lazy half too, so these three come along.
    fnBody(ENGINE, 'function inlineUSFM(s){'),
    fnBody(ENGINE, 'function parseUSFM(text){'),
    fnBody(ENGINE, 'function stripTags(s){'),
  ];
  const commentaries = {};
  const factory = new Function('initSqlJs', 'SQLJS_BASE', 'commentaries', 'notify', 'src',
    parts.join('\n') +
    '\nreturn { BOOK_NAMES, openDb, detailsOf, buildCommentaryFromDb, addCommentary, getCommentary, buildFromUSFM };');
  const api = factory(
    require(ROOT + 'vendor/sqljs/sql-wasm.js'),
    ROOT + 'vendor/sqljs/',
    commentaries,
    () => { entered++; },                                   // engine.js's notify(), counted
    () => null,                                             // src(version): no active Bible, so no footnotes block
  );
  return { ...api, commentaries };
}

// The module's bytes, and the SQLite inside it, exactly as the engine would find them.
function moduleFiles() {
  const zip = unzipSync(readFileSync(ROOT + MODULE_URL));
  const names = Object.keys(zip);
  assert.ok(names.includes(DB_ENTRY), `the module archive holds ${JSON.stringify(names)} — no ${DB_ENTRY}`);
  return { zip, names };
}

// Load the real module through the real loader, and hand back what getCommentary() gives the panel.
let loaded = null;
async function loadedNotes() {
  if (loaded) return loaded;
  const eng = engineChain();
  const { zip } = moduleFiles();
  const db = await eng.openDb(zip[DB_ENTRY]);
  const cmt = eng.buildCommentaryFromDb(db, DB_ENTRY);
  assert.ok(cmt, 'engine.js buildCommentaryFromDb refused the module — it will not install on a phone');
  eng.addCommentary(cmt);
  assert.ok(entered > 0, 'the harness never reached engine.js addCommentary — every assertion below would be vacuous');
  assert.deepEqual(Object.keys(eng.commentaries), [cmt.abbr], 'addCommentary did not register the module');
  loaded = { eng, cmt, db };
  return loaded;
}

// ── the catalogue ─────────────────────────────────────────────────────────────────────────────────────────

test('the study notes are offered as a download, and the catalogue describes the file that is really there', () => {
  const it = entry();
  assert.equal(it.url, MODULE_URL);
  assert.equal(it.kind, 'comment', 'the wrong kind puts it in the wrong section of the store');
  assert.equal(it.format, 'MySword', 'the format decides which branch of installModule runs');
  const bytes = readFileSync(ROOT + MODULE_URL);
  // WHAT THIS PIN IS WORTH, STATED HONESTLY. As first committed on this branch it was worth NOTHING:
  // installModule did not forward `item.sha256` on the MySword/USFM branch, so verifyIntegrity received
  // `undefined` and fell back to the two hashes in KNOWN_HASHES. Found by audit, fixed in the follow-up
  // commit, and proved end to end in a real browser by scripts/a-tampered-module-is-refused.test.mjs — that
  // file, not this line, is what says the pin is enforced. Since the fix, a rebuilt module with a stale
  // catalogue entry really is uninstallable, which is why this assertion exists: it goes red on this box
  // before anyone's phone ever sees the mismatch. The build is reproducible (fixed zip timestamps) so the
  // pin is stable between rebuilds on the same toolchain — see the caveat in the converter's header.
  assert.equal(createHash('sha256').update(bytes).digest('hex'), it.sha256,
    'catalog.json pins a different sha256 than the module on disk — rerun scripts/build-aquifer-studynotes.py and paste the two fields it prints');
  assert.equal(it.size, (bytes.length / 1e6).toFixed(1) + ' MB', 'the size shown in the store is not the size of the file');
  assert.ok(bytes.length < 50 * 1024 * 1024, 'over the 50 MB ceiling installModule enforces');
  // The licence has to be visible BEFORE the download too — StoreRow prints item.license.
  assert.match(it.license, /CC BY-SA 4\.0/, 'the store row does not name the licence');
});

test("the shipped loader picks our SQLite out of the archive, and nothing else in it", () => {
  // The regex is read out of loadModuleBytes rather than retyped, so renaming the module file to something
  // the loader does not recognise fails here instead of on a phone.
  const slice = fnBody(ENGINE, 'async function loadModuleBytes(u8, srcName, meta){');
  const m = /\/\\\.\(([^)]*)\)\$\/i/.exec(slice);
  assert.ok(m, 'could not find the archive-member pattern in loadModuleBytes — re-anchor this test');
  const re = new RegExp('\\.(' + m[1] + ')$', 'i');
  const { names } = moduleFiles();
  const picked = names.filter(n => !n.startsWith('__MACOSX') && re.test(n));
  assert.deepEqual(picked, [DB_ENTRY], `the loader would pick ${JSON.stringify(picked)} out of ${JSON.stringify(names)}`);
  // and the licence file rides along without confusing it
  assert.ok(names.some(n => /CC-BY-SA/i.test(n)), 'the archive carries no licence file — the notice must travel with the module');
});

// ── the engine reads it ───────────────────────────────────────────────────────────────────────────────────

test("engine.js's own commentary loader reads the module, licence and all", async () => {
  const { cmt } = await loadedNotes();
  assert.equal(cmt.kind, 'comment');
  assert.match(cmt.name, /Aquifer Open Study Notes/);
  assert.match(cmt.license, /CC BY-SA 4\.0/, 'the module carries no licence notice for the panel to show');
  assert.match(cmt.license, /Mission Mutual/, 'the licence notice does not credit the author CC BY-SA requires naming');
  assert.match(cmt.license, /Tyndale/, 'the notice does not say what this is an adaptation of');
});

test('the notes for a chapter come back as verse-keyed rows', async () => {
  const { cmt } = await loadedNotes();
  const rows = cmt.getComment(63, 1);                 // 2 John 1 — one chapter, small enough to read whole
  assert.ok(rows.length >= 5, `2 John 1 returned ${rows.length} notes`);
  assert.ok(rows.every(r => Number.isInteger(r.v) && r.html && r.html.trim()), 'a row came back with no verse or no text');
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].v <= r.v), 'the rows are not in verse order');
  assert.match(rows.map(r => r.html).join(' '), /the elder/i, 'the note on 2 John 1:1 is not in the module');
  // <data class="bible-ref"> is not a tag the reader renders, so the converter unwrapped it at build time.
  // If it came back it would mean the shipped bytes are not the bytes that render.
  assert.doesNotMatch(rows.map(r => r.html).join(' '), /<data|<\/data>|<a\s|<h3/i,
    'the module still carries markup the reader drops — the converter did not normalise it');
  assert.deepEqual(cmt.getComment(63, 2), [], '2 John has one chapter, but chapter 2 returned notes');
});

test('THE BOOK NUMBERS ARE THE ENGINE\'S OWN — checked against the Bible this app ships, not a typed table', async () => {
  const { cmt, eng, db } = await loadedNotes();
  // What the notes claim: for each book, the lowest and highest chapter they have anything to say about.
  const claim = {};
  for (const r of db.q('SELECT Book AS b, MIN(Chapter) AS lo, MAX(Chapter) AS hi FROM Commentary GROUP BY Book ORDER BY Book')) claim[r.b] = r;
  // What the app's own Bible says, parsed by the app's own USFM reader.
  const bsb = eng.buildFromUSFM(unzipSync(readFileSync(ROOT + 'modules/engbsb.zip')), 'engbsb.zip');
  assert.ok(bsb && bsb.books.length === 66, `the shipped BSB parsed to ${bsb ? bsb.books.length : 0} books — re-anchor this test`);

  assert.deepEqual(Object.keys(claim).map(Number).sort((a, b) => a - b), bsb.books,
    'the notes and the shipped Bible do not even agree on which book numbers exist');
  for (const b of bsb.books) {
    assert.equal(claim[b].lo, 1, `${eng.BOOK_NAMES[b - 1]} (book ${b}) has no notes on chapter 1`);
    assert.equal(claim[b].hi, bsb.maxChap[b],
      `${eng.BOOK_NAMES[b - 1]} (book ${b}) has notes up to chapter ${claim[b].hi}, but the Bible this app ships has ${bsb.maxChap[b]} chapters`
      + ' — the notes are keyed to a different book numbering than the reader uses');
  }
  // Named spot checks, so a failure above is readable as "the notes are one book out" rather than arithmetic.
  assert.equal(eng.BOOK_NAMES[19 - 1], 'Psalms');
  assert.equal(claim[19].hi, 150, 'book 19 does not have 150 chapters of notes — only Psalms does');
  assert.equal(eng.BOOK_NAMES[31 - 1], 'Obadiah');
  assert.equal(claim[31].hi, 1, 'book 31 has more than one chapter of notes — Obadiah has one');
  assert.ok(cmt.getComment(1, 1).length, 'Genesis 1 has no notes');
  assert.ok(cmt.getComment(66, 22).length, 'Revelation 22 has no notes');
});

test('the verse keys sit inside the shipped Bible\'s verses — with FOUR named exceptions and no others', async () => {
  // Test 5 proves the BOOK and CHAPTER keys line up exactly. VERSIFICATION is a separate question and the
  // answer is not "exactly": Aquifer's notes were written against a versification that differs from the
  // BSB's in two places, and pretending otherwise is the kind of claim CLAUDE.md rule 4 exists to stop.
  //
  // What is asserted is the SIZE and the SHAPE of the divergence: exactly four rows of 16,932 (0.024%) fall
  // outside the shipped BSB's verse range, and they are these four. Content is right in all four; only the
  // label is one verse-boundary out. A fifth would mean something new — a converter bug, or an upstream
  // change — and this goes red rather than the fact quietly rotting in a comment.
  //   · 3 John 1 v13–15 and v15 — the notes assume 15 verses, the BSB's 3 John has 14
  //   · Revelation 12 v18, twice — the BSB's Rev 12 ends at 17 and that material is 13:1, so the
  //     introduction to Revelation 13 is filed under Revelation 12
  const { eng, db } = await loadedNotes();
  const bsb = eng.buildFromUSFM(unzipSync(readFileSync(ROOT + 'modules/engbsb.zip')), 'engbsb.zip');
  const lastVerse = (b, c) => { const vs = bsb.getVerses(b, c); return vs.length ? Math.max(...vs.map(v => v.v)) : 0; };
  const outside = [];
  for (const r of db.q('SELECT Book AS b, Chapter AS c, FromVerse AS fv, ToVerse AS tv FROM Commentary ORDER BY Book, Chapter, FromVerse')) {
    const lim = lastVerse(r.b, r.c);
    assert.ok(lim > 0, `the shipped BSB has no ${eng.BOOK_NAMES[r.b - 1]} ${r.c}, but the notes do`);
    if (r.fv > lim || r.tv > lim) outside.push(`${eng.BOOK_NAMES[r.b - 1]} ${r.c}:${r.fv}-${r.tv} (BSB ends at v${lim})`);
  }
  // sorted, because two rows on the same verse tie under ORDER BY and SQLite's tie-break is not a
  // guarantee — an assertion that depended on it would flap without anything changing.
  outside.sort();
  assert.deepEqual(outside, [
    '3 John 1:13-15 (BSB ends at v14)',
    '3 John 1:15-15 (BSB ends at v14)',
    'Revelation 12:18-0 (BSB ends at v17)',
    'Revelation 12:18-18 (BSB ends at v17)',
  ], 'the set of rows whose verse numbers fall outside the shipped Bible has changed');
});

// ── THE POINT OF USE: the Study panel ─────────────────────────────────────────────────────────────────────
// Both tests below drive the REAL CommentaryPanel with the REAL getCommentary over the REAL module. Delete
// the feature from the screen and they fail; that is the whole reason they exist (CLAUDE.md rule 1).

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

async function studyPanel(loc, label = '2 John 1') {
  const { eng } = await loadedNotes();
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = {
    Bible: { getCommentary: eng.getCommentary, parseRef: () => null },
    // the engine's real sanitiser needs a DOM; the panel's job here is to PUT the html on the screen, so
    // this stands in for it and the sanitiser is asserted separately (see the doesNotMatch above).
    sanitizeHtml: h => h,
    innerWidth: 360,
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
  const ctx = { notes: {}, setNote() {}, gotoRef() {} };
  // TWO DRAWS, because that is what a phone does. CommentaryPanel asks getCommentary inside a useEffect, so
  // the first paint is the empty state and the notes arrive on the next one. A single draw here would assert
  // about a screen no member ever sees settled on -- and it is what makes "the empty state is gone" below a
  // real claim rather than a timing accident.
  const props = { loc, label, open: true, onClose() {}, ctx, docked: true };
  draw(CommentaryPanel, props);
  const tree = draw(CommentaryPanel, props);
  return { tree, words: texts(tree).join(' | '), Bible: win.Bible };
}

test('POINT OF USE: a member opening Study on 2 John 1 reads the study notes', async () => {
  const { tree, words } = await studyPanel({ book: 63, chap: 1 });
  assert.match(words, /Aquifer Open Study Notes/, 'the panel does not name the source of the notes');
  // the notes themselves are set as innerHTML, not as text children, so read them off the props
  const bodies = find(tree, n => n.props && n.props.dangerouslySetInnerHTML).map(n => n.props.dangerouslySetInnerHTML.__html);
  assert.ok(bodies.length >= 5, `the panel rendered ${bodies.length} note bodies for 2 John 1`);
  assert.match(bodies.join(' '), /The elder<\/em>: The apostle John calls himself/,
    'the note on 2 John 1:1 is not on the screen');
  assert.match(words, /v1\b/, 'the panel does not label which verse a note belongs to');
  // and the empty state is gone — this is what proves the notes displaced it rather than sitting behind it
  assert.doesNotMatch(words, /Nothing here for/, 'the panel still shows its empty state while holding notes');
});

test('POINT OF USE: THE LICENCE NOTICE IS ON THE SCREEN, beside the words it licenses', async () => {
  const { words } = await studyPanel({ book: 63, chap: 1 });
  assert.match(words, /CC BY-SA 4\.0/, 'the Study panel shows the notes without naming their licence');
  assert.match(words, /Mission Mutual/, 'the Study panel does not credit Mission Mutual');
  assert.match(words, /Tyndale Open Study Notes/, 'the Study panel does not say what the notes are adapted from');
  // The notice must be with the notes, not somewhere else on the screen: it has to precede the first note
  // body a reader scrolls into.
  const heading = words.indexOf('Aquifer Open Study Notes');
  const notice = words.indexOf('CC BY-SA 4.0');
  assert.ok(notice > heading, 'the licence notice is not under the source heading');
});

test('POINT OF USE: a note carried over from another book SAYS WHICH NOTE IT IS', async () => {
  // Five associations across four articles point into a book other than the one they are filed under —
  // Aquifer's own cross-references, honoured rather than filtered (owner decision 11). All four also carry
  // their home-book association, so nothing is displaced. But a reader in Acts 18 would otherwise get a
  // note about Nazirite vows labelled "v18" and no clue why, so the converter puts the article's own title
  // above it. This asserts a member actually SEES that on the screen, not merely that the row holds it.
  const { tree, words } = await studyPanel({ book: 44, chap: 18 }, 'Acts 18');
  const bodies = find(tree, n => n.props && n.props.dangerouslySetInnerHTML).map(n => n.props.dangerouslySetInnerHTML.__html);
  const carried = bodies.filter(h => /From the note on/.test(h));
  assert.equal(carried.length, 1, `Acts 18 showed ${carried.length} carried-over notes; exactly one is filed there`);
  assert.match(carried[0], /From the note on <strong>Numbers 6:1\u201321<\/strong>/,
    'the carried-over note does not name the note it came from');
  assert.match(carried[0], /Nazirite/, 'the carried-over note is not the Nazirite-vow note');
  assert.ok(bodies.length > 1, 'Acts 18 shows only the carried-over note — its own notes are missing');
  assert.doesNotMatch(words, /Nothing here for/, 'the panel still shows its empty state while holding notes');
  // and a chapter with no carried-over note has no such lead-in
  const plain = await studyPanel({ book: 63, chap: 1 });
  const plainBodies = find(plain.tree, n => n.props && n.props.dangerouslySetInnerHTML).map(n => n.props.dangerouslySetInnerHTML.__html);
  assert.equal(plainBodies.filter(h => /From the note on/.test(h)).length, 0,
    '2 John 1 has no cross-book note, yet something there claims to be carried over');
});

test('a Details row with no licence column yields an EMPTY licence string, never undefined', async () => {
  // NOT a screen test — it never draws anything, and it passed unchanged under the `false &&` panel
  // sabotage. What it guards is the value the panel is handed: the three public-domain commentaries
  // already installed have no License column, and `{srcBlk.license ? ... : null}` must see '' and not
  // `undefined` so they never sprout an empty line. Built here with the same sql.js the app uses.
  const eng = engineChain();
  const SQL = await require(ROOT + 'vendor/sqljs/sql-wasm.js')({ locateFile: f => ROOT + 'vendor/sqljs/' + f });
  const raw = new SQL.Database();
  raw.run('CREATE TABLE Details (Title TEXT, Abbreviation TEXT, Description TEXT);'
    + 'CREATE TABLE Commentary (Book INT, Chapter INT, FromVerse INT, ToVerse INT, Data TEXT);'
    + "INSERT INTO Details VALUES ('Old Commentary', 'OLD', 'Old Commentary');"
    + "INSERT INTO Commentary VALUES (63, 1, 1, 1, '<p>An out-of-copyright note.</p>');");
  const db = await eng.openDb(raw.export());
  const cmt = eng.buildCommentaryFromDb(db, 'old.cmt.mybible');
  assert.equal(cmt.license, '', `a Details row with no License produced ${JSON.stringify(cmt.license)}`);
  eng.addCommentary(cmt);
  const blocks = eng.getCommentary(63, 1);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].license, '', 'getCommentary invented a licence for a module that carries none');
});
