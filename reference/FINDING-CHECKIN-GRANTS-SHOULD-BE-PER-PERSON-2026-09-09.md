# The check-in grant is scoped to a session; it should be scoped to a person

**Status:** BUILT, 2026-09-09, on `feat/checkin-permission-per-person`. Unmerged, unaudited, and never on a
phone. The sections below are left as they were written; what the build settled is at the bottom.

**Owner, 2026-09-09:** *"in general most people approved as safeguarding adults, are approved church wide
on a yearly basis. If I'm reading this correctly, we probably don't need per session permissions. maybe
I'm confused."*

He is reading it correctly, and he is right.

## What was built

A grant is `trinityone/checkinhelper:<serviceId>` — **one service, structurally.** `gateway.mjs:711`:
*"ONE SESSION'S check-in helpers + that session's key wrapped to each."*

The three lifetimes (`session`, `day`, `open`) choose how long that ONE service's grant stays valid. Even
`open` — "until a steward ends it" — means *this service, until revoked*. It does not mean *this person,
until revoked*.

So a church that clears twelve volunteers every January must mint a grant **per service, for ever**.
Grant-ahead softens it (a month at a sitting) and never removes it.

## Why that is wrong

**It is stricter than the church's own policy.** UK churches clear volunteers annually and church-wide —
DBS, a safeguarding lead's sign-off, a training course. That is the decision, and it is already made. A
system that requires the same people to be re-authorised every Sunday is not reflecting the church's
policy; it is substituting its own.

**And that is the thing this feature promised not to do.** From `reference/DOMAIN.md`, written yesterday
at the owner's own correction:

> The church already has a safeguarding policy, a lead, cleared volunteers and its own practice. **We are
> not the policy and we are not the inspector.** The software's job is to make what the church already
> does easier to do well.

Per-session authorisation is the policy-shaped version of exactly that mistake, arriving through the data
model rather than through a screen.

**The recurring cost is real and the benefit is modest.** The one honest argument for session scoping is
blast radius: a lost or borrowed phone exposes one Sunday's register instead of a year's. That is a
genuine property and it is not nothing — but the register is names and times. A helper never receives
`minors:`, `guardians:`, or `approved:`; those stay with the church and the safeguarding lead. So the
difference is one attendance list against many, weighed against minting a grant per service for ever.

## What it should be

**Person-scoped, with the church choosing the period.** Grant a cleared helper access to the children's
register; it lasts until the church says otherwise — their clearance lapsing, the year turning, or a
steward revoking. That is what the owner asked for when he chose "stewards grant, and they select the
time period", and the per-service structure quietly prevented it.

**Keep per-session as the narrower option, because it has a real use:** a parent helping out just this
week, a visiting speaker's assistant, a one-off holiday club. Those are exactly the people a church has
NOT cleared for the year, and a session-scoped grant is the right shape for them.

So: two shapes, one mechanism. The church picks per person.

## What this changes

This is a change to **slice 1's structure**, not only its screens — which is why it is better found now.

- The d-tag stops naming a service. Something like `checkinhelper:<personPub>` or a single roster document
  per church, rather than one document per service.
- **DECIDED 2026-09-09 — separate "may hold keys" from "here is this week's key".** The owner chose the
  second option knowingly, after the trade was put plainly: a person-scoped grant that wrapped a
  longer-lived register key would be simpler, and a lost phone would then expose the whole year's
  register rather than one Sunday. Instead:

  - a **permission** says a person is cleared, is scoped to the person, and lasts until the church ends
    it. This is what a steward grants, once, matching the annual clearance the church already does;
  - a **session key** stays per session, and is issued to whoever the permission admits, without a
    steward doing anything weekly.

  So the weekly act disappears from the steward's job and stays in the system's. The blast radius the
  first audit measured is kept: a lost phone exposes the sessions it actually held keys for, not the year.
  The extra machinery is ours to build once; the risk would have been a real church's, every week.
