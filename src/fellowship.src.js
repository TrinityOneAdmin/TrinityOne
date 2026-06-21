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
const CATEGORY_D = 'trinityone/category:';   // church-signed named container that groups belong to (e.g. "Lifegroups")
const GROUPKEY_D = 'trinityone/groupkey:';   // church-signed envelope: the group key wrapped to each member
// safeguarding v2: a parent's local record of the child accounts they set up (no secrets — just the link)
const FAMILY_KEY = 'trinityone.family';
function _loadChildren() { try { return JSON.parse(localStorage.getItem(FAMILY_KEY) || '[]') || []; } catch { return []; } }
function _saveChildLink(link) { const list = _loadChildren().filter(c => c && c.child !== link.child); list.push(link); try { localStorage.setItem(FAMILY_KEY, JSON.stringify(list)); } catch {} }
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

// ── scheduled release (steward drip): a doc with a future `publishAt` (unix sec) is withheld from
// members until that time. The relay has no "publish later", so the gate is client-side: hide future
// items, and arm a one-shot timer to re-emit the moment the soonest one becomes due (so an open app
// reveals it on time, no reload). Items with no publishAt (or one already past) are always visible.
function scheduleVisible(list) {
  const nowS = Math.floor(Date.now() / 1000);
  return list.filter(m => !m.draft && (!m.publishAt || m.publishAt <= nowS));
}
// Re-fire a relay subscription when connectivity returns — a relay restart (e.g. the steward re-running
// the installer) severs every websocket, and an open subscription won't re-deliver on its own, leaving
// the list blank until a manual reload. makeSub() opens the relay subscription and returns its closer;
// on `online` / window focus / tab-visible we swap in a fresh one (debounced) so it self-heals in a
// second or two. Accumulator state lives in the caller's closure, so re-subscribing just refills it.
function withReconnect(makeSub) {
  // NOTE: reconnect/heartbeat re-subscribing was disabled — over a slow tunnel its repeated re-subscribes
  // churned subscriptions on the relay and starved later queries (notably the per-member name fetches).
  // Subscriptions are opened once and kept open (the original, reliable behaviour). Relay-restart recovery
  // can be reintroduced later in a way that doesn't re-fire every church subscription.
  const closer = makeSub();
  return () => { try { closer && closer(); } catch {} };
}
function scheduleNextReveal(list, timer, emit) {
  if (timer) { clearTimeout(timer); timer = null; }
  const nowMs = Date.now();
  let soonest = Infinity;
  for (const m of list) { const t = (m.publishAt || 0) * 1000; if (t > nowMs && t < soonest) soonest = t; }
  if (soonest === Infinity) return null;
  return setTimeout(emit, Math.min(soonest - nowMs + 250, 2147483647));   // cap at setTimeout's max delay
}
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
  // NAS node removed 2026-06-17: it was offline (and a plain nostr-rs-relay that can't enforce policy);
  // a dead entry just added connection lag. Re-add an always-on, enforcing node here later.
];
const CANONICAL_RELAY = CANONICAL_RELAYS[0];   // back-compat: the primary shared relay
// Church content (members, groups, plans, devotionals) must stay reachable on the church's SHARED relays
// even when the member also runs a private/home relay — otherwise a relay split (groups on one relay,
// member-joins on another) makes a screen load partial/empty. So we read church docs from the union of
// the member's own relays + the canonical pool, fanning the query across all of them.
function churchRelays() { return [...new Set([...(window.Fellowship.relays || []), ...CANONICAL_RELAYS])]; }
const RELAYS_KEY = 'trinityone.relays';
function loadRelays() {
  try { const r = JSON.parse(localStorage.getItem(RELAYS_KEY) || 'null'); if (Array.isArray(r) && r.length) return r; } catch {}
  // NEVER leave the relay list empty: a native install has no origin/persisted relay, and an empty list
  // means every publish (name, membership, chat, DMs) silently goes nowhere — the user can read but never
  // be seen. Fall back to the shared canonical pool so the app always has somewhere to publish + read.
  return (DEFAULT_RELAYS.length ? DEFAULT_RELAYS : CANONICAL_RELAYS).slice();
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
// NIP-42 auth is best-effort: public church reads are NOT auth-gated, so a slow/failed auth handshake
// (e.g. "auth timed out" over a tunnel) must never surface as an uncaught error or block anything.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const m = e && e.reason && (e.reason.message || String(e.reason));
    if (m && /auth[\s-]?(timed out|required|failed)|no key/i.test(m)) e.preventDefault();
  });
}

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

