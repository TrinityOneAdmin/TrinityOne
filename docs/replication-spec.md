# Church-data auto-replication — design spec

**Goal:** every church's data continuously mirrored to ≥2 relays the church trusts, so a relay
being **seized, blocked, or lost** costs the church *nothing* — members reconnect to a mirror and
carry on; the returning relay catches up.

**Primary constraint (this spec's focus):** it must **not** bloat the mirrors. Full 1:1 copies of
everything (esp. media + chat history) on N relays is unacceptable. Bloat control is tiered below.

---

## 1. What already exists (we build on, not from scratch)

- **Per-church attribution** in the event store (`church` tag; `exportChurch`, `exportChurchSince(cp, since)`).
- **Trusted-relays list** — church-signed `d=trinityone/relays`, content `[{pubkey,url}]`. Defines *which*
  relays a church trusts (its home + backups).
- **Resync gate** — a relay authenticates to a peer's `/sync` with a relay-signed NIP-98 proof
  (`relayProof`); the peer serves the full corpus only to a relay in the church's trusted list.
- **Write policy / allowlist** (`CHURCH_PUBS`) — a relay only hosts churches it agreed to.
- **Signed, immutable events** — merge is conflict-free (union by id; replaceable = latest-wins).
- **Federated relay directory** (just shipped) — name→url + gossip; the same self-verifying-record
  pattern this reuses.

So the plumbing is ~70% there. What's missing: **continuous, automatic, bounded** replication.

---

## 2. Mutual consent — who replicates a church

A relay R replicates church C **iff both are true**:
1. C lists R in its trusted-relays list (`RELAYS_D`) — *the church trusts R*.
2. C is in R's `CHURCH_PUBS` allowlist — *the operator agreed to host C* (or C self-registered on an
   offer-open relay).

Both sides consent, both signed. R discovers C's *other* trusted relays from C's `RELAYS_D`, and
replicates against them. No central coordinator.

---

## 3. The anti-bloat core — replication tiers by event class

Not everything replicates the same way. Classify every event; replicate per its tier:

| Tier | What | Replicate? | Retention on a mirror |
|---|---|---|---|
| **Durable** | church identity, groups, funds, plans, rota, rooms, categories, roles, **member roster**, blocklist, admitted-list, network membership, finance journal | **Full, always** | Forever (bounded by church *structure*, not activity — small) |
| **Messages** | chat, reactions, DMs, threads | **Yes, windowed** | Rolling window: `retentionDays` (default **90**) or last-N-per-group, whichever first |
| **Media (blobs)** | sermon audio/video, images | **Reference-only by default** | The *event* replicates (tiny); the *bytes* do **not** eagerly. Fetched on demand from a peer that has them (content-addressed → verifiable), cached under the mirror's per-church cap |
| **Ephemeral** | kind 20000–29999, typing, presence | **No** | Never stored (NIP-01) |

**Why this kills bloat:**
- Durable state is what makes a mirror able to *serve* the church — and it's small (structure, not
  history). This is the 90% of the value at 5% of the bytes.
- Messages are the volume; a **rolling window** caps them. A mirror holds recent chat (enough for a
  member who fails over to keep talking); deep history stays authoritative on whichever relay chooses
  to keep it. Window is per-relay configurable — a beefy home relay keeps 2 years, a cheap VPS mirror
  keeps 90 days.
- **Media is the real bloat risk** and is handled hardest: mirrors store the *reference*, not the
  bytes, and lazily fetch a blob only when a member actually requests it — then subject to the
  per-church media cap. Content-addressing means one physical copy per hash regardless of how many
  churches/events point at it (natural dedup).

---

## 4. Additional bloat controls (knobs)

