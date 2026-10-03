// A CLEARANCE MADE AFTER THE SESSION OPENED STILL GETS A KEY (sim item 31, SIM-VERIFY-2026-10-02).
//   Run: node --test scripts/checkin-clearance-made-mid-session-gets-a-key.test.mjs
//
// THE DEFECT: issueCheckinSessionKeys judged who is cleared AT THE SESSION'S START (`permittedHelpers(perms,
// win.from)`). A 'dated' or 'open' clearance begins the moment it is made (permissionWindow), so a clearance
// made once the service was already under way had `from > win.from` and was left off the envelope: the
// person got no key for that Sunday. ('day' begins at midnight, which is why that shape worked.)
//
// THE ENGINE IS LIFTED OUT OF vendor/steward.js (the bundle the console loads) and run, per CLAUDE.md rule 3 —
// nothing here matches text in an app/*.jsx file. The clearances are built by the SHIPPED builder
// (permissionWindow + buildCheckinPermission) and read back through the SHIPPED parser, so the `from` a
// clearance carries is the one the product really writes. The only caller of the issuer is
// CheckinSessionKeys in app/stew-dashboard.jsx, which passes `permissions` straight through; the fix is
// inside the engine, so the screen's own wiring stays covered by
// checkin-session-keys-are-not-issued-early.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody, stmt } from './test-slice.mjs';
import { buildHelperGrant, helperPolicy, lifetimeWindow, eligibleHelpers, GRANT_SOURCE, KEY_LEAD_SECONDS,
         permittedHelpers, permissionPolicy, permissionWindow, buildCheckinPermission, readCheckinPermission,
         readHelperGrant, PERMISSION_LIFETIMES } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const VENDOR = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

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
    // Stage 3 of reference/SCOPE-RELAY-CORRECTED-TIME-2026-09-26.md routed every raw publisher in the
    // console through _monotonic(), so a lifted writer needs it in scope. IDENTITY here, deliberately:
    // that is exactly what the shipped one returns for the first write of a document, and it leaves every
    // row in this file measuring what it measured before. The ordering _monotonic adds is measured in
    // scripts/two-safeguarding-writes-in-one-second-both-land.test.mjs; here it must decide nothing.
    _monotonic: (t) => t,
    // …and stage 4's bounded wait, which those writers now take before their first stamp of a session.
    // Pass-through, which is what the shipped _skewGate does once a measurement has answered or been
    // given up on — it runs `fn` synchronously and returns its result. The wait itself is measured in
    // scripts/a-slow-console-does-not-write-past-its-own-gate.test.mjs; here it must decide nothing.
    _skewGate: (fn) => Promise.resolve(fn()),
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


