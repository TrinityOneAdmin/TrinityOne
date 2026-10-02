// THE KEY READS OVER REAL SOCKETS: nostr-tools' own pool against scripted relays.
//   Run: node --test scripts/key-reads-over-real-sockets.test.mjs
//
// The care, name and media mint gates open on "every relay in this console's set answered, trustworthily, that
// this church has no envelope". The fake-pool file (key-reads-settle-only-for-the-church-they-asked-about)
// pins each guard on its own; this one runs the SHIPPED read code (subscribe*, _openKeyRead, _keyReadOk,
// _keyReadAuthedOn, pool.automaticallyAuth, ensureCareKeyForMembers, _ensureNameKeyLocked — all lifted from
// vendor/steward.js) over the REAL nostr-tools SimplePool and real WebSockets, so every `oneose` comes from
// nostr-tools itself: a relay's EOSE, a CLOSED, a failed connection, a dropped socket, or its own 4400 ms timer.
// Adapted from the audit of d1116f6 (scratchpad net.mjs / netscen.mjs), which found:
//   · a CLOSED counted as an answer, and the console minted over the envelope that relay held;
//   · with two relays, an authenticated empty answer from one opened the gate while the relay HOLDING the
//     envelope was down, dropped, or refused our login;
//   · the 4.3 s cutoff had no retry, so a church on a slow link (EOSE at 4.5 s, or 2.2 s each way) never got keys.
//
// Each scenario is independent (its own relays, pool and engine) and they run concurrently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { nip44, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt, liftKeyRead } from './test-slice.mjs';

useWebSocketImplementation(WebSocket);
// THE SCENARIOS RUN IN A CHILD PROCESS (this same file, with KEY_READS_CHILD=1). nostr-tools re-throws a refused
// login from inside its own message handler (`relay.auth(...).catch(err => { throw err })`), which node:test
// reports as a failure of whatever test is running — and refusing logins is what three scenarios are for. The
// child ignores exactly those rejections and prints its results as JSON; the test below asserts on them.
const CHILD = process.env.KEY_READS_CHILD === '1';
if (CHILD) process.on('unhandledRejection', (e) => { if (!/auth-failed|refused by script|auth timed out|closed/i.test(String(e && e.message || e))) { console.error(e); process.exit(3); } });

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const hex = (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map(b => parseInt(b, 16)));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:', MEDIAKEY_D = 'trinityone/mediakey:';
const ck = (a, b) => nip44.v2.utils.getConversationKey(a, b);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const envelope = (d, author, church, ring, recips) => finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000) - 100,
  tags: [['d', d + church], ['t', 'trinityone']],
  content: JSON.stringify({ rev: 1, keys: Object.fromEntries(recips.map(p => [p, nip44.v2.encrypt(JSON.stringify(ring), ck(author.sk, p))])) }) }, author.sk);
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// ── a scripted relay ────────────────────────────────────────────────────────────────────────────────────────
// store; private key envelopes withheld from an unauthenticated socket (challenge + hold EOSE, as the gateway
// does); authOk; latency (each way); eoseDelay; neverEose; closed (answer every REQ with CLOSED);
// dropAfterReq (terminate the socket); challengeOnConnect.
async function fakeRelay(opts = {}) {
  const port = await freePort();
  const wss = new WebSocketServer({ host: '127.0.0.1', port });
  const store = opts.store || [];
  const reqs = { n: 0 };
  const matches = (f, e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey))
    && Object.keys(f).filter(k => k[0] === '#').every(k => (e.tags || []).some(t => t[0] === k.slice(1) && f[k].includes(t[1])));
  const priv = (e) => [CAREKEY_D, NAMEKEY_D, MEDIAKEY_D].some(p => ((e.tags.find(t => t[0] === 'd') || [])[1] || '').startsWith(p));
  wss.on('connection', (ws) => {
    ws._challenge = Math.random().toString(16).slice(2); ws._held = new Map(); ws._subs = new Map();
    const send = (m) => { const s = JSON.stringify(m); const go = () => { try { if (ws.readyState === 1) ws.send(s); } catch {} }; opts.latency ? setTimeout(go, opts.latency) : go(); };
    if (opts.challengeOnConnect) send(['AUTH', ws._challenge]);
    ws.on('message', (raw) => {
      const run = () => {
        let m; try { m = JSON.parse(String(raw)); } catch { return; }
        if (m[0] === 'REQ') {
          reqs.n++;
          const id = m[1], filters = m.slice(2);
          ws._subs.set(id, filters);
          if (opts.dropAfterReq != null) setTimeout(() => { try { ws.terminate(); } catch {} }, opts.dropAfterReq);
          if (opts.closed) { send(['CLOSED', id, opts.closed]); return; }
          let withheld = false;
          for (const e of store) if (filters.some(f => matches(f, e))) { if (priv(e) && !ws._auth) { withheld = true; continue; } send(['EVENT', id, e]); }
          if (opts.neverEose) return;
          if (withheld) { send(['AUTH', ws._challenge]); ws._held.set(id, setTimeout(() => { ws._held.delete(id); send(['EOSE', id]); }, 2500)); return; }
          opts.eoseDelay ? setTimeout(() => send(['EOSE', id]), opts.eoseDelay) : send(['EOSE', id]);
        } else if (m[0] === 'AUTH') {
          const ev = m[1];
          const ok = opts.authOk !== false && (ev.tags.find(t => t[0] === 'challenge') || [])[1] === ws._challenge;
          send(['OK', ev.id, ok, ok ? '' : 'auth-failed: refused by script']);
          if (!ok) return;
          ws._auth = ev.pubkey;
          for (const [id, filters] of ws._subs) for (const e of store) if (priv(e) && filters.some(f => matches(f, e))) send(['EVENT', id, e]);
          for (const [id, t] of ws._held) { clearTimeout(t); send(['EOSE', id]); }
          ws._held.clear();
        } else if (m[0] === 'CLOSE') ws._subs.delete(m[1]);
      };
      opts.latency ? setTimeout(run, opts.latency) : run();
    });
  });
  return { url: `ws://127.0.0.1:${port}/`, reqs, close: () => new Promise(r => { for (const c of wss.clients) try { c.terminate(); } catch {} wss.close(() => r()); }) };
}

