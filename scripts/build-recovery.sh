#!/usr/bin/env bash
# Bundle the Shamir guardian-recovery core into one self-contained file (loaded by index.html).
# Re-run after editing src/recovery-core.mjs or src/recovery.src.js.
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/recovery.src.js \
  --bundle --format=iife --target=es2020 --legal-comments=none \
  --outfile=vendor/recovery.js
echo "built vendor/recovery.js ($(du -h vendor/recovery.js | cut -f1))"
