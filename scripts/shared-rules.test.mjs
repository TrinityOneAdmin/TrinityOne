// A rule two surfaces must agree about is written once, and both of them use it.
// Run: node --test scripts/shared-rules.test.mjs
//
// ARCHITECTURE-2026-07-29, recommendation 1. The relay, the member app and the console each implemented the
// trust and safeguarding rules separately, sharing no code. In one session that produced four separate "the
// rule was applied here and not to its neighbour" defects.
//
// Photo suppression is the first rule moved into scripts/trinity-rules.mjs, and it was chosen because the two
// copies HAD ALREADY DRIFTED — measured before the merge:
//
//     member app   _noPhoto.has(pubkey)                 no normalisation on either side
//     console      _noPhoto.has(pubkey.toLowerCase())   normalised on both sides
//
// so a nophoto: list carrying a single upper-case pubkey suppressed the photo on the steward's screen and NOT
// on the congregation's phones. A safeguarding control disagreeing with itself, one day after the second copy
// was written.
//
// The tests below therefore check two different things, and both matter: that the rule is CORRECT, and that
// both engines actually go through it rather than keeping a private copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normPub, pubSet, isPhotoSuppressed, suppressPhotoAv } from './trinity-rules.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const UP = 'AB'.repeat(32), LO = UP.toLowerCase(), OTHER = 'cd'.repeat(32);

test('the rule is case-insensitive in BOTH directions — the drift that prompted this', () => {
  assert.equal(isPhotoSuppressed(LO, pubSet([UP])), true, 'an upper-case list entry did not suppress a lower-case lookup');
  assert.equal(isPhotoSuppressed(UP, pubSet([LO])), true, 'a lower-case list entry did not suppress an upper-case lookup');
  assert.equal(isPhotoSuppressed(' ' + LO + ' ', pubSet([LO])), true, 'surrounding whitespace defeated it');
});

test('and it does not over-suppress', () => {
  // The fail-safe direction is to suppress, but suppressing the wrong member is its own bug — every face in
  // the congregation going blank is how a "safe" default becomes a support call.
  assert.equal(isPhotoSuppressed(OTHER, pubSet([LO])), false, 'a member who is not on the list was suppressed');
  assert.equal(isPhotoSuppressed(LO, pubSet([])), false, 'an empty list suppressed somebody');
  assert.equal(isPhotoSuppressed('', pubSet([LO])), false, 'an empty pubkey matched');
  assert.equal(isPhotoSuppressed(null, pubSet([LO])), false);
  assert.equal(isPhotoSuppressed(LO, null), false, 'a missing set must not throw or match');
});

test('junk in the list cannot become a match', () => {
  const s = pubSet([null, undefined, '', '   ', LO]);
  assert.equal(s.size, 1, 'empty entries were kept as real ones');
  assert.equal(isPhotoSuppressed('', s), false);
  assert.equal(normPub(undefined), '');
});

test('a suppressed photo falls back to the member’s own symbol, not to nothing', () => {
  const av = { kind: 'photo', color: '#C2913A', photo: 'data:image/webp;base64,AAAA', symbol: 'dove' };
  const out = suppressPhotoAv(LO, av, pubSet([LO]), () => 'fallback');
  assert.equal(out.kind, 'symbol', 'the photo was not suppressed');
  assert.equal(out.color, '#C2913A', 'their colour was lost — every suppressed member would look identical');
  assert.equal(out.symbol, 'dove', 'their own symbol was discarded in favour of the generated one');
  assert.equal(suppressPhotoAv(LO, { ...av, symbol: undefined }, pubSet([LO]), () => 'generated').symbol, 'generated',
    'with no symbol of their own, the deterministic one must be used');
});

test('a non-photo avatar passes through untouched', () => {
  const sym = { kind: 'symbol', color: '#111', symbol: 'halo' };
  assert.equal(suppressPhotoAv(LO, sym, pubSet([LO])), sym, 'a symbol avatar was needlessly rebuilt');
  assert.equal(suppressPhotoAv(LO, null, pubSet([LO])), null);
});

// ── and both engines must actually GO THROUGH it ─────────────────────────────────────────────────────────
// A shared module nobody imports is worse than none: it reads as agreement while the copies drift on.
test('the member app uses the shared rule, and keeps no private copy', () => {
  const F = read('src/fellowship.src.js');
  assert.match(F, /from '\.\.\/scripts\/trinity-rules\.mjs'/, 'the member app does not import the shared rules');
  assert.match(F, /suppressPhotoAv\(pubkey, av, _noPhoto/, 'it imports them and then does not use them for suppression');
  assert.doesNotMatch(F, /_noPhoto\.has\(/, 'a private, unnormalised lookup is back — this is exactly the drift');
  assert.match(F, /_noPhoto = pubSet\(/, 'the set is still built without the shared normalisation');
});

test('the console uses the shared rule, and keeps no private copy', () => {
  const S = read('src/steward.src.js');
  assert.match(S, /from '\.\.\/scripts\/trinity-rules\.mjs'/, 'the console does not import the shared rules');
  assert.match(S, /isPhotoSuppressed\(memberPub, _noPhoto\)/, 'photoSuppressed no longer defers to the shared rule');
  // Target the set being BUILT FROM A LIST, not the empty `let _noPhoto = new Set();` declaration — my first
  // version matched the declaration and failed against correct code.
  assert.match(S, /_applyNoPhotoList = \(list\) => \{ _noPhoto = pubSet\(list\); \}/,
    'the console builds its suppression set without the shared normalisation');
  assert.doesNotMatch(S, /_noPhoto = new Set\(\(list/, 'the console has its own list-normalising set builder again');
});

test('the shared module stays portable — no imports, no platform APIs', () => {
  // It runs inside two esbuild bundles and, in future, under Node in the relay. Anything platform-specific
  // here breaks one of those quietly.
  const R = read('scripts/trinity-rules.mjs');
  assert.doesNotMatch(R, /^\s*import /m, 'the shared rules gained an import — it must stay dependency-free');
  assert.doesNotMatch(R, /require\(|localStorage|window\.|process\.|node:/, 'a platform API crept into the shared rules');
});

test('both SHIPPED bundles contain it — not just the sources', () => {
  // vendor/ is what actually runs. A source-only assertion would pass with a stale bundle.
  assert.match(read('vendor/fellowship.js'), /suppressPhotoAv/, 'the member bundle is stale — rebuild it');
  assert.match(read('vendor/steward.js'), /isPhotoSuppressed/, 'the console bundle is stale — rebuild it');
});
