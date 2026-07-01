// steward.src.js -- the church's Nostr identity + publishing for the Steward console.
// Bundled -> vendor/steward.js. The church-side analog of fellowship.js.
//
// PILOT signing model: the console holds the church key itself (BIP-39 seed in localStorage),
// like the member identity. The NIP-07 extension / NIP-46 phone-bunker signer abstraction is the
// productization (see reference/proposal-relay-app-steward-console.md, Decision 3) -- this engine
// is written so swapping in a signer later means replacing finalizeEvent, nothing above it.
//
// Publishes, all signed by the church key, to the relay served on the console's own origin (/relay):
//   - church profile   kind 0
//   - funds            kind 30078, d = trinityone/fund:<id>   (NIP-78 app data, addressable)
//   - announcements    kind 1,     t = trinityone, t = <group>
// and reads the church's own published events back (so the dashboard shows real data, and members'
// app can read the same church profile + funds).
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';
import { encrypt as nip04encrypt, decrypt as nip04decrypt } from 'nostr-tools/nip04';
import { encrypt as nip44e, decrypt as nip44d, getConversationKey as nip44ck } from 'nostr-tools/nip44';
import qrcode from 'qrcode-generator';

const NET = 'trinityone';
const KEY_LS = 'trinityone.steward.church-key';     // localStorage seed (pilot)
const FUND_D = 'trinityone/fund:';
const GROUP_D = 'trinityone/group:';
const CATEGORY_D = 'trinityone/category:';  // a named container that groups together (e.g. "Lifegroups"), d=category:<id>
const PLAN_D = 'trinityone/plan:';
const DEVO_D = 'trinityone/devotional:';
const ROSTER_D = 'trinityone/roster:';      // per-team roles + people (church)
const SERVICE_D = 'trinityone/service:';    // a dated gathering (church)
const RUNSHEET_D = 'trinityone/runsheet:';  // a service's order-of-service + songs (church) — d=runsheet:<serviceId>
const ROTA_D = 'trinityone/rota:';          // per-service assignments (church)
const EVENT_D = 'trinityone/event:';        // calendar event (church)
const ROOM_D = 'trinityone/room:';          // a bookable room/space (church)
const BOOKING_D = 'trinityone/booking:';    // a dated room booking (church)
const REQUEST_D = 'trinityone/request:';    // steward -> member "can you serve?" (church, p=member)
const REQREPLY_D = 'trinityone/reqreply:';  // member -> steward accept/decline/swap (member, p=church)
const NETWORK_D = 'trinityone/network:';    // church -> network membership ("we belong to X"), p=network
const BLOCKED_D = 'trinityone/blocked:';    // this church's blocklist (banned member pubkeys), d=blocked:<churchpub>
const MINORS_D = 'trinityone/minors:';      // safeguarding: this church's minors (children), d=minors:<churchpub>
const APPROVED_D = 'trinityone/approved:';  // safeguarding: adults cleared to contact youth, d=approved:<churchpub>
const NOPHOTO_D = 'trinityone/nophoto:';    // moderation: members whose uploaded photo is suppressed, d=nophoto:<churchpub>
const GUARDREQ_D = 'trinityone/guardreq:';  // safeguarding v2: a parent's guardian-link request (parent-authored), d=guardreq:<childpub>
const GUARDIANS_D = 'trinityone/guardians:'; // safeguarding v2: church-confirmed parent↔child map, d=guardians:<churchpub>
const JOINPOLICY_D = 'trinityone/joinpolicy:'; // join policy {approval:bool}, d=joinpolicy:<churchpub>
const ADMITTED_D = 'trinityone/admitted:';   // approved-members allowlist (when approval is on), d=admitted:<churchpub>
const STEWARDS_D = 'trinityone/stewards:';   // delegated, revocable steward roster (owner-signed), d=stewards:<churchpub>; see STEWARD-ROSTER-DESIGN.md
const STEWARDREQ_D = 'trinityone/stewardreq:'; // a would-be steward's request to a church (requester-signed), d=stewardreq:<churchpub>; the owner approves it into the roster
const PIN_D = 'trinityone/pin:';            // a group's pinned message, d=pin:<groupId> (one per group; empty/deleted = unpinned)
const HIDE_D = 'trinityone/hidden:';        // a removed/hidden message, d=hidden:<msgId> (one per message; deleted = restored)
const GROUPKEY_D = 'trinityone/groupkey:'; // church-signed key envelope for an encrypted group
const _skeys = {};   // groupId -> Uint8Array(32) group key (church-side cache)
const _srev = {};    // groupId -> envelope revision (bumped on rotate)
const _senvTs = {};  // groupId -> latest envelope created_at (ignore stale/out-of-order)
const _hex = (u) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
const _unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
// the church unwraps its OWN entry from a key envelope (it wraps the key to itself too), and caches it
function stewIngestKey(e) {
  const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(GROUPKEY_D)) return;
  const gid = d.slice(GROUPKEY_D.length);
  if ((_senvTs[gid] || 0) > (e.created_at || 0)) return;   // ignore an older envelope arriving late
  _senvTs[gid] = e.created_at || 0;
  try { const env = JSON.parse(e.content || '{}'); _srev[gid] = env.rev || 1; const mine = env.keys && churchPub && env.keys[churchPub]; if (mine && churchSk) _skeys[gid] = _unhex(nip44d(mine, nip44ck(churchSk, e.pubkey))); } catch {}
}
const now = () => Math.floor(Date.now() / 1000);
function toPubHex(npubOrHex) { try { if (/^[0-9a-f]{64}$/i.test(npubOrHex)) return npubOrHex.toLowerCase(); const d = nip19decode(npubOrHex); return d && d.type === 'npub' ? d.data : null; } catch { return null; } }

