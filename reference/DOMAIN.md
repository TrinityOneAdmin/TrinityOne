# Domain knowledge

**What this file is for.** Things about how churches, families and this product actually work that you
CANNOT derive from the code. The repo tells you what the software does; this tells you what it is *for*,
and which of your instincts about it are wrong.

**Read it before designing anything user-facing, and especially anything touching safeguarding.**

## How to use it

- **Before designing**, state your real-world assumptions and check them against this file. If the answer
  is not here, ASK — do not infer it from a code path. Inference from one code path is what produced every
  entry in the "corrections" section below.
- **After the owner corrects you**, write the correction here. That is the whole point: the next session
  should not need the same correction.
- **Mark every entry.** `ESTABLISHED` = the owner said it. `INFERRED` = worked out from code or behaviour,
  and therefore suspect. `OPEN` = nobody has answered it yet.
- **Do not put code facts here.** Where a function lives, what a bundle contains, how a test is written —
  that belongs in comments or CLAUDE.md. This file is about the world outside the software.

---

## Children and safeguarding

- **A young person can arrive by SEVERAL routes, not one.** `ESTABLISHED 2026-08-30.` A parent minting an
  account for them is only one. Others: joining directly on their own device via an invite or join link;
  an existing adult member being marked as a child by a steward AFTER the fact; a device changing hands or
  being restored. Any design keyed on "we just came from the family screen" is broken for everyone else.
  *Cost of getting this wrong: a fix scoped to one route, presented as covering all of them.*

- **A church may deliberately have NO group rooms for its children — direct messages only.**
  `ESTABLISHED 2026-08-30.` An empty room list for a young person is a legitimate configuration, NOT a
  misconfiguration. Copy must read as normal and must not tell them to go and ask a leader, which implies
  a fault that does not exist. *Cost of getting this wrong: copy that says the church has not set something
  up, when it has decided not to.*

- **Safeguarding is a mechanism, not a policy.** `ESTABLISHED 2026-08-27.` Churches differ by culture in
  how they do this. Ship the gates; never ship the policy. Describe the consequence of a setting; do not
  prescribe, and do not nag.

- **A child's recovery phrase is a safeguarding-grade credential.** `INFERRED.` It is shown once and stored
  nowhere. Persisting one anywhere needs a deliberate decision about where and for how long — localStorage
  is not the right home under this threat model.

## Trust, privacy and tone

- **Trust between people, not trust in the software.** `ESTABLISHED 2026-08-27.` Defaults lean open. Never
  imply suspicion of members. But gates facing OUTWARD — at the relay, at another church, at the world —
  are never optional.

- **Names over anonymity.** `ESTABLISHED.` Encourage real names; anonymity is an option, not the framing.

- **The pilot's adversary is lawful compulsion and seizure**, not a hacker. `ESTABLISHED.` Never overclaim
  a protection. The person holding the church key is the highest-value target.

- **Positioning is persecuted-church and developing-world first**, not comfortable Western churches.
  `ESTABLISHED.` The test question is "does this work over a thin pipe in Tehran". A one-second window on a
  fast desk connection can be a whole session on the connections this is built for.

- **Nation-neutral by default.** `ESTABLISHED.` UK-specific things (e.g. Gift Aid) are off by default.

## What a steward is, and is not

- **Only a human at an unlocked console admits a member.** `ESTABLISHED 2026-08-18.` Never the relay. When
  admission feels slow, fix the waiting experience — do not move the authority.

- **A steward's capability is about what they may DO, not what they may SEE.** `ESTABLISHED by the relay's
  own design.` Narrowing someone to Finance must not make the work they already did disappear from other
  people's screens.

## Pilot scope

- **Finance is locked off. Leave it.** `ESTABLISHED.`
- **Giving is non-custodial and gated off for the pilot.** `ESTABLISHED.` Members give from their own wallet.
- **Run sheets are visible only to those rostered.** `ESTABLISHED 2026-08-23.` This is deliberate, not a bug.
- **Meal trains / practical care will be used for real** by the owner's own church. `ESTABLISHED.`
- **Until go-live, builds are TESTING-signed.** `ESTABLISHED 2026-08-27.`

---

## Open questions

Nobody has answered these. Ask before designing around them; move them up when answered.

- **How common is marking an EXISTING member as a child?** `OPEN 2026-08-30.` Decides how much a stale
  "this person is an adult" answer matters, and how hard to work to invalidate one.
- **Are shared devices expected in the pilot** — a family tablet, a borrowed phone — or is
  one-person-one-device realistic? `OPEN 2026-08-30.`

---

## Corrections, and what each one cost

Kept because the pattern matters more than the individual facts: every entry is the same failure —
reasoning from the code path in front of me instead of from how a church actually works.

| Date | The correction | What I had assumed |
|---|---|---|
| 2026-08-30 | A child can arrive by several routes | The parent-minted flow was the only one |
| 2026-08-30 | A church may want no kids' rooms at all | An empty list meant something was unconfigured |
| 2026-08-29 | "Verify it's genuine before acting" | A relayed audit finding was fact |
