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

- **You do not see what you are not part of, and you are not told what you are missing.**
  `ESTABLISHED 2026-09-01.` Owner, confirming the principle after it came up for a second document type:
  *"that is correct, you dont see groups ur not in."* So when a gate withholds something from a young
  person — an adults-only room, that room's NAME, an event belonging to it — the correct behaviour is
  **silent absence**, not a placeholder, a lock icon, or an explanation of what was hidden. A young person
  simply has a shorter list. Telling them what they cannot see would both defeat the gate (the name is
  often the disclosure) and single them out in front of their peers.
  **The exception already shipped:** an EMPTY list may explain itself, because "no rooms at all" reads as a
  broken app. `app/screens-chat.jsx` says *"No group chats here for you yet — you can still message people
  at your church directly."* That is about the list being empty, never about what was removed from it.


- **A child's own clearance document is expected to have arrived before they ever use the app.**
  `ESTABLISHED 2026-08-31.` Owner, asked whether a request for help made in the first seconds after opening
  the app could be sealed before the app knows the person is a child: *"This is a VERY unlikely situation.
  Due to the onboarding process, I'd be shocked if it ever happened in reality."* So do NOT design for the
  cold-start window as though it were a normal state, and do not add machinery to close it.
  **Counter-evidence, corrected 2026-08-31 and weaker than first written:** the "50 of 150 clearance
  publishes never landed" measurement is at `src/steward.src.js:4050`, not `app/stew-dashboard.jsx:4051`,
  and it describes a relay rate-limit fault that was FIXED by batching (AUDIT-2026-07-28 F9). It is NOT a
  current delivery rate, and it was wrong of me to cite it as one. What survives: a church can still hold
  members with no clearance document, so the window is reachable by a route unrelated to onboarding. Worth
  measuring once on real data; not worth building for until it is.


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

- **Marking an EXISTING member as a child is fairly common.** `ESTABLISHED 2026-08-30.` It is not an edge
  case. Anything that remembers "this person is an adult" must stop being believed when the church changes
  its mind — invalidation is part of the feature, not a follow-up.

- **A shared device is expected, and an ADULT IS ASSUMED TO BE IN CONTROL OF IT.** `ESTABLISHED 2026-08-30.`
  No further safeguarding is needed for that use. A family tablet an adult supervises is NOT a threat model
  this product defends against — do not harden against it, and do not let an auditor's severity rating
  override this. *The case that does matter is narrower: a device that STOPS being an adult's and BECOMES a
  young person's — the family flow ends by handing the phone over, and a reseat does the same. There the
  previous member's remembered answers must not survive the handover.*

- **Safeguarding is a mechanism, not a policy.** `ESTABLISHED 2026-08-27.` Churches differ by culture in
  how they do this. Ship the gates; never ship the policy. Describe the consequence of a setting; do not
  prescribe, and do not nag.

- **A child's recovery phrase is a safeguarding-grade credential.** `INFERRED.` It is shown once and stored
  nowhere. Persisting one anywhere needs a deliberate decision about where and for how long — localStorage
  is not the right home under this threat model.

## Trust, privacy and tone

- **A church's relay must hold the church's data and nothing else — because it may be seized.**
  `ESTABLISHED 2026-09-01.` Owner, clarifying why the closed-network decision matters in both directions:
  *"the concern is both really, but we don't want bloat on a persecuted church relay."* And on what
  "non-TrinityOne" means: *"people that run our specific relay software"* — so **self-hosting stays**, and we
  never become the party who can revoke a church's relay. That was the sharpest risk in the closed-network
  plan and this definition removes it.

  **Read "bloat" as accountability, not disk.** A congregation under pressure explaining its own records is
  one conversation; explaining a thousand strangers' profiles that arrived because the software allowed them
  is a different one. Anything on that box which the church did not choose is a liability to the people
  holding it.

  **Where it stands today** (measured 2026-09-01): `accept()` ends `return isMember` — a stranger cannot post
  a note, a message or a document. Three openings remain: stranger profiles are accepted up to
  `NONMEMBER_KIND0_CAP = 1000`; `MEMBERS` is relay-wide, so a member of any church on the box counts as a
  member (moot once each church has its own machine, which is the pilot goal); and
  `if (!CHURCH_PUBS.size) return true` leaves a relay fully open until its first church is registered.

- **TrinityOne relays are a closed network. A church must never reach a non-TrinityOne relay.**
  `ESTABLISHED 2026-09-01, and a MUST before the pilot.` Owner, on learning a church's relay list can contain
  generic public relays: *"this is a BIG issue. This should not be allowed to happen EVER. We have specific
  features for protections for a reason, allowing outside relays is NOT allowed in our main build. TrinityOne
  relays should be a network in and of themselves, so a church doesn't have to 'trust' or select relays, but
  their church console should never reach non t1 relays."*

  **Why it matters more than reach:** every protection in this product lives in the relay — the read gate,
  the safeguarding gates, default-deny. A generic Nostr relay has none of them. Publishing a church's
  documents there does not merely fail to protect them; it hands a sealed care request to a machine that
  will serve it to anyone who asks, where the wrong recipients already hold keys to open it.

  **The second half is as important as the first: a church must not have to CHOOSE.** Asking a churchwarden
  to decide which relays are safe is asking them to hold a judgement they cannot make and we can. Membership
  of the network is the product's job, not theirs.

  Note what already exists and is NOT enough: relays expose a `relayPub` and the console reads it — but only
  to count distinct machines for redundancy. It has never been a gate. The console's own comment calls
  generic relays "publish-only, never trusted with the gated corpus", which stops the church SYNCING to them
  and does nothing to stop a client PUBLISHING to them.


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

- **When a church cancels an event, who should be told?** `OPEN 2026-09-01.` The relay now notifies the
  audience the event was actually served to — the group's people for a group event, the church's members
  for a whole-church one. The alternative considered and rejected was "only the people who RSVP'd", on the
  assumption (`INFERRED`, unchecked) that hardly anyone RSVPs to an ordinary church event and that the
  people most likely to make a wasted journey are the silent ones who simply meant to turn up. Also
  unchecked: how often a church cancels anything, which is the whole basis for saying this is too rare to
  be noise. If either assumption is wrong the audience is wrong.

---

## Corrections, and what each one cost

Kept because the pattern matters more than the individual facts: every entry is the same failure —
reasoning from the code path in front of me instead of from how a church actually works.

| Date | The correction | What I had assumed |
|---|---|---|
| 2026-08-30 | A child can arrive by several routes | The parent-minted flow was the only one |
| 2026-08-30 | A church may want no kids' rooms at all | An empty list meant something was unconfigured |
| 2026-08-29 | "Verify it's genuine before acting" | A relayed audit finding was fact |
