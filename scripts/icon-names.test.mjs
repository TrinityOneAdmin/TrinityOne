// Every <Icon name="…"> must exist. Icon renders `paths[name] || null`, so a typo is an EMPTY SVG — a blank
// gap beside the label, with no error anywhere. Found 6 live instances (`alert` ×5, `info` ×1) on 2026-07-26,
// and I had just written a 7th (`edit`, which is called `pen`) in the calendar work.
// Run: node --test scripts/icon-names.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../app/', import.meta.url);
const src = readFileSync(new URL('icons.jsx', dir), 'utf8');
const body = src.slice(src.indexOf('const paths = {'));
const known = new Set([...body.matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*):/gm)].map(m => m[1]));

test('icons.jsx defines a usable set', () => {
  assert.ok(known.size > 50, `only ${known.size} icons parsed — the extractor stopped matching, so this test is blind`);
  for (const n of ['x', 'pen', 'trash', 'alert', 'info']) assert.ok(known.has(n), `icon "${n}" is missing`);
});

test('every icon referenced anywhere in the app exists', () => {
  const missing = [];
  for (const f of readdirSync(dir).filter(x => x.endsWith('.jsx'))) {
    const s = readFileSync(new URL(f, dir), 'utf8');
    for (const m of s.matchAll(/<Icon\s+name="([a-zA-Z0-9]+)"/g)) if (!known.has(m[1])) missing.push(`${f}: name="${m[1]}"`);
  }
  assert.deepEqual([...new Set(missing)], [],
    'these render an empty SVG — a blank space where an icon should be, with no error');
});
