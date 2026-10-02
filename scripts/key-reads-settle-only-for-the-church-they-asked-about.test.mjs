// A KEY READ MAY OPEN A MINT GATE ONLY FOR THE CHURCH IT ASKED ABOUT, AND ONLY ON A REAL ANSWER — AND A KEY
// PUBLISHER NEVER CARRIES ONE CHURCH'S RESULT INTO ANOTHER.
//   Run: node --test scripts/key-reads-settle-only-for-the-church-they-asked-about.test.mjs
//
// `_careKeyChecked`, `_nameKeyChecked` and `_mediaKeyChecked` mean "we looked and this church has no envelope",
// and each one lets the console MINT a key — over the church's real one, if the answer was wrong. The audit of
// e6a2e02 (2026-10-01) measured it wrong 8 times in 10 on a real console: nostr-tools fires `oneose` when a
// subscription is CLOSED before its EOSE, the dashboard closes and re-opens these subscriptions on every
// identity change, and re-entering the SAME church passed every "still the current church?" check. The audit of
// d1116f6 then found a relay's CLOSED counted as an answer, one relay of two answering for the church, a 4.3 s
// cutoff with no retry — and, the worst of it, a church switch while a key publish was in flight carrying church
// A's keys into church B's envelopes.
//
// The browser tests (console-keys-follow-the-church-switch, a-church-switch-mid-publish-hands-over-no-keys)
// drive the real screen; key-reads-over-real-sockets runs the reads over nostr-tools against scripted relays;
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
  const events = [];        // every window event the lifted code dispatched: { type, detail }
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
    window: { Steward: {}, dispatchEvent: (e) => { events.push({ type: e.type, detail: e.detail }); if (e.type === 'steward-keys-read') signals.push(e.detail.kind); return true; } },
    BLOCKED_D: 'trinityone/blocked:', STEWARDS_D: 'trinityone/stewards:', _byChurch: (e) => e.pubkey === t.pub, _openChurchDoc: () => null,
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
    M('    async ensureNameKeyForMembers(memberPubs, stewardPubs, opts = {}) {'),
    M('    subscribeBlocked(onBlocked) {'), M('    subscribeStewards(onList) {'),
    M('    listIsCurrent(list) {'), M('    keyWaitNote(kind) {'),
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
  return { S, t, subs, published, signals, events, timers, switchTo, eose, closedByRelay, fireTimers };
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

