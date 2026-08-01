// A console that cannot reach a relay must SAY SO. Every steward write depends on this one function.
// Run: node --test scripts/console-publish-honesty.test.mjs
//
// HANDOFF-2026-07-31, finding 1 — the most severe thing in that document, and the smallest.
//
// `publish()` does `await Promise.any(pool.publish(relays(), evt))`. When nostr-tools cannot open the socket it
// does NOT reject — it RESOLVES the per-relay promise with a plain string:
//
//     } catch (err) {
//       this.onRelayConnectionFailure?.(url);
//       return String("connection failure: " + String(err));      // nostr-tools SimplePool.publish
//     }
//
// A resolution satisfies `Promise.any`. So publish() falls straight through to its success path: it fires
// `steward-publish-ok`, returns the event, and every caller above it — clearances, the minors list, the
// blocklist, group keys, the name-key envelope — reports SAVED while nothing left the device.
//
// Measured on 2026-07-30 with the relay killed: refreshClearances over 21 members returned
// `{failed: 0, total: 21}`, fired 21 `steward-publish-ok`, showed no banner, stored nothing — and the
// dashboard then recorded the back-fill as done and never retried it.
//
// This is the failure mode the product is built for. "Does this work over a thin pipe in Tehran" is the
// question, and the honest answer before this fix was that the console lies about every save on a flapping
// link, most quietly at exactly the moment it matters.
//
// WHAT THIS FILE DRIVES: the shipped `publish()` lifted out of vendor/steward.js, wired to a REAL nostr-tools
// SimplePool. The "connection failure" string is produced by the library itself, not by a stub — a stub would
// be asserting my own understanding of nostr-tools rather than nostr-tools. `pinned the prefix` below keeps
// the bundle and the library honest with each other across a version bump.
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
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8988;          // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const DEAD_PORT = 8989;     // deliberately NEVER bound — this is the unreachable relay
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const DEAD_URL = `ws://127.0.0.1:${DEAD_PORT}/relay`;
const CLEAR_D = 'trinityone/clearance:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();
const members = Array.from({ length: 21 }, K);   // 21: the roster size the finding was measured on
let relay, dataDir;

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// One of the tests below KILLS the relay on purpose — that is the flapping-link case. Bring it back after,
// or every later test talks to a dead port and passes for the wrong reason. That is not hypothetical: while
// writing this file the "a genuine refusal must still raise the banner" test went green against a relay that
// was not running, because publish() returned false for a connection failure rather than for the refusal it
// claimed to be testing. A false green in a safeguarding test is worse than no test.
async function startRelay() {
  dataDir = dataDir || mkdtempSync(join(tmpdir(), 'trin-pubhonesty-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error('the test relay never came up on port ' + PORT);
}

before(async () => {
  await requireFreePort(PORT, 'console-publish-honesty.test.mjs');
  // The unreachable relay must be genuinely unreachable. If something IS listening on DEAD_PORT the
  // "connection failure" tests would connect, the assertions would invert, and a real bug could read green.
  await requireFreePort(DEAD_PORT, 'console-publish-honesty.test.mjs (its deliberately-dead relay port)');
  await startRelay();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// Brace-match a function/method out of the bundle. Same shape as clearance-backfill.test.mjs — a fixed-window
// slice stops matching the moment esbuild reflows the file, and then tests nothing while staying green.
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

// The shipped publish() + publishClearance() + refreshClearances(), over a real pool pointed at `urls`.
// `clock` overrides the console's now(). The relay's tie-break is decided by created_at, so a test that wants
// a collision on purpose has to control the clock — see "the relay already holds a newer version" below.
// `mutate` rewrites the lifted source before it is compiled — used to SABOTAGE a specific guard and prove the
// test fails without it. A guard nothing can break is a guard nothing is testing.
function consoleSide(urls, clock, ident, mutate) {
  const pool = new SimplePool({ verifyEvent, websocketImplementation: WebSocket, maxWaitForConnection: 1500 });
  const events = [];                                    // every window event the console fired

  // ── lift everything first, THEN build the scope ────────────────────────────────────────────────────────
  const publishSrc = grab('async function publish(evt)');
  const pubClearance = grab('publishClearance(memberPub, status)');
  const refresh = grab('refreshClearances(memberPubs, minors, approved)');
  // NOT grab('_refreshClearancesNow(...)'): its first occurrence is the CALL inside the refreshClearances
  // wrapper, so brace-matching from there returns the wrapper's tail. Anchor on the `async ` declaration.
  const refreshNow = grab('async _refreshClearancesNow(memberPubs, minors, approved)');
  const newest = grab('function _newestByD(');
  const connected = grab('function _connectedRelays(');
  // The read-and-compare step now lives in one shared helper, used BOTH to skip redundant writes and to verify
  // before alarming. Lifted here for the same reason: two copies would drift, and the second copy is the one
  // that decides whether a safeguarding warning is true.
  const matching = grab('async function _clearancesMatching(')
    // The cross-author ranking rule lives beside it and is called from inside it. Unlifted, the call
    // throws ReferenceError into _clearancesMatching's own catch, which returns null — "could not
    // check" — so the harness would quietly measure the no-read path and skip nothing.
    + grab('function _clearanceOutranks(');
  // The connection wiring — _relaysTouched, _subbedOn, and the onRelayConnection* hooks. The reconciliation
  // that clears the just-published cache when a relay (re)connects lives in onRelayConnectionSuccess, so a
  // harness without this block does not contain the mechanism at all and cannot test it.
  const touchFrom = STEWARD.indexOf('var _relaysTouched = ');
  assert.ok(touchFrom > 0, 'the relay-tracking block is gone from the bundle — re-anchor this test');
  let td = 0, te = STEWARD.indexOf('{', STEWARD.indexOf('pool.onRelayConnectionFailure = ', touchFrom));
  for (; te < STEWARD.length; te++) { if (STEWARD[te] === '{') td++; else if (STEWARD[te] === '}' && --td === 0) break; }
  const touchWiring = STEWARD.slice(touchFrom, STEWARD.indexOf(';', te) + 1);
  assert.match(touchWiring, /_clearanceSent\.clear\(\)/,
    'a relay (re)connecting no longer clears the just-published cache, so a console keeps skipping members ' +
    'on the strength of relays that were not there when they were written');
  const isAuthed = grab('function _isRelayAuthed(');
  // The read is gated on a COMPLETED auth, so the auth wiring is part of what is under test. Lifting it beats
  // stubbing it: a stub would assert my description of the auth state rather than the console's.
  const authFrom = STEWARD.indexOf('var _authedRelays = ');
  assert.ok(authFrom > 0, 'the auth-state machinery is gone from the bundle — re-anchor this test');
  let ad = 0, ae = STEWARD.indexOf('{', STEWARD.indexOf('pool.automaticallyAuth = ', authFrom));
  for (; ae < STEWARD.length; ae++) { if (STEWARD[ae] === '{') ad++; else if (STEWARD[ae] === '}' && --ad === 0) break; }
  const authWiring = STEWARD.slice(authFrom, STEWARD.indexOf(';', ae) + 1);
  const sentDecl = (STEWARD.match(/var _clearanceSent = [^\n]*\n/) || [])[0];
  const queueDecl = (STEWARD.match(/var _clearanceQueue = [^\n]*\n/) || [])[0];
  assert.ok(sentDecl, 'the just-published clearance cache is gone — the sub-second toggle collision is back');
  assert.ok(queueDecl, 'refreshClearances is no longer serialised, so two concurrent runs collide again');

  // esbuild RENAMES imported bindings (encrypt3, decrypt3, finalizeEvent2, normalizeURL2 today). Bind the
  // names it actually emitted, and fail loudly if a rebuild renumbers them. This is not fussiness: binding
  // `finalizeEvent` when the bundle says `finalizeEvent2` made the auth signer throw, nostr-tools logged
  // `subscribe auth function failed`, no AUTH frame was ever sent, the relay withheld every private doc, and
  // the read-before-write tests failed for a reason that had nothing to do with the code under test.
  const pick = (src, base) => (src.match(new RegExp('\\b(' + base + '\\d*)\\(')) || [])[1];
  const encName = pick(pubClearance, 'encrypt');
  const ckName = pick(pubClearance, 'getConversationKey');
  const decName = pick(matching, 'decrypt');
  const feName = pick(authWiring, 'finalizeEvent');
  // NO SILENT DEFAULT. The shipped code wraps its getPublicKey call in a try/catch that falls back to the
  // church pubkey — the safe direction in production, but in a harness with the wrong binding it silently
  // reproduces the exact bug under test and the delegated tests fail for the wrong reason. (They did.)
  const gpName = pick(matching, 'getPublicKey');
  assert.ok(gpName, 'refreshClearances no longer resolves its own signing pubkey — re-anchor this test');
  const normName = pick(authWiring, 'normalizeURL') || pick(isAuthed, 'normalizeURL') || 'normalizeURL';
  for (const [n, v] of [['encrypt', encName], ['getConversationKey', ckName], ['decrypt', decName], ['finalizeEvent', feName]]) {
    assert.ok(v, 'the shipped code no longer calls ' + n + ' where this test expects it — re-anchor');
  }

  const scope = {
    pool, relays: () => urls,
    // A DELEGATED steward console signs with its OWN key while reading in the church's context:
    // setActiveIdentity sets sk = the steward's key, pub = the church, actingChurch = the church.
    sk: (ident && ident.sk) || church.sk,
    pub: (ident && ident.pub) || church.pub,
    actingChurch: (ident && ident.actingChurch) || '',
    CLEARANCE_D: CLEAR_D, NET: 'trinityone',
    now: clock || now, [gpName]: getPublicKey,
    // Mirrors the shipped feChurch: adds the church tag when acting as a delegated steward, and signs with
    // the ACTIVE key — which for a delegated console is the steward's own, not the church's.
    feChurch: (t) => {
      const acting = (ident && ident.actingChurch) || '';
      const tags = acting && !(t.tags || []).some(x => x[0] === 'church')
        ? [...(t.tags || []), ['church', acting]] : t.tags;
      return finalizeEvent({ ...t, tags }, (ident && ident.sk) || church.sk);
    },
    toPubHex: (p) => (/^[0-9a-f]{64}$/i.test(p) ? p.toLowerCase() : null),
    [encName]: (a, k) => nip44v2.encrypt(a, k),
    [decName]: (c, k) => nip44v2.decrypt(c, k),
    [ckName]: (a, b) => nip44v2.utils.getConversationKey(a, b),
    [feName]: finalizeEvent,
    [normName]: normalizeURL,
    window: { Steward: {}, dispatchEvent: (e) => { events.push(e); } },
    CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    console: { warn() {}, log() {} },
    setTimeout, Promise, Set, Map, String, JSON, Date,
  };
  const args = Object.keys(scope);
  // The whole program, INCLUDING the methods in the return expression — refreshClearances and
  // _refreshClearancesNow live there, and a sabotage hook that could not reach them silently matched nothing.
  let body = sentDecl + queueDecl + touchWiring + authWiring + isAuthed + newest + connected + matching + publishSrc
    + `\nreturn ({ publish, _isRelayAuthed, ${pubClearance},\n ${refresh},\n ${refreshNow} });`;
  if (mutate) {
    const before = body;
    body = mutate(body);
    assert.notEqual(body, before, 'the sabotage did not match the shipped source — re-anchor it, or it is ' +
      'proving nothing while staying green');
  }
  const built = new Function(...args, body)(...args.map(k => scope[k]));
  Object.assign(scope.window.Steward, built);
  return {
    ...built, pool, urls,
    ok: () => events.filter(e => e.type === 'steward-publish-ok').length,
    err: () => events.filter(e => e.type === 'steward-publish-error').length,
    banners: () => events.filter(e => e.type === 'steward-write-blocked'),
    close: () => { try { pool.destroy(); } catch {} },
  };
}

// Assert every named relay is actually connected. read-before-write only consults relays it is connected to,
// so a multi-relay test that does not wait for the second socket measures the single-relay path and passes
// for the wrong reason.
async function requireConnected(s, urls) {
  const want3 = urls.map(u => normalizeURL(u));
  for (let i = 0; i < 60; i++) {
    const st = s.pool.listConnectionStatus();
    if (want3.every(u => st.get(u) === true)) return s;
    await sleep(100);
  }
  assert.fail('not every relay connected: ' + JSON.stringify([...s.pool.listConnectionStatus()]));
}

// The relay's NIP-42 challenge is LAZY (gateway.mjs) — it only challenges a REQ naming an invite group, a
// safeguarding doc or a safety d-tag. refreshClearances' read is gated on a COMPLETED auth, so a console that
// has never been challenged simply skips the read and publishes everything. Real consoles are challenged early
// by their ~20 subscriptions; provoke the same thing here, and WAIT for it, or these tests race the handshake.
async function authenticate(s) {
  // Subscribe to EVERY relay the console is configured with, because that is what the real console does — its
  // ~20 subscription hooks all call pool.subscribeMany(relays(), …). A test that subscribes to only one leaves
  // the others un-dialled, so read-before-write sees fewer "currently connected" relays than production would
  // and the multi-relay behaviour it is meant to exercise never happens.
  //
  // Deliberately left OPEN. Closing the last subscription lets the pool drop the socket, and the next REQ
  // opens a fresh, unauthenticated one — which is exactly what _isRelayAuthed() is designed to notice.
  s._authSub = s.pool.subscribeMany((s.urls || [WS_URL]).filter(u => u !== DEAD_URL),
    [{ kinds: [30078], '#d': ['trinityone/safetycheck:' + church.pub] }], { onevent() {}, oneose() {} });
  for (let i = 0; i < 40 && !s._isRelayAuthed(); i++) await sleep(100);
  assert.ok(s._isRelayAuthed(), 'the console never authenticated, so read-before-write is skipped entirely and ' +
    'these tests would pass or fail on the in-memory cache alone');
  // AND wait for every reachable relay's socket to actually be up. Auth completes as soon as ONE relay
  // challenges, which can be well before a second relay has connected — and read-before-write asks only the
  // relays it is currently connected to. Returning early made the multi-relay test pass or fail on timing.
  const want2 = (s.urls || [WS_URL]).filter(u => u !== DEAD_URL).map(u => normalizeURL(u));
  for (let i = 0; i < 60; i++) {
    const st = s.pool.listConnectionStatus();
    if (want2.every(u => st.get(u) === true)) break;
    await sleep(100);
  }
  // Best effort, NOT an assertion: some tests deliberately point the console at a relay that is down, and
  // that is a legitimate state. A test that needs every relay up asserts it itself — see requireConnected.
  return s;
}

const churchDoc = (d, body) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', 'trinityone'], ['church', church.pub]], content: JSON.stringify(body) }, church.sk);

// What the relay ACTUALLY HOLDS for each member, decrypted. Counting d-tags is not enough: a member left
// holding a STALE clearance has a document, so a presence count passes while their app still reads the wrong
// answer. That is the failure this whole file is about, so the assertion has to open the envelope.
// (The church can: nip44 conversation keys are symmetric.) AUDIT-4.
async function storedStatus(pubs) {
  const w = await new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
  const out = new Map();
  await new Promise(res => {
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, church.sk)]));
      if (m[0] === 'EVENT' && m[1] === 'q') {
        const e = m[2];
        const dtag = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        const pub = dtag.slice(CLEAR_D.length);
        try {
          const body = JSON.parse(nip44v2.decrypt(e.content, nip44v2.utils.getConversationKey(church.sk, pub)));
          const prev = out.get(pub);
          if (!prev || (e.created_at || 0) >= prev.at) out.set(pub, { minor: !!body.minor, cleared: !!body.cleared, at: e.created_at || 0 });
        } catch (x) { out.set(pub, { undecryptable: true }); }
      }
      if (m[0] === 'EOSE' && m[1] === 'q') { w.off('message', on); res(); }
    };
    w.on('message', on);
    w.send(JSON.stringify(['REQ', 'q', { kinds: [30078], '#d': pubs.map(p => CLEAR_D + p) }]));
    setTimeout(res, 8000);
  });
  w.close();
  return out;
}

