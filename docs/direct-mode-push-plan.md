# Direct Mode — Google-free, no-extra-app push (build plan)

**Status:** PLAN — nothing built. Plan audited (Opus, read-only) 2026-11-22 → AMBER → findings
F1–F5 folded in below → cleared for Phase 0.
**Branch:** `feat/direct-mode-push-2026-11-22` (off `main` @ b8b92b95).
**Author decisions (owner, 2026-11-22):** (1) Mode B — timer poll, lighter; (2) ALL message
types in scope (DMs included); (3) Phase 0 spike via subagent only after this plan is green.

> **Citations: by SYMBOL, not line.** (Audit F1: every line number in the first draft was stale
> though every symbol was correct.) Find each at HEAD; do not trust a line number in this doc.

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
been idle. 10 minutes is **not** reliably achievable as a periodic poll. Honest promise: **~15 min
when the phone is awake-ish, longer overnight.** Acceptable per owner ("10 or 15 min is fine").
(Audit confirmed this characterisation is accurate.)

## Architecture (Mode B — timer poll)

1. `WorkManager` periodic worker (~15 min) — survives reboot, battery-friendly, **no permanent
   notification** and (audit-confirmed) **no foreground service / no FGS type needed**, because each
   run is a short open→REQ→EOSE→notify→close well under the worker window. *If* a run ever must hold
   a connection as an **expedited** job, revisit (expedited work can surface as a brief FGS on 12+
   and may need a `dataSync` type on 14).
2. On each run: open relay connection → one `REQ` with `since=<last-seen>` for the member's kinds →
   read to EOSE → decode → post one local notification per new, notify-worthy event → advance the
   cursor → close.
3. Runtime host for the JS: a **headless WebView** loading a trimmed T1 entry so the existing
   `nostr-tools` + decode + cursor JS is reused. The WebView must run on a thread with a **Looper**
   (simplest: main Looper via a Handler) and the worker must stay alive (`CoroutineWorker` /
   `ListenableWorker` + latch/future) while the async socket work runs. **This, plus the Capacitor
   bridge question (below), is what Phase 0 must prove.**

## Reuse vs new

### Reuse — from the member app (the engine; survey estimate ~60–70%, UNVERIFIED and LIKELY LOWER after F2)
- Transport: `SimplePool` (`src/fellowship.src.js`) — plain JS; opening a socket needs only a global
  `WebSocket` (no DOM/React). A real WebView provides `WebSocket` + `WebCrypto` + `localStorage`
  natively — the reason to pick WebView over a bare JS engine.
- Subscriptions / kinds a member is notified on: **1** group msgs (`subscribeGroups`), **4** DMs
  (`subscribeThread`, DM inbox `subscribeDMs`), **7** reactions (`subscribeReactions`), **30078**
  care/guardian/announcements (`subscribeCareChat`, `subscribeCareNeeds`). Filters keyed by
  `#p`=my pubkey / `#t`=group / `#church`.
- Decode: `_decEvt`, `_dmDecrypt`, sealed-name ring `_nameKeys`.
- `since` cursors: `DOCSHUB_KEY` / `MEMHUB_KEY` hubs + `_hubSince`, with an overlap precedent already
  in-tree — `_hubSinceKind1` subtracts `SINCE_SLOP`. **DMs have NO cursor today, deliberately**
  (comment inside `subscribeDMs`: a bare cursor turns "slow" into "messages missing") — new work,
  Phase 3; reuse the `SINCE_SLOP` overlap pattern there.
- Display: `@capacitor/local-notifications` is installed and wired — but only on the **foreground**
  reminder path (`app/reminders.jsx`, `app/app.jsx`). See F2: its JS API is probably NOT reachable
  from the background worker.
- Keys: `@aparajita/capacitor-secure-storage` holds the signing key — but via `window.Capacitor`.
  See F2: probably read natively in the worker, not via this JS call.

