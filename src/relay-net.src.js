// IS THIS RELAY ONE OF OURS? — the predicate, one copy, both bundles.
//
// ONE COPY, BOTH BUNDLES, for the same reason src/relay-identity.src.js is: the member app and the steward
// console are built separately and share no local modules, so a second copy would drift, and two surfaces
// that disagree about who is in the network is worse than either answer on its own.
//
// WHAT THE ANSWER RESTS ON, and it is deliberately not us. There is no TrinityOne network key, no credential
// anyone is issued, and nobody who can approve or revoke a church's relay. A relay is one of ours when the
// C2 possession proof succeeds for the URL we dialled AND one of three roots vouches for the key it proved:
//
//   1. THE CANONICAL POOL — the relays we run and every church gets out of the box. There is no church
//      signature over these (they are the shared default), so they are admitted against a pubkey list baked
//      into the bundle beside the URL. A build-time literal, changed only by shipping a new bundle: no
//      online revoker, which is the property we want, at the rotation cost §5-bis prices.
//   2. THE SAME ORIGIN — a relay on the console's (or app's) own serving origin. Not a trust decision: to
//      load the page at all the steward already ran the key-holding code that origin served, so a box that
//      could tamper with the console did not need relay membership to win. Loopback — the Suite's first run,
//      where the relay serves its own console off 127.0.0.1 — is the narrowest case of this rule, not a
//      separate one.
//   3. THE CHURCH'S OWN SIGNATURE — the proven pubkey appears in this church's own signed
//      `d=trinityone/relay-net` document. This is what keeps self-hosting alive and it covers third-party
//      hosting too: a relay hosting a church that is not its operator's is admitted because the HOSTED
//      CHURCH signs that relay's pubkey into its own list. The church makes the call, not TrinityOne.
//
// PUBKEY ONLY. NEVER THE URL. The membership document may carry a `url`, and it is advisory — the last place
// a box was seen, useful as a hint for where to attempt a proof. It is never consulted for admission. A
// self-hosted relay behind a free tunnel gets a NEW address every restart, so matching on address would drop
// a church's own relay on every reboot of it. URL-to-key BINDING is a real requirement, but it belongs
// server-side (plan C6), where the sync loop hands a signed identity proof to a host and must know it is the
// right one. Here, a hint is only a place to ask the question.
//
// FAIL CLOSED, and it costs nothing. An unverifiable relay is not one of ours. That degrades to the set we
// shipped, never to nothing, because the canonical pool is a literal in this bundle and needs no network to
// be trusted. There is no urgency argument for admitting a relay that has not answered.
//
// WHAT CONSUMES IT (C4, at the bottom of this file). createRelayGate() turns this answer into the PUBLISH
// SET both surfaces write over: `relays()` in the console, `churchRelays()`/`relaysForChurch()`/
// `_publishAny()` in the member app. A relay that cannot prove itself now stops receiving a church's data —
// which is also why merging this deploys nothing until every relay in the fleet answers /relay-identity: a
// box that cannot answer drops out of its own church's network on the day it lands.
//
// AND IT DOES NOT CLAIM MORE THAN IT PROVES. Nothing remote can show that a relay's operator is not simply
// reading their own database. This raises the floor from "anyone with a keypair" to "a relay running the
// enforcing software that this church signed for", and no further.
import { normalizeURL } from 'nostr-tools/utils';
import { verifyRelayIdentity, relayHttpBase } from './relay-identity.src.js';

// The church's own membership statement. A NEW document type, deliberately NOT `trinityone/relays`.
//
// WHY NOT REUSE THE ONE THAT ALREADY LISTS RELAYS. `trinityone/relays` means "cross-relay sync is ON and
// these are the peers": syncEnable() REFUSES to write it below two distinct boxes (so a single-relay church
// — the commonest self-hosting shape — could never author its own membership at all), and syncDisable()
// publishes `[]` to it, which under a repurposed reading would un-admit a church's own relay as a side
// effect of switching mirroring off. Adding a meaning to a live document also reaches backwards: the relay
// replays all stored history through ingest on every update. Add, never repurpose.
export const RELAY_NET_D = 'trinityone/relay-net';

