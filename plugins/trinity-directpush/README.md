# trinity-directpush (Direct Mode background notify) — Deliverable 1

Plan: docs/direct-mode-push-plan.md (Phase 1 Option B). A plain library compiled INTO com.trinityone.app
(not a Capacitor plugin). Native Kotlin/Swift + a background WebView at the app's own origin.

## Build
    node plugins/trinity-directpush/build-bg.mjs --debug  # DEBUG bundle (adb test switches + verbose reporting) for the in-app debug build. WITHOUT --debug the bundle is release-inert: switches/reporting are compiled out (gitignored, generated)
    cd android && JAVA_HOME=/mnt/storage/android-tools/jdk ANDROID_HOME=/mnt/storage/android-tools/sdk ./gradlew :app:assembleDebug   # needs network; --offline fails (kotlin 2.3.0)

## Gitignored android/ edits (main app) — reproduce by hand on a fresh checkout
- android/settings.gradle:   include ':trinity-directpush'; project(':trinity-directpush').projectDir = new File('../plugins/trinity-directpush/android')
- android/app/build.gradle:  implementation project(':trinity-directpush')   (in dependencies)
- android/app/src/main/java/com/trinityone/app/MainActivity.java: `import church.trinityone.directpush.DirectPushLifecycle;` and, after the setWebContentsDebuggingEnabled line in onCreate, `DirectPushLifecycle.INSTANCE.onLaunch(this);` (Commit 2: schedules the 15-min periodic work, asks POST_NOTIFICATIONS on API 33+, asks the battery exemption on DEBUG builds only)
- android/app/src/debug/AndroidManifest.xml (new): declares REQUEST_IGNORE_BATTERY_OPTIMIZATIONS for the DEBUG variant ONLY (Play restricts it; release must not carry it)
Nothing else; the module's own AndroidManifest merges in (POST_NOTIFICATIONS + a non-exported debug receiver).

## On-demand trigger (debug build only)
    adb shell am force-stop com.trinityone.app
    adb shell run-as com.trinityone.app am broadcast --user 0 -f 0x20 -n com.trinityone.app/church.trinityone.directpush.DirectPushDebugReceiver
Optional: `--el sinceOverride <epoch>` and `--es debug "'{\"noP\":true,\"kinds\":[10002]}'"` (test switches, see bg-entry.js).
`DIRECTPUSH` is the logcat tag.

## Key source (native): remember-me record if until>now, else plaintext mnemonic, else quiet no-op. Never decrypts `.enc`.

## Lifecycle (Commit 2)
`DirectPushLifecycle.onLaunch` (from MainActivity.onCreate): `enqueueUniquePeriodicWork("directpush-periodic", KEEP, 15 min)`. 15 min is the
WorkManager floor. WorkManager persists periodic work across reboot itself, so there is NO boot receiver. Opt-in is hardcoded ON until Deliverable 2.
NOTE: `cmd jobscheduler run -f` on the periodic job does NOT run the worker (WorkManager defers early periodic runs); use the debug trigger above to force one.

### ColorOS manual steps (the standard exemption does not cover ColorOS killers) — Oppo, Android 12
1. Settings > Battery > (More battery settings / App battery management) > TrinityOne > allow "Allow background activity" / "Allow auto-launch", and turn OFF "Optimise"/"Smart control".
2. Settings > Apps > App management > TrinityOne > Battery usage (or Energy saver) > "Allow background activity" ON, "Allow auto launch" ON.
3. Settings > Apps > Auto launch (or Startup manager) > TrinityOne ON.
4. Recents: open TrinityOne, open the recents screen, long-press / tap the app-card menu and choose Lock (padlock) so "clear all" does not kill it.
5. Do not swipe-force-stop it; Force stop cancels background work until the app is opened again.
6. Accept the "Allow ... run in the background" prompt on first launch of the debug build.
Menu names vary by ColorOS version.

## Phase 2 counting rules (what is counted)
Group chat: only rooms THIS member could open, via the app's own cached directory (`trinityone.groups.<church npub>`) re-filtered with the screens-chat.jsx rule: invite-only rooms only if my pubkey is listed; a young person (Fellowship.assumeMinor, fail-closed TRUE) only `childsafe` rooms. No cache => DM-only, never the full directory.
Blocked senders: the church-signed blocklist (kind 30078, `d=trinityone/blocked:<cp>`) is read on the same authed REQ and any event authored by a listed key is dropped (DMs and group chat). No doc = nobody blocked; unparseable doc = count nothing. Counts only; no names/content/group names leave the reader.

---

## iOS Background Refresh

Same reader as Android (bg-entry.js, bg-bundle.js), different scheduler: iOS's BGAppRefreshTask
(ML-predicted, usage-dependent) instead of Android's WorkManager (15-min periodic).

### Architecture

