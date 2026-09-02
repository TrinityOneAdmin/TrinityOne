# Which relays get a church's data

Written 2026-09-02 on `relay/closed-network`. **Read this before touching `relay-net.src.js`,
`_netRelays`, `churchRelays()`, `relaysForChurch()`, or any relay list anywhere.**

This file exists because the whole product's protection lives in the relay. Every safeguarding gate,
every read gate, every retention rule is enforced by `scripts/gateway.mjs` and nowhere else. So the
question "which machines does a church talk to" is not a networking detail — it is *the* security
boundary. Before this branch, any machine could claim to be one of ours and be believed.

---

## The invariant — do not break this

> **A relay receives a church's data only if it proves, at the address dialled, that it holds a relay
> identity key — that is, that it is running TrinityOne relay software. Nothing else is consulted for
> admission.**

Owner's decision, 2026-09-02, implemented literally at `src/relay-net.src.js:260`. `relayPub` is emitted as a
bare unauthenticated string by `/status` and NIP-11 and **must never be treated as proof** — the proof is
`/relay-identity`, nonce-bound and address-bound.

The canonical pin, the serving origin and the church's signed `relay-net` document are still computed, and
still returned as `root`, but they are **diagnostics** now — plus **one refusal**, which is not a diagnostic:
a box answering at an address we SHIP (`SHARED_RELAY_HINTS`) must prove one of the keys we ship
(`SHARED_RELAY_KEYS`), and that check runs before every root.

**What this defends against, and what it does not — said plainly, because the previous wording overclaimed.**
It refuses a replacement box at a shipped address, and it refuses a forwarder at a *different* address. It
does **not** defend against a proxy at the **same** address: whoever controls DNS/TLS for
`app.trinityone.church` — the tunnel operator, or a compelled change of where that name points — can forward
the identity request to the genuine relay, which declares that address and signs it. That position is already
Cloudflare's; sealed content stays sealed, and the exposure is transport metadata, recorded as inherent in the
deanon red-team. **Never describe this binding as closing that case.**

---

## Step one: proof

`verifyRelayIdentity(url)` in `src/relay-identity.src.js` sends a 128-bit CSPRNG nonce; the relay
signs it (`GET /relay-identity?nonce=<32 hex>`, `gateway.mjs:3097`, 400 on a bad nonce). ±300s window.
Only the holder of the relay's secret key can answer.

## Step two: the roots — diagnostics, and one refusal

`proveRelay()` in `src/relay-net.src.js`. In order:

| Root | Fires when | Who it serves |
|---|---|---|
| `canonical` | the proved pubkey is in the pin list shipped in the app | churches on the shared relays — most of them |
| `origin` | the relay URL **is** the page's own serving origin | **console only** — see the trap below |
| `church` | the proved pubkey appears in the church's signed `d=trinityone/relay-net` doc | phones, second machines, everyone else |

Roots 1 and 2 are **URL-bound by construction** — a forwarder at a different address is not the origin
and is not the pin. Root 3 is **pubkey-only**, deliberately. See the tunnel trap.

**None of the three decides admission any more.** When no root fires, `proveRelay()` still returns
`{ root: 'software' }` and the relay is admitted on its proof alone (`src/relay-net.src.js:260`). The roots
are kept because they tell the caller *why* a relay was admitted — which the Relays sheet shows — and because
re-tightening to "a box my church chose" is then one line rather than an excavation. What this knowingly
gives up: someone who genuinely runs our relay software, at an address they control, is admitted if that
address reaches a church's relay list. They see the pubkey-level social graph — never names (sealed), never
message contents (encrypted). What narrows how an address reaches a list at all is C1 and C5, both merged.

---

## Four traps. Each one cost real work to find.

### 1. Root 2 can NEVER fire on a phone

The APK's origin is `https://localhost` (measured on the Oppo, 2026-09-02). A church's relay is never
there. So same-origin adoption is a **console-only** convenience.

**Consequence:** for a self-hosting church that is not on the canonical pins, a member's phone has
**exactly one** route in — root 3, the church-signed doc. If that doc does not exist, every member's
phone is cut off. This is the whole reason the enrolment gap below is a blocker and not a nicety.

### 2. Root 3 matches the KEY, never the URL

A church signs its relay's *identity*. Verified on hardware 2026-09-02: the signed doc said
`ws://127.0.0.1:8000/relay`; the phone reached the same box at
`wss://trinityone.tailbeaac0.ts.net/relay`; it was admitted, because the pubkeys matched.

