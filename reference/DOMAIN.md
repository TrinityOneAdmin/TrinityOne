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

- **The Suite is the path we push: relay and console on one machine.**
  `ESTABLISHED 2026-09-01.` Owner: *"we need to prioritise the TrinityOne Suite in the marketing, so that
  more people run the Relay+steward console together, running just the relay should be harder to get to on
  the website."*

  **This is a product decision that solves an architecture problem, which is why it is here and not only in a
  roadmap.** A church's own relay has to be vouched for before clients will talk to it. When the console is
  served BY that relay, the vouch can be automatic and safe: to load the console the steward already ran the
  key-holding code from that box, so adopting it adds no trust they had not already given. When the console
  is the HOSTED one at `app.trinityone.church`, that argument does not hold — the key lives against a8's
  origin, the steward never loads anything from their own box, and something else has to establish the link.

  **Corrected 2026-09-01.** I first recorded here that `welcome.html` never mentions the Suite. That was
  wrong — my check was case-sensitive and missed every "Suite". The site DOES present it, as the third of
  three cards on Get TrinityOne, with installers for Windows, macOS and two Linux formats.

  The real problem is weaker but still real: it is framed as **"Optional, for churches that host their own"**,
  it sits last, and its card is the only one without a plain-language reason to choose it. Meanwhile every
  "Start a church" button (5 of them) points at `https://app.trinityone.church/steward.html` — the hosted
  console. So the site offers the Suite while steering setup down the path where automatic adoption cannot
  work. The change wanted is emphasis and default, not adding something missing.

  Consequence for planning: make the Suite the advertised route, and the awkward case shrinks to churches who
  deliberately run a bare relay — a smaller, more technical group who can reasonably take one extra step.

- **A Suite box must register the church with itself, automatically.** `ESTABLISHED 2026-09-04.` Owner, after
  being shown that creating a church on a self-hosting box silently points the whole congregation at the
  hosted pool instead: *"I think a suite box should auto register, and being asked if it's an 'always on'
  machine is already part of that setup process."*

  So self-hosting must need **no extra step**: if this computer is the church's box, creating the church on
  it registers it there, and the console must not have to be told twice.

  **Two things for whoever builds it.** First, registration is deliberately deferred until the church has a
  NAME — a nameless self-registration is refused on purpose (`gateway.mjs` H4: one box collected 37
  anonymous rows), so "auto-register" means *at the moment the name is saved*, not at key creation.
  Second, `INFERRED and NOT YET FOUND IN THE CODE`: the owner refers to an existing "is this an always-on
  machine?" question in setup. The Suite home asks *"What should this computer do for your church?"*
  (`relay-app/home.html:39`) with "Run your church" / "Manage a relay", and "Run your church" already says
  *"This computer keeps your church's records at the same time"* — but there is no literal always-on
  question that I could find. Check with the owner before treating one as existing.

