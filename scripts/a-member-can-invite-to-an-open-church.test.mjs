// ANY MEMBER OF AN OPEN CHURCH MAY SHARE ITS JOIN LINK — and the link names the church's own box.
// Run: node --test scripts/a-member-can-invite-to-an-open-church.test.mjs
//
// Owner decision 2026-11-17 (reference/DOMAIN.md); plan + audit amendments in
// reference/PLAN-member-invite-open-church-2026-11-17.html. Four pieces, each driven as SHIPPED code:
//
//   1. THE GATE — `openKnown` from the shipped subscribeChurchJoin, lifted out of vendor/fellowship.js (the BUNDLE,
//      with the bundle's own names) together with the shipped _onChurchDocs, so the cached-replay path is the real
//      one. Default-deny; each author's newest copy; trust re-decided on every emit (amendment H1, H2).
//   2. THE BOX — the shipped Fellowship.inviteRelayFor + relaysForChurch + _netRelays + _inviteHostIsPrivate + the
//      shipped CANONICAL tables, out of the bundle (amendments M1-M3). The relay GATE is a stub (a table of which
//      address proved which key): what is under test is what this code does with the gate's answers, never the
//      possession proof itself, which an-invite-cannot-choose-your-relay.test.mjs runs against real relays.
//   3. THE SHEET — the real InviteSheet compiled from app/identity-extras.jsx, wired to the lifted inviteRelayFor,
//      and the URL it hands to the native share sheet read back (so deleting the inviteRelayFor call fails).
//   4. THE CHURCH ID — the shipped joinState effect sliced out of app/app.jsx and RUN: the state it stores carries
//      the church it is about (amendment L1), which is what the community menu compares.
//
// The menu itself is asserted in scripts/community-top-bar-is-one-row.test.mjs (both layers). Nothing here matches
// text in app/*.jsx (CLAUDE.md rule 3); the slices are executed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { decode as nip19decode, npubEncode } from 'nostr-tools/nip19';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const FELLOW = read('vendor/fellowship.js');
const APPJSX = read('app/app.jsx');

// A name the lifted code needs and nobody stubbed is a ReferenceError NAMING it — never an undefined swallowed by
// one of this code's many try/catch blocks (memory: lifted bundle functions need BUNDLE names).
function scopeOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// ═══════════════════════════════ 1. THE GATE: openKnown ═══════════════════════════════
const church = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
const steward = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
const stranger = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
const ME = getPublicKey(generateSecretKey());
const JP = 'trinityone/joinpolicy:' + church.pub;
const policy = (who, at, content, deleted = false) => finalizeEvent({ kind: 30078, created_at: at,
  tags: [['d', JP], ['t', 'trinityone'], ...(deleted ? [['deleted', '1']] : [])], content: content == null ? '' : JSON.stringify(content) }, who.sk);

// The shipped subscribeChurchJoin + the shipped _onChurchDocs (its replay is the cached path, H2), over a hub stub
// that stands where _docsHub/_docsHubOpen would: `buf` is what the hub has on disk from the last session.
function joinSub({ roster = [], cached = [] } = {}) {
  const src = FELLOW;
  const method = fnBody(src, '    subscribeChurchJoin(churchNpub, onState) {', 'subscribeChurchJoin');
  assert.match(method, /openKnown: _openKnown\(\)/, 'vendor/fellowship.js: subscribeChurchJoin no longer emits openKnown — rebuild the bundle (npm run build:fellowship) or re-anchor');
  const body = [
    fnBody(src, 'function toPub', 'toPub'),
    stmt(src, 'var GROUPKEY_D = ', 'GROUPKEY_D'),
    fnBody(src, 'function _dkeyOf', '_dkeyOf'),
    stmt(src, 'var _dtag = ', '_dtag'),
    fnBody(src, 'function _onChurchDocs', '_onChurchDocs'),
  ].join('\n');
  const hub = { refs: 0, handlers: new Set(), buf: new Map(), idx: new Map(), eosed: cached.length > 0, closer: null };
  for (const e of cached) {
    hub.buf.set(e.id, e);
    const dk = 'joinpolicy';
    if (!hub.idx.has(dk)) hub.idx.set(dk, new Map());
    hub.idx.get(dk).set(e.id, e);
  }
  const rosterMap = new Map();
  if (roster.length) rosterMap.set(church.pub, new Set(roster));
  const failures = [];
  const scope = scopeOf({
    window: { Fellowship: { myPubkey: ME } }, pub: null, decode: nip19decode,
    _churchRoster: rosterMap, authState: () => ({ failed: false }),
    _featureFailed: (...a) => failures.push(a), _docsHub: () => hub, _docsHubOpen: () => {}, _docsHubSaveNow: () => {},
    Map, Set, String, JSON, Array, Object, Number,
  });
  const api = new Function('scope', `with (scope) { ${body}\n const _api = { ${method} };\n return { sub: (n, cb) => _api.subscribeChurchJoin(n, cb), dtag: _dtag }; }`)(scope);
  const states = [];
  const stop = api.sub(npubEncode(church.pub), (s) => states.push(s));
  const live = (e) => { for (const h of hub.handlers) h.onevent(e, api.dtag(e)); };
  const setRoster = (keys) => { rosterMap.set(church.pub, new Set(keys)); for (const h of hub.handlers) if (h.onroster) h.onroster(); };
  const last = () => states[states.length - 1] || null;
  return { states, live, setRoster, last, stop, failures, open: () => !!(last() && last().openKnown === true) };
}

