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
    // Quote- and comment-aware, like the brace walk below. Without this a paren inside a string default —
    // `function f(sep = ')')` — closes the count early and everything downstream reads the wrong region.
    let d = 0, end = -1, q = '';
    for (let i = paren; i < src.length; i++) {
      const c = src[i], prev = src[i - 1];
      if (q) { if (c === q && prev !== '\\') q = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); if (e === -1) break; i = e; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i); if (e === -1) break; i = e + 1; continue; }
      if (c === '(') d++;
      else if (c === ')' && --d === 0) { end = i; break; }
    }
    assert.notEqual(end, -1, `${what} has an unterminated parameter list`);
    open = src.indexOf('{', end);
    assert.notEqual(open, -1, `${what} has no block to read`);
    // AUDIT-2026-08-10 item E. For a DEFINITION, nothing but whitespace, comments, or a single `=>` sits
    // between the parameter list's `)` and the body's `{`. For a CALL — `addEventListener('install', (e) =>
    // {…})` — the walk above balances to the CALL's final paren, and `indexOf('{', end)` then lands on the
    // NEXT construct's block: the slice silently contains a neighbouring function, and a `doesNotMatch` on it
    // reads code the test never named. Measured on the real sw.js: the 'install' slice contained the entire
    // 'activate' handler. A helper that guesses at what the caller meant is the disease this file exists to
    // cure, so a call-shaped anchor fails loudly instead of returning anything.
    const between = stripComments(src.slice(end + 1, open)).trim();
    assert.ok(between === '' || between === '=>',
      `${what} looks like a call, not a definition — anchor the function itself ` +
      `(found ${JSON.stringify(between.slice(0, 40))} between its ')' and '{')`);
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

