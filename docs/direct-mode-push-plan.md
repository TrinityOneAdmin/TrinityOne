# Direct Mode — Google-free, no-extra-app push (build plan)

**Status:** Phase 0 = GO (spike @39eaafe7 proved WebView-in-worker on the Oppo). Phase 1 "small slice"
attempt = BLOCKED (see "Phase 1 reality" below) → owner approved **Option B (same-origin boot)** on
2026-11-23. This doc's Phase-1 section is now the **Option B plan** at the bottom — awaiting its own
plan audit before the (Sonnet) build.
**Branch:** `feat/notifications-2026-11-23` (carries the plan + the throwaway spike; lineage off
`main` @ b8b92b95).
**Author decisions:** (owner 2026-11-22) Mode B timer poll; ALL message types incl. DMs; spike then
plan-gated phases. (owner 2026-11-23) Phase 1 = Option B; **build by a Sonnet agent**; all work on the
new notifications branch.

> **Phase 1 reality (2026-11-23): the "small slice" does not exist.** A build subagent STOPPED at the
> gate (built nothing) with two code-verified blockers: (1) `relaysForChurch()`→`_netRelays`→
> `_gate.admit()` (`createRelayGate`) is the terminal read of a live, cache-backed admission subsystem —
> `admit()` "consults the cache and nothing else" and drops any relay that "has never proved itself"
> (`src/relay-net.src.js`), so a cold worker gets `[]` (or ungated CANONICAL, whose use = rule-10
> widening). (2) Origin partition: `androidScheme` is unset → Capacitor-6 default `https` → app state
> lives in `https://localhost` localStorage; a `file://` worker WebView is a SEPARATE partition and
> cannot see the relay list, gate proofs, `followedChurches`, or the `docshub`/`memhub` cursors. A lean
> SimplePool-only slice therefore can know neither which relays nor what's new. → **Option B.**

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

---

# Phase 1 — OPTION B (same-origin background boot) — the build plan (2026-11-23)

**Premise shift (owner-approved):** we no longer try to lift a lean slice. Instead the background
worker hosts a WebView that runs **at the app's own origin and shares the app's data**, imports the
app's existing code, lets it bootstrap, and reads the admitted relay set + cursors the app already
built. "Boot more of the app" means load more of its CODE in the hidden page — NOT show any UI. Still
Google-free, still no extra app.

## KEY SOURCE — reuse "Remember me / Stay open 30 days" (RESOLVES F-A; owner 2026-11-23)
The PIN encrypts the key, so a background reader can't get it — **UNLESS** the member has turned on the
existing **"Stay open on this phone for 30 days"** feature (`REMEMBER_KEY = 'trinityone.nostr.remember'`,
`src/identity.src.js:138`; `rememberRead`/`rememberWrite` :141/:160). That feature stores the **mnemonic**
in the OS hardware secure store, **readable by the app UID WITHOUT the PIN**, for 30 days — expiry enforced
at read, and `rememberClear()` wipes it on lock / "forget device" / setPin / removePin / new identity /
expiry.
- **Precedent (this is exactly the owner's idea, already shipping):** the home-screen **widget** already
  reads the church npub + relay addresses **outside the app lock**, gated on exactly "remember me (or no
  PIN)" (`identity.src.js:172-178`). The notify reader rides the SAME gate, extended from "show church
  settings" to "read relay + notify."
- **Rule:** background notify is available **iff (no PIN) OR (remember-me active)**. Tie the notify
  opt-in to enabling the 30-day window. The feature's existing copy already states the exact tradeoff
  ("Anyone who can unlock this phone will be able to open your church"), so **no new consent and no new
  key-handling redesign** — we reuse a credential the member already chose to create.
