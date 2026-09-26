// A CONSOLE'S CORRECTED STAMP MUST NEVER BE ONE ITS OWN SCREEN WILL REFUSE.
// Run: node --test scripts/a-slow-console-does-not-write-past-its-own-gate.test.mjs
//
// Stage 4 of reference/SCOPE-RELAY-CORRECTED-TIME-2026-09-26.md. THIS IS THE STAGE THAT MOVES SAFEGUARDING
// DOCUMENTS, and this file is the row that would have caught the defect the scope document would have
// shipped.
//
// WHAT STAGE 4 DOES. _monotonic() stamps a document with the relay's clock instead of this laptop's, so two
// consoles in one church order their writes by one clock. That closes the half of the incident on
// publishClearance that a clock causes: an eleven-minute-fast console wrote {minor:false}, beat the correct
// {minor:true} that followed, the relay answered have-newer, the run reported failed:0, and nothing retried.
//
// THE DEFECT IT NEARLY SHIPPED, and why the cap is 600 and not 900.
//   `_relaySkewSec` is local-minus-relay, so a console whose clock is SLOW measures a NEGATIVE skew and the
//   correction pushes its stamps FORWARD. The scope document's bound was ±900s, because 900 is put()'s own
//   future clamp in scripts/event-store.mjs. But `_authFuture` — the console's OWN receive gate, on its OWN
//   safeguarding subscription — refuses anything past now() + _CLOCK_SKEW, and _CLOCK_SKEW is 600.
//   So a console more than ten minutes slow would have written its minors list, the relay would have stored
//   it, correctly-clocked phones would have read it, and THE WRITING CONSOLE'S OWN SCREEN would have dropped
//   it as future-dated. `minors` starts empty and minorsKnown() falls back to sawEose-while-authed, so that
//   console would then assert "nobody here is a child" rather than admit it did not know.
//   The owner's decision (2026-09-26) is to bound a DOCUMENT's correction by STAMP_CAP_SEC = _CLOCK_SKEW,
//   and to leave SKEW_CAP_SEC = 900 for the short-lived credentials, which no gate on this console reads
//   back. Two numbers, two jobs — and rows 6 and 7 below are what stop somebody tidying them into one.
//
// THE POINT OF USE. Row 3 does not re-implement the gate: `_authFuture` is lifted out of vendor/steward.js
// and run against the stamp the shipped `setMinors` actually minted. A test that re-stated the ±600 rule
// would pass over any drift between the two halves, which is the shape CLAUDE.md warns about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { getEventHash, generateSecretKey, getPublicKey, verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { fnBody, stmt, stripComments } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SHIP = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

// ── A RELAY THAT ANSWERS /relay-identity OFF ITS OWN CLOCK ───────────────────────────────────────────────
// The signed kind-27235 proof is the only clock stage 1 will read; /status's `now` is an unauthenticated
// string and _skewShift refuses to correct from one (row 4).
async function relayAt(offsetSec) {
  const sk = generateSecretKey();
  const pub = getPublicKey(sk);
  let base = '';
  const srv = createServer((req, res) => {
    const u = new URL(req.url, base);
    if (u.pathname === '/relay-identity') {
      const ev = { kind: 27235, pubkey: pub, created_at: Math.floor((Date.now() + offsetSec * 1000) / 1000),
        tags: [['u', 'relay-identity'], ['method', 'GET'], ['nonce', u.searchParams.get('nonce') || ''],
               ['relay', base]], content: '' };
      ev.id = getEventHash(ev);
      ev.sig = bytesToHex(schnorr.sign(hexToBytes(ev.id), sk));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ proof: ev }));
    }
    res.writeHead(404); res.end('no');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.unref();   // a hung listener turns a failure into a hang, and a hang prints no summary
  base = 'http://127.0.0.1:' + srv.address().port;
  return { base, pub, stop: () => { try { srv.closeAllConnections?.(); } catch {} srv.close(); } };
}

