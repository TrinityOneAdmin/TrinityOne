#!/usr/bin/env bash
# sign-mac-suite.sh — sign + notarize + staple the macOS TrinityOne Suite so the BUNDLED NODE SIDECAR
# actually runs on a clean / quarantined Mac (Tahoe and later). This is the single source of truth for
# macOS signing; never hand-sign the Suite again.
#
# WHY THIS EXISTS (2026-11-11 — fix/mac-sidecar-signing-entitlements):
#   `tauri build` signs the app and the nested sidecars with the HARDENED RUNTIME but applies NO
#   entitlements to them. `trinityone-relay-node` is a stock V8/Node runtime; under hardened runtime
#   WITHOUT com.apple.security.cs.allow-jit it cannot allocate JIT / executable memory, so AMFI kills it
#   the instant it is launched from a quarantined context (any machine that is not the signing machine).
#   The relay never binds 127.0.0.1:8787 and the Suite hangs forever on "Starting your relay…".
#   Notarization does NOT catch this: the notary only verifies that hardened runtime is ON, not that the
#   JIT entitlements are present (that is why the broken 0.9.0 build notarized + stapled cleanly and still
#   failed on the pilot's clean Mac). So we re-sign EVERY nested Mach-O inside-out with Entitlements.plist
#   ourselves, verify allow-jit landed, then notarize + staple BOTH the app and the dmg.
#
# Usage:
#   APPLE_SIGNING_IDENTITY="Developer ID Application: NAME (TEAMID)" \
#   APPLE_API_KEY=KEYID APPLE_API_ISSUER=ISSUER_UUID APPLE_API_KEY_PATH=/path/AuthKey_KEYID.p8 \
#   [SIGNING_KEYCHAIN=~/.trinityone-signing/trinityone-signing.keychain-db SIGNING_KEYCHAIN_PASS=...] \
#   scripts/sign-mac-suite.sh ["path/to/TrinityOne Suite.app"] ["out.dmg"]
#
# Exits non-zero if the node sidecar does not carry allow-jit after signing — it refuses to emit a build
# with the original defect.
set -euo pipefail
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENTITLEMENTS="$HERE/relay-app/desktop/src-tauri/Entitlements.plist"
APP="${1:-$HERE/relay-app/desktop/src-tauri/target/release/bundle/macos/TrinityOne Suite.app}"
DMG="${2:-$HERE/relay-app/desktop/src-tauri/target/release/bundle/dmg/TrinityOne-Suite-macos-arm64.dmg}"

: "${APPLE_SIGNING_IDENTITY:?set APPLE_SIGNING_IDENTITY to the Developer ID Application identity}"
: "${APPLE_API_KEY:?set APPLE_API_KEY (key id)}"
: "${APPLE_API_ISSUER:?set APPLE_API_ISSUER}"
: "${APPLE_API_KEY_PATH:?set APPLE_API_KEY_PATH (.p8)}"
[ -f "$ENTITLEMENTS" ] || { echo "FATAL: missing entitlements: $ENTITLEMENTS" >&2; exit 2; }
[ -d "$APP" ]          || { echo "FATAL: app bundle not found: $APP" >&2; exit 2; }

echo "### app : $APP"
echo "### dmg : $DMG"
echo "### ents: $ENTITLEMENTS"
echo "### id  : $APPLE_SIGNING_IDENTITY"

