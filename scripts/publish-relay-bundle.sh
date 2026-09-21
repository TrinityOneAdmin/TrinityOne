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
ASSETS="bundle.tgz bundle.sig bundle.json install.sh"

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
REMOTE_TAG="$(gh release view "$TAG" --json tagName --jq .tagName 2>/dev/null || true)"
[ "$REMOTE_TAG" = "$TAG" ] || die "there is no GitHub Release for '$TAG' yet — push the tag and let CI (relay-desktop.yml) create it, then run this again"
REF="$(gh api "repos/$REPO/git/ref/tags/$TAG" --jq '.object.type + " " + .object.sha' 2>/dev/null || true)"
REMOTE_SHA="${REF#* }"
if [ "${REF%% *}" = "tag" ]; then   # an annotated tag: one more hop to the commit it names
  REMOTE_SHA="$(gh api "repos/$REPO/git/tags/$REMOTE_SHA" --jq .object.sha 2>/dev/null || true)"
fi
[ -n "$REMOTE_SHA" ] || die "could not read which commit '$TAG' names on GitHub"
[ "$REMOTE_SHA" = "$LOCAL_SHA" ] || die "'$TAG' names $REMOTE_SHA on GitHub but $LOCAL_SHA here — the Suite CI built and this bundle would disagree; fetch the tag and try again"
ok "$TAG → $LOCAL_SHA, and GitHub agrees"

# ── 2. the key ─────────────────────────────────────────────────────────────────────────────────────────────
KEY="${RELEASE_KEY:-$DIR/relay/release-key.pem}"
PUB="$DIR/relay-app/release-pubkey.pem"
[ -s "$KEY" ] || die "no release key at $KEY — this is not the release host, and only the release host can sign a bundle"
[ -s "$PUB" ] || die "relay-app/release-pubkey.pem is missing — there is nothing to check the signature against"
command -v openssl >/dev/null 2>&1 || die "openssl is missing"

# ── 3. build, sign, and CHECK before anything leaves this box ──────────────────────────────────────────────
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
say "building the bundle for $TAG"
RELEASE_REF="$TAG" bash "$DIR/scripts/build-strict-tgz.sh" "$TMP/bundle.tgz" "$TAG" || die "the bundle build failed"
[ -s "$TMP/bundle.tgz" ] || die "the build produced no bundle"
openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$TMP/bundle.tgz" -out "$TMP/bundle.sig" || die "signing failed"
if ! openssl pkeyutl -verify -pubin -inkey "$PUB" -rawin -in "$TMP/bundle.tgz" -sigfile "$TMP/bundle.sig" >/dev/null 2>&1; then
  die "the signature does not verify against relay-app/release-pubkey.pem — the key on this box is not the release key the fleet trusts, so nothing was uploaded"
fi
ok "signed, and the signature verifies against the committed public key"
# the key INSIDE the bundle is what relay-update.sh checks later updates against; a difference is a rotation
if ! { tar -xzOf "$TMP/bundle.tgz" ./relay-app/release-pubkey.pem 2>/dev/null || tar -xzOf "$TMP/bundle.tgz" relay-app/release-pubkey.pem 2>/dev/null; } | cmp -s - "$PUB"; then
  warn "the bundle carries a different release-pubkey.pem from this checkout's — a key rotation is shipping in this release"
fi
git show "$TAG:relay-app/install.sh" > "$TMP/install.sh" || die "could not read relay-app/install.sh at $TAG"
SHA256="$(sha256sum "$TMP/bundle.tgz" | cut -c1-64)"
COMMIT_DATE="$(git show -s --format=%cI "$LOCAL_SHA")"
printf '{"tag":"%s","sha":"%s","sha256":"%s","size":%s,"builtAt":"%s","publishedAt":"%s"}\n' \
  "$TAG" "$LOCAL_SHA" "$SHA256" "$(stat -c%s "$TMP/bundle.tgz")" "$COMMIT_DATE" "$(date -u +%FT%TZ)" > "$TMP/bundle.json"
ok "bundle.tgz $(du -h "$TMP/bundle.tgz" | cut -f1) · sha256 ${SHA256:0:12}… · commit ${LOCAL_SHA:0:7} ($COMMIT_DATE)"

# ── 4. upload ──────────────────────────────────────────────────────────────────────────────────────────────
FILES=""; for a in $ASSETS; do FILES="$FILES $TMP/$a"; done
if [ "$DRY" = 1 ]; then
  say "dry run — not uploading:$FILES"
  exit 0
fi
say "uploading to the $TAG release"
# shellcheck disable=SC2086
gh release upload "$TAG" $FILES --clobber || die "the upload failed — nothing to undo, run it again"
for a in $ASSETS; do ok "https://github.com/$REPO/releases/download/$TAG/$a"; done
echo "  latest: https://github.com/$REPO/releases/latest/download/bundle.tgz  (points here once this is the newest non-prerelease)"
exit 0