Per **relay**:
- `replication.maxChurches` — cap how many churches this box mirrors (ties into the offer cap).
- `replication.totalBytesCap` / total-events cap — hard operator ceiling (extends today's `MEDIA_CAP`).

Per **church, on a mirror**:
- `messageRetentionDays` (default 90) — rolling chat window.
- `mediaPolicy`: `none | ondemand | full` (default **ondemand**).
- `perChurchByteCap`, `perChurchEventCap` — when hit, cull oldest *messages* first; **never** cull
  durable state (structure/roster/records stay complete).

Structural anti-bloat (automatic):
- **Replaceable/addressable collapse** — keep only the latest version of kind 0 / 3 / 10000–19999 /
  30000–39999 per (pubkey, d-tag). Old versions never replicate. (Store already collapses these.)
- **Content-addressed dedup** — blobs keyed by SHA-256; shared across churches/events; one copy.
- **Incremental sync on the wire** — only deltas move (see §5), so replication is bandwidth-cheap
  (matters over a thin pipe).

---

## 5. Mechanism — incremental, pull-based, signed

1. **Cursor per (church, peer):** each relay stores the highwater `created_at` (or event count) it has
   synced from each peer for each church.
2. **Sync loop:** on a timer (e.g. every 60–120 s, jittered), for each hosted church C, for each of
   C's *other* trusted relays P:
   - `GET P/sync?church=<cp>&since=<cursor>` with a relay-signed NIP-98 proof.
   - P returns only C's events with `created_at > since`, filtered to the replicable tiers (P won't
     serve raw blobs here — only references).
   - Merge (union by id; replaceable latest-wins); advance cursor; apply retention/caps.
3. **Low-latency option (Phase C):** primary *pushes* a lightweight "new events since T" nudge to
   mirrors so they pull immediately, instead of waiting for the timer. Pull remains the source of
   truth; push is just a hurry-up.
4. **Media on demand (Phase B):** when a member asks a mirror for blob `<sha>` it doesn't have, the
   mirror fetches it from a peer that advertises it (blob-availability piggybacks on the directory
   gossip), verifies the hash, caches it under the per-church cap, serves it.

Authorization reuses the existing resync proof — **only a relay in the church's trusted list can pull
the corpus**, so replication never leaks a church's data to an untrusted relay.

---

## 6. Consistency & failure/rejoin

- **No conflicts:** events are immutable + signed; replaceable events resolve by `created_at`. Merge is
  a CRDT-style union — same guarantee as the directory gossip. Order-independent, exactly-once by id.
- **Relay offline → back:** it pulls the delta since its cursor from the mirrors; nothing sent while it
  was down is lost.
- **Member failover:** the client already carries the church's relay list, so when the primary is
  unreachable it connects to a mirror and gets durable state + recent messages immediately. (Media may
  lazy-load.)
- **Seizure:** a seized relay's data is already on the mirrors; the church rotates it out of its
  trusted list (signed) and the network stops trusting it.

---

## 7. Phasing (ship incrementally, each independently useful)

- **Phase A — durable-state replication.** Continuous sync of Tier-1 (durable) + windowed messages
  between trusted relays. Media reference-only. *This alone makes a mirror able to fully serve a church
  and survive the primary dying — the seizure-resistance win, at minimal bloat.*
- **Phase B — on-demand media.** Blob-availability advertising + lazy cross-relay fetch, capped.
- **Phase C — push-nudge + retention tuning UI.** Lower latency; operator controls in the relay panel.

---

## 8. Decisions for the operator/church (surfaced in the relay panel)

- Default message-retention window on a mirror (90 d proposed).
- Default media policy (`ondemand` proposed) + per-church + total caps.
- Whether a relay auto-mirrors *every* church it hosts, or only ones flagged "keep a backup."
- Max churches / total bytes a public relay will replicate.

---

## Bloat, summarized

A mirror's cost for a church ≈ **its durable structure (small, fixed) + a rolling window of recent
messages (bounded) + zero media by default (references only, lazy + capped)**. That is a small,
*bounded* footprint per church — you can mirror many churches on a modest box, and no single church or
its media can run a mirror out of disk. Redundancy where it matters (the irreplaceable structure +
recent conversation), thrift where it doesn't (deep history + big media stay where they're wanted).
