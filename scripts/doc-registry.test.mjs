// Every document type the code uses must be declared, and the three surfaces must agree on its spelling.
// Run: node --test scripts/doc-registry.test.mjs
//
// ARCHITECTURE-2026-07-29, recommendation 2. Church data is kind-30078 addressable documents keyed by their
// `d`-tag, and those STRINGS were typed out independently in three files — 49 of them appear in both
// scripts/gateway.mjs and at least one client engine, with no shared definition. A typo is not a build error:
// it is a document the relay gates under one name while a client publishes under another, and nothing fails.
//
// This is the conformance check for scripts/trinity-doc-types.mjs. It does NOT assert that the relay reads
// its constants from the registry — rewiring the authorization spine is a separate, later step, deliberately.
// What it asserts is that the declaration and the code cannot drift apart without something going red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOC_TYPES, UNDECLARED, ALL_PREFIXES, describe as describeDoc } from './trinity-doc-types.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const GATEWAY = read('scripts/gateway.mjs');
const FELLOWSHIP = read('src/fellowship.src.js');
const STEWARD = read('src/steward.src.js');

// Every 'trinityone/...' or 'finance/...' d-tag literal in a file.
const literals = (src) => new Set(
  [...src.matchAll(/'((?:trinityone|finance)\/[a-z-]+:?)'/g)].map(m => m[1]));

const G = literals(GATEWAY), F = literals(FELLOWSHIP), S = literals(STEWARD);

test('the registry is not empty and is internally consistent', () => {
  // A conformance test whose registry is empty passes everything.
  assert.ok(Object.keys(DOC_TYPES).length > 40, 'the declared list looks too small to be real: ' + Object.keys(DOC_TYPES).length);
  const overlap = Object.keys(DOC_TYPES).filter(p => p in UNDECLARED);
  assert.deepEqual(overlap, [], 'a type is listed as both declared and undeclared');
  for (const [p, d] of Object.entries(DOC_TYPES)) {
    assert.ok(/^(trinityone|finance)\//.test(p), 'not a d-tag prefix: ' + p);
    assert.ok(['church', 'leader', 'steward', 'member', 'recipient', 'mixed'].includes(d.write), `${p}: unknown write policy ${d.write}`);
    assert.ok(['public', 'members', 'church', 'subject', 'author', 'care-team'].includes(d.read), `${p}: unknown read policy ${d.read}`);
    assert.ok(['suffix', 'tag', 'author', 'none'].includes(d.scope), `${p}: unknown scope ${d.scope}`);
  }
});

test('every d-tag the RELAY knows about is declared', () => {
  const missing = [...G].filter(p => !describeDoc(p)).sort();
  assert.deepEqual(missing, [],
    'the relay gates these document types and the registry has never heard of them — declare them in ' +
    'scripts/trinity-doc-types.mjs so their policy is written down somewhere');
});

test('every d-tag the MEMBER APP uses is declared', () => {
  const missing = [...F].filter(p => !describeDoc(p)).sort();
  assert.deepEqual(missing, [], 'the member app publishes or reads these and nothing declares them');
});

test('every d-tag the CONSOLE uses is declared', () => {
  const missing = [...S].filter(p => !describeDoc(p)).sort();
  assert.deepEqual(missing, [], 'the console publishes or reads these and nothing declares them');
});

test('the registry has no dead entries', () => {
  // A declaration for a type nobody uses is worse than none: it reads as coverage.
  const used = new Set([...G, ...F, ...S]);
  const dead = ALL_PREFIXES.filter(p => !used.has(p)).sort();
  assert.deepEqual(dead, [], 'declared but used nowhere — remove them, or the registry starts lying about coverage');
});

test('the types with NO relay rule are exactly the ones we know about', () => {
  // This is the finding that made the registry worth writing. If a new one appears, someone chose a policy
  // by accident — the generic fallthrough — and this test is where they find out.
  const inClient = new Set([...F, ...S]);
  const noRelayRule = [...inClient].filter(p => !G.has(p)).sort();
  assert.deepEqual(noRelayRule, Object.keys(UNDECLARED).sort(),
    'a document type is used by a client with no explicit rule in the relay. It will inherit a GENERIC rule ' +
    'that nobody chose. Give it a rule in accept()/canRead(), or list it in UNDECLARED with the reason it is safe');
});

test('describe() resolves a real d-tag, not just a prefix', () => {
  const d = describeDoc('trinityone/member:' + 'a'.repeat(64));
  assert.ok(d && d.declared, 'a concrete member document did not resolve');
  assert.equal(d.prefix, 'trinityone/member:');
  assert.equal(describeDoc('trinityone/not-a-real-type:x'), null, 'an unknown type must resolve to null, not to a guess');
});

// ── the safeguarding declarations are the ones worth pinning ────────────────────────────────────────────
test('the safeguarding types are declared the way the relay actually gates them', () => {
  // These four are where a wrong declaration would be most dangerous, so they are checked against the relay
  // source rather than taken on trust. `minors:` and `guardians:` were deliberately withdrawn from ordinary
  // members on 2026-07-27; `joinpolicy:` is the single public document.
  assert.equal(DOC_TYPES['trinityone/minors:'].read, 'church');
  assert.equal(DOC_TYPES['trinityone/guardians:'].read, 'church');
  assert.match(GATEWAY, /const cpS = d\.startsWith\(MINORS_D\)/,
    'the relay no longer gates minors:/guardians: the way the registry claims — one of them is wrong');
  assert.equal(DOC_TYPES['trinityone/joinpolicy:'].read, 'public');
  assert.match(GATEWAY, /if \(d\.startsWith\(JOINPOLICY_D\)\) return true;/,
    'joinpolicy: is declared public and the relay no longer serves it publicly, or vice versa');
  assert.equal(DOC_TYPES['trinityone/stewards:'].write, 'church',
    'the steward roster must be owner-only — it is what grants steward authority in the first place');
  assert.match(GATEWAY, /d\.startsWith\(STEWARDS_D\)\) return CHURCH_PUBS\.has\(e\.pubkey\)/,
    'the relay no longer restricts the steward roster to the church key');
});
