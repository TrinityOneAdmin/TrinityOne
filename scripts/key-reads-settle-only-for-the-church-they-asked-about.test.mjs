// A KEY READ MAY OPEN A MINT GATE ONLY FOR THE CHURCH IT ASKED ABOUT, AND ONLY ON A REAL ANSWER.
//   Run: node --test scripts/key-reads-settle-only-for-the-church-they-asked-about.test.mjs
//
// `_careKeyChecked`, `_nameKeyChecked` and `_mediaKeyChecked` mean "we looked and this church has no envelope",
// and each one lets the console MINT a key — over the church's real one, if the answer was wrong. The audit of
// e6a2e02 (2026-10-01) measured it wrong 8 times in 10 on a real console: nostr-tools fires `oneose` when a
// subscription is CLOSED before its EOSE, the dashboard closes and re-opens these subscriptions on every
// identity change, and re-entering the SAME church passed every "still the current church?" check. A fresh
// one-key name ring was published over the church's real one.
//
// The browser test (console-keys-follow-the-church-switch) drives the real screen; this file pins each guard
// on its own, which a whole-console run cannot do deterministically. subscribeCareKey, subscribeNameKey,
// subscribeMediaKey, _ensureNameKeyLocked, ensureCareKeyForMembers and the key-read guards are sliced out of the
// SHIPPED vendor/steward.js and run with real NIP-44. The pool is a fake that behaves like nostr-tools in the
// one way that matters here: close() fires the subscription's oneose, asynchronously.
//
// The church switch is replayed by hand (pub/actingChurch and the key-state reset, as setActiveIdentity does);
// the browser test is what drives the real setActiveIdentity.
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
const ck = (a, b) => nip44.v2.utils.getConversationKey(a, b);
const flush = () => new Promise(r => setTimeout(r, 0));

// An envelope as a church's console publishes it: `ring` sealed by `author` to each of `recips`.
const envelope = (d, author, church, ring, recips, at = 1759300000) => ({ pubkey: author.pub, kind: 30078, created_at: at,
  tags: [['d', d + church], ['t', 'trinityone']],
  content: JSON.stringify({ rev: 1, keys: Object.fromEntries(recips.map(p => [p, nip44.v2.encrypt(JSON.stringify(ring), ck(author.sk, p))])) }) });

