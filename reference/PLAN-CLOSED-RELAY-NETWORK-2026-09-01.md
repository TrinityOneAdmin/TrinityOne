# Closing the relay network — investigation and plan

**Target:** `fix/console-sweep-defects`. The investigation was read/measured at `451e7c6`; re-scoped at the
branch tip `e73d249`, which adds the owner's answer to `reference/DOMAIN.md`. **Amended at `43ae82d`** after
an adversarial pass returned **NO-GO as written, GO after amendments**: its four blocking findings are folded
in below (marked **AMENDED 2026-09-01** — §0-bis maps each finding to where it landed), the deployment order
is rewritten (§7), and a scope judgement now opens the document. Read-only; no code was changed in any pass.

**The decision being planned for** is the two `reference/DOMAIN.md` entries under *Trust, privacy and tone*:
a church must never reach a non-TrinityOne relay, a church must never have to choose, **and** — the newer
entry — a church relay holds the church's data *and nothing else, because it may be seized*.

---

## First: is this still the fix, or a project that merely contains it?

This started as **one defect: a child's sealed request for help can be published to a relay with no
safeguarding gates, because the product itself suggests adding one** (the `nos.lol` placeholder — §1, §3
shortest-path 3). Three passes later it is a network-membership architecture. Both halves are real; they are
not the same size, and with a pilot a month away the owner should be able to buy them separately. Plainly:

**The plan still solves the original problem — but only five of its items do the solving.**

| Role | Item | Why |
|---|---|---|
| closes the leak | **C1** | removes the suggestion and the false reassurance — the "because the product suggests it" clause, gone the same day |
| closes the leak | **C4** | the actual fix: the publish fan-out only ever reaches vouched relays, whatever route a URL arrived by — typed, restored, remembered, scripted |
| mechanism | **C2 + C3′** | the predicate C4's filter consults; without them C4 has nothing to ask |
| proof | **C7** | the harness without which none of it is testable at the point of use |
| same leak, other doors | **C5** | QR / church-list / named-relay routes — the same corpus to the same stranger, without even a steward's keystroke |

**The minimum subset that closes the leak is C1 + C7 + C2 + C3′ + C4 — roughly four to five days.** C5 is one
to two more and I would spend them: a scanned QR that silently re-routes a child's care request is the same
harm as the placeholder with a worse consent story. Everything else — C6 (server-side SSRF: real, but a
different leak), C8 (seizure exposure, not a leak), §6-bis's adoption/migration work, the Suite site work
(§6-quater), the part-time flag (§6-ter), the whole post-pilot list — is membership *architecture*. It is why
the fix will still be correct in a year, and none of it has to ship before the pilot for a child's request to
stop reaching a gateless relay.

**C1 + C2 alone do NOT close it.** C1 stops the product suggesting the leak, but a steward can still type
one and a QR can still add one; and C2 is an endpoint nothing consults until C4 exists. The gate (C4) and its
predicate (C2 + C3′) travel together or not at all. The good news is that C3′, re-scoped and amended, is half
a day — there is no meaningful corner left to cut below the five-item core.

---

## 0. The fork is resolved — read this first

The earlier draft of this plan (below, preserved) forked on two readings of "non-TrinityOne relay" and called
that its first blocking question. **The owner has answered it, and the answer is now in `DOMAIN.md`:**

> *"people that run our specific relay software"* — and, on why it matters: *"we don't want bloat on a
> persecuted church relay."*

So this is now **one plan, not a plan with a fork**:

- **Anyone may run the relay software and join the network.** Self-hosting stays. Membership is *running the
  enforcing software and being vouched for by a church's own signature* — not a credential we hand out.
- **We issue no credentials to individual operators, and we never become the party who can revoke a church's
  relay.** The earlier draft's "Root A — TrinityOne network key" was exactly that revocation lever. The owner's
  reading removes it, and `DOMAIN.md` says so explicitly: *"we never become the party who can revoke a church's
  relay. That was the sharpest risk in the closed-network plan and this definition removes it."* **Root A is
  therefore dropped from this plan.** The membership mechanism collapses to the church's own signature (was
  "Root B") as the primary path, plus loopback for the desktop Suite's first run (was "Root C").
- **"Bloat" means accountability on a seizable box, not disk.** A congregation explaining its own records is
  one conversation; explaining a thousand strangers' profiles that arrived because the software allowed them is
  another. Where this plan touches *what a relay accepts*, that is the reasoning (§7 post-pilot, §2 note).

The sections below were written under the fork. **§6, C3, the post-pilot list, §8, §10 and §11 have been
re-scoped to the resolved reading**; the investigation and measurements (§1–§5) stand as verified (see the
verification note at the end of §2). Where an older paragraph still describes "two roots" or "Reading 1 vs
Reading 2", §0 and the re-scoped section override it.

### Verification of the load-bearing claims (re-derived at the branch tip, not taken from the draft)

Every claim an executing agent would build on without re-checking was re-derived from the code and live probes:

