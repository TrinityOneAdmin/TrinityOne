// THE RULES MUST REACH EVERY RELAY THE TRAFFIC THEY GOVERN REACHES.
// Run: node --test scripts/safeguarding-replicates.test.mjs
//
// P0 of the divergent-safeguarding work (see scripts/relay-divergent-safeguarding.test.mjs for the other half).
//
// THE DEFECT. A relay polices a child's messages using that relay's own copy of the church's documents —
// `minors:`, `approved:`, `guardians:`, and the group definition carrying `childsafe`. Those are published by
// the CONSOLE through `publish()`, which is `Promise.any`: it resolves the moment ONE relay accepts, and the
// caller is told it succeeded. Meanwhile the traffic those rules govern is published by MEMBERS' apps through
// `_publishAny`, which fans out to EVERY configured relay.
//
// So the rules land on one relay and the traffic lands on all of them, and any relay that got the traffic but
// not the rules cannot police it. Measured live 2026-08-17: a 12-year-old's message was refused by the relay
// holding her church's minors list, and delivered anyway.
//
// The fix is not new machinery. `_publishToRelays` already exists — "returns the event only when EVERY
// targeted relay accepted" — and was written for exactly this hazard. It was wired to the per-member
// `clearance:` seal and nothing else. The safeguarding LISTS still went out single-accept.
//
// WHY A PARTIAL WRITE MUST BE REPORTED AS FAILURE. A steward who ticks "mark as a child" and sees it succeed
// has been told the protection is in force. If that record reached only one of their church's relays, it is
// in force on one of them. Silence there is worse than an error: the error is recoverable, the false
// reassurance is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const SRC = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// The four documents a relay needs in order to police a church's traffic. Each is named with the reason it
// belongs on this list, so a future reader can judge an addition rather than guess.
const GOVERNING = [
  ['setMinors(pubkeys)', 'who is a child — without it the relay lets a minor post in, and read, an adults-only room'],
  ['setApproved(pubkeys, opts)', 'who is cleared for youth — without it the relay cannot tell a vetted adult from any other'],
  ['setGuardians(links)', 'the child→parent map — without it a parent is refused their own child'],
  ['publishGroup(group)', 'carries `childsafe` and the leaders list — without it the relay cannot tell an adults-only room from a youth one'],
  // ADDED 2026-08-18, demonstrated by a red-team insider. A banned member, whose ban reached only ONE of the
  // three relays their app connects to, AUTHENTICATED on the two that lacked the block and read the whole
  // adult group (12 messages). The relay refuses to authenticate a blocked key — but only a relay that HAS
  // the block. Single-accept publishing means most relays never got it.
  ['setBlocked(pubkeys)', 'who is banned — a relay without it authenticates the banned key and serves it everything'],
];

test('every document a relay polices with is published to ALL relays, not the first to answer', () => {
  const bad = [];
  for (const [sig, why] of GOVERNING) {
    const body = stripComments(fnBody(SRC, '  ' + sig + ' {'));
    if (!/_publishToRelays\(/.test(body)) bad.push(`${sig.split('(')[0]} — ${why}`);
  }
  assert.deepEqual(bad, [],
    'these still publish with `publish()` (Promise.any — resolves on the FIRST relay to accept), so the rule ' +
    'can land on one relay while the traffic it governs lands on all of them:\n  ' + bad.join('\n  '));
});

test('…and none of them has quietly kept the single-accept path', () => {
  for (const [sig] of GOVERNING) {
    const body = stripComments(fnBody(SRC, '  ' + sig + ' {'));
    assert.doesNotMatch(body, /return publish\(/,
      `${sig.split('(')[0]} still returns publish() somewhere — a second path that resolves on one ACK ` +
      'defeats the whole change, and it is exactly how this survived the first time');
  }
});

test('a partial write is a FAILURE, not a success', () => {
  const fn = stripComments(fnBody(SRC, 'async function _publishToRelays(evt, urls) {'));
  assert.match(fn, /return accepted === targets\.length \? evt : false;/,
    'all-must-accept is the whole point: a steward told "marked as a child" must not have had that record ' +
    'reach only some of their relays');
  // …and it must not target relays nobody can reach, or every write reports a false alarm.
  assert.match(fn, /const live = _connectedRelays\(\);/,
    'target CONNECTED relays, not merely configured ones — CANONICAL_RELAYS ships a tailnet address most ' +
    'stewards cannot route to, and targeting it would fail every safeguarding write forever (AUDIT-9)');
});

test('the caller can tell, and the steward is told', () => {
  // publish() returns false on total failure and the doc-writing callers already surface that. The all-accept
  // path must be at least as loud, or converting these writes trades a silent partial success for a silent
  // total one.
  const fn = stripComments(fnBody(SRC, 'async function _publishToRelays(evt, urls) {'));
  assert.match(fn, /steward-publish-error/, 'a write nobody accepted must raise the console banner');
  assert.match(fn, /steward-publish-ok/, 'and a good one must clear it');
});

test('the shipped bundle carries it', () => {
  // vendor/steward.js is what the console loads. The source being right proves nothing until it is built.
  // fnBody rather than a fixed window: these functions grew when the reasoning above was written into them,
  // and a 400-char slice silently stopped covering the line it was asserting on (caught by test-windows).
  for (const [sig] of GOVERNING) {
    const body = stripComments(fnBody(BUNDLE, '  ' + sig + ' {'));
    assert.match(body, /_publishToRelays\(/,
      `${sig.split('(')[0]} in the BUNDLE still publishes single-accept — rebuild: bash scripts/build-steward.sh`);
  }
});
