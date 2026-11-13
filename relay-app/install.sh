#!/usr/bin/env bash
# TrinityOne Relay — installer for any Debian/Ubuntu/Raspberry Pi OS box.
#
#   curl -fsSL -o install.sh https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download/install.sh
#   less install.sh                      # read it: this file IS the trust root, see below
#   sudo bash install.sh
#
# Sets up the gateway (relay + app + browser control dashboard) as a systemd service that starts on
# boot, then optionally brings up a tunnel so the relay is reachable from outside the church LAN.
# Not Pi-specific — it just needs an apt-based Linux box (a Pi, mini-PC, old laptop, or a VPS).
#
# WHERE THINGS COME FROM — two places, on purpose:
#   CODE  the relay software, as a tarball + detached signature, from $SRC (--src). Default: the newest
#         TrinityOne release on GitHub. Checked against the release public key PINNED IN THIS FILE before a
#         single byte is unpacked, and the same source feeds the control panel's "Update now" later.
#   APPS  the member/steward installers this box hands out to phones, from $ORIGIN (--origin). Default:
#         https://app.trinityone.church, the host every member's app already checks for updates.
#         Not GitHub: the APKs are pilot builds released separately from the relay, and they are not there.
#   Point --src at a TrinityOne relay (https://host) instead and both come from it, as they did before
#   2026-09-21 — a relay serves them under /relay-app/, a GitHub release flat (release_bundle_base, below).
#
# Until 2026-09-21 this script fetched the tarball alone and untarred it as root — the only key it could have
# checked against arrived INSIDE the tarball it was trusting (reference/BACKLOG.md, "THE ONE-LINE INSTALLER
# HAS NEVER VERIFIED WHAT IT DOWNLOADS"). So: read this file before you run it. If the key below is not the
# TrinityOne release key, nothing else in the file matters. How to tell: its SHA-256 fingerprint is
#
#     72eaf9dae5f094be4fc4162771465a68865a9ac350fd0ac4ef9d75e648a93383
#
# which is `sha256sum relay-app/release-pubkey.pem` in the public repository
# (https://github.com/TrinityOneAdmin/TrinityOne/blob/main/relay-app/release-pubkey.pem), is printed in the
# "Running your own relay" guide, and is what `bash install.sh --fingerprint` prints for the key in THIS file.
# Three places, two of them not this download. If they disagree, stop.
#
# Flags (all optional; prompts on a TTY when omitted):
#   --church <npub[,npub...]>   church key(s) allowed to publish (the relay's write policy)
#   --name   <"Church name">    label shown in the control dashboard (single church)
#   --tunnel <cloudflared|tailscale|none>   how to expose it (default: cloudflared)
#   --cf-token <token>          Cloudflare tunnel token → a stable address on your own domain
#   --domain <relay.yourchurch.org>   your domain label (the route itself is set in Cloudflare)
#   --port   <n>                listen port (default 8000)
#   --dir    <path>             install dir (default /opt/trinityone)
#   --src    <url>              where the code bundle comes from: a GitHub release
#                               (…/releases/latest/download or …/releases/download/<tag>) or a TrinityOne
#                               relay (https://host). Default: the newest GitHub release.
#   --origin <https://host>     where the member/steward installers come from (default
#                               https://app.trinityone.church; a relay named by --src, when it is one)
#   --storage-move              let the control panel move the relay's data to another drive (writes
#                               /etc/trinityone/relay.env and installs the root move helper). On by default for
#                               a FRESH install; an existing box is left exactly as it is unless you pass this.
#   --no-storage-move           never enable it (on a fresh install)
#   --fingerprint               print the SHA-256 of the release key pinned in this file, and exit
#   -y                          non-interactive: accept defaults, no prompts
set -euo pipefail

SRC="https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download"
APP_ORIGIN_DEFAULT="https://app.trinityone.church"
ORIGIN=""
DIR="/opt/trinityone"; PORT="8000"
CHURCH=""; CHURCH_NAME=""; TUNNEL=""; CF_TOKEN=""; CF_HOST=""; ASSUME_YES=0; SHOW_FP=0; STORAGE=auto
SVC_USER="trinityone"; SVC="trinityone-relay"

