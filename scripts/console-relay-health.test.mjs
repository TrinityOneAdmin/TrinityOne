// After one dropped socket the console must know it is blind — instead of reporting itself healthy for ever.
// Run: node --test scripts/console-relay-health.test.mjs
//
// HANDOFF-2026-07-31, finding 4. `relaysHealthy()` decides whether the console's ONE shared reconnect ticker
// re-subscribes (app/steward-root.jsx:29-40 — it bumps only when relaysHealthy() is false, deliberately, so a
// healthy socket never triggers a full-corpus re-query). It was written as:
//
//     for (const url of relays()) { if (st.get(url) === false) return false; }
//     return true;
//
// which asks "is any relay recorded as DOWN". But nostr-tools does not record a dead relay as down — it
// removes it outright:
//
//     relay.onclose = () => { this.relays.delete(url); };        // AbstractSimplePool.ensureRelay
//
// and `enableReconnect` is false, so nothing ever puts it back. `listConnectionStatus()` builds its map by
// walking `this.relays`, so a relay that has dropped has NO ENTRY: `st.get(url)` is `undefined`, never `false`.
// The check therefore passes, the ticker never fires, and nothing re-subscribes.
//
// Observed on 2026-07-30: a live subscription saw 6 members → the relay was killed → restarted → a 7th member
// joined → the console still showed 6, with `relaysHealthy() === true` throughout. Only a manual reload
// recovered it. A steward watching the Members tab during a deploy — and a8 restarts on every deploy — simply
// stops seeing new joins, with nothing on screen suggesting anything is wrong.
//
// THE FIX MUST NOT OVERSHOOT. The naive form (`if (st.get(url) !== true) return false`) reads UNHEALTHY at
// boot, when the pool map is legitimately empty because nothing has connected yet. The ticker would then fire
// immediately and repeatedly, and the steward subscriptions are broad and un-cursored — that is a full re-query
// of the entire church, every time. The comment in steward-root.jsx exists to prevent exactly that. So the rule
// has to be "a relay we have ACTUALLY had open is now missing", which needs the console to remember which ones
// it opened. Both directions are tested below; the boot case is not a nicety, it is the more expensive bug.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { normalizeURL } from 'nostr-tools/utils';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8990;          // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const DEAD_PORT = 8991;     // deliberately NEVER bound
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const DEAD_URL = `ws://127.0.0.1:${DEAD_PORT}/relay`;
const MEMBER_D = 'trinityone/member:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();
let relay, dataDir;

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

