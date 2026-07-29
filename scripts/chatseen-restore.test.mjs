// Unread marks must survive a PIN lock — without leaving the church's group names on the device.
// Run: node --test scripts/chatseen-restore.test.mjs
//
// AUDIT-2026-07-28 F17, fixed 2026-07-30. `trinityone.chatSeen` — which messages you have already read —
// lived only in localStorage, and clearCommunityCache (the locked-boot wipe) deletes it with nothing able to
// restore it. So setting a PIN made every conversation read as unread again, for ever.
//
// The fix syncs it through MyData, encrypted and self-sealed, and restores it on unlock. What it deliberately
// does NOT do is make it wipe-exempt like notes/journal/highlights, because the map is keyed by group SLUG
// ('prayer', 'youth', 'life') and the same wipe clears the cached group documents. Keeping it on the device
// would hand a seized locked phone the church's group names — exactly what that wipe exists to prevent.
//
// So there are two invariants here and they pull in opposite directions:
//   1. the local copy IS wiped on a locked boot   (forensic)
//   2. the relay copy is NOT destroyed by that wipe, and restores  (usability)
// Both are asserted below. Getting only one is how this becomes either a leak or a pointless change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const FELLOW = read('src/fellowship.src.js');
const MYDATA = read('src/mydata.src.js');
const MYDATA_BUNDLE = read('vendor/mydata.js');
const FELLOW_BUNDLE = read('vendor/fellowship.js');
const CHAT = read('app/screens-chat.jsx');