// ── IS THIS `/` A REGEX, AND WHERE DOES IT END? Shared by BOTH strippers below, because both of them
// used to mistake a regex literal for something else — stripComments for a line comment, stripStrings
// for a quote. The reasoning, and what was measured, is in stripStrings' own note.
// ⚠ JSX IS THE REASON `<` AND `>` ARE NOT IN THIS SET. Half the files these strippers are pointed at are
// app/*.jsx, where `</div>` puts a `/` straight after a `<` and `<Icon … />` puts one straight before a
// `>`. Reading either as a regex start makes the scan run to the NEXT `/` on the line and swallow whatever
// is between — MEASURED on app/stew-dashboard.jsx: one such span ate the backtick of a template literal
// and 201 real `//` comments then survived stripping, which is the precise hole stripComments exists to
// close, re-opened by a careless fix to its neighbour. `=>` is allowed by an explicit test below, because
// there the `>` really is the end of an arrow.
const RE_CAN_START_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '~']);
const RE_CAN_START_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await']);
// The index of the closing `/` of a regex literal that starts at `at`, or -1 if this is not one: a regex
// cannot span a line, `\` escapes the next character, and `/` inside a `[…]` class does not close it.
function regexEndAt(src, at) {
  if (src[at + 1] === '>') return -1;                        // `/>` closes a JSX tag; `/>/` is a regex we give up on
  let inClass = false;
  for (let j = at + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '\n') return -1;
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '/') return j === at + 1 ? -1 : j;   // `//` is a comment, never an empty regex
  }
  return -1;
}
function regexCanStart(out) {
  let k = out.length - 1;
  while (k >= 0 && (out[k] === ' ' || out[k] === '\n' || out[k] === '\t' || out[k] === '\r')) k--;
  if (k < 0) return true;                                   // start of file
  const pc = out[k];
  if (pc === '<') return false;                             // `</div>` — JSX, never a regex
  if (pc === '>') return k >= 1 && out[k - 1] === '=';      // an ARROW may be followed by one; a JSX tag may not
  if (RE_CAN_START_AFTER.has(pc)) return true;
  if (!/[A-Za-z0-9_$]/.test(pc)) return false;               // `)`, `]`, a quote, `.` … → a value, so division
  let w = '', m = k;
  while (m >= 0 && /[A-Za-z0-9_$]/.test(out[m])) { w = out[m] + w; m--; }
  if (m >= 0 && out[m] === '.') return false;                // `x.return` is a property, not the keyword
  return RE_CAN_START_AFTER_WORD.has(w);
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
//
// ⚠ A REGEX LITERAL IS NOT A COMMENT, and until 2026-09-22 this could not tell them apart. `/^https?:\/\//`
// contains the two characters `//` — at the escaped slashes — so the scan below read a line comment there
// and blanked the rest of the line. MEASURED (round-2 audit R4, and it is this function, not stripStrings,
// that eats this one):
//
//     scripts/gateway.mjs:424   if (/^https?:\/\//i.test(conf)) return conf;
//                        ->     if (/^https?:\/\                             |EOL
//
// The regex literals it can now see are copied through VERBATIM — they are code, and this function only
// removes comments. (stripStrings, below, then blanks their bodies, for the reason written there.)
//
// ⚠ CORRECTION TO THE PERMANENT RECORD (CLAUDE.md rule 4). `277e0fe`'s commit message says this function's
// "output changes for 16 of the 125 sources in scripts/ src/ app/ vendor/". THE NUMBER IS 17, not 16 —
// found by AUDIT-steward-doc-rules-round3-2026-09-22 finding F5 and re-measured independently here, old
// stripper (277e0fe^) against new over every git-tracked .js/.mjs/.jsx in those four directories minus
// *.test.mjs. The seventeen, in full:
//
//     app/app.jsx · app/identity-extras.jsx · app/screens-audio.jsx · app/screens-watch.jsx ·
//     app/stew-dashboard.jsx · scripts/gateway.mjs · scripts/scope-scan.mjs · src/fellowship.src.js ·
//     src/finance-statement.mjs · src/relay-identity.src.js · src/steward.src.js · vendor/babel.min.js ·
//     vendor/fellowship.js · vendor/finance-ledger.js · vendor/jspdf.umd.min.js · vendor/steward.js ·
//     vendor/wallet.js
//
// THE DENOMINATOR IS 127 / 80, AND 125 / 78 IS A NON-RECURSIVE WALK. That set is 127 files (80 non-JSX)
// at `277e0fe` itself, measured with `git ls-tree -r`, and 127/80 is the honest denominator for "the
// sources this stripper is used on".
//
// ⚠ AND THE FIRST CORRECTION GOT THE CAUSE WRONG (rule 4 again; AUDIT-steward-doc-rules-round4-2026-09-22
// finding F4). This block said "a walk that skips dotfiles gives 124, and nothing gives 125". Something
// does: a walk of `scripts/ src/ app/ vendor/` that does NOT DESCEND gives exactly 125 / 78. MEASURED,
// same enumeration, same extension filter, same `*.test.mjs` exclusion, at `277e0fe`:
//
//     RECURSIVE, git-tracked at 277e0fe       : 127 files / 80 non-JSX
//     NON-RECURSIVE (top level of the 4 dirs) : 125 files / 78 non-JSX     <<< the disputed pair
//       dropped by a non-recursive walk       : vendor/library/index.js, vendor/sqljs/sql-wasm.js
//     RECURSIVE minus dotfiles                : 124 files / 77 non-JSX
//     NON-RECURSIVE minus dotfiles            : 122 files / 75 non-JSX
//
// The two files a non-recursive walk drops live in vendor/'s only two subdirectories and are BOTH non-JSX,
// which is why BOTH of 277e0fe's numbers move by exactly two. The dotfile story explains 124 and is a red
// herring; the three dotted sim drivers (scripts/.sim-click.mjs, .sim-type.mjs, .sim-words.mjs) are tracked
// and not ignored, but they are not what the 125 is about.
//
// The 17 is unaffected: neither of the two extra files is among the seventeen listed above, so the same
// seventeen change under either denominator. Everything else downstream of the number reproduces and is
// untouched: 70 lines of real code restored, 5 correctly blanked, 0 in neither class, and 61 -> 75 of 78
// parsing.
export function stripComments(src) {
  let out = '', q = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      // AN ESCAPE TAKES THE NEXT CHARACTER WITH IT, WHATEVER IT IS. This was `prev !== '\\'`, which reads
      // one character back and therefore cannot tell `'\''` (an escaped quote) from `'\\'` (an escaped
      // BACKSLASH, where the quote after it really does close the string). MEASURED: this file's own
      // `prev !== '\\'` left the scan inside a string for the rest of the line — `scripts/test-slice.mjs`
      // was one of the files whose stripped output would not parse.
      if (c === '\\' && i + 1 < src.length && src[i + 1] !== '\n') { out += c + src[i + 1]; i++; continue; }
      out += c;
      // A ' or " STRING CANNOT CONTAIN A RAW NEWLINE. If we are "inside" one and reach the end of a line, we
      // were never inside a string — we walked into an apostrophe in JSX TEXT ("Nobody else has…", "don't")
      // and every following line was swallowed as string content, comments included.
      //
      // Measured 2026-08-23: 34 full-line // comments survived stripping in app/screens-today.jsx alone, and a
      // new test was unknowingly anchored on one of them. This is the shield built after a safeguarding bug
      // survived 935 green tests because an ordering assertion was satisfied by the COMMENT explaining the
      // rule — so a hole in it is the same class of defect, one level down.
      //
      // Backticks are left alone: a template literal spans newlines legitimately.
      if (c === '\n' && q !== '`') { q = ''; continue; }
      if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && regexCanStart(out)) {
      const end = regexEndAt(src, i);
      if (end !== -1) { out += src.slice(i, end + 1); i = end; continue; }   // a regex literal: code, left alone
    }
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

// THE SAME DOOR, ONE STEP ALONG: blank the CONTENTS of string literals, keeping byte offsets stable.
//
// AUDIT-steward-doc-rules-2026-09-22, finding F6. stripComments above deliberately PRESERVES string contents
// (it has to, to keep offsets — `assert.equal(out.length, src.length)`), so a decision deleted from the code
// and re-typed as a string literal satisfies every assertion that matches its text:
//
//     -    if (!(isAnyChurch || isNetwork) && !memberDocTypeOk(d)) return false;
//     +    const _M1B = 'if (!(isAnyChurch || isNetwork) && !memberDocTypeOk(d)) return false;'; void _M1B;
//
// left scripts/registry-wiring.test.mjs 8 pass / 0 fail — the comment door, closed on the same day, reopened
// as a string. This is the same [[comments-can-satisfy-assertions]] family: prose, of any kind, standing in
// for the rule it describes.
//
// USE IT ON TOP OF stripComments, never instead of it: `stripStrings(stripComments(src))`. Comments must go
// first, or an apostrophe in a comment opens a "string" that swallows the rest of the line.
//
// WHAT IT IS NOT FOR. Any assertion that reads a LITERAL the code is supposed to contain — a d-tag name, a
// refusal sentence, a URL — must keep reading the raw source, because this blanks exactly those. It is for
// assertions that read a DECISION.
//
// KNOWN LIMITATION, measured rather than assumed: NESTED TEMPLATE LITERALS (`` `a${`b`}c` ``) are blanked
// wrongly — the scan closes on the inner backtick — and neither stripper has ever handled them. Of the 78
// non-JSX sources in the tree, 75 parse after stripping and the 3 that do not all fail on exactly this
// (src/finance-statement.mjs, vendor/finance-ledger.js, vendor/wallet.js). No test slices any of them
// today; scripts/test-slice.test.mjs would go red the day one does. app/*.jsx is a separate matter: JSX
// TEXT is not a string literal, so an apostrophe in it opens one here, which is what the newline reset
// exists to contain.
//
// CALLERS (CLAUDE.md rule 2, and today there are two, both asserting a DECISION rather than a name —
// keep this list true):
//   · scripts/registry-wiring.test.mjs                   — the member catch-all's `return false`
//   · scripts/six-steward-doc-types-have-rules.test.mjs  — `sermon:`'s own accept() branch
//
// Quote handling matches stripComments exactly, including the "a ' or \" string cannot contain a raw
// newline" reset, which is what keeps an apostrophe in JSX text from eating the rest of a file.
//
// ⚠ REGEX LITERALS ARE THE THIRD KIND OF QUOTE, and until 2026-09-22 this function could not see them.
// Every `/…"…/` opened a "string": the quote inside the regex was read as an opening quote, and the rest
// of that line was blanked. AUDIT-steward-doc-rules-round2-2026-09-22, finding R4 — MEASURED, the stripped
// output piped through esbuild:
//
//     scripts/gateway.mjs       -> PARSE FAILED: Unterminated regular expression, 424:46
//     src/steward.src.js        -> PARSE FAILED: … 1102:81
//     src/fellowship.src.js     -> PARSE FAILED: … 1422:123
//
//     L5480  const re = /href="(\/v[a-z0-9]+-[^"]+\.html)"/gi; let m;
//       ->   const re = /href="                "]+\.html)"|EOL
//
// That is not cosmetic: EVERY `assert.doesNotMatch(CODE, …)` is a TAUTOLOGY over a region the stripper
// ate, so a guard written this way silently stops guarding. Nothing was wrong in the tree the day it was
// found — the three decisions the two callers assert over all survived — which is exactly how this class
// of defect waits.
//
// A REGEX BODY IS NOW BLANKED, like a string, keeping the `/` delimiters and the flags. Two reasons, and
// the second is the one that matters: the output PARSES (`/  /g` is a valid regex), and a decision
// re-typed as `const _X = /if \(!\(isAnyChurch \|\| isNetwork\)\) return false;/` would otherwise be the
// same door again, one more step along. Prose standing in for the rule it describes, in any of its three
// costumes — comment, string, regex — is what this pair of functions exists to refuse.
//
// WHEN IN DOUBT IT IS DIVISION. A `/` only opens a regex where a value cannot stand (after `(`, `,`, `=`,
// `:`, `[`, `!`, `&`, `|`, `?`, `;`, `{`, `}`, an operator, or a keyword such as `return`), and the span
// must close on the same line. Both directions of a wrong guess were weighed: mistaking a regex for a
// division leaves it verbatim (a missed blanking — safe), while mistaking a division for a regex would
// blank real code, so the guess leans to division and the parse test below is what keeps it honest.
export function stripStrings(src) {
  let out = '', q = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      // Inside a literal: keep newlines (line numbers), blank everything else, and emit the CLOSING quote.
      // The escape takes the next character with it — see the note in stripComments; `'\\'` ends here.
      if (c === '\\' && i + 1 < src.length && src[i + 1] !== '\n') { out += '  '; i++; continue; }
      if (c === '\n' && q !== '`') { q = ''; out += c; continue; }   // never was a string — see stripComments
      if (c === q) { q = ''; out += c; continue; }
      out += c === '\n' ? '\n' : ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if (c === '/' && regexCanStart(out)) {
      const end = regexEndAt(src, i);
      if (end !== -1) {
        out += '/';
        for (let j = i + 1; j < end; j++) out += ' ';   // a regex cannot contain a newline, so this is 1:1
        out += '/';
        i = end;
        continue;
      }
    }
    out += c;
  }
  assert.equal(out.length, src.length, 'stripStrings changed the length — offsets would no longer be comparable');
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

// THE SAFEGUARDING "IS THIS ANSWER MINE?" RULE, lifted from vendor/fellowship.js as source text so it can be
// pasted into a harness's own scope and close over that harness's `_sgSelf`, `pub` and `window`.
//
// Every safeguarding decision in the member app (_assumeMinor, _careNeedRefusal, publishCareRequest) starts by
// asking whether the remembered answer belongs to the person holding the phone: a church match is not enough,
// because one device carries more than one account — createChildAccount mints a child's twelve words on the
// PARENT's phone and the family flow ends by handing the phone over. Stubbing this would leave those tests
// asserting about a mock of the rule they exist to guard, so they take the real one.
export function liftSgMine(bundle) {
  const m = /\n  var _mePub = [\s\S]*?\n  function _sgMine\(cp\) \{[\s\S]*?\n  \}/.exec(bundle);
  assert.ok(m, 'could not lift _mePub/_sgMine from the bundle — re-anchor this helper, do not delete it');
  return m[0];
}

// "WHAT DOES THIS CHURCH SAY ABOUT *ME*?" — lifted from vendor/fellowship.js as source text, for the same
// reason and in the same way as liftSgMine above.
//
// publishCareRequest's child/adult branch rests on this lookup: when the member's own sealed clearance has
// not yet reached the phone, this is what goes and fetches it instead of inferring from the cleared-adults
// list. Stubbing it would hand the harness the exact decision the tests are named after — the failure this
// repo has shipped four times (see the note in stub-answers-the-question). So the tests take the real one and
// feed it real relay documents.
export function liftFetchMyClearance(bundle) {
  const m = /\n  async function _fetchMyClearance\(cp\) \{[\s\S]*?\n  \}/.exec(bundle);
  assert.ok(m, 'could not lift _fetchMyClearance from the bundle — re-anchor this helper, do not delete it');
  return m[0];
}

// "HAS THIS CONSOLE ACTUALLY READ THIS CHURCH'S KEY ENVELOPE?" — the key-read guards of vendor/steward.js
// (`_keyReadEpoch` … `_keysReadSignal`), lifted as source text for harnesses that run subscribeCareKey /
// subscribeNameKey / subscribeMediaKey out of the shipped bundle. Their `oneose` consults these to decide
// whether an end-of-stored-events may open a mint gate; a stub would answer that question for the test.
// Free variables the harness must provide: `actingChurch`, `pub`, `_isRelayAuthed`.
export function liftKeyRead(bundle) {
  const m = /\n  var _keyReadEpoch = 0;[\s\S]*?\n  function _keysReadSignal\(kind\) \{[\s\S]*?\n  \}/.exec(bundle);
  assert.ok(m, 'could not lift the key-read guards from the bundle — re-anchor this helper, do not delete it');
  return m[0];
}

// "NEVER WRAP A KEY TO SOMEONE THE CHURCH BLOCKED" — vendor/fellowship.js's BLOCKED_DOC + _withoutBlocked, lifted as
// source text for harnesses that run publishCareRequest / sendCareChat / childCareAudience out of the shipped
// bundle (owner, 2026-10-02: Block means no private access of any kind). Lifted, not stubbed: a pass-through stub
// would answer "who may read this?" for the harness. It reads only the church's own blocked: document (author AND
// d-tag checked), so a fake querySync that ignores its filter cannot make it drop anyone.
// Free variables the harness must provide: `pool.querySync`, `churchRelays`, `pub`.
export function liftWithoutBlocked(bundle) {
  const m = /\n  var BLOCKED_DOC = [^\n]*\n  async function _withoutBlocked\(cp, list\) \{[\s\S]*?\n  \}/.exec(bundle);
  assert.ok(m, 'could not lift _withoutBlocked from the bundle — re-anchor this helper, do not delete it');
  return m[0];
}
