# SIM round 3 — findings (2026-09-06)

Church: **SIM St Werburgh's** `53998834c6ce59bc5d08a52ebaa82e905d5d187b6fbad0ebc5b131be1e5dede0`
Build: `c105152`. Relay: `ws://127.0.0.1:8000/relay`, process started 13:56 today (NOT stale — checked).

---

## R3-1 — A delegated steward never sees the church they were granted (BLOCKING)

**What I saw.** Owner console (9420) added two delegated stewards by code under
Settings → Security → Delegated stewards → Add a steward. Both grants reached the relay:

    trinityone/stewards:5399...ede0
    caps: 3a8fd3af…="content","members"  |  fdcdb6ee…="care","safeguarding"

Both steward consoles are pointed at the same relay (`trinityone.relays.verified` holds
`ws://127.0.0.1:8000/relay`, verified). Four minutes after the grant, both consoles still show
the church name **"Your Church"** and their own npub, with no sign of SIM St Werburgh's.

Driving `window.Steward.subscribeStewardedChurches()` directly on 9421 emits `[]` — twice,
once over 9 seconds and once over 25 seconds. `window.Steward.actingChurch` is `null`.

**Consequence.** A steward who is granted access is left sitting in an empty console that behaves
as if they own an unnamed church of their own: all tabs render, including Finance, which neither
steward was granted. Clicking the church name in the switcher opens **"Name your church"** — a
naming dialog for a church they do not own.

**Not yet established.** Whether the relay is withholding the stewards doc from an unauthenticated
read (`canRead` reaches it only via `churchReader`, which requires `authed`) or the client never
re-issues the subscription after AUTH. Both are plausible from the code; I did not prove which.

---

## R3-2 — The delegated-stewards list does not refresh after an add

Adding a steward publishes successfully (verified on the relay) but the list under
"Give a trusted member steward powers…" still reads **"No delegated stewards yet."** After a
console reload it renders correctly: `SH | Sure Haven 42 | 3a8fd3af51…2b62 | helping since Sep 6 | 2 of 5`.

**Consequence.** An owner who sees no confirmation may add the same person twice, or conclude the
add failed and hand over the recovery phrase instead — which gives away the church key.

---

## R3-3 — The first stewards publish carried no names at all

The first `trinityone/stewards:` event had `pubkeys`, `caps`, `at` — and **no `n` field**. The
second publish (adding the second steward, ~2 minutes later) did carry a sealed `n`. The first
steward's name showed on the owner console anyway, so it was being read from local state.

**Consequence.** On any other console, a steward added in the first seconds after a church is
created shows as a bare hex key with no name. Note the failure is silent: the publish reports
success and drops the field. Consistent with `_sealChurchDocReady` giving up after its 4s wait
before the church name key exists.

---

## R3-4 — Three cleartext lists on the relay together identify every child and their guardian

Read straight out of `relay/relay.sqlite` while the round was running. No key needed:

    trinityone/minors:<church>    {"pubkeys":[4e57c067…, bdb7e22f…, 78bfdfd6…, 3729cf8d…]}
    trinityone/nophoto:<church>   {"pubkeys":[ the same four keys, exactly ]}
    trinityone/guardians:<church> {"links":{ bdb7e22f…:[a0cf5449…], 78bfdfd6…:[bdb7e22f…], … }}

`clearance:` IS sealed. `finance/account` IS sealed. `guardnotice` IS sealed. The roster carries only
`pubs` in the clear with names sealed under `e`. These three do not.

The relay read-gates them, so this is not reachable by a stranger over the network. But the pilot's
stated threat model is lawful compulsion and seizure of the box — and on a seized box these three
files are a list of which members are children, which of them must not be photographed, and who each
child's guardian is, all bound to keys that the same box can tie to names elsewhere.

Flagging it as a decision to take deliberately, not as an oversight: `nophoto` in particular carries
no new information (it was identical to `minors`, member for member) and is the cheapest of the three
to seal.

## R3-5 — A child was recorded as the guardian of two other children

In the guardian links above, `bdb7e22f…` appears BOTH in the `minors:` list and as the guardian of
`78bfdfd6…` and `3729cf8d…`. The steward console accepted this without complaint.

I did not see the screen this was entered on — the steward agent did it — so I cannot say whether the
app offered children in the guardian picker or whether it was reached some other way. Worth one
question on a device: does the guardian picker exclude people already marked as young people?

---

## R3-6 — The steward console has no in-app help. None.

Surfaced by the stuck steward on 9421, then verified directly against the shipped pages:

    www/index.html    loads help-illustrations.js, help-data.js, screens-help.js, screens-help-main.js
    www/steward.html  loads no help file at all

`app/help-data.jsx` holds ~20 written topics and is referenced by `www/index.html` only.

So the member app has help and the console does not. The people with the least margin for error —
the ones doing safeguarding, finance, admitting members and handing over a church — are the ones with
nothing to read when they get stuck. The stuck steward on 9421 searched for it visually, by DOM query
and by text scan, and correctly concluded it is not there.

## R3-7 — "Relay Down" claim: NOT reproducible

The 9421 agent reported the relay showing "Down" and attributed its failures to that. I checked while
the round was running: `/status` returned `ok:true`, uptime 33 minutes, version `c105152` — our build —
and none of the three consoles displayed "Down" at that moment. 159 events from 16 authors had been
written by then.

Recorded so nobody chases it. R3-1 stands on its own evidence and does not depend on this.

**But 9421 does carry a real banner**, for the phantom church the console made for itself:

> "Your church is not set up on this relay yet, so 'people must be approved before they can join'
> could not be saved — anyone with your join link can currently join straight in. Finish connecting
> your church to its relay, then reopen the console and this will apply itself."