// THE CANONICAL POOL'S EXPECTED IDENTITY KEYS — a LIST per URL, not one value.
//
// A list because this project has rotated a relay key under incident before (the 2026-07-06 secret
// exposure), and a single pin makes a rotation a fleet-wide outage: every client holding the old pin refuses
// the box the moment it starts answering with the new key. Shipping old+new for one release and retiring the
// old pin in the next costs nothing and removes that.
//
// TODAY BOTH CANONICAL URLS ARE ONE BOX. `app.trinityone.church` (Cloudflare) and
// `trinityone-master-01.tailbeaac0.ts.net` (Tailscale Funnel) are two network paths to the same machine and
// therefore share one identity key — which is exactly why membership is keyed on the PUBKEY and the relay
// count that decides redundancy is keyed on it too. The second box (plan C8) adds a URL here with its own
// pin, and that is when this list becomes genuinely multi-entry.
//
// HOW THE VALUE BELOW WAS ESTABLISHED, said plainly because it matters: it was read from the live relay's
// `/status` on 2026-09-01 at both URLs (identical, versionShort 7f05991). `/status` is a bare string on an
// unauthenticated GET — the very claim C2 exists to replace — so this pin is trust-on-first-use taken at
// build time by a human who could reach the box, not something the pin itself proves. What the pin DOES buy,
// from the moment the fleet answers `/relay-identity`, is that a host copying that `/status` cannot pass:
// admission requires the proof, and the proof requires the secret key.
// OUR SHARED RELAY IS A KEY. THE ADDRESSES ARE WHERE YOU WILL PROBABLY FIND IT.
//
// The two addresses below already mapped to the SAME single key, because they are one box reached two ways
// (Cloudflare and Tailscale). That is the data saying what the identity actually is, and this is the same
// lesson tunnel churn taught: a key is who a machine IS, an address is a claim about where it is.
//
// WHY IT MATTERS HERE. `wss://app.trinityone.church/relay` ships inside every app. Under a rule that admits
// any box which proves it runs our software, seizing or compelling that ADDRESS — the recorded threat model
// is lawful compulsion, and it sits behind a tunnel we do not own — would let a different machine answer
// there and be admitted by the entire fleet at once, with no invite, no directory entry and no adversary
// effort at all. So a machine answering at an address we SHIP must prove one of the keys we ship.
//
// THIS IS NOT AN ALLOWLIST AND MUST NOT BECOME ONE. It binds our OWN defaults and nothing else: a church's
// self-hosted box, or a partner church's box, is at an address we do not ship and is admitted on its proof
// alone. We are not deciding who may run a relay; we are declining to be fooled about our own front door.
//
// Moving the box, adding a third route, or a tunnel rotating costs nothing and ships no release, because the
// KEY has not changed — which is precisely what pinning the address would have cost.
export const SHARED_RELAY_KEYS = Object.freeze([
  '6a4267558c9990d0391b3472bac9735d33a5e99b5c7cb0e49bdece7ea6b770f2',
]);
export const SHARED_RELAY_HINTS = Object.freeze([
  'wss://app.trinityone.church/relay',
  'wss://trinityone-master-01.tailbeaac0.ts.net/relay',
]);
// Derived, and kept because `proveRelay`'s diagnostics and every existing caller and test read this shape.
// It is a VIEW of the two declarations above, never a second source of truth.
export const CANONICAL_RELAY_PUBS = Object.freeze(
  Object.fromEntries(SHARED_RELAY_HINTS.map(u => [u, SHARED_RELAY_KEYS])));