async function storedCount(pubs) {
  const w = await new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
  const seen = new Set();
  await new Promise(res => {
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, church.sk)]));
      if (m[0] === 'EVENT' && m[1] === 'q') seen.add((m[2].tags.find(t => t[0] === 'd') || [])[1]);
      if (m[0] === 'EOSE' && m[1] === 'q') { w.off('message', on); res(); }
    };
    w.on('message', on);
    w.send(JSON.stringify(['REQ', 'q', { kinds: [30078], '#d': pubs.map(p => CLEAR_D + p) }]));
    setTimeout(res, 8000);
  });
  w.close();
  return seen.size;
}

// ── CONTROL ──────────────────────────────────────────────────────────────────────────────────────────────
// Runs first on purpose. A harness that cannot publish at all produces the same symptom as the bug — nothing
// stored — so without this, a broken harness reads as a confirmed finding. If this one fails, the TEST is
// broken, not the console.
test('CONTROL: against a LIVE relay the shipped publish() succeeds and the event really lands', async () => {
  const s = consoleSide([WS_URL]);
  const evt = churchDoc('trinityone/minors:' + church.pub, { pubkeys: [] });
  const r = await s.publish(evt);
  await sleep(300);
  s.close();
  assert.ok(r && r.id === evt.id, 'publish() did not report success against a healthy relay — the harness is broken');
  assert.equal(s.ok(), 1, 'no steward-publish-ok fired on a genuinely successful write');
  assert.equal(s.err(), 0, 'a successful write also reported an error');
});

