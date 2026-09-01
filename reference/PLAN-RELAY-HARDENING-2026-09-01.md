# Relay discovery + inter-relay hardening — executable plan

Written 2026-09-01 against `fix/console-sweep-defects` tip **ba913fc**. Planned read-only; every code
claim below was verified by opening the file at that commit unless marked otherwise (the verification
ledger at the end says exactly what was checked versus taken on trust).

**Executor: read this preamble before item one.**

- Check out the tip of `fix/console-sweep-defects` and confirm with `git log --oneline -1` before
  reading any code. A stale worktree on this repo has produced confidently false findings before.
- A fresh worktree has no `node_modules`: ~5 tests fail on `esbuild ENOENT` regardless of code, and
  fixed-port tests collide with any concurrently running suite. Neither is a code failure.
- Run the suite through `scripts/run-tests.mjs` (process-capped), never bare `npm test` fan-out.
  Record the passing total before you start. **Every time the total moves, account for it (rule 8).**
- **Audit after every two items (rule 5).** Spawn a read-only worktree-isolated auditor briefed to
  REFUTE the fix, and give the brief the target commit sha and the node_modules/ports warning above.
- Sabotage checks must be scoped: slice the enclosing function, assert the anchor appears exactly
  once inside it, then replace. Near-identical siblings are house style here; a plain string-replace
  hits somebody else's function and reports exactly what a blind test reports.
- Nothing here touches Finance. Nothing here moves authority off the church key.

---

## 0. Corrections to the survey (read first — they reshape the plan)

`reference/RELAY-NETWORK-ROBUSTNESS.md` is right about what exists and right that the useful work is
hardening. But two of its five weaknesses are substantially already built, one is half-fixed, and it
missed the gaps that actually bite. Verified at ba913fc:

