# TrinityOne — SPINE.md

> Canonical reference for the TrinityOne app. This is the single source of truth that
> coordinates the three working surfaces. Keep it short. When a decision changes, change it here.

**One-liner:** A self-custodial Bible app for a church network — Scripture, community, and giving on open protocols.
**Tagline:** Scripture. Fellowship. Provision.
**Platform:** Capacitor (one codebase → iOS / Android / web). App ID: `com.trinityone.app`

---

## Working model

Three surfaces, one spine:

- **Architect / PM (Claude chat)** — decisions, specs, prompt-writing, review. Owns this doc.
- **Claude Design** — UI/visual surface. Imports this repo so it designs against real components and tokens, not generic React. Reads this file for scope and phase.
- **Claude Code** — implementation executor. Single-paste prompts, builds against the spec, `propose commit → go` gate before anything lands.

Rule of thumb: chat decides *what* and *why*, this doc records it, Design proposes *how it looks*, Code makes it *real*.

---

## Architecture spine (stable facts)

| Concern | Decision |
|---|---|
| **Identity** | Self-custodial. BIP-39 seed, NIP-06 key derivation. Private keys live in OS secure storage (iOS Keychain / Android Keystore). Never on a server. |
| **Scripture** | Open.Bible texts, bundled/cached for offline read. |
| **Fellowship** | Nostr. Relay-based groups per NIP-29. Client built on NDK. |
| **Relay topology** | Tiered. Each church runs a local box (Khatru, NIP-29) it controls; wider network relays above for reach. Group membership = access control. |
| **Provision (giving)** | Lightning. NDK + ndk-wallet. NIP-57 zaps for giving; NIP-47 Nostr Wallet Connect for wallet linkage. |
| **Content** | Verified quotes reference file (~38 entries) maintained separately; cite-checked before use. |
| **Library** | Free in-app library of public-domain Christian classics. See *Library (Books)*. UI scaffolded; catalog population pending. |

Guardrail for both agents: anything touching keys, relays, or money is high-stakes — propose, never assume. Keep congregation data scoped to the relevant NIP-29 group; nothing sensitive on public relays.

### As-built (pilot implementation)

The table above is the **target**. The pilot ships a pragmatic NIP-01/NIP-78 implementation that the
NIP-29/NDK design is additive to later. What's actually running:

| Concern | As-built (pilot) |
|---|---|
| **Engines** | `window.Bible` (engine.js), `window.Fellowship` (`src/fellowship.src.js`→`vendor/fellowship.js`), `window.Steward` (`src/steward.src.js`→`vendor/steward.js`), `window.TrinityIdentity`, `window.TrinityBackup`. nostr-tools, not NDK. |
| **Church data** | Addressable **kind-30078** (NIP-78) docs, `d`-prefixed (`group:`, `roster:`, `service:`, `rota:`, `event:`, `plan:`, `devotional:`, `request:`, `network:`, `member:`, `fund:`), `t`=`trinityone`. Steward-signed; members read by author = church pubkey. |
| **Chat / DMs / reactions** | kind-1 group posts (`t`=groupId, `p`=churchPub scoping); NIP-04 (kind-4) church↔member DMs; NIP-25 (kind-7) reactions on group + DM threads. |
| **Relay** | `scripts/gateway.mjs` — one Node process = static file server + embedded NIP-01 relay at `/relay` + push (VAPID) + feed proxies (`/feed` YouTube/Rumble, `/audiofeed` podcast RSS). Replaceable/addressable dedup. WebSocket keepalive ping (25s) for Funnel/NAT. |
| **Write policy** | The relay is **multi-church**: `relay/church.json` (`churches[]`) or `CHURCH_NPUB` (comma list). Each church writes its own docs (scoped by author); members write their own data; group-leaders may post their group's events; networks a church joined may publish church-style content; profiles (kind-0) open. |
| **Reachability (pilot)** | One gateway exposed via **Tailscale Funnel** (`https://trinityone.tailbeaac0.ts.net`) — the stopgap the **Relay app** replaces. Member native app has **no default relay**; the church's relay is carried in its invite (`?relay=`) and added on follow. |
| **Identity onboarding** | Steward invite = a real QR/link `?invite=<seed>&follow=<church>&relay=<wss>` — one scan adopts a ready-made identity + joins. In-app QR scan via `BarcodeDetector` (web) / vendored **jsQR** (Android WebView). |
| **Listen** | Narrated scripture (Web Speech, in the reader) + church audio (podcast RSS via `/audiofeed`). |
| **Surfaces** | Member app (`index.html` + `*.jsx`, Capacitor APK) and Steward console (`steward.html` + `stew-*.jsx`, runtime Babel, responsive). |

