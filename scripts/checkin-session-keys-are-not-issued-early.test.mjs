// THE ISSUER IS WIRED, AND IT MUST NOT FIRE BEFORE THE ENVELOPES HAVE BEEN READ.
//   Run: node --test scripts/checkin-session-keys-are-not-issued-early.test.mjs
//
// Piece 3 of reference/SCOPE-CHECKIN-SEALING-2026-09-10.md. Both halves of the check-in session-key issuer
// had NO product caller until this change: `grep -rl issueCheckinSessionKeys app/` and `grep -rl
// subscribeCheckinSessionKeys app/` both returned nothing, so a steward could clear somebody for children's
// work and no key was ever minted for them, on any Sunday, for ever (CLAUDE.md rule 1).
//
// ⚠ WHAT WIRING IT NAIVELY WOULD HAVE COST, which is why this file exists and is named for the race rather
// than the feature. `issueCheckinSessionKeys` recovers a session's EXISTING key out of the envelope list
// `subscribeCheckinSessionKeys` delivers. Handed a list that is merely empty-so-far, every branch of the
// issuer reads "this Sunday has no envelope", publishes one, and mints a FRESH key — rotating the session's
// key and orphaning everything already sealed under the old one. The register goes on painting normally,
// because the church's own ring copy in `content` is untouched: only the helper's copy dies, and nothing
// anywhere says so. An effect firing on mount, on a reconnect, or on a clearance edit is exactly where that
// lands, and the empty list it passes is indistinguishable at the call site from a church that has none.
//
// TWO HALVES, BOTH DRIVEN:
//   • THE ENGINE — subscribeCheckinSessionKeys, issueCheckinSessionKeys, publishCheckinHelpers and
//     checkinSessionKeysSettled, LIFTED OUT OF vendor/steward.js (the bundle the console loads) and run
//     against one shared scope, so the flag the subscription writes is the flag the issuer reads. The
//     builders and the window/permission maths come from scripts/checkin-role-source.mjs, the module esbuild
//     inlines into that bundle. What is stubbed is the world — the key, the clock, the socket — never a
//     decision a test here is named after (memory: stub-answers-the-question).
//   • THE SCREEN — CheckinSessionKeys, sliced out of app/stew-dashboard.jsx by brace-match and compiled with
//     the same esbuild the packaged build uses, then rendered through miniReact (which runs useEffect with
//     real deps comparison). CLAUDE.md rule 3 forbids asserting any of this by matching text in an
//     app/*.jsx file: those ship unbundled, so `false && ` in front of the gate leaves every word of it in
//     place and a text assertion still passes.
//
// A NOTE ON THE HOUSE SCAFFOLD, because it fails silently. `fnBody()` returns the WHOLE function including
// its signature, and the lift wraps it in an OBJECT LITERAL — `({ <body> }).name`. Nest it inside another
// wrapper and nothing runs while every negative assertion passes vacuously. So every harness here carries a
// `probe` of counters, and the positive tests assert the probe was ENTERED. A negative test whose harness
// never reached the code is not a negative test.
//
// NO FIXED PORTS AND NO RELAY. Nothing here binds a socket, so it cannot collide with the suite's
// hard-coded-port tests (console-publish-honesty.test.mjs and relay-church-scope.test.mjs already collide
// with each other on 8993 — pre-existing, and nothing to do with this file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody, stmt } from './test-slice.mjs';
import { miniReact, texts, flow, reads, glued } from './render-jsx-screen.mjs';
import { buildHelperGrant, helperPolicy, lifetimeWindow, eligibleHelpers, GRANT_SOURCE, KEY_LEAD_SECONDS,
         permittedHelpers, permissionPolicy, permissionWindow, buildCheckinPermission, readCheckinPermission,
         readHelperGrant, PERMISSION_LIFETIMES } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const VENDOR = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const APP = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const CHURCH = 'c'.repeat(64);
const OTHER = '9'.repeat(64);     // a second church, for the switch case
const SGLEAD = 'a'.repeat(64);
const ADA = 'd'.repeat(64);
const BEN = 'f'.repeat(64);
const SERVICE = { date: '2026-09-13', time: '10:30' };
const SERVICE_2 = { date: '2026-09-20', time: '10:30' };
const AT = 1789200000;            // the Saturday before SERVICE — passed explicitly, never taken from a clock
const svc = (id, service) => ({ id, ...service });
// A CLEARANCE, built by the SHIPPED builder and read back through the SHIPPED parser, never restated here —
// so if the two ever stop agreeing with each other these tests go red rather than testing a fiction.
const perm = (who) => readCheckinPermission(JSON.stringify(buildCheckinPermission({
  person: who, source: 'steward', lifetime: 'open', from: 1000, until: null })));
const CLEARED = [perm(ADA)];

function proxyOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      // esbuild RENAMES on collision — `finalizeEvent` is `finalizeEvent2` in this bundle, `nip44e`/`nip44ck`
      // resolve to `encrypt3`/`getConversationKey`. Stub only the src/ spellings and every wrap throws a
      // ReferenceError that buildHelperGrant catches PER RECIPIENT, yielding an envelope with an empty `keys`
      // object — against which "X is not in keys" passes vacuously. Documented at
      // checkin-helper-mint-is-the-shipped-one.test.mjs:120.
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted issuer needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// ── THE ENGINE HARNESS ────────────────────────────────────────────────────────────────────────────────────
// One console's worth of world, and ONE scope shared by the subscription and the issuer — which is the whole
// point: `_ckKeysSettled` is module state in the console, so a harness giving each lifted function its own
// copy would make the gate untestable by construction.
function engine({ authed = true, publishOk = true, delegated = null } = {}) {
  let keyNonce = 0;
  const published = [];
  const banners = [];
  const subs = [];
  // THE COUNTERS THAT PROVE THIS HARNESS ENTERED THE CODE. See the note at the head of the file.
  const probe = { opened: 0, unwrapped: 0, published: 0, eose: 0 };
  const stubs = {
    sk: new Uint8Array(32).fill(9),
    pub: CHURCH,
    churchPub: delegated || CHURCH,
    churchSkHeld: () => !delegated,
    actingChurch: delegated ? CHURCH : null,
    _stewardCaps: { [SGLEAD]: ['safeguarding'] },
    _stewardNames: {},
    now: () => AT,
    NET: 'trinityone',
    CHECKINHELPER_D: D.CHECKINHELPER,
    // …AND THE PERMISSION'S OWN ADDRESS, because the withdrawal test below asks WHICH DOCUMENT a withdrawal
    // rewrites. `_mayClearForCheckin` is stubbed true and nothing here is about it: who may withdraw is
    // proved in scripts/checkin-permission-mint-widening.test.mjs, and a stub of the ADDRESS would be the
    // test answering its own question, which this is not.
    CHECKINPERM_D: D.CHECKINPERM,
    _mayClearForCheckin: () => true,
    // ⚠ THE FLAG UNDER TEST, and it starts EMPTY — a console that has not read anything. Nothing in this file
    // sets it by hand: it is set only by the lifted subscription's own oneose, which is the code the tests
    // are about. A harness that pre-set it would be the test answering its own question.
    _ckKeysSettled: '',
    // …AND THE GENERATION PAIR, which starts UNMATCHED for the same reason the stamp starts empty: nothing in
    // this file sets either by hand. The lifted subscription bumps `_ckKeysGen` on open and its own
    // authenticated oneose copies it into `_ckKeysSettledGen` — that is the code under test.
    _ckKeysGen: 0,
    _ckKeysSettledGen: -1,
    // AND THE SESSION KEYS, added 2026-09-10 with piece 1: the subscription now unwraps OUR OWN slot out of
    // each envelope into this map, and forgets it on a stand-down. Nothing in THIS file is about that — the
    // sealing is proved in scripts/checkin-key-separation.test.mjs against real NIP-44 — but the lifted
    // subscription reaches for it, so it has to be here. A fresh Map per harness: it is module state.
    _ckSessionKeys: new Map(),
    _isRelayAuthed: () => { return authed; },
    // THE REAL DECISION-MAKERS, out of the module esbuild inlines into the bundle under test.
    buildHelperGrant, helperPolicy, lifetimeWindow, eligibleHelpers, GRANT_SOURCE, KEY_LEAD_SECONDS,
    permittedHelpers, permissionPolicy, permissionWindow, buildCheckinPermission, readCheckinPermission,
    PERMISSION_LIFETIMES,
    // A COUNTER, NOT A CONSTANT — two sessions must get DIFFERENT keys, or "the key was preserved" cannot fail.
    crypto: { getRandomValues: (u8) => { u8.fill(0x5a + (keyNonce++)); return u8; } },
    _hex: (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join(''),
    // NIP-44 stands in for itself: a recipient-labelled wrapper, so "who can open which slot" stays provable
    // without real crypto. It decides nothing about who is in the envelope. Named twice — see proxyOf.
    nip44ck: (_sk, p2) => 'ck:' + p2,
    nip44e: (plaintext, ck) => 'sealed[' + ck + ']' + plaintext,
    getConversationKey: (_sk, p2) => 'ck:' + p2,
    encrypt: (plaintext, ck) => 'sealed[' + ck + ']' + plaintext,
    nip44d: (ct, ck) => { probe.unwrapped++; const pre = 'sealed[' + ck + ']';
      if (String(ct).indexOf(pre) !== 0) throw new Error('wrong key'); return String(ct).slice(pre.length); },
    decrypt: (ct, ck) => stubs.nip44d(ct, ck),
    finalizeEvent: (e) => ({ ...e, id: 'evt' + published.length, pubkey: stubs.pub, sig: 'sig' }),
    _publishToRelays: async (e) => { probe.published++; published.push(e); return publishOk; },
    relays: () => ['wss://relay.test/relay'],
    pool: { subscribeMany: (_relays, filters, handlers) => { probe.opened++; subs.push({ filters, handlers }); return { close() {} }; } },
    _warnUnsealed: () => {},
    _ckRotateWarned: new Set(),
    window: { dispatchEvent: (e) => { banners.push((e && e.detail) || {}); return true; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
  };
  const scope = proxyOf(stubs);
  // CAP_KEYS and _capAllows out of the bundle, with NO harness scope: both are closed over nothing, so
  // handing them one could only let a stub leak into the rule that decides who holds the register's key.
  const lifted = new Function(`${stmt(VENDOR, 'var CAP_KEYS = {', 'CAP_KEYS')} ${stmt(VENDOR, 'var _capAllows = (spec, caps) =>', '_capAllows')} return { CAP_KEYS, _capAllows };`)();
  stubs.CAP_KEYS = lifted.CAP_KEYS;
  stubs._capAllows = lifted._capAllows;
  assert.equal(stubs.CAP_KEYS.checkin.cap, 'safeguarding', 'lifted CAP_KEYS is not the shipped one — re-anchor');
  const liftScoped = (sig, name) => new Function('scope', `with (scope) { return (${stmt(VENDOR, sig, name).replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '')}); }`)(scope);
  stubs._ckIssuerHeld = liftScoped('var _ckIssuerHeld = () =>', '_ckIssuerHeld');
  stubs._ckKeysRead = liftScoped('var _ckKeysRead = () =>', '_ckKeysRead');
  stubs._warnCheckinKeyRotated = liftScoped('var _warnCheckinKeyRotated = (sessions) =>', '_warnCheckinKeyRotated');
  const lift = (sig, name) => {
    const body = fnBody(VENDOR, sig, name);
    // ⚠ THE OBJECT-LITERAL WRAPPER, NOT A NESTED FUNCTION. fnBody returns the signature too, so
    // `({ <body> }).name` is the only shape that yields a callable. See the head of this file.
    return new Function('scope', `with (scope) { return ({ ${body} }).${name}; }`)(scope);
  };
  const mint = lift('async publishCheckinHelpers(opts) {', 'publishCheckinHelpers');
  const issue = lift('async issueCheckinSessionKeys(opts) {', 'issueCheckinSessionKeys');
  const revoke = lift('revokeCheckinPermission(person) {', 'revokeCheckinPermission');
  const readKeys = lift('subscribeCheckinSessionKeys(cb) {', 'subscribeCheckinSessionKeys');
  const settledFn = lift('checkinSessionKeysSettled() {', 'checkinSessionKeysSettled');
  const self = { publishCheckinHelpers: (o) => mint.call({}, o) };
  // OPEN THE SHIPPED SUBSCRIPTION and hand back its handlers, so a test can choose to fire EOSE or NOT —
  // which is the difference every test in this file turns on. Nothing here reproduces what the subscription
  // means by an envelope, a stand-down, or an end-of-stored-events.
  const openKeys = () => {
    let rows = null;
    const stop = readKeys.call({}, (r) => { rows = r; });
    const sub = subs[subs.length - 1];
    assert.ok(sub, 'the lifted subscription never opened one — the pool stub was not reached, so this ' +
      'harness is running nothing (see the fnBody note at the head of this file)');
    return {
      deliver(events) { for (const e of events) sub.handlers.onevent(e); return rows; },
      eose() { probe.eose++; sub.handlers.oneose(); return rows; },
      rows: () => rows,
      stop,
    };
  };
  return { stubs, published, banners, subs, probe, openKeys,
    settled: () => settledFn.call({}),
    publishCheckinHelpers: (o) => mint.call({}, o),
    revokeCheckinPermission: (who) => revoke.call({}, who),
    issueCheckinSessionKeys: (o) => issue.call(self, o) };
}

// A REAL ENVELOPE EVENT, produced by the SHIPPED mint and re-signed as the relay would deliver it, so what
// the subscription is fed is what a console would actually receive. Never a hand-typed body: an envelope
// shape only a test can produce proves nothing about a console.
async function envelopeEvent(h, session, service, permissions, existingKeyHex) {
  const before = h.published.length;
  const res = await h.publishCheckinHelpers({ session, service, permissions, stewards: [SGLEAD],
    at: undefined, sessionKeyHex: existingKeyHex });
  assert.ok(res, 'fixture: the shipped mint refused to build the envelope this test needs');
  const ev = h.published[before];
  h.published.length = before;                      // the fixture's own publish is not the pass under test
  h.probe.published = 0;                            // …and neither is its probe count
  return { ...ev, created_at: AT - 3600, pubkey: CHURCH };
}

// ── 1. THE GATE ───────────────────────────────────────────────────────────────────────────────────────────

test('THE ISSUER REFUSES BEFORE EOSE — and the same call, after it, REUSES the key instead of rotating it', async () => {
  const h = engine();
  // A church that already has an envelope for this Sunday, minted the ordinary way.
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const key0 = JSON.parse(ev.content).keys[CHURCH];
  assert.ok(key0, 'fixture: the envelope has no church slot, so there would be nothing to recover');

  const stream = h.openKeys();
  stream.deliver([ev]);                             // the event has ARRIVED…
  // …AND NOTHING HAS EOSE'd. This is the state an effect firing on mount lands in.
  assert.equal(h.settled(), false,
    'a console reported its session-key corpus as READ after one event and no end-of-stored-events. That is ' +
    'the answer that makes the issuer mint a fresh key over a live one');
  const early = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [...CLEARED, perm(BEN)], stewards: [SGLEAD], existing: stream.rows() });
  assert.equal(early.settled, false,
    'THE ISSUER RAN ON AN UNFINISHED READ. It would have re-minted svc-a with a FRESH key, orphaning the ' +
    'helper copy of every record already written into that session, with the register still painting: ' +
    JSON.stringify(early));
  assert.deepEqual(h.published, [],
    'and it reached the wire. Nothing about this failure is visible on any screen: the ring copy in `content` ' +
    'is untouched, so only the helper\'s copy dies');
  assert.equal(h.probe.published, 0, 're-anchor: the publish probe was never reachable in this harness');

  // NOW THE SAME CALL, AFTER EOSE. This is the positive control that stops the assertions above passing
  // vacuously: if the harness ran nothing, this half fails too.
  stream.eose();
  assert.equal(h.settled(), true, 'an AUTHENTICATED end-of-stored-events did not settle the corpus');
  const ok = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [...CLEARED, perm(BEN)], stewards: [SGLEAD], existing: stream.rows() });
  assert.equal(ok.settled, true, 'the issuer still refuses after a settled read');
  assert.equal(ok.issued.length, 1, 'adding a cleared person did not re-issue the envelope');
  assert.equal(ok.issued[0].reused, true,
    'THE RE-ISSUE MINTED A NEW SESSION KEY even though the envelope was in hand. This is the loss the gate ' +
    'exists to prevent, arriving through the other door');
  assert.deepEqual(ok.rotated, [], 'a re-issue that recovered the key was reported as a rotation');
  assert.equal(JSON.parse(h.published[0].content).keys[CHURCH], key0,
    'the church\'s own slot changed, so the key this console can recover next time is not the one already ' +
    'sealing records');
  assert.ok(h.probe.unwrapped > 0, 're-anchor: nothing ever unwrapped, so "it recovered the key" is vacuous');
});

test('AN UNAUTHENTICATED EOSE SETTLES NOTHING — nostr-tools counts a failed CONNECT as one', async () => {
  // THE HALF THAT LOOKS LIKE BELT-AND-BRACES AND IS NOT. A relay that never answers reaches oneose in
  // nostr-tools, and the relay answers an unauthenticated read of this church's documents with nothing at
  // all (its NIP-42 gate). So a plain EOSE can mean "this church has no envelopes" while it holds a year of
  // them — which is precisely the answer that rotates every key. subscribeCapKey has carried this rule since
  // the finance ring; this is the same rule on the same shape of state.
  const h = engine({ authed: false });
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const stream = h.openKeys();
  stream.deliver([ev]);
  stream.eose();
  assert.equal(h.probe.eose, 1, 're-anchor: this test never fired an end-of-stored-events at all');
  assert.equal(h.settled(), false,
    'an UNAUTHENTICATED end-of-stored-events was taken as "this church\'s envelopes have been read". Every ' +
    'session key in the church is one issuer run away from being replaced');
  const out = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [...CLEARED, perm(BEN)], stewards: [SGLEAD], existing: stream.rows() });
  assert.equal(out.settled, false, 'the issuer ran on an unauthenticated read');
  assert.deepEqual(h.published, [], 'and it reached the wire');
});

test('A CHURCH SWITCH UN-SETTLES IT — a stamp, not a boolean', async () => {
  // `_ckKeysSettled` holds WHICH church has been read, because a carried-across boolean answers "already
  // looked" for a church nobody has looked at. That is the same defect the *Checked flags were fixed for
  // twice (see _resetChurchScopedState), and here it re-mints instead of merely reading stale.
  const h = engine();
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const stream = h.openKeys();
  stream.deliver([ev]);
  stream.eose();
  assert.equal(h.settled(), true, 'fixture: this console was supposed to be settled before the switch');
  h.stubs.pub = OTHER;                              // the header toggle / a restore lands here
  assert.equal(h.settled(), false,
    'a console reported the church it just switched TO as read, on the strength of having read a different ' +
    'one. The first issuer run in the new church would re-mint every session it holds');
  const out = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: CLEARED, stewards: [SGLEAD], existing: [] });
  assert.equal(out.settled, false, 'the issuer issued for a church whose envelopes it had never read');
  assert.deepEqual(h.published, [], 'and it reached the wire');
});

test('A MID-STREAM SWITCH DOES NOT STAMP THE CHURCH WE LEFT', async () => {
  // The subscription captures the church it opened for, so an EOSE arriving after the toggle cannot mark the
  // previous church read — the same guard subscribeCapKey applies to _capState, and for the same reason.
  const h = engine();
  const stream = h.openKeys();
  h.stubs.pub = OTHER;
  stream.eose();
  assert.equal(h.stubs._ckKeysSettled, '',
    'an end-of-stored-events for the PREVIOUS church stamped a corpus as read. Switching back would then ' +
    'issue against whatever that stream had managed to deliver');
});

