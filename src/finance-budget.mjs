// src/finance-budget.mjs — TrinityOne Finance: budgets (Phase 7).
//
// A budget is a pure READ OVERLAY. It NEVER posts to the journal: nothing here calls post()/reverse()/
// applyEntry(), nothing touches book.journal or book._seq, and check() sees no difference before or after it
// runs. A finance/budget:<id> doc maps to t:'budget', which rebuildBook ignores (it replays only
// settings/account/fund/journal), so a budget can never become a ledger entry even riding the same
// subscription. Every function here READS book.journal and returns numbers; none mutates the book.
//
// Money is integer minor units throughout — never floats. Period bounds are INJECTED local-day ISO strings
// (the caller's console local-today helper): this module NEVER calls Date, because a pure module computing
// `new Date().toISOString()` reintroduces the UTC off-by-one that
// finance-this-year-starts-on-the-local-day.test.mjs guards (CONTEXT, 2026-10-29).

import { incomeExpenditure } from './finance-ledger.mjs';

// The key separator for an (account, fund) cell. A NUL can never appear in an account/fund id, so it cannot
// collide with a real id.
const SEP = '\u0000';

// Per-(account, fund) signed income/expenditure total over [from, to]. NEITHER existing projection resolves
// this cell: incomeExpenditure().byAccount discards the posting's fund (it sums an account across ALL funds,
// finance-ledger.mjs L210), and fundBalances is per-fund only. A per-fund budget line therefore has no
// matching actual without this projection (AUDIT-PHASE-7 F1). The signing rule and the string-date period
// filter are IDENTICAL to incomeExpenditure — income: cr−dr, expense: dr−cr — so rolling these cells up by
// account equals incomeExpenditure().byAccount to the penny. Only income/expense accounts contribute (a
// budget is about income and expenditure, never asset/liability/equity movement).
//
// PURE: reads the journal, returns a Map; touches neither the journal, _seq, nor check().
export function incomeExpenditureByFund(book, { from = '', to = '￿' } = {}) {
  const by = new Map();   // `${account}${SEP}${fund}` -> signed minor units ('' fund === no fund tagged on the posting)
  for (const e of book.journal) {
    if (e.date < from || e.date > to) continue;
    for (const p of e.postings) {
      const a = book.accounts.get(p.account);
      if (!a || (a.type !== 'income' && a.type !== 'expense')) continue;
      const signed = a.type === 'income' ? (p.dir === 'cr' ? p.amount : -p.amount) : (p.dir === 'dr' ? p.amount : -p.amount);
      const key = p.account + SEP + (p.fund || '');
      by.set(key, (by.get(key) || 0) + signed);
    }
  }
  return by;
}

// Budget vs actual over [from, to]. `budget` is a finance/budget doc { year, lines:[{account, fund?, amount}] }.
// Returns ONE ROW PER BUDGET LINE: { account, fund, type, budget, actual, variance, overBy, over }.
//   · actual  — the period's signed total for the line. A line WITH a fund matches the (account,fund) cell
//               (incomeExpenditureByFund); a line with NO fund matches the account across all funds
//               (incomeExpenditure().byAccount). `actual` is a magnitude in the account's natural direction:
//               money spent for an expense account, money received for an income account — same convention as
//               incomeExpenditure, so a positive expense `actual` means money went out.
//   · variance = actual − budget.
//   · overBy / over — the OVER-BUDGET warning, EXPENSE-ONLY. Overspending (an expense line whose actual is
//               above its budget) is the alert a treasurer wants; falling short of an income target is a
//               shortfall, not an over-budget warning, so income lines never flag `over`. overBy =
//               max(0, actual−budget) on an expense line, else 0. `over` is true only when overBy STRICTLY
//               exceeds `threshold` (minor units, default 0) — a line exactly AT its budget does not flag; a
//               line one penny over does.
// EMPTY BUDGET (no/empty `lines`) → no rows → no `over` anywhere → NO false alert.
//
// PURE: a read overlay. It calls only incomeExpenditure / incomeExpenditureByFund (both pure); it never posts.
export function budgetVsActual(book, budget, { from = '', to = '￿', threshold = 0 } = {}) {
  const lines = (budget && Array.isArray(budget.lines)) ? budget.lines : [];
  const byFund = incomeExpenditureByFund(book, { from, to });
  const ie = incomeExpenditure(book, { from, to });
  const byAccount = new Map(ie.byAccount.map(r => [r.account, r.amount]));
  return lines.map(l => {
    const acct = book.accounts.get(l.account);
    const type = acct ? acct.type : '';
    const budgetAmt = Math.round(l.amount || 0);
    const fund = l.fund || null;
    const actual = fund ? (byFund.get(l.account + SEP + fund) || 0) : (byAccount.get(l.account) || 0);
    const variance = actual - budgetAmt;
    const overBy = type === 'expense' ? Math.max(0, variance) : 0;
    const over = overBy > threshold;
    return { account: l.account, fund, type, budget: budgetAmt, actual, variance, overBy, over };
  });
}
