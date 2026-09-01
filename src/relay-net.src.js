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
// WHAT THIS DELIBERATELY DOES NOT DO — the same line src/relay-identity.src.js draws, one level up. It does
// not decide which relays anything talks to. Nothing in either bundle filters a relay list on this answer;
// that is the closed-network plan's C4, and it lands separately with an audit between, because the moment a
// client requires membership, a fleet relay that cannot answer the C2 proof drops out of its own church's
// network on the day it merges.
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
export const CANONICAL_RELAY_PUBS = Object.freeze({
  'wss://app.trinityone.church/relay': Object.freeze(['6a4267558c9990d0391b3472bac9735d33a5e99b5c7cb0e49bdece7ea6b770f2']),
  'wss://trinityone-master-01.tailbeaac0.ts.net/relay': Object.freeze(['6a4267558c9990d0391b3472bac9735d33a5e99b5c7cb0e49bdece7ea6b770f2']),
});

// Key a relay URL the way the connection pool does. The pool keys its map by normalizeURL(), and a raw
// string compare against a URL that differs only by a trailing slash misses SILENTLY — three occurrences of
// that trap are already recorded in this codebase. Falls back to the raw string if normalizeURL throws on
// something unparseable, which then simply fails to match, which is the fail-closed direction.
function _relayKey(url) { try { return normalizeURL(String(url || '')); } catch { return String(url || ''); } }

const _isHex64 = (s) => /^[0-9a-f]{64}$/.test(String(s || '').toLowerCase());

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

// → true when `url` is a relay this church may talk to. `cp` is the church's pubkey: membership is per
// church, because the church's own signature is the authority.
//
// deps:
//   verify(url)      → Promise<{relayPub}|null>  — the C2 possession proof. Defaults to the shipped one.
//   netEntries(cp)   → Promise<[{pubkey,…}]>     — this church's own signed relay-net entries.
//   origin           → the page's serving origin, or '' if the page was not served by a candidate relay.
//   pins             → the canonical pin map. Defaults to the one above.
//
// THE PROOF IS FIRST AND IT IS NOT OPTIONAL FOR ANY ROOT — including the same-origin one. Without it every
// root below is a string comparison against something any host can echo.
export async function isNetworkRelay(cp, url, deps) {
  const d = deps || {};
  if (!url) return false;
  let proof = null;
  try { proof = await (d.verify || verifyRelayIdentity)(url); } catch { proof = null; }
  const provenPub = String((proof && proof.relayPub) || '').toLowerCase();
  if (!_isHex64(provenPub)) return false;

  // ROOT 1 — the canonical pool, against the pin baked in beside the URL.
  if (canonicalPinsFor(url, d.pins).includes(provenPub)) return true;

  // ROOT 2 — the page's own serving origin.
  if (sameOriginRelay(url, d.origin)) return true;

  // ROOT 3 — this church's own signature. PUBKEY ONLY: `e.url` is a hint about where the box was last seen
  // and is never compared with the URL we dialled, because a tunnelled relay's address changes on every
  // restart and matching on it would un-admit a church's own box every time it reboots.
  let entries = null;
  try { entries = d.netEntries ? await d.netEntries(cp) : null; } catch { entries = null; }
  if (Array.isArray(entries) && entries.some(e => e && String(e.pubkey || '').toLowerCase() === provenPub)) return true;

  return false;
}