// ── THE SHIPPED CONSOLE: the measurement, both caps, the stamp, the gate, and one real writer ────────────
// Nothing that decides a stamp is stubbed. The relay dial and the publish are; everything else is lifted.
function console_(relayList, churchSk, churchPub) {
  const sent = [];
  const parts = [
    fnBody(SHIP, 'function relayIdentityNonce', 'relayIdentityNonce'),
    fnBody(SHIP, 'function relayHttpBase', 'relayHttpBase'),
    fnBody(SHIP, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(SHIP, 'async function verifyRelayIdentity', 'verifyRelayIdentity'),
    stmt(SHIP, 'var _CLOCK_SKEW = ', '_CLOCK_SKEW'),
    stmt(SHIP, 'var _relaySkewSec = 0', '_relaySkewSec'),
    stmt(SHIP, 'var _skewMeasuredAt = 0', '_skewMeasuredAt'),
    stmt(SHIP, 'var _skewProven = false', '_skewProven'),
    stmt(SHIP, 'var _skewSpreadSec = 0', '_skewSpreadSec'),
    stmt(SHIP, 'var _skewMeasuring = false', '_skewMeasuring'),
    stmt(SHIP, 'var _skewFlight = null', '_skewFlight'),
    stmt(SHIP, 'var _skewByRelay =', '_skewByRelay'),
    stmt(SHIP, 'var CLOCK_FAULT_SEC =', 'CLOCK_FAULT_SEC'),
    stmt(SHIP, 'var SKEW_CAP_SEC =', 'SKEW_CAP_SEC'),
    stmt(SHIP, 'var STAMP_CAP_SEC =', 'STAMP_CAP_SEC'),
    stmt(SHIP, 'var SKEW_WAIT_MS =', 'SKEW_WAIT_MS'),
    stmt(SHIP, 'var _skewWaited = false', '_skewWaited'),
    fnBody(SHIP, 'function clockLooksWrong', 'clockLooksWrong'),
    fnBody(SHIP, 'function _pickSkew', '_pickSkew'),
    fnBody(SHIP, 'async function measureRelaySkew', 'measureRelaySkew'),
    fnBody(SHIP, 'function relaySkewState', 'relaySkewState'),
    fnBody(SHIP, 'function _skewShift', '_skewShift'),
    fnBody(SHIP, 'function _credNow', '_credNow'),
    fnBody(SHIP, 'function ensureSkew', 'ensureSkew'),
    fnBody(SHIP, 'function _skewGate', '_skewGate'),
    stmt(SHIP, 'var _lastStamp = ', '_lastStamp'),
    fnBody(SHIP, 'function _monotonic(tmpl)', '_monotonic'),
    // THE GATE, lifted — not restated. This is what makes row 3 a point-of-use test.
    stmt(SHIP, 'var _authFuture = ', '_authFuture'),
    stmt(SHIP, 'var NET = ', 'NET'),
    stmt(SHIP, 'var MINORS_D = ', 'MINORS_D'),
  ].join('\n');
  // …and one real safeguarding writer, so the stamp under test is one the shipped console really minted.
  // It is an object-literal METHOD, so it goes in the `_w` literal below and not in `parts`.
  const writer = fnBody(SHIP, 'setMinors(pubkeys) {', 'setMinors');
  const scope = {
    verifyEvent, verifyEvent2: verifyEvent, fetch: globalThis.fetch,
    relays: () => relayList, relaysRaw: () => relayList,
    AbortSignal: globalThis.AbortSignal, crypto: globalThis.crypto, window: {},
    setTimeout, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, Error, RegExp,
    sk: churchSk, pub: churchPub,
    finalizeEvent, finalizeEvent2: finalizeEvent,
    now: () => Math.floor(Date.now() / 1000),
    _requireTrustedView: () => {},
    _publishToRelays: (evt) => { sent.push(evt); return Promise.resolve(evt); },
  };
  const api = new Function('scope', 'with (scope) {\n' + parts +
    '\nconst _w = { ' + writer + ' };' +
    '\nreturn { measureRelaySkew, relaySkewState, _credNow, _monotonic, _skewShift, _authFuture, ensureSkew,' +
    '         setMinors: (p) => _w.setMinors(p), now, SKEW_CAP_SEC, STAMP_CAP_SEC, _CLOCK_SKEW }; }')(scope);
  return { api, sent };
}

// Stamp a document, from an EXPLICIT base second. Two calls a fraction apart can straddle a second
// boundary under a loaded suite, and a row that compares two stamps would then be measuring the wall
// clock rather than the rule — a flaky safeguarding row teaches the reflex to re-run, which is the one
// reflex this repo cannot afford. `_monotonic` honours tmpl.created_at, so the base is ours to fix.
const stampAt = (c, d, base) => c._monotonic({ kind: 30078, created_at: base, tags: [['d', d], ['t', 'trinityone']], content: '{}' }).created_at;

// ══ 1 · THE BOUND, IN THE DIRECTION THAT MATTERS ══════════════════════════════════════════════════════════
test('1 · a console 700s SLOW corrects by exactly 600 — the cap — and not by 700', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const r = await relayAt(700);                  // the relay is 700s AHEAD of us: we are 700s slow
  const c = console_([r.base], sk, pub).api;

  const t0 = c.now();
  const before = stampAt(c, 'trinityone/x:1', t0);
  assert.equal(before, t0,
    're-anchor: an unmeasured console corrected anyway. Offline must be byte-identical to the last build.');

  await c.measureRelaySkew();
  assert.ok(Math.abs(c.relaySkewState().skewSec + 700) <= 2,
    're-anchor: the measurement did not read -700s (' + c.relaySkewState().skewSec + 's)');
  const shifted = stampAt(c, 'trinityone/x:2', c.now()) - c.now();
  assert.equal(shifted, 600,
    'the stamp moved ' + shifted + 's, not the 600s cap. A document\'s correction is bounded by ' +
    'STAMP_CAP_SEC (= _CLOCK_SKEW), because a SLOW console corrects FORWARD and _authFuture refuses ' +
    'anything past now() + _CLOCK_SKEW on this console\'s own safeguarding subscription.');
  r.stop();
});

