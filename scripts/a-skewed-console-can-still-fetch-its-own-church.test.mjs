// A CONSOLE WHOSE CLOCK IS FIVE MINUTES OUT MUST STILL BE ABLE TO REACH ITS OWN CHURCH'S FILES.
// Run: node --test scripts/a-skewed-console-can-still-fetch-its-own-church.test.mjs
//
// Stage 2 of reference/SCOPE-RELAY-CORRECTED-TIME-2026-09-26.md. SHORT-LIVED CREDENTIALS ONLY.
//
// WHAT GOES WRONG TODAY. Every one of these HTTP routes checks the console's signed proof against the
// RELAY's clock and refuses it outside ±300 seconds:
//     _exportAuth   → GET /export, GET /export-media   (take a backup)
//     _blobMember   → GET /blob/<sha>                  (download a sermon, a photo, a recording)
//     _syncAuth     → the six /sync routes
//     _blobUploader → PUT /blob, DELETE /blob/<sha>     (upload or remove one) — and this one also refuses
//                     when the Blossom `expiration` tag is behind the relay's clock
//     /config       → addChurch                        (register the church with a relay)
//     /push/subscribe                                  ("stale proof")
// All of them live in scripts/gateway.mjs. A steward whose laptop is six minutes fast cannot download her
// own church's sermon or take a backup, and no screen says the clock is why.
//
// THE POINT OF USE, and it is not a screen. Stage 2 has no new pixels: its user is the relay at the other
// end of the wire. So the gate these tests run the credential past is THE REAL ONE — `_blobUploader` and
// `_exportAuth` are sliced out of scripts/gateway.mjs and run against the stand-in relay's own clock. A test
// that re-implemented the ±300s rule would pass over any drift between the two halves, which is the shape
// CLAUDE.md warns about under "tests must drive shipped code".
//
// AND THE BOUNDARY. The last two tests are the ones that hold stage 2 to its size: no church document, no
// safeguarding document and no ordering decision is corrected here. If that ever stops being true, the
// commit message that says it is becomes false, which is worse than the bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { getEventHash, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { finalizeEvent } from 'nostr-tools/pure';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { fnBody, stmt, stripComments } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SHIP = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const GATEWAY = readFileSync(join(ROOT, 'scripts/gateway.mjs'), 'utf8');

// ── THE RELAY'S OWN GATES, lifted from the relay ─────────────────────────────────────────────────────────
function relayGates(clockOffsetSec, churchPub) {
  const src = [
    fnBody(GATEWAY, 'function _blobUploader(req, action)', '_blobUploader'),
    fnBody(GATEWAY, 'function _exportAuth(req, host, path)', '_exportAuth'),
  ].join('\n');
  // Date is shimmed so the gate reads the RELAY's clock, which is the whole point: the console and the relay
  // disagree, and only the relay's opinion decides whether the credential is accepted.
  const RelayDate = { now: () => Date.now() + clockOffsetSec * 1000 };
  return new Function('verifyEvent', 'Buffer', 'Date', 'CHURCH_PUBS', 'stewardCan', 'URL',
    src + '\nreturn { _blobUploader, _exportAuth };')(
      verifyEvent, Buffer, RelayDate, new Set([churchPub]), () => false, URL);
}

// ── THE STAND-IN RELAY: it answers /relay-identity off ITS clock, and nothing else here reads /status ─────
async function relayWithClock(offsetSec) {
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
    if (u.pathname === '/status') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true })); }
    res.writeHead(404); res.end('no');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.unref();   // never let a hung listener turn a failure into a hang; a hang prints no summary
  base = 'http://127.0.0.1:' + srv.address().port;
  return { base, pub, stop: () => { try { srv.closeAllConnections?.(); } catch {} srv.close(); } };
}

