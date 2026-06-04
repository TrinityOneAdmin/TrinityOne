#!/usr/bin/env bash
# Vendor every CDN dependency locally so the app boots with zero network.
# Re-run to refresh. Pinned versions match what index.html used to load from CDNs.
set -euo pipefail
cd "$(dirname "$0")/.."
V=vendor
mkdir -p "$V/sqljs" "$V/fonts"

dl() { echo "  $2"; curl -sSfL "$1" -o "$2"; }

echo "JS libraries:"
dl "https://unpkg.com/react@18.3.1/umd/react.development.js"            "$V/react.development.js"
dl "https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"    "$V/react-dom.development.js"
dl "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js"           "$V/babel.min.js"
dl "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js"            "$V/fflate.js"

echo "sql.js (wasm engine):"
dl "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js"   "$V/sqljs/sql-wasm.js"
dl "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm" "$V/sqljs/sql-wasm.wasm"

echo "Google fonts (css + woff2, rewritten to local):"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FONTS_URL="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
curl -sSfL -A "$UA" "$FONTS_URL" -o "$V/fonts/fonts.css"
i=0
for url in $(grep -oE 'https://fonts\.gstatic\.com/[^)]+\.woff2' "$V/fonts/fonts.css" | sort -u); do
  i=$((i+1)); fn=$(printf 'f%03d.woff2' "$i")
  curl -sSfL "$url" -o "$V/fonts/$fn"
  # rewrite this exact url -> local relative path
  python3 - "$V/fonts/fonts.css" "$url" "$fn" <<'PY'
import sys; p,u,fn=sys.argv[1:4]
s=open(p,encoding='utf-8').read().replace(u,fn)
open(p,'w',encoding='utf-8').write(s)
PY
done
echo "  $i woff2 files"
echo "done. vendor/ size: $(du -sh "$V" | cut -f1)"
