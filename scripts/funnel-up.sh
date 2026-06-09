#!/bin/bash
# Expose the TrinityOne gateway (localhost:8000) on a STABLE public HTTPS URL via Tailscale Funnel.
#
# Prereqs (one-time, in the Tailscale admin console — only the tailnet owner can do these):
#   1. DNS -> "Enable HTTPS"            https://login.tailscale.com/admin/dns
#   2. Access Controls -> grant the "funnel" node attribute to this machine, e.g.:
#        "nodeAttrs": [ { "target": ["autogroup:member"], "attr": ["funnel"] } ]
#                                        https://login.tailscale.com/admin/acls
#
# With --bg the funnel config is stored by tailscaled and auto-restored on reboot — set once.
# The resulting URL is https://<this-host>.<tailnet>.ts.net  (relay rides the same URL as wss://.../relay).
set -e

PORT="${1:-8000}"

URL="https://$(tailscale status --json | sed -n 's/.*"DNSName": "\([^"]*\)\.".*/\1/p' | head -1)"

echo "Pointing Tailscale Funnel at the gateway on port ${PORT}…"
# needs sudo unless 'tailscale set --operator=$USER' has been run
tailscale funnel --bg "${PORT}"

echo ""
echo "Funnel status:"
tailscale funnel status
echo ""
echo "TrinityOne is live at:  ${URL}"
echo "  member app : ${URL}/"
echo "  steward    : ${URL}/steward.html"
echo "  relay      : ${URL}/relay  (wss)"
