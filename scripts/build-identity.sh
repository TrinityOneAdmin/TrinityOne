#!/usr/bin/env bash
# Bundle the Nostr identity module into one self-contained file loaded by index.html.
# Re-run after editing src/identity.src.js or bumping nostr-tools.
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/identity.src.js \
  --bundle --format=iife --target=es2020 --legal-comments=none \
  --outfile=vendor/identity.js
echo "built vendor/identity.js ($(du -h vendor/identity.js | cut -f1))"
