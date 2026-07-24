#!/usr/bin/env bash
# Regenerate the social share cards from scripts/og-card.html (headless chromium, 1200x630).
#   scripts/make-og-cards.sh
# Produces og-join.png (church join links) and og-cover.png (marketing pages),
# writing each to the repo root AND pages-dist/ (the Cloudflare Pages build copy).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
TPL="file://$ROOT/scripts/og-card.html"

CHROME="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
[ -n "$CHROME" ] || { echo "no chromium found"; exit 1; }

render () { # <variant> <outfile>
  local v="$1" out="$2"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-color-profile=srgb \
    --window-size=1200,630 --virtual-time-budget=3000 \
    --screenshot="$ROOT/$out" "$TPL?v=$v" >/dev/null 2>&1
  # shrink to an 8-bit palette PNG if pngquant is around (OG images should be light)
  if command -v pngquant >/dev/null 2>&1; then
    pngquant --force --quality=70-92 --strip --output "$ROOT/$out" "$ROOT/$out" || true
  fi
  mkdir -p "$ROOT/pages-dist"
  cp "$ROOT/$out" "$ROOT/pages-dist/$out"
  printf '  %-14s %s\n' "$out" "$(identify -format '%wx%h %B bytes' "$ROOT/$out" 2>/dev/null || wc -c <"$ROOT/$out")"
}

echo "Rendering share cards…"
render join og-join.png
render site og-cover.png
echo "Done."