// ── 4. A CHURCH SWITCH WHILE A KEY PUBLISH IS IN FLIGHT HANDS NOTHING OVER ──────────────────────────────────
// The audit of d1116f6, in the real console: Block a member in church A, switch to church B while the rotation
// is publishing, and the console in B held A's fresh care and name keys — then published them AS B's envelopes,
// wrapped to A's members, the one just blocked among them. Every publisher captures its church and epoch at
// entry and checks both after every await; these rows switch through the REAL setActiveIdentity at each await.
const RING_A = ['a1'.repeat(32), 'a2'.repeat(32)];
const M1 = K(), M2 = K(), M3 = K();
const onA = (e, kind) => {   // church A, read and keyed, as the console holds it before the Block
  if (kind === 'care') { e.t._careKeyChecked = true; e.t._careKeyHex = RING_A[0]; e.t._careKeyRing = RING_A.slice(); e.t._careKeyDocKeys = { [A.pub]: 'x', [M1.pub]: 'x', [M2.pub]: 'x' }; e.t._careKeyRev = 1; }
  if (kind === 'media') { e.t._mediaKeyChecked = true; e.t._mediaKeyHex = RING_A[0]; e.t._mediaKeyRing = RING_A.slice(); e.t._mediaKeyDocKeys = { [A.pub]: 'x', [M1.pub]: 'x' }; }
  if (kind === 'name') { e.t._nameKeyChecked = true; e.t._nameKeyRing = RING_A.slice(); e.t._nameKeyDocKeys = { [A.pub]: 'x', [M1.pub]: 'x' }; }
};
const holdSeal = (e) => { const g = gate(); const real = e.t._sealEach; e.t._sealEach = async (...a) => { await g.p; return real(...a); }; return g; };
const holdPublish = (e) => { const g = gate(); const real = e.t.publish; e.t.publish = async (...a) => { const r = await real(...a); await g.p; return r; }; return g; };
const nothingOfAIn = (e, kind) => {   // the console, now on B, holds none of A's keys — not the old ones, not fresh ones
  const ring = kind === 'care' ? e.t._careKeyRing : kind === 'media' ? e.t._mediaKeyRing : e.t._nameKeyRing;
  const hexk = kind === 'care' ? e.t._careKeyHex : kind === 'media' ? e.t._mediaKeyHex : (ring[0] || null);
  return ring.length === 0 && hexk === null;
};
const PUBLISHERS = [
  // [label, kind, call, a Block? (false must be reported when nothing was published)]
  ['rotateCareKey (a Block)', 'care', (e) => e.S.rotateCareKey([M2.pub], []), true],
  ['rotateMediaKey (a Block)', 'media', (e) => e.S.rotateMediaKey([M2.pub], []), true],
  ['the name key\'s Block rotation', 'name', (e) => e.S._ensureNameKeyLocked([M2.pub], [], { rotate: true }), true],
  ['ensureCareKeyForMembers (a member joined)', 'care', (e) => e.S.ensureCareKeyForMembers([M1.pub, M2.pub, M3.pub], []), false],
  ['ensureMediaKeyForMembers (a member joined)', 'media', (e) => e.S.ensureMediaKeyForMembers([M1.pub, M2.pub], []), false],
  ['the name key\'s routine grow (a member joined)', 'name', (e) => e.S._ensureNameKeyLocked([M1.pub, M2.pub], []), false],
];
for (const [label, kind, call, isBlock] of PUBLISHERS) {
  test(`${label}: a switch to church B WHILE SEALING publishes nothing and leaves B's state alone`, async () => {
    const e = engine(); onA(e, kind);
    const g = holdSeal(e);
    const run = call(e);
    await flush();
    assert.equal(e.S.setActiveIdentity(B.pub), true, 'CONTROL: switched to B');
    g.release();
    const out = await run;
    assert.equal(e.published.length, 0, `${label} PUBLISHED AFTER THE CONSOLE HAD SWITCHED CHURCH: ${JSON.stringify(e.published.map(dtag))}`);
    assert.ok(nothingOfAIn(e, kind), `${label}: THE CONSOLE, NOW ON CHURCH B, HOLDS CHURCH A'S ${kind.toUpperCase()} KEYS — its next enrolment publishes them as B's (audit of d1116f6)`);
    if (isBlock) assert.equal(out, false, `${label} was interrupted before publishing and did not say so — block() reports only false, so the steward believes the key was changed`);
  });

  test(`${label}: a switch to church B WHILE PUBLISHING adopts nothing into B, and the envelope is church A's`, async () => {
    const e = engine(); onA(e, kind);
    const g = holdPublish(e);
    const run = call(e);
    for (let i = 0; i < 200 && !e.published.length; i++) await flush();
    assert.equal(e.S.setActiveIdentity(B.pub), true, 'CONTROL: switched to B');
    g.release();
    await run;
    assert.equal(e.published.length, 1);
    const d = dtag(e.published[0]);
    assert.equal(d, { care: CAREKEY_D, media: MEDIAKEY_D, name: NAMEKEY_D }[kind] + A.pub, `${label} published under ${d} — the envelope must be church A's, the church it started on`);
    assert.ok(nothingOfAIn(e, kind), `${label}: THE CONSOLE, NOW ON CHURCH B, ADOPTED CHURCH A'S ${kind.toUpperCase()} KEYS (audit of d1116f6: they were then published as B's envelopes)`);
  });
}

test('mediaEncryptor: a switch while the first sermon key is being sealed uploads nothing and adopts nothing', async () => {
  for (const at of ['seal', 'publish']) {
    const e = engine(); e.t._mediaKeyChecked = true;
    const g = at === 'seal' ? holdSeal(e) : holdPublish(e);
    const run = e.S.mediaEncryptor([M1.pub]);
    if (at === 'seal') await flush(); else for (let i = 0; i < 200 && !e.published.length; i++) await flush();
    e.S.setActiveIdentity(B.pub);
    g.release();
    await assert.rejects(run, /changed church/, `${at}: the upload went on to encrypt after the console switched church`);
    assert.equal(e.published.length, at === 'seal' ? 0 : 1, `${at}: unexpected publishes ${JSON.stringify(e.published.map(dtag))}`);
    if (e.published.length) assert.equal(dtag(e.published[0]), MEDIAKEY_D + A.pub, 'the sermon key envelope must be church A\'s');
    assert.equal(e.t._mediaKeyHex, null, `${at}: the console on church B holds church A's freshly minted sermon key`);
  }
  const e = engine(); e.t._mediaKeyChecked = true;          // CONTROL: no switch → the key is minted, adopted, used
  const enc = await e.S.mediaEncryptor([M1.pub]);
  assert.equal(typeof enc, 'function');
  assert.ok(e.t._mediaKeyHex, 'CONTROL: the minted sermon key was not adopted');
});

