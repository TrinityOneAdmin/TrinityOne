#!/usr/bin/env bash
# TrinityOne Relay — one-line installer for any Debian/Ubuntu/Raspberry Pi OS box.
#
#   curl -fsSL https://trinityone.tailbeaac0.ts.net/relay-app/install.sh | sudo bash
#
# Sets up the gateway (relay + app + browser control dashboard) as a systemd service that starts on
# boot, then optionally brings up a tunnel so the relay is reachable from outside the church LAN.
# Not Pi-specific — it just needs an apt-based Linux box (a Pi, mini-PC, old laptop, or a VPS).
#
# The code is fetched as a tarball from the same host this script came from (the network's gateway),
# so it works without any GitHub access (the repo is private during the pilot).
#
# Flags (all optional; prompts on a TTY when omitted):
#   --church <npub[,npub...]>   church key(s) allowed to publish (the relay's write policy)
#   --name   <"Church name">    label shown in the control dashboard (single church)
#   --tunnel <tailscale|cloudflared|none>   how to expose it (default: ask, else none/LAN-only)
#   --port   <n>                listen port (default 8000)
#   --dir    <path>             install dir (default /opt/trinityone)
#   --src    <https://host>     where to fetch the code bundle from (default the pilot gateway)
#   -y                          non-interactive: accept defaults, no prompts
set -euo pipefail

SRC="https://trinityone.tailbeaac0.ts.net"
DIR="/opt/trinityone"; PORT="8000"
CHURCH=""; CHURCH_NAME=""; TUNNEL=""; ASSUME_YES=0
SVC_USER="trinityone"; SVC="trinityone-relay"

while [ $# -gt 0 ]; do
  case "$1" in
    --church) CHURCH="$2"; shift 2;;
    --name)   CHURCH_NAME="$2"; shift 2;;
    --tunnel) TUNNEL="$2"; shift 2;;
    --port)   PORT="$2"; shift 2;;
    --dir)    DIR="$2"; shift 2;;
    --src)    SRC="${2%/}"; shift 2;;
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

[ "$(id -u)" = "0" ] || die "run as root:  curl -fsSL .../install.sh | sudo bash"
command -v apt-get >/dev/null 2>&1 || die "this installer needs an apt-based distro (Debian/Ubuntu/Raspberry Pi OS). Install Node + run scripts/gateway.mjs manually otherwise."

say "TrinityOne Relay installer"

# ── Node (>=18) ────────────────────────────────────────────────────────────────
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  case "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" in
    1[89]|2[0-9]|[3-9][0-9]) NODE_OK=1;;
  esac
fi
if [ "$NODE_OK" = 1 ]; then ok "Node $(node -v) already present"
else
  say "Installing Node.js 20 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
  ok "Node $(node -v) installed"
fi
# ── service user ────────────────────────────────────────────────────────────────
if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DIR" --shell /usr/sbin/nologin "$SVC_USER"
  ok "created service user '$SVC_USER' (runs the relay with no login/privileges)"
fi

# ── fetch / update the app ──────────────────────────────────────────────────────
# Pull a fresh code tarball from the gateway ($SRC/relay-app/bundle.tgz). The relay/ secrets live
# outside the bundle, so updating never clobbers this box's church.json / admin token / push keys.
say "Fetching the app into $DIR (from $SRC)"
mkdir -p "$DIR"
TARBALL="$(mktemp)"; trap 'rm -f "$TARBALL"' EXIT
curl -fsSL "$SRC/relay-app/bundle.tgz" -o "$TARBALL" || die "couldn't download the code bundle from $SRC/relay-app/bundle.tgz"
tar -xzf "$TARBALL" -C "$DIR" --exclude='relay/*' || die "couldn't unpack the code bundle"
ok "code unpacked"

say "Installing the relay's runtime dependencies (ws, web-push, nostr-tools)"
( cd "$DIR" && npm install --no-audit --no-fund --no-save ws web-push nostr-tools >/dev/null 2>&1 ) || die "npm install failed"
ok "dependencies ready"

# ── write policy (church.json) ──────────────────────────────────────────────────
mkdir -p "$DIR/relay"
if [ -z "$CHURCH" ] && [ ! -s "$DIR/relay/church.json" ]; then
  CHURCH="$(ask 'Your church public key (npub1…), or blank to set later: ' '')"
