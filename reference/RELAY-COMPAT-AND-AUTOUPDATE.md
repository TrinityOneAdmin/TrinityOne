# Relays: staying compatible, and updating themselves

Written 2026-08-31, before the pilot. Two connected problems: **relays and apps will run different versions
at the same time**, and **an operator should not have to update by hand**. The second is nearly built; the
first is barely started, and it is the one that can lose data.

---

# Part A — backwards compatibility

## Why this is harder here than in most products

Three properties of this system make version skew unusually dangerous:

1. **The relay rehydrates ALL history on every update.** Every stored event is replayed through the current
   ingest code. So a change to ingest is not "from now on" — it is retroactive over everything a church has
   ever published. (Owner, 2026-08-25.)
2. **A write gate is not a retention rule.** Replaying the write gate over an import once DELETED a whole
   finance journal and everyone who had left the church. `store.del()` leaves no tombstone, so a sync could
   not undo it.
3. **Churches hold their own data on their own relays.** There is no central migration. A relay may be
   months behind, be restored from a backup, or join the church's list long after the documents were written.

## The rule, stated once

**Add, never repurpose.** A `d`-tag, an event kind, a tag name, or a content field, once published, means
what it meant. If the meaning must change, use a new name and keep serving the old one.

Corollaries that are not obvious:

- **A missing field must mean the safe thing.** Old documents have no new field; whatever the code does with
  `undefined` is what it does to every document written before today.
- **A new gate is retroactive.** Before adding one, state what it does to documents that predate it. "It
  hides them" may be right (safeguarding) or catastrophic (finance).
- **Stricter is not automatically safer.** Withholding data an older client depends on can break a church
  that has done nothing wrong.
- **The client picks the winner.** Addressable documents keep one copy per author, so a newer client and an
  older one can disagree about which copy wins. Changing a tiebreak is a compatibility change.

## The five surfaces, and what to check on each

| # | Surface | The failure it produces | What must be checked |
|---|---|---|---|
| 1 | `d`-tag documents (kind 30078) and their content shape | a document the relay gates under one name and a client publishes under another | `scripts/trinity-doc-types.mjs` declares every type; `scripts/doc-registry.test.mjs` fails if a source file grows, loses or misspells one |
| 2 | Event kinds and tags | a new tag silently changes an audience | a request written before a tag existed must still route correctly — the `['aud', …]` tag got this right: older requests lack it and stay narrow, "the safe direction" |
| 3 | Relay gates (`accept` / `canRead`) | data becomes unreadable, or forged data becomes acceptable, retroactively | replay a frozen corpus (below) |
| 4 | Relay ↔ relay sync | two relays never converge, or one erases the other's history | run two versions side by side (below) |
| 5 | Client ↔ relay (NIP-42, REQ shapes, error strings) | "your app is too old" turned into "check your connection" — a member asking for help sent to look at their wifi | pin the strings a client matches on |

## The procedure — four concrete pieces, in the order worth building them

### A1. A frozen corpus, replayed every release *(highest value, build first)*

Capture a real church's document set — every `d`-tag, at least one document per type, written by the version
in the field — and commit it as a fixture. On every release, boot the new relay against it and assert:

- **nothing that was readable becomes unreadable** (per reader class: member, steward, church, minor, stranger)
- **nothing that was refused becomes accepted**
- **no document is dropped by ingest** — count in, count out
- **no `store.del()` fires during rehydration.** This is the finance-journal failure. Make it an assertion,
  not a hope.

This single test would have caught the two worst regressions in this repo's history.

### A2. A declared compatibility floor

The bundle already carries a build sha. Add two declared numbers alongside it:

- `wireVersion` — increments when surface 1–5 changes in a way an older peer must know about
- `minPeerWire` — the oldest wire version this build can talk to

A relay refuses to *auto*-update across a boundary where its peers would fall below `minPeerWire`, and says
so. A human can still force it. This is what makes Part B safe to switch on.

