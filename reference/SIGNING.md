# App signing — stable release key

TrinityOne's Android APKs are signed with a **stable release key** so every update installs
cleanly over the last. (Debug-signed builds change key across machines/regenerations, which causes
"App not installed" on update.)

- **Keystore:** `android/app/release.keystore` + `android/app/keystore.properties` — **gitignored, SECRET**.
- **Alias:** `trinityone` · RSA 2048 · 10000-day validity.
- **Release SHA-256 cert fingerprint** (public — publish this for the trust/verify story):
  `9A:51:21:F0:9D:60:6B:83:E7:0F:19:22:06:CD:C6:17:05:2A:49:41:79:97:B8:24:C6:BB:97:97:AD:8C:A6:00`
- **Build:** `scripts/release.sh` runs `gradlew assembleRelease`, signed via `keystore.properties`.
  Without the keystore (e.g. a fresh clone) the release build is UNSIGNED.

## ⚠️ Back this up
Copy `android/app/release.keystore` + `android/app/keystore.properties` somewhere safe off this box.
**If they're lost, no future update can install over an installed app** — every member would have to
uninstall + reinstall, and there is no recovery. This key IS the app's identity from now on.

## One-time transition
Switching debug → release signing changes the key once, so anyone on a debug-signed build needs a
single uninstall + clean install of the first release-signed build. After that, updates are seamless.
