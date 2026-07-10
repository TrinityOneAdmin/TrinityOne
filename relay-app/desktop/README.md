# TrinityOne Relay — desktop app (Tauri 2)

The double-click installer (`.dmg` / `.exe` / `.AppImage`) that lets a church self-host its relay with no
terminal and no Node install. It wraps a **bundled Node runtime** running the gateway
(`scripts/gateway.mjs`) and shows the relay's own **control panel** (`../control.html`) in a native window.

## How it works
- **Payload (read-only code).** `scripts/build-relay-payload.sh` assembles the exact tree the gateway needs
  to serve — the pre-transpiled web app + `scripts/` + a **minimal** `node_modules` (only `ws`,
  `nostr-tools`, `web-push`; everything else the gateway uses is a Node built-in). No secrets, no git, no
  data dir. It's bundled as a Tauri resource, so at runtime it lives at `resources/payload/`.
- **Node runtime (the sidecar).** `scripts/fetch-node-sidecar.sh <triple>` downloads the official Node
  binary and installs it as `src-tauri/binaries/trinityone-relay-<target-triple>[.exe]` — the name Tauri
  resolves for `externalBin`. So the user needs no Node of their own.
- **Data (writable).** The gateway now honours `TRINITY_DATA_DIR` (see `scripts/gateway.mjs`). The shell
  points it at the OS per-user app-data dir (`app_data_dir()/data`), so the relay's db, keys, church.json
  and blobs live there while the app code stays read-only inside the install. Unset, the gateway falls back
  to `ROOT/relay` exactly as before (every server relay is unaffected).
- **Window.** `src-tauri/src/main.rs` spawns the sidecar (`node payload/scripts/gateway.mjs 8787`), shows a
  splash immediately, waits for the port to accept connections, then navigates the window to
  `http://localhost:8787/relay-app/control.html` — same-origin, so `/status` and the dashboard just work.
  On close it kills the relay child.

## Build
Don't build by hand for release — push a tag and let CI do all three platforms (see below). To build one
platform locally for testing:
```bash
# from the repo root
npm ci                                                   # esbuild, for the payload transpile
bash scripts/build-relay-payload.sh relay-app/desktop/src-tauri/payload
bash scripts/fetch-node-sidecar.sh                       # host triple (needs rustc); or pass one explicitly
cd relay-app/desktop
npx @tauri-apps/cli@2 icon src-tauri/app-icon.png        # generates src-tauri/icons/*
npx @tauri-apps/cli@2 build                              # installers in src-tauri/target/**/bundle/
# Linux system deps: sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
#   libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

## Release (CI)
`.github/workflows/relay-desktop.yml` builds a 4-way matrix — Linux (`x86_64`), macOS Intel + Apple
Silicon, Windows (`x86_64`) — each on its own native runner. **No Mac or Windows machine required.**
- **Push a tag `relay-v1.2.3`** → builds all platforms and attaches the installers to a GitHub Release.
- **Run workflow (manual)** → builds all platforms, uploads them as artifacts (no release) — use to test.

`.github/workflows/` is gitignored in this repo, so the workflow is force-added; it only *runs* on a
`relay-v*` tag or a manual dispatch, so having the file in the tree triggers no build.

## Not wired yet (deliberate)
- **Signing / notarization.** Installers build unsigned — they work but warn on first open (macOS
  Gatekeeper, Windows SmartScreen). Adding an Apple Developer cert (~$99/yr) + a Windows Authenticode cert
  removes the warnings; slot the secrets into the workflow when ready. Linux `.AppImage` needs none.
- **Bundled tunnel** (reachable-from-anywhere without a separate Tailscale/cloudflared install), tray icon,
  autostart, in-app auto-update. Roadmap.

## First-CI-run notes
Cross-platform Tauri usually needs a pass or two to settle. Most likely knobs:
- `NODE_VERSION` in the workflow must be a real `nodejs.org/dist` version (pinned to one with `node:sqlite`).
- macOS resource-signing may complain about the bundled node binary until signing is configured.