| Claim | Verdict | Evidence |
|---|---|---|
| `relayPub` is forgeable — bare unauthenticated string, `relayProof()` only ever relay→peer, nothing client-facing asks a relay to prove possession | **CONFIRMED** | `relayPub` emitted at `gateway.mjs:3095` (`/status`) and `:3439` (NIP-11) as plain JSON. `relayProof()` (`:528`, kind-27235 signed by `RELAY_SK`) is used only in the sync loop (`:4435,4476,4495,4503,4518,4528`) and name claims (`:536`). No `relay-identity`/nonce challenge exists in `src/` or `app/` (grep: zero). Client readers of `relayPub` (`steward.src.js:2601`, `fellowship.src.js:686`) only dedup boxes by identity — never verify possession. **The load-bearing claim holds: C2 is correctly item one.** |
| The name directory accepts a claim from any key | **CONFIRMED (from code)** | `verifyClaimEvent` (`gateway.mjs:560`) checks only kind==27235, a valid signature, freshness, the handle regex and a `ws/wss` URL. It sets `pub: ev.pubkey` — *whatever* key signed. Nothing binds that key to a relay, to TrinityOne, or to the URL's host; `applyClaimRecord` is first-claim-wins per handle, so any throwaway key claims any free handle at any URL. (Local reproduction not re-run this pass; the code path is unambiguous and the earlier pass's local `200 {"ok":true}` is consistent with it.) |
| The canonical pool is one box | **CONFIRMED (live)** | `app.trinityone.church/status` and `trinityone-master-01.tailbeaac0.ts.net/status` both return `relayPub 6a4267…70f2`. Two URLs, one box, one seizure. For C8 this is decisive: banning extras makes the whole network one machine in one building. |
| `gateway.mjs` makes authenticated outbound requests to a church-document URL with no check the host holds the paired pubkey | **CONFIRMED** | The `RELAYS_D` branch (`:1620-1623`) splits the church doc's `[{pubkey,url}]` into two *separate* Sets (`pubs→TRUSTED_RELAYS`, `urls→PEER_URLS`), discarding the pairing. `syncAllChurches` (`:4546`) then fetches every `PEER_URL` with `relayProof()` (NIP-98 signed by `RELAY_SK`), guarded only by `new URL(base).host === self`. No scheme/host/allowlist check, and the pubkey the church paired the URL with is never consulted. The fix is already in the data. **C6 valid.** |
| `setRelays` / the console relay-set sources are the complete set of entry points | **CONFIRMED, with one addition** | The draft's §3 enumeration is exhaustive for the *wired* paths. One item to note: the member app also exposes `discoverRelayOffers`/`pickRelays` (`fellowship.src.js:4875,4894`) with **no** behavioural probe — but they are **latent** (no UI caller; only the console's `autoPickRelays` at `stew-dashboard.jsx:3199` is wired), comparable to the draft's M14–M16 latent row and consistent with M11's note that "the member side never runs the behavioural probe." Not a material miss: every real writer still funnels through `setRelays`/`loadRelays` (member) and `relays()`/`extraRelays()` (console), so C4's chokepoints are correctly chosen. |
| "Fail closed costs nothing" | **CONFIRMED** | `CANONICAL_RELAYS` is a build-time literal (`fellowship.src.js:592`, `steward.src.js:542`). `loadRelays` (`:713-717`) refuses to return empty — falls back to `DEFAULT_RELAYS` or `CANONICAL_RELAYS`. `relays()` (`steward.src.js:709`) always appends `CANONICAL_RELAYS`. So *unverifiable → excluded* degrades to the shipped set, never to nothing. §5's argument stands. |

**Nothing was refuted.** The plan's premises are sound; the re-scope changes the *mechanism* (§6/C3), not the diagnosis.

---

## 0-bis. AMENDED 2026-09-01 — where the adversarial findings landed

The adversarial pass returned NO-GO as written, GO after amendments. Its four blocking findings and where
each is now resolved, so a reader of the diff can audit them one by one:

| Finding | Resolution, and where |
|---|---|
| **1 — Bootstrap deadlock.** A self-hosting church's own box can never be vouched for: the gate excludes it, `_boxHostsUs === false` is cached and makes `ownRelay()` return the canonical URL (`steward.src.js:560`), so `relays()` stops naming the box, and the function that would sign it in enumerates from that already-filtered list (`relayIdentities()` iterates `relays()` at `:2597`; `syncEnable` builds its doc from it at `:2610-2618`) | **§6-bis.** The same-origin root makes the vouch automatic AND is the deadlock fix; plus a binding rule on C3′/C4: adoption enumerates RAW candidate sources, never the filtered `relays()` list |
| **2 — Fail-closed and never-empty contradict.** `setRelays`/`loadRelays` re-insert the canonical set when the list empties; filter before that guard and unverified relays re-enter, filter after and the list can be empty. And canonical is pinned by a bundle-baked key on a project that has rotated a relay key under incident | **§5-bis.** The two invariants govern two different sets; the publish set may be empty and must SAY so (degraded-set honesty moves pre-pilot, into C4); the pin becomes a list, and rotation's bundle-shipping cost is stated |
| **3 — URL pairing breaks tunnel-hosted churches.** A free tunnel gets a new URL every restart, so a `{pubkey, url}` match drops a live member on every restart | **§6-ter / C3′.** The client matches **pubkey only**; `url` is demoted to an advisory hint (where to attempt the proof). URL-to-key binding is server-side only, in C6, where it belongs |
| **4 — C3 repurposed `d=trinityone/relays`,** which today means "cross-relay sync is on": `syncEnable` refuses to write it below two boxes (`:2617` — a single-relay church could never author its own membership) and `syncDisable` publishes `[]` (`:2647`), which would un-admit the church's own relay as a side effect of switching mirroring off | **§6-ter.** A NEW doc, `d=trinityone/relay-net`; `trinityone/relays` keeps its sync meaning untouched (*add, never repurpose* — `memory: backwards-compatibility-from-pilot`) |

The pass also found the commit order internally consistent but the **deploy** order not, because merging to
main IS deploying for the web console — resolved by the rewritten sequencing note in §7. Three additions
requested by the owner ride along: automatic adoption and its gap (§6-bis), the Suite as the pushed route
(§6-quater), and the "this machine is not always on" flag (§6-ter).

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

