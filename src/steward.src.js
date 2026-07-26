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
import { finalizeEvent, getPublicKey, generateSecretKey } from 'nostr-tools/pure';
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';
import { encrypt as nip04encrypt, decrypt as nip04decrypt } from 'nostr-tools/nip04';
import { encrypt as nip44e, decrypt as nip44d, getConversationKey as nip44ck } from 'nostr-tools/nip44';
import qrcode from 'qrcode-generator';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

// ---- backup encryption: seal an export to the CHURCH KEY, so only the church private key can open it ----
// Hybrid ECIES: a throwaway ephemeral key does an ECDH (via NIP-44's key agreement) with the church PUBLIC
// key, yielding a one-time 256-bit secret used to AES-256-GCM the whole archive. The ephemeral PUBLIC key
// rides in the envelope; the church-key holder re-derives the same secret (ECDH is symmetric) to decrypt.
// No passphrase, no PIN — a leaked/seized/cloud-stored file is opaque to anyone without the church's private
// key (which the owner already safeguards via the 12-word recovery phrase). See exportChurchData / _openBackup.
// (base64 helpers _b64 / _b64ToU8 are defined below and used at call time.) `fmt` records what the sealed
// bytes are — 'jsonl' (events only) or 'zip' (events + media container) — so restore knows how to read them.
async function _sealToChurch(bytes, churchPubHex, fmt) {
  if (!(globalThis.crypto && globalThis.crypto.subtle)) throw new Error('This browser can’t encrypt — turn encryption off to export, or use the app.');
  const esk = generateSecretKey();                                  // throwaway ephemeral key — never stored
  const epk = getPublicKey(esk);
  const convKey = nip44ck(esk, churchPubHex);                       // ECDH(ephemeral, church) -> 32-byte shared secret
  const key = await crypto.subtle.importKey('raw', convKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return JSON.stringify({ trinityone_backup: 'encrypted-v1', alg: 'nip44-ecdh-secp256k1+aes-256-gcm', fmt: fmt || 'jsonl', epk, iv: _b64(iv), ct: _b64(ct) });
}
async function _openBackup(envelope) {                               // church-key holder decrypts -> { bytes, fmt } (restore + verify)
  if (!sk) throw new Error('No church key on this device');
  const e = (typeof envelope === 'string') ? JSON.parse(envelope) : envelope;
  if (!e || e.trinityone_backup !== 'encrypted-v1') throw new Error('Not an encrypted TrinityOne backup');
  const convKey = nip44ck(sk, e.epk);                                // ECDH is symmetric: (church, ephemeral) == (ephemeral, church)
  const key = await crypto.subtle.importKey('raw', convKey, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _b64ToU8(e.iv) }, key, _b64ToU8(e.ct)));
  return { bytes: pt, fmt: e.fmt || 'jsonl' };
}
// a fresh NIP-98 (kind-27235) proof signed by the church key, bound to `url` + method — authorises /export,
// /export-media, per-blob pulls (GET) and /import (POST). (sk/pub are the module's active church identity.)
function _nip98(url, method) { return 'Nostr ' + btoa(JSON.stringify(finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', url], ['method', method || 'GET'], ['church', pub]], content: '' }, sk))); }
// restore one media blob to `base` with a signed kind-24242 upload auth (the church key passes _blobUploader).
// (_sha256hex is defined below and used at call time.)
async function _putBlob(base, bytes) {
  const sha = await _sha256hex(bytes);
  const native = !!(typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const auth = 'Nostr ' + btoa(JSON.stringify(finalizeEvent({ kind: 24242, created_at: now(), tags: [['t', 'upload'], ['x', sha], ['expiration', String(now() + 600)]], content: 'upload' }, sk)));
  const h = { Authorization: auth, 'Content-Type': 'application/octet-stream' };
  let body = bytes; if (native) { h['X-Blob-B64'] = '1'; body = _b64(bytes); }   // CapacitorHttp mangles raw binary -> base64 transport
  try { const r = await fetch(base + '/blob', { method: 'PUT', headers: h, body }); return r.ok; } catch { return false; }
}

const NET = 'trinityone';
const KEY_LS = 'trinityone.steward.church-key';     // localStorage seed (pilot)
// H4: which (church key, relay) pairs this device has already self-registered — registration is a SETUP
// step, not a heartbeat. Without this every console mount re-POSTed addChurch to every canonical relay.
const SELFREG_KEY = 'trinityone.steward.selfreg';
const FUND_D = 'trinityone/fund:';
// steward-defined chat message tags (Testimony, Praise, …) — a single church-signed doc alongside the
// built-in "Prayer request". id/icon/accent are validated against fixed allowlists on write AND read so a
// forged doc can never inject CSS or an arbitrary icon. `prayer` (+ the built-in card kinds) are reserved.
const MSGTAGS_D = 'trinityone/msgtags';
const MSGTAG_ICONS = ['pray', 'sparkle', 'heart', 'flame', 'hand', 'gift', 'music'];
const MSGTAG_ACCENTS = ['gold', 'sage', 'clay', 'sky', 'plum', 'teal'];
const MSGTAG_MAX = 6;
// 'prayer' is NOT reserved — it's the default tag, editable/removable like any other. Only the built-in
// message CARD kinds are off-limits (they render as their own bubbles, not as flags).
const MSGTAG_RESERVED = ['verse', 'devotional', 'note', 'poll'];
const PRAYER_DEFAULT = { id: 'prayer', label: 'Prayer request', icon: 'pray', accent: 'gold' };
function _msgTagSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24); }
function _sanitizeMsgTags(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [], seen = new Set();
  for (const t of arr) {
    if (!t || typeof t !== 'object') continue;
    const label = String(t.label || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!label) continue;
    const id = _msgTagSlug(t.id || label);
    if (!id || MSGTAG_RESERVED.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, icon: MSGTAG_ICONS.includes(t.icon) ? t.icon : 'sparkle', accent: MSGTAG_ACCENTS.includes(t.accent) ? t.accent : 'clay' });
    if (out.length >= MSGTAG_MAX) break;
  }
  return out;
}
const GROUP_D = 'trinityone/group:';
const SAFETY_D = 'trinityone/safetycheck:';   // the church's active safety check ("are you safe?")
const SAFE_D = 'trinityone/safe:';            // a member's response (content NIP-44-encrypted to the check's creator)
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
const GUARDNOTICE_D = 'trinityone/guardnotice:'; // safeguarding v2: church->parent NOTICE that they were linked to a child, d=guardnotice:<parentpub>, p-tagged + content NIP-44-encrypted to the parent (the child link never appears in cleartext)
const SERMON_D = 'trinityone/sermon:';   // Phase 5 Tier 2: a self-hosted media item referencing a content-addressed blob (sha256 + host)
const PINSERMON_D = 'trinityone/pinsermon:';   // the church's currently-featured sermon → member Today card + notification (one per church)
const BACKUPMETA_D = 'trinityone/backup-meta:';   // church-wide backup state (last-backup time + reminder cadence) → same nudge on every steward/device
// ── CARE KEY (SECURITY-AUDIT-2026-07-20 H3) ───────────────────────────────────────────────────────
// A care need NAMES a vulnerable person and, by the notes field's own placeholder, carries their address, a
// health inference and a "who not to ring after 9pm" window. Manna already treats this class of doc as
// must-encrypt; Care shipped it in cleartext. Manna's PRINCIPLE applies, its MECHANISM doesn't — Manna
// self-encrypts to the church key, but ordinary members must READ a need to volunteer for it. So this is
// the per-church-key-wrapped-per-member envelope (the media/group-key shape), sealing only the identifying
// half; type and dates stay clear so the slot grid renders without the key.
//
// A FIRST ATTEMPT AT THIS WAS REVERTED because the key lifecycle lost data. Both causes are fixed here:
//  1. It minted whenever _careKeyHex was null — but the subscription that populates it is a network
//     round-trip, so the ordinary outcome on console open was "mint a fresh key", orphaning every need
//     already sealed. We now mint ONLY after positively observing that no envelope exists (_careKeyChecked),
//     and never when one exists that we simply can't open.
//  2. It unwrapped with sk/pub. In DELEGATED mode `pub` is the church and `sk` is the steward's own key, so
//     the lookup could never succeed — every console open minted and published a competing envelope under a
//     different author, which replKey() does not replace. Use churchSk/churchPub (this device's own key),
//     exactly as _ingestGroupKey does above.
// The LOCAL calendar day. `toISOString().slice(0,10)` is the UTC day and is wrong for a human 'today':
// east of Greenwich it reads as yesterday for part of every evening (that shipped care needs dated
// yesterday, and a kids check-in roll that emptied mid-service). Fine for timestamps/filenames only.
const _todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const CAREKEY_D = 'trinityone/carekey:';
const CARENEED_D = 'trinityone/care:';   // a care need — its sealed half depends on the care key existing
let _careKeyHex = null;          // this device's copy of the church care key (the CURRENT one = ring[0])
let _careKeyRing = [];           // current key first, then superseded ones — so rotation never orphans old ciphertext
let _careKeyDocKeys = null;      // the envelope's wrapped-per-member map (to detect who is missing)
let _careKeyRev = 0;             // envelope revision — rotation is NOT wired yet, but readers must tolerate it
let _careKeyChecked = false;     // have we actually LOOKED for an envelope? mint gate — see (1) above
let _careRoster = new Set();     // the church's current steward pubkeys — who may author the envelope
const MEDIAKEY_D = 'trinityone/mediakey:';   // Tier 2 encryption: a per-church AES-GCM media key, wrapped to each member (mirrors the group-key envelope)
let _mediaKeyHex = null;                       // this device's cached copy of the church media key (= ring[0])
let _mediaKeyRing = [];                        // current key first, then superseded — rotation must never orphan an encrypted sermon
let _mediaKeyDocKeys = null;                   // the latest media-key doc's wrapped-per-member map (to detect members not yet keyed)
async function _sha256hex(u8) { const d = await crypto.subtle.digest('SHA-256', u8); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); }
const JOINPOLICY_D = 'trinityone/joinpolicy:'; // join policy {approval:bool}, d=joinpolicy:<churchpub>
const ADMITTED_D = 'trinityone/admitted:';   // approved-members allowlist (when approval is on), d=admitted:<churchpub>
const RESEAT_D = 'trinityone/reseat:';       // church-vouched "the member who was <old> is now <new>", d=reseat:<churchpub>
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
const _b64 = (u8) => { let s = ''; const c = 0x8000; for (let i = 0; i < u8.length; i += c) s += String.fromCharCode.apply(null, u8.subarray(i, i + c)); return btoa(s); };   // Uint8Array -> base64 (chunked, stack-safe)
const _isNative = () => !!(typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
// the church unwraps its OWN entry from a key envelope (it wraps the key to itself too), and caches it
function stewIngestKey(e) {
  const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(GROUPKEY_D)) return;
  const gid = d.slice(GROUPKEY_D.length);
  if ((_senvTs[gid] || 0) > (e.created_at || 0)) return;   // ignore an older envelope arriving late
  _senvTs[gid] = e.created_at || 0;
  try { const env = JSON.parse(e.content || '{}'); _srev[gid] = env.rev || 1; const mine = env.keys && churchPub && env.keys[churchPub]; if (mine && churchSk) _skeys[gid] = _unhex(nip44d(mine, nip44ck(churchSk, e.pubkey))); } catch {}
}
const now = () => Math.floor(Date.now() / 1000);
// Author discipline for the church's replaceable AUTHORITY docs (blocklist, admitted, stewards, guardians,
// joinpolicy, safeguarding). Each subscribes with a second `#church` filter that matches ANY author, and
// used to trust the d-tag alone — so a forged copy on a non-enforcing relay (a public one a church adds)
// was accepted as truth. Mirror the relay's accept() rules EXACTLY (gateway.mjs ~1028-1054): owner-only
// docs must be the church key; the steward-writable ones (joinpolicy/admitted/nophoto) also accept a
// current rostered steward. The future-clamp is separate and load-bearing: with newest-wins in place, a
// forgery dated far in the future can never be beaten on created_at, so without the clamp it would PIN
// over the church's real doc for the life of the subscription. `pub` is the church key in view; `_careRoster`
// is the live steward set (kept current by subscribeStewards → setCareRoster).
const _CLOCK_SKEW = 600;   // 10 min — a real clock difference; a forgery uses a far-future stamp
const _authFuture = (e) => e.created_at > now() + _CLOCK_SKEW;
const _byChurch = (e) => e.pubkey === pub;
const _byChurchOrSteward = (e) => e.pubkey === pub || _careRoster.has(e.pubkey);

