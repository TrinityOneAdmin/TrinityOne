#!/usr/bin/env bash
# Wipe a relay's CHURCH DATA while keeping the relay itself intact.
#
#   scripts/relay-reset.sh <data-dir> [--churches] [--yes]
#
#   <data-dir>   the relay's TRINITY_DATA_DIR (on a8: wherever the service points; on this box: ./relay)
#   --churches   ALSO clear church.json, so the box hosts no church until one registers again
#   --yes        skip the confirmation prompt (for scripted use — think before you use it)
#
# WHY A SCRIPT AND NOT A FEW rm's: the data dir mixes throwaway state with things that are unrecoverable if
# deleted — the relay's own identity key, the admin token, the release signing key. A hand-typed wildcard on a
# live box at the end of a long day is exactly how one of those goes. This names both lists explicitly and
# refuses to run against a relay that is still serving.
#
# WIPING THE RELAY IS ONLY HALF. Every phone still holds its identity, its church membership and its cached
# documents, and will re-publish them the moment it reconnects — so a relay-only wipe leaves you with a
# half-resurrected church that looks like a bug. Clear the apps too:
#     adb -s <SERIAL> shell pm clear com.trinityone.app
#     adb -s <SERIAL> shell pm clear com.trinityone.steward
# and note that clearing the steward app destroys the CHURCH KEY on that device. If that church is meant to
# survive, back it up from the console first (Settings → backup) or you cannot get it back.
set -euo pipefail

DIR="${1:-}"; shift || true
DO_CHURCHES=0; ASSUME_YES=0
for a in "$@"; do
  case "$a" in
    --churches) DO_CHURCHES=1 ;;
    --yes)      ASSUME_YES=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

[ -n "$DIR" ] || { sed -n '2,12p' "$0" | sed 's/^# \?//'; exit 2; }
[ -d "$DIR" ] || { echo "✖ not a directory: $DIR" >&2; exit 2; }
[ -f "$DIR/relay-key.json" ] || { echo "✖ $DIR has no relay-key.json — that does not look like a relay data dir." >&2; exit 2; }

# Refuse while a relay is live ON THIS DATA DIR: SQLite with an open WAL simply recreates what we delete, and
# the running process holds every church in memory and rewrites it on the next flush.
# Checking "is any port busy" was wrong — the release host permanently runs its own relay, which would block
# you from ever resetting a different one. Match the actual data dir of each running gateway instead: its
# TRINITY_DATA_DIR if set, otherwise <cwd>/relay, which is the default in gateway.mjs.
TARGET="$(cd "$DIR" && pwd -P)"
for pid in $(pgrep -f 'gateway\.mjs' 2>/dev/null || true); do
  envdir="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^TRINITY_DATA_DIR=//p' | head -1)"
  if [ -z "$envdir" ]; then
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    [ -n "$cwd" ] && envdir="$cwd/relay"
  fi
  [ -n "$envdir" ] || continue
  running="$(cd "$envdir" 2>/dev/null && pwd -P || true)"
  if [ "$running" = "$TARGET" ]; then
    echo "⚠ a relay (pid $pid) is running on THIS data dir — stop it first, or you will wipe a live database." >&2
    echo "  (systemd:  sudo systemctl stop trinityone-relay)" >&2
    exit 3
  fi
done

# ── the two lists, written out rather than globbed ────────────────────────────────────────────────────────
WIPE=(
  relay.sqlite relay.sqlite-shm relay.sqlite-wal   # every event: members, messages, profiles, keys, care, finance
  relay-db.json                                    # the in-memory church/member index, persisted
  push-subs.json push-prefs.json subscribers.json  # push registrations tied to identities that are going
  sync-cursors.json                                # replication cursors must reset with the data they track
)
KEEP_NOTE=(
  "relay-key.json     the relay's own identity — change it and every client's relay list points at a stranger"
  "admin.json         the control-panel token — delete it and you lock yourself out of the box"
  "release-key.pem    the release signing key — unrecoverable, and updates break for ever without it"
  "catalog-key.json   module catalogue signing"
  "vapid.json         web-push keys"
  "apks/              the APKs this relay serves"
  "relay-names.json   this relay's registered name / pairing"
)

echo "Relay data dir : $DIR"
echo
echo "WILL DELETE:"
for f in "${WIPE[@]}"; do [ -e "$DIR/$f" ] && echo "   - $f" || true; done
[ -d "$DIR/blobs" ] && echo "   - blobs/  ($(find "$DIR/blobs" -type f 2>/dev/null | wc -l) files — sermon media, images)" || true
[ $DO_CHURCHES = 1 ] && [ -f "$DIR/church.json" ] && echo "   - church.json  (the box will host no church until one registers)" || true
echo
echo "WILL KEEP:"
for k in "${KEEP_NOTE[@]}"; do echo "   · $k"; done
[ $DO_CHURCHES = 0 ] && echo "   · church.json      (pass --churches to clear it too)" || true
echo

if [ $ASSUME_YES = 0 ]; then
  read -r -p "Type WIPE to continue: " ans
  [ "$ans" = "WIPE" ] || { echo "aborted."; exit 1; }
fi

# ── a backup first, always. Cheap, and the one thing you cannot do afterwards. ─────────────────────────────
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$DIR/../relay-backup-$STAMP.tgz"
tar -czf "$BACKUP" -C "$DIR" . 2>/dev/null || { echo "✖ backup failed — refusing to wipe." >&2; exit 4; }
echo "✔ backup → $BACKUP  ($(du -h "$BACKUP" | cut -f1))"

for f in "${WIPE[@]}"; do rm -f "$DIR/$f"; done
[ -d "$DIR/blobs" ] && { rm -rf "$DIR/blobs"; mkdir -p "$DIR/blobs"; }
[ $DO_CHURCHES = 1 ] && rm -f "$DIR/church.json" "$DIR/church.json.bak" || true
rm -rf "$DIR/.bundle-cache" 2>/dev/null || true   # regenerates; stale entries would serve the old bundle

echo "✔ wiped."
echo
echo "Next:"
echo "  1. start the relay again        (sudo systemctl start trinityone-relay)"
echo "  2. clear the phones, or they will re-publish the church you just deleted:"
echo "       adb -s <SERIAL> shell pm clear com.trinityone.app"
echo "       adb -s <SERIAL> shell pm clear com.trinityone.steward   # DESTROYS the church key on that device"
echo "  3. check it is empty:  curl -s http://127.0.0.1:8000/status"