It is accurate about that empty church. It is also the only thing on screen explaining anything, and
it explains the wrong problem — this person does not want a church of their own, they are trying to
reach someone else's.

---

## R3-5 RESOLVED — a child stays a guardian if they are marked as a child afterwards

The safeguarding steward checked the picker on the device and found the guard IS there:

> "When selecting a parent for Ruth Kimani, Tom Okafor does NOT appear in the list.
> System states: 'Only adults (not other children) can be linked'."

And yet Tom Okafor is recorded on the relay as the guardian of two other children, while himself being
in the `minors:` list.

So the rule is enforced **at the moment a guardian is picked, and never again.** Mark someone as a
young person while they are already somebody's guardian and nothing re-checks it — the app's own
stated rule ("only adults can be linked") is quietly false for that record from then on.

Neither list shows the contradiction to a steward. The check-in screen went on offering Tom as the
pickup contact for two children.

## R3-8 — Help is a full-screen page whose only exit is an unlabelled chevron

Two of thirteen members independently reported the help as a "navigation trap" that "covers all tabs
with no clear close button". I tested it on a healthy browser and screenshotted it.

What is actually true: opening Help & guides replaces the screen with a full-page view. The app does
NOT collapse, the layout is fine, and there IS a way out — a `‹` chevron in the top-left corner with
the accessible name "Back". No visible word, just the arrow.

`see` reports the tab-bar text while that page is open (the tabs are in the DOM behind it), which is
what made both agents believe the tabs were visible-but-unclickable. That part is the harness.

**The finding that survives:** two of thirteen users, one of them deliberately playing a
less-confident person, opened the help and could not work out how to leave it. The exit is an
unlabelled icon in a corner. That is a real cost on the one screen people reach *because* they are
already stuck.

## R3-9 — Two browsers ended the session rendering nothing, with a full DOM

Measured directly on all thirteen member browsers:

    9440  body height 0   20 buttons, 0 with any size    innerText 3,887 chars
    9431  body height 0   39 buttons, 0 with any size
    9439  body height 844 16 buttons, 16 sized           (healthy)
    9443  body height 844 22 buttons, 22 sized           (healthy)
    9435  body height 844 15 buttons, 15 sized           (healthy)

A screenshot of 9440 is a completely white page. `visibilityState` is `visible` on all of them, so
this is not the known headless-hidden trap. The content is in the document; nothing has a box.

I could not attribute a cause and did not try to — both sessions had ended by the time I measured.
Recorded because it is the shape of the worst failure class this app has: looks fine to the code,
shows nothing to the person. Worth reproducing deliberately.

## NOT A FINDING — "care+safeguarding steward has full Finance access"

The 9422 agent reported this and it is my fault, not the app's. When the code-based handoff failed
(R3-1) I gave 9422 the church's recovery phrase so the round would have a second steward. That makes
it an OWNER console holding the church key, so full Finance access is correct behaviour.

**The capability boundary was therefore never tested this round.** It still needs testing, and cannot
be until R3-1 is fixed.

---

## R3-10 — A member's chat message is shown as sent and never leaves the phone (HEADLINE)

Fifteen members used this church for over an hour. **One** chat message exists on the relay, and it
was posted by the church key. No member message reached it at all.

I tested it myself, twice, on two different browsers in two different rooms, as admitted members:

| | browser 9439, "Whole Church" | browser 9443, "Prayer" |
|---|---|---|
| compose field found | yes (`Message…`) | yes (`Message…`) |
| driver result | "sent — and the words are on screen" | "sent — and the words are on screen" |
| still on screen +6s | gone | gone |
| still on screen +18s | — | gone |
| on the relay | no | no |
| rejection logged | none | none |
| room afterwards | "No messages yet" | "No messages yet" |

The message appears briefly, disappears within about six seconds, and nothing is written to the relay.
The relay logged no refusal, so as far as it is concerned the event was never offered.

The church key CAN post — the one Notices message went through — so this is specific to members.

This is the failure shape this project has hit before and written a rule about: **a control that
reports success over a send that never happened.** A congregation would experience it as messages
that quietly vanish, and would blame each other before blaming the app.

Worth checking on a real phone before anything else in this list.

### Why the round looked so quiet

This one defect explains most of what the other agents reported as their own dead ends: no member
conversation anywhere, several agents reporting rooms that seemed empty or unusable, and the chatty
member unable to test deletion, undo, reactions, ordering or direct messages — because none of the
messages those tests depend on ever existed.

## R3-11 — Nothing was published to the calendar, rota or resources all round

Confirmed on the relay: zero `event:`, `service:`, `rota:`, `runsheet:`, `booking:` or resource
documents after the full session. Three member agents (rota volunteer, events, content) spent their
runs waiting for content that never arrived, and correctly reported empty states with helpful wording.

From the owner steward's own account, the reasons were: the group-creation form "reopened without
saving" for two of four groups; the finance amount field would not accept a value; the devotional
upload could not proceed past "Tap to pick a file"; and no delete affordance could be found anywhere
for a posted announcement, a group, or a calendar entry.

The devotional file picker is the harness (headless browsers have no file dialog). The others are
worth reproducing by hand — particularly the group form that reopens empty, which loses work silently.

### R3-10, narrowed — and one hypothesis tested and REFUTED

A fourth member (the 14-year-old, on 9438) hit this independently: "Attempted to post in the
'Whole Church' room (which says 'everyone can post'), but the message send failed silently."