### A3. A two-version convergence test

Boot relay N and relay N+1, point them at each other, publish from both, and assert both hold the same set
and serve it to the same readers. Today nothing tests this, and replication is the surface where "add, never
repurpose" is easiest to break by accident.

### A4. Make the doc-type registry authoritative

`trinity-doc-types.mjs` says of itself: *"It does not replace the constants in gateway.mjs or the engines.
Rewiring the authorization spine to read from here is a behaviour-changing edit and is deliberately a
separate, later step."* That step is worth taking after the pilot stabilises, not before — but the five types
it found with **no relay rule at all** (`checkin:`, `groupkey:`, `msgtags`, `sermon:`, `wallet:`) should get
explicit rules first. They behave acceptably today by inheriting a generic rule nobody chose.

## What to write in a commit that touches any of this

The consumer list (rule 2), plus one line: **what this does to documents written before it**. If the answer
is "nothing, the field is absent and absence is safe", say that. If it is "they stop being served", that is
a decision needing the owner, not a detail.

---

# Part B — relays that update themselves

## What already exists (more than expected)

- The operator dashboard has an **"Update now"** button. It POSTs `/update`, which writes
  `relay/.update-request` — the relay is sandboxed and may only write under `relay/`.
- A **systemd path unit** watches that flag and runs `scripts/relay-update.sh` as root.
- That script **downloads the bundle, verifies a detached Ed25519 signature against a baked-in public key
  before touching installed code**, backs up, swaps, restarts, **health-checks, and rolls back automatically**
  if the new build does not come up.
- Every exit path **persists why**, and `/update` serves the outcome back — so a failure is reported even if
  nobody was watching the browser at the time.
- One `.update-request` deploys web, manifest and both APKs together, in lockstep.

**So the missing piece is only the WHEN.** Everything an automatic update needs in order to be safe is built
and has been exercised.

## The design

**A policy, set once by the operator**, on the dashboard beside the existing button:

| Setting | Behaviour |
|---|---|
| **Manual** (default today) | exactly what happens now |
| **Security only** | auto-apply releases the release host marks `security` |
| **Automatic** | auto-apply any release on the `stable` channel |

Plus a **window** (default 03:00–05:00 relay-local) and **jitter**, so a fleet does not all update in the
same minute and take a diocese offline together.

**Mechanics — deliberately reusing the existing path:**

1. A systemd **timer** (not a loop inside the relay) wakes hourly and asks the origin what the latest release
   on the chosen channel is. `/update`'s GET already reports `latest` — the check exists.
2. If a newer release qualifies, the timer writes **the same `.update-request` flag** the button writes.
   Everything downstream is unchanged and already tested.
3. **Refuse and tell the operator** rather than proceed, when: the declared `minPeerWire` (A2) would strand a
   peer; disk headroom is short; the relay is mid-restore; or a previous auto-update rolled back.
4. **After a rollback, auto-update disables itself** and says so on the dashboard. An automatic mechanism
   that keeps retrying a failing update is worse than no automatic mechanism.

**The release host needs a channel marker.** Today `RELEASE_REF` defaults to `main` and whatever is on `main`
is what deploys. Automatic updates should not follow `main` — they should follow a tag the release host has
deliberately marked. That is a small change here and the thing that makes "Automatic" defensible.

## What stays a human decision

- **The first update of an old relay is still TOFU** — it trusts the origin it was installed with. Nothing in
  this plan changes that, and no auto-update setting should imply it does.
- **A major version boundary.** If `minPeerWire` rises, an operator is told and chooses.
- **The signing key.** Rotation is governance, not a feature; see the signing-key notes.

## Build order

1. Channel marker on the release host (small; unblocks everything else)
2. The policy setting + timer + refuse-and-report conditions
3. Rollback disables auto-update, surfaced on the dashboard
4. `minPeerWire` gate — after A2 exists

Steps 1–3 are worth doing before the pilot. Step 4 depends on Part A.
