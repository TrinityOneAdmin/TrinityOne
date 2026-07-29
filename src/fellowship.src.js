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
// A member's own "I belong to this church" doc — d=member:<churchpub>. MODULE scope on purpose: it was
// declared only as a local inside _memHubOpen, while recoverIdentity() (the 12-word restore) also referenced
// it — so restore threw `ReferenceError: MEMBER_D is not defined` inside the relay's event handler, which
// nostr-tools logs and swallows. The restore returned the member's NAME (the kind-0 branch returns before
// this line) and ZERO churches, every time, on a device that had the doc in hand. Confirmed on the OPPO
// against the live relay, 2026-07-26.
const MEMBER_D = 'trinityone/member:';
const GROUP_D = 'trinityone/group:';
const CATEGORY_D = 'trinityone/category:';   // church-signed named container that groups belong to (e.g. "Lifegroups")
const GROUPKEY_D = 'trinityone/groupkey:';   // church-signed envelope: the group key wrapped to each member
const GUARDNOTICE_D = 'trinityone/guardnotice:';   // church->parent notice of a steward-made guardian link, p-tagged + NIP-44-encrypted to the parent
const SERMON_D = 'trinityone/sermon:';   // Phase 5 Tier 2: a church-signed self-hosted media item — references a content-addressed blob by sha256 + host(s)
const MEDIAKEY_D = 'trinityone/mediakey:';   // Tier 2 encryption: per-church AES-GCM media key, wrapped (NIP-44) to each member
const NAMEKEY_D = 'trinityone/namekey:';     // per-church NAME key, wrapped per member — opens sealed member names
const NAME_D = 'trinityone/name:';           // a member's own name, sealed to their congregation's name key
const CAREKEY_D = 'trinityone/carekey:';     // per-church CARE key, wrapped (NIP-44) to each member — seals the identifying half of a care need
const PINSERMON_D = 'trinityone/pinsermon:';   // the church's currently-featured sermon → Today card + notification
async function _sha256hex(u8) { const d = await crypto.subtle.digest('SHA-256', u8); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); }
// Meal trains / Care module (optional, per church). meals-settings is church-signed; care: needs come from
// church/steward/care-team admins; careslot: are member offers to help; careskip: is RECIPIENT-only.
const MEALS_SETTINGS_D = 'trinityone/meals-settings';
// steward-defined chat message tags (Testimony, Praise, …) — one church-signed doc alongside the built-in
// "Prayer request". Validated against fixed allowlists on read so a forged doc can't inject CSS/icons.
const MSGTAGS_D = 'trinityone/msgtags';
const MSGTAG_ICONS = ['pray', 'sparkle', 'heart', 'flame', 'hand', 'gift', 'music'];
const MSGTAG_ACCENTS = ['gold', 'sage', 'clay', 'sky', 'plum', 'teal'];
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
    if (out.length >= 6) break;
  }
  return out;
}
const CARE_D = 'trinityone/care:';        // a care need — d=care:<id>
const ROSTER_PFX = 'trinityone/roster:';  // a team roster (people); the meals-admin one names the care-team admins (M2)
const CARESLOT_D = 'trinityone/careslot:';// a member's offer for one (need,date) — d=careslot:<careId>:<iso>
const CAREREQ_D = 'trinityone/carereq:';  // a member's private "ask for help" request, sealed to the care team — d=carereq:<id>
const CARETEAM_D = 'trinityone/careteam:';// church-published roster of care-team recipient pubkeys — d=careteam:<churchpub>
const CAREREQSTATUS_D = 'trinityone/carereqstatus:';// the care team's resolution of a request (approved/declined/handled) — d=carereqstatus:<id>
const CARECHAT_D = 'trinityone/carechat:'; // a message in a request's shared care-team↔asker thread — d=carechat:<reqId>:<msgId>
const CARESKIP_D = 'trinityone/careskip:';// recipient marks a day they don't need help — d=careskip:<careId>:<iso>
const CAREAVAIL_D = 'trinityone/careavail:';// a member's "I'm here to help" availability — d=careavail:<churchpub> (one per member per church)
const SAFETY_D = 'trinityone/safetycheck:';// the church's active safety check ("are you safe?") — d=safetycheck:<churchpub>
const SAFE_D = 'trinityone/safe:';         // a member's response — d=safe:<churchpub>, content NIP-44-encrypted to the check's creator
// safeguarding v2: a parent's local record of the child accounts they set up (no secrets — just the link)
const FAMILY_KEY = 'trinityone.family';
function _loadChildren() { try { return JSON.parse(localStorage.getItem(FAMILY_KEY) || '[]') || []; } catch { return []; } }
function _saveChildLink(link) { const list = _loadChildren().filter(c => c && c.child !== link.child); list.push(link); try { localStorage.setItem(FAMILY_KEY, JSON.stringify(list)); } catch {} }
// REBUILD THE FAMILY LIST FROM THE RELAY. trinityone.family is written when a child account is created and
// read straight back — nothing ever rebuilt it. It is also in the locked-boot wipe list, so restoring an
// identity cleared it and a parent's children simply vanished from their phone. The accounts were never
// lost: the church's guardian map still showed the link, which is exactly how this was reported —
// "in the console the child is still linked, I just can't see it in my app". AUDIT-2026-07-28.
//
// Rebuilt from the parent's OWN guardreq documents, not the church's guardians map: that map is deliberately
// served only to stewards now (it maps every child in the congregation to their parents), while a member may
// always read back what they themselves signed.
//
// Merge only, never remove — a link the relay has not served yet must not delete one we already hold, and a
// parent who has genuinely unlinked a child is handled by the church's map rather than here.
function _rebuildFamily(churchNpub) {
  const cp = toPub(churchNpub) || churchNpub;
  if (!pub || !cp) return Promise.resolve(0);
  return new Promise((resolve) => {
    let added = 0, done = false;
    const finish = () => { if (done) return; done = true; try { sub.close(); } catch (e) {} resolve(added); };
    const sub = pool.subscribeMany(relaysForChurch(cp), [{ kinds: [30078], authors: [pub] }], {
      onevent(e) {
        const d = _dtag(e);
        if (!d.startsWith('trinityone/guardreq:')) return;
        if ((e.tags || []).some(t => t[0] === 'deleted')) return;
        const child = d.slice('trinityone/guardreq:'.length);
        if (!/^[0-9a-f]{64}$/i.test(child)) return;
        if (_loadChildren().some(c => c && c.child === child)) return;
        _saveChildLink({ child, name: '', churchPub: cp, ts: e.created_at || 0 });
        added++;
      },
      oneose: finish,
    });
    setTimeout(finish, 9000);
  });
}
// SECURITY-AUDIT-2026-07-06 H5: cache group keys per CHURCH, not by bare group-id. Group ids are the
// low-entropy, attacker-guessable `grp<Date.now()>`; a member also joined to an attacker-run church could
// otherwise publish a church-signed `groupkey:<victimGroupId>` that clobbers the real church's cached key
// for the same id (→ DoS the encrypted group, or seal the victim's next post under the attacker's key and
// read the plaintext). Keying by `<churchPub>|<gid>` isolates each church's key space so ids can't collide.
// "<cp>|<groupId>" -> KEY RING [current, ...superseded], each Uint8Array(32), unwrapped from that church's
// envelope for me. A ring, not one key — rotation must never orphan history (see _ingestGroupKey).
const _gkeys = {};
const _gkeyTs = {};  // "<cp>|<groupId>" -> newest envelope created_at accepted (stale-drop for replayed rotations)
const _gkKey = (cp, gid) => (cp || '') + '|' + gid;
// Coalesce a subscription's emit. The universal pattern here is `onevent → byId.set(...) → emit()`, where
// emit rebuilds and re-sorts the WHOLE collection and fires a React setState — so replaying a backfill of n
// events costs O(n² log n) and n renders. Deferring to the end of the tick makes it one rebuild per batch,
// which is what the UI actually needs. (audit 2026-07-24)
// Coalesce repeated emits into one per tick. AUDIT 2026-07-25 (HIGH): this had NO cancel, so an emit queued by
// an arriving event still fired a macrotask AFTER its subscription was torn down. In the chat-unread effect that
// late emit opened a fresh `subscribeGroups` REQ that nothing would ever close — one leaked subscription per
// church switch, marching straight at the relay's 64-per-connection cap, which is the known cause of member
// names going blank. Elsewhere it painted the OLD church's groups/needs under the NEW church's header.
// The returned function carries .cancel(); every caller must call it from its unsubscribe path.
function _coalesce(fn) {
  let t = null;
  const run = function () { if (t) return; t = setTimeout(() => { t = null; try { fn(); } catch (e) { console.error('[fellowship] emit failed', e); } }, 0); };
  run.cancel = () => { if (t) { clearTimeout(t); t = null; } };
  return run;
}
// PERF (AUDIT-2026-07-24): share ONE relay subscription between callers that want the same stream. Several
// streams were opened twice because two screens each wanted them — sermons (Watch + Extras), the safety check
// and care requests (two panels each on Today). Each duplicate is a second REQ on the socket and a second full
// download of the same events, which costs a member on a metered/thin connection real money and counts against
// the relay's 64-subscriptions-per-connection cap (the cap that blanked member names once before).
//
// Late joiners get the last value immediately, so a second screen paints from memory instead of re-fetching.
// The underlying subscription closes only when the LAST caller unsubscribes, so nothing leaks.
const _sharedSubs = new Map();   // key -> { cbs:Map(token->cb), last, closer }
function _shared(key, open) {
  let e = _sharedSubs.get(key);
  if (!e) {
    // cbs is a Map keyed by a unique token, NOT a Set of functions: two screens can legitimately pass the SAME
    // callback reference (a stable setState identity), and a Set would silently collapse them — the first
    // unsubscribe would then drop cbs to 0 and close the stream under a screen still mounted. AUDIT 2026-07-25.
    e = { cbs: new Map(), last: undefined, closer: null, seq: 0 };
    _sharedSubs.set(key, e);
    // If open() throws, drop the key instead of leaving a poisoned entry (closer null, cbs empty) that every
    // later caller would join — a permanent silent-empty for the rest of the session.
    try {
      e.closer = open((v) => { e.last = v; for (const cb of [...e.cbs.values()]) { try { cb(v); } catch (err) { console.error(err); } } });
    } catch (err) { _sharedSubs.delete(key); throw err; }
  }
  return (cb) => {
    const token = ++e.seq;
    e.cbs.set(token, cb);
    if (e.last !== undefined) { try { cb(e.last); } catch (err) {} }   // paint immediately from the shared buffer
    let off = false;
    return () => {
      if (off) return; off = true;
      e.cbs.delete(token);
      // delete only if this key still maps to OUR entry: reconnectAll() clears the registry, so a stale
      // handle running its cleanup afterwards would otherwise evict a NEW, live stream belonging to someone else.
      if (!e.cbs.size) { if (_sharedSubs.get(key) === e) _sharedSubs.delete(key); const c = e.closer; e.closer = null; if (c) { try { c(); } catch (err) {} } }
    };
  };
}
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
    // KEY RING. Rotation used to REPLACE the single key, and _decEvt drops any message it cannot open — so the
    // moment a steward blocked someone, every earlier message in that group became unreadable on every phone,
    // permanently and silently. The care key already carried a ring for exactly this reason; the group key did
    // not, and I shipped a block()-rotates-every-group change on top of that gap. AUDIT-2026-07-27.
    // The envelope now wraps a JSON array, current key first. An older console wraps a bare hex string — accept
    // both, or updating the member app before the console would blank every encrypted group in the church.
    // The console seals the ring under `rings` and the CURRENT key alone under `keys`, so an app that predates
    // the ring still finds the bare hex it expects. Prefer the ring; fall back to whatever `keys` holds.
    const mineRing = env.rings && pub && env.rings[pub];
    if ((mineRing || mine) && sk) {
      const open = (ct) => nip44d(ct, nip44ck(sk, e.pubkey));
      const asRing = (plain) => {
        try { const p = JSON.parse(plain); if (Array.isArray(p)) { const r = p.filter(x => typeof x === 'string' && /^[0-9a-f]+$/i.test(x)); if (r.length) return r; } } catch (x) {}
        return /^[0-9a-f]+$/i.test(plain || '') ? [plain] : null;
      };
      let ring = null;
      if (mineRing) { try { ring = asRing(open(mineRing)); } catch (x) {} }
      if (!ring && mine) { try { ring = asRing(open(mine)); } catch (x) {} }
      if (ring && ring.length) _gkeys[k] = ring.map(_unhex);
    } else if (!mine && !mineRing) delete _gkeys[k];   // dropped from the group entirely → lose every key, current and old
  } catch {}
}
// ── care key (SECURITY-AUDIT-2026-07-20 H3) ───────────────────────────────────────────────────────
// One symmetric key per church, wrapped to each member with NIP-44, church-signed. It seals the identifying
// half of a care need (who it's for, the free-text notes, the recipient, dietary needs) so the relay
// operator, a seized archive and anyone who leaves can't read it — while the clear half (type, dates) still
// renders for everyone, so members can see help is needed and volunteer.
// Author discipline mirrors _ingestGroupKey exactly: the church key or one of its CURRENT rostered stewards
// only, a future-skew clamp, and a monotonic stale-drop so a lagging relay can't replay an older envelope
// over a newer one. `rev` is carried and respected now so rotation can be switched on later without a
// wire-format change; nothing rotates yet.
const _carekeys = {};    // churchPub -> Uint8Array(32)
const _carekeyRev = {};  // churchPub -> envelope revision seen
const _carekeyTs = {};   // churchPub -> newest envelope created_at accepted
function _ingestCareKey(cp, e) {
  if (e.pubkey !== cp && !(_churchRoster.get(cp) && _churchRoster.get(cp).has(e.pubkey))) return;   // untrusted author
  const ts = e.created_at || 0;
  if (ts > Math.floor(Date.now() / 1000) + FUTURE_SKEW) return;
  if (ts < (_carekeyTs[cp] || 0)) return;
  _carekeyTs[cp] = ts;
  try {
    const env = JSON.parse(e.content || '{}');
    if ((env.rev || 1) < (_carekeyRev[cp] || 0)) return;   // never step backwards to an older key generation
    _carekeyRev[cp] = env.rev || 1;
    const mine = env.keys && pub && env.keys[pub];
    // KEY RING (audit 2026-07-24): the church rotates its care key when someone is removed, and the envelope
    // carries the current key followed by the superseded ones so a need sealed before the rotation still
    // opens. A wrapped value is a JSON array now; older envelopes hold a bare hex string — accept both.
    if (mine && sk) {
      const plain = nip44d(mine, nip44ck(sk, e.pubkey));
      let ring = null; try { const p = JSON.parse(plain); if (Array.isArray(p)) ring = p.filter(k => typeof k === 'string' && k); } catch (x) {}
      _carekeys[cp] = (ring && ring.length ? ring : [plain]).map(_unhex);
    }
    else if (!mine) delete _carekeys[cp];   // no longer keyed (removed from the church) → lose the key
  } catch {}
}
// open the sealed half of a care need; null when we hold no key (the UI shows "details hidden")
function _careOpen(cp, ct) {
  const ring = _carekeys[cp];
  if (!ring || !ring.length) return null;
  for (const key of ring) { try { return JSON.parse(nip44d(ct, key)); } catch (e) {} }   // newest first; older keys open pre-rotation needs
  return null;
}
// seal a care need's identifying half with the church care key (care-admins approving a request into a need);
// null when this device holds no care key, so the caller can refuse rather than publish PII in the clear.
function _careSeal(cp, obj) {
  const ring = _carekeys[cp];
  if (!ring || !ring.length) return null;
  try { return nip44e(JSON.stringify(obj), ring[0]); } catch { return null; }   // always seal with the CURRENT key
}
// Seal a body to an explicit set of PUBKEYS (asymmetric): one-off content key, NIP-44-wrapped to each recipient
// (incl. ourselves so we can read it back), body encrypted under that key. Used for the ask-for-help request +
// its shared thread — the sender is outside the church care-key audience, so it must wrap per-recipient.
function _sealToPubs(recips, bodyObj) {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const keyHex = _hex(keyBytes);
  let enc; try { enc = nip44e(JSON.stringify(bodyObj), keyBytes); } catch (e) { return null; }
  const keys = {};
  for (const p of [...new Set((recips || []).filter(Boolean))]) { try { keys[p] = nip44e(keyHex, nip44ck(sk, p)); } catch (e) {} }
  return { keys, enc };
}
// Reverse of _sealToPubs: unwrap our copy of the content key (conv-key with the AUTHOR) → decrypt the body.
// Returns null if we're not a recipient (a non-audience "garbage" doc) — callers use that to filter it out.
function _openSealed(o, authorPub) {
  try { const mine = o && o.keys && o.keys[pub]; if (!mine) return null; const kh = nip44d(mine, nip44ck(sk, authorPub)); return JSON.parse(nip44d(o.enc, _unhex(kh))); } catch (e) { return null; }
}
// Fetch the church's published care-team recipient roster (careteam:<cp> → [pubkeys]).
async function _fetchCareTeam(cp) {
  try {
    const evs = await pool.querySync(churchRelays(), [{ kinds: [30078], '#d': [CARETEAM_D + cp] }]);
    let best = null; for (const e of (evs || [])) { if (!best || e.created_at > best.created_at) best = e; }
    if (best) { const o = JSON.parse(best.content); if (Array.isArray(o.pubs)) return o.pubs.filter(Boolean); }
  } catch (e) {}
  return [];
}
// transparently decrypt an encrypted group message → event with plaintext content; null if it's
// encrypted and I don't hold the key (so the UI simply never sees it).
function _decEvt(cp, e) {
  if (!e.tags || !e.tags.some(t => t[0] === 'enc')) return e;
  const gid = (e.tags.find(t => t[0] === 't' && t[1] !== NET) || [])[1];
  const ring = gid && _gkeys[_gkKey(cp, gid)];   // SECURITY-AUDIT-2026-07-06 H5: this church's keys for this gid, not a collided one
  if (!ring || !ring.length) return null;
  // Current key first, then each superseded one: a message sealed before the last rotation must still open.
  // Returning null DROPS the message at both call sites, so a missing key reads as "this was never said".
  for (const key of ring) { try { return { ...e, content: nip44d(e.content, key) }; } catch (x) {} }
  return null;
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

// RESTORE FOLD — turns the raw event stream of "everything this key ever wrote" into { churches, name }.
// Split out of recoverIdentity() so it can be tested against the SHIPPED bundle without a relay: the whole
// 12-word restore hangs on this handful of lines, and the bug that broke it for good (an undeclared MEMBER_D
// throwing inside the relay's swallowed event handler) was invisible to every test we had.
// A member may belong to MANY churches; each one is a separate member:<churchpub> doc, so they simply
// accumulate. Networks-of-churches need nothing here — a network is published by the CHURCH, so it comes
// back on its own once the church is followed again.
function _restoreFold() {
  const seen = new Map();   // cp -> { at, left } from the NEWEST member: doc seen for that church
  let name = '', nameAt = 0;
  return {
    add(e) {
      if (!e) return;
      if (e.kind === 0) {
        if ((e.created_at || 0) < nameAt) return;   // an older profile must not overwrite a newer one
        nameAt = e.created_at || 0;
        try { name = (JSON.parse(e.content) || {}).name || name; } catch (x) {}
        return;
      }
      if (!Array.isArray(e.tags)) return;   // _dtag would throw; one malformed event must not cost a church
      const d = _dtag(e);
      // the member's OWN sealed name — the only place their name still exists on the network after Stage 2
      if (d.startsWith(NAME_D)) {
        if ((e.created_at || 0) < nameAt || !sk) return;
        const ct = _nameCipher(e.content, 'm');
        if (!ct) return;
        try { const o = JSON.parse(nip44d(ct, nip44ck(sk, pub))); if (o && typeof o.name === 'string' && o.name) { name = o.name.slice(0, 40); nameAt = e.created_at || 0; } } catch (x) {}
        return;
      }
      if (!d.startsWith(MEMBER_D)) return;
      const cp = d.slice(MEMBER_D.length);
      if (!cp) return;
      // "I left this church" is written by leaveMembership() as a ['deleted','1'] TAG with EMPTY content —
      // not a {left:true} body. The old check parsed the content for a `left` field that nothing has ever
      // written, and JSON.parse('') throws on '' anyway, so a deliberately-left church came back on restore.
      let leftBody = false;
      try { leftBody = !!(JSON.parse(e.content) || {}).left; } catch (x) {}
      const left = (e.tags || []).some(t => t[0] === 'deleted' && t[1] === '1') || leftBody;
      // NEWEST WINS, decided at the end — not "a leave deletes on sight". Relays deliver in no particular
      // order, so an OLD leave arriving after a NEWER rejoin used to erase a church the member is in today.
      const at = e.created_at || 0;
      const prev = seen.get(cp);
      if (!prev || at >= prev.at) seen.set(cp, { at, left });
    },
    result() {
      const churches = [...seen.entries()].filter(([, v]) => !v.left).sort((a, b) => b[1].at - a[1].at).map(([cp]) => cp);
      return { churches, name };   // newest-joined first — the app makes churches[0] the active one
    },
  };
}
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
// Do we answer a relay's NIP-42 challenge? ALWAYS — this is deliberately hardcoded true.
//
// It began (SECURITY-AUDIT-2026-07-06 M3) as "true only once we know we belong to an invite-only group", on
// the reasoning that proving your key to the relay is a privacy cost worth paying only for gated content.
// AUDIT-III (2026-07-13) inverted that: the roster, care records and safeguarding lists were world-readable to
// anonymous clients, and closing THAT meant almost everything a member reads is now gated — so a member who
// declines the challenge simply sees an empty church. The privacy argument also barely held: a joined member
// has already published a signed member: doc over the same socket, so the relay knows them regardless.
//
// DO NOT narrow this back to invite-only groups. Re-introducing the condition re-opens the roster leak.
// (The RELAY still challenges lazily — only when a gated read is withheld — which is the perf design and is
// unrelated to this flag. The comment that used to sit here described the old, narrowed behaviour and
// contradicted the line below it; that is exactly how a fixed leak gets un-fixed. Corrected 2026-07-26.)
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
// AUDIT-2026-07-28 F12. When did we last prove who we are to a relay? 0 = never on this connection.
// Needed because an EOSE IS NOT EVIDENCE OF ABSENCE. The comment directly below spells out that the church
// docs hub fetches and EOSEs BEFORE the auth round-trip finishes on a fresh boot — so "the relay answered and
// had no name key" and "the relay would not tell us, because we had not proved we are a member" are the same
// bytes. syncSealedNames treated that as "this church has no key" and republished an ADMITTED member's name
// sealed to the church key alone, making them Anonymous to their entire congregation. Reproduced by running
// the shipped function: ring empty + EOSE seen + unauthenticated -> 1 publish.
//
// A timestamp rather than a boolean, deliberately: `hub.eosed` is set once and NEVER reset, including across
// the post-auth refetch, so a boolean would still be satisfied by the pre-auth EOSE. The question that
// actually matters is whether the relay answered us AFTER it knew who we were.
let _relayAuthedAt = 0;
pool.automaticallyAuth = () => async (authEvent) => {
  if (!_needAuth) throw new Error('nip42: auth declined — no gated resource for this member');
  if (!sk) { try { await window.Fellowship.ready; } catch {} }
  if (!sk) throw new Error('no key');
  _relayAuthedAt = Date.now();
  _armAuthRefetch();   // once we auth, re-fetch the gated docs that were withheld before we proved membership
  return finalizeEvent(authEvent, sk);
};
// A member's church docs (groups, care, roster, chat tags) are NIP-42-gated, and auth is LAZY — it only
// happens once a gated REQ draws a challenge. On a fresh member's first boot the church-docs hub fetches and
// EOSEs BEFORE that auth round-trip finishes, so the relay withholds the gated docs and nothing re-fetches —
// the member sees an empty-looking church until a background+resume. Fix: the first time we sign an auth on a
// (re)connection, force ONE re-fetch a moment later, when the socket is authenticated. Debounced + armed once
// per connect (reconnectAll re-arms), so it never loops (a re-fetch on an already-authed socket draws no new
// challenge). Belt-and-braces with the existing resume re-fetch, which stays as the backstop on slow links.
let _authRefetchArmed = false, _authRefetchT = null;
function _armAuthRefetch() {
  if (_authRefetchArmed) return;
  _authRefetchArmed = true;
  if (_authRefetchT) clearTimeout(_authRefetchT);
  _authRefetchT = setTimeout(() => {
    _authRefetchT = null;
    try { refetchChurchDocs(); } catch (e) {}
    // F12: syncSealedNames now refuses to act on a pre-auth answer, and it is only triggered by setProfile or
    // by a name key arriving — neither of which happens for a member awaiting approval, whose church has no
    // key for them BY DESIGN. Without this re-run, requiring auth would re-create the bug it replaced: a
    // pending member showing on the steward's console as "Anon", which is the one screen where their name is
    // how you decide whether to admit them. Fires after the refetch's own EOSE has had time to land.
    setTimeout(() => { try { window.Fellowship.syncSealedNames(); } catch (e) {} }, 2500);
  }, 1300);
}
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
        // MERGE, don't replace. Since Stage 2 a member's kind-0 carries no name, and this assignment used to
        // overwrite the whole entry — so a profile arriving after _openSealedName had resolved someone would
        // wipe the name back out and they would flip to "Anonymous" mid-session. Keep any name we have already
        // opened unless this event actually carries one (a church's own kind-0 still does, deliberately).
        const had = profiles[e.pubkey] || {};
        profiles[e.pubkey] = { ...had, name: m.name || m.display_name || had.name || '', picture: m.picture || '', about: m.about || '', nip05: m.nip05 || '', hidden: !!m.hidden, av: m.av || undefined };
        _k0Seen.add(e.pubkey);
        _recoverOwnProfile(e);   // our OWN kind-0 also refills what a locked boot wiped (picture, avatar, about)
        saveProfiles();
        window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: e.pubkey } }));
      } catch {}
    },
    // Mark on EOSE too: a member who has published no kind-0 at all must not be re-asked for ever.
    oneose() { authors.forEach(pk => { pendingProfiles.delete(pk); _k0Seen.add(pk); }); try { sub.close(); } catch {} },
  });
}
const PROFILE_KEY = 'trinityone.profile';   // own display name (public; ok in localStorage)
// the last kind-0 body this session actually published, and for which key — see the idempotence guard in
// setProfile(). Session-scoped on purpose: a reload is allowed to re-announce, a retry loop is not.
let _profilePubFor = '', _profilePubBody = '';
const PROFILES_KEY = 'trinityone.profiles'; // cache of OTHER people's resolved profiles
// Pubkeys we have actually ASKED the relay about, and got an answer for (event or EOSE). Distinct from
// "is there an entry in profiles", because _openSealedName creates an entry holding ONLY a name — so
// gating the fetch on the entry meant anyone whose name arrived by the sealed route never had their
// kind-0 fetched, and kind-0 is where the AVATAR lives. Reported 2026-07-28: display pictures missing in
// chat while showing correctly in the steward console, which resolves profiles by another path.
const _k0Seen = new Set();
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
// PERF (audit 2026-07-24): the member hub carries BOTH the church's docs and its kind-1 chatter, and the daily
// full re-sync therefore re-downloaded the entire chat history — the relay cap is 5,000 events, ~1.5 MB raw,
// several minutes on 2G — every 24h, on every member's phone. Every one of those messages is then discarded
// except `msgs++`/lastTs for the People directory. The docs still get their periodic full sync (they're small,
// replaceable, and a missed update matters); kind-1 only ever needs the incremental window.
const _hubSinceKind1 = (hub) => Math.max(0, (hub.since || 0) - SINCE_SLOP);
// F12: record WHEN the relay answered, not merely that it did — an EOSE from before we authenticated has to
// be distinguishable from one after, and `eosed` is set once and never reset (including across the post-auth
// refetch), so a boolean cannot tell them apart.
const _hubEosed = (hub) => { hub.eosed = true; hub.eosedAt = Date.now(); if (hub.pendingFull) { hub.pendingFull = false; hub.fullAt = Math.floor(Date.now() / 1000); hub.dirty = true; } };