// Key a relay URL the way the connection pool does. The pool keys its map by normalizeURL(), and a raw
// string compare against a URL that differs only by a trailing slash misses SILENTLY — three occurrences of
// that trap are already recorded in this codebase. Falls back to the raw string if normalizeURL throws on
// something unparseable, which then simply fails to match, which is the fail-closed direction.
function _relayKey(url) { try { return normalizeURL(String(url || '')); } catch { return String(url || ''); } }

const _isHex64 = (s) => /^[0-9a-f]{64}$/.test(String(s || '').toLowerCase());

// Is `url` one of the addresses we SHIP? Derived from whichever pin map is in force so an injected map
// (tests, and only tests) stages a shared address the same way production does.
export function isSharedAddress(url, pins) {
  const map = pins || CANONICAL_RELAY_PUBS;
  const want = _relayKey(url);
  if (!want) return false;
  for (const k of Object.keys(map)) if (_relayKey(k) === want) return true;
  return false;
}
// Every key we ship, across all hint addresses. A key is acceptable at a shipped address regardless of
// WHICH shipped address it was listed beside — one box reached two ways is one member, and pinning a key to
// a particular road would reintroduce exactly the address-shaped membership this design refuses.
export function sharedRelayKeys(pins) {
  const map = pins || CANONICAL_RELAY_PUBS;
  const out = [];
  for (const v of Object.values(map)) for (const p of (v || [])) {
    const h = String(p).toLowerCase();
    if (_isHex64(h) && !out.includes(h)) out.push(h);
  }
  return out;
}

// The accepted identity keys for a canonical URL, or [] if this URL is not in the pool.
export function canonicalPinsFor(url, pins) {
  const map = pins || CANONICAL_RELAY_PUBS;
  const want = _relayKey(url);
  if (!want) return [];
  for (const k of Object.keys(map)) {
    if (_relayKey(k) === want) return (map[k] || []).map(p => String(p).toLowerCase()).filter(_isHex64);
  }
  return [];
}

// `[{ pubkey, alwaysOn, url? }]` out of the document's content, dropping anything malformed rather than
// throwing. One bad entry must not cost a church its whole relay list.
//
// `alwaysOn` DEFAULTS TRUE and is the owner's "this machine is not on 24/7" flag — a parish-office box
// switched off at night is a real second copy for durability and NOT a reliable one for reach. Nothing in
// this item reads it (its consumers are plan C11: connect ordering, the honesty of the redundancy count, and
// server-side sync backoff). It is parsed and preserved here so a console that writes it and a client that
// will later read it cannot disagree about its default: absent means ON, because that is what every box was
// before the flag existed.
export function parseRelayNet(content) {
  let arr = content;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr || '[]'); } catch { return []; } }
  if (!Array.isArray(arr)) return [];
  const out = [], seen = new Set();
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const pubkey = String(e.pubkey || '').toLowerCase();
    if (!_isHex64(pubkey) || seen.has(pubkey)) continue;
    seen.add(pubkey);
    out.push({ pubkey, alwaysOn: e.alwaysOn !== false, url: (typeof e.url === 'string') ? e.url : '' });
  }
  return out;
}

// An http(s) origin in one comparable form: lower-cased, no trailing slash, no default port. `location.origin`
// omits :443/:80 while a relay URL may spell them out, and that difference is invisible until it silently
// refuses a box that IS the origin.
function _originKey(httpUrl) {
  let s = String(httpUrl || '').trim().toLowerCase().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(s)) return '';
  return s.replace(/^(https:\/\/[^/:]+):443$/, '$1').replace(/^(http:\/\/[^/:]+):80$/, '$1');
}

// Is this relay URL the page's OWN serving origin? `origin` is the caller's — and the caller passes '' when
// the page was not served by anything that could be a relay (a Capacitor APK, where location.host is just
// "localhost" and the page came out of the app bundle; a static CDN host). Passing '' can only ever refuse,
// so this stays fail-closed when the origin is unknown.
export function sameOriginRelay(url, origin) {
  const a = _originKey(relayHttpBase(url));
  const b = _originKey(origin);
  return !!a && !!b && a === b;
}

