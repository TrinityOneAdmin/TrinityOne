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
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody, stripComments, stripStrings } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

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

// ── THE STRIPPERS MUST NOT EAT CODE (AUDIT-steward-doc-rules-round2-2026-09-22, R4) ──────────────────────
// A stripper that destroys real code turns every `assert.doesNotMatch(CODE, …)` over the destroyed region
// into a TAUTOLOGY — a guard that passes because the thing it forbids is no longer there to find. Nothing
// was wrong in the tree the day this was measured, which is the whole danger: the damage sits waiting for
// an assertion to be written over it.
//
// MEASURED at e1f8f41, `stripStrings(stripComments(x))` piped through esbuild: 61 of 78 non-JSX sources
// parsed; 17 did not, including scripts/gateway.mjs — the one file both live callers of stripStrings slice.
// After: 75 of 78. The three that remain all fail on NESTED TEMPLATE LITERALS (`` `a${`b`}` ``), which
// neither stripper has ever handled and which no test slices today (src/finance-statement.mjs,
// vendor/finance-ledger.js, vendor/wallet.js).
const PARSE_THESE = [
  'scripts/gateway.mjs',            // ← the file BOTH live stripStrings callers slice
  'scripts/trinity-doc-types.mjs',
  'src/steward.src.js',
  'src/fellowship.src.js',
  'src/relay-identity.src.js',
  'vendor/steward.js',
  'vendor/fellowship.js',
];
for (const rel of PARSE_THESE) {
  test('stripped code still PARSES: ' + rel, () => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const out = stripStrings(stripComments(src));
    assert.equal(out.length, src.length, 'offsets moved — every index-based assertion in the suite depends on this');
    const tmp = join(tmpdir(), 'slice-parse-' + process.pid + '-' + rel.replace(/\W/g, '_') + '.mjs');
    writeFileSync(tmp, out);
    try {
      execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--log-level=error', '--outfile=' + tmp + '.o.js'],
        { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const where = String(e.stderr || e.message).split('\n').slice(0, 5).join('\n');
      assert.fail('THE STRIPPERS DESTROYED REAL CODE IN ' + rel + ', so every assert.doesNotMatch over that ' +
        'region is now a tautology and guards nothing:\n' + where);
    } finally { rmSync(tmp, { force: true }); rmSync(tmp + '.o.js', { force: true }); }
  });
}

test('a regex literal is not read as a line comment, and does not eat the rest of its line', () => {
  // scripts/gateway.mjs:424 verbatim. The `\/\/` inside the regex contains the two characters `//`.
  const src = 'function f(conf) {\n  if (/^https?:\\/\\//i.test(conf)) return conf;\n  return DEFAULT;\n}\n';
  const out = stripComments(src);
  assert.match(out, /return conf;/, 'the rest of the line was blanked — the regex was read as a comment');
  assert.match(out, /return DEFAULT;/, 'the damage ran past the line');
});

test('a regex containing a quote does not open a string', () => {
  const src = 'const re = /href="([^"]+)"/gi;\nconst decided = mustRefuse(d);\n';
  const out = stripStrings(stripComments(src));
  assert.match(out, /const decided = mustRefuse\(d\);/,
    'the quote inside the regex opened a string literal and blanked the decision after it');
});

test('a decision hidden INSIDE a regex literal is blanked, like one hidden in a string', () => {
  // The next step along from M1 (comment) and M1B (string): the same sentence as a regex body.
  const src = 'const _X = /if \\(!\\(isAnyChurch \\|\\| isNetwork\\)\\) return false;/;\n';
  const out = stripStrings(stripComments(src));
  assert.doesNotMatch(out, /isAnyChurch/,
    'a rule re-typed as a regex literal still satisfies every text match over the file — the third costume');
  assert.equal(out.length, src.length);
});

test('JSX is not full of regex literals', () => {
  // `</div>` and `<Icon />` both put a `/` where a regex could otherwise start. Reading either as one made
  // the scan run to the next `/` on the line: on app/stew-dashboard.jsx it swallowed a template literal's
  // backtick and 201 real `//` comments then survived stripping.
  const src = '  return <div className="x">{a}</div>;   // a real comment\n  const n = 1;   // another\n';
  const out = stripComments(src);
  assert.doesNotMatch(out, /a real comment/, 'a JSX closing tag was read as a regex and the comment survived');
  assert.doesNotMatch(out, /another/, 'the damage ran on to the next line');
  assert.match(out, /className="x"/, 'and the JSX itself must be untouched');
});

test('an escaped BACKSLASH ends a string — `\'\\\\\'` is not an escaped quote', () => {
  // ON ONE LINE, deliberately. Both strippers reset at a newline (the JSX-apostrophe shield), so a
  // two-line fixture is repaired by that reset and proves nothing — it passed against the old `prev !==
  // '\\'` code, which is how this test was caught being inert.
  const src = "const sep = '\\\\'; const decided = mustRefuse(d);   // a real comment\n";
  assert.match(stripComments(src), /const decided = mustRefuse\(d\);/,
    'stripComments stayed "inside a string" past a literal backslash');
  assert.doesNotMatch(stripComments(src), /a real comment/,
    'the scan stayed "inside a string" past a literal backslash, so the rest of the line — comment and all — ' +
    'went unstripped, and any assertion over it is reading prose again');
  assert.match(stripStrings(stripComments(src)), /const decided = mustRefuse\(d\);/,
    'stripStrings blanked a decision that is not inside any string');
});

test('division is still division', () => {
  // The guess leans this way on purpose: mistaking a regex for a division only misses a blanking, while
  // mistaking a division for a regex blanks real code.
  const src = 'const half = total / 2;\nconst rate = a.b / c.d;\nconst ok = decide(x);\n';
  assert.equal(stripStrings(stripComments(src)), src, 'a division was eaten as a regex literal');
});
