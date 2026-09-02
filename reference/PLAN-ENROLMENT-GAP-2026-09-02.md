# Plan: nothing signs a church's own relay in

Branch `relay/closed-network`. **REVISED 2026-09-02** after an independent audit found the first
version unsafe to implement. The problem statement survived; the fix did not. What changed and why is
recorded at the bottom — read it before re-proposing anything simpler.

## The problem, as measured

`enrolRelayNet()` is defined and exported in `src/steward.src.js` and has **zero call sites in any UI
file**. Only tests call it. It works — driven by hand on 2026-09-02, a real phone then admitted the
relay it signed.

1. `proveRelay()` (`src/relay-net.src.js`) admits by three roots: `canonical`, `origin`, `church`.
2. **Root `origin` cannot fire on any native device.** `_ownOrigin()` (steward.src.js:2211) and
   `_adoptionOrigin()` (fellowship.src.js:632) both return `''` for
   `Capacitor.isNativePlatform()` **before comparing anything**. Native fails closed by construction —
   this is stronger than the `https://localhost` measurement the first draft leaned on, and does not
   depend on it.
3. So a self-hosting, non-canonical church's members reach their relay by **one** route: root
   `church`. Nothing creates that document.

**On merge day:** members lose the church's own relay while the steward's console keeps working
through root `origin`. Reproduced on hardware: 3 candidates, none verified, publish set empty, health
false.

**The symptom is partial, not clean.** The 12 ungated reads (fellowship.src.js:3596 etc.) keep DMs,
chat and reactions painting while every gated read and every publish fails. Partial is this
codebase's worst failure class — see `silent-blank-app-bugs`. Do not describe this as an outage.

## BLOCKERS — fix these before anything calls `enrolRelayNet` on a schedule

Today's exposure is ~zero *because nothing calls the function*. Every item below is armed by the act
of calling it.

### B0. `_oneComplete`'s `complete` flag is dishonest — this is a latent doc-wipe

`_oneComplete` (steward.src.js:2247) passes **no `maxWait`** to `pool.subscribeMany`. Its sibling
`_newestByD` (steward.src.js:2405) passes `maxWait: ms + 5000` and carries a comment recording why.
Measured against the real bundled nostr-tools: a **dead port returns `{ev: null, complete: true}` in
7ms**; a **silent socket returns `{ev: null, complete: true}` at 3001ms**.

So a failed read reports a *completed* read of an *empty* church. Chain, once enrolment runs on boot:
church's doc names boxes A+B → console boots while doc-holding relays are down (the documented a8
update blip is exactly this) → `relayNetDoc()` returns `{ev:null, complete:true}` → `mine` is null and
the `!complete` guard does not fire → seed read fails the same way → entries built **from scratch** →
published with `created_at: now()` → newest-wins **un-admits every box the church had signed**, on
every member's phone.

This is precisely the failure the function's own comment block promises cannot happen.

**Why 22 green tests do not see it:** `consoleWith` (is-this-relay-one-of-ours.test.mjs:109-118)
injects `_oneComplete` as `deps.one`, and the "unfinished read publishes nothing" test hands the
function `complete: false` directly. The suite proves `enrolRelayNet` honours the flag it is *given*,
never that the reader computes it honestly — the `stub-answers-the-question` shape.

