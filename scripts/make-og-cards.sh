#!/usr/bin/env bash
# Regenerate the social share cards from scripts/og-card.html (headless chromium, 1200x630).
#   scripts/make-og-cards.sh
# Produces og-join-v2.jpg (church join links) and og-cover-v2.jpg (marketing pages), "Midnight halo".
# The older og-join.png / og-cover.png are kept in the repo (already-posted links cache them).
# Exits non-zero if any card is over 300KB.
#
# writing each to the repo root AND pages-dist/ (the Cloudflare Pages build copy).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
TPL="file://$ROOT/scripts/og-card.html"

CHROME="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
[ -n "$CHROME" ] || { echo "no chromium found"; exit 1; }

MAX_BYTES=300000   # WhatsApp refuses/drops link-preview images over ~300KB; fail loudly, never skip
FAILED=0
render () { # <variant> <outfile.jpg>
  local v="$1" out="$2"; local tmp="$ROOT/.og-tmp-$v.png"
  rm -f "$tmp"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-color-profile=srgb \
    --window-size=1200,630 --virtual-time-budget=3000 \
    --screenshot="$tmp" "$TPL?v=$v" >/dev/null 2>&1 || true
  [ -s "$tmp" ] || { echo "ERROR: chromium produced no screenshot for $v"; exit 1; }
  # JPEG, not PNG: a smooth dark gradient is ~300KB as 24-bit PNG (pngquant is not installed).
  # 4:4:4 keeps the red/gold edges crisp.
  convert "$tmp" -strip -sampling-factor 4:4:4 -quality "${OG_QUALITY:-93}" "$ROOT/$out"
  rm -f "$tmp"
  local bytes; bytes=$(wc -c <"$ROOT/$out")
  mkdir -p "$ROOT/pages-dist"
  cp "$ROOT/$out" "$ROOT/pages-dist/$out"
  printf '  %-16s %s %s bytes\n' "$out" "$(identify -format '%wx%h' "$ROOT/$out")" "$bytes"
  if [ "$bytes" -gt "$MAX_BYTES" ]; then
    echo "ERROR: $out is $bytes bytes, over the $MAX_BYTES limit"; FAILED=1
  fi
}

echo "Rendering share cards..."
render join2 og-join-v2.jpg
render cover2 og-cover-v2.jpg
[ "$FAILED" = 0 ] || { echo "FAILED: a card is over $MAX_BYTES bytes"; exit 1; }
echo "Done."
