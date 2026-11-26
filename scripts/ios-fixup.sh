#!/usr/bin/env bash
# Re-apply the iOS project fixes that `npx cap add ios` does NOT produce but that
# the current Xcode / iOS SDK require. `ios/` is gitignored and regenerated on
# every machine and in CI, so run this AFTER `npx cap add ios` (and after any
# `npx cap sync ios`, which can rewrite the Podfile) and BEFORE `pod install`.
#
# It is idempotent — safe to run repeatedly.
#
# Fixes (each is here because the default Capacitor 6 scaffold fails on Xcode 26+):
#   1. Deployment target 13.0 -> 15.0. Xcode 26+ refuses to build for anything
#      below iOS 15.0 ("supported deployment target versions is 15.0 to ...").
#   2. UIScene lifecycle adoption. The iOS 26+ SDK HARD-CRASHES on launch any app
#      that has not adopted the scene lifecycle (EXC_BREAKPOINT in
#      _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption). Capacitor 6
#      ships no SceneDelegate, so we add one that hosts the Capacitor bridge —
#      exactly what Capacitor 7 generates out of the box.
#   3. The Info.plist keys the app needs that `cap add` won't create — the two usage
#      strings (camera QR join, Photos backup export) and UIBackgroundModes=["audio"] so
#      audio Bibles / sermons keep playing when the screen is locked (the web view drives
#      its own Now Playing / lock-screen controls, so no native code is needed). Documented
#      in docs/ops/IOS-BUILD.md.
#   4. ITSAppUsesNonExemptEncryption = NO in Info.plist. The app uses only standard,
#      exempt encryption (HTTPS/TLS, AES-GCM, the NIP-44 chat crypto) — no non-exempt
#      encryption — so declaring it here makes every build answer App Store Connect's
#      export-compliance question itself, instead of TestFlight asking (and blocking the
#      build as "Missing Compliance") on every single upload. Matches the answer set on
#      the first published builds (usesNonExemptEncryption=false).
#   5. The BackupExclude local (in-app) Capacitor plugin + its bridge-VC registration.
#      ios/ is gitignored and fully regenerated, and the Capacitor 6 scaffold's
#      project.pbxproj is the old format (objectVersion = 48, explicit file refs — NOT
#      a synchronized file group), so a standalone .swift dropped into App/App/ would
#      never be compiled. We therefore append the plugin to AppDelegate.swift — the one
#      file already in the Sources build phase — exactly as we append the SceneDelegate,
#      and make the plugin's CAPBridgeViewController subclass the window root VC so the
#      instance is registered. See docs/ops/IOS-BUILD.md.
#
# When TrinityOne moves to Capacitor 7+, revisit: 1 and 2 are likely built in, and
# this script should be trimmed to just the usage strings + the BackupExclude plugin.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

APPDIR="$ROOT/ios/App"
PL="$APPDIR/App/Info.plist"
PBX="$APPDIR/App.xcodeproj/project.pbxproj"
PODFILE="$APPDIR/Podfile"
APPDELEGATE="$APPDIR/App/AppDelegate.swift"
PB=/usr/libexec/PlistBuddy
DT=15.0   # minimum iOS deployment target Xcode 26+ accepts

[ -d "$APPDIR" ] || { echo "ios-fixup: ERROR — $APPDIR not found. Run 'npx cap add ios' first." >&2; exit 1; }
command -v "$PB" >/dev/null || { echo "ios-fixup: ERROR — PlistBuddy not found (macOS only)." >&2; exit 1; }
echo "ios-fixup: patching ios/ for Xcode/iOS-SDK requirements (deployment target, UIScene, usage strings)…"