// ── the finding ──────────────────────────────────────────────────────────────────────────────────────────
test('A CONSOLE THAT CANNOT REACH ANY RELAY MUST NOT REPORT THE WRITE AS SAVED', async () => {
  const s = consoleSide([DEAD_URL]);
  const r = await s.publish(churchDoc('trinityone/minors:' + church.pub, { pubkeys: [] }));
  s.close();
  assert.equal(r, false,
    'publish() returned ' + JSON.stringify(r) + ' with no relay reachable at all. nostr-tools RESOLVES a ' +
    'failed connection with the string "connection failure: …", which satisfies Promise.any, so the success ' +
    'path runs. Every console write — clearances, the minors list, the blocklist, group keys, the name-key ' +
    'envelope — tells the steward it saved while nothing left the device.');
  assert.equal(s.ok(), 0, 'steward-publish-ok fired for a write that never left the device');
  assert.equal(s.err(), 1, 'nothing fired steward-publish-error, so no screen can show the failure');
});

test('…and it still reports failure when SOME relays are configured but none answer', async () => {
  // relays() usually returns several. Promise.any needs only one resolution to fall through, so a fan-out of
  // unreachable relays is the same bug with more chances to hit it.
  const s = consoleSide([DEAD_URL, `ws://127.0.0.1:${DEAD_PORT}/relay2`, `ws://127.0.0.1:${DEAD_PORT}/relay3`]);
  const r = await s.publish(churchDoc('trinityone/approved:' + church.pub, { pubkeys: [] }));
  s.close();
  assert.equal(r, false, 'three unreachable relays still reported a successful save');
  assert.equal(s.ok(), 0, 'steward-publish-ok fired with every relay unreachable');
});

test('…and ONE reachable relay among unreachable ones is still a real save', async () => {
  // The other direction, and the one a careless fix breaks: publishing to a pool where most relays are down
  // must still succeed on the one that is up. A fix that made publish() require ALL relays would take the
  // product offline for anyone whose extra relay is flaky.
  const s = consoleSide([DEAD_URL, WS_URL]);
  const evt = churchDoc('trinityone/guardians:' + church.pub, {});
  const r = await s.publish(evt);
  await sleep(300);
  s.close();
  assert.ok(r && r.id === evt.id,
    'a write that DID land on a reachable relay was reported as failed because a different relay was down');
  assert.equal(s.ok(), 1, 'no success event fired for a write that genuinely landed');
});

test('with the relay unreachable, a whole-roster back-fill reports every member failed and raises the banner', async () => {
  const s = consoleSide([DEAD_URL]);
  const pubs = members.map(m => m.pub);
  const r = await s.refreshClearances(pubs, pubs.slice(0, 5), []);
  s.close();
  assert.equal(r.total, 21);
  assert.equal(r.failed, 21,
    `refreshClearances reported ${r.failed} of 21 failed with NO relay reachable. Measured on the device as ` +
    '{failed: 0, total: 21} — and on that answer the dashboard records the back-fill as done and never ' +
    'retries, so those children stay unclearanced until a steward happens to toggle a flag.');
  assert.equal(s.banners().length, 1, 'nothing told the steward that no safeguarding record was delivered');
  assert.match(s.banners()[0].detail.message, /21 of 21/, 'the banner undercounts a total failure');
});

test('a relay killed MID-SESSION is reported honestly too, not just one that was never there', async () => {
  // The device symptom was a socket that dropped, not a URL that was wrong. Connect for real, then take the
  // relay away — this is the flapping-link case the product exists for.
  const s = consoleSide([WS_URL]);
  const first = await s.publish(churchDoc('trinityone/minors:' + church.pub, { pubkeys: [members[0].pub] }));
  assert.ok(first, 'the control write failed before the relay was killed — the harness is broken');
  relay.kill('SIGKILL');
  await sleep(600);
  const after = await s.publish(churchDoc('trinityone/minors:' + church.pub, { pubkeys: [members[1].pub] }));
  s.close();
  await startRelay();          // put it back, or every test after this one runs against a dead port
  assert.equal(after, false,
    'after the relay went away the console still reported the write as saved. This is the flapping-link case: ' +
    'the steward sees "saved", the church key never received it, and nothing retries.');
});

test('GUARD: the relay really is back up before the tests below rely on it', async () => {
  // Cheap, and it turns "the relay never restarted" into its own named failure instead of a confusing cascade
  // of wrong answers in the safeguarding tests underneath.
  const r = await fetch(`http://127.0.0.1:${PORT}/status`);
  assert.ok(r.ok, 'the relay did not come back after the mid-session kill — every test below this is invalid');
});

// ── the tie-break must stay a FAILURE ────────────────────────────────────────────────────────────────────
// HANDOFF-2026-07-31 finding 2 proposed the opposite of this, it was implemented, and it was reverted the same
// day after audit. Keeping the test is the point: this is the shape of a mistake that is easy to talk yourself
// into a second time, because the reasoning for it sounds airtight.
//
// The argument was: `created_at` is whole seconds, so two writes of one member's clearance inside a second
// collide; the relay's NIP-01 tie-break refuses the loser with "a newer version of this is already stored";
// and since only the church key or a current steward can write a clearance (gateway.mjs:1362-1365 — verified,
// that part is true), the winner must be a legitimate, at-least-as-new version. So: not a lost child, don't
// raise the banner.
//
// It is wrong in two ways that cost a child their clearance:
//
//   • The tie-break compares created_at, NOT content. The relay accepts up to 900s of clock skew
//     (scripts/event-store.mjs), so a steward whose phone clock runs fast writes {minor:false} and BEATS the
//     correct {minor:true} that follows. Reproduced during audit: the correct write came back have-newer, the
//     run reported failed:0, no banner fired, and the back-fill recorded itself as done — so nothing ever
//     retried. event-store.mjs says it in its own comment: an honest-timestamped fix "is rejected as
//     'have-newer', pinning the stale state".
//   • The string is free text this gateway happens to emit (gateway.mjs:3720). It is not NIP-01 and it is
//     ATTACKER-SUPPLIED. A seized or compelled relay — the threat model — could answer it to every clearance
//     write and have the console report a clean save for records it silently dropped.
//
// Counting it as a failure is noisy and self-healing: the banner fires, the back-fill is not marked done, and
// the next visit retries with a fresh created_at that wins. The real cure for the noise is reading the doc back
// before writing (handoff item 7), which removes the collision instead of ignoring it.
test('A TIE-BREAK REFUSAL IS A FAILURE, NOT A SILENT SUCCESS', async () => {
  const s = consoleSide([WS_URL]);
  const pubs = members.slice(6, 10).map(m => m.pub);
  const t = now();
  const first = await authenticate(consoleSide([WS_URL], () => t));
  assert.equal((await first.refreshClearances(pubs, [], [])).failed, 0, 'the first write failed — fixture broken');
  first.close();

  // Drive the clock back a second AND change the answer. This is the real hazard: a steward whose clock runs
  // fast has already stored "not a minor", and the correct "IS a minor" that follows is refused as older. The
  // content differs, so read-before-write correctly decides it must be written — and the relay refuses it.
  // (With identical content there is nothing to write and nothing to refuse, which is the whole point of
  // item 7; this test needs a genuine disagreement to reach the tie-break at all.)
  const stale = await authenticate(consoleSide([WS_URL], () => t - 1));
  const r = await stale.refreshClearances(pubs, pubs, []);
  stale.close();
  s.close();
  assert.equal(r.skipped, 0, 'a member whose status CHANGED was skipped — read-before-write is over-eager');
  assert.equal(r.failed, 4,
    `the relay refused all 4 clearances and the run reported ${r.failed} failures. Treating "a newer version is ` +
    'already stored" as success is only safe if the stored version is also CORRECT, and the tie-break compares ' +
    'timestamps, not content — so a steward with a fast clock can pin {minor:false} over a child and nobody is ' +
    'told. The relay also chooses that string, so a compelled relay could claim it for every write.');
  assert.equal(stale.banners().length, 1, 'the steward was not told that four clearances did not land');
  assert.ok(!('haveNewer' in r) || r.haveNewer === 0,
    'refreshClearances is bucketing tie-break refusals away from `failed` again');
});

test('…and a run that lost the tie-break is NOT recorded as done', async () => {
  // The other half, and the half that makes it permanent. The dashboard records the back-fill as complete only
  // when `failed === 0`; if a tie-break refusal is not counted, a stale clearance is never revisited.
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const at = D.indexOf('let clearanceBackfillDone');
  const body = D.slice(D.indexOf('if (!sg.loaded) return', at), D.indexOf('}, [sg.loaded', at));
  assert.match(body, /if \(!r \|\| r\.failed\) release\(\)/,
    'the back-fill no longer gives its claim back on failure, so a refused clearance is remembered as delivered');
});

