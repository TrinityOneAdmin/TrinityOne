# Audit backlog

What's left from the 2026-07-24 audit (security / data-integrity / performance / UX), after the fix pass of
2026-07-24→25. Everything **CRITICAL and HIGH in the security and data-loss categories is closed**; what
follows is the remainder, honestly ranked. Kept in the repo rather than in a chat log so it can be worked
through, argued with, or deliberately closed as "won't do".

Nothing here loses data or breaks tenant isolation.

**Closed on 2026-07-25** (all device-verified where the member app was involved): NIP-09 deletion tombstones
+ boot backfill, honest `OK false` on a discarded replaceable write, the Android app-link for invites
(manifest + `/.well-known/assetlinks.json` + a launch-URL handler + the join-page copy), the docs-hub prefix
index, emit coalescing on 10 subscriptions, and a self-healing fallback for a dangling active church (a silent
blank-app bug found by accident on the test phone). The church master-key ceremony and the wizard rail/step
labels turned out to be already done — those entries were stale.

---

## Needs a supervised pass (deliberately not done unattended)

- **Console `window.confirm` → `SkConfirm` (8 sites).** `stew-schedule.jsx:493,494,527,890`,
  `stew-meals.jsx:587`, `stew-dashboard.jsx:3401,4626`. These guard destructive actions (remove event for
  everyone, close a care need, leave a network, restore a church over the local key). A botched refactor drops
  a confirmation entirely, which is worse than an unstyled dialog. Two `window.confirm` calls in
  `identity-extras.jsx` / `screens-library.jsx` are a **deliberate exception** — the comment explains that the
  ugliness is the point for key-overwrite — and should stay.
- **Device verification of the 2026-07-25 batch.** The phone was unplugged partway through; the perf, a11y,
  jsQR-on-demand and console-boot changes are verified by the suite and by reading, not on hardware.

## Performance (all latent — a8 holds ~427 events; these are walls at 5k+)

- **Port the member app's `_docsHub` into `src/steward.src.js`.** *(NEEDS SUPERVISION — this is a large
  refactor of the app a church LEADER uses, and the console cannot be click-tested from here. Left deliberately.)* Subscriptions are now shared per stream
  (`app/steward-root.jsx makeSub`), which removed the duplicate-stream multiplier, but each console stream is
  still limit-less and cursor-less. The member-side implementation (`src/fellowship.src.js` `_docsHub` /
  `_onChurchDocs`) is proven and the handler shape is identical — a mechanical port.
- **Both canonical relays are the same box** (`CANONICAL_RELAYS` — a8 via Cloudflare and via Tailscale), so
  every read is paid for twice on a member's data plan for network-path redundancy only. Publish to both; read
  from one and fail over.
- **Duplicate member-app subscriptions**: `subscribeSermons` (byte-identical to a docs-hub filter, opened from
  two screens), `subscribeMyReqReplies` + `subscribeMyRsvps` (same stream, different d-prefix),
  `subscribeSafetyCheck` ×2, `subscribeCareRequests` ×2.
- **Live broadcast is O(connections × subs × filters)** per stored event (`gateway.mjs`). Fine at pilot scale;
  the ceiling to watch.
- **A tag-index table** (`#p`/`#t`/`#e`) in `event-store.mjs` would make several of the above cheap at the
  relay layer in one change.
- **Chat renders 200 unvirtualised bubbles** (~2,000 DOM nodes). Bounded, so it can't run away; virtualise only
  if it measures badly on a low-end device.

## UX / accessibility

- **Light-mode contrast: white on `--clay` is 4.36:1**, just under AA for the size it's used at. Dark mode is
  fixed (2.56 → 6.48 via `--on-clay`). Fixing light means either filling buttons with `--clay-deep` (6.47:1) or
  darkening the brand hex — a design decision, not an audit fix.
- **UI is fixed-px throughout** and the text-size setting only scales scripture, not the 10.5px chrome. The
  `fontSize: 16 * scale * rs` pattern is right; it just needs to reach outside the reader. (No
  `user-scalable=no` anywhere, so pinch-zoom does work.)
