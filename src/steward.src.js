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
// The pool keys its relay map by NORMALIZED url, so relaysHealthy() has to normalise the same way or every
// lookup misses and the health check silently answers about nothing. Use the library's own function rather
// than a hand-rolled one, so the two can never drift.
import { normalizeURL } from 'nostr-tools/utils';
import { finalizeEvent, getPublicKey, generateSecretKey } from 'nostr-tools/pure';
// Subpath imports, matching src/identity.src.js — the wordlist is needed to CHECKSUM a restored church phrase
// (see restoreKey). Twelve arbitrary words otherwise derive a valid-looking key over the wreckage of the real one.
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';
import { encrypt as nip04encrypt, decrypt as nip04decrypt } from 'nostr-tools/nip04';
import { encrypt as nip44e, decrypt as nip44d, getConversationKey as nip44ck } from 'nostr-tools/nip44';
import qrcode from 'qrcode-generator';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
// Rules the member app has to agree with, written once. See scripts/trinity-rules.mjs.
// ARCHITECTURE-2026-07-29.
import { pubSet, isPhotoSuppressed } from '../scripts/trinity-rules.mjs';

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
const ROTA_SETTINGS_D = 'trinityone/rota-settings'; // single church-signed doc — who may FETCH rota:/runsheet:
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
const NAMEKEY_D = 'trinityone/namekey:';   // per-church name key, wrapped per member (ring: current first)
const NAME_RING_MAX = 12;   // same bound as the care key: the ring is sealed PER RECIPIENT, so it multiplies

// ---- WHEN AND WHERE THIS CHURCH GATHERS — sealed under the church's name key ----
//
// Measured 2026-08-15 against the relay's own sqlite: `event` was stored as
// {"date":"2026-07-24","time":"10:30","title":"Sunday Service","where":"…"} in the clear, and `service`,
// `room`, `booking` and `rota` repeated it. For a congregation where meeting is the risk, that is the most
// dangerous thing in the database — handing over the relay hands over the address and the timetable.
// Members' NAMES were already sealed; the gatherings they attend were not.
//
// These five are encryptable at no cost to relay policy because the relay never opens them — it routes on
// the `d` tag and the author only. (minors/approved/guardians/admitted/stewards/group/sermon are different:
// the relay parses those to enforce rules server-side, so sealing them would move enforcement to clients.
// Out of scope deliberately — see reference/PLAN-2026-08-15-CLEARTEXT.md.)
//
// The name key is reused rather than a fourth per-church key being minted: it already reaches every member
// as a per-recipient envelope, already rotates on block, is already fitted to the 1 MB ceiling, and already
// survives an offline cold start. A fourth ring would be a fourth copy of every failure mode that took this
// week to fix. The cost, stated: whatever exposes the name key exposes the timetable — but both are held by
// the same set of people, so they were always going to fall together.
//
// FAIL OPEN, DELIBERATELY, AND ONLY HERE. With no ring the document is written in cleartext rather than
// refused. A church whose key has not arrived must still be able to run its calendar, and unlike the chat
// send there is no label promising otherwise — nothing here claims a protection it is not delivering. The
// console warns so it is not silent.
function _sealChurchDoc(obj) {
  const body = JSON.stringify(obj);
  const k = _nameKeyRing[0];
  if (!k) { console.warn('[steward] no church name key yet — writing this document in cleartext'); return body; }
  try { return JSON.stringify({ e: nip44e(body, _unhex(k)) }); } catch (e) { return body; }
}
// Cleartext first (every document written before this shipped), then every key in the ring so a rotation
// never hides the church's own history. Returns null when it is sealed and we hold no key for it — the
// caller must show that as "waiting for your key", never as an empty calendar.
function _openChurchDoc(content) {
  try { const o = JSON.parse(content); if (!o || typeof o.e !== 'string') return o; } catch (e) { return null; }
  const ct = JSON.parse(content).e;
  for (const k of _nameKeyRing) { try { return JSON.parse(nip44d(ct, _unhex(k))); } catch (e) {} }
  return null;
}

const NAME_D = 'trinityone/name:';         // a member's own display name for this church, sealed under it
const CLEARANCE_D = 'trinityone/clearance:';   // a member's OWN safeguarding status, NIP-44 sealed to them
// memberPubHex -> { minor, cleared, at } for clearances THIS console has just published. Read-before-write
// (refreshClearances) covers what the relay already holds; this covers the second or two before the relay has
// echoed it back, which is exactly the window in which the toggle path and the roster back-fill collide.
const _clearanceSent = new Map();
const _returnAnnounced = new Map();   // url -> the relay instance whose return we have already announced
// refreshClearances runs strictly one at a time (see the note on that method). Module scope, so the toggle
// path and the roster back-fill share the queue even though they are called from different places.
let _clearanceQueue = Promise.resolve();
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

// SEAL ONE COPY PER MEMBER, WITHOUT FREEZING THE SCREEN.
//
// Every key envelope in this file holds a separately-sealed copy of the ring for each member, and sealing
// costs ~5 ms per member on a workstation — several times that on a phone. Done in one synchronous loop, a
// church of 500 locks the console for about eight seconds per key, and blocking someone rotates three of
// them. Nothing is drawn and nothing responds for that whole time; the steward has just tapped a destructive
// button and cannot tell whether it worked.
//
// Yielding between small chunks costs a few milliseconds of wall clock and gives the browser its thread back,
// so the console keeps painting and an `onProgress` can say how far it has got. The five call sites shared
// one loop shape and now share one implementation — a per-member seal that forgot to yield is exactly the
// kind of thing that gets copied a sixth time.
async function _sealEach(payload, targets, sealTo, onProgress) {
  const keys = {};
  const list = [...targets];
  for (let i = 0; i < list.length; i++) {
    const mp = list[i];
    try { keys[mp] = sealTo(payload, mp); } catch (e) {}
    // every 25, hand the thread back — small enough that the longest blocking stretch stays around 125 ms
    if ((i % 25) === 24) {
      if (onProgress) { try { onProgress(i + 1, list.length); } catch (e) {} }
      await new Promise(r => setTimeout(r, 0));
    }
  }
  if (onProgress) { try { onProgress(list.length, list.length); } catch (e) {} }
  return keys;
}

const CARENEED_D = 'trinityone/care:';   // a care need — its sealed half depends on the care key existing
let _careKeyHex = null;          // this device's copy of the church care key (the CURRENT one = ring[0])
let _careKeyRing = [];           // current key first, then superseded ones — so rotation never orphans old ciphertext
let _careKeyDocKeys = null;      // the envelope's wrapped-per-member map (to detect who is missing)
let _careKeyRev = 0;             // envelope revision — rotation is NOT wired yet, but readers must tolerate it
let _careKeyChecked = false;     // have we actually LOOKED for an envelope? mint gate — see (1) above
let _careRoster = new Set();     // the church's current steward pubkeys — who may author the envelope
// HAVE WE ACTUALLY SEEN A ROSTER, as opposed to simply not having one yet? An empty set means both, and the
// difference decides whether a steward-authored clearance is "an author the member honours" or "nobody".
// Reading it as the latter during the boot race turned the cross-author check off and skipped the member.
// Set only when a roster DOCUMENT has been read — not on the React round-trip through setCareRoster, whose
// initial value is [] and which therefore cannot distinguish the two. AUDIT-8 (2026-08-01).
let _careRosterKnown = false;
const MEDIAKEY_D = 'trinityone/mediakey:';   // Tier 2 encryption: a per-church AES-GCM media key, wrapped to each member (mirrors the group-key envelope)
let _mediaKeyHex = null;                       // this device's cached copy of the church media key (= ring[0])
let _mediaKeyRing = [];                        // current key first, then superseded — rotation must never orphan an encrypted sermon
let _mediaKeyDocKeys = null;
// HAVE WE ACTUALLY LOOKED for an envelope? The care key has this flag and the name key has this flag; the
// media key had neither, and its guard tested relay AUTHENTICATION instead — which is one round trip, while
// the church's document corpus is not. So a console restored from the 12 words, authenticated and writing,
// could still be waiting for the envelope when a steward uploaded a sermon: it minted a fresh key and
// REPLACED the church's envelope, and every sermon, audio file and video the church had ever encrypted became
// permanently undecryptable — by the church and by every member — with no warning and a successful upload.
// Reproduced three times, including deterministically with the envelope held back on a slow link.
// AUDIT 2026-08-02.
let _mediaKeyChecked = false;    // set only from subscribeMediaKey's oneose — see the mint gate                   // the latest media-key doc's wrapped-per-member map (to detect members not yet keyed)
async function _sha256hex(u8) { const d = await crypto.subtle.digest('SHA-256', u8); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); }
const JOINPOLICY_D = 'trinityone/joinpolicy:'; // join policy {approval:bool}, d=joinpolicy:<churchpub>
const ADMITTED_D = 'trinityone/admitted:';   // approved-members allowlist (when approval is on), d=admitted:<churchpub>
const RESEAT_D = 'trinityone/reseat:';       // church-vouched "the member who was <old> is now <new>", d=reseat:<churchpub>
// The capability map from the live roster: { "<steward pubkey>": ["finance", …] }. A steward who does not
// appear here holds every capability, which is what every roster written before capabilities existed means.
let _stewardCaps = {};
// WHAT THE OWNER CALLS EACH STEWARD. The console derives a friendly name from the key ("Gentle Cedar 36"),
// which is stable and unguessable — and is NOT the name the owner typed. An owner who has just added Tom,
// Grace and Rhys sees three invented names and can only tell them apart by the order they were added. Their
// own words, 2026-08-19: "a mis-pasted code is a stranger with everything and I'd never spot it." So the
// roster carries the owner's own label for each key, and the row leads with it.
let _stewardNames = {};
const STEWARD_CAPS = ['finance', 'care', 'safeguarding', 'members', 'content'];
const FINKEY_D = 'trinityone/financekey:';   // the church books' key, wrapped per reader (owner-signed)
let _finRing = [];        // hex keys for the books, newest first; the last entry is the legacy self-key
let _finDocKeys = null;   // the envelope's key map as last seen (null = we have never seen one)
let _finRev = 1, _finAt = 0;
// Only a console holding the CHURCH key can derive the key the existing books are sealed with. `sk` is the
// signing key of whoever is acting; in delegated mode that is the steward's own, so this is also the honest
// test for "am I the owner".
const churchSkHeld = () => !actingChurch && !!churchSk && !!churchPub;
const _legacyBookKeyHex = () => { try { return churchSkHeld() ? _hex(nip44ck(churchSk, churchPub)) : ''; } catch (e) { return ''; } };
const STEWARDS_D = 'trinityone/stewards:';   // delegated, revocable steward roster (owner-signed), d=stewards:<churchpub>; see STEWARD-ROSTER-DESIGN.md
const STEWARDREQ_D = 'trinityone/stewardreq:'; // a would-be steward's request to a church (requester-signed), d=stewardreq:<churchpub>; the owner approves it into the roster
const PIN_D = 'trinityone/pin:';            // a group's pinned message, d=pin:<groupId> (one per group; empty/deleted = unpinned)
const HIDE_D = 'trinityone/hidden:';        // a removed/hidden message, d=hidden:<msgId> (one per message; deleted = restored)
const GROUPKEY_D = 'trinityone/groupkey:'; // church-signed key envelope for an encrypted group
const _skeys = {};   // groupId -> KEY RING [current, ...superseded], each Uint8Array(32) (church-side cache)
const GROUP_RING_MAX = 12;   // bound the envelope, and match the care key's ring exactly (see _careKeyRing).
// 32 was too many now that every envelope carries the ring sealed PER RECIPIENT: a large church multiplied
// that by its member count and pushed the event past the relay's 1 MB maxPayload. AUDIT-2026-07-27.
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
  try {
    const env = JSON.parse(e.content || '{}'); _srev[gid] = env.rev || 1;
    const mine = env.keys && churchPub && env.keys[churchPub];
    if (mine && churchSk) {
      const plain = nip44d(mine, nip44ck(churchSk, e.pubkey));
      let ring = null;
      try { const p = JSON.parse(plain); if (Array.isArray(p)) ring = p.filter(x => typeof x === 'string' && /^[0-9a-f]+$/i.test(x)); } catch (x) {}
      _skeys[gid] = (ring && ring.length ? ring : [plain]).map(_unhex);   // legacy envelopes hold a bare hex string
    }
  } catch {}
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
// this says "no needs" — but the _isRelayAuthed() guard has already blocked that case before we get here.
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
// Are we looking at a NETWORK identity rather than a church? A network has no members and no safeguarding
// lists, and setActiveIdentity's network branch sets `pub` to the network's own key with no actingChurch — so
// `actingChurch || pub` resolves to a key that is nobody's church. AUDIT-7: that made the clearance ranking
// treat this console as outranking everyone including the real church key, and made the "is this copy from a
// writer the member honours" filter compare against the wrong church entirely. The honest answer is that the
// clearance back-fill has no business running at all in this view.
const _viewingNetwork = () => pub !== churchPub && !actingChurch;