fi
if [ -n "$CHURCH" ]; then
  node -e '
    const [list,name]=[process.argv[1],process.argv[2]||""];
    const churches=list.split(",").map(s=>s.trim()).filter(Boolean).map(npub=>({npub,name}));
    require("fs").writeFileSync(process.argv[3],JSON.stringify({churches},null,2)+"\n");
  ' "$CHURCH" "$CHURCH_NAME" "$DIR/relay/church.json"
  ok "write policy set ($(echo "$CHURCH" | tr ',' '\n' | grep -c .) church key(s))"
else
  [ -s "$DIR/relay/church.json" ] || echo '{"churches":[]}' > "$DIR/relay/church.json"
  warn "no church key set yet — the relay is open until you add one to $DIR/relay/church.json and restart"
fi
chown -R "$SVC_USER:$SVC_USER" "$DIR"

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
Restart=always
RestartSec=3
# hardening: the relay only needs its own dir
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DIR/relay
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"   # restart (not just enable --now) so re-running the installer loads new code
sleep 2
systemctl is-active --quiet "$SVC" && ok "relay running on port $PORT (starts on boot)" || die "service failed to start — check: journalctl -u $SVC"

# ── reachability ─────────────────────────────────────────────────────────────────
# Default: install Tailscale and grant the relay permission to manage it, so the operator
# finishes exposure from the browser ("Go public" in the dashboard) with no terminal at all.
# cloudflared / LAN-only stay available via --tunnel for advanced/non-interactive installs.
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
case "$TUNNEL" in
  none)
    ok "LAN-only for now — turn on public access anytime from the dashboard's 'Go public' button"
    ;;
  cloudflared)
    say "Setting up a Cloudflare quick tunnel"
    if ! command -v cloudflared >/dev/null 2>&1; then
      ARCH="$(dpkg --print-architecture)"
      curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" -o /usr/local/bin/cloudflared
      chmod +x /usr/local/bin/cloudflared
    fi
    ok "cloudflared installed"
    cat > "/etc/systemd/system/$SVC-tunnel.service" <<UNIT
[Unit]
Description=TrinityOne Relay tunnel (cloudflared quick tunnel)
After=$SVC.service
Requires=$SVC.service
[Service]
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://localhost:$PORT
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload; systemctl enable --now "$SVC-tunnel" >/dev/null 2>&1 || true
    ok "tunnel service started"
    warn "Find your public URL with:  journalctl -u $SVC-tunnel | grep trycloudflare"
    warn "Quick-tunnel URLs are random and change on restart — use a named Cloudflare tunnel for a stable address."
    ;;
  *)  # default (and --tunnel tailscale): prepare one-click public access from the browser
    say "Preparing one-click public access (Tailscale)"
    command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
    ok "Tailscale installed"
    if tailscale set --operator="$SVC_USER" >/dev/null 2>&1; then
      ok "the relay can manage Tailscale — you'll finish going public in the browser, no terminal"
    else
      warn "couldn't grant operator automatically; if the dashboard asks, run once: sudo tailscale set --operator=$SVC_USER"
    fi
    ;;
esac

# ── done ────────────────────────────────────────────────────────────────────────
ADMIN_TOKEN="$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).token||"")}catch(e){}' "$DIR/relay/admin.json" 2>/dev/null || true)"
say "Done — finish in the browser (no more terminal)."
echo "  Open the dashboard:  http://${LAN_IP:-localhost}:$PORT/relay-app/control.html"
echo
echo "  There you'll:"
echo "    1) Paste the admin token below to unlock it"
echo "    2) Click 'Connect to Tailscale' → 'Make it public'  (gives you a public https:// URL)"
echo "    3) Add your church's npub so the relay accepts its posts"
echo
echo "  Admin token (keep it private):"
echo "      ${ADMIN_TOKEN:-<see: journalctl -u $SVC | grep \"admin token\">}"
echo
echo "  Manage:  systemctl status $SVC   ·   journalctl -u $SVC -f"
echo "  (Advanced: --tunnel cloudflared|none, or set keys with --church npub1…)"
echo
