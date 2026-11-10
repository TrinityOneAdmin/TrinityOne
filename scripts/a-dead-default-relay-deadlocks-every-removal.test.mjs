// A DEAD DEFAULT RELAY DEADLOCKS EVERY RELAY REMOVAL — and why D0 (dropping the retired
// master-01 ts.net ADDRESS from the shipped defaults) clears it. (CLAUDE.md rules 1, 3, 8.)
//   Run: node --test scripts/a-dead-default-relay-deadlocks-every-removal.test.mjs
//
// THE BUG (diagnosed + audited 2026-11-10). `master-01`
// (wss://trinityone-master-01.tailbeaac0.ts.net/relay) was a RETIRED, permanently-dead Tailscale
// path to the SAME box as a8 (app.trinityone.church), sharing ONE identity key. It shipped as a
// DEFAULT relay. `_readCovers` (the console's "did every relay I asked answer?" gate) excuses the
// relay being removed, but ONLY if it is NOT one of the shipped canonical addresses — a default is
// never excusable, because you are not allowed to "leave" a shared relay. So the dead default stayed
// in `need`, never answered, and `_readCovers` returned false → `unenrolRelayNet` → `{unknown:true}`
// → `dropOutcome` → drop:false → the console REFUSED every relay removal, for ever.
//
// D0 removes the dead master-01 ADDRESS from the defaults (CANONICAL_RELAYS / SHARED_RELAY_HINTS),
// and KEEPS its identity key in SHARED_RELAY_KEYS — a8 still proves that key, and root-3 matches by
// KEY not URL (reference/RELAY-ADMISSION.md trap 2), so no church is stranded. Once master-01 is no
// longer a default, it is no longer asked, so the read covers and removals work.
//
// ── ON INSTRUMENTS (CLAUDE.md rule 3) ────────────────────────────────────────────────────────────
// Both halves below LIFT the real shipped code from vendor/steward.js and RUN it — no text-matching
// of app/*.jsx (which ships unbundled, so `false && ` leaves every word in place). The bundle
// renames nostr-tools' `normalizeURL` to `normalizeURL2`; _readCovers calls it, so the real
// normalizeURL is injected under that bundle name. If it were missing, k() falls back to raw strings
// and the test would silently measure string equality instead of URL coverage — so the instrument is
// guarded first with a read that only coheres when normalizeURL is genuinely working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, deps, stmt } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// The real a8 identity key (SHARED_RELAY_KEYS[0]).
const A8_KEY = '6a4267558c9990d0391b3472bac9735d33a5e99b5c7cb0e49bdece7ea6b770f2';
const A8 = 'wss://app.trinityone.church/relay';
const MASTER01 = 'wss://trinityone-master-01.tailbeaac0.ts.net/relay';   // the retired, dead ts.net path
const FRIEND = 'wss://friend.ts.net/relay';                              // a relay the church added itself

// ── Lift _readCovers and run it with the REAL normalizeURL under its bundle name `normalizeURL2`. ──
// `CANONICAL_RELAY_PUBS` is the second free variable; it is injected so the test controls which
// addresses _readCovers treats as "a default you cannot leave".
function liftReadCovers(canonicalPubs) {
  const body = fnBody(STEWARD, 'function _readCovers(r, leaving, droppable) {', '_readCovers');
  // eslint-disable-next-line no-new-func
  return new Function('normalizeURL2', 'CANONICAL_RELAY_PUBS',
    deps(STEWARD, body, ['normalizeURL2', 'CANONICAL_RELAY_PUBS']) + 'return ' + body)(normalizeURL, canonicalPubs);
}

// A canonical-pubs map that still contains a8 (the shipped shape AFTER D0: master-01 is gone).
const PUBS_AFTER_D0 = { [A8]: [A8_KEY] };
// The pre-D0 shape, for the deadlock demonstration: BOTH addresses were defaults.
const PUBS_BEFORE_D0 = { [A8]: [A8_KEY], [MASTER01]: [A8_KEY] };

const nset = (...urls) => new Set(urls.map(u => { try { return normalizeURL(u); } catch { return u; } }));

test('GUARD: the lifted _readCovers is wired to the real normalizeURL (not a raw-string fallback)', () => {
  const readCovers = liftReadCovers(PUBS_AFTER_D0);
  // The exact trivially-coverable read the brief names: asked == answered, nothing leaving.
  assert.equal(readCovers({ askedUrls: ['wss://x/relay'], answeredUrls: ['wss://x/relay'] }, '', new Set()), true,
    'the instrument cannot even confirm a read where every asked relay answered — do not trust any result below');
  // STRONGER GUARD: a read that coheres ONLY if normalizeURL actually normalises (host-case + trailing
  // slash). If normalizeURL2 silently fell back to raw strings, these two spellings would not match and
  // this would be false — which is exactly the vacuous state the brief warns about.
  assert.equal(readCovers({ askedUrls: ['wss://X.Example/relay'], answeredUrls: ['wss://x.example/relay/'] }, '', new Set()), true,
    'normalizeURL2 is not the real normalizeURL — the test would be measuring raw-string equality, not coverage');
});