function _requireTrustedView(what) {
  if (_isRelayAuthed()) return;
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
  // ALWAYS THE SHARED PUBLIC POOL, not only when this console happens to sit on it. Owner's model, 2026-08-18:
  // nobody picks relays — the console and every member use the same default public set, and the church's rules
  // (block, minors, approved, guardians, group definitions) must be published to ALL of it so each relay
  // enforces from its own copy. This fanned out only when `own === CANONICAL_RELAY`, so a console on a
  // self-hosted / dev / funnel relay published the church's rules to that ONE relay while members still read
  // from the canonical set — and a member banned from a funnel-based console read the adult group from two
  // canonical relays that never received the block (measured). The own relay stays first (fastest, and works
  // even when the shared hosts are blocked); canonical is always appended so the traffic and the rules land on
  // the same relays. The genuinely self-hosted PRIVATE church that wants NO public reach is the opt-in
  // exception (ROADMAP §4/§6a), not built here.
  for (const r of CANONICAL_RELAYS) { if (r && !out.includes(r)) out.push(r); }
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
// DOES THIS RELAY ACTUALLY ENFORCE THE RULES? Ask it to break them and see whether it does.
//
// Auto-find used to keep a candidate if its own NIP-11 said `enforces: true`. That field is simply
// `CHURCH_PUBS.size > 0` — a relay reporting on itself — so anyone could stand up a relay, register one dummy
// church, advertise an offer and be picked. A picked relay then receives EVERYTHING the console publishes,
// because publish() fans out to relays(). The comment claiming the NIP-11 probe made a dishonest entry
// impossible was true only of a stale DIRECTORY entry, never of a relay lying about itself. AUDIT-2026-07-27.
//
// So: test the behaviour. A throwaway key tries to write two church-authority documents for a church that does
// not exist on that relay. A relay that enforces the write policy refuses both; a permissive or hostile one
// accepts them — and a relay that will accept a stranger's safeguarding list is not one to hand a roster to.
// Both probes are refused by a compliant relay, so this leaves nothing behind on an honest box.
//
// What this cannot prove: that the operator is not simply reading their own database. Nothing remote can. It
// raises the floor from "says the right thing" to "does the right thing".
function _probeRelayEnforces(wssUrl, timeoutMs) {
  return new Promise((resolve) => {
    let ws = null, done = false;
    const results = [];
    const finish = (ok, why) => { if (done) return; done = true; try { ws && ws.close(); } catch (e) {} resolve({ ok, why }); };
    const to = setTimeout(() => finish(false, 'no answer'), timeoutMs || 8000);
    try { ws = new WebSocket(wssUrl); } catch (e) { clearTimeout(to); return finish(false, 'unreachable'); }
    const sk = generateSecretKey();
    const ghost = getPublicKey(generateSecretKey());   // a church pubkey this relay has never heard of
    const probes = [
      { d: 'trinityone/minors:' + ghost, what: 'a stranger’s list of children' },
      { d: 'trinityone/stewards:' + ghost, what: 'a stranger’s steward roster' },
    ];
    const ids = new Map();
    ws.onopen = () => {
      for (const pr of probes) {
        const evt = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', pr.d], ['t', NET]], content: JSON.stringify({ pubkeys: [] }) }, sk);
        ids.set(evt.id, pr);
        try { ws.send(JSON.stringify(['EVENT', evt])); } catch (e) {}
      }
    };
    ws.onerror = () => { clearTimeout(to); finish(false, 'unreachable'); };
    ws.onclose = () => { clearTimeout(to); if (!done) finish(false, 'closed early'); };
    ws.onmessage = (m) => {
      let msg = null; try { msg = JSON.parse(m.data); } catch (e) { return; }
      if (!Array.isArray(msg) || msg[0] !== 'OK' || !ids.has(msg[1])) return;
      const pr = ids.get(msg[1]); ids.delete(msg[1]);
      if (msg[2] === true) { clearTimeout(to); return finish(false, 'it accepted ' + pr.what); }   // decisive
      results.push(pr.d);
      if (!ids.size) { clearTimeout(to); finish(true, 'refused both probes'); }
    };
  });
}
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
    if (!(t && t.enforces === true && t.open === true && !t.full)) return null;   // its own claim: necessary, not sufficient
    // …and now make it prove it. `enforces` is self-reported; a relay that will accept a stranger's
    // safeguarding list must never be offered as a place to put a congregation's roster.
    const canonical = (CANONICAL_RELAYS || []).includes(url);
    if (!canonical) { const v = await _probeRelayEnforces(url); if (!v.ok) { try { console.warn('[relay-offers] rejected', url, '—', v.why); } catch (e) {} return null; } }
    return { url, operator: t.operator || '', region: t.region || '', churches: t.churches || 0, name: t.name || '' };
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
// HANDOFF-2026-07-31 (4). Relays this console has actually TRIED to open, by normalised url. relaysHealthy()
// needs this because nostr-tools does not record a dead relay as down — `ensureRelay` sets
// `relay.onclose = () => this.relays.delete(url)` and `enableReconnect` is false, so a dropped relay has no
// entry in `listConnectionStatus()` at all and `st.get(url)` is `undefined`, never `false`.
//
// "Tried", not "succeeded", so a relay that has never once opened still counts as unhealthy — otherwise a
// console pointed at a relay it cannot reach sits there believing it is fine and never retries.
//
// The set stays EMPTY until something is attempted, which is what keeps boot healthy. That matters more than
// it looks: the reconnect ticker fires when relaysHealthy() is false, and the steward subscriptions are broad
// and un-cursored, so a console that reads unhealthy at boot re-queries the entire church immediately and then
// every 90 seconds. Blind-and-quiet and storming-the-relay are the same size of bug with opposite signs.
const _relaysTouched = new Set();
// WHICH SOCKET OUR SUBSCRIPTIONS LIVE ON, per normalised url. AUDIT-4, and this is the load-bearing detail:
// nostr-tools fires onRelayConnectionSuccess ONLY from its subscribe path, never from publish. So a socket
// re-opened by an ordinary write does not advance this — which is exactly the case that used to hide the
// fault. relaysHealthy() compares it against the live instance, so "connected again" is not mistaken for
// "listening again".
const _subbedOn = new Map();
pool.onRelayConnectionSuccess = (url) => {
  try {
    const live = pool.relays.get(url);
    const fresh = live && _subbedOn.get(url) !== live;
    _relaysTouched.add(url);
    // FIRST CONNECT ONLY. AUDIT-5: this used to record on every successful connect, and the reasoning behind
    // that — "nostr-tools fires this only from its subscribe path, never from publish" — was true but useless,
    // because subscribeMap backs subscribeMany/subscribeEose/querySync/get as well. So every ONE-SHOT READ
    // (_one(), _newestByD(), a roster refresh, read-before-write itself) re-opened the socket, recorded it as
    // "this is where we are subscribed", and then CLOSED, leaving nothing listening. The console then called
    // itself healthy, the ticker returned at its first line, and it stayed deaf and write-locked for the
    // session — the exact state this machinery exists to prevent, reachable by the commonest user action
    // after a relay restart.
    //
    // A read must not be able to claim "we are listening here". Only the initial connect seeds this, and only
    // markResubscribed() — called by the ticker AFTER it has actually rebuilt the subscriptions — refreshes it.
    // Never record `undefined`: the socket can close between ensureRelay resolving and this callback, and a
    // stored undefined short-circuits the instance comparison for that url.
    if (live && !_subbedOn.has(url)) _subbedOn.set(url, live);
    // A RELAY JUST (RE)CONNECTED, so what we believe is stored may be incomplete: read-before-write only ever
    // skipped members on the strength of the relays reachable AT THE TIME, and this one may have missed
    // writes while it was away. Drop the just-published cache so the next back-fill genuinely re-reads rather
    // than skipping from memory. Cheap — the cache is roster-sized and only suppresses redundant writes.
    // AUDIT-4: this is the reconciliation trigger for a relay that was down when a clearance was written.
    // …and tell the UI, so the back-fill's session marker is released. Clearing the cache alone was not enough:
    // stew-dashboard records a completed run against the roster signature and early-returns while it is
    // unchanged, so a relay coming back mid-session was never reconciled until the console was reloaded. The
    // handoff described same-session healing as something that "often will not" work; AUDIT-8 measured that it
    // never did by itself. A returning relay is precisely when a re-check is worth doing.
    // ONCE PER RETURN, not once per subscribe. nostr-tools calls onRelayConnectionSuccess from subscribeMap
    // unconditionally — on every subscription, not only on a new socket — and `_subbedOn` is refreshed only by
    // the 90s reconnect ticker. So after a single drop this fired on every chunk read, and since the listener
    // also cleared the back-fill cooldown, read-before-write cancelled its own completion marker and looped:
    // measured at 8 full-roster re-seals against 1. Keyed on the live relay INSTANCE, so a genuine reconnect
    // (which creates a new AbstractRelay) announces exactly once. AUDIT-9.
    if (fresh) {
      _clearanceSent.clear();
      if (_returnAnnounced.get(url) !== live) {
        _returnAnnounced.set(url, live);
        try { window.dispatchEvent(new CustomEvent('steward-relay-returned', { detail: { url } })); } catch (e) {}
      }
    }
  } catch (e) {}
};
pool.onRelayConnectionFailure = (url) => { try { _relaysTouched.add(url); } catch (e) {} };
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
// HANDOFF-2026-07-31 (5). This used to be a single `let _relayAuthed = false` set to true on the first signed
// challenge and NEVER cleared — observed still true with the relay killed. After a drop the pool re-subscribes
// on a fresh, unauthenticated socket while the flag still says authed, which is precisely the window every
// comment below warns about: a private doc is served only to an authenticated reader, so an unauthenticated
// connection answers "nothing" for a church that HAS a key. Minting on that answer orphans every sealed name
// or care need; writing a list on it hard-deletes the real list.
//
// So there is no flag to forget to reset. Record WHICH SOCKET we authenticated on, and answer the question by
// asking the pool whether that same socket is still the live one.
//
// KEYED ON THE RELAY OBJECT, NOT THE URL, and this is the whole point. Auth belongs to a connection, not a
// hostname. A url-keyed version of this shipped for an afternoon and was caught by audit: kill the relay, let
// the pool reconnect on a REQ the gateway's lazy NIP-42 does not challenge, and the new socket has never signed
// anything — but the url is back in listConnectionStatus() as `true`, so it reported authed again. Measured:
//     connected = true, relayAuthed() = true, challenge never sent.
// Every mint gate and list write is open in that state, which is the destructive direction. `ensureRelay`
// constructs a NEW AbstractRelay after a close, so comparing object identity makes a reconnect read
// unauthenticated until it has actually re-authed.
//
// Note the honest limit, unchanged from before: this records that we SIGNED the challenge, not that the relay
// accepted it. Narrowing that further would need the relay's OK on the auth event, which nostr-tools does not
// surface here.
const _authedRelays = new Map();   // normalised url -> the AbstractRelay instance that signed the challenge
pool.automaticallyAuth = (url) => async (authEvent) => {
  if (!sk) throw new Error('no key');
  // SIGN FIRST, RECORD SECOND. Recording before signing means recording "this relay challenged us", not "we
  // answered" — and if signing throws, nostr-tools logs `subscribe auth function failed`, never sends the AUTH
  // frame, and the socket stays anonymous while the console reports itself authenticated. Not hypothetical:
  // an identifier mismatch produced exactly that during testing on 2026-07-31 — `_isRelayAuthed()` returned
  // true on a socket that had signed nothing, and every private read came back empty as a result.
  const signed = finalizeEvent(authEvent, sk);
  let k = url; try { k = normalizeURL(url); } catch (e) {}
  try { _authedRelays.set(k, pool.relays.get(k)); } catch (e) {}
  return signed;
};
// Are we currently connected, on the SAME socket we authenticated on, to a relay we are actually using?
// Ambiguity resolves to FALSE — including the catch. A spurious false makes the guards refuse a write, which is
// visible to the steward and retryable; a spurious true silently destroys a church's keys or its safeguarding
// list. Intersected with relays() for the same reason relaysHealthy() is: a socket to a relay this console has
// since stopped using must not vouch for the view we are reading now.
function _isRelayAuthed() {
  try {
    const st = pool.listConnectionStatus();
    for (const url of relays()) {
      let k = url; try { k = normalizeURL(url); } catch (e) {}
      const authedOn = _authedRelays.get(k);
      if (authedOn && st.get(k) === true && pool.relays.get(k) === authedOn) return true;
    }
    return false;
  } catch (e) { return false; }
}
// AUDIT-2026-07-28 F6. Pubkeys whose uploaded photo a steward has switched off. The MEMBER app has always
// honoured this (fellowship.src.js _avSuppressPhoto, called inside displayFor so every surface inherits it);
// the console had no equivalent, so a photo suppressed for safeguarding still drew on the steward's own
// members list — the exact screen where someone would be moderating an image of a child, with a button
// beside it promising the opposite. Module-level and fed by subscribeSafeguard, mirroring the member app.
let _noPhoto = new Set();
const _applyNoPhotoList = (list) => { _noPhoto = pubSet(list); };   // shared normalisation — scripts/trinity-rules.mjs
// AUDIT-2026-08-10 item B. The blocklist the recipient builders consulted was the SUBSCRIBED copy, which
// round-trips through the relay — so the console that performs a block re-keyed the blocked member back in
// through its own stale React state: block() rotates them out, the roster effect re-runs with the old
// blockedList, and the grow-never-shrink merge re-adds them from the old envelope's recipient map. Kept in
// sync SYNCHRONOUSLY at the top of setBlocked (full replacement, so unblock works too), and consulted inline
// by every recipient builder. Memory-only and starts empty, so a console that did not perform the block
// fails OPEN toward the subscription list — sync knowledge where we have it, subscription elsewhere. Hex is
// lowercased on both sides (the blockedSet normalisation), because a case-mismatch here would silently drop
// LEGITIMATE members from envelopes.
let _localBlocked = new Set();
// WHO MAY CREATE AN EVENT IN A GROUP. Order matters: index 0 is the default and is never written to the
// document, so a church that has not touched this setting publishes exactly the group definition it always
// did. 'leaders' is that default because it is what the relay has always enforced — the named leaders may
// post events, and a group naming nobody is stewards-only as a consequence.
const EVENT_POLICIES = ['leaders', 'stewards', 'everyone'];
let _nameKeyRing = [];   // hex keys, current first — see ensureNameKeyForMembers
// ONE NAME-KEY PUBLISH AT A TIME. ensureNameKeyForMembers assigns the new ring synchronously and only
// updates the recipient map after the envelope publishes — a gap that used to be nanoseconds. Sealing
// per member and yielding every 25 stretched it into SECONDS on a large church, and the roster tick
// (stew-dashboard.jsx:312) re-fires whenever the blocked list changes, which a Block does. A second call
// landing in that gap sees the new ring alongside the STALE recipient map, takes the grow-never-shrink
// path, and republishes the name key TO THE MEMBER JUST BLOCKED — undoing the removal it was part of.
let _nameKeyBusy = null;
let _nameKeyDocKeys = null;   // the recipient map of the envelope we last SAW — null means "we have not looked"
let _nameKeyChecked = false;  // the namekey subscription has ANSWERED (event or EOSE) for the active identity
let churchSk = null, churchPub = null;     // the real church key — preserved so we can always switch back
let _profileLoaded = false;                // the relay has ANSWERED about this identity's kind-0 (event or EOSE)
// Resolve as soon as the relay answers, or after a bounded wait. Poll rather than hook the subscription, so a
// console that has not subscribed at all (or whose relay is down) still settles instead of hanging a save.
function _profileSettle(ms = 6000) {
  if (_profileLoaded) return Promise.resolve(true);
  return new Promise((res) => {
    const t0 = Date.now();
    const tick = () => { if (_profileLoaded || Date.now() - t0 > ms) return res(_profileLoaded); setTimeout(tick, 150); };
    tick();
  });
}
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
  // Stamp HERE, where every church document is signed. The first attempt at this put it behind
  // _publishSigned() — which turned out to have exactly one caller, while forty-two paths call
  // publish(feChurch(...)) directly. Measured: the founding groups were still refused.
  return finalizeEvent(_monotonic(tmpl), signer || sk);
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

// Everything in this module that is scoped to ONE church, cleared in one place.
//
// Why it exists: this state used to be reset in exactly one path (setActiveIdentity), and everywhere else it
// survived on the strength of `window.location.reload()` wiping the module. When the reload was removed from
// the restore routes (2026-08-04) the state carried across a WHOLE-KEY replacement, and the roster effect then
// republished church A's name/care/media rings as church B's envelopes — replaceable events, so B's originals
// were overwritten on the relay, B's sealed names and care needs stopped opening for good, and A's keys were
// handed to B's congregation. The name-key half of that had already happened once (AUDIT-2026-07-27) and was
// fixed for identity SWITCHING only; the same hole stayed open for key REPLACEMENT.
//
// So: one function, called from both. Adding a per-church global without adding it here is the bug.
function _resetChurchScopedState() {
  lastProfile = {}; _profileLoaded = false;
  _clearanceSent.clear();
  _careRoster = new Set(); _careRosterKnown = false;
  _nameKeyRing = []; _nameKeyDocKeys = null; _nameKeyChecked = false;
  // church A's blocks must not suppress church B's members from B's envelopes (item B)
  _localBlocked = new Set();
  _applyNoPhotoList([]);
  // The `*Checked` flags are the mint gates — "have we actually LOOKED for an envelope?". Carried across, they
  // report TRUE for a church nobody has looked at yet, which is what lets a stale ring be published as new.
  _careKeyHex = null; _careKeyRing = []; _careKeyDocKeys = null; _careKeyRev = 0; _careKeyChecked = false;
  _mediaKeyHex = null; _mediaKeyRing = []; _mediaKeyDocKeys = null; _mediaKeyChecked = false;
  // NIP-42 is bound to the key that signed the challenge. These sockets authed as the PREVIOUS church and will
  // not be re-challenged while they stay open, so _isRelayAuthed() would answer true for a church that has
  // never proved itself — the exact false-true the comment above it warns "silently destroys a church's keys".
  _authedRelays.clear();
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
// ──
// AUDIT-2026-07-30 S6. The member app closed this in M12; the console did not, and the comment that used to sit
// here said the native migration was "queued as a follow-up — async-init refactor". That refactor turned out not
// to be needed: every reader of the blob's CONTENT (unlock, verifyPin) is already async, and every synchronous
// use is only a PRESENCE check. So the member app's marker split drops straight in —
//
//     localStorage holds the full blob (web/desktop, and legacy native) OR a bare {native:1} MARKER;
//     on native the ciphertext itself lives in the OS hardware store (Keystore/Keychain).
//
// Why it matters more here than anywhere else: this is the CHURCH key. The gate's own words are that it signs
// "as the whole church — if it leaks, an attacker can impersonate the church to every member". In plain
// localStorage the encrypted blob is a file, and a file can be copied in seconds and then attacked OFFLINE at
// any speed, with none of the PIN screen's throttling in the way. In the hardware store the ciphertext cannot
// be read off a forensic image at all; an attacker has to come back to the device.
//
// What this does NOT do, so nobody reads more into it than is there: it protects a seized, powered-off phone.
// It does nothing about a phone seized unlocked, or a steward compelled to enter the PIN.
//
// SAFETY RULE for everything below: the localStorage copy is never dropped until the hardware store has been
// written AND READ BACK matching. A silent Keystore no-op that we "trusted" would orphan the only copy of a
// church's key — a far worse outcome than the exposure being fixed.
const ENC_LS = 'trinityone.steward.church-key.enc';
// Breadcrumb: a hardware-store removal was started and has not been confirmed finished. See encBlobRemove().
const ENC_PENDING_LS = 'trinityone.steward.church-key.removing';
// The breadcrumb records WHICH DIRECTION was unfinished, not merely that something was.
//
// It used to be the bare string '1', written by encBlobRemove AND by both failure branches of _encConverge —
// including failures belonging to a WRITE. On the next boot _encIntent is back to its module default
// ({have:null}), so encBlobRemoveResume resolved every breadcrumb as a removal and converged toward "no key".
// A PIN set while the Keystore was slow therefore left the blob in the hardware store, no marker in
// localStorage, and a breadcrumb — and the next launch DELETED the church key and showed "Set up a new
// church". Adversarial review 2026-08-04; reachable on a brand-new church too, where the steward may well
// have skipped the 12-word backup.
//
// Legacy '1' is treated as UNKNOWN, never as a removal: an orphaned ciphertext in the Keystore is an at-rest
// exposure the next removeKey/removeLock will clear, while a deleted key is a church that no longer exists.
const PENDING_WRITE = 'write';
const PENDING_REMOVE = 'remove';
// What key state does this device boot into? Pure over localStorage, so init() can decide BEFORE the first
// render — and so it can be driven in a test, which the inline version could not be.
//
// 'interrupted' is the one that matters. encBlobRemoveResume() settles a half-finished key write or removal,
// but it is async and init() is not, so by the time it knows the answer the console has already drawn.
// Without this the console reported "no key" and offered "Set up a new church" over a church key sitting in
// the Keystore awaiting adoption — and creating one overwrote it.
//
// It does not try to guess the DIRECTION of an interrupted operation, because that is unknowable:
// encBlobRemove() clears the marker up front and encBlobWrite() sets it only after the store write, so both
// interruptions leave marker-absent + breadcrumb, byte-identical. It answers "something is unsettled", and
// the console treats that as locked — an unlock screen cannot destroy anything, and the resume clears the
// breadcrumb and re-announces either way, so a stale crumb costs one screen rather than a church key.
function _bootKeyState() {
  if (lsGet(KEY_LS)) return 'plaintext';             // legacy seed on disk — load it and force a PIN
  if (lsGet(ENC_LS)) return 'locked';                // settled: a key is here, PIN-locked
  if (lsGet(ENC_PENDING_LS)) return 'interrupted';   // a key may be in the store with its marker unwritten
  return 'none';
}

const _encIsMarker = (raw) => { try { const o = JSON.parse(raw); return !!(o && o.native && !o.ct); } catch { return false; } };
// Does this look like a church-key blob at all? Used when finishing an INTERRUPTED WRITE, where module state is
// gone and the only evidence is whatever the hardware store happens to hold. Adopting that unconditionally is
// not safe: the store may hold a half-written or corrupted value, and writing the marker over it makes
// localStorage claim a key that will never decrypt — the "correct PIN rejected for ever" state, which is worse
// than reporting no key. The random-interleaving fuzz caught exactly that on the first version of this guard.
const _looksLikeKeyBlob = (raw) => { try { const o = JSON.parse(raw); return !!(o && o.ct && o.iv && o.salt); } catch { return false; } };
// NEVER return the Capacitor plugin object itself from an async function. `Capacitor.Plugins.SecureStorage` is a
// PROXY: every property access becomes a native call, so when the await machinery probes the returned value for
// `.then` — which it does for anything a promise resolves to — the proxy forwards `then` to Android. Found on a
// real phone, where setPin() simply never settled and nothing was written:
//
//     Uncaught (in promise) Error: "SecureStorage.then()" is not implemented on android
//
// The member app is immune only by accident of shape: identity.src.js destructures inside each async function and
// never returns the plugin. Wrapping it in a plain object gives an await-safe value with the same convenience.
async function _secureStore() { const m = await import('@aparajita/capacitor-secure-storage'); return { S: m.SecureStorage }; }
// the blob STRING ({v,it,salt,iv,ct}), from wherever it actually lives, or '' if there is none
// ── DEVICE-BOUND WRAP (browser/desktop consoles) ──────────────────────────────────────────────────────────
//
// AUDIT-2026-07-30. On native the ciphertext lives in the OS hardware store and a copied file yields nothing.
// A BROWSER has no such store, and that is where most stewards actually run the console — so the encrypted
// church key sits in a file that can be copied in seconds and then attacked OFFLINE, at any speed, with none
// of the unlock screen's throttling in the way. At the shipped cost (PBKDF2, 600k rounds) a six-character PIN
// is roughly half a minute of one graphics card; even eight characters chosen by a person is hours.
//
// The browser can hold a key that JavaScript may USE but never READ: generate it non-extractable and keep the
// CryptoKey object itself in IndexedDB. There is no API that returns its bytes. Wrapping the PIN-encrypted blob
// with it means a copied localStorage file is not enough — the attacker must also have that browser profile,
// and even then they are reduced to guessing through the browser rather than on a GPU farm.
//
// IT IS HARDENING, NOT CUSTODY. Lose the browser profile — reinstall, clear site data, a new machine — and the
// blob is unopenable. That is ACCEPTABLE and deliberate: the steward restores from their 12 words, which they
// are told to keep on paper. The cost of losing it is an inconvenience, never a church.
//
// WHAT MUST NOT HAPPEN is the silent version of that: the device key gone, the blob still present, and every
// correct passphrase reported as "wrong". So the wrapped form is TAGGED (`dev:1`), and unwrap failure is
// reported as a distinct condition the UI can explain — see unlock()/verifyPin().
//
// Applied to the WEB path only. Native already has Keystore (verified on device), and layering a second scheme
// over a working one buys nothing and risks the thing that works.
const DEV_DB = 'trinityone-steward', DEV_STORE = 'devkey', DEV_ID = 'church-wrap-v1';
// AUDIT-2026-07-30: a swallowed createObjectStore failure USED TO BE PERMANENT. The upgrade still commits at
// version 1 with no object store, every later transaction throws NotFoundError, _deviceKey catches it and
// returns null — and because the version is hardcoded, onupgradeneeded never fires again, so there is no
// self-repair. The console then either silently protects nothing, or (if a wrapped blob already exists) is
// locked out for ever. Now: verify the store is really there, and reopen at a higher version to rebuild it.
function _openIdb(version) {
  return new Promise((res, rej) => {
    let r; try { r = version ? indexedDB.open(DEV_DB, version) : indexedDB.open(DEV_DB); } catch (e) { return rej(e); }
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(DEV_STORE)) db.createObjectStore(DEV_STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('indexeddb open failed'));
  });
}
async function _idb() {
  let db = await _openIdb();
  if (db.objectStoreNames.contains(DEV_STORE)) return db;
  const next = (db.version || 1) + 1;   // rebuild: a version bump is the ONLY way to get another upgrade
  try { db.close(); } catch (e) {}
  db = await _openIdb(next);
  if (!db.objectStoreNames.contains(DEV_STORE)) throw new Error('indexeddb store missing after rebuild');
  return db;
}
function _idbTx(db, mode, fn) {
  return new Promise((res, rej) => {
    const tx = db.transaction(DEV_STORE, mode);
    const req = fn(tx.objectStore(DEV_STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error('indexeddb request failed'));
  });
}
// get-or-create the non-extractable wrapping key. Returns null when the platform cannot provide one, which
// means "carry on exactly as before" rather than "fail".
async function _deviceKey(create) {
  try {
    if (typeof indexedDB === 'undefined' || !window.crypto || !window.crypto.subtle) return null;
    const db = await _idb();
    const found = await _idbTx(db, 'readonly', (st) => st.get(DEV_ID));
    if (found) return found;
    if (!create) return null;
    // Ask the browser NOT to evict this origin before minting the key it will be asked to keep. Best-effort
    // storage is subject to eviction under pressure and to some "clear site data" paths, and the asymmetric
    // case — blob survives, key does not — is the one that strands a steward. Losing it is recoverable from
    // the 12 words, but it should not happen because the browser tidied up.
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
    const k = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await _idbTx(db, 'readwrite', (st) => st.put(k, DEV_ID));
    // read it back: a key we cannot fetch again is a key that would lock the steward out on the next boot
    const back = await _idbTx(db, 'readonly', (st) => st.get(DEV_ID));
    return back || null;
  } catch (e) { console.warn('[steward] device key unavailable', e); return null; }
}
// The pure half, injectable so it can be exercised against real WebCrypto in tests.
function makeDeviceWrap(opts) {
  const o = opts || {};
  const getKey = o.getKey || _deviceKey;
  const subtle = o.subtle || (typeof window !== 'undefined' && window.crypto && window.crypto.subtle);
  const rand = o.randomBytes || ((n) => window.crypto.getRandomValues(new Uint8Array(n)));
  const isWrapped = (raw) => { try { const j = JSON.parse(raw); return !!(j && j.dev === 1 && j.ct && j.iv); } catch { return false; } };
  return {
    isWrapped,
    // returns the wrapped string, or NULL meaning "this platform cannot, store it as before"
    async wrap(str) {
      try {
        const key = await getKey(true);
        if (!key || !subtle) return null;
        const iv = rand(12);
        const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(str)));
        return JSON.stringify({ dev: 1, iv: b64e(iv), ct: b64e(ct) });
      } catch (e) { console.warn('[steward] device wrap failed', e); return null; }
    },
    // returns the inner blob, or throws with .deviceKeyMissing so the caller can say WHY rather than "wrong PIN"
    async unwrap(outer) {
      if (!isWrapped(outer)) return outer;                    // not wrapped — plain blob, nothing to do
      const key = await getKey(false);
      if (!key || !subtle) { const e = new Error('device key missing'); e.deviceKeyMissing = true; throw e; }
      const j = JSON.parse(outer);
      try {
        const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64d(j.iv) }, key, b64d(j.ct));
        return new TextDecoder().decode(pt);
      } catch (err) { const e = new Error('device key does not match'); e.deviceKeyMissing = true; throw e; }
    },
  };
}
const _devWrap = makeDeviceWrap();

async function encBlobRaw() {
  const raw = lsGet(ENC_LS);
  if (!raw) return '';
  // web/desktop, or a native install not yet migrated. May carry the device-bound wrap; unwrap() passes a
  // plain blob straight through, and THROWS with .deviceKeyMissing when the browser no longer holds the key —
  // which the caller must report as "this computer no longer recognises the key", never as a wrong passphrase.
  if (!_encIsMarker(raw)) return await _devWrap.unwrap(raw);
  try { const { S } = await _secureStore(); const s = await S.get(ENC_LS); if (s) return String(s); }
  catch (e) { console.warn('[steward] secure key get failed', e); }
  return '';   // marker present but the store would not give it up — unlock() surfaces this as a failed unlock
}
// write the blob. Returns true only if it durably landed somewhere it can be read back.
async function encBlobWrite(str) {
  // INTENT FIRST, synchronously. Everything after this line can be interrupted, hang, or land late. This
  // cannot, which is why every converge pass can trust it.
  //
  // The breadcrumb goes down here too, saying WRITE. _encIntent is module state and does not survive the app
  // being killed; the breadcrumb does, and without a direction on it the next boot resolved an interrupted
  // write as a removal and deleted the key. A successful converge clears it.
  if (_isNative()) { _encIntent = { have: str }; try { lsSet(ENC_PENDING_LS, PENDING_WRITE); } catch {} }
  if (_isNative()) {
    try {
      const { S } = await _secureStore();
      await S.set(ENC_LS, str);
      const v = await S.get(ENC_LS);
      if (v != null && String(v) === str) {
        // Marker and breadcrumb come from a converge pass, not from this call's belief about what it just
        // did: an operation still in flight elsewhere may yet change what the store holds. Awaited, so the
        // caller sees a settled device, and the answer is read back from reality.
        await _encConverge();
        return _encIsMarker(lsGet(ENC_LS));
      }
      console.warn('[steward] secure key read-back mismatch — keeping the localStorage copy');
    } catch (e) { console.warn('[steward] secure key set failed — keeping the localStorage copy', e); }
  }
  // WEB/DESKTOP: bind the blob to this browser so a copied file is not enough on its own. Returns null when
  // the platform cannot (no IndexedDB, no WebCrypto, private mode), and then we store exactly as before —
  // a console that cannot be hardened must still WORK.
  if (!_isNative()) {
    const wrapped = await _devWrap.wrap(str);
    if (wrapped) {
      lsSet(ENC_LS, wrapped);
      // read-back, same discipline as the hardware store: never leave a blob we cannot open again
      try { const back = await _devWrap.unwrap(lsGet(ENC_LS)); if (back === str) return true; } catch (e) {}
      console.warn('[steward] device-wrapped blob did not read back — storing unwrapped');
    }
  }
  lsSet(ENC_LS, str);   // web/desktop fallback, or native when the hardware store is unavailable
  return true;
}
// "Remove this church from this device" is a panic button, so its failure must be RECOVERABLE, not silent.
//
// The order here is load-bearing. Clearing the localStorage marker first makes encBlobRaw() short-circuit, so
// the next boot looks clean — while the church-key ciphertext is still sitting in the Android Keystore, and
// nothing would ever try again: encBlobRemove() is only reached from removeKey() and forgetPin(), and both
// then find nothing to do. The caller races this against a timeout (a native bridge call can hang rather than
// throw), so "the reload won" is a case that WILL happen.
//
// So: leave a breadcrumb before touching anything, and clear it only once the hardware store has actually let
// go. A boot that finds the breadcrumb finishes the job. AUDIT-2026-07-31.
// DECLARED INTENT + CONVERGENCE. AUDIT-6 (verified independently by a second model) found FOUR defects in the
// previous approach, one of which produced the exact state it was written to prevent. Recorded here because
// the shape of the mistake matters more than the individual bugs:
//
//   • two overlapping removals with a write between them ended with the Keystore EMPTY and the marker PRESENT
//     — correct PIN rejected for ever, surviving a reload;
//   • a removal that hung and landed late RESURRECTED a key the steward had deliberately removed, so
//     "Remove this church from this device" silently did not;
//   • the repair's own stale write could clobber a newer one, locking the steward out AND leaving a
//     superseded ciphertext at rest.
//
// The root cause was the strategy, not the details. The old `_encRepairIfClobbered` tried to COMPENSATE AFTER
// THE FACT for native calls that cannot be cancelled, reasoning only about writes (via a generation) with no
// notion of a competing removal. Every patch in that style — add a removal generation, add another re-check —
// shrinks the windows and keeps the shape, and there is always one more interleaving. Three audits' worth of
// evidence says so.
//
// So: stop compensating, and converge instead.
//
//   1. INTENT is recorded synchronously the moment the steward acts: `{ have: blob }` or `{ have: null }`.
//      It never waits on a native call, so it cannot be stale.
//   2. EVERY native operation, whenever it lands — including long after its caller gave up — ends by calling
//      _encConverge(), which reads what the store ACTUALLY holds, compares it to the intent, and fixes the
//      difference.
//   3. The marker and the breadcrumb are written from the CONVERGED state, never from one operation's belief
//      about what it just did.
//
// Ordering then stops mattering, which is the property you need when calls can land in any order: a late
// delete is undone because intent says a key is wanted; a late write is undone because intent says none is; a
// stale write loses to the next converge. Each of the four defects becomes unreachable by construction rather
// than by a guard someone has to remember to check.
//
// The invariant, fuzzed over random interleavings in scripts/console-key-secure-store.test.mjs:
//
//     the marker says a key exists  IFF  the hardware store holds one, AND it is the one last asked for.
//
let _encIntent = { have: null };        // what the steward has asked for; updated synchronously
let _encConverging = null;              // serialises converge passes so two cannot fight each other

// Bring the hardware store into line with `_encIntent`, then set the marker + breadcrumb from what is ACTUALLY
// there.
//
// BOUNDED, AND SELF-RETRIGGERING — both halves are load-bearing, and the first version of this had neither:
//
//   • BOUNDED, because converge passes are serialised (two must not fight over the same slot) and a native
//     bridge call can hang. Without a bound, one hung removal blocks every later operation — the steward
//     restores a church and the write simply never completes. That trades a destructive race for a dead
//     console, which is better but still broken. A pass that gives up releases the queue and leaves the
//     breadcrumb, so the state is known-unfinished rather than wrong.
//   • SELF-RETRIGGERING, because a call we stopped waiting for still LANDS eventually, and when it does it
//     changes the store behind our back. Every native call therefore schedules another converge on settle.
//     That is what makes a late landing self-healing instead of catastrophic: whatever it did, the next pass
//     compares the store against the intent again and fixes the difference.
// Function declarations, not arrow consts: the tests lift these out of the bundle by brace-matching, and a
// `const x = (p) => …` with no braces cannot be lifted — it would silently be missing and every converge pass
// would throw into its own catch, reporting "could not reach the store" for a perfectly healthy device.
function _encBound(p) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('keystore call timed out')), 3000))]);
}
// Attach a re-converge to a native call, so a call we stopped waiting for is noticed when it finally LANDS —
// that is what makes a late arrival self-healing rather than catastrophic.
//
// ON SUCCESS ONLY, and the fuzzer found out why the hard way: retriggering on rejection is an infinite loop.
// Converge tries a write, the store refuses, the rejection schedules another converge, which tries the same
// write... The first version did that and the random-interleaving test hung the runner outright ("Map maximum
// size exceeded"). A failed call changed nothing, so there is nothing new to reconcile; the breadcrumb is
// already set and a later pass or boot will try again. A successful call DID change something, and the
// converge it schedules either finds the store already matching the intent — and stops — or fixes it.
function _encAfter(p) {
  try { p.then(() => _encConverge(), () => {}); } catch (e) {}
  return p;
}

function _encConverge() {
  const run = async () => {
    if (!_isNative()) return;
    const want = _encIntent.have;
    try {
      const { S } = await _encBound(_secureStore());
      const read = async () => { const v = await _encBound(S.get(ENC_LS)); return v == null ? null : String(v); };
      let actual = await read();
      if (want && actual !== want) { await _encBound(_encAfter(S.set(ENC_LS, want))); actual = await read(); }
      else if (!want && actual !== null) { await _encBound(_encAfter(S.remove(ENC_LS))); actual = await read(); }
      // The marker mirrors REALITY, not intention. A marker with no blob behind it is the lockout state; a
      // blob with no marker is a key the console cannot see. Neither is ever written here.
      if (want && actual === want) {
        lsSet(ENC_LS, JSON.stringify({ native: 1 }));
        try { localStorage.removeItem(ENC_PENDING_LS); } catch {}
      } else if (!want && actual === null) {
        try { localStorage.removeItem(ENC_LS); } catch {}
        try { localStorage.removeItem(ENC_PENDING_LS); } catch {}
      } else {
        // Did not reach the intent. Keep the breadcrumb so a later pass or boot tries again, and never leave
        // localStorage claiming a key the store does not hold — "no key on this device" is recoverable from
        // the phrase; "correct PIN rejected for ever" is not.
        try { lsSet(ENC_PENDING_LS, want ? PENDING_WRITE : PENDING_REMOVE); } catch {}
        if (actual === null) { try { localStorage.removeItem(ENC_LS); } catch {} }
      }
    } catch (e) {
      // Could not reach the store, or a call outran its bound. We know nothing for certain, so change nothing
      // beyond guaranteeing another attempt.
      console.warn('[steward] could not converge the church key', e);
      try { lsSet(ENC_PENDING_LS, want ? PENDING_WRITE : PENDING_REMOVE); } catch {}
    }
  };
  _encConverging = (_encConverging || Promise.resolve()).then(run, run);
  return _encConverging;
}
async function encBlobRemove() {
  // Intent first and synchronously: from this instant the steward wants no key here, whatever any in-flight
  // native call does afterwards. The breadcrumb goes down before anything is touched, so an interrupted
  // removal is always finishable; the marker is cleared at once so the console stops offering to unlock a
  // church it is forgetting.
  if (_isNative()) _encIntent = { have: null };
  try { lsSet(ENC_PENDING_LS, PENDING_REMOVE); } catch {}
  try { localStorage.removeItem(ENC_LS); } catch {}
  if (!_isNative()) { try { localStorage.removeItem(ENC_PENDING_LS); } catch {} return; }
  await _encConverge();
}
// Finish an operation that was cut off — by the reload racing it, a hung bridge call, or the app being
// killed. Safe on every boot: does nothing without the breadcrumb.
// Did the resume reach no conclusion at all? Set only by the catch below — the Keystore bridge threw or
// timed out — and it is the one outcome where we must NOT tell the console the device is empty.
let _encResumeStuck = false;

// EVERY exit announces. init() decides the boot key state synchronously and this does not, so init() answers
// 'interrupted' and leaves the console locked rather than offering "Set up a new church" over a key it cannot
// yet see. That is only safe if the console is told the answer once it is known — and the announce used to
// sit before ONE of six returns, the write/adopt path. An interrupted REMOVAL took a different exit, so a
// steward who removed their church key and was cut off mid-operation came back to "Console locked" over a
// device with no key and no PIN: Steward.unlock() returns true without clearing `locked`, the submit handler
// bails, and the button sticks on "Unlocking…" for ever with no way out but a manual reload.
//
// Wrapping the worker means a future exit inherits the announce instead of having to remember it.
async function encBlobRemoveResume() {
  _encResumeStuck = false;
  try { return await _encBlobRemoveResumeWork(); }
  finally {
    try {
      if (_encResumeStuck) {
        // We could not read the store, so we do not know whether a key is there. Stay locked — offering to
        // create one could overwrite a church key — but say so, because silence here is the dead end.
        window.Steward.keyStoreStuck = true;
      } else if (!lsGet(ENC_LS)) {
        window.Steward.locked = false;   // settled, and there is genuinely no key: back to setup
      }
      window.dispatchEvent(new CustomEvent('steward-key'));
    } catch (e) {}
  }
}

