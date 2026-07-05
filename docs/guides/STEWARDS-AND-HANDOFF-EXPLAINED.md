# Stewards & handing over a church — plain-English guide

There are **two different ways** to let someone else help run a church. They look similar but work very
differently. This explains both, who needs what, and the gotchas.

---

## The two ways, side by side

| | **Delegated steward** (recommended) | **Full handoff** |
|---|---|---|
| What you share | **Nothing secret.** You send an invite; they request; you approve. The church key is **never** shared. | The **church's recovery phrase** (the master key itself). |
| What they become | A **steward** — can help, but limited. They act under **their own** key. | A **co-owner** — full control, same as you. |
| Can you undo it? | **Yes — instantly.** Revoke them and they lose access. | **No.** Once they have the phrase they have it forever. To truly remove them you'd rotate the church to a new key. |
| Can they ban people / change the key / add other stewards? | **No** — those stay with the owner. | Yes (they're an owner). |
| What they can do | Post announcements & broadcasts, manage who joins, and create content (groups, studies). | Everything. |

**Rule of thumb:** share the recovery phrase only with someone you'd trust to *be* the church forever.
For everyone else (helpers, volunteers, a second leader you might change later), use a **delegated steward**.

---

## Which app does each person need?

Everyone here uses the **Steward app/console** — **not** the plain member app. The member app is for
taking part as a member; only the Steward console can act on a church's behalf.

- **The owner** (you) runs the Steward app holding the church key.
- **A delegated steward** runs the Steward app with **their own** key (the app makes one for them when
  they start the "become a steward" flow). The church key is never copied to their device.
- **A full-handoff co-owner** also runs the Steward app, and types in the church's recovery phrase to
  "adopt" the church (Restore a church → scan the handoff QR or paste the phrase).

> Each identity has a friendly, automatically-generated **name** (e.g. "Quiet Olive 28"). It shows up
> as a human cross-check on both sides — so when you approve a steward, you can confirm the name matches
> the person you meant to add.

---

## How to: add a delegated steward (revocable)

This is a three-step handshake: the owner sends an **invite**, the steward sends a **request**, the owner
**approves**. The church key is never shared.

**1 — Owner (Steward app):** Settings → **Security** → **Delegated stewards** → **Add a steward**. This
shows an **invite** — a QR to scan, or **Copy invite** to send as text.

**2 — The steward (Steward app):** open the Steward app and choose **Settings → Security → Become a
steward** (or, on the very first run, the **"Help run a church"** option in the wizard) → **Scan a
church's invite** (or paste it — there's a no-camera paste fallback). This **sends a request** to the
owner. The app makes the steward their own key, protected by a PIN (see *Protecting the key with a PIN*).

**3 — Owner approves:** the owner sees **"someone wants to help steward"** — a banner on the **Overview**
and under **Delegated stewards**. Tap to **approve** it (this is PIN-gated if a console PIN is set).
Check the friendly name matches the person you expect.

**4 — The steward switches in:** within a few seconds the church appears in their **top-left identity
switcher** as **"acting as steward of <church>"** (with a **STEWARD** badge). They can now post
announcements/broadcasts, manage who joins, and create groups/studies for that church.

**To remove them (instant):** Owner → Settings → Security → Delegated stewards → **Revoke**. It takes
effect immediately for new actions — they can no longer act as the church. (Their past announcements may
stay visible; they just can't post new ones.)

---

## How to: full handoff (give someone the whole church)

**Owner (Steward app):** Settings → **Security** → **Stewards & handoff** → **Show handoff QR** (or reveal
the recovery phrase). This carries the **master key** — show it **in person**, only to someone you fully
trust. Anyone who sees it controls the church.

**The other person (Steward app):** **Restore a church** → **Scan** the QR (or paste the phrase). They now
hold the church too. Handing it over entirely? The original holder can then **Remove it from this device**.

---

## Protecting the key with a PIN

A church key — and a steward key — can act for a church, so keep it locked. Set or change a PIN under
**Settings → Security → Console lock**; it encrypts the key on the device and asks for the PIN to open the
console. **Removing the PIN requires entering it**, so a left-open console can't be stripped. Don't forget
it — without the PIN (or the recovery phrase) that device can't open the church.

---

## "It's not showing up" — quick checks

- **Owner — no "Delegated stewards" panel?** It's in Settings → **Security**, and only when you're on
  **your own** church identity (not while acting as someone else's steward).
- **Owner — didn't see the request?** Look for the **"someone wants to help steward"** banner on the
  Overview and under Delegated stewards. The steward must have sent the request (step 2) first.
- **Steward — no "acting as steward of <church>"?** Make sure the owner has **approved** the request, then
  give it a few seconds to find the roster. Check the friendly name the owner approved matches the one on
  the steward's device.
- **On an old build?** Reinstall the latest APK, or refresh the web console (the version is at the foot of
  Settings).

---

## What a delegated steward can and can't do

**Can:**
- Post announcements & broadcasts.
- Manage who joins (approve / admit members).
- Create content — groups and studies.

**Can't (owner-only, always):**
- Add or remove other stewards.
- Ban members, or change the church key.
- Change the relay or network settings.

---

> **Note on overlap:** this markdown guide and **stewards-guide.html** cover the same ground — the HTML
> version is the reader-facing page, this is the plain-text reference. Keep both in step if either changes.