// ── invariant 1: the local copy is wiped ─────────────────────────────────────────────────────────────────
// Lift the REAL wipe predicate out of the source and run it. Asserting on the text would not catch the
// mistake I actually made writing this: my first attempt added `k !== '…chatseen'`, which makes a key EXEMPT
// rather than wiping it — the inverse of the intent, and textually indistinguishable from correct.
function liftDoomed() {
  const at = FELLOW.indexOf('    const PREFIXES = [');
  assert.notEqual(at, -1, 'could not find the wipe rule block in clearCommunityCache');
  const end = FELLOW.indexOf('IDENTIFIER.test(k))));', at);
  assert.notEqual(end, -1, 'could not find the end of the wipe predicate — re-anchor this test');
  const block = FELLOW.slice(at, end + 'IDENTIFIER.test(k))));'.length);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}\nreturn doomed;`)();
}

test('the unread marks ARE wiped on a locked boot', () => {
  const doomed = liftDoomed();
  assert.equal(doomed('trinityone.mydata:data/chatseen'), true,
    'the unread marks survive a locked boot. The map is keyed by group SLUG and this same wipe clears the ' +
    'cached group docs — so keeping it hands a seized locked phone the church\'s group names.');
});

test('…but the rest of the member\'s own writing is still kept', () => {
  // The mydata namespace is exempt on purpose. Force-wiping one key must not become force-wiping the lot.
  const doomed = liftDoomed();
  for (const k of ['trinityone.mydata:data/notes', 'trinityone.mydata:data/journal',
    'trinityone.mydata:data/highlights', 'trinityone.mydata:settings', 'trinityone.mydata:seeded']) {
    assert.equal(doomed(k), false, k + ' is now wiped — that is the member\'s own writing, not the church\'s');
  }
});

test('the wipe still does everything it did before', () => {
  // Regression net: I restructured the predicate to add a force-wipe set, and that is exactly the kind of
  // edit that quietly loosens the rest of it.
  const doomed = liftDoomed();
  for (const k of ['trinityone.groups.abc', 'trinityone.members.abc', 'trinityone.docshub.abc',
    'trinityone.care.x', 'trinityone.serv.x', 'trinityone.family', 'trinityone.chatSeen',
    'trinityone.profile' + 'x', 'trinityone.anything.' + 'a'.repeat(64)]) {
    assert.equal(doomed(k), true, k + ' is no longer wiped — the restructure loosened the rule');
  }
  for (const k of ['trinityone.followedChurches', 'trinityone.activeChurch', 'trinityone.outbox',
    'trinityone.outbox.failed', 'trinityone.nostr.mnemonic.enc', 'trinityone.approvedToast.abc',
    'trinityone.readerScale', 'somethingElse']) {
    assert.equal(doomed(k), false, k + ' is now wiped — the restructure tightened the rule and this one costs the member something');
  }
});

// ── invariant 2: the relay copy restores ─────────────────────────────────────────────────────────────────
test('the map branch of reconcile honours the key it was given', () => {
  // THE BUG THIS FIX HAD TO REMOVE FIRST. That branch was hardcoded to the literal 'settings' and ignored
  // `key`, which was invisible while settings was the only map-shaped doc. A second one would have had its
  // remote copy merged into settings and never restored — silently.
  const at = MYDATA.indexOf("if (payload && payload.settings) {");
  assert.notEqual(at, -1, 'the map branch of reconcile is gone');
  const body = MYDATA.slice(at, MYDATA.indexOf('return false;', at));
  assert.match(body, /cache\.getDoc\(key\)/, 'reconcile reads the wrong document — it ignores `key` again');
  assert.match(body, /cache\.putDoc\(key,/, 'reconcile WRITES the wrong document — a second map doc can never restore');
  assert.match(body, /schedulePublish\(key\)/, 'reconcile republishes the wrong document');
  assert.doesNotMatch(body, /getDoc\('settings'\)|putDoc\('settings'/,
    'the literal \'settings\' is back in the map branch — that is the hardcode this fix removed');
});

test('the wire field stays `settings`, so already-published docs still reconcile', () => {
  // Renaming the payload field would orphan every map doc already on every relay. The CACHE KEY was the bug,
  // not the wire name.
  assert.match(MYDATA, /\{ settings: doc \}/, 'the map payload field was renamed — existing remote docs will no longer be recognised');
  assert.match(MYDATA, /if \(payload && payload\.settings\)/, 'the map branch no longer recognises the wire field');
});

test('the unread marks are in the synced set, encrypted', () => {
  const m = MYDATA.match(/'data\/chatseen':\s*\{ d: '([^']+)',\s*priv:\s*(true|false)/);
  assert.ok(m, 'data/chatseen is not in the SYNC map, so nothing is ever published and the fix does nothing');
  assert.equal(m[1], 'trinityone/chatseen', 'unexpected d-tag');
  assert.equal(m[2], 'true', 'the unread marks would publish in CLEARTEXT — the map names the church\'s groups');
});

test('a wiped local copy cannot destroy the relay copy', () => {
  // The anti-clobber guard is what makes wiping safe: startSync only republishes docs that still exist
  // locally, so the empty post-wipe state is never pushed over the richer remote.
  assert.match(MYDATA, /if \(cache\.getDoc\(k\) != null\) schedulePublish\(k\)/,
    'startSync no longer checks that a local doc exists before republishing it. After a locked-boot wipe the ' +
    'empty local view would overwrite the relay copy — destroying the very backup this fix adds.');
});

// ── and the plumbing is actually connected ───────────────────────────────────────────────────────────────
test('the store exposes named-document access, and it goes through the BACKEND', () => {
  // Caught before shipping: the store did NOT expose getDoc/putDoc, only its private backend did. The chat
  // accessors would have fallen through to localStorage, kept working on the device, and synced NOTHING.
  const m = MYDATA.match(/putDoc: function \(key, value\) \{ ([^}]*) \}/);
  assert.ok(m, 'the store does not expose putDoc — a caller cannot write a synced named document');
  assert.match(m[1], /backend\.putDoc\(key, value\)/,
    'putDoc bypasses the backend, so a write is cached locally and never published — the fix would be inert');
  assert.match(MYDATA, /getDoc: function \(key\) \{ return backend\.getDoc\(key\); \}/, 'the store does not expose getDoc');
});

test('the chat screen reads and writes through MyData, not the bare key', () => {
  assert.doesNotMatch(CHAT, /lsGet\('trinityone\.chatSeen'|lsSet\('trinityone\.chatSeen'/,
    'the chat screen still uses the un-synced localStorage key — the marks would never reach the relay');
  assert.match(CHAT, /window\.MyData\.putDoc\(CHATSEEN_KEY/, 'writes no longer go through MyData, so nothing publishes');
  assert.match(CHAT, /window\.MyData\.getDoc\(CHATSEEN_KEY/, 'reads no longer go through MyData');
});

test('BOTH shipped bundles carry it — not just the sources', () => {
  assert.match(MYDATA_BUNDLE, /data\/chatseen/, 'vendor/mydata.js is stale — rebuild it, or the fix is on no phone');
  assert.match(FELLOW_BUNDLE, /mydata:data\/chatseen/, 'vendor/fellowship.js is stale — the wipe carve-out is not shipped');
});
