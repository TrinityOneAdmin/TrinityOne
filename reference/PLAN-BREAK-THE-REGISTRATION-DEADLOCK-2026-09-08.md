# Plan v2: retry registration when a relay says it does not know this church

**Supersedes v1 entirely.** v1 proposed caching the church's name. An audit refuted the diagnosis it
rested on, and re-measuring with the control confirmed the audit — see §0 of
`reference/FINDING-REGISTRATION-DEADLOCK-2026-09-08.md`. The name is not the problem and caching it
would have fixed nothing.

Pilot is close and the owner is explicitly risk-averse. The bar is **the smallest change that removes
the trap**, not the best design.

---

## The trap, in one paragraph

The console keeps a note per church per relay: *registered here — done*. It is written on success
(`src/steward.src.js:7207`), it is **never cleared**, and the switch that bypasses it is **never used**:

```js
const force = !!(opts && opts.force);            // :7168 — read here
...
const mark = churchPub + '@' + base;             // :7194
if (!force && done[mark]) continue;              // :7195 — and nothing anywhere passes force
```

So when a relay later loses the church — a reset, a restore without `church.json`, a migration to new
hardware — the console skips that relay for ever. The church cannot write its join policy
(`gateway.mjs:2288` needs `leaderOf`, which needs `CHURCH_PUBS.has(cp)`), and nothing ever tries to fix
it. **A success marker that no later failure can invalidate.**

## Change 1 — pass `force` when a refusal has been recorded

`app/stew-dashboard.jsx:1339`, today:

```js
React.useEffect(() => {
  const S = window.Steward;
  if (!S || S.actingChurch || !church.name || !S.selfRegister) return;
  S.selfRegister(church.name).catch(() => {});
}, [church.name]);
```

The change is the argument: when `relayRejectionActive()` is true — the console already persists that a
write was refused as a membership problem (`app/stew-dashboard.jsx:225`) — pass `{ force: true }`.

**Deliberately narrow, and each of these is a decision, not an oversight:**

- **Only when a rejection is on record.** A healthy church never forces, so the ordinary path is
  byte-identical to today.
- **On console load only**, via the effect that already exists. Recovery therefore costs the steward
  one reload. I am **not** adding a listener on `steward-relay-rejected`: the audit showed two
  overlapping `selfRegister` calls can latch `_regNeedsName` and hold the publish gate shut for
  `REG_GATE_MS` = 45s (`src/steward.src.js:2204`, `:7269`). One reload is a smaller price than that
  interaction, and this is the wrong week to take it.
- **`force` does not widen where we post.** `bases` (`:7185-7189`) is unchanged: `configBase()` plus the
  canonical relays, and the serving box **only** under `createHere`, which only the setup wizard passes
  (`app/stew-dashboard.jsx:754`, guarded by
  `scripts/only-the-wizard-puts-a-church-on-the-serving-box.test.mjs`). `force` skips a skip; it adds no
  destination.
- **The delegate guard is untouched.** `S.actingChurch` still returns early at `:1341`, and
  `selfRegister` refuses independently at `:7162`.

## Change 2 — stop telling stewards to restore their church key

`app/stew-dashboard.jsx:276`, reached when a refusal matches `not a member|not permitted`:

> Changes weren't saved: this relay is set up for a different church. **Restore this church's key in
> Settings**, or point the relay at this church.

That string covers both "wrong key" and "this relay does not carry this church" — and the second is far
more likely. Restoring a church key is destructive and irreversible, and it cannot fix it.

Keep `wrongChurch: true`: it is what raises `noteRelayRejection()`, which reveals the registration panel
**and now also arms Change 1**. Change the wording only — lead with the likely cause, name the control
that fixes it, demote the key theory to a parenthetical rather than an instruction.

## Tests

**Must be updated in the same commit** (the audit found both; this is the "two caller lists" trap):

- `scripts/publish-error-msg.test.mjs:118` asserts the owner message matches `/Restore this church’s
  key/` — note the curly apostrophe. It lifts `publishErrorMessage` out with `new Function` and runs it,
  so the `typeof window` guard at `:273` must survive.
- `scripts/church-setup-race.test.mjs:191` anchors on the literal `selfRegister(church.name)`.

**New, executable:** drive a real `scripts/gateway.mjs`, register a church, confirm the mark is written,
remove the church from the relay, and assert that `selfRegister(name)` skips while
`selfRegister(name, { force: true })` re-registers. That is the property the whole fix rests on, and it
fails today.

**A gap I am naming rather than hiding.** The wiring — "the effect passes `force` when a rejection is
active" — lives in `app/stew-dashboard.jsx`, which ships unbundled, so under CLAUDE.md rule 3 a
text-matching assertion about it would still pass with `false &&` in front of the condition. The
engine-level test above proves `force` works; `church-setup-race.test.mjs` anchors that the call exists.
Neither proves the argument is passed under the right condition. I do not have a way to close that
without lifting the effect, and I am not inventing one under time pressure.

## Risks

| Risk | Assessment |
|---|---|
| A forced retry hammers a relay that will never accept | Bounded: 3-4 bases, once per console load, and only while a rejection is on record. `selfRegister` already collects per-base refusals and gives up. |
| Recovery needs a reload, so a steward may sit on the banner | Accepted, deliberately (see above). The banner already tells them to act; Change 2 makes what it tells them correct. |
| `force` re-registers a church on a box that should not hold it | It cannot: `bases` is unchanged and the serving box needs `createHere`. |
| A delegated steward forces registration of someone else's church | Two independent guards, both untouched (`:1341`, `:7162`). |
| The rejection flag is stale (relay fixed another way) | It self-clears after 7 days and on the next successful write (`steward-publish-ok`). A stale force costs one skipped POST. |
| Rewording loses a genuine wrong-key case | It still raises the same alarm and opens the same panel, which is where both causes are resolved. Only the destructive advice stops being the headline. |

## What must still be true afterwards

1. A church created normally still registers and saves its join policy — the Oppo run is the reference
   (a8 14 → 15, join policy on both relays, no banner).
2. The healthy path is unchanged: no rejection on record means no `force`, byte-for-byte.
3. Full suite green, and the count accounted for.
