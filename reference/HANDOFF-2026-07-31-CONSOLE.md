# Handoff — 2026-07-31: the steward console's write path

Written at the end of a long session. Everything below was **measured**, not reasoned, unless marked SUSPECTED.
Read `## Start here` and nothing else if you are short of time.

---

## Start here

**The safeguarding banner on the Members tab is FALSE and safe to ignore.** It says N of 21 members did not
receive their safeguarding record. Measured: all 21 were stored. Do not chase it as a delivery failure.

**The real bug is the opposite one, and it is worse:** `publish()` reports SUCCESS when the console cannot
reach any relay. Every console write — clearances, minors list, blocklist, group keys, the name-key envelope —
silently reports saved when nothing was saved. On a thin or flapping link the app lies about every save.

Fix that first. It is small.

---

## What produced the banner (reproduced, not guessed)

`refreshClearances` fires **twice** on one Members-tab open, 96 ms apart, both with the full roster:
`[[228,21],[324,21]]`. `created_at` is whole seconds, so both runs stamp the same second for most members. The
relay's NIP-01 tie-break (`scripts/event-store.mjs:159-162`, equal `created_at` → lowest id wins) refuses the
loser, answering `OK false, "invalid: a newer version of this is already stored — reload and edit again"`
(`scripts/gateway.mjs:3720`). Those refusals are counted as members who did not receive their record.

Measured in one run: `publish-ok: 32, publish-error: 11, banner: "11 of 21 …", clearances actually stored:
21/21`.

The double-fire is an async-guard race: the effect deps are fresh array identities on every roster emit, and
the only guard (`clearanceBackfillDone = sig`) is set in a `.then()` **after** a run that takes ≥250 ms because
of `GAP_MS` (`app/stew-dashboard.jsx:3290-3293`).

The exact count varies (runs gave 1, 10 and 11) because the tie-break is a coin flip per member. A stable 3 on
production is consistent with a slower link pushing most of run 2 into the next second, where it wins cleanly.

---

## Findings, ranked by what a steward or child experiences

1. **CONFIRMED — `publish()` reads "could not reach any relay" as "saved".**
   `vendor/steward.js:6192` returns `String("connection failure: " + err)` — it RESOLVES rather than rejecting,
   which satisfies `Promise.any` in `src/steward.src.js:854-867`. Observed: relay killed →
   `refreshClearances` over 21 members returned `{failed: 0, total: 21}`, fired 21 `steward-publish-ok`, showed
   no banner, stored nothing — and the dashboard then recorded `clearanceBackfillDone` and never retried.

2. **CONFIRMED — the safeguarding banner cries wolf.** See above. Alarm fatigue is the harm: a genuine failure
   will look identical and be dismissed.

3. **CONFIRMED — the back-fill can never finish, so it runs forever.** `clearanceBackfillDone` is only set when
   `failed === 0`, and the duplicate run guarantees `failed > 0`. Every Members visit re-seals and republishes
   the whole roster. For 500 members that is ~1000 NIP-44 seals and ~1000 events (~25 s of paced publishing)
   per visit, permanently, over exactly the connections this product is built for.

4. **CONFIRMED — after one socket drop the console goes permanently blind and reports itself healthy.**
   `relaysHealthy()` (`src/steward.src.js:1710-1715`) only returns false on `st.get(url) === false`, but
   `ensureRelay` does `relay.onclose = () => this.relays.delete(url)` (`vendor/steward.js:5986`) with
   `enableReconnect` false — so a dead relay has NO entry and `st.get(url)` is `undefined`. The reconnect ticker
   (`app/steward-root.jsx:31-39`) only fires when `relaysHealthy()` is false, so it never fires. Observed: live
   sub saw 6 members → relay killed → restarted → a 7th joined → console still saw 6, `relaysHealthy() === true`
   throughout. Only a manual reload recovers.

5. **SUSPECTED — `_relayAuthed` is never reset.** Set at `src/steward.src.js:560`, never cleared (observed
   still `true` with the relay killed). It gates the "never act on an untrusted view" guards for the care key,
   name key and this back-fill. After a re-subscribe the new socket is unauthenticated while the flag says
   authed — the condition those comments say orphans sealed names / pins children as adults.

6. **SUSPECTED — the 8 s bound in `refreshClearances` is too tight for a bad link.**
   `maxWaitForConnection` 3000 ms + `publishTimeout` 4400 ms = 7400 ms worst case against an 8000 ms race; if it
   fires, a whole batch of 20 is counted failed even if it landed.

7. **CLEAN — the relay's child rules are independent.** `MINORS_BY` / `safeguardAllows`
   (`scripts/gateway.mjs:826-870`, enforced at `:1497`, `:1530`, `:1558-1561`) come from the church's `minors:`
   doc, not the per-member clearance. **A lost clearance never exposes a child.** It only means the child's own
   app cannot tell it is a child (UI self-restraint), and nothing retries it except reopening the tab.

8. **CONFIRMED (dead code) + SUSPECTED (the real bug next door) — `steward.js:13116`.**
   `vendor/steward.js:13115-13116` ↔ `src/steward.src.js:1321-1322`: `return done;` then `return true;` in
   `removeKey()`. Leftover from **this session's own S6 change** that made it return a promise. Harmless (both
   truthy). The real problem is the one caller, `app/stew-dashboard.jsx:5284`:
   `window.Steward.removeKey(); window.location.reload();` — it never awaits the promise S6 created, so on
   native the Keystore removal can be cut off by the reload. That is precisely what S6 existed to fix.

**Not determinable from here:** whether the "can't establish a connection to wss://app.trinityone.church/relay"
seen in Firefox was the Cloudflare tunnel, the owner's VPN, or a8 restarting mid-test (a8 updates were being
triggered by commits at the time). "Interrupted while the page was loading" is Firefox's normal message for a
socket torn down by a reload and is probably benign. Nothing shows the console dialling too early or retrying
too aggressively — if anything it retries too little (see 4).

