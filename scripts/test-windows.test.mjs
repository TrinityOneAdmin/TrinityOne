// No structural test may read a window shorter than the code it claims to read.
// Run: node --test scripts/test-windows.test.mjs
//
// AUDIT-2026-07-28 F15. Many tests here anchor on a string and slice a FIXED NUMBER of characters forward.
// The window silently stops covering the code the moment the function grows past it — the assertions still
// run, still pass, and no longer read the thing they name. HANDOFF records the same class biting five times
// in a single session, reporting correct code as broken; the other direction is worse, because nothing goes
// red at all and a real defect sits inside the part that fell off the end.
//
// Measured when this file was written: 51 fixed-width windows across the suite, 10 already shorter than the
// construct they read — including two written the same day, one short by a single character.
//
// This is the guard, not a one-off cleanup: it re-derives the real length of every anchored construct and
// fails if a window no longer reaches the end of it. Widening the number makes it pass today and rot again;
// scripts/test-slice.mjs `fnBody()` reads to the actual closing brace and cannot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPTS = new URL('.', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;
const cache = new Map();
const readSrc = (p) => {
  if (!cache.has(p)) { try { cache.set(p, readFileSync(join(ROOT, p), 'utf8')); } catch { cache.set(p, null); } }
  return cache.get(p);
};

// The construct that starts at `at`, measured to its closing brace. Quote- and comment-aware: a naive brace
// count stops at the first `}` inside a string literal or a comment, under-reports the length, and therefore
// MISSES short windows — a guard with a silent blind spot, which is the thing this file exists to prevent.
// My first version was naive and its own self-test below caught it.
function constructLength(src, at) {
  const open = src.indexOf('{', at);
  if (open === -1) return null;
  let depth = 0, q = '';
  for (let i = open; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); if (nl === -1) break; i = nl; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i); if (e === -1) break; i = e + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return (i + 1) - at;
  }
  return null;
}

test('every fixed-width window still reaches the end of what it reads', () => {
  const bad = [];
  for (const f of readdirSync(SCRIPTS).filter(x => x.endsWith('.test.mjs'))) {
    const t = readFileSync(join(SCRIPTS, f), 'utf8');
    // the source files this test file reads
    const targets = [...t.matchAll(/readFileSync\(new URL\('\.\.\/([^']+)'|readFileSync\(ROOT \+ '([^']+)'/g)]
      .map(m => m[1] || m[2]).filter(Boolean);
    if (!targets.length) continue;
    // `const X = SRC.indexOf('ANCHOR') … .slice(X, X + N)`
    for (const m of t.matchAll(/(\w+)\s*=\s*(\w+)\.indexOf\(([`'"])([^`'"]+)\3\)[\s\S]{0,400}?\.slice\(\1,\s*\1\s*\+\s*(\d+)\)/g)) {
      const anchor = m[4], width = Number(m[5]);
      for (const tgt of targets) {
        const src = readSrc(tgt);
        if (!src) continue;
        const at = src.indexOf(anchor);
        if (at === -1) continue;
        const need = constructLength(src, at);
        if (need && width < need) {
          bad.push(`${f}: window of ${width} over "${anchor.slice(0, 46)}" in ${tgt}, which is ${need} chars — ${need - width} short`);
        }
        break;
      }
    }
  }
  assert.deepEqual(bad, [],
    'these windows no longer cover the code they name, so their assertions read a truncated slice:\n    ' +
    bad.join('\n    ') + '\n  Use fnBody() from scripts/test-slice.mjs rather than a bigger number');
});

test('the checker actually bites', () => {
  // A guard that cannot fail is the thing this file exists to prevent. Prove the length maths on a construct
  // whose real size is known, rather than trusting the sweep above to have found anything.
  const src = 'function demo() {\n  const a = "}";   // a brace in a string and in a comment: }\n  return a;\n}\nafter';
  const need = constructLength(src, 0);
  assert.equal(need, src.indexOf('\nafter'), 'the length maths is wrong, so the sweep proves nothing');
  assert.ok(need > 40, 'sanity');
});