test('GATE control: no policy document → NOT open; the church\'s own approval:false → open; the existing fields are still emitted', () => {
  const j = joinSub();
  j.live(finalizeEvent({ kind: 30078, created_at: 50, tags: [['d', 'trinityone/admitted:' + church.pub]], content: JSON.stringify({ pubkeys: [ME] }) }, church.sk));
  assert.ok(j.last(), 'anchor: an admitted list arriving emits a state');
  assert.equal(j.last().openKnown, false, 'an emit with no join policy at all must not say "open" — approval:false there means "never heard"');
  j.live(policy(church, 100, { approval: false }));
  assert.equal(j.open(), true, 'the church key signing approval:false is the one thing that makes a church known-open');
  for (const k of ['approval', 'isAdmitted', 'isPending', 'authFailed']) assert.ok(k in j.last(), `subscribeChurchJoin stopped emitting ${k}`);
  assert.equal(j.last().isAdmitted, true);
  assert.deepEqual(j.failures, []);
});

test('GATE H1: the church says approval ON at 200 and an older steward copy says OFF at 100 → NOT open, in either arrival order', () => {
  for (const order of ['church-first', 'steward-first']) {
    const j = joinSub({ roster: [steward.pub] });
    const evs = [policy(church, 200, { approval: true }), policy(steward, 100, { approval: false })];
    for (const e of (order === 'church-first' ? evs : evs.reverse())) j.live(e);
    assert.equal(j.open(), false, `${order}: the NEWEST trusted copy (approval on) must win, not whichever arrived last`);
  }
});

test('GATE H1: a steward\'s newer "approval ON" that arrives BEFORE the roster is counted the moment the roster names them', () => {
  const j = joinSub();   // no roster yet
  j.live(policy(church, 100, { approval: false }));
  assert.equal(j.open(), true, 'anchor: the church alone says open');
  j.live(policy(steward, 200, { approval: true }));
  assert.equal(j.open(), true, 'a copy from a key not (yet) on the roster does not count');
  j.setRoster([steward.pub]);
  assert.equal(j.open(), false, 'the roster arrived naming that steward: their newer approval-ON copy, kept from before, now wins');
  j.setRoster([]);
  assert.equal(j.open(), true, 'the steward is revoked: their copy stops counting and the church\'s own answer stands again');
});

test('GATE: a later deletion, an empty body, approval:true, or garbage from the winner → NOT open', () => {
  const j = joinSub();
  j.live(policy(church, 100, { approval: false }));
  assert.equal(j.open(), true, 'anchor');
  j.live(policy(church, 200, null, true));
  assert.equal(j.open(), false, 'a later deletion of the policy must close it');
  const k = joinSub();
  k.live(policy(church, 100, { approval: false }));
  k.live(finalizeEvent({ kind: 30078, created_at: 300, tags: [['d', JP]], content: 'not json' }, church.sk));
  assert.equal(k.open(), false, 'an unparseable newer copy is not "open"');
  const m = joinSub();
  m.live(policy(church, 100, {}));
  assert.equal(m.open(), false, 'a document that does not SAY approval:false is not open (default-deny)');
  const o = joinSub();
  o.live(policy(church, 300, { approval: false }));
  o.live(policy(church, 200, null, true));
  assert.equal(o.open(), true, 'an OLDER deletion arriving late does not override the newer live copy');
});

