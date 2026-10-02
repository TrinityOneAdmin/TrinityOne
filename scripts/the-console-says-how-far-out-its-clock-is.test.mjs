// A CHURCH MUST BE ABLE TO SEE THE CLOCK THAT DECIDES WHICH OF ITS WRITES WINS.
// Run: node --test scripts/the-console-says-how-far-out-its-clock-is.test.mjs
//
// Stage 1 of reference/SCOPE-RELAY-CORRECTED-TIME-2026-09-26.md. MEASURE ONLY — nothing in THIS change
// corrects a timestamp.
//
// ⚠ THE LAST TEST IN THIS FILE WAS REWRITTEN AT STAGE 4, on purpose and not quietly. It used to assert
// that _monotonic consulted nothing, which is how stage 1 was held to its size. Stage 4 makes that
// false: _monotonic is where the correction now lives. Leaving the row to pass by luck would be worse
// than the bug it guarded, so it now asserts the two things that DID survive — now() is still the local
// clock, and a document's correction is bounded by _CLOCK_SKEW rather than by a credential's cap.
//
// WHY THIS EXISTS. Two machines write the same church document and whichever stamp is LATER wins — and each
// stamp is read off that machine's own clock. A console eleven minutes fast writes `{minor:false}`, the
// correct `{minor:true}` that follows loses because by the clock it is older, the relay answers "a newer
// version is already stored", the run reports `failed: 0`, and nothing ever retries. That is written up on
// publishClearance in src/steward.src.js as a REPRODUCED incident, and the child's app reads "not a minor"
// for ever. Nobody currently knows how far out a real church's clocks are, so this measures and shows it.
//
// FOUR THINGS ARE ASSERTED, and they are deliberately different kinds of claim:
//   1. the SHIPPED engine measures the skew from the SIGNED relay-identity proof
//   2. …and prefers that proof over /status, whose `now` anybody can type (CLAUDE.md rule 10)
//   3. THE POINT OF USE (rule 1): the console's Relays panel shows the measured number. Deleting the line
//      from the panel leaves every engine assertion above green, which is exactly what rule 1 is about.
//   4. now() itself still means the LOCAL clock, and the stamp that does consult the measurement
//      (stage 4's _monotonic) is bounded by the console's own receive gate
//
// ⚠ RULE 3: app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves every word in place and
// a text match still passes. Test 3 RENDERS the panel — with the REAL hook out of app/steward-root.jsx, not
// a stub of it — and reads the number out of the tree. Nothing here matches text in a .jsx file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { getEventHash, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { fnBody, stmt, stripComments } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SHIP = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

// ── a stand-in relay: answers /relay-identity with a correctly signed proof, and /status with whatever ────
// `statusNow` it is told to. The two are separately controllable BECAUSE that is the whole of test 2.
async function standIn({ proofSkew = 0, statusNow = null, answerProof = true } = {}) {
  const sk = generateSecretKey();
  const pub = getPublicKey(sk);
  let base = '';
  const srv = createServer((req, res) => {
    const u = new URL(req.url, base);
    if (u.pathname === '/relay-identity') {
      if (!answerProof) { res.writeHead(404); return res.end('no'); }
      const ev = { kind: 27235, pubkey: pub, created_at: Math.floor(Date.now() / 1000) - proofSkew,
        tags: [['u', 'relay-identity'], ['method', 'GET'], ['nonce', u.searchParams.get('nonce') || ''],
               ['relay', base]], content: '' };
      ev.id = getEventHash(ev);
      ev.sig = bytesToHex(schnorr.sign(hexToBytes(ev.id), sk));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ proof: ev }));
    }
    if (u.pathname === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(statusNow === null ? { ok: true } : { ok: true, now: statusNow }));
    }
    res.writeHead(404); res.end('no');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  // ephemeral port so nothing collides with a relay or a concurrent suite; unref so a listener left open
  // cannot keep the runner alive and turn a failure into a hang (a hang prints no summary and reads green).
  srv.unref();
  base = 'http://127.0.0.1:' + srv.address().port;
  return { base, pub, stop: () => { try { srv.closeAllConnections?.(); } catch {} srv.close(); } };
}

