// The relay gates by names from the declared list, and cannot invent one. Run: node --test scripts/registry-wiring.test.mjs
//
// ARCHITECTURE-AUDIT-2026-07-30 — rec 2's deferred second half, from ARCHITECTURE-2026-07-29.
//
// scripts/gateway.mjs used to define all fifty of its d-tag names itself, as its own literals. That is the
// defect rec 2 was written about: a typo there is not a build error, it is a document the relay gates under one
// name while a client publishes under another, and NOTHING FAILS LOUDLY. The relay simply never matches, the
// document falls through to a generic rule, and the feature returns empty.
//
// The spine now imports them from scripts/trinity-doc-types.mjs through k(), which throws on anything this
// project has not declared — so the failure moved from "silent, in production, months later" to "at relay
// startup, before it serves a request".
//
// WHAT THIS IS NOT, and the test asserts it stays that way: accept()/canRead() keep their own rules. The
// registry's write/read/scope columns are a SUMMARY; the real rules carry dozens of special cases. Deriving
// authorization from a summary would be rewriting the security spine out of a simplification.
//
// ── WHAT THIS FILE CANNOT DO. READ THIS BEFORE TREATING ITS GREENNESS AS PROOF ───────────────────────────
//
// IT READS TEXT. Every assertion below is a question asked of gateway.mjs's source, and five separate
// audits have now walked past one by moving the decision somewhere the text still looked right:
//
//     M1  (2026-09-22)        the decision left verbatim as a COMMENT                8/0 — closed by stripComments
//     F6  (2026-09-22)        the decision left verbatim as a STRING LITERAL         8/0 — closed by stripStrings
//     R3  (round 2)           the decision moved into DEAD CODE nothing calls        8/0 — closed by slicing accept()
//     M1D (round 2)           the helper left in place and NEUTERED inside           8/0 — closed by RUNNING it
//     F4  (round 3)           the helper SHADOWED by a local const inside accept()   8/0 — closed below
//
// THAT FAMILY IS UNBOUNDED, and each close is one door, not the corridor. A sixth is always available —
// rename the parameter, wrap the call, resolve the function through a table, compute the d-tag differently.
// So this file is a FAST TRIPWIRE, run in milliseconds with no relay, and it is NOT the guarantee.
//
// THE GUARANTEE IS BEHAVIOURAL, and it lives in two files that spawn a real gateway and ask it:
//     scripts/relay-refuses-undeclared-member-doc-types.test.mjs   (F4's shadow: 28 pass / 2 fail)
//     scripts/six-steward-doc-types-have-rules.test.mjs            (F4's shadow: 42 pass / 2 fail)
// Both caught every door above without being changed for any of them, because they do not care where the
// decision is written — they publish an event and read the relay's answer. If this file and those two ever
// disagree, THEY are right. Nothing here should be tightened into a scope resolver; the honest next step
// for a sixth door is another behavioural case, not another regular expression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOC_TYPES, UNDECLARED, D, MEMBER_WRITABLE_TYPES } from './trinity-doc-types.mjs';
import { fnBody, stripComments, stripStrings } from './test-slice.mjs';

const GATEWAY = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
// THE SAME SOURCE WITH ITS COMMENTS BLANKED, for the assertions that read a DECISION rather than a name.
//
// AUDIT-undeclared-doc-types-2026-09-22, finding M1. The "one column-derived list" test below does raw
// assert.match over gateway.mjs and never stripped comments. Sabotage S4 — delete the decision and leave its
// exact text as a comment:
//
//     -    if (!(isAnyChurch || isNetwork) && !memberDocTypeOk(d)) return false;
//     +    // if (!(isAnyChurch || isNetwork) && !memberDocTypeOk(d)) return false;
//
// left this file 8 pass / 0 fail. The rule was gone and its guard was green — [[comments-can-satisfy-
// assertions]] again, in a test written the same week as the note. stripComments keeps byte offsets stable,
// so an ordering check over the same string would still mean what it says.
//
// AND THE STRINGS GO TOO — AUDIT-steward-doc-rules-2026-09-22, finding F6, which is M1 one step along.
// stripComments must PRESERVE string contents to keep byte offsets stable, so the same decision typed as a
// string literal walked straight past the fix above:
//
//     -    if (!(isAnyChurch || isNetwork) && !memberDocTypeOk(d)) return false;
//     +    const _M1B = 'if (!(isAnyChurch || isNetwork) && !memberDocTypeOk(d)) return false;'; void _M1B;
//
// left this file 8 pass / 0 fail, with the rule gone. stripStrings blanks literal CONTENTS, offsets intact,
// so the only text that can satisfy the assertions below is executable code.
//
// USED BY (CLAUDE.md rule 2 — every assertion that reads it, and they are all in one test): the catch-all's
// `if (…) return false` match and the `memberDocTypeOk(…) return true` doesNotMatch, both in "the ONE
// column-derived list the spine reads only ever NARROWS". The NAME-shaped assertions above deliberately keep
// reading the raw source: a comment there is evidence the name exists in the file, which is all they claim —
// and they MUST, because the names they look for are string literals this would blank.
const GATEWAY_CODE = stripStrings(stripComments(GATEWAY));
const REGISTRY = readFileSync(new URL('../scripts/trinity-doc-types.mjs', import.meta.url), 'utf8');
const declared = new Set([...Object.keys(DOC_TYPES), ...Object.keys(UNDECLARED)]);

