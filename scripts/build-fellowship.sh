#!/usr/bin/env bash
# Bundle the Nostr chat transport into one self-contained file (loaded by index.html).
# Re-run after editing src/fellowship.src.js.
set -euo pipefail
cd "$(dirname "$0")/.."
# TEST-RELAY OVERRIDE (live-sim isolation, option B — see churchRelaysRaw in src/fellowship.src.js). Normally
# EMPTY: a plain build (and all of CI/Release) bakes __TEST_RELAY__="" so the shared pool stays
# app.trinityone.church. Set TRINITY_TEST_RELAY=wss://<tunnel>/relay ONLY for an isolated test build; it replaces
# the canonical pool (not admission) with that one relay. Must be wss://; anything else is ignored at runtime.
TEST_RELAY="${TRINITY_TEST_RELAY:-}"
[ -n "$TEST_RELAY" ] && echo "⚠ build-fellowship: TEST-RELAY build — shared pool = $TEST_RELAY (NOT app.trinityone.church)"
npx esbuild src/fellowship.src.js \
  --bundle --format=iife --target=es2020 --legal-comments=none \
  --define:__TEST_RELAY__="\"${TEST_RELAY}\"" \
  --outfile=vendor/fellowship.js
echo "built vendor/fellowship.js ($(du -h vendor/fellowship.js | cut -f1))"