**Hypothesis I tested:** the three rooms created in the first seconds of the church's life have no
`groupkey:` document, so the client cannot seal a message and drops it.

    Whole Church  group      groupkey MISSING
    Notices       broadcast  groupkey MISSING
    Prayer        group      groupkey MISSING
    Welcome Team  group      groupkey PRESENT   <- created later by the steward
    Worship       team       groupkey MISSING

**Refuted.** I posted into Welcome Team, the one room that HAS a key, as an admitted member. Same
result: "sent — and the words are on screen", gone by +10s, nothing on the relay.

So the missing group keys are a separate observation, not the cause.

**What the evidence actually supports:** the church key can post (its Notices message is on the relay,
in the clear) and a member cannot, in any room, keyed or not. Four members across four rooms. The
distinguishing factor is who is sending, not what they are sending to.

## R3-12 — Four of five rooms have no group key

Recorded separately now that it is not the cause of R3-10. The three rooms created with the church,
plus the Worship team room, have no `trinityone/groupkey:` document; the only room that has one is the
group the steward made by hand later.

Same shape as R3-3 (the stewards document that published with no names): things created in the first
seconds of a church's life come out incomplete, silently, and nothing retries. Whether a keyless room
is a problem in itself needs someone who knows the intent — a broadcast room posting in the clear may
be deliberate.

## R3-13 — A weak backup passphrase is warned about, accepted, then silently discarded

From the recovery member, after being sent back to actually drive it:

- The app warns "Use a longer passphrase — at least 12 characters"
- It still lets you press "Create backup" with a one-character or empty passphrase
- The backup is then silently rejected — the timestamp does not move
- No error is shown

So someone protecting their church account with a short passphrase is told it is weak, allowed to
proceed, and ends up with no backup at all and no way to know.

Also from that run, verified rather than assumed: the recovery words were **identical on a second
reveal**, word verification correctly rejects a wrong answer, and the backup flow does NOT falsely
claim a file was saved. Those three were tested and passed.

## R3-14 — Skip the backup once and you are never asked again

The "Secure your account" banner appears only during onboarding. Choosing "I'll back these up later"
removes every future prompt; recovery setup then lives in Settings → Recovery key and is found only by
looking for it. This is the onboarding risk already on record — confirmed still live on this build.

## R3-15 — The PIN screen asks twice without saying so

Two password fields, no indication that the second is a confirmation. Repeated "The two PINs don't
match" without explaining what is being asked. I hit this myself while setting up a steward console
before any agent started, so it is not an agent artefact.

## Parent's view of safeguarding — product questions, not defects

The parent (who created two child accounts) could not find: a kids check-in a parent can use, any way
to see who runs children's work or whether they are cleared, any photo-consent control, or a
children's group. Their verdict: "I would NOT trust this app with my children in its current state."

These are absence claims, which this project's own record says are the weakest thing a round produces.
Two are explainable by design — `clearance:` is sealed to the care key, so a parent is not meant to
read it, and check-in is a steward-side desk function. Recorded as questions for the owner rather than
findings: should a parent be able to see that their child's leaders are cleared, and should the child
accounts' "Waiting for steward to confirm" say what it is waiting for?

---
---

# CORRECTION — R3-10 IS WITHDRAWN. It was a harness artefact.

Written after the code audit refused to reproduce it and I re-tested properly.

**R3-10 was the headline of this round and it was wrong.**

The auditor could not reproduce it: its own sends reached the relay with `OK true`. It had driven
these same live browsers, and its three probe messages ARE on the relay and DO render in Whole Church
("audit probe alpha/beta/zeta", 2:59–3:13 PM). So member sending was never broken.

### What I got wrong, in order

1. I used the driver's `write` + `send` verbs. Both reported success and the textarea cleared, so I
   read that as a real send that vanished.
2. I then hooked `WebSocket.prototype.send` and saw **zero frames**, which I took as proof. **That
   hook is blind** — the same browser published seven documents at 14:36:36 while it reported zero.
   I should have validated the instrument against a known-good send before trusting it. I did not.
3. Four agents independently reported the same failure, which I read as corroboration. It was not —
   all four were driving the same broken verb, so it was one cause counted four times.

### The controlled test that settles it

Same browser, same room, same moment:

| method | reached the relay |
|---|---|
| driver `write` + `send` | NO (×4 attempts) |
| native value setter + `input` event, then a real click on the `Send` button | **YES, immediately** |

`write` sets the textarea's `.value` without React registering it. The app's send handler reads empty
state, posts nothing, and clears the box. The driver then reports "sent — and the words are on screen"
by reading the DOM it just wrote itself.

### What this invalidates beyond R3-10

Every finding in this round that depended on typing into a field is now suspect and must be re-tested
with the native setter before anyone acts on it. That includes at least:

- the finance amount field "not accepting values" (owner steward)
- the group-creation form that "reopened without saving"
- the care-need form's "UI issues"
- the chatty member's untestable delete / undo / reactions / ordering / DMs
- the "no member conversation anywhere" reading of the whole round

**The round was quiet because the driver could not type, not because the app could not send.**

### The rule this earns

