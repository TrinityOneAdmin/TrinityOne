// HIDING YOURSELF FROM THE DIRECTORY REACHES PEOPLE WHO HAVE ALREADY SEEN YOU.
// Run: node --test scripts/hiding-reaches-everyone.test.mjs
//
// Obi, a solicitor, refused to trust a screen he could not verify (long sim, session 3):
//   "I could not verify from my own phone that hiding from the directory actually hides me from anyone else.
//    That's the one claim I'd want checked before relying on it."
// He was right. MEASURED end to end: he set hidden, the relay held "hidden":true on his kind-0, and another
// member's app STILL had him not-hidden after a full reload.
//
// The member hub's profile subscription asked only for members whose profile it did not already have. A
// kind-0 is REPLACEABLE, so a later change is delivered only to a subscription still asking — and nobody who
// already knows you is. The arrival handler carries `hidden` correctly; it simply never asks again.
//
// So the control worked for strangers and failed for everyone who was already there. This is Halime's case
// from round 10: her family does not know she attends church, and this is the single control that takes her
// out of a list of named members.
//
// WHY NOT "JUST RE-ASK PERIODICALLY": clearCommunityCache's own note (fellowship.src.js:2064) records that
// gating on "have we asked" replaced a "is there an entry" gate precisely to stop refetch churn. The fix is
// therefore a WIDER LIVE SUBSCRIPTION, not polling — the hub already keeps its profile sub open, so covering
// the whole roster costs one filter and delivers replaceable updates for free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const SRC = stripComments(readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8'));
const hubFn = (() => {
  const i = SRC.indexOf('const refreshProfiles');
  assert.ok(i > 0, 'refreshProfiles not found');
  return SRC.slice(i, SRC.indexOf('\n    const ensureProfile', i));
})();

test('the hub asks about members it already knows, so a later change reaches it', () => {
  assert.equal(/filter\(pk => !\(pk in profiles\)\)/.test(hubFn), false,
    'the profile subscription still asks only for UNKNOWN members, so hiding yourself never reaches anyone ' +
    'who has already seen you');
  assert.match(hubFn, /kinds: \[0\], authors/, 'the subscription must still be by author');
});

test('it does not churn — the subscription reopens only when the roster grows', () => {
  assert.match(hubFn, /lastProfCount|profSubCount/,
    'without a guard this reopens the subscription on every debounce tick, which is the refetch churn the ' +
    'clearCommunityCache note (fellowship.src.js) says the previous gate existed to prevent');
});

test('an arriving profile carries hidden onto the roster entry', () => {
  assert.match(hubFn, /hidden/,
    're-asking achieves nothing unless the arrival updates the row the directory filters on');
});

test('a member restored from cache is still subscribed for', () => {
  // The other half, and the one that would have made the fix above pointless. ensureProfile skipped anyone
  // already in `profiles` — which on a returning member's app is EVERYONE, restored from localStorage on
  // boot. So the widened subscription would have covered nobody who mattered.
  const i = SRC.indexOf('const ensureProfile');
  assert.ok(i > 0, 'ensureProfile not found');
  const fn = SRC.slice(i, SRC.indexOf('\n    const off', i));
  assert.equal(/profAuthors\.has\(pk\) \|\| \(pk in profiles\)/.test(fn), false,
    'ensureProfile still skips members whose profile is cached, so they never enter the subscription');
  assert.match(fn, /profAuthors\.has\(pk\)/, 'it must still skip people already subscribed for');
});
