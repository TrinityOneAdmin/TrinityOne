#!/usr/bin/env bash
# TrinityOne relay self-update — run as ROOT by the trinityone-update.path/.service units when the relay
# drops relay/.update-request (the "Update now" button in the control dashboard writes that flag; the
# sandboxed relay can only write under relay/, so the privileged work happens here instead).
#
# Pulls a fresh code bundle from this box's origin, swaps it in (preserving relay/ secrets + data), and
# restarts — with a code backup + health-check + automatic rollback if the new build doesn't come up.
set -uo pipefail
DIR="${TRINITYONE_DIR:-/opt/trinityone}"
SVC="${TRINITYONE_SVC:-trinityone-relay}"
PORT="${TRINITYONE_PORT:-8000}"
SVC_USER="${TRINITYONE_USER:-trinityone}"
FLAG="$DIR/relay/.update-request"
LOG="$DIR/relay/update.log"
log() { printf '%s  %s\n' "$(date -Is)" "$*" | tee -a "$LOG" >&2; }
# RELAY-UX-2026-07-20 H2/H7: a persisted outcome. The dashboard could only report success if the browser
# happened to be watching the exact moment the version changed — reload the page, close the app, or take
# longer than its 2-minute poll and the operator was told nothing. A FAILED update reported nothing at
# all, ever: the reason existed only in this log, reachable only by terminal, on a product whose whole
# promise is that you do not need one. Now every exit path records why, and /update serves it back.
STATUS="$DIR/relay/update-status.json"
status() {   # status <state> <reason>
  printf '{"state":"%s","reason":"%s","at":%s,"from":"%s","to":"%s"}\n' \
    "$1" "$(printf '%s' "${2:-}" | sed 's/[\\"]/ /g' | tr -d '\n' | cut -c1-300)" "$(date +%s)" "${CUR_SHA:-}" "${NEW_SHA:-}" > "$STATUS" 2>/dev/null || true
}
fail() { log "$1"; status failed "$1"; exit 1; }

rm -f "$FLAG"   # consume the flag first so the path-unit doesn't immediately re-trigger
ORIGIN="$(tr -d '[:space:]' < "$DIR/relay/origin" 2>/dev/null || true)"
[ -n "$ORIGIN" ] || { fail "no update origin is configured for this relay"; }

CUR_SHA="$(sed -n 1p "$DIR/version.txt" 2>/dev/null | cut -c1-7)"
status running "downloading"
log "update requested — pulling from $ORIGIN"
TARBALL="$(mktemp)"; SIGFILE="$(mktemp)"; trap 'rm -f "$TARBALL" "$SIGFILE"' EXIT
curl -fsSL "$ORIGIN/relay-app/bundle.tgz" -o "$TARBALL" || { fail "could not download the update from $ORIGIN"; }

# ── verify the bundle's authenticity BEFORE touching the installed code ────────────────────────
# The bundle is signed on the release host with the Ed25519 release SECRET; we verify the detached
# signature against the baked-in release PUBLIC key (ships in the bundle, committed to the repo).
# This stops a compromised origin/DNS/TLS pushing a malicious bundle. Any failure here aborts WITHOUT
# swapping or rolling back — nothing has changed yet. (If origin/DNS/TLS is intact this is belt-and-braces.)
PUBKEY="$DIR/relay-app/release-pubkey.pem"
if [ ! -s "$PUBKEY" ]; then
  status failed "this relay has no release key baked in, so the update cannot be verified"
  log "VERIFY ABORT: baked-in release public key missing at $PUBKEY — refusing to apply an unverifiable bundle"
  exit 1
fi
command -v openssl >/dev/null 2>&1 || { fail "openssl is missing, so the update signature cannot be checked"; }
curl -fsSL "$ORIGIN/relay-app/bundle.sig" -o "$SIGFILE" || { fail "could not download the update signature from $ORIGIN"; }
[ -s "$SIGFILE" ] || { fail "the update signature was empty"; }
if openssl pkeyutl -verify -pubin -inkey "$PUBKEY" -rawin -in "$TARBALL" -sigfile "$SIGFILE" >/dev/null 2>&1; then
  log "bundle signature verified against the baked-in release key"
