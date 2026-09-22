# TrinityOne — Relay (self-host core)

The box that carries your church's messages, run on your own computer. Two ways to run it:

- **Easiest — the TrinityOne Suite** (macOS / Windows / Linux desktop app): double-click to install, pick
  *Run your church* (the console) or *Manage a relay* (the relay panel), click **Go public** for a free no-account Cloudflare tunnel, and claim a
  memorable **name** members connect by. Get it from the app's Downloads page — nothing to type.
- **Always-on server** (Raspberry Pi / mini-PC / old laptop / VPS): the one-line installer below runs it
  as a hardened systemd service.

This README covers the server core; the Suite wraps the same relay.

## Install on a Linux box *(recommended — always-on)*
For a relay that runs on boot and keeps running with nothing left open — on a Raspberry Pi, a
mini-PC, an old laptop, or a VPS (any apt-based Linux; not Pi-specific). Three commands, in this order:

```bash
curl -fsSL -o install.sh https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download/install.sh
less install.sh        # read it first — it pins the release key it checks every download against
sudo bash install.sh
```

Not `curl … | sudo bash`: the script is the trust root, so it is downloaded, read, then run. (Keep the
`-L`: the GitHub address redirects, and without it you save the redirect page instead of the script.)
The key it pins has SHA-256 fingerprint `72eaf9dae5f094be4fc4162771465a68865a9ac350fd0ac4ef9d75e648a93383` — the same
number `bash install.sh --fingerprint` prints for the file you have and `sha256sum relay-app/release-pubkey.pem`
gives in this repository; if they disagree, stop. It installs Node if needed, fetches the app **and its
signature** from the newest [release](https://github.com/TrinityOneAdmin/TrinityOne/releases/latest) and
verifies the one against the other before unpacking, runs the relay as a hardened `systemd` service under
a dedicated `trinityone` user, asks for your church npub (write policy) and **lets you pick how it's
reachable** — Tailscale, a Cloudflare quick tunnel, or LAN-only. **Code comes from GitHub Releases; the
member/steward apps the box hands out come from `https://app.trinityone.church`** (`--origin`), which
carries them and GitHub does not. Non-interactive / scripted:

```bash
sudo bash install.sh --church npub1… --name "Grace Chapel" --tunnel tailscale -y
```

The same steps, with the Linux `.deb` / AppImage notes for the Suite, are in the help guide
*Running your own relay* (`help.html#console-relay`, and Help in the steward console).

Flags: `--church <npub[,npub…]>` · `--name` · `--tunnel tailscale|cloudflared|none` · `--port` ·
`--dir` · `--src <release or relay address>` · `--origin <https://host>` · `--fingerprint` · `-y`. Re-run
any time to update, or press **Update now** in the control panel. Manage with `systemctl status trinityone-relay`.

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
A **new** church is created in the Steward console served by this same box (`/steward.html`), and naming
it there registers it on this relay automatically — there is nothing to paste. For a church that already
exists elsewhere, open the **control panel** (`/relay-app/control.html`) and, under *Churches on this
relay*, paste its `npub` (from its Steward console) and Save. It writes the relay's write policy and
applies it instantly — no file editing, no restart. The relay refuses every write until it has a church,
and then accepts writes only from the churches listed there.

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
