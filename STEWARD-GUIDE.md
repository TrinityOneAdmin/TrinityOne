# Running your church in TrinityOne — the steward's guide

*Last updated 2026-06-19. The pilot is moving fast; this reflects what's live now.*

This is the map of the **steward console** — the desktop/web app you use to run your church
(`steward.html`). Members use the phone app; stewards use this. A companion guide goes deeper where the
stakes are higher: **[SAFEGUARDING.md](SAFEGUARDING.md)** (protecting young people). To share running the
church with someone else — a revocable delegated steward, or a full handoff — see
**[STEWARDS-AND-HANDOFF-EXPLAINED.md](STEWARDS-AND-HANDOFF-EXPLAINED.md)**.

> **What "self-custodial" means for you:** your church is one **key**, held on your device — there's no
> company account and no one who can lock you out or seize your data. The flip side: that key (its
> 12-word recovery phrase) is the one irreplaceable thing. Write it on paper and keep it safe. Everything
> else — groups, rota, members — restores from it.

---

## First-time setup
The wizard walks you through it: **create your church key → name your church → choose relays → invite
your people**. After that you land in the console.

- **Invite code / QR** — every church gets a friendly code and a scannable QR (with a printable poster
  and "Save PDF"). One scan adopts a ready-made identity and joins the person to your church — no email,
  no phone. Hand it out on the bulletin, the screen, or in a text.

---

## The console, section by section

### Overview
Your church at a glance — member count, relay status, quick actions (new post, invite).

### Groups
Chat rooms and announcement channels.
- **Group** (everyone posts) or **Broadcast** (only you post; everyone reads).
- **Invite-only** groups — hidden from the list; only chosen members can post/read (relay-enforced).
- **🔒 Encrypted** groups — sealed end-to-end; not even the relay can read them.
- **Child-safe** toggle — see *Safeguarding*.
- **Leaders** — name members who can post events for a group.
- **Pin** a message to the top of a group; **remove** a message or **block** a member when needed.
- **Events from the chat** — open a group's chat and use the **Event** button to schedule an event for that group; it shows in the chat's "upcoming" strip and on everyone's calendar.
- **Polls** — anyone who can post in a group can run a quick poll (the sliders icon by the message box → a question + 2–5 options). Members tap to vote and see live results; it stays compact in the chat.

### Rota
Build serving teams and weekly rotas.
- Define **teams** and roles; assign people per service; **publish** so members see it. *(Remember to
  publish — an unpublished rota stays invisible to members.)*
- **Serving pods** — save sub-teams that work well together and **rotate them** across upcoming weeks in
  one tap.
- Sending a request fires a **"Can you serve?"** notification to the member (see *Notifications*).
- **Run sheet** — on a selected service, the **Run sheet** button builds the **order of service**: ordered items with a time, who's leading each, and a **CCLI #** for songs (add / remove / reorder). Anyone serving that service sees it from their **"you're serving"** card in the phone app.

### Calendar
Church events (workdays, prayer evenings, socials) and the month view of services + events.
- **Tap any event** — here, or in a group's chat, or on a member's "you're serving" card — to open **full details** (date, time, place, blurb) and, in the console, the **RSVP breakdown** with names.

### Rooms  *(new)*
A **shared room calendar**. Add your spaces (Main Hall, Room 2, Kitchen…), then **book a room** for a
date/time with a reason. A **double-booking check** warns you and blocks the save if the room's already
taken then. Steward-booked for now.

### Resources
Reading plans and devotionals you share with the church, with scheduled (drip) release and ordering.

### Finance  *(optional — turn on in Settings)*
A treasurer's ledger for the church: record giving, keep **donor records**, categorise
funds, and **import a bank statement** (it matches deposits to donors), then **export a CSV or
year-end statements**. With the optional **UK Gift Aid** add-on, it also builds the HMRC claim schedule. Every record is **encrypted to your church key** — nothing leaves the device in the clear.
(This is record-keeping; in-app **Lightning giving** is a separate, not-yet-shipped feature — see *Where this is heading*.)
- **Year-end giving statements** — *Donors* tab → **Statements** → pick a year → a printable, per-donor statement (itemised gifts, total) opens for print / save-as-PDF — what you send each donor for their records.

