# TrinityOne Federation Plan

**Status:** in progress on branch `federation` (started 2026-07-07)
**Goal:** move from the single shared relay (a8, hardcoded) to a decentralised model where
churches (or networks of churches) run their own relays and media hosts, discover each other
cleanly, and depend on *no infrastructure the project pays for or centrally controls*.

This is a live pilot with real use. Every step here is **additive, reversible, and keeps a8 as
the default** until the replacement is proven. The dangerous moves — dropping a8, auto-adopting
relays we don't run — come LAST, behind capability checks and version gates.

---

## 1. Principles (the threat model drives the design)

1. **No central chokepoint.** A relay/host we run centrally is a single point that can be
   surveilled, pressured, or seized — the exact failure the underground church can't afford.
   Decentralisation is a *security* property here, not just a cost one.
2. **Sustainable = we ship software, not infrastructure.** The project owns the relay + media
   software and the know-how; churches (or a tech-capable person in a network) host. At most one
   *optional, best-effort* bootstrap node, never depended on.
3. **Identity is the key, not the server.** Every event is signed by the church's key; any host
   serving it is verifiable. Relays and media hosts are interchangeable pipes → moving is safe.
4. **Visibility is a choice.** Advertising a relay/host or publishing a relay-list is *opt-in*.
   An open church advertises for easy discovery; a hidden church stays invite-link-only and
   invisible. Same code, per-church switch.
5. **Redundancy by default.** Always ≥2 relays/hosts, publish to all, read from the union — so
   one dying loses nothing and no single operator sees the whole church.
6. **Thin-pipe first.** Audio-first, low-bitrate, offline-cacheable. Must work over a throttled
   connection (the "does this work in Tehran" test).

---

## 2. Standards we build on (interoperable, not bespoke)

