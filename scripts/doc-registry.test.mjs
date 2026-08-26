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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DOC_TYPES, UNDECLARED, ALL_PREFIXES, D as REG_D, describe as describeDoc } from './trinity-doc-types.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const GATEWAY = read('scripts/gateway.mjs');
const FELLOWSHIP = read('src/fellowship.src.js');
const STEWARD = read('src/steward.src.js');

// Every 'trinityone/...' or 'finance/...' d-tag literal in a file.
//
// ARCHITECTURE-AUDIT-2026-07-30 A6. This pattern used to be `[a-z-]+` — no digits — and was applied to
// exactly THREE files: gateway.mjs and the two big engines. Those are the same three files the registry was
// built from, so the guard's universe was identical to the registry's and it could not, by construction,
// discover a type living anywhere else. It reported green over ten missing types:
//
//     finance/account:  finance/fund:  finance/settings          app/stew-finance.jsx
//     trinityone/manna-                                          src/steward-manna.src.js
//     trinityone/highlights  bookmarks  notes  journal  prayer  settings   src/mydata.src.js
//
// The MyData six are the ones that matter: they publish to every relay in the pool, and their anonymous
// readability was SECURITY-AUDIT-2026-07-20 C1 ("an anonymous REQ for #d=trinityone/highlights returned a
// list of every member pubkey"). A registry whose whole purpose is "the type nobody thought about is where
// the next leak comes from" had never heard of them.
//
// So the scan is now a GLOB, not a list: every engine under src/ and every screen under app/. A new file that
// publishes a document type is covered the day it is added, without anyone remembering to edit this line —
// which is the property the fixed list did not have.
const SOURCES = [
  'scripts/gateway.mjs',
  ...readdirSync(join(ROOT, 'src')).filter(f => /\.(src\.js|mjs)$/.test(f)).map(f => 'src/' + f),
  ...readdirSync(join(ROOT, 'app')).filter(f => f.endsWith('.jsx')).map(f => 'app/' + f),
];

const literals = (src) => new Set(
  [...src.matchAll(/'((?:trinityone|finance)\/[a-z0-9-]+:?)'/g)].map(m => m[1]));

// The RELAY's vocabulary is no longer literals in gateway.mjs — the spine imports it from this registry (the
// rec-2 wiring, 2026-07-30), so gateway.mjs contains almost no d-tag strings any more. Reading only its
// literals would make every client type look ungated, and this file's "types with NO relay rule" check would
// fire on all of them. The relay knows a type if it is still written inline, OR if it takes the name from the
// registry — but only for the names it ACTUALLY REFERENCES.
//
// `...Object.values(REG_D)` used to credit the WHOLE registry here, on the reasoning that the relay's spine
// takes its vocabulary from D. That reasoning is one step short: adding an entry to D does not make the relay
// use it, and this set is what "the types with NO relay rule" below subtracts from. So merely NAMING a type in
// the registry was enough to convince the guard that the relay gated it.
//
// That is not hypothetical. `trinityone/voice:` — the by-line under a church notice — was declared write:'church',
// given no branch in accept(), and shipped. It fell to the member catch-all, where any member of any church on
// the box could replace another congregation's by-lines. This guard, written precisely to catch a type nobody
// gave a rule to, reported green on it. Credit only what the relay names.
const REG_USED = new Set([...GATEWAY.matchAll(/\bD\.([A-Z_0-9]+)/g)].map(m => REG_D[m[1]]).filter(Boolean));
const G = new Set([...literals(GATEWAY), ...REG_USED]);
const F = literals(FELLOWSHIP), S = literals(STEWARD);

// Strings in the `trinityone/…` namespace that are NOT document types. Widening the scan to the whole tree
// turned one up immediately, and declaring it would have made the registry describe something that never
// touches a relay — a different way for the list to lie about what it covers.
//
// This is an exception list, not a denylist doing a default-deny's job: anything NOT named here still has to
// be declared or the test fails. Each entry carries the reason it is not a document, the same discipline
// no-internal-docs.test.mjs uses for SERVE_OK.
const NOT_A_DOC_TYPE = Object.freeze({
  'trinityone/xfer': 'src/identity.src.js — phone-to-phone account transfer. Two uses, neither a d-tag: a ' +
    'hash domain-separator ("trinityone/xfer/sas/v2\\n…") and the `t` field of the QR payload ' +
    '{v:1, t:"trinityone/xfer", s, c}. The transfer happens over a QR code between two devices; nothing is ' +
    'ever published, and gateway.mjs has no "xfer" anywhere.',
});

