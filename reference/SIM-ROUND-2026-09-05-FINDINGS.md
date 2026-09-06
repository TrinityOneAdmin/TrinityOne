# Sim round findings — 2026-09-05/06

Branch `fix/session-2026-09-04`, relay wiped clean before the round. **Nothing in here has been fixed.**
Findings only, per the standing rule.

## How to read this
Every claim was checked against `relay/relay.sqlite` and `relay/rejected.log`, not against a screen or an
agent's report. Where an agent's claim did not survive that check it is marked REFUTED and the measurement
is shown. Two findings (C10, C12) were **withdrawn by me** after the code triage and a re-test proved they
were artefacts of the test harness — those sections are kept, struck, so nobody re-finds them.

A read-only code triage of every finding is summarised in the owner's notes; its verdicts are folded in
below where they change a finding.

## Worth a human's time, in order
1. **C13** — pinning a message in an encrypted room publishes its plaintext. Proven before/after.
2. **C11** — a child can sign up to take a meal to an unwell adult. `gateway.mjs:2453` has no minor check;
   the identical gate one line below, for the "here to help" register, does.
3. **C3 / C6** — a steward console on a fresh profile is deaf to its own relay for the life of the page.
4. **C8** — publishing a rota re-publishes the service name, date and time in cleartext, tied to a key.
5. **C2 / C4 / C1b** — the wizard discards the relay's refusal; the church ends up with no name and no key.
6. **C9** — the wizard's starter rooms are not child-safe, so children see no rooms at all.
7. **C12-note** — a care need can be opened FOR a child. No age check either way.
8. **C5 / C7 / C1** — one failure, several different and sometimes wrong explanations.

---

# Sim round 2026-09-05 — candidate findings
# RULE 2: the prior is that the app WORKS. Everything here is a CANDIDATE until reproduced.
# Record the SURFACE for each one — console / member app / phone / relay database.

## C1 — the relay says exactly what is wrong, and the console replaces it with something wrong
**Surface:** steward console (browser, 1440x900) against the local relay `ws://127.0.0.1:8000/relay`.
**Status: REPRODUCED, cause established by calling the engine directly.**

Created a church end to end in the setup wizard: console PIN, name "SIM St Brendan's", recovery phrase,
phrase check, then "Create 3 & continue" on the rooms step. That step failed with:

> "Couldn't create your rooms — the relay didn't accept them. Check you're online and try again; your
> choices are still here."

Keeping the choices is right and is this branch's own behaviour working. **The diagnosis is wrong**, and the
wizard had already been told the truth two steps earlier.

Calling the engine by hand from the same page:

    window.Steward.selfRegister("SIM St Brendan's", {createHere:true})
    -> { ok:false,
         refused:[{ base:"http://127.0.0.1:8000", status:403,
                    why:"this relay is invite-only — ask the operator to add your church" }],
         unreachable:["https://app.trinityone.church","https://trinityone-master-01.tailbeaac0.ts.net"] }

So the relay answered with a plain-English reason a churchwarden could act on. The wizard's name step
(`app/stew-dashboard.jsx` saveName) calls exactly this and discards the result:

    try { ... await selfRegister(n, { createHere: true }) } catch (e) {}

`{ ok:false, refused:[...] }` is a RESOLVED promise, so the empty catch is not even the whole story — the
result is simply never read. The wizard advances to the recovery-phrase step as though the church had been
registered, and the founder learns something is wrong three steps later, from a message telling them to
check a connection that was never down.

**Consequence.** A person following the on-screen advice checks their wifi, retries, and fails for ever. The
one instruction that would fix it — ask the operator to add your church — was in hand and thrown away.

**Not a relay bug.** invite-only is a legitimate operator setting and this box has it on. The finding is that
the console discards a specific, actionable refusal and substitutes a generic, incorrect one.

**Same shape as the third audit's finding 7**: a message naming a cause the relay never reported. That one
was a missing church key, this is an unregistered church, and both say "check you're online".

**Worth a decision, not just a fix:** should the wizard surface this at the NAME step, where the refusal
actually happens, rather than letting the founder build a church for three more screens first?

### C1b — and it does not recover once the operator fixes it
After the operator added the church to the relay (`POST /config addChurch`, `ok:true`), pressing
"Create 3 & continue" again **still published nothing**. The console had to re-run `selfRegister` by hand
before the rooms would save; then all three published immediately and `selfRegister` returned `ok:true`.

So the sequence a real church would follow — hit the error, ask the operator, operator adds them, press the
button again — does not work. The registration gate stays closed for the life of the page, and nothing in
the retry path re-attempts registration. The founder would have to know to reload.

**This is the actionable half of C1.** Even with perfect wording on the error, the recovery it advises does
not currently work without a reload.

## C2 — you name your church, and the church has no name. Everything downstream fails from this.
**Surface:** steward console (browser) against the local relay. **Status: REPRODUCED, ROOT CAUSE ESTABLISHED,
survives a reload.**

The church was created through the wizard and given the name "SIM St Brendan's". Measured afterwards:

    kind-0 profile for this church on the relay      -> 0 rows
    the word "Brendan" anywhere in the console        -> absent
    window.Steward.nameKeyReady()                     -> false
    trinityone/namekey:<church> on the relay          -> 0 rows

The church is nameless. Nothing on any screen said so, at any point.

### The chain, in order

1. The wizard's name step calls `selfRegister(name, {createHere:true})` and **discards the result**. On this
   relay it returned `{ok:false, refused:[{status:403, why:"this relay is invite-only — ask the operator to
   add your church"}]}` (that is C1).
2. The very next line publishes the church profile — the document that carries the NAME. The relay refuses
   it, because a church it does not serve cannot write. That failure is not surfaced either.
3. So no kind-0 profile exists, and `church.name` is empty everywhere.
4. The enrolment effect that mints the church's encryption key bails on `!church.name`. No name, no key —
   for ever, not as a race. It survived a full page reload and unlock.
5. With no key, this branch's calendar REFUSES to save (correctly — that is the fix). So a service, rota,
   room, booking or event cannot be created at all.

### Why this matters, in one sentence
Before this branch, step 5 failed OPEN and wrote the church's gatherings to the relay in cleartext, which is
the defect the whole branch exists to fix. It now fails CLOSED — which is right — so a swallowed error two
steps earlier turns into a church that cannot use its own calendar.

### The two swallowed failures are the fix
Both are in the wizard's name step (`app/stew-dashboard.jsx` saveName). `selfRegister` RESOLVES with
`{ok:false, refused:[…]}` — it does not throw — so the `try/catch` around it never sees anything; the result
is simply not read. `publishProfile`'s result is not checked either. Either check alone would have stopped
the founder at the step where the problem actually was, with the relay's own actionable sentence in hand.

**Corrects my earlier note in this file:** I first recorded this as "cause not established" and specifically
warned against claiming the key never arrives. The cause is now established by measurement, and the claim is
narrower and stronger than the one I was avoiding: the key never arrives BECAUSE the church has no name.

## C3 — rooms you just created are invisible until you reload
**Surface:** steward console. **Status: REPRODUCED.**

Immediately after the three starter rooms published successfully (Notices, Whole Church, Prayer — all three
confirmed in `relay.sqlite` with distinct d-tags and real content), the dashboard read:

> Groups **0** — "No groups yet — create your church's first chat room."

Still 0 twelve seconds later. After a page reload and PIN unlock, all three appeared.

So the subscription established while the church was unregistered returned nothing and was never retried.
Same shape as C1b: the console does not recover from the relay changing its mind about you, and a reload is
the only route back. A founder in that state is told they have no rooms immediately after creating three.

### C1c — a second, different refusal, ignored identically
With invite-only turned OFF, a second church ("SIM St Chad's") was created from a clean console. The relay
refused registration again, for a different and equally actionable reason:

    status 403  "this relay is already set up for its church. Ask the operator to add yours, or turn on
                 \u201cOffer to host other churches\u201d."

The wizard behaved exactly as before: no indication at the name step, straight on to the recovery phrase.