### F2 — the Capacitor-bridge gap (shapes Phase 0)
`@capacitor/local-notifications` and `@aparajita/capacitor-secure-storage` are reached through
`window.Capacitor.Plugins.*`, a bridge created by Capacitor's `BridgeActivity`/`BridgeWebView` — NOT
by a raw `WebView` constructed inside a `WorkManager` worker. Therefore the realistic mechanism is:
- **Read the signing key natively** (Kotlin reads the Keystore/EncryptedSharedPreferences the plugin
  wrote) and **inject it into the WebView** — not the JS secure-storage call.
- **Post the notification natively** via `NotificationManagerCompat` from the worker — not the
  Capacitor local-notifications JS API.
This is why the reuse % is lower than the first guess: key-read and notify become native glue.

### Reuse — from web-push (narrow)
- The **notify-decision rules** `maybePushJoin/Message/Sermon/Cancel/Safety` (`scripts/gateway.mjs`)
  — reused as the **spec** the phone re-implements, NOT as running code (Node server functions over
  server state `GROUP_NAMES`, `JOIN_NOTIFIED`). The server already sends content-free (`name = ''`,
  sealed). **F4: these rules suppress adults-only room names via `GROUP_CHILDSAFE` — the client port
  MUST carry that suppression (Phase 2), or "New message in <group>" re-leaks an adults-only room
  name onto a child's phone.**
- Prefs concept; tap-to-open / deep-link handling.
- **NOT reused:** `pushTo`, `/push/subscribe`, the NIP-98 endpoint proof — Direct mode registers no
  endpoint and takes no server push. (Audit confirmed current `pushTo` is web-push-only; the July
  branch's transport-agnostic version never merged. `registerPush` already early-returns on native,
  so the APK gets no web-push today.)

### Reuse — from the shelved July branch `push/nostr-unifiedpush`
- Kotlin plugin **scaffolding** (`plugins/trinity-unifiedpush/…`) — manifest pattern,
  `POST_NOTIFICATIONS` runtime request, plugin registration. The distributor-receive body is
  replaced; structure carries over.
