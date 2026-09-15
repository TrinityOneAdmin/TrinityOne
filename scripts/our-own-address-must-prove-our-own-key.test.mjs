// A BOX ANSWERING AT AN ADDRESS WE SHIP MUST PROVE A KEY WE SHIP — WHATEVER SPELLING IT IS DIALLED BY.
// Run: node --test scripts/our-own-address-must-prove-our-own-key.test.mjs
//
// reference/RELAY-ADMISSION.md: the pins are diagnostics now, "plus ONE REFUSAL, which is not a diagnostic:
// a box answering at an address we SHIP must prove one of the keys we ship". That refusal is what survives a
// compelled or seized `app.trinityone.church` — a replacement machine at our own name is turned away.
//
// ⚠ THERE WAS NO TEST OF IT AT ALL. Audit, 2026-09-14: 420 test files, and not one stages a box at a shipped
// address with a non-shipped key. That is why the gap below shipped and why this file exists BEFORE the fix.
//
// THE GAP, measured: one decision used TWO normalisers.
//   `isSharedAddress` compares with `normalizeURL`, which KEEPS the scheme and the query string.
//   the possession proof compares with `relayAddrKey`, which DROPS both.
// So `…/relay?x=1` and `ws://…/relay` are the SAME address for getting a valid proof and a DIFFERENT address
// for the refusal. Confirmed against the live production relay: the query-decorated form gets a real 200.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeURL } from 'nostr-tools/utils';
import { verifyEvent } from 'nostr-tools/pure';
import { fnBody, stmt } from './test-slice.mjs';

// The shipped predicate, lifted out of the bundle esbuild ships (rule 3's sound case).
function core(file) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const body = [
    stmt(src, 'var SHARED_RELAY_KEYS = ', 'SHARED_RELAY_KEYS'),
    stmt(src, 'var SHARED_RELAY_HINTS = ', 'SHARED_RELAY_HINTS'),
    stmt(src, 'var CANONICAL_RELAY_PUBS = ', 'CANONICAL_RELAY_PUBS'),
    stmt(src, 'var RELAY_NET_D = ', 'RELAY_NET_D'),
    fnBody(src, 'function isSharedAddress', 'isSharedAddress'),
    fnBody(src, 'function sharedRelayKeys', 'sharedRelayKeys'),
    fnBody(src, 'function _relayKey', '_relayKey'),
    stmt(src, 'var _isHex64 = ', '_isHex64'),
    fnBody(src, 'function canonicalPinsFor', 'canonicalPinsFor'),
    fnBody(src, 'function parseRelayNet', 'parseRelayNet'),
    fnBody(src, 'function _originKey', '_originKey'),
    fnBody(src, 'function sameOriginRelay', 'sameOriginRelay'),
    // `sameOriginRelay` calls it; without it the lift throws and every case is refused for the wrong reason.
    fnBody(src, 'function relayHttpBase', 'relayHttpBase'),
    // `_relayKey` calls it. ⚠ WITHOUT IT THE TEST GOES WORSE-THAN-BLIND: `_relayKey`'s catch swallows the
    // ReferenceError and returns the raw string, so `isSharedAddress` matches nothing, the refusal never
    // fires, and EVERY spelling is admitted — a missing lift reported as a bigger bug than exists.
    fnBody(src, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(src, 'async function proveRelay', 'proveRelay'),
  ].join('\n');
  assert.match(body, /verify \|\| verifyRelayIdentity/, file + ': the lift no longer contains the possession proof');
  return new Function('verifyEvent', 'verifyEvent2', 'normalizeURL', 'normalizeURL2', 'fetch',
    body + '\nreturn { proveRelay, isSharedAddress, CANONICAL_RELAY_PUBS };'
  )(verifyEvent, verifyEvent, normalizeURL, normalizeURL, globalThis.fetch);
}

const OURS = 'wss://app.trinityone.church/relay';
const SHIPPED_KEY = 'a'.repeat(64);     // a key we ship, staged through the pin map
const IMPOSTOR    = 'b'.repeat(64);     // a replacement box: proves possession of a key we do NOT ship
// Every spelling of OUR OWN address a caller could dial. Each gets a valid possession proof, because the
// proof's own normaliser treats them all as the same address.
const SPELLINGS = [
  OURS,
  OURS + '?x=1',                         // a query string
  'ws://app.trinityone.church/relay',    // the other scheme
  OURS + '/',                            // a trailing slash
];

// A box that genuinely holds `key` at whatever address it is dialled by.
const boxHolding = (key) => async (url) => ({ relayPub: key, url });
// ⚠ `proveRelay(cp, url, deps)` — THE CHURCH COMES FIRST. My first version passed the url first, so every
// call proved nothing and was refused: the two gap tests passed VACUOUSLY while the two re-anchors failed,
// which is precisely how a blind test announces itself. The re-anchors are the reason it was caught.
const CHURCH = 'c'.repeat(64);
const prove = (api, url, key, pins) => api.proveRelay(CHURCH, url, { pins, verify: boxHolding(key) });

for (const [file] of [['vendor/fellowship.js'], ['vendor/steward.js']]) {
  const api = core(file);
  // ⚠ KEYED BY THE FULL URL, exactly as CANONICAL_RELAY_PUBS is — `Object.fromEntries(SHARED_RELAY_HINTS
  // .map(u => [u, SHARED_RELAY_KEYS]))`. My first fixture keyed it by HOST, so `isSharedAddress` matched
  // nothing and the refusal never fired: the test then reported the gap as far worse than it is.
  const pins = { [OURS]: [SHIPPED_KEY] };

  test(`${file}: a REPLACEMENT box at our own address is refused`, async () => {
    const r = await prove(api, OURS, IMPOSTOR, pins);
    assert.ok(!r || !r.root, 'A BOX PROVING A KEY WE DO NOT SHIP WAS ADMITTED AT OUR OWN ADDRESS. That is ' +
      'the fleet-wide compromise the refusal exists to prevent. Got: ' + JSON.stringify(r));
  });

  test(`${file}: …AND BY EVERY SPELLING OF THAT ADDRESS — the gap`, async () => {
    const admitted = [];
    for (const u of SPELLINGS) {
      const r = await prove(api, u, IMPOSTOR, pins);
      if (r && r.root) admitted.push(u + ' -> ' + r.root);
    }
    assert.deepEqual(admitted, [],
      'A REPLACEMENT BOX AT OUR OWN ADDRESS WAS ADMITTED BY A VARIANT SPELLING. The proof and the refusal ' +
      'compare addresses two different ways, so decorating our address skips the one check that protects ' +
      'it. Admitted: ' + JSON.stringify(admitted, null, 1));
  });

  test(`${file}: a GENUINE canonical relay is still admitted, by every spelling`, async () => {
    // The re-anchor. A refusal that turned away our own relays would be worse than the gap.
    for (const u of SPELLINGS) {
      const r = await prove(api, u, SHIPPED_KEY, pins);
      assert.ok(r && r.root, 'OUR OWN RELAY WAS REFUSED at ' + u + ' — got ' + JSON.stringify(r));
    }
  });

  test(`${file}: a church's OWN box is untouched by any of this`, async () => {
    // The refusal is about OUR addresses only. A self-hosting church must still be admitted on its own
    // proof, which is the whole of rule 10's other direction.
    const r = await prove(api, 'wss://stchads.example.ts.net/relay', IMPOSTOR, pins);
    assert.ok(r && r.root, 'A SELF-HOSTING CHURCH WAS REFUSED — the refusal has leaked beyond our own ' +
      'addresses, which cuts congregations off from their own machines. Got: ' + JSON.stringify(r));
  });
}
