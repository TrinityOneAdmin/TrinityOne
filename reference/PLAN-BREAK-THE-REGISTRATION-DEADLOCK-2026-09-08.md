# Plan: break the registration deadlock, and stop advising a destructive fix

Two changes, both small, both aimed at the deadlock in
`reference/FINDING-REGISTRATION-DEADLOCK-2026-09-08.md`. Written before implementing so it can be
refuted cheaply. Pilot is close; the bar is "smallest change that removes the trap", not "best design".

## Change 1 — cache the church's own name, so the retry can fire

**The trap.** `app/stew-dashboard.jsx:1339`:

```js
if (!S || S.actingChurch || !church.name || !S.selfRegister) return;
S.selfRegister(church.name).catch(() => {});
```

`church.name` comes from `useStewardChurch` (`app/steward-root.jsx:298`), which fills **only** from
`subscribeProfile` — the kind-0 read back from the relays. An unregistered church cannot publish that
kind-0 (measured: `blocked: not a member or not permitted for this group`), so the name is never known,
so the retry never runs, so the church never re-registers.

**The change.** Remember the name locally, keyed by church pubkey, and let the retry fall back to it.

- **Write** the cache wherever a non-empty name for THIS church is known:
  1. when the profile subscription yields one (`useStewardChurch`), and
  2. when the console publishes one (`publishProfile`), which is the moment of setup and rename.
- **Read** it in the retry effect: `const name = church.name || cachedChurchName(pub)`.
- Key: `trinityone.steward.churchname.<churchpub>` — per church, so an identity switch cannot cross it.

**Why this is the safe one.** It adds a fallback to a guard; it removes nothing. If the cache is empty
the behaviour is exactly today's. It cannot make a working church worse, only an unregistered one
better.

**Risks, and what I claim about each**

| Risk | Assessment |
|---|---|
| A delegated steward re-registers someone else's church under their own key | The retry already returns early on `S.actingChurch`, and that guard is untouched. The cache is keyed by church pubkey, not by "the church I'm looking at". |
| A stale cached name registers the church under an old label | Possible and harmless: `selfRegister` sends a label, not authority. The next `publishProfile` corrects it, and the relay stores no name of its own (`gateway.mjs:4055`). |
| Repeated registration attempts hammer a relay that will never accept | `selfRegister` already skips a relay marked done, and the effect fires once per console load. Unchanged in frequency — today it fires whenever the name resolves. |
| The cache outlives the church (key restored, different church) | Keyed by pubkey, so a different church reads a different key. A wiped-and-recreated church has a new key. |
| localStorage unavailable / throws | Every read and write wrapped; an empty cache is exactly today's behaviour. |

**Explicitly NOT doing:** letting an unregistered church write its own kind-0 at the relay. That is one
line and would let any key seed a profile on any relay. Rejected in the finding, still rejected.

## Change 2 — stop telling stewards to restore their church key

`app/stew-dashboard.jsx:276`, reached when a refusal matches `not a member|not permitted`:

> Changes weren't saved: this relay is set up for a different church. **Restore this church's key in
> Settings**, or point the relay at this church.

That refusal string covers BOTH "wrong key" and "this church is not registered here" — and the second
is far more likely (it is what the deadlock produces). Restoring a church key is destructive and
irreversible, and it cannot fix the common cause.

**The change.** Keep `wrongChurch: true` — it is what raises `noteRelayRejection()` and reveals the
repair panel, which is the correct response. Change only the wording: lead with the likely cause, name
the control that fixes it, and demote the key theory to a parenthetical rather than an instruction.

**Risk:** a genuine wrong-key case now reads as a registration problem. Acceptable — the repair panel
it points at is where both are resolved, and the destructive action stops being the headline.

## What must still be true afterwards

1. A church created normally still registers and still saves its join policy (the Oppo run today is
   the reference: a8 14 -> 15, join policy on both relays, no banner).
2. `publish-error-msg.test.mjs` still passes — it lifts `publishErrorMessage` out of this file and runs
   it with no DOM, so the `typeof window` guard at `:273` must survive.
3. No new test asserts behaviour by matching text in `app/*.jsx` (CLAUDE.md rule 3 — it ships unbundled).
4. A test must fail if the `!church.name` fallback is removed again.
