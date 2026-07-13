# Connecting your church to a relay

A **relay** is the small server that carries your church's live data — chat, prayer, announcements, members, and (optionally) your self-hosted sermons. The Bible reader needs none of this; everything *church* flows through a relay.

You have three levels of independence. Start wherever you're comfortable — you can move up later without losing anything.

> **Just want to be walked through running your own relay, step by step?** See
> [Running your own church relay — the whole journey](RELAY-WALKTHROUGH.md). This page is the reference;
> that one is the follow-along tutorial.

---

## Level 1 — Use the shared relay (do nothing)

Out of the box, your church is on the shared TrinityOne relay. It works, it's free, and there's nothing to set up. Good enough for most churches to start.

**Trade-off:** you're a guest on shared infrastructure. If you want full ownership — your data on hardware you control — go to Level 2.

---

## Level 2 — Point your church at another relay (no server to run)

If someone you trust runs a relay and offers space, your church can adopt it — the app can even find one for you.

1. In the Steward console, open **Settings → Relays**.
2. Tap **Auto-find relays for me.** The app discovers relays that are **offering space**, checks each one actually enforces TrinityOne's rules (so your church's safeguarding + membership policy still applies), and picks a couple — including a **backup**.
3. Done. Your church now publishes to those relays. Members follow the same as before.

**Know the relay's name already?** Under **OR CONNECT BY NAME**, type it (e.g. `grace-city`) and Connect. The name always points at the relay's current address — so a self-hosted relay behind the free tunnel keeps working even though its raw URL changes on every restart. Prefer the **name**, never a raw `wss://…trycloudflare.com` URL.

> **Why a backup?** Two relays means if one is down, your church keeps working. When you have two, self-hosted media is automatically mirrored across them, and the console's "backup copy host(s)" fills itself in.

---

## Level 3 — Run your own relay (full ownership)

This is the church-box option: your data, your server, your domain (`relay.yourchurch.org`).

### What you need
- A small always-on computer or a cheap VPS. A Raspberry-Pi-class box is fine for chat/prayer. **For self-hosted audio/video, use a box with real upload bandwidth or cheap object storage — not a home connection behind a phone/5G router,** which chokes on uploads.
- Node.js. That's basically it — the relay is one small service.

### Easiest — the TrinityOne Suite (no command line)
Download the **TrinityOne Suite** from the app's Downloads page (macOS / Windows / Linux), install it, and
open it. Pick **Full suite** (relay + manage your church on one box) or **Relay only**. On first run it
guides you through creating/entering your church, so the relay already knows which church it serves.

Then, in the relay panel:
1. **Go public — no account** — one click starts a free Cloudflare quick tunnel. No port-forwarding, no
   static IP, no account.
2. **Claim a name** under *Your relay's name* (e.g. `grace-city`). That's the stable handle stewards type
   in **Settings → Relays → Connect by name** — it survives the tunnel URL rotating on restart.
3. Share invites from the Steward console as usual; the invite QR carries the relay automatically, so you
   never dictate a `wss://` address to members.

### Advanced — headless server (Raspberry Pi / VPS)
For an always-on box with no window open, use the one-line installer (see `relay-app/README.md`) or run the
core directly:
```bash
git clone https://github.com/TrinityOneAdmin/TrinityOne.git && cd TrinityOne   # canonical repo
npm install
CHURCH_NPUB=npub1… node scripts/gateway.mjs 8000     # relay + app + media store on :8000
```
Set the church key via `CHURCH_NPUB=npub1…` (comma-separate for several) or a `relay/church.json`. See
[`ops/HOSTING.md`](../ops/HOSTING.md) for the full server runbook (systemd, keys).

### Reachable from anywhere
The Suite's **Go public** (above) is the easiest path — a free, no-account tunnel; connect churches by the
**name** you claim, not the rotating URL.

Want a **fixed address on your own domain** (`relay.yourchurch.org`)? Run a Cloudflare **named** tunnel (an
account + `cloudflared` on the box, tunnelling the domain to `localhost:8000`), then add
`wss://relay.yourchurch.org/relay` in **Settings → Relays**. Full runbook:
[`ops/GO-LIVE-DOMAIN.md`](../ops/GO-LIVE-DOMAIN.md).

### Back up your relay
In the relay panel, **Back up & restore this relay → Download backup** saves the whole box — every church's
messages, records and media, plus the relay's identity — as one encrypted-at-rest file you keep on a drive
or cloud **you** control. It contains keys, so guard it like your recovery phrase. **Restore** (then restart
the app) rebuilds the relay from that file — how you move it to a new machine, or roll back. A steward can
also back up just their own church's data from the console (**Settings → Backup & data**).

### Run two for safety
Redundancy matters. Stand up a **second** relay (a friend church, a second VPS, a cheap object-storage-backed node) and add it too. With ≥2 relays your church drops the shared fallback entirely — you're fully self-hosted, and media mirrors across both.

---

## Hosting other churches (public/shared relay)

If you run a relay with room to spare, you can **offer space** to other churches. In the relay panel's
*Churches on this relay* card:
- **Offer to host other churches** — advertises your relay so others' **Auto-find** surfaces it.
- **Invite-only** — off = a church can add itself (up to 200); on = only churches you add with the admin token.

(Headless/server equivalents: `RELAY_OPEN=1`, `RELAY_OPERATOR="Grace Church"`, `RELAY_REGION="UK"`, `RELAY_CHURCH_CAP=10`.)

### Protecting your disk (media storage controls)
Self-hosted audio/video is big. If several churches share your node, cap it so nobody exhausts your disk. Set the **Total media (GB)** and **Per church (GB)** fields in the relay panel, or the env vars:
- `RELAY_MEDIA_OFF=1` — be a relay **only**; refuse all media uploads (chat/prayer still work).
- `RELAY_MEDIA_CAP=<bytes>` — a **total** media limit across all churches.
- `RELAY_CHURCH_MEDIA_CAP=<bytes>` — a **per-church** media limit.
- `RELAY_MEDIA_REQUIRES_HOST=1` — **conversations for everyone, sermons only for self-hosters.** A church you host for chat/prayer/text resources can *not* upload sermon audio/video unless you've **granted it media hosting** — which you do for churches that run (or pair) their own relay. Ideal for a community relay: you keep hosting many churches' conversations cheaply, but big media lives on each church's own box. Grant media per church with `"media": true` in `church.json` (`{"churches":[{"npub":"npub1…","media":true}]}`) or the `RELAY_MEDIA_CHURCHES=<npub,npub>` env. Off by default — a private single-church relay is unaffected. **Turning it on? Grant your own church(es) media first, or their sermon uploads will be refused.** (Text resources — reading plans, devotionals, announcements — are never affected; they aren't media.)

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
