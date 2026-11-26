#!/usr/bin/env bash
# The two JSON files a release writes about its APKs, lifted out of scripts/release.sh so they can be run and tested
# without building anything (T1Finance, 2026-11-17). Output goes to stdout; release.sh redirects it.
#
#   apk-release-json.sh latest   <versionCode> <versionName> <date> [--out F] -> apk-latest.json (stdout, or F)
#       what the installed apps read for "Update available" (app/update-check.jsx): one row per app — member
#       (versionCode/url), steward (stewardVersionCode/stewardUrl), finance (financeVersionCode/financeUrl).
#   apk-release-json.sh manifest <versionCode> <versionName> <date> [dir]    -> apk-manifest.json (to be signed)
#       sha256 + version of trinityone.apk, trinityone-steward.apk and trinityone-finance.apk in <dir> (default .).
#       A box (scripts/gateway.mjs fetchApksFromOrigin) refuses any listed APK whose bytes do not match, and treats
#       the finance app as not offered while a manifest does not list it. Every one of the three files must exist:
#       a missing one fails here rather than signing a manifest that omits it.
#   apk-release-json.sh sign     <versionCode> <versionName> <date> <key.pem> [dir]
#       writes <dir>/apk-manifest.json AND its Ed25519 signature <dir>/apk-manifest.sig — what release.sh publishes.
#
# NOTHING IS WRITTEN UNLESS EVERYTHING SUCCEEDED (audit A1, 2026-11-17). `> file` truncates the file before the
# command runs, so a failing step used to leave apk-manifest.json EMPTY beside the old .sig — and the gateway serves
# that file from the repo root, so every box's signature check failed. --out and sign build into temp files in the
# same directory and `mv` them over the real ones only at the end; on any failure the old files are left as they were.
set -euo pipefail
MODE="${1:-}"; VC="${2:-}"; VN="${3:-}"; DATE="${4:-}"
usage() { echo "usage: $0 latest <versionCode> <versionName> <date> [--out file] | manifest <vc> <vn> <date> [dir] | sign <vc> <vn> <date> <key.pem> [dir]" >&2; exit 2; }
# versionName and date go into JSON unescaped: allow only the characters a version / ISO date actually use, so a stray
# quote or space in build.gradle fails here instead of shipping a manifest no app or box can parse.
[[ "$VC" =~ ^[0-9]+$ && "$VN" =~ ^[0-9A-Za-z._+-]+$ && "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || usage
TMPS=()
cleanup() { [ ${#TMPS[@]} -eq 0 ] || rm -f "${TMPS[@]}"; }
trap cleanup EXIT
case "$MODE" in
  latest)
    if [ "${5:-}" = "--out" ]; then
      [ -n "${6:-}" ] || usage
      t="$(mktemp "$(dirname "$6")/.apk-latest.XXXXXX")"; TMPS+=("$t")
      bash "$0" latest "$VC" "$VN" "$DATE" > "$t"
      chmod 644 "$t"
      mv "$t" "$6"
      exit 0
    fi
    printf '{\n  "versionCode": %s,\n  "versionName": "%s",\n  "url": "trinityone.apk",\n  "stewardVersionCode": %s,\n  "stewardUrl": "trinityone-steward.apk",\n  "financeVersionCode": %s,\n  "financeUrl": "trinityone-finance.apk",\n  "date": "%s"\n}\n' "$VC" "$VN" "$VC" "$VC" "$DATE"
    ;;
  manifest)
    D="${5:-.}"
    MEMBER_SHA="$(sha256sum "$D/trinityone.apk" | cut -c1-64)"
    STEWARD_SHA="$(sha256sum "$D/trinityone-steward.apk" | cut -c1-64)"
    FINANCE_SHA="$(sha256sum "$D/trinityone-finance.apk" | cut -c1-64)"
    printf '{"trinityone.apk":{"sha256":"%s","versionCode":%s,"versionName":"%s","date":"%s"},"trinityone-steward.apk":{"sha256":"%s","versionCode":%s,"versionName":"%s","date":"%s"},"trinityone-finance.apk":{"sha256":"%s","versionCode":%s,"versionName":"%s","date":"%s"}}\n' \
      "$MEMBER_SHA" "$VC" "$VN" "$DATE" \
      "$STEWARD_SHA" "$VC" "$VN" "$DATE" \
      "$FINANCE_SHA" "$VC" "$VN" "$DATE"
    ;;
  sign)
    KEY="${5:-}"; D="${6:-.}"
    [ -s "$KEY" ] || { echo "apk-release-json: no release key at '$KEY'" >&2; exit 1; }
    tm="$(mktemp "$D/.apk-manifest.json.XXXXXX")"; ts="$(mktemp "$D/.apk-manifest.sig.XXXXXX")"; TMPS+=("$tm" "$ts")
    bash "$0" manifest "$VC" "$VN" "$DATE" "$D" > "$tm"
    openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$tm" -out "$ts"
    [ -s "$tm" ] && [ -s "$ts" ] || { echo "apk-release-json: empty manifest or signature — nothing replaced" >&2; exit 1; }
    chmod 644 "$tm" "$ts"
    # the signature first, then the manifest: a box reading in between sees the OLD manifest with the NEW signature
    # for an instant (a refused check it retries), never an empty file. Ctrl-C / TERM / HUP are IGNORED across the two
    # moves (audit R1): interrupted between them, the pair would stay mismatched — every box refusing — until the next
    # release. APK_RELEASE_JSON_TEST_BETWEEN_MOVES is a TEST SEAM only (a command run between the moves, so a test can
    # deliver the signal exactly there); release.sh never sets it.
    trap '' INT TERM HUP
    mv "$ts" "$D/apk-manifest.sig"
    if [ -n "${APK_RELEASE_JSON_TEST_BETWEEN_MOVES:-}" ]; then bash -c "$APK_RELEASE_JSON_TEST_BETWEEN_MOVES" || true; fi
    mv "$tm" "$D/apk-manifest.json"
    trap - INT TERM HUP
    ;;
  *) usage ;;
esac