- Two baked-in lessons: service/receiver must be `android:exported="false"`; native must route
  through `Fellowship.gatewayBase()` and require the literal `ok` body (a relative URL hits
  Capacitor's `https://localhost`, returns the SPA shell as 200, and silently no-ops).

### New to build
- `WorkManager` periodic worker + scheduling + reboot re-schedule (`RECEIVE_BOOT_COMPLETED`).
- Manifest additions (today only `INTERNET`+`CAMERA`): `POST_NOTIFICATIONS` (guard the runtime
  request by API level — minSdk is 22), `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`. (No `FOREGROUND_SERVICE*`
  for Mode B.)
- Headless WebView host (Looper thread + worker-kept-alive) and the native↔JS glue for key injection
  and notification posting (F2).
- On-device port of the `maybePush*` decision rules **including the `GROUP_CHILDSAFE` room-name
  suppression (F4)** + content-free payloads + per-event-id dedupe.
- **DM `since` cursor** with an overlap window (reuse the `SINCE_SLOP` pattern) so a poll cannot drop
  a message (Phase 3).
- Opt-in toggle + honest battery/latency notice in the setup wizard.
- Battery-optimisation-exemption prompt (essential on Oppo/ColorOS).

## Privacy / safeguarding

- Member names are **sealed** (`_nameKeys`), so background notifications are **content-free by
  design** — "New message" / at most "New message in <group>", never sender or content. Matches the
  server's existing `name = ''` and keeps a child's name off a lock screen. Audit confirmed this is a
  correct and sufficient posture, and that a background WebView reading the key is the *same* device
  trust boundary as the foreground app — no new leak.
- **F4 exception:** group NAMES can themselves be sensitive (adults-only rooms). The Phase-2 port of
  the decision rules must include `GROUP_CHILDSAFE` suppression. Safeguarding-relevant.

## Risks (know before committing beyond Phase 0)

1. **Headless WebView in a worker + booting `fellowship.src.js` without the React app shell.** The
   WebView gives `window`/`localStorage`/`document`/`WebSocket`/`WebCrypto` natively (no shimming —
   F3); the hard parts are (a) loading the fellowship JS standalone and (b) the Capacitor-bridge gap
   (F2). **Phase 0 gates this.**
2. **Background key access + notify likely NATIVE, not JS** (F2) — unconfirmed; Phase 0 tests the
   native path.
3. **Oppo/ColorOS** may defer/kill WorkManager regardless of correct code (dontkillmyapp). The real
   acceptance gate is "fires on Oppo with battery optimisation off," not the test suite.
4. **DM polling can miss messages** if `since` is naive (existing deliberate design warning) — the
   overlap window must be right (reuse `SINCE_SLOP`).
5. **Doze** can stretch the interval well past 15 min overnight — set user expectations.

## Phase 0 — the spike (what the subagent will build/prove, then STOP)

Goal: prove the gating unknowns, nothing more. Minimal/throwaway code, member app only.
- **P0.1** A `WorkManager` periodic worker that fires and hosts a **headless WebView** (Looper thread;
  worker kept alive while async work runs).
- **P0.2** That WebView boots enough of the existing JS to open a `SimplePool` connection to a real
  (already-admitted) church relay and run one `since=` `REQ`.
- **P0.3** The worker obtains the **signing key** — testing the **native read + inject** path (Kotlin
  reads what secure-storage persisted, injects into the WebView), and noting whether any Capacitor
  bridge exists in the WebView at all (F2). Pass/fail + which mechanism worked.
- **P0.4** A **local notification posts from the worker** — via native `NotificationManagerCompat`
  (and note whether the Capacitor plugin JS API is reachable at all).
- **Deliverable:** a go/no-go note — does the WebView boot the stack, can the worker get the key
  (how), does a worker-posted notification appear — plus the reuse % actually achieved and whether
  the mechanism is JS-bridge or native-glue. **No DM cursor, no decision rules, no UI — Phases 1–4,
  each separately approved.**
- **Device reality:** running this needs an Android runtime. The subagent builds it install-ready and
  (if an emulator/device is reachable via `adb`) runs it and captures logcat; otherwise it delivers a
  buildable member APK + a step-by-step on-device checklist for the owner. Demonstrated on **Pixel
  first, then Oppo** (the hard one).

## Phases after a green Phase 0 (each: build → audit → owner device-test → only then near main)
- **Phase 1:** worker + manifest + reboot reschedule + battery-exempt prompt; WebView opens existing
  subscriptions **via the existing relay-selection helpers — do NOT duplicate a relay list in the
  worker (F5, rule 10)**; wire to native notify.
- **Phase 2:** port `maybePush*` decision rules client-side **including `GROUP_CHILDSAFE` room-name
  suppression (F4)**; content-free payloads; dedupe; tap/deep-link into the right screen.
- **Phase 3:** DM `since` cursor with overlap (`SINCE_SLOP` pattern); all-messages scope.
- **Phase 4:** opt-in UI + battery/latency notice; on-device gate on Oppo + Pixel.

## Where to look (cite by symbol; line numbers move)
- Member relay/decoder/cursors: `src/fellowship.src.js` — `SimplePool`, `subscribeGroups`,
  `subscribeThread`, `subscribeDMs`, `subscribeCareChat`, `_decEvt`, `_dmDecrypt`, `_nameKeys`,
  `DOCSHUB_KEY`/`MEMHUB_KEY`/`_hubSince`/`_hubSinceKind1`/`SINCE_SLOP`.
- Server push (reference/spec only): `scripts/gateway.mjs` — `pushTo`, `maybePush*`, `GROUP_NAMES`,
  `GROUP_CHILDSAFE`, `JOIN_NOTIFIED`, `/push/*`.
- Native/display: `app/reminders.jsx`, `app/app.jsx` (foreground local-notifications);
  `@aparajita/capacitor-secure-storage` (key).
- Capacitor Android: `android/` (minSdk 22, target/compile 34), `capacitor.config.json`,
  `android/app/src/main/AndroidManifest.xml` (currently only INTERNET + CAMERA), `package.json`.
- Shelved prior art: branch `push/nostr-unifiedpush`, its `docs/push-notifications.md`,
  `plugins/trinity-unifiedpush/`.