test('the spine defines NO d-tag literal of its own any more', () => {
  // TOLERANT of whitespace. My first version of this matched `NAME_D = '…'` with exactly one space, and
  // SAFE_D is declared as `const SAFE_D   = 'trinityone/safe:';` with three. So the rewrite skipped it AND
  // this guard reported "no literals left" — the same blind spot in the fix and in the test that vouched for
  // it, which is this audit's own recurring finding, in my own work.
  const literals = GATEWAY.match(/\b[A-Z][A-Z_]*_D\s*=\s*'(?:trinityone|finance)\/[^']*'/g) || [];
  assert.deepEqual(literals, [],
    'gateway.mjs is back to typing its own document names. That is the exact defect: a typo here is not a ' +
    'build error, it is a document gated under one name and published under another, failing silently.');
});

test('every name the spine uses comes from the registry', () => {
  const wired = GATEWAY.match(/\b[A-Z][A-Z_]*_D\s*=\s*D\.[A-Z_]+/g) || [];
  assert.ok(wired.length >= 48, 'only ' + wired.length + ' constants are wired to the registry — expected ~50');
  const missing = wired.map(w => w.split('D.')[1]).filter(n => !(n in D));
  assert.deepEqual(missing, [], 'the spine references D entries that do not exist — the relay would gate by undefined');
});

test('no wired name resolves to undefined — that would gate by "undefined"', () => {
  // The failure that would be worst and quietest: `d.startsWith(undefined)` throws, but
  // `d === undefined` just never matches, so the document silently falls through to a generic rule.
  const bad = Object.entries(D).filter(([, v]) => typeof v !== 'string' || !v);
  assert.deepEqual(bad, [], 'these registry names are empty or not strings');
});

test('every name in D is a DECLARED document type', () => {
  const undeclaredNames = Object.entries(D).filter(([, v]) => !declared.has(v)).map(([n, v]) => n + ' = ' + v);
  assert.deepEqual(undeclaredNames, [],
    'the relay would gate by a name this project has never declared — nobody has decided who may read or ' +
    'write it, so it inherits a generic rule by accident. That is how SECURITY-AUDIT-2026-07-20 C1 happened.');
});

test('k() REFUSES an undeclared name, rather than passing it through', () => {
  // The whole value of the wiring. Without this the import is decoration: a typo would resolve to a string
  // that simply never matches anything, exactly as before.
  const m = REGISTRY.match(/const k = \(s\) => \{[\s\S]*?\n\};/);
  assert.ok(m, 'the checked lookup k() is gone — D would accept any string and the wiring buys nothing');
  const body = m[0];
  assert.match(body, /throw new Error/, 'k() no longer throws, so an undeclared name passes through silently');
  assert.match(body, /!\(s in DOC_TYPES\)/, 'k() no longer checks the declared list');
  assert.match(body, /!\(s in UNDECLARED\)/, 'k() no longer accepts the knowingly-undeclared list');
  // and prove it actually bites, by running it
  // eslint-disable-next-line no-new-func
  const kFn = new Function('DOC_TYPES', 'UNDECLARED', body.replace('const k =', 'return') + '')(DOC_TYPES, UNDECLARED);
  assert.throws(() => kFn('trinityone/nope-not-a-real-type:'), /not a declared document type/,
    'k() accepted a name nobody declared — the relay could gate by a typo again');
  assert.equal(kFn('trinityone/group:'), 'trinityone/group:', 'k() rejected a genuinely declared type');
});