async function _encBlobRemoveResumeWork() {
  const pending = lsGet(ENC_PENDING_LS);
  if (!pending) return false;
  if (!_isNative()) { try { localStorage.removeItem(ENC_PENDING_LS); } catch {} return false; }
  // A removal is the ONLY direction this function may finish. An interrupted WRITE — and a legacy '1', whose
  // direction was never recorded — must never be resolved by deleting: converging toward `want = null` when
  // the steward was in fact saving a key is precisely how a set PIN turned into "Set up a new church" on the
  // next launch. Instead, adopt whatever the store actually holds. If a blob is there the key survived the
  // interruption and only the marker is missing, so writing the marker finishes the job honestly; if nothing
  // is there the write never landed, and there is nothing to finish either way.
  if (pending !== PENDING_REMOVE) {
    // If this process already KNOWS what was asked for, leave it entirely alone. The live machinery owns that
    // intent and its own converge passes will settle it; this function exists only to finish work orphaned by
    // a RESTART. Two earlier attempts here were both wrong: adopting the store's contents as the intent
    // overrode a newer request with an older blob ("the marker points at a key that is not the one last asked
    // for"), and scheduling another converge re-entered the chain and hung the runner outright with
    // "Map maximum size exceeded" — the exact infinite loop _encAfter's on-success-only rule exists to avoid.
    if (_encIntent.have != null) {
      // One exception, and it is bookkeeping rather than repair: if localStorage already carries the marker the
      // device is settled, so this breadcrumb is left over from some earlier, unrelated operation. Drop it
      // rather than leaving it to be re-examined on every future boot.
      if (_encIsMarker(lsGet(ENC_LS))) { try { localStorage.removeItem(ENC_PENDING_LS); } catch {} }
      return false;
    }
    // Boot case: module state is gone, so the store is the only evidence of what the interrupted write left.
    try {
      const { S } = await _encBound(_secureStore());
      const v = await _encBound(S.get(ENC_LS));
      // Only adopt something that actually looks like a key. Anything else is a half-written or corrupted
      // value, and marking it valid would reject the steward's correct PIN for ever — leave it, claim nothing,
      // and let unlock() report honestly that this device has no key.
      if (v != null && _looksLikeKeyBlob(String(v))) {
        _encIntent = { have: String(v) };
        lsSet(ENC_LS, JSON.stringify({ native: 1 }));
        // K2, and the resolution is NOT the one the finding proposed. A LEGACY breadcrumb (the bare '1' that
        // pre-dates PENDING_WRITE/PENDING_REMOVE) carries no direction, and on the old build BOTH an
        // interrupted removal and an interrupted write left it. The finding suggested resolving legacy by the
        // marker's absence instead. Measured against main: that does not discriminate. encBlobRemove() clears
        // the marker up front, and encBlobWrite() on native does not set it until _encConverge() runs AFTER
        // the store write — so an interrupted write leaves marker-absent + breadcrumb, byte-identical to an
        // interrupted removal. Treating absence as "removal" would delete the key in exactly the case this
        // branch was cut to fix.
        //
        // So the direction stays unknowable and we keep the safe half: never delete on a guess. What was
        // wrong was doing it SILENTLY — a steward who asked to remove this church finds it back, PIN-locked,
        // with nothing said. They know the direction even though the device cannot, so tell them and let them
        // finish the job. Cleared by removeKey(), and by any later settled state.
        if (pending !== PENDING_WRITE) {
          window.Steward.keyResumedUnknown = true;
          try { window.dispatchEvent(new CustomEvent('steward-key-resumed')); } catch (e) {}
        }
      }
    } catch (e) { console.warn('[steward] could not settle an interrupted key write', e); _encResumeStuck = true; return false; }
    try { localStorage.removeItem(ENC_PENDING_LS); } catch {}
    return true;
  }
  // Module state is gone after a restart, so recover the intent from what localStorage says: a marker means a
  // key is wanted (a completed removal clears it), no marker means none is.
  //
  // A marker WITH no remembered blob is the one case converge cannot serve — it knows a key is wanted but not
  // which one, and it must never invent or delete on a guess. Stop retrying and let unlock() read the store
  // directly; that is the honest answer, and it is what the previous three versions of this function each got
  // wrong in a different way.
  if (_encIntent.have === null && _encIsMarker(lsGet(ENC_LS))) {
    try { localStorage.removeItem(ENC_PENDING_LS); } catch {}
    return false;
  }
  await _encConverge();
  return !lsGet(ENC_PENDING_LS);
}
// One-time move of an EXISTING native install's blob out of localStorage. Deliberately does nothing unless the
// read-back matches, so a device whose Keystore misbehaves simply stays as it was rather than losing the key.
async function migrateEncToSecure() {
  if (!_isNative()) return false;
  const raw = lsGet(ENC_LS);
  if (!raw || _encIsMarker(raw)) return false;              // nothing to move, or already moved
  const ok = await encBlobWrite(raw);                       // writes the marker itself once read-back matches
  return ok && _encIsMarker(lsGet(ENC_LS));
}
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
// HANDOFF-2026-07-31 (1). nostr-tools does NOT reject when it cannot open the socket — SimplePool.publish
// RESOLVES that relay's promise with the plain string `"connection failure: " + err`. A resolution satisfies
// Promise.any, so this fell straight through to the success path: it fired steward-publish-ok, returned the
// event, and every caller above it — clearances, the minors list, the blocklist, group keys, the name-key
// envelope — reported SAVED while nothing had left the device. Measured with the relay killed: a 21-member
// back-fill returned {failed: 0, total: 21}, showed no banner, stored nothing, and the dashboard then recorded
// the back-fill as done and never retried. On a thin or flapping link the console lied about every save.
//
// Turn that resolution back into a rejection so Promise.any sees it for what it is. PREFIX-SPECIFIC on
// purpose: a genuine OK also resolves with a string (the relay's reason, usually ''), so anything broader
// would turn every successful save into a reported failure — the same lie pointing the other way. The prefix
// is pinned against the live library in scripts/console-publish-honesty.test.mjs, because a nostr-tools bump
// that reworded it would otherwise silently restore the bug.
// The prefix is written inline rather than hoisted to a constant so this function stays self-contained: the
// tests lift it out of the bundle and run it, and a name resolved from the enclosing IIFE would be undefined
// there — a green suite proving nothing.
async function publish(evt) {
  // WAIT FOR THE RELAY TO KNOW THIS CHURCH EXISTS. seedNewChurch() fires selfRegister() without awaiting it
  // and starts writing immediately, so the founding documents raced an HTTP round-trip and were refused as
  // "not a member or not permitted for this group". Bounded: a relay that never answers must not stop a
  // church writing to the relays that did. See _regGate.
  await _waitForRegistration();
  try {
    await Promise.any(pool.publish(relays(), evt).map(p => p.then(v => {
      if (typeof v === 'string' && v.startsWith('connection failure')) throw new Error(v);
      return v;
    })));
  }
  catch (e) {
    console.warn('[steward] publish failed', e);
    // every relay rejected — surface it so the steward isn't left wondering why nothing saved
    let reason = '';
    try { const errs = (e && e.errors) || []; reason = (errs[0] && (errs[0].message || String(errs[0]))) || ''; } catch (x) {}
    // OUR OWN SUPERSEDED COPY IS NOT A FAILURE. Two code paths can publish the same document a moment apart;
    // the newer one lands and the older is refused with "a newer version of this is already stored". The
    // steward was then shown a red, sticky "your change could not be saved" for a change that IS saved —
    // measured on a fresh church, 2026-08-19: the banner claimed the approval setting had failed while the
    // relay held approval:true. If we know a NEWER copy of this very document was accepted, the refusal is
    // telling us something we already know, and there is nothing for the steward to do about it.
    try {
      const d1 = ((evt.tags || []).find(t => t[0] === 'd') || [])[1];
      if (d1 && /newer version/i.test(reason) && (_lastOk.get(d1) || 0) > (evt.created_at || 0)) return evt;
    } catch (x) {}
    try { window.dispatchEvent(new CustomEvent('steward-publish-error', { detail: { reason, evt } })); } catch (x) {}
    return false;   // total failure — every relay rejected; callers that await the result can surface it
  }
  // a write landed → the relays are accepting our posts, so any "a relay is refusing us" alarm can clear
  try { const d0 = ((evt.tags || []).find(t => t[0] === 'd') || [])[1]; if (d0) _lastOk.set(d0, evt.created_at || 0); } catch (x) {}
  try { window.dispatchEvent(new CustomEvent('steward-publish-ok', { detail: { evt } })); } catch (x) {}
  return evt;
}
// TARGETED PUBLISH, for the safeguarding write path only. The shared publish() above resolves on
// Promise.any — success as soon as ONE relay accepts — which is right for a chat message and wrong for a
// child's safeguarding record: the console reported "saved" while two of three relays held nothing, and the
// skip check then required the record on EVERY relay, so it rewrote the whole roster for ever without ever
// telling anyone which relay was the problem. AUDIT-8.
//
// Deliberately NOT a change to publish() itself, which has 77 call sites across Finance, groups, profile and
// invites. Rewriting the semantics of every write in the console days before a pilot is how a codebase that
// already specialises in silent failures acquires more of them. This path is where the harm is; this path is
// what changes.
//
// Returns the event only when EVERY targeted relay accepted. A partial write returns false, which puts the
// member into the unconfirmed list and sends them through the verify read — where the truth is established by
// looking rather than asserted by the writer.
async function _publishToRelays(evt, urls) {
  await _waitForRegistration();   // same gate as publish(): a church the relay has never heard of writes nothing
  // CONNECTED, not configured. With the all-must-accept rule below, targeting every CONFIGURED relay means a
  // single unreachable one makes `accepted < targets.length` for every member, always — a full-roster
  // safeguarding alarm while every record is safely stored. That is not hypothetical: CANONICAL_RELAYS ships a
  // tailnet address no ordinary steward's phone can route to, and the fallback fires whenever the read could
  // not run — which is the whole window after any socket reconnect, and every toggle, since _reseal has no
  // auth gate. AUDIT-9. Falling back to `relays()` only when nothing is connected keeps a fully-offline
  // console reporting honestly rather than silently doing nothing.
  const live = _connectedRelays();
  const targets = (urls && urls.length) ? urls : (live.length ? live : relays());
  if (!targets.length) return false;
  let rs = [];
  try {
    rs = await Promise.allSettled(pool.publish(targets, evt).map(p => p.then(v => {
      if (typeof v === 'string' && v.startsWith('connection failure')) throw new Error(v);
      return v;
    })));
  } catch (e) { return false; }
  const accepted = rs.filter(r => r.status === 'fulfilled').length;
  if (!accepted) {
    let reason = '';
    try { const f = rs.find(r => r.status === 'rejected'); reason = (f && f.reason && (f.reason.message || String(f.reason))) || ''; } catch (x) {}
    try { window.dispatchEvent(new CustomEvent('steward-publish-error', { detail: { reason, evt } })); } catch (x) {}
    return false;
  }
  try { window.dispatchEvent(new CustomEvent('steward-publish-ok', { detail: { evt } })); } catch (x) {}
  return accepted === targets.length ? evt : false;
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
// TWO THINGS A BRAND-NEW CHURCH USED TO TRIP OVER IN ITS FIRST NINETY SECONDS. Both were measured on a
// fresh church, one console, no second editor (R5-5, 2026-08-19).
//
// 1. WE PUBLISHED BEFORE THE RELAY KNEW THE CHURCH EXISTED. seedNewChurch() fires selfRegister() without
//    awaiting it and then starts writing, so every founding document raced an HTTP round-trip. Measured:
//    namekey, carekey (twice) and joinpolicy (twice) all refused with "not a member or not permitted for
//    this group" between 13:40:27 and 13:40:33; the church registered at 13:40:50. The writes retried
//    through eventually, which is why nobody noticed, and the steward was left with a red banner.
//
// 2. TWO WRITES OF ONE DOCUMENT IN THE SAME SECOND ARE A COIN FLIP. A replaceable event is ordered by
//    created_at, and NIP-01 breaks a tie by event id — so the SECOND write of a doc within the same second
//    loses roughly half the time and comes back "a newer version of this is already stored". The console
//    then told the steward "Someone else saved a newer version of this while you were editing. Reload the
//    page…" on a church ninety seconds old that nobody else had ever opened. The relay was right; the
//    sentence was not. Stamping our own writes monotonically per document removes the tie entirely.
//
// The gate is bounded: a relay that never answers registration must not stop a church publishing (it may
// have other relays, and refusing to write is worse than writing early).
// Long enough for a person to type their church's name into the wizard's first field, because that is what
// the relay is waiting for. Paid at most ONCE: publish() latches the gate open afterwards whichever way it
// went, so a church whose relay will never accept it is delayed once and never again.
const REG_GATE_MS = 45000;
let _regGate = null, _openGate = null, _regNeedsName = false;
// ARMED THE MOMENT A CHURCH KEY EXISTS, not when registration starts. The first cut armed it inside
// selfRegister() — but the fix had just removed the selfRegister call at creation (it passed an empty name
// and could only ever 400), so at the moment the founding documents went out there was no gate at all and
// all ten writes were refused exactly as before. Arm it where the church begins.
function _armRegGate() { if (!_regGate) _regGate = new Promise((r) => { _openGate = r; }); }
// SUCCESS, not "we stopped waiting". The bounded gate below is right for ordinary writes — a church whose
// relay will never accept it must still be able to work — but it is wrong for the founding documents, whose
// whole purpose depends on the church existing on the relay first. Releasing those on a timer just races how
// fast somebody types their church's name into the wizard: measured, the five starter groups were held the
// full 45 seconds and then refused anyway, because registration landed at second 50.
let _regOk = false;
const _regOkWaiters = [];
function _markRegOk() { _regOk = true; _regOkWaiters.splice(0).forEach((f) => { try { f(true); } catch (e) {} }); }
function _openRegGate() { const f = _openGate; _openGate = null; if (f) { try { f(); } catch (e) {} } }
// EVERY publisher must wait, not just the one you happened to fix. publish() was guarded first and the
// seeded groups went out anyway, because they travel by _publishToRelays() — the all-relays variant. Two
// publishers, one gate.
async function _waitForRegistration() {
  if (!_regGate) return;
  const g = _regGate;
  try { await Promise.race([g, new Promise((r) => setTimeout(r, REG_GATE_MS))]); } catch (e) {}
  _regGate = null;   // latched: whichever way that went, nothing waits on registration again this session
}
const _lastStamp = new Map();   // d-tag -> the created_at we last published for it
const _lastOk = new Map();      // d-tag -> the created_at of the last copy the relay ACCEPTED
function _monotonic(tmpl) {
  const d = ((tmpl.tags || []).find(t => t[0] === 'd') || [])[1] || ('kind:' + tmpl.kind);
  const nowS = Math.floor(Date.now() / 1000);
  const want = tmpl.created_at || nowS;
  const last = _lastStamp.get(d) || 0;
  let at = want > last ? want : last + 1;
  if (at > nowS + 600) at = want;   // never stamp into the relay's future-clamp; take the rare tie instead
  _lastStamp.set(d, at);
  return at === tmpl.created_at ? tmpl : { ...tmpl, created_at: at };
}
function _publishSigned(tmpl) {
  if (!sk) return Promise.resolve(null);
  return publish(feChurch(tmpl));   // both guards live in publish() and feChurch() now
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

// One-shot read per d-tag, keeping TWO events per document: the newest we wrote (`ours`) and the newest from
// anyone at all (`top`). Both are needed because a replaceable event is keyed by (pubkey, kind, d), so the
// church's copy of a member's clearance and a steward's copy are separate documents that never collide — and
// the member's app applies whichever is newest across all of them. A reader that keeps only its own copy is
// asking "did I write what I meant to", when the question is "does the member see what I meant".
// Returns a Map d -> event.
// Bounded like _one: an unanswered relay must not hang the caller. HANDOFF-2026-07-31 item 7.
// Resolves { byD, complete }. `complete` is the important half: it says whether the relay actually finished
// answering (EOSE) or whether we simply stopped waiting. Without it a slow link looks identical to an empty
// relay — and callers then read "this record is absent" from what is really "I don't know yet". That is the
// same mistake as treating an unauthenticated read as proof of absence, one level down, and it produced a
// false "6 of 8 children did not receive their record" on a satellite link where every record had landed.
// `topOk` decides which events may occupy the `top` slot. It MUST be applied while choosing the maximum, not
// afterwards. AUDIT-8: `top` used to be the newest event from ANY author, filtered for authorship by the
// caller once the maximum had already been taken — so a single newer event from a key the member ignores
// DISPLACED the copy that mattered, the caller then discarded it, saw nothing on top, and skipped the member.
// No adversary is needed: a since-removed steward's copy is still stored and still served, and roster churn
// produces those routinely. The member's app has never had this bug — src/fellowship.src.js:2560 rejects
// unhonoured authors BEFORE its newest-wins comparison — so the console was going blind to exactly the copy
// the child's phone was applying.
// WHICH OF TWO COPIES WINS. Newer second wins; on an EQUAL second the higher event id wins. `created_at` is
// whole seconds, so a collision between two authorised writers is ordinary — and this product's threat model
// grants a compelled relay the ability to REORDER what it serves, so "whichever arrived last" hands the
// decision to the adversary. The member's app applies the identical rule (src/fellowship.src.js, the clearance
// branch). They must stay identical: changing one side alone re-opens the divergence in the other direction,
// which is exactly how the worst defect of the previous round happened. AUDIT-9.
const _beatsDoc = (a, b) => {
  if (!b) return true;
  const aa = a.created_at || 0, bb = b.created_at || 0;
  if (aa !== bb) return aa > bb;
  return String(a.id || '') > String(b.id || '');
};

function _newestByD(filters, ms = 6000, urls = null, mineHex = null, topOk = null) {
  return new Promise((resolve) => {
    const best = new Map();
    let done = false;
    const finish = (complete) => { if (done) return; done = true; try { sub.close(); } catch {} resolve({ byD: best, complete: !!complete }); };
    const sub = pool.subscribeMany(urls || relays(), filters, {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d) return;
        const cur = best.get(d) || { ours: null, top: null };
        const at = e.created_at || 0;
        if ((!topOk || topOk(e)) && _beatsDoc(e, cur.top)) cur.top = e;
        if (mineHex && e.pubkey === mineHex && _beatsDoc(e, cur.ours)) cur.ours = e;
        best.set(d, cur);
      },
      oneose() { finish(true); },
      // A CLIENT TIMEOUT MUST NOT MASQUERADE AS AN ANSWER. nostr-tools arms its own EOSE timer and calls
      // `oneose` when it expires, whether or not the relay ever sent the frame (lib/esm/index.js:1035, default
      // `baseEoseTimeout` 4400ms). AUDIT-8 measured it: a relay that accepts the REQ and then says nothing for
      // ever was recorded as `complete: true` after 4421ms, and a dead port after 3ms. Every caller that reads
      // `complete` as "the relay finished answering" was therefore reading a lie — including the skip gate the
      // previous commit added for exactly this reason. Pushing the library's timer well past our own bound
      // means an EOSE arriving inside `ms` is a real one.
      // RESIDUAL, deliberately left: `handleClose` calls `handleEose` first, so a relay that CLOSEs the
      // subscription (e.g. refusing an oversized filter) still reports complete. subscribeMany overwrites any
      // `onclose` we pass, so closing that needs a direct `relay.subscribe`. Tracked in the backlog.
      maxWait: ms + 5000,
    });
    setTimeout(() => finish(false), ms);
  });
}

// WOULD THE MEMBER'S APP APPLY THIS COPY? Everything the member ignores, we must ignore too, or a relay can
// manufacture a disagreement out of nothing — one validly-signed event per member from a keypair with no
// roster seat, never stored, merely SERVED, and the console republishes the whole roster every visit for ever.
// Mirrors src/fellowship.src.js:2560-2577: the church key, or a CURRENT roster steward, and nothing else.
//
// The future-date guard is applied on BOTH sides as of AUDIT-8. It used to be here only, which made this
// console blind to precisely the copy a clock-skewed phone had pinned: the relay accepts created_at up to
// +900s, this console rejected past +600s, and the member's app had no bound at all. In that band the child
// applied a copy the console could not see, and the console reported a clean run.
//
// UNKNOWN ROSTER IS NOT AN EMPTY ROSTER. `_careRoster` arrives asynchronously, and the back-fill does not wait
// for it. Treating "not loaded yet" as "this author is nobody" made every steward-authored copy invisible, so
// the console skipped — and because that run reported no failures it claimed the session's back-fill marker
// and nothing retried. Default-deny: until we have actually seen a roster document we must assume the member
// might honour this author, and answer it. Rewriting a copy we did not need to is cheap and self-correcting;
// skipping one we did need to leaves a child reading "adult" indefinitely.
function _memberHonours(e, churchHex) {
  if (!e || _authFuture(e)) return false;
  if (((e.tags.find(t => t[0] === 'church') || [])[1] || '') !== churchHex) return false;   // another church's document
  if (e.pubkey === churchHex) return true;
  return _careRosterKnown ? _careRoster.has(e.pubkey) : true;
}

// Is there a copy on top of ours that we have to answer? `rec.top` is already restricted to copies the member
// would honour (see _memberHonours, passed into _newestByD as the top-slot predicate), so the only questions
// left are whether it is someone else's and whether it is newer.
function _topWeMustAnswer(rec, ours) {
  const top = rec && rec.top;
  if (!top || top.pubkey === ours.pubkey) return null;
  // `<=` treated a SAME-SECOND copy as invisible, while the member's app accepted it — so a steward key
  // stamping the church's own second was applied by the child's phone and never seen by the console, which
  // reported skipped, 0 failed, no banner. Same rule both sides now.
  if (!_beatsDoc(top, ours)) return null;
  return top;
}