> **Re-checked live at re-scope time (2026-09-01, read-only GET):** both are *still advertising open hosting*.
> `GET https://app.trinityone.church/relay-names/offers` returns exactly these two, unchanged —
> `quitedoverelay` (`wss://task-blend-consistency-accomplish.trycloudflare.com/relay`, 1 church) and
> `steady-harbor-18` (`wss://intersection-numerical-points-framework.trycloudflare.com/relay`, 3 churches).
> Both are anonymous Cloudflare quick-tunnels, no operator/region. a8's own NIP-11 reports `open:true,
> churches:12, enforces:true`, and `pickRelays` sorts ascending by church count, so **Auto-find in the console
> today still ranks both tunnels above a8.** If they are ours they should be withdrawn from the directory
> before the pilot regardless of the rest of this plan; if they are not, three real churches are trusting an
> anonymous tunnel this network cannot vouch for. This is §11 question 3.

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

### 5-bis. AMENDED 2026-09-01 — reconciling "fail closed" with "never empty"

§5 as first written asserted both *unverifiable → excluded* and *the list is never empty*, and never said
which wins when they collide. They collide exactly at the never-empty guards: `loadRelays`
(`fellowship.src.js:713-717`) refuses to return `[]` and falls back to `DEFAULT_RELAYS`/`CANONICAL_RELAYS`,
and `relays()` (`steward.src.js:709`) appends `CANONICAL_RELAYS` unconditionally. Filter before those guards
and an emptied list re-admits whatever the guard re-inserts, unverified; filter after and "never empty" is
simply false. The reconciliation:

**The two invariants govern two different sets, and the plan now says so.**
- **The candidate list is never empty.** Candidates are what the client keeps, retries, and verifies in the
  background. The never-empty guards live here, untouched.
- **The publish set is verified-only, and it MAY be empty.** The filter runs *after* every guard, on the
  assembled list, consulting only the verified cache. If nothing is verified right now, nothing is published
  to — publishes queue, exactly as they already must for an offline device.
- **Which means the honesty item stops being post-pilot.** A shrunken-or-empty publish set must say so where
  the person is: a care request that is queued must read as queued, never as sent
  (`memory: fix-the-control-not-the-label`). This moves from §7's post-pilot list into C4's deliverable —
  the empty-verified-set state is now *reachable by design*, so the label ships with the gate, not after it.

**Canonical entries re-enter through the same door as everyone else.** The guard may re-insert the canonical
URLs into the candidate list; they still reach the publish set only by C2 proof against the expected
`relayPub` baked beside them. Nothing is ever admitted *because* the guard ran.

**The baked pin must survive a key rotation, because this project has rotated a relay key under incident
before** (`memory: incident-relay-secret-exposure`). Two consequences, both cheap and both stated now rather
than discovered mid-incident:
- Bake a small **array** of accepted pubkeys per canonical URL, not a single value, so a planned rotation
  ships old+new for one release and retires the old pin in the next.
- An **unplanned** rotation (compromise, rotate now) is a bundle-shipping event. The web console picks up the
  new pin the moment it merges to main (`memory: deploy-topology` — merge IS deploy there); installed APKs
  lag, and until updated they fail the canonical proof and queue. That is fail-closed working as designed —
  but write it into the incident runbook as **"rotating the canonical key pauses un-updated phones"**, so it
  is a known cost and not a live discovery.

---

## 6. The mechanism: the church's own signature, no network key, no registry

*(Re-scoped. The earlier draft proposed three roots, one of which — a TrinityOne-issued network credential —
is dropped by the owner's reading. See §0.)*

**What identifies a TrinityOne relay must be a signature the client can check offline, carried by the relay
itself.** Not a lookup. A client that must reach a registry to connect has a worse single point of failure
than the one `RELAY-NETWORK-ROBUSTNESS.md` warns about, because it gates every session rather than only
joining. And — the owner's constraint — **there must be no party who can admit or revoke a church's relay
except the church.** That rules out a credential *we* issue.

A relay is admitted for a church if it satisfies the church-signature root **and** proves possession of the
key that was vouched for. Two admission paths, and neither of them is us:

**The church-signature root (primary).** A relay whose pubkey the church has signed into its own
`d=trinityone/relay-net` doc (AMENDED — a NEW doc, not the existing sync doc; §6-ter has the shape and why),
and which proves possession of that pubkey. The authority is the
church's own key — exactly where every other trust edge in this codebase puts it. This is what keeps
self-hosting alive, and it covers *third-party* hosting too: a relay hosting a church that is not its
operator's (what `quitedoverelay`/`steady-harbor-18` claim to be) is admitted because **the hosted church
signs that relay's pubkey into its own list** — the church makes the call, not TrinityOne. It is also the same
check that closes G1 on the server side — **one mechanism, both ends.**

**The same-origin root (AMENDED — was "loopback root", now generalised, §6-bis).** A relay on the console's
own serving origin — loopback (`127.0.0.1`, `localhost`, `::1`) on the Suite's first run being its narrowest
case. Not a trust decision: the steward already ran the key-holding code that origin served. It must have its
own test, because **this is the most likely way to brick something real** — the Suite boots its own relay and
the console talks to it before any church document exists — and under §6-quater it is the common first run,
not an edge. It also carries the automatic adoption the owner wants: same-origin is the signal that lets the
console sign the box in with no steward ceremony (§6-bis).

**"Runs our software" is proved by behaviour, not by a certificate we sign.** `_probeRelayEnforces`
(`steward.src.js:766`) already asks a candidate relay to accept a stranger's safeguarding list and rejects it
if it does — a generic Nostr relay fails this, our enforcing software passes. That is what stops the network
*steering* a church at a non-enforcing relay (discovery / Auto-find), without any of us issuing anything. It
is a "does it enforce" filter on candidates; the church's signature is what actually *admits*. Keep it exactly
that way round.

**Proof of possession is mandatory and does not exist today.** The relay must sign a *client-supplied nonce*.
`relayProof()` already builds exactly this event shape with `RELAY_SK`; a client-facing variant is small.
This is the load-bearing item (§0 verification): without it the `relayPub`/`pubkey` a church signs is a bare
string any host can echo, so the church-signature root would verify nothing.

**What this deliberately does not claim** — and the codebase already says it, at `steward.src.js:766`: nothing
remote can prove the operator is not reading their own database. Membership raises the floor from "anyone with
a keypair" to "a relay running the enforcing software that this church signed for". Do not let the plan's copy
overclaim it — and note there is now **no** "someone *we* vouched for and can revoke", by design.

**Why no network key (the thing the earlier draft called Root A).** A TrinityOne-signed membership credential
would make us the party that decides who may run a relay for a church, and — under `memory:
uk-pilot-threat-model`, lawful compulsion — a signing key that can admit or revoke relays is a new thing that
can be *compelled*. The owner's reading removes that lever deliberately. We gain nothing a church's own
signature does not already give us, and we would be creating exactly the compulsion target the pilot's threat
model is built to avoid. So it is not built.

### 6-bis. AMENDED 2026-09-01 — automatic adoption: the same-origin root, and the gap in it

**The owner does not want a steward manually vouching for their own relay, and a mechanism exists that makes
the vouch automatic without weakening it.** A relay serves its own console — one process, one port
(verified). So the loopback root generalises to a **same-origin root**: when the console's serving origin IS
a relay (it answers the C2 proof), the console may sign that box's *proven* `relayPub` into the church's
membership doc automatically. This adds no trust the steward had not already given — to load the console at
all, they ran the key-holding code that origin served; a box that could tamper with the console did not need
relay membership to win. Loopback (the Suite's first run) becomes the special case of this rule, not a
separate root.

**This is also the fix for adversarial finding 1, the bootstrap deadlock.** As shipped, the box's own
admission path eats itself: once `_boxHostsUs === false` is cached, `ownRelay()` returns the canonical URL
(`steward.src.js:560`), so `relays()` stops naming the box, so `relayIdentities()` — which enumerates from
`relays()` (`:2597`) — never sees it, so the function that would sign it in (`syncEnable`, `:2610-2618`)
can never include it. Once C4 filters `relays()`, the identical loop traps ANY not-yet-admitted box, own or
hosted. **The rule, binding on C3′ and C4: adoption and enrolment enumerate from RAW candidate sources —
`location.origin`, the relay panel's configured box, a pasted candidate — never from the filtered `relays()`
list, and never through the `_boxHostsUs` cache.** The filtered list is for publishing; using it as the
enrolment census is the deadlock.

**The gap, stated here so it is not discovered later.** The marketing site's five "Start a church" CTAs all
land on the HOSTED console (direct hrefs at `welcome.html:622,652,654,694`, plus the nav/hero anchors that
funnel there). Browser storage is per-origin, so a church that starts hosted and self-hosts later holds its
church key against a8's origin, never loads anything from its own box, and **the same-origin signal never
fires for exactly the churches that most need it.** Three candidate covers, weighed:

1. **Make the Suite the setup route.** Now the owner's decision (`DOMAIN.md` 2026-09-01; §6-quater). Covers
   every church that starts on the Suite — the common case once the site steers there. Cost: real site work,
   and it does nothing for churches that already started hosted or that deliberately run a bare relay.
2. **A second automatic signal from the hosted console.** There isn't a sound one. Anything the hosted
   console can observe about a remote box — reachability, a C2 proof at a typed URL — proves the box holds
   *a* key, not that this church runs it. Automatic adopt-on-sight of a URL is precisely the
   social-engineering vector §9 refuses ("your area dean says add this address"). Not built, on purpose.
3. **One deliberate step, for the exception only: a pairing code minted by the box itself.** The relay's
   control panel — token-gated, reachable only by whoever administers the box — shows a short, fresh code: a
   `RELAY_SK`-signed claim of its own `relayPub` (the `relayNameClaimEvent` shape at `gateway.mjs:536` is
   nearly this already). The steward pastes it into the hosted console's Relays panel; the console verifies
   the signature and the C2 possession proof at the box's URL, then signs the pubkey into the membership
   doc. What the code proves that a bare URL cannot: **administrative access to that box**, not mere
   knowledge of an address.

**Recommendation: 1 + 3.** The Suite makes same-origin the common case and shrinks the exception to
"started hosted, self-hosted later" plus "deliberately bare relay" — a smaller, more technical group who can
reasonably take one deliberate step. Cost of 3: a control-panel line, a paste box, and the verify path —
about half a day — and it can be post-pilot **unless §11 question 3 reveals a pilot church already on the
hosted-console-plus-remote-box path**, in which case it moves up.

### 6-ter. AMENDED 2026-09-01 — the membership doc is NEW, and it carries the part-time flag

**Adversarial finding 4 stands: C3 as first written repurposed `d=trinityone/relays`, and that doc already
means something else.** Today it is the sync-authorisation list: `syncEnable` (`steward.src.js:2608`) writes
it and *refuses* below two distinct boxes (`:2617` — so a single-relay church, the commonest self-host
shape, could never author its own membership at all), and `syncDisable` publishes `[]` (`:2647`) — which
under the repurposed reading would un-admit the church's own relay as a side effect of switching mirroring
off. `memory: backwards-compatibility-from-pilot` is categorical — *add, never repurpose* — and the relay
rehydrates all history on every update, so a repurposed meaning would reach backwards too.

**So: a new addressable doc, `kind 30078, d=trinityone/relay-net`, church-signed.** Shape:

    [{ pubkey, alwaysOn, url? }]

- **`pubkey` — the membership statement, and (finding 3) the ONLY thing the client matches.** The C2
  possession proof turns it from an echoable string into a checkable one. Where the box lives today is not
  part of membership: a client admits a candidate URL iff the host there proves possession of a pubkey in
  this list (or the same-origin/canonical roots apply). Members learn candidate *URLs* exactly as they do
  now — the church's kind-10002 (M11), `?relay=` hints, storage — but every hint is only a place to attempt
  the proof, never an authority.
- **`url` — advisory only:** the last place this box was seen. A free tunnel's URL churns every restart; a
  stale hint costs a failed attempt, never a lost membership. URL-to-key *binding* is server-side only, in
  C6, where the sync loop is about to hand a signed identity proof to a host and must know it is the right
  one.
- **`alwaysOn` (default `true`) — the owner's "this machine is not always on" flag.** *"Some church machines
  wont be on 24/7, so that should be an option still."* A parish-office box switched off at night is a real
  second copy for durability and NOT a reliable one for reach, and the doc should say which. Set from the
  relay panel — a checkbox beside the box's entry; mechanism, not policy: describe the consequence, never
  nag. Consumers:
  - **Client connect ordering** — prefer `alwaysOn` boxes for first reads and initial subscriptions, so a
    member's cold start never waits on a machine that is off until morning.
  - **Redundancy honesty** — `backupState` (D2) counts boxes; a part-time box counts toward "your history
    exists in two places" and NOT toward "members can always reach you". Two numbers, not one.
  - **Sync scheduling (server-side)** — an unreachable part-time peer is expected, not an alarm; back off
    politely instead of logging failure.

**What stays where it is.** `trinityone/relays` keeps its sync meaning, its `[]`-off convention and its
two-box minimum, untouched; the gateway's `RELAYS_D` ingest keeps reading it for sync peers, and C6's
pairing check applies there as written. Hardening-plan **P3 is re-pointed at the new doc**: publishing
`trinityone/relay-net` on every relay-set change is the load-bearing publish; the kind-10002 publish remains
the member-facing URL hint it always was. **Migration:** on first run of the new console code, if the church
has a `trinityone/relays` doc and no `trinityone/relay-net` doc, seed the new one once from the old entries
plus `ownRelay`'s proven box, showing the steward what was written — a one-time seed, never a live mirror.

### 6-quater. AMENDED 2026-09-01 — the Suite is the pushed route (owner decision, in DOMAIN.md)

*"we need to prioritise the TrinityOne Suite in the marketing, so that more people run the Relay+steward
console together."* This inverts which case is common. The plan was first written as if the hosted console
were the default and the self-hosted box the exception; under the decision, **same-origin adoption (§6-bis)
is the COMMON path and must be boringly reliable, and hosted-console-plus-separate-box becomes the
exception**, served by the §6-bis pairing step. Two concrete consequences: the Suite's first-run test
(same-origin adoption, then the membership-doc publish) is the test most churches' safety now rests on and
must exist before the gate ships; and the site work — CTA targets, card emphasis — is go-live work, not
marketing polish, because today every "Start a church" click steers at the one origin where automatic
adoption cannot fire.

---

## 7. The plan

Ordered so an executing agent starts at the top. **Audit after every two items** (CLAUDE.md rule 5).

### Deployment sequencing — read before item one (AMENDED 2026-09-01: merging IS deploying)

C2 and C3 change what a *relay* serves. C4 and C5 change what a *client* accepts. **If a client that requires
proof ships before every relay can produce it, the fleet disconnects.** The adversarial pass added the sharper
constraint: for the web console, **merging to main IS deploying** (`memory: deploy-topology` — this box is the
origin and the bundle builds from `main`; there is no "merge now, deploy later" for `steward.html`). So this
is a merge schedule, not just a commit order:

1. **C1** — merge immediately. Copy and dead code only; deploying it early is the point.
2. **C7** — the harness. No deploy surface.
3. **C2** — merge, deploy a8, then MANUALLY upgrade every relay in the network (there is no auto-update —
   `memory: relay-auto-update-wanted`, "only the WHEN is missing") and verify by reading `/status`
   `versionShort` on every box, never assumed. The self-hosted boxes run older builds today (§2(d):
   `200b917` vs a8's `7f05991`), so this step is real work, not a formality.
4. **The doc-writer half of C3′** — the console publishing `trinityone/relay-net` (§6-ter) gates nothing and
   is purely additive; merge it, have every pilot church open its console once, then VERIFY ON THE RELAY that
   each church's doc exists — query the relay for the d-tag, do not trust the console's own display
   (`memory: console-settings-matrix-needed`).
5. **C3′ gate + C4 + C5 together, in one merge window, only after 3 and 4 are verified.** The moment any of
   them merges, every web-console session enforces. A client gate merged while one fleet relay cannot answer
   the C2 proof, or one pilot church lacks its relay-net doc, drops that church's own box on the day of merge
   — fail-closed, so it degrades to canonical rather than to nothing, but that is exactly the silent
   re-routing C4's compatibility note forbids.
6. **C6** — any time; server-side and independent.

The APK lags all of this by its own build/install cycle (`sync-web.sh` + `assembleDebug`). The lag is safe in
this direction — an old APK is an old *open* client, no worse than today — but the closing date the owner
communicates is the date step 5 merges, because that is when the web console starts enforcing for everyone.

**What the resolved reading changed about ordering (see §0).** The item skeleton is unchanged —
C1 → C7 (harness) → C2 → C3 → C4 → C5, with C6 independent and highest-value-per-hour. But two things moved:
the **key-ceremony that used to sit inside C3 is gone**, so C3 no longer blocks on an offline
keygen/custody/rollout project and shrinks to roughly a day; and **hardening-plan P3** (the church publishing
its signed relay list — now the NEW `trinityone/relay-net` doc, §6-ter, not the sync doc) is pulled onto the
critical path as a **hard prerequisite of C3**, because that signature is now the sole thing that admits a
self-hosted relay. Do P3 with, or just before, C3 — it is step 4 of the merge schedule above. Nothing new
must come *first*; the change is that the riskiest pre-pilot dependency (key custody) was deleted, not
resequenced.

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

#### C3 — Network membership: the church-signed root (re-scoped — no network key)

*(Re-scoped from "the credential and the two roots". The network-key ceremony is gone; this is now much
smaller and it is the item the fork's resolution simplified most.)*

**What a person experiences if this is missing.** A church can be pointed at a machine nobody vouched for, and
neither the church nor we can tell. Under the resolved reading the judgement is the **church's** — this item
is what lets the church's own signature actually carry it.

**The change.** No offline keypair, no baked root pubkeys, no credential files, nobody to approve or revoke.
*(AMENDED 2026-09-01 — three findings land here: pubkey-only matching, the NEW doc, the same-origin root.)*
1. Client `isNetworkRelay(cp, url)`: the C2 proof of possession succeeds for `url` **AND** either
   - the proven `relayPub` appears in *this church's* own signed `d=trinityone/relay-net` doc (§6-ter — the
     church-signature root). **Pubkey only — the doc's `url` field is never consulted for admission**
     (finding 3: a tunnel's URL churns every restart; URL-to-key binding is C6, server-side), **or**
   - `url` is the console's own serving origin (the same-origin root, §6-bis — loopback on the Suite's first
     run is its special case).
2. That is the whole gate. The `[{pubkey, alwaysOn, url?}]` the church signs *is* the membership statement;
   C2 turns the pubkey from an unverifiable string into a checkable one.
3. Nothing is issued to anyone. A church enrols its own relay automatically via the same-origin root
   (§6-bis), or by signing its pubkey into `trinityone/relay-net` (hardening-plan P3, re-pointed). A
   third-party host is enrolled by the church it hosts signing that host's pubkey — same mechanism.
4. **Enrolment enumerates raw candidate sources, never the filtered `relays()` list** — the §6-bis deadlock
   rule. `relayIdentities()`/`syncEnable`-shaped code must not be the enrolment census.

**Consumers.** `CANONICAL_RELAYS` at `src/fellowship.src.js:592` and `src/steward.src.js:542` (still the
build-time bootstrap set — the canonical box is admitted by C2 proof against a baked-in expected `relayPub`,
not by a credential); `relays-always-canonical.test.mjs` guards part of the pair. `TRUSTED_RELAYS` /
`RELAYS_D` ingest at `gateway.mjs:1620` — **this is where the pubkey/url pairing must stop being discarded**
(see C6 — AMENDED: the server gate stays on the `trinityone/relays` sync doc, the client gate reads the new
`relay-net` doc; the pairing check is C6's, not shared). `_relayInfo`
(`fellowship.src.js:965`, `steward.src.js:731`) — the self-reported `enforces` flag is **demoted from an
adoption criterion to a candidate filter** and must not be left looking like the gate; the real gate is the
church's signature.

**One consequence to state plainly.** For the *canonical pool* there is no church signature — it is the shared
default. So `CANONICAL_RELAYS` members are admitted by C2 proof against an **expected `relayPub` list baked
into the bundle beside the URL** (a LIST, not one value — §5-bis: this project has rotated a relay key under
incident, and a single pin makes rotation a fleet-wide outage; one entry today, `6a4267…70f2`). That is not a
credential we can revoke; it is a build-time literal, changed only by shipping a new bundle — which keeps the
"no online revoker" property, at the rotation cost §5-bis prices.

**Point-of-use test.** Two real gateways: one whose `relayPub` a test church has signed into its
`trinityone/relay-net` doc, one it has not. Drive a church publish and assert the un-signed gateway's store
is **empty** — count events on the relay, not calls in the client. A second case for finding 3: move the
signed gateway to a NEW port (a tunnel restart in miniature) and assert it is still admitted at the new URL
once it proves its key there. Sabotage scoped to `isNetworkRelay`. The same-origin root gets its own test
(§8 — it is the most likely way to brick something real).

**Backwards compatibility.** Old client + new relay: unchanged (extra endpoint ignored). New client + old
relay: the old relay cannot answer the C2 nonce, so it is excluded — see sequencing. A self-hosting pilot
church must have **published its `trinityone/relay-net` doc** (P3 re-pointed, §6-ter — including the one-time
seed from any existing `trinityone/relays` doc) before its own box will be admitted; that is the one
operational precondition, it is cheap, and it is merge-schedule step 4.

**Size.** Half a day to a day — it is a client predicate plus the C2 dependency, not a key-management project.

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
  on success. Never verify-or-drop on the hot path (§5). *(AMENDED: the cache is keyed by URL for lookup, but
  what it certifies is the PUBKEY proven there — admission is pubkey-in-doc, §6-ter. A box that moves URL
  re-proves at the new URL and is re-admitted; nothing about membership is URL-shaped.)*
- **AMENDED 2026-09-01 — the filter runs AFTER the never-empty guards, on the assembled list** (§5-bis).
  The candidate list keeps its guards and is never empty; the publish set is verified-only and MAY be empty,
  in which case publishes queue. **The degraded-set honesty line ships in this item, not post-pilot:** when
  the publish set is smaller than the candidate set — above all on a care request — say "queued", never
  "sent" (`memory: fix-the-control-not-the-label`).
- **AMENDED 2026-09-01 — enrolment reads raw sources.** The §6-bis deadlock rule: nothing that *admits* a
  relay (same-origin adoption, the membership-doc writer, the §6-bis pairing step) may enumerate from the
  filtered `relays()`/`loadRelays()` output or consult the `_boxHostsUs` cache. Write a test that a
  never-yet-admitted box on the console's own origin still gets adopted — that is the deadlock, executable.

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

**Point-of-use test (rule 1).** Two real gateways; only one has its `relayPub` signed into the test church's
`trinityone/relay-net` doc (the church-signature root, §6-ter). Drive the **console's Add-relay control** — the thing a
steward touches — at the un-signed one, then publish a church document, then count events on that relay. Must
be zero. **This test fails if the feature is deleted from the screen, not only if the engine changes.**
Sabotage: delete the filter inside `relays()` (scoped: slice the function,
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

**AMENDED 2026-09-01 — two clarifications.** (1) "Verify" everywhere above means the C3′ predicate:
attempt the C2 proof at the hinted URL and admit iff the proven **pubkey** is in the church's
`trinityone/relay-net` doc — the hint is a place to ask, never an authority, and a URL that moved (a tunnel
restart) costs nothing because membership is not URL-shaped. (2) Once C4's chokepoints exist, most of these
paths are *already* stopped at `setRelays`/`loadRelays`/`extraRelays()` — a restored backup, a QR add and a
swapped name all pass through them. C5's independent value is at the ENTRY: refusing the input where the
person is (a legible "this relay isn't in the TrinityOne network yet" at scan time beats a silent later
drop), hardening the resolver, and `cloneFromRelay`, which never touches the relay pool at all. Treat C5 as
defence-in-depth plus legibility, not as the only wall — and do not skip it on that argument, because
`cloneFromRelay` and the resolver have no other wall.

**Consumers.** `followChurch` callers: `app/app.jsx:844` (browser query), `app/screens-church.jsx:191` (QR),
the native `safeQuery` path (`:571-577`), and `join.js:26` (the public forwarder). `restoreLocal` callers:
`applyMember` and `applySteward` (`app/backup.jsx:139,193`) — `backup-file-safety.test.mjs:114,129` already
asserts over `trinityone.relays` and **will need updating; account for the delta** (rule 8).

**Point-of-use test.** A crafted join link naming a real, running gateway that no church has signed into its
relay list; drive the QR/link path; assert that gateway's store stays empty. Separately, a directory record that re-points a claimed handle
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
losing sync, and it needs a console message, not a silent stop. *(AMENDED: a tunnel-hosted peer produces this
"mismatch" legitimately every time its URL churns — the doc's `url` goes stale until republished. Server-side
that is the correct fail-closed outcome (do not hand a proof to an unverified host), but treat "pubkey proof
failed at stale URL" as a routine retry-and-nudge, not an incident; and a peer flagged `alwaysOn:false` in
the church's `relay-net` doc being unreachable is expected, §6-ter.)*

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

*(Re-scoped: the "self-host enrolment UX" and "revocation distribution" items are **removed** — under the
resolved reading there is no credential to issue, approve, or revoke. A self-hoster joins by signing its own
relay into its `trinityone/relay-net` doc (§6-ter) — automatically, via the same-origin root, in the common
case; there is nothing for us to hand out.)*

- **Self-host onboarding polish (not enrolment).** The relay control panel already lets a church claim a
  directory name and go public; the only post-pilot nicety is making "and it's now in your church's signed
  relay list" a visible, one-tap confirmation rather than an implicit consequence. **No approval step exists to
  build — that is the point of the resolved reading.**
- **Directory-side membership filter.** Relays refusing to *store* non-member claims. Client-side filtering
  (C5) delivers the same safety without coordination and works against relays that have not upgraded — do the
  client half first, and only consider the server half once every relay is upgraded.
- **Degraded-set honesty — MOVED PRE-PILOT (AMENDED 2026-09-01).** The core of it (queued-not-sent when the
  verified publish set is empty or shrunken, above all on a care request) is now part of C4's deliverable,
  because §5-bis makes that state reachable by design. What stays post-pilot is only the richer surface — a
  per-relay health view, history of drops.
- **The §6-bis pairing step** for hosted-console churches adopting a remote self-hosted box — post-pilot
  *unless* §11 question 3 finds a pilot church already on that path.
- **The `alwaysOn` consumers beyond copy** (§6-ter) — connect-ordering preference and the two-number
  redundancy display. The doc *field* ships with C3′ (retrofitting a field later is a migration; shipping an
  unread field is free — *add, never repurpose* works in our favour here).
- **`src/mydata.src.js:103`** — the `ws://127.0.0.1:7447` cleartext fallback. Harmless today; wrong under the
  new rule.
