# Scope: which key locks a check-in record — sealing, audiences, and the issuer

Written 2026-09-10, against `a53356e` (`feat/checkin-granting-screen`).

**What has and has not been on a phone.** Slice 2's *granting screen* was driven on the Oppo on 2026-09-10:
a church created through the wizard, a real member joined and admitted, cleared for one day, the clearance
document confirmed on the relay (church-signed, `d=checkinperm:<personPub>`, cleartext, no key, window
00:00:00-23:59:59 local), then withdrawn in two taps. **Nothing in THIS document has been on a phone** — the
sealing change does not exist yet. Note that `SCOPE-CHECKIN-SURFACES-2026-09-09.md` still says slice 2 was
"never on a phone"; that line is stale as of the run above.
Grounded in the independent audit of 2026-09-10, which ran a real gateway and lifted the shipped sealer out
of `vendor/steward.js` rather than reading it. Every "measured" below was executed; anything reasoned but
not executed is marked UNVERIFIED.

This closes the question `SCOPE-CHECKIN-SURFACES-2026-09-09.md` parked as *"slice 3's first decision, and it
is a design decision, not a wiring one."* It is not a bug fix. The current sealing predates the helper
feature — it came from the August finance/check-in capability split — and was never wrong, only insufficient
once a non-steward was allowed to work the door.

## The decision the owner took — 2026-09-10

**Double-lock each record.** One copy readable by the church's safeguarding ring, one by the person actually
working that session. The owner accepted this after being told the consequence in full: every record stays
readable by the safeguarding ring for ever, which is already true today, and that forecloses "the key
expires" as a retention mechanism.

The trade the owner refused earlier (`src/steward.src.js:~6609` — a person-scoped document wrapping a
long-lived register key) is NOT re-taken by this. A lost helper phone still exposes only the sessions that
phone held keys for. The safeguarding copy widens the audience by nobody, because that ring already seals
every record.

## What is true today — all measured

- A record is sealed by `encSeal('checkin', …)` → `_capState['checkin'].ring[0]`. `CAP_KEYS.checkin` is
  `{ d:'trinityone/checkinkey:', cap:'safeguarding', legacy:false, explicit:true }` (`src/steward.src.js:391`).
- The session key is **unrelated** to it: `src/steward.src.js:6939` is fresh
  `crypto.getRandomValues(new Uint8Array(32))` per session, reused only from a recovered envelope. The record
  decrypts with the ring key and **throws** with the session key.
- So a cleared helper holding a valid envelope is served ciphertext and holds the wrong key. `helperKeyFor`
  returns the session key; that key opens nothing in the register.
- A clearance can only ever narrow. `checkinPermitted` is reached only after envelope membership
  (`scripts/gateway.mjs:1564`, `:3716`). Proved on a live relay: a cleared person absent from every envelope
  was refused every read and write, and her write was not stored. The one thing a clearance alone opens is
  her own clearance record.
- Nothing mints envelopes. `issueCheckinSessionKeys` has no product caller, and neither does
  `subscribeCheckinSessionKeys` — so the issuer has no settled source for its `existing` argument.
- `publishCheckin` returns `null` and **publishes nothing** when the ring is empty. A console whose
  `checkinkey:` envelope has not arrived silently fails to write a check-in.

## ⚠ THE OBVIOUS FIX IS THE ONE THAT BREAKS EVERY CONSOLE — READ BEFORE WRITING A LINE

Reshaping `content` into a two-ciphertext envelope (`{"v":2,"ct":{…}}`) was built and run by the audit:

- the shipped `encOpen` returns `null` — it only ever tries `nip44d` on the whole string;
- `encSubscribe` therefore parks it in the 2000-entry holding pen and **emits `[]`**;
- **every console on the current bundle renders an empty register, with no error;**
- a mixed corpus half-renders: old records show, new ones vanish.

That is the silent-blank-app class, on safeguarding data, during a staged rollout. It also breaks
add-never-repurpose (the relay rehydrates all history on every update).

**`content` does not change. The second copy is ADDITIVE.**

### The additive shape is MEASURED, not reasoned — 2026-09-10

The proposed shape (`content` unchanged + `['ck', <nip44 under the session key>]` + `['gk', <nip44 to the
guardian's pubkey>]` + `['enc','2']`) was built and run against real gateway processes with real signed
events, with a control record in today's shape alongside every additive record so no result is vacuous:

| path | result |
|---|---|
| relay `accept()` | admitted, same as the control |
| relay `canRead()` | served to all four audiences: church, in-window helper, `p`-tagged guardian, safeguarding steward |
| `store.put` → query → delivery | `ck` tag byte-identical; event id unchanged; `verifyEvent` still passes |
| both copies | ring copy opens with the ring; `ck` copy opens with the session key |
| `/export` → `/import` onto a second fresh relay | tag survives, sig valid, still served, `ck` still decrypts |
| relay restart (full rehydrate through `note()`) | unchanged — `note()` has no `CHECKIN_D` branch, both shapes no-ops |
| **the CURRENT bundle's `encSubscribe`** | renders the additive record **`deepEqual` to the control** |

Why it works, rather than working by luck:

- **The relay never reads the `enc` tag at all** — `'enc'` does not appear in `scripts/gateway.mjs` or
  `scripts/event-store.mjs`. So `['enc','2']` carries no relay-side risk in either direction.
- **There is no tag whitelist and no unknown-tag rejection** in either file; `store.put` persists
  `JSON.stringify(e)` whole.
- The only exact `enc === '1'` test in the codebase is `src/steward.src.js:4573`, over `kinds:[1]` group
  messages — **not** a check-in path.
- The tag is inside the event id, so **a relay cannot strip it undetected** — `verifyEvent` fails if it does.
  State that as a property being relied on.

Still unbuilt: the **reader** half. The writer shape is proved compatible and the relay serves it; that a
helper or guardian client can actually open it end to end is not yet proved.

## SIM ROUND — a parent persona, 2026-09-10

