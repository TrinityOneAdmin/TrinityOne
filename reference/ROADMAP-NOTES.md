# Roadmap notes — things decided as "later", with the thinking kept

Companion to `reference/ROADMAP.html` (the tickable list) and `reference/FEDERATION-PLAN.md`. This file is for
items the owner has deliberately deferred, written down while the reasoning is fresh so the next session does
not re-derive it or, worse, build it early.

---

## 1. Personal data: a relay-operator switch, opt-in per church

**Decided 2026-08-17 (owner).** Not for the pilot.

**The problem it solves.** Members' personal study data — `highlights`, `bookmarks`, `notes`, `journal`,
`prayer` — is refused by the relay before authentication. Measured twice: 40 refusals in one simulation round,
8 members × 5 kinds, all `authed: null`. Nothing is lost (the store is local-first) but the syncs fail
silently and are never retried. The owner's earlier position stands: **personal files should not depend on a
relay at all.**

**The shape agreed.** Rather than simply dropping the writes, give the *relay operator* a switch: this relay
will (or will not) accept members' personal documents, and a church opts its members in. Reasons that is the
right shape rather than a client-side change:

* A church running its own relay may WANT multi-device sync for its people — that is a service they choose to
  offer and to store.
* A church on a shared or borrowed relay should not silently push its members' journals onto someone else's
  disk. Right now the refusal is the only thing preventing that, by accident.
* It keeps the decision with the person who bears the consequence — the operator holds the disk, and under
  this project's threat model the disk can be seized. A member's journal is among the most sensitive things
  the product touches.

**Sketch, not a design.** The relay already has per-church settings and a control dashboard; this is another
flag beside them. Client side: treat the relay copy as *opt-in sync*, never a requirement — if the switch is
off, do not attempt the write at all, so `rejected.log` stops filling with expected failures and a real
refusal becomes visible again. The member should be able to see which it is.

**Do not build before the pilot.** It touches the write path for the most sensitive documents in the app.

---

## 2. A multi-church feed — regional or worldwide

**Asked 2026-08-17 (owner), explicitly after the pilot.** Focus stays on giving, care and Manna.

### Could we? Yes, and most of the plumbing exists

Nostr *is* a public social protocol; this product has been using it privately. A feed is the protocol's
default case, not the hard part. Concretely, three things are already in place:

* `NETWORKS_BY` / `networkOf()` in `scripts/gateway.mjs` — churches already join **networks**, and a network
  key already carries grantor authority over its member churches.
* Church content is already tagged kind-30078 / kind-1 with `['t', NET]` and `['church', <cp>]`. A feed is one
  more tag and one more subscription.
* `FEDERATION-PLAN.md` principle 4 already states the rule this needs: **visibility is a choice**, opt-in per
  church, same code either way.

### How I would build it — cheapest tier first

1. **Network noticeboard (80% of the value, nearly free).** A church opts into a network. Stewards mark
   individual posts as network-visible — a second tag, e.g. `['t','trinityone-net:<networkpub>']`. Members read
   one extra subscription across the network's relays. No new relay code: the authority model already exists.
2. **Regional / worldwide.** The same shape with a broader tag, carried only by relays whose operators opt to
   carry it. Discovery via NIP-66 relay offers, which the federation plan already specifies.
3. **Discovery of churches**, not of people — a directory of congregations that have chosen to be findable.

### The hard part is not technical

* **Deanonymisation.** A member in a hostile country posting to a world feed under their church identity links
  them, publicly and permanently, to their congregation. That is exactly this project's threat model. The
  mitigation is structural: **the CHURCH posts, never the member.** A curated outbound noticeboard signed by
  the church key keeps individual members out of the public graph entirely. If members post as themselves, do
  not build it.
* **Moderation.** An open cross-church feed becomes a liability quickly, and there is no central body to
  moderate it — by design. Church-curated outbound solves this too: each church publishes only what its
  stewards choose, and subscribes only to the churches and networks it chooses. Moderation becomes
  *editorial*, which churches already know how to do.
* **Hosting.** A shared tier means relays carrying other churches' traffic. Whose disk, whose bandwidth, whose
  legal exposure? Answerable, but answer it before building.

