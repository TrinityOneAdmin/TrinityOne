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
#   3. The two Info.plist usage strings the app needs (camera QR join, Photos
#      backup export) — documented in docs/ops/IOS-BUILD.md; `cap add` won't create them.
#
# When TrinityOne moves to Capacitor 7+, revisit: 1 and 2 are likely built in, and
# this script should be trimmed to just the usage strings (or removed).
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
for k in NSCameraUsageDescription NSPhotoLibraryAddUsageDescription UIApplicationSceneManifest; do
  "$PB" -c "Delete :$k" "$PL" 2>/dev/null || true
done
"$PB" -c "Add :NSCameraUsageDescription string 'TrinityOne uses the camera to scan a QR code so you can join your church.'" "$PL"
"$PB" -c "Add :NSPhotoLibraryAddUsageDescription string 'TrinityOne saves your encrypted backup file to Photos when you choose to export it.'" "$PL"
SM=":UIApplicationSceneManifest"
CFG="$SM:UISceneConfigurations:UIWindowSceneSessionRoleApplication:0"
"$PB" -c "Add $SM dict" "$PL"
"$PB" -c "Add $SM:UIApplicationSupportsMultipleScenes bool false" "$PL"
"$PB" -c "Add $SM:UISceneConfigurations dict" "$PL"
"$PB" -c "Add $SM:UISceneConfigurations:UIWindowSceneSessionRoleApplication array" "$PL"
"$PB" -c "Add $CFG dict" "$PL"
"$PB" -c "Add $CFG:UISceneConfigurationName string 'Default Configuration'" "$PL"
"$PB" -c "Add $CFG:UISceneDelegateClassName string '\$(PRODUCT_MODULE_NAME).SceneDelegate'" "$PL"
plutil -lint "$PL" >/dev/null
echo "  Info.plist: usage strings + UIScene manifest set"

# ── 3. AppDelegate.swift: append the SceneDelegate (idempotent) ──────────────
if grep -q "class SceneDelegate" "$APPDELEGATE"; then
  echo "  AppDelegate.swift: SceneDelegate already present — skipped"
else
  cat >> "$APPDELEGATE" <<'SWIFT'

// ─── ios-fixup: UIScene lifecycle adoption (required by Xcode 26+ / iOS 26 SDK) ───
// Capacitor 6 ships no SceneDelegate, so the scene-based lifecycle the SDK now
// enforces has nothing to host the WKWebView and the app crashes on launch (or
// shows a black screen). This mirrors Capacitor 7's generated scene support:
// the scene's root view controller is the Capacitor bridge.
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
        window.rootViewController = CAPBridgeViewController()
        self.window = window
        window.makeKeyAndVisible()
    }
}
SWIFT
  echo "  AppDelegate.swift: SceneDelegate appended"
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