- **Remaining protocol jargon**: `screens-giving.jsx` ("signed by the church's key on Nostr", "Lightning
  address"), and `stew-console.jsx` has a `curl … | sudo bash` line inside a section headed "no command line".
  `help-data.jsx` already quarantines this kind of detail under a `type: 'tech'` block — apply that pattern.

## Won't-do / decided

- `NostrSheet` (`screens-chat.jsx`) stays. It is reachable only via `?identity=`, and its two genuinely
  dangerous edges are fixed (irreversible "New identity" now confirms; the headline no longer asserts anonymity
  to a member using their real name). Deleting 500 lines of live-but-unlinked code is riskier than leaving it.
- `window.confirm` for **key overwrite** stays deliberately ugly — see the comment at its call sites.

---

## Open from the 2026-07-25 adversarial audit (5 reviews of the 48h diff)

**Status 2026-07-26:** everything in this section has been worked through EXCEPT the four listed under
"Still open" at the end. Fixed since: the wrong steward message, the wizard duplicate-meetings race, calendar
event editing (plus a bare unconfirmed Remove that deleted for the whole church in one tap), the restored
relay-address step, Today's panels watching the previous church after a switch, shared streams surviving a
reconnect as corpses, the short-phrase wizard dead-end, and six invisible icons.


The CRITICAL and HIGH findings were fixed in `ae79ddf` (deployed). These survived, unassessed — the owner
asked for them to be noted, not fixed. Ranked.

### Relay
- **Refusal reasons reach the steward as the wrong message.** `stew-dashboard.jsx` PublishErrorBanner
  pattern-matches `/not a member|not permitted|blocked/i`. So `invalid: a newer version of this is already
  stored` falls to the generic *"check the connection and try again"* — which will never work — while
  `blocked: this event was deleted by its author` now matches the **"this relay is set up for a different
  church — restore this church's key in Settings"** branch. That is a dangerous suggestion to hand a steward.
  Unreachable from the console today (it never publishes kind-5 and always mints new ids), but one refactor
  away. The banner should surface the relay's own reason, not re-derive one from three substrings.
- **Cross-tenant tombstone rows.** `MEMBERS` is a relay-wide union and kind-5 falls through `accept()` to
  `isMember`, so any member of any tenant can write tombstone rows targeting another church's event ids. Since
  `isDeleted()` is now author-exact those rows are inert — no censorship primitive — but they still accumulate
  and are never pruned. Consider scoping kind-5 acceptance per church.

### App links
- **A crafted link to our OWN host still adopts a relay + church with no confirmation.** Host-pinning stops a
  third-party app injecting an intent, but not a hostile `https://app.trinityone.church/join?follow=<attacker>
  &relay=wss://attacker` sent to a member. That relay then receives their profile, membership, chat, DM
  metadata and a socket on every launch — a durable pubkey<->IP binding, which for this audience is the whole
  threat model. Needs an explicit confirm before adopting an unknown relay from a link. **UX decision.**
- **`appUrlOpen` does a full page reload**, destroying unsaved state — a half-typed message, and (worse) a
  newly minted child account's 12 words, which `identity.jsx` holds in React state only.
- **minSdk is 22**; `autoVerify` needs 23+, and only 31+ falls back silently. On API 23-30 a failed
  verification shows an "Open with..." chooser on every invite tap. The manifest comment claims otherwise.
- **Self-hosted churches never get the in-app path** — `AndroidManifest.xml` hard-codes the host, so their
  `/join` link always opens the browser however they serve assetlinks. Needs a per-domain intent-filter, which
  the manifest cannot know at build time.

### Member app
- **Today's care-request and safety-check panels keep watching the PREVIOUS church after a switch.** They key
  on `Fellowship.churchPub`, which a parent effect sets after the child effects run, and nothing re-subscribes.
  Pre-existing (the old inline versions read the same global at the same moment), but sharing makes it visible:
  a late joiner is now painted the old church's last value instantly.
- **Shared streams are not re-opened by `reconnectAll()`.** Watch's 12-second "slow -> Retry" button is a no-op
  while another screen holds the same stream.

### Console
- **The 1.8s wizard race now pollutes the calendar.** If `church.name` is still empty 1.8s after mount (slow
  relay, 2G cold start) an ESTABLISHED church gets the first-run wizard — which now publishes two fresh
  Sunday Service / Midweek events with new ids, so they cannot replace the existing ones. Permanent duplicates.
- **A phrase shorter than 12 words dead-ends the wizard**: the challenge effect early-returns, `challenge`
  stays empty, `canContinue` is false forever, and the phrase is now hidden so there is nothing to read either.
  Latent (only reachable via the localhost-gated `?churchkey=`), but the guard belongs in `canContinue`.
- **One-frame flash** of the quiz heading before the effect supplies its inputs; visible as a stutter on the
  Android WebView. Deriving the draw in the `setSaved` handler removes it.
- **The Tauri desktop app still deep-links `?setup=1`** (`relay-app/desktop/src-tauri/src/main.rs`), now inert.
  More importantly the church-in-a-box operator LOST the relay-setup step that the deleted `WizRelays`
  provided — the surviving wizard offers only the admin-token box. Deliberate decision needed.
- ~10 marketing HTML links still carry `?setup=1`. Harmless dead params.

### Tests
- **Nothing asserts the three subscriptions still route through `_shared`.** Reinstating the duplicate-REQ
  regression directly (calling `_openSermons`) leaves the whole suite green.

### Still open (deliberate)

- **A crafted link to our own host adopts a relay + church with no confirmation.** The owner has seen the
  evidence: the strong confirm that exists guards `?invite=` (identity replacement), not `?follow=&relay=`.
  `followChurch` calls `addRelay` after only a `wss://` check, which enforces encryption, not trust. Fixing it
  means a prompt in the join flow — a friction trade-off, so it is the owner's call. Narrowest option: prompt
  only for relays outside the canonical pool (no friction for a normal invite, one prompt for a self-hosted
  church).
- **`appUrlOpen` does a full page reload**, destroying unsaved state — including a newly minted child account's
  12 words, which `identity.jsx` holds in React state only.
- **minSdk 22.** `autoVerify` needs API 23+, and only 31+ falls back silently; on 23-30 a failed verification
  shows an "Open with…" chooser on every invite tap. The manifest comment claims otherwise.
- **Self-hosted churches never get the in-app join path** — the manifest hard-codes the host, so their `/join`
  link always opens the browser. Needs a per-domain intent-filter the manifest cannot know at build time.
- **One-frame flash** of the wizard's quiz heading before the effect supplies its inputs. Cosmetic; deriving the
  draw in the `setSaved` handler instead of an effect would remove it.

### Found by the on-device hard test, 2026-07-26 (OPPO CPH2477, Android 12)

- **FIXED:** re-tapping the same invite link did nothing. The dedupe guard that stops a cold-start reload loop
  was applied to `appUrlOpen` too, but that event only fires because the member just tapped a link — it is never
  a replay. Now only `getLaunchUrl()` is de-duplicated.
- **OPEN:** skipping setup silently discards a pending invite. A follow arriving before onboarding is held in
  `pendingFollowRef` (memory only) and applied when the wizard completes; "Skip setup for now" drops it with no
  trace, and `trinityone.onboarded` stays null so the wizard returns on next launch with the church gone. The
  member has to find the link again. Persisting the pending follow would fix it.
- **Low-end device baseline** (Helio G-series, 3.8GB RAM): install 24s, first-ever cold start 3.9s, later cold
  starts 2.1s, first paint 1.5s, first contentful paint 3.5s, heap 30MB, 325 DOM nodes, and — the good news —
  **zero long tasks over 50ms**, so nothing blocks the main thread. The 3.5s FCP is CPU-bound: 42 separate
  script files to parse on every cold start. Note the APK serves its shell from local files, so this is not a
  bandwidth cost; the thin-pipe cost is relay traffic and module downloads only.
- App links verify on Android 12 as well as 16. Android 12 (SDK 31) is the first version that falls back
  silently, so this device cannot test the "Open with…" chooser on API 23-30 — that remains unverified.
