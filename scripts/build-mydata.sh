#!/usr/bin/env bash
# Bundle the user-owned-data store into one self-contained file (loaded by index.html).
# Re-run after editing src/mydata.src.js. LOCAL backend now; the encrypted-Nostr backend
# is a later drop-in swap inside the same file.
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/mydata.src.js \
  --bundle --format=iife --target=es2020 --legal-comments=none \
  --outfile=vendor/mydata.js
echo "built vendor/mydata.js ($(du -h vendor/mydata.js | cut -f1))"
