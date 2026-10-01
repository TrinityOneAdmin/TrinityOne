// A KEY READ MAY OPEN A MINT GATE ONLY FOR THE CHURCH IT ASKED ABOUT, AND ONLY ON A REAL ANSWER.
//   Run: node --test scripts/key-reads-settle-only-for-the-church-they-asked-about.test.mjs
//
// `_careKeyChecked`, `_nameKeyChecked` and `_mediaKeyChecked` mean "we looked and this church has no envelope",
// and each one lets the console MINT a key — over the church's real one, if the answer was wrong. The audit of
// e6a2e02 (2026-10-01) measured it wrong 8 times in 10 on a real console: nostr-tools fires `oneose` when a
// subscription is CLOSED before its EOSE, the dashboard closes and re-opens these subscriptions on every
// identity change, and re-entering the SAME church passed every "still the current church?" check. The audit of
// d1116f6 then found a relay's CLOSED counted as an answer, one relay of two answering for the church, and a
// 4.3 s cutoff with no retry.
//
// The browser test (console-keys-follow-the-church-switch) drives the real screen; key-reads-over-real-sockets runs the reads over nostr-tools against scripted relays;
// this file pins each guard on its own, which neither can do deterministically. Everything below is sliced out
// of the SHIPPED vendor/steward.js and run with real NIP-44. The pool is a fake that behaves like nostr-tools in
// the ways that matter here: one subscription per call; close() fires the subscription's oneose AND onclose,
// asynchronously; a relay's CLOSED fires oneose and then onclose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nip44, generateSecretKey, getPublicKey } from 'nostr-tools';
import { fnBody, stmt, liftKeyRead } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const hex = (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map(b => parseInt(b, 16)));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const A = K(), B = K();                         // this console's own church A; church B, which A stewards
const NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:', MEDIAKEY_D = 'trinityone/mediakey:';
const R1 = 'wss://relay.example', R2 = 'wss://second.example';
const ck = (a, b) => nip44.v2.utils.getConversationKey(a, b);
const flush = () => new Promise(r => setTimeout(r, 0));   // the real timer: lets microtasks (oneose evaluation) run
const dtag = (ev) => ((ev.tags || []).find(x => x[0] === 'd') || [])[1];

// An envelope as a church's console publishes it: `ring` sealed by `author` to each of `recips`.
const envelope = (d, author, church, ring, recips, at = 1759300000) => ({ pubkey: author.pub, kind: 30078, created_at: at,
  tags: [['d', d + church], ['t', 'trinityone']],
  content: JSON.stringify({ rev: 1, keys: Object.fromEntries(recips.map(p => [p, nip44.v2.encrypt(JSON.stringify(ring), ck(author.sk, p))])) }) });
// A gate: `g.hold(fn)` wraps an async function so its next call waits for `g.release()`.
const gate = () => { let release; const p = new Promise(r => { release = r; }); return { p, release: () => release() }; };

