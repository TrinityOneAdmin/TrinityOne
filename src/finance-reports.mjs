// src/finance-reports.mjs — TrinityOne Finance: pure period/fund reporting projections (Phase 4a).
//
// Aggregate, nation-neutral, and carries NO member names — safe for a trustees' pack or a public filing.
// No DOM, no relay, no I/O, and — like every pure finance module — NO `Date` of its own: the caller injects
// the period bounds as ISO 'YYYY-MM-DD' strings (CONTEXT 2026-10-29: a pure module that calls new Date()
// reintroduces the UTC off-by-one guarded by finance-this-year-starts-on-the-local-day.test.mjs). Money stays
// INTEGER minor units. Every figure here derives from the journal and reconciles to it to the penny.
//
// These feed the console Reports panel and the existing statement render/export path (finance-statement.mjs
// buildStatement → statementText/statementHtml → the PDF/CSV/HTML download via saveConsoleFile). `from`/`to`
// are inclusive; omit `from` for an all-time report (opening carried in = 0).

import { FUND_TRANSFER_ACCT, incomeExpenditure } from './finance-ledger.mjs';

const END = '￿';   // the same high sentinel finance-ledger uses: lexically after every ISO date

// The signed change a single posting makes to ITS fund's balance — the SAME rule as finance-ledger.fundBalances
// and finance-statement.closingFunds: keyed on the reserved transfer account id, never on type==='equity' (a
// real equity account carrying a fund would otherwise be miscounted). Kept identical in all three copies; a
// drift here silently breaks check() invariant 3 (fund sum === surplus).
function fundDelta(book, p) {
  if (!p.fund) return 0;
  if (p.account === FUND_TRANSFER_ACCT) return p.dir === 'cr' ? p.amount : -p.amount;
  const a = book.accounts.get(p.account);
  if (!a) return 0;
  if (a.type === 'income') return p.dir === 'cr' ? p.amount : -p.amount;
  if (a.type === 'expense') return p.dir === 'dr' ? -p.amount : p.amount;
  return 0;
}

// Per-fund movement over a period — the trustees'/SORP fund-movements table that NEITHER existing projection
// gives (fundBalances is all-time; incomeExpenditure is not fund-split). For each fund:
//   opening — balance carried in from strictly BEFORE `from`
//   in      — resources received into the fund in the period (income credited + transfers in: positive deltas)
//   out     — resources expended from the fund in the period (expenditure + transfers out: negative deltas)
//   closing — opening + in − out  (== the fund balance as-of `to`)
// Reconciles to the penny BY CONSTRUCTION: in − out is exactly the sum of the period's fund deltas, so
// closing === the as-of-`to` fund balance and, with from='', opening === 0 and closing === fundBalances().
export function fundMovements(book, { from = '', to = END } = {}) {
  const acc = new Map();   // fundId -> { opening, in, out }
  const get = id => { let o = acc.get(id); if (!o) { o = { opening: 0, in: 0, out: 0 }; acc.set(id, o); } return o; };
  for (const e of book.journal) {
    if (e.date > to) continue;
    const before = from && e.date < from;
    for (const p of e.postings) {
      const d = fundDelta(book, p);
      if (d === 0) continue;
      const o = get(p.fund);
      if (before) o.opening += d;
      else if (d > 0) o.in += d;
      else o.out += -d;
    }
  }
  return [...book.funds.values()].map(f => {
    const o = acc.get(f.id) || { opening: 0, in: 0, out: 0 };
    return { fund: f.id, name: f.name, kind: f.kind, opening: o.opening, in: o.in, out: o.out, closing: o.opening + o.in - o.out };
  }).sort((a, b) => (a.fund === 'general' ? -1 : b.fund === 'general' ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));   // general first, else by name
}

