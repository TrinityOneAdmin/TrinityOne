// THE DIRECT-MODE PUSH READER COUNTS A DM A GATED RELAY WITHHOLDS UNTIL AUTH (the 2026-11-23 false-alarm shape).
//   Run: node scripts/run-tests.mjs scripts/the-push-reader-counts-a-dm-a-gated-relay-withholds-until-auth.test.mjs
//
// WHY THIS FILE EXISTS. On 2026-11-23 the reader returned zero against a Living Word relay and it was filed as a
// reader bug; the true cause was a STALE relay without the post-AUTH replay. On current code the relay withholds a
// gated kind-4 from an unauthenticated REQ, challenges, and on AUTH-OK replays what it withheld — and the reader
// counts it (proven on the control rig: verdict new-events, newSinceCursor 1, byKind {4:1}). Nothing in the suite
// pinned that POSITIVE gated path: the filter tests inject events past the fetch, and the B4 file
// (the-push-reader-keeps-the-widget-when-auth-is-refused.test.mjs) covers only the REFUSED side. This file drives
// the shipped fetch/AUTH/count path against a genuinely gated relay holding a DM behind the gate.
//
// WHAT RUNS IS THE SHIPPED CODE (CLAUDE.md rule 3; bundle names kept). bg-entry.js cannot be imported in node, so
// GATE 3 — everything from the cursor read to `return finish({...})`: the filters, pool.automaticallyAuth = sign,
// subscribeMany with the eose+auth-grace, counts(), the blocklist drop, the cursor `newer` filter, readerVerdict —
// is SLICED OUT OF __dpStart and EXECUTED verbatim against a real scripts/gateway.mjs from THIS tree (spawned by
// relay-network-harness on an EPHEMERAL port with a throwaway data dir; teardown kills exactly that PID). The lifted
// helpers (lsJson, visibleGroupIds, watchAuthOutcome, readerVerdict, widgetCountAction, isBlockDoc, parseBlocked)
// keep their bundle names. The ONLY substitutions are the slice's free variables: cp/np/pub/sk (GATE 2's outputs,
// handed in directly), a Fellowship stub (relayVerified admits only the spawned relay; assumeMinor true = the
// fail-closed DM-only shape, which is exactly the path under test), a localStorage map behind the real lsJson, and
// a tracking `setTimeout` (same semantics; lets after() clear the shipped 30s watchdog so the process can exit).
//
// VACUOUS-PASS GUARD: the first test proves the rig is really gated — an ANONYMOUS read of the same DM filter gets
// ZERO kind-4 events and draws an AUTH challenge (the challenge only fires when a matching stored event was
// withheld, so it also proves the DM is on the relay). If the relay served without AUTH, that test goes red.
//
// POINT-OF-USE: if the reader's AUTH path is deleted (e.g. `pool.automaticallyAuth = sign;` removed from
// bg-entry.js), the relay never replays, the slice counts zero and the LIVE tests here go red (verified by hand,
// see the commit). If the relay's kind-4 gate is deleted from gateway.mjs, the control test goes red (ditto).
//
// Callers of the lifted code (rule 2, unchanged by this file — it edits nothing): the GATE-3 slice and every
// helper lifted here are used only by __dpStart; widgetCountAction also by finish().
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { fnBody } from './test-slice.mjs';
import { D } from './trinity-doc-types.mjs';
import { startRelay, stopAll, connect, publish, key, now, sleep } from './relay-network-harness.mjs';

// ── lift the shipped reader code ─────────────────────────────────────────────────────────────────────────
const SRC = readFileSync(new URL('../plugins/trinity-directpush/js/bg-entry.js', import.meta.url), 'utf8');
const visibleGroupIds = new Function(fnBody(SRC, 'function visibleGroupIds(', 'visibleGroupIds') + '\nreturn visibleGroupIds;')();
const watchAuthOutcome = new Function(fnBody(SRC, 'function watchAuthOutcome(', 'watchAuthOutcome') + '\nreturn watchAuthOutcome;')();
const readerVerdict = new Function(fnBody(SRC, 'function readerVerdict(', 'readerVerdict') + '\nreturn readerVerdict;')();
// MERGE 2026-11-25 (B6): the cursor read now goes through readerCursor(docs, mems, dmseen) — lift it too.
const readerCursor = new Function(fnBody(SRC, 'function readerCursor(', 'readerCursor') + '\nreturn readerCursor;')();
const widgetCountAction = new Function(fnBody(SRC, 'function widgetCountAction(', 'widgetCountAction') + '\nreturn widgetCountAction;')();
const parseBlocked = new Function(fnBody(SRC, 'function parseBlocked(', 'parseBlocked') + '\nreturn parseBlocked;')();
const isBlockDoc = new Function(SRC.match(/const isBlockDoc = [^\n]+;\n/)[0] + 'return isBlockDoc;')();
const lsJsonSrc = SRC.match(/const lsJson = [^\n]+;\n/)[0];
const [, DM_KIND, GROUP_KIND] = SRC.match(/const DM_KIND = (\d+), GROUP_KIND = (\d+)/).map(Number);
const SINCE_SLOP = new Function('return ' + SRC.match(/const SINCE_SLOP = ([^;]+);/)[1] + ';')();

