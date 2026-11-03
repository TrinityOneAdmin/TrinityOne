// Insights-chart projections (UX-F) — reconcile to the journal to the penny, and never mutate the book.
//   Run: node --test scripts/finance-charts.test.mjs
//
// This is the ENGINE half (CLAUDE.md rule 1). The point-of-use half — that the Insights tab actually renders
// these as <svg> charts on the screen — is finance-insights-ui.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBook, addAccount, addFund, post, incomeExpenditure, fundBalances, check } from '../src/finance-ledger.mjs';
import { fiscalYearRange, yearEndProjection, monthlyTotals, monthlyFundBalances } from '../src/finance-charts.mjs';

// A church with a general + a restricted building fund, activity in several months of 2026, and a transfer.
function book() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'hall', code: '4100', name: 'Hall hire', type: 'income' });
  addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  addAccount(b, { id: 'fund-transfer', code: '3900', name: 'Fund transfer', type: 'equity' });
  addFund(b, { id: 'building', name: 'Building fund', kind: 'restricted' });
  post(b, { date: '2026-01-15', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 20000 }, { account: 'giving', dir: 'cr', amount: 20000 }] });      // Jan income 200
  post(b, { date: '2026-02-12', memo: 'roof appeal', postings: [{ account: 'bank', dir: 'dr', amount: 60000 }, { account: 'giving', fund: 'building', dir: 'cr', amount: 60000 }] }); // Feb building income 600
  post(b, { date: '2026-03-20', memo: 'electric', postings: [{ account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 }] });     // Mar expense 80
  post(b, { date: '2026-06-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', dir: 'cr', amount: 10000 }] });      // Jun income 100
  post(b, { date: '2026-06-10', memo: 'hall', postings: [{ account: 'bank', dir: 'dr', amount: 4000 }, { account: 'hall', dir: 'cr', amount: 4000 }] });              // Jun income 40
  post(b, { date: '2026-08-15', memo: 'top up building', postings: [{ account: 'fund-transfer', fund: 'general', dir: 'dr', amount: 15000 }, { account: 'fund-transfer', fund: 'building', dir: 'cr', amount: 15000 }] }); // transfer £150 gen→bld
  assert.ok(check(b).ok, 'fixture must be consistent: ' + check(b).errors.join('; '));
  return b;
}

const YEAR = { from: '2026-01-01', to: '2026-12-31' };

// ── fiscalYearRange: pure, and equivalent to the shipped fyStart statement ──
test('fiscalYearRange: a calendar (01-01) year', () => {
  assert.deepEqual(fiscalYearRange('2026-07-15', '01-01'), { from: '2026-01-01', to: '2026-12-31', label: '2026' });
});
test('fiscalYearRange: a 06-04 (UK-style) year spans the calendar boundary and labels across it', () => {
  // On 2027-07-15 the 06-04 year that contains it started 2027-06-04 and ends 2028-06-03.
  assert.deepEqual(fiscalYearRange('2027-07-15', '06-04'), { from: '2027-06-04', to: '2028-06-03', label: '2027/2028' });
  // Just BEFORE the start, we are still in the prior year.
  assert.deepEqual(fiscalYearRange('2027-06-03', '06-04'), { from: '2026-06-04', to: '2027-06-03', label: '2026/2027' });
});
test('fiscalYearRange.from matches the shipped fyStart statement for the same clock', () => {
  // Pull the shipped fyStart out of app/stew-finance.jsx and run it with a fixed clock, as the local-day test does.
  const FIN = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');
  const anchor = 'const fyStart = (() =>';
  const at = FIN.indexOf(anchor);
  assert.notEqual(at, -1, 're-anchor: fyStart is gone from app/stew-finance.jsx');
  // The single statement, terminated at its `})();`.
  const end = FIN.indexOf('})();', at) + '})();'.length;
  const FY = FIN.slice(at, end);
  const shippedFyStart = (fiscalYearStart, today) =>
    new Function('book', 'Date', 'todayISO', `${FY}\nreturn fyStart;`)(
      { fiscalYearStart }, class { getFullYear() { return Number(today.slice(0, 4)); } }, () => today);
  for (const [fy, today] of [['01-01', '2026-07-15'], ['06-04', '2027-07-15'], ['06-04', '2027-06-03'], ['09-01', '2026-01-10']]) {
    assert.equal(fiscalYearRange(today, fy).from, shippedFyStart(fy, today), 'mismatch for ' + fy + ' @ ' + today);
  }
});