- **A relay must not hold a church's NAME. It gets a petname derived from the key instead.**
  `DECIDED 2026-09-04.` Owner, when shown that a church can rename itself on somebody else's relay and asked
  who should be allowed to: *"Tbh, I don't even think church names on relays should be that easily
  identifiable.....why have them at all? Do we need them?"*

  **Measured the same day, and it is a hole in the entry below this one.** `relay/church.json` stores church
  names in PLAINTEXT next to the npub — `{"npub":"npub1uumze…","name":"St Editha's, Marchwood","by":"operator"}`.
  The seizure measurement below covered member names and kind-0 profiles and concluded "a seizure yields the
  social graph in public keys, never in names". It never looked at `church.json`. On a box hosting several
  congregations that file is a readable list of exactly which ones.

  **The name does no protocol work.** Nothing gates, routes or renders on it; `CHURCH_NAMES` is read only by
  the operator's own admin endpoints (`/config`, `/stats`, the removeChurch dry run — all admin-gated) and as
  a push notification title. (The push case is not the exposure: `webpush` encrypts the payload to the
  subscriber, so the push provider sees ciphertext.) The disk is the exposure.

  **It exists for one reason**, recorded in the H4 comment in `scripts/gateway.mjs`: an operator faced with
  37 rows of bare npubs cannot tell which church to remove, and removing the wrong one de-provisions a real
  congregation. That need is real and must survive.

  **CORRECTED 2026-09-05, before any code was written, and it changes what this is worth.** The church's
  name is ALSO in cleartext on the relay in its **kind-0 profile** — measured on the live box:
  `St Editha's, Marchwood` and `SIM St Aidan's`, readable, in `relay.sqlite`. That is public BY DESIGN and
  the entry below says so: someone joining must see the church's name before they join, so the profile
  cannot be sealed without breaking the join flow.

  So **removing the name from `church.json` does NOT stop a seized relay yielding church names**, and it must
  not be described as if it does. What it does buy is smaller and still real: one fewer plaintext copy, the
  operator's list stops being a compact index of exactly which congregations a box serves, and — the part
  that started this — there is no longer a church-supplied name on the relay for a church to rename, so the
  "who may relabel a row" question disappears instead of being answered.

  **The real exposure is the kind-0 profile and it is structural, not a bug.** A relay inherently knows the
  names of the churches it serves, because members and joiners must read them. Closing that would mean
  gating church profiles behind membership and finding another way to show a joiner which church a code
  belongs to. That is a product decision, not a fix, and it is NOT taken here.

  **The decision: a petname derived from the church's npub** — the wordlist at `scripts/gateway.mjs:928`
  (`olive, cedar, dove, anchor, lamp, vine, shepherd, harbor…`) already does this for a relay's own memorable
  name. Applied to a church key it gives the operator a stable, distinguishable label ("Quiet Harbor 42")
  that needs nothing from the church and means nothing to whoever holds the disk.

  Consequences for whoever builds it: the relay must stop STORING a church-supplied name, not merely stop
  displaying it — and per the backwards-compatibility rule, add the derived label rather than repurposing the
  `name` field, then stop writing `name`. Existing rows already carry real names and want clearing.

- **What a seized relay actually yields — MEASURED 2026-09-02, do not re-derive by guessing.**
  Read off a live relay's sqlite, not reasoned from the code. **Encrypted at rest:** group messages (kind 1),
  DMs (kind 4), journal, notes, prayer, bookmarks, highlights, `clearance:`, `guardnotice:`. **Names are
  SEALED** — `trinityone/name:` holds ciphertext in both `c` and `m`, so the relay never holds a plaintext
  name; of 24 kind-0 profiles, 23 were church profiles (public by design) and the one member profile carried
  no name.
  **Cleartext on disk:** `member:<key>` (this key belongs to this church, and when it joined), **`minors:`
  (which keys are children)**, `roster:` (care structure), `group:`, `rsvp:`, `careavail:`/`unavail:`,
  `joinpolicy:`, `event:`, `financekey:`.
  So a seizure yields **the social graph in public keys, never in names** — the shape of a congregation, its
  groups, its rota, and which members are children, but not who they are absent a separate link (a seized
  phone, network correlation — see the deanon red-team note that pubkey↔IP is open and inherent).
  Two things follow. **Do not overclaim this as a weakness OR a protection** — a session flagged mutual
  hosting as exposing members' data and had to correct itself after measuring. And **`minors:` is the single
  most sensitive document the relay stores in the clear**; its pseudonymity is doing all the work. This is
  unchanged by relay-sharing: it is equally true of the shared relays we run, which only widens who holds the
  disk.

- **A TrinityOne relay is one running our software — and that is the whole admission rule.**
  `DECIDED 2026-09-02.` Owner, after being shown the trade: *"it shouldn't be hard to say 't1 steward app
  only connects to t1 relays', surely?"* — and, choosing: *"runs our software"*. A relay is admitted iff it
  answers the C2 nonce challenge with a valid signed proof. **Nothing else is consulted** — not a canonical
  pin, not the serving origin, not a church-signed list. This is the owner's own recorded definition of
  "non-TrinityOne" (*"people that run our specific relay software"*) implemented literally.
  **What it gives up, knowingly:** someone deliberately running our software can be admitted and would see
  the pubkey-level social graph — never names, never message contents. An architecture review dissented and
  recommended the stricter "a box my church chose" rule; the owner decided after the gap was stated. Do not
  re-open without new information.
  **What it bought:** mutual hosting and hardware-less churches work with zero configuration, and the four
  enrolment blockers — including one that could have wiped a church's relay membership — cease to exist
  because nothing writes that document any more. See `reference/PLAN-T1-ONLY-2026-09-02.md`.

