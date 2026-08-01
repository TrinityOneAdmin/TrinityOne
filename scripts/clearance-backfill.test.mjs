// A whole-roster safeguarding back-fill must reach EVERY member, or the ones it misses are treated as adults.
// Run: node --test scripts/clearance-backfill.test.mjs
//
// AUDIT-2026-07-28 F9. refreshClearances fired one publish per member with nothing awaited between them, so
// the back-fill hit the relay as a single burst on ONE socket. gateway.mjs caps inbound messages at 100 per
// second per connection, and a message over that cap is `return`ed with NO REPLY AT ALL — not OK=false, not
// a NOTICE, not a CLOSED. Measured against a real gateway before the fix:
//
//     sent 150 clearance publishes in 7ms on one socket
//     OK replies: 100    explicit refusals: 0    NO REPLY AT ALL: 50
//     clearances actually stored: 100 of 150
//
// A member with no clearance document falls back to the church's minors list, and the relay stopped serving
// that list to ordinary members on 2026-07-27. So every child past roughly the hundredth is treated as an
// ADULT, and nothing anywhere says so. That is the whole finding: not a performance problem, a safeguarding one.
//
// This drives the SHIPPED refreshClearances out of vendor/steward.js against a real gateway. A test that
// re-implemented the batching here would pass against the burst version — which is the mistake that let the
// original clearance bug ship (relay-clearance.test.mjs hand-built the event instead of calling the function).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8971;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const CLEAR_D = 'trinityone/clearance:';
const ROSTER = 150;             // > the relay's 100/s cap, which is the entire point
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();
const members = Array.from({ length: ROSTER }, K);
let relay, dataDir;