// ── the SHIPPED measurement engine, lifted out of vendor/steward.js ───────────────────────────────────────
// Lifted rather than imported: src/ is not what ships, and a test that reads src proves nothing about the
// console a church runs. Same slicing idiom as the other relay-proof tests in this directory.
function engine(relayList) {
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
    stmt(SHIP, 'var _skewByRelay =', '_skewByRelay'),
    stmt(SHIP, 'var CLOCK_FAULT_SEC =', 'CLOCK_FAULT_SEC'),
    stmt(SHIP, 'var SKEW_CAP_SEC =', 'SKEW_CAP_SEC'),
    fnBody(SHIP, 'function clockLooksWrong', 'clockLooksWrong'),
    fnBody(SHIP, 'function _pickSkew', '_pickSkew'),
    fnBody(SHIP, 'async function measureRelaySkew', 'measureRelaySkew'),
    fnBody(SHIP, 'function relaySkewState', 'relaySkewState'),
  ].join('\n');
  // `verifyEvent2` is esbuild's renamed import inside the bundle; both names are supplied so this keeps
  // working if the rename goes away. A missing one would leave verifyRelayIdentity throwing and every
  // reading silently falling through to the /status branch — which looks exactly like a passing test of
  // the fallback, so it is worth saying out loud.
  return new Function('verifyEvent', 'verifyEvent2', 'fetch', 'relays', 'relaysRaw', 'AbortSignal',
    parts + '\nreturn { measureRelaySkew, relaySkewState, clockLooksWrong, _pickSkew };')(
      verifyEvent, verifyEvent, globalThis.fetch, () => relayList, () => relayList, globalThis.AbortSignal);
}

test('the console measures its clock against the relay’s SIGNED proof', async () => {
  // The relay's proof is stamped 660s BEFORE our clock, i.e. this console is eleven minutes fast — the
  // measured incident's own number.
  const r = await standIn({ proofSkew: 660 });
  const e = engine([r.base]);
  const got = await e.measureRelaySkew();
  assert.ok(Math.abs(got - 660) <= 2,
    'the console cannot tell how far out its clock is (measured ' + got + 's, expected ~660s). Every ' +
    'ordering defect this work exists for is invisible until this number exists.');
  const st = e.relaySkewState();
  assert.equal(st.proven, true, 'the reading was not marked as coming from the signed proof');
  assert.ok(st.measuredAt > 0, 'a measurement that happened is still reported as “never measured”');
  assert.equal(e.clockLooksWrong(), true, '660s out is not flagged as a clock fault (the threshold is 300s)');
  r.stop();
});

test('an unmeasured clock is reported as UNKNOWN, never as a correct one', async () => {
  // Nothing answers. The honest answer is "we do not know" — a screen that paints 0s over silence tells a
  // steward their clock is fine when nobody has checked.
  const e = engine(['ws://127.0.0.1:1/relay']);
  await e.measureRelaySkew();
  assert.equal(e.relaySkewState().measuredAt, 0,
    'a measurement nobody answered was recorded as a measurement');
  assert.equal(e.clockLooksWrong(), false, 'an unmeasured clock was called wrong');
});

test('the SIGNED proof beats /status, whose `now` anybody can type', async () => {
  // CLAUDE.md rule 10: `relayPub` read off /status "is never proof", and `now` is the same shape of string
  // over the same unauthenticated GET. This relay signs an honest proof and serves a /status claiming the
  // console is an hour out. The measurement must follow the signature.
  const r = await standIn({ proofSkew: 120, statusNow: Math.floor(Date.now() / 1000) - 3600 });
  const e = engine([r.base]);
  const got = await e.measureRelaySkew();
  assert.ok(Math.abs(got - 120) <= 2,
    'the console believed an unauthenticated /status over the relay’s own signature (measured ' + got + 's, ' +
    'expected ~120s). A host that copied a relay’s /status onto its own box could set this church’s idea of ' +
    'the time.');
  assert.equal(e.relaySkewState().proven, true, 'a proven reading was recorded as unproven');
  r.stop();
});

