# TrinityOne — Relay app (v0.7.0 runnable core)

The box that carries your church's messages, run on your own computer. This is the **runnable core** —
the launcher the packaged desktop app (Tauri, signed installer) will wrap so there's nothing to type.

## Run it now (no packaging yet — needs Node installed)
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

## Which church it serves
Edit `../relay/church.json` (`{ "churches": [ { "npub": "npub1…", "name": "…" } ] }`) with your
church's npub from the Steward console. The relay only accepts writes from churches it's configured for.

## What's next (see `reference/brief-relay-app-wizard.md`)
- **v0.7.1** — Tauri shell: this launcher + the `stew-relay.jsx` control UI as a signed desktop app
  with a setup wizard, tray, auto-start, auto-update.
- **v0.7.2** — a **bundled tunnel** so "reachable from anywhere" needs no extra account or setup
  (Tailscale vs Cloudflare — DECISION 2).
