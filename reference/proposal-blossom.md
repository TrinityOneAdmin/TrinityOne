# Censorship-resistant module distribution — design proposal

*Branch: `claude/blossom` · Scoped + **built end-to-end** 2026-06-23. Phases 1 & 2 ship together;
torrent disaster-archive layer is in (mktorrent-best-effort). E2E test passes on the dev box.*

**Decisions locked in (2026-06-23):**
- **Content-key custody:** lives at `relay/catalog-key.json` on the release host — same custody
  model as `relay/release-key.pem`. (Mechanically a separate key, because Nostr is secp256k1 and
  release-key.pem is Ed25519; "same" = same operational practice, same disk, same backup story.)
- **Phase 1 + 2 ship together** in this branch's merge to main.
- **Torrent archive layer IN scope.** Best-effort: `scripts/build-torrents.sh` warns-and-skips
  if `mktorrent` isn't installed (`sudo apt install mktorrent` to enable).

**Catalog publisher pubkey:**
`e328e19897fb925307b2c2044c2d874cf56e4478b04952d67d7ab3fd93411f10`
(burned into `engine.js` as `CATALOG_PUB` and `scripts/gateway.mjs` as the relay-side carve-out.)

---

## Why

Today every Bible, lexicon, and the `catalog.json` listing them all is fetched from one host
(`ASSET_BASE` → `trinityone.tailbeaac0.ts.net`, soon `trinityone.church`). If that host is blocked
— Cloudflare account closed, DNS poisoned, an ISP/state blocking the domain — members lose access
to **both the list and the bytes**, even though Bible content is public-domain and the chat
network is already decentralised across multiple relays.

The chat layer is already several steps down this path (signed events, multiple canonical relays,
client-side roster verification). Module distribution is the remaining single point of failure.

**Threat model:** hostile state / ISP-level blocking of the trinityone.church host. Not "someone
serves a tampered Bible" — content integrity is already handled by sha256 verification in
`engine.js installModule()` (see `KNOWN_HASHES`, `verifyIntegrity`), so a wrong byte never reaches
the parser. The remaining attack is *blocking the bytes from arriving at all*.

**Non-goal:** anonymity. Members can still be identified by their connections to relays/mirrors;
TrinityOne's pseudonymity comes from the Nostr identity layer, not the transport.

## Already in place — leverage, don't rebuild

- **sha256 integrity**: `engine.js` lines 341–369. `KNOWN_HASHES` for the two bundled defaults,
  plus per-entry `sha256` field on any catalog entry. Verification happens before cache/parse —
  any mirror that serves the wrong bytes is rejected client-side. This is the foundation that
  makes Phase 1 *and* Phase 2 trustworthy.
- **Multiple canonical relays**: `src/fellowship.src.js CANONICAL_RELAYS` (master-01 + dev box;
  NAS in `reference/SPINE.md`). Already the pattern we'd extend.
- **Indexeddb cache for modules**: `cacheGet/cachePut/cacheKeys` in engine.js. Once a member has a
  module, subsequent loads are local — re-fetch only matters for first install / new module.
- **Relay app installer** (`relay-app/install.sh`) already lets a church run its own gateway.
  Phase 2 turns each one of those into a Blossom mirror automatically.

---

## Phase 1 — Multi-mirror URLs + per-entry sha256

**Goal:** if any one of N hosts is up, anyone can install any module. No new protocols, no new
deps. Immediate resilience win against single-host failure and casual blocking.

### catalog.json schema change

Today:
```json
{ "id": "strongs", "url": "modules/strongs-dict.json", "sha256": "…" }
```

Phase 1:
```json
{ "id": "strongs",
  "url": "modules/strongs-dict.json",                  // primary, kept for back-compat
  "mirrors": [
    "https://relay.master01.example/modules/strongs-dict.json",
    "https://nas.example/modules/strongs-dict.json"
  ],
  "sha256": "…" }
```

Decisions:
- **`url` stays as primary** for back-compat (older installs keep working).
- **`mirrors: []`** is the new optional array; clients try `url` first, then each `mirror` in
  order, with exponential backoff between failures.
- **`sha256` becomes mandatory** on every catalog entry (currently only bundled defaults are
  pinned). The release pipeline computes and writes it.

### engine.js installModule changes

Replace the single `fetch(resolveAsset(item.url))` with a loop:

```js
const candidates = [item.url, ...(item.mirrors || [])];
let lastErr;
for (const u of candidates) {
  try {
    const res = await fetch(resolveAsset(u));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await verifyIntegrity(item.url, bytes, item.sha256);   // verify against the CANONICAL hash,
    await cachePut(item.url, bytes);                       //   not the mirror's URL — so a mirror
    return bytes;                                          //   serving wrong bytes is rejected
  } catch (e) { lastErr = e; }
}
throw lastErr;
```

Same `verifyIntegrity` — sha256 still proves you got the right file regardless of who served it.

### Release pipeline change

`scripts/release.sh` (or a new `scripts/build-catalog.sh`):
1. Walk `modules/`
2. Compute sha256 of each file
3. Write/update each catalog entry's `sha256` field
4. Fail if a hash for a known module changed without the file changing (catches dev-side
   tampering)