An instrument must be proved against a known-good case before its silence is treated as evidence.
Zero frames, zero rows and zero rejections all agreed with each other and were all consistent with a
send that never happened — and equally consistent with a probe that could not see. I had a working
send available the whole time (the church key's own message) and never used it to check my hook.

---

# The code audit's verdicts (worktree at `c105152`, read-only)

Full evidence in `CODE-AUDIT-round3.md`.

| Finding | Verdict |
|---|---|
| R3-10 message never reaches relay | **WITHDRAWN — harness** (see above) |
| R3-1 delegated steward never finds church | **REAL DEFECT, client-side** — `_boxHostsUs` (`steward.src.js:585-640`) is keyed on the console's OWN key, so it answers "no" for every delegated steward; `ownRelay()` falls back to the canonical relay, `relayList()` is `[]`, and zero frames are sent |
| R3-3 first stewards publish had no names | **REAL DEFECT** — `setStewards` seals with the sync `_sealChurchDoc` (`:5701`) not `_sealChurchDocReady`; null means `n` is dropped and the publish still reports success |
| R3-5 child stays a guardian | **REAL DEFECT (safeguarding)** — picker-only check (`stew-dashboard.jsx:4213`), no re-validation in `setMinors`/`setGuardians` |
| R3-6 console ships no help | **CONFIRMED**, no recorded decision behind it |
| R3-8 help exit is an unlabelled chevron | **CONFIRMED** — `IconBtn chevL`, aria-label only |
| R3-4 minors/nophoto/guardians cleartext | **BY DESIGN, documented** — `DOMAIN.md:177,192`; the relay parses all three for the DM and photo gates |
| R3-12 four rooms without a group key | **BY DESIGN** — only rooms marked encrypted mint one |
| R3-13 weak passphrase silently discarded | **HARNESS** — `checkPass` refuses and both screens surface it |
| R3-14 never asked again after skipping backup | **WRONG** — `RecoveryNudge` stays on Today until backed up, with a 3-day snooze |
| R3-15 PIN asks twice unlabelled | **HARNESS** — the second field has an aria-label and the placeholder "Type it again"; `innerText` never shows placeholders |
| R3-2, R3-9, R3-11 | **CANNOT TELL** without a device or a CDP breakpoint |
| Parent's safeguarding questions | **BY DESIGN** — clearance is sealed to the subject plus church and safeguarding stewards |

## R3-5 has a worse consequence than the round found — verified

I checked the auditor's sharpest claim myself rather than relaying it.

`gateway.mjs:1411`:

    const guardianLinkedIn = (a, b, cp) => { … const ga = m.get(a); if (ga && ga.has(b)) return true;
                                             const gb = m.get(b); return !!(gb && gb.has(a)); };

It is **symmetric** — it matches whether the link is stored a→b or b→a. At `:1470` a match short-circuits
the safeguarding refusal with `continue`.

So a child wrongly recorded as another child's guardian does not merely look untidy on a register: it
opens a **direct-message path between two children that the safeguarding gate would otherwise refuse**,
in both directions. The bad link was created by the ordinary route of marking someone as a young person
after they were already a guardian.

---

# Device + re-verification pass (Oppo J77HDMTC7TKBZDFM, 2026-09-06)

Relay checked first: process started 13:56 today, `scripts/gateway.mjs` last written 09-05 08:59 —
the process is newer, so CLAUDE.md rule 10's stale-relay trap does not apply.

## R3-6 — CONFIRMED ON THE DEVICE

Probed both installed APKs over CDP. The real steward console loads 27 scripts:

    react, react-dom, steward.js, recovery.js, finance-ledger.js, steward-manna.js, steward-meals.js,
    jsqr.js, jspdf.umd.min.js, error-boundary.js, icons.js, stew-modal.js, stew-data.js, recur.js,
    stew-console.js, stew-schedule.js, stew-templates.js, stew-dashboard.js, stew-finance.js,
    stew-manna.js, stew-meals.js, stew-relay.js, stew-extension.js, stew-phone.js, stew-custody.js,
    backup.js, steward-root.js, sw-register.js

Not one help file. The member APK on the same phone loads all four:
`help-illustrations.js, help-data.js, screens-help.js, screens-help-main.js`.

Not a bundling accident of the served pages — it is true of the shipped app on real hardware.

## R3-8 — CONFIRMED ON THE DEVICE, and downgraded

Screenshot at `oppo-member-help.png`. Help & Guides fills the screen; the tab bar is gone; the only
control is a bare `‹` in a white circle, top-left, with an aria-label and no visible word.

**But the phone has Android's own back gesture and nav bar**, which the browser simulation did not.
A real person on a phone has an escape the simulated users lacked. This is a smaller problem than the
round made it look — real, worth a word next to the arrow, not urgent.

## R3-2 — DOES NOT REPRODUCE

Re-tested in steady state, using a genuine steward code generated on the phone ("Steady Olive 41",
`npub1cmg6wz0sw…qzmmsj2rfyw`) and added on the owner console with the Care capability.

    +6s   not in the list
    +30s  in the list, no reload — three stewards shown, relay agrees

So the list DOES refresh itself; it is just slow. The original failure was in the first minutes of a
brand-new church, which matches the audit's guess about the boot window. Not a general refresh bug.
Worth noting the 6-second gap is long enough for an owner to conclude the add failed.

## R3-11 — the group form is NOT broken

Re-created a group on the owner console using the native value setter instead of the driver's `write`:

    typed "Device Check Group" -> clicked "Create group"
    -> modal closed, group on screen, `trinityone/group:` document on the relay

The form saves correctly. "The form reopened without saving" was the same typing artefact that faked
R3-10. R3-11's remaining half — that no calendar, rota or resource documents were produced all round —
is explained by the same cause.

## R3-9 — STILL OPEN, and not testable on the phone

The blank browsers were a desktop-Chromium state (`display:none` on the document element). A phone
WebView is a different renderer and reproducing it there would prove nothing either way. It needs the
CDP attribute-modified breakpoint the audit suggested, on a browser, when it next happens.

## Verification scorecard for this pass

| Item | Result |
|---|---|
| R3-6 no console help | CONFIRMED on device |
| R3-8 unlabelled help exit | CONFIRMED on device, severity reduced (Android back exists) |
| R3-2 steward list refresh | DOES NOT REPRODUCE — refreshes in under 30s |
| R3-11 group form loses work | NOT A DEFECT — harness typing |
| R3-9 blank render | STILL OPEN, needs a browser breakpoint |

---

# CORRECTION TO THE CORRECTION — the mechanism, found and fixed (2026-09-06)

My retraction of R3-10 was right that it was a harness artefact. **My explanation of why was wrong.**

I said the driver's `write` set the field's value without React registering it. Not so — `write` does a
real mouse press then `Input.insertText`, which is a genuine browser input path and works correctly.

The actual defect was in `send` (`scripts/sim-actor.mjs`):

    s.call(t, ${JSON.stringify(a1 || '')});   // a1 is undefined for a bare `send`

A bare `send` set the composer to the **empty string**, wiping whatever `write` had just typed, pressed
Enter on an empty box, and sent nothing. The success check then looked for the needle on the page — the
needle was also the empty string, and `indexOf('') >= 0` is true for every page there has ever been. So
it printed "sent — and the words are on screen" unconditionally.

**Fixed and verified against the live relay:**

| | result |
|---|---|
| `write "Message…" "…"` then bare `send` | message on the relay |
| `send "…"` | message on the relay |
| bare `send` on an empty composer | refuses: "the composer is empty — give send the text, or write into it first" |

The file is gitignored by design (`.gitignore:96`, after a sim driver once carried 36 private keys), so
this fix lives on the dev box and is in no commit.

This also finally explains R3-11: the calendar, rota and resources were empty because the steward agent
was driving the same verb.

---

# DEVICE PASS (step 2) — first finding, before the handoff's five stages

Oppo `J77HDMTC7TKBZDFM`, member APK, joined to SIM St Werburgh's over the Tailscale funnel
(`wss://trinityone.tailbeaac0.ts.net/relay` → `http://127.0.0.1:8000`, our round-3 relay, build `c105152`).

## D-1 — the phone says "your request has been sent" and publishes nothing

**What I did.** Navigated the app to the church's follow link with the funnel relay as the `relay`
parameter. The app accepted it: active church is the round-3 npub, and the funnel relay is in
`trinityone.relays.verified`.

**What the phone shows.** "Waiting to be let in — Your request has been sent. A steward usually…"

**What the relay holds.** Nothing at all from this phone:

    events from pubkey 1e02b3be… : 0

No rejection was logged either, so the relay was never offered anything to refuse. The fifteen browser
members joined the same church on the same relay without trouble, so it is not the church or the gate.

**It survives a restart.** `am force-stop` then relaunch: still "request has been sent", still zero events.

**The network is fine, and I proved it rather than assuming.** Opened a WebSocket from inside the app
to the same URL by hand:

    CONNECTED, first frame: ["AUTH","3ca1258a5d6a10c2f32ae8e738e7ee46"]

**And the app believes it is connected:**

    Fellowship.relays        -> ["wss://trinityone.tailbeaac0.ts.net/relay", "wss://app.trinityone.church/relay",
                                 "wss://trinityone-master-01.tailbeaac0.ts.net/relay"]
    Fellowship.relaysHealthy -> true

So: correct relay, first in the list, reachable, reported healthy — and not one document published,
while the screen tells the person their request is on its way.

**Family.** This is the third face of the same shape this session keeps turning up: a surface reporting
success over a publish that never happened. It is also the member-side twin of R3-1, where a console
holds a proved relay and dials nothing. And `relaysHealthy() === true` is the flag the project's own
notes record as the thing that disables the safety net when a socket has quietly died.

**Scope not established.** I have one phone, one church, joined by a link carrying a `relay=` parameter
into an app that already had three relays. I have NOT shown this happens on a clean install, or without
the parameter, or on the Pixel. Do not generalise it to "members cannot join from a phone" until those
are tried — that is exactly the over-claim this round has already punished once.

**Why it matters if it generalises.** A person who cannot join, and is told they have, is a pilot
blocker: the church sees no request to approve and the member sees no problem to report.

## D-1 RESOLVED — the phone was PIN-locked, and unlocking does not fix the connection

**Correction to my own D-1 above: the connection was never closed.** I claimed "no socket open" on the
strength of a hook that saw nothing in 22 seconds. Watching from outside through a reload shows three
sockets and 40 frames, actively reading this church. The app was simply idle when I looked, and my hook
was installed after its sockets already existed. Same mistake as the WebSocket hook earlier today.

**What was actually wrong:** the member app was locked — "Enter your PIN · Your account is locked."
I never unlocked it. That part is my setup error, and the owner's instinct was right.

**But the defect underneath is real, and now has a device reproduction.** After unlocking with the PIN:

    {"at":"2026-09-06T17:46:32Z","by":"1e02b3bed820ee64","authed":null,
     "kind":30078,"d":"trinityone/prayer","why":"not a member or not permitted for this group"}

`authed: null`. The app is writing, and the relay sees an unauthenticated client. Watching a full
reload, **not one AUTH frame is ever sent** — only REQs.

The chain:

1. the app boots locked, so it cannot sign an AUTH challenge;
2. it connects anyway and reads anonymously — which works, because reads of public docs are allowed;
3. unlocking does not authenticate the sockets that are already open;
4. every write is then refused, silently;
5. the screen says "Your request has been sent to SIM St Werburgh's."

This is exactly the code audit's second unreported finding — *"a socket challenged while locked is never
re-authed after unlock"* — which the round never looked at. It now has a relay-side proof.

`fellowship.src.js:2391` says a keyless→keyed reconnection re-auths already-open sockets automatically.
Locked→unlocked is a different transition and does not appear to take that path.

**Control run:** the APK was installed 2026-09-05 09:53 and only one code commit has landed since
(`a208d55`, reseat/publish/stewards), so this is not a stale build.

**Who this hits:** anyone who has set a PIN on the member app, every time the app restarts. The project's
own note says "PIN lock breaks relay auth — locked boot → anon reads; fixed by re-auth-on-unlock". Either
that fix does not cover this path or it has regressed.

---

# DEVICE PASS on the merge candidate (`fix/session-2026-09-04` @ 7a07ab3, debug APK)

## D-2 — WITHDRAWN. "Admit all" works; I never confirmed the dialog

Owner console, Members tab, with four people waiting to join.

    click "Admit all 4"  -> list still reads "Requests to join · 4"
                         -> relay's admitted: doc unchanged (13:27:41, 15 members)
                         -> no toast, no error, no message of any kind
                         -> no rejection logged by the relay

    click "Approve" on one person  -> admitted: doc rewritten at 22:53:56, count 15 -> 16

    click "Admit all 3"  -> list still reads "Requests to join · 3"
                         -> admitted: doc unchanged (still 22:53:56, count 16)

Reproduced twice, once before and once after a console reload and re-unlock, so it is not a stale
render. The single-person control works; the bulk control is inert.

**What a steward experiences:** they press the one button built for a Sunday-morning queue of joiners,
nothing happens, nothing is said, and the queue stays exactly as it was. The most likely responses are
pressing it repeatedly or concluding the app is broken — and the people waiting stay outside.

This is the same family as the four "said it worked, did nothing" defects already on this list, except
this one does not even claim success. It is silent.

**Not established:** whether it fails for all sizes of queue, whether it ever worked, and whether the
steward console's own copy of this control behaves differently from a delegated steward's. Found at the
very start of the device pass, so the remaining handoff stages are still unrun.

## Verified working on this build (recorded because it matters as much)

**The join-while-locked fix, end to end, by me on the phone rather than reported to me:**

    boots locked  -> intent {cp:5399…, forPub:1e02…} recorded, relay untouched,
                     screen reads "You'll ask to join this church when you unlock this phone"
    PIN entered   -> trinityone/member:53998834… lands on the relay at 22:50:13, live, not deleted
                  -> intent cleared to [], screen changes to "Your request has been sent"

The wording never claims the request was sent before it was. This is the defect that blocked joining
for anyone with a PIN, and it is fixed on the branch that is going to main.

### D-2 WITHDRAWN — the app was right, my clicks were wrong

`stew-dashboard.jsx:4968` — the "Admit all N" button does not admit anyone. It sets
`setConfirmAdmitAll(true)`, opening an `SkConfirm` panel (`:4958`) whose confirm button carries **the
same label**. So the screen legitimately did not change: it was waiting for a yes.

Three errors, all mine:

1. I clicked the opener and treated the unchanged list as a failed action, never noticing a confirmation
   panel had opened. Its text was on screen the whole time: "Admit 3 people? They get everything a member
   gets — the directory, chat, the calendar…".
2. Two visible buttons share the label. `.find()` returns the first, which is the opener.
3. My fallback took the LAST match, also the opener — and by then the dialog overlay covered it, so the
   click landed on a `DIV` and did nothing at all.

Clicking the button that is actually inside `[role=dialog]`: admitted doc rewritten at 22:58:08,
count 16 → 19, all three admitted, "Requests to join" gone.

**The lesson, and it is the third time today.** The driver's own `click` verb carries a covered-element
guard that prints "COVERED: … NOT clicked — nothing was pressed", and it caught this exact class of
mistake earlier in the round. I bypassed it by clicking through raw `eval`. Every one of today's false
findings came from driving or measuring the app by hand and trusting the silence that came back:

- the "member messages vanish" headline — a driver verb that wiped the composer
- the "no connection open" claim — a socket hook installed after the sockets existed
- this — a confirm dialog never confirmed, and a click that hit a covered element

**Rule for the next round: use the driver's verbs. When bypassing them, prove the interaction happened
before reporting that it did not work.**

## Device pass — STAGE 1 of 5: safeguarding with a skewed clock — PASS

Oppo, merge candidate APK. Host and phone verified in sync first (both 23:59:58), then
`cmd alarm set-time` put the phone 892s (~15 min) ahead. `settings put global auto_time 0` first,
restored to 1 afterwards.

App force-stopped and relaunched so it booted with the skew, then unlocked with its PIN.

**What it showed:**

> Can't check with your church right now
> Your church's relay wouldn't accept this phone. If it doesn't clear on its own shortly, speak to
> whoever runs your church.

**And critically:** `Set up help` is NOT offered (`/Set up help/i` → false). The requirement from the
handoff — requests held, never offered "Set up help" while identity is unverified — holds.

This is the honest degradation the gate is supposed to produce: it says it cannot check, rather than
rendering an empty screen or offering an action it cannot stand behind.

**Caveat, and it is the known open item #1 from HANDOFF-2026-09-04-END:** the wording blames the relay.
A person whose clock has drifted is told their church's relay refused them and to go and speak to whoever
runs the church — neither of which is true or actionable. One line naming the clock would close it. The
owner has already decided not to widen the relay's own auth window, so the fix belongs on the phone.

**Clock restored and checked against the host: drift −1s.**

## Device pass — STAGE 2 of 5: two consoles — FIRST HALF PASS, second half not testable

Two consoles on SIM St Werburgh's: 9420 (owner) and 9422 (co-steward via recovery phrase).

**Close on one, seen on the other — PASS.**

    both consoles: "REQUESTS FOR HELP · 2"  (Josh Bennett, Margaret Ellis)
    9420: "Close — not needed" -> inline confirm appears ("Yes, close it" / "Keep it open")
    9420: "Yes, close it"      -> trinityone/carereqstatus:867df91c… published 23:04:06
    9420: REQUESTS FOR HELP · 1, Josh gone
    9422: REQUESTS FOR HELP · 1, Josh gone — WITHOUT being touched

Cross-console propagation works.

**Note for whoever drives this next:** closing a request is a two-step inline confirm, not a dialog —
the button is REPLACED in place by "Yes, close it"/"Keep it open". Same shape as "Admit all". A single
click looks exactly like a control that did nothing, which is how I produced a false finding earlier
today (D-2, withdrawn).

**Second half — approve while the relay is unreachable — NOT TESTABLE with this harness.**
Relay stopped, "Set up help" clicked: it opens a form that requires picking dates ("Pick the days
first — a need with no days is one nobody can sign"). The driver cannot set date chips (round 3 C12,
same limitation). No claim either way about the "help is set up, the request is still open" line —
it was never reached. Needs a human on the device.

Relay restarted afterwards: up at 00:04:39, newer than scripts/gateway.mjs (09-05 08:59).

## Device pass — STAGE 3 of 5: the bank import — PASS

Owner console, Finance, using `scripts/fixtures/bank-statement-sample.csv` (15 lines, real UK export
shape). The driver's `file` verb hands it over via `DOM.setFileInputFiles`, so this flow IS drivable.

**First import:**

    column-mapping dialog -> defaults correct for this header row -> "Review transactions →"
    review: "15 selected · 15 found", the £45.00 J & M PATTERSON line present at full value
    "Post 15 transactions"
    -> IN THE BANK £581.54 · INCOME £1,943.81 · SPENDING £1,362.27 · SURPLUS £581.54

**Reconciliation — correct.** The statement's opening balance is £4,162.55 (its first row is +£20.00
leaving £4,182.55). £4,162.55 + £581.54 = **£4,744.09**, the closing balance the handoff names. The
console's "IN THE BANK" figure is the movement the import posted, not the bank's balance, so the two
numbers agreeing this exactly is the check passing, not failing.

