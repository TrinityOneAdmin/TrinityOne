# Audit — 2026-07-30: security, performance, UI/UX

Read-only. Three parallel subagent passes (security, performance, UI/UX), **each finding then re-verified by
me independently** before it appears here. A subagent's "VERIFIED" is not evidence on its own; where I could
not reproduce a claim, it is downgraded and says so.

Plus a **network load simulation** — a real gateway, real signed events, real websockets, in the production
shape (multiple churches configured, write policy on).

**Fix nothing.** Nothing in this document has been changed. The one exception is the work that was already
committed before the audit began: `arch/registry-wiring` @ `3b6273e`, the relay-vocabulary wiring.

| Label | Meaning |
|---|---|
| **VERIFIED** | I ran it myself, in this session, with a control. Evidence quoted. |
| **CONFIRMED** | A subagent found it and I independently reproduced it. Evidence quoted. |
| **CLAIMED** | Read-only inference, unproved. A lead, not a fact. |

## State at the time of audit

| | |
|---|---|
| Branch | `arch/registry-wiring` @ `3b6273e` · `main` @ `6194c57` |
| Deployed | a8 runs `main`; **the registry wiring is NOT deployed** |
| Suite | 706 pass, 0 fail, 0 skipped |
| a8 | 1 church, `writePolicy: true`, hosting offer **off** |

---

# The precondition that governs half this report

Findings S1–S4 below all require **a relay hosting two or more churches**. That is not a8's shape today, and
a stranger cannot create one: `scripts/gateway.mjs:2585`

```js
const community = OFFER_OPEN || SETTINGS.offerHosting;
if (!community && CHURCH_PUBS.size && !alreadyRegistered) → 403
```

a8 has one church and hosting off, so self-registration is refused. **I did not test this against production**
— if it had succeeded I would have added a church to the live relay — so this is read from the code, and
corroborated by `/status` showing `offer: null`.

**So S1–S4 are LATENT on the pilot, not live.** They become live the day a second church is added to a box, or
the "Offer to host other churches" switch is turned on — and that switch exists because shared hosting is a
deliberate product direction (there is already a media-hosting grant for shared relays).

This is the difference between "fix tonight" and "fix before the first shared relay". It is the single most
important sentence in this document.

---

# Security

## One root cause behind S1–S4

`canRead()` asks a **scoped** question — `effMemberOf(who, cp)` / `churchReader(authed, cp)`
(`gateway.mjs:1507`, `:1515`). The push notifier asks a scoped question too — `memberIn(m, cp)` (`:707`).
**`accept()` does not.** It builds one relay-wide flag at `:1264`:

```js
isMember = isLeader || MEMBERS.has(e.pubkey);
```

`MEMBERS` is the union of every church's members (`:810-816`). So on a multi-tenant box, "is a member" means
"is a member of *something*". Six write rules ask that when they mean "of *this* church". The read side was
moved onto the scoped helper; the write side was left behind.

## S1 — A member of any other church can post into a congregation's group chat — **CONFIRMED**

`gateway.mjs:1483`, the kind-1 tail: `return isMember;`

My own probe, two churches on one relay, church A's ordinary group:

```
ACCEPT   control: a real member of A posts
ACCEPT   ATTACK: a member of church B posts into A's group
REFUSE   control: a total stranger posts   ("blocked: not a member or not permitted for this group")

what a genuine member of A then reads back from their own group:
   "INJECTED by a member of church B"
   "CONTROL: real member of A"
```

The stranger control is what makes this precise: the gate is not absent, it is **scoped to the wrong thing**.

**Cost:** anyone who joins any church on the box can put arbitrary text and links into another congregation's
main chat, delivered to every member as ordinary chat. For a congregation whose threat model is lawful
compulsion, third-party content appearing in the church's own chat is exposure the stewards did not create.
Mitigating: the injector's profile is not readable to A's members, so it renders unnamed rather than
impersonating someone.

The same hole was closed for **broadcast** groups (`:1466`) and for **invite-only** groups (07-24, `:1473`).
The ordinary open group — the one every church actually talks in — was not brought along.

**Fix direction:** the branch already resolves `GROUP_CHURCH.get(g)`; require membership *of that church*.