// The union across everything that publishes or gates a document type.
const EVERYWHERE = new Map();   // prefix -> the files that use it, so a failure names where to look
const CLIENTS = new Set();      // the same, minus the relay — "used by a client, gated by nobody"
for (const f of SOURCES) {
  for (const p of literals(read(f))) {
    if (p in NOT_A_DOC_TYPE) continue;
    if (!EVERYWHERE.has(p)) EVERYWHERE.set(p, []);
    EVERYWHERE.get(p).push(f);
    if (f !== 'scripts/gateway.mjs') CLIENTS.add(p);
  }
}

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

// ── and every d-tag ANYWHERE ELSE, which is where the registry was blind ─────────────────────────────────
// A6. The three tests above ask about the three files the registry was built from, so they can only ever
// confirm what it already knows. This one asks the whole tree.
test('every d-tag used ANYWHERE in the app is declared', () => {
  const missing = [...EVERYWHERE.keys()].filter(p => !describeDoc(p)).sort()
    .map(p => p + '  (' + EVERYWHERE.get(p).join(', ') + ')');
  assert.deepEqual(missing, [],
    'these document types are published or gated by shipped code and NOTHING declares them — not even as\n' +
    '    knowingly-undeclared. They will inherit a generic relay rule that nobody chose for them, which is\n' +
    '    exactly how SECURITY-AUDIT-2026-07-20 C1 happened. Declare them in scripts/trinity-doc-types.mjs.');
});

test('every gatedBy claim is true — the named rule really is in the gateway', () => {
  // A declaration that says "the relay handles this, honestly" is worth nothing unless the rule it names can
  // be found. Otherwise `gatedBy` becomes the easy way to silence the test above.
  const claims = Object.entries(DOC_TYPES).filter(([, d]) => d.gatedBy);
  assert.ok(claims.length > 0, 'no gatedBy claims at all — if they were removed, the test above must be rechecked');
  const unfounded = claims.filter(([, d]) => !GATEWAY.includes(d.gatedBy)).map(([p, d]) => p + ' claims: ' + d.gatedBy);
  assert.deepEqual(unfounded, [],
    'these declarations name a relay rule that does not exist in scripts/gateway.mjs. Either the rule was ' +
    'changed and the declaration is now stale, or the claim was never true — and it is the only thing ' +
    'stopping these types being reported as ungated');
});

test('the scan actually reaches beyond the three original files', () => {
  // Guards the guard. If SOURCES silently narrowed back to gateway+2 engines — a bad glob, a moved file —
  // every assertion above would keep passing while covering nothing new, which is the failure this fixes.
  assert.ok(SOURCES.length > 30, 'the source scan collapsed to ' + SOURCES.length + ' files; it is not reading the tree');
  assert.ok(SOURCES.some(f => f.startsWith('app/')), 'no app/ screens are scanned — app/stew-finance.jsx owns three document types');
  assert.ok(SOURCES.some(f => f === 'src/mydata.src.js'), 'src/mydata.src.js is not scanned — it owns six, and they publish to every relay');
  // and the pattern must still admit digits + hyphens, which the original [a-z-]+ did not
  assert.ok(literals("x = 'trinityone/manna-fund:'").has('trinityone/manna-fund:'), 'hyphenated types are invisible to the pattern');
  assert.ok(literals("x = 'trinityone/nip04test:'").has('trinityone/nip04test:'), 'a type with a digit in its name is invisible to the pattern');
});

test('the registry has no dead entries', () => {
  // A declaration for a type nobody uses is worse than none: it reads as coverage.
  // A6: was `new Set([...G, ...F, ...S])`, so a type declared for a file outside those three counted as dead.
  const used = new Set(EVERYWHERE.keys());
  const dead = ALL_PREFIXES.filter(p => !used.has(p)).sort();
  assert.deepEqual(dead, [], 'declared but used nowhere — remove them, or the registry starts lying about coverage');
});

test('the types with NO relay rule are exactly the ones we know about', () => {
  // This is the finding that made the registry worth writing. If a new one appears, someone chose a policy
  // by accident — the generic fallthrough — and this test is where they find out.
  // A6: was `new Set([...F, ...S])` — the two big engines only — so a type used by mydata/manna/a screen and
  // gated by nobody was invisible to the very test written to catch that.
  //
  // "The relay knows this type" cannot just mean "its literal appears in gateway.mjs" once the scan is this
  // wide. Some types are gated by a PREFIX rule (`d.startsWith('finance/')`) or by a general one (canRead's
  // "your own event is always readable by you"), so their names never appear there at all. A declaration may
  // say how, via `gatedBy` — and that claim is VERIFIED against the gateway source below, so it cannot become
  // a comfortable fiction.
  const noRelayRule = [...CLIENTS].filter(p => !G.has(p) && !(describeDoc(p) || {}).gatedBy).sort();
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