The £45.00 line is the one that used to import as £25.00. It came in whole.

**Second import of the same file — nothing posts:**

    "0 selected · 15 found · 15 already imported"
    every row tagged "· already imported"

**Not run:** the third leg (pull the network mid-import, reconnect, press "Try again"). Cutting the
relay mid-post is not something this harness can time reliably, and a wrong cut would produce a false
result rather than no result. Wants a human.

## Device pass — STAGE 4 of 5: identity — PASS on both testable parts

**Rename twice in one sitting — PASS.** This is the one that used to lose the second change.

    "Add your name"      -> "Device Tester One"  -> sealed name doc on the relay 23:10:20
    "Edit name & mark"   -> "Device Tester Two"  -> name doc rewritten 23:11:37
    force-stop, relaunch, unlock -> profile reads "Device Tester Two"

Both writes landed and the second survived a full restart. Note the name is NOT in the clear anywhere:
kind-0 carries no `name` field at all, and `trinityone/name:<church>` is `{"c":"Aupm…"}` ciphertext —
the privacy work on this branch holding up on a real device.

**Message delete — PASS.** Posted from the phone (kind-1 on the relay 23:13:38), deleted it:

    kind-5 deletion published 23:17:44 · deletions table 1 · the kind-1 is GONE from the relay
    the message is gone from the room on screen