test('A GENUINE REFUSAL MUST STILL RAISE THE BANNER', async () => {
  // The sabotage, kept as a permanent test. `blocked:`/`invalid:` refusals that are NOT the tie-break mean the
  // clearance really did not land. If the have-newer allowance were widened to "any refusal", this is the test
  // that notices — and the cost of missing it is a child pinned as an adult with nobody told.
  const s = consoleSide([WS_URL]);
  // A member of a DIFFERENT church: the relay's clearance rule refuses it outright (wrong church tag), which
  // is a real, permanent failure and nothing like a tie-break.
  const outsider = K();
  const evil = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', CLEAR_D + outsider.pub], ['t', 'trinityone'], ['p', outsider.pub], ['church', outsider.pub]],
    content: 'x' }, church.sk);
  const r = await s.publish(evil);
  s.close();
  assert.equal(r, false,
    'the relay accepted a clearance tagged to a church this key does not own, or publish() reported a real ' +
    'refusal as a success. Either way the have-newer allowance is now masking genuine losses.');
  assert.equal(s.err(), 1, 'a genuine refusal fired no error event, so no banner can appear');
});

// ── read before write: the cure, not the patch ───────────────────────────────────────────────────────────
// HANDOFF-2026-07-31 item 7. Everything above says a tie-break refusal must be reported. That is right, and
// it is only tolerable if the console stops CAUSING tie-breaks — otherwise the safeguarding banner cries wolf
// on the ordinary path and stewards learn to ignore it.
//
// Measured before this change, against a real gateway, 21-member roster, every write succeeding: marking a
// child a minor raised a false "did not receive their updated safeguarding record" banner on 8 of 12 toggles,
// reporting 29 members lost while the relay held all 21. The banner has no dismiss timer. Two writers hit the
// same doc inside one whole second — `_reseal` for the member toggled, and the whole-roster back-fill that the
// changed safeguarding list re-triggers — and the relay refuses the loser.
//
// The console had no reason to send those documents at all: they were already stored, unchanged. So it now
// reads first and skips what already matches.
test('A REPEAT BACK-FILL PUBLISHES NOTHING AT ALL', async () => {
  const s = await authenticate(consoleSide([WS_URL]));
  const pubs = members.slice(10, 16).map(m => m.pub);
  const minors = pubs.slice(0, 2);
  const first = await s.refreshClearances(pubs, minors, []);
  assert.equal(first.failed, 0, 'the seeding run failed — fixture broken');
  assert.equal(first.skipped, 0, 'the first run skipped members whose clearance did not exist yet');
  await sleep(500);

  const before = s.ok() + s.err();
  const again = await s.refreshClearances(pubs, minors, []);
  s.close();
  assert.equal(again.skipped, 6,
    `a second Members visit re-published ${6 - again.skipped} of 6 identical clearances. Every one is a NIP-44 ` +
    'seal and an event over a metered link, and every one is a chance to collide with the toggle that ' +
    'triggered the visit — which is where the false safeguarding banner comes from. At 500 members this is ' +
    '~500 seals and ~25s of paced publishing per visit, permanently.');
  assert.equal(again.failed, 0);
  assert.equal(s.ok() + s.err() - before, 0, 'events still went to the relay on a no-op refresh');
});

test('THE SKIP COMES FROM THE RELAY, NOT JUST THIS PAGE\'S MEMORY', async () => {
  // The in-memory just-sent cache and the relay read both cause skips, and only one of them survives a reload.
  // A fresh console — new page, empty cache — must still skip work the relay already holds, or the steady-state
  // republishing this change exists to remove is only removed until the steward refreshes the tab.
  //
  // This test earned its place: without the NIP-42 auth above, the relay withheld every clearance, the read
  // returned nothing, and the file stayed green with the status comparison sabotaged.
  const seed = await authenticate(consoleSide([WS_URL]));
  const pubs = members.slice(19, 21).map(m => m.pub);
  assert.equal((await seed.refreshClearances(pubs, [pubs[0]], [])).failed, 0, 'seeding failed — fixture broken');
  seed.close();
  await sleep(500);

  const reloaded = await authenticate(consoleSide([WS_URL]));   // a different page: nothing remembered
  const r = await reloaded.refreshClearances(pubs, [pubs[0]], []);
  reloaded.close();
  assert.equal(r.skipped, 2,
    `a freshly-loaded console re-published ${2 - r.skipped} of 2 clearances the relay already holds. The skip ` +
    'is coming from this page\'s memory rather than from reading the relay, so every reload restores the full ' +
    'republish — and with it the collisions that produce the false safeguarding banner.');
  assert.equal(r.failed, 0);
});

test('…but a member whose status CHANGED is still written', async () => {
  // The failure mode of an over-eager skip, and it is the dangerous direction: a child marked as a child whose
  // clearance is never sent still reads "not a minor" on their own phone.
  const s = await authenticate(consoleSide([WS_URL]));
  const pubs = members.slice(16, 19).map(m => m.pub);
  await s.refreshClearances(pubs, [], []);              // all adults
  // A full second, deliberately. `created_at` is whole seconds, so two writes of DIFFERENT content inside one
  // second tie-break against each other and one is refused — which is a real mechanism, not a test artefact,
  // but it needs a steward to change the same member twice within a second. Modelling that here made the test
  // flaky for a reason unrelated to what it is measuring. (Read-before-write cannot help this case by design:
  // the content genuinely differs, so the write must go out.)
  await sleep(1100);
  const r = await s.refreshClearances(pubs, [pubs[0]], [pubs[1]]);   // one becomes a minor, one gets cleared
  const authed = s._isRelayAuthed();
  await sleep(400);
  const stored = await storedCount(pubs);
  s.close();

  // UNCONDITIONAL — the safety-critical direction. Whatever the socket is doing, a member whose status changed
  // must end up with a record. Skipping one would leave a child's app reading "not a minor".
  assert.equal(r.failed, 0, 'a member whose status changed did not receive their clearance');
  assert.equal(r.total, 3);
  assert.equal(stored, 3, 'the relay is not holding a clearance for every member');

  // CONDITIONAL — the optimisation. Read-before-write is gated on a live authenticated socket by design, so
  // only assert the skip when we actually have one. Asserting it unconditionally made this test flaky, and a
  // flaky test on the release gate is its own harm.
  if (authed) assert.equal(r.skipped, 1, 'the unchanged member was re-published, or a changed one was skipped');
});

test('A READ THAT FAILS MUST PUBLISH EVERYTHING, NEVER SKIP', async () => {
  // The rule this whole codebase is built around: an empty answer from a relay is not evidence of absence.
  // A private doc is withheld from an unauthenticated or unreachable relay with the same empty result as a
  // church that has no record at all. Skipping on that would silently strand every child.
  const s = consoleSide([DEAD_URL]);
  const pubs = members.slice(0, 4).map(m => m.pub);
  const r = await s.refreshClearances(pubs, pubs.slice(0, 2), []);
  s.close();
  assert.equal(r.skipped, 0,
    `${r.skipped} members were skipped on the strength of a read from a relay that cannot be reached. An ` +
    'unreachable relay answers "no clearance" for a church that has one — treating that as "already correct" ' +
    'means a child marked as a child never receives the record saying so.');
  assert.equal(r.failed, 4, 'and every one of them must still be reported as undelivered');
});