### Is it worth it? An honest view

**As a social feed for members: no.** It inverts the product's central promise ("private to your church"), it
is the feature most likely to cause a safeguarding or deanonymisation incident, and this audience is not short
of social media.

**As a steward-curated noticeboard between churches: yes, and cheaply.** It is how churches discover each
other, how a network becomes something real rather than a config entry, and how a diocese or denomination
gets a reason to adopt the whole thing. It reuses machinery that already exists.

Call it a noticeboard, not a feed. The name will shape what gets built.

**Owner's view, 2026-08-17:** the noticeboard sits naturally on the church-network feature that already
works — this is an extension of something shipped, not a new subsystem. That materially lowers the cost and
raises the confidence, and it is the strongest argument for the network tier being first.

### Prerequisite: church networks have never been simulated

Networks are built and working, and nothing has ever driven them the way the care system was driven on
2026-08-17 — two churches, real stewards, a network key, watching what each side can actually see. Before any
noticeboard is designed on top, run that round and find out what the feature really does today:

* Two churches joining one network, each with its own relay and its own steward.
* What does a network key actually grant? `grantorOk()` treats a network as a valid grantor alongside the
  church and its stewards — so a network key carries real authority over member churches. Does the console
  make that visible to the church that joined?
* Can a church LEAVE, and does everything the network granted come away with it?
* What does a member of church A see of church B — deliberately, and by accident?

That last question is the one the noticeboard depends on, and it is unanswered. Do it as its own round.

**Sequence:** after the pilot, and specifically after the privacy model has survived real use — because this is
the feature that would turn a privacy mistake from local into permanent and public.

---

## 3. Android ≤10 backup path — open question, unmeasured

Raised by the security review, 2026-08-17. `@capacitor/filesystem` gates `Directory.DOCUMENTS` behind
`isStoragePermissionGranted()`, which short-circuits only on SDK ≥ R (Android 11+). Neither the app manifest
nor the plugin's declares READ/WRITE_EXTERNAL_STORAGE, so on **Android 10 and below** the backup write may be
refused outright — for the member's account file and for the CHURCH KEY.

**This is read from source, not measured.** All device work so far was on Android 12, where the check
short-circuits. Settle it on an Android 9/10 handset before choosing a fix.

Preferred fix if confirmed: fall back to the old CACHE + share-sheet path on those versions rather than
declaring a storage permission — a persecuted-church app should not be asking for file access it can avoid —
and say plainly on that path that dismissing the sheet keeps no copy.

---

## 4. DECIDED, NOT A BUG: churches self-register on the public T1 relays

**Owner, 2026-08-17.** Recorded because I misread it as a defect and nearly "fixed" it.

`selfRegister()` (`src/steward.src.js`) loops over `CANONICAL_RELAYS` as well as the console's own base, so a
newly created church announces itself to `app.trinityone.church` and the ts.net fallback. Measured: a8 went
from 18 churches to 22 during one session of simulation setup.

**That is intended.** The open T1 relays exist to support churches that cannot easily run their own, and
self-registration is how such a church gets somewhere to live without an operator doing anything. Test and
simulation churches accumulating there is a housekeeping matter — they clean up easily — not a design problem.

It is also NOT a contradiction of FEDERATION-PLAN principle 4 ("visibility is a choice"): that principle is
about a church ADVERTISING a relay or publishing a relay list for discovery, which stays opt-in. Registering
with a relay so it will accept your writes is a different act.

**Do not "fix" this.** If it is ever revisited, the question is not whether to stop it but whether a
self-hosted church should be able to opt OUT of the canonical registration — and that is a preference, not a
correctness issue.

**What WAS a real defect, and is fixed:** `selfRegister` judged success as "did anybody accept?", so a church
whose OWN relay refused (403) still saw `ok: true` because a canonical relay had taken it. The steward was
told nothing and lost seventeen setup writes. It now judges the relay the church is actually pointed at. The
broadcast is untouched.

---

## 5. NEXT UP — owner asks, 2026-08-17

