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

# 3. web → Cloudflare Pages (production)
if [[ $DO_WEB == 1 ]]; then
  say "building + deploying web to production"
  run "bash scripts/build-pages.sh"
  run "npx wrangler pages deploy pages-dist --project-name trinityone --branch production --commit-dirty=true"
fi

# 4. rebuild the Android APK (web assets → native shell → gradle) and stage it for download
if [[ $DO_APK == 1 ]]; then
  say "rebuilding the Android APK"
  run "source scripts/android-env.sh"
  run "bash scripts/sync-web.sh"
  run "( cd android && ./gradlew assembleDebug -q )"
  run "cp android/app/build/outputs/apk/debug/app-debug.apk trinityone-debug.apk"
  [[ $DRY == 0 ]] && say "APK → trinityone-debug.apk ($(du -h trinityone-debug.apk | cut -f1))"
fi

# 5. restart the local dev gateway so it serves the fresh APK + any gateway.mjs change
if [[ $DO_GW == 1 ]]; then
  say "restarting the local gateway"
  run "systemctl --user restart trinity-gateway"
fi

say "release complete${DRY:+ (dry run — nothing changed)}"
[[ $DO_WEB == 1 && $DRY == 0 ]] && echo "   live: https://trinityone.pages.dev"
[[ $DRY == 1 ]] && echo "   (dry run — re-run without --dry to apply)"
exit 0
