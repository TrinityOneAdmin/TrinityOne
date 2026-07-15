# NIP-17 gift-wrap for DMs — design & migration plan

**Status:** roadmap (post-pilot). **Author:** drafted 2026-07-14 from the deanonymization red-team.
**Goal:** stop the church's **private communication graph** (who DMs whom, when) from being reconstructable
from the relay's stored data — the crown-jewel deanonymization risk for an underground church.

## 1. Why

The deanon red-team (see `memory: deanon-redteam`) showed that today's DMs are plain **kind-4**: content is
encrypted, but **sender (pubkey) + recipient (p-tag) + timing are cleartext**. Two mitigations already shipped:

- **Finding 1 (shipped):** `canRead(kind-4)` now serves a DM only to its two parties → closes the *anonymous*
  harvest of the graph off the relay.
- **Finding 5 (shipped):** DM content is now NIP-44, not deprecated NIP-04.

Neither hides the graph from the **relay itself**. A seized/coerced relay — or any relay the church syncs to —
still reads `author → p-tag` off every stored kind-4 and reconstructs the whole graph offline. **NIP-17
gift-wrap is the only change that removes the graph from the stored data**, so a relay that is later seized and
analyzed forensically sees only "recipient R received *N* wrapped blobs, at randomized times, from random
one-time keys" — no sender, no graph.

## 2. What NIP-17/59 actually is (3 layers)

1. **Rumor** — `kind:14` (chat) — the real message, **unsigned** (so it can't be leaked as proof).
2. **Seal** — `kind:13` — the rumor, NIP-44-encrypted to the recipient, **signed by the real sender** (proves
   sender *to the recipient only*).
3. **Gift wrap** — `kind:1059` — the seal, NIP-44-encrypted to the recipient, **signed by a random one-time
   key**, `p`-tagged to the recipient, with a **randomized `created_at`** (up to ~2 days in the past).

The published event is the `kind:1059`. It reveals only the recipient. The sender is learned by the recipient
*after* two decryptions. NIP-17 also has the sender publish a **second** gift-wrap addressed **to themselves**,
so they can read their own sent messages.

## 3. The four TrinityOne-specific conflicts (the real work)

A generic NIP-17 client is easy. The hard part is that TrinityOne's relay is **membership-gated**, which
collides with gift-wrap's sender-anonymity. These four points are the design.

### C1 — Membership write-gate vs. anonymous sender  ← **the key decision**

TrinityOne accepts writes only from members. A `kind:1059` is signed by a **random** key, so the normal write
gate would **reject it** (author unknown). Two resolutions:

- **Option A — connection-authed, stored-anonymous (recommended for Phase 1).** The member NIP-42-auths their
  *connection* (proving membership), then publishes the `1059` (random author). The relay accepts it because the
  **connection** is member-authed, even though the stored event's author is random. → The **stored data has no
  sender** (seized-relay forensics + other-relay sync + anon-harvest all defeated). **Residual:** a *live*
  relay logging in real time can still correlate "member M's authed socket just pushed a 1059 to R." That
  residual is closed only by publishing over an anonymous connection (Option B / Tor).
- **Option B — fully anonymous publish (post-pilot, pairs with Tor).** The member publishes the `1059` over an
  **unauthenticated** connection → the relay can't check membership → must accept `1059` from anyone → opens a
  **spam/DoS vector** (flood gift-wraps at any recipient). Needs anti-abuse: PoW (NIP-13), per-IP/connection
  rate limits, or an anonymous membership token (blind signature — complex). This is "true" sender-hiding.

**Decision:** ship **Option A** first — it delivers ~90% of the value (removes the graph from stored data,
which is Finding 2's core and kills Finding 1 entirely) with **no new attack surface** (membership gate intact,
no spam vector). Layer Option B + Tor after the pilot for live-correlation resistance. This matches the
already-agreed "Tor after pilot" call.

### C2 — Read gate becomes recipient-only (simpler + better)

Finding 1's gate serves kind-4 to "the two parties." For gift-wrap the relay **cannot** know the sender, so the
gate becomes **"serve `kind:1059` only to its `p`-tagged recipient."** This is *strictly better* — even the
relay can't tell who the two parties are, only who the recipient is. Add `kind:1059` to the NIP-42 auth-challenge
trigger (as done for kind-4) so a withheld wrap prompts the recipient to auth.

### C3 — Retention & the randomized timestamp

`kind:1059` is not replaceable → classified **ephemeral** → culled oldest-first by `created_at` at `MAX_EVENTS`.
But NIP-59 **randomizes `created_at` up to ~2 days in the past**, so a *newly received* wrap can carry an old
timestamp and be **culled prematurely** (or sort wrong in the thread). Fix: for `kind:1059`, cull by a
**received-order** column (a monotonic `rowid`/insert sequence) rather than `created_at`, and have the client
sort the thread by the **rumor's** real timestamp (inside the decrypted content), not the wrap's.

### C4 — Client fetch cost on a thin pipe

The recipient can no longer filter DMs by peer (sender is hidden) — they must fetch **every** `kind:1059`
`p`-tagged to them and **try to decrypt each**. On 2G that's heavier than kind-4 (where you filter by peer).
Mitigations: a since-cursor (only new wraps), a reasonable per-recipient cap, and decrypt lazily/on-demand for
older threads. Acceptable, but measure it.

## 4. Out of scope (note explicitly)

- **Group chat.** Groups already use a shared NIP-44 group key for content, but the **`#t` group tag + author
  pubkey are cleartext** → the *group* social graph still leaks. NIP-17 group support means N gift-wraps per
  message (one per recipient) — expensive and a separate project. **Gift-wrap Phase 1 covers 1:1 DMs only.**
- **IP / relay location.** Gift-wrap hides the *sender within the app layer*; it does nothing for IP or relay
  location. That's the **Tor/onion** work (deferred post-pilot). The two are complementary.
- **Live-connection correlation.** See C1 Option A residual — closed later by Option B + Tor.

## 5. Backward compatibility & migration

The *wrapper kind* changes (4 → 1059), so an old client literally cannot read a new client's DM (worse than the
NIP-44 content swap, which had a fallback). Options:

