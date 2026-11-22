# Direct Mode — Google-free, no-extra-app push (build plan)

**Status:** PLAN — nothing built. Awaiting plan audit (must be green) before Phase 0.
**Branch:** `feat/direct-mode-push-2026-11-22` (off `main` @ b8b92b95).
**Author decisions (owner, 2026-11-22):** (1) Mode B — timer poll, lighter; (2) ALL message
types in scope (DMs included); (3) green-light Phase 0 spike via subagent only AFTER this plan
audits green.

---

## Goal

Android message notifications with **no Google (no FCM / no Play Services) and no third-party app
(no ntfy/distributor)**. The phone wakes on a timer, opens a short-lived connection to the church
relay, asks for anything new since it last checked, and posts a **local** notification. The server
is NOT in the delivery loop (unlike web-push). web-push stays the PWA default; this is the native
Android path, opt-in.

iOS is out of scope and cannot do this — Apple forbids background sockets; iOS needs APNs. Document
as a platform limit, not a gap to close here.

## The latency truth (owner asked for 10–15 min)

WorkManager periodic work has a **15-minute floor**, and Doze stretches it further when the phone has
been idle. 10 minutes is **not** reliably achievable as a periodic poll (windowed inexact alarms can
hit ~10 min but are Doze-throttled and not a clean periodic schedule). Honest promise: **~15 min when
the phone is awake-ish, longer overnight.** Acceptable per owner ("10 or 15 min is fine").

## Architecture (Mode B — timer poll)

1. `WorkManager` periodic worker (~15 min) — survives reboot, battery-friendly, **no permanent
   notification** (the Mode A foreground-service cost is avoided).
2. On each run: open relay connection → one `REQ` with `since=<last-seen>` for the member's kinds →
   read to EOSE → decode → post one local notification per new, notify-worthy event → advance the
   cursor → close.
3. Runtime host for the JS: a **headless WebView** that loads a trimmed T1 entry so the existing
   `nostr-tools` + decode + cursor code is reused rather than reimplemented in Kotlin. **This is the
   assumption Phase 0 must prove.**

## Reuse vs new

### Reuse — from the member app (the engine; survey estimate ~60–70%, UNVERIFIED until Phase 0)
- Transport: `SimplePool` — `src/fellowship.src.js:2112` (plain JS; needs only a global `WebSocket`).
- Subscriptions / kinds a member is notified on: **1** group msgs, **4** DMs, **7** reactions,
  **30078** care/guardian/announcements; filters keyed by `#p`=my pubkey / `#t`=group
  (`subscribeGroups` `:6673`, `subscribeThread` `:6604`, DM inbox `:6650`, care `:8964`).
- Decode: `_decEvt` `:958`, `_dmDecrypt` `:46`, sealed-name ring `_nameKeys` `:3054`.
- `since` cursors: `trinityone.docshub.*` / `trinityone.memhub.*` (`DOCSHUB_KEY` `:2956`,
  `MEMHUB_KEY` `:2957`; `_hubSince` `:2995`). **DMs have NO cursor today, deliberately**
  (comment `:6646-6648`: a bare cursor turns "slow" into "messages missing") — new work, Phase 3.
- Keys: `@aparajita/capacitor-secure-storage` already holds the signing key.
- Display: `@capacitor/local-notifications` (already installed; wired `app/reminders.jsx:6,73`,
  `app/app.jsx:2099`).

### Reuse — from web-push (narrow)
- The **notify-decision rules** `maybePushJoin/Message/Sermon/Safety/Cancel`
  (`scripts/gateway.mjs:4031,4074,4148,4198,4231`) — reused as the **spec** the phone re-implements
  on its own event stream, NOT as running code (they are Node server functions over server state:
  `GROUP_NAMES` `:3785`, `JOIN_NOTIFIED` `:2608`).
- Prefs concept; tap-to-open / deep-link handling.
- **NOT reused:** `pushTo` (`gateway.mjs:4021`), `/push/subscribe` (`:9768`), the NIP-98 endpoint
  proof — Direct mode registers no endpoint and takes no server push. (Confirmed: the July branch's
  transport-agnostic `pushTo` never merged; current `pushTo` is web-push-only.)

### Reuse — from the shelved July branch `push/nostr-unifiedpush`
- Kotlin plugin **scaffolding** (`plugins/trinity-unifiedpush/…` — `TrinityPushService.kt`,
  `TrinityUnifiedPushPlugin.kt`, manifest pattern, `POST_NOTIFICATIONS` runtime request). The
  distributor-receive body is replaced; the structure carries over.
