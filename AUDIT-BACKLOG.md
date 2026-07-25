# Audit backlog

What's left from the 2026-07-24 audit (security / data-integrity / performance / UX), after the fix pass of
2026-07-24→25. Everything **CRITICAL and HIGH in the security and data-loss categories is closed**; what
follows is the remainder, honestly ranked. Kept in the repo rather than in a chat log so it can be worked
through, argued with, or deliberately closed as "won't do".

Nothing here loses data or breaks tenant isolation.

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

- **Port the member app's `_docsHub` into `src/steward.src.js`.** Subscriptions are now shared per stream
  (`app/steward-root.jsx makeSub`), which removed the duplicate-stream multiplier, but each console stream is
  still limit-less and cursor-less. The member-side implementation (`src/fellowship.src.js` `_docsHub` /
  `_onChurchDocs`) is proven and the handler shape is identical — a mechanical port.
- **Docs-hub replay is O(handlers × corpus).** `_onChurchDocs` copies+sorts+dispatches the whole buffer per
  registration; the member app registers ~17 handlers, re-run on every reconnect. Index the buffer by d-prefix
  once per hub and replay only the matching slice.
- **`emit()` inside `onevent` is O(n²).** ~13 subscriptions rebuild and re-sort the whole collection per
  arriving event. `subscribeStats`/`subscribeActivity` are now coalesced; the rest are not.
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

## Data integrity

- **Deleted content resurrects on resync and on restore-from-export.** There are no tombstones
  (`event-store.mjs` delete is a bare DELETE), and deletion re-application is gated on `put() === 'stored'`, so
  a relay that already holds the kind-5 never re-applies it. The negentropy path also imports in id order, so a
  kind-5 processed before its target no-ops. Needs a deletions table.
- **`gateway.mjs` ACKs a discarded replaceable write as `OK … true`.** A client that lost the newest-wins race
  is told it succeeded.

## UX / accessibility

- **Join page has no Android app-link.** `join.js` tells the user to install the app and "follow your church",
  but the manifest has only a LAUNCHER intent-filter, so the invite context (`?follow=&relay=`) is lost on
  install and the church name must be typed by hand. Add an app-link intent-filter for
  `app.trinityone.church/join`, show the join code as text under the download button, and say plainly that
  Android will ask permission to install from the browser (the #1 sideload drop-off).
- **The church's master key gets a weaker backup ceremony than a member's** (`WizBackup` is a checkbox; the
  member wizard demands three typed words). Losing it costs the whole congregation. Also: the rail promises
  "Nothing is published until you're ready" while step 1 publishes the church profile immediately, and on a
  narrow screen the step names collapse to unlabelled dots.
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