test('capability keys: a switch while sealing publishes nothing (ensureCapKeyFor and rotateCapKey)', async () => {
  for (const which of ['ensure', 'rotate']) {
    const e = engine();
    e.t._capState.finance = { ring: which === 'rotate' ? ['f1'.repeat(32)] : [], docKeys: which === 'rotate' ? { [A.pub]: 'x', [M1.pub]: 'x' } : null, rev: 1, at: 0, checked: true };
    const g = holdSeal(e);
    const run = which === 'ensure' ? e.S.ensureCapKeyFor('finance', [M1.pub], {}) : e.S.rotateCapKey('finance', [], {});
    await flush();
    e.S.setActiveIdentity(B.pub);
    g.release();
    assert.equal(await run, false, `${which}: an interrupted capability-key publish did not report failure`);
    assert.equal(e.published.length, 0, `${which}: a capability-key envelope was published after the console switched church`);
  }
});

// ── 5. NO LIST, AND NO QUEUED KEY OPERATION, CROSSES A CHURCH SWITCH (audit of 3bc8905) ─────────────────────────

// THE POOL ITSELF: once the caller closes a subscription, its handlers are inert. nostr-tools fires `oneose` AS it
// closes a subscription that had not yet answered; thirty-odd readers deliver their list from `oneose`, and one of
// them (the member list) handed church A's members to the key enrolment after the console had moved to B.
// the church-tag rule the pool wrapper applies (audit of 5276297, HIGH 1) — its two helpers, out of the bundle
const POOL_RULE = fnBody(BUNDLE, 'function _taggedForAnotherChurch(e, cp) {', '_taggedForAnotherChurch') + '\n' + fnBody(BUNDLE, 'function _asksForOwnAuthorship(filters, cp) {', '_asksForOwnAuthorship');
test('the shipped pool wrapper: no handler runs after its caller has closed the subscription — a relay\'s CLOSED still does', async () => {
  const raw = [];
  const scope = new Proxy({ pool: {}, _poolSubMany: (u, f, h) => { const rec = { h, closed: false }; raw.push(rec); return { close() { rec.closed = true; Promise.resolve().then(() => { h.oneose && h.oneose(); h.onclose && h.onclose(['closed by caller']); }); } }; }, setTimeout },
    { has: () => true, get: (o, k) => (k === Symbol.unscopables ? undefined : (k in o ? o[k] : globalThis[k])), set: (o, k, v) => { o[k] = v; return true; } });
  new Function('scope', `with (scope) { ${POOL_RULE} ${fnBody(BUNDLE, 'pool.subscribeMany = (urls, filters, handlers)', 'the pool wrapper in the shipped bundle')} }`)(scope);
  const seen = [];
  const sub = scope.pool.subscribeMany([R1], [{}], { onevent: () => seen.push('event'), oneose: () => seen.push('eose'), onclose: () => seen.push('close') });
  sub.close();
  await flush();
  raw[0].h.onevent({}); raw[0].h.oneose();
  assert.deepEqual(seen, [], 'A SUBSCRIPTION\'S HANDLERS RAN AFTER ITS CALLER CLOSED IT — a screen that had moved to another church is handed the old church\'s list (audit of 3bc8905)');
  const sub2 = scope.pool.subscribeMany([R1], [{}], { oneose: () => seen.push('eose'), onclose: () => seen.push('close') });
  raw[1].h.oneose(); raw[1].h.onclose(['rate-limited']);   // the RELAY closed it: not the caller
  assert.deepEqual(seen, ['eose', 'close'], 'CONTROL: a relay\'s own CLOSED no longer reaches the handlers — _openKeyRead needs it');
  void sub2;
});

