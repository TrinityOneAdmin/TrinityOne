# trinity-directpush (Direct Mode background notify) — Deliverable 1

Plan: docs/direct-mode-push-plan.md (Phase 1 Option B). A plain Android library compiled INTO com.trinityone.app
(not a Capacitor plugin). Native Kotlin + a background WebView at https://localhost.

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