test('…and an older relay that cannot prove `at` still gets read, and is marked unsigned', async () => {
  // Fail-open on the DIAGNOSTIC, deliberately. A relay too old to carry `at` can still be read from /status,
  // and telling a steward "your clock is 15 minutes out, read from an older relay" is better than telling
  // them nothing while nothing they save is accepted. The provenance is what a later correcting stage reads.
  const r = await standIn({ answerProof: false, statusNow: Math.floor(Date.now() / 1000) - 450 });
  const e = engine([r.base]);
  const got = await e.measureRelaySkew();
  assert.ok(Math.abs(got - 450) <= 2, 'the /status fallback did not measure (got ' + got + 's)');
  assert.equal(e.relaySkewState().proven, false,
    'an unsigned reading was presented as proven — a later stage could then correct silently off a string');
  r.stop();
});

test('two relays that disagree give the reading CLOSER TO LOCAL, never the average', async () => {
  // §4: with exactly two, the median IS the average, and the average is not the conservative choice. Taking
  // the smaller magnitude means any correction later built on this number can only ever be smaller.
  const a = await standIn({ proofSkew: 100 });
  const b = await standIn({ proofSkew: 800 });
  const e = engine([a.base, b.base]);
  const got = await e.measureRelaySkew();
  assert.ok(Math.abs(got - 100) <= 2,
    'two disagreeing relays produced ' + got + 's. The average (450s) is a number NEITHER relay reported.');
  assert.ok(e.relaySkewState().spreadSec >= 690,
    'the disagreement between the relays is not reported, so nothing downstream can refuse to act on it');
  a.stop(); b.stop();
});

test('_pickSkew takes the median of three and the closer-to-local of two', () => {
  const { _pickSkew } = engine([]);
  assert.equal(_pickSkew([]), 0, 'no readings must mean no skew, not a crash');
  assert.equal(_pickSkew([-5]), -5);
  assert.equal(_pickSkew([-40, 10]), 10, 'two readings: the one closer to local must win');
  assert.equal(_pickSkew([10, -40]), 10, 'order of arrival changed the answer');
  assert.equal(_pickSkew([-900, 12, 900]), 12, 'one wild relay moved the answer — the median must absorb it');
});

// ── THE POINT OF USE ─────────────────────────────────────────────────────────────────────────────────────
// CLAUDE.md rule 1. The engine being right is not the feature; the steward seeing the number is. This
// renders the REAL DashRelaysCard driven by the REAL useStewardClockSkew hook, so deleting EITHER — the
// render, or the hook that feeds it — turns this red. A stub of the hook would let the hook be deleted with
// every test still green, which is the exact shape rule 1 exists to forbid.
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const ROOTJSX = readFileSync(join(ROOT, 'app/steward-root.jsx'), 'utf8');

function mini() {
  const states = []; const memos = []; const effDeps = [];
  let queued = [], i = 0, mi = 0, ei = 0;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, n) => Object.is(v, b[n]));
  const React = {
    useState(init) { const k = i++; if (!(k in states)) states[k] = typeof init === 'function' ? init() : init;
      return [states[k], (v) => { states[k] = typeof v === 'function' ? v(states[k]) : v; }]; },
    useMemo(f, deps) { const k = mi++; if (!memos[k] || !same(memos[k].deps, deps)) memos[k] = { deps, v: f() }; return memos[k].v; },
    useCallback(f, deps) { return React.useMemo(() => f, deps); },
    useEffect(fn, deps) { const k = ei++; if (!(k in effDeps) || !same(effDeps[k], deps)) { effDeps[k] = deps; queued.push(fn); } },
    useRef: () => ({ current: null }),
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    Fragment: 'Fragment',
  };
  const flush = async () => { const r = queued; queued = []; for (const f of r) { try { await f(); } catch (e) {} } };
  return { React, reset: () => { i = 0; mi = 0; ei = 0; }, flush };
}
const texts = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; }
  if (n.props) Object.values(n.props).forEach(v => { if (typeof v === 'string') out.push(v); else if (v && (v.kids || Array.isArray(v))) texts(v, out); });
  (n.kids || []).forEach(c => texts(c, out));
  return out;
};