while [ $# -gt 0 ]; do
  case "$1" in
    --church) CHURCH="$2"; shift 2;;
    --name)   CHURCH_NAME="$2"; shift 2;;
    --tunnel) TUNNEL="$2"; shift 2;;
    --cf-token) CF_TOKEN="$2"; shift 2;;
    --domain) CF_HOST="$2"; shift 2;;
    --port)   PORT="$2"; shift 2;;
    --dir)    DIR="$2"; shift 2;;
    --src)    SRC="${2%/}"; shift 2;;
    --origin) ORIGIN="${2%/}"; shift 2;;
    --storage-move) STORAGE=1; shift;;
    --no-storage-move) STORAGE=0; shift;;
    --fingerprint) SHOW_FP=1; shift;;
    -y|--yes) ASSUME_YES=1; shift;;
    *) echo "unknown option: $1" >&2; exit 1;;
  esac
done

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
# read a prompt from the real terminal even when the script itself arrives on stdin (curl | bash)
ask()  { local p="$1" d="${2:-}" a=""; if [ "$ASSUME_YES" = 1 ] || [ ! -r /dev/tty ]; then echo "$d"; return; fi
         read -r -p "$p" a < /dev/tty || true; echo "${a:-$d}"; }

# ── THE TRUST ROOT ──────────────────────────────────────────────────────────────────────────────────────────
# The TrinityOne release public key (Ed25519). Every code bundle the release host publishes is signed with its
# private half (scripts/gateway.mjs ensureSignedBundle → /relay-app/bundle.sig). The same key ships inside the
# bundle as relay-app/release-pubkey.pem, and scripts/relay-update.sh checks later updates against THAT copy —
# but this first download has to be checked against something that did not arrive in the download, and this
# is it. scripts/the-installer-checks-what-it-downloads.test.mjs pins it equal to the committed .pem.
RELEASE_PUBKEY_PEM='-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAUbKNmON7cIyaJrXFlVC7s3/BfdG4ihNwx7WOXFHzoAs=
-----END PUBLIC KEY-----'

# ── verify_release_bundle ──
# verify_release_bundle <tarball> <signature> <public-key.pem>
# Returns 0 when <signature> is the release key's Ed25519 signature over the exact bytes of <tarball>.
# Otherwise prints ONE plain sentence on stderr and returns 1. Touches nothing on disk either way.
# DUPLICATED VERBATIM in relay-app/install.sh and scripts/relay-update.sh: the installer is fetched on its own
# by curl and cannot source a file that arrives inside the tarball it is checking. The two copies are pinned
# byte-equal by scripts/the-installer-checks-what-it-downloads.test.mjs — change both or neither.
verify_release_bundle() {
  local tarball="$1" sig="$2" pub="$3"
  [ -s "$tarball" ] || { echo "the downloaded package is empty, so there is nothing to install" >&2; return 1; }
  [ -s "$sig" ] || { echo "the download came with no signature, so it cannot be checked and will not be installed" >&2; return 1; }
  [ -s "$pub" ] || { echo "there is no release key on this box to check the download against, so it will not be installed" >&2; return 1; }
  command -v openssl >/dev/null 2>&1 || { echo "openssl is missing, so the download's signature cannot be checked and it will not be installed" >&2; return 1; }
  if openssl pkeyutl -verify -pubin -inkey "$pub" -rawin -in "$tarball" -sigfile "$sig" >/dev/null 2>&1; then return 0; fi
  echo "the downloaded package was not signed by the TrinityOne release key, so it will not be installed (the download source may be compromised, or the download was corrupted)" >&2
  return 1
}
# ── end verify_release_bundle ──