// → WHICH ROOT admits this relay for this church, and the pubkey it proved. `{ root: '', pub: '' }` when
// none does. `cp` is the church's pubkey: membership is per church, because the church's own signature is
// the authority.
//
// deps:
//   verify(url)      → Promise<{relayPub}|null>  — the C2 possession proof. Defaults to the shipped one.
//   netEntries(cp)   → Promise<[{pubkey,…}]>     — this church's own signed relay-net entries.
//   origin           → the page's serving origin, or '' if the page was not served by a candidate relay.
//   pins             → the canonical pin map. Defaults to the one above.
//
// THE PROOF IS FIRST AND IT IS NOT OPTIONAL FOR ANY ROOT — including the same-origin one. Without it every
// root below is a string comparison against something any host can echo.
//
// WHY THE ROOT COMES BACK AND NOT JUST A YES. The C4 gate caches this answer, and two of the three roots are
// facts about the WHOLE PRODUCT while the third is a fact about ONE CHURCH. A canonical pin and the page's
// own origin say nothing about which congregation is asking; a church's signature says everything. Cache
// them under the same key and church A's signature would silently admit a relay for church B's data — the
// cross-tenant shape this codebase has shipped twice. So the caller is told which one answered.
export async function proveRelay(cp, url, deps) {
  const d = deps || {};
  const no = { root: '', pub: '' };
  if (!url) return no;
  let proof = null;
  try { proof = await (d.verify || verifyRelayIdentity)(url); } catch { proof = null; }
  const provenPub = String((proof && proof.relayPub) || '').toLowerCase();
  if (!_isHex64(provenPub)) return no;

  // OUR OWN FRONT DOOR — a REFUSAL, and it comes before every root.
  //
  // A machine answering at an address we SHIP must prove one of the keys we ship. Seizing or compelling
  // `app.trinityone.church` is the cheapest attack there is against a rule that otherwise admits anything
  // running our software: that address is already in every app, so it needs no invite and no list poisoning.
  // Refusing here costs a self-hosting or partner church nothing, because their box is not at one of our
  // addresses and never reaches this line.
  if (isSharedAddress(url, d.pins) && !sharedRelayKeys(d.pins).includes(provenPub)) return { root: '', pub: provenPub };

  // ROOT 1 — the canonical pool, against the pin baked in beside the URL.
  //
  // AND IT IS URL-BOUND, WHICH IS NOT AN ACCIDENT (see THE FORWARDING PROXY below). `canonicalPinsFor`
  // answers [] for any address that is not itself a canonical URL, so a host that FORWARDS the proof to a
  // real canonical relay and passes it back cannot inherit that relay's membership at its own address.
  if (canonicalPinsFor(url, d.pins).includes(provenPub)) return { root: 'canonical', pub: provenPub };

  // ROOT 2 — the page's own serving origin. URL-bound for the same reason and by the same construction: the
  // address dialled must BE the origin, so a forwarder at a different address is not the origin.
  if (sameOriginRelay(url, d.origin)) return { root: 'origin', pub: provenPub };

  // ROOT 3 — this church's own signature. PUBKEY ONLY: `e.url` is a hint about where the box was last seen
  // and is never compared with the URL we dialled, because a tunnelled relay's address changes on every
  // restart and matching on it would un-admit a church's own box every time it reboots.
  let entries = null;
  try { entries = d.netEntries ? await d.netEntries(cp) : null; } catch { entries = null; }
  if (Array.isArray(entries) && entries.some(e => e && String(e.pubkey || '').toLowerCase() === provenPub)) return { root: 'church', pub: provenPub };

  // IT RUNS OUR SOFTWARE, AND THAT IS THE RULE.
  //
  // Owner's decision, 2026-09-02: *"runs our software"* — their own recorded definition of a non-TrinityOne
  // relay is "people that run our specific relay software", and this is that sentence implemented literally.
  // The proof above is what demonstrates it: a generic relay answers `/relay-identity` with its own default
  // web page (measured 2026-09-02 against two of the largest public Nostr relays; naming them here would
  // trip C1's own guard, which scans shipped files — comments included — for hosts we do not run), and a forwarder gets no proof at all now that a
  // box signs only an address it declares. The roots above no longer decide ADMISSION — they are computed
  // for diagnostics, and because re-tightening to "a box my church chose" is then one line here rather than
  // an excavation.
  //
  // WHAT THIS KNOWINGLY GIVES UP: someone who genuinely runs our relay software, at an address they control,
  // can be admitted if that address reaches a church's relay list. They would see the pubkey-level social
  // graph — never names (sealed) and never message contents (encrypted). The gates that narrow how an
  // address reaches a list at all are C1 and C5, both merged.
  return { root: 'software', pub: provenPub };
}

