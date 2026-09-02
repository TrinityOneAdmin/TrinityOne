# Plan: nothing signs a church's own relay in

Branch `relay/closed-network`, tip `59b2c0a`. **This gates the merge of the closed-network work.**

## The problem, as measured

`enrolRelayNet()` is defined and exported in `src/steward.src.js` and has **zero call sites in any UI
file**. Only tests call it. It works — driven by hand on 2026-09-02, a real phone then admitted the
relay it signed.

Why that is a blocker rather than a nicety, in three measured steps:

1. `proveRelay()` (`src/relay-net.src.js`) admits a relay by one of three roots: `canonical` (pinned in
   the app), `origin` (the relay URL **is** the page's serving origin), or `church` (the proved pubkey
   appears in the church's signed `trinityone/relay-net` doc).
2. **The APK's origin is `https://localhost`** — measured on the Oppo, 2026-09-02. A church's relay is
   never there, so root `origin` **can never fire on a phone**. It is a console-only convenience.
3. Therefore a self-hosting church that is not on the canonical pins reaches its relay from a phone by
   **exactly one** route: root `church`. Nothing creates that document.

**Consequence on merge day:** every member's phone in such a church loses its relay, while the
steward's console keeps working perfectly through root `origin`. The steward has no symptom on the
screen they are looking at. This is the marketed path — the Suite — so it is the common case, not
the edge case.

Reproduced on hardware before any fix: 3 candidates, none verified, publish set empty, nothing
reached the relay, health false.

## What the function already gets right — do not re-litigate

Read the comment block above `enrolRelayNet` before touching it. It is **additive, never
subtractive**; a new entry gets `alwaysOn: true` while an existing entry keeps whatever the church
set; an incomplete read returns `{ unknown: true }` and writes **nothing**, because treating a
timed-out read as an empty church would un-admit every box the church had signed; and it refreshes an
entry's `url` in place while matching on `pubkey` only, which is what survives tunnel churn.

It is also **idempotent**: `if (!entries.length || !changed) return { published: false, … }`. Calling
it repeatedly is cheap and publishes nothing when nothing changed. That is what makes a call-on-boot
safe, and it is the property the whole fix leans on.

## The fix — three parts, and all three are needed

### Part 1 — call it automatically on console boot

`app/steward-root.jsx`, in `initChurch()` (line ~309), alongside the two calls already there:

```js
window.Steward.init();
if (window.Steward.hasKey && window.Steward.selfRegister) window.Steward.selfRegister('').catch(() => {});
if (window.Steward.hasKey && window.Steward.autoSyncIfRedundant) setTimeout(…, 5000);
```

Add a third in the same idiom — feature-detected, deferred so it never competes with boot, errors
swallowed. **Two ordering constraints the implementer must honour:**

- It must run **after `autoSyncIfRedundant` has settled**, not before. Enrolment's one-time seed reads
  `trinityone/relays`, which is the document `autoSyncIfRedundant` writes. The seed is one-time
  (`if (!mine)`), so if enrolment publishes first, the seed never happens at all.
- **Verify `hasKey` is sufficient.** `enrolRelayNet` throws `'No church key on this device'` when `sk`
  is falsy, and a PIN-locked console may have `hasKey` true with `sk` null. `selfRegister` uses the
  same guard, so it may already be fine — but this is an assumption, not a finding, and it must be
  checked rather than copied. If it is not sufficient, enrolment must also run on unlock.

### Part 2 — make it visible in the relay panel

Part 1 alone is silent automation that can silently do nothing: on a slow link the read does not
complete, `{ unknown: true }` comes back, and **nothing is published and nobody is told**. A silent
mechanism failing silently is how this gap arrived.

The relay panel must show whether the church has signed this box in — signed / not signed yet — so a
steward can see the true state. Describe the consequence, do not nag: this is a mechanism, not a
policy (CLAUDE.md §7, `safeguarding-mechanism-not-policy`).

### Part 3 — a manual "sign this relay in" action

Because the automatic path can legitimately no-op (`unknown`), there must be a way to ask again
without restarting the console. Same function, same idempotency, no new logic.

## Test obligations

**CLAUDE.md §3 forbids asserting this by matching text in `app/*.jsx`.** Those files ship unbundled,
so `false && ` in front of the call leaves every word in place and a text-matching assertion still
passes. The call site MUST be proved by execution.

The technique already exists in this repo — `scripts/console-relay-health.test.mjs` reads
`app/steward-root.jsx`, slices the function by anchors, builds it with `new Function(…)` injecting a
fake `window`, and runs it. Follow that:

1. **Point-of-use (§1):** run `initChurch()` with a stubbed `window.Steward` and assert
   `enrolRelayNet` was invoked. **This test must fail if the call is deleted from the screen** — that
   is the whole point, and it is the test the engine's 22 existing tests do not provide.
2. **Ordering:** assert enrolment is not invoked before `autoSyncIfRedundant`, so the seed survives.
3. **Sabotage-verify each one**, scoped to the function under test — near-identical siblings are this
   codebase's house style and a plain string-replace hits the first match, usually somebody else's.
4. **Account for the test count (§8).** Current: 2445 / 0 fail on this branch.

## What must not change

- Root 3 matches **pubkey, never URL**. URL matching drops every self-hosting church off every phone
  on each tunnel restart.
- The relay-net read at `fellowship.src.js:650` stays **unfiltered**. Gate it and the bootstrap
  deadlocks.
- Additive-never-subtractive in `enrolRelayNet`. A failed probe must never remove a signed entry.
- Nothing here writes to `trinityone/relays` — it keeps its own meaning.
- Backwards compatible by construction: this adds a call and a panel, repurposes nothing.

## Verification before merge

The suite passing is not the gate (CLAUDE.md §6).

1. Relay process must be **newer than `scripts/gateway.mjs`** — a stale relay enforces old gates and
   has produced a false finding three times, including on 2026-09-02.
2. Console boot on a church whose relay is neither canonical nor previously signed → the doc appears
   on the relay, signed by the church.
3. **A phone that has never seen that relay** then admits it, cold cache. This is the test that
   matters and neither device can prove alone.
4. Confirm a second console boot publishes **nothing** (idempotency), by reading the relay.

## Ordering against the rest of the merge

Unchanged: **relays before apps.** a8 currently 404s on `/relay-identity`. This plan adds a second
precondition ahead of the gate — enrolment must ship *with or before* the gate, never after.

See `reference/RELAY-ADMISSION.md` for the architecture this protects.
