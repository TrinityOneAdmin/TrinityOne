# TrinityOne — Session Handoff

> Written 2026-06-10 for picking the project back up in **Claude Code on Desktop (remote)**.
> Read this top to bottom once; it is the single source of "everything the session should know."

---

## 0. TL;DR — orient in 60 seconds

- **What:** TrinityOne — an **offline-first, self-custodial Bible-study app with anonymous Nostr fellowship chat** for churches. Built on the Nostr protocol; the church runs its own relay; no accounts, no tracking.
- **Two surfaces, one repo:**
  - **Member app** — phone app (`index.html` + `*.jsx`), shipped as a PWA **and** an Android **APK** (Capacitor).
  - **Steward console** — desktop web (`steward.html` + `stew-*.jsx`) the church leader runs.
- **Pilot church:** **Trinity Church Littlehampton**, npub `npub1xs306y87gxlf59nf9mpta0hkfg9p6e97ksefnulys0qkelqp7kjqyxywme` (hex `3422fd10fe41…`).
- **Repo:** `https://github.com/swasb-altFreeBird/Machaira_TrinityOne` (**private**), branch **`main`**.
- **Working dir on this box:** `/mnt/storage/projects/lumen-bible` (the folder is historically named "lumen-bible"; the product is "TrinityOne").
- **Live hosting:** self-hosted gateway (systemd) → **Tailscale Funnel** at `https://trinityone.tailbeaac0.ts.net`.
- **APK download (always-fresh):** `https://trinityone.tailbeaac0.ts.net/trinityone-debug.apk`
- **Read next:** `reference/SPINE.md` (architecture/roadmap canon) and `reference/trinityone-release-roadmap.md` (stage gates).

---

## 1. The SPINE (what this is and where it's going)

`reference/SPINE.md` is the canonical architecture + roadmap doc. The shape of it:

- **User-owned data over Nostr.** Identity is a keypair (12-word BIP-39 phrase). Church identity is also a keypair. Whoever holds the key *is* that member/church — self-custodial, no server account.
- **The church runs its own relay** (the "gateway", see §4). It is the source of truth. Members can also add public relays.
- **Privacy posture:** "anonymous when you want to be," but the load-bearing value is **uncensorable / signed / self-hosted**, not forced anonymity. Real-world identity is never shown unless a member chooses a display name.
- **Tiered rollout** (`reference/trinityone-release-roadmap.md`): Stage 0 **Dogfood** → 1 Closed Alpha → 2 **Pilot Beta (Littlehampton)** → 3 Multi-Church → 4 Giving Pilot → 5 Network Release → 6 iOS + E2E privacy. **We are in Stage 0→1**: getting the core flows solid on real devices with the pilot church before widening. Money (giving) and federation come **last**.

**Product goal right now:** make the pilot church (Littlehampton) able to run a real week — read, broadcast, group chat, reading plans/devotionals, **serving rota + calendar**, and direct steward↔member messages — on real phones, with **no data loss** and **working backup/restore**.

Other reference docs worth knowing:
- `reference/proposal-relay-app-steward-console.md` — the steward console + signer model (pilot holds the key in localStorage; a "Keykeeper" NIP-07/NIP-46 signer is the productization).
- `reference/proposal-mydata-nostr-backend.md` — how local study data (highlights/notes/journal) is owned + (future) synced over Nostr.
- `reference/trinityone-fellowship-spec.md`, `reference/TrinityOne-design-notes.md`, `reference/giving-treasury-prep.md`.

---

## 2. Repo, environment, and the two apps

| Thing | Value |
|---|---|
| Repo | `github.com/swasb-altFreeBird/Machaira_TrinityOne` (private), branch `main` |
| Working dir | `/mnt/storage/projects/lumen-bible` |
| Node | v22.22.2 (via nvm) |
| Member app entry | `index.html` (loads `*.jsx` via runtime Babel in dev; **pre-transpiled with esbuild** for the APK) |
| Steward console entry | `steward.html` (loads `stew-*.jsx` via runtime Babel — desktop browser only, no APK) |
| Member globals | `window.Fellowship`, `window.TrinityIdentity`, `window.MyData`, `window.TrinityData`, `window.TrinityReminders`, `window.TrinityBackup` |
| Steward globals | `window.Steward`, `window.SK`, `useStewardGroups/Members/Services/Rosters/Rotas/Events/...` hooks (`steward-root.jsx`) |
| Android project | `android/` (Capacitor, app id `com.trinityone.app`). **`android/` is gitignored** except a few force-added files (e.g. `AndroidManifest.xml` CAMERA perm). |
| Android toolchain | `/mnt/storage/android-tools`, sourced via `scripts/android-env.sh` |