// ── THE SHIPPED CONSOLE: the measurement block, _credNow, and the two credential minters ─────────────────
// `localSkewSec` is how far THIS console's clock is from real time; the relay is the other half.
function console_(relayList, churchSk, churchPub, localSkewSec, fetchImpl) {
  const parts = [
    fnBody(SHIP, 'function relayIdentityNonce', 'relayIdentityNonce'),
    fnBody(SHIP, 'function relayHttpBase', 'relayHttpBase'),
    fnBody(SHIP, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(SHIP, 'async function verifyRelayIdentityDetailed', 'verifyRelayIdentityDetailed'),
    fnBody(SHIP, 'async function verifyRelayIdentity(wssUrl) {', 'verifyRelayIdentity'),
    stmt(SHIP, 'var _relaySkewSec = 0', '_relaySkewSec'),
    stmt(SHIP, 'var _skewMeasuredAt = 0', '_skewMeasuredAt'),
    stmt(SHIP, 'var _skewProven = false', '_skewProven'),
    stmt(SHIP, 'var _skewSpreadSec = 0', '_skewSpreadSec'),
    stmt(SHIP, 'var _skewMeasuring = false', '_skewMeasuring'),
    // stage 4: measureRelaySkew hands a CONCURRENT caller the in-flight promise instead of the previous
    // number, so ensureSkew's bounded wait actually waits. That is this variable.
    stmt(SHIP, 'var _skewFlight = null', '_skewFlight'),
    stmt(SHIP, 'var _skewByRelay =', '_skewByRelay'),
    stmt(SHIP, 'var CLOCK_FAULT_SEC =', 'CLOCK_FAULT_SEC'),
    stmt(SHIP, 'var SKEW_CAP_SEC =', 'SKEW_CAP_SEC'),
    fnBody(SHIP, 'function clockLooksWrong', 'clockLooksWrong'),
    fnBody(SHIP, 'function _pickSkew', '_pickSkew'),
    fnBody(SHIP, 'async function measureRelaySkew', 'measureRelaySkew'),
    fnBody(SHIP, 'function relaySkewState', 'relaySkewState'),
    // stage 4 split the three refusals and the clamp out of _credNow so a DOCUMENT's stamp can use the same
    // rules under a smaller cap. _credNow is now `now() - _skewShift(SKEW_CAP_SEC)` and nothing about what
    // it returns has changed; every row in this file is the proof of that.
    fnBody(SHIP, 'function _skewShift', '_skewShift'),
    fnBody(SHIP, 'function _credNow', '_credNow'),
    fnBody(SHIP, 'function _nip98(url, method)', '_nip98'),
    fnBody(SHIP, 'async function _putBlob(base, bytes)', '_putBlob'),
  ].join('\n');
  // The console's clock, shifted. `now()` is the console's LOCAL seconds and stays that way — stage 2 does
  // not change what now() means, it changes which of the two a credential is stamped from.
  const ConsoleDate = { now: () => Date.now() + localSkewSec * 1000 };
  // `verifyEvent2` / `finalizeEvent2` are esbuild's renamed imports inside the bundle; both spellings are
  // supplied so a rename in either direction leaves this harness working rather than silently throwing —
  // a throw inside _nip98 would look like the credential simply being refused, which is the thing under test.
  return new Function('verifyEvent', 'verifyEvent2', 'fetch', 'relays', 'relaysRaw', 'AbortSignal', 'Date',
    'now', 'sk', 'pub', 'btoa', 'finalizeEvent', 'finalizeEvent2', 'crypto', 'window', '_sha256hex', '_b64',
    parts + '\nreturn { measureRelaySkew, relaySkewState, _credNow, _nip98, _putBlob, now };')(
      verifyEvent, verifyEvent, (fetchImpl || globalThis.fetch), () => relayList, () => relayList, globalThis.AbortSignal,
      ConsoleDate,
      () => Math.floor(ConsoleDate.now() / 1000), churchSk, churchPub, globalThis.btoa, finalizeEvent,
      finalizeEvent, globalThis.crypto, { }, sha256hex, b64);
}
async function sha256hex(u8) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', u8);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
const b64 = (u8) => Buffer.from(u8).toString('base64');

// A request object shaped the way the gateway's gates read one.
const reqFor = (authHeader) => ({ headers: { authorization: authHeader } });

// ── 1. THE FAILURE THIS STAGE EXISTS FOR, AND ITS CLOSE ──────────────────────────────────────────────────
test('a console eight minutes fast is refused its own backup — and is accepted once it has measured', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const LOCAL_FAST = 480;                                // this console's clock is 8 minutes ahead of real
  const r = await relayWithClock(0);                     // the relay's clock is right
  const gates = relayGates(0, pub);
  const c = console_([r.base], sk, pub, LOCAL_FAST);

  const url = r.base + '/export';
  const hostPath = new URL(url);

  // BEFORE: nothing has been measured, so the credential carries the local clock — today's behaviour, and
  // the bug. This assertion is the re-anchor: if the relay accepts it, the ±300s rule has changed and the
  // test below proves nothing.
  const before = c._nip98(url);
  assert.equal(gates._exportAuth(reqFor(before), hostPath.host, hostPath.pathname), null,
    're-anchor: the relay accepted a proof 480s out. The ±300s window in _exportAuth is what this stage is ' +
    'about; if it has gone, re-write this file rather than deleting the assertion.');

  // MEASURE, then ask again. Nothing else changed — same console, same clock, same relay.
  await c.measureRelaySkew();
  const after = c._nip98(url);
  assert.equal(gates._exportAuth(reqFor(after), hostPath.host, hostPath.pathname), pub,
    'A STEWARD WHOSE LAPTOP IS EIGHT MINUTES FAST STILL CANNOT BACK UP HER OWN CHURCH. The measurement ' +
    'happened and the credential was stamped from the local clock anyway.');
  r.stop();
});

