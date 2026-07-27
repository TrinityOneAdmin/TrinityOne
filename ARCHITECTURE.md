# TrinityOne — Architecture

A map of the whole repo: what the pieces are, how they talk, how it builds, and where to start reading. If the codebase felt sprawling on first look, this is the doc that makes it click.

---

## 1. The big picture — three programs

TrinityOne is **three programs that talk over [Nostr](https://nostr.com)** (a simple signed-event protocol):

```
   ┌─────────────────┐        ┌─────────────────┐
   │   Member app    │        │ Steward console │      the two clients — plain web apps,
   │ (com.trinityone │        │ (com.trinityone │      also packaged as Android APKs
   │      .app)      │        │    .steward)    │
   └────────┬────────┘        └────────┬────────┘
            │      signed Nostr events │
            └───────────┬──────────────┘
                        ▼
                ┌───────────────┐
                │  The relay    │   scripts/gateway.mjs — a Nostr relay that also
                │ (gateway.mjs) │   serves the web apps + downloadable Bible modules.
                └───────────────┘   A church can self-host this on its own hardware.
```

- **Member app** — the Bible reader + a member's church life (today, chat, giving, serving). Offline-first.
- **Steward console** — the tools to *run* a church (groups, rota, calendar, rooms, members, finance).
- **The relay** — stores signed events and enforces who-can-write / who-can-read. Everything else is a client of it. **No central server owns the data** — a church holds its own relay + keys.

There is **no traditional backend/API**: clients publish signed events; the relay accepts or rejects them by rule. That single idea explains most of the codebase.

## 2. How code is loaded — the one thing to understand first

The clients are **plain HTML + classic `<script>` tags**, not a bundler/ESM app. Two consequences that surprise people:

1. **All top-level names in the `.jsx` files share ONE global scope.** `index.html` / `steward.html` list every screen as a `<script>`; they aren't modules. So a duplicate top-level `const`/`function` name across two `.jsx` files is a real collision — in the packaged APK it will **blank the whole screen**. (There's a dup-global scan in `scripts/` for exactly this.)
2. **For the packaged APK, `.jsx` is pre-transpiled to `.js` at build time** (esbuild), so the app needs *no* runtime Babel — runtime Babel is unreliable inside the Capacitor webview. The **web** build still uses runtime Babel (`<script type="text/babel">`).

The heavier logic lives in **engines**: `src/*.src.js` (and a few `.mjs`) files that *are* ES modules, bundled by esbuild into `vendor/*.js` as a single `window.X` global. So the split is:

- **`app/*.jsx`** — React UI, classic scripts, one shared global scope.
- **`src/*` → `vendor/*.js`** — engines, real modules, exposed as `window.X`.

## 3. The engines (`window.*`)

| Source | Global | Does |
|---|---|---|
| `src/identity.src.js` | `window.TrinityIdentity` | the self-custodial key (create / import / sign / recovery phrase) + the optional **PIN** that encrypts the identity at rest (locked ⇒ the key cannot load, so the church side is unreachable and no message can be read, and the SCREEN shows only the Bible). **It is not plausible deniability**: the device still stores the church list and cached church documents in the clear, so anyone who examines the phone can still tell which congregation it belongs to. Verified in a browser 2026-07-27 |
| `src/fellowship.src.js` | `window.Fellowship` | the **member** app's Nostr transport (chat, church feeds, subscriptions) |
| `src/steward.src.js` | `window.Steward` | the **church key** + all publishing/subscribing for the console |
| `src/finance-ledger.mjs` (+ `finance-store`, `finance-import`, bundled via `finance-bundle.mjs`) | `window.FinanceLedger` | double-entry ledger, fund accounting, CSV statement import — see [`docs/design/FINANCE-MODULE.md`](docs/design/FINANCE-MODULE.md) |
| `src/steward-manna.src.js` | `window.StewardManna` | optional module: money-out / disbursements |
| `src/steward-meals.src.js` | `window.StewardMeals` | optional module: meal trains / practical care |
| `src/wallet.src.js` | `window.TrinityWallet` | Cashu ecash wallet (currently gated off) |
| `src/mydata.src.js` | `window.MyData` | user-owned local data (notes/highlights/plans) |
| `engine.js` (root) | the Bible engine | parses/serves Scripture + Strong's; downloads modules on demand |

`window.Steward` is the key one for the console: `encPublish(dtag, obj)` / `encSubscribe(prefix, cb)` self-encrypt church docs to the church key (the relay only ever sees ciphertext), and `subscribeX` / `setX` handle the readable church content.

