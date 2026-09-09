# Children's check-in belongs in the member app, not the steward console

**Status:** design. Nothing built. Written 2026-09-09 at the owner's request.

**Owner:** *"we are going to need a new ux for checking in children, doing it via the steward console is
awkward and insecure imo."* And, on committing to it: *"This sounds like a big build that we can't screw
up, and we've broken safeguarding stuff before."*

That second sentence is the governing constraint of this document. **Read §6 before writing any code.**

---

## 1. What is wrong with today

Check-in is a tab in the steward console (`app/stew-dashboard.jsx`, added to the nav when `checkinOn`).
The children's register key is *"wrapped to the church + every safeguarding-capable steward"*
(`gateway.mjs:705`), and each child's presence is one sealed record (`checkin:<id>`, `:704`).

The machinery is sound. The **staffing model** is not:

- **To run the desk you need the steward console.** That is the app holding the church key or a steward's
  capability keys. A device at a busy door, handled by whoever is free, is the worst place for it.
- **The people who actually do this job are not stewards.** Children's workers and rota volunteers are
  trusted with children and not with finance, the members list, or the safeguarding register. Today the
  only way to let them check a child in is to make them a safeguarding steward.
- **It is awkward.** A console with sixteen settings pages is the wrong tool for "tap the child, print
  the sticker".

## 2. The shape

**Both sides live in the member app. What differs is what your key opens.**

- **Parents** already hold a guardian link to their own children (`guardreq:`/`GUARDIANS_D`, the v2
  safeguarding work). They get check-in **for their own children only**, with no new key at all.
- **Children's workers** get a new **check-in helper** capability: a key that opens the register for a
  session and nothing else. No members list, no finance, no safeguarding records, no console.

That second one is the piece that does not exist yet. Everything else is a rearrangement of parts already
built.

## 3. What the parent scans, and why a scan at all

**A QR on the door of the children's room.** The parent scans it and their child is checked into that
session.

The scan is not ceremony. A button in an app can be pressed from the car park or from home; a code on the
door is evidence the family is *there*. The join QR already establishes this pattern, so it is a shape
members will recognise.

- **Printed sheet** is the cheap version and works in a hall with no screen and no wifi.
- **A rotating code on a screen** is better where there is one, because a photograph of last week's sheet
  stops working.

Both should be supported; a church with a laminator and no screen is the normal case, not the fallback.

## 4. What the worker sees

Two things, in the member app, for whoever holds the helper key:

- **A live list** — who is in this room now, who is expected, who has been collected.
- **Pickup** — the parent shows the code from their phone; the worker checks it matches before releasing
  the child.

The pickup code already exists in concept (`reference/` care-skip-token work uses the same
sha256-of-a-token shape). It should live on the phone that will collect the child, which is the phone that
checked them in.

## 5. The desk does not disappear

A physical desk is still needed for **visitors, families without the app, a flat battery, and a
grandparent doing the pickup**. That is not a failure of the design — it is the exception it should
handle, rather than the case the whole thing is built around.

The desk becomes: a worker with the helper key, adding a child by hand and writing a code on a sticker.

## 6. Why this must be built slowly, and what has gone wrong before

The owner named it: *"we've broken safeguarding stuff before."* He is right, and the record is specific.
Every one of these shipped, and every one looked finished:

- **A well-tested engine nobody was required to consult.** The fix that hides adults-only rooms from a
  young person had eight passing tests over its engine. Deleting the one line in the app that called it
  left all 1,982 tests green. (CLAUDE.md rule 1 exists because of this.)
- **A message sealed to the wrong audience** read as "nobody answered" — child care chat, fixed 09-05.
- **A guardian's own child could be hidden from them** by a gate that did not consider the guardian link
  — found and fixed this week, and it had been reachable one tap later than anyone checked.
- **A comment satisfied an ordering assertion**, so 935 tests stayed green over a reintroduced
  safeguarding bug.
