#!/usr/bin/env bash
# Assemble a clean static deploy dir (pages-dist/) for Cloudflare Pages.
# Built from GIT-TRACKED files only, so gitignored cruft (www/, *.apk, relay/ secrets, node_modules)
# is naturally excluded. Then drop server/dev files that are tracked but not part of the web front-end.
# (The 27MB APK exceeds Cloudflare's 25 MiB/file limit, so it's served from the gateway instead.)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=pages-dist
rm -rf "$OUT"; mkdir -p "$OUT"

# committed files only — deploy what's in HEAD (commit your changes first)
git archive --format=tar HEAD | tar -x -C "$OUT"

# remove tracked-but-not-needed: server code, engine sources, docs, build config, admin tooling
rm -rf "$OUT"/scripts "$OUT"/src "$OUT"/reference "$OUT"/.github "$OUT"/relay-app "$OUT"/android
rm -f  "$OUT"/*.md "$OUT"/package*.json "$OUT"/capacitor.config.* "$OUT"/tsconfig* \
       "$OUT"/.gitignore "$OUT"/.nojekyll "$OUT"/.design-canvas* 2>/dev/null || true

# safety: never ship secrets, and nothing over Cloudflare's 25 MiB/file cap
if find "$OUT" \( -name 'admin.json' -o -name 'vapid.json' -o -name 'church.json' -o -name 'push-subs.json' -o -name 'relay-db.json' \) | grep -q .; then
  echo "ABORT: a secret file slipped into $OUT" >&2; exit 1
fi
BIG=$(find "$OUT" -type f -size +25M || true)
if [ -n "$BIG" ]; then echo "ABORT: file(s) over Cloudflare's 25 MiB limit:" >&2; echo "$BIG" >&2; exit 1; fi

echo "Built $OUT/ ($(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l) files)"
echo "Deploy:  npx wrangler pages deploy $OUT --project-name trinityone"
