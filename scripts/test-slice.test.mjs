// The measuring instrument gets its own test. Every structural test in this suite reads code through
// fnBody(); a defect HERE is a defect under all of them, and the failure mode is the quiet kind — a slice
// that is wider than the construct it names still satisfies `assert.doesNotMatch` over any amount of the
// thing it exists to forbid.
//
// AUDIT-2026-08-10 item E, verified by execution before fixing: anchored on `addEventListener('install'` in
// the real sw.js, the paren walk balanced the CALL's parens to the call's final `)`, and `indexOf('{', end)`
// then landed on the NEXT construct's block — the returned "install body" contained the entire 'activate'
// handler. Benign that day only by luck. Same class as F15's fixed-width windows: nothing goes red at all.
// Run: node --test scripts/test-slice.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fnBody } from './test-slice.mjs';

test('a call-shaped anchor fails loudly instead of silently widening into the next construct', () => {
  // Before the fix this returned a slice containing b() — a neighbouring function the anchor never named.
  const src = "X(() => { a(); });\nY(() => { b(); });\n";
  assert.throws(() => fnBody(src, 'X((', 'X call'),
    /call, not a definition/,
    'a call anchor must be refused, not guessed at — re-anchor the caller to the function itself');
});

test('a paren inside a string default no longer corrupts the walk', () => {
  // The corrupt count ends the parameter list at the paren INSIDE the string; with the call-shape check in
  // place, an unquoted walk would then refuse this perfectly good definition. The quote-aware walk is what
  // keeps real signatures sliceable.
  const src = "function f(sep = ')') { body(); }\nfunction g() { other(); }\n";
  const body = fnBody(src, 'function f(', 'f');
  assert.match(body, /body\(\)/, 'the definition must still slice to its own body');
  assert.doesNotMatch(body, /other\(\)/, 'and must not swallow the neighbour');
});

test('an arrow property still slices — the => between parens and brace is a definition, not a call', () => {
  // Live anchor shape: `canDMPeer: (peer) => {` in child-parent-dm.test.mjs. Regression pin: this must stay
  // green before AND after the call-shape check.
  const src = "obj = { m: (x) => { c(); }, n: (y) => { d(); } }";
  const body = fnBody(src, 'm: (x)', 'm');
  assert.match(body, /c\(\)/);
  assert.doesNotMatch(body, /d\(\)/);
});

test('the definition shapes the suite already leans on are unchanged', () => {
  // The `opts = {}` object default is the F15-adjacent trap fnBody already fixed once: the first `{` after
  // the anchor is the default, not the body. Pin it.
  const src = "const api = { async publishGroupKey(gid, recips, opts = {}) { seal(); } };\nfunction tail() { t(); }";
  const body = fnBody(src, 'async publishGroupKey(', 'publishGroupKey');
  assert.match(body, /seal\(\)/, 'must reach past the object default to the real body');
  assert.doesNotMatch(body, /t\(\)/, 'and stop at its own closing brace');
});