// → true when `url` is a relay this church may talk to. The one-line reading of proveRelay(), kept because
// it is the question every caller outside the gate actually asks.
export async function isNetworkRelay(cp, url, deps) {
  return !!(await proveRelay(cp, url, deps)).root;
}

// ── C4: THE GATE — from "is this relay one of ours?" to "does this church's data go there?" ─────────────
//
// TWO SETS, AND CONFUSING THEM IS THE WHOLE DANGER (plan §5-bis).
//
//   • THE CANDIDATE LIST is what the client keeps, shows, retries and verifies in the background. Its
//     never-empty guards stay exactly where they are and are untouched: `loadRelays()` falls back to the
//     canonical pool rather than return `[]`, and the console appends the canonical pool unconditionally.
//   • THE PUBLISH SET is verified-only and MAY BE EMPTY. It is this filter's output, computed AFTER those
//     guards, on the assembled list.
//
// Get that order backwards in either direction and one of two things happens. Filter BEFORE the guards and
// an emptied list is refilled by the guard with relays nobody verified — the gate re-admits what it just
// refused. Treat the publish set as never-empty and the gate does not exist. So: guards first, filter last,
// and when the filter returns nothing, each path takes the failure surface it ALREADY has. There is no
// general write queue in this product and this item does not build one.
//
// NEVER VERIFY-OR-DROP ON THE HOT PATH. `admit()` is synchronous and consults the cache and nothing else,
// because it sits under every publish and every subscription. A URL the cache does not know is not verified
// here and dropped here — it is scheduled, verified in the background, and enters the live set on the next
// call if it passed. A relay is therefore never excluded because a probe happened to be slow at the moment
// somebody pressed send; it is excluded because it has never proved itself.
//
// KEYED BY URL, CERTIFYING A PUBKEY. The map is keyed by `normalizeURL` — the same key the connection pool
// files relays under, because a raw string compare that differs only by a trailing slash misses SILENTLY and
// has done so three times in this codebase already. What an entry CERTIFIES is the pubkey proven at that
// address. A box that moves to a new URL simply proves itself there and is re-admitted; nothing about
// membership is URL-shaped. And a URL that starts answering with a DIFFERENT key loses its entry on the next
// background pass, because the thing that was admitted is no longer what is there.
//
// PER CHURCH, WHERE THAT IS WHAT WAS PROVED. An entry records the church whose signature admitted it, or ''
// for the canonical and same-origin roots, which are facts about the product rather than about one
// congregation. `admit(list, cp)` accepts an entry when it is church-independent or when it names THIS
// church. Passing no church at all (a DM, a profile read — traffic that belongs to the member and not to a
// congregation) accepts any church this device has proved a relay for; it never accepts an unverified one.
export const VERIFIED_KEY = 'trinityone.relays.verified';
// HOW LONG A PROOF IS GOOD FOR WITHOUT THE NETWORK. Not a security window — the background pass re-proves
// every few hours whenever the device is online, so this only decides what a phone that has been OFF or out
// of signal for a long time may do the moment it comes back. Short would mean a returning member's first
// message fails while a probe runs; and the thing being remembered is not a secret, it is "this address was
// a relay our church signed for". A month is long enough to cover a missionary's trip and short enough that
// a box a church removed does not stay admitted on a dormant handset for ever.
export const VERIFIED_TTL_SEC = 30 * 24 * 3600;
export const VERIFIED_REFRESH_SEC = 6 * 3600;   // re-prove in the background once an entry is older than this
export const VERIFY_RETRY_SEC = 60;             // …and do not hammer a box that just failed