# ── 1. Deployment target -> $DT ──────────────────────────────────────────────
# 1a. App target build settings in the Xcode project.
sed -i '' "s/IPHONEOS_DEPLOYMENT_TARGET = [0-9][0-9.]*;/IPHONEOS_DEPLOYMENT_TARGET = ${DT};/g" "$PBX"
# 1b. Podfile platform line + a post_install override that forces EVERY pod target
#     up to $DT (CocoaPods otherwise leaves each pod at its own lower podspec min).
python3 -I - "$PODFILE" "$DT" <<'PY'
import re, sys
path, dt = sys.argv[1], sys.argv[2]
s = open(path).read()
s = re.sub(r"^platform :ios, .*$", f"platform :ios, '{dt}'", s, count=1, flags=re.M)
marker = "# ios-fixup: force pod deployment target"
if marker not in s:
    block = (
        f"\n  {marker} — Xcode 26+ requires >= {dt}\n"
        "  installer.pods_project.targets.each do |t|\n"
        "    t.build_configurations.each do |c|\n"
        f"      c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '{dt}'\n"
        "    end\n"
        "  end\n"
    )
    # Insert inside the existing post_install block, after assertDeploymentTarget.
    s2 = re.sub(r"(assertDeploymentTarget\(installer\)\n)", r"\1" + block, s, count=1)
    if s2 == s:  # no assertDeploymentTarget line — append a whole post_install block
        s2 = s.rstrip() + "\n\npost_install do |installer|" + block + "end\n"
    s = s2
open(path, "w").write(s)
print(f"  Podfile: platform {dt} + pod-target override set")
PY

# ── 2. Info.plist: usage strings + UIScene manifest (delete-then-add = idempotent) ──
for k in NSCameraUsageDescription NSPhotoLibraryAddUsageDescription ITSAppUsesNonExemptEncryption UIApplicationSceneManifest; do
  "$PB" -c "Delete :$k" "$PL" 2>/dev/null || true
done
"$PB" -c "Add :NSCameraUsageDescription string 'TrinityOne uses the camera to scan a QR code so you can join your church.'" "$PL"
"$PB" -c "Add :NSPhotoLibraryAddUsageDescription string 'TrinityOne saves your encrypted backup file to Photos when you choose to export it.'" "$PL"
# Export-compliance: the app uses only standard, exempt encryption, so declare it here
# and ASC never prompts (TestFlight otherwise flags every build "Missing Compliance").
"$PB" -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PL"
SM=":UIApplicationSceneManifest"
CFG="$SM:UISceneConfigurations:UIWindowSceneSessionRoleApplication:0"
"$PB" -c "Add $SM dict" "$PL"
"$PB" -c "Add $SM:UIApplicationSupportsMultipleScenes bool false" "$PL"
"$PB" -c "Add $SM:UISceneConfigurations dict" "$PL"
"$PB" -c "Add $SM:UISceneConfigurations:UIWindowSceneSessionRoleApplication array" "$PL"
"$PB" -c "Add $CFG dict" "$PL"
"$PB" -c "Add $CFG:UISceneConfigurationName string 'Default Configuration'" "$PL"
"$PB" -c "Add $CFG:UISceneDelegateClassName string '\$(PRODUCT_MODULE_NAME).SceneDelegate'" "$PL"
# Background audio: UIBackgroundModes must contain "audio" so playback continues with the
# screen locked. Merge-safe + idempotent (NOT in the delete-then-add loop above): create the
# array only if absent, and append "audio" only if it is not already an entry — never
# duplicating it and never dropping other background modes.
if ! "$PB" -c "Print :UIBackgroundModes" "$PL" >/dev/null 2>&1; then
  "$PB" -c "Add :UIBackgroundModes array" "$PL"
fi
if "$PB" -c "Print :UIBackgroundModes" "$PL" 2>/dev/null | grep -qE '^[[:space:]]*audio[[:space:]]*$'; then
  echo "  Info.plist: UIBackgroundModes already has audio — skipped"
else
  "$PB" -c "Add :UIBackgroundModes: string audio" "$PL"
  echo "  Info.plist: UIBackgroundModes += audio"
fi
# Remote notifications (APNs push, the "Prompt alerts" tier). Same merge-safe + idempotent pattern as audio.
# This is the Background Modes -> "Remote notifications" capability. For GENERIC contentless push iOS draws the
# alert itself with the app not running, so this mode is only strictly needed once rich/silent push wakes the app;
# it is set now so the capability is in place and harmless. (The aps-environment ENTITLEMENT + the Push capability on
# the App ID are a separate Apple-portal step, applied only once the App ID is provisioned for push — see
# plugins/trinity-directpush/ios/Apns.README.md. Not auto-added here, so a simulator build never fails on signing.)
if "$PB" -c "Print :UIBackgroundModes" "$PL" 2>/dev/null | grep -qE '^[[:space:]]*remote-notification[[:space:]]*$'; then
  echo "  Info.plist: UIBackgroundModes already has remote-notification — skipped"
