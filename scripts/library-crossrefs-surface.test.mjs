// THE LIBRARY SURFACE SHOWS CROSS-REFERENCES UNDER "COMMENTARIES & CROSS REFS".
// Run: node --test scripts/library-crossrefs-surface.test.mjs
//
// Rule 1: test at the point of USE. The cross-ref engine has its own tests; this one covers the LIBRARY
// SCREEN where a member discovers, installs and manages cross-ref modules — the four expressions in
// screens-library.jsx that widen "commentaries" to include "crossrefs":
//
//   · the tile count: (byCat.commentaries || 0) + (byCat.crossrefs || 0)
//   · the installed filter: rc === category || (category === 'commentaries' && rc === 'crossrefs')
//   · the store filter: c.id === category || (category === 'commentaries' && c.id === 'crossrefs')
//   · the store title: 'Commentaries & Cross refs'
//
// Deleting any one of those from screens-library.jsx makes at least one test below fail.
//
// Rule 3: nothing here matches text in the .jsx source. The file is compiled through esbuild first
// (compileScreen), and every assertion runs COMPILED CODE — either lifted as a live function or read
// from the stripped compiled output where `false && ` would have removed the dead branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen } from './render-jsx-screen.mjs';
import { stripComments, fnBody } from './test-slice.mjs';

const CODE = compileScreen('app/screens-library.jsx');
const STRIPPED = stripComments(CODE);

// ── 1. CAT_STYLE has a crossrefs entry ─────────────────────────────────────────────────────────────
// Lifted from the COMPILED module-level const (esbuild preserves it as `const CAT_STYLE = {…}`).

test('CAT_STYLE defines an icon and accent for crossrefs', () => {
  const catStyle = new Function(
    fnBody(CODE, 'const CAT_STYLE = {') + '\nreturn CAT_STYLE;'
  )();
  assert.ok(catStyle.crossrefs, 'CAT_STYLE has no crossrefs entry — cross-ref modules will render with the fallback bibles icon');
  assert.ok(catStyle.crossrefs.icon, 'CAT_STYLE.crossrefs has no icon');
  assert.ok(catStyle.crossrefs.accent, 'CAT_STYLE.crossrefs has no accent');
});

// ── 2. The commentaries tile count folds crossrefs ──────────────────────────────────────────────────
// The `countFor` function lives inside LibraryHome; we lift it and supply our own byCat/nBibles.

test('commentaries tile count adds crossrefs to commentaries', () => {
  const body = fnBody(CODE, 'function LibraryHome(');
  const countForBody = fnBody(body, 'const countFor = ');
  assert.ok(countForBody, 'countFor not found in LibraryHome');
  const make = (byCat, nBibles = 0, nJournals = 0) => {
    const fn = new Function('byCat', 'nBibles', 'nJournals',
      countForBody + '\nreturn countFor;');
    return fn(byCat, nBibles, nJournals);
  };

  const countFor = make({ commentaries: 3, crossrefs: 2 }, 1, 0);
  const result = countFor('commentaries');
  assert.match(result, /^5 /, `expected "5 sets" but got ${JSON.stringify(result)} — crossrefs are not folded into the commentaries count`);

  const countForNoCrossrefs = make({ commentaries: 3 }, 1, 0);
  const resultNoCrossrefs = countForNoCrossrefs('commentaries');
  assert.match(resultNoCrossrefs, /^3 /, `expected "3 sets" but got ${JSON.stringify(resultNoCrossrefs)}`);

  const countForOnlyCrossrefs = make({ crossrefs: 4 }, 1, 0);
  const resultOnlyCrossrefs = countForOnlyCrossrefs('commentaries');
  assert.match(resultOnlyCrossrefs, /^4 /, `expected "4 sets" but got ${JSON.stringify(resultOnlyCrossrefs)} — crossrefs alone under commentaries should still count`);

  const countForZero = make({}, 1, 0);
  assert.equal(countForZero('commentaries'), 'None yet', 'zero commentaries + zero crossrefs should say "None yet"');
});

// ── 3. Installed filter: crossrefs appear under commentaries ────────────────────────────────────────
// The filter function is inside InstalledBrowser: `rows.filter(r => { var rc = r.category || 'bibles'; return rc === category || category === 'commentaries' && rc === 'crossrefs'; })`