## S2 — A co-tenant can hijack a care need and lock the real recipient out — **CLAIMED (agent-verified, not re-run by me)**

Two rules resolve the owning church from the event under audit rather than from the object being acted on
(`:1409` NEED_D, `:1424-1432` SKIP_D), and `note()` records `CARE_RECIPIENT`/`CARE_SKIPHASH` keyed by the bare
care id (`:1240-1252`) **without** the `idOwnerOk()` guard that `GROUP_D` and `ROSTER_D` were given for exactly
this in AUDIT-2026-07-24 C1/C2.

The agent reproduced a full sequence ending with *the genuine recipient refused when skipping a day with their
own correct token*. **I did not re-run this one** — it needs the self-registration path, and the same shape is
already proved by S1/S3/S4, so I ranked re-verification below getting the rest of the audit done. Treat as a
strong lead, and reproduce before fixing.

**Cost if real:** the per-day `sha256(token)` scheme exists so only the recipient can say "I don't need help on
the 14th". A stranger cancels the days — nobody brings food to a housebound member — and the recipient cannot
fix it. Silently, since the member app's new failure channel does not cover a refused write.

## S3 — A co-tenant church can mark an adult of another church a "minor" and disable them — **CONFIRMED**

`accept()` consults the relay-wide `MINORS` union at `:1409` and `:1433`. `safeguardAllows()` was scoped
per-church precisely because that union was a cross-tenant hole (REVIEW-2026-07-20 B4), and the kind-1
child-safe check was scoped for the same reason. These two were not.

My probe — church B lists an adult member of church A, who has never joined B:

```
ACCEPT   control: adult of A publishes careavail:<A>
REFUSE   after B lists them:  ("blocked: not a member or not permitted for this group")
```

**Cost:** a targeted, silent denial of service against one named person. They cannot register as available to
help, and cannot ask for help. Nothing tells them why.

**Fix direction:** use the per-church list for the resolved owning church, as `:1483` already does.

## S4 — Cross-church writes into the emergency safety roll-call — **CONFIRMED**

`:1436` `SAFE_D` → `CHURCH_PUBS.has(cp) && isMember`. Unscoped.

```
ACCEPT   control: member of A responds to A's safety check
ACCEPT   ATTACK: member of church B responds to A's safety check
```

**Cost:** the safety check is the post-emergency roll-call — the highest-stakes moment in the product.
`subscribeSafetyResponses` (`src/steward.src.js:1533-1550`) keys results by responder pubkey with no roster
filter, and the NIP-44 conversation key is symmetric, so an outsider sealing to the check creator's public key
produces a response that **decrypts and displays** as a genuine "safe" or "needs help". A steward counting
heads after a raid could be counting a stranger.

Same unscoped shape at `:1420` (care slots) and `:1433` (the "here to help" register).

## S5 — An ungrouped chat message is world-readable — **VERIFIED (found by me, via the simulation)**

`canRead()` ends: `if (!g || GROUP_VIS.get(g) !== 'invite') return true;`

A kind-1 event with no group tag has no `g`, so it is served to **anyone, unauthenticated**. I found this by
accident — my simulation tagged groups wrongly — then probed it deliberately:

```
ACCEPT   a member publishes a kind-1 with NO group tag
stranger (no auth at all) sees: ["UNGROUPED"]
grouped chat correctly hidden from the same stranger: yes
```

**Cost:** modest and self-inflicted — a member can only expose their own message. But it also means the
church's relay will store and serve world-readable content for any member who omits a tag, against the
church's retention budget. The shipped app always tags a group, so this is not a leak of existing chat.

**Fix direction:** require a group for kind-1, or gate the ungrouped case to the author. Note the deliberate
"your own events stay yours" exception one line above — the fix should match that shape.

## S6 — The console's church key is stored at a weaker tier than a member's key — **VERIFIED**

The member app closed this in M12: on native the encrypted seed lives in Keystore/Keychain and localStorage
keeps only a non-secret marker (`src/identity.src.js:82-93`). The console did not.

```
SecureStorage references:   src/identity.src.js  15
                            src/steward.src.js    1   ← and that one is a comment:
  ":641  // Native (Capacitor) SecureStorage migration is queued as a follow-up commit"
```