// A CHURCH'S OWN READ NEVER RETURNS WHAT THIS CONSOLE WROTE FOR ANOTHER CHURCH (audit of 5276297, HIGH 1). Acting for B
// the console signs with A's key and tags ['church', B]; A's readers ask for `authors: [A]`, so it all came back.
test('the shipped pool wrapper: a read of the church\'s own authorship drops a document tagged for ANOTHER church — and only that', async () => {
  const raw = [];
  const scope = new Proxy({ pool: {}, pub: A.pub, _poolSubMany: (u, f, h) => { raw.push({ f, h }); return { close() {} }; }, _poolQuerySync: (u, f) => Promise.resolve(raw.qs || []), setTimeout },
    { has: () => true, get: (o, k) => (k === Symbol.unscopables ? undefined : (k in o ? o[k] : globalThis[k])), set: (o, k, v) => { o[k] = v; return true; } });
  new Function('scope', `with (scope) { ${POOL_RULE} ${fnBody(BUNDLE, 'pool.subscribeMany = (urls, filters, handlers)', 'the pool wrapper in the shipped bundle')}
    ${fnBody(BUNDLE, 'pool.querySync = (urls, filter, opts)', 'the querySync wrapper in the shipped bundle')} }`)(scope);
  const forB = { pubkey: A.pub, kind: 30078, tags: [['d', 'trinityone/group:x'], ['church', B.pub]] };
  const ownUntagged = { pubkey: A.pub, kind: 30078, tags: [['d', 'trinityone/group:y']] };
  const ownTagged = { pubkey: A.pub, kind: 30078, tags: [['d', 'trinityone/group:z'], ['church', A.pub]] };
  const got = [];
  scope.pool.subscribeMany([R1], [{ kinds: [30078], authors: [A.pub], '#t': ['trinityone'] }, { kinds: [30078], '#church': [A.pub] }], { onevent: (e) => got.push(e) });
  for (const e of [forB, ownUntagged, ownTagged]) raw[0].h.onevent(e);
  assert.ok(!got.includes(forB), 'A DOCUMENT THE CONSOLE WROTE FOR CHURCH B CAME BACK IN CHURCH A\'S OWN READ — B\'s room on A\'s list, and its key re-published to A\'s people');
  assert.ok(got.includes(ownUntagged) && got.includes(ownTagged), 'CONTROL: the church\'s own documents were dropped too');
  const other = [];
  scope.pool.subscribeMany([R1], [{ kinds: [30078], '#t': ['trinityone'] }], { onevent: (e) => other.push(e) });
  raw[1].h.onevent(forB);
  assert.deepEqual(other, [forB], 'CONTROL: a read that does not ask for the church\'s own authorship was filtered too');
  raw.qs = [forB, ownUntagged];
  const q = await scope.pool.querySync([R1], { kinds: [30078], authors: [A.pub] });
  assert.deepEqual(q, [ownUntagged], 'a one-shot read of the church\'s own authorship returned what the console wrote for B');
});

test('a list is stamped with the church it was fetched for — after a switch, the old church\'s list is not current', async () => {
  for (const [method, d] of [['subscribeBlocked', 'trinityone/blocked:'], ['subscribeStewards', 'trinityone/stewards:']]) {
    const e = engine();
    let got = null;
    e.S[method]((list) => { got = list; });
    const rec = e.subs.at(-1);
    rec.handlers.onevent({ pubkey: A.pub, created_at: 100, kind: 30078, tags: [['d', d + A.pub]], content: JSON.stringify({ pubkeys: [M1.pub] }) });
    assert.deepEqual([...got], [M1.pub], `CONTROL: ${method} delivered A's list`);
    assert.equal(e.S.listIsCurrent(got), true, `${method}: a list fetched for the church we are on is not current`);
    e.S.setActiveIdentity(B.pub);
    assert.equal(e.S.listIsCurrent(got), false, `${method}: CHURCH A'S LIST IS STILL "CURRENT" AFTER THE SWITCH TO B — the enrolment would wrap B's keys to A's people`);
    rec.handlers.oneose();                                 // a late answer from A's stream (before React closed it)
    assert.equal(e.S.listIsCurrent(got), false, `${method}: a late delivery from A's stream became current in B`);
    e.S[method]((list) => { got = list; }); e.subs.at(-1).handlers.oneose();
    assert.equal(e.S.listIsCurrent(got), true, `${method}: CONTROL — B's own stream delivers a current list`);
  }
  const e = engine();
  assert.equal(e.S.listIsCurrent([]), false, 'an unstamped list (a cache, a hook\'s initial value) counts as current');
  assert.equal(e.S.listIsCurrent(null), false);
  // …and a list from before a reset is not current even for the SAME church: the reset (here, re-entering A)
  // starts a new epoch, and the lists are re-read with the state they are paired with
  let got = null;
  e.S.subscribeBlocked((list) => { got = list; });
  e.subs.at(-1).handlers.oneose();
  assert.equal(e.S.listIsCurrent(got), true, 'CONTROL: A\'s list is current in A');
  e.S.setActiveIdentity(A.pub);
  assert.equal(e.S.listIsCurrent(got), false, 'a list from before the reset is still "current" after re-entering the same church');
});

