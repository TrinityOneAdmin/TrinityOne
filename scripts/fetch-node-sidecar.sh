#!/usr/bin/env bash
# fetch-node-sidecar.sh — download the official Node runtime and install it as the Tauri sidecar the desktop
# Relay app spawns, so end users need no Node of their own. Tauri resolves externalBin "binaries/trinityone-relay"
# to "binaries/trinityone-relay-<target-triple>[.exe]" at build time, so we name the binary exactly that.
#
# Usage: fetch-node-sidecar.sh [target-triple]
#   target-triple defaults to the host's Rust triple (via rustc -vV). NODE_VERSION overrides the Node version.
# Runs on Linux/macOS bash and on Windows Git-Bash (GitHub windows runners). Idempotent.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.22.2}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$HERE/relay-app/desktop/src-tauri/binaries"
mkdir -p "$BIN_DIR"

TRIPLE="${1:-}"
if [ -z "$TRIPLE" ]; then
  TRIPLE="$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')"
fi
[ -n "$TRIPLE" ] || { echo "fetch-node-sidecar: no target triple (pass one, or install rustc)" >&2; exit 2; }

# map the Rust target triple -> Node's platform-arch download token + archive kind
case "$TRIPLE" in
  x86_64-unknown-linux-gnu)   NODE_PA="linux-x64";   EXT="tar.xz"; WIN=0 ;;
  aarch64-unknown-linux-gnu)  NODE_PA="linux-arm64"; EXT="tar.xz"; WIN=0 ;;
  x86_64-apple-darwin)        NODE_PA="darwin-x64";  EXT="tar.gz"; WIN=0 ;;
  aarch64-apple-darwin)       NODE_PA="darwin-arm64";EXT="tar.gz"; WIN=0 ;;
  x86_64-pc-windows-msvc)     NODE_PA="win-x64";     EXT="zip";    WIN=1 ;;
  aarch64-pc-windows-msvc)    NODE_PA="win-arm64";   EXT="zip";    WIN=1 ;;
  *) echo "fetch-node-sidecar: unsupported target triple '$TRIPLE'" >&2; exit 2 ;;
esac

STEM="node-v${NODE_VERSION}-${NODE_PA}"
URL="https://nodejs.org/dist/v${NODE_VERSION}/${STEM}.${EXT}"
# NB: the sidecar name must NOT equal the Cargo package name (trinityone-relay) — Tauri rejects that. Hence
# 'trinityone-relay-node' (it IS the bundled Node runtime). Keep in sync with tauri.conf externalBin + main.rs.
OUT="$BIN_DIR/trinityone-relay-node-${TRIPLE}"
[ "$WIN" = 1 ] && OUT="${OUT}.exe"

echo "fetch-node-sidecar: $URL"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP/node.${EXT}"

if [ "$EXT" = "zip" ]; then
  ( cd "$TMP" && { unzip -q "node.zip" || tar -xf "node.zip"; } )   # bsdtar (win/mac) reads zip; unzip if present
  cp "$TMP/$STEM/node.exe" "$OUT"
else
  tar -xf "$TMP/node.${EXT}" -C "$TMP"
  cp "$TMP/$STEM/bin/node" "$OUT"
  chmod +x "$OUT"
fi

echo "fetch-node-sidecar: installed $(basename "$OUT") ($(du -h "$OUT" | cut -f1), Node v${NODE_VERSION})"