function engine() {
  const subs = [];          // every subscription the lifted code opened: { url, d, handlers, opts, closed }
  const published = [];
  const signals = [];
  const timers = [];        // the lifted code's setTimeout calls (backoff retries) — fired by hand
  const t = {
    pub: A.pub, actingChurch: '', churchPub: A.pub, churchSk: A.sk, sk: A.sk,
    NET: 'trinityone', NAMEKEY_D, CAREKEY_D, MEDIAKEY_D, NAME_RING_MAX: 50,
    _careKeyHex: null, _careKeyRing: [], _careKeyDocKeys: null, _careKeyRev: 0, _careKeyChecked: false, _careKeyPending: [], _careKeyVer: 0,
    _careRoster: new Set(), _CAREKEY_PENDING_TTL: 12000,
    _mediaKeyHex: null, _mediaKeyRing: [], _mediaKeyDocKeys: null, _mediaKeyChecked: false, _mediaKeyPushRefused: null, _mediaKeyVer: 0,
    _nameKeyRing: [], _nameKeyDocKeys: null, _nameKeyChecked: false, _nameKeyAt: 0, _nameKeyBusy: null,
    _localBlocked: new Set(), toPubHex: (p) => p, _myOwnPub: () => A.pub,
    // login state: `authed` for the whole set (the mint gates' _isRelayAuthed); per relay, the relay's OK
    authed: true, refused: new Set(), _isRelayAuthed: () => t.authed,
    _keyReadAuthedOn: (url) => t.authed && !t.refused.has(url),
    relayList: [R1], relays: () => t.relayList.slice(), normalizeURL2: (u) => u,
    up: new Set(),          // relays whose socket is already connected (→ the read passes maxWait)
    clock: 1000000, Date: { now: () => t.clock },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    now: () => 1759300000, _CLOCK_SKEW: 600,
    decrypt3: (c, k) => nip44.v2.decrypt(c, k), encrypt3: (p, k) => nip44.v2.encrypt(p, k), getConversationKey: ck,
    _hex: hex, _unhex: unhex, crypto,
    _webQueueSync: () => {}, _churchHasCareNeeds: async () => false,
    _sealEach: async (pl, targets, f) => Object.fromEntries([...targets].map(p => [p, f(pl, p)])),
    feChurch: (x) => ({ ...x, pubkey: t.pub === B.pub ? A.pub : A.pub }),
    publish: async (e) => { published.push(e); return { id: 'ok' }; },
    pool: {
      get relays() { return new Map([...t.up].map(u => [u, { connected: true }])); },
      subscribeMany(urls, filters, handlers) {
        const rec = { url: urls[0], urls, d: ((filters[0] || {})['#d'] || [])[0], handlers, opts: handlers, closed: false };
        subs.push(rec);
        // nostr-tools' SimplePool: close() → Subscription.close → onclose → handleClose → handleEose (params.oneose)
        // → params.onclose, after `await allOpened`
        return { close() { if (rec.closed) return; rec.closed = true; Promise.resolve().then(() => { try { handlers.oneose && handlers.oneose(); handlers.onclose && handlers.onclose(['closed by caller']); } catch (e) {} }); } };
      },
    },
    window: { Steward: {}, dispatchEvent: (e) => { if (e.type === 'steward-keys-read') signals.push(e.detail.kind); return true; } },
    // what the REAL setActiveIdentity touches besides the key state (lifted below)
    stewardedChurches: new Map([[B.pub, { name: 'B' }]]), netKeys: () => [],
    localStorage: { setItem() {}, getItem() { return null; } }, ACTIVE_ID_KEY: 'k',
    _loadBoxHosts() {}, _refreshBoxHostsUs() {}, _gate: { refresh() {} }, relaysRaw: () => [],
    lastProfile: {}, _profileLoaded: false, _clearanceSent: new Map(), _careRosterKnown: false, _careRosterSeen: false,
    _stewardCaps: {}, _stewardNames: {}, _stewardNamesCt: '', _stewardSince: {}, _applyNoPhotoList() {},
    CAP_KEYS: { finance: { d: 'trinityone/financekey:', cap: 'finance', legacy: false, explicit: false } },
    _capState: { finance: { ring: [], docKeys: null, rev: 1, at: 0, checked: false } },
    churchSkHeld: () => !!t.churchSk, _capAllows: () => () => true, _warnUnsealed() {}, _sealEachFailed: [], _legacyBookKeyHex: () => '', _capRingChanged() {},
    _checkinMigrated: '', _ckKeysSettled: '', _ckSessionKeys: new Map(), npubEncode: (p) => 'npub' + p,
    _clearedTrail: null, _authedRelays: new Map(), _authAccepted: new Map(),   // …and what _resetChurchScopedState touches
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    console: { warn() {}, log() {}, error() {} },
    JSON, Set, Map, Object, Array, String, Number, Boolean, Promise, Error, Math, Uint8Array,
  };
  const proxy = new Proxy(t, {
    has: (o, k) => (k in o) || !(String(k) in globalThis),
    get: (o, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in o) return o[k];
      throw new ReferenceError('the lifted key-read code needs `' + String(k) + '` — add a stub');
    },
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const decls = [
    liftKeyRead(BUNDLE),
    stmt(BUNDLE, 'var _authFuture = (e) =>'),
    stmt(BUNDLE, 'var _byChurchOrSteward = (e) =>'),
    stmt(BUNDLE, 'var _careKeyAuthed = (e) =>'),
    stmt(BUNDLE, 'var _isCurrentCareEnv = (e) =>'),
    fnBody(BUNDLE, 'function _ingestCareKeyEnv(e) {'),
    fnBody(BUNDLE, 'function _reCheckCareKeyPending() {'),
    stmt(BUNDLE, 'var _nameKeyListeners = '),
    fnBody(BUNDLE, 'function _nameKeyRingChanged() {'),
    fnBody(BUNDLE, 'function _nameKeyReady() {'),
    fnBody(BUNDLE, 'function _fitKeyRing(full, recipCount, sealSample) {'),
    fnBody(BUNDLE, 'function _resetChurchScopedState() {'),
    't.__runAuthWaiters = _runKeyReadAuthWaiters;',
    't.__resetChurchScopedState = _resetChurchScopedState;',
  ].join('\n');
  const M = (a) => fnBody(BUNDLE, a, a + ' in the shipped bundle');
  const methods = [
    M('    subscribeCareKey() {'), M('    subscribeNameKey() {'), M('    subscribeMediaKey() {'),
    M('    async _ensureNameKeyLocked(memberPubs, stewardPubs, opts = {}) {'),
    M('    async ensureCareKeyForMembers(memberPubs, stewardPubs, opts) {'), M('    async rotateCareKey(memberPubs, stewardPubs) {'),
    M('    async ensureMediaKeyForMembers(memberPubs, stewardPubs) {'), M('    async rotateMediaKey(memberPubs, stewardPubs) {'),
    M('    async mediaEncryptor(memberPubs) {'),
    M('    async ensureCapKeyFor(kind, stewardPubs, caps) {'), M('    async rotateCapKey(kind, stewardPubs, caps) {'),
    M('    setActiveIdentity(targetPub) {'),
  ].join(',\n');
  t.t = t;
  const S = new Function('scope', `with (scope) { ${decls}\n return { ${methods} }; }`)(proxy);
  // setActiveIdentity's per-church key reset, replayed by hand for the read rows (the publisher rows below use
  // the real one): the delegated branch for B, the own-church branch for A.
  const switchTo = (church) => {
    t.pub = church.pub; t.actingChurch = church === A ? '' : church.pub;
    t._careRoster = new Set();
    t._nameKeyRing = []; t._nameKeyDocKeys = null; t._nameKeyChecked = false; t._nameKeyAt = 0;
    t._careKeyHex = null; t._careKeyRing = []; t._careKeyDocKeys = null; t._careKeyRev = 0; t._careKeyChecked = false; t._careKeyPending = [];
    t._mediaKeyHex = null; t._mediaKeyRing = []; t._mediaKeyDocKeys = null; t._mediaKeyChecked = false; t._mediaKeyPushRefused = null;
    t._keyReadEpoch++; t._careKeyVer++; t._mediaKeyVer++;
  };
  // nostr-tools' events, as they reach these handlers
  const eose = async (rec) => { rec.handlers.oneose(); await flush(); };
  const closedByRelay = async (rec, why = 'rate-limited: too many subscriptions') => { rec.handlers.oneose(); rec.handlers.onclose([why]); await flush(); };
  const fireTimers = () => { const due = timers.splice(0); for (const x of due) if (x.fn) x.fn(); return due.filter(x => x.fn).map(x => x.ms); };
  return { S, t, subs, published, signals, timers, switchTo, eose, closedByRelay, fireTimers };
}
const checked = (t, kind) => ({ care: t._careKeyChecked, name: t._nameKeyChecked, media: t._mediaKeyChecked })[kind];
const KINDS = [['care', 'subscribeCareKey'], ['name', 'subscribeNameKey'], ['media', 'subscribeMediaKey']];

// ── 1. THE ANSWER MUST BE THE RELAY'S, ABOUT NOW ──────────────────────────────────────────────────────────

for (const [kind, method] of KINDS) {
  test(`${kind}: CONTROL — a real, authenticated EOSE for the current church opens the gate and says so`, async () => {
    const e = engine();
    e.S[method]();
    await e.eose(e.subs.at(-1));
    assert.equal(checked(e.t, kind), true, 'a genuine answer no longer counts — no church could ever mint its first key');
    assert.deepEqual(e.signals, [kind], 'the dashboard is not told the read settled, so nothing re-runs the enrolment');
  });

  test(`${kind}: our OWN close is not an answer — re-entering the same church does not mark it "looked"`, async () => {
    const e = engine();
    const close1 = e.S[method]();
    e.switchTo(A);                        // setActiveIdentity(A) while already on A
    close1(); e.S[method]();              // the dashboard: cleanup, then re-subscribe
    await flush();                        // nostr-tools fires the closed subscription's oneose
    assert.equal(checked(e.t, kind), false, `THE CLOSE OF A SUBSCRIPTION MARKED THE ${kind.toUpperCase()} KEY "LOOKED, NONE HERE" — the mint gate is open with an empty ring (audit of e6a2e02)`);
    await e.eose(e.subs.at(-1));
    assert.equal(checked(e.t, kind), true, 'CONTROL: the new subscription\'s own answer counts');
  });

  test(`${kind}: our own close is not an answer on a plain re-subscribe either (a reconnect, no reset)`, async () => {
    const e = engine();
    e.switchTo(A);                        // e.g. just switched in: nothing read yet
    const close1 = e.S[method]();
    close1(); e.S[method]();              // the connection tick re-subscribes before the first read answered
    await flush();
    assert.equal(checked(e.t, kind), false, 'the CLOSE of an unanswered read opened the mint gate — nothing was ever read');
  });

  test(`${kind}: a read for one church never answers for another (defence in depth: every real switch also resets)`, async () => {
    const e = engine();
    e.S[method]();
    const forA = e.subs.at(-1);
    e.t.pub = B.pub; e.t.actingChurch = B.pub;   // the church changes WITHOUT the reset — no current path does this
    await e.eose(forA);
    assert.equal(checked(e.t, kind), false, 'church A\'s read told church B\'s mint gate "looked"');
  });

  test(`${kind}: a read opened before a reset does not count after it, even for the same church`, async () => {
    const e = engine();
    e.S[method]();
    const stale = e.subs.at(-1);
    e.switchTo(A);                        // reset; the old subscription is still open (not yet cleaned up)
    await e.eose(stale);
    assert.equal(checked(e.t, kind), false, 'an end-of-stored-events from BEFORE the reset reopened the gate — the envelope it delivered was wiped by the reset');
  });

  test(`${kind}: nostr-tools' own 4.4 s timer is not an answer — and the read is asked again, with backoff`, async () => {
    const e = engine();
    e.S[method]();
    e.t.clock += 4400;                    // Subscription.fire() → setTimeout(receivedEose, 4400)
    await e.eose(e.subs.at(-1));
    assert.equal(checked(e.t, kind), false, 'a timer-made EOSE ("the relay said nothing") was taken as "this church has no key"');
    assert.deepEqual(e.fireTimers(), [2000], 'A READ THAT MISSED THE CUTOFF WAS NEVER ASKED AGAIN — a church on a slow link gets no keys until something else re-subscribes (audit of d1116f6)');
    assert.equal(e.subs.length, 2, 'the retry did not re-open the read');
    e.t.clock += 4400; await e.eose(e.subs.at(-1));
    assert.deepEqual(e.fireTimers(), [4000], 'the retry did not back off');
    await e.eose(e.subs.at(-1));
    assert.equal(checked(e.t, kind), true, 'CONTROL: the re-asked read\'s genuine answer counts');
  });

  test(`${kind}: a relay's CLOSED is not an answer — and the read is asked again`, async () => {
    const e = engine();
    e.S[method]();
    await e.closedByRelay(e.subs.at(-1));
    assert.equal(checked(e.t, kind), false, 'A CLOSED ("rate-limited") WAS TAKEN AS "THIS CHURCH HAS NO KEY" — the console mints over the envelope that relay holds (audit of d1116f6)');
    assert.deepEqual(e.fireTimers(), [2000], 'a refused read was never asked again');
    await e.eose(e.subs.at(-1));
    assert.equal(checked(e.t, kind), true, 'CONTROL: the re-asked read\'s genuine answer counts');
  });

  test(`${kind}: an unauthenticated answer does not count — and the read is asked again once the login is accepted`, async () => {
    const e = engine();
    e.t.authed = false;
    e.S[method]();
    const first = e.subs.at(-1);
    await e.eose(first);
    assert.equal(checked(e.t, kind), false, 'an UNAUTHENTICATED end-of-stored-events opened the gate — the relay withholds private envelopes from that reader');
    e.t.authed = true;
    e.t.__runAuthWaiters();               // the signer, once the relay has accepted this console's login
    assert.equal(e.subs.length, 2, 'the read was not asked again after logging in — a church with no envelope yet would never get its first key');
    await flush();                        // the first subscription's close fires its oneose: still not an answer
    assert.equal(checked(e.t, kind), false, 'the close of the unauthenticated read was taken as the answer');
    await e.eose(e.subs.at(-1));
    assert.equal(checked(e.t, kind), true, 'the authenticated re-read\'s answer did not count');
  });
}

// ── 1b. ONE RELAY IS NOT THE CHURCH ─────────────────────────────────────────────────────────────────────────

test('two relays: the gate opens only when BOTH have answered — one empty answer does not speak for the other', async () => {
  const e = engine(); e.t.relayList = [R1, R2];
  e.S.subscribeNameKey();
  const [r1, r2] = e.subs.slice(-2);
  assert.deepEqual([r1.url, r2.url], [R1, R2], 'the read is not opened per relay');
  await e.eose(r2);                        // the empty relay answers
  assert.equal(e.t._nameKeyChecked, false, 'ONE RELAY\'S EMPTY ANSWER OPENED THE GATE while the other — which may hold the envelope — had not answered (audit of d1116f6)');
  await e.eose(r1);
  assert.equal(e.t._nameKeyChecked, true, 'CONTROL: both answered');
});

test('two relays: the one that refuses our LOGIN does not count, though the other is logged in', async () => {
  const e = engine(); e.t.relayList = [R1, R2]; e.t.refused = new Set([R1]);   // we signed; R1 said no
  e.S.subscribeNameKey();
  const [r1, r2] = e.subs.slice(-2);
  await e.eose(r1); await e.eose(r2);
  assert.equal(e.t._nameKeyChecked, false, 'A RELAY THAT REFUSED OUR LOGIN WAS COUNTED — its answer withholds the private envelope (audit of d1116f6)');
  e.t.refused = new Set(); e.t.__runAuthWaiters();       // R1 accepts a later login
  const again = e.subs.slice(-2);
  assert.notEqual(again[0], r1, 'the read was not asked again when the login was accepted');
  await e.eose(again[0]); await e.eose(again[1]);
  assert.equal(e.t._nameKeyChecked, true, 'CONTROL: both answered, both logged in');
});

test('two relays: one that cannot be reached keeps the gate shut, and is asked again', async () => {
  const e = engine(); e.t.relayList = [R1, R2];
  e.S.subscribeCareKey();
  const [r1, r2] = e.subs.slice(-2);
  await e.closedByRelay(r1, 'connection failure: relay unreachable');   // nostr-tools: connect fails → handleClose
  await e.eose(r2);
  assert.equal(e.t._careKeyChecked, false, 'THE GATE OPENED WITH THE RELAY HOLDING THE ENVELOPE DOWN (audit of d1116f6)');
  assert.deepEqual(e.fireTimers(), [2000], 'the unreachable relay was never asked again');
});

test('a relay that is already connected is read with a longer wait, so a slow genuine answer counts', async () => {
  const e = engine(); e.t.up = new Set([R1]);
  e.S.subscribeMediaKey();
  const rec = e.subs.at(-1);
  assert.equal(rec.opts.maxWait, 15000, 'the read of a connected relay does not pass maxWait — nostr-tools\' 4.4 s timer beats a slow relay every time');
  e.t.clock += 4500;                                      // past nostr-tools' default timer, inside ours
  await e.eose(rec);
  assert.equal(e.t._mediaKeyChecked, true, 'an EOSE at 4.5 s on a connected relay did not count');
  const e2 = engine();                                    // CONTROL: not yet connected → default wait, no maxWait
  e2.S.subscribeMediaKey();
  assert.equal(e2.subs.at(-1).opts.maxWait, undefined, 'maxWait passed for a relay not yet connected — it also sizes the CONNECTION timeout');
});

// THROUGH THE REAL setActiveIdentity: re-entering the church already active. The read had delivered the envelope
// BEFORE the switch (which wiped it) and answers AFTER it, without being closed. Unless the switch starts a new
// epoch, that answer says "looked, no key" over an empty ring — and the mint gate opens.
test('the REAL setActiveIdentity starts a new key-read epoch: an answer from before it cannot open the gate', async () => {
  const e = engine();
  for (const method of ['subscribeNameKey', 'subscribeCareKey', 'subscribeMediaKey']) e.S[method]();
  const [name, care, media] = e.subs.slice(-3);
  name.handlers.onevent(envelope(NAMEKEY_D, A, A.pub, ['dd'.repeat(32)], [A.pub]));
  assert.equal(e.t._nameKeyRing.length, 1, 'CONTROL: the envelope was read');
  assert.equal(e.S.setActiveIdentity(A.pub), true, 'CONTROL: the switch succeeded');
  assert.equal(e.t._nameKeyRing.length, 0, 'CONTROL: the switch reset the ring');
  await e.eose(name); await e.eose(care); await e.eose(media);   // the old reads answer — after the reset, never closed
  assert.equal(e.t._nameKeyChecked, false, 'AN ANSWER FROM BEFORE THE SWITCH OPENED THE NAME-KEY MINT GATE over an empty ring');
  assert.equal(e.t._careKeyChecked, false, 'an answer from before the switch opened the care-key mint gate');
  assert.equal(e.t._mediaKeyChecked, false, 'an answer from before the switch opened the media-key mint gate');
  assert.equal(await e.S._ensureNameKeyLocked([], []), null, 'the console went on to mint');
  assert.equal(e.published.length, 0, 'A FRESH NAME RING WAS PUBLISHED OVER THE CHURCH\'S REAL ONE');
});

test('the REAL _resetChurchScopedState (a key restore) starts a new key-read epoch too', async () => {
  const e = engine();
  for (const method of ['subscribeNameKey', 'subscribeCareKey', 'subscribeMediaKey']) e.S[method]();
  const [name, care, media] = e.subs.slice(-3);
  e.t.__resetChurchScopedState();
  await e.eose(name); await e.eose(care); await e.eose(media);
  assert.equal(e.t._nameKeyChecked, false, 'an answer from before the reset opened the name-key mint gate');
  assert.equal(e.t._careKeyChecked, false, 'an answer from before the reset opened the care-key mint gate');
  assert.equal(e.t._mediaKeyChecked, false, 'an answer from before the reset opened the media-key mint gate');
});

// ── 2. ANOTHER CHURCH'S ENVELOPE NEVER FEEDS OR BLOCKS THIS ONE ─────────────────────────────────────────────

test('name: church A\'s envelope delivered after switching to B is not taken as B\'s name key', () => {
  const e = engine();
  e.S.subscribeNameKey();
  const staleA = e.subs.at(-1);
  e.switchTo(B); e.t._careRoster = new Set([A.pub]);     // B's roster names A — so A's envelope passes the author check
  staleA.handlers.onevent(envelope(NAMEKEY_D, A, A.pub, ['aa'.repeat(32)], [A.pub]));
  assert.deepEqual(e.t._nameKeyRing, [], 'CHURCH A\'S NAME RING WAS TAKEN AS CHURCH B\'S — B\'s console would seal and wrap with A\'s key');
  assert.equal(e.t._nameKeyDocKeys, null, 'church A\'s recipient map was recorded as church B\'s envelope');
  e.S.subscribeNameKey();                                // CONTROL: B's own envelope, wrapped to A, is read
  e.subs.at(-1).handlers.onevent(envelope(NAMEKEY_D, B, B.pub, ['bb'.repeat(32)], [B.pub, A.pub]));
  assert.deepEqual(e.t._nameKeyRing, ['bb'.repeat(32)], 'CONTROL: church B\'s own envelope was not read');
});

test('care: church A\'s envelope delivered after switching to B is not ingested as B\'s care key', () => {
  const e = engine();
  e.S.subscribeCareKey();
  const staleA = e.subs.at(-1);
  e.switchTo(B); e.t._careRoster = new Set([A.pub]);
  staleA.handlers.onevent(envelope(CAREKEY_D, A, A.pub, ['aa'.repeat(32)], [A.pub]));
  assert.equal(e.t._careKeyHex, null, 'CHURCH A\'S CARE KEY WAS TAKEN AS CHURCH B\'S — a need opened in B would be sealed with it');
  assert.equal(e.t._careKeyDocKeys, null, 'church A\'s recipient map was recorded as church B\'s');
  assert.equal(e.t._careKeyChecked, false, 'church A\'s envelope told B\'s mint gate "looked"');
});

test('care: church A\'s envelope left in the unverified buffer does not hold church B\'s care key hostage', async () => {
  const e = engine();
  e.S.subscribeCareKey();
  const staleA = e.subs.at(-1);
  e.switchTo(B);                                          // B's roster not loaded yet → A's envelope is BUFFERED
  staleA.handlers.onevent(envelope(CAREKEY_D, A, A.pub, ['aa'.repeat(32)], [A.pub]));
  assert.equal(e.t._careKeyPending.length, 1, 'CONTROL: the unverifiable envelope was buffered');
  e.S.subscribeCareKey(); await e.eose(e.subs.at(-1));    // B's own read: no envelope
  const r = await e.S.ensureCareKeyForMembers([], []);
  assert.notEqual(r, false, 'church A\'s buffered envelope blocked church B\'s care key for the length of the buffer\'s TTL');
  assert.equal(e.published.length, 1, 'church B\'s first care key was not published');
  assert.equal(dtag(e.published[0]), CAREKEY_D + B.pub, 'CONTROL: published as church B\'s envelope');
});

// ── 3. A NAME-KEY PUBLISH DOES NOT ACT ON A STATE THAT MOVED WHILE IT SEALED ───────────────────────────────

test('name: the church\'s envelope landing while a first key is being sealed is adopted, never published over', async () => {
  const e = engine();
  e.S.subscribeNameKey();
  const h = e.subs.at(-1);
  await e.eose(h);                                        // a trustworthy "no envelope yet"
  const g = gate();
  const real = e.t._sealEach; e.t._sealEach = async (...a) => { await g.p; return real(...a); };
  const run = e.S._ensureNameKeyLocked([], []);
  await flush();
  h.handlers.onevent(envelope(NAMEKEY_D, A, A.pub, ['cc'.repeat(32)], [A.pub]));   // another of the church's consoles published first
  g.release();
  assert.equal(await run, null, 'the console carried on with a mint decided before the envelope arrived');
  assert.equal(e.published.length, 0, 'A FRESH NAME KEY WAS PUBLISHED OVER THE ONE THAT HAD JUST ARRIVED — every name sealed under it stops opening');
  assert.deepEqual(e.t._nameKeyRing, ['cc'.repeat(32)], 'the console is not on the church\'s ring');
});

test('name: CONTROL — with nothing arriving, the first name key is minted and published', async () => {
  const e = engine();
  e.S.subscribeNameKey();
  await e.eose(e.subs.at(-1));
  const out = await e.S._ensureNameKeyLocked([], []);
  assert.ok(out, 'the first name key was not published');
  assert.equal(e.published.length, 1);
  assert.equal(e.t._nameKeyRing.length, 1, 'the console did not adopt the key it published');
});
