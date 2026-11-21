// A RIG THAT RUNS THE SHIPPED NETWORK-CONTENT CODE OUT OF THE REBUILT BUNDLES (Networks MVP, N5b).
// Ported 2026-11-18 from October (9a1f5595) onto the network wall: the engine slice now starts at _readNetworkJoin, _queryAsKey answers
// { events, complete }, the join/leave/create methods can be lifted (joinApi), and gatewayRelay() drives a REAL gateway.
// Nothing here reads src/ or app/*.jsx for text (CLAUDE.md rule 3). It cuts the real code out of vendor/fellowship.js and
// vendor/steward.js and runs it in `new Function` with only its SURROUNDINGS supplied (signing, the relay pool, the key store). A
// name the lifted code needs that the rig does not supply is a ReferenceError, never a silent undefined.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { finalizeEvent, getPublicKey, generateSecretKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { npubEncode } from 'nostr-tools/nip19';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';

export const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
export const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

export function between(bundle, from, to, what) {
  const a = bundle.indexOf(from); assert.notEqual(a, -1, `${what}: start anchor missing from the bundle -- re-anchor this test`);
  const b = bundle.indexOf(to, a + from.length); assert.notEqual(b, -1, `${what}: end anchor missing from the bundle -- re-anchor this test`);
  return bundle.slice(a, b);
}
export function topFn(bundle, name) {
  const m = new RegExp('\\n  (async )?function ' + name + '\\([\\s\\S]*?\\n  \\}\\n').exec(bundle);
  assert.ok(m, `could not lift ${name} -- re-anchor this test, do not delete it`);
  return m[0];
}
// the shared sealing module as it sits in a bundle (esbuild renames the nip44 imports per bundle: bind every variant to the real thing)
export function sharedModule(bundle) {
  const a = bundle.indexOf('  // src/network-seal.src.js'); assert.notEqual(a, -1, 'the shared network-seal module is missing from the bundle');
  const rest = bundle.slice(a + 10), z = rest.search(/\n  \/\/ (src|node_modules)\//);   // esbuild marks each module with a comment line
  assert.notEqual(z, -1, 'could not find the end of the shared network-seal module');
  const code = bundle.slice(a, a + 10 + z);
  const nip = {};
  for (const m of code.matchAll(/\b(encrypt\d*|decrypt\d*|getConversationKey\d*)\b/g)) {
    nip[m[1]] = m[1].startsWith('encrypt') ? nip44.encrypt : m[1].startsWith('decrypt') ? nip44.decrypt : nip44.getConversationKey;
  }
  return { code, nip };
}
export const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
export const hex = (u) => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');
export const rnd32 = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const nowS = () => Math.floor(Date.now() / 1000);
export const NET = 'trinityone';
export const tag = (e, n) => (e.tags.find(t => t[0] === n) || [])[1];

// A relay stand-in: stores the newest event per (author, d) -- kind 30078 addressable semantics -- and answers a REQ the way the
// real one routes it (kinds / authors / #d / #t). It enforces NO read rule: who may READ is the relay's job and is proved against
// the real gateway in a-sealed-network-posts-are-accepted-and-served-by-the-relay.test.mjs.
export function fakeRelay() {
  const store = new Map(), subs = new Set();
  const matches = (e, f) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey))
    && (!f['#d'] || f['#d'].includes(tag(e, 'd'))) && (!f['#t'] || e.tags.some(t => t[0] === 't' && f['#t'].includes(t[1])));
  const put = (e) => {
    const k = e.pubkey + '|' + tag(e, 'd'), prev = store.get(k);
    if (prev && prev.created_at >= e.created_at) return false;
    store.set(k, e);
    for (const s of [...subs]) if (s.filters.some(f => matches(e, f))) s.h.onevent(e);
    return true;
  };
  return {
    store, put,
    all: () => [...store.values()],
    querySync: async (_urls, filters) => [...store.values()].filter(e => filters.some(f => matches(e, f))),
    subscribeMany: (_urls, filters, h) => {
      const s = { filters, h }; subs.add(s);
      for (const e of [...store.values()]) if (filters.some(f => matches(e, f))) h.onevent(e);
      setTimeout(() => { try { h.oneose && h.oneose(); } catch (x) {} }, 0);
      return { close: () => subs.delete(s) };
    },
  };
}

