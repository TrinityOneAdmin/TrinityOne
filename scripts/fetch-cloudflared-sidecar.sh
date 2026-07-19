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

# SECURITY-AUDIT-2026-07-18: pin the version rather than tracking `latest`. `/releases/latest/` silently follows
# whatever Cloudflare (or an attacker who compromises the release channel) publishes next, into every church's
# signed installer. Set CLOUDFLARED_VERSION (e.g. 2024.8.3) in the release/CI env to pin a reviewed build; only
# falls back to `latest` with a loud warning for local dev.
CLOUDFLARED_VERSION="${CLOUDFLARED_VERSION:-}"
if [ -n "$CLOUDFLARED_VERSION" ]; then
  URL="https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${ASSET}"
else
  echo "fetch-cloudflared: WARNING — CLOUDFLARED_VERSION not set; tracking 'latest' (unpinned). Pin it for release builds." >&2
  URL="https://github.com/cloudflare/cloudflared/releases/latest/download/${ASSET}"
fi
OUT="$BIN_DIR/trinityone-cloudflared-${TRIPLE}"
[ "$KIND" = exe ] && OUT="${OUT}.exe"
echo "fetch-cloudflared: $URL"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP/dl"

# Verify the download if an expected SHA-256 is provided (CLOUDFLARED_SHA256 env, or a committed
# relay-app/desktop/cloudflared-checksums.txt line "<sha256>  <asset>"). Cloudflare doesn't ship a stable
# per-asset checksum file, so this is opt-in — but when set it hard-fails on any tampering, and when absent it
# WARNS rather than silently trusting the binary.
EXPECT="${CLOUDFLARED_SHA256:-}"
CKFILE="$HERE/relay-app/desktop/cloudflared-checksums.txt"
[ -z "$EXPECT" ] && [ -f "$CKFILE" ] && EXPECT="$(awk -v f="$ASSET" '$2==f{print $1}' "$CKFILE")"
if [ -n "$EXPECT" ]; then
  if command -v sha256sum >/dev/null 2>&1; then ACTUAL="$(sha256sum "$TMP/dl" | awk '{print $1}')"
  else ACTUAL="$(shasum -a 256 "$TMP/dl" | awk '{print $1}')"; fi
  [ "$ACTUAL" = "$EXPECT" ] || { echo "fetch-cloudflared: CHECKSUM MISMATCH for ${ASSET} (expected $EXPECT, got $ACTUAL) — refusing" >&2; exit 3; }
  echo "fetch-cloudflared: sha256 verified ($EXPECT)"
else
  echo "fetch-cloudflared: WARNING — no expected SHA-256 (set CLOUDFLARED_SHA256 or add $CKFILE); binary is UNVERIFIED." >&2
fi
if [ "$KIND" = tgz ]; then
  tar -xzf "$TMP/dl" -C "$TMP"
  cp "$TMP/cloudflared" "$OUT"
else
  cp "$TMP/dl" "$OUT"
fi
[ "$KIND" = exe ] || chmod +x "$OUT"
echo "fetch-cloudflared: installed $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
