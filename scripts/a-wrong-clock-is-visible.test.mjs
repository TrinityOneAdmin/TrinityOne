// A WRONG CLOCK MUST BE VISIBLE. Nothing here corrects a clock (owner 2026-10-27: no correction now, the universal
// fix stays parked); it asserts only that a wrong clock is SEEN. Run: node --test scripts/a-wrong-clock-is-visible.test.mjs
//
// 5.1  a phone 10 min out: the REAL gateway refuses its NIP-42 AUTH. The shipped bundle's _noteAuthAccepted records
//      it, the app's own retryIfRefused (lifted out of app/app.jsx and RUN) measures the skew from the real /status,
//      and clockLooksWrong() turns true. Control: a right-clock phone is never flagged. What the test does NOT
//      prove: that ctx.clockIsWrong in app.jsx's render object is read from clockLooksWrong() (an inline expression).
// 5.2  a box 6 min out: sync fails silently today (B5 in stress4-clocks.test.mjs). Now both sides show it on the real
//      /status, the 401 names the TIME window only when the signature verified, and /status leaks no address or key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const SHIM = join(import.meta.dirname, 'stress4-clock-shim.cjs');
const skewed = (sec) => ({ NODE_OPTIONS: '--require ' + SHIM, STRESS_CLOCK_SKEW_SEC: String(sec) });
const church = H.key();
const sleep = H.sleep;
const nowS = () => Math.floor(Date.now() / 1000);
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

function scopeOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` - add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
const liftFn = (src, anchor, name, stubs) => new Function('scope', `with (scope) { return (${fnBody(src, anchor, name)}); }`)(scopeOf(stubs));
function liftArrow(src, anchor, stubs) {
  const at = src.indexOf(anchor); assert.notEqual(at, -1, anchor + ' missing');
  const arrow = src.indexOf('(', at), open = src.indexOf('{', src.indexOf('=>', arrow));
  let d = 0, i = open; for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  return new Function('scope', `with (scope) { return (${src.slice(arrow, i + 1)}); }`)(scopeOf(stubs));
}

let S, T;
before(async () => {
  S = await H.startRelay({ name: 'S', churches: [church.pub] });
  await H.publishAll(S, [H.relaysDoc(church, [S], nowS() - 3600)]);
});

// ---- 5.1 ------------------------------------------------------------------------------------------------------
async function phoneAt(offSec) {
  const me = H.key(), peer = H.key();
  const joinDoc = (k) => finalizeEvent({ kind: 30078, created_at: nowS(), tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone'], ['p', church.pub]], content: JSON.stringify({ joined: nowS(), seen: nowS(), hb: 1 }) }, k.sk);
  for (const k of [me, peer]) { const w = await H.connect(S); try { await H.publish(w, joinDoc(k)); } finally { w.close(); } }
  const w = await H.connect(S); try { await H.publish(w, finalizeEvent({ kind: 4, created_at: nowS(), tags: [['p', me.pub]], content: 'sealed?iv=AAAA' }, peer.sk)); } finally { w.close(); }
  const phoneDate = { now: () => Date.now() + offSec * 1000 };   // THIS PHONE'S wall clock
  const stubs = { _relayAuthOkAt: 0, _relayAuth: new Map(), _relaySkewSec: 0, _skewMeasuredAt: 0, CLOCK_FAULT_SEC: 300,
    normalizeURL, Promise, Date: phoneDate, fetch: (u, o) => fetch(u, o), AbortSignal, Math,
    churchRelays: () => [], window: { Fellowship: { relays: [S.wsUrl] } } };
  const pool = new SimplePool(); stubs.pool = pool;
  // abstract-pool chains `.then()` on the promise relay.auth() returns, with no catch, so a refused AUTH crashes the runner
  // (the app's _noteAuthAccepted handles relay.authPromise, which is left rejecting). Mark it handled here so the REFUSAL is
  // what the test observes, not a crashed runner.
  const ens = pool.ensureRelay.bind(pool);
  pool.ensureRelay = async (u, o) => { const r = await ens(u, o); if (!r.__w) { r.__w = 1; const a = r.auth.bind(r); r.auth = (f) => { return Promise.resolve(a(f)).catch(() => {}); }; } return r; };
  const note = liftFn(VENDOR, 'function _noteAuthAccepted(url) {', '_noteAuthAccepted', stubs);
  // the signer mirrors pool.automaticallyAuth in src/fellowship.src.js (note, then sign) with this phone's clock on the event
  pool.automaticallyAuth = (url) => async (ev) => { note(url); return finalizeEvent({ ...ev, created_at: ev.created_at + offSec }, me.sk); };
  const F = {
    authState: liftFn(VENDOR, 'function authState() {', 'authState', stubs),
    measureRelaySkew: liftFn(VENDOR, 'async function measureRelaySkew(preferUrl) {', 'measureRelaySkew', stubs),
    clockLooksWrong: liftFn(VENDOR, 'function clockLooksWrong() {', 'clockLooksWrong', stubs),
    reconnectAll: () => {}, relaysHealthy: () => true,
  };
  stubs.window.Fellowship = Object.assign(stubs.window.Fellowship, F);
  const retry = liftArrow(APP, 'const retryIfRefused = () => {', { window: stubs.window, Date: phoneDate, performance: { now: () => 1e6 }, lastAuthRetry: 0 });
  const got = await pool.querySync([S.wsUrl], { kinds: [4], '#p': [me.pub] }, { maxWait: 2500 }).catch(() => []);
  await sleep(500);
  return { F, retry, got, close: () => { try { pool.close([S.wsUrl]); } catch {} } };
}

for (const [label, off] of [['+10m fast', 600], ['-10m slow', -600]]) {
  test(`5.1 a phone ${label}: its AUTH is refused by the real gateway, and the app's own recovery path makes clockLooksWrong() true`, async () => {
    const p = await phoneAt(off);
    try {
      assert.equal(p.got.length, 0, 'CONTROL: the premise - this phone cannot read its own DM');
      assert.equal(p.F.authState().failed, true, 'the refusal was not recorded');
      assert.equal(p.F.clockLooksWrong(), false, 'nothing has measured yet');
      assert.equal(p.retry(), true, 'the app did not treat a refused proof as refused');
      await sleep(800);   // measureRelaySkew is fire-and-forget in the app
      assert.equal(p.F.clockLooksWrong(), true, 'a phone 10 minutes out was refused and the app still does not say its clock is wrong');
      const sk = p.F.authState().skewSec;
      assert.ok(Math.abs(sk - off) <= 5, 'measured skew ' + sk + 's, wanted about ' + off);
    } finally { p.close(); }
  });
}
test('5.1 CONTROL: a right-clock phone reads its DM and is never flagged', async () => {
  const p = await phoneAt(0);
  try {
    assert.equal(p.got.length, 1, 'a right-clock phone must read its own DM');
    assert.equal(p.F.authState().failed, false);
    assert.equal(p.retry(), false);
    await sleep(300);
    assert.equal(p.F.clockLooksWrong(), false);
    assert.equal(p.F.authState().skewAt, 0, 'it measured a healthy connection needlessly');
  } finally { p.close(); }
});

