# Closing the relay network — investigation and plan

**Target:** `fix/console-sweep-defects` @ `451e7c6` ("docs(domain): TrinityOne relays are a closed network").
Everything below was read or measured at that commit. Read-only investigation; no code was changed.

**The decision being planned for** is the newest entry in `reference/DOMAIN.md` under *Trust, privacy and tone*:
a church must never reach a non-TrinityOne relay, **and** a church must never have to choose.

---

## 1. The headline, before anything else

**The relay network was never closed. Nothing drifted — the invariant was never written.**

I went looking for a closed-network design that something opened. There isn't one. `git log --all -i -S 'closed
network'` returns exactly one commit in 1,682: `451e7c6`, written on 2026-09-01, the commit that establishes the
rule for the first time. `isTrinityRelay`, `T1_RELAY`, "relay allowlist" return zero commits each. There is no
deleted gate to restore.

**This matters because it changes the job.** Restoring an invariant means finding what broke it. Imposing one
means building the thing for the first time, in a codebase whose every other trust edge already runs through a
signature — and doing it four weeks before a pilot. Budget for the second.

Worse than "never closed": openness was a *designed, shipped, celebrated feature*, and it was re-affirmed four
times.

| Commit | Date | What it did, in its own words |
|---|---|---|
| `9d1094f` | Jun 4 | The spec's premise: *"For an MVP where the relay is the federation's own trusted infrastructure, that is an acceptable trust boundary."* A premise. Never encoded. |
| `dfecaee` | Jun 4, 9h later | *"Pointing at a hosted wss:// relay is now a settings change, not a code change."* The only validation ever applied was the URL scheme. It still is. |
| `f616c8d` | Jun 11 | *"Add public relays the church also **publishes** to (redundancy)"* — the exact capability now ruled out, shipped as a feature, no gate, no comment about safety. |
| `7c98d60` | Jun 12 | `CANONICAL_RELAYS` born as *"relays every church uses **by default**"*. A default, never a boundary. |
| `3c78912` | Jul 7 | The risk was **seen and consciously scoped to reads**: *"a generic Nostr relay enforces none of it… never route **gated content** to a relay without it."* A read-routing rule. |
| `8b63c61` | Jul 9 | The comment that has misled every reader since: *"a generic public relay (nos.lol) has none, so it stays publish-only and never receives gated content."* True of `syncEnable()`'s filter. Written as though true of the relay list. |
| `34c3495` | Jul 27 | Knew the consequence exactly — *"a picked relay then receives EVERYTHING the console publishes, because publish() fans out to relays()"* — and hardened **discovery** only, leaving manual-add open. |
| `d469673` | Aug 18 | The owner's own framing, half-implemented: *"nobody picks relays… the fan-out is now unconditional — {own} then CANONICAL_RELAYS **then any extras**."* The clause `then any extras` is the whole defect, and it is in the commit's own summary of the fix. |

The load-bearing comment survives verbatim at `src/steward.src.js:2592-2594`, and its user-facing form at
`app/stew-dashboard.jsx:3360` tells a steward *"public relays (nos.lol etc.) stay publish-only, so gated content
never leaves your own infrastructure."* That sentence is false in the direction that matters.

**Did other invariants drift the same way?** Yes — this is a recurring shape in this codebase, and the history
names it each time: `enforces` was hardcoded `true` so the member capability gate "actually only proved
reachability" (`bc4c6a8`); `nophoto:` was "a display convention of one build of one app" with nothing in
`accept()` (`ba913fc`); `canRead` default-denied for kind 30078 and default-*allowed* for every other kind
because "the same reasoning was never carried across to KINDS" (`5e2b6fa`). Same failure every time: **a rule
true of one branch of one function, written down as though true of the system.** The generic-relay comment is
the fourth instance, not an outlier.

---

## 2. What is actually true today — measured, not read

Four things I ran rather than inferred.

**(a) A relay's identity is a bare string. Anyone can serve it.** I booted `scripts/gateway.mjs` on a scratch
data dir and read it back. `/status` and the NIP-11 doc both return `relayPub` as an unauthenticated JSON field
with **no proof of possession anywhere**. `relayProof()` (`gateway.mjs:528`) does sign a NIP-98 with `RELAY_SK`
— but only relay→peer for `/sync`, and relay→directory for name claims. **Nothing client-facing ever asks a
relay to prove it holds the key it advertises.** Copy a8's `/status` response onto any host and every client
in the fleet will believe that host is a8.

> **If the plan is built on `relayPub` as it stands today, it is built on something forgeable, and the gate is
> decorative.** Proof of possession is not an enhancement to this plan. It is item one of the mechanism.

**(b) The name directory is open to anyone with a keypair.** Against a local gateway I signed a claim with a
throwaway key for the handle `grace-city`, pointing at `wss://evil.example/relay`. `POST /relay-names/claim`
returned `200 {"ok":true}`. It then resolved, and it appeared in `/relay-names/offers` as a relay open to host
churches. `verifyClaimEvent` proves *some* key signed the claim; **nothing binds that key to a relay, to
TrinityOne, or to the URL's host.** (Gossip is pull-only, so my forged claim stayed local — no production
contamination.)

**(c) The "canonical pool" is one machine.** `app.trinityone.church` and
`trinityone-master-01.tailbeaac0.ts.net` both report `relayPub 6a4267558c9990d0391b3472bac9735d33a5e99b5c7cb0e49bdece7ea6b770f2`.
Identical. This settles open question 3 in `PLAN-RELAY-HARDENING`'s verification ledger, which flagged it as
asserted-but-unmeasured. **Two URLs, one box, one seizure.**

