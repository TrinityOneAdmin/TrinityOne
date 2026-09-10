# Scope: the check-in surfaces — what gets built, in what order

Follows `reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md`. Slice 1 (the security boundary) is
merged. This scopes what sits on top of it.

**STATUS, 2026-09-10: slice 2 IS BUILT** on `feat/checkin-granting-screen` — unmerged, unaudited, never on a
phone. See the section at the foot of this file, which also answers the "open question" below and records
what the tag fix does NOT buy. Slices 3 and 4 are not built.

## Where slice 1 leaves us

Built and merged: `publishCheckinHelpers`, `revokeCheckinHelpers`, `checkinLifetimes` in the console;
`eligibleHelpers` in `scripts/checkin-role-source.mjs`; `helperKeyFor`, `grantAdmits`, `readHelperGrant`
enforcing in the relay.

**And nothing consumes any of it.** `grep -rl` over `src/` and `app/` for `helperKeyFor` and `grantAdmits`
returns nothing. (Still true after the 2026-09-09 restructure: the console now has `grantCheckinPermission`,
`revokeCheckinPermission` and `issueCheckinSessionKeys`, and no screen calls any of them.) A helper's record cannot currently be displayed by anything that exists. That is not a
defect — it is what "boundary first, screens second" means — but it does mean **slice 2 is what makes
slice 1 real**, and until then the boundary is proved only by tests.

## Three surfaces, three slices

Deliberately three, not one. Each is independently useful, independently auditable, and the risk rises
sharply across them.

### Slice 2 — the steward CLEARS A PERSON and revokes (console)

**REWRITTEN 2026-09-09**, after `reference/FINDING-CHECKIN-GRANTS-SHOULD-BE-PER-PERSON-2026-09-09.md` and the
restructure it led to. It said: *"A steward picks a session, sees who the rota says is serving, grants them,
chooses a lifetime, and can revoke."* That screen would have hard-coded "pick a service" into a steward's
habits, which is the mismatch the finding was about — churches clear volunteers annually and church-wide.

The screen is now: **a steward picks a PERSON, chooses how long they are cleared for (just today / until a
date / until we end it), and can withdraw it.** Once a year, not once a Sunday. `checkinPermissionSuggestions`
fills the list from the rota or a named team so nobody retypes twelve names, but the decision is per person,
because a DBS certificate and a lead's sign-off are facts this product does not hold.

**The session keys are NOT on this screen.** `issueCheckinSessionKeys` mints them from the permissions whenever
the console is open. What the screen owes the steward is honesty about that: it is the console that issues, so
a church whose console never opens has helpers with no keys. Say it once, plainly, where it is useful.

- Lowest risk of the three: console-only, one reader, and the church key is already there.
- Everything it needs exists. It is wiring, not invention.
- **It is also the first point-of-use test slice 1 can have.** Rule 1: a well-tested engine nobody is
  required to consult is not a feature.
- Watch: the mint derives keepers as `[cp, ...stewards]`, so a screen that omits the safeguarding lead
  silently gives her no session key. That is a known gap from the audit and **this is the slice that must
  close it** — and it now applies to `issueCheckinSessionKeys`, which takes the same `stewards` argument.
- Watch: **nothing may block a check-in.** The permission gate keeps other people OUT of the register; the
  church key and every safeguarding steward write it with no permission at all, and a screen must not grow a
  "you are not cleared" refusal in front of the desk.

### Slice 3 — the room and the register (member app)

The session itself: a QR on the room door, a parent checking their own child in, and the worker's live
list.

- First member-app work, first use of a session key by a reader, first QR.
- Needs the room code decided: printed sheet vs rotating screen code, and what "this session" means when
  a church runs three rooms at once.
- **Device verification is mandatory here** and needs two phones — a parent's and a worker's. A simulation
  of two people is not evidence for this one.
