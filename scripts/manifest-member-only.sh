#!/usr/bin/env bash
# Take the MEMBER-ONLY blocks out of the Android manifest for a Console (steward) build, and put them back.
#
#   manifest-member-only.sh strip    [manifest]   remove every BEGIN..END "(member only)" block, after backing the file up
#   manifest-member-only.sh restore  [manifest]   put the backed-up file back, byte for byte
#
# WHY. android/app/src/main/AndroidManifest.xml is shared by the member app and the Console APK
# (scripts/build-steward-apk.sh swaps only the applicationId, name, icons and webDir). The "install from a file"
# intent-filter (Open with TrinityOne for a zip or SQLite file) belongs to the MEMBER app: the Console has no
# Library, no installFromBytes and no listener, so without this it would be offered for every zip on the phone and
# do nothing when tapped. The block sits between marker comments:
#     <!-- BEGIN install-from-file (member only) -->  ...  <!-- END install-from-file -->
#
# The backup is a whole-file copy, so `restore` is exact by construction. If a previous build died after `strip`
# (the backup is still there), `strip` restores first, so it never backs up an already-stripped file.
set -euo pipefail
MODE="${1:-}"
cd "$(dirname "$0")/.."
M="${2:-android/app/src/main/AndroidManifest.xml}"
BAK="$M.member-bak"
case "$MODE" in
  strip)
    [ -f "$M" ] || { echo "manifest not found: $M" >&2; exit 1; }
    [ -f "$BAK" ] && mv "$BAK" "$M"
    cp "$M" "$BAK"
    sed -i '/<!-- BEGIN [^>]*(member only) -->/,/<!-- END [^>]*-->/d' "$M"
    ;;
  restore)
    [ -f "$BAK" ] && mv "$BAK" "$M"
    ;;
  *)
    echo "usage: $0 strip|restore [manifest]" >&2; exit 2
    ;;
esac
exit 0
