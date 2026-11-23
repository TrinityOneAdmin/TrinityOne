# push0 — Direct Mode push, Phase-0 spike (THROWAWAY)

Proof-of-concept only. Answers the gating unknowns in `docs/direct-mode-push-plan.md` → "Phase 0",
then STOP. **Not shipped. Delete after the plan decision.** Member-app concern only.

This is a **self-contained standalone Android app** with its OWN applicationId
`com.trinityone.push0spike`, so it installs **alongside** the owner's `com.trinityone.app` (its own
UID sandbox) and uninstalls clean. It deliberately does NOT touch the real app. All Kotlin lives
here under a tracked path (not inside the gitignored `android/` tree).

## What each probe proves (and its limit)

- **P0.1** `PushSpikeWorker` (a WorkManager `CoroutineWorker`) fires and builds a headless `WebView`
  on the **main Looper** thread, keeping the worker suspended on a `CompletableDeferred` while the
  async socket work runs.
- **P0.2** The WebView loads `assets/spike.html` + `assets/spike-bundle.js` (an esbuild bundle of the
  **real** `nostr-tools` `SimplePool`, same `^2.23.5` the member app ships) and runs ONE `since=` REQ
  against a real, already-admitted church relay (`wss://app.trinityone.church/relay`), reading to
  EOSE. The relay is the production relay the member app already talks to — no admission code touched,
  no relay set widened (rule 10). Phase 1 must instead obtain the relay from the app's existing
  `relaysForChurch()` / relay helpers; this spike passes it as input only to prove the socket path.
- **P0.3** `SecretStoreCompat` is a byte-for-byte replica of `@aparajita/capacitor-secure-storage`'s
  Android scheme (SharedPreferences file `WSSecureStorageSharedPreferences`; value
  `base64(AES/GCM ct) + '\u0010' + base64(iv)`; AES key in `AndroidKeyStore` under alias == prefixed
  key). The worker writes a throwaway secret, reads it back **natively** (no JS bridge), and injects
  it into the WebView. **Limit:** running under its own UID, the spike cannot read the owner's REAL
  entry — a different UID's Keystore/prefs are sealed by Android. That cross-read is NOT an unknown:
  same-UID access is an OS guarantee, so the identical `readSecret()` works once it ships INSIDE
  `com.trinityone.app`, pointed at the real prefixed alias
  (`<plugin-prefix>` + `trinityone.nostr.mnemonic.enc`, see `src/identity.src.js` ENC_KEY).
- **P0.4** The worker posts a **local notification** via native `NotificationManagerCompat`. The JS
  boot report also records whether a `window.Capacitor` bridge exists at all (F2).

## Build / run / clean (reproducible)

```bash
# from repo root
source scripts/android-env.sh                 # JDK 17 + SDK on /mnt/storage

# 1. (re)build the JS bundle if spike-src.js changed:
node_modules/.bin/esbuild spikes/push0/js/spike-src.js --bundle --format=iife \
  --platform=browser --target=chrome90 \
  --outfile=spikes/push0/app/src/main/assets/spike-bundle.js

# 2. build the APK:
cd spikes/push0 && ./gradlew :app:assembleDebug --no-daemon

# 3. install ALONGSIDE the real app, run, watch:
adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk
adb -s <serial> shell input keyevent KEYCODE_WAKEUP
adb -s <serial> logcat -c
adb -s <serial> shell am start -n com.trinityone.push0spike/.MainActivity   # enqueues the worker
#   (or re-fire: tap "Run spike worker", or: adb shell cmd jobscheduler run -f com.trinityone.push0spike <id>)
adb -s <serial> logcat -d -s PUSH0

# 4. leave the device clean:
adb -s <serial> uninstall com.trinityone.push0spike
```

## Machine-local / gitignored

- `local.properties` (`sdk.dir=`) is generated per machine and gitignored.
- No edits were made to the gitignored `android/` tree, `AndroidManifest.xml`, or any relay/admission
  code. This spike is entirely inside `spikes/push0/`.
- `android:exported="false"`: the spike declares no custom Service/Receiver. If Phase 1 adds a boot
  receiver it MUST be `android:exported="false"`.