// ── the console's key engine over a real pool, lifted from the shipped bundle ────────────────────────────────
function engine(A, urls) {
  const published = [];
  const pool = new SimplePool();
  const t = {
    pool, relays: () => urls.slice(), normalizeURL2: normalizeURL, finalizeEvent2: finalizeEvent,
    pub: A.pub, actingChurch: '', churchPub: A.pub, churchSk: A.sk, sk: A.sk,
    NET: 'trinityone', NAMEKEY_D, CAREKEY_D, MEDIAKEY_D, NAME_RING_MAX: 50,
    _careKeyHex: null, _careKeyRing: [], _careKeyDocKeys: null, _careKeyRev: 0, _careKeyChecked: false, _careKeyPending: [], _careKeyVer: 0,
    _careRoster: new Set(), _CAREKEY_PENDING_TTL: 12000,
    _mediaKeyHex: null, _mediaKeyRing: [], _mediaKeyDocKeys: null, _mediaKeyChecked: false, _mediaKeyPushRefused: null, _mediaKeyVer: 0,
    _nameKeyRing: [], _nameKeyDocKeys: null, _nameKeyChecked: false, _nameKeyAt: 0, _nameKeyBusy: null,
    _localBlocked: new Set(), toPubHex: (p) => p, _myOwnPub: () => A.pub,
    now: () => Math.floor(Date.now() / 1000), _CLOCK_SKEW: 600,
    decrypt3: (c, k) => nip44.v2.decrypt(c, k), encrypt2: (p, k) => nip44.v2.encrypt(p, k), getConversationKey: ck,
    _hex: hex, _unhex: unhex, crypto,
    _webQueueSync: () => {}, _churchHasCareNeeds: async () => false,
    _sealEach: async (pl, targets, f) => Object.fromEntries([...targets].map(p => [p, f(pl, p)])),
    feChurch: (x) => ({ ...x, pubkey: A.pub }),
    publish: async (e) => { published.push(e); return { id: 'ok' }; },
    window: { dispatchEvent: () => true },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    console: { warn() {}, log() {}, error() {} },
    JSON, Set, Map, Object, Array, String, Number, Boolean, Promise, Error, Math, Uint8Array, Date, setTimeout, clearTimeout, queueMicrotask,
  };
  const proxy = new Proxy(t, {
    has: (o, k) => (k in o) || !(String(k) in globalThis),
    get: (o, k) => { if (k === Symbol.unscopables) return undefined; if (k in o) return o[k]; throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub'); },
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const decls = [
    stmt(BUNDLE, 'var _authedRelays = '), stmt(BUNDLE, 'var _authAccepted = '),
    stmt(BUNDLE, 'pool.automaticallyAuth = (url) => async (authEvent) => {'),
    fnBody(BUNDLE, 'function _isRelayAuthed() {'), fnBody(BUNDLE, 'function _keyReadAuthedOn(url) {'),
    liftKeyRead(BUNDLE),
    stmt(BUNDLE, 'var _authFuture = (e) =>'), stmt(BUNDLE, 'var _byChurchOrSteward = (e) =>'),
    stmt(BUNDLE, 'var _careKeyAuthed = (e) =>'), stmt(BUNDLE, 'var _isCurrentCareEnv = (e) =>'),
    fnBody(BUNDLE, 'function _ingestCareKeyEnv(e) {'), fnBody(BUNDLE, 'function _reCheckCareKeyPending() {'),
    stmt(BUNDLE, 'var _nameKeyListeners = '), fnBody(BUNDLE, 'function _nameKeyRingChanged() {'), fnBody(BUNDLE, 'function _nameKeyReady() {'),
    fnBody(BUNDLE, 'function _fitKeyRing(full, recipCount, sealSample) {'),
  ].join('\n');
  const M = (a) => fnBody(BUNDLE, a, a);
  const methods = [M('    subscribeCareKey() {'), M('    subscribeNameKey() {'), M('    subscribeMediaKey() {'),
    M('    async _ensureNameKeyLocked(memberPubs, stewardPubs, opts = {}) {'), M('    async ensureCareKeyForMembers(memberPubs, stewardPubs, opts) {')].join(',\n');
  t.t = t;
  const S = new Function('scope', `with (scope) { ${decls}\n return { ${methods} }; }`)(proxy);
  return { S, t, pool, published };
}

const A = K(), member = K();
const RINGS = { care: ['c1'.repeat(32)], name: ['e1'.repeat(32)], media: ['d1'.repeat(32)] };
const held = () => [envelope(CAREKEY_D, A, A.pub, RINGS.care, [A.pub]), envelope(NAMEKEY_D, A, A.pub, RINGS.name, [A.pub]), envelope(MEDIAKEY_D, A, A.pub, RINGS.media, [A.pub])];

// Run one scenario: open the three reads, wait until all three gates have settled (or `wait` ms), then ask the
// two minting publishers to act. Returns what they did.
async function scenario({ relays, wait }) {
  const rs = [];
  for (const o of relays) rs.push(o.down ? { url: `ws://127.0.0.1:${await freePort()}/`, reqs: { n: 0 }, close: async () => {} } : await fakeRelay(o));
  const e = engine(A, rs.map(r => r.url));
  const t0 = Date.now();
  const closers = [e.S.subscribeCareKey(), e.S.subscribeNameKey(), e.S.subscribeMediaKey()];
  while (Date.now() - t0 < wait && !(e.t._careKeyChecked && e.t._nameKeyChecked && e.t._mediaKeyChecked)) await sleep(200);
  const settledAfter = Date.now() - t0;
  const out = {
    settled: e.t._careKeyChecked && e.t._nameKeyChecked && e.t._mediaKeyChecked, settledAfter,
    care: await e.S.ensureCareKeyForMembers([member.pub], []),
    name: await e.S._ensureNameKeyLocked([member.pub], []),
    published: e.published.map(ev => (ev.tags.find(x => x[0] === 'd') || [])[1].slice(11, 18)),
    careRing: e.t._careKeyRing.slice(), nameRing: e.t._nameKeyRing.slice(), mediaRing: e.t._mediaKeyRing.slice(),
    reqs: rs.map(r => r.reqs.n),
  };
  for (const c of closers) try { c(); } catch {}
  try { e.pool.destroy(); } catch {}
  for (const r of rs) await r.close();
  return out;
}
const mintedOver = (o) => o.careRing.some(k => !RINGS.care.includes(k)) || o.nameRing.some(k => !RINGS.name.includes(k));

// ── AN EXISTING CHURCH: the envelope is on a relay, and the console must never mint over it ─────────────────
const EXISTING = {
  'CONTROL one relay holds the envelopes (withheld until login)': { relays: [{ store: held() }], adopts: true },
  'the relay REFUSES our login (we signed; it said no)': { relays: [{ store: held(), authOk: false }] },
  'the relay answers CLOSED (rate-limited), console logged in': { relays: [{ store: held(), closed: 'rate-limited: too many subscriptions', challengeOnConnect: true }] },
  'two relays: the one holding the envelopes is DOWN, the other is empty and logged in': { relays: [{ down: true }, { store: [], challengeOnConnect: true }] },
  'two relays: the one holding the envelopes drops at once, the other is empty and logged in': { relays: [{ store: held(), dropAfterReq: 0, latency: 5 }, { store: [], challengeOnConnect: true }] },
  'two relays: the one holding the envelopes refuses our login, the other is empty and logged in': { relays: [{ store: held(), authOk: false }, { store: [], challengeOnConnect: true }] },
};
// ── A NEW CHURCH: no envelope anywhere — a genuine answer must get the first keys minted, in bounded time ────
const NEW = {
  'CONTROL new church, logged in, EOSE at once': { relays: [{ store: [], challengeOnConnect: true }], within: 5000, mints: true },
  'new church, EOSE after 4.5 s (past nostr-tools\' 4.4 s timer)': { relays: [{ store: [], challengeOnConnect: true, eoseDelay: 4500 }], within: 25000, mints: true },
  'new church, 2.2 s latency each way': { relays: [{ store: [], challengeOnConnect: true, latency: 2200 }], within: 30000, mints: true },
  'new church, never logged in (no challenge): an unauthenticated answer never counts': { relays: [{ store: [] }], within: 9000, mints: false },
  'new church, relay never sends EOSE: nostr-tools\' fake EOSE never counts': { relays: [{ store: [], challengeOnConnect: true, neverEose: true }], within: 12000, mints: false },
};

if (CHILD) {
  const runs = await Promise.all([
    ...Object.entries(EXISTING).map(async ([name, s]) => [name, await scenario({ relays: s.relays, wait: 9000 })]),
    ...Object.entries(NEW).map(async ([name, s]) => [name, await scenario({ relays: s.relays, wait: s.within })]),
  ]);
  process.stdout.write('@@RESULTS@@' + JSON.stringify(runs) + '\n');
  process.exit(0);
}

test('over real sockets: an existing church is never minted over, and a new church gets its first keys', { timeout: 120000 }, async () => {
  const out = execFileSync(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, KEY_READS_CHILD: '1' }, encoding: 'utf8', timeout: 110000 });
  const line = out.split('\n').find(l => l.startsWith('@@RESULTS@@'));
  assert.ok(line, 'the scenario child printed no results:\n' + out.slice(-2000));
  const runs = JSON.parse(line.slice('@@RESULTS@@'.length));
  assert.equal(runs.length, Object.keys(EXISTING).length + Object.keys(NEW).length, 'a scenario did not run');
  const problems = [];
  for (const [name, o] of runs) {
    const s = EXISTING[name] || NEW[name];
    if (s.within === undefined) {   // existing church
      if (mintedOver(o)) problems.push(`${name}: MINTED OVER THE RELAY'S ENVELOPE — ${JSON.stringify(o)}`);
      if (s.adopts && !(o.careRing[0] === RINGS.care[0] && o.nameRing[0] === RINGS.name[0] && o.mediaRing[0] === RINGS.media[0])) problems.push(`${name}: CONTROL — the console did not adopt the church's keys: ${JSON.stringify(o)}`);
    } else if (s.mints) {
      if (!o.settled || !o.published.includes('carekey') || !o.published.includes('namekey')) problems.push(`${name}: NO FIRST KEYS within ${s.within} ms — the church stays on "still connecting" and members cannot seal names: ${JSON.stringify(o)}`);
    } else if (o.settled || o.published.length) {
      problems.push(`${name}: an answer that is not the relay's opened the mint gate: ${JSON.stringify(o)}`);
    }
  }
  assert.deepEqual(problems, []);
});
