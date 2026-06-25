#!/usr/bin/env bash
# Bundle the optional Manna module (money-out / disbursements) for the Steward console (loaded by steward.html).
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/steward-manna.src.js --bundle --format=iife --target=es2020 --legal-comments=none --outfile=vendor/steward-manna.js
echo "built vendor/steward-manna.js ($(du -h vendor/steward-manna.js | cut -f1))"