### Which hosts become mirrors

For the pilot, every host already in the network gets `/modules/*` served:
- `trinityone.church` (a8 box — primary, post-domain-switch)
- `trinityone-master-01.tailbeaac0.ts.net` (master-01 relay box — already serves the app stack)
- `trinityone-nas.tailbeaac0.ts.net` (NAS relay — already serves the app stack)
- `trinityone.tailbeaac0.ts.net` (dev box — temporary, kept while pilot stabilises)

`gateway.mjs` already serves static files under `modules/` on each of these, so the work is
mostly: build a list, drop it into `catalog.json`, ship.

### Estimated work

~1 day. Mostly:
- engine.js loop (30 min)
- catalog.json schema + back-compat (1 hr)
- release-script hash computation (1 hr)
- catalog regeneration with all current modules' hashes (15 min)
- testing under simulated mirror-down conditions (1 hr)
- doc updates (1 hr)

### What Phase 1 covers — and doesn't

✅ trinityone.church goes down → other mirrors serve.
✅ A regional CDN POP failure → other mirrors serve.
✅ One mirror serves tampered bytes → sha256 rejects; next mirror tried.
✅ A new module is added → `release.sh` hashes it; catalog updated; mirrors re-serve.

❌ Catalog itself is HTTP-served from one host. Block trinityone.church and members never **see**
the module list, even though the mirrors host the bytes. ← *That's Phase 2.*
❌ Block all known mirror IPs (Tailscale + Cloudflare ranges) and members can't reach any of them.
   ← *Also Phase 2.*

---

## Phase 2 — Blossom blob servers + catalog as a signed Nostr event

**Goal:** state-level censorship of the whole TrinityOne domain doesn't stop a member from getting
a Bible, as long as they can still talk to *some* Nostr relay.

### Two pieces, working together

**(a) Blossom on every church relay.** Blossom is the Nostr ecosystem's settled answer to "where
do binary blobs live": a tiny HTTP API (`GET /<sha256>`, `PUT /upload`) where files are addressed
by their sha256. Any server holding that hash serves it. The client just needs *any* Blossom
server in its list to return 200 with bytes matching the hash.

Why Blossom, not raw Nostr events:
- Nostr `content` field is text-only and size-capped (typical 64–256 KB).
- A 4 MB lexicon would need 60+ chunked events; relays reject; verification cost adds up.
- Blossom requests **look like plain HTTPS GET on a random path** — same network fingerprint as
  fetching an image. No protocol-level signature for DPI to match.

**(b) Catalog as a signed kind:30078 event.** Today `catalog.json` is HTTP. Block the host →
members don't even know what's available. Phase 2 publishes the catalog as a NIP-78 addressable
event signed by a stable **TrinityOne content key**, listing modules by sha256 + Blossom
server hints:

```json
// content of the signed kind:30078 event, d=catalog:trinityone, signed by CONTENT_KEY
{
  "version": 2,
  "categories": [
    { "id": "bibles", "items": [
      { "id": "engbsb", "name": "Berean Standard Bible",
        "sha256": "a7f61bf7…", "size": 3021299, "format": "USFM",
        "servers": [ "https://relay.master01…/blossom",
                     "https://nas.example/blossom" ] } ] }
  ]
}
```

The pubkey of CONTENT_KEY is baked into the app at build time. The client subscribes for
`{kinds:[30078], authors:[CONTENT_KEY_PUB], "#d":["catalog:trinityone"]}` across canonical relays
and the church's own relay; the latest signed event wins. The sha256s in the event are the
authority — even a malicious relay can't substitute the catalog (signature would fail) nor
substitute bytes (sha256 would fail).

### engine.js changes (Phase 2)

```js
async function getCatalog() {
  // 1. Try the signed Nostr catalog first (works as long as ANY canonical relay is reachable)
  try {
    const evt = await fetchLatestCatalogEvent(CONTENT_KEY_PUB);   // via window.Fellowship
    if (evt && verifyEventSig(evt)) return JSON.parse(evt.content);
  } catch {}
  // 2. Fall back to HTTP catalog (Phase 1 mirrors)
  return fetch("catalog.json").then(r => r.json());
}

async function installModule(item) {
  // Try every Blossom server, in random order, then Phase-1 HTTP mirrors as fallback
  const sources = shuffle([
    ...(item.servers || []).map(s => s.replace(/\/$/,"") + "/" + item.sha256),
    item.url,
    ...(item.mirrors || []),
  ]);
  for (const u of sources) { /* same fetch+verify loop as Phase 1 */ }
}
```

### gateway.mjs changes (Blossom server)

A tiny addition to the gateway — a few dozen lines:
- `GET /blossom/<sha256>` → stream the file from `modules/` if its sha256 matches.
- `GET /blossom/list` → list of sha256s this server holds (optional, useful for monitoring).
- Optional `PUT /blossom/upload` requiring NIP-98 (HTTP Auth) signed by an authorised pubkey — for
  letting trusted operators replicate content. Initially write-disabled; we only need *read* to
  be censorship-resistant.