// The end-to-end reproduction of the measured harm, and the strongest evidence on this branch: 8 false
// banners in 12 toggles before read-before-write, 0 after.
//
// THIS WAS QUARANTINED WITH THE WRONG REASON, which is worth recording because the wrong reason was mine and
// it would have cost the next person a day. The skip note blamed "the console loses its authenticated socket
// mid-run" and told the reader to go and make the socket stable. Audit 4 un-skipped it, wrapped the WebSocket
// to log every close, and logged the auth state and the relay's refusal reason per iteration: 24 runs, 4
// failures, ZERO socket closes, `authed === true` throughout. `pruneIdleRelays` exists in the bundle but is
// never called and `enablePing` is never set, so the mechanism I blamed cannot even occur.
//
// The real cause was in the FIXTURE. The seed marks 12 members as adults and the first toggle followed 0.5s
// later, so the seed write and the first toggles shared a wall-clock second — and `created_at` is whole
// seconds. Two writes of DIFFERENT content in one second tie-break against each other, which read-before-write
// cannot help with by design (the content genuinely differs, so the write must go out) and is not supposed to.
// A steward cannot mark a child twice inside one second; the fixture could. One second of clearance fixes it.
test('THE TOGGLE PATH NO LONGER RAISES A FALSE BANNER', async () => {
  // The end-to-end reproduction of the measured harm. A steward marks a child: `_reseal` writes that member's
  // clearance, and the changed safeguarding list re-triggers the whole-roster back-fill moments later. Both
  // used to write the same doc in the same second; the loser was refused and reported as a lost child.
  const s = await authenticate(consoleSide([WS_URL]));
  const roster = members.slice(0, 12).map(m => m.pub);
  await s.refreshClearances(roster, [], []);            // the church is settled, everyone an adult
  // A FULL SECOND before the first toggle. created_at is whole seconds, so without this the seed and the first
  // toggle collide on the relay's tie-break — a fixture artefact, not the behaviour under test. See the note.
  await sleep(1200);

  let falseBanners = 0;
  for (let i = 0; i < 4; i++) {
    const minors = roster.slice(0, i + 1);              // the steward marks one more child each time
    const bannersBefore = s.banners().length;
    // Read-before-write is gated on a live authenticated socket, by design — an unauthenticated read is served
    // an empty answer and we must never skip on that. So if the socket has lapsed, re-establish it and assert
    // it, rather than measuring socket stability here. Measured 1 run in 5 lost auth mid-test and every
    // iteration then collided, which is the honest consequence: WHILE UNAUTHENTICATED THE FALSE BANNER
    // RETURNS. That is a real limitation of this fix and it is stated in the source; it is a different
    // invariant from the one this test is about, and conflating them makes a flaky safeguarding test.
    if (!s._isRelayAuthed()) await authenticate(s);
    assert.ok(s._isRelayAuthed(), 'lost the authenticated socket — cannot measure collisions from here');
    // _reseal: the toggled member only, deliberately not awaited (app/stew-dashboard.jsx)
    const reseal = s.refreshClearances([roster[i]], minors, []);
    // …and the back-fill the list change re-triggers, over the WHOLE roster, right behind it
    const backfill = s.refreshClearances(roster, minors, []);
    await Promise.all([reseal, backfill]);
    falseBanners += s.banners().length - bannersBefore;
  }
  await sleep(400);
  const held = await storedStatus(roster);
  s.close();
  assert.equal(held.size, 12, 'the fixture did not store every clearance — the test is wrong, not the code');
  // CONTENT, not just presence. The four members the steward marked must actually READ as minors, and the
  // eight untouched ones must not. A presence count passes even when a member is left holding a stale record,
  // which is precisely the outcome a child experiences as "my app thinks I am an adult".
  for (let i = 0; i < 12; i++) {
    const st2 = held.get(roster[i]);
    assert.ok(st2 && !st2.undecryptable, `member ${i} has no readable clearance`);
    assert.equal(st2.minor, i < 4,
      `member ${i} is stored as minor=${st2.minor}, expected ${i < 4}. The relay holds a record, so a ` +
      'presence check would pass — but the child\'s own app reads this value and would conclude the opposite.');
  }
  assert.equal(falseBanners, 0,
    `marking 4 children raised ${falseBanners} "did not receive their safeguarding record" warnings while the ` +
    'relay holds all 12 records. Measured at 8 of 12 before read-before-write. The banner has no dismiss ' +
    'timer, so each one sits on the safeguarding screen until tapped — which is how a steward learns to ' +
    'dismiss the real one.');
});

