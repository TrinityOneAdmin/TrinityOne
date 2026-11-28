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
#
# NOT DONE HERE: the RELAY release. That is a `relay-v*` tag (CI builds the Suite installers and creates the
# GitHub Release) followed by `scripts/publish-relay-bundle.sh <tag>` on this box, which signs the server-box
# bundle with relay/release-key.pem and attaches it to that Release — the key never goes to CI. See
# docs/ops/RELEASES.md, "Cutting a RELAY release".
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

# 1a. THE MEMBER MANIFEST must be in its member form BEFORE anything is bumped or committed. A Console build killed hard
#     (no trap) leaves the "Open with TrinityOne" filter stripped out of it, and a member APK built from that would ship
#     without it. Refusing here leaves nothing half-done; the message says what to run (restore).
if [[ $DO_APK == 1 ]]; then
  bash scripts/manifest-member-only.sh check || exit 1
fi

# 1b. THE GATE. SECURITY-AUDIT-2026-07-20 H1/H2: this script rebuilt no vendor bundle and ran no test, while
#     BOTH packaging paths consume vendor/ verbatim (sync-web.sh copies it; build-pages.sh and
#     build-strict-tgz.sh `git archive` it). So "did I rebuild the bundle?" was a human step with no
#     checkpoint — and it failed: vendor/finance-ledger.js shipped 3 commits stale, sending unbranded
#     financial statements to churches. `npm test` now includes vendor-freshness.test.mjs, which reproduces
#     every bundle from source, so this one command catches both a stale bundle and a broken build script
#     (build-steward.sh could not run at all for an unknown length of time).
if [[ $DRY != 1 ]]; then
  say "running the test suite (privacy gates, ledger, recovery, vendor freshness)"
  if ! npm test; then
    echo "✖ Tests failed — refusing to release. Nothing has been deployed." >&2
    exit 1
  fi
fi

# 2. bump the service-worker cache version so installed PWAs refresh the shell
cur=$(grep -oP "trinity-shell-v\K[0-9]+" sw.js | head -1)
next=$((cur + 1))
say "service-worker cache v$cur → v$next"
run "sed -i 's/trinity-shell-v$cur/trinity-shell-v$next/' sw.js"
run "git add sw.js && git commit -q -m 'Release: sw cache v$cur -> v$next'"

