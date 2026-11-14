#!/usr/bin/env bash
# Publish the SIGNED relay code bundle for a release tag to that tag's GitHub Release — run on the RELEASE HOST,
# the one box holding relay/release-key.pem. The key never leaves this box: the bundle is built and signed here,
# and only the public artefacts go up. Server boxes (relay-app/install.sh, scripts/relay-update.sh) fetch them
# from github.com/TrinityOneAdmin/TrinityOne/releases/…/download/ — see release_bundle_base in those scripts.
#
#   git tag relay-v0.8.1 && git push origin relay-v0.8.1     # CI (relay-desktop.yml) creates the Release + Suite installers
#   scripts/publish-relay-bundle.sh relay-v0.8.1              # then THIS attaches the signed bundle to it
#   scripts/publish-relay-bundle.sh relay-v0.8.1 --dry        # everything but the upload
#   scripts/publish-relay-bundle.sh --list-assets             # the asset names it publishes (tests read this)
#
# WHY THIS EXISTS (2026-09-21). Until today the only signed bundle.tgz + bundle.sig anywhere were served by this
# box's own gateway (ensureSignedBundle → /relay-app/bundle.tgz) — and the installer's default source was
# app.trinityone.church, which has no release key, no source checkout, and answers 404 to both. A church that
# followed the guide got "couldn't download the code bundle" and nothing else. GitHub Releases already carry
# the Suite installers for every relay-v* tag; this adds the server-box artefacts beside them, built from the
# SAME tagged commit, so a tag's Suite and a tag's bundle carry the same code.
#
# WHAT IS UPLOADED — the list `--list-assets` prints, and nothing else:
#   bundle.tgz    the strict web bundle of the tagged commit (scripts/build-strict-tgz.sh, RELEASE_REF=<tag>)
#   bundle.sig    detached Ed25519 signature over bundle.tgz's exact bytes, by relay/release-key.pem
#   bundle.json   a description, NOT a proof: tag, commit, sha256 of bundle.tgz, commit date, published-at.
#                 The relay's control panel reads it to say whether a newer build is out; nothing trusts it.
#   install.sh    relay-app/install.sh as of the tag, so the installer a church downloads matches the bundle
#   suite-js-bundle.tgz  the Suite JS AUTO-UPDATE bundle of the tagged commit (scripts/build-suite-js-bundle.sh):
#                 the JS layer a packaged Suite's gateway runs, WITH node_modules and release-origin, WITHOUT
#                 the node/cloudflared sidecars or the native app. ONLY this script uploads it — CI does not
#                 (relay-desktop.yml; audit be258b42 MEDIUM 3), so nothing can later replace the signed copy.
#   suite-js-bundle.sig  detached Ed25519 signature over suite-js-bundle.tgz's exact bytes, by the SAME key.
#                 The Suite JS auto-update path (PLAN-suite-js-autoupdate-2026-11-09) verifies this against the
#                 read-only release-pubkey.pem before it ever runs a downloaded override.
#
# GUARDS, each of which stops the run before `gh release upload`:
#   • the tag must exist locally AND on GitHub as a Release (CI makes the Release; this never creates one);
#   • the tag on GitHub must name the SAME commit as the local tag (a Suite built from one commit and a bundle
#     from another would be its own trap);
#   • the signature must verify against relay-app/release-pubkey.pem — the key every relay in the fleet checks
#     against. A key on this box that is not that key signs nothing anyone will accept, so nothing goes up.
#
# RELEASE_KEY=<path> overrides where the secret is read from (tests sign with a key of their own).
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$(pwd)"
REPO="TrinityOneAdmin/TrinityOne"
ASSETS="bundle.tgz bundle.sig bundle.json install.sh suite-js-bundle.tgz suite-js-bundle.sig"

say()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

TAG=""; DRY=0
for a in "$@"; do
  case "$a" in
    --list-assets) printf '%s\n' $ASSETS; exit 0;;
    --dry) DRY=1;;
    --*) die "unknown option: $a";;
    *) TAG="$a";;
  esac
done
[ -n "$TAG" ] || die "usage: scripts/publish-relay-bundle.sh <relay-vX.Y.Z> [--dry]"

