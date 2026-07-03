# TrinityOne Finance — Build Scope & Design

**Status:** design draft · 2026-07-03 · branch `claude/finance-module`

**Decisions (locked):** church/nonprofit only · nation-neutral · lives in the **steward console** · **rebuilt fresh** (new double-entry engine, not an extension of the current basic ledger) · **freemium**: a free *Standard* tier + a paid *Full* tier at **~$5/year**, activated by a **Lightning (Strike) invoice** and active only while paid · subscription revenue helps fund the relay network.

---

## 1. Vision
A complete accounting system for churches and small nonprofits — **as capable as Xero / QuickBooks for the church use case** — built around how churches actually keep money (real **fund accounting**, donations, trustees' reporting). It lives in the steward console, is **nation-neutral** at its core, and gates its advanced power behind a tiny yearly Lightning subscription whose revenue helps keep the relays running.

Not general-SMB. Not the member app. Not custodial.

## 2. Tier model (free Standard / paid Full)
One rebuilt double-entry engine, two tiers:

- **Standard — free, always.** The essentials most small churches need: record income & expenditure, a handful of funds, donor records, the core reports (income & expenditure, fund balances), and CSV export. No payment, ever.
- **Full — ~$5/year via Lightning.** The whole package: full chart of accounts, unlimited funds, **bank statement import + reconciliation**, bills / accounts payable with approvals, **invoicing / accounts receivable**, **multi-currency**, budgets, balance sheet + cash flow + aged reports + trustees' report, **examiner (multi-user) access**, period close, and **regional tax/relief packs** (e.g. UK Gift Aid) — all optional and off by default.

**"Only while paid" means graceful, not punitive.** When Full lapses, the console **reverts to Standard** — Full-tier *writing* locks, but every book, entry and attachment is preserved (it's the church's own encrypted data) and stays **exportable**, and Standard bookkeeping continues free. Re-paying reactivates Full instantly with all history intact. A church never loses its books over a missed renewal.

## 3. Principles (inherited)
- **Owned by no one** — the books are the church's encrypted events on their own key/relay; export is always available (legal record-keeping is commonly 6+ years).
- **Nation-neutral by default** — core ledger/reports/language assume no country; regional tax/relief are optional off-by-default **packs** (consistent with the existing `giftAid` toggle policy).
- **Thin-pipe first** — local-first, cache-first, offline; statement *import* (CSV/OFX) before live feeds.
- **Correctness is existential** — invariants are tested, not hoped for (§7).
- **Non-custodial** — Strike routes the sub payment; we never hold church or member funds (no KYC/AML surface).

## 4. Who it's for
Treasurer (primary, read/write) · Independent examiner / accountant (review + adjust) · Trustees / pastor (read-only dashboard). Roles reuse the **steward-delegation** model (owner → treasurer → examiner → viewer), revocable, keyed.

## 5. Strike integration — recommended design
Goal: collect a ~$5/year Lightning payment, unlock Full, keep it non-custodial and nation-neutral, with almost-zero operational overhead.

**Receiving (server-side, on the relay — the Strike secret NEVER touches the client):**
1. In the console, the treasurer taps **"Unlock Full accounting — ~$5/year."**
2. The console asks the **relay** to start activation. The relay calls the **Strike API**: create an **invoice** for the $5-equivalent, tagged `correlationId = <churchpub>:<period>`, then take a **quote** → Strike returns a **BOLT11 Lightning invoice** (+ optional on-chain).
3. The console renders it as a **QR + copyable string** (reuse the app's existing QR renderer).

**Paying (church side — wallet-agnostic → this is what makes it nation-neutral):**
- The treasurer pays the BOLT11 from **any** Lightning wallet — Strike, Phoenix, Wallet of Satoshi, their own node, BTCPay, whatever. **No Strike account required by the church.** The $5 is billed as the sats-equivalent at pay time (Strike's USD quote), so the amount is BTC-denominated and country-agnostic.
- For $5, **Lightning-only** (on-chain fees can exceed the sub); offer a multi-year option if you want an on-chain path.

**Confirming + entitlement:**
- Strike fires a **webhook** to the relay on payment (fallback: the relay polls invoice status). On `PAID`, the relay sets `subscription[churchpub].paidUntil = now + 1y` and issues a **relay-signed entitlement** — an Ed25519-signed record the console verifies against the **baked-in relay pubkey** (the same trust anchor as the signed self-update). Entitlement can't be forged client-side.

**Enforcing "only while paid":**
- **Client gate (primary):** the console shows Full features only while the verified entitlement is current, else Standard. Proportionate for an honest-church $5 product — this is a paywall, not DRM.
- **Server backstop (light):** the relay refuses to *store* the **Full-tier event kinds** (reconciliation, invoices, regional-pack docs, …) unless the church has a current entitlement. Standard-tier kinds are always accepted (free). So the paywall isn't trivially bypassed by editing the client, without heavy DRM.

**Renewal + lapse:**
- Relay reminds the console ~30 days before expiry (console notice / push). A fresh invoice extends `paidUntil`.
- Grace (~1 week) → lapse → console reverts to Standard; Full writes lock; data preserved + exportable.

**Node funding + economics:**
- The $5 lands in the network's Strike account; a **defined, transparent share funds relay operations** (eventually dogfooded in the module's own books).
- ~1–2 Strike API calls per church per year; Lightning fees are sats. $5/yr is comfortably viable.

**Strike availability note:** Strike (the *receiver*) has country limits; the *payer* is wallet-agnostic so unaffected. If a region ever needs a non-Strike receiver, the identical invoice→pay→webhook flow works behind the relay with LNbits / BTCPay / a self-hosted node — Strike is the default, not a hard dependency.

## 6. Feature scope by tier
| Area | Standard (free) | Full (paid) |
|---|---|---|
| Ledger | income/expense, double-entry, small fund set | full chart of accounts, unlimited funds |
| Money in | manual income, donor records | invoicing / AR, regional giving-relief packs |
| Money out | manual expense | bills / AP, approvals, reimbursements, receipts |
| Banking | — | statement import (CSV/OFX) + reconciliation; live feeds (P4) |
| Reports | I&E, fund balances | + balance sheet, cash flow, budgets, aged reports, trustees' report |
| Currency | base only | multi-currency + revaluation |
| Users | treasurer | + examiner (multi-user), period close/lock |
| Everywhere | CSV export, immutable audit trail | + full journal / accountant export |
Out of v1 entirely: payroll (later regional pack), inventory, projects/job-costing, fixed-asset registers, general-SMB, member-app finance UI.

## 7. Architecture & data model (rebuilt fresh)
- **Event-sourced, local-first, keyed to the church.** Each entry is a **signed, encrypted event** on the church's relay, decryptable only by authorised roles. Append-only = integrity + audit trail for free. Steward console only (`stew-*` / `steward.html`).
- **Consistency is THE decision → single-writer "book" model.** One authoritative write-path per set of books; the **relay is the ordering authority**, assigning/validating a **monotonic sequence** per book; concurrent edits queue, they never fork. Corrections are **reversing entries** (append), never edits. (Multi-writer + later reconciliation is where naive event-sourced ledgers break — avoided.)
- **Proposed event kinds** (church-keyed, encrypted):
  - `finance/settings` — base currency, fiscal year, tier state.
  - `finance/account:<id>` — a chart-of-accounts line (type, name, fund-eligibility).
  - `finance/fund:<id>` — a fund (general / designated / restricted).
  - `finance/journal:<seq>` — a **journal entry**: `{ seq, date, memo, postings:[{account, fund, dir:'dr'|'cr', currency, amount}], attachmentRefs, by, ts }`; **invariant: Σdebits == Σcredits**.
  - `finance/donor:<id>`, `finance/contact:<id>`, `finance/invoice:<id>`, `finance/bill:<id>`, `finance/reconcile:<stmt>` — the Full-tier docs the server backstop gates.
- **Projections** (trial balance, fund balances, P&L, balance sheet, aged) are rebuilt locally from the journal and cached (cache-first, offline). **Every projection must reconcile to the journal to the penny.**
- **Roles** via the steward roster. **Regional packs** register additively (a pack supplies extra report formats + a relief-claim builder/exporter; core never imports a country).
- Reuse: identity/keys, steward roster, relay + shared-sub (E2), cache-first paint, module-toggle pattern, QR renderer, the signed-entitlement trust anchor.

## 8. Correctness & compliance
- **Invariant test suite is non-negotiable:** debits == credits always; every projection reconciles to the journal; property-based tests over random transaction streams; period-close immutability.
- **Nation-neutral core sidesteps most certification.** Country tax filing (e.g. UK MTD / HMRC-recognised software) is a per-region road, pursued **only** where a pack demands it — never baseline.
- Non-custodial throughout keeps clear of money-transmission / KYC.

## 9. Phasing
- **P0 — Foundation:** ledger engine (double-entry + funds + relay-ordered sequencing), event model + encryption, roles, **invariant tests**, the **Strike activation state machine + relay-signed entitlement**, tier-gating (client + server backstop).
- **P1 — Standard tier shippable (free):** chart of accounts, income/expense, funds, trial balance + I&E, donor records, CSV export. *Beats a spreadsheet for most churches, at no cost.*
- **P2 — Full tier core:** bills/AP + receipts, statement import + reconciliation, balance sheet + budgets, trustees' report, examiner access — behind the $5 paywall.
- **P3 — Depth & first regional pack:** invoicing/AR, multi-currency, period close, the first relief pack (e.g. UK Gift Aid submission).
- **P4 — Scale:** live bank feeds, more regional packs, integrations, (later) payroll pack.

## 10. Effort (honest)
P0+P1 is a substantial focused build — the ledger engine + Strike activation is most of the risk. Full parity across P2–P4 is a multi-quarter road. Scope to P1; let real churches pull the rest.

## 11. Settled inputs
Price **~$5/year**; **Strike** receiver (design in §5); **regional packs** as the extensibility mechanism (§7); **rebuild fresh** (new engine; the current basic treasurer ledger is superseded by the free Standard tier). Remaining to pin at P0 start: exact node-funding split (and whether to display it), and the multi-year/on-chain option.