**Gotcha (member app):** all member `.jsx` load as classic scripts sharing one global scope. Two files declaring the same top-level `function`/`const` name throws a redeclaration `SyntaxError` that blanks the APK (Babel tolerates it; the esbuild `www/` build doesn't). Run the dup-global scan + a headless boot check after editing member files.

**Parked for the pilot (Bitcoin/Lightning):** anything touching BTC/LN ships behind a "coming soon" marker, not as a live feature — member **giving** (`GIVING_ON=false` in `screens-chat.jsx`), the steward **Giving** tab (commented out of `NAV`), and the marketing Share/Lightning sections (`.soon-pill`). The marketing **donate** card (Lightning address) is **hidden** until the wallet ships — re-add the "Give" card in `welcome.html`'s Support section (and decide LN-invoice/LNURL vs on-chain BTC vs both, with real addresses) when giving goes live. The **full-screen web app** is reachable at `/index.html?app=1` (forces unframed mode; the marketing "Launch the web app" uses it).

### Relay app / self-hosting (next)

Each church should run its **own** relay (the topology row above); the pilot's single Funnel-exposed
gateway is the stopgap. The **Relay app** packages `gateway.mjs` + a tunnel + a setup wizard into a
desktop app a non-technical steward installs and double-clicks — "run the relay on Win/Mac/Linux
without code." Scoped in `reference/proposal-relay-app-steward-console.md` + `reference/brief-relay-app-wizard.md`. Until it ships, churches share the multi-church hosted relay.

---

## Library (Books)

A free in-app library of Christian classics. UI is scaffolded (built in Claude Design); populating the catalog with real texts is the outstanding "real data" step. Downloaded books are part of the cloud backup snapshot.

**Sources (public domain):**
- **CCEL** (ccel.org) — primary. Curated, structured classic Christian texts (Augustine, Calvin, Spurgeon, à Kempis, Bunyan) with clean metadata + full text.
- **Project Gutenberg** — ~70k PD books, plain text / EPUB / HTML, bulk-downloadable, no API key.
- **Standard Ebooks** — typeset subset of Gutenberg; nicest reading experience.
- **Internet Archive / Wikisource** — scanned + transcribed PD works.

**Populate model:** same shape as the Bible/concordance data — bundle a catalog (title, author, cover, full text) from CCEL/Gutenberg into the data layer; the module list renders from it.

**Copyright tiering (hard rule):** the free library carries **public-domain titles only**. Modern in-copyright titles go in a separate, properly licensed tier — never mixed into the free set.
- *Public domain (free):* Pilgrim's Progress, Confessions, The Imitation of Christ, Orthodoxy, The Practice of the Presence of God — plus Spurgeon, Augustine, Edwards, Murray, etc.
- *In copyright (license required):* Mere Christianity, Knowing God, The Cost of Discipleship, Desiring God, Gentle and Lowly.

---

## User-owned data (on the user's key)

**Principle:** the user's key is their portable personal database. Data they own is a signed event on their pubkey, stored on relays, controlled by their key — so it follows them across devices and outlives the app. No institution (including the church running the relay) can unilaterally seize or lose it. This is the anarchist instinct in architecture: the believer's walk with scripture is theirs and travels with them.

Two buckets per data type: **public** (shareable) and **private** (NIP-44 encrypted in content). Default sensitive types to encrypted.

| Data | Carrier | Notes |
|---|---|---|
| Verse/passage highlights | NIP-84, kind `9802` | Standard; content is the highlighted text, tags the source. Portable to other Nostr readers. |
| Settings & personal state | NIP-78, kind `30078` | Default translation, theme, font, notifications, reading-plan config, reading position, streaks. Replaceable; `d` = app context. |
| Private notes / journal / prayer list | NIP-78 / app-specific, **encrypted** | Sermon notes, verse reflections, prayer list. NIP-44-encrypted content. Most valuable + most delicate. |
| Bookmarks & people sets | NIP-51 (bookmarks `10003`, people `30000`) | Saved verses/sermons; "small group" / "praying for" sets. |
| Profile & identity | kind `0` + NIP-05 | Name, picture, church-domain handle. |
| Relay routing | NIP-65, kind `10002` | "Home church relay" travels with the member; ties into the tiered topology. |
| Wallet / giving prefs | NIP-47 + encrypted config | Provision phase. Wallet linkage + recurring-giving prefs. |

**Cautions:** (1) Relays can drop/expire events — treat relays as *sync*, keep a local working copy, let users pin critical data to their own/church relay. Never let a relay be the sole copy of a journal. (2) Self-custody = unrecoverable if the seed is lost — a long-lived journal makes seed backup + encrypted export a real requirement. (3) Be deliberate public-vs-private per type; a plaintext-published prayer journal is the failure to avoid.

---

## Backup & recovery

Four independent layers, each a different job. The key backs up *access*; the cloud snapshot backs up *substantive data* (notes/journals, highlights, bookmarks, downloaded books). Backing up one does not back up the other — they fail independently, so the design needs both.

| Layer | Holds | Role |
|---|---|---|
| Device | Working copy | Source of truth in daily use |
| Relays | Synced events | Off-device redundancy, but lossy (can drop/expire) — **sync, not backup** |
| Cloud "Back up everything" | Complete sealed snapshot: notes/journals, highlights, bookmarks, downloaded books, **+ the key** | The real complete backup, especially for private data relays won't reliably keep |
| Paper seed | The key (root of trust) | Ultimate recovery; everything decrypts from here |

Cloud backup is client-side end-to-end encrypted: sealed on device *before* upload, locked with a user passphrase; the provider stores ciphertext only ("not even the provider can read it").

**Hard requirement — security reduces to the passphrase.** Derive the encryption key from the passphrase with a strong, slow KDF (Argon2id preferred, scrypt acceptable; never a plain hash). UX must actively push a strong passphrase — a weak one turns "the provider can't read it" into "anyone who grabs the blob can."

**Paper seed stays foundational.** A smooth cloud restore must not let users treat paper as optional. Irreducible self-custody floor: lost phone + forgotten passphrase + lost paper = unrecoverable. Say this once, kindly, at setup.

---

## Roadmap

### Security audit  *(near-term — do before wider rollout; flagged 2026-06-11)*
The pilot took shortcuts that need a real review before more churches join. Audit at least:
- **Key custody:** member + church/network keys (BIP-39 seeds) sit in `localStorage` — XSS = total compromise. Review CSP, dependency/vendor supply chain (`vendor/*.js`, Babel/React CDN vs vendored), and the path to the planned Keykeeper/NIP-46 signer that gets seeds out of page scope.
- **Invite links:** identity seeds travel in URLs (`?invite=<seed>`) — referer/history/clipboard leakage, single-use vs replayable, expiry.
- **Relay write policy:** `gateway.mjs` is multi-church and author-scoped — confirm a church can't write another's docs, members can't forge steward events, and group-leader/network write paths can't be abused. Check the embedded NIP-01 relay for unauth read/DoS.
- **Exposure:** Tailscale Funnel endpoint, push/VAPID, the feed proxies (`/feed`, `/audiofeed`) for SSRF, and the `/status` endpoint for info leak.
- **Backups:** passphrase-encrypted file backup (`TrinityBackup`) — KDF/crypto choices, and the in-page reveal of recovery phrases.

### Phase 1 — Scripture + Fellowship  *(current)*
Bible reading (Open.Bible) and NIP-29 community chat over NDK. Self-custodial identity in place. This is the build target now.

### Phase 2 — Provision
Lightning giving: NIP-57 zaps + NIP-47 wallet connect via ndk-wallet. Scoped, reviewed separately because it's money.

- **Church-adjacent charities** *(post-pilot design conversation — not yet scoped)*: a way for a charity
  linked to a church (or a whole network) to receive donations from that church/network's members — e.g.
  a missions org, food bank, or partner ministry the church endorses. Real design questions: who can add/
  endorse a linked charity (steward? network?), how members discover it, trust/verification so it can't be
  spoofed, whether gifts route through the church or straight to the charity's own key, and how it shows in
  giving history. Have this once the pilot's own giving is proven.

### Phase 3 — Rota & Calendar  *(future release — proposed, not yet committed)*
ChurchSuite-style scheduling on the same Nostr infrastructure.

- **Calendar** is near-native via NIP-52: kind `31922` (date events), `31923` (time events), `31924` (calendars), `31925` (RSVPs). Services, studies, and events map directly onto `31923`.
- **Rota** is a thin custom layer on top: each duty slot = a `p` tag on the event carrying `[pubkey, relay, role]` (e.g. worship-lead, sound, kids, coffee). The assigned person RSVPs `accepted / declined / tentative`, giving a real "can you serve?" confirm loop rather than a static list.
- **Scope & access:** rota/calendar events published into the church's NIP-29 group on its local relay, so only the congregation sees who's serving when.
- **App logic we own (NIP-52 leaves it open):** invitation authority, conflict detection ("already on at 9am"), re-confirm on change, recurring rotas, swaps.
- **Bonus:** standard NIP-52 events are readable by other Nostr calendar clients (e.g. Flockstr-style apps).

### Phase 4 — Personal feeds (RSS)  *(later / low priority — recorded for potential development)*
Per-user blog/RSS reading, YouTube-style from the user side. Not network-curated.

- **Subscriptions** = a personal, NIP-44-encrypted NIP-51 set on the user's own key (app-specific kind, e.g. `d` = `trinityone-feeds`). Private to the user, syncs across their devices; the network can't see what they read. Local-only storage is an acceptable v1.
- **Fetching** = client-side via CapacitorHttp (bypasses CORS on native). No republication, so no copyright concern.
- **Fallback** = a dumb shared fetch-and-cache proxy *only if* per-device polling cost forces it; it must stay non-curating (no opinion on what anyone subscribes to). Reintroduces a server component, so avoid unless needed.

### Steward broadcast  *(optional / largely redundant — recorded for completeness)*
A one-to-many announcements channel for stewards.

- **Shape:** a NIP-29 group with posting restricted to steward roles and read access for all members; the relay enforces the write permission. A permission variant of the whole-church group chat, not new protocol — which is exactly why it's mostly redundant.
- **Default assumption:** a single whole-church group chat (everyone added) covers the need for most churches. Build the dedicated broadcast only where open-chat noise actually buries announcements.
- **Cheaper first step:** a pinned / announcement affordance inside the whole-church group beats a separate broadcast group for the common case.
- **When it earns its place:** official notices need to stay clean and findable, or a clear "this is an official steward notice" distinction matters.
- **Ethos note:** a broadcast concentrates a one-to-many voice, in mild tension with the flat, communal model — leaning on the shared group chat keeps things horizontal rather than building a pulpit. The redundancy is arguably a feature.

Out of scope for now: full ChurchSuite surface (CRM, child check-in, broadcast comms). Giving is already cleaner here via Lightning than ChurchSuite offers.

### Nice-to-haves (small UX, unprioritised)
- **Member search** — a search/filter field in the Steward console's Members tab (filter by name / npub) for churches with longer rosters. *(requested 2026-06-12)*

### Resources release schedule (steward)  *(requested 2026-06-13 — feature, not yet built)*
Let stewards **schedule when resources publish** to members instead of dropping them all at once — drip a devotional/plan on a date, or set a recurring cadence (e.g. one item of a **series** per week). Pairs with the new explicit **`series`** field on devotionals (`src/steward.src.js` `publishDevotional`): a series becomes a release track. **Shape to decide:** a `publishAt` (and optional `recurrence`) field on the `devotional:`/`plan:` kind-30078 docs; the member app hides items whose `publishAt` is in the future (client-side gate), and/or the steward console holds them unpublished and releases on a timer. Note the relay/Nostr has no native "publish later," so either the client gates on `publishAt`, the steward device publishes on schedule (needs the console open / a background job), or the gateway holds + emits. UI: a date/cadence picker in the devotional/plan modal + a "Scheduled" state in the Resources list. Reuses the date-picker patterns in `stew-schedule.jsx` (rota board) but is a distinct feature from rota/calendar.

### Multiple stewards & stewardship handoff  *(requested 2026-06-14 — feature, not yet built)*
Today a church = one key (BIP-39 seed in `localStorage`), so "being the steward" means holding that one seed. Churches need **more than one steward** and a **clean handoff** (someone leaves, a new leader takes over) — without copying the raw church seed around (insecure, unrevocable, and whoever has it is the church forever). **Problem to solve:** add/remove co-stewards, transfer primary stewardship, and revoke a former steward — ideally so losing one steward's phone doesn't compromise the church. **Shapes to weigh:** (a) a church-published **steward roster** (kind-30078 `steward:` doc listing authorised steward pubkeys, signed by the church key; the relay's write policy honours it so any rostered steward can post/manage as the church) — keeps the church key as the root but delegates day-to-day to named pubkeys, and revocation = republish the roster; (b) **NIP-46 remote-signing / nsecBunker** so the church key lives in one place and stewards get scoped, revocable signing tokens (ties into the planned Keykeeper signer, see Security audit); (c) FROST/threshold multisig for the church key (heaviest, most robust). Lean toward (a) for the pilot — it's a roster doc + a `gateway.mjs` write-policy check, no new crypto — with (b) as the productised path. Pairs with the **Steward APK** (create + manage on a phone) and the steward-invite flow (`makeInvite`/QR) which already hands out *member* identities; this extends that to *steward* authority. Must define: who can add/remove stewards (primary only? any steward?), and what "primary/handoff" means against the root church key.

### Live stream (church services)  *(requested 2026-06-15 — feature, build after current testing)*
Let a church **stream its service live** into members' apps — a real-time "Watch live" surface, distinct from the existing **Video channel** (YouTube/Rumble VOD link → Watch tab via the `/feed` proxy in `gateway.mjs`, set in the steward console's `DashMediaPanel`). The pilot only surfaces recorded videos; this adds the *live* moment (Sunday gathering, midweek teaching) so members who can't attend in person can join. **Shapes to weigh, cheapest-first:** (a) **reuse the channel link** — most churches already go live on YouTube/Rumble, so the `/feed` proxy detects the active live item and the Watch tab shows a "● LIVE now" card that auto-opens it (no new infra, just live-state detection in the feed proxy); (b) **explicit live URL / "Go live" toggle** — a steward input to paste the stream/HLS URL and flip live on/off (publishes a kind-30078 `live:` doc or a kind-0 field), so it works for any platform and the app shows a live banner while it's on; (c) **self-hosted live** (Owncast / RTMP→HLS on the relay box or a partner node) for churches that don't want a third-party platform — heaviest, ties into the relay-resilience hardware story. NIP-53 (live activities, kind `30311`) is the native-Nostr fit and pairs with group chat as a live "watch party." Lean toward (a)+(b) for the pilot — live-state on the channel plus a manual override — with (c)/NIP-53 as the productised path. **Decide:** how members learn it's starting (push?), whether live + group chat combine into a watch-along, and graceful fallback to the recording when the stream ends.

### Relay resilience  *(requested 2026-06-14 — roadmap thread, not yet built)*
Don't let a church go dark if the relay pool thins. The pieces, cheapest-first: **(1) more canonical nodes** — add 3–5 relays across independent operators to `CANONICAL_RELAYS` (member + steward), so "down to 1–2" basically never happens; one-line change, biggest bang. **(2) Partner-hosted nodes** — recruit partners to each run a relay (spreads trust + cost; good open-source story). **(3) In-building / LAN relay** — a device on the church WiFi serves `ws://<lan-ip>/relay` so the gathering keeps working during an internet outage; practical host is a **laptop or a ~£35 Raspberry Pi** (a phone can't be a *public* relay — NAT + background-kill + no WebView server socket; LAN-only at best). **(4) Desktop Relay App auto-failover** — when the pool drops to ≤1, the steward's relay app (`relay-app/`, now with a cloudflared tunnel) spins up + tunnels to compensate. A relay is a tiny WS+DB process (strfry / nostr-rs-relay / our `gateway.mjs`), so cheap hardware runs it; the only catch is reachability → a tunnel (Tailscale Funnel / cloudflared) or a turnkey box (Umbrel/Start9). Underpinning fact: clients are already local-first (cache survives outages) and the **steward's device is a full copy that can re-seed** a recovered/new relay. Marketing already notes the Pi option on the relay card.

---

## Conventions

- Markdown specs live in-repo; this file is the index.
- Branches: Code pushes to `claude/`-prefixed branches; nothing lands on `main` without the `go` gate.
- When phasing changes, update the Roadmap section and nothing else needs to move.