else
  status failed "the update was not signed by the real release key — refusing it (the source may be compromised)"
  log "VERIFY ABORT: bundle signature did NOT verify against the release key — refusing to apply (origin may be compromised)"
  exit 1
fi

# ── anti-rollback: refuse a validly-signed but OLDER bundle ────────────────────────────────────
# SECURITY-AUDIT-2026-07-18 M2: the signature proves authenticity, not freshness. A compromised origin/DNS/TLS
# could serve a previously-released (still validly signed) bundle to roll the fleet back onto a since-patched
# vuln (e.g. the pre-2026-07-13 world-readable roster). version.txt line 2 is the build's git commit ISO date
# (stamped by build-relay-payload.sh); require the incoming build to be no older than the installed one.
NEW_STAMP="$( { tar -xzOf "$TARBALL" version.txt 2>/dev/null || tar -xzOf "$TARBALL" ./version.txt 2>/dev/null; } | sed -n 2p )"
CUR_STAMP="$(sed -n 2p "$DIR/version.txt" 2>/dev/null || true)"
NEW_E="$(date -d "$NEW_STAMP" +%s 2>/dev/null || echo 0)"
CUR_E="$(date -d "$CUR_STAMP" +%s 2>/dev/null || echo 0)"
if [ "$NEW_E" -gt 0 ] && [ "$CUR_E" -gt 0 ]; then
  if [ "$NEW_E" -lt "$CUR_E" ]; then
    status failed "the offered build ($NEW_STAMP) is older than the one installed ($CUR_STAMP) — refusing to go backwards"
    log "VERIFY ABORT: incoming build ($NEW_STAMP) is OLDER than installed ($CUR_STAMP) — refusing downgrade (anti-rollback)"
    exit 1
  fi
  log "freshness ok: incoming $NEW_STAMP >= installed $CUR_STAMP"
else
  log "freshness check skipped (no comparable version stamp) — proceeding on signature alone (first update / unstamped build)"
fi

# back up the current CODE (not relay/ data — that's preserved in place) so a bad build can roll back
BACKUP="$DIR/relay/.code-backup.tgz"
tar -czf "$BACKUP" -C "$DIR" --exclude='./relay' --exclude='./node_modules' . 2>/dev/null || true

# swap in the new code; --exclude keeps this box's relay/ secrets + data untouched.
# SECURITY-AUDIT-2026-07-06 M10: --no-same-owner so the archive can't set arbitrary uid/gid on extracted
# files (extract as root → files owned by root, the intended state; see the chown note below).
tar -xzf "$TARBALL" -C "$DIR" --no-same-owner --exclude='relay/*' || { log "unpack failed"; exit 1; }