// ── docs hub: the church's kind-30078 corpus (groups, plans, devotionals, serving, care, …) ──
// APPROVAL RECOVERY. A church with approval on withholds its whole corpus from a member until a steward
// admits them — the relay's read gate is `member AND (not gated OR admitted)`. Approval flips that answer on
// the RELAY, but the member's app already has its subscriptions open and has already been told (by an empty
// EOSE) that there is nothing there. Nothing re-ran them, so an approved member sat looking at an empty
// church — no groups, no care, no roster — until something else happened to force a reconnect.
// Observed on a real device 2026-07-26: after approval, subscribeChurchGroups returned 0; re-announcing
// membership by hand took it to 1 immediately and the hub went from 14 docs to 30.
// The admitted list IS delivered to the member, so use it: the first time we see ourselves on it, re-announce
// (so the relay definitely holds our member doc) and re-fetch. Once per church per device, via a persisted
// flag, so a healthy launch does not churn.
// RE-SEAT: the church's word that a member who lost their 12 words is back on a NEW key. We use it only to
// stop showing the dead OLD key — the church would otherwise have two of the same person on its roster, and
// count them twice. Trusted from the church key or a CURRENT roster steward only: the relay enforces the same
// rule on write, and this is the client-side half, so a hostile relay cannot inject a re-seat either.
const RESEAT_D = 'trinityone/reseat:';
const _reseatOld = new Map();   // cp -> Set(old pubkey hex) superseded by a newer key
const _reseatAt = new Map();    // cp -> created_at of the newest doc we accepted (newest wins)
// CONGREGATION NAME KEY. The church wraps a copy for each member; a member's display name for that church is
// sealed under it, so the relay and any mirror hold ciphertext instead of a named roster. A RING, like the
// group and care keys, so rotating on removal never hides the names already published. AUDIT-2026-07-27.
const _nameKeys = new Map();    // cp -> [Uint8Array(32)], current first
const _nameKeyTs = new Map();   // cp -> created_at of the newest envelope accepted
const _sealedNames = new Map(); // "<cp>|<pubkey>" -> plaintext name, once opened
// cp -> "<name>|<the key it was sealed under>". The key half matters: this was keyed on the NAME alone, so
// after any rotation the re-seal that exists specifically to heal a rotation looked up "Maria", found "Maria",
// and skipped — leaving that member's name sealed under a key nobody holds any more, until the next app start.
// AUDIT-2026-07-27.
const _sealedMine = new Map();
function _ingestNameKey(cp, e) {
  if (e.pubkey !== cp && !(_churchRoster.get(cp) && _churchRoster.get(cp).has(e.pubkey))) return;
  if ((e.created_at || 0) < (_nameKeyTs.get(cp) || 0)) return;
  // DO NOT bump the newest-wins cursor before we know we can use this envelope. Without a signing key yet — a
  // boot race, a PIN unlock, a fresh join mid-session — the pass below bails, and having already moved the
  // cursor forward meant the SAME envelope was refused as stale when the key arrived and it was replayed.
  // The keys never loaded and every name in the church stayed blank for the session. AUDIT-2026-07-27.
  if (!sk) return;
  try {
    const env = JSON.parse(e.content || '{}');
    const mine = env.keys && pub && env.keys[pub];
    // NOT BEING IN AN ENVELOPE IS NOT REVOCATION. The console republishes this on roster ticks, and the roster
    // arrives in pieces, so an early envelope legitimately omits members who simply had not loaded yet.
    // Deleting on sight meant half a congregation went anonymous until a fuller envelope happened along. The
    // console now only ever grows the recipient list (except on a block, which is a genuine removal), and this
    // side keeps what it holds: a key we already have opens names we can already read, and the block rotates
    // the ring so nothing sealed AFTER it is readable to the removed member anyway.
    if (!mine) return;
    const r = JSON.parse(nip44d(mine, nip44ck(sk, e.pubkey)));
    if (!Array.isArray(r)) return;
    _nameKeyTs.set(cp, e.created_at || 0);
    _nameKeys.set(cp, r.filter(x => typeof x === 'string' && /^[0-9a-f]+$/i.test(x)).map(_unhexF));
  } catch (x) {}
}
const _unhexF = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
// Re-open every sealed name we have already buffered for a church. A name key that arrives (or becomes usable)
// AFTER the name documents is the normal case on a warm start, and without this the ciphertext just sits there.
// A short, stable fingerprint of the CURRENT key for a church, so the re-seal cache can tell "same name, same
// key" from "same name, key rotated underneath us".
function _ringId(cp) {
  const k = (_nameKeys.get(cp) || [])[0];
  return k ? [...k.slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join('') : '';
}
// GET YOUR OWN NAME BACK. A locked boot calls clearCommunityCache, which wipes every `trinityone.profile*`
// key — deliberate forensic hygiene, and the member's own name is identifying, so it goes with the rest.
// Before Stage 2 that was invisible: the name lived in the public kind-0 and came straight back on the next
// profile fetch. It is not there any more, so ONE lock left a member permanently "Anonymous" — to themselves
// and to their whole congregation — and, because syncSealedNames needs the name in memory to re-seal it,
// their sealed copy would never refresh either, so a key rotation would erase them from the church for good.
// The copy sealed to their OWN key exists for exactly this; it was only being read during a 12-word restore.
// Readable by nobody else, so restoring from it costs the locked phone nothing. AUDIT-2026-07-28.
function _recoverOwnName(cp, e) {
  if (!sk || !pub || !e || e.pubkey !== pub) return false;
  if (((window.Fellowship.myProfile || {}).name || '').trim()) return false;   // we already know who we are
  const ct = _nameCipher(e.content, 'm');
  if (!ct) return false;
  try {
    const o = JSON.parse(nip44d(ct, nip44ck(sk, pub)));
    const nm = (o && typeof o.name === 'string') ? o.name.slice(0, 40).trim() : '';
    if (!nm) return false;
    const p2 = { ...(window.Fellowship.myProfile || {}), name: nm };
    window.Fellowship.myProfile = p2;
    profiles[pub] = { ...(profiles[pub] || {}), name: nm };
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p2)); } catch (x) {}
    try { saveProfiles(); } catch (x) {}
    try { window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: pub } })); } catch (x) {}
    return true;
  } catch (x) { return false; }
}
// AND GET YOUR FACE BACK. The locked-boot wipe takes the whole stored profile — name, about, picture and
// avatar. _recoverOwnName restores the NAME from the sealed copy, and left the rest behind, so a member's
// photo vanished on the next locked boot and only came back if they noticed and re-added it. Reported
// 2026-07-28 ("Testi Bob's picture has gone"), after I had fixed exactly half of this the same afternoon.
// Unlike the name, these ARE published — kind-0 carries picture and av deliberately — so they can simply be
// read back from our own profile. Never overwrite something we already hold: a member who set a new photo
// before the old event arrives must not have it undone. AUDIT-2026-07-28.
function _recoverOwnProfile(e) {
  if (!pub || !e || e.pubkey !== pub) return false;
  let m = null; try { m = JSON.parse(e.content || '{}'); } catch (x) { return false; }
  if (!m || typeof m !== 'object') return false;
  const cur = window.Fellowship.myProfile || {};
  const next = { ...cur };
  let changed = false;
  // `hidden` is the member's opt-out from the church directory. It IS published (wire.hidden), so it was
  // always recoverable — it simply was not recovered, so a locked boot silently made a member who had opted
  // OUT visible again, and the Settings toggle then agreed with the wrong answer. AUDIT-2026-07-28.
  if (cur.hidden === undefined && m.hidden !== undefined) { next.hidden = !!m.hidden; changed = true; }
  for (const k of ['about', 'picture']) {
    if (!cur[k] && typeof m[k] === 'string' && m[k]) { next[k] = m[k]; changed = true; }
  }
  if (!cur.av && m.av && typeof m.av === 'object') { next.av = m.av; changed = true; }
  if (!changed) return false;
  window.Fellowship.myProfile = next;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)); } catch (x) {}
  try { window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: pub } })); } catch (x) {}
  return true;
}
function _replaySealedNames(cp, hub) {
  if (!hub || !hub.buf || !(_nameKeys.get(cp) || []).length) return;
  let n = 0;
  for (const e of hub.buf.values()) { if (_dtag(e) === NAME_D + cp) { _recoverOwnName(cp, e); if (_openSealedName(cp, e.pubkey, e.content)) n++; } }
  if (n) { try { window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: null } })); } catch (x) {} }
}
// open a member's sealed name; tries every key so a rotation never hides an older one
// Build the { c, m } name document. Extracted so a test can drive the REAL thing: written inline, the test had
// to build its own copy of the payload, and it then passed happily with the self-recovery copy deleted from the
// shipped code — the exact mirror-test failure this repo keeps repeating. AUDIT-2026-07-27.
//   c — for the congregation, sealed under the church's name key. Before admission there is no such key (and a
//       pending member must not be handed one: it would open the whole roster), so it is sealed to the CHURCH,
//       which is the only party that needs to read it in order to approve them.
//   m — for the member themselves. Stage 2 took the name out of kind-0, and kind-0 was where a member restoring
//       from their 12 words on a new phone got their name back. Reading the congregation copy cannot work at
//       restore time: it needs the name key, which needs membership, which is the thing still in flight.
function _sealNameDoc(cp, nm, congKey) {
  if (!sk || !cp) return '';
  const body = JSON.stringify({ name: nm });
  let c = '', m = '';
  try { c = congKey ? nip44e(body, congKey) : nip44e(body, nip44ck(sk, cp)); } catch (e) { return ''; }
  try { m = nip44e(body, nip44ck(sk, pub)); } catch (e) {}
  return JSON.stringify({ c, m });
}
// The document holds { c, m }: `c` is the copy for the congregation (or, before admission, for the church),
// `m` is the author's own recovery copy. A bare string is the pre-Stage-2 shape and is treated as `c`.
function _nameCipher(content, which) {
  const raw = String(content || '');
  if (!raw.startsWith('{')) return which === 'c' ? raw : '';
  try { const o = JSON.parse(raw); return (o && typeof o[which] === 'string') ? o[which] : ''; } catch (x) { return ''; }
}
function _openSealedName(cp, author, content) {
  const ct = _nameCipher(content, 'c');
  if (!ct) return '';
  for (const k of (_nameKeys.get(cp) || [])) {
    try { const o = JSON.parse(nip44d(ct, k)); if (o && typeof o.name === 'string') {
      const nm = o.name.slice(0, 40);
      _sealedNames.set(cp + '|' + author, nm);
      if (!profiles[author]) profiles[author] = {};
      profiles[author].name = nm;                       // so every existing screen resolves it unchanged
      try { saveProfiles(); } catch (x) {}               // and survives a reload, like every other resolved name
      return nm;
    } } catch (x) {}
  }
  return '';
}
const _reseatNamed = new Set();   // cp|pub we have already adopted a vouched name for, this session
function _noteReseat(cp, e) {
  if (e.pubkey !== cp && !(_churchRoster.get(cp) && _churchRoster.get(cp).has(e.pubkey))) return;
  if ((e.created_at || 0) < (_reseatAt.get(cp) || 0)) return;
  _reseatAt.set(cp, e.created_at || 0);
  const s = new Set();
  let mine = '';
  try {
    for (const p of ((JSON.parse(e.content) || {}).pairs || [])) {
      if (!p || !p.old || !p.new || p.old === p.new) continue;
      s.add(String(p.old).toLowerCase());
      if (pub && String(p.new).toLowerCase() === pub) mine = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    }
  } catch (x) {}
  _reseatOld.set(cp, s);
  // THE NAME COMES BACK. A member re-seated by their church arrives on a key with no kind-0 at all — they never
  // passed through the name step, because the whole route exists for people who cannot get back in on their
  // own. So take the name the church vouched for and publish it as our OWN profile: after this the name is
  // genuinely ours, everywhere, exactly as if we had typed it. Three screens promised this and none of them
  // delivered it. AUDIT-2026-07-26 CRITICAL 3.
  //
  // Guards, in order of how badly each would hurt: never overwrite a name the member already has (theirs wins,
  // always — this is a bootstrap, not an override); once per key per session; and only after the transport has
  // a signing key, or setProfile would publish as nobody. The publish itself is idempotent (see setProfile),
  // so a redelivered doc costs nothing.
  if (!mine || !pub) return;
  const key = cp + '|' + pub;
  if (_reseatNamed.has(key)) return;
  _reseatNamed.add(key);
  setTimeout(() => {
    const have = ((window.Fellowship.myProfile || profiles[pub] || {}).name || '').trim();
    if (have) return;                                  // they have named themselves — leave them alone
    try { window.Fellowship.setProfile({ name: mine }); } catch (x) {}
  }, 0);   // deferred: we are inside the docs hub's onevent, where a throw is logged and swallowed
}
function _superseded(cp, pubHex) { const s = _reseatOld.get(cp); return !!(s && s.has(pubHex)); }
const ADMITTED_D = 'trinityone/admitted:';
const ADMITTED_OK_LS = 'trinityone.admitted.';
const _admittedDone = new Set();   // cp|pub -> recovery already run THIS SESSION (see below)
function _noteAdmitted(cp, content) {
  if (!pub) return;
  let list = [];
  try { const c = JSON.parse(content) || {}; list = Array.isArray(c.pubkeys) ? c.pubkeys : []; } catch (e) { return; }
  if (!list.includes(pub)) return;
  // The one-shot must be IN MEMORY, not just persisted. With only the localStorage flag, a setItem that throws
  // (quota — this app persists up to 3MB of docs-hub per church — or private mode) left `already` false forever,
  // so every redelivery of the admitted doc re-fired the recovery, and the recovery's own refetch re-delivered
  // that same doc. Self-feeding: measured 67-161 announceMembership publishes and as many hub teardowns in a
  // few seconds, after which the hub was dead and the church stayed empty for the session, with no error and
  // relaysHealthy() still true. AUDIT 2026-07-26.
  //
  // Keyed by cp|pub, not cp: a second identity on the same device (new identity, 12-word restore, an adopted
  // steward seed) was suppressed by the FIRST member's flag and never recovered — and so was the same member
  // after a revoke and re-admit.
  const key = cp + '|' + pub;
  if (_admittedDone.has(key)) return;
  let already = false;
  try { already = localStorage.getItem(ADMITTED_OK_LS + key) === '1'; } catch (e) {}
  if (already) { _admittedDone.add(key); return; }
  _admittedDone.add(key);   // claim it BEFORE the async work, so a storage failure cannot cause a storm
  // deferred: we are inside the hub's onevent, and refetchChurchDocs tears the hub's subscription down
  setTimeout(() => {
    // A CURSORED refetch is useless here, and this is the whole bug the first version of this shipped with.
    // The relay withheld the church's corpus while we were unadmitted, so the documents we are missing are as
    // OLD as the church — groups created at setup, a member approved the following Sunday. But _hubCursor has
    // already advanced hub.since to the admitted doc's created_at (i.e. now) before we get here, so a normal
    // refetch asks only for the last SINCE_SLOP (3 days) and returns nothing. Proven in audit 2026-07-26:
    // with docs aged 10 days the member stayed at 0 groups through approval AND a restart; with docs aged 0
    // days the same code produced 3 groups. My device test happened to use a church with fresh docs, which is
    // exactly why it looked fixed. Reset the cursor so this one refetch is a FULL sync.
    const hub = _docsHubs.get(cp);
    if (hub) { hub.since = 0; hub.fullAt = 0; }
    try { window.Fellowship.announceMembership(cp); } catch (e) {}
    try { refetchChurchDocs(); } catch (e) {}
    // Mark it done only AFTER the work has been dispatched. The first version set the flag up front, so a
    // failure here (offline, hub gone) consumed the one-shot forever and no restart could heal it.
    try { localStorage.setItem(ADMITTED_OK_LS + key, '1'); } catch (e) {}
  }, 0);
}
const _docsHubs = new Map();   // churchPubHex -> hub (kept warm for the app's lifetime; sub closes at 0 refs)
// PERF (AUDIT-2026-07-24): replaying the docs hub was O(handlers x corpus). Every _onChurchDocs registration
// copied the WHOLE buffer, sorted it, and dispatched all of it to a handler that then discarded everything not
// matching its own d-prefix — and the member app registers ~17 handlers, re-run on every reconnect. Index the
// buffer by doc TYPE (the segment after 'trinityone/') so a handler that declares `want` replays only its own
// slice. Handlers without `want` still get the full replay, so this is additive and nothing breaks by omission.
function _dkeyOf(d) {
  const s0 = String(d || '');
  if (s0.lastIndexOf('trinityone/', 0) !== 0) return '';
  const rest = s0.slice(11), c = rest.indexOf(':');
  return c === -1 ? rest : rest.slice(0, c);
}
function _hubBufSet(hub, key, e) {
  hub.buf.set(key, e);
  const dk = _dkeyOf(_dtag(e));
  let sl = hub.idx.get(dk);
  if (!sl) { sl = new Map(); hub.idx.set(dk, sl); }
  sl.set(key, e);
}
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
  hub = { cp, handlers: new Set(), refs: 0, eosed: false, buf: new Map(), idx: new Map(), since: 0, fullAt: 0, pendingFull: false, dirty: false, saveT: null, closer: null };
  _docsHubs.set(cp, hub);
  try {
    const raw = JSON.parse(localStorage.getItem(DOCSHUB_KEY + cp) || 'null');
    if (raw && Array.isArray(raw.events)) {
      hub.since = raw.since || 0; hub.fullAt = raw.fullAt || 0;
      for (const e of raw.events) { if (e && e.pubkey && Array.isArray(e.tags)) _hubBufSet(hub, e.pubkey + '|' + _dtag(e), e); }
    }
  } catch {}
  // absorb hub-level docs from the persisted corpus BEFORE any feature registers: the steward roster
  // (so _churchVoice trusts steward-authored docs immediately) and group-key envelopes (so encrypted
  // groups decrypt) — both are in-memory only, and the since-cursor means they won't re-arrive.
  for (const e of hub.buf.values()) _absorbRoster(cp, _dtag(e), e);   // absorb the full roster FIRST so the group-key author check can trust roster stewards regardless of buffer order
  for (const e of hub.buf.values()) { const d0 = _dtag(e); if (d0.startsWith(GROUPKEY_D)) _ingestGroupKey(cp, e); else if (d0 === CAREKEY_D + cp) _ingestCareKey(cp, e); }
  for (const e of hub.buf.values()) { if (_dtag(e) === ADMITTED_D + cp) _noteAdmitted(cp, e.content); }   // approved while the app was closed
  for (const e of hub.buf.values()) { if (_dtag(e) === RESEAT_D + cp) _noteReseat(cp, e); }            // re-seats recorded while the app was closed
  for (const e of hub.buf.values()) { if (_dtag(e) === 'trinityone/namekey:' + cp) _ingestNameKey(cp, e); }   // the key FIRST
  for (const e of hub.buf.values()) { const d0 = _dtag(e); if (d0 === 'trinityone/name:' + cp) { _recoverOwnName(cp, e); _openSealedName(cp, e.pubkey, e.content); } }
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
      _hubBufSet(hub, key, _slimEvt(e)); hub.dirty = true;
      _hubCursor(hub, e);
      _docsHubSaveSoon(hub);
      if (d === 'trinityone/namekey:' + cp) {
        _ingestNameKey(cp, e);
        // A church may publish its key long after we joined, or rotate it. Seal our name here the moment we
        // can, so a member never has to notice that a key arrived — deferred out of the relay's event handler,
        // where a throw is swallowed and would leave us silently nameless in that church.
        setTimeout(() => { try { window.Fellowship.syncSealedNames([cp]); } catch (x) {} }, 0);
        // the key may arrive AFTER names we could not open — retry them, or the roster stays anonymous
        for (const e2 of hub.buf.values()) { if (_dtag(e2) === 'trinityone/name:' + cp) _openSealedName(cp, e2.pubkey, e2.content); }
        try { window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: null } })); } catch (x) {}
      } else if (d === 'trinityone/name:' + cp) {
        _recoverOwnName(cp, e);   // our own doc carries the copy that restores us after a locked boot
        if (_openSealedName(cp, e.pubkey, e.content)) { try { window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: e.pubkey } })); } catch (x) {} }
      }
      if (_absorbRoster(cp, d, e)) {
        // SECURITY-AUDIT-2026-07-06 L7 (availability): a steward-authored group-key envelope that arrived on the
        // LIVE path BEFORE this roster was rejected by _ingestGroupKey (author not yet trusted) and — unlike the
        // boot path — was never retried, so the encrypted group stayed blank until the next app start. Now that
        // the roster establishes trust, re-ingest the buffered envelopes (mirrors the boot-replay loop).
        // The name key needs this too, and for exactly the L7 reason: _ingestNameKey requires the author to
        // be the church or a CURRENT roster steward, so an envelope that arrives before the roster does is
        // dropped and never retried. AUDIT-2026-07-27.
        for (const e2 of hub.buf.values()) { const d2 = _dtag(e2); if (d2.startsWith(GROUPKEY_D)) _ingestGroupKey(cp, e2); else if (d2 === CAREKEY_D + cp) _ingestCareKey(cp, e2); else if (d2 === NAMEKEY_D + cp) { _ingestNameKey(cp, e2); _replaySealedNames(cp, hub); } }
        for (const h of [...hub.handlers]) { try { h.onroster && h.onroster(); } catch (err) { console.error(err); } } return;
      }
      if (d === ADMITTED_D + cp) _noteAdmitted(cp, e.content);   // just approved? re-announce + re-fetch once
      if (d === RESEAT_D + cp) _noteReseat(cp, e);          // a member came back on a new key — stop showing the old one
      if (d.startsWith(GROUPKEY_D)) { _ingestGroupKey(cp, e); return; }
      // The care key can arrive AFTER the needs it unlocks. subscribeCareNeeds decodes each need AT INGEST
      // and its onroster() only re-filters those already-decoded entries — so a card rendered "details
      // hidden" before the key landed stayed sealed for the session. Replay the buffered CARE_D need events
      // through onevent so they re-parse WITH the key now present (mirrors the L7 group-key replay above).
      if (d === CAREKEY_D + cp) {
        _ingestCareKey(cp, e);
        for (const e2 of hub.buf.values()) { const d2 = _dtag(e2); if (d2.startsWith(CARE_D)) { for (const h of [...hub.handlers]) { try { h.onevent(e2, d2); } catch (err) {} } } }
        for (const h of [...hub.handlers]) { try { h.onroster && h.onroster(); } catch (err) {} }
        return;
      }
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
  // h.want = the d-prefixes this handler actually consumes. Replay only those slices instead of the whole
  // corpus; a handler that declares nothing still gets everything (see _hubBufSet).
  let pool0;
  if (Array.isArray(h.want) && h.want.length) {
    const keys = new Set(h.want.map(_dkeyOf));
    pool0 = [];
    for (const k of keys) { const sl = hub.idx.get(k); if (sl) for (const e of sl.values()) pool0.push(e); }
  } else pool0 = [...hub.buf.values()];
  const replay = pool0.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));   // oldest first, so the newest version of a doc wins
  for (const e of replay) {
    const d = _dtag(e);
    if (d === 'trinityone/stewards:' + cp || d.startsWith(GROUPKEY_D)) continue;   // hub-level docs, already absorbed
    try { h.onevent(e, d); } catch (err) { console.error(err); }
  }
  if (hub.eosed && h.oneose) { try { h.oneose(); } catch (err) { console.error(err); } }
  let off = false;
  return () => {
    if (off) return; off = true;
    if (h.emit && h.emit.cancel) h.emit.cancel();   // kill a queued emit so it cannot fire after teardown
    hub.handlers.delete(h);
    // at 0 refs close the relay sub and flush; the hub object (buffer + cursor) stays warm in memory,
    // so the app-level reconnect (connTick tears everything down, then re-registers) re-opens with the
    // cursor instead of re-parsing disk or re-streaming the corpus.
    if (--hub.refs <= 0) { hub.refs = 0; const close = hub.closer; hub.closer = null; if (close) close(); _docsHubSaveNow(hub); }
  };
}
// Force every OPEN church-doc hub to re-run its since-cursor fetch, independent of ref-counting. The
// connTick reopen only fires when EVERY feature using a hub tears down at once — which isn't true while the
// chat/care screens hold persistent subs — so a steward's change (chat tags, groups, care) could sit unseen
// until a full app restart. Called on app RESUME (not on a timer): it closes each hub's live sub and reopens
// it with a fresh _hubSince() fetch (incremental, 3-day slop), delivering any updates to the existing handlers.
function refetchChurchDocs() {
  for (const hub of _docsHubs.values()) {
    if (!hub.closer) continue;                 // only hubs currently open
    const c = hub.closer; hub.closer = null; try { c(); } catch (e) {}
    _docsHubOpen(hub);
  }
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
  const since = _hubSince(hub);
  const filters = [{ kinds: [1], '#p': [cp] }, { kinds: [30078], '#p': [cp] }];
  // The docs half takes the ordinary cursor (with its periodic full re-sync). The kind-1 half NEVER full-syncs:
  // re-pulling the church's whole chat history to recompute a member count is megabytes over 2G, daily, for a
  // number. Incremental only — see _hubSinceKind1.
  if (since) filters[1].since = since;
  const k1since = _hubSinceKind1(hub);
  if (k1since) filters[0].since = k1since;
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
  const wasKeyless = !sk;
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
  // Ask for our OWN kind-0 when the stored profile is missing what a locked boot wiped. Without this the
  // refill above depends on luck — our pubkey only reaches requestProfiles when we happen to appear in a
  // roster or authored a visible message. AUDIT-2026-07-28.
  try {
    const mine = window.Fellowship.myProfile || {};
    if (pub && (!mine.av && !mine.picture)) window.Fellowship.requestProfiles([pub]);
  } catch (e) {}
  // …and the children, wiped by the same locked boot and rebuildable from our own guardian requests.
  try { for (const hub of _docsHubs.values()) _rebuildFamily(hub.cp); } catch (e) {}
  // …and the name key. Left out of both recovery hooks, it was the one key with no way back: the docs hub uses
  // a persisted since-cursor, and a name key is published once at church setup, so it does not re-arrive. On any
  // launch where the hub cache was warm and the signing key derived a moment late, the ring stayed empty for the
  // whole session and every member showed as anonymous. AUDIT-2026-07-27.
  for (const hub of _docsHubs.values()) { for (const e of hub.buf.values()) { const d = _dtag(e); if (d.startsWith(GROUPKEY_D)) _ingestGroupKey(hub.cp, e); else if (d === CAREKEY_D + hub.cp) _ingestCareKey(hub.cp, e); else if (d === NAMEKEY_D + hub.cp) { _ingestNameKey(hub.cp, e); _replaySealedNames(hub.cp, hub); } } }
  // signal that the signing key is now ready, so listeners (e.g. the app's serving subscriptions,
  // which bail when myPubkey is null) re-run with a valid pubkey instead of needing a restart.
  try { window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: pub } })); } catch {}
  // keyless→keyed: any church-doc socket opened BEFORE the key existed (a fresh join creates the identity
  // mid-session; a boot race opens hubs before this derive finishes) ran NIP-42 auth as NOBODY and got only
  // PUBLIC docs — so the member sees an empty church (no groups/care/roster) until a background+resume.
  // Reopening a sub on that socket won't re-challenge; only a NEW socket does. So if we just gained the key
  // and hubs are already open, force authenticated reconnections. Covers fresh-join, boot race, AND unlock.
  // Debounced: unlock fires BOTH 'trinity-identity' and 'trinity-identity-lock', and on native (async key read)
  // the two can each capture wasKeyless=true before either sets sk — guard so we reconnect at most once per window.
  if (wasKeyless && sk && !_reconnectGuard) { for (const hub of _docsHubs.values()) { if (hub.closer) { _reconnectGuard = true; setTimeout(() => { _reconnectGuard = false; }, 1500); try { reconnectAll(); } catch (e) {} break; } } }
}
let _reconnectGuard = false;
async function init() {
  if (window.TrinityIdentity && window.TrinityIdentity.ready) await window.TrinityIdentity.ready;
  await deriveFromIdentity();
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) { const p = JSON.parse(raw); profiles[pub] = p; window.Fellowship.myProfile = p; }
  } catch {}
}
// keep the signing key in step with identity regeneration / restore (deriveFromIdentity self-heals the
// keyless→keyed reconnection, so a fresh join / restore re-auths its already-open sockets automatically)
window.addEventListener('trinity-identity', () => { deriveFromIdentity().catch(() => {}); });

