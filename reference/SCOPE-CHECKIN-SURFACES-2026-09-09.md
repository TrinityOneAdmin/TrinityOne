# Scope: the check-in surfaces — what gets built, in what order

Follows `reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md`. Slice 1 (the security boundary) is
merged. This scopes what sits on top of it. **Nothing here is built.**

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

## The open question slice 2 must answer

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
