# TrinityOne -- self-hosted on this machine (pilot)

The app + a Nostr relay run on this machine as persistent systemd user services. Phones on the
same wifi can open it and chat works end to end. This is the pilot stopgap; the productized,
church-run version is `reference/proposal-relay-app-steward-console.md`.

## What's running

| Service | Bind | What |
|---|---|---|
| `trinity-web.service`   | `0.0.0.0:8000` | static web app (`scripts/serve.py`, threaded) |
| `trinity-relay.service` | `0.0.0.0:7447` | Nostr relay (`relay/dev-relay.mjs`, disk-persisted) |

Both are **enabled + linger is on**, so they start on boot and survive logout -- no manual start.

## How to open it

- On this machine: <http://localhost:8000>
- On a phone on the same wifi: **http://192.168.0.34:8000** (then "Add to Home Screen")

The app points at a relay on **the same host it was opened from**, port 7447 (it derives this from
the URL), so localhost and the LAN IP both just work -- no per-device config. Members can change the
relay later in-app (Profile -> Relays).

## Managing the services

```
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user status  trinity-web trinity-relay
systemctl --user restart trinity-relay          # e.g. after editing dev-relay.mjs
journalctl --user -u trinity-relay -f            # live logs
```

Relay data: `relay/relay-db.json` (gitignored; the on-disk event log, survives restarts).

## Known limits (and the fixes, later)

- **Same-wifi only.** Phones on cellular / off-network can't reach `192.168.0.34`. Remote access
  needs a public `wss://` endpoint -- a tunnel (Cloudflare Tunnel / Tailscale) or port-forward +
  TLS. That's the core of the Relay-app proposal.
- **DHCP IP may change.** If `192.168.0.34` changes, set a DHCP reservation / static IP on the
  router, or use the machine's `.local` mDNS name.
- **Open relay (no auth).** Anyone on the LAN can post. Fine for a trusted pilot; lock writes to
  known member pubkeys (nostr-rs-relay `[authorization]`, or the Relay app) before going wider.
- **Toy relay.** `dev-relay.mjs` is simple (NIP-01, JSON file). The production path is a hardened
  Khatru/NIP-29 relay bundled in the church Relay app -- see the proposal.
