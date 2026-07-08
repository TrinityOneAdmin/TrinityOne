# Troubleshooting

Find your symptom. Most things here are quick.

---

## For everyone

### The app is blank / stuck on a spinner
- **Reload it.** Web: pull to refresh or reopen the tab. App: close and reopen.
- **You may be offline.** The Bible reader works with no connection, but chat/church content needs the internet. Check your signal.
- **Still blank after a reload?** Clear the app's cache/data (Android: App info → Storage → Clear cache), or reinstall. Your identity survives a reinstall on the same device — but this is exactly why your **12 recovery words** matter.

### Church content is slow to appear (but the Bible is instant)
That's expected on a weak connection. The Bible is on your device; chat, prayer and announcements come from your church's relay over the network. On a thin pipe, give it a few seconds on first open. If it's *always* slow, your church may be on a distant/overloaded relay — a steward can point it at a closer one (see below).

### I got a new phone / lost my phone
Restore from your **12 recovery words**: install the app, choose **Restore / I have a recovery phrase**, type the 12 words. That's your identity back — same key, same history.
- **No recovery words and no old device?** There is no reset. That key is gone; you'd start fresh with a new one and re-follow your church. This is the trade-off of "no company holds your account" — *please back up the words.*

### A video or audio won't play
- **Self-hosted church media** is members-only — make sure you've **followed the church** (not just opened a preview).
- If it spins and fails, the church's media host may be down or the item may still be uploading. Try again shortly; a steward can check.

---

## For members joining

### The invite link / QR doesn't work
- Make sure you're opening it **in the app** (or the church's web app), not a random browser that strips the link.
- Links can expire or be single-use depending on how the steward made them — ask for a fresh one.

### It says I'm "waiting for approval"
Some churches approve members before they can post. Your steward just needs to admit you — give them a nudge.

### Setting up a child account
A **parent** creates the child's account from their own app, and the church **steward confirms** the parent↔child link. If you added a second parent and they don't see the child yet, the steward needs to confirm *them* too — it's a one-tap confirmation on the steward side.

---

## For stewards

### The "Update now" button isn't showing on my relay
This is almost always **not a bug** — it means your relay is *already running the newest version that's been published*. The button only appears when there's a newer build staged to pull. If you're expecting an update, whoever cuts the release needs to **stage the new version first**; then the button appears. (If you have shell access, the update command is safe to run — it just no-ops when there's nothing new.)

### After an update, the site is briefly down (error 530 / "problem loading page")
Expected and self-healing. When the relay restarts, the Cloudflare tunnel drops for a few seconds and reconnects on its own. Wait ~10–30 seconds and reload. If it's still down after a couple of minutes, the tunnel (`cloudflared`) needs a restart on the relay box — see [Relay setup → Troubleshooting](RELAY-SETUP.md#troubleshooting).

### Uploading a sermon fails
- **On a shared/public relay**, the operator may have **media hosting off or a storage cap** — you'll get a clear message ("relay hosts no media" / "storage limit reached"). Host your media on your own relay, or ask the operator.
- **Encrypted upload** needs your church to have members to wrap the key to — add members first.

### Finance shows a balance I didn't expect
The Finance page reflects the transactions in your book exactly. A surprise figure is usually a **test or import entry** — check **Recent transactions**, and use the **undo (↩)** on any entry to reverse it (proper double-entry keeps the audit trail).

---

## For relay operators
Relay-level problems (tunnel down, storage full, church discovery, backups) live in **[Relay setup](RELAY-SETUP.md)**.

---

*Didn't find it? Open an issue: https://github.com/TrinityOneAdmin/TrinityOne/issues*
