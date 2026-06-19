#!/usr/bin/env bash
# Cloudflare quick tunnel to the gateway; records the public URL to relay/tunnel-url.txt.
# (Quick-tunnel URLs are EPHEMERAL -- they change on restart. A stable URL needs Tailscale Funnel
#  or a named Cloudflare tunnel -- see HOSTING.md.)
URLFILE="$(cd "$(dirname "$0")/.." && pwd)/relay/tunnel-url.txt"
exec "$HOME/.local/bin/cloudflared" tunnel --no-autoupdate --url http://localhost:8000 2>&1 \
  | while IFS= read -r line; do
      echo "$line"
      u=$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)
      [ -n "$u" ] && printf '%s\n' "$u" > "$URLFILE"
    done