# ── release_bundle_base ──
# release_bundle_base <source>
# Prints the directory that holds bundle.tgz, bundle.sig and bundle.json for <source>. Two shapes, told apart
# by the address alone — no request is made:
#   a GitHub release   …/releases/latest/download  or  …/releases/download/<tag>   → the assets sit flat there
#   a TrinityOne relay  https://host[:port]                                          → it serves them under /relay-app/
# DUPLICATED VERBATIM in relay-app/install.sh and scripts/relay-update.sh, for the reason given at
# verify_release_bundle; pinned byte-equal by the same test.
release_bundle_base() {
  local src="${1%/}"
  case "$src" in
    */releases/latest/download|*/releases/download/*) printf '%s\n' "$src";;
    *) printf '%s\n' "$src/relay-app";;
  esac
}
# ── end release_bundle_base ──

# The fingerprint of the key above, computed from this file — compare it with the guide and the repository.
if [ "$SHOW_FP" = 1 ]; then printf '%s\n' "$RELEASE_PUBKEY_PEM" | sha256sum | cut -c1-64; exit 0; fi

[ "$(id -u)" = "0" ] || die "run as root:  sudo bash install.sh"
command -v apt-get >/dev/null 2>&1 || die "this installer needs an apt-based distro (Debian/Ubuntu/Raspberry Pi OS). Install Node + run scripts/gateway.mjs manually otherwise."

# WHERE THE DATA LIVES (relay storage plan step 6). $DIR/relay unless a steward has moved it: then the root move
# helper has recorded the new folder in relay.env, and every data path below follows it -- re-running this installer
# after a move must not plant a second, empty relay folder and rewrite the unit without the new path (plan R3).
# The file is parsed, never sourced. With no relay.env (every box installed before this) DATA is $DIR/relay and
# nothing below differs from before.
ETC_DIR="${TRINITYONE_ETC:-/etc/trinityone}"; RELAY_ENV="$ETC_DIR/relay.env"
DATA="$DIR/relay"; HAD_ENV=0; ENV_PINNED=0
if [ -r "$RELAY_ENV" ]; then
  HAD_ENV=1
  _dd="$(sed -n 's/^TRINITY_DATA_DIR=//p' "$RELAY_ENV" 2>/dev/null | head -n1)"
  case "$_dd" in /*) DATA="$_dd";; esac
  grep -qx 'TRINITY_DATA_DIR_PINNED=1' "$RELAY_ENV" 2>/dev/null && ENV_PINNED=1
fi
# a FRESH install (no data folder yet, no relay.env) gets the storage card; an existing box does not, unless asked
FRESH=0; [ ! -e "$DIR/relay" ] && [ "$HAD_ENV" = 0 ] && FRESH=1
if [ "$STORAGE" = auto ]; then if [ "$HAD_ENV" = 1 ] || [ "$FRESH" = 1 ]; then STORAGE=1; else STORAGE=0; fi; fi

# The apps' origin: named, else the relay --src points at, else the default.
if [ -z "$ORIGIN" ]; then
  case "$(release_bundle_base "$SRC")" in "$SRC/relay-app") ORIGIN="$SRC";; *) ORIGIN="$APP_ORIGIN_DEFAULT";; esac
fi
BUNDLE_BASE="$(release_bundle_base "$SRC")"

say "TrinityOne Relay installer"
ok "release key sha256 $(printf '%s\n' "$RELEASE_PUBKEY_PEM" | sha256sum | cut -c1-64)"

# ── Node (>=22.13) ────────────────────────────────────────────────────────────────
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  # node:sqlite arrived in 22.5 behind a flag and lost the flag in 22.13.0 (Node's changelog). The relay's event store
  # and the data mover both import it, so an older Node (this said 18+, and installed 20) could never run the gateway.
  case "$(node -p 'const [a,b]=process.versions.node.split(".").map(Number);(a>22||(a===22&&b>=13))?"ok":"old"' 2>/dev/null || echo old)" in
    ok) NODE_OK=1;;
  esac
fi
if [ "$NODE_OK" = 1 ]; then ok "Node $(node -v) already present"
else
  say "Installing Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
  ok "Node $(node -v) installed"
fi
# ── service user ────────────────────────────────────────────────────────────────
if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DIR" --shell /usr/sbin/nologin "$SVC_USER"
  ok "created service user '$SVC_USER' (runs the relay with no login/privileges)"
fi

# ── fetch / verify / unpack the app ──────────────────────────────────────────────
# Pull the code tarball AND its detached signature ($BUNDLE_BASE/bundle.tgz + .sig — a GitHub release's flat
# assets, or a relay's /relay-app/), check the signature against the key pinned above, and only then unpack.
# The relay/ secrets live outside the bundle, so re-running never clobbers this box's church.json / admin
# token / push keys. -L on every curl: a GitHub download is a redirect.
say "Fetching the app into $DIR (from $BUNDLE_BASE)"
mkdir -p "$DIR"
TARBALL="$(mktemp)"; SIGFILE="$(mktemp)"; PUBFILE="$(mktemp)"; trap 'rm -f "$TARBALL" "$SIGFILE" "$PUBFILE"' EXIT
curl -fsSL "$BUNDLE_BASE/bundle.tgz" -o "$TARBALL" || die "couldn't download the code bundle from $BUNDLE_BASE/bundle.tgz"
curl -fsSL "$BUNDLE_BASE/bundle.sig" -o "$SIGFILE" || die "couldn't download the bundle's signature from $BUNDLE_BASE/bundle.sig — without it the download cannot be checked, so nothing was installed"
printf '%s\n' "$RELEASE_PUBKEY_PEM" > "$PUBFILE"
if ! VERIFY_MSG="$(verify_release_bundle "$TARBALL" "$SIGFILE" "$PUBFILE" 2>&1)"; then die "$VERIFY_MSG"; fi
ok "the download is signed by the TrinityOne release key"
tar -xzf "$TARBALL" -C "$DIR" --no-same-owner --exclude='relay/*' || die "couldn't unpack the code bundle"   # SECURITY-AUDIT-2026-07-06 M10
ok "code unpacked"
# Later updates (scripts/relay-update.sh) verify against the key the bundle carries. It normally equals the
# pinned one; a release that rotates the key ships the new one inside a bundle signed by the old, so a
# difference here is a rotation, not a fault — but it is worth a line on the screen.
if ! cmp -s "$PUBFILE" "$DIR/relay-app/release-pubkey.pem" 2>/dev/null; then
  warn "the package carries a different release key from the one pinned in this installer — future updates will be checked against the package's key"
fi

say "Installing the relay's runtime dependencies (ws, web-push, nostr-tools)"
( cd "$DIR" && npm install --ignore-scripts --no-audit --no-fund --no-save ws web-push nostr-tools >/dev/null 2>&1 ) || die "npm install failed"   # SECURITY-AUDIT-2026-07-06 H3: no install-script RCE
ok "dependencies ready"

# ── write policy (church.json) ──────────────────────────────────────────────────
# NEVER CREATE A DATA FOLDER THAT relay.env NAMES AND THAT IS NOT THERE (plan R1, audit C L4): with the drive unplugged,
# mkdir -p would plant the folder under the mount point on the root disk, write origin/code-source/church.json into it, and
# hide it when the drive returns. The folder the move helper makes is <mountpoint>/trinityone-relay, so its drive must be
# mounted (mountpoint -q) and the folder present. <<check-data-folder>>
is_mounted() {   # is_mounted <path>: mountpoint(1), else findmnt(8), else /proc/mounts -- a missing tool is not "not mounted"
  local m="$1"
  if command -v mountpoint >/dev/null 2>&1; then mountpoint -q "$m" 2>/dev/null; return; fi
  if command -v findmnt >/dev/null 2>&1; then findmnt -rn -M "$m" >/dev/null 2>&1; return; fi
  awk -v m="$m" '$2 == m { f = 1 } END { exit !f }' /proc/mounts 2>/dev/null
}
check_data_folder_present() {
  [ "$HAD_ENV" = 1 ] || return 0
  # Only a folder that could be hiding on the wrong disk is checked: a PINNED one, or one that is not the default $DIR/relay.
  # An unpinned relay.env naming $DIR/relay (a reinstall after the install dir was removed) is an ordinary fresh start.
  if [ "$ENV_PINNED" != 1 ] && [ "$DATA" = "$DIR/relay" ]; then return 0; fi
  if [ ! -d "$DATA" ]; then die "this relay's data folder $DATA is missing -- is its drive connected? Nothing was changed. Reconnect it and run this installer again."; fi
  case "$DATA" in
    */trinityone-relay)
      if [ "$DATA" != "$DIR/relay" ] && ! is_mounted "$(dirname "$DATA")"; then die "the drive that holds this relay's data ($(dirname "$DATA")) is not mounted, so $DATA would be on the wrong disk. Nothing was changed. Mount it and run this installer again."; fi;;
  esac
  return 0
}
check_data_folder_present
mkdir -p "$DATA"
printf '%s\n' "$ORIGIN" > "$DATA/origin"        # where the installers this box hands out come from
printf '%s\n' "$SRC" > "$DATA/code-source"      # where "Update now" (scripts/relay-update.sh) pulls code from
if [ -z "$CHURCH" ] && [ ! -s "$DATA/church.json" ]; then
  CHURCH="$(ask 'Your church public key (npub1…), or blank to set later: ' '')"
