# trinity-directpush (Direct Mode background notify) — Deliverable 1

Plan: docs/direct-mode-push-plan.md (Phase 1 Option B). A plain Android library compiled INTO com.trinityone.app
(not a Capacitor plugin). Native Kotlin + a background WebView at https://localhost.

## Build
    node plugins/trinity-directpush/build-bg.mjs          # bundles js/bg-entry.js + src/fellowship.src.js -> assets/directpush/bg-bundle.js (gitignored, generated)
    cd android && JAVA_HOME=/mnt/storage/android-tools/jdk ANDROID_HOME=/mnt/storage/android-tools/sdk ./gradlew :app:assembleDebug   # needs network; --offline fails (kotlin 2.3.0)

## Gitignored android/ edits (main app) — reproduce by hand on a fresh checkout
- android/settings.gradle:   include ':trinity-directpush'; project(':trinity-directpush').projectDir = new File('../plugins/trinity-directpush/android')
- android/app/build.gradle:  implementation project(':trinity-directpush')   (in dependencies)
Nothing else; the module's own AndroidManifest merges in (POST_NOTIFICATIONS + a non-exported debug receiver).

## On-demand trigger (debug build only)
    adb shell am force-stop com.trinityone.app
    adb shell run-as com.trinityone.app am broadcast --user 0 -f 0x20 -n com.trinityone.app/church.trinityone.directpush.DirectPushDebugReceiver
Optional: `--el sinceOverride <epoch>` and `--es debug "'{\"noP\":true,\"kinds\":[10002]}'"` (test switches, see bg-entry.js).
`DIRECTPUSH` is the logcat tag.

## Key source (native): remember-me record if until>now, else plaintext mnemonic, else quiet no-op. Never decrypts `.enc`.