test('2 · …and a console 5000s out still corrects by 600, not 900 and not 5000', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const r = await relayAt(5000);
  const c = console_([r.base], sk, pub).api;
  await c.measureRelaySkew();
  const t1 = c.now();
  const shifted = stampAt(c, 'trinityone/x:3', t1) - t1;
  assert.equal(shifted, 600,
    'the stamp moved ' + shifted + 's. Beyond the cap the honest answer is to tell the person their clock ' +
    'is wrong, which the Relays panel already does; it is not to paper over a quarter of an hour.');
  // The same console, same measurement, on a CREDENTIAL: 900, because a credential answers to the relay's
  // freshness window and put()'s clamp, never to _authFuture. If these two ever report the same number,
  // somebody has collapsed the caps.
  const credShift = c.now() - c._credNow();
  assert.equal(credShift, -900,
    'a short-lived credential corrected by ' + (-credShift) + 's, not 900. SKEW_CAP_SEC must stay at ' +
    'put()\'s own future clamp: a credential is checked for freshness by the relay and thrown away.');
  r.stop();
});

// ══ 3 · THE HAZARD ROW. The gate is the shipped one, the stamp is the shipped writer's ════════════════════
test('3 · a slow console\'s OWN safeguarding write is readable by its OWN subscription gate', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  // 1200s slow — twice _CLOCK_SKEW, so an uncapped ±900 correction would put the stamp 900s ahead and
  // _authFuture would refuse it. This is the exact console the defect was about.
  const r = await relayAt(1200);
  const { api: c, sent } = console_([r.base], sk, pub);
  await c.measureRelaySkew();

  const child = 'a'.repeat(64);
  await c.setMinors([child]);
  assert.equal(sent.length, 1, 'setMinors published nothing — this row is measuring nothing');
  const evt = sent[0];
  assert.deepEqual(JSON.parse(evt.content).pubkeys, [child], 're-anchor: that is not the minors document');

  // THE GATE THE CONSOLE ITSELF APPLIES, lifted from the bundle and run on the event the writer minted.
  assert.equal(c._authFuture(evt), false,
    'A CONSOLE TWENTY MINUTES SLOW JUST WROTE A LIST OF CHILDREN THAT ITS OWN SCREEN WILL THROW AWAY.\n' +
    '_authFuture refuses created_at > now() + _CLOCK_SKEW on the console\'s own safeguarding subscription, ' +
    'and the stamp is ' + (evt.created_at - c.now()) + 's ahead. The relay stores it, correctly-clocked ' +
    'phones read it, and this console shows the church as having no children at all — because `minors` ' +
    'starts empty and minorsKnown() falls back to sawEose-while-authed, so it ASSERTS that rather than ' +
    'admitting it does not know. Bound the stamp by STAMP_CAP_SEC (= _CLOCK_SKEW), not SKEW_CAP_SEC.');

  // …and the correction really did happen, or the row above would pass for the wrong reason.
  assert.equal(evt.created_at - c.now(), 600,
    're-anchor: the write was not corrected at all (' + (evt.created_at - c.now()) + 's), so the gate ' +
    'accepting it proves nothing about the cap.');
  r.stop();
});