// ── monthlyTotals: dense, ordered, reconciles to incomeExpenditure ──
test('monthlyTotals: Σ buckets === incomeExpenditure for income, expenditure and surplus', () => {
  const b = book();
  const ie = incomeExpenditure(b, YEAR);
  const m = monthlyTotals(b, YEAR);
  assert.equal(m.reduce((s, r) => s + r.income, 0), ie.income);
  assert.equal(m.reduce((s, r) => s + r.expenditure, 0), ie.expenditure);
  assert.equal(m.reduce((s, r) => s + r.surplus, 0), ie.surplus);
});
test('monthlyTotals: dense + ordered (12 months Jan..Dec) with empty months zeroed', () => {
  const m = monthlyTotals(book(), YEAR);
  assert.equal(m.length, 12);
  assert.equal(m[0].month, '2026-01');
  assert.equal(m[11].month, '2026-12');
  for (let i = 1; i < m.length; i++) assert.ok(m[i].month > m[i - 1].month, 'months must be ascending & unique');
  const apr = m.find(r => r.month === '2026-04');   // no activity in April
  assert.deepEqual([apr.income, apr.expenditure, apr.surplus], [0, 0, 0]);
});
test('monthlyTotals: a posting lands only in its own month', () => {
  const m = monthlyTotals(book(), YEAR);
  assert.equal(m.find(r => r.month === '2026-01').income, 20000);
  assert.equal(m.find(r => r.month === '2026-02').income, 60000);
  assert.equal(m.find(r => r.month === '2026-03').expenditure, 8000);
  assert.equal(m.find(r => r.month === '2026-06').income, 14000);   // 10000 + 4000
});

// ── yearEndProjection: run-rate math, reconcile and guards ──
test('yearEndProjection: ytd === incomeExpenditure over [from, today]', () => {
  const b = book();
  const p = yearEndProjection(b, { today: '2026-06-30', fiscalYearStart: '01-01' });
  const ie = incomeExpenditure(b, { from: '2026-01-01', to: '2026-06-30' });
  assert.deepEqual(p.ytd, { income: ie.income, expenditure: ie.expenditure, surplus: ie.surplus });
});
test('yearEndProjection: surplus is the two projected legs, and projected = round(ytd / fraction)', () => {
  const p = yearEndProjection(book(), { today: '2026-06-30', fiscalYearStart: '01-01' });
  assert.equal(p.projected.surplus, p.projected.income - p.projected.expenditure);
  assert.equal(p.projected.income, Math.round(p.ytd.income / p.fraction));
  assert.equal(p.projected.expenditure, Math.round(p.ytd.expenditure / p.fraction));
});
test('yearEndProjection: at the year end (fraction 1) the projection equals YTD to the penny', () => {
  const b = book();
  const p = yearEndProjection(b, { today: '2026-12-31', fiscalYearStart: '01-01' });
  assert.equal(p.fraction, 1);
  assert.deepEqual(p.projected, p.ytd);
});
test('yearEndProjection: < ~1 month elapsed flags lowConfidence', () => {
  assert.equal(yearEndProjection(book(), { today: '2026-01-10', fiscalYearStart: '01-01' }).lowConfidence, true);
  assert.equal(yearEndProjection(book(), { today: '2026-06-30', fiscalYearStart: '01-01' }).lowConfidence, false);
});
test('yearEndProjection: empty book → zeros, no NaN/Infinity', () => {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  const p = yearEndProjection(b, { today: '2026-06-30', fiscalYearStart: '01-01' });
  for (const v of [p.projected.income, p.projected.expenditure, p.projected.surplus]) { assert.ok(Number.isFinite(v)); assert.equal(v, 0); }
});

// ── monthlyFundBalances: last column reconciles, all-time === fundBalances ──
test('monthlyFundBalances: months align with monthlyTotals', () => {
  const b = book();
  assert.deepEqual(monthlyFundBalances(b, YEAR).months, monthlyTotals(b, YEAR).map(r => r.month));
});
test('monthlyFundBalances: the last month-end column === fundBalances() when the window ends all-time', () => {
  const b = book();
  const series = monthlyFundBalances(b, YEAR);   // the fixture has no activity after 2026, so 2026-12 is all-time closing
  const bal = new Map(fundBalances(b).map(f => [f.fund, f.balance]));
  for (const f of series.funds) assert.equal(f.balances[f.balances.length - 1], bal.get(f.fund), 'last column must equal fundBalances for ' + f.fund);
});
test('monthlyFundBalances: the balance is cumulative and the transfer moves two funds net-zero', () => {
  const b = book();
  const s = monthlyFundBalances(b, YEAR);
  const gen = s.funds.find(f => f.fund === 'general'), bld = s.funds.find(f => f.fund === 'building');
  const iAug = s.months.indexOf('2026-08'), iJul = s.months.indexOf('2026-07');
  // General after the Aug transfer out = (200 Jan − 80 Mar + 140 Jun) − 150 = 110.00 → 11000
  assert.equal(gen.balances[iAug], 11000);
  // Building after the Aug transfer in = 600 Feb + 150 = 750.00 → 75000
  assert.equal(bld.balances[iAug], 75000);
  // The transfer is net-zero across the two funds month-on-month.
  assert.equal((gen.balances[iAug] + bld.balances[iAug]) - (gen.balances[iJul] + bld.balances[iJul]), 0);
});

// ── non-mutation: a projection is a pure read overlay ──
test('the helpers never mutate the book (check() identical before/after)', () => {
  const b = book();
  const before = JSON.stringify(check(b));
  fiscalYearRange('2026-06-30', '01-01');
  yearEndProjection(b, { today: '2026-06-30', fiscalYearStart: '01-01' });
  monthlyTotals(b, YEAR);
  monthlyFundBalances(b, YEAR);
  assert.equal(JSON.stringify(check(b)), before, 'a chart projection changed what check() returns');
  assert.equal(b.journal.length, 6, 'the journal length changed');
});