**Undo — NOT TESTED, and not a finding either way.** Deleting raises a NATIVE confirm
("Delete this message? It's removed for everyone." / CANCEL / OK) which parks the WebView until it is
answered — `cdp.probe.mjs` does not handle dialogs, and `Page.handleJavaScriptDialog` does not fire for
an already-open one, so it had to be answered with `adb shell input tap`. By the time the page was
responsive again the Undo window had passed. Confirmations collapse after a few seconds by design.

Undo is the item the handoff flags as "used to fail about half the time", so it still wants a human
with a thumb on the device. Everything up to it works.

**Small observation, not chased:** after deleting, the room list still previewed the deleted message as
the room's latest. The room itself was correct and the relay had no copy. Likely a cached preview.

---

# GUARDIAN FIX — verified by me on the live console against real bad data (2026-09-07)

Branch `fix/guardian-links` merged into `fix/guardian-and-steward-access`; relay restarted at 08:47:55,
15s after `gateway.mjs` was written, so no stale-relay trap.

**The data it was tested against was genuinely broken, not staged.** It came out of sim round 3:

    minors:    4e57c067, bdb7e22f, 78bfdfd6, 3729cf8d
    guardians: bdb7e22f -> 78bfdfd6   AND   bdb7e22f -> 3729cf8d
               i.e. Tom Okafor, himself marked as a child, was guardian of two other children