- **`setMinors`/`setGuardians` in the sim harness skipped the sealed per-member publishes**, which cost
  three false safeguarding findings.

The pattern is not carelessness in the engine. It is that **the gate is correct and the screen does not
consult it**, or the test drives something that is not the shipped path.

### Rules for this build specifically

1. **Test at the point of USE.** Every rule here needs a test that fails if the check is deleted *from the
   screen*, not only if the engine behind it breaks.
2. **A helper key must open the register and provably nothing else.** The test that matters is the
   negative one: with only a helper key, members / finance / safeguarding / care must be unreachable. That
   is the same test that caught the capability-key leak in August, where granting Finance handed over the
   children's register.
3. **A parent may check in their own children and provably no others.** Assert the refusal, not just the
   permission.
4. **A scan proves presence, so treat a stale or copied code as an attack.** Rotating codes need a window;
   printed codes need a session scope. Say which in the build, and test the expiry.
5. **Nothing about pickup may be guessable.** The code is compared, never displayed to the wrong party,
   and a failed match is loud.
6. **Read `reference/DOMAIN.md` first** (CLAUDE.md rule 7) and state the assumptions about how a church
   actually runs a children's session in one line before designing the screens. Churches differ: some
   have one room, some six; some register at a desk, some at the door; some have no wifi in the hall.
7. **Device-verified before merge** (rule 6), and with a real second phone for the parent side. This is
   the one feature where a simulation of two people is not evidence.
8. **Audit every two changes, not at the end** (rule 5).

## 7. ANSWERED by the owner, 2026-09-09

**A child does not need an account.** *"most children getting checked in, will not have a phone."* So a
check-in record hangs off the **guardian's** record, not the child's. The child is a person the church
knows about, named in the family's record, with no key and no device of their own. That is the normal
case, not the fallback — design for it first and let an older young person with their own account be the
exception.

**The helper key is a ROTA ROLE.** *"Holding the helper key will be a rota role, but we may change that
to be more specifically a 'safeguarding team' after the pilot."* Whoever is rostered onto children's work
for that session holds the key for that session. Two consequences that must be built in from the start:

- **Access ends when the turn does.** That is the whole appeal of tying it to the rota, and it is only
  true if it is enforced rather than assumed.
- **The source of the role must be swappable.** The owner has already said it may become a named
  safeguarding team after the pilot. So "who may hold the helper key" is one question asked in one place,
  answered by the rota today, answerable by a team list tomorrow, without unpicking the feature.

**A worker with the helper key can release a child manually.** *"If a parent has no phone, we need a
fall back so the helper key can sign them out manually."* A flat battery, a grandparent, a childminder —
these are ordinary Sunday events, not edge cases.

**This manual release is the most dangerous thing in the feature, and it should be built as if it is.**
It is the route round every other protection here, so it is the one an attacker aims at. It needs, at
minimum:

- to be **recorded** — who released the child, when, and that it was manual rather than by code. A manual
  release that leaves no different trace than a normal one is not a fallback, it is a hole;
- to be **visible to the guardian afterwards**, so a parent can see their child was collected without
  their code;
- to be **unavailable to anyone without the helper key**, tested by its refusal and not only its success.


## 8. DECIDED: design for a connected hall

Owner, 2026-09-09: *"lets work under the assumption that churches with safeguarding stuff tend to be in
more wealthy places with good wifi. If they don't it's just a feature they will have to forfeit a little.
Lets design for wifi/internet."*

**So: check-in assumes a reachable relay. Offline operation is not a requirement.** That is a deliberate
scope decision, not an oversight, and it removes the largest constraint on the design.

**Why the reasoning holds.** Formal children's-work safeguarding — registers, pickup codes, cleared
volunteers — is a practice of churches that already run structured programmes, and those churches
overwhelmingly have a building with wifi. A church without connectivity is unlikely to be running the kind
of session this feature serves.

**What follows from it:**