// The cache off whatever store the caller has (localStorage in both shipped surfaces, a plain object in
// tests). Anything malformed reads as an empty map rather than throwing: a corrupt cache must cost a boot a
// round of re-verification, never the boot.
export function readVerified(store) {
  const out = new Map();
  let raw = null;
  try { raw = store && store.getItem ? store.getItem(VERIFIED_KEY) : null; } catch { raw = null; }
  let obj = null;
  try { obj = JSON.parse(raw || '{}'); } catch { return out; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (!v || typeof v !== 'object') continue;
    const pub = String(v.pub || '').toLowerCase();
    if (!_isHex64(pub)) continue;
    const until = Number(v.until) || 0, at = Number(v.at) || 0;
    const cp = _isHex64(v.cp) ? String(v.cp).toLowerCase() : '';
    out.set(_relayKey(k), { pub, cp, at, until });
  }
  return out;
}
export function writeVerified(store, map) {
  try {
    if (!store || !store.setItem) return;
    const obj = {};
    for (const [k, v] of map) obj[k] = { pub: v.pub, cp: v.cp, at: v.at, until: v.until };
    store.setItem(VERIFIED_KEY, JSON.stringify(obj));
  } catch {}
}

// Is this URL admitted for this church, from the cache alone? SYNCHRONOUS, and the only question the hot
// path asks. `cp` falsy = the caller is not acting for a particular church (see the header note).
export function admitCached(map, url, cp, nowSec) {
  const e = map.get(_relayKey(url));
  if (!e || !(e.until > nowSec)) return false;
  if (!e.cp) return true;                 // canonical / same-origin: church-independent
  return !cp || e.cp === String(cp).toLowerCase();
}

export function rememberVerified(map, url, pub, cp, nowSec) {
  const k = _relayKey(url);
  if (!k || !_isHex64(pub)) return;
  map.set(k, { pub: String(pub).toLowerCase(), cp: _isHex64(cp) ? String(cp).toLowerCase() : '', at: nowSec, until: nowSec + VERIFIED_TTL_SEC });
}