**1. The console now SHOWS the contradiction.** Tom's row on the members list reads:

    CHILD · PARENT: INES DUARTE · PARENT ACCOUNT · CHILD · STILL LISTED AS A GUARDIAN

That is the only way a steward learns about a historic bad record, and it appeared without prompting.

**2. Marking him as a child ENDS the guardian roles.** After toggling the Child mark:

    minors doc    rewritten 07:50:51
    guardians doc rewritten 07:50:51
    CONTRADICTIONS NOW: NONE
    links now: { bdb7e22f: [a0cf5449] }

Both his guardian roles over other children are gone, and **his own parent link (Ines Duarte, an
adult) is preserved** — it removed him as a guardian OF others without stripping his own guardian.
Minors written first, guardians second, as the design specified.

**3. A guardian request from a child is refused with a reason.** A pending request produced:

    "Tom Okafor asks to be linked as a parent — is marked as a child and cannot be a guardian"

**What I did NOT verify on the device:** that the relay gate itself now refuses a child-to-child DM.
That needs the two children's private keys, which I do not have. The gate is one clause
(`gateway.mjs`: `guardianLinkedIn(...) && !minorOf(other, cp)`), it is covered by the branch's own
tests, and I read it — but I have not driven a refused message end to end, and I am not claiming it.

