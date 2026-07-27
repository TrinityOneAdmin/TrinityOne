# TrinityOne plugins / add-ons — architecture overview

*Post-pilot. Branch `claude/plugins`. The protocol and the app stay free + AGPL forever; plugins are
optional add-ons, mostly paid first-party services, that ride a stable seam.*

This folder scopes the **add-on/plugin system** and the first plugins. See `reference/SPINE.md` →
"Add-ons / plugins" for the strategy. Per-plugin scoping:
- [`TREASURY.md`](TREASURY.md) — the accounting module → paid plugin (Giving stays core); parent of:
  - [`TAX-PACKS.md`](TAX-PACKS.md) — per-country tax/statement packs (inside Treasury)
- [`LIVESTREAM.md`](LIVESTREAM.md) — sermon/service broadcast
- [`CALLS.md`](CALLS.md) — prayer & meeting calls
- [`FORMS.md`](FORMS.md) — connect cards & forms
- [`TICKETING.md`](TICKETING.md) — paid/registered events (payment via core Lightning)

---

## Why plugins (the money + the licence)

The core is AGPL and self-hostable, so a **code-only paywall just gets forked**. Sustainable revenue
comes from things that **cost us real money or effort**: hosting, bandwidth/compute, hardware, human
help. Plugins are the productised form of that — optional surfaces a church can turn on, where the
heavy/closed/paid logic lives **outside** the AGPL core.

## The legal seam (what keeps a paid plugin clean)

A plugin can be proprietary/paid **only if it's a separate work** from the AGPL core. Two paths, usable
together:

- **(A) Arm's-length separation — the default.** The plugin is its **own service** (own process, own
  host, any licence) that communicates with TrinityOne over **Nostr events** and/or a defined HTTP/WS
  API. Arm's-length communication via a published interface = separate work. AGPL §13's "offer source
  to your users" only binds *the core*, not a third party's separate service.
- **(B) A plugin/linking exception — optional, deliberate.** As copyright holders we can add an explicit
  exception to the AGPL (à la GCC's runtime exception / Classpath) that permits plugins under other
  licences, allowing tighter in-process integration. Keep this in reserve for when a plugin genuinely
  needs to run inside the app rather than as a service.

> **Rule of thumb:** if the proprietary logic runs in its own service and only exchanges *data* with the
> core, you're clean under (A). Don't put closed logic inside the app bundle without (B).

## The seam (three small pieces the core ships)

The core stays generic — it knows *how to host a plugin surface*, never *what any plugin does*.

1. **Registry — "which plugins is this church running?"**
   A church-signed config doc, e.g. `trinityone/plugins:<churchpub>` (kind-30078, owner-only, same
   trust model as the safeguarding/blocklist docs). Lists enabled plugins + each plugin's config
   (its service origin, the event kind(s) it uses, display name/icon, any per-plugin settings).
   Steward toggles a plugin on/off in the console; members' apps read the doc and react.

2. **Render contract — "show me a plugin's surface."**
   Given an enabled plugin, the app renders one of:
   - **a native surface from an event kind** — the plugin publishes events of a declared kind; the app
     renders them with a small, sanctioned component (best for simple, native-feeling surfaces, e.g. a
     "Live now" card or a form). Preferred — no third-party code runs in the app.
   - **an embedded web surface** — an iframe/WebView to the plugin's own URL, for richer UIs. Requires
     **per-church CSP allow-listing** of that origin (`frame-src`/`connect-src`) — the registry doc
     carries the origin so the church explicitly trusts it. Heavier; use only when an event-kind
     surface won't do.

3. **Capability grants — "what may a plugin read/act on?"**
   A plugin service authenticates to the relay as its **own Nostr identity** and is granted scoped
   access by the church (e.g. publish a specific kind, read a specific group). Reuse the existing
   relay write-policy (`gateway.mjs accept()/canRead()`) — add per-kind / per-plugin allow rules keyed
   off the registry doc. **Never** hand a plugin the church or a member key; plugins get their own key +
   explicit grants, nothing more. Encrypted data (finance, pastoral) stays encrypted to the church key
   and is only ever decrypted **client-side in the console** — a plugin service sees ciphertext unless
   the church deliberately shares a scoped key (avoid where possible).

## Sequencing

1. Build the **registry + render contract + capability grants** once (the seam).
2. Ship the **first plugins as our own first-party paid services** using that exact contract — proves
   it and earns from day one. First slate: **tax packs, livestream, calls, connect cards/forms,
   ticketing**.
3. Only then consider an **open third-party marketplace** (adds a security-review + sandboxing burden).

## Hard caveats (don't skip)

- **CSP.** Embedded surfaces need per-church origin allow-listing — design the registry so a church's
  enabled origins flow into the served CSP. Event-kind surfaces avoid this entirely; prefer them.
- **Encryption boundary.** The finance/pastoral data is NIP-44-encrypted to the church key. A plugin
  that needs that data either runs *in the console* (where decryption already happens) or gets a
  deliberate, scoped, revocable key share. Treat any key share as a safeguarding-grade decision.
- **Safeguarding.** Plugins must not become a side-channel around the minor/approved rules. Any plugin
  touching members or messaging inherits the relay-enforced safeguarding checks.
- **Self-hosting parity.** A church on its own relay must still be able to run (or decline) plugins;
  don't assume our hosted relay. Plugin services should be deployable next to a self-hosted relay too.