`ENC_LS` — the encrypted church key — is read and written with plain `lsGet`/`lsSet` (`src/steward.src.js:643`,
`:748`, `:752`). `trinityone-steward.apk` ships.

**Cost:** a seized steward phone yields the church-key ciphertext to a forensic image, where the member app's
would not. The church key is the highest-value target in the product.

The 07-29 pass's "no asymmetry between the member key and the church key" was right about the *KDF* and did
not look at the *storage tier*.

### S6b — CORRECTION. The throttling asymmetry runs the OTHER way, and the security pass had it backwards

The security subagent reported "**no attempt throttling anywhere** in either app". That is wrong, and the
UI/UX pass caught it. I checked both myself:

```
CONSOLE   app/steward-root.jsx:489-499 — a persisted, escalating cooldown:
            5 misses -> 30s, doubling, capped at 1h; stored in localStorage so it SURVIVES A RELOAD
            const until = fails >= 5 ? Date.now() + Math.min(30 * Math.pow(2, fails - 5), 3600) * 1000 : 0;

MEMBER    app/identity.jsx:742-756 — tryUnlock() has no counter, no delay, no cooldown.
            Unlimited instant guesses.
```

So the console — the app whose key sits in weaker storage — is the one that *is* rate-limited, and the member
app is not. **That is the worse direction under this threat model:** there are twenty members and one steward,
and members are the people whose phones get taken. A 6-character PIN with unlimited instant guesses is a very
different proposition from one with an escalating lockout.

This is the clearest argument in the whole audit for verifying subagent output rather than relaying it. Two
passes disagreed; the code settled it; the pass with less security framing was right.

## S7 — The guard that vouches for the care-skip rule tests one church — **VERIFIED**

`scripts/relay-careskip.test.mjs:71` — `CHURCH_NPUB: npubEncode(cp)`. One church. The invariant only fails with
a second tenant, so the strongest guard on S2 is structurally unable to see it.
`relay-tenancy-write.test.mjs` *does* run two churches — care needs, skips, safety and open-group chat are
simply not in it.

This is the pattern both prior audits named, and it is why S1–S4 are green today.

**Fix direction:** the two-church harness already exists. Move these cases into it **before** touching
`accept()`, so each rule change is proved to bite.

## Smaller — all CLAIMED, read only

- **The desktop payload reports a version it is not.** `build-relay-payload.sh` builds from `main` (the ref
  defaults) then stamps `git rev-parse HEAD`. Built on a branch, it ships `main`'s code labelled with the
  branch sha. Same class as A4 — a route reporting something it has not verified.
- **`_blobMember` fails open with no church configured** (`:201`). A relay that loses `church.json` serves
  every stored media byte to anyone.
- **Blob existence oracle** — `statSync` runs before the guard (`:3038`/`:3040`), so 401-vs-404 distinguishes
  present from absent. Needs a known hash.
- **The PIN copy overclaims in the place members actually read.** The sheet retracts honestly
  (`app/identity-extras.jsx:283`), but the settings row says only *"nobody can open your church or read your
  messages"* (`app/identity.jsx:1129`), and `src/identity.src.js:26` still calls it *"plausible deniability"*.
  Overclaiming is a defect here. Move the retraction up rather than weakening the sheet.

## What held — security

Re-checked by me, not taken on trust:

- **Every read gate.** Roster to a stranger: 0 events. Roster to a co-tenant church's member: 0. Minors list to
  a co-tenant: 0. **S1–S4 are integrity failures, not disclosure — no arrest list leaked in any probe.**
- **The stranger control refused.** A key belonging to no church cannot post into any group.
- **The bootstrap lock.** A private single-church relay refuses self-registration.
- **The registry wiring is name-preserving.** All 51 names identical to their pre-wiring values; the relay
  boots; `k()` genuinely throws on an undeclared name; the new runtime import reaches all three packaging
  paths.
- **The self-update path.** Signature verified over the exact bytes before install, older bundles refused by
  build date, fails closed with no release key, trust anchor root-owned.
- **`note()` is the well-built half** — every ingest branch re-checks authority independently.

---

# Performance — network simulation