- **Tighten what a relay ACCEPTS, for the "nothing else" half of the DOMAIN rule.** This is where the owner's
  *"we don't want bloat on a persecuted church relay"* lands, and **"bloat" is accountability on a seizable
  box, not disk** (`DOMAIN.md`): anything on that machine which the church did not choose is a liability to the
  people holding it under compulsion. Measured 2026-09-01, three openings remain in `accept()` beyond the
  member gate (`accept()` ends `return isMember`, so a stranger cannot post a note, message or document):
  - `NONMEMBER_KIND0_CAP = 1000` — stranger *profiles* are accepted up to a cap. On a church's own box, a
    thousand strangers' profiles are exactly the "records the church did not choose" the DOMAIN entry warns of.
  - `MEMBERS` is relay-wide — a member of *any* church on the box counts as a member. Moot once each church has
    its own machine (the pilot goal, and the C8 argument), but it is the same seizure-accountability point.
  - `if (!CHURCH_PUBS.size) return true` — a relay is fully open until its first church registers.
  - **A relay MODE**, per `ROADMAP-NOTES §7`, is the clean way to settle all three: `CHURCH_PUBS.size === 0`
    still answers three unrelated questions, and under a closed network "generic/open relay" must be an
    *explicit* mode outside the network, never an accident of an empty-config box. Design it so a church relay
    holds its churches' data and refuses the rest — that is the DOMAIN rule made mechanical.