else
  "$PB" -c "Add :UIBackgroundModes: string remote-notification" "$PL"
  echo "  Info.plist: UIBackgroundModes += remote-notification"
fi
plutil -lint "$PL" >/dev/null
echo "  Info.plist: usage strings + export-compliance + UIScene manifest + background audio + remote-notification set"

# ── 2c. APNs entitlement (aps-environment) for the "Prompt alerts" push tier ──────────────────────
# Push is enabled on the App ID (com.trinityone.app); the app needs the aps-environment entitlement to be
# ISSUED a device token. 'development' = the APNs SANDBOX, which is what a debug/simulator/dev build must use
# (the relay sender routes on the pushtoken doc's env field; see reference/SCOPE-notifications.md §15). A
# Release/App Store/TestFlight build must sign with aps-environment='production' instead — that is a
# CI/signing concern, not this local sim build. Written + wired idempotently so a signed sim build issues a
# REAL sandbox token. (This is the §16-deferred entitlement, unblocked once Push was enabled on the App ID.)
ENT="$APPDIR/App/App.entitlements"
if [ -f "$ENT" ] && grep -q "aps-environment" "$ENT"; then
  echo "  App.entitlements: present with aps-environment — kept"
else
  cat > "$ENT" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>aps-environment</key>
	<string>development</string>
</dict>
</plist>
PLIST
  echo "  App.entitlements: written (aps-environment=development / APNs sandbox)"
fi
"$PB" -c "Print :aps-environment" "$ENT" >/dev/null 2>&1 || { echo "ios-fixup: ERROR — App.entitlements missing aps-environment" >&2; exit 1; }
# Point the App target's build configs (Debug + Release) at the entitlements file. Idempotent: insert after the
# App target's own PRODUCT_BUNDLE_IDENTIFIER (a line unique to the two App configs), only if not already set.
if grep -q "CODE_SIGN_ENTITLEMENTS = App/App.entitlements;" "$PBX"; then
  echo "  project.pbxproj: CODE_SIGN_ENTITLEMENTS already set — skipped"
else
  python3 -I - "$PBX" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
anchor = "PRODUCT_BUNDLE_IDENTIFIER = com.trinityone.app;"
n = s.count(anchor)
assert n >= 1, "App target bundle-id anchor not found in pbxproj — re-check ios-fixup after a Capacitor upgrade"
s = s.replace(anchor, anchor + "\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;")
open(p, "w").write(s)
print("  project.pbxproj: CODE_SIGN_ENTITLEMENTS set on %d App config(s)" % n)
PY
fi

# ── 3. AppDelegate.swift: append SceneDelegate + BackupExclude plugin (idempotent) ──
# Both are appended to AppDelegate.swift (already in the Sources build phase) rather
# than dropped in as a new file: the Capacitor 6 scaffold's project.pbxproj is the old
# format (objectVersion 48, explicit file refs), so an un-referenced .swift would never
# compile. The SceneDelegate's root VC is the plugin's CAPBridgeViewController subclass,
# which registers the BackupExclude instance in capacitorDidLoad().
# Three separate idempotent steps, each with its own marker (round-5 R5-4), so an ios/ folder already patched by the
# older script (SceneDelegate present, no plugin, root VC = CAPBridgeViewController()) still gets the plugin and its
# registration instead of the whole append being skipped.
# 3a. the SceneDelegate
if grep -q "class SceneDelegate" "$APPDELEGATE"; then
  echo "  AppDelegate.swift: SceneDelegate already present — skipped"
else
  cat >> "$APPDELEGATE" <<'SWIFT'

// ─── ios-fixup: UIScene lifecycle adoption (required by Xcode 26+ / iOS 26 SDK) ───
// Capacitor 6 ships no SceneDelegate, so the scene-based lifecycle the SDK now
// enforces has nothing to host the WKWebView and the app crashes on launch (or
// shows a black screen). This mirrors Capacitor 7's generated scene support:
// the scene's root view controller is the Capacitor bridge — here the BackupExclude
// subclass so the local plugin is registered (see below).
extension AppDelegate {
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = BackupExcludeBridgeViewController()
        self.window = window
        window.makeKeyAndVisible()
    }
}
SWIFT
  echo "  AppDelegate.swift: SceneDelegate appended"
fi
# 3b. the BackupExclude plugin + its CAPBridgeViewController subclass
if grep -q "class BackupExcludePlugin" "$APPDELEGATE"; then
  echo "  AppDelegate.swift: BackupExclude plugin already present — skipped"