A real gateway, 8 churches configured, write policy on. 355 events, real signed writes, real REQ/EOSE round
trips. Two false starts of mine are worth recording because both produced confident nonsense: the harness did
not authenticate (so every read measured a flat ~2504ms NIP-42 idle wait, not query cost), and it tagged
groups with `['g',…]` when the relay reads `['t',…]`.

## What the numbers say

Two runs, the second 22× the first, both 8 churches:

| | 355 events | **7,715 events** |
|---|---|---|
| Write round trip (accept + store + OK) | p50 10.6ms · p95 12.1ms · max 41.6 | p50 **9.8ms** · p95 **11.1ms** · max 31.1 |
| `#d`-tag lookup | 25.8ms cold, then 1.1–1.8ms | 28.2ms cold, then **2.0–2.6ms** |
| Member cold start (docs + tagged docs + chat) | 33.1ms (51 chat) | **43.7ms** (200 chat) |
| Cross-church isolation | church 1: 4.5ms · church 8: 1.0ms | church 1: 5.0ms · church 8: 0.9ms |
| Relay process / DB | — | ~101 MB RSS · 5.1 MB sqlite |

**Nothing is stressed at this scale.** Write cost did not rise with the corpus. One church's traffic does not
slow another's reads: the eighth church, written last against the largest corpus, answered *faster* than the
first.

> ### ⚠ CORRECTION — I drew the wrong conclusion from these numbers
>
> I originally wrote that the tag lookup "is genuinely indexed rather than scanning" because it grew only
> 1.5ms → 2.3ms while the corpus grew 22×. **That was wrong.** The performance pass measured at 200,000+ events
> and found it linear; I re-tested it myself at 60,000 rows and it is unambiguous:
>
> ```
> PLAN before ANALYZE:  SEARCH events USING INDEX idx_kind_created (kind=?)   ← whole kind-30078 partition
>   20 lookups: 10.33 ms each
> ANALYZE took 33 ms
> PLAN after  ANALYZE:  SEARCH events USING INDEX idx_dtag (dtag=?)
>   20 lookups: 0.16 ms each                                                  ← 65x faster
> ```
>
> A linear scan of 7,715 rows costs ~1.3ms, which is exactly what my sim measured. **I mistook "fast at small
> scale" for "indexed".** Every number in the table above is real; the inference from them was not. This is the
> same defect this audit keeps finding — a measurement whose universe is too small to show the shape — and it
> is why the load simulation needed a second, larger pass by someone who did not already have a conclusion.

The 25–28ms first lookup in both runs is a cold-cache artefact, not scale: it appears at 47 events and again at
967, then disappears.

**Where a relay would actually get stressed, on this evidence:** not in query cost. The plausible ceilings are
the per-church `MAX_EVENTS` retention budget (20,000 by default — a busy congregation would hit that long
before the database struggled) and connection/subscription count, which this sim does not exercise. Write
throughput is ~100 events/sec round-trip-bound, which is a chat rate no congregation will reach.

**Honest limits.** 7,715 events on a warm local loopback with 8 churches. This measures *shape*, not a ceiling:
no concurrent clients, no network latency, no media blobs, no long-lived subscription fan-out. The obvious next
steps are 10⁵–10⁶ events and many simultaneous sockets — the second is the one I would expect to find
something, given `MAX_SUBS_PER_CONN = 256` and a documented history of hitting per-connection subscription
limits.

## P1 — No `ANALYZE`, so every kind-narrowed query scans the whole partition — **VERIFIED (by me, independently)**

`scripts/event-store.mjs:61-70` creates seven indexes including `idx_dtag`, and **SQLite never uses it**,
because the schema has no statistics. It always picks `idx_kind_created` — which satisfies the
`ORDER BY created_at DESC` without a sort — and ignores `dtag` and `pubkey` entirely.

My own measurement is quoted in the correction box above: **10.33ms → 0.16ms after a 33ms `ANALYZE`.** The
performance pass measured the same effect on a 204,800-event relay and found the cost perfectly linear at
~0.83 µs/row:

| kind-30078 rows | 10k | 50k | 100k | 200k | 400k |
|---|---|---|---|---|---|
| one-document `#d` lookup | 7.2ms | 42.9ms | 80.7ms | 165.1ms | **331.1ms** |

