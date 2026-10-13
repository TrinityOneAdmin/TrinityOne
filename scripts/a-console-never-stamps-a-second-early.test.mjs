// A CONSOLE WHOSE CLOCK AGREES WITH THE RELAY MUST NOT STAMP ITS DOCUMENTS ONE SECOND EARLY.
// Run: node --test scripts/a-console-never-stamps-a-second-early.test.mjs
//
// THE DEFECT. The relay stamps WHOLE seconds (floor of its clock); the console's own reading is fractional.
// measureRelaySkew took Math.round(local_fractional - relay_floor), which is +1 about half the time even with
// two perfectly agreeing clocks, and a document is stamped `second - skew`, so about half of all writes landed
// one second early (audit: 151 of 300). On a same-second tie the lowest event id wins, so an early stamp makes a
// genuinely newer write look older.
//
// POINT OF USE. The measurement is read where it is USED: the shipped measureRelaySkew runs, then the shipped
// _skewShift - the very function _monotonic subtracts from a document's second - gives the stamp. Both are
// lifted from vendor/steward.js (the bundle, where dead code is removed, so this cannot be satisfied by a comment).
// Only the relay's signed proof is supplied, as a relay would sign it: created_at = floor of ITS clock.
//   Sign convention checked too: a SLOW console measures a NEGATIVE skew and its stamps move FORWARD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function consoleAt(getLocalMs, relayOffsetMs, viaStatus) {
  const parts = [
    stmt(SHIP, 'var _relaySkewSec = 0', '_relaySkewSec'),
    stmt(SHIP, 'var _skewMeasuredAt = 0', '_skewMeasuredAt'),
    stmt(SHIP, 'var _skewProven = false', '_skewProven'),
    stmt(SHIP, 'var _skewSpreadSec = 0', '_skewSpreadSec'),
    stmt(SHIP, 'var _skewMeasuring = false', '_skewMeasuring'),
    stmt(SHIP, 'var _skewFlight = null', '_skewFlight'),
    stmt(SHIP, 'var _skewByRelay =', '_skewByRelay'),
    stmt(SHIP, 'var SKEW_CAP_SEC =', 'SKEW_CAP_SEC'),
    fnBody(SHIP, 'function _pickSkew', '_pickSkew'),
    fnBody(SHIP, 'function _skewSecFrom', '_skewSecFrom'),
    fnBody(SHIP, 'async function measureRelaySkew', 'measureRelaySkew'),
    fnBody(SHIP, 'function _skewShift', '_skewShift'),
  ].join('\n');
  const D = { now: () => getLocalMs() };
  // the relay's signed proof: `at` is the relay's own clock, in WHOLE seconds
  const verifyRelayIdentity = async () => viaStatus ? null : ({ at: Math.floor((getLocalMs() - relayOffsetMs) / 1000) });
  return new Function('Date', 'verifyRelayIdentity', 'relays', 'relaysRaw', 'fetch', 'AbortSignal',
    parts + '\nreturn { measureRelaySkew, _skewShift, get skew() { return _relaySkewSec; } };')(
    D, verifyRelayIdentity, () => ['wss://r.example/relay'], () => [],
    async () => ({ ok: true, json: async () => ({ now: Math.floor((getLocalMs() - relayOffsetMs) / 1000) }) }), AbortSignal);
}

// what _monotonic stamps for an unwritten document: the local second, shifted by the measured correction
const stampOf = (c, localMs) => Math.floor(localMs / 1000) - c._skewShift(600);
const relaySecond = (localMs, relayOffsetMs) => Math.floor((localMs - relayOffsetMs) / 1000);

test('two agreeing clocks: across 300 instants the stamp is NEVER earlier than the relay second', async () => {
  let early = 0;
  for (let i = 0; i < 300; i++) {
    const t = 1_800_000_000_000 + i * 337;   // sweeps every fractional second
    let local = t;
    const c = consoleAt(() => local, 0);
    await c.measureRelaySkew();
    assert.equal(typeof c.skew, 'number');
    if (stampOf(c, local) < relaySecond(local, 0)) early++;
  }
  assert.equal(early, 0, 'THE DEFECT: ' + early + ' of 300 stamps landed before the relay\'s own second');
});

test('a console 120.4s SLOW: negative skew, stamps pushed FORWARD, never early', async () => {
  let early = 0, sawNegative = false;
  for (let i = 0; i < 300; i++) {
    const real = 1_800_000_000_000 + i * 337;
    const loc = real - 120_400;   // this console's clock; the relay's is `real`
    const d = consoleAt(() => loc, -120_400);
    await d.measureRelaySkew();
    if (d.skew < 0) sawNegative = true;
    if (stampOf(d, loc) < relaySecond(loc, -120_400)) early++;
  }
  assert.ok(sawNegative, 'a slow console should measure a NEGATIVE skew');
  assert.equal(early, 0, early + ' of 300 stamps from a slow console landed before the relay\'s second');
});

test('the /status fallback (an older relay without a signed time) reports 0 skew for agreeing clocks, never 1', async () => {
  // An unsigned reading is never used to correct a stamp (_skewShift returns 0 unless proven), so what is checked
  // here is the figure the console REPORTS (relaySkewState / clockLooksWrong): two agreeing clocks must read 0.
  let off = 0;
  for (let i = 0; i < 300; i++) {
    const local = 1_800_000_000_000 + i * 337;
    const c = consoleAt(() => local, 0, true);
    await c.measureRelaySkew();
    if (c.skew !== 0) off++;
  }
  assert.equal(off, 0, off + ' of 300 agreeing-clock /status readings reported a skew of a second');
});