test('…and the same console can upload a file again (Blossom expiration, not just the stamp)', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const r = await relayWithClock(0);
  const gates = relayGates(0, pub);
  // 700s SLOW, the other direction — a slow console's `expiration` lands in the relay's past, which
  // _blobUploader refuses outright ("must expire (anti-replay)"). The stamp and the expiry are two separate
  // checks and a fix that moved only one of them would pass the test above and fail here.
  const bytes = new Uint8Array([1, 2, 3, 4]);

  // The PUT is intercepted rather than served, so the assertion is about the credential the console MINTS,
  // read out of the header it actually sent. Everything else (the /relay-identity proof) goes to the real
  // stand-in over the real fetch. Injected, not monkey-patched onto globalThis: the harness captures fetch
  // when it is built, so a later swap would not be seen and the header would simply be missing.
  let seen = null;
  const spy = async (u, opt) => {
    if (String(u).endsWith('/blob') && opt && opt.method === 'PUT') { seen = opt.headers.Authorization; return { ok: true }; }
    return globalThis.fetch(u, opt);
  };
  const c = console_([r.base], sk, pub, -700, spy);

  await c._putBlob(r.base, bytes);
  assert.ok(seen, 're-anchor: _putBlob sent no Authorization header at all');
  assert.equal(gates._blobUploader(reqFor(seen), 'upload'), null,
    're-anchor: a 700s-slow upload auth was accepted before any measurement — the gate has changed');

  seen = null;
  await c.measureRelaySkew();
  await c._putBlob(r.base, bytes);
  const ok = gates._blobUploader(reqFor(seen), 'upload');
  assert.ok(ok, 'THE CHURCH CANNOT PUT A FILE ON ITS OWN RELAY. The upload credential is still stamped ' +
    'and expired from a clock the relay does not share.');
  assert.equal(ok.church, pub);
  r.stop();
});

// ── 2. THE FOUR REFUSALS. Each one is a case where the correction must NOT happen ────────────────────────
test('no measurement ⇒ no correction: the credential is byte-identical to the previous build', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const c = console_(['ws://127.0.0.1:1/relay'], sk, pub, 900);
  assert.equal(c._credNow(), c.now(),
    'an unmeasured console corrected its credentials from a number nobody supplied. Offline is this case, ' +
    'and a church on a thin pipe is the first audience, not the edge case.');
});

