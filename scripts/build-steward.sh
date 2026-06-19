#!/usr/bin/env bash
# Bundle the Steward console's church identity + publishing (loaded by steward.html).
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/steward.src.js --bundle --format=iife --target=es2020 --legal-comments=none --outfile=vendor/steward.js
echo "built vendor/steward.js ($(du -h vendor/steward.js | cut -f1))"
