# Scope — Relay app + setup wizard (v0.7 self-hosting)

**Goal (marketing promise):** a steward installs one desktop app on **Windows / Mac / Linux**,
double-clicks it, answers a few questions, and their church's relay is running and reachable from
members' phones anywhere — **without writing or running code**.

Builds on `reference/proposal-relay-app-steward-console.md` (the architecture decisions) and reuses
the existing `stew-relay.jsx` mock as the control UI. High-stakes (relays + networking) — the two
decisions below need a **go** before the desktop build starts.

---

## What we already have (reuse, don't rebuild)
- **Relay engine:** `scripts/gateway.mjs` — Node, NIP-01 relay at `/relay`, static app server, push,
  feed proxies, multi-church write policy, addressable dedup, WS keepalive. This IS the relay; the app
  wraps it.
- **Reachability proven:** the pilot already runs gateway + **Tailscale Funnel** end-to-end.
- **Control UI:** `stew-relay.jsx` (`RelayNodeApp`) — status, event log, network health, OS toggle.
  Currently mock (`stew-data.jsx`, "Grace Chapel"); wire it to the live relay.
- **Console:** `steward.html` already pairs with the relay (it's served by the gateway).

## The wizard flow (first-run of the desktop app)
1. **Welcome** — "Run your church's relay." Plain-language: this is the box that carries your
   church's messages; it stays on your computer.
2. **Church key** — *Create a new church* (generate seed, show the 12-word recovery + "write it
   down" gate, reuse the member `BackupWalkthrough` pattern) **or** *Restore an existing church*
   (paste phrase / restore from backup file). Writes `relay/church.json`.
3. **Start the relay** — launch `gateway.mjs` as a child process; show it go green (reuse the
   `RelayNodeApp` status panel).
4. **Make it reachable** — start the tunnel (see DECISION 2); show the public `wss://…/relay` URL +
   the steward console URL + the **member invite QR** (already built). This is the moment "reachable
   from anywhere" becomes real.
5. **Done / running** — minimise to tray; relay + tunnel run in the background, auto-restart on
   crash, auto-start on boot (opt-in). The `RelayNodeApp` becomes the everyday control window.

## Edge/empty states to design + handle
- Tunnel fails / offline → clear status + retry, never a dead "connecting…".
- Port already in use → pick another, surface it.
- Computer asleep/off → members can't reach the relay; say so plainly (and this is the honest
  argument for the church running an always-on mini-PC, or a hosted relay).
- First-run with no key vs returning with a key.

## Decisions needed before building (propose-then-go)

**DECISION 1 — relay engine.** Ship **NIP-01 (our `gateway.mjs`) now** + the multi-church allowlist
(already built), NIP-29 (Khatru, relay-enforced groups) as a later upgrade — **or** go straight to
NIP-29. *Recommend: NIP-01 now* (the app already works tag-based; NIP-29 is additive and heavier).

**DECISION 2 — tunnel / reachability.** Bundle a tunnel so there's no router config:
- **Tailscale Funnel** — already proven in the pilot; identity-based; public URL works. Steward
  installs Tailscale. *Lowest risk — we run it today.*
- **Cloudflare Tunnel (`cloudflared`)** — outbound-only, free, stable `trycloudflare`/custom domain,
  fully bundleable. *Recommended in the proposal for a clean "no extra account" install.*
- **Manual port-forward** — too technical for the target user; not for v0.7.
*Recommend: Tailscale now (we've proven it), evaluate bundling cloudflared for the public build.*

**DECISION 3 — packaging.** **Tauri** (Rust, ~10MB, native webview, control UI = `stew-relay.jsx`,
backend spawns relay+tunnel as child processes, Tauri auto-update) over Electron (~150MB). Real work:
cross-platform build, code-signing/notarization (Apple), and the updater. *Recommend: Tauri.*

## Build increments
- **v0.7.0 — runnable core (no GUI yet):** a cross-platform launcher (Node + OS double-click
  wrappers) that runs the first-run wizard in a local browser page, starts gateway + tunnel, and
  prints the URLs. Decision-independent; proves the flow; testable now.
- **v0.7.1 — Tauri shell:** wrap the launcher + `RelayNodeApp` control UI in a signed desktop app,
  tray, auto-start, auto-update.
- **v0.7.2 — polish:** bundled tunnel (per DECISION 2), health/restart, "your relay is offline"
  member-side messaging.

## Out of scope (for v0.7)
Giving/treasury (post-1.0), NIP-29 migration (later), multi-steward delegation (NIP-26), the hosted
multi-tenant relay as a product (the shared relay already covers pilot churches without their own box).
