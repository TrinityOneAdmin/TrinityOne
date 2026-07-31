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
function consoleSide(urls, clock) {
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
  const decName = pick(refreshNow, 'decrypt');
  const feName = pick(authWiring, 'finalizeEvent');
  const normName = pick(authWiring, 'normalizeURL') || pick(isAuthed, 'normalizeURL') || 'normalizeURL';
  for (const [n, v] of [['encrypt', encName], ['getConversationKey', ckName], ['decrypt', decName], ['finalizeEvent', feName]]) {
    assert.ok(v, 'the shipped code no longer calls ' + n + ' where this test expects it — re-anchor');
  }

  const scope = {
    pool, relays: () => urls,
    sk: church.sk, pub: church.pub, actingChurch: '',
    CLEARANCE_D: CLEAR_D, NET: 'trinityone',
    now: clock || now,
    feChurch: (t) => finalizeEvent(t, church.sk),
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
  const built = new Function(...args,
    sentDecl + queueDecl + authWiring + isAuthed + newest + publishSrc +
    `\nreturn ({ publish, _isRelayAuthed, ${pubClearance},\n ${refresh},\n ${refreshNow} });`)(...args.map(k => scope[k]));
  Object.assign(scope.window.Steward, built);
  return {
    ...built, pool,
    ok: () => events.filter(e => e.type === 'steward-publish-ok').length,
    err: () => events.filter(e => e.type === 'steward-publish-error').length,
    banners: () => events.filter(e => e.type === 'steward-write-blocked'),
    close: () => { try { pool.destroy(); } catch {} },
  };
}

// The relay's NIP-42 challenge is LAZY (gateway.mjs) — it only challenges a REQ naming an invite group, a
// safeguarding doc or a safety d-tag. refreshClearances' read is gated on a COMPLETED auth, so a console that
// has never been challenged simply skips the read and publishes everything. Real consoles are challenged early
// by their ~20 subscriptions; provoke the same thing here, and WAIT for it, or these tests race the handshake.
async function authenticate(s) {
  // Deliberately left OPEN. Closing the last subscription lets the pool drop the socket, and the next REQ
  // opens a fresh, unauthenticated one — which is exactly what _isRelayAuthed() is designed to notice.
  s._authSub = s.pool.subscribeMany([WS_URL], [{ kinds: [30078], '#d': ['trinityone/safetycheck:' + church.pub] }],
    { onevent() {}, oneose() {} });
  for (let i = 0; i < 40 && !s._isRelayAuthed(); i++) await sleep(100);
  assert.ok(s._isRelayAuthed(), 'the console never authenticated, so read-before-write is skipped entirely and ' +
    'these tests would pass or fail on the in-memory cache alone');
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