- The parent scans a QR on the room door, and the worker's list updates from the relay. Both sides need
  the network; that is now allowed.
- **No offline queue, no local reconciliation, no split-brain register.** Those are the parts that would
  have made this genuinely hard, and they are out.
- The worker's device is **optional**, not assumed — parents scan the room, so a desk device is only
  needed for the exceptions in §5.

**What it costs, stated plainly so nobody is surprised later:**

- A church with no wifi in its hall cannot use check-in. It falls back to paper, as it does today.
- **Wifi that drops mid-session is the case to design for, and it is not the same as "offline".** A
  five-minute outage during the busiest ten minutes of a Sunday must not produce a register that is
  quietly wrong. The right behaviour is to fail LOUDLY at the moment of check-in — the parent is told it
  did not work and to see the desk — rather than to accept it optimistically and reconcile later. A
  parent who believes their child is registered when the room does not is worse than an honest refusal.
- **This decision must be revisited if the pilot's positioning changes.** The product leads with the
  persecuted church and the developing world, where the assumption above is false. Check-in is a feature
  of the settled, well-connected church, and should be described that way rather than presented as
  universal.

## 9. What ChurchSuite does, and what we should take from it

Looked at 2026-09-09 at the owner's suggestion. ChurchSuite is the reference product for UK churches, so
its conventions are what a church coming to us will expect. Their support articles block automated
fetching; this is from their public documentation summaries, so treat the detail as indicative and check
before copying anything closely.

### It validates the helper capability

Check-In permissions are granted per user, and **no underlying module access is required** — a church can
deny someone the Children module entirely and still grant Check-In alone. That is the capability in §2,
already proven in a mature product. Good sign that the shape is right.

### Three things we had missed

**1. TEAM MEMBERS CHECK IN TOO, so the adult-to-child ratio can be watched.** This is the important one
and it changes the model. It is not "children check in" — it is **a session**, with team and children
both present, and the ratio between them is a thing a UK church is inspected on. A church can be within
policy at 10:00 and outside it at 10:20 when a helper leaves, and nobody notices.

Consequences for our design:
- A helper does not merely *hold a key*, they are *present at a session*. Those are different facts and
  the second is the safeguarding-relevant one.
- The ratio itself is **policy, not mechanism** — every church sets its own, and some set different ones
  per age group. Ship the count and the church's own threshold; never a number of ours.
- It pairs with §7's rota decision: the rota already says who was *meant* to be there, and check-in says
  who *is*.

**2. A PIN on the leader's admin area.** Theirs is a 4-digit PIN set in the Children module settings,
guarding the screen that shows medical details and contacts. Ours has no equivalent. A helper's phone
left on a table in a busy room is exactly the case for it, and it is cheap. Note the console already has
PIN-at-rest machinery to follow rather than invent.

**3. Retention is configurable, and is a church decision.** When a visiting child's profile is deleted,
a text record of the name is kept against historic attendance for safeguarding, and the retention period
is a setting. Same class as expiry in §7 — the church chooses, we ship the mechanism. Also a reminder
that a check-in record is a **safeguarding record**, so "delete the person" and "delete the evidence they
were in the room" are different operations and must not be the same button. Compare
`accept-is-not-a-retention-rule`: replaying a write gate over an import once deleted a whole finance
journal.

### One thing to scope, not to copy yet

Their leader sees **medical and allergy details, photo/video consent, and emergency contacts** at a
glance during a session. That is a genuine need — a helper with a wheezing child should not be hunting
through a members list — and it is also the most sensitive screen in the product. It belongs in a later
slice, on top of an audited boundary, and its own design note. Photo/video consent already exists here
in part (`NOPHOTO_D`, and the children's-photos toggle in Rules & privacy).

### What this does NOT change

The boundary being built in slice 1 is unaffected: a helper key opens the register and provably nothing
else. Everything above is about what a *session* is and what a helper may see once inside it — later
slices, on a foundation that has been proved.
