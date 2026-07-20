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

// DM crypto (Finding 5): SEND with NIP-44 (modern, authenticated, versioned padding) — NIP-04 is deprecated
// (malleable, no MAC in older impls, no padding). DECRYPT tries NIP-44 first, then falls back to NIP-04 so
// pre-upgrade DMs AND messages from a peer who hasn't updated yet still open during the transition. (The
// ENVELOPE metadata is handled server-side by the deanon Finding-1 read-gate; NIP-17 gift-wrap is the roadmap
// fix that hides it end-to-end.) nip44 encrypt/decrypt are sync (conversation-key based); nip04decrypt is async.
const _dmEncrypt = (sk, peerPub, text) => nip44e(text, nip44ck(sk, peerPub));
const _dmDecrypt = async (sk, peerPub, ct) => { try { return nip44d(ct, nip44ck(sk, peerPub)); } catch { return await nip04decrypt(sk, peerPub, ct); } };

// a church is identified by its npub (or hex pubkey) -- resolve to a 32-byte hex pubkey
function toPub(npubOrHex) {
  if (!npubOrHex) return null;
  if (/^[0-9a-f]{64}$/i.test(npubOrHex)) return npubOrHex.toLowerCase();
  try { const d = nip19decode(npubOrHex); return d.type === 'npub' ? d.data : null; } catch { return null; }
}
const GROUP_D = 'trinityone/group:';
const CATEGORY_D = 'trinityone/category:';   // church-signed named container that groups belong to (e.g. "Lifegroups")
const GROUPKEY_D = 'trinityone/groupkey:';   // church-signed envelope: the group key wrapped to each member
const GUARDNOTICE_D = 'trinityone/guardnotice:';   // church->parent notice of a steward-made guardian link, p-tagged + NIP-44-encrypted to the parent
const SERMON_D = 'trinityone/sermon:';   // Phase 5 Tier 2: a church-signed self-hosted media item — references a content-addressed blob by sha256 + host(s)
const MEDIAKEY_D = 'trinityone/mediakey:';   // Tier 2 encryption: per-church AES-GCM media key, wrapped (NIP-44) to each member
const CAREKEY_D = 'trinityone/carekey:';     // per-church CARE key, wrapped (NIP-44) to each member — seals the identifying half of a care need
const PINSERMON_D = 'trinityone/pinsermon:';   // the church's currently-featured sermon → Today card + notification
async function _sha256hex(u8) { const d = await crypto.subtle.digest('SHA-256', u8); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); }
// Meal trains / Care module (optional, per church). meals-settings is church-signed; care: needs come from
// church/steward/care-team admins; careslot: are member offers to help; careskip: is RECIPIENT-only.
const MEALS_SETTINGS_D = 'trinityone/meals-settings';
const CARE_D = 'trinityone/care:';        // a care need — d=care:<id>
const ROSTER_PFX = 'trinityone/roster:';  // a team roster (people); the meals-admin one names the care-team admins (M2)
const CARESLOT_D = 'trinityone/careslot:';// a member's offer for one (need,date) — d=careslot:<careId>:<iso>
const CARESKIP_D = 'trinityone/careskip:';// recipient marks a day they don't need help — d=careskip:<careId>:<iso>
const CAREAVAIL_D = 'trinityone/careavail:';// a member's "I'm here to help" availability — d=careavail:<churchpub> (one per member per church)
const SAFETY_D = 'trinityone/safetycheck:';// the church's active safety check ("are you safe?") — d=safetycheck:<churchpub>
const SAFE_D = 'trinityone/safe:';         // a member's response — d=safe:<churchpub>, content NIP-44-encrypted to the check's creator
// safeguarding v2: a parent's local record of the child accounts they set up (no secrets — just the link)
const FAMILY_KEY = 'trinityone.family';
function _loadChildren() { try { return JSON.parse(localStorage.getItem(FAMILY_KEY) || '[]') || []; } catch { return []; } }
function _saveChildLink(link) { const list = _loadChildren().filter(c => c && c.child !== link.child); list.push(link); try { localStorage.setItem(FAMILY_KEY, JSON.stringify(list)); } catch {} }
// SECURITY-AUDIT-2026-07-06 H5: cache group keys per CHURCH, not by bare group-id. Group ids are the
// low-entropy, attacker-guessable `grp<Date.now()>`; a member also joined to an attacker-run church could
// otherwise publish a church-signed `groupkey:<victimGroupId>` that clobbers the real church's cached key
// for the same id (→ DoS the encrypted group, or seal the victim's next post under the attacker's key and
// read the plaintext). Keying by `<churchPub>|<gid>` isolates each church's key space so ids can't collide.
const _gkeys = {};   // "<cp>|<groupId>" -> Uint8Array(32) group key, unwrapped from that church's envelope for me
const _gkeyTs = {};  // "<cp>|<groupId>" -> newest envelope created_at accepted (stale-drop for replayed rotations)
const _gkKey = (cp, gid) => (cp || '') + '|' + gid;
const _hex = (u) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
const _unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
// unwrap my entry from a key envelope and cache the group key (NIP-44, church<->me conversation key).
// SECURITY (audit 2026-07-06 #4): the envelope is church-signed, so accept it ONLY from the church key or a
// current roster steward. The unwrap uses the conversation key with the AUTHOR, so an attacker-signed
// envelope (arriving on a shared/second-church relay whose write-gate we don't control) would otherwise
// decrypt fine and let the attacker SUBSTITUTE or DELETE the group key. cp is the owning church pubkey.
function _ingestGroupKey(cp, e) {
  const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(GROUPKEY_D)) return;
  if (e.pubkey !== cp && !(_churchRoster.get(cp) && _churchRoster.get(cp).has(e.pubkey))) return;   // untrusted author
  const gid = d.slice(GROUPKEY_D.length);
  const k = _gkKey(cp, gid);
  const ts = e.created_at || 0;
  if (ts > Math.floor(Date.now() / 1000) + FUTURE_SKEW) return;   // SECURITY-AUDIT-2026-07-06 H5: a far-future envelope must not wedge future rotations via the stale-drop below
  if (ts < (_gkeyTs[k] || 0)) return;   // a lagging relay replaying an OLDER envelope can't resurrect a rotated-out key
  _gkeyTs[k] = ts;
  try {
    const env = JSON.parse(e.content || '{}');
    const mine = env.keys && pub && env.keys[pub];
    if (mine && sk) _gkeys[k] = _unhex(nip44d(mine, nip44ck(sk, e.pubkey)));
    else if (!mine) delete _gkeys[k];   // dropped from the group (rotation) → lose the key
  } catch {}
}
// ── care key (SECURITY-AUDIT-2026-07-20 H3) ───────────────────────────────────────────────────────
// Same envelope as the group/media key: one symmetric key per church, wrapped to each member with NIP-44,
// church-signed. It seals the identifying half of a care need (who it's for, the free-text notes, the
// recipient pubkey, dietary needs) so the relay operator, a non-enforcing relay, and anyone who leaves the
// church can't read it — while the clear half (type/dates) still renders for everyone so members can
// volunteer. Author discipline mirrors _ingestGroupKey: accept only from the church key or one of its
// CURRENT rostered stewards, so an attacker-signed envelope on a shared relay can't substitute the key.
const _carekeys = {};    // churchPub -> Uint8Array(32)
const _carekeyTs = {};   // churchPub -> newest envelope created_at accepted (stale-drop for replays)
function _ingestCareKey(cp, e) {
  if (e.pubkey !== cp && !(_churchRoster.get(cp) && _churchRoster.get(cp).has(e.pubkey))) return;   // untrusted author
  const ts = e.created_at || 0;
  if (ts > Math.floor(Date.now() / 1000) + FUTURE_SKEW) return;   // a far-future envelope must not wedge future rotations
  if (ts < (_carekeyTs[cp] || 0)) return;                          // a lagging relay can't resurrect a rotated-out key
  _carekeyTs[cp] = ts;
  try {
    const env = JSON.parse(e.content || '{}');
    const mine = env.keys && pub && env.keys[pub];
    if (mine && sk) _carekeys[cp] = _unhex(nip44d(mine, nip44ck(sk, e.pubkey)));
    else if (!mine) delete _carekeys[cp];   // no longer keyed (left the church / rotation) → lose the key
  } catch {}
}
// open the sealed half of a care need for church `cp`; null if we hold no key (UI shows "details hidden").
function _careOpen(cp, ct) {
  const key = _carekeys[cp];
  if (!key) return null;
  try { return JSON.parse(nip44d(ct, key)); } catch { return null; }
}
// transparently decrypt an encrypted group message → event with plaintext content; null if it's
// encrypted and I don't hold the key (so the UI simply never sees it).
function _decEvt(cp, e) {
  if (!e.tags || !e.tags.some(t => t[0] === 'enc')) return e;
  const gid = (e.tags.find(t => t[0] === 't' && t[1] !== NET) || [])[1];
  const key = gid && _gkeys[_gkKey(cp, gid)];   // SECURITY-AUDIT-2026-07-06 H5: this church's key for this gid, not a collided one
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
// (Relay-restart recovery lives at the APP level: app.jsx's connTick tears down and re-creates every
// church subscription on resume/online/heartbeat. The shared hubs below make that cheap — a re-open
// reuses the in-memory buffer + a persisted `since` cursor instead of re-streaming the whole corpus.)
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
  'wss://app.trinityone.church/relay',                    // a8 / master-01 via Cloudflare — primary (own domain)
  'wss://trinityone-master-01.tailbeaac0.ts.net/relay',   // same box via Tailscale Funnel — independent network path, fallback
  // dev-box relay (trinityone.tailbeaac0.ts.net) dropped 2026-06-25 on the trinityone.church go-live: not a
  // production node. NAS node removed 2026-06-17 (offline + non-enforcing). Add an always-on second box here later.
];
const CANONICAL_RELAY = CANONICAL_RELAYS[0];   // back-compat: the primary shared relay
// Church content (members, groups, plans, devotionals) must stay reachable on the church's SHARED relays
// even when the member also runs a private/home relay — otherwise a relay split (groups on one relay,
// member-joins on another) makes a screen load partial/empty. So we read church docs from the union of
// the member's own relays + the canonical pool, fanning the query across all of them.
function churchRelays() { return [...new Set([...(window.Fellowship.relays || []), ...CANONICAL_RELAYS])]; }
// FEDERATION Phase 4 — decentralise the default. Track the enforcing relays each church declares as its OWN
// (from its NIP-65 list, non-canonical), so we can read a self-hosted church WITHOUT the shared a8 fallback.
const _churchRelays = new Map();   // cp -> Map(wssUrl -> relayPub|null): the church's adopted OWN relays. keys = read union; distinct non-null values = distinct relay BOXES (R3 self-sufficiency, dedup by identity not URL).
const _churchList   = new Map();   // cp -> { at, want:Set(url) }: the newest ACCEPTED church-signed relay-list, held in memory; drives (re)adoption + revocation.
const _applying     = new Set();   // cp currently inside _applyChurchList — coalesces re-entrant churn (addRelay itself fires 'trinity-relays').
const LISTHW_KEY = 'trinityone.relaylist.hw';   // persisted {cp: created_at} high-water — blocks a replayed OLDER list from downgrading or resurrecting a burned relay (R2 anti-replay).
function _loadHW(cp) { try { const v = JSON.parse(localStorage.getItem(LISTHW_KEY) || '{}')[cp]; return (typeof v === 'number' && isFinite(v)) ? v : 0; } catch { return 0; } }   // type-guarded: garbage → 0 (safe newest-wins-from-scratch)
function _saveHW(cp, at) { try { const m = JSON.parse(localStorage.getItem(LISTHW_KEY) || '{}'); if (typeof m[cp] !== 'number' || at > m[cp]) { m[cp] = at; localStorage.setItem(LISTHW_KEY, JSON.stringify(m)); } } catch {} }
// R2 revoke: the church dropped `url` from its newest list → stop using it. Remove from the live pool only when safe:
// never the shared canonical pool, never the origin/invite bootstrap relay, never a relay another church still lists.
function _maybeDropRelay(url, exceptCp) {
  if (CANONICAL_RELAYS.includes(url) || DEFAULT_RELAYS.includes(url)) return;
  for (const [c, m] of _churchRelays) { if (c !== exceptCp && m.has(url)) return; }   // still in use by another church
  try { window.Fellowship.removeRelay(url); } catch {}
  try { pool.close([url]); } catch {}
}
// R2 core: (re)apply a church's newest accepted list — adopt its enforcing relays, revoke the ones it dropped.
// Idempotent + re-drivable (called on reconnect churn), so a transient NIP-11 probe timeout does NOT strand a
// self-hosted member — the next churn re-adopts. RACE-SAFE: every async step re-checks the list is still the newest
// (`.at === at`), so a stale pass can never resurrect a relay a newer list burned (#2). Never revokes/persists for a
// pass that got superseded mid-flight.
async function _applyChurchList(cp) {
  if (_applying.has(cp)) return; _applying.add(cp);
  try {
    const cur = _churchList.get(cp); if (!cur) return;
    const at = cur.at, want = cur.want;
    await Promise.all([...want].map(async (u) => {
      let info = null; try { info = await _relayInfo(u); } catch {}
      if ((_churchList.get(cp) || {}).at !== at) return;      // a newer list arrived mid-probe → abandon this stale pass
      if (!info || info.enforces !== true) return;            // capability gate (fail-closed); unreachable → retried on next churn
      if (!_churchRelays.has(cp)) _churchRelays.set(cp, new Map());
      _churchRelays.get(cp).set(u, info.relayPub || null);    // value = identity → distinct-box count (R3)
      if (!(window.Fellowship.relays || []).includes(u)) window.Fellowship.addRelay(u);
    }));
    if ((_churchList.get(cp) || {}).at !== at) return;        // superseded during adoption → don't revoke or persist
    const own = _churchRelays.get(cp);
    if (own) for (const u of [...own.keys()]) { if (!want.has(u)) { own.delete(u); _maybeDropRelay(u, cp); } }   // burn the omitted relays
    _saveHW(cp, at);
  } finally { _applying.delete(cp); }
}
// relaysForChurch(cp): the read set for ONE church. If the church declares >=2 enforcing relays of its own it's
// self-sufficient — drop the a8 fallback FOR THIS CHURCH (a8 no longer sees or gatekeeps its traffic, and it's
// no longer dependent on a8). Otherwise keep a8 (the pilot, and any church still on the shared relay). Per-church
// + reversible: dropping a8 for a self-hosted church never affects a church still using it, and a8 stays in code.
function relaysForChurch(cp) {
  const own = cp && _churchRelays.get(cp);   // Map(url -> relayPub|null)
  const global = window.Fellowship.relays || [];
  const ownUrls = own ? [...own.keys()] : [];
  // R3: "self-sufficient" (safe to drop the shared canonical fallback) requires >=2 DISTINCT relay BOXES of the
  // church's own — counted by identity key (relayPub), NOT by URL. Two routes to one relay (Cloudflare + Tailscale,
  // the a8 pattern) share a relayPub and count ONCE, so a church that only LOOKS redundant keeps its safety net.
  // Relays too old to advertise an identity (null) aren't counted, so this stays conservative (fallback retained).
  const boxes = own ? new Set([...own.values()].filter(Boolean)).size : 0;
  if (boxes >= 2) return [...new Set([...ownUrls, ...global.filter(r => !CANONICAL_RELAYS.includes(r))])];
  return [...new Set([...global, ...ownUrls, ...CANONICAL_RELAYS])];
}
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
// SECURITY-AUDIT-2026-07-06 M3: true once we know we belong to an invite-only group — the only reason a member
// needs to prove their key to the relay. Set from the (public) group defs; never proactively otherwise.
let _needAuth = true;
// NIP-42: when a relay challenges, prove our pubkey by signing the auth event with our key — so the relay serves
// us our church's PRIVATE docs (the member roster, safeguarding lists, media key, Care module, invite groups).
// SECURITY-AUDIT-2026-07-13: this was `false` (auth only in the guardian flow), which meant an ordinary member
// never authenticated — and because the relay can't then tell a member from an anonymous attacker, it served the
// membership roster + care PII to the whole internet (the arrest-list leak). Those docs are now NIP-42-gated on the
// relay, so a member MUST authenticate to read them. Auth is still LAZY — the pool signs only when a relay actually
// challenges (i.e. only when we REQ gated content), so pure public browsing sends no auth. The privacy trade is
// small and mostly illusory: a member who has JOINED already publishes a signed member: doc over this same
// connection, so the relay already knows their pubkey; auth only additionally exposes a pure lurker. For an
// underground church, not leaking the roster to anonymous clients outweighs a joined member proving they're a
// member to their own church's relay. (Child safety was always enforced server-side regardless of this flag.)
pool.automaticallyAuth = () => async (authEvent) => {
  if (!_needAuth) throw new Error('nip42: auth declined — no gated resource for this member');
  if (!sk) { try { await window.Fellowship.ready; } catch {} }
  if (!sk) throw new Error('no key');
  return finalizeEvent(authEvent, sk);
};
// FEDERATION Phase 2 — enforcement probe. Before ADOPTING a relay a church declares in its signed NIP-65
// list, confirm the relay actually applies TrinityOne's membership/safeguarding policy by reading its
// NIP-11 doc and checking `trinityone.enforces`. This is a CAPABILITY check, not the trust anchor — the
// trust anchor is that the relay came from the church's own SIGNED kind:10002 (a bad relay can't inject
// itself; a lying relay only gets in if the church itself put it there). Fail-closed: unreachable or
// unverified → not adopted, so a gated read never lands on a relay that would serve it to anyone.
const _relayInfoCache = new Map();   // wssUrl -> Promise<trinityone-block|null>, cached so we probe each relay once
function _relayInfo(wssUrl) {
  if (_relayInfoCache.has(wssUrl)) return _relayInfoCache.get(wssUrl);
  const p = (async () => {
    try {
      const httpUrl = String(wssUrl).replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://').replace(/\/+$/, '');
      // Hard timeout via Promise.race — CapacitorHttp (native iOS/Android) patches fetch and may IGNORE the
      // AbortController signal, so the race is what actually bounds a hung probe on-device (web honours both).
      const ctrl = new AbortController(); const to = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 6000);
      const info = await Promise.race([
        (async () => { const res = await fetch(httpUrl, { headers: { Accept: 'application/nostr+json' }, signal: ctrl.signal }); return res.ok ? res.json() : null; })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('relay-info timeout')), 6500)),
      ]);
      clearTimeout(to);
      return (info && info.trinityone) ? { ...info.trinityone, name: info.name || '' } : null;
    } catch { return null; }   // fail-closed: unreachable/unparseable/timeout = no capability info
  })();
  _relayInfoCache.set(wssUrl, p);
  return p;
}
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
// P4: coalesce per-message profile lookups into ONE kind-0 sub. Firing a separate sub per unknown chat author
// (as a 200-message backfill does) can approach the relay's 64-sub-per-connection cap — the "names blank" failure.
const _profQueue = new Set();
let _profTimer = null;
function _flushProfiles() {
  _profTimer = null;
  const authors = [..._profQueue]; _profQueue.clear();
  if (!authors.length) return;
  const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [0], authors }], {
    onevent(e) {
      try {
        const m = JSON.parse(e.content);
        profiles[e.pubkey] = { name: m.name || m.display_name || '', picture: m.picture || '', about: m.about || '', nip05: m.nip05 || '', hidden: !!m.hidden, av: m.av || undefined };
        saveProfiles();
        window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: e.pubkey } }));
      } catch {}
    },
    oneose() { authors.forEach(pk => pendingProfiles.delete(pk)); try { sub.close(); } catch {} },
  });
}
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

