# Connecting your church to a relay

A **relay** is the small server that carries your church's live data — chat, prayer, announcements, members, and (optionally) your self-hosted sermons. The Bible reader needs none of this; everything *church* flows through a relay.

You have three levels of independence. Start wherever you're comfortable — you can move up later without losing anything.

---

## Level 1 — Use the shared relay (do nothing)

Out of the box, your church is on the shared TrinityOne relay. It works, it's free, and there's nothing to set up. Good enough for most churches to start.

**Trade-off:** you're a guest on shared infrastructure. If you want full ownership — your data on hardware you control — go to Level 2.

---

## Level 2 — Point your church at another relay (no server to run)

If someone you trust runs a relay and offers space, your church can adopt it — the app can even find one for you.

1. In the Steward console, open the **Relays** card (under Settings).
2. Tap **Auto-find relays for me.** The app discovers relays that are **offering space**, checks each one actually enforces TrinityOne's rules (so your church's safeguarding + membership policy still applies), and picks a couple — including a **backup**.
3. Done. Your church now publishes to those relays. Members follow the same as before.

> **Why a backup?** Two relays means if one is down, your church keeps working. When you have two, self-hosted media is automatically mirrored across them, and the console's "backup copy host(s)" fills itself in.

---

## Level 3 — Run your own relay (full ownership)

This is the church-box option: your data, your server, your domain (`relay.yourchurch.org`).

### What you need
- A small always-on computer or a cheap VPS. A Raspberry-Pi-class box is fine for chat/prayer. **For self-hosted audio/video, use a box with real upload bandwidth or cheap object storage — not a home connection behind a phone/5G router,** which chokes on uploads.
- Node.js. That's basically it — the relay is one small service.

### Start it
```bash
git clone https://github.com/TrinityOneAdmin/TrinityOne.git && cd TrinityOne
npm install
node scripts/gateway.mjs 8000      # relay + app + media store on :8000
```
Set your church key so the relay knows which church it serves — `CHURCH_NPUB=npub1…` (comma-separate for several), or a `relay/church.json`. See [`ops/HOSTING.md`](../ops/HOSTING.md) for the full server setup (systemd, backups, keys).

### Put it on your own domain
Members reach a relay over `wss://` on a real domain. The simplest, free way — no port-forwarding, no static IP — is a **Cloudflare Tunnel**:
1. Point `relay.yourchurch.org` at Cloudflare.
2. Run `cloudflared` on the relay box, tunnelling your domain to `localhost:8000`.
3. In the Steward console → Relays, add `wss://relay.yourchurch.org/relay` and publish it. Members pick it up automatically.

Full runbook: [`ops/GO-LIVE-DOMAIN.md`](../ops/GO-LIVE-DOMAIN.md).

### Run two for safety
Redundancy matters. Stand up a **second** relay (a friend church, a second VPS, a cheap object-storage-backed node) and add it too. With ≥2 relays your church drops the shared fallback entirely — you're fully self-hosted, and media mirrors across both.

---

## Hosting other churches (public/shared relay)

If you run a relay with room to spare, you can **offer space** to other churches:
- `RELAY_OPEN=1` — advertise that you accept other churches (they can auto-find you). Add `RELAY_OPERATOR="Grace Church"` and `RELAY_REGION="UK"` to identify yourself, and `RELAY_CHURCH_CAP=10` to cap how many churches you'll take.

### Protecting your disk (media storage controls)
Self-hosted audio/video is big. If several churches share your node, cap it so nobody exhausts your disk:
- `RELAY_MEDIA_OFF=1` — be a relay **only**; refuse all media uploads (chat/prayer still work).
- `RELAY_MEDIA_CAP=<bytes>` — a **total** media limit across all churches.
- `RELAY_CHURCH_MEDIA_CAP=<bytes>` — a **per-church** media limit.

Uploads over a cap are refused with a clear message, and your relay advertises its media policy so churches choosing a relay can see it. (Text — chat, prayer, docs — is already bounded automatically; these knobs are just for the big media blobs.)

---

## Troubleshooting

### Members can't reach the relay after a restart (error 530 / "problem loading page")
The gateway restarts fine, but the **Cloudflare tunnel** briefly loses the origin and returns 530, then reconnects on its own — usually within seconds. If it stays down: restart `cloudflared` on the relay box (`systemctl restart cloudflared` or your run command). Check the relay itself is up by hitting it directly (bypassing Cloudflare) on its local/tailscale address.

### An "update" didn't change the version
The relay pulls a **signed** update bundle from the release host. If the release host is still serving the old build, the relay just re-fetches the same version (a no-op) and the "Update now" button won't even show. **Stage the new build on the release host first**, then update.

### "media storage is full" / "reached its media storage limit"
You've hit `RELAY_MEDIA_CAP` or `RELAY_CHURCH_MEDIA_CAP`. Raise the cap, free space, or move that church's media to its own relay.

### It's slow over the tunnel
A tunnel adds latency, more so on a home/5G connection (CGNAT). It's usually fine for chat. If it's painful, host the relay somewhere with a real connection, or use a second, closer relay.

---

*See also: [Getting started](GETTING-STARTED.md) · [Troubleshooting](TROUBLESHOOTING.md) · [`ops/HOSTING.md`](../ops/HOSTING.md) (server details) · [`ops/GO-LIVE-DOMAIN.md`](../ops/GO-LIVE-DOMAIN.md) (domain + tunnel).*