else
  cat >> "$APPDELEGATE" <<'SWIFT'

// ─── ios-fixup: BackupExclude — TrinityOne's first custom iOS Capacitor plugin ───
// Marks a folder under the app's Library directory with
// URLResourceValues.isExcludedFromBackup = true, so large re-downloadable data (whole
// audio Bibles under Library/audio) stays out of iCloud/iTunes backup — App Review
// guideline 2.23. Capacitor's Filesystem plugin cannot set this attribute.
//
// `path` is RELATIVE to the Library directory — the same base Filesystem maps
// Directory.Library to on iOS (FileManager .libraryDirectory in .userDomainMask;
// confirmed against @capacitor/filesystem's getFileUrl/getDirectory).
@objc(BackupExcludePlugin)
public class BackupExcludePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackupExcludePlugin"
    public let jsName = "BackupExclude"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "exclude", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise)
    ]

    /// Library/<relPath>. Mirrors @capacitor/filesystem's Directory.Library base.
    private func libraryURL(for relPath: String) -> URL? {
        guard let base = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else {
            return nil
        }
        return base.appendingPathComponent(relPath)
    }

    /// Allowlist. This plugin exists ONLY to exclude Library/audio from backup. Accepting
    /// arbitrary paths (".", "./", "WebKit", ...) would let a caller mark the whole Library
    /// directory — which holds WebKit storage and the app's keys — as excluded from backup,
    /// so an iCloud restore would lose them. Accept exactly "audio"; reject everything else.
    /// Returns true (and rejects the call) when the path is not allowed.
    private func rejectIfInvalid(_ path: String, _ call: CAPPluginCall) -> Bool {
        if path != "audio" {
            call.reject("path must be exactly \"audio\"")
            return true
        }
        return false
    }

    @objc func exclude(_ call: CAPPluginCall) {
        let path = call.getString("path") ?? ""
        if rejectIfInvalid(path, call) { return }
        guard var url = libraryURL(for: path) else {
            call.reject("could not resolve the Library directory")
            return
        }
        let fm = FileManager.default
        do {
            if !fm.fileExists(atPath: url.path) {
                try fm.createDirectory(at: url, withIntermediateDirectories: true)
            }
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try url.setResourceValues(values)
            call.resolve(["excluded": true, "path": path])
        } catch {
            call.reject("failed to exclude from backup: \(error.localizedDescription)")
        }
    }

    @objc func check(_ call: CAPPluginCall) {
        let path = call.getString("path") ?? ""
        if rejectIfInvalid(path, call) { return }
        guard let url = libraryURL(for: path) else {
            call.reject("could not resolve the Library directory")
            return
        }
        let exists = FileManager.default.fileExists(atPath: url.path)
        var excluded = false
        if exists, let vals = try? url.resourceValues(forKeys: [.isExcludedFromBackupKey]) {
            excluded = vals.isExcludedFromBackup ?? false
        }
        call.resolve(["exists": exists, "excluded": excluded])
    }
}

// Local (in-app) plugin registration, the Capacitor 6 way: subclass the bridge view
// controller and register the instance in capacitorDidLoad(). The SceneDelegate above
// makes this subclass the window root VC. jsName "BackupExclude" ->
// Capacitor.Plugins.BackupExclude in the webview.
public class BackupExcludeBridgeViewController: CAPBridgeViewController {
    override public func capacitorDidLoad() {
        bridge?.registerPluginInstance(BackupExcludePlugin())
    }
}
SWIFT
  echo "  AppDelegate.swift: BackupExclude plugin appended"
fi
# 3c. the scene's root VC must be the subclass (it registers the plugin). An older patch set CAPBridgeViewController().
if grep -q "rootViewController = CAPBridgeViewController()" "$APPDELEGATE"; then
  python3 -I - "$APPDELEGATE" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace("rootViewController = CAPBridgeViewController()", "rootViewController = BackupExcludeBridgeViewController()")
open(p, "w").write(s)
PY
  echo "  AppDelegate.swift: scene root VC -> BackupExcludeBridgeViewController"
else
  echo "  AppDelegate.swift: scene root VC already registers the plugin — skipped"
fi