## 4. The relay + the data model (`scripts/gateway.mjs`)

Church content is stored as **kind-30078 addressable events** — keyed by `(author, kind, d-tag)`, newest wins. The `d`-tag is the "path," e.g. `trinityone/group:<id>`, `trinityone/event:<id>`, `finance/journal:<seq>`. Two gates decide everything:

- **`accept(e)`** — may this event be *written*? (Is the author the church key, or a current steward of the named church? Is a journal seq the next one? etc.)
- **`canRead(e, authed)`** — may this connection *read* it? (World-readable church content, vs member-gated groups, vs steward-only finance, vs NIP-42-authed safeguarding lists.)

Delegation runs through an **owner-signed steward roster** ([`docs/design/STEWARD-ROSTER-DESIGN.md`](docs/design/STEWARD-ROSTER-DESIGN.md)): the church key names steward keys who then inherit day-to-day powers, revocably. `event-store.mjs` is the SQLite layer under the relay.

Read `gateway.mjs` and you understand the security model; there is no other place it lives.

## 5. Optional modules

Some features are opt-in modules a church toggles on: **Finance**, **Care/Meals**, **Manna**. Each is a `window.X` engine + a `stew-*.jsx` screen, added to the console nav only when enabled. They persist as encrypted church docs like everything else. This is the extension pattern — new modules follow it.

## 6. Build & deploy

- **Engines:** `scripts/build-<name>.sh` esbuild each `src/*` → `vendor/*.js` (committed). Finance: `scripts/build-finance.sh`.
- **Member web/APK:** `scripts/sync-web.sh` populates `www/` (copies app files, pre-transpiles `.jsx`, prunes what the APK doesn't need); `build-apk-index.sh` wraps the Android build.
- **Steward APK:** `scripts/build-steward-apk.sh` (its own app id + icon).
- **Deploy:** the relay serves the web from a bundle built via `git archive HEAD`; clearing `relay/.bundle-cache/` redeploys. The relay can **self-update** (Ed25519-signed). `android/app/build.gradle` is a gitignored, disk-only file — version bumps are `sed`ed in; release signing uses a gitignored keystore.

## 7. Directory map

```
/                app code — *.jsx (screens/UI), *.html (entry pages), engine.js, catalogs (*.json)
src/             engines (.src.js / .mjs, esbuild sources) → built to vendor/
vendor/          built engines + third-party libs (React, sql.js, fflate, fonts)
scripts/         build/deploy/relay scripts — incl. gateway.mjs (the relay) + event-store.mjs
relay/           relay runtime data (sqlite, bundle cache) — mostly gitignored
relay-app/       the relay's self-update payload/app
android/ ios/    Capacitor native projects (build.gradle is gitignored)
modules/         downloadable Bible/lexicon packs (not shipped in the APK)
icons/ assets/   brand + app icons
docs/            guides/, design/, ops/, security/ documentation (+ REFACTOR-PLAN.md)
reference/       briefs, backlog, design notes, archive (internal working material)
www/             generated member web build (gitignored)
```

## 8. Where to start reading (a path, not a pile)

1. **This doc**, then skim `README.md`.
2. **The data model + security:** `scripts/gateway.mjs` — `accept()` and `canRead()`. Everything hangs off these.
3. **The member app:** `index.html` (load order) → `app/app.jsx` (orchestration) → one screen, e.g. `app/screens-today.jsx`.
4. **A transport engine:** `src/fellowship.src.js` — how a client subscribes/publishes.
5. **The console:** `steward.html` → `app/steward-root.jsx` (the data hooks) → `app/stew-dashboard.jsx` (the sections).

## 9. Gotchas (save yourself an afternoon)

- **Duplicate top-level names across `.jsx` blank the APK** — one shared global scope. Run the dup-global scan after adding/renaming top-level `const`/`function`s, and boot-check on a device.
- **`.jsx` is pre-transpiled for the APK** — don't rely on runtime Babel there.
- **The relay serves the apps *and* self-updates** — it's not just a websocket; treat `gateway.mjs` changes as production.
- **`build.gradle` is gitignored** (disk-only) — it won't show in git status. So is the release keystore — back it up off-box or app updates break forever.

---

*Known rough edges (large files, repeated hook boilerplate, verbose comments) and the plan to address them are tracked in [`docs/REFACTOR-PLAN.md`](docs/REFACTOR-PLAN.md).*