### Build pipeline (important nuance)
- **Dev / desktop browser:** `.jsx` files are transpiled by `@babel/standalone` **at runtime** in the browser. The gateway serves the project root, so editing a `.jsx` is live on reload.
- **APK:** runtime Babel **breaks in the Capacitor webview**, so `scripts/sync-web.sh` **pre-transpiles every `.jsx` → plain `.js` with esbuild** into `www/`, rewrites `index.html` to drop Babel, then runs `npx cap sync android`. The APK ships `www/`.
- **Engines** (`window.Fellowship`, `window.Steward`, `window.MyData`, `window.TrinityIdentity`) are **esbuild bundles**: `src/*.src.js` → `vendor/*.js` via `scripts/build-*.sh`. **If you edit `src/fellowship.src.js` or `src/steward.src.js` you MUST rebuild** (`bash scripts/build-fellowship.sh` / `build-steward.sh`) — editing the `src` alone does nothing until rebuilt.

---

## 3. Architecture & data model

### The Nostr event model (the contract between member app and console)
All church data is **kind-30078 (NIP-78 addressable)**, `d`-tagged. Chat is **kind-1**, DMs **kind-4 (NIP-04)**, reactions **kind-7**.

Church-published (signed by the church key), **`d` prefixes**:
- `trinityone/group:<id>` — chat rooms; `kind:'team'` groups are ministry teams (carry `icon`+`accent`).
- `trinityone/fund:<id>` — giving (parked).
- `trinityone/plan:<id>` — reading plans (full `days[]` in content).
- `trinityone/devotional:<id>` — devotionals (**.txt/.md text only**, no PDF).
- `trinityone/roster:<teamId>` — a team's roles[] + people[{name,pub?}].
- `trinityone/service:<id>` — a dated gathering.
- `trinityone/rota:<serviceId>` — per-service assignments `{published, assign:{'team::role':{name,pub}}}`.
- `trinityone/event:<id>` — calendar event.
- `trinityone/request:<id>` — steward→member "can you serve?" (`p`-tagged to the member).

Member-authored (allowed by the relay because they're the author's own docs):
- `trinityone/member:<churchPub>` — membership presence (announceMembership).
- `trinityone/reqreply:<requestId>`, `trinityone/rsvp:<eventId>`, `trinityone/unavail:<memberPub>` — accept/decline/swap, RSVP, away dates. All `p`-tagged to the church.

**Chat scope tag (load-bearing):** every kind-1 in a group MUST carry `['t',<groupId>]`, `['t','trinityone']`, **and `['p',<churchPub>]`** — the member's `subscribeGroup` filters by the `p` tag. (A real bug we fixed: the steward's `publishPost` was missing `['p',church]`, so announcements were invisible to members.)

### Member ↔ Steward identity
- Member identity key: 12-word phrase in the OS **secure store** on the APK (`@aparajita/capacitor-secure-storage`), ephemeral on web. `window.TrinityIdentity.exportMnemonic()/importMnemonic()`.
- Church key: 12-word phrase in **localStorage** (pilot custody). `window.Steward.exportMnemonic()/restoreKey()`.

### Gateway write policy (the relay's enforcement)
`scripts/gateway.mjs` is a static file server **+ an embedded NIP-01 relay at `/relay`**. When `relay/church.json` (or env `CHURCH_NPUB`) is set, it enforces:
- Only the **church key** may define `group:/fund:/plan:/devotional:/roster:/service:/rota:/event:/request:` and post to **broadcast** groups.
- Only **joined members** (or the church) may post kind-1/4/7 and their own member-authored docs.
- Anyone may announce membership + set their kind-0 profile.
- It also web-pushes a member on accepted `request:` events (VAPID, see §4).