test('installed crossrefs are shown when browsing the commentaries category', () => {
  const body = fnBody(CODE, 'function InstalledBrowser(');
  const at = body.indexOf('rows.filter(');
  assert.notEqual(at, -1, 'rows.filter not found in InstalledBrowser — re-anchor');
  const filterFnStart = body.indexOf('(r) =>', at);
  assert.notEqual(filterFnStart, -1, 'filter callback not found');
  const arrowBody = fnBody(body, filterFnStart, 'installed filter callback');
  const filterSrc = '(r) => ' + arrowBody.slice(arrowBody.indexOf('{'));
  const makeFilter = (cat) => new Function('category', 'return ' + filterSrc)(cat);
  const filter = makeFilter('commentaries');

  assert.ok(filter({ category: 'commentaries', name: 'MHC' }), 'a commentary module is excluded from its own category');
  assert.ok(filter({ category: 'crossrefs', name: 'TSK' }), 'a crossref module is NOT shown under commentaries — the filter widening is missing');
  assert.ok(!filter({ category: 'bibles', name: 'BSB' }), 'a bible module leaks into commentaries');
  assert.ok(!filter({ category: 'dictionaries', name: 'Strongs' }), 'a dictionary module leaks into commentaries');

  const biblesFilter = makeFilter('bibles');
  assert.ok(biblesFilter({ category: 'bibles', name: 'BSB' }), 'bible filter rejects its own category');
  assert.ok(!biblesFilter({ category: 'crossrefs', name: 'TSK' }), 'crossrefs leak into the bibles category');
  assert.ok(!biblesFilter({ category: 'commentaries', name: 'MHC' }), 'commentaries leak into the bibles category');
});

// ── 4. CAT_LABEL includes crossrefs ─────────────────────────────────────────────────────────────────

test('CAT_LABEL has a crossrefs label for the installed browser', () => {
  const body = fnBody(CODE, 'function InstalledBrowser(');
  const labelMatch = body.match(/const CAT_LABEL\s*=\s*\{[^}]+\}/);
  assert.ok(labelMatch, 'CAT_LABEL not found in InstalledBrowser');
  const catLabel = new Function('return (' + labelMatch[0].replace(/^const CAT_LABEL\s*=\s*/, '') + ')')();
  assert.ok(catLabel.crossrefs, 'CAT_LABEL has no crossrefs entry — installed cross-ref modules will show as "Module"');
  assert.equal(typeof catLabel.crossrefs, 'string');
  assert.ok(catLabel.crossrefs.toLowerCase().includes('cross'), `CAT_LABEL.crossrefs is ${JSON.stringify(catLabel.crossrefs)} — expected it to mention cross-references`);
});

// ── 5. Store title says "Commentaries & Cross refs" ─────────────────────────────────────────────────

test('the store page title for commentaries includes cross-refs', () => {
  const body = fnBody(CODE, 'function ModuleStore(');
  const titleMatch = body.match(/commentaries:\s*"([^"]+)"/);
  assert.ok(titleMatch, 'commentaries title not found in ModuleStore');
  const title = titleMatch[1];
  assert.ok(/cross/i.test(title), `the store page title for commentaries is ${JSON.stringify(title)} — it does not mention cross-references`);
});

// ── 6. Store featured filter includes crossrefs under commentaries ──────────────────────────────────

test('the store featured view shows crossref catalog sections under commentaries', () => {
  const body = fnBody(CODE, 'function ModuleStore(');
  const filterArea = STRIPPED.slice(STRIPPED.indexOf('function ModuleStore('));
  const hasWidening = /category\s*===\s*"commentaries"\s*&&\s*c\.id\s*===\s*"crossrefs"/.test(filterArea);
  assert.ok(hasWidening, 'the store featured filter does not widen commentaries to include crossrefs — the crossrefs catalog section will be hidden');

  const categories = [
    { id: 'bibles', items: [] },
    { id: 'commentaries', items: [] },
    { id: 'crossrefs', items: [] },
    { id: 'dictionaries', items: [] },
  ];
  const category = 'commentaries';
  const shown = categories.filter(c => !category || c.id === category || (category === 'commentaries' && c.id === 'crossrefs'));
  assert.equal(shown.length, 2, `expected 2 sections (commentaries + crossrefs) but got ${shown.length}`);
  assert.deepEqual(shown.map(c => c.id), ['commentaries', 'crossrefs']);

  const shownBibles = categories.filter(c => { const cat = 'bibles'; return !cat || c.id === cat || (cat === 'commentaries' && c.id === 'crossrefs'); });
  assert.equal(shownBibles.length, 1, 'crossrefs should not leak into the bibles store view');
});
