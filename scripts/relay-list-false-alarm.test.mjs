// A REFUSED NIP-65 RELAY LIST MUST NOT TELL A STEWARD THEIR CHURCH KEY IS WRONG.
// Run: node --test scripts/relay-list-false-alarm.test.mjs
//
// Every unlock ended with setKey() firing publishRelayList() — a fire-and-forget kind:10002 nobody asked
// for. The relay's write policy does not store that kind, so it came back "not a member or not permitted
// for this group", and publishErrorMessage() pattern-matches that string into:
//
//   "Changes weren't saved: this relay is set up for a different church. Restore this church's key in
//    Settings, or point the relay at this church."
//
// The relay was saying "I don't keep that kind". The console told the steward they were holding the wrong
// key, stickily, on a healthy church — measured on Emmanuel Baptist minutes after it was created, signed by
// the church's own key (relay/rejected.log, by=a90cf8d0, kind=10002). Round 8 filed it as delegates-only; it
// is every console, every unlock, owner included.
//
// The remedy that banner recommends OVERWRITES THE CHURCH KEY. stew-dashboard's own comment at the media-key
// effect already says so: "its remedy destroys a church key if followed". A steward who believes it, on a
// church that is working perfectly, is one confirmation away from losing it.
//
// publishRelayList itself is Phase-1b groundwork — its own comment says "nothing reads kind:10002 until
// Phase 2" — so the automatic call bought nothing and cost this.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const SRC  = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

test('unlocking does not fire a relay-list publish the relay always refuses', () => {
  const setKey = stripComments(fnBody(SRC, 'function setKey(mnemonic)'));
  assert.equal(/publishRelayList/.test(setKey), false,
    'setKey still publishes a kind:10002 on every unlock. The relay refuses it and the console turns that ' +
    'refusal into "this relay is set up for a different church", whose remedy overwrites the church key.');
});

test('the deliberate republish, after the relay list actually changed, is kept', () => {
  // Removing the call from setKey must not remove the feature: when autoAddRelays changes the list there is
  // a real reason to republish, and Phase 2 will read it.
  assert.match(stripComments(SRC), /publishRelayList\(\)\s*\{/,
    'publishRelayList was deleted outright — Phase 2 federation needs it');
  assert.match(stripComments(SRC), /if \(picks\.length\)[\s\S]{0,120}publishRelayList/,
    'the republish after auto-adding relays was removed too; that one has a genuine trigger');
});

test('a refused kind:10002 is not reported as a wrong-church key', () => {
  // Lifted from the shipped classic script rather than mirrored, so sabotaging the real function fails this.
  const body = fnBody(DASH, 'function publishErrorMessage(');
  const fn = new Function('return (' + body.slice(body.indexOf('function')) + ')')();

  const benign = fn('not a member or not permitted for this group', { kind: 10002 });
  assert.ok(!benign || !benign.wrongChurch,
    'a refused NIP-65 relay list still claims the church key is wrong. The relay declined to STORE A KIND; ' +
    'that says nothing about which church this console holds.');

  // The real case must survive untouched: a refused church DOCUMENT still means what it always meant.
  const real = fn('not a member or not permitted for this group', { kind: 30078 });
  assert.ok(real && real.wrongChurch,
    'a refused church document no longer warns the steward — that is the case the banner exists for');
  assert.ok(real.sticky, 'the genuine warning must still be sticky');
});

test('a reason we do not recognise is quoted, not invented', () => {
  // NIP-20 machine-readable prefixes. A reason WITHOUT one is not "unknown", it is unstructured, and the
  // generic connection message is the right answer there — asserting otherwise was my own mistake, corrected.
  const body = fnBody(DASH, 'function publishErrorMessage(');
  const fn = new Function('return (' + body.slice(body.indexOf('function')) + ')')();
  const out = fn('restricted: this relay only serves its own diocese', { kind: 30078 });
  assert.ok(out && /only serves its own diocese/.test(out.msg),
    'the relay’s own words must reach the steward when we do not recognise the reason');
  assert.equal(out.wrongChurch, false, 'an unrecognised refusal must not be read as a key mismatch');
});