On its live test relay: pinsermon lookup 79→1ms, own-docs 78→3ms, and the steward console's ten identical
unions **2,500→978ms**.

**This is the single cheapest fix in the entire audit.** One statement at `openStore()`, one-off cost measured
at 33ms (227ms on the larger corpus), and it also resolves P2 below and a third of P6.

**Fix direction:** `ANALYZE` at `openStore()`, and again after a bulk import. Optionally add `(dtag, created_at)`
and `(pubkey, kind, created_at)` composites so the post-`ANALYZE` plan loses its `USE TEMP B-TREE FOR ORDER BY`.

## P2 — `accept()` pays that scan on every MyData sync write — **CLAIMED (agent-verified, same root cause)**

`gateway.mjs:1456` runs `store.query({kinds:[30078], authors:[pubkey], limit: MEMBER_DOC_CAP+1})` on the
catch-all member-document path — so on **every one of the seven MyData documents** a member syncs (including
`chatseen`, added today). Measured at 24ms with 23k docs, scaling to ~331ms at 400k, synchronously, blocking
every other client. `ANALYZE` takes it to 0.04ms.

## P3 — A five-member reconnect stalls the whole relay for ten seconds — **CLAIMED (agent-verified, measured)**

The relay is single-threaded and every `store.query` is a synchronous SQLite scan, so REQ work head-of-line
blocks everything — including the HTTP that serves the web app from the same process.

| load | publish→OK latency |
|---|---|
| idle | 14.8ms median |
| 200 idle clients / 2,400 subscriptions | 14.2ms median (flat) |
| **5 members reconnect at once** (60 REQs) | **10,157ms** |
| **20 members reconnect at once** (240 REQs) | **18,712ms** |

And this is triggered constantly on a thin pipe: ~20 effects key on `connTick` (`app/app.jsx:514-554`), so one
`visibilitychange` / `focus` / `online` / app-resume tears down and re-opens the whole ~15-subscription set.
There is a 2.5s debounce but **no backoff**. A flapping 2G radio in a congregation of fifty is a self-inflicted
denial of service.

**Fix direction:** exponential backoff with jitter on `connTick`, re-subscribe incrementally, and bound
per-REQ work by wall-clock rather than row count.

## P4 — `importAll()` throws on any replaceable event and imports nothing — **CLAIMED (agent-verified, reproduced by the agent)**

`event-store.mjs:283-290` opens `BEGIN`, then calls `put()`, which at `:112` opens its **own unconditional**
`BEGIN` per replaceable event. Nested transactions are an error, and `put()`'s catch issues a bare `ROLLBACK`
that discards the caller's outer transaction too.

Live impact is bounded — the restore route uses per-event `put()` — but the legacy JSON→SQLite migration at
`gateway.mjs:3353` is dead: it throws every boot, `renameSync` never runs, so an old relay's entire
`relay-db.json` history silently never migrates, for ever.

## P5 — The event store's own regression test never runs — **VERIFIED**

`npm test` is `node --test scripts/*.test.mjs`. `scripts/test-event-store.mjs` does not match that glob, so it
has never been in the suite — and it exits 1 on its first assertion, on P4. The suite's
`scripts/event-store.test.mjs` never touches `importAll` or transactions.

**That is how a green suite coexists with a broken store API** — the same shape as A6 and S7. Three instances
in one day of a guard whose universe is smaller than its claim.

## P6 — The console opens ~23 subscriptions, ~10 of them byte-identical — **CLAIMED (agent-verified)**

The same two-filter union appears at **17 call sites** in `src/steward.src.js`, and one of them is instantiated
seven more times. Measured: ten of those unions cost **2,500ms and 3,428 KB** — the same bytes fetched ten
times. Two further subscriptions are unscoped across *every* church on the relay.
`app/steward-root.jsx:68` already names the fix: *"The deeper fix is porting the member app's `_docsHub`."*

## P7 — Cold start: ~2 MB and ~50 round trips before a usable church view — **CLAIMED (agent-measured against production, GETs only)**

712 KB gzipped across 47 requests for first paint, plus a 321 KB `sql-wasm.wasm` the service worker installs
that nothing references, plus ~1 MB of church data. At a realistic 20 kB/s that is roughly **100 seconds of
transfer before latency** — against a product whose test is "does this work over a thin pipe in Tehran".

