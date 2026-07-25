#!/usr/bin/env bash
# Put the test phone on wireless adb so on-device testing doesn't need a cable.
#
#   scripts/device-connect.sh pair 192.168.1.50:37123 429518   # Android 11+ Wireless debugging (PREFERRED)
#   scripts/device-connect.sh 100.x.y.z                        # connect to an already-paired/armed device
#   scripts/device-connect.sh                                  # phone plugged in: arm legacy `adb tcpip`
#
# PREFERRED PATH — Android's built-in Wireless debugging (survives reboots, no cable ever):
#   Phone: Settings → Developer options → Wireless debugging → ON
#          → "Pair device with pairing code"  (shows an ip:port and a 6-digit code)
#   Here:  scripts/device-connect.sh pair <ip:pairing-port> <code>
#   Then the main screen shows a DIFFERENT ip:port for the connection — the script connects to it for you.
#
# WHY. Every on-device check (CDP bridge, boot checks, care/chat round-trips) needs `adb`, and adb over USB
# means the phone must be physically at the dev box. Wireless adb over Tailscale means it can be anywhere.
#
# CAVEAT: `adb tcpip` does NOT survive a phone reboot — re-run this with the cable once after each reboot.
# On Android 11+ you can instead use Settings → Developer options → Wireless debugging (pair once, no cable),
# which does persist; this script is the cable-once path that works on every version.
#
# SECURITY: port 5555 accepts adb from anything that can reach it, with no authentication. Only ever expose it
# on a tailnet (or a trusted LAN) — never port-forward it, and never leave it armed on a phone that carries a
# real identity. This is a TEST device workflow.
set -euo pipefail
PORT=5555

# Android 11+ pairing: `adb pair` takes a one-time code and a DIFFERENT port from the connect port.
if [ "${1:-}" = "pair" ]; then
  ADDR="${2:-}"; CODE="${3:-}"
  [ -n "$ADDR" ] && [ -n "$CODE" ] || { echo "usage: $0 pair <ip:pairing-port> <6-digit-code>" >&2; exit 1; }
  echo "pairing with $ADDR …"
  printf '%s\n' "$CODE" | adb pair "$ADDR"
  HOST="${ADDR%%:*}"
  echo
  echo "Paired. Now connecting — the phone's Wireless debugging screen shows the CONNECT port"
  echo "(different from the pairing port)."
  read -r -p "  connect port for $HOST [37000]: " CPORT || true
  CPORT="${CPORT:-37000}"
  adb connect "$HOST:$CPORT" && adb devices
  echo
  echo "Reconnect later with:  scripts/device-connect.sh $HOST:$CPORT"
  exit 0
fi

# An explicit host:port (Wireless debugging uses a random high port, so accept both forms).
if [ $# -ge 1 ] && [[ "$1" == *:* ]]; then
  echo "connecting to $1 …"; adb connect "$1"; adb devices; exit 0
fi

if [ $# -ge 1 ]; then
  TARGET="$1"
  echo "connecting to $TARGET:$PORT …"
  adb connect "$TARGET:$PORT"
  adb devices
  exit 0
fi

# No address given: expect a USB device, arm wireless adb, and work out where to reach it.
if ! adb devices | grep -qw device; then
  echo "No USB device. Plug the phone in (and accept the debugging prompt), or pass an address:" >&2
  echo "  scripts/device-connect.sh 100.x.y.z" >&2
  exit 1
fi

echo "arming wireless adb on port $PORT …"
adb tcpip "$PORT" >/dev/null
sleep 2

# The phone's own view of its addresses. Tailscale on Android runs as a VpnService, so its 100.x address is
# usually NOT visible here without root — if this finds nothing, read the address off the Tailscale app (or
# `tailscale status` on this box once the phone has joined the same tailnet) and pass it as an argument.
LAN=$(adb shell ip -4 addr 2>/dev/null | grep -oE 'inet (192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))[0-9.]*' | awk '{print $2}' | head -1 || true)
TS=$(adb shell ip -4 addr 2>/dev/null | grep -oE 'inet 100\.[0-9.]+' | awk '{print $2}' | head -1 || true)

for ip in "$TS" "$LAN"; do
  [ -n "$ip" ] || continue
  echo "trying $ip …"
  if adb connect "$ip:$PORT" | grep -qE 'connected|already'; then
    echo
    echo "Connected. You can unplug the cable."
    echo "  reconnect later:  scripts/device-connect.sh $ip"
    adb devices
    exit 0
  fi
done

echo
echo "Wireless adb is armed, but I couldn't work out the phone's address from here."
echo "Find it in the Tailscale app (or run 'tailscale status' on this box once the phone has joined this"
echo "tailnet — it currently shows only the Linux nodes), then:"
echo "  scripts/device-connect.sh <address>"