// ---- 5.2 ------------------------------------------------------------------------------------------------------
const TIME = /timestamp is outside the allowed window/;
async function pair(skewSec) {
  const s = await H.startRelay({ name: 'vS' + skewSec, churches: [church.pub] });
  const t = await H.startRelay({ name: 'vT' + skewSec, churches: [church.pub], env: skewed(skewSec) });
  const list = H.relaysDoc(church, [s, t], nowS()); await H.publishAll(s, [list]); await H.publishAll(t, [list]);
  await H.publishAll(s, [H.churchDoc(church, 'trinityone/notice:fromS', { a: 1 }, nowS() - 30)]);
  await H.publishAll(t, [H.churchDoc(church, 'trinityone/notice:fromT', { a: 2 }, nowS() - 30)]);
  await H.syncNow(t).catch(() => {}); await H.syncNow(s).catch(() => {}); await sleep(500);
  return { s, t };
}
for (const skew of [360, -360]) {
  test(`5.2 a box ${skew / 60} min out: the failure shows on BOTH boxes' /status and log, with nothing identifying on it`, async () => {
    const { s, t } = await pair(skew);
    const ss = await s.status(), ts = await t.status();
    for (const [who, st] of [['skewed box asking', ts], ['healthy box asking', ss]]) {
      assert.equal(st.sync.ok, false, who + ': sync reads as healthy while every request was refused');
      assert.match(st.sync.error, /clocks may differ/, who);
      assert.ok(st.sync.at > 0, who);
    }
    assert.ok(ss.clockSuspect && ss.clockSuspect.at > 0, 'the healthy box refused the skewed one for time and does not say so');
    assert.ok(ts.clockSuspect && ts.clockSuspect.at > 0, 'the skewed box refused the healthy one for time and does not say so');
    assert.ok(t.log.some(l => /\[sync\].*refused our proof/.test(l)), 'skewed box logged nothing');
    assert.ok(s.log.some(l => /\[sync\].*refused our proof/.test(l)), 'healthy box logged nothing');
    assert.ok(s.log.some(l => /\[clock\]/.test(l)) && t.log.some(l => /\[clock\]/.test(l)), 'the refusing side logged nothing');
    // once per peer per hour: a second pass must not log it again
    const n0 = s.log.filter(l => /refused our proof/.test(l)).length;
    await H.syncNow(s).catch(() => {}); await sleep(300);
    assert.equal(s.log.filter(l => /refused our proof/.test(l)).length, n0, 'logged again inside the hour');
    // /status is unauthenticated: no address, port, church key or box key may ride on it
    for (const [box, other, st] of [[s, t, ss], [t, s, ts]]) {
      const txt = JSON.stringify(st);
      for (const secret of [String(other.port), church.pub, other.relayPub, 'syncRefusedBy']) assert.ok(!txt.includes(secret), 'public /status carries ' + secret);
    }
    // …while the operator (admin token) can see WHICH peer
    const adm = await (await fetch(s.base + '/status', { headers: { Authorization: 'Bearer ' + s.adminToken } })).json();
    assert.ok(Array.isArray(adm.syncRefusedBy) && adm.syncRefusedBy.some(x => x.peer.includes(String(t.port))), 'admin view does not name the refusing peer');
  });
}
test('5.2 CONTROL: boxes 4 min apart sync, show ok, and raise no clock flag', async () => {
  const { s, t } = await pair(240);
  const ss = await s.status(), ts = await t.status();
  assert.equal(ss.sync.ok, true); assert.equal(ts.sync.ok, true);
  assert.equal(ss.clockSuspect, undefined); assert.equal(ts.clockSuspect, undefined);
  assert.equal(s.log.some(l => /refused our proof|\[clock\]/.test(l)), false);
});
test('5.2 the 401 names the TIME window only when the signature verified and time is the failing check; one string for everyone', async () => {
  const url = S.base + '/sync?church=' + church.pub + '&since=0';
  const proof = (sk, at, extra = {}) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: at, tags: [['u', url], ['method', 'GET'], ['church', church.pub]], content: '', ...extra }, sk))).toString('base64');
  const stranger = H.key();
  const ask = async (auth) => { const r = await fetch(url, { headers: auth ? { Authorization: auth } : {} }); return { st: r.status, body: await r.text() }; };
  const late = await ask(proof(church.sk, nowS() - 400));        // church key, valid signature, 400 s old
  const lateStranger = await ask(proof(stranger.sk, nowS() - 400));   // a key nobody trusts, same lateness
  assert.equal(late.st, 401); assert.match(late.body, TIME);
  assert.equal(lateStranger.body, late.body, 'the reason differs by key: it would reveal which keys are trusted');
  const inWindowStranger = await ask(proof(stranger.sk, nowS()));      // in window, untrusted
  assert.equal(inWindowStranger.st, 401); assert.doesNotMatch(inWindowStranger.body, TIME, 'blamed the clock for a key that is simply not trusted');
  const noAuth = await ask(''); assert.doesNotMatch(noAuth.body, TIME);
  const ev = JSON.parse(Buffer.from(proof(church.sk, nowS() - 400).slice(6), 'base64').toString()); ev.sig = ev.sig.replace(/^./, c => c === 'a' ? 'b' : 'a');
  const forged = await ask('Nostr ' + Buffer.from(JSON.stringify(ev)).toString('base64')); assert.doesNotMatch(forged.body, TIME, 'a forged signature was told about the clock');
  const ok = await ask(proof(church.sk, nowS())); assert.equal(ok.st, 200, 'CONTROL: an in-window proof by the church key is served');
});

