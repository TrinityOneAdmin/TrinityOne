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
// ANCHOR ON THE DECLARATION, not the bare name. `body('setAdmitted(')` finds the first textual match, and
// once anything CALLS setAdmitted before it is declared — as reseatMember now does, carrying a member's seat
// across — that match is the call site and the guard silently checks the wrong function. This file exists to
// prove a `_requireTrustedView` is present; an anchor that can drift onto a caller would pass while the guard
// it names had been deleted. AUDIT 2026-08-02, caught by this test failing on exactly that change.
const WHOLE_LIST_WRITERS = [
  ['setBlocked', 'every banned member is silently unbanned'],
  ['setNoPhoto', 'photo suppression is lifted for every child'],
  ['setMinors', 'every other child stops being a minor — the relay stops blocking adult↔minor DMs'],
  ['setApproved', 'every youth-cleared adult loses clearance', 'setApproved(pubkeys, opts)'],
  ['setGuardians', 'every parent↔child link is dropped', 'setGuardians(links)'],
  ['setAdmitted', 'the whole congregation returns to "waiting for approval"', 'setAdmitted(pubkeys)'],
  ['setStewards', 'every delegated steward is revoked', 'setStewards(pubkeys, caps, names)'],   // caps: what each steward may do
];

for (const [name, consequence, decl] of WHOLE_LIST_WRITERS) {
  test(`${name} refuses to publish from an untrusted view`, () => {
    assert.match(body(decl || (name + '('), BUNDLE), /_requireTrustedView/,
      `${name} replaces the whole list. Without the guard, editing one entry while the relay is ` +
      `unreachable/unauthenticated publishes a list built from an EMPTY read: ${consequence}. Permanent.`);
  });
}

test('the media key is not minted from an untrusted view', () => {
  assert.match(body('mediaEncryptor(', BUNDLE), /_isRelayAuthed\(\)/,
    'minting a second media key makes every previously-encrypted sermon undecryptable, for the church and ' +
    'every member, forever');
});

test('…nor before the console has actually LOOKED for an existing envelope', () => {
  // AUTHENTICATION IS NOT AN ANSWER. NIP-42 auth is one round trip; the church's document corpus is not. A
  // console restored from the 12 words can be authenticated and writing while the media-key envelope is still
  // in flight — and on that link it minted a fresh key and replaced the church's envelope, destroying every
  // sermon the church had ever encrypted. Reproduced deterministically by holding the envelope back 30s.
  // The care key has carried this flag since AUDIT-2026-07-24; the media key is the same bug verbatim.
  assert.match(body('mediaEncryptor(', BUNDLE), /_mediaKeyChecked/,
    'mediaEncryptor mints when it has no key and the relay is merely AUTHENTICATED. It must also have '
    + 'positively observed that no envelope exists — otherwise a slow link mints over the church\'s archive.');
  assert.match(body('subscribeMediaKey(', BUNDLE), /oneose\(\)\s*\{\s*_mediaKeyChecked = true/,
    'nothing ever sets _mediaKeyChecked, so the guard above can never open and encrypted uploads are blocked '
    + 'for ever — a flag that is only ever false is not a fix');
});

test('an envelope arriving late does not discard a key this device already holds', () => {
  // The other half of the same loss. If this console minted a key and the church's real envelope arrives
  // afterwards, replacing the ring outright orphans whatever was encrypted in that window. Rotation must
  // never drop a key that has already sealed something.
  assert.match(body('subscribeMediaKey(', BUNDLE), /_mediaKeyRing\.filter/,
    'subscribeMediaKey overwrites the ring with whatever the envelope carries, so anything this device '
    + 'encrypted before the envelope arrived becomes undecryptable');
});

test('an encrypted group key is not minted from an untrusted view', () => {
  assert.match(body('publishGroupKey(', BUNDLE), /_isRelayAuthed\(\)/,
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

test('the trusted-view signal is a real auth, not a constant — and it cannot outlive the socket', () => {
  // HANDOFF-2026-07-31 (5). This asserted a boolean `_relayAuthed = true`, and that boolean was the bug: set
  // on the first signed challenge, never cleared, still true with the relay killed. The signal is now derived
  // from the pool — "are we connected to a relay we authenticated to" — so it expires by itself when the
  // socket goes. Same invariant, one more clause: it must be able to become false again.
  const at = BUNDLE.indexOf('pool.automaticallyAuth =');
  assert.notEqual(at, -1, 'the NIP-42 auth hook is missing');
  assert.match(BUNDLE.slice(at, at + 500), /_authedRelays\.set\(/,
    'the authenticated relay must be recorded where the auth event is signed');
  assert.doesNotMatch(BUNDLE, /_authedRelays = new (?:Set|Map)\(\[[^\]]/,
    'it must start empty, or it asserts an auth that never happened');
  const isAuthed = body('function _isRelayAuthed(', BUNDLE);
  const q = isAuthed.indexOf('listConnectionStatus()'), yes = isAuthed.indexOf('return true');
  assert.ok(q !== -1 && (yes === -1 || q < yes),
    'the signal returns true without asking whether the relay is still connected, so a dropped socket leaves ' +
    'every mint gate and list write open — the never-cleared flag, back again. (Behaviour is driven against a ' +
    'real relay in scripts/console-relay-auth-state.test.mjs.)');
});