// THE NAME-KEY LOCK: the church is fixed when the call is made, not when it gets the lock. The audit's four rows.
const RING_NB = ['b1'.repeat(32)];
const MB = K();
const onAName = (e) => { e.t._nameKeyChecked = true; e.t._nameKeyRing = RING_A.slice(); e.t._nameKeyDocKeys = { [A.pub]: 'x', [M1.pub]: 'x', [M2.pub]: 'x' }; };
const deliverB = async (e) => {   // B's own envelope arrives on B's read: wrapped to B, to this console (A), and B's member MB
  e.S.subscribeNameKey();
  const s1 = e.subs.at(-1);
  s1.handlers.onevent(envelope(NAMEKEY_D, B, B.pub, RING_NB, [B.pub, A.pub, MB.pub]));
  await e.eose(s1);
};
const forB = (e) => e.published.filter(ev => dtag(ev) === NAMEKEY_D + B.pub).map(ev => Object.keys(JSON.parse(ev.content).keys));

test('lock: a Block QUEUED behind a member-join publish, with a switch to B before it gets the lock, touches nothing of B and says it failed', async () => {
  const e = engine(); onAName(e);
  const g = holdSeal(e);
  const grow = e.S.ensureNameKeyForMembers([M1.pub, M2.pub, M3.pub], []);     // a member joined A: holds the lock, sealing
  await flush();
  const blk = e.S.ensureNameKeyForMembers([M1.pub], [], { rotate: true });     // block() in A, queued
  await flush();
  assert.equal(e.S.setActiveIdentity(B.pub), true);
  await deliverB(e);
  g.release();
  await grow; const rb = await blk;
  for (const recips of forB(e)) {
    assert.ok(!recips.includes(M1.pub) && !recips.includes(M2.pub), 'CHURCH B\'S NAME KEY WAS PUBLISHED WRAPPED TO CHURCH A\'S MEMBERS by a call queued across the switch (audit of 3bc8905)');
    assert.ok(recips.includes(MB.pub), 'church B\'s own member was dropped from B\'s name envelope');
  }
  assert.equal(forB(e).length, 0, 'a call made for church A published church B\'s name envelope at all');
  assert.equal(rb, false, 'the queued Block\'s rotation never ran, and it did not say so (block() warns on false and null)');
});

test('lock: a member-join QUEUED behind a Block, with a switch to B while the Block seals, wraps nothing of B to A\'s members', async () => {
  const e = engine(); onAName(e);
  const g = holdSeal(e);
  const blk = e.S.ensureNameKeyForMembers([M1.pub], [], { rotate: true });
  await flush();
  const grow = e.S.ensureNameKeyForMembers([M1.pub, M2.pub], []);
  await flush();
  assert.equal(e.S.setActiveIdentity(B.pub), true);
  await deliverB(e);
  g.release();
  const rb = await blk; await grow;
  assert.equal(forB(e).length, 0, 'CHURCH B\'S NAME KEY WAS PUBLISHED by calls made for church A');
  assert.equal(rb, false, 'the Block interrupted by the switch did not report failure');
});

test('lock: CONTROL — with no switch, the queued Block runs for A and leaves the blocked member out', async () => {
  const e = engine(); onAName(e);
  const g = holdSeal(e);
  const grow = e.S.ensureNameKeyForMembers([M1.pub, M2.pub], []);
  await flush();
  const blk = e.S.ensureNameKeyForMembers([M1.pub], [], { rotate: true });
  g.release();
  await grow; const rb = await blk;
  assert.ok(rb && rb !== true ? true : rb, 'CONTROL: the Block rotation did not publish');
  const rot = e.published.filter(ev => dtag(ev) === NAMEKEY_D + A.pub).at(-1);
  assert.ok(rot && !Object.keys(JSON.parse(rot.content).keys).includes(M2.pub), 'CONTROL: the rotation for A still wraps the key to the blocked member');
});