# Unlock the dedicated signing keychain if one was given, so codesign never prompts. (The login keychain
# password on this Mac is out of sync with the login password; a dedicated keychain sidesteps that.)
if [ -n "${SIGNING_KEYCHAIN:-}" ]; then
  echo "### unlock signing keychain: $SIGNING_KEYCHAIN"
  security unlock-keychain -p "${SIGNING_KEYCHAIN_PASS:-}" "$SIGNING_KEYCHAIN"
  case ":$(security list-keychains -d user | tr -d ' "' | tr '\n' ':'):" in
    *":$SIGNING_KEYCHAIN:"*) : ;;  # already on the search list
    *) security list-keychains -d user -s "$SIGNING_KEYCHAIN" $(security list-keychains -d user | sed 's/"//g') ;;
  esac
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# notarize_wait <artifact>: submit, wait, print the submission id on stdout; pull the log + exit 4 if the
# notary does not Accept it.
notarize_wait() {
  local art="$1" json id
  json="$(xcrun notarytool submit "$art" \
    --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" \
    --wait --output-format json)"
  echo "$json" >&2
  id="$(printf '%s' "$json" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
  if ! printf '%s' "$json" | grep -q '"status":"Accepted"'; then
    echo "NOTARIZATION NOT ACCEPTED for $art (id ${id:-?})" >&2
    [ -n "$id" ] && xcrun notarytool log "$id" \
      --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" >&2 || true
    exit 4
  fi
  printf '%s' "$id"
}

sign_one() {  # sign one Mach-O / bundle: hardened runtime + our JIT entitlements, re-signing in place
  codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --sign "$APPLE_SIGNING_IDENTITY" "$1"
}

# Sign INSIDE-OUT: every nested Mach-O first, then seal the .app last. The Suite bundles only leaf
# binaries under Contents/MacOS (the two sidecars + the Rust main) and no nested .frameworks, so signing
# every Mach-O leaf before the bundle is sufficient; if a framework is ever added, switch to deepest-path
# -first ordering here.
echo "### INSIDE-OUT SIGN ###"
while IFS= read -r -d '' f; do
  if file -b "$f" | grep -q 'Mach-O'; then
    echo "  sign: ${f#"$APP"/}"
    sign_one "$f"
  fi
done < <(find "$APP/Contents" -type f -print0)
echo "  seal: $(basename "$APP")"
sign_one "$APP"

echo "### VERIFY SIGNATURE + ENTITLEMENTS ###"
codesign --verify --deep --strict --verbose=2 "$APP"
NODE="$APP/Contents/MacOS/trinityone-relay-node"
echo "--- $(basename "$NODE") entitlements (MUST include allow-jit) ---"
ENTS="$(codesign -d --entitlements - --xml "$NODE" 2>/dev/null || codesign -d --entitlements - "$NODE" 2>&1 || true)"
if ! printf '%s' "$ENTS" | grep -q 'com.apple.security.cs.allow-jit'; then
  echo "FATAL: trinityone-relay-node is STILL missing allow-jit after signing — would reproduce the stall." >&2
  exit 3
fi
echo "OK: trinityone-relay-node carries com.apple.security.cs.allow-jit"

# Staple the APP FIRST, so the copy that ends up inside the dmg is itself stapled and verifies OFFLINE
# (a church Mac may have no network at first launch). Stapling needs a notarization ticket, so notarize a
# zip of the app before stapling it.
echo "### NOTARIZE + STAPLE app ###"
/usr/bin/ditto -c -k --keepParent "$APP" "$TMP/suite.zip"
APP_SUB_ID="$(notarize_wait "$TMP/suite.zip")"
echo "app notarytool id: $APP_SUB_ID"
xcrun stapler staple "$APP"

echo "### PACKAGE DMG (from the now-stapled app) ###"
mkdir -p "$(dirname "$DMG")"
STAGE="$TMP/stage"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "TrinityOne Suite" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$DMG"

echo "### NOTARIZE + STAPLE dmg ###"
DMG_SUB_ID="$(notarize_wait "$DMG")"
echo "dmg notarytool id: $DMG_SUB_ID"
xcrun stapler staple "$DMG"

echo "### FINAL GATEKEEPER CHECK ###"
spctl -a -vvv -t install "$APP" 2>&1 | head -3 || true
echo "-- app staple --";  xcrun stapler validate "$APP" 2>&1 | tail -1
echo "-- dmg staple --";  xcrun stapler validate "$DMG" 2>&1 | tail -1
echo "### DONE — signed, notarized, stapled (app + dmg): $DMG"
echo "### notarytool: app=$APP_SUB_ID dmg=$DMG_SUB_ID"
