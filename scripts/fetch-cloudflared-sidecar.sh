#!/usr/bin/env bash
# fetch-cloudflared-sidecar.sh — download the official cloudflared binary and install it as the Tauri sidecar the
# desktop Suite app spawns to make its relay publicly reachable (a Cloudflare "quick tunnel", no account). Tauri
# resolves externalBin "binaries/trinityone-cloudflared" to "binaries/trinityone-cloudflared-<triple>[.exe]".
#
# Usage: fetch-cloudflared-sidecar.sh [target-triple]   (defaults to the host's Rust triple)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$HERE/relay-app/desktop/src-tauri/binaries"
mkdir -p "$BIN_DIR"

TRIPLE="${1:-}"
[ -z "$TRIPLE" ] && TRIPLE="$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')"
[ -n "$TRIPLE" ] || { echo "fetch-cloudflared: no target triple (pass one, or install rustc)" >&2; exit 2; }

# map the Rust target triple -> cloudflared's release asset name (macOS ships a .tgz; others are raw binaries)
case "$TRIPLE" in
  x86_64-unknown-linux-gnu)   ASSET="cloudflared-linux-amd64";       KIND=raw ;;
  aarch64-unknown-linux-gnu)  ASSET="cloudflared-linux-arm64";       KIND=raw ;;
  x86_64-apple-darwin)        ASSET="cloudflared-darwin-amd64.tgz";  KIND=tgz ;;
  aarch64-apple-darwin)       ASSET="cloudflared-darwin-arm64.tgz";  KIND=tgz ;;
  x86_64-pc-windows-msvc)     ASSET="cloudflared-windows-amd64.exe"; KIND=exe ;;
  aarch64-pc-windows-msvc)    ASSET="cloudflared-windows-arm64.exe"; KIND=exe ;;
  *) echo "fetch-cloudflared: unsupported target triple '$TRIPLE'" >&2; exit 2 ;;
esac

URL="https://github.com/cloudflare/cloudflared/releases/latest/download/${ASSET}"
OUT="$BIN_DIR/trinityone-cloudflared-${TRIPLE}"
[ "$KIND" = exe ] && OUT="${OUT}.exe"
echo "fetch-cloudflared: $URL"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP/dl"
if [ "$KIND" = tgz ]; then
  tar -xzf "$TMP/dl" -C "$TMP"
  cp "$TMP/cloudflared" "$OUT"
else
  cp "$TMP/dl" "$OUT"
fi
[ "$KIND" = exe ] || chmod +x "$OUT"
echo "fetch-cloudflared: installed $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