const RELAYS_LS = 'trinityone.steward.extra-relays';   // extra public relays the church also publishes to
const NETKEYS_LS = 'trinityone.steward.network-keys';  // networks OWNED on this console: [{ pub, mnemonic, name }]
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
// networks whose signing key lives on this device (so this console can publish AS the network)
function netKeys() { try { const a = JSON.parse(lsGet(NETKEYS_LS) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
function saveNetKey(rec) {
  const a = netKeys().filter(x => x.pub !== rec.pub); a.push(rec); lsSet(NETKEYS_LS, JSON.stringify(a));
}
// The TrinityOne shared-relay pool — relays we operate that every church can use. On a static host
// the steward publishes across all of them (they don't sync to each other). Add a URL here per host.
const CANONICAL_RELAYS = ['wss://app.trinityone.church/relay', 'wss://trinityone-master-01.tailbeaac0.ts.net/relay'];   // primary: own domain (Cloudflare); fallback: same box via ts.net. dev-box relay dropped 2026-06-25; NAS removed 2026-06-17
const CANONICAL_RELAY = CANONICAL_RELAYS[0];   // back-compat: the primary shared relay
function ownRelay() {
  // native (Capacitor APK): location.host is just "localhost", which has no relay — use the shared pool
  // so a phone-installed steward (or one restored via handoff) reaches the church's data.
  if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return CANONICAL_RELAY;
  const l = (typeof location !== 'undefined') ? location : null;
  if (!l || !l.host) return CANONICAL_RELAY;
  // a static CDN host (GitHub Pages etc.) has no relay on its origin → publish to the shared pool
  if (/\.(github\.io|pages\.dev|netlify\.app)$/i.test(l.host)) return CANONICAL_RELAY;
  return ((l.protocol === 'https:') ? 'wss://' : 'ws://') + l.host + '/relay';
}
function extraRelays() {
  try { const a = JSON.parse(lsGet(RELAYS_LS) || '[]'); return Array.isArray(a) ? a.filter(Boolean) : []; } catch { return []; }
}
// normalise a user-typed relay address to a ws/wss URL
function normRelay(input) {
  let v = String(input || '').trim();
  if (!v) return '';
  if (!/^wss?:\/\//i.test(v)) v = 'wss://' + v.replace(/^\/+/, '');
  return v.replace(/\/+$/, '');
}
// normalise a steward-typed NIP-05 / web address into a clean handle: strip protocol/www/path. A
// "local@domain" is kept; a bare "yourchurch.org" becomes "<name-slug>@yourchurch.org" so it stays
// resolvable (the relay's NIP-05 serves the local part's slug, = the name slug). Junk/URLs → ''.
function cleanNip05(raw, name) {
  let s = String(raw || '').trim().toLowerCase().replace(/\s+/g, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!s) return '';
  if (s.includes('@')) {
    const [l, d] = s.split('@');
    const local = l.replace(/[^a-z0-9._-]/g, ''), domain = d.replace(/^www\./, '');
    return (local && /\./.test(domain)) ? local + '@' + domain : '';
  }
  if (!/\./.test(s)) return '';   // not a domain
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 30);
  return slug ? slug + '@' + s : '';
}
function relays() {
  const own = ownRelay();
  const out = [own];
  // on a static CDN host the console has no relay of its own → fan out across the whole shared pool
  if (own === CANONICAL_RELAY) { for (const r of CANONICAL_RELAYS) { if (r && !out.includes(r)) out.push(r); } }
  for (const r of extraRelays()) { if (r && r !== own && !out.includes(r)) out.push(r); }
  return out;
}

const pool = new SimplePool();
// decode a base64url VAPID key to the Uint8Array the Push API wants
function _b64ToU8(base64) {
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const s = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let sk = null, pub = null;                 // the ACTIVE signing identity (church, or an owned network when toggled)
// NIP-42: prove the church/network key when a relay challenges, so the console reads invite-only groups.
pool.automaticallyAuth = () => async (authEvent) => { if (!sk) throw new Error('no key'); return finalizeEvent(authEvent, sk); };
let churchSk = null, churchPub = null;     // the real church key — preserved so we can always switch back
let lastProfile = {};   // cached church profile so partial publishProfile edits don't wipe other fields
// DELEGATED steward mode (phase 2b): when this console acts as a steward of a church it does NOT own,
// `actingChurch` is that church's hex pubkey. We sign with OUR OWN key (churchSk) but read+publish in
// the church's context (pub = actingChurch) and stamp church-content events with ['church',<cp>] so the
// relay grants the delegated authority. Empty = acting as our own identity (owner/normal). See STEWARD-ROSTER-DESIGN.md.
let actingChurch = '';
const stewardedChurches = new Map();   // cp(hex) -> { name } — churches whose roster lists OUR key
// finalize a CHURCH-CONTENT event, stamping ['church',<cp>] when delegated so the relay accepts our key.
// Signs with the active key `sk` (our own key in delegated mode; the church/network key otherwise).
function feChurch(tmpl, signer) {
  if (actingChurch && !(tmpl.tags || []).some(t => t[0] === 'church')) {
    tmpl = { ...tmpl, tags: [...(tmpl.tags || []), ['church', actingChurch]] };
  }
  return finalizeEvent(tmpl, signer || sk);
}
// a friendly, deterministic name derived from a pubkey: the SAME key always yields the SAME name, so it's a
// human cross-check when sharing a steward code (the npub stays the real identifier). e.g. "Quiet Olive 47".
const _PET_ADJ = ['Quiet', 'Bright', 'Gentle', 'Steady', 'Faithful', 'Humble', 'Joyful', 'Kind', 'Patient', 'Bold', 'Gracious', 'Calm', 'Glad', 'Warm', 'True', 'Sure'];
const _PET_NOUN = ['Olive', 'Cedar', 'Dove', 'Anchor', 'Lamp', 'Vine', 'Shepherd', 'Harbor', 'Beacon', 'Reed', 'Sparrow', 'Willow', 'Spring', 'Haven', 'Ember', 'Brook'];
function _petHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function stewardNameFor(hexPub) {
  if (!hexPub) return '';
  const h = _petHash(hexPub);
  return _PET_ADJ[h % _PET_ADJ.length] + ' ' + _PET_NOUN[(h >>> 4) % _PET_NOUN.length] + ' ' + (10 + (h >>> 9) % 90);
}

let currentMnemonic = null;   // kept in memory while unlocked (for re-encrypt / remove-lock)
function setKey(mnemonic) {
  sk = privateKeyFromSeedWords(mnemonic);
  pub = getPublicKey(sk);
  churchSk = sk; churchPub = pub;           // the device's church key
  currentMnemonic = mnemonic;
  window.Steward.pubkey = pub;
  window.Steward.npub = npubEncode(pub);
  window.Steward.churchPub = pub;
  window.Steward.activePub = pub;
  window.Steward.hasKey = true;
}

// ── console PIN lock: encrypt the church seed at rest with a PIN/passphrase (AES-GCM, PBKDF2). A
// locked console holds NO usable key until unlocked, so a stolen device / copied localStorage is inert.
//
// SECURITY-AUDIT-2026-06-25 Critical-2: PIN is now MANDATORY, not optional. The pilot model that
// allowed a plaintext seed in localStorage was a documented tradeoff, but a stolen church key has
// vastly bigger blast radius than a member key (the attacker impersonates the church to every
// member). Concretely:
//   • createKey() / createKeyQuiet() no longer persist plaintext — the seed lives in memory only
//     until setPin() persists the encrypted form atomically.
//   • init() detecting a legacy plaintext seed loads it into memory, removes nothing yet, and sets
//     needsPin=true so the UI gates the console behind a forced PIN-setup modal. The setPin call
//     then replaces the plaintext with the encrypted form and removes KEY_LS.
//   • removeLock() no longer writes plaintext back — it removes the encrypted form and sets
//     needsPin=true, so the user is immediately forced to set a new PIN before doing anything.
//   • UI side: steward-root.jsx renders <StewardForcedPin /> whenever window.Steward.needsPin
//     is true, blocking every other surface.
// Native (Capacitor) SecureStorage migration is queued as a follow-up commit — async-init refactor.
// ──
const ENC_LS = 'trinityone.steward.church-key.enc';
let needsPin = false;
function _setNeedsPin(v) {
  v = !!v;
  if (needsPin === v) return;
  needsPin = v;
  if (typeof window !== 'undefined' && window.Steward) window.Steward.needsPin = v;
  try { window.dispatchEvent(new CustomEvent('steward-needs-pin', { detail: { needs: v } })); } catch (e) {}
}
const b64e = (u8) => btoa(String.fromCharCode(...u8));
const b64d = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveAes(pin, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function publish(evt) {
  try { await Promise.any(pool.publish(relays(), evt)); }
  catch (e) {
    console.warn('[steward] publish failed', e);
    // every relay rejected — surface it so the steward isn't left wondering why nothing saved
    let reason = '';
    try { const errs = (e && e.errors) || []; reason = (errs[0] && (errs[0].message || String(errs[0]))) || ''; } catch (x) {}
    try { window.dispatchEvent(new CustomEvent('steward-publish-error', { detail: { reason, evt } })); } catch (x) {}
  }
  return evt;
}
// resolve the signing key for a chosen publishing identity. asPub === church pub (or empty) -> church key;
// asPub === an owned network's pub -> that network's key (so the doc is authored by the network).
function skFor(asPub) {
  if (!asPub || asPub === pub) return sk;
  const rec = netKeys().find(x => x.pub === asPub);
  if (rec) { try { return privateKeyFromSeedWords(rec.mnemonic); } catch { return null; } }
  return null;
}

// ── Generic primitives exposed for optional modules (Finance, Manna, Meals, future plugins) ──
// External bundles (vendor/steward-meals.js, etc.) don't share this IIFE's closure, so they can't
// reach `pool`, `relays()`, `feChurch()`, or `publish()` directly. Expose them as thin helpers so
// the abstraction stays at "I want to publish a church-signed event" / "subscribe my filters" —
// modules never need to poke at the lower-level pool.
function _publishSigned(tmpl) {
  if (!sk) return Promise.resolve(null);
  return publish(feChurch(tmpl));
}
function _subscribeMany(filters, handlers) {
  return pool.subscribeMany(relays(), filters, handlers);
}

window.Steward = {
  pubkey: null, npub: null, hasKey: false,

  // ---- primitives for optional modules (Meals, Finance, Manna plugins) ----
  // Modules call publishSigned/subscribeMany; they never see `pool`, `relays()`, or `feChurch`.
  publishSigned: _publishSigned,
  subscribeMany: _subscribeMany,
  relayList() { return relays(); },

  // ---- key (pilot: self-custodial in localStorage; later: a signer) ----
  locked: false,                                  // true when an encrypted key exists and isn't unlocked yet
  // SECURITY-AUDIT-2026-06-25 Critical-2: true when the seed exists in memory but is NOT persisted
  // as an encrypted blob — i.e. either freshly created (no setPin yet) or a legacy plaintext seed
  // was found in localStorage that needs migrating. The UI gates the console behind a forced
  // PIN-setup modal whenever this is true.
  needsPin: false,
  init(mnemonicOverride) {
    if (mnemonicOverride) {
      // test hook — keep behaviour but force PIN setup so an injected key never persists plaintext past first boot
      lsSet(KEY_LS, mnemonicOverride); setKey(mnemonicOverride);
      _setNeedsPin(true); window.Steward.locked = false; return true;
    }
    const m = lsGet(KEY_LS);
    if (m) {
      // SECURITY-AUDIT-2026-06-25 Critical-2: legacy plaintext seed on disk. Load into memory, mark
      // as needing migration. The forced PIN modal will appear on the next render; setPin() will
      // atomically replace KEY_LS with ENC_LS.
      setKey(m); _setNeedsPin(true); window.Steward.locked = false; return true;
    }
    if (lsGet(ENC_LS)) { window.Steward.locked = true; return false; }   // PIN-locked — needs unlock(), no key in memory
    return false;
  },
  // ---- PIN lock API ----
  hasPinLock() { return !!lsGet(ENC_LS); },
  async setPin(pin) {                              // encrypt the current seed at rest; remove the plaintext copy
    const seed = currentMnemonic || lsGet(KEY_LS);
    if (!seed || !pin) return false;
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveAes(pin, salt), new TextEncoder().encode(seed)));
    lsSet(ENC_LS, JSON.stringify({ v: 1, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) }));
    try { localStorage.removeItem(KEY_LS); } catch {}
    _setNeedsPin(false);   // SECURITY-AUDIT-2026-06-25 Critical-2: encrypted form now persisted; clear the force flag
    return true;
  },
  async unlock(pin) {                              // decrypt into memory (does NOT re-write the plaintext)
    const raw = lsGet(ENC_LS); if (!raw) return true;
    try {
      const o = JSON.parse(raw);
      const seed = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(o.iv) }, await deriveAes(pin, b64d(o.salt)), b64d(o.ct)));
      setKey(seed); window.Steward.locked = false;
      window.dispatchEvent(new CustomEvent('steward-key', { detail: { npub: window.Steward.npub } }));
      return true;
    } catch { return false; }
  },
  lock() {                                         // forget the in-memory key (idle / manual); seed stays encrypted
    sk = null; pub = null; currentMnemonic = null;
    window.Steward.pubkey = null; window.Steward.npub = null; window.Steward.hasKey = false;
    window.Steward.locked = !!lsGet(ENC_LS);
    window.dispatchEvent(new CustomEvent('steward-key', { detail: { npub: null } }));
  },
  // verify a PIN against the encrypted seed at rest, with NO side effects (gates removing the lock).
  async verifyPin(pin) {
    const raw = lsGet(ENC_LS); if (!raw) return false;
    try {
      const o = JSON.parse(raw);
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(o.iv) }, await deriveAes(pin, b64d(o.salt)), b64d(o.ct));
      return true;
    } catch { return false; }
  },
  // drop the PIN. SECURITY-AUDIT-2026-06-25 Critical-2: NO LONGER writes the plaintext seed back to
  // localStorage — instead removes the encrypted form and sets needsPin=true. The seed stays in
  // memory (currentMnemonic); the UI immediately renders the forced PIN modal, requiring the
  // steward to set a new PIN before any further action. Net effect: there is NO post-removeLock
  // state where a plaintext seed exists on disk, even transiently.
  async removeLock(pin) {
    if (!currentMnemonic) return false;
    if (lsGet(ENC_LS) && !(await window.Steward.verifyPin(pin))) return false;   // wrong/empty PIN → refuse
    try { localStorage.removeItem(ENC_LS); } catch {}
    window.Steward.locked = false;
    _setNeedsPin(true);   // force an immediate re-PIN
    return true;
  },
  createKey() {
    // SECURITY-AUDIT-2026-06-25 Critical-2: NO plaintext write to localStorage. The seed lives in
    // memory only until setPin() persists the encrypted form. needsPin forces the UI to gate the
    // console behind a forced PIN-setup modal — there is NO state in which a freshly-created
    // church key sits as plaintext on disk.
    const m = generateSeedWords(); setKey(m); _setNeedsPin(true);
    window.dispatchEvent(new CustomEvent('steward-key', { detail: { npub: window.Steward.npub } }));
    return { npub: window.Steward.npub };
  },
  // like createKey but WITHOUT firing steward-key — so the welcome screen can stay up to show the new
  // identity's "become a steward" code before the caller continues into the console (which fires it then).
  createKeyQuiet() {
    // Same posture as createKey: memory only, no plaintext on disk.
    const m = generateSeedWords(); setKey(m); _setNeedsPin(true);
    return { npub: window.Steward.npub, code: window.Steward.becomeStewardPayload() };
  },
  enterConsole() { window.dispatchEvent(new CustomEvent('steward-key', { detail: { npub: window.Steward.npub } })); },
  // load the persisted church key if there is one; only generate a NEW key when none exists.
  // (Bug fix: previously this always created+OVERWROTE the stored key on a normal load, so the church
  // identity changed on every reload — members vanished because they're tagged to the old pubkey.)
  ensureKey() {
    if (window.Steward.hasKey) return { npub: window.Steward.npub };
    if (window.Steward.init()) return { npub: window.Steward.npub };   // init() loads the saved seed
    return window.Steward.createKey();
  },
  exportMnemonic() { return currentMnemonic || lsGet(KEY_LS); },
  // restore/import a church key from its 12-word recovery phrase (replaces the current key on this device)
  restoreKey(mnemonic) {
    const m = (mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (m.split(' ').length < 12) throw new Error('Enter the full 12-word recovery phrase.');
    // SECURITY-AUDIT-2026-06-25 Critical-2: restore does NOT persist plaintext. The seed lives in
    // memory only; needsPin forces the forced PIN modal before the steward can act. Any existing
    // PIN-encrypted blob on this device is wiped (it belonged to a different key).
    setKey(m); try { localStorage.removeItem(KEY_LS); localStorage.removeItem(ENC_LS); } catch (e) {}
    _setNeedsPin(true);
    // fire steward-key so the first-run welcome advances to the console (createKey does this too)
    window.dispatchEvent(new CustomEvent('steward-key', { detail: { npub: window.Steward.npub } }));
    return { npub: window.Steward.npub };
  },
  // ---- QR handoff: the old steward shows a code; the new steward scans it to adopt the church ----
  // The payload carries the church's 12-word seed (same trust model as revealing the phrase — anyone
  // who reads it controls the church), tagged so the scanner knows it's a church handoff.
  handoffPayload() { const m = currentMnemonic || lsGet(KEY_LS); return m ? ('trinityone-church:' + m) : ''; },
  // adopt a church from a scanned QR / pasted code / link → restore its key on THIS device.
  adoptChurch(payload) {
    let m = (payload || '').trim();
    const q = m.match(/[?&#](?:adopt|church)=([^&#\s]+)/);   // also accept a URL form
    if (q) { try { m = decodeURIComponent(q[1]); } catch {} }
    m = m.replace(/^trinityone-church:/i, '').trim();
    return window.Steward.restoreKey(m);                     // validates + persists; throws on a bad phrase
  },
  // ---- "Become a steward" handshake: a would-be steward shows this code to a church owner, who scans/pastes
  // it under Delegated stewards to add them. Unlike the church handoff this carries ONLY the public npub of
  // the would-be steward's OWN identity — no secret — so it's safe to share over any channel. ----
  becomeStewardPayload() { return churchPub ? ('trinityone-steward:' + npubEncode(churchPub)) : ''; },
  // friendly, deterministic name for a key (npub or hex) — a human cross-check when sharing a steward code.
  stewardName(npubOrHex) { return stewardNameFor(toPubHex(npubOrHex) || (typeof npubOrHex === 'string' && /^[0-9a-f]{64}$/i.test(npubOrHex) ? npubOrHex.toLowerCase() : '')); },
  // owner side: parse a steward code / npub / link → hex pubkey to put on the roster (null if not valid).
  stewardCodeToPub(payload) {
    let s = (payload || '').trim();
    const q = s.match(/[?&#]steward=([^&#\s]+)/);   // also accept a URL form
    if (q) { try { s = decodeURIComponent(q[1]); } catch {} }
    s = s.replace(/^trinityone-steward:/i, '').trim();
    return toPubHex(s);
  },
  // ---- invite-to-steward handshake: the OWNER shows an invite QR (their church id, public); a would-be
  // steward SCANS it and sends a request; the owner sees it pending and approves it into the roster. ----
  stewardInvitePayload() { return churchPub ? ('trinityone-stewardinvite:' + npubEncode(churchPub)) : ''; },
  parseStewardInvite(payload) {
    let s = (payload || '').trim();
    const q = s.match(/[?&#](?:stewardinvite|church)=([^&#\s]+)/);
    if (q) { try { s = decodeURIComponent(q[1]); } catch {} }
    s = s.replace(/^trinityone-stewardinvite:/i, '').trim();
    return toPubHex(s);
  },
  // requester side: scan/paste a church's invite → publish a steward request (signed by OUR key, naming the church)
  requestSteward(payload) {
    const cp = window.Steward.parseStewardInvite(payload);
    if (!cp) return Promise.resolve({ ok: false, error: 'That doesn’t look like a church invite.' });
    if (cp === churchPub) return Promise.resolve({ ok: false, error: 'That’s your own church.' });
    const content = JSON.stringify({ name: (lastProfile && lastProfile.name) || '' });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', STEWARDREQ_D + cp], ['t', NET], ['p', cp]], content }, sk))
      .then(() => ({ ok: true, church: cp, npub: npubEncode(cp) }));
  },
  // owner side: pending steward requests for THIS church → [{ pubkey, npub, name }] (excludes current stewards)
  subscribeStewardRequests(onReqs) {
    const byPub = new Map();
    let roster = new Set();
    const emit = () => onReqs([...byPub.values()].filter(r => !roster.has(r.pubkey)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d === STEWARDS_D + pub) { try { roster = new Set((JSON.parse(e.content).pubkeys) || []); } catch {} emit(); return; }
        if (d !== STEWARDREQ_D + pub || e.pubkey === pub) return;
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byPub.delete(e.pubkey); emit(); return; }
        let name = ''; try { name = (JSON.parse(e.content).name) || ''; } catch {}
        byPub.set(e.pubkey, { pubkey: e.pubkey, npub: npubEncode(e.pubkey), name, ts: e.created_at });
        emit();
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // remove the church key from THIS device (completing a handoff, or stepping away). The church lives on
  // wherever its phrase is held — this only forgets it locally; it does not delete/rotate the key.
  removeKey() {
    try { localStorage.removeItem(KEY_LS); localStorage.removeItem(ENC_LS); } catch {}
    sk = null; pub = null; currentMnemonic = null;
    window.Steward.pubkey = null; window.Steward.npub = null; window.Steward.hasKey = false; window.Steward.locked = false;
    window.dispatchEvent(new CustomEvent('steward-key', { detail: { npub: null } }));
    return true;
  },

  // ---- web push: notify the steward's phone when someone joins (PWA only; Capacitor → local notifs) ----
  // The subscription is filed under the CHURCH key, so the gateway pushes church-targeted alerts (joins)
  // to whichever devices proved that key. Returns a status string the UI can reflect.
  async registerPush() {
    try {
      if (!churchPub || !churchSk) return 'no-key';
      if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return 'native';
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') { const ok = await Notification.requestPermission(); if (ok !== 'granted') return 'denied'; }
      if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return 'denied';
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const vapid = await fetch('/push/vapid').then(r => r.json()).catch(() => null);
        if (!vapid || !vapid.publicKey) return 'no-vapid';
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64ToU8(vapid.publicKey) });
      }
      // prove control of the church key (NIP-98), bound to this endpoint, so the gateway files it under churchPub
      const auth = finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', sub.endpoint], ['method', 'POST']], content: '' }, churchSk);
      const r = await fetch('/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub, auth }) });
      return r.ok ? 'on' : 'error';
    } catch { return 'error'; }
  },

  // ---- publish (signed by the church) ----
  publishProfile(meta) {
    if (!sk) return Promise.resolve(null);
    lastProfile = { ...lastProfile, ...meta };   // merge so a partial edit (e.g. name) keeps channel etc.
    const m = lastProfile;
    // clean any steward-typed address (strip http/www/path); auto-claim a relay handle if none is set
    let nip05 = cleanNip05(m.nip05, m.name);
    if (!nip05 && m.name) {
      const local = String(m.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 30);
      const host = (CANONICAL_RELAY || '').replace(/^wss?:\/\//i, '').replace(/\/relay\/?$/i, '');
      if (local && host) nip05 = local + '@' + host;
    }
    const content = JSON.stringify({ name: m.name || '', about: m.about || '', nip05, picture: m.picture || '', banner: m.banner || '', bannerFade: (typeof m.bannerFade === 'number') ? m.bannerFade : 16, accent: m.accent || '', channel: m.channel || '', audioFeed: m.audioFeed || '', lud16: (m.lud16 || '').trim(), giving: !!m.giving, features: (m.features && typeof m.features === 'object') ? m.features : {}, rules: (m.rules && typeof m.rules === 'object') ? m.rules : {} });
    return publish(finalizeEvent({ kind: 0, created_at: now(), tags: [], content }, sk));
  },
  publishFund(fund) {
    if (!sk) return Promise.resolve(null);
    const id = fund.id || ('fund' + Date.now());
    const content = JSON.stringify({ name: fund.name || 'Fund', sub: fund.sub || '', icon: fund.icon || 'gift',
      lnaddr: (fund.lnaddr || '').trim(), address: fund.address || '', custody: fund.custody || 'Self-custody · Lightning' });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', FUND_D + id], ['t', NET]], content }))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
  },
  removeFund(id) {
    if (!sk) return Promise.resolve(null);
    // tombstone: republish the addressable event with empty content (a real relay would honor NIP-09 too)
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', FUND_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  // Post a kind-1 message into a group as the church. MUST carry ['p', churchPub] — the member's
  // subscribeGroup scopes by it, so without it the post is invisible to members (was the bug).
  publishPost(content, group) {
    if (!sk) return Promise.resolve(null);
    let body = content || '', encTag = [];
    const gkey = group && _skeys[group];   // encrypted group → seal the post
    if (gkey) { try { body = nip44e(content || '', gkey); encTag = [['enc', '1']]; } catch (e) {} }
    return publish(feChurch({ kind: 1, created_at: now(), tags: [['t', NET], ['t', group || 'announce'], ['p', pub], ...encTag], content: body }));
  },
  // read a group/team's chat (kind-1 tagged with the group id, scoped to this church) — for the console chat view.
  // Folds in kind-7 reactions (same shape the member app posts) so the console shows + sets reactions too.
  subscribeGroupChat(groupId, onMsgs) {
    const byId = new Map();
    const rx = new Map();   // msgId -> Map(reactorPub -> emoji)
    const names = new Map();   // pubkey -> display name, resolved from kind-0 (else the console shows everyone as "Anonymous")
    const seen = new Set();    // authors already queried
    const nameSubs = []; let pending = [], batchTimer = null;
    let hidden = new Set();   // message ids the steward/leaders removed → withheld from the view
    const attach = () => [...byId.values()].filter(m => !hidden.has(m.id)).sort((a, b) => (a.ts || 0) - (b.ts || 0)).map(m => {
      const r = rx.get(m.id); return { ...m, name: names.get(m.by) || '', reactions: r ? [...r.values()].filter(Boolean) : [], myReaction: r ? r.get(pub) || '' : '' };
    });
    const emit = () => onMsgs(attach());
    // resolve sender names in one batched kind-0 sub (debounced) — avoids a sub per author (relay cap)
    const resolveName = (pk) => {
      if (!pk || seen.has(pk)) return; seen.add(pk); pending.push(pk);
      clearTimeout(batchTimer);
      batchTimer = setTimeout(() => {
        const authors = pending.splice(0); if (!authors.length) return;
        const s2 = pool.subscribeMany(relays(), [{ kinds: [0], authors }], {
          onevent(ev) { try { const p = JSON.parse(ev.content); const nm = p && (p.name || p.display_name); if (nm) { names.set(ev.pubkey, nm); emit(); } } catch {} },
          oneose() {},
        });
        nameSubs.push(s2);
      }, 200);
    };
    const sub = pool.subscribeMany(relays(), [{ kinds: [1], '#t': [groupId], limit: 300 }, { kinds: [7], '#t': [groupId], limit: 500 }], {
      onevent(e) {
        if (e.kind === 7) {
          const tid = (e.tags.find(t => t[0] === 'e') || [])[1]; if (!tid) return;
          let m = rx.get(tid); if (!m) { m = new Map(); rx.set(tid, m); }
          if (e.content === '-' || e.content === '') m.delete(e.pubkey); else m.set(e.pubkey, e.content);
          emit(); return;
        }
        if (!e.tags.some(t => t[0] === 't' && t[1] === groupId)) return;
        if (!e.tags.some(t => t[0] === 'p' && t[1] === pub)) return;   // this church's scope
        let text = e.content;
        if (e.tags.some(t => t[0] === 'enc')) { const k = _skeys[groupId]; if (!k) return; try { text = nip44d(e.content, k); } catch { return; } }
        byId.set(e.id, { id: e.id, by: e.pubkey, mine: e.pubkey === pub, text, ts: e.created_at, kind: (e.tags.find(t => t[0] === 'k') || [])[1] || '' });
        resolveName(e.pubkey);
        emit();
      },
      oneose() { emit(); },
    });
    const hideSub = window.Steward.subscribeHidden((set) => { hidden = set; emit(); });
    return () => { try { sub.close(); } catch {} try { hideSub(); } catch {} clearTimeout(batchTimer); nameSubs.forEach(s => { try { s.close(); } catch {} }); };
  },
  // react to a group message (NIP-25 kind-7), interoperable with the member app. emoji '' or '-' retracts.
  reactGroup(groupId, msgId, targetPub, emoji) {
    if (!sk || !groupId || !msgId) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 7, created_at: now(), tags: [['e', msgId], ['p', targetPub || ''], ['t', NET], ['t', groupId]], content: emoji || '-' }, sk));
  },

  // ---- direct messages: the church <-> a member (NIP-04 encrypted kind-4) ----
  async sendDM(peerHex, content) {
    if (!sk || !peerHex) return null;
    let enc = ''; try { enc = await nip04encrypt(sk, peerHex, content); } catch { return null; }
    const evt = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', peerHex], ['t', NET]], content: enc }, sk);
    return publish(evt);
  },
  // the 1:1 thread with one member (decrypts both directions; carries kind-7 reactions per message)
  subscribeDMThread(peerHex, onMsgs) {
    const byId = new Map();
    const rx = new Map();   // msgId -> Map(reactorPub -> emoji)
    const attach = () => [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)).map(m => {
      const r = rx.get(m.id); const reactions = r ? [...r.values()].filter(Boolean) : [];
      return { ...m, reactions, myReaction: r ? r.get(pub) || '' : '' };
    });
    const emit = () => onMsgs(attach());
    const take = async (e) => {
      if (byId.has(e.id)) return;
      const mine = e.pubkey === pub; const other = mine ? peerHex : e.pubkey;
      let text = ''; try { text = await nip04decrypt(sk, other, e.content); } catch { return; }
      byId.set(e.id, { id: e.id, mine, text, ts: e.created_at }); emit();
    };
    const takeRx = (e) => {
      const tid = (e.tags.find(t => t[0] === 'e') || [])[1]; if (!tid) return;
      let m = rx.get(tid); if (!m) { m = new Map(); rx.set(tid, m); }
      if (e.content === '-' || e.content === '') m.delete(e.pubkey); else m.set(e.pubkey, e.content);
      emit();
    };
    const sub = pool.subscribeMany(relays(), [
      { kinds: [4], authors: [pub], '#p': [peerHex] }, { kinds: [4], authors: [peerHex], '#p': [pub] },
      { kinds: [7], authors: [pub], '#p': [peerHex] }, { kinds: [7], authors: [peerHex], '#p': [pub] },
    ], {
      onevent(e) { if (e.kind === 7) takeRx(e); else take(e); }, oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // react to a member's DM (NIP-25 kind-7). emoji '' or '-' retracts.
  async reactDM(peerHex, msgId, emoji) {
    if (!sk || !peerHex || !msgId) return null;
    const evt = finalizeEvent({ kind: 7, created_at: now(), tags: [['e', msgId], ['p', peerHex], ['t', NET], ['k', '4']], content: emoji || '-' }, sk);
    return publish(evt);
  },
  // list of members who have a DM thread with the church (most recent first)
  subscribeDMConvos(onConvos) {
    const byPeer = new Map();
    const emit = () => onConvos([...byPeer.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [4], authors: [pub] }, { kinds: [4], '#p': [pub] }], {
      onevent(e) {
        const mine = e.pubkey === pub; const peer = mine ? (e.tags.find(t => t[0] === 'p') || [])[1] : e.pubkey;
        if (!peer || peer === pub) return;
        const prev = byPeer.get(peer);
        if (!prev || e.created_at > prev.ts) { byPeer.set(peer, { peer, npub: npubEncode(peer), ts: e.created_at }); emit(); }
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- read the church's own data (live) ----
  // onFunds(fundsArray) fires whenever the fund set changes; returns an unsubscribe fn.
  subscribeFunds(onFunds) {
    const byId = new Map();
    const emit = () => onFunds([...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(FUND_D)) return;
        const id = d.slice(FUND_D.length);
        const deleted = e.tags.some(t => t[0] === 'deleted') || !e.content;
        if (deleted) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- categories (named containers that group the church's groups, e.g. "Lifegroups") ----
  publishCategory(cat) {
    if (!sk) return Promise.resolve(null);
    const id = cat.id || ('cat' + Date.now());
    const content = JSON.stringify({ name: cat.name || 'Category', order: typeof cat.order === 'number' ? cat.order : undefined });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', CATEGORY_D + id], ['t', NET]], content }))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
  },
  removeCategory(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', CATEGORY_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeCategories(onCats) {
    const byId = new Map();
    const emit = () => onCats([...byId.values()].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(CATEGORY_D)) return;
        const id = d.slice(CATEGORY_D.length);
        const deleted = e.tags.some(t => t[0] === 'deleted') || !e.content;
        if (deleted) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- groups (the church's chat rooms) ----
  publishGroup(group) {
    if (!sk) return Promise.resolve(null);
    const id = group.id || ('grp' + Date.now());
    const inviteOnly = group.visibility === 'invite';
    const content = JSON.stringify({ name: group.name || 'Group', kind: group.kind || 'group', sub: group.sub || '', icon: group.icon || '', accent: group.accent || '', leaders: Array.isArray(group.leaders) ? group.leaders : [], order: typeof group.order === 'number' ? group.order : undefined, category: group.category || undefined, visibility: inviteOnly ? 'invite' : undefined, members: inviteOnly && Array.isArray(group.members) ? group.members : undefined, encrypted: group.encrypted ? true : undefined, childsafe: group.childsafe ? true : undefined });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', GROUP_D + id], ['t', NET]], content }))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
  },
  // set which members can post events for a group (re-publishes the group def, preserving its fields)
  setGroupLeaders(group, leaderPubs) {
    return window.Steward.publishGroup({ ...group, leaders: (leaderPubs || []).filter(Boolean) });
  },
  removeGroup(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', GROUP_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  // ---- encrypted groups: publish/refresh the key envelope (the group key wrapped per-member via NIP-44).
  //
  // Contract callers MUST honour (SECURITY-AUDIT-2026-06-24 N2):
  //   • Adding a member without rotation → reuse the existing key so new members can read history.
  //     This is the normal case; pass NO opts (or only `reuseOnly`).
  //   • REMOVING a member from an encrypted group → you MUST pass `{rotate: true}` so a fresh key
  //     is minted. Without rotation, the removed member's CACHED key continues to decrypt every
  //     future message they can scrape from any relay — the gateway's allowlist only stops the
  //     RELAY from delivering future messages, it can't unsee bytes the member already cached, and
  //     it can't stop the same member subscribing from a non-enforcing relay. Verified call site:
  //     EditGroupMembersModal in stew-dashboard.jsx passes `{rotate: removed}`.
  //   • Background re-key (`reuseOnly: true`) → must NOT mint a new key (would orphan history).
  //
  // The church key is always wrapped to itself (so the church can later add members without needing
  // the original opaque key material from disk). ----
  publishGroupKey(groupId, memberPubs, opts = {}) {
    if (!churchSk || !churchPub) return Promise.resolve(null);
    if (opts.reuseOnly && !_skeys[groupId]) return Promise.resolve(null);   // background re-key must NOT mint a new key (would orphan history)
    const recips = [...new Set([churchPub, ...(memberPubs || []).map(p => toPubHex(p) || p).filter(Boolean)])];
    let key = _skeys[groupId];
    if (opts.rotate || !key) { key = crypto.getRandomValues(new Uint8Array(32)); _srev[groupId] = (_srev[groupId] || 0) + 1; }
    _skeys[groupId] = key;
    const rev = _srev[groupId] || 1; _srev[groupId] = rev;
    const keys = {};
    for (const pk of recips) { try { keys[pk] = nip44e(_hex(key), nip44ck(churchSk, pk)); } catch (e) {} }
    _senvTs[groupId] = now();
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GROUPKEY_D + groupId], ['t', NET]], content: JSON.stringify({ rev, keys }) }, churchSk));
  },
  // ---- moderation: the church's blocklist (banned member pubkeys). The relay rejects their writes
  // and withholds their existing events. Replaceable doc d=blocked:<churchpub>. ----
  subscribeBlocked(onBlocked) {
    let cur = [];
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== BLOCKED_D + pub) return;
        try { cur = (JSON.parse(e.content).pubkeys) || []; } catch { cur = []; }
        onBlocked(cur);
      },
      oneose() { onBlocked(cur); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setBlocked(pubkeys) {   // replace the whole blocklist (pass hex pubkeys)
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    const content = JSON.stringify({ pubkeys: list });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', BLOCKED_D + pub], ['t', NET]], content }, sk));
  },

  // ---- safeguarding: two church-signed lists the relay reads to enforce child protection ----
  // minors:<churchpub> = members marked as children; approved:<churchpub> = adults cleared to contact youth
  // (should mirror the church's real DBS/cleared list). The relay rejects a kind-4 DM where one party is
  // a minor and the other isn't on the approved list. The member app uses minors to show a child only
  // child-safe groups. Replaceable docs, church-only writes. ----
  subscribeSafeguard(onLists) {   // onLists({ minors:[…], approved:[…], nophoto:[…] })
    let minors = [], approved = [], nophoto = [];
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d === MINORS_D + pub) { try { minors = (JSON.parse(e.content).pubkeys) || []; } catch { minors = []; } onLists({ minors, approved, nophoto }); }
        else if (d === APPROVED_D + pub) { try { approved = (JSON.parse(e.content).pubkeys) || []; } catch { approved = []; } onLists({ minors, approved, nophoto }); }
        else if (d === NOPHOTO_D + pub) { try { nophoto = (JSON.parse(e.content).pubkeys) || []; } catch { nophoto = []; } onLists({ minors, approved, nophoto }); }
      },
      oneose() { onLists({ minors, approved, nophoto }); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setNoPhoto(pubkeys) {   // replace the whole photo-suppression list (church-signed, owner-only)
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', NOPHOTO_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },
  setMinors(pubkeys) {   // replace the whole minors list (pass hex pubkeys)
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MINORS_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },
  setApproved(pubkeys) {   // replace the whole approved-adults list (pass hex pubkeys)
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', APPROVED_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },

  // ---- safeguarding v2: parent↔child links. Parents publish a guardian-link REQUEST (guardreq:<childpub>,
  // p-tagged to us); the steward confirms it into the church-signed GUARDIANS map (guardians:<churchpub>),
  // which the relay reads so a parent may always DM their own child. ----
  subscribeGuardianRequests(onReqs) {   // pending parent requests → [{ child, parent, parentName, childName, ts }]
    const byChild = new Map();
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#p': [pub] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(GUARDREQ_D)) return;
        const child = d.slice(GUARDREQ_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byChild.delete(child); }
        else { try { const c = JSON.parse(e.content); byChild.set(child, { child, parent: c.parent || e.pubkey, parentName: c.parentName || '', childName: c.childName || '', ts: e.created_at }); } catch {} }
        onReqs([...byChild.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      },
      oneose() { onReqs([...byChild.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0))); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  subscribeGuardians(onMap) {   // the church's confirmed map → { childPub: [parentPub, …] }
    let cur = {};
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== GUARDIANS_D + pub) return;
        try { cur = (JSON.parse(e.content).links) || {}; } catch { cur = {}; }
        onMap(cur);
      },
      oneose() { onMap(cur); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setGuardians(links) {   // replace the whole parent↔child map: { childPub: [parentPub, …] }
    if (!sk) return Promise.resolve(null);
    const clean = {};
    for (const [c, ps] of Object.entries(links || {})) { const arr = [...new Set((ps || []).filter(Boolean))]; if (c && arr.length) clean[c] = arr; }
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GUARDIANS_D + pub], ['t', NET]], content: JSON.stringify({ links: clean }) }, sk));
  },

  // ---- joining: by default anyone with the invite/QR joins instantly. A steward can switch on
  // "require approval", and then a new member is held as a pending request until admitted. The relay
  // reads joinpolicy:<churchpub> + the admitted:<churchpub> allowlist and withholds posting until then. ----
  subscribeJoinPolicy(onPolicy) {   // onPolicy(true|false) — does joining need approval?
    let approval = false;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== JOINPOLICY_D + pub) return;
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) approval = false;
        else { try { approval = !!JSON.parse(e.content).approval; } catch { approval = false; } }
        onPolicy(approval);
      },
      oneose() { onPolicy(approval); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setJoinPolicy(approval) {   // turn approval-to-join on/off
    if (!sk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', JOINPOLICY_D + pub], ['t', NET]], content: JSON.stringify({ approval: !!approval }) }, sk));
  },
  subscribeAdmitted(onList) {   // the approved-members allowlist → [pubkeys]
    let cur = [];
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== ADMITTED_D + pub) return;
        try { cur = (JSON.parse(e.content).pubkeys) || []; } catch { cur = []; }
        onList(cur);
      },
      oneose() { onList(cur); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setAdmitted(pubkeys) {   // replace the whole admitted list (pass hex pubkeys)
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ADMITTED_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },

  // ---- delegated stewards: the OWNER (this church key) signs a roster of co-steward pubkeys. The relay
  // grants those keys day-to-day church powers (but never the roster/blocklist/relay-policy — owner-only),
  // and revocation = re-publish the roster without them. See STEWARD-ROSTER-DESIGN.md. ----
  subscribeStewards(onList) {   // the current steward roster → [hex pubkeys]
    let cur = [];
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== STEWARDS_D + pub) return;
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) cur = [];
        else { try { cur = (JSON.parse(e.content).pubkeys) || []; } catch { cur = []; } }
        onList(cur);
      },
      oneose() { onList(cur); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setStewards(pubkeys) {   // OWNER-ONLY: replace the whole steward roster (pass hex pubkeys)
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', STEWARDS_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },

  // ---- encrypted church docs: NIP-44 self-encryption to the CHURCH key. Used by the optional Finance
  // module so sensitive donor PII + ledger never hit the relay in plaintext — only the church key (held
  // in Keykeeper on the steward's device) can read them. The finance module talks only to these
  // primitives, never to the raw key. ----
  encSelf(obj) {                       // → ciphertext string, or null if no church key / failure
    if (!churchSk || !churchPub) return null;
    try { return nip44e(JSON.stringify(obj), nip44ck(churchSk, churchPub)); } catch (e) { return null; }
  },
  decSelf(str) {                       // ciphertext → object, or null
    if (!churchSk || !churchPub || !str) return null;
    try { return JSON.parse(nip44d(str, nip44ck(churchSk, churchPub))); } catch (e) { return null; }
  },
  // publish an encrypted addressable church doc (kind-30078, signed by the church key)
  encPublish(dtag, obj) {
    if (!churchSk) return Promise.resolve(null);
    const content = window.Steward.encSelf(obj); if (content == null) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', dtag], ['t', NET], ['enc', '1']], content }, churchSk));
  },
  encRemove(dtag) {                    // tombstone an encrypted doc
    if (!churchSk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', dtag], ['t', NET], ['deleted', '1']], content: '' }, churchSk));
  },
  // subscribe to all encrypted church docs whose d-tag starts with `prefix`; decrypts each and emits a
  // live array of { id (the d-tag suffix after prefix), ...decrypted, ts }. Returns an unsubscribe fn.
  encSubscribe(prefix, cb) {
    if (!churchPub) { cb([]); return () => {}; }
    const byId = new Map();
    const emit = () => cb([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [churchPub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(prefix)) return;
        const id = d.slice(prefix.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        const obj = window.Steward.decSelf(e.content); if (obj == null) return;
        byId.set(id, { id, ...obj, ts: e.created_at }); emit();
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- moderation: pin a message at the top of a group's chat ----
  // One addressable doc per group (d=pin:<groupId>), scoped to the group's 't' tag so a group leader
  // could publish it too (the relay accepts pin docs from a group's leaders, like events). Content
  // carries the pinned message snapshot so both apps render the banner without re-fetching the message.
  pinPost(groupId, msg) {
    if (!sk || !groupId || !msg || !msg.id) return Promise.resolve(null);
    const content = JSON.stringify({ msgId: msg.id, text: msg.text || '', by: msg.by || '', ts: msg.ts || now() });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', PIN_D + groupId], ['t', NET], ['t', groupId], ['p', pub]], content }));
  },
  unpin(groupId) {   // clear the group's pin (tombstone the addressable doc)
    if (!sk || !groupId) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', PIN_D + groupId], ['t', NET], ['t', groupId], ['p', pub], ['deleted', '1']], content: '' }));
  },
  // the current pin for one group → cb({ msgId, text, by, ts }) or cb(null) when unpinned. Unsub fn.
  subscribeGroupPin(groupId, cb) {
    let latest = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#d': [PIN_D + groupId] }], {
      onevent(e) {
        if (e.created_at < latest) return; latest = e.created_at;
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { cb(null); return; }
        try { cb(JSON.parse(e.content)); } catch { cb(null); }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- moderation: hide (remove) a specific member's message from a group's chat ----
  // One addressable doc per message (d=hidden:<msgId>), scoped to the group's 't' tag so a group leader
  // can also remove a message (relay accepts hide docs from the group's leaders). This is a CLIENT-SIDE
  // hide — the kind-1 event still exists on the relay; both chat views filter out hidden ids. A relay-side
  // drop is a possible stronger follow-on (mirrors the existing blocklist's hide-vs-purge model).
  hideMessage(groupId, msgId) {
    if (!sk || !msgId) return Promise.resolve(null);
    const tags = [['d', HIDE_D + msgId], ['t', NET], ['p', pub]];
    if (groupId) tags.push(['t', groupId]);   // scope to the group so a group leader is authorised
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags, content: JSON.stringify({ groupId: groupId || '' }) }, sk));
  },
  unhideMessage(groupId, msgId) {   // restore a hidden message (tombstone the hide doc)
    if (!sk || !msgId) return Promise.resolve(null);
    const tags = [['d', HIDE_D + msgId], ['t', NET], ['p', pub], ['deleted', '1']];
    if (groupId) tags.push(['t', groupId]);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags, content: '' }, sk));
  },
  // the set of hidden message ids → cb(Set<msgId>) on every change. Unsub fn.
  subscribeHidden(cb) {
    const hidden = new Map();   // msgId -> hidden? (latest wins)
    const emit = () => cb(new Set([...hidden.entries()].filter(([, h]) => h).map(([id]) => id)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#p': [pub] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(HIDE_D)) return;
        const msgId = d.slice(HIDE_D.length);
        hidden.set(msgId, !(e.tags.some(t => t[0] === 'deleted') || !e.content));
        emit();
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  subscribeGroups(onGroups) {
    const CACHE_KEY = 'trinityone.steward.groups.' + (pub || '');
    const byId = new Map();
    // steward-chosen order first (groups without an order fall to the end, by age)
    const emit = () => { const arr = [...byId.values()].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0)); try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); } catch {} onGroups(arr); };
    // paint cached groups instantly so the page doesn't flash empty before the relay answers
    try { const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); if (Array.isArray(cached)) { cached.forEach(g => { if (g && g.id != null) byId.set(g.id, g); }); if (cached.length) onGroups(cached); } } catch {}
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d.startsWith(GROUPKEY_D)) { stewIngestKey(e); return; }   // cache the church's own group keys
        if (!d.startsWith(GROUP_D)) return;
        const id = d.slice(GROUP_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- reading plans the church shares with the congregation ----
  // Published as a signed kind-30078 (d=plan:<id>) with the full plan (days included) so member apps
  // render it without needing the plan built in. Members then start/track it locally.
  // asPub (optional) publishes the plan AS an owned network instead of the church — network-wide reading plan.
  publishPlan(plan, asPub) {
    const signer = skFor(asPub); if (!signer) return Promise.resolve(null);
    const id = plan.id || ('plan' + Date.now());
    const pubAt = plan.publishAt && plan.publishAt > now() ? Math.floor(plan.publishAt) : 0;   // schedule: members hide until this unix-sec time
    const content = JSON.stringify({ id, title: plan.title || 'Plan', sub: plan.sub || '', tag: plan.tag || '', accent: plan.accent || 'var(--clay)', blurb: plan.blurb || '', days: plan.days || [], publishAt: pubAt, draft: !!plan.draft });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', PLAN_D + id], ['t', NET]], content }, signer))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
  },
  removePlan(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', PLAN_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribePlans(onPlans) {
    const CACHE_KEY = 'trinityone.steward.plans.' + (pub || '');
    const byId = new Map();
    const emit = () => { const arr = [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)); try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); } catch {} onPlans(arr); };
    try { const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); if (Array.isArray(cached)) { cached.forEach(p => { if (p && p.id != null) byId.set(p.id, p); }); if (cached.length) onPlans(cached); } } catch {}
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
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

  // ---- devotionals the church shares (an uploaded text/Markdown reflection on a passage) ----
  // devo = { id?, title, ref, text }. The file (.txt or .md) is read client-side; its text is stored in the event.
  publishDevotional(devo) {
    if (!sk) return Promise.resolve(null);
    const id = devo.id || ('devo' + Date.now());
    const base = { id, title: devo.title || 'Devotional', ref: devo.ref || '', type: devo.type || 'txt', text: devo.text || '' };
    if (typeof devo.order === 'number') base.order = devo.order;   // steward-controlled display order (lower = first)
    if (devo.series) base.series = String(devo.series).slice(0, 80);   // the named series this devotional belongs to (groups it in both apps)
    if (devo.publishAt && devo.publishAt > now()) base.publishAt = Math.floor(devo.publishAt);   // schedule: members hide it until this unix-sec time; the steward still sees it
    if (devo.draft) base.draft = true;   // held: hidden from members until the steward publishes (regardless of publishAt)
    const content = JSON.stringify(base);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', DEVO_D + id], ['t', NET]], content }))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
  },
  removeDevotional(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', DEVO_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeDevotionals(onDevos) {
    const CACHE_KEY = 'trinityone.steward.devos.' + (pub || '');
    const byId = new Map();
    // explicit steward order first (lower = earlier); the rest fall back to newest-first
    const ord = d => (typeof d.order === 'number' ? d.order : Infinity);
    const emit = () => { const arr = [...byId.values()].sort((a, b) => ord(a) - ord(b) || (b.ts || 0) - (a.ts || 0)); try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); } catch {} onDevos(arr); };
    // paint the last-known devotionals instantly so the page doesn't flash empty before the relay answers
    try { const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); if (Array.isArray(cached)) { cached.forEach(it => { if (it && it.id != null) byId.set(it.id, it); }); if (cached.length) onDevos(cached); } } catch {}
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(DEVO_D)) return;
        const id = d.slice(DEVO_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { const c = JSON.parse(e.content); byId.set(id, { id, title: c.title, ref: c.ref, type: c.type, text: c.text || '', order: c.order, series: c.series || '', publishAt: c.publishAt || 0, draft: !!c.draft, hasFile: !!c.text, ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ════════════ SERVING / ROTA / CALENDAR (the coverage board) ════════════
  // A generic addressable-doc subscription over the church's own kind-30078 with a given d-prefix.
  _subAddr(prefix, map, onItems) {
    const CACHE_KEY = 'trinityone.steward.addr.' + prefix + (pub || '');
    const byId = new Map();
    // paint the last-known docs instantly so the page doesn't flash empty before the relay answers
    try { const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); if (Array.isArray(cached)) { cached.forEach(it => { if (it && it.id != null) byId.set(it.id, it); }); if (cached.length) onItems(cached); } } catch {}
    const emit = () => { const arr = [...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)); try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); } catch {} onItems(arr); };
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
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

  // ---- team rosters: the roles a team needs + the people who can serve ----
  // roster = { roles:[{id,name}], people:[{id,name,pub?}] }, keyed by team(group) id.
  publishRoster(teamId, roster) {
    if (!sk || !teamId) return Promise.resolve(null);
    const roles = (roster.roles || []).map(r => ({ id: r.id || ('r' + Math.random().toString(36).slice(2, 7)), name: r.name || 'Role' }));
    const people = (roster.people || []).map(p => ({ id: p.id || ('p' + Math.random().toString(36).slice(2, 7)), name: p.name || '', pub: p.pub || '' }));
    // serving pods: a named set of role->person mappings, applied to a service in one tap. fills = { roleId: personId }
    const pods = (roster.pods || []).map(p => ({ id: p.id || ('pod' + Math.random().toString(36).slice(2, 7)), name: p.name || 'Pod', fills: (p.fills && typeof p.fills === 'object') ? p.fills : {} }));
    const content = JSON.stringify({ roles, people, pods });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', ROSTER_D + teamId], ['t', NET]], content }))
      .then(() => ({ id: teamId, roles, people, pods }));
  },
  subscribeRosters(onRosters) { return this._subAddr(ROSTER_D, (c, id) => ({ team: id, roles: c.roles || [], people: c.people || [], pods: c.pods || [] }), onRosters); },

  // ---- services: a dated gathering people serve at ----
  // service = { id?, date:'YYYY-MM-DD', time:'10:30', name }
  publishService(svc) {
    if (!sk) return Promise.resolve(null);
    const id = svc.id || ('svc' + Date.now());
    const content = JSON.stringify({ date: svc.date || '', time: svc.time || '10:30', name: svc.name || 'Sunday Gathering' });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', SERVICE_D + id], ['t', NET]], content }))
      .then(() => ({ id, ...JSON.parse(content) }));
  },
  removeService(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', SERVICE_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeServices(onServices) { return this._subAddr(SERVICE_D, (c) => ({ date: c.date, time: c.time, name: c.name }), onServices); },
  // ---- run sheets: a service's order-of-service + song setlist (d=runsheet:<serviceId>) ----
  publishRunsheet(serviceId, items) {
    if (!sk || !serviceId) return Promise.resolve(null);
    const content = JSON.stringify({ items: Array.isArray(items) ? items : [] });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', RUNSHEET_D + serviceId], ['t', NET]], content }));
  },
  subscribeRunsheets(onSheets) { return this._subAddr(RUNSHEET_D, (c) => ({ items: Array.isArray(c.items) ? c.items : [] }), onSheets); },
  // ---- kids check-in (ENCRYPTED to the church key: a child's presence + pickup code never leave plaintext,
  // so the relay + other members can't see them). Run by the church-key holder; d=checkin:<id>. ----
  publishCheckin(rec) {
    const id = rec.id || ('ci' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    return window.Steward.encPublish('trinityone/checkin:' + id, {
      id, child: rec.child || '', childName: rec.childName || '', date: rec.date || new Date().toISOString().slice(0, 10),
      in: rec.in || Math.floor(Date.now() / 1000), out: rec.out != null ? rec.out : null, code: rec.code || '', room: rec.room || '', note: rec.note || '',
    });
  },
  removeCheckin(id) { return window.Steward.encRemove('trinityone/checkin:' + id); },
  subscribeCheckins(cb) { return window.Steward.encSubscribe('trinityone/checkin:', cb); },

  // ---- rooms & bookings: a shared room calendar (steward-booked) ----
  // room = { id?, name, capacity?, note? } ; booking = { id?, roomId, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM', title, note }
  publishRoom(room) {
    if (!sk) return Promise.resolve(null);
    const id = room.id || ('room' + Date.now());
    const content = JSON.stringify({ name: (room.name || 'Room').trim(), capacity: room.capacity || '', note: (room.note || '').trim() });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', ROOM_D + id], ['t', NET]], content })).then(() => ({ id, ...JSON.parse(content) }));
  },
  removeRoom(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', ROOM_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeRooms(cb) { return this._subAddr(ROOM_D, (c) => ({ name: c.name, capacity: c.capacity, note: c.note }), cb); },
  publishBooking(b) {
    if (!sk || !b || !b.roomId) return Promise.resolve(null);
    const id = b.id || ('bk' + Date.now());
    const content = JSON.stringify({ roomId: b.roomId, date: b.date || '', start: b.start || '', end: b.end || '', title: (b.title || '').trim(), note: (b.note || '').trim() });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', BOOKING_D + id], ['t', NET]], content })).then(() => ({ id, ...JSON.parse(content) }));
  },
  removeBooking(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', BOOKING_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeBookings(cb) { return this._subAddr(BOOKING_D, (c, id) => ({ roomId: c.roomId, date: c.date, start: c.start, end: c.end, title: c.title, note: c.note }), cb); },

  // ---- rota: assignments for one service (latest wins; published flag) ----
  // rota = { service:<serviceId>, published:bool, assign:{ '<teamId>::<roleId>': {name, pub} } }
  publishRota(rota) {
    if (!sk || !rota || !rota.service) return Promise.resolve(null);
    const content = JSON.stringify({ service: rota.service, published: !!rota.published, assign: rota.assign || {} });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', ROTA_D + rota.service], ['t', NET]], content }))
      .then(() => ({ id: rota.service, service: rota.service, published: !!rota.published, assign: rota.assign || {} }));
  },
  removeRota(serviceId) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', ROTA_D + serviceId], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeRotas(onRotas) { return this._subAddr(ROTA_D, (c, id) => ({ service: id, published: !!c.published, assign: c.assign || {} }), onRotas); },

  // ---- calendar events (non-serving: workdays, lunches, prayer evenings…) ----
  // event = { id?, date, time, title, where, blurb, accent }
  // asPub (optional) publishes the event AS an owned network instead of the church — network-wide event.
  publishEvent(ev, asPub) {
    const signer = skFor(asPub); if (!signer) return Promise.resolve(null);
    const id = ev.id || ('evt' + Date.now());
    const groupId = ev.groupId || '';
    const content = JSON.stringify({ date: ev.date || '', time: ev.time || '', title: ev.title || 'Event', where: ev.where || '', blurb: ev.blurb || '', accent: ev.accent || 'var(--clay)', image: ev.image || '', groupId });
    const tags = [['d', EVENT_D + id], ['t', NET]];
    if (groupId) tags.push(['t', groupId]);   // lets a group's chat filter to its own events
    if (actingChurch) tags.push(['p', actingChurch]);   // delegated steward: p-tag the church so members' group view shows it
    return publish(feChurch({ kind: 30078, created_at: now(), tags, content }, signer))   // feChurch stamps ['church',cp] in delegated mode so the relay accepts it
      .then(() => ({ id, ...JSON.parse(content) }));
  },
  removeEvent(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', EVENT_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeEvents(onEvents) { return this._subAddr(EVENT_D, (c) => ({ date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent }), onEvents); },
  // a single group's upcoming events (for the group chat window) — the church's own + its stewards' (church-tagged)
  subscribeGroupEvents(groupId, onEvents) {
    const byId = new Map();
    const emit = () => onEvents([...byId.values()].sort((a, b) => (a.date || '').localeCompare(b.date || '')));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#t': [groupId] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(EVENT_D)) return;
        if (e.pubkey !== pub && !e.tags.some(t => (t[0] === 'p' || t[0] === 'church') && t[1] === pub)) return;   // scope to this church (+ its stewards)
        const id = d.slice(EVENT_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { const c = JSON.parse(e.content); byId.set(id, { id, date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- serving requests: steward -> a member "can you serve?" (p-tagged to the member) ----
  sendServingRequest(req) {
    if (!sk || !req || !req.memberPub) return Promise.resolve(null);
    const id = req.id || ('req' + Date.now());
    const content = JSON.stringify({ serviceId: req.serviceId || '', teamId: req.teamId || '', roleId: req.roleId || '', role: req.role || '', teamName: req.teamName || '', icon: req.icon || 'hand', accent: req.accent || 'var(--clay)', date: req.date || '', time: req.time || '', service: req.service || '', from: req.from || 'Your church', note: req.note || '' });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', REQUEST_D + id], ['t', NET], ['p', req.memberPub]], content }, sk))
      .then(() => ({ id, ...JSON.parse(content), memberPub: req.memberPub }));
  },
  // the church's own "can you serve?" request docs (so the board can join replies to a slot)
  subscribeRequests(onRequests) {
    const byId = new Map();
    const emit = () => onRequests([...byId.values()]);
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(REQUEST_D)) return;
        const id = d.slice(REQUEST_D.length);
        const memberPub = (e.tags.find(t => t[0] === 'p') || [])[1] || '';
        if (!e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, memberPub, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // the steward's view of replies members sent back (reqreply docs p-tagged to the church)
  subscribeRequestReplies(onReplies) {
    const byId = new Map();
    const emit = () => onReplies([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#p': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(REQREPLY_D)) return;
        const id = d.slice(REQREPLY_D.length);
        if (!e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, by: e.pubkey, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // member unavailability docs p-tagged to the church -> { memberPub: [dates] } (for "Away" + Auto-fill)
  subscribeUnavail(onUnavail) {
    const UNAVAIL_D = 'trinityone/unavail:'; const byMember = {};
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#p': [pub], '#t': [NET] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(UNAVAIL_D)) return; try { byMember[e.pubkey] = JSON.parse(e.content).dates || []; onUnavail({ ...byMember }); } catch {} },
      oneose() { onUnavail({ ...byMember }); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // member RSVPs p-tagged to the church -> { eventId: { memberPub: v } } (for "going" counts)
  subscribeRsvps(onRsvps) {
    const RSVP_D = 'trinityone/rsvp:'; const byEvent = {};
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#p': [pub], '#t': [NET] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(RSVP_D)) return; const ev = d.slice(RSVP_D.length); try { (byEvent[ev] = byEvent[ev] || {})[e.pubkey] = JSON.parse(e.content).v; onRsvps({ ...byEvent }); } catch {} },
      oneose() { onRsvps({ ...byEvent }); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- members: people who participate in this church's chat ----
  // In an anonymous, self-custodial model there is no follower registry. The real, privacy-
  // respecting signal a steward can see is participation: members tag their messages with the
  // church's pubkey (['p', churchPub]), so we read kind-1 events addressed to us, aggregate by
  // author, and resolve each author's kind-0 profile. The church's own posts are excluded.
  subscribeMembers(onMembers) {
    const MEMBER_D = 'trinityone/member:';
    const CACHE_KEY = 'trinityone.steward.members.' + (pub || '');
    const byPub = new Map();          // pubkey -> { pubkey, npub, name, picture, count, lastTs, firstTs, joined }
    const profSubs = new Map();       // pubkey -> kind-0 sub (resolve display name)
    // paint the last-known roster instantly so the Members list doesn't flash empty→list on reload
    try { const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); if (Array.isArray(cached)) { cached.forEach(m => { if (m && m.pubkey) byPub.set(m.pubkey, m); }); if (cached.length) onMembers(cached); } } catch {}
    const emit = () => { const arr = [...byPub.values()].sort((a, b) => ((b.lastTs || b.joined || 0) - (a.lastTs || a.joined || 0))); try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); } catch {} onMembers(arr); };
    const get = (pk) => byPub.get(pk) || { pubkey: pk, npub: npubEncode(pk), name: '', picture: '', count: 0, lastTs: 0, firstTs: Infinity, joined: 0 };
    const ensureProfile = (pk) => {
      if (profSubs.has(pk)) return;
      const s = pool.subscribeMany(relays(), [{ kinds: [0], authors: [pk] }], {
        onevent(e) { try { const meta = JSON.parse(e.content); const m = byPub.get(pk); if (m) { m.name = meta.name || meta.display_name || ''; m.picture = meta.picture || ''; m.nip05 = meta.nip05 || ''; m.av = meta.av || undefined; m.hasPhoto = !!(meta.av && meta.av.kind === 'photo' && meta.av.photo); emit(); } } catch {} },
        oneose() {},
      });
      profSubs.set(pk, s);
    };
    // kind-1 = participation (message count); kind-30078 member:<pub> = an explicit join (even if quiet)
    const sub = pool.subscribeMany(relays(), [{ kinds: [1], '#p': [pub] }, { kinds: [30078], '#p': [pub] }], {
      onevent(e) {
        if (e.pubkey === pub) return;                  // skip the church's own posts
        if (e.kind === 30078) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (!d.startsWith(MEMBER_D)) return;
          const left = e.tags.some(t => t[0] === 'deleted') || !e.content;
          const m = get(e.pubkey);
          if (left) { m.joined = 0; if (m.count === 0) { byPub.delete(e.pubkey); emit(); return; } }
          else { let j = e.created_at; try { j = JSON.parse(e.content).joined || e.created_at; } catch {} m.joined = j; }
          byPub.set(e.pubkey, m); ensureProfile(e.pubkey); emit(); return;
        }
        const m = get(e.pubkey);
        m.count++; if (e.created_at > m.lastTs) m.lastTs = e.created_at; if (e.created_at < m.firstTs) m.firstTs = e.created_at;
        byPub.set(e.pubkey, m); ensureProfile(e.pubkey); emit();
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} for (const s of profSubs.values()) { try { s.close(); } catch {} } };
  },

  // ---- church profile (kind-0): name etc. shown to members and in the console ----
  subscribeProfile(onProfile) {
    let latest = 0;
    // seed from the cached profile so a freshly-mounted view (e.g. Settings) is instantly consistent
    // with the others (avatar/picture shows everywhere at once, not only where it was just edited)
    try { if (lastProfile && Object.keys(lastProfile).length) onProfile(lastProfile); } catch {}
    const sub = pool.subscribeMany(relays(), [{ kinds: [0], authors: [pub] }], {
      onevent(e) { if (e.created_at < latest) return; latest = e.created_at; try { const p = JSON.parse(e.content); lastProfile = { ...lastProfile, ...p }; onProfile(p); try { window.dispatchEvent(new CustomEvent('steward-profile', { detail: lastProfile })); } catch (x) {} } catch {} },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- networks: a church declares it belongs to a wider group/network (its own npub) ----
  // The church publishes network:<networkPub> (p-tagged to the network). Members of the church
  // discover the network and can follow it — its groups/events/plans load like any church.
  joinNetwork(input) {
    if (!sk) return Promise.resolve(null);
    const np = toPubHex(input); if (!np) return Promise.resolve(null);
    const content = JSON.stringify({ joined: true });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', NETWORK_D + np], ['t', NET], ['p', np]], content }, sk)).then(() => ({ networkPub: np, npub: npubEncode(np) }));
  },
  leaveNetwork(networkPub) {
    if (!sk) return Promise.resolve(null);
    const np = toPubHex(networkPub) || networkPub;
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', NETWORK_D + np], ['t', NET], ['deleted', '1']], content: '' }, sk));
  },
  // create a brand-new network: generate its key, join it (so the relay lets it post here), then
  // publish the network's profile + a starter announcements channel (signed by the network key).
  // Returns { npub, mnemonic } — save/share these to run the network's own console later.
  async createNetwork(name) {
    if (!sk) return null;
    const m = generateSeedWords();
    const nsk = privateKeyFromSeedWords(m);
    const nPub = getPublicKey(nsk);
    saveNetKey({ pub: nPub, mnemonic: m, name: name || 'Network' });   // keep the key so this console can publish AS the network
    await window.Steward.joinNetwork(nPub);   // church joins first so the relay whitelists the network key
    await publish(finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: name || 'Network' }) }, nsk));
    await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', GROUP_D + 'net-announce'], ['t', NET]], content: JSON.stringify({ name: 'Announcements', kind: 'broadcast', sub: 'From ' + (name || 'the network'), icon: 'globe', accent: 'var(--clay)' }) }, nsk));
    window.dispatchEvent(new CustomEvent('steward-networks'));
    return { networkPub: nPub, npub: npubEncode(nPub), mnemonic: m };
  },
  // networks whose signing key is on THIS console -> [{ pub, npub, name }] (publish-as identities)
  ownedNetworks() { return netKeys().map(r => ({ pub: r.pub, npub: npubEncode(r.pub), name: r.name || 'Network' })); },
  // post a broadcast announcement AS an owned network (kind-1 into the net-announce channel)
  publishNetworkAnnouncement(networkPub, text) {
    const signer = skFor(networkPub); if (!signer || !text || !text.trim()) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['t', 'net-announce'], ['p', networkPub]], content: text.trim() }, signer));
  },
  // a network's broadcast announcements (most recent first) — for previewing on the console
  subscribeNetworkAnnouncements(networkPub, onPosts) {
    const np = toPubHex(networkPub) || networkPub;
    const byId = new Map();
    const emit = () => onPosts([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [1], authors: [np], '#t': ['net-announce'] }], {
      onevent(e) { byId.set(e.id, { id: e.id, text: e.content, ts: e.created_at }); emit(); }, oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // import an existing network's recovery phrase so this console can also publish as it
  importNetworkKey(mnemonic, name) {
    const mm = (mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (mm.split(' ').length < 12) throw new Error('Enter the full 12-word recovery phrase.');
    const nsk = privateKeyFromSeedWords(mm); const nPub = getPublicKey(nsk);
    saveNetKey({ pub: nPub, mnemonic: mm, name: name || 'Network' });
    window.dispatchEvent(new CustomEvent('steward-networks'));
    return { networkPub: nPub, npub: npubEncode(nPub) };
  },
  // every identity this console can publish as: the church + any owned networks + any church we STEWARD
  identities() {
    const held = new Set([churchPub, ...netKeys().map(r => r.pub)]);   // keys we HOLD — never also list them as "stewarded"
    return [
      { kind: 'church', pub: churchPub, npub: churchPub ? npubEncode(churchPub) : '' },
      ...netKeys().map(r => ({ kind: 'network', pub: r.pub, npub: npubEncode(r.pub), name: r.name || 'Network' })),
      ...[...stewardedChurches.entries()].filter(([cp]) => !held.has(cp)).map(([cp, m]) => ({ kind: 'steward', pub: cp, npub: npubEncode(cp), name: (m && m.name) || 'Church' })),
    ];
  },
  // switch the WHOLE console between the church, an owned network, or a church we steward (delegated) —
  // the active signing+reading identity. Subscriptions are keyed on activePub, so the dashboard re-renders.
  setActiveIdentity(targetPub) {
    const tp = toPubHex(targetPub) || targetPub || churchPub;
    if (tp === churchPub) { sk = churchSk; pub = churchPub; actingChurch = ''; }
    else if (stewardedChurches.has(tp)) { sk = churchSk; pub = tp; actingChurch = tp; }   // delegated: OUR key signs, church's context reads
    else {
      const rec = netKeys().find(x => x.pub === tp);
      if (!rec) return false;
      try { sk = privateKeyFromSeedWords(rec.mnemonic); pub = getPublicKey(sk); actingChurch = ''; } catch { return false; }
    }
    lastProfile = {};   // don't carry one identity's profile fields into the other's edits
    window.Steward.pubkey = pub; window.Steward.npub = npubEncode(pub); window.Steward.activePub = pub;
    window.Steward.actingChurch = actingChurch;   // UI reads this to show "acting as steward" + hide owner-only controls
    window.dispatchEvent(new CustomEvent('steward-identity', { detail: { pub, actingChurch } }));
    return true;
  },
  isViewingNetwork() { return pub !== churchPub && !actingChurch; },
  isDelegated() { return !!actingChurch; },
  // discover churches whose owner-signed roster lists OUR key → we can act as their steward. Re-emits on change.
  subscribeStewardedChurches(cb) {
    const me = churchPub;
    const CACHE = 'trinityone.steward.stewarded.' + (me || '');
    const save = () => { try { lsSet(CACHE, JSON.stringify([...stewardedChurches.entries()].map(([cp, m]) => ({ cp, name: (m && m.name) || '' })))); } catch {} };
    // paint instantly from the last-known list (with real names) so the switcher doesn't flash "Church"/empty on launch
    const _ownedPubs = new Set([me, ...netKeys().map(r => r.pub)]);   // never resurrect a church/network we HOLD as "stewarded"
    try { (JSON.parse(lsGet(CACHE) || '[]') || []).forEach(c => { if (c && c.cp && !_ownedPubs.has(c.cp)) stewardedChurches.set(c.cp, { name: c.name || 'Church' }); }); } catch {}
    // resolve a stewarded church's real name from its kind-0 profile (kept open so a rename follows live)
    const nameSubs = new Map();
    const resolveName = (cp) => {
      if (nameSubs.has(cp)) return;
      nameSubs.set(cp, pool.subscribeMany(relays(), [{ kinds: [0], authors: [cp] }], {
        onevent(e) { try { const nm = (JSON.parse(e.content).name) || ''; if (nm && stewardedChurches.has(cp) && (stewardedChurches.get(cp).name !== nm)) { stewardedChurches.set(cp, { name: nm }); save(); cb([...stewardedChurches.keys()]); } } catch {} },
        oneose() {},
      }));
    };
    if (stewardedChurches.size) cb([...stewardedChurches.keys()]);   // emit the cached list immediately
    [...stewardedChurches.keys()].forEach(resolveName);              // refresh names for cached entries
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(STEWARDS_D)) return;
        const cp = d.slice(STEWARDS_D.length);
        if (cp === me) return;   // our own roster doesn't make us our own steward
        let listed = false;
        if (!(e.tags.some(t => t[0] === 'deleted') || !e.content)) { try { listed = ((JSON.parse(e.content).pubkeys) || []).includes(me); } catch {} }
        const had = stewardedChurches.has(cp);
        if (listed && !had) { stewardedChurches.set(cp, { name: 'Church' }); save(); resolveName(cp); cb([...stewardedChurches.keys()]); }
        else if (!listed && had) { stewardedChurches.delete(cp); save(); if (actingChurch === cp) window.Steward.setActiveIdentity(churchPub); cb([...stewardedChurches.keys()]); }
      },
      oneose() { cb([...stewardedChurches.keys()]); },
    });
    return () => { try { sub.close(); } catch {} for (const s of nameSubs.values()) { try { s.close(); } catch {} } };
  },
  // this church's network memberships -> [{ networkPub, npub }]
  subscribeNetworks(onNetworks) {
    const byId = new Map();
    const emit = () => onNetworks([...byId.values()]);
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(NETWORK_D)) return; const np = d.slice(NETWORK_D.length); if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(np); emit(); return; } byId.set(np, { networkPub: np, npub: npubEncode(np) }); emit(); },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // resolve a network's display name (its kind-0 profile)
  subscribeNetworkProfile(networkPub, onProfile) {
    const np = toPubHex(networkPub) || networkPub; let latest = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [0], authors: [np] }], {
      onevent(e) {
        if (e.created_at < latest) return; latest = e.created_at;
        let prof; try { prof = JSON.parse(e.content); } catch { return; }
        onProfile(prof);
        // self-heal: keep an owned network's locally-stored name in sync with its published profile,
        // so the identity switcher + announce composer follow a rename instead of showing the old name.
        if (prof && prof.name) { const rec = netKeys().find(x => x.pub === np); if (rec && rec.name !== prof.name) { saveNetKey({ ...rec, name: prof.name }); window.dispatchEvent(new CustomEvent('steward-networks')); } }
      }, oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- relays: the church's relay(s) — real status, not a mock ----
  relayList() { return relays(); },
  ownRelay() { return ownRelay(); },
  extraRelays() { return extraRelays(); },
  // register THIS church with the relay's write policy so it stops rejecting our publishes. Needs the
  // relay's admin token (the steward running the relay has it — relay/admin.json / installer output).
  // Idempotent; works cross-origin (the relay's /config sends CORS + is token-gated).
  configBase() { return ownRelay().replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/relay\/?$/i, ''); },
  async registerWithRelay(token, name) {
    const url = window.Steward.configBase() + '/config';
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + String(token || '').trim() },
      body: JSON.stringify({ addChurch: { npub: window.Steward.npub, name: name || '' } }),
    });
    if (r.status === 401) throw new Error('That admin token wasn’t accepted.');
    if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch {} throw new Error(m || ('the relay responded ' + r.status)); }
    return r.json();
  },
  // self-register this church with the shared pool relays by PROVING key ownership (NIP-98 signed by the
  // church key) — no admin token, and a church can only ever register its own npub. Called automatically
  // on console load, so onboarding a new church needs zero manual relay setup.
  async selfRegister(name) {
    if (!churchSk || !churchPub) return;
    const np = npubEncode(churchPub);
    const bases = new Set([window.Steward.configBase()]);
    for (const r of CANONICAL_RELAYS) bases.add(r.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/relay\/?$/i, ''));
    for (const base of bases) {
      const url = base + '/config';
      try {
        const auth = finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', url], ['method', 'POST']], content: '' }, churchSk);
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addChurch: { npub: np, name: name || '' }, auth }) });
      } catch (e) {}
    }
  },
  // add a public relay the church ALSO publishes to (redundancy if the self-hosted relay is offline)
  addRelay(input) {
    const url = normRelay(input);
    if (!url || url === ownRelay()) return false;
    const cur = extraRelays(); if (cur.includes(url)) return false;
    lsSet(RELAYS_LS, JSON.stringify([...cur, url]));
    window.dispatchEvent(new CustomEvent('steward-relays'));
    return url;
  },
  removeRelay(url) {
    const next = extraRelays().filter(r => r !== url);
    lsSet(RELAYS_LS, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('steward-relays'));
    return true;
  },
  // probe each relay with a throwaway WS; resolves [{ url, status:'on'|'off', ms }]
  relayStatus() {
    return Promise.all(relays().map(url => new Promise(res => {
      let done = false; const t0 = Date.now();
      const finish = (status) => { if (done) return; done = true; try { ws.close(); } catch {} res({ url, status, ms: status === 'on' ? Date.now() - t0 : null }); };
      let ws;
      try { ws = new WebSocket(url); } catch { return res({ url, status: 'off', ms: null }); }
      const to = setTimeout(() => finish('off'), 2500);
      ws.onopen = () => { clearTimeout(to); finish('on'); };
      ws.onerror = () => { clearTimeout(to); finish('off'); };
    })));
  },
  // live count of the church's footprint on the relay (its own events + everything addressed to it),
  // plus how many of those are the church's own announcements (kind-1 it authored)
  subscribeStats(onStats) {
    const ids = new Set(), ann = new Set();
    const emit = () => onStats({ events: ids.size, announcements: ann.size });
    const sub = pool.subscribeMany(relays(), [{ authors: [pub] }, { '#p': [pub] }], {
      onevent(e) { ids.add(e.id); if (e.kind === 1 && e.pubkey === pub) ann.add(e.id); emit(); },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // a live, recent activity feed derived from real events (groups, joins, posts) — newest first
  subscribeActivity(onActivity, max = 12) {
    const byId = new Map();
    const emit = () => onActivity([...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, max));
    const sub = pool.subscribeMany(relays(), [{ kinds: [1, 30078], authors: [pub] }, { kinds: [1, 30078], '#p': [pub] }], {
      onevent(e) {
        const own = e.pubkey === pub;
        let item = null;
        if (e.kind === 30078) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          const deleted = e.tags.some(t => t[0] === 'deleted') || !e.content;
          // gid lets the dashboard open the group's chat straight from the activity row
          if (d.startsWith(GROUP_D)) { let n = ''; try { n = JSON.parse(e.content).name; } catch {} item = { ic: 'chat', tint: 'sage', text: deleted ? 'A group was removed' : `Group “${n || 'untitled'}” ${own ? 'created' : 'updated'}`, gid: deleted ? '' : d.slice(GROUP_D.length) }; }
          else if (d.startsWith('trinityone/member:')) { if (!deleted) item = { ic: 'pray', tint: 'sage', text: 'A new member joined', to: 'members' }; }
          else if (d.startsWith(FUND_D)) { let n = ''; try { n = JSON.parse(e.content).name; } catch {} item = { ic: 'gift', tint: 'gold', text: deleted ? 'A fund was removed' : `Fund “${n || ''}” updated`, to: 'finance' }; }
        } else if (e.kind === 1) {
          const g = (e.tags.find(t => t[0] === 't' && t[1] !== NET) || [])[1] || '';
          if (own) item = { ic: 'send', tint: 'gold', text: 'You posted an announcement', gid: g || '' };
          else item = { ic: 'chat', tint: 'clay', text: 'New message in a group', gid: g || '' };
        }
        if (item) { byId.set(e.id, { id: e.id, ts: e.created_at, ...item }); emit(); }
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- join flow: members follow the church by its npub ----
  // The member app at the gateway root reads ?follow=<npub> and follows the church.
  joinUrl() {
    const np = window.Steward.npub || '';
    const o = (typeof location !== 'undefined' && location.origin) || '';
    // Join links/QRs must use a stable PUBLIC url a congregant can actually reach. The Capacitor APK's
    // origin is `https://localhost` (and a self-hosted box may be a LAN IP) — those pass a naive https
    // check but are useless on someone else's phone, so treat them as non-public and fall back.
    const PUBLIC_BASE = 'https://app.trinityone.church';   // canonical public member-app URL (the relay travels separately in &relay=)
    const isPublic = /^https:\/\//i.test(o) && !/^https:\/\/(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(o);
    const base = isPublic ? o : PUBLIC_BASE;   // the member-app URL members open
    // carry the church's REAL relay so a member who follows from anywhere connects to the right place.
    // ownRelay() is the church's relay (a TrinityOne community node on a static host, or the box's own
    // relay when self-hosted) — NOT the page origin, which on a CDN host (pages.dev) has no relay.
    const relay = ownRelay();
    return base + '/?follow=' + np + '&relay=' + encodeURIComponent(relay);
  },
  // a short, human-shareable code (the npub itself — paste-able into the member app's "Follow a church")
  joinCode() { return window.Steward.npub || ''; },
  // a real QR encoding the join URL; scan with a phone camera to open the app already following.
  joinQR() {
    const qr = qrcode(0, 'M'); qr.addData(window.Steward.joinUrl()); qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  },
  // generic QR (used for the handoff code) — any text → scalable SVG string
  qrSVG(text) {
    try { const qr = qrcode(0, 'M'); qr.addData(String(text || '')); qr.make(); return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
    catch (e) { return ''; }
  },
};

window.Steward.init();
