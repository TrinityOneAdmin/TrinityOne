# Manna module (money-out / disbursements)

Optional Steward Console module — the **money-out** counterpart to Finance (money-in). It governs how a
church gives from **its own** treasury to people in need: who may receive, gated by what, vouched by
whom, approved how, and recorded for the trustee. Off by default; a steward turns it on in
**Settings → Finance**. Full rationale lives in `../Manna/Welfare_Protocol_Architecture_2026.md`.

## Files

| File | Role |
|---|---|
| `src/steward-manna.src.js` | Engine. Exposes `window.StewardManna`. Bundle with `scripts/build-steward-manna.sh` → `vendor/steward-manna.js`. |
| `stew-manna.jsx` | UI — `DashManna` (console tab) + `DashMannaPanel` (Settings enable card). Functional scaffold; visual design is a separate pass (`../Manna/Manna_Experience_Brief.annotated.md`). |
| `steward-root.jsx` | Adds the `useManna*` React hooks (mirrors `useFinance*`). |
| `stew-dashboard.jsx` | Nav item (gated on `useMannaSettings().enabled`), tab render, Settings panel. |
| `steward.html` | Loads `vendor/steward-manna.js` + `stew-manna.jsx`. |

Build: `bash scripts/build-steward-manna.sh` (esbuild, same as Finance). Dev serve uses in-browser Babel — no build needed for the `.jsx`.

## Disbursement flow (modelled as encrypted church docs)

```
grant-request → nomination/vouch (Barnabas chain) → approval (Keykeeper) →
payout (NWC pay_invoice — NOT wired) → disbursement-record → consented testimony
```

All recipient-naming docs are NIP-44 **encrypted to the church key** via `Steward.encPublish/encSubscribe`
(kind 30078, `enc` tag). The ledger names vulnerable people — it is encrypted and minimised, never a watch-list.

`d`-tag namespace (`trinityone/manna-`): `settings`, `fund:<id>`, `request:<id>`, `vouch:<id>`,
`approval:<reqId>`, `record:<reqId>`, `testimony:<id>`.

## Two tiers (theology encoded, not a preference)

- **mercy / gleaning** — open draw, no nominator, small cap, single or auto approval under a threshold.
- **covenant / family** — nomination-gated; a sponsor relationship is **required**; witnesses scale with
  the amount (Deut 19:15 — two or more for larger sums). Policy in `requiredWitnesses` / `vouchStatus` / `canAutoApprove`.

## Wiring real payouts (deliberately disabled)

`StewardManna.pay()` routes through a pluggable adapter `window.MannaPayout`; the default **refuses**.
Per the build order, model the events first, then wire NWC (NIP-47 `pay_invoice`) against
**regtest/signet or a tiny low-value wallet** before any real value moves:

```js
window.MannaPayout = {
  async pay({ ln, amountSats, memo }) {
    // resolve `ln` (recipient's own Lightning Address) → invoice, then NWC pay_invoice from the
    // church's budget-scoped treasury connection. Return { preimage } or { ref }.
  },
};
```

Approval signing today is the single church key (`method: 'church-key'`); graduate to NIP-46 hardware
signing and m-of-n multisig on the reserve as amounts rise (see the architecture doc's "Honest cautions").