// ── the CONSOLE (vendor/steward.js): the network engine + the API methods that front it ─────────────────────────────────────────────
// opts.mutate(src) may rewrite the lifted source (used ONLY by the sabotage proofs, which assert their anchor matched).
const variants = (text, base) => { const out = new Set([base]); for (const m of text.matchAll(new RegExp('\\b' + base + '\\d*\\b', 'g'))) out.add(m[0]); return [...out]; };
// The default fetch: a REAL request to a local gateway the test spawned (127.0.0.1 / localhost), and for the stand-in relay's made-up host a
// NIP-11 answer that carries the wall marker (a stand-in relay is a current relay; tests about a relay WITHOUT the marker pass their own fetchImpl).
const defaultFetch = async (url, init) => {
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(String(url))) return fetch(url, init);
  return { ok: true, json: async () => ({ trinityone: { capabilities: ['network-wall-1'] }, capabilities: ['network-wall-1'] }) };
};
// The default _queryAsKey for a stand-in relay: the relay's own read, reported complete; a read that throws is reported incomplete -- the
// shipped helper's contract ({ events, complete }, never throws).
// the shipped relay list, as the bundle has it (the wall gate never tells a steward to remove one of these)
const SHIPPED_RELAYS = JSON.parse(((/\n  var CANONICAL_RELAYS = (\[[^\]]*\]);/.exec(STEWARD) || [])[1] || '[]').replace(/'/g, '"'));
const fakeQueryAsKey = (relay) => async (urls, _sk, filters) => { try { return { events: await relay.querySync(urls, filters), complete: true }; } catch (e) { return { events: [], complete: false }; } };
export function bootConsole({ relay, church, networks = [], nameKey = null, founded = [], authed = true, unproved = [], mutate = null, joined = [], queryAsKey = null, relayUrl = 'wss://r.example/relay', relayUrls = null, ls: lsIn = null, joinApi = false, fetchImpl = null }) {
  const sh = sharedModule(STEWARD);
  // the engine, from _readNetworkJoin to saveNetKey, with the shipped _queryAsKey cut out so the rig can supply the socket (a test that wants the
  // SHIPPED one passes it in as queryAsKey: shippedQueryAsKey())
  let engine = between(STEWARD, '  async function _readNetworkJoin(', '  function saveNetKey(', 'the console network engine');
  const qak = topFn(engine, '_queryAsKey'); engine = engine.replace(qak, '\n');
  const scopesDecl = (/\n  var NETWORK_SCOPES = [^\n]*\n/.exec(STEWARD) || [])[0]; assert.ok(scopesDecl, 'could not lift NETWORK_SCOPES');
  const api = between(STEWARD, '    publishNetworkPost(', '    importNetworkKey(', 'the console network API');
  const jApi = joinApi ? between(STEWARD, '    async resolveNetwork(', '    ownedNetworks()', 'the join / leave / create API') : '';
  let src = sh.code + '\n' + scopesDecl + engine + '\nconst __api = {' + jApi + api.replace(/,\s*$/, '') + '};\nwindow.Steward = __api;\n'
    + '__api.__set = (k, v) => { switch (k) { case "_nameKeyRing": _nameKeyRing = v; break; case "_nameKeyChecked": _nameKeyChecked = v; break; case "actingChurch": actingChurch = v; break; case "pub": pub = v; break; case "churchSk": churchSk = v; break; default: throw new Error("unknown state " + k); } };\n'
    + '__api.__engine = { _netSyncKey, _netSyncHop2, _netSyncAll, _netPublishPost, _netRemovePost, _netRingFor, _hop2Done };\nreturn __api;';
  if (mutate) src = mutate(src);
  // the console's mutable state, declared in the wrapper so the lifted code sees live values
  const state = { churchSk: church.sk, churchPub: church.pub, actingChurch: '', pub: church.pub, _nameKeyRing: nameKey ? [nameKey] : [], _nameKeyChecked: !!nameKey };
  const ls = lsIn || new Map();
  for (const np of founded) ls.set('trinityone.netring.mint.' + np, '1');
  const published = [], refused = [];
  const prelude = 'let churchSk, churchPub, actingChurch, pub, _nameKeyRing, _nameKeyChecked;\n(function(s){ churchSk=s.churchSk; churchPub=s.churchPub; actingChurch=s.actingChurch; pub=s.pub; _nameKeyRing=s._nameKeyRing; _nameKeyChecked=s._nameKeyChecked; })(__state);\n';
  const ringListeners = new Set();
  const lastStamp = new Map();
  const savedKeys = [];
  const seedSk = (m) => new Uint8Array(createHash('sha256').update(String(m)).digest());   // privateKeyFromSeedWords stand-in
  const win = { dispatchEvent() { return true; } };
  const all = engine + api + jApi;
  const names = ['__state', 'pool', 'relays', 'relaysRaw', '_gate', '_isRelayAuthed', 'skFor', 'netKeys', 'publish', ...variants(all, 'finalizeEvent'), '_monotonic', 'now', 'NET', 'NETWORK_D',
    'toPubHex', '_queryAsKey', ...variants(all, 'getPublicKey'), 'lsGet', 'lsSet', '_onNameKeyRing', 'localStorage', 'window', 'CustomEvent', 'fetch',
    ...variants(all, 'npubEncode'), 'saveNetKey', 'generateSeedWords', 'privateKeyFromSeedWords', 'CANONICAL_RELAYS', ...Object.keys(sh.nip)];
  const vals = [state, { querySync: relay.querySync, subscribeMany: relay.subscribeMany }, () => (relayUrls || [relayUrl]).slice(), () => (relayUrls || [relayUrl]).slice(),
    { unsettled: () => unproved }, () => authed,
    (p) => { const n = networks.find(x => x.pub === p); if (n) return n.sk; const k = savedKeys.find(x => x.pub === p); if (k) return seedSk(k.mnemonic); return p === church.pub ? church.sk : null; },   // skFor: a configured network, or one this console saved (createNetwork)
    () => [...networks.map(n => ({ pub: n.pub, name: n.name || 'Network', mnemonic: 'x' })), ...savedKeys.map(k => ({ pub: k.pub, name: k.name, mnemonic: k.mnemonic }))],   // netKeys
    async (evt, o) => { const r = await relay.put(evt); if (r !== true && !(r && r.ok === true)) { if (o) o.reason = (r && r.reason) || relay.lastReason || 'duplicate: a newer version is stored'; refused.push(evt); return false; } published.push(evt); return evt; },
    ...variants(engine + api, 'finalizeEvent').map(() => (t, sk) => finalizeEvent(JSON.parse(JSON.stringify(t)), sk)), (t) => { const d = tag(t, 'd') || ('k' + t.kind), last = lastStamp.get(d) || 0; const at = Math.max(t.created_at || nowS(), last + 1); lastStamp.set(d, at); return { ...t, created_at: at }; }, nowS, NET, 'trinityone/network:',
    (x) => { const s = String(x || ''); if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase(); try { const d = nip19decode(s); return d.type === 'npub' ? d.data : null; } catch (e) { return null; } },
    queryAsKey || fakeQueryAsKey(relay), ...variants(all, 'getPublicKey').map(() => getPublicKey), (k) => ls.has(k) ? ls.get(k) : null, (k, v) => ls.set(k, v),
    (fn) => { ringListeners.add(fn); return () => ringListeners.delete(fn); }, { getItem: (k) => null }, win, class { constructor(t) { this.type = t; } }, fetchImpl || defaultFetch,
    ...variants(all, 'npubEncode').map(() => npubEncode), // saveNetKey + what netKeys() does with it: since 2026-11-21 createNetwork hands over the words ALREADY SEALED to the church key
    // ({ pub, name, sealedMnemonic }), so the stand-in store opens them the way the real netKeys() does, for skFor/netKeys above
    (rec) => { savedKeys.push((rec && rec.sealedMnemonic && !rec.mnemonic) ? { ...rec, mnemonic: nip44.decrypt(rec.sealedMnemonic, church.sk) } : rec); return true; }, () => 'w' + Math.random().toString(36).slice(2), seedSk, SHIPPED_RELAYS,
    ...Object.values(sh.nip)];
  const make = new Function(...names, prelude + src);
  // the lifted engine reads churchSk etc. as bare names; `set` re-runs the assignment so a test can move the console's state
  const live = make(...vals);
  return {
    api: live, published, refused, ls, state, ringListeners, savedKeys,
    // `joined` churches have a live join document on the relay (what _ownJoinLive reads)
    join: (np, who = church) => relay.put(finalizeEvent({ kind: 30078, created_at: nowS(), tags: [['d', 'trinityone/network:' + np], ['t', NET], ['p', np]], content: JSON.stringify({ joined: true, v: 1, scopes: ['announcements', 'events'] }) }, who.sk)),
  };
}

// ── the MEMBER APP (vendor/fellowship.js): subscribeNetworkContent, with the REAL hub-replay rule for a late name key ───────────────────
import { decode as nip19decode } from 'nostr-tools/nip19';
export function bootMember({ relay, cp, nameKeys = [], mutate = null }) {
  const sh = sharedModule(FELLOW);
  const method = between(FELLOW, '    subscribeNetworkContent(', '    subscribeMyServingRequests(', 'subscribeNetworkContent').replace(/,\s*$/, '');
  const pfxDecl = (/\n  var CHURCH_SEALED_PFXS = [\s\S]*?;\n/.exec(FELLOW) || [])[0];
  assert.ok(pfxDecl, 'could not lift CHURCH_SEALED_PFXS');
  const src = sh.code + pfxDecl + topFn(FELLOW, '_coalesce') + topFn(FELLOW, '_featureFailed') + topFn(FELLOW, 'toPub') + topFn(FELLOW, '_replayChurchCalendar') + (/\n  var _dtag = [^\n]*\n/.exec(FELLOW) || ['\n  var _dtag = (e) => 0;\n'])[0]
    + '\nconst __api = {' + method + '};\n__api.__replay = () => _replayChurchCalendar(__cp, __hub);\nreturn __api;';
  const srcM = mutate ? mutate(src) : src;
  const nameKeysMap = new Map(); if (nameKeys.length) nameKeysMap.set(cp, nameKeys);
  const hub = { buf: new Map(), handlers: new Set() };
  const dOf = (e) => tag(e, 'd') || '';
  // _onChurchDocs as the real hub honours it: replay the buffer oldest-first on register, then live events, then EOSE
  const _onChurchDocs = (c, h) => {
    assert.equal(c, cp, 'the member subscribed to the wrong church\'s documents');
    hub.handlers.add(h);
    const take = (e) => e.pubkey === cp && tag(e, 't') === NET;
    for (const e of relay.all().filter(take).sort((a, b) => a.created_at - b.created_at)) { hub.buf.set(e.pubkey + '|' + dOf(e), e); if (!h.want || h.want.some(p => dOf(e).startsWith(p))) h.onevent(e, dOf(e)); }
    const live = relay.subscribeMany([], [{ kinds: [30078], authors: [cp], '#t': [NET] }], { onevent(e) { hub.buf.set(e.pubkey + '|' + dOf(e), e); if (!h.want || h.want.some(p => dOf(e).startsWith(p))) h.onevent(e, dOf(e)); } });
    setTimeout(() => { try { h.oneose && h.oneose(); } catch (x) {} }, 0);
    return () => { hub.handlers.delete(h); live.close(); };
  };
  const win = { Fellowship: { relays: ['wss://r.example/relay'] }, dispatchEvent() {} };
  const names = ['__hub', '__cp', '_nameKeys', 'NET', 'pool', '_netRelays', 'window', '_FAILURES', 'CustomEvent', '_onChurchDocs', 'decode', 'console', 'setTimeout', 'clearTimeout', ...Object.keys(sh.nip)];
  const vals = [hub, cp, nameKeysMap, NET, { subscribeMany: relay.subscribeMany }, (r) => r, win, [], class { constructor(n, o) { this.detail = o && o.detail; } }, _onChurchDocs, nip19decode, console, setTimeout, clearTimeout, ...Object.values(sh.nip)];
  const api = new Function(...names, srcM)(...vals);
  return {
    subscribe: (networkNpub, cb) => api.subscribeNetworkContent(networkNpub, cp, cb),
    // the church's name key lands AFTER the documents (the normal warm-start order): what _ingestNameKey does, then the real replay
    nameKeyLands: (keys) => { nameKeysMap.set(cp, keys); api.__replay && api.__replay(); },
    hub, nameKeysMap,
  };
}

// The shared module's functions, run from a bundle (for the unit-level crypto proofs).
export function sharedFns(bundle, exportsList) {
  const sh = sharedModule(bundle);
  return new Function(...Object.keys(sh.nip), sh.code + '\nreturn { ' + exportsList.join(', ') + ' };')(...Object.values(sh.nip));
}
// Sabotage helper: inside ONE function of a lifted source, replace an anchor that must occur EXACTLY ONCE there (CLAUDE.md: a plain replace
// hits the first match, usually somebody else's).
export function scoped(src, fnHead, fnTailExclusive, from, to) {
  const a = src.indexOf(fnHead); assert.notEqual(a, -1, 'sabotage: function head not found: ' + fnHead);
  const b = src.indexOf(fnTailExclusive, a + fnHead.length); assert.notEqual(b, -1, 'sabotage: function tail not found: ' + fnTailExclusive);
  const body = src.slice(a, b);
  assert.equal(body.split(from).length - 1, 1, 'sabotage: the anchor must occur exactly once inside the function: ' + from);
  return src.slice(0, a) + body.replace(from, to) + src.slice(b);
}
export const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));
export const hexBytes = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));