This matters because it rules out the obvious narrow fix. The relay has at least two independent gates that
refuse a new church, each with its own sentence naming the remedy, and the console discards both. Special-
casing "invite-only" would leave this one, and any future gate, in the same state. **The console has to read
`selfRegister`\'s result, whatever the reason inside it.**

## C4 — a church that does EVERYTHING right still never gets its encryption key
**Surface:** steward console (browser) against the local relay, invite-only OFF and hosting ON.
**Status: REPRODUCED on the clean path. This is separate from C2 and more serious.**

C2 showed the key going missing as a CONSEQUENCE of a swallowed refusal. To separate cause from effect, a
third church ("SIM St Hilda's") was created with the relay fully open from the very first step, so nothing
was refused at any point:

    church registered itself at the name step        -> relay church list went 4 -> 5, unprompted
    kind-0 profile (the church NAME) on the relay     -> 1 row   (so the name DID save this time)
    three rooms published                             -> 3 rows, distinct, real content
    trinityone/namekey:<church> on the relay          -> 0 rows
    window.Steward.nameKeyReady()                     -> false

Everything the wizard is supposed to do succeeded. The church is registered, named and has its rooms. It
still has no encryption key, after the whole wizard and with nothing refused.

**Consequence on this branch:** the calendar refuses to save. Service, rota, room, booking and event all go
through the sealer, and the sealer now returns null rather than writing cleartext. So a brand-new church
that has done nothing wrong cannot put anything in its calendar — and this is the state a real church is in
on day one.

**This is the risk of the trade we made and it has landed.** Failing closed is right; failing closed on the
happy path is not. Before this branch these documents would have been written unencrypted, which is the
defect the branch exists to fix — so this is not an argument for reverting, it is the missing half of the fix.

**Rules out:** the first audit's finding 3 (`church.name` missing from the enrolment effect's dependencies,
fixed in 556e861) as a sufficient explanation. This church HAS a published name and still has no key.

**The relay is ELIMINATED as a cause.** `relay/rejected.log` — the relay's own record of everything it
refused — contains ZERO entries for this church, and none for `trinityone/namekey:289b…`. So the key
document is never even ATTEMPTED. The refusal is entirely client-side, inside `_ensureNameKeyLocked`, before
anything reaches the wire. (I should have read this log hours earlier; it is named in
`reference/sim/RUNBOOK-next-session.md` as ground truth alongside the store.)

**Not established:** which guard in `_ensureNameKeyLocked` refuses. `ensureNameKeyForMembers` returns null
silently, and neither `_nameKeyChecked` nor `_isRelayAuthed()` is visible from the page. Two candidates
remain and I have not distinguished them.

### C3 reproduced on this church too
St Hilda's dashboard also reads "No groups yet — create your church's first chat room" while the relay holds
all three of its rooms (Whole Church, Notices, Prayer, verified by content). Two churches, two clean runs,
same result — so C3 is not a one-off of the refused path.

## C5 — the calendar blames the relay for a refusal the relay never saw
**Surface:** steward console, church "SIM St Hilda's" (clean path: registered, named, rooms published).
**Status: REPRODUCED. This is the user-visible face of C4, and it is the third audit's finding 7 confirmed
on a real console.** Screenshot: `shots/04-meetings-result.png`.

The wizard's last step offers two default weekly meetings. Pressing "Add 2 & continue":

> "Couldn't save your meetings — the relay didn't accept them. Check you're online and try again; your rows
> are still here."

Measured: `0` service or event documents on the relay for this church. The relay did not refuse anything —
it never received a write. The document was refused by the console's own sealer, because the church has no
encryption key (C4). The connection was healthy throughout; the same console had published rooms minutes
earlier.

"Your rows are still here" is correct and is this branch's own behaviour working — the typing is kept.

**The message names the wrong party.** A founder is told to check a connection that is fine, about a relay
that did nothing, for a document that never left the building. There is no route from this screen to the
actual cause.

Third occurrence of the same shape in one round: C1 (registration refused -> "check you're online"), C1c (a
different registration refusal -> same), and now the calendar. Three different causes, one misleading
sentence.

### Also seen — CHASED AND WITHDRAWN
During the wizard the console header read "Your Church" and the npub rather than "SIM St Hilda's". Once the
wizard closed, the header read "SIM St Hilda's / @simsthildas" correctly. That was the profile round-trip
still in flight, not a defect. Withdrawn.

### C5b — and the only way out of that step is to delete what it suggested
The meetings step offers two default weekly meetings and its button reads "Add 2 & continue". With no
church key that button can never succeed. There is no skip **while any row is present** — the modal's only
other controls are "Add another meeting" and "Back".

Removing BOTH rows changes the button to "Skip for now", and the wizard advances.

So the escape exists and is invisible: a founder is told to check their internet, and the actual way forward
is to delete the two meetings the wizard itself proposed. Confirms the third audit's prediction for this
path, on a real console.

(Checked and NOT a finding: the row-removal buttons carry `title="Remove this meeting"`, which is a valid
accessible name. They render as icon-only and appeared unlabelled to a text scan — I nearly filed that.)

---

# VERIFIED WORKING (not findings) — recorded because a round should say what it proved, not only what broke

- **The first-launch wizard is a real modal, on a real browser.** Measured on a fresh profile:
  `role="dialog"`, `aria-modal="true"`, `aria-label="Set up TrinityOne"`, and BOTH siblings carrying
  `inert` and `aria-hidden="true"`. The sim harness independently refused to tap "Community" behind it
  ("on screen but NOT tapable"), which is the behaviour those attributes exist to produce. This is finding 6
  of the 2026-09-05 audit, fixed this session, confirmed outside its own test.
- **The owner's PIN decision works, live, and knows which platform it is on.** On the member app in a
  BROWSER the field reads "At least 6 — letters, or 8+ digits" and six digits is refused with "On a computer
  an all-number PIN is easy to guess — use 8+ digits, or add letters." On a phone the same field reads
  "digits are fine" and six is accepted. That is DOMAIN.md's 2026-09-05 decision implemented and confirmed
  outside its own test. Screenshots: shots/12-member-pin.png, shots/13-pin-6digits-web.png.
- **The console keeps the stricter PIN rule.** Its setup demands 8+ characters ("At least 8 — a generated
  password is best") while the owner's decision relaxed the MEMBER app to 6. The split is real.
- **PIN and recovery-phrase fields are named.** "Choose a console PIN or passphrase", "Repeat the console
  PIN or passphrase", "Word 3 of your recovery phrase" etc. — the a11y work from an earlier round holding.
- **Kids check-in is opt-in and its flag reaches the relay.** Off by default; switching it on in Settings ->
  Features publishes `features: {checkin: true}` in the church's profile and the Check-in tab appears.
- **The check-in screen states its own limits honestly**, unprompted: that it is a door operation done by a
  leader, that parents see nothing in their app, and that records are encrypted to the safeguarding key with
  the relay holding only ciphertext.
- **Sealing refusals keep the steward's work.** Every refusal seen this round ("your rows are still here",
  "your choices are still here") kept what had been typed. That is this branch's own fix behaving.

## Observed, believed EXPECTED — flagged rather than filed
On a fresh profile the app mints an identity immediately and shows "Secure your account / Skip setup for
now" rather than forcing the 12-word ceremony. `trinityone.onboarded` is null at that point. This matches
the DEFERRED owner decision to move the ceremony to the "you're approved" moment, so it is recorded as an
observation, NOT a defect. Confirm before anyone "fixes" it.

---

# CLEAN-ROOM REPRODUCTION of C4 — relay wiped, nothing else on it

Done after wiping the relay to zero events and zero churches, per
`reference/sim/RUNBOOK-next-session.md`. Church "SIM St Aidan's", console on a fresh browser profile.

| step | result |
|---|---|
| church self-registers at the name step | **worked** — relay church list 0 -> 1 within 4s, unprompted |
| church profile (the name) publishes | worked |
| three rooms publish | worked — 3 `group:` documents, and these are GATED writes |
| `trinityone/namekey:` ever published | **never**, across 32s in the wizard + 30s on the dashboard |
| `nameKeyReady()` | **false throughout** |
| relay rejections for this church | **zero** |

