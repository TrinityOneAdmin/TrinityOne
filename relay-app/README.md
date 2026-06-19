# TrinityOne — Relay app (v0.7.0 runnable core)

The box that carries your church's messages, run on your own computer. This is the **runnable core** —
the launcher the packaged desktop app (Tauri, signed installer) will wrap so there's nothing to type.

## Install on a Linux box, one line *(recommended — always-on)*
For a relay that runs on boot and keeps running with nothing left open — on a Raspberry Pi, a
mini-PC, an old laptop, or a VPS (any apt-based Linux; not Pi-specific):

```bash
curl -fsSL https://raw.githubusercontent.com/swasb-altFreeBird/TrinityOne/main/relay-app/install.sh | sudo bash
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

Configuring requires the relay's **admin token** (the relay runs behind a tunnel that proxies from
localhost, so it can't safely treat "local" requests as trusted). The token is printed by the installer,
or `journalctl -u trinityone-relay | grep "admin token"` on the relay box — enter it once in the dashboard.

The config is stored in `../relay/church.json`; you can still edit it by hand + `systemctl restart` if
you prefer.

## What's next (see `reference/brief-relay-app-wizard.md`)
- **v0.7.1** — Tauri shell: this launcher + the `stew-relay.jsx` control UI as a signed desktop app
  with a setup wizard, tray, auto-start, auto-update.
- **v0.7.2** — a **bundled tunnel** so "reachable from anywhere" needs no extra account or setup
  (Tailscale vs Cloudflare — DECISION 2).
