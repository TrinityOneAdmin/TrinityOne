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

## Deferred from AUDIT-2026-07-26-RECOVERY.md (its five CRITICALs are closed; these are not)

Recorded 2026-07-26 after the CRITICAL fix pass on `recovery/2026-07-26`. Ranked by what a real person loses.

- **CRITICAL/HIGH 5 — a re-seated member's OLD key stays admitted, and Block disappears with the row.**
  `src/steward.src.js` (`_superseded` filters the roster and the count, not chat) vs `app/stew-dashboard.jsx`.
  Losing the phone is the usual reason for losing the words, so the realistic case is a phone taken at a
  checkpoint: the steward reconnects the member believing the old entry is folded away, and the old key is
  still in the church, still able to read groups and post, with no UI left to remove it. Shape: ask "was the
  old phone lost or stolen?" in the Reconnect modal and block the old key in the same action; at minimum keep
  re-seated keys reachable in the blocked-style list. **This is the next thing to do.**

- **HIGH S1 — the care-team roster is trusted from ANY author**, so an "ask for help" can be sealed to an
  attacker. `src/fellowship.src.js` `_fetchCareTeam`, duplicated inline in `publishCareRequest`, consumed by
  `sendCareChat`. Every other church-authored doc in that file gates on
  `e.pubkey === cp || _churchRoster.get(cp).has(e.pubkey)`; `careteam:` — the doc that decides who the
  crown-jewel secret is encrypted to — does not. Reachable without an insider via a crafted
  `?follow=<real church>&relay=wss://attacker/relay` link.

- **HIGH S2 — child-safe groups are the only chat still readable by an ANONYMOUS connection.**
  `scripts/gateway.mjs` (~1566). The auth gate is skipped for child-safe groups, so the one remaining
  anonymously-readable room is the one containing children. `relay-childsafe.test.mjs` never issues an
  unauthenticated read, which is why it passes.

- **HIGH S3 — the NIP-42 relay-binding check compares against a CLIENT-SUPPLIED Host header.**
  `scripts/gateway.mjs` (`ws._host` from `req.headers.host`, and `boundToUs`). a8 happens to be safe because
  Cloudflare rewrites Host; every self-hosting church, LAN relay, Tailscale Funnel and the desktop relay app is
  not. `relay-auth-binding.test.mjs` passes because its client connects with `Host: 127.0.0.1` — a tautology.

- **MEDIUM S4 — a care request can be silently withdrawn by someone who is not its author.**
  `src/fellowship.src.js` (~2289 tombstone, ~2283 status): no author check, while the same diff applied the
  opposite rule to eight other doc types with eight identical comments. The realistic victim is someone whose
  abuser is in the congregation.

Also still open from that audit and NOT covered above: the "same groups" half of the Reconnect promise (
invite-only groups are per-group key lists and are not rewritten — the copy on both sides now says so, which is
honest but is not the same as making it work), plus its HIGH #7/#11 and the MEDIUM/LOW list.

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

## Member-journey audit, 2026-07-26 — OPEN (ranked)

Five reviews; this one walked the whole path a member takes. Findings reproduced against a real relay + real
app in headless chromium. The approval-recovery bug it found (#4 below) is FIXED; the rest are open and the
top three are product-level, not patches.

1. **CRITICAL — the 12 words cannot be used to restore anything.** The only mnemonic input is the `restore`
   pane of `NostrSheet` (`app/screens-chat.jsx:228`), which mounts only when the page URL carries
   `?identity=restore` (`:263`). `setNostr(true)` is called nowhere. In the APK the WebView loads a fixed URL
   and the member cannot type one, so on a new phone the paper is useless — while `app/identity.jsx:107` says
   the words are "the **only** way to get your account back" and `app/help-data.jsx:269` walks through a
   "choose Restore" flow that does not exist. Hits every member who ever changes phones.
2. **CRITICAL — a restored member would still be churchless and nameless.** `followedChurches` is device-local
   (`app/app.jsx:501`); the data IS on the relay (`member:<cp>` docs, kind-0) but nothing ever queries the
   member's OWN docs — the only `authors:[pub]` reads are DMs and the wallet. `help-data.jsx:276` states the
   opposite as fact.
3. **CRITICAL — every publish reports success when the relay is unreachable.** nostr-tools resolves rather
   than rejects on connection failure (measured: 11ms to a dead port, 3s to a black hole, both RESOLVED with a
   "connection failure" STRING). So `Promise.any(pool.publish(...))` succeeds offline at ~25 call sites.
   `markSafe` returns true and persists the ack so the member is never re-prompted — the exact outcome its own
   comment calls the worst failure this feature can have; a care request tells them "your church family knows
   you asked for help"; and the chat outbox is defeated because `_publishBounded` races a 12s timeout against a
   promise that resolves at 3s, so the event is marked delivered and dropped from the queue. Needs a wrapper
   that treats a resolved STRING as failure.
4. **FIXED** — the approval recovery only worked on a church whose docs were <3 days old (a cursored refetch,
   with the cursor already advanced to now). Now resets the cursor for that one full sync, and marks itself
   done only after dispatching. My device test passed only because that church's docs were fresh.
5. **HIGH — "No groups yet — X hasn't opened any chat rooms yet"** is also the default state on an unreachable
   relay (`app/screens-chat.jsx:545`), with no loading state; the mitigating offline banner is gated on a 6s
   timer that never fires for a returning member with cache.
6. **HIGH — the BROWSER join path drops `relayname`** (`join.js:11`), the one thing that rescues a printed
   invite whose tunnel URL has changed. The app-link path preserves it; the browser path is the primary CTA and
   the only path on iOS/desktop.
7. **HIGH — a PIN set at the last wizard step can trap a member.** `savePin` sets the PIN then calls `finish()`,
   but `onboarded` is written by `onSave`; killed in between, the unlock gate is suppressed by the wizard
   (`app/app.jsx:1575`) and `exportMnemonic()` returns null while locked — producing "type these three words"
   with no input fields and a dead Continue. Reproduced.
8. **MEDIUM** — "Continue without a name" overwrites the name a bulk-invite slip supplied; "Forgot your PIN?"
   recommends reinstalling, which is irreversible destruction given #1; a locked phone still paints church
   content and opens church-named REQs, contradicting the plausible-deniability claim; no PIN rate limit, and
   the wizard's 6-digit floor is weaker than Settings' own rule.

Clean, verified: `navigator.onLine` usage, NIP-42 re-auth after unlock, mnemonic checksum handling, the
app-link guard, and the pending-approval UI copy. The "Skip setup discards a deferred invite" item recorded
earlier is already fixed on main.

## Member restore — built 2026-07-26, PARTLY VERIFIED

Built: a "I already have an account — restore it" entry on the member wizard's first screen, opening a 12-word
pane that mirrors the steward console's (`steward-root.jsx:357`, which has always worked and is what a STEWARD
uses to recover a church — my earlier report wrongly implied no restore existed anywhere; the gap was the
MEMBER side only). It validates the phrase via importMnemonic, then calls the new
`Fellowship.recoverIdentity()` to ask the relay what this identity already is, writes the churches + name to
localStorage and reloads.

