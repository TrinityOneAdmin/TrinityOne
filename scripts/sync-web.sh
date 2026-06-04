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
cp index.html engine.js *.jsx catalog.json ebible-catalog.json trinity-videos.json "$WWW/"
# bundled vendor libs (Nostr identity)
cp vendor/identity.js "$WWW/vendor/"

# local Featured modules (so the app is useful offline on first launch)
cp modules/eng-kjv.zip modules/eng-web.zip modules/eng-asv.zip \
   modules/ahirani-usfm.zip modules/eng-akjv.bbl.mybible modules/strongs-dict.json \
   "$WWW/modules/"

echo "www/ populated:"; du -sh "$WWW"

# if the native project exists, copy assets in
if [ -d "$ROOT/android" ]; then
  npx cap copy android
fi
