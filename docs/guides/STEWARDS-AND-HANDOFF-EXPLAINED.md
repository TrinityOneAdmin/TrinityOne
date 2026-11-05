# Helpers & handing over a church — plain-English guide

There are **two different ways** to let someone else help run a church. They look similar but work very
differently. This explains both, who needs what, and the gotchas.

---

## The two ways, side by side

| | **A helper** (recommended) | **Hand over the church** |
|---|---|---|
| What you share | **Nothing secret.** You show them an invite; they request; you approve. The church key is **never** shared. | The **church's recovery phrase** (the master key itself). |
| What they become | A **helper** — can help, but limited to exactly the permissions you give them. They act under **their own** key. | A **co-owner** — full control, same as you. |
| Can you undo it? | **Yes — instantly.** Revoke them and they lose access. | **No.** Once they have the phrase they have it forever. To truly remove them you'd rotate the church to a new key. |
| Can they ban people / change the key / add other helpers? | **No** — those stay with the owner. | Yes (they're an owner). |
| What they can do | Exactly the permission preset you chose when you approved them (see below) — nothing more. | Everything. |

**Rule of thumb:** share the recovery phrase only with someone you'd trust to *be* the church forever.
For everyone else (volunteers, a treasurer, a second leader you might change later), add a **helper**.

---

## Which app does each person need?

Everyone here uses the **Steward app/console** — **not** the plain member app. The member app is for
taking part as a member; only the Steward console can act on a church's behalf.

- **The owner** (you) runs the Steward app holding the church key.
- **A helper** runs the Steward app with **their own** key (the app makes one for them when they tap
  "Help run a church"). The church key is never copied to their device.
- **A co-owner** (after a full hand-over) also runs the Steward app, and types in the church's recovery
  phrase to "adopt" the church (Restore a church -> scan the hand-over QR or paste the phrase).

> Each identity has a friendly, automatically-generated **name** (e.g. "Quiet Olive 28"). It shows up
> as a human cross-check on both sides — so when you approve a helper, you can confirm the code matches
> the person you meant to add.

---

## How to: add a helper (revocable)

This is a short handshake: the owner shows an **invite**, the helper sends a **request**, the owner
**approves** — and at that moment chooses the helper's name and exactly what they may do. The church key
is never shared.

**1 — Owner (Steward app):** Settings -> **Security** -> **Helpers** -> **Add a helper**. This shows an
**invite** — a QR to scan, or **Copy invite** to send as a short code.

**2 — The helper (Steward app):** open the Steward app and tap **Help run a church** (it's also under
Settings -> Security -> Help run a church), then **scan or enter the invite**. This **sends a request** to
the owner and makes the helper their own key, protected by a PIN (see *Protecting the key with a PIN*).

**3 — Owner approves:** the request appears under **Helpers -> Requests to help** (and is flagged on the
Overview). Tap **Approve...**, check the code is who you expect, then:

- **Give them a name** in your own words (the console won't let you approve someone without one).
- **Pick what they may do** — a permission **preset**, or **Custom** to tick each capability by hand:
  - **General helper** (the default) — care, groups & rotas, and members. **No** money, safeguarding or
    sealed rooms.
  - **Finance helper** — the church books only.
  - **Safeguarding lead** — clearances, photo decisions and kids check-in only.
  - **Full helper** — everything except the church key.
  - **Custom** — open the full list of six capabilities and tick each one.

Approving is PIN-gated if a console PIN is set.

**4 — The church opens for the helper:** once you approve, the church **auto-opens** on the helper's
console — it appears in their top-left identity switcher with a **STEWARD** badge, and they can do
**exactly** what the preset you chose allows, and nothing more.

**To change what they can do, or remove them:** Owner -> Settings -> Security -> **Helpers**. Each helper
has a **Permissions · N of 6** button (showing how many of the six capabilities they hold) to adjust, and
**Revoke** to remove them. Revoking takes effect immediately for new actions. (Their past announcements
may stay visible; they just can't post new ones.)

> **The invite is the main path.** Two older ways — add by the helper's own code, or pick an existing
> member — are kept under an **Advanced** toggle on the Add-a-helper screen, for the rare cases that need
> them (no camera at either end, or someone already a member on the same device).

---

## How to: hand over the church (give someone the whole church)

**Owner (Steward app):** Settings -> **Security** -> **Hand over the church** -> reveal the recovery phrase
or show the hand-over QR. This carries the **master key** — show it **in person**, only to someone you
fully trust. Anyone who sees it controls the church.

**The other person (Steward app):** **Restore a church** -> **Scan** the QR (or paste the phrase). They now
hold the church too. Handing it over entirely? The original holder can then **Remove it from this device**.

This is a distinct, dangerous action. It is **not** adding a helper: it makes a second owner with exactly
your powers, permanently, and it cannot be undone.

---

## Protecting the key with a PIN

A church key — and a helper's key — can act for a church, so keep it locked. Set or change a PIN under
**Settings -> Security -> Console lock**; it encrypts the key on the device and asks for the PIN to open the
console. **Removing the PIN requires entering it**, so a left-open console can't be stripped. Don't forget
it — without the PIN (or the recovery phrase) that device can't open the church.

---

## "It's not showing up" — quick checks

- **Owner — no "Helpers" panel?** It's in Settings -> **Security**, and only when you're on **your own**
  church identity (not while acting as a helper for someone else).
- **Owner — didn't see the request?** Look under **Helpers -> Requests to help** (it's also flagged on the
  Overview). The helper must have sent the request (step 2) first.
- **Helper — the church didn't open?** Make sure the owner has **approved** the request, then give it a few
  seconds to find the roster. Check the friendly code the owner approved matches the one on your device.
- **On an old build?** Reinstall the latest APK, or refresh the web console (the version is at the foot of
  Settings).

---

## What a helper can and can't do

A helper does **exactly** what the preset (or Custom ticks) you chose at approval allows — the six
capabilities are Finance, Care, Safeguarding, Members, Groups & rotas, and Sealed rooms. The relay
enforces each one on reads as well as writes, so these limits hold even against a tampered app.

**Can (when the matching capability is granted):**
- Post announcements & broadcasts, and create content — groups, rotas, studies (Groups & rotas).
- **Admit / approve** people who want to join, and set the join policy (Members).
- Run care, the books, or kids check-in — if you granted Care, Finance, or Safeguarding.

**Can't (owner-only, always — no capability grants these):**
- Add or remove other helpers.
- **Block or remove** members, or change the church key.
- Change the relay or network settings.

> Note the asymmetry on membership: a helper with Members **can let people in**, but only the owner can
> **block or remove** someone. If you hand the welcoming to a volunteer, keep yourself reachable for the
> times it has to go the other way.