- **Native read target (supersedes F-A's STORE_KEY plan):** read `capacitor-storage_trinityone.nostr.remember`
  (JSON `{m, until, pub}`); use `m` only while `until > now`; derive privkey via nip06. Fall back to
  `capacitor-storage_trinityone.nostr.mnemonic` (plaintext — the no-PIN case). If neither is present →
  **no-op quietly** (a strict-PIN member who declined "stay open" gets no background notify; respected).
- **Who gets notifications:** no-PIN members, and PIN members who ticked "stay open" (renewed each time
  they open the app). Strict PIN-only members don't — by their own choice.
- **Hardening (future, optional):** store/derive a **notify-only / read-only** credential instead of the
  full seed (NIP-26 delegation + relay support) so the background holds less than full signing power. v1
  reuses the remember seed, which is within the consent the member already gave.

## The crux assumption — PROVE THIS FIRST (Phase 1 gate 1)
The whole of Option B rests on: **a WebView created inside the WorkManager worker can see the app's
real `https://localhost` localStorage** (relay list, gate proofs, `followedChurches`,
`docshub`/`memhub` cursors). Mechanics:
- Serve the app assets under `https://localhost` in the worker's WebView via `WebViewAssetLoader` /
  `shouldInterceptRequest` (so the origin matches the app, not `file://`).
- Share the WebView **data directory**: Android isolates WebView storage per *process* by
  `setDataDirectorySuffix`. WorkManager workers run in the app's **main process** by default, so with
  the **default (no-suffix) data dir** the worker WebView should share the app's localStorage. Confirm
  the worker is NOT configured into a `:remote`/separate process.
- **Gate:** boot a tiny page in the worker WebView and read `localStorage.getItem(RELAYS_KEY)` (and a
  known gate-proof key). If the app's real relay list is visible → proceed. **If NOT visible (separate
  partition after all) → STOP and report;** Option B's reuse premise has failed and we rethink (do not
  fall back to an ungated relay list — rule 10).
- **Audit F-C:** run this proof with the app **cold / backgrounded** (the real case when a 15-min worker
  fires), not foregrounded — Chromium holds DOM storage in a per-renderer in-memory cache, so a
  foreground app may not have flushed recent writes to the backing store. And keep Phase 1 **read-mostly**
  (count only): two live contexts writing `docshub`/`memhub` can race, so leave cursor writes to Phase 3.

## Phase 1 gate 2 — boot the app code headlessly enough to get the admitted relay set
- Import `src/fellowship.src.js` (bundled) in the shared-origin WebView; let `loadRelays()` /
  `churchRelayNet()` / the gate hydrate from the shared localStorage/caches.
- Set the active church the way `app/app.jsx` does on launch — read `trinityone.activeChurch` /
  `trinityone.followedChurches` and set `window.Fellowship.churchPub` / active church. (Replicate ONLY
  the init sequence app.jsx runs; do not render React.) **Audit F-F: this is a PREREQUISITE, not
  optional — `_netRelays` defaults `cp` to `window.Fellowship.churchPub`, and several hot-path functions
  early-return when `churchPub` doesn't match. Set churchPub BEFORE calling `relaysForChurch()`.**
- Call the EXISTING `relaysForChurch()` / publish-set helpers to get the admitted set — do NOT
  duplicate or widen it (rule 10 / F5). If the proof cache is warm (shared from the app) this returns
  the real set without new round-trips; if cold, allow `verifyRelayIdentity` to re-prove (the normal
  path), but never use an unproven/ungated relay.
- **If booting fellowship.src.js standalone proves intractable** (hard dependence on React/app.jsx
  wiring that can't be reasonably replicated) → STOP and report specifics (this was the Phase-0-flagged
  risk; an honest "can't boot headlessly" is a valid outcome, not a hack-around).

## Phase 1 gate 3 — authenticate, then count new events
- **NIP-42 auth is now in Phase-1 scope** (the builder's finding): kinds 4 (DM) and 30078
  (care/guardian) are read-gated/default-deny, so the worker must complete NIP-42 to even COUNT them.
  The worker signs the relay's auth challenge with the member privkey — derived natively (see keys
  below) and injected — reusing the app's existing auth/signing path where possible.