**What this establishes.** The rooms are gated writes and the relay accepted them, so the console's connection
is authenticated. The relay's own rejection log has nothing for this church, so the key document is never
sent. Of the two conditions that can stop the mint, one is therefore satisfied, and the refusal is entirely
client-side and silent — it returns null, logs nothing, and no screen mentions it.

**What this rules out**, each by measurement rather than reasoning:
- the relay (zero rejections, and it accepted every other write)
- invite-only / hosting policy (both open, and the church registered itself)
- a missing church name (published, verified on the relay)
- leftover state from earlier churches (the store was empty)
- the first audit's finding 3, `church.name` missing from the effect dependencies (fixed in 556e861; this
  church has a name and still has no key)
- the wizard-vs-dashboard mount question — the key is absent 30s AFTER the dashboard is up

**Consequence, unchanged and now certain:** on this branch a brand-new church cannot save a service, rota,
room, booking or event, because the sealer refuses without a key. This is the trade this branch made — fail
closed instead of writing cleartext — landing on the happy path. It is the round's headline finding.

**Still not established:** which of the two internal conditions is stuck. Neither is visible from the page.
Answering it needs a temporary read-out of those flags, or the relay's socket log alongside a console boot —
operator work against the code, not something a sim can see. Per the runbook: the symptom is the finding; the
cause is diagnosed separately, and asserting one without tracing it is what cost five wrong diagnoses in an
earlier round.

**NOTE for what comes next:** kids check-in is encrypted to the SAFEGUARDING key, not this one. It should be
unaffected, and is still worth driving.

---

# CORRECTION — C4 said "never". That was wrong. Here is what actually happens.

The clean-room run was left alone and watched. The key DID arrive. Full timeline from the store, one church,
one clean relay:

    17:43:04   name typed, "Continue" pressed
    17:43:01   church registers itself on the relay            <- instant, correct
    17:44:20   three rooms publish                             <- gated writes, so the socket is authed
    17:47:30   the CHURCH PROFILE (the name) finally publishes  <- FOUR AND A HALF MINUTES LATE
    17:49:11   trinityone/namekey: minted                       <- ~100s after the name existed
    17:49:12   financekey, checkinkey
    17:49:14   carekey
    17:50:18   meals-settings (care switched on)
    17:50:38   the care announcement posted to the church

**So there is one root cause, not three.** The church's NAME is not published when the founder enters it.
Everything else follows: no name -> the enrolment effect bails -> no encryption key -> the calendar refuses
every service, rota, room, booking and event. Once the name lands, the key mints on its own within about
100 seconds and the whole chain unblocks.

**This supersedes C4's headline.** "A church that does everything right never gets its encryption key" is
FALSE. The correct statement is: *the church's name takes minutes to publish, and until it does the calendar
cannot be used and nothing says why.* C2's chain (a swallowed refusal loses the name entirely) is the severe
version of the same thing — there the name never arrives at all.

**What I got wrong and how.** I measured the key's absence three times, at 32s, at 30s and after the wizard,
and generalised to "never" without ever leaving it alone for five minutes. The runbook's rule — confirm the
symptom, do not assert the cause — I followed for the cause and then broke for the duration. An absence claim
again, and again wrong. The measurement that corrected it cost one query against the store.

**What remains true and worth fixing:**
- The name publish is minutes late and, on the C2 path, silently lost for good.
- Nothing on any screen says the church is not ready. The founder is invited to add meetings during the
  window when adding meetings cannot work.
- The calendar's refusal blames the relay and the network for a delay inside the console (C5).

**What is now DISPROVEN and must not be repeated:** that the relay refuses the key (it never sees it), that
`_isRelayAuthed` is stuck (rooms published), that the key never mints (it does).

---

# THE BRANCH'S CENTRAL FIX, CONFIRMED ON A LIVE CHURCH

Once the key existed, an event was created through the console the way a steward would: "Harvest Supper",
27 September, 18:30, "The parish hall, 14 Fenwick Road".

    on the relay:  SEALED   {"e":"AmddpJBJY6V9osT3t9RB3s0H1REPLpupGvKaQBIa8kDb…"}
    "Fenwick" legible anywhere in the store:  0 rows

This is the defect the whole branch exists to fix, measured working. Before it, the same action wrote
`{"date":"2026-09-27","time":"18:30","title":"Harvest Supper","where":"The parish hall, 14 Fenwick Road"}`
in the clear — and 25 of 25 calendar documents on the old relay were exactly that. For a congregation where
meeting is the risk, the address and the timetable are the operational intelligence that matters.

Also confirmed in the same run: `namekey`, `financekey`, `checkinkey` and `carekey` all minted, care switched
on through its own `meals-settings` document, and the care announcement posted to the church — the
announcements surface, which no previous round had ever driven.

(Harness note, not a defect: typing into the Date field does nothing — it is an `input[type=date]` and needs
its value set programmatically. The first save silently did not happen because the date was empty. Any future
round driving this form must check the field values before believing a failure.)

---

# KIDS CHECK-IN — DRIVEN END TO END FOR THE FIRST TIME IN ANY ROUND

The coverage tool had this as never exercised. Full path, on a clean relay, every step verified against the
store rather than the screen.

| step | evidence |
|---|---|
| feature is opt-in, OFF by default | Settings -> Features, "Off — Check children in/out with a secure pickup code" |
| switching it on | church profile gains `features: {checkin: true}` on the relay |
| four members join and are admitted | 4 `member:` docs, 4 SEALED `name:` docs, one `admitted:` doc, zero rejections |
| mark the child | `minors:` doc lists `1398badc…` — **verified against Dorothy's OWN device**, not the console's label |
| clear an adult for youth work | `approved:` doc lists Margaret, with `by` (who cleared her) and `at` (when) |
| link the parent | `guardians:` maps Dorothy -> `f88d372c…` — **verified against Grace's own device** |
| check the child in | screen: "CHECKED IN · 1 / Dorothy Okoro / In 6:04 PM · pickup: Grace Okoro / CODE 6432" |

**The screen's own privacy claim, tested.** It states: *"Records are encrypted to your safeguarding key — the
relay stores only ciphertext."* Measured across every document on the relay:

    "Dorothy"      -> 0 documents
    "Grace"        -> 0 documents
    pickup code    -> 0 documents
    the record itself: AjzdicmRV7mA4uXwkM0J0nhcZPWcFwtXvJbxrXcAZH7Jl33wYImZSKoB/Bd/…

The claim is TRUE. A child's presence, her name, her guardian and her pickup code are all invisible to
anyone holding the relay's disk.

**The guardian dialog refuses to link a child as a parent** — "Only adults (not other children) can be
linked" — and the list offered only the three adults.

Screenshots: `shots/30-checkin-ready.png`, `shots/31-pick-child.png`, `shots/32-checked-in.png`.

**Not yet driven:** checking OUT against the code (the button is there), and what a wrong code does.

---

## C6 — a person asking to join is INVISIBLE to the steward until the console is reloaded
**Surface:** steward console, clean relay, church "SIM St Aidan's". **Status: REPRODUCED, and this is the
operationally worst member of the stale-view family (C3).**

A fifth member (Sam Okoro) completed the join wizard and followed the church. Measured:

    member documents on the relay        5   (his request is there)
    console Members tab, searched for him:  ABSENT — not in the queue, not anywhere
    admitted list on the relay:          4   (correctly, he is not admitted)

The console was already open on the Members tab and had been used minutes earlier. He simply never appeared.
After a page reload and PIN unlock: "Sam Okoro · @samokoro · wants to join · Approve".

**Why this outranks the rooms version.** C3 hides something the steward created and can see is missing. This
hides a PERSON, and the steward has no reason to suspect anyone is there. The member's app shows them
following the church and waiting; the steward's console shows an empty queue. Nobody is wrong on their own
screen and nobody is served.

`reference/sim/RUNBOOK-next-session.md` records the cost of exactly this shape: *"A church whose steward
cannot admit people turns every member's run into 'waiting for approval' and wastes the round — which is
exactly what happened on 2026-08-19."* That round blamed the app generally; this is a specific,
reproducible cause.

