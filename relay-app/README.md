# TrinityOne — Relay (self-host core)

The box that carries your church's messages, run on your own computer. Two ways to run it:

- **Easiest — the TrinityOne Suite** (macOS / Windows / Linux desktop app): double-click to install, pick
  *Run your church* (the console) or *Mind the server* (the relay panel), click **Go public** for a free no-account Cloudflare tunnel, and claim a
  memorable **name** members connect by. Get it from the app's Downloads page — nothing to type.
- **Always-on server** (Raspberry Pi / mini-PC / old laptop / VPS): the one-line installer below runs it
  as a hardened systemd service.

This README covers the server core; the Suite wraps the same relay.

## Install on a Linux box, one line *(recommended — always-on)*
For a relay that runs on boot and keeps running with nothing left open — on a Raspberry Pi, a
mini-PC, an old laptop, or a VPS (any apt-based Linux; not Pi-specific):

```bash
curl -fsSL https://app.trinityone.church/relay-app/install.sh | sudo bash
```

It installs Node if needed, fetches the app, runs the relay as a hardened `systemd` service under a
dedicated `trinityone` user, asks for your church npub (write policy) and **lets you pick how it's
reachable** — Tailscale, a Cloudflare quick tunnel, or LAN-only. Non-interactive / scripted:

```bash
curl -fsSL …/install.sh | sudo bash -s -- --church npub1… --name "Grace Chapel" --tunnel tailscale -y
```

Flags: `--church <npub[,npub…]>` · `--name` · `--tunnel tailscale|cloudflared|none` · `--port` ·
`--dir` · `--branch` · `-y`. Re-run any time to update. Manage with `systemctl status trinityone-relay`.

## Or run it from a window (no install — needs Node)
- **Mac:** double-click `start.command`
- **Windows:** double-click `start.bat`
- **Linux:** `./start.sh` (or `node start.mjs`)

Optional port: `node start.mjs 8000`.

It starts the relay (`../scripts/gateway.mjs`), works out how members reach it (Tailscale Funnel if
one's up, else your LAN address), and prints:
- the **Steward console** URL (you manage your church here),
- the **member relay** `wss://…/relay` (carried automatically in the invites you share),
- a warning if it's not publicly reachable yet.

Leave the window open; close it to stop the relay.

## Which church it serves — set it up in the browser
Open the **control dashboard** (`/relay-app/control.html`) and, under *Churches on this relay*, paste
your church's `npub` (from the Steward console) and Save. It writes the relay's write policy and applies
it instantly — no file editing, no restart. The relay only accepts writes from churches listed there.

Configuring from the relay's **own computer** fills the admin token in automatically — the relay hands it
only to genuine same-machine requests (`/local-token`, loopback-fenced). Configuring from **another device**
needs the token: it's printed by the installer, or `journalctl -u trinityone-relay | grep "admin token"` on
a Linux server box. Enter it once in the dashboard.

The config is stored in `../relay/church.json`; you can still edit it by hand + `systemctl restart` if
you prefer.

## Shipped
- **Desktop Suite** (Tauri) — this launcher + control panel as an installer with a setup wizard,
  auto-update, and a **bundled Cloudflare quick tunnel** ("Go public", no account).
- **Connect by name** + **Auto-find relays**, **invite-only** + **offer-to-host**, whole-relay
  **backup & restore**, per-church **storage caps**, and a **federated (mirrored) relay-name directory**
  so discovery survives any single host going down.