- Run ONE `since=<last-seen>` REQ across the notify-kinds (1 group, 4 DM, 7 reactions, 30078
  care/guardian), `#p`=member pubkey; read to EOSE; **count** new events since last-seen. Reuse the
  shared `docshub`/`memhub` cursors + the `SINCE_SLOP` overlap pattern (READ them; don't rewrite — F-C).
  (No content decode, no notify-worthiness rules, no per-group naming — that is Phase 2. DM-cursor
  refinement is Phase 3; Phase 1 may count DMs crudely via the inbox filter.)
- **Audit F-E (clock skew):** if the device clock is >600s off the relay, NIP-42 AUTH is refused and the
  count silently comes back 0. Log a line distinguishing "auth failed / skew" from "genuinely nothing
  new," so a dead count isn't mistaken for quiet.

## Native side (Kotlin) — reuse the proven spike patterns
- `WorkManager` **periodic** worker (~15 min), main process, hosting the WebView on a main-Looper
  thread, kept alive via `CompletableDeferred` while async work runs. (All proven in Phase 0.)
- **Signing key, native read (CORRECTED per audit F-A):** read **`capacitor-storage_trinityone.nostr.mnemonic`**
  (STORE_KEY, the **plaintext mnemonic**) from `WSSecureStorageSharedPreferences` (prefix
  `capacitor-storage_` is the verified default; no `setKeyPrefix` anywhere), then derive the privkey via
  nip06 `privateKeyFromSeedWords`. Reuse the spike's `SecretStoreCompat.kt` scheme (byte-identical to
  the plugin) — but note the spike README mistakenly targeted `…mnemonic.enc`; target STORE_KEY, NOT
  ENC_KEY.
  - **PIN/passphrase installs are OUT OF SCOPE for background notify.** Setting a PIN calls
    `secureRemove()` (`src/identity.src.js:726`, "drop the plaintext seed") — it DELETES the plaintext
    and keeps only `…mnemonic.enc`, encrypted with `PBKDF2(user-PIN)→AES-GCM` (identity.src.js:81-82).
    The worker has no PIN, so the key is unreadable. **Product limitation to accept/flag:** a
    PIN-protected member gets no background notifications. The worker must detect "no plaintext key"
    and no-op quietly (not crash, not guess). *(Owner decision pending on whether PIN support matters
    for the pilot — see report.)*
- Post a generic **native** notification via `NotificationManagerCompat` when count>0 (no Capacitor
  plugin — no JS bridge in a bg WebView, confirmed Phase 0).
- Reschedule the periodic work on boot (`RECEIVE_BOOT_COMPLETED` receiver, `exported="false"`);
  request `POST_NOTIFICATIONS` at runtime (guard by API — minSdk 22); add a battery-optimisation
  exemption prompt/flow. No foreground service / no FGS type (Mode B).

## Salvage directly from the Phase-0 spike (`spikes/push0/`)
`SecretStoreCompat.kt`; the CoroutineWorker + main-Looper WebView + `CompletableDeferred` keep-alive;
`NotificationManagerCompat` notify; the esbuild bundling approach for the JS. Promote native code to a
TRACKED `plugins/…` path (NOT the gitignored `android/` tree); record any unavoidable `android/`
manifest/gradle edits in a README so they're reproducible.

## Build split (audit F-D) — what the SONNET build delivers
**Commit 1 (the premise — this is the Sonnet deliverable):** gates 1→2→3 proven end-to-end, with the
hard stop-and-report valves. A worker **triggered on-demand by adb** (like the Phase-0 spike — NOT the
15-min periodic) that: proves shared localStorage (gate 1, app cold), boots fellowship to the admitted
relay set (gate 2), does NIP-42 auth + a `since=` count (gate 3), and posts a generic **native**
notification when count>0. Log each gate's result. **STOP here and hand back** — do not build the
periodic/boot/battery machinery until the premise is proven.
**Commit 2 (scaffolding, only after commit 1 proves out):** the periodic `WorkManager` schedule (~15
min), `RECEIVE_BOOT_COMPLETED` reschedule, runtime `POST_NOTIFICATIONS`, and battery-optimisation
exemption prompt. This is what makes it *testable over hours* on the Oppo (the Doze acceptance gate).