// SORP Receipts & Payments — the cash-basis statement that is the UK norm for small charities (DOMAIN: R&P is
// the small-charity norm; "SORP" is a preset over this nation-neutral report). A receipt/payment is recognised
// ONLY when CASH actually moves: an entry that touches no cash account (a pure accrual — raising an invoice,
// accruing a bill) contributes nothing. That is the one real-world ASSUMPTION this report makes (DOMAIN rule 7):
// with NO debtors/creditors (no accrual postings) EVERY income/expense entry has a cash leg, so
//   totalReceipts === incomeExpenditure(from,to).income   and   totalPayments === .expenditure
// — proven by finance-reports.test.mjs, which ALSO proves the divergence once an accrual sits on a non-cash
// asset, so this is genuinely cash-based and not incomeExpenditure under another name.
//
// `cashAccounts` names the accounts treated as cash (default: every asset account — correct for a pilot church
// whose only asset is the bank). A church that later adds a debtors/AR asset passes the real cash set to exclude
// it, and the accrual then stops counting as a receipt.
export function receiptsAndPayments(book, { from = '', to = END, cashAccounts = null } = {}) {
  const cash = cashAccounts
    ? new Set(cashAccounts)
    : new Set([...book.accounts.values()].filter(a => a.type === 'asset').map(a => a.id));
  const nameOf = id => (book.accounts.get(id) || {}).name || id;
  const rec = new Map(), pay = new Map();
  let openingCash = 0, periodCash = 0;
  for (const e of book.journal) {
    if (e.date > to) continue;
    const cashDelta = e.postings.reduce((s, p) => cash.has(p.account) ? s + (p.dir === 'dr' ? p.amount : -p.amount) : s, 0);
    if (from && e.date < from) { openingCash += cashDelta; continue; }   // carried into the opening cash balance
    periodCash += cashDelta;
    if (!e.postings.some(p => cash.has(p.account))) continue;            // no cash moved → not a receipt/payment (accrual)
    for (const p of e.postings) {
      const a = book.accounts.get(p.account);
      if (!a) continue;
      if (a.type === 'income') { const v = p.dir === 'cr' ? p.amount : -p.amount; if (v) rec.set(p.account, (rec.get(p.account) || 0) + v); }
      else if (a.type === 'expense') { const v = p.dir === 'dr' ? p.amount : -p.amount; if (v) pay.set(p.account, (pay.get(p.account) || 0) + v); }
    }
  }
  const toRows = m => [...m].filter(([, v]) => v !== 0).map(([account, amount]) => ({ account, name: nameOf(account), amount })).sort((a, b) => b.amount - a.amount);
  const receipts = toRows(rec), payments = toRows(pay);
  const totalReceipts = receipts.reduce((s, r) => s + r.amount, 0);
  const totalPayments = payments.reduce((s, r) => s + r.amount, 0);
  return { receipts, payments, totalReceipts, totalPayments, net: totalReceipts - totalPayments, openingCash, closingCash: openingCash + periodCash };
}

// Giving by FUND (NOT by member — Phase 4a carries no PII). Income received in the period, grouped by the fund
// it was credited to. Σ amounts === incomeExpenditure(from,to).income (reconciles to the penny). Aggregate and
// name-free, so unlike a giving-by-member report it is safe to put in a shared statement.
export function givingByFund(book, { from = '', to = END } = {}) {
  const byFund = new Map();
  for (const e of book.journal) {
    if (e.date < (from || '') || e.date > to) continue;
    for (const p of e.postings) {
      const a = book.accounts.get(p.account);
      if (!a || a.type !== 'income') continue;
      const v = p.dir === 'cr' ? p.amount : -p.amount;            // income is credit-normal; a dr is a reversal
      const key = p.fund || 'general';
      byFund.set(key, (byFund.get(key) || 0) + v);
    }
  }
  return [...book.funds.values()].map(f => ({ fund: f.id, name: f.name, kind: f.kind, amount: byFund.get(f.id) || 0 }))
    .filter(r => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}
