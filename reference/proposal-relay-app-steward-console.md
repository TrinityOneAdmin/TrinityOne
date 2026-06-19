# Proposal: church-run Relay app + real Steward console (propose-then-go)

Status: DRAFT for review. To be green-lit AFTER the pilot validates the app -- not before. This is
the SPINE's tiered-relay architecture made real: each church runs its own relay, stewards manage it.
High-stakes (keys, relays, networking, money) -- propose, never assume.

Relates to: `reference/SPINE.md` (Relay topology + Fellowship), the `stew-*.jsx` design mocks +
`steward.html`, `HOSTING.md` (the pilot stopgap this replaces), `reference/proposal-mydata-nostr-backend.md`.

---

## 1. Goal

Let a non-technical church **run its own relay and manage its community** without anyone hand-setting
it up. Two deliverables:

- **Relay app** -- a desktop app (Mac/Win/Linux) a steward installs; it runs the church's relay and
  makes it reachable from members' phones anywhere.
- **Steward console** -- the web manager (currently a mock) wired to real Nostr: funds, groups,
  members, keys.

Why a church-run relay at all: per the SPINE, group membership = access control enforced *by the
relay*; congregation data stays on a box the church controls; nothing sensitive on public relays.

---

## 2. Relay app

Maps to `stew-relay.jsx` (the mock: status, event log, network health, OS toggle). Three layers:

### (a) The relay engine
The pilot's `dev-relay.mjs` (NIP-01, JSON file) is a toy. Production options:
- **Khatru + relay29** (Go) -- real **NIP-29** managed groups (relay-enforced membership/roles). Best
  fit for the SPINE's access-control model. Heavier to embed.
- **nostr-rs-relay** (Rust) -- mature **NIP-01** with `[authorization]` write-allowlist. Matches the
  app's *current* tag-based transport; simpler. NIP-29 is a later upgrade.

DECISION 1: ship NIP-01 (nostr-rs-relay) now + allowlist writes, NIP-29 (Khatru) later -- **or** go
straight to NIP-29. (Recommend NIP-01-now; the app already works tag-based, and NIP-29 is additive.)

### (b) Reachability -- THE hard part
A relay on a church's home/office wifi is behind NAT with no public IP; members on cellular can't
reach `ws://192.168.x.x`. The mock promises "reachable from anywhere, secure tunnel, no router
setup." Delivering that is the real engineering. Options:
- **Embedded tunnel -- Cloudflare Tunnel (`cloudflared`)**: outbound-only, free, gives a stable
  `https://<name>.trycloudflare` or a custom domain with auto-TLS -> instant `wss://`, no router
  config. RECOMMENDED. (Tradeoff: depends on Cloudflare; a church domain is a paid nicety.)
- **Tailscale Funnel**: similar, identity-based; members would need... no -- Funnel is public, works.
- **Port-forward + Let's Encrypt**: "honest self-host," but needs router access + a domain -> too
  technical for the target user.

DECISION 2: bundle Cloudflare Tunnel (recommended) vs Tailscale vs leave networking manual.

### (c) Packaging + control UI
- **Tauri** (Rust, ~10MB, native webview) over Electron (~150MB) -- the control UI is the existing
  `stew-relay.jsx`, the backend spawns/monitors the relay + tunnel as child processes. Auto-update
  via Tauri updater. Cross-platform signing/notarization is real packaging work.

---

## 3. Steward console (real)

Make the `stew-*` mock a real Nostr web client (no bespoke server -- relays + signer + Lightning).

- **Signing**: church key via **NIP-07 extension** and/or **NIP-46 phone bunker** (the wizard already
  offers both). Build the signer abstraction; never hold the secret in the console.
- **Funds**: publish/edit fund definitions as replaceable **kind-30078** events (signer-approved).
- **Groups**: create/manage NIP-29 groups (if Decision 1 = NIP-29), else tag-based group config docs.
- **Members + stewards**: list members from the relay; promote stewards via **NIP-26 delegation**
  (the mock's PromoteModal) -- never reveals anyone's giving.
- **Giving custody** stays SPINE Phase 2 (Strike/LNbits, money) -- console *defines* funds + Lightning
  addresses now; the money rail is its own slice.

DECISION 3: which signer(s) for v1 -- NIP-46 phone-bunker (most secure, matches phone steward mode),
NIP-07 extension, or both.

---

## 4. Phasing

- **Phase A -- Relay reachability (the crux).** Relay engine choice + embedded tunnel + TLS, so a
  church box is reachable as `wss://` from any network. Validate with two phones off-wifi. Highest
  risk; do first.
- **Phase B -- Steward console real wiring.** Signer + funds + members/delegation against the church
  relay. Mostly in-our-control Nostr-client work.
- **Phase C -- Packaging + onboarding.** Tauri build/sign/notarize/auto-update; the setup wizard
  (`StewWizard`) end-to-end; the join-QR flow for members.

---

## 5. Effort (rough)

- Phase A: weeks -- the tunnel/TLS/relay-supervisor + cross-platform packaging is the bulk.
- Phase B: ~1-2 weeks -- it's a focused Nostr client over existing designs.
- Phase C: weeks -- desktop packaging/signing/notarization + auto-update are fiddly per-OS.

This is a multi-week program, not a slice. It earns its place once the pilot shows the app is worth
scaling to church #2+ without manual setup.

---

## 6. Out of scope / guardrails

- Giving/Lightning money rail (Phase 2, separate). Argon2id cloud backup (separate).
- Native NIP-84/51 data kinds (the MyData follow-up, separate).
- Keys/relays/money: every piece is propose-then-go; the church secret key never leaves the steward's
  signer; default congregation data to NIP-29 group scope or encrypted.

---

## Decisions needed before "go"

1. Relay engine: nostr-rs-relay (NIP-01) now + NIP-29 later -- or Khatru/NIP-29 now?
2. Reachability: bundle Cloudflare Tunnel -- or Tailscale, or manual?
3. Signer for the console: NIP-46 phone-bunker, NIP-07 extension, or both?
4. Sequencing: confirm pilot-first (this stays parked until the pilot validates) -- or start Phase A now?

Recommended: nostr-rs-relay + Cloudflare Tunnel + both-signers, and keep this parked until the pilot
runs. Reply with amendments + a "go" to start (Phase A first).
