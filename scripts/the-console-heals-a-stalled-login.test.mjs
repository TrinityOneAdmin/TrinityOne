// THE CONSOLE HEALS A STALLED NIP-42 LOGIN BY ITSELF, instead of sitting logged-out until a manual reload.
//   Run: node --test scripts/the-console-heals-a-stalled-login.test.mjs
//
// THE GAP (verified 2026-11-10, reference/GAP1-REPRO-harness). A socket that is UP but never completed its login
// — the key was locked when the relay challenged, or the login was refused/timed-out and nostr-tools then caches
// the failed authPromise for the connection's life — reads as "healthy" to the reconnect ticker (which only asks
// "is the socket up?"), so it is NEVER recovered: the console serves empty private reads for ever. The member app
// recovers from the same state (app/app.jsx retryIfRefused + Fellowship.reconnectAll); the console had none.
//
// THE FIX (Part 2). The engine records auth FAILURES (automaticallyAuth), authState() reports a recorded failure
// with nothing accepted, and healStuckLogin() closes those sockets so a fresh one re-challenges — guarded so a
// login merely IN FLIGHT is never torn down.
//
// REAL, not a stub: the SHIPPED auth machinery is lifted from vendor/steward.js and driven over a REAL
// nostr-tools SimplePool against a REAL scripts/gateway.mjs relay (throwaway church, random port, temp dir). No
// stubs on the auth path. clockLooksWrong/measureRelaySkew are stubbed ONLY so the lifted slice resolves; the
// scenarios here are the 'locked' kind, which never consults the clock.
//
// MEASURED RED/GREEN, 2026-11-10: shipped 3/0; with healStuckLogin's `_reconnectStale()` neutered to `false`,
// the self-heal test reddens (the stuck login is never recovered).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { normalizeURL } from 'nostr-tools/utils';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';

const ROOT = new URL('../', import.meta.url).pathname;
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const MEMBER_D = 'trinityone/member:', NAMEKEY_D = 'trinityone/namekey:';

const MNEMONIC = generateSeedWords();
const CH_SK = privateKeyFromSeedWords(MNEMONIC);
const CH_PUB = getPublicKey(CH_SK);
const K = () => { const s = privateKeyFromSeedWords(generateSeedWords()); return { sk: s, pub: getPublicKey(s) }; };
const PORT = 20000 + Math.floor(Math.random() * 20000);
const WS_URL = `ws://127.0.0.1:${PORT}/relay`, URLS = [WS_URL];
let relayProc = null, dataDir = null;