---

## Fix plan, smallest and safest first

Repo discipline applies throughout: reproduce first, red before green, sabotage every guard, and tests drive the
shipped `vendor/*.js` rather than `src`.

**1. Delete the dead `return true`** (`src/steward.src.js:1322`) and **`await removeKey()`** before
`location.reload()` (`app/stew-dashboard.jsx:5284`).
*Risk:* none for the dead line; the await adds a beat before reload.
*Test:* extend `console-key-secure-store.test.mjs` to assert the caller awaits.

**2. Stop counting `have-newer` as a lost child.** In `refreshClearances`, treat a rejection matching
`/newer version of this is already stored/` as success — the relay by definition holds a version at least as new.
*Risk:* would mask a genuine loss if another writer could win the tie. Verify against the `CLEARANCE_D` rule
(`gateway.mjs:1362-1365`) that only church/steward can write it.
*Test (red first):* drive `vendor/steward.js` against a real gateway, publish each clearance twice in one
second, assert `failed === 0` and no banner. Sabotage: make the relay refuse with `blocked: …` and assert the
banner DOES fire.

**3. Make the back-fill guard synchronous.** Set the marker *before* the first await, keyed on `sig`, and clear
it if the run reports failures so a retry is still possible.
*Risk:* a roster that genuinely changes mid-run gets skipped — keying on `sig` covers that.
*Test:* wrap `Steward.refreshClearances` in a browser probe, assert exactly ONE invocation per Members open.
That assertion is red today (`[[228,21],[324,21]]`).

**4. `publish()` must not treat a connection failure as success.** Highest severity, still small:
```js
await Promise.any(pool.publish(relays(), evt).map(p => p.then(v => {
  if (typeof v === 'string' && v.startsWith('connection failure')) throw new Error(v);
  return v;
})));
```
*Risk:* a genuine `OK true` also resolves with a string (usually `""`, `vendor/steward.js:5832-5833`), so the
check must stay prefix-specific; a nostr-tools bump could change that prefix, so pin it with an assertion
against the bundle.
*Test (red today):* kill the relay, assert `publishClearance` resolves false, `refreshClearances` reports
`failed === 21`, and the banner fires. Sabotage by reverting just the `.map`.

**5. `relaysHealthy()` must treat a missing pool entry as unhealthy.** Track URLs the console has actually
opened; return false when a previously-connected URL has no `true` status.
*Risk:* a naive `s !== true` makes boot (empty map) read unhealthy and triggers a full-corpus re-query storm —
the exact thing the current comment guards against.
*Test:* kill the relay → `relaysHealthy() === false`; restart, add a member, assert the live subscription sees
it without a reload.

**6. Reset `_relayAuthed` on disconnect** (wire `pool.onRelayConnectionFailure` / relay `onclose`).
*Risk:* a spurious reset makes the care/name-key guards refuse writes — visible and retryable, the safe
direction.
*Test:* kill the relay, assert `relayAuthed() === false` and `ensureNameKeyForMembers` returns null.

**7. (Larger, the real cure for thin pipes.) Read before write.** The church can decrypt a member's clearance
(`nip44ck(sk, mp)` is symmetric), so the back-fill can fetch existing `clearance:<pub>` docs, decrypt, and skip
members whose `{minor, cleared}` already match. A repeat Members visit becomes a no-op instead of a full
republish, removing the same-second collision at its source.
*Test:* open Members twice; assert zero EVENT frames on the second open.

---

## Device-test coverage (Oppo, build 197, admitted to Test Church 01, PIN `778899`)

| route | result |
|---|---|
| identity & locking — gate, Bible escape, wrong PIN + reason, unlock, counter cleared | **pass** |
| all five tabs render, 0 console errors | **pass** |
| church membership, rooms list, member counts (verified visually) | **pass** |
| chat posting, care & safety, reader, settings, recovery | **NOT COVERED** |

**Open question, first thing to answer:** all three rooms show *"No messages yet"* while the console shows a
member with 42 messages. Either legitimate (those messages are in a room this account is not in) or the room
preview is not populating. That preview is the unpersisted `activity` state deliberately left without a cursor
(see `reference/BACKLOG.md` → P6/P3 notes) — so it matters.

**Method note that cost time repeatedly:** `document.body.innerText` in this WebView returns screens
*underneath* an overlay, and `offsetParent !== null` does not filter them either. Three wrong conclusions in one
session came from trusting it. **Screenshot to establish what is on screen.** Also: with two TrinityOne apps
installed, `adb forward` to the first `webview_devtools_remote_*` socket may attach to the WRONG app — use
`pidof <package>`.

---

## State at handoff

- `main` green at **812 tests / 0 failures**; tree clean apart from `apk-latest.json` (build artefact).
- a8 running `8a6cecf`. **a8 updates when the owner presses the button on the relay page**, which offers
  whatever this dev box's HEAD is — so any commit here, including docs-only, arms that button and a restart
  drops every member's socket. Batch commits while they are testing.
- Oppo on build 197, admitted to Test Church 01.
- Unmerged branches: `perf/reconnect-since` (cursor machinery, wiring deliberately reverted, guarded by a test
  that fails if re-wired before a cache exists) and `perf/console-shared-docs` (P6 work, withdrawn — measured as
  no benefit).
- Audit items still open: **U6/U7/U8 remainder** (silent empty states in five more lists, destructive confirms
  in-place, and the accessibility set — 62 handlers on non-interactive elements, 231 unnamed inputs, no
  `role="alert"`, 2,472 hardcoded font sizes and no textZoom).