// THE GATE ITSELF. One per surface (one in the member app, one in the console), created once at module load.
//
// deps:
//   store        — a localStorage-like { getItem, setItem }, or null for memory-only
//   verify(url)  — the C2 possession proof; passed through to proveRelay
//   netEntries(cp), origin, pins — proveRelay's other roots. `origin` may be a string or a function.
//   now()        — seconds, injectable for tests
//   onChange()   — called when the live set gained or lost a relay, so a panel can repaint
export function createRelayGate(deps) {
  const d = deps || {};
  const nowSec = () => (d.now ? d.now() : Math.floor(Date.now() / 1000));
  const map = readVerified(d.store);
  // KEY → THE PROOF IN FLIGHT FOR IT, not merely "one is happening". A set could only tell refresh() to SKIP
  // an address the hot path had already scheduled a moment earlier, so `await refresh(...)` would return
  // before the very answer it was called to wait for — a barrier that is not one, and the surface's first
  // publish would go to an empty set for no reason. Holding the promise makes refresh JOIN that work.
  const inflight = new Map();
  const attempted = new Map();      // key → when we last tried, so a dead box is not hammered
  const changed = () => { try { if (d.onChange) d.onChange(); } catch {} };

  function origin() { try { return (typeof d.origin === 'function') ? d.origin() : (d.origin || ''); } catch { return ''; } }

  // Prove one address and record what root admitted it. Also FORGETS an entry whose address has started
  // answering with a different key, or which no root vouches for any more (a church removed the box from its
  // document): the cache is a memory of a proof, not a permanent grant.
  async function prove(url, cp) {
    const k = _relayKey(url);
    let res = { root: '', pub: '' };
    try { res = await proveRelay(cp, url, { verify: d.verify, netEntries: d.netEntries, origin: origin(), pins: d.pins }); } catch {}
    const had = map.get(k);
    if (res.root) {
      const scope = res.root === 'church' ? String(cp || '').toLowerCase() : '';
      // A CHURCH-ROOT ADMISSION WITH NO CHURCH TO ATTACH IT TO would be written down as church-INDEPENDENT —
      // one congregation's signature admitting a relay for everybody on the device. It cannot arise today
      // (netEntries answers [] when there is no church to ask about) and it is refused here anyway, because
      // this is the exact shape of cross-tenant defect this codebase has shipped twice.
      if (res.root === 'church' && !_isHex64(scope)) { attempted.set(k, nowSec()); return false; }
      rememberVerified(map, url, res.pub, scope, nowSec());
      writeVerified(d.store, map);
      if (!had || had.pub !== res.pub || had.cp !== scope) changed();
      return true;
    }
    attempted.set(k, nowSec());
    // ONLY FORGET WHEN WE LEARNED SOMETHING, not merely when the box did not answer. A relay that is off for
    // an afternoon must not be un-admitted by its own downtime — that is the fail-closed-in-the-wrong-place
    // mistake, and the entry expires on its own soon enough if it never comes back. So: drop it when the
    // address PROVED a different key (somebody else is answering here now), and leave it otherwise.
    if (had && res.pub && res.pub !== had.pub) { map.delete(k); writeVerified(d.store, map); changed(); }
    return false;
  }

  // Start a proof, or hand back the one already running for this address. Never two at once for one address.
  function start(url, cp) {
    const k = _relayKey(url);
    const running = inflight.get(k);
    if (running) return running;
    const p = Promise.resolve().then(() => prove(url, cp)).catch(() => false).then((v) => { inflight.delete(k); return v; });
    inflight.set(k, p);
    return p;
  }
  // The hot path's form: start one if none is running and we have not just failed at this address, and do
  // not wait for it under any circumstances.
  function schedule(url, cp) {
    const k = _relayKey(url);
    if (!k || inflight.has(k)) return;
    const last = attempted.get(k) || 0;
    if (last && (nowSec() - last) < VERIFY_RETRY_SEC) return;
    attempted.set(k, nowSec());
    start(url, cp);
  }

  return {
    // THE SYNCHRONOUS FILTER. Cache only. Anything it cannot admit is scheduled, never awaited.
    admit(list, cp) {
      const t = nowSec(), out = [];
      for (const u of (Array.isArray(list) ? list : [])) {
        if (!u) continue;
        const e = map.get(_relayKey(u));
        if (admitCached(map, u, cp, t)) {
          out.push(u);
          if (!e.at || (t - e.at) > VERIFIED_REFRESH_SEC) schedule(u, cp);   // still good; re-prove in the background
        } else schedule(u, cp);
      }
      return out;
    },
    // Ask about ONE address without opening anything — what a relay panel needs to say "connected" or
    // "not yet proved" honestly.
    admits(url, cp) { return admitCached(map, url, cp, nowSec()); },
    // Prove a whole list NOW, awaited. For the moments where waiting is right: the list just changed, or the
    // app has just booted and would rather spend a second than start with an empty publish set.
    async refresh(list, cp) {
      const seen = new Set(), waiting = [];
      for (const u of (Array.isArray(list) ? list : [])) {
        const k = _relayKey(u);
        if (!u || seen.has(k)) continue;
        seen.add(k);
        attempted.set(k, nowSec());     // an explicit "prove this now" is not subject to the failure backoff
        waiting.push(start(u, cp));
      }
      try { await Promise.all(waiting); } catch {}
      return this.admit(list, cp);
    },
    // What the gate would drop, so a screen can name the address and say why rather than losing it silently.
    dropped(list, cp) { const t = nowSec(); return (Array.isArray(list) ? list : []).filter(u => u && !admitCached(map, u, cp, t)); },
    forget(url) { const k = _relayKey(url); if (map.delete(k)) { writeVerified(d.store, map); changed(); } },
    _map: map,
  };
}