**Build these next.** Numbers 2-4 were asked for in a previous session and did not get built; recording them
here so that cannot happen twice.

### 5a. Network content is NOT encrypted (DECIDED)

Measured 2026-08-17: a network's events are sealed by `_sealChurchDoc` under a CHURCH name key, but a member
opens them with `_openChurchDoc(networkPub, …)`, which needs a name key for the NETWORK — and there is none
(zero `namekey:<networkpub>` documents exist, and nothing would ever publish one). So deanery events are
published, stored, and permanently unreadable by every member. Announcements escape this only because they
are plain kind-1.

Owner's decision: **leave network content unencrypted.** It is the right answer on the merits too — a network
noticeboard is deliberately the least private thing in the product, meant to be read ACROSS churches, so
sealing it under any single church's key cannot work by construction.

### 5b. Swipe to reply, in chat

Not built. There is no `swipe` handler anywhere in `app/screens-chat.jsx` (it exists in the Bible reader and
the serving screens, which is probably why it was believed done). Reply today is: tap the "…" on a bubble,
then Reply.

### 5c. More reactions — a laugh and a thumbs up

The reaction set needs 😂 and 👍 alongside what is already there.

### 5d. Reply privately

From a message in a group, reply DIRECTLY to whoever wrote it, as a private message rather than to the room.
`sendDM` already exists on the member side; this is the entry point and the carried context (the quoted
message) rather than new plumbing.

Worth stating the safeguarding question BEFORE building 5d: this creates a one-tap path from a group room to
a private conversation with a stranger. The relay already restricts DMs to a minor — only the child, adults on
the cleared list, and the child's guardians may contact them — so the gate exists. But the BUTTON must not
appear where the DM would be refused, or a member taps "reply privately" to a 13-year-old and gets a silent
failure. Ask `safeguardAllows` (or the same check the DM screen uses) before offering it.

### 5e. NEXT SIM: a steward agent must fill the church with content

**Owner ask, 2026-08-17.** Every round so far has stood up a church that is technically correct and
*editorially empty* — no sermons, no notices, no posts, no pictures, no reading plans. So every actor spends
their attention on empty states, and the round reports "no groups yet" instead of finding what breaks when
there is something to break.

Next round: give one agent the STEWARD CONSOLE and the brief a pastor would have — write the week's notices,
upload a sermon, post to the announcements channel, set up the rota, add a reading plan, put photos on the
church profile. Do it BEFORE the members arrive, the way a real church would.

It also exercises the console itself, which no actor has ever driven: everything the console does in these
rounds so far has been driven by me from the command line.


---

## 6. DECIDED 2026-08-18 — the relay model, and three safeguarding calls

### 6a. P1: NOBODY picks relays — everything defaults to the public T1 set, rules published to all of it

**Owner, reframed twice, final form: the CHURCH should not have to choose either.** Neither member nor church
selects relays. There is a default set of public TrinityOne relays (`CANONICAL_RELAYS`); the console and every
member use that same set automatically; and the church's rules (block, minors, approved, guardians, group
definitions) are published to ALL of them so each enforces from its own copy.

THE ACTUAL BUG, correctly scoped. The console's relays() fans out to the public set only when
`own === CANONICAL_RELAY` (steward.src.js). So:
- a production-default church (own = app.trinityone.church = canonical) DOES fan out to all canonical relays,
  members use the same set, and the rules reach every relay — this case already works;
- any church whose own relay is NOT exactly the canonical one — a self-hoster, a dev box, the tailscale
  funnel — publishes governing docs to that one relay only, while members still read from the public
  canonical set. That is the divergence measured on 2026-08-18 (banned member read from two canonical relays
  the funnel-based console never published the block to).

CORRECTION TO WHAT I TOLD THE OWNER: I called that ban-divergence "live on a8". It is not, for a normal
production church — a8 IS canonical, so its console fans out and members match. The divergence needs the
console to sit on a DIFFERENT relay than the members' canonical set, which is a dev/self-host/funnel topology,
which is exactly what the sim used. The fragility is real; the production-default risk I stated was overstated.

