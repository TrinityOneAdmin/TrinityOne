#!/usr/bin/env bash
# One-command release for TrinityOne: bump the service-worker cache, deploy the web app to
# Cloudflare Pages (production), rebuild the Android APK, and restart the local gateway.
# Run it AFTER committing your code changes — the web build ships committed files only, so the
# script refuses a dirty tree (this is exactly what causes "I deployed but nothing changed").
#
#   scripts/release.sh            # web + apk (default)
#   scripts/release.sh --web      # web only (skip the multi-minute APK build)
#   scripts/release.sh --apk      # apk only
#   scripts/release.sh --no-gw    # don't restart the local dev gateway
#   scripts/release.sh --dry      # show every step without committing / deploying / building
set -euo pipefail
cd "$(dirname "$0")/.."

DO_WEB=1; DO_APK=1; DO_GW=1; DRY=0
[[ "$*" == *--no-gw* ]] && DO_GW=0
[[ "$*" == *--dry*  ]] && DRY=1
# a lone platform flag turns the other off; with neither, do both
if [[ "$*" == *--web* && "$*" != *--apk* ]]; then DO_APK=0; fi
if [[ "$*" == *--apk* && "$*" != *--web* ]]; then DO_WEB=0; fi

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
run() { if [[ $DRY == 1 ]]; then printf '   [dry] %s\n' "$*"; else eval "$*"; fi; }

# 1. refuse a dirty tree (other than sw.js, which we're about to bump). build-pages.sh deploys
#    `git archive HEAD`, so any uncommitted *tracked* edit would silently NOT ship. Untracked
#    files (??) are ignored — they're never deployed anyway.
dirty=$(git status --porcelain | grep -vE '^\?\?' | grep -vE '^.M? ?sw\.js$' || true)
if [[ -n "$dirty" ]]; then
  echo "✖ Uncommitted tracked changes — commit them first (the web build deploys HEAD only):" >&2
  echo "$dirty" >&2
  exit 1
fi

# 2. bump the service-worker cache version so installed PWAs refresh the shell
cur=$(grep -oP "trinity-shell-v\K[0-9]+" sw.js | head -1)
next=$((cur + 1))
say "service-worker cache v$cur → v$next"
run "sed -i 's/trinity-shell-v$cur/trinity-shell-v$next/' sw.js"
run "git add sw.js && git commit -q -m 'Release: sw cache v$cur -> v$next'"

# 2.5. enrich the module catalog: sha256 + http mirrors + Blossom servers + (best-effort) magnet URIs.
# Must happen before the web build, since build-pages.sh deploys via `git archive HEAD` — the fresh
# catalog.json + version bump only ship if committed first. See reference/proposal-blossom.md.
say "enriching module catalog (sha256 + mirrors + Blossom + torrents)"
run "node scripts/build-catalog.mjs"
run "bash scripts/build-torrents.sh"   # warn-and-skip if mktorrent isn't installed
if ! git diff --quiet -- catalog.json; then
  run "git add catalog.json && git commit -q -m 'Release: refresh module catalog'"
fi

# 3. web → Cloudflare Pages (production)
if [[ $DO_WEB == 1 ]]; then
  say "building + deploying web to production"
  run "bash scripts/build-pages.sh"
  run "npx wrangler pages deploy pages-dist --project-name trinityone --branch production --commit-dirty=true"
fi

# 4. rebuild BOTH Android APKs (member + steward) and stage them for download.
#    versionName lives in android/app/build.gradle (gitignored = disk-only); set it by hand when you
#    cut a new pilot build (0.9.0 -> 0.9.1). versionCode (the integer Android compares for updates) is
#    bumped automatically here so every build supersedes the last.
if [[ $DO_APK == 1 ]]; then
  run "source scripts/android-env.sh"
  vc=$(grep -oP 'versionCode \K[0-9]+' android/app/build.gradle)
  nvc=$((vc + 1))
  vn=$(grep -oP 'versionName "\K[^"]+' android/app/build.gradle)
  say "Android build $vn (versionCode $vc → $nvc)"
  run "sed -i 's/versionCode $vc/versionCode $nvc/' android/app/build.gradle"
  # member APK — sync-web.sh populates www/ AND runs 'npx cap sync' (never skip it: a bare gradle
  # build packages the LAST-synced assets, which silently ships stale web code).
  say "member APK"
  run "bash scripts/sync-web.sh"
  run "( cd android && ./gradlew assembleDebug -q )"
  run "cp android/app/build/outputs/apk/debug/app-debug.apk trinityone.apk"
  # steward APK — own app id + icon; build-steward-apk.sh does its own sync + cap copy and restores
  # the member project on exit.
  say "steward APK"
  run "bash scripts/build-steward-apk.sh"
  # refresh the self-serve index the gateway serves at /apks.html
  run "bash scripts/build-apk-index.sh"
  [[ $DRY == 0 ]] && say "APKs → trinityone.apk ($(du -h trinityone.apk | cut -f1)) + trinityone-steward.apk ($(du -h trinityone-steward.apk | cut -f1))"
fi

# 5. restart the local dev gateway so it serves the fresh APK + any gateway.mjs change
if [[ $DO_GW == 1 ]]; then
  say "restarting the local gateway"
  run "systemctl --user restart trinity-gateway"
fi

# 6. publish the catalog as a signed kind:30078 event so the module list rides on Nostr too —
# members fetch it from any reachable relay, not just trinityone.church. Release host only; if the
# catalog secret isn't on this box (dev / a relay box) we skip silently. See reference/proposal-blossom.md.
if [[ -f relay/catalog-key.json && $DO_WEB == 1 ]]; then
  say "publishing signed module catalog over Nostr"
  run "node scripts/publish-catalog.mjs"
fi

if [[ $DRY == 1 ]]; then
  say "release complete (dry run — nothing changed)"
  echo "   (re-run without --dry to apply)"
else
  say "release complete"
  [[ $DO_WEB == 1 ]] && echo "   live: https://trinityone.pages.dev"
fi
exit 0