## Build / test / rules
- Build an **in-app debug build inside `com.trinityone.app`** (needs the app's UID for real key +
  shared data). It's debug-signed on this box, so `adb install -r` is data-preserving — do NOT wipe the
  owner's identity. Install on the Oppo (`J77HDMTC7TKBZDFM`).
- **Audit F-B — make this the FIRST on-device task:** Phase 0 did NOT prove reading the REAL key (the
  spike ran under its own UID). On the first in-app run, confirm the native read of
  `capacitor-storage_trinityone.nostr.mnemonic` returns the real mnemonic and derives the member's known
  pubkey. If it doesn't, stop — nothing downstream works.
- After commit 1: verify on-demand that it boots, gets the real relay set, auths, counts, and notifies
  (logcat evidence). After commit 2: **leave it installed** for the owner's multi-hour test — does the
  Oppo keep firing the ~15-min periodic under Doze (the real acceptance gate)? Tell the owner how to
  restore their clean build.
- Do NOT touch admission code beyond CALLING existing helpers; never widen the relay set (rule 10).
  No merge, no push. Commit to the notifications branch; list every file incl. gitignored `android/`
  edits and the shared-code user-list (CLAUDE.md rule 2). Don't run the full suite.

## Risks specific to Option B
1. **Same-process localStorage sharing** (gate 1) — the make-or-break assumption; prove before building
   the rest.
2. **Booting fellowship.src.js without app.jsx/React** (gate 2) — the known hard part; stop-and-report
   if intractable.
3. **NIP-42 auth in a headless worker** — new scope; must sign correctly with the derived key.
4. **Running the live admission/proof machinery in the background** — battery/CPU if the cache is cold
   and it re-proves; acceptable if warm-shared, watch it.
5. **Oppo/ColorOS Doze scheduling** — still the ultimate acceptance gate (owner's multi-hour test).

---

# Scope (owner, 2026-11-23) — deliverables + the lock-screen boundary

**Lock-screen / widget safeguarding boundary (RECORD — do not erode):** any surface visible WITHOUT
the PIN (home-screen widget, lock-screen notification) carries **public content or a bare count ONLY** —
**never** message text, **sender/member names** (names are sealed precisely so they're not exposed),
DMs, or any safeguarding-sensitive data (child status, guardian links, care needs, blocked lists).
Gated/member content is shown only inside the app, behind the PIN. A notification says "new messages",
never who or what; the widget shows a number, never a preview.

**Three deliverables (in dependency order):**
1. **Notify reader (core, already-audited — build FIRST).** Gates 1→3; key from the "stay open" record
   (or plaintext for no-PIN). Posts a content-free native notification for **new direct messages (kind 4)
   and new group-chat activity (kind 1)** since last-seen. No names, no content.
2. **Member opt-in / opt-out.** A member setting to turn these notifications on/off (default off until the
   member opts in). Because notify needs the key, **turning notifications ON prompts the member to enable
   "Stay open on this phone for 30 days"** (reusing that feature's existing honest copy) if they have a PIN
   and aren't already remembered. The reader runs only when: opted-in AND (remember-me active OR no PIN).
   Opting out stops the reader and clears the widget count.
3. **Widget "new messages" count.** A bare number on the existing home-screen widget ("N new messages"),
   written by the reader/app, cleared on lock / "forget device" / remember-expiry (same lifecycle as the
   widget's existing church settings, `rememberClear()` → `widgetForgetChurch()`). **Count only — boundary
   above.**

**Sequencing:** build + prove deliverable 1 (the hard part) FIRST; deliverables 2 & 3 are additive UI/
widget work layered on a working reader and get their own plan review before building. For proving
deliverable 1 on-device, the opt-in can be hardcoded on.
