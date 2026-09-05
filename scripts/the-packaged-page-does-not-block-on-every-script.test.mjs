// THE PACKAGED PAGE MUST NOT BLOCK THE PARSER ~44 TIMES BEFORE IT PAINTS.
// Run: node --test scripts/the-packaged-page-does-not-block-on-every-script.test.mjs
//
// Finding 5 of the 2026-09-05 re-verification audit, measured: the packaged member page loads 44 classic
// scripts, 2.67 MB raw / 663 KB gzipped, and not one of them was deferred. Each blocks the parser, so the
// cost on a high-latency link is ~44 sequential round trips before anything is drawn — which lands hardest
// on exactly the deployment this product is built for (DOMAIN.md: "does this work over a thin pipe").
//
// `defer` is the whole fix. It preserves execution ORDER, which matters here because every app/*.jsx is a
// classic script that hangs its components on `window` and app.jsx reads them at render — the reason
// code-splitting was explicitly NOT attempted (it has blanked the APK before).
//
// The authority is scripts/sync-web.sh, which is in git; www/ is not. Both are checked when www/ exists.
// app-boots.test.mjs is the other half of this guard: it loads the real packaged page in a real browser, so
// if deferring ever breaks the boot order that test goes red rather than this one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SYNC = readFileSync(new URL('../scripts/sync-web.sh', import.meta.url), 'utf8');

test('the packaged build rewrites every script tag as deferred', () => {
  assert.match(SYNC, /<script defer src="\\1\.js">/,
    'sync-web.sh stopped deferring the transpiled app scripts — the packaged page blocks on each of them');
  assert.match(SYNC, /s#<script src="#<script defer src="#g/,
    'sync-web.sh stopped deferring the vendor scripts');
});

test('the built page has no undeferred script left', { skip: !existsSync(fileURLToPath(new URL('../www/index.html', import.meta.url))) && 'www/ not built — run bash scripts/sync-web.sh' }, () => {
  const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
  const tags = [...html.matchAll(/<script[^>]*src=[^>]*>/g)].map(m => m[0]);
  assert.ok(tags.length >= 20, `only ${tags.length} script tags found — the packaged page has changed shape, re-anchor`);
  const blocking = tags.filter(t => !/\sdefer\b/.test(t) && !/\sasync\b/.test(t));
  assert.deepEqual(blocking, [],
    `${blocking.length} script tags still block the parser: ${blocking.join(' ')}`);
});

test('deferring did not silently drop a script', () => {
  // The sed that adds `defer` runs over the same file as the sed that rewrites .jsx paths. A greedy or
  // mis-ordered pattern that ate a tag would show up here rather than as a blank screen on a phone.
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const srcCount = (src.match(/<script[^>]*src=/g) || []).length;
  if (!existsSync(fileURLToPath(new URL('../www/index.html', import.meta.url)))) return;
  const built = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
  const builtCount = (built.match(/<script[^>]*src=/g) || []).length;
  // The packaged page drops exactly one: vendor/babel.min.js, which it does not need.
  assert.equal(builtCount, srcCount - 1,
    `source has ${srcCount} script tags and the packaged page has ${builtCount}; expected exactly one fewer ` +
    '(the Babel runtime). A different number means the rewrite dropped or duplicated a tag.');
});