# 3d. ApnsBridge — APNs device-token registration for the "Prompt alerts" push tier (reference/SCOPE-notifications.md §15).
# Appended inline for the same reason BackupExclude is (old-format pbxproj won't compile a loose .swift). The
# device-token delegate methods go in an `extension AppDelegate`, so this stays append-only — no edit to the stock
# AppDelegate body. GENERIC/contentless: nothing here decrypts; iOS draws a generic push with the app not running.
if grep -q "class ApnsBridge" "$APPDELEGATE"; then
  echo "  AppDelegate.swift: ApnsBridge already present — skipped"
else
  cat >> "$APPDELEGATE" <<'SWIFT'

// ─── ios-fixup: ApnsBridge — APNs device-token registration for the "Prompt alerts" push tier ───
// register() (from JS) asks for notification authorization, then registers for remote notifications. iOS hands the
// device token to the AppDelegate callback below, which forwards it to JS as the 'apnsToken' event; screens-extras.jsx
// turns that into a signed kind-30078 pushtoken doc the relay registry reads (reference/SCOPE-notifications.md §15).
// An APNs token is a routing handle, not a secret. This tier is PUSH-ONLY and reads no identity key.
import UserNotifications

@objc(ApnsBridge)
public class ApnsBridge: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ApnsBridge"
    public let jsName = "ApnsBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
    ]
    // A shared reference so the AppDelegate's didRegister callback can reach the live plugin instance.
    static weak var shared: ApnsBridge?
    override public func load() { ApnsBridge.shared = self }

    @objc func register(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async {
                // Register regardless of `granted`: a token lets the relay REACH this device; whether a banner is
                // shown is the user's notification setting, which they can change later without re-registering.
                UIApplication.shared.registerForRemoteNotifications()
                call.resolve(["granted": granted])
            }
        }
    }

    // Called by the AppDelegate extension when iOS hands us a token.
    func deliver(token: String) {
        var env = "production"
        #if DEBUG
        env = "sandbox"   // debug builds talk to the APNs sandbox; the relay must send via the matching environment
        #endif
        notifyListeners("apnsToken", data: ["token": token, "env": env])
    }
}

// The device-token callbacks must live on the UIApplicationDelegate; an extension keeps this append-only. Hex-encode
// the token exactly as APNs expects and hand it to the live plugin instance.
extension AppDelegate {
    public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        NSLog("APNS registered device token (\(hex.count / 2) bytes)")
        ApnsBridge.shared?.deliver(token: hex)
    }
    public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("APNS registration failed: \(error.localizedDescription)")
    }
}
SWIFT
  echo "  AppDelegate.swift: ApnsBridge appended"
fi
# 3e. register the ApnsBridge instance in the bridge VC's capacitorDidLoad (idempotent).
if grep -q "registerPluginInstance(ApnsBridge())" "$APPDELEGATE"; then
  echo "  AppDelegate.swift: ApnsBridge already registered — skipped"
else
  python3 -I - "$APPDELEGATE" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
anchor = "bridge?.registerPluginInstance(BackupExcludePlugin())"
assert anchor in s, "BackupExclude registration not found — ios-fixup step 3b must run first"
s = s.replace(anchor, anchor + "\n        bridge?.registerPluginInstance(ApnsBridge())", 1)
open(p, "w").write(s)
PY
  echo "  AppDelegate.swift: ApnsBridge registered in capacitorDidLoad"
fi

# ── 4. App icon + splash: replace the default Capacitor icon ─────────────────
# `cap add ios` ships the stock Capacitor icon (a blue chevron on white). Generate the
# real MEMBER icon + splash from assets/ (icon-foreground over icon-background, + splash,
# the @capacitor/assets layout) so the phone shows the TrinityOne mark. @capacitor/assets
# and its sharp engine are pure-JS devDependencies; skip quietly if they are not installed
# so an icon step never breaks the build. (The STEWARD console overwrites this afterwards
# with scripts/ios-steward-appicon.mjs — see that file.)
if [ -x "$ROOT/node_modules/.bin/capacitor-assets" ]; then
  "$ROOT/node_modules/.bin/capacitor-assets" generate --ios >/dev/null \
    && echo "  AppIcon + splash: generated from assets/ (member)"
else
  echo "  AppIcon: @capacitor/assets not installed — keeping the default icon (run 'npm i' to brand it)"
fi

echo "ios-fixup: done. Next: 'cd ios/App && pod install' (CI's pod install step does this)."