// ── shared per-church subscription hubs (efficiency fix E2) ─────────────────────────────────────────
// Every church-docs reader used to open its OWN relay subscription carrying the byte-identical broad
// filter (ALL of the church's kind-30078 docs), then discriminate client-side by d-tag prefix — so
// opening the church screen re-streamed the whole doc corpus ~9+ times over, and every reconnect
// (connTick fires every 90s while foregrounded) re-downloaded it all again. Now ONE subscription per
// church feeds an in-memory bus; each feature registers a d-prefix handler and gets (a) a synchronous
// replay of the buffered corpus (cache-first paint preserved), then (b) live events.
//
// The buffer keeps the latest event per (author, d-tag) — exactly the addressable-event identity — and
// is persisted to localStorage together with a `since` cursor (running max created_at). A re-open only
// asks the relay for events newer than the cursor minus a clock-skew slop; everything older replays
// from the buffer, INCLUDING the in-memory-only docs a naive cursor would silently lose (the steward
// roster for _churchVoice, group-key envelopes, safeguarding lists, meals settings). Deletions are
// tombstone docs with a fresh created_at, so they still arrive through the cursor and clear items via
// each feature's existing delete path. Safety valves: a full (no-since) sync runs at most once a day —
// so anything a cursor could conceivably miss (severe author clock skew, an event withheld before
// NIP-42 auth completed) self-heals within 24h — and a buffer too big to persist drops the cursor
// entirely (next session = full sync, today's behaviour).
const SINCE_SLOP = 3 * 86400;      // re-fetch this much history behind the cursor (author clock skew)
const FUTURE_SKEW = 900;           // never advance the cursor past now+15min (a bad clock would wedge it)
const FULL_SYNC_S = 86400;         // at most one full (no-since) catch-all sync per day
const HUB_SAVE_CAP = 3000000;      // don't persist a buffer bigger than ~3MB — drop the cursor instead
const DOCSHUB_KEY = 'trinityone.docshub.';   // + churchPubHex -> { since, fullAt, events }
const MEMHUB_KEY = 'trinityone.memhub.';     // + churchPubHex -> { since, fullAt, members }
const _dtag = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
const _slimEvt = (e) => ({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content });   // drop sig — the relay already verified it
const _hubCursor = (hub, e) => { const t = e.created_at || 0; if (t > hub.since && t <= Math.floor(Date.now() / 1000) + FUTURE_SKEW) { hub.since = t; hub.dirty = true; } };
const _hubSince = (hub) => { const nowS = Math.floor(Date.now() / 1000); hub.pendingFull = !hub.since || (nowS - (hub.fullAt || 0)) > FULL_SYNC_S; return hub.pendingFull ? 0 : Math.max(0, hub.since - SINCE_SLOP); };
const _hubEosed = (hub) => { hub.eosed = true; if (hub.pendingFull) { hub.pendingFull = false; hub.fullAt = Math.floor(Date.now() / 1000); hub.dirty = true; } };

