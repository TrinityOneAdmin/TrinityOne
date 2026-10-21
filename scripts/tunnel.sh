#!/usr/bin/env bash
# Public tunnel to the gateway on localhost:8000.
#
# Prefers a STABLE named Cloudflare tunnel (a fixed hostname that survives restarts) when one has been
# configured on this box; otherwise falls back to an EPHEMERAL quick tunnel. Quick-tunnel URLs change on
# every restart (see docs/ops/HOSTING.md) — which silently broke the dev/test relay's address and the
# church records that pointed at it, so a named tunnel is preferred wherever this box is reachably hosted.
#
# SETUP (dashboard-managed tunnel): create the tunnel in the Cloudflare Zero Trust dashboard, add a public
# hostname (e.g. test.trinityone.church -> HTTP localhost:8000), copy the connector TOKEN, and save it to the
# token file below (never in the repo — it grants account access):
#     umask 077; cat > ~/.cloudflared/trinity-tunnel.token      # paste the token, Enter, Ctrl-D
# then: systemctl --user restart trinity-tunnel.service
# Routing (which hostname -> which local service) is managed in the dashboard, so no --url is needed here.
URLFILE="$(cd "$(dirname "$0")/.." && pwd)/relay/tunnel-url.txt"
CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
TOKEN_FILE="${TRINITY_TUNNEL_TOKEN_FILE:-$HOME/.cloudflared/trinity-tunnel.token}"
HOST_STABLE="${TRINITY_TUNNEL_HOSTNAME:-test.trinityone.church}"

# Named (dashboard-managed) tunnel, if its token has been saved on this box. Safe to ship before setup: with
# no token file we fall through to the quick tunnel, so the service never fail-loops on a missing token.
if [ -s "$TOKEN_FILE" ]; then
  printf 'https://%s\n' "$HOST_STABLE" > "$URLFILE"
  echo "[tunnel] stable Cloudflare tunnel -> https://$HOST_STABLE"
  exec "$CF" tunnel --no-autoupdate run --token "$(cat "$TOKEN_FILE")"
fi

# Fallback: ephemeral quick tunnel (URL changes on every restart; recorded for whoever needs the current one).
echo "[tunnel] no tunnel token at $TOKEN_FILE — using an EPHEMERAL quick tunnel (its URL changes on restart)"
exec "$CF" tunnel --no-autoupdate --url http://localhost:8000 2>&1 \
  | while IFS= read -r line; do
      echo "$line"
      u=$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)
      [ -n "$u" ] && printf '%s\n' "$u" > "$URLFILE"
    done