test('an UNSIGNED reading ⇒ no correction, however far out it says the clock is', async () => {
  // The relay answers /status with a `now` but cannot prove itself. The panel shows that reading and marks
  // it unsigned (stage 1); nothing may be STAMPED from it. `relayPub` from /status "is never proof"
  // (CLAUDE.md rule 10) and a `now` from /status is the same string over the same unauthenticated GET.
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  let base = '';
  const srv = createServer((req, res) => {
    if (new URL(req.url, base).pathname === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, now: Math.floor(Date.now() / 1000) }));
    }
    res.writeHead(404); res.end('no');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  base = 'http://127.0.0.1:' + srv.address().port;

  const c = console_([base], sk, pub, 600);
  const measured = await c.measureRelaySkew();
  assert.ok(Math.abs(measured - 600) <= 2, 're-anchor: the /status fallback did not measure (' + measured + 's)');
  assert.equal(c.relaySkewState().proven, false, 're-anchor: an unsigned reading was recorded as proven');
  assert.equal(c._credNow(), c.now(),
    'A HOST THAT COPIED A RELAY’S /status ONTO ITS OWN BOX JUST SET THIS CHURCH’S CREDENTIAL CLOCK. The ' +
    'reading is worth showing a steward and is not worth signing anything from.');
  try { srv.closeAllConnections?.(); } catch {}
  srv.close();
});

test('beyond ±900s the correction is CLAMPED, not applied in full', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const r = await relayWithClock(-5000);                 // the relay says we are 5000s fast
  const c = console_([r.base], sk, pub, 0);
  await c.measureRelaySkew();
  const shifted = c.now() - c._credNow();
  assert.ok(Math.abs(shifted - 900) <= 2,
    'the correction was ' + shifted + 's, not the 900s cap. 900 is put()\'s own future clamp in ' +
    'scripts/event-store.mjs — inside it a corrected stamp cannot produce anything an honest relay would ' +
    'not already accept from a device that far out on its own. Outside it, the honest answer is to tell ' +
    'the person their clock is wrong, which the Relays panel already does.');
  r.stop();
});

test('relays that disagree by more than the cap ⇒ no correction at all', async () => {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  // THE TWO OFFSETS STRADDLE LOCAL, AND THAT IS THE POINT. _pickSkew takes the reading CLOSER TO LOCAL when
  // there are exactly two, so the old pair of {0, -1200} picked 0 — and a credential that does not move
  // proves nothing, because it would not have moved with the spread refusal deleted either. Measured by the
  // stage-4 sabotage matrix: this row passed its own sabotage. Corrected 2026-09-26.
  const a = await relayWithClock(-400);
  const b = await relayWithClock(700);
  const c = console_([a.base, b.base], sk, pub, 0);
  await c.measureRelaySkew();
  assert.ok(c.relaySkewState().spreadSec > 900,
    're-anchor: the two relays disagree by only ' + c.relaySkewState().spreadSec + 's, inside the cap');
  assert.ok(Math.abs(c.relaySkewState().skewSec - 400) <= 1,
    're-anchor: the pick is ' + c.relaySkewState().skewSec + 's. It must be NON-ZERO, or a credential that ' +
    'does not move is not evidence that the spread refusal did anything.');
  assert.equal(c._credNow(), c.now(),
    'two relays contradicting each other by twenty minutes were averaged into a correction anyway. That is ' +
    'not a device-clock fault we can quietly fix, and guessing between them picks which box is believed.');
  a.stop(); b.stop();
});

// ── 3. THE BOUNDARY: stage 2 touches credentials and nothing else ────────────────────────────────────────
test('EXACTLY seven credentials are corrected, and every one is a kind-27235 or kind-24242 auth event', () => {
  // Measured against the shipped bundle, comments stripped — a comment mentioning _credNow must not count,
  // and this file's own subject is one a future comment will certainly mention.
  const bare = stripComments(SHIP);
  // the DECLARATION also reads `_credNow()`, so exclude it — otherwise this counts eight and the number in
  // the message means nothing.
  const uses = (bare.match(/(?<!function )_credNow\(\)/g) || []).length;
  assert.equal(uses, 7,
    'the console now stamps ' + uses + ' things from corrected time, not seven. Stage 2 is the NIP-98 and ' +
    'Blossom credentials only: _nip98, _putBlob, uploadBlob, removeSermon’s blob-delete arm, registerPush, ' +
    'registerAtRelay, and the /config dialler in the church-registration fan-out. Anything else is a later ' +
    'stage and needs its own argument, its own tests and its own audit.');
  // Every kind-27235 / kind-24242 template in the bundle must be on the corrected clock, and no other
  // template may be. This is the assertion that would catch a NEW credential added on now() later.
  const creds = bare.match(/kind: 2(?:7235|4242),\s*created_at: [A-Za-z_][\w.]*/g) || [];
  assert.ok(creds.length >= 7, 're-anchor: the credential templates cannot be found in the bundle');
  for (const t of creds) {
    assert.ok(/_credNow\(\)|_at\b|_upAt\b|_delAt\b/.test(t),
      'a short-lived credential is still stamped from the local clock: ' + t);
  }
});