test('4 · AT the cap the gate still accepts — the boundary is `>`, not `>=`', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const r = await relayAt(1200);
  const c = console_([r.base], sk, pub).api;
  await c.measureRelaySkew();
  const t2 = c.now();
  const at = stampAt(c, 'trinityone/x:4', t2);
  assert.equal(at - t2, 600, 're-anchor: the stamp is not sitting exactly on the cap');
  assert.equal(c._authFuture({ created_at: at }), false,
    'the gate refuses a stamp EXACTLY on the cap, so the two numbers being equal is not enough. Either ' +
    '_authFuture became `>=`, or STAMP_CAP_SEC must be _CLOCK_SKEW - 1. Check which before changing either.');
  assert.equal(c._authFuture({ created_at: at + 1 }), true,
    're-anchor: _authFuture no longer refuses anything, so the row above is vacuous');
  r.stop();
});

// ══ 5 · THE THREE REFUSALS STILL REFUSE, on the document path as well as the credential path ══════════════
test('5 · nothing measured ⇒ the event is byte-identical to the previous build', () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const c = console_(['ws://127.0.0.1:1/relay'], sk, pub).api;
  assert.equal(c._skewShift(c.STAMP_CAP_SEC), 0);
  const t5 = c.now();
  assert.equal(stampAt(c, 'trinityone/x:5', t5), t5,
    'an unmeasured console corrected a DOCUMENT from a number nobody supplied. Offline is this case, and ' +
    'a church on a thin pipe is the first audience, not the edge case.');
});

test('6 · an UNSIGNED reading ⇒ no correction, on a document either', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  let base = '';
  const srv = createServer((req, res) => {
    if (new URL(req.url, base).pathname === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, now: Math.floor(Date.now() / 1000) + 700 }));
    }
    res.writeHead(404); res.end('no');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  base = 'http://127.0.0.1:' + srv.address().port;
  const c = console_([base], sk, pub).api;
  await c.measureRelaySkew();
  assert.equal(c.relaySkewState().proven, false, 're-anchor: an unsigned reading was recorded as proven');
  assert.ok(Math.abs(c.relaySkewState().skewSec + 700) <= 2, 're-anchor: the /status fallback did not read');
  const t6 = c.now();
  assert.equal(stampAt(c, 'trinityone/x:6', t6), t6,
    'A HOST THAT COPIED A RELAY\'S /status ONTO ITS OWN BOX JUST SET THE ORDER OF THIS CHURCH\'S ' +
    'SAFEGUARDING DOCUMENTS. A bare number over an unauthenticated GET is what CLAUDE.md rule 10 refuses ' +
    'for relayPub, and it is worth showing a steward and not worth stamping anything from.');
  try { srv.closeAllConnections?.(); } catch {}
  srv.close();
});

