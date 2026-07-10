#!/usr/bin/env bash
# build-relay-payload.sh — assemble the READ-ONLY runtime payload the desktop Relay app ships and runs.
#
# The packaged desktop app (relay-app/desktop, Tauri) bundles this payload as a resource and launches it with a
# bundled Node runtime: `node <payload>/scripts/gateway.mjs <port>` with TRINITY_DATA_DIR pointed at a writable
# per-user dir. So the payload is exactly what the gateway needs to READ at runtime — the transpiled web app, the
# gateway/event-store, relay-app control UI — plus a MINIMAL prod node_modules (only the three libs the gateway
# imports: ws, nostr-tools, web-push). No secrets, no git, no data dir: those never belong in the shipped code.
#
# Usage: build-relay-payload.sh <out-dir>          # e.g. relay-app/desktop/src-tauri/payload
set -euo pipefail
OUT="${1:?usage: build-relay-payload.sh <out-dir>}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

command -v npm >/dev/null || { echo "build-relay-payload: npm not found" >&2; exit 2; }
[ -x "$DIR/node_modules/.bin/esbuild" ] || { echo "build-relay-payload: run 'npm ci' first (esbuild needed to transpile the app)" >&2; exit 2; }

OUT="$(mkdir -p "$OUT" && cd "$OUT" && pwd)"
echo "build-relay-payload: assembling into $OUT"
rm -rf "$OUT"/*

# 1. the strict, pre-transpiled, secret-free servable tree (tracked files @HEAD, app/*.jsx -> .js, Babel dropped)
TGZ="$(mktemp -u).tgz"
bash "$DIR/scripts/build-strict-tgz.sh" "$TGZ" >&2
tar -xzf "$TGZ" -C "$OUT"
rm -f "$TGZ"

# 2. prune what a desktop relay never serves (keeps the installer small): native mobile projects, CI, heavy
#    module data / bibles (members fetch those on demand from the main asset host), and dev-only tooling.
rm -rf "$OUT"/android "$OUT"/ios "$OUT"/.github "$OUT"/docs "$OUT"/modules "$OUT"/marketing 2>/dev/null || true
find "$OUT" -name '*.map' -delete 2>/dev/null || true

# 3. a MINIMAL production node_modules — only what gateway.mjs + event-store.mjs actually import.
#    (node:sqlite / crypto / http / etc. are Node built-ins — nothing to install for those.)
STAGE="$(mktemp -d)"
cat > "$STAGE/package.json" <<'JSON'
{
  "name": "trinityone-relay-runtime",
  "private": true,
  "description": "Exact runtime deps the gateway imports — kept minimal so the desktop installer stays small.",
  "dependencies": {
    "ws": "^8.21.0",
    "nostr-tools": "^2.23.5",
    "web-push": "^3.6.7"
  }
}
JSON
( cd "$STAGE" && npm install --omit=dev --no-audit --no-fund --silent )
rm -rf "$OUT/node_modules"
mv "$STAGE/node_modules" "$OUT/node_modules"
cp "$STAGE/package.json" "$OUT/package.json"    # a lean manifest so `node` resolves the deps
rm -rf "$STAGE"

# 4. stamp the build so the running relay reports its version (control panel "update available?" check)
if [ -z "${PAYLOAD_SKIP_STAMP:-}" ]; then
  { git -C "$DIR" rev-parse HEAD; git -C "$DIR" show -s --format=%cI HEAD; } > "$OUT/version.txt" 2>/dev/null || true
fi

echo "build-relay-payload: done — $(du -sh "$OUT" | cut -f1) in $OUT"
echo "  entry: node $OUT/scripts/gateway.mjs <port>   (set TRINITY_DATA_DIR to a writable dir)"
