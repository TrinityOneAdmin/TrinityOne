# Relay discovery and inter-relay comms — what to harden after the pilot

Written 2026-09-01, from the running code. **Read this before designing anything here: more exists than a
fresh reader expects, and the useful work is hardening, not building.**

## What already exists (measured, not assumed)

| Capability | Where | State |
|---|---|---|
| Relay identity key | `gateway.mjs:524-526` — persistent `RELAY_PUB`, generated once, `0600` | built |
| Human-carryable relay name | `relayPetSlug()` — deterministic adjective-noun-number from the pubkey | built |
| Relay directory + claim | `/relay-names/claim`, `/relay-names/offers`, NIP-98 signed | built |
| Directory gossip | `DIRECTORY_PEERS` mirrored via `/relay-names/sync?since=` | built |
| Event replication | `/sync`, `/sync-digest`, `/sync-ids`, `/sync-events` | built |
| Media replication | `/sync-media`, blob index per church | built |
| Peer authorisation | a church authorises a relay's pubkey as a trusted sync peer; peers authenticate with a relay-signed NIP-98 bound to url+method+church (`:238`, `:527`) | built |
| Client discovery | directory offers ∪ `CANONICAL_RELAYS` ∪ church extras (`steward.src.js:812`) | built |
| Relay lists on the wire | kind `10002` accepted (`:2521`) | built |

So: identity, naming, directory, gossip, authenticated pull-sync and per-church peer authorisation are all
there. What follows is where it is thin.

---

## The five weaknesses, worst first

### 1. Discovery has a single well-known host — `CANONICAL_RELAYS` is hardcoded

`src/steward.src.js:542` pins `app.trinityone.church` as primary with one tailnet fallback. Every fresh
install starts there. **Under this project's own threat model — lawful compulsion, seizure, national
blocking — that is the first thing an adversary takes away**, and it takes away *joining*, not just serving.
An existing member with a cached relay list keeps working; a new member cannot start.

**Harden:**
- **Make the church's own signed relay list the authority, not the app's default.** A kind-10002 list signed
  by the church key is already accepted; treat the built-in list as a *seed of last resort*.
- **Put several relays in every join artefact.** The join link and QR should carry 2–3 relay hints plus the
  church pubkey, so a poster on a noticeboard is itself a bootstrap that survives one host disappearing.
- **Bootstrap over more than one transport.** A relay reachable only over ordinary DNS+TLS is reachable only
  where that is allowed. The pet-name slug already gives a human-carryable identity; pair it with a
  resolution path that does not depend on one domain.

### 2. A client cannot tell "nothing there" from "not served"

Every gate default-denies and an unauthenticated read returns nothing. That is correct, and it means
**a relay can withhold events silently and look identical to a relay that simply has none.** Today a
compelled or hostile relay can drop a safeguarding document, a care request, or one member's messages, and
no client notices.

**Harden — this is the highest-value item on the list:**
- **Signed completeness digests.** `/sync-digest` already exists for peers. Let a *client* ask the same
  question: "for this church, at this point in time, what is your digest?" A relay signs the answer with its
  identity key. Two relays that disagree are visible; a relay that quietly drops a document can no longer do
  so without producing a signature that contradicts its peer.
- **Publish-receipt checking.** A client that published to three relays should be able to confirm all three
  still hold it, rather than assuming.

### 3. Peer authorisation is manual and does not propagate

A church authorises each sync peer by pubkey. Good — the church stays the authority. But it means a church
that adds a second relay must configure both ends, and a relay joining later has no way to learn the set.

**Harden:**
- **A church-signed peer set** published as an ordinary church document, so both relays converge on the same
  list from the church's own signature rather than local configuration. Keep the authority with the church;
  remove the manual step.
- **Deliberately NOT automatic peer discovery.** A relay that adopts peers it discovered is a relay an
  attacker can introduce peers to. The church signs, or it does not happen.

### 4. Failure domains are counted by URL, not by box

Two URLs can be the same machine. The relay already exposes `relayPub` for exactly this reason, and there is
a recorded trap where the client pool keyed relays by normalised URL and a raw lookup missed silently.

**Harden:** count self-sufficiency and redundancy by **`relayPub`, never by URL**, everywhere it is reported
to a steward. A church told it has "3 relays" that are one box in one building has been told something false,
and it is the kind of false that only matters on the day it matters.

### 5. Sync cost is unbounded at scale

Two findings remain open and scale-gated: tag-scan truncation, and a crafted-`REQ` denial of service. The
tag index that would have closed them was reverted. Set reconciliation over `/sync-ids` will meet the same
wall as a church's history grows.

**Harden:** bound reconciliation by time window and document type before it is needed, and re-land the tag
index with the test that caught its regression. Do this *before* churches have years of history, not after.

---

## What NOT to do

- **Do not make relays trust each other by default.** Every trust edge here runs through a church signature.
  A mesh of relays that trust each other is a mesh where one seizure poisons the set.
- **Do not centralise discovery to fix discovery.** A directory that everyone must reach is the same single
  point of failure as a canonical relay, wearing a different hat.
- **Do not add automatic peer adoption**, however convenient — see 3.

## Suggested order

1. Failure-domain counting by `relayPub` — small, and stops a false safety claim being shown to stewards.
2. Multi-relay join artefacts + church-signed list as the authority — closes the joining-under-blocking hole.
3. Signed completeness digests for clients — the only real defence against silent withholding.
4. Church-signed peer sets — removes the manual step without moving the authority.
5. Bounded reconciliation + the tag index — before scale forces it.

Items 1 and 2 are pilot-adjacent and could land early. Items 3–5 are post-pilot by nature: they need more
than one relay per church in the field to be worth testing honestly.
