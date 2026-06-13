// fellowship.src.js — TrinityOne chat transport over Nostr (bundled → vendor/fellowship.js)
//
// MVP transport: signed kind-1 events grouped by a 't' tag (the spec's tag-based model,
// §5.2). Points at the local dev relay by default; swap window.Fellowship.relays for a
// hosted NIP-29 relay later (the app only ever talks to window.Fellowship).
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { encrypt as nip44e, decrypt as nip44d, getConversationKey as nip44ck } from 'nostr-tools/nip44';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { decode as nip19decode, npubEncode } from 'nostr-tools/nip19';
import { encrypt as nip04encrypt, decrypt as nip04decrypt } from 'nostr-tools/nip04';

// a church is identified by its npub (or hex pubkey) -- resolve to a 32-byte hex pubkey
function toPub(npubOrHex) {
  if (!npubOrHex) return null;
  if (/^[0-9a-f]{64}$/i.test(npubOrHex)) return npubOrHex.toLowerCase();
  try { const d = nip19decode(npubOrHex); return d.type === 'npub' ? d.data : null; } catch { return null; }
}
const GROUP_D = 'trinityone/group:';
const GROUPKEY_D = 'trinityone/groupkey:';   // church-signed envelope: the group key wrapped to each member
const _gkeys = {};   // groupId -> Uint8Array(32) group key, unwrapped from the church's envelope for me
const _hex = (u) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
const _unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
// unwrap my entry from a key envelope and cache the group key (NIP-44, church<->me conversation key)
function _ingestGroupKey(e) {
  const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(GROUPKEY_D)) return;
  const gid = d.slice(GROUPKEY_D.length);
  try {
    const env = JSON.parse(e.content || '{}');
    const mine = env.keys && pub && env.keys[pub];
    if (mine && sk) _gkeys[gid] = _unhex(nip44d(mine, nip44ck(sk, e.pubkey)));
    else if (!mine) delete _gkeys[gid];   // dropped from the group (rotation) → lose the key
  } catch {}
}
// transparently decrypt an encrypted group message → event with plaintext content; null if it's
// encrypted and I don't hold the key (so the UI simply never sees it).
function _decEvt(e) {
  if (!e.tags || !e.tags.some(t => t[0] === 'enc')) return e;
  const gid = (e.tags.find(t => t[0] === 't' && t[1] !== NET) || [])[1];
  const key = gid && _gkeys[gid];
  if (!key) return null;
  try { return { ...e, content: nip44d(e.content, key) }; } catch { return null; }
}