- Expiry moves from a window around a service to a date the church sets.
- `eligibleHelpers` currently answers "who is rostered to THIS service". It would answer "who has the
  church cleared", with the rota as one possible source — which is the swappable-source design already
  built, pointed at a different question.

## What survives unchanged

Everything the two audits proved, and it is most of the work:

- a helper key opens the children's register and **provably nothing else** — 27 document types refused;
- the guardian link is directional; a parent sees their own child and not another family's;
- revocation is immediate and survives a restart;
- lifetimes are the church's choice, with the tightest as default, and the cap travelling in the signed
  record;
- nothing blocks a child being checked in.

The boundary is sound. What is wrong is what the grant is *about*.

## Recommended order

1. ~~Decide the key question~~ **DECIDED: person-scoped permission + per-session keys.** See above.
2. Restructure the grant. Its own branch, its own audit; the boundary has survived two and should survive
   a third.
3. **Then** slice 2. The granting screen is cheap to write and expensive to write twice, and it is the
   screen that would have hard-coded "pick a service" into a steward's habits.

---

## BUILT — what the implementation settled, 2026-09-09

Written after building it, and only where a test proves the claim.

**Two documents, and the relay requires BOTH.** `trinityone/checkinperm:<personPub>` says a person is cleared
and carries **no key material**; `trinityone/checkinhelper:<serviceId>` carries one session's key. A helper is
admitted to a session's records only if the envelope names them AND a live permission covers them. That
conjunction is what makes one withdrawal end every session at once — without it, revoking somebody on Tuesday
would leave every envelope already issued for the next fortnight still admitting them.

**Who issues the session key, and with what authority: the CONSOLE, acting as the church.** Nothing else can.
The key is NIP-44-wrapped to each recipient with the church key, so a relay able to issue it would be a relay
able to read the register. `issueCheckinSessionKeys` derives the recipients from the permissions and mints the
envelopes; no steward picks anybody weekly.

**And the product consequence, which is not an implementation detail:** a console must open at some point
between a permission being granted and the Sunday it is used on. The steward's WEEKLY act is gone; a periodic
one is not. If nobody opens the console for a month, helpers cleared in that month have no key for the sessions
in it. That is why the issuer runs AHEAD rather than one service at a time — and why the horizon is bounded.

**The blast radius is enforced by the relay, not chosen by a console.** A named helper may fetch a session key
only between `from - KEY_LEAD_SECONDS` (a fortnight) and `until`. So a console that issued a year ahead still
leaks a fortnight rather than a year, and a phone that was off all year cannot come back and collect every past
envelope. The issuer's own horizon is clamped to the same number.

**No session key can be open-ended any more.** `open` was a session lifetime until this change; it moved to the
permission, where it means what a church means by it. A key with no end would be a standing key to the
children's register — worse under automatic issuance than it ever was under a steward's weekly click. Every
session lifetime now has a cap, and none exceeds 26 hours.

**Mint stays church-key-only, on both documents.** A safeguarding steward can read the register and still
cannot say who else may. Widening that is a separate, already-scoped change and was deliberately not done here.

**What was NOT done, and should be said plainly:**

- **Nothing has been on a phone.** CLAUDE.md rule 6 is unmet. There is still no screen — slice 2 — so there is
  nothing to drive.
- **Mid-session revocation still has a bounded race.** `event-store.mjs:149` accepts `created_at` up to +900s,
  so a church device running fast can pin a record and refuse its own honest correction for up to fifteen
  minutes. The owner judged this unlikely and chose not to spend on it. The false justification that used to
  stand in `gateway.mjs` and `checkin-role-source.mjs` — "the only key that can produce a later timestamp is
  the church's own, so a later timestamp IS the church speaking more recently" — has been corrected in both
  places rather than left in the permanent record.
- **A withdrawn helper keeps what they already fetched.** Revocation stops writes and stops reads of anything
  written by anyone else, at once. It does not take a key off a phone, and `canRead`'s first rule still lets an
  author read back their own events. A screen saying "access removed" must not imply otherwise.
