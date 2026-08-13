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
  // SKIP THE PARAMETER LIST BEFORE LOOKING FOR THE BODY. This took the first `{` after the anchor, which for
  // a signature carrying an object default — `publishMessage(groupId, content, extraTags = [], opts = {})` —
  // is the empty object in that default. It opens and closes immediately, so fnBody returned a 64-character
  // stub of the signature itself and nothing else.
  //
  // That fails loudly for `assert.match`, which is how it was found. It fails SILENTLY for
  // `assert.doesNotMatch`: the forbidden pattern is trivially absent from a stub, so the assertion passes
  // over any amount of the thing it exists to forbid. Every caller of this helper is a security or
  // correctness guard, so a helper that can hand one an empty function body is a hole under all of them.
  //
  // Walk the signature's parens first when there are any, then take the `{` after them.
  let open;
  const paren = src.indexOf('(', at);
  const nl = src.indexOf('\n', at);
  if (paren !== -1 && (nl === -1 || paren < nl)) {
    let d = 0, end = -1;
    for (let i = paren; i < src.length; i++) {
      if (src[i] === '(') d++;
      else if (src[i] === ')' && --d === 0) { end = i; break; }
    }
    assert.notEqual(end, -1, `${what} has an unterminated parameter list`);
    open = src.indexOf('{', end);
  } else {
    open = src.indexOf('{', at);
  }
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

// Remove comments, keeping the source's byte offsets stable so an ORDERING check (does A appear before B?)
// still means what it says.
//
// HANDOFF-2026-08-05 §4.3. This is not a tidiness helper — it closes a hole that let a shipped safeguarding
// bug be reintroduced with all 935 tests green. `child-parent-dm.test.mjs` asserted that the parent exemption
// appears BEFORE the minor refusal. A reviewer moved the exemption below the refusal, reinstating the bug,
// and the assertion still passed: the first `myGuardians` in the slice was at offset 858, inside the
// explanatory comment ABOVE the code, while `safeguard.isMinor` was at 1424. The comment was doing the
// assertion's job. The prose describing a rule satisfied the check that the rule was followed.
//
// Comments are replaced with spaces rather than deleted so every surviving offset is the offset in the
// original — otherwise fixing this test would silently move every other index-based assertion in the suite.
export function stripComments(src) {
  let out = '', q = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { out += c; if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if (c === '/' && src[i + 1] === '/') {
      let nl = src.indexOf('\n', i); if (nl === -1) nl = src.length;
      out += ' '.repeat(nl - i); i = nl - 1; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let e = src.indexOf('*/', i); if (e === -1) e = src.length - 2;
      // keep newlines so line numbers in any failure message still line up
      for (let j = i; j <= e + 1; j++) out += src[j] === '\n' ? '\n' : ' ';
      i = e + 1; continue;
    }
    out += c;
  }
  assert.equal(out.length, src.length, 'stripComments changed the length — offsets would no longer be comparable');
  return out;
}

// An ordering assertion that cannot be satisfied by prose. Both needles must appear in the CODE, and
// `first` must precede `second`. Use this instead of two indexOf calls on a raw slice.
export function assertOrder(src, first, second, message) {
  const code = stripComments(src);
  const a = code.indexOf(first), b = code.indexOf(second);
  assert.notEqual(a, -1, `${first} is not in the code (only, perhaps, in a comment) — ${message}`);
  assert.notEqual(b, -1, `${second} is not in the code (only, perhaps, in a comment) — ${message}`);
  assert.ok(a < b, `${first} must come before ${second} (found at ${a} and ${b}) — ${message}`);
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