- **Double-send (recommended for the transition window):** send **both** a `kind:1059` gift-wrap **and** a legacy
  NIP-44 kind-4. New clients prefer the wrap (and ignore the kind-4 by id-dedup); old clients read the kind-4.
  Costs 2× DM writes temporarily. Drop the kind-4 leg once telemetry shows all pilot clients are on the
  gift-wrap build.
- **Read both always:** clients subscribe to `kind:4` (legacy) **and** `kind:1059` (new) and merge by the
  rumor/inner id. Keep this indefinitely so old history stays readable.

## 6. Work breakdown

**Client (`src/fellowship.src.js`):**
- `sendDM`: build rumor(14) → seal(13) → gift-wrap(1059) to recipient **and** a second wrap to self; publish.
  (Double-send legacy kind-4 during transition.)
- DM read (`subscribeDM`/list): subscribe `{kinds:[1059], '#p':[me]}`; unwrap (NIP-44 → seal → NIP-44 → rumor);
  group by the *decrypted* sender; sort by the rumor's timestamp. Keep the kind-4 path for legacy.
- Reactions to DMs (kind-7) currently `p`-tag the peer — revisit so they don't re-leak the edge.

**Relay (`scripts/gateway.mjs` + `scripts/event-store.mjs`):**
- Accept `kind:1059` when the **connection** is member-authed (C1 Option A); cap per member/recipient.
- `canRead(1059)` → recipient-only (C2); add 1059 to the auth-challenge trigger.
- Retention: cull `kind:1059` by received-order, not `created_at` (C3).
- Keep the Finding-1 kind-4 gate for legacy DMs during transition.

## 7. Test plan (this is how we know it worked)

- **Re-run the deanon sim** (`scratchpad` harness): a seized relay's stored `kind:1059` set must reveal only
  `p`-tag recipients + random authors + randomized times — **no sender, no reconstructable graph**. This is the
  pass/fail bar.
- Round-trip: A→B gift-wrap decrypts for B and for A (self-wrap); thread ordering correct.
- Transition: new↔old via double-send both readable; dedup no duplicates.
- Retention: a new wrap with an old randomized timestamp is **not** culled before genuinely-older messages.
- Membership: an unauthed connection cannot publish a `1059` (Option A); a member's connection can.

## 8. Effort & risk

**Effort:** medium-large — a real feature, multi-day, with its own test pass (not a patch). **Risks:** transition
breakage (mitigated by double-send + read-both), the timestamp/cull interaction (C3), and client fetch cost on
2G (C4). **Highest-leverage, lowest-risk first step:** Phase 1 = Option A (connection-authed, stored-anonymous)
+ recipient-only read gate + double-send. That removes the graph from all stored/synced/seized data — the whole
point — without touching the membership model or opening a spam vector.

**Relationship to other work:** completes the deanon triage (Findings 1/5 shipped; this is the Finding-2 "graph
in stored data" fix). Pairs with — does not replace — the post-pilot **Tor/onion** switch (IP + relay location +
the C1 live-correlation residual).
