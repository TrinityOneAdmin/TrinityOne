// FILES NOTHING REFERENCES ARE NOT SHIPPED.
// Run: node --test scripts/nothing-dead-is-served.test.mjs
//
// AUDIT 2026-09-02 #26 (the inert subset only). `image-slot.js` was a 31 KB web component from another
// project, sitting in the repo root and therefore SERVED by the gateway to anyone who asked; `.ob4.mjs` was
// a stray CDP probe. Neither was referenced by any HTML, screen, script or the service worker.
//
// What is deliberately NOT deleted, and why, is in the batch 19 commit body: parked features and engine
// methods with no UI are the owner's call, not a tidy-up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const root = (f) => new URL('../' + f, import.meta.url);

test('the dead files are gone', () => {
  for (const f of ['image-slot.js', '.ob4.mjs']) {
    assert.equal(existsSync(root(f)), false,
      `${f} is back. It is referenced by nothing and the gateway serves the repo root, so it ships to every ` +
      `church for no reason`);
  }
});

test('and nothing references them, so their removal breaks nothing', () => {
  const dirs = ['app', 'scripts', 'src'];
  const hits = [];
  const scan = (dir) => {
    for (const f of readdirSync(root(dir), { withFileTypes: true })) {
      if (f.isDirectory()) continue;
      if (!/\.(js|jsx|mjs|sh|html)$/.test(f.name)) continue;
      if (f.name === 'nothing-dead-is-served.test.mjs') continue;   // this file names them to assert on them
      const src = readFileSync(new URL('../' + dir + '/' + f.name, import.meta.url), 'utf8');
      if (/image-slot|\.ob4\.mjs/.test(src)) hits.push(dir + '/' + f.name);
    }
  };
  dirs.forEach(scan);
  for (const f of readdirSync(root('.'), { withFileTypes: true })) {
    if (f.isDirectory() || !/\.html$/.test(f.name)) continue;
    const src = readFileSync(root(f.name), 'utf8');
    if (/image-slot|\.ob4\.mjs/.test(src)) hits.push(f.name);
  }
  assert.deepEqual(hits, [],
    'something now references a file this test deleted: ' + hits.join(', '));
});
