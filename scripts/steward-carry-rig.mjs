// THE OWNER CONSOLE'S CARRY-OVER, LIFTED OUT OF vendor/steward.js AND RUN AGAINST A REAL RELAY.
//
// Not a test (importing it runs nothing). Shared by the tests of "removing a steward keeps what they saved" (owner,
// 2026-11-17; reference/DOMAIN.md): scripts/a-removed-stewards-settings-do-not-revert.test.mjs and
// scripts/removing-a-steward-keeps-what-they-saved.test.mjs.
//
// The functions are the SHIPPED ones — _carryOverStewardDocs, _carryTemplate, _removeStewardKeeping, feChurch,
// setStewards, publishGroup, setNoPhoto, publishGroupKey, stewIngestKey — sliced out of the bundle by name and run in
// one scope (`with`), so a call from one to another is the shipped code. Only the TRANSPORT is replaced:
//   · `pool.subscribeMany` — a real websocket per relay, logged in as the console's key the way a long-lived console
//     socket is (the relay's NIP-42 challenge is lazy; a question asked on an unauthenticated socket is answered with
//     the private documents withheld, so the rig signs in first — see authedPool);
//   · `publish` / `_publishToRelays` — the real event to the real relay, answered with what the relay said.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody, stmt } from './test-slice.mjs';

export const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the console's _monotonic, per signer and d-tag across every engine in the process: two writes of one document in one
// second must not tie (the relay refuses the second as "a newer version is already stored")
const _stamps = new Map();
const conn = (url) => new Promise((res, rej) => { const w = new WebSocket(url); w.on('open', () => res(w)); w.on('error', rej); });
export const sendOn = (sock, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } };
  sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt]));
  setTimeout(() => { sock.off('message', on); res([false, '(no reply)']); }, 6000);
});

// A POOL THAT IS SIGNED IN, like a console's long-lived sockets. One socket per relay, opened on first use; before the
// first question it asks for `primeD` (a document the relay withholds from a stranger, so it challenges), answers the
// challenge as `who`, and waits for the relay's OK. `authedOn(url)` is what the shipped _keyReadAuthedOn reads.
export function authedPool(who, primeD) {
  const socks = new Map();   // url -> Promise<{ w, authed }>
  const open = (url) => {
    if (socks.has(url)) return socks.get(url);
    const p = (async () => {
      const w = await conn(url);
      const st = { w, authed: false, handlers: new Map() };
      w.on('message', (d) => {
        const m = JSON.parse(d);
        if (m[0] === 'AUTH' && typeof m[1] === 'string') {
          const a = finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', url], ['challenge', m[1]]], content: '' }, who.sk);
          st.authId = a.id; w.send(JSON.stringify(['AUTH', a]));
        } else if (m[0] === 'OK' && m[1] === st.authId) { st.authed = m[2] === true; }
        else if ((m[0] === 'EVENT' || m[0] === 'EOSE' || m[0] === 'CLOSED') && st.handlers.has(m[1])) st.handlers.get(m[1])(m);
      });
      w.on('close', () => { st.authed = false; st.closed = true; });
      // prime the login
      w.send(JSON.stringify(['REQ', 'prime', { kinds: [30078], '#d': [primeD] }]));
      const t0 = Date.now(); while (!st.authed && Date.now() - t0 < 3000) await sleep(25);
      w.send(JSON.stringify(['CLOSE', 'prime']));
      return st;
    })();
    socks.set(url, p);
    return p;
  };
  const known = new Map();   // url -> st (once opened), for the synchronous authedOn
  const pool = {
    asked: [],
    subscribeMany(urls, filters, handlers) {
      const id = 'c' + Math.random().toString(36).slice(2, 9);
      let closed = false, pending = urls.length;
      pool.asked.push({ urls, filters });
      for (const url of urls) {
        open(url).then((st) => {
          known.set(url, st);
          if (closed || st.closed) { if (--pending === 0 && handlers.oneose && !closed) handlers.oneose(); return; }
          st.handlers.set(id, (m) => {
            if (closed) return;
            if (m[0] === 'EVENT') handlers.onevent && handlers.onevent(m[2]);
            else if (--pending === 0 && handlers.oneose) handlers.oneose();
          });
          st.w.send(JSON.stringify(['REQ', id, ...filters]));
        }, () => { if (--pending === 0 && handlers.oneose && !closed) handlers.oneose(); });
      }
      return { close() { closed = true; for (const url of urls) { const st = known.get(url); if (st) { st.handlers.delete(id); try { st.w.send(JSON.stringify(['CLOSE', id])); } catch {} } } } };
    },
    authedOn: (url) => { const st = known.get(url); return !!(st && st.authed && !st.closed); },
    closeAll() { for (const p of socks.values()) p.then(st => { try { st.w.close(); } catch {} }, () => {}); socks.clear(); known.clear(); },
  };
  return pool;
}