// UNLOCK RECOVERY (PIN feature): on a PIN-locked boot the signing key does not exist yet, so any relay
// sockets opened while locked ran NIP-42 auth as NOBODY (automaticallyAuth threw 'no key') and the relay
// served only PUBLIC docs — the member appeared stuck "waiting for approval" with no groups/care, because
// the admitted list + the whole church corpus are member-gated. Deriving the key later doesn't help: the
// already-open sockets never re-challenge. So when the identity unlocks, derive the key THEN force fresh,
// authenticated reconnections. Only fires on a real keyless→keyed transition, so a no-PIN boot never churns.
function reconnectAll() {
  _authRefetchArmed = false;   // a new connection will auth again → re-arm the post-auth re-fetch
  _relayAuthedAt = 0;          // F12: and it has proved nothing yet, so no gated read is authoritative until it does
  // drop every church-doc hub's live sub so it re-opens fresh (buffer + cursor stay warm in memory)
  for (const hub of _docsHubs.values()) { const c = hub.closer; hub.closer = null; if (c) { try { c(); } catch (e) {} } }
  // Shared subscriptions ride the same sockets, so they die with them. Drop the registry too, or the next
  // subscriber joins a dead entry and is handed a stale `last` instead of a fresh REQ — which is what made
  // Watch's "taking a while — Retry" button do nothing while another screen held the same stream.
  for (const [k, e] of [..._sharedSubs]) { const c = e.closer; e.closer = null; if (c) { try { c(); } catch (err) {} } _sharedSubs.delete(k); }
  // close the underlying relay sockets so the reopened subs run a NEW NIP-42 challenge with the key present
  const urls = new Set([...(window.Fellowship.relays || []), ...CANONICAL_RELAYS]);
  for (const m of _churchRelays.values()) for (const u of m.keys()) urls.add(u);
  for (const u of urls) { try { pool.close([u]); } catch (e) {} }
  // nudge the app to re-run its serving subscriptions (connTick) → fresh, authenticated sockets
  try { window.dispatchEvent(new CustomEvent('trinity-reconnect')); } catch (e) {}
}
window.addEventListener('trinity-identity-lock', () => { deriveFromIdentity().catch(() => {}); });

