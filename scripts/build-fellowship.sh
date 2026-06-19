#!/usr/bin/env bash
# Bundle the Nostr chat transport into one self-contained file (loaded by index.html).
# Re-run after editing src/fellowship.src.js.
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/fellowship.src.js \
  --bundle --format=iife --target=es2020 --legal-comments=none \
  --outfile=vendor/fellowship.js
echo "built vendor/fellowship.js ($(du -h vendor/fellowship.js | cut -f1))"