### Members
Everyone who's joined.
- See active/inactive members, search, copy an npub, message privately, **block** someone.
- **Safeguarding controls** — mark a member as a **Child** or **cleared for youth**. On a child's row you
  can **Link parent**: pick an adult member as their guardian yourself (no parent request needed), *or*
  **confirm** a request a parent sent from their own phone. A child with no parent linked shows a quiet
  **"no guardian"** tag — perfectly fine for a youth-club child whose parents don't attend; they're still
  protected (only cleared adults can DM them). These actions are **owner-only**, so they're hidden when
  you're acting as someone else's delegated steward. See **[SAFEGUARDING.md](SAFEGUARDING.md)**.
- **Requests to join** — if approval-to-join is on (see *Settings → Joining*), new people wait here for
  your **Approve** / **Decline**.

### Check-in  *(optional — turn on in Settings → Congregation features → Extras)*
Children's check-in for a session (Sunday kids, youth club). Tap **Check a child in**, pick from your
**Child**-marked members (their linked guardians show), and the app generates a **4-digit pickup code** —
write it on the parent's slip. At collection, **Check out** and enter the code on their slip to confirm
before releasing the child. Records are **encrypted to your church key** — who's present and their codes
never reach the relay or other members. Run from the **church-key holder's** console (the owner).

### Settings
- **Church profile** — name, web handle.
- **Branding** — banner image + brand accent colour (members see it).
- **Media** — link your YouTube/Rumble channel (Watch tab) and a podcast RSS (Listen tab).
- **Congregation features** — turn whole sections (Bible / Community / Library) on or off for your
  church; **Extras** → opt-in **Kids check-in**; **Joining** → *Require approval to
  join*; **Member names** → *Require a real first & last name*.
- **Networks** — join a wider church network; announce to it if you own one.
- **Relays** — point your church at relays (managed, or your own self-hosted one); always falls back to
  the shared relays. Each self-hosted relay has its own **browser control dashboard** (no terminal):
  turn on/off what it serves (the **web-app mirror**, **module downloads**, **audio/media**), set your
  **church's own web address**, and **Update now** when a new build ships — updates are **signature-verified**
  before they're applied, with automatic rollback if a build doesn't come up.
- **Security** — set a **console PIN** (encrypts your key on the device), and manage **delegated stewards**
  (invite a helper, approve their request, revoke them). See
  **[STEWARDS-AND-HANDOFF-EXPLAINED.md](STEWARDS-AND-HANDOFF-EXPLAINED.md)**.
- **Church key** — your recovery phrase + full encrypted backup.

---

## The rules you can switch on  *(Settings → Congregation features)*

| Rule | Default | What it does |
|---|---|---|
| **Bible / Community / Library** | On | Hide whole sections your church doesn't use. |
| **Require approval to join** | Off | New people wait in *Members → Requests to join* until you approve them (vs. open join-by-QR). Existing members are grandfathered when you switch it on. |
| **Require a real first & last name** | Off | Members are asked to set a full name; one-word/unnamed members get a nudge. |
| **Kids check-in** *(Extras)* | Off | Adds the **Check-in** tab — check children in/out with a secure pickup code (encrypted to your key). |
| **Child-safe** (per group) | Off | Children only see groups marked child-safe. See SAFEGUARDING.md. |

---

## Notifications (for your members)
TrinityOne uses **web-push** — no email or phone numbers are ever collected. Members get alerted (even
with the app closed) for direct messages, announcements and **serving requests**, once they allow
notifications. On iPhone/iPad they need to **Add TrinityOne to their Home Screen first**; the app's
Notifications screen shows them the exact steps. (We chose web-push over email deliberately, to keep the
no-PII promise.)

---

## Keeping it safe
- **Back up your church key.** Settings → Church key → recovery phrase (paper) + an encrypted file
  backup. Without the phrase, a lost device means a lost church.
- **Safeguarding holds the most sensitive data** — read its guide, and handle personal data under your
  church's privacy policy.
- The relay enforces the important rules (membership, blocks, child-safe DMs, room writes), so they
  can't be bypassed by a tampered app — **as long as your relay is running the current build.**

---

## Where this is heading
Recently shipped: child safeguarding + parent-linked accounts (parent-led *or* steward-linked), approve-to-join,
the full-name rule, the shared room calendar, **delegated stewards** (invite a helper to run the church
alongside you, without sharing your key), **service run-sheets**, **group polls**,
**year-end giving statements**, **kids check-in**, and one-click **signed relay updates**. Still on the way (not in the pilot): **Lightning giving** — tithes given from a wallet
the giver controls, landing straight with the church — and **Keykeeper**, which would hold a steward's key
on a separate signer device. The everyday "Steward console" is **not** Keykeeper. See `roadmap.html` for
the public roadmap and `reference/SPINE.md` for the live one.
