# TrinityOne Church Box — Sovereign Infrastructure Appliance (design)

**Status:** design draft · 2026-07-04

A "flash a drive, boot, done" appliance that gives a church its OWN infrastructure: the TrinityOne **relay + steward console**, and — as a bonus — a **Bitcoin full node + Lightning node**. On-ethos: every church sovereign, "owned by no one," reachable even over a thin or hostile pipe.

## 1. What runs on the box
- **Relay + steward console + member app = ONE Node service.** The relay (`gateway.mjs`) already serves the console, the member app, and the modules/audio (its `/status` shows `serves: {app, modules, audio}`). So "relay + console" is a single service to run, not two to wire together. **This core is light** — it runs on a Pi or any mini-PC.
- **Bonus: a Bitcoin node + Lightning node** — self-custodial giving/finance receiving (see `FINANCE-MODULE.md`) and contributing to the network. This is the heavy part (§5).

## 2. Key insight — don't rebuild the node appliance
A mature category of **sovereign-node appliance OSes** already does "flash → boot → Bitcoin full node + Lightning node + app store + auto-updates + backups + Tor": **Start9 (StartOS)**, **Umbrel**, RaspiBlitz, myNode. The highest-leverage move for the BTC/LN bonus is to **package TrinityOne (relay + console) as a service on one of those** and inherit the whole node/OS/update/backup stack — rather than build node management ourselves.

- **Start9 / StartOS** is the strongest ethos match: no accounts, privacy/sovereignty-first, open-source, **Tor-first**.
- **Umbrel** is the more consumer-polished alternative (bigger app store).

**Tor is a mission feature, not a footnote.** A church relay published as a **Tor hidden service (`.onion`)** is reachable anywhere, censorship-resistant, and needs **no domain, no static IP, no port-forwarding** — exactly what the persecuted-church / thin-pipe audience needs. Start9/Umbrel give `.onion` addressing for free.

## 3. Two build paths
- **Light path — relay + console only.** A custom **Debian-stable appliance image**: tiny, runs on anything, with the relay/console + a baked-in tunnel + a first-boot setup wizard. Add BTC/LN later. Fast to build, fully our own, fully branded.
- **Sovereign path — the full vision.** **Package TrinityOne as a Start9/Umbrel service.** The church flashes StartOS, adds the "TrinityOne" app, and gets relay + console + **BTC full node + LN node + `.onion` + updates + backups**. Our work shrinks to a service manifest (Docker + a manifest) wrapping what we already ship.

## 4. The three things that are actually hard (the OS is the easy 20%)
1. **Public reachability.** Churches sit behind home routers (dynamic IP / CGNAT / no port-forwarding). Answer: a **tunnel** (we already use Cloudflare tunnels + Tailscale) or a **Tor hidden service** (Start9/Umbrel) — the box serves publicly with **zero router config**. Tor also gives censorship resistance.
2. **Domain + TLS.** Auto-issuing each church a `<church>.trinityone.church` + cert needs a small provisioning service on our side; **Caddy** handles the cert (auto-HTTPS). The `.onion` route sidesteps domains entirely.
3. **Updates over years.** Unattended security updates + the **signed relay self-update** (already exists). Image-based/immutable OS (Start9 / Ubuntu Core / balena) makes updates atomic (A/B). Otherwise Debian `unattended-upgrades`.

## 5. Bitcoin node reality (plan hardware around this)
- **Full/archival node:** ~**600 GB+** and growing → a **1 TB SSD**, plus a **multi-day initial sync**. Only if the church wants to *serve* the network.
- **Pruned node (recommended for most):** validates fully but keeps only recent blocks → **~10–50 GB**, much faster. Plenty for **non-custodial Lightning receiving** (the giving/finance use).
- So: relay + console = runs on anything; **+ pruned BTC/LN = a mini-PC with a ~256 GB+ SSD**; + full archival = 1 TB SSD and patience.

## 6. Don't forget
- **Backups / keys.** The box can die. Church *data* replicates to other relays via Nostr; **keys need the same recovery-phrase backup discipline** the app already has, plus a wallet/LN seed backup if the node is bundled.
- **Public-relay abuse control.** A public relay faces spam / disk-growth. The relay's `accept()` write-gates, the M1 per-member doc cap, and culling already cover much; tune caps + size storage per box.

## 7. Tooling
- **Plain image build:** `mkosi` or `debos` (configured Debian, per-architecture images).
- **Appliance / fleet OTA:** **balenaOS** (container-based, fleet OTA; `openBalena` self-hostable) or **Ubuntu Core** (snaps, transactional).
- **Sovereign service:** the **Start9 service SDK** or the **Umbrel app** format (Docker + a manifest).

## 8. Recommendation & phasing
- **P1 — the light box:** custom Debian image (relay + console + tunnel + first-boot wizard). Runs on any hardware; immediately useful. The near-term "church box."
- **P2 — the sovereign box:** package TrinityOne as a **Start9/Umbrel service** → BTC full node + LN + `.onion` + updates + backups, inherited. The `.onion` relay is a genuine mission feature.
- **Don't** build a distro from scratch, and **don't** reimplement node management — configure a base, or package onto a sovereign OS.

## 9. Open questions
1. **Sovereignty vs simplicity** — is Tor/`.onion` + full-node sovereignty part of the pitch (→ Start9), or is "just works" the priority (→ light Debian box + tunnel)?
2. **Hardware target** — mini-PC + SSD (recommended, room for pruned BTC/LN) or Pi-class?
3. **Pruned vs full** node, if bundled.
4. **Fleet size** — a handful (a script/image suffices) or many (worth balena / Start9 fleet management from the start)?

## 10. Relationship to existing infra
Not a from-scratch effort — it packages what exists: the relay (`gateway.mjs`, self-updating + signed), the tunnel/Tailscale networking (`GO-LIVE-DOMAIN.md`, `HOSTING.md`), and the install path (`install.sh` / `relay-update.sh`) into a flashable image + first-boot wizard.