test('a Block when the church has NO name key yet is not reported as a failure (there is nothing to take away)', async () => {
  const e = engine(); e.t._nameKeyChecked = true;          // read; no envelope; no ring
  const r = await e.S.ensureNameKeyForMembers([M1.pub], [], { rotate: true });
  assert.ok(r !== null && r !== false, `a Block with no name key to rotate returned ${r} — block() would warn about a key that does not exist`);
  assert.equal(e.published.length, 0, 'a rotate with no ring published a fresh key');
});

// (c) THE MEDIA POST-PUBLISH CHECK IS NOT REDUNDANT: it is what keeps a REFUSAL that lands after a switch from
// being remembered, and announced, in the church the console moved to.
test('ensureMediaKeyForMembers: a refusal that lands after a switch is neither remembered nor announced in church B', async () => {
  const e = engine(); onA(e, 'media');
  const g = gate();
  e.t.publish = async (evt, opts) => { e.published.push(evt); await g.p; if (opts && typeof opts === 'object') { opts.refused = true; opts.reason = 'blocked: not a member or not permitted for this group'; } return false; };
  const run = e.S.ensureMediaKeyForMembers([M1.pub, M2.pub], []);
  for (let i = 0; i < 200 && !e.published.length; i++) await flush();
  e.S.setActiveIdentity(B.pub);
  g.release();
  await run;
  assert.equal(e.t._mediaKeyPushRefused, null, 'CHURCH A\'S REFUSAL WAS REMEMBERED AS CHURCH B\'S — B\'s console stops offering its own members the sermon key');
  assert.deepEqual(e.events.filter(x => x.type === 'steward-write-blocked'), [], 'a banner about church A\'s sermon key was raised while the console runs church B');
  const e2 = engine(); onA(e2, 'media');                    // CONTROL: no switch → the refusal is remembered and said once
  e2.t.publish = async (evt, opts) => { e2.published.push(evt); if (opts && typeof opts === 'object') { opts.refused = true; opts.reason = 'blocked: not a member or not permitted for this group'; } return false; };
  await e2.S.ensureMediaKeyForMembers([M1.pub, M2.pub], []);
  assert.ok(e2.t._mediaKeyPushRefused, 'CONTROL: a refusal with no switch was not remembered');
  assert.equal(e2.events.filter(x => x.type === 'steward-write-blocked').length, 1, 'CONTROL: a refusal with no switch was not said');
});

// (d) WHO IS HOLDING THE KEY BACK: a proved relay that is down keeps a church's first key from being minted, by
// design — so the screens that used to say "give it a moment" name it instead.
test('keyWaitNote names the relay a key read is still waiting on — and only for the church and read we are on', async () => {
  const e = engine(); e.t.relayList = [R1, R2];
  e.S.subscribeNameKey();
  const [r1] = e.subs.slice(-2);
  assert.equal(e.S.keyWaitNote('name'), 'relay.example and second.example aren’t answering', 'before any answer, both relays are named');
  await e.eose(r1);
  assert.equal(e.S.keyWaitNote('name'), 'second.example isn’t answering', 'THE RELAY HOLDING THE NAME KEY BACK IS NOT NAMED — the steward is told only to wait, for as long as it stays down');
  assert.equal(e.S.keyWaitNote('care'), '', 'a read that was never opened names a relay');
  e.S.setActiveIdentity(B.pub);
  assert.equal(e.S.keyWaitNote('name'), '', 'church A\'s read names a relay while the console runs church B');
  const e2 = engine(); e2.t.relayList = [R1, R2];
  e2.S.subscribeCareKey();
  for (const r of e2.subs.slice(-2)) await e2.eose(r);
  assert.equal(e2.t._careKeyChecked, true, 'CONTROL: both relays answered');
  assert.equal(e2.S.keyWaitNote('care'), '', 'a settled read still names a relay');
});

test('mediaEncryptor: the "can’t encrypt yet" refusal names the relay that is not answering', async () => {
  const e = engine(); e.t.relayList = [R1, R2];
  e.S.subscribeMediaKey();
  await e.eose(e.subs.slice(-2)[0]);                        // R1 answered; R2 never does
  await assert.rejects(e.S.mediaEncryptor([M1.pub]), /second\.example isn’t answering/, 'the sermon upload is refused with "wait a moment" while a relay that is down holds back the church\'s first sermon key');
});