test('A STOOD-DOWN SUNDAY IS STILL NOT RE-STAFFED ONCE THE GATE IS IN — the two rules compose', async () => {
  // The gate must not have quietly re-opened the hole the stand-down fix closed on 2026-09-10. Both live in
  // issueCheckinSessionKeys and both key off `existing`, so this is the composition test rather than a
  // second copy of either.
  const h = engine();
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const tomb = { ...ev, created_at: AT - 60, tags: [['d', D.CHECKINHELPER + 'svc-a'], ['t', 'trinityone'],
    ['church', CHURCH], ['deleted', '1']], content: '' };
  const stream = h.openKeys();
  stream.deliver([ev, tomb]);
  stream.eose();
  assert.equal(h.settled(), true, 'fixture: the corpus was supposed to be settled here');
  const out = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: CLEARED, stewards: [SGLEAD], existing: stream.rows() });
  assert.ok(out.skipped.some(x => x.session === 'svc-a' && /stood down/.test(x.why)),
    'a Sunday the church stood down was re-staffed by the automatic issuer: ' + JSON.stringify(out));
  assert.deepEqual(h.published, [], 'and it published an envelope for it');
});

// ── 1b. THE AUDIT'S DEFECT: THE STAMP GOES STALE ACROSS AN IDENTITY CHANGE ────────────────────────────────
// Found by the independent audit, 2026-09-10, and it was mine. `_ckKeysSettled` was cleared in
// `_resetChurchScopedState()` — which has exactly ONE call site — while `setActiveIdentity` keeps its own
// PARALLEL per-church reset block that resets `_capState`, `_checkinMigrated`, `_localBlocked` and the
// no-photo list, and did not clear this. Switch identity away from your own church and back:
// `setActiveIdentity` fires `steward-identity`, `idv` bumps, makeSub's cache key (`method|idv|church`) has
// never been written, and the panel mounts holding `[]` while the stamp still names the church we are again
// on. The effect fires before one event has arrived and re-mints EVERY Sunday in the horizon with a fresh
// key — `issued: 1, rotated: [], banners: []`, silent by construction, because `rotating = !!(have &&
// !keyHex)` and `have` is undefined on that path.
//
// FIXED IN BOTH PLACES, so these are TWO tests rather than one. Belt-and-braces means neither half shows a
// failure while the other stands, so a single test over the identity path would go green with either one
// deleted — which is exactly the shape of test that let this through the first time.

test('THE DEFECT, HALF ONE: a NEW stream un-settles the read even when the stamp survives a reset', async () => {
  // THE GENERATION HALF, driven through the shipped subscription. The stamp is deliberately left standing —
  // this test simulates the reset block having forgotten it, which is precisely what had happened — and the
  // question is whether a console holding an EMPTY cache from a stream that has not finished can still mint.
  const h = engine();
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const key0 = JSON.parse(ev.content).keys[CHURCH];

  const first = h.openKeys();
  first.deliver([ev]);
  first.eose();
  assert.equal(h.settled(), true, 'fixture: this console was supposed to be settled before the switch');
  assert.equal(h.stubs._ckKeysSettled, CHURCH, 'fixture: the stamp was supposed to name this church');

  // THE IDENTITY SWITCH, minus the clear — the state the shipped code was actually in. `pub` is the same
  // church again, the stamp still names it, and makeSub has handed the freshly-mounted panel a new cache key
  // with no rows under it. The only thing that has changed is that a NEW subscription is in flight.
  first.stop();
  const second = h.openKeys();
  assert.equal(h.stubs._ckKeysSettled, CHURCH,
    'fixture: this test is only about the generation, so the stamp must still be standing');
  assert.equal(h.settled(), false,
    'A CONSOLE WITH A STALE STAMP AND AN EMPTY CACHE REPORTED ITS ENVELOPES AS READ. This is the audit\'s ' +
    'measured defect: the panel remounts after an identity change under a cache key never written, and the ' +
    'first issuer pass re-mints every Sunday in the horizon with a fresh key and raises no banner');
  const early = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: CLEARED, stewards: [SGLEAD], existing: [] });
  assert.equal(early.settled, false, 'the issuer minted against an empty cache on a stale stamp: ' + JSON.stringify(early));
  assert.deepEqual(h.published, [],
    'and it reached the wire. The measured cost was key 5a5a5a -> 5b5b5b with `rotated: []` and no banner: ' +
    'a live session key replaced and reported as a clean issue');

  // AND THE NEW STREAM'S OWN EOSE PUTS IT BACK — the positive control, so the assertions above cannot pass
  // by the flag simply being broken shut.
  second.deliver([ev]);
  second.eose();
  assert.equal(h.settled(), true, 'the new stream finished a trustworthy read and the console still refuses');
  const ok = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [...CLEARED, perm(BEN)], stewards: [SGLEAD], existing: second.rows() });
  assert.equal(ok.issued.length, 1, 'fixture: adding a cleared person was supposed to re-issue');
  assert.equal(JSON.parse(h.published[0].content).keys[CHURCH], key0,
    'and the re-issue rotated the key anyway, which is the loss this whole file is about');
});

test('THE DEFECT, HALF TWO: setActiveIdentity clears the stamp in its own reset block', () => {
  // THE BELT. `setActiveIdentity` is not renderable in a slice — it needs the whole console's world — so this
  // is asserted against vendor/steward.js, which is legitimate ONLY because that file is bundled: esbuild
  // removes dead code, so a `false && ` in front of the line would take its text with it. (Against
  // app/*.jsx the same assertion would prove nothing — CLAUDE.md rule 3.)
  //
  // SLICED TO THE ENCLOSING FUNCTION FIRST, because `_ckKeysSettled = ''` appears in
  // `_resetChurchScopedState` too and a whole-file match would be satisfied by the copy that was already
  // there — reporting the defect as fixed while the block that actually had it was untouched. That is the
  // mis-aimed-sabotage failure this repo has a name for, in assertion form.
  const block = fnBody(VENDOR, 'setActiveIdentity(targetPub) {', 'setActiveIdentity');
  assert.match(block, /_ckKeysSettled = ""/,
    'setActiveIdentity does not clear the session-key read stamp. It keeps its OWN per-church reset block, ' +
    'separate from _resetChurchScopedState, and a stamp carried across an identity switch says "this ' +
    'church\'s envelopes have been read" over a subscription cache that has never been written');
  // …and it is in the same block as the capability-key reset it belongs beside, not stranded elsewhere in
  // the function. `_capState` is reset there because carrying it across a switch corrupts the ring; this is
  // the same class of state and the same reason.
  assert.ok(block.indexOf('_ckKeysSettled = ""') > block.indexOf('_capState['),
    're-anchor: the stamp clear is no longer beside the per-church reset block it belongs to');
  // AND THE CONTROL: the assertion above can actually fail. If this slice ever stops containing the
  // capability reset, it is reading the wrong function and every claim here is vacuous.
  assert.match(block, /_checkinMigrated = ""/,
    're-anchor: this slice is not setActiveIdentity\'s reset block at all');
});

test('THE FALSE KEEPER WARNING IS GONE FROM THE SHIPPED BUNDLE', () => {
  // Text-matching is legitimate here and only here: vendor/*.js is bundled, so esbuild removes dead code and
  // a `false && ` in front of a condition takes its text with it. (Against app/*.jsx it proves nothing —
  // CLAUDE.md rule 3.)
  //
  // The sentence below shipped in a banner until 2026-09-10 and is a FALSE CLAIM under the owner's
  // double-locking decision: a safeguarding holder reads every record through the ring copy in `content`,
  // which no envelope touches, so being omitted from one costs her a duplicate of a body she can already
  // read — no access at all. It also prescribed re-issuing, which ROTATES keys.
  assert.doesNotMatch(VENDOR, /should be able to read what a helper writes, and cannot/,
    'the keeper warning is back in the bundle, telling a safeguarding steward she has lost access she still ' +
    'has and offering a remedy that rotates session keys (CLAUDE.md rule 4, applied to shipped copy)');
  assert.doesNotMatch(VENDOR, /_checkinKeepersMissing/,
    'the check that fed the false warning is back and has no caller — dead code under a banner nobody raises');
  // …and the re-aimed one IS there, so this test cannot pass by the whole feature having been deleted.
  assert.match(VENDOR, /_warnCheckinKeyRotated/, 're-anchor: the replacement warning is not in the bundle');
});

test('THE BANNER NAMES ONLY CAUSES THAT CAN ACTUALLY HAPPEN', () => {
  // The audit's second truthfulness finding. The first wording said a rotation "happens when the envelope was
  // issued from a different device or this church's key was restored from a backup". NEITHER CAN DO IT: only
  // the owner console mints, always with the church key, and the unwrap is a self-to-self conversation key
  // derived from that key alone — another device holding the same key unwraps it, and a restored key IS the
  // same key. As written, a steward went hunting for a second console that does not exist.
  //
  // Asserted against the bundle, where a string literal that has been edited away is genuinely gone.
  assert.doesNotMatch(VENDOR, /issued from a different device/,
    'the rotation banner blames a second device again. That cannot cause it (the unwrap is nip44ck(sk, cp), ' +
    'deterministic from the church key), so it sends a steward looking for a console that does not exist');
  assert.doesNotMatch(VENDOR, /key was restored from a backup\. The register/,
    'the rotation banner blames a restored backup again. A restored church key is the SAME key, so it ' +
    'derives the same conversation key and unwraps the slot perfectly');
  // …and it does name the one thing that IS reachable: the copy on the relay is damaged. `c.keys` is taken
  // straight out of the JSON with no validation, so a truncated slot or an envelope with no church slot at
  // all is exactly what reaches this.
  assert.match(VENDOR, /was damaged, so this console could not reuse it/,
    'the rotation banner no longer says WHY, or says something that cannot happen');
});