test('GATE: a copy signed by a key that is neither the church nor on its roster is ignored', () => {
  const j = joinSub({ roster: [steward.pub] });
  j.live(policy(stranger, 500, { approval: false }));
  assert.equal(j.open(), false, 'a stranger cannot declare somebody else\'s church open');
  j.live(policy(church, 100, { approval: true }));
  j.live(policy(stranger, 600, { approval: false }));
  assert.equal(j.open(), false);
});

test('GATE: a same-second tie between two trusted copies goes to the LOWEST event id, as the relays decide it', () => {
  const a = policy(church, 400, { approval: false }), b = policy(steward, 400, { approval: true });
  const lowOpen = a.id < b.id;
  for (const order of [[a, b], [b, a]]) {
    const j = joinSub({ roster: [steward.pub] });
    for (const e of order) j.live(e);
    assert.equal(j.open(), lowOpen, 'the tie must be decided by id, independent of arrival order');
  }
});

test('GATE H2: the docs hub\'s CACHED replay (no relay reached) paints the church\'s signed answer under the same rule', () => {
  const j = joinSub({ cached: [policy(church, 100, { approval: false })] });
  assert.ok(j.states.length > 0, 'anchor: the cached replay emitted during subscribe, with no live event at all');
  assert.equal(j.open(), true, 'a cached signed approval:false replays as open (accepted by the plan audit, H2)');
  const k = joinSub({ roster: [steward.pub], cached: [policy(steward, 200, { approval: true }), policy(church, 100, { approval: false })] });
  assert.equal(k.open(), false, 'the replay is newest-wins too: a cached newer steward approval-ON keeps it closed');
  const m = joinSub({ cached: [policy(church, 100, { approval: false }), policy(church, 200, null, true)] });
  assert.equal(m.open(), false, 'a cached later deletion keeps it closed');
});

