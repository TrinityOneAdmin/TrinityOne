# Plugin: Treasury (the accounting module)

*Post-pilot. Branch `claude/plugins`. Decision (2026-06-20): pull the **whole back-office accounting
module** out of the free core and make it a **paid plugin** — while **Giving (Lightning) stays
fundamental and core**. This is the parent of [`TAX-PACKS.md`](TAX-PACKS.md) (country packs live
*inside* Treasury).*

See [`README.md`](README.md) for the plugin seam.

---

## The line: Giving is core, Accounting is a plugin

A clean, defensible split that the codebase **already reflects** (different apps, separate namespaces,
zero cross-dependency — verified 2026-06-20):

| | Core — free, fundamental | Treasury plugin — paid |
|---|---|---|
| **What** | **Giving**: money *moving* | **Accounting**: money *kept track of* |
| **Who** | every member | the treasurer / a steward |
| **Includes** | non-custodial Lightning wallet, give-from-your-own-wallet, zaps (NIP-57), the church's receiving address (kind-0 `lud16`) | the treasurer's **ledger**, **donor records** (PII), **funds**, **bank-statement import**, **year-end statements**, **per-country tax packs** |
| **Files** | `giving-ln.jsx`, `screens-giving.jsx` (member app, `window.TrinityLN`/`TrinityWallet`) | `stew-finance.jsx`, `src/steward-finance.src.js` (steward console, `window.StewardFinance`) |
| **Why this side** | money is fundamental to a church's life + the sovereignty story — it must never be paywalled | a professional back-office tool churches already expect to pay for (cf. QuickBooks / ChurchSuite finance); the one identified-PII corner |

**Rationale:** giving is *for everyone* and is part of "Share" — it stays free forever. Accounting is a
*specialist admin tool* a treasurer uses — a natural, honest paid add-on, and the place all the
PII/tax complexity already lives. Most small churches will happily use core Giving without ever needing
the ledger; this keeps the free core lean and focused.

## Why it's a clean plugin (it's already 90% separated)

- **Different apps.** Giving loads in `index.html` (member); accounting loads in `steward.html`
  (steward console). They share no code — `giving-ln.jsx`/`screens-giving.jsx` reference
  `StewardFinance` **zero** times.
- **Self-contained.** Accounting is its own UI file + its own esbuild bundle (`vendor/steward-finance.js`)
  + its own namespace (`window.StewardFinance`), already **opt-in** (off by default;
  *Settings → Finance & giving records*).
- So "make it a plugin" ≈ **gate its load + enablement behind a Treasury entitlement**, not a rewrite.

## The AGPL honesty point (important)

The accounting code is **already AGPL and already published** — we can't (and shouldn't) retroactively
make the *code* proprietary; a self-hosting church can run it. So the paid value is **not** "locked
code". It's:
- the **official, hosted, supported** Treasury (on our managed relay/console build);
- **maintained per-country tax packs** kept correct as rules change (the recurring value — see
  [`TAX-PACKS.md`](TAX-PACKS.md));
- setup, migration and treasurer support.

Frame it exactly like the rest of the model: *the protocol and the code are free; you pay for the
maintained, supported, hosted version.* A church that wants to self-run the ledger can — packs and
support are what they're buying.

## Architecture

Reuse the plugin **registry** from [`README.md`](README.md): Treasury is an entry in
`plugins:<churchpub>`. Concretely:

- **Enablement → entitlement.** Today `DashFinancePanel` flips a local `enabled` flag. Add an
  **entitlement check**: enabling Treasury on the **official build** requires a signed entitlement the
  church holds (reuse the Ed25519 release-signing pattern, `relay/release-key.pem`). Absent it, the
  Settings card shows Treasury as "available — contact us" (self-hosters can still enable it; the
  official hosted console honours the entitlement).
- **Lazy-load the bundle.** Don't ship `vendor/steward-finance.js` + `stew-finance.jsx` in the base
  console load; load them **only when Treasury is enabled** (a church without it never downloads the
  accounting code). Keeps the free console lean and makes the plugin boundary real.
- **Data stays encrypted to the church key**, decrypted only console-side — unchanged. No accounting
  PII ever leaves the device; a hosted relay only stores ciphertext.
- **Tax packs** become sub-modules *inside* Treasury (the `TaxPack` interface in `TAX-PACKS.md`), each
  its own entitlement tier (e.g. "Treasury" + "UK Gift Aid pack").

## Build steps

1. **Confirm the seam** (done in recon): giving ↔ accounting are independent — no code to untangle.
2. **Entitlement gate** in `DashFinancePanel` (official build): signed entitlement unlocks enable;
   self-host path unaffected.
3. **Lazy-load** the accounting bundle/UI behind the enabled flag (dynamic `<script>` / import on first
   enable) so the base console doesn't carry it.
4. **Refactor tax handling** into the `TaxPack` interface (per `TAX-PACKS.md`); UK Gift Aid = first pack.
5. **Pricing/packaging:** Treasury tier (the ledger) + per-country pack tiers; bundle options with
   hosted relay.
6. **Marketing/help:** reframe "Finance" as the optional **Treasury** add-on; keep **Giving** described
   as core. Update `welcome-churches.html`, `features.html` (Giving stays a core feature; Treasury moves
   to an add-on), `STEWARD-GUIDE.md`, `TREASURY.md` (the treasurer guide).

## Open questions / decisions

- **Name:** "Treasury" (vs "Finance"/"Bookkeeping") — Treasury reads warm + churchly + professional.
  Lean Treasury.
- **Free tier?** Maybe a *tiny* free ledger (record giving + one export) so the value is felt, with
  donor records / bank import / tax packs / statements as the paid tier. Or keep all of accounting paid
  and let core Giving be the free money story. (Lean: keep accounting fully in the plugin; Giving is the
  free money feature — cleaner line.)
- **Self-host UX:** make the self-host "enable anyway" path graceful and honest, not a nag.
- **Don't break the pilot:** the UK pilot church currently uses Finance free — grandfather them, or
  ship Treasury enabled for them, when this lands post-pilot.

## Reuse / touchpoints

- Accounting: `stew-finance.jsx`, `src/steward-finance.src.js` (`window.StewardFinance`),
  `vendor/steward-finance.js`, `scripts/build-steward-finance.sh`, `steward.html` (loads them).
- Giving (stays core, untouched): `giving-ln.jsx`, `screens-giving.jsx` (`window.TrinityLN`/`TrinityWallet`).
- Entitlement signing: reuse `relay/release-key.pem` + `relay-app/release-pubkey.pem` pattern.
- Tax packs: [`TAX-PACKS.md`](TAX-PACKS.md). Nationality-agnostic guardrail: memory `nationality-agnostic.md`.