# ── 1. the tag, here and there ─────────────────────────────────────────────────────────────────────────────
LOCAL_SHA="$(git rev-parse --verify --quiet "refs/tags/$TAG^{commit}" || true)"
[ -n "$LOCAL_SHA" ] || die "there is no tag '$TAG' in this checkout — git fetch --tags, or tag the release first"
command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed — it is how the assets are uploaded"
# --repo on every gh call, so the guard and the upload can never answer "which repository?" two different
# ways (release view/upload would otherwise infer it from the git remote; api would not). gh's stderr is kept
# and shown, so "not logged in" or "no network" reads as what it is, not as "no Release yet".
GH_ERR="$(mktemp)"; trap 'rm -f "$GH_ERR"' EXIT
REMOTE_TAG="$(gh release view "$TAG" --repo "$REPO" --json tagName --jq .tagName 2>"$GH_ERR" || true)"
[ "$REMOTE_TAG" = "$TAG" ] || die "there is no GitHub Release for '$TAG' yet (gh said: $(tr -d '\n' < "$GH_ERR")) — push the tag and let CI (relay-desktop.yml) create it, then run this again"
REF="$(gh api "repos/$REPO/git/ref/tags/$TAG" --jq '.object.type + " " + .object.sha' 2>"$GH_ERR" || true)"
REMOTE_SHA="${REF#* }"
if [ "${REF%% *}" = "tag" ]; then   # an annotated tag: one more hop to the commit it names
  REMOTE_SHA="$(gh api "repos/$REPO/git/tags/$REMOTE_SHA" --jq .object.sha 2>"$GH_ERR" || true)"
fi
[ -n "$REMOTE_SHA" ] || die "could not read which commit '$TAG' names on GitHub (gh said: $(tr -d '\n' < "$GH_ERR"))"
[ "$REMOTE_SHA" = "$LOCAL_SHA" ] || die "'$TAG' names $REMOTE_SHA on GitHub but $LOCAL_SHA here — the Suite CI built and this bundle would disagree; fetch the tag and try again"
ok "$TAG → $LOCAL_SHA, and GitHub agrees"

# ── 1b. the tests ─────────────────────────────────────────────────────────────────────────────────────────
say "running the test suite — a red test stops the release"
if ! npm test; then
  die "tests failed — refusing to sign or upload. Nothing has been published."
fi
ok "tests passed"

# ── 2. the key ─────────────────────────────────────────────────────────────────────────────────────────────
KEY="${RELEASE_KEY:-$DIR/relay/release-key.pem}"
# THE KEY THE TAG SHIPS, NOT THE ONE ON DISK. The fleet checks a bundle against the release-pubkey.pem baked into
# the code it already runs, and the tag's install.sh pins the same key; a working tree that has drifted from the
# tag (a release host usually sits on some other branch) could hold a different pem and this guard would then
# pass a signature every box refuses. The audit of this branch reproduced exactly that. So read the pem AT THE TAG.
[ -s "$KEY" ] || die "no release key at $KEY — this is not the release host, and only the release host can sign a bundle"
command -v openssl >/dev/null 2>&1 || die "openssl is missing"

# ── 3. build, sign, and CHECK before anything leaves this box ──────────────────────────────────────────────
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "$GH_ERR"' EXIT
PUB="$TMP/release-pubkey.at-tag.pem"
git show "$TAG:relay-app/release-pubkey.pem" > "$PUB" 2>/dev/null || die "relay-app/release-pubkey.pem is not in the tree at $TAG — there is nothing the fleet could check this signature against"
[ -s "$PUB" ] || die "relay-app/release-pubkey.pem at $TAG is empty — there is nothing to check the signature against"
say "building the bundle for $TAG"
RELEASE_REF="$TAG" bash "$DIR/scripts/build-strict-tgz.sh" "$TMP/bundle.tgz" "$TAG" || die "the bundle build failed"
[ -s "$TMP/bundle.tgz" ] || die "the build produced no bundle"
openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$TMP/bundle.tgz" -out "$TMP/bundle.sig" || die "signing failed"
if ! openssl pkeyutl -verify -pubin -inkey "$PUB" -rawin -in "$TMP/bundle.tgz" -sigfile "$TMP/bundle.sig" >/dev/null 2>&1; then
  die "the signature does not verify against relay-app/release-pubkey.pem as of $TAG — the key on this box is not the release key the fleet trusts, so nothing was uploaded"
