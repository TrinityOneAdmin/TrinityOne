# TrinityOne — Revocable Stewards (Signed Steward Roster)

**Design — v0.1 (2026-06-17)**
Addresses the standing audit note: *"Steward handoff = shared key (no revocation)."*

---

## 1. The problem

Today, adding a co-steward means **sharing the church's root key** (the seed). Whoever holds it *is*
the church and **cannot be individually revoked** — the only "undo" is rotating to a brand-new church
identity (losing the npub, NIP-05, and every reference to it).

## 2. The approach (chosen: signed roster, not a NIP-46 bunker)

The church **root/owner key** stays the single root of trust. It publishes a **signed roster** naming
the pubkeys of its stewards. Each steward keeps their **own personal key** and acts under it. To remove
a steward, the owner re-signs the roster without them.

- No always-on infrastructure (vs a NIP-46 bunker), no shared secret.
- Fits the relay's existing model: write-policy is already keyed on pubkeys + church-signed docs.
- Trade-off: because content is now authored under a steward's *own* key (not the church key), both the
  **relay** and the **client** must learn to treat roster-signed content as official (§5–6).

## 3. The roster document

A replaceable event, signed by the **church key only**:

```
kind: 30078
d:    trinityone/stewards:<churchpub>           # one roster per church, owner-signed
content: { "pubkeys": ["<hex32>", "<hex32>", …] }   # the current stewards (latest event wins)
```

Mirrors the existing church-signed admin docs (`blocked:`, `admitted:`, `minors:` …).

## 4. The owner-only boundary (master control)

Rostered stewards get **day-to-day church powers** but **not** the powers that could entrench them or
lock out the owner. Owner-only (church root key) ops:

| Owner-only (root key) | Delegated to stewards |
|---|---|
| Edit the **steward roster** (`stewards:`) | Create/edit groups, plans, devotionals, rotas, services, events |
| Edit the **blocklist** (`blocked:`) | Post to broadcast channels; pin/hide messages |
| Change the **relay write-policy** (`/config`, NIP-98) | Admit members; set join policy; manage safeguarding lists |

A steward therefore **cannot add stewards, promote themselves, remove the owner, or unban people.** A
rogue steward is fully recoverable by the owner re-signing the roster.

## 5. Relay enforcement (`scripts/gateway.mjs`) — **implemented, phase 1**

- **Load:** `note()` parses `stewards:<cp>` (only when authored by `<cp>`) into `STEWARDS_BY: cp → Set`.
- **Identify the church a steward acts for:** content events authored by a steward carry a
  `["church", "<cp>"]` tag (for `<cp>`-keyed admin docs the church is already in the `d` tag).
- **Authorise additively:** existing checks (author == church / network) are untouched; we *also* accept
  when `stewardOf(author, cp)`. **With no roster published, nothing changes** — identical to today.
- **Owner-only stays owner-only:** roster + blocklist + `/config` are *not* delegated (stewards are not
  folded into `isLeader`), so those remain church-key-only automatically.
- **Revocation is instant:** the owner publishes a new roster; the relay drops the old set on the
  replaceable event and rejects the removed steward's next church write.

## 6. Client integration — **phase 2 (todo)**

1. **Steward app — manage stewards:** an owner-only screen to add/remove steward pubkeys and publish the
   signed `stewards:<cp>` roster. (Add via the steward's npub or a join/scan.)
2. **Author as a steward:** when a steward creates church content, stamp the `["church", <cp>]` tag and
   sign with their own key (the `finalizeEvent` seam in `src/steward.src.js`).
3. **Trust roster-signed content:** clients fetch the roster alongside other church docs and render
   steward-signed official content as "posted by <steward> for <church>", verifying the author is on the
   current roster (consistent with the C1 signature-verify model).

## 7. Founder "hand over master control" — staged

- **Now (phase 1–2):** steward add/remove + revocation. Covers the day-to-day ask.
- **Later:** true owner handover *with lock-out of the previous holder* requires rotating the root key
  itself — best paired with **Keykeeper** (physically hand over a hardware key) or a key-rotation /
  identity-migration step (NIP-41-style). Tracked in `KEYKEEPER-DESIGN.md`.

## 8. Phasing

| Phase | Deliverable | Where |
|---|---|---|
| **1** | Relay: load roster, additive steward authority, owner-only boundary, instant revoke | `gateway.mjs` ✅ |
| **2** | Steward app: manage-stewards screen + author-as-steward + roster-aware attribution | `src/steward.src.js`, steward UI |
| **3** | Owner handover with lock-out (key rotation / Keykeeper) | ties into `KEYKEEPER-DESIGN.md` |