The relay-app installer (`relay-app/install.sh`) already drops `gateway.mjs` + the `modules/`
directory on every new church relay, so every new relay automatically becomes a Blossom mirror.

### Content key management

This is the highest-value secret in the design. Considerations:
- Lives **offline**, used only at release time to sign the catalog event.
- Lost key = forced ecosystem rotation (publish a new pubkey via a release of the app, members
  pull the new app). Survivable but painful.
- Compromised key = attacker can publish a fake catalog pointing at malicious modules — but
  sha256 verification of bundled defaults (`KNOWN_HASHES`) still protects the *core* downloads.
  Worth keeping `KNOWN_HASHES` as a hard floor even after Phase 2.
- Practical place to live: same place the release-signing key for `relay/release-key.pem` lives
  (the dev box, gitignored, with documented backup). Same operational footprint.

### Estimated work

~5–7 days.
- Blossom server in gateway.mjs (~1 day, including tests)
- Catalog-event publisher (~1 day; new script + key handling)
- engine.js catalog/install rewrites (~1 day)
- Wiring through Fellowship to fetch the signed catalog (~1 day)
- End-to-end test: block trinityone.church at /etc/hosts, verify install still works (~half day)
- Doc + release-runbook updates (~half day)

### What Phase 2 covers — and doesn't

✅ trinityone.church blocked at DNS or IP layer → catalog rides on any relay, bytes ride on any
   Blossom server with the sha256.
✅ A whole region's mirrors blocked → as long as members can reach *one* relay (and one mirror),
   bytes arrive.
✅ Malicious mirror substitutes bytes → sha256 reject + try next.
✅ Malicious relay substitutes catalog → signature reject + try next relay.

❌ Total internet shutdown / state cuts the country off the global internet. ← *No realistic
software answer; this is the case for the disaster-archive layer below.*
❌ State coerces the relay operator to log who's downloading what. ← *Genuine concern. Mitigation
is operational (church runs its own relay/Blossom server, so logs stay local); the protocol
doesn't anonymize. If this matters, layer Tor — out of scope for this proposal.*

---

## Optional — Disaster-archive layer (torrents)

For the case where the whole project is taken down (every gateway, every relay, every CF
account): publish each module as a `.torrent` and include the magnet URI in the catalog.

The app **does not** use these for active distribution (torrents are mobile-hostile, DPI-blocked
in censorious states, and slow to bootstrap). They exist as an archive layer: anyone with
`aria2`/`transmission` and a copy of the signed catalog can recover the entire module library
from the swarm without any TrinityOne infrastructure.

### Work

~0.5 day. Generate `.torrent` files (one shell command per module: `mktorrent -o … -a …`), add
`magnet:` URIs to catalog entries, document the recovery path. Magnet URIs are tiny strings; zero
cost to carry in the catalog.

Skip this if it adds friction; it's genuinely nice-to-have, not load-bearing.

---

## Release/ops impact

- **release.sh** gains a "publish signed catalog" step after the web/APK deploy. Fails the
  release if the content key isn't available (rather than silently regressing to HTTP-only).
- **relay-app/install.sh** doesn't need to change — once Phase 2's gateway.mjs ships, every
  install is a Blossom mirror automatically. Worth a one-line note in `STEWARD-GUIDE.md`.
- **Member app**: zero UX change. Install screens look identical; users won't know which transport
  served their Bible. The "Installed" / spinner / Get button flow is preserved.
- **APK / web bundle size**: no new JS deps. Blossom client is ~30 lines of fetch + verify.
  Catalog-event fetcher reuses `window.Fellowship` already in the bundle.

---

## Branch plan

- **`claude/blossom`** — this branch. Long-lived while Phase 2 is in flight (~1 week). Periodic
  merge from `main` to keep pace with pilot fixes.
- **Phase 1 merges back to main early** — it's low-risk, immediate resilience benefit, and
  doesn't depend on Phase 2 being done. Worth shipping mid-pilot.
- **Phase 2 stays on the branch** until end-to-end test passes (block trinityone.church locally
  via `/etc/hosts`, verify catalog + install both succeed via Nostr/Blossom path).

## Open questions for the user

1. **Content-key custody.** Same dev box as `relay/release-key.pem`? Or a separate offline
   air-gapped key? (Affects operational complexity vs blast radius if compromised.)
2. **Phase 1 ship timing.** Ship Phase 1 to main as soon as it's done (mid-pilot), or hold for
   Phase 2 and ship them together?
3. **Torrent archive layer.** In scope, or skip until a real need shows up?

---

## Out of scope (worth naming, not building now)

- **Module *publishing* from the app** (members upload a translation; Blossom PUT). Interesting
  for non-English Bibles; not a censorship-resistance concern. Separate proposal if pursued.
- **Member-to-member modules** (a member who has Bible X seeds it to neighbours over WebRTC). Real
  P2P, but mobile-hostile and battery-hostile; better as a follow-up if Phase 2 isn't enough.
- **Onion-routing or Tor** for the mirror connections. The "state coerces operator to log
  downloads" attack would need this. Out of scope; flag it if it ever becomes a live concern.
