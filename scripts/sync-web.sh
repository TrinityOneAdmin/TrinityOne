#!/usr/bin/env bash
# Populate www/ (Capacitor webDir) with just the web app + bundled data + the
# local "Featured" modules, then sync into the native android project.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
WWW="$ROOT/www"

rm -rf "$WWW"
mkdir -p "$WWW/modules" "$WWW/vendor"

# app shell + code + bundled catalogs/snapshots
cp index.html engine.js *.jsx catalog.json ebible-catalog.json trinity-videos.json web-audio-manifest.json "$WWW/"
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
for f in "$WWW"/*.jsx; do
  base="$(basename "$f" .jsx)"
  ./node_modules/.bin/esbuild "$f" --jsx=transform --log-level=error --outfile="$WWW/$base.js"
  rm "$f"
done
# index.html for the packaged build: drop the Babel runtime, point script tags at the transpiled .js
sed -i \
  -e '/babel\.min\.js/d' \
  -e 's#<script type="text/babel" src="\([^"]*\)\.jsx">#<script src="\1.js">#g' \
  "$WWW/index.html"

# APK diet (E5): the PACKAGED member app loads NONE of these — drop them so they don't bloat the APK.
# Verified against index.html: it references backup.js + mydata.js + library (kept), but NOT the Babel
# runtime (the packaged HTML is pre-transpiled), the steward console (com.trinityone.steward is its own
# APK), or the PDF lib (steward finance only). Saves ~1MB uncompressed.
rm -f "$WWW"/vendor/babel.min.js
rm -f "$WWW"/stew-*.js "$WWW"/steward-root.js
rm -f "$WWW"/vendor/steward*.js "$WWW"/vendor/jspdf.umd.min.js
rm -f "$WWW"/vendor/fonts/f00[123].woff2 "$WWW"/vendor/fonts/f01[0123].woff2   # unused Bricolage Grotesque + Plus Jakarta Sans faces (only Sora + Newsreader are referenced)

# Bible/lexicon modules are NOT embedded in the app — they download on demand (BSB auto-installs on
# first launch). The web build still serves them same-origin from the deploy, so they live in www/
# for the PWA; the native APK ships none and pulls them from the gateway (engine.js ASSET_BASE).
if [ "${BUNDLE_MODULES:-}" = "1" ]; then
  cp modules/engbsb.zip modules/eng-kjv.zip modules/eng-web.zip modules/eng-asv.zip \
     modules/ahirani-usfm.zip modules/eng-akjv.bbl.mybible modules/strongs-dict.json \
     "$WWW/modules/" 2>/dev/null || true
fi

echo "www/ populated:"; du -sh "$WWW"

# if the native project exists, copy assets in
if [ -d "$ROOT/android" ]; then
  npx cap sync android
fi