test('7 · relays that disagree by more than the cap ⇒ no correction at all', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  // THE TWO OFFSETS ARE NOT 0 AND 1200, AND THAT MATTERS. _pickSkew takes the reading CLOSER TO LOCAL when
  // there are exactly two, so a pair of {0, 1200} picks 0 — and a stamp that does not move proves nothing,
  // because it would not have moved with the spread refusal deleted either. Measured: with {0, 1200} this
  // row passed its own sabotage. +400 and -700 straddle local, so the pick is -400 (non-zero, and the
  // correction WOULD be 400s) while the spread is 1100 and must refuse it.
  const a = await relayAt(400);
  const b = await relayAt(-700);
  const c = console_([a.base, b.base], sk, pub).api;
  await c.measureRelaySkew();
  assert.ok(c.relaySkewState().spreadSec > 900,
    're-anchor: the two relays disagree by only ' + c.relaySkewState().spreadSec + 's, which is inside the cap');
  assert.ok(Math.abs(c.relaySkewState().skewSec + 400) <= 1,
    're-anchor: the pick is ' + c.relaySkewState().skewSec + 's. It must be NON-ZERO, or a stamp that does ' +
    'not move is not evidence that the spread refusal did anything.');
  const t7 = c.now();
  assert.equal(stampAt(c, 'trinityone/x:7', t7), t7,
    'two relays contradicting each other by twenty minutes were averaged into a correction anyway. That ' +
    'is not a device-clock fault we can quietly fix, and guessing between them picks which box is believed.');
  a.stop(); b.stop();
});

// ══ 8 · §5.3 — _monotonic's memory outlives the correction, and that is the designed behaviour ════════════
test('8 · a correction that moves a stamp BACKWARDS is absorbed by _lastStamp, not applied retroactively', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  // 900s, not 600s: the proof's created_at is FLOORED and the skew is ROUNDED, so a measurement taken at
  // exactly the cap lands on 599 or 600 depending on where in the second the test ran. Beyond the cap the
  // CLAMP decides the number and the row is exact — a safeguarding row that reddens at random teaches the
  // reflex to re-run, which is the one reflex this repo cannot afford.
  const r = await relayAt(-900);                 // the relay is BEHIND us: this console is 900s fast
  const c = console_([r.base], sk, pub).api;
  const d = 'trinityone/x:8';
  const t8 = c.now();
  const first = stampAt(c, d, t8);               // written before the measurement, on the fast clock
  await c.measureRelaySkew();
  const second = stampAt(c, d, t8);              // the SAME second, so only the correction differs
  assert.equal(second, first + 1,
    'the second write was stamped ' + (second - first) + 's after the first. _lastStamp is a per-document ' +
    'high-water mark, so a correction that moves stamps BACKWARDS mid-session cannot take effect on a ' +
    'document this session already wrote — it takes last+1 until real time catches up. That is correct ' +
    'and deliberate (§5.3 of the scope document), and it means the fix is not instantaneous.');
  // …and a document this session has NOT written takes the correction immediately.
  assert.equal(stampAt(c, 'trinityone/x:8b', t8), t8 - 600,
    're-anchor: a fresh document did not take the correction, so the row above is about the wrong thing');
  r.stop();
});

test('8b · STAGE 3 SURVIVES STAGE 4: a corrected console still orders two writes in one second', async () => {
  // The runaway guard has two ceilings since stage 4, and getting them wrong does not look like a broken
  // clamp — it looks like the incident. Written as `nowS + 600` alone, a 600s-fast console stamped its
  // SECOND write of a document 600s BEFORE its first, which the relay drops as have-newer with no banner.
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const r = await relayAt(300);                  // 300s slow: a correction, with headroom under the cap
  const c = console_([r.base], sk, pub).api;
  await c.measureRelaySkew();
  const d = 'trinityone/minors:' + pub;
  const base = c.now();
  const a = stampAt(c, d, base), b = stampAt(c, d, base);
  assert.ok(Math.abs((a - base) - 300) <= 1,
    're-anchor: the first write was corrected by ' + (a - base) + 's, not ~300s, so this row is not ' +
    'about stage 4. (One second of slack: the proof stamp is floored and the skew is rounded.)');
  assert.equal(b, a + 1,
    'two writes of one document in one second tied on a CORRECTED console (' + a + ' then ' + b + '). ' +
    'Stage 3 exists to stop that, and stage 4 must not undo it: the relay breaks a tie by the lowest event ' +
    'id, so half the time the steward\'s later, correcting write is the one thrown away.');
  r.stop();
});