const NET = 'trinityone';                       // network-wide tag
// Relays are configurable + persisted, so pointing at a hosted wss:// relay is a settings
// change, not a code change. Default = a relay on the SAME host the app is served from, port
// 7447. That makes self-hosting on one machine work for both this device (localhost) and phones
// on the LAN (they open http://<machine-ip>:8000 -> relay at ws://<machine-ip>:7447) with no
// hardcoded IP. Production points this at the church's wss:// relay via the in-app Relays setting.
// The unified gateway (scripts/gateway.mjs) serves the app AND the relay at /relay on ONE origin,
// so the relay is reachable wherever the app is -- localhost, the LAN IP, or a public tunnel --
// with no hardcoded host and over a single tunnel. ws on http, wss on https (a tunnel).
const _loc = (typeof location !== 'undefined') ? location : null;
const RELAY_BASE = _loc && _loc.host ? _loc.host : '127.0.0.1:8090';
// No built-in default relay: a member has NO relay until they join a church, at which point the
// church's relay is added from its invite (?relay=…). Relays are church-managed, not user-managed —
// the in-app list is read-only. (The web build served from a church's own gateway is the one
// exception: it can derive its relay from its origin, since it's literally served by that church.)
const _native = !!(typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
// A static CDN host (GitHub Pages / Cloudflare Pages / Netlify) is NOT a church gateway — it serves no
// relay on its origin. Treat it like native: start blank, and let the relay arrive only with the
// invite when a church is joined. Only a real self-hosted gateway derives its relay from its origin.
const _staticHost = !!(_loc && _loc.host && /\.(github\.io|pages\.dev|netlify\.app)$/i.test(_loc.host));
const _originRelay = (!_native && !_staticHost && _loc && _loc.host) ? (((_loc.protocol === 'https:') ? 'wss://' : 'ws://') + RELAY_BASE + '/relay') : null;
const DEFAULT_RELAYS = _originRelay ? [_originRelay] : [];   // native / static host = blank until a church is joined
// The TrinityOne shared-relay pool — relays we operate that every church can use out of the box.
// Members fan out across all of them (publish + read), so the church stays reachable if any one is
// down. Also the fallback when a church is joined by bare npub (no relay in the link) and we have none
// yet (e.g. the CDN-hosted app), so its name + groups resolve. Add a host's wss URL here once it joins
// the pool — these relays don't sync to each other, so clients write to all of them.
const CANONICAL_RELAYS = [
  'wss://trinityone-master-01.tailbeaac0.ts.net/relay',   // master-01 — dedicated pilot relay (primary)
  'wss://trinityone.tailbeaac0.ts.net/relay',             // dev box — secondary, for redundancy
];
const CANONICAL_RELAY = CANONICAL_RELAYS[0];   // back-compat: the primary shared relay
const RELAYS_KEY = 'trinityone.relays';
function loadRelays() {
  try { const r = JSON.parse(localStorage.getItem(RELAYS_KEY) || 'null'); if (Array.isArray(r)) return r; } catch {}
  return DEFAULT_RELAYS.slice();
}
const HANDLE_POOL = ['Cedar', 'River', 'Sparrow', 'Olive', 'Wren', 'Maple', 'Reed', 'Dove', 'Ash', 'Linden', 'Heron', 'Bramble'];
const COLORS = ['#5E8C6A', '#C2913A', '#C25A38', '#5360D6', '#1F9488', '#C24B7A'];

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function profile(pub) {
  const h = hashStr(pub || '');
  return { pubkey: pub, handle: 'Anonymous ' + HANDLE_POOL[h % HANDLE_POOL.length], color: COLORS[(h >>> 8) % COLORS.length] };
}

const pool = new SimplePool();
let sk = null, pub = null;
// NIP-42: when a relay challenges, prove our pubkey by signing the auth event with our key — so the
// relay serves us the invite-only groups we belong to. No effect on relays that never challenge.
pool.automaticallyAuth = () => async (authEvent) => {
  if (!sk) { try { await window.Fellowship.ready; } catch {} }
  if (!sk) throw new Error('no key');
  return finalizeEvent(authEvent, sk);
};

// kind-0 profile metadata cache (pubkey -> {name, picture, about, nip05}). Persisted to localStorage so
// names/handles show INSTANTLY on the next load (chat, the People directory) instead of resolving fresh.
const profiles = {};
const pendingProfiles = new Set();
const PROFILE_KEY = 'trinityone.profile';   // own display name (public; ok in localStorage)
const PROFILES_KEY = 'trinityone.profiles'; // cache of OTHER people's resolved profiles
try { const c = JSON.parse(localStorage.getItem(PROFILES_KEY) || '{}'); if (c && typeof c === 'object') Object.assign(profiles, c); } catch {}
let _profSaveT = null;
function saveProfiles() {
  if (_profSaveT) return;
  _profSaveT = setTimeout(() => { _profSaveT = null; try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); } catch {} }, 800);
}

const AV_SYMBOLS = ['halo', 'dove', 'fish', 'flame', 'vine', 'wheat', 'anchor', 'crook', 'chalice', 'olive', 'mountain', 'well', 'star'];
// resolved display = kind-0 name/avatar if known, else a deterministic anonymous handle + symbol
function displayFor(pubkey) {
  const base = profile(pubkey);
  const p = profiles[pubkey];
  const av = (p && p.av) || { kind: 'symbol', color: base.color, symbol: AV_SYMBOLS[hashStr(pubkey || '') % AV_SYMBOLS.length] };
  const handle = (p && p.name) || base.handle;
  return { pubkey, handle, name: handle, color: av.color || base.color, av, picture: p && p.picture, nip05: (p && p.nip05) || '' };
}

async function deriveFromIdentity() {
  const mnemonic = window.TrinityIdentity ? await window.TrinityIdentity.exportMnemonic() : null;
  if (!mnemonic) throw new Error('no identity available to sign with');
  sk = privateKeyFromSeedWords(mnemonic);
  pub = getPublicKey(sk);
  window.Fellowship.myPubkey = pub;
  // signal that the signing key is now ready, so listeners (e.g. the app's serving subscriptions,
  // which bail when myPubkey is null) re-run with a valid pubkey instead of needing a restart.
  try { window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: pub } })); } catch {}
}
async function init() {
  if (window.TrinityIdentity && window.TrinityIdentity.ready) await window.TrinityIdentity.ready;
  await deriveFromIdentity();
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) { const p = JSON.parse(raw); profiles[pub] = p; window.Fellowship.myProfile = p; }
  } catch {}
}
// keep the signing key in step with identity regeneration / restore
window.addEventListener('trinity-identity', () => { deriveFromIdentity().catch(() => {}); });