// Who wins when two authorised writers disagree about a member's clearance. The member's app takes the NEWEST,
// so without a rule two consoles chase each other: each sees the other's copy on top, rewrites to get back on
// top, and the next visit from the other console does the same — a full-roster rewrite per visit, for ever,
// which is exactly the load read-before-write exists to remove.
//
// So the rule is by AUTHOR, not by clock, and it is asymmetric on purpose: a console only rewrites over a
// newer copy it OUTRANKS. The church key outranks every steward — minors: and approved: are owner-only
// documents (scripts/gateway.mjs:1206), so the owner's console is the authority by construction and a
// steward's is only ever mirroring. Between two stewards the hex pubkey breaks the tie: arbitrary, but stable,
// and stable is the whole requirement — exactly one of the pair gives way.
//
// AUDIT-8 RESTORED THIS as the only rule, reverting the version stamp that briefly replaced it. The stamp said
// "whoever derived their copy from the newer safeguarding list wins", which is the right INSTINCT and the
// wrong INSTRUMENT: the stamp was a public tag the writer chose for itself, checked by nobody. Measured, both
// halves failed. A steward key writing sv=4102444800 outranked the church for ever, with the owner's console
// reporting a clean run; and because two consoles reading the same relay derive the SAME stamp, the ordinary
// equal case fell through to "concede", so whoever wrote last won by accident.
//
// This rule is correct while the church key is the only legitimate writer, which is what the console actually
// permits today (app/stew-dashboard.jsx:3293 and :3496 keep a delegated console out of safeguarding entirely).
// When delegated stewards are given safeguarding properly, the referee must be the RELAY — which holds the
// minors: list and can refuse a clearance derived from a stale revision — and not a number the writer asserts
// about itself. See reference/BACKLOG.md.
function _clearanceOutranks(a, b, churchHex) {
  if (a === b) return false;
  if (a === churchHex) return true;
  if (b === churchHex) return false;
  return String(a) > String(b);
}
// The relays we are CURRENTLY connected to. Read-before-write asks each of them separately, because "some
// relay has it" is not the invariant a church needs — see the note in _refreshClearancesNow.
// Do these members ALREADY hold a clearance matching what we would write — on every relay we can reach?
//
// Returns `{ matching, wrong, needBy }`, or NULL meaning "could not check". Null and an empty `matching`
// must never be confused: the empty set says "we looked and nobody has it", null says "we could not look".
// Treating the second as the first is the mistake that has cost this codebase a care key once already, and it
// is the whole reason read-before-write is gated on an authenticated read.
//
//   matching — settled EVERYWHERE, and proven so by a finished read on every relay. The only safe skip.
//   wrong    — our copy is present and its CONTENT is wrong. The only thing worth alarming about.
//   needBy   — relay url -> the members missing or wrong ON THAT RELAY. Drives targeted writes, so a member
//              already correct on two of three relays is written only to the third.
//
// There is deliberately no whole-roster "definitive" flag any more. It was one global boolean covering every
// member on every relay, so a single unfinished chunk on a single relay disabled every skip in the church and
// the console rewrote the lot. Completeness is now carried per member, which is what makes a partial read
// usable rather than worthless.
//
// Used twice, deliberately sharing one implementation: to SKIP redundant writes before publishing, and to
// VERIFY before telling a steward that a child did not receive their record. Two copies of this logic would
// drift, and the second copy is the one that decides whether a safeguarding alarm is true.
// Does the stored guardian list differ from what the church intends for this child?
//
// `want` NOT BEING AN ARRAY MEANS "I DO NOT KNOW". The guardian map arrives on a subscription, and until it
// does the screen holds {} — indistinguishable from "this church has confirmed no parent links". Treating
// unknown as empty is not a harmless over-write: since the parent link became part of the clearance
// comparison (2026-08-04) it makes every child differ, so the back-fill rewrites them all with an empty
// guardian list. On the child's phone myGuardians goes empty, `linked` in canDMPeer goes false, and the child
// can no longer message their own parent — the exact thing 650e0ab exists to deliver.
//
// Not knowing is never a reason to write. An empty ARRAY still is: that is the church actively saying this
// child has no parents, which is how a removed parent reaches the child's phone.
function _guardiansDiffer(gotG, wantG) {
  if (!Array.isArray(wantG)) return false;
  if (!Array.isArray(gotG)) return !!wantG.length;
  const a = gotG.slice().sort(), b = wantG.slice().sort();
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}
async function _clearancesMatching(pubs, wantFor) {
  if (!pubs.length || !sk || !_isRelayAuthed() || _viewingNetwork()) return null;
  const readFrom = _connectedRelays();
  if (!readFrom.length) return null;
  try {
    const ds = pubs.map(p => CLEARANCE_D + String(p).toLowerCase());
    let mine = pub; try { mine = getPublicKey(sk); } catch (e) {}
    // The read bound is DERIVED too, and generously: this is the read that decides whether a steward is told
    // children lost their safeguarding record, and it runs on exactly the link that just struggled to write.
    // A flat 6s left satellite still alarming — the writes had landed, and the check to prove it timed out.
    // Too short here does not fail safe; it manufactures the very alarm the check exists to prevent.
    const readMs = (pool.maxWaitForConnection || 3000) + 9000;
    // NO `authors` FILTER. Reading only our own copy answers the wrong question. Measured: the owner marks a
    // child, a steward's console then runs a back-fill from a roster view that has not caught up and writes
    // its own copy saying "not a minor", and the owner's next visit reads its own copy, finds exactly what it
    // intended, and skips — reporting 1 skipped, 0 failed, no banner, while the child's phone reads "not a
    // minor" and nothing will ever retry. The console was checking its own work; the member reads the newest
    // copy from ANY authorised writer.
    const churchHex = actingChurch || pub;
    // The top-slot predicate is applied WHILE choosing the newest, never after — see _newestByD and
    // _memberHonours. Filtering afterwards let one newer copy from an author the member ignores displace the
    // copy that mattered, leaving the console to conclude nothing was on top at all.
    // CHUNKED, because the budget has to grow with the church. One question about the whole roster got ONE
    // fixed ~12s window, while the work grows with the membership: at ~390 bytes a record on an 8 kB/s link
    // that window cannot cover 200 people, ever. And the answer was all-or-nothing — a read that did not
    // finish authorised no skips at all, so the console rewrote the ENTIRE roster. AUDIT-8 measured 190 kB per
    // visit at 200 members, permanently, against 178 kB for a complete rewrite from scratch: the optimisation
    // that exists to avoid rewriting everything ended up rewriting everything, plus the cost of asking first.
    //
    // Each chunk gets its own window, so the budget scales; and completeness is tracked PER MEMBER, so a chunk
    // that does finish is usable even when a later one times out. Sorted, so chunk N is the same people every
    // visit — the relay returns matched events oldest-first, so chunking in arrival order would re-truncate
    // whichever half was rewritten last time and leave the same members permanently unverified.
    const CHUNK = 60;
    const sorted = [...ds].sort();
    const slices = [];
    for (let i = 0; i < sorted.length; i += CHUNK) slices.push(sorted.slice(i, i + CHUNK));
    const perRelay = await Promise.all(readFrom.map(async (u) => {
      const byD = new Map(), covered = new Set();
      for (const slice of slices) {
        let r = null;
        try { r = await _newestByD([{ kinds: [30078], '#d': slice }], readMs, [u], mine, (e) => _memberHonours(e, churchHex)); }
        catch (x) { r = null; }
        if (!r) continue;                                   // this chunk is simply unknown on this relay
        for (const [k, v] of r.byD) byD.set(k, v);
        if (r.complete) for (const d of slice) covered.add(d);   // only a FINISHED chunk proves an absence
      }
      return { url: u, byD, covered };
    }));
    // DEFAULT-DENY. The per-member loop below decides by NOT finding a reason to object, so an empty
    // `perRelay` would settle — and therefore skip — every member on the roster. `readFrom.length` above makes
    // that unreachable today; this makes it unreachable by construction, which is the standard this codebase
    // holds every other read gate to. AUDIT-7 (carried from AUDIT-5, where it was noted and left).
    if (!perRelay.length) return null;
    const ok = new Set();
    // WHICH RELAYS IS THIS MEMBER MISSING FROM. The write path used to be all-or-nothing in the other
    // direction: publish() succeeds when ANY relay accepts, while the skip required the record on EVERY relay.
    // So one relay that acknowledged writes but never served them back disabled skipping for the whole church,
    // silently, and the console rewrote every member to every relay on every visit. Now each member is written
    // only where they are actually missing.
    const needBy = new Map(readFrom.map(u => [u, new Set()]));
    // TWO QUESTIONS, NOT ONE. Folding them into a single boolean is the defect AUDIT-7 found in the previous
    // commit, and it produced the exact false banner this branch exists to remove:
    //
    //   "should I write this member?"          — yes if our copy is missing, wrong, or beneath a STALER one.
    //   "does this member HAVE their record?"  — a different question with a different answer, because a copy
    //                                            from another authorised writer sitting on top of ours is an
    //                                            excellent reason to rewrite and NO reason to raise an alarm.
    //
    // Measured with the two conflated: an owner and one delegated steward holding the SAME correct view, the
    // steward's copies on top — "3 of 3 members did not receive their updated safeguarding record", while all
    // three children read correctly on their phones throughout.
    const wrong = new Set();     // our copy is present and its CONTENT is wrong — the only DEFINITE failure
    const minorBad = new Set();  // …and specifically the MINOR field is wrong for someone who IS a child
    let scanned = 0;
    for (const p of pubs) {
      const h = String(p).toLowerCase(), key = CLEARANCE_D + h;
      // ONE ECDH PER MEMBER, not one per member per relay. The conversation key depends only on (our key, this
      // member), so recomputing it inside the relay loop multiplied the cost by the relay count for nothing.
      // AUDIT-8 measured secp256k1 ECDH at 4.37ms/op on a workstation: a 400-member roster across 3 relays was
      // 5.3 SECONDS of unbroken main thread, and 17.6s at 800 members across 5 — on a cheap Android, several
      // times worse. Hoisting it removes the relay factor outright; the yield below removes the freeze.
      // LAZY. Hoisting this out of the relay loop removed the per-relay multiplier, but it also moved it ABOVE
      // the "did we even find our copy" check — so a church's FIRST back-fill, where the relay holds nothing,
      // paid 400 ECDH operations to decrypt records that do not exist. Measured at 400 members: 34ms before
      // the hoist, 1760ms after. Computed once per member, on first actual use. AUDIT-9.
      let ck = null, ckBad = false;
      const conv = () => { if (ck || ckBad) return ck; try { ck = nip44ck(sk, h); } catch (x) { ckBad = true; } return ck; };
      let settled = true, contentWrong = false, knownEverywhere = true;
      for (const { url, byD: held, covered } of perRelay) {
        const rec = held.get(key);
        const e = rec && rec.ours;
        let needHere = false;
        // DID THIS RELAY ACTUALLY FINISH ANSWERING ABOUT THIS MEMBER? Asked FIRST, and unconditionally.
        // AUDIT-9: this used to live inside the `if (!e)` branch below — a branch that also sets
        // `needHere = true` and therefore `settled = false`. So `knownEverywhere` could only ever be false
        // when `settled` was already false, which made `if (settled && knownEverywhere)` identical to
        // `if (settled)` and the completeness requirement dead code. The case it exists for is the exact
        // opposite one: our copy IS present and correct, nothing objects, and the read simply never got far
        // enough to reveal the competing copy sitting on top of it. The relay serves matched events
        // oldest-first, so what a cut-short chunk loses is precisely the NEWEST events — the ones a skip
        // asserts do not exist. Reproduced: owner's copy delivered and perfect, a seated steward's "not a
        // minor" withheld by the truncation, member skipped, nothing retried, child's phone reads adult.
        if (!covered.has(key)) knownEverywhere = false;
        // NO `break` ON ABSENCE. Leaving the loop at the first relay that lacks our copy means a later relay
        // holding a WRONG one is never decrypted — so whether a definite loss got the definite wording came
        // down to which relay answered first. AUDIT-8 measured it: our copy absent on A and wrong on B
        // reported `wrong=0` asked as [A,B] and `wrong=1` asked as [B,A], same data both runs. Absence is
        // "unknown" and must not stop us looking for proof elsewhere.
        if (!e) {
          // Absent on a FINISHED chunk is genuinely not there; absent on a truncated one is merely unknown.
          // Either way it is worth writing: one write to a relay we are unsure about is cheap, and leaving a
          // child without their record is not.
          needHere = true;
        } else {
          let got = null;
          const k = conv();
          if (!k) { needHere = true; }   // cannot open our own copy at all — rewrite it
          else try { got = JSON.parse(nip44d(e.content, k)); } catch (x) { needHere = true; contentWrong = true; }
          if (!needHere) {
            const w = wantFor(p);
            // TWO FIELDS, AND ONLY ONE OF THEM IS ABOUT BEING A CHILD. The banner's "their app will treat them
            // as an adult" was fired for ANY content mismatch — so a 16-year-old youth helper whose `minor`
            // was stored correctly and only whose youth clearance was stale had the console announce that
            // their phone did not know they were a child. It did. Track the minor field separately so the
            // claim is only made about people it is actually true of. AUDIT-9.
            const minorWrong = !got || !!got.minor !== !!w.minor;
            // THE PARENT LINK IS PART OF THE CONTENT, and leaving it out of this comparison made the whole
            // guardians change inert: this — not same() — is the gate that decides whether a write happens, so
            // a clearance whose minor/cleared matched was filed as "correct" and skipped no matter how stale
            // its guardian list was. Measured by the adversarial review: 3 of 3 children skipped when only the
            // parent changed. Which meant unlinkParent never reached the child (a removed adult stayed a
            // parent on their phone), linking a parent to an ALREADY-marked child never reached them, and
            // every child who already existed stayed permanently unfixable. It worked only when `minor` itself
            // flipped false→true in the same call — the fresh-identity case, which is exactly what the device
            // test happened to exercise. 2026-08-04.
            //
            // Deliberately NOT minorBad: a stale parent link does not mean the child's app thinks they are an
            // adult, and AUDIT-9 exists because that banner over-claimed once already.
            const gotG = Array.isArray(got && got.guardians) ? got.guardians : null;
            // NOT `w.guardians || []` — that turned "the map has not loaded yet" into "this child has no
            // parents" and emptied every child's list. _guardiansDiffer treats a non-array want as unknown.
            const guardiansWrong = _guardiansDiffer(gotG, w.guardians);
            if (minorWrong || !!got.cleared !== !!w.cleared || guardiansWrong) {
              needHere = true; contentWrong = true;
              if (minorWrong && w.minor) minorBad.add(h);
            }
            else {
              // Our copy is right. But the member's app applies the NEWEST copy from any authorised writer,
              // and we cannot open theirs — it is sealed with THEIR conversation key with the member, not
              // ours. We can only decide whether it is ours to overrule.
              const top = _topWeMustAnswer(rec, e);
              if (top && _clearanceOutranks(e.pubkey, top.pubkey, churchHex)) needHere = true;
            }
          }
        }
        if (needHere) { settled = false; const n = needBy.get(url); if (n) n.add(h); }
      }
      // A SKIP NEEDS BOTH: nothing to correct anywhere, and a finished read everywhere to prove it. Carried
      // per member rather than as one global flag, which is what makes a partial read usable — under the old
      // whole-roster flag a single unfinished chunk on a single relay disabled every skip in the church.
      if (settled && knownEverywhere) ok.add(h);
      if (contentWrong) wrong.add(h);
      // Let the console breathe — with a REAL yield. `await null` resolves in a microtask, and the microtask
      // queue drains before the event loop turns, so the loop stayed one unbroken task and the comment claimed
      // the opposite of what the code did. Measured over 400 iterations: with `await null`, ZERO timer
      // callbacks ran during the loop; with a 0ms timer, 16 did. AUDIT-9.
      if ((++scanned % 25) === 0) await new Promise(r => setTimeout(r, 0));
    }
    return { matching: ok, wrong, minorBad, needBy };
  } catch (e) { return null; }
}

function _connectedRelays() {
  try {
    const st = pool.listConnectionStatus();
    return relays().filter(u => { let k = u; try { k = normalizeURL(u); } catch (e) {} return st.get(k) === true; });
  } catch (e) { return []; }
}

