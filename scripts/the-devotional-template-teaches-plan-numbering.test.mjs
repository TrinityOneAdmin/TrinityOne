// THE DEVOTIONAL CONTRIBUTOR TEMPLATE TEACHES PLAN / NUMBERING / BULK-UPLOAD, NOT "SERIES, ONE WEEK AT A TIME".
// Run: node --test scripts/the-devotional-template-teaches-plan-numbering.test.mjs
//
// WHAT THIS IS FOR. The console's "Devotional template" doc (Resources › Devotionals) is the only place a
// contributor is told how to number weeks/days and how a file maps to a plan. The owner's model is: one file
// is one plan; number weeks and days straight through the file; put the series name in the week theme when
// several are joined. The doc has to SAY that — and it used to say the opposite ("[Series Name]", "post one
// week at a time").
//
// WHY IT ASSERTS THE WAY IT DOES (CLAUDE.md §3). app/stew-templates.jsx ships UNBUNDLED, so a `false && `
// in front of any condition would leave every word of the source in place and a plain text-match on the file
// would still pass. So this test does NOT read the .jsx as text: it compiles the real file with the same
// esbuild sync-web.sh uses, RUNS it, and asserts on the HTML the doc generator actually PRODUCES and on the
// template string the "Copy template block" button actually hands out. Delete the sections from the doc and
// these go red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Compile the WHOLE file (it is self-contained bar the final `window.TrinityTemplates = {…}`), run it with a
// fake window, and hand back the compiled doc generator + the template const it closes over. Nothing is
// stubbed: devoDocHtml() runs its real devoTplHtml()/TMPL_ESC/HALO_SVG.
function loadTemplates() {
  const js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
    [join(ROOT, 'app/stew-templates.jsx'), '--jsx=transform', '--log-level=error'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const win = {};
  return new Function('window',
    js + '\nreturn { devoDocHtml, DEVO_TPL, TrinityTemplates: window.TrinityTemplates };')(win);
}

test('the fill-in block says Plan Name, never Series Name', () => {
  const { DEVO_TPL } = loadTemplates();
  assert.match(DEVO_TPL, /Title: \[Plan Name\] — Week \[N\]: \[Week Theme\]/,
    'the Title sample line was not updated to [Plan Name]');
  assert.match(DEVO_TPL, /# \[Plan Name\] — Week \[N\]: \[Week Theme\]/,
    'the H1 sample line still carries the old [Series Name] wording');
  assert.doesNotMatch(DEVO_TPL, /\[Series Name\]/,
    'the template still calls it a Series, not a Plan');
});

test('the doc teaches numbering, title and bulk upload, one file = one plan', () => {
  const { devoDocHtml } = loadTemplates();
  const html = devoDocHtml();

  // the three new sections exist as real headings (fails if any section is deleted from the doc)
  assert.match(html, /<h2>Numbering<\/h2>/, 'the Numbering section is missing');
  assert.match(html, /<h2>Title<\/h2>/, 'the Title section is missing');
  assert.match(html, /<h2>Bulk upload<\/h2>/, 'the Bulk upload section is missing');

  // Numbering — the owner's rules, verbatim
  assert.match(html, /Number weeks 1, 2, 3 straight through the file\. Never restart inside one file\./);
  assert.match(html, /Number days straight through the file too \(Day 7, then Day 8 in Week 2\)\. Weeks can have fewer than 7 days; keep counting\./);
  assert.match(html, /Joining several series into one file\? Keep numbers running and put the series name in the week theme\./);

  // Title — the format a contributor must follow, and why
  assert.match(html, /\[Plan Name\] — Week \[N\]: \[Week Theme\]/);
  assert.match(html, /The app list shows only "Week N · Theme", so make the theme clear on its own\./);

  // Bulk upload — one file is one plan, named to sort, numbering restarts per file
  assert.match(html, /One file is one plan\. Name files so they sort in order \(01-\.\.\., 02-\.\.\.\)\./);
  assert.match(html, /In Resources › Devotionals, choose Bulk upload and select all files\./);
  assert.match(html, /Check the preview, then confirm\. Each file becomes its own plan\./);
  assert.match(html, /Numbering restarts in each file\./);
  assert.match(html, /Every week must sit between the/);
  assert.match(html, /COPY FROM HERE \/ COPY TO HERE/);

  // the contributor must see [Plan Name] (not [Series Name]) in the embedded fill-in block too
  assert.match(html, /\[Plan Name\]/, 'the embedded fill-in block no longer shows [Plan Name]');
  assert.doesNotMatch(html, /\[Series Name\]/, 'the doc still shows the old [Series Name] wording');
});

test('the intro no longer tells contributors to post one week at a time', () => {
  const { devoDocHtml } = loadTemplates();
  const html = devoDocHtml();
  assert.doesNotMatch(html, /post one week at a time/i,
    'the intro still frames it as posting a week at a time, not building one plan in one file');
  assert.match(html, /upload that file as a single plan/i,
    'the intro no longer states the one-file/one-plan reality');
});
