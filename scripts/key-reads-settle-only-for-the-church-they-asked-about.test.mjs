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
    _careKeyHex: null, _careKeyRing: [], _careKeyDocKeys: null, _careKeyRev: 0, _careKeyChecked: false, _careKeyPending: [], _careKeyVer: 0, _careKeyAt: 0,   // _careKeyAt: round 3d
    _careRoster: new Set(), _CAREKEY_PENDING_TTL: 12000,
    _mediaKeyHex: null, _mediaKeyRing: [], _mediaKeyDocKeys: null, _mediaKeyChecked: false, _mediaKeyPushRefused: null, _mediaKeyVer: 0,
    _careKeyFresh: false, _careKeyMine: false, _mediaKeyFresh: false, _mediaKeyMine: false, _mediaKeyAt: 0,   // round 3a (b)
    _nameKeyRing: [], _nameKeyDocKeys: null, _nameKeyChecked: false, _nameKeyAt: 0, _nameKeyBusy: null,
    _localBlocked: new Set(), _localBlockedAt: 0, _setBlockedSeq: 0, toPubHex: (p) => p, _myOwnPub: () => A.pub,
    // login state: `authed` for the whole set (the mint gates' _isRelayAuthed); per relay, the relay's OK
    authed: true, refused: new Set(), _isRelayAuthed: () => t.authed,
    _keyReadAuthedOn: (url) => t.authed && !t.refused.has(url),
    relayList: [R1], relays: () => t.relayList.slice(), normalizeURL2: (u) => u,
    up: new Set(),          // relays whose socket is already connected (→ the read passes maxWait)
    clock: 1000000, Date: { now: () => t.clock },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    now: () => 1759300000, _CLOCK_SKEW: 600,
    decrypt3: (c, k) => nip44.v2.decrypt(c, k), encrypt2: (p, k) => nip44.v2.encrypt(p, k), getConversationKey: ck,
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
    BLOCKED_D: 'trinityone/blocked:', STEWARDS_D: 'trinityone/stewards:',
    JOINPOLICY_D: 'trinityone/joinpolicy:', ADMITTED_D: 'trinityone/admitted:', GROUP_D: 'trinityone/group:', GROUPKEY_D: 'trinityone/groupkey:',
    GROUP_RING_MAX: 50, _memberEmitters: new Set(), _byChurch: (e) => e.pubkey === t.pub, _openChurchDoc: () => null,
    // what the REAL setActiveIdentity touches besides the key state (lifted below)
    stewardedChurches: new Map([[B.pub, { name: 'B' }]]), netKeys: () => [],
    // remembers what it is given: the console keeps each church's last genuine blocklist (2026-10-02)
    localStorage: { _m: new Map(), setItem(k, v) { this._m.set(k, String(v)); }, getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      removeItem(k) { this._m.delete(k); }, get length() { return this._m.size; }, key(i) { return [...this._m.keys()][i] ?? null; } }, ACTIVE_ID_KEY: 'k',   // removeItem/length/key: round 3d (LOW 3)
    _loadBoxHosts() {}, _refreshBoxHostsUs() {}, _gate: { refresh() {} }, relaysRaw: () => [],
    lastProfile: {}, _profileLoaded: false, _clearanceSent: new Map(), _careRosterKnown: false, _careRosterSeen: false,
    _stewardCaps: {}, _stewardNames: {}, _stewardNamesCt: '', _stewardSince: {}, _applyNoPhotoList() {},
    CAP_KEYS: { finance: { d: 'trinityone/financekey:', cap: 'finance', legacy: false, explicit: false } },
    _capState: { finance: { ring: [], docKeys: null, rev: 1, at: 0, checked: false } },
    churchSkHeld: () => !!t.churchSk, _capAllows: () => () => true, _warnUnsealed() {}, _sealEachFailed: [], _legacyBookKeyHex: () => '', _capRingChanged() {},
    _checkinMigrated: '', _ckKeysSettled: '', _ckSessionKeys: new Map(), _latestGuardNotice: new Map(), npubEncode: (p) => 'npub' + p, _minorsLastClear: () => {},
    _clearedTrail: null, _authedRelays: new Map(), _authAccepted: new Map(),   // …and what _resetChurchScopedState touches
    // …and setKey (a church unlocked, or the console reloaded): the seed words stand for a church here; the bundle's
    // own name for getPublicKey is read off the shipped body, not guessed
    privateKeyFromSeedWords: (m) => (m === 'B' ? B.sk : A.sk), [(BUNDLE.match(/pub = (getPublicKey\d*)\(sk\);/) || [])[1] || 'getPublicKey']: getPublicKey,
    currentMnemonic: null, _migrateNetKeysToSealed() {},
    _requireTrustedView() {}, _publishToRelays: async () => true, _monotonic: (x) => x,
    _stewardRosterChanged() {},   // subscribeStewards' hook for the Members list (finding 29) — not what this file reads
    [(BUNDLE.match(/_publishToRelays\((finalizeEvent\d*)\(_monotonic\(\{ kind: 30078, created_at: now\(\), tags: \[\["d", BLOCKED_D/) || [])[1] || 'finalizeEvent']: (x) => x,
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
    // the per-church blocklist the console keeps (audit of 5276297, HIGH 2)
    fnBody(BUNDLE, 'function lsGet(k) {'), fnBody(BUNDLE, 'function lsSet(k, v) {'),
    stmt(BUNDLE, 'var BLOCKED_LAST_LS = '),
    fnBody(BUNDLE, 'function _blockedLastSet(cp) {'), fnBody(BUNDLE, 'function _noteBlockedList(cp, epoch, list, at) {'),
    't.__noteBlockedList = _noteBlockedList;',
    fnBody(BUNDLE, 'function setKey(mnemonic) {'), 't.__setKey = setKey;',   // a church unlocked / a reload: where a church starts
    fnBody(BUNDLE, 'function _landed(what, p) {'),                               // …and a Block made here (setBlocked, below)
    't.__runAuthWaiters = _runKeyReadAuthWaiters;',
    't.__resetChurchScopedState = _resetChurchScopedState;',
    't.__authWaiters = _keyReadAuthWaiters;',                                    // the login waiters a read leaves behind (audit of 637bc0c)
    // round 2 of the room-key reconcile: a room's envelope state, its drop memo, and the ex-steward record (P4)
    stmt(BUNDLE, 'var _skeys = '), stmt(BUNDLE, 'var _srev = '), stmt(BUNDLE, 'var _senvTs = '), stmt(BUNDLE, 'var _senvRecips = '),
    stmt(BUNDLE, 'var _senvMine = '), stmt(BUNDLE, 'var _senvDropped = '),
    stmt(BUNDLE, 'var KEYENV_LS = '), fnBody(BUNDLE, 'function _keyEnvSave(kind, cp, e, selfKey, mineCt) {'), fnBody(BUNDLE, 'function _keyEnvRestore(kind, cp, d) {'),   // round 3c, MED 2
    stmt(BUNDLE, 'var PENDINGROT_LS = '), fnBody(BUNDLE, 'function _pendingRotAll(cp) {'), fnBody(BUNDLE, 'function _pendingRotAdd(kind, cp, drop, why) {'), fnBody(BUNDLE, 'function _pendingRotClear(kind, cp) {'),   // round 3e, MED 1 (_runPendingRotations itself comes with liftKeyRead)
    stmt(BUNDLE, 'var _senvPending = '), fnBody(BUNDLE, 'function _reCheckGroupKeyPending() {'), 't.__reCheckGk = _reCheckGroupKeyPending; t.__senvPending = _senvPending; t.__gkChain = _gkChain; t.__membersReask = _membersReask;',
    fnBody(BUNDLE, 'function _noteEnvelopeDrops(gid, prev, next) {'), fnBody(BUNDLE, 'function stewIngestKey(e) {'),
    't.__ingest = stewIngestKey; t.__skeys = _skeys; t.__senvMine = _senvMine; t.__senvRecips = _senvRecips;',
    stmt(BUNDLE, 'var _exStewardsKey = '), fnBody(BUNDLE, 'function _exStewardSet() {'),
    stmt(BUNDLE, 'var _exStewardsAtKey = '), fnBody(BUNDLE, 'function _exStewardRemovedAt() {'),
    fnBody(BUNDLE, 'function _rememberExStewards(before, after, at) {'), 't.__rememberEx = _rememberExStewards;',
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
    M('    listIsCurrent(list) {'), M('    keyWaitNote(kind) {'), M('    setBlocked(pubkeys) {'),
    M('    subscribeJoinPolicy(onPolicy) {'), M('    subscribeAdmitted(onList) {'),
    M('    listIsFresh(list, since) {'), M('    groupFresh(list, groupId, since) {'), M('    joinPolicyFresh(since) {'),
    M('    groupKeyRecipients(groupId) {'), M('    groupKeyDropped(groupId) {'), M('    groupKeyMissing(groupId, pubs) {'),
    M('    async publishGroupKey(groupId, memberPubs, opts = {}) {'), M('    async ensureGroupKeys(groups, memberPubs) {'),
    M('    async sealGroup(group, memberPubs) {'),   // round 3c, LOW ii
    M('    subscribeMembers(onMembers) {'),           // round 3d, LOW 2
    M('    rememberRotation(kind, drop, why) {'), M('    retryPendingRotations() {'),   // round 3f
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

// A RELAY THAT ANSWERED BEFORE ITS LOGIN WAS ACCEPTED IS ASKED AGAIN, WHATEVER ORDER THE OTHERS ANSWER IN (audit of
// 29d4941/51d6ebf). The "ask again on login" waiter was registered only once the LAST relay had answered, so with two
// healthy relays — the first answering before its login was accepted, that login accepted before the second answered —
// nothing ever asked again: the read never settled, and no member was keyed. (The browser row:
// a-blocklist-held-by-one-of-two-relays.test.mjs.)
for (const [kind, method] of [...KINDS, ['blocked', 'subscribeBlocked']]) {
  test(`${kind}: two healthy relays — one answers before its login is accepted, the login lands, then the other answers: the read is asked again and settles`, async () => {
    const e = engine(); e.t.relayList = [R1, R2]; e.t.up = new Set([R1, R2]); e.t.refused = new Set([R1]);   // R1's login not accepted yet
    let got = null;
    if (kind === 'blocked') e.S.subscribeBlocked((list) => { got = list; }); else e.S[method]();
    const reads = () => (kind === 'blocked' ? e.subs.filter(r => r.d === 'trinityone/blocked:' + A.pub) : e.subs);
    const [r1, r2] = reads();
    assert.deepEqual([r1.url, r2.url], [R1, R2], 're-anchor: the read is no longer opened per relay');
    await e.eose(r1);                                       // R1 answers — before its login was accepted
    e.t.refused = new Set(); e.t.__runAuthWaiters();        // R1's login is accepted…
    await e.eose(r2);                                       // …and only then does R2 answer
    const again = reads().slice(-2);
    assert.notEqual(again[0], r1, `THE ${kind.toUpperCase()} READ WAS NEVER ASKED AGAIN — the relay that answered before its login was accepted held it for good, on two healthy relays (audit of 29d4941/51d6ebf)`);
    await e.eose(again[0]); await e.eose(again[1]);
    if (kind === 'blocked') assert.ok(got && e.S.listIsCurrent(got), 'CONTROL: both relays re-answered genuinely and the blocklist is not current');
    else assert.equal(checked(e.t, kind), true, 'CONTROL: both relays re-answered genuinely and the gate is still shut');
  });
}

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
  if (kind === 'care') { e.t._careKeyChecked = true; e.t._careKeyHex = RING_A[0]; e.t._careKeyRing = RING_A.slice(); e.t._careKeyDocKeys = { [A.pub]: 'x', [M1.pub]: 'x', [M2.pub]: 'x' }; e.t._careKeyRev = 1; e.t._careKeyFresh = true; e.t._careKeyMine = true; }   // fresh + ours: round 3a (b)
  if (kind === 'media') { e.t._mediaKeyChecked = true; e.t._mediaKeyHex = RING_A[0]; e.t._mediaKeyRing = RING_A.slice(); e.t._mediaKeyDocKeys = { [A.pub]: 'x', [M1.pub]: 'x' }; e.t._mediaKeyFresh = true; e.t._mediaKeyMine = true; }
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
    const rec = e.subs.at(-1);               // (for the blocklist: its narrow, genuine-answer read — see the row below)
    rec.handlers.onevent({ pubkey: A.pub, created_at: 100, kind: 30078, tags: [['d', d + A.pub]], content: JSON.stringify({ pubkeys: [M1.pub] }) });
    if (method === 'subscribeBlocked') await e.eose(rec);   // the blocklist counts only on a settled genuine answer (HIGH 2)
    assert.deepEqual([...got], [M1.pub], `CONTROL: ${method} delivered A's list`);
    assert.equal(e.S.listIsCurrent(got), true, `${method}: a list fetched for the church we are on is not current`);
    e.S.setActiveIdentity(B.pub);
    assert.equal(e.S.listIsCurrent(got), false, `${method}: CHURCH A'S LIST IS STILL "CURRENT" AFTER THE SWITCH TO B — the enrolment would wrap B's keys to A's people`);
    rec.handlers.oneose();                                 // a late answer from A's stream (before React closed it)
    assert.equal(e.S.listIsCurrent(got), false, `${method}: a late delivery from A's stream became current in B`);
    e.S[method]((list) => { got = list; }); await e.eose(e.subs.at(-1));
    assert.equal(e.S.listIsCurrent(got), true, `${method}: CONTROL — B's own stream delivers a current list`);
  }
  const e = engine();
  assert.equal(e.S.listIsCurrent([]), false, 'an unstamped list (a cache, a hook\'s initial value) counts as current');
  assert.equal(e.S.listIsCurrent(null), false);
  // …and a list from before a reset is not current even for the SAME church: the reset (here, re-entering A)
  // starts a new epoch, and the lists are re-read with the state they are paired with
  let got = null;
  e.S.subscribeBlocked((list) => { got = list; });
  await e.eose(e.subs.at(-1));
  assert.equal(e.S.listIsCurrent(got), true, 'CONTROL: A\'s list is current in A');
  e.S.setActiveIdentity(A.pub);
  assert.equal(e.S.listIsCurrent(got), false, 'a list from before the reset is still "current" after re-entering the same church');
});

// THE CHURCH TERM OF listIsCurrent (audit of 5276297: no test failed with it removed). A key RESTORE changes the church
// without a switch — the stamp's epoch may still match — and a list fetched for the old key must not count.
test('a list fetched for one church is not current once the church changes WITHOUT a new epoch (a key restore)', async () => {
  const e = engine();
  let got = null;
  e.S.subscribeStewards((list) => { got = list; });
  // the roster STREAM (no d-tag in its filter) — since round 2 a narrow fresh read of the roster opens beside it
  e.subs.find(r => !r.d).handlers.oneose();
  assert.equal(e.S.listIsCurrent(got), true, 'CONTROL: the list is current for the church it was fetched for');
  e.t.pub = B.pub; e.t.churchPub = B.pub;                   // the church key replaced; no switch, no new epoch
  assert.equal(e.S.listIsCurrent(got), false, 'A LIST FETCHED FOR THE OLD CHURCH IS "CURRENT" AFTER A KEY RESTORE — the enrolment would wrap the new church\'s keys to the old one\'s people');
});

// THE BLOCKLIST COUNTS ONLY ON A GENUINE ANSWER (audit of 5276297, HIGH 2). On a slow link nostr-tools' own EOSE timer
// answered the blocklist's stream first, with nothing in it, stamped current — and the keys went to the member the owner
// had blocked. The stream still feeds the screens; the stamp waits for the narrow read of the blocklist document.
test('the blocklist is the church\'s current list only once its narrow read has settled with a genuine answer — not on the stream\'s (timer) EOSE', async () => {
  const e = engine();
  let got = null;
  e.S.subscribeBlocked((list) => { got = list; });
  const narrow = e.subs.find(r => r.d === 'trinityone/blocked:' + A.pub), stream = e.subs.find(r => r !== narrow);
  assert.ok(narrow && stream, 're-anchor: subscribeBlocked no longer opens a stream AND a narrow read of the blocklist document');
  stream.handlers.oneose();                                   // nostr-tools' 4.4 s timer, on a stream that has said nothing
  await flush();
  assert.ok(got && got.length === 0, 'CONTROL: the stream\'s (empty) answer still reaches the screens');
  assert.equal(e.S.listIsCurrent(got), false, 'THE STREAM\'S TIMER ANSWER — NO BLOCKLIST IN IT — COUNTS AS THE CHURCH\'S LIST: the enrolment wraps the keys to the blocked (audit of 5276297, HIGH 2)');
  narrow.handlers.onevent({ pubkey: A.pub, created_at: 100, kind: 30078, tags: [['d', 'trinityone/blocked:' + A.pub]], content: JSON.stringify({ pubkeys: [M1.pub] }) });
  assert.equal(e.S.listIsCurrent(got), false, 'a list counted as current before its read had settled');
  await e.eose(narrow);                                       // the relay's own answer, authenticated, in time
  assert.deepEqual([...got], [M1.pub], 'the settled read did not deliver the blocklist');
  assert.equal(e.S.listIsCurrent(got), true, 'the GENUINE answer does not count — the enrolment would wait for ever');
  assert.ok(e.t._localBlocked.has(M1.pub), 'the genuine blocklist did not become the console\'s locally-known one');
  assert.deepEqual(JSON.parse(e.t.localStorage.getItem('trinityone.steward.blockedlast.' + A.pub)), [M1.pub], 'the genuine blocklist was not kept on the device for the next start');
});
test('…and the device\'s copy is where a church starts: the switch seeds it, and an OLDER relay list never undoes a newer Block', async () => {
  { // a RELOAD (setKey): the church starts from its own last genuine blocklist, before its relay has said a word
    const e0 = engine();
    e0.t.localStorage.setItem('trinityone.steward.blockedlast.' + B.pub, JSON.stringify([M2.pub]));
    e0.t.__setKey('B');
    assert.equal(e0.t.pub, B.pub, 'CONTROL: setKey did not make B the church');
    assert.ok(e0.t._localBlocked.has(M2.pub), 'AFTER A RELOAD THE CONSOLE FORGOT WHOM THE CHURCH BLOCKED — until the relay answers, the key builders would wrap to them (audit of 5276297, HIGH 2)');
  }
  { // a KEY RESTORE (_resetChurchScopedState, after the new key is set): the same
    const e1 = engine();
    e1.t.localStorage.setItem('trinityone.steward.blockedlast.' + A.pub, JSON.stringify([M2.pub]));
    e1.t.__resetChurchScopedState();
    assert.ok(e1.t._localBlocked.has(M2.pub), 'after a key restore the console forgot whom the church blocked');
  }
  const e = engine();
  e.t.localStorage.setItem('trinityone.steward.blockedlast.' + B.pub, JSON.stringify([M2.pub]));
  e.S.setActiveIdentity(B.pub);
  assert.ok(e.t._localBlocked.has(M2.pub), 'church B did not start from its own last genuine blocklist — before B\'s relay answers, B\'s keys would go to the member B blocked');
  assert.ok(!e.t._localBlocked.has(M1.pub), 'CONTROL: B started with another church\'s blocklist');
  e.t._localBlockedAt = 2000;                                // a Block made on this console at t=2000
  e.t.__noteBlockedList(B.pub, e.t._keyReadEpoch, [], 1000);    // a relay copy from BEFORE it
  assert.ok(e.t._localBlocked.has(M2.pub), 'an OLDER relay blocklist undid a newer Block made on this console');
  e.t.__noteBlockedList(B.pub, e.t._keyReadEpoch, [], 3000);    // the owner unblocked since (a newer list)
  assert.equal(e.t._localBlocked.size, 0, 'CONTROL: a NEWER genuine blocklist no longer replaces the one the console holds');
  // a Block made on this console is kept on the device at once — before the relay has echoed it. THE OWNER'S: this
  // used to be asserted through `e` above, which is acting for church B on A's key — a DELEGATE — and a delegate's Block
  // is refused (the relay will not take it), so the engine no longer remembers it (sim finding 28). The owner is the
  // engine whose own key is the church.
  const own = engine();
  await own.S.setBlocked([M1.pub]);
  assert.deepEqual(JSON.parse(own.t.localStorage.getItem('trinityone.steward.blockedlast.' + A.pub)), [M1.pub], 'a Block made here was not kept for the next start — a reload before the relay answers would wrap the keys to them');
  // …and the delegate's is refused WITHOUT being remembered: the church blocked nobody, so this console must not either
  assert.ok(e.t.actingChurch, 'CONTROL: the engine above is not acting for another church, so the next row proves nothing');
  const before = e.t.localStorage.getItem('trinityone.steward.blockedlast.' + B.pub);
  assert.equal(await e.S.setBlocked([M1.pub]), false, 'a delegate’s Block did not answer false');
  assert.equal(e.t.localStorage.getItem('trinityone.steward.blockedlast.' + B.pub), before, 'A REFUSED DELEGATE BLOCK WAS REMEMBERED ON THE DEVICE — it is kept across reloads and the person is left out of every key list');
  assert.ok(!e.t._localBlocked.has(M1.pub), 'a refused delegate Block was added to the console’s own blocked set');});

// A RELAY THAT IS DOWN DOES NOT HOLD THE BLOCKLIST (audit of 831dcea). "A genuine answer from every relay" waited for a
// relay that was down — for up to 30 days — and no new member was keyed. The list is current once every CONNECTED relay
// has answered genuinely and at least one has; when a failed relay was left out, the device's copy is the floor — in
// who may be given keys (`_localBlocked`), the device copy AND the list the screens get and write back (the owner's rule,
// 2026-10-02: someone this console remembers as blocked stays blocked). (The browser rows: a-relay-that-is-down-does-
// not-hold-back-new-members-keys.test.mjs, a-blocklist-held-by-one-of-two-relays.test.mjs and
// a-blocked-member-this-console-remembers-stays-blocked.test.mjs.)
const blockedReads = (e) => e.subs.filter(r => r.d === 'trinityone/blocked:' + A.pub);
const blockedDoc = (list, at = 100) => ({ pubkey: A.pub, created_at: at, kind: 30078, tags: [['d', 'trinityone/blocked:' + A.pub]], content: JSON.stringify({ pubkeys: list }) });
test('the blocklist: a relay whose connection FAILED does not hold it — the connected relay\'s genuine answer counts, with the device\'s copy as the floor', async () => {
  { // CONTROL: no relay connected, none answered genuinely — "at least one" keeps it shut
    const e = engine(); e.t.relayList = [R1, R2];
    let got = null; e.S.subscribeBlocked((list) => { got = list; });
    for (const r of blockedReads(e)) await e.closedByRelay(r, 'connection failure: relay unreachable');
    assert.ok(!got || !e.S.listIsCurrent(got), 'a blocklist nobody answered for counted as the church\'s');
  }
  const e = engine(); e.t.relayList = [R1, R2]; e.t.up = new Set([R1]);   // R1 connected; R2's dial fails
  e.t.localStorage.setItem('trinityone.steward.blockedlast.' + A.pub, JSON.stringify([M2.pub]));   // a Block this console made
  let got = null; e.S.subscribeBlocked((list) => { got = list; });
  const [r1, r2] = blockedReads(e);
  assert.deepEqual([r1.url, r2.url], [R1, R2], 're-anchor: the blocklist read is no longer opened per relay');
  await e.closedByRelay(r2, 'connection failure: relay unreachable');      // nostr-tools: connect fails → handleClose
  r1.handlers.onevent(blockedDoc([M1.pub]));                               // R1's copy does not have M2
  await e.eose(r1);
  assert.ok(got && e.S.listIsCurrent(got), 'A RELAY THAT IS DOWN HELD THE BLOCKLIST BACK — no new member is keyed while it stays down (audit of 831dcea)');
  assert.deepEqual([...got].sort(), [M1.pub, M2.pub].sort(), 'THE SCREENS DO NOT SEE THE FLOOR — the Members screen would not show M2 as blocked, and its Block, its Unblock and the re-seat write that list back whole, dropping M2 church-wide (the owner\'s rule, 2026-10-02)');
  assert.ok(e.t._localBlocked.has(M1.pub) && e.t._localBlocked.has(M2.pub), 'THE DEVICE\'S BLOCKLIST WAS NOT THE FLOOR FOR WHO MAY BE KEYED (`_localBlocked`) — a relay copy without the Block undid it while the relay holding it was down');
  assert.deepEqual(JSON.parse(e.t.localStorage.getItem('trinityone.steward.blockedlast.' + A.pub)).sort(), [M1.pub, M2.pub].sort(), 'the device copy shrank on an answer with a relay missing');
});
test('…but a CONNECTED relay that has not answered genuinely still holds it — and every relay answering is the old rule, no floor', async () => {
  const e = engine(); e.t.relayList = [R1, R2]; e.t.up = new Set([R1, R2]);   // both connected; R2 is on a slow link
  e.t.localStorage.setItem('trinityone.steward.blockedlast.' + A.pub, JSON.stringify([M2.pub]));
  let got = null; e.S.subscribeBlocked((list) => { got = list; });
  const [r1, r2] = blockedReads(e);
  r1.handlers.onevent(blockedDoc([M1.pub]));
  await e.eose(r1);
  e.t.clock += 15000;                                                      // nostr-tools' timer (maxWait) answers for R2
  await e.eose(r2);
  assert.ok(!got || !e.S.listIsCurrent(got), 'A CONNECTED RELAY\'S TIMER ANSWER WAS LEFT OUT — the slow link\'s protection (audit of 5276297, HIGH 2) is gone');
  e.t.refused = new Set([R2]);                                             // …nor one whose login it has not accepted
  e.fireTimers();
  const [s1, s2] = blockedReads(e).slice(-2);
  s1.handlers.onevent(blockedDoc([M1.pub])); await e.eose(s1); await e.eose(s2);
  assert.ok(!got || !e.S.listIsCurrent(got), 'a connected relay that has not accepted our login was left out');
  e.t.refused = new Set(); e.t.__runAuthWaiters();
  const [t1, t2] = blockedReads(e).slice(-2);
  t1.handlers.onevent(blockedDoc([M1.pub])); await e.eose(t1); await e.eose(t2);
  assert.ok(got && e.S.listIsCurrent(got), 'CONTROL: both relays answered genuinely and the list is not current');
  assert.deepEqual([...got], [M1.pub], 'every relay answered, yet the device\'s copy was added — the floor is only for a relay that is down');
  assert.deepEqual(JSON.parse(e.t.localStorage.getItem('trinityone.steward.blockedlast.' + A.pub)), [M1.pub], 'CONTROL: the relays\' genuine list no longer replaces the device copy');
});

// THE OWNER'S RULE IN THE WRITE (2026-10-02; audit of ce15f92, HIGH): setBlocked replaced the list — and `_localBlocked` and
// the device copy — with whatever it was handed, so a screen list without someone this console holds as blocked
// published, newer and so church-wide, a blocklist without them, and the keys followed. Only `{ unblock }` takes anyone off.
test('setBlocked never drops someone this console holds as blocked — only an explicit unblock takes them off', async () => {
  const e = engine(); e.t.relayList = [R1, R2]; e.t.up = new Set([R1]);   // the floor, as in the row above
  e.t.localStorage.setItem('trinityone.steward.blockedlast.' + A.pub, JSON.stringify([M2.pub]));
  let got = null; e.S.subscribeBlocked((list) => { got = list; });
  const [r1, r2] = blockedReads(e);
  await e.closedByRelay(r2, 'connection failure: relay unreachable');
  r1.handlers.onevent(blockedDoc([M1.pub])); await e.eose(r1);
  assert.ok(e.t._localBlocked.has(M2.pub), 'CONTROL: the floor is not in force');
  const sent = []; e.t._publishToRelays = async (ev) => { sent.push(JSON.parse(ev.content).pubkeys); return true; };
  await e.S.setBlocked([M1.pub, M3.pub]);                                  // a Block of M3 from a list without M2
  assert.ok(sent.at(-1).includes(M2.pub) && sent.at(-1).includes(M3.pub), 'A BLOCK PUBLISHED A BLOCKLIST WITHOUT M2, whom this console holds as blocked — newer, so it wins church-wide (audit of ce15f92): ' + JSON.stringify(sent.at(-1)));
  assert.ok(e.t._localBlocked.has(M2.pub), 'the Block took M2 out of who may NOT be given keys');
  assert.ok(JSON.parse(e.t.localStorage.getItem('trinityone.steward.blockedlast.' + A.pub)).includes(M2.pub), 'the Block took M2 off the device copy');
  await e.S.setBlocked([M1.pub, M2.pub], { unblock: [M3.pub] });           // Unblock M3 — someone else
  assert.ok(sent.at(-1).includes(M2.pub) && !sent.at(-1).includes(M3.pub), 'unblocking someone else dropped M2, or kept M3: ' + JSON.stringify(sent.at(-1)));
  await e.S.setBlocked([M1.pub], { unblock: [M2.pub] });                   // CONTROL: the steward unblocks M2 explicitly
  assert.ok(!sent.at(-1).includes(M2.pub) && !e.t._localBlocked.has(M2.pub), 'CONTROL: an explicit unblock of M2 did not take M2 off');
});

// THE ROTATIONS LEAVE OUT THE BLOCKED THEMSELVES (audit of ce15f92). rotateCareKey and rotateMediaKey took their recipients
// from the caller (block()'s `remaining`) and filtered nothing, unlike every other key builder.
test('rotateCareKey and rotateMediaKey never wrap the new key to someone this console holds as blocked, whatever list they are handed', async () => {
  const e = engine();
  e.t._localBlocked = new Set([M2.pub]);
  e.t._careKeyHex = 'aa'.repeat(32); e.t._careKeyRing = ['aa'.repeat(32)]; e.t._careKeyChecked = true; e.t._careKeyRev = 1; e.t._careKeyFresh = true;   // read on this connection — round 3d: a rotation needs it
  e.t._mediaKeyHex = 'cc'.repeat(32); e.t._mediaKeyRing = ['cc'.repeat(32)]; e.t._mediaKeyChecked = true; e.t._mediaKeyFresh = true;   // read on this connection — round 3a (b)
  for (const [what, call, d] of [['care', () => e.S.rotateCareKey([M1.pub, M2.pub], []), CAREKEY_D], ['sermon', () => e.S.rotateMediaKey([M1.pub, M2.pub], []), MEDIAKEY_D]]) {
    const p0 = e.published.length;
    await call();
    const env = e.published.slice(p0).find(ev => dtag(ev) === d + A.pub);
    assert.ok(env, `CONTROL: no ${what} key rotation was published`);
    const to = Object.keys(JSON.parse(env.content).keys || {});
    assert.ok(to.includes(M1.pub), `CONTROL: the ${what} key rotation left out a member who is not blocked`);
    assert.ok(!to.includes(M2.pub), `THE ${what.toUpperCase()} KEY ROTATION WRAPPED THE NEW KEY TO M2, whom this console holds as blocked (audit of ce15f92)`);
  }
});

// A READ'S "ASK AGAIN ON LOGIN" LEAVES WITH IT (audit of 637bc0c, LOW): one was added per retry, and kept after a close or a
// settle until the next accepted login.
test('a key read holds one login waiter however often it retries, and none once it settles or closes', async () => {
  const e = engine(); e.t.relayList = [R1, R2]; e.t.up = new Set([R1, R2]); e.t.refused = new Set([R1]);   // R1's login not accepted
  const close = e.S.subscribeNameKey();
  const held = [];
  for (let i = 0; i < 5; i++) {
    if (i) { e.fireTimers(); await flush(); }               // the retry re-opens the read
    const [a, b] = e.subs.slice(-2);
    await e.eose(a);                                        // R1: genuine, before its login → waits on login
    await e.closedByRelay(b);                               // R2: a CLOSED → the read retries
    held.push(e.t.__authWaiters.size);
  }
  assert.deepEqual(held, [1, 1, 1, 1, 1], `A READ PILED UP LOGIN WAITERS — one per retry, each re-opening it on the next login (audit of 637bc0c): ${JSON.stringify(held)}`);
  close(); await flush();
  assert.equal(e.t.__authWaiters.size, 0, 'a CLOSED read kept its login waiter until the next accepted login');
  // …and a blocklist read that settles without the relay that answered before its login (its socket dropped)
  const e2 = engine(); e2.t.relayList = [R1, R2]; e2.t.up = new Set([R1, R2]); e2.t.refused = new Set([R1]);
  e2.S.subscribeBlocked(() => {});
  const [c, d] = blockedReads(e2);
  await e2.eose(c);
  assert.equal(e2.t.__authWaiters.size, 1, 'CONTROL: an answer before the login was accepted does not wait on the login');
  e2.t.up = new Set([R2]);                                  // R1's socket drops
  await e2.eose(d);                                         // R2 answers genuinely: the read settles without R1
  assert.equal(e2.t.__authWaiters.size, 0, 'a SETTLED read kept its login waiter — the next login re-opens a finished read');
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
  assert.equal(e.S.keyWaitNote('name'), '', 'A RELAY IS NAMED AS NOT ANSWERING BEFORE IT HAS HAD TIME TO — on a healthy relay, for the ~200 ms after an unlock (audit of 5276297)');
  await e.eose(r1);
  e.t.clock += 9000;                                        // …and now the read has waited long enough to say so
  assert.equal(e.S.keyWaitNote('name'), 'second.example isn’t answering', 'THE RELAY HOLDING THE NAME KEY BACK IS NOT NAMED — the steward is told only to wait, for as long as it stays down');
  { const e3 = engine(); e3.t.relayList = [R1, R2];
    e3.S.subscribeNameKey(); e3.t.clock += 9000;
    assert.equal(e3.S.keyWaitNote('name'), 'relay.example and second.example aren’t answering', 'a read that has waited with no answer at all does not name both relays'); }
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
  e.t.clock += 9000;                                        // (a relay is named only once the read has waited — see the row above)
  await assert.rejects(e.S.mediaEncryptor([M1.pub]), /second\.example isn’t answering/, 'the sermon upload is refused with "wait a moment" while a relay that is down holds back the church\'s first sermon key');
});

// ── ROUND 2 OF THE ROOM-KEY RECONCILE (audit of 78ffad0): THE LISTS THE KEY DISTRIBUTOR TRUSTS ARE FRESH ─────────────
// The distributor itself is driven in the-key-enrolment-waits-for-every-list.test.mjs; these rows run the ENGINE side,
// sliced out of the shipped bundle: who sets "fresh", who clears it, the drop memo, and the stale-ring refusal.
const JP_D = 'trinityone/joinpolicy:', AD_D = 'trinityone/admitted:', GK_D = 'trinityone/groupkey:', BL_D = 'trinityone/blocked:';
const doc30078 = (author, d, at, content, extra = []) => ({ pubkey: author, created_at: at, kind: 30078, tags: [['d', d], ['t', 'trinityone'], ...extra], content: JSON.stringify(content) });
const streamOf = (e) => e.subs.find(r => !r.d && !r.closed);

test('round 2 · finding 2: the join policy counts for the key distributor only on a GENUINE read — not the stream\'s timer "off"', async () => {
  const e = engine();
  const seen = [];
  e.S.subscribeJoinPolicy((v) => seen.push(v));
  const narrow = e.subs.find(r => r.d === JP_D + A.pub), stream = streamOf(e);
  assert.ok(narrow && stream, 're-anchor: subscribeJoinPolicy no longer opens a stream AND a narrow read of the policy document');
  stream.handlers.oneose(); await flush();                    // nostr-tools' 4.4 s timer fires before the document
  assert.equal(seen.at(-1), false, 'CONTROL: the screens still get the stream\'s answer');
  assert.equal(e.S.joinPolicyFresh(), null, 'THE STREAM\'S TIMER "approval is off" COUNTED AS THE CHURCH\'S POLICY — a member still waiting is keyed (audit of 78ffad0, finding 2)');
  narrow.handlers.onevent(doc30078(A.pub, JP_D + A.pub, 100, { approval: true }));
  assert.equal(e.S.joinPolicyFresh(), null, 'the policy counted before its read had settled');
  await e.eose(narrow);
  assert.equal(e.S.joinPolicyFresh(), true, 'CONTROL: the genuine answer — approval on — is not what the distributor reads');
  assert.ok(e.signals.includes('joinpolicy'), 'the distributor is not told the policy has been read, so nothing re-runs it');
  assert.equal(e.S.joinPolicyFresh(e.t.clock), null, 'a read that settled BEFORE `since` counted as a re-read after it');
});

test('round 2 · HIGH 1: a list from a subscription that has CLOSED is not fresh — the previous connection\'s blocklist cannot key anyone', async () => {
  const e = engine();
  let got = null;
  const close = e.S.subscribeBlocked((l) => { got = l; });
  await e.eose(e.subs.find(r => r.d === BL_D + A.pub));
  assert.equal(e.S.listIsFresh(got), true, 'CONTROL: a genuine read of the blocklist is not fresh');
  assert.equal(e.S.listIsCurrent(got), true, 'CONTROL: and current');
  close();                                                   // the reconnect: this subscription closes, the screen keeps its list
  assert.equal(e.S.listIsCurrent(got), true, 'CONTROL: still "current" — which is exactly the hole');
  assert.equal(e.S.listIsFresh(got), false, 'THE PREVIOUS CONNECTION\'S BLOCKLIST STILL COUNTS AS FRESH — the auditor\'s second console re-keys Bob (audit of 78ffad0, HIGH 1)');
});

test('round 2 · P2: an envelope that DROPS someone is remembered, and every fresh read is asked again at once', async () => {
  const e = engine();
  const MB = K(), BOB = K();
  let bl = null;
  e.S.subscribeBlocked((l) => { bl = l; });
  await e.eose(e.subs.find(r => r.d === BL_D + A.pub));
  const ring = [hex(generateSecretKey())];
  e.t.__ingest(envelope(GK_D, A, 'r1', ring, [A.pub, MB.pub, BOB.pub], 1759300000));
  assert.deepEqual(e.S.groupKeyDropped('r1'), [], 'CONTROL: the first envelope dropped nobody');
  assert.deepEqual([...e.S.groupKeyRecipients('r1')].sort(), [A.pub, MB.pub, BOB.pub].sort(), 'CONTROL: recipients');
  const narrowsBefore = e.subs.filter(r => r.d === BL_D + A.pub).length;
  e.t.clock += 1000;
  const dropAt = e.t.clock;
  e.t.__ingest(envelope(GK_D, A, 'r1', ring, [A.pub, MB.pub], 1759300100));
  const dropped = e.S.groupKeyDropped('r1');
  assert.deepEqual(dropped.map(x => x.pub), [BOB.pub], 'THE ROTATION\'S DROP WAS NOT REMEMBERED — the distributor would wrap the new key straight back');
  assert.equal(dropped[0].at, dropAt, 'the drop is not stamped with when it was seen');
  assert.ok(e.subs.filter(r => r.d === BL_D + A.pub).length > narrowsBefore, 'THE BLOCKLIST WAS NOT RE-READ after the drop — "has it been read since?" could never become true');
  assert.equal(e.S.listIsFresh(bl, dropAt), false, 'a blocklist read BEFORE the drop counts as read after it');
  e.t.clock += 10;
  await e.eose(e.subs.filter(r => r.d === BL_D + A.pub).at(-1));
  assert.equal(e.S.listIsFresh(bl, dropAt), true, 'CONTROL: the re-read, settled, does not count as after the drop');
  // the person comes back in a later envelope: no longer held
  e.t.__ingest(envelope(GK_D, A, 'r1', ring, [A.pub, MB.pub, BOB.pub], 1759300200));
  assert.deepEqual(e.S.groupKeyDropped('r1'), [], 'someone an envelope includes again is still held');
});

test('round 2 · A2: when the newest envelope has no copy this console can open, nothing is re-wrapped from the older ring', async () => {
  const e = engine();
  e.t.window.Steward = e.S;
  const MB = K(), M2 = K();
  const ring = [hex(generateSecretKey())];
  const env = (recips, at) => envelope(GK_D, A, 'r2', ring, recips, at);
  e.t.__ingest(env([A.pub, MB.pub], 1759300000));
  assert.ok(e.S.groupKeyRecipients('r2'), 'CONTROL: an envelope with our copy gives us its recipients');
  e.t.__ingest(env([MB.pub], 1759300100));                    // the owner's rotation, which left this console out
  assert.equal(e.S.groupKeyRecipients('r2'), null, 'THE NEWEST ENVELOPE HAS NO COPY FOR US BUT ITS RECIPIENTS ARE STILL OFFERED — the distributor republishes the OLD ring over the rotation');
  const n = e.published.length;
  const r = await e.S.publishGroupKey('r2', [MB.pub, M2.pub], { reuseOnly: true, background: true });
  assert.equal(r, null, 'a reuse-only publish from a ring the newest envelope has moved past did not refuse');
  assert.equal(e.published.length, n, 'A PRE-ROTATION RING WAS PUBLISHED AS THE ROOM\'S CURRENT KEY');
});

test('round 2 · P4: an approval by a steward this device saw removed counts if written before the removal — a stranger\'s never, nor one dated after', async () => {
  const e = engine();
  const W = K(), X = K(), ADA = K(), BEN = K(), EVE = K(), ZED = K();
  e.t.__rememberEx([W.pub], [], 1759300150);                 // a church-signed roster dropped W at 1759300150
  let got = null;
  e.S.subscribeAdmitted((l) => { got = l; });
  const narrow = e.subs.find(r => r.d === AD_D + A.pub);
  assert.ok(narrow, 're-anchor: subscribeAdmitted no longer opens a narrow read of the admitted list');
  narrow.handlers.onevent(doc30078(A.pub, AD_D + A.pub, 1759300100, { pubkeys: [ADA.pub] }));
  narrow.handlers.onevent(doc30078(W.pub, AD_D + A.pub, 1759300140, { pubkeys: [BEN.pub] }, [['church', A.pub]]));
  narrow.handlers.onevent(doc30078(X.pub, AD_D + A.pub, 1759300140, { pubkeys: [EVE.pub] }, [['church', A.pub]]));
  assert.ok(got.includes(ADA.pub), 'CONTROL: the church\'s own approval');
  assert.ok(got.includes(BEN.pub), 'A MEMBER APPROVED BY A SINCE-REMOVED STEWARD LOOKS PENDING — the relay lets them in, the console withholds their keys (audit of 78ffad0, finding 3)');
  assert.ok(!got.includes(EVE.pub), 'AN APPROVAL SIGNED BY A KEY NO ROSTER EVER NAMED WAS COUNTED — a non-enforcing relay can admit anyone, and the next Approve launders it into the church\'s copy');
  assert.equal(e.S.listIsFresh(got), false, 'the admitted list counted as fresh before its read had settled');
  await e.eose(narrow);
  assert.equal(e.S.listIsFresh(got), true, 'CONTROL: the settled read is not fresh');
  // the ex-steward's own LATER list, dated after their removal (a non-enforcing relay accepted it): it does not count
  narrow.handlers.onevent(doc30078(W.pub, AD_D + A.pub, 1759300160, { pubkeys: [BEN.pub, ZED.pub] }, [['church', A.pub]]));
  assert.ok(!got.includes(ZED.pub), 'AN EX-STEWARD WROTE AN APPROVAL AFTER THEIR REMOVAL AND IT COUNTED');
  // the future clamp stays
  narrow.handlers.onevent(doc30078(A.pub, AD_D + A.pub, 1759300000 + 999999, { pubkeys: [EVE.pub] }));
  assert.ok(!got.includes(EVE.pub), 'a far-future copy was counted');
  // a current steward still counts
  const S1 = K(); e.t._careRoster = new Set([S1.pub]);
  narrow.handlers.onevent(doc30078(S1.pub, AD_D + A.pub, 1759300170, { pubkeys: [EVE.pub] }, [['church', A.pub]]));
  assert.ok(got.includes(EVE.pub), 'CONTROL: a current steward\'s approval no longer counts');
});

test('round 2 · P4: the roster that drops a steward is recorded with its date (the writer of the ex-steward record)', async () => {
  const e = engine();
  const W = K();
  const rec = [];
  e.t._stewardRosterChanged = (before, after, at) => rec.push(at);
  e.S.subscribeStewards(() => {});
  const stream = streamOf(e);
  stream.handlers.onevent(doc30078(A.pub, 'trinityone/stewards:' + A.pub, 1759300100, { pubkeys: [W.pub] }));
  stream.handlers.onevent(doc30078(A.pub, 'trinityone/stewards:' + A.pub, 1759300150, { pubkeys: [] }));
  assert.deepEqual(rec, [1759300100, 1759300150], 'the roster\'s date is not handed on, so no removal can be dated');
  // …and the record itself: dated, and cleared if they come back
  e.t.__rememberEx([W.pub], [], 1759300150);
  assert.equal(JSON.parse(e.t.localStorage.getItem('trinityone.steward.exstewards.at.' + A.pub))[W.pub], 1759300150);
  e.t.__rememberEx([], [W.pub], 1759300200);
  assert.equal(JSON.parse(e.t.localStorage.getItem('trinityone.steward.exstewards.at.' + A.pub))[W.pub], undefined, 'a steward put back on the roster still carries a removal date');
});

for (const [kind, call, prime] of [
  ['care', (e, m) => e.S.ensureCareKeyForMembers(m, []), (e, have) => { e.t._careKeyChecked = true; e.t._careKeyHex = 'aa'.repeat(32); e.t._careKeyRing = ['aa'.repeat(32)]; e.t._careKeyRev = 1; e.t._careKeyDocKeys = have; e.t._careKeyFresh = true; e.t._careKeyMine = true; }],
  ['media', (e, m) => e.S.ensureMediaKeyForMembers(m, []), (e, have) => { e.t._mediaKeyHex = 'bb'.repeat(32); e.t._mediaKeyRing = ['bb'.repeat(32)]; e.t._mediaKeyDocKeys = have; e.t._mediaKeyFresh = true; e.t._mediaKeyMine = true; }],
]) {
  test(`round 2 · P3: the ${kind} key only GROWS — a partial member list never drops anyone the envelope holds; the blocked still go`, async () => {
    const e = engine();
    const M1 = K(), M2 = K(), OLD = K(), BAD = K();
    prime(e, { [A.pub]: 'x', [M1.pub]: 'x', [OLD.pub]: 'x', [BAD.pub]: 'x' });
    e.t._localBlocked = new Set([BAD.pub]);
    await call(e, [M1.pub, M2.pub]);                          // OLD is in the envelope, not in this (partial) list
    const last = e.published.at(-1);
    assert.ok(last, `CONTROL: the ${kind} envelope was not republished for the new member`);
    const keys = Object.keys(JSON.parse(last.content).keys);
    assert.ok(keys.includes(M2.pub), 'CONTROL: the new member is not in it');
    assert.ok(keys.includes(OLD.pub), `THE ${kind.toUpperCase()} KEY WAS RE-SEALED WITHOUT A MEMBER IT HELD — a partial list took their key away (audit of 78ffad0, finding 3)`);
    assert.ok(!keys.includes(BAD.pub), `the ${kind} key was re-sealed to somebody blocked`);
  });
}

test('round 2 · P6: two overlapping runs of the room-key healer mint ONE key, and a room whose envelope exists is not re-asked at once', async () => {
  const e = engine();
  e.t.window.Steward = e.S;
  let release; const held = new Promise(r => { release = r; });
  const queries = [];
  e.t.pool.querySync = async (urls, filters) => { queries.push(filters[0]); await held; return ((filters[0] || {})['#d'] || [])[0] === 'trinityone/group:r9' ? [{ id: 'canary' }] : []; };
  const mints = [];
  e.S.publishGroupKey = async (gid) => { mints.push(gid); return true; };
  const room = [{ id: 'r9', encrypted: true }];
  const one = e.S.ensureGroupKeys(room, []), two = e.S.ensureGroupKeys(room, []);
  release(); await one; await two;
  assert.equal(mints.length, 1, 'TWO OVERLAPPING HEALER RUNS BOTH MINTED A KEY FOR ONE ROOM — whatever was sealed under the first is lost (audit of 78ffad0, finding 6)');
  // a room the relay says HAS an envelope (one this console cannot open): not asked about again for a while
  e.t.pool.querySync = async (urls, filters) => { queries.push(filters[0]); const d = ((filters[0] || {})['#d'] || [])[0]; return d === 'trinityone/group:r8' ? [{ id: 'c' }] : d === 'trinityone/groupkey:r8' ? [{ id: 'env' }] : []; };
  const q0 = queries.length;
  await e.S.ensureGroupKeys([{ id: 'r8', encrypted: true }], []);
  const q1 = queries.length;
  assert.ok(q1 > q0, 'CONTROL: the room was not checked at all');
  await e.S.ensureGroupKeys([{ id: 'r8', encrypted: true }], []);
  assert.equal(queries.length, q1, 'a room whose envelope the relay just confirmed was queried again at once — three relay queries per envelope arrival');
});

test('round 2 · P2: two copies stamped the SAME second do not "drop" each other — each drop re-opens every read, so that would loop', async () => {
  const e = engine();
  const MB = K(), BOB = K();
  e.S.subscribeBlocked(() => {});
  await e.eose(e.subs.find(r => r.d === BL_D + A.pub));
  const ring = [hex(generateSecretKey())];
  e.t.__ingest(envelope(GK_D, A, 'r3', ring, [A.pub, MB.pub, BOB.pub], 1759300000));
  const reads = e.subs.filter(r => r.d === BL_D + A.pub).length;
  e.t.__ingest(envelope(GK_D, A, 'r3', ring, [A.pub, MB.pub], 1759300000));   // another author's copy, same second
  assert.deepEqual(e.S.groupKeyDropped('r3'), [], 'an equal-stamped copy counted as a rotation that dropped somebody');
  assert.equal(e.subs.filter(r => r.d === BL_D + A.pub).length, reads, 'an equal-stamped copy re-opened the reads — re-delivered, it would do so for ever');
});

// ── ROUND 3a (audit of 244a6fe) ─────────────────────────────────────────────────────────────────────────────────────
const ringOf = (e, gid) => (e.t.__skeys[gid] || []).map(hex);
const openKey = (ev, who) => nip44.v2.decrypt(JSON.parse(ev.content).keys[who.pub], ck(who.sk, ev.pubkey));   // `keys` holds the CURRENT key, bare hex
function gated(e) {
  const g = { waiting: [], open: false };
  e.t.publish = (ev) => { e.published.push(ev); if (g.open) return Promise.resolve({ id: 'ok' }); return new Promise(r => g.waiting.push(() => r({ id: 'ok' }))); };
  g.release = async () => { g.open = true; for (const f of g.waiting.splice(0)) f(); for (let i = 0; i < 6; i++) await flush(); };
  return g;
}
test('round 3a · HIGH 2: a background re-key in flight when a rotation starts — one publish per room at a time, and the rotation is what stays', async () => {
  const e = engine();
  const MB = K(), BOB = K();
  const ring0 = [hex(generateSecretKey())];
  e.t.__ingest(envelope(GK_D, A, 'r5', ring0, [A.pub, MB.pub, BOB.pub], 1759299000));
  const g = gated(e);
  const bg = e.S.publishGroupKey('r5', [MB.pub, BOB.pub], { reuseOnly: true, background: true });   // the background re-key, in flight
  await flush();
  const rot = e.S.publishGroupKey('r5', [MB.pub], { rotate: true });                                 // Block rotates meanwhile
  for (let i = 0; i < 4; i++) await flush();
  assert.equal(e.published.length, 1, 'TWO KEY PUBLISHES FOR ONE ROOM WERE IN FLIGHT AT ONCE — the older one can land last and restore the pre-Block ring');
  await g.release(); await bg; await rot;
  assert.equal(e.published.length, 2, 'CONTROL: the rotation never ran');
  const rotated = openKey(e.published[1], A);
  assert.notEqual(rotated, ring0[0], 'CONTROL: the second publish is not the rotation');
  assert.equal(ringOf(e, 'r5')[0], rotated, 'THE CONSOLE\'S CURRENT ROOM KEY IS NOT THE ROTATED ONE — its next re-key republishes the key the blocked person holds');
  assert.ok(!Object.keys(JSON.parse(e.published[1].content).keys).includes(BOB.pub), 'CONTROL: the rotation re-wrapped to Bob');
});
test('round 3a · HIGH 2: a publish that lands after a NEWER envelope was read does not put its older ring back here', async () => {
  const e = engine();
  const MB = K(), S1 = K();
  e.t._careRoster = new Set([S1.pub]);
  const ring0 = [hex(generateSecretKey())], ringNew = [hex(generateSecretKey())];
  e.t.__ingest(envelope(GK_D, A, 'r6', ring0, [A.pub, MB.pub], 1759299000));
  const g = gated(e);
  const bg = e.S.publishGroupKey('r6', [MB.pub, K().pub], { reuseOnly: true, background: true });
  await flush();
  // another console's rotation (a rostered steward, wrapped to this church too) is read while ours is in flight
  e.t.__ingest({ ...envelope(GK_D, S1, 'r6', ringNew, [A.pub, MB.pub], 1759300500), tags: [['d', GK_D + 'r6'], ['t', 'trinityone'], ['church', A.pub]] });
  e.t.churchSk = A.sk;
  await g.release(); await bg;
  assert.notEqual(ringOf(e, 'r6')[0], ring0[0], 'THE OLDER RING CAME BACK AFTER THE PUBLISH LANDED — the next re-key would republish it over the rotation');
});
test('round 3a · LOW i: a room envelope stamped far in the future, or by a key no roster names, is not taken — a steward\'s is, once the roster names them', async () => {
  const e = engine();
  const MB = K(), X = K(), S1 = K();
  const ring = [hex(generateSecretKey())];
  e.t.__ingest(envelope(GK_D, A, 'r7', ring, [A.pub, MB.pub], 1759300000 + 99999));
  assert.equal(e.S.groupKeyRecipients('r7'), null, 'A FAR-FUTURE ENVELOPE WAS TAKEN — newest-wins would pin it for good');
  e.t.__ingest({ ...envelope(GK_D, X, 'r7', ring, [A.pub, MB.pub], 1759300000), tags: [['d', GK_D + 'r7'], ['t', 'trinityone'], ['church', A.pub]] });
  assert.equal(e.S.groupKeyRecipients('r7'), null, 'AN ENVELOPE SIGNED BY A KEY NO ROSTER NAMES WAS TAKEN');
  // a delegate's real envelope that arrives before the roster does: kept, and taken once the roster names them
  e.t.__ingest({ ...envelope(GK_D, S1, 'r7', ring, [A.pub, MB.pub], 1759300001), tags: [['d', GK_D + 'r7'], ['t', 'trinityone'], ['church', A.pub]] });
  assert.equal(e.S.groupKeyRecipients('r7'), null, 'CONTROL: taken before the roster named the author');
  e.t._careRoster = new Set([S1.pub]);
  e.t.__reCheckGk();
  assert.ok(e.S.groupKeyRecipients('r7'), 'A DELEGATE\'S REAL ENVELOPE WAS LOST because it arrived before the steward roster');
  assert.ok(e.S.groupKeyRecipients('r7').includes(MB.pub));
});
test('round 3a · LOW ii: after an unblock that only PARTLY saved, the member lists are still asked again', async () => {
  const e = engine();
  const P = K();
  e.t._localBlocked = new Set([P.pub]);
  let asked = 0; e.t.__membersReask.add(() => { asked++; });
  e.t._publishToRelays = async () => false;      // one relay refused: a partial save
  await e.S.setBlocked([], { unblock: [P.pub] });
  for (let i = 0; i < 4; i++) await flush();
  assert.equal(asked, 1, 'AFTER A PARTIAL UNBLOCK THE MEMBER LIST WAS NOT ASKED AGAIN — the relays that took it serve the person now');
  assert.ok(e.t._localBlocked.has(P.pub), 'CONTROL: a partial unblock still keeps them blocked on this console');
});
for (const [kind, sub, d, ensure, prime] of [
  ['care', 'subscribeCareKey', CAREKEY_D, (e, m) => e.S.ensureCareKeyForMembers(m, []), (e) => { e.t._careKeyChecked = true; }],
  ['media', 'subscribeMediaKey', MEDIAKEY_D, (e, m) => e.S.ensureMediaKeyForMembers(m, []), (e) => { e.t._mediaKeyChecked = true; }],
]) {
  test(`round 3a · (b): the ${kind} key is not re-sealed after a reconnect until the read has settled again, nor from a ring the newest envelope moved past`, async () => {
    const e = engine();
    const M1 = K(), NEW = K();
    const ring = [hex(generateSecretKey())];
    e.S[sub]();
    const r1 = e.subs.at(-1);
    r1.handlers.onevent(envelope(d, A, A.pub, ring, [A.pub, M1.pub], 1759300000));
    await e.eose(r1);
    prime(e);
    // the reconnect: the read re-opens and has not settled
    e.S[sub]();
    const n = e.published.length;
    await ensure(e, [M1.pub, NEW.pub]);
    assert.equal(e.published.length, n, `THE ${kind.toUpperCase()} KEY WAS RE-SEALED BEFORE THE RE-OPENED READ SETTLED — a ring from before a rotation can go back on the relay`);
    await e.eose(e.subs.at(-1));
    await ensure(e, [M1.pub, NEW.pub]);
    assert.equal(e.published.length, n + 1, `CONTROL: once read, the ${kind} key was not re-sealed for the new member`);
    // a NEWER envelope with no copy for this console (a rotation that left it out)
    e.subs.at(-1).handlers.onevent(envelope(d, A, A.pub, [hex(generateSecretKey())], [M1.pub], 1759300100));
    const m = e.published.length;
    await ensure(e, [M1.pub, NEW.pub, K().pub]);
    assert.equal(e.published.length, m, `THE ${kind.toUpperCase()} KEY WAS RE-SEALED FROM A RING THE NEWEST ENVELOPE HAS MOVED PAST`);
  });
}
test('round 3a · (b): a lagging relay\'s OLDER sermon-key envelope does not become the current key', async () => {
  const e = engine();
  const M1 = K();
  const older = [hex(generateSecretKey())], newer = [hex(generateSecretKey()), older[0]];
  e.S.subscribeMediaKey();
  const r = e.subs.at(-1);
  r.handlers.onevent(envelope(MEDIAKEY_D, A, A.pub, newer, [A.pub, M1.pub], 1759300100));
  r.handlers.onevent(envelope(MEDIAKEY_D, A, A.pub, older, [A.pub, M1.pub], 1759300000));
  assert.equal(e.t._mediaKeyHex, newer[0], 'AN OLDER SERMON-KEY ENVELOPE ARRIVING LATE BECAME THE CURRENT KEY — the next re-seal would put it back on the relay');
});
test('round 3a · (b): with a relay DOWN, the care and sermon reads are fresh for re-sealing — but the mint gate stays shut and the down relay is asked again', async () => {
  for (const [method, fresh, checked] of [['subscribeCareKey', '_careKeyFresh', '_careKeyChecked'], ['subscribeMediaKey', '_mediaKeyFresh', '_mediaKeyChecked']]) {
    const e = engine(); e.t.relayList = [R1, R2];
    e.S[method]();
    const [r1, r2] = e.subs.slice(-2);
    await e.closedByRelay(r1, 'connection failure: relay unreachable');
    await e.eose(r2);
    assert.equal(e.t[fresh], true, `${method}: A RELAY THAT IS DOWN HELD BACK EVERY RE-SEAL — nobody new gets the key while it stays down`);
    assert.equal(e.t[checked], false, `${method}: THE MINT GATE OPENED WITH A RELAY DOWN — it may hold the envelope`);
    assert.deepEqual(e.fireTimers(), [2000], `${method}: the down relay is never asked again, so the mint gate can never open`);
  }
});

// ROUND 3c, HIGH 1 (audit of 432c676): A ROTATION KEEPS EVERY CURRENT HOLDER WHO PASSES `keepIf`. The caller's member list
// can be partial, or only the admitted list while approval is unknown; the member app deletes a key it is no longer
// given. So whoever holds the key now and passes the caller's `keepIf` is carried into the new envelope — but never
// someone this console holds as blocked, whatever `keepIf` says.
test('rotateCareKey, rotateMediaKey and a room rotation carry every current holder `keepIf` passes — and never the blocked', async () => {
  const e = engine();
  e.t._localBlocked = new Set([M3.pub]);
  const holders = { [A.pub]: 'x', [M1.pub]: 'x', [M2.pub]: 'x', [M3.pub]: 'x' };
  e.t._careKeyHex = 'aa'.repeat(32); e.t._careKeyRing = ['aa'.repeat(32)]; e.t._careKeyChecked = true; e.t._careKeyRev = 1; e.t._careKeyDocKeys = { ...holders }; e.t._careKeyMine = true; e.t._careKeyFresh = true;   // read on this connection — round 3d
  e.t._mediaKeyHex = 'cc'.repeat(32); e.t._mediaKeyRing = ['cc'.repeat(32)]; e.t._mediaKeyChecked = true; e.t._mediaKeyFresh = true; e.t._mediaKeyDocKeys = { ...holders }; e.t._mediaKeyMine = true;
  const gid = 'room-3c';
  e.t.__skeys[gid] = [unhex('dd'.repeat(32))]; e.t.__senvRecips[gid] = Object.keys(holders); e.t.__senvMine[gid] = true;
  const keepIf = (p) => p !== M2.pub;              // the caller says: everyone but M2 (the person leaving)
  for (const [what, call, d] of [
    ['care', () => e.S.rotateCareKey([], [], { keepIf }), CAREKEY_D + A.pub],
    ['sermon', () => e.S.rotateMediaKey([], [], { keepIf }), MEDIAKEY_D + A.pub],
    ['room', () => e.S.publishGroupKey(gid, [], { rotate: true, keepIf }), 'trinityone/groupkey:' + gid],
  ]) {
    const p0 = e.published.length;
    await call();
    const env = e.published.slice(p0).find(ev => dtag(ev) === d);
    assert.ok(env, `CONTROL: no ${what} rotation was published`);
    const to = Object.keys(JSON.parse(env.content).keys || {});
    assert.ok(to.includes(M1.pub), `THE ${what.toUpperCase()} ROTATION TOOK THE KEY OFF A CURRENT HOLDER keepIf KEPT — handed an empty list, it rotated to the church alone`);
    assert.ok(!to.includes(M2.pub), `the ${what} rotation kept the person keepIf left out`);
    assert.ok(!to.includes(M3.pub), `THE ${what.toUpperCase()} ROTATION KEPT A HOLDER THIS CONSOLE HOLDS AS BLOCKED`);
  }
  // CONTROL: without keepIf, the rotation is exactly the list it was given (the old contract)
  const p1 = e.published.length;
  await e.S.rotateCareKey([], []);
  const plain = e.published.slice(p1).find(ev => dtag(ev) === CAREKEY_D + A.pub);
  assert.ok(plain && !Object.keys(JSON.parse(plain.content).keys).includes(M1.pub), 'CONTROL: without keepIf a rotation still carried holders');
});

// ROUND 3c, MED 2 (audit of 432c676): THE CARE AND SERMON KEYS NEVER GO BACK TO THE RING FROM BEFORE A BLOCK. Two holes:
// (1) rotateMediaKey never stamped `_mediaKeyAt`, so the envelope from before the Block, replayed by a lagging relay or a
// re-read, was taken over the rotation in the same session — the blocked person's key back as the current one; (2) after
// a reload, with the relay holding the rotation down and one holding the older envelope up, the read settled on the
// connected relay alone (round 3a), the console adopted the older envelope as its own and re-sealed that ring with a
// newer stamp. Now every envelope the console accepts or publishes is kept on the device (_keyEnvSave) and restored
// before any relay answers.
const K1 = '11'.repeat(32);
const envAt = (d, author, ring, recips, at, rev = 1) => ({ pubkey: author.pub, kind: 30078, created_at: at,
  tags: [['d', d + A.pub], ['t', 'trinityone']],
  content: JSON.stringify({ rev, keys: Object.fromEntries(recips.map(p => [p, nip44.v2.encrypt(JSON.stringify(ring), ck(author.sk, p))])) }) });
const headFor = (ev, who) => JSON.parse(nip44.v2.decrypt(JSON.parse(ev.content).keys[who.pub], ck(who.sk, A.pub)))[0];
const OLD_AT = 1759299000;   // the envelope from before the Block: older than anything the console publishes (now() = 1759300000)
test('sermon key: after a Block\'s rotation, the envelope from before it — replayed — does not become the current key again', async () => {
  const e = engine(); e.t.up = new Set([R1]);
  e.S.subscribeMediaKey();
  const s = e.subs.at(-1);
  s.handlers.onevent(envAt(MEDIAKEY_D, A, [K1], [A.pub, M1.pub, M2.pub], OLD_AT)); await e.eose(s);
  assert.equal(e.t._mediaKeyHex, K1, 'CONTROL: the sermon key was not read');
  e.t._localBlocked = new Set([M2.pub]);
  assert.equal(await e.S.rotateMediaKey([M1.pub], []), true, 'CONTROL: the rotation did not publish');
  const k2 = e.t._mediaKeyHex;
  assert.notEqual(k2, K1, 'CONTROL: the rotation did not change the key');
  s.handlers.onevent(envAt(MEDIAKEY_D, A, [K1], [A.pub, M1.pub, M2.pub], OLD_AT));   // a lagging relay, or a re-read
  assert.equal(e.t._mediaKeyHex, k2, 'THE ENVELOPE FROM BEFORE THE BLOCK WAS TAKEN OVER THE ROTATION — new sermons would be sealed with the key the blocked person holds');
});
for (const [kind, D, sub, rotate, ensure, hexOf] of [
  ['sermon', MEDIAKEY_D, 'subscribeMediaKey', 'rotateMediaKey', 'ensureMediaKeyForMembers', (t) => t._mediaKeyHex],
  ['care', CAREKEY_D, 'subscribeCareKey', 'rotateCareKey', 'ensureCareKeyForMembers', (t) => t._careKeyHex],
]) {
  test(`${kind} key: after a reload with the relay that took the Block's rotation DOWN, the console keeps the rotated key — it does not adopt and re-seal the older ring the other relay still holds`, async () => {
    // BEFORE THE RELOAD: the console reads the church's key, blocks M2 and rotates
    const e1 = engine(); e1.t.up = new Set([R1]);
    e1.S[sub]();
    const s1 = e1.subs.at(-1);
    s1.handlers.onevent(envAt(D, A, [K1], [A.pub, M1.pub, M2.pub], OLD_AT, 1)); await e1.eose(s1);
    assert.equal(hexOf(e1.t), K1, 'CONTROL: the key was not read');
    e1.t._localBlocked = new Set([M2.pub]);
    assert.equal(await e1.S[rotate]([M1.pub], []), true, 'CONTROL: the rotation did not publish');
    const k2 = hexOf(e1.t);
    // THE RELOAD: a new console on the same device; the relay that took the rotation is down, the one that holds the
    // envelope from before the Block answers — the read settles on it alone (round 3a)
    const e2 = engine(); e2.t.up = new Set([R1]); e2.t.localStorage = e1.t.localStorage;
    e2.t._localBlocked = new Set([M2.pub]);   // the device's copy of the blocklist (HIGH 2, unchanged)
    e2.S[sub]();
    const s2 = e2.subs.at(-1);
    s2.handlers.onevent(envAt(D, A, [K1], [A.pub, M1.pub, M2.pub], OLD_AT, 1)); await e2.eose(s2);
    assert.equal(hexOf(e2.t), k2, `AFTER THE RELOAD THE CONSOLE TOOK THE ${kind.toUpperCase()} KEY FROM BEFORE THE BLOCK AS ITS OWN — the key the blocked person holds`);
    // a new member joins: the re-seal hands them the ROTATED key, never the old ring
    const p0 = e2.published.length;
    await e2.S[ensure]([M1.pub, M3.pub], []);
    const out = e2.published.slice(p0).find(ev => dtag(ev) === D + A.pub);
    assert.ok(out, `CONTROL: the ${kind} key was not re-sealed for the new member`);
    assert.equal(headFor(out, M3), k2, `THE RE-SEAL HANDED THE NEW MEMBER THE ${kind.toUpperCase()} KEY FROM BEFORE THE BLOCK`);
    assert.ok(!Object.keys(JSON.parse(out.content).keys).includes(M2.pub), `the re-seal wrapped the ${kind} key to the blocked member`);
  });
}
test('the kept envelope holds no key in the clear — only this console\'s own sealed copy', async () => {
  const e = engine(); e.t.up = new Set([R1]);
  e.S.subscribeMediaKey();
  const s = e.subs.at(-1);
  s.handlers.onevent(envAt(MEDIAKEY_D, A, [K1], [A.pub, M1.pub], OLD_AT)); await e.eose(s);
  const kept = [...e.t.localStorage._m.entries()].filter(([k]) => k.startsWith('trinityone.steward.keyenv.'));
  assert.equal(kept.length, 1, 'CONTROL: the envelope was not kept on the device');
  assert.ok(!kept[0][1].includes(K1), 'THE SERMON KEY WAS WRITTEN TO THE DEVICE IN THE CLEAR');
});

// ROUND 3c, LOW iv (audit of 432c676): a room-key envelope held back because its author was not on the roster YET was
// church A's, and both resets left it in place — to be re-checked against church B's roster on B's next roster change.
test('LOW iv: both resets empty the buffer of room-key envelopes held for an author the roster did not name yet', () => {
  for (const [what, reset] of [['setActiveIdentity (a switch)', (e) => assert.equal(e.S.setActiveIdentity(A.pub), true, 'CONTROL: the switch failed')], ['_resetChurchScopedState (a key restore)', (e) => e.t.__resetChurchScopedState()]]) {
    const e = engine();
    e.t.__senvPending.set('room-of-a', envelope('trinityone/groupkey:', M1, 'room-of-a', ['ee'.repeat(32)], [A.pub]));
    reset(e);
    assert.equal(e.t.__senvPending.size, 0, `${what} LEFT CHURCH A'S UNVERIFIED ROOM-KEY ENVELOPES to be judged against the next church's roster`);
  }
});

// ROUND 3c, LOW ii (audit of 432c676): a steward's seal or edit queued behind background re-keys waited for every one of
// them, and the dialog's 8 s timer said "Couldn't reach the relay" while it waited. A background re-key whose turn comes
// while a steward's publish is waiting now does nothing (null — the distributor asks again, free); one already IN FLIGHT
// is still waited for (round 3a, HIGH 2); and the steward's `onTurn` runs only when its own turn comes, which is when the
// dialog starts its timer.
test('LOW ii: a background re-key queued behind one in flight steps aside for a steward\'s publish, and onTurn fires only on the steward\'s turn', async () => {
  const e = engine();
  const gid = 'room-q';
  e.t.__skeys[gid] = [unhex('dd'.repeat(32))]; e.t.__senvRecips[gid] = [A.pub, M1.pub]; e.t.__senvMine[gid] = true;
  const g = gate(); const real = e.t.publish; const sent = [];
  e.t.publish = async (ev) => { sent.push(ev); if (sent.length === 1) await g.p; return real(ev); };
  const inFlight = e.S.publishGroupKey(gid, [M1.pub, M2.pub], { reuseOnly: true, background: true });
  await flush();
  assert.equal(sent.length, 1, 'CONTROL: the first background re-key is not in flight');
  const queued = e.S.publishGroupKey(gid, [M1.pub, M3.pub], { reuseOnly: true, background: true });
  let turned = 0;
  const steward = e.S.publishGroupKey(gid, [M1.pub], { rotate: true, onTurn: () => { turned++; } });
  await flush();
  assert.equal(turned, 0, 'the steward\'s onTurn fired while a publish was still in flight — HIGH 2 says it waits for that one');
  g.release();
  const [, rq, rs] = await Promise.all([inFlight, queued, steward]);
  assert.equal(rq, null, 'A BACKGROUND RE-KEY THAT HAD NOT STARTED RAN WHILE A STEWARD\'S PUBLISH WAITED BEHIND IT');
  assert.equal(turned, 1, 'the steward\'s onTurn did not fire exactly once');
  assert.ok(rs, 'CONTROL: the steward\'s publish did not land');
  assert.equal(sent.length, 2, 'publishes made: the one in flight and the steward\'s — nothing else');
  // CONTROL: with no steward waiting, a queued background re-key runs as before
  const q2 = await e.S.publishGroupKey(gid, [M1.pub, M3.pub], { reuseOnly: true, background: true });
  assert.ok(q2 !== null, 'CONTROL: a background re-key with nobody waiting did nothing');
});

// …and sealGroup (the seal dialog's engine call) hands the dialog's onTurn through to the room's key publish (LOW ii).
test('LOW ii: sealGroup hands the dialog\'s onTurn to the key publish, which calls it once on its turn', async () => {
  const e = engine();
  const gid = 'room-s';
  e.t.__skeys[gid] = [unhex('dd'.repeat(32))]; e.t.__senvRecips[gid] = [A.pub, M1.pub]; e.t.__senvMine[gid] = true;
  e.t.window.Steward.publishGroupKey = (...a) => e.S.publishGroupKey(...a);
  e.t.window.Steward.publishGroup = async (g) => ({ ...g, ts: 1 });
  let turned = 0;
  const r = await e.S.sealGroup({ id: gid, name: 'Sealed' }, [M1.pub], { onTurn: () => { turned++; } });
  assert.ok(r && r.sealed, 'CONTROL: the room was not sealed: ' + JSON.stringify(r));
  assert.equal(turned, 1, 'SEALGROUP DID NOT HAND THE DIALOG\'S onTurn TO THE KEY PUBLISH — the dialog\'s 8 s never starts, so only the 30 s bound is left');
});

// ROUND 3d, MED (audit of 0f5cd2d): THE DEVICE COPY IS NEVER THE BASIS OF A ROTATION. 3c restores the care/sermon envelope
// this console last accepted before any relay answers — so it can paint and seal — but Block and removing a delegate
// rotated from it too. Device 1 kept care rev 1 (K1; A, M1, M2, M3); another console published rev 2 (K2) blocking M2;
// device 1 reloaded and blocked M3 before the relay answered: it rotated from rev 1 (M2 still in, K2 not in its ring) and
// published "rev 2" — and the relay's real rev 2, arriving at the same rev, then replaced it, so the console sealed with
// K2, which M3 holds. A rotation now refuses until this connection's read has settled (the same `fresh` the re-seal uses),
// which is what 432c676 did by having nothing to rotate; and an envelope at the SAME rev as the one this console holds
// replaces it only if it is newer, its keys otherwise joining the ring's tail.
const K2 = '22'.repeat(32);
for (const [kind, D, sub, rotate, hexOf, ringOf] of [
  ['care', CAREKEY_D, 'subscribeCareKey', 'rotateCareKey', (t) => t._careKeyHex, (t) => t._careKeyRing],
  ['sermon', MEDIAKEY_D, 'subscribeMediaKey', 'rotateMediaKey', (t) => t._mediaKeyHex, (t) => t._mediaKeyRing],
]) {
  test(`3d MED · ${kind}: a Block before this connection's read has settled does not rotate from the device copy — and after it, rotates from the relay's newer key`, async () => {
    const e1 = engine(); e1.t.up = new Set([R1]);
    e1.S[sub]();
    const s1 = e1.subs.at(-1);
    s1.handlers.onevent(envAt(D, A, [K1], [A.pub, M1.pub, M2.pub, M3.pub], OLD_AT, 1)); await e1.eose(s1);
    assert.equal(hexOf(e1.t), K1, 'CONTROL: device 1 did not keep rev 1');
    // device 1 reloads; the read is open, nothing has answered yet
    const e2 = engine(); e2.t.up = new Set([R1]); e2.t.localStorage = e1.t.localStorage;
    e2.S[sub]();
    const s2 = e2.subs.at(-1);
    assert.equal(hexOf(e2.t), K1, 'CONTROL: the device copy was not restored');
    e2.t._localBlocked = new Set([M3.pub]);                       // Block M3, NOW
    const p0 = e2.published.length;
    const r = await e2.S[rotate]([M1.pub, M2.pub], []);
    assert.equal(e2.published.length, p0, `A ${kind.toUpperCase()} ROTATION WAS PUBLISHED FROM THE DEVICE COPY BEFORE THE RELAY ANSWERED — it is built on a ring that may be superseded`);
    assert.deepEqual(r, { pending: true }, `the held-back ${kind} rotation did not say it is waiting (round 3e: remembered, run when the read settles)`);
    // the relay answers: another console's rev 2 (K2), which blocked M2
    s2.handlers.onevent(envAt(D, A, [K2, K1], [A.pub, M1.pub, M3.pub], OLD_AT + 500, 2)); await e2.eose(s2);
    assert.equal(hexOf(e2.t), K2, 'CONTROL: the relay\'s newer key was not taken');
    assert.equal(await e2.S[rotate]([M1.pub], []), true, 'CONTROL: once the read settled, the rotation did not publish');
    const out = e2.published.slice(p0).find(ev => dtag(ev) === D + A.pub);
    const to = Object.keys(JSON.parse(out.content).keys);
    assert.ok(!to.includes(M3.pub), `the ${kind} rotation kept M3`);
    const ring = JSON.parse(nip44.v2.decrypt(JSON.parse(out.content).keys[M1.pub], ck(M1.sk, A.pub)));
    assert.ok(ring.includes(K2), `THE ${kind.toUpperCase()} ROTATION'S RING LACKS K2 — needs sealed under it no longer open`);
    assert.notEqual(ring[0], K2, `the ${kind} rotation did not make a new key`);
  });
}
test('3d MED · care: an envelope at the SAME rev as this console\'s own rotation, but older, does not replace it — its key joins the ring', async () => {
  const e = engine(); e.t.up = new Set([R1]);
  e.S.subscribeCareKey();
  const s = e.subs.at(-1);
  s.handlers.onevent(envAt(CAREKEY_D, A, [K1], [A.pub, M1.pub, M3.pub], OLD_AT, 1)); await e.eose(s);
  e.t._localBlocked = new Set([M3.pub]);
  assert.equal(await e.S.rotateCareKey([M1.pub], []), true, 'CONTROL: the rotation did not publish');
  const mine = e.t._careKeyHex;
  assert.equal(e.t._careKeyRev, 2, 'CONTROL: the rotation is not rev 2');
  // another console's rev 2, made earlier from the same rev 1, arrives now
  s.handlers.onevent(envAt(CAREKEY_D, A, [K2, K1], [A.pub, M1.pub, M3.pub], OLD_AT + 500, 2));
  assert.equal(e.t._careKeyHex, mine, 'AN OLDER ENVELOPE AT THE SAME REV REPLACED THIS CONSOLE\'S OWN ROTATION — it now seals with a key the blocked M3 holds');
  assert.ok(e.t._careKeyRing.includes(K2), 'the other console\'s key did not join this console\'s ring — needs sealed under it would not open here');
  // CONTROL: a NEWER envelope at the same rev still wins (newest wins, as before)
  s.handlers.onevent(envAt(CAREKEY_D, A, [K2, K1], [A.pub, M1.pub], 1759300000 + 5, 2));
  assert.equal(e.t._careKeyHex, K2, 'CONTROL: a newer envelope at the same rev was refused');
});

// ROUND 3d, LOW 3 (audit of 0f5cd2d): the care/sermon envelopes 3c keeps on the device carry the church's recipient list
// — members and delegates, in the clear. They go when the key goes (removeKey) and on a key restore or a discarded key
// (_resetChurchScopedState); NOT on a church switch, which keeps the device's key (see the note in the reset).
test('LOW 3: the kept care/sermon envelopes are cleared by a key restore, and by removing the key — not by a church switch', async () => {
  const keep = (e) => [...e.t.localStorage._m.keys()].filter(k => k.startsWith('trinityone.steward.keyenv.'));
  const seeded = async () => {
    const e = engine(); e.t.up = new Set([R1]);
    e.S.subscribeMediaKey();
    const s = e.subs.at(-1);
    s.handlers.onevent(envAt(MEDIAKEY_D, A, [K1], [A.pub, M1.pub], OLD_AT)); await e.eose(s);
    e.t.localStorage.setItem('trinityone.steward.other', 'x');   // someone else's entry: must survive
    assert.equal(keep(e).length, 1, 'CONTROL: nothing was kept');
    return e;
  };
  { const e = await seeded(); assert.equal(e.S.setActiveIdentity(A.pub), true); assert.equal(keep(e).length, 1, 'a church SWITCH threw away the kept envelope — round 3c\'s protection gone on every switch'); }
  { const e = await seeded(); e.t.__resetChurchScopedState(); assert.equal(keep(e).length, 0, 'A KEY RESTORE LEFT THE KEPT ENVELOPES (the church\'s recipient list) ON THE DEVICE'); assert.equal(e.t.localStorage.getItem('trinityone.steward.other'), 'x', 'the reset cleared an unrelated entry'); }
  { const e = await seeded();
    const removeKey = new Function('localStorage', 'KEY_LS', 'encBlobRemove', '_stay', '_minorsLastClear', 'window', 'CustomEvent',
      'return ({ ' + fnBody(BUNDLE, BUNDLE.indexOf('    removeKey() {') + 4, 'removeKey() {') + ' });')(e.t.localStorage, 'k', async () => true, { clear() {} }, () => {}, { Steward: {}, dispatchEvent() {} }, class {});
    await removeKey.removeKey();
    assert.equal(keep(e).length, 0, 'REMOVING THE KEY LEFT THE KEPT ENVELOPES (the church\'s recipient list) ON THE DEVICE');
    assert.equal(e.t.localStorage.getItem('trinityone.steward.other'), 'x', 'removeKey cleared an unrelated entry'); }
});

// ROUND 3d, LOW 2 (audit of 0f5cd2d): THE MEMBER LIST SAYS WHEN IT IS A GENUINE READ. Block and Remove let a holder who has
// left go only once the member list is fresh — a narrow read of the member documents settled on every connected relay —
// never from the cache it paints from first.
test('LOW 2: the member list is FRESH only once a genuine read of the member documents has settled', async () => {
  const e = engine(); e.t.up = new Set([R1]);
  let last = null;
  e.S.subscribeMembers((l) => { last = l; });
  const read = e.subs.find(r => r.d === 'trinityone/member:' + A.pub);
  assert.ok(read, 'THE MEMBER LIST OPENS NO READ OF THE MEMBER DOCUMENTS — it can never be told fresh');
  assert.ok(!e.S.listIsFresh(last), 'the member list was fresh before any relay answered');
  const ts = 1759299000;
  read.handlers.onevent({ pubkey: M1.pub, kind: 30078, created_at: ts, tags: [['d', 'trinityone/member:' + A.pub], ['p', A.pub]], content: JSON.stringify({ joined: ts }) });
  assert.ok(!e.S.listIsFresh(last), 'the member list was fresh before the read had settled');
  await e.eose(read);
  assert.ok(e.S.listIsFresh(last), 'A SETTLED, GENUINE READ OF THE MEMBER DOCUMENTS DID NOT MAKE THE MEMBER LIST FRESH');
  assert.ok(last.some(m => m.pubkey === M1.pub), 'the fresh list does not include the member the read delivered');
});

// ROUND 3e, MED 2 (audit of b102dc6): A MEMBER LIST READ FROM ONE RELAY IS NOT COMPLETE. The member-document read used
// "every CONNECTED relay", so with the second relay down the list from the first was marked fresh — and Block's keepOnly
// then dropped approved holders whose member document lives only on the down relay, and their phones deleted their keys.
// A key is taken only on positive evidence: the read is fresh only once EVERY relay in the church's set has answered.
test('3e MED 2: with one of two relays down, the member list is NOT fresh — and becomes fresh once both have answered', async () => {
  const e = engine(); e.t.relayList = [R1, R2]; e.t.up = new Set([R1]);   // R2 is down
  let last = null;
  e.S.subscribeMembers((l) => { last = l; });
  const reads = () => e.subs.filter(r => r.d === 'trinityone/member:' + A.pub && !r.closed);
  const [r1, r2] = [reads().find(r => r.url === R1), reads().find(r => r.url === R2)];
  assert.ok(r1 && r2, 'CONTROL: the member-document read was not opened on both relays');
  const ts = 1759299000;
  r1.handlers.onevent({ pubkey: M1.pub, kind: 30078, created_at: ts, tags: [['d', 'trinityone/member:' + A.pub], ['p', A.pub]], content: JSON.stringify({ joined: ts }) });
  await e.eose(r1);
  await e.closedByRelay(r2, 'connection failed');                       // the down relay: no answer
  assert.ok(!e.S.listIsFresh(last), 'A MEMBER LIST READ FROM ONE RELAY, WITH THE OTHER DOWN, WAS MARKED FRESH — Block would take keys from members whose document only the down relay holds');
  // the down relay comes back: the read asks again, both answer, and now the list is fresh
  e.t.up = new Set([R1, R2]);
  e.fireTimers();
  const [s1, s2] = [reads().find(r => r.url === R1), reads().find(r => r.url === R2)];
  assert.ok(s1 && s2, 'CONTROL: the member read did not ask again');
  s2.handlers.onevent({ pubkey: M2.pub, kind: 30078, created_at: ts, tags: [['d', 'trinityone/member:' + A.pub], ['p', A.pub]], content: JSON.stringify({ joined: ts }) });
  await e.eose(s1); await e.eose(s2);
  assert.ok(e.S.listIsFresh(last), 'CONTROL: with both relays answering, the member list never became fresh');
  assert.ok(last.some(m => m.pubkey === M2.pub), 'the fresh list lacks the member only the second relay held');
});

// ROUND 3e, LOW 1 (audit of b102dc6): the care ring is READ, both shapes — executed, because care-key-ring's text check
// could be satisfied by the same-rev block's own Array.isArray. A ring envelope gives the whole ring; a legacy envelope
// (one bare hex key, from before the ring) gives a one-key ring.
test('3e LOW 1: the care envelope\'s ring is read whole, and a legacy bare-key envelope as a one-key ring', async () => {
  const e = engine(); e.t.up = new Set([R1]);
  e.S.subscribeCareKey();
  const s = e.subs.at(-1);
  s.handlers.onevent(envAt(CAREKEY_D, A, [K2, K1], [A.pub, M1.pub], OLD_AT, 1));
  assert.deepEqual(e.t._careKeyRing, [K2, K1], 'A RING ENVELOPE WAS NOT READ AS ITS RING — needs sealed under the older key would not open');
  const legacy = { pubkey: A.pub, kind: 30078, created_at: OLD_AT + 10, tags: [['d', CAREKEY_D + A.pub], ['t', 'trinityone']],
    content: JSON.stringify({ rev: 2, keys: { [A.pub]: nip44.v2.encrypt(K1, ck(A.sk, A.pub)) } }) };
  s.handlers.onevent(legacy);
  assert.deepEqual(e.t._careKeyRing, [K1], 'a legacy envelope (one bare hex key) was not read as a one-key ring');
});

// ROUND 3e, MED 1 (audit of b102dc6): A BLOCK DURING THE KEY READ IS REMEMBERED, AND RUNS WHEN THE READ SETTLES. 3d made a
// rotation refuse (`false`) until this connection's read had settled — and nothing ever ran it again: the person stayed on
// the Blocked list holding the key, and the screen said "try blocking them again", which it offers no way to do. Now the
// rotation is remembered per church (kept on the device), and runs on its own as soon as that key's read settles.
const pendingOf = (e) => { try { return JSON.parse(e.t.localStorage.getItem('trinityone.steward.pendingrot.' + A.pub) || '{}'); } catch { return {}; } };
for (const [kind, D, sub, rotate, hexOf] of [
  ['care', CAREKEY_D, 'subscribeCareKey', 'rotateCareKey', (t) => t._careKeyHex],
  ['sermon', MEDIAKEY_D, 'subscribeMediaKey', 'rotateMediaKey', (t) => t._mediaKeyHex],
]) {
  const key = kind === 'care' ? 'care' : 'media';
  test(`3e MED 1 · ${kind}: a Block before the read settles is remembered — and runs by itself when it settles, M3 out, everyone else kept`, async () => {
    const e = engine(); e.t.up = new Set([R1]);
    e.t.window.Steward = e.S;                                 // the runner calls the rotations through window.Steward, as the console does
    e.S[sub]();
    const s = e.subs.at(-1);
    e.t._localBlocked = new Set([M3.pub]); e.t._localBlockedAt = 1;   // a blocklist this console has read or written (round 3f: the runner re-checks against it)                     // Block M3, NOW — before the relay has answered
    const r = await e.S[rotate]([M1.pub], [], { keepIf: (h) => h !== M3.pub, drop: [M3.pub] });
    assert.deepEqual(r, { pending: true }, `a ${kind} rotation before the read settled did not say it is WAITING (block() would call it a failure)`);
    assert.deepEqual((pendingOf(e)[key] || {}).drop, [M3.pub], `THE ${kind.toUpperCase()} ROTATION WAS NOT REMEMBERED — nothing would ever run it`);
    const p0 = e.published.length;
    s.handlers.onevent(envAt(D, A, [K1], [A.pub, M1.pub, M2.pub, M3.pub], OLD_AT, 1)); await e.eose(s);
    for (let i = 0; i < 6; i++) await flush();
    const out = e.published.slice(p0).find(ev => dtag(ev) === D + A.pub);
    assert.ok(out, `THE REMEMBERED ${kind.toUpperCase()} ROTATION NEVER RAN once the read settled — the blocked person keeps the key`);
    const to = Object.keys(JSON.parse(out.content).keys);
    assert.ok(!to.includes(M3.pub), `the remembered ${kind} rotation kept M3`);
    assert.ok(to.includes(M1.pub) && to.includes(M2.pub), `the remembered ${kind} rotation dropped a holder who stays`);
    assert.notEqual(hexOf(e.t), K1, `the ${kind} key did not change`);
    assert.equal(pendingOf(e)[key], undefined, `the ${kind} rotation that ran was left remembered — it would run again`);
    assert.ok(e.events.some(x => x.type === 'steward-rotation-done' && x.detail.kind === key), 'the screen was not told the rotation is done');
  });
}
test('3e MED 1: a remembered rotation survives a RELOAD and runs on the next console\'s settle', async () => {
  const e1 = engine(); e1.t.up = new Set([R1]);
  e1.S.subscribeCareKey();
  e1.t._localBlocked = new Set([M3.pub]); e1.t._localBlockedAt = 1;   // a blocklist this console has read or written (round 3f: the runner re-checks against it)
  assert.deepEqual(await e1.S.rotateCareKey([M1.pub], [], { drop: [M3.pub] }), { pending: true }, 'CONTROL: not remembered');
  const e2 = engine(); e2.t.up = new Set([R1]); e2.t.localStorage = e1.t.localStorage; e2.t.window.Steward = e2.S;
  e2.t._localBlocked = new Set([M3.pub]); e2.t._localBlockedAt = 1;   // a blocklist this console has read or written (round 3f: the runner re-checks against it)
  e2.S.subscribeCareKey();
  const s = e2.subs.at(-1);
  s.handlers.onevent(envAt(CAREKEY_D, A, [K1], [A.pub, M1.pub, M3.pub], OLD_AT, 1)); await e2.eose(s);
  for (let i = 0; i < 6; i++) await flush();
  const out = e2.published.find(ev => dtag(ev) === CAREKEY_D + A.pub);
  assert.ok(out && !Object.keys(JSON.parse(out.content).keys).includes(M3.pub), 'A ROTATION REMEMBERED BEFORE A RELOAD DID NOT RUN AFTER IT');
});
test('3e MED 1: an Unblock takes the person back out of a remembered rotation', async () => {
  const e = engine(); e.t.up = new Set([R1]);
  e.S.subscribeCareKey();
  await e.S.rotateCareKey([M1.pub], [], { drop: [M3.pub] });
  assert.deepEqual((pendingOf(e).care || {}).drop, [M3.pub], 'CONTROL: not remembered');
  e.t._localBlocked = new Set([M3.pub]); e.t._localBlockedAt = 1;   // a blocklist this console has read or written (round 3f: the runner re-checks against it)
  await e.S.setBlocked([], { unblock: [M3.pub] });
  for (let i = 0; i < 4; i++) await flush();
  assert.equal(pendingOf(e).care, undefined, 'AN UNBLOCKED PERSON IS STILL WAITING TO BE ROTATED OUT');
});
test('3e MED 1: the name key — a Block before its read settles is remembered and runs when it settles', async () => {
  const e = engine(); e.t.up = new Set([R1]); e.t.window.Steward = e.S;
  e.S.subscribeNameKey();
  const s = e.subs.at(-1);
  e.t._localBlocked = new Set([M3.pub]); e.t._localBlockedAt = 1;   // a blocklist this console has read or written (round 3f: the runner re-checks against it)
  const r = await e.S.ensureNameKeyForMembers([M1.pub], [], { rotate: true, drop: [M3.pub] });
  assert.deepEqual(r, { pending: true }, 'a name-key rotation before the read settled was not remembered (block() called it a failure)');
  const p0 = e.published.length;
  s.handlers.onevent(envelope(NAMEKEY_D, A, A.pub, ['aa'.repeat(32)], [A.pub, M1.pub, M2.pub, M3.pub])); await e.eose(s);
  for (let i = 0; i < 6; i++) await flush();
  const out = e.published.slice(p0).find(ev => dtag(ev) === NAMEKEY_D + A.pub);
  assert.ok(out, 'THE REMEMBERED NAME-KEY ROTATION NEVER RAN');
  const to = Object.keys(JSON.parse(out.content).keys);
  assert.ok(!to.includes(M3.pub) && to.includes(M1.pub) && to.includes(M2.pub), 'the remembered name-key rotation got its recipients wrong: ' + to.length);
});

// ── ROUND 3f (audit of 4bb1ed1): THE REMEMBERED ROTATIONS ─────────────────────────────────────────────────────────────
const remember = (e, kind, drop, why) => { const o = pendingOf(e); o[kind] = { drop, why: Object.fromEntries(drop.map(p => [p, why])) }; e.t.localStorage.setItem('trinityone.steward.pendingrot.' + A.pub, JSON.stringify(o)); };
async function readyCare(e, holders) {
  e.S.subscribeCareKey();
  const s = e.subs.at(-1);
  s.handlers.onevent(envAt(CAREKEY_D, A, [K1], holders, OLD_AT, 1)); await e.eose(s);
}
// T1 — the rotation itself must take the person out. With them BLOCKED the blocklist hid a broken filter; a REMOVED
// DELEGATE is not blocked, so only the rotation's own `drop` keeps the new key from them.
test('3f T1: a remembered rotation for a REMOVED DELEGATE (not blocked) leaves them out — the rotation\'s own filter, not the blocklist', async () => {
  const e = engine(); e.t.up = new Set([R1]); e.t.window.Steward = e.S;
  e.t._localBlockedAt = 1; e.t._careRosterKnown = true; e.t._careRoster = new Set();   // the roster has been read: ST is not on it
  remember(e, 'care', [M3.pub], 'remove');                 // M3 stands in for the removed delegate
  const p0 = e.published.length;
  await readyCare(e, [A.pub, M1.pub, M3.pub]);
  for (let i = 0; i < 6; i++) await flush();
  const out = e.published.slice(p0).find(ev => dtag(ev) === CAREKEY_D + A.pub);
  assert.ok(out, 'CONTROL: the remembered rotation did not run');
  const to = Object.keys(JSON.parse(out.content).keys);
  assert.ok(!to.includes(M3.pub), 'THE REMOVED DELEGATE (NOT BLOCKED) WAS GIVEN THE NEW KEY — the remembered rotation did not take them out');
  assert.ok(to.includes(M1.pub), 'a holder who stays was dropped');
});
// P3 — the record is re-checked against the lists NOW: an Unblock, or a delegate put back, on ANOTHER console.
test('3f P3: a remembered rotation whose person was UNBLOCKED elsewhere — or whose delegate is back on the roster — is dropped, not run', async () => {
  for (const [why, setup] of [
    ['block', (e) => { e.t._localBlockedAt = 1; e.t._localBlocked = new Set(); }],                                   // a blocklist read since: M3 is not on it
    ['remove', (e) => { e.t._localBlockedAt = 1; e.t._careRosterKnown = true; e.t._careRoster = new Set([M3.pub]); }],   // M3 is back on the roster
  ]) {
    const e = engine(); e.t.up = new Set([R1]); e.t.window.Steward = e.S;
    setup(e);
    remember(e, 'care', [M3.pub], why);
    const p0 = e.published.length;
    await readyCare(e, [A.pub, M1.pub, M3.pub]);
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(e.published.slice(p0).filter(ev => dtag(ev) === CAREKEY_D + A.pub).length, 0, `(${why}) A REMEMBERED ROTATION RAN FOR SOMEONE NO LONGER ${why === 'block' ? 'BLOCKED' : 'REMOVED'} — the other console's decision was undone`);
    assert.equal(pendingOf(e).care, undefined, `(${why}) the stale record was kept — it would run later`);
  }
  // CONTROL: with the blocklist not yet read (only the device's copy), it waits — neither runs nor is dropped
  const e = engine(); e.t.up = new Set([R1]); e.t.window.Steward = e.S;
  e.t._localBlocked = new Set([M3.pub]); e.t._localBlockedAt = 0;
  remember(e, 'care', [M3.pub], 'block');
  await readyCare(e, [A.pub, M1.pub, M3.pub]);
  for (let i = 0; i < 6; i++) await flush();
  assert.ok(pendingOf(e).care, 'CONTROL: with only the device copy of the blocklist, the record was dropped or run');
});
// P1 — a ROOM key that failed is remembered too, and "Try again" runs it; with nothing left, "Try again" says done.
test('3f P1: a remembered ROOM rotation runs on "Try again" — the person out, the others kept — and an empty retry says done', async () => {
  const e = engine(); e.t.up = new Set([R1]); e.t.window.Steward = e.S;
  e.t._localBlocked = new Set([M3.pub]); e.t._localBlockedAt = 1;
  const gid = 'room-p1';
  e.t.__skeys[gid] = [unhex('dd'.repeat(32))]; e.t.__senvRecips[gid] = [A.pub, M1.pub, M3.pub]; e.t.__senvMine[gid] = true;
  e.S.rememberRotation('room:' + gid, [M3.pub], 'block');
  const p0 = e.published.length;
  await e.S.retryPendingRotations();
  const out = e.published.slice(p0).find(ev => dtag(ev) === 'trinityone/groupkey:' + gid);
  assert.ok(out, 'A REMEMBERED ROOM ROTATION DID NOT RUN ON "TRY AGAIN" — the screen would say "Trying again…" for ever');
  const to = Object.keys(JSON.parse(out.content).keys);
  assert.ok(!to.includes(M3.pub) && to.includes(M1.pub), 'the room rotation got its recipients wrong');
  assert.equal(pendingOf(e)['room:' + gid], undefined, 'the room rotation that ran is still remembered');
  e.events.length = 0;
  await e.S.retryPendingRotations();
  assert.ok(e.events.some(x => x.type === 'steward-rotation-done' && x.detail.left === 0), 'AN EMPTY "TRY AGAIN" SAID NOTHING — the screen\'s "Trying again…" would stick');
});
// P2 — the name key's rebuild: the envelope this console holds may be an OLDER one (another relay not caught up); members
// the console knows were added since must not be dropped — their phones would delete the name key.
test('3f P2: a remembered NAME-key rotation, read first from a relay holding an OLDER envelope, keeps the members added since', async () => {
  const e = engine(); e.t.relayList = [R1, R2]; e.t.up = new Set([R1, R2]); e.t.window.Steward = e.S;
  e.t._localBlocked = new Set([M3.pub]); e.t._localBlockedAt = 1;
  e.S.subscribeMembers(() => {});
  const mreads = e.subs.filter(r => r.d === 'trinityone/member:' + A.pub);
  const ts = 1759299000;
  for (const r of mreads) for (const k of [M1, M2, M3]) r.handlers.onevent({ pubkey: k.pub, kind: 30078, created_at: ts, tags: [['d', 'trinityone/member:' + A.pub], ['p', A.pub]], content: JSON.stringify({ joined: ts }) });
  for (const r of mreads) await e.eose(r);
  remember(e, 'name', [M3.pub], 'block');
  e.S.subscribeNameKey();
  const n1 = e.subs.filter(r => r.d === NAMEKEY_D + A.pub).find(r => r.url === R1);
  const p0 = e.published.length;
  n1.handlers.onevent(envelope(NAMEKEY_D, A, A.pub, ['aa'.repeat(32)], [A.pub, M1.pub, M3.pub]));   // R1: the OLDER envelope, before M2 joined
  await e.eose(n1);
  await e.S.retryPendingRotations();
  for (let i = 0; i < 6; i++) await flush();
  const out = e.published.slice(p0).find(ev => dtag(ev) === NAMEKEY_D + A.pub);
  assert.ok(out, 'CONTROL: the remembered name-key rotation did not run');
  const to = Object.keys(JSON.parse(out.content).keys);
  assert.ok(to.includes(M2.pub), 'A MEMBER ADDED SINCE THE OLDER ENVELOPE (M2) WAS DROPPED FROM THE NAME KEY — their phone deletes it');
  assert.ok(!to.includes(M3.pub) && to.includes(M1.pub), 'the name-key rotation got the leaver or a holder wrong');
});
// P4 — "every relay" is the church's relays NOW: a relay admitted since the member list settled un-freshes it until read.
test('3f P4: when the church\'s relay set grows, the member list is no longer fresh — until the new set has answered', async () => {
  const e = engine(); e.t.relayList = [R1]; e.t.up = new Set([R1, R2]);
  const ls = {}; e.t.window.addEventListener = (t, f) => { (ls[t] = ls[t] || []).push(f); }; e.t.window.removeEventListener = () => {};
  let last = null;
  e.S.subscribeMembers((l) => { last = l; });
  await e.eose(e.subs.find(r => r.d === 'trinityone/member:' + A.pub && r.url === R1));
  assert.ok(e.S.listIsFresh(last), 'CONTROL: one relay, answered — the list is not fresh');
  e.t.relayList = [R1, R2];                                  // a relay is admitted
  assert.ok(!e.S.listIsFresh(last), 'A RELAY ADMITTED SINCE DID NOT UN-FRESH THE MEMBER LIST — it may hold someone\'s member document');
  for (const f of (ls['steward-relays'] || [])) f();         // the console's signal that the set changed: the read asks again
  const reads = e.subs.filter(r => r.d === 'trinityone/member:' + A.pub && !r.closed);
  assert.ok(reads.some(r => r.url === R2), 'THE MEMBER READ DID NOT ASK THE NEW RELAY when the set changed');
  for (const r of reads) await e.eose(r);
  assert.ok(e.S.listIsFresh(last), 'once the new set had answered, the member list did not become fresh again');
});