// ── A REAL GATEWAY, as the console's pool sees it (added 2026-11-18) ─────────────────────────────────────────────────────────────────────
// `readAs` is the key the console's pool is logged in as (its CHURCH): every read answers the relay's AUTH challenge as that key, so the real
// read rules (canRead) decide what comes back. A write connects as the event's author (keys: every secret the test holds). No rule is
// re-implemented here; the relay is the real one, spawned by the test.
export function gatewayRelay(wsUrl, readAs, keys) {
  const nowT = () => Math.floor(Date.now() / 1000);
  const open = (who) => new Promise((res, rej) => {
    const w = new WebSocket(wsUrl);
    w.on('open', () => { w.on('message', (d) => { const m = JSON.parse(d); if (m[0] === 'AUTH' && who) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: nowT(), tags: [['relay', wsUrl], ['challenge', m[1]]], content: '' }, who.sk)])); }); res(w); });
    w.on('error', rej);
  });
  const req = (w, filters) => new Promise((res) => {
    const out = []; const id = 'r' + Math.random().toString(36).slice(2, 8);
    const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) setTimeout(() => { w.off('message', on); res(out); }, 150); };
    w.on('message', on); w.send(JSON.stringify(['REQ', id, ...filters])); setTimeout(() => { w.off('message', on); res(out); }, 4000);
  });
  const read = async (who, filters) => { const w = await open(who); await new Promise(r => setTimeout(r, 150)); const got = await req(w, filters); w.close(); return got; };
  const self = {
    lastReason: '',
    put: async (evt) => {
      const author = keys.find(k => k.pub === evt.pubkey) || null;
      const w = await open(author); await new Promise(r => setTimeout(r, 120));
      const r = await new Promise((res) => { const on = (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); setTimeout(() => res([null, 'timeout']), 5000); });
      w.close();
      if (r[0] !== true) self.lastReason = r[1];
      return r[0] === true ? true : { ok: false, reason: r[1] };
    },
    querySync: async (_u, filters) => read(readAs, filters),
    readAs: (who, filters) => read(who, filters),
    // a one-shot REQ answered once and then EOSE (the engine's live subscriptions are not under test here)
    subscribeMany: (_u, filters, h) => { let closed = false; read(readAs, filters).then((evs) => { if (closed) return; for (const e of evs) h.onevent(e); try { h.oneose && h.oneose(); } catch (x) {} }); return { close() { closed = true; } }; },
    all: () => { throw new Error('gatewayRelay has no "all": read through the real relay'); },
  };
  return self;
}
// THE SHIPPED _queryAsKey, lifted from the console bundle, running on the real nostr-tools pool (esbuild renames imports per bundle)
import { SimplePool } from 'nostr-tools/pool';
export function shippedQueryAsKey(mutate = null, { finalize = finalizeEvent } = {}) {
  let code = (/\n  var NET_QUERY_MAX_WAIT = [^\n]*\n/.exec(STEWARD) || [''])[0] + topFn(STEWARD, '_queryAsKey');
  if (mutate) code = mutate(code);
  const fin = [...new Set(code.match(/\bfinalizeEvent\d*\b/g) || [])], sp = [...new Set(code.match(/\bSimplePool\d*\b/g) || [])];
  assert.ok(fin.length && sp.length, 'could not find the imports the shipped _queryAsKey uses');
  return new Function(...fin, ...sp, code + '\nreturn _queryAsKey;')(...fin.map(() => finalize), ...sp.map(() => SimplePool));
}