before(async () => {
  await requireFreePort(PORT, 'clearance-backfill.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-backfill-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// Lift the shipped refreshClearances + publishClearance and run them over one real websocket, so the timing
// under test is the timing that ships.
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
function grabMethod(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped console bundle — re-anchor this test');
  // Keep an `async` prefix. Slicing from the NAME drops it, and the method then fails to compile with
  // "await is only valid in async functions" — which the runner reports as a test failure, i.e. it looks
  // exactly like the bug being tested. Caught by checking WHY a red test was red.
  if (src.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

function consoleSide(ws) {
  const pending = new Map();          // event id -> resolve
  const blocked = [], refused = [];
  let okCount = 0;
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m[0] === 'OK') { if (m[2]) okCount++; else refused.push(m[3] || '(no reason)'); }
    if (m[0] === 'OK' && pending.has(m[1])) { pending.get(m[1])(m[2] ? true : false); pending.delete(m[1]); }
  });
  // The real publish(): resolves on OK, and NEVER resolves if the relay says nothing — which is exactly the
  // shape a rate-limited drop has, and why the fix needs its own bound.
  const publish = (evt) => new Promise(res => { pending.set(evt.id, res); ws.send(JSON.stringify(['EVENT', evt])); });
  const pubClearance = grabMethod(STEWARD, 'publishClearance(memberPub, status)');
  const refresh = grabMethod(STEWARD, 'refreshClearances(memberPubs, minors, approved)');
  // refreshClearances is now a thin serialising wrapper around _refreshClearancesNow — lift both, and anchor
  // the inner one on `async ` because its first textual occurrence is the CALL inside the wrapper.
  const refreshNow = grabMethod(STEWARD, 'async _refreshClearancesNow(memberPubs, minors, approved)');
  // esbuild renames the nip44 imports (encrypt3 / getConversationKey today). Binding the names I EXPECTED
  // instead of the ones it uses made every publish throw inside publishClearance's own try/catch and return
  // null — 150 nulls, nothing on the wire, indistinguishable from the bug under test. Detect them, and fail
  // loudly if a rebuild renumbers them, rather than quietly testing nothing.
  const encName = (pubClearance.match(/=\s*(encrypt\d*)\(/) || [])[1];
  const ckName = (pubClearance.match(/\b(getConversationKey\d*)\(/) || [])[1];
  assert.ok(encName && ckName, 'publishClearance no longer encrypts the way this test expects — re-anchor it');
  // READ-BEFORE-WRITE IS DELIBERATELY OUT OF SCOPE HERE, and this is a real decision rather than a convenience.
  // This file is about PACING a whole-roster back-fill under the relay's 100/s inbound cap — the first-ever
  // back-fill for a church, where nothing is stored yet and therefore nothing would be skipped anyway. The
  // skip path has its own file (console-publish-honesty.test.mjs) driving it against a real authenticated
  // relay. Reporting "not authenticated" here is the honest way to say "no trusted read available", and the
  // shipped code's response to that is to publish everything — which is exactly the workload under test.
  const _isRelayAuthed = () => false;
  // …and with no trusted read there is nothing to consult, so no relay is "currently connected" for
  // read-before-write's purposes either. Both stubs say the same thing: this file measures the cold-roster
  // publish path, where nothing is stored yet and nothing would be skipped anyway.
  const _connectedRelays = () => [];
  // The read-and-compare step now lives in its own helper, shared by the skip path and the verify-before-alarm
  // path. It must be LIFTED, not stubbed: _refreshClearancesNow calls it by name, so a scope without it throws
  // ReferenceError on the first back-fill. Both stubs above make it return null on its first line — this file
  // measures the cold-roster publish path — but the real function has to be present to be called at all.
  const skewDecl = (STEWARD.match(/var _CLOCK_SKEW = [^\n]*\n/) || [])[0];
  const futureDecl = (STEWARD.match(/var _authFuture = [^\n]*\n/) || [])[0];
  // The console refuses the clearance back-fill in a NETWORK view — lifted, not stubbed, because a stub
  // would assert my description of when that refusal fires rather than the console's.
  const netViewDecl = (STEWARD.match(/var _viewingNetwork = [^\n]*\n/) || [])[0];
  const matching = skewDecl + futureDecl + netViewDecl
    + grabMethod(STEWARD, 'function _topWeMustAnswer(') + grabMethod(STEWARD, 'function _clearanceStale(')
    + grabMethod(STEWARD, 'async function _clearancesMatching(')
    + grabMethod(STEWARD, 'function _clearanceOutranks(');
  const decName = (matching.match(/\b(decrypt\d*)\(/) || [])[1];
  assert.ok(decName, 'the clearance read no longer decrypts a stored record — re-anchor this test');
  const scope = {
    // The batch bound is now DERIVED from the pool's connection timeout rather than hardcoded at 8s, because a
    // fixed bound is what made the console report lost children on every link slower than a datacentre. An
    // empty pool object exercises the shipped `|| 3000` fallback, which is the path the real console takes —
    // it constructs SimplePool without setting maxWaitForConnection.
    pool: {},
    _isRelayAuthed, _connectedRelays, Map, Date,
    [decName]: (c, k) => nip44v2.decrypt(c, k),
    sk: church.sk, pub: church.pub, actingChurch: '',
    CLEARANCE_D: CLEAR_D, NET: 'trinityone',
    // This device's OWN church key. The console refuses the clearance back-fill when `pub` is neither
    // churchPub nor a church it is acting for — that is a NETWORK identity, which has no members.
    churchPub: church.pub,
    _sgSourceTs: 0, _careRoster: new Set(),
    now, publish,
    feChurch: (t) => finalizeEvent(t, church.sk),
    toPubHex: (p) => (/^[0-9a-f]{64}$/i.test(p) ? p.toLowerCase() : null),
    [encName]: (s, k) => nip44v2.encrypt(s, k),
    [ckName]: (a, b) => nip44v2.utils.getConversationKey(a, b),
    window: { Steward: {}, dispatchEvent: (e) => { blocked.push(e); } },
    CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    setTimeout, Promise, Set, String, JSON,
  };
  const args = Object.keys(scope);
  const sentDecl = (STEWARD.match(/var _clearanceSent = [^\n]*\n/) || [])[0];
  const queueDecl = (STEWARD.match(/var _clearanceQueue = [^\n]*\n/) || [])[0];
  assert.ok(sentDecl && queueDecl, 'the clearance just-sent cache / serialisation queue are gone — re-anchor');
  const api = new Function(...args,
    sentDecl + queueDecl + matching + `\nreturn ({ ${pubClearance},\n    ${refresh},\n    ${refreshNow} });`)(...args.map(k => scope[k]));
  Object.assign(scope.window.Steward, api);
  return { api, blocked, refused, ok: () => okCount };
}

const conn = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });

async function storedCount(pubs) {
  const w = await conn();
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

// CONTROL, and it runs first on purpose. A harness that cannot publish AT ALL produces exactly the same
// symptom as the bug — nothing stored — so without this, a broken harness reads as a confirmed finding. That
// happened while writing this file: the wrong nip44 identifier made publishClearance throw inside its own
// catch and return null 150 times, and the headline test went red for a reason that had nothing to do with
// the code under test. If this control fails, the TEST is broken, not the console.
test('CONTROL: the harness can publish a clearance at all', async () => {
  const w = await conn();
  const side = consoleSide(w);
  const one = members[0].pub;
  await side.api.refreshClearances([one], [one], []);
  await sleep(400);
  const stored = await storedCount([one]);
  w.close();
  assert.equal(side.ok(), 1, 'the relay never acknowledged a single publish — the HARNESS is broken (check the ' +
    'identifier names lifted from vendor/steward.js), not the back-fill');
  assert.equal(stored, 1, 'one clearance for one member did not store — the harness or the relay fixture is wrong');
});

test('every member on a 150-strong roster gets a clearance', async (t) => {
  t.diagnostic(`roster of ${ROSTER}, relay cap is 100 inbound messages/second/connection`);
  const w = await conn();
  const side = consoleSide(w);
  const minors = members.slice(0, 40).map(m => m.pub);          // 40 children, spread across the roster
  // Bounded, because the burst version never returns: it awaits Promise.allSettled over every publish, and a
  // rate-limited message is answered with silence, so those promises never settle. Without this the old code
  // hangs the runner instead of failing, which reads as an infrastructure problem rather than a finding.
  const r = await Promise.race([
    side.api.refreshClearances(members.map(m => m.pub), minors, []),
    new Promise(res => setTimeout(() => res({ timedOut: true }), 60000)),
  ]);
  await sleep(500);
  const stored = await storedCount(members.map(m => m.pub));
  w.close();
  t.diagnostic(`OK=${side.ok()} refused=${side.refused.length} ${side.refused.slice(0,2).join('|')}`);
  t.diagnostic(`stored ${stored}/${ROSTER}, refreshClearances reported failed=${r && r.failed}`);
  assert.equal(stored, ROSTER,
    `${ROSTER - stored} members have NO clearance document. Their app falls back to the minors list, which the ` +
    'relay does not serve to ordinary members — so every child among them is treated as an adult, silently');
});

test('and it reports how many it reached, instead of returning nothing', async () => {
  // The burst version returned Promise.allSettled and nobody looked. The caller needs to know whether to
  // record the back-fill as done, and the steward needs to know if children were missed.
  const w = await conn();
  const { api } = consoleSide(w).api ? consoleSide(w) : consoleSide(w);
  const r = await api.refreshClearances(members.slice(0, 5).map(m => m.pub), [], []);
  w.close();
  assert.equal(typeof r, 'object', 'refreshClearances tells the caller nothing about what happened');
  assert.equal(r.total, 5);
  assert.equal(r.failed, 0, 'a small back-fill against a healthy relay should not report failures');
});

test('a failure reaches a screen', async () => {
  // The console has had a mounted PublishErrorBanner since AUDIT-2026-07-27. A safeguarding write that half
  // worked must use it; that is the difference between this being fixed and being fixed-looking.
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  assert.match(D, /addEventListener\('steward-write-blocked'/, 'nothing renders write refusals any more');
  // Brace-matched on the INNER function, not a fixed window from the wrapper. refreshClearances is now a short
  // serialising shim, so `slice(at, at + 2600)` reads past it into the neighbouring method and asserts nothing
  // about the code it names — the fixed-window trap this repo keeps re-learning.
  const fn = grabMethod(STEWARD, 'async _refreshClearancesNow(memberPubs, minors, approved)');
  assert.match(fn, /steward-write-blocked/,
    'a partial safeguarding back-fill is still silent — the children it missed stay missed and nobody is told');
});

// ── the back-fill must run ONCE per Members open ─────────────────────────────────────────────────────────
// HANDOFF-2026-07-31, findings 2 and 3. Everything above is about a back-fill that runs and half-lands. This
// is about one that runs TWICE and then never stops.
//
// Measured on the device: refreshClearances fires twice on a single Members-tab open, 96 ms apart, both with
// the full roster — `[[228,21],[324,21]]`. The effect's deps are fresh array identities on every roster emit,
// and the only guard was recorded in a `.then()` AFTER a run that takes at least 250 ms (GAP_MS). So the second
// emit arrives while the first run is still in flight, reads the marker as unset, and republishes everything.
//
// Two harms, and the second is the one that lasts:
//
//   • `created_at` is whole seconds, so both runs stamp the same second for most members. The relay's NIP-01
//     tie-break refuses the loser ("a newer version of this is already stored"), and refusals were counted as
//     children who did not get their record — the false safeguarding banner that trained stewards to ignore it.
//   • `clearanceBackfillDone` is only recorded when `failed === 0`, and the duplicate run guarantees
//     `failed > 0`. So it is NEVER recorded. Every single Members visit re-seals and republishes the whole
//     roster, for ever. At 500 members that is ~1000 NIP-44 seals and ~1000 events — about 25 seconds of paced
//     publishing — per visit, over exactly the thin connections this product is built for.
//
// This EXECUTES the shipped effect callback lifted out of app/stew-dashboard.jsx (a classic script the console
// loads as-is; there is no build step between that file and the phone). The `clearanceBackfillDone` marker is a
// module-level `let` in that file, so the harness re-declares it in an enclosing closure and hands back a peek
// — passing it as a parameter would make the effect's assignment invisible and the test meaningless.
function backfillEffect() {
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const hit = D.indexOf('clearanceBackfillDone === sig');
  assert.ok(hit > 0, 'the back-fill guard is gone from stew-dashboard.jsx — re-anchor this test');
  const at = D.lastIndexOf('React.useEffect(', hit);
  assert.ok(at > 0, 'the back-fill is no longer in a useEffect — re-anchor this test');
  const open = D.indexOf('{', at);
  let depth = 0, i = open;
  for (; i < D.length; i++) {
    const c = D[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(depth === 0 && i > hit, 'braces did not balance lifting the effect — re-anchor this test');
  const body = D.slice(open, i + 1);

  const calls = [];                                   // one entry per refreshClearances invocation
  let answer = { failed: 0, total: 0 };               // what the next run resolves with
  let gate = null;                                    // held open so a run can be observed mid-flight
  const Steward = {
    churchPub: church.pub, actingChurch: '', relayAuthed: () => true,
    refreshClearances: (roster, mins, appr) => {
      calls.push({ n: roster.length, mins: (mins || []).length, appr: (appr || []).length });
      const res = { ...answer, total: roster.length };
      return gate ? gate.then(() => res) : Promise.resolve(res);
    },
  };
  // The module-scope state the effect mutates. Re-declared here (not passed as parameters) because the effect
  // ASSIGNS to these, and an assignment to a parameter is invisible to the caller — the test would then prove
  // nothing. `now` is injectable so the retry cooldown can be exercised without a real 60-second wait.
  let clock = Date.now();
  const make = new Function('window', 'Date', `
    let clearanceBackfillDone = '';
    let clearanceBackfillFailedAt = 0;
    let clearanceBackfillLastSig = '';
    const CLEARANCE_RETRY_MS = 60000;
    const effect = (sg, members) => ${body};
    return { effect, peek: () => clearanceBackfillDone, failedAt: () => clearanceBackfillFailedAt };
  `)({ Steward }, { now: () => clock });
  return {
    ...make, calls, Steward,
    advance: (ms) => { clock += ms; },
    answers: (a) => { answer = a; },
    hold: () => { let open_; gate = new Promise(r => { open_ = r; }); return () => { const g = gate; gate = null; open_(); return g; }; },
  };
}
const ROSTER5 = () => Array.from({ length: 5 }, (_, i) => ({ pubkey: members[i].pub }));
const SG = (extra = {}) => ({ loaded: true, minors: [members[0].pub], approved: [], nophoto: [], ...extra });
const tick = () => new Promise(r => setTimeout(r, 0));

test('TWO ROSTER EMITS ON ONE MEMBERS OPEN MUST PRODUCE ONE BACK-FILL, NOT TWO', async () => {
  const h = backfillEffect();
  const release = h.hold();                      // the run is in flight, exactly as it is 96 ms in
  // React re-runs the effect because `members` and `sg.minors` are fresh array identities each emit. Same
  // CONTENT, new identity — so the signature is identical and this is one logical open, twice.
  h.effect({ ...SG() }, ROSTER5());
  h.effect({ ...SG() }, ROSTER5());
  await tick();
  assert.equal(h.calls.length, 1,
    `the back-fill ran ${h.calls.length} times on one Members open (rosters: ${JSON.stringify(h.calls.map(c => c.n))}). ` +
    'Measured on the device as [[228,21],[324,21]]. Both runs stamp the same whole second for most members, the ' +
    'relay refuses the loser on its NIP-01 tie-break, and those refusals are reported to the steward as children ' +
    'who did not receive their safeguarding record.');
  await release();
  await tick();
});

test('a fully successful back-fill is remembered, so returning to Members does not republish the roster', async () => {
  const h = backfillEffect();
  h.answers({ failed: 0 });
  h.effect(SG(), ROSTER5());
  await tick(); await tick();
  h.effect(SG(), ROSTER5());                     // steward leaves the tab and comes back
  await tick();
  assert.equal(h.calls.length, 1,
    'a completed back-fill re-published the whole roster on the next Members visit. For a 500-member church ' +
    'that is ~1000 seals and ~1000 events every single visit, permanently.');
});

test('A BACK-FILL THAT MISSED SOMEONE MUST STILL BE RETRIED', async () => {
  // The dangerous direction, and the reason the marker was in a `.then()` in the first place. Claiming the
  // signature up front is only safe if a failed run gives it back — otherwise a partial back-fill becomes a
  // permanent one and the children it missed are never revisited.
  const h = backfillEffect();
  h.answers({ failed: 3 });
  h.effect(SG(), ROSTER5());
  await tick(); await tick();
  assert.equal(h.peek(), '', 'a back-fill that missed 3 members recorded itself as done');
  h.advance(61000);                              // past the retry cooldown (see the hot-loop test below)
  h.effect(SG(), ROSTER5());
  await tick();
  assert.equal(h.calls.length, 2,
    'a back-fill that reported failures was never retried. Those members have no clearance document, their app ' +
    'falls back to the minors list, and the relay does not serve that list to ordinary members — so every child ' +
    'among them is treated as an adult until a steward happens to toggle their flag.');
});

test('A FAILING BACK-FILL MUST NOT BECOME A HOT LOOP ON A DOWN LINK', async () => {
  // HANDOFF-2026-07-31 audit. Releasing the claim on failure is what makes the retry above possible, and the
  // effect's deps are fresh array identities on every roster emit — so without a cooldown the very next emit
  // restarts the whole thing, for ever. This only became reachable when fix 4 made publish() tell the truth:
  // before that an offline run reported `failed: 0` and the loop stayed quiet.
  //
  // At 500 members a cycle is ~500 NIP-44 seals and ~25 seconds of paced publishing, on a cheap phone with no
  // connection. That is the device and the link this product exists for.
  const h = backfillEffect();
  h.answers({ failed: 5 });
  for (let i = 0; i < 4; i++) { h.effect(SG(), ROSTER5()); await tick(); await tick(); }
  assert.equal(h.calls.length, 1,
    `an offline Members tab ran the back-fill ${h.calls.length} times across 4 roster emits with no connection. ` +
    'Each run re-seals and re-publishes the entire roster.');
  h.advance(61000);
  h.effect(SG(), ROSTER5());
  await tick();
  assert.equal(h.calls.length, 2, 'the cooldown never expires, so a genuinely retryable back-fill is stuck');
});

test('…but a roster that CHANGED does not wait out the cooldown', async () => {
  // A child marked while the link is down must be sealed as soon as the link is back — not up to a minute
  // later. The cooldown is keyed to the signature that failed, so a new signature goes straight through.
  const h = backfillEffect();
  h.answers({ failed: 5 });
  h.effect(SG(), ROSTER5());
  await tick(); await tick();
  assert.equal(h.calls.length, 1);
  h.answers({ failed: 0 });
  h.effect(SG({ minors: [members[0].pub, members[1].pub] }), ROSTER5());   // a steward just marked another child
  await tick();
  assert.equal(h.calls.length, 2,
    'a newly-marked child had to wait out the failed run’s cooldown before their clearance was sealed');
});

test('…and a back-fill that THREW is retried too', async () => {
  const h = backfillEffect();
  h.Steward.refreshClearances = () => { h.calls.push({ n: 5 }); return Promise.reject(new Error('relay gone')); };
  h.effect(SG(), ROSTER5());
  await tick(); await tick();
  assert.equal(h.peek(), '', 'a back-fill that threw recorded itself as done');
  h.advance(61000);
  h.effect(SG(), ROSTER5());
  await tick();
  assert.equal(h.calls.length, 2, 'a back-fill that threw was never retried');
});

test('a roster that genuinely CHANGES mid-run still gets its own back-fill', async () => {
  // Keying on the signature rather than a bare in-flight boolean is what makes this work: a member who joins
  // while the first run is in flight changes the signature, so their clearance is not skipped.
  const h = backfillEffect();
  const release = h.hold();
  h.effect(SG(), ROSTER5());
  const bigger = [...ROSTER5(), { pubkey: members[9].pub }];    // someone joined
  h.effect(SG(), bigger);
  await tick();
  assert.equal(h.calls.length, 2,
    'a member who joined while the back-fill was running was skipped, and nothing will revisit them');
  assert.deepEqual(h.calls.map(c => c.n), [5, 6]);
  await release();
});

test('a failed run must not clobber a newer signature that has already claimed the marker', async () => {
  // The subtle one. Run A (5 members) is in flight and holds the marker. The roster changes, run B (6 members)
  // claims the marker for the new signature. Run A then fails and clears the marker — if it clears it blindly
  // it erases B's claim, and B's signature is re-run on the next emit for no reason. Clear only your OWN claim.
  const h = backfillEffect();
  const releaseA = h.hold();
  h.answers({ failed: 2 });                       // run A will fail
  h.effect(SG(), ROSTER5());
  const bigger = [...ROSTER5(), { pubkey: members[9].pub }];
  h.answers({ failed: 0 });                       // run B succeeds immediately (no gate by the time it runs)
  h.effect(SG(), bigger);
  await releaseA();
  await tick(); await tick(); await tick();
  const sigB = h.peek();
  assert.notEqual(sigB, '',
    'the failed run cleared the marker that a LATER, successful run had already claimed — so that later ' +
    'signature is re-published from scratch on the next roster emit, for ever');
  h.effect(SG(), bigger);
  await tick();
  assert.equal(h.calls.length, 2, 'the successful newer back-fill was re-run despite having completed');
});

test('the guard is claimed synchronously, before anything is awaited', () => {
  // Structural backstop for the behavioural tests above. The whole defect was that the ONLY write to the
  // marker sat in a `.then()`, so every caller that arrived inside the run's own duration saw it unset. If a
  // later edit moves the claim back behind an await, the tests above catch it — but this says why in one line.
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const hit = D.indexOf('clearanceBackfillDone = sig');
  const guard = D.indexOf('clearanceBackfillDone === sig');
  const call = D.indexOf('window.Steward.refreshClearances(roster');
  assert.ok(hit > 0 && guard > 0 && call > 0, 're-anchor: the back-fill guard moved');
  assert.ok(hit > guard && hit < call,
    'the back-fill signature is no longer claimed between the guard and the call. Recording it after the ' +
    'await is what let one Members open fire two full-roster back-fills 96 ms apart.');
});

test('the batching is paced under the relay cap, and bounded', () => {
  const fn = grabMethod(STEWARD, 'async _refreshClearancesNow(memberPubs, minors, approved)');
  const batch = Number((fn.match(/BATCH = (\d+)/) || [])[1]);
  const gap = Number((fn.match(/GAP_MS = (\d+)/) || [])[1]);
  assert.ok(batch > 0 && gap > 0, 'the pacing constants are gone — re-anchor this test');
  assert.ok((batch * 1000) / gap < 100,
    `pacing is ${(batch * 1000) / gap}/s, at or above the relay's 100/s cap — messages will be dropped with no reply`);
  assert.match(fn, /Promise\.race/,
    'the await is unbounded, so one publish the relay never answers stalls the rest of the roster');
});