test('THE FALSE NIP-42 MECHANISM IS GONE FROM BOTH COPIES — and the one that SHIPS is the one that was wrong', () => {
  // The audit's first truthfulness finding, and then its follow-up: the sentence existed TWICE and the first
  // correction fixed the copy that does not ship.
  //
  // The claim was that an unauthenticated read of a church's documents "is answered with nothing at all (the
  // relay's NIP-42 gate)". Measured on a raw socket against the real relay:
  // `unauthed -> events: 0  eose: false  challenged: true  closed: null`. THE RELAY DOES NOT ANSWER AT ALL —
  // it issues an AUTH challenge and waits. The two things that really produce a premature
  // end-of-stored-events are nostr-tools' own `setTimeout(this.receivedEose, this.eoseTimeout)` (measured
  // firing at 2519 ms against a real pool) and `handleClose()` calling `handleEose()` first.
  //
  // ⚠ WHY THIS IS TWO SLICES AND A WHOLE-FILE SWEEP, not one match. The first version of this test sliced
  // only the note above `_ckKeysSettled` — and the second copy, inside subscribeCheckinSessionKeys' `oneose`
  // comment, was outside that range and stayed wrong. Worse, it is the copy a reader of the shipped console
  // sees: esbuild drops comments attached to top-level `let` declarations and keeps comments inside function
  // bodies, so the corrected note is absent from vendor/steward.js and the false one was present. Measured
  // both ways below.
  //
  // AND WHY IT MATCHES SOURCE TEXT AT ALL, which is not CLAUDE.md rule 3's territory: rule 3 forbids
  // asserting BEHAVIOUR by matching text, because `false && ` leaves every word in place. This asserts
  // nothing about behaviour — it is a claim about a COMMENT, the record left for whoever later asks whether
  // this guard can be simplified, and a comment has no other instrument.
  const SRC = readFileSync(join(ROOT, 'src/steward.src.js'), 'utf8');
  // THE CLAIM IN ITS ASSERTIVE FORM ONLY. Both corrected comments QUOTE the false sentence in order to refute
  // it, and a pattern that could not tell a quotation from an assertion would forbid the correction itself —
  // a test that makes the honest version impossible to write. So the quote character is what separates them:
  // `documents "is answered` is the refutation, `documents is answered` was the claim.
  const CLAIM = /the relay answers an unauthenticated\s*(?:\n\s*\/\/)?\s*read of this church with nothing|documents\s*(?:\n\s*\/\/)?\s*is answered\s*(?:\n\s*\/\/)?\s*with nothing at all|read of this church\s*(?:\n\s*\/\/)?\s*with nothing/;
  const REFUTED = /IT DOES NOT ANSWER AT ALL|RELAY SENDS NO EOSE AT ALL/;

  // ── copy 1: the note above the stamp (dropped by the bundler, so source-only) ──
  const note = SRC.slice(SRC.indexOf('HAS THE ENVELOPE CORPUS ACTUALLY BEEN READ?'), SRC.indexOf('const _ckKeysRead ='));
  assert.ok(note.length > 500, 're-anchor: this slice is not the stamp\'s own note');
  assert.doesNotMatch(note, CLAIM,
    'the stamp\'s note is back to ASSERTING that the relay answers an unauthenticated read with nothing. ' +
    '(Quoting the sentence in order to refute it is fine and is what the note does — see CLAIM.)');
  assert.match(note, REFUTED, 'the stamp\'s note no longer says what the relay actually does');
  assert.match(note, /eoseTimeout/, 'the stamp\'s note does not name where the premature EOSE really comes from');

  // ── copy 2: the oneose comment INSIDE the subscription — THE ONE THAT SHIPS ──
  // Sliced to the function first: subscribeCheckinPermissions sits immediately above with a near-identical
  // oneose, so an unsliced match would read the neighbour's and report either way.
  const sub = fnBody(SRC, '  subscribeCheckinSessionKeys(cb) {', 'subscribeCheckinSessionKeys');
  const inFn = sub.slice(sub.indexOf('AND ONLY NOW IS THE CORPUS'), sub.indexOf('oneose() {'));
  assert.ok(inFn.length > 500, 're-anchor: this slice is not the oneose comment inside the subscription');
  assert.doesNotMatch(inFn, /an EOSE, the relay answers an unauthenticated/,
    'THE SHIPPED COMMENT IS BACK TO PRESENTING THE RELAY\'S SILENCE AS ONE OF THE TWO WAYS AN EOSE ARRIVES. ' +
    'It is not one of them — measured `eose: false` — and this is the copy that survives into ' +
    'vendor/steward.js, so it is the account a reader of the shipped console gets');
  assert.match(inFn, /IT DOES NOT ANSWER AT ALL/,
    'the shipped comment no longer refutes the false mechanism. It is written out in full here rather than ' +
    'cross-referenced precisely because the corrected top-level note is dropped by the bundler');
  assert.match(inFn, /eoseTimeout/,
    'the shipped comment does not name the client-side timer, which is the source that actually fires');

  // ── AND NO THIRD COPY, ANYWHERE. This is the assertion that generalises: the sentence existed twice and
  // one correction missed one, so what is forbidden is the claim appearing WITHOUT its refutation beside it,
  // wherever in the file that happens. A new copy in a new place reddens this without anyone remembering to
  // extend a slice.
  let from = 0, unrefuted = [];
  for (;;) {
    const m = CLAIM.exec(SRC.slice(from));
    if (!m) break;
    const at = from + m.index;
    const around = SRC.slice(Math.max(0, at - 1200), at + 1200);
    if (!REFUTED.test(around)) unrefuted.push(SRC.slice(at, at + 90).split('\n')[0]);
    from = at + m[0].length;
  }
  assert.deepEqual(unrefuted, [],
    'the false NIP-42 mechanism is stated somewhere in src/steward.src.js with nothing nearby refuting it. ' +
    'That sentence has now been wrong in two places at once, and a future reader deciding whether this guard ' +
    'can be simplified would be reasoning from a mechanism that does not exist: ' + JSON.stringify(unrefuted));

  // ── and the BUNDLE carries the correct account, since that is the copy anybody actually reads.
  assert.match(VENDOR, /IT DOES NOT ANSWER AT ALL/,
    're-anchor: the corrected account is not in vendor/steward.js at all. Comments inside function bodies ' +
    'survive esbuild — if this fails, either the comment moved out of the function or the build is stale');
  assert.doesNotMatch(VENDOR, /an EOSE, the relay answers an unauthenticated/,
    'the SHIPPED bundle states the false mechanism');
});

// ── 2. THE POINT OF USE — the screen a steward actually has ───────────────────────────────────────────────
// CLAUDE.md rule 1: at least one test must fail if the feature is deleted FROM THE SCREEN. Every assertion
// below drives the shipped component; none of them reads app/*.jsx as text.

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
function shown(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => shown(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => shown(c, pred, out));
  return out;
}
const btn = (tree, label) => shown(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));
// `said()` JOINS WITH A SPACE, and that is right for "does this screen mention X anywhere" — the phrase may
// legitimately span a <b> or a sibling node. It is WRONG for any claim about exact wording, and the device
// run of 2026-09-10 is why this note exists: the panel shipped reading "whenever you openthis page" on the
// phone, because JSX strips whitespace containing a newline between a text node and an element — and the
// assertion pinning that sentence PASSED, because said() had put the missing space back in. A test that
// certifies copy it cannot see is worse than no test (CLAUDE.md rule 4).
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');
// ── THE TEXT AS A BROWSER WOULD LAY IT OUT ────────────────────────────────────────────────────────────────
// flow() / reads() / glued() were written here on 2026-09-10 and LIFTED into scripts/render-jsx-screen.mjs on
// the same day, when the check-in page's own layout test needed the same instrument
// (scripts/the-check-in-page-fits-the-phone.test.mjs). One copy, because two would drift and the whole point
// of these three is that they are faithful. The reasoning — why a space-join cannot see the JSX newline trap,
// why a component counts as a block, why glued() is quiet on correct markup — moved with them; the two
// self-checks at the end of the COPY test below still prove the imported instrument can see the junction it
// exists to find, and does not report correct markup as broken.

