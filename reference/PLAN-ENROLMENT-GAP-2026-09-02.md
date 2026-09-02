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