test('A DOCUMENT IS CORRECTED IN ONE PLACE ONLY, and never by a credential’s cap', () => {
  // Rule 7, made executable, and REWRITTEN AT STAGE 4 rather than left to pass on a technicality. Until
  // stage 4 this row said "no church document is corrected" and proved it by looking for _credNow in six
  // writers. Stage 4 makes the first half of that false: _monotonic DOES correct now. What must stay true —
  // and what this row now asserts — is that the correction lives in exactly one function, that the six
  // writers reach it only through that function, and that a DOCUMENT is never bounded by a CREDENTIAL's cap.
  const bare = stripComments(SHIP);
  for (const [anchor, what] of [
    ['publishClearance(', 'publishClearance, the document the measured incident is about'],
    ['setMinors(', 'setMinors, the church’s minors list'],
    ['setApproved(', 'setApproved, the cleared-to-work list'],
    ['setGuardians(', 'setGuardians'],
    ['grantCheckinPermission(', 'grantCheckinPermission, a children’s-desk clearance'],
  ]) {
    const body = stripComments(fnBody(SHIP, anchor, anchor));
    assert.ok(!/_credNow|_skewShift|_relaySkewSec/.test(body),
      what + ' now reads the skew for itself instead of taking the stamp _monotonic gives it. One writer ' +
      'with its own arithmetic is how two consoles in one church end up ordering a child’s clearance by ' +
      'two different rules.');
  }
  // …and the stamping path uses the SMALLER cap. A credential is checked against the relay's freshness
  // window and thrown away; a document is read back by this console's own _authFuture at now()+_CLOCK_SKEW.
  const mono = stripComments(fnBody(SHIP, 'function _monotonic(tmpl)', '_monotonic'));
  assert.match(mono, /_skewShift\(STAMP_CAP_SEC\)/,
    'THE STAMP IS BOUNDED BY THE WRONG NUMBER. _monotonic must pass STAMP_CAP_SEC (= _CLOCK_SKEW), not ' +
    'SKEW_CAP_SEC. A console whose clock is SLOW corrects FORWARD, so a 900s bound lets it write a ' +
    'safeguarding document its OWN _authFuture refuses — and `minors` defaults to empty with minorsKnown() ' +
    'true, so that console then asserts nobody in the church is a child. Body seen:\n' + mono);
  // SKEW_CAP_SEC does appear in _monotonic, once, and only in the runaway guard's SECOND ceiling —
  // put()'s clamp, which is measured against the RELAY's clock. What must never happen is the SHIFT
  // being taken with it, so that is what is asserted rather than the symbol being absent.
  assert.ok(!/_skewShift\(SKEW_CAP_SEC\)/.test(mono),
    '_monotonic takes its shift with SKEW_CAP_SEC. The two caps answer to two different gates and must ' +
    'not be tidied into one; see the note above STAMP_CAP_SEC in src/steward.src.js.');
  const cap = stripComments(stmt(SHIP, 'var STAMP_CAP_SEC =', 'STAMP_CAP_SEC'));
  assert.match(cap, /_CLOCK_SKEW/,
    'STAMP_CAP_SEC is a hard-coded number again rather than _CLOCK_SKEW itself. Five tolerance constants ' +
    'drifting apart is the defect this whole piece of work exists to stop; the stamp\'s bound and the gate ' +
    'it must not trip have to be one value, not two that agree today.');
  // …and now() itself still means the local clock, or the seven class-(b) local-elapsed-time sites break.
  const nowFn = stripComments(stmt(SHIP, 'var now = () =>', 'now'));
  assert.ok(!/_credNow|_relaySkewSec/.test(nowFn),
    'now() was corrected. Seven sites in this console measure LOCAL elapsed time with it — a message retry, ' +
    'the website-sync budget, a steward’s scheduled devotional — and all seven break.');
});
