#!/usr/bin/env bash
# TrinityOne Relay — one-line installer for any Debian/Ubuntu/Raspberry Pi OS box.
#
#   curl -fsSL https://raw.githubusercontent.com/swasb-altFreeBird/Machaira_TrinityOne/main/relay-app/install.sh | sudo bash
#
# Sets up the gateway (relay + app + browser control dashboard) as a systemd service that starts on
# boot, then optionally brings up a tunnel so the relay is reachable from outside the church LAN.
# Not Pi-specific — it just needs an apt-based Linux box (a Pi, mini-PC, old laptop, or a VPS).
#
# Flags (all optional; prompts on a TTY when omitted):
#   --church <npub[,npub...]>   church key(s) allowed to publish (the relay's write policy)
#   --name   <"Church name">    label shown in the control dashboard (single church)
#   --tunnel <tailscale|cloudflared|none>   how to expose it (default: ask, else none/LAN-only)
#   --port   <n>                listen port (default 8000)
#   --dir    <path>             install dir (default /opt/trinityone)
#   --branch <name>             git branch to install (default main)
#   -y                          non-interactive: accept defaults, no prompts
set -euo pipefail

REPO="https://github.com/swasb-altFreeBird/Machaira_TrinityOne"
DIR="/opt/trinityone"; PORT="8000"; BRANCH="main"
CHURCH=""; CHURCH_NAME=""; TUNNEL=""; ASSUME_YES=0
SVC_USER="trinityone"; SVC="trinityone-relay"

while [ $# -gt 0 ]; do
  case "$1" in
    --church) CHURCH="$2"; shift 2;;
    --name)   CHURCH_NAME="$2"; shift 2;;
    --tunnel) TUNNEL="$2"; shift 2;;
    --port)   PORT="$2"; shift 2;;
    --dir)    DIR="$2"; shift 2;;
    --branch) BRANCH="$2"; shift 2;;
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
command -v git >/dev/null 2>&1 || { apt-get install -y git >/dev/null; ok "git installed"; }

# ── service user ────────────────────────────────────────────────────────────────
if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DIR" --shell /usr/sbin/nologin "$SVC_USER"
  ok "created service user '$SVC_USER' (runs the relay with no login/privileges)"
fi

# ── fetch / update the app ──────────────────────────────────────────────────────
say "Fetching the app into $DIR (branch: $BRANCH)"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch --depth 1 origin "$BRANCH" -q && git -C "$DIR" checkout -q -f "$BRANCH" && git -C "$DIR" reset --hard -q "origin/$BRANCH"; ok "updated existing install"
else mkdir -p "$DIR"; git clone --depth 1 -b "$BRANCH" "$REPO" "$DIR" -q; ok "cloned"; fi

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
systemctl enable --now "$SVC" >/dev/null 2>&1
sleep 2
systemctl is-active --quiet "$SVC" && ok "relay running on port $PORT (starts on boot)" || die "service failed to start — check: journalctl -u $SVC"

# ── tunnel (operator-selectable) ────────────────────────────────────────────────
if [ -z "$TUNNEL" ]; then
  echo; echo "  Reachability — how should the relay be reached from outside the church LAN?"
  echo "    1) Tailscale   (rock-solid; one login)"
  echo "    2) Cloudflare  (cloudflared quick tunnel; no account, random URL)"
  echo "    3) LAN only    (this network only; add a tunnel later)"
  case "$(ask '  Choose [1/2/3] (default 3): ' '3')" in
    1) TUNNEL=tailscale;; 2) TUNNEL=cloudflared;; *) TUNNEL=none;;
  esac
fi

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
case "$TUNNEL" in
  tailscale)
    say "Setting up Tailscale"
    command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
    ok "Tailscale installed"
    warn "Final step needs you (one-time login). Run:"
    echo "      sudo tailscale up"
    echo "      sudo tailscale funnel $PORT      # public HTTPS URL, or 'serve' for tailnet-only"
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
  none|*)
    ok "LAN-only for now"
    ;;
esac

# ── done ────────────────────────────────────────────────────────────────────────
ADMIN_TOKEN="$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).token||"")}catch(e){}' "$DIR/relay/admin.json" 2>/dev/null || true)"
say "Done."
echo "  Control dashboard:  http://${LAN_IP:-localhost}:$PORT/relay-app/control.html"
echo "  Member relay URL:   ws://${LAN_IP:-localhost}:$PORT/relay   (wss:// once a tunnel is up)"
echo "  Manage:             systemctl status $SVC   ·   journalctl -u $SVC -f"
echo
echo "  Set up your church(es) in the browser — open the control dashboard and paste your npub."
echo "  On the relay box itself no token is needed; from another device, enter this admin token:"
echo "      ${ADMIN_TOKEN:-<see: journalctl -u $SVC | grep \"admin token\">}"
echo "  (Or set keys non-interactively any time: re-run with --church npub1…)"
echo
