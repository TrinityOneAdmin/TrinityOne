#!/usr/bin/env bash
# On-device UI smoke: launch the installed app, attach to its webview (adb + CDP) and run the crawl in
# scripts/smoke-device.mjs — visits every tab, opens every chat group, works the composer, and clicks every
# control, flagging render crashes / uncaught errors. Needs a connected device with the app installed.
#
#   scripts/smoke-device.sh [package]     default package: com.trinityone.app  (use com.trinityone.steward too)
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PKG="${1:-com.trinityone.app}"
PORT=9223

adb devices | grep -q 'device$' || { echo "smoke-device: no device connected"; exit 2; }
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 8
PID=$(adb shell pidof "$PKG" | tr -d '\r')
[ -n "$PID" ] || { echo "smoke-device: $PKG is not running (installed?)"; exit 2; }
adb forward tcp:$PORT localabstract:webview_devtools_remote_$PID >/dev/null 2>&1
sleep 1
WS=$(curl -s --max-time 5 http://localhost:$PORT/json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);const p=a.find(t=>t.type==="page"&&!/devtools/.test(t.url));console.log((p||{}).webSocketDebuggerUrl||"")}catch(e){}})')
[ -n "$WS" ] || { echo "smoke-device: could not reach the webview inspector"; adb forward --remove tcp:$PORT >/dev/null 2>&1; exit 2; }

echo "smoke-device: crawling $PKG …"
node "$DIR/scripts/smoke-device.mjs" "$WS"; RC=$?
adb forward --remove tcp:$PORT >/dev/null 2>&1
exit $RC