const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ...extra], content: JSON.stringify(content) }, who.sk);
function publishRaw(url, evt) {
  return new Promise((res, rej) => {
    const w = new WebSocket(url);
    const to = setTimeout(() => { try { w.close(); } catch {} rej(new Error('timeout')); }, 6000);
    w.on('open', () => w.send(JSON.stringify(['EVENT', evt])));
    w.on('message', d => { try { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { clearTimeout(to); w.close(); res(m[2] === true ? true : m[3]); } } catch {} });
    w.on('error', e => { clearTimeout(to); rej(e); });
  });
}
function sliceBetween(a, b) { const i = STEWARD.indexOf(a), j = STEWARD.indexOf(b, i); if (i < 0 || j < 0) throw new Error('slice anchors missing: ' + a); return STEWARD.slice(i, j); }
function grab(sig) {
  let at = STEWARD.indexOf(sig); if (at < 0) throw new Error('grab missing: ' + sig);
  if (STEWARD.slice(at - 6, at) === 'async ') at -= 6;
  let depth = 0, q = '';
  for (let i = STEWARD.indexOf('{', at); i < STEWARD.length; i++) {
    const c = STEWARD[i], prev = STEWARD[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && STEWARD[i + 1] === '/') { i = STEWARD.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return STEWARD.slice(at, i + 1);
  }
  throw new Error('brace match failed: ' + sig);
}
const MACHINERY = sliceBetween('var _relaysTouched = ', 'var _keyReadEpoch = 0;');
const M = { healthy: grab('relaysHealthy() {'), mark: grab('markResubscribed() {') };

function makeConsole({ locked }) {
  const pool = new SimplePool({ verifyEvent, websocketImplementation: WebSocket, maxWaitForConnection: 1500 });
  const scope = {
    pool, relays: () => URLS, actingChurch: '', normalizeURL, normalizeURL2: normalizeURL, finalizeEvent, finalizeEvent2: finalizeEvent,
    _clearanceSent: new Map(), _returnAnnounced: new Map(), _runKeyReadAuthWaiters: () => {}, CHURCH_SK: CH_SK, CHURCH_PUB: CH_PUB, LOCKED: !!locked,
    // stubbed ONLY to resolve the lifted slice; the 'locked'-kind path under test never reads the clock.
    measureRelaySkew: async () => {}, clockLooksWrong: () => false, _skewMeasuredAt: 0, _relaySkewSec: 0, performance,
    window: { Steward: {}, dispatchEvent() { return true; } }, CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), console: { warn() {}, log() {} },
    setTimeout, clearTimeout, Promise, Map, Set, WeakSet, Object, String, Number, JSON, Uint8Array, Array, Date, Math,
  };
  const names = Object.keys(scope);
  const body = `
    ${MACHINERY}
    sk = LOCKED ? null : CHURCH_SK; pub = CHURCH_PUB;
    const _api = { ${M.healthy}, ${M.mark},
      relayAuthed() { return _isRelayAuthed(); },
      authState() { return _authState(); },
      healStuckLogin() { return _healStuckLogin(); },
      setSk(v) { sk = v ? CHURCH_SK : null; },
      live(u) { let k=u; try{k=normalizeURL2(u);}catch(e){} const r=pool.relays.get(k); return r ? (r.connected===true?'connected':'present') : 'absent'; },
    };
    return _api;`;
  const api = new Function(...names, body)(...names.map(n => scope[n]));
  return { ...api, pool, close: () => { try { pool.destroy(); } catch {} } };
}
function sub(c) { const s = c.pool.subscribeMany(URLS, [{ kinds: [30078], '#d': [MEMBER_D + CH_PUB] }, { kinds: [30078], '#d': [NAMEKEY_D + CH_PUB] }], { onevent() {}, oneose() {} }); c.markResubscribed(); return s; }
function gated(pool) { return new Promise((res) => { const ids = new Set(); const s = pool.subscribeMany(URLS, [{ kinds: [30078], '#d': [NAMEKEY_D + CH_PUB], limit: 4 }], { onevent(e) { ids.add(e.id); }, oneose() {} }); setTimeout(() => { try { s.close(); } catch {} res(ids.size); }, 2600); }); }

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), `trin-heal-${PORT}-`));
  relayProc = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(CH_PUB) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const church = { sk: CH_SK, pub: CH_PUB };
  for (let i = 0; i < 40; i++) { if (await publishRaw(WS_URL, doc(church, NAMEKEY_D + CH_PUB, { env: 'sealed' })) === true) break; await sleep(250); }
  for (const m of Array.from({ length: 5 }, () => K())) { for (let i = 0; i < 10; i++) { if (await publishRaw(WS_URL, doc(m, MEMBER_D + CH_PUB, { joined: now() }, [['p', CH_PUB]])) === true) break; await sleep(150); } }
});
after(() => { try { relayProc && relayProc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a LOGIN IN FLIGHT (no failure yet) is not torn down — healStuckLogin returns "ok"', async () => {
  const c = makeConsole({ locked: false });
  const s = sub(c);
  // the instant after subscribing, the login is in flight: nothing has FAILED, so authState must not say failed
  assert.equal(c.authState().failed, false, 'a login still in flight must not read as failed');
  assert.equal(await c.healStuckLogin(), 'ok', 'healStuckLogin must not act on an in-flight login');
  // and it still logs in normally
  for (let i = 0; i < 8; i++) { await sleep(1000); if (c.relayAuthed()) break; }
  assert.equal(c.relayAuthed(), true, 'the normal login still completed');
  try { s.close(); } catch {} c.close();
});

test('a STALLED login (key locked when challenged) is healed after unlock', async () => {
  const c = makeConsole({ locked: true });   // sk=null → automaticallyAuth throws, socket stays up unauthed
  const s = sub(c);
  await sleep(4000);                          // > LOGIN_PROVOKE_MS: the challenge fires, signing throws 'no key'
  assert.equal(c.live(WS_URL), 'connected', 'the socket is UP (healthy to the old ticker)');
  assert.equal(c.relayAuthed(), false, 'but it is NOT logged in');
  assert.equal(c.authState().failed, true, 'authState reports the recorded failure with nothing accepted');
  // UNLOCK: the key arrives. healStuckLogin should now close the stale socket.
  c.setSk(true);
  const verdict = await c.healStuckLogin();
  assert.equal(verdict, 'closed', 'healStuckLogin tore down the stale socket');
  try { s.close(); } catch {}
  await sleep(500);                 // let the close settle before the fresh socket opens (as GAP1-REPRO does)
  // re-subscribe (what the ticker does on "closed") → a fresh socket re-challenges → signs with the key now present
  const s2 = sub(c);
  const g = await gated(c.pool);    // a gated read also re-provokes the login (its REQ is withheld until authed)
  for (let i = 0; i < 10; i++) { await sleep(1000); if (c.relayAuthed()) break; }
  assert.equal(c.relayAuthed(), true, 'the console logged itself back in — no reload needed');
  assert.ok(g >= 1 || await gated(c.pool) >= 1, 'and the gated read now returns');
  try { s2.close(); } catch {} c.close();
});

test('a healthy, logged-in console is left alone — healStuckLogin returns "ok"', async () => {
  const c = makeConsole({ locked: false });
  const s = sub(c);
  for (let i = 0; i < 8; i++) { await sleep(1000); if (c.relayAuthed()) break; }
  assert.equal(c.relayAuthed(), true);
  assert.equal(await c.healStuckLogin(), 'ok', 'nothing to heal when logged in');
  try { s.close(); } catch {} c.close();
});
