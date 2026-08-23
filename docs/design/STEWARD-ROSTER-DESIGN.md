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
content: {
  "pubkeys": ["<hex32>", "<hex32>", …],            # the current stewards (latest event wins)
  "caps":    { "<hex32>": ["finance", "care"] },   # OPTIONAL — what each may do (2026-08-19)
  "names":   { "<hex32>": "Tom Ferris" },          # OPTIONAL — what the OWNER calls them (2026-08-20)
  "at":      { "<hex32>": 1787200000 }             # when access was granted (2026-08-20)
}
```

Mirrors the existing church-signed admin docs (`blocked:`, `admitted:`, `minors:` …).

## 3a. Capabilities (added 2026-08-19)

`caps` scopes a delegate to part of the church's work. Five, chosen because the pastoral and financial jobs
are what a church actually asks to separate:

| Capability | Covers |
|---|---|
| `finance` | The church books, funds, statements |
| `care` | Care needs, the care team, care settings, safety checks |
| `safeguarding` | Per-member clearances and photo decisions — **not** the minors / cleared-adult / guardian lists, which stay owner-only |
| `members` | Admit members, join policy, re-seat, the name key |
| `content` | Groups, rotas, services, events, posts, plans |

**Compatibility is load-bearing.** No `caps` key, or a steward absent from it, means *every* capability —
which is what every roster written before this change means. An **explicit empty list** is how a church says
"nothing". Anything else would strip working churches of their delegates the moment their relay updated:
an availability failure dressed as a security improvement.

**Being *a* church is not being *this* church (2026-08-20).** The relay's leader check was relay-wide: it
asked `CHURCH_PUBS.has(author)` and never whether the author was the church being written to, and it sits in
front of every capability check as `isLeader || stewardCan(…)`. So any church key on the box skipped the whole
capability system. Found by simulation, not by reading — three delegated stewards, scoped to Finance, Care and
Groups & rotas, each walked straight through their padlock, because their own console had registered their own
key as a church. `isLeader` is gone; `leaderOf(cp)` takes a required church and also requires that the relay
actually carries it. The seventh rule of this shape; six others were scoped on 2026-07-30.

**Enforcement is the relay's**, on reads as well as writes — a Finance restriction that still serves the
ledger is decoration. `stewardOf(pub, cp)` no longer exists; `stewardCan(pub, cp, cap)` takes a required
capability, so a call site left un-swept is a startup error rather than a silent full grant. `'any'` is for
the structural checks that only resolve *which* church an author acts for.

**What a delegate still cannot do**, unchanged: edit the roster, edit the blocklist, change the relay's
write policy. So capabilities narrow a steward; they never widen one.

**The honest limit:** a relay running an older build ignores `caps` entirely and keeps giving that steward
everything. The console's capability editor says so.

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
| **2** | Steward app: manage-stewards screen + author-as-steward + roster-aware attribution | `src/steward.src.js`, steward UI ✅ |
| **2b** | Per-steward capabilities: relay enforcement + owner-side editor | `gateway.mjs`, `stew-dashboard.jsx` ✅ 2026-08-19 |
| **2c** | Delegate-side honesty: un-granted controls unavailable *with a reason*, orientation on arrival | steward UI ✅ 2026-08-19 |
| **2d** | Owner-side legibility: the owner's own names, a grant date, capabilities chosen AT ADD TIME (never "everything" by omission), and everyone-with-access listed on Members | steward UI ✅ 2026-08-20 |

### Why `names` exists (2026-08-20)

The console derives a friendly name from each key — "Gentle Cedar 36" — which is stable, unguessable, and not
the name the owner typed. An owner who had just added three people by pasting codes could only tell the rows
apart by the order they added them: *"a mis-pasted code is a stranger with everything and I'd never spot it."*
These are the people who can read the safeguarding notes and the money. The invented name is now a fallback,
never the identity, and a steward cannot be added without the owner naming them.

### Why capabilities are chosen at ADD time

"Everything" used to be the implicit default, granted by one click with no confirmation. The owner's verdict:
*"On a real Sunday my choice is three over-powered stewards or no help at all; I'd pick no help."* Adding now
asks what they may do and grants an explicit list — including the explicit empty one, because leaving someone
out of `caps` means unscoped, which is the everything-by-accident this removes.
| **3** | Owner handover with lock-out (key rotation / Keykeeper) | ties into `KEYKEEPER-DESIGN.md` |