// ── two relays: "some relay has it" is not the invariant a church needs ──────────────────────────────────
// AUDIT-4. publish() succeeds via Promise.any as soon as ONE relay accepts. The first version of
// read-before-write asked all relays as a UNION, so with relay B down the doc landed on A alone, the next
// visit saw it on A, skipped the member — and B never received it, on that visit or any later one. Measured:
// `stored on A 3/3, stored on B 0/3`, still 0/3 after a retry visit from a fresh console. Before
// read-before-write existed, the unconditional republish healed this by accident; the optimisation turned a
// self-healing gap into a permanent one.
//
// What a child experiences: their phone happens to read relay B, finds no clearance, falls back to the
// `minors:` list the relay will not serve an ordinary member, and is treated as an adult.
test('A CLEARANCE MISSING FROM ONE RELAY IS STILL WRITTEN', async () => {
  const B_PORT = 8987;
  await requireFreePort(B_PORT, 'console-publish-honesty.test.mjs (its second relay)');
  const bDir = mkdtempSync(join(tmpdir(), 'trin-relayB-'));
  const bUrl = `ws://127.0.0.1:${B_PORT}/relay`;
  const spawnB = () => spawn(process.execPath, ['scripts/gateway.mjs', String(B_PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: bDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  let relayB = null;
  const upB = async () => {
    relayB = spawnB();
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${B_PORT}/status`)).ok) return; } catch {} await sleep(150); }
    throw new Error('relay B never came up');
  };
  const storedOnB = async (pubs) => {
    const w = await new Promise((res, rej) => { const x = new WebSocket(bUrl); x.on('open', () => res(x)); x.on('error', rej); });
    const seen = new Set();
    await new Promise(res => {
      const on = d => {
        const m = JSON.parse(d);
        if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', bUrl], ['challenge', m[1]]], content: '' }, church.sk)]));
        if (m[0] === 'EVENT' && m[1] === 'q') seen.add((m[2].tags.find(t => t[0] === 'd') || [])[1]);
        if (m[0] === 'EOSE' && m[1] === 'q') { w.off('message', on); res(); }
      };
      w.on('message', on);
      w.send(JSON.stringify(['REQ', 'q', { kinds: [30078], '#d': pubs.map(p => CLEAR_D + p) }]));
      setTimeout(res, 6000);
    });
    w.close();
    return seen.size;
  };

  try {
    const pubs = members.slice(0, 3).map(m => m.pub);
    // Relay B is DOWN. The write lands on A alone — correct, and publish() rightly reports success.
    const s1 = await authenticate(consoleSide([WS_URL, bUrl]));
    const r1 = await s1.refreshClearances(pubs, [pubs[0]], []);
    s1.close();
    assert.equal(r1.failed, 0, 'the write should succeed via relay A alone');
    await sleep(400);
    await upB();
    assert.equal(await storedOnB(pubs), 0, 'fixture: relay B should have missed the write');

    // A fresh console — nothing remembered — with BOTH relays up. It must NOT skip these members.
    const s2 = await authenticate(consoleSide([WS_URL, bUrl]));
    await requireConnected(s2, [WS_URL, bUrl]);      // both up now — this is the case under test
    const r2 = await s2.refreshClearances(pubs, [pubs[0]], []);
    s2.close();
    await sleep(500);
    const onB = await storedOnB(pubs);
    assert.equal(r2.skipped, 0,
      `${r2.skipped} of 3 members were skipped because relay A already held their clearance, while relay B ` +
      'held none of them. Nothing else ever retries, so a member reading relay B has no record for good.');
    assert.equal(onB, 3,
      `relay B holds ${onB} of 3 clearances after a retry visit. A child whose phone reads B finds nothing, ` +
      'falls back to the minors list the relay will not serve them, and is treated as an adult.');
  } finally {
    try { relayB && relayB.kill('SIGKILL'); } catch {}
    try { rmSync(bDir, { recursive: true, force: true }); } catch {}
  }
});

test('…and with both relays holding it, the skip still happens', async () => {
  // The other direction: the fix must not switch read-before-write off whenever a second relay exists.
  const B_PORT = 8986;
  await requireFreePort(B_PORT, 'console-publish-honesty.test.mjs (its second relay, agreement case)');
  const bDir = mkdtempSync(join(tmpdir(), 'trin-relayB2-'));
  const bUrl = `ws://127.0.0.1:${B_PORT}/relay`;
  const relayB = spawn(process.execPath, ['scripts/gateway.mjs', String(B_PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: bDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${B_PORT}/status`)).ok) break; } catch {} await sleep(150); }
    const pubs = members.slice(3, 6).map(m => m.pub);
    const s1 = await authenticate(consoleSide([WS_URL, bUrl]));
    await requireConnected(s1, [WS_URL, bUrl]);
    assert.equal((await s1.refreshClearances(pubs, [], [])).failed, 0, 'seeding both relays failed');
    s1.close();
    await sleep(600);
    const s2 = await authenticate(consoleSide([WS_URL, bUrl]));
    await requireConnected(s2, [WS_URL, bUrl]);
    const r = await s2.refreshClearances(pubs, [], []);
    s2.close();
    assert.equal(r.skipped, 3,
      `only ${r.skipped} of 3 skipped with both relays holding matching records — read-before-write has been ` +
      'switched off for every multi-relay church, which is the write amplification it exists to remove');
  } finally {
    try { relayB.kill('SIGKILL'); } catch {}
    try { rmSync(bDir, { recursive: true, force: true }); } catch {}
  }
});

test('A RELAY JOINING MUST FORCE A RE-CHECK, NOT A CACHED SKIP', async () => {
  // The reconciliation half of the two-relay fix, and getting a real test on it took three attempts — worth
  // recording, because the first two passed with the guard DELETED.
  //
  //   1st: single relay, killed and restarted. Useless — the data survived the restart, so a cached skip lost
  //        nothing and the assertion held either way.
  //   2nd: two relays, B down during the write, brought up afterwards. Also useless: `_clearanceSent` has a
  //        15-SECOND freshness window, and starting a gateway plus re-authenticating takes longer than that,
  //        so the cache had already expired and the guard was never the thing being exercised.
  //
  // So the window is the thing to respect: the exposure this guard closes is only ever 15 seconds wide, which
  // is worth knowing — it means the per-relay read above is the load-bearing fix and this is belt-and-braces.
  // To reach it, the relay list is mutated in place (the console reads relays() on every call, as the real one
  // does when a steward adds a relay) so B can join a console that has just written, with the cache still warm.
  const B_PORT = 8985;
  await requireFreePort(B_PORT, 'console-publish-honesty.test.mjs (its reconciliation relay)');
  const bDir = mkdtempSync(join(tmpdir(), 'trin-relayB3-'));
  const bUrl = `ws://127.0.0.1:${B_PORT}/relay`;
  const relayB = spawn(process.execPath, ['scripts/gateway.mjs', String(B_PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: bDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const countOnB = async (pubs) => {
    const w = await new Promise((res, rej) => { const x = new WebSocket(bUrl); x.on('open', () => res(x)); x.on('error', rej); });
    const seen = new Set();
    await new Promise(res => {
      const on = d => {
        const m = JSON.parse(d);
        if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', bUrl], ['challenge', m[1]]], content: '' }, church.sk)]));
        if (m[0] === 'EVENT' && m[1] === 'q') seen.add((m[2].tags.find(t => t[0] === 'd') || [])[1]);
        if (m[0] === 'EOSE' && m[1] === 'q') { w.off('message', on); res(); }
      };
      w.on('message', on);
      w.send(JSON.stringify(['REQ', 'q', { kinds: [30078], '#d': pubs.map(p => CLEAR_D + p) }]));
      setTimeout(res, 6000);
    });
    w.close();
    return seen.size;
  };
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${B_PORT}/status`)).ok) break; } catch {} await sleep(150); }
    // FRESH keys, not a slice of the shared roster. Every other test in this file seeds some range of
    // `members`, so a reused slice is already stored on relay A — the first write here would then be skipped
    // by the relay read, never populate the cache, and the sabotage would have nothing to bite on. That is
    // exactly why the first three attempts at this test passed with the guard deleted.
    const fresh3 = Array.from({ length: 3 }, K);
    const pubs = fresh3.map(m => m.pub);

    const urls = [WS_URL];                       // the console starts on relay A only
    const s = await authenticate(consoleSide(urls));
    assert.equal((await s.refreshClearances(pubs, [], [])).failed, 0, 'the write to relay A failed');
    const tWrite = Date.now();

    urls.push(bUrl);                             // relay B joins, cache still inside its 15s window
    try { s._authSub && s._authSub.close(); } catch {}
    await authenticate(s);
    await requireConnected(s, [WS_URL, bUrl]);

    const elapsed = Date.now() - tWrite;
    (await import('node:fs')).writeFileSync('/tmp/recon.txt', 'elapsed_ms=' + elapsed);
    const r = await s.refreshClearances(pubs, [], []);
    s.close();
    await sleep(500);
    const onB = await countOnB(pubs);
    assert.ok(elapsed < 15000, `the cache window (15s) expired after ${elapsed}ms, so this test cannot reach ` +
      'the guard it names — tighten it or the sabotage will never bite');
    assert.equal(r.skipped, 0,
      `${r.skipped} of 3 members were skipped from the console's cache after a new relay connected. That cache ` +
      'only ever proved the relays reachable AT THE TIME held the record — B has never seen these.');
    assert.equal(onB, 3,
      `relay B holds ${onB} of 3 clearances. A member reading B finds nothing, falls back to the minors list ` +
      'the relay will not serve them, and is treated as an adult.');
  } finally {
    try { relayB.kill('SIGKILL'); } catch {}
    try { rmSync(bDir, { recursive: true, force: true }); } catch {}
  }
});

// ── the console that actually marks children ─────────────────────────────────────────────────────────────
// AUDIT-4 B5. Churches delegate: setActiveIdentity puts the console into a mode where it signs with the
// STEWARD'S own key while reading in the church's context (sk = steward, pub = church, actingChurch = church).
// src/fellowship.src.js says of that path: "a member's own sealed clearance may also come from a CURRENT
// roster steward, WHICH IS WHO MARKS A CHILD IN PRACTICE."
//
// Read-before-write filtered its read on `authors: [actingChurch || pub]` — the CHURCH — while feChurch signs
// with the steward's key. So a delegated console never matched its own writes, never skipped, and republished
// the entire roster on every Members visit, for ever. The branch's headline cure did not reach the console
// that needs it most. Measured: owner skipped 4 of 4 on a second visit, delegated 0 of 4.
//
// The member side is fine and needs no change — it decrypts with nip44ck(sk, e.pubkey), i.e. the actual
// author, so a steward-authored clearance opens correctly on the child's phone.
test('A DELEGATED STEWARD CONSOLE ALSO STOPS REPUBLISHING', async () => {
  const steward = K();
  // The relay only accepts a clearance from the church or a CURRENT steward of the church named in the tag.
  const w = await new Promise((res, rej) => { const x = new WebSocket(WS_URL); x.on('open', () => res(x)); x.on('error', rej); });
  const rosterDoc = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', 'trinityone/stewards:' + church.pub], ['t', 'trinityone']],
    content: JSON.stringify({ pubkeys: [steward.pub] }) }, church.sk);
  const accepted = await new Promise(res => {
    const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === rosterDoc.id) { w.off('message', on); res(m[2]); } };
    w.on('message', on); w.send(JSON.stringify(['EVENT', rosterDoc]));
    setTimeout(() => res(false), 5000);
  });
  w.close();
  assert.equal(accepted, true, 'the steward roster was refused — fixture broken');
  await sleep(400);

  const ident = { sk: steward.sk, pub: church.pub, actingChurch: church.pub };
  const pubs = Array.from({ length: 4 }, K).map(m => m.pub);

  const first = await authenticate(consoleSide([WS_URL], null, ident));
  const r1 = await first.refreshClearances(pubs, [pubs[0]], []);
  first.close();
  assert.equal(r1.failed, 0,
    'a delegated steward could not write a clearance at all — check the stewards: roster fixture, not the fix');
  await sleep(500);

  // A fresh delegated console: nothing remembered, so any skip must come from reading the relay.
  const again = await authenticate(consoleSide([WS_URL], null, ident));
  const r2 = await again.refreshClearances(pubs, [pubs[0]], []);
  again.close();
  assert.equal(r2.skipped, 4,
    `a delegated console re-published ${4 - r2.skipped} of 4 clearances it had already written. It reads with ` +
    'the CHURCH as author while it signs with the steward\'s key, so it never recognises its own work — and ' +
    'this is the console that marks children in practice, so the whole cure misses where it matters most.');
  assert.equal(r2.failed, 0);
});

test('…and a delegated console still writes a member whose status CHANGED', async () => {
  const steward = K();
  const w = await new Promise((res, rej) => { const x = new WebSocket(WS_URL); x.on('open', () => res(x)); x.on('error', rej); });
  const rosterDoc = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', 'trinityone/stewards:' + church.pub], ['t', 'trinityone']],
    content: JSON.stringify({ pubkeys: [steward.pub] }) }, church.sk);
  await new Promise(res => {
    const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === rosterDoc.id) { w.off('message', on); res(m[2]); } };
    w.on('message', on); w.send(JSON.stringify(['EVENT', rosterDoc])); setTimeout(res, 5000);
  });
  w.close();
  await sleep(400);
  const ident = { sk: steward.sk, pub: church.pub, actingChurch: church.pub };
  const pubs = Array.from({ length: 3 }, K).map(m => m.pub);
  const s1 = await authenticate(consoleSide([WS_URL], null, ident));
  await s1.refreshClearances(pubs, [], []);
  s1.close();
  await sleep(1200);                                  // clear of the same wall-clock second
  const s2 = await authenticate(consoleSide([WS_URL], null, ident));
  const r = await s2.refreshClearances(pubs, [pubs[0]], []);   // one becomes a minor
  s2.close();
  assert.equal(r.failed, 0, 'a delegated console failed to write a changed clearance');
  assert.equal(r.skipped, 2, 'the changed member was skipped, or the unchanged ones were re-published');
});

// ── keeping the guard honest ─────────────────────────────────────────────────────────────────────────────
test('the "connection failure" prefix is pinned to what nostr-tools actually emits', async () => {
  // The fix is prefix-specific, because a genuine OK also resolves with a string (usually ''). If a
  // nostr-tools bump changes that wording the guard silently stops matching and the bug returns with every
  // test above still green — the tests use the same library, so they would move together.
  //
  // So this asserts the string THREE ways: what the library emits right now, what the shipped bundle expects,
  // and that the two are the same text.
  const pool = new SimplePool({ verifyEvent, websocketImplementation: WebSocket, maxWaitForConnection: 1500 });
  const raw = await Promise.allSettled(pool.publish([DEAD_URL], churchDoc('trinityone/minors:' + church.pub, { pubkeys: [] })));
  try { pool.destroy(); } catch {}
  assert.equal(raw[0].status, 'fulfilled',
    'nostr-tools now REJECTS an unreachable relay instead of resolving with a string. That is the safe ' +
    'direction and the bug this file is about is gone at the source — but the guard in publish() is now dead ' +
    'code testing nothing. Re-read it before deleting this assertion.');
  assert.ok(String(raw[0].value).startsWith('connection failure'),
    'nostr-tools resolved an unreachable relay with ' + JSON.stringify(raw[0].value) + ', which does not start ' +
    'with "connection failure". The prefix check in publish() no longer matches, so the console is silently ' +
    'back to reporting unreachable writes as saved.');
  assert.ok(STEWARD.includes('connection failure'),
    'the shipped bundle has no "connection failure" guard at all — publish() is back to treating an ' +
    'unreachable relay as a successful save. Rebuild: bash scripts/build-steward.sh');
});