// GATE 3 of __dpStart, verbatim: from the cursor read to the `return finish({...})` the worker consumes.
const fn = SRC.slice(SRC.indexOf('window.__dpStart = async function'), SRC.indexOf('\nfunction finish('));
const g3at = fn.indexOf("const docs = lsJson('trinityone.docshub.'");
assert.notEqual(g3at, -1, 'GATE 3 cursor read is missing from __dpStart — re-anchor this test');
const endAnchor = 'droppedBlocked });';
assert.equal(fn.indexOf(endAnchor), fn.lastIndexOf(endAnchor), 'the finish statement must appear exactly once');
const G3 = fn.slice(g3at, fn.indexOf(endAnchor) + endAnchor.length);
const runGate3 = new Function(
  'F', 'cp', 'np', 'pub', 'sk', 'opts', 'set', 'rep', 'finish', 'setTimeout',
  'SimplePool', 'finalizeEvent', 'lsJson', 'visibleGroupIds', 'watchAuthOutcome', 'readerVerdict', 'readerCursor',
  'isBlockDoc', 'parseBlocked', 'DP_DEBUG', 'DM_KIND', 'GROUP_KIND', 'SINCE_SLOP',
  'return (async () => {\n' + G3 + '\n})();'
);

// ── the rig: a real, church-registered, NIP-42-gated gateway from THIS tree ──────────────────────────────
const church = key();      // the registered church
const member = key();      // the reader's identity (the DM's recipient)
const sender = key();      // a second member, the DM's author
const cp = church.pub, np = npubEncode(church.pub);
const memberDoc = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.MEMBER + cp]], content: JSON.stringify({ joined: now() }) }, who.sk);

let relay = null, dmAt = 0;
before(async () => {
  relay = await startRelay({ name: 'b2-gated', churches: [cp] });
  const w = await connect(relay);
  try {
    for (const who of [member, sender]) assert.equal((await publish(w, memberDoc(who)))[0], true, 'member joined');
    await sleep(150);                                        // let the relay hydrate MEMBERS
    dmAt = now();
    const dm = finalizeEvent({ kind: 4, created_at: dmAt, tags: [['p', member.pub]], content: 'gated-hello' }, sender.sk);
    assert.equal((await publish(w, dm))[0], true, 'the DM is stored on the relay');
  } finally { try { w.close(); } catch {} }
});
after(() => { for (const t of timers) clearTimeout(t); stopAll(); });

const timers = [];
const trackingSetTimeout = (f, ms) => { const t = setTimeout(f, ms); timers.push(t); return t; };

// Run the shipped GATE 3 as the member, with the app's cursor at `cursor`. Returns the finish() summary.
async function runReader(cursor) {
  const store = new Map([
    ['trinityone.docshub.' + cp, { since: cursor }],
    ['trinityone.memhub.' + cp, { since: 0 }],
    ['trinityone.groups.' + np, []],                         // no group cache => the reader's DM-only shape
  ]);
  const fakeLS = { getItem: (k) => (store.has(k) ? JSON.stringify(store.get(k)) : null) };
  const lsJson = new Function('localStorage', lsJsonSrc + 'return lsJson;')(fakeLS);
  const un = (u) => String(u).replace(/\/+$/, '');
  const F = {
    measureRelaySkew: async () => 0,
    relayVerified: (u) => un(u) === un(relay.wsUrl),        // only the spawned relay is admitted (rule 10 shape)
    assumeMinor: async () => true,                          // the reader's fail-closed default before the authed REQ
  };
  return runGate3(F, cp, np, member.pub, member.sk, {}, [relay.wsUrl], () => {}, (o) => o, trackingSetTimeout,
    SimplePool, finalizeEvent, lsJson, visibleGroupIds, watchAuthOutcome, readerVerdict, readerCursor,
    isBlockDoc, parseBlocked, false, DM_KIND, GROUP_KIND, SINCE_SLOP);
}