**~88 KB of that first paint (12%) is the wallet and giving code, for a feature that is switched off**
(`WALLET_ENABLED = false`, `givingOn = false`).

Good news within it: production does **not** ship runtime Babel — the 660 KB `vendor/babel.min.js` is served
but unreferenced, so the alarming repo-root figure is the dev shell, not what members get.

## P8 — The member roster emit is uncoalesced; the identical bug was fixed on the console side — **CLAIMED (agent-verified by reading)**

`src/fellowship.src.js:1842-1849` — a full spread + filter + sort + synchronous `JSON.stringify` to
localStorage + `setState`, per incoming event. The `_coalesce` helper sits 1,700 lines above in the same file,
~12 of this function's siblings use it, and the console's identical path was explicitly fixed with a comment
naming the cost. One line.

## Smaller — all CLAIMED

Steward roster re-decrypts every sealed name on every emit (~40,000 ECDH attempts over a 30s load, no cache);
MyData serialises the whole collection eight times per synced event and keeps an append-only tombstone array
that is **re-uploaded on every edit**; the DM thread merge is O(n²) with no `limit` on any of its four filters;
`saveProfiles` has no cap where both its siblings do.

## What held up — performance

Checked and genuinely well-bounded:

- **Broadcast fan-out is flat** — publish→OK stayed 14–16ms from 0 to 200 clients / 2,400 subscriptions.
- **The 64-subscription-cap incident is retired** — member steady state is ~15 subs against a cap of 256, all
  three kind-0 batchers hold, and no per-member subscription exists anywhere.
- **Per-church retention works** — `cull()` is 10.5ms at 133k events, and a chatty church genuinely cannot
  evict a quiet one.
- **`#church` filters are fast and flat** — 1.6ms for 500 rows regardless of corpus. It is the one dimension
  with a working composite index.
- **Static serving is right** — mtime-keyed gzip cache, weak ETag + 304, immutable `?v=<sha>` assets.
- **Relay memory is modest** — 182 MB RSS at 204,800 events, ~913 bytes per event.
- **Boot is not O(n²)** — the `_hydrating` guard works; 204,800 events and 10,000 members boot in ~12s.

---

# UI / UX

The UI/UX pass ran four sub-passes and downgraded three of its own findings on re-check. I re-verified its top
items against the code before ranking them here; the ones I did not personally re-run are marked.

## U1 — "Skip setup for now" permanently closes the only way back into an existing account — **CONFIRMED**

`app/app.jsx:1816` — `onSkip` writes `trinityone.onboarded = true`, and `app/app.jsx:362` gates the wizard on
that flag. Typing 12 words to restore exists **only** inside that wizard.

There is a second restore pane (`app/screens-chat.jsx:187`, `:250`) inside `NostrSheet` — and **nothing opens
it**. I grepped: the only occurrence is the JSX at `:618`; there is no `setNostr(true)` anywhere. The codebase
documents this itself, at `app/identity.jsx:22-27`:

> *"The pane existed in NostrSheet but only mounted from `?identity=restore`, a URL the APK's WebView can never
> carry, so a member who changed phones had no way in at all — while the wizard told them the 12 words were the
> only way back. AUDIT 2026-07-26."*

That comment describes the bug the wizard route was added to fix. The wizard is now the sole entrance — and one
tap on a grey link at the bottom of the first screen closes it for good.

**Harm:** a member on a new phone taps "Skip setup for now", and "I've used it before" is gone. The words "for
now" are false. Recovery requires uninstall/reinstall, which nothing tells them — while
`app/identity-extras.jsx:285` and `app/identity.jsx:766` both instruct them to "restore your 12-word phrase",
an action with no entry point.

**Fix direction:** either don't set `onboarded` on skip, or put a "Bring my account back" row in the You sheet.

## U2 — Help → "Back up your recovery phrase" is a permanent blank spinner — **CLAIMED (agent-verified; needs a PIN-locked device)**

`app/screens-help-main.jsx:20-26` early-returns a bare spinner, and the close button is at `:41` — *below* the
guard, so it never renders. `secureGet()` returns `null` for any member with a PIN who has not unlocked this
session, and `:16` has no `.catch()` (its twin at `app/identity-extras.jsx:128` does).

