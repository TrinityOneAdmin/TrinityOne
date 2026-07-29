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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOC_TYPES, UNDECLARED, D } from './trinity-doc-types.mjs';

const GATEWAY = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
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

test('the import is the runtime one, not a build-time copy', () => {
  // gateway.mjs is run directly by node — it is not bundled — so this has to be a real runtime import from a
  // path that ships. scripts/ is the proven one: event-store.mjs is already imported from here at runtime.
  assert.match(GATEWAY, /import \{ D \} from '\.\/trinity-doc-types\.mjs';/,
    'the spine no longer imports the registry at runtime');
});