test('THE DEADLOCK: a DEAD default (not droppable, not the one leaving) keeps the read uncovered', () => {
  const readCovers = liftReadCovers(PUBS_BEFORE_D0);
  // The church is trying to remove FRIEND (which answered). master-01 is asked but DEAD, and because it
  // is a shipped default it is NOT in the droppable set. a8 answered.
  const read = { askedUrls: [A8, MASTER01, FRIEND], answeredUrls: [A8, FRIEND] };
  assert.equal(readCovers(read, FRIEND, new Set()), false,
    'the dead default did not block the read — if this is true the deadlock does not reproduce and D0 ' +
    'is not motivated by this test');

  // CONTROL A: the same read, same dead relay, but now master-01 is DROPPABLE (a church-added row).
  assert.equal(readCovers(read, FRIEND, nset(MASTER01)), true,
    'a dead relay the caller marked droppable must be excused — the read should cover');

  // CONTROL B: the same read, but master-01 is simply ABSENT (the post-D0 reality — no longer a default,
  // so it is never asked). The read covers and the removal proceeds.
  const readD0 = { askedUrls: [A8, FRIEND], answeredUrls: [A8, FRIEND] };
  assert.equal(readCovers(readD0, FRIEND, new Set()), true,
    'with the dead default gone from the asked set, the read covers and the removal is no longer frozen');
});

test('…and the SAME dead relay, when it is the one being removed, is still refused if it is a default', () => {
  // Leaving the dead relay itself does not help while it is canonical: _readCovers clears `skip` for a
  // canonical leaving url (you cannot "leave" a shared relay), so it is put back into `need` and, being
  // dead, the read stays uncovered. This is the other face of the deadlock.
  const before = liftReadCovers(PUBS_BEFORE_D0);
  const read = { askedUrls: [A8, MASTER01], answeredUrls: [A8] };
  assert.equal(before(read, MASTER01, new Set()), false,
    'a canonical dead relay could be left — the skip-is-cleared-for-canonical rule is not firing');
  // After D0 master-01 is not canonical, so leaving it is honoured and the read covers.
  const after = liftReadCovers(PUBS_AFTER_D0);
  assert.equal(after(read, MASTER01, new Set()), true,
    'after D0 the retired address is an ordinary (droppable) row and leaving it must be honoured');
});

// ── The shipped default set, read from the bundle and exercised at the point of use. ──
// Hand-lift the small known set of relay-net helpers (deps() over-reaches into minified nostr-tools
// vars here). All source comes verbatim from vendor/steward.js; nothing is re-typed.
function liftSharedHelpers() {
  const parts = [
    fnBody(STEWARD, 'function relayAddrKey(u) {', 'relayAddrKey'),
    fnBody(STEWARD, 'function _relayKey(url) {', '_relayKey'),
    stmt(STEWARD, 'var _isHex64 = ', '_isHex64'),
    stmt(STEWARD, 'var SHARED_RELAY_KEYS = ', 'SHARED_RELAY_KEYS'),
    stmt(STEWARD, 'var SHARED_RELAY_HINTS = ', 'SHARED_RELAY_HINTS'),
    stmt(STEWARD, 'var CANONICAL_RELAY_PUBS = ', 'CANONICAL_RELAY_PUBS'),
    fnBody(STEWARD, 'function isSharedAddress(url, pins) {', 'isSharedAddress'),
    fnBody(STEWARD, 'function sharedRelayKeys(pins) {', 'sharedRelayKeys'),
  ];
  // eslint-disable-next-line no-new-func
  return new Function(parts.join('\n') +
    '\nreturn { isSharedAddress, sharedRelayKeys, SHARED_RELAY_HINTS, SHARED_RELAY_KEYS, CANONICAL_RELAY_PUBS };')();
}

test('D0: the master-01 ADDRESS is gone from the shipped defaults, but a8 and its KEY remain', () => {
  const { isSharedAddress, sharedRelayKeys, SHARED_RELAY_HINTS, SHARED_RELAY_KEYS } = liftSharedHelpers();

  // The address is no longer a shipped default hint.
  assert.ok(!SHARED_RELAY_HINTS.includes(MASTER01),
    'the retired master-01 address is still a default hint — D0 did not land in the bundle');
  assert.ok(SHARED_RELAY_HINTS.includes(A8), 'a8 must still ship as a default');

  // The identity key is deliberately KEPT, so a8 (and the box at any address) is still admitted.
  assert.ok(SHARED_RELAY_KEYS.includes(A8_KEY),
    'the shared identity key was dropped — removing the KEY (not just the address) would strand churches');

  // Point of use: isSharedAddress still refuses an impostor at a8, and the a8 key still admits a8.
  assert.equal(isSharedAddress(A8), true, 'a8 is no longer recognised as one of our addresses — the refusal is gone');
  assert.equal(isSharedAddress(MASTER01), false,
    'the retired address is still treated as one of our shipped addresses; it should now be an ordinary address');
  assert.ok(sharedRelayKeys().includes(A8_KEY), 'a8\'s key is no longer among the keys that admit our own box');
});