**Harm if confirmed:** a cream screen with a spinning ring, no text, no button, forever. Hardware Back escapes;
nothing says so. Reachable from the Help index's "Begin backup" call to action.

**Fix direction:** render the header and close button above the guard.

## U3 — "We'll let you know the moment you're approved, so you can close the app" is false on Android — **CLAIMED (agent-verified by reading)**

`app/screens-chat.jsx:483` makes that promise. `app/reminders.jsx:90` — `if (isNative()) return;` — the APK
receives no web push at all, and the categories at `:117` (`dm`/`announce`/`serving`) contain no approval type.
The only approval signal is an in-session toast.

**Harm:** the most anxious screen a new member sees gives a concrete instruction that guarantees they miss the
event. The steward side compounds it: the join alert is a 9-second toast that only fires while the console is
open, and the pending banner lives only on the home tab.

## U4 — The member app has no PIN throttle; the console does — **VERIFIED** (see S6b)

Also `app/identity.jsx:766` — "Forgot your PIN?" advises "reinstall the app and restore your account with your
12 words". For anyone who skipped the seed backup that is account destruction, stated as help, with no warning
and no "ask your church" route — even though the restore flow has an excellent one at `:465-502`.

## U5 — Copy that overclaims — **VERIFIED by reading, four places**

Overclaiming is treated as a defect in this product, so these are findings rather than nitpicks.

| Where | Says | Actually |
|---|---|---|
| `app/identity.jsx:701` (onboarding PIN) | a taken phone is "just a locked box" | the wipe deliberately keeps `followedChurches`/`activeChurch` (`src/fellowship.src.js:1735`) |
| `app/screens-church.jsx:211` (join screen) | following "only subscribes you" | `followChurch` calls `announceMembership` — it **publishes** an identifying document (`app/app.jsx:612`) |
| `about.html:229`, `features.html:219` | "Group rooms and private, encrypted messages" | new groups default **unencrypted** (`app/stew-dashboard.jsx:1728`); the app itself says so honestly at `app/screens-chat.jsx:1181` |
| `welcome.html:408`, `about.html:225` | "Nothing is held by a big company" | the default is a shared relay TrinityOne operates; self-hosting is a capability, not the default |

The honest retraction already exists and is well written (`app/identity-extras.jsx:283`,
`app/help-data.jsx:332`). The fix is to move that text onto the screens with reach, not to weaken it.

## U6 — Silent emptiness in six member lists and most of the console — **CLAIMED (agent-verified by reading)**

Relay-down and genuinely-empty render identically in the DM inbox, Notifications, Serving, Events, People and
the console's Members tab. Listen actively blames the church — *"Your church hasn't added an audio feed yet"* —
while `data.error` is set and never read.

`window.stewardStreamLoaded` exists for exactly this, with a comment naming the problem, and is consulted at 3
of ~25 sites. This is the same class A2 addressed in the member engine today; the UI layer has not caught up.

## U7 — Destructive actions confirm in the same pixels as the trigger — **CLAIMED (agent-verified by reading)**

Block, Revoke and Leave-church all render the confirm button as the first child of the container the trigger
occupied, so a double-tap commits. None carries prose: Block's only explanation is a `title` tooltip, invisible
on touch, while its real effect — rotating the care, media, **name** and every group key — is never stated.

## U8 — Accessibility, concentrated on primary controls — **CLAIMED (agent-verified by reading)**

62 `onClick` handlers on non-interactive elements, including every group row, every DM row and the church
picker. Zero `htmlFor`; 231 inputs with no accessible name, including both onboarding PIN fields. Zero
`aria-invalid`/`aria-describedby`/`role="alert"` — every error is border-colour only, so a blind member typing
a wrong PIN gets nothing. The "Follow church" button's disabled label is white on `--line` at roughly **1.2:1**,
on the primary join screen. `--mono` is undefined in the member app, so the phone-to-phone **check code** — the
one string a member must compare character by character — renders in a proportional font.

2,472 hardcoded `fontSize` values and no `textZoom`: the app ignores the phone's system text size everywhere
except the Bible reader and Help, which both do it properly.

## What is good — UI/UX

Named deliberately, because a list of defects is not a basis for prioritising.