- Must not block (see the design's framing section). A ratio outside policy, a lapsed clearance, a gap in
  the rota: none may stop a child being checked in.

### Slice 4 — pickup and manual release

The end of the session: the parent shows their code, the worker matches it, and — when a phone is dead —
the worker releases the child by hand.

- Highest consequence. This is where a child leaves with the wrong adult if it is wrong.
- Manual release is an **ordinary Sunday event**, not an attack. It is recorded because a register that
  omits it is incomplete, and it is visible to the guardian afterwards.
- Wants its own audit, not a shared one.

## Explicitly NOT scoped yet

- **The at-a-glance medical, allergy, consent and emergency-contact screen.** A genuine need — a helper
  with a wheezing child should not be hunting a members list — and the most sensitive screen in the
  product. Its own design note, on a boundary that has by then survived three slices.
- **Adult-to-child ratio.** Needs team members to check in too, which makes this "a session" rather than
  "children checking in". Bigger than a screen; decide after slice 3 exists.
- **Offline.** Out of scope by the owner's decision: design for a connected hall.

## What every slice must carry

1. **A point-of-use test.** The gate is not the feature; the screen consulting it is.
2. **Negative tests over positive ones.** Assert the refusal. In August a permission test passed while
   Finance handed over the children's register.
3. **Nothing blocks a check-in.**
4. **Rule 6 before merge** — and for slice 3, on two devices.
5. **An independent audit per slice**, briefed to refute, before the next one is built on it.

## The open question slice 2 must answer — ANSWERED

**DECIDED by the owner, 2026-09-10: the existing Check-in page in the console's main nav** — *"A lot of space
on that page."* Not Settings. Built there; see the foot of this file. The reasoning that follows is left as it
was written.

**Where does granting live in the console?** Settings is now a list of pages, and there is a Safeguarding
group. A "Children's check-in" page there is the obvious home. But granting is a weekly act tied to a
service, and the rota already knows who is serving — so it may belong beside the rota instead, or in both.
Decide before building, not during.

## Handed to slice 2 by the audit of 2026-09-10 — READ THIS BEFORE WRITING A SCREEN

Six things found while fixing three audit findings on `feat/checkin-permission-per-person`. None is fixed
here, all of them land on whoever writes these screens, and the first is the most important thing on this
page.

### 1. ⚠ THE SHIPPED WRITER EMITS NEITHER TAG THE NEW READ GATES KEY ON

`src/steward.src.js` `publishCheckin` → `encPublish` writes exactly `[['d'], ['t'], ['enc','1']]`. No
`['session']`, no `['p']`.

Both read paths added on 2026-09-09 need one of those tags:

- `canRead`'s `checkin:` rule finds the session from `['session']` and asks `checkinHelperOf`;
- the guardian rule walks `['p']` tags.

So **against any check-in record a church holds today, a helper key opens nothing and a guardian sees
nothing.** The tests that pass over those gates hand-build records carrying both tags — which is §6 of the
design note in one sentence: *the gate is correct and the screen does not consult it, or the test drove
something that was not the shipped path.*

Nothing is broken in the relay. The writer has to start emitting both tags, and it must be the SHIPPED
writer that a test drives, not a fixture. Do this first: every other item on this page is cosmetic beside it.

### 2. `stew-dashboard.jsx` will state something false the day slice 2 lands

*"the only people who can open them are you and anyone you have given Safeguarding to."* True today. False
the moment a helper holds a session key. Reword it in the same change, not afterwards.

### 3. `helperPolicy().source` has no product reader

Checked rather than repeated, and it is narrower than it first looks. Both callers destructure `.lifetime`
only — `const policy = { lifetime: helperPolicy({ lifetime: o.lifetime }).lifetime }` — and the code above
them explains why on purpose: an envelope's source is pinned to `GRANT_SOURCE`, and "which question cleared
this person" moved to `permissionPolicy` when the layers split. So this is not a steward changing a setting
that does nothing; it is a returned field nothing consumes. Either drop it from `helperPolicy` or give it a
reader, but do not build a settings control for it — that would make it item 6.

### 4. `grantCheckinPermission` files everything as `'rota'`

It defaults provenance to `'rota'` however the person was chosen, against `checkin-role-source.mjs`'s claim
that naming somebody by hand *"IS a declared source and says so in the enforced record"*. The screen knows
which it was; pass it.

### 5. A 400-day-plus `dated` clearance returns bare `null`, reason discarded

Against `permissionWindow`'s own promise that *"a church that typed 2099 must see it"*. The refusal is
correct; the silence is not. A screen needs the reason to show.

### 6. Neither policy function is ever fed a stored church settings document

`helperPolicy` / `permissionPolicy` read a settings object nothing persists or loads. Until they do, the
church's answer is always the built-in default and the settings page would be item 3 again.

### And one decision this audit deliberately did NOT take

**Standing a session down destroys the only copy of its key.** `revokeCheckinHelpers` replaces the envelope
with a tombstone, and the envelope was the one place the session key existed — wrapped to the church and to
its safeguarding stewards. After it runs, **nobody can open that session's register, the church included.**

That is right for a session that never happened, and it is the wrong operation for one that has records.
Design §9 names the distinction: *"delete the person" and "delete the evidence they were in the room" are
different operations and must not be the same button.* Slice 1 has no records, so it is latent; slice 2's
"stand this Sunday down" button is where it stops being.

The same trade-off sits on the issuer, and the codebase has already chosen a side there, on purpose:
`issueCheckinSessionKeys` RE-MINTS an envelope whose key this console cannot recover, rather than refusing —
because refusing would make that session unstaffable for ever, and design §10 says a missing key must not
block a session. A guard doing the opposite was written on 2026-09-10 and removed the same day; the
idempotence test in `checkin-helper-mint-is-the-shipped-one.test.mjs` caught it and states the reason.

So slice 2 needs a **shape for standing a session down that keeps the key**, e.g. republishing the envelope
with an empty helper list and the keepers' slots intact rather than tombstoning it — same immediate,
relay-enforced revocation (`pubs` empty refuses every helper at both the read and the write gate), and the
register stays readable by the people accountable for it. Do not build it against a button that does not
exist yet; do not ship the button without it.

**What IS already fixed:** automatic issuance no longer re-staffs a session the church stood down.
`subscribeCheckinSessionKeys` reports it as `{ session, standDown: true }` and `issueCheckinSessionKeys`
skips it, so a steward's decision survives the next time a console opens. Two tests drive the real chain out
of `vendor/steward.js`.

---

## SLICE 2 IS BUILT — 2026-09-10, on `feat/checkin-granting-screen`

Unmerged, **unaudited, and never on a phone.** Rule 6 note first, because this is the first slice that can
have one: slice 1 had no screens, so "device-verified" was not a thing that could be asked of it. **This one
HAS a screen and has not been near a device.** The suite passing is not the gate.

### What was built

`CheckinClearances` + `ClearPersonModal` in `app/stew-dashboard.jsx`, on the **existing Check-in page in the
console's main nav** — the owner's decision ("A lot of space on that page"), which answers this note's own
open question. Not in Settings: a clearance is not a setting, it is a decision about a named person, and it
belongs beside the register it governs. `window.useStewardCheckinPermissions` is the hook.

Three test files drive the shipped components and the shipped writer, not copies of them:
`the-check-in-desk-names-its-session-and-guardians.test.mjs`, `a-steward-clears-a-person-for-check-in.test.mjs`,
`a-check-in-record-the-relay-will-share.test.mjs`.

### The six handed-over items

1. **DONE** — the writer emits `['session']` and `['p']`. See below for what that does NOT buy.
2. **DONE** — the console copy is reworded.
3. **NOT DONE.** `helperPolicy().source` still has no product reader. The screen asks
   `permissionPolicy`, not `helperPolicy`, so this slice did not acquire one. Unchanged and still a
   returned field nothing consumes.
4. **DONE** — provenance is `steward` when a steward picks by hand and `team` when the list came from a
   roster. The screen never asks a rota, so it never files `rota`.
5. **DONE** — `checkinPermissionPreview` names the reason, off the same `permissionWindow` /
   `permissionFault` the grant itself uses, and the screen shows it.
6. **NOT DONE and now slightly worse.** Neither policy function is fed a stored settings document, and the
   screen makes that visible: a steward chooses the lifetime per grant, so the church's stored default is
   still never read. That is the right shape for now (the decision is per person), but it means
   `permissionPolicy(settings)` has a `settings` parameter no caller fills.

---

## ⚠ THE TAGS WERE NECESSARY AND ARE NOT SUFFICIENT — READ THIS BEFORE SLICE 3

Item 1 said a helper key opens nothing and a guardian sees nothing because the writer emitted neither tag.
It emits both now, and **neither of them can open a record yet.** Measured while fixing it:

- `publishCheckin` seals through `encSeal('checkin', …)`, which uses the **safeguarding capability key ring**
  (`trinityone/checkinkey:`, wrapped to the church and its safeguarding stewards). It does **not** use the
  session key from `checkinhelper:`. So a cleared helper is now SERVED the ciphertext and holds the wrong key
  for it.
- A **guardian holds neither key.** A parent served their own child's record can open nothing at all.
- `helperKeyFor()` — the function that hands a helper their session key — still has **no product caller**
  anywhere in `src/` or `app/`.

So the relay's two read rules are now REACHABLE and still not USABLE. That is a real advance and it is not the
feature: "refused" and "served but unreadable" are different failures and look nothing like each other from a
phone. `a-check-in-record-the-relay-will-share.test.mjs` therefore asserts DELIVERY and deliberately says
nothing about decryption.

**Which key a check-in record should be sealed under is slice 3's first decision, and it is a design
decision, not a wiring one.** Sealing under the session key makes a helper's read work and takes the record
away from the church unless the church is also wrapped in; the guardian needs a third audience. The care-need
documents already solve a similar shape (sealed to a team plus the asker) and are the place to look. Do not
answer it inside a tag fix, which is why it was not answered here.

## ⚠ NOTHING CALLS `issueCheckinSessionKeys`

Still true after slice 2, and it is the other half of the sentence above. This note says session keys are
"minted whenever the console is open"; **no code opens that door.** A clearance granted on the new screen
produces a permission and no session key, for any Sunday, ever.

The screen is honest about it — its note says what a clearance IS and does not claim a key reaches anybody's
phone — but whoever builds slice 3 needs an issuer caller, and it is a deliberate piece of work: an effect
that mints envelopes automatically wants its own audit, because it publishes key material with no steward in
the loop. The owner-console effect that keeps `ensureCapKeyFor` in step with the roster
(`app/stew-dashboard.jsx`, the `_capKinds` loop) is the shape to copy, including its "owner console only"
guard and the reason that guard exists.

## A kind-5 deletion of either check-in document is honoured by the store and NOT by the derived maps

**Record only. Not fixed, and bounded in practice.**

`store.del()` removes the event from the corpus, but `CHECKIN_HELPERS` and `CHECKIN_PERMITS` are only rebuilt
by `hydrateMaps()`. Between a kind-5 landing and the next hydrate, the relay goes on enforcing a grant or a
clearance it no longer holds — serving the session key, accepting register writes. And `syncChurchFromPeer`
(`gateway.mjs`, the periodic peer pull) runs every 5–7 minutes **without rehydrating**, so nothing in that
loop closes the window: it is bounded only by the next `/import`, `/config` save, or restart.

Why it is bounded in practice: **no shipped client publishes kind-5 for either document.** The product's
revoke is the addressable tombstone (`revokeCheckinPermission`, `revokeCheckinHelpers`), which goes through
`accept()` → `note()` and is immediate. So this is reachable today only by an operator with disk or admin
access, who has better options.

**Slice 3's "your turn has ended" screen must not imply otherwise.** It must learn its turn is over from
being REFUSED, loudly, at the moment it tries to use the register — which is what design §8 asks for anyway
("fail LOUDLY at the moment of check-in") — and never from waiting for a document it will not be sent
(`canRead`'s own note: a revoked grant is dropped from `CHECKIN_HELPERS`, so the tombstone is not delivered
to the person it revokes).

## Smaller things found, not fixed

- **`removeCheckin` publishes a tombstone with no tags at all** (`encRemove`, which is shared with Manna and
  Finance). So the DELETION of a check-in record is unreadable to the helper and the guardian who could read
  the record: `canRead`'s `checkin:` branch finds no `['session']` and no `['p']` and refuses. Nothing reads
  the register in the member app yet, so it breaks nothing now; slice 3's live list must not conclude "still
  present" from a tombstone it was never served.
- **The clearance list under-reports for a second or two after a delegated steward's console reconnects.**
  `subscribeCheckinPermissions` applies its author test at emit time against whatever the steward roster
  currently holds, and re-emits only on the next event for that document. Safe direction (the console shows
  fewer cleared people than there are; the relay still enforces correctly) and self-correcting, but it is a
  real difference from `_subAddr`'s behaviour and it is deliberate — see the comment there for why `_subAddr`
  could not be kept.
- **`_ckKeeperWarned` is never cleared on church switch.** The keeper warning is said once per set of
  pubkeys per console session; a different church has different pubkeys, so it still warns, but the set grows
  for the life of the tab.

## ⚠ AND ONE CHANGE IN THIS SLICE THAT WANTS ITS OWN AUDIT

**Safeguarding stewards may now clear a person** (`checkinperm:`), at the owner's decision, in its own commit.
It is an escalation and it was taken knowingly: an audit named a safeguarding steward being able to mint as
*"the escalation that matters, since they can already read the register but must not be able to hand it to a
third party."*

Three things an auditor should go at first:

1. **The second author broke an invariant nothing was watching.** While the church key was the only possible
   author, a clearance and its tombstone shared one addressable slot, so `byP.delete(who)` in `note()` was
   final. With two authors they are two addresses that coexist for ever, and delete-on-tombstone is
   order-dependent: tombstone first, then the church's older grant arriving from a peer, and **the withdrawn
   clearance is reinstalled.** Fixed by remembering the withdrawal as `{ revoked: true, ts }`; proved by
   sabotage (reverting that one line reddens exactly the test that drives the order). `syncChurchFromPeer`
   runs every 5–7 minutes, so it was a scheduled reversal, not a corner. **Look for other maps in `note()`
   that delete on a tombstone and now have more than one possible author.**
2. **`stewardCanExplicitly`, not `stewardCan`.** The ordinary helper answers "no capabilities recorded" as
   "full steward (compat)", which would have handed this power to every steward any church appointed before
   capabilities existed. The narrow variant refuses that, matching what the console has said since
   2026-08-20. Check nothing else started using the narrow one where it wanted the compat branch.
3. **The envelope did NOT move.** `checkinhelper:` is still church-key-only, and the old comment claiming
   that widening it would then be "a formality" is corrected: the session key is wrapped with the CHURCH key,
   so a steward's console cannot produce an envelope whose slots the readers can open. Confirm nothing in the
   console tries.

Refusals asserted against a live gateway with two churches configured, in
`checkin-permission-mint-widening.test.mjs`: an ordinary member, a Finance-only steward, an UNSCOPED steward,
the other church's safeguarding steward, and the other church's own key tagging its document to us. Plus: the
church key keeps everything it had, and a steward who may clear may also withdraw.
