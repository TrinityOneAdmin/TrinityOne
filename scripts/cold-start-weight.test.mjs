// What a member downloads before they can read anything. Run: node --test scripts/cold-start-weight.test.mjs
//
// AUDIT-2026-07-31 P7. The product's stated test is "does this work over a thin pipe in Tehran", so the size
// of a first install is a feature, not an optimisation. Measured on the SHIPPED shell (www/index.html, not the
// repo-root dev shell — that one still references a 3 MB Babel that members never receive):
//
//     2,436,172 bytes across 43 files, uncompressed
//
// This file guards the one thing that was pure waste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SW = readFileSync(ROOT + 'sw.js', 'utf8');

test('the 655 KB SQLite wasm is NOT downloaded during install', () => {
  // It was in the service worker's precache list — the largest single thing the app would ever fetch, taken
  // on every first install. At 20 kB/s that is ~33 seconds before a word of Scripture or a single message.
  //
  // It is used only by engine.js's openDb(), for Bible modules that happen to be in SQLite format. Most
  // members never open one, and nobody needs it to read their church's chat.
  const EXTRA = SW.slice(SW.indexOf('const EXTRA = ['), SW.indexOf('];', SW.indexOf('const EXTRA = [')));
  assert.doesNotMatch(EXTRA, /sql-wasm\.wasm/,
    'sql-wasm.wasm is precached again. It is the single largest download in the product, taken by every ' +
    'member on install, for a file most of them will never need.');
});

test('…and it is still reachable when it IS needed', () => {
  // Dropping it from the precache is only safe because the fetch handler caches successful responses at
  // runtime. Without that, opening a SQLite Bible would re-download 655 KB every single time.
  assert.match(SW, /caches\.open\(CACHE\)/,
    'the service worker no longer caches runtime responses, so the wasm would be re-fetched on every use — ' +
    'which is worse than precaching it.');
  assert.ok(existsSync(ROOT + 'vendor/sqljs/sql-wasm.wasm'), 'the wasm is gone entirely — SQLite Bibles would break');
});

test('the shipped shell does not carry the dev-only Babel', () => {
  // The repo-root index.html references a 3 MB runtime Babel. The audit checked this and found production
  // clean; asserted here so a build change cannot quietly start shipping it to members on 2G.
  if (!existsSync(ROOT + 'www/index.html')) return;   // www/ is a build artefact; skip if not built
  const shipped = readFileSync(ROOT + 'www/index.html', 'utf8');
  // A TAG, not the word: www/index.html carries a stale comment mentioning Babel, and matching prose instead
  // of markup is how a guard reports a problem that is not there.
  assert.doesNotMatch(shipped, /<script[^>]+babel/i,
    'the shipped shell now loads a runtime Babel transpiler. That is 3 MB of compiler a member downloads ' +
    'before reading anything, to do work the build already did.');
});

test('the first-paint payload has not quietly grown', () => {
  // Not a fixed budget — a ratchet. It exists so that adding a megabyte is a decision someone makes on
  // purpose, with this number in front of them, rather than something that happens over six commits.
  if (!existsSync(ROOT + 'www/index.html')) return;
  const shipped = readFileSync(ROOT + 'www/index.html', 'utf8');
  let total = 0, files = 0;
  for (const m of shipped.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    const p = ROOT + 'www/' + m[1];
    if (existsSync(p)) { total += statSync(p).size; files++; }
  }
  assert.ok(files > 10, 'only ' + files + ' shell files found — this test is measuring nothing, re-anchor it');
  const MB = 3.0;
  assert.ok(total <= MB * 1024 * 1024,
    'the first-paint shell is now ' + (total / 1048576).toFixed(2) + ' MB across ' + files + ' files, over the ' +
    MB + ' MB ratchet. At the 20 kB/s this product is built for, every extra megabyte is another ~50 seconds ' +
    'before a member sees anything. If the growth is deliberate, raise the number in the same commit and say why.');
});
