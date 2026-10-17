# TrinityOne — iOS build guide

TrinityOne ships to iPhone/iPad via **Capacitor 6**, the same native shell used for
Android. The web app in `www/` is wrapped in a WKWebView.

## Easiest path: build on GitHub Actions (no Mac needed)

`.github/workflows/ios.yml` builds the iOS app on a hosted **macOS** runner. Go to the repo's
**Actions** tab → **iOS build** → **Run workflow**.

- **Unsigned (default):** compiles + archives the app and uploads the `.xcarchive` artifact. Proves the
  iOS build is healthy; **not** installable on a device.
- **Signed IPA (TestFlight-ready):** tick **signed** when running, after adding these repo secrets
  (Settings → Secrets and variables → Actions):
  | Secret | What it is |
  |---|---|
  | `IOS_DIST_CERT_P12_BASE64` | your Apple **distribution** cert exported as `.p12`, base64-encoded (`base64 -i cert.p12`) |
  | `IOS_DIST_CERT_PASSWORD` | the password on that `.p12` |
  | `IOS_PROVISION_PROFILE_BASE64` | your App Store `.mobileprovision`, base64-encoded |
  | `IOS_TEAM_ID` | your 10-character Apple Team ID |
  | `IOS_KEYCHAIN_PASSWORD` | any throwaway string (locks the runner's temp keychain) |

  The cert + profile come from an **Apple Developer Program** membership ($99/yr) — that part needs an
  Apple account, but still **no Mac**. The IPA artifact can then go to TestFlight (Transporter, or add an
  `xcrun altool`/`notarytool` upload step to the workflow).

App icons + splash are generated in CI by `@capacitor/assets` from `assets/icon-only.png` +
`assets/splash.png` (committed; regenerate from `icons/icon-512.png`).

## Doing it locally instead (requires a Mac)

The iOS project is gitignored and regenerated with `npx cap add ios`. The steps below need Apple tooling
(CocoaPods, Xcode, signing, archiving) and **must be run on a Mac** — they cannot be done on Linux.

The bundle identifier and app name already match Android:

- **App ID / bundle id:** `com.trinityone.app`
- **App name / display name:** `TrinityOne`
- **webDir:** `www` (shared with Android; defined in `capacitor.config.json`)
- **Min iOS:** 15.0 (raised from the Capacitor 6 default of 13.0 by `scripts/ios-fixup.sh`
  — Xcode 26+ refuses deployment targets below 15.0; see **Xcode 26+ compatibility** below)

---

## What is already done (committed to the repo)

- `@capacitor/ios@^6.2.1` added to `package.json` (matches the Capacitor 6.2.1 line
  used by `@capacitor/core` / `@capacitor/android` / `@capacitor/cli`).
- `ios/` scaffolded with `npx cap add ios`:
  - `ios/App/App.xcworkspace` + `App.xcodeproj` (open the **workspace**, not the project).
  - `ios/App/Podfile` already lists all 5 Capacitor plugins (see below).
  - `ios/App/App/Info.plist` with the iOS usage strings the app needs.
  - Web assets copied into `ios/App/App/public` via `npx cap sync ios`.
- `Info.plist` usage strings + the Xcode 26+ fixes are applied by
  **`scripts/ios-fixup.sh`** (run after `cap add/sync ios` — see **Xcode 26+
  compatibility** below). `ios/` is gitignored and regenerated, so these are NOT
  committed; the script re-creates them every time. The usage strings it adds:
  - `NSCameraUsageDescription` — in-app QR scanning to join a church
    (`getUserMedia` + `BarcodeDetector`), mirroring the Android `CAMERA` permission.
  - `NSPhotoLibraryAddUsageDescription` — saving an encrypted backup file through
    the OS share sheet may write to Photos/Files.

## What is blocked on a Mac (cannot run on Linux)

- `pod install` — CocoaPods is not installed on the Linux box, so `npx cap add ios`
  and `npx cap sync ios` print `Skipping pod install because CocoaPods is not installed`.
  This is expected; the `Podfile` is correct and ready.
- `xcodebuild` / archiving / running a simulator — Xcode is macOS-only.
- Code signing (Development Team, provisioning profiles) — done in Xcode on a Mac.

---

## Prerequisites (Mac)

- macOS with **Xcode** (latest stable; install from the App Store, then launch once
  to install the command line components).
- Xcode command line tools: `xcode-select --install`
- **CocoaPods**:
  ```sh
  sudo gem install cocoapods
  # Apple-silicon Macs, if you hit ffi/arch errors:
  #   sudo arch -x86_64 gem install ffi && arch -x86_64 pod install
  ```
- **Node.js** (same major version used for the Android build) + npm.
- An Apple Developer account (free account works for device testing; a paid
  membership is required for TestFlight / App Store).

---

## Full build sequence (Mac)

From the repo root:

```sh
# 1. Install JS deps (brings in @capacitor/ios and the 5 plugins).
npm install

# 2. Build the web app into www/ (this is the SAME step the Android build uses).
#    sync-web.sh transpiles the .jsx -> .js and populates www/.
npm run sync:web

# 3. Copy www/ into the iOS project and refresh the native plugin list.
npx cap sync ios

# 3b. Re-apply the fixes the default Capacitor 6 scaffold is missing for Xcode 26+
#     (deployment target -> 15.0, UIScene lifecycle / SceneDelegate, Info.plist
#     usage strings). ios/ is gitignored and regenerated, so this MUST run after
#     every `cap add ios` / `cap sync ios`. It is idempotent.
npm run fixup:ios                 # == bash scripts/ios-fixup.sh

# 3c. Install pods. `cap add` already ran pod install once, but step 3b changed the
#     Podfile (deployment target), so run it again to pick that up.
cd ios/App && pod install && cd ../..

# 4. Open the workspace in Xcode (NOT the .xcodeproj).
npx cap open ios
#    or:  open ios/App/App.xcworkspace
```

### In Xcode

1. Select the **App** target → **Signing & Capabilities**.
2. Check **Automatically manage signing**, pick your **Team**. Xcode provisions
   `com.trinityone.app`. (To use a different bundle id, change **Bundle Identifier**
   here AND keep `appId` in `capacitor.config.json` in sync, then re-run
   `npx cap sync ios`.)
3. Pick a run destination (a connected iPhone, or a simulator) and press **Run** to
   smoke-test.
4. To ship: **Product → Archive** → **Distribute App** → **App Store Connect** →
   upload to **TestFlight**.

---

## Re-syncing after web changes

Any time the web app changes, rebuild `www/` and re-sync:

```sh
npm run sync:web      # rebuild www/
npx cap sync ios      # copy into ios/ (+ pod install if plugins changed)
npm run fixup:ios     # re-apply the Xcode 26+ fixes (cap sync can rewrite the Podfile)
cd ios/App && pod install && cd ../..
```

`sync:web` already calls `npx cap sync android` at the end when `android/` exists;
the iOS equivalent (`npx cap sync ios`) is intentionally a separate manual step so
the Linux box (which has no CocoaPods) doesn't fail the script. Run it on the Mac.

---

## Xcode 26+ compatibility (`scripts/ios-fixup.sh`)

`npx cap add ios` scaffolds a **Capacitor 6** iOS project that does **not** build or
run on **Xcode 26 / 27** (iOS 26+ SDK) as-is. Because `ios/` is gitignored and
regenerated on every machine and in CI, the fixes can't just be committed once —
they're re-applied by `scripts/ios-fixup.sh`, which is **idempotent** and wired into
`.github/workflows/ios.yml` (it runs between `cap sync ios` and `pod install` in both
the archive job and the simulator-smoke job). Run it locally the same way.

It applies three fixes, each a hard failure of the default scaffold:

1. **Deployment target 13.0 → 15.0.** Xcode 26+ refuses to build for a deployment
   target below 15.0 (`BUILD FAILED … supported deployment target versions is 15.0
   to …`). The script bumps the app target in `project.pbxproj`, the `platform :ios`
   line in the `Podfile`, and adds a `post_install` hook that forces every **pod**
   target to 15.0 (CocoaPods otherwise leaves each pod at its own lower podspec min).

2. **UIScene lifecycle adoption.** The iOS 26+ SDK **hard-crashes on launch** any app
   that hasn't adopted the scene lifecycle — `EXC_BREAKPOINT` in
   `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. Capacitor 6 ships
   no `SceneDelegate`. The script adds a `UIApplicationSceneManifest` to `Info.plist`
   pointing at `$(PRODUCT_MODULE_NAME).SceneDelegate`, and appends a `SceneDelegate`
   (plus the `configurationForConnecting` hook) to `AppDelegate.swift` whose scene
   root view controller is the Capacitor bridge (`CAPBridgeViewController`). This is
   exactly what Capacitor 7 generates. NOTE: a *storyboard-only* or empty scene
   manifest is not enough — it launches but the WKWebView never starts (black screen).

3. **Info.plist usage strings** — `NSCameraUsageDescription` and
   `NSPhotoLibraryAddUsageDescription` (see above).

**When TrinityOne upgrades to Capacitor 7+:** fixes 1 and 2 are expected to be built
into the scaffold. Re-check, and trim `scripts/ios-fixup.sh` down to just the usage
strings (or delete it and add the strings another way).

---

## Plugins — iOS notes

All 5 plugins are in the `Podfile` and resolved by `pod install`:

| Plugin | iOS behavior / requirements |
|---|---|
| `@aparajita/capacitor-secure-storage` (5.2.0) | Backs onto the **iOS Keychain**. No Info.plist usage string needed. Keychain items are app-private and survive reinstalls only if backed up; nothing to configure. |
| `@capacitor/local-notifications` (6.1.3) | iOS **prompts for notification permission at runtime** (the first time the app schedules/requests it) — no Info.plist string required. For *push* (remote) notifications you'd add the **Push Notifications** capability + an APNs key; TrinityOne uses **local** notifications only, so that is not needed. |
| `@capacitor/filesystem` (6.0.4) | Reads/writes inside the app sandbox (Documents/Library) — no usage string for sandbox access. If you later expose files to the system **Files** app, add `UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace` to Info.plist. |
| `@capacitor/share` (6.0.4) | Uses the native share sheet (`UIActivityViewController`). Saving a shared file to Photos triggers `NSPhotoLibraryAddUsageDescription` (already added). |
| `@capacitor/app` (6.0.3) | App lifecycle / URL open events. No special Info.plist entry. |

The web app also uses the camera for QR scanning, so `NSCameraUsageDescription` is in
Info.plist (mirrors the Android `CAMERA` permission, which is optional/`required=false`).

---

## App icon & splash screen

`npx cap add ios` generated **placeholder** Capacitor assets in
`ios/App/App/Assets.xcassets/` (`AppIcon.appiconset`, `Splash.imageset`). Replace
them with the TrinityOne artwork before shipping. The repo already has source
artwork under `icons/` (e.g. `icon-512.png`, `apple-touch-icon.png`).

Recommended: use the Capacitor asset generator from a single 1024×1024 source:

```sh
npm install -D @capacitor/assets
# put a 1024x1024 icon at  assets/icon.png  (and optional assets/splash.png)
npx @capacitor/assets generate --ios
```

This regenerates the full iOS `AppIcon` set and splash images. Alternatively, drop a
1024×1024 PNG into the **AppIcon** asset catalog in Xcode by hand. After regenerating,
re-run `npx cap sync ios`.

---

## Troubleshooting

- **`pod install` arch errors on Apple silicon:** see the `ffi` note in
  Prerequisites, or run `arch -x86_64 pod install`.
- **Blank white screen on launch:** confirm `www/` was built (`npm run sync:web`)
  and copied (`npx cap sync ios`); check that `ios/App/App/public/index.html` exists.
  Note `sw.js` (the service worker) is intentionally **not** registered under
  Capacitor, same as Android.
- **Signing errors:** make sure a Team is selected and the bundle id is unique to
  your account (or use your own reverse-domain id, keeping `capacitor.config.json`
  in sync).
- **Plugin not found at runtime:** re-run `npx cap sync ios` then
  `pod install` so the native side is regenerated.