fi
if [ -n "$CHURCH" ]; then
  node -e '
    const [list,name]=[process.argv[1],process.argv[2]||""];
    const churches=list.split(",").map(s=>s.trim()).filter(Boolean).map(npub=>({npub,name}));
    require("fs").writeFileSync(process.argv[3],JSON.stringify({churches},null,2)+"\n");
  ' "$CHURCH" "$CHURCH_NAME" "$DATA/church.json"
  ok "write policy set ($(echo "$CHURCH" | tr ',' '\n' | grep -c .) church key(s))"
else
  [ -s "$DATA/church.json" ] || echo '{"churches":[]}' > "$DATA/church.json"
  warn "no church key set yet — the relay is open until you add one to $DATA/church.json and restart"
fi
# SECURITY-AUDIT-2026-07-06 H4: only the data dir is service-writable (systemd ReadWritePaths=$DATA, i.e. $DIR/relay until a move);
# keep code + the root-run update script + the release-signing pubkey root-owned so a compromised relay
# process can't rewrite the updater or swap the trust anchor. Code was extracted + npm-installed as root above.
chown -R "$SVC_USER:$SVC_USER" "$DATA"
chown -R root:root "$DIR/scripts" "$DIR/relay-app/release-pubkey.pem" 2>/dev/null || true
chmod 0644 "$DIR/relay-app/release-pubkey.pem" 2>/dev/null || true

