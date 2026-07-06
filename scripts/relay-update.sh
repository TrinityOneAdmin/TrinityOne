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

rm -f "$FLAG"   # consume the flag first so the path-unit doesn't immediately re-trigger
ORIGIN="$(tr -d '[:space:]' < "$DIR/relay/origin" 2>/dev/null || true)"
[ -n "$ORIGIN" ] || { log "no update origin set — aborting"; exit 1; }

log "update requested — pulling from $ORIGIN"
TARBALL="$(mktemp)"; SIGFILE="$(mktemp)"; trap 'rm -f "$TARBALL" "$SIGFILE"' EXIT
curl -fsSL "$ORIGIN/relay-app/bundle.tgz" -o "$TARBALL" || { log "download failed"; exit 1; }

# ── verify the bundle's authenticity BEFORE touching the installed code ────────────────────────
# The bundle is signed on the release host with the Ed25519 release SECRET; we verify the detached
# signature against the baked-in release PUBLIC key (ships in the bundle, committed to the repo).
# This stops a compromised origin/DNS/TLS pushing a malicious bundle. Any failure here aborts WITHOUT
# swapping or rolling back — nothing has changed yet. (If origin/DNS/TLS is intact this is belt-and-braces.)
PUBKEY="$DIR/relay-app/release-pubkey.pem"
if [ ! -s "$PUBKEY" ]; then
  log "VERIFY ABORT: baked-in release public key missing at $PUBKEY — refusing to apply an unverifiable bundle"
  exit 1
fi
command -v openssl >/dev/null 2>&1 || { log "VERIFY ABORT: openssl not found — cannot verify the bundle signature"; exit 1; }
curl -fsSL "$ORIGIN/relay-app/bundle.sig" -o "$SIGFILE" || { log "VERIFY ABORT: could not download bundle signature from $ORIGIN/relay-app/bundle.sig"; exit 1; }
[ -s "$SIGFILE" ] || { log "VERIFY ABORT: empty signature file"; exit 1; }
if openssl pkeyutl -verify -pubin -inkey "$PUBKEY" -rawin -in "$TARBALL" -sigfile "$SIGFILE" >/dev/null 2>&1; then
  log "bundle signature verified against the baked-in release key"
else
  log "VERIFY ABORT: bundle signature did NOT verify against the release key — refusing to apply (origin may be compromised)"
  exit 1
fi

# back up the current CODE (not relay/ data — that's preserved in place) so a bad build can roll back
BACKUP="$DIR/relay/.code-backup.tgz"
tar -czf "$BACKUP" -C "$DIR" --exclude='./relay' --exclude='./node_modules' . 2>/dev/null || true

# swap in the new code; --exclude keeps this box's relay/ secrets + data untouched.
# SECURITY-AUDIT-2026-07-06 M10: --no-same-owner so the archive can't set arbitrary uid/gid on extracted
# files (extract as root → files owned by root, the intended state; see the chown note below).
tar -xzf "$TARBALL" -C "$DIR" --no-same-owner --exclude='relay/*' || { log "unpack failed"; exit 1; }
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
  rm -f "$BACKUP"
else
  log "new build did not come up — rolling back"
  tar -xzf "$BACKUP" -C "$DIR" --no-same-owner 2>/dev/null
  chown -R "$SVC_USER:$SVC_USER" "$DIR/relay"
  chown -R root:root "$DIR/scripts" "$DIR/relay-app/release-pubkey.pem" 2>/dev/null || true
  systemctl restart "$SVC"
  log "rolled back to the previous build"
  exit 1
fi