- **Churches SHARE each other's relays. That is the point of decentralisation, and it was the original
  request.** `ESTABLISHED 2026-09-02.` Owner, correcting a session that had treated relay-sharing as an edge
  case: *"The three pilots will self host, but the entire point is that they share each others relays.
  Literally the entire point of decentralisation."* The three pilot churches each run a box and host one
  another. **Consequences that must not be forgotten:** the church-signed `trinityone/relay-net` document is
  therefore the PRIMARY mechanism, not a fallback for the unusual — it is how church A vouches for church B's
  box. Root 2 (same-origin) covers only your OWN box, so it can never carry this model. And any rule of the
  form "only sign in the box that served this console" BREAKS mutual hosting outright: a partner church's box
  is never your origin. Scope by network membership (`joinNetwork` / `NETWORKS` / `networkOf`), never by
  origin.

- **The gate belongs in the relay and out of sight.** `ESTABLISHED 2026-09-02.` Owner: *"I don't really want
  a panel to say anything, it should be all under the hood, the t1 relay software should simply not allow
  connections from other non t1 relays and churches"* — and, clarifying: *"not allow, and not look for."* So
  no confirmation UI, no steward ceremony. **This forecloses using a human as the safety net** for a
  mechanism that is not yet reliable: an automatic path means defects like `_oneComplete`'s dishonest
  `complete` flag must be FIXED, not covered by asking a steward to check. The client-side gate still cannot
  be removed — a hostile relay will not refuse itself, so a client must decide what it writes to — but it
  must be silent, and the relay must carry every part of the rule it can.

- **A church's relay must hold the church's data and nothing else — because it may be seized.**
  `SUPERSEDED IN PART 2026-09-02 — see the relay-sharing entry above.` The headline over-generalised the
  quote beneath it, which is about BLOAT, not exclusivity. Churches deliberately host one another; what
  survives is that a relay should not accumulate data for churches it does not serve.
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

**How admission actually works is written up in `reference/RELAY-ADMISSION.md`** (2026-09-02). Two
one gate — proof, at the address dialled, that the box holds a relay identity key, i.e. that it runs our
software — and four traps that each cost real work to find. (The canonical pin, the serving origin and the
church's signed relay-net doc are computed and reported, but they no longer decide admission.) The one worth knowing without opening it: **same-origin adoption is console-only** (a phone's
origin is `https://localhost`, so it can never match a church's relay), which means a self-hosting
church's members reach their relay by exactly one route — the church's own signed list. Nothing
publishes that list automatically yet.


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

---

## Owner decisions, 2026-09-03 (from the audit of 2026-09-02)

**A member who leaves keeps their name on what they already wrote.** A privacy narrowing was available —
stop serving a non-member's profile to members of a church they are not in — and it was declined, because
the cost is that everyone who has ever left goes blank in old conversations. History stays readable. Do not
re-propose this as a straightforward fix; it is a decided trade, and the leak it closes is a stranger's
display name, not their messages.

**A church code that is well-formed but is not a church says "not found".** It is not refused at the point
of entry and it is not followed as though it were a church. Someone mistyping a code, or given the wrong
one, is told plainly that there is nothing there.

**Lightning and wallet components are OFF for the pilot and are not to be worked on.** Giving is
non-custodial by design and switched off (`givingOn = false`). Anything Lightning- or wallet-shaped —
including the wallet backup path that currently has no button — is out of scope until the owner says
otherwise. Do not "tidy" it, delete it, or fix its copy.