**PROVEN against a real relay:** the display name comes back from kind-0; a church the member LEFT is correctly
not resurrected; ordering is newest-first.

**CONFIRMED BROKEN ON DEVICE (2026-07-26) — the important half:** the same run recovered ZERO churches. A member's own kind-30078 docs are
read-gated (`canRead` grants them through `authed === e.pubkey`), so they are only served over a
NIP-42-authenticated socket, and the test harness read anonymously. It does not work in the app either. Tested end-to-end on the OPPO against the live relay: wiped to a true
fresh install, restored from the phone's real 12 words —

    identity  RESTORED  (same npub, so the words and importMnemonic are correct)
    name      RESTORED  ("Sir Lloyd", from kind-0 — public, comes back in 357ms)
    churches  0         (the member's own kind-30078 member: docs are never served)

The split is the proof: the PUBLIC document arrives and the GATED ones do not, so the socket is not
NIP-42-authenticated at the moment of this read. `canRead` grants a member their own docs only through
`authed === e.pubkey`, and this pool connection has not answered a challenge — NIP-42 here is lazy, triggered
by a withheld read on an already-authenticating subscription, which this one-off query is not.

FIX DIRECTION: force an auth round-trip before the query — e.g. await the same path `_needAuth`/`reconnectAll`
uses to prove the key, or open the query on a connection that has already authenticated, then retry once on an
empty result. Needs care: a restored member has a key but no membership the relay knows about yet.

UNTIL THIS IS FIXED, a restored member gets their identity and name back but must re-follow their church by
hand (invite link or church code). That is a far better position than before — the account itself is no longer
lost — but it is not the "same name, same groups" the help text used to promise, and the copy now says so.

Also still true: restore brings back the account and (probably) the church list, but NOT the member's notes,
journal or highlights — those need the encrypted backup file. The copy now says so.

## OPEN: an authenticated stranger gets a member-sized scan burst (relay)

Raised by the 2026-08-13 audit, and **still open by decision** rather than oversight.

Completing NIP-42 proves someone holds a key, not that a church admitted them. So any generated keypair can
connect, authenticate, and hold the 300,000 rows/second allowance instead of 25,000 — then reconnect and
repeat. It is a DoS amplification against a church's own relay (often a Raspberry Pi), not a data leak:
content gating is separate and unaffected.

**The obvious repair was written, measured, and reverted** (2026-08-14). Requiring `MEMBERS.has(ws._auth)`:

- **starved the steward console**, which authenticates as the CHURCH key and never publishes a `member:` doc,
  so it is not in `MEMBERS`. Measured on a 60k-event store: a room whose messages were the oldest went from
  20 of 20 served to none, silently, because the post-AUTH replay shares one budget across every subscription
  on the connection. Roster, safeguarding lists and care needs truncate arbitrarily — and a partial roster
  feeds read-before-write and the name-key rotation.
- **barely helped**: `accept()` lets any pubkey publish its own `member:` doc and the members set rebuilds
  immediately, so the attack cost went from one message to two. Measured: five fresh keypairs, one event
  each, members 0 → 5.

**What it actually wants**, and why it is not being guessed at again: a measured decision between narrowing
the gap between the two caps (how much scanning does a real member's deepest read need?) and a per-IP
connection rate limit. Both need numbers from a real corpus. A third guess at "who counts as trusted" is the
one thing that should not be tried.