// Does this church already have care needs on the relay? If so a care key MUST exist (a need can't be sealed
// without one), so minting a fresh key would orphan every one of them — refuse. Only ever runs on the mint
// path (once per church in its life), so the bounded scan is cheap. An unreachable relay returns no rows and
// this says "no needs" — but the _relayAuthed guard has already blocked that case before we get here.
// GUARD FOR WHOLE-LIST REPLACEMENTS (data-integrity critical, AUDIT-2026-07-24).
// The church's authority lists — minors, cleared adults, guardians, blocklist, admitted members, stewards —
// are each a SINGLE replaceable document, and every edit is read-modify-write: the console takes the list it
// currently holds, adds or removes one entry, and republishes the whole thing. Those lists are private, so an
// unauthenticated or unreachable relay serves NOTHING and the console's view is legitimately empty — the same
// empty it would see for a church that has no list at all. Marking one child as a minor in that window
// publishes a one-entry list over the real one, and the previous version is hard-deleted: every OTHER child
// silently stops being a minor and the relay stops blocking adult↔minor DMs for them. Same shape unbans every
// blocked member, returns the whole congregation to "waiting for approval", or revokes every steward.
// Fail CLOSED: refuse the write while our view is untrustworthy. A refused edit is visible and retryable; a
// wiped safeguarding list is silent and permanent. (Sibling of the care-key mint gate above.)
function _requireTrustedView(what) {
  if (_relayAuthed) return;
  const err = new Error('Can’t save the ' + what + ' yet — this device hasn’t finished connecting to your church’s relay, so it can’t see the current list. Wait a moment and try again.');
  try { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what, message: err.message } })); } catch (e) {}
  throw err;
}
async function _churchHasCareNeeds() {
  const cp = actingChurch || pub; if (!cp) return false;
  try {
    const evs = await pool.querySync(relays(), [{ kinds: [30078], authors: [cp], '#t': [NET], limit: 400 },
                                                { kinds: [30078], '#church': [cp], '#t': [NET], limit: 400 }]);
    return (evs || []).some(e => {
      const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
      return d.startsWith(CARENEED_D) && !e.tags.some(t => t[0] === 'deleted') && !!e.content;
    });
  } catch (e) { return false; }
}
// Care-key envelope handling, factored out so both the live subscription AND the pending-buffer re-check
// share one code path. See the mint-gate race notes at the top of this file (care-key section).
const _careKeyAuthed = (e) => { const cp = actingChurch || pub; return e.pubkey === cp || _careRoster.has(e.pubkey); };
function _ingestCareKeyEnv(e) {
  try {
    const o = JSON.parse(e.content || '{}');
    if ((o.rev || 1) < _careKeyRev) return;                  // a lagging relay must not resurrect an older envelope
    _careKeyDocKeys = o.keys || null; _careKeyRev = o.rev || 1;
    const mine = o.keys && churchPub && o.keys[churchPub];
    // KEY RING (audit 2026-07-24). Rotating the care key when a member is removed would, on its own, make every
    // previously-sealed need unreadable — the exact permanent loss this codebase already suffered once. So the
    // envelope carries the CURRENT key followed by every previous one, wrapped together per member: seal with
    // the newest, open with whichever still works. A wrapped value is therefore a JSON array now, but older
    // envelopes hold a bare hex string — read both, or a church mid-upgrade loses its care records.
    if (mine && churchSk) {
      const plain = nip44d(mine, nip44ck(churchSk, e.pubkey));
      let ring = null; try { const p = JSON.parse(plain); if (Array.isArray(p)) ring = p.filter(k => typeof k === 'string' && k); } catch (x) {}
      _careKeyRing = ring && ring.length ? ring : [plain];
      _careKeyHex = _careKeyRing[0];
    }
  } catch (x) {}
  _careKeyChecked = true;
}
// An envelope from an author we can't YET verify (a delegated steward whose roster entry hasn't loaded — the
// roster arrives via a separate subscription and a React round-trip) is BUFFERED, not dropped: dropping it and
// then minting a fresh key is exactly how two competing care keys arise and orphan every sealed need. It
// blocks minting until it is either adopted (the roster loads and confirms the author) or expires as a
// forgery. TTL bounds a spammed forgery from blocking minting forever.
const _CAREKEY_PENDING_TTL = 12000;
let _careKeyPending = [];
function _reCheckCareKeyPending() {
  const nowMs = Date.now();
  _careKeyPending = _careKeyPending.filter(p => nowMs - p.at < _CAREKEY_PENDING_TTL);   // expired → treat as forgery, drop
  for (const p of _careKeyPending.slice()) {
    if (_careKeyAuthed(p.e)) { _ingestCareKeyEnv(p.e); _careKeyPending = _careKeyPending.filter(x => x !== p); }
  }
}
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
  // Suite "Console only" mode (launcher ?host=off): this box isn't the church's relay — run on the community pool.
  try { if (lsGet('trinityone.hostoff') === '1') return CANONICAL_RELAY; } catch (e) {}
  const l = (typeof location !== 'undefined') ? location : null;
  if (!l || !l.host) return CANONICAL_RELAY;
  // a static CDN host (GitHub Pages etc.) has no relay on its origin → publish to the shared pool
  if (/\.(github\.io|pages\.dev|netlify\.app)$/i.test(l.host)) return CANONICAL_RELAY;
  return ((l.protocol === 'https:') ? 'wss://' : 'ws://') + l.host + '/relay';
}
// Stick/clear the Suite "Console only" flag from the launcher: ?host=off sets it (church runs on community
// relays), ?host=on or the full-suite ?relayapp=1 clears it (church self-hosts on this box).
try { const _sp = new URLSearchParams(location.search); const _h = _sp.get('host'); if (_h === 'off') lsSet('trinityone.hostoff', '1'); else if (_h === 'on' || _sp.get('relayapp') === '1') lsSet('trinityone.hostoff', ''); } catch (e) {}
function extraRelays() {
  try { const a = JSON.parse(lsGet(RELAYS_LS) || '[]'); return Array.isArray(a) ? a.filter(Boolean) : []; } catch { return []; }
}
// Named-relay auto-follow: a self-hosted relay behind the free Cloudflare tunnel gets a NEW url every restart,
// so a raw url added to the relay list goes dead. When a church connects a relay BY NAME we remember {name,url};
// this re-resolves those names against the directory in the background and swaps the stale url for the live one,
// so the connection just follows the rotating tunnel instead of breaking. (The directory always maps a claimed
// name → the relay's current url — the relay re-claims it on every go-public/boot.)
const NAMES_LS = 'trinityone.steward.relay-names';
const DIRECTORY_URL = CANONICAL_RELAY.replace(/^ws/i, 'http').replace(/\/relay\/?$/i, '');   // wss://app…/relay → https://app…
// The directory is MIRRORED across relays, so resolve/discover against several — this church's own relay first
// (fastest + works even if the shared hosts are blocked), then the shared hosts. First to answer wins.
function _dirBases() {
  const out = [];
  for (const r of [ownRelay(), ...CANONICAL_RELAYS]) {
    const b = String(r || '').replace(/^ws/i, 'http').replace(/\/relay\/?$/i, '');
    if (/^https?:\/\/.+/i.test(b) && !out.includes(b)) out.push(b);
  }
  return out;
}
async function resolveRelayName(handle) {
  const h = String(handle || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (!h) return null;
  for (const base of _dirBases()) {
    // 6s hard timeout so a black-holed directory host (common on a censored network) can't stall the whole
    // resolve — we just fall through to the next mirror.
    try { const r = await fetch(base + '/relay-names/resolve/' + encodeURIComponent(h), { cache: 'no-store', signal: AbortSignal.timeout(6000) }); if (r.ok) { const j = await r.json(); if (j && j.url) return j; } } catch (e) {}
  }
  return null;
}
function getNamedRelays() { try { const a = JSON.parse(lsGet(NAMES_LS) || '[]'); return Array.isArray(a) ? a.filter(e => e && e.name) : []; } catch { return []; } }
function setNamedRelays(a) { try { lsSet(NAMES_LS, JSON.stringify(a)); } catch (e) {} }
function _writeExtraRelays(list) { try { lsSet(RELAYS_LS, JSON.stringify([...new Set(list.filter(Boolean))])); window.dispatchEvent(new CustomEvent('steward-relays')); } catch (e) {} }
let _refreshingNames = false;
async function refreshNamedRelays() {
  if (_refreshingNames) return;
  const named = getNamedRelays(); if (!named.length) return;
  _refreshingNames = true;
  let extra = extraRelays(), changed = false;
  for (const entry of named) {
    try {
      const j = await resolveRelayName(entry.name); const newUrl = normRelay(j && j.url);
      if (newUrl && newUrl !== entry.url) { extra = extra.filter(u => u !== entry.url); extra.push(newUrl); entry.url = newUrl; changed = true; }
    } catch (e) {}
  }
  if (changed) { _writeExtraRelays(extra); setNamedRelays(named); }
  _refreshingNames = false;
}
// keep named relays pointed at the live url: on load, then every 90s, and whenever the app regains focus
try { setTimeout(refreshNamedRelays, 2500); setInterval(refreshNamedRelays, 90000); window.addEventListener('focus', refreshNamedRelays); } catch (e) {}
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
// ── Self-hosted "go public" (desktop Suite) ──────────────────────────────────────────────────────────
// In the Suite this console is served BY its own relay on loopback (ws://127.0.0.1…), which is useless in a
// member's invite. When the operator turns on the free Cloudflare tunnel the relay exposes a public wss (and
// auto-claims its directory name); we cache that here so joinUrl() shares the REACHABLE address, not loopback.
// The tunnel/name endpoints are admin-gated even on loopback (cloudflared proxies from 127.0.0.1, so the relay
// can't tell local from public by socket alone); the Suite discloses the token to a genuine same-machine request
// via /local-token — mirror the control panel and use it. All of this is inert off the loopback-served Suite.
const SELF_PUB_LS = 'trinityone.steward.self-public-relay';
function ownIsLoopback() { return /^wss?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)(:|\/)/i.test(ownRelay()); }
function selfPublicRelay() { try { return normRelay(lsGet(SELF_PUB_LS) || ''); } catch { return ''; } }
// pass '' to CLEAR — the Cloudflare quick-tunnel url rotates every restart, so a cached url is dead once the
// tunnel is reported down; keeping it would let joinUrl() embed a URL that resolves nowhere. Dispatch on change.
function setSelfPublicRelay(wss) { try { const v = normRelay(wss || ''); if (v !== normRelay(lsGet(SELF_PUB_LS) || '')) { lsSet(SELF_PUB_LS, v); window.dispatchEvent(new CustomEvent('steward-relays')); } } catch (e) {} }
// The relay's STABLE directory name (e.g. "grace-city"), cached alongside the tunnel url. joinUrl() embeds it so
// a printed invite/QR survives a tunnel-URL rotation: the relay re-claims name→current-url on every restart, and
// the member resolves the name at follow time. Only meaningful on the loopback-served desktop Suite.
const SELF_NAME_LS = 'trinityone.steward.self-relay-name';
function selfRelayName() { try { return String(lsGet(SELF_NAME_LS) || '').trim(); } catch { return ''; } }
function setSelfRelayName(n) { try { const v = String(n || '').trim().toLowerCase(); if (v !== selfRelayName()) lsSet(SELF_NAME_LS, v); } catch (e) {} }
let _localToken = null;
async function localAdminToken() {
  if (_localToken) return _localToken;
  if (!ownIsLoopback()) return '';
  try { const r = await fetch('/local-token', { cache: 'no-store' }); if (!r.ok) return ''; const j = await r.json(); _localToken = (j && j.token) || ''; return _localToken; } catch (e) { return ''; }
}
function _authHdr(tok) { return tok ? { 'Authorization': 'Bearer ' + tok } : {}; }
async function refreshSelfPublicRelay() {
  if (!ownIsLoopback()) return;
  try {
    const tok = await localAdminToken(); if (!tok) return;
    const r = await fetch('/tunnel/state', { cache: 'no-store', headers: _authHdr(tok), signal: AbortSignal.timeout(5000) });
    if (!r.ok) return;
    const j = await r.json(); const up = !!(j && j.running && j.wss);
    setSelfPublicRelay(up ? j.wss : '');
    // cache the stable directory name while public (for a durable invite); clear it when the tunnel is down
    if (up) { try { const nr = await fetch('/relay-names/mine', { cache: 'no-store', headers: _authHdr(tok), signal: AbortSignal.timeout(5000) }); if (nr.ok) { const nj = await nr.json(); setSelfRelayName((nj && nj.handle) || ''); } } catch (e) {} }
    else setSelfRelayName('');
  } catch (e) {}
}
try { setTimeout(refreshSelfPublicRelay, 1500); setInterval(refreshSelfPublicRelay, 60000); window.addEventListener('focus', refreshSelfPublicRelay); } catch (e) {}