window.Fellowship = {
  relays: loadRelays(),
  CANONICAL_RELAY,
  CANONICAL_RELAYS,
  myPubkey: null,
  myProfile: null,
  churchPub: null,        // hex pubkey of the active church; messages are tagged ['p', churchPub]
  ready: null,
  profile,
  displayFor,
  // http(s) base of the church's gateway (derived from its relay) — for the /feed video proxy
  gatewayBase() {
    const r = (window.Fellowship.relays || [])[0] || '';
    try { const u = new URL(r); return (u.protocol === 'wss:' ? 'https:' : 'http:') + '//' + u.host; } catch { return ''; }
  },

  // resolve a church reference → npub. A bare npub / invite link returns as-is; a NIP-05 "nice name"
  // ("@trinitychurchlittlehampton" or "name@host") is looked up via the relay's /.well-known/nostr.json
  // (served by the gateway). A bare @name is resolved against the shared relay pool (first match wins).
  async resolveChurch(input) {
    const raw = String(input || '').trim();
    const m = raw.match(/npub1[0-9a-z]{20,}/);
    if (m) return m[0];
    const nm = raw.replace(/^@/, '');
    if (!/^[a-z0-9._-]{2,}(@[a-z0-9.-]+)?$/i.test(nm)) return null;
    let name, hosts;
    if (nm.includes('@')) { const [n, h] = nm.split('@'); name = n.toLowerCase(); hosts = [h]; }
    else {
      name = nm.toLowerCase();
      const urls = [...new Set([...(window.Fellowship.CANONICAL_RELAYS || []), ...(window.Fellowship.relays || [])])];
      hosts = urls.map(u => { try { return new URL(u).host; } catch { return null; } }).filter(Boolean);
    }
    for (const host of hosts) {
      try {
        const r = await fetch('https://' + host + '/.well-known/nostr.json?name=' + encodeURIComponent(name), { mode: 'cors' });
        if (!r.ok) continue;
        const j = await r.json();
        const names = (j && j.names) || {};
        const hex = names[name] || names[Object.keys(names).find(k => k.toLowerCase() === name) || ''];
        if (hex && /^[0-9a-f]{64}$/i.test(hex)) { try { return npubEncode(hex); } catch { return null; } }
      } catch (e) {}
    }
    return null;
  },

  // scope outgoing messages to a church (so its steward can see who's participating). The member
  // app calls this with the active church's npub whenever it changes; null clears the scope.
  setChurch(npubOrHex) { window.Fellowship.churchPub = toPub(npubOrHex); return window.Fellowship.churchPub; },

  // NIP-98-style signed proof that we control this key, bound to a URL/endpoint — so a push
  // subscription can't be registered under another member's pubkey. Returns a signed event or null.
  async signAuth(url) {
    if (!sk) { try { await window.Fellowship.ready; } catch { return null; } }
    if (!sk) return null;
    return finalizeEvent({
      kind: 27235, created_at: Math.floor(Date.now() / 1000),
      tags: [['u', String(url || '')], ['method', 'POST']], content: '',
    }, sk);
  },

  // announce membership of a church (a signed, addressable presence event) so the steward can see
  // people who joined even if they never post. Idempotent (addressable, d=member:<churchPub>).
  // This makes the member's pseudonymous npub visible as a member of this church.
  async announceMembership(npubOrHex) {
    const cp = toPub(npubOrHex); if (!cp) return;
    if (!sk) { try { await window.Fellowship.ready; } catch { return; } }
    if (!sk) return;
    const evt = finalizeEvent({
      kind: 30078, created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'trinityone/member:' + cp], ['t', NET], ['p', cp]],
      content: JSON.stringify({ joined: Math.floor(Date.now() / 1000) }),
    }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] membership publish failed', e); }
    return evt;
  },
  // leave a church: tombstone the membership event (they vanish from the steward's list unless they
  // have posted). Wired for when an unfollow action exists.
  async leaveMembership(npubOrHex) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(npubOrHex); if (!cp || !sk) return;
    const evt = finalizeEvent({
      kind: 30078, created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'trinityone/member:' + cp], ['t', NET], ['p', cp], ['deleted', '1']], content: '',
    }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch {}
    return evt;
  },

  // the church's people, for a member-facing directory: distinct folks (not the church) who joined
  // (member:<church>) or posted (kind-1 p-tagged), with their kind-0 profile resolved. Same rule the
  // steward uses. Blocked members are withheld by the relay. The UI filters out the current user.
  subscribeChurchMembers(churchNpub, onMembers) {
    const cp = toPub(churchNpub); if (!cp) { onMembers([]); return () => {}; }
    const MEMBER_D = 'trinityone/member:';
    const byPub = new Map();          // pubkey -> { pubkey, npub, name, nip05, picture, joined, lastTs, msgs }
    const profSubs = new Map();
    const emit = () => onMembers([...byPub.values()].filter(m => m.joined || m.msgs > 0).sort((a, b) => (b.lastTs || b.joined || 0) - (a.lastTs || a.joined || 0)));
    // seed name/nip05 from the persisted profile cache so known members render instantly (no resolve lag)
    const get = (pk) => byPub.get(pk) || { pubkey: pk, npub: npubEncode(pk), name: (profiles[pk] || {}).name || '', nip05: (profiles[pk] || {}).nip05 || '', picture: (profiles[pk] || {}).picture || '', joined: 0, lastTs: 0, msgs: 0 };
    const ensureProfile = (pk) => {
      if (profSubs.has(pk)) return;
      const s = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [0], authors: [pk] }], {
        onevent(e) { try { const meta = JSON.parse(e.content); profiles[pk] = { name: meta.name || meta.display_name || '', picture: meta.picture || '', about: meta.about || '', nip05: meta.nip05 || '', av: meta.av || undefined }; saveProfiles(); const m = byPub.get(pk); if (m) { m.name = profiles[pk].name; m.picture = profiles[pk].picture; m.nip05 = profiles[pk].nip05; emit(); } } catch {} },
        oneose() {},
      });
      profSubs.set(pk, s);
    };
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1], '#p': [cp] }, { kinds: [30078], '#p': [cp] }], {
      onevent(e) {
        if (e.pubkey === cp) return;
        const m = get(e.pubkey);
        if (e.kind === 30078) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (d.indexOf(MEMBER_D) !== 0) return;
          const left = e.tags.some(t => t[0] === 'deleted') || !e.content;
          if (left) m.joined = 0; else { let j = e.created_at; try { j = JSON.parse(e.content).joined || e.created_at; } catch {} m.joined = j; }
        } else { m.msgs++; if (e.created_at > m.lastTs) m.lastTs = e.created_at; }
        byPub.set(e.pubkey, m); ensureProfile(e.pubkey); emit();
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} for (const s of profSubs.values()) { try { s.close(); } catch {} } };
  },

  // relay configuration (persisted) — accepts ws:// or wss:// URLs
  setRelays(urls) {
    const list = [...new Set((urls || []).map(u => (u || '').trim()).filter(u => /^wss?:\/\//i.test(u)))];
    window.Fellowship.relays = list.length ? list : DEFAULT_RELAYS.slice();
    try { localStorage.setItem(RELAYS_KEY, JSON.stringify(window.Fellowship.relays)); } catch {}
    window.dispatchEvent(new CustomEvent('trinity-relays', { detail: window.Fellowship.relays }));
    return window.Fellowship.relays;
  },
  addRelay(url) { return window.Fellowship.setRelays([...window.Fellowship.relays, url]); },
  removeRelay(url) { return window.Fellowship.setRelays(window.Fellowship.relays.filter(r => r !== url)); },

  // publish this user's kind-0 profile (display name etc.) and cache it
  async setProfile(meta) {
    if (!sk) await window.Fellowship.ready;
    const prev = profiles[pub] || {};
    const p = {
      name: (meta.name != null ? meta.name : (prev.name || '')).trim(),
      about: (meta.about != null ? meta.about : (prev.about || '')).trim(),
      picture: (meta.picture != null ? meta.picture : (prev.picture || '')).trim(),
    };
    if (meta.av || prev.av) p.av = meta.av || prev.av;   // chosen symbol/monogram avatar
    // auto-claim a verified NIP-05 handle on the church's relay: <name>@<relay-host>. The relay serves
    // /.well-known/nostr.json, so the member gets a real verified name — no third-party domain needed.
    const handleLocal = p.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 30);
    const relayHost = (CANONICAL_RELAY || '').replace(/^wss?:\/\//i, '').replace(/\/relay\/?$/i, '');
    if (handleLocal && relayHost) p.nip05 = handleLocal + '@' + relayHost;
    else if (prev.nip05) p.nip05 = prev.nip05;
    const evt = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(p) }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] profile publish failed', e); }
    profiles[pub] = p; window.Fellowship.myProfile = p;
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {}
    window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: pub } }));
    return evt;
  },

  // fetch kind-0 for pubkeys we haven't resolved yet; fires 'trinity-profiles' on arrival
  requestProfiles(pubkeys) {
    // refetch when unknown, or cached-without-a-name (so a member who later picks a name updates)
    const need = [...new Set(pubkeys)].filter(pk => pk && !pendingProfiles.has(pk) && (!(pk in profiles) || !(profiles[pk] && profiles[pk].name)));
    if (!need.length) return;
    need.forEach(pk => pendingProfiles.add(pk));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [0], authors: need }], {
      onevent(e) {
        try {
          const m = JSON.parse(e.content);
          profiles[e.pubkey] = { name: m.name || m.display_name || '', picture: m.picture || '', about: m.about || '', nip05: m.nip05 || '', av: m.av || undefined };
          saveProfiles();
          window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: e.pubkey } }));
        } catch {}
      },
      oneose() { need.forEach(pk => pendingProfiles.delete(pk)); try { sub.close(); } catch {} },
    });
  },

  // publish a message to a group (kind 1, tagged with the network + group ids)
  async publishMessage(groupId, content, extraTags = []) {
    if (!sk) await window.Fellowship.ready;
    const churchTag = window.Fellowship.churchPub ? [['p', window.Fellowship.churchPub]] : [];
    let body = content, encTag = [];
    const gkey = _gkeys[groupId];   // encrypted group → seal the content so even the relay can't read it
    if (gkey) { try { body = nip44e(content, gkey); encTag = [['enc', '1']]; } catch (e) {} }
    const evt = finalizeEvent({
      kind: 1, created_at: Math.floor(Date.now() / 1000),
      tags: [['t', NET], ['t', groupId], ...churchTag, ...encTag, ...extraTags], content: body,
    }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); }
    catch (e) { console.warn('[fellowship] publish failed', e); }
    return evt;
  },

  // ── direct messages (1:1, encrypted) ──
  // NIP-04 encrypted kind-4: the content is private to the two parties; the relay sees only that two
  // pubkeys are talking (full metadata privacy = NIP-17, a later/Stage-6 upgrade). Peer = a hex pubkey.
  async sendDM(peerPub, content) {
    if (!sk) await window.Fellowship.ready;
    let ciphertext; try { ciphertext = await nip04encrypt(sk, peerPub, content); } catch (e) { console.warn('[fellowship] DM encrypt failed', e); return null; }
    const evt = finalizeEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', peerPub]], content: ciphertext }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] DM publish failed', e); }
    return evt;
  },
  // a 1:1 thread with one peer; onMsg({ id, mine, content, ts, pubkey, reactions, myReaction }).
  // kind-7 reactions on either side are folded in and re-emitted against their target message.
  subscribeThread(peerPub, onMsg) {
    if (!pub) return () => {};
    const seen = new Set();
    const msgs = new Map();          // id -> message
    const rx = new Map();            // msgId -> Map(reactorPub -> emoji)
    const push = (m) => {
      const r = rx.get(m.id); const reactions = r ? [...r.values()].filter(Boolean) : [];
      try { onMsg({ ...m, reactions, myReaction: r ? r.get(pub) || '' : '' }); } catch (err) {}
    };
    const deliver = async (e) => {
      if (seen.has(e.id)) return; seen.add(e.id);
      const mine = e.pubkey === pub;
      let content = ''; try { content = await nip04decrypt(sk, peerPub, e.content); } catch (err) { content = '🔒 (could not decrypt)'; }
      const m = { id: e.id, mine, content, ts: e.created_at, pubkey: e.pubkey };
      msgs.set(e.id, m); push(m);
    };
    const deliverRx = (e) => {
      const tid = (e.tags.find(t => t[0] === 'e') || [])[1]; if (!tid) return;
      let m = rx.get(tid); if (!m) { m = new Map(); rx.set(tid, m); }
      if (e.content === '-' || e.content === '') m.delete(e.pubkey); else m.set(e.pubkey, e.content);
      const msg = msgs.get(tid); if (msg) push(msg);
    };
    const sub = pool.subscribeMany(window.Fellowship.relays, [
      { kinds: [4], authors: [pub], '#p': [peerPub] },   // sent by me to peer
      { kinds: [4], authors: [peerPub], '#p': [pub] },   // sent by peer to me
      { kinds: [7], authors: [pub], '#p': [peerPub] },   // my reactions to their DMs
      { kinds: [7], authors: [peerPub], '#p': [pub] },   // their reactions to my DMs
    ], { onevent(e) { if (e.kind === 7) deliverRx(e); else deliver(e); }, oneose() {} });
    return () => { try { sub.close(); } catch {} };
  },
  // react to a DM from a peer (NIP-25 kind-7). emoji '' or '-' retracts.
  async reactDM(peerPub, msgId, emoji) {
    if (!sk) await window.Fellowship.ready;
    if (!peerPub || !msgId) return null;
    const evt = finalizeEvent({ kind: 7, created_at: Math.floor(Date.now() / 1000), tags: [['e', msgId], ['p', peerPub], ['t', NET], ['k', '4']], content: emoji || '-' }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] reactDM failed', e); }
    return evt;
  },
  // inbox: every DM involving me, grouped by peer; onConvos([{ peer, lastTs, preview }]). Unsub fn.
  subscribeDMs(onConvos) {
    if (!pub) { onConvos([]); return () => {}; }
    const byPeer = new Map();
    const emit = () => onConvos([...byPeer.values()].sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)));
    const handle = async (e) => {
      const peer = e.pubkey === pub ? (e.tags.find(t => t[0] === 'p') || [])[1] : e.pubkey;
      if (!peer) return;
      const prev = byPeer.get(peer);
      if (prev && prev.lastTs >= e.created_at) return;
      let preview = ''; try { preview = await nip04decrypt(sk, peer, e.content); } catch (err) { preview = '🔒'; }
      byPeer.set(peer, { peer, lastTs: e.created_at, preview: (e.pubkey === pub ? 'You: ' : '') + preview });
      emit();
    };
    const sub = pool.subscribeMany(window.Fellowship.relays, [
      { kinds: [4], authors: [pub] }, { kinds: [4], '#p': [pub] },
    ], { onevent: handle, oneose() { emit(); } });
    return () => { try { sub.close(); } catch {} };
  },

  // live connection status of each configured relay (throwaway WS probe)
  async relayStatus() {
    return Promise.all(window.Fellowship.relays.map(url => new Promise(res => {
      let done = false;
      const finish = (status) => { if (done) return; done = true; try { ws.close(); } catch {} res({ url, status }); };
      let ws;
      try { ws = new WebSocket(url); } catch { return res({ url, status: 'off' }); }
      const t = setTimeout(() => finish('off'), 2500);
      ws.onopen = () => { clearTimeout(t); finish('on'); };
      ws.onerror = () => { clearTimeout(t); finish('off'); };
    })));
  },

  // watch several groups at once (for the group-list previews/unread); onEvent(groupId, e).
  // Scoped to the active church (read live so church switches don't miss events): churches that
  // happen to share a group id (e.g. "prayer") don't cross-contaminate each other's chat.
  subscribeGroups(groupIds, onEvent) {
    const set = new Set(groupIds);
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1], '#t': groupIds, limit: 500 }], {
      onevent(e) {
        const cp = window.Fellowship.churchPub;
        if (cp && !e.tags.some(t => t[0] === 'p' && t[1] === cp)) return;
        const gid = (e.tags.find(t => t[0] === 't' && set.has(t[1])) || [])[1];
        if (gid) { const dec = _decEvt(e); if (!dec) return; try { onEvent(gid, dec); } catch (err) { console.error(err); } }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // react to a message (NIP-25 kind 7). content = emoji, or '-' to retract.
  async react(groupId, targetId, targetPubkey, content) {
    if (!sk) await window.Fellowship.ready;
    const evt = finalizeEvent({
      kind: 7, created_at: Math.floor(Date.now() / 1000),
      tags: [['e', targetId], ['p', targetPubkey || ''], ['t', NET], ['t', groupId]], content,
    }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] react failed', e); }
    return evt;
  },

  // live reactions in a group; onReaction({ targetId, pubkey, content, ts })
  subscribeReactions(groupId, onReaction) {
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [7], '#t': [groupId], limit: 1000 }], {
      onevent(e) {
        const targetId = (e.tags.find(t => t[0] === 'e') || [])[1];
        if (targetId) { try { onReaction({ targetId, pubkey: e.pubkey, content: e.content, ts: e.created_at }); } catch (err) { console.error(err); } }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // live subscription to a group's messages; returns an unsubscribe fn
  subscribeGroup(groupId, onEvent) {
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1], '#t': [groupId], limit: 200 }], {
      onevent(e) {
        // belt-and-suspenders: only deliver events actually tagged for this group
        if (!e.tags.some(t => t[0] === 't' && t[1] === groupId)) return;
        // and only this church's messages (when scoped) — avoids cross-church group-id collisions
        const cp = window.Fellowship.churchPub;
        if (cp && !e.tags.some(t => t[0] === 'p' && t[1] === cp)) return;
        const dec = _decEvt(e); if (!dec) return;   // encrypted + I'm not a member (no key) → don't show
        try { onEvent(dec); } catch (err) { console.error(err); }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ── read a church's published GROUP definitions (kind 30078, by the steward console) ──
  // onGroups([{id,name,kind,sub}]) fires on change; returns an unsubscribe fn.
  subscribeChurchGroups(churchNpub, onGroups) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onGroups([]); return () => {}; }
    const byId = new Map();
    // honour the steward's chosen order (groups without an order fall to the end, by age)
    const emit = () => onGroups([...byId.values()].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [pubk], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d.startsWith(GROUPKEY_D)) { _ingestGroupKey(e); return; }   // an encrypted group's key envelope
        if (!d.startsWith(GROUP_D)) return;
        const id = d.slice(GROUP_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ── read the reading plans a church shares (kind-30078, d=plan:) ──
  subscribeChurchPlans(churchNpub, onPlans) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onPlans([]); return () => {}; }
    const PLAN_D = 'trinityone/plan:';
    const byId = new Map();
    const emit = () => onPlans([...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [pubk], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(PLAN_D)) return;
        const id = d.slice(PLAN_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ── read the devotionals a church shares (kind-30078, d=devotional:) — full content for rendering ──
  subscribeChurchDevotionals(churchNpub, onDevos) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onDevos([]); return () => {}; }
    const DEVO_D = 'trinityone/devotional:';
    const byId = new Map();
    // honour the steward's explicit order (lower = first); unordered devotionals fall back to newest-first
    const ord = d => (typeof d.order === 'number' ? d.order : Infinity);
    const emit = () => onDevos([...byId.values()].sort((a, b) => ord(a) - ord(b) || (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [pubk], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(DEVO_D)) return;
        const id = d.slice(DEVO_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ── generic reader for the church's own addressable docs with a given d-prefix ──
  _subChurchAddr(churchNpub, prefix, map, onItems) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onItems([]); return () => {}; }
    const byId = new Map();
    const emit = () => onItems([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [pubk], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(prefix)) return;
        const id = d.slice(prefix.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...map(JSON.parse(e.content), id), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // ── serving: services, per-service rotas, rosters, events the church publishes ──
  subscribeChurchServices(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/service:', (c, id) => ({ id, date: c.date, time: c.time, name: c.name }), cb); },
  subscribeChurchRotas(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/rota:', (c, id) => ({ service: id, published: !!c.published, assign: c.assign || {} }), cb); },
  subscribeChurchRosters(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/roster:', (c, id) => ({ team: id, roles: c.roles || [], people: c.people || [] }), cb); },
  subscribeChurchEvents(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/event:', (c) => ({ date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, image: c.image || '', groupId: c.groupId || '' }), cb); },
  // events posted by a GROUP'S leaders (members the church empowered) — authored by the member, scoped
  // to a group + p-tagged to the church. The relay only accepts these from authorised group leaders,
  // so anything that lands here is trustworthy. onEvents([{ id, ...fields, byMember }]). Unsub fn.
  subscribeGroupEvents(churchNpub, groupIds, onEvents) {
    const cp = toPub(churchNpub); const groups = (groupIds || []).filter(Boolean);
    if (!cp || !groups.length) { onEvents([]); return () => {}; }
    const byId = new Map();
    const emit = () => onEvents([...byId.values()].sort((a, b) => (a.date || '').localeCompare(b.date || '')));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], '#t': groups }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith('trinityone/event:')) return;
        // scope to this church (authored by it, or p-tagged to it by a group leader)
        if (e.pubkey !== cp && !e.tags.some(t => t[0] === 'p' && t[1] === cp)) return;
        const id = d.slice('trinityone/event:'.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { const c = JSON.parse(e.content); byId.set(id, { id, date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, image: c.image || '', groupId: c.groupId || '', byMember: e.pubkey !== cp, ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // a group leader posts an event for their group: signed by ME, scoped to the group, p-tagged to the church.
  async publishGroupEvent(churchNpub, groupId, ev) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !groupId) return null;
    const id = ev.id || ('evt' + Date.now() + Math.random().toString(36).slice(2, 6));
    const content = JSON.stringify({ date: ev.date || '', time: ev.time || '', title: ev.title || 'Event', where: ev.where || '', blurb: ev.blurb || '', accent: ev.accent || 'var(--clay)', image: ev.image || '', groupId });
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/event:' + id], ['t', NET], ['t', groupId], ['p', cp]], content }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] publishGroupEvent failed', e); return null; }
    return { id, ...JSON.parse(content) };
  },
  // the wider networks/groups-of-churches this church belongs to (it publishes network:<networkPub>)
  subscribeChurchNetworks(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/network:', (c, id) => ({ networkPub: id, npub: (() => { try { return npubEncode(id); } catch { return ''; } })() }), cb); },
  // a network's broadcast announcements (kind-1 authored by the network, tagged net-announce); newest first
  subscribeNetworkAnnouncements(networkNpub, onPosts) {
    const pubk = toPub(networkNpub);
    if (!pubk) { onPosts([]); return () => {}; }
    const byId = new Map();
    const emit = () => onPosts([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1], authors: [pubk], '#t': ['net-announce'] }], {
      onevent(e) { byId.set(e.id, { id: e.id, text: e.content, ts: e.created_at, networkPub: pubk }); emit(); },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ── serving requests the church p-tagged to ME ("can you serve?") ──
  subscribeMyServingRequests(onReqs) {
    const me = window.Fellowship.myPubkey;
    if (!me) { onReqs([]); return () => {}; }
    const REQUEST_D = 'trinityone/request:';
    const byId = new Map();
    const emit = () => onReqs([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], '#p': [me], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(REQUEST_D)) return;
        const id = d.slice(REQUEST_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, church: e.pubkey, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // member -> church: reply to a serving request (accept/decline/swap) — p-tagged to the church
  async respondToServingRequest(churchNpub, requestId, verdict, swapTo) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !sk) return;
    const content = JSON.stringify({ request: requestId, v: verdict, swapTo: swapTo || '' });
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/reqreply:' + requestId], ['t', NET], ['p', cp]], content }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch {}
    return evt;
  },
  // my replies to serving requests (own reqreply docs) -> { requestId: verdict }
  subscribeMyReqReplies(onReplies) {
    const me = window.Fellowship.myPubkey;
    if (!me) { onReplies({}); return () => {}; }
    const RR = 'trinityone/reqreply:'; const byReq = {};
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [me], '#t': [NET] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(RR)) return; try { byReq[d.slice(RR.length)] = JSON.parse(e.content).v; onReplies({ ...byReq }); } catch {} },
      oneose() { onReplies({ ...byReq }); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // member RSVP to a calendar event — one addressable doc per (member,event), p-tagged to church
  async setEventRsvp(churchNpub, eventId, verdict) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !sk) return;
    const content = JSON.stringify({ event: eventId, v: verdict });
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/rsvp:' + eventId], ['t', NET], ['p', cp]], content }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch {}
    return evt;
  },
  subscribeMyRsvps(onRsvps) {
    const me = window.Fellowship.myPubkey;
    if (!me) { onRsvps({}); return () => {}; }
    const RSVP_D = 'trinityone/rsvp:'; const byEvent = {};
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [me], '#t': [NET] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(RSVP_D)) return; try { byEvent[d.slice(RSVP_D.length)] = JSON.parse(e.content).v; onRsvps({ ...byEvent }); } catch {} },
      oneose() { onRsvps({ ...byEvent }); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // member sets the Sundays they're unavailable (own addressable doc, p-tagged to church)
  async setUnavailable(churchNpub, dates) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !sk) return;
    const me = window.Fellowship.myPubkey;
    const content = JSON.stringify({ dates: dates || [] });
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/unavail:' + me], ['t', NET], ['p', cp]], content }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch {}
    return evt;
  },

  // ── read a church's kind-0 profile (name etc.) -- used when following a church by npub ──
  subscribeChurchProfile(churchNpub, onProfile) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onProfile(null); return () => {}; }
    let latest = 0;
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [0], authors: [pubk] }], {
      onevent(e) { if (e.created_at < latest) return; latest = e.created_at; try { onProfile(JSON.parse(e.content)); } catch {} },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },
};
window.Fellowship.ready = init().catch(e => console.error('[fellowship] init failed', e));
