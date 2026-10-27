// RELAY LABEL FOLLOWS THE PROVEN IDENTITY, NOT THE PAGE ADDRESS.
// Run: node --test scripts/a-relay-label-follows-proven-identity.test.mjs
//
// The Relays card used to label a relay Self-hosted vs Shared with `r.url.includes(location.host)` — a test
// against the address the CONSOLE was served from, not the relay's identity. So one physical box reached at
// two addresses showed a different label at each, and a SHARED community relay served at the console's own
// address was labelled "Self-hosted". classifyRelay() decides the label from the identity key the box PROVED
// (via provenRelayPub, read from the C4 verified-identity cache — never /status relayPub).
//
// CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so a text-match on the pill in stew-dashboard.jsx would pass
// even if the feature were deleted. So this LIFTS the real classifyRelay out of the SHIPPED vendor/steward.js
// and RUNS it. If the classifier is removed from the bundle, fnBody throws "missing" and this test fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
// The pure classifier, lifted from the bundle and run. It touches only String/Array/RegExp, so no scope.
const classifyRelay = new Function(fnBody(STEWARD, 'function classifyRelay(info) {', 'classifyRelay') + '\nreturn classifyRelay;')();

// SHARED_RELAY_KEYS[0] from src/relay-net.src.js — the live demo box's key (a canonical/shared relay).
const CANON = '6a4267558c9990d0391b3472bac9735d33a5e99b5c7cb0e49bdece7ea6b770f2';
const OWN_BOX = 'a'.repeat(64);   // a self-hosted box's proven key — NOT canonical, NOT in any church doc
const SIGNED_BOX = 'b'.repeat(64);   // a box this church SIGNED into its relay-net document
const canonicalKeys = [CANON];

test('a canonical (shipped shared) key → Shared', () => {
  assert.equal(classifyRelay({ pub: CANON, isLoopbackOrigin: false, canonicalKeys, churchEntryPubs: [] }), 'shared');
});

test('the loopback-origin own box → Self-hosted (caught by the origin signal, not any document)', () => {
  // This is the case the audit flags: enrolment effectively never runs, so a real own box is absent from the
  // signed list and ONLY the loopback-origin signal identifies it.
  assert.equal(classifyRelay({ pub: OWN_BOX, isLoopbackOrigin: true, canonicalKeys, churchEntryPubs: [] }), 'self');
});

test('a church-signed, non-canonical box → Self-hosted (by its proven key in the relay-net document)', () => {
  assert.equal(classifyRelay({ pub: SIGNED_BOX, isLoopbackOrigin: false, canonicalKeys, churchEntryPubs: [SIGNED_BOX] }), 'self');
});

test('the SAME canonical key at two different URLs → BOTH Shared (the label does not depend on the address)', () => {
  // The two rows are the ONE box reached two ways. URL is not even a parameter of the classifier, so the two
  // rows cannot disagree — which is the whole point of the fix.
  const rowA = classifyRelay({ pub: CANON, isLoopbackOrigin: false, canonicalKeys, churchEntryPubs: [] });
  const rowB = classifyRelay({ pub: CANON, isLoopbackOrigin: true, canonicalKeys, churchEntryPubs: [] });
  assert.equal(rowA, 'shared');
  assert.equal(rowB, 'shared', 'canonical wins over the origin signal: a canonical relay served FROM the console is still Shared');
});

test('an unknown / unproven relay → neutral ("Added"), never guessed as self or shared', () => {
  assert.equal(classifyRelay({ pub: '', isLoopbackOrigin: false, canonicalKeys, churchEntryPubs: [] }), 'neutral');
  assert.equal(classifyRelay({ pub: 'not-hex', isLoopbackOrigin: false, canonicalKeys, churchEntryPubs: [SIGNED_BOX] }), 'neutral');
});

test('precedence: canonical is checked FIRST, even with a loopback-origin flag set', () => {
  assert.equal(classifyRelay({ pub: CANON, isLoopbackOrigin: true, canonicalKeys, churchEntryPubs: [CANON] }), 'shared');
});

test('a non-hex pub on the loopback-origin own box still reads Self-hosted (the origin box is the operator’s own)', () => {
  assert.equal(classifyRelay({ pub: '', isLoopbackOrigin: true, canonicalKeys, churchEntryPubs: [] }), 'self');
});

test('bad input is tolerated — no throw, and a missing key list cannot match (fails to neutral)', () => {
  assert.equal(classifyRelay(), 'neutral');
  assert.equal(classifyRelay({}), 'neutral');
  // null lists coerce to empty: with no canonical list supplied there is nothing to match, so even a real
  // canonical key reads neutral rather than being guessed Shared. The dashboard always supplies the list.
  assert.equal(classifyRelay({ pub: CANON, canonicalKeys: null, churchEntryPubs: null }), 'neutral');
});
