// Read a whole function/block out of a source file, instead of guessing how many characters it is.
//
// AUDIT-2026-07-28 F15. Structural tests here anchor on a string and then slice a FIXED NUMBER of characters
// forward. That window silently stops covering the code the moment the function grows past it: the assertions
// still run, still pass, and no longer read the thing they name. It is the bug class that bit five times in
// one session — "five of my tests used fixed-character windows and reported correct code as broken" — and the
// other way round is worse, because nothing goes red at all.
//
// Measured across the suite on 2026-07-29: 51 fixed-width windows, 10 of them already shorter than the
// construct they read. Two were mine, one by a single character.
//
// So: brace-match to the real end. Quote- and comment-aware, because a brace inside a string literal or a
// `// }` comment cuts the body in half and produces a syntax error that looks like a code fault (that has
// happened here too — see the note in name-key-integrity.test.mjs).
import assert from 'node:assert/strict';

// The complete construct that STARTS at `anchor` — from the anchor to the brace that closes its first block.
export function fnBody(src, anchor, what = anchor) {
  const at = typeof anchor === 'number' ? anchor : src.indexOf(anchor);
  assert.notEqual(at, -1, `${what} is missing — re-anchor this test rather than widening a window`);
  const open = src.indexOf('{', at);
  assert.notEqual(open, -1, `${what} has no block to read`);
  let depth = 0, q = '';
  for (let i = open; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); if (nl === -1) break; i = nl; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i); if (e === -1) break; i = e + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail(`could not find the end of ${what} — the source may be malformed`);
}

// Same, for a statement that ends at a top-level `;` rather than a block (e.g. `const X = ...;`).
export function stmt(src, anchor, what = anchor) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${what} is missing — re-anchor this test`);
  const open = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  let q = '';
  for (let i = at; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); if (nl === -1) break; i = nl; continue; }
    if (open[c]) stack.push(open[c]);
    else if (c === stack[stack.length - 1]) stack.pop();
    else if (c === ';' && !stack.length) return src.slice(at, i + 1);
  }
  assert.fail(`could not find the end of ${what}`);
}
