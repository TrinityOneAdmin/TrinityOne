# TrinityOne Relay — desktop shell (v0.7.1, Tauri)

The native installer that wraps the **runnable core** (`../start.mjs`) and the **control GUI**
(`../control.html`) into a double-click app for Windows / Mac / Linux. Decisions locked:
**NIP-01 relay (`scripts/gateway.mjs`) · Tailscale tunnel · Tauri.**

> Scaffold only — this is **not built in the repo CI yet**. Building it needs the Tauri toolchain +
> per-OS build hosts (signed installers can't be cross-compiled). The GUI it loads (`control.html`)
> and the relay it runs (`gateway.mjs`) are done and verified.

## Architecture
- **Window** = the control GUI. The Rust backend spawns the relay, waits for it to listen, then opens
  the window at `http://localhost:<port>/relay-app/control.html?public=<detected-base>` — so `/status`
  is same-origin and the dashboard "just works."
- **Relay** = `scripts/gateway.mjs`, shipped as a **bundled Node sidecar** so the user needs no Node
  installed (compile it once per OS with `node --experimental-sea` or `pkg` into
  `src-tauri/binaries/trinityone-relay-<target-triple>`). Until then it shells out to system `node`.
- **Tunnel (v0.7.2)** = bundle Tailscale (or `cloudflared`) and bring it up on first run so "reachable
  from anywhere" needs no separate install. For now, if the steward already runs Tailscale Funnel, the
  dashboard shows "Reachable from anywhere"; otherwise it shows the LAN-only warning.
- **Tray + autostart + auto-update** = Tauri tray plugin + `tauri-plugin-autostart` + the Tauri updater.

## Build (on each target OS)
```bash
# system deps — Linux: sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev \
#   libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
# Rust: https://rustup.rs   ·   Tauri CLI:
npm i -D @tauri-apps/cli
# dev (loads control.html against a locally-run gateway):
npx tauri dev
# release installers (.dmg / .msi|.exe / .AppImage|.deb):
npx tauri build
```
Mac needs an Apple Developer cert for notarization; Windows wants an Authenticode cert. CI matrix
(macos/windows/ubuntu runners) produces all three from one tag.

## Files here
- `src-tauri/tauri.conf.json` — app id `com.trinityone.relay`, window, bundle targets.
- `src-tauri/src/main.rs` — spawns the relay child, opens the control window, kills the child on exit.
- `src-tauri/Cargo.toml` — Tauri 2 deps.

## Status / next
- ✅ Control GUI (`../control.html`) + `/status` endpoint — built, verified live.
- ✅ Runnable launcher (`../start.mjs`) — opens the GUI, reports reachability.
- ☐ This shell: finalize against the installed Tauri 2 CLI, add the Node sidecar build, icons, tray,
  updater; set up the CI release matrix.
- ☐ v0.7.2: bundle the tunnel.
