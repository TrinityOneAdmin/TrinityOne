// A BUDGET IS A PURE READ OVERLAY — the Phase 7 engine. Run: node --test scripts/finance-budget.test.mjs
//
// The ENGINE half (CLAUDE.md rule 1). The point-of-use half — that the budget editor and the over-budget
// badge are actually on the screen — is finance-budget-ui.test.mjs. The relay-gating half (a non-finance
// member is refused a budget read AND write) is finance-budget-read-rule.test.mjs.
//
// What it proves:
//   · budgetVsActual math: budget/actual/variance per line, account-only AND per-(account,fund);
//   · the over-budget flag is expense-only, STRICTLY over `threshold` (at-threshold vs one-over);
//   · an empty budget raises NO false alert (no rows, no `over`);
//   · incomeExpenditureByFund rolls up by account to incomeExpenditure().byAccount to the penny;
//   · CRITICAL: a budget never touches the journal — check(book) is byte-identical before and after
//     budgetVsActual runs, and rebuildBook ignores a finance/budget: doc (it never becomes a journal entry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, addFund, post, incomeExpenditure, check } from '../src/finance-ledger.mjs';
import { budgetVsActual, incomeExpenditureByFund } from '../src/finance-budget.mjs';
import { rebuildBook } from '../src/finance-store.mjs';

// A church with giving (general + a restricted building fund) and two expense accounts.
function book() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  addAccount(b, { id: 'outreach', code: '5100', name: 'Outreach', type: 'expense' });
  addFund(b, { id: 'building', name: 'Building fund', kind: 'restricted' });
  // general giving £250, building-fund giving £600
  post(b, { date: '2026-02-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] });
  post(b, { date: '2026-02-12', memo: 'roof appeal', postings: [{ account: 'bank', dir: 'dr', amount: 60000 }, { account: 'giving', fund: 'building', dir: 'cr', amount: 60000 }] });
  // utilities £800 (general), outreach £120 general + £30 building
  post(b, { date: '2026-03-20', memo: 'electric', postings: [{ account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 }] });
  post(b, { date: '2026-03-21', memo: 'leaflets', postings: [{ account: 'outreach', dir: 'dr', amount: 12000 }, { account: 'bank', dir: 'cr', amount: 12000 }] });
  post(b, { date: '2026-03-22', memo: 'mission week', postings: [{ account: 'outreach', fund: 'building', dir: 'dr', amount: 3000 }, { account: 'bank', dir: 'cr', amount: 3000 }] });
  assert.ok(check(b).ok, 'fixture must be consistent: ' + check(b).errors.join('; '));
  return b;
}
const YEAR = { from: '2026-01-01', to: '2026-12-31' };

test('budgetVsActual: account-only line — budget, actual, variance', () => {
  const rows = budgetVsActual(book(), { lines: [{ account: 'utilities', amount: 10000 }] }, YEAR);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.budget, 10000);
  assert.equal(r.actual, 8000);              // utilities spend across all funds
  assert.equal(r.variance, -2000);           // £20 under budget
  assert.equal(r.over, false, 'under-budget expense must not flag over');
});

test('budgetVsActual: an OVER-budget expense line flags over and reports overBy', () => {
  const rows = budgetVsActual(book(), { lines: [{ account: 'outreach', amount: 10000 }] }, YEAR);
  const r = rows[0];
  assert.equal(r.actual, 15000, 'outreach spend is £120 general + £30 building = £150 across all funds');
  assert.equal(r.variance, 5000);
  assert.equal(r.over, true, 'spend £150 against a £100 budget must flag over');
  assert.equal(r.overBy, 5000, 'overBy must be the £50 overspend');
});

test('budgetVsActual: a PER-FUND line matches that fund only, not the account across all funds', () => {
  // Outreach within the BUILDING fund is £30; account-wide it is £150. A per-fund budget line must compare
  // against £30, not £150 (AUDIT-PHASE-7 F1 — the wrong number would still render without this).
  const rows = budgetVsActual(book(), { lines: [{ account: 'outreach', fund: 'building', amount: 5000 }] }, YEAR);
  const r = rows[0];
  assert.equal(r.fund, 'building');
  assert.equal(r.actual, 3000, 'per-fund actual must be the building-fund outreach only (£30)');
  assert.equal(r.over, false, '£30 spend against a £50 per-fund budget is under budget');
});

