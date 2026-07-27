# Plugin: Per-country tax packs

*Post-pilot. Branch `claude/plugins`. Per-country tax/statement modules — they live **inside the
Treasury plugin** ([`TREASURY.md`](TREASURY.md)), each its own entitlement tier.*

> **Note (2026-06-20):** the parent decision moved — the **whole accounting module is now the paid
> "Treasury" plugin** ([`TREASURY.md`](TREASURY.md)), not "free core ledger + paid country packs". So
> "core ledger free" below means *free to self-host*, not bundled-free in the official build; the tax
> packs are the maintained, recurring-value layer **within** Treasury. The `TaxPack` interface is
> unchanged.

See [`README.md`](README.md) for the plugin architecture and `reference/SPINE.md` (Finance v1 +
nationality-agnostic decision, 2026-06-19/20). Treasurer guide: `TREASURY.md`.

---

## The idea

The Finance module already split (2026-06-20) into a **nationality-agnostic core** (donor records,
funds, ledger, multi-currency, bank-statement import, year-end statements) **+ an optional UK Gift Aid
add-on** gated behind a per-church `giftAid` toggle. A **tax pack** generalises that one add-on into a
**family of country modules**, each sold/enabled independently:

- **UK** — Gift Aid (the existing add-on, re-housed as the reference pack): declarations, eligibility,
  reclaim estimate, HMRC Charities Online schedule export, claim batching.
- **US** — annual contribution/“giving” statements for 501(c)(3) deductibility (donor + totals +
  required IRS wording; no reclaim — it's the donor who deducts).
- **Canada** — CRA official donation receipts (numbered receipts, mandatory fields).
- **Australia** — DGR receipts.
- *(others as demand appears — each is "read the encrypted ledger → emit this country's artdefact".)*

**Why it's a fair paid add-on:** real, *ongoing* maintenance value — tax rules, thresholds, form
formats and wording change every year; a church pays us to keep its pack correct and current. Not a
code paywall — it's a maintained compliance service. (A self-hosting church could in principle write
its own pack against the open interface; the paid value is the maintained, correct one.)

## Why it's a clean plugin (not just more core code)

The core ledger must stay **generic and free**. Each pack:
- reads the **already-encrypted** giving/donor records **in the console** (where decryption already
  happens — no key leaves the device);
- adds: the country's extra donor fields, an eligibility rule, and one or more **exports**;
- is selected by the church's **country / enabled-pack** setting.

So a pack is mostly a **pure function**: `(ledger, donors, funds, settings) → { extraFields, eligibility,
exports[] }`. That makes packs small, testable, and swappable — and keeps the AGPL core free of any one
nation's tax logic.

## Architecture

Refactor the current Finance into **core + pack interface**, so today's Gift-Aid code becomes the first
pack rather than a special case baked into `stew-finance.jsx` / `steward-finance.src.js`.

```
TaxPack interface (one object per country):
  id            'uk-giftaid' | 'us-501c3' | 'ca-cra' | ...
  label         'UK Gift Aid'
  currencyHint  'GBP' | 'USD' | ...           // default base currency suggestion
  donorFields   [ {key,label,required,help} ] // extra fields the pack needs (e.g. UK: house, postcode)
  txFields      [ {key,label} ]               // extra per-gift fields (e.g. UK: giftAid eligible flag)
  eligible(tx, donor, settings) -> bool        // is this gift claimable/receiptable under this pack?
  summary(txs, donors, settings) -> {…}        // headline tiles (e.g. UK: eligible total + reclaim est.)
  exports       [ { id, label, kind:'csv'|'html', build(txs,donors,funds,settings) -> blob } ]
  validate(donor) -> [missingField]            // flag records missing what the artefact requires
```

- **Registry:** the church's Finance settings already persist `{ enabled, baseCurrency, giftAid }`
  (`steward-finance.src.js` SETTINGS_D doc). Generalise `giftAid:bool` → `taxPack:'uk-giftaid'|null`
  (keep reading the old `giftAid` flag for back-compat → maps to `uk-giftaid`). Optionally allow more
  than one pack (rare — a church in one country).
- **UI:** `stew-finance.jsx` already gates ~35 Gift-Aid points behind `giftAid`/`gaOn`. Replace those
  with `pack` lookups — the Gift Aid tab/tiles/claim-builder become "the active pack's surface". The
  Settings card's "UK Gift Aid (UK only)" sub-toggle becomes a **pack picker** ("Tax & statements:
  [None ▾ / UK Gift Aid / US statements / …]").
- **Packs live outside the free core** for the paid ones. Two viable shapes:
  - *first-party, bundled-but-licence-flagged:* ship packs in a separate `vendor/taxpacks.*.js`, enabled
    by a signed entitlement the church holds (so the AGPL core stays generic; packs are the product). 
    Simplest for v1.
  - *arm's-length service:* a pack endpoint that takes the (church-decrypted, console-side) figures and
    returns the formatted artefact. Cleaner licensing, but moves PII off-device — **only if the church
    opts in**; default to on-device packs to preserve the encryption story.
  Recommended v1: **on-device packs + a signed entitlement** (keeps PII on the device; entitlement is
  the paid gate). Revisit arm's-length only if a pack needs server-side filing/API submission.

## Build steps (v1)

1. **Refactor** the existing Gift-Aid code in `stew-finance.jsx` + `steward-finance.src.js` behind the
   `TaxPack` interface; ship **`uk-giftaid`** as the first pack (no behaviour change for the UK pilot).
2. **Settings:** `giftAid` → `taxPack`; pack picker UI; back-compat read of the old flag.
3. **Second pack** to prove the interface: **`us-501c3`** annual statements (simplest — donor + yearly
   total + IRS wording, HTML/PDF; no reclaim, no claim batching). This validates that "core + pack"
   genuinely generalises.
4. **Entitlement gate:** a church holds a signed entitlement (reuse the Ed25519 release-signing pattern,
   `relay/release-key.pem` → a per-pack signature) that unlocks a paid pack; absent it, the pack picker
   shows the pack as "available — contact us". Free packs (if any) need no entitlement.
5. **Docs:** per-pack treasurer notes appended to `TREASURY.md`.

## Open questions / decisions

- **Pricing shape:** per-pack one-off vs annual maintenance sub (lean annual — the value *is* keeping it
  current). Bundle with hosted-relay tier?
- **Filing depth:** stay at "export the official schedule, church uploads it" (the deliberate boundary
  today), or later offer **API submission** (UK GovTalk, etc.) as a higher tier — that's an arm's-length
  *service* pack (server-side), priced accordingly.
- **Entitlement vs honesty:** for a self-hosting church, packs are technically inspectable (AGPL-adjacent
  ethics) — frame the paid pack as "maintained + supported", and gate the *first-party hosted* build,
  not the ability to self-write.
- **GASDS / aggregated donations / multi-currency reclaim** — UK-pack depth deferred (already noted in
  SPINE Finance "Not yet").

## Reuse / touchpoints

- `stew-finance.jsx` (UI, ~35 Gift-Aid gates), `src/steward-finance.src.js` (`window.StewardFinance`:
  `giftAidSummary`, `exportGiftAidCsv`, `exportHmrcCsv`, `claimSummary`, settings doc).
- Nationality-agnostic guardrail (memory `nationality-agnostic.md`): **no country specifics in the
  default product** — packs are the *only* place country tax logic may live, and they're opt-in.