test('publish() checks the prefix rather than rejecting every string it is handed', () => {
  // The failure mode of an over-broad fix. A relay's OK reason is ALSO a string — usually '' but it can carry
  // text — and treating any string as a failure would make every successful save report as failed, which is
  // the same lie in the other direction and just as damaging (stewards re-entering data that saved fine).
  const fn = grab('async function publish(evt)');
  assert.match(fn, /startsWith\(/,
    'publish() no longer discriminates by prefix. If it rejects any string resolution, a relay that answers ' +
    'OK with a reason string turns every successful save into a reported failure.');
  assert.ok(!/typeof v === "string"[^&]*\)\s*throw/.test(fn.replace(/\s+/g, ' ')) || /startsWith/.test(fn),
    're-anchor: the guard shape changed');
});

// ── an unconfirmed write is not a lost child ──────────────────────────────────────────────────────────────
// Measured on the network simulator (scripts/netsim-console.mjs) before this existed: on 2G the console told
// the steward 3 of 8 members had not received their safeguarding record, and on satellite 6 of 8 — while every
// single record was on the relay. The batch loop waits a bounded time for each write to be acknowledged, and
// on a thin link the acknowledgement simply arrives after we stopped listening. Counting that as a lost child
// is how a safeguarding banner becomes noise, and a banner that is usually wrong is worse than no banner: the
// one time it is right, it looks the same.
//
// Make the writes REACH THE RELAY but never resolve, which is exactly what a slow link produces.
function neverConfirms(s) {
  const real = s.pool.publish.bind(s.pool);
  s.pool.publish = (urls2, evt) => { real(urls2, evt).forEach(p => p.catch(() => {})); return [new Promise(() => {})]; };
  return s;
}
// A read that returns nothing and never finishes — the saturated-link case. Note it swallows onevent AS WELL
// as oneose: a read that merely lacks its EOSE still delivers the events, and would confirm the writes.
function readsNothing(s) {
  const real = s.pool.subscribeMany.bind(s.pool);
  s.pool.subscribeMany = (urls2, filters, h) => real(urls2, filters, { ...h, onevent() {}, oneose() {} });
  return s;
}

test('A WRITE THAT LANDED BUT WAS NEVER ACKNOWLEDGED RAISES NO ALARM', async () => {
  const s = neverConfirms(await authenticate(consoleSide([WS_URL])));
  const pubs = members.slice(12, 18).map(m => m.pub);
  const r = await s.refreshClearances(pubs, pubs.slice(0, 3), []);
  s.close();
  assert.equal(r.failed, 0,
    `${r.failed} of ${r.total} members were reported as having lost their safeguarding record, when every ` +
    'record is on the relay and the only thing missing was the acknowledgement. This is the false banner that ' +
    'the network simulation measured on every realistic link.');
  assert.equal(r.unverified, false, 'the records were read back successfully, so nothing is unverified');
  assert.equal(s.banners().length, 0, 'and the steward must not be warned about a write that succeeded');
});

test('A READ TOO POOR TO FINISH IS "COULDN\'T CONFIRM", NOT "DID NOT RECEIVE"', async () => {
  // Both halves of this matter. Saying nothing would be a lie in the other direction — we genuinely do not
  // know — but claiming the records are lost is the lie that trains stewards to ignore the banner.
  const s = readsNothing(neverConfirms(await authenticate(consoleSide([WS_URL]))));
  const pubs = members.slice(18, 22).map(m => m.pub);
  const r = await s.refreshClearances(pubs, pubs.slice(0, 2), []);
  s.close();
  assert.equal(r.unverified, true,
    'the console could not read a single record back, yet reported a verified answer. An unverifiable read ' +
    'has been mistaken for a definite one on this codebase before, and both possible definite answers are wrong.');
  assert.equal(s.banners().length, 1, 'the steward must still be told something is unconfirmed');
  const msg = s.banners()[0].detail.message;
  assert.match(msg, /Couldn.t confirm/, 'the banner must admit ignorance rather than assert failure: ' + msg);
  assert.doesNotMatch(msg, /did not receive/,
    'the banner claims the members did not receive their record, which is not known and is usually false: ' + msg);
});

test('…and that distinction is load-bearing, not decorative', async () => {
  // SABOTAGE. Collapse the three-way answer back to two — the shape the code had before, where anything the
  // read did not return was a lost child. Deliberately sabotages the WHOLE distinction rather than one of its
  // two guards (the read did not finish; the read never saw the record), because under this scenario either
  // guard alone is enough to prevent the false banner. Isolating them needs a read that EOSEs while returning
  // nothing, which the next test does.
  const t = readsNothing(neverConfirms(await authenticate(consoleSide([WS_URL], null, null,
    (src) => src.replace(/unverified = missing\.length[^;]*;/, 'unverified = false;')))));
  // The roster is 21, so this deliberately overlaps earlier tests. Safe: readsNothing() means the skip read
  // returns nothing, so every member is written again regardless of what is already on the relay.
  const pubs = members.slice(14, 18).map(m => m.pub);
  const r = await t.refreshClearances(pubs, pubs.slice(0, 2), []);
  t.close();
  assert.equal(r.unverified, false, 'the sabotage did not take effect, so this test proves nothing');
  assert.match(t.banners()[0].detail.message, /did not receive/,
    'with the completeness flag forced true the console should wrongly accuse the members — if it does not, ' +
    'the flag is not what is preventing the false banner and this guard is untested');
});

// ── another author's clearance can outrank ours, and we skip anyway ───────────────────────────────────────
// What the MEMBER'S APP actually applies. It is the only assertion that matters here, because the console and
// the member resolve this document differently and that difference IS the bug:
//
//   • the console reads `authors: [its own key]` — one replaceable slot, its own
//   • the member reads d=clearance:<me> from the church key AND every current steward, then takes the newest
//
// Replaceable events are keyed by (pubkey, kind, d), so the church's copy and a steward's copy are two
// SEPARATE documents that never collide on the relay. The console can therefore look at its own, find exactly
// what it intended, skip the write as redundant — while the member's phone is applying somebody else's, older
// or newer, saying the opposite. No error, no banner, no retry: the console is satisfied for ever.
async function memberSees(m) {
  const w = await new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
  let best = null;
  await new Promise(res => {
    const on = d => {
      const msg = JSON.parse(d);
      if (msg[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
        tags: [['relay', WS_URL], ['challenge', msg[1]]], content: '' }, m.sk)]));
      if (msg[0] === 'EVENT' && msg[1] === 'q') {
        const e = msg[2];
        if (best && (e.created_at || 0) < best.at) return;         // newest-wins, exactly as the member app does
        try {
          const body = JSON.parse(nip44v2.decrypt(e.content, nip44v2.utils.getConversationKey(m.sk, e.pubkey)));
          best = { minor: !!body.minor, cleared: !!body.cleared, at: e.created_at || 0, by: e.pubkey };
        } catch (x) {}
      }
      if (msg[0] === 'EOSE' && msg[1] === 'q') { w.off('message', on); res(); }
    };
    w.on('message', on);
    w.send(JSON.stringify(['REQ', 'q', { kinds: [30078], '#d': [CLEAR_D + m.pub] }]));
    setTimeout(res, 8000);
  });
  w.close();
  return best;
}

// Put a steward on the church's roster, which is what the relay checks before accepting their clearance.
async function seatSteward(steward) {
  const w = await new Promise((res, rej) => { const x = new WebSocket(WS_URL); x.on('open', () => res(x)); x.on('error', rej); });
  const doc = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', 'trinityone/stewards:' + church.pub], ['t', 'trinityone']],
    content: JSON.stringify({ pubkeys: [steward.pub] }) }, church.sk);
  const ok = await new Promise(res => {
    const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === doc.id) { w.off('message', on); res(m[2]); } };
    w.on('message', on); w.send(JSON.stringify(['EVENT', doc])); setTimeout(() => res(false), 5000);
  });
  w.close();
  assert.equal(ok, true, 'the steward roster was refused — fixture broken, not the code under test');
  await sleep(400);
  return { sk: steward.sk, pub: church.pub, actingChurch: church.pub };
}

