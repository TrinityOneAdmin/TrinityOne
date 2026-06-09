# TrinityOne -- self-hosted on this machine (pilot)

Runs as persistent systemd user services. The **gateway** serves the app AND the Nostr relay on a
single port; a **tunnel** makes it reachable from anywhere. This is the engine the church Relay app
will wrap (see `reference/proposal-relay-app-steward-console.md`).

## What's running

| Service | What |
|---|---|
| `trinity-gateway.service` | `scripts/gateway.mjs` -- static app + Nostr relay (`/relay`) on `0.0.0.0:8000`, disk-persisted |
| `trinity-tunnel.service`  | `scripts/tunnel.sh` -- Cloudflare quick tunnel -> a public `https://` URL for the gateway |

Both are enabled with **linger on**, so they start on boot and survive logout. Older split services
(`trinity-web`, `trinity-relay`) are disabled -- the gateway replaces them.

## How to open it

- **On the church wifi (stable):** http://192.168.0.34:8000
- **On this machine:** http://localhost:8000
- **From anywhere (current tunnel URL):** see `relay/tunnel-url.txt` -- e.g.
  `https://<random>.trycloudflare.com`

The app always finds its relay on **its own origin at `/relay`** (`ws://` on http, `wss://` on
https) -- so whether opened on the LAN IP or the public URL, chat just works, no per-device config.

## Managing

```
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user status  trinity-gateway trinity-tunnel
systemctl --user restart trinity-gateway          # after editing gateway.mjs / app code
cat relay/tunnel-url.txt                           # current public URL
journalctl --user -u trinity-tunnel -f             # tunnel logs
```

Relay data: `relay/relay-db.json` (gitignored, survives restarts). Unit files: `deploy/systemd/`.

## The tunnel URL is TEMPORARY -- read this

The free Cloudflare **quick tunnel** URL **changes every time the tunnel restarts** (reboot/crash).
The **LAN URL (192.168.0.34:8000) is stable** -- fine for in-building use. For a **stable public URL**
(remote members), pick one:

- **Tailscale Funnel (recommended -- this machine is already on Tailscale).** Stable URL, no domain
  to buy. Two one-time toggles in the admin console (tailnet owner only), then one command:
    1. **Enable HTTPS:** https://login.tailscale.com/admin/dns -> "Enable HTTPS"
    2. **Enable Funnel:** https://login.tailscale.com/admin/acls -> add the `funnel` node attribute,
       e.g. `"nodeAttrs": [ { "target": ["autogroup:member"], "attr": ["funnel"] } ]`
    3. `bash scripts/funnel-up.sh` (may need sudo) -- runs `tailscale funnel --bg 8000`, which
       persists across reboots. The URL never changes:
       **https://adminl-aorus-15p-xc.tailbeaac0.ts.net** (rename the node for a nicer host:
       `tailscale set --hostname=trinityone` -> `https://trinityone.tailbeaac0.ts.net`).
  Everything is origin-relative, so the join QR/link and the relay (`wss://.../relay`) work over the
  new URL with no code change. Then disable the old quick tunnel:
  `systemctl --user disable --now trinity-tunnel`.
- **Named Cloudflare tunnel** -- needs a Cloudflare account + a domain.

## Other notes

- **Open relay (no auth).** Anyone with the URL can post. Fine for a trusted pilot; lock writes to
  known member pubkeys before going wider (the Relay app will manage this).
- **Toy relay.** `gateway.mjs` is NIP-01 + a JSON file. Production = a hardened Khatru/NIP-29 relay
  bundled in the church Relay app -- see the proposal.
