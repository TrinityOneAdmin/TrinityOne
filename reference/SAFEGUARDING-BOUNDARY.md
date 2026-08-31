# What this software does and does not protect — young people

**Status: INTERNAL DRAFT, updated 2026-08-31 at `b6588de`. Not yet fit to hand to a church.** Two of the
four gaps are closed (the stale helper listing, and the inference behind the care-request seal); two remain
open (adults-only room names, per-account photo suppression), and the care-request item has a named residual.
**A separate finding blocks this page becoming church-facing regardless:** a test-quality audit confirmed by
sabotage that twelve safeguarding behaviours — including the console's "mark as a child" control doing
nothing at all — break with the whole suite green. Until the controls a steward presses are tested, the
enforced list below describes what the code does, not what is guarded against regression. When they are closed or consciously accepted,
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
- **A young person's private request for help is served only to adults the church has cleared** — not to
  the wider care team, not to ordinary members. The relay decides this itself, independently of how the
  phone chose to encrypt it. **This holds only on a relay that has ingested the church's list of children.**
  A relay that has not cannot make the judgement, and will serve the request to whoever the phone sealed it
  to. See the first item in the next section.
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
  serves it, so an older build or another client still shows it. For a **child** this is usually academic:
  with child photos left off — the default — they are covered by the church-wide rule, and the console
  back-fills every minor into the suppression list anyway. For an **adult** it always bites. The console's
  own tooltip promises two things the relay delivers neither of: that the church sees only their symbol,
  and that they cannot set a new photo until a steward allows it.
- **Removing someone from "Ready to help" after marking them as a child.** If they listed themselves as
  available *before* being marked, that listing keeps being served. The relay refuses any update to it, but
  does not withdraw it, and the filter meant to hide it cannot see the list of children on an ordinary
  member's phone — deliberately, because serving that list to every member was itself a privacy fault fixed
  in July. The young person stays visible as a helper.
- **A young person's request for help, when NO clearance record for them exists at all.** *Narrowed
  2026-08-31 by `52c44b4` and `b6588de`; what remains is stated here, not the version those fixes closed.*
  The app used to read "this church has cleared nobody" as "safeguarding is not used here" and seal a child's
  request to the whole care rota — **wrapping a decryption key for every uncleared seat on it**. It now
  fetches the child's own clearance record, and the church's steward list to check who signed it, instead of
  inferring. **The remaining case is a child for whom no clearance record was ever published.** There the app
  still cannot tell, and still seals to the rota. That is not a race that resolves — it is permanent for that
  child, and `app/stew-dashboard.jsx:4051` records a run where 50 of 150 clearance publishes silently never
  landed.
  Why it matters even though the relay refuses: the request carries a key wrapped for each uncleared rota
  seat, and the app publishes to every relay the church uses. A relay that has not ingested the church's
  `minors:` document has no basis to refuse and serves it to people who can open it. Proven with two relays
  side by side.
  Two further residuals, both reported and neither fixed: `app/screens-today.jsx:266` is a **persistent row**
  telling the child "Sent privately — your care team will be in touch", which in this case is untrue; and
  `src/fellowship.src.js:3584` (`subscribeChurchSafeguard`) still has the defect shape `b6588de` fixed —
  it judges a steward-written clearance against a roster that may not have arrived on the same stream.

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
| Per-account photo suppression | `app/identity.jsx:1374`; in `gateway.mjs` `nophoto:` is consulted only at :1900 (who may write the list) and :983 — never in `accept()` for kind-0, never in `canRead` | **client** |
| Stale helper listing hidden | `app/screens-today.jsx:840` reads `ctx.safeguard.minors`, empty on non-steward devices by design (`fellowship.src.js:3446-3450`) | **client, inert** |
| Care-request audience choice | `fellowship.src.js` `childish` :4028 → audience :4043 → seal :4097; escape at :4034-4042 | client picks, relay backstops delivery |

**One further hole, narrow but real:** for a group id in the pre-namespacing `grp<timestamp>` shape, on a
relay that holds no definition for it, both `accept()` :2102 and `canRead()` :2470 skip the child-safe check
entirely — a young person was served an adults-only room's messages and posted into it. Reaching it needs a
relay added after the fact or a wiped one.

**Verification status.** Every line above was established by driving a real `gateway.mjs` over WebSocket, or
by lifting the real function out of `vendor/fellowship.js` and executing it — not by reading. All four gaps
were then independently re-tested by an agent briefed to REFUTE them; all four reproduced, and the
care-request item was found to be worse than first written (see the correction note below). The rehydration
of `GROUP_CHILDSAFE` remains a read-only conclusion.

**Correction, 2026-08-31.** The first draft of this file said of the care-request gap that "nothing is
disclosed to the wrong people". That was wrong, and it was wrong in the direction that matters. The event
carries a decryption key wrapped for every uncleared care-rota seat, and the app publishes to every relay in
`churchRelays()` — so any relay in the list lacking the `minors:` document serves a child's disclosure to
people who can open it. Recorded here rather than quietly edited, because a false claim about a safeguarding
protection is worse than the gap it describes.