- `ios/KeychainReader.swift` — Read-only Keychain reader. Mirrors Android's SecretStoreCompat.kt. Uses raw Security framework (no KeychainSwift dependency). Priority: bg-copy (AfterFirstUnlock) → remember-me record → plaintext mnemonic → nil.
- `ios/CapSchemeHandler.swift` — `WKURLSchemeHandler` for the `capacitor` scheme, serving assets from the app bundle for the background WKWebView. Same two-prefix dispatch as Android.
- `ios/BackgroundReader.swift` — The core runner. Creates WKWebView at `capacitor://localhost` (the app's own origin, sharing localStorage), injects DPNative bridge shim, loads bg.html, injects mnemonic, waits for summary (25s hard timeout), posts notification on count > 0.
- `ios/BackgroundRefreshScheduler.swift` — Registers BGAppRefreshTask, schedules on didEnterBackground, re-schedules after each run.

### Gitignored ios/ edits (main app) — reproduce by hand on a fresh checkout

See `ios/AppDelegate.swift.reference` for the full modified AppDelegate. Changes:

1. `import BackgroundTasks` and `import UserNotifications`
2. `BackgroundRefreshScheduler.register()` in `didFinishLaunchingWithOptions` (BEFORE return)
3. `UNUserNotificationCenter.current().delegate = self` in `didFinishLaunchingWithOptions`
4. `BackgroundRefreshScheduler.scheduleIfOptedIn()` in `applicationDidEnterBackground`
5. `UNUserNotificationCenterDelegate` extension for notification tap → messages routing

See `ios/Info.plist.additions` for the plist entries:
- `BGTaskSchedulerPermittedIdentifiers`: `["church.trinityone.app.bgrefresh"]`
- `UIBackgroundModes`: `["fetch"]`

### Xcode build phase (Mac session)

1. Add Background Modes capability (background fetch) in the Xcode project settings
2. Copy `ios/assets/directpush/` into the app bundle (Add Files to Xcode project, or a Copy Bundle Resources build phase). The bundle must contain `directpush/bg.html` and `directpush/bg-bundle.js`.
3. Copy the four Swift files from `plugins/trinity-directpush/ios/` into the Xcode project (KeychainReader.swift, CapSchemeHandler.swift, BackgroundReader.swift, BackgroundRefreshScheduler.swift). They have no external dependencies beyond Foundation/WebKit/BackgroundTasks/UserNotifications.
4. KeychainSwift is NOT needed: KeychainReader uses raw Security framework (SecItemCopyMatching).
5. Apply the AppDelegate changes from `ios/AppDelegate.swift.reference`.
6. Apply the Info.plist additions from `ios/Info.plist.additions`.
7. NO push notification entitlement needed (local notifications only).

### On-demand trigger (Xcode debugger)

Pause the app in the Xcode debugger after backgrounding it, then:

    e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"church.trinityone.app.bgrefresh"]

`DIRECTPUSH` is the os_log subsystem (NSLog).

### Key source (native)

Same priority as Android: bg-copy (AfterFirstUnlock, written by opt-in toggle) → remember-me record (if until > now) → plaintext mnemonic → quiet no-op. Never decrypts `.enc`.

### Gate 0 concern: Keychain accessibility

The plugin (`@aparajita/capacitor-secure-storage`) stores keys with `kSecAttrAccessibleWhenUnlocked` by default. A BGAppRefreshTask that runs while the screen is locked will get `errSecInteractionNotAllowed` and cannot read the mnemonic. **This is a known blocker for the plugin's own entries.**

**Mitigation built in:** `KeychainReader` looks first for a background-accessible copy (`trinityone.directpush.bgmnemonic`) stored with `kSecAttrAccessibleAfterFirstUnlock`. The app's opt-in toggle must call `KeychainReader.writeBgMnemonic()` when the user enables Direct Mode, and `deleteBgMnemonic()` on opt-out/lock/forget/church-switch. This entry survives screen lock (readable after first unlock since boot).

### Timing budget

25s hard timeout (Apple gives BGAppRefreshTask ~30s; Android gets 70s from WorkManager's 10-min budget). The expirationHandler harvests whatever summary exists and cleans up. A run killed mid-flight is NOT a failure — the count may be stale or zero, and the notification uses whatever count was collected.

### Content-free boundary

Same as Android: "You have N new messages". Never includes sender names, message text, group names, or church names. The notification's userInfo carries `["push": "msgs"]` for tap routing only.

---

## Deliverable 3: widget "N new messages" count
The page's summary carries `widget: {op: set|clear|keep}` (bg-entry.js `widgetCountAction`); `DirectPushWorker.applyWidgetCount` applies it by writing ONE int (`dm.count`) + a timestamp (`dm.at`) into the widget's own prefs file `trinityone.widget` (same app/UID; names mirror native/trinity-widget WidgetStore.K_DM_*) and sending an explicit APPWIDGET_UPDATE to the (non-exported) provider. Set only on a real count > 0; clear on a real zero, opted out, identity mismatch, no church, or no usable key (locked / forgotten / remember expired); keep when the run could not tell. The widget hides a count older than 6 h or stamped in the future. App side: opt-out and `widgetClearChurch()` (lock, forget device, remember expiry, church switch) call `TrinityWidget.clearMessageCount()`. No gitignored android/ edit was needed for this deliverable.