THE FIX (one change, no per-church or per-member choice):
1. **Publish governing documents to the full public relay set unconditionally** — the union of the console's
   own relay and CANONICAL_RELAYS — not gated on `own === CANONICAL_RELAY`. This makes the rules reach every
   relay a member reads from, in every topology, without anyone choosing anything.
2. Members keep using the canonical public set (already do). No member-facing relay UI, by design.
3. Fix the loopback advertisement (kind-10002 says `127.0.0.1`) as hygiene — it is what made the divergence
   invisible — but it is no longer load-bearing under this model, because the set is well-known, not
   per-church-advertised.

The genuinely self-hosted PRIVATE church that does NOT want its traffic on public relays is the documented
exception (opt-in), consistent with ROADMAP §4 (open relays support churches that cannot self-host; public
self-registration is intended).

### 6b. P2: the block list stays cleartext (owner). It is `{"pubkeys":[...]}` on the relay. Sealing it is
possible but the owner judged it unnecessary — a list of excluded pubkeys is lower-sensitivity than the
membership/care/name data, which stays sealed.

### 6c. P3: no member-facing report/block for the pilot (owner). These are churches; a member who is being
abused goes to a steward, who has the tools. Revisit as a feature AFTER the pilot, not before.

### 6d. Child-account creation has no age gate — NOT a safeguarding hole. Verified 2026-08-18: a self-created
child account publishes a join REQUEST and sits unadmitted. The relay's effectiveMember gate refuses a
non-admitted key in an approval-gated church, so the account can read and post nothing until a steward admits
it. "A 15-year-old joined the church" was "a 15-year-old asked to join". The steward approval gate holds.
Worth a cosmetic tidy (the wizard could say "this creates a request"), not urgent.

---

## 7. HIGH PRIORITY — a relay needs a MODE, because "no churches" currently means three different things

**Raised by the owner, 2026-08-19, after a purge was refused.** Plan this properly before building; it touches
the relay's authorization spine.

### What happened
Trying to remove the last church from a8 returned:

> ✗ that is the only church on this relay — removing it would let anyone on the internet write here. Add
> another first, or turn the relay off.

The guard is real: `accept()` opens with `if (!CHURCH_PUBS.size) return true;` (`scripts/gateway.mjs:1452`),
and the media download gate does the same (`:204`). **An empty relay accepts writes from anyone and serves
blobs to anyone.** So removing the last church silently flips a gated relay into an open one, and the guard
exists to refuse that rather than to express a policy.

### The actual root cause — one state, three meanings
`CHURCH_PUBS.size === 0` is currently the answer to three unrelated questions:

| What it can mean | What the relay should do |
|---|---|
| a GENERIC relay (the original standalone product — no console, no church scoping) | accept, that is its normal state |
| a church relay NOT SET UP YET | accept exactly one registration (bootstrap), then close |
| a church relay DELIBERATELY EMPTIED | accept nothing at all |

The owner's history explains the fossil: **the first relay app was standalone, with no church console
attached.** "No churches configured" meant "plain relay" and open was correct. Once the console attached and
churches became the unit of authority, that same line stopped being a mode and became a hole.

### What is and is NOT drift
Registration policy is INTACT and matches the intended architecture — public vs private governs the second
and subsequent churches:

* empty + not invite-only → the first fresh key self-registers, **regardless of public/private** (bootstrap)
* has a church + private (`offerHosting` off) → refused, "already set up for its church"
* has a church + community (`offerHosting` / `RELAY_OPEN`) → accepted, up to `CHURCH_REPLACE_CAP`
* `inviteOnly` → refused always, even the first

Defaults: `inviteOnly: false`, `offerHosting: false` (`gateway.mjs:99`). The single-church lock was ADDED by
RELAY-AUDIT-2026-07-20 H4 precisely because leaving self-registration open forever turned one box into 19
tenants. See also note 4 — self-registration onto the canonical relays is intended, not a defect.

So the drift is narrower than it first looks: **the empty state**, not the policy.

### Why it matters now
1. **A wiped relay is open on a public address** until a church registers — and the first key to arrive claims
   it. That window is real for any reset of a8.
