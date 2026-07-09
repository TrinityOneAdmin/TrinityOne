# Relay resilience & church-data backup — design

**Status:** design / not yet built · **Owner:** TrinityOne · **Relates to:** [`FEDERATION-PLAN.md`](FEDERATION-PLAN.md), `docs/guides/RELAY-SETUP.md`

## Why this matters

TrinityOne's core promise is that **a church owns its data and can walk away with all of it**. Two gaps
currently undercut that, and they bite hardest exactly where the product is aimed — the persecuted church and
places with intermittent power, connectivity, and hardware:

1. **Relays don't reconcile.** The app writes every event to *all* of a church's relays and reads from all of
   them, so as long as one relay is up, members never notice an outage. But the relays **never catch each other
   up** — a relay that was asleep (office-hours-only, power cut, seized-and-restored) permanently misses whatever
   was posted while it was down. No single node is a guaranteed complete record.
2. **No first-class backup.** A church can't yet take a complete, portable copy of its own data, and nothing
   reminds a steward to. If the shared pool and the church's hardware both fail, the record can be lost.

This document specifies **relay resync**, a **recommended relay topology**, and **church-data backup** (export +
reminders) as one coherent resilience story.

## Design principles

- **Content-addressed = convergence for free.** Every Nostr event is identified by a hash of its signed
  contents. Syncing two relays is therefore *set reconciliation*: "send me the IDs you have that I don't." No
  consensus, no conflict resolution, no ordering problem — two relays that sync always converge to the same set.
- **Church infra is mutually trusting, but read-gates are sacred.** A church's own relays enforce the same
  membership + safeguarding rules, so they may hold the church's full corpus. A relay that is *not* trusted
  church infrastructure must only ever receive **public** church content (see Safeguarding, below).
- **Sovereignty over convenience.** Backups go to storage the *church* controls (a local file, or the church's
  own cloud bucket) — TrinityOne never becomes a custodian of the backup.
- **Thin-pipe first.** Every mechanism must be cheap over a slow, unreliable link: incremental, resumable,
  and paced — never "re-download everything."

---

## Part 1 — Relay topology (recommendation)

The right answer is not a fixed number of relays; it's **diversity + an always-on backbone + resync**. Guidance
we should bake into the relay-setup wizard and docs:

| Role | What | Why |
|------|------|-----|
| **Always-on backbone** | 1 relay that is (near-)always up — a cheap VPS, ideally **out of region**, or the shared TrinityOne pool | The continuous read/write target when local nodes sleep; out-of-region also resists local seizure/censorship |
| **Local / community node** | 1+ relays on church or member hardware | Sovereignty, and keeps the community working over LAN when the wider internet is cut |
| **Offsite copy** | at least one node (or a backup, Part 3) physically elsewhere | Survives fire/flood/seizure of the building |

This mirrors the classic **3-2-1 backup rule** (3 copies, 2 kinds of media/host, 1 offsite) — a good instinct
for records a church can't afford to lose. So **"3 relays" is a sensible durability target**, *provided* they are
**diverse** (different location/power/network) and **resyncing**. Three relays in one building on one power feed
is one relay wearing three hats; and three part-time relays *without* resync just accumulate three different sets
of holes. **Resync (Part 2) is the enabling feature** — without it, adding relays does not buy consistency.

Practical default we should recommend: **one always-on out-of-region backbone + one local node + resync**, with
"add a third diverse node" offered as belt-and-braces for churches that want maximum durability.

Existing building blocks: per-church relay lists already exist (church-signed NIP-65 `kind:10002`,
`relaysForChurch()` in `src/fellowship.src.js`); a church already registers relays it controls
(`registerWithRelay`, `autoPickRelays`).

---

## Part 2 — Relay resync

Make a church's relays **eventually consistent**: any relay, once reachable, converges to the church's full set.

### Peers & scope
- A relay syncs **per church**, with that church's **other relays**, discovered from the church's signed relay
  list (`kind:10002`) plus an operator-configured peer list.
- Only **trusted church peers** exchange the *full* corpus (public + gated). See Safeguarding.

### Triggers
- On relay **startup** and on **reconnect** to a peer.
- On a **timer** (e.g. every N minutes), jittered.
- On demand (a steward "Force sync now" from the console; useful after bringing a node back online).

### Protocol
- **v1 — pull-since-cursor (ship first, simplest):** the relay keeps a per-peer, per-church cursor (last-synced
  `created_at` + a small overlap window). On sync it `REQ`s that peer for the church's events since the cursor,
  stores anything whose ID it doesn't already hold (the store dedupes by ID for free — see `event-store.mjs`
  `put()`), advances the cursor. Idempotent and resumable.
- **v2 — negentropy set-reconciliation (NIP-77):** compare event-ID sets by exchanging compact range fingerprints
  and transfer only the true difference. Far cheaper than a timestamp sweep on a large history and ideal for thin
  pipes / long outages. Add once v1 is proven.

### Correctness details (get these right)
- **Deletions must propagate.** A NIP-09 `kind:5` retraction is itself an event — sync must carry kind-5s and
  **apply** them on receipt (delete the referenced own-authored events), exactly as the live path does now, or a
  message someone deleted will resurrect on the next sync. The deletion "wins" and stays deleted.
- **Retention interaction.** The relay culls old *ephemeral* events per church (`event-store.mjs` `cull()`,
  keeping structured docs forever). A relay must not endlessly re-pull events its peer has already culled — the
  cursor plus symmetric retention handles this; document the window so retention policies match across a church's
  relays (mismatched windows = perpetual churn).
