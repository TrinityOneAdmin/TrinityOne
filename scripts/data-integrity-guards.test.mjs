// Guards that stop "the relay returned nothing" being mistaken for "this church has nothing".
// Run: node --test scripts/data-integrity-guards.test.mjs
//
// WHY. Every private church document is withheld from an unauthenticated or unreachable relay by returning an
// ordinary EMPTY result — byte-identical to the answer for a church that genuinely has no such document. Any
// code that reacts to "empty" by WRITING destroys data, because kind-30078 docs are replaceable and the old
// version is hard-deleted. This really happened on 2026-07-24: a console reloaded during a relay restart
// minted a throwaway care key and sealed a need with it; those details are unrecoverable.
//
// The same shape was then found in five more places (audit, same day). Each is now gated on having completed a
// genuine NIP-42 auth before concluding absence. This file asserts those gates are still present in the
// SHIPPED bundle (vendor/steward.js) and in the console source — structural, like steward-newest-wins and
// care-key-mint; it proves the guard is in force, not that it is semantically perfect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FINANCE = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');

function body(name, src = BUNDLE) {
  // Find the DEFINITION, not any string that happens to contain the name. `indexOf('setNoPhoto(')` also
  // matches a helper called `_setNoPhoto(` — and then this reads a completely different function and reports
  // correct code as broken. Require a non-identifier character (or start of file) immediately before.
  // AUDIT-2026-07-28.
  const at = (() => {
    let i = -1;
    for (;;) {
      i = src.indexOf(name, i + 1);
      if (i === -1) return -1;
      const prev = i === 0 ? '' : src[i - 1];
      if (!/[A-Za-z0-9_$]/.test(prev)) return i;
    }
  })();
  assert.notEqual(at, -1, `${name} is missing from the shipped code`);
  // Start at the brace that opens the BODY, not the first '{' after the name — a default parameter
  // (`opts = {}`) would otherwise close depth immediately and return an empty body that matches nothing.
  const open = src.indexOf(') {', at) + 2;
  assert.ok(open > 1, `could not find the body of ${name}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail(`could not find the end of ${name}`);
}

// Whole-list replacements: the console republishes the ENTIRE list on every edit, so acting on an empty read
// wipes it. Wiping `minors` is the worst — the relay stops blocking adult↔minor DMs for every child on it.
const WHOLE_LIST_WRITERS = [
  ['setBlocked', 'every banned member is silently unbanned'],
  ['setNoPhoto', 'photo suppression is lifted for every child'],
  ['setMinors', 'every other child stops being a minor — the relay stops blocking adult↔minor DMs'],
  ['setApproved', 'every youth-cleared adult loses clearance'],
  ['setGuardians', 'every parent↔child link is dropped'],
  ['setAdmitted', 'the whole congregation returns to "waiting for approval"'],
  ['setStewards', 'every delegated steward is revoked'],
];

for (const [name, consequence] of WHOLE_LIST_WRITERS) {
  test(`${name} refuses to publish from an untrusted view`, () => {
    assert.match(body(name + '(', BUNDLE), /_requireTrustedView/,
      `${name} replaces the whole list. Without the guard, editing one entry while the relay is ` +
      `unreachable/unauthenticated publishes a list built from an EMPTY read: ${consequence}. Permanent.`);
  });
}

test('the media key is not minted from an untrusted view', () => {
  assert.match(body('mediaEncryptor(', BUNDLE), /_relayAuthed/,
    'minting a second media key makes every previously-encrypted sermon undecryptable, for the church and ' +
    'every member, forever');
});

test('an encrypted group key is not minted from an untrusted view', () => {
  assert.match(body('publishGroupKey(', BUNDLE), /_relayAuthed/,
    'minting over an existing group key orphans that group’s entire encrypted history. The reuseOnly path ' +
    'was already guarded; the interactive "add a member" path was not.');
});

test('the finance book only seeds after an authenticated read', () => {
  const at = FINANCE.indexOf("encSubscribe('finance/'");
  assert.notEqual(at, -1, 'the finance subscription is missing');
  const region = FINANCE.slice(at, at + 1400);
  assert.match(region, /relayAuthed/,
    'seeding republishes finance/settings and finance/account:<id>, which are replaceable — an empty read ' +
    'overwrites the church’s real currency, fiscal year and chart of accounts, and the journal then replays ' +
    'against a chart it no longer matches');
});

test('the trusted-view signal is a real auth, not a constant', () => {
  const at = BUNDLE.indexOf('pool.automaticallyAuth =');
  assert.notEqual(at, -1, 'the NIP-42 auth hook is missing');
  assert.match(BUNDLE.slice(at, at + 400), /_relayAuthed\s*=\s*true/, 'the flag must be set where the auth event is signed');
  assert.doesNotMatch(BUNDLE, /let\s+_relayAuthed\s*=\s*true/, 'it must start false, or it asserts an auth that never happened');
});