// ── THE SESSION, AND CLEARANCES BUILT THE WAY THE PRODUCT BUILDS THEM ─────────────────────────────────────
const WIN = lifetimeWindow('session', SERVICE, {});
assert.ok(WIN && WIN.until > WIN.from, 'fixture: the service has no window');
const MID = WIN.from + 1800;                 // half an hour into the service
const BEFORE = WIN.from - 86400;             // the day before
// A clearance made at `madeAt`, in the shape a steward's screen writes: lifetime 'dated' (to a date) or
// 'open', starting at the moment it is made. `until` is the day after the service, local date.
const dayAfter = (() => { const d = new Date((WIN.until + 86400) * 1000); const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();
function clearance(who, lifetime, madeAt) {
  const w = permissionWindow(lifetime, { at: madeAt, until: dayAfter });
  assert.ok(w, 'fixture: the shipped permissionWindow refused ' + lifetime);
  return readCheckinPermission(JSON.stringify(buildCheckinPermission({ person: who, source: 'steward',
    lifetime, from: w.from, until: w.until })));
}
async function issueAt(at, permissions) {
  const h = engine();
  const stream = h.openKeys(); stream.eose();    // a settled read, so the issuer is allowed to act
  const res = await h.issueCheckinSessionKeys({ at, services: [svc('svc-a', SERVICE)], permissions,
    stewards: [SGLEAD], existing: stream.rows() });
  return { h, res, env: h.published.length ? JSON.parse(h.published[0].content) : null };
}

test('THE DEFECT: a "dated" clearance made after the service opened STILL gets a key', async () => {
  const perm1 = clearance(ADA, 'dated', MID);
  assert.ok(perm1.from > WIN.from, 're-anchor: the fixture clearance must begin AFTER the session started');
  const { h, res, env } = await issueAt(MID, [perm1]);
  assert.ok(h.probe.published > 0, 'harness reached no publish — nothing here was exercised');
  assert.equal(res.issued.length, 1, 'no envelope was issued for a session that is under way: ' + JSON.stringify(res));
  assert.ok(env.pubs.includes(ADA) && env.keys[ADA],
    'THE CLEARANCE WAS MADE MID-SESSION AND THE PERSON WAS LEFT OFF THE ENVELOPE — the sim finding');
});

test('…and so does an "open" ("until a steward ends it") clearance made mid-session', async () => {
  const { env } = await issueAt(MID, [clearance(BEN, 'open', MID)]);
  assert.ok(env && env.pubs.includes(BEN) && env.keys[BEN], 'an open clearance made mid-session got no key');
});

test('CONTROL: a clearance that opens only AFTER the service has ended gets no key', async () => {
  const late = clearance(ADA, 'open', WIN.until + 3600);
  const { env, res } = await issueAt(MID, [late]);
  assert.ok(!env || !env.pubs.includes(ADA), 'a clearance that begins after the service ended was given a key: ' + JSON.stringify(env));
  assert.ok(res.settled, 're-anchor: the issuer must have run for this control to mean anything');
});

test('CONTROL: judged BEFORE the service starts, a clearance not yet begun still gets nothing', async () => {
  const { env, res } = await issueAt(BEFORE, [clearance(ADA, 'open', WIN.from + 60)]);
  assert.ok(res.settled, 're-anchor: the issuer must have run');
  assert.ok(!env || !env.pubs.includes(ADA), 'a clearance not yet begun was named on a session not yet started');
});

test('REGRESSION: a clearance made BEFORE the session, and one that lapses part-way through, keep their key', async () => {
  const early = clearance(ADA, 'open', BEFORE);
  const lapsing = clearance(BEN, 'dated', BEFORE);
  lapsing.until = WIN.from + 600;                     // ends 10 minutes into the service
  const { env } = await issueAt(MID, [early, lapsing]);
  assert.ok(env.pubs.includes(ADA), 'a clearance made before the session lost its key');
  assert.ok(env.pubs.includes(BEN), 'a clearance that lapses mid-session lost the key it was entitled to at the start');
});

test('A SECOND PASS with the mid-session helper already on the envelope reuses the key and issues nothing', async () => {
  const h = engine(); const stream = h.openKeys(); stream.eose();
  const p = [clearance(ADA, 'dated', MID)];
  const first = await h.issueCheckinSessionKeys({ at: MID, services: [svc('svc-a', SERVICE)], permissions: p,
    stewards: [SGLEAD], existing: stream.rows() });
  assert.equal(first.issued.length, 1);
  const ev = { ...h.published[0], created_at: MID, pubkey: CHURCH };
  const stream2 = h.openKeys(); stream2.deliver([ev]); stream2.eose();
  const again = await h.issueCheckinSessionKeys({ at: MID + 60, services: [svc('svc-a', SERVICE)], permissions: p,
    stewards: [SGLEAD], existing: stream2.rows() });
  assert.deepEqual(again.issued, [], 'an unchanged mid-session set re-minted on every pass: ' + JSON.stringify(again));
  assert.equal(again.skipped[0] && again.skipped[0].why, 'unchanged');
});
