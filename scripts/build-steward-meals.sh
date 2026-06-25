#!/usr/bin/env bash
# Bundle the optional Meal trains / practical-care module for the Steward console (loaded by steward.html).
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/steward-meals.src.js --bundle --format=iife --target=es2020 --legal-comments=none --outfile=vendor/steward-meals.js
echo "built vendor/steward-meals.js ($(du -h vendor/steward-meals.js | cut -f1))"
