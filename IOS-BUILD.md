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
- **Min iOS:** 13.0 (Capacitor 6 default, set in `ios/App/Podfile`)

---

## What is already done (committed to the repo)

- `@capacitor/ios@^6.2.1` added to `package.json` (matches the Capacitor 6.2.1 line
  used by `@capacitor/core` / `@capacitor/android` / `@capacitor/cli`).
- `ios/` scaffolded with `npx cap add ios`:
  - `ios/App/App.xcworkspace` + `App.xcodeproj` (open the **workspace**, not the project).
  - `ios/App/Podfile` already lists all 5 Capacitor plugins (see below).
  - `ios/App/App/Info.plist` with the iOS usage strings the app needs.
  - Web assets copied into `ios/App/App/public` via `npx cap sync ios`.
- `Info.plist` usage strings added:
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
#    On a Mac this ALSO runs `pod install` automatically. If it does not, run it
#    manually:
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
```

`sync:web` already calls `npx cap sync android` at the end when `android/` exists;
the iOS equivalent (`npx cap sync ios`) is intentionally a separate manual step so
the Linux box (which has no CocoaPods) doesn't fail the script. Run it on the Mac.

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