// ── OUTBOX (UX-AUDIT-2026-07-20 E1) ───────────────────────────────────────────────────────────────
// A message that couldn't be sent used to be gone: the composer cleared, the transport logged a warning,
// and nothing appeared. On the intermittent connections this product is built for that is the failure that
// costs the most trust, because nobody reports it — they just stop trusting the app with anything that
// matters.
//
// The event is SIGNED ONCE at compose time and the signed event is what we store. A retry republishes it
// verbatim, so it keeps its original id and created_at: the relay's echo dedupes against the optimistic
// bubble by id for free, and the message keeps the timestamp of when the member actually wrote it, not
// when the signal came back. Persisted, so closing the app doesn't lose it.
const OUTBOX_KEY = 'trinityone.outbox';
const OUTBOX_FAILED_KEY = 'trinityone.outbox.failed';   // gave-up messages, persisted (see below)
const OUTBOX_MAX = 200;            // a bounded queue: past this the oldest is dropped rather than growing forever
let _outbox = [];
let _outboxFailed = [];   // gave up on these — surfaced to the member rather than discarded
const _outboxSubs = new Set();
function _outboxLoad() {
  try { _outbox = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]') || []; } catch (e) { _outbox = []; }
  try { _outboxFailed = JSON.parse(localStorage.getItem(OUTBOX_FAILED_KEY) || '[]') || []; } catch (e) { _outboxFailed = []; }
}
function _outboxSave() {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(_outbox.slice(-OUTBOX_MAX))); } catch (e) {}
  // The gave-up bin is persisted too. It was memory-only, so a member's refused message — the whole reason
  // this bin exists instead of a silent discard — was itself silently lost on app close, before they could
  // see it, copy it out, or requeue it.
  try { localStorage.setItem(OUTBOX_FAILED_KEY, JSON.stringify(_outboxFailed.slice(-50))); } catch (e) {}
  for (const fn of [..._outboxSubs]) { try { fn(_outbox); } catch (e) {} }
}
_outboxLoad();
let _flushing = false;
// One attempt at one relay set, bounded in time. Offline publishes do NOT fail fast — a socket that never
// opens leaves Promise.any pending indefinitely — so without this the composer would sit on "sending" for
// minutes and a flush would never finish. Verified on-device in airplane mode.
const PUBLISH_TIMEOUT_MS = 12000;
// nostr-tools RESOLVES rather than rejects when a relay cannot be reached — it fulfils with a STRING like
// "connection failure: connection timed out" (measured: 3ms to a dead port, 3s to a black hole). So the app's
// pattern, `try { await _publishAny(...); return true } catch { return false }`, reported SUCCESS
// with the radio off, at 29 call sites. markSafe told a member they were marked safe and persisted the ack so
// they were never asked again — its own comment calls that the worst failure this feature can have. A care
// request said "your church family knows you asked for help". And the outbox marked the event delivered and
// dropped it, so the one mechanism built for being offline never ran when offline. AUDIT 2026-07-26.
//
// This is a drop-in for `_publishAny(a, b)` that REJECTS unless at least one relay genuinely
// accepted, so every existing try/catch keeps its meaning instead of 29 call sites needing new logic.
const _PUB_FAILED = /^(connection failure|error|blocked|invalid|restricted|rate-limited|auth-required)/i;
function _publishAny(relays, evt) {
  return Promise.allSettled(pool.publish(relays, evt)).then((rs) => {
    const good = rs.some(r => r.status === 'fulfilled' && !_PUB_FAILED.test(String(r.value == null ? '' : r.value)));
    if (!good) {
      const why = (rs.find(r => r.status === 'fulfilled') || {}).value
        || ((rs.find(r => r.status === 'rejected') || {}).reason || {}).message || 'no relay accepted this';
      throw new Error(String(why));
    }
    return true;
  });
}
function _publishBounded(relays, evt) {
  return Promise.race([
    _publishAny(relays, evt),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), PUBLISH_TIMEOUT_MS)),
  ]);
}
// A relay REFUSING a message is not the same as being unable to reach one, and conflating them is a bug:
// a message the relay will never accept (not a member of that group, blocked, malformed) would otherwise be
// retried forever, every 45 seconds, for the life of the install. Nostr signals refusal as OK=false with a
// reason; nostr-tools surfaces it as a rejection whose message carries that reason. Treat the known refusal
// prefixes as permanent, everything else as "try again later".
// PERMANENT = the relay will never accept this message, so retrying is pointless (not a member, blocked,
// malformed). NOT rate-limited: per NIP-01 that means "retry later" — the canonical TRANSIENT refusal — and
// it is exactly what a reconnect-flush of several queued messages trips. Dropping a member's words because
// the relay asked them to slow down is the wrong call. `error:` is dropped too: it's an unstructured
// catch-all, and an ambiguous error should keep the message (MAX_TRIES is the backstop), not bin it.
const _PERMANENT = /^(blocked|invalid|restricted)/i;
const isPermanentRefusal = (e) => _PERMANENT.test(String((e && e.message) || e || ''));
const isRateLimited = (e) => /^rate-limited/i.test(String((e && e.message) || e || ''));
// A connection-level failure (timeout, no relay reachable) means the message NEVER reached a relay — an
// OUTAGE, not a refusal. It must not count toward the give-up backstop: otherwise a message queued while
// offline is dropped after MAX_TRIES ticks (~37 min at 45s, NOT "a day" as the old comment claimed —
// off by ~40×) even though no relay ever saw it. Only a genuine relay refusal burns a try.
const _CONNECTION = /timeout|network|websocket|failed to (fetch|connect)|connection|econn|enotfound|socket|offline|unreachable/i;
const isConnectionFailure = (e) => _CONNECTION.test(String((e && e.message) || e || ''));
const MAX_TRIES = 50;   // 50 genuine relay REFUSALS (outages don't count) — a backstop so an unanticipated
                        // non-permanent refusal shape isn't retried forever, not a wall-clock limit.
// Try to deliver everything queued. Safe to call often — it no-ops while already running.
async function _outboxFlush() {
  if (_flushing || !_outbox.length || !sk) return;
  _flushing = true;
  try {
    for (const item of [..._outbox]) {
      try {
        await _publishBounded(item.relays && item.relays.length ? item.relays : window.Fellowship.relays, item.evt);
        _outbox = _outbox.filter(o => o.evt.id !== item.evt.id);
        _outboxSave();
      } catch (e) {
        const errs = (e && e.errors) ? e.errors : [e];               // AggregateError from Promise.any
        const permanent = errs.length && errs.every(isPermanentRefusal);
        const outage = errs.length && errs.every(isConnectionFailure);   // never reached a relay → don't burn a try
        const rateLimited = errs.some(isRateLimited);
        if (!outage) item.tries = (item.tries || 0) + 1;
        item.lastTry = Math.floor(Date.now() / 1000);
        item.lastError = String((errs[0] && errs[0].message) || '').slice(0, 120);
        if (permanent || item.tries >= MAX_TRIES) {
          // Give up, but do NOT silently bin the member's words — mark it so the thread can show it was
          // refused and offer to discard or copy it out.
          item.failed = true; item.permanent = !!permanent;
          _outbox = _outbox.filter(o => o.evt.id !== item.evt.id);
          _outboxFailed.push(item); if (_outboxFailed.length > 50) _outboxFailed.shift();
        }
        _outboxSave();
        // The relay said "slow down". Bursting the rest of the queue would just trip it again and burn a
        // try on every remaining item. Stop this pass and let the 45s tick resume it, spaced out.
        if (rateLimited) break;
      }
      // Gentle pacing between sends so a reconnect-flush of several queued messages doesn't itself burst
      // into the rate limit above.
      if (_outbox.length > 1) await new Promise(r => setTimeout(r, 150));
    }
  } finally { _flushing = false; }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { _outboxFlush(); });   // NB: navigator.onLine lies on native, but the EVENT still fires on a real transition
  // Backoff (audit 2026-07-24): this fired every 45s forever. A member in a low-coverage area with a queued
  // message woke the radio every 45 seconds for hours — continuous battery drain for exactly the audience least
  // able to charge. Back off on repeated failure (45s → 15min cap) and reset the moment anything succeeds or the
  // device comes back online / to the foreground (those listeners already exist above).
  let _obFails = 0, _obTimer = null;
  const _obDelay = () => Math.min(900000, 45000 * Math.pow(2, Math.min(_obFails, 5)));
  window.__trinityOutboxOk = () => { _obFails = 0; };
  const _obTick = async () => {
    const before = _outbox.length;
    try { await _outboxFlush(); } catch (e) {}
    const after = _outbox.length;
    if (after > 0 && after >= before) _obFails++; else _obFails = 0;   // nothing drained → back off
    _obTimer = setTimeout(_obTick, _obDelay());
  };
  _obTimer = setTimeout(_obTick, 45000);
}