**Fix, in order:**
1. Give `_oneComplete` a `maxWait`, as `_newestByD` already has.
2. `maxWait` alone is **not sufficient** — an unreachable relay still counts as finished
   (`_newestByD`'s own "RESIDUAL, deliberately left" comment concedes this). `complete` means "every
   relay I could reach finished", which is not the question enrolment asks.
3. So `_oneComplete` must also report **how many relays actually answered**, and the from-scratch
   path (`!mine`) must require at least one genuine answer. Building a membership document from
   scratch is only safe when a relay has affirmatively said "there is no document" — never when
   nobody spoke.
4. **The test must produce a REAL unfinished read** — a real `ws` server on its own port that accepts
   and never sends EOSE, plus a dead port. An injected flag cannot catch this class; that is how it
   got here. See `injected-outcomes-cannot-catch-a-dead-classifier`.

### B1. No delegated-steward guard — cross-tenant publish

`selfRegister`, the call this plan proposes to imitate, carries
`if (actingChurch) return { …skipped: 'acting as a delegated steward' }` (steward.src.js:6745), added
after a measured incident. **`enrolRelayNet` has no equivalent** (steward.src.js:2292).

In acting mode `sk` is the delegate's own key while `pub` is the acted-for church
(steward.src.js:6508), and the acting identity is restored early in boot — before a deferred call
would fire. Result: reads the other church's doc, signs with the delegate's key, and if that key is
registered the relay **accepts** it — replacing the delegate's own church's relay-net doc with
entries derived from another church's, un-admitting their own boxes. If unregistered, the refusal maps
to the sticky "set up for a different church — Restore this church's key" banner, whose remedy this
codebase documents as key-destroying. Every boot.

**Fix:** an explicit own-church guard — not acting, not a network view — before anything else.

### B2. The boot site chosen in the first draft barely runs

`hasKey` is a *sufficient* guard — it can never be true with `sk` null (`setKey` sets both at
steward.src.js:1319, `lock()` clears both at 2877). The first draft worried about the wrong thing.

The real problem is the inverse: the forced-PIN flow means an established console boots **locked**
(`_bootKeyState` → 'locked', steward.src.js:1449), so `hasKey` is false at `initChurch` time and the
whole trio is skipped. Nothing re-runs `initChurch` after `unlock()`.

**Run-on-unlock is the main path, not a fallback.** There is an existing idiom for exactly this —
`unlockTick` in `app/stew-dashboard.jsx:535` re-runs enrolment work when the key comes back.

### B3. The doc never reaches the box it admits

`enrolRelayNet` publishes via `publish()` → `relays()` — the **gated** set (steward.src.js:1906+). At
first enrolment the church's own box is not yet admitted, so the doc lands only on canonical relays.
Next boot, `!changed` suppresses the republish. **The church's own relay never stores the document
that admits it.**

Members bootstrap fine while a8 is reachable (`churchRelaysRaw()` always unions canonical). But the
UK pilot threat model is seizure or blocking of exactly that central host, and "does this work over a
thin pipe in Tehran" is the standard this product is positioned against. With a8 unreachable and no
origin root, `publish()` has zero admitted targets and enrolment can never publish at all.

**Fix:** the enrolment **write** must go off the gated list, exactly as the enrolment **read** already
does (`fellowship.src.js:650`). A box that just answered the C2 proof is admissible by definition —
that is what the proof is for. Symmetry with the read side is the rule here, not an exception to it.

## REVISED APPROACH (architecture review, 2026-09-02): manual first, not automatic

An architecture review at `e1e7d83` judged the design correct and the complexity forced, but found a
better first increment than "call it on boot".

**Ship enrolment as a MANUAL, CONFIRMED console action**, not an automatic boot job. A control in the
Relays panel that runs `enrolRelayNet`, **shows what it found before publishing** ("found 2 existing
entries; proved 1 box; publish?"), and requires a tap.

What that changes about the blockers:

- **B2 disappears.** No boot site, so the locked-console problem cannot arise — a human is present, so
  the console is unlocked by construction.
- **B0's blast radius collapses.** The wipe chain requires a *silent* from-scratch rebuild. A shown
  diff makes "0 existing entries found" visible to a human before anything is signed. **Still fix B0**
  — it is a lie in shared infrastructure — but the merge no longer bets a church's membership on it.
- **B1 shrinks to its one-line guard**, still required.
- **B3 is still required.** It is inherent to the design class, not to this codebase: any gate whose
  admitting statement is itself a write needs an ungated escape hatch for that write, symmetric with
  the already-ungated bootstrap read.

With three pilot churches, one deliberate click each is free. It is also **more consistent with the
product's own ethos than the automatic path**: `human-admission-only` says only a steward at an
unlocked console admits, never the relay. Relay admission is a larger trust decision than member
admission. Automatic-on-unlock becomes a post-pilot convenience, built once the manual path has been
exercised on real churches.

Rejected staging alternative: a temporary "admit any box that answers the C2 proof" predicate. It
literally satisfies "only T1 software talks to T1 software" with no enrolment at all, but anyone can
run the software, so it is near-vacuous against a deliberate adversary — and its admissions would sit
in the 30-day verified cache into the tightened era.

### B4. `enrolRelayNet` auto-signs anything a steward merely typed

**Found by the architecture review; a real factoring error inside the right design.**
`relayNetCandidates()` (steward.src.js:2223) enumerates `extraRelays()` — "the relay panel's own
configured entries, as typed" — and `enrolRelayNet` signs **every** candidate that answers the C2
challenge into the church's document.

So the distance between *"a steward pasted a URL to see if it works"* and *"the church has
cryptographically vouched for that box to every member's phone"* is **zero keystrokes**. Two different
decisions — "I will talk to this box" and "my whole church trusts this box" — collapsed into one. It
means the ceiling of the entire architecture is a single unconfirmed paste.

**Fix:** auto-sign the origin box only. Typed extras require the explicit, confirmed tap — which the
manual increment above provides for free.

### The question that could remove all of this from the pilot

**Will the three pilot churches self-host during the pilot month, or sit on canonical shared relays?**
If all three are on shared relays, root 3 and enrolment leave the critical path entirely: pins plus
origin suffice and the merge needs none of this. `DOMAIN.md`'s Suite-first decision suggests
otherwise, but it is a one-sentence answer from the owner and it should be asked before more is built.

## The fix, once the blockers are closed

1. **Call it on unlock and on boot-with-key**, guarded to own-church-only, deferred, errors swallowed.
2. **Show the state in the relay panel.** The Relays card already shows per-relay *admission*
   (`relayStatus`'s `member`, steward.src.js:6868) and a "Not in your network" explainer. **"Signed
   into the church's doc" is a different fact from "admitted"** — a canonical box is admitted while
   unsigned. Say which one is being shown or an implementer will duplicate the UI.
3. **A manual retry**, because the automatic path can legitimately no-op and must not do so silently.

## Test obligations

CLAUDE.md §3 forbids proving the call site by matching text in `app/*.jsx` — the file ships unbundled,
so `false && ` leaves every word in place. It must be proved by **execution**. The technique exists:
`scripts/console-relay-health.test.mjs:301` reads `app/steward-root.jsx`, slices by anchors, builds
with `new Function(…)` and runs it. Note the lift must inject `location`, `history`, `localStorage`
and `setTimeout` as well as `window`.

Required: point-of-use (fails if the call is deleted); B0's real-socket test; a delegated-console test
that asserts **nothing is published**; a test that the doc reaches the newly-proven box. Sabotage each,
scoped to the function under test. Account for the count — 2445 / 0 on this branch, unverified by the
audit and to be re-measured.

## Known-accepted, not blockers

- **Two consoles of one church** dialling the same box at different addresses flip the entry's
  advisory `url`, publishing on alternating boots. Harmless volume. Concurrent first boots are a
  lost-update that self-heals next boot.
- **A slow first boot** may fire `steward-publish-error` → the generic "check the connection" banner
  on a healthy church, because a call-site `.catch()` cannot swallow an event. Tolerate knowingly or
  await the gate's first refresh.
- **The 30-day verified cache** (`VERIFIED_KEY`/`VERIFIED_TTL_SEC`) is a fourth *practical* admission
  path — admission from cache alone. Cold on merge day, so it does not affect this plan, but
  `RELAY-ADMISSION.md` should name it.
- **Stale comment:** `_oneComplete`'s parenthetical says it reads over `relays()`; it reads
  `relaysRaw()` (steward.src.js:2255). This is the file where comments have satisfied assertions
  before.

## What must not change

Root 3 matches **pubkey, never URL**. `fellowship.src.js:650` stays unfiltered. Additive-never-
subtractive in `enrolRelayNet`. Nothing writes to `trinityone/relays`.

## Verification before merge

The suite passing is not the gate. Relay process must be **newer than `scripts/gateway.mjs`** first —
a stale relay has produced a false finding three times, including on 2026-09-02.

Then: console boot → doc appears, signed by the church, **on the church's own box**; a phone that has
never seen that relay admits it cold; a second boot publishes nothing; **a delegated steward's console
publishes nothing**; and a boot with the doc-holding relays down publishes nothing.

## What the audit changed

The first draft proposed a one-line call in `initChurch()` "in the same idiom" as its neighbours. That
was wrong in four ways, all found by reading code the plan had cited but not opened: the safety
property it leaned on is broken (B0, measured), the idiom it copied has a guard it did not copy (B1),
the site it chose does not run on a locked console (B2), and the write lands everywhere except the box
it admits (B3).

Its B2-ordering claim — enrolment after `autoSyncIfRedundant` so the seed sees `trinityone/relays` —
survives as **nearly vacuous**: post-merge `syncEnable` is fed by the gated `relays()`, so anything a
same-boot sync doc could list is already admitted and already probed. The seed's real value is
historical docs, which do not depend on boot ordering. It is also unhonourable in the current idiom,
which is a fire-and-forget `setTimeout`. Dropped as a constraint; kept as a note.

One audit finding was **not confirmed and is excluded**: that shipped copy already tells stewards to
"enrol it". No such string exists; every `enrol` in the UI refers to member enrolment.
