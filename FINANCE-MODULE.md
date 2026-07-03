# TrinityOne Finance — Build Scope

**Status:** design draft · 2026-07-03
**Decision:** church/nonprofit only · nation-neutral · steward-console module · activated by a Lightning (Strike) invoice, active only while paid.

---

## 1. Vision
A complete accounting system for churches and small nonprofits — **as capable as Xero / QuickBooks**, but built around how churches actually keep money: real **fund accounting**, donations, trustees' reporting. It lives **in the steward console** as an optional module, is **switched on by paying a Lightning invoice** (Strike), and stays active **only while paid**. Its subscription revenue helps **fund the relay/node network** that keeps TrinityOne running. It is **nation-neutral** at its core, with country-specific tax/relief handled as optional, off-by-default packs.

Not a general SMB accounting product. Not the member app. Not custodial.

## 2. Principles (inherited from the rest of TrinityOne)
- **Owned by no one.** The church's books are their own encrypted events on their own key/relay. We never hold the data hostage — see §7.
- **Nation-neutral by default.** The core ledger, reports, and language assume no country. Gift Aid, US 501(c)(3)/990, etc. are optional regional **packs**, off by default, never in the default framing. (Consistent with the existing `giftAid` toggle policy.)
- **Works over a thin pipe.** Local-first, cache-first, offline-capable; statement *import* (CSV/OFX) before live bank feeds.
- **Correctness is existential.** A ledger that doesn't balance destroys trust instantly — invariants are tested, not hoped for (§6).
- **Non-custodial.** Strike routes the subscription payment; we never hold church or member funds. No KYC/AML surface.

## 3. Who it's for
- **Treasurer** (primary) — keeps the books, reconciles the bank, runs donation-relief claims, produces year-end accounts.
- **Independent examiner / accountant** (review + adjust, read-mostly).
- **Trustees / pastor** (read-only dashboard — "where are we?").
Roles reuse the existing **steward-delegation** model (owner → treasurer → examiner → viewer), revocable, keyed.

## 4. Activation & subscription (the "only while paid" model)
- The module is **off by default** in the steward console.
- A steward **activates it by paying a Lightning invoice** (Strike) for a **prepaid period** (e.g. monthly / yearly). Lightning has no card-style auto-pull, so billing is prepaid + renewal-invoice + reminders, **not** silent recurring charges.
- **State machine:** `off → active → grace → lapsed`.
  - **active** — full read/write in the console.
  - **grace** — short window after expiry; reminders; still writable.
  - **lapsed** — the console module **locks for writing** (honouring "only while paid"), **but the church's data is never destroyed** (it's their encrypted events) and **stays exportable**; paying again **reactivates instantly** with all history intact. "You can't keep writing to the books until you renew — but you never lose them."
- **Funds the network, transparently.** A defined share of subscription income funds relay operations; surface it ("your subscription keeps N relays running") — on-ethos and a selling point.
- Billing runs **separately** from the church's own books (don't co-mingle our SaaS accounting with theirs).

## 5. Feature scope — full accounting, church-shaped
Target is **parity with major accounting software for the church/NP use case**, phased. Grouped by area; MVP items marked.

**A. Ledger core (MVP — the foundation)**
- Chart of accounts (assets / liabilities / equity / income / expenditure), church-NP default template.
- **Double-entry journal** — every transaction balances; **append-only / immutable**; corrections by reversing entries, never edits.
- **Fund accounting** — restricted / designated / general funds carried on every posting (the thing Xero does poorly and churches need most).
- **Multi-currency** (nation-neutral → international churches need it): base currency + foreign transactions + revaluation. *(P2/P3.)*

**B. Money in**
- Manual income + categorisation (MVP).
- **Donations & donors** — donor records, statements (MVP→P2).
- **Regional giving-relief pack** — e.g. UK Gift Aid claim builder + submission; US contribution statements — **optional, off by default** (P3, per region).
- Sales invoicing / accounts receivable — hall hire, events, courses (P3).

**C. Money out (P2)**
- Bills / expenses, receipt attachments, **approvals via steward roles**, accounts payable, reimbursements.

**D. Banking & reconciliation (P2→P4)**
- **Import**: CSV / OFX statement upload first (universal, thin-pipe-friendly).
- **Reconcile**: match statement lines to ledger entries; flag unmatched.
- Live bank feeds / Open Banking: P4 (per-bank, per-country — cost + compliance).

