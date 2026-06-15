#!/usr/bin/env bash
# Build the standalone Steward APK (trinityone-steward.apk): the steward console
# (steward.html + stew-*.jsx) wrapped as its OWN Android app (com.trinityone.steward), so a steward
# can create + manage a church on a phone, talking straight to the relays — a host-independent
# fallback if the web console is blocked. Re-uses the shared android/ project via a temporary
# applicationId / app-name / webDir swap, ALWAYS reverted on exit (the member project is restored).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
WWW="$ROOT/www"
GRADLE="android/app/build.gradle"
STRINGS="android/app/src/main/res/values/strings.xml"

# whatever happens, put the member project back (app id, name, and the member www/)
restore() {
  sed -i 's/applicationId "com.trinityone.steward"/applicationId "com.trinityone.app"/' "$GRADLE" 2>/dev/null || true
  sed -i 's#<string name="app_name">TrinityOne Steward</string>#<string name="app_name">TrinityOne</string>#' "$STRINGS" 2>/dev/null || true
  echo "restoring member www/ + project…"
  bash scripts/sync-web.sh >/dev/null 2>&1 || true
}
trap restore EXIT

source scripts/android-env.sh

# 1. steward webDir — only what steward.html references; steward.html becomes index.html
echo "building steward webDir…"
rm -rf "$WWW"; mkdir -p "$WWW/vendor"
cp steward.html "$WWW/index.html"
cp brand.css "$WWW/"
cp icons.jsx stew-data.jsx stew-console.jsx stew-schedule.jsx stew-templates.jsx \
   stew-dashboard.jsx stew-relay.jsx stew-extension.jsx stew-phone.jsx stew-custody.jsx \
   backup.jsx steward-root.jsx "$WWW/"
cp -r vendor/fonts "$WWW/vendor/"
cp vendor/react.development.js vendor/react-dom.development.js vendor/steward.js vendor/jsqr.js "$WWW/vendor/"

# pre-transpile JSX -> JS (runtime Babel is unreliable in the Capacitor webview)
echo "transpiling steward JSX -> JS…"
for f in "$WWW"/*.jsx; do
  base="$(basename "$f" .jsx)"
  ./node_modules/.bin/esbuild "$f" --jsx=transform --log-level=error --outfile="$WWW/$base.js"
  rm "$f"
done
sed -i -e '/babel\.min\.js/d' -e 's#<script type="text/babel" src="\([^"]*\)\.jsx">#<script src="\1.js">#g' "$WWW/index.html"

# 2. swap to the Steward app identity (separate install from the member app)
sed -i 's/applicationId "com.trinityone.app"/applicationId "com.trinityone.steward"/' "$GRADLE"
sed -i 's#<string name="app_name">TrinityOne</string>#<string name="app_name">TrinityOne Steward</string>#' "$STRINGS"

# 3. copy webDir into the native project + build
npx cap copy android
( cd android && ./gradlew assembleDebug -q )
cp android/app/build/outputs/apk/debug/app-debug.apk trinityone-steward.apk
echo "→ trinityone-steward.apk ($(du -h trinityone-steward.apk | cut -f1))"
# restore() runs on EXIT