- **The recovery architecture** — the three-way fork, the phone-to-phone transfer with a post-exchange check
  code, the "I've lost my 12 words → your church can vouch for you" route, and a terminal no-church screen
  checked *before* the route branches. `app/identity.jsx:486-490` states plainly what comes back, what needs a
  human, and what never returns.
- **The join/approval state machine** — a watchdog, last-known state cached per church so an offline reopen
  shows the truth rather than a false "you're in", a distinct "can't reach your church" state, and a
  deduplicated approval toast. The best-engineered flow in the product; only its notification promise is wrong.
- **The chat outbox** — *Couldn't send · Try again · Discard* — is the best error pattern in the codebase and
  the model the rest should follow.
- **The `{ } Under the hood` pattern** quarantines every protocol detail behind a plain answer. It is the
  answer to most of the jargon findings, already invented.
- **Real accessibility groundwork**: focus save/restore with a nested Escape stack, automatic icon labelling, a
  `:focus-visible` rule that defeats 49 inline `outline:none`, `prefers-reduced-motion`, and two contrast fixes
  whose failing ratios are recorded in the comments. 30 console modals are fully wired.
- **Honest-limits writing** where it exists — *"If these words are lost, the church is gone — not locked,
  gone"*; *"not end-to-end encrypted, so the relay can read messages here"*; *"Some honest limits, so nobody is
  surprised"*.

## Downgraded — agent claims that did not survive re-check

- **"New identity" has no confirmation** — the entry point is hidden for the pilot (`app/identity.jsx:1154`)
  and `ctx.openNewIdentity` has no caller. Latent, not live.
- **Unguarded `importMnemonic` restores** — URL-only paths the APK cannot reach. Both file-backup restores are
  properly guarded.
- **`navigator.onLine` misuse** — the codebase explicitly refuses to trust it (`app/app.jsx:190-197`). No
  finding.

---

# Suggested order

Not severity — an order where each step is independently verifiable, and the cheap certain wins come before the
expensive uncertain ones.

1. **P1 — one `ANALYZE` at `openStore()`.** One statement, 33ms, and tag lookups go 65x faster. It also fixes
   P2 and a third of P6. Nothing else in this document has anything like that ratio of payoff to risk.
2. **U1 (skip closes the restore door)** and **U2 (blank spinner)**. Both are small, both strand a real member
   with no way out, and U1 undermines the recovery architecture that is otherwise the best thing in the product.
3. **U4 / S6b — a PIN throttle in the member app.** The console's implementation is 10 lines and already
   written; copy it. Members are the seizure targets.
4. **U5 — the four overclaims.** Text-only, and the honest wording already exists elsewhere in the app.
5. **S7 — move the care/safety/open-group cases into the two-church test harness.** Do this *before* touching
   `accept()`, so each rule change is proved to bite.
6. **S1–S4 as one scoped-membership fix.** They share a root cause and a primitive (`memberIn`) that already
   exists. Fixing them separately is four chances to scope one wrong. Latent until a second church shares a
   relay — so this is "before the first shared relay", not "tonight".
7. **S6 — move the console's church key to SecureStorage on native.** The member app's implementation is the
   template.
8. **P3 (reconnect backoff)** and **P8 (one-line coalesce)** — both client-side, both cheap.
9. **P4/P5 (the store's broken `importAll` and its orphaned test)**, then **P7** (drop the switched-off wallet
   code from first paint — 12% of the cold-start payload).
10. **S5 (ungrouped chat), U3 (the push promise), U6 (silent emptiness), U7, U8**, and the structural work:
    a tag index (P-2 class) and a console `_docsHub` (P6).

## What this pass says overall

The defect that keeps recurring is unchanged, and it appeared twice more today — once in the product
(`accept()` asks a relay-wide question where `canRead()` asks a scoped one; a guard that tests one church
cannot see a two-church bug) and once in this very audit (two subagents disagreed about PIN throttling, and the
security-framed one was wrong).

The encouraging half is unchanged too: the read gates held under every angle I tried, the relay does not
degrade under 22× the load, the recovery architecture is genuinely well made, and in almost every case the
honest sentence the product needs is **already written somewhere in the codebase** — just not on the screen
where it matters.
