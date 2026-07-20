#!/usr/bin/env bash
# Build a STRICT, pre-transpiled web bundle (.tgz) for the relay to serve. a8 has NO esbuild at runtime, so
# the JSX→JS transpile happens HERE (the release host, which has esbuild) and ships inside the bundle. Result:
# the web app loads plain <script> tags (no 3 MB @babel/standalone, no per-load in-browser transpile) and the
# gateway can serve a strict CSP with no 'unsafe-eval' — the D1 audit fix.
#
# Usage: build-strict-tgz.sh <output.tgz> [git-ref]
# Same content as `git archive <ref>` except: app/*.jsx -> app/*.js, the app shells load .js (Babel dropped),
# and vendor/babel.min.js is removed. Everything else (relay-app, modules, assets, steward, etc.) is untouched.
#
# RELEASE-2026-07-20 C1: the ref is now an explicit ARGUMENT, defaulting to `main`, and is no longer the
# release host's live HEAD. Building from HEAD meant whatever branch this box happened to have checked out
# got signed with the real release key and installed fleet-wide — which is exactly how a8 ended up running a
# WIP commit from the parked push branch, months of security fixes behind, with nobody able to tell.
set -euo pipefail
OUT="${1:?usage: build-strict-tgz.sh <output.tgz> [git-ref]}"
REF="${2:-main}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ESBUILD="$DIR/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || { echo "build-strict-tgz: esbuild not found at $ESBUILD" >&2; exit 2; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. the exact tracked tree at the RELEASE REF (not the working tree, and not whatever is checked out) —
#    so an in-progress branch or a dirty tree on the release host can never reach the fleet.
git -C "$DIR" rev-parse --verify --quiet "$REF^{commit}" >/dev/null || { echo "build-strict-tgz: release ref '$REF' does not resolve" >&2; exit 3; }
git -C "$DIR" archive --format=tar "$REF" | tar -x -C "$TMP"

# 2. transpile every app JSX -> plain JS, then drop the .jsx source from the bundle
for f in "$TMP"/app/*.jsx; do
  base="$(basename "$f" .jsx)"
  "$ESBUILD" "$f" --jsx=transform --log-level=error --outfile="$TMP/app/$base.js"
  rm -f "$f"
done

# 3. rewrite the app shells: remove the Babel runtime <script>, point script tags at the transpiled .js.
#    Portable, no `sed -i` — BSD sed (macOS CI runner) parses `-i -e` differently from GNU sed and breaks;
#    write to a temp file and move it back so this works identically on Linux + macOS.
for html in index.html steward.html; do
  [ -f "$TMP/$html" ] || continue
  sed \
    -e '/vendor\/babel\.min\.js/d' \
    -e 's#<script type="text/babel" src="\([^"]*\)\.jsx">#<script src="\1.js">#g' \
    "$TMP/$html" > "$TMP/$html.strict" && mv "$TMP/$html.strict" "$TMP/$html"
done

# 4. Babel is no longer loaded by anything → drop it (~3 MB lighter bundle)
rm -f "$TMP/vendor/babel.min.js"

# 5. re-archive (gzip). Byte-identity isn't required across runs — ensureSignedBundle freezes+signs the exact
#    bytes it produces, once per HEAD sha.
tar -czf "$OUT" -C "$TMP" .
echo "build-strict-tgz: wrote $OUT ($(du -h "$OUT" | cut -f1))"