**Relays**
- **NIP-65** (`kind:10002`) — a church publishes a *signed* relay-list ("my content lives on A and
  B"). Members follow it; a church can move/add relays by republishing, without reissuing links.
- **NIP-66** — relay *discovery + liveness*: operators publish signed "offers" (open to churches?
  capacity? operator? region?), monitors publish liveness.
- **NIP-11** — a relay's info document (JSON at its root): name, policy, supported NIPs, and — our
  addition — a `trinityone` capability block declaring it *enforces* our membership/safeguarding
  policy and is multi-church.

**Media** (mirrors the relay story)
- **Blossom** — blobs stored by SHA-256 hash, served over HTTP, authorised by a signed Nostr event.
  Content-addressed → integrity, dedup, trivial mirroring (any host with the hash works → free
  redundancy).
- **NIP-94 / NIP-96** — file-metadata events + upload endpoints.
- **NIP-98** — signed HTTP auth → members-only download.

**Why these fit:** the current relay is *already multi-tenant* (it resolves the church per event and
gates writes by that church's roster — `resolveChurch` + `accept()`), and media already has the
`ASSET_BASE` serve+cache pattern (engine.js). Federation extends what exists; it is not a rewrite.

---

## 3. Media: two tiers, keep BOTH (we are NOT replacing YouTube/RSS)

The ask is to *add* private options, not remove the public mirror.

- **Tier 1 — unlisted, zero hosting (easy, near-term).**
  - *Unlisted* YouTube playlists/videos are **not searchable, not listed, not in any directory**,
    but ARE embeddable by ID — which is how the app already mirrors. So unlisted playlists give
    "not publicly discoverable" with no self-hosting. (Fully *private*/Google-gated does NOT embed —
    unlisted is the line.)
  - *Unlisted/tokenised RSS* (an unguessable feed URL not submitted to podcast directories) is
    effectively private; the app just fetches the URL. Auth-gated RSS is a later add.
  - Work: support embedding a *playlist* (not just single `ytId`) via
    `youtube-nocookie.com/embed/videoseries?list=…`; accept an unlisted feed URL.
- **Tier 2 — self-hosted (full control/encryption, later).**
  - Church media on its own host (gateway, a small Blossom server, or object storage). For cost,
    object storage with cheap/free egress (e.g. Cloudflare R2, zero egress) — **not** a 5G/home box,
    which chokes on video upload.
  - Gated by NIP-98 (members-only); optional encryption-at-rest (church/group key) for the
    sensitive case. Referenced by hash in a Nostr event → portable + mirrorable.
  - **Audio-first, download-not-stream** — encrypted video does not range-stream through a CDN
    cleanly, so audio sermons (small, offline-friendly) lead; low-bitrate video is optional.

The public YouTube/RSS mirror stays *available* — it becomes a choice, not a requirement.

---

## 4. Risks & mitigations (why we go slow)

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | **Non-enforcing relay = silent security downgrade.** Membership gate, safeguarding NIP-42 gating, DM-block, group-key acceptance live in OUR relay software; a generic Nostr relay enforces none of it. (Source already flags this: `fellowship.src.js:44`.) | Relays advertise a `trinityone.enforces` capability in NIP-11; **never route gated content to a relay without it.** Client already defends group-key *acceptance*; read-privacy depends on the relay. |
| 2 | **Data-stranding when a8 stops being default.** All pilot content lives only on a8; existing members are pinned to it. | Replicate to new relays first; keep a8 in every relay-list through transition; sunset only after propagation. |
| 3 | **Read/write split during rollout.** Old clients don't follow relay moves (no NIP-65 yet); publishing that moves before clients update → half-empty screens (`fellowship.src.js:117`). | Version-gate; publish to old+new simultaneously; keep union-read. |
| 4 | **NIP-65 publication leaks infrastructure** (exposes that/where a church self-hosts). | NIP-65 publish is **opt-in**; hidden churches stay invite-link-only. |
| 5 | **Malicious/honeypot offers + auto-adopt** (metadata to a honeypot — dangerous for persecuted churches). | Signed offers + operator identity/reputation; warn on unknown operators; ≥2 relays; high-risk churches default to self-host; adopt = vetted-only until proven. |
| 6 | **Bootstrap-seed chokepoint + multi-relay auth fan-out** (the M3/guardian auth is per-connection). | Multiple seeds, cacheable offers, manual entry always works; test auth across N relays. |

---

## 5. Phased rollout (additive → risky-last, each reversible)

**Phase 1 — advertise (fully additive, changes no current behaviour).**
- 1a. Relay serves a **NIP-11 info doc** with a `trinityone` capability block (`enforces`,
  `multiChurch`, software/version, supported NIPs). *Additive: only answers `Accept:
  application/nostr+json`.*
- 1b. Steward **publishes NIP-65 `kind:10002`** (its current relay list — today just a8) on church
  setup and on any relay change. *Additive: emits one signed event; nobody reads it yet.*

**Phase 2 — read, safely.**
- 2a. Client reads a followed church's `kind:10002` and merges its relays into the read union —
  **only** relays whose NIP-11 advertises `trinityone.enforces` (else ignore for gated content).
- 2b. Auth fan-out verified across multiple relays (safeguarding/invite-group, guardian M3).

**Phase 3 — discover + offer.**
- 3a. Relay operators publish signed NIP-66 **offers** (opt-in: open-to-churches, capacity, region,
  operator). Liveness pinging.
- 3b. New-church setup fetches offers, filters live+open+enforcing, **auto-picks 2** (primary +
  backup) with one-tap confirm/override; publishes the church's `kind:10002`.

**Phase 4 — decentralise the default (the risky, last step).**
- 4a. Make the hardcoded a8 fallback **opt-in** once churches have their own ≥2 relays and content
  is replicated. Reversible: a8 stays in the code, just not forced.

**Phase 5 — media Tier 1, then Tier 2.**
- 5a. Unlisted playlist + unlisted RSS support (near-term, no hosting).
- 5b. Blossom self-host + NIP-98 gating + optional encryption (later).

---

## 6. Guardrails checklist (apply to every phase)

- [ ] Never route gated content to a relay lacking `trinityone.enforces`.
- [ ] Every church has ≥2 relays; steward publishes to all.
- [ ] Relay-list publish + offer advertising are opt-in (hidden churches stay invisible).
- [ ] a8 remains the default until a church has proven replacement relays.
- [ ] Content stays portable (signed by church key; content-addressed media).
- [ ] Manual relay entry always available (bootstrap is discovery-only, never load-bearing).
- [ ] Each step ships behind a check that leaves current behaviour identical until flipped.