window.Fellowship = {
  relays: loadRelays(),
  refetchChurchDocs,   // force church-doc hubs to re-fetch on app resume (updates without a full restart)
  CANONICAL_RELAY,
  CANONICAL_RELAYS,
  toPub,   // validate/normalise an npub-or-hex → 64-hex (or null on a bad bech32 checksum); used by the UI to reject a mistyped church code
  // The member app's 90s reconnect tick only re-subscribes when this is FALSE — so a healthy socket never
  // triggers the full re-REQ storm (perf #2). Mirrors the steward console.
  // "Is there a live socket?" — and it has to MEAN that. The first version asked the opposite question ("is any
  // relay explicitly reported as down?") and answered `true` for a relay that had never been dialled at all,
  // because pool.listConnectionStatus() only contains relays it has opened, so `st.get(url)` was `undefined`.
  // It also returned `true` on exception. Every caller reads it as "we're connected, go ahead", so on a phone
  // with no connection whatsoever it green-lit the restore-recovery loop (AUDIT-2026-07-26 CRITICAL 4) and
  // suppressed the 90s reconnect beat — the two places that exist to recover exactly that state.
  // Now: at least one of the relays we want must actually be connected.
  relaysHealthy() {
    try {
      const st = pool.listConnectionStatus();
      const want = churchRelays();
      if (!want.length) return true;                                  // nothing wanted → nothing to be unhealthy about
      for (const url of want) if (st.get(url) === true) return true;   // one live socket is enough to work
      return false;
    } catch (e) { return false; }
  },

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
  // Shared: Watch and Extras both want this list — one REQ, one download, both screens fed. See _shared().
  subscribeSermons(churchNpub, onSermons) {
    const cp0 = toPub(churchNpub); if (!cp0) { onSermons([]); return () => {}; }
    return _shared('sermons|' + cp0, (emit) => window.Fellowship._openSermons(cp0, emit))(onSermons);
  },
  _openSermons(churchNpub, onSermons) {
    const cp = toPub(churchNpub); if (!cp) { onSermons([]); return () => {}; }
    const byId = new Map();
    const emit = _coalesce(() => onSermons([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0))));
    const sub = pool.subscribeMany(relaysForChurch(cp), [{ kinds: [30078], authors: [cp], '#t': [NET] }], {
      onevent(e) {
        if (e.pubkey !== cp) return; const d = _dtag(e); if (!d.startsWith(SERMON_D)) return;
        try { const s = JSON.parse(e.content); if (s && s.sha256) { byId.set(d, { ...s, at: e.created_at }); emit(); } } catch {}
      },
      oneose() { emit(); },
    });
    return () => { emit.cancel(); try { sub.close(); } catch {} };   // cancel the queued emit: it would otherwise fire a tick after teardown
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
    // KEY RING: the church rotates its media key when a member is removed, so the envelope carries the current
    // key followed by the superseded ones — a sermon encrypted before the rotation must still play. A wrapped
    // value is a JSON array now; older envelopes hold a bare hex string, so accept both.
    let ring = [];
    try {
      const evs = await pool.querySync(relaysForChurch(cp), [{ kinds: [30078], authors: [cp], '#d': [MEDIAKEY_D + cp] }]);
      for (const e of (evs || [])) { if (e.pubkey !== cp) continue; try { const o = JSON.parse(e.content); const mine = o.keys && o.keys[pub]; if (mine) { const plain = nip44d(mine, nip44ck(sk, cp)); let r = null; try { const q = JSON.parse(plain); if (Array.isArray(q)) r = q.filter(k => typeof k === 'string' && k); } catch (e2) {} ring = (r && r.length) ? r : [plain]; } } catch {} }
    } catch {}
    if (!ring.length) return null;
    const keys = [];
    for (const kh of ring) { try { keys.push(await crypto.subtle.importKey('raw', _unhex(kh), 'AES-GCM', false, ['decrypt'])); } catch (e) {} }
    if (!keys.length) return null;
    // Try each key oldest-attempt-last: AES-GCM authenticates, so the wrong key throws rather than returning
    // garbage — which is exactly what makes "try them all" safe here.
    return async (bytes) => {
      const iv = bytes.slice(0, 12), ct = bytes.slice(12);
      let lastErr = null;
      for (const key of keys) { try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)); } catch (e) { lastErr = e; } }
      throw lastErr || new Error('media: no usable key');
    };
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

  // Community-PIN forensic hygiene: wipe the cached community CONTENT a locked phone should not be holding —
  // profiles, member rosters, group/category lists, doc + member hubs, chat-seen markers, family links, the
  // serving/rota caches and the care module's cached needs, slots, skips and settings. Called on lock and at
  // a locked boot. Bible/study/reading caches are deliberately untouched — the app must still work as an
  // offline Bible reader.
  //
  // AUDIT-2026-07-28 F8. This comment used to claim it wiped "every localStorage cache that would reveal
  // church membership", and that was not true in two ways. `trinityone.serv.*` (events, rotas, rosters,
  // RSVPs, replies, runsheets) and `trinityone.care.*` (needs, slots, skips — pastoral, sometimes medical)
  // survived it, each with the church's npub in the key NAME. Those are now wiped: every one of them
  // re-fetches from the relay after unlock, so nothing is lost by dropping them.
  //
  // WHAT DELIBERATELY REMAINS, stated plainly rather than claimed away: `trinityone.followedChurches` and
  // `trinityone.activeChurch`. They name the congregation, and a locked phone still gives that away. They are
  // kept because NOTHING rebuilds them on unlock — only a 12-word restore reconstructs the church list from
  // member: documents — so wiping them would strand a member with no way back into their own church. That is
  // a real limit on the hygiene claim, not an oversight, and ARCHITECTURE.md already says the PIN "is not
  // plausible deniability" for exactly this reason. Encrypting them at rest under the PIN is the fix that
  // would close it properly; it is not this change.
  clearCommunityCache() {
    const PREFIXES = ['trinityone.profile', 'trinityone.members.', 'trinityone.membercount.',
      'trinityone.docshub.', 'trinityone.memhub.', 'trinityone.groups.', 'trinityone.cats.',
      'trinityone.chatSeen', 'trinityone.family', 'trinityone.serv.', 'trinityone.care.'];
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && PREFIXES.some(p => k.startsWith(p))) kill.push(k); }
      kill.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      // drop in-memory caches too, so nothing repaints from RAM before the next fetch
      for (const k of Object.keys(profiles)) delete profiles[k];
      // AND the "have we asked the relay" set. Gating the fetch on _k0Seen instead of "is there an entry in
      // profiles" fixed the refetch churn — and quietly removed the self-healing the old gate had by
      // accident, because THIS function empties profiles. Without clearing it, a mid-session PIN lock left
      // every member permanently unfetchable: no kind-0 ever arrives again, so every face goes blank until
      // the app restarts. Worse, our own profile is filtered out too, so _recoverOwnProfile never runs, and
      // the next edit republishes a kind-0 with an EMPTY picture — destroying the member's photo on the
      // relay. Found by an adversarial review of my own work, 2026-07-28.
      _k0Seen.clear();
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
    try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { console.warn('[fellowship] membership publish failed', e); }
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
    try { await _publishAny(window.Fellowship.relays, evt); } catch {}
    return evt;
  },

  // live count of a church's members — matches the steward's rule: distinct people (not the church)
  // who posted (kind-1) or explicitly joined (member:<church>), minus those who left without posting.
  subscribeChurchMemberCount(churchNpub, cb) {
    const cp = toPub(churchNpub); if (!cp) { cb(0); return () => {}; }
    const cached = loadCountCache(cp);
    if (cached != null) cb(cached);   // show the last-known count instantly on load
    const hub = _memHub(cp);   // shared with subscribeChurchMembers — the kind-1 corpus is fetched ONCE
    // _superseded: a member who lost their words and was re-seated onto a new key must count ONCE, not twice
    const tally = () => { let n = 0; for (const v of hub.byPub.values()) if ((v.msgs > 0 || v.joined) && !_superseded(cp, v.pubkey)) n++; saveCountCache(cp, n); cb(n); };
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
      // _superseded drops the dead key of a member who was re-seated onto a new one, so the directory shows
      // the person once. Their new key is an ordinary member and appears on its own merits.
      const visible = [...hub.byPub.values()].filter(m => !m.hidden && (m.joined || m.msgs > 0) && !_superseded(cp, m.pubkey)).sort((a, b) => (b.lastTs || b.joined || 0) - (a.lastTs || a.joined || 0));
      if (!hub.eosed && !done && !visible.length) return;   // sticky: hold last-known until EOSE
      saveMembersCache(cp, [...hub.byPub.values()]);   // keep the legacy cache warm for next launch
      onMembers(visible, !!done);
    };
    // (re)open the single profile sub for every still-unnamed member. churchRelays() — NOT
    // window.Fellowship.relays, which is empty on a native install. Kept open so a slow relay isn't cut off.
    const refreshProfiles = () => {
      profTimer = null;
      // "resolved" means we have ASKED, not "we got a name". Since Stage 2 no member's kind-0 carries a name,
      // so filtering on the name meant every member of the church qualified on every pass, for ever. The same
      // defect as requestProfiles/_flushProfiles — this is the member hub's own copy of that logic, and it is
      // the path the roster actually uses. AUDIT-2026-07-27.
      const authors = [...profAuthors].filter(pk => !(pk in profiles));
      if (!authors.length) return;
      try { profSub && profSub.close(); } catch {}   // replace the old one — never accumulate subscriptions
      profSub = pool.subscribeMany(churchRelays(), [{ kinds: [0], authors }], {
        // MERGE, and never let an empty name win. A kind-0 carries no name since Stage 2, and this overwrote
        // the whole cached entry AND the roster row — so a profile arriving after _openSealedName had resolved
        // someone flipped them straight back to Anonymous. Worse than the sibling in _flushProfiles, because
        // this is the roster the member app actually renders.
        onevent(e) { try { const meta = JSON.parse(e.content); const had = profiles[e.pubkey] || {}; const nm = meta.name || meta.display_name || had.name || ''; profiles[e.pubkey] = { ...had, name: nm, picture: meta.picture || '', about: meta.about || '', nip05: meta.nip05 || '', hidden: !!meta.hidden, av: meta.av || undefined }; saveProfiles(); const m = hub.byPub.get(e.pubkey); if (m) { if (nm) m.name = nm; m.picture = profiles[e.pubkey].picture; m.nip05 = profiles[e.pubkey].nip05; m.hidden = !!meta.hidden; hub.dirty = true; _memHubSaveSoon(hub); } emit(); } catch {} },
        oneose() {},
      });
    };
    const ensureProfile = (pk) => {
      if (profAuthors.has(pk) || (pk in profiles)) return;
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

  // Resolve a church's memorable relay NAME to the relay's CURRENT wss:// url, via the shared directory.
  //
  // This is the way back for a member whose church runs its OWN relay: a fresh install only knows the shared
  // relays, so their 12 words restore the identity and find no church — through no fault of the words. A name
  // is stable across restarts where a tunnel URL is not, which is the whole reason the directory exists.
  //
  // L5: only ever adopt a wss:// url. A cleartext ws:// would put the whole church's fellowship traffic in the
  // open, and this input comes from a stranger's directory entry.
  async resolveRelayName(name) {
    const h = String(name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!h) return null;
    for (const u of CANONICAL_RELAYS) {
      const base = u.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://').replace(/\/relay\/?$/i, '');
      try {
        // Promise.race, not just an AbortController: CapacitorHttp patches fetch on native and may ignore the
        // signal, so the race is what actually bounds a hung lookup on a phone.
        const ctrl = new AbortController();
        const to = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 6000);
        const r = await Promise.race([
          fetch(base + '/relay-names/resolve/' + encodeURIComponent(h), { cache: 'no-store', signal: ctrl.signal }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6500)),
        ]);
        clearTimeout(to);
        if (!r || !r.ok) continue;
        const j = await r.json();
        if (j && typeof j.url === 'string' && /^wss:\/\//i.test(j.url)) return { handle: h, url: j.url, pub: j.pub || '' };
      } catch (e) {}
    }
    return null;
  },

  // RESTORE: find what this identity already IS, from the relay.
  //
  // Until now nothing ever asked the relay for the member's OWN documents — the only authors:[pub] queries in
  // this file are DMs and the wallet. So even after re-deriving the right key from the 12 words, a member came
  // back with no churches and no name, because both were only ever kept in this device's localStorage. The data
  // was always published (announceMembership writes member:<cp>, publishProfile writes kind-0); nobody read it.
  //
  // Returns { churches: [hexpub], name } — churches are the ones this key has announced membership of, newest
  // first. Read-only: the caller decides what to do with them.
  toNpub(hex) { try { return npubEncode(hex); } catch (e) { return hex; } },   // hex -> npub, for the restore flow
  // UNVERIFIED (2026-07-26): the church half of this is NOT proven end-to-end. Driving it against a real relay
  // recovered the NAME (kind-0 is public) but zero churches, because a member's own kind-30078 docs are
  // read-gated — canRead grants them via `authed === e.pubkey`, i.e. only over a NIP-42-authenticated socket.
  // The harness read anonymously. In the app the key exists by this point (importMnemonic ran first) so the
  // pool should answer the challenge and the docs should arrive — but "should" is exactly the word that has
  // been wrong repeatedly today. Verify on a device with a real church before relying on it. If it turns out
  // the socket is not authenticated here, the fix is to force an auth round-trip before this read.
  async recoverIdentity(ms) {
    if (!sk) { try { await window.Fellowship.ready; } catch (e) {} }
    const me = pub;
    if (!me) return { churches: [], name: '' };
    const fold = _restoreFold();
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { sub.close(); } catch (e) {} resolve(); };
      const sub = pool.subscribeMany(churchRelays(), [
        { kinds: [30078], authors: [me] },   // every doc this key has written; we filter for member:<cp> below
        { kinds: [0], authors: [me] },       // the display name
      ], { onevent: fold.add, oneose: finish });
      setTimeout(finish, Math.max(2000, ms || 9000));   // a thin pipe must still finish, just with less
    });
    return fold.result();
  },

  // The one above is a single pass, and on a cold connection that is not enough — CONFIRMED on device: the
  // member's NAME came back (kind-0 is public) while their churches did not, because their own member: docs
  // are gated and the relay only serves them over a NIP-42-authenticated socket. Auth here is LAZY: the relay
  // challenges when a gated read is withheld, pool.automaticallyAuth signs it, and _armAuthRefetch re-runs the
  // church-doc subscriptions — but nothing re-runs a one-off query like ours, so the first pass is answered
  // with an empty EOSE and we conclude the member belongs to nothing.
  //
  // So: ask again. The second pass rides the connection the first pass just caused to authenticate. This is
  // why a restored member could see a message notification arrive from a church the app insisted they were not
  // in — the relay knew, the app had simply asked before it had proved who it was.
  async recoverIdentityRetry(tries, gap) {
    const n = Math.max(1, tries || 3);
    let best = { churches: [], name: '' };
    for (let i = 0; i < n; i++) {
      let r = { churches: [], name: '' };
      try { r = await window.Fellowship.recoverIdentity(i === 0 ? 7000 : 5000); } catch (e) {}
      if (r.name && !best.name) best.name = r.name;
      if (r.churches.length) { best.churches = r.churches; break; }   // gated docs arrived → done
      if (i < n - 1) await new Promise(res => setTimeout(res, gap || 2500));
    }
    return best;
  },

  // Seal MY display name for one church under its congregation key. This is what replaces putting the name in
  // a public profile: the relay stores ciphertext, and only people the church wrapped a key for can read it.
  // Silently does nothing when the church has not published a key yet (an older church, or before setup
  // finishes) — the caller still writes kind-0, so the name is never simply lost. AUDIT-2026-07-27.
  async publishSealedName(churchNpub, name) {
    const cp = toPub(churchNpub); if (!cp) return null;
    if (!sk) { try { await window.Fellowship.ready; } catch (e) {} }
    const ring = _nameKeys.get(cp) || [];
    if (!sk) return null;
    const nm = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const payload = _sealNameDoc(cp, nm, ring[0]);
    if (!payload) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'trinityone/name:' + cp], ['t', NET], ['church', cp]], content: payload }, sk);
    try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { return null; }
    _sealedNames.set(cp + '|' + pub, nm);
    _sealedMine.set(cp, nm + '|' + _ringId(cp));
    return evt;
  },
  // ONE NAME, FANNED OUT. A member belongs to one or more churches, and their name is theirs — not a different
  // name per church they have to remember to keep in step. The wire still carries a SEPARATE sealed copy per
  // church, deliberately: church A cannot read church B's copy, so two churches (or two mirror operators)
  // cannot match the same person up by comparing name ciphertext. One shared blob would hand them exactly that.
  // So the split stays on the wire and disappears in the app — set your name once, and it is re-sealed
  // everywhere you belong, including churches you join later and churches whose key arrives later.
  async syncSealedNames(churchNpubs) {
    const nm = ((window.Fellowship.myProfile || {}).name || '').trim();
    if (!nm) return 0;
    // EVERY church we are connected to, not just the ones that have handed us a congregation key. A member
    // awaiting approval has no such key BY DESIGN — giving them one would open the whole roster before they
    // are admitted — so keying the list on _nameKeys skipped exactly the people whose names a steward needs
    // most: the ones asking to join. publishSealedName already handles this, sealing to the CHURCH key
    // instead, and that fallback was unreachable because this caller never let it run.
    // Reported 2026-07-28: a phone joined as "Testi Bob" and showed on the console as Anon. Confirmed
    // against the relay — 19 members had a join document and only 18 had a name.
    const list = (churchNpubs && churchNpubs.length) ? churchNpubs : [...new Set([..._nameKeys.keys(), ..._docsHubs.keys()])];
    let n = 0;
    for (const c of list) {
      const cp = toPub(c) || c;
      if (!cp) continue;
      // A MISSING RING IS NOT THE SAME AS BEING PENDING. Dropping the old ring check let a pending member
      // publish (right), and also let an ADMITTED member republish while the ring was transiently empty —
      // a locked boot, or a warm buffer where the key had not been ingested yet. That fell through to the
      // church-key branch and replaced their good congregation-sealed name with one only the owner can read,
      // making them Anonymous to their whole congregation. Wait until the church's docs hub has actually
      // answered before concluding we have no key. AUDIT-2026-07-28.
      const ring = _nameKeys.get(cp) || [];
      if (!ring.length) {
        const hub = _docsHubs.get(cp);
        // AUDIT-2026-07-28 F12. `hub.eosed` alone is NOT evidence the church has no name key. The namekey
        // document is served only to an authenticated reader, and this hub routinely EOSEs BEFORE the NIP-42
        // round-trip lands on a fresh boot — the comment on pool.automaticallyAuth says so explicitly. So an
        // unauthenticated read and a genuinely keyless church are byte-identical, and taking the church-key
        // branch on that made an ADMITTED member Anonymous to their whole congregation. Exactly the rule the
        // same commit applied correctly to the clearance back-fill, three functions away, and not here.
        // eosedAt vs _relayAuthedAt, not booleans: hub.eosed is set once and never reset, so it survives the
        // post-auth refetch and a boolean would still be satisfied by the stale pre-auth answer.
        if (!hub || !hub.eosedAt || !_relayAuthedAt || hub.eosedAt < _relayAuthedAt) continue;
      }
      const stamp = nm + '|' + _ringId(cp);
      if (_sealedMine.get(cp) === stamp) continue;              // same name AND same key — nothing to redo
      try { if (await window.Fellowship.publishSealedName(cp, nm)) { _sealedMine.set(cp, stamp); n++; } } catch (e) {}
    }
    return n;
  },
  // Has this church published a name key we hold a copy of? NO UI CALLS THIS YET — the comment here used to
  // claim "the UI uses it to explain why a name is public", which was never true. Left in place because Stage 2
  // (dropping the cleartext name from kind-0) needs exactly this to tell a member whether their name is sealed
  // or still public, but until that screen exists this is an unused accessor and should be described as one.
  sealedNamesReady(churchNpub) { const cp = toPub(churchNpub); return !!(cp && (_nameKeys.get(cp) || []).length); },
  // publish this user's kind-0 profile (display name etc.) and cache it
  async setProfile(meta) {
    if (!sk) await window.Fellowship.ready;
    // NEVER PUBLISH OVER A PROFILE WE HAVE NOT READ. kind-0 is REPLACEABLE, and `prev` is our local cache —
    // empty on a restored or wiped phone. So a name-only patch (which is exactly what every restore does)
    // computed picture:'' and about:'' and published that over the member's real profile, destroying their
    // photo and clearing their directory opt-out on the relay. The 12-word restore used to be safe from this
    // only by accident: it called a function that did not exist, threw, and never reached here — fixing that
    // ReferenceError opened this.
    //
    // AUDIT-2026-07-28 F1. The first version of this guard DID NOT REFUSE. It waited six seconds and then
    // fell through and published the blank patch anyway — a wait that reads as protection and is not one,
    // and on the connections this product is built for, "the wait elapsed" is the ordinary path, not the
    // edge case. It was also skipped entirely once a name was known, because it required `profiles[pub]` to
    // be EMPTY: _recoverOwnName writes a name-only entry, so after a restore — the exact case it was written
    // for — the guard was false and the blank publish went straight out with no wait at all.
    //
    // Gate on the one fact that matters: has the relay ANSWERED about our own kind-0? _k0Seen is set both by
    // a kind-0 arriving and by EOSE, so "there is no profile yet" is an answer — which is what lets a
    // brand-new member through. (The console's publishProfile refused that case for a while and churches were
    // created nameless; this is the same mistake seen from the other side.)
    let known = !pub || _k0Seen.has(pub);
    if (!known) {
      try {
        window.Fellowship.requestProfiles([pub]);
        const t0 = Date.now();
        while (!_k0Seen.has(pub) && Date.now() - t0 < 6000) await new Promise(r => setTimeout(r, 150));
      } catch (e) {}
      known = _k0Seen.has(pub);
    }
    const prev = profiles[pub] || {};
    const p = {
      name: (meta.name != null ? meta.name : (prev.name || '')).trim(),
      about: (meta.about != null ? meta.about : (prev.about || '')).trim(),
      picture: (meta.picture != null ? meta.picture : (prev.picture || '')).trim(),
    };
    if (meta.av || prev.av) p.av = meta.av || prev.av;   // chosen symbol/monogram avatar
    const hidden = (meta.hidden != null ? meta.hidden : prev.hidden);   // opt out of the member directory
    if (hidden) p.hidden = true;
    // NO AUTO-CLAIMED HANDLE FOR A MEMBER. This used to derive <name>@<relay-host> from the display name and
    // store it IN THE PROFILE, which meant the member's name travelled in a second field — so encrypting the
    // name would have protected one copy while publishing another, and the relay's /.well-known lookup turned
    // that handle into a name→identity oracle for anyone who could guess it. A church still claims a handle
    // (steward.src.js); a MEMBER does not need one, and it is the wrong thing to give a congregation whose
    // safety depends on not being enumerable. An existing handle is carried forward rather than stripped, so
    // nobody's verified name silently disappears — Stage 2 tombstones those deliberately. AUDIT-2026-07-27.
    // STAGE 2. A member's NAME no longer travels in kind-0. Stage 1 sealed it to the congregation and left the
    // cleartext copy sitting next to it, so the relay still held a named roster and the gate was only about who
    // was allowed to read it — one misconfigured relay, one mirror, one seized disk and the congregation is a
    // list of names again. The name now lives ONLY in the per-church sealed `name:` document and in this
    // device's own storage. Everything on screen still resolves it, because _openSealedName writes the opened
    // name into the same profiles map every screen already reads.
    // The carried-forward nip05 goes with it: a handle is <name>@<host>, so keeping it would publish the name
    // in a second field and make the whole exercise pointless. AUDIT-2026-07-27.
    // IDEMPOTENCE. This used to build a fresh kind-0 with a new created_at and publish it on EVERY call, with no
    // comparison against what it had already sent — so any caller that ran on a timer became a broadcast station.
    // Measured: 12 profile republishes a minute from the restore-recovery loop, each one delivered to every
    // member of the church on their batched {kinds:[0],authors:[…]} subscription, and to the steward console.
    // AUDIT-2026-07-26 CRITICAL 4. Re-sending an identical profile tells nobody anything, so it is now a no-op;
    // any real edit differs and still goes out. Scoped to this session (and only recorded after a publish that
    // did not throw), so a relay that lost the doc is still re-served on the next launch or the next real edit.
    // What we PUBLISH is deliberately narrower than what we keep. `p` stays whole for this device (and for the
    // seal); the wire copy carries no name and no handle.
    const wire = { about: p.about, picture: p.picture };
    if (p.av) wire.av = p.av;
    if (p.hidden) wire.hidden = true;
    const body = JSON.stringify(wire);
    if (_profilePubFor === pub && _profilePubBody === body) return null;
    // REFUSE THE WIRE COPY — not the whole call. Since Stage 2 the NAME does not travel in kind-0 at all: it
    // goes out sealed, through syncSealedNames below. So refusing outright to protect kind-0 would leave a
    // member on a slow link unable to tell their congregation what they are called, which is the one thing
    // they set — a worse failure than the one being fixed, and aimed at exactly the same people. Everything
    // local still happens; only the replaceable publish is withheld.
    let evt = null, sent = false;
    if (known) {
      evt = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: body }, sk);
      sent = true;
      try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { sent = false; console.warn('[fellowship] profile publish failed', e); }
    } else {
      // A silent refusal is the console's publishProfile bug in a new place: the sheet closes, the change
      // never reached the network, and nothing said so. Only speak up about a field that actually travels in
      // kind-0 — a name-only save has lost nothing, so saying "not saved" about it would be a lie.
      console.warn('[fellowship] profile publish withheld — our own kind-0 has not arrived, publishing now would blank it');
      if (['about', 'picture', 'av', 'hidden'].some(k => meta && meta[k] != null)) {
        try { if (window.trinityToast) window.trinityToast('Your photo and profile details aren’t saved yet — this phone is still connecting to your church’s relay. Try again in a moment.'); } catch (x) {}
      }
    }
    if (sent) { _profilePubFor = pub; _profilePubBody = body; }
    profiles[pub] = p; window.Fellowship.myProfile = p;
    // the name changed → re-seal it in every church we belong to, so the copies can never drift apart
    if (p.name) setTimeout(() => { try { window.Fellowship.syncSealedNames(); } catch (x) {} }, 0);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {}
    window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: pub } }));
    return evt;
  },

  // fetch kind-0 for pubkeys we haven't resolved yet; fires 'trinity-profiles' on arrival
  requestProfiles(pubkeys) {
    // Refetch only what we have NEVER resolved. This used to refetch anything cached without a name, which was
    // reasonable while names lived in kind-0 — but since Stage 2 no member's kind-0 has one, so every member of
    // the church qualified in every 250 ms batch window, for ever: a permanent re-subscribe churn that would
    // look like a network problem and never be traced back to here. A member who later picks a name republishes
    // their sealed `name:` doc, which arrives on the docs hub, so nothing depends on re-asking. AUDIT-2026-07-27.
    const need = [...new Set(pubkeys)].filter(pk => pk && !pendingProfiles.has(pk) && !_k0Seen.has(pk));
    if (!need.length) return;
    need.forEach(pk => { pendingProfiles.add(pk); _profQueue.add(pk); });
    if (!_profTimer) _profTimer = setTimeout(_flushProfiles, 250);   // fixed window (don't reset) so a steady stream still flushes promptly
  },

  // publish a message to a group (kind 1, tagged with the network + group ids)
  async publishMessage(groupId, content, extraTags = []) {
    if (!sk) await window.Fellowship.ready;
    const churchTag = window.Fellowship.churchPub ? [['p', window.Fellowship.churchPub]] : [];
    let body = content, encTag = [];
    const gkey = (_gkeys[_gkKey(window.Fellowship.churchPub, groupId)] || [])[0];   // encrypted group → seal under THIS church's CURRENT key, i.e. ring[0] (H5)
    if (gkey) { try { body = nip44e(content, gkey); encTag = [['enc', '1']]; } catch (e) {} }
    const evt = finalizeEvent({
      kind: 1, created_at: Math.floor(Date.now() / 1000),
      tags: [['t', NET], ['t', groupId], ...churchTag, ...encTag, ...extraTags], content: body,
    }, sk);
    // UX-AUDIT-2026-07-20 E1: this swallowed the failure to a console.warn and returned the event anyway, so
    // the UI could not tell a delivered message from a lost one — the composer cleared, no bubble appeared,
    // and a prayer request typed on a bad connection was simply gone with no error. Reading is genuinely
    // offline-first; writing was not. `_delivered` lets the caller keep the member's words when we couldn't
    // send them. (A persisted outbox with retry is the fuller fix; this closes the silent-loss hole.)
    // E1: queue FIRST, then attempt delivery. If the attempt fails the message stays queued and is retried
    // on the next reconnect, online event or tick — so it eventually arrives instead of being lost. The UI
    // renders queued items as pending bubbles (outboxFor), and the relay's echo removes them by id.
    _outbox.push({ evt, groupId, at: Math.floor(Date.now() / 1000), tries: 0, relays: [...(window.Fellowship.relays || [])] });
    _outboxSave();
    try {
      // _publishBounded, not raw Promise.any: a socket that never opens leaves Promise.any pending forever,
      // so offline the await never settled — `_delivered` was never set false and the "No signal, we'll send
      // it when you're back" toast never fired in exactly the offline case it's for. Bounded → the signal
      // always arrives within 12s; the message is already queued above, so the 45s flush is the retry path.
      await _publishBounded(window.Fellowship.relays, evt);
      evt._delivered = true;
      _outbox = _outbox.filter(o => o.evt.id !== evt.id); _outboxSave();
    } catch (e) {
      console.warn('[fellowship] publish failed — queued for retry', e);
      evt._delivered = false;   // still queued; the composer no longer needs to hand the words back
    }
    return evt;
  },
  // the queue, for the UI: pending messages for one group (oldest first), and a change subscription
  outboxFor(groupId) { return [
    ..._outbox.filter(o => o.groupId === groupId).map(o => ({ ...o.evt, _pending: true, _tries: o.tries || 0 })),
    ..._outboxFailed.filter(o => o.groupId === groupId).map(o => ({ ...o.evt, _failed: true, _reason: o.lastError || '' })),
  ]; },
  outboxCount() { return _outbox.length; },
  onOutbox(fn) { _outboxSubs.add(fn); return () => _outboxSubs.delete(fn); },
  flushOutbox() { return _outboxFlush(); },
  // give up on one queued message (the member chose to discard it)
  dropQueued(id) { _outbox = _outbox.filter(o => o.evt.id !== id); _outboxFailed = _outboxFailed.filter(o => o.evt.id !== id); _outboxSave(); },
  // retry something we gave up on, at the member's request
  requeue(id) { const f = _outboxFailed.find(o => o.evt.id === id); if (!f) return false; _outboxFailed = _outboxFailed.filter(o => o.evt.id !== id); f.tries = 0; f.failed = false; _outbox.push(f); _outboxSave(); _outboxFlush(); return true; },

  // ── direct messages (1:1, encrypted) ──
  // NIP-04 encrypted kind-4: the content is private to the two parties; the relay sees only that two
  // pubkeys are talking (full metadata privacy = NIP-17, a later/Stage-6 upgrade). Peer = a hex pubkey.
  async sendDM(peerPub, content) {
    if (!sk) await window.Fellowship.ready;
    let ciphertext; try { ciphertext = _dmEncrypt(sk, peerPub, content); } catch (e) { console.warn('[fellowship] DM encrypt failed', e); return null; }
    const evt = finalizeEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', peerPub]], content: ciphertext }, sk);
    try { await _publishBounded(window.Fellowship.relays, evt); evt._delivered = true; }   // bounded so offline sets _delivered=false within 12s, not never
    catch (e) { console.warn('[fellowship] DM publish failed', e); evt._delivered = false; }   // E1: same as publishMessage — the caller must be able to tell
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
    try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { console.warn('[fellowship] reactDM failed', e); }
    return evt;
  },
  // inbox: every DM involving me, grouped by peer; onConvos([{ peer, lastTs, preview }]). Unsub fn.
  subscribeDMs(onConvos) {
    if (!pub) { onConvos([]); return () => {}; }
    const byPeer = new Map();
    const emit = _coalesce(() => onConvos([...byPeer.values()].sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0))));
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
    return () => { emit.cancel(); try { sub.close(); } catch {} };   // cancel the queued emit: it would otherwise fire a tick after teardown
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
    try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { console.warn('[fellowship] react failed', e); }
    return evt;
  },

  // live reactions in a group; onReaction({ targetId, pubkey, content, ts })
  subscribeReactions(groupId, onReaction) {
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [7], '#t': [groupId], limit: 400 }], {
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
    try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { console.warn('[fellowship] deleteOwnMessage failed', e); return null; }
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
  // PERF (audit 2026-07-24): this asked for `{kinds:[30078], '#p':[cp]}` — EVERY member-authored doc in the
  // church (joins, RSVPs, serving replies, unavailability, pins) with no limit and no cursor — to learn which
  // message ids a steward had hidden, and it runs on every chat-room open. In an established church that is
  // thousands of docs, megabytes over a 2G link, per room, per open. hideMessage() tags the group it belongs
  // to, and this only ever runs inside one room, so ask for that group's docs instead.
  // Caveat: a legacy hide published before the ['t',gid] tag existed is no longer matched — hiding is rare and
  // re-hiding is one tap, which is a fair trade for not re-downloading the church on every room open.
  subscribeHidden(groupId, cb) {
    const cp = window.Fellowship.churchPub;
    if (!cp || !groupId) { cb(new Set()); return () => {}; }
    const HIDE_D = 'trinityone/hidden:'; const hidden = new Map();   // msgId -> hidden? (latest wins)
    const emit = _coalesce(() => cb(new Set([...hidden.entries()].filter(([, h]) => h).map(([id]) => id))));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], '#t': [groupId] }], {
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
    return () => { emit.cancel(); try { sub.close(); } catch {} };   // cancel the queued emit: it would otherwise fire a tick after teardown
  },
  // ── moderation actions a GROUP LEADER may take (signed by me, scoped to the group, p-tagged to the
  // church). The relay only accepts these from the group's leaders (or the church), like group events. ──
  async pinPost(churchNpub, groupId, msg) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !groupId || !msg || !msg.id) return null;
    const content = JSON.stringify({ msgId: msg.id, text: msg.text || '', by: msg.pubkey || msg.by || '', ts: msg._ts || msg.ts || Math.floor(Date.now() / 1000) });
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/pin:' + groupId], ['t', NET], ['t', groupId], ['p', cp]], content }, sk);
    try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { console.warn('[fellowship] pinPost failed', e); return null; }
    return evt;
  },
  async unpin(churchNpub, groupId) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !groupId) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/pin:' + groupId], ['t', NET], ['t', groupId], ['p', cp], ['deleted', '1']], content: '' }, sk);
    try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { console.warn('[fellowship] unpin failed', e); return null; }
    return evt;
  },
  async hideMessage(churchNpub, groupId, msgId) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !msgId) return null;
    const tags = [['d', 'trinityone/hidden:' + msgId], ['t', NET], ['p', cp]];
    if (groupId) tags.push(['t', groupId]);
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags, content: JSON.stringify({ groupId: groupId || '' }) }, sk);
    try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { console.warn('[fellowship] hideMessage failed', e); return null; }
    return evt;
  },
  async unhideMessage(churchNpub, groupId, msgId) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !msgId) return null;
    const tags = [['d', 'trinityone/hidden:' + msgId], ['t', NET], ['p', cp], ['deleted', '1']];
    if (groupId) tags.push(['t', groupId]);
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, sk);
    try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { console.warn('[fellowship] unhideMessage failed', e); return null; }
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
    const emit = _coalesce(() => { const v = [...byId.values()].filter(g => _churchVoice(pubk, g)); if (!eosed && !v.length) return; saveDocCache('groups', pubk, v); onGroups(v.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0))); });
    if (byId.size) emit();   // paint cached groups before the shared hub replays/answers
    return _onChurchDocs(pubk, {
      emit,   // so the hub can cancel a queued emit when this handler tears down
      want: [GROUP_D],   // replay only this slice of the hub (see _hubBufSet)
      onevent(e, d) {   // (the hub absorbs the steward roster + group-key envelopes centrally)
        if (!d.startsWith(GROUP_D)) return;
        const id = d.slice(GROUP_D.length);
        // AUDIT-2026-07-24 (groups): A tombstone is only honoured from an author who could have written the doc in the first place. kind-30078 is per-author, so a stranger's delete never replaces the original on the relay — but keying purely on the d-tag meant honouring it here HID the real one from this member, and the blanked list was then persisted to localStorage. Fixed for care needs in b15c146; same everywhere.
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { if (_churchVoice(pubk, { _by: e.pubkey })) { byId.delete(id); emit(); } return; }
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
    const emit = _coalesce(() => { const v = [...byId.values()].filter(c => _churchVoice(pubk, c)); if (!eosed && !v.length) return; saveDocCache('categories', pubk, v); onCats(v.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0))); });
    if (byId.size) emit();   // paint cached categories before the shared hub replays/answers
    return _onChurchDocs(pubk, {
      emit,   // so the hub can cancel a queued emit when this handler tears down
      want: [CATEGORY_D],   // replay only this slice of the hub (see _hubBufSet)
      onevent(e, d) {
        if (!d.startsWith(CATEGORY_D)) return;
        const id = d.slice(CATEGORY_D.length);
        // AUDIT-2026-07-24 (categories): A tombstone is only honoured from an author who could have written the doc in the first place. kind-30078 is per-author, so a stranger's delete never replaces the original on the relay — but keying purely on the d-tag meant honouring it here HID the real one from this member, and the blanked list was then persisted to localStorage. Fixed for care needs in b15c146; same everywhere.
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { if (_churchVoice(pubk, { _by: e.pubkey })) { byId.delete(id); emit(); } return; }
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
    const _sgTs = { minors: 0, approved: 0, guardians: 0, nophoto: 0 };   // newest-wins, one clock per document
    // MY OWN CLEARANCE (AUDIT-2026-07-27). The relay no longer serves `minors:` to ordinary members — it was a
    // cleartext list of a congregation's children, and joining an open-join church is one self-signed publish.
    // So `minors` arrives EMPTY for everyone except stewards, and `isMinor` can no longer be derived from it.
    // The church seals each member a `clearance:<pub>` doc instead, saying only what that member needs to know
    // about themselves. Fall back to the list when we do have it (stewards, and older churches that have not
    // published clearances yet), so this degrades rather than breaks.
    let clr = null;   // { minor, cleared } from my own sealed doc, or null if none has arrived
    let _clrTs = 0;
    const emit = () => {
      _noPhoto = new Set(nophoto);
      const isMinor = clr ? !!clr.minor : !!(me && minors.includes(me));
      const cleared = clr ? !!clr.cleared : !!(me && approved.includes(me));
      onLists({ minors, approved, guardians, nophoto, isMinor, cleared, clearanceKnown: !!clr, photoBlocked: !!(me && nophoto.includes(me)) });
    };
    return _onChurchDocs(pubk, {
      onevent(e, d) {
        // safeguarding lists are OWNER-ONLY — only ever trust the church key (M2/safeguarding). A member's own
        // sealed clearance may also come from a CURRENT roster steward, which is who marks a child in practice.
        if (e.pubkey !== pubk && !(_churchRoster.get(pubk) && _churchRoster.get(pubk).has(e.pubkey))) return;
        if (e.pubkey !== pubk && !(d || '').startsWith('trinityone/clearance:')) return;
        // NEWEST-WINS (audit 2026-07-24). These are single replaceable documents read from EVERY relay at once,
        // and each assignment took whichever copy ARRIVED last. With two relays that is a race: a lagging relay
        // answering second reinstates an older list — and for safeguarding that means a child stops being
        // treated as a child in this app, or a cleared adult loses clearance. The console has had this guard
        // (with a note on exactly why safeguarding is the worst place to let a stale copy win); the member side
        // never got it. One timestamp PER DOCUMENT, so a fresh minors list can't suppress a current approved one.
        const _ts = e.created_at || 0;
        if (d === 'trinityone/minors:' + pubk) { if (_ts < _sgTs.minors) return; _sgTs.minors = _ts; try { minors = (JSON.parse(e.content).pubkeys) || []; } catch { minors = []; } emit(); }
        else if (d === 'trinityone/approved:' + pubk) { if (_ts < _sgTs.approved) return; _sgTs.approved = _ts; try { approved = (JSON.parse(e.content).pubkeys) || []; } catch { approved = []; } emit(); }
        else if (d === 'trinityone/guardians:' + pubk) { if (_ts < _sgTs.guardians) return; _sgTs.guardians = _ts; try { guardians = (JSON.parse(e.content).links) || {}; } catch { guardians = {}; } emit(); }
        else if (d === 'trinityone/nophoto:' + pubk) { if (_ts < _sgTs.nophoto) return; _sgTs.nophoto = _ts; try { nophoto = (JSON.parse(e.content).pubkeys) || []; } catch { nophoto = []; } emit(); }
        else if (me && d === 'trinityone/clearance:' + me) {
          if (_ts < _clrTs) return; _clrTs = _ts;
          try { clr = JSON.parse(nip44d(e.content, nip44ck(sk, e.pubkey))); } catch (x) { return; }   // sealed to me by the church
          emit();
        }
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
    // The child's kind-0 profile. NO auto-claimed handle — this mirrored publishProfile, and it is the most
    // sensitive instance of that bug: it published a CHILD's name as a guessable lookup handle on the church's
    // relay, so anyone could ask "is there a <child's name> here?" and be handed their identity. The parent
    // path was fixed in the same pass; this is the sibling call site it would have been easy to miss.
    // AUDIT-2026-07-27.
    // STAGE 2, and this is the instance that matters most: a CHILD's name in a world-shaped cleartext profile.
    // It is sealed like any other member's now. The child has no congregation key yet (the church wraps one for
    // them once the roster picks them up), so this first copy is sealed to the CHURCH key — the same path a
    // member awaiting approval uses — and is re-sealed to the congregation key when one arrives.
    const childProfile = {};
    const k0 = finalizeEvent({ kind: 0, created_at: ts, tags: [], content: JSON.stringify(childProfile) }, childSk);
    let childNameDoc = null;
    try {
      const body = JSON.stringify({ name });
      const ct = nip44e(body, nip44ck(childSk, cp));            // the church's copy, so a steward sees who this is
      const own = nip44e(body, nip44ck(childSk, childPub));     // the child's own recovery copy, same shape as everyone's
      childNameDoc = finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/name:' + cp], ['t', NET], ['church', cp]], content: JSON.stringify({ c: ct, m: own }) }, childSk);
    } catch (e) {}
    const join = finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/member:' + cp], ['t', NET], ['p', cp]], content: JSON.stringify({ joined: ts }) }, childSk);
    // the parent's guardian-link REQUEST (signed by the parent) — the steward confirms it
    // NO NAMES IN THE REQUEST. This carried the child's name AND the parent's, in cleartext, in a document any
    // effective member of the church could read — a worse leak than the kind-0 it sat beside, and it survived
    // Stage 1 untouched. Nothing needed them: the console records them as `claimed…` and the card deliberately
    // renders the name IT resolved from the roster instead, precisely because a requester-supplied name is
    // forgeable (SECURITY-AUDIT-2026-07-20 C1). So they are simply gone. AUDIT-2026-07-27.
    const req = finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/guardreq:' + childPub], ['t', NET], ['p', cp], ['p', childPub]], content: JSON.stringify({ child: childPub, parent: pub }) }, sk);
    // join BEFORE the sealed name: the relay only accepts a name document from someone it already knows is a
    // member of that church, so the reverse order would have the name silently refused.
    for (const e of [k0, join, childNameDoc, req]) { if (!e) continue; try { await _publishAny(window.Fellowship.relays, e); } catch (err) { console.warn('[fellowship] child setup publish failed', err); } }
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
      want: [PLAN_D],   // replay only this slice of the hub (see _hubBufSet)
      onevent(e, d) {
        if (!d.startsWith(PLAN_D)) return;
        const id = d.slice(PLAN_D.length);
        // AUDIT-2026-07-24 (plans): A tombstone is only honoured from an author who could have written the doc in the first place. kind-30078 is per-author, so a stranger's delete never replaces the original on the relay — but keying purely on the d-tag meant honouring it here HID the real one from this member, and the blanked list was then persisted to localStorage. Fixed for care needs in b15c146; same everywhere.
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { if (_churchVoice(pubk, { _by: e.pubkey })) { byId.delete(id); emit(); } return; }
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
      want: [DEVO_D],   // replay only this slice of the hub (see _hubBufSet)
      onevent(e, d) {
        if (!d.startsWith(DEVO_D)) return;
        const id = d.slice(DEVO_D.length);
        // AUDIT-2026-07-24 (devotionals): A tombstone is only honoured from an author who could have written the doc in the first place. kind-30078 is per-author, so a stranger's delete never replaces the original on the relay — but keying purely on the d-tag meant honouring it here HID the real one from this member, and the blanked list was then persisted to localStorage. Fixed for care needs in b15c146; same everywhere.
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { if (_churchVoice(pubk, { _by: e.pubkey })) { byId.delete(id); emit(); } return; }
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
    const emit = _coalesce(() => { const v = [...byId.values()].filter(x => _churchVoice(pubk, x)).sort((a, b) => (b.ts || 0) - (a.ts || 0)); if (!eosed && !v.length) return; onItems(v); });   // roster-trust (M2)
    return _onChurchDocs(pubk, {
      emit,   // so the hub can cancel a queued emit when this handler tears down
      want: [prefix],   // replay only this slice of the hub (see _hubBufSet)
      onevent(e, d) {
        if (!d.startsWith(prefix)) return;
        const id = d.slice(prefix.length);
        // AUDIT-2026-07-24 (services/rotas/rosters/rooms): A tombstone is only honoured from an author who could have written the doc in the first place. kind-30078 is per-author, so a stranger's delete never replaces the original on the relay — but keying purely on the d-tag meant honouring it here HID the real one from this member, and the blanked list was then persisted to localStorage. Fixed for care needs in b15c146; same everywhere.
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { if (_churchVoice(pubk, { _by: e.pubkey })) { byId.delete(id); emit(); } return; }
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
      want: [MEALS_SETTINGS_D],   // replay only this slice of the hub (see _hubBufSet)
      onevent(e, d) {
        if (d !== MEALS_SETTINGS_D) return;   // the relay write-gates settings to the church/stewards (accept policy), so trust what it serves here — don't drop it on a not-yet-loaded roster, which hid the whole Care module from members
        if ((e.created_at || 0) <= best.ts) return;
        try { const c = JSON.parse(e.content || '{}'); best = { ts: e.created_at || 0, doc: { enabled: !!c.enabled, visibility: c.visibility === 'team' ? 'team' : 'all', openedBy: c.openedBy === 'member' ? 'member' : 'steward', adminGroupId: String(c.adminGroupId || '') } }; cb({ ...best.doc }); } catch {}
      },
      oneose() { if (best.ts) cb({ ...best.doc }); },   // sticky: only emit on EOSE if we actually received settings — don't flip the card off on a reconnect's empty
    });
  },
  // The church's steward-defined chat message tags (Testimony, Praise, …). cb([{ id, label, icon, accent }]).
  // Newest-wins; the relay write-gates the doc to the church/stewards, so trust what it serves. Sanitized on
  // read (allowlisted icon/accent, reserved ids dropped) so a hostile relay/forged doc can't inject anything.
  // cb(tags) with the church's configured tags, or cb(null) when the church has NO tags doc — the caller
  // then falls back to the built-in default (Prayer request), so a church that never touched tags still has it.
  subscribeMessageTags(churchNpub, cb) {
    const pubk = toPub(churchNpub);
    if (!pubk) { cb(null); return () => {}; }
    let bestTs = 0;
    return _onChurchDocs(pubk, {
      onevent(e, d) {
        if (d !== MSGTAGS_D || (e.created_at || 0) <= bestTs) return;
        bestTs = e.created_at || 0;
        let tags = []; try { tags = _sanitizeMsgTags(JSON.parse(e.content || '{}').tags); } catch {}
        cb(tags);
      },
      oneose() { if (!bestTs) cb(null); },   // no doc → signal "use the default", never leave the caller hanging
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
    // DELETION is stricter than authorship: a church that opens needs to ANY member must not thereby let any
    // member retract someone ELSE's need. (kind-30078 is per-author, so a stranger's tombstone never replaces
    // the original on the relay — but the client keyed purely on the d-tag, so honouring it hid the need from
    // everyone: a silent griefing/censorship vector.) Only the church/steward, a care-team admin, or the need's
    // OWN author may retract it. Tracked as a set per id so it works whichever order the events arrive in.
    const tombs = new Map();   // careId -> Set(pubkeys that published a deletion)
    const careDelOk = (by, need) => _churchVoice(pubk, { _by: by })
      || (!!adminGroupId && !!rosterPeople.get(adminGroupId) && rosterPeople.get(adminGroupId).has(by))
      || (!!need && need._by === by);
    const retracted = (id, need) => { const s = tombs.get(id); if (!s) return false; for (const by of s) { if (careDelOk(by, need)) return true; } return false; };
    const emit = _coalesce(() => { const v = [...byId.entries()].filter(([id, n]) => careTrusted(n._by) && !retracted(id, n)).map(([, n]) => n).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || (a.ts || 0) - (b.ts || 0)); if (!eosed && !v.length) return; cb(v); });
    return _onChurchDocs(pubk, {
      emit,   // so the hub can cancel a queued emit when this handler tears down
      onevent(e, d) {
        // capture the church-signed meals config + admin-team roster so care authors can be verified
        if (d === MEALS_SETTINGS_D) { if (_churchVoice(pubk, { _by: e.pubkey })) { try { const c = JSON.parse(e.content || '{}'); openedBy = c.openedBy === 'member' ? 'member' : 'steward'; adminGroupId = String(c.adminGroupId || ''); } catch {} emit(); } return; }
        if (d.startsWith(ROSTER_PFX)) { if (_churchVoice(pubk, { _by: e.pubkey })) { const team = d.slice(ROSTER_PFX.length); const set = new Set(); try { (JSON.parse(e.content || '{}').people || []).forEach(p => { const h = toPub(p && p.pub); if (h) set.add(h); }); } catch {} rosterPeople.set(team, set); emit(); } return; }
        if (!d.startsWith(CARE_D)) return;
        const id = d.slice(CARE_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { const s = tombs.get(id) || new Set(); s.add(e.pubkey); tombs.set(id, s); emit(); return; }
        // H3: needs published on/after 2026-07-20 seal the identifying half under the church care key.
        // Merge the opened half over the clear one; a v1 cleartext doc still reads as-is so a church
        // mid-pilot doesn't lose its open needs. `_sealed` marks one we couldn't open (not yet keyed) so
        // the UI says "details hidden" rather than rendering a nameless card. skipEnc is carried through —
        // only the recipient can decrypt it, and it is what lets them mark a day they don't need help.
        try {
          const c = JSON.parse(e.content);
          let s2 = null, sealed = false;
          if (c.enc) { s2 = _careOpen(pubk, c.enc); sealed = !s2; }
          const f = s2 ? { ...c, ...s2 } : c;
          byId.set(id, { id, _by: e.pubkey, _sealed: sealed, _skipEnc: c.skipEnc || '', displayLabel: f.displayLabel || '', type: f.type || 'meals', startDate: f.startDate || '', endDate: f.endDate || '', recipient: (f.recipient || '').toLowerCase(), notes: f.notes || '', dietary: Array.isArray(f.dietary) ? f.dietary : [], dates: Array.isArray(f.dates) ? f.dates : [], meals: Array.isArray(f.meals) ? f.meals : [], dayMeals: (f.dayMeals && typeof f.dayMeals === 'object') ? f.dayMeals : {}, ts: e.created_at }); emit();
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
    const emit = _coalesce(() => { const v = [...byKey.values()]; if (!eosed && !v.length) return; cb(v); });
    // the shared hub's union filter is a superset of the old '#church'-only one; the d-prefix guard
    // below keeps the delivered set identical (careslot:/careskip: docs are always church-tagged)
    return _onChurchDocs(pubk, {
      emit,   // so the hub can cancel a queued emit when this handler tears down
      want: [prefix],   // replay only this slice of the hub (see _hubBufSet)
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
  // ── "Ask for help": a member opens a private care REQUEST, sealed to the care team (never the whole church).
  // Fetch the church's care-team roster (careteam:<cp> — recipient pubkeys), wrap a one-off content key to each
  // recipient + to ourselves (so we can read our own status back), and publish a member-signed carereq:<id>.
  // The relay read-gates it to the care team; the content is NIP-44-sealed on top. Returns { id, ...body } | null.
  async publishCareRequest(fields) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp) return null;
    let pubs = [];
    try {
      const evs = await pool.querySync(churchRelays(), [{ kinds: [30078], '#d': [CARETEAM_D + cp] }]);
      let best = null; for (const e of (evs || [])) { if (!best || e.created_at > best.created_at) best = e; }
      if (best) { const o = JSON.parse(best.content); if (Array.isArray(o.pubs)) pubs = o.pubs.filter(Boolean); }
    } catch (e) {}
    // always seal to the church key (the owner can always triage) + ourselves; plus the published care team.
    const recips = [...new Set([cp, pub, ...pubs].filter(Boolean))];
    const body = {
      v: 1, type: String(fields.type || 'other'),
      forSelf: fields.forSelf !== false, forName: String(fields.forName || '').trim(),
      when: String(fields.when || '').trim(), urgency: String(fields.urgency || '').trim(),
      note: String(fields.note || '').trim(), by: pub, at: Math.floor(Date.now() / 1000),
    };
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const keyHex = _hex(keyBytes);
    let enc; try { enc = nip44e(JSON.stringify(body), keyBytes); } catch (e) { return null; }
    const keys = {};
    for (const p of recips) { try { keys[p] = nip44e(keyHex, nip44ck(sk, p)); } catch (e) {} }
    const id = _hex(crypto.getRandomValues(new Uint8Array(8)));
    const evt = finalizeEvent({ kind: 30078, created_at: body.at, tags: [['d', CAREREQ_D + id], ['t', NET], ['t', 'carereq'], ['church', cp]], content: JSON.stringify({ keys, enc }) }, sk);
    try { await _publishAny(churchRelays(), evt); } catch (e) { console.warn('[fellowship] care request publish failed', e); return null; }
    return { id, ...body };
  },
  // Subscribe to care requests. A member receives their OWN (the relay serves the author); the care team gets
  // all. cb(list) with [{ id, from, at, sealed, ...body }] newest-first; entries we can decrypt carry the body.
  // The care team gets ALL requests (they can decrypt — they're on the roster); a member gets only their own.
  // We merge the care team's resolution (carereqstatus:) so a resolved request drops out of the open queue and
  // the asker sees "approved"/"handled". cb(list) newest-first; each carries { status:'open'|'approved'|
  // 'declined'|'handled', needId, sealed, ...body }.
  // Shared: Today opens this twice (the care-team list and the asker's own requests, filtered differently
  // from the SAME stream) — one REQ, both fed. See _shared().
  // `churchNpub` is optional and should be passed by any caller that knows which church it is rendering.
  // AUDIT 2026-07-25: these read `Fellowship.churchPub`, which an effect in <App> sets. React runs CHILD passive
  // effects before the parent's, so on a church switch the Today panels re-subscribed while the global still
  // held the PREVIOUS church — and since their dep had already changed, they never re-ran. The panels then
  // watched the old church for the rest of the session. Passing the church removes the ordering dependency.
  subscribeCareRequests(cb, churchNpub) {
    const cp0 = (churchNpub && toPub(churchNpub)) || window.Fellowship.churchPub; if (!cp0) return () => {};
    return _shared('carereq|' + cp0, (emit) => window.Fellowship._openCareRequests(emit, cp0))(cb);
  },
  _openCareRequests(cb, forChurch) {
    const cp = forChurch || window.Fellowship.churchPub; if (!cp) return () => {};
    const byId = new Map();        // id -> request
    const statusById = new Map();  // id -> { status, needId, _ts }
    const tomb = new Map();        // id -> withdrawal ts — so a lagging relay re-serving the older carereq can't resurrect it
    const emit = () => { try { cb([...byId.values()].map(r => { const s = statusById.get(r.id) || {}; return { ...r, status: s.status || 'open', needId: s.needId || '' }; }).sort((a, b) => (b.at || 0) - (a.at || 0))); } catch (e) {} };
    const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], '#t': ['carereq', 'carereqstatus'], '#church': [cp] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d.startsWith(CAREREQSTATUS_D)) {
          const id = d.slice(CAREREQSTATUS_D.length);
          const prev = statusById.get(id); if (prev && prev._ts >= e.created_at) return;
          try { const s = JSON.parse(e.content || '{}'); statusById.set(id, { status: String(s.status || 'handled'), needId: String(s.needId || ''), _ts: e.created_at }); emit(); } catch (e2) {}
          return;
        }
        if (!d.startsWith(CAREREQ_D)) return;
        const id = d.slice(CAREREQ_D.length);
        if (e.tags.some(t => t[0] === 'deleted')) { tomb.set(id, Math.max(tomb.get(id) || 0, e.created_at)); byId.delete(id); emit(); return; }
        if ((tomb.get(id) || 0) >= e.created_at) return;   // withdrawn — never resurrect a copy at/older than the withdrawal
        const prev = byId.get(id); if (prev && prev._ts >= e.created_at) return;
        let body = null;
        try { const o = JSON.parse(e.content); const mine = o.keys && o.keys[pub]; if (mine) { const kh = nip44d(mine, nip44ck(sk, e.pubkey)); body = JSON.parse(nip44d(o.enc, _unhex(kh))); } } catch (e2) {}
        byId.set(id, { id, from: e.pubkey, at: (body && body.at) || e.created_at, _ts: e.created_at, sealed: !body, ...(body || {}) });
        emit();
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // Member withdraws their own pending request.
  async cancelCareRequest(id) {
    const cp = window.Fellowship.churchPub;
    if (!sk || !cp || !id) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CAREREQ_D + id], ['t', NET], ['t', 'carereq'], ['church', cp], ['deleted', '1']], content: '' }, sk);
    try { await _publishAny(churchRelays(), evt); } catch (e) {}
    return evt;
  },
  // ── care-team actions (careAdmin/steward): resolve a request, or approve it INTO a care need ──
  async setCareRequestStatus(reqId, requesterPub, opts) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !reqId) return null;
    const o = opts || {};
    const tags = [['d', CAREREQSTATUS_D + reqId], ['t', NET], ['t', 'carereqstatus'], ['church', cp]];
    if (requesterPub) tags.push(['p', requesterPub]);   // so the asker can read their resolution
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags, content: JSON.stringify({ status: String(o.status || 'handled'), needId: String(o.needId || ''), by: pub, at: Math.floor(Date.now() / 1000) }) }, sk);
    try { await _publishAny(churchRelays(), evt); } catch (e) {}
    return evt;
  },
  async declineCareRequest(req) {
    if (!req || !req.id) return null;
    return window.Fellowship.setCareRequestStatus(req.id, req.from, { status: 'declined' });
  },
  // Approve a request INTO a care need. fields: { dates:[iso…], notes }. The identifying half (who it's for +
  // notes) is sealed with the church care key — requires this device to hold it (a care-admin does).
  async approveCareRequest(req, fields) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !req) return null;
    if (!_carekeys[cp]) throw new Error('This church’s care key hasn’t reached this device yet — open the church once so it syncs, then approve.');
    const f = fields || {};
    const dates = [...new Set((Array.isArray(f.dates) ? f.dates : []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
    const who = req.forSelf ? (((profiles[req.from] || {}).name) || 'A member') : (req.forName || 'A member');
    const enc = _careSeal(cp, { displayLabel: who, recipient: req.forSelf ? req.from : '', notes: String(f.notes != null ? f.notes : (req.note || '')).trim(), dietary: [] });
    if (!enc) throw new Error('Couldn’t seal the need — care key missing.');
    const id = 'care' + _hex(crypto.getRandomValues(new Uint8Array(6)));
    const body = { id, type: req.type || 'other', dates, startDate: dates[0] || '', endDate: dates[dates.length - 1] || '', meals: (req.type === 'meals' ? ['dinner'] : []), dayMeals: {}, enc };
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CARE_D + id], ['t', NET], ['church', cp], ['enc', 'care1']], content: JSON.stringify(body) }, sk);
    try { await _publishAny(churchRelays(), evt); } catch (e) { console.warn('[fellowship] approve→need publish failed', e); return null; }
    await window.Fellowship.setCareRequestStatus(req.id, req.from, { status: 'approved', needId: id });
    return { id };
  },
  // The person a need is FOR closes it themselves ("I'm sorted, thanks"). Dignity: someone who asked for help
  // shouldn't have to wait for a steward to stop the church organising around them. The relay's care: gate
  // means this only lands when the church allows member-opened needs OR they're a steward/care-admin; when it
  // can't, the caller falls back to telling them to ask the care team. Only ever for a need about THEM.
  async closeMyCareNeed(need) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !need || !need.id) return false;
    if ((need.recipient || '').toLowerCase() !== (pub || '').toLowerCase()) return false;   // only your own
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CARE_D + need.id], ['t', NET], ['church', cp], ['deleted', '1']], content: '' }, sk);
    try { const r = await _publishAny(churchRelays(), evt); return !!r || true; } catch (e) { return false; }
  },
  // ── shared care-team↔asker thread for a request (the "Message" action). Sealed to the care team + the asker
  // (+ the church + ourselves), so any care member can join in and the asker can reply. ──
  async sendCareChat(reqId, requesterPub, text) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    const body = String(text || '').trim();
    if (!sk || !cp || !reqId || !body) return null;
    const team = await _fetchCareTeam(cp);
    const sealed = _sealToPubs([cp, pub, requesterPub, ...team], { text: body, by: pub, at: Math.floor(Date.now() / 1000) });
    if (!sealed) return null;
    const msgId = _hex(crypto.getRandomValues(new Uint8Array(6)));
    const tags = [['d', CARECHAT_D + reqId + ':' + msgId], ['t', NET], ['t', 'carechat'], ['church', cp]];
    if (requesterPub) tags.push(['p', requesterPub]);
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags, content: JSON.stringify(sealed) }, sk);
    try { await _publishAny(churchRelays(), evt); } catch (e) { return null; }
    return { id: msgId };
  },
  subscribeCareChat(reqId, cb) {
    const cp = window.Fellowship.churchPub; if (!cp || !reqId) return () => {};
    const prefix = CARECHAT_D + reqId + ':';
    const byId = new Map();
    const emit = _coalesce(() => { try { cb([...byId.values()].sort((a, b) => (a.at || 0) - (b.at || 0))); } catch (e) {} });
    const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], '#t': ['carechat'], '#church': [cp] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(prefix)) return;
        const id = d.slice(prefix.length);
        if (byId.has(id)) return;
        let body = null; try { body = _openSealed(JSON.parse(e.content), e.pubkey); } catch (e2) {}
        if (!body || !body.text) return;   // undecryptable (non-audience) or empty → skip
        byId.set(id, { id, from: e.pubkey, mine: e.pubkey === pub, at: body.at || e.created_at, text: String(body.text) });
        emit();
      },
      oneose() { emit(); },
    });
    return () => { emit.cancel(); try { sub.close(); } catch {} };   // cancel the queued emit: it would otherwise fire a tick after teardown
  },
  async fillCareSlot(careId, iso, note) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !careId || !iso) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CARESLOT_D + careId + ':' + iso], ['t', NET], ['church', cp]], content: JSON.stringify({ careId, isoDate: iso, note: String(note || '').trim() }) }, sk);
    try { await _publishAny(churchRelays(), evt); } catch (e) { console.warn('[fellowship] care slot publish failed', e); }
    return evt;
  },
  async clearCareSlot(careId, iso) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !careId || !iso) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CARESLOT_D + careId + ':' + iso], ['t', NET], ['church', cp], ['deleted', '1']], content: '' }, sk);
    try { await _publishAny(churchRelays(), evt); } catch {}
    return evt;
  },
  // SAFETY CHECK — subscribe to the church's active emergency roll-call. cb(check) with the newest OPEN check
  // {id, message, by, at}, or cb(null) when there's none / it was closed. The relay only serves it to
  // authenticated members (roster-gated), so an outsider never learns the church declared an emergency.
  // Shared: Today renders the safety check in two places — one REQ, both fed. See _shared().
  subscribeSafetyCheck(cb, churchNpub) {   // see subscribeCareRequests: pass the church, don't rely on the global
    const cp0 = (churchNpub && toPub(churchNpub)) || window.Fellowship.churchPub; if (!cp0) return () => {};
    return _shared('safety|' + cp0, (emit) => window.Fellowship._openSafetyCheck(emit, cp0))(cb);
  },
  _openSafetyCheck(cb, forChurch) {
    const cp = forChurch || window.Fellowship.churchPub; if (!cp) return () => {};
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
    try { await _publishAny(churchRelays(), evt); return true; } catch (e) { console.warn('[fellowship] markSafe publish failed', e); return false; }
  },
  // the RECIPIENT marks a day they don't need help (relay rejects this from anyone but the recipient).
  // H3: "I don't need help that day" is RECIPIENT-ONLY, and the relay enforces it — but it can no longer
  // see who the recipient is, because that field is now sealed. So the need carries an opaque
  // sha256(token) tag, and the token itself is encrypted to the recipient ALONE (not under the church-wide
  // care key). Presenting the token proves you are the recipient without telling the relay who that is.
  // `skipEnc` comes from the need (subscribeCareNeeds carries it through as _skipEnc).
  async markCareSkip(careId, iso, reason, skipEnc, needAuthor) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !careId || !iso) return null;
    const tags = [['d', CARESKIP_D + careId + ':' + iso], ['t', NET], ['church', cp]];
    if (skipEnc) { try {
      // Unseal against the need's AUTHOR (#13), not always the church key — a delegated steward's need is
      // sealed with the steward's key, so unsealing with the church key would silently fail and the recipient
      // could never decline. Then derive THIS day's token from the secret (#12): present only tok(iso), which
      // unlocks this date alone. `.tok` is the v2 single-token fallback for any pre-redesign need.
      const authorPub = needAuthor || cp;
      const o = JSON.parse(nip44d(skipEnc, nip44ck(sk, authorPub)));
      if (o && o.s) tags.push(['skiptok', await _sha256hex(new TextEncoder().encode(o.s + ':' + iso))]);   // UTF-8 bytes → same digest the seal computed
      else if (o && o.tok) tags.push(['skiptok', String(o.tok)]);
    } catch (e) {} }
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags, content: JSON.stringify({ careId, isoDate: iso, reason: String(reason || '').trim() }) }, sk);
    try { await _publishBounded(churchRelays(), evt); evt._delivered = true; }   // bounded so an offline skip settles, not hangs
    catch (e) { console.warn('[fellowship] care skip publish failed', e); evt._delivered = false; }
    return evt;
  },
  async clearCareSkip(careId, iso) {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp || !careId || !iso) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CARESKIP_D + careId + ':' + iso], ['t', NET], ['church', cp], ['deleted', '1']], content: '' }, sk);
    try { await _publishAny(churchRelays(), evt); } catch {}
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
    try { await _publishAny(churchRelays(), evt); } catch (e) { console.warn('[fellowship] care avail publish failed', e); }
    return evt;
  },
  async clearCareAvail() {
    const cp = window.Fellowship.churchPub;
    if (!sk) { try { await window.Fellowship.ready; } catch {} }
    if (!sk || !cp) return null;
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', CAREAVAIL_D + cp], ['t', NET], ['church', cp], ['deleted', '1']], content: '' }, sk);
    try { await _publishAny(churchRelays(), evt); } catch {}
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
        // AUDIT-2026-07-24 (group events): A tombstone is only honoured from an author who could have written the doc in the first place. kind-30078 is per-author, so a stranger's delete never replaces the original on the relay — but keying purely on the d-tag meant honouring it here HID the real one from this member, and the blanked list was then persisted to localStorage. Fixed for care needs in b15c146; same everywhere.
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { if (_groupEventTrusted(cp, (e.tags.find(t => t[0] === 't' && t[1] !== NET) || [])[1], e.pubkey)) { byId.delete(id); emit(); } return; }
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
    try { await _publishAny(window.Fellowship.relays, evt); } catch (e) { console.warn('[fellowship] publishGroupEvent failed', e); return null; }
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
        // AUDIT-2026-07-24 (my serving requests): A tombstone is only honoured from an author who could have written the doc in the first place. kind-30078 is per-author, so a stranger's delete never replaces the original on the relay — but keying purely on the d-tag meant honouring it here HID the real one from this member, and the blanked list was then persisted to localStorage. Fixed for care needs in b15c146; same everywhere.
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { if (e.pubkey === (window.Fellowship.churchPub || '')) { byId.delete(id); emit(); } return; }
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
    try { await _publishAny(window.Fellowship.relays, evt); } catch {}
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
    try { await _publishAny(window.Fellowship.relays, evt); } catch {}
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
    try { await _publishAny(window.Fellowship.relays, evt); } catch {}
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
    try { await _publishAny(churchRelays(), evt); } catch (e) { console.warn('[fellowship] wallet backup failed', e); }
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