// The console engine for `signer` (an owner console: actingChurch '' and pub = the church; a delegated one: actingChurch
// = the church and pub = the church, our own key signing). `publishTo(evt)` sends one event and answers [ok, why].
export function consoleEngine({ signer, church, actingChurch = '', relayUrl, publishTo, pool, extra = {} }) {
  const _landed = new Function('return ' + fnBody(STEWARD, 'function _landed(what, p) {', '_landed'))();
  const EVENT_POLICIES = new Function(stmt(STEWARD, 'var EVENT_POLICIES = ', 'EVENT_POLICIES') + '\nreturn EVENT_POLICIES;')();
  const _sha256hex = async (u8) => Buffer.from(await crypto.subtle.digest('SHA-256', u8)).toString('hex');
  const scope = {
    sk: signer.sk, pub: church, actingChurch, churchSk: signer.sk, churchPub: signer.pub,
    NET: 'trinityone', GROUP_D: 'trinityone/group:', GROUPKEY_D: 'trinityone/groupkey:', JOINPOLICY_D: 'trinityone/joinpolicy:',
    NOPHOTO_D: 'trinityone/nophoto:', STEWARDS_D: 'trinityone/stewards:', GROUP_RING_MAX: 12, EVENT_POLICIES,
    _skeys: {}, _srev: {}, _senvTs: {}, _senvRecips: {}, _senvMine: {}, _senvPending: new Map(), _noteEnvelopeDrops: () => {}, _gkChain: new Map(), _gkWaiting: new Map(), _localBlocked: new Set(),
    _isRelayAuthed: () => true, _requireTrustedView: () => {}, _landed,
    _monotonic: (t) => { const d = ((t.tags || []).find(x => x[0] === 'd') || [])[1] || ''; const k = signer.pub + '|' + d; const at = Math.max(t.created_at || 0, (_stamps.get(k) || 0) + 1); _stamps.set(k, at); return { ...t, created_at: at }; },
    _skewGate: (fn) => Promise.resolve(fn()), ensureSkew: () => null, SKEW_WAIT_MS: 6000,
    _stewardCaps: {}, _stewardNames: {}, _stewardSince: {}, _stewardNamesCt: null, _sealChurchDoc: () => null,
    _careRoster: new Set(), _careRosterKnown: true, _rosterTurn: Promise.resolve(), _justRemoved: new Map(),
    // the console's group list as subscribeGroups last emitted it, and whether that list is a genuine read (2026-11-19: the
    // carry asks it whether the church's care team still exists). Not loaded unless a test says so.
    _lastGroups: { cp: '', list: null }, _listIsFresh: (l) => !!(l && l._fresh),
    // what publish() records (F1 round): _lastOk = the created_at of the last copy a relay ACCEPTED per d-tag; _lastStamp =
    // the last stamp this console used. The admission gate's proved keys (none unless a test proves one) and a
    // localStorage of the console's own — the liveNewest memory lives there (owner answer s).
    _lastOk: new Map(), _lastStamp: new Map(), _gate: { provedKey: () => '' },
    _ls: new Map(), lsGet: (k) => (scope._ls.has(k) ? scope._ls.get(k) : null), lsSet: (k, v) => { scope._ls.set(k, String(v)); },
    localStorage: { getItem: (k) => (scope._ls.has(k) ? scope._ls.get(k) : null), setItem: (k, v) => { scope._ls.set(k, String(v)); }, removeItem: (k) => { scope._ls.delete(k); } },
    fetch: (...a) => fetch(...a), AbortController,
    _reCheckCareKeyPending: () => {}, _webQueueSync: () => {},
    _exStewards: new Set(), _exStewardSet: () => scope._exStewards,
    _exRemembered: [], _rememberExStewards: (before, after, at) => { scope._exRemembered.push({ before: [...before], after: [...after], at }); },
    _hex: (u) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join(''),
    _unhex: (h) => Uint8Array.from(Buffer.from(h, 'hex')),
    toPubHex: (p) => (/^[0-9a-f]{64}$/i.test(p) ? String(p).toLowerCase() : null),
    _authFuture: (e) => e.created_at > Math.floor(Date.now() / 1000) + 600,
    _byChurchOrSteward: (e) => e.pubkey === church || scope._careRoster.has(e.pubkey),
    now: () => Math.floor(Date.now() / 1000), _sha256hex,
    relays: () => [relayUrl], pool, _keyReadAuthedOn: (u) => pool.authedOn(u),
    sent: [], refused: '',
    publish: async (evt, opts) => {
      scope.sent.push(evt); const [ok, why] = await publishTo(evt);
      const d = ((evt.tags || []).find(t => t[0] === 'd') || [])[1];
      if (!ok) { scope.refused = why; try { if (opts && typeof opts === 'object') opts.reason = why; } catch {} return false; }
      if (d) scope._lastOk.set(d, evt.created_at || 0);
      return evt;
    },
    _publishToRelays: async (evt) => { scope.sent.push(evt); const [ok, why] = await publishTo(evt); if (!ok) scope.refused = why; return ok ? evt : null; },
    window: { Steward: {}, dispatchEvent: () => true },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    ...extra,
  };
  // the bundle's names for the signer and nip44 — read off the shipped bodies, never assumed
  const feBody = fnBody(STEWARD, 'function feChurch(tmpl, signer) {', 'feChurch');
  const signerName = (/return\s+(finalizeEvent\w*)\s*\(/.exec(feBody) || [])[1];
  assert.ok(signerName, 'feChurch no longer ends by calling finalizeEvent — re-anchor this rig');
  scope[signerName] = finalizeEvent;
  const gkBody = fnBody(STEWARD, 'async publishGroupKey(', 'publishGroupKey');
  const seal = /const ck = (\w+)\(churchSk, pk\);\s*keys\[pk\] = (\w+)\(/.exec(gkBody);
  assert.ok(seal, 'publishGroupKey no longer seals in the shape this rig reads — re-anchor it');
  scope[seal[1]] = nip44.utils.getConversationKey;
  scope[seal[2]] = nip44.encrypt;
  const ingBody = fnBody(STEWARD, 'function stewIngestKey(e) {', 'stewIngestKey');
  const open = /const plain = (\w+)\(mine, (\w+)\(churchSk, e\.pubkey\)\)/.exec(ingBody);
  assert.ok(open, 'stewIngestKey no longer opens its copy in the shape this rig reads — re-anchor it');
  scope[open[1]] = nip44.decrypt; scope[open[2]] = nip44.utils.getConversationKey;
  const ssBody = fnBody(STEWARD, 'setStewards(pubkeys, caps, names) {', 'setStewards');
  const ssSigner = (/publish\((finalizeEvent\w*)\(/.exec(ssBody) || [])[1];
  assert.ok(ssSigner, 'setStewards no longer publishes finalizeEvent(...) — re-anchor this rig');
  scope[ssSigner] = finalizeEvent;
  const tops = ['function _carryPrefix(d, list) {', 'function _carryLabel(d, content) {', 'async function _carryTemplate(S, blocked, who, pre) {',
    'async function _carryOverStewardDocs(pk, opts) {', 'function _removeStewardKeeping(pk, opts) {', 'function _dropJustRemoved(list, rosterAt) {', 'async function _swapKeyInChurchGroups(carry, oldPk, newPk) {'].map(a => fnBody(STEWARD, a, a));
  // ROUND 2 (2026-11-19, plan PLAN-removed-steward-fixes-F1-F4): Block of a current helper (owner answer l) and the
  // landed side effects Remove and Block share. Lifted WHEN THE BUNDLE HAS THEM, so the Step 0 tests run on the tree
  // before the fix (where the screen still calls carryOverStewardDocs + setBlocked) and on the fixed one alike.
  const OPT_TOPS = [['async function _settleStewardRemoval(who, o) {', '_settleStewardRemoval'], ['function _blockStewardKeeping(pk, blockedList, opts) {', '_blockStewardKeeping'], ['function _stewardSinceOf(who) {', '_stewardSinceOf'],
    // F1 round: which relays run the newest-wins build (owner answer s)
    ['function _liveNewestKey(url, key) {', '_liveNewestKey'], ['function _liveNewestRemembered(url) {', '_liveNewestRemembered'],
    ['function _relaysAllLiveNewest(urls) {', '_relaysAllLiveNewest'], ['async function _relayLiveNewest(url) {', '_relayLiveNewest']]
    .filter(([a]) => STEWARD.includes(a));
  for (const [a] of OPT_TOPS) tops.push(fnBody(STEWARD, a, a));
  const optNames = OPT_TOPS.map(([, n]) => n);
  const vars = ['var STEWARD_CARRY = ', 'var _CARRY_BARE = ', 'var STEWARD_CARRY_LIMIT_MS = ', 'var _CARRY_WORDS = ', 'var SWAP_PUBLISH_MS = ', 'var LIVE_NEWEST_LS = '].filter(a => STEWARD.includes(a)).map(a => stmt(STEWARD, a, a).replace(/^var /, 'scope.').replace(/^scope\.(\w+) = /, 'scope.$1 = '));
  const methods = [gkBody, fnBody(STEWARD, 'setNoPhoto(pubkeys) {', 'setNoPhoto'), fnBody(STEWARD, 'publishGroup(group) {', 'publishGroup'), ssBody];
  // the window.Steward methods the screens call — lifted too, so the screen reaches the shipped delegation
  const pub3 = ['removeStewardKeeping(pk, opts) {', 'carryOverStewardDocs(pk, opts) {', 'isOrWasSteward(pk) {', 'setCareRoster(list) {', 'blockStewardKeeping(pk, blockedList, opts) {']
    .filter(a => a !== 'blockStewardKeeping(pk, blockedList, opts) {' || STEWARD.includes('    ' + a)).map(a => fnBody(STEWARD, '    ' + a, a).trim());
  const api = new Function('scope', `${vars.join('\n')}\nwith (scope) { ${feBody}\n${ingBody}\n${tops.join('\n')}\n`
    + ` return { feChurch, stewIngestKey, _carryTemplate, _carryOverStewardDocs, _removeStewardKeeping, _swapKeyInChurchGroups, ${optNames.map(n => n + ', ').join('')}methods: ({ ${methods.join(',\n')} }), pub: ({ ${pub3.join(',\n')} }) }; }`)(scope);
  Object.assign(scope, api.methods);
  scope.feChurch = api.feChurch; scope.stewIngestKey = api.stewIngestKey;
  scope._carryOverStewardDocs = api._carryOverStewardDocs; scope._removeStewardKeeping = api._removeStewardKeeping; scope._carryTemplate = api._carryTemplate; scope._swapKeyInChurchGroups = api._swapKeyInChurchGroups;
  for (const n of optNames) scope[n] = api[n];
  scope.window.Steward.setStewards = (...a) => scope.setStewards(...a);
  Object.assign(scope.window.Steward, api.pub);
  return scope;
}