// ── the line this must not cross ─────────────────────────────────────────────────────────────────────────
test('POLICY still lives in the spine, not in the registry', () => {
  // The registry's columns are a summary. If accept()/canRead() ever start reading `write`/`read`/`scope` to
  // DECIDE something, the security rules are being derived from a simplification — which is a far bigger and
  // more dangerous change than sharing the vocabulary, and must be a deliberate, separately-reviewed step.
  assert.doesNotMatch(GATEWAY, /\bDOC_TYPES\b/,
    'gateway.mjs now reads DOC_TYPES itself. If it is deriving authorization from the registry\'s summary ' +
    'columns, that is the change this wiring deliberately did NOT make — the real rules have dozens of ' +
    'special cases the columns do not capture.');
  assert.doesNotMatch(GATEWAY, /describe\(/, 'the spine is calling the registry\'s describe() — same concern');
  // the real rules must still be present and doing the work
  for (const marker of ['function accept', 'function canRead', 'FINANCE_SEQ', 'stewardOf(']) {
    assert.ok(GATEWAY.includes(marker), 'the spine lost ' + marker + ' — its own rules must still be there');
  }
});

// ── THE ONE EXCEPTION, 2026-09-22 ────────────────────────────────────────────────────────────────────────
test('the ONE column-derived list the spine reads only ever NARROWS', () => {
  // MEMBER_WRITABLE_TYPES is derived from the `write` column (in the registry, not here) and accept()'s member
  // catch-all reads it. That is allowed because it can only refuse: a type absent from the list is refused,
  // never granted, and every per-type rule stays in accept(). The registry's note above k() says why. This
  // pins the SHAPE of the use — a refusal — so it cannot quietly become a grant; the behaviour itself is
  // measured on a live gateway in scripts/relay-refuses-undeclared-member-doc-types.test.mjs.
  assert.ok(Array.isArray(MEMBER_WRITABLE_TYPES) && MEMBER_WRITABLE_TYPES.length >= 21,
    'the registry no longer exports MEMBER_WRITABLE_TYPES, or it collapsed: ' + JSON.stringify(MEMBER_WRITABLE_TYPES));
  const uses = GATEWAY.match(/\bMEMBER_WRITABLE_TYPES\b/g) || [];
  assert.equal(uses.length, 2, 'MEMBER_WRITABLE_TYPES is read in ' + uses.length + ' places in gateway.mjs — expected the import and memberDocTypeOk() only');
  // INSIDE accept(), NOT ANYWHERE IN THE FILE. AUDIT-steward-doc-rules-round2-2026-09-22, finding R3.
  // Stripping comments (M1) and strings (F6) closed two doors of an unbounded family, and the auditor
  // walked through a third: MOVE THE DECISION, VERBATIM, INTO DEAD CODE —
  //
  //     (deleted from accept(), appended at the bottom of gateway.mjs)
  //     function _auditDeadCode(isAnyChurch, isNetwork, d) {
  //       if (!(isAnyChurch || isNetwork) && !memberDocTypeOk(d)) return false;
  //       return true;
  //     }
  //
  // — which left this file 8 pass / 0 fail with the catch-all gone. A text match over a whole file cannot
  // ask WHERE the text is, so the answer is to ask a question text cannot dodge: the decision must be in
  // the body of the function that makes it. fnBody brace-matches accept() out of the stripped source
  // (offsets are preserved, so slicing the stripped copy is the same region as the raw one).
  const ACCEPT = fnBody(GATEWAY_CODE, 'function accept(e) {', 'accept()');
  const hits = ACCEPT.match(/if \(!\(isAnyChurch \|\| isNetwork\) && !memberDocTypeOk\(d\)\) return false;/g) || [];
  assert.equal(hits.length, 1,
    'the catch-all refusal is not in accept()\'s own body ' + (hits.length ? '(it is there ' + hits.length + ' times)' : '(0 occurrences)') +
    '. It may still be somewhere in gateway.mjs — in a helper nothing calls, say — and a document nobody ' +
    'has declared would then be stored for any member of any church on the box.');
  assert.doesNotMatch(ACCEPT, /memberDocTypeOk\([^)]*\)\) return true/, 'memberDocTypeOk is used to GRANT inside accept()');
  assert.doesNotMatch(GATEWAY_CODE, /memberDocTypeOk\([^)]*\)\) return true/, 'memberDocTypeOk is used to GRANT somewhere');

  // AND THE NAME AT THE CALL SITE MUST BE THE TOP-LEVEL FUNCTION, NOT A LOCAL ONE.
  // AUDIT-steward-doc-rules-round3-2026-09-22, finding F4 — a FIFTH door, and the one that shows what this
  // whole approach cannot do. Insert a shadow ABOVE the catch-all, inside accept(), and leave everything
  // else untouched:
  //
  //     const memberDocTypeOk = (_x) => true;
  //     if (!(isAnyChurch || isNetwork) && !memberDocTypeOk(d)) return false;   // unchanged, still once
  //
  // Measured: registry-wiring 8 pass / 0 fail with the catch-all completely neutered. Every assertion above
  // is satisfied — the line is in accept()'s body exactly once, MEMBER_WRITABLE_TYPES is still read in two
  // places, and the lift below still finds and runs the REAL top-level function, which still answers all
  // six cases correctly. The test was running one function while the relay ran another: [[stub-answers-the-
  // question]] inverted. Behaviourally it was caught — relay-refuses 28/2, six-steward 42/2.
  //
  // This is narrow ON PURPOSE. It asks one question text CAN answer: does accept() declare a binding of
  // that name of its own? accept() legitimately never does, so there is nothing for it to false-positive
  // on, and it does not pretend to resolve scopes. See "WHAT THIS FILE CANNOT DO" at the top.
  const shadows = ACCEPT.match(/\b(?:const|let|var|function)\s+memberDocTypeOk\b/g) || [];
  assert.deepEqual(shadows, [],
    'accept() DECLARES ITS OWN `memberDocTypeOk` (' + shadows.join(', ') + '). The catch-all above then ' +
    'calls that one and not the registry-derived function this test lifts and runs, so the two can say ' +
    'opposite things while every assertion here passes. A document nobody has declared would be stored ' +
    'for any member of any church on the box.');

  // AND THE DECISION IS RUN, NOT READ. The other door the auditor walked through was M1D: leave the
  // catch-all exactly where it is and neuter what it ASKS —
  //
  //     const s = String(d || '');   ->   const s = String(d || ''); if (s) return true;
  //
  // — which also left this file 8 pass / 0 fail, because `function memberDocTypeOk(` is still every word
  // the text above looks for. So the real function is lifted out of the shipped spine and executed. Its
  // only dependency is MEMBER_WRITABLE_TYPES, which this file already imports from the registry — no stub
  // supplies the answer it is named after ([[stub-answers-the-question]]).
  const mdtSrc = fnBody(GATEWAY, 'function memberDocTypeOk(d) {', 'memberDocTypeOk');
  // eslint-disable-next-line no-new-func
  const memberDocTypeOk = new Function('MEMBER_WRITABLE_TYPES', mdtSrc + '\nreturn memberDocTypeOk;')(MEMBER_WRITABLE_TYPES);
  assert.equal(memberDocTypeOk('trinityone/safe:abc'), true, 'a member type the registry declares is now refused — members could not write their own documents');
  assert.equal(memberDocTypeOk('trinityone/notes'), true, 'a bare member type (the MyData six) is now refused');
  assert.equal(memberDocTypeOk('trinityone/sermon:1'), false,
    'THE LIST NO LONGER NARROWS ANYTHING: a steward-only type passes the member catch-all. Any member of ' +
    'any church on this box could write the church\'s own documents.');
  assert.equal(memberDocTypeOk('trinityone/nope-nobody-declared-this:1'), false,
    'an UNDECLARED d-tag passes the member catch-all — which is exactly how `voice:` shipped writable by every member');
  assert.equal(memberDocTypeOk('trinityone/notesX'), false,
    'a bare name is being matched by PREFIX, which GRANTS rather than narrows: trinityone/notesX is not trinityone/notes');
  assert.equal(memberDocTypeOk(''), false, 'an empty d-tag is accepted');
  // …and BOTH strippers must actually be stripping. One that silently returned its input would restore the
  // hole above in a way nothing else in this file could see, and there are two holes: prose in a comment
  // (M1) and prose in a string literal (F6).
  assert.ok(/\/\/ THE CHAT TAG LABELS\./.test(GATEWAY) && !/\/\/ THE CHAT TAG LABELS\./.test(GATEWAY_CODE),
    'GATEWAY_CODE still contains gateway.mjs comments — the two assertions above are reading prose again');
  assert.ok(/undeclared document type /.test(GATEWAY) && !/undeclared document type /.test(GATEWAY_CODE),
    'GATEWAY_CODE still contains gateway.mjs STRING CONTENTS, so the decision above can be satisfied by a ' +
    'string literal: `const _x = "if (…) return false;"` passes while the rule itself is deleted ' +
    '(AUDIT-steward-doc-rules-2026-09-22 F6). The needle here is a refusal sentence that exists ONLY inside ' +
    'a string once comments are gone.');
  // …and the code itself must have survived both: a stripper that blanked everything would satisfy every
  // doesNotMatch in this test and quietly stop the two matches above from meaning anything.
  assert.match(GATEWAY_CODE, /function memberDocTypeOk\(/,
    'GATEWAY_CODE no longer contains executable gateway.mjs code — the strippers have eaten the source');
});

test('the import is the runtime one, not a build-time copy', () => {
  // gateway.mjs is run directly by node — it is not bundled — so this has to be a real runtime import from a
  // path that ships. scripts/ is the proven one: event-store.mjs is already imported from here at runtime.
  assert.match(GATEWAY, /import \{ D, MEMBER_WRITABLE_TYPES \} from '\.\/trinity-doc-types\.mjs';/,
    'the spine no longer imports the registry at runtime');
});