# 4. rebuild ALL THREE Android APKs (member + steward + finance) and stage them for download.
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
  # ⚠ PILOT-DEFERRED: DEBUG-signed on purpose, the same owner's call that governs the steward APK
  # (see scripts/build-steward-apk.sh, "PILOT-DEFERRED"). The steward build was corrected when the
  # slip was caught there; THIS path was missed and went on release-signing the member app —
  # confirmed by the owner on 2026-09-07 ("we should be debug only still") after a release had
  # already produced a stable-signed trinityone.apk. That APK was replaced with a debug build by hand.
  #
  # Why it matters, and it is not bookkeeping: a stable-signed APK cannot be installed over a
  # debug-signed one and vice versa, so mixing the two mid-pilot strands testers on whichever they
  # installed first — they must uninstall to move, which destroys the identity and church membership
  # on that device. It also spends the real signing key on pilot builds before go-live.
  #
  # AT GO-LIVE: swap the two lines below back (and the pair in build-steward-apk.sh), because
  # assembleRelease is what gives a non-debuggable build signed with the stable key so that every
  # later update installs cleanly over the last. Keep release.keystore + keystore.properties backed up.
  #     run "( cd android && ./gradlew assembleRelease -q )"
  #     run "cp android/app/build/outputs/apk/release/app-release.apk trinityone.apk"
  # GO-LIVE 2026-10-28 (owner): release-signed + non-debuggable with the stable key, so pilot users install the
  # real build and every later update installs cleanly over the last (debug->release can't update in place).
  run "( cd android && ./gradlew assembleRelease -q )"
  run "cp android/app/build/outputs/apk/release/app-release.apk trinityone.apk"
  # in-app update check: refresh the manifest the member app reads on open (apk-latest.json, served
  # at ASSET_BASE). Old installs compare their versionCode to this and show an "Update available" banner.
  if [[ $DRY == 0 ]]; then
    # one row per app (member / steward / finance) — scripts/apk-release-json.sh, tested on its own
    # written to a temp file and moved into place only on success: a failure never leaves apk-latest.json truncated
    bash scripts/apk-release-json.sh latest "$nvc" "$vn" "$(date +%F)" --out apk-latest.json
    say "update manifest → apk-latest.json (versionCode $nvc)"
    # COMMIT IT. This file is tracked, and leaving it dirty meant the next release refused to run until
    # someone committed it by hand — and, worse, that the manifest describing THIS build sat outside the
    # commit the build came from. It was modified-in-tree for two weeks before anyone noticed.
    run "git add apk-latest.json && git commit -q -m 'Release: apk manifest -> versionCode $nvc'"
  fi
  # steward APK — own app id + icon; build-steward-apk.sh does its own sync + cap copy and restores
  # the member project on exit.
  say "steward APK"
  run "bash scripts/build-steward-apk.sh"
  # finance APK — "TrinityOne Finance" (com.trinityone.finance): the same script with the finance identity and page
  say "finance APK"
  run "bash scripts/build-finance-apk.sh"
  # refresh the self-serve index the gateway serves at /apks.html
  run "bash scripts/build-apk-index.sh"
  # STAGE THEM WHERE THE RELAY ACTUALLY SERVES FROM. /trinityone.apk is served out of relay/apks/ — the one
  # directory the sandboxed relay can write — and nothing in a release ever refreshed it. It was only ever
  # written by the console's "Fetch latest APK" button, so the gateway (and a8, and trinityone.church, which
  # is served by a8 rather than by Pages) kept handing out whatever was last fetched BY HAND. Measured
  # 2026-08-15: repo root and pages-dist held the 10.5 MB build while relay/apks/ still held a 7.5 MB one from
  # 31 July, and the site advertised versionCode 197 with cf-cache-status DYNAMIC — not a cache, a different
  # and older origin. Two other release bugs had to be fixed before this one became visible at all.
  #
  # SIGN FIRST, STAGE AFTER (audit R4, 2026-11-17). The APKs used to be copied into relay/apks/ BEFORE the manifest was
  # signed, so a signing failure left NEW APKs beside the OLD signed manifest there: every box fetching from this origin
  # refused them on a hash mismatch, and a box with "keep the installer up to date" on re-downloaded every six hours.
  # Now nothing is copied into relay/apks/ unless the manifest that describes those bytes has been signed.
  # R-9: signed APK manifest — the gateway verifies this before trusting a downloaded APK.
  # Same key the bundle signature uses (relay/release-key.pem); RELEASE_KEY overrides the path
  # (publish-relay-bundle.sh uses the same var).
  RKEY="${RELEASE_KEY:-$DIR/relay/release-key.pem}"
  if [ -s "$RKEY" ]; then
    # member + steward + finance (the finance entry is what lets a box offer the finance app at all — F10).
    # NOT under --dry (audit A1): a dry run used to rewrite and re-sign the real files. And never in place: the helper
    # builds both in temp files and replaces apk-manifest.json/.sig only if every step worked — a missing APK used to
    # truncate apk-manifest.json to 0 bytes beside the old .sig, and the gateway serves it from this directory.
    if [[ $DRY == 1 ]]; then
      printf '   [dry] bash scripts/apk-release-json.sh sign %s %s %s %s .\n' "$nvc" "$vn" "$(date +%F)" "$RKEY"
    elif ! bash scripts/apk-release-json.sh sign "$nvc" "$vn" "$(date +%F)" "$RKEY" .; then
      echo "✖ APK manifest signing failed — apk-manifest.json / .sig left exactly as they were" >&2
      exit 1
    fi
    [[ $DRY == 0 ]] && say "signed APK manifest → apk-manifest.json + apk-manifest.sig"
  else
    warn "no release key at $RKEY — APK manifest will not be signed (R-9 verification disabled)"
  fi
  run "mkdir -p relay/apks"
  run "cp trinityone.apk relay/apks/trinityone.apk"
  run "cp trinityone-steward.apk relay/apks/trinityone-steward.apk"
  run "cp trinityone-finance.apk relay/apks/trinityone-finance.apk"
  [[ $DRY == 0 ]] && say "APKs → trinityone.apk ($(du -h trinityone.apk | cut -f1)) + trinityone-steward.apk ($(du -h trinityone-steward.apk | cut -f1)) + trinityone-finance.apk ($(du -h trinityone-finance.apk | cut -f1))"
  if [ -s "$RKEY" ]; then
    run "cp apk-manifest.json relay/apks/apk-manifest.json"
    run "cp apk-manifest.sig relay/apks/apk-manifest.sig"
  fi
fi

# 5. web → Cloudflare Pages (production) — AFTER the APKs, deliberately.
#    This used to run BEFORE them, so build-pages.sh copied the PREVIOUS run's trinityone.apk and the
#    previous apk-latest.json into pages-dist: the APK and manifest built moments later only reached the
#    site on the NEXT release. Measured 2026-08-15 — immediately after a release that built versionCode
#    199 (10.5 MB), the site served 197 (31 July, 7.5 MB). The member app's in-app update check reads that
#    manifest, so members were never offered the build we had just made, and anyone downloading from the
#    site got a six-week-old APK. Every release had done this; apk-latest.json being left dirty in the tree
#    afterwards was the visible symptom nobody followed up.
if [[ $DO_WEB == 1 ]]; then
  say "building + deploying web to production"
  run "bash scripts/build-pages.sh"
  run "npx wrangler pages deploy pages-dist --project-name trinityone --branch production --commit-dirty=true"
fi

# 5. restart the local dev gateway so it serves the fresh APK + any gateway.mjs change
if [[ $DO_GW == 1 ]]; then
  say "restarting the local gateway"
  run "systemctl --user restart trinity-gateway"
fi

if [[ $DRY == 1 ]]; then
  say "release complete (dry run — nothing changed)"
  echo "   (re-run without --dry to apply)"
else
  say "release complete"
  [[ $DO_WEB == 1 ]] && echo "   live: https://trinityone.pages.dev"
fi
exit 0