// ── (a) the control: the rig is genuinely gated, or everything after this is vacuous ─────────────────────
test('CONTROL: an anonymous read of the member\'s DM filter gets ZERO kind-4 events and draws an AUTH challenge', async () => {
  const w = await connect(relay);
  const got = await new Promise((resolve) => {
    const events = []; let gotAuth = false;
    w.on('message', (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === 'ctl') events.push(m[2]);
      else if (m[0] === 'AUTH') gotAuth = true;             // challenged and deliberately NOT answered
    });
    w.send(JSON.stringify(['REQ', 'ctl', { kinds: [4], '#p': [member.pub], since: 0 }]));
    setTimeout(() => resolve({ events, gotAuth }), 1500);   // beyond the relay's 2.5s? no — past its first flushes; EOSE may still be held, events would have arrived by now
  });
  try { w.close(); } catch {}
  assert.equal(got.events.filter((e) => e.kind === 4).length, 0, 'GATE BROKEN: the relay served a kind-4 DM to an unauthenticated reader — every LIVE pass below is vacuous');
  assert.equal(got.gotAuth, true, 'the relay must challenge (it only challenges when a matching stored event was withheld — this also proves the DM is on the relay)');
});

// ── the slice really is the shipped fetch path ───────────────────────────────────────────────────────────
test('the slice under test is the shipped GATE 3: one automaticallyAuth signer, one subscribeMany, one verdict assignment', () => {
  assert.equal((G3.match(/pool\.automaticallyAuth = sign;/g) || []).length, 1, 'the reader\'s AUTH signer is wired in the slice');
  assert.equal((G3.match(/pool\.subscribeMany\(/g) || []).length, 1, 'exactly one subscribeMany drives the fetch');
  assert.equal((G3.match(/const verdict = readerVerdict\(/g) || []).length, 1, 'the verdict is assigned through readerVerdict');
  assert.ok(G3.includes("fin('eose+auth-grace')"), 'the post-auth replay grace is in the slice');
});

// ── (b)+(c) the positive gated path the 11-23 incident had no harness for ────────────────────────────────
test('LIVE: the reader AUTHs, receives the post-AUTH replay, and COUNTS the gated DM — and the verdict is new-events, not auth-unconfirmed', async () => {
  const o = await runReader(dmAt - 100);                    // cursor before the DM, as on a phone that has not synced it
  assert.ok(o.authSigned >= 1, 'the reader signed an AUTH (the relay challenged its gated REQ)');
  assert.deepEqual(Object.values(o.authOutcomes || {}), Object.values(o.authOutcomes || {}).map(() => 'ok'), 'the relay confirmed the AUTH OK=true (B4 vocabulary: ok, not refused/sent)');
  assert.ok(o.fetchedInWindow >= 1, 'the post-AUTH replay delivered the gated DM to the one-shot reader');
  assert.ok(o.newSinceCursor >= 1, 'the DM is counted as new since the cursor');
  assert.ok((o.byKind || {})[4] >= 1, 'byKind names the DM kind, as on the control rig');
  assert.equal(o.verdict, 'new-events');
  assert.doesNotMatch(o.verdict, /auth-unconfirmed/, 'a confirmed, replayed count is distinct from B4\'s refused/unconfirmed verdict');
  assert.deepEqual(widgetCountAction(o.verdict, o.newSinceCursor), { op: 'set', n: o.newSinceCursor }, 'the worker would set the widget');
});

// ── (d) cursor semantics: the second pass double-counts nothing, and its zero is a CONFIRMED zero ────────
test('LIVE: a second pass with the cursor past the DM still fetches it (slop window) but counts ZERO new — a CONFIRMED zero that clears', async () => {
  const o = await runReader(dmAt + 1);                      // the app has synced past the DM
  assert.ok(o.fetchedInWindow >= 1, 'the DM is still fetched inside the SINCE_SLOP overlap — the zero below is from the cursor, not from a failed fetch (the 11-23 false-alarm shape)');
  assert.equal(o.newSinceCursor, 0, 'nothing is counted twice');
  assert.deepEqual(Object.values(o.authOutcomes || {}), Object.values(o.authOutcomes || {}).map(() => 'ok'), 'this zero is trustworthy ONLY because the AUTH was confirmed');
  assert.equal(o.verdict, 'genuinely-0-new');
  assert.deepEqual(widgetCountAction(o.verdict, 0), { op: 'clear' }, 'a real zero still clears — the widget staleness design holds');
});