const ROW = 'wss://box.example.ts.net/relay';

// The SHIPPED `relaySkew()` export, with the SHIPPED relaySkewState behind it, over a measurement state this
// test writes. Everything between the panel and `_relaySkewSec` is real code out of vendor/steward.js.
function shippedRelaySkew(state) {
  const parts = [
    stmt(SHIP, 'var _relaySkewSec = 0', '_relaySkewSec'),
    stmt(SHIP, 'var _skewMeasuredAt = 0', '_skewMeasuredAt'),
    stmt(SHIP, 'var _skewProven = false', '_skewProven'),
    stmt(SHIP, 'var _skewSpreadSec = 0', '_skewSpreadSec'),
    stmt(SHIP, 'var _skewByRelay =', '_skewByRelay'),
    stmt(SHIP, 'var CLOCK_FAULT_SEC =', 'CLOCK_FAULT_SEC'),
    stmt(SHIP, 'var SKEW_CAP_SEC =', 'SKEW_CAP_SEC'),
    fnBody(SHIP, 'function clockLooksWrong', 'clockLooksWrong'),
    fnBody(SHIP, 'function relaySkewState', 'relaySkewState'),
  ].join('\n');
  const body = parts
    + '\n_relaySkewSec = S.skewSec; _skewMeasuredAt = S.measuredAt; _skewProven = S.proven;'
    + '\n_skewSpreadSec = S.spreadSec;'
    + '\nfor (const r of (S.relays || [])) _skewByRelay.set(r.url, { sec: r.sec, at: 1, proven: r.proven });'
    + '\nconst _api = { ' + fnBody(SHIP, '    relaySkew() {', 'the relaySkew() export') + ' };'
    + '\nreturn () => _api.relaySkew();';
  return new Function('S', body)(state);
}