// ═══════════════════════════════ 2. THE BOX: inviteRelayFor ═══════════════════════════════
const SHIPPED = (() => { const m = /var CANONICAL_RELAYS = \[\s*"([^"]+)"/.exec(FELLOW); assert.ok(m, 'anchor: CANONICAL_RELAYS'); return m[1]; })();
const SHARED_KEY = (() => { const m = /var SHARED_RELAY_KEYS = Object\.freeze\(\[\s*"([0-9a-f]{64})"/.exec(FELLOW); assert.ok(m, 'anchor: SHARED_RELAY_KEYS'); return m[1]; })();
const hex = () => getPublicKey(generateSecretKey());

// `admitted`: url -> the key that address proved (what _gate.admit / _gate.provedKey answer). `relays`: the phone's
// raw candidate list (window.Fellowship.relays). `docs`: cp -> { entries, docAt } as churchRelayNet caches it.
function inviter({ relays = [], admitted = {}, docs = {} } = {}) {
  const src = FELLOW;
  const method = fnBody(src, '    inviteRelayFor(churchNpub) {', 'inviteRelayFor');
  const body = [
    fnBody(src, 'function toPub', 'toPub'),
    stmt(src, 'var SHARED_RELAY_KEYS = ', 'SHARED_RELAY_KEYS'),
    stmt(src, 'var SHARED_RELAY_HINTS = ', 'SHARED_RELAY_HINTS'),
    stmt(src, 'var CANONICAL_RELAY_PUBS = ', 'CANONICAL_RELAY_PUBS'),
    stmt(src, 'var CANONICAL_RELAYS = ', 'CANONICAL_RELAYS'),
    stmt(src, 'var CANONICAL_RELAY = ', 'CANONICAL_RELAY'),
    fnBody(src, 'function _otherChurchesNetDocRows', '_otherChurchesNetDocRows'),
    fnBody(src, 'function _netRelays', '_netRelays'),
    fnBody(src, 'function relaysForChurch', 'relaysForChurch'),
    fnBody(src, 'function _inviteHostIsPrivate', '_inviteHostIsPrivate'),
  ].join('\n');
  const asked = { admit: [], provedKey: [] };
  const gate = {
    admit(list, cp) { asked.admit.push({ list: [...list], cp }); return list.filter(u => Object.prototype.hasOwnProperty.call(admitted, u)); },
    provedKey(u, cp) { asked.provedKey.push({ u, cp }); return Object.prototype.hasOwnProperty.call(admitted, u) ? admitted[u] : ''; },
  };
  const cache = new Map(Object.entries(docs));
  const win = { Fellowship: { relays: [...relays], churchPub: church.pub } };
  const scope = scopeOf({
    window: win, localStorage: memStore(), decode: nip19decode, normalizeURL2: normalizeURL,
    _gate: gate, _relayNetCache: cache, _churchRelays: new Map(), _loadChurchBoxes: () => [],
    URL, Map, Set, String, JSON, Array, Object, Number,
  });
  const api = new Function('scope', `with (scope) { ${body}\n const _api = { ${method} };\n return { pick: (n) => _api.inviteRelayFor(n), CANONICAL_RELAY }; }`)(scope);
  api.asked = asked; api.win = win; api.cache = cache;
  return api;
}
const OWN = 'wss://box.stmarys-example.org/relay';
const doc = (entries, docAt = 1700000000) => ({ at: Date.now(), entries, docAt });
const NP = npubEncode(church.pub);

test('BOX control: an own box this phone ADMITTED, whose proved key the church\'s signed document names → the link names it, with that entry\'s name', () => {
  const K = hex();
  const f = inviter({ relays: [OWN], admitted: { [OWN]: K, [SHIPPED]: SHARED_KEY }, docs: { [church.pub]: doc([{ pubkey: K, alwaysOn: true, url: 'wss://stale-tunnel.example/relay', name: 'stmarys' }]) } });
  assert.equal(f.CANONICAL_RELAY, SHIPPED, 'anchor: the lifted CANONICAL_RELAY is the shipped one');
  assert.deepEqual(f.pick(NP), { relay: OWN, relayname: 'stmarys' });
  assert.ok(f.asked.admit.some(a => a.cp === church.pub), 'the candidate set went through the admission gate for THIS church');
});

test('BOX: a cold cache (no relay-net document read yet), or a document nobody returned (docAt 0) → the shared relay, no name', () => {
  const K = hex();
  const cold = inviter({ relays: [OWN], admitted: { [OWN]: K } });
  assert.deepEqual(cold.pick(NP), { relay: SHIPPED, relayname: '' });
  const none = inviter({ relays: [OWN], admitted: { [OWN]: K }, docs: { [church.pub]: doc([{ pubkey: K, alwaysOn: true, url: OWN, name: 'stmarys' }], 0) } });
  assert.deepEqual(none.pick(NP), { relay: SHIPPED, relayname: '' }, 'docAt 0 is "nobody answered", not a signed list');
});

test('BOX M3: an admitted, signed own box on a loopback / private / LAN / link-local / dotless host → the shared relay', () => {
  const hosts = ['wss://127.0.0.1:4848/relay', 'wss://localhost/relay', 'wss://192.168.1.20/relay', 'wss://10.0.0.5/relay',
    'wss://172.20.1.1/relay', 'wss://100.100.7.7/relay', 'wss://169.254.3.3/relay', 'wss://0.0.0.0/relay', 'wss://[::1]/relay',
    'wss://[fd12::1]/relay', 'wss://[fe80::1]/relay', 'wss://box.local/relay', 'wss://box.lan/relay', 'wss://box.home.arpa/relay',
    'wss://relaybox/relay', 'wss://2130706433/relay', 'wss://[::ffff:127.0.0.1]/relay'];
  for (const u of hosts) {
    const K = hex();
    const f = inviter({ relays: [u], admitted: { [u]: K }, docs: { [church.pub]: doc([{ pubkey: K, alwaysOn: true, url: u, name: 'home' }]) } });
    assert.deepEqual(f.pick(NP), { relay: SHIPPED, relayname: '' }, `${u} would travel in a join link to a phone on another network`);
  }
  // and the CONTROL for this case: a public host at a 172.x outside /12 is not private
  const K = hex(), pubHost = 'wss://172.32.0.1/relay';
  const ok = inviter({ relays: [pubHost], admitted: { [pubHost]: K }, docs: { [church.pub]: doc([{ pubkey: K, alwaysOn: true, url: pubHost }]) } });
  assert.deepEqual(ok.pick(NP), { relay: pubHost, relayname: '' }, 'an ordinary public address must still be chosen');
});

test('BOX rule 10: a box in the raw relay list that the gate has NOT admitted is never chosen, even though the church signed its key', () => {
  const K = hex();
  const f = inviter({ relays: [OWN], admitted: { [SHIPPED]: SHARED_KEY }, docs: { [church.pub]: doc([{ pubkey: K, alwaysOn: true, url: OWN, name: 'stmarys' }]) } });
  assert.ok(f.win.Fellowship.relays.includes(OWN), 'anchor: the box IS in the raw candidate list');
  assert.deepEqual(f.pick(NP), { relay: SHIPPED, relayname: '' });
});

test('BOX trap 2: an admitted box whose proved key the church\'s document does NOT name is never chosen — even at the URL the document lists', () => {
  const K = hex(), other = hex();
  const f = inviter({ relays: [OWN], admitted: { [OWN]: K }, docs: { [church.pub]: doc([{ pubkey: other, alwaysOn: true, url: OWN, name: 'stmarys' }]) } });
  assert.deepEqual(f.pick(NP), { relay: SHIPPED, relayname: '' }, 'matched on the KEY, never the URL');
  // ANOTHER church's document naming this key does not count for this church
  const g = inviter({ relays: [OWN], admitted: { [OWN]: K }, docs: { [other]: doc([{ pubkey: K, alwaysOn: true, url: OWN, name: 'theirs' }]) } });
  assert.deepEqual(g.pick(NP), { relay: SHIPPED, relayname: '' });
});

test('BOX: never a shipped relay (by address or by its shared key), never ws://; several own boxes → alwaysOn first, then URL order', () => {
  const alias = 'wss://a8-alias.example.org/relay';
  const f = inviter({ relays: [alias], admitted: { [SHIPPED]: SHARED_KEY, [alias]: SHARED_KEY }, docs: { [church.pub]: doc([{ pubkey: SHARED_KEY, alwaysOn: true, url: SHIPPED }]) } });
  assert.deepEqual(f.pick(NP), { relay: SHIPPED, relayname: '' }, 'the shared box at another address is still the shared box: no own-box name');
  const K = hex(), plain = 'ws://box.stmarys-example.org/relay';
  const g = inviter({ relays: [plain], admitted: { [plain]: K }, docs: { [church.pub]: doc([{ pubkey: K, alwaysOn: true, url: plain }]) } });
  assert.deepEqual(g.pick(NP), { relay: SHIPPED, relayname: '' }, 'a cleartext relay never goes in a link (L5)');
  const K1 = hex(), K2 = hex(), K3 = hex();
  const z = 'wss://z-box.example.org/relay', a = 'wss://a-box.example.org/relay', m = 'wss://m-box.example.org/relay';
  const entries = [{ pubkey: K1, alwaysOn: false, url: a, name: 'sometimes' }, { pubkey: K2, alwaysOn: true, url: z, name: 'zed' }, { pubkey: K3, alwaysOn: true, url: m, name: 'em' }];
  for (const relays of [[a, z, m], [m, z, a], [z, a, m]]) {
    const h = inviter({ relays, admitted: { [a]: K1, [z]: K2, [m]: K3 }, docs: { [church.pub]: doc(entries) } });
    assert.deepEqual(h.pick(NP), { relay: m, relayname: 'em' }, `order ${relays.join(',')}: alwaysOn first, then the lowest URL — the same link from every member`);
  }
});

// ═══════════════════════════════ 3. THE SHEET: what is actually shared ═══════════════════════════════
function inviteSheet(F, churchNpub = NP) {
  const { React, draw } = miniReact();
  const shared = [], qr = [], toasts = [];
  const win = {
    Fellowship: F,
    TrinityIdentity: { qrSVG: (t) => { qr.push(t); return '<svg/>'; } },
    Capacitor: { isNativePlatform: () => true, Plugins: { Share: { share: async (o) => { shared.push(o.url); } } } },
    addEventListener() {}, removeEventListener() {},
  };
  const g = {
    React, window: win,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    BottomSheet: (p) => p.children, Sheet: (p) => p.children,
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    copyText: () => {},
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
  };
  const { InviteSheet } = loadScreen('app/identity-extras.jsx', ['InviteSheet'], g);
  const ctx = { church: { npub: churchNpub, name: 'St Mary', id: churchNpub }, toast: (t) => toasts.push(t) };
  const tree = draw(InviteSheet, { open: true, onClose() {}, ctx, identity: {} });
  const share = find(tree, n => n.type === 'button' && find(n, k => k.props && k.props['data-icon'] === 'share').length)[0];
  assert.ok(share, 'anchor: the sheet has a share button');
  return { tree, qr, toasts, share: async () => { await share.props.onClick(); return shared[shared.length - 1]; } };
}
const qs = (u) => Object.fromEntries(new URL(u).searchParams);

test('SHEET: the invite a member SHARES from an open self-hosted church names the church\'s own box and its signed name', async () => {
  const K = hex();
  const f = inviter({ relays: [OWN], admitted: { [OWN]: K, [SHIPPED]: SHARED_KEY }, docs: { [church.pub]: doc([{ pubkey: K, alwaysOn: true, url: OWN, name: 'stmarys' }]) } });
  const s = inviteSheet({ CANONICAL_RELAY: SHIPPED, inviteRelayFor: (n) => f.pick(n) });
  const url = await s.share();
  assert.ok(url, 'the share sheet was never handed a URL');
  assert.equal(new URL(url).origin, 'https://app.trinityone.church');
  assert.deepEqual(qs(url), { follow: NP, relay: OWN, relayname: 'stmarys' }, 'the shared link must carry the church\'s own box like Steward.joinUrl() does');
  assert.deepEqual(s.qr, [url], 'the QR on screen encodes the same link that is shared');
});

test('SHEET: with no own box (cold cache) the shared link is exactly the old one — shared relay, no relayname', async () => {
  const f = inviter({ relays: [OWN], admitted: { [OWN]: hex() } });
  const s = inviteSheet({ CANONICAL_RELAY: SHIPPED, inviteRelayFor: (n) => f.pick(n) });
  const url = await s.share();
  assert.deepEqual(qs(url), { follow: NP, relay: SHIPPED });
  // and an inviteRelayFor that misbehaves cannot put anything odd in the link
  for (const bad of [() => { throw new Error('boom'); }, () => ({ relay: 'ws://plain.example/relay', relayname: 'x' }), () => null, () => ({ relay: SHIPPED, relayname: 'stmarys' })]) {
    const t = inviteSheet({ CANONICAL_RELAY: SHIPPED, inviteRelayFor: bad });
    assert.deepEqual(qs(await t.share()), { follow: NP, relay: SHIPPED }, 'a bad or shared-relay answer must leave the old link, with no name');
  }
});

// ═══════════════════════════════ 4. THE CHURCH ID on joinState (L1) ═══════════════════════════════
test('APP L1: the shipped joinState effect stores WHICH church an answer is about, and passes openKnown through', () => {
  const head = APPJSX.indexOf('const joinChurchRef = React.useRef(null);');
  assert.notEqual(head, -1, 'anchor: joinChurchRef in app/app.jsx');
  const at = APPJSX.indexOf('() => {', head);
  const effect = fnBody(APPJSX, at, 'the joinState effect');
  assert.match(effect, /subscribeChurchJoin/, 'anchor: this is the joinState effect');
  const CP = npubEncode(church.pub);
  const sets = [], ls = new Map();
  let cb = null;
  const setJoinState = (v) => { const prev = sets.length ? sets[sets.length - 1] : null; sets.push(typeof v === 'function' ? v(prev) : v); };
  const run = new Function('churches', 'activeChurch', 'window', 'setJoinState', 'joinChurchRef', 'lsGet', 'lsSet', 'localStorage', 'setTimeout', 'clearTimeout', 'return (' + effect + ')();');
  const unsub = run([{ id: CP, npub: CP }], CP, { Fellowship: { subscribeChurchJoin: (n, f) => { assert.equal(n, CP); cb = f; return () => {}; } } },
    setJoinState, { current: null }, (k) => ls.get(k) || null, (k, v) => ls.set(k, v), { getItem: () => null }, () => 0, () => {});
  assert.equal(typeof cb, 'function', 'the effect subscribed');
  assert.equal(sets[0].loaded, false, 'anchor: the church-change reset');
  assert.equal(sets[0].churchId, CP, 'the reset is tagged with the church it belongs to');
  cb({ approval: false, isAdmitted: true, isPending: false, authFailed: false, openKnown: true });
  const s = sets[sets.length - 1];
  assert.equal(s.churchId, CP, 'the live answer must carry its church id — the menu compares it with the church on screen');
  assert.equal(s.openKnown, true, 'openKnown reaches ctx.joinState');
  assert.equal(s.loaded, true);
  assert.equal(typeof unsub, 'function');
});