// ── docs hub: the church's kind-30078 corpus (groups, plans, devotionals, serving, care, …) ──
const _docsHubs = new Map();   // churchPubHex -> hub (kept warm for the app's lifetime; sub closes at 0 refs)
function _docsHubSaveNow(hub) {
  if (hub.saveT) { clearTimeout(hub.saveT); hub.saveT = null; }
  if (!hub.dirty) return;
  hub.dirty = false;
  const key = DOCSHUB_KEY + hub.cp;
  try {
    const s = JSON.stringify({ since: hub.since, fullAt: hub.fullAt, events: [...hub.buf.values()] });
    if (s.length > HUB_SAVE_CAP) { localStorage.removeItem(key); return; }   // too big to trust a cursor over
    localStorage.setItem(key, s);
  } catch { try { localStorage.removeItem(key); } catch {} }
}
function _docsHubSaveSoon(hub) { if (!hub.saveT && hub.dirty) hub.saveT = setTimeout(() => { hub.saveT = null; _docsHubSaveNow(hub); }, 800); }
function _docsHub(cp) {
  let hub = _docsHubs.get(cp);
  if (hub) return hub;
  hub = { cp, handlers: new Set(), refs: 0, eosed: false, buf: new Map(), since: 0, fullAt: 0, pendingFull: false, dirty: false, saveT: null, closer: null };
  _docsHubs.set(cp, hub);
  try {
    const raw = JSON.parse(localStorage.getItem(DOCSHUB_KEY + cp) || 'null');
    if (raw && Array.isArray(raw.events)) {
      hub.since = raw.since || 0; hub.fullAt = raw.fullAt || 0;
      for (const e of raw.events) { if (e && e.pubkey && Array.isArray(e.tags)) hub.buf.set(e.pubkey + '|' + _dtag(e), e); }
    }
  } catch {}
  // absorb hub-level docs from the persisted corpus BEFORE any feature registers: the steward roster
  // (so _churchVoice trusts steward-authored docs immediately) and group-key envelopes (so encrypted
  // groups decrypt) — both are in-memory only, and the since-cursor means they won't re-arrive.
  for (const e of hub.buf.values()) _absorbRoster(cp, _dtag(e), e);   // absorb the full roster FIRST so the group-key author check can trust roster stewards regardless of buffer order
  for (const e of hub.buf.values()) { const d = _dtag(e); if (d.startsWith(GROUPKEY_D)) _ingestGroupKey(cp, e); else if (d === CAREKEY_D + cp) _ingestCareKey(cp, e); }
  return hub;
}
function _docsHubOpen(hub) {
  if (hub.closer) return;
  const cp = hub.cp;
  const since = _hubSince(hub);
  const filters = [{ kinds: [30078], authors: [cp], '#t': [NET] }, { kinds: [30078], '#church': [cp], '#t': [NET] }];
  if (since) for (const f of filters) f.since = since;
  const sub = pool.subscribeMany(relaysForChurch(cp), filters, {   // Phase 4: this church's relays (a8 dropped once it's self-sufficient)
    onevent(e) {
      const d = _dtag(e);
      const key = e.pubkey + '|' + d;
      const prev = hub.buf.get(key);
      // stale-drop: everything on this hub is ADDRESSABLE (newest created_at per author+d wins). A
      // lagging relay (e.g. one that missed a tombstone) can re-serve an older version inside the
      // since-slop window — never let it overwrite the newer state we already hold/replayed. Equal
      // timestamps still re-deliver (idempotent for every handler), like the old multi-relay behaviour.
      if (prev && (e.created_at || 0) < (prev.created_at || 0)) return;
      hub.buf.set(key, _slimEvt(e)); hub.dirty = true;
      _hubCursor(hub, e);
      _docsHubSaveSoon(hub);
      if (_absorbRoster(cp, d, e)) {
        // SECURITY-AUDIT-2026-07-06 L7 (availability): a steward-authored group-key envelope that arrived on the
        // LIVE path BEFORE this roster was rejected by _ingestGroupKey (author not yet trusted) and — unlike the
        // boot path — was never retried, so the encrypted group stayed blank until the next app start. Now that
        // the roster establishes trust, re-ingest the buffered envelopes (mirrors the boot-replay loop).
        for (const e2 of hub.buf.values()) { const d2 = _dtag(e2); if (d2.startsWith(GROUPKEY_D)) _ingestGroupKey(cp, e2); else if (d2 === CAREKEY_D + cp) _ingestCareKey(cp, e2); }
        for (const h of [...hub.handlers]) { try { h.onroster && h.onroster(); } catch (err) { console.error(err); } } return;
      }
      if (d.startsWith(GROUPKEY_D)) { _ingestGroupKey(cp, e); return; }
      if (d === CAREKEY_D + cp) { _ingestCareKey(cp, e); for (const h of [...hub.handlers]) { try { h.onroster && h.onroster(); } catch (err) {} } return; }   // re-emit: needs already rendered as _sealed can now open
      for (const h of [...hub.handlers]) { try { h.onevent(e, d); } catch (err) { console.error(err); } }
    },
    oneose() {
      _hubEosed(hub); _docsHubSaveSoon(hub);
      for (const h of [...hub.handlers]) { try { h.oneose && h.oneose(); } catch (err) { console.error(err); } }
    },
  });
  hub.closer = () => { try { sub.close(); } catch {} };
}
// register a feature on a church's shared docs bus. h = { onevent(e, d), onroster?(), oneose?() }.
// Replays the buffered corpus synchronously, then delivers live events. Sticky-EOSE stays in each
// handler: oneose fires on the relay's EOSE (and immediately on a late registration if the initial
// load already completed) — handlers keep their own "emit empty only after EOSE" guards.
function _onChurchDocs(cp, h) {
  const hub = _docsHub(cp);
  hub.refs++; hub.handlers.add(h);
  _docsHubOpen(hub);
  const replay = [...hub.buf.values()].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));   // oldest first, so the newest version of a doc wins
  for (const e of replay) {
    const d = _dtag(e);
    if (d === 'trinityone/stewards:' + cp || d.startsWith(GROUPKEY_D)) continue;   // hub-level docs, already absorbed
    try { h.onevent(e, d); } catch (err) { console.error(err); }
  }
  if (hub.eosed && h.oneose) { try { h.oneose(); } catch (err) { console.error(err); } }
  let off = false;
  return () => {
    if (off) return; off = true;
    hub.handlers.delete(h);
    // at 0 refs close the relay sub and flush; the hub object (buffer + cursor) stays warm in memory,
    // so the app-level reconnect (connTick tears everything down, then re-registers) re-opens with the
    // cursor instead of re-parsing disk or re-streaming the corpus.
    if (--hub.refs <= 0) { hub.refs = 0; const close = hub.closer; hub.closer = null; if (close) close(); _docsHubSaveNow(hub); }
  };
}