// Sequence for locally-minted event ids. Date.now() is identical across ids minted in one tick, so
// uniqueness rested on the random tail alone — 36^4 for the member app, 36^5 for the console. Measured:
// negligible at the scale these are actually used (0.004% for a dozen ids in one tick), but 2.6% for a
// 300-id batch, and these are REPLACEABLE docs, so a collision silently DELETES the earlier event. A counter
// removes the possibility rather than shrinking it. Same fix as _wizMeetingId, whose test drew 5000 ids and
// was failing the release gate one run in five. AUDIT-2026-07-29 S5.
let _evtSeq = 0;

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
    // Finish any hardware-store removal that was cut off — by the reload racing it, a hung native call, or the
    // app being killed. Fire-and-forget and a no-op without the breadcrumb, so it costs a boot nothing; but
    // without it, "Remove this church from this device" can leave the church key in the Keystore for ever with
    // nothing left to notice. AUDIT-2026-07-31.
    try { encBlobRemoveResume(); } catch (e) {}
    if (mnemonicOverride) {
      // test hook — keep behaviour but force PIN setup so an injected key never persists plaintext past first boot
      lsSet(KEY_LS, mnemonicOverride); setKey(mnemonicOverride);
      _setNeedsPin(true); window.Steward.locked = false; return true;
    }
    const boot = _bootKeyState();
    const m = boot === 'plaintext' ? lsGet(KEY_LS) : null;
    if (m) {
      // SECURITY-AUDIT-2026-06-25 Critical-2: legacy plaintext seed on disk. Load into memory, mark
      // as needing migration. The forced PIN modal will appear on the next render; setPin() will
      // atomically replace KEY_LS with ENC_LS.
      setKey(m); _setNeedsPin(true); window.Steward.locked = false; return true;
    }
    if (boot === 'locked') {
      // S6: fire-and-forget the one-time move into the hardware store. Deliberately NOT awaited — init() is
      // synchronous and the lock state below does not depend on WHERE the blob lives, only that one exists.
      // migrateEncToSecure() is a no-op unless it can read the blob back out, so the worst case is that this
      // device simply stays as it was and tries again next boot.
      migrateEncToSecure();
      window.Steward.locked = true; return false;   // PIN-locked — needs unlock(), no key in memory
    }
    if (boot === 'interrupted') {
      // A key write or removal was cut off. encBlobRemoveResume() above will settle it, but not before this
      // returns — so refuse to claim the device is empty. Locked shows an unlock screen instead of "Set up a
      // new church", and the resume re-announces once it knows.
      window.Steward.locked = true; return false;
    }
    return false;
  },
  // ---- PIN lock API ----
  hasPinLock() { return !!lsGet(ENC_LS); },
  async setPin(pin) {                              // encrypt the current seed at rest; remove the plaintext copy
    const seed = currentMnemonic || lsGet(KEY_LS);
    if (!seed || !pin) return false;
    // AUDIT-2026-07-28 F18. THE FLOOR LIVES HERE, not in the screens. There was no length check at all, and
    // the two screens that call this disagreed: the forced first-run gate demanded six, the Settings →
    // Security dialog demanded four and said so. So a steward pushed through the six-character gate could
    // afterwards change their PIN to four characters and it SUCCEEDED. This PIN is the only secret over the
    // church key at rest — the key the gate itself describes as signing "as the whole church — if it leaks,
    // an attacker can impersonate the church to every member". Enforced in the engine so a third screen
    // added later inherits it rather than having to remember. (The member app's identity.src.js has had this
    // since audit #5; the console engine never did.)
    // AUDIT-2026-07-30. Raised 6 -> 8 for STEWARDS only. The arithmetic, at PBKDF2-600k and ~17k guesses/sec on
    // one high-end GPU: six digits is a million combinations — about half a minute. Eight characters drawn from
    // the full printable set is ~6.1 quadrillion, which is ~6 billion times more work.
    //
    // Deliberately NO composition rule (no "must contain a digit"). Such rules push people to `Church01`, which
    // is compliant and dies in the first few million guesses, while REJECTING `correct horse battery staple`,
    // which is genuinely strong. Length is the only rule; the screens do the steering. Spaces are allowed
    // precisely so a passphrase works.
    //
    // Members stay at 6. They are throttled, their seed is in the OS hardware store on native, and they do not
    // hold the church key — the asymmetry is the point, not an oversight.
    //
    // Existing 6-character blobs still UNLOCK: this gate is on SETTING a secret, not on verifying one, so no
    // steward is locked out of their own church by an upgrade. They are prompted, not forced.
    if (String(pin).length < 8) return false;
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveAes(pin, salt, PIN_ITER), new TextEncoder().encode(seed)));
    // S6: goes to the hardware store on native, localStorage on web. Awaited, so needsPin is only cleared
    // once the ciphertext is durably somewhere — the plaintext KEY_LS removal below depends on that.
    const landed = await encBlobWrite(JSON.stringify({ v: 2, it: PIN_ITER, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) }));   // M11: v2 blob carries its iteration count
    // HONOUR THE ANSWER. encBlobWrite returns true only if the blob durably landed somewhere it can be read
    // back, and this call used to discard that: on a slow Keystore it reported success, dropped the plaintext
    // seed and cleared needsPin, leaving the key nowhere localStorage could see it. The comment above already
    // said the KEY_LS removal "depends on that" — nothing enforced it. Adversarial review 2026-08-04.
    //
    // Failing here is safe and recoverable: the seed is still in memory, needsPin is still set, so the forced
    // PIN modal stays up and says so. Losing the plaintext on a write that did not land is not.
    if (!landed) return false;
    try { localStorage.removeItem(KEY_LS); } catch {}
    _setNeedsPin(false);   // SECURITY-AUDIT-2026-06-25 Critical-2: encrypted form now persisted; clear the force flag
    return true;
  },
  async unlock(pin) {                              // decrypt into memory (does NOT re-write the plaintext)
    // A device-bound blob this browser can no longer open is NOT a wrong passphrase, and saying so would send
    // the steward round the "try again" loop for ever. Surfaced as a distinct state the UI explains.
    // AUDIT-2026-07-30: cleared FIRST. It used to be set once and never reset, so after recovering in place a
    // simple typo reported "this computer no longer recognises the stored key — your passphrase is fine",
    // sending the steward off to re-restore a key that was never broken. Worse, the caller returns before the
    // failed-attempt counter, so the escalating lockout stayed disabled for the rest of the session.
    window.Steward.deviceKeyLost = false;
    let raw;
    try { raw = await encBlobRaw(); }
    catch (e) { if (e && e.deviceKeyMissing) { window.Steward.deviceKeyLost = true; return false; } throw e; }
    if (!raw) return lsGet(ENC_LS) ? false : true;   // S6: a marker we cannot open is a FAILED unlock, not an open door
    try {
      const o = JSON.parse(raw);
      const seed = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(o.iv) }, await deriveAes(pin, b64d(o.salt), o.it || PIN_ITER_LEGACY), b64d(o.ct)));
      setKey(seed); window.Steward.locked = false;
      window.dispatchEvent(new CustomEvent('steward-key', { detail: { npub: window.Steward.npub } }));
      return true;
    } catch { return false; }
  },
  lock() {                                         // forget the in-memory key (idle / manual); seed stays encrypted
    // "seed stays encrypted" is only true once it HAS been encrypted. While needsPin is set — after createKey,
    // restoreKey, adoptChurch or removeLock — the seed exists nowhere but `currentMnemonic`, so forgetting it
    // is not locking, it is destroying the church. The 10-minute idle timer in steward-root.jsx fires on a
    // dep array of [ks.has], which does not change across a restore, so its pre-restore deadline stayed armed
    // over the forced-PIN screen: walk away for ten minutes and the console came back to "Set up a new
    // church". Guarded HERE rather than in the timer, so every caller is covered. Adversarial review 2026-08-04.
    if (needsPin) return;
    sk = null; pub = null; currentMnemonic = null;
    window.Steward.pubkey = null; window.Steward.npub = null; window.Steward.hasKey = false;
    window.Steward.locked = !!lsGet(ENC_LS);
    window.dispatchEvent(new CustomEvent('steward-key', { detail: { npub: null } }));
  },
  // verify a PIN against the encrypted seed at rest, with NO side effects (gates removing the lock).
  async verifyPin(pin) {
    window.Steward.deviceKeyLost = false;   // see unlock(): reports THIS attempt, never latches
    let raw;
    try { raw = await encBlobRaw(); }
    catch (e) { if (e && e.deviceKeyMissing) { window.Steward.deviceKeyLost = true; return false; } throw e; }
    if (!raw) return false;
    try {
      const o = JSON.parse(raw);
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(o.iv) }, await deriveAes(pin, b64d(o.salt), o.it || PIN_ITER_LEGACY), b64d(o.ct));
      return true;
    } catch { return false; }
  },
  // drop the PIN. SECURITY-AUDIT-2026-06-25 Critical-2: NO LONGER writes the plaintext seed back to
  // localStorage — instead sets needsPin=true. The seed stays in memory (currentMnemonic); the UI immediately
  // renders the forced PIN modal, requiring the steward to set a new PIN before any further action. Net
  // effect: there is NO post-removeLock state where a plaintext seed exists on disk, even transiently.
  //
  // K3, and the third appearance of one shape. This used to `await encBlobRemove()` here — clearing
  // localStorage AND the hardware store — which left `currentMnemonic` as the only copy of the church key in
  // existence until the steward finished typing a new PIN. cd67c7a fixed the identical order in restoreKey;
  // this window is worse, because restoreKey's is however long the modal takes while this one belongs to a
  // steward who has just been told the lock is gone, with nothing forcing them to finish. An idle auto-lock, a
  // backgrounded WebView or a crash in that window destroyed the church outright.
  //
  // Nothing needed the eager removal: setPin() → encBlobWrite() writes the SAME slot, so completing the flow
  // overwrites the old ciphertext anyway and S6's at-rest concern is still met. An ABANDONED removal now
  // leaves the previous key intact and openable with the OLD PIN — the steward keeps their church instead of
  // losing it. The blob is ciphertext in both cases; nothing is ever kept unlocked.
  async removeLock(pin) {
    if (!currentMnemonic) return false;
    if (lsGet(ENC_LS) && !(await window.Steward.verifyPin(pin))) return false;   // wrong/empty PIN → refuse
    window.Steward.locked = false;
    _setNeedsPin(true);   // force an immediate re-PIN, which overwrites the stored blob
    return true;
  },
  createKey() {
    // SECURITY-AUDIT-2026-06-25 Critical-2: NO plaintext write to localStorage. The seed lives in
    // memory only until setPin() persists the encrypted form. needsPin forces the UI to gate the
    // console behind a forced PIN-setup modal — there is NO state in which a freshly-created
    // church key sits as plaintext on disk.
    const m = generateSeedWords(); setKey(m); _setNeedsPin(true);
    _armRegGate();   // this church does not exist on any relay yet — hold its founding writes (R5-5)
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
    // CHECKSUM, not just word count. `privateKeyFromSeedWords` is a bare PBKDF2: any twelve lowercase tokens
    // derive a perfectly valid key. Without this a single mistyped word destroyed the real church key and
    // installed a stranger's — and the forced-PIN screen shows no npub or church name, so nothing on screen
    // contradicted it. The member app has validated since M12 (src/identity.src.js); the console, which holds
    // the higher-value key, did not. Adversarial review 2026-08-04.
    if (!validateMnemonic(m, wordlist)) throw new Error('That doesn’t look like a valid 12-word recovery phrase — check the spelling of each word.');
    // ORDER MATTERS, and it used to be backwards. This wiped the previous key from localStorage AND the
    // hardware store FIRST, leaving the restored seed in memory only until setPin() encrypted it. Anything
    // that ended the JS context in that window — an idle lock, a backgrounded WebView, a reload, a crash —
    // left the device with NO church key at all. Deterministic key loss, found on a phone 2026-08-04.
    //
    // Nothing needed that eager wipe: setPin() → encBlobWrite() writes the SAME slot, so a successful restore
    // overwrites the old ciphertext anyway (S6's at-rest concern is still met), and setPin() removes KEY_LS
    // itself. An ABANDONED restore now leaves the previous key intact and openable, which is the safe
    // outcome — the steward keeps the church they had instead of losing both.
    setKey(m);
    // The active church has just changed to a DIFFERENT one. Everything scoped to the old church must go with
    // it, or the roster effect republishes church A's name/care/media keys as church B's. `location.reload()`
    // used to do this by accident; nothing did it on purpose. See _resetChurchScopedState.
    _resetChurchScopedState();
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
    // validates; throws on a bad phrase. Does NOT persist — the seed is memory-only until the forced-PIN
    // modal encrypts it (see restoreKey). Callers must NOT reload, or the restored key is lost.
    return window.Steward.restoreKey(m);
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
  // Returns a promise so a caller CAN await the hardware-store half; the localStorage half is cleared
  // synchronously first, so every existing synchronous caller behaves exactly as before.
  removeKey() {
    try { localStorage.removeItem(KEY_LS); } catch {}
    window.Steward.keyResumedUnknown = false;   // K2: the steward has now answered the question the device could not
    const done = encBlobRemove();   // S6: "remove from THIS device" is a lie if the Keystore copy survives
    sk = null; pub = null; currentMnemonic = null;
    window.Steward.pubkey = null; window.Steward.npub = null; window.Steward.hasKey = false; window.Steward.locked = false;
    window.dispatchEvent(new CustomEvent('steward-key', { detail: { npub: null } }));
    return done;
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
    // NEVER while acting as a DELEGATED steward. setActiveIdentity's delegated branch sets `sk = churchSk`
    // (this device's OWN church key) with `pub` = the church we steward, and subscribeProfile fills
    // `lastProfile` from `authors:[pub]` — the OTHER church's profile. So one toggle in Settings republished
    // THIS church's kind-0 carrying the other church's name, logo, banner, feature flags and `lud16`: every
    // member's app renamed the church and repointed giving, irreversibly (kind-0 is replaceable).
    // A delegated steward cannot legitimately publish the other church's profile anyway — they do not hold its
    // key — so the honest answer is to refuse. AUDIT-2026-07-27.
    // Both refusals below MUST reach a screen. They returned Promise.resolve(null), and every one of the 20+
    // callers treats that as success — NameEditModal closes the dialog, the feature toggles keep their new
    // position, the giving-address field shows "Saved ✓". Nothing happened, and nothing said so.
    // AUDIT-2026-07-27.
    const _refuse = (what, message) => {
      try { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what, message } })); } catch (e) {}
      return Promise.resolve(null);
    };
    if (actingChurch) return _refuse('church profile', 'Only the church that owns this profile can change its name, logo, giving address or features. Ask the church owner to make this change on their own console.');
    // And never merge an edit into a profile we have not actually READ yet. `lastProfile` starts empty and is
    // only filled when the relay answers, so editing one field on a cold/slow start published a kind-0 with
    // every other field blank — wiping picture, banner, accent, features, rules and the giving address.
    // WAIT, don't refuse outright. A brand-new church types its name in step 0 of the setup wizard, before the
    // relay has answered about a profile that does not exist yet — so this guard refused the very first name a
    // church ever sets, the wizard advanced anyway, and the church was created nameless with nothing to retry
    // it. Give the subscription a bounded moment to answer (an EOSE arrives even when there is no profile,
    // which is exactly the new-church case), and only refuse if it never does.
    if (!_profileLoaded && Object.keys(lastProfile).length === 0 && Object.keys(meta || {}).length < 3) {
      return _profileSettle().then(() => {
        if (!_profileLoaded && Object.keys(lastProfile).length === 0) {
          return _refuse('church profile', 'That change hasn\u2019t been saved yet \u2014 this device is still connecting to your church\u2019s relay, and saving now would blank the settings it hasn\u2019t read. Check the relay is running and try again.');
        }
        return window.Steward.publishProfile(meta);
      });
    }
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
    if (!_mediaKeyHex && (!_mediaKeyChecked || !_isRelayAuthed())) throw new Error('Can’t encrypt this upload yet — this device hasn’t finished connecting to your church’s relay, so it can’t tell whether your church already has a media key. Wait a moment and try again.');
    if (!_mediaKeyHex) { _mediaKeyHex = _hex(crypto.getRandomValues(new Uint8Array(32))); _mediaKeyRing = [_mediaKeyHex]; }
    const targets = [...new Set([pub, ...(memberPubs || []).filter(Boolean)])];
    const _mring = JSON.stringify(_mediaKeyRing.length ? _mediaKeyRing : [_mediaKeyHex]);
    const keys = await _sealEach(_mring, targets, (pl, mp) => nip44e(pl, nip44ck(sk, mp)));
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
    const want = [...new Set([pub, ...(memberPubs || []).filter(Boolean)])]
      .filter(p => !_localBlocked.has(String(p).toLowerCase()));   // a just-blocked member must not be re-keyed (item B)
    const have = _mediaKeyDocKeys || {};
    if (want.every(p => have[p])) return false;                   // everyone's already keyed — no republish
    
    const _mring = JSON.stringify(_mediaKeyRing.length ? _mediaKeyRing : [_mediaKeyHex]);
    const keys = await _sealEach(_mring, want, (pl, mp) => nip44e(pl, nip44ck(sk, mp)));
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
    if (!_isRelayAuthed()) return false;                          // never act on an untrusted view (see the mint gate)
    if (!_mediaKeyHex) return false;                              // no key yet — mediaEncryptor mints the first
    const fresh = _hex(crypto.getRandomValues(new Uint8Array(32)));
    const ring = [fresh, ...(_mediaKeyRing.length ? _mediaKeyRing : [_mediaKeyHex])].slice(0, 12);
    const want = [...new Set([pub, ...(memberPubs || []).filter(Boolean)])];
    const payload = JSON.stringify(ring);
    const keys = await _sealEach(payload, want, (pl, mp) => nip44e(pl, nip44ck(sk, mp)));
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
      if (!_isRelayAuthed()) return false;                    // (1) never conclude "no key" from an unauthenticated read
      if (await _churchHasCareNeeds()) return false;          // (2) needs exist → a key MUST exist; minting would orphan them
      _careKeyHex = _hex(crypto.getRandomValues(new Uint8Array(32)));
      _careKeyRing = [_careKeyHex];
      _careKeyRev = 1;
    }
    // include ourselves (delegated stewards sign with their own key) and the steward roster, so a steward
    // can open needs and re-wrap for new members without the owner present
    const want = [...new Set([cp, churchPub, ...(memberPubs || []), ...(stewardPubs || [])].filter(Boolean))]
      .filter(p => !_localBlocked.has(String(p).toLowerCase()));   // a just-blocked member must not be re-keyed (item B)
    const have = _careKeyDocKeys || {};
    if (want.every(p2 => have[p2])) return false;             // everyone's keyed — no republish
    
    const _ring = JSON.stringify(_careKeyRing.length ? _careKeyRing : [_careKeyHex]);
    const keys = await _sealEach(_ring, want, (pl, mp) => nip44e(pl, nip44ck(sk, mp)));
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
    if (!_careKeyChecked || !_isRelayAuthed()) return false;  // same trusted-view rule as minting
    if (!_careKeyHex) return false;                            // nothing to rotate yet — ensureCareKeyForMembers mints the first
    const fresh = _hex(crypto.getRandomValues(new Uint8Array(32)));
    const want = [...new Set([cp, churchPub, ...(memberPubs || []), ...(stewardPubs || [])].filter(Boolean))];
    // FIT THE ENVELOPE TO THE CHURCH, and rotate a shorter history rather than not rotating at all.
    //
    // This document carries one sealed copy of the key ring per member, and the relay caps a single message
    // at 1 MB. Measured: a 12-key ring costs ~1,452 bytes per member once sealed, so the document crosses
    // 1 MB at about 723 members and the send is refused. It used to be refused SILENTLY — the caller neither
    // awaited this nor read its result — which is the worst way for this particular thing to fail, because
    // rotation is what takes the care key away from someone the church has just blocked. They stayed blocked
    // on paper and kept the key in fact.
    //
    // The ring exists so that things sealed under previous keys still open. Trimming it costs the church
    // access to OLDER sealed care records; not rotating costs them the removal itself. Between those two,
    // the removal wins — so shrink the history until it fits, and say so when we do.
    // SIZE IT BY MEASURING ONE, NOT BY ENCRYPTING EVERYONE. Sealing costs ~5 ms per member on a workstation
    // and several times that on a phone, so trial-encrypting the whole church once per candidate ring length
    // would turn a slow operation into an unusable one — measured, up to 48s at 500 members. One sealed
    // sample gives the exact per-member cost for that ring length, because the size depends on the ring and
    // not on who it is sealed to.
    const full = [fresh, ...(_careKeyRing.length ? _careKeyRing : [_careKeyHex])].slice(0, 12);
    const probe = want[0];
    let ring = null;
    for (let n = full.length; n >= 1; n -= (n > 4 ? 2 : 1)) {
      const cand = full.slice(0, n);
      let per = 0;
      try { per = 64 + String(nip44e(JSON.stringify(cand), nip44ck(sk, probe))).length + 6; } catch (e) { break; }
      if (per * want.length < 900000) { ring = cand; break; }
    }
    let keys = null;
    if (ring) {
      const payload = JSON.stringify(ring);
      keys = await _sealEach(payload, want, (pl, mp) => nip44e(pl, nip44ck(sk, mp)));
    }
    if (!keys) {
      // Even a single-key ring will not fit — past roughly 1,400 members this document needs splitting across
      // several, which changes what every reader has to look up. Refuse loudly rather than pretend.
      console.warn('[steward] care key rotation too large for one document at ' + want.length + ' members');
      return false;
    }
    if (ring.length < full.length) console.warn('[steward] care key ring trimmed to ' + ring.length + ' to fit ' + want.length + ' members — older sealed care records will no longer open');
    const ok = await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', CAREKEY_D + cp], ['t', NET]], content: JSON.stringify({ keys, rev: (_careKeyRev || 1) + 1 }) }));
    if (ok === false) return false;
    _careKeyRing = ring; _careKeyHex = fresh; _careKeyRev = (_careKeyRev || 1) + 1; _careKeyDocKeys = keys;
    return true;
  },
  // has this device actually completed a NIP-42 auth? Callers use it to tell "the church has none" apart
  // from "the relay didn't serve it to us" before doing anything destructive. See _requireTrustedView.
  relayAuthed() { return _isRelayAuthed(); },

  careKeyChecked() { return _careKeyChecked; },
  // the console feeds the live steward roster in, so the envelope's author check stays current when a
  // steward is revoked (a revoked steward's envelope must stop being accepted, same as their content)
  // roster just changed — adopt any buffered envelope it now verifies.
  // An EMPTY list from this entry point is ignored once the engine's own subscription has read a real roster
  // (see subscribeStewards). The caller is a React effect whose hook starts at [] and re-fires [] on every
  // remount, so an empty list here means "I have nothing yet" far more often than "this church has no
  // stewards" — and blanking the roster silently switches off the check that decides whether another writer's
  // copy is one the member honours. A genuine removal arrives through the subscription, which does set it
  // empty. AUDIT-8.
  setCareRoster(list) {
    const next = new Set((list || []).filter(Boolean));
    if (next.size || !_careRosterKnown) _careRoster = next;
    _reCheckCareKeyPending();
  },
  // recover the church media key on THIS device (unwrap our own wrapped entry) — so a restored console re-keys.
  subscribeMediaKey() {
    if (!pub) return () => {};
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#d': [MEDIAKEY_D + pub] }], {
      // Ring-aware, and tolerant of the legacy shape: a wrapped value is a JSON array of keys now (newest
      // first) but older envelopes hold one bare hex string. Reading only the new form would make every
      // sermon encrypted before the upgrade undecryptable.
      onevent(e) { try { const o = JSON.parse(e.content); _mediaKeyDocKeys = (o && o.keys) || null; const mine = o.keys && o.keys[pub]; if (mine && sk) { const plain = nip44d(mine, nip44ck(sk, e.pubkey)); let r = null; try { const q = JSON.parse(plain); if (Array.isArray(q)) r = q.filter(k => typeof k === 'string' && k); } catch (x2) {} const incoming = (r && r.length) ? r : [plain]; _mediaKeyRing = [...incoming, ..._mediaKeyRing.filter(k => incoming.indexOf(k) === -1)]; _mediaKeyHex = _mediaKeyRing[0];   /* KEEP what this device already held: if we minted before the envelope arrived, discarding our key here would orphan anything encrypted in that window. Rotation must never drop a key that has already sealed something. */ } } catch (x) {} },
      oneose() { _mediaKeyChecked = true; },   // no envelope came back → it is safe to mint one
    });
    return () => { try { sub.close(); } catch {} };
  },
  // true if every relay this console has opened is still connected. The console's reconnect ticker only
  // re-subscribes when this is FALSE — so a healthy socket never triggers a full-corpus re-query (the steward
  // subs are broad + un-cursored, so blindly re-REQing every 90s would re-download the whole church every 90s).
  // HANDOFF-2026-07-31 (4). This used to ask only `st.get(url) === false`, which a dead relay never is: the
  // pool DELETES it from the map on close, so its status is `undefined`. The console therefore reported itself
  // healthy with every socket gone, the ticker never fired, and nothing re-subscribed — measured as a Members
  // list frozen at 6 while a 7th member joined, recoverable only by reloading.
  //
  // The rule is "a relay we have actually opened (or tried to) is not currently connected". Only relays still
  // in relays() are considered, so one the steward has REMOVED cannot pin the console unhealthy for ever.
  // Try to re-open every relay we EXPECT to be connected to and are not. Returns true only if at least one
  // actually came back — which is the only thing that justifies re-subscribing.
  //
  // AUDIT-2026-07-31. The reconnect ticker used to re-subscribe whenever relaysHealthy() was false, and
  // relaysHealthy() is an AND over every url in relays(). One durably-unreachable entry — a stale named-relay
  // tunnel, a blocked canonical relay on a censored network — therefore made it re-download the entire church
  // every 90 seconds, for ever. Adding a backoff only slowed that to four times an hour and made a GENUINE
  // drop wait up to fifteen minutes, because the reset condition ("everything healthy") was unreachable in
  // exactly the configuration it was written for.
  //
  // Opening a socket is cheap; re-querying the whole church is not. So probe first and re-subscribe only on
  // success. A relay that is never coming back costs one failed connect attempt per heartbeat and nothing
  // else; a relay that returns is picked up on the next tick.
  async reconnectDownRelays() {
    let back = false;
    try {
      const st = pool.listConnectionStatus();
      // In PARALLEL. Sequentially, a slow or stalled relay delays — and previously blocked entirely — every
      // relay listed after it, so a healthy relay could never be recovered because a dead one came first.
      const probes = [];
      for (const url of relays()) {
        let k = url; try { k = normalizeURL(url); } catch (e) {}
        if (st.get(k) === true) continue;             // already up
        if (!_relaysTouched.has(k)) continue;         // never opened — ordinary subscription will handle it
        // BOUNDED, and this is not optional. ensureRelay() only arms its timer when a timeout is passed
        // (AbstractRelay.connect), and every other pool path passes pool.maxWaitForConnection — this was the
        // one connect in the codebase without one. A middlebox that accepts the socket and says nothing, or a
        // dropped SYN, then leaves this await pending for ever. AUDIT-3 measured it still hanging at 12s while
        // an ordinary subscription gave up at 1.5s. The caller holds a re-entry flag across this await, so one
        // stalled probe silently disables the console's ONLY reconnect ticker for the rest of the session —
        // which is HANDOFF finding 4, the exact bug this whole mechanism exists to close, restored by its fix.
        //
        // Raced independently of the connect as well: a promise that never settles cannot be fixed by a
        // parameter alone if a future nostr-tools drops the option.
        const timeout = pool.maxWaitForConnection || 3000;
        probes.push(Promise.race([
          pool.ensureRelay(k, { connectionTimeout: timeout }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('probe timed out')), timeout + 500)),
        ]).then(() => { back = true; }, () => {}));
      }
      await Promise.all(probes);
    } catch (e) {}
    return back;
  },
  // Is a relay CONNECTED but on a different socket than the one our subscriptions were established on? That
  // is the "deaf but connected" state, and it is distinct from "a relay is down": re-subscribing fixes it
  // immediately and then stops. Kept separate from relaysHealthy() so the ticker can tell the two apart — a
  // relay that is simply DOWN must not trigger a re-subscribe on every heartbeat, which is the storm. AUDIT-4.
  // The ticker calls this immediately after bumping, once it has caused every subscription hook to rebuild.
  // That is the ONLY thing allowed to say "our subscriptions now live on these sockets" — see the note on
  // onRelayConnectionSuccess for why a bare successful connect is not evidence of that.
  markResubscribed() {
    try {
      for (const url of relays()) {
        let k = url; try { k = normalizeURL(url); } catch (e) {}
        const live = pool.relays.get(k);
        if (live) _subbedOn.set(k, live);
      }
    } catch (e) {}
  },
  relaysReplaced() {
    try {
      const st = pool.listConnectionStatus();
      for (const url of relays()) {
        let k = url; try { k = normalizeURL(url); } catch (e) {}
        const on = _subbedOn.get(k);
        if (on && st.get(k) === true && pool.relays.get(k) !== on) return true;
      }
      return false;
    } catch (e) { return false; }
  },
  relaysHealthy() {
    try {
      const st = pool.listConnectionStatus();
      for (const url of relays()) {
        let k = url; try { k = normalizeURL(url); } catch (e) {}   // the pool's map is keyed normalised
        const s = st.get(k);
        if (s === false) return false;                              // present and reporting down
        if (s !== true && _relaysTouched.has(k)) return false;      // we had this one open; now it is gone entirely
        // CONNECTED IS NOT LISTENING. A drop destroys every subscription, and the next ordinary read or write
        // re-opens the socket — so the url reads connected while nothing is subscribed on it and nothing has
        // re-authenticated. Asking only "is a socket open?" reported that as healthy, which left the console
        // deaf to new members AND refusing every safeguarding write with "wait a moment and try again", for
        // the rest of the session. Compare the INSTANCE our subscriptions were established on. AUDIT-4.
        const on = _subbedOn.get(k);
        if (on && pool.relays.get(k) !== on) return false;          // same url, different socket
      }
      return true;
    } catch (e) { return true; }
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
    const gkey = group && (_skeys[group] || [])[0];   // encrypted group → seal the post under the CURRENT key (ring[0])
    if (gkey) { try { body = nip44e(content || '', gkey); encTag = [['enc', '1']]; } catch (e) {} }
    return publish(feChurch({ kind: 1, created_at: now(), tags: [['t', NET], ['t', group || 'announce'], ['p', pub], ...encTag], content: body }));
  },
  // SAFETY CHECK (emergency "mark as safe" roll-call). Start one for the managed church — members are alerted
  // and can respond; each response is encrypted to US (the creator, `pub`). Works as owner OR delegated steward.
  async startSafetyCheck(message, audience) {
    const cp = actingChurch || pub; if (!sk || !cp) return null;
    const id = 'sc' + now() + Math.random().toString(36).slice(2, 6);
    // WHO MAY READ THE REPLIES is chosen by the steward when the check is started, and travels WITH the check
    // so a member's app seals to exactly that audience — no second setting to drift out of step.
    //
    // Before this, every reply was sealed to the event SIGNER alone. With a delegated steward that meant one
    // volunteer's phone was the only device on earth that could open "I need help", while the screen told the
    // member "your church's leaders" could see it. The church key is now ALWAYS a recipient as well, so the
    // answers survive that volunteer being unreachable — which in the emergency this feature exists for is
    // exactly the phone most likely to be lost. UX audit 2026-08-04.
    const aud = (audience === 'care') ? 'care' : 'stewards';
    const content = JSON.stringify({ id, message: String(message || 'Are you safe?').trim().slice(0, 280), at: now(), open: true, audience: aud });   // no `by` — members encrypt to the event SIGNER, not a content field
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
          // v2 carries one ciphertext per reader, keyed by pubkey; v1 was a bare string sealed to the check's
          // starter alone. Read BOTH — a check already running when the multi-reader change shipped still has
          // v1 replies arriving, and losing those would lose "I need help" from the one window that matters.
          let payload = e.content;
          try {
            const env = JSON.parse(e.content);
            if (env && env.v === 2 && env.to) {
              payload = env.to[String(pub || '').toLowerCase()] || env.to[String(window.Steward.pubkey || '').toLowerCase()] || '';
              if (!payload) return;   // not sealed to us — a reader outside the chosen audience
            }
          } catch (e2) {}
          const o = JSON.parse(nip44d(payload, ck));
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
        if (e.tags.some(t => t[0] === 'enc')) {
          const ring = _skeys[groupId]; if (!ring || !ring.length) return;
          let ok = false;
          for (const k of ring) { try { text = nip44d(e.content, k); ok = true; break; } catch (x) {} }   // current key, then superseded
          if (!ok) return;
        }
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
    // NAMESPACE NEW IDS. The relay refuses a claim on an id whose embedded owner is not the signer's church, so
    // a room created here is protected on relays that have never seen its definition. A bare `grp<timestamp>`
    // names nobody and can be claimed by any co-tenant on such a relay.
    const id = group.id || ((String(pub || '').slice(0, 16) || 'grp') + '-' + Date.now().toString(36));
    const inviteOnly = group.visibility === 'invite';
    const content = JSON.stringify({ name: group.name || 'Group', kind: group.kind || 'group', sub: group.sub || '', icon: group.icon || '', accent: group.accent || '', leaders: Array.isArray(group.leaders) ? group.leaders : [], order: typeof group.order === 'number' ? group.order : undefined, category: group.category || undefined, visibility: inviteOnly ? 'invite' : undefined, members: inviteOnly && Array.isArray(group.members) ? group.members : undefined, encrypted: group.encrypted ? true : undefined, childsafe: group.childsafe ? true : undefined, eventPolicy: EVENT_POLICIES.indexOf(group.eventPolicy) > 0 ? group.eventPolicy : undefined });
    // ALL RELAYS, NOT THE FIRST TO ANSWER. A relay polices a church's traffic with its OWN copy of this
    // document; a relay that never received it cannot police anything and fails open. `publish()` is
    // Promise.any — it resolves the moment one relay accepts — while members' apps fan their messages to every
    // configured relay, so the rule landed on one and the traffic on all of them. Measured 2026-08-17: a
    // 12-year-old's message refused by the relay holding her church's minors list, and delivered anyway.
    //
    // A partial write now reports FAILURE. A steward who ticks "mark as a child" and sees it succeed has been
    // told the protection is in force; if the record reached one relay of three, it is in force on one of
    // three. An error is recoverable, false reassurance is not.
    return _publishToRelays(feChurch({ kind: 30078, created_at: now(), tags: [['d', GROUP_D + id], ['t', NET]], content }))
      .then(e => (e ? { id, ...JSON.parse(content), ts: e.created_at } : null));
  },
  // set which members can post events for a group (re-publishes the group def, preserving its fields)
  setGroupLeaders(group, leaderPubs) {
    return window.Steward.publishGroup({ ...group, leaders: (leaderPubs || []).filter(Boolean) });
  },
  // WHO MAY CREATE AN EVENT IN THIS GROUP: 'stewards' | 'leaders' | 'everyone'.
  // 'leaders' is the default and is what this app has always done — the named leaders may post, and a group
  // naming nobody is stewards-only as a consequence. So a church that never opens this screen keeps exactly
  // the behaviour it has today. The relay enforces all three (gateway.mjs, the EVENT_D branch of accept), and
  // enforces safeguarding on top of them: a minor may never publish an event, and into a CHILD-SAFE group a
  // delegated member must be on the church's cleared-adults list.
  setGroupEventPolicy(group, policy) {
    if (!EVENT_POLICIES.includes(policy)) return Promise.resolve(null);
    return window.Steward.publishGroup({ ...group, eventPolicy: policy });
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
  async publishGroupKey(groupId, memberPubs, opts = {}) {
    if (!churchSk || !churchPub) return Promise.resolve(null);
    const haveRing = (_skeys[groupId] || []).length > 0;
    if (opts.reuseOnly && !haveRing) return Promise.resolve(null);   // background re-key must NOT mint a new key (would orphan history)
    // The locally-known blocklist wins over a stale caller list (AUDIT-2026-08-10 item B): the roster effect
    // calls this with the same stale roster in the same post-block window as the name key.
    const recips = [...new Set([churchPub, ...(memberPubs || []).map(p => toPubHex(p) || p).filter(Boolean)])]
      .filter(p => !_localBlocked.has(String(p).toLowerCase()));
    let ring = _skeys[groupId] || [];
    let key = ring[0];
    // AUDIT-2026-07-24: the contract above ("must NOT mint a new key — would orphan history") was enforced only
    // for the background reuseOnly path. The INTERACTIVE path — a steward adding one member to an existing
    // encrypted group — minted whenever `key` was missing, and `_skeys` is populated only when the envelope has
    // arrived. Adding a member before it landed re-keyed the group and orphaned every prior message in it,
    // permanently. A missing key is only safe to interpret as "new group" once we've had an authenticated read.
    if (!opts.rotate && !key && !_isRelayAuthed()) return Promise.resolve(null);
    // ROTATION KEEPS THE OLD KEYS. Replacing the ring with one fresh key is what made a block erase the group's
    // whole readable history on every phone — _decEvt drops what it cannot open, so the messages simply vanish.
    // Carry the superseded keys along, newest first, exactly as the care key does. AUDIT-2026-07-27.
    if (opts.rotate || !key) {
      key = crypto.getRandomValues(new Uint8Array(32));
      _srev[groupId] = (_srev[groupId] || 0) + 1;
      ring = [key, ...ring].slice(0, GROUP_RING_MAX);
    } else if (!ring.length) ring = [key];
    _skeys[groupId] = ring;
    const rev = _srev[groupId] || 1; _srev[groupId] = rev;
    // TWO SHAPES, DELIBERATELY. `keys` holds ONLY the current key as bare hex — exactly what every already-
    // installed app expects. `rings` holds the whole ring as a JSON array for apps that understand it.
    // Writing only the ring shape was a silent field break in the direction that actually happens: the console
    // and relay update first and phones follow over days, so the next roster tick would have re-keyed every
    // group with a payload old apps parse into garbage. _decEvt DROPS what it cannot open, so every member on
    // an un-updated phone would have opened Prayer or their life group to an EMPTY ROOM — no error, no spinner,
    // nothing to diagnose. The compat comment on the member side reasoned about the opposite direction only.
    // AUDIT-2026-07-27.
    _senvTs[groupId] = now();
    // A MEMBER WE COULD NOT SEAL TO MUST NOT VANISH QUIETLY. This loop skipped any pubkey that threw and
    // carried on, and the publish reported success — so that member was simply absent from the envelope.
    // The member side treats "no copy for me" as REMOVAL and deletes any key it held, so they lose the room
    // rather than merely failing to gain it: nothing new decrypts, and (since the send now refuses rather
    // than publishing in clear) nothing can be posted either, with the app telling them to try again in a
    // moment, indefinitely. Nobody is told — not them, not the steward.
    //
    // The skip itself is right: one unusable pubkey must not cost everyone else their key. What was wrong is
    // that it was silent. Collect them and hand them back.
    // `build` stays self-contained and returns the skips alongside the envelope rather than writing to a
    // variable outside itself — group-key-ring.test.mjs lifts this function out of the source and runs it,
    // and an outer reference turns that test into a ReferenceError rather than a check.
    let skipped = [];
    const build = (r) => {
      const keys = {}, rings = {}, missed = [];
      const cur = _hex(r[0]), wrapped = JSON.stringify(r.map(_hex));
      for (const pk of recips) {
        try { const ck = nip44ck(churchSk, pk); keys[pk] = nip44e(cur, ck); rings[pk] = nip44e(wrapped, ck); }
        catch (e) { missed.push(pk); }
      }
      build.missed = missed;
      return JSON.stringify({ rev, keys, rings });
    };
    // A church large enough to push the sealed ring past the relay's 1 MB cap sheds history rather than
    // failing to publish: a shorter ring costs old messages, a refused envelope costs the group entirely.
    let content = build(ring);
    skipped = build.missed || [];
    for (let r = ring.length; content.length > 900000 && r > 1; ) {
      r = Math.max(1, r >> 1);
      content = build(ring.slice(0, r));
      skipped = build.missed || [];
    }
    const ok = await publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GROUPKEY_D + groupId], ['t', NET]], content }, churchSk));
    if (ok === false) return false;
    if (skipped.length) {
      console.warn('[steward] group key ' + groupId + ': could not seal to ' + skipped.length + ' member(s) — they cannot read or post in that room');
      return { ok: true, skipped: skipped.slice() };
    }
    return true;
  },
  // ---- seal a group interactively: key FIRST, flag SECOND, both awaited, every result honoured. ----
  //
  // AUDIT-2026-08-10 item A. The seal used to fire publishGroup({encrypted:true}) and publishGroupKey side
  // by side and read neither result, so any failure of the key publish — relay refused the envelope (size,
  // quota, a socket flap between the two writes), console not yet relay-authed so minting is unsafe, no
  // church key on this device — left the room FLAGGED encrypted with no envelope anywhere. Every member's
  // send is then refused ("try again in a moment", for ever), nothing decrypts, and the steward saw success.
  // Key-first inverts the failure: the worst new outcome is an unused envelope on the relay (benign — a
  // retry reuses the ring), never a dead room.
  //
  // publishGroupKey's null collapses "no church key", "reuseOnly without a ring" and "not authed, so minting
  // is unsafe" into one answer. "Not connected" is the only one of those a steward can act on, so it is
  // answered up front, before any bytes are spent.
  //
  // For the INTERACTIVE seal only (doSeal / Encrypt-all). The KeyDistributor must NOT come through here —
  // its reuseOnly path is deliberately different: it must never mint.
  async sealGroup(group, memberPubs) {
    if (!group || !group.id || !churchSk) return { sealed: false, reason: 'cannot-key' };
    if (!_isRelayAuthed()) return { sealed: false, reason: 'not-authed' };
    let r = null;
    try { r = await window.Steward.publishGroupKey(group.id, memberPubs); } catch (e) { r = null; }
    // no usable envelope on the relay → the group doc is never touched; the room stays honestly cleartext
    if (r === null || r === false) return { sealed: false, reason: r === null ? 'cannot-key' : 'relay-refused' };
    const ok = await window.Steward.publishGroup({ ...group, encrypted: true });
    // publishGroup resolves an OBJECT even when every relay refused (its .then builds one over publish()'s
    // false) — `ts` carries the truth: the accepted event's created_at, or false. Reading mere truthiness
    // here would report a refused flag write as sealed, which is the exact lie this function exists to end.
    if (!ok || !ok.ts) return { sealed: false, keyPublished: true, reason: 'flag-failed' };
    return { sealed: true, skipped: (r && r.skipped) || [] };
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
    // SYNCHRONOUS, before the publish (AUDIT-2026-08-10 item B): the recipient builders must know about the
    // block in the same tick it happens, not after the relay round-trip — that lag is the window in which the
    // roster effect re-keyed the person just blocked. Full replacement, so an unblock clears it too.
    _localBlocked = new Set(list.map(p => String(p).toLowerCase()));
    const content = JSON.stringify({ pubkeys: list });
    // ALL RELAYS, NOT THE FIRST TO ANSWER — see setMinors for the full reasoning. A red-team insider proved
    // this one on 2026-08-18: their ban reached only one of the three relays their app connected to, and on
    // the two that lacked the block they AUTHENTICATED and read the entire adult group. The relay refuses to
    // authenticate a blocked key — but only a relay that HOLDS the block. A ban published single-accept is a
    // ban on one relay.
    return _publishToRelays(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', BLOCKED_D + pub], ['t', NET]], content }, sk));
  },

  // ---- safeguarding: two church-signed lists the relay reads to enforce child protection ----
  // minors:<churchpub> = members marked as children; approved:<churchpub> = adults cleared to contact youth
  // (should mirror the church's real DBS/cleared list). The relay rejects a kind-4 DM where one party is
  // a minor and the other isn't on the approved list. The member app uses minors to show a child only
  // child-safe groups. Replaceable docs, church-only writes. ----
  // AUDIT-2026-07-28 F6. Is this member's uploaded photo one a steward has switched off? The member app has
  // had this since the feature shipped (_avSuppressPhoto in fellowship.src.js, consulted inside displayFor,
  // so EVERY member-app surface gets it for free). The console had no equivalent at all, so a photo suppressed
  // for safeguarding still drew — on the one screen where a steward would be moderating an image of a child,
  // while the button beside it promised "your church sees their symbol/initial". Kept as a module-level set
  // fed by subscribeSafeguard, deliberately the same shape as the member app's, so the two cannot drift.
  photoSuppressed(memberPub) { return isPhotoSuppressed(memberPub, _noPhoto); },
  subscribeSafeguard(onLists) {   // onLists({ minors, approved, nophoto, guardians, loaded })
    let minors = [], approved = [], nophoto = [], guardians = {};
    // NEWEST WINS, per document. These are three separate replaceable docs riding one subscription, so they
    // need three timestamps: a single shared one would let a fresh minors list suppress a perfectly current
    // approved list that simply happened to arrive after it. Safeguarding lists are the worst place to let a
    // stale copy from a lagging relay win — it would quietly reinstate a child-protection state the church
    // has already changed.
    let tMinors = 0, tApproved = 0, tNophoto = 0, tGuardians = 0;
    // `loaded` says the relay has ANSWERED, not that the lists are non-empty. The clearance backfill must
    // not run before it: sealing every member a 'not a minor' clearance from lists that had simply not
    // arrived yet would strip child status from every child in the church. AUDIT-2026-07-27.
    let sawMinors = false, sawEose = false;
    // LOADED MEANS THE GUARDIAN MAP IS KNOWN TOO, and that needs both halves. The minors document proves we
    // are AUTHENTICATED (it is served to nobody else), and eose proves the stored set has been delivered in
    // full. Only together do they license reading an absent guardians document as "this church has confirmed
    // no parent links" rather than "it has not arrived yet".
    //
    // The guardian map rides here rather than on its own subscription because the two used byte-identical
    // filters — so a separate subscription could never tell the caller anything about THIS one's progress,
    // and the back-fill was left guessing. Guessing is what emptied children's parent lists. It also returns
    // a subscription slot, against a cap this codebase has been bitten by before.
    const isLoaded = () => sawMinors && sawEose;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }, { kinds: [30078], '#church': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (_authFuture(e)) return;   // no future-dated pins on any safeguarding doc
        // minors + approved are OWNER-ONLY; nophoto is owner-or-steward — mirror the relay per doc.
        if (d === MINORS_D + pub) { if (!_byChurch(e)) return; if (e.created_at < tMinors) return; tMinors = e.created_at; sawMinors = true; try { minors = (JSON.parse(e.content).pubkeys) || []; } catch { minors = []; } onLists({ minors, approved, nophoto, guardians, loaded: isLoaded() }); }
        else if (d === APPROVED_D + pub) { if (!_byChurch(e)) return; if (e.created_at < tApproved) return; tApproved = e.created_at; try { approved = (JSON.parse(e.content).pubkeys) || []; } catch { approved = []; } onLists({ minors, approved, nophoto, guardians, loaded: isLoaded() }); }
        else if (d === NOPHOTO_D + pub) { if (!_byChurchOrSteward(e)) return; if (e.created_at < tNophoto) return; tNophoto = e.created_at; try { nophoto = (JSON.parse(e.content).pubkeys) || []; } catch { nophoto = []; } _applyNoPhotoList(nophoto); onLists({ minors, approved, nophoto, guardians, loaded: isLoaded() }); }
        // OWNER-ONLY, like minors and approved: a steward must not be able to invent a parent link.
        else if (d === GUARDIANS_D + pub) { if (!_byChurch(e)) return; if (e.created_at < tGuardians) return; tGuardians = e.created_at; try { guardians = (JSON.parse(e.content).links) || {}; } catch { guardians = {}; } onLists({ minors, approved, nophoto, guardians, loaded: isLoaded() }); }
      },
      // EOSE IS NOT EVIDENCE. It fires on a 4.4s client timeout, on a dropped relay, and before NIP-42 auth
      // lands — and the minors doc is served only to an authenticated reader. So "loaded" meant "a
      // subscription ended", and the clearance back-fill downstream treated that as "this church has no
      // children", sealing every child a doc saying they are an adult — which their app then trusts OVER the
      // list fallback. `ensureNameKeyForMembers` three functions below already states this rule: an empty
      // answer from an unauthenticated or unreachable relay looks exactly like a real one. AUDIT-2026-07-28.
      oneose() { sawEose = true; onLists({ minors, approved, nophoto, guardians, loaded: isLoaded() }); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setNoPhoto(pubkeys) {   // replace the whole photo-suppression list (church-signed, owner-only)
    _requireTrustedView('photo settings');
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', NOPHOTO_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },
  // Tell ONE member what their own safeguarding status is, sealed to them. This exists so a member's app can
  // know whether THEY are a child or a cleared adult without the church publishing a cleartext list of its
  // children to the whole congregation — the relay no longer serves `minors:` to ordinary members, and joining
  // an open-join church is a single self-signed publish, so that list was one frame away from any stranger.
  // AUDIT-2026-07-27. Church-tagged so the relay can check the author is that church or one of its stewards.
  publishClearance(memberPub, status, urls) {
    if (!sk || _viewingNetwork()) return Promise.resolve(null);   // a network identity has no members
    if (urls && !urls.length) return Promise.resolve(null);   // read says every relay already holds it: nothing to do
    const mp = toPubHex(memberPub) || memberPub;
    if (!/^[0-9a-f]{64}$/i.test(mp || '')) return Promise.resolve(null);
    // `guardians` = the pubkeys this church has CONFIRMED as this member's parents. It goes here, sealed to the
    // member, because this doc is the only place a child can learn it safely.
    //
    // Why not the obvious alternatives (UX audit 2026-08-04, finding #2):
    //   * the church's `guardians:` MAP is deliberately steward-only — it maps every child in the congregation
    //     to their parents — so a child's device is never served it, `linked` was permanently false in
    //     canDMPeer, and a child could not message their own parent. SAFEGUARDING.md promises they can.
    //   * the `guardreq:` documents are readable by the child, and using them would be UNSAFE: a request is
    //     authored by the CLAIMED parent, and accept() only enforces that the author is who they say they are
    //     (SECURITY-AUDIT-2026-07-20 C1) — not that they are that child's parent. Trusting them would let any
    //     adult self-declare as a child's parent and bypass the DM restriction.
    // The church is the only party that knows the confirmed link, so the church has to say so.
    const guards = Array.from(new Set((status && status.guardians || []).map(x => String(x || '').toLowerCase()).filter(x => /^[0-9a-f]{64}$/.test(x)))).sort();
    const body = JSON.stringify({ minor: !!(status && status.minor), cleared: !!(status && status.cleared), guardians: guards, at: now() });
    let ct = ''; try { ct = nip44e(body, nip44ck(sk, mp)); } catch (e) { return Promise.resolve(null); }
    // The ['church'] tag is EXPLICIT, not left to feChurch. feChurch only adds it when acting as a DELEGATED
    // steward, so a church OWNER — the ordinary case — published this with no church tag, the relay's accept
    // rule requires one, and every clearance was refused. Silently: the member's app then fell back to the
    // minors list, which the same day's work stopped serving to members, so isMinor was false for every child
    // in every church. A safeguarding regression created by the change meant to protect them. The test missed
    // it by hand-building the event WITH the tag instead of calling this function. AUDIT-2026-07-27.
    const cp = actingChurch || pub;
    // A REFUSED CLEARANCE IS A FAILURE, INCLUDING THE TIE-BREAK ONE. HANDOFF-2026-07-31 (2) proposed treating
    // the relay's "a newer version of this is already stored" as success, on the grounds that the relay must
    // then hold something at least as new. That was implemented, audited, and REVERTED on 2026-07-31 — the
    // reasoning is wrong in a way that costs a child their clearance:
    //
    //   • The tie-break compares created_at, not CONTENT. `created_at` is whole seconds and the relay accepts
    //     up to 900s of clock skew (scripts/event-store.mjs), so a steward whose phone clock runs fast can
    //     write {minor:false} and win against the correct {minor:true} that follows. Reproduced: the correct
    //     write came back have-newer, the run reported failed:0, no banner, and — because the back-fill records
    //     a clean run as done — nothing ever retried. The child's app reads "not a minor". event-store.mjs says
    //     it plainly: a future-dated doc "can NEVER be corrected — an honest-timestamped fix is rejected as
    //     'have-newer', pinning the stale state".
    //   • The string is free text chosen by the relay (scripts/gateway.mjs:3720), not a NIP-01 signal. Under
    //     this product's threat model — a seized or compelled relay — accepting it as proof that a child's
    //     safeguarding record is stored hands an adversary a way to suppress every clearance and have the
    //     console report a clean save.
    //
    // Counting it as a failure is noisy and self-healing: the banner fires, the marker is not recorded, and the
    // next Members visit retries with a fresh created_at that wins cleanly. Noisy beats silently wrong here.
    // The COLLISION ITSELF is removed at source by refreshClearances' read-before-write (item 7), so a
    // tie-break refusal is now a rare, genuine signal rather than routine noise.
    // NO VERSION STAMP. A public ['sv', …] tag naming the safeguarding-list revision this copy came from was
    // added and then removed: the writer chose the number itself and nobody checked it, so it decided the
    // ranking in favour of whoever asserted the largest value. It also told any reader of the relay the exact
    // second a church last edited its list of children, and told the member themselves — a fact the read gate
    // deliberately withholds from them. When delegated stewards get safeguarding, the revision check belongs
    // on the RELAY, which holds the list and can refuse a stale write outright. AUDIT-8.
    return Promise.resolve(_publishToRelays(feChurch({ kind: 30078, created_at: now(), tags: [['d', CLEARANCE_D + mp], ['t', NET], ['p', mp], ['church', cp]], content: ct }), urls))
      .then(r => {
        // Remember what we just put on the wire, so a second writer moments later can tell it is redundant
        // WITHOUT waiting for the relay to echo it back. The read-before-write below closes the steady-state
        // case; this closes the sub-second one, which is the common one: toggleMinor() calls _reseal for the
        // member AND changes the safeguarding list, and the list echoing back re-runs the whole-roster
        // back-fill — both writing this same doc inside one second.
        // Record WHICH relays this write covered. The 15s skip below is a sub-second-collision guard, and
        // once writes are targeted a member written to relay A must not have their relay-B write suppressed
        // by a cache that only remembers "we wrote this member". `urls: null` means the full fan-out.
        if (r) { try { _clearanceSent.set(mp, { minor: !!(status && status.minor), cleared: !!(status && status.cleared), guardians: guards, at: Date.now(), urls: (urls && urls.length) ? urls.slice() : null }); } catch (e) {} }
        return r;
      });
  },
  // Refresh the sealed clearance for a set of members — called whenever either safeguarding list changes, so a
  // member's own copy never lags the church's. Best-effort per member: one failure must not block the rest.
  // AUDIT-2026-07-28 F9. This fired one publish per member with nothing awaited between them, so a
  // whole-roster back-fill hit the relay as a single burst on ONE socket. gateway.mjs caps inbound messages
  // at 100 per second per connection and — this is the part that makes it a safeguarding bug rather than a
  // performance one — a message over the cap is `return`ed with NO REPLY AT ALL. Not OK=false, not a NOTICE.
  // Measured against a real gateway: 150 clearance publishes sent in 7ms produced 100 OK, 0 refusals, and
  // 50 with no answer of any kind; the relay stored 100 of 150. Those 50 members have no clearance document,
  // their app falls back to the minors list, and the relay stopped serving that list to ordinary members —
  // so every child past roughly the hundredth is treated as an ADULT, silently.
  //
  // So: publish in small batches, paced under the cap, and never let the failure be quiet again. The batch
  // is awaited, which gives back-pressure for free; the wait is bounded so one publish that never resolves
  // (exactly what a dropped message looks like) cannot stall the rest of the roster.
  // READ BEFORE WRITE. HANDOFF-2026-07-31 item 7 — the cure for everything findings 2 and 3 were patching.
  //
  // Two parts of the console write the SAME clearance doc within one second, routinely: toggleMinor() calls
  // _reseal() for the member it touched, and it also changes the safeguarding list, which echoes back from the
  // relay, changes the effect's signature, and re-runs the WHOLE-ROSTER back-fill. `created_at` is whole
  // seconds, so both land in the same one and the relay refuses the loser on its NIP-01 tie-break. That
  // refusal was being shown to the steward as "this child did not receive their safeguarding record" —
  // measured at 8 of 12 toggles, with all 21 records actually stored, on a warning banner that has no dismiss
  // timer. Alarm fatigue on the safeguarding screen is the harm: a REAL delivery failure looks identical.
  //
  // Two earlier attempts patched the symptom. Treating the refusal as success let a fast clock pin a child as
  // an adult, silently and permanently (reverted). Guarding the double-fire helped but left the toggle path,
  // which is the dominant source. The actual problem is that the console republishes documents it has no
  // reason to send — 21 identical seals on every Members visit — so this stops sending them.
  //
  // The church can read its own clearances back: nip44 conversation keys are symmetric, so the same key that
  // sealed it opens it. Fetch what the relay holds, decrypt, and skip every member whose {minor, cleared}
  // already matches. A repeat Members visit becomes a no-op, the collision disappears at source, and a
  // tie-break refusal goes back to meaning something.
  //
  // FAIL-SAFE DIRECTION, and this is the part that matters: a member is skipped ONLY on a positive match — we
  // read a document, decrypted it, and it says what we were about to say. Anything else — no document, an
  // unreachable relay, an unauthenticated read, a decrypt failure, unparseable content — falls through and
  // publishes exactly as before. Never skip on an empty answer; that is the mistake that has cost this
  // codebase a care key and nearly cost a child their clearance.
  //
  // AND IT RUNS ONE AT A TIME. Read-before-write only helps if the read can see the other writer's work, and
  // the two writers here start together: toggleMinor() fires _reseal and changes the list in the same tick, so
  // both runs read the OLD state, both conclude the member needs updating, and both publish into the same
  // second. Measured: read-before-write alone took the false banner from 8 toggles in 12 down to 1 in 4 — the
  // remainder being exactly this overlap. Queueing removes it: the second run reads after the first has
  // written and finds nothing to do. Cheap, because in steady state that second run is now a no-op.
  refreshClearances(memberPubs, minors, approved, guardians) {
    const run = () => window.Steward._refreshClearancesNow(memberPubs, minors, approved, guardians);
    // Never let one run's rejection break the chain for every later caller.
    const next = _clearanceQueue.then(run, run);
    _clearanceQueue = next.then(() => {}, () => {});
    return next;
  },
  async _refreshClearancesNow(memberPubs, minors, approved, guardians) {
    // A NETWORK VIEW HAS NO MEMBERS, so there is nothing to back-fill and nothing to report. Without this the
    // refusal cascaded into a false alarm: publishClearance returns null here, every member landed in
    // `unconfirmed`, _clearancesMatching also refuses, and the run ended with failed === roster and a
    // "couldn't confirm the record saved" banner about people who do not exist in this view. Found by the
    // AUDIT-8 test written to cover _viewingNetwork — which nothing had exercised, because all three harnesses
    // set `pub === churchPub` and the guard was constant-false.
    if (_viewingNetwork()) return { results: [], failed: 0, skipped: 0, total: 0, unverified: false };
    const mins = new Set((minors || []).map(x => String(x || '').toLowerCase()));
    const appr = new Set((approved || []).map(x => String(x || '').toLowerCase()));
    let pubs = [...new Set((memberPubs || []).filter(Boolean))];
    const BATCH = 20, GAP_MS = 250;   // ≤80/s, comfortably under the relay's 100/s per-connection cap
    // Derived from the timeouts it actually contains, not a round number. 8000ms was racing a worst case of
    // maxWaitForConnection (3000) + the relay's publishTimeout (4400) = 7400ms — a coin flip on a slow link,
    // and every lost toss became a false "this child did not receive their record". Still bounded, because a
    // dropped message produces a promise that never settles and one of those must not stall the roster.
    let _pubMs = 4400; try { _pubMs = (pool.relays.values().next().value || {}).publishTimeout || 4400; } catch (e) {}
    const _BATCH_MS = (pool.maxWaitForConnection || 3000) + _pubMs + 3000;
    const out = [];
    let failed = 0, skipped = 0, pending = 0;
    const unconfirmed = [];   // written but not acknowledged — verified below before anyone is alarmed
    // The confirmed parent links, normalised the same way publishClearance normalises them so `same()` is
    // comparing like with like. A child whose parent link changes MUST be re-sealed, or their app keeps the
    // old answer — which is why guardians joins the comparison rather than riding along unchecked.
    const gmap = new Map();
    try {
      const src = guardians || {};
      for (const k of Object.keys(src)) {
        gmap.set(String(k).toLowerCase(),
          Array.from(new Set((src[k] || []).map(x => String(x || '').toLowerCase()).filter(x => /^[0-9a-f]{64}$/.test(x)))).sort());
      }
    } catch (e) {}
    // UNKNOWN vs EMPTY. A caller that has not yet received the guardian map passes null/undefined; a caller
    // that knows the church has no parent links passes {}. The first must not be read as the second — doing
    // so rewrites every child with an empty guardian list and cuts them off from their own parent. So an
    // absent map yields `undefined` per child, which _guardiansDiffer treats as "do not touch".
    // NULL means "I do not know the parent links" — the caller had not received the map yet. Omitting the
    // argument keeps its long-standing meaning ("no guardian data to sync", behaves as {}), because several
    // callers and every existing test do exactly that, and changing what silence means would have quietly
    // disabled guardian sync everywhere. Only an explicit null says "do not touch these".
    // NULL MEANS "I DO NOT KNOW THE PARENT LINKS", and the only safe response is to write nothing at all.
    //
    // No caller passes null any more: the guardian map rides the safeguarding subscription now, so the screen
    // waits for `loaded` and then always knows. This is the backstop for a future caller that does not — and
    // it has to exist, because publishClearance collapses a missing guardian list to [] and writes it, so a
    // write triggered for ANY other reason would blank a child. Holding back is free: `pending` already means
    // "no write, no alarm, look again next visit".
    //
    // Omitting the argument keeps its long-standing meaning ("no guardian data to sync", behaves as {}) —
    // several callers and tests do that, and changing what silence means would disable guardian sync widely.
    const guardsUnknown = guardians === null;
    const guardsKnown = !guardsUnknown;
    const guardsFor = (h) => (guardsKnown ? (gmap.get(h) || []) : undefined);
    const sameList = (x, y) => { const a = x || [], b = y || []; return a.length === b.length && a.every((v, i) => v === b[i]); };
    const want = (p) => { const h = String(p).toLowerCase(); return { minor: mins.has(h), cleared: appr.has(h), guardians: guardsFor(h) }; };
    const same = (a, b) => !!a && !!b && !!a.minor === !!b.minor && !!a.cleared === !!b.cleared && sameList(a.guardians, b.guardians);

    // (a) Anything this console itself put on the wire in the last few seconds, still identical. Covers the
    //     sub-second toggle race without depending on how fast the relay echoes.
    const total = pubs.length;
    const fresh = Date.now() - 15000;
    const connNow = _connectedRelays();
    pubs = pubs.filter(p => {
      const sent = _clearanceSent.get(String(p).toLowerCase());
      // Only a write that reached EVERY relay we can currently see earns the skip. A targeted write covered
      // the relays that needed it at the time; a relay that has since reconnected still needs this member.
      const coversAll = sent && (!sent.urls || connNow.every(u => sent.urls.indexOf(u) !== -1));
      if (sent && sent.at >= fresh && same(sent, want(p)) && coversAll) { skipped++; return false; }
      return true;
    });

    // (b) …and anything the relay already holds with the right answer. Bounded and wrapped: a read that fails
    //     for ANY reason must leave every member in the publish list.
    // Only read when we KNOW the read is trustworthy. A clearance is a private doc, so an unauthenticated
    // connection is served an empty answer identical to "this church has no record" — and the relay's NIP-42
    // challenge is lazy, so a fresh socket may still be anonymous when this runs. We never skip on an empty
    // answer, so an unauthenticated read is merely useless rather than dangerous; gating it keeps the
    // behaviour DETERMINISTIC instead of depending on whether the challenge round-trip beat the EOSE. Measured
    // without this: the same test collided on some runs and not others.
    //
    // EVERY RELAY WE CAN REACH, ASKED SEPARATELY — not a union. AUDIT-4 measured the union version losing a
    // child's record permanently: publish() succeeds via Promise.any as soon as ONE relay accepts, so with
    // relay B down the doc lands on A alone; the next visit reads the union, sees it on A, and skips the
    // member — so B never receives it, on that visit or any later one. Before read-before-write existed the
    // unconditional republish healed that by accident. Measured: `stored on A 3/3, stored on B 0/3`, still
    // 0/3 after a retry visit from a fresh console. A member whose phone reads B then finds no clearance,
    // falls back to the minors: list the relay will not serve them, and is treated as an adult.
    //
    // Currently-CONNECTED relays rather than all configured ones: a relay that is down cannot be written to
    // either, so holding it against the skip would just disable read-before-write for the whole outage — the
    // write amplification back at exactly the moment the link is worst. The residual is that a relay which
    // was down at write time still needs reconciling when it returns; that is what the _clearanceSent clear
    // on a connection change below is for, and a full per-relay outbox is the real cure.
    if (guardsUnknown) return { results: [], failed: 0, skipped: 0, pending: pubs.length, total: pubs.length, unverified: true };
    const already = await _clearancesMatching(pubs, want);
    // A SKIP REQUIRES A FINISHED READ, and the comment that used to sit here — "a partial read simply proves
    // less, so the worst it can do is republish" — was true until read-before-write started asking whether
    // anyone ELSE's copy sits on top of ours. That makes a skip rest on a NEGATIVE: "no newer copy from
    // another writer exists", which is precisely what a read cut short cannot establish. `matching` now
    // carries that requirement per member, so a chunk that finished is usable even when a later one did not.
    if (already) {
      pubs = pubs.filter(p => { if (already.matching.has(String(p).toLowerCase())) { skipped++; return false; } return true; });
    }
    // WRITE ONLY WHERE IT IS MISSING. `needBy` says which relays actually lack each member's record, so a
    // member already correct on two of three relays costs one write, not three. Falls back to every connected
    // relay when the read could not run at all — with no information, writing everywhere is the safe default.
    const targetsFor = (h) => {
      if (!already || !already.needBy) return null;                 // no read: publish the normal way
      const urls = [];
      for (const [u, set] of already.needBy) if (set.has(h)) urls.push(u);
      return urls;
    };

    for (let i = 0; i < pubs.length; i += BATCH) {
      const slice = pubs.slice(i, i + BATCH);
      const settle = Promise.allSettled(slice.map(p => {
        const h = String(p).toLowerCase();
        return window.Steward.publishClearance(p, { minor: mins.has(h), cleared: appr.has(h), guardians: guardsFor(h) }, targetsFor(h));
      }));
      // NOTHING TO WRITE, AND NOTHING TO CONFIRM. A member can be correct on every relay we heard from while
      // the read still did not finish — so they are not skippable (an unfinished read cannot prove no newer
      // copy exists) and yet there is no write to make. Publishing to nobody returns null, and null used to
      // mean "unconfirmed", which sent a perfectly healthy member into the verify read and, on a poor link,
      // into a "we couldn't check whether the record saved" banner about a write that was never attempted.
      // Count them as PENDING instead: no write, no alarm, and — via `pending` in the result — no completion
      // marker either, so the next Members visit genuinely re-checks them. AUDIT-9; this became reachable only
      // once the completeness guard started working.
      slice.forEach(p => { const t = targetsFor(String(p).toLowerCase()); if (t && !t.length) pending++; });
      // A dropped message produces a promise that never settles, so an unbounded await here would hang the
      // whole back-fill on the first one — turning a partial failure into a total one.
      const rs = await Promise.race([settle, new Promise(r => setTimeout(() => r(null), _BATCH_MS))]);
      // UNCONFIRMED, not failed. Everything below is a member whose write we did not see acknowledged — which
      // is not the same as a member who did not receive their record, and conflating the two is what makes the
      // safeguarding banner cry wolf on every real connection (measured: 3 of 8 reported lost on 2G, 6 of 8 on
      // satellite, with every record actually stored). They are checked after the loop.
      if (!rs) { unconfirmed.push(...slice); } else {
        out.push(...rs);
        rs.forEach((r, k) => {
          const t = targetsFor(String(slice[k]).toLowerCase());
          if (t && !t.length) return;                       // pending, not unconfirmed — see above
          if (r.status === 'rejected' || r.value === false || r.value === null) unconfirmed.push(slice[k]);
        });
      }
      if (i + BATCH < pubs.length) await new Promise(r => setTimeout(r, GAP_MS));
    }
    // VERIFY BEFORE ALARMING. A write we did not see acknowledged is not a child who did not receive their
    // record — on a slow link it is usually a confirmation that arrived after we stopped waiting. So go and
    // LOOK before saying anything: read the unconfirmed members back and keep only the ones genuinely missing
    // or wrong. Measured before this: 3 of 8 reported lost on 2G and 6 of 8 on satellite, with every record
    // actually stored, on a banner that has no dismiss timer. Alarm fatigue on the safeguarding screen is the
    // harm — a real failure then looks identical and gets waved away.
    //
    // `unverified` is the third answer and it must stay distinct from the other two. If the link is too poor
    // to read back, we do NOT know, and both "they failed" and "they are fine" would be lies. Never treat it
    // as fine: an unverifiable answer is the one this codebase has mistaken for good news before.
    let unverified = false, lost = 0, lostKids = 0;
    if (unconfirmed.length) {
      const landed = await _clearancesMatching(unconfirmed, want);
      if (!landed) { failed = unconfirmed.length; unverified = true; } else {
        const missing = unconfirmed.filter(p => !landed.matching.has(String(p).toLowerCase()));
        failed = missing.length;
        // WHAT KIND OF "MISSING" IS THIS? Three kinds, and only one of them is a lost record.
        //
        //   read it back and the CONTENT is wrong — definite. Say so plainly; this is what the banner is for.
        //   the read found NOTHING                — unknown. The write we are checking never confirmed, so it
        //                                           may still be in flight; a read that overtakes it gets an
        //                                           honest EOSE from a relay that has genuinely not received
        //                                           it YET. Measured on satellite: 7 of 8 reported lost, every
        //                                           one stored moments later.
        //   somebody else's copy is on top        — unknown, and NOT a failure. We rewrite it because we can
        //                                           see it was written from an older view of the lists, not
        //                                           because we know it is wrong; we cannot read it at all.
        //                                           Conflating this with the first told an owner "3 of 3
        //                                           members did not receive their record" while all three
        //                                           children read correctly on their phones. AUDIT-7.
        const lostPubs = missing.filter(p => landed.wrong.has(String(p).toLowerCase()));
        lost = lostPubs.length;
        // Not "is a child" — "is a child whose stored record gets that WRONG". An undecryptable copy is a
        // definite failure but tells us nothing about what it says, so it never reaches this count.
        lostKids = lostPubs.filter(p => landed.minorBad && landed.minorBad.has(String(p).toLowerCase())).length;
        unverified = failed > lost;
      }
    }
    // NOT SILENT. The whole point of a clearance is that a child's own app knows it is a child; a back-fill
    // that half-worked and said nothing is how they were treated as adults for a day.
    if (failed) {
      try {
        // TWO COUNTS, ONE INSTRUCTION. A run can produce both answers at once and the softer one must not speak
        // for the definite one — with a single flag, a member whose record was read back and found WRONG was
        // reported as "may well have saved" because someone else in the same run had merely not been seen.
        //
        // AUDIT-8 fixed what the sentences SAY. Two things were untrue as written:
        //   - "their app cannot tell that they are a child" was printed for ADULTS. The back-fill writes a
        //     record for every member on the roster, so `lost` counts adults whose "not a minor" record failed
        //     just as readily as children. Being wrong about who is a child is the exact harm this whole path
        //     exists to prevent, so the banner must not do it either. The child sentence is now conditional on
        //     there actually being children among them.
        //   - "1 of 1 members" — the single-child toggle is the commonest case of all, and it read as broken
        //     English every time.
        // The instruction is given ONCE at the end rather than in both halves, where it read as two different
        // actions ("to retry" vs "to check") for the same tap.
        // Counts lead, nouns follow, so nothing has to agree with a number that changes: "1 of 8 people" reads
        // correctly for every value, where "1 person ... have" does not.
        // A roster of one is the commonest case of all — it is what marking a single child produces — and
        // "1 of 1 people" read as broken English every time it fired.
        const who = (k) => total === 1 ? 'this person' : k + ' of ' + total + ' people';
        const kids = total === 1
          ? ' \u2014 they are marked as a child, so their app will treat them as an adult'
          : lostKids === 1
            ? ' \u2014 1 of them is marked as a child, so their app will treat them as an adult'
            : ' \u2014 ' + lostKids + ' of them are marked as children, so their apps will treat them as adults';
        const soft = 'we couldn\u2019t check whether the record saved for ' + who(failed - lost)
          + ' \u2014 the connection dropped before your church\u2019s relay replied. '
          + (total === 1 ? 'It may well be fine.' : 'They may well be fine.');
        const hard = 'the wrong record is saved for ' + who(lost) + (lostKids ? kids : '') + '.';
        const message = 'Safeguarding: '
          + (!lost ? soft : (unverified ? hard + ' And ' + soft : hard))
          + ' Reopen Members while connected to your relay to try again.';
        window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'safeguarding clearances', message } }));
      } catch (e) {}
    }
    // `total` is the ROSTER, not what we ended up publishing — the steward counts people, not writes. `skipped`
    // is the members already holding the right record; it is the measure of how much work read-before-write
    // saved, and on a healthy repeat visit it should equal `total`.
    return { results: out, failed, skipped, total, unverified, pending };
  },
  // ── congregation name key ────────────────────────────────────────────────────────────────────────────────
  // A member's display name is what turns a pubkey into a person. Published in the clear it gave the relay —
  // and any mirror holding a copy of this church — a named roster. The church mints a key, wraps a copy for
  // every member, and members seal their own name under it. Same shape as the care and media keys, including
  // the RING: rotating on removal must not orphan the names already published. AUDIT-2026-07-27.
  // Modelled on ensureCareKeyForMembers, which had already learned all of this the hard way. Every guard below
  // exists because its absence destroys data rather than merely failing. AUDIT-2026-07-27.
  async ensureNameKeyForMembers(memberPubs, stewardPubs, opts = {}) {
    // Serialise: let any publish already in flight finish and commit its recipient map before deciding.
    while (_nameKeyBusy) { try { await _nameKeyBusy; } catch (e) { break; } }
    let _release;
    _nameKeyBusy = new Promise(r => { _release = r; });
    try {
      return await this._ensureNameKeyLocked(memberPubs, stewardPubs, opts);
    } finally { _nameKeyBusy = null; _release(); }
  },
  async _ensureNameKeyLocked(memberPubs, stewardPubs, opts = {}) {
    if (!churchSk || !churchPub) return Promise.resolve(null);
    const cp = actingChurch || pub;
    // (1) NEVER act on a view we have not established. "The relay returned no envelope" is not proof that none
    // exists — the envelope is private, so an unauthenticated or unreachable relay gives the same empty answer.
    if (!_nameKeyChecked || !_isRelayAuthed()) return Promise.resolve(null);
    let ring = _nameKeyRing.slice();
    // (2) An envelope EXISTS and we are not in it: the church owner must add us. Minting here is what a
    // DELEGATED console did — it can never read the owner's envelope (its own key was not a recipient), so it
    // held an empty ring, and one block() call minted a brand-new single-key ring and published it as the
    // church's name key. Members accept it, newest-wins, and every sealed name in the congregation stops
    // opening. Rotation does NOT excuse this: a rotate with no ring is exactly that bug.
    if (!ring.length && _nameKeyDocKeys) return Promise.resolve(null);
    if (opts.rotate && !ring.length) return Promise.resolve(null);
    if (opts.rotate || !ring.length) ring = [_hex(crypto.getRandomValues(new Uint8Array(32))), ...ring].slice(0, NAME_RING_MAX);
    // (3) Include the acting church and the steward roster, not just this device. Omitting `cp` is why a
    // delegated console could never read the envelope in the first place.
    // BOTH halves of the union are filtered against the locally-known blocklist (AUDIT-2026-08-10 item B):
    // filtering only `want` leaves the grow-path re-add — the blocked member comes straight back out of
    // `Object.keys(have)`, which is the old envelope's recipient map and still contains them.
    const want = [...new Set([cp, churchPub, ...(memberPubs || []), ...(stewardPubs || [])].map(p => toPubHex(p) || p).filter(Boolean))]
      .filter(p => !_localBlocked.has(String(p).toLowerCase()));
    const have = _nameKeyDocKeys || {};
    // (4) GROW, never shrink — except on an explicit rotate. This runs on every roster tick, and the roster
    // arrives in pieces, so an early call held a PARTIAL member list. Publishing that dropped everyone missing
    // from it, and the member side treats "I am not in this envelope" as revocation and deletes its keys — so
    // half the congregation would have gone anonymous until a fuller envelope happened along. A block is the
    // one case where removing a recipient is the whole point, and that is what opts.rotate marks.
    const recips = (opts.rotate ? want : [...new Set([...want, ...Object.keys(have)])])
      .filter(p => !_localBlocked.has(String(p).toLowerCase()));
    // (5) Everyone already keyed and nothing rotated → say nothing. Without this the console republished on
    // every 150 ms roster emit; each envelope makes every member's app re-open every sealed name in the church
    // and re-render every subscriber.
    if (!opts.rotate && ring.length === _nameKeyRing.length && recips.every(p2 => have[p2])) return Promise.resolve(null);
    // (6) FIT THE ENVELOPE TO THE CHURCH — the same 1 MB ceiling, and the same trade, as the care key. This
    // document also carries one sealed copy of the ring PER RECIPIENT, and NAME_RING_MAX is 12 exactly as the
    // care ring is, so it is refused by the relay at the same ~723 members. It was refused silently, and the
    // block handler did not await this call at all, so in a large church a Block took the care key away and
    // left the NAME key in place — and a blocked member holding the name key can still read the whole
    // congregation's names, which is the one thing this encryption exists to prevent.
    //
    // WHAT A TRIM ACTUALLY COSTS — corrected 2026-08-13, because the first version of this note described a
    // recovery mechanism that does not exist. It claimed members re-seal because `_ringId` changes. They do
    // not: `_ringId` fingerprints the HEAD of the ring and a trim removes the TAIL, so on a non-rotating
    // trim the stamp is unchanged and `syncSealedNames` skips everyone. Nothing re-seals in session.
    //
    // What really recovers it is unrelated and weaker: `_sealedMine` is an in-memory Map, so a member
    // re-seals at their next COLD START. So the true cost of a trim is that every name sealed under a
    // dropped key is unreadable until that member next launches the app from scratch — and permanently, for
    // anyone who never comes back. The console loses those keys too, since the envelope is replaceable.
    //
    // It is still the right trade against not rotating at all — a blocked member holding the name key reads
    // the whole congregation — but it is a real cost to a real congregation, not the self-healing one the
    // old note promised. Note also that the trim is reached on ordinary GROWTH, not only on a Block.
    const probe = recips[0];
    let fitted = null;
    for (let n = ring.length; n >= 1; n -= (n > 4 ? 2 : 1)) {
      const cand = ring.slice(0, n);
      let per = 0;
      // one sealed sample, not the whole church per candidate — see the note on rotateCareKey
      try { per = 64 + String(nip44e(JSON.stringify(cand), nip44ck(churchSk, probe))).length + 6; } catch (e) { break; }
      if (per * recips.length < 900000) { fitted = cand; break; }
    }
    if (!fitted) {
      console.warn('[steward] name key envelope too large for one document at ' + recips.length + ' members');
      return false;
    }
    if (fitted.length < ring.length) console.warn('[steward] name key ring trimmed to ' + fitted.length + ' to fit ' + recips.length + ' members — names not yet re-sealed under the new key will be blank until that member is next online');
    ring = fitted;
    _nameKeyRing = ring;
    const wrapped = JSON.stringify(ring);
    // Sealed one at a time WITH THE THREAD HANDED BACK. This ran as a synchronous loop over every recipient at
    // ~5 ms each on a workstation and several times that on a phone, so a 500-member church froze the console
    // for seconds — after a Block, which is precisely when a steward needs to see that something is happening.
    const keys = await _sealEach(wrapped, recips, (pl, pk) => nip44e(pl, nip44ck(churchSk, pk)));
    const out = await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', NAMEKEY_D + cp], ['t', NET]], content: JSON.stringify({ rev: ring.length, keys }) }));
    _nameKeyDocKeys = keys;
    return out;
  },
  // read the envelope back (the church's own copy) so the console can decrypt members' names
  subscribeNameKey() {
    const cp = actingChurch || pub;
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#d': [NAMEKEY_D + cp] }], {
      onevent(e) {
        if (!_byChurchOrSteward(e)) return;   // church key or a CURRENT roster steward, same rule as every other envelope
        try {
          const env = JSON.parse(e.content || '{}');
          // Record the recipient map even when we cannot open our own copy: "an envelope exists" is exactly
          // what stops this console minting a second key over it.
          if (env.keys && typeof env.keys === 'object') { _nameKeyDocKeys = env.keys; _nameKeyChecked = true; }
          const mine = env.keys && churchPub && env.keys[churchPub];
          if (!mine || !churchSk) return;
          const plain = nip44d(mine, nip44ck(churchSk, e.pubkey));
          const r = JSON.parse(plain);
          if (Array.isArray(r)) _nameKeyRing = r.filter(x => typeof x === 'string' && /^[0-9a-f]+$/i.test(x));
        } catch (x) {}
      },
      oneose() { _nameKeyChecked = true; },   // the relay answered — a church with no envelope yet may now mint its first
    });
    return () => { try { sub.close(); } catch {} };
  },
  // open a member's sealed name. Tries every key in the ring so a rotation never hides older names.
  openMemberName(content, authorPub) {
    // { c, m }: `c` is the congregation's (or, before admission, the church's) copy; `m` is the member's own
    // recovery copy, which is sealed to them alone and is none of the console's business. A bare string is the
    // pre-Stage-2 shape.
    let ct = String(content || '');
    if (ct.startsWith('{')) { try { const o = JSON.parse(ct); ct = (o && typeof o.c === 'string') ? o.c : ''; } catch (x) { ct = ''; } }
    if (!ct) return '';
    for (const k of _nameKeyRing) {
      try { const o = JSON.parse(nip44d(ct, _unhex(k))); if (o && typeof o.name === 'string') return o.name.slice(0, 40); } catch (x) {}
    }
    // A member awaiting approval has no congregation key yet, so their copy is sealed to the church key alone.
    // Without this fallback a gated church would see every join request as a nameless npub — and the relay
    // deliberately lets those members write the doc precisely so the steward has a name to approve.
    if (authorPub && churchSk) {
      try { const o = JSON.parse(nip44d(ct, nip44ck(churchSk, toPubHex(authorPub) || authorPub))); if (o && typeof o.name === 'string') return o.name.slice(0, 40); } catch (x) {}
    }
    return '';
  },
  nameKeyReady() { return _nameKeyRing.length > 0; },
  setMinors(pubkeys) {   // replace the whole minors list (pass hex pubkeys)
    _requireTrustedView('list of children');
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    // ALL RELAYS, NOT THE FIRST TO ANSWER. A relay polices a church's traffic with its OWN copy of this
    // document; a relay that never received it cannot police anything and fails open. `publish()` is
    // Promise.any — it resolves the moment one relay accepts — while members' apps fan their messages to every
    // configured relay, so the rule landed on one and the traffic on all of them. Measured 2026-08-17: a
    // 12-year-old's message refused by the relay holding her church's minors list, and delivered anyway.
    //
    // A partial write now reports FAILURE. A steward who ticks "mark as a child" and sees it succeed has been
    // told the protection is in force; if the record reached one relay of three, it is in force on one of
    // three. An error is recoverable, false reassurance is not.
    return _publishToRelays(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MINORS_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },
  setApproved(pubkeys) {   // replace the whole approved-adults list (pass hex pubkeys)
    _requireTrustedView('cleared-adults list');
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    // ALL RELAYS, NOT THE FIRST TO ANSWER. A relay polices a church's traffic with its OWN copy of this
    // document; a relay that never received it cannot police anything and fails open. `publish()` is
    // Promise.any — it resolves the moment one relay accepts — while members' apps fan their messages to every
    // configured relay, so the rule landed on one and the traffic on all of them. Measured 2026-08-17: a
    // 12-year-old's message refused by the relay holding her church's minors list, and delivered anyway.
    //
    // A partial write now reports FAILURE. A steward who ticks "mark as a child" and sees it succeed has been
    // told the protection is in force; if the record reached one relay of three, it is in force on one of
    // three. An error is recoverable, false reassurance is not.
    return _publishToRelays(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', APPROVED_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
  },

  // ---- safeguarding v2: parent↔child links. Parents publish a guardian-link REQUEST (guardreq:<childpub>,
  // p-tagged to us); the steward confirms it into the church-signed GUARDIANS map (guardians:<churchpub>),
  // which the relay reads so a parent may always DM their own child. ----
  subscribeGuardianRequests(onReqs) {   // pending parent requests → [{ child, parent, ts }] — names come from the roster
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
        // No claimed names any more — Stage 2 removed them from the request entirely. They were never rendered
        // (C1: a requester-supplied name is forgeable, so the card shows the name WE resolved from the roster),
        // and carrying a child's name plus their parent's in a member-readable document was the larger leak.
        else { try { const c = JSON.parse(e.content); if (c.child && c.child !== child) return; byChild.set(child, { child, parent: e.pubkey, ts: e.created_at }); } catch {} }
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
    // ALL RELAYS, NOT THE FIRST TO ANSWER. A relay polices a church's traffic with its OWN copy of this
    // document; a relay that never received it cannot police anything and fails open. `publish()` is
    // Promise.any — it resolves the moment one relay accepts — while members' apps fan their messages to every
    // configured relay, so the rule landed on one and the traffic on all of them. Measured 2026-08-17: a
    // 12-year-old's message refused by the relay holding her church's minors list, and delivered anyway.
    //
    // A partial write now reports FAILURE. A steward who ticks "mark as a child" and sees it succeed has been
    // told the protection is in force; if the record reached one relay of three, it is in force on one of
    // three. An error is recoverable, false reassurance is not.
    return _publishToRelays(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GUARDIANS_D + pub], ['t', NET]], content: JSON.stringify({ links: clean }) }, sk));
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
  // AUDIT-2026-07-28 F10. A new church published its join policy at wizard step 0 — before the relay had been
  // told the church exists. accept() refuses any kind-30078 write from a key that is not a configured church
  // of that relay, so that write succeeded ONLY against an empty relay, where accept() short-circuits to
  // "unconfigured = open". Measured against a real gateway:
  //
  //     relay hosts NOTHING,        new church sets approval  -> accepted
  //     relay hosts church A,       church A sets approval    -> accepted
  //     relay hosts church A,   NEW church B sets approval    -> REFUSED  "blocked: not a member…"
  //
  // The wizard swallowed the refusal and advanced, and "no policy published" is precisely what the relay
  // reads as OPEN — so a church set up on any relay that already hosts a congregation was created open-join
  // and nobody was told. The same shape as the publishClearance bug earlier in the week: correct against the
  // one empty relay it was tried on, refused by a real one.
  //
  // So this is idempotent and self-healing rather than a single shot at the worst possible moment. Call it
  // again after the church registers with its relay, and on console boot — which repairs the churches the
  // broken flow has already created, the next time a steward opens the console.
  //
  // It publishes ONLY when the church has never published a policy at all: a steward who deliberately chose
  // open must stay open. And it acts only on an ANSWERED read. EOSE is trustworthy HERE — unlike the
  // safeguarding lists, where treating it as "no data" is its own bug — precisely because joinpolicy is the
  // one document canRead() serves to everyone, so an empty answer cannot be an auth failure in disguise.
  async ensureJoinPolicy() {
    if (!sk) return { ok: false, reason: 'no key' };
    const cp = pub;
    const read = await new Promise((resolve) => {
      let best = null, eosed = false, done = false;
      const finish = () => { if (done) return; done = true; try { sub.close(); } catch (e) {} resolve({ best, eosed }); };
      // Both shapes subscribeJoinPolicy uses: the church's own doc, and one a rostered steward wrote for it.
      const sub = pool.subscribeMany(relays(), [
        { kinds: [30078], authors: [cp], '#d': [JOINPOLICY_D + cp] },
        { kinds: [30078], '#church': [cp], '#d': [JOINPOLICY_D + cp] },
      ], { onevent(e) { if (!best || (e.created_at || 0) > (best.created_at || 0)) best = e; }, oneose() { eosed = true; finish(); } });
      setTimeout(finish, 5000);
    });
    if (!read.eosed) return { ok: false, reason: 'the relay did not answer' };
    if (read.best) return { ok: true, already: true };
    const r = await window.Steward.setJoinPolicy(true);
    if (r) return { ok: true, published: true };
    // Refused. Say so — a church silently left open to anyone holding the join link is the thing this
    // whole document exists to prevent, and the console has a mounted banner for exactly this.
    try {
      window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'join policy',
        message: 'Your church is not set up on this relay yet, so “people must be approved before they can '
          + 'join” could not be saved — anyone with your join link can currently join straight in. Finish '
          + 'connecting your church to its relay, then reopen the console and this will apply itself.' } }));
    } catch (e) {}
    return { ok: false, reason: 'refused' };
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
  // RECONNECT A MEMBER ONTO A NEW KEY, as one action. Lives here rather than in the modal because a re-seat
  // is not two writes — it is a seat MOVING, and everything attached to the seat has to move with it. Every
  // piece of that was previously left to whoever wrote the UI to remember, and none of it was remembered.
  //
  // WHAT MOVES WITH THE SEAT, and why each one has to:
  //   minors: / approved:   name a PUBKEY. Left behind, the child's phone finds no record and falls back to a
  //                         list the relay refuses to serve ordinary members — so absence reads as adulthood,
  //                         and the relay opens too (safeguardAllows lets anyone DM a key no church calls a
  //                         minor). Worse, the next Members visit then SEALS "not a minor" to the new key, and
  //                         read-before-write skips that member for ever after.
  //   guardians:            names a pubkey on both sides. This is the half a steward CANNOT repair by hand:
  //                         re-ticking "child" restores the marking and still leaves the parent unable to
  //                         message their own child.
  //   the clearance         is SEALED to a pubkey, so it has to be re-issued, not moved.
  //   the old key           keeps full access unless blocked — and the console filters it out of the roster
  //                         the moment the re-seat lands, so a steward cannot revoke a STOLEN phone
  //                         afterwards even if they realise. Hence `blockOld`, asked at the point of decision.
  //
  // The old key stays ON the safeguarding lists rather than being removed: that half fails closed, and a key
  // nobody holds costs nothing. AUDIT 2026-08-02.
  // EVERY WRITE HERE IS CHECKED, and the order is chosen so that a refusal leaves a state the steward can
  // still act on. HANDOFF-2026-08-05 \u00a74.2: this awaited seven church writes and inspected none of them.
  // publish() does not throw on refusal \u2014 it returns `false` \u2014 so a console that was offline, or a relay that
  // refused every doc, ran straight through to a report saying it had all happened.
  //
  // THE ORDER IS THE FIX, not just the checking. reseatOld filters the old key out of the roster the moment
  // the VOUCH lands, and the roster row is where the Block control lives. So anything that must remain
  // retryable has to happen while that row is still on screen:
  //   1. the stolen-phone block   \u2014 abort if refused; the old row is still there, so the steward can retry
  //   2. the safeguarding lists   \u2014 abort if refused; a key nobody has admitted yet costs nothing, and the
  //                                 alternative is a child admitted to the church whom no list calls a child
  //   3. the vouch, then admit    \u2014 the pre-existing rule, which only ever worked if the result was read
  //   4. the clearance re-seal    \u2014 reported, never fatal: the seat HAS moved by here, the relay enforces
  //                                 from the lists written in (2), and this re-runs safely by itself
  // Re-running the whole thing after an abort is idempotent (every setter de-dupes through a Set).
  // A replaceable write refused on a SAME-SECOND TIE is not something the steward did wrong — it is the clock.
  // event-store breaks a created_at tie by lowest event id ("rt === et && r.id < e.id → have-newer"), so of any
  // two writes to the same doc inside one second, roughly half lose. Every setter below stamps its own now(),
  // so waiting past the second boundary and writing again produces a strictly-later created_at that cannot
  // tie, and the retry is decisive. ONE retry: a second refusal is a real refusal (offline, or genuinely
  // rejected), and must still surface.
  //
  // This is HANDOFF-2026-08-05 §6's "same-second replaceable race", which is why reseat-safeguarding fails
  // ~2-in-5 on unmodified code. It silently lost writes before; checking the results here turned it into a
  // visible refusal, which is honest but still wrong — the write should simply succeed. Scoped to the re-seat
  // path deliberately: publish() has 77 call sites and this branch is not the place to change all of them.
  //
  // Kept as a LOCAL closure rather than a sibling method: two harnesses lift reseatMember out of the shipped
  // bundle on its own and run it, so a helper reached through window.Steward is a helper they do not have.
  async reseatMember(oldPub, newPub, o) {
    o = o || {};
    const w = async (fn) => {
      const first = await fn();
      if (first) return first;
      await new Promise(r => setTimeout(r, 1100));   // ≥1s guarantees now() advances, so the retry cannot tie
      return fn();
    };
    const oldH = (toPubHex(oldPub) || oldPub || '').toLowerCase();
    const newH = (toPubHex(newPub) || newPub || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(oldH) || !/^[0-9a-f]{64}$/.test(newH)) throw new Error('That doesn\u2019t look like a member code.');
    if (oldH === newH) throw new Error('That is the same key they already have.');
    const low = (a) => (a || []).map(x => String(x || '').toLowerCase()).filter(Boolean);

    // (1) THE STOLEN PHONE, FIRST AND FATAL. The tickbox promises "Blocks the old key so it can no longer read
    // this church. Do this now \u2014 once they are reconnected, the old entry leaves your Members list and you
    // cannot block it afterwards." That is true, which is why a refused block cannot be allowed to reach the
    // success screen: the thief would keep reading the church, posting to it and holding the group keys, and
    // the one control that could stop them would already have gone. Nothing has been written yet, so throwing
    // here leaves the church exactly as it was and the steward able to try again.
    if (o.blockOld) {
      const blocked = await w(() => window.Steward.setBlocked([...new Set([...low(o.blocked), oldH])]));
      if (!blocked) throw new Error('Couldn\u2019t block the old phone, so nothing was changed \u2014 they are still in your Members list. Check your connection and try again.');
    }

    const mins = low(o.minors), appr = low(o.approved);
    const wasMinor = mins.indexOf(oldH) !== -1, wasCleared = appr.indexOf(oldH) !== -1;
    let nextMins = mins, nextAppr = appr;
    // (2) SAFEGUARDING BEFORE ADMISSION. If the child marking will not save, the alternative to stopping is a
    // child in the church whom no list names as a child \u2014 and safeguardAllows() then lets any adult DM them.
    if (wasMinor && mins.indexOf(newH) === -1) {
      nextMins = [...mins, newH];
      if (!await w(() => window.Steward.setMinors(nextMins))) throw new Error('Couldn\u2019t save the child marking, so nothing was changed. Check your connection and try again \u2014 reconnecting them without it would leave them unprotected.');
    }
    if (wasCleared && appr.indexOf(newH) === -1) {
      nextAppr = [...appr, newH];
      if (!await w(() => window.Steward.setApproved(nextAppr))) throw new Error('Couldn\u2019t save their youth clearance, so nothing was changed. Check your connection and try again.');
    }

    // The seat may be the CHILD (an entry keyed by them) or a PARENT (named in some child's list). Both break.
    const g = o.guardians || {};
    let nextG = null;
    if ((g[oldH] || []).length) { nextG = { ...g }; nextG[newH] = [...new Set([...low(g[newH]), ...low(g[oldH])])]; }
    for (const childK of Object.keys(g)) {
      const parents = low(g[childK]);
      if (parents.indexOf(oldH) !== -1 && parents.indexOf(newH) === -1) {
        nextG = nextG || { ...g };
        nextG[childK] = [...new Set([...low(nextG[childK] || parents), newH])];
      }
    }
    // The half no steward can repair by hand: re-ticking "child" restores the marking and still leaves the
    // parent unable to message their own child. Reported as done, it would never be looked at again.
    if (nextG && !await w(() => window.Steward.setGuardians(nextG))) throw new Error('Couldn\u2019t save the parent link, so nothing was changed. Check your connection and try again \u2014 this is the part that cannot be put right by hand afterwards.');

    // (3) Record the vouch FIRST, then admit. If admitting failed on its own the member would be able to post
    // while the church still showed two of them; this order fails the safer way round. It only fails that way
    // round if the result is read, which is what the two checks below add.
    const pairs = [...(o.reseats || []).filter(p => p && p.new !== newH), { old: oldH, new: newH, name: o.name || '', at: now() }];
    if (!await w(() => window.Steward.setReseats(pairs))) throw new Error('Couldn\u2019t record the reconnection, so nothing was changed. Check your connection and try again.');
    if (!await w(() => window.Steward.setAdmitted([...new Set([...(o.admitted || []), newH])]))) throw new Error('Recorded the reconnection, but couldn\u2019t let the new phone in. Open Members and approve them, or run this again.');

    // Re-issue the record the member's OWN phone reads — always, not only for children. This member has been
    // assessed; the new key simply has not been told the answer yet. Sealing it here is what stops the
    // back-fill later inferring "no marking, therefore an adult" for someone who was never re-assessed.
    // Carry the guardian map. A re-seat MOVES the parent link to the new key, and the child's sealed clearance
    // is where their phone learns it.
    //
    // An earlier version of this commit left this argument out, believing it caused
    // scripts/reseat-safeguarding.test.mjs to fail. IT DID NOT. The adversarial review measured the test at
    // 2 failures in 8 runs on the UNMODIFIED code, and 2 in 10 with the argument — identical. The real cause
    // is a same-second race: reseatMember rewrites four replaceable church docs the test wrote moments before,
    // created_at is whole seconds, and event-store's NIP-01 tie-break gives the lowest event id, so roughly
    // half the time the second write is REFUSED and setGuardians' result is never inspected. My bisection
    // measured noise and I wrote the wrong explanation into the code. Recorded because a confident wrong
    // comment is what caused the bug this branch started with.
    //
    // (4) REPORTED, NEVER FATAL. By here the seat has moved and the relay is already enforcing from the lists
    // written above, so throwing would tell the steward nothing happened when nearly all of it did. What this
    // re-seal actually buys is the member's OWN phone knowing its answer without waiting for a back-fill — so
    // a failure is worth naming, not worth undoing. `failed` counts members whose write was not acknowledged;
    // `unverified` means we could not read back to find out, which is not the same as success.
    const failed = [];
    let clr = null;
    try { clr = await window.Steward.refreshClearances([newH], nextMins, nextAppr, nextG || g); }
    catch (e) { clr = null; }
    if (!clr || clr.failed > 0 || clr.unverified) failed.push('clearance');

    return {
      minorCarried: wasMinor, clearedCarried: wasCleared, guardiansCarried: !!nextG,
      blockedOld: !!o.blockOld,   // only reachable if the block LANDED — a refusal threw above
      failed,
    };
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
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { cur = []; _stewardCaps = {}; _stewardNames = {}; }
        else {
          try {
            const doc = JSON.parse(e.content) || {};
            cur = doc.pubkeys || [];
            // Remember what the church granted each steward. setStewards() carries this forward on every
            // edit — otherwise adding or removing ONE steward would republish a roster with no capabilities
            // at all and silently restore full authority to everyone the church had scoped.
            _stewardCaps = (doc.caps && typeof doc.caps === 'object') ? doc.caps : {};
            _stewardNames = (doc.names && typeof doc.names === 'object') ? doc.names : {};
          } catch { cur = []; _stewardCaps = {}; _stewardNames = {}; }
        }
        // Adopt it HERE, not only via the UI's setCareRoster round-trip. The safeguarding back-fill needs to
        // know who the member honours, and it does not wait for React: the roster hook starts at [] and only
        // fills on the first emit, so a console that reached Members first judged every steward-authored copy
        // as unauthored-by-anyone and skipped the member. The engine's own subscription is the earliest honest
        // moment this is knowable. AUDIT-8.
        _careRoster = new Set(cur.filter(Boolean));
        _careRosterKnown = true;
        onList(cur);
      },
      oneose() {
        // "WE ASKED AND THERE IS NO ROSTER" IS KNOWABLE, and it is the ordinary state of a single-owner pilot
        // church. Setting `_careRosterKnown` only from an event meant such a church NEVER learned it had no
        // stewards, so _memberHonours fell back to "any author might be honoured" for ever — which reinstates
        // the seized-relay amplification AUDIT-7 closed: one forged clearance per member from an unrostered
        // key is admitted to the top slot and the console republishes the whole roster on every visit. The
        // member's app ignores that author, so it is invisible write amplification. Gated on an authenticated
        // read, because an unauthenticated one is served an empty answer indistinguishable from "no roster".
        // AUDIT-9.
        try { if (_isRelayAuthed()) _careRosterKnown = true; } catch (e) {}
        onList(cur);
      },
    });
    return () => { try { sub.close(); } catch {} };
  },
  setStewards(pubkeys, caps, names) {   // OWNER-ONLY: replace the whole steward roster (pass hex pubkeys)
    _requireTrustedView('steward roster');
    if (!sk) return Promise.resolve(null);
    const list = [...new Set((pubkeys || []).filter(Boolean))];
    // CARRY THE CAPABILITIES FORWARD. Every existing caller passes pubkeys alone — "add this steward",
    // "remove that one" — and without this each of those would publish a roster with no `caps` key, which
    // the relay reads as "no church has scoped anyone" and hands every remaining steward full authority.
    // Silent re-escalation, from a button that says Remove.
    const next = {};
    const src = (caps && typeof caps === 'object') ? caps : _stewardCaps;
    for (const p of list) if (src[p] && Array.isArray(src[p])) next[p] = src[p].filter(c => typeof c === 'string');
    // The owner's labels ride along on the same terms: carried forward unless replaced, pruned with the
    // steward they belong to. Losing them on an unrelated edit would put the invented names back.
    const nextNames = {};
    const nsrc = (names && typeof names === 'object') ? names : _stewardNames;
    for (const p of list) { const v = nsrc[p]; if (typeof v === 'string' && v.trim()) nextNames[p] = v.trim().slice(0, 60); }
    const doc = { pubkeys: list };
    if (Object.keys(next).length) doc.caps = next;
    if (Object.keys(nextNames).length) doc.names = nextNames;
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', STEWARDS_D + pub], ['t', NET]], content: JSON.stringify(doc) }, sk));
  },
  // What this church has granted each steward. Empty array = nothing; ABSENT = everything (an unscoped
  // steward, which is every steward that existed before this feature).
  stewardCaps() { return { ..._stewardCaps }; },
  stewardLabels() { return { ..._stewardNames }; },
  stewardCapNames() { return STEWARD_CAPS.slice(); },
  // What THIS console may do when acting as a delegated steward. Owner consoles hold the church key and are
  // not on the roster, so they are unrestricted by construction.
  myStewardCaps() {
    if (!actingChurch) return null;                       // owner: no restriction
    // In delegated mode `pub` is the CHURCH's key and `churchPub` is this console's own — the naming is
    // historical (see setActiveIdentity). Our own key is what the roster grants capabilities to.
    const c = _stewardCaps[churchPub];
    return Array.isArray(c) ? c.slice() : null;           // null = unscoped = everything
  },

  // ---- encrypted church docs: NIP-44 self-encryption to the CHURCH key. Used by the optional Finance
  // module so sensitive donor PII + ledger never hit the relay in plaintext — only the church key (held
  // in Keykeeper on the steward's device) can read them. The finance module talks only to these
  // primitives, never to the raw key. ----
  // ── THE CHURCH BOOKS' KEY ────────────────────────────────────────────────────────────────────────────
  // The books were sealed with nip44(churchSk, churchPub) — the church key talking to itself — so only a
  // console holding the church key could read them. That is why Finance was hidden from delegated stewards
  // altogether: under a delegate's key the writes are refused and the reads return nothing, and the module
  // silently re-seeded an EMPTY book on reload. An owner could grant the finance capability and the treasurer
  // would still see no Finance tab, with nothing anywhere explaining why.
  //
  // So the books get a key of their own, wrapped to each person who may read them — the same envelope this
  // codebase already uses for care, names, media and groups. Owner-only to mint: a treasurer who could
  // re-key the books could lock the church out of its own ledger.
  //
  // THE RING IS WHAT MAKES THIS MIGRATE WITHOUT A MIGRATION. The envelope carries [newKey, legacySelfKey],
  // and the legacy key is exactly nip44(churchSk, churchPub) — which only the owner can derive, and which
  // every existing entry is already sealed with. So a delegate handed the ring can read the whole history
  // from before they existed, and nothing has to be re-encrypted or re-published. The journal is
  // append-only and relay-sequenced; rewriting it to migrate would be the worst possible answer.
  //
  // Sharing that derived key shares the books and nothing else: encSelf/decSelf are used by Finance (and the
  // pilot-locked Manna module) and by nothing else in the product.
  financeKeyRing() { return _finRing.slice(); },
  subscribeFinanceKey(cb) {
    const cp = actingChurch || pub;
    if (!cp) { cb && cb([]); return () => {}; }
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#d': [FINKEY_D + cp] }], {
      onevent(e) {
        if (e.pubkey !== cp) return;                       // owner-signed only; the relay enforces it too
        if (_authFuture(e)) return;
        if ((e.created_at || 0) < _finAt) return; _finAt = e.created_at || 0;
        try {
          const env = JSON.parse(e.content || '{}');
          _finDocKeys = env.keys || null;
          _finRev = env.rev || 1;
          const mine = env.keys && env.keys[churchPub];
          if (mine) {
            const plain = nip44d(mine, nip44ck(sk, e.pubkey));
            let ring = null; try { const pj = JSON.parse(plain); if (Array.isArray(pj)) ring = pj.filter(x => typeof x === 'string' && x); } catch (x) {}
            _finRing = ring && ring.length ? ring : [plain];
          } else if (!churchSkHeld()) {
            _finRing = [];                                 // we are not (or no longer) keyed for the books
          }
        } catch (x) {}
        cb && cb(_finRing.slice());
      },
      oneose() { cb && cb(_finRing.slice()); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // OWNER-ONLY. Wrap the books' key to the church and to every steward the roster gives `finance` to —
  // which, for an unscoped steward, is all of them, exactly as it is everywhere else.
  async ensureFinanceKeyFor(stewardPubs, caps) {
    if (!churchSkHeld() || actingChurch) return false;      // only the owner mints
    if (!_isRelayAuthed()) return false;                    // never conclude "no envelope" from an unauthed read
    const cp = pub;
    const legacy = _legacyBookKeyHex();
    if (!legacy) return false;
    if (!_finRing.length) _finRing = [_hex(crypto.getRandomValues(new Uint8Array(32))), legacy];
    else if (_finRing.indexOf(legacy) < 0) _finRing = [..._finRing, legacy];
    const allowed = (p) => {
      const c = caps && caps[p];
      return !Array.isArray(c) || c.indexOf('finance') >= 0;   // absent = unscoped = every capability
    };
    const want = [...new Set([cp, ...(stewardPubs || []).filter(allowed)].filter(Boolean))];
    const have = _finDocKeys || {};
    if (want.every(p2 => have[p2]) && Object.keys(have).length === want.length) return false;   // nothing changed
    const ring = JSON.stringify(_finRing);
    // Through _sealEach, like every other per-recipient seal here. This envelope is small today — the church
    // and its finance-capable stewards — but a synchronous loop is the shape that froze the console on a
    // church-wide rotation, and a guard that only holds while the list stays short is not a guard.
    const keys = await _sealEach(ring, want, (pl, mp) => nip44e(pl, nip44ck(sk, mp)));
    const ok = await publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', FINKEY_D + cp], ['t', NET]], content: JSON.stringify({ keys, rev: _finRev }) }));
    if (ok !== false) _finDocKeys = keys;
    return ok;
  },
  encSelf(obj) {                       // → ciphertext string, or null if we hold no key for the books
    // Seal with the CURRENT books key when there is one; fall back to the owner's legacy self-key so a
    // church that has never minted an envelope keeps working exactly as before.
    try {
      if (_finRing.length) return nip44e(JSON.stringify(obj), _unhex(_finRing[0]));
      if (churchSkHeld()) return nip44e(JSON.stringify(obj), nip44ck(churchSk, churchPub));
    } catch (e) {}
    return null;
  },
  decSelf(str) {                       // ciphertext → object, or null
    if (!str) return null;
    // Newest key first, then every superseded one — the last of which is the legacy self-key, so entries
    // written before the envelope existed still open. A delegate holds the same ring and reads the same past.
    for (const k of _finRing) { try { return JSON.parse(nip44d(str, _unhex(k))); } catch (e) {} }
    if (churchSkHeld()) { try { return JSON.parse(nip44d(str, nip44ck(churchSk, churchPub))); } catch (e) {} }
    return null;
  },
  // Publish an encrypted addressable church doc (kind-30078). Signed by WHOEVER IS ACTING — the church key
  // for an owner, the steward's own key for a delegate — and feChurch() stamps the ['church',<cp>] tag that
  // lets the relay resolve which church a steward is writing for. It used to sign with churchSk
  // unconditionally, which in delegated mode is the steward's own key with no church tag: every write
  // refused, and the module then re-seeded an empty book from the empty read. (audit 2026-07-06 #3)
  encPublish(dtag, obj) {
    if (!sk) return Promise.resolve(null);
    const content = window.Steward.encSelf(obj); if (content == null) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', dtag], ['t', NET], ['enc', '1']], content }));
  },
  encRemove(dtag) {                    // tombstone an encrypted doc
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', dtag], ['t', NET], ['deleted', '1']], content: '' }));
  },
  // subscribe to all encrypted church docs whose d-tag starts with `prefix`; decrypts each and emits a
  // live array of { id (the d-tag suffix after prefix), ...decrypted, ts }. Returns an unsubscribe fn.
  encSubscribe(prefix, cb) {
    const cp = actingChurch || pub;
    if (!cp) { cb([]); return () => {}; }
    const byId = new Map();
    const emit = () => cb([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    // TWO FILTERS, because the books now have two kinds of author. The church key writes them, and so does a
    // steward the church gave `finance` to — whose events are signed with their own key and carry
    // ['church',<cp>]. Subscribing to `authors:[churchPub]` alone was also wrong in delegated mode, where
    // churchPub is the STEWARD'S key: it watched their own documents and found the church's nowhere.
    const sub = pool.subscribeMany(relays(), [
      { kinds: [30078], authors: [cp], '#t': [NET] },
      { kinds: [30078], '#church': [cp], '#t': [NET] },
    ], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(prefix)) return;
        // The relay gates these writes, and this is the client saying the same thing: the church, or a
        // steward currently on its roster. A revoked steward's entries stop being trusted here the moment
        // the roster changes, without waiting for a relay round-trip.
        if (e.pubkey !== cp && !_careRoster.has(e.pubkey)) return;
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
        // _openChurchDoc, not JSON.parse: the calendar documents are sealed under the church name key now
        // (cleartext ones written before that still open — it tries plain JSON first). A null means sealed
        // with a key this console does not hold, which must not silently become an empty calendar.
        try { const c = _openChurchDoc(e.content); if (c === null) { byId.set(id, { id, _locked: true, ts: e.created_at }); emit(); return; }
              byId.set(id, { id, ...map(c, id), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- team rosters: the roles a team needs + the people who can serve ----
  // roster = { roles:[{id,name}], people:[{id,name,pub?}] }, keyed by team(group) id.
  //
  // ⚠ WRITTEN IN CLEARTEXT ON PURPOSE, AND TWO RELAY GRANTS DEPEND ON IT. The relay parses `people[].pub`
  // into ROSTER_PEOPLE and uses it for careAdmin() (who may open care needs) and onAnyRoster() (who may fetch
  // the rota when a church narrows it to its serving teams). This document does hold real names bound to
  // pubkeys, which is exactly the at-rest exposure the 2026-08-18 round sealed runsheet: and careavail: for —
  // so it SHOULD be sealed, and church-docs-are-sealed.test.mjs tracks that as a deferred todo. Sealing it
  // alone silently revokes both grants: care goes unmanageable and 'serving teams' becomes 'nobody'. The
  // pubkeys must move to a pubkey-only document (the `careteam:` shape) in the SAME change.
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
    const doc = { date: svc.date || '', time: svc.time || '10:30', name: svc.name || 'Sunday Gathering' };
    const content = _sealChurchDoc(doc);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', SERVICE_D + id], ['t', NET]], content }))
      .then(() => ({ id, ...doc }));
  },
  removeService(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', SERVICE_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeServices(onServices) { return this._subAddr(SERVICE_D, (c) => ({ date: c.date, time: c.time, name: c.name }), onServices); },
  // ---- run sheets: a service's order-of-service + song setlist (d=runsheet:<serviceId>) ----
  publishRunsheet(serviceId, items) {
    if (!sk || !serviceId) return Promise.resolve(null);
    // SEALED, like every other calendar document. This wrote cleartext until 2026-08-18, so the relay held
    // the order of service — including the minister named against each item — readable by anyone with the
    // disk. Reads were already default-deny over the wire (a stranger gets zero events, measured), so the
    // exposure was at rest, which is the half that matters under seizure. Both readers try plaintext first
    // (_openChurchDoc here, CHURCH_SEALED_PFXS in the member app), so sheets written before this still open.
    const content = _sealChurchDoc({ items: Array.isArray(items) ? items : [] });
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
    const doc = { name: (room.name || 'Room').trim(), capacity: room.capacity || '', note: (room.note || '').trim() };
    const content = _sealChurchDoc(doc);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', ROOM_D + id], ['t', NET]], content })).then(() => ({ id, ...doc }));
  },
  removeRoom(id) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', ROOM_D + id], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeRooms(cb) { return this._subAddr(ROOM_D, (c) => ({ name: c.name, capacity: c.capacity, note: c.note }), cb); },
  publishBooking(b) {
    if (!sk || !b || !b.roomId) return Promise.resolve(null);
    const id = b.id || ('bk' + Date.now());
    const doc = { roomId: b.roomId, date: b.date || '', start: b.start || '', end: b.end || '', title: (b.title || '').trim(), note: (b.note || '').trim() };
    const content = _sealChurchDoc(doc);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', BOOKING_D + id], ['t', NET]], content })).then(() => ({ id, ...doc }));
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
    const doc = { service: rota.service, published: !!rota.published, assign: rota.assign || {} };
    const content = _sealChurchDoc(doc);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', ROTA_D + rota.service], ['t', NET]], content }))
      .then(() => ({ id: rota.service, service: rota.service, published: !!rota.published, assign: rota.assign || {} }));
  },
  removeRota(serviceId) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', ROTA_D + serviceId], ['t', NET], ['deleted', '1']], content: '' }));
  },
  subscribeRotas(onRotas) { return this._subAddr(ROTA_D, (c, id) => ({ service: id, published: !!c.published, assign: c.assign || {} }), onRotas); },

  // ---- who may SEE the rota: 'church' (default) | 'team' (people on the serving rosters) | 'stewards' ----
  // NOT sealed, unlike the rota itself: the relay has to read this one to enforce it, and it says nothing
  // about any person — only which of three settings the church chose.
  //
  // What this buys and what it does not: rota:/runsheet: are sealed under the church name key that every
  // member already holds, so the relay can refuse to SERVE the document but cannot stop a member decrypting
  // a copy they already fetched — and the member app caches them. Narrowing the setting therefore protects
  // the rota from here on; it does not reach back onto phones. Anything the console says about this must be
  // written to that standard.
  publishRotaSettings(visibility) {
    if (!sk) return Promise.resolve(null);
    const v = (visibility === 'team' || visibility === 'stewards') ? visibility : 'church';
    const content = JSON.stringify({ visibility: v, updated: now() });
    return publish(feChurch({ kind: 30078, created_at: now(), tags: [['d', ROTA_SETTINGS_D], ['t', NET]], content })).then(() => ({ visibility: v }));
  },
  // _subAddr hands back every doc under the prefix, newest first. This one has no suffix, so there is exactly
  // one — and an EMPTY array is the answer for every church that has never touched the setting, which must
  // read as 'church' (the open default) and not as "no answer".
  subscribeRotaSettings(cb) {
    return this._subAddr(ROTA_SETTINGS_D, (c) => ({ visibility: String((c && c.visibility) || '') }), (docs) => {
      const v = (Array.isArray(docs) && docs.length) ? docs[0].visibility : '';
      cb({ visibility: (v === 'team' || v === 'stewards') ? v : 'church' });
    });
  },

  // ---- calendar events (non-serving: workdays, lunches, prayer evenings…) ----
  // event = { id?, date, time, title, where, blurb, accent }
  // asPub (optional) publishes the event AS an owned network instead of the church — network-wide event.
  publishEvent(ev, asPub) {
    const signer = skFor(asPub); if (!signer) return Promise.resolve(null);
    const id = ev.id || ('evt' + Date.now().toString(36) + (++_evtSeq).toString(36) + Math.random().toString(36).slice(2, 7));   // Date.now() alone collides for rows published in one loop — replaceable docs, so a collision DELETES the first
    const groupId = ev.groupId || '';
    const doc = { date: ev.date || '', time: ev.time || '', title: ev.title || 'Event', where: ev.where || '', blurb: ev.blurb || '', accent: ev.accent || 'var(--clay)', image: ev.image || '', groupId, recur: ev.recur || '', day: (typeof ev.day === 'number' ? ev.day : null) };
    const content = _sealChurchDoc(doc);
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
    // The SEALED name each member published for this church. Stored as ciphertext and opened at emit time on
    // purpose: the name key routinely arrives after the name documents do, and re-deriving on each emit means a
    // late key simply starts working instead of needing its own retry path. Until this, openMemberName had no
    // callers at all — the console resolved every name from the cleartext kind-0 beside it, so the sealed copy
    // was written by every member, stored by the relay, and read by nobody. AUDIT-2026-07-27.
    const sealedRaw = new Map();
    const emitNow = () => {
      const sealedName = (pk) => { const c = sealedRaw.get(pk); if (!c) return ''; try { return window.Steward.openMemberName(c, pk) || ''; } catch (x) { return ''; } };
      const arr = [...byPub.values()].filter(m => !reseatOld.has(m.pubkey))
        .map(m => { if (m.name) return m; const sn = sealedName(m.pubkey); return sn ? { ...m, name: sn, viaSealed: true } : m; })
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
        // a member's own sealed name for this church — authorised by AUTHORSHIP (it is their own name), so the
        // church/steward check below must not apply to it.
        if (d === NAME_D + pub) { if (e.content) { sealedRaw.set(e.pubkey, e.content); emit(); } return; }
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
      onevent(e) { if (e.created_at < latest) return; latest = e.created_at; try { const p = JSON.parse(e.content); lastProfile = { ...lastProfile, ...p }; _profileLoaded = true; onProfile(p); try { window.dispatchEvent(new CustomEvent('steward-profile', { detail: lastProfile })); } catch (x) {} } catch {} },
      oneose() { _profileLoaded = true; },   // the relay answered; a church with no profile yet can still publish its first
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
    lastProfile = {}; _profileLoaded = false;   // don't carry one identity's profile fields — or its loaded-ness — into the other's edits
    // The just-published clearance cache is per-CHURCH and must not survive the switch either: it is keyed by
    // member pubkey alone, so a member who belongs to both churches could be skipped for the wrong one within
    // its 15s window — and church B would never receive their clearance. Same family as the name-key note
    // below; that one cost church B's members the key to every sealed name. AUDIT-4.
    _clearanceSent.clear();
    // The steward roster is per-CHURCH and decides which authors a member honours. Carried across a switch, it
    // judged church B's clearances against church A's stewards — admitting writers B never appointed and
    // dismissing the ones it did. Cleared to UNKNOWN rather than empty, so the back-fill defaults to answering
    // a competing copy instead of silently skipping it until B's own roster arrives. AUDIT-8, same family as
    // the name-key note below.
    _careRoster = new Set(); _careRosterKnown = false;
    // The name key is per-church and MUST NOT survive an identity switch. It was a bare module global, and
    // subscribeNameKey is mounted once with an empty dependency list, so switching from your own church to one
    // you steward carried church A's ring across — and the roster effect then published it as church B's name
    // key, wrapped to church B's members. That hands every member of B the key that opens A's sealed names.
    // AUDIT-2026-07-27.
    _nameKeyRing = []; _nameKeyDocKeys = null; _nameKeyChecked = false;
    // The locally-known blocklist is per-CHURCH too (item B): carried across, church A's blocks would
    // silently drop church B's members from every envelope this console publishes for B.
    _localBlocked = new Set();
    // F6: photo suppression is PER CHURCH. Carrying it across an identity switch would suppress whichever
    // members of the new church happened to share a pubkey position with the old list — and, worse, leak one
    // church's moderation decisions into another's screen. Cleared here beside the other per-identity state;
    // subscribeSafeguard refills it within a beat. (Same shape as the member app, which resets on church change.)
    _applyNoPhotoList([]);
    // NOTE: the block above is the same list as _resetChurchScopedState(), minus the care-key, media-key and
    // NIP-42 state. Deliberately NOT converged in this commit — a SWITCH keeps this device's key while a
    // RESTORE replaces it, so the wider reset is not obviously correct here and changing it is not what this
    // fix is for. But the duplication IS the bug class that produced AUDIT-2026-07-27 and the 2026-08-04 key
    // loss. If you are adding per-church state, add it to _resetChurchScopedState() and settle this properly.
    window.Steward.pubkey = pub; window.Steward.npub = npubEncode(pub); window.Steward.activePub = pub;
    window.Steward.actingChurch = actingChurch;   // UI reads this to show "acting as steward" + hide owner-only controls
    window.dispatchEvent(new CustomEvent('steward-identity', { detail: { pub, actingChurch } }));
    return true;
  },
  isViewingNetwork() { return _viewingNetwork(); },
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
  // Resolves TRUE when this church has been accepted by a relay, FALSE if that has not happened within `ms`.
  // For setup work that is meaningless until the church exists — seeding its starter groups, for one.
  whenRegistered(ms) {
    if (_regOk) return Promise.resolve(true);
    return new Promise((res) => {
      const t = setTimeout(() => res(false), Math.max(0, ms || 120000));
      _regOkWaiters.push((v) => { clearTimeout(t); res(v); });
    });
  },
  async selfRegister(name, opts) {
    // Hold the publish gate for as long as this takes, so the founding documents queue behind it rather than
    // racing it (see _publishSigned). Resolved in the finally below, on every exit path.
    _regNeedsName = false;
    _armRegGate();
    try {
    if (!churchSk || !churchPub) return;
    const np = npubEncode(churchPub);
    const force = !!(opts && opts.force);
    const bases = new Set([window.Steward.configBase()]);
    for (const r of CANONICAL_RELAYS) bases.add(r.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/relay\/?$/i, ''));
    let done = {};
    try { done = JSON.parse(localStorage.getItem(SELFREG_KEY) || '{}') || {}; } catch (e) {}
    let accepted = false; const refused = [], unreachable = [];
    for (const base of bases) {
      const mark = churchPub + '@' + base;
      if (!force && done[mark]) continue;                     // already registered this key with this relay
      const url = base + '/config';
      try {
        const auth = finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', url], ['method', 'POST']], content: '' }, churchSk);
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addChurch: { npub: np, name: name || '' }, auth }) });
        // Only remember a real acceptance. A 400 ("name your church first") or 403 (invite-only / already set
        // up) must stay un-marked so a later, correct attempt is still made.
        if (r && r.ok) { done[mark] = 1; try { localStorage.setItem(SELFREG_KEY, JSON.stringify(done)); } catch (e) {} accepted = true; _markRegOk(); }
        else if (r) { let why = ''; try { why = ((await r.json()) || {}).error || ''; } catch (e) {} refused.push({ base, status: r.status, why });
          // "set your church's name … before connecting it to a relay" is not a verdict, it is a not-yet: the
          // wizard's first field is the name, and naming it re-registers. Keep the publish gate SHUT for that
          // one reason so the founding documents wait for a church the relay will actually accept.
          if (/name/i.test(why)) _regNeedsName = true; }
      } catch (e) { unreachable.push(base); }
    }
    // SAY IT WHEN NOBODY ACCEPTED. This used to return nothing at all, so a church whose registration was
    // REFUSED completed its whole setup — name, recovery phrase, groups, meetings — with every write silently
    // rejected, and the steward ended holding a church that looks set up and does not exist on the relay.
    // Measured 2026-08-17: 17 refusals in a row for the second church on a relay, and the only thing the
    // console said was that the meetings had not saved, advising a retry that could never work.
    //
    // The relay's own refusal is well written ("this relay is already set up for its church — ask the operator
    // to add yours, or turn on Offer to host other churches"), so pass it through rather than inventing one.
    // JUDGE IT ON THE RELAY THIS CHURCH ACTUALLY USES, not on whether anybody anywhere said yes.
    //
    // `bases` includes the CANONICAL_RELAYS as well as this console's own, so a church set up against a
    // self-hosted or local relay can be REFUSED there and still get an acceptance from a canonical one — and
    // `accepted` was then true, and the steward was told nothing, while every subsequent write to their own
    // relay was rejected. Measured 2026-08-17: ok:true alongside a 403 from the relay the church was actually
    // pointed at, and 17 lost setup writes.
    const ownBase = window.Steward.configBase();
    const ownRefused = refused.find(x => x.base === ownBase) || unreachable.includes(ownBase);
    if (ownRefused) {
      const why = (refused.find(x => x.base === ownBase) || {}).why;
      try {
        window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'church registration',
          message: why
            ? ('This relay has not accepted your church, so nothing you set up will save: “' + why + '”')
            : 'This relay did not answer, so nothing you set up will save yet. Check the relay address in Settings — your church key is safe on this device.' } }));
      } catch (e) {}
    }
    return { ok: accepted, refused, unreachable };
    } finally {
      // Open it as soon as we know where we stand — accepted, or refused for a reason naming the church will
      // not cure. Only the missing-name refusal leaves it shut, and publish() bounds that wait anyway.
      try { if (!_regNeedsName) _openRegGate(); } catch (e) {}
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
