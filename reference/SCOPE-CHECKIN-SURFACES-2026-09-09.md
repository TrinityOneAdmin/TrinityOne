# Scope: the check-in surfaces — what gets built, in what order

Follows `reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md`. Slice 1 (the security boundary) is
merged. This scopes what sits on top of it. **Nothing here is built.**

## Where slice 1 leaves us

Built and merged: `publishCheckinHelpers`, `revokeCheckinHelpers`, `checkinLifetimes` in the console;
`eligibleHelpers` in `scripts/checkin-role-source.mjs`; `helperKeyFor`, `grantAdmits`, `readHelperGrant`
enforcing in the relay.

**And nothing consumes any of it.** `grep -rl` over `src/` and `app/` for `helperKeyFor` and `grantAdmits`
returns nothing. A helper's record cannot currently be displayed by anything that exists. That is not a
defect — it is what "boundary first, screens second" means — but it does mean **slice 2 is what makes
slice 1 real**, and until then the boundary is proved only by tests.

## Three surfaces, three slices

Deliberately three, not one. Each is independently useful, independently auditable, and the risk rises
sharply across them.

### Slice 2 — the steward grants and revokes (console)

The smallest thing that makes slice 1 usable. A steward picks a session, sees who the rota says is
serving, grants them, chooses a lifetime, and can revoke.

- Lowest risk of the three: console-only, one reader, and the church key is already there.
- Everything it needs exists. It is wiring, not invention.
- **It is also the first point-of-use test slice 1 can have.** Rule 1: a well-tested engine nobody is
  required to consult is not a feature.
- Watch: the mint derives keepers as `[cp, ...stewards]`, so a screen that omits the safeguarding lead
  silently gives her no session key. That is a known gap from the audit and **this is the slice that must
  close it**.

### Slice 3 — the room and the register (member app)

The session itself: a QR on the room door, a parent checking their own child in, and the worker's live
list.

- First member-app work, first use of a session key by a reader, first QR.
- **DECIDED 2026-09-10 — the room code is a PRINTED IDENTIFIER that carries NO authority.**
  The QR names the session ("Toddlers, 13 Sept") and is not a credential. The authority already exists and
  is relay-enforced: a parent is proven a guardian by the `p` tags and `guardianOfIn`, and a worker is
  proven cleared by the conjunction of envelope membership and a live clearance. So **photographing the code
  gains nothing.**
  Why printed rather than rotating: it works with no device at the door, no power and no screen — which
  matters for a church hall and matters far more for the places this product is aimed at. Rotation stays
  available later **without changing the model**, because a rotating code is the same identifier with a
  shorter life.
  The risk knowingly accepted: somebody holding the code could check in a child who is not there. That is a
  data-quality nuisance, not a safeguarding breach — the **pickup code**, which is what actually releases a
  child, is separate and per-record.
  ⚠ **THE RULE THIS DECISION RESTS ON:** the room code must never carry key material or authority. If anyone
  later puts either into it, the printed-sheet decision is void and it must rotate.

- **DECIDED 2026-09-10 — one session per service; the ROOM is a field and a filter, never a key boundary.**
  Three rooms on one Sunday morning are one session. The model already says so: a check-in record carries
  **both** `session` and `room`, and the envelope is keyed to the service (`checkinhelper:<serviceId>`).
  Why not a key per room: it would need three rota services on one morning, which fights how the rota
  thinks, and would mean re-keying the envelope away from the service. The blast-radius argument buys little
  here — one key covers one morning across all rooms, but a volunteer physically in the building could walk
  into the next room anyway, so splitting the key protects against a **lost phone**, not against a person who
  is already there. And **volunteers move rooms mid-morning**: covering a gap in Juniors with a Toddlers-only
  key would block them, and "must not block" is this slice's own rule.
  What this forecloses: a church that genuinely wants its Toddlers workers unable to read the Youth register.
  If that is ever wanted it is a **view** rule, or a later per-room key — not a bend in this model.

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