**(d) The live directory today advertises third-party relays above our own.** `GET
https://app.trinityone.church/relay-names/offers` currently returns two `*.trycloudflare.com` relays —
`quitedoverelay` (1 church) and `steady-harbor-18` (3 churches). `steady-harbor-18` answered my NIP-11 probe:
up, `enforces: true`, running build `200b917` (older than a8's `7f05991`). a8 itself advertises `open: true,
churches: 12`. `pickRelays` sorts **ascending by church count**, so a steward clicking **Auto-find** in the
console today adopts those two anonymous tunnels *ahead of* TrinityOne's own relay, and
`autoPickRelays` then republishes the church's NIP-65 list so every member follows.

They may well be the owner's own test boxes. **That is exactly the point: nothing in the code can tell, and
neither can a churchwarden.**

---

## 3. Every path by which a relay URL reaches a client

Enumerated exhaustively across `src/`, `app/`, `vendor/`, `scripts/`, `*.html` and the Android manifest.
`src/` and `vendor/` were compared on every relay path and are behaviourally identical — no bundle drift.

**Two client pools plus one server-side pool.** Member app: `window.Fellowship.relays` → `pool.publish` /
~25 `subscribeMany` sites. Console: `relays()` → `pool.publish` / every console subscription. Gateway:
`PEER_URLS` → authenticated outbound `fetch`.

### Member app — sole writer is `setRelays` (`src/fellowship.src.js:2765`)

```js
const list = [...new Set((urls || []).map(u => (u || '').trim()).filter(u => /^wss?:\/\//i.test(u))));
```
**The only check in the member app is a URL-shape test. `ws://` passes.**

| # | Ingress | Input class | Non-T1 URL? | Affects |
|---|---|---|---|---|
| M1 | `CANONICAL_RELAYS` `:592` | shipped default | no | publish + read |
| M2 | `DEFAULT_RELAYS` `:586`, origin-derived (`ws://` off https) | shipped default | only from a hostile origin | publish + read |
| M3 | `localStorage['trinityone.relays']`, read by `loadRelays` `:712` | persisted | **yes — read back with no shape check at all**; never re-passes `setRelays` | publish + read |
| M4/M5 | `setRelays` / `addRelay` `:2765,:2772` | API funnel | yes (incl. `ws://`) | publish + read |
| M6/M7 | canonical backfill, `app/app.jsx:664,713` | shipped default | no | publish + read |
| **M8** | `?relay=` in a join link — `app/app.jsx:715-718` | **QR / link / deep link** | **yes, any `wss://` host** | **publish + read** |
| **M9** | `?relayname=` — `app/app.jsx:743-750`. The invite supplies **both the resolver host and the answer** | **QR / link** | **yes, and worse than M8** | **publish + read** |
| M10 | `app/identity.jsx:179` ← `resolveRelayName`, member types a name on the lost-words screen | typed + directory | yes (anyone may claim a handle) | publish + read |
| **M11** | church-signed kind-10002 → `_applyChurchList` `:687` | **remote Nostr event** | yes — gated only on self-reported `enforces`; the member side never runs the behavioural probe the console has | **publish + read** |
| **M12** | **backup restore** — `app/backup.jsx:144` `MEMBER_PREFIXES` **contains `'trinityone.relays'`** | **file import** | **yes, arbitrary string, bypasses `setRelays` entirely** | publish + read |
| M13 | `window.Fellowship.relays = …` is a plain writable property | in-page script | yes | publish + read |
| M14–M16 | **latent**: `app/identity-extras.jsx:499-506 SUGGESTED_RELAYS` ships `relay.damus.io`, `nos.lol`, `relay.snort.social`, `nostr.wine`, `relay.primal.net` with a complete but unrendered add flow; `app/screens-chat.jsx:117` accepts `ws://`; `src/mydata.src.js:103` falls back to `ws://127.0.0.1:7447` | — | one line of JSX from live | — |

`safeQuery` (`app/app.jsx:527-545`) restricts native deep links to `https://app.trinityone.church/join*`, and
its own comment on the `relay` key says **"encrypted transport only (NOT a trust check)"**. It does not apply
to the browser/WebView path (`app.jsx:844`) or to the QR scanner (`app/screens-church.jsx:191`), both of which
reach `followChurch` with no host restriction at all.

**Clean, and worth recording so nobody re-checks:** no `nprofile`/`nrelay`/`nevent`/`naddr` decoding anywhere;
no `["relay", …]` tag reader; no kind-3 relay-map parser; `/.well-known/nostr.json` is read for `names` only.

### Steward console — `relays()` (`src/steward.src.js:709`)

`[ownRelay(), ...CANONICAL_RELAYS, ...extraRelays()]`, consumed by `publish()` (`:1753`) and every
subscription. `normRelay` (`:614`) **normalises but never rejects** — `'nos.lol'` becomes `'wss://nos.lol'`.

| # | Ingress | Input class | Non-T1 URL? |
|---|---|---|---|
| S1/S2 | `CANONICAL_RELAYS` `:542`, `ownRelay()` `:568` | shipped / origin | no |
| S3 | `localStorage['trinityone.steward.extra-relays']` | persisted, **no check on read-back** | yes |
| S4 | `Steward.addRelay` `:6363` — normalise, reject self + duplicate, **nothing else** | API funnel | yes |
| **S5** | `app/stew-dashboard.jsx:3149`, input at `:3287` with **`placeholder="nos.lol · relay.damus.io · wss://relay.example.com"`** | **steward typing** | **yes — the product names two generic public relays and invites the steward to add them** |
| S6 | setup wizard step 1, `app/stew-dashboard.jsx:631` | steward typing | yes |
| S7 | connect-by-name `app/stew-dashboard.jsx:3165`. The console's `resolveRelayName` (`:598-607`) checks **only `if (j && j.url)` — no scheme test at all**, unlike the member twin at `fellowship.src.js:2806` | typed + directory | yes, `ws://` survives |
| **S8** | **`refreshNamedRelays` `:632-645` — re-resolves every claimed name on a 2.5s timer, a 90s interval and every window focus, and swaps the URL in `extraRelays` unattended** | **remote, no user action ever again** | **yes — whoever owns the directory handle re-points the console's publish target at will, forever** |
| S9 | `autoPickRelays` `:6398` ← `discoverRelayOffers`. Strongest gate in the codebase: NIP-11 `enforces/open/!full` **plus** `_probeRelayEnforces` (`:6318`), a live behavioural test. Still passed by any unmodified `gateway.mjs` with one dummy church. On success it **republishes the church's NIP-65 list**, propagating the pick to every member (→ M11) | one click + directory | yes |
| S11 | **backup restore** — `STEWARD_PREFIXES = ['trinityone.steward']` matches both `extra-relays` and `relay-names`, so a restore also **re-arms the S8 auto-follow loop** | file import | yes |
| S12 | `cloneFromRelay` — `GET <typed host>/export`, NIP-98 signed. **Exfiltrates the entire church corpus, safeguarding cleartext included, to a typed host.** Not a WS-pool path, but it is "reaching a non-T1 relay" by any reading | steward typing | yes |

### Gateway — the server-side path I did not expect to find

**G1 — `scripts/gateway.mjs:1620-1623`.** The church's own `d=trinityone/relays` doc sets `PEER_URLS`:

```js
for (const r of (Array.isArray(list) ? list : [])) { if (r && r.pubkey) pubs.add(String(r.pubkey)); if (r && r.url) urls.add(String(r.url)); }
```

`String(r.url)` — **no scheme test, no host test, no allowlist.** The sync loop (`:4550-4557`) then makes
periodic authenticated outbound requests to every entry — `/sync`, `/sync-digest`, `/sync-ids`,
`POST /sync-events`, `/sync-media`, `/sync-blob/<sha>` — each carrying `Authorization: relayProof(...)`, **a
NIP-98 event signed by the relay's own identity key**, bound to whatever URL the document named. The only
guard is `new URL(base).host === self` (never sync from self).

So a church key steers the relay's outbound traffic to any host: SSRF, plus a leak of the relay's own signed
identity proof. On a relay with hosting offers on, "a church key" is any stranger who self-registered.

**And note the fix is already sitting in the data.** The document is `[{pubkey, url}]` — it *already carries
the pubkey the church expects at that URL*. **Nothing checks that the host at `url` actually holds `pubkey`.**
Pair them and G1 closes.

### The shortest paths to a hostile socket

1. **One QR scan, zero further consent.** Attacker QR → `followChurch` → `app.jsx:718 F.addRelay` → every
   subsequent publish (DMs, membership doc, sealed name, **care requests**) fans out to the attacker's relay.
2. **No user action at all.** A church key publishes kind-10002 → `_applyChurchList` adopts on a self-reported
   flag.
3. **One keystroke the product suggested.** The placeholder says `nos.lol`; `publish()` fans the safeguarding
   corpus at a relay with no read gate. *This is precisely the defect `451e7c6` describes.*
4. **Unattended, forever.** One connect-by-name, then `refreshNamedRelays` re-points the console every 90
   seconds to wherever the handle's owner says.
5. **Server-side.** A church document steers the relay's authenticated outbound requests anywhere.

Every one of these is publish, not just read. **The existing `enforces` gate touches only adoption from the
church's signed list, and `relaysForChurch()` — the function that honours it — is used for READS. Every
publish call site (33 via `churchRelays()`, ~20 via `Fellowship.relays`, all console writes via `relays()`)
uses the raw list.** The owner's summary — "that reasoning covers SYNC and not PUBLISH" — is exactly right,
and now measured.

---

## 4. What breaks if the network closes

I went looking for a feature that genuinely needs a generic relay. **There isn't one.**

| Capability | Depends on a generic relay? | Survives? |
|---|---|---|
| Reach / redundancy — the original Jun 11 reason | The "extra public relays" feature is the *stated* redundancy story | **Yes, and the truth is worse than the loss.** Redundancy today is `CANONICAL_RELAYS`, which I measured to be **one box**. Closing the network removes the *illusion* that extras were the backup. Nothing real is lost; something real is exposed. |
| Discovery / Auto-find | `/relay-names/offers` + `pickRelays` | **Narrowed, not lost.** Offers filtered to network members. |
| Joining a self-hosted church | `?relay=` / `?relayname=` in the invite | **Yes**, provided that relay is enrolled (§6). The hint becomes a candidate rather than an instruction. |
| The name directory | open claims by design | **Yes**, if clients ignore non-member entries. Do **not** make the directory itself members-only first (§8). |
| Backup / restore | carries `trinityone.relays` | **Yes** — filter the relay keys on restore. |
| Cross-relay sync | already TrinityOne-only by `relayPub` presence | **Unaffected** — this half was always closed. That is what the misleading comment describes. |
| Media / blobs | `_blobBase()` derives from `ownRelay()` | Unaffected. |

**Nothing in the product needs an outside relay.** The only real cost is administrative: someone must decide
who is in the network, which is a cost the owner has already accepted by making that judgement ours rather
than a churchwarden's.

---

## 5. The failure mode that matters most: what happens when a relay cannot be verified right now

The brief is right that this is where a gate lives or dies. My answer, and my reasoning:

**Fail closed. Everywhere. And it costs nothing here — which is unusual and is the whole argument.**

The fear behind "fail open" is *a church that cannot publish at all*. That cannot arise, because the fallback
set is non-empty by construction and needs no network to be trusted:

- `CANONICAL_RELAYS` is a literal in the bundle. Its membership is decided at build time, not at runtime.
- `loadRelays()` already refuses to return an empty list (`e4b3e0f`, "Critical: never leave relay list empty").
- `relays()` already appends `CANONICAL_RELAYS` unconditionally (`d469673`).

So "unverifiable → excluded" degrades to *the set we shipped*, never to *nothing*. **An unverified relay
contributes nothing a verified one does not.** There is no urgency argument for admitting it.

The place fail-closed *would* bite is a self-hosted church whose own box is its real store: if a transient
probe failure dropped it, they would publish only to a8, which may not hold their history. The answer is not
to fail open — it is **not to re-decide under time pressure at all**:

- Verification result is **persisted** (`{url → {relayPub, credential, verifiedUntil}}`), so a boot with no
  network still knows what it knew yesterday.
- A cached-verified relay stays in the set until its credential expires, with re-verification in the
  background. Never verify-or-drop on the hot path.
- A relay that has **never** been verified never enters the set. That is the only synchronous decision, and
  its answer is always "no".

This is the same shape as `_relayInfo`'s existing "fail-closed: unreachable/unparseable/timeout = no
capability info" and the same shape as `_applyChurchList`'s "unreachable → retried on next churn". It is
already the house pattern; it only needs to reach the publish path.

**Should a child's care request and a chat message be treated differently? No — and I think offering the
option would be the mistake.** The difference between them is only visible at the call site, and there are 50+
call sites. A per-content-class rule is the exact shape that produced this defect: a rule true of one path,
believed to be true of the system. One set, one rule, enforced where the socket opens.

There *is* a real asymmetry, but it belongs to honesty, not to gating: if a relay set has degraded to
cached-only, a care request should say it is queued rather than land on one relay and look sent. That is the
`fix-the-control-not-the-label` lesson, and it is a UX item (§7 post-pilot), not a gate item.

**Reads and writes get the same rule too.** Splitting them is how we got here: `3c78912` chose a read-routing
rule and publish escaped it. Reading from a stranger's relay leaks who is asking about which church; writing
hands over the corpus. The owner's words cover both.

---

## 6. The mechanism: two roots, no registry

**What identifies a TrinityOne relay must be a signature the client can check offline, carried by the relay
itself.** Not a lookup. A client that must reach a registry to connect has a worse single point of failure
than the one `RELAY-NETWORK-ROBUSTNESS.md` warns about, because it gates every session rather than only
joining.

A relay is admitted if **either** root vouches for it, **and** it proves possession of the key that was
vouched for:

**Root A — the TrinityOne network key.** A credential `{relayPub, notAfter, iss}` signed by a network root
whose *public* key is baked into `src/fellowship.src.js` and `src/steward.src.js`. The relay serves its own
credential. **Bake several root pubkeys from day one and accept any** — `memory: signing-key-governance` says
a multi-key root is cheap now and impossible later, and TUF is the model.

**Root B — the church's own key.** A relay named in the church's own signed `d=trinityone/relays` doc, which
already carries `[{pubkey, url}]`, and which proves possession of that pubkey. This keeps the authority where
every other trust edge in this codebase puts it, and it is what keeps self-hosting and the desktop Suite
alive. It is also the same check that closes G1 on the server side — one mechanism, both ends.

**Root C — same machine.** A loopback relay on the console's own origin (the desktop Suite). Not a trust
decision; it is the same computer. Must be narrow (`127.0.0.1`, `localhost`, `::1` on the serving origin) and
must have its own test, because **this is the most likely way to brick something real.**

**Proof of possession is mandatory and does not exist today.** The relay must sign a *client-supplied nonce*.
`relayProof()` already builds exactly this event shape with `RELAY_SK`; a client-facing variant is small.

**What this deliberately does not claim** — and the codebase already says it, at `steward.src.js:766`: nothing
remote can prove the operator is not reading their own database. Membership raises the floor from "anyone with
a keypair" to "someone we or the church vouched for and can revoke". Do not let the plan's copy overclaim it.

---

## 7. The plan

Ordered so an executing agent starts at the top. **Audit after every two items** (CLAUDE.md rule 5).

### Deployment sequencing — read before item one

C2 and C3 change what a *relay* serves. C4 and C5 change what a *client* accepts. **If a client that requires
proof ships before every relay can produce it, the fleet disconnects.** Relay first, client second, with the
canonical box confirmed upgraded before any client gate is built. There is no relay auto-update yet
(`memory: relay-auto-update-wanted` — "only the WHEN is missing"), so the upgrade is manual and must be
verified by reading `/status` `versionShort` on every box in the network, not assumed.

---

### PRE-PILOT

Pre-pilot is anything that lets a church's corpus reach a machine nobody vouched for. Post-pilot is anything
that only makes membership easier to administer.

---

#### C1 — Stop the product telling stewards to add generic relays

*Pure removal. No dependency on anything below. Do it today.*

**What a person experiences if this is missing.** A churchwarden opens the Relays panel. The box they are
meant to type in reads `nos.lol · relay.damus.io · wss://relay.example.com`. If they get it wrong the error
says *"e.g. nos.lol"*. The panel below reassures them that *"public relays (nos.lol etc.) stay publish-only,
so gated content never leaves your own infrastructure."* They do what the product told them to, believing the
sentence the product printed. **They are not making a mistake; they are following instructions.**

**The change.** Remove the suggestion and the false reassurance:
- `app/stew-dashboard.jsx:3289` — placeholder → the church's own address form only.
- `app/stew-dashboard.jsx:3150` — error text.
- `app/stew-dashboard.jsx:3360` — delete the "publish-only… never leaves your own infrastructure" clause. It
  is a claim no test proves and it is false (CLAUDE.md rule 4 applies to shipped copy as much as to commits).
- `app/identity-extras.jsx:499-506` — delete `SUGGESTED_RELAYS` and the unrendered `commitAdd` flow with it.
- `app/screens-chat.jsx:117` — delete the dead `addRelay` (it explicitly permits `ws://`).
- `app/data.jsx:323-328` — mock `RELAYS` naming `relay.damus.io`/`nos.lol`.
- `src/steward.src.js:2592-2594` — rewrite the comment that started this. Say what is true: the filter is
  `syncEnable()`'s, it never governed publish.

**Consumers (rule 2 — grepped at `451e7c6`; re-grep before editing).** `app/data.jsx` `RELAYS` is read at
`app/identity-extras.jsx:520` and `app/screens-chat.jsx:105` as a display-only fallback when
`window.Fellowship` is absent — both must keep rendering with an empty list. `SUGGESTED_RELAYS` has no other
reader. `commitAdd`/`remove`/`toggle`/`adding`/`url`/`err`/`remaining` in `identity-extras.jsx` are computed
and never rendered (JSX at `:562-581` is read-only) — confirm that before deleting, not after.

**Point-of-use test (rule 1).** A repo scan asserting that no generic public relay hostname appears anywhere
in `app/`, `src/` or `vendor/`. **On rule 3:** that rule forbids asserting *behaviour* by matching text in
`app/*.jsx`, because `false && ` leaves the words in place. An **absence** assertion is sound — dead code
cannot hide a deleted string, and re-adding one makes the test red immediately. Seed it with
`relay.damus.io`, `nos.lol`, `relay.snort.social`, `nostr.wine`, `relay.primal.net`, `relay.trinityone.app`.

**Backwards compatibility.** None. No wire change, no stored state.

**Size.** An hour, and it is the only item that reduces risk by deleting.

---

#### C2 — A relay proves it holds the key it advertises

**What a person experiences if this is missing.** Nothing — until the day it matters, and then everything.
Without it, every gate below is decoration: any host can serve a8's `relayPub` and be trusted as a8.

**The change.** In `scripts/gateway.mjs`: `GET /relay-identity?nonce=<32 hex>` returns a kind-27235 event
signed by `RELAY_SK`, tags binding the nonce, the relay's own public URL and `created_at`. Model it on
`relayProof()` (`:528`) and `relayNameClaimEvent()` (`:536`) — the shape and the signing key already exist.
Client side: one shared `verifyRelayIdentity(url) → {relayPub} | null` that generates the nonce, fetches,
verifies the signature, checks the nonce and the freshness window, and fails closed on anything else.

**Consumers.** New endpoint; no existing consumer changes in this item. Grep before editing anyway: `RELAY_SK`
has exactly three uses (`gateway.mjs:526,528,536`) and `relayPub` is emitted at `:3095` (`/status`) and
`:3439` (NIP-11) — both stay, both remain unproven claims, and the comments must say so.

**Point-of-use test.** Boot a **real** `scripts/gateway.mjs` on a free port (`requireFreePort`, the pattern in
`scripts/test-ports.mjs`) and assert: a fresh nonce verifies; **a replayed proof is rejected**; a proof signed
by a different key fails; a host that merely echoes `/status`'s `relayPub` cannot produce one. Sabotage,
scoped to the handler function (CLAUDE.md's sabotage rule — slice the function, assert the anchor appears once
inside it, then replace): make the endpoint return a static pre-signed event → the replay test must go red.

**Backwards compatibility.** A relay older than this cannot prove identity, and under C4 is excluded. **That
is the sequencing constraint above, and it is the single largest deployment risk in this plan.**

**Size.** Half a day of code. The cost is the rollout, not the endpoint.

---

#### C3 — Network membership: the credential and the two roots

**What a person experiences if this is missing.** A church can be pointed at a machine nobody vouched for, and
neither the church nor we can tell. The churchwarden is left holding the judgement `DOMAIN.md` says is ours.

**The change.**
1. Generate the network root keypair(s) **offline**, custody per `reference/SIGNING.md` and
   `memory: signing-key-governance`. **Several roots; any one suffices.**
2. Bake the root *public* keys into `src/fellowship.src.js` and `src/steward.src.js` beside `CANONICAL_RELAYS`
   — **two copies, one meaning**; the same "change together" hazard the hardening plan flags for
   `CANONICAL_RELAYS` applies verbatim.
3. Relay serves its credential from `/relay-identity` alongside the C2 proof; credential file `0600` in
   `DATA_DIR`, mirroring `relay-key.json` (`gateway.mjs:523-526`).
4. Client `isNetworkRelay(url)`: C2 proof succeeds **AND** (root-A credential valid and unexpired **OR**
   root-B: the pubkey appears in this church's own signed `trinityone/relays` doc **OR** root-C: loopback on
   the console's own origin).
5. Issue credentials for the canonical box and any relay a pilot church actually runs.

**Consumers.** `CANONICAL_RELAYS` at `src/fellowship.src.js:592` and `src/steward.src.js:542`;
`relays-always-canonical.test.mjs` guards part of the pair. `TRUSTED_RELAYS` / `RELAYS_D` ingest at
`gateway.mjs:1620`. `_relayInfo` (`fellowship.src.js:965`, `steward.src.js:731`) — the `enforces` flag is
**superseded as an adoption criterion** and must not be left looking like a gate.

**Point-of-use test.** Two real gateways: one credentialled, one not. Drive a church publish and assert the
uncredentialled gateway's store is **empty** — count events on the relay, not calls in the client. Sabotage
scoped to `isNetworkRelay`.

**Backwards compatibility.** Old client + new relay: unchanged (extra endpoint ignored). New client + old
relay: excluded — see sequencing. Three pilot churches and no installed base is the reason this is doable now
and not in six months; say so to the owner as the argument for timing.

**Size.** Two to three days, most of it key custody and rollout, not code.

---

#### C4 — One chokepoint per client, three layers deep

**What a person experiences if this is missing.** The gate exists and something walks round it — which is the
history in §1 repeating with better intentions.

**The change.** Do not gate 50 call sites. Gate where the list is made and where the socket opens.
- **Member.** `setRelays` (`fellowship.src.js:2765`) is the sole writer of the persisted list — filter there.
  `loadRelays` (`:712`) is the sole reader and today does **no** shape check — filter there too, which is what
  covers a restored backup (M12) and any list already on a device. `_publishAny` / `churchRelays()` /
  `relaysForChurch()` as the last line, so a future writer cannot bypass.
- **Console.** `extraRelays()` (`:595`) is the sole reader of the persisted key; `relays()` (`:709`) is the
  sole assembler. Filter both, and in `publish()` (`:1753`).
- **Async, without breaking a synchronous API.** Persist a verified-set cache
  `trinityone.relays.verified = {url: {pub, until}}`. The synchronous filter consults the cache only. A URL
  that is not yet known goes to a pending list and is verified in the background, entering the live set only
  on success. Never verify-or-drop on the hot path (§5).

**Consumers (rule 2).** Every entry in §3: M1–M16 and S1–S12. Specifically — member readers of
`Fellowship.relays`: `app/identity-extras.jsx:520`, `app/screens-audio.jsx:173`, `app/screens-chat.jsx:322`,
`app/identity.jsx:1609`, plus 33 `churchRelays()` sites and ~20 `_publishAny(window.Fellowship.relays, …)`
sites in `src/fellowship.src.js`. Console readers of `relays()`: `steward.src.js:484, 957, 1753, 1856, 1961,
1968, 2014, 2321, 2340, 2597, 2795, 2902, 2929, 2953, 3012, 3026, 3093, 3247, 3286, 3319, 3329, 3340, 6403`.
**Re-grep this list at the executing commit — it is the exact list that will be wrong if anything moved.**

**Watch the two known traps.** `memory: relay-url-normalisation-trap` — the pool keys relays by
`normalizeURL()` and a raw `.get()` misses silently; the verified-set cache must key the same way, or the gate
misses the relay it is about. And `_dedupeRelays`/`_wedgeKey` (`fellowship.src.js:2172`) already normalise for
a different reason — reuse, do not re-invent.

**Point-of-use test (rule 1).** Two real gateways, only one credentialled. Drive the **console's Add-relay
control** — the thing a steward touches — at the uncredentialled one, then publish a church document, then
count events on that relay. Must be zero. **This test fails if the feature is deleted from the screen, not
only if the engine changes.** Sabotage: delete the filter inside `relays()` (scoped: slice the function,
assert the anchor appears exactly once inside it before replacing — near-identical siblings are this
codebase's house style and a plain string-replace hits somebody else's).

**Backwards compatibility.** A device with a non-member relay already in localStorage silently loses it at
next load. **That is the intent**, but it must be *visible*: a one-line note in the Relays panel saying which
address was dropped and why. Silently changing where a church's data goes is how the divergence in
`ROADMAP-NOTES §6` became invisible.

**Size.** Two days.

---

#### C5 — Close the remote-input paths

**What a person experiences if this is missing.** They scan a code at the church door and their phone starts
publishing their DMs and their child's care request to somebody else's machine. Nothing on screen changes.

**The change.** Every one of these becomes *a candidate for verification*, never an instruction:
- `?relay=` (`app/app.jsx:715-718`) — verify before `addRelay`.
- `?relayname=` (`:743-750`) — verify, **and drop the "use the invite's own host as the resolver" step**. An
  invite that chooses both the question and the answer is not a hint, it is a redirect. The comment claiming
  "no new trust" was true only while `?relay=` was itself adopted unverified; once C4 lands, that argument
  inverts and the line must go.
- `refreshNamedRelays` (`steward.src.js:632-645`) — re-verify on every swap. **This is the most
  under-appreciated path in the codebase: it runs every 90 seconds and on every window focus, forever, with
  no user action after the first connect.**
- `resolveRelayName` (console, `:598-607`) — add the scheme check its member-side twin has had since L5
  (`fellowship.src.js:2806`), then the membership check.
- `discoverRelayOffers` / `autoPickRelays` — filter offers to members. Keep `_probeRelayEnforces` as a
  **secondary** check; it is a good behavioural test and a bad membership test, and the distinction should be
  written into its comment.
- Backup restore — drop `trinityone.relays` from `MEMBER_PREFIXES` (`app/backup.jsx:144`) and exclude
  `trinityone.steward.extra-relays` / `.relay-names` from `STEWARD_PREFIXES` (`:157`). A restore should
  recover a church, not a routing table.
- `cloneFromRelay` (`stew-dashboard.jsx:3187`) — gate the source host. It streams the whole corpus including
  safeguarding cleartext.

**Consumers.** `followChurch` callers: `app/app.jsx:844` (browser query), `app/screens-church.jsx:191` (QR),
the native `safeQuery` path (`:571-577`), and `join.js:26` (the public forwarder). `restoreLocal` callers:
`applyMember` and `applySteward` (`app/backup.jsx:139,193`) — `backup-file-safety.test.mjs:114,129` already
asserts over `trinityone.relays` and **will need updating; account for the delta** (rule 8).

**Point-of-use test.** A crafted join link naming a real, running, uncredentialled gateway; drive the QR/link
path; assert that gateway's store stays empty. Separately, a directory record that re-points a claimed handle
mid-session and an assertion that `refreshNamedRelays` does not adopt it.

**Backwards compatibility.** A printed invite naming an unenrolled relay stops working. **Enrol the pilot
churches' relays before this ships**, and make the failure legible ("this church's relay isn't in the
TrinityOne network yet") rather than a silent nothing.

**Size.** One to two days.

---

#### C6 — The relay must not reach out anywhere either (G1)

*Independent of the client work — no coupling, no sequencing. Highest value per hour in the plan.*

**What a person experiences if this is missing.** Nothing visible, ever. Meanwhile the relay makes
authenticated requests to a host of the document's choosing, carrying a NIP-98 signed with its own identity
key. On a relay accepting hosting offers, any stranger who self-registers a church can steer it.

**The change.** In `gateway.mjs:1620-1623`, validate before `PEER_URLS.set`: scheme `wss:`/`https:` only, a
parseable host, no loopback/link-local/RFC1918 target. Then — the real fix — **before any request to a peer
carries `relayProof`, confirm the host at `url` actually holds the `pubkey` the church paired it with in the
same document**, using the C2 proof. The pairing is already in the data; nothing has ever checked it.

**Consumers.** `PEER_URLS` readers: `syncAllChurches` (`:4550`), `syncChurchFromPeer` (`:4429`),
`reconcileChurchWithPeer` (`:4474`), `syncMediaFromPeer` (`:4511`), and the `sync.peers` count in `/status`
(`:3096`). `TRUSTED_RELAYS` is set from the same branch and separately authorises `/sync` full-corpus reads
(`_syncAuth`, `:242-250`) — **do not change one without the other.**

**Point-of-use test.** Three processes: two real gateways and a plain HTTP listener that records requests.
Publish a church `trinityone/relays` doc naming the listener's URL paired with gateway B's pubkey. Assert the
listener receives **nothing**, and specifically no `Authorization: Nostr` header. Sabotage scoped to the new
check in the `RELAYS_D` branch.

**Backwards compatibility.** A church whose current list has a URL/pubkey mismatch stops syncing that peer.
Measure the live `trinityone/relays` docs on a8 before shipping — if any are mismatched, that is a real church
losing sync, and it needs a console message, not a silent stop.

**Size.** Half a day.

---

#### C7 — The two-gateway harness every test above needs

This is `PLAN-RELAY-HARDENING`'s **P5**, and under this decision it stops being a standalone item and becomes
a **dependency of C2, C3, C4, C5 and C6**. Promote it accordingly: build it immediately after C1, before C2.

Its existing brief stands (own ports via `requireFreePort`, force-exit, no fixed ports — the worktree note in
CLAUDE.md about fixed-port collisions applies). Add to it: a *third* participant that is deliberately **not**
a network member, because "the corpus did not reach it" is the assertion every item above needs and no
existing harness can make.

**Size.** A day, as the hardening plan estimates. It buys five tests.

---

#### C8 — A second canonical box (owner decision — now urgent, not deferred)

`PLAN-RELAY-HARDENING` filed this as deliberately-not-pre-pilot on the grounds that it is an
ownership/ops/governance decision rather than a code edit. That reasoning was sound **while extras existed**.

I measured it: `app.trinityone.church` and `trinityone-master-01.tailbeaac0.ts.net` return the **same
`relayPub`**. The moment extras are banned, the TrinityOne network *is one machine in one building*, and
`pickRelays`' different-operator preference has literally nothing to pick from. Under this project's own
threat model — lawful compulsion and seizure — that is the whole network in one warrant.

**This is not a reason to delay closing the network.** An open network with one box is strictly worse than a
closed one with one box: it has the same seizure exposure *plus* every path in §3. But it does mean the
closure and the second box should be decided in the same conversation.

**Size.** Not a code item. If a box materialises, the code change is the one the hardening plan already
specifies (both `CANONICAL_RELAYS` literals, `DIRECTORY_PEERS`, rebuild with `build:fellowship` /
`build:bundles` — **not** `build:vendor`, which exits 0 and rebuilds nothing of ours — then grep the built
file to prove the URL landed).

---

### POST-PILOT

Everything here only makes membership *easier to administer*. None of it lets a corpus reach an unvouched
machine, which is why none of it is pre-pilot.

- **Self-host enrolment UX.** A "Join the TrinityOne network" button in the relay control panel that posts the
  relay's proven `relayPub`; we approve; the relay pulls its credential. Pre-pilot, enrolment is us running a
  script for three churches — which is fine and is also a deliberate slow path while the shape settles.
- **Revocation distribution.** Short-lived credentials re-issued on a schedule, plus a revocation list shipped
  with app updates and gossiped. **Never a blocking online check** (§8).
- **Directory-side membership filter.** Relays refusing to *store* non-member claims. Client-side filtering
  (C5) delivers the same safety without coordination and works against relays that have not upgraded — do the
  client half first, and only consider the server half once every relay is upgraded.
- **Degraded-set honesty.** When a client is publishing to fewer relays than it expects, say so where the
  person is — especially on a care request (§5).
- **`src/mydata.src.js:103`** — the `ws://127.0.0.1:7447` cleartext fallback. Harmless today; wrong under the
  new rule.
- **A relay MODE**, per `ROADMAP-NOTES §7`. `CHURCH_PUBS.size === 0` still answers three unrelated questions,
  and under a closed network "generic relay" becomes a mode that must be explicitly *outside* the network
  rather than an accident of configuration.

---

## 8. Challenging the edges of the decision

The decision is made. These are the places it bites in ways that may not have been pictured.

**A church that already runs its own relay: does it have to do anything?** Under root B (§6) — **no, provided
its console has published its `trinityone/relays` doc**, which is what the hardening plan's P3 is about. If
only root A existed, every self-hoster would need us to issue a credential before their own box worked, and
the first pilot church to self-host would hit that on the day. **Root B is what makes the rule survive contact
with a real church, and I recommend it be treated as non-optional rather than as a nicety.**

**Someone self-hosting: how do they join the network?** Root B covers "my own church's relay". Root A covers
"a relay hosting churches that are not its operator's" — which is what `quitedoverelay` and `steady-harbor-18`
are advertising themselves as right now. Those two become un-addable the day C4 ships. With three pilot
churches and no installed base, the blast radius is near zero. **That is the strongest argument for doing this
now rather than after the pilot, and it should be the argument put to the owner.**

**Is there any legitimate reason to reach a non-T1 relay that we would be removing?** I looked hard. **No** —
with one caveat worth stating: "non-TrinityOne" has two readings, and they produce different plans.

> **Reading 1 (strict): only relays TrinityOne operates.** Simple, and for three churches on one box it is
> fine. It also ends self-hosting, contradicts `ROADMAP §4` ("open relays support churches that cannot
> self-host"), and hands us a lever the persecuted-church positioning specifically avoids: *TrinityOne can
> switch your church off*.
>
> **Reading 2 (network): relays running TrinityOne software, admitted by a TrinityOne-signed credential or by
> the church's own signature.** Self-hosting survives. The authority stays with the church for the church's
> own box, exactly as every other trust edge in this codebase does.

**I recommend Reading 2**, because it is what `DOMAIN.md`'s own phrase — "a network in and of themselves" —
most naturally means, and because Reading 1 quietly deletes a roadmap commitment. **But this is the owner's
call and it is the first question to ask**, because C3 is built differently under each.

**The edge that will actually break something:** the desktop Suite boots a relay on loopback and the console
talks to it before any church document exists. A naive gate bricks it on first run. Root C exists for this,
and it needs its own test rather than a comment.

**The edge nobody has priced:** issuing credentials makes us the party who decides who may run a relay for a
church. Under `memory: uk-pilot-threat-model` — lawful compulsion — a signing key that can admit or revoke
relays is a new thing that can be compelled, and it did not exist before. It is still the right trade (the
alternative is a churchwarden making the same judgement with less information), but it should be a decision
taken with open eyes, and it is the reason for multiple roots and offline custody from day one.

---

## 9. What should NOT be built

- **No central membership registry a client must reach.** This is the trap `RELAY-NETWORK-ROBUSTNESS.md`
  names, and worse: a canonical *host* going away breaks joining, a canonical *registry* going away breaks
  every session. The credential must travel with the relay and verify offline.
- **No online revocation check.** OCSP-shaped lookups are the same trap wearing a different hat, and they
  fail exactly when the network is under pressure. Short expiry plus a shipped/gossiped revocation list.
- **No "advanced mode" to add an arbitrary relay.** The owner's second requirement kills it: an escape hatch
  *is* a choice, and it becomes the social-engineering vector — "your area dean says add this address".
- **No behavioural probe as the membership gate.** `_probeRelayEnforces` is good and should stay as a
  secondary check, but its own comment already says what it cannot do: *"it cannot prove the operator is not
  simply reading their own database. Nothing remote can."* Membership is a vouching question, not a behaviour
  question.
- **No read/write split, and no per-content-class split.** §5. Both are the shape that caused this.
- **Do not delete the `extraRelays` machinery.** It is the pipe a self-hoster's own relay travels through.
  Change what may *enter* it, not that it exists.
- **Do not make the name directory members-only before the clients filter.** It looks like the tidy fix and it
  requires every relay to upgrade in lockstep; the client-side filter is strictly safer and needs no
  coordination.
- Everything already on `PLAN-RELAY-HARDENING`'s not-to-build list still stands.

---

## 10. Cross-check against `reference/PLAN-RELAY-HARDENING-2026-09-01.md`

That plan was written at `ba913fc` under the open model. Item by item:

| Item | Status under this decision |
|---|---|
| **P1** — multi-relay join artefacts | **Survives, but must be re-ordered.** Its premise ("several relay hints on paper") is sound; but every hint must now be a network member and must be *verified* before adoption, so P1 depends on C2–C5. It was filed as "do it first"; it can no longer be first. Printing hints for relays that will later be excluded is worse than printing one. |
| **P2** — restore-path name resolution without the canonical host | **Survives, small addition.** Resolving names at more mirrors is still right; the *resolved URL* must pass C5's verification before adoption. |
| **P3** — publish kind-10002 on every relay-set change | **Survives and gains importance.** The church's signed list becomes **root B** — the thing that keeps self-hosting working. It stops being hygiene and becomes load-bearing. Raise its priority. |
| **P4** — find/rebuild the R2/R3 tests, pin the app's point of use | **Survives, but its target moves.** Several of the R1–R6 tests it hunts for assert over `trinityone.enforces` as the adoption criterion; C3 supersedes that flag. Merge P4's point-of-use sabotage work into C4 and C7 rather than running it separately against a gate that is about to change. |
| **P5** — two real gateways, provable convergence | **Survives and is promoted.** Becomes C7, a dependency of five items rather than a standalone. Add a deliberately-non-member third participant. |
| **Q1** — withholding / read-back | **Unaffected.** Still post-pilot, still the right shape. |
| **Q2** — URL rot for named relays | **Partly obviated.** C5 re-verifies on every swap, which is the safety half. The `{pubkey, url, name}` field is still worth having, and C6 needs the `pubkey` half anyway — fold Q2's field addition into C6. |
| **Q3** — bounded reconciliation + tag index | **Unaffected.** |
| **Q4** — widen directory gossip mirrors | **OBVIATED, and inverted.** Its entire safety argument is *"pulling signed claims from an untrusted source is safe by construction"*. I proved the opposite risk: the danger is not a **forged** claim, it is a **genuine** claim from a non-member — which `verifyClaimEvent` accepts by design, because that is what it was built to do. Widening mirrors widens exposure to exactly those. **Do C5's client-side filter first; only then reconsider Q4.** The plan's own instinct — flagging Q4 as having "the convenient addition shape the owner warned about" — was right. |
| **"Second canonical box" (deliberately not pre-pilot)** | **PROMOTED to a pre-pilot decision.** See C8 and the measurement in §2(c). |
| Its `What should NOT be built` list | **Still stands**, extended by §9. Its "no new bootstrap transports" entry gains force: under a closed network, a rendezvous everyone must reach would be both the centralisation trap *and* the registry trap. |

Two corrections to that plan's verification ledger, both measurable in a minute and both now measured:
its **open question 3** (are a8 and master-01 one box?) — **yes, same `relayPub`**; its **open question 2**
(does the shared pool relay claim a directory name?) — a8's NIP-11 advertises `open: true, churches: 12`, and
the offers list it serves does **not** include itself under a handle, so it has not claimed one.

---

## 11. What I could not settle without the owner

1. ⛔ **Reading 1 or Reading 2 of "non-TrinityOne relay"** (§8). C3 is built differently under each. This
   blocks C3 and should be answered before C2 starts.
2. ⛔ **Who holds the network root keys, and how many.** Multi-root is cheap now and impossible later. This
   blocks C3.
3. **The second canonical box** (C8) — unchanged from the hardening plan's question 1, but now urgent rather
   than deferred.
4. **Are `quitedoverelay` and `steady-harbor-18` ours?** They are live in the production directory today,
   advertising open hosting, and auto-pick ranks them above a8. If they are test boxes they should be
   withdrawn from the directory now, before the pilot, regardless of anything else in this plan.
5. **Does anything in the pilot rely on `cloneFromRelay` from an arbitrary host?** It exfiltrates the whole
   corpus and I could not tell from the code whether it is a real operational route or a development
   convenience.

---

## 12. Rule-7 assumptions — stated so they can be corrected

1. *No pilot church will self-host in month one, so enrolment can be a script we run.* INFERRED from pilot
   scope. If wrong, root B (§6/§8) moves from "recommended" to "blocking".
2. *A printed join artefact outlives the URLs on it.* Inherited from `PLAN-RELAY-HARDENING` P1; it is why C5's
   failure message matters more than C5's gate.
3. *A church will never knowingly want its data on a public Nostr relay.* ESTABLISHED by `451e7c6`.
4. *A steward will not notice a relay silently leaving their list.* INFERRED — it is why C4's
   backwards-compatibility note asks for a visible line rather than a silent drop.

If the owner corrects any of these, write the correction into `reference/DOMAIN.md` in the same sitting
(CLAUDE.md rule 7).

---

## 13. Verification ledger

**Run, not read** (probes against a locally booted `scripts/gateway.mjs` with `TRINITY_DATA_DIR` pointed at a
scratch directory, plus unauthenticated public GETs against production):
- `/status` and NIP-11 return `relayPub` with no proof of possession; no client-facing challenge exists.
- `POST /relay-names/claim` accepted a claim signed by a throwaway key for an unclaimed handle, pointing at an
  arbitrary URL — `200 {"ok":true}` — and it then resolved and appeared in `/relay-names/offers`. Directory
  gossip is pull-only, so the forged record stayed on the local instance; production was not touched.
- `app.trinityone.church` and `trinityone-master-01.tailbeaac0.ts.net` return the same `relayPub`
  (`6a4267…70f2`).
- a8's live `/relay-names/offers` returns `quitedoverelay` and `steady-harbor-18`; the latter answered NIP-11
  as up, `enforces: true`, build `200b917`.

**Read at `451e7c6`, file:line opened** (not trusted from a summary): every line cited in §3; `relays()`,
`publish()`, `extraRelays()`, `normRelay`, `refreshNamedRelays`, `resolveRelayName` (both), `relayIdentities`,
`syncEnable`, `discoverRelayOffers`, `_probeRelayEnforces` in `src/steward.src.js`; `setRelays`, `loadRelays`,
`_applyChurchList`, `relaysForChurch`, `subscribeChurchRelays`, `_publishAny`, `_relayInfo`,
`discoverRelayOffers` in `src/fellowship.src.js`; `followChurch`, `safeQuery`, the QR path,
`MEMBER_PREFIXES`/`STEWARD_PREFIXES`, the console Relays panel and its placeholder;
`verifyClaimEvent`/`applyClaimRecord`, the `RELAYS_D` ingest branch, the sync loop, `relayProof`,
`RELAY_SK`/`RELAY_PUB` in `scripts/gateway.mjs`.

**Suite baseline at `451e7c6`, for rule 8** (`npm test`, with `node_modules` copied into the worktree):
**2391 tests — 2386 pass, 1 fail, 3 skipped, 1 todo.** The single failure and all three skips are
`scripts/sim-harness-dialogs.test.mjs`, confirmed by running that file alone: `scripts/sim-*.mjs` is
gitignored, so its driver-count guard fails and three subtests skip on "sim-actor.mjs is not in the
repository (commit `1a79a27`, it carried private keys)". **Not a code failure**, and it accounts for the whole
delta — an executor who sees any other number has changed something.

**Taken from history without independent re-derivation:** the commit messages quoted in §1 are verbatim from
`git show`; I did not re-verify that each commit's *code* matched its message beyond the lines still present
at `451e7c6`.

**Not done, and it matters (CLAUDE.md rule 6):** none of this has been on a device. The C4 and C5 items change
what a phone connects to; both need driving on the attached phone before merge, not only a green suite.

**Could not settle without the owner:** the five questions in §11.