# ── systemd service ─────────────────────────────────────────────────────────────
say "Installing the boot service ($SVC)"
NODE_BIN="$(command -v node)"
cat > "/etc/systemd/system/$SVC.service" <<UNIT
[Unit]
Description=TrinityOne Relay (app + Nostr relay, one port)
After=network-online.target
Wants=network-online.target
[Service]
User=$SVC_USER
WorkingDirectory=$DIR
ExecStart=$NODE_BIN scripts/gateway.mjs $PORT
EnvironmentFile=-$RELAY_ENV
Restart=always
RestartSec=3
# exit 78 = the relay REFUSED its data folder (missing drive / moved / foreign). Restarting cannot fix
# that and would loop every 3s; stop and leave the refusal line at the end of the journal.
RestartPreventExitStatus=78
# hardening: the relay only needs its own dir
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA
[Install]
WantedBy=multi-user.target
UNIT
# the storage card is on only if the relay's FIRST start already sees relay.env, so record the folder before it (audit C L3).
# A fresh folder holds no relay key until that first start, and a PINNED gateway refuses a folder with files but no key, so a
# fresh install records it unpinned; the first move (or a re-run once the relay has a key) pins it. A box already pinned stays pinned.
record_data_folder() {
  [ "$STORAGE" = 1 ] || return 0
  PIN_ARG=--unpinned
  if [ "$ENV_PINNED" = 1 ] || [ -s "$DATA/relay-key.json" ]; then PIN_ARG=; fi
  TRINITYONE_SVC="$SVC" TRINITYONE_ETC="$ETC_DIR" bash "$DIR/scripts/relay-datadir-apply.sh" "$DATA" $PIN_ARG || warn "couldn't record the data folder for the move helper"
}
record_data_folder
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"   # restart (not just enable --now) so re-running the installer loads new code
sleep 2
systemctl is-active --quiet "$SVC" && ok "relay running on port $PORT (starts on boot)" || die "service failed to start — check: journalctl -u $SVC"