---

# STEWARD ACCESS FIX — verified by me on the console that was actually stranded (2026-09-07)

The test case is the real one: console 9421 ("Sure Haven 42"), granted `content, members` during sim
round 3, which then sat in an empty console and never found the church. Its browser profile and the
grant on the relay both survived, so this is the same console, not a re-creation.

**Before (round 3, recorded above as R3-1):** `subscribeStewardedChurches()` emitted `[]` twice — over
9 seconds and over 25 — and `actingChurch` stayed null through a reload and an unlock.

**After, same console, same grant:**

    subscribeStewardedChurches()  ->  ["53998834c6ce59bc…"]   (emitted twice in 30s)
    switcher lists                 ->  "SIM St Werburgh's — You steward this church"
    after selecting it             ->  actingChurch = 53998834c6ce59bc
    header                         ->  "SS · SIM St Werburgh's · STEWARD · Acting as steward"

Discover, switch, act — the whole journey, on the console that could not do any of it yesterday.

## The capability boundary — tested for the first time, and it holds

Round 3 could not test this at all: I had given the second console the recovery phrase, which made it an
owner. This console is a genuine delegate with `content, members` and nothing else.

    caps          ["content","members"]
    tabs present  Overview, Groups, Rota, Calendar, Rooms, Resources, Members, Check-in, Settings
    tabs ABSENT   Finance, Care          <- exactly the two not granted

Check-in is present but refuses on open, and the wording is worth keeping:

> "Safeguarding isn't yours to run — You're helping run this church as a steward, and this part hasn't
> been given to you. Nothing is broken and you haven't done anything wrong. Ask whoever holds the
> church key — they can change it in a couple of taps from their own console."

## NEW FINDING — a misleading banner on every tab of a delegated console

Sitting above that, on Overview, Groups, Members and Check-in — every tab I opened:

> "Changes weren't saved: this relay is set up for a different church. Restore this church's key in
> Settings, or point the relay at this church."

Both halves are wrong for this console. The relay at :8000 IS this church's relay — the steward is
reading and acting through it as I write this. And it tells a **delegated steward** to restore the
church key, which is the one thing they must never do: it would replace the church identity on their
device, and the console's own Stewards panel correctly says elsewhere that only the church key holder
can make those changes.

Likely the same signal the fix touches: `_refreshBoxHostsUs()` returns early when `localAdminToken()`
is null, which the plan anticipated and called the safe side for admission — the box stays in, and
discovery demonstrably works. But a banner keyed on that same unanswered question now fires as a
definite negative.

**Not a blocker for this fix** — the fix does what it set out to do, proven above. But it is user-facing,
it is wrong, and it advises a destructive action. Worth fixing before any delegated steward sees it.

---

# BANNER FIX + STEWARD HELP — device-verified (2026-09-07)

## The false banner — fixed, and verified on the delegated console

Before: on every tab of the delegated console — "this relay is set up for a different church. Restore
this church's key in Settings" — while that console was acting through the very relay it named.

After (same console, reloaded with cache bypass, unlocked):

    actingChurch  53998834c6ce      (still acting, choice remembered across the reload)
    old banner    GONE
    new banner    "…this part of the church hasn't been given to you. Ask whoever holds the church key"

Cause confirmed from `relay/rejected.log`, not guessed: that steward's refusals were `carekey:` (no care
grant) and `groupkey:`, both while properly authenticated — capability refusals the relay phrases exactly
like a wrong church.

**A trap worth recording.** My first version referenced `window` directly and broke THREE existing tests
with a ReferenceError: `publish-error-msg.test.mjs` lifts that function out of the JSX and runs it with no
DOM. The `typeof window` guard is load-bearing, not style. I found it by running the existing test rather
than assuming — the same second-caller-list trap this project has been bitten by repeatedly.

## Steward console help — R3-6 closed, verified in the shipped APK

R3-6 said: "The steward console has no in-app help. None." Rebuilt the steward APK and installed it.

**Packaged:** `help-data.js`, `help-illustrations.js`, `screens-help.js`, `stew-help.js` all inside
`trinityone-steward.apk`. **Live in the running app:**

    window.HelpData          19 articles
    window.StewardHelp       function
    window.HelpBlock         function
    window.BackupWalkthrough undefined   <- correct: screens-help-main.jsx deliberately NOT loaded,
                                            it reads window.TrinityIdentity, which the console lacks

**Driven on the phone.** Restored the church onto the phone console (which also exercised the
restore-from-phrase path on a device), opened the dashboard, tapped Help:

> "Short guides to running your church on TrinityOne. The same words your members can read in their app,
> so you are never telling them something different."
> For leaders — the steward console · Church finances · …

**Hardware back closes it and does NOT exit the app** — the device-specific check, passed.

## Suite

2835 tests, 2835 pass, 0 fail, 0 skipped in the main tree. Chain: 2791 (main at merge) → 2813 (guardian)
→ 2823 (steward access) → 2824 (banner) → 2835 (help). Nothing removed at any step.

## Still not device-verified, and not claimed

- The relay refusing a child-to-child DM end to end (needs both children's private keys).
- Help at the largest text size, in dark mode, and the read-aloud control.
- The steward APK opening Help **offline** — the service-worker precache derives from the shell, and I
  tested online.