**E. Reports (MVP→P2)**
- MVP: trial balance, income & expenditure (P&L), fund balances.
- P2: balance sheet, cash flow, budget-vs-actual, aged debtors/creditors, **trustees' annual-report / fund-accounting summary** (SORP-style but nation-neutral).
- Everything derived from the journal, materialised locally (cache-first).

**F. Multi-user, roles, audit (MVP→P2)**
- Roles via the steward roster; **immutable audit trail** (who posted/approved what, when) falls out of the event-sourced design for free.

**G. Attachments, exports, close (P2→P3)**
- Receipt/document attachments; **first-class export** (CSV/JSON/PDF + full journal for an accountant); period lock / year-end close.

**H. Out of v1:** payroll (huge, per-jurisdiction — a later regional pack), inventory/stock, projects/job costing, fixed-asset registers, general-SMB features.

## 6. Architecture & data model
- **Event-sourced, local-first, keyed to the church.** Each journal entry is a **signed, encrypted event** on the church's relay — only authorised roles can decrypt. Append-only = accounting integrity + audit trail for free. Lives in the **steward console** (`stew-*` / `steward.html`); no member-app surface.
- **Consistency is THE technical decision.** Accounting demands balances that always reconcile, so use a **single-writer "book" model**: one authoritative write-path per set of books, with the **relay as ordering authority** and a **monotonic sequence number** per book; concurrent edits queue, they don't fork. (Multi-writer + later reconciliation is where naive event-sourced ledgers break — avoid it.)
- **Reports are projections** rebuilt from the journal and cached locally, so they open offline over a thin pipe.
- **Reuse everything:** identity/keys, the steward roster for roles, the relay + shared-sub (E2), cache-first paint, the module-toggle pattern, the Nostr doc model, the existing basic treasurer ledger as the seed.
- **Invariant test suite** is non-negotiable: every projection (trial balance, fund balances, statements) must reconcile to the journal to the penny; debits == credits always; property-based tests on random transaction streams.

## 7. Data ownership & retention
- Data is the church's encrypted events on their key — **inherently theirs**, even lapsed/unsubscribed.
- **Export always available** (even when lapsed) — legal record-keeping obligations (commonly 6+ years) mean "never lose the books" is a design requirement, not a nicety.

## 8. Compliance (read before committing)
- **Nation-neutral core sidesteps most certification.** Country-specific tax filing (e.g. UK Making Tax Digital, HMRC-recognised software) is a real **per-region certification road** — pursued **only** where a regional pack demands it, not baseline.
- Gift Aid / contribution-relief submission is per-region and lives in packs.
- Non-custodial throughout (Strike routes; we never hold funds) keeps us clear of money-transmission/KYC.

## 9. Phasing
- **P0 — Foundation:** ledger engine (double-entry + funds + relay-ordered sequencing), event model, encryption, roles, invariant tests, the Strike prepaid-activation state machine.
- **P1 — MVP (shippable, beats a spreadsheet):** chart of accounts, manual income/expense, fund balances, trial balance + I&E, donor records, CSV export, Lightning activation.
- **P2 — Treasurer-complete:** bills/AP, receipts, statement import + reconciliation, balance sheet + budgets, trustees' report.
- **P3 — Depth & regional:** invoicing/AR, multi-currency, period close/lock, first regional pack (e.g. UK Gift Aid submission).
- **P4 — Scale:** live bank feeds, more regional packs, integrations, (later) payroll pack.

## 10. Effort (honest)
- **P0+P1** is a substantial focused build — the ledger engine + Strike activation is most of the risk; done well it's genuinely useful.
- **Full parity** across all phases is a multi-quarter road. Scope to P1; let real churches pull the roadmap.

## 11. Non-goals (v1)
General-SMB market · payroll · inventory · projects/job costing · fixed-asset registers · live bank feeds · any country's tax filing in the baseline · custody of funds · member-app finance UI.

## 12. Open items to settle before P0
1. **Subscription price + period** and the node-funding split (and whether to show it).
2. **Strike integration shape** — invoices + renewal reminders; who watches for payment (relay-side vs console-side).
3. **Regional pack format** — how a country's relief/report rules plug in cleanly (so packs are additive, never core).
4. **Seed vs rebuild** — extend the existing treasurer ledger's data, or start the double-entry engine fresh and migrate.