---

## 4. Infrastructure & deployment

### The gateway (single process that does everything)
- Run by **systemd user service `trinity-gateway`** → `node scripts/gateway.mjs 8000`, `WorkingDirectory=/mnt/storage/projects/lumen-bible`, `Restart=always`.
- Serves the app (project root) + the embedded relay at `ws[s]://<host>/relay` + the APK + `/push/*`.
- `systemctl --user restart trinity-gateway` after editing `gateway.mjs`. Logs: `journalctl --user -u trinity-gateway -f`.

### Runtime state (all gitignored, lives in `relay/`)
- `relay/relay-db.json` — the relay's event store (the church's groups/rota/members/messages). **This is the church's data — back it up.**
- `relay/church.json` — `{npub, name}` enabling enforcement (currently the pilot church).
- `relay/vapid.json` — **secret** web-push keypair.
- `relay/push-subs.json` — member push subscriptions.

### Public hosting — Tailscale Funnel
- URL: **`https://trinityone.tailbeaac0.ts.net`** → proxies to `127.0.0.1:8000`.
- **GOTCHA:** after a node rename / repeated `funnel --bg`, Funnel can show "on" locally but be **NXDOMAIN externally** (the host's MagicDNS hides it → localhost curl gives a false 200). Fix + verify: `scripts/funnel-up.sh` does `tailscale funnel reset && tailscale funnel --bg 8000` then checks **public** DNS via an external DoH resolver. Public ingress IP is `176.58.88.x` (currently `176.58.88.108`) — useful for `curl --resolve` external checks.

### The APK
- `bash scripts/sync-web.sh` (esbuild + cap sync) → `cd android && ./gradlew assembleDebug` → copy to `trinityone-debug.apk` (gitignored, ~27.8 MB), served at `…/trinityone-debug.apk`.
- Native plugins in the build: `@capacitor/local-notifications` (reminders), `@capacitor/filesystem` + `@capacitor/share` (backup), `@aparajita/capacitor-secure-storage` (identity key).
- A GitHub **release/milestone** with an APK exists, but the **Funnel URL above is the freshest** APK; deploy = rebuild + copy over it.

### Service worker / cache
- `sw.js`, cache `trinity-shell-vN` — **currently v13**. **Bump the version on every member deploy** so installed PWAs refresh. SW is **skipped under Capacitor** (the APK doesn't use it; it uses local notifications, not web push).

---

## 5. What's built (progress) — feature inventory

**Member app:**
- Offline-first reader (MySword + USFM, SQLite-WASM), default Bible auto-installs first run, module store (eBible mirror), reading plans, search, concordance/lexicon (full Strong's), highlights/notes/journal/bookmarks (MyData, user-owned).
- **Fellowship chat** over the church relay: groups + teams, prayer flag, reactions, **NIP-04 DMs** (member↔member and church↔member).
- **Follow a church** by npub (scan QR / paste) — this is now the **first-run** path (no sample church anymore).
- **Serving overlay** (`screens-serving.jsx`, `?serving=1`): "you're next serving" hero, accept/decline/swap requests, upcoming, set-unavailable, **Events tab with RSVP**. Entry points on Today + Community.
- **Local reminders** (`reminders.jsx`): "you're serving tomorrow" the evening before — Capacitor LocalNotifications on the APK (fires when closed), Web Notifications fallback.
- **Encrypted backup/restore** (`backup.jsx` / `window.TrinityBackup`): one passphrase-encrypted file (AES-GCM+PBKDF2) = recovery key + local data, saved via the OS share sheet. In the Recovery sheet.

**Steward console:**
- Overview, Groups (groups **and** teams, each with a **Chat** icon → read scrollback + post as the church), **Rota** (coverage board: service strip, gold gaps, tap-to-assign Free/On-rota/Away, **Auto-fill ▾**: this service / create-and-fill month / quarter, Copy last week, Publish), **Calendar** (month grid, day detail, New-event, repeat weekly/monthly until a date), **Resources** (reading plans + .txt/.md devotionals), **Members** (with a **Chat** button → Facebook-style docked encrypted DM windows), Relays (status), Settings.
- **New team** lives on the Rota page (header button), with icon/accent presets + starter roles + roster management.
- **New post** targets any group/team (and carries the required `['p',church]` tag).
- **Church key**: reveal recovery phrase, **restore from recovery phrase / from a backup file**, **back up to a file**, printable paper invite (with blank lines for the member's 12-word phrase).
- **Server web-push** (VAPID) notifies a member when the church sends them a serving request (PWA; the APK relies on local notifications — FCM is the future upgrade).

**Recent commits (newest first):** see `git log`. Headline ones:
`70f36c0` encrypted backup/restore · `c19df73` **fix church key regenerating on reload** · `65bf3f0` **fix APK blank screen** · `5b3f708` clear all mock data · `e789e19` console chat + member DMs + posting fix + rota recurrence/autofill · `68360dc` back button + printable invite · `b97fa94`/`bfb8b6c`/`f6b46aa` the serving/rota/calendar design build (3 phases).

---

## 6. Critical operational knowledge / gotchas

1. **Church key persistence (fixed `c19df73`, but verify the pilot key is intact).** A bug regenerated the console's church key on *every reload* (overwriting the saved one). Symptom was "**members showing 0**." Fixed: `ensureKey` now loads the persisted key first. **Action item:** confirm the console's sidebar npub is `npub1xs306y…`. If a past reload already overwrote it, the pilot key may be lost — use **Settings → Church key → Restore** to re-import it (if the 12-word phrase was saved). The relay shows only `3422fd10` has ever published, with 7 members joined to it.
2. **Make a steward backup now.** Settings → Church key → "Back up to a file". The church identity is one key; protect it.
3. **Headless screenshots can't show relay-loaded data.** Chromium `--virtual-time-budget` advances timers but the live relay **WebSocket round-trip doesn't resolve in virtual time**, so populated rota/chat/member views render *empty* in screenshots. **Verify relay-data features with node E2E or CDP capture, not screenshots** (see §8).
4. **APK first-launch crashes are invisible to `smoke.sh`** — its deep-links skip splash/onboarding. Reproduce APK first launch by loading **bare `/` with a fresh profile** and capturing `Runtime.exceptionThrown` over the DevTools protocol (that's how the blank-screen bug was found).
5. **Rebuild engines after editing `src/*.src.js`.** And **bump `sw.js` cache version** on every member deploy.
6. **`pytest` for `platform/lib/` needs `--import-mode=importlib`** (only relevant if you touch the unrelated Python side; not this app).

---

## 7. How to build / deploy / verify (copy-paste)

```bash
cd /mnt/storage/projects/lumen-bible

# --- after editing an ENGINE (src/*.src.js) ---
bash scripts/build-fellowship.sh   # or build-steward.sh / build-identity.sh / build-mydata.sh

# --- restart the live relay/gateway after editing gateway.mjs ---
systemctl --user restart trinity-gateway

# --- member compile check + smoke (5 core screens render) ---
source scripts/android-env.sh
bash scripts/sync-web.sh            # esbuild all jsx + cap sync (catches syntax errors)
bash scripts/smoke.sh              # http://localhost:8000

# --- rebuild + deploy the APK ---
# (remember: bump sw.js cache version first for member-facing changes)
source scripts/android-env.sh
bash scripts/sync-web.sh
cd android && ./gradlew assembleDebug && cd ..
cp android/app/build/outputs/apk/debug/app-debug.apk trinityone-debug.apk
# verify the PUBLIC apk (external resolve, since MagicDNS lies locally):
curl -s --resolve trinityone.tailbeaac0.ts.net:443:176.58.88.108 \
  -o /dev/null -w "%{http_code} %{size_download}\n" \
  https://trinityone.tailbeaac0.ts.net/trinityone-debug.apk

# --- fix/verify the public Funnel if external users can't reach it ---
bash scripts/funnel-up.sh

# --- git (work on main; commit only when asked; co-author trailer) ---
git add … && git commit && git push origin main
```

**Verification patterns used this session (reuse them):**
- **Smoke:** `scripts/smoke.sh` — asserts the 5 core member screens render. Uses `?module=/modules/eng-akjv.bbl.mybible&tab=…` deep-links.
- **Node E2E against a spawned enforcing gateway** — the reliable way to prove relay policy + round-trips. Pattern: spawn `gateway.mjs` on a test port with `CHURCH_NPUB`+`RELAY_DB` env, connect with `ws` + `nostr-tools`, assert church-only writes / member writes / round-trips. (Used for plans, rota schema, chat/DM, etc.)
- **CDP exception capture** — launch chromium `--headless=new --remote-debugging-port=N`, connect via `ws` to the page target, enable `Runtime`/`Log`, navigate, collect `Runtime.exceptionThrown`. The only reliable way to catch render crashes (found the blank screen).
- Useful member deep-links: `?serving=1`, `?dm=inbox|<peerhex>`, `?follow=<npub>`, `?church=follow`, `?tab=`, `?id=recovery|member`, `?module=<url>`. Steward: `?tab=`, `?churchkey=<12-word mnemonic %20-encoded>` (test hook to load a known church key without overwriting — also seed data to that key via a node script).

---

## 8. Next steps / open items

**Highest priority (pilot readiness):**
1. **Confirm/repair the pilot church key** (see §6.1) and **take a steward backup** (§6.2). Without this, "members showing 0" can recur if the key was already lost.
2. **Live-test the rota end-to-end on devices:** Console → New team → Roster (add people, link to members) → + Service → assign a member → that member's phone shows the Serving card + gets the reminder. The data layer is E2E-verified; the on-device loop is the thing to dogfood.
3. **Steward onboarding** is still ad-hoc — there's no guided first-run for a steward the way there is for the member app. Worth designing (it was flagged but not built).

**Build items the user has queued / mentioned:**
4. **FCM push for the APK** — server web-push currently covers the PWA only; the Android APK uses local notifications. Real-time server→APK push needs Firebase Cloud Messaging. (User asked about this as the natural next step.)
5. **"Add relay" in the console** (optional) — the user asked "do we need it?"; answer was *not for the pilot* (gateway relay = source of truth, members add their own), but it's worth it for **public-relay redundancy** (also publish to e.g. `nos.lol` so the church survives the gateway going offline). Wire into the existing Relays tab if wanted.
6. **Cloud backup polish** — backup is file-based via the OS share sheet (chosen deliberately over per-provider OAuth). If the user later wants a one-tap "Back up to Google Drive," that's the bigger OAuth build.

**Roadmap-level (later stages, per `reference/trinityone-release-roadmap.md`):**
7. Multi-church / network broadcasts (Stage 3). 8. Giving pilot (Stage 4, currently parked — `fund:` exists, UI commented out). 9. iOS + NIP-17 gift-wrapped E2E private chat (Stage 6; DMs are currently NIP-04, metadata not hidden). 10. Productize key custody (NIP-07/NIP-46 "Keykeeper" signer instead of localStorage).

---

## 9. Where the project memory lives

Persistent cross-session notes are in `/home/adminl/.claude/projects/-home-adminl/memory/` (indexed by `MEMORY.md`). The TrinityOne-relevant ones:
- `project_trinityone_steward.md` — **the big one**: full Nostr event model, console engine API, relay policy, rota/calendar/serving build, the key-regeneration fix, backup, gotchas.
- `project_trinityone_spine.md` — SPINE pointer. `project_trinityone_handoff_jun8.md` — earlier design handoff. `feedback_trinityone_design_fidelity.md` — **match the design exactly; backend is the agent's call**.
- `project_lumen_bible.md` / `project_lumen_apk.md` — the original Bible-app + APK packaging notes.

> If you're the Desktop session reading this: these memory files won't auto-load into a different machine's context. Skim `project_trinityone_steward.md` once — it's the densest knowledge.

---

## 10. House rules observed this session
- Work on `main`; **commit/push only when asked**. Commit messages end with the `Co-Authored-By: Claude Opus 4.8` trailer.
- **Match the design exactly** when implementing design files; the backend wiring is the agent's call (replace-to-match, keep it real).
- Verify before asserting (a relay/db query or a spawned-gateway E2E beats a guess). The headless screenshot limitation is real — don't trust an empty screenshot as proof of a bug.