**Same family, now four reproductions:** rooms invisible after creating them (twice, two churches), the care
announcement told to "make a chat room first" when three existed, and now a join request. Each time a reload
is the only route back. A steward who does not think to reload has no way to know anything is missing.

---

# THE SAFEGUARDING BOUNDARY, TESTED BY PEOPLE WHO DID NOT KNOW WHAT WAS MEANT TO HAPPEN

Five members driven by separate agents, none told what the rules were, so none could confirm what they
expected. Everything below is verified against `relay/relay.sqlite` and `relay/rejected.log`, not from the
agents' reports.

Cast: Dorothy (child), Sam (child), Grace (adult, linked parent of Dorothy ONLY), Margaret (adult, CLEARED
for youth), Tom (adult, NOT cleared).

## What the relay ALLOWED — every direct message that landed, by recipient

    Dorothy (child)  ->  Margaret (CLEARED)      landed
    Dorothy (child)  ->  Grace (her linked mum)  landed
    Grace (mum)      ->  Dorothy (her child)     landed
    Grace (mum)      ->  Margaret (adult)        landed

Four messages, all correct. A child can reach a cleared adult and her own parent; the parent can reach her
child. Dorothy's agent reported a real reply from Grace and the store confirms it — this is two-way, not
just accepted-and-dropped.

## What the relay REFUSED — the enforced half

    18:24:11  Tom (NOT cleared)  kind 4  ->  "not a member or not permitted for this group"
    18:24:18  Tom                kind 4  ->  refused
    18:24:36  Tom                kind 4  ->  refused
    18:25:03  Tom                kind 4  ->  refused

Four attempts, four refusals, and `authed: 3b34d8c132d3726f` on each — he was properly authenticated, so
this is not an authentication failure. The relay specifically refused an uncleared adult's direct messages.
**This is the enforced protection, not the presented one.** `reference/SAFEGUARDING-BOUNDARY.md` claims the
refusal holds "no matter what the phone does"; here the phone tried and the relay said no.

Separately, Dorothy's app never offered Tom as someone she could message at all — the presented layer — so
the two halves were observed working together.

## The finding that makes it precise: the SAME adult, allowed for one child and refused for another

Grace sent four messages: 2 landed, 2 refused. She is recorded as the linked parent of **Dorothy only** —
I never linked her to Sam. Her two landed messages went to Dorothy and Margaret.

So the two refusals are consistent with her attempts to Sam, a child she is not recorded as guardian to and
whom she is not cleared to contact. If that is what they were, the boundary is finer than "adults vs
children": it is per-child, per-relationship.

**NOW PROVEN, by controlled experiment.** Two independent confirmations:

1. Grace's own agent reported, unprompted, that her message to Sam failed with **"blocked: not a member or
   not permitted"** while her messages to Dorothy went through — supplying the recipient the relay log
   could not.
2. The experiment: Grace was then linked as Sam's guardian on the console (`guardians:` on the relay now
   maps BOTH children to her key), and the same message was sent again from the same device.

       before the link:  Grace -> Sam   REFUSED   (3 refusals in the relay's log)
       after the link:   Grace -> Sam   LANDED    (kind-4 count 7 -> 8, f88d372cbb92 -> 41c79bdd3b25,
                                                   and no new refusal)

Same adult, same child, same message; the only change was the recorded relationship.

**So the boundary is not "adults vs children". It is per-child and per-relationship, and the relay
enforces it.** An adult who is a guardian to one child and not another is allowed for the first and refused
for the second, with no client involvement. That is a stronger guarantee than
`reference/SAFEGUARDING-BOUNDARY.md` currently spells out, and it is worth saying there in those terms.

## Also confirmed against the store
- **Child photos suppressed automatically.** `nophoto:` lists BOTH children's keys. Nobody set this; marking
  them as minors did it. Dorothy's app told her "A steward has turned off photos for your account."
- **A young person's request for help is routed to trained adults**, per Dorothy's screen: a private form
  "that goes only to people trained to help young people".
- **RSVP works** — 2 rsvp documents on the relay, from Sam. A surface no previous round had ever driven.

---

# THE AGENTS' REPORTS, CHECKED AGAINST THE STORE

Five agents, none told what was meant to happen. Their reports are observations; what follows is what
survived checking. Three of five claims that would have gone into a document were wrong.

## CONFIRMED — the enforced safeguarding boundary holds

**Allowed, and on the relay:**

    Dorothy (child)   -> Margaret (CLEARED)        landed
    Dorothy (child)   -> Grace (her linked mum)    landed
    Grace (mum)       -> Dorothy (her child)       landed
    Grace (mum)       -> Margaret (adult)          landed
    Margaret (CLEARED)-> Dorothy (child)           landed  [driven by the operator — see below]

**Refused, in the relay's own log:**

    18:24:11  Tom (NOT cleared)  kind 4  "not a member or not permitted for this group"   authed: yes
    18:24:18  Tom                kind 4  refused
    18:24:36  Tom                kind 4  refused
    18:25:03  Tom                kind 4  refused

Tom was authenticated on each attempt, so this is the relay refusing an uncleared adult's messages to
children — the ENFORCED protection, not the app hiding a button. Dorothy's app also never offered Tom as
someone she could message, so the presented and enforced layers were seen working together.

## REFUTED — Margaret's "messages showed as sent"
Her report said she messaged Dorothy, Sam and Grace. Measured: **zero** messages authored by her on the
relay, **zero** refusals, and her device's outbox and failed-queue both empty `[]`. The messages existed
nowhere.

Driven directly by the operator from the same browser, a message to Dorothy landed within seconds
(kind-4 count 5 -> 6, authored by her key). **So the feature works and the agent's sends never happened.**
This is verbatim the failure `reference/sim/RUNBOOK-next-session.md` records from round 3: *"one reported
seven messages 'all sent successfully' (the relay received NONE, and its own instance sent fine when driven
directly)"*.

## REFUTED — "the app is now non-functional" (Sam), "navigation is completely blocked" (Dorothy)
Both children's agents ended their runs stuck in the Bibles sheet. The sheet is real (`role=dialog`,
`aria-label="Bibles"`, z-index 55) and it does cover the tab bar. **It closes with a Back button** whose only
name is `aria-label="Back"` — no visible text. Tapping it by that name closed it instantly and the app was
fully usable.

Not a defect — but the runbook records the SAME false finding from round 3 (*"a modal that 'cannot be
closed' (it closes with tap Back)"*). **Three agents across two rounds have now concluded a Bible sheet
cannot be closed.** That is a signal about the affordance, not about the code: the only exit from a
full-screen sheet is an unlabelled icon. Worth the owner's eye as a usability question, not filed as a bug.

## REFUTED — Sam's five refusals were not messages
`kind 30078`, d-tags `highlights / bookmarks / notes / journal / prayer`, all `authed: NO` — his personal
documents refused before he was admitted. The identical benign pattern appears for every member at join.
Reading those as blocked messages would have been a false safeguarding finding.

## CONFIRMED against the store
- **Child photos suppressed automatically** — `nophoto:` lists both children. Nobody set it; marking them as
  minors did. Dorothy's app: "A steward has turned off photos for your account."
- **Care sign-up works** — Margaret's `careavail:` document is on the relay (Childcare, Visits, Prayer,
  Meals, Errands). "Care — signing up" had never been driven in any round.
- **Care requests work** — two `carereq:` documents, from Tom and Grace. Tom's app: "Sent privately — only
  your church leader can open this."
- **RSVP works** — 2 documents. Never driven before.
- **Group chat works** — 5 kind-1 posts across Whole Church and Prayer.
- **Clearance is visible to its holder** — Margaret's profile: "Your church has cleared you to work with
  young people. Others in your church can see that you are cleared."

## Worth the owner's attention, not yet a finding
Tom's messages to the children showed **"Waiting to send"** and stayed that way. The relay had refused them
four times. Never telling an uncleared adult *why* is defensible — confirming the boundary teaches it — but
"Waiting to send" says a thing will happen that never will. What he should see instead is a product
decision, not a bug.