// ── members hub: kind-1 chatter + member:<church> joins — ONE sub feeds both the People directory
// and the member count (they used to fetch the whole chat corpus twice, in parallel). msgs counts can
// over-count across cursor overlaps/full re-syncs; they're only ever used as "has posted" + lastTs.
const _memHubs = new Map();   // churchPubHex -> hub
function _memHubSaveNow(hub) {
  if (hub.saveT) { clearTimeout(hub.saveT); hub.saveT = null; }
  if (!hub.dirty) return;
  hub.dirty = false;
  const key = MEMHUB_KEY + hub.cp;
  try {
    const s = JSON.stringify({ since: hub.since, fullAt: hub.fullAt, members: [...hub.byPub.values()].slice(0, 500) });
    if (s.length > HUB_SAVE_CAP) { localStorage.removeItem(key); return; }
    localStorage.setItem(key, s);
  } catch { try { localStorage.removeItem(key); } catch {} }
}
function _memHubSaveSoon(hub) { if (!hub.saveT && hub.dirty) hub.saveT = setTimeout(() => { hub.saveT = null; _memHubSaveNow(hub); }, 800); }
function _memHub(cp) {
  let hub = _memHubs.get(cp);
  if (hub) return hub;
  hub = { cp, byPub: new Map(), listeners: new Set(), refs: 0, eosed: false, since: 0, fullAt: 0, pendingFull: false, dirty: false, saveT: null, closer: null };
  _memHubs.set(cp, hub);
  let seeded = false;
  try {
    const raw = JSON.parse(localStorage.getItem(MEMHUB_KEY + cp) || 'null');
    if (raw && Array.isArray(raw.members)) { hub.since = raw.since || 0; hub.fullAt = raw.fullAt || 0; for (const m of raw.members) { if (m && m.pubkey) hub.byPub.set(m.pubkey, m); } seeded = true; }
  } catch {}
  if (!seeded) { for (const m of loadMembersCache(cp)) { if (m && m.pubkey) hub.byPub.set(m.pubkey, m); } }   // legacy roster cache: instant paint, no cursor (first sync is full)
  return hub;
}
function _memHubOpen(hub) {
  if (hub.closer) return;
  const cp = hub.cp;
  const MEMBER_D = 'trinityone/member:';
  const since = _hubSince(hub);
  const filters = [{ kinds: [1], '#p': [cp] }, { kinds: [30078], '#p': [cp] }];
  if (since) for (const f of filters) f.since = since;
  const sub = pool.subscribeMany(relaysForChurch(cp), filters, {   // Phase 4: this church's relays (a8 dropped once it's self-sufficient)
    onevent(e) {
      _hubCursor(hub, e);
      if (e.pubkey === cp) { _memHubSaveSoon(hub); return; }
      // seed name/nip05 from the persisted profile cache so known members render instantly
      const m = hub.byPub.get(e.pubkey) || { pubkey: e.pubkey, npub: npubEncode(e.pubkey), name: (profiles[e.pubkey] || {}).name || '', nip05: (profiles[e.pubkey] || {}).nip05 || '', picture: (profiles[e.pubkey] || {}).picture || '', hidden: !!(profiles[e.pubkey] || {}).hidden, joined: 0, lastTs: 0, msgs: 0 };
      if (e.kind === 30078) {
        const d = _dtag(e);
        if (d.indexOf(MEMBER_D) !== 0) { _memHubSaveSoon(hub); return; }
        const left = e.tags.some(t => t[0] === 'deleted') || !e.content;
        if (left) m.joined = 0; else { let j = e.created_at; try { j = JSON.parse(e.content).joined || e.created_at; } catch {} m.joined = j; }
      } else { m.msgs++; if (e.created_at > m.lastTs) m.lastTs = e.created_at; }
      hub.byPub.set(e.pubkey, m); hub.dirty = true;
      _memHubSaveSoon(hub);
      for (const l of [...hub.listeners]) { try { l.onchange && l.onchange(e.pubkey); } catch (err) { console.error(err); } }
    },
    oneose() {
      _hubEosed(hub); _memHubSaveSoon(hub);
      for (const l of [...hub.listeners]) { try { l.oneose && l.oneose(); } catch (err) { console.error(err); } }
    },
  });
  hub.closer = () => { try { sub.close(); } catch {} };
}
function _onChurchMembers(cp, l) {
  const hub = _memHub(cp);
  hub.refs++; hub.listeners.add(l);
  _memHubOpen(hub);
  if (hub.eosed && l.oneose) { try { l.oneose(); } catch (err) { console.error(err); } }   // late registrant: initial load already done
  let off = false;
  return () => {
    if (off) return; off = true;
    hub.listeners.delete(l);
    if (--hub.refs <= 0) { hub.refs = 0; const close = hub.closer; hub.closer = null; if (close) close(); _memHubSaveNow(hub); }
  };
}

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
  // SECURITY-AUDIT-2026-07-06 M3 (guardian fix): a member who set up a child account is a GUARDIAN and must be
  // able to read the church-signed guardians: doc — how they learn the steward CONFIRMED the parent↔child link.
  // That read is safeguarding-gated (needs NIP-42 auth), so a guardian legitimately needs to authenticate even
  // if they're in no invite-only group. Without this, M3's decline left the confirmation stuck as "pending".
  if (_loadChildren().length) _needAuth = true;
  // group-key envelopes can replay from the persisted docs buffer BEFORE the signing key exists —
  // re-unwrap them now that sk/pub are known, so invite-group decryption never needs a reload.
  for (const hub of _docsHubs.values()) { for (const e of hub.buf.values()) { const d = _dtag(e); if (d.startsWith(GROUPKEY_D)) _ingestGroupKey(hub.cp, e); else if (d === CAREKEY_D + hub.cp) _ingestCareKey(hub.cp, e); } }
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
  toPub,   // validate/normalise an npub-or-hex → 64-hex (or null on a bad bech32 checksum); used by the UI to reject a mistyped church code
  // true if every relay we've opened is still connected. The member app's 90s reconnect tick only re-subscribes when
  // this is FALSE — so a healthy socket never triggers the full re-REQ storm (perf #2). Mirrors the steward console.
  relaysHealthy() { try { const st = pool.listConnectionStatus(); for (const url of churchRelays()) { if (st.get(url) === false) return false; } return true; } catch (e) { return true; } },

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
  // Phase 5 Tier 2: this church's SELF-HOSTED media items (sermons) — church-signed docs referencing a
  // content-addressed blob by sha256 + host(s). Read via the church's OWN relays (Phase 4-aware).
  subscribeSermons(churchNpub, onSermons) {
    const cp = toPub(churchNpub); if (!cp) { onSermons([]); return () => {}; }
    const byId = new Map();
    const emit = () => onSermons([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relaysForChurch(cp), [{ kinds: [30078], authors: [cp], '#t': [NET] }], {
      onevent(e) {
        if (e.pubkey !== cp) return; const d = _dtag(e); if (!d.startsWith(SERMON_D)) return;
        try { const s = JSON.parse(e.content); if (s && s.sha256) { byId.set(d, { ...s, at: e.created_at }); emit(); } } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // the church's currently-featured/pinned sermon (or null) — drives a Today card + a notification.
  subscribePinnedSermon(churchNpub, onPinned) {
    const cp = toPub(churchNpub); if (!cp) { onPinned(null); return () => {}; }
    const sub = pool.subscribeMany(relaysForChurch(cp), [{ kinds: [30078], authors: [cp], '#d': [PINSERMON_D + cp] }], {
      onevent(e) {
        if (e.pubkey !== cp) return;
        if ((e.tags.find(t => t[0] === 'deleted') || [])[1]) { onPinned(null); return; }
        try { const p = JSON.parse(e.content); onPinned(p && p.sha256 ? { ...p, at: e.created_at } : null); } catch { onPinned(null); }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },
  // fetch a member-gated blob: sign a NIP-98 proof bound to the URL, download it, VERIFY the sha256 (content-
  // addressing = tamper-evident), optionally decrypt, and return an object URL the <audio>/<video> can play.
  async fetchBlob(url, opts) {
    opts = opts || {};
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    // native (CapacitorHttp) mangles a binary response body → ask for base64 text and decode it; web streams raw bytes
    const native = !!(typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const furl = native ? (url + (url.indexOf('?') >= 0 ? '&' : '?') + 'b64=1') : url;   // pathname (what the NIP-98 gate checks) is unchanged by the query
    const auth = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', furl], ['method', 'GET']], content: '' }, sk);
    const res = await fetch(furl, { headers: { Authorization: 'Nostr ' + btoa(JSON.stringify(auth)) }, signal: opts.signal });
    if (!res.ok) throw new Error('media ' + res.status);
    const onp = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    let bytes;
    if (native) {
      // CapacitorHttp returns the whole body at once — no incremental progress. Report total only (size hint).
      const b = atob(await res.text()); bytes = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
      if (onp) onp(bytes.length, bytes.length);
    } else if (onp && res.body && typeof res.body.getReader === 'function') {
      // web: stream the body so we can report download progress as bytes arrive
      const total = Number(res.headers.get('content-length') || 0) || Number(opts.total || 0);
      const reader = res.body.getReader(); const chunks = []; let loaded = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); loaded += value.length; onp(loaded, total); }
      bytes = new Uint8Array(loaded); let off = 0; for (const c of chunks) { bytes.set(c, off); off += c.length; }
    } else { bytes = new Uint8Array(await res.arrayBuffer()); }
    if (opts.expectSha) { const got = await _sha256hex(bytes); if (got !== opts.expectSha) throw new Error('media integrity failed'); }
    if (typeof opts.decrypt === 'function') bytes = await opts.decrypt(bytes);   // Tier 2 encryption hook (async-capable)
    return URL.createObjectURL(new Blob([bytes], { type: opts.mime || res.headers.get('content-type') || 'application/octet-stream' }));
  },
  // BACKUP/redundancy: fetch a sermon by trying each of its hosts in turn (primary → mirrors → cloud), so one
  // host being down/offline never loses the media. Content-addressed, so every host serves the identical bytes.
  async fetchSermon(s, opts) {
    const hosts = (s.hosts && s.hosts.length) ? s.hosts : (s.host ? [s.host] : []);
    if (!hosts.length || !s.sha256) throw new Error('sermon has no host');
    let lastErr;
    for (const h of hosts) {
      try { return await window.Fellowship.fetchBlob(String(h).replace(/\/+$/, '') + '/blob/' + s.sha256, { expectSha: s.sha256, mime: (opts && opts.mime) || s.mime || 'audio/mpeg', decrypt: opts && opts.decrypt, onProgress: opts && opts.onProgress, signal: opts && opts.signal, total: opts && opts.total }); }
      catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('all hosts failed');
  },
  // Tier 2 encryption: fetch this church's media key (wrapped to me), unwrap it, and return an AES-GCM decryptor
  // (strips the 12-byte IV). Returns null if there's no key for me — so the UI can say "encrypted, no key yet".
  async mediaDecryptor(churchNpub) {
    const cp = toPub(churchNpub); if (!cp) return null;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk) return null;
    let khex = null;
    try {
      const evs = await pool.querySync(relaysForChurch(cp), [{ kinds: [30078], authors: [cp], '#d': [MEDIAKEY_D + cp] }]);
      for (const e of (evs || [])) { if (e.pubkey !== cp) continue; try { const o = JSON.parse(e.content); const mine = o.keys && o.keys[pub]; if (mine) khex = nip44d(mine, nip44ck(sk, cp)); } catch {} }
    } catch {}
    if (!khex) return null;
    const key = await crypto.subtle.importKey('raw', _unhex(khex), 'AES-GCM', false, ['decrypt']);
    return async (bytes) => { const iv = bytes.slice(0, 12); const ct = bytes.slice(12); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)); };
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

  // Community-PIN forensic hygiene: wipe every localStorage cache that would reveal church membership
  // or leak cached community content (profiles, member rosters, group/category lists, doc + member
  // hubs, chat-seen markers, family links). Called on lock and at a locked boot. Bible/study/reading
  // caches are deliberately left untouched — the app must still work as an offline Bible reader.
  clearCommunityCache() {
    const PREFIXES = ['trinityone.profile', 'trinityone.members.', 'trinityone.membercount.',
      'trinityone.docshub.', 'trinityone.memhub.', 'trinityone.groups.', 'trinityone.cats.',
      'trinityone.chatSeen', 'trinityone.family'];
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && PREFIXES.some(p => k.startsWith(p))) kill.push(k); }
      kill.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      // drop in-memory caches too, so nothing repaints from RAM before the next fetch
      for (const k of Object.keys(profiles)) delete profiles[k];
      window.Fellowship.myProfile = null;
    } catch (e) { console.warn('[fellowship] clearCommunityCache failed', e); }
  },

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
    const cached = loadCountCache(cp);
    if (cached != null) cb(cached);   // show the last-known count instantly on load
    const hub = _memHub(cp);   // shared with subscribeChurchMembers — the kind-1 corpus is fetched ONCE
    const tally = () => { let n = 0; for (const v of hub.byPub.values()) if (v.msgs > 0 || v.joined) n++; saveCountCache(cp, n); cb(n); };
    const off = _onChurchMembers(cp, { onchange: tally, oneose: tally });
    if (hub.byPub.size) tally();   // derive instantly from the cached/buffered roster, refined live
    return off;
  },

  // the church's people, for a member-facing directory: distinct folks (not the church) who joined
  // (member:<church>) or posted (kind-1 p-tagged), with their kind-0 profile resolved. Same rule the
  // steward uses. Blocked members are withheld by the relay. The UI filters out the current user.
  subscribeChurchMembers(churchNpub, onMembers) {
    const cp = toPub(churchNpub); if (!cp) { onMembers([]); return () => {}; }
    const hub = _memHub(cp);   // shared kind-1 + member-doc corpus (also feeds the member count)
    // ONE kept-open kind-0 subscription resolves ALL members' names at once. A sub-per-member blew past
    // the relay's 64-subscription-per-connection cap (members + chat + a sub each = the later name fetches
    // got 'rate-limited' and dropped — the cause of blank names). Batched = a single sub regardless of size.
    let profSub = null; const profAuthors = new Set(); let profTimer = null;
    // a member who opted out (kind-0 `hidden`) is withheld from the directory the others see
    const emit = (done) => {
      const visible = [...hub.byPub.values()].filter(m => !m.hidden && (m.joined || m.msgs > 0)).sort((a, b) => (b.lastTs || b.joined || 0) - (a.lastTs || a.joined || 0));
      if (!hub.eosed && !done && !visible.length) return;   // sticky: hold last-known until EOSE
      saveMembersCache(cp, [...hub.byPub.values()]);   // keep the legacy cache warm for next launch
      onMembers(visible, !!done);
    };
    // (re)open the single profile sub for every still-unnamed member. churchRelays() — NOT
    // window.Fellowship.relays, which is empty on a native install. Kept open so a slow relay isn't cut off.
    const refreshProfiles = () => {
      profTimer = null;
      const authors = [...profAuthors].filter(pk => !(profiles[pk] && profiles[pk].name));
      if (!authors.length) return;
      try { profSub && profSub.close(); } catch {}   // replace the old one — never accumulate subscriptions
      profSub = pool.subscribeMany(churchRelays(), [{ kinds: [0], authors }], {
        onevent(e) { try { const meta = JSON.parse(e.content); profiles[e.pubkey] = { name: meta.name || meta.display_name || '', picture: meta.picture || '', about: meta.about || '', nip05: meta.nip05 || '', hidden: !!meta.hidden, av: meta.av || undefined }; saveProfiles(); const m = hub.byPub.get(e.pubkey); if (m) { m.name = profiles[e.pubkey].name; m.picture = profiles[e.pubkey].picture; m.nip05 = profiles[e.pubkey].nip05; m.hidden = !!meta.hidden; hub.dirty = true; _memHubSaveSoon(hub); } emit(); } catch {} },
        oneose() {},
      });
    };
    const ensureProfile = (pk) => {
      if (profAuthors.has(pk) || (profiles[pk] && profiles[pk].name)) return;
      profAuthors.add(pk);
      if (!profTimer) profTimer = setTimeout(refreshProfiles, 300);   // debounce the burst of arriving members
    };
    const off = _onChurchMembers(cp, {
      onchange(pk) { ensureProfile(pk); emit(); },
      oneose() { emit(true); },   // initial load complete
    });
    // the since-cursor means long-known members won't re-arrive as events — resolve names for the
    // cached/buffered roster too, not just live arrivals
    for (const pk of hub.byPub.keys()) ensureProfile(pk);
    if (hub.byPub.size) emit(false);   // paint the cached roster immediately, before the relay answers
    return () => { off(); if (profTimer) clearTimeout(profTimer); try { profSub && profSub.close(); } catch {} };
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
    // refetch when unknown, or cached-without-a-name (so a member who later picks a name updates). Queue the
    // needed pubkeys and flush them as ONE kind-0 sub after a short window — a backfill burst becomes one sub.
    const need = [...new Set(pubkeys)].filter(pk => pk && !pendingProfiles.has(pk) && (!(pk in profiles) || !(profiles[pk] && profiles[pk].name)));
    if (!need.length) return;
    need.forEach(pk => { pendingProfiles.add(pk); _profQueue.add(pk); });
    if (!_profTimer) _profTimer = setTimeout(_flushProfiles, 250);   // fixed window (don't reset) so a steady stream still flushes promptly
  },

  // publish a message to a group (kind 1, tagged with the network + group ids)
  async publishMessage(groupId, content, extraTags = []) {
    if (!sk) await window.Fellowship.ready;
    const churchTag = window.Fellowship.churchPub ? [['p', window.Fellowship.churchPub]] : [];
    let body = content, encTag = [];
    const gkey = _gkeys[_gkKey(window.Fellowship.churchPub, groupId)];   // encrypted group → seal under THIS church's key (H5)
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
    let ciphertext; try { ciphertext = _dmEncrypt(sk, peerPub, content); } catch (e) { console.warn('[fellowship] DM encrypt failed', e); return null; }
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
      let content = ''; try { content = await _dmDecrypt(sk, peerPub, e.content); } catch (err) { content = '🔒 (could not decrypt)'; }
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
      let preview = ''; try { preview = await _dmDecrypt(sk, peer, e.content); } catch (err) { preview = '🔒'; }
      byPeer.set(peer, { peer, lastTs: e.created_at, preview: (e.pubkey === pub ? 'You: ' : '') + preview });
      emit();
    };
    const sub = pool.subscribeMany(window.Fellowship.relays, [
      // PERF-AUDIT-2026-07-20 HIGH-4: these carried NO limit, so the relay shipped up to its 5000-event
      // default cap of DM envelopes on EVERY app open, just to render an inbox preview.
      //
      // The limit is a deliberate TRADE, not a free win, so it is set generously. The inbox is one row per
      // peer built by aggregating messages client-side — a filter can't express "newest per peer" — and
      // there is NO persisted inbox cache, so any conversation whose latest message falls outside the
      // window silently vanishes from the list, with no search to find it again. 1000 bounds the
      // pathological case (a 5x cut) while leaving realistic congregation-sized inboxes untouched; a
      // member would need >1000 DM events before a quiet conversation could drop off.
      // The proper fix is a persisted inbox (peer -> {lastTs, preview}) plus a `since` cursor, which would
      // make this near-zero on a returning launch. Not attempted here: without the cache first, a cursor
      // turns "slow" into "messages missing", which is the worse failure for a church.
      { kinds: [4], authors: [pub], limit: 1000 }, { kinds: [4], '#p': [pub], limit: 1000 },
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
        if (gid) { const dec = _decEvt(cp, e); if (!dec) return; try { onEvent(gid, dec); } catch (err) { console.error(err); } }
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
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1, 5], '#t': [groupId], limit: 200 }], {
      onevent(e) {
        // belt-and-suspenders: only deliver events actually tagged for this group
        if (!e.tags.some(t => t[0] === 't' && t[1] === groupId)) return;
        // and only this church's messages (when scoped) — avoids cross-church group-id collisions
        const cp = window.Fellowship.churchPub;
        if (cp && !e.tags.some(t => t[0] === 'p' && t[1] === cp)) return;
        if (e.kind === 5) { try { onEvent(e); } catch (err) { console.error(err); } return; }   // NIP-09 deletion — pass through raw (no content to decrypt)
        const dec = _decEvt(cp, e); if (!dec) return;   // encrypted + I'm not a member (no key) → don't show
        try { onEvent(dec); } catch (err) { console.error(err); }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },
  // NIP-09: retract one of MY OWN messages. The relay verifies self-authorship before deleting, and echoes
  // the kind-5 so every open client drops it live. Tagged to the group so it rides the group subscription.
  async deleteOwnMessage(groupId, msgId) {
    if (!sk) await window.Fellowship.ready;
    const churchTag = window.Fellowship.churchPub ? [['p', window.Fellowship.churchPub]] : [];
    const evt = finalizeEvent({ kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [['e', msgId], ['t', NET], ['t', groupId], ...churchTag], content: '' }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] deleteOwnMessage failed', e); return null; }
    return evt;
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
        // SECURITY-AUDIT-2026-07-06 M1: a pinned message is authoritative church UI, so only the church, a
        // current roster steward, or an empowered leader OF THIS GROUP may set it — NOT anyone who merely
        // p-tags the church (a hostile relay could otherwise serve a member-forged pin/phishing notice).
        if (cp && !_groupEventTrusted(cp, groupId, e.pubkey)) return;
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
        // SECURITY-AUDIT-2026-07-06 M1: hiding (censoring) a message is a moderation act — accept it only from
        // the church, a roster steward, or an empowered leader of the tagged group; not any p-tagging member.
        // hideMessage() tags the group id (['t',gid]); if absent (legacy) _groupEventTrusted falls back to church/steward.
        const gid = (e.tags.find(t => t[0] === 't' && t[1] !== NET) || [])[1];
        if (!_groupEventTrusted(cp, gid, e.pubkey)) return;
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
    let eosed = false;   // sticky: hold last-known until the relay's EOSE — don't blank on a transient/roster-lagged empty
    const emit = () => { const v = [...byId.values()].filter(g => _churchVoice(pubk, g)); if (!eosed && !v.length) return; saveDocCache('groups', pubk, v); onGroups(v.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0))); };
    if (byId.size) emit();   // paint cached groups before the shared hub replays/answers
    return _onChurchDocs(pubk, {
      onevent(e, d) {   // (the hub absorbs the steward roster + group-key envelopes centrally)
        if (!d.startsWith(GROUP_D)) return;
        const id = d.slice(GROUP_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try {
          const c = JSON.parse(e.content); byId.set(id, { id, ...c, ts: e.created_at, _by: e.pubkey }); _noteGroupLeaders(pubk, id, c, e.pubkey);
          // SECURITY-AUDIT-2026-07-06 M3: we belong to an invite-only group → we legitimately need NIP-42 auth to
          // read it, so enable it. (Membership is checked against MY pubkey so an invite group I'm NOT in — whose
          // public def I can still see — does not opt me into deanonymising auth.)
          if (!_needAuth && pub && c.visibility === 'invite' && Array.isArray(c.members) && c.members.some(p => toPub(p) === pub)) _needAuth = true;
          emit();
        } catch {}
      },
      onroster() { emit(); },   // the church-signed steward roster arrived/changed — re-filter
      oneose() { eosed = true; if (byId.size) emit(); },   // sticky: don't blank cards on a reconnect's EOSE-before-events; genuine removals come via the delete path
    });
  },

  // ── read the church's group categories (named containers, kind-30078) ──
  // onCats([{ id, name, order, ts }]) sorted by the steward's order. Members section the group list by these.
  subscribeChurchCategories(churchNpub, onCats) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onCats([]); return () => {}; }
    const byId = new Map();
    for (const c of loadDocCache('categories', pubk)) { if (c && c.id) byId.set(c.id, c); }   // paint cached instantly
    let eosed = false;   // sticky: hold last-known until EOSE
    const emit = () => { const v = [...byId.values()].filter(c => _churchVoice(pubk, c)); if (!eosed && !v.length) return; saveDocCache('categories', pubk, v); onCats(v.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0))); };
    if (byId.size) emit();   // paint cached categories before the shared hub replays/answers
    return _onChurchDocs(pubk, {
      onevent(e, d) {
        if (!d.startsWith(CATEGORY_D)) return;
        const id = d.slice(CATEGORY_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { const c = JSON.parse(e.content); byId.set(id, { id, ...c, ts: e.created_at, _by: e.pubkey }); emit(); } catch {}
      },
      onroster() { emit(); },   // re-filter once the steward roster lands (steward-authored categories)
      oneose() { eosed = true; if (byId.size) emit(); },   // sticky: don't blank cards on a reconnect's EOSE-before-events; genuine removals come via the delete path
    });
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
    return _onChurchDocs(pubk, {
      onevent(e, d) {
        if (e.pubkey !== pubk) return;   // safeguarding lists are OWNER-ONLY — only ever trust the church key (M2/safeguarding)
        if (d === 'trinityone/minors:' + pubk) { try { minors = (JSON.parse(e.content).pubkeys) || []; } catch { minors = []; } emit(); }
        else if (d === 'trinityone/approved:' + pubk) { try { approved = (JSON.parse(e.content).pubkeys) || []; } catch { approved = []; } emit(); }
        else if (d === 'trinityone/guardians:' + pubk) { try { guardians = (JSON.parse(e.content).links) || {}; } catch { guardians = {}; } emit(); }
        else if (d === 'trinityone/nophoto:' + pubk) { try { nophoto = (JSON.parse(e.content).pubkeys) || []; } catch { nophoto = []; } emit(); }
      },
      oneose() { emit(); },
    });
  },

  // safeguarding v2: receive a STEWARD-INITIATED guardian link. A parent the steward linked (who never set the
  // child up locally) gets a church-signed, NIP-44-encrypted notice p-tagged to them — decrypt it, record the
  // child locally so it appears in their family view, and flip _needAuth so they authenticate to read the
  // church's confirmed guardians: map. Mirrors the self-request flow, so both kinds of parent end up the same.
  subscribeGuardianNotices() {
    if (!pub) return () => {};
    const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], '#d': [GUARDNOTICE_D + pub] }], {
      onevent(e) {
        if (!sk) return;
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== GUARDNOTICE_D + pub) return;
        let dec; try { dec = JSON.parse(nip44d(e.content, nip44ck(sk, e.pubkey))); } catch { return; }
        if (!dec || !dec.child || dec.child === pub) return;
        const ex = _loadChildren().find(c => c && c.child === dec.child);
        if (ex && ex.viaSteward) return;   // already recorded as a steward-initiated link — no-op
        // viaSteward: the steward INITIATED this link, so it's already done — the notice IS the confirmation. The
        // parent's UI shows it as linked, not "waiting for the steward to confirm". Also UPDATES an older link that
        // predates this flag (so parents linked before the fix heal on the next notice, without a re-link).
        _saveChildLink({ child: dec.child, name: dec.name || (ex && ex.name) || '', churchPub: dec.church || e.pubkey, ts: (ex && ex.ts) || e.created_at || Math.floor(Date.now() / 1000), viaSteward: true });
        _needAuth = true;   // now a guardian → authenticate to read the church's confirmation
        try { window.dispatchEvent(new CustomEvent('trinity-guardian-added', { detail: { child: dec.child } })); } catch (x) {}
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
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
    _needAuth = true;   // M3: now a guardian — must NIP-42-auth to read the church's confirmation of this link (connTick reconnects with auth)
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
    return _onChurchDocs(pubk, {
      onevent(e, d) {
        if (e.pubkey !== pubk && !(_churchRoster.get(pubk) && _churchRoster.get(pubk).has(e.pubkey))) return;   // trust church key or a current roster steward (M2)
        if (d === 'trinityone/joinpolicy:' + pubk) { if (e.tags.some(t => t[0] === 'deleted') || !e.content) approval = false; else { try { approval = !!JSON.parse(e.content).approval; } catch { approval = false; } } emit(); }
        else if (d === 'trinityone/admitted:' + pubk) { try { admitted = (JSON.parse(e.content).pubkeys) || []; } catch { admitted = []; } emit(); }
      },
      onroster() { emit(); },
      oneose() { emit(); },
    });
  },

  // ── read the reading plans a church shares (kind-30078, d=plan:) ──
  subscribeChurchPlans(churchNpub, onPlans) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onPlans([]); return () => {}; }
    const PLAN_D = 'trinityone/plan:';
    const byId = new Map();
    for (const p of loadDocCache('plans', pubk)) { if (p && p.id) byId.set(p.id, p); }   // paint cached instantly
    let timer = null;   // re-emit when the next scheduled item is due (drip release)
    let eosed = false;   // sticky: hold last-known until EOSE
    const emit = () => {
      const all = [...byId.values()].filter(x => _churchVoice(pubk, x));   // roster-trust (M2)
      if (!eosed && !all.length) return;
      saveDocCache('plans', pubk, all);
      onPlans(scheduleVisible(all).sort((a, b) => (a.ts || 0) - (b.ts || 0)));
      timer = scheduleNextReveal(all, timer, emit);
    };
    if (byId.size) emit();   // paint cached plans before the shared hub replays/answers
    const stop = _onChurchDocs(pubk, {
      onevent(e, d) {
        if (!d.startsWith(PLAN_D)) return;
        const id = d.slice(PLAN_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at, _by: e.pubkey }); emit(); } catch {}
      },
      onroster() { emit(); },
      oneose() { eosed = true; if (byId.size) emit(); },   // sticky: don't blank cards on a reconnect's EOSE-before-events; genuine removals come via the delete path
    });
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
    let eosed = false;   // sticky: hold last-known until EOSE
    const emit = () => {
      const all = [...byId.values()].filter(x => _churchVoice(pubk, x));   // roster-trust (M2)
      if (!eosed && !all.length) return;
      saveDocCache('devos', pubk, all);
      onDevos(scheduleVisible(all).sort((a, b) => ord(a) - ord(b) || (b.ts || 0) - (a.ts || 0)));
      timer = scheduleNextReveal(all, timer, emit);
    };
    if (byId.size) emit();   // paint cached devotionals before the shared hub replays/answers
    const stop = _onChurchDocs(pubk, {
      onevent(e, d) {
        if (!d.startsWith(DEVO_D)) return;
        const id = d.slice(DEVO_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at, _by: e.pubkey }); emit(); } catch {}
      },
      onroster() { emit(); },
      oneose() { eosed = true; if (byId.size) emit(); },   // sticky: don't blank cards on a reconnect's EOSE-before-events; genuine removals come via the delete path
    });
    return () => { stop(); if (timer) clearTimeout(timer); };
  },

  // ── generic reader for the church's own addressable docs with a given d-prefix ──
  _subChurchAddr(churchNpub, prefix, map, onItems) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onItems([]); return () => {}; }
    const byId = new Map();
    let eosed = false;   // sticky: hold last-known until EOSE
    const emit = () => { const v = [...byId.values()].filter(x => _churchVoice(pubk, x)).sort((a, b) => (b.ts || 0) - (a.ts || 0)); if (!eosed && !v.length) return; onItems(v); };   // roster-trust (M2)
    return _onChurchDocs(pubk, {
      onevent(e, d) {
        if (!d.startsWith(prefix)) return;
        const id = d.slice(prefix.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...map(JSON.parse(e.content), id), ts: e.created_at, _by: e.pubkey }); emit(); } catch {}
      },
      onroster() { emit(); },
      oneose() { eosed = true; if (byId.size) emit(); },   // sticky: don't blank cards on a reconnect's EOSE-before-events; genuine removals come via the delete path
    });
  },
  // ── serving: services, per-service rotas, rosters, events the church publishes ──
  subscribeChurchServices(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/service:', (c, id) => ({ id, date: c.date, time: c.time, name: c.name }), cb); },
  subscribeChurchRunsheets(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/runsheet:', (c, id) => ({ service: id, items: Array.isArray(c.items) ? c.items : [] }), cb); },
  subscribeChurchRotas(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/rota:', (c, id) => ({ service: id, published: !!c.published, assign: c.assign || {} }), cb); },
  subscribeChurchRosters(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/roster:', (c, id) => ({ team: id, roles: c.roles || [], people: c.people || [] }), cb); },
  subscribeChurchEvents(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/event:', (c) => ({ date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, image: c.image || '', groupId: c.groupId || '', recur: c.recur || '', day: c.day }), cb); },

  // ── Meal trains / Care module (member side) ──
  // Read the church's Care config so the member app knows whether to show the Care card (and, for
  // 'team' visibility, that the church chose to keep needs to the care team). Church-signed → church-voice.
  subscribeMealsSettings(churchNpub, cb) {
    const pubk = toPub(churchNpub);
    const OFF = { enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' };
    if (!pubk) { cb({ ...OFF }); return () => {}; }
    let best = { ts: 0, doc: { ...OFF } };
    return _onChurchDocs(pubk, {
      onevent(e, d) {
        if (d !== MEALS_SETTINGS_D) return;   // the relay write-gates settings to the church/stewards (accept policy), so trust what it serves here — don't drop it on a not-yet-loaded roster, which hid the whole Care module from members
        if ((e.created_at || 0) <= best.ts) return;
        try { const c = JSON.parse(e.content || '{}'); best = { ts: e.created_at || 0, doc: { enabled: !!c.enabled, visibility: c.visibility === 'team' ? 'team' : 'all', openedBy: c.openedBy === 'member' ? 'member' : 'steward', adminGroupId: String(c.adminGroupId || '') } }; cb({ ...best.doc }); } catch {}
      },
      oneose() { if (best.ts) cb({ ...best.doc }); },   // sticky: only emit on EOSE if we actually received settings — don't flip the card off on a reconnect's empty
    });
  },
  // Open care needs. Authored by the church, a steward, or a care-team admin — all relay-enforced, so a
  // need present on the church's relay was written by an authorised pubkey. cb([{ id, displayLabel, type,
  // startDate, endDate, recipient, notes, ts }]).
  subscribeCareNeeds(churchNpub, cb) {
    const pubk = toPub(churchNpub);
    if (!pubk) { cb([]); return () => {}; }
    const byId = new Map();                 // careId -> need (carries _by = author, for the trust filter)
    const rosterPeople = new Map();         // teamId -> Set(pubkey), from church-signed rosters only
    let openedBy = 'steward', adminGroupId = '', eosed = false;
    // SECURITY-AUDIT-2026-07-06 M2: a care need renders under the church banner (recipient / notes / label),
    // so DON'T trust any doc merely ['church']-tagged — an ordinary member (or a hostile relay) could forge a
    // phishing "need". Mirror the relay's gate: accept only from the church/steward (_churchVoice), a care-team
    // admin (a person on the church-signed meals-admin roster), or ANY member when the church's meals-settings
    // opens needs to members (openedBy==='member'). meals-settings + the admin roster are themselves accepted
    // only when church-voiced, so a forged settings/roster can't widen the trust. Author-filter at emit time
    // (with re-emit as settings/roster arrive) so ordering never hides a legitimate need.
    const careTrusted = (by) => _churchVoice(pubk, { _by: by }) || openedBy === 'member' || (!!adminGroupId && !!rosterPeople.get(adminGroupId) && rosterPeople.get(adminGroupId).has(by));
    const emit = () => { const v = [...byId.values()].filter(n => careTrusted(n._by)).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || (a.ts || 0) - (b.ts || 0)); if (!eosed && !v.length) return; cb(v); };
    return _onChurchDocs(pubk, {
      onevent(e, d) {
        // capture the church-signed meals config + admin-team roster so care authors can be verified
        if (d === MEALS_SETTINGS_D) { if (_churchVoice(pubk, { _by: e.pubkey })) { try { const c = JSON.parse(e.content || '{}'); openedBy = c.openedBy === 'member' ? 'member' : 'steward'; adminGroupId = String(c.adminGroupId || ''); } catch {} emit(); } return; }
        if (d.startsWith(ROSTER_PFX)) { if (_churchVoice(pubk, { _by: e.pubkey })) { const team = d.slice(ROSTER_PFX.length); const set = new Set(); try { (JSON.parse(e.content || '{}').people || []).forEach(p => { const h = toPub(p && p.pub); if (h) set.add(h); }); } catch {} rosterPeople.set(team, set); emit(); } return; }
        if (!d.startsWith(CARE_D)) return;
        const id = d.slice(CARE_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        // SECURITY-AUDIT-2026-07-20 H3: needs published on/after 2026-07-20 seal the identifying half
        // (displayLabel/notes/recipient/dietary) under the church care key, wrapped to each member. Merge
        // the opened half over the clear one. A v1 cleartext doc still reads as-is so a church mid-pilot
        // doesn't lose its open needs; `_sealed` marks a doc we couldn't open (not yet keyed) so the UI can
        // say "details hidden" instead of rendering a nameless, broken-looking need. The clear half
        // (type/dates/meals) always renders, so an unkeyed member still sees help is needed and when.
        try {
          const c = JSON.parse(e.content);
          let s = null, sealed = false;
          if (c.enc) { s = _careOpen(pubk, c.enc); sealed = !s; }
          const f = s ? { ...c, ...s } : c;
          byId.set(id, { id, _by: e.pubkey, _sealed: sealed, displayLabel: f.displayLabel || '', type: f.type || 'meals', startDate: f.startDate || '', endDate: f.endDate || '', recipient: (f.recipient || '').toLowerCase(), notes: f.notes || '', dietary: Array.isArray(f.dietary) ? f.dietary : [], dates: Array.isArray(f.dates) ? f.dates : [], meals: Array.isArray(f.meals) ? f.meals : [], dayMeals: (f.dayMeals && typeof f.dayMeals === 'object') ? f.dayMeals : {}, ts: e.created_at }); emit();
        } catch {}
      },
      onroster() { emit(); },
      oneose() { eosed = true; if (byId.size) emit(); },   // sticky: never blank live needs on a reconnect's EOSE-before-events; genuine closes come via the delete path
    });
  },
  // member offers to help (careslot:) + recipient skip-days (careskip:) — both member-signed, church-tagged.
  // Keyed needId|iso|pubkey so each member's fill for a (need,date) is one entry. No church-voice filter:
  // these are members' own events, not church content.
  _subCareTagged(churchNpub, prefix, map, cb) {
    const pubk = toPub(churchNpub);
    if (!pubk) { cb([]); return () => {}; }
    const byKey = new Map();
    let eosed = false;   // sticky: same as needs — don't blank on a transient empty before EOSE
    const emit = () => { const v = [...byKey.values()]; if (!eosed && !v.length) return; cb(v); };
    // the shared hub's union filter is a superset of the old '#church'-only one; the d-prefix guard
    // below keeps the delivered set identical (careslot:/careskip: docs are always church-tagged)
    return _onChurchDocs(pubk, {
      onevent(e, d) {
        if (!d.startsWith(prefix)) return;
        const rest = d.slice(prefix.length).split(':');
        const needId = rest[0] || '', isoDate = rest[1] || '';
        if (!needId || !isoDate) return;
        const key = needId + '|' + isoDate + '|' + e.pubkey;
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byKey.delete(key); emit(); return; }
        try { byKey.set(key, { needId, isoDate, pubkey: e.pubkey, ts: e.created_at, ...map(JSON.parse(e.content || '{}')) }); emit(); } catch {}
      },
      oneose() { eosed = true; if (byKey.size) emit(); },   // sticky: don't blank slots/skips on a reconnect's empty EOSE; genuine clears come via the delete path
    });
  },
  subscribeCareSlots(churchNpub, cb) { return window.Fellowship._subCareTagged(churchNpub, CARESLOT_D, (o) => ({ note: String(o.note || '').trim() }), cb); },
  subscribeCareSkips(churchNpub, cb) { return window.Fellowship._subCareTagged(churchNpub, CARESKIP_D, (o) => ({ reason: String(o.reason || '').trim() }), cb); },
  // sign up to bring a meal / give a ride on one date of a need (idempotent per member+need+date).
  async fillCareSlot(careId, iso, note) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !careId || !iso) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CARESLOT_D + careId + ':' + iso], ['t', NET], ['church', cp]], content: JSON.stringify({ careId, isoDate: iso, note: String(note || '').trim() }) }, sk);
    try { await Promise.any(pool.publish(churchRelays(), evt)); } catch (e) { console.warn('[fellowship] care slot publish failed', e); }
    return evt;
  },
  async clearCareSlot(careId, iso) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !careId || !iso) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CARESLOT_D + careId + ':' + iso], ['t', NET], ['church', cp], ['deleted', '1']], content: '' }, sk);
    try { await Promise.any(pool.publish(churchRelays(), evt)); } catch {}
    return evt;
  },
  // SAFETY CHECK — subscribe to the church's active emergency roll-call. cb(check) with the newest OPEN check
  // {id, message, by, at}, or cb(null) when there's none / it was closed. The relay only serves it to
  // authenticated members (roster-gated), so an outsider never learns the church declared an emergency.
  subscribeSafetyCheck(cb) {
    const cp = window.Fellowship.churchPub; if (!cp) return () => {};
    let best = null;
    const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], '#d': [SAFETY_D + cp] }], {
      onevent(e) {
        try {
          const o = JSON.parse(e.content || '{}');
          if (best && e.created_at < best.createdAt) return;                 // keep the newest check only
          // SECURITY: the creator we encrypt our response to is the event's SIGNER (e.pubkey) — which the relay's
          // accept() already proved is the church / a steward / a care-admin — NEVER a self-declared content field
          // (a spoofed `by` would redirect every member's safe/in-danger status to an attacker's key).
          best = { id: o.id || e.id, message: String(o.message || ''), by: e.pubkey, at: o.at || e.created_at, open: o.open !== false, createdAt: e.created_at };
          cb(best.open ? { id: best.id, message: best.message, by: best.by, at: best.at } : null);
        } catch {}
      },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // mark yourself SAFE or NEEDING HELP for `check`. The response body is NIP-44-encrypted to the check's
  // CREATOR (check.by) — only they can read who's safe / in danger; not the relay, not other members.
  async markSafe(check, status, note) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !check || !check.by) return false;
    const body = JSON.stringify({ status: status === 'help' ? 'help' : 'safe', note: String(note || '').trim().slice(0, 240), at: Math.floor(Date.now() / 1000), checkId: check.id });
    let ct = ''; try { ct = _dmEncrypt(sk, check.by, body); } catch (e) { return false; }
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', SAFE_D + cp], ['t', NET], ['church', cp], ['p', check.by]], content: ct }, sk);
    // Return TRUE only on a real relay ACK. The member's "you're safe" confirmation must reflect DELIVERY —
    // a false "help is coming" when the send actually failed (offline / dead relay, the target environment) is
    // the worst failure this feature can have. Promise.any resolves iff ≥1 relay accepted the event.
    try { await Promise.any(pool.publish(churchRelays(), evt)); return true; } catch (e) { console.warn('[fellowship] markSafe publish failed', e); return false; }
  },
  // the RECIPIENT marks a day they don't need help (relay rejects this from anyone but the recipient).
  async markCareSkip(careId, iso, reason) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !careId || !iso) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CARESKIP_D + careId + ':' + iso], ['t', NET], ['church', cp]], content: JSON.stringify({ careId, isoDate: iso, reason: String(reason || '').trim() }) }, sk);
    try { await Promise.any(pool.publish(churchRelays(), evt)); } catch (e) { console.warn('[fellowship] care skip publish failed', e); }
    return evt;
  },
  async clearCareSkip(careId, iso) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !careId || !iso) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CARESKIP_D + careId + ':' + iso], ['t', NET], ['church', cp], ['deleted', '1']], content: '' }, sk);
    try { await Promise.any(pool.publish(churchRelays(), evt)); } catch {}
    return evt;
  },
  // ── "I'm here to help" availability — a member signals they're willing to help, so people who need
  // something are encouraged to ask. One replaceable doc per member per church (keyed by the member's own
  // pubkey), church-readable. Minors are excluded at the relay (being listed would invite contact).
  subscribeCareAvail(churchNpub, cb) {
    const pubk = toPub(churchNpub);
    if (!pubk) { cb([]); return () => {}; }
    const dtag = CAREAVAIL_D + pubk;
    const byPub = new Map();
    let eosed = false;   // sticky: don't blank on a transient empty before EOSE
    const emit = () => { const v = [...byPub.values()]; if (!eosed && !v.length) return; cb(v); };
    return _onChurchDocs(pubk, {
      onevent(e, d) {
        if (d !== dtag) return;
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byPub.delete(e.pubkey); emit(); return; }
        try {
          const o = JSON.parse(e.content || '{}');
          if (!o.available) { byPub.delete(e.pubkey); emit(); return; }
          byPub.set(e.pubkey, { pubkey: e.pubkey, tags: Array.isArray(o.tags) ? o.tags : [], note: String(o.note || '').trim(), ts: e.created_at });
          emit();
        } catch {}
      },
      oneose() { eosed = true; if (byPub.size) emit(); },   // sticky: don't blank the "ready to help" list on a reconnect's empty EOSE
    });
  },
  // publish (or refresh) my availability. tags = short list like ['meals','lifts','visits','prayer','childcare'].
  async setCareAvail(tags, note) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp) return null;
    const clean = Array.isArray(tags) ? tags.map(t => String(t || '').trim()).filter(Boolean).slice(0, 8) : [];
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CAREAVAIL_D + cp], ['t', NET], ['church', cp]], content: JSON.stringify({ available: true, tags: clean, note: String(note || '').trim().slice(0, 240) }) }, sk);
    try { await Promise.any(pool.publish(churchRelays(), evt)); } catch (e) { console.warn('[fellowship] care avail publish failed', e); }
    return evt;
  },
  async clearCareAvail() {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CAREAVAIL_D + cp], ['t', NET], ['church', cp], ['deleted', '1']], content: '' }, sk);
    try { await Promise.any(pool.publish(churchRelays(), evt)); } catch {}
    return evt;
  },
  // events posted by a GROUP'S leaders (members the church empowered) — authored by the member, scoped to
  // a group. Client-verified (M2): we only show events from the church, a current roster steward, or an
  // empowered leader of that group (per the trusted group def). onEvents([{ id, ...fields, byMember }]).
  subscribeGroupEvents(churchNpub, groupIds, onEvents) {
    const cp = toPub(churchNpub); const groups = (groupIds || []).filter(Boolean);
    if (!cp || !groups.length) { onEvents([]); return () => {}; }
    const byId = new Map();
    let eosed = false;   // sticky: hold last-known until EOSE
    const emit = () => { const v = [...byId.values()].filter(x => _groupEventTrusted(cp, x._gid, x._by)).sort((a, b) => (a.date || '').localeCompare(b.date || '')); if (!eosed && !v.length) return; onEvents(v); };
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
      oneose() { eosed = true; if (byId.size) emit(); },   // sticky: don't blank cards on a reconnect's EOSE-before-events; genuine removals come via the delete path
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
      oneose() { if (byId.size) emit(); },   // sticky: don't blank the "you're serving" card on a reconnect's empty EOSE
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
  // FEDERATION Phase 2 — read a church's signed NIP-65 relay-list (kind 10002) and ADOPT the relays it
  // declares, so a member follows relay moves/additions without ever needing a fresh invite link. Only the
  // church's OWN signed list is honoured (e.pubkey === cp), and a relay is adopted ONLY if its NIP-11
  // advertises trinityone.enforces (guardrail: never route gated content to a non-enforcing relay).
  // Additive + fail-closed: adoption only ever GROWS the read union with verified relays; a bad/unreachable
  // one is skipped. Content is signature-verified regardless of which relay served it, so this can't forge.
  subscribeChurchRelays(churchNpub) {
    const cp = toPub(churchNpub); if (!cp) return () => {};
    const sub = pool.subscribeMany(churchRelays(), [{ kinds: [10002], authors: [cp] }], {
      onevent(e) {
        if (e.pubkey !== cp) return;   // only the church's OWN signed relay-list is authoritative
        // R2 newest-wins. Reject FUTURE-dated lists so a clock-skewed/replayed far-future list can never pin the
        // high-water and lock out real updates (#6). Ignore STRICTLY-older lists (anti-downgrade/replay); an equal
        // timestamp re-applies the CURRENT list, which is what makes adoption survive a restart (the persisted
        // high-water gates NEW lists, not re-application of the current one — #3).
        const at = e.created_at || 0;
        if (at > Math.floor(Date.now() / 1000) + 600) return;
        const seen = _churchList.has(cp) ? _churchList.get(cp).at : _loadHW(cp);
        if (at < seen) return;
        const want = new Set((e.tags || []).filter(t => t[0] === 'r' && /^wss:\/\//i.test(t[1] || '') && !CANONICAL_RELAYS.includes(t[1])).map(t => t[1]));
        _churchList.set(cp, { at, want });
        _applyChurchList(cp);   // async, idempotent, race-safe, re-drivable
      },
      oneose() {},
    });
    // #3 recovery: a transient NIP-11 probe timeout (routine on 2G — the target network) must not strand a
    // self-hosted member. Re-drive the current list whenever the relay set churns (reconnect); _applyChurchList is a
    // cheap no-op once fully adopted (relay info is cached).
    const onchurn = () => { if (_churchList.has(cp)) _applyChurchList(cp); };
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('trinity-relays', onchurn);
    return () => { try { if (typeof window !== 'undefined') window.removeEventListener('trinity-relays', onchurn); } catch {} try { sub.close(); } catch {} };
  },
  // FEDERATION Phase 3b — discover relays that have OFFERED to host new churches. Probe a seed set (any
  // configured discovery relays + the canonical pool + relays we already use), read each one's NIP-11, and
  // return only those advertising trinityone.enforces && open && !full. Reachability + the enforces/open
  // flags are all verified here, so a caller only ever sees live, enforcing, accepting relays. Ranked:
  // region match first (nearest), then lightest load. A church with no discovery seed just gets [] (safe).
  async discoverRelayOffers(opts) {
    const region = opts && opts.region;
    const seed = [...new Set([...(window.Fellowship.discoverySeed || []), ...(window.Fellowship.CANONICAL_RELAYS || []), ...(window.Fellowship.relays || [])])];
    const probed = await Promise.all(seed.map(async (url) => {
      const t = await _relayInfo(url);
      if (t && t.enforces === true && t.open === true && !t.full) {
        return { url, operator: t.operator || '', region: t.region || '', churches: t.churches || 0, name: t.name || '' };
      }
      return null;
    }));
    const offers = probed.filter(Boolean);
    offers.sort((a, b) => {
      if (region) { const ra = a.region === region ? 0 : 1, rb = b.region === region ? 0 : 1; if (ra !== rb) return ra - rb; }
      return (a.churches || 0) - (b.churches || 0);   // prefer the lighter-loaded relay
    });
    return offers;
  },
  // Auto-pick N relays (default 2 = primary + backup) from ranked offers, preferring DIFFERENT operators so a
  // backup is real redundancy (one operator down ≠ church down). Backfills same-operator only if nothing else.
  pickRelays(offers, n) {
    n = n || 2; const picked = [], ops = new Set();
    for (const o of (offers || [])) { if (picked.length >= n) break; if (o.operator && ops.has(o.operator)) continue; picked.push(o); if (o.operator) ops.add(o.operator); }
    if (picked.length < n) for (const o of (offers || [])) { if (picked.length >= n) break; if (!picked.includes(o)) picked.push(o); }
    return picked;
  },
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