---

## 8. Challenging the edges of the decision

The decision is made *and the reading is resolved* (§0: "people that run our specific relay software", no
credential we issue). These are the places it still bites.

**"Non-TrinityOne" — the fork that used to be here is closed.** The earlier draft weighed a strict reading
("only relays TrinityOne operates") against a network reading ("relays running TrinityOne software"). **The
owner chose the network reading, and further specified that membership is not a credential we grant** — so the
mechanism is the church's own signature plus proof the relay runs the enforcing software, and there is no
TrinityOne key that admits or revokes. The strict reading is dead: it would have ended self-hosting and
contradicted `ROADMAP §4` ("open relays support churches that cannot self-host").

**A church that already runs its own relay: does it have to do anything?** **No, provided its console has
published its `trinityone/relay-net` doc** — hardening-plan P3, re-pointed at the new doc (§6-ter), with the
one-time seed covering churches that only have the old sync doc. That publish *is* the church's vouching, and
under the resolved reading it is the **sole** membership statement, so P3 stops being hygiene and becomes
load-bearing. Treat it as non-optional — and note (AMENDED, finding 1) that for a Suite church even this is
automatic: the same-origin root does the signing, and the steward does nothing at all.

**A relay that hosts churches that are not its operator's** — which is what `quitedoverelay` and
`steady-harbor-18` advertise themselves as right now — joins the same way: **the hosted church signs that
host's pubkey into its own list.** No separate mechanism, no TrinityOne approval. Those two directory entries
become un-addable via Auto-find the day C4/C5 ship *unless* a real church has signed them; with three pilot
churches and no installed base the blast radius is near zero. **That is the strongest argument for doing this
now rather than after the pilot.**