# ── self-update units (the dashboard "Update now" button) ─────────────────────────
# The relay is sandboxed (NoNewPrivileges, ProtectSystem=strict) and can only write under relay/. When
# the dashboard drops relay/.update-request, this ROOT path-unit fires relay-update.sh — which pulls a
# fresh bundle, swaps the code (keeping relay/ data), restarts, and rolls back if the new build fails.
say "Installing the self-update trigger"
cat > "/etc/systemd/system/trinityone-update.service" <<UNIT
[Unit]
Description=TrinityOne relay self-update
After=trinityone-move-recover.service
[Service]
Type=oneshot
Environment=TRINITYONE_DIR=$DIR TRINITYONE_SVC=$SVC TRINITYONE_PORT=$PORT TRINITYONE_USER=$SVC_USER
ExecStart=/bin/bash $DIR/scripts/relay-update.sh
UNIT
cat > "/etc/systemd/system/trinityone-update.path" <<UNIT
[Unit]
Description=TrinityOne relay update trigger (watches for an update request)
[Path]
PathExists=$DATA/.update-request
Unit=trinityone-update.service
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now trinityone-update.path >/dev/null 2>&1 && ok "one-click updates enabled (dashboard → Update now)" || warn "couldn't enable the update watcher"

# ── moving the relay's data from the panel (storage plan step 6) ─────────────────────────────────────────────────
# The sandboxed relay can only drop a request file in its own data folder (.move-request / .remove-old-request);
# this ROOT path-unit starts scripts/relay-move.sh, which stops the relay, validates the drive itself (the request is
# a wish, not an authority), runs scripts/relay-move.mjs, records the new folder in relay.env, starts the relay and
# proves it is the same relay -- or puts everything back. Only installed when the storage card is on (see --storage-move).
if [ "$STORAGE" = 1 ]; then
  say "Installing the data-move helper"
  cat > "/etc/systemd/system/trinityone-move.service" <<UNIT
[Unit]
Description=TrinityOne relay data move (root helper)
After=trinityone-move-recover.service
[Service]
Type=oneshot
TimeoutStartSec=infinity
Environment=TRINITYONE_DIR=$DIR TRINITYONE_SVC=$SVC TRINITYONE_PORT=$PORT TRINITYONE_USER=$SVC_USER TRINITYONE_NODE=$NODE_BIN
ExecStart=/bin/bash $DIR/scripts/relay-move.sh
UNIT
  cat > "/etc/systemd/system/trinityone-move.path" <<UNIT
[Unit]
Description=TrinityOne relay data move trigger (watches for a move or remove-old request)
[Path]
PathExists=$DATA/.move-request
PathExists=$DATA/.remove-old-request
Unit=trinityone-move.service
[Install]
WantedBy=multi-user.target
UNIT
  # Boot recovery (audit C M1). Before the relay starts: finish or undo a move that was interrupted (a helper killed mid-copy
  # would otherwise leave the card "under way" for ever; a crash between the switch and relay.env would leave the old folder
  # marked MOVED-TO and the relay refusing it). It never starts or stops the relay. After the relay is up: finish the check
  # recovery left. The finish unit has NO dependency on the relay beyond After= (not Wants=, which starts a relay an admin
  # disabled; not Requisite=, which makes stopping the relay stop this unit, so a rollback run from inside it was killed part-way
  # and left the relay down): the script itself exits if the relay is not running. It is bounded (TimeoutStartSec=900 > its
  # lock wait of TRINITYONE_FINISH_LOCK_WAIT=600 plus the identity proof). Neither blocks the relay if it fails. The move and update units are ordered
  # After= the recover unit, so a request left from before shutdown cannot take the lock first (audit N2).
  cat > "/etc/systemd/system/trinityone-move-recover.service" <<UNIT
[Unit]
Description=TrinityOne relay data move: recover an interrupted move before the relay starts
After=local-fs.target
Before=$SVC.service
[Service]
Type=oneshot
RemainAfterExit=yes
Environment=TRINITYONE_DIR=$DIR TRINITYONE_SVC=$SVC TRINITYONE_PORT=$PORT TRINITYONE_USER=$SVC_USER TRINITYONE_NODE=$NODE_BIN
ExecStart=/bin/bash $DIR/scripts/relay-move.sh --recover-only
[Install]
WantedBy=multi-user.target
UNIT
  cat > "/etc/systemd/system/trinityone-move-finish.service" <<UNIT
