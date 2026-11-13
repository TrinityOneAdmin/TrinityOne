#!/usr/bin/env bash
# build-suite-js-bundle.sh — assemble the Suite JS AUTO-UPDATE bundle: the JavaScript layer a packaged Suite's
# gateway runs, WITH its node_modules and the release-origin seed, and WITHOUT the bundled node / cloudflared
# sidecars or the native Tauri app binary.
#
# WHY THIS IS A SEPARATE PRODUCER FROM THE INSTALLER. The OS-signed Suite installer ships three things the JS
# layer cannot self-update: the Tauri native app binary, the bundled node runtime, and cloudflared. Those move
# only when the operator installs a newer Suite. Everything the gateway READS at runtime — the transpiled web
# app, gateway/event-store, relay-app control UI, plus the three pure-JS deps it imports — is exactly this
# bundle, and it is what the Suite JS auto-update path (PLAN/BUILD-suite-js-autoupdate-2026-11-09) downloads,
# verifies against the read-only release key, and runs in place of the shipped payload.
#
# ONE PRODUCER, NO DRIFT. The bundle is build-relay-payload.sh's output, tarred. That script is already the
# single source of the desktop Suite's payload directory, so the auto-update bundle and the shipped payload are
# byte-for-byte the same tree built the same way — they cannot diverge. In particular build-relay-payload.sh is
# the ONLY writer of the two files `git archive` cannot carry:
#   • release-origin  (not a tracked file — generated at build-relay-payload.sh step 5) is LOAD-BEARING: the
#     gateway sets PACKAGED = existsSync(ROOT/release-origin) (gateway.mjs). Without it an unpacked override
#     boots PACKAGED=false and silently self-disables the auto-update path after the first update.
#   • version.txt     carries the packaged ref's sha + commit date (.gitattributes export-subst, re-stamped at
#     build-relay-payload.sh step 4) so /suite-update and the anti-rollback gate can tell which build this is.
#
# Usage: build-suite-js-bundle.sh <out.tgz> [git-ref]   # git-ref also settable as $RELEASE_REF; default `main`
#   The ref is build-relay-payload.sh's ref: the argument, else $RELEASE_REF, else `main` — never the
#   checked-out HEAD, so a dirty tree or an unrelated branch on the release host can never ship (RELEASE C1).
set -euo pipefail
OUT="${1:?usage: build-suite-js-bundle.sh <out.tgz> [git-ref]}"
REF="${2:-${RELEASE_REF:-main}}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# absolute OUT, so the later `tar -C` cannot resolve a relative path against the wrong directory
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT";; esac

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# 1. the exact payload the Suite's gateway runs — strict pre-transpiled tree @REF, the minimal prod
#    node_modules (ws, nostr-tools, web-push), version.txt, and the release-origin seed. SAME machinery as the
#    desktop payload, so the two can never drift.
bash "$DIR/scripts/build-relay-payload.sh" "$STAGE/payload" "$REF" >&2

# 2. [AUDIT FIX #6] a cross-OS JS bundle must carry NO compiled native addon — a *.node baked in here is this
#    host's architecture and would crash on another OS. The three deps are pure JavaScript; this is the
#    belt-and-suspenders guard the P1 test enforces ("node_modules present with NO *.node files").
find "$STAGE/payload" -name '*.node' -delete 2>/dev/null || true

# 3. (nothing to strip for sidecars / native binary — build-relay-payload.sh never adds the bundled node,
#    cloudflared, or the Tauri app binary; those live only inside the OS-signed installer.)

# 4. tar the payload tree. Leading ./ like build-strict-tgz, so unpack is a plain `tar -xzf <tgz>`.
tar -czf "$OUT" -C "$STAGE/payload" .
echo "build-suite-js-bundle: wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "  unpack + run: tar -xzf <tgz> -C <dir> && node <dir>/scripts/gateway.mjs <port>  (set TRINITY_DATA_DIR)"
