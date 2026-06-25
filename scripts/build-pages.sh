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

# ── Pre-transpile JSX -> JS so the APP shells (index.html, steward.html) need NO runtime Babel and no
# injected inline scripts — that's what lets us serve them a strict CSP. We keep the .jsx files too,
# because the marketing/help/preview pages (welcome.html, "TrinityOne Help.html", landing-app-today.html)
# legitimately still load .jsx (+ runtime Babel, or plain like help-data.jsx); those keep a loose CSP.
echo "transpiling JSX -> JS for the Pages app shells…"
for f in "$OUT"/*.jsx; do
  [ -e "$f" ] || continue
  base="$(basename "$f" .jsx)"
  ./node_modules/.bin/esbuild "$f" --jsx=transform --log-level=error --outfile="$OUT/$base.js"
done
# point ONLY the app shells at the transpiled .js and drop the Babel runtime from them
for html in index.html steward.html; do
  [ -e "$OUT/$html" ] || continue
  sed -i \
    -e '/babel\.min\.js/d' \
    -e 's#<script type="text/babel" src="\([^"]*\)\.jsx">#<script src="\1.js">#g' \
    "$OUT/$html"
done
# the app shells must be fully Babel/JSX-free (else the strict CSP below would break them)
for html in index.html steward.html; do
  [ -e "$OUT/$html" ] || continue
  if grep -qE 'text/babel|babel\.min\.js|src="[^"]*\.jsx"|<script>' "$OUT/$html"; then
    echo "ABORT: $html still has Babel/.jsx/inline-script after transpile" >&2; exit 1
  fi
done

# CSP. Only the APP shells (served at /, /index.html, /steward.html) get a Content-Security-Policy, and
# it's STRICT: no runtime Babel/eval, no inline/injected scripts ('wasm-unsafe-eval' only, for sql.js).
# We deliberately set CSP ONLY on those exact routes (no overlap with /*) so Cloudflare doesn't have to
# merge two CSP headers. The marketing/help/preview pages get no CSP (unchanged) — they still rely on
# runtime Babel + inline scripts — but do get the other hardening headers via /*.
# SECURITY-AUDIT-2026-06-25: M11 follow-up. The marketing HTML was cleaned (M11 commit 88a88cf) and
# the gateway's CSP dropped the Google Fonts allowlist (f4ead6a), but the Pages _headers output here
# still listed fonts.googleapis.com / fonts.gstatic.com — a regression of M11 in the production CDN
# deploy. Strip them: fonts are vendored under vendor/fonts/ now.
STRICT_CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https: wss: ws:; object-src 'none'; base-uri 'self'; frame-src 'self'; frame-ancestors 'self'"
cat > "$OUT/_headers" <<HDR
/
  Content-Security-Policy: $STRICT_CSP
/index.html
  Content-Security-Policy: $STRICT_CSP
/steward.html
  Content-Security-Policy: $STRICT_CSP
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: SAMEORIGIN
/*.jsx
  Content-Type: text/javascript; charset=utf-8
HDR

# Both APKs ship with the site so apks.html's (relative) download links resolve on Pages and the
# marketing CTA can hand Android visitors the app. They're build artifacts (gitignored), copied in
# after the git-archive. Each is only shipped if under Cloudflare's 25 MiB/file cap — otherwise it's
# left to the gateway copy (and apks.html's relative link would 404 on Pages, so keep them under cap).
CF_CAP=26214400
[ -f trinityone-steward.apk ] && [ "$(stat -c%s trinityone-steward.apk)" -lt "$CF_CAP" ] && cp trinityone-steward.apk "$OUT/trinityone-steward.apk"
[ -f trinityone.apk ] && [ "$(stat -c%s trinityone.apk)" -lt "$CF_CAP" ] && cp trinityone.apk "$OUT/trinityone.apk"

# safety: never ship secrets, and nothing over Cloudflare's 25 MiB/file cap
if find "$OUT" \( -name 'admin.json' -o -name 'vapid.json' -o -name 'church.json' -o -name 'push-subs.json' -o -name 'relay-db.json' \) | grep -q .; then
  echo "ABORT: a secret file slipped into $OUT" >&2; exit 1
fi
BIG=$(find "$OUT" -type f -size +25M || true)
if [ -n "$BIG" ]; then echo "ABORT: file(s) over Cloudflare's 25 MiB limit:" >&2; echo "$BIG" >&2; exit 1; fi

echo "Built $OUT/ ($(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l) files)"
echo "Deploy:  npx wrangler pages deploy $OUT --project-name trinityone"
