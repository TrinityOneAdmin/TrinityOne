#!/usr/bin/env bash
# Bundle the double-entry ledger engine + store as window.FinanceLedger for the Steward console (steward.html).
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/finance-bundle.mjs --bundle --format=iife --global-name=FinanceLedger --target=es2020 --legal-comments=none --outfile=vendor/finance-ledger.js
echo "built vendor/finance-ledger.js ($(du -h vendor/finance-ledger.js | cut -f1))"