**If you ever "fix" this to compare URLs, every church behind a free tunnel drops off every member's
phone on each reboot.** Tunnel addresses churn. The key does not.

### 3. The bootstrap read must stay UNGATED

`src/fellowship.src.js:650` reads the relay-net doc over `churchRelaysRaw()` — the *unfiltered* list.
This is deliberate and load-bearing.

The proof that a relay is ours is a document you must **read from a relay you have not yet proved.**
Gate that read and you deadlock: no phone can ever learn its church's relays, and a church that is
neither Suite-shaped nor canonical can never bootstrap. The relay serves this one doc unauthenticated
for the same reason (`canRead`, gateway.mjs).

Same rule applies to the console's enrolment reader (`relayNetDoc`, `steward.src.js:2259`).

### 4. A stale relay looks exactly like a broken gate

A relay process older than `gateway.mjs` enforces the OLD gates against NEW bundles. This produced a
false "the phone can't see the document" finding on 2026-09-02 that looked precisely like a real
member-side deadlock. **Check first, not last:**

```sh
ps -o lstart= -p $(pgrep -f "gateway.mjs 8000" | head -1)   # must be NEWER than:
stat -c '%y' scripts/gateway.mjs
```

---

### 5. A fourth practical admission path: the 30-day verified cache

`VERIFIED_KEY` / `VERIFIED_TTL_SEC` in the gate let a relay stay admitted from cache alone — up to
~6h before a refresh and 30 days offline. Admission is the software proof (above), but the cache means
a box removed by the church can keep being talked to for a window. Cold on merge day, so it does not
affect the enrolment plan, but it is a real fourth path and belongs on this list.

## When nothing can be proved

A publish with candidates but no proved relay **rejects** with `NO_NETWORK_RELAY` — it does not
silently succeed and it does not burn a retry. It is classed as an outage. The member-facing string
for a care request (`app/screens-today.jsx:554`) says the request was **NOT** sent and to speak to a
leader in person. Do not soften this to "check your connection": the connection is fine, the relay is
not ours, and telling someone their cry for help is queued when it is not is the worst thing this app
could do.

A name-only profile change is deliberately silent — names are sealed separately, nothing was lost,
and a warning would be a lie.

---

## Open, as of 2026-09-02

1. **Nothing calls `enrolRelayNet()`.** See `reference/PLAN-ENROLMENT-GAP-2026-09-02.md` — an audit
   found four blockers that are armed *by the act of calling it*, chief among them that
   `_oneComplete`'s `complete` flag reports a dead relay as a completed read of an empty church
   (measured), which turns a boot-time call into a latent wipe of the church's signed membership.
   **Do not wire up a call before reading that plan.** Defined and exported in `src/steward.src.js`; zero call sites
   in any UI file (measured). It works when driven by hand — done on-device 2026-09-02. Until a screen
   calls it, trap 1 above bites every self-hosting church. **This gates the merge.**
2. **12 ungated read subscriptions** — `subscribeMany(window.Fellowship.relays, …)` in
   `fellowship.src.js` at lines 3596 (DMs), 3632, 3657, 3669, 3702, 3730, 4994, 5055, 5069, 5096,
   5115, 5223. No church data leaves; a listed-but-unproven relay learns metadata. Separate piece of
   work — see the note below on why.
3. `restoreChurchData({relayUrl})` left ungated pending an owner decision.

### Why the read side is a separate change

Not because it matters less — because the two have opposite failure modes and cannot be audited in
one merge:

- **Write gate wrong → nothing leaves.** Loud, safe, visible.
- **Read gate wrong → the screen goes blank.** That is this codebase's worst failure class (looks
  normal, shows nothing), and it hits group chat, DMs, reactions and profiles — 12 screens.
- Trap 3 means a blanket read gate **deadlocks the bootstrap**. The read side needs the exception
  reasoned per-subscription, not a filter swapped in.
- CLAUDE.md rule 2 (list every user of shared code first) exists for exactly this shape: 12 callers.

---

## Ordering: relays before apps

The relay must answer `/relay-identity` **before** any app starts asking. a8 currently 404s on that
route. Ship the apps first and every church loses its relays on the day.

1. Update relays → 2. verify each answers, by asking it → 3. release apps.

## Backing tests

- `scripts/is-this-relay-one-of-ours.test.mjs` — 10
- `scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs` — 12

Nothing in this file is asserted that those do not cover, except the on-device measurements, which
are dated and named as such.