function relays() {
  const own = ownRelay();
  const out = [own];
  // on a static CDN host the console has no relay of its own → fan out across the whole shared pool
  if (own === CANONICAL_RELAY) { for (const r of CANONICAL_RELAYS) { if (r && !out.includes(r)) out.push(r); } }
  for (const r of extraRelays()) { if (r && r !== own && !out.includes(r)) out.push(r); }
  return out;
}
// Phase 5 Tier 2: the media host = this relay's HTTPS origin (self-hosted blobs live beside the relay).
function _blobBase() { const r = ownRelay(); return r.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://').replace(/\/relay\/?$/i, ''); }
// FEDERATION Phase 3 — relay discovery for the steward console (mirrors the member engine). Probe a relay's
// NIP-11 doc for its trinityone capability/offer block; cached so each relay is probed once. Fail-closed.
const _relayInfoCache = new Map();
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
    } catch { return null; }
  })();
  _relayInfoCache.set(wssUrl, p);
  return p;
}
// find relays that OFFERED to host new churches: enforcing + open + not full + reachable. Ranked region-first,
// then lightest load. Empty when nothing is open (e.g. the pilot today, where a8 doesn't advertise an offer).
// bootstrap discovery seed: relays to PROBE for offers that a new church doesn't already know. Kept small +
// extensible (setDiscoverySeed) and discovery-only — it never carries church content, so it's not a central
// point (FEDERATION-PLAN guardrail). Empty on the pilot (a8 isn't offering), so auto-pick is a safe no-op.
let _discoverySeed = [];
async function discoverRelayOffers(seedExtra, region) {
  // Global discovery: ask the shared directory which relays have advertised they're open to host, so we can
  // surface relays this church has NEVER added. Merge with the local seed; each candidate is still NIP-11
  // probed below, so a stale/dishonest directory entry can't fake an offer.
  let dirUrls = [];
  for (const base of _dirBases()) {
    try { const r = await fetch(base + '/relay-names/offers', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); dirUrls.push(...(j.relays || []).map(x => normRelay(x && x.url)).filter(Boolean)); } } catch (e) {}
  }
  const seed = [...new Set([...(seedExtra || []), ...dirUrls, ..._discoverySeed, ...CANONICAL_RELAYS, ...extraRelays()])];
  const probed = await Promise.all(seed.map(async (url) => {
    const t = await _relayInfo(url);
    if (t && t.enforces === true && t.open === true && !t.full) return { url, operator: t.operator || '', region: t.region || '', churches: t.churches || 0, name: t.name || '' };
    return null;
  }));
  const offers = probed.filter(Boolean);
  offers.sort((a, b) => { if (region) { const ra = a.region === region ? 0 : 1, rb = b.region === region ? 0 : 1; if (ra !== rb) return ra - rb; } return (a.churches || 0) - (b.churches || 0); });
  return offers;
}
// auto-pick primary + backup, preferring DIFFERENT operators so a backup is real redundancy.
function pickRelays(offers, n) {
  n = n || 2; const picked = [], ops = new Set();
  for (const o of (offers || [])) { if (picked.length >= n) break; if (o.operator && ops.has(o.operator)) continue; picked.push(o); if (o.operator) ops.add(o.operator); }
  if (picked.length < n) for (const o of (offers || [])) { if (picked.length >= n) break; if (!picked.includes(o)) picked.push(o); }
  return picked;
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
// True once we have actually completed a NIP-42 auth with a relay. The care-key mint gate depends on this:
// the envelope is a PRIVATE doc, so an unauthenticated (or unreachable) relay answers "nothing" — which is
// indistinguishable from "this church has no key yet". Minting on that answer creates a second key generation
// and permanently orphans everything sealed with the first. See the mint gate in ensureCareKeyForMembers.
let _relayAuthed = false;
pool.automaticallyAuth = () => async (authEvent) => { if (!sk) throw new Error('no key'); _relayAuthed = true; return finalizeEvent(authEvent, sk); };
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
  // FEDERATION-PLAN Phase 1b: publish/refresh the church's NIP-65 relay-list once the key is ready.
  // Fire-and-forget + deferred so it never blocks unlock; replaceable, so re-running is harmless.
  try { Promise.resolve().then(() => { try { window.Steward.publishRelayList && window.Steward.publishRelayList(); } catch {} }); } catch {}
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
// SECURITY-AUDIT-2026-07-06 M11: costlier KDF (600k, was 210k) over the at-rest CHURCH-KEY blob. The iteration
// count is stored in the blob (`it`), so an EXISTING church-key PIN written at 210k still unlocks (o.it || legacy)
// — no owner is ever locked out of their church identity; only new/re-set PINs use the stronger cost.
const PIN_ITER = 600000;
const PIN_ITER_LEGACY = 210000;
async function deriveAes(pin, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iterations || PIN_ITER_LEGACY, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function publish(evt) {
  try { await Promise.any(pool.publish(relays(), evt)); }
  catch (e) {
    console.warn('[steward] publish failed', e);
    // every relay rejected — surface it so the steward isn't left wondering why nothing saved
    let reason = '';
    try { const errs = (e && e.errors) || []; reason = (errs[0] && (errs[0].message || String(errs[0]))) || ''; } catch (x) {}
    try { window.dispatchEvent(new CustomEvent('steward-publish-error', { detail: { reason, evt } })); } catch (x) {}
    return false;   // total failure — every relay rejected; callers that await the result can surface it
  }
  // a write landed → the relays are accepting our posts, so any "a relay is refusing us" alarm can clear
  try { window.dispatchEvent(new CustomEvent('steward-publish-ok', { detail: { evt } })); } catch (x) {}
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
// one-shot read of the single NEWEST event matching `filters` (or null), bounded by a short timeout.
function _one(filters, ms = 4000) {
  return new Promise((resolve) => {
    let best = null, done = false;
    const finish = () => { if (done) return; done = true; try { sub.close(); } catch {} resolve(best); };
    const sub = pool.subscribeMany(relays(), filters, {
      onevent(e) { if (!best || (e.created_at || 0) > (best.created_at || 0)) best = e; },
      oneose() { finish(); },
    });
    setTimeout(finish, ms);
  });
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
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveAes(pin, salt, PIN_ITER), new TextEncoder().encode(seed)));
    lsSet(ENC_LS, JSON.stringify({ v: 2, it: PIN_ITER, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) }));   // M11: v2 blob carries its iteration count
    try { localStorage.removeItem(KEY_LS); } catch {}
    _setNeedsPin(false);   // SECURITY-AUDIT-2026-06-25 Critical-2: encrypted form now persisted; clear the force flag
    return true;
  },
  async unlock(pin) {                              // decrypt into memory (does NOT re-write the plaintext)
    const raw = lsGet(ENC_LS); if (!raw) return true;
    try {
      const o = JSON.parse(raw);
      const seed = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(o.iv) }, await deriveAes(pin, b64d(o.salt), o.it || PIN_ITER_LEGACY), b64d(o.ct)));
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
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(o.iv) }, await deriveAes(pin, b64d(o.salt), o.it || PIN_ITER_LEGACY), b64d(o.ct));
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
  // Backup (Phase 1): pull the church's COMPLETE corpus from its relay as a self-verifying JSONL archive. A
  // fresh NIP-98 proof signed by the church key authorises the pull; the relay streams every event it holds for
  // this church. Restore = importAll() the events back into a relay. Returns { text, count, filename, encrypted }.
  // encrypt (default true): seal the archive to the church key so the file is safe to keep/store anywhere — see
  // _sealToChurch. The steward can turn it OFF for a plain-readable JSONL (it's their data). Throws on failure.
  async exportChurchData({ encrypt = true, includeMedia = true } = {}) {
    if (!sk || !pub) throw new Error('No church key on this device');
    const base = _blobBase(), date = new Date().toISOString().slice(0, 10);   // UTC day is correct here: it only stamps the backup filename
    // 1. events — the JSONL corpus
    const er = await fetch(base + '/export', { headers: { Authorization: _nip98(base + '/export') } });
    if (!er.ok) throw new Error('Backup failed — the relay returned ' + er.status);
    const events = await er.text();
    const count = Math.max(0, events.split('\n').filter(Boolean).length - 1);   // events (minus the manifest line)
    // 2. media (optional) — pull every blob into a zip container alongside the events, for a COMPLETE archive
    let payload, fmt = 'jsonl', mediaCount = 0;
    if (includeMedia) {
      let man = { blobs: [] };
      try { const mr = await fetch(base + '/export-media', { headers: { Authorization: _nip98(base + '/export-media') } }); if (mr.ok) man = await mr.json(); } catch {}
      if (man.blobs && man.blobs.length) {
        const files = { 'manifest.json': strToU8(JSON.stringify({ format: 'trinityone-church-backup', version: 2, church: pub, events: count, media: man.blobs.length, exportedAt: now() })), 'events.jsonl': strToU8(events) };
        for (const b of man.blobs) {   // each blob is content-addressed (sha256); the church key authorises the pull
          const br = await fetch(base + '/blob/' + b.sha, { headers: { Authorization: _nip98(base + '/blob/' + b.sha) } });
          if (!br.ok) throw new Error('Backup failed pulling media (' + String(b.sha).slice(0, 8) + '…) — ' + br.status);
          files['blobs/' + b.sha] = new Uint8Array(await br.arrayBuffer());
        }
        payload = zipSync(files, { level: 0 });   // media is already compressed (images/audio); level 0 = fast + low-memory
        fmt = 'zip'; mediaCount = man.blobs.length;
      }
    }
    if (!payload) payload = strToU8(events);
    // 3. seal to the church key (default) — or hand back plaintext (their data, their call)
    if (encrypt) return { data: await _sealToChurch(payload, pub, fmt), binary: false, mime: 'application/json', filename: 'trinityone-backup-' + date + '.tone-backup.json', count, media: mediaCount, encrypted: true };
    if (fmt === 'zip') return { data: payload, binary: true, mime: 'application/zip', filename: 'trinityone-backup-' + date + '.zip', count, media: mediaCount, encrypted: false };
    return { data: events, binary: false, mime: 'application/x-ndjson', filename: 'trinityone-backup-' + date + '.jsonl', count, media: 0, encrypted: false };
  },
  // media size for the pre-backup guard: records + total blob bytes this relay holds for the church.
  async mediaSize() {
    if (!sk || !pub) return { count: 0, bytes: 0 };
    const url = _blobBase() + '/export-media';
    try { const r = await fetch(url, { headers: { Authorization: _nip98(url) } }); if (!r.ok) return { count: 0, bytes: 0 }; const m = await r.json(); return { count: (m.blobs || []).length, bytes: m.totalBytes || 0 }; } catch { return { count: 0, bytes: 0 }; }
  },
  // decrypt an encrypted backup envelope with THIS device's church key -> { bytes, fmt }. The restore/verify
  // counterpart of encrypt-on-export; fmt is 'jsonl' (events) or 'zip' (events + media). (Restore UI = Stage 3.)
  async decryptBackup(envelope) { return _openBackup(envelope); },
  // resync: which of the church's relays are TrinityOne relays (expose a relayPub via /status) and thus can be
  // kept in sync. Generic public relays (nos.lol etc.) have no relayPub — they're publish-only, never trusted
  // with the gated corpus. Returns [{ url, base, pubkey, name, online }] for the UI + syncEnable().
  async relayIdentities() {
    const out = [];
    for (const u of relays()) {
      let base = String(u).replace(/\/relay\/?$/i, '').replace(/\/+$/, '');
      base = base.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
      let s = null; try { s = await (await fetch(base + '/status', { cache: 'no-store' })).json(); } catch {}
      out.push({ url: u, base, pubkey: (s && s.relayPub) || '', name: '', online: !!s });
    }
    return out;
  },
  // resync: publish the church's TRUSTED-RELAYS doc (kind-30078 d=trinityone/relays) — the relays authorised to
  // exchange the FULL corpus with each other. Only TrinityOne relays go in (a trusted relay re-enforces the gate);
  // the church key signs it, so the same authority that gatekeeps writes decides who syncs. Returns { relays }.
  async syncEnable() {
    if (!sk || !pub) throw new Error('No church key on this device');
    const ids = await window.Steward.relayIdentities();
    // Dedup by relay IDENTITY (relayPub): two routes to one box (Cloudflare + Tailscale — the a8 pattern) share a
    // key and are ONE failure domain, so listing both wouldn't add any redundancy. Sync is only meaningful across
    // >=2 SEPARATE boxes. Mirrors the member-side R3 fix.
    const byBox = new Map();
    for (const r of ids) { if (r.pubkey && !byBox.has(r.pubkey)) byBox.set(r.pubkey, { pubkey: r.pubkey, url: r.base }); }
    const trusted = [...byBox.values()];
    if (trusted.length < 2) throw new Error('Sync needs at least two separate TrinityOne relays — add another the church runs.');
    await publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/relays']], content: JSON.stringify(trusted) }, sk));
    return { relays: trusted.length };
  },
  // D2: this church's resilience at a glance — distinct relay BOXES (by identity, not URL), how many are online,
  // and whether cross-relay sync is currently published ON. boxes < 2 = single point of failure → the console
  // nudges the steward to add a backup; boxes >= 2 = autoSyncIfRedundant() can switch mirroring on for them.
  async backupState() {
    const ids = await window.Steward.relayIdentities();
    const boxes = new Set(ids.filter((r) => r.pubkey).map((r) => r.pubkey));
    const online = new Set(ids.filter((r) => r.pubkey && r.online).map((r) => r.pubkey));
    let syncOn = false;
    try { const doc = await _one([{ kinds: [30078], authors: [pub], '#d': ['trinityone/relays'] }]); const arr = doc ? JSON.parse(doc.content || '[]') : []; syncOn = Array.isArray(arr) && arr.length >= 2; } catch {}
    return { boxes: boxes.size, online: online.size, entries: ids.length, syncOn };
  },
  // D2: make redundancy automatic. If the church already runs >=2 separate relay boxes and sync isn't already on,
  // switch it on — so a church that has taken the step of adding a real second relay gets live cross-relay backup
  // without hunting for a toggle. Idempotent + safe: a single-box church can't sync (nothing to mirror to) and is
  // left alone (the console shows the add-a-backup nudge instead). No church data goes anywhere it isn't already.
  async autoSyncIfRedundant() {
    if (!sk || !pub) return { enabled: false };
    try {
      const st = await window.Steward.backupState();
      if (st.boxes >= 2 && !st.syncOn) { await window.Steward.syncEnable(); return { enabled: true, boxes: st.boxes }; }
      return { enabled: false, boxes: st.boxes, already: st.syncOn };
    } catch { return { enabled: false }; }
  },
  // resync: turn cross-relay sync OFF — publish an empty trusted-relays list (relays stop exchanging the corpus).
  async syncDisable() {
    if (!sk || !pub) throw new Error('No church key on this device');
    await publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/relays']], content: '[]' }, sk));
    return { relays: 0 };
  },
  // RESTORE / CLONE: read a backup file (encrypted envelope, plaintext zip, or plaintext jsonl), decrypt with the
  // church key if sealed, then import into a relay — THIS one (default) or `relayUrl` (clone onto another relay).
  // Events go to POST /import (which registers the church on a fresh relay); media blobs re-upload via PUT /blob.
  // Returns the relay's import tally + how many blobs restored. onProgress(phase, done, total) is optional.
  async restoreChurchData(fileBytes, { relayUrl, onProgress } = {}) {
    if (!sk || !pub) throw new Error('No church key on this device');
    const base = relayUrl ? String(relayUrl).replace(/\/+$/, '') : _blobBase();
    const u8 = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
    let events = '', blobs = {};
    let asText = null; try { asText = strFromU8(u8); } catch {}
    let env = null; if (asText) { try { env = JSON.parse(asText); } catch {} }
    if (env && env.trinityone_backup === 'encrypted-v1') {          // sealed to the church key -> decrypt
      const opened = await _openBackup(env);
      if (opened.fmt === 'zip') { const f = unzipSync(opened.bytes); events = strFromU8(f['events.jsonl'] || new Uint8Array()); for (const k in f) if (k.indexOf('blobs/') === 0) blobs[k.slice(6)] = f[k]; }
      else events = strFromU8(opened.bytes);
    } else if (u8[0] === 0x50 && u8[1] === 0x4b) {                   // 'PK' magic -> plaintext zip (events + media)
      const f = unzipSync(u8); events = strFromU8(f['events.jsonl'] || new Uint8Array()); for (const k in f) if (k.indexOf('blobs/') === 0) blobs[k.slice(6)] = f[k];
    } else { events = asText || ''; }                                // plaintext jsonl (events only)
    if (!events.trim()) throw new Error('This file has no church data to restore.');
    // 1. import the events (a fresh relay registers the church here)
    if (onProgress) onProgress('events', 0, 1);
    const ir = await fetch(base + '/import', { method: 'POST', headers: { Authorization: _nip98(base + '/import', 'POST'), 'Content-Type': 'application/x-ndjson' }, body: events });
    if (!ir.ok) throw new Error('Restore failed — the relay returned ' + ir.status + (ir.status === 401 ? ' (are you the church owner, and does that relay allow this church?)' : ''));
    const result = await ir.json();
    if (onProgress) onProgress('events', 1, 1);
    // 2. restore media blobs
    const shas = Object.keys(blobs); let done = 0, ok = 0, failed = 0;
    for (const sha of shas) { if (onProgress) onProgress('media', done, shas.length); if (await _putBlob(base, blobs[sha])) ok++; else failed++; done++; }
    if (onProgress) onProgress('media', shas.length, shas.length);
    return { ...result, mediaRestored: ok, mediaFailed: failed, mediaTotal: shas.length };
  },
  // CLONE a church's data from a SOURCE relay onto a target relay (default: this church's own relay). Reads the
  // full corpus from the source's /export (church-signed) and imports it into the target's /import — so after a
  // seed-phrase restore you can pull your church's history from a community node onto your own box. Events only
  // (media clones via restoreChurchData's archive path). Both ends auth with a fresh proof signed by the church key.
  async cloneFromRelay(sourceUrl, { targetUrl, onProgress } = {}) {
    if (!sk || !pub) throw new Error('No church key on this device');
    const httpBase = (u) => String(u || '').replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://').replace(/\/relay\/?$/i, '').replace(/\/+$/, '');
    const src = httpBase(sourceUrl);
    if (!src) throw new Error('Enter the relay to copy from.');
    const dst = targetUrl ? httpBase(targetUrl) : _blobBase();
    if (src === dst) throw new Error('The source and destination are the same relay.');
    if (onProgress) onProgress('reading', 0, 1);
    const er = await fetch(src + '/export', { headers: { Authorization: _nip98(src + '/export') } });
    if (!er.ok) throw new Error('Couldn’t read your church’s data from that relay (' + er.status + (er.status === 401 ? ' — is it the right relay for this church?' : '') + ')');
    const events = await er.text();
    if (!events.trim()) throw new Error('That relay has no data for this church.');
    if (onProgress) onProgress('writing', 0, 1);
    const ir = await fetch(dst + '/import', { method: 'POST', headers: { Authorization: _nip98(dst + '/import', 'POST'), 'Content-Type': 'application/x-ndjson' }, body: events });
    if (!ir.ok) throw new Error('Couldn’t write to the destination relay (' + ir.status + ')');
    const result = await ir.json();
    if (onProgress) onProgress('done', 1, 1);
    return result;
  },
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
  // The key a member shows on a NEW phone after losing their 12 words: `trinityone-reseat:<npub>`. A bare
  // npub or hex is accepted too, so a member who can't be there in person can simply send it — the steward
  // still has to recognise them and press the button, which is where the authority actually comes from.
  parseMemberKey(payload) {
    let s = (payload || '').trim();
    const q = s.match(/[?&#]reseat=([^&#\s]+)/);
    if (q) { try { s = decodeURIComponent(q[1]); } catch {} }
    s = s.replace(/^trinityone-reseat:/i, '').trim();
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
  // NIP-65 relay-list (FEDERATION-PLAN Phase 1b): advertise, in a church-signed replaceable event (kind
  // 10002), WHICH relays carry this church's content — so a member can follow relay moves/additions
  // without needing a fresh invite link. Purely additive: nothing reads kind:10002 until Phase 2, and it
  // only lists relays the church already uses (today the public canonical set), so it reveals nothing new.
  // NOTE: when self-hosted/HIDDEN relays arrive (Phase 4), this MUST become opt-in per church so a hidden
  // relay isn't advertised (FEDERATION-PLAN risk #4). Signed by the church key only — not a delegated steward.
  publishRelayList() {
    if (!sk || actingChurch) return Promise.resolve(null);
    const tags = relays().map(r => ['r', r]);   // no read/write marker = both (church relays serve + accept)
    return publish(finalizeEvent({ kind: 10002, created_at: now(), tags, content: '' }, sk));
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
  // ── steward-defined chat message tags (one church-signed doc; newest-wins) ──
  publishMessageTags(tags) {
    if (!sk) return Promise.resolve(null);
    const clean = _sanitizeMsgTags(tags);
    const content = JSON.stringify({ tags: clean });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', MSGTAGS_D], ['t', NET]], content })).then(() => clean);
  },
  // cb(tags) for the church's configured tags, or cb(null) when NO tags doc exists yet — the editor then
  // seeds the default (Prayer request), which the steward can rename, recolour or remove. Never hangs on load.
  subscribeMessageTags(cb) {
    let bestTs = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== MSGTAGS_D || (e.created_at || 0) <= bestTs) return;
        bestTs = e.created_at || 0;
        let tags = []; try { tags = _sanitizeMsgTags(JSON.parse(e.content || '{}').tags); } catch {}
        cb(tags);
      },
      oneose() { if (!bestTs) cb(null); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // ---- Phase 5 Tier 2: self-hosted media (sermons). Upload a file to the church's own blob store, then
  // publish a signed sermon doc referencing it by sha256 — no YouTube, members-only. `encrypt` (a bytes->bytes
  // fn) is applied BEFORE hashing/upload so the host only ever holds ciphertext (used for the sensitive /
  // cloud-backup case). Returns { sha256, size, host, mime, enc }.
  // https origins of this church's DISTINCT media hosts (each relay = relay + blob store), primary first — used
  // to auto-suggest backup copy hosts. Excludes the shared canonical FALLBACK relays (aliases/routes to the same
  // primary box), so a backup is only suggested when the church runs a genuinely separate relay.
  mediaHosts() {
    const base = (r) => String(r).replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://').replace(/\/relay\/?$/i, '');
    const canon = new Set(CANONICAL_RELAYS.map(base));
    const primary = base(ownRelay());
    const out = [primary];
    for (const r of relays()) { const b = base(r); if (b !== primary && !canon.has(b)) out.push(b); }
    return [...new Set(out)];
  },
  async uploadBlob(file, encrypt, mirrors) {
    if (!sk) throw new Error('no key');
    let bytes = new Uint8Array(await file.arrayBuffer());
    const enc = typeof encrypt === 'function';
    if (enc) bytes = await encrypt(bytes);   // the media encryptor is async (crypto.subtle) — must await, or bytes is a Promise
    const sha = await _sha256hex(bytes);
    const ctype = enc ? 'application/octet-stream' : (file.type || 'application/octet-stream');
    // one signed, host-agnostic kind-24242 upload auth, reused to PUT the SAME blob to the primary + each backup.
    const authHdr = 'Nostr ' + btoa(JSON.stringify(finalizeEvent({ kind: 24242, created_at: now(), tags: [['t', 'upload'], ['x', sha], ['expiration', String(now() + 600)]], content: 'upload' }, sk)));
    // native (CapacitorHttp) mangles a raw binary PUT body → send base64 text + a marker the gateway decodes; web sends raw bytes
    const native = _isNative(); const body = native ? _b64(bytes) : bytes;
    const put = async (b) => { const h = { Authorization: authHdr, 'Content-Type': ctype }; if (native) h['X-Blob-B64'] = '1'; const r = await fetch(b + '/blob', { method: 'PUT', headers: h, body }); if (!r.ok) { let m = ''; try { m = ((await r.json()) || {}).error || ''; } catch (e) {} throw new Error(m || ('Upload failed (' + r.status + ')')); } return r.json(); };
    const primary = _blobBase();
    const j = await put(primary);   // the primary must succeed
    const hosts = [primary];
    for (const m of (mirrors || [])) {   // BACKUP: mirror to each extra host best-effort (a 2nd relay / cloud Blossom); content-addressed so bytes are identical everywhere
      const mb = String(m || '').trim().replace(/\/+$/, ''); if (!mb || mb === primary) continue;
      try { await put(mb); hosts.push(mb); } catch (e) {}
    }
    // keep the REAL type in the sermon doc (for Listen/Watch routing) even when encrypted — the type isn't
    // secret, only the content is (the blob is still stored opaque as application/octet-stream on the host).
    return { sha256: j.sha256, size: j.size, host: primary, hosts, mime: (file.type || j.type || ''), enc };
  },
  // publish a signed sermon doc referencing an uploaded blob (title + sha256 + host(s) for redundancy).
  publishSermon(s) {
    if (!sk) return Promise.resolve(null);
    const id = s.id || ('sermon' + Date.now());
    const content = JSON.stringify({ id, title: s.title || 'Sermon', desc: (s.desc && String(s.desc).trim()) || undefined, sha256: s.sha256, hosts: (s.hosts && s.hosts.length) ? s.hosts : [s.host], mime: s.mime || '', size: s.size || 0, ts: s.ts || now(), enc: s.enc || undefined, series: s.series || undefined });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', SERMON_D + id], ['t', NET]], content }))
      .then((r) => { if (r === false) throw new Error('Couldn’t save — every relay rejected it. Check your connection.'); return { id, ...JSON.parse(content) }; });
  },
  async removeSermon(s) {
    if (!sk) return null;
    const id = (s && typeof s === 'object') ? s.id : s;
    await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', SERMON_D + id], ['t', NET], ['deleted', '1']], content: '' }));   // tombstone the doc (hides it in every app)
    // reclaim the stored bytes on each host (best-effort; content-addressed so the same sha lives on every mirror)
    const sha = s && typeof s === 'object' && s.sha256;
    const hosts = (s && typeof s === 'object' && ((s.hosts && s.hosts.length) ? s.hosts : (s.host ? [s.host] : []))) || [];
    if (sha && hosts.length) {
      const auth = 'Nostr ' + btoa(JSON.stringify(finalizeEvent({ kind: 24242, created_at: now(), tags: [['t', 'delete'], ['x', sha], ['expiration', String(now() + 600)]], content: 'delete' }, sk)));
      for (const h of hosts) { try { await fetch(String(h).replace(/\/+$/, '') + '/blob/' + sha, { method: 'DELETE', headers: { Authorization: auth } }); } catch (e) {} }
    }
    return true;
  },
  // Pin/feature a sermon → members get a Today card + a notification. One per church (addressable → replaces).
  pinSermon(s) {
    if (!sk) return Promise.resolve(null);
    const content = JSON.stringify({ id: s.id, title: s.title || 'Sermon', sha256: s.sha256, hosts: (s.hosts && s.hosts.length) ? s.hosts : (s.host ? [s.host] : []), mime: s.mime || '', enc: s.enc || undefined, ts: now() });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', PINSERMON_D + pub], ['t', NET]], content }));
  },
  unpinSermon() {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', PINSERMON_D + pub], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribePinnedSermon(onPinned) {
    if (!pub) { onPinned(null); return () => {}; }
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#d': [PINSERMON_D + pub] }], {
      onevent(e) { if ((e.tags.find(t => t[0] === 'deleted') || [])[1]) { onPinned(null); return; } try { onPinned({ ...JSON.parse(e.content), at: e.created_at }); } catch { onPinned(null); } },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },
  // backup reminder, church-wide: record the last-backup time + reminder cadence in a church doc, so every steward
  // and device shows the same 'last backed up' + overdue nudge — not just the device that happened to run it.
  setBackupMeta(at, remind) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', BACKUPMETA_D + pub], ['t', NET]], content: JSON.stringify({ at: at || now(), remind: remind || 'monthly' }) }));
  },
  subscribeBackupMeta(onMeta) {
    if (!pub) { onMeta(null); return () => {}; }
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#d': [BACKUPMETA_D + pub] }], {
      onevent(e) { try { const c = JSON.parse(e.content); onMeta({ at: c.at || e.created_at, remind: c.remind || 'monthly' }); } catch { onMeta(null); } },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },
  // Tier 2 encryption: ensure a church media key exists + is wrapped (NIP-44) to every current member, publish
  // the envelope, and return an AES-GCM encryptor that prepends a random 12-byte IV. Encrypt runs BEFORE upload,
  // so the host (and any cloud backup) only ever holds ciphertext; only members hold the key to decrypt.
  async mediaEncryptor(memberPubs) {
    if (!sk) throw new Error('no key');
    // AUDIT-2026-07-24: this is the care-key mint bug verbatim, and weaker — subscribeMediaKey's oneose is
    // empty, so there is no "we looked" flag at all, and _mediaKeyHex is in-memory (null on every console
    // open). Uploading a sermon against an unauthenticated/restarting relay minted a fresh key, encrypted the
    // sermon with it and REPLACED the envelope — every previously-encrypted sermon then undecryptable by the
    // church and every member, permanently. Refuse to mint on an untrustworthy read (fail closed: the steward
    // sees "try again in a moment"; the alternative is silent, unrecoverable loss of the church's archive).
    if (!_mediaKeyHex && !_relayAuthed) throw new Error('Can’t encrypt this upload yet — this device hasn’t finished connecting to your church’s relay, so it can’t tell whether your church already has a media key. Wait a moment and try again.');
    if (!_mediaKeyHex) { _mediaKeyHex = _hex(crypto.getRandomValues(new Uint8Array(32))); _mediaKeyRing = [_mediaKeyHex]; }
    const keys = {}; const targets = [...new Set([pub, ...(memberPubs || []).filter(Boolean)])];
    const _mring = JSON.stringify(_mediaKeyRing.length ? _mediaKeyRing : [_mediaKeyHex]);
    for (const mp of targets) { try { keys[mp] = nip44e(_mring, nip44ck(sk, mp)); } catch (e) {} }
    await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', MEDIAKEY_D + pub], ['t', NET]], content: JSON.stringify({ keys, rev: now() }) }));
    const key = await crypto.subtle.importKey('raw', _unhex(_mediaKeyHex), 'AES-GCM', false, ['encrypt']);
    return async (bytes) => { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)); const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12); return out; };
  },
  // #17: make sure the CURRENT church media key is wrapped for everyone in `memberPubs`. A member who joins AFTER an
  // encrypted sermon was uploaded is not in the media-key doc, so their app can't decrypt existing sermons ("needs the
  // unlock key" dead-end). This re-wraps the EXISTING key (existing blobs stay decryptable — no re-encryption) and
  // republishes the doc, but ONLY when someone's actually missing (idempotent → safe to call on every roster change).
  // Returns false (no-op) if this device hasn't loaded the media key yet, or if no sermon has ever been encrypted.
  async ensureMediaKeyForMembers(memberPubs) {
    if (!sk || !_mediaKeyHex) return false;                       // no media key on this device → nothing to distribute yet
    const want = [...new Set([pub, ...(memberPubs || []).filter(Boolean)])];
    const have = _mediaKeyDocKeys || {};
    if (want.every(p => have[p])) return false;                   // everyone's already keyed — no republish
    const keys = {};
    const _mring = JSON.stringify(_mediaKeyRing.length ? _mediaKeyRing : [_mediaKeyHex]);
    for (const mp of want) { try { keys[mp] = nip44e(_mring, nip44ck(sk, mp)); } catch (e) {} }
    const ok = await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', MEDIAKEY_D + pub], ['t', NET]], content: JSON.stringify({ keys, rev: now() }) }));
    if (ok !== false) _mediaKeyDocKeys = keys;                    // reflect what we just published so we don't loop
    return ok;
  },
  // ROTATE the media key — same contract as rotateCareKey: a removed member must not hold the key to sermons
  // uploaded after they left. The ring keeps the superseded keys so nothing already encrypted becomes
  // unplayable, and the new envelope simply isn't wrapped to them. Protects future uploads only; anything they
  // already downloaded is theirs, and no key change alters that.
  async rotateMediaKey(memberPubs) {
    if (!sk || !pub) return false;
    if (!_relayAuthed) return false;                              // never act on an untrusted view (see the mint gate)
    if (!_mediaKeyHex) return false;                              // no key yet — mediaEncryptor mints the first
    const fresh = _hex(crypto.getRandomValues(new Uint8Array(32)));
    const ring = [fresh, ...(_mediaKeyRing.length ? _mediaKeyRing : [_mediaKeyHex])].slice(0, 12);
    const want = [...new Set([pub, ...(memberPubs || []).filter(Boolean)])];
    const keys = {}; const payload = JSON.stringify(ring);
    for (const mp of want) { try { keys[mp] = nip44e(payload, nip44ck(sk, mp)); } catch (e) {} }
    const ok = await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', MEDIAKEY_D + pub], ['t', NET]], content: JSON.stringify({ keys, rev: now() }) }));
    if (ok === false) return false;
    _mediaKeyRing = ring; _mediaKeyHex = fresh; _mediaKeyDocKeys = keys;
    return true;
  },
  // ---- care key: same envelope as the media key, for the Care module's sensitive fields ----
  // Watch the church's envelope. Unwraps OUR OWN entry with churchSk/churchPub — in delegated mode `pub` is
  // the church, so using it here is what made the previous attempt impossible to satisfy.
  subscribeCareKey() {
    const cp = actingChurch || pub; if (!cp) return () => {};
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [cp], '#d': [CAREKEY_D + cp] },
                                              { kinds: [30078], '#church': [cp], '#d': [CAREKEY_D + cp] }], {
      onevent(e) {
        // Author discipline: the church itself, or one of its CURRENT rostered stewards. The relay enforces
        // exactly this on write; the client check matters on a shared/non-enforcing relay. An author we can't
        // verify YET (the steward roster loads asynchronously) is BUFFERED, not dropped — dropping a real
        // steward envelope and then minting a fresh key is the mint-race that splits the care key.
        if (!_careKeyAuthed(e)) { _careKeyPending.push({ e, at: Date.now() }); if (_careKeyPending.length > 10) _careKeyPending.shift(); return; }
        _ingestCareKeyEnv(e);
      },
      oneose() { _careKeyChecked = true; },   // no envelope came back → it is safe to mint one
    });
    return () => { try { sub.close(); } catch (e) {} };
  },
  // Wrap the care key for everyone who needs it. MINTS only on a first run where we have positively
  // established there is no envelope — never on a cold `_careKeyHex === null`, which is the ordinary state
  // for the first second of every console open. Idempotent: re-wraps the EXISTING key for anyone missing.
  async ensureCareKeyForMembers(memberPubs, stewardPubs) {
    const cp = actingChurch || pub;
    if (!sk || !cp || !churchPub) return false;
    if (!_careKeyChecked) return false;                       // haven't looked yet — minting now would orphan
    _reCheckCareKeyPending();                                 // adopt any envelope now verifiable; drop expired forgeries
    if (_careKeyPending.length) return false;                 // an unverified envelope may be a REAL one whose author is still loading — never mint a second key over it
    if (!_careKeyHex) {
      if (_careKeyDocKeys) return false;                      // an envelope EXISTS and we're not in it; the owner must add us
      // ── MINT GATE (data-integrity critical) ───────────────────────────────────────────────────────────
      // Minting a second key permanently orphans every need sealed with the first — the ciphertext survives
      // but nothing can open it. "The relay returned no envelope" is NOT proof that none exists: the envelope
      // is private, so an unauthenticated or unreachable relay returns exactly the same empty answer. That
      // really happened (2026-07-24): a console reloaded while its relay was restarting concluded "no key",
      // minted a throwaway, sealed a need with it, and the key was gone on the next reload — the need's name,
      // notes and recipient are unrecoverable. Both guards below fail CLOSED: refusing to mint leaves a
      // visible, recoverable error ("care key hasn't reached this device"), whereas minting wrongly destroys
      // data silently.
      if (!_relayAuthed) return false;                        // (1) never conclude "no key" from an unauthenticated read
      if (await _churchHasCareNeeds()) return false;          // (2) needs exist → a key MUST exist; minting would orphan them
      _careKeyHex = _hex(crypto.getRandomValues(new Uint8Array(32)));
      _careKeyRing = [_careKeyHex];
      _careKeyRev = 1;
    }
    // include ourselves (delegated stewards sign with their own key) and the steward roster, so a steward
    // can open needs and re-wrap for new members without the owner present
    const want = [...new Set([cp, churchPub, ...(memberPubs || []), ...(stewardPubs || [])].filter(Boolean))];
    const have = _careKeyDocKeys || {};
    if (want.every(p2 => have[p2])) return false;             // everyone's keyed — no republish
    const keys = {};
    const _ring = JSON.stringify(_careKeyRing.length ? _careKeyRing : [_careKeyHex]);
    for (const mp of want) { try { keys[mp] = nip44e(_ring, nip44ck(sk, mp)); } catch (e) {} }
    const ok = await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', CAREKEY_D + cp], ['t', NET]], content: JSON.stringify({ keys, rev: _careKeyRev }) }));
    if (ok !== false) _careKeyDocKeys = keys;
    return ok;
  },
  // seal / open the sensitive half of a care doc. Returns null when this device has no key, so callers can
  // refuse rather than publish PII in the clear by accident.
  careSeal(obj) { try { return _careKeyHex ? nip44e(JSON.stringify(obj), _unhex(_careKeyHex)) : null; } catch (e) { return null; } },
  // Try the whole ring: a need sealed before a rotation still opens with the key of its day.
  careOpen(ct) { for (const k of (_careKeyRing.length ? _careKeyRing : (_careKeyHex ? [_careKeyHex] : []))) { try { return JSON.parse(nip44d(ct, _unhex(k))); } catch (e) {} } return null; },
  careSealTo(recipientPub, obj) { try { return nip44e(JSON.stringify(obj), nip44ck(sk, recipientPub)); } catch (e) { return null; } },
  // open a payload sealed to a SET of pubkeys ({keys:{pub:wrapped}, enc}) — the "ask for help" request + its
  // shared thread. The sender wrapped the content key to each care-team recipient incl. the church, so an OWNER
  // console (acting as the church key) unwraps its copy. null if not addressed to us.
  openSealedFromPeer(o, authorPub) { try { const mine = o && o.keys && pub && o.keys[pub]; if (!mine || !sk) return null; return JSON.parse(nip44d(o.enc, _unhex(nip44d(mine, nip44ck(sk, authorPub))))); } catch (e) { return null; } },
  // seal a payload TO a set of pubkeys (a console reply into a care thread) — mirrors fellowship _sealToPubs.
  sealToPubs(recips, obj) {
    try {
      const kb = crypto.getRandomValues(new Uint8Array(32)); const khex = Array.from(kb).map(x => x.toString(16).padStart(2, '0')).join('');
      const enc = nip44e(JSON.stringify(obj), kb); const keys = {};
      for (const p of [...new Set((recips || []).filter(Boolean))]) { try { keys[p] = nip44e(khex, nip44ck(sk, p)); } catch (e) {} }
      return { keys, enc };
    } catch (e) { return null; }
  },
  hasCareKey() { return !!_careKeyHex; },
  // ROTATE the church care key — call when someone is removed (blocked / taken off the roster). Until now the
  // key was only ever ADDED to, so a member who was blocked kept a working copy of the church's care key for
  // ever: "we removed him" did not mean "he can no longer read the care records".
  //
  // What this does and does NOT buy you, stated plainly: everything sealed BEFORE the rotation was already
  // readable by that person and they may have kept it — no key change can retract what someone has already
  // seen. Rotation protects everything sealed AFTERWARDS. The old key stays in the ring so the church itself
  // never loses access to its own history (dropping it is how you destroy your records, not how you secure
  // them), and the new envelope simply isn't wrapped to the person who left.
  async rotateCareKey(memberPubs, stewardPubs) {
    const cp = actingChurch || pub;
    if (!sk || !cp || !churchPub) return false;
    if (!_careKeyChecked || !_relayAuthed) return false;      // same trusted-view rule as minting
    if (!_careKeyHex) return false;                            // nothing to rotate yet — ensureCareKeyForMembers mints the first
    const fresh = _hex(crypto.getRandomValues(new Uint8Array(32)));
    const ring = [fresh, ...(_careKeyRing.length ? _careKeyRing : [_careKeyHex])].slice(0, 12);   // keep a bounded history
    const want = [...new Set([cp, churchPub, ...(memberPubs || []), ...(stewardPubs || [])].filter(Boolean))];
    const keys = {}; const payload = JSON.stringify(ring);
    for (const mp of want) { try { keys[mp] = nip44e(payload, nip44ck(sk, mp)); } catch (e) {} }
    const ok = await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', CAREKEY_D + cp], ['t', NET]], content: JSON.stringify({ keys, rev: (_careKeyRev || 1) + 1 }) }));
    if (ok === false) return false;
    _careKeyRing = ring; _careKeyHex = fresh; _careKeyRev = (_careKeyRev || 1) + 1; _careKeyDocKeys = keys;
    return true;
  },
  // has this device actually completed a NIP-42 auth? Callers use it to tell "the church has none" apart
  // from "the relay didn't serve it to us" before doing anything destructive. See _requireTrustedView.
  relayAuthed() { return _relayAuthed; },

  careKeyChecked() { return _careKeyChecked; },
  // the console feeds the live steward roster in, so the envelope's author check stays current when a
  // steward is revoked (a revoked steward's envelope must stop being accepted, same as their content)
  setCareRoster(list) { _careRoster = new Set((list || []).filter(Boolean)); _reCheckCareKeyPending(); },   // roster just changed — adopt any buffered envelope it now verifies
  // recover the church media key on THIS device (unwrap our own wrapped entry) — so a restored console re-keys.
  subscribeMediaKey() {
    if (!pub) return () => {};
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#d': [MEDIAKEY_D + pub] }], {
      // Ring-aware, and tolerant of the legacy shape: a wrapped value is a JSON array of keys now (newest
      // first) but older envelopes hold one bare hex string. Reading only the new form would make every
      // sermon encrypted before the upgrade undecryptable.
      onevent(e) { try { const o = JSON.parse(e.content); _mediaKeyDocKeys = (o && o.keys) || null; const mine = o.keys && o.keys[pub]; if (mine && sk) { const plain = nip44d(mine, nip44ck(sk, e.pubkey)); let r = null; try { const q = JSON.parse(plain); if (Array.isArray(q)) r = q.filter(k => typeof k === 'string' && k); } catch (x2) {} _mediaKeyRing = (r && r.length) ? r : [plain]; _mediaKeyHex = _mediaKeyRing[0]; } } catch (x) {} },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },
  // true if every relay this console has opened is still connected. The console's reconnect ticker only
  // re-subscribes when this is FALSE — so a healthy socket never triggers a full-corpus re-query (the steward
  // subs are broad + un-cursored, so blindly re-REQing every 90s would re-download the whole church every 90s).
  relaysHealthy() {
    try { const st = pool.listConnectionStatus(); for (const url of relays()) { if (st.get(url) === false) return false; } return true; } catch (e) { return true; }
  },
  subscribeSermons(onSermons) {
    if (!pub) { onSermons([]); return () => {}; }
    const byId = new Map();
    const emit = () => onSermons([...byId.entries()].filter(([, s]) => s).map(([, s]) => s).sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(SERMON_D)) return;
        if ((e.tags.find(t => t[0] === 'deleted') || [])[1]) { byId.set(d, null); emit(); return; }
        try { const s = JSON.parse(e.content); if (s && s.sha256) { byId.set(d, { ...s, at: e.created_at }); emit(); } } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
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
  // SAFETY CHECK (emergency "mark as safe" roll-call). Start one for the managed church — members are alerted
  // and can respond; each response is encrypted to US (the creator, `pub`). Works as owner OR delegated steward.
  async startSafetyCheck(message) {
    const cp = actingChurch || pub; if (!sk || !cp) return null;
    const id = 'sc' + now() + Math.random().toString(36).slice(2, 6);
    const content = JSON.stringify({ id, message: String(message || 'Are you safe?').trim().slice(0, 280), at: now(), open: true });   // no `by` — members encrypt to the event SIGNER, not a content field
    // SECURITY-AUDIT-2026-07-18: publish() RESOLVES with `false` when every relay rejected (it doesn't throw), so
    // the old try/catch never fired and this returned success even when nothing was sent — in the raid/disaster
    // conditions this feature exists for, the steward believed the church was alerted when it wasn't. Honour the
    // ACK: return null unless at least one relay accepted, so the UI can show "couldn't send — try again".
    const r = await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', SAFETY_D + cp], ['t', NET]], content }));
    if (!r) return null;
    return { id, by: pub };
  },
  async closeSafetyCheck(id) {
    const cp = actingChurch || pub; if (!sk || !cp) return null;
    const content = JSON.stringify({ id: id || '', at: now(), open: false });
    const r = await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', SAFETY_D + cp], ['t', NET]], content }));   // SECURITY-AUDIT-2026-07-18: honour the publish ACK (was always returning true)
    return r ? true : null;
  },
  // the current active check (so the console shows it + can close it). cb(check|null).
  subscribeSafetyCheck(cb) {
    const cp = actingChurch || pub; if (!cp) return () => {};
    let best = null;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#d': [SAFETY_D + cp] }], {
      onevent(e) { try { const o = JSON.parse(e.content || '{}'); if (best && e.created_at < best.createdAt) return; best = { id: o.id || e.id, message: String(o.message || ''), by: e.pubkey, at: o.at || e.created_at, open: o.open !== false, createdAt: e.created_at }; cb(best.open ? { id: best.id, message: best.message, by: best.by, at: best.at } : null); } catch {} },   // by = SIGNER, never content (see fellowship markSafe)
    });
    return () => { try { sub.close(); } catch {} };
  },
  // members' responses to the roll-call, decrypted (each is encrypted to us). cb(list of {pubkey,status,note,at}).
  subscribeSafetyResponses(checkId, cb) {
    const cp = actingChurch || pub; if (!cp) return () => {};
    const byPub = new Map();
    const seenIds = new Set();   // dedupe multi-relay re-delivery BEFORE the (costly) NIP-44 decrypt
    const ckCache = new Map();   // pubkey -> conversation key, computed once per responder
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#d': [SAFE_D + cp] }], {
      onevent(e) {
        if (!sk) return;
        if (e.id) { if (seenIds.has(e.id)) return; seenIds.add(e.id); }
        try {
          let ck = ckCache.get(e.pubkey); if (!ck) { ck = nip44ck(sk, e.pubkey); ckCache.set(e.pubkey, ck); }
          const o = JSON.parse(nip44d(e.content, ck));
          if (checkId && o.checkId && o.checkId !== checkId) return;         // ignore responses to an earlier check
          const prev = byPub.get(e.pubkey); if (prev && prev.at >= (o.at || e.created_at)) return;
          byPub.set(e.pubkey, { pubkey: e.pubkey, status: o.status === 'help' ? 'help' : 'safe', note: String(o.note || ''), at: o.at || e.created_at });
          cb([...byPub.values()]);
        } catch {}
      },
    });
    return () => { try { sub.close(); } catch {} };
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
    // AUDIT-2026-07-24: the contract above ("must NOT mint a new key — would orphan history") was enforced only
    // for the background reuseOnly path. The INTERACTIVE path — a steward adding one member to an existing
    // encrypted group — minted whenever `key` was missing, and `_skeys` is populated only when the envelope has
    // arrived. Adding a member before it landed re-keyed the group and orphaned every prior message in it,
    // permanently. A missing key is only safe to interpret as "new group" once we've had an authenticated read.
    if (!opts.rotate && !key && !_relayAuthed) return Promise.resolve(null);
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
    let cur = [], latest = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== BLOCKED_D + pub) return;
        if (_authFuture(e) || !_byChurch(e)) return;   // owner-only; drop forgeries + future-dated pins
        // NEWEST WINS. This is a replaceable doc and we read it from every relay, so without this the copy
        // that ARRIVES last wins rather than the one that was WRITTEN last — a relay holding an older
        // blocklist silently reinstates blocks the owner has already lifted.
        if (e.created_at < latest) return; latest = e.created_at;
        try { cur = (JSON.parse(e.content).pubkeys) || []; } catch { cur = []; }
        onBlocked(cur);
      },
      oneose() { onBlocked(cur); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setBlocked(pubkeys) {   // replace the whole blocklist (pass hex pubkeys)
    _requireTrustedView('blocked list');
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
    // NEWEST WINS, per document. These are three separate replaceable docs riding one subscription, so they
    // need three timestamps: a single shared one would let a fresh minors list suppress a perfectly current
    // approved list that simply happened to arrive after it. Safeguarding lists are the worst place to let a
    // stale copy from a lagging relay win — it would quietly reinstate a child-protection state the church
    // has already changed.
    let tMinors = 0, tApproved = 0, tNophoto = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (_authFuture(e)) return;   // no future-dated pins on any safeguarding doc
        // minors + approved are OWNER-ONLY; nophoto is owner-or-steward — mirror the relay per doc.
        if (d === MINORS_D + pub) { if (!_byChurch(e)) return; if (e.created_at < tMinors) return; tMinors = e.created_at; try { minors = (JSON.parse(e.content).pubkeys) || []; } catch { minors = []; } onLists({ minors, approved, nophoto }); }
        else if (d === APPROVED_D + pub) { if (!_byChurch(e)) return; if (e.created_at < tApproved) return; tApproved = e.created_at; try { approved = (JSON.parse(e.content).pubkeys) || []; } catch { approved = []; } onLists({ minors, approved, nophoto }); }
        else if (d === NOPHOTO_D + pub) { if (!_byChurchOrSteward(e)) return; if (e.created_at < tNophoto) return; tNophoto = e.created_at; try { nophoto = (JSON.parse(e.content).pubkeys) || []; } catch { nophoto = []; } onLists({ minors, approved, nophoto }); }
      },
      oneose() { onLists({ minors, approved, nophoto }); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setNoPhoto(pubkeys) {   // replace the whole photo-suppression list (church-signed, owner-only)
    _requireTrustedView('photo settings');
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', NOPHOTO_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },
  setMinors(pubkeys) {   // replace the whole minors list (pass hex pubkeys)
    _requireTrustedView('list of children');
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MINORS_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },
  setApproved(pubkeys) {   // replace the whole approved-adults list (pass hex pubkeys)
    _requireTrustedView('cleared-adults list');
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
        // SECURITY-AUDIT-2026-07-20 C1 (CRITICAL): `parent` came from the event CONTENT, so any member could
        // publish guardreq:<someone else's pubkey> naming themselves as the parent — and one routine-looking
        // "Confirm" made them that child's guardian (guardianLinked() is checked BEFORE the minor gate, so it
        // bought DM access to a child without youth clearance). Naming an ADULT as the child silently marked
        // that adult a minor. The parent is now ALWAYS the signer, which is the one field a forger can't lie
        // about. The claimed names stay untrusted display strings — the UI labels them "claims to be" and
        // shows both npubs, exactly as the steward-approval card already does.
        else { try { const c = JSON.parse(e.content); if (c.child && c.child !== child) return; byChild.set(child, { child, parent: e.pubkey, claimedParentName: c.parentName || '', claimedChildName: c.childName || '', ts: e.created_at }); } catch {} }
        onReqs([...byChild.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      },
      oneose() { onReqs([...byChild.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0))); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  subscribeGuardians(onMap) {   // the church's confirmed map → { childPub: [parentPub, …] }
    let cur = {}, latest = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== GUARDIANS_D + pub) return;
        if (_authFuture(e) || !_byChurch(e)) return;   // OWNER-ONLY safeguarding doc
        if (e.created_at < latest) return; latest = e.created_at;   // newest wins — a stale copy must not restore a removed guardian link
        try { cur = (JSON.parse(e.content).links) || {}; } catch { cur = {}; }
        onMap(cur);
      },
      oneose() { onMap(cur); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setGuardians(links) {   // replace the whole parent↔child map: { childPub: [parentPub, …] }
    _requireTrustedView('parent links');
    if (!sk) return Promise.resolve(null);
    const clean = {};
    for (const [c, ps] of Object.entries(links || {})) { const arr = [...new Set((ps || []).filter(Boolean))]; if (c && arr.length) clean[c] = arr; }
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GUARDIANS_D + pub], ['t', NET]], content: JSON.stringify({ links: clean }) }, sk));
  },
  // safeguarding v2: tell a STEWARD-LINKED parent (who never set the child up on their own device, so has no
  // local record) that they're now a guardian — otherwise the child never appears in their app. Church-signed,
  // p-tagged to the parent, content NIP-44-ENCRYPTED to them: only that parent can read the child's key + name,
  // so the parent<->child link never leaks in cleartext (the authoritative map stays the gated guardians: doc).
  // d keyed by the parent alone, so even the tag doesn't reveal which child. (First parents self-request, so they
  // already have the child locally — this is only for steward-initiated links.)
  notifyGuardian(parentPubIn, childPubIn, childName) {
    if (!sk) return Promise.resolve(null);
    const parentPub = toPubHex(parentPubIn), childPub = toPubHex(childPubIn);
    if (!parentPub || !childPub || parentPub === childPub) return Promise.resolve(null);
    let content;
    try { content = nip44e(JSON.stringify({ child: childPub, name: childName || '', church: churchPub }), nip44ck(sk, parentPub)); }
    catch (e) { return Promise.resolve(null); }
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GUARDNOTICE_D + parentPub], ['t', NET], ['p', parentPub]], content }, sk));
  },

  // ---- joining: by default anyone with the invite/QR joins instantly. A steward can switch on
  // "require approval", and then a new member is held as a pending request until admitted. The relay
  // reads joinpolicy:<churchpub> + the admitted:<churchpub> allowlist and withholds posting until then. ----
  subscribeJoinPolicy(onPolicy) {   // onPolicy(true|false) — does joining need approval?
    let approval = false, latest = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== JOINPOLICY_D + pub) return;
        if (_authFuture(e) || !_byChurchOrSteward(e)) return;   // church or a rostered steward may set the join policy
        if (e.created_at < latest) return; latest = e.created_at;   // newest wins — a stale copy must not silently turn approval back off
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
    let cur = [], latest = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== ADMITTED_D + pub) return;
        if (_authFuture(e) || !_byChurchOrSteward(e)) return;   // church or a rostered steward may admit members
        // newest wins — a stale copy drops recently-approved members back into "waiting to join"
        if (e.created_at < latest) return; latest = e.created_at;
        try { cur = (JSON.parse(e.content).pubkeys) || []; } catch { cur = []; }
        onList(cur);
      },
      oneose() { onList(cur); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // ── RE-SEAT: a member lost their 12 words and came back on a NEW key ───────────────────────────────
  // Their old key is gone for good — nobody has it, not the church, not us. So this does NOT recover an
  // account; it moves a member's SEAT (their name, their place on the roster) onto the key they have now, on
  // the church's word that they are the same person. Old DMs and sealed care records stay unreadable, which
  // is correct: if a steward's click could open them, the privacy was never real.
  //
  // The authorisation is the steward's deliberate act in their own console against a key they scanned or were
  // given. There is NO one-time token by design — a code that re-seats a member would be a bearer credential
  // to BECOME them, and would be worth stealing.
  subscribeReseats(onList) {   // the church's re-seat pairs → [{ old, new, at }]
    let cur = [], latest = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== RESEAT_D + pub) return;
        if (_authFuture(e) || !_byChurchOrSteward(e)) return;   // church or a rostered steward; the relay enforces this too
        if (e.created_at < latest) return; latest = e.created_at;   // newest wins
        try { cur = (JSON.parse(e.content).pairs) || []; } catch { cur = []; }
        if (!Array.isArray(cur)) cur = [];
        onList(cur);
      },
      oneose() { onList(cur); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setReseats(pairs) {   // replace the whole re-seat map (pass [{old,new,name,at}] with hex pubkeys)
    _requireTrustedView('re-seat map');
    if (!sk) return Promise.resolve(null);
    // `name` carries the member's DISPLAY NAME across with the seat. Without it a re-seat moved a pubkey and
    // nothing else: roster names come from each key's own kind-0, the old key is filtered out of the roster
    // entirely, and a member arriving by the "I've lost my 12 words" route has never passed through the name
    // step — so "Maria" vanished and was replaced by "Anonymous …abc123", while three screens promised her
    // name would come back. AUDIT-2026-07-26 CRITICAL 3. The member's app adopts it as their OWN kind-0 the
    // moment the doc arrives (fellowship.src.js _noteReseat), so this is a bootstrap value, not a permanent
    // override: if they rename themselves later, their own profile wins everywhere as it always did.
    const clean = (pairs || [])
      .filter(p => p && /^[0-9a-f]{64}$/i.test(p.old || '') && /^[0-9a-f]{64}$/i.test(p.new || '') && p.old !== p.new)
      .map(p => {
        const nm = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        const out = { old: p.old.toLowerCase(), new: p.new.toLowerCase(), at: p.at || Math.floor(Date.now() / 1000) };
        if (nm) out.name = nm;
        return out;
      });
    // feChurch, NOT finalizeEvent: a DELEGATED steward signs with their own key, and only the ['church',<cp>]
    // stamp it adds makes the doc match the member app's subscription (authors:[cp] OR #church:[cp]). Without
    // it the relay would still store and gate the doc correctly, but no member would ever receive it — the
    // church would keep showing two of the same person and the reconnect would look like it did nothing.
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', RESEAT_D + pub], ['t', NET]], content: JSON.stringify({ pairs: clean }) }));
  },
  setAdmitted(pubkeys) {   // replace the whole admitted list (pass hex pubkeys)
    _requireTrustedView('approved-members list');
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ADMITTED_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },

  // ---- delegated stewards: the OWNER (this church key) signs a roster of co-steward pubkeys. The relay
  // grants those keys day-to-day church powers (but never the roster/blocklist/relay-policy — owner-only),
  // and revocation = re-publish the roster without them. See STEWARD-ROSTER-DESIGN.md. ----
  subscribeStewards(onList) {   // the current steward roster → [hex pubkeys]
    let cur = [], latest = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== STEWARDS_D + pub) return;
        if (_authFuture(e) || !_byChurch(e)) return;   // OWNER-ONLY (this IS the roster; only the church key edits it)
        // newest wins — this is a revocation list: a stale copy would reinstate a steward who was removed
        if (e.created_at < latest) return; latest = e.created_at;
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) cur = [];
        else { try { cur = (JSON.parse(e.content).pubkeys) || []; } catch { cur = []; } }
        onList(cur);
      },
      oneose() { onList(cur); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setStewards(pubkeys) {   // OWNER-ONLY: replace the whole steward roster (pass hex pubkeys)
    _requireTrustedView('steward roster');
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
      id, child: rec.child || '', childName: rec.childName || '', date: rec.date || _todayISO(),
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
    const id = ev.id || ('evt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));   // Date.now() alone collides for rows published in one loop — replaceable docs, so a collision DELETES the first
    const groupId = ev.groupId || '';
    const content = JSON.stringify({ date: ev.date || '', time: ev.time || '', title: ev.title || 'Event', where: ev.where || '', blurb: ev.blurb || '', accent: ev.accent || 'var(--clay)', image: ev.image || '', groupId, recur: ev.recur || '', day: (typeof ev.day === 'number' ? ev.day : null) });
    const tags = [['d', EVENT_D + id], ['t', NET]];
    if (groupId) tags.push(['t', groupId]);   // lets a group's chat filter to its own events
    if (actingChurch) tags.push(['p', actingChurch]);   // delegated steward: p-tag the church so members' group view shows it
    // AUDIT 2026-07-25: publish() never rejects — on total failure it returns false — and this discarded that,
    // resolving with a fabricated success object. Every caller that "awaited the ACK" was awaiting nothing.
    // Resolve null when no relay accepted, so a caller can tell (existing callers ignore the value entirely).
    return publish(feChurch({ kind: 30078, created_at: now(), tags, content }, signer))   // feChurch stamps ['church',cp] in delegated mode so the relay accepts it
      .then((ok) => (ok ? { id, ...JSON.parse(content) } : null));
  },
  removeEvent(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', EVENT_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeEvents(onEvents) { return this._subAddr(EVENT_D, (c) => ({ date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, recur: c.recur || '', day: c.day, groupId: c.groupId || '', image: c.image || '' }), onEvents); },
  // publish a recurring meeting (the church's rhythm): a normal event with recur + day-of-week, expanded into
  // occurrences client-side by expandEvents(). `m` = { id?, title, day (0-6), time, where?, recur, from? (anchor) }.
  publishMeeting(m) { return this.publishEvent({ id: m.id, title: m.title, time: m.time, where: m.where || '', date: m.from || _todayISO(), recur: m.recur || 'weekly', day: m.day, accent: m.accent || 'var(--clay)' }); },
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
        // recur/day/groupId/image MUST be carried: the event dialog opens from this list too, and editing
        // there re-publishes what it was handed. Omitting recur/day collapsed a weekly meeting into a single
        // dated entry; omitting groupId unlinked the event from the very group you edited it in. AUDIT 2026-07-26.
        try { const c = JSON.parse(e.content); byId.set(id, { id, date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, recur: c.recur || '', day: c.day, groupId: c.groupId || groupId, image: c.image || '' }); emit(); } catch {}
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
    // paint the last-known roster instantly so the Members list doesn't flash empty→list on reload
    try { const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); if (Array.isArray(cached)) { cached.forEach(m => { if (m && m.pubkey) byPub.set(m.pubkey, m); }); if (cached.length) onMembers(cached); } } catch {}
    // SECURITY-AUDIT-2026-07-18 (perf): debounce the heavy roster serialize. emit() ran a full sort +
    // JSON.stringify(entire roster) + localStorage write + setState on EVERY incoming event; on a large church's
    // load that was thousands of full-roster serializations. Coalesce to ~150ms (trailing fire keeps final state).
    let emitTimer = null;
    // reseatOld holds the DEAD keys of members who lost their 12 words and were re-seated onto a new one.
    // Without this the church sees the same person twice — the old entry can never post again, but it still
    // sits in the roster, in the member count, and in every picker a steward uses.
    // reseatName is the other half: the display name the church vouched across with the seat. A re-seated key
    // has no kind-0 of its own until the member's app publishes one, so without this the steward's roster
    // showed the person they had just reconnected as "Anonymous …". AUDIT-2026-07-26 CRITICAL 3. It is a
    // FALLBACK only — the key's own profile always wins, so a member who renames themselves is never overridden.
    let reseatOld = new Set(), reseatName = new Map(), reseatAt = 0;
    const emitNow = () => {
      const arr = [...byPub.values()].filter(m => !reseatOld.has(m.pubkey))
        .map(m => (m.name || !reseatName.get(m.pubkey)) ? m : { ...m, name: reseatName.get(m.pubkey), viaReseat: true })
        .sort((a, b) => ((b.lastTs || b.joined || 0) - (a.lastTs || a.joined || 0)));
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); } catch {} onMembers(arr);
    };
    const emit = () => { if (emitTimer) return; emitTimer = setTimeout(() => { emitTimer = null; emitNow(); }, 150); };
    const get = (pk) => byPub.get(pk) || { pubkey: pk, npub: npubEncode(pk), name: '', picture: '', count: 0, lastTs: 0, firstTs: Infinity, joined: 0 };
    // SECURITY-AUDIT-2026-07-18 (perf — "names blank = sub cap"): resolve profiles with ONE batched kind-0
    // subscription (authors:[…]) instead of one sub PER member. Past ~64 members the per-member fan-out saturated
    // the relay's ~64-REQ-per-connection cap: names rendered blank AND co-tenant subs (chat/events) on the same
    // socket starved. The member hub was already batched; the steward roster was not. Debounce so a burst of
    // arrivals coalesces into a single re-subscribe, and keep exactly ONE profile sub open at a time.
    const profWanted = new Set();
    let profSub = null, profTimer = null;
    const rebuildProfSub = () => {
      profTimer = null;
      if (!profWanted.size) return;
      const next = pool.subscribeMany(relays(), [{ kinds: [0], authors: [...profWanted] }], {
        onevent(e) { try { const meta = JSON.parse(e.content); const m = byPub.get(e.pubkey); if (m) { m.name = meta.name || meta.display_name || ''; m.picture = meta.picture || ''; m.nip05 = meta.nip05 || ''; m.av = meta.av || undefined; m.hasPhoto = !!(meta.av && meta.av.kind === 'photo' && meta.av.photo); emit(); } } catch {} },
        oneose() {},
      });
      if (profSub) { try { profSub.close(); } catch {} }   // open the widened sub, THEN close the old one (no gap)
      profSub = next;
    };
    const ensureProfile = (pk) => {
      if (profWanted.has(pk)) return;
      profWanted.add(pk);
      if (!profTimer) profTimer = setTimeout(rebuildProfSub, 400);   // coalesce a burst of new members into one re-sub
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
    // the church's own signed re-seat map (same doc the Reconnect button writes). Its own small subscription:
    // the roster sub above is keyed on ['p',<church>], which a re-seat doc does not carry.
    const reseatSub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== RESEAT_D + pub) return;
        if (_authFuture(e) || !_byChurchOrSteward(e)) return;   // church or a rostered steward only
        if (e.created_at < reseatAt) return; reseatAt = e.created_at;   // newest wins
        const next = new Set(), names = new Map();
        try {
          for (const pr of ((JSON.parse(e.content) || {}).pairs || [])) {
            if (!pr || !pr.old || !pr.new || pr.old === pr.new) continue;
            next.add(String(pr.old).toLowerCase());
            const nm = String(pr.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
            if (nm) names.set(String(pr.new).toLowerCase(), nm);
          }
        } catch {}
        reseatOld = next; reseatName = names; emit();
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} try { reseatSub.close(); } catch {} if (emitTimer) { try { clearTimeout(emitTimer); } catch {} } if (profTimer) { try { clearTimeout(profTimer); } catch {} } if (profSub) { try { profSub.close(); } catch {} } };
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
  // ---- self-hosted "go public" (desktop Suite): make the church reachable from anywhere BEFORE inviting.
  // The console is same-origin with its own relay on loopback; these hit it directly, authing with the token
  // the Suite discloses to a genuine same-machine request (/local-token). All no-ops off the Suite. ----
  isSelfHosted() { return ownIsLoopback(); },
  async tunnelState() {
    if (!ownIsLoopback()) return { supported: false, running: false };
    const tok = await localAdminToken(); if (!tok) return { supported: false, running: false };
    try {
      const r = await fetch('/tunnel/state', { cache: 'no-store', headers: _authHdr(tok) });
      if (!r.ok) return { supported: true, running: false };
      const j = await r.json();
      setSelfPublicRelay(j && j.running && j.wss ? j.wss : '');   // cache the live url, or clear a dead one
      return { supported: true, running: !!(j && j.running), url: (j && j.url) || '', wss: (j && j.wss) || '' };
    } catch (e) { return { supported: true, running: false }; }
  },
  async goPublic() {
    if (!ownIsLoopback()) throw new Error('This device isn’t running its own relay.');
    const tok = await localAdminToken(); if (!tok) throw new Error('Couldn’t reach this computer’s relay.');
    const r = await fetch('/tunnel/up', { method: 'POST', headers: _authHdr(tok) });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j || !j.wss) throw new Error((j && j.error) || 'The tunnel couldn’t open — a VPN, firewall or antivirus may be blocking it. Allow it through (or turn your VPN off) and try again.');
    setSelfPublicRelay(j.wss);
    return { url: j.url || '', wss: j.wss, name: j.name || '' };
  },
  async ownRelayName() {
    if (!ownIsLoopback()) return '';
    const tok = await localAdminToken(); if (!tok) return '';
    try { const r = await fetch('/relay-names/mine', { cache: 'no-store', headers: _authHdr(tok) }); if (!r.ok) return ''; const j = await r.json(); return (j && j.handle) || ''; } catch (e) { return ''; }
  },
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
  // RELAY-AUDIT-2026-07-20 H4: this fired on EVERY console mount (three call sites in steward-root.jsx plus
  // one in stew-dashboard.jsx) and POSTed to the configured relay AND every canonical relay unconditionally.
  // Each distinct church key is a new permanent row on each of those relays, and nothing ever removes one —
  // which is how repeated demo/test runs of "create a church" left 19 tenants on the shared box, most of them
  // nameless because these call sites pass name:''. Registration is a SETUP step, not a heartbeat: remember
  // per (church key, relay) that it succeeded and don't repeat it. `force` re-runs it for the explicit
  // "connect this church to this relay" action, where the operator really is asking.
  async selfRegister(name, opts) {
    if (!churchSk || !churchPub) return;
    const np = npubEncode(churchPub);
    const force = !!(opts && opts.force);
    const bases = new Set([window.Steward.configBase()]);
    for (const r of CANONICAL_RELAYS) bases.add(r.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/relay\/?$/i, ''));
    let done = {};
    try { done = JSON.parse(localStorage.getItem(SELFREG_KEY) || '{}') || {}; } catch (e) {}
    for (const base of bases) {
      const mark = churchPub + '@' + base;
      if (!force && done[mark]) continue;                     // already registered this key with this relay
      const url = base + '/config';
      try {
        const auth = finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', url], ['method', 'POST']], content: '' }, churchSk);
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addChurch: { npub: np, name: name || '' }, auth }) });
        // Only remember a real acceptance. A 400 ("name your church first") or 403 (invite-only / already set
        // up) must stay un-marked so a later, correct attempt is still made.
        if (r && r.ok) { done[mark] = 1; try { localStorage.setItem(SELFREG_KEY, JSON.stringify(done)); } catch (e) {} }
      } catch (e) {}
    }
  },
  // register this church with ONE specific relay by PROVING key ownership (NIP-98 signed by the church key,
  // bound to that relay's /config) — no admin token. Used by "connect by name": after adding a relay, the
  // church self-registers so the relay accepts its posts. Open relays accept it; a restricted one may decline.
  async registerAtRelay(wssUrl, name) {
    if (!churchSk || !churchPub) return { ok: false, error: 'no church key' };
    const base = String(wssUrl || '').replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/relay\/?$/i, '');
    const url = base + '/config';
    try {
      const auth = finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', url], ['method', 'POST']], content: '' }, churchSk);
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addChurch: { npub: npubEncode(churchPub), name: name || '' }, auth }) });
      return { ok: r.ok, status: r.status };
    } catch (e) { return { ok: false, error: (e && e.message) || 'network' }; }
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
    // also forget any name that pointed here, so auto-follow doesn't re-add it
    setNamedRelays(getNamedRelays().filter(e => e.url !== url));
    window.dispatchEvent(new CustomEvent('steward-relays'));
    return true;
  },
  // resolve a relay name → its current record via the mirrored directory (tries several relays; a8 not required)
  resolveRelayName(name) { return resolveRelayName(name); },
  // remember that this relay was reached BY NAME, so auto-follow can track it as the tunnel url rotates
  rememberRelayName(name, url) {
    const n = String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const u = normRelay(url); if (!n || !u) return;
    setNamedRelays([...getNamedRelays().filter(e => e.name !== n), { name: n, url: u }]);
  },
  // FEDERATION Phase 3c — list relays that have OFFERED to host new churches (enforcing + open + live).
  discoverRelayOffers(region) { return discoverRelayOffers(null, region); },
  // set/extend the bootstrap discovery seed (discovery-only relays to probe for offers).
  setDiscoverySeed(urls) { _discoverySeed = [...new Set((urls || []).map(u => normRelay(u)).filter(Boolean))]; return _discoverySeed; },
  // Auto-find + adopt up to n open relays (default 2 = primary + backup, different operators), then re-publish
  // the church's NIP-65 list so members discover them. Additive: only adds relays not already configured.
  // Returns the picked offers (or [] when nothing is open — e.g. the pilot, where it's a safe no-op).
  async autoPickRelays(n) {
    const offers = await discoverRelayOffers(null, null);
    const have = new Set(relays());
    const picks = pickRelays(offers.filter(o => !have.has(o.url)), n || 2);
    for (const p of picks) { try { window.Steward.addRelay(p.url); } catch (e) {} }
    if (picks.length) { try { await (window.Steward.publishRelayList ? window.Steward.publishRelayList() : null); } catch (e) {} }
    return picks;
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
    // PERF (audit 2026-07-24): this was `[{authors:[pub]}, {'#p':[pub]}]` — no kinds, no limit. On the relay a
    // kind-less tag filter cannot use an index, so it walks and JSON-parses the WHOLE table (one steward opening
    // a dashboard drove a full-table parse on a shared relay), and it pulled up to 10k events over a member's
    // data plan to display two integers. emit() also ran per arriving event. Narrow, cap, and coalesce.
    let _statsT = null;
    const emit = () => { if (_statsT) return; _statsT = setTimeout(() => { _statsT = null; onStats({ events: ids.size, announcements: ann.size }); }, 120); };
    const sub = pool.subscribeMany(relays(), [{ kinds: [1, 30078], authors: [pub], limit: 500 }, { kinds: [1, 30078], '#p': [pub], limit: 500 }], {
      onevent(e) { ids.add(e.id); if (e.kind === 1 && e.pubkey === pub) ann.add(e.id); emit(); },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // a live, recent activity feed derived from real events (groups, joins, posts) — newest first
  subscribeActivity(onActivity, max = 12) {
    const byId = new Map();
    // PERF (audit 2026-07-24): unbounded filters feeding a full sort+slice PER ARRIVING EVENT — O(n² log n)
    // across a backfill, ~60M comparisons at 5k events on a phone, to render `max` (12) rows. Cap the pull and
    // coalesce the rebuild to one per tick.
    let _actT = null;
    const emit = () => { if (_actT) return; _actT = setTimeout(() => { _actT = null; onActivity([...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, max)); }, 120); };
    const sub = pool.subscribeMany(relays(), [{ kinds: [1, 30078], authors: [pub], limit: 200 }, { kinds: [1, 30078], '#p': [pub], limit: 200 }], {
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
    // Self-hosted on loopback (the desktop Suite): ownRelay() is ws://127.0.0.1 — meaningless to a member.
    // Share the public tunnel url the relay exposes once "go public" is on (empty until then; the setup wizard
    // gates the invite on turning it on, so by the time a QR is handed out this carries a reachable address).
    const relay = (ownIsLoopback() && selfPublicRelay()) ? selfPublicRelay() : ownRelay();
    // Also carry the relay's STABLE directory name when self-hosted: the tunnel url above rotates on restart, so
    // a printed QR's &relay= can go dead — the member resolves &relayname= to the relay's CURRENT url instead.
    const nm = ownIsLoopback() ? selfRelayName() : '';
    return base + '/?follow=' + np + '&relay=' + encodeURIComponent(relay) + (nm ? '&relayname=' + encodeURIComponent(nm) : '');
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
