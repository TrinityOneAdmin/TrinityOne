#!/usr/bin/env bash
# Headless smoke test: boots the app in real Chromium and asserts key screens render.
# Requires the app served on :8000 (npm run serve) and Chromium installed.
# Chat checks also need the dev relay (npm run relay). Exit non-zero on any failure.
set -uo pipefail
BASE="${BASE:-http://localhost:8000}"
MOD="modules/eng-akjv.bbl.mybible"
CHROME="$(command -v chromium || command -v chromium-browser || command -v google-chrome || command -v google-chrome-stable || true)"
[ -z "$CHROME" ] && { echo "✗ no Chromium found"; exit 2; }
curl -fsS -o /dev/null "$BASE/" || { echo "✗ app not served at $BASE (run: npm run serve)"; exit 2; }

fails=0
check() {            # check "name" "url" "grep-pattern"
  local name="$1" url="$2" pat="$3" prof; prof="$(mktemp -d)"
  local dom; dom="$("$CHROME" --headless --disable-gpu --no-sandbox --user-data-dir="$prof" \
    --virtual-time-budget=18000 --dump-dom "$BASE/$url" 2>/dev/null)"
  rm -rf "$prof"
  if grep -qE "$pat" <<<"$dom"; then echo "✓ $name"; else echo "✗ $name"; fails=$((fails+1)); fi
}

echo "TrinityOne smoke test ($BASE)"
check "reader (sql.js, offline-capable)" "?module=$MOD&tab=read"          'reader-body|class="st"'
check "today (verse of the day)"         "?module=$MOD&tab=today"         'Verse of the day'
check "plans (real plan)"                "?module=$MOD&tab=plans"         'The Gospel of John'
check "search (engine)"                  "?module=$MOD&tab=search&q=light" 'class="st"|reader-body|mark'
check "chat (groups or join prompt)"     "?module=$MOD&tab=chat"          'Your groups|Join your church'
check "module store (eBible mirror)"     "?module=$MOD&store=language"    'translations'
check "boot splash present"              "?module=$MOD"                   'to-splash'

echo "---"
if [ "$fails" -eq 0 ]; then echo "all passed"; else echo "$fails check(s) failed"; fi
exit "$fails"
