#!/usr/bin/env bash
# Record WHERE THIS SERVER'S RELAY KEEPS ITS DATA, in the one place systemd and the scripts can all read it.
# Run as ROOT by relay-app/install.sh and by scripts/relay-move.sh (relay storage plan step 6, section 2).
#
#   relay-datadir-apply.sh <data-folder> [--unpinned]
#
# Writes /etc/trinityone/relay.env (root-owned, 0644, atomically):
#     TRINITY_DATA_DIR=<folder>             where the relay's data is
#     TRINITY_DATA_DIR_PINNED=1             the gateway never creates this folder and refuses to start on a missing /
#                                           foreign / moved-out one (exit 78) -- the unplugged-drive guard. --unpinned
#                                           omits it: used only by a fresh install, whose folder holds no relay key
#                                           until the relay's first start (a pinned gateway refuses a folder that has
#                                           files but no key).
#     TRINITY_STORAGE_MODE=server           turns the panel's storage card on (gateway: hidden when unset)
#     TRINITY_STORAGE_STATE=<state>/move-state.json   the move journal, root-written, world-readable
# and the systemd drop-ins that cannot expand variables themselves (ReadWritePaths= and PathExists= take literals):
#     trinityone-relay.service.d/50-data-dir.conf   RequiresMountsFor, EnvironmentFile, ReadWritePaths
#     trinityone-update.path.d/50-data-dir.conf     the update flag in the new folder
#     trinityone-move.path.d/50-data-dir.conf       the move / remove-old requests in the new folder
#     trinityone-relay.service.d/10-refused-data-folder.conf   RestartPreventExitStatus=78 (see relay-update.sh)
# then daemon-reload. Drop-ins survive install.sh rewriting the main unit files.
#
# Readers of the folder this records (rule 2): the relay unit (EnvironmentFile=-), relay-update.sh (parses it),
# install.sh on re-run (parses it), relay-move.sh (parses it), the three drop-ins above.
set -euo pipefail
DATA="${1:-}"; PIN=1
[ "${2:-}" = "--unpinned" ] && PIN=0
[ -n "$DATA" ] || { echo "usage: relay-datadir-apply.sh <data-folder> [--unpinned]" >&2; exit 1; }
case "$DATA" in /*) ;; *) echo "relay-datadir-apply: the folder must be an absolute path" >&2; exit 1;; esac
# systemd and EnvironmentFile= both split on whitespace and treat quotes and backslashes specially. A folder name
# outside this set is refused rather than written in a form one of the readers would mis-read.
if ! printf '%s' "$DATA" | grep -Eq '^/[A-Za-z0-9_./@+:=,-]*$'; then
  echo "relay-datadir-apply: that folder name has characters the server cannot record safely (use letters, digits and _ . / @ + : = , -)" >&2; exit 1
fi
case "$DATA" in *..*) echo "relay-datadir-apply: '..' is not allowed in the folder" >&2; exit 1;; esac

ETC="${TRINITYONE_ETC:-/etc/trinityone}"
STATE_DIR="${TRINITYONE_STATE_DIR:-/var/lib/trinityone}"
SYSD="${TRINITYONE_SYSTEMD_DIR:-/etc/systemd/system}"
SVC="${TRINITYONE_SVC:-trinityone-relay}"
RELAY_ENV="$ETC/relay.env"

write_atomic() {   # write_atomic <file> <mode>   (content on stdin)
  local f="$1" m="$2" t; t="$(mktemp "$1.XXXXXX")"
  cat > "$t" && chmod "$m" "$t" && mv -f "$t" "$f" || { rm -f "$t"; return 1; }
}

mkdir -p "$ETC" "$STATE_DIR"
chmod 0755 "$ETC" "$STATE_DIR"
{
  printf 'TRINITY_DATA_DIR=%s\n' "$DATA"
  [ "$PIN" = 1 ] && printf 'TRINITY_DATA_DIR_PINNED=1\n'
  printf 'TRINITY_STORAGE_MODE=server\n'
  printf 'TRINITY_STORAGE_STATE=%s\n' "$STATE_DIR/move-state.json"
} | write_atomic "$RELAY_ENV" 0644

mkdir -p "$SYSD/$SVC.service.d" "$SYSD/trinityone-update.path.d" "$SYSD/trinityone-move.path.d"
printf '[Service]\nRestartPreventExitStatus=78\n' | write_atomic "$SYSD/$SVC.service.d/10-refused-data-folder.conf" 0644
printf '[Unit]\nRequiresMountsFor=%s\n[Service]\nEnvironmentFile=-%s\nReadWritePaths=%s\n' "$DATA" "$RELAY_ENV" "$DATA" \
  | write_atomic "$SYSD/$SVC.service.d/50-data-dir.conf" 0644
printf '[Path]\nPathExists=\nPathExists=%s/.update-request\n' "$DATA" \
  | write_atomic "$SYSD/trinityone-update.path.d/50-data-dir.conf" 0644
printf '[Path]\nPathExists=\nPathExists=%s/.move-request\nPathExists=%s/.remove-old-request\n' "$DATA" "$DATA" \
  | write_atomic "$SYSD/trinityone-move.path.d/50-data-dir.conf" 0644
systemctl daemon-reload
