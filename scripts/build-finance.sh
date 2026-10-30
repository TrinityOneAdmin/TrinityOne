#!/usr/bin/env bash
# Bundle the double-entry ledger engine + store as window.FinanceLedger for the Steward console (steward.html).
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild src/finance-bundle.mjs --bundle --format=iife --global-name=FinanceLedger --target=es2020 --legal-comments=none --outfile=vendor/finance-ledger.js
echo "built vendor/finance-ledger.js ($(du -h vendor/finance-ledger.js | cut -f1))"
# UK Gift Aid regional pack — a SEPARATE bundle (window.FinanceGiftAid), NOT folded into the core above. The
# core stays nation-neutral (DOMAIN); the console loads this only when church.features.giftAid === true.
npx esbuild src/finance-giftaid-bundle.mjs --bundle --format=iife --global-name=FinanceGiftAid --target=es2020 --legal-comments=none --outfile=vendor/finance-giftaid.js
echo "built vendor/finance-giftaid.js ($(du -h vendor/finance-giftaid.js | cut -f1))"
# Shared CONTRIBUTION-STATEMENT regional pack — a SEPARATE bundle (window.FinanceContribution), NOT folded into
# the core above. Same nation-neutral seam as Gift Aid; the console loads this only when the active tax tool is
# 'contributionStatement' (US, New Zealand, …).
npx esbuild src/finance-contribution-bundle.mjs --bundle --format=iife --global-name=FinanceContribution --target=es2020 --legal-comments=none --outfile=vendor/finance-contribution.js
echo "built vendor/finance-contribution.js ($(du -h vendor/finance-contribution.js | cut -f1))"