## The unplanned moment worth keeping
Grace messaged Margaret: *"Hi Margaret, I heard Dorothy and Sam were checked in to group today. Do you have
their pickup code?"* Nobody scripted that. It is the check-in design working exactly as its own banner
describes — parents see nothing in their app, so a parent asks a leader — and it is the first evidence in
any round of that workflow happening naturally between two people.

## C7 — the same relay refusal is reported two different ways
**Surface:** member app. **Status: REPRODUCED across two members.**

Both were refused by the relay for the same reason ("not a member or not permitted for this group"):

- **Grace** (unlinked parent -> Sam) saw **"blocked: not a member or not permitted"** — the relay's own
  words, surfaced to her.
- **Tom** (uncleared adult -> Dorothy and Sam) saw **"Waiting to send"**, and it stayed that way. Four
  refusals in the log; nothing on his screen ever said so.

One of these is a design decision worth making deliberately. Telling Tom would teach him the boundary and
confirm a child is there, which is a reason to say nothing — but "Waiting to send" says the opposite of
nothing: it promises delivery that will never come. Meanwhile Grace, who had a legitimate reason to be
confused, got a raw internal phrase ("not a member") about her own son.

Neither is obviously right. Both being different, for the same refusal, is the finding.

---

## NEAR-MISS worth a rule: never reuse a church name across rounds

The Oppo was brought in as a member. Its screen showed **"SIM St Aidan's"**, a Community tab and "Your
groups", while:

    phone's pubkey in the admitted list  ->  NO   (5 admitted, phone absent)
    followedChurches()                   ->  0
    rooms on the relay                   ->  3, but the phone said "hasn't opened any chat rooms yet"

That reads exactly like a member seeing a church they do not belong to — a serious finding, and I was one
step from writing it up. It is not.

`localStorage` settled it: the phone follows `npub1mtqe55kl8uy7sdugdm…`, a church from an EARLIER round that
the wipe deleted, cached locally with its name. **That old church was also called "SIM St Aidan's"** — the
name I reused for this round's church, which is `npub1hwl8ycqv56202apn…`. Two different keys, one name, and
the phone was correctly showing its own stale church, correctly reporting it has no rooms (it no longer
exists), and correctly not following mine.

**Rule for the next round: give every church a name no previous round has used**, and check the npub before
believing anything a device says about "the church". The relay is keyed on npub; humans and screens are
keyed on names, and the two diverge silently after a wipe.

### C3/C6 — I NARROWED THIS WRONG, AND THE CORRECTION MAKES IT THE ROUND'S MOST IMPORTANT FINDING

I first recorded this as console-only, because a freshly-admitted member on the Oppo saw the church's rooms
immediately. That inference was wrong: the phone had joined SECONDS earlier, so its subscriptions were new.

Measured properly, with a care need opened while members were already running:

    Margaret's browser (running ~1 hour), care need visible?   NO
    Grace's browser    (running ~1 hour), care need visible?    NO
    the Oppo           (joined minutes ago), same need?         YES
    Margaret's browser AFTER a page reload?                     YES

**So it is not console-only. Any long-running session — steward or member — misses documents published
after it started, and only a reload picks them up.** The Oppo saw the need because it was new, not because
phones are unaffected.

**Why this is the most consequential thing in the round.** The one job this feature exists for is: somebody
asks for help, the church opens a need, and members sign up. Measured here, the members who already had the
app open — the ones most likely to help — never saw it. Nothing on their screen was wrong; the need simply
was not there. Nobody is told anything is missing, so nobody thinks to reload.

The same mechanism explains every earlier symptom in one: rooms invisible to the steward who just made them,
a person invisible in the join queue, the care announcement told there was "no chat room" when three
existed, and Sam's row missing from Members. One cause, four faces, and the care one is the one that costs
a church something real.

---

# CARE, END TO END — asked for, opened, and fulfilled by three members

The whole loop, driven through the screens and verified against the store at every step.

| step | who | evidence on the relay |
|---|---|---|
| asked for help | Tom (meals + visits, with a note) | `carereq:3b34d8c1…` |
| asked for help | Grace (childcare + meals) | `carereq:f88d372c…` |
| offered to help | Margaret (childcare, visits, prayer, meals, errands) | `careavail:…` |
| steward opened a need | 5 days of dinners, 7-11 Sept | `care:caremtoqzxcv7c1wt` |
| signed up | **the Oppo, a real phone** | `careslot:` 2026-09-07 |
| signed up | Margaret | `careslot:` 2026-09-08 |
| signed up | Grace | `careslot:` 2026-09-09 |

The phone's screen tracked it live: `0/5` -> `1/5` after its own signup -> **`3/5`, "Meals · 2 days still
open"** once the other two joined in.

## What the relay can and cannot see

The care need is a MIXED document, and well judged — the same shape as the roster split:

    plain:  {"type":"meals","dates":["2026-09-07",…],"meals":["dinner"], …}
    sealed: "enc":"Aug…"   <- who it is for, and why

