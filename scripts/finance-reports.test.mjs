// Phase 4a aggregate reporting projections — reconcile to the journal to the penny.
//   Run: node --test scripts/finance-reports.test.mjs
//
// These are the ENGINE half (CLAUDE.md rule 1). The point-of-use half — that the Reports panel actually
// renders these presets and figures on the screen — is the-reports-panel-renders-its-presets.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, addFund, post, incomeExpenditure, fundBalances, check } from '../src/finance-ledger.mjs';
import { fundMovements, receiptsAndPayments, givingByFund } from '../src/finance-reports.mjs';

// A church with a general + a restricted building fund, two quarters of activity, and a fund transfer.
function book() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'hall', code: '4100', name: 'Hall hire', type: 'income' });
  addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  addAccount(b, { id: 'fund-transfer', code: '3900', name: 'Fund transfer', type: 'equity' });
  addFund(b, { id: 'building', name: 'Building fund', kind: 'restricted' });
  // 2026 Q1
  post(b, { date: '2026-02-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] });            // general income 250
  post(b, { date: '2026-02-12', memo: 'roof appeal', postings: [{ account: 'bank', dir: 'dr', amount: 60000 }, { account: 'giving', fund: 'building', dir: 'cr', amount: 60000 }] }); // building income 600
  post(b, { date: '2026-03-20', memo: 'electric', postings: [{ account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 }] });           // general expense 80
  // 2026 Q3
  post(b, { date: '2026-08-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', dir: 'cr', amount: 10000 }] });            // general income 100
  post(b, { date: '2026-08-10', memo: 'hall', postings: [{ account: 'bank', dir: 'dr', amount: 4000 }, { account: 'hall', dir: 'cr', amount: 4000 }] });                     // general income 40
  // Q3 transfer £150 general → building (reserved account, income/expenditure-neutral)
  post(b, { date: '2026-08-15', memo: 'top up building', postings: [{ account: 'fund-transfer', fund: 'general', dir: 'dr', amount: 15000 }, { account: 'fund-transfer', fund: 'building', dir: 'cr', amount: 15000 }] });
  assert.ok(check(b).ok, 'fixture book must be internally consistent: ' + check(b).errors.join('; '));
  return b;
}

const Q1 = { from: '2026-01-01', to: '2026-03-31' };
const Q3 = { from: '2026-07-01', to: '2026-09-30' };
const YEAR = { from: '2026-01-01', to: '2026-12-31' };

test('fundMovements: opening + in − out === closing, per fund, to the penny', () => {
  for (const r of fundMovements(book(), YEAR)) assert.equal(r.opening + r.in - r.out, r.closing, 'fund ' + r.fund + ' does not reconcile');
});

test('fundMovements all-time: opening is 0 and closing equals the ledger fundBalances()', () => {
  const b = book();
  const fm = fundMovements(b, {});                 // no `from` → all-time
  const bal = new Map(fundBalances(b).map(f => [f.fund, f.balance]));
  for (const r of fm) { assert.equal(r.opening, 0, 'all-time opening must be 0'); assert.equal(r.closing, bal.get(r.fund), 'closing must equal fundBalances for ' + r.fund); }
});

test('fundMovements Q3: opening carries Q1, in/out are period-only, transfer moves between funds', () => {
  const fm = fundMovements(book(), Q3);
  const gen = fm.find(f => f.fund === 'general'), bld = fm.find(f => f.fund === 'building');
  // General: opening = Q1 net (250 income − 80 expense = 170). Q3 in = 100 + 40 giving. Q3 out = 150 transfer out.
  assert.equal(gen.opening, 17000);
  assert.equal(gen.in, 14000);                     // 10000 + 4000
  assert.equal(gen.out, 15000);                    // transfer out
  assert.equal(gen.closing, 16000);                // 17000 + 14000 − 15000
  // Building: opening = Q1 600. Q3 in = 150 transfer in. out = 0.
  assert.equal(bld.opening, 60000);
  assert.equal(bld.in, 15000);
  assert.equal(bld.out, 0);
  assert.equal(bld.closing, 75000);
});

test('receiptsAndPayments (pure cash book): totals equal incomeExpenditure — the no-debtors/creditors assumption', () => {
  const b = book();
  for (const period of [Q1, Q3, YEAR]) {
    const rp = receiptsAndPayments(b, period);
    const ie = incomeExpenditure(b, period);
    assert.equal(rp.totalReceipts, ie.income, 'receipts must equal income when every entry has a cash leg (' + period.from + ')');
    assert.equal(rp.totalPayments, ie.expenditure, 'payments must equal expenditure in a pure cash book');
    // Net cash movement reconciles to the actual change in the cash balance.
    assert.equal(rp.net, rp.closingCash - rp.openingCash, 'net must equal the period cash movement');
  }
});

test('receiptsAndPayments is genuinely CASH-based: an accrual on a non-cash asset is NOT a receipt', () => {
  const b = book();
  addAccount(b, { id: 'debtors', code: '1100', name: 'Debtors', type: 'asset' });
  // Raise an invoice: income recognised, but NO cash moved (dr debtors / cr income). 2026-09-01 (in Q3).
  post(b, { date: '2026-09-01', memo: 'invoice raised', postings: [{ account: 'debtors', dir: 'dr', amount: 5000 }, { account: 'hall', dir: 'cr', amount: 5000 }] });
  const ie = incomeExpenditure(b, Q3);
  // cashAccounts excludes debtors → the accrual has no cash leg → it is NOT counted as a receipt.
  const rpCash = receiptsAndPayments(b, { ...Q3, cashAccounts: ['bank'] });
  assert.equal(rpCash.totalReceipts, ie.income - 5000, 'the accrued £50 must be excluded from cash receipts');
  assert.ok(rpCash.totalReceipts < ie.income, 'R&P must diverge from income once an accrual exists (proves it is cash-based)');
});

test('givingByFund: sums to period income, split by fund, name-free', () => {
  const b = book();
  for (const period of [Q1, Q3, YEAR]) {
    const gbf = givingByFund(b, period);
    const total = gbf.reduce((s, r) => s + r.amount, 0);
    assert.equal(total, incomeExpenditure(b, period).income, 'giving-by-fund must sum to total income (' + period.from + ')');
    for (const r of gbf) assert.ok(!('name' in r) || typeof r.name === 'string', 'rows carry a fund name, never a member name');
  }
  // Q1: general = 250 offering; building = 600 roof appeal. (The transfer is Q3 and is income-neutral.)
  const q1 = givingByFund(b, Q1);
  assert.equal(q1.find(r => r.fund === 'general').amount, 25000);
  assert.equal(q1.find(r => r.fund === 'building').amount, 60000);
  // A fund transfer is NOT giving — it must not appear as income in any fund.
  const q3 = givingByFund(b, Q3);
  assert.equal(q3.find(r => r.fund === 'general').amount, 14000);   // 100 + 40, transfer excluded
  assert.equal(q3.reduce((s, r) => s + r.amount, 0), incomeExpenditure(b, Q3).income);
});