// ---- 5.3 ------------------------------------------------------------------------------------------------------
// WORDING ONLY. The console's "newer version already stored" refusals say the clock may be wrong when the console has
// MEASURED its clock as wrong (Steward.clockLooksWrong), and keep their old sentences otherwise. The save, the stamp
// and the refusal are untouched. Both screens' functions are lifted out of the unbundled app files and RUN.
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const SCHED = readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8');
const stewWindow = (wrong, fail) => ({ Steward: { clockLooksWrong: () => wrong, lastSaveFailure: () => fail } });
test('5.3 the console save-failure banner names the clock when it is measured wrong, and not otherwise', () => {
  const msg = (wrong) => liftFn(DASH, 'function publishErrorMessage(reason, evt, opts) {', 'publishErrorMessage', { window: stewWindow(wrong, '') })('invalid: a newer version of this is already stored', { kind: 30078 }, {}).msg;
  assert.match(msg(true), /clock looks wrong/);
  assert.doesNotMatch(msg(false), /clock looks wrong/, 'CONTROL: a right clock must keep the existing sentence');
  assert.match(msg(false), /Either another console saved/, 'CONTROL: the old explanation is unchanged');
});
test('5.3 the schedule clash message names the clock when it is measured wrong, and not otherwise', () => {
  const msg = (wrong) => liftFn(SCHED, 'function schNoKey() {', 'schNoKey', { window: stewWindow(wrong, 'clash') })();
  assert.match(msg(true), /clock looks wrong/);
  assert.match(msg(false), /someone saved this a moment ago/, 'CONTROL: unchanged for a right clock');
});