test('A CHILD OUTRANKED BY ANOTHER STEWARD\'S OLDER VIEW IS PUT RIGHT', async () => {
  const steward = K();
  const ident = await seatSteward(steward);
  const child = K();

  // 1. The church owner marks the child. The member's app agrees.
  const owner1 = await authenticate(consoleSide([WS_URL]));
  await owner1.refreshClearances([child.pub], [child.pub], []);
  owner1.close();
  const afterOwner = await memberSees(child);
  assert.ok(afterOwner && afterOwner.minor === true,
    'the fixture never got the child marked in the first place — this is not the bug under test: '
    + JSON.stringify(afterOwner));

  // 2. A delegated steward's console runs a back-fill from a view that has not caught up — the child is not
  //    in ITS minors list yet. Ordinary: the roster and the lists arrive over separate subscriptions, and this
  //    console may have been open since before the change. It writes its own slot, and being newer, the
  //    member's app now applies it.
  await sleep(1200);                                  // created_at is whole seconds — clear of the last write
  const stew = await authenticate(consoleSide([WS_URL], null, ident));
  await stew.refreshClearances([child.pub], [], []);
  stew.close();
  const afterStew = await memberSees(child);
  assert.equal(afterStew.minor, false,
    'the stale steward write did not take effect, so the rest of this test proves nothing — re-check the fixture');

  // 3. The owner's console opens Members again. Its own slot still says exactly what it wants, so it skips —
  //    and the child's phone goes on treating them as an adult, permanently, with nothing reported.
  await sleep(1200);
  const owner2 = await authenticate(consoleSide([WS_URL]));
  const r = await owner2.refreshClearances([child.pub], [child.pub], []);
  owner2.close();
  const finalView = await memberSees(child);
  assert.equal(finalView.minor, true,
    `the child's own app still reads "not a minor" after the church's console re-ran its safeguarding `
    + `back-fill and reported ${r.skipped} skipped, ${r.failed} failed, no banner. The console checked its own `
    + 'copy of the clearance and found it correct; the phone applies the newest copy from ANY authorised '
    + 'writer, which is a steward\'s stale one. Nothing will ever retry.');
});

test('…and the steward\'s console gives way instead of fighting back', async () => {
  // THE OTHER HALF, and the reason the rule is by author rather than by clock. "Rewrite whenever someone
  // else's copy is on top" is symmetric, and symmetric means a fight: the owner rewrites to get above the
  // steward, the steward's next visit rewrites to get above the owner, and every Members visit republishes
  // the whole roster for ever — the exact cost read-before-write was added to remove, now permanent.
  const steward = K();
  const ident = await seatSteward(steward);
  const child = K();

  // The steward's own copy is correct and on top.
  const s1 = await authenticate(consoleSide([WS_URL], null, ident));
  const a = await s1.refreshClearances([child.pub], [child.pub], []);
  s1.close();
  assert.equal(a.failed, 0, 'the steward could not write at all — fixture, not the code under test');

  // The owner writes the same thing, so now the CHURCH's copy is the one the member applies.
  await sleep(1200);
  const o = await authenticate(consoleSide([WS_URL]));
  await o.refreshClearances([child.pub], [child.pub], []);
  o.close();

  // The steward's console visits again. Its own copy still says the right thing; a copy it does not outrank
  // is above it. There is nothing to correct, and it must not try.
  await sleep(1200);
  const s2 = await authenticate(consoleSide([WS_URL], null, ident));
  const b = await s2.refreshClearances([child.pub], [child.pub], []);
  s2.close();
  assert.equal(b.skipped, 1,
    'the steward\'s console rewrote a clearance that was already correct, purely because the church\'s copy '
    + 'was newer. Both consoles doing that is a permanent full-roster rewrite on every visit.');
  assert.equal(s2.ok(), 0, 'and nothing should have gone on the wire at all');
  assert.equal((await memberSees(child)).minor, true, 'the child must still read as a child throughout');
});

test('…and the ranking is what does both, not a coincidence', async () => {
  // SABOTAGE, both directions. Rank-nobody-over-anybody must leave the child wrong; rank-everybody-over-
  // everybody must produce the fight. If either sabotage behaves like the shipped code, the rule is inert.
  const steward = K();
  const ident = await seatSteward(steward);
  const never = (src) => src.replace(/function _clearanceOutranks\(a, b, churchHex\) \{/, '$& return false;');
  const always = (src) => src.replace(/function _clearanceOutranks\(a, b, churchHex\) \{/, '$& return true;');

  // (a) never outranks → the owner leaves the steward's stale copy on top, which is the original bug.
  const kid = K();
  const o1 = await authenticate(consoleSide([WS_URL]));
  await o1.refreshClearances([kid.pub], [kid.pub], []);
  o1.close();
  await sleep(1200);
  const st = await authenticate(consoleSide([WS_URL], null, ident));
  await st.refreshClearances([kid.pub], [], []);        // stale view: not a minor
  st.close();
  await sleep(1200);
  const o2 = await authenticate(consoleSide([WS_URL], null, null, never));
  const r = await o2.refreshClearances([kid.pub], [kid.pub], []);
  o2.close();
  assert.equal(r.skipped, 1, 'the sabotage did not take — this test proves nothing');
  assert.equal((await memberSees(kid)).minor, false,
    'with the ranking disabled the child must still be reading as an adult; if they are not, something other '
    + 'than the ranking is fixing this and the shipped rule is untested');

  // (b) always outranks → the steward stops giving way and rewrites a settled member.
  const kid2 = K();
  const s1 = await authenticate(consoleSide([WS_URL], null, ident));
  await s1.refreshClearances([kid2.pub], [kid2.pub], []);
  s1.close();
  await sleep(1200);
  const o3 = await authenticate(consoleSide([WS_URL]));
  await o3.refreshClearances([kid2.pub], [kid2.pub], []);
  o3.close();
  await sleep(1200);
  const s2 = await authenticate(consoleSide([WS_URL], null, ident, always));
  const b = await s2.refreshClearances([kid2.pub], [kid2.pub], []);
  s2.close();
  assert.equal(b.skipped, 0,
    'with the ranking forced symmetric the steward should rewrite a clearance that needs no rewriting — the '
    + 'first step of the endless fight. It did not, so the asymmetry is not what prevents it.');
});

// A read that FINISHES and returns nothing. Isolates the "we never saw the record" guard from the "the read
// did not finish" one: EOSE arrives, so completeness is not what saves the steward from a false accusation.
function readsEmpty(s) {
  const real = s.pool.subscribeMany.bind(s.pool);
  s.pool.subscribeMany = (urls2, filters, h) => real(urls2, filters, { ...h, onevent() {} });
  return s;
}
// The writes never leave the device AND never settle — so whatever is already on the relay stays there, and
// the verify read finds a real, readable, WRONG record rather than nothing at all.
function writesVanish(s) {
  s.pool.publish = () => [new Promise(() => {})];
  return s;
}

test('A RECORD READ BACK AND FOUND WRONG IS STILL NAMED PLAINLY', async () => {
  // The softening must not swallow real alarms. When the console has looked and can see the member's record
  // saying the wrong thing, "we couldn't confirm" would be its own kind of lie — this is precisely the case
  // the banner exists for, and it has to keep its teeth.
  const child = K();
  const seed = await authenticate(consoleSide([WS_URL]));
  await seed.refreshClearances([child.pub], [], []);            // stored: not a minor
  seed.close();
  assert.equal((await memberSees(child)).minor, false, 'fixture: the wrong record was not stored');

  await sleep(1200);
  const s = writesVanish(await authenticate(consoleSide([WS_URL])));
  const r = await s.refreshClearances([child.pub], [child.pub], []);   // now they ARE a minor; the write vanishes
  s.close();
  assert.equal(r.failed, 1, 'a member whose stored record is visibly wrong was not counted');
  assert.equal(r.unverified, false,
    'the console read the record back and could see it was wrong, so there is nothing unverified about it');
  assert.match(s.banners()[0].detail.message, /did not receive/,
    'a record the console has READ and found wrong must be reported as such, not softened into "couldn\'t '
    + 'confirm" — this is the case the banner exists for');
});

test('…but one it never saw is not, even when the read finished', async () => {
  const s = readsEmpty(neverConfirms(await authenticate(consoleSide([WS_URL]))));
  const pubs = Array.from({ length: 3 }, K).map(m => m.pub);
  const r = await s.refreshClearances(pubs, [pubs[0]], []);
  s.close();
  assert.equal(r.unverified, true,
    'the read completed and returned nothing, and the console concluded the records are gone. But the writes '
    + 'it is checking never confirmed, so they may still be in flight — a read that overtakes a write gets an '
    + 'honest EOSE from a relay that simply has not received it yet. Measured on satellite: 7 of 8 members '
    + 'condemned, every record stored moments later.');
  assert.match(s.banners()[0].detail.message, /Couldn.t confirm/);

  // SABOTAGE, isolated: condemn everything the read did not return, regardless of whether it was ever seen.
  const t = readsEmpty(neverConfirms(await authenticate(consoleSide([WS_URL], null, null,
    (src) => src.replace(/if \(sawAll\) seen\.add\(h\);/, 'seen.add(h);')))));
  const pubs2 = Array.from({ length: 3 }, K).map(m => m.pub);
  const r2 = await t.refreshClearances(pubs2, [pubs2[0]], []);
  t.close();
  assert.equal(r2.unverified, false, 'the sabotage did not take effect, so this proves nothing');
  assert.match(t.banners()[0].detail.message, /did not receive/,
    'with the "did we actually see it" guard removed the console should wrongly accuse every member — if it '
    + 'does not, that guard is not what prevents the satellite false alarm');
});