async function panel(skewState) {
  const { React, reset, flush } = mini();
  // BOTH HALVES, COMPILED TOGETHER. The hook comes out of steward-root.jsx and the card out of
  // stew-dashboard.jsx, and the card reaches the hook through `window` exactly as it does in the console.
  const src = [
    fnBody(ROOTJSX, 'function useStewardClockSkew()', 'useStewardClockSkew'),
    fnBody(DASH, 'function DashRelaysCard()', 'DashRelaysCard'),
  ].join('\n');
  const tmp = join(tmpdir(), 'skew1-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashRelaysCard, useStewardClockSkew };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
      [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const measured = [];
  // ⚠ THE THIRD LINK, AND IT USED TO BE A STUB. This panel reaches the engine through exactly one name —
  // `window.Steward.relaySkew()` — and a literal `relaySkew: () => skewState` covers the hook and the card
  // while leaving that name uncovered: renaming the export in src/steward.src.js left the panel permanently
  // blank and this file 11/11. So the member is LIFTED OUT OF THE SHIPPED BUNDLE, along with relaySkewState
  // and the measurement state it reads, and the row's fixture is written into that state rather than
  // returned past it. Rename the export and this throws; change what relaySkewState reports and the rows
  // below see it.
  const Steward = {
    relaySkew: shippedRelaySkew(skewState),
    measureRelaySkew: async () => { measured.push(1); return skewState.skewSec; },
    relayNameFor: () => '', ownRelay: () => '', canRemoveRelay: () => true, removeRelay: () => {},
    registerWithRelay: async () => {},
  };
  const win = {
    Steward, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {},
    useStewardClockSkew: null,   // replaced below with the REAL one, once it is compiled
  };
  const key = '__skew1_' + Math.random().toString(36).slice(2);
  globalThis[key] = {
    React, window: win,
    useSt: React.useState, useStE: React.useEffect,
    Icon: () => null,
    SkPill: ({ children }) => ({ type: 'span', props: {}, kids: [children] }),
    Panel: () => null,
    relayRejectionActive: false, clearRelayRejection: () => {}, relaysThatRefused: () => [],
    useRelayBackupState: () => ({ status: [{ url: ROW, status: 'on', ms: 20, member: true }], backup: null }),
    location: { host: 'console.example' },
    document: { visibilityState: 'visible' },
    setInterval: () => 0, clearInterval: () => {},
  };
  const pre = Object.keys(globalThis[key]).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const b64 = Buffer.from(pre + '\n' + js).toString('base64');
  const mod = await import('data:text/javascript;base64,' + b64);
  win.useStewardClockSkew = mod.useStewardClockSkew;
  const draw = async () => { reset(); const t = mod.DashRelaysCard({}); await flush(); reset(); const t2 = mod.DashRelaysCard({}); return t2 || t; };
  return { draw, measured };
}

const MEASURED = { skewSec: 660, measuredAt: 1758800000000, proven: true, spreadSec: 0, capSec: 900,
                   clockIsWrong: true, relays: [{ url: ROW, sec: 660, proven: true }] };

test('THE POINT OF USE: the Relays panel shows the measured skew', async () => {
  const p = await panel(MEASURED);
  const seen = texts(await p.draw()).join(' | ');
  assert.match(seen, /660s/,
    'THE MEASURED NUMBER IS NOT ON THE SCREEN. The whole of stage 1 is that a church can see the clock that ' +
    'decides which of its writes wins; an engine nobody is required to consult is not a feature (rule 1). ' +
    'Screen read: ' + seen.slice(0, 400));
  assert.match(seen, /ahead of/,
    'the number is shown without a direction, so a steward cannot tell fast from slow');
  assert.ok(p.measured.length >= 1,
    'the panel never asked for a measurement — the figure it shows would be whatever was last left lying about');
});

test('…and a console whose clock is BEHIND is not described as ahead', async () => {
  const p = await panel({ ...MEASURED, skewSec: -75, clockIsWrong: false });
  const seen = texts(await p.draw()).join(' | ');
  assert.match(seen, /75s/, 'a slow clock is not reported at all');
  assert.match(seen, /behind/, 'a slow console is described as fast — the direction is hard-coded');
  assert.ok(!/ahead of/.test(seen), 'both directions are shown at once: ' + seen.slice(0, 300));
});

test('…and RELAYS THAT CONTRADICT EACH OTHER say so, instead of painting a calm screen', async () => {
  // Scope §4 says a spread beyond the cap must RAISE THE BANNER, and until 2026-09-26 nothing did: the
  // correction refused silently while this card showed a green dot and "This console's clock matches your
  // relays (0s)". That is the calmest possible way to say "the thing protecting your safeguarding documents
  // is switched off". The state comes through the SHIPPED relaySkewState, so `disagree` is computed by the
  // console rather than asserted by this test.
  const p = await panel({ skewSec: 0, measuredAt: 1758800000000, proven: true, spreadSec: 1100, capSec: 900,
                          clockIsWrong: false,
                          relays: [{ url: ROW, sec: 400, proven: true }, { url: ROW + '2', sec: -700, proven: true }] });
  const seen = texts(await p.draw()).join(' | ');
  assert.match(seen, /disagree/i,
    'THE PANEL DOES NOT SAY THE CORRECTION IS OFF. Two relays contradicting each other by more than the cap ' +
    'is not a device-clock fault the console will quietly fix — it refuses, and a steward who is not told ' +
    'has no way to know the boxes need their clocks checked. Screen read: ' + seen.slice(0, 400));
  assert.match(seen, /1100s/, 'the disagreement is mentioned without its size, so nobody can judge it');
  assert.match(seen, /nothing is being corrected|not being corrected/i,
    'the screen names the disagreement but not its consequence. The fact a steward needs is that stamps are ' +
    'going out uncorrected right now.');
});

test('…and an unsigned reading says nothing is corrected from it', async () => {
  const p = await panel({ skewSec: 400, measuredAt: 1758800000000, proven: false, spreadSec: 0, capSec: 900,
                          clockIsWrong: true, relays: [{ url: ROW, sec: 400, proven: false }] });
  const seen = texts(await p.draw()).join(' | ');
  assert.match(seen, /unsigned/i, 're-anchor: the unsigned reading is no longer marked as one');
  assert.match(seen, /nothing is corrected/i,
    'the screen says the reading is unsigned without saying what follows from it. "Unsigned" is jargon; ' +
    '"nothing is corrected from it" is the fact — and a steward reading a 400s drift needs to know their ' +
    'writes are still going out on this laptop’s clock.');
});

test('…and an UNMEASURED clock claims nothing at all', async () => {
  const p = await panel({ skewSec: 0, measuredAt: 0, proven: false, spreadSec: 0, capSec: 900,
                          clockIsWrong: false, relays: [] });
  const seen = texts(await p.draw()).join(' | ');
  assert.ok(!/clock/i.test(seen),
    'the panel makes a claim about the clock before anything has answered. "Not measured" and "measured at ' +
    'zero" are different facts, and painting the second over the first tells a steward their clock is fine ' +
    'when nobody has checked. Screen read: ' + seen.slice(0, 300));
});

test('…and an unsigned reading says so on the screen', async () => {
  const p = await panel({ ...MEASURED, proven: false });
  const seen = texts(await p.draw()).join(' | ');
  assert.match(seen, /unsigned/i,
    'a figure read from an unauthenticated /status is shown with the same authority as a signed proof');
});

// ── STAGE 1 CORRECTS NOTHING, and this is the assertion that holds that line ─────────────────────────────
test('now() still means the LOCAL clock, and the stamp is bounded by the console\'s own gate', () => {
  // REWRITTEN AT STAGE 4. Until then this row asserted that `_monotonic` consulted nothing at all, and that
  // was the whole safety argument for stage 1. Stage 4 puts the correction inside `_monotonic`, so the old
  // claim is simply false now; it is replaced rather than deleted, and what it holds is the line that is
  // still real. Comments are stripped first: an ordering check in this repo was once satisfied by the
  // comment that explained the rule, and the block above `_monotonic` describes exactly this work.
  const mono = stripComments(fnBody(SHIP, 'function _monotonic(tmpl)', '_monotonic'));
  assert.match(mono, /_skewShift\(STAMP_CAP_SEC\)/,
    'the stamp no longer takes the correction through _skewShift(STAMP_CAP_SEC). If correcting a document ' +
    'is being withdrawn that is a decision, not a tidy-up; if it has merely been re-spelled, re-anchor this ' +
    'row rather than deleting it. Body seen:\n' + mono);
  assert.ok(!mono.includes('SKEW_CAP_SEC) - '), 're-anchor: the shift is being taken with a credential cap');
  assert.match(mono, /Math\.min\(localS \+ STAMP_CAP_SEC/,
    'THE RUNAWAY GUARD LOST ITS LOCAL CEILING. `last + 1` must not climb past this console\'s OWN ' +
    '_authFuture, which reads the LOCAL clock; measured only against the corrected clock, a 600s-fast ' +
    'console stamps the SECOND write of a document BEFORE the first and the relay drops it as have-newer.');
  // …and the measurement still reaches a DOCUMENT only through that one function.
  for (const sym of ['_relaySkewSec', 'measureRelaySkew', 'relaySkewState', '_skewByRelay']) {
    assert.ok(!mono.includes(sym),
      '_monotonic now reads ' + sym + ' directly instead of going through _skewShift, which is where the ' +
      'three refusals and the cap live. One writer with its own arithmetic is how two consoles in one ' +
      'church end up ordering a child\'s clearance by two different rules.');
  }
  const nowFn = stripComments(stmt(SHIP, 'var now = () =>', 'now'));
  assert.ok(!/_relaySkewSec|measureRelaySkew|_skewShift/.test(nowFn),
    'now() itself was corrected. Seven call sites in this console are LOCAL clocks — a message retry, the ' +
    'website-sync budget, a steward\u2019s scheduled devotional — and correcting now() breaks all seven ' +
    '(SCOPE-RELAY-CORRECTED-TIME \u00a72(b)).');
});