async function startRelay() {
  dataDir = dataDir || mkdtempSync(join(tmpdir(), 'trin-relayhealth-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error('the test relay never came up on port ' + PORT);
}
before(async () => {
  await requireFreePort(PORT, 'console-relay-health.test.mjs');
  await requireFreePort(DEAD_PORT, 'console-relay-health.test.mjs (its deliberately-dead relay port)');
  await startRelay();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

function grab(sig) {
  let at = STEWARD.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped console bundle — re-anchor this test, or rebuild: bash scripts/build-steward.sh');
  if (STEWARD.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
  let depth = 0, q = '';
  for (let i = STEWARD.indexOf('{', at); i < STEWARD.length; i++) {
    const c = STEWARD[i], prev = STEWARD[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && STEWARD[i + 1] === '/') { i = STEWARD.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return STEWARD.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

// The shipped relaysHealthy() over a REAL SimplePool. The whole finding lives in what nostr-tools does to its
// own relay map on close, so a stubbed pool would assert my reading of the library rather than the library.
function consoleSide(urls) {
  const pool = new SimplePool({ verifyEvent, websocketImplementation: WebSocket, maxWaitForConnection: 1500 });
  // The console ALWAYS answers a NIP-42 challenge (src/steward.src.js — `pool.automaticallyAuth`), and the
  // relay serves the member roster only to an authenticated reader. Without this the subscription below reads
  // an empty church and the end-to-end test fails for a reason that has nothing to do with relay health.
  pool.automaticallyAuth = () => async (authEvent) => finalizeEvent(authEvent, church.sk);
  const healthy = grab('relaysHealthy() {');
  // The fix has to remember which relays were actually opened. However that is spelled, it has to be wired to
  // the pool's own success callback — bind whatever the bundle installs, so this test follows the shipped code
  // rather than dictating a shape to it.
  // Lift the tracking set and its pool wiring alongside the method. These lines are what make the check work
  // at all, so taking them from the bundle rather than re-declaring them here is the difference between
  // testing the shipped console and testing a description of it.
  // Brace-matched, NOT line-matched: esbuild reflows `pool.onX = (url) => { … }` across several lines, so a
  // per-line regex tuned to the source shape stops matching the bundle — the file that actually ships. The
  // first version of this lift did exactly that and every test here failed at once, which at least fails
  // loudly; the dangerous version is one that matches nothing and is spliced in as an empty string.
  const from = STEWARD.indexOf('var _relaysTouched = ');
  assert.ok(from > 0, 'the console no longer remembers which relays it has opened. relaysHealthy() cannot tell ' +
    'a relay that dropped (deleted from the pool map) from one that was never dialled — re-anchor this test, ' +
    'or rebuild: bash scripts/build-steward.sh');
  const failAt = STEWARD.indexOf('pool.onRelayConnectionFailure = ', from);
  const okAt = STEWARD.indexOf('pool.onRelayConnectionSuccess = ', from);
  assert.ok(failAt > 0 && okAt > 0 && failAt - from < 2000 && okAt - from < 2000,
    'the relay-tracking set is no longer wired to BOTH pool connection callbacks, so either a dropped relay or ' +
    'one that never opened stops counting, and relaysHealthy() goes back to answering true through it');
  let depth = 0, end = STEWARD.indexOf('{', Math.max(failAt, okAt));
  for (; end < STEWARD.length; end++) {
    if (STEWARD[end] === '{') depth++;
    else if (STEWARD[end] === '}' && --depth === 0) break;
  }
  const wiring = STEWARD.slice(from, STEWARD.indexOf(';', end) + 1);
  assert.match(wiring, /_relaysTouched\.add/, 'nothing in the wiring actually records a relay — re-anchor this test');
  const scope = { pool, relays: () => urls, normalizeURL, console: { warn() {}, log() {} }, Set, String, JSON };
  const args = Object.keys(scope);
  const built = new Function(...args, `${wiring}\nreturn ({ ${healthy} });`)(...args.map(k => scope[k]));
  return { ...built, pool, close: () => { try { pool.destroy(); } catch {} } };
}

const memberDoc = (who) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', MEMBER_D + church.pub], ['t', 'trinityone']], content: JSON.stringify({ joined: now() }) }, who.sk);

const publishRaw = (evt) => new Promise((res, rej) => {
  const w = new WebSocket(WS_URL);
  w.on('open', () => w.send(JSON.stringify(['EVENT', evt])));
  w.on('message', d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.close(); res(m[2]); } });
  w.on('error', rej);
  setTimeout(() => { try { w.close(); } catch {} rej(new Error('publish timed out')); }, 6000);
});

// ── the boot case, first, because a wrong fix here is more expensive than the bug ────────────────────────
test('CONTROL: a console that has not connected to anything yet reads HEALTHY', () => {
  // The pool map is empty at boot. If this reads unhealthy the reconnect ticker fires straight away and keeps
  // firing, and every steward subscription is broad and un-cursored — a full re-query of the whole church.
  const s = consoleSide([WS_URL]);
  assert.equal(s.relaysHealthy(), true,
    'a freshly-booted console with an empty pool reports itself unhealthy. The reconnect ticker fires on ' +
    'false, so this re-queries the entire church immediately and then every 90 seconds, for ever.');
  s.close();
});

test('CONTROL: a relay that is up and subscribed reads HEALTHY', async () => {
  const s = consoleSide([WS_URL]);
  const sub = s.pool.subscribeMany([WS_URL], [{ kinds: [30078], '#d': [MEMBER_D + church.pub] }], { onevent() {}, oneose() {} });
  await sleep(600);
  assert.equal(s.relaysHealthy(), true, 'a live, connected relay reads unhealthy — the fix has overshot');
  try { sub.close(); } catch {}
  s.close();
});

// ── the finding ──────────────────────────────────────────────────────────────────────────────────────────
test('A RELAY THAT HAS DROPPED MUST READ UNHEALTHY, NOT HEALTHY', async () => {
  const s = consoleSide([WS_URL]);
  const sub = s.pool.subscribeMany([WS_URL], [{ kinds: [30078], '#d': [MEMBER_D + church.pub] }], { onevent() {}, oneose() {} });
  await sleep(600);
  assert.equal(s.relaysHealthy(), true, 'the relay was not healthy before it was killed — the fixture is broken');
  assert.equal(s.pool.listConnectionStatus().size, 1, 'the pool never opened the relay — the fixture is broken');

  relay.kill('SIGKILL');
  await sleep(1200);

  // This is the crux. nostr-tools DELETED the relay from its map on close, so there is no `false` to find.
  assert.equal(s.pool.listConnectionStatus().get(WS_URL), undefined,
    'nostr-tools now keeps a closed relay in its map. If it records `false` the original check would have ' +
    'worked and this finding is obsolete — re-read relaysHealthy() before changing anything.');
  assert.equal(s.relaysHealthy(), false,
    'the console reports itself HEALTHY with its only relay dead. The reconnect ticker fires only when this ' +
    'is false, so nothing re-subscribes: the steward keeps watching a Members tab that will never update ' +
    'again, with nothing on screen to say so. Only a manual reload recovers it.');
  try { sub.close(); } catch {}
  s.close();
  await startRelay();
});

test('an unreachable relay that was NEVER up also reads unhealthy once we have tried it', async () => {
  // A console pointed at a relay it cannot open should not sit there believing it is fine. This is the
  // publish-side failure path (onRelayConnectionFailure) rather than a close, and it must not be missed.
  const s = consoleSide([DEAD_URL]);
  const sub = s.pool.subscribeMany([DEAD_URL], [{ kinds: [30078] }], { onevent() {}, oneose() {} });
  await sleep(2500);            // maxWaitForConnection is 1500ms
  assert.equal(s.relaysHealthy(), false,
    'a relay the console has tried and failed to open reads healthy, so nothing will ever retry it');
  try { sub.close(); } catch {}
  s.close();
});

test('…and it reads healthy again once the relay is back and re-subscribed', async () => {
  // Recovery must actually close the loop, or the console flips to permanently-unhealthy instead of
  // permanently-healthy — a re-query storm rather than blindness. Same cost, opposite sign.
  const s = consoleSide([WS_URL]);
  const sub1 = s.pool.subscribeMany([WS_URL], [{ kinds: [30078], '#d': [MEMBER_D + church.pub] }], { onevent() {}, oneose() {} });
  await sleep(600);
  relay.kill('SIGKILL');
  await sleep(1200);
  assert.equal(s.relaysHealthy(), false, 'the drop was not detected — the fixture is broken');
  try { sub1.close(); } catch {}
  await startRelay();
  const sub2 = s.pool.subscribeMany([WS_URL], [{ kinds: [30078], '#d': [MEMBER_D + church.pub] }], { onevent() {}, oneose() {} });
  await sleep(900);
  assert.equal(s.relaysHealthy(), true,
    'the relay is back and re-subscribed but the console still reads unhealthy. The ticker fires on false, so ' +
    'this re-queries the entire church every 90 seconds for the rest of the session.');
  try { sub2.close(); } catch {}
  s.close();
});

test('a relay the steward has REMOVED stops counting against health', async () => {
  // The pruning case, and the one a "remember every relay we ever opened" fix gets wrong. Once a URL is no
  // longer in relays() it will never reconnect, so holding it against health pins the console unhealthy for
  // ever — the re-query storm again, arrived at from the other side.
  const s = consoleSide([WS_URL]);
  const sub = s.pool.subscribeMany([WS_URL], [{ kinds: [30078], '#d': [MEMBER_D + church.pub] }], { onevent() {}, oneose() {} });
  await sleep(600);
  relay.kill('SIGKILL');
  await sleep(1200);
  assert.equal(s.relaysHealthy(), false, 'the drop was not detected — the fixture is broken');
  try { sub.close(); } catch {}
  s.close();
  await startRelay();

  // Same console state, but that relay is no longer configured.
  const gone = consoleSide([]);
  const sub2 = gone.pool.subscribeMany([WS_URL], [{ kinds: [30078] }], { onevent() {}, oneose() {} });
  await sleep(600);
  relay.kill('SIGKILL');
  await sleep(1200);
  assert.equal(gone.relaysHealthy(), true,
    'a relay the steward removed from their list still counts against health, so the console is unhealthy for ' +
    'ever and re-queries the whole church every 90 seconds');
  try { sub2.close(); } catch {}
  gone.close();
  await startRelay();
});

// ── end to end: the symptom the steward actually reported ────────────────────────────────────────────────
test('AFTER A RESTART A NEW MEMBER IS SEEN WITHOUT RELOADING THE CONSOLE', async () => {
  // The measured symptom: 6 members → relay killed → restarted → a 7th joined → console still showed 6.
  // relaysHealthy() is the gate on the whole recovery path, so this is what it is FOR.
  const s = consoleSide([WS_URL]);
  const seen = new Set();
  // The member roster is a default-DENY read (gateway.mjs canRead, kind 30078: `if (!authed) return false`),
  // and the relay's NIP-42 challenge is LAZY — it only challenges a REQ that names an invite group, a
  // safeguarding doc or a safety d-tag. So an unauthenticated console gets a clean EOSE and an empty church,
  // which looks exactly like the bug under test. The real console dodges this by subscribing to safety checks
  // among its ~20 subscriptions; reproduce that here, then subscribe to the roster on the now-authenticated
  // socket. Without this the whole test passes or fails for reasons that have nothing to do with relay health.
  const resub = () => {
    const auth = s.pool.subscribeMany([WS_URL], [{ kinds: [30078], '#d': ['trinityone/safetycheck:' + church.pub] }],
      { onevent() {}, oneose() {} });
    return sleep(900).then(() => {
      const roster = s.pool.subscribeMany([WS_URL], [{ kinds: [30078], '#d': [MEMBER_D + church.pub] }],
        { onevent(e) { seen.add(e.pubkey); }, oneose() {} });
      return { close() { try { auth.close(); } catch {} try { roster.close(); } catch {} } };
    });
  };
  let sub = await resub();
  const before6 = Array.from({ length: 6 }, K);
  for (const m of before6) assert.equal(await publishRaw(memberDoc(m)), true, 'the relay refused a member join — fixture broken');
  await sleep(900);
  // Identities, not just a count. An earlier version of this test compared `seen.size` only, and a typo
  // (`.pubkey` for `.pub`) meant the final assertion was asking `seen.has(undefined)` — permanently red, for a
  // reason that had nothing to do with the console. Count assertions hide which member is missing.
  for (const m of before6) assert.ok(seen.has(m.pub), 'the live subscription missed a member before the kill — fixture broken');
  assert.equal(seen.size, 6, `the live subscription saw ${seen.size} members, expected exactly 6 — fixture broken`);

  relay.kill('SIGKILL');
  await sleep(1200);
  try { sub.close(); } catch {}
  await startRelay();
  const seventh = K();
  assert.equal(await publishRaw(memberDoc(seventh)), true, 'the relay refused the 7th join — fixture broken');
  await sleep(400);

  // This is the console's reconnect ticker, reduced to its one decision: it re-subscribes ONLY when
  // relaysHealthy() is false (app/steward-root.jsx `_maybeBumpConn`).
  if (!s.relaysHealthy()) sub = await resub();
  await sleep(1200);

    assert.ok(seen.has(seventh.pub),
    `the console never saw the member who joined after the relay restarted (it has ${seen.size} of 7). ` +
    'relaysHealthy() reported true throughout, so the reconnect ticker never fired and the subscription was ' +
    'never rebuilt. This is what a steward sees during any deploy: joins simply stop appearing.');
  try { sub.close(); } catch {}
  s.close();
});