fi
ok "signed, and the signature verifies against the committed public key"
# the key INSIDE the bundle is what relay-update.sh checks later updates against; a difference is a rotation
if ! { tar -xzOf "$TMP/bundle.tgz" ./relay-app/release-pubkey.pem 2>/dev/null || tar -xzOf "$TMP/bundle.tgz" relay-app/release-pubkey.pem 2>/dev/null; } | cmp -s - "$PUB"; then
  die "the bundle carries a different release-pubkey.pem from the one at $TAG — the build did not come from the tag; nothing was uploaded"
fi
git show "$TAG:relay-app/install.sh" > "$TMP/install.sh" || die "could not read relay-app/install.sh at $TAG"
SHA256="$(sha256sum "$TMP/bundle.tgz" | cut -c1-64)"
COMMIT_DATE="$(git show -s --format=%cI "$LOCAL_SHA")"
printf '{"tag":"%s","sha":"%s","sha256":"%s","size":%s,"builtAt":"%s","publishedAt":"%s"}\n' \
  "$TAG" "$LOCAL_SHA" "$SHA256" "$(stat -c%s "$TMP/bundle.tgz")" "$COMMIT_DATE" "$(date -u +%FT%TZ)" > "$TMP/bundle.json"
ok "bundle.tgz $(du -h "$TMP/bundle.tgz" | cut -f1) · sha256 ${SHA256:0:12}… · commit ${LOCAL_SHA:0:7} ($COMMIT_DATE)"

# ── 3b. the Suite JS auto-update bundle — SAME tag, SAME key, self-verified HERE before anything leaves the box
# Mirrors the relay-bundle block above exactly (build from the tag → raw-Ed25519 sign → verify against the
# committed pubkey). This is the ONLY producer of the Release's suite-js-bundle.tgz/.sig — CI no longer attaches
# an unsigned copy that could overwrite this signed pair (audit be258b42 MEDIUM 3). A church's Suite JS auto-update never runs a downloaded override until it verifies
# against the read-only release-pubkey.pem, so an unsigned or wrongly-signed bundle simply isn't applied.
say "building the Suite JS auto-update bundle for $TAG"
RELEASE_REF="$TAG" bash "$DIR/scripts/build-suite-js-bundle.sh" "$TMP/suite-js-bundle.tgz" "$TAG" >&2 || die "the Suite JS bundle build failed"
[ -s "$TMP/suite-js-bundle.tgz" ] || die "the Suite JS bundle build produced nothing"
openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$TMP/suite-js-bundle.tgz" -out "$TMP/suite-js-bundle.sig" || die "signing the Suite JS bundle failed"
if ! openssl pkeyutl -verify -pubin -inkey "$PUB" -rawin -in "$TMP/suite-js-bundle.tgz" -sigfile "$TMP/suite-js-bundle.sig" >/dev/null 2>&1; then
  die "the Suite JS bundle signature does not verify against relay-app/release-pubkey.pem as of $TAG — the key on this box is not the release key the fleet trusts, so nothing was uploaded"
fi
# The Suite runs any newer signed bundle and trusts its gateway.mjs to carry the relay-storage step-1 data-folder
# guard (audit L-6). The SAME verifier the Suite runs refuses a bundle without it; fail here, before upload.
SUITE_IDENT="$(node "$DIR/scripts/verify-suite-bundle.mjs" "$TMP/suite-js-bundle.tgz" "$TMP/suite-js-bundle.sig" "$PUB" 2>&1)" \
  || die "the Suite JS bundle was refused by the Suite's own verifier, so nothing was uploaded: $SUITE_IDENT"
SUITE_SHA256="$(sha256sum "$TMP/suite-js-bundle.tgz" | cut -c1-64)"
ok "suite-js-bundle.tgz $(du -h "$TMP/suite-js-bundle.tgz" | cut -f1) · sha256 ${SUITE_SHA256:0:12}… · signed, and the signature verifies against the committed public key"

# ── 4. upload ──────────────────────────────────────────────────────────────────────────────────────────────
FILES=""; for a in $ASSETS; do FILES="$FILES $TMP/$a"; done
if [ "$DRY" = 1 ]; then
  say "dry run — not uploading:$FILES"
  exit 0
fi
say "uploading to the $TAG release"
# shellcheck disable=SC2086
gh release upload "$TAG" --repo "$REPO" $FILES --clobber || die "the upload failed — nothing to undo, run it again"
for a in $ASSETS; do ok "https://github.com/$REPO/releases/download/$TAG/$a"; done
echo "  latest: https://github.com/$REPO/releases/latest/download/bundle.tgz  (points here once this is the newest non-prerelease)"
exit 0