function engine() {
  const subs = [];          // every subscription the lifted code opened: { d, handlers, closed }
  const published = [];
  const signals = [];
  const t = {
    pub: A.pub, actingChurch: '', churchPub: A.pub, churchSk: A.sk, sk: A.sk,
    NET: 'trinityone', NAMEKEY_D, CAREKEY_D, MEDIAKEY_D, NAME_RING_MAX: 50,
    _careKeyHex: null, _careKeyRing: [], _careKeyDocKeys: null, _careKeyRev: 0, _careKeyChecked: false, _careKeyPending: [], _careKeyVer: 0,
    _careRoster: new Set(), _CAREKEY_PENDING_TTL: 12000,
    _mediaKeyHex: null, _mediaKeyRing: [], _mediaKeyDocKeys: null, _mediaKeyChecked: false, _mediaKeyPushRefused: null, _mediaKeyVer: 0,
    _nameKeyRing: [], _nameKeyDocKeys: null, _nameKeyChecked: false, _nameKeyAt: 0, _nameKeyBusy: null,
    _localBlocked: new Set(), toPubHex: (p) => p, _myOwnPub: () => A.pub,
    authed: true, _isRelayAuthed: () => t.authed,
    clock: 1000000, Date: { now: () => t.clock },
    now: () => 1759300000, _CLOCK_SKEW: 600,
    relays: () => ['wss://relay.example'],
    decrypt3: (c, k) => nip44.v2.decrypt(c, k), encrypt3: (p, k) => nip44.v2.encrypt(p, k), getConversationKey: ck,
    _hex: hex, _unhex: unhex, crypto,
    _webQueueSync: () => {}, _churchHasCareNeeds: async () => false,
    _sealEach: async (pl, targets, f) => Object.fromEntries([...targets].map(p => [p, f(pl, p)])),
    feChurch: (x) => ({ ...x, pubkey: A.pub }),
    publish: async (e) => { published.push(e); return { id: 'ok' }; },
    pool: {
      subscribeMany(urls, filters, handlers) {
        const rec = { d: ((filters[0] || {})['#d'] || [])[0], handlers, closed: false };
        subs.push(rec);
        // nostr-tools' SimplePool: close() → handleClose → handleEose → params.oneose, after `await allOpened`
        return { close() { if (rec.closed) return; rec.closed = true; Promise.resolve().then(() => { try { handlers.oneose && handlers.oneose(); } catch (e) {} }); } };
      },
    },
    window: { Steward: {}, dispatchEvent: (e) => { if (e.type === 'steward-keys-read') signals.push(e.detail.kind); return true; } },
    // what the REAL setActiveIdentity touches besides the key state (lifted below, for the epoch row)
    stewardedChurches: new Map([[B.pub, { name: 'B' }]]), netKeys: () => [],
    localStorage: { setItem() {}, getItem() { return null; } }, ACTIVE_ID_KEY: 'k',
    _loadBoxHosts() {}, _refreshBoxHostsUs() {}, _gate: { refresh() {} }, relaysRaw: () => [],
    lastProfile: {}, _profileLoaded: false, _clearanceSent: new Map(), _careRosterKnown: false, _careRosterSeen: false,
    _stewardCaps: {}, _stewardNames: {}, _stewardNamesCt: '', _stewardSince: {}, _applyNoPhotoList() {},
    CAP_KEYS: {}, _capState: {}, _checkinMigrated: '', _ckKeysSettled: '', _ckSessionKeys: new Map(), npubEncode: (p) => 'npub' + p,
    _clearedTrail: null, _authedRelays: new Map(),          // …and what _resetChurchScopedState (restoreKey's reset) touches
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
  const methods = [
    fnBody(BUNDLE, '    subscribeCareKey() {', 'subscribeCareKey in the shipped bundle'),
    fnBody(BUNDLE, '    subscribeNameKey() {', 'subscribeNameKey in the shipped bundle'),
    fnBody(BUNDLE, '    subscribeMediaKey() {', 'subscribeMediaKey in the shipped bundle'),
    fnBody(BUNDLE, '    async _ensureNameKeyLocked(memberPubs, stewardPubs, opts = {}) {', '_ensureNameKeyLocked in the shipped bundle'),
    fnBody(BUNDLE, '    async ensureCareKeyForMembers(memberPubs, stewardPubs, opts) {', 'ensureCareKeyForMembers in the shipped bundle'),
    fnBody(BUNDLE, '    setActiveIdentity(targetPub) {', 'setActiveIdentity in the shipped bundle'),
  ].join(',\n');
  t.t = t;
  const S = new Function('scope', `with (scope) { ${decls}\n return { ${methods} }; }`)(proxy);
  // setActiveIdentity's per-church key reset, replayed: the delegated branch for B, the own-church branch for A.
  const switchTo = (church) => {
    t.pub = church.pub; t.actingChurch = church === A ? '' : church.pub;
    t._careRoster = new Set();
    t._nameKeyRing = []; t._nameKeyDocKeys = null; t._nameKeyChecked = false; t._nameKeyAt = 0;
    t._careKeyHex = null; t._careKeyRing = []; t._careKeyDocKeys = null; t._careKeyRev = 0; t._careKeyChecked = false; t._careKeyPending = [];
    t._mediaKeyHex = null; t._mediaKeyRing = []; t._mediaKeyDocKeys = null; t._mediaKeyChecked = false; t._mediaKeyPushRefused = null;
    t._keyReadEpoch++; t._careKeyVer++; t._mediaKeyVer++;
  };
  return { S, t, subs, published, signals, switchTo };
}
const checked = (t, kind) => ({ care: t._careKeyChecked, name: t._nameKeyChecked, media: t._mediaKeyChecked })[kind];
const KINDS = [['care', 'subscribeCareKey'], ['name', 'subscribeNameKey'], ['media', 'subscribeMediaKey']];

// ── 1. THE ANSWER MUST BE THE RELAY'S, ABOUT NOW ──────────────────────────────────────────────────────────

for (const [kind, method] of KINDS) {
  test(`${kind}: CONTROL — a real, authenticated EOSE for the current church opens the gate and says so`, async () => {
    const e = engine();
    e.S[method]();
    e.subs.at(-1).handlers.oneose();
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
    e.subs.at(-1).handlers.oneose();
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
    forA.handlers.oneose();
    assert.equal(checked(e.t, kind), false, 'church A\'s read told church B\'s mint gate "looked"');
  });

  test(`${kind}: a read opened before a reset does not count after it, even for the same church`, async () => {
    const e = engine();
    e.S[method]();
    const stale = e.subs.at(-1);
    e.switchTo(A);                        // reset; the old subscription is still open (not yet cleaned up)
    stale.handlers.oneose();
    assert.equal(checked(e.t, kind), false, 'an end-of-stored-events from BEFORE the reset reopened the gate — the envelope it delivered was wiped by the reset');
  });

  test(`${kind}: nostr-tools' own 4.4 s timer is not an answer`, async () => {
    const e = engine();
    e.S[method]();
    e.t.clock += 4400;                    // Subscription.fire() → setTimeout(receivedEose, 4400)
    e.subs.at(-1).handlers.oneose();
    assert.equal(checked(e.t, kind), false, 'a timer-made EOSE ("the relay said nothing") was taken as "this church has no key"');
  });

  test(`${kind}: an unauthenticated answer does not count — and the read is asked again once the socket authenticates`, async () => {
    const e = engine();
    e.t.authed = false;
    e.S[method]();
    const first = e.subs.at(-1);
    first.handlers.oneose();
    assert.equal(checked(e.t, kind), false, 'an UNAUTHENTICATED end-of-stored-events opened the gate — the relay withholds private envelopes from that reader');
    e.t.authed = true;
    e.t.__runAuthWaiters();               // the signer, once this console has answered the relay's challenge
    assert.equal(e.subs.length, 2, 'the read was not asked again after authenticating — a church with no envelope yet would never get its first key');
    await flush();                        // the first subscription's close fires its oneose: still not an answer
    assert.equal(checked(e.t, kind), false, 'the close of the unauthenticated read was taken as the answer');
    e.subs.at(-1).handlers.oneose();
    assert.equal(checked(e.t, kind), true, 'the authenticated re-read\'s answer did not count');
  });
}

// THROUGH THE REAL setActiveIdentity: re-entering the church already active. The read had delivered the envelope
// BEFORE the switch (which wiped it) and answers AFTER it, without being closed. Unless the switch starts a new
// epoch, that answer says "looked, no key" over an empty ring — and the mint gate opens.
test('the REAL setActiveIdentity starts a new key-read epoch: an answer from before it cannot open the gate', async () => {
  const e = engine();
  for (const method of ['subscribeNameKey', 'subscribeCareKey', 'subscribeMediaKey']) e.S[method]();
  const [name, care, media] = e.subs.slice(-3).map(x => x.handlers);
  name.onevent(envelope(NAMEKEY_D, A, A.pub, ['dd'.repeat(32)], [A.pub]));
  assert.equal(e.t._nameKeyRing.length, 1, 'CONTROL: the envelope was read');
  assert.equal(e.S.setActiveIdentity(A.pub), true, 'CONTROL: the switch succeeded');
  assert.equal(e.t._nameKeyRing.length, 0, 'CONTROL: the switch reset the ring');
  name.oneose(); care.oneose(); media.oneose();            // the old reads answer — after the reset, never closed
  assert.equal(e.t._nameKeyChecked, false, 'AN ANSWER FROM BEFORE THE SWITCH OPENED THE NAME-KEY MINT GATE over an empty ring');
  assert.equal(e.t._careKeyChecked, false, 'an answer from before the switch opened the care-key mint gate');
  assert.equal(e.t._mediaKeyChecked, false, 'an answer from before the switch opened the media-key mint gate');
  assert.equal(await e.S._ensureNameKeyLocked([], []), null, 'the console went on to mint');
  assert.equal(e.published.length, 0, 'A FRESH NAME RING WAS PUBLISHED OVER THE CHURCH\'S REAL ONE');
});

test('the REAL _resetChurchScopedState (a key restore) starts a new key-read epoch too', async () => {
  const e = engine();
  for (const method of ['subscribeNameKey', 'subscribeCareKey', 'subscribeMediaKey']) e.S[method]();
  const [name, care, media] = e.subs.slice(-3).map(x => x.handlers);
  e.t.__resetChurchScopedState();
  name.oneose(); care.oneose(); media.oneose();
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
  e.S.subscribeCareKey(); e.subs.at(-1).handlers.oneose();   // B's own read: no envelope
  const r = await e.S.ensureCareKeyForMembers([], []);
  assert.notEqual(r, false, 'church A\'s buffered envelope blocked church B\'s care key for the length of the buffer\'s TTL');
  assert.equal(e.published.length, 1, 'church B\'s first care key was not published');
  assert.equal(((e.published[0].tags.find(x => x[0] === 'd')) || [])[1], CAREKEY_D + B.pub, 'CONTROL: published as church B\'s envelope');
});

// ── 3. A NAME-KEY PUBLISH DOES NOT ACT ON A STATE THAT MOVED WHILE IT SEALED ───────────────────────────────

test('name: the church\'s envelope landing while a first key is being sealed is adopted, never published over', async () => {
  const e = engine();
  e.S.subscribeNameKey();
  const h = e.subs.at(-1).handlers;
  h.oneose();                                             // a trustworthy "no envelope yet"
  let release; const gate = new Promise(r => { release = r; });
  const real = e.t._sealEach; e.t._sealEach = async (...a) => { await gate; return real(...a); };
  const run = e.S._ensureNameKeyLocked([], []);
  await flush();
  h.onevent(envelope(NAMEKEY_D, A, A.pub, ['cc'.repeat(32)], [A.pub]));   // another of the church's consoles published first
  release();
  assert.equal(await run, null, 'the console carried on with a mint decided before the envelope arrived');
  assert.equal(e.published.length, 0, 'A FRESH NAME KEY WAS PUBLISHED OVER THE ONE THAT HAD JUST ARRIVED — every name sealed under it stops opening');
  assert.deepEqual(e.t._nameKeyRing, ['cc'.repeat(32)], 'the console is not on the church\'s ring');
});

test('name: CONTROL — with nothing arriving, the first name key is minted and published', async () => {
  const e = engine();
  e.S.subscribeNameKey();
  e.subs.at(-1).handlers.oneose();
  const out = await e.S._ensureNameKeyLocked([], []);
  assert.ok(out, 'the first name key was not published');
  assert.equal(e.published.length, 1);
  assert.equal(e.t._nameKeyRing.length, 1, 'the console did not adopt the key it published');
});