async function screen({ settled = true, held = true, name = 'St Mary\'s', keys = [], perms = CLEARED,
                        today = SERVICE.date,
                        services = [svc('svc-a', SERVICE), svc('svc-b', SERVICE_2)], stewards = [SGLEAD],
                        result = { issued: [{ session: 'svc-a' }], skipped: [], failed: [], rotated: [], settled: true } } = {}) {
  const src = fnBody(APP, 'function CheckinSessionKeys() {', 'CheckinSessionKeys');
  const tmp = join(tmpdir(), 'cksk-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { CheckinSessionKeys };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const calls = [];
  const banners = [];
  const globals = {
    React,
    Panel: function Panel(p) { return React.createElement('div', { 'data-panel': p.title }, p.action, p.children); },
    DismissibleNote: function DismissibleNote(p) { return React.createElement('div', { 'data-note': p.id }, p.children); },
    Icon: Stub('Icon'),
    todayISO: () => today,                 // default: the first of the two services, so both are in horizon
    window: {
      // ⚠ READ THROUGH A GETTER, NOT CAPTURED. `keys` and `perms` arrive from subscriptions, so on a real
      // console they change UNDER AN OPEN PAGE — which is the entire subject of the S1/S2 trigger tests
      // below. A harness that closed over the initial value could only ever test a fresh mount, and a fresh
      // mount is exactly the case the shipped defect did not break.
      useStewardCheckinSessionKeys: () => keys,
      useStewardCheckinPermissions: () => perms,
      useStewardServices: () => services,
      useStewardStewards: () => stewards,
      useStewardChurch: () => ({ name }),
      useStewardIdv: () => 1,
      useStewardConn: () => 1,
      Steward: {
        // THE TWO READERS THE SCREEN'S GATE IS BUILT ON, both one-line readers of module state in the real
        // console. Stubbed here because this half is about WHETHER THE SCREEN ASKS — the engine half above
        // drives the flag itself, through the shipped subscription's own oneose.
        checkinSessionKeysSettled: () => settled,
        checkinIssuerHeld: () => held,
        stewardCaps: () => ({ [SGLEAD]: ['safeguarding'] }),
        issueCheckinSessionKeys: (o) => { calls.push(o); return Promise.resolve(result); },
      },
      dispatchEvent: (e) => { banners.push((e && e.detail) || {}); return true; },
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    setTimeout, clearTimeout, console, Math, Date, JSON, Set, Number, String, Array, Promise, Object,
  };
  const key = '__cksk_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { CheckinSessionKeys } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  let tree = draw(CheckinSessionKeys, {});
  return {
    calls, banners,
    tree: () => tree,
    said: () => said(tree),
    reads: () => reads(tree),        // as a browser concatenates it — see flow()
    glued: () => glued(tree),        // every place two pieces of copy run together
    // A CLEARANCE GRANTED OR WITHDRAWN WHILE THIS PAGE IS OPEN, and an envelope arriving back from the
    // relay. Both are subscription deliveries and both must be followed by a redraw, exactly as a real
    // re-render is: `perms = …` alone changes nothing until React draws again.
    setPerms(next) { perms = next; return this.redraw(); },
    setKeys(next) { keys = next; return this.redraw(); },
    redraw() { tree = draw(CheckinSessionKeys, {}); return tree; },
    press(label) {
      const bs = btn(tree, label);
      assert.ok(bs.length, 'no button labelled ' + JSON.stringify(label) + ' on this screen — re-anchor');
      bs[0].props.onClick();
      return bs.length;
    },
  };
}

test('POINT OF USE: opening the Check-in page ISSUES — this is the wiring the feature is', async () => {
  const s = await screen();
  // Awaiting a turn, because the effect's call is a promise the component does not block on.
  await Promise.resolve();
  assert.equal(s.calls.length, 1,
    'THE CONSOLE OPENED AND NO SESSION KEY WAS ISSUED. That is the state this whole change exists to end: ' +
    'a steward clears somebody for children\'s work and nothing ever mints them a key, on any Sunday');
  const o = s.calls[0];
  assert.deepEqual(o.services.map(x => x.id), ['svc-a', 'svc-b'],
    'the effect did not hand the issuer the sessions inside its horizon');
  assert.equal(o.permissions, s.tree() && o.permissions, 're-anchor');
  assert.ok(Array.isArray(o.permissions) && o.permissions.length === 1, 'the clearances were not passed at all');
  assert.deepEqual(o.stewards, [SGLEAD],
    'the steward roster was not passed, so no safeguarding lead is wrapped into any envelope. It is passed ' +
    'RAW (flat hex pubkeys, subscribeStewards\' own shape) because the mint decides who is eligible with ' +
    '_capAllows against CAP_KEYS.checkin — a screen filtering it would be a second copy of that rule');
  assert.ok(o.caps && typeof o.caps === 'object', 'the capability map was not passed, so no steward is a keeper');
  // AND THE COPY MUST NOT PROMISE MORE THAN THE TRIGGER DELIVERS. This component mounts only on the Check-in
  // tab, so "whenever this console is opened" would be a false claim: a church whose owner opens the console
  // weekly and never opens Check-in gets no keys. CLAUDE.md rule 4, applied to copy — the same failure the
  // deleted keeper warning was.
  // ⚠ reads(), NOT said(). This exact assertion existed against said() and PASSED while the phone rendered
  // "whenever you openthis page" — said() joins text nodes with a space and put the missing one back. Found
  // on the Oppo, 2026-09-10, not by any test. reads() concatenates the way a browser does, so the claim and
  // the thing a steward sees are now the same string.
  assert.match(s.reads(), /whenever you open this page/,
    'the panel does not say WHEN it issues, says something wider than it does, or says it in words that do ' +
    'not render — the JSX newline trap. As rendered: ' + s.reads());
});

test('POINT OF USE: IT PASSES THE ENVELOPES IT HOLDS AS `existing` — the other half of the race', async () => {
  // The gate stops the issuer running on an unfinished read. It cannot stop a caller that has finished
  // reading and then passes nothing: `existing: []` on a settled console is a rotation the engine has no way
  // to refuse, because it is indistinguishable from a church that genuinely holds no envelopes.
  const env = { session: 'svc-a', source: GRANT_SOURCE, lifetime: 'session', from: AT, until: AT + 7200,
    pubs: [ADA], keys: { [CHURCH]: 'x', [ADA]: 'y' }, ts: AT - 3600 };
  const s = await screen({ keys: [env] });
  await Promise.resolve();
  assert.equal(s.calls.length, 1, 'fixture: the effect was supposed to run once');
  assert.deepEqual(s.calls[0].existing, [env],
    'THE SCREEN ISSUED WITHOUT HANDING THE ISSUER THE ENVELOPES IT ALREADY HOLDS. Every session in the ' +
    'horizon is then re-minted with a FRESH key, which is the exact loss the EOSE gate exists to prevent — ' +
    'arriving through a screen that satisfied the gate and then withheld the answer');
});

test('POINT OF USE: IT DOES NOT ISSUE BEFORE THE ENVELOPES HAVE BEEN READ', async () => {
  const s = await screen({ settled: false });
  await Promise.resolve();
  assert.deepEqual(s.calls, [],
    'THE SCREEN ISSUED ON AN UNFINISHED READ. The engine refuses this too, so nothing is lost today — but a ' +
    'screen that fires early is a screen that will rotate every key the day that refusal is relaxed, and it ' +
    'tells the steward "issued" while the engine says "waiting"');
  assert.match(s.said(), /Still reading this church/,
    'and it does not say which of the two states it is in. "No key yet" and "the keys have not arrived" are ' +
    'different facts and one of them is a steward going looking for a fault that does not exist');
  // AND THE MANUAL CONTROL IS NOT LIVE EITHER, or the gate is one tap from being irrelevant.
  const b = btn(s.tree(), 'Re-issue');
  assert.ok(b.length, 're-anchor: there is no Re-issue control on this screen');
  assert.equal(b[0].props.disabled, true,
    'the manual Re-issue button was live while the corpus was still arriving — one tap re-mints every ' +
    'session in the horizon with a fresh key');
});

test('POINT OF USE: THE IDENTITY-CHANGE PATH — the screen asks the ENGINE, not whether it has rows', async () => {
  // THE SCREEN HALF OF THE AUDIT'S DEFECT. After an identity switch the panel remounts under a makeSub cache
  // key (`method|idv|church`) that has never been written, so `keys` is `[]` from makeInit() — and the
  // tempting gates are all wrong in the same direction:
  //
  //   · `keys.length` — false for a church that genuinely has no envelopes yet, so it would refuse a first
  //     issue for ever AND, worse, be true the instant one stale row arrives;
  //   · `stewardStreamLoaded('subscribeCheckinSessionKeys')` — flips on the FIRST delivery, and this
  //     subscription emits per event as well as on EOSE, so one envelope out of a year's worth satisfies it.
  //
  // So the gate must be the engine's own answer and nothing else. Both halves are driven here: rows present
  // while the engine says not-read (the stale-cache shape inverted), and no rows while it says read (a real
  // first issue, which must go ahead).
  const env = { session: 'svc-a', source: GRANT_SOURCE, lifetime: 'session', from: AT, until: AT + 7200,
    pubs: [ADA], keys: { [CHURCH]: 'x', [ADA]: 'y' }, ts: AT - 3600 };

  const holdingRows = await screen({ settled: false, keys: [env] });
  await Promise.resolve();
  assert.deepEqual(holdingRows.calls, [],
    'THE SCREEN ISSUED BECAUSE IT HAD A ROW, while the engine said this church\'s envelopes had not been ' +
    'read. That is the gate being `keys.length` or stewardStreamLoaded() rather than the engine\'s answer, ' +
    'and it is one stale row away from re-minting every Sunday in the horizon');
  assert.match(holdingRows.said(), /Still reading this church/,
    'and it painted those rows as the finished picture, so a steward reading "1 helper holds this key" has ' +
    'no way to know the list is a fragment: ' + holdingRows.said());

  // …AND THE OTHER WAY ROUND: no rows at all, engine says read. This is a church's FIRST EVER issue and it
  // must go ahead — "an empty list means not ready" was the other candidate fix for the audit's defect and
  // this is the test that rules it out. Design §10 and reference/DOMAIN.md: nothing here may block.
  const firstEver = await screen({ settled: true, keys: [] });
  await Promise.resolve();
  assert.equal(firstEver.calls.length, 1,
    'A CHURCH WITH NO ENVELOPES YET WAS NEVER ISSUED ANY. If the gate has become "we must be holding rows", ' +
    'every new church is refused its first session keys for ever and the desk is the only fallback');
  assert.deepEqual(firstEver.calls[0].existing, [],
    're-anchor: the first-issue call did not pass the empty list it actually holds');
});

// ── 2a. THE TRIGGER — A CLEARANCE THE CONSOLE HAS NOT NOTICED IS A SUNDAY WITH NO KEY ─────────────────────
//
// S1 and S2 of the churchwarden sim round, reference/SCOPE-CHECKIN-SEALING-2026-09-10.md, both of them the
// SAME defect in the effect's dependency array. It depended on `clearedNow.join(',')` — the people whose
// clearance is live at THIS MOMENT — while the issuer judges every session at its OWN start
// (`permittedHelpers(perms, win.from)`). So:
//
//   • GRANTING a clearance for next Sunday changed nobody's live status, no element of the dependency array
//     moved, the effect never ran, and that Sunday got no key at all. This is the most likely thing a
//     churchwarden ever does with this screen.
//   • WITHDRAWING one failed identically in the other direction: the clearance list correctly went to
//     "Nobody is cleared yet" while this panel went on reporting "1 helper holds this session's key" for
//     30+ seconds and through re-polling. Both pieces of shipped copy that promise otherwise — "withdrawing
//     one ends their access to every session at once" and "whenever a clearance changes" — were false.
//
// THE ISSUER WAS NEVER WRONG. Nothing below changes it, and the gate tests in section 1 still hold: these
// drive the SCREEN, which is where the trigger lives, because an issuer nothing calls at the right moment is
// CLAUDE.md rule 1's "well-tested engine nobody is required to consult".
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const TODAY_ISO = iso(Date.now());
const SUNDAY_ISO = iso(Date.now() + 3 * 86400000);     // three days out: future, and well inside the horizon
const SOON_SVC = [svc('svc-a', { date: SUNDAY_ISO, time: '10:30' })];
// A CLEARANCE FOR ONE NAMED DAY, through the SHIPPED window maths and the SHIPPED builder and parser, so the
// five fields the trigger keys on are the five a relay would actually store. A hand-typed object here would
// let the trigger pass over a shape no console can produce.
const permDay = (who, dateISO) => {
  const w = permissionWindow('day', { date: dateISO });
  assert.ok(w, 'fixture: the shipped window maths would not place ' + dateISO);
  return readCheckinPermission(JSON.stringify(buildCheckinPermission({ person: who, source: 'steward',
    lifetime: 'day', from: w.from, until: w.until })));
};
// An envelope row as subscribeCheckinSessionKeys delivers one, for the session in `SOON_SVC`.
const envFor = (pubs) => [{ session: 'svc-a', source: GRANT_SOURCE, lifetime: 'session', from: AT,
  until: AT + 7200, pubs, keys: Object.fromEntries([[CHURCH, 'x'], ...pubs.map(p => [p, 'y'])]), ts: AT - 3600 }];

test('S1: CLEARING SOMEBODY FOR NEXT SUNDAY RE-ISSUES — the trigger that ignored every future date', async () => {
  const s = await screen({ perms: [], today: TODAY_ISO, services: SOON_SVC });
  await Promise.resolve();
  assert.equal(s.calls.length, 1, 'fixture: the mount pass did not run, so nothing below is about anything');

  // THE WARDEN CLEARS MAUREEN FOR SUNDAY. The page stays open — this is a subscription delivery, not a visit.
  s.setPerms([permDay(BEN, SUNDAY_ISO)]);
  await Promise.resolve();
  assert.equal(s.calls.length, 2,
    'A CLEARANCE FOR A FUTURE SUNDAY CHANGED NOTHING THIS EFFECT WATCHES, so no envelope was re-issued and ' +
    'that Sunday has no helper key at all. Only reopening the page or pressing Re-issue would recover it — ' +
    'and a warden has no reason to do either, because the clearance list says the clearance is there. This ' +
    'is S1 of the 2026-09-10 sim round, reproduced four times on the real screen');
  assert.deepEqual(s.calls[1].permissions.map(p => p.person), [BEN],
    'the re-issue ran but did not hand the issuer the new clearance');
  // …AND THE ISSUER IS STILL ASKED THE WHOLE LIST, never a pre-filtered one: it applies permittedHelpers()
  // at each session's own start, which is the half that was already right and must stay right.
  assert.ok(s.calls[1].permissions.every(p => p && p.person && p.lifetime),
    'the permissions were flattened or filtered on the way out, so the issuer can no longer judge them at ' +
    'each session\'s own start');
});

test('S1, the regression half: clearing somebody for TODAY still re-issues', async () => {
  // The one case that worked before this fix ("Clearing for today renders correctly", scope note) — pinned,
  // because the dependency it depended on is the one being replaced.
  const s = await screen({ perms: [], today: TODAY_ISO, services: SOON_SVC });
  await Promise.resolve();
  assert.equal(s.calls.length, 1, 'fixture: no mount pass');
  s.setPerms([permDay(BEN, TODAY_ISO)]);
  await Promise.resolve();
  assert.equal(s.calls.length, 2,
    'clearing somebody for TODAY no longer re-issues. The narrow trigger this fix replaced got this case ' +
    'right; a replacement that gets it wrong has traded one broken case for another');
});

test('S2: WITHDRAWING A CLEARANCE RE-ISSUES, AND THE PANEL STOPS NAMING HER — without a page revisit', async () => {
  const s = await screen({ perms: [permDay(ADA, SUNDAY_ISO)], keys: envFor([ADA]),
    today: TODAY_ISO, services: SOON_SVC });
  await Promise.resolve();
  assert.equal(s.calls.length, 1, 'fixture: no mount pass');
  assert.match(s.reads(), /1 helper holds this session’s key/,
    'fixture: the panel does not report the helper this test is about withdrawing: ' + s.reads());

  // THE WITHDRAWAL LANDS. subscribeCheckinPermissions drops the tombstoned clearance, which is exactly what
  // makes the list next door read "Nobody is cleared yet" — the state the sim photographed beside a panel
  // still claiming a helper held the key.
  s.setPerms([]);
  await Promise.resolve();
  assert.equal(s.calls.length, 2,
    'WITHDRAWING A FUTURE-DATED CLEARANCE RE-ISSUED NOTHING. The panel then contradicts both the clearance ' +
    'list beside it and its own copy ("whenever a clearance changes"), indefinitely — measured at 30+ ' +
    'seconds and through re-polling on the real screen. And it is not only a label: the envelope on the ' +
    'relay still wraps her, because revokeCheckinPermission writes a tombstone at checkinperm:<person> and ' +
    'nothing else rewrites checkinhelper:<session> — see the engine test at the end of this file');
  assert.deepEqual(s.calls[1].permissions, [],
    'the re-issue ran with the withdrawn clearance still in the list it handed the issuer');

  // AND THE RE-ISSUED ENVELOPE COMING BACK IS WHAT CHANGES THE WORDS. The panel reports the envelope it
  // holds and nothing else — that is why it could be stale — so the honest end of this story is the new
  // envelope arriving with nobody wrapped in it.
  s.setKeys(envFor([]));
  assert.doesNotMatch(s.reads(), /1 helper holds/,
    'the panel still names a helper after the envelope that named her was replaced: ' + s.reads());
  assert.match(s.reads(), /Key issued — nobody cleared for it yet/,
    'and it does not say what the session\'s state actually is now: ' + s.reads());
});

test('THIS EFFECT PUBLISHES, so an UNCHANGED clearance list must not fire it again', async () => {
  // The other way to get this wrong, and the worse one: a dependency whose IDENTITY changes every draw makes
  // this effect mint continuously. The corpus key is a sorted string for exactly this reason, so an equal
  // list delivered as a brand-new array — which is what every subscription emit hands over — is equal.
  const s = await screen({ perms: [permDay(ADA, SUNDAY_ISO)], today: TODAY_ISO, services: SOON_SVC });
  await Promise.resolve();
  assert.equal(s.calls.length, 1, 'fixture: no mount pass');
  s.redraw(); s.redraw();
  s.setPerms([permDay(ADA, SUNDAY_ISO)]);        // a NEW array, a NEW object, the same five fields
  s.setPerms([permDay(ADA, SUNDAY_ISO)]);
  await Promise.resolve();
  assert.equal(s.calls.length, 1,
    'THE EFFECT FIRED AGAIN WITH NOTHING CHANGED. This effect publishes: a dependency that is an identity ' +
    'rather than a value mints an envelope on every draw, and the issuer\'s idempotence only bounds the ' +
    'damage, it does not stop the traffic');
});

test('THE EOSE GATE IS UNTOUCHED BY THE WIDER TRIGGER — a clearance change still does not fire early', async () => {
  // The gate two audits went into, re-proved against the NEW trigger rather than assumed to have survived
  // it. A wider dependency array is exactly the change that could make an effect fire before the corpus has
  // been read — and firing early re-mints every session in the horizon with a fresh key.
  const s = await screen({ settled: false, perms: [], today: TODAY_ISO, services: SOON_SVC });
  await Promise.resolve();
  assert.deepEqual(s.calls, [], 'fixture: it issued on mount with an unfinished read');
  s.setPerms([permDay(BEN, SUNDAY_ISO)]);
  s.setPerms([]);
  await Promise.resolve();
  assert.deepEqual(s.calls, [],
    'A CLEARANCE CHANGE FIRED THE ISSUER BEFORE THIS CHURCH\'S ENVELOPES HAD BEEN READ. That re-mints every ' +
    'session in the horizon with a FRESH key and orphans the helper copy of every record already sealed ' +
    'under the old one, with the register still painting normally');
});

test('S3: THE SUMMARY LINE CANNOT CONTRADICT THE ROWS ABOVE IT', async () => {
  // The sim photographed "Issued keys for 1 session(s) · 0 person(s) cleared right now" directly beneath a
  // row reading "1 helper holds this session's key". Both were true: "right now" meant today and the
  // clearance was for Sunday. So the count is over the sessions in view, computed from the same envelopes
  // the rows are — which makes agreement structural rather than careful.
  const s = await screen({ perms: [permDay(ADA, SUNDAY_ISO)], keys: envFor([ADA]),
    today: TODAY_ISO, services: SOON_SVC });
  // TWO TURNS AND A REDRAW: `setLast` is written inside the effect's own async run, and this miniReact does
  // not re-render on a setState — the same shape the rotated-copy test below uses.
  await Promise.resolve();
  await Promise.resolve();
  const t = (s.redraw(), s.reads());
  assert.match(t, /1 helper holds this session’s key/, 'fixture: the row this line must agree with is missing: ' + t);
  assert.doesNotMatch(t, /0 person/,
    'THE LINE UNDER THE LIST SAID NOBODY WAS CLEARED WHILE THE ROW ABOVE IT NAMED A HOLDER. Two true ' +
    'sentences that read as a contradiction is a warden deciding the screen is broken: ' + t);
  assert.match(t, /Issued a key for 1 session · 1 person holds one\./,
    'the summary does not report what this pass did and who holds a key for the sessions listed, in words ' +
    'that agree with the rows: ' + t);
  assert.doesNotMatch(t, /right now/,
    '"right now" is back. It is a different question from the one the rows answer, and asking it here is ' +
    'the whole of S3: ' + t);
  assert.deepEqual(s.glued(), [], 'two pieces of this panel run together with no separator a reader can see');

  // …AND THE EMPTY CASE IS A SENTENCE, not "0 people hold one".
  const none = await screen({ perms: [], keys: envFor([]), today: TODAY_ISO, services: SOON_SVC });
  await Promise.resolve();
  await Promise.resolve();
  none.redraw();
  assert.match(none.reads(), /Issued a key for 1 session · nobody holds one yet\./,
    'a Sunday nobody is cleared for is reported as a count rather than as the ordinary state it is: ' + none.reads());
});

// ── 2b. THE COPY AS A PHONE ACTUALLY RENDERS IT ───────────────────────────────────────────────────────────
// Both defects below were found on the Oppo on 2026-09-10 and by nothing in this suite. They are the same
// lesson twice: every assertion about this panel's wording ran through said(), which normalises exactly the
// two things that were wrong.

test('COPY: no two pieces of this panel run together — the JSX newline trap, closed for the whole panel', async () => {
  // WHAT HAPPENED. `… for the next <b>{HORIZON_DAYS} days</b> whenever you open` / newline / `<b>this page</b>`
  // renders as "whenever you openthis page": JSX strips whitespace that contains a newline between a text
  // node and an element. Read off the device.
  //
  // WHY A SPOT FIX WOULD NOT HAVE BEEN ENOUGH. Every other line in this panel is one reflow away from the
  // same defect and none of them carries an exact-wording assertion, so this checks the JUNCTIONS rather
  // than the sentences: every place one inline piece of copy ends on a word character and the next begins on
  // one. See glued() for why that is quiet on correct copy.
  //
  // Driven in all four states the panel has, because the notes are mutually exclusive branches and three of
  // them are invisible to a test that only renders the happy path.
  const states = [
    ['owner, settled, sessions in range', {}],
    ['delegated console', { held: false }],
    ['church with no published name', { name: '' }],
    ['no sessions in the horizon', { services: [] }],
  ];
  for (const [what, opts] of states) {
    const s = await screen(opts);
    await Promise.resolve();
    assert.deepEqual(s.glued(), [],
      'two pieces of copy run together with no space on the ' + what + ' state, so the phone shows them as ' +
      'one word. JSX drops whitespace containing a newline between text and an element — put an explicit ' +
      "{' '} at the end of the line, or keep the space inside the text node: " + JSON.stringify(s.glued()));
  }
  // AND THE CONTROL, so this cannot pass by glued() being blind. The junction it is built to find, built here
  // by hand out of the same node shape the compiled JSX produces.
  const bad = { type: 'div', props: {}, kids: ['whenever you open', { type: 'b', props: {}, kids: ['this page'] }] };
  assert.equal(glued(bad).length, 1, 're-anchor: glued() cannot see the very junction it exists to find');
  const good = { type: 'div', props: {}, kids: ['whenever you open ', { type: 'b', props: {}, kids: ['this page'] }] };
  assert.deepEqual(glued(good), [], 're-anchor: glued() reports correct copy as broken, so it will be ignored');
  // AND A BLOCK NEIGHBOUR IS NOT A JUNCTION. The first version of this check treated every element as inline
  // and reported four of these — a <button> beside a note, a service's name div beside its status div — all
  // of which are separate boxes on screen. A check that cries wolf costs exactly what a missing one does.
  const blocks = { type: 'div', props: {}, kids: [{ type: 'div', props: {}, kids: ['Re-issue'] },
                                                  { type: 'div', props: {}, kids: ['Each session gets'] }] };
  assert.deepEqual(glued(blocks), [],
    're-anchor: glued() counts two block elements as running together, so it will report correct layout as ' +
    'broken and be switched off');
});

test('COPY: one helper HOLDS the key, two helpers HOLD it', async () => {
  // Read off the device with exactly one cleared helper: "1 helper hold this session's key". The noun was
  // pluralised and the verb was not. said() could not see it either — it is a whole word, not spacing — but
  // nothing asserted this string at all, which is the more honest description of why it shipped.
  const env = (n) => [{ session: 'svc-a', source: GRANT_SOURCE, lifetime: 'session', from: AT, until: AT + 7200,
    pubs: Array.from({ length: n }, (_, i) => String(i).repeat(64).slice(0, 64)),
    keys: { [CHURCH]: 'x' }, ts: AT - 3600 }];

  const one = await screen({ keys: env(1) });
  await Promise.resolve();
  assert.match(one.reads(), /1 helper holds this session/,
    'with ONE cleared helper the panel does not agree with itself. It read "1 helper hold this session\'s ' +
    'key" on the phone: ' + one.reads());
  assert.doesNotMatch(one.reads(), /1 helpers/, 'and it pluralised the noun at one: ' + one.reads());

  const two = await screen({ keys: env(2) });
  await Promise.resolve();
  assert.match(two.reads(), /2 helpers hold this session/,
    'with TWO cleared helpers the panel does not agree with itself either — fixing the singular must not ' +
    'break the plural, which is how this class of defect usually gets half-fixed: ' + two.reads());

  // AND NONE AT ALL is its own sentence rather than "0 helpers hold", which reads as a fault when it is the
  // ordinary state of a session nobody has been cleared for yet.
  const none = await screen({ keys: env(0) });
  await Promise.resolve();
  assert.doesNotMatch(none.reads(), /0 helpers? holds?/,
    'a session with nobody cleared reports "0 helpers hold this key", which reads as something to fix. It ' +
    'is the ordinary state of a Sunday nobody has been cleared for: ' + none.reads());
});

test('COPY: a single rotated session is not reported in the plural', async () => {
  // Same class as the helper count, same component, caught by reading the strings beside the two the device
  // found rather than by waiting for a second device run. It said "1 session(s) were given a new key".
  const one = await screen({ result: { issued: [{ session: 'svc-a' }], skipped: [], failed: [],
    rotated: ['svc-a'], settled: true } });
  await Promise.resolve();
  await Promise.resolve();
  const words = (one.redraw(), one.reads());
  assert.match(words, /One session was given a new key/i,
    'a single replaced key is reported in the plural: ' + words);
  const two = await screen({ result: { issued: [{ session: 'svc-a' }, { session: 'svc-b' }], skipped: [],
    failed: [], rotated: ['svc-a', 'svc-b'], settled: true } });
  await Promise.resolve();
  await Promise.resolve();
  const w2 = (two.redraw(), two.reads());
  assert.match(w2, /2 sessions were given a new key/i, 'and the plural broke while the singular was fixed: ' + w2);
});

test('POINT OF USE: THE MANUAL RE-ISSUE CONTROL EXISTS AND WORKS', async () => {
  // The scope note asks for it by name. It is the answer to "a helper turned up and cannot open the
  // register" without waiting for a clearance edit or a reload.
  const s = await screen();
  await Promise.resolve();
  assert.equal(s.calls.length, 1, 'fixture: the mount effect was supposed to run once');
  s.press('Re-issue');
  await Promise.resolve();
  assert.equal(s.calls.length, 2,
    'the Re-issue button did not reach the issuer. A control that toasts nothing and does nothing is the ' +
    'defect this project has a name for (memory: fix-the-control-not-the-label)');
});

test('POINT OF USE: A DELEGATED CONSOLE SAYS SO IN PLAIN WORDS, AND DOES NOT ISSUE', async () => {
  // reference/SCOPE-CHECKIN-SEALING-2026-09-10.md, piece 3: "Say the real constraint on screen. Not 'a
  // console must open'." A church where only delegated stewards ever open a console gets NO session keys,
  // ever, and its cleared helpers are handed records their phone cannot open. Stated, not designed around —
  // whether a delegate should be able to mint is the owner's decision and has not been taken.
  const s = await screen({ held: false });
  await Promise.resolve();
  assert.deepEqual(s.calls, [],
    'a delegated console attempted to issue. The relay refuses it, and those refusals raise the sticky ' +
    '"this relay is set up for a different church" banner whose remedy destroys a church key (round 7)');
  const words = s.said();
  assert.match(words, /cannot issue session keys/,
    'the screen does not say that this console cannot issue at all: ' + words);
  assert.match(words, /church.{0,40}own console/i,
    'the screen does not say WHOSE console has to open — "a console must open" is the vague version the ' +
    'scope note rules out, because a delegate reads it as "mine will do": ' + words);
  assert.match(words, /cannot open/,
    'the screen does not say what it costs the people already cleared: they are handed records their phone ' +
    'cannot open, which looks nothing like being refused: ' + words);
  assert.equal(btn(s.tree(), 'Re-issue')[0].props.disabled, true, 'the manual control was live on a console that cannot mint');
});

test('POINT OF USE: AN UNNAMED CHURCH DOES NOT ISSUE, and is told why', async () => {
  // The same proxy for "this console's church actually exists" that the capability-key effect uses, and for
  // the same measured reason: a delegated steward viewing their OWN identity has `actingChurch` empty, so
  // without this the console mints envelopes keyed to the delegate's own pubkey — 28 refusals in round 7.
  const s = await screen({ name: '' });
  await Promise.resolve();
  assert.deepEqual(s.calls, [], 'a console with no published church name issued session keys');
  assert.match(s.said(), /has not published its name/, 'and it does not say why nothing is happening: ' + s.said());
});

test('POINT OF USE: A REFUSED SESSION IS SAID, and a stood-down one is not called a fault', async () => {
  const s = await screen({ result: { issued: [], skipped: [], rotated: [], settled: true,
    failed: [{ session: 'svc-a', why: 'the relay or the builder refused it' }] } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(s.banners.length, 1,
    'a session could not be given a register key and nothing was said. Every other write on this page is ' +
    'awaited and answered for the same reason: ' + JSON.stringify(s.banners));
  assert.match(s.banners[0].message, /cleared helper will not be able to open/,
    'the banner does not say what it costs: ' + s.banners[0].message);
  // A STOOD-DOWN SUNDAY IS A DECISION, NOT AN ABSENCE, and must not read as a missing key.
  const s2 = await screen({ keys: [{ session: 'svc-a', standDown: true, ts: AT }] });
  await Promise.resolve();
  assert.match(s2.said(), /Stood down/,
    'a Sunday the church stood down is shown as having no key, which reads as a fault to fix by re-issuing ' +
    '— and re-issuing is the one thing that must not re-staff it: ' + s2.said());
});

test('POINT OF USE: `settled:false` COMING BACK FROM THE ENGINE IS SHOWN AS A WAIT, not a failure', async () => {
  // The engine's refusal has its own shape, and the screen must be able to tell it from a refusal by the
  // relay. Conflating them raises a fault banner for an ordinary two-second wait on every cold start.
  const s = await screen({ result: { issued: [], skipped: [], failed: [], rotated: [], settled: false } });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(s.banners, [],
    'the engine said "still reading" and the screen raised a write-failure banner for it');
  assert.match(s.redraw() && s.said(), /Waiting for this church/, 'and it says nothing at all: ' + s.said());
});

test('POINT OF USE: A ROTATION IS REPORTED ON THE SCREEN, and does not overclaim', async () => {
  const s = await screen({ result: { issued: [{ session: 'svc-a' }], skipped: [], failed: [],
    rotated: ['svc-a'], settled: true } });
  await Promise.resolve();
  await Promise.resolve();
  const words = s.redraw() && s.said();
  assert.match(words, /new.{0,30}key/i,
    'the screen replaced a live session key and said nothing. It is the one consequential act the issuer ' +
    'takes that a steward can neither see nor undo: ' + words);
  // ⚠ INVERTED 2026-09-10, DELIBERATELY, AS THE COMMENT THAT STOOD HERE REQUIRED. It used to assert
  // doesNotMatch(/lost|unreadable|orphan/) because nothing was sealed under a session key, so copy claiming
  // records were lost would have been a false claim in shipped UI. Piece 1 has landed: check-ins now carry a
  // second copy sealed under the session key, and replacing that key permanently orphans the helper's copy
  // of every record already written for the session. The old assertion did not merely go stale — it actively
  // FORBADE the screen from telling the truth, so leaving it would have pinned the reassuring untruth in
  // place with a passing test over it.
  assert.match(words, /unreadable to cleared helpers/i,
    'THE SCREEN STILL TELLS A STEWARD THE ROTATION COSTS NOTHING. Replacing a session key orphans the ' +
    'helper\'s copy of every check-in already written for it, with no re-wrap possible — the old key is ' +
    'exactly what this console could not open. A steward who reads "the register is unaffected" has been ' +
    'told the opposite of what just happened: ' + words);
  // AND THE OTHER HALF IS STILL TRUE AND STILL SAID. `content` is sealed to the safeguarding ring, never to
  // a session, so the church's own access really is unaffected. Dropping that clause would send a steward
  // hunting for records that are sitting right there in front of them.
  assert.match(words, /still read/i,
    'the screen now says the helper copies are lost without saying the register still opens for the church, ' +
    'which reads as "the check-ins are gone": ' + words);
  assert.doesNotMatch(words, /register itself is unaffected/i,
    'the screen carries BOTH the truthful line and the old reassurance, so a steward reads a contradiction ' +
    'and believes the half that costs them nothing: ' + words);
});

// ── 2c. WHAT A WITHDRAWAL ACTUALLY DOES TO THE PUBLISHED ENVELOPE ─────────────────────────────────────────
//
// The sim could not see this from the console and said so: "Whether the published envelope still wraps the
// withdrawn helper, or only the label is stale, is not visible from the console." It is the difference
// between a cosmetic bug and a live one, so it is settled here by running the SHIPPED withdrawal and the
// SHIPPED issuer and reading what each puts on the wire.
//
// THE ANSWER IS THAT THE ENVELOPE REALLY DOES STILL WRAP HER. A withdrawal writes ONE addressable tombstone,
// at `checkinperm:<person>`; the envelope lives at `checkinhelper:<session>`, a different address, and
// nothing but publishCheckinHelpers/revokeCheckinHelpers ever writes it. So without a re-issue her wrapped
// slot — and the session key inside it — stays on the relay for as long as the envelope does.
//
// WHAT LIMITS IT, stated so nothing here is overclaimed in either direction. The relay's read gate is a
// CONJUNCTION: canRead's CHECKINHELPER_D branch requires `checkinPermitted(authed, cp)` as well as envelope
// membership, so a withdrawn helper is refused the envelope and refused every record. What the stale wrap
// costs is therefore a key ALREADY ON A PHONE — nothing rotates a session key, deliberately, because
// rotating it orphans every record already sealed under it — which is the same honest limit the clearance
// panel's own copy states. This fix does not change that and must not claim to.
//
// SO THE TRIGGER FIX IS NOT A RELABEL: firing the issuer on a withdrawal is what actually removes her from
// the published document, and the second half below proves it does so WITHOUT rotating the key.

test('A WITHDRAWAL REWRITES THE CLEARANCE, NOT THE ENVELOPE — measured, both addresses', async () => {
  const h = engine();
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const doc0 = JSON.parse(ev.content);
  assert.deepEqual(doc0.pubs, [ADA], 'fixture: the envelope this test withdraws from does not name her');
  assert.ok(doc0.keys[ADA], 'fixture: she has no wrapped slot, so "the wrap survives" would be vacuous');
  assert.deepEqual(h.published, [], 'fixture: the mint\'s own publish was supposed to be taken off the wire');

  // THE WHOLE OF WHAT PRESSING "WITHDRAW" DOES.
  const ok = await h.revokeCheckinPermission(ADA);
  assert.equal(ok, true, 'fixture: the shipped withdrawal did not reach the wire at all');
  assert.equal(h.published.length, 1, 'a withdrawal published ' + h.published.length + ' events, not one');
  const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
  assert.ok(dOf(h.published[0]).startsWith(D.CHECKINPERM),
    're-anchor: a withdrawal no longer writes the clearance document at all: ' + dOf(h.published[0]));
  assert.deepEqual(h.published.filter(e => dOf(e).startsWith(D.CHECKINHELPER)), [],
    'THE WITHDRAWAL REWROTE THE SESSION ENVELOPE. If it ever does, the note above this test is wrong and ' +
    'the whole account of S2 needs redoing');
  assert.deepEqual(JSON.parse(ev.content).pubs, [ADA],
    'the envelope already published still names her — which is the finding: the console\'s panel was telling ' +
    'the truth about the document and lying about the effect');
});

test('…AND THE RE-ISSUE IS WHAT TAKES HER OFF IT, without rotating the session key', async () => {
  const h = engine();
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const key0 = JSON.parse(ev.content).keys[CHURCH];
  const stream = h.openKeys();
  stream.deliver([ev]);
  stream.eose();
  assert.equal(h.settled(), true, 'fixture: the corpus did not settle, so the issuer would refuse for the wrong reason');
  h.published.length = 0;

  // HER CLEARANCE IS GONE — the list the screen now hands the issuer, which is exactly what the trigger fix
  // makes happen at the moment the tombstone arrives instead of on the next page visit.
  const out = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [], stewards: [SGLEAD], existing: stream.rows() });
  assert.equal(out.issued.length, 1,
    'the issuer did not re-publish the envelope after the only cleared helper was withdrawn, so her wrap ' +
    'stays on the relay: ' + JSON.stringify(out));
  const doc1 = JSON.parse(h.published[0].content);
  assert.deepEqual(doc1.pubs, [],
    'THE RE-ISSUED ENVELOPE STILL NAMES THE WITHDRAWN HELPER: ' + JSON.stringify(doc1.pubs));
  assert.equal(doc1.keys[ADA], undefined,
    'and her wrapped copy of the session key survived the re-issue, which is the only part of this that a ' +
    'phone can keep using');
  assert.equal(out.issued[0].reused, true,
    'the re-issue MINTED A FRESH KEY. Removing one helper would then orphan the helper copy of every record ' +
    'already written into that session — a withdrawal must not destroy the register');
  assert.equal(doc1.keys[CHURCH], key0, 'the church\'s own slot changed, so the key was not in fact reused');
  assert.deepEqual(out.rotated, [], 'a re-issue that recovered the key was reported as a rotation');
});

// ── 3. AND THE PAGE ACTUALLY RENDERS IT ───────────────────────────────────────────────────────────────────
// THE SHARPEST FORM OF CLAUDE.md RULE 1. Everything above drives CheckinSessionKeys directly, so all of it
// would stay green if `<CheckinSessionKeys />` were deleted from DashCheckin — the component would exist,
// fully tested, and no steward would ever see it or issue anything. That is the exact shape of the
// child-safety defect rule 1 was written for.
//
// So DashCheckin is sliced and RENDERED, with its siblings supplied as recording stubs. Its own children are
// stubs rather than the real components because the question here is one thing only: does the Check-in page
// put the issuer on the screen? Rule 3 forbids answering that by matching text in app/stew-dashboard.jsx.
test('THE CHECK-IN PAGE MOUNTS THE ISSUER PANEL — or none of the tests above is about anything a steward sees', async () => {
  const src = fnBody(APP, 'function DashCheckin() {', 'DashCheckin');
  const tmp = join(tmpdir(), 'ckdash-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashCheckin };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const rendered = [];
  const Mark = (n) => { const f = function () { rendered.push(n); return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
  const globals = {
    React,
    Panel: function Panel(p) { return React.createElement('div', { 'data-panel': p.title }, p.action, p.children); },
    DismissibleNote: function DismissibleNote(p) { return React.createElement('div', null, p.children); },
    Icon: Stub('Icon'),
    CheckinPicker: Mark('CheckinPicker'),
    CheckoutModal: Mark('CheckoutModal'),
    CheckinClearances: Mark('CheckinClearances'),
    CheckinSessionKeys: Mark('CheckinSessionKeys'),
    // Supplied 2026-09-10 with the check-in copy cut: the register's intro note now ends in a link to the
    // 'console-checkin' guide, so a slice of DashCheckin needs this name in scope.
    StewHelpLink: Stub('StewHelpLink'),
    useStewNarrow: () => false,
    todayISO: () => SERVICE.date,
    window: {
      useStewardCheckins: () => [],
      useStewardSafeguard: () => ({ minors: [], approved: [], minorsKnown: true }),
      useStewardGuardians: () => ({}),
      useStewardMembers: () => [],
      useStewardServices: () => [svc('svc-a', SERVICE)],
      useStewardIdv: () => 1,
      useStewardConn: () => 1,
      Steward: { capKeyRing: () => ['k'], subscribeCapKey: () => () => {}, publishCheckin: async () => true },
      dispatchEvent: () => true,
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    setTimeout, clearTimeout, console, Math, Date, JSON, Set, Number, String, Array, Promise, Object,
  };
  const key = '__ckdash_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { DashCheckin } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  draw(DashCheckin, {});
  assert.ok(rendered.includes('CheckinClearances'), 're-anchor: this render reached none of the page\'s panels');
  assert.ok(rendered.includes('CheckinSessionKeys'),
    'THE CHECK-IN PAGE DOES NOT RENDER THE SESSION-KEY PANEL. Every other test in this file drives that ' +
    'component directly and would stay green: the issuer would be wired, tested, and unreachable — nobody ' +
    'ever opens it, so no key is ever minted and no steward is ever told why. Rendered: ' + JSON.stringify(rendered));
});
