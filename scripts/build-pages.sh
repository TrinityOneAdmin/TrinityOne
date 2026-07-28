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
#
# AUDIT-2026-07-28 F4. `docs` was never in this list and `rm -f "$OUT"/*.md` matched the ROOT ONLY, so the
# last build published 27 documents — the whole docs/ tree plus relay/deploy/DEPLOY.md. (`reference` was
# removed, which is exactly why nobody noticed docs wasn't.) Two changes, because a hand-maintained list of
# directories is what failed: the removals now mirror the classes the gateway denies, and the sweep below
# is RECURSIVE and ABORTS rather than trusting that the list stayed complete.
rm -rf "$OUT"/scripts "$OUT"/src "$OUT"/reference "$OUT"/docs "$OUT"/.github "$OUT"/relay-app "$OUT"/android \
       "$OUT"/deploy "$OUT"/ci "$OUT"/relay
rm -f  "$OUT"/package*.json "$OUT"/capacitor.config.* "$OUT"/tsconfig* \
       "$OUT"/.gitignore "$OUT"/.nojekyll "$OUT"/.design-canvas* 2>/dev/null || true
# recursive, and by CLASS — the same set scripts/gateway.mjs refuses to serve. A nested document or config
# file added tomorrow is caught without anyone remembering to edit the list above.
find "$OUT" -type f \( -name '*.md' -o -name '*.service' -o -name '*.yml' -o -name '*.yaml' \
     -o -name '*.toml' -o -name '*.rs' -o -name '*.lock' \) -delete

# ── Pre-transpile JSX -> JS so the APP shells (index.html, steward.html) need NO runtime Babel and no
# injected inline scripts — that's what lets us serve them a strict CSP. We keep the .jsx files too,
# because the marketing/help/preview pages (welcome.html, "help.html", landing-app-today.html)
# legitimately still load .jsx (+ runtime Babel, or plain like help-data.jsx); those keep a loose CSP.
echo "transpiling JSX -> JS for the Pages app shells…"
for f in "$OUT"/app/*.jsx; do
  [ -e "$f" ] || continue
  base="$(basename "$f" .jsx)"
  ./node_modules/.bin/esbuild "$f" --jsx=transform --log-level=error --outfile="$OUT/app/$base.js"
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
/app/*.jsx
  Content-Type: text/javascript; charset=utf-8
HDR

# Root → homepage. The marketing landing is welcome.html; serve it AT / as a 200 rewrite (clean URL, not a
# redirect). Keeping this in the deploy means the root never depends on an external Cloudflare dashboard rule —
# so renaming the homepage can't silently 404 it. (This Pages deploy is marketing-only; the app lives on a8.)
cat > "$OUT/_redirects" <<'RDR'
/    /welcome.html    200
RDR

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
# …and never publish anything that describes the box rather than serving it. This is the gate, not the
# removal list above: the removal list is what silently went stale and put 27 internal documents on a
# public CDN. A build that would leak now FAILS instead. AUDIT-2026-07-28 F4.
LEAK=$(find "$OUT" \( -type d \( -name docs -o -name reference -o -name deploy -o -name ci -o -name scripts -o -name src \) \) \
        -o \( -type f \( -name '*.md' -o -name '*.service' -o -name '*.yml' -o -name '*.yaml' -o -name '*.toml' -o -name '*.rs' \) \) )
if [ -n "$LEAK" ]; then
  echo "ABORT: internal files would be published to the CDN:" >&2; echo "$LEAK" >&2
  echo "  Add them to the removal step above, or stop tracking them. Do not deploy this build." >&2; exit 1
fi
BIG=$(find "$OUT" -type f -size +25M || true)
if [ -n "$BIG" ]; then echo "ABORT: file(s) over Cloudflare's 25 MiB limit:" >&2; echo "$BIG" >&2; exit 1; fi

echo "Built $OUT/ ($(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l) files)"
echo "Deploy:  npx wrangler pages deploy $OUT --project-name trinityone"
