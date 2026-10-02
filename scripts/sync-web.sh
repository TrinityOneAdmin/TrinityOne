#!/usr/bin/env bash
# Populate www/ (Capacitor webDir) with just the web app + bundled data + the
# local "Featured" modules, then sync into the native android project.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
WWW="$ROOT/www"

rm -rf "$WWW"
mkdir -p "$WWW/modules" "$WWW/vendor"

# app shell + code + bundled catalogs/snapshots (the app UI .jsx now live under app/)
cp index.html engine.js catalog.json ebible-catalog.json trinity-videos.json web-audio-manifest.json "$WWW/"
cp -r app "$WWW/"
# PWA assets (manifest + icons are referenced by index.html; sw.js is not registered under Capacitor)
cp manifest.json sw.js sw-register.js "$WWW/" 2>/dev/null || true
cp -r icons "$WWW/" 2>/dev/null || true
# vendored libs (React/Babel/sql.js/fflate/fonts/identity) — fully offline
cp -r vendor/. "$WWW/vendor/"
# Library books are NOT bundled in the APK — they download on demand from the gateway (like Bibles)
# and cache in IndexedDB. Keep vendor/library/index.js (small previews/catalog) so the list works
# offline; drop the full-book payloads (~5 MB) so they don't bloat the APK.
rm -f "$WWW"/vendor/library/*.json.gz

# Pre-transpile JSX -> plain JS so the PACKAGED app needs NO runtime Babel. Runtime @babel/standalone
# is unreliable in the Capacitor webview (its native-HTTP patching can break Babel's fetch of the
# .jsx files -> nothing renders -> solid blank screen). Plain <script> loads avoid all of that.
echo "transpiling JSX -> JS for the packaged build…"
for f in "$WWW"/app/*.jsx; do
  base="$(basename "$f" .jsx)"
  ./node_modules/.bin/esbuild "$f" --jsx=transform --log-level=error --outfile="$WWW/app/$base.js"
  rm "$f"
done
# index.html for the packaged build: drop the Babel runtime, point script tags at the transpiled .js, and
# DEFER every one of them.
#
# Finding 5 of the 2026-09-05 audit, measured: the packaged page loads ~44 classic scripts, none deferred,
# 2.67 MB raw / 663 KB gzipped before first paint. Each one blocks the parser, so on the thin pipe this
# product is aimed at ("does this work over a thin pipe in Tehran") the cost is ~44 sequential blocking
# requests rather than the bytes.
#
# WHY `defer` AND NOT code-splitting: every app/*.jsx is a CLASSIC script sharing globals — each ends by
# hanging its components on `window`, and app.jsx references screen components at render. Loading them
# lazily needs a real loader and has blanked the APK before (see the duplicate-global class of bug). `defer`
# changes none of that: it preserves execution ORDER exactly, and deferred scripts still run before
# DOMContentLoaded, so anything listening for it is unaffected.
#
# Applied HERE and not in the source index.html on purpose. Unpackaged, the page still loads Babel and the
# app files are type="text/babel", which Babel schedules itself; deferring the vendor scripts around it
# would change the dev path for no benefit. The packaged page is the one the APK and app.trinityone.church
# actually serve.
sed -i \
  -e '/babel\.min\.js/d' \
  -e 's#<script type="text/babel" src="\([^"]*\)\.jsx">#<script defer src="\1.js">#g' \
  -e 's#<script src="#<script defer src="#g' \
  "$WWW/index.html"

# APK diet (E5): the PACKAGED member app loads NONE of these — drop them so they don't bloat the APK.
# Verified against index.html: it references backup.js + mydata.js + library (kept), but NOT the Babel
# runtime (the packaged HTML is pre-transpiled), the steward console (com.trinityone.steward is its own
# APK), or the PDF lib (steward finance only). Saves ~1MB uncompressed.
rm -f "$WWW"/vendor/babel.min.js
rm -f "$WWW"/app/stew-*.js "$WWW"/app/steward-root.js
rm -f "$WWW"/vendor/steward*.js "$WWW"/vendor/jspdf.umd.min.js
# The in-app wallet is parked for the pilot (app/app.jsx WALLET_ENABLED = false) and its <script> tag in
# index.html is commented out — but the bundle was still being copied in, ~294 KB of the APK that no code
# path can reach. Prune it while it stays disabled; re-enabling the wallet means deleting this line too.
if grep -q 'const WALLET_ENABLED = false' "$ROOT/app/app.jsx" 2>/dev/null; then rm -f "$WWW"/vendor/wallet.js; fi
rm -f "$WWW"/vendor/fonts/f00[123].woff2 "$WWW"/vendor/fonts/f01[0123].woff2   # unused Bricolage Grotesque + Plus Jakarta Sans faces (only Sora + Newsreader are referenced)

# THE DEFAULT BIBLE SHIPS. engine.js auto-installs BSB on first launch by DOWNLOADING it, so until now a
# phone that had never had a working connection had no scripture at all — while "Share the app" promises a
# recipient can read offline with no internet on their phone, and hand-to-hand sharing over Quick Share /
# Bluetooth is the distribution route for exactly the places where that connection does not exist.
# 2.9 MB on a ~7 MB APK is the right trade for making that promise true. AUDIT-2026-07-27.
cp modules/engbsb.zip "$WWW/modules/" 2>/dev/null || echo "  (warning: modules/engbsb.zip missing — the APK will ship with no Bible)"

# The REST of the library still downloads on demand — the full set below is 25 MB and would quadruple the
# APK. Set BUNDLE_MODULES=1 for an everything-offline build (a church with no connection at all).
if [ "${BUNDLE_MODULES:-}" = "1" ]; then
  cp modules/engbsb.zip modules/eng-kjv.zip modules/eng-web.zip modules/eng-asv.zip \
     modules/ahirani-usfm.zip modules/eng-akjv.bbl.mybible modules/strongs-dict.json \
     "$WWW/modules/" 2>/dev/null || true
fi

echo "www/ populated:"; du -sh "$WWW"

# if the native project exists, copy assets in
if [ -d "$ROOT/android" ]; then
  npx cap sync android
  # WebView debugging is now controlled by the Gradle BUILD VARIANT, not by the Capacitor config.
  # MainActivity overrides setWebContentsDebuggingEnabled() at runtime using BuildConfig.WEB_DEBUG:
  #   assembleDebug   → WEB_DEBUG=true  (dev builds, CDP diagnosis via USB)
  #   assembleRelease → WEB_DEBUG=false (pilot/go-live, CDP locked out)
  # The capacitor.config.json value is still read by the Bridge first, but the Java override wins.
  # TRINITY_DEBUG=0 is no longer needed — use assembleRelease instead.
  ASSETS_CFG="$ROOT/android/app/src/main/assets/capacitor.config.json"
  if [ -f "$ASSETS_CFG" ] && grep -q '"webContentsDebuggingEnabled": *true' "$ASSETS_CFG"; then
    echo "ℹ capacitor.config.json says debug=true; the Gradle variant decides what actually ships."
  fi
fi
