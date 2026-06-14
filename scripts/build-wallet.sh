#!/usr/bin/env bash
# Bundle the in-app Cashu (ecash) wallet into one self-contained file (loaded by index.html).
# Re-run after editing src/wallet.src.js.
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/wallet.src.js \
  --bundle --format=iife --target=es2020 --legal-comments=none \
  --outfile=vendor/wallet.js
echo "built vendor/wallet.js ($(du -h vendor/wallet.js | cut -f1))"
