# What this software does and does not protect — young people

**Status: INTERNAL DRAFT, 2026-08-31. Not yet fit to hand to a church.** Four of the gaps in
"What is presented, not enforced" are open at `586b5f1`. When they are closed or consciously accepted,
the first two sections become the church-facing document; the appendix stays here.

**Who this is for.** A steward deciding what to tell parents, and a developer deciding whether a change
is load-bearing. It answers one question: when the app *appears* to protect a young person, is that a
rule the system enforces, or a screen being polite?

**Why the distinction is the whole document.** This product is built for churches under pressure —
lawful compulsion, seized devices, thin connections. A protection that lives only in the app is a
protection that an old build, a modified build, a lost phone, or a bad connection removes. A protection
the relay enforces survives all four. Telling a parent the first kind is the second kind is the single
worst thing this document could cause.

---

## What is genuinely enforced

Enforced means the relay refuses, and it refuses no matter what the phone does. Replacing the app,
editing the app, or using a different Nostr client does not get around these.

- **A young person cannot message an adult who has not been cleared, and no cleared adult's reply reaches
  them either.** The refusal covers both sending and later reading, so a message that somehow got stored
  is still never served back.
- **A young person's photo does not appear**, unless the church has explicitly turned child photos on.
  The default is off, and the default applies to a church that has never opened the setting.
- **A young person cannot post a public request for help to the whole congregation**, and cannot list
  themselves in the church's "I'm here to help" register.
- **A young person's private request for help is served only to adults the church has cleared.** Not to
  the wider care team, not to ordinary members — the relay decides this itself, independently of how the
  phone chose to encrypt it.
- **The contents of an adults-only room are refused**, both the messages already in it and anything the
  young person tries to post.
- **The name of an adults-only room does not reach a young person's lock screen** as a notification.

## What is presented, not enforced

These are real protections in normal use and they are worth having. They are not guarantees, and a church
should not be told they are.

- **The list of adults-only room NAMES.** The app hides them; the relay serves the room's definition to any
  member, including a young person. The contents stay protected — but the names do not, and a name can be
  the disclosure ("Safeguarding concerns", "Marriage counselling"). The hiding also depends on the app
  already knowing the person is a young person, which on a cold start over a thin link may not be true yet.
- **A steward's "reset this person's photo".** This hides the photo in this app only. The relay stores and
  serves it, so an older build or another client still shows it. In a church that has left child photos off,
  the child is covered by the church-wide rule instead — but the per-person control does not do what its own
  wording promises.
- **Removing someone from "Ready to help" after marking them as a child.** If they listed themselves as
  available *before* being marked, that listing keeps being served. The relay refuses any update to it, but
  does not withdraw it, and the filter meant to hide it cannot see the list of children on an ordinary
  member's phone — deliberately, because serving that list to every member was itself a privacy fault fixed
  in July. The young person stays visible as a helper.
- **The reassurance on a young person's request for help.** In a church that has cleared nobody yet, the
  sheet can say the request has gone privately to the care team when the relay will not serve it to that
  team. Nothing is disclosed to the wrong people; the request simply reaches only the church console, while
  the child has been told it was sent.

## What this software does not attempt at all

Saying these plainly is part of being honest about the rest.

- **A shared family device.** If a child uses a parent's unlocked phone and the parent's account, the app
  sees the parent. This is by design: an adult is assumed to be in control of that device.
- **Deciding your safeguarding policy.** The software ships gates; which children are marked, which adults
  are cleared, and which rooms are child-safe are the church's decisions. Nothing here is a substitute for
  a policy, training, or a DBS check.
- **Protecting a child from someone the church has cleared.** Clearance is the church's judgement. The
  software enforces it; it cannot second-guess it.
- **Anything about a room a church never marked child-safe.** Rooms are adults-only until marked otherwise.
  A church that marks children but never marks any room child-safe leaves those children with no group
  rooms — legitimate, per the domain file, but nobody is currently told it happened.

---

## Appendix: where each line above lives in the code

Kept separate so the church-facing part above stays readable. At `586b5f1`.

| Protection | Enforced at | Class |
|---|---|---|
| DM to uncleared adult refused, both directions | `gateway.mjs` `accept()` k=4 :2123, `canRead()` :2184, via `safeguardAllows`:1144 | relay |
| Child photo withheld unless church opts in | `accept()` kind-0 :1717 via `childPhotoBlocked`:1130 (default-deny) | relay |
| No public need, no helper listing | `accept()` NEED_D :1973, AVAIL_D :2006 (`!minorOf`) | relay |
| Child's care request served only to cleared | `canRead()` :2225 via `childCareReader`:1096; also :2235, :2246 | relay |
| Adults-only room contents | `accept()` :2102, `canRead()` :2474 | relay |
| Room name off the lock screen | `gateway.mjs` push branch, commit `a693e17` | relay |
| Room NAMES in the list | `app/screens-chat.jsx:358` only; `canRead()` group branch :2383 special-cases `team` visibility alone | **client** |
| Per-account photo suppression | `app/identity.jsx:1374`; `nophoto:` appears in `gateway.mjs` only at :398/:1896/:1898, all write-gate | **client** |
| Stale helper listing hidden | `app/screens-today.jsx:840` reads `ctx.safeguard.minors`, empty on non-steward devices by design (`fellowship.src.js:3446-3450`) | **client, inert** |
| Care-request audience choice | `fellowship.src.js` `childish` :4028 → audience :4043 → seal :4097; escape at :4034-4042 | client picks, relay backstops delivery |

**One further hole, narrow but real:** for a group id in the pre-namespacing `grp<timestamp>` shape, on a
relay that holds no definition for it, both `accept()` :2102 and `canRead()` :2470 skip the child-safe check
entirely — a young person was served an adults-only room's messages and posted into it. Reaching it needs a
relay added after the fact or a wiped one.

**Verification status.** The relay/client split in the table was established by driving a real `gateway.mjs`
over WebSocket, not by reading. The three client-only findings were re-verified independently against source
before being written here. The care-request escape and the rehydration of `GROUP_CHILDSAFE` are read-only
conclusions and are marked as such in the audit notes.
