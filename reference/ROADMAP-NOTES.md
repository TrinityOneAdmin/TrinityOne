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

