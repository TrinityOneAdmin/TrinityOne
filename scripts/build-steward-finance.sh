#!/usr/bin/env bash
# Bundle the optional Finance module for the Steward console (loaded by steward.html).
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/steward-finance.src.js --bundle --format=iife --target=es2020 --legal-comments=none --outfile=vendor/steward-finance.js
echo "built vendor/steward-finance.js ($(du -h vendor/steward-finance.js | cut -f1))"
