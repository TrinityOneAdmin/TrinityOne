# Scope: one clearance for children's work, shown in both places

Written 2026-09-10 on the owner's instruction: *"I think that cleared and cleared for youth should somehow
be merged, and cleanly presented in the members page, but mirrored in the safeguarding check page, and vis
versa."*

The finding behind it (sim round, S8): a warden who does one believes they have done the other. Measured —
clearing somebody open-endedly for check-in left their Members row's "Clear for youth" pill **un-set**, and
setting that pill changed **nothing** on the Check-in page. Two controls, two names, no cross-reference.

## What each one actually is today — measured, not assumed

They are not two views of one thing. They are two different mechanisms with different authorities.

**"Clear for youth"** — `trinityone/approved:<churchpub>`, **one list per church**, and the relay accepts it
**owner-only**: `scripts/gateway.mjs` requires `e.pubkey === cp` on that d-tag. It gates two things, both
enforced on the relay rather than the client (`src/fellowship.src.js` says outright that the client is
deliberately not the safeguarding boundary):

- an adult may exchange direct messages with a child (a guardian may always DM their own child regardless);
- an adult may **receive a young person's request for help**.

**"Clear someone" for check-in** — `trinityone/checkinperm:<personPub>`, **one document per person**, and
since the 2026-09-10 widening it accepts **two authors**: the church key *or* a safeguarding steward. It
gates membership of the session-key envelope, i.e. reading and writing that session's register.

## OWNER DECISIONS — 2026-09-10, both answered. THE MIGRATION QUESTION IS MOOT.

**1. "Set both going forward" — and there is nothing to migrate.** Owner: *"set both going forward. but no
live churches exists yet, no drama."* So the four-option table below is **historical**: there is no existing
clearance state to preserve, widen or reset. Build the merged concept cleanly, with no transitional
half-cleared state and no migration path. Keep the table only as the record of why it was not needed.

**2. Both the owner AND a safeguarding steward may clear.** Owner: *"clearing should be for both owner and
safeguarding stewards."* `checkinperm:` already accepts both. **`approved:` does not — it is owner-only on
the relay** (`scripts/gateway.mjs` requires `e.pubkey === cp` on that d-tag), so this decision requires
widening a relay write gate. That is the same change as the delegate-minting decision recorded in
`SCOPE-CHECKIN-SEALING-2026-09-10.md`, and the two go in one pass.

⚠ **ORDER MATTERS.** The red team's F3/F4/F5 found that clearance *authorisation* is judged at ingest and
re-judged on restart, so a withdrawal by a steward who later loses the tick comes back. **Fix that model
BEFORE widening who may author a clearance** — widening a broken authorisation model multiplies the bug
across a second document.

## Historical — the migration options, moot per decision 1

Merging the concept means one act grants both. For every church already running, that is a **widening in
both directions**, and the two directions are not equally safe:

- someone on the `approved:` list today would gain **register access** — modest;
- someone with a `checkinperm:` today would gain **child-DM permission** and would become **a person a child
  can send a request for help to** — that is a safeguarding role, and conferring it silently on a volunteer
  cleared only to staff a register would be wrong.

Four ways to handle it. **The owner should pick before this is built.**

| option | what happens to existing state | cost |
|---|---|---|
| **(a) Union** | everyone cleared either way becomes cleared for both | silently confers a safeguarding role. **Do not.** |
| **(b) Intersection** | only people cleared both ways stay cleared | silently removes access a church relies on; volunteers refused at the desk |
| **(c) Reset** | the merged clearance starts empty; every church re-clears deliberately | honest, but costs every church a re-do and a prompt they may ignore |
| **(d) One control forward, existing state shown honestly** | nothing is rewritten; the control sets both from now on, and a partly-cleared person is displayed as such so a warden completes it deliberately | no silent change in either direction; two states exist during the transition |

**Recommended: (d).** It is the only one that neither confers a safeguarding role without a human act nor
takes away access without one, and it matches the owner's own words — merged in presentation, mirrored in
both places. The transitional "cleared for youth, not yet for check-in" state is a feature: it is exactly
what a warden needs to see to finish the job.

## ⚠ A SECOND WRINKLE — the two halves have different authorities

`approved:` is **owner-only** on the relay. `checkinperm:` accepts a **safeguarding steward**. So a merged
control pressed by a delegated safeguarding steward would write one half and be refused the other — a
control that half-works, silently, depending on who is holding the console.

This collides with a decision already taken on 2026-09-10: *"yes, I think a delegated steward should be able
to mint keys"*, recorded in `SCOPE-CHECKIN-SEALING-2026-09-10.md` as needing its own scope because it widens
a relay write gate. **The same question, one document over.** Either:

- the merged control is **owner-only** (simplest, and consistent with `approved:` today — but it means a
  delegate cannot clear anybody, which is the opposite of the direction the owner asked for); or
- `approved:` is widened to accept a safeguarding steward, which is a **relay authorisation change** and
  belongs with the delegate-minting work rather than here.

**These two should probably be scoped together.** Both are "which safeguarding acts may a delegate perform",
and answering them separately risks two inconsistent answers.

## What gets built, once those two are answered

1. **One control, in both places.** The Members row and the Check-in clearances panel show the same state and
   set the same thing. Each names the other's consequence in one short line — per the owner's standing
   instruction, detail goes to a tooltip or the help doc, not a paragraph on screen.
2. **The partial state is legible.** A person cleared one way and not the other must read as unfinished, not
   as cleared. Whatever wording is chosen, a warden must not be able to conclude "done" from a half state.
3. **The two documents keep their own shapes.** Do not collapse `approved:` and `checkinperm:` into one
   document — they are keyed differently (one list per church versus one document per person), the per-person
   form is what makes withdrawal immediate and order-independent, and the relay reads them in different
   gates. Merge the *concept and the control*, not the storage.
4. **A test that a half-clearance cannot be mistaken for a whole one**, driven through the rendered screen.

## Not in scope

The rest of the sim round's findings (the wizard's empty-church-until-reload, the date validation, the
tooltip and toggle-state work) and the red-team's F1-F9 are separate passes. This document is only the
merged clearance.
