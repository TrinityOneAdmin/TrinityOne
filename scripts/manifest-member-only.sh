#!/usr/bin/env bash
# Take the MEMBER-ONLY blocks out of the Android manifest for a Console (steward) build, and put them back.
#
#   manifest-member-only.sh strip    [manifest]   remove every BEGIN..END "(member only)" block, after backing the file up
#   manifest-member-only.sh restore  [manifest]   put the backed-up file back, byte for byte
#   manifest-member-only.sh check    [manifest]   exit 1 if the manifest is not in its member form (a killed build left it stripped)
#
# WHY. android/app/src/main/AndroidManifest.xml is shared by the member app and the Console APK
# (scripts/build-steward-apk.sh swaps only the applicationId, name, icons and webDir). The "install from a file"
# intent-filter (Open with TrinityOne for a zip or SQLite file) belongs to the MEMBER app: the Console has no
# Library, no installFromBytes and no listener, so without this it would be offered for every zip on the phone and
# do nothing when tapped. The block sits between marker comments:
#     <!-- BEGIN install-from-file (member only) -->  ...  <!-- END install-from-file -->
#
# THE BACKUP IS A WHOLE-FILE COPY, so `restore` is exact by construction. THE HARD-KILL CASE (audit L3): a SIGKILL or
# a power cut between `strip` and `restore` runs no trap, and leaves the manifest stripped with the backup beside it.
# The next run reads the situation instead of trusting the backup blindly:
#   · manifest == the backup with its blocks removed  -> it is the crashed run's output; the backup is the
#     known-good copy and goes back first (then strip carries on);
#   · the manifest still HAS its block                -> someone restored or edited it since; that is the newer
#     truth, the backup is stale and is set aside as <manifest>.member-bak.stale, never moved over the manifest;
#   · stripped AND different from the stripped backup -> the stripped file was edited by hand after the kill:
#     refuse (exit 1) and touch nothing, so neither copy is lost.
set -euo pipefail
MODE="${1:-}"
cd "$(dirname "$0")/.."
M="${2:-android/app/src/main/AndroidManifest.xml}"
BAK="$M.member-bak"
strip_to() { sed '/<!-- BEGIN [^>]*(member only) -->/,/<!-- END [^>]*-->/d' "$1" > "$2"; }
has_block() { grep -q '<!-- BEGIN [^>]*(member only) -->' "$1"; }
# Put the backup back if (and only if) the manifest is exactly its stripped form; returns 0 when the backup is dealt with.
settle_backup() {
  [ -f "$BAK" ] || return 0
  local tmp; tmp="$(mktemp)"; strip_to "$BAK" "$tmp"
  if cmp -s "$tmp" "$M"; then
    mv "$BAK" "$M"
  elif has_block "$M"; then
    mv "$BAK" "$BAK.stale"
    echo "manifest-member-only: $M has its member block and differs from the old backup; the backup was stale and is kept as $BAK.stale" >&2
  else
    rm -f "$tmp"
    echo "manifest-member-only: $M is stripped AND differs from the stripped backup $BAK (edited after a killed Console build?). Merge by hand, then delete $BAK." >&2
    return 1
  fi
  rm -f "$tmp"
}
case "$MODE" in
  strip)
    [ -f "$M" ] || { echo "manifest not found: $M" >&2; exit 1; }
    settle_backup || exit 1
    cp "$M" "$BAK"
    strip_to "$BAK" "$M"
    ;;
  restore)
    # a manifest that is MISSING comes back from its backup (the old code did; the first rewrite exited 0 and lost it)
    if [ ! -f "$M" ]; then [ -f "$BAK" ] && mv "$BAK" "$M"; exit 0; fi
    settle_backup || exit 1
    ;;
  check)
    [ -f "$BAK" ] && { echo "manifest-member-only: $BAK exists - a Console build was killed and $M may be stripped. Run: bash scripts/manifest-member-only.sh restore" >&2; exit 1; }
    has_block "$M" || { echo "manifest-member-only: $M has no member block (stripped, or the block was removed)" >&2; exit 1; }
    ;;
  *)
    echo "usage: $0 strip|restore|check [manifest]" >&2; exit 2
    ;;
esac
exit 0
