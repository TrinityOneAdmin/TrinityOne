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
cp manifest.json sw.js "$WWW/" 2>/dev/null || true
cp -r icons "$WWW/" 2>/dev/null || true
# vendored libs (React/Babel/sql.js/fflate/fonts/identity) — fully offline
cp -r vendor/. "$WWW/vendor/"

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

# local Featured modules (so the app is useful offline on first launch)
cp modules/engbsb.zip modules/eng-kjv.zip modules/eng-web.zip modules/eng-asv.zip \
   modules/ahirani-usfm.zip modules/eng-akjv.bbl.mybible modules/strongs-dict.json \
   "$WWW/modules/"

echo "www/ populated:"; du -sh "$WWW"

# if the native project exists, copy assets in
if [ -d "$ROOT/android" ]; then
  npx cap sync android
fi