// ══ 9 · THE BOUNDED WAIT ══════════════════════════════════════════════════════════════════════════════════
test('9 · ensureSkew waits ONCE per session, then never delays a write again', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  // Nothing answers, so the measurement never sets _skewMeasuredAt. Without the latch every mark-a-child
  // on an offline console would sit for the full timeout, for ever, with nothing on screen saying why.
  const c = console_(['ws://127.0.0.1:1/relay'], sk, pub).api;
  const t0 = Date.now();
  const w = c.ensureSkew({ timeoutMs: 120 });
  assert.ok(w, 're-anchor: the first call had nothing to wait for, so the latch below proves nothing');
  await w;
  assert.ok(Date.now() - t0 < 3000, 'the bounded wait did not honour its own timeout');
  assert.equal(c.ensureSkew({ timeoutMs: 120 }), null,
    'A CHURCH ON A THIN PIPE PAYS THE TIMEOUT ON EVERY SAFEGUARDING WRITE. ensureSkew must latch after one ' +
    'wait per session: a console with no relay reachable never sets _skewMeasuredAt, so without the latch ' +
    'the wait is not once, it is for ever.');
});

test('10 · a measurement already in flight is AWAITED, not short-circuited with the old number', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const r = await relayAt(700);
  const c = console_([r.base], sk, pub).api;
  // Two callers, the way the boot kick and a steward's first write arrive together.
  const [, second] = await Promise.all([c.measureRelaySkew(), c.measureRelaySkew()]);
  assert.ok(Math.abs(second + 700) <= 2,
    'the concurrent caller got ' + second + ' instead of the measurement it was waiting for. It used to be ' +
    'handed `_relaySkewSec` — the PREVIOUS number, 0 on a fresh console — the instant _skewMeasuring was ' +
    'set, which made ensureSkew\'s bounded wait return in microseconds and buy nothing at all.');
  r.stop();
});

// ══ 11 · RULE 2, MADE EXECUTABLE: the eight writers all take the bounded wait ══════════════════════════════
test('11 · all eight safeguarding writers go through _skewGate, and nothing else does', () => {
  const bare = stripComments(SHIP);
  const EIGHT = [
    ['setMinors(pubkeys) {', 'setMinors'],
    ['setApproved(pubkeys, opts) {', 'setApproved'],
    ['setGuardians(links) {', 'setGuardians'],
    ['setStewards(pubkeys, caps, names) {', 'setStewards'],
    ['async grantCheckinPermission(opts) {', 'grantCheckinPermission'],
    ['revokeCheckinPermission(person) {', 'revokeCheckinPermission'],
    ['async publishCheckinHelpers(opts) {', 'publishCheckinHelpers'],
    ['revokeCheckinHelpers(session) {', 'revokeCheckinHelpers'],
  ];
  for (const [anchor, name] of EIGHT) {
    const body = stripComments(fnBody(SHIP, anchor, name));
    assert.match(body, /_skewGate\(/,
      name + ' no longer takes the bounded wait before its first stamp of a session. The scope document ' +
      'gives it to the eight safeguarding writers and to nothing else: they are user-initiated from a ' +
      'screen, never on the boot path, so a bounded wait is affordable there and nowhere else.');
  }
  // …and to nothing else. Eight uses plus the definition.
  const uses = (bare.match(/_skewGate\(/g) || []).length;
  assert.equal(uses, 9,
    'the console now has ' + uses + ' _skewGate sites (8 writers + 1 definition expected). A bounded wait ' +
    'on a write that is not user-initiated can sit in front of a boot path, which is exactly what the ' +
    'scope document refuses.');
});
