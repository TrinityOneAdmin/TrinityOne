# TrinityOne

A warm, offline-first **Bible study app** with **fellowship chat** and **Lightning giving**,
built on open protocols. Reader + modules work fully offline; chat, giving, and identity run on
**Nostr** with self-custodial keys — no account, no email, no central server.

Pilot church: **Trinity, Littlehampton**. Working name for the network layer: *Koinonia*.

## What works today
- **Reader** — MySword (`.bbl.mybible`) + Open.Bible (USFM) modules, Strong's numbers,
  red-letter, footnotes, highlights/notes/bookmarks, cross-refs, commentary, share.
- **Modules** — a download-once store: a curated set + a **live eBible.org mirror**
  (1,290 translations / 1,023 languages), cached in IndexedDB.
- **Today / Plans / Search / Watch** — verse-of-the-day, real reading plans (open-to-passage,
  progress), fast full-text search across installed translations, Trinity's YouTube videos.
- **Fellowship (Nostr)** — self-custodial BIP-39/NIP-06 identity (secure store on device),
  group chat, 1:1 direct messages (NIP-04), invite-only groups, profiles (kind-0 names/avatars),
  reactions (NIP-25), prayer attachments, sharing verses/devotionals/notes into groups, chat
  search, configurable relays.
- **Giving** — a self-custodial Cashu ecash + Lightning wallet on the member's own key (add /
  give / withdraw), per-church giving toggle; the church receives to its kind-0 Lightning address.
- **Notifications** — web-push for DMs, church announcements, and serving requests (VAPID), plus
  local serving reminders; per-category settings, all member-controlled.
- **Steward console** — a separate surface (`steward.html`) to set up and run a church, with its
  own APK fallback.
- **Offline** — React/Babel/sql.js/fonts all vendored locally; boots with zero network.
- **Halo** brand + animated boot splash; Android APK via Capacitor.

## Architecture (no bundler)
The app is plain `index.html` + `engine.js` + `*.jsx` transpiled in-browser by Babel
(`@babel/standalone`). Two bundled modules are built with esbuild:
- `vendor/identity.js` ← `src/identity.src.js` — `window.TrinityIdentity` (BIP-39 → NIP-06).
- `vendor/fellowship.js` ← `src/fellowship.src.js` — `window.Fellowship` (Nostr transport).
- `engine.js` exposes `window.Bible`; `data.jsx` exposes `window.TrinityData`.

## Run it (dev)
```bash
npm install
node relay/dev-relay.mjs &              # local Nostr relay (chat) on ws://127.0.0.1:7447
python3 -m http.server 8000             # serve the app from the repo root
# open http://localhost:8000
```
Chat needs the dev relay running. To go multi-device, deploy a real relay (`relay/deploy/`)
and add its `wss://` URL in-app (Chat → identity → RELAYS).

## Build the Android APK
```bash
source scripts/android-env.sh           # JDK 17 + Android SDK
bash scripts/sync-web.sh                # populate www/
npx cap add android                     # first time (regenerates the native project)
cd android && ./gradlew assembleDebug   # -> app/build/outputs/apk/debug/app-debug.apk
```
appId `com.trinityone.app`. iOS later via `npx cap add ios` (same `www/`).

## Scripts
- `scripts/build-vendor.sh` — vendor React/Babel/sql.js/fflate/fonts (offline).
- `scripts/build-identity.sh` / `build-fellowship.sh` — esbuild the Nostr bundles.
- `scripts/build-ebible-catalog.py` — refresh the eBible mirror index.
- `scripts/build-trinity-videos.py` — refresh the church video snapshot.
- `scripts/sync-web.sh` — assemble `www/` for the APK.
- `scripts/android-env.sh` — toolchain env.

## Privacy model (in brief)
No login. The identity key (BIP-39 mnemonic → Nostr key) lives in the **OS secure store** on
device (ephemeral in browser dev — never `localStorage`). Display name/avatar are public
(Nostr kind-0). Study data (notes/highlights/plans) is device-local. Chat lives on the relay.
Lost device + no backed-up phrase = lost identity (the deliberate cost of no middleman).

## Layout
- `engine.js`, `app.jsx`, `screens-*.jsx`, `ui.jsx`, `icons.jsx`, `data.jsx` — the app.
- `src/`, `vendor/` — esbuild sources + bundled/vendored libs.
- `relay/` — local dev relay + `relay/deploy/` hosted relay.
- `scripts/` — build/catalog/toolchain scripts.
- `modules/`, `catalog.json`, `ebible-catalog.json`, `trinity-videos.json` — content/catalogs.
- `reference/` — specs, roadmap, design handoffs & briefs.

## Roadmap & specs
See `reference/`: `trinityone-fellowship-spec.md` (technical build spec),
`trinityone-release-roadmap.md` (user-facing stages 0–6), `TrinityOne-design-notes.md`,
`brief-identity-profile.md`.