2. **De-provisioning is impossible by design.** A single-church relay cannot be emptied at all, so a church
   cannot leave a relay it no longer trusts, and an operator cannot decommission cleanly.
3. It blocks the **self-service purge** the owner asked about (2026-08-19): a church erasing itself from a
   single-church relay IS this case.

### Shape to consider (NOT a decision)
Record the mode explicitly at install rather than inferring it, plus one persisted "provisioned at least
once" bit:

* **home** — one church, closes after bootstrap; emptied ⇒ fails CLOSED
* **host** — many churches, capacity-capped; the "run a relay to support the T1 network" role; empty ⇒ ready
  but still closed to writes
* **generic** — no church scoping, the original standalone behaviour, chosen deliberately and never inferred

Then: empty + provisioned = closed, de-provisioning becomes ordinary, the last-church guard disappears, and
the purge question has an answer.

### DECIDED by the owner, 2026-08-19 — build to these
1. **Host relays self-register, and the operator chooses.** Self-registration is the default way a church
   lands on a host relay, but *how* is the relay runner's call — a setting, not a fixed policy. So the mode
   carries a registration style (open / invite / allowlist) rather than hard-coding one. "Anyone can run a
   relay to support the network" means the operator sets the terms of their own box.
2. **De-provisioning KEEPS the data.** Removing a church stops the relay serving it; erasing is a separate,
   explicit act by the relay. `/config removeChurch` already separates `confirm` from `purge` — preserve
   exactly that distinction and default to keep. (Note the consequence for the self-service purge idea: a
   church can leave, but only the relay operator can erase.)
3. **Nothing changes on upgrade.** An existing relay must behave identically the moment it is updated —
   infer the mode from what is already true (has churches ⇒ home; empty ⇒ generic) and record it, rather than
   asking an operator mid-flight or changing a live relay's answer to any request.
4. **The installer ASKS.** Provisional — "unsure, let's go with asking for now". So the question is worth
   designing to be answerable by a non-technical operator (what is this box for?), and worth revisiting if it
   proves to be a step people click through blindly.

**Owner also: "we will definitely audit and test this like crazy."** It touches accept()/canRead()/the
registration routes — the same spine as the two cross-tenant CRITICALs this repo has shipped. Own branch,
adversarial audit before merge, and a relay-restart test in the suite (replay ordering already bit once here).

### Still open
* Exactly which registration styles a host relay offers, and what a church sees when refused.
* Whether "generic" (no church scoping) survives as a supported mode or is retired — it is the fossil the
  whole item is about, and keeping it means keeping an open-write branch in accept().

### Related, same root
Rota visibility is enforced per-relay (see the 2026-08-18 rota work): a church that narrows its rota is only
protected on relays running the new code. A relay MODE does not fix that, but the same conversation —
"what is this relay, and what does it promise?" — should settle how a church learns which of its relays
actually enforce its choices.

---

## 8. A young person is protected silently — tell them, and tell the church

**Owner, 2026-08-19, from round 3. After the sim.**

Measured in the round: a 15-year-old member saw **23 of 26 people marked "Restricted"** and could message only
the three cleared adults. The safeguarding gate works exactly as designed. What it never does is explain
itself — no badge on her own profile, no age indicator, no help text, and tapping a restricted person does
nothing at all. Her own words: *"A young person might think the app is broken, not that it's protecting
them."* From the other side, an uncleared adult's messages to two teenagers simply never left his phone.

**What to add.** Something on a child account that says, in the app's own voice, that it is a young person's
account and what that changes — and a reason at the point of refusal ("you can message your leaders; ask
Marcus if you need someone else") rather than a dead tap.

**The care to take.** This is safeguarding UX under the project's threat model, so the wording has to protect
rather than expose: a badge visible to OTHER members would broadcast which accounts are children, which is
the opposite of the goal. The indicator belongs to the young person and their guardians, and the refusal
message belongs to whoever hit it — not to a list anyone can browse. See [[uk-pilot-threat-model]] and the
existing rule that `minors:` is never served to ordinary members.

Related, same round: a linked parent sees NOTHING anywhere telling them the link exists.