**The edge that will actually break something:** the desktop Suite boots a relay on loopback and the console
talks to it before any church document exists. A naive gate bricks it on first run. The same-origin root
(§6-bis; loopback is its special case) exists for this, and it needs its own test rather than a comment — and
under §6-quater this is no longer an edge but the COMMON first run, which raises the stakes of that test.
**The edge the amendment adds:** a hosted-console church whose box lives behind a churning tunnel URL. Its
membership must survive every restart (pubkey-only matching, §6-ter) even though its advisory `url` goes
stale — the C3′ moved-port test is the executable form of this.

**The edge the resolved reading REMOVES (was "the edge nobody has priced").** The earlier draft flagged that
*issuing credentials* would make us the party who decides who may run a relay — and under `memory:
uk-pilot-threat-model` (lawful compulsion) a signing key that can admit or revoke relays is a new thing that
can be compelled. **The owner's reading deletes that lever rather than accepting it:** no network key, nothing
to compel, nobody to switch a church off. `DOMAIN.md` records this as the sharpest risk the definition
removes. This is the single biggest reason the re-scoped plan is *safer* than the draft, not merely simpler.

---

## 9. What should NOT be built

- **No central membership registry a client must reach.** This is the trap `RELAY-NETWORK-ROBUSTNESS.md`
  names, and worse: a canonical *host* going away breaks joining, a canonical *registry* going away breaks
  every session. The credential must travel with the relay and verify offline.
