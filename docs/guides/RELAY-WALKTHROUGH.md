# Running your own church relay — the whole journey, start to finish

This is the hold-your-hand version: one straight path from "I have nothing" to "my church runs on a
server I control, members can reach it, and it's backed up and mirrored." No command line. Follow it
top to bottom — each step takes a minute or two, and you can stop after any step and still have a
working church.

If you just want the concepts and options, read [Connecting your church to a relay](RELAY-SETUP.md)
instead. This page is the **do-this-then-this** version.

> **A relay is just the small server that carries your church's live data** — chat, prayer,
> announcements, members, and (if you want) your own sermon audio/video. The Bible reader needs none
> of it. Running your own relay means that data lives on hardware *you* own, not on shared infrastructure.

---

## Before you start: do you even need this?

Out of the box your church is already on the shared TrinityOne relay. It works and it's free. **Most
churches should start there** and come back to this page later. Run your own relay when you want full
ownership — your data, your box, your control. Nothing here is required for a pilot.

You'll need one thing: **a computer that can stay on.** For chat and prayer, a Raspberry-Pi-class box
or an old laptop is plenty. For self-hosted audio/video, use a box with real upload bandwidth (or cheap
cloud storage) — a home connection behind a phone/5G router will choke on uploads.

---

## Step 1 — Install the TrinityOne Suite

1. On that always-on computer, open the app's **Downloads** page.
2. Download the **TrinityOne Suite** for your system (macOS / Windows / Linux) and install it like any app.
3. Open it.

The Suite is the relay *and* a control panel in one window — no terminal, no config files.

> **Windows may warn "unknown publisher."** That's expected for a small open-source app; choose *More
> info → Run anyway*. Only ever install the Suite from the official Downloads page.

---

## Step 2 — Tell it which church it serves

On first run the Suite asks you to set up your church. Choose:

- **Full suite** — run the relay *and* manage your church (post announcements, approve members, etc.)
  from this one box. Most single-church stewards want this.
- **Relay only** — this box is *just* the server; you'll manage the church from your phone or another
  computer as normal.

Then either **create a new church** (it generates your church's key — see Step 3) or **enter an
existing church** you already run. When you're done, the relay already knows which church it carries.

---

## Step 3 — Save your church's recovery phrase (do not skip)

If you created a new church, the wizard shows a **12-word recovery phrase**. This *is* your church —
whoever holds it controls the church's identity, and **there is no reset button.** Losing it means
losing the church; a stranger with it can impersonate you.

- Write it on paper. Store it like you'd store the deeds to the building.
- The wizard makes you re-type a few words to prove you saved it. That's on purpose.

(You can hand day-to-day running to other people later without ever sharing this phrase — see
[Stewards & handoff](STEWARDS-AND-HANDOFF-EXPLAINED.md).)

---

## Step 4 — Go public (one click, no account)

Right now the relay only works on your local network. To let members reach it from anywhere:

1. In the relay panel, click **Go public — no account.**
2. Wait a few seconds. It starts a free **Cloudflare tunnel** — no port-forwarding, no static IP, no
   sign-up. When it flips to **Public**, you're reachable worldwide.

> **What just happened?** Your home/office network normally hides the relay from the internet. The
> tunnel is a safe outbound pipe Cloudflare hands you, so people can reach the relay without you
> opening any ports on your router.

The free tunnel's raw web address **changes every time the relay restarts.** That's fine — you never
hand that address to anyone. Step 5 is why.

---

## Step 5 — Claim a name

So members aren't chasing a web address that keeps changing, give your relay a **stable name.**

1. In the relay panel, find **Your relay's name.**
2. Type a short, memorable handle — e.g. `grace-city` — and claim it.

That name now always points at your relay's *current* address, even after a restart rotates the raw
URL. It's what stewards type under **Settings → Relays → Connect by name**, and it's what makes a
free-tunnel relay usable long-term. **Always share the name, never the raw `wss://…trycloudflare.com`
URL.**

---

## Step 6 — Test it from your phone

Prove it's really reachable from the outside — not just from your own house:

1. On your phone, **turn Wi-Fi off** so you're on mobile data (a genuinely external network).
2. Visit your relay's public address with `/status` on the end (the relay panel shows the link).
3. If you see a little block of JSON, it's live worldwide. 🎉

If it doesn't load, see [If something goes wrong](#if-something-goes-wrong) below.

---

## Step 7 — Bring your members on

You don't dictate a server address to anyone. From the **Steward console**, share invites as usual —
the invite link/QR **carries the relay automatically.** A member scans it, and their app quietly starts
using your relay. If you claimed a name in Step 5, that name rides along, so members keep working even
after your tunnel URL rotates.

---

## Step 8 — Back it up

Everything now lives on your box — so make a copy you control.

1. In the relay panel: **Back up & restore this relay → Download backup.**
2. That single file holds *everything* — every church's messages, records and media, plus the relay's
   own identity. Keep it on a drive or cloud **you** control.

> ⚠️ The backup **contains keys.** Guard it exactly like your recovery phrase. To move to a new
> machine, or roll back a mistake, use **Restore** and restart the Suite — it rebuilds the relay from
> that file.

(A steward can also back up *just* their own church's data from the console: **Settings → Backup &
data.** That's the lighter, key-free export of one church.)

---

## Step 9 — Run a second relay (safety + mirroring)

One relay is a single point of failure. Stand up a **second** one — a friend church's box, a cheap VPS,
an object-storage-backed node — and add it too (**Settings → Relays**, then Auto-find or Connect by name).

With **two or more** relays:

- If one is down, your church keeps working from the other.
- Your data — including self-hosted media — **mirrors automatically** across them. Nothing extra to run.
- Your church can drop the shared fallback entirely: you're now fully self-hosted, with redundancy.

> **Won't mirroring bloat every relay?** No — media replication is opt-in per relay, sync runs on a
> jittered schedule so relays don't thundering-herd each other, and a relay never mirrors from itself.
> A relay only ever holds the churches it actually carries.

That's the whole journey. From here, [Hosting other churches](RELAY-SETUP.md#hosting-other-churches-publicshared-relay)
covers offering your spare capacity to other congregations, and [`ops/GO-LIVE-DOMAIN.md`](../ops/GO-LIVE-DOMAIN.md)
covers putting the relay on your **own domain** (`relay.yourchurch.org`) instead of the free tunnel.

---

## If something goes wrong

| Symptom | What it means / what to do |
|---|---|
| **Go public** spins but never says *Public* | Give it ~15s. Still stuck? Close the Suite fully and reopen, then click **Go public** once (don't double-click). Check the relay panel's log box for the cloudflared status line. |
| Members get **error 530** / "problem loading page" after a restart | The tunnel briefly lost the relay and returns 530, then reconnects on its own — usually seconds. If it stays down, restart the Suite. |
| `/status` won't load from mobile data | The tunnel isn't up (repeat Step 4), or you tested it while still on the same Wi-Fi as the relay (not a real external test). |
| "**media storage is full**" | You (or the relay's operator) set a media cap and hit it. Raise the cap, free space, or move that church's media to its own relay. |
| An **update** didn't change the version | The relay only updates when the release host is serving a *newer* signed build. If it's serving the same version, "Update now" is a no-op and won't even show. |

Full reference: [Troubleshooting](TROUBLESHOOTING.md) · [Relay setup (concepts & options)](RELAY-SETUP.md).