| Survey weakness | Verdict after reading the code |
|---|---|
| 1. Discovery pinned to one host | **Real, but mislocated.** The deep problem is not `CANONICAL_RELAYS` the constant — it is that (a) the canonical pool's two URLs are **one physical box** (Cloudflare route + Tailscale route to the same relayPub, said in the code's own comments at `src/fellowship.src.js:592-596`), (b) the join artefact carries **one** relay hint, and `&relayname=` only when self-hosted-on-loopback (`src/steward.src.js:6482`), and (c) the `/join` landing page **drops `relayname` entirely** (`join.js:24-26` forwards only `follow`, `relay`, `c`). Also the app's 12-word-restore name resolver asks **only** the canonical hosts (`src/fellowship.src.js:2786`), a hole the join path already fixed for itself (AUDIT-2026-07-29 S3, `app/app.jsx:~730`). |
| 2. Withholding looks like absence | **Real and correctly the highest-value item — but the proposed fix (client-facing signed completeness digests) does not survive contact for members.** See §Q1 for what to build instead. Verified: `/sync-digest` exists, is unsigned JSON, and `_syncAuth` (`scripts/gateway.mjs:242-254`) already admits **the church key and any steward** — the console can diff relays TODAY with zero wire change. An ordinary member cannot, and should not (below). |
| 3. Peer auth manual, doesn't propagate | **Substantially misdiagnosed — this is already built.** The church-signed peer set the survey proposes exists as `d=trinityone/relays` (`scripts/gateway.mjs:368`, ingested at `:1548` into `TRUSTED_RELAYS` + `PEER_URLS`, driving the 5–7-min jittered sync loop at `:4400-4438`). The console publishes it (`syncEnable`, `src/steward.src.js:2607-2620`), dedups entries **by relayPub**, and `autoSyncIfRedundant` (`:2636`) removes the manual step already. Residuals are small: URL rot for tunnel-hosted peers, and no two-relay test (§P5, §Q2). |
| 4. Failure domains counted by URL | **Essentially done on both sides.** Member app: `relaysForChurch` counts distinct boxes by relayPub (`src/fellowship.src.js:700-709`); console: `backupState`/`syncEnable` dedup by relayPub (`src/steward.src.js:2611-2630`); the relay serves `relayPub` in NIP-11 for exactly this (`scripts/gateway.mjs:3295`). What is missing is **the test that fails if the dedup is deleted** — I could not find the R1–R6 relay-list robustness tests the working notes say exist (`grep -rln relaysForChurch scripts/` hits only two unrelated tests). Possibly a rule-8 casualty. §P4. |
| 5. Sync cost unbounded | **Half stale.** The tag-scan **truncation** (correctness) is fixed: `event-store.mjs:198-216` streams newest→oldest and collects post-match under a 200k scan cap plus an aggregate budget, and `relay-scan-budget.test.mjs` pins a per-connection refilling allowance (the E1 crafted-REQ answer). What remains open is **performance at scale**: no tag index (the store's own comment at `event-store.mjs:8` defers it), and `/sync-ids` ships full per-bucket id lists, O(corpus) per pass. Post-pilot, §Q3. |

**Gaps the survey missed (the sixth weakness, in four parts):**

- **G1** — the join artefact carries one relay and usually no name; `/join` drops the name; printed
  posters outlive every URL on them. (§P1)
- **G2** — nothing tests that two real gateways converge, though cross-relay sync ships and
  `autoSyncIfRedundant` can switch it on for a real church without a human deciding to test it first.
  `reference/RELAY-COMPAT-AND-AUTOUPDATE.md` A3 already says "nothing tests this"; it is a
  prerequisite for every post-pilot item here. (§P5)
- **G3** — the church-signed kind-10002 relay list is the designated discovery authority
  (FEDERATION-PLAN Phase 2, adoption machinery live at `src/fellowship.src.js:4838-4870`, point of
  use `app/app.jsx:767`) — but the **only** call site that ever publishes one is `autoAddRelays`
  (`src/steward.src.js:6399`). A church whose steward adds a relay by hand, or by name, never
  publishes a list, so the authority document mostly does not exist. (§P3)
- **G4** — the restore path (`Fellowship.resolveRelayName`) asks only the canonical hosts: a member
  restoring 12 words for a self-hosted church, with the shared host blocked or seized, fails —
  and also tells the central host who is restoring, the exact leak S3 removed from the join path. (§P2)

---

## The strategic split, stated once

The pilot has not launched; three churches join in ~1 month. The relay replays all history through
current ingest on every update, and once churches are live the standing rule is *add, never
repurpose*. So:

- **Pre-pilot** = anything that fixes the **format of an artefact that will outlive software**:
  join links, QR posters, the seed relay list baked into shipped clients. Also test
  infrastructure that guards wire paths already running in production.
- **Post-pilot** = anything **additive** later at no extra cost. Adding a field to a document, a
  field to a JSON response, or a new endpoint is safe forever under add-never-repurpose, because
  absence must already mean the safe thing. Do not spend pre-pilot days on those.

Deliberately: **nothing in weakness 2 (withholding) is shape-critical now.** A signed digest is a
new response field; a receipt check is client-only. All of §Q1 lands cleanly after launch. The one
decision to take now costs a sentence: /sync-digest responses evolve by adding fields only.

Pre-pilot order: P1 → P2 → **audit** → P3 → P4 → **audit** → P5 → **audit**. Post-pilot order:
Q1 → Q2 → Q3 → Q4, each behind the two-gateway harness from P5.

---

## PRE-PILOT

### P1 — Join artefacts that survive losing a host

**What a person experiences if unfixed.** A church prints QR posters and hands out join slips. A
year later the primary host is seized (the UK-pilot threat) or its domain re-homed. Every poster on
every noticeboard now points at one relay hint that no longer answers; the `relayname` fallback that
would have saved a self-hosted church was never on the poster at all if the link came from the
`/join` landing (join.js drops it) or from a pool-hosted church (joinUrl only adds it on loopback).
A new member scans a working-looking code and gets an app showing nothing.

**The change.**
1. `src/steward.src.js` `joinUrl()` (:6464-6483): emit **repeated `&relay=`** params (2–3 hints:
   own relay + the canonical pool, deduped **by relayPub** where known, not URL — do not emit both
   routes to one box as if they were redundancy), and emit `&relayname=` **whenever the church's
   primary relay has a claimed directory name**, not only when loopback (`selfRelayName()` today;
   extend to ask the relay's `/relay-names/mine` for pool relays — the endpoint exists,
   `scripts/gateway.mjs:2989`).
2. `join.js` (:24-26): forward `relayname` (and every `relay` occurrence) alongside `follow`/`c`.
   Keep the wss-only guard (L9).
3. `app/app.jsx`: `safeQuery` (:525-547) — read `u.searchParams.getAll('relay')` and emit each;
   `followChurch` (:712-745) — the raw-string regexes `[?&]relay=` / `[?&]relayname=` must collect
   **all** relay matches (`matchAll`), and the relayname resolver's host list should try every
   carried relay's https base before the central fallback (it already tries the first).
4. Do NOT change the meaning of anything existing. Old links parse identically in new code; new
   links in old code degrade to "first relay wins" because `searchParams.get()` returns the first
   occurrence and unknown params are ignored — verify that claim in the shipped old parser, don't
   assume it.

**Consumers (rule 2 — verified by grep at ba913fc; re-grep before editing).**
Producers: `src/steward.src.js` `joinUrl` :6464, `joinQR` :6495, `joinLinkIsPrivate` :6491;
`app/stew-dashboard.jsx` :1771-1773 (share link, rewrites `/?follow=` → `/join?follow=`),
:3997-3998 (bulk join slips, same rewrite). Parsers: `join.js` :4-26; `app/app.jsx` `safeQuery`
:525-547 (Android app-link intents), `followChurch` :712-745 (web + paste), plus the mount-time
`location.search` reads near :525; `scripts/applink-guard.test.mjs` (asserts the parser).
Also grep `follow=` across `docs/`, `reference/help-content.md`, `migrate.html` — help copy prints
example links. The URL normalisation trap applies: `CANONICAL_RELAYS.includes(url)` comparisons in
both clients are exact-string; a hint with a trailing slash silently misses them.

**Point-of-use test (rule 1).** Extend `scripts/applink-guard.test.mjs` (pure parser, no port) AND
add a bundle-driven test: lift `joinUrl` from the **built** `vendor/steward.js` (the
lift-from-vendor recipe in the tests memory; never text-match `app/*.jsx`), configure a fake relay
state with a claimed name, and assert the produced URL contains ≥2 distinct-box relay hints and the
name. Sabotage: inside `joinUrl` only (slice the function, anchor `PUBLIC_BASE` appears once),
drop the second `relay` emission — the test must fail. For the parser: feed a two-relay link to the
lifted `safeQuery`/`followChurch` path and assert **both** relays reach `addRelay` — sabotage by
restoring `.get('relay')`. No gateway needed; no port.

**Backwards compatibility.** Old app + new link: first relay used, rest ignored — safe. New app +
old link: identical behaviour to today. Old printed links: unchanged meaning. `/join` forwarding a
param old `index.html` ignores: nothing. The one consumer that could regress is applink-guard's
whitelist (`JOIN_KEYS`), which silently drops what it does not know — that is the exact failure
mode that already bit when `relayname` was dropped from the intent path (comment at app.jsx:519-527
tells the story). Add every new key there in the same commit.

**What could go wrong / nearest prior trap.** The `relayname`-dropped-from-JOIN_KEYS incident
(app.jsx comment, "member joins, sees nothing, ever") — same shape, same file. Also
relay-list-false-alarm: do not add any new fire-and-forget publish to link generation.

**Size.** A day, plus device verification (rule 6): scan a generated QR with a real phone, join,
then kill the primary relay hint at the network level and join again from the same poster.
**Blocks/unblocked:** nothing blocks it; every printed artefact after it benefits. Do it first.

### P2 — Restore-path name resolution must not require the canonical host

**What a person experiences if unfixed.** A member of a self-hosted church loses their phone. New
phone, 12 words, restore. Their church lives on `grace-city` behind a rotating tunnel; the app asks
only `app.trinityone.church` to resolve that name (`src/fellowship.src.js:2786` loops
`CANONICAL_RELAYS` only). If that host is blocked or gone, restore finds the identity and no
church — and when it isn't blocked, the central host learns that this person, on this IP, is
restoring and which relay they seek: the join path called that combination the single most
sensitive moment there is (S3 comment, app.jsx).

**The change.** In `Fellowship.resolveRelayName` (`src/fellowship.src.js:2784-2805`): build the
mirror list as (1) the https bases of `window.Fellowship.relays` (relays this device already knew —
for a restore-from-backup or partial state these may include the church's own), then (2) the
canonical bases, first-answer-wins — mirroring the steward console's `_dirBases()`
(`src/steward.src.js:610-617`), which already does own-first. Keep the L5 wss-only guard on what
comes back, keep the Promise.race timeout (CapacitorHttp ignores abort signals on native — the
comment says so).

**Consumers.** Callers of `Fellowship.resolveRelayName`: `app/identity.jsx:177` (the restore
wizard) — verified single app caller by grep. The steward console has its own separate
`resolveRelayName` (:617) which is already correct; do not unify them in this pass (two near-
identical siblings — the sabotage-scoping trap in reverse; a shared helper is a later cleanup).

**Point-of-use test.** Lift `resolveRelayName` from built `vendor/fellowship.js`; stub `fetch` to
answer only on the non-canonical base; assert resolution succeeds with the canonical host dead.
Sabotage: inside `resolveRelayName` only, restore the `CANONICAL_RELAYS`-only loop — test fails.
No port needed (stubbed fetch); if you instead drive a real gateway's `/relay-names/resolve`,
use `requireFreePort` from `scripts/test-ports.mjs` like `relay-kind-gate.test.mjs:63` does.

**Backwards compatibility.** Client-only; no wire change; older apps unchanged. Absent state
(fresh install, empty `relays`) degrades to exactly today's behaviour.

**What could go wrong / nearest trap.** The relay-URL-normalisation trap: deriving https bases from
wss URLs is done three near-identical ways in this codebase already (fellowship :2787, steward
:611, steward :2597); copy one exactly. And the Capacitor fetch-abort trap the function already
documents — keep the race.

**Size.** Half a day. → **Audit checkpoint (P1+P2).**

### P3 — Actually publish the authority: kind-10002 on every relay-set change

**What a person experiences if unfixed.** A church adds its own relay by name in the console. The
steward believes the church is now reachable there; members' apps keep reading only the shared pool
because the church-signed relay list — the one document Phase 2 adoption honours — was never
published (the only publish trigger is the auto-pick flow, `src/steward.src.js:6399`). The day the
shared pool is gone, every member app has an empty adoption list and nothing to fall back on, and
nobody ever saw it missing because absence of a 10002 looks exactly like a church that chose the
pool.

**The change.** In `src/steward.src.js`: call `publishRelayList()` from every path that changes the
church's effective relay set — `connectRelayByName` / manual add (the paths around
`_writeExtraRelays`, :823), removal, `syncEnable`/`syncDisable` (:2607/:2644) — and **never** from
unlock/`setKey` (the removed call at :1160-1175 produced the false "restore this church's key"
banner on every healthy console; the fix history is in `relay-list-false-alarm.test.mjs`). Debounce
to one publish per settled change. `publishRelayList` itself (:2900-2904) is correct: church-key
only, `['r', url]` tags, no read/write markers — do not change its shape.

**Consumers.** Producer: `publishRelayList` :2900; existing caller :6399. Relay write gate: kind
10002 has **no explicit accept() branch** — it falls to the `return isMember` tail
(`scripts/gateway.mjs:2170`), so the publish succeeds only once the church is registered on that
relay; the registration flow is what `relay-add-explains-registration.test.mjs` guards. Read gate:
public by name, `gateway.mjs:2521`. Client reader: `subscribeChurchRelays`
(`src/fellowship.src.js:4844`) with the R2 high-water/anti-replay logic; app point of use
`app/app.jsx:767`. Tests that must stay green: `relay-list-false-alarm.test.mjs`,
`relay-kind-gate.test.mjs` (10002 is on its shipped-kinds list), `relays-always-canonical.test.mjs`.

**Point-of-use test.** Boot a real gateway (`requireFreePort`, pattern from
`relay-multichurch.test.mjs`), register a church, drive the **built** steward bundle's add-relay
path (lift, or drive over the socket as the console would), and assert a kind-10002 authored by the
church key lands on the relay and lists the added relay. Sabotage: inside the new call site only,
delete the `publishRelayList()` call — the test must fail. Second assertion, the false-alarm guard:
unlocking with no relay change publishes nothing (this is the regression the 2026-08-21 removal
fixed; if your test can't distinguish, it can't protect it).

**Backwards compatibility.** Old relays: 10002 already passes their `isMember` tail and their
public read — nothing to do. Old apps: already run the adoption subscription (shipped at
app.jsx:767); a list that now exists where none did only ever **grows** their read union, and
adoption is gated on the NIP-11 `enforces` probe, fail-closed. Existing churches with no 10002:
absence remains safe (pool fallback retained because `boxes < 2`).

**What could go wrong / nearest trap.** relay-list-false-alarm — republishing too eagerly
resurrects the sticky false banner; publish only on a real change, and route the result through
the same error tolerance the auto-pick path uses. Also the trailing-slash exact-match class:
`subscribeChurchRelays` excludes canonical URLs by exact string (:4857); publish normalised URLs.

**Size.** Half a day to a day.

### P4 — Find or rebuild the tests that hold R2/R3, and pin the app's point of use

**What a person experiences if unfixed.** Nothing — until a refactor deletes one line. The
adoption/burn/high-water machinery (`_applyChurchList`, `relaysForChurch`,
`subscribeChurchRelays`) and the by-relayPub box counting are the entire client half of discovery,
and I could not find a test that fails if `app.jsx:767` stops calling `subscribeChurchRelays`, nor
the R1–R6 tests the working notes describe (injection/failover/enforces-flag/burn). The
child-safety lesson in CLAUDE.md rule 1 is exactly this shape: a well-tested engine nobody is
required to consult.

**The change.** No production code. (1) Search harder than I could read-only — the R1–R6 tests may
live under names I didn't guess (`grep -rln "_applyChurchList\|LISTHW\|relaylist.hw" scripts/`
found nothing at ba913fc); if they are genuinely absent, say so in the commit and account for when
they disappeared (rule 8's history is the likely culprit). (2) Write/restore: a vendor-bundle test
that lifts `subscribeChurchRelays` + `relaysForChurch` and proves — against a real gateway serving
a church-signed 10002 — adoption of an enforcing relay, refusal of a non-enforcing one, burn of an
omitted one, and refusal of a replayed older list. (3) A point-of-use guard for `app.jsx:767`:
because `app/*.jsx` ships unbundled, a text-match assertion is forbidden (rule 3) — instead drive
the built app in the sim harness (the pattern in `scripts/app-boots.test.mjs` /
`console-shows-what-the-relay-serves.test.mjs`) far enough that a church with a 10002-listed second
relay is read from that relay, with the first relay down.

**Consumers.** Test-only; the functions named above plus the sim harness. Port strategy:
`requireFreePort` per gateway; pick ports by grepping existing tests' port constants to avoid the
map (`grep -hn "PORT = " scripts/*.test.mjs | sort`).

**Point-of-use sabotage.** Delete the `subscribeChurchRelays` call at app.jsx:767 (scoped: it
occurs once) — the sim test must fail. Beware the harness trap from the tests memory: if deleting a
call lets esbuild tree-shake the helper the test lifts, an all-red run means suspect the harness.

**Backwards compatibility.** None — no shipped change.

**What could go wrong / nearest trap.** Headless-sim lies (truncated `see`, hidden
visibilityState) and the confirm()-parks-the-browser trap — both in memory, both cost written
false findings before. Also the injected-outcomes lesson: at least one leg must use a REAL
gateway socket, not injected relay answers.

**Size.** A day, two if the sim leg fights back. → **Audit checkpoint (P3+P4).**

### P5 — Two real gateways, one church, provable convergence (compat doc A3)

**What a person experiences if unfixed.** A church adds a second relay; `autoSyncIfRedundant`
switches mirroring on silently. A release later, some ingest change makes relay B refuse what relay
A serves (a write-gate replayed over sync once deleted a finance journal — the accept-is-not-a-
retention-rule incident). Members on B see a church quietly missing pieces; nobody is testing the
one path that decides whether two relays ever agree.

**The change.** Test infrastructure only, but pre-pilot because the code it guards ships and
self-activates. New `scripts/relay-two-box-convergence.test.mjs`: boot two `scripts/gateway.mjs`
processes (distinct DATA_DIRs, two `requireFreePort` ports, `RELAY_SYNC` left on or trigger
`POST /sync-now`), register the same church on both, publish the church-signed
`d=trinityone/relays` doc naming both relays' `relayPub`s (read each `/status` for it) to both,
write distinct events to each side, and assert both converge to the same id set and serve it to
the same reader classes; assert **zero `store.del()`** fires during the pass (the finance-journal
assertion from compat doc A1 — grep-hook the store or count before/after). Force-exit the test
(own port + force-exit, per the injected-outcomes memory) — gateway timers keep the loop alive.

**Consumers.** Exercises, without editing: `_syncAuth` (gateway :242), `relayProof` (:527),
`syncChurchFromPeer` (:4287), `reconcileChurchWithPeer` (:4330), the RELAYS_D ingest (:1548),
`syncAllChurches` (:4401). Nearest existing patterns: `relay-multichurch.test.mjs` (spawn +
requireFreePort), `caps-narrowing-keeps-restrictions.test.mjs` (references the peer-resync path).

**Point-of-use sabotage.** Delete the RELAYS_D ingest branch at gateway.mjs:1548 (scoped — anchor
`d === RELAYS_D` occurs once): PEER_URLS never populates, sync never runs, the test must fail.
A second sabotage worth one run: break `relayProof`'s `church` tag — `_syncAuth` must refuse and
the test must fail, proving the auth is load-bearing, not decorative.

**Backwards compatibility.** None — no shipped change. But this harness is the enforcement point
for compat surface 4 ("two relays never converge, or one erases the other") from
RELAY-COMPAT-AND-AUTOUPDATE.md; once it exists, A3's two-VERSION variant is a parameter, not a
new test.

**What could go wrong / nearest trap.** Fixed-port collisions with a concurrent suite (CLAUDE.md
audit-brief note); the 5–7-min sync timer — drive `POST /sync-now` (:3135) instead of waiting;
swallowed-errors-in-relay-handlers — a throw inside the sync loop is logged and swallowed, so
assert on imported counts, never on absence of errors.

**Size.** A day. **Unblocks:** all of Q1–Q3, and compat A3. → **Audit checkpoint.**

### Deliberately NOT pre-pilot (and why)

- **A second canonical relay box.** The strongest single move against weakness 1 — today the whole
  canonical pool is one machine with two network routes, so seizure of one box is seizure of the
  pool, and `pickRelays`' different-operators preference has nothing to pick from. But it is an
  ownership/ops/governance decision (hardware, operator, jurisdiction, cost), not a code edit; the
  code is already plural everywhere (`CANONICAL_RELAYS` is an array; clients fan writes across it;
  comments at fellowship :589-596 say "add a host's wss URL here once it joins the pool").
  **Owner decision required — see the open questions.** If a box materialises pre-pilot, the code
  change is: add the URL to `CANONICAL_RELAYS` in **both** `src/fellowship.src.js:592` and
  `src/steward.src.js:542` (two copies, one meaning — change together or a console publishes where
  members don't read; `relays-always-canonical.test.mjs` guards half of this), add it to
  `DIRECTORY_PEERS` (`scripts/gateway.mjs:620-624`), rebuild bundles with `build:fellowship` /
  `build:bundles` (NOT `build:vendor` — it exits 0 and rebuilds nothing), and grep the built file
  to prove the URL landed. Note the canonical pool relays deliberately do NOT sync each other
  (clients write to all) — do not "fix" that; see the not-to-build list.
- Everything in Q1–Q4: additive later at no cost, and honest testing needs churches running
  records in more than one place, which does not exist yet.

---

## POST-PILOT

### Q1 — Withholding: what actually works, instead of client-facing completeness receipts

**The survey's idea, examined.** "Let a client ask any relay for a signed digest; two relays that
disagree are visible." Three ways it fails contact:

1. **A member cannot verify a digest over documents they may not read.** The digest
   (`_bucketDigest`) fingerprints the church's **whole corpus** — including safeguarding docs the
   relay rightly withholds from that member (default-deny canRead is the product's spine). So a
   member sees two relays "disagree" and cannot tell withholding from their own lack of clearance;
   worse, serving corpus-shaped fingerprints to any member leaks the existence-and-churn of gated
   documents. A per-member-visible digest instead would have to run canRead over the corpus per
   digest request — a DoS-shaped cost the scan-budget work exists to prevent.
2. **It moves trust rather than removing it** for the case that matters. The member's real
   adversary is "every relay I can reach is compelled together" (one box today!). Those same
   relays sign the same lying digest consistently. Signature adds non-repudiation — evidence for
   later — not detection now.
3. **Detection without remediation is an alarm nobody can act on.** What does a church do with a
   disagreement? The answers that exist are console-side: force `POST /sync-now`, export a backup,
   burn the relay from the trusted set (republish `trinityone/relays` / the 10002). All are
   steward actions. So the surface belongs in the console.

**What delivers, in three cheap pieces (all additive):**

- **Q1a — console divergence view.** The console already holds credentials `_syncAuth` accepts
  (church key or steward). Fetch `/sync-digest?church=` from each trusted relay base with a NIP-98
  proof, diff bucket fingerprints, and show it beside the existing sync status: "relay A and B
  agree (last checked …)" / "disagree on N buckets — [Sync now] [Export backup]". Files:
  `src/steward.src.js` (a sibling of `backupState`), `app/stew-dashboard.jsx` (the resync card).
  Consumers of `/sync-digest` today: `reconcileChurchWithPeer` (gateway :4330) and nothing else —
  verified by grep; adding a console caller changes no server code at all.
  Point-of-use test: against the P5 two-gateway harness, delete one event from one store and
  assert the console-facing diff reports the divergent bucket; sabotage: make the console function
  compare a relay's digest to itself. Backcompat: old relays already serve the endpoint. Size: a
  day. *Watch the alarm-shape (DOMAIN: describe the consequence, don't nag): agreement is the
  normal state and should read as quiet reassurance, not a monitoring product.*
- **Q1b — own-publish receipts in the member app.** The one thing a member can verify without
  trust: "the thing **I** published is retrievable where I published it." After a publish settles,
  read back by event id across `relaysForChurch(cp)` and surface persistent failure in the
  existing connection-health UI, quietly. No wire change, no new trust, and it catches the
  targeted-withholding case that matters to an individual (their own care request, their own
  membership announcement). Guard rails: `navigator.onLine` lies on native (memory) — never turn
  a radio-off moment into an accusation; batch checks; back off on thin pipes. Point-of-use test:
  sim publishes, one relay drops the event, the health surface must change; sabotage: skip the
  read-back. Size: a day or two.
- **Q1c — sign the digest (evidence, not detection).** Add `at` + `sig` (RELAY_SK over a canonical
  serialization of `{church, at, buckets}`) to the `/sync-digest` response, verified and stored by
  the console with Q1a. Gives a church a keepable record — "this relay attested to holding X at
  time T" — which is what lawful-compulsion disputes actually consume. Additive field; absence =
  old relay = display "unsigned". Half a day. Do NOT advertise it as withholding-proof; the
  UK-pilot rule is never overclaim a protection.

### Q2 — Peer-set residuals: URL rot for named relays

**Scenario.** A church's second relay runs behind a free tunnel; its URL changes every restart.
The trusted-relays doc pins `{pubkey, url}`; `PEER_URLS` now dials a dead URL forever, and the
console's named-relay refresher (`refreshNamedRelays`, steward :816) fixes only localStorage, not
the published doc. Sync silently stops; the divergence view (Q1a) is what makes it visible.

**Change.** Additive field in `trinityone/relays` entries: `{pubkey, url, name?}`. Gateway sync
loop: before dialing a peer whose URL fails, resolve `name` against `DIRECTORY_PEERS` mirrors and
dial the resolved URL **only if** its `/status` `relayPub` matches the pinned `pubkey` — identity
is the authority, URL is a hint. Console `syncEnable`: include the name when the relay was added
by name. Consumers: gateway :1548 ingest (tolerates unknown fields already — verify), :4406 loop;
steward `syncEnable`; the doc-type registry entry (`scripts/trinity-doc-types.mjs:67`) — update
its note. Absence of `name` = today's behaviour, safe. Point-of-use: two-gateway harness, move a
peer to a new port mid-test, assert convergence resumes; sabotage: skip the relayPub match — the
test must fail against an impostor on the old name. Nearest trap: the pubkey-vs-URL keying class
(three raw-lookup misses in one file, per memory). Size: a day.

### Q3 — Scale: bounded reconciliation and the tag index, in that order, behind probes

Keep the survey's item but resequence it. First **measure** (`scripts/relay-scan-cost.probe.mjs`
exists; add a sync-cost probe over a synthetic 100k-event church). Then: (a) add optional
time-window params to `/sync-ids`/`/sync-digest` (additive; old peers ignore them) so a pass over
years of history stops shipping full id lists; (b) re-land the tag index **only with** the
regression test that caught its revert — find the revert first (`git log --oneline --all --grep
"tag index"`) and read why; landing it blind repeats the netsim A3/E1 history. The correctness
half is already fixed (see §0) — this is performance work and it is honest to say so. Size: a
week. Do not start before a real church's corpus exists to probe against.

### Q4 — Widen directory mirrors, narrowly

Self-hosted relays already gossip-pull the whole name directory from `DIRECTORY_PEERS` (gateway
:660-676; records are self-verifying signed claims, latest-wins, capped). One small addition:
include the church's own trusted peer relays as gossip **pull** sources. Pulling signed claims
from an untrusted source is safe by construction (`verifyClaimEvent` on merits); this is NOT peer
adoption — nothing is trusted, executed, or synced because of it. It means a congregation whose
members resolve names against their own church relay (P2) see a directory that stays fresh even
cut off from the shared hosts. Size: half a day. Flag honestly: this recommendation has the
"convenient addition" shape the owner warned about — its safety rests entirely on
`verifyClaimEvent` being the only door in; the point-of-use test must prove an unsigned/forged
record pulled from a peer is dropped (sabotage: skip the verify).

---

## What should NOT be built

- **No client-facing completeness digests for members** — unverifiable over a gated corpus, leaks
  gated-doc churn, and moves trust instead of removing it (§Q1). The console is the right client.
- **No automatic sync-peer adoption**, unchanged from the survey. The church signs or it does not
  happen. Q4 is not an exception — it adopts nothing, it reads signed public records.
- **No syncing the canonical pool relays to each other.** It sounds like robustness; it would
  require every church to grant full-corpus trust to shared infrastructure it did not choose —
  authority moved off the church key. Clients already write to the whole pool; that is the design.
- **No per-event signed receipts from relays.** Per-publish signing cost on the relay's one
  thread, and a lying relay's receipt is worth what its digest is worth. Read-back (Q1b) is
  strictly better: it tests the serving path, which is the thing a member actually needs.
- **No new bootstrap transports (DHT, well-known third-party rendezvous, etc.) for the pilot.**
  The survey's "more than one transport" is answered at pilot scale by: several relay hints on
  paper (P1), names resolvable at every mirrored relay (P2/Q4), and a second canonical box (owner
  decision). A rendezvous everyone must reach is the centralisation-to-fix-centralisation trap
  the survey itself names. Revisit only when a real blocked-country deployment exists to design
  against.
- **No 10002 publish on unlock.** It was removed for cause; the cause is documented and tested.
- **No relay-side auto-repair of a church's relay list.** Only the church key edits its list.

---

## Rule-7 assumptions (state, then check — DOMAIN.md has no relay entries yet)

1. *Printed join artefacts outlive every URL on them by years.* INFERRED — P1 rests on it.
2. *All three pilot churches start on the shared pool; nobody self-hosts in month one.* INFERRED
   from pilot scope — it is why every Q item can wait.
3. *The pilot adversary is compulsion/seizure of the one shared box, not national blocking of a
   domain* (UK-pilot memory). ESTABLISHED in spirit — it makes the second box worth more than any
   transport cleverness.
4. *A steward will not watch a dashboard; divergence must surface where they already look.*
   INFERRED — shapes Q1a.

Whoever executes: if the owner corrects any of these, write the correction into
`reference/DOMAIN.md` in the same sitting.

## Open questions for the owner (blocking marked ⛔)

1. ⛔ **Second canonical relay box** — fund/operate one before the pilot? Different operator or at
   least different premises/jurisdiction from the dev box? P1's second hint and `pickRelays`'
   different-operator preference are theatre until this exists.
2. Should the shared pool relay claim a directory name (does it already? — measure
   `GET /relay-names/mine` on a8, don't assume), so pool churches' join links can carry
   `relayname` too?
3. The R1–R6 relay-list robustness tests: the working notes say they were built; I cannot find
   them at ba913fc. Were they on the unmerged branch, renamed, or lost? (P4 hinges on the answer.)
4. Q1c wording: is a signed attestation something the pilot's legal posture actually wants to
   hold, or does keepable evidence cut both ways under UK disclosure rules? Not a code question.

## Verification ledger

**Verified myself at ba913fc** (file:line opened, not trusted): everything cited inline above —
the survey's "what exists" table (all rows confirmed, though its 10002 row cites the read gate;
the write path is the `isMember` tail at gateway :2170); `_syncAuth`/`_exportAuth`; the RELAYS_D
doc end-to-end (console publish → ingest → sync loop); R2/R3 client machinery + both consoles'
relayPub dedup; the scan-cap and budget in event-store; join artefact producers and all four
parsers; `join.js` dropping `relayname`; `resolveRelayName` canonical-only in fellowship vs
own-first in steward; `subscribeChurchRelays`' single point of use; absence of any two-gateway
test and absence of findable R1–R6 tests; `requireFreePort` and the spawn pattern.

**Taken from the survey/notes without independent proof:** that the tag-index revert happened as
described (the store's comment corroborates the index's absence; I did not find the revert
commit); that the netsim A3/E1 findings' remaining exposure is fairly characterised as
scale-gated (the budget test suggests E1 is narrower than the memory note says — the executor
should re-read `relay-scan-budget.test.mjs` in full before Q3); the claim that a8 and master-01
are one box (asserted in three code comments and the deploy-topology note; not measured —
measuring both hosts' `/status` `relayPub` is a one-minute check the executor should do before
P1 emits "distinct-box" hints).

**Could not settle without the owner:** the four open questions above.