- **No credential to revoke, and so no revocation machinery at all.** The earlier draft reached for short
  expiry plus a gossiped revocation list; the resolved reading removes the credential those would revoke. A
  church stops trusting a relay by dropping its pubkey from its own signed `trinityone/relay-net` doc
  (§6-ter; the R2 burn path already exists for the sync list and is the pattern) — that is the only
  revocation, and it is the church's, not ours. Do not reintroduce an
  OCSP-shaped online check; it is the registry trap wearing a different hat and fails exactly when the network
  is under pressure.
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
- **No URL-based membership matching, client-side.** (AMENDED.) A membership check that compares URL strings
  breaks every tunnel-hosted church at every restart and invites "just pin the hostname" hacks. Membership is
  a proven pubkey in a church-signed doc; URLs are hints. The one place URL-to-key binding is right is C6,
  server-side, at the moment a signed proof is about to be handed to a host.
- **No automatic adopt-on-sight from the hosted console.** (AMENDED, §6-bis option 2.) A remote box proving
  it holds *a* key proves nothing about whose box it is; an automatic adopt from a typed or linked URL is the
  §9 escape hatch wearing an automation costume.
- Everything already on `PLAN-RELAY-HARDENING`'s not-to-build list still stands.

---

## 10. Cross-check against `reference/PLAN-RELAY-HARDENING-2026-09-01.md`

That plan was written at `ba913fc` under the open model. Item by item:

| Item | Status under this decision |
|---|---|
| **P1** — multi-relay join artefacts | **Survives, but must be re-ordered.** Its premise ("several relay hints on paper") is sound; but every hint must now be a network member and must be *verified* before adoption, so P1 depends on C2–C5. It was filed as "do it first"; it can no longer be first. Printing hints for relays that will later be excluded is worse than printing one. |
| **P2** — restore-path name resolution without the canonical host | **Survives, small addition.** Resolving names at more mirrors is still right; the *resolved URL* must pass C5's verification before adoption. |
| **P3** — publish kind-10002 on every relay-set change | **Survives and becomes load-bearing — and (AMENDED) is re-pointed.** Under the resolved reading the church's signed list is the **sole** membership root (no network credential behind it), so P3 is what admits every self-hosted and third-party-hosted relay. But the membership statement is the NEW `trinityone/relay-net` doc (§6-ter), not kind-10002 and not the `trinityone/relays` sync doc — kind-10002 stays the member-facing URL *hint*. P3 = "publish `relay-net` (and refresh the 10002 hint) on every relay-set change". Hard prerequisite of C3; merge-schedule step 4. |
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

## 11. What the owner still has to decide

