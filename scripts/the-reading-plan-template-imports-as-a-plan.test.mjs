// THE READING-PLAN CONTRIBUTOR TEMPLATE PRODUCES A FILE THAT ACTUALLY IMPORTS AS A READING PLAN.
// Run: node --test scripts/the-reading-plan-template-imports-as-a-plan.test.mjs
//
// WHAT THIS IS FOR. The reading-plan upload UI (Resources › Reading plans › New plan › Upload file) now has a
// "Template" button that opens a contributor doc with a copyable fill-in block (READPLAN_TPL / readPlanDocHtml
// in app/stew-templates.jsx). A template is worthless if a file built from it does not import — so this test
// does not just check the doc's wording, it FILLS the template in and runs the REAL console parser
// (parsePlanFile in app/stew-dashboard.jsx) over it, proving the format the doc teaches is the format the
// console accepts.
//
// WHY IT ASSERTS THE WAY IT DOES (CLAUDE.md §3). app/*.jsx ships UNBUNDLED, so a `false && ` in front of any
// condition leaves every word of the source in place and a plain text-match on the file would still pass. So
// nothing here reads a .jsx as text: both the template module and the parser are compiled with the same
// esbuild sync-web.sh uses and RUN. Delete the sections or break the format and these go red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Compile the WHOLE template file (self-contained bar the final `window.TrinityTemplates = {…}`), run it with
// a fake window, and hand back the template string + the doc generator. Nothing stubbed.
function loadTemplates() {
  const js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
    [join(ROOT, 'app/stew-templates.jsx'), '--jsx=transform', '--log-level=error'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const win = {};
  return new Function('window',
    js + '\nreturn { READPLAN_TPL, readPlanDocHtml, TrinityTemplates: window.TrinityTemplates };')(win);
}

// Lift the REAL reading-plan parser out of app/stew-dashboard.jsx and compile it with esbuild. parsePlanFile
// has no external deps (regex + string ops only), so it runs standalone. We slice between its own anchor and
// the sibling `const handleFile` that follows it — fnBody's brace walk mis-counts the `{` / quote characters
// inside parsePlanFile's regex literals (e.g. /of\s+"([^"]+)"/), so a two-anchor slice is the honest cut here.
function loadParsePlanFile() {
  const src = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
  const start = src.indexOf('const parsePlanFile = (fname, raw) =>');
  const end = src.indexOf('const handleFile = (f) =>', start);
  assert.ok(start !== -1 && end > start, 'could not locate parsePlanFile — re-anchor this test');
  const body = src.slice(start, end).trim();
  const tmp = join(tmpdir(), 'readplan-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, body);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } finally { rmSync(tmp, { force: true }); }
  return new Function(js + '\nreturn parsePlanFile;')();
}

// Turn the template's bracket placeholders into the concrete values a steward would type, so the result is a
// file genuinely produced FROM the template — then import it.
function fillTemplate(tpl) {
  return tpl
    .replace('[Plan Name]', 'Advent — Light Has Come')
    .replace('*[Optional one-line description — shows on the plan card. Delete if not needed.]*', '*Four days through Advent.*')
    .replace('Day 1 — [Short title for the day]', 'Day 1 — The Word made flesh')
    .replace('**Read: [Reference, e.g. John 1:1-18]**', '**Read: John 1:1-18**')
    .replace('Day 2 — [Short title for the day]', 'Day 2 — A light in the darkness')
    .replace('**Read: [Reference, e.g. Psalm 23]**', '**Read: Isaiah 9:2-7**');
}

test('a file filled in from the template imports as a reading plan with the right days', () => {
  const { READPLAN_TPL } = loadTemplates();
  const parsePlanFile = loadParsePlanFile();

  const filled = fillTemplate(READPLAN_TPL);
  // the ( …repeat… ) guidance line is the only placeholder we leave — a steward deletes it; the parser ignores it
  const res = parsePlanFile('advent.md', filled);

  assert.equal(res.title, 'Advent — Light Has Come', 'the # heading was not read as the plan name');
  assert.equal(res.days.length, 2, 'the two Day blocks did not both import');
  assert.equal(res.days[0].ref, 'John 1:1-18', 'day 1 lost its reading (the **Read:** line was not read)');
  assert.equal(res.days[1].ref, 'Isaiah 9:2-7', 'day 2 lost its reading');
  assert.equal(res.days[0].d, 1);
  assert.equal(res.days[1].d, 2);
  assert.match(res.days[0].label, /The Word made flesh/, 'day 1 lost its title');
  assert.equal(res.blurb, 'Four days through Advent.', 'the *italic* description did not become the blurb');
});

test('the simple one-reference-per-line shape the doc documents also imports', () => {
  const parsePlanFile = loadParsePlanFile();
  // this is exactly the "Simple list" block shown in readPlanDocHtml()
  const res = parsePlanFile('lent.txt', 'John 1:1-18\nPsalm 23\nIsaiah 53\nLuke 15:11-32\n');
  assert.equal(res.days.length, 4, 'a bare list of four references did not become four days');
  assert.equal(res.days[0].ref, 'John 1:1-18');
  assert.equal(res.days[3].ref, 'Luke 15:11-32');
  assert.equal(res.days[3].d, 4, 'the days were not numbered straight through');
});

test('the contributor doc teaches the reading-plan format', () => {
  const { readPlanDocHtml } = loadTemplates();
  const html = readPlanDocHtml();

  assert.match(html, /Reading plan — contributor template/, 'the doc has no title');
  assert.match(html, /<h2>How it works<\/h2>/);
  assert.match(html, /<h2>Two ways to write a plan<\/h2>/);
  assert.match(html, /<h2>House style<\/h2>/);
  assert.match(html, /<h2>Before you share<\/h2>/);

  // it must show BOTH accepted shapes
  assert.match(html, /### Day N — Title/, 'the full Day/Read format is not described');
  assert.match(html, /\*\*Read: Reference\*\*/, 'the **Read:** convention is not described');
  assert.match(html, /one Bible reference per line/i, 'the simple one-ref-per-line shape is not described');

  // the embedded fill-in block (the copyable one) must carry the real format the parser reads
  assert.match(html, /# \[Plan Name\]/, 'the fill-in block has no plan-name heading');
  assert.match(html, /Day 1 — \[Short title for the day\]/, 'the fill-in block has no Day block');
  assert.match(html, /\*\*Read:/, 'the fill-in block does not bold the reading');
  // one file = one plan is the headline rule
  assert.match(html, /One file = one plan\./);
});

test('the Copy button and the exposed template stay in step', () => {
  const { READPLAN_TPL, readPlanDocHtml, TrinityTemplates } = loadTemplates();
  // the doc's copy button hands out window.__READPLAN_TPL__, and tmplOpen injects READPLAN_TPL into it
  assert.match(readPlanDocHtml(), /window\.__READPLAN_TPL__/, 'the copy button reads the wrong variable');
  assert.equal(TrinityTemplates.READPLAN_TPL, READPLAN_TPL, 'the exposed template is not the one the doc renders');
  assert.equal(typeof TrinityTemplates.openReadPlanTemplate, 'function', 'there is no way to open the reading-plan template');
});