// cache the resolved church member roster + count per church, so the People list and the member count
// render INSTANTLY from the last-known state on app load (and offline / slow relay), then refresh live.
const MEMBERS_KEY = 'trinityone.members.';        // + churchPubHex -> JSON array of member objects
const MEMBERCOUNT_KEY = 'trinityone.membercount.'; // + churchPubHex -> number
function loadMembersCache(cp) { try { const a = JSON.parse(localStorage.getItem(MEMBERS_KEY + cp) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
function saveMembersCache(cp, list) { try { localStorage.setItem(MEMBERS_KEY + cp, JSON.stringify(list.slice(0, 500))); } catch {} }
function loadCountCache(cp) { const n = parseInt(localStorage.getItem(MEMBERCOUNT_KEY + cp) || '', 10); return Number.isFinite(n) ? n : null; }
function saveCountCache(cp, n) { try { localStorage.setItem(MEMBERCOUNT_KEY + cp, String(n)); } catch {} }
// generic per-church doc cache (groups / plans / devotionals): paint the last-known set instantly on
// load, then refresh live. `prefix` namespaces the kind of doc.
function loadDocCache(prefix, cp) { try { const a = JSON.parse(localStorage.getItem('trinityone.' + prefix + '.' + cp) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
function saveDocCache(prefix, cp, list) { try { localStorage.setItem('trinityone.' + prefix + '.' + cp, JSON.stringify(list.slice(0, 300))); } catch {} }

// ── client-side roster trust (security M2) ──────────────────────────────────────────────────────────
// The church's "voice" = the church key + its CURRENT signed roster. We verify this in the apps (not just
// trust the relay), so a forged ['church',cp]-tagged doc relayed from a rogue/permissive relay — or a
// revoked steward's old content — is dropped on display.
const _churchRoster = new Map();   // cp -> Set(steward pubkeys), from the church-key-signed stewards: doc
const _groupLeaders = new Map();   // groupId -> Set(empowered member pubkeys), from TRUSTED group defs only
const _fireTrust = () => { try { window.dispatchEvent(new CustomEvent('trinity-church-trust')); } catch {} };   // re-evaluate dependent reads when trust changes
// returns true (and updates the roster) if this event IS the church's signed steward roster
function _absorbRoster(cp, d, e) {
  if (d !== 'trinityone/stewards:' + cp || e.pubkey !== cp) return false;   // only trust it from the CHURCH key
  let pks = []; try { pks = (JSON.parse(e.content).pubkeys) || []; } catch {}
  _churchRoster.set(cp, new Set(pks)); _fireTrust();
  return true;
}
// is a stored church-content doc from a trusted voice? (`_by` = author; missing on legacy cache = trust it)
function _churchVoice(cp, doc) { const by = doc && doc._by; return by === undefined || by === cp || !!(_churchRoster.get(cp) && _churchRoster.get(cp).has(by)); }
// record a group's empowered leaders — only from a TRUSTED group def (church key or current roster steward)
function _noteGroupLeaders(cp, id, content, author) {
  if (author !== cp && !(_churchRoster.get(cp) && _churchRoster.get(cp).has(author))) return;
  _groupLeaders.set(id, new Set(Array.isArray(content && content.leaders) ? content.leaders : [])); _fireTrust();
}
// a group EVENT is trustworthy if authored by the church, a current roster steward, OR an empowered leader of that group
function _groupEventTrusted(cp, gid, by) { return by === undefined || by === cp || !!(_churchRoster.get(cp) && _churchRoster.get(cp).has(by)) || !!(gid && _groupLeaders.get(gid) && _groupLeaders.get(gid).has(by)); }

const AV_SYMBOLS = ['halo', 'dove', 'fish', 'flame', 'vine', 'wheat', 'anchor', 'crook', 'chalice', 'olive', 'mountain', 'well', 'star'];
// church-signed photo-suppression: pubkeys whose uploaded photo a steward has reset. Populated by
// subscribeChurchSafeguard (owner-only). The member can't be forced to change their key, but this
// church's clients won't *show* the photo — they fall back to the member's symbol/initial.
let _noPhoto = new Set();
function _avSuppressPhoto(pubkey, av) {
  if (av && av.kind === 'photo' && _noPhoto.has(pubkey)) return { kind: 'symbol', color: av.color, symbol: av.symbol || AV_SYMBOLS[hashStr(pubkey || '') % AV_SYMBOLS.length] };
  return av;
}
// resolved display = kind-0 name/avatar if known, else a deterministic anonymous handle + symbol
function displayFor(pubkey) {
  const base = profile(pubkey);
  const p = profiles[pubkey];
  const av = _avSuppressPhoto(pubkey, (p && p.av) || { kind: 'symbol', color: base.color, symbol: AV_SYMBOLS[hashStr(pubkey || '') % AV_SYMBOLS.length] });
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
  // ("@yourchurch" or "name@host") is looked up via the relay's /.well-known/nostr.json
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

  // live count of a church's members — matches the steward's rule: distinct people (not the church)
  // who posted (kind-1) or explicitly joined (member:<church>), minus those who left without posting.
  subscribeChurchMemberCount(churchNpub, cb) {
    const cp = toPub(churchNpub); if (!cp) { cb(0); return () => {}; }
    const MEMBER_D = 'trinityone/member:';
    const ppl = new Map();   // pubkey -> { msgs, joined }
    const cached = loadCountCache(cp);
    if (cached != null) cb(cached);   // show the last-known count instantly on load
    const tally = () => { let n = 0; for (const v of ppl.values()) if (v.msgs > 0 || v.joined) n++; saveCountCache(cp, n); cb(n); };
    const makeSub = () => {
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [1], '#p': [cp] }, { kinds: [30078], '#p': [cp] }], {
        onevent(e) {
          if (e.pubkey === cp) return;
          const m = ppl.get(e.pubkey) || { msgs: 0, joined: false };
          if (e.kind === 30078) {
            const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
            if (d.indexOf(MEMBER_D) !== 0) return;
            m.joined = !(e.tags.some(t => t[0] === 'deleted') || !e.content);
          } else { m.msgs++; }
          ppl.set(e.pubkey, m); tally();
        },
        oneose() { tally(); },
      });
      return () => { try { sub.close(); } catch {} };
    };
    return withReconnect(makeSub);
  },

  // the church's people, for a member-facing directory: distinct folks (not the church) who joined
  // (member:<church>) or posted (kind-1 p-tagged), with their kind-0 profile resolved. Same rule the
  // steward uses. Blocked members are withheld by the relay. The UI filters out the current user.
  subscribeChurchMembers(churchNpub, onMembers) {
    const cp = toPub(churchNpub); if (!cp) { onMembers([]); return () => {}; }
    const MEMBER_D = 'trinityone/member:';
    const byPub = new Map();          // pubkey -> { pubkey, npub, name, nip05, picture, joined, lastTs, msgs }
    // ONE kept-open kind-0 subscription resolves ALL members' names at once. A sub-per-member blew past
    // the relay's 64-subscription-per-connection cap (members + chat + a sub each = the later name fetches
    // got 'rate-limited' and dropped — the cause of blank names). Batched = a single sub regardless of size.
    let profSub = null; const profAuthors = new Set(); let profTimer = null;
    // seed from the persisted roster so the list paints instantly on load (then live events refresh it)
    for (const m of loadMembersCache(cp)) { if (m && m.pubkey) byPub.set(m.pubkey, m); }
    // a member who opted out (kind-0 `hidden`) is withheld from the directory the others see
    const emit = (done) => {
      const visible = [...byPub.values()].filter(m => !m.hidden && (m.joined || m.msgs > 0)).sort((a, b) => (b.lastTs || b.joined || 0) - (a.lastTs || a.joined || 0));
      saveMembersCache(cp, [...byPub.values()]);   // keep the cache warm for next launch
      onMembers(visible, !!done);
    };
    // seed name/nip05 from the persisted profile cache so known members render instantly (no resolve lag)
    const get = (pk) => byPub.get(pk) || { pubkey: pk, npub: npubEncode(pk), name: (profiles[pk] || {}).name || '', nip05: (profiles[pk] || {}).nip05 || '', picture: (profiles[pk] || {}).picture || '', hidden: !!(profiles[pk] || {}).hidden, joined: 0, lastTs: 0, msgs: 0 };
    // resolve each member's kind-0 name with its own subscription, kept OPEN (never closed on EOSE) so a
    // slow relay's reply is never cut off — this is the original, proven approach. One sub per member is a
    // touch chattier than a batch, but it reliably fills names in; correctness over cleverness.
    // (re)open the single profile sub for every still-unnamed member. churchRelays() — NOT
    // window.Fellowship.relays, which is empty on a native install. Kept open so a slow relay isn't cut off.
    const refreshProfiles = () => {
      profTimer = null;
      const authors = [...profAuthors].filter(pk => !(profiles[pk] && profiles[pk].name));
      if (!authors.length) return;
      try { profSub && profSub.close(); } catch {}   // replace the old one — never accumulate subscriptions
      profSub = pool.subscribeMany(churchRelays(), [{ kinds: [0], authors }], {
        onevent(e) { try { const meta = JSON.parse(e.content); profiles[e.pubkey] = { name: meta.name || meta.display_name || '', picture: meta.picture || '', about: meta.about || '', nip05: meta.nip05 || '', hidden: !!meta.hidden, av: meta.av || undefined }; saveProfiles(); const m = byPub.get(e.pubkey); if (m) { m.name = profiles[e.pubkey].name; m.picture = profiles[e.pubkey].picture; m.nip05 = profiles[e.pubkey].nip05; m.hidden = !!meta.hidden; } emit(); } catch {} },
        oneose() {},
      });
    };
    const ensureProfile = (pk) => {
      if (profAuthors.has(pk) || (profiles[pk] && profiles[pk].name)) return;
      profAuthors.add(pk);
      if (!profTimer) profTimer = setTimeout(refreshProfiles, 300);   // debounce the burst of arriving members
    };
    const makeSub = () => {
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [1], '#p': [cp] }, { kinds: [30078], '#p': [cp] }], {
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
        oneose() { emit(true); },   // initial load complete
      });
      return () => { try { sub.close(); } catch {} };
    };
    if (byPub.size) emit(false);   // paint the cached roster immediately, before the relay answers
    const stop = withReconnect(makeSub);
    return () => { stop(); if (profTimer) clearTimeout(profTimer); try { profSub && profSub.close(); } catch {} };
  },

  // relay configuration (persisted) — accepts ws:// or wss:// URLs
  setRelays(urls) {
    const list = [...new Set((urls || []).map(u => (u || '').trim()).filter(u => /^wss?:\/\//i.test(u)))];
    window.Fellowship.relays = list.length ? list : (DEFAULT_RELAYS.length ? DEFAULT_RELAYS : CANONICAL_RELAYS).slice();
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
    const hidden = (meta.hidden != null ? meta.hidden : prev.hidden);   // opt out of the member directory
    if (hidden) p.hidden = true;
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
          profiles[e.pubkey] = { name: m.name || m.display_name || '', picture: m.picture || '', about: m.about || '', nip05: m.nip05 || '', hidden: !!m.hidden, av: m.av || undefined };
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

  // ── moderation: pinned message + removed (hidden) messages (read-only on the member side) ──
  // Pin/hide docs are kind-30078 written by the church (steward) OR a group's leaders. The relay only
  // accepts them from the church/network or that group's leaders, so anything that arrives is trustworthy;
  // we still scope to the active church (authored by it, or p-tagged to it) to avoid cross-church bleed.
  // the current pin for a group → cb({ msgId, text, by, ts }) or cb(null) when unpinned. Unsub fn.
  subscribeGroupPin(groupId, cb) {
    if (!groupId) { cb(null); return () => {}; }
    const PIN_D = 'trinityone/pin:'; let latest = 0;
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], '#d': [PIN_D + groupId] }], {
      onevent(e) {
        const cp = window.Fellowship.churchPub;
        if (cp && e.pubkey !== cp && !e.tags.some(t => t[0] === 'p' && t[1] === cp)) return;   // this church's scope
        if (e.created_at < latest) return; latest = e.created_at;
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { cb(null); return; }
        try { cb(JSON.parse(e.content)); } catch { cb(null); }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },
  // the set of removed message ids for the active church → cb(Set<msgId>) on change. Unsub fn.
  subscribeHidden(cb) {
    const cp = window.Fellowship.churchPub;
    if (!cp) { cb(new Set()); return () => {}; }
    const HIDE_D = 'trinityone/hidden:'; const hidden = new Map();   // msgId -> hidden? (latest wins)
    const emit = () => cb(new Set([...hidden.entries()].filter(([, h]) => h).map(([id]) => id)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], '#p': [cp] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(HIDE_D)) return;
        if (e.pubkey !== cp && !e.tags.some(t => t[0] === 'p' && t[1] === cp)) return;
        hidden.set(d.slice(HIDE_D.length), !(e.tags.some(t => t[0] === 'deleted') || !e.content));
        emit();
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // ── moderation actions a GROUP LEADER may take (signed by me, scoped to the group, p-tagged to the
  // church). The relay only accepts these from the group's leaders (or the church), like group events. ──
  async pinPost(churchNpub, groupId, msg) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !groupId || !msg || !msg.id) return null;
    const content = JSON.stringify({ msgId: msg.id, text: msg.text || '', by: msg.pubkey || msg.by || '', ts: msg._ts || msg.ts || Math.floor(Date.now() / 1000) });
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/pin:' + groupId], ['t', NET], ['t', groupId], ['p', cp]], content }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] pinPost failed', e); return null; }
    return evt;
  },
  async unpin(churchNpub, groupId) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !groupId) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/pin:' + groupId], ['t', NET], ['t', groupId], ['p', cp], ['deleted', '1']], content: '' }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] unpin failed', e); return null; }
    return evt;
  },
  async hideMessage(churchNpub, groupId, msgId) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !msgId) return null;
    const tags = [['d', 'trinityone/hidden:' + msgId], ['t', NET], ['p', cp]];
    if (groupId) tags.push(['t', groupId]);
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags, content: JSON.stringify({ groupId: groupId || '' }) }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] hideMessage failed', e); return null; }
    return evt;
  },
  async unhideMessage(churchNpub, groupId, msgId) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !msgId) return null;
    const tags = [['d', 'trinityone/hidden:' + msgId], ['t', NET], ['p', cp], ['deleted', '1']];
    if (groupId) tags.push(['t', groupId]);
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] unhideMessage failed', e); return null; }
    return evt;
  },

  // ── read a church's published GROUP definitions (kind 30078, by the steward console) ──
  // onGroups([{id,name,kind,sub}]) fires on change; returns an unsubscribe fn.
  subscribeChurchGroups(churchNpub, onGroups) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onGroups([]); return () => {}; }
    const byId = new Map();
    for (const g of loadDocCache('groups', pubk)) { if (g && g.id) byId.set(g.id, g); }   // paint cached instantly
    // honour the steward's chosen order; client-roster-trust filters out forged/revoked authors (M2)
    const emit = () => { const v = [...byId.values()].filter(g => _churchVoice(pubk, g)); saveDocCache('groups', pubk, v); onGroups(v.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0))); };
    const makeSub = () => {
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], '#t': [NET] }, { kinds: [30078], '#church': [pubk], '#t': [NET] }], {
        onevent(e) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (_absorbRoster(pubk, d, e)) { emit(); return; }   // the church-signed steward roster
          if (d.startsWith(GROUPKEY_D)) { _ingestGroupKey(e); return; }   // an encrypted group's key envelope
          if (!d.startsWith(GROUP_D)) return;
          const id = d.slice(GROUP_D.length);
          if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
          try { const c = JSON.parse(e.content); byId.set(id, { id, ...c, ts: e.created_at, _by: e.pubkey }); _noteGroupLeaders(pubk, id, c, e.pubkey); emit(); } catch {}
        },
        oneose() { emit(); },
      });
      return () => { try { sub.close(); } catch {} };
    };
    if (byId.size) emit();   // paint cached groups before the relay answers
    return withReconnect(makeSub);
  },

  // ── read the church's group categories (named containers, kind-30078) ──
  // onCats([{ id, name, order, ts }]) sorted by the steward's order. Members section the group list by these.
  subscribeChurchCategories(churchNpub, onCats) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onCats([]); return () => {}; }
    const byId = new Map();
    for (const c of loadDocCache('categories', pubk)) { if (c && c.id) byId.set(c.id, c); }   // paint cached instantly
    const emit = () => { const v = [...byId.values()].filter(c => _churchVoice(pubk, c)); saveDocCache('categories', pubk, v); onCats(v.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0))); };
    const makeSub = () => {
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], '#t': [NET] }, { kinds: [30078], '#church': [pubk], '#t': [NET] }], {
        onevent(e) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (!d.startsWith(CATEGORY_D)) return;
          const id = d.slice(CATEGORY_D.length);
          if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
          try { const c = JSON.parse(e.content); byId.set(id, { id, ...c, ts: e.created_at, _by: e.pubkey }); emit(); } catch {}
        },
        oneose() { emit(); },
      });
      return () => { try { sub.close(); } catch {} };
    };
    if (byId.size) emit();   // paint cached categories before the relay answers
    return withReconnect(makeSub);
  },

  // ── safeguarding: read the church's minors + approved-adults lists (kind-30078) ──
  // onLists({ minors:[…], approved:[…], isMinor:bool }) — isMinor reflects THIS member's pubkey. The
  // member app uses it to show a child only child-safe groups and to hide/disable disallowed DMs. The
  // real enforcement is on the relay (gateway accept/canRead); this is the client-side experience.
  subscribeChurchSafeguard(churchNpub, onLists) {
    const pubk = toPub(churchNpub);
    if (!pubk) { _noPhoto = new Set(); onLists({ minors: [], approved: [], guardians: {}, nophoto: [], isMinor: false }); return () => {}; }
    let minors = [], approved = [], guardians = {}, nophoto = [];   // guardians: { childPub: [parentPub, …] }
    const me = window.Fellowship.myPubkey || pub;
    const emit = () => { _noPhoto = new Set(nophoto); onLists({ minors, approved, guardians, nophoto, isMinor: !!(me && minors.includes(me)), photoBlocked: !!(me && nophoto.includes(me)) }); };
    const makeSub = () => {
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], '#t': [NET] }, { kinds: [30078], '#church': [pubk], '#t': [NET] }], {
        onevent(e) {
          if (e.pubkey !== pubk) return;   // safeguarding lists are OWNER-ONLY — only ever trust the church key (M2/safeguarding)
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (d === 'trinityone/minors:' + pubk) { try { minors = (JSON.parse(e.content).pubkeys) || []; } catch { minors = []; } emit(); }
          else if (d === 'trinityone/approved:' + pubk) { try { approved = (JSON.parse(e.content).pubkeys) || []; } catch { approved = []; } emit(); }
          else if (d === 'trinityone/guardians:' + pubk) { try { guardians = (JSON.parse(e.content).links) || {}; } catch { guardians = {}; } emit(); }
          else if (d === 'trinityone/nophoto:' + pubk) { try { nophoto = (JSON.parse(e.content).pubkeys) || []; } catch { nophoto = []; } emit(); }
        },
        oneose() { emit(); },
      });
      return () => { try { sub.close(); } catch {} };
    };
    return withReconnect(makeSub);
  },

  // ── safeguarding v2: a parent creates a child account they own (mints a fresh key, sets the child up
  // in the church, and asks the steward to confirm the link). Returns { childPub, mnemonic, npub, name }
  // so the UI can show the child's recovery words + a one-scan login QR (handoff to the child's device).
  // The mnemonic is NOT persisted (paper stays foundational) — the parent saves it at creation. ──
  async createChildAccount(churchNpub, childName) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !sk) throw new Error('Join a church first.');
    const name = String(childName || '').trim(); if (!name) throw new Error('Enter the child’s name.');
    const inv = window.TrinityIdentity.makeInvite();                 // { mnemonic, profile } — vetted key minter
    const childSk = privateKeyFromSeedWords(inv.mnemonic);
    const childPub = getPublicKey(childSk);
    const ts = Math.floor(Date.now() / 1000);
    // the child's kind-0 profile (name + a verified handle on the church relay, mirroring publishProfile)
    const handleLocal = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 30);
    const relayHost = (CANONICAL_RELAY || '').replace(/^wss?:\/\//i, '').replace(/\/relay\/?$/i, '');
    const childProfile = { name }; if (handleLocal && relayHost) childProfile.nip05 = handleLocal + '@' + relayHost;
    const k0 = finalizeEvent({ kind: 0, created_at: ts, tags: [], content: JSON.stringify(childProfile) }, childSk);
    const join = finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/member:' + cp], ['t', NET], ['p', cp]], content: JSON.stringify({ joined: ts }) }, childSk);
    // the parent's guardian-link REQUEST (signed by the parent) — the steward confirms it
    const myName = (window.Fellowship.myProfile && window.Fellowship.myProfile.name) || '';
    const req = finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/guardreq:' + childPub], ['t', NET], ['p', cp], ['p', childPub]], content: JSON.stringify({ child: childPub, parent: pub, parentName: myName, childName: name }) }, sk);
    for (const e of [k0, join, req]) { try { await Promise.any(pool.publish(window.Fellowship.relays, e)); } catch (err) { console.warn('[fellowship] child setup publish failed', err); } }
    _saveChildLink({ child: childPub, name, churchPub: cp, ts });     // remember locally so the parent sees their children
    return { childPub, mnemonic: inv.mnemonic, npub: npubEncode(childPub), name };
  },
  // the children this parent has set up (local record; no secrets) — [{ child, name, churchPub, ts }]
  myChildren(churchNpub) {
    const list = _loadChildren();
    if (!churchNpub) return list;
    const cp = toPub(churchNpub); return cp ? list.filter(c => c.churchPub === cp) : list;
  },

  // ── joining: read whether a church gates joining behind steward approval, and where I stand ──
  // onState({ approval, isAdmitted, isPending }). isPending = the church requires approval and I'm not
  // on its admitted list yet (the relay withholds my posting until the steward approves me).
  subscribeChurchJoin(churchNpub, onState) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onState({ approval: false, isAdmitted: true, isPending: false }); return () => {}; }
    let approval = false, admitted = [];
    const me = window.Fellowship.myPubkey || pub;
    const emit = () => { const isAdmitted = !!(me && admitted.includes(me)); onState({ approval, isAdmitted, isPending: approval && !isAdmitted }); };
    const makeSub = () => {
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], '#t': [NET] }, { kinds: [30078], '#church': [pubk], '#t': [NET] }], {
        onevent(e) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (_absorbRoster(pubk, d, e)) { emit(); return; }
          if (e.pubkey !== pubk && !(_churchRoster.get(pubk) && _churchRoster.get(pubk).has(e.pubkey))) return;   // trust church key or a current roster steward (M2)
          if (d === 'trinityone/joinpolicy:' + pubk) { if (e.tags.some(t => t[0] === 'deleted') || !e.content) approval = false; else { try { approval = !!JSON.parse(e.content).approval; } catch { approval = false; } } emit(); }
          else if (d === 'trinityone/admitted:' + pubk) { try { admitted = (JSON.parse(e.content).pubkeys) || []; } catch { admitted = []; } emit(); }
        },
        oneose() { emit(); },
      });
      return () => { try { sub.close(); } catch {} };
    };
    return withReconnect(makeSub);
  },

  // ── read the reading plans a church shares (kind-30078, d=plan:) ──
  subscribeChurchPlans(churchNpub, onPlans) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onPlans([]); return () => {}; }
    const PLAN_D = 'trinityone/plan:';
    const byId = new Map();
    for (const p of loadDocCache('plans', pubk)) { if (p && p.id) byId.set(p.id, p); }   // paint cached instantly
    let timer = null;   // re-emit when the next scheduled item is due (drip release)
    const emit = () => {
      const all = [...byId.values()].filter(x => _churchVoice(pubk, x));   // roster-trust (M2)
      saveDocCache('plans', pubk, all);
      onPlans(scheduleVisible(all).sort((a, b) => (a.ts || 0) - (b.ts || 0)));
      timer = scheduleNextReveal(all, timer, emit);
    };
    const makeSub = () => {
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], '#t': [NET] }, { kinds: [30078], '#church': [pubk], '#t': [NET] }], {
        onevent(e) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (_absorbRoster(pubk, d, e)) { emit(); return; }
          if (!d.startsWith(PLAN_D)) return;
          const id = d.slice(PLAN_D.length);
          if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
          try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at, _by: e.pubkey }); emit(); } catch {}
        },
        oneose() { emit(); },
      });
      return () => { try { sub.close(); } catch {} };
    };
    if (byId.size) emit();   // paint cached plans before the relay answers
    const stop = withReconnect(makeSub);
    return () => { stop(); if (timer) clearTimeout(timer); };
  },

  // ── read the devotionals a church shares (kind-30078, d=devotional:) — full content for rendering ──
  subscribeChurchDevotionals(churchNpub, onDevos) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onDevos([]); return () => {}; }
    const DEVO_D = 'trinityone/devotional:';
    const byId = new Map();
    for (const dv of loadDocCache('devos', pubk)) { if (dv && dv.id) byId.set(dv.id, dv); }   // paint cached instantly
    // honour the steward's explicit order (lower = first); unordered devotionals fall back to newest-first
    const ord = d => (typeof d.order === 'number' ? d.order : Infinity);
    let timer = null;   // re-emit when the next scheduled devotional is due (drip release)
    const emit = () => {
      const all = [...byId.values()].filter(x => _churchVoice(pubk, x));   // roster-trust (M2)
      saveDocCache('devos', pubk, all);
      onDevos(scheduleVisible(all).sort((a, b) => ord(a) - ord(b) || (b.ts || 0) - (a.ts || 0)));
      timer = scheduleNextReveal(all, timer, emit);
    };
    const makeSub = () => {
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], '#t': [NET] }, { kinds: [30078], '#church': [pubk], '#t': [NET] }], {
        onevent(e) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (_absorbRoster(pubk, d, e)) { emit(); return; }
          if (!d.startsWith(DEVO_D)) return;
          const id = d.slice(DEVO_D.length);
          if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
          try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at, _by: e.pubkey }); emit(); } catch {}
        },
        oneose() { emit(); },
      });
      return () => { try { sub.close(); } catch {} };
    };
    if (byId.size) emit();   // paint cached devotionals before the relay answers
    const stop = withReconnect(makeSub);
    return () => { stop(); if (timer) clearTimeout(timer); };
  },

  // ── generic reader for the church's own addressable docs with a given d-prefix ──
  _subChurchAddr(churchNpub, prefix, map, onItems) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onItems([]); return () => {}; }
    const byId = new Map();
    const emit = () => onItems([...byId.values()].filter(x => _churchVoice(pubk, x)).sort((a, b) => (b.ts || 0) - (a.ts || 0)));   // roster-trust (M2)
    const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], '#t': [NET] }, { kinds: [30078], '#church': [pubk], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (_absorbRoster(pubk, d, e)) { emit(); return; }
        if (!d.startsWith(prefix)) return;
        const id = d.slice(prefix.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...map(JSON.parse(e.content), id), ts: e.created_at, _by: e.pubkey }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // ── serving: services, per-service rotas, rosters, events the church publishes ──
  subscribeChurchServices(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/service:', (c, id) => ({ id, date: c.date, time: c.time, name: c.name }), cb); },
  subscribeChurchRunsheets(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/runsheet:', (c, id) => ({ service: id, items: Array.isArray(c.items) ? c.items : [] }), cb); },
  subscribeChurchRotas(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/rota:', (c, id) => ({ service: id, published: !!c.published, assign: c.assign || {} }), cb); },
  subscribeChurchRosters(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/roster:', (c, id) => ({ team: id, roles: c.roles || [], people: c.people || [] }), cb); },
  subscribeChurchEvents(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/event:', (c) => ({ date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, image: c.image || '', groupId: c.groupId || '' }), cb); },
  // events posted by a GROUP'S leaders (members the church empowered) — authored by the member, scoped to
  // a group. Client-verified (M2): we only show events from the church, a current roster steward, or an
  // empowered leader of that group (per the trusted group def). onEvents([{ id, ...fields, byMember }]).
  subscribeGroupEvents(churchNpub, groupIds, onEvents) {
    const cp = toPub(churchNpub); const groups = (groupIds || []).filter(Boolean);
    if (!cp || !groups.length) { onEvents([]); return () => {}; }
    const byId = new Map();
    const emit = () => onEvents([...byId.values()].filter(x => _groupEventTrusted(cp, x._gid, x._by)).sort((a, b) => (a.date || '').localeCompare(b.date || '')));
    const onTrust = () => emit();   // re-evaluate when the roster / group-leader lists load or change
    window.addEventListener('trinity-church-trust', onTrust);
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], '#t': groups }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith('trinityone/event:')) return;
        const gid = (e.tags.find(t => t[0] === 't' && groups.includes(t[1])) || [])[1] || '';
        const id = d.slice('trinityone/event:'.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { const c = JSON.parse(e.content); byId.set(id, { id, date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, image: c.image || '', groupId: c.groupId || '', byMember: e.pubkey !== cp, ts: e.created_at, _by: e.pubkey, _gid: gid }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { window.removeEventListener('trinity-church-trust', onTrust); try { sub.close(); } catch {} };
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

  // ── self-encryption (NIP-44 to one's own key): for encrypting on-device secrets at rest, e.g. the
  // wallet's bearer ecash in localStorage. Synchronous; returns null if the key isn't loaded yet. ──
  encryptSelf(str) { try { return (sk && pub) ? nip44e(String(str), nip44ck(sk, pub)) : null; } catch { return null; } },
  decryptSelf(ct) { try { return (sk && pub) ? nip44d(String(ct), nip44ck(sk, pub)) : null; } catch { return null; } },

  // ── Wallet backup (NIP-60-aligned): one replaceable doc, encrypted to the member's OWN key ──
  // The in-app Cashu wallet (mint + proofs) is mirrored here so a reinstall restores the balance
  // from the same identity + relays — the wallet IS the Nostr identity. d = 'trinityone/wallet:<suffix>'.
  // Always written over churchRelays() so it lands on the canonical relays (master-01) for recovery.
  async publishWalletBackup(suffix, obj) {
    if (!sk || !pub) return null;
    let content; try { content = nip44e(JSON.stringify(obj), nip44ck(sk, pub)); } catch (e) { return null; }
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/wallet:' + suffix], ['t', NET]], content }, sk);
    try { await Promise.any(pool.publish(churchRelays(), evt)); } catch (e) { console.warn('[fellowship] wallet backup failed', e); }
    return evt;
  },
  subscribeWalletBackup(suffix, onDoc) {
    if (!pub) { onDoc(null); return () => {}; }
    let latest = 0;
    const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pub], '#d': ['trinityone/wallet:' + suffix] }], {
      onevent(e) { if (e.created_at < latest) return; latest = e.created_at; try { onDoc(JSON.parse(nip44d(e.content, nip44ck(sk, pub)))); } catch {} },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },
};
window.Fellowship.ready = init().catch(e => console.error('[fellowship] init failed', e));