- Two baked-in lessons: service must be `android:exported="false"`; native must route through
  `Fellowship.gatewayBase()` and require the literal `ok` body (a relative URL hits Capacitor's
  `https://localhost`, returns the SPA shell as 200, and silently no-ops).

### New to build
- `WorkManager` periodic worker + its scheduling, reboot re-schedule (`RECEIVE_BOOT_COMPLETED`).
- Manifest additions (today only `INTERNET`+`CAMERA`): `POST_NOTIFICATIONS`, `WAKE_LOCK`,
  `RECEIVE_BOOT_COMPLETED`. (No `FOREGROUND_SERVICE*` needed for Mode B — that's the Mode A cost we
  avoid. If a run must briefly hold a connection as an expedited job, revisit.)
- Headless WebView host + the JS bridge to post local notifications.
- On-device port of the `maybePush*` decision rules + content-free payloads + per-event-id dedupe.
- **DM `since` cursor** with an overlap window so a poll cannot drop a message (Phase 3).
- Opt-in toggle + honest battery/latency notice in the setup wizard.
- Battery-optimisation-exemption prompt (essential on Oppo/ColorOS).

## Privacy / safeguarding

- Member names are **sealed** (`_nameKeys`), so background notifications are **content-free by
  design** — "New message" / at most "New message in <group>", never sender or content. This matches
  the existing minimal-payload rule and keeps a child's name off a lock screen. Not a limitation to
  fix.
- Whether the background WebView can even read the signing key + name keys from secure-storage decides
  if we can say "…in <group>" at all. Phase 0 answers this.

## Risks (know before committing beyond Phase 0)

1. **Headless WebView booting the 10k-line `window`-fused module** in a background worker — memory,
   stability, and the glue to shim `window`/`localStorage`/DOM events. The ~60–70% reuse is a guess
   until proven. **Phase 0 gates this.**
2. **Background key access** from the worker's WebView via secure-storage — unconfirmed.
3. **Oppo/ColorOS** may defer/kill WorkManager regardless of correct code (dontkillmyapp). The real
   acceptance gate is "fires on Oppo with battery optimisation off," not the test suite.
4. **DM polling can miss messages** if `since` is naive (existing deliberate design warning) — the
   overlap window must be right.
5. **Doze** can stretch the interval well past 15 min overnight — set user expectations.

## Phase 0 — the spike (what the subagent will build/prove, then STOP)

Goal: prove the two unknowns that gate the whole build, nothing more. Throwaway/minimal code.
- **P0.1** A `WorkManager` periodic worker that fires and hosts a **headless WebView**.
- **P0.2** That WebView boots enough of the existing JS to open a `SimplePool` connection to a relay
  and run one `since=` `REQ` (reusing a real church relay from the member app's relay list).
- **P0.3** It reads the **signing key** from secure-storage in that background context (pass/fail).
- **P0.4** It posts a **local notification** via `@capacitor/local-notifications` from the worker.
- **Deliverable:** a go/no-go note — does the WebView route work, can it read keys, does a
  worker-posted notification appear — plus the rough reuse % it actually achieved. **No DM cursor, no
  decision rules, no UI — those are Phases 1–4, each separately approved.**
- **Device gate:** demonstrated on Pixel first, then Oppo (the hard one).

## Phases after a green Phase 0 (each: build → audit → owner device-test → only then near main)
- **Phase 1:** worker + manifest + reboot reschedule + battery-exempt prompt; WebView opens existing
  subscriptions; wire to local-notifications.
- **Phase 2:** port `maybePush*` decision rules client-side; content-free payloads; dedupe;
  tap/deep-link into the right screen.
- **Phase 3:** DM `since` cursor with overlap (all-messages scope).
- **Phase 4:** opt-in UI + battery/latency notice; on-device gate on Oppo + Pixel.

## Where to look (for the auditor)
- Member relay/decoder/cursors: `src/fellowship.src.js` (lines cited above).
- Server push (reference only): `scripts/gateway.mjs` (`pushTo`, `maybePush*`, `/push/*`).
- Capacitor Android: `android/` (minSdk 22, target 34), `capacitor.config.json`,
  `android/app/src/main/AndroidManifest.xml`, `package.json` (plugins).
- Shelved prior art: branch `push/nostr-unifiedpush`, its `docs/push-notifications.md`,
  `plugins/trinity-unifiedpush/`.