# ── RECONCILE: a release that REMOVES a file must remove it here too. AUDIT-2026-07-29 S2 ──────────────────
# The unpack above overlays and deletes NOTHING, so every relay served the union of every bundle it had ever
# installed. Verified on a8 the day this was written: /vendor/babel.min.js and /app/app.jsx both returned 200
# although the release it had just installed removes both. Three consequences: a file withdrawn for a SECURITY
# reason stays reachable (this is why the internal documents kept being served after the 07-28 fix — that fix
# stopped them shipping, and only the static denylist stopped them being served); you cannot tell what a relay
# serves by reading the current release; and it accumulates silently with nothing reporting it.
#
# Deliberately SELF-LIMITING. This deletes only files THIS UPDATER INSTALLED ON A PREVIOUS RUN and which the
# new bundle no longer contains — never an operator's file, never anything created at runtime, never anything
# it has not seen itself put there. A blanket "remove whatever is not in the bundle" would be shorter and
# would eventually delete something nobody expected, on a box we cannot log in to.
#
# First run after this ships: MANIFEST does not exist, so nothing is deleted and the manifest is written.
# From the next update onwards it converges. Leftovers installed before manifests existed are NOT cleaned up
# by this — see the explicit sweep below for the classes that must never be present at all.
MANIFEST="$DIR/relay/installed-files.txt"
NEWLIST="$(mktemp)"; trap 'rm -f "$TARBALL" "$SIGFILE" "$NEWLIST"' EXIT
if tar -tzf "$TARBALL" 2>/dev/null | sed 's#^\./##' | grep -v '/$' | grep -v '^relay/' | sort -u > "$NEWLIST"; then
  if [ -s "$MANIFEST" ]; then
    removed=0
    # in the OLD manifest and not in the new bundle → this release withdrew it
    while IFS= read -r rel; do
      case "$rel" in ''|relay/*|node_modules/*|*..*) continue;; esac
      [ -f "$DIR/$rel" ] || continue
      rm -f "$DIR/$rel" && removed=$((removed+1))
    done < <(comm -23 "$MANIFEST" "$NEWLIST")
    [ "$removed" -gt 0 ] && log "reconcile: removed $removed file(s) this release no longer ships"
    true   # never let the count-is-zero case become this block's exit status
  else
    log "reconcile: no previous manifest — recording one, nothing removed this time"
  fi
  cp "$NEWLIST" "$MANIFEST" 2>/dev/null || true
else
  log "reconcile: could not list the bundle — skipping (nothing removed)"
fi

# ── and these classes must never be on a relay at all, manifest or no manifest ─────────────────────────────
# Internal documentation and build/deploy descriptors. The bundle stopped carrying them on 2026-07-28, but
# every relay that updated before then still has its copies on disk, and only the static denylist stands
# between them and the world. Nothing under these paths is executed or served by a running relay, so removing
# them cannot break one. relay/ and node_modules/ are excluded: the first is the operator's data, the second
# is not ours to prune.
# Only *.md by extension, and only OUR OWN directories by name. An earlier draft also swept *.yml/*.toml/*.rs
# anywhere under the install — which would have deleted a self-hoster's own docker-compose.yml sitting beside
# the code. Those file types only ever appeared inside ci/ and relay-app/desktop/, which the directory list
# below removes wholesale, so the extension sweep bought nothing and risked someone else's file.
swept=0
while IFS= read -r f; do rm -f "$f" && swept=$((swept+1)); done < <(
  find "$DIR" -path "$DIR/relay" -prune -o -path "$DIR/node_modules" -prune -o -type f -name '*.md' -print 2>/dev/null)
for d in docs reference deploy ci relay-app/desktop; do
  [ -d "$DIR/$d" ] && { rm -rf "${DIR:?}/$d" && swept=$((swept+1)); }
done
[ "$swept" -gt 0 ] && log "swept $swept internal doc/config path(s) that a relay must not hold"

# ── ARCHITECTURE-AUDIT-2026-07-30 A1: leftovers from BEFORE manifests existed ──────────────────────────────
# The manifest reconcile above can only remove what a PREVIOUS RUN recorded installing, and the manifest is
# seeded from the current bundle. So a file installed before manifests existed and absent from the bundle now
# can never appear in any manifest, and `comm -23` can never emit it. Those files are permanent.
#
# Not a theory. Predicted before a8 took an update on 2026-07-30 that this would hold, then measured after it
# came back up — eight files deleted from the repo, still served, unchanged across a full update cycle:
#   app/screens-onboarding.jsx  landing-app-today.html  stew-finance.jsx  welcome-simple.html
#   vendor/react.development.js  vendor/react-dom.development.js  vendor/steward-finance.js
#   welcome-app-today.png
# Nothing dangerous in those eight — withdrawn app source and two React dev builds — but the NEXT file
# withdrawn for a security reason behaves identically, and the *.md sweep above cannot see any of it.
#
# SCOPED HARD, because this deletes files on boxes nobody can log into:
#   • only inside directories the PROJECT owns outright. Never the install root (a self-hoster's own
#     docker-compose.yml lives there — the reason the earlier extension sweep was narrowed), never relay/,
#     never node_modules/.
#   • NOT modules/. Bible and lexicon packs are downloaded on demand, so a relay legitimately holds packs that
#     were never in any bundle. Sweeping there would delete a church's own downloads.
#   • a sanity floor on the bundle listing: if it looks implausibly short, something went wrong reading the
#     tarball and the correct move is to delete NOTHING rather than to conclude the release ships nothing.
if [ "$(wc -l < "$NEWLIST" 2>/dev/null || echo 0)" -gt 100 ]; then
  stale=0
  for d in app vendor src scripts icons assets; do
    [ -d "$DIR/$d" ] || continue
    while IFS= read -r f; do
      rel="${f#"$DIR"/}"
      case "$rel" in ''|relay/*|node_modules/*|*..*) continue;; esac
      grep -qxF -- "$rel" "$NEWLIST" || { rm -f "$f" && stale=$((stale+1)); }
    done < <(find "$DIR/$d" -type f 2>/dev/null)
  done
  [ "$stale" -gt 0 ] && log "removed $stale file(s) this release does not ship (pre-manifest leftovers)"
else
  log "bundle listing too short to trust — skipping the leftover sweep, nothing removed"
fi
true   # a zero count is a normal outcome, not a failure — do not leave it as the exit status
# ── end reconcile+sweep ── (scripts/relay-update-reconcile.test.mjs lifts exactly this block)
# also pull the latest APK(s) so the in-app auto-update DOWNLOAD stays in lockstep with the new web + manifest.
# (Previously a separate, easily-forgotten "Fetch latest APK" dashboard step → manifest said vN but the APK file
#  lagged at vN-1, so members got no update or a stale one. One .update-request now deploys everything.)
APKDIR="$DIR/relay/apks"; mkdir -p "$APKDIR"
for f in trinityone.apk trinityone-steward.apk; do
  if curl -fsSL "$ORIGIN/$f" -o "$APKDIR/$f.part" 2>/dev/null && [ "$(stat -c%s "$APKDIR/$f.part" 2>/dev/null || echo 0)" -gt 1000000 ]; then
    mv "$APKDIR/$f.part" "$APKDIR/$f"; log "fetched APK $f ($(stat -c%s "$APKDIR/$f") bytes)"
  else rm -f "$APKDIR/$f.part"; log "APK fetch skipped for $f (not on origin or <1MB)"; fi
done
# SECURITY-AUDIT-2026-07-06 H3: --ignore-scripts so a hijacked dependency's install/postinstall can't run
# arbitrary code AS ROOT on every relay in the fleet. (Kept as `npm install` rather than `npm ci` on purpose:
# ci wipes node_modules first, so a transient failure on a box we can't SSH into would leave the relay unable
# to start with no node_modules in the code-backup to roll back to. Lockfile-pinned installs are a follow-up
# that needs a safe test window / bundled node_modules.)
( cd "$DIR" && npm install --ignore-scripts --no-audit --no-fund --no-save ws web-push nostr-tools >/dev/null 2>&1 ) || log "npm install warned (continuing)"
# SECURITY-AUDIT-2026-07-06 H4: the unprivileged service user must NOT own the root-run update script or the
# release-signing trust anchor — owning them, a compromised relay process could rewrite the script or swap the
# pubkey and hijack the whole fleet's next signed update. Only relay/ needs to be service-writable (the systemd
# unit's ReadWritePaths=$DIR/relay already confines the relay's writes there); keep code + scripts + pubkey
# root-owned (world-readable, so the service still reads them).
chown -R "$SVC_USER:$SVC_USER" "$DIR/relay"
chown -R root:root "$DIR/scripts" "$DIR/relay-app/release-pubkey.pem" 2>/dev/null || true
chmod 0644 "$DIR/relay-app/release-pubkey.pem" 2>/dev/null || true

log "restarting $SVC"
systemctl restart "$SVC"

ok=0
for _ in $(seq 1 15); do
  sleep 2
  if curl -fsS "http://localhost:$PORT/status" >/dev/null 2>&1; then ok=1; break; fi
done

if [ "$ok" = 1 ]; then
  log "update complete — relay healthy on :$PORT"
  status ok ""
  rm -f "$BACKUP"
else
  log "new build did not come up — rolling back"
  tar -xzf "$BACKUP" -C "$DIR" --no-same-owner 2>/dev/null
  chown -R "$SVC_USER:$SVC_USER" "$DIR/relay"
  chown -R root:root "$DIR/scripts" "$DIR/relay-app/release-pubkey.pem" 2>/dev/null || true
  systemctl restart "$SVC"
  status rolledback "the new build did not start, so the previous one was put back"
  log "rolled back to the previous build"
  exit 1
fi