// ── THE FORWARDING PROXY, and exactly how far this closes it ────────────────────────────────────────────
//
// THE ATTACK. A host at an address of its own answers `/relay-identity?nonce=N` by asking a GENUINE relay
// the same question and passing the answer back. It has learned no key and forged nothing, and the proof it
// returns is real. If that host is also the websocket a client publishes to, the client's traffic is the
// proxy operator's to read while the proof says everything is well.
//
// WHAT IS CLOSED HERE, and it is the half where the valuable identities live. Roots 1 and 2 are bound to the
// address dialled by construction, not by a comparison that could be got wrong: `canonicalPinsFor()` answers
// [] for any address that is not itself one of the canonical URLs, and `sameOriginRelay()` requires the
// address to BE the page's origin. So a forwarder cannot inherit the canonical pool's identity, and cannot
// inherit the console's own box's, however faithfully it relays the proof. There is a test that stages
// exactly this — a real forwarding host in front of a real relay — and requires the refusal.
//
// WHAT IS NOT CLOSED HERE: ROOT 3, and the reason is the relay's, not the client's. Under the church
// signature the client checks a PUBKEY, deliberately, because a church's own box behind a free tunnel gets a
// new address on every restart and matching on address would un-admit it on every reboot. The obvious extra
// check — "does the URL the relay SIGNED match the URL we dialled?" — cannot be made to work against the
// proof gateway.mjs mints today, and it fails in both directions at once (measured at this commit,
// scripts/gateway.mjs `relayIdentityUrl`):
//
//   • With no `origin` file, the relay signs the HOST HEADER it was sent. A proxy chooses that header, so
//     the relay signs the PROXY's address and the comparison passes. The check buys nothing.
//   • With an `origin` file, the relay signs THAT — and `origin` is the UPDATE origin, the box this relay
//     pulls new code FROM (`scripts/relay-update.sh`, and gateway.mjs's own "this relay has no update origin
//     (it may be the release host itself)"). So a satellite relay signs its MASTER's URL, and the comparison
//     would refuse a perfectly genuine church box. The check costs a real deployment.
//
//   And even with those repaired it would still refuse the two canonical URLs, which are one machine reached
//   two ways and cannot both equal what that machine signs.
//
// CLOSED 2026-09-02 — what follows is the design that was implemented, kept because it records WHY.
//
// SO THE FIX IS THE RELAY'S: a box declares the address(es) it answers at, signs the dialled host only when
// it is one of them, and refuses otherwise — at which point the client can bind, and a proxy can no longer
// have its own address signed by somebody else's key. That is URL-to-key binding, which the plan already
// places in C6; what this note adds is that C6 must ALSO repair `relayIdentityUrl` (it currently signs the
// wrong URL entirely for any satellite) and must reach the CLIENT gate, not only the sync loop, because a
// member publishing straight at a proxy never goes near the sync loop.
//
// AND THE RESIDUAL IS BOUNDED, which is worth saying plainly rather than leaving as a shrug: the gate only
// ever filters addresses that are ALREADY in the church's candidate list, so this attack needs a hostile URL
// adopted first. Every automatic route by which one can arrive — an invite's `?relay=`, a directory name
// swap, auto-find — is C5's, and C5 is the item immediately after this one.