*(Re-scoped twice. The reading of "non-TrinityOne relay" is **ANSWERED** and in `DOMAIN.md` — no root keys.
The amendment pass resolved adversarial findings 1–4 without new owner input, but it added three questions
and sharpened one. In the order they block:)*

1. **Scope for the pilot: the leak-closing core, or the whole plan?** The opening section's judgement: C1 +
   C7 + C2 + C3′ + C4 close the original leak in four to five days, C5 adds one to two and is worth it;
   C6/C8, the §6-bis pairing step, the Suite site work and the `alwaysOn` consumers are architecture that
   can follow the pilot. Recommended: ship the core (through merge-schedule step 5) pre-pilot, schedule the
   rest. *Blocks: everything — this is the go decision.*
2. **The second canonical box** (C8) — unchanged, and still the ops decision that matters most. The network
   is measurably one box (`app.trinityone.church` and `master-01` share `relayPub 6a4267…70f2`); the moment
   extras are banned, the whole closed network is one machine in one building. Closing to one box is still
   net-safer than open-to-one-box, but the owner should knowingly choose the single point of seizure until a
   second box exists. Take it in the same conversation as question 1.
3. **Are `quitedoverelay` and `steady-harbor-18` ours?** Both are still in the production directory
   advertising open hosting (two anonymous Cloudflare tunnels, 1 and 3 churches), and Auto-find still ranks
   them above a8 (§2(d)). If they are test boxes, withdraw them now, before the pilot, regardless of the
   rest. If they are not, three real churches are trusting an anonymous tunnel today — **and (AMENDED) any
   real church hosted on them is on the hosted-console-plus-remote-box path, which is exactly §6-bis's gap:
   the answer decides whether the pairing step is pre-pilot after all.**
4. **Does anything in the pilot rely on `cloneFromRelay` from an arbitrary host?** Unchanged: it exfiltrates
   the whole corpus, safeguarding cleartext included, to a typed host, and I could not tell whether it is an
   operational route or a development convenience. *Blocks: C5's treatment of it — gate outright, or gate to
   member hosts.*
5. **Approve the §6-bis shape for the exception path?** One deliberate paste of a box-minted pairing code for
   bare-relay and hosted-then-self-hosted churches, versus accepting Suite-only and leaving that migration
   without a route. Half a day either way; the plan's default is build-it-post-pilot unless question 3 moves
   it up. *Blocks: nothing pre-pilot unless question 3 does.*
6. **Accept the canonical key-rotation cost** (§5-bis): pins ship as a list; a planned rotation overlaps two
   releases; an unplanned rotation pauses un-updated APKs (they queue, fail-closed) until they update. This
   needs a yes to the *cost*, not a design. *Blocks: nothing, but it belongs in the incident runbook before
   the gate ships.*

---

## 12. Rule-7 assumptions — stated so they can be corrected

1. *A self-hosting pilot church will have published its `trinityone/relay-net` doc (P3 re-pointed, §6-ter)
   before its box needs to be admitted.* Under the resolved reading the church's signature is the **sole**
   membership root, so if a church self-hosts *without* P3 having run, its own relay is excluded on day one —
   which is why P3 is a hard prerequisite of C3 and merge-schedule step 4. (AMENDED: for a Suite church the
   same-origin root writes this doc automatically, so the assumption softens to "the church opened its
   console once after step 4 merged".) (The earlier draft's version of this assumption — "enrolment can be a script
   we run" — is void: there is no enrolment script, because there is nothing to issue.)
2. *A printed join artefact outlives the URLs on it.* Inherited from `PLAN-RELAY-HARDENING` P1; it is why C5's
   failure message matters more than C5's gate.
3. *A church will never knowingly want its data on a public Nostr relay.* ESTABLISHED by `451e7c6`.
4. *A steward will not notice a relay silently leaving their list.* INFERRED — it is why C4's
   backwards-compatibility note asks for a visible line rather than a silent drop.
5. *A relay serves its own console — one process, one port.* VERIFIED (an earlier pass ran it) — the basis of
   the same-origin root (§6-bis). If a deployment shape exists where a church's console is served from a
   different origin than its relay (a reverse-proxy split, a CDN in front), the same-origin signal never
   fires there and that shape becomes a pairing-step case; none is known.
6. *Whoever administers a self-hosted box can reach its token-gated relay control panel.* INFERRED — the
   basis of the §6-bis pairing code.
7. *No pilot church currently runs the hosted console against a remote self-hosted box.* OPEN — §11
   question 3 is how we find out; if wrong, the §6-bis pairing step moves pre-pilot.
8. *A part-time relay box is acceptable to the owner as a durability copy that clients deprioritise for
   reach.* ESTABLISHED in intent (*"Some church machines wont be on 24/7, so that should be an option
   still"*) — but the two-number redundancy display (§6-ter) is my reading of what "an option" implies, and
   the owner has not seen that copy.

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

**Re-scope pass (2026-09-01, branch tip `e73d249`).** The six load-bearing claims were re-derived from the
code at the tip and from read-only production GETs (§0 verification table): all CONFIRMED, none refuted. The
re-scope is a documentation change to this one file; **no code was read into a running suite and `npm test`
was not re-run this pass** — the suite baseline above stands from the investigation pass and an executor must
re-measure it before item one regardless. The local name-directory reproduction (§2(b)) was **not** re-run
this pass; the verdict rests on re-reading `verifyClaimEvent`/`applyClaimRecord`, which is unambiguous. Live
GETs this pass: `/relay-names/offers` (still two anonymous tunnels), a8 and master-01 `/status` (same
`relayPub 6a4267…70f2`), a8 NIP-11 (`open:true, churches:12, enforces:true`).

**Amendment pass (2026-09-01, tip `43ae82d`).** Read-only on code; the only file changed is this one.
Re-verified for the amendments, at the tip, by opening the lines: the `d=trinityone/relays` semantics —
`syncEnable` writes it and refuses below two boxes (`steward.src.js:2608-2618`, throw at `:2617`),
`syncDisable` publishes `[]` (`:2645-2647`) — finding 4; the deadlock chain — `_boxHostsUs === false` makes
`ownRelay()` return the canonical URL (`:560`), `relayIdentities()` enumerates `relays()` (`:2597`) and
feeds `syncEnable` (`:2610`) — finding 1; the hosted-console CTAs on the marketing site
(`welcome.html:622,652,654,694` direct, plus nav/hero anchors funnelling to them). The adversarial pass's
findings 2 and 3 were taken as established per the brief, not re-derived. `npm test` was NOT re-run (this
pass changes one documentation file); the `451e7c6` baseline stands and an executor re-measures regardless.

**Could not settle without the owner:** the six questions in §11.