Run because piece 2 (the guardian's copy) is approved-but-not-essential, and the question worth answering
first was whether the app is **honest** to a parent while it shows them nothing.

**Verdict: it is honest, and the absence is not confusing.** A parent persona set itself up, joined a church,
and hunted deliberately — home, community, chat, groups, calendar, events, people, notifications, profile,
settings. It found **no** check-in information anywhere, and critically **no dead ends**: no menu item leading
nowhere, no empty "No check-ins today" state, no heading with nothing under it, and nothing implying check-in
should be there. The app simply never raises the subject. That is the intended behaviour today and it holds
up under a determined look.

**The design signal worth keeping for piece 2:** asked where a parent would look first, the persona named
**You & settings → MY FAMILY → Children's accounts** — which already exists for linking a child to a parent
and says *"No children linked to you yet"*. If a parent-facing view is ever built, that is where a parent
already goes for anything to do with their child. Not the reader, not the community area.

**One thing it flagged that is NOT a finding**, checked afterwards: it saw *"2 events you can't open yet. Your
church's key hasn't reached this phone. They'll appear once it does — nothing is missing."* That message is
**true** — calendar events are sealed with the church's name key, which is re-issued to include a member when
they are admitted (`app/screens-serving.jsx`, the `_locked` banner; `src/fellowship.src.js`, the re-open pass
that retries buffered ciphertext when the key lands). The banner itself exists because locked entries used to
fall through as ordinary events with `NaN` dates and working RSVP buttons — a simulated member once RSVP'd to
one: *"I'm now going to something and I don't know what."* The sim's church had no console open to re-issue,
which is an abandoned-church artefact, not a defect.

## SIM ROUND — a churchwarden setting up check-in, 2026-09-10. Fourteen findings.

Driven through the real UI on the merged tree. Credentials recorded: church **St Chad's, Falgate**, console
PIN `falgate-warden-2026`, phrase *among runway educate erupt must bulb begin moment keep mixed lion stamp*;
member **Maureen Dacre**, PIN `maureen-parish-24`, phrase *satisfy intact raise siren tennis camp peanut
admit inhale demise orbit quit*.

**What worked:** the 7-step wizard, the join queue, Kids check-in appearing in the nav instantly, all three
durations saving and labelling consistently, a clearance surviving a console reload plus PIN unlock, no
double-clearing into two rows, and **zero text-on-text collisions at 1440px** (the overlap is narrow-width
only).

### ⚠ THREE COUPLED DEFECTS, all confirmed in code afterwards, all in piece 3's panel

**S1 — a "just that day" clearance for any FUTURE date reads as already ENDED, and no key is issued.**
This is the most likely thing a warden does: *"clear Maureen for next Sunday."* Reproduced four times — Sep
11, 13 and 20 all render **"Ended <date>"**; today renders correctly. Two separate causes:

- **The label has no future state.** `app/stew-dashboard.jsx:5681` is
  `{r.live ? runsTo(r) : 'Ended ' + fmtD(r.until)}` — binary. A window entirely in the future is not `live`,
  so it falls to the else branch and claims it ended.
- **The re-issue trigger ignores future-dated clearances.** `CheckinSessionKeys`' effect depends on
  `clearedNow.join(',')`, and `clearedNow` filters to permissions active **now**. Granting or withdrawing a
  future-dated clearance therefore changes no dependency and the effect never fires. **The issuer itself is
  correct** — it asks `permittedHelpers(perms, win.from)`, the session's own start — so the key *would* be
  wrapped correctly if anything triggered it. Only reopening the page or pressing Re-issue recovers.

**S2 — withdrawing a clearance leaves the panel claiming a helper still holds the key, indefinitely.**
The clearance list goes to "Nobody is cleared yet" while the panel stays at "1 helper holds this session's
key" for 30+ seconds and through re-polling. Same root cause as S1's second half. This contradicts two pieces
of shipped copy: *"withdrawing one ends their access to every session at once"* and *"This console issues
them … whenever a clearance changes."* **Whether the published envelope still wraps the withdrawn helper, or
only the label is stale, is not visible from the console** — and the panel is all a warden has.

**S3 — the summary line reads as a contradiction.** *"Issued keys for 1 session(s) · 0 person(s) cleared
right now"* appeared directly beneath *"1 helper holds this session's key"*, because "right now" means today
and the clearance was for Sunday.

### Other findings, worst first

**S4 — "That date is too far ahead … so this one was not saved" is shown for dates in the PAST**, and claims
a save failed when nothing was submitted (the button is disabled). Reproduced on 2026-08-01 and 2026-09-09.
One message doing duty for two opposite conditions.

**S5 — "Just that day" has NO date validation** while "Until a date" enforces a 400-day cap. `2019-05-05`
saved happily and became a stored row reading **"Ended May 5, 2019"**. A mistyped year yields something that
looks like a clearance and grants nothing, silently.

**S6 — Check-in says "Add them to the calendar and a key follows." Adding them to the calendar does nothing.**
Only a **Rota** service counts. The wizard had already created "Sunday Service" on the 13th; following the
copy as written produced a **duplicate** ("Sunday Gathering" *and* "Sunday Service" on one day). The Rota and
Calendar empty states are both correct; only Check-in points at the wrong place.

**S7 — after the wizard finishes, the console shows an EMPTY church until you reload.** Groups **0**, *"No
groups yet"*, Rota offering *"Build your first team"*, and the groups cache reading `[]` — then **Groups 4**
after a reload. Nothing was lost, but a warden trusting the screen creates it all again. The Overview header
also still read "Your Church" until another tab was visited.

**S8 — TWO differently-named clearances for children's work, neither mentioning the other.** Members has
**"Clear for youth"** (child↔adult DMs, receiving a young person's request for help); Check-in has **"Clear
someone"** for the register. Wholly independent — clearing for check-in left the Members pill un-set, and
setting it changed nothing on Check-in. **A warden who has done one will believe they have done the other**,
in either direction. Arguably the most dangerous finding in the round.

**S9 — you cannot edit or extend an active clearance**, and the dialog's message for it is **"Nobody left to
clear."** — which in a one-member church reads as "there is nobody here". The only route is Withdraw → clear
again, and nothing says so.

**S10 — "Invite code" opens a dialog with no code in it.** It says *"Show this on screen or print it"* and
then shows only a reachability nag; the code appears only after pressing **"I'll do this later"**, which
reads like postponing the invitation. The nag also names two routes that do not match the menu.

**S11 — the page's primary button, "Check a child in", is disabled with `cursor: pointer` and no tooltip.**
It invites the click and gives nothing back.

**S12 — Re-issue gives no feedback when there is nothing to change.** The one button a warden presses on
purpose is the one occasion with no confirmation.

**S13 — the Members row's toggles have no readable state.** "Child" and "Clear for youth" are plain buttons
with no `aria-pressed`/`aria-checked`, styled identically to the non-toggle pills beside them.

**S14 — measured character counts for the copy cull** (owner's instruction): Check-in "door operation"
**560 chars**; the clearance explainer **~360**; the session-keys explainer **~360**, with the operationally
vital sentence buried mid-paragraph; the Members safeguarding block **~600**; the wizard's console-PIN step
three paragraphs before one field. Places the sim actively wanted a tooltip and found none: the disabled
primary button, the three duration cards (each already has a one-line subtitle — the paragraph above them is
redundant), "Clear for youth" vs "Clear someone", and the "Which day" field, which cannot say which Sundays
have sessions.

### Not tested this round
**Actually checking a child in** — it needs a member marked Child with a confirmed guardian, and marking the
only member a child would have destroyed the clearance state S1-S5 depend on. So the register, the pickup
code and the checkout match are untested from the UI. Also untested: whether a withdrawn helper's wrap really
remains in the published envelope.

### Instrument notes, declared by the sim
`<input type="date">` would not take keystrokes (Chrome segment focus), so dates were set with the React
value setter and every save was then pressed with a real click — only the typing is synthetic.
`sim-join.mjs` reported `ok:false` because its PIN step did not fire; harness, not product. And **one
near-false finding caught**: a screenshot cut off at the viewport bottom plus a selector matching an inner
header-only div made it look as though Re-issue wiped the session list; full `innerText` showed it intact
throughout.

## 🛑 MERGE BLOCKER — red-team pass, 2026-09-10. Piece 1 must NOT merge as it stands.

A red-team pass (brief: break it, do not review it) found nine issues, three HIGH, all executed against a
real gateway with real AUTH and real signed events, each with a passing baseline in the same run. **One is a
child-safety defect that piece 1 activates.**

### F1 — HIGH. A cleared helper can rewrite ANY record in the register, in any session, on any date

`accept()`'s `CHECKIN_D` branch (`scripts/gateway.mjs`, the helper clause) binds a helper's write to a
`['session']` tag **the writer chooses**, and never to the record the d-tag addresses:

```js
const sid = (e.tags.find(t => t[0] === 'session') || [])[1] || '';
return !!sid && checkinHelperOf(e.pubkey, cp, sid);
```

The comment above it claims the branch refuses "a session OTHER than the one they hold". It does — for the
tag the writer attached. **It never asks which session the record at that address belongs to.**

Measured: a helper cleared and in-window for session S1 only is correctly **refused every read** of a
session-S2 record, and is nonetheless **accepted publishing at that S2 record's own address** with
`['session', S1]` on the event.

**Piece 1 is what makes it bite.** Before the `ck` tag, a helper held no ring key, so a forged `content` was
garbage: `encOpen` returned null and `encSubscribe` parked the row in the holding pen for ever — inert. Piece
1 adds the second door: the forger supplies her *own* `['ck', …]` sealed under the key she holds and tags the
event S1, and `_encOpenSealedCopy` looks the key up **by the tag she wrote**. `byId` keys on the d-tag suffix
and `take()` is newest-wins, so her body **replaces the church's row**. Measured against the shipped
`encSubscribe`/`encOpen`/`_encOpenSealedCopy` lifted from `vendor/steward.js` with real nip44:

```
BASELINE, the church's own records:     [ r1:Real r1/4821, r2:Real r2/4821 ]
helper rewrites r1 (her own session):   [ r1:Real r1/0000/OUT=A. Stranger, r2:Real r2/4821 ]
…and r2 (session S2, tagged S1):        [ r1:…/0000/OUT=A. Stranger, r2:Real r2/0000/OUT=A. Stranger ]
```

**What it costs.** `rec.code` is the pickup code, and `CheckoutModal` releases a child on
`code.trim() === String(rec.code)`. So a volunteer cleared for one Sunday morning can set **any child's
pickup code to a value of their choosing, on any record from any date**, and can write or clear `out`
("collected by…"). The register renders one row per address with **no author**, so there is nothing on screen
to notice.

**This falsifies reasoning written into this very document.** The "NOT scoped here" section said *"none is
caused by this work… the only writers today are the church key and safeguarding stewards, both via the
console, and no piece adds a writer."* The relay has admitted in-window helpers as writers since 2026-09-09;
its own comment says so. Piece 1 did not add a writer — it added a **reader for what that writer produces**,
which is what turns a parked blob into a rendered row.

**The fix shape:** a helper may CREATE a record in their own session, but may only UPDATE an existing record
whose own `session` tag matches theirs — i.e. the gate must read the event already stored at that `replKey`
and compare, rather than trusting the incoming tag alone. Consider also showing the author in the register,
and preferring church-authored versions in `byId`, as defence in depth.

### F2 — HIGH. `/sync` hands a Finance-only steward `minors:` and `guardians:` in cleartext

`_exportAuth` is owner-only, and the reason is written on it: *"It was reachable by any steward holding any
one capability, so a content-scoped rota helper could take the lot, including minors: and guardians:."*
`_syncAuth` still ends `|| stewardCan(ev.pubkey, cp, 'any')`, and `/sync?church=<cp>&since=0` streams the
whole corpus. Measured: `/export` → **401** for a Finance-only steward, `/sync` → **200 with 4 events**,
`minors:` and `guardians:` both in the stream in cleartext. Control: an ordinary member → 401. The same gate
fronts `/sync-digest`, `/sync-ids`, `/sync-events`, `/sync-media`, `/sync-blob`. **Pre-existing and not
caused by either piece** — the same leak that was closed on one route and left open on its neighbour.

### F3 — HIGH/MEDIUM. A withdrawn clearance comes back when the steward who withdrew it is de-capped

`CHECKIN_PERMITS` stores no author, so authorisation is evaluated at **ingest** and `hydrateMaps()` wipes and
replays. Measured across a restart on the same DB: cleared → withdrawn (0) → steward de-capped, still 0 →
**restart → cleared again (1)**, session key returned, register served, writes accepted. The console agrees
**immediately, without a restart**: `subscribeCheckinPermissions` skips versions whose author fails
`mayAuthor`, so the de-capped steward's tombstone is dropped and the church's older grant wins. So a
safeguarding lead moving on or being re-scoped quietly reinstates every clearance they ever withdrew.
`note()` went to real trouble to make the withdrawal order-independent; its **authorisation** is not.

### F4 — MEDIUM (the mirror of F3)
A clearance *granted* by a steward keeps admitting after that steward is de-capped, with no restart needed,
and then evaporates at the next restart — so the unsafe direction is live immediately and the availability
failure lands later, as a volunteer refused at the desk while the console still lists them as cleared.
`grantorOk`'s own comment states the rule this breaks.

### F5 — MEDIUM. A +899 s clearance makes the church's withdrawal accepted and NOT enforced
The 900 s skew race was accepted for the single-author case, where the store returns `have-newer` and the
refusal is visible. Since the two-author widening the store cannot refuse, and `CHECKIN_PERMITS` is keyed by
**person**, comparing `held.ts` across authors. Measured: the steward's +899 s clearance is accepted; the
church's honest withdrawal is **accepted at the door and silently dropped**; the steward's own withdrawal is
**refused at the door**. **Neither author can withdraw.** The window is bounded at 900 s; the consequence is
not — nothing retries.

### F6 — MEDIUM. The `ck` copy is a second lock `rotateCapKey` cannot reach
`rotateCapKey` is how the register is taken away from a de-capped steward, and it rotates `checkinkey:` only.
Session keys are deliberately never rotated (reuse is a stated guarantee) and every steward is still served
every record. Measured: with the ring emptied and only a session key held, a record written **after** the
rotation still opens via `ck`.

### F7-F9 — LOW
The relay accepts a helper's hand-crafted tombstone at any check-in address (only the client refuses it, so
it is a defence-in-depth gap that goes live the moment any client honours a non-steward tombstone); the
row-identity fork is reachable through the new reader (a `ck` body whose `id` names another address produces
a row that `writeCheckin` would publish to the wrong place); and `/import`'s comment claims "or a steward of
an already-known church", which `_exportAuth` being owner-only makes false.

### A privacy inference nobody has written down

A Finance-only steward — and a **care admin**, who is on no steward roster at all — is served every
check-in record's ciphertext plus its cleartext tags, every `checkinhelper:` envelope (whose `pubs` names the
cleared children's-work team) and every `checkinperm:`. They cannot open a record, verified. But from the
cleartext alone they can derive **which sessions ran, how many children were at each, and one guardian
pubkey per record** — i.e. *"this family had a child at church on this date"*, per record, for the whole
history. The code acknowledges the audience; **this inference is written down nowhere.**

### What held — executed, with baselines

Cross-session reads both ways (0 for the other session's records and envelope); cross-church on one box with
a deliberately reused session id (keying by author does its job); **both doors agree** on six documents
refused at the websocket and pushed through `/import` with the church key (uppercase-hex d-tag, a `..` sid, a
300-char sid, a steward-minted envelope, a clearance naming someone else, an envelope naming another
session) — none installed, none after a rehydrate; a closed session's envelope refused to its helper and
still readable by the church; `+1200 s` refused by the store and `+899 s` buying nothing on the read side; an
ordinary member 0 for everything and unable to mint either document; the helper unable to mint either; the
safeguarding steward unable to mint an envelope; guardian scoping correct (own `p`-tagged record only, no
`gk`, neither key); the Finance steward unable to open ciphertext with the ring key as a control; and the
envelope's keeper set computed as the church plus exactly the capability holders who already hold the ring.

### Not tested
Nothing on a device. The full suite was not run against this tree. The guardian `gk` path does not exist, so
"a guardian of another family opens nothing" is untestable rather than proved. The transitive `guardianOfIn`
branch was not exercised. The negentropy import walk (`/sync-digest` → `/sync-ids` → `/sync-events`) shares
`note()` with `/import` so the same answers are expected, but it was **not** executed — "could not", not
"impossible".

## OPEN AFTER THE AUTHORISATION FIX (`2fe8a74`) — two items for the owner's judgement

The F3/F4/F5 fix landed with one model: **a version is remembered with its author; a clearance answers for
its author's authority at USE time; a withdrawal counts for ever from the moment a door admitted it and is
never re-litigated.** The asymmetry is deliberate — a clearance widens access to a children's register, a
withdrawal can only refuse. Requiring continuing authority for a withdrawal is exactly how de-capping a
safeguarding lead re-granted every clearance she had withdrawn.

**Device-verified 2026-09-10 on the Oppo**, on the four-fix merge: withdrawal takes effect in place, and
**survives a relay restart on the same database** — the relay holds one empty version and the console still
reads "Nobody is cleared yet" after the rehydrate. That is the axis F3 lived on.

Two things it could not close, both stated in the code and the commit:

1. **A 120-second clock-skew residue.** Down from 900 s. Inside that window a stale clearance from a fast
   device can still outrank a withdrawal. It cannot be closed by making a withdrawal beat any later-stamped
   clearance, because that also blocks the cross-author **re-grant** that
   `checkin-permission-mint-widening.test.mjs` requires to work. It needs two disagreeing clocks acting
   within the same two minutes; the other author's withdrawal always lands at the door now; and any later act
   settles it. **Accept, or reopen with a different mechanism.**
2. **The console cannot distinguish a removed safeguarding lead from a co-tenant** — from the console's
   position both are simply a pubkey with no capability. The **relay closes both cases** and is asserted
   doing so, so the enforcement is right; it is the console's *display* that cannot tell the two apart.
   Relevant because a row vanishing while the relay still enforces would make a steward believe a withdrawal
   worked when it did nothing — which is why the console deliberately believes the church key and anyone the
   roster records a capability for, capability ignored.

## OWNER DECISIONS — 2026-09-10 (third round)

- **Piece 2 (the guardian's copy): BUILD IT WITH SLICE 3, not before and not "when the pilot says".**
  ⚠ **This corrects an answer I gave the owner and then had to withdraw.** I told him there was "no surface
  yet", and he pushed back: *"we will have a member app surface for parents and safeguarding approved people
  though right?"* He is right and I was wrong. `SCOPE-CHECKIN-SURFACES-2026-09-09.md` **Slice 3 — the room
  and the register (member app)** says in terms: *"a QR on the room door, **a parent checking their own child
  in**, and the worker's live list"*, and *"first use of a session key by a reader"*.

  So piece 2 is not a lock for a door nobody is building — it is the lock for the **next** door, exactly as
  piece 1 was the lock for slice 3's worker view. A parent who can check their own child in will need to see
  the result, the pickup code at minimum, so a parent-readable record is implied by slice 3 rather than
  speculative.

  **Corrected sequencing:** do not build piece 2 standalone, and do not defer it to the pilot. It belongs in
  slice 3, designed with the parent flow it serves, so the audience and the surface are decided together.
  The caveat still stands and now matters more: a record's audiences are fixed **when it is sealed**, so
  records written before the parent copy exists are not parent-readable afterwards — recoverable via the
  `migrateCheckinKeys` re-key mechanism, but better not needed.

  ⚠ **Slice 3 needs TWO phones for device verification** — its own scope says so: *"needs two phones — a
  parent's and a worker's. A simulation of two people is not evidence for this one."* Only one device (the
  Oppo) is attached to this box today. That is a real gate on slice 3, not a detail.
- **Desktop per-card scrolling: live with it for now.** The register scrolls with the page rather than inside
  its own card.
- **Bible slice 2 comes after the check-in queue.**
- **Making commentaries and dictionaries uninstallable: after the check-in work wraps up.**
- **Pushing, and the console help articles appearing in the member app's help index: both can wait.**

## OWNER DECISIONS — 2026-09-10 (second round)

**A. Piece 2 (the guardian's copy): APPROVED, but NOT ESSENTIAL.** Owner: *"yes that can, but it's not
essential imo."* So parents may read their own child's record, cached like any other document — the member
app already persists check-in ciphertext at rest and this makes a parent's own child's record readable on the
parent's own phone. **Build it, but it ranks below the module-update fix and anything the owner asks for
next.** Carry forward the known consequence: a guardian is never served a tombstone, so once a parent can
read a record their screen can show a child as present with nothing that will ever say otherwise.

**B. Delegated stewards SHOULD be able to mint session keys.** Owner: *"yes, I think a delegated steward
should be able to mint keys."*

⚠ **This is NOT a flag flip, and it is not blocked by cryptography.** Measured 2026-09-10:

- `buildHelperGrant` takes `wrap` as a **parameter** (`scripts/checkin-role-source.mjs:1`), so it does not
  hardcode the church key. A delegate can wrap to each recipient, and the church's own slot would still
  unwrap, because the ingest keys off the envelope's **author** (`nip44ck(sk, e.pubkey)`) after the
  delegated-mode fix in piece 1. So the crypto permits it.
- **The relay refuses it.** `scripts/gateway.mjs:2585` gates the envelope on `CHURCH_PUBS.has(e.pubkey)` —
  the author must BE the church — and `note()` enforces the same. The client gate
  (`_ckIssuerHeld = !!sk && churchSkHeld() && !actingChurch`, `src/steward.src.js:755`) is the second lock.

So this change **widens a relay write gate on the document that hands out register keys.** That is a
security-boundary change and needs its own scope and its own audit, with **both doors** changed together —
`accept()` and `note()` have disagreed before and that is how a rule gets enforced on the websocket and
bypassed through `/import`. It should almost certainly be gated on the **safeguarding capability**, not on
"any delegate". Do not fold it into a feature commit.

**C. A broader review of delegate permission settings is wanted.** Owner: *"we may have to later look at
permissions relating settings for delegates, note that down."* Recorded. B is one instance of it; the general
question is which settings a delegated steward may change and which stay with the church key. Not scoped.

**D. DO NOT PUSH.** Owner: *"hold on pushing, I want to look over the work more closely when I'm back at my
desk."* `main` has 11 unpushed commits and five branches sit on top of it. Nothing is deployed. Both of
today's branches are built, audited and device-verified as far as the hardware allows — they are waiting on
the owner's own review, not on more work.

## STATUS — 2026-09-10

**Branch `feat/checkin-sealing`. Pieces 3 and 1 are BUILT, AUDITED and CLOSED. Piece 2 is blocked on an
owner decision. Nothing has been on a device except piece 3's screen.**

| piece | commit | audited | device |
|---|---|---|---|
| 3 — the issuer | `b4b1754` (was `a02dff7` → `522269f` → `3c14ebd`) | closed, after one real defect | **YES**, Oppo, 2026-09-10 |
| 1 — the helper's copy | `95afe22` | closed, after two findings | no — blocked on disk |
| 2 — the guardian's copy | not started | — | — |

**Piece 3, device-verified on the Oppo.** A service three days out was picked up and minted; **Re-issue
published nothing at all** (same event id, same `created_at`) so it reused the key rather than rotating it,
which is the guarantee the piece exists for; clearing somebody open-ended re-issued the envelope with them
wrapped in (two key slots, `pubs` naming them); and a person whose clearance did **not** cover the service
window was correctly excluded. Two copy defects were found only on the device and fixed.

**Piece 1's audit found the code right and the tests blind in one place** — a reader-side regression of the
cross-session leak would have shipped green, because every fixture filed its key under the record's own
session and the one negative called the parser directly. Now guarded by a fixture holding **the right key
under the wrong session id**, asserted through `registerFrom`, re-anchored four ways so an empty register
cannot pass for the wrong reason. Sabotage reddens that test alone.

**Two claims deliberately NOT made:**

- **"The double lock closes" would over-reach.** What is proved is the *sealing contract* end to end through
  a real relay, plus a console-side reader. **No helper client exists** — there is no member-app check-in
  surface and `publishCheckin` is reachable only from the console — so "a cleared helper opens a record
  **they wrote**" is unbuildable until slice 3 of the surfaces work. The reader's product caller today is the
  console's own `encSubscribe`, for a delegated safeguarding steward holding a session key from a keeper slot
  whose `checkinkey:` envelope has not arrived. That is a real, durable state, and it closes the piece-3
  audit's note that keeper slots were "written and never read by any code path".
- **No suite total is in either commit message.** A measured +19 cannot reconcile the numbers seen on a
  contended box, so the delta is stated with its per-file basis and the totals are marked unverified. Rule 8
  is satisfied by the honest gap, not by a confident wrong figure.

**Still open from the piece-3 audit:** the multi-relay partial-corpus stamp (`_isRelayAuthed()` is true if
*any* relay is authed, and the pool's `oneose` fires on EOSE **or close**), reasoned and recorded in a
comment, never executed. Unchanged by piece 1.

## What gets built, in this order — 3, THEN 1, THEN 2

**The order was 1→2→3 in the first draft and that order is not buildable.** To write a helper's copy,
`publishCheckin` must hold that session's key. The session key exists in exactly one place — inside a
`checkinhelper:` envelope — and nothing mints one and nothing reads one. So piece 1 built first has three
options and all are bad: omit the copy (ships nothing, for every church, until the issuer lands); invent a
key (write-only garbage); or mint an envelope inside `publishCheckin` (that is piece 3, in the wrong place).
Piece 1's own acceptance test — *a cleared helper opens a record they wrote* — is **unsatisfiable** until the
issuer exists, and can only be made to pass by minting an envelope inside the test, which is exactly the
"the test drove something that was not the shipped path" failure `DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md`
§6 names.

Piece 2 is genuinely order-independent — it seals to a guardian's *pubkey* and needs no envelope — so it may
go first if an early win is wanted.

### Piece 3 (FIRST) — wire the issuer

- **Gate on EOSE.** `issueCheckinSessionKeys` recovers a session's existing key from `o.existing`
  (`src/steward.src.js:7070`). An effect firing before `subscribeCheckinSessionKeys` settles passes an empty
  `existing`, so `keyHex` is `''` and `publishCheckinHelpers` **mints a fresh key**, rotating the session and
  orphaning everything already sealed under it. This race does not exist yet; wiring it naively creates it.
- `subscribeCheckinSessionKeys` **has no product caller** — `app/steward-root.jsx` wires only
  `subscribeCheckins` (`:202`) and `subscribeCheckinPermissions` (`:207`). The subscription is part of this
  piece, not a given.
- Trigger on owner-console open (after EOSE) and on any clearance change; plus a manual **re-issue** control
  on the Check-in page.
- **Say the real constraint on screen.** Not "a console must open" — `issueCheckinSessionKeys` requires
  `churchSkHeld() && !actingChurch`, and the effect it copies also requires a published `church.name`. A
  church where only delegated stewards ever open a console gets **no session keys, ever**. State it; do not
  design around it silently. Whether delegates should mint is the owner's call.
- ⚠ **`_warnCheckinKeeperLeftOut` must be DELETED or RE-AIMED, not "made true".** The first draft of this
  scope said piece 1 makes the warning true and that safeguarding holders must be wrapped into every envelope
  or lose access. **That is backwards.** Under double-locking the ring reads every record via `content`, which
  piece 1 leaves untouched, so a safeguarding holder omitted from an envelope loses only a duplicate of a body
  they can already read — **no access at all.** Its text ("they should be able to read what a helper writes,
  and cannot") becomes a **false claim in shipped UI copy**, which is rule 4's territory. The one thing a
  keeper slot really buys is the **church's own** slot, which is what lets the issuer recover and reuse a
  session key instead of rotating it (`:7070`). Re-aim it at that, or drop it.

### Piece 1 (SECOND) — the helper's copy, as an added signed field

- `content` stays exactly what it is: the safeguarding-ring ciphertext. Untouched.
- Add the session-key copy as a new signed tag, `['ck', <nip44 under the session key>]`, and bump the marker
  to `['enc','2']` following the `['enc','care1']` precedent (`src/fellowship.src.js:5126`). The marker does
  **not** rescue old readers — only leaving `content` alone does that.
- ⚠ **NEVER RETURN NULL.** `publishCheckin` already returns `null` and publishes nothing when the ring is
  empty. Do not add a second such path: when no session key is available, publish the ring copy and simply
  **omit** `ck`. Design §10 — nothing may block a check-in.
- **The reader side is part of this piece.** `helperKeyFor` (`scripts/checkin-role-source.mjs:746`) **has no
  product caller anywhere** in `src/` or `app/` — its only in-repo caller is a test
  (`checkin-role-source.test.mjs:270-292`). Piece 1 must name and build the whole chain: fetch the envelope →
  `readHelperGrant` → `helperKeyFor` → open the `ck` tag. Without it this piece adds a ciphertext nothing reads.
- Keep passing the same plaintext `obj` to `encPublish`, because `_encCleartextTags`
  (`src/steward.src.js:538-561`) derives `['session']` and one `['p']` per guardian **from the plaintext**, and
  the relay's read gate keys on both with no fall-through. Keep `session`/`guardians` in the sealed body too —
  `migrateCheckinKeys` re-derives them from there.
- ⚠ **`migrateCheckinKeys` is a second writer** (`src/steward.src.js:7128`), fired **automatically on a
  1200 ms timer** from `app/stew-dashboard.jsx:1383` — not on a user action — and it re-publishes through the
  same `encPublish`. If it does not learn to emit `ck`/`gk` it will **silently strip them off every record it
  re-keys**: the register stays visible to the church and quietly stops being readable by the helper and the
  parent, with nothing on screen to look at.
- ⚠ **Read before touching the writer: the row identity fork.** `encSubscribe` does
  `byId.set(id, { id, ...obj, ts })` (`src/steward.src.js:6216`), so `obj.id` from the sealed body wins over
  the d-tag suffix, and `app/stew-dashboard.jsx:6027` does `writeCheckin({ ...r, out })` — re-publishing a
  decrypted row. A body whose `id` disagrees with its address **forks the record**: a child showing as both
  present and collected. Piece 1 edits the function where `rec.id` is set and is one line from making this
  live.
- Measured headroom: a frame carrying both copies is **1,386 B** (measured on a *constructed* frame, i.e.
  arithmetic on real ciphertext lengths, not a shipped writer's output) against a 1 MB `maxPayload`
  (`scripts/gateway.mjs:6072`); a fat record (2 KB note, 8 guardians) is 8,376 B. No tag-count or tag-size
  limit exists in `gateway.mjs` or `event-store.mjs`. `MAX_EVENTS` is a count budget and kind-30078 are
  cull-exempt. **But see the client-side cap below — that is the real limit.**

### Piece 2 (THIRD, or first if preferred) — the third audience, the guardian

Measured: a `p`-tagged guardian **is already served** her child's record (`scripts/gateway.mjs:3739-3743`) and
holds **neither** key. Shipping without this leaves the parent side of slice 3 in exactly the state the
previous scope doc warns about — *"'refused' and 'served but unreadable' are different failures and look
nothing like each other from a phone."*

- Add one wrapped copy per `p` tag, NIP-44 to that guardian's pubkey (`['gk', …]`).
- ⚠ **Decision required before this ships.** The member app persists check-in ciphertext at rest
  (`src/fellowship.src.js:1988-1999`) on any phone the relay serves a record to, and `_slimEvt` preserves tags
  wholesale (`src/fellowship.src.js:1608`, `tags: e.tags`) — which is what makes a member-app reader possible
  at all, and also means the wrapped copies land in `localStorage`. A guardian-readable copy turns inert blobs
  into readable safeguarding records cached in phone storage. A choice, not a side effect.
- ⚠ **This piece creates a reader with no retraction path.** Proved on a live relay: a guardian is served the
  record and is **never** served a tombstone, and a helper's tombstone is refused outright (`accept()`'s
  `CHECKIN_D` branch needs a `['session']` tag and `encRemove` emits none). Harmless today because a guardian
  can read nothing. **Piece 2 is the change that makes a guardian a reader**, so from that moment a parent's
  screen can show a child as present with no mechanism that will ever tell it otherwise. Slice 3 inherits this.

## ⚠ The client-side cap — the real size limit, and a NEW finding

`src/fellowship.src.js:1604` caps the persisted docs hub at **3 MB**, and on overflow `:1996` does
`localStorage.removeItem(key)` — it **discards the entire church-docs cache and its cursor**, not the
oversized record. A slimmed check-in event is ~700 B today and ~1,600 B double-locked, so this change roughly
**halves how many church documents fit before a phone throws its whole cache away and re-syncs from zero.**

The exposure is not the ordinary member — a guardian is served only her own children's records. It is **any
steward**, because `scripts/gateway.mjs:3604` serves *every* check-in record to any steward (a Finance-only
steward included), and stewards use the member app too. A church with a few years of registers has a steward's
phone repeatedly binning its cache.

Wants a sizing note and probably a "prune old check-ins from the hub" decision. The mechanism is read from the
code and is certain; the threshold arithmetic is an estimate — nobody has driven a member app to the ceiling.

## Notes carried out of the piece-3 audit (2026-09-10) — no action taken

- **The steward keeper slots are the only redundant copies of a session key, and nothing reads them.**
  `issueCheckinSessionKeys` recovers a key from the **church's own** slot only (`src/steward.src.js:7070`,
  `have.keys[cp]`). The per-steward slots in an envelope are written and never read by any code path. So
  omitting a safeguarding steward from an envelope removes a backup nothing currently uses — no loss today.
  But if a church key ever became unusable, those slots would be the only route back to a session key, and
  **no code exists to use them.** Worth knowing before piece 1 makes session keys load-bearing.

- **A second, weaker settle leak — reasoned, not executed.** `_isRelayAuthed()`
  (`src/steward.src.js:1358-1368`) returns true if **any** relay is authed, and nostr-tools' pool `oneose`
  fires once all grouped requests have EOSE'd **or closed** (`handleClose` calls `handleEose` first). A church
  with two relays — one authenticated but holding an incomplete corpus, one failing to connect — can stamp
  `settled` over a partial view. Bounded, and the relay-reset and clone flows are what produce that
  divergence.

- **`subscribeCheckinSessionKeys` takes `c.keys` straight from JSON with no validation**, so an envelope
  carrying no church slot, or a truncated one, is a reachable cause of a re-mint.

- **The two per-church reset paths are still duplicated.** `_resetChurchScopedState` (one call site, the
  12-word restore) and `setActiveIdentity`'s own block reset overlapping but different sets of state; the
  code at `src/steward.src.js:7707-7711` records that convergence was deliberately deferred. The piece-3
  audit found a live defect caused by exactly that split. **Converging them is its own change and needs its
  own audit** — do not fold it into a feature commit.

## What every piece must carry

- **A point-of-use test, plus its negatives.** Positive: a cleared helper opens a record they wrote.
  Negatives: a helper cleared for a *different* session opens nothing; a guardian of a *different* family opens
  nothing; a Finance-only steward — who **is served the ciphertext** (`scripts/gateway.mjs:3604`) — opens
  nothing.
- **The caller list in the commit message** (rule 2). The reader list below is not optional reading.
- **The test count accounted for** (rule 8).
- **Device verification before merge** (rule 6).

## ⚠ Traps a builder with no context will walk into

- **THE BUILD COMMAND.** `vendor/steward.js` is rebuilt **only** by `bash scripts/build-steward.sh`, and that
  script is **in no npm script at all**. `npm run build:bundles` runs `build-identity.sh && build-fellowship.sh`
  — neither touches `vendor/steward.js`. `npm run build:vendor` exits 0 and rebuilds nothing of ours. Every
  piece of this change lives in `src/steward.src.js`, so editing it and running the tests without
  `bash scripts/build-steward.sh` **tests the old bundle and goes green.** The net is
  `scripts/vendor-freshness.test.mjs:30`, but only if the whole suite runs.
- **`fnBody()` returns the WHOLE function including its signature.** The house scaffold wraps the body in an
  *object literal* (`new Function('scope', 'with (scope) { return ({ ' + body + ' }).name; }')`). Nest it inside
  your own wrapper and you silently run nothing, and every negative test passes vacuously. **Add a counter that
  proves the harness entered the code.**
- **esbuild renames on collision.** In `vendor/steward.js`, `nip44e`/`nip44ck` resolve to
  `encrypt3(...)`/`getConversationKey(...)` and `finalizeEvent` becomes `finalizeEvent2`. Stub only the `src/`
  spellings and every `wrap` call throws a `ReferenceError` that `buildHelperGrant` **catches per recipient**,
  producing an envelope with an empty `keys` object — and "X is not in keys" then passes vacuously. Documented
  at `checkin-helper-mint-is-the-shipped-one.test.mjs:120-128`.
- **Sabotage must be sliced to the enclosing function.** `publishCheckin` sits beside
  `publishCheckinHelpers`, `removeCheckin`, `migrateCheckinKeys` and five other `encPublish` callers, and
  `encSeal`/`encOpen`/`encSelf`/`decSelf` are near-identical siblings. Slice the function, assert the anchor
  appears **once**, then replace.
- **Never assert behaviour by text-matching `app/*.jsx`** — they ship unbundled, so `false && ` leaves every
  word in place and the match still passes. Lift and run, or drive the rendered screen with
  `scripts/render-jsx-screen.mjs` (`miniReact()`). Text-matching *does* work against `vendor/*.js`.
- **Fixed ports.** Every relay test binds a hard-coded port and a duplicate deadlocks both files.
  `console-publish-honesty.test.mjs` and `relay-church-scope.test.mjs` already collide on 8993 — pre-existing.
  Pick unused ports and say so in a comment.

## Every reader of a check-in record — rule 2

`d = trinityone/checkin:<id>`, kind 30078.

**Decrypts the content — three paths, all steward console, all via the `checkin` ring.** Each returns nothing,
silently, if `content` changes shape:

| file:line | what |
|---|---|
| `src/steward.src.js:7154` | `subscribeCheckins` — the only `'checkin'` call into `encSubscribe` |
| `src/steward.src.js:6203` | `take()` inside `encSubscribe` — **the decrypt**; `null` → holding pen (`:6206`) |
| `src/steward.src.js:6153-6163` | `encOpen` — ring newest-first, then the owner's legacy self-key |
| `src/steward.src.js:7128` | `migrateCheckinKeys` — decrypts with the legacy church key; **second writer** |
| `app/steward-root.jsx:202` | `window.useStewardCheckins` |
| `app/stew-dashboard.jsx:5867` | `DashCheckin` |
| `app/stew-dashboard.jsx:5906-6013` | filters on `r.date`/`r.out`/`r.child`; renders `r.childName`, `r.code` |
| `app/stew-dashboard.jsx:5580` | `CheckoutModal` — the pickup-code compare |
| `app/stew-dashboard.jsx:6027` | `writeCheckin({ ...r, out })` — re-publishes a decrypted record |

**Handles the event without decrypting** (shape-agnostic; unaffected by an additive field):
`scripts/gateway.mjs:3736-3754` (`canRead` CHECKIN_D), `:3604` (serves ciphertext to any steward or care
admin), `:3593`, `:3279-3285` (write gate), `:2409` (`note()` has **no** CHECKIN_D branch);
`src/fellowship.src.js:2033`, `:1988-1999` (**persists ciphertext to localStorage**), `:1608` (`_slimEvt`
preserves tags), `:2097`, `:5554`, `:3535`; `scripts/event-store.mjs:296-301`, `:341`;
`scripts/gateway.mjs:4588`, `:4617`, `:4694-4772` (`/import` does `store.put` with **no `accept()` pass**),
`:5915-5993`; `src/steward.src.js:3252`, `:3395`, `:3433`.

`encRead` does not exist in this repo.

## NOT scoped here — decide before slice 3, not during it

Three findings proved on a live relay. None is caused by this work, and none is touched by pieces 1-3: the
only writers today are the church key and safeguarding stewards, both via the console, and no piece adds a
writer or a delete button.

1. **A delete cannot reach across authors.** `replKey` is `pubkey:kind:dtag`
   (`scripts/event-store.mjs:16`). The owner console's tombstone is accepted and a helper's record **survives
   and is still served**. Same for a delegated steward's.
2. **A helper cannot tombstone even their own record.** `accept()`'s CHECKIN_D branch needs a `['session']`
   tag to reach `checkinHelperOf`, and `encRemove` emits none. The previous scope doc records the tombstone as
   unreadable; it is in fact unwritable by the one author slice 3 is about.
3. **Two authors at one d-tag coexist and both get served** — two events, different bodies, one address.

Also unscoped: **`encSubscribe`'s tombstone branch is an unconditional forget with no watermark**
(`src/steward.src.js:6250-6263`) — it runs before any decrypt and deletes by d-tag suffix regardless of author.
Harmless only while nothing produces such a tombstone. Any "remove this record" or "stand the session down"
button makes it live, and a tombstone arriving before its document leaves nothing behind.

(The fourth finding from the audit — row identity from the sealed body — has been **moved into piece 1**, since
piece 1 edits the function where it originates.)

And the consequence of the owner's decision: **retention now has to be built as deletion**, because
double-locking removes "the key expires" as a mechanism — and per items 1-3, deletion does not currently work.

## Unverified

- **Nothing in this document has been on a device.** Rule 6 is unmet by this scope. (Slice 2's granting screen
  *was* — see the header.)
- **The reader half of pieces 1 and 2 does not exist**, so the writer shape is proved compatible and the relay
  is proved to serve it, but not that a helper or guardian client can open it end to end. `helperKeyFor` works
  in isolation but has no product caller.
- **`HUB_SAVE_CAP` overflow is reasoned from the code, not executed.** The mechanism is certain; the threshold
  arithmetic is an estimate.
- The transitive branch of `guardianOfIn` (`scripts/gateway.mjs:3751`) was not exercised — only the direct
  `p`-tag-equals-`authed` path.
- **The full suite has not been run** against any of this, so rule 8 is unaddressed.
