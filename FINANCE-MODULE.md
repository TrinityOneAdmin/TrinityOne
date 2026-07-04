# TrinityOne Finance — Build Scope & Design

**Status:** design draft · 2026-07-04 · branch `claude/finance-module`

**Decisions (locked):** church/nonprofit only · nation-neutral · lives in the **steward console** · **rebuilt fresh** (new double-entry engine, not an extension of the current basic ledger) · **free & open, no paywall** — every feature works for every church; monetised only by a **gentle donation nudge** shown when the books are opened (hidden ~3 months after a gift), which needs just a static donation address, not an invoice-minting backend.

---

## 1. Vision
A complete accounting system for churches and small nonprofits — **as capable as Xero / QuickBooks for the church use case** — built around how churches actually keep money (real **fund accounting**, donations, trustees' reporting). It lives in the steward console, is **nation-neutral** at its core, and stays **free and open** — every feature works for every church — with a gentle donation nudge that helps keep the shared relays running.

Not general-SMB. Not the member app. Not custodial.

## 2. Free & open — a donation nudge, not a paywall
One rebuilt double-entry engine, **every feature free for every church** (AGPL, self-hostable). No tiers, no lock, no entitlement.

**The nudge.** When a steward opens the books, a gentle dialog appears — *"Keep TrinityOne going"* — with suggested amounts, **Give with Lightning** (a `lightning:` link any wallet opens) + a copyable address, and a "give another way" link (Strike / other gateway). Buttons: *Maybe later* (no change) and *I've given*. After a gift it's **hidden ~3 months**; otherwise it reappears once per session. It never blocks anything.

**Why this fits.** TrinityOne is AGPL and self-hostable, so a feature paywall can't hold anyway (a self-hoster may legally strip it) — and the README's thesis is *not being charged for the tools*. A donation ask is honest: the software is free and yours; a gift just helps cover the shared relays you're using. It also needs only a **static donation address** — no per-invoice Lightning backend, no entitlement infra.

**Detection.** For now the 3-month hide is honour-system (the *I've given* button). It can be upgraded to real payment detection later if/when a Lightning backend is stood up.

**The features** (all free): full chart of accounts, unlimited funds, income & expenditure + fund balances, donor records, CSV export today — and, on the roadmap, bank statement import + reconciliation, bills / AP with approvals, invoicing / AR, multi-currency, budgets, balance sheet + trustees' report, examiner (multi-user) access, period close, and **regional tax/relief packs** (e.g. UK Gift Aid, off by default).

## 3. Principles (inherited)
- **Owned by no one** — the books are the church's encrypted events on their own key/relay; export is always available (legal record-keeping is commonly 6+ years).
- **Nation-neutral by default** — core ledger/reports/language assume no country; regional tax/relief are optional off-by-default **packs** (consistent with the existing `giftAid` toggle policy).
- **Thin-pipe first** — local-first, cache-first, offline; statement *import* (CSV/OFX) before live feeds.
- **Correctness is existential** — invariants are tested, not hoped for (§7).
- **Non-custodial, no account** — the sub is received by the project's **own self-hosted Lightning node**; no third-party/custodial account, no KYC/AML surface, no one who can freeze or de-platform it. We never hold church or member funds.

## 4. Who it's for
Treasurer (primary, read/write) · Independent examiner / accountant (review + adjust) · Trustees / pastor (read-only dashboard). Roles reuse the **steward-delegation** model (owner → treasurer → examiner → viewer), revocable, keyed.

## 5. Payments — self-custodial Lightning (deferred; see §2)
> **Superseded for the subscription:** §2's donation nudge replaced the paid tier, so **no invoice-minting / entitlement backend is needed to ship**. This section is retained for two *future* uses: (a) optional real payment-detection for the donation nudge, and (b) per-church **giving** receiving (tithes/offerings) — likely on the church-box (`CHURCH-BOX.md`), not the project relay. The design below still applies if/when either is built.

Goal (future): collect a payment to the project's **own self-custodial node** — **no custodial account**, **no funds in any third party**, nation-neutral, near-zero overhead.

**The project runs its OWN Lightning backend — no Strike/custodial account.** A self-hosted **BTCPay Server or LNbits** node alongside the relay infra (self-hosting is already the ethos). It exposes a Bitcoin-native **Lightning address** (e.g. `sub@trinityone.church`) + an API to mint per-invoice requests. No business account, no KYC, no third party holding funds, nothing to freeze/de-platform — the $5s land straight in the project's own node.

**Flow (the same shape as any invoice provider, just pointed at your own node):**
1. In the console, the treasurer taps **"Unlock Full accounting — ~$5/year."**
2. Console → **relay** → the self-hosted LN backend mints a **BOLT11 invoice** for the $5-equivalent, tagged with the church, shown as a **QR + copyable string** (reuse the app's QR renderer).
3. The treasurer **pays it from any Lightning wallet** (BTC). The amount is the sats-equivalent at pay time → BTC-denominated and country-agnostic; no account needed by the church.
- For $5, **Lightning-only** (on-chain fees can exceed the sub); offer a multi-year option if you want an on-chain path.

**Confirming + entitlement:**
- The LN backend fires a **webhook** to the relay on payment (fallback: the relay polls invoice status). On `PAID`, the relay sets `subscription[churchpub].paidUntil = now + 1y` and issues a **relay-signed entitlement** — an Ed25519-signed record the console verifies against the **baked-in relay pubkey** (the same trust anchor as the signed self-update). Entitlement can't be forged client-side.

**Enforcing "only while paid":**
- **Client gate (primary):** the console shows Full features only while the verified entitlement is current, else Standard. Proportionate for an honest-church $5 product — this is a paywall, not DRM.
- **Server backstop (light):** the relay refuses to *store* the **Full-tier event kinds** (reconciliation, invoices, regional-pack docs, …) unless the church has a current entitlement. Standard-tier kinds are always accepted (free). So the paywall isn't trivially bypassed by editing the client, without heavy DRM.

**Renewal + lapse:**
- Relay reminds the console ~30 days before expiry (console notice / push). A fresh invoice extends `paidUntil`.
- Grace (~1 week) → lapse → console reverts to Standard; Full writes lock; data preserved + exportable.

**"Pay by debit card" — the honest constraint:** a card charge always needs a card processor *somewhere*; you can't have both "no account anywhere" **and** a native card button. Two clean card paths:
- **Account-less (recommended, default):** the card rail lives on the **payer's side** — a church with no Bitcoin funds *their own* wallet with a card (Strike, Cash App, Wallet of Satoshi's on-ramp, …) and pays the invoice. *Their* account, not the project's → "pay by card" works with **zero project account**. UX: *"No Bitcoin yet? Top up any Lightning wallet with a card, then pay this."*
- **In-checkout card button (optional, later):** a literal "pay with card" button in the console needs a card-checkout provider account — the one unavoidable account (Zaprite / IBEX / OpenNode / BTCPay + a card plugin). Pick one that **settles to your self-custodial address** so funds stay non-custodial. Defer until card convenience is proven necessary.

**Node funding + economics:**
- The $5s land in the project's **own node**; a **defined, transparent share funds relay operations** (eventually dogfooded in the module's own books).
- ~1–2 LN-backend calls per church per year; Lightning fees are sats. $5/yr is comfortably viable.

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
- **P0 — Foundation:** ledger engine (double-entry + funds + relay-ordered sequencing), event model + encryption, roles, **invariant tests**, the console UI, and the **donation nudge** (§2). No entitlement / tier-gating (dropped with the paywall).
- **P1 — Shippable core (free):** chart of accounts, income/expense, funds, trial balance + I&E, donor records, CSV export. *Beats a spreadsheet for most churches, at no cost.*
- **P2 — Deeper features (still free):** bills/AP + receipts, statement import + reconciliation, balance sheet + budgets, trustees' report, examiner access.
- **P3 — Depth & first regional pack:** invoicing/AR, multi-currency, period close, the first relief pack (e.g. UK Gift Aid submission).
- **P4 — Scale:** live bank feeds, more regional packs, integrations, (later) payroll pack.

## 10. Effort (honest)
P0+P1 is a substantial focused build — the ledger engine + Lightning activation is most of the risk. Full parity across P2–P4 is a multi-quarter road. Scope to P1; let real churches pull the rest.

## 11. Settled inputs
**Free & open, donation nudge** (no paywall/tiers — §2), needing only a **static donation address** (an LN address + a Strike/other link); **regional packs** as the extensibility mechanism (§7); **rebuild fresh** (new engine; the current basic treasurer ledger is superseded). Deferred (not needed to ship): the self-hosted Lightning receiver + which backend (BTCPay vs LNbits vs a bare node) — only relevant if we later add real donation-payment *detection*, or per-church **giving** (§5, `CHURCH-BOX.md`).