Measured across every document on the relay:

    "under the weather" (Tom's own words)  ->  0 documents
    "Thomas Ferris"                        ->  0 documents

So a seized relay learns that a church has a meals need on five dates and that three members signed up. It
does not learn who is unwell or why. On the member's device the same document opens fully — the phone showed
"Thomas Ferris" and his note — which is exactly the intended split.

The signup itself carries no name at all: `{"careId":…,"isoDate":"2026-09-07","note":""}`. The helper is
identified only by the key that signed it, and member names are sealed, so a helper is pseudonymous unless
their key is already known.

## The steward's own guard, worth keeping
Opening a need refuses to proceed without dates: *"Pick the days first — a need with no days is one nobody
can sign up to."*

---

# THE NEGLECTED AREAS — driven for the first time

Chosen from the coverage tool run against BOTH the pre-wipe backup (every previous round) and this round.
Five areas had never been driven by anybody; three of those overlap the code this branch changed most.

## Order of service (run sheet) — NEVER driven in any round, and on this branch's changed path
Created a team ("Welcome Team": Greeter, Door, Refreshments), a service ("Sunday Gathering", 13 Sept), then
a run sheet item: 10:30, "Welcome and notices", led by Margaret Hoyle.

    trinityone/runsheet:svc17886355281   SEALED
    "Margaret Hoyle" legible on the relay:  0 documents

`publishRunsheet` is one of the six publishers rewritten this session. Its own code comment records that it
wrote cleartext until 2026-08-18, so "the relay held the order of service — including the minister named
against each item — readable by anyone with the disk". Confirmed sealed, on a real console, for the first
time.

Also confirmed on the way: the team's roster published as `{"pubs":[], "e":"Ah20…"}` — the exact split
designed for finding 1: a cleartext key list for the relay's six grants, everything else sealed. And the
service published SEALED with "Sunday Gathering" legible in 0 documents.

## Safety check — NEVER driven in any round
Steward sent one from the Care tab (`trinityone/safetycheck:…`). It reached the Oppo within seconds, at the
top of Today:

> "Your church is checking everyone is safe / Are you safe? Please let us know. / [I'm safe] [I need help]
> Only the people your church chose for this check can open your reply — not other members. The relay can
> see that you replied and when, but not what you said."

**That claim is precise, so it was tested precisely.** Tapping "I'm safe" published
`trinityone/safe:…` from the phone:

    what the relay CAN see:  that this member replied, at 20:16:57, sealed to the church key
    what the relay CANNOT:   the answer — {"v":2,"to":{"bbbe72…":"AkKAXpwFCP1J0tIzVqOyPkrh/…"}}
    plaintext status field in that document: 0

The screen's claim holds exactly as worded. This is the strongest example in the round of a privacy
statement that says precisely what it means and is precisely true.

## Still not driven, and now the thinnest areas in the system
- **Prayer requests**
- **Media & sermons**
- **Relay names / going public** — deliberately NOT attempted: it exposes this box publicly and needs the
  owner's decision, not a sim's.
- **Rota publish + serving requests** — the team, service, roster and run sheet were all created, but
  nobody could be assigned to a role: the member picker is a native `<select>` and React did not accept a
  synthetic change event. **A harness limitation, not a product fault** — recorded so the next round budgets
  for it. This leaves `publishRota`'s serving-request path still undriven, which is the one this branch
  changed most and the one whose test provably cannot fail.
- **Delegated stewards** — one event in the entire history of the project.

---

## C8 — the serving request undoes the calendar sealing, and ties a gathering to a named key
**Surface:** steward console -> relay. **Status: REPRODUCED and MEASURED. New — neither audit found it, and
it was only reachable by driving a neglected area.**

Sequence, all on a clean relay:

1. Created service "Sunday Gathering", Sun 13 Sept 10:30. Verified immediately:
   `trinityone/service:…` **SEALED**, and `"Sunday Gathering"` legible in **0 documents**.
2. Staffed a team roster (Margaret, Grace, Tom) — **SEALED**, all three names legible in **0 documents**.
3. Pressed **Publish rota**. The rota published **SEALED**, names still 0.
4. And three `trinityone/request:` documents appeared, one per person, in **CLEARTEXT**:

        {"serviceId":"svc1788635528112","teamId":"…","roleId":"rkkl6k","role":"Greeter",
         "teamName":"Welcome Team","date":"2026-09-13","time":"10:30",
         "service":"Sunday Gathering","from":"Your church",
         "note":"Can you serve on Welcome Team (Greeter)?"}

   each p-tagged to one member's pubkey.

    "Sunday Gathering" legible on the relay AFTER publishing the rota:  3 documents
    (it was 0 before)

**What a seized relay now learns**, having been denied it three times over: that this church gathers on
13 September at 10:30, that the gathering is called "Sunday Gathering", that it has a "Welcome Team" with a
"Greeter" role, and **which specific key serves in it**.

**Severity.** The branch's own comments call the calendar "the most dangerous document in the database" and
say that for a congregation where meeting is the risk, "the address and the timetable are the operational
intelligence that matters". This document hands over the timetable and attaches a person to it. It is the
same class as finding 1 and finding 2, in a sibling nobody enumerated.

**Two things that limit it, stated fairly:**
- The request carries **no display name** — the member is identified only by pubkey, and member names ARE
  sealed. So it is "this key serves at this gathering", not "Margaret Hoyle serves at this gathering".
- The venue is not in the request; only the service name, date and time.

**Why neither audit caught it.** Both enumerated the callers and readers of `_sealChurchDoc` and of the five
name-carrying documents. `sendServingRequest` is neither — it is a separate publisher that happens to copy
fields out of a sealed document into a cleartext one. The lesson for the next enumeration: follow the DATA,
not only the function.

**Not fixed.** Findings only, per the standing rule.

---

# THE GUARD THIS BRANCH ADDED, TESTED AGAINST A REAL FAILURE — and a flaw in my own wording

The one thing on this branch with no test that can fail is the calendar's refusal path. Driven for real:
relay **stopped**, then a service added through the console.

    dialog stayed open                     YES
    what was typed was kept                YES  — "Relay Down Test" still in the field
    services created on the relay          NONE (3 -> 3)
    message shown                          "Not saved — your church's key hasn't arrived yet.
                                            Give it a moment and try again."

**The guard works.** Nothing was written, nothing was lost, the steward was told. Before this branch the same
action wrote the gathering to the relay in cleartext; three hours ago it would have closed the modal and
discarded the typing.

**But the message is wrong, and it is my wording.** The church key was present and healthy — the RELAY was
down. Both failures return null from the sealer's caller, and I wrote one sentence for both, so a relay
outage is reported as a missing church key. A steward would wait for a key that already exists.

That is the same defect I filed as C5 against the wizard, reproduced in the code I wrote to fix it. The
guard is right; the diagnosis is a guess. What it should say is "we couldn't reach your church's relay" when
`publish()` returned false, and "your church's key hasn't arrived yet" only when the sealer refused.

**Getting there took three attempts, recorded so the next round does not repeat them:**
1. `Network.emulateNetworkConditions` via a one-shot CDP call — reverts the instant the connection closes.
2. The same, held open — `navigator.onLine` false and `fetch` blocked, **but the publish still landed**:
   offline blocks new HTTP requests and leaves an already-open WebSocket alive. The relay connection is a
   WebSocket, so the app was never offline in the way that matters.
3. Stopping the relay — the only one that actually tests it.

**Anyone testing an offline path in this app must stop the relay, not the browser.**

---

# KIDS CHECK-OUT — the other half, driven for the first time

Completes the check-in work. Dorothy was checked in at 18:04 with pickup code **6432**.

**Wrong code first, because that is the case that matters:**

    entered 1111 (real code 6432) -> REFUSED
    dialog stayed open, child stayed checked in, nothing written to the relay
    message: "That code doesn't match — don't release the child if it's wrong."

That wording is worth keeping as it is. It does not merely report a failure; it tells the person at the door
what to DO, at the moment they are standing in front of somebody asking for a child.

**Correct code:**

    entered 6432 -> collected
    screen: "COLLECTED · 1 / Dorothy Okoro / In 6:04 PM · out 9:54 PM"
    the relay's record updated in place and remains ciphertext

**Privacy after collection**, measured across the check-in record:

    "Dorothy"  0     "6432"  0     "Grace"  0     "9:54"  0

So the full round trip — in, refused attempt, out — leaves nothing on the relay about who the child is, who
collected her, when, or what the code was.

**Also confirmed, and NOT a defect:** the "check a child in" picker offered only Sam, not Dorothy. Dorothy
was already checked in. The picker correctly excludes a child who is already in. I checked the minors list
on the relay (both children present) before concluding.

---

## C9 — a church set up with the wizard's own defaults gives its children an app with NO church rooms
**Surface:** member app, two children and one adult, same church. **Status: REPRODUCED on both children,
with an adult control, after reloading every browser so no stale session could fake it.**

The setup wizard's "Create a few spaces" step creates Whole Church, Notices and Prayer. Reading those
documents on the relay:

    Whole Church   childSafe=None   kind=group      <- "One room for everyone, and everyone can post"
    Notices        childSafe=None   kind=broadcast
    Prayer         childSafe=None   kind=group
    Welcome Team   childSafe=None   kind=team
    Leadership     childSafe=None   kind=group  encrypted=True   <- created deliberately adults-only

**Not one of them is marked child-safe.** The new-group form states the rule plainly: *"Groups that aren't
child-safe are hidden from children."*

What each person sees on the Community screen:

    Dorothy (13):  "Your groups — No groups yet. No group chats here for you yet — you can still
                    message people at your church directly."
    Sam (11):      the same
    Margaret:      Notices, Prayer, Whole Church, Leadership

So a church that follows the wizard, then marks its young people as children — exactly what a careful
church does — has just made every room in the building invisible to them, including the one the wizard
itself describes as "One room for everyone, and everyone can post".

**Stated fairly, both ways.** The DEFAULT IS THE SAFE DIRECTION and should stay that way: a room is hidden
from children unless somebody deliberately opens it. The new-group form defaults child-safe OFF and
encryption ON, which is right. The problem is that the wizard creates the starter rooms without ever asking,
so the safe default silently becomes "children get nothing" for every church that uses the quick setup.

**What is not wrong:** the message the child sees is honest, and private messaging still works — Dorothy has
live conversations with her mother and with Margaret. The safety check also reached her. She is not cut off
from people, only from every room.

**Worth a decision, not just a fix.** Should the wizard ask? Should "Whole Church" default to child-safe
given its own description? Or should the church be told, at the moment it marks its first child, what has
just become invisible to them? That is the owner's call, and DOMAIN.md's line applies — ship the mechanism,
not the policy.

**Also confirmed here (the enforced protection working):** the deliberately adults-only "Leadership" room is
visible to Margaret and invisible to both children. The control ran in the same breath as the finding.

---

## C10 — WITHDRAWN. Full-screen panels are fine on a real device; this was my harness.
**Surface:** member app. **Status: REPRODUCED SIX TIMES, by six different agents, across two rounds, on
THREE different panels.** Each occurrence ended that person's session.

Occurrences:
- Round 1: Sam and Dorothy, both trapped behind the **Bibles** list. Both reported "the app is now
  non-functional" / "navigation is completely blocked" and stopped.
- Round 2 (the week): Margaret, trapped behind **Search**, stopped at 119 of 200 actions.
- Round 2 (the week): Thomas Ferris, trapped behind **Bibles**, stopped at 161 actions, and filed a
  diagnosis his brief expressly forbade: *"Root Cause: the Bible browser appears to be layered on top of
  the main content as a CSS overlay (z-index or similar) that's not dismissible… This appears to be a
  critical pre-release bug."* It is dismissible — `tap "Back"` freed his session immediately and he
  returned to a working app. A person who cannot find the exit reasons their way to a cause instead, and
  the cause is wrong. That is the whole argument for the runbook's "describe what you SAW, never guess
  why" rule, demonstrated inside a brief that contained the rule.
- `reference/sim/RUNBOOK-next-session.md` records the same false finding from round 3, months earlier:
  *"one reported a modal that 'cannot be closed' (it closes with tap Back)"*.

Measured on Margaret's stuck session:

    open panel:      role=dialog, aria-label="Search"
    the tab bar:     genuinely covered — tapping "Community" hits a <P> of Bible text painted over it
    the only exits:  two icon buttons, NO visible text
                       one: aria-label="Back"
                       one: NO accessible name at all
    `tap "Back"` closes it instantly and everything works again.

**It is not a bug in the code — the exit exists and works.** It is a bug in what a person can find. Four
capable users in a row concluded the app was broken, when one unlabelled arrow was the way out. The second
exit button having no accessible name at all is a straightforward accessibility defect on top.

**Why it keeps being reported as fatal:** the panel covers the navigation, so the usual escape (press
another tab) is gone, and nothing on screen says how to leave. A person who does not spot a small
wordless arrow has no route back except restarting the app.

**Cheapest fixes to consider** (not applied — findings only): give the second button an accessible name;
give the back arrow a visible label or a text alternative; or let the tab bar sit above the panel so the
normal escape still works.

---

## C11 — an 11-year-old signed up to take a meal to an unwell adult, and the relay accepted it
**Surface:** member app (child's account) -> relay. **Status: MEASURED on the relay, not reported by an
agent.** Found by reading the store after the week, not from anybody's notes.

The care need opened for Thomas Ferris ("under the weather — meals Mon-Fri, and a visit if you can") was
filled by five signups:

    2026-09-07   the Oppo member (adult)
    2026-09-08   Margaret (adult)
    2026-09-09   Grace (adult)
    2026-09-10   **Sam — 11 years old, on this church's minors list**
    2026-09-11   Grace (adult)

Sam's key `41c79bdd3b25` is in `trinityone/minors:` for this church. The relay accepted his `careslot:`
without objection, and his own screen shows the need in full: **"Thomas Ferris — Meals · all covered — 5/5"**,
including the sealed note naming the man and saying he is unwell.

**So a child can (a) read who in the congregation is ill and why, and (b) commit to turning up at that
adult's home with a meal.** Nobody asked a parent, and nothing on any screen flagged it.

**This is a gap between the documented boundary and the behaviour, not a contradiction of it.**
`reference/SAFEGUARDING-BOUNDARY.md` says a young person "cannot list themselves in the church's 'I'm here
to help' register" — and that is true: the register is `careavail:`, and children are kept out of it. But
signing up for a specific day of a specific need is a different document (`careslot:`), and nothing stops
them. The protection was written for the register and the feature grew a second door.

**Why it matters under this project's own threat model:** the care system exists so that people who are
unwell, grieving or newly delivered are visited at home. Pairing that with an unaccompanied child is exactly
the situation safeguarding policy exists to prevent, and the app currently arranges it silently.

**Fairly stated:** an adult may well be taking the child. The point is that the app neither knows nor asks,
and no steward is told a minor is on the rota for a home visit.

**Owner's decision, not mine** — per DOMAIN.md, ship the mechanism, not the policy. The options are visible:
keep children out of `careslot:` as they are kept out of `careavail:`; or let them sign up but tell the care
team; or require a guardian's name on a child's signup. Not fixed. Recorded.

### C10 refined by the sixth occurrence — the cause is the visible-but-dead tab bar, not the unnamed button
Sam was trapped behind the **Serving** panel and ended his run on it. But that panel is not like the other
two:

    Serving panel exits:  ["Close", "Serving", "Rota", "Events", "Calendar", "Care", "Set unavailable"]
    unnamed buttons:      0

It has a properly named **Close**. He never tried it. What he did, repeatedly, was tap the bottom tabs —
which are still painted on screen and report "COVERED … NOT tapable".

So the missing-label problem (Bibles, Search) is real and worth fixing, but it is **not the root of this**.
Six people in a row aimed at the navigation they could see, because it was still there and still looked
live. The panel covers the tab bar without hiding it, so every instinct says "press a tab", and every tab
silently does nothing.

That reframes the cheapest fix: **do not leave a dead tab bar visible under a full-screen panel** — either
cover it properly, or leave it working. Naming the two unnamed arrows is worth doing as well, but on its own
it would not have saved any of the six.

---

# THE STEWARD'S WEEK — 248 actions, verified against the store

## CONTENT PUBLISHING — driven for the first time in any round (owner's ask)

**Both types uploaded successfully.**

    trinityone/devotional:devo1788676449239   "Harvest Blessing"
    trinityone/sermon:sermon1788676498614     "The Good Shepherd — A sermon on care and protection"
    trinityone/mediakey:…                     a media key was minted for it
    trinityone/pinsermon:…                    the sermon was pinned

**The audio is genuinely encrypted at rest — verified byte by byte, not taken on trust:**

    original file  : 4944 3304 …   ("ID3", a normal mp3 header)
    stored blob    : e003 9384 …   (unrecognisable; `file` reports "data")
    cmp            : DIFFERENT

The sermon document claims `"enc":true` and the claim is true. The blob sits at
`relay/blobs/bbaf776b…` with `.church` and `.type` sidecars, 48,555 bytes.

**But two things are in the clear**, and they are worth a decision under the persecuted-church framing:
- **The devotional's entire text.** `{"title":"Harvest Blessing","type":"md","text":"# Harvest — a week of
  short readings\n\n## Day 1 — Psalm 65 …"}` — the whole reading, readable on the relay.
- **The sermon's title**: "The Good Shepherd — A sermon on care and protection".

The audio is protected; what the church TEACHES is not. That may well be deliberate — teaching material is
arguably public — but the branch has just spent itself sealing gatherings and names, and a seized relay can
still read every devotional word and every sermon title. **Owner's call.**

**Nothing can be deleted.** The steward looked for a way to remove an uploaded devotional or sermon and
found none: *"Clicked Edit on Harvest Blessing… No delete button found. Only Cancel/Save."* Confirmed by
reading the screen — there is no delete affordance on either. A churchwarden who uploads the wrong file
cannot take it down.

## VERIFIED against the relay — the week's real output

    calendar events   5      services 3      rotas 1      run sheets 1
    team rosters      2      rooms/teams 6   serving requests 3

A second team (Worship: Lead, Vocals, Keys) was created, staffed, assigned and published, and a run sheet
written — all sealed, per the earlier checks.

**Finance works and is properly sealed.** `finance/journal:1`, plus seven `finance/account:` documents
(bank, building, giving, outreach, utilities, other-income, other-expense) — every one of them raw
ciphertext. Searching the whole relay for `"250"`, `250.00` and `£250` returns **zero**. Only the ACCOUNT
NAMES are visible, in the d-tags. A seized relay learns a church has a building fund and an outreach fund,
and not one figure.

## C12 — WITHDRAWN. The form refused correctly; the driver could not set dates.
The steward set up a care need for Dorothy — chose "Visits", linked her, picked two dates, pressed "Open
this need" — and reported: *"the form appeared to not complete… Unsure if the need was actually created."*

**It was not.** The relay holds exactly one `care:` document, the meals need from before. Nothing was
created, and nothing told them.

Same family as C1, C5 and C12: an action that does not happen, and a screen that does not say so. The
steward's own words are the finding — they left the form not knowing, and they were right not to know.

**Note, separately:** the need being set up was FOR A CHILD — visits to a 13-year-old, which the whole
congregation would then sign up to. Combined with C11 (a child signing up to visit an adult), the care
module has no notion of age in either direction. Worth the owner's eye as one question, not two.

## The backup: recorded on the relay, but nothing in the steward's hands
Pressing "Back up church data" reported *"✓ Saved 160 records — encrypted to your church key"* and did
publish `trinityone/backup-meta:…` at 07:33. But no file appeared in `~/Downloads` — the only backups there
are from June and August.

**NOT established as a defect.** This is headless Chromium, which discards downloads unless the harness
configures a download path, and this harness does not. The project's own memory records the real version of
this bug — `<a download>` writing no file in the APK WebView — as FIXED on 2026-08-16. **Re-test on the
phone or a headed browser before believing it.** Recorded because the steward's instinct was right and the
question is open: *"I clicked a button and it said it worked, but I have no file in my hands to prove it."*

## What a real churchwarden said would confuse them, in their words
- *"No clear deletion UI — where do I remove something I uploaded by mistake?"*
- *"Backup obscurity — I clicked a button and it said it worked, but I have no file."*
- *"Care form feedback — did my need setup actually save?"*
- *"Understanding that I had to add people to a team ROSTER before I could assign them to SERVICE ROLES took
  trial and error."*

---

## C13 — pinning a message in an END-TO-END ENCRYPTED room writes its plaintext to the relay
**Surface:** steward console -> relay. **Status: PROVEN by controlled before/after.** The code triage
flagged this as a possibility it could not confirm; this confirms it.

Room "Leadership", created through the console with the **Encrypted** switch on (`encrypted: true` on the
relay). A message was posted into it:

    "CANARY-PIN-TEST safeguarding review Thursday at 14 Fenwick Road"

**Before pinning** — the room's encryption working exactly as promised:

    stored message content:  kind 1, "AuAJBtM12JtIr19QSW2MNeZTgwzsrrFJ8A+xEqKUm75vVIywYh…"
    canary legible on the relay:  0 documents

**Then "Moderate" -> "Pin message".**

**After pinning:**

    canary legible on the relay:  1 document
    trinityone/pin:…  {"msgId":"04fe422d…","text":"CANARY-PIN-TEST safeguarding review Thursday at 14 Fenwi…"

**The mechanism, in both apps.** `pinPost` builds `JSON.stringify({ msgId, text: msg.text || '', by, ts })`
and publishes it with no sealing — console at `src/steward.src.js:6096`, member app at
`src/fellowship.src.js:4065`. `msg.text` is the DECRYPTED body, because the message list must hold it to
display it. So the one action a leader takes to say "this message matters" is the action that copies it out
from behind the encryption.

**Why this is worse than the other cleartext findings.** C8 leaked a service time; this leaks whatever a
leader thought was important enough to pin, from the room the church deliberately marked encrypted. The
room's own description promises "messages are sealed end-to-end; not even the relay can read them." After a
pin, the relay can read that one.

**Both roles can do it.** The console path is a steward's "Moderate -> Pin message"; the member path is
`app/screens-chat.jsx:1416` doPin. Neither seals.

**Fairly stated:** only the pinned message leaks, not the room. And `unpin` tombstones the document — but
a tombstone does not unsend what the relay already stored, and this relay keeps `.bak` and WAL copies.

**Hand test:** encrypted room, post something distinctive, pin it, then look for the text on the relay. One
minute, and it is unambiguous.

---

# SWEEP: are there more documents that copy data out of a sealed one?

C8 (serving request) and C13 (pin) share a shape — a publisher that takes a field from a sealed document or
from decrypted state and writes it in the clear. I enumerated every cleartext publisher in both engines to
see whether there are others. **40 in the console, 14 in the member app**, each inspected.

**No further leaks of that shape were found.** What the sweep did establish, so nobody re-treads it:

- **A child's published profile is EMPTY by design** — `const childProfile = {}` (`fellowship.src.js:4356`),
  with the name sealed separately to the church key and re-sealed to the congregation key when one arrives.
  The comment calls it "the instance that matters most: a CHILD's name in a world-shaped cleartext profile"
  and it is already fixed. Good.
- **The care signup note is benign** — its field asks "What are you bringing?" (`screens-today.jsx:144`).
  Cleartext, but it holds "lasagne", not anything personal.
- **The care SKIP reason is cleartext** (`fellowship.src.js:5256`). I could not find where the UI collects
  it, so I cannot say whether a member is ever prompted for something personal. **Open, low priority** —
  worth one look if anyone is in that code.
- **The safety-check message is cleartext** (`steward.src.js:4046`) — but it is a broadcast the whole church
  is meant to read ("Are you safe?"), and the note is explicit that members encrypt their REPLY to the
  signer, not to a content field. Correct as designed.
- **Reading plans, devotionals, sermon titles and fund names are cleartext.** Already recorded as a decision
  to take, not a bug.
- Everything else is structural — key rings, pubkey lists, room definitions, join policy — cleartext by
  design and documented in `SAFEGUARDING-BOUNDARY.md`.

**Bounded claim, stated as such:** I checked every `JSON.stringify` publisher in `src/steward.src.js` and
`src/fellowship.src.js`. I did not audit `src/steward-meals.src.js` or `src/steward-manna.src.js` to the same
depth, and I did not trace every field back to its source — a publisher that looks structural could still be
handed decrypted text by a caller, which is exactly how C13 hid.

---

# C10 IS WITHDRAWN — settled on the physical phone

I recorded C10 as "the tab bar stays VISIBLE but is covered and inert", from six agents ending their runs
behind full-screen panels. The code triage said HARNESS. **The phone agrees with the triage, and I was
wrong.**

Screenshot `shots/phone-search-panel.png`, Search panel open on the Oppo:

- The panel fills the screen. **The tab bar is not visible at all** — there is no dead navigation to aim at.
- The exit is a **back arrow in a white circle at the top left**, at a normal size, in the place a phone user
  looks for it. It is not the obscure sliver my write-up implied.
- Below the panel is only Android's own navigation bar.

**Where my version came from.** The driver's `see` returns `document.body.innerText`, which includes text
behind an opaque panel. So the tab labels appeared in its output, the agents kept aiming at them, and the
harness dutifully reported "COVERED … NOT tapable". I turned a harness artefact into a product finding and
then escalated it twice on the strength of more agents hitting the same artefact. Six agents agreeing is not
six pieces of evidence when they share one instrument.

**What actually survives, and it is small:** the back arrow carries no visible text, so its only name is
`aria-label="Back"`. That is a valid accessible name, so it is not even an accessibility defect — only a
question of whether an icon alone is enough. On the evidence of the screenshot, on a phone, it is.

**Nothing here is worth the owner's afternoon.** Struck from the list.

---

# C12 IS WITHDRAWN — settled by re-driving it and inspecting the button

The code triage said HARNESS. I re-ran it on the console and inspected the control rather than the outcome:

    dialog still open:   true          (it never closed)
    "Open this need":    disabled=true, opacity 0.5
    date input value:    "2026-09-18"  (set programmatically)
    date chips shown:    none

So the form behaved correctly throughout. Setting an `input[type=date]`'s `.value` from the driver does not
register the day into the component's state, the need therefore had **no days**, and `canSave` requires at
least one. The button was dimmed and my click did nothing. The form even says why, in its own words:
*"Pick the days first — a need with no days is one nobody can sign up to."*

The steward agent's *"the form appeared to not complete… unsure if the need was actually created"* was them
clicking a disabled button and not noticing it was disabled. **Not a defect. Struck.**

**Residual, tiny:** a dimmed primary button with the explanation elsewhere on the form was enough to confuse
a careful user for several minutes. Worth nothing more than a note.

**Second finding withdrawn today** (with C10). Both were mine, both came from the harness, and both were
caught by checking the control rather than trusting the outcome. Two of sixteen — worth knowing the rate.

## Staging note for the owner's manual pass
The existing meals need is **5/5, fully covered**, so there is no open slot for a child to sign up to. To
test C11 by hand: open a NEW care need from the console (clicking the day chips as a human, which works),
then on a child's phone go Today → Care → the need → "I'll help". The relay gate that permits it is
`gateway.mjs:2453`.