- **Media blobs.** Chat/docs sync as events, but self-hosted **media** are content-addressed blobs, not events.
  New uploads already mirror to backup hosts at write time (`uploadBlob(..., mirrors)`); **existing** blobs on a
  woken node need a blob-manifest sync (compare sha lists, pull missing bytes). Large — pace it, and treat it as a
  distinct pass from the event sync.
- **Convergence, not ordering.** Because IDs are content hashes, order of arrival is irrelevant; the set is what
  converges. No clock sync required.

### Safeguarding & auth (the hard, non-negotiable part)
Some events are **read-gated** (safeguarding lists — who is a minor / cleared adult / guardian; invite-only group
messages; NIP-42-gated content). A sync must never hand these to a relay that won't enforce the gate.

- **Trusted-peer proof.** A relay proves it is the church's own infrastructure before receiving gated content —
  e.g. it is registered/authorised **by the church key** (the same authority that already gatekeeps writes), or
  presents a church-issued sync credential. Untrusted peers receive **public church content only**.
- **Enforcement travels with the data.** A gated event only ever lands on a relay that will re-apply the same
  read-gate (`canRead()` in `scripts/gateway.mjs`). We do **not** replicate the plaintext minors list to a
  generic public relay. Where content is already end-to-end encrypted (group keys, DMs), syncing ciphertext is
  safe regardless — the gate protects the *cleartext* lists and invite-group plaintext.
- This is the main reason resync is a real project and not a weekend hack — the auth model between relays must be
  designed before code.

---

## Part 3 — Church-data backup (export)

A first-class **"Back up church data"** action in the steward console: a complete, portable, church-controlled
copy — the concrete expression of "you can walk away with everything."

### What's in a backup
- **All church events:** chat (`kind:1`), the addressable church docs (`kind:30078` — groups, plans, devotionals,
  rota, finance journal, safeguarding lists, sermons metadata, etc.), member `kind:0` profiles, relay list.
- **Media blobs:** the content-addressed audio/video/doc files (optional / sized — a steward may back up
  "records only" vs "records + media").
- **A manifest:** church pubkey, export timestamp, event + blob counts, schema version — self-describing so it can
  be restored or audited later.

### Format & confidentiality
- **A signed, self-describing archive** — e.g. newline-delimited JSON of the raw signed events + a `blobs/`
  directory keyed by sha, zipped. Because events carry their signatures, a backup is **self-verifying** and can be
  re-imported into any relay (the store already has `importAll()` for exactly this — reuse it for restore).
- Encrypted content stays **ciphertext** in the archive by default (the church key can decrypt on restore). Offer
  a **"decrypt to a readable copy"** option (church-key-only) for a human-readable archive the church can keep —
  clearly warned as unencrypted-at-rest.

### Where it goes
- **Local file** — a download / save-to-device from the console (works offline; the steward keeps it).
- **Church-controlled cloud (optional)** — the church's *own* bucket (S3 / Backblaze B2 / Google Drive, etc.),
  credentials held by the church. **Never** a TrinityOne-held store — that would break the no-custody ethos.
  Encryption + explicit consent required before any bytes leave the device.

### Restore
- Re-import an archive into a fresh relay (`importAll()`), or into the app to seed a new church node — so a church
  can **stand a new relay back up from a backup** after losing all its hardware. Restore is the other half of the
  promise and must be tested end-to-end, not assumed.

---

## Part 4 — Backup reminders (steward setting)

Backups only help if they happen. A gentle, church-toned nudge — never nagging.

- **Setting:** in the steward console, "Remind me to back up" → *Off · Weekly · Monthly* (default Monthly).
- **Tracking:** store `lastBackupAt` (a church doc so it's consistent across a steward's devices / multiple
  stewards, not just one phone's localStorage).
- **The nudge:** when a backup is overdue, show a calm card in the console ("It's been 5 weeks since you saved a
  copy of your church's data — [Back up now]") that leads straight into the Part 3 export. Not a modal, not a
  blocker; dismissible, reappears next cycle.
- **Honesty:** the reminder should say plainly *why* — "so your church always holds its own complete copy, even
  if a relay is lost." Ties the chore to the value.

---

## Suggested phasing

1. **Backup export (local file) + reminder setting.** No relay changes; high value immediately — a church can
   hold its own complete copy today. Reuses `event-store` export/`importAll`. **Do first.**
2. **Resync v1 (pull-since-cursor) between trusted church relays** + the trusted-peer auth model. Makes a woken
   node converge. Requires the relay-auth design up front.
3. **Negentropy (NIP-77)** for efficient sync over thin pipes / long outages; **cloud backup targets**
   (church-controlled) for export.
4. **Topology guidance in the relay wizard** ("add an out-of-region backbone", "add a sync peer") + blob-manifest
   sync for existing media.

## Open questions / risks

- **Inter-relay auth** is the crux — how a relay proves it's trusted church infra to receive gated content.
  Options: church-key-signed peer registration vs. a church-issued sync credential. Decide before Phase 2.
- **Thin-pipe pacing** — sync (esp. blobs) must yield to live traffic and be resumable; negentropy is the real fix.
- **Cloud backup consent/encryption** — sending church data to any third party (even church-owned) needs a clear
  consent + client-side encryption story.
- **Retention parity** — a church's relays should share a retention window, or resync churns on culled events.
- **Restore fidelity** — must be tested: a backup that can't actually rebuild a relay is a false promise.