test('budgetVsActual: income lines never flag over (a shortfall is not an over-budget alert)', () => {
  // Giving target £1000, actual £850 — a shortfall, but NOT an over-budget warning.
  const rows = budgetVsActual(book(), { lines: [{ account: 'giving', amount: 100000 }] }, YEAR);
  const r = rows[0];
  assert.equal(r.actual, 85000, 'giving across all funds is £250 + £600 = £850');
  assert.equal(r.over, false, 'an income shortfall must never flag over-budget');
  assert.equal(r.overBy, 0);
});

test('budgetVsActual: the over flag is STRICTLY over threshold — at threshold does not flag, one over does', () => {
  const b = book();                           // outreach actual = £150 (15000)
  const at = budgetVsActual(b, { lines: [{ account: 'outreach', amount: 10000 }] }, { ...YEAR, threshold: 5000 })[0];
  assert.equal(at.overBy, 5000);
  assert.equal(at.over, false, 'overBy exactly equal to threshold must NOT flag');
  const over = budgetVsActual(b, { lines: [{ account: 'outreach', amount: 10000 }] }, { ...YEAR, threshold: 4999 })[0];
  assert.equal(over.over, true, 'overBy one minor unit above threshold must flag');
});

test('budgetVsActual: an EMPTY budget raises no false alert', () => {
  assert.deepEqual(budgetVsActual(book(), { lines: [] }, YEAR), [], 'empty lines → no rows');
  assert.deepEqual(budgetVsActual(book(), null, YEAR), [], 'no budget → no rows');
  assert.deepEqual(budgetVsActual(book(), {}, YEAR), [], 'budget with no lines → no rows');
});

test('budgetVsActual: the period bound filters the actual (injected local-day string, no Date call)', () => {
  // A budget line for utilities, but the window ends BEFORE the only utilities entry (2026-03-20).
  const rows = budgetVsActual(book(), { lines: [{ account: 'utilities', amount: 10000 }] }, { from: '2026-01-01', to: '2026-03-19' });
  assert.equal(rows[0].actual, 0, 'an entry on 2026-03-20 must be outside a window that ends 2026-03-19');
});

test('incomeExpenditureByFund rolls up by account to incomeExpenditure().byAccount, to the penny', () => {
  const b = book();
  const byFund = incomeExpenditureByFund(b, YEAR);
  const rolled = new Map();
  for (const [key, amt] of byFund) { const acct = key.split('\u0000')[0]; rolled.set(acct, (rolled.get(acct) || 0) + amt); }
  for (const r of incomeExpenditure(b, YEAR).byAccount) assert.equal(rolled.get(r.account), r.amount, 'account ' + r.account + ' must roll up to byAccount');
});

test('CRITICAL: a budget never touches the journal — check() is identical before and after budgetVsActual', () => {
  const b = book();
  const before = JSON.stringify(check(b));
  const seqBefore = b._seq, lenBefore = b.journal.length;
  budgetVsActual(b, { lines: [{ account: 'outreach', amount: 1 }, { account: 'giving', fund: 'building', amount: 999 }] }, YEAR);
  incomeExpenditureByFund(b, YEAR);
  assert.equal(JSON.stringify(check(b)), before, 'check(book) must be byte-identical — a budget is a pure read overlay');
  assert.equal(b._seq, seqBefore, '_seq must not move');
  assert.equal(b.journal.length, lenBefore, 'no journal entry may be appended');
});

test('CRITICAL: rebuildBook ignores a finance/budget: doc — it never becomes a journal entry', () => {
  // The subscribe stream carries finance/budget docs as t:'budget'. rebuildBook replays only
  // settings/account/fund/journal, so a budget doc fed in among them must not change the rebuilt book.
  const base = [
    { t: 'settings', baseCurrency: 'GBP', decimals: 2, fiscalYearStart: '01-01' },
    { t: 'account', id: 'bank', code: '1000', name: 'Bank', type: 'asset' },
    { t: 'account', id: 'giving', code: '4000', name: 'Giving', type: 'income' },
    { t: 'journal', seq: 1, date: '2026-02-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] },
  ];
  const withBudget = [...base, { t: 'budget', id: 'b1', year: '2026', lines: [{ account: 'giving', fund: '', amount: 500000 }] }];
  const a = rebuildBook(base), c = rebuildBook(withBudget);
  assert.ok(a.book && c.book, 'both rebuilds must succeed');
  assert.equal(c.book.journal.length, a.book.journal.length, 'the budget doc must not add a journal entry');
  assert.equal(c.book._seq, a.book._seq, 'the budget doc must not move _seq');
});
