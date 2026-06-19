# TrinityOne

> A church's whole life — Scripture, fellowship, serving, and giving — on infrastructure the church **owns**, not a platform it rents.

TrinityOne is an **offline-first Bible app** and a **private community for a church**, built on open protocols ([Nostr](https://nostr.com)) with **self-custodial keys** — no account, no email, no central company in the middle. The Bible reader works fully offline; chat, identity, and church life run over relays a church can host itself.

**License:** [AGPL-3.0](LICENSE) · **Status:** pilot, in active development · **Platforms:** web (PWA), Android (APK), iOS (PWA)

## Why

Most church software makes a congregation a tenant on someone else's platform — charged for the tools, mined for data, and locked in. TrinityOne is the alternative: the church holds its own key, can run its own relay, and can walk away with all of its data at any time. *Owned by the church, captured by no one.*

## What works today

- **Bible reader** — a complete offline Bible (the Berean Standard auto-installs first launch); **1,000+ downloadable translations** via a live eBible.org mirror; Strong's word study, cross-references, parallel translations, commentaries, and highlights/notes/bookmarks (all device-local).
- **Plans · Search · Library · Listen / Watch** — reading plans with progress, full-text search across installed translations, audio Bibles, and a church's linked podcast/video.
- **Fellowship (Nostr)** — self-custodial identity, group chat + broadcast channels, encrypted 1:1 DMs, invite-only **and end-to-end-encrypted** groups, prayer requests, polls, reactions, and profiles.
- **Steward console** (`steward.html`) — set up and run a church: groups, serving rota + run-sheets, calendar, room booking, members, **safeguarding** (child-safe groups + gated child↔adult DMs), an optional **Finance** module (encrypted donor records + annual giving statements), and **delegated stewards** (share running the church without sharing the key).
- **Migration** — bring a congregation across: a smart `/join` landing, shareable QR/links, and a donor-records importer.
- **Notifications** — web-push for DMs, announcements, and serving requests. No email or phone number is ever collected.
- **Offline + installable** — React, fonts, and sql.js are vendored locally; the app boots with zero network and installs as a PWA or Android APK.

## On the roadmap

- **Lightning giving** — give from a wallet the giver controls, landing straight with the church (non-custodial — the app never holds funds). *Designed, not yet shipped.*
- **Keykeeper** — hold a steward's key on a separate signer, so the everyday app only ever receives signatures, never the secret.
- **In-app, own-domain relay setup** — connect a Cloudflare tunnel to `relay.yourchurch.org` entirely from the dashboard.

See [`reference/SPINE.md`](reference/SPINE.md) for the live roadmap.

## How it's built (no bundler)

Plain `index.html` + `*.jsx`, transpiled in-browser by Babel for dev and **pre-transpiled to plain JS for production**, so the deployed app runs under a **strict Content-Security-Policy** with no `eval`. Two pieces are esbuild-bundled:

- `vendor/identity.js` ← `src/identity.src.js` — `window.TrinityIdentity` (BIP-39 → Nostr key)
- `vendor/fellowship.js` ← `src/fellowship.src.js` — `window.Fellowship` (Nostr transport)

The **relay** (`scripts/gateway.mjs`) is a small Node service: a NIP-01 relay + static host + web-push, with a **church-scoped write policy** — every event is signature-verified, membership-gated, and safeguarding-enforced server-side, so a tampered client can't bypass the rules.

## Run it (dev)

```bash
git clone https://github.com/TrinityOneAdmin/TrinityOne.git && cd TrinityOne
npm install
node scripts/gateway.mjs 8000        # serves the app + a local relay on :8000
# open http://localhost:8000          (member app)
#      http://localhost:8000/steward.html   (church console)
```

## Self-host a relay

A church can run its own relay on a Raspberry Pi, mini-PC, or VPS — one line, then finish in the browser:

```bash
curl -fsSL https://<your-host>/relay-app/install.sh | sudo bash
```

It defaults to a **Cloudflare tunnel** (use your own domain with `--cf-token` / `--domain relay.yourchurch.org`); Tailscale and LAN-only are also supported. See [`relay-app/`](relay-app/).

## Build the Android APK

```bash
source scripts/android-env.sh        # JDK 17 + Android SDK
bash scripts/sync-web.sh             # populate www/
cd android && ./gradlew assembleDebug
```

App id `com.trinityone.app` (member) / `com.trinityone.steward` (console).

## Security & privacy

No login, no email, no phone number. Identity is a key held on the device, protected by a **strict CSP** and an optional **PIN**; a hardware/out-of-page signer ([Keykeeper](reference/SPINE.md)) is on the roadmap. Study data (notes/highlights/plans) stays on the device. Direct messages are end-to-end encrypted; the relay stores only signed events — which a self-hosting church holds on its own hardware.

**Found a vulnerability?** See **[SECURITY.md](SECURITY.md)**. Child-protection design is in **[SAFEGUARDING.md](SAFEGUARDING.md)**.

## Docs

- [`STEWARD-GUIDE.md`](STEWARD-GUIDE.md) — running a church from the console
- [`SAFEGUARDING.md`](SAFEGUARDING.md) — protecting young people
- [`TREASURY.md`](TREASURY.md) — the Finance / giving-records module
- [`reference/SPINE.md`](reference/SPINE.md) — architecture spine + roadmap
- [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`SECURITY.md`](SECURITY.md)

## License

[GNU AGPL-3.0](LICENSE). In short: you're free to use, study, change, and self-host it — but if you run a **modified** version as a network service, you must publish your changes under the same license. That's deliberate: it keeps TrinityOne open and **uncapturable** — no one can take it closed and turn it into the very platform it replaces.