[Unit]
Description=TrinityOne relay data move: finish the check of a recovered move
After=$SVC.service
[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=900
Environment=TRINITYONE_DIR=$DIR TRINITYONE_SVC=$SVC TRINITYONE_PORT=$PORT TRINITYONE_USER=$SVC_USER TRINITYONE_NODE=$NODE_BIN
ExecStart=/bin/bash $DIR/scripts/relay-move.sh --finish-check
[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable trinityone-move-recover.service trinityone-move-finish.service >/dev/null 2>&1 || warn "couldn't enable the move recovery units"
  systemctl enable --now trinityone-move.path >/dev/null 2>&1 && ok "moving the data to another drive enabled (dashboard → Where this relay keeps its data)" || warn "couldn't enable the move watcher"
fi

# ── reachability ─────────────────────────────────────────────────────────────────
# Default: Cloudflare. With --cf-token the relay comes up on the church's OWN domain (relay.yourchurch.org)
# — stable, branded, no account beyond a free Cloudflare one. Without a token, a throwaway quick-tunnel URL.
# Tailscale (--tunnel tailscale) and LAN-only (--tunnel none) remain available.
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
case "$TUNNEL" in
  none)
    ok "LAN-only for now — turn on public access anytime from the dashboard's 'Go public' button"
    ;;
  tailscale)   # optional: Tailscale Funnel (needs a free Tailscale sign-in, finished in the browser)
    say "Preparing public access via Tailscale"
    command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
    ok "Tailscale installed"
    tailscale set --operator="$SVC_USER" >/dev/null 2>&1 \
      && ok "the relay can manage Tailscale — finish going public in the browser, no terminal" \
      || warn "if the dashboard asks, run once: sudo tailscale set --operator=$SVC_USER"
    ;;
  *)  # default: Cloudflare. With a tunnel token (--cf-token) the relay comes up on the church's OWN
      # domain (e.g. relay.yourchurch.org) — stable + branded. Without one, a throwaway quick-tunnel URL.
    say "Setting up public access via Cloudflare"
    if ! command -v cloudflared >/dev/null 2>&1; then
      ARCH="$(dpkg --print-architecture)"
      curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" -o /usr/local/bin/cloudflared
      chmod +x /usr/local/bin/cloudflared
    fi
    ok "cloudflared installed"
    if [ -n "$CF_TOKEN" ]; then
      TUN_EXEC="/usr/local/bin/cloudflared --no-autoupdate tunnel run --token $CF_TOKEN"
      TUN_DESC="cloudflared named tunnel${CF_HOST:+ → $CF_HOST}"
    else
      TUN_EXEC="/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://localhost:$PORT"
      TUN_DESC="cloudflared quick tunnel"
    fi
    cat > "/etc/systemd/system/$SVC-tunnel.service" <<UNIT
[Unit]
Description=TrinityOne Relay tunnel ($TUN_DESC)
After=$SVC.service
Requires=$SVC.service
[Service]
ExecStart=$TUN_EXEC
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload; systemctl enable --now "$SVC-tunnel" >/dev/null 2>&1 || true
    ok "tunnel service started"
    if [ -n "$CF_TOKEN" ]; then
      ok "your relay is reachable on your own domain${CF_HOST:+:  https://$CF_HOST}"
    else
      warn "Quick-tunnel URL is random + changes on restart. For a STABLE address on YOUR domain, make a"
      warn "Cloudflare tunnel (Zero Trust → Tunnels) and re-run with:  --cf-token <token> --domain relay.yourchurch.org"
      warn "Current URL:  journalctl -u $SVC-tunnel | grep trycloudflare"
    fi
    ;;
esac

# ── done ────────────────────────────────────────────────────────────────────────
ADMIN_TOKEN="$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).token||"")}catch(e){}' "$DATA/admin.json" 2>/dev/null || true)"
say "Done — finish in the browser (no more terminal)."
echo "  Open the dashboard:  http://${LAN_IP:-localhost}:$PORT/relay-app/control.html"
echo
echo "  There you'll:"
echo "    1) Paste the admin token below to unlock it"
echo "    2) Add your church's npub so the relay accepts its posts"
echo "       (public access is already handled by the tunnel set up above)"
echo
echo "  Admin token (keep it private):"
echo "      ${ADMIN_TOKEN:-<see: journalctl -u $SVC | grep \"admin token\">}"
echo
echo "  Code updates come from $SRC; the installers it hands out from $ORIGIN."
echo "  Manage:  systemctl status $SVC   ·   journalctl -u $SVC -f"
echo "  (Own domain:  --cf-token <token> --domain relay.yourchurch.org  ·  or --tunnel tailscale|none)"
echo
