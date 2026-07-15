// Period-bounded statement builder + text/HTML/period helpers.  Run: node --test scripts/finance-statement.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, addFund, post } from '../src/finance-ledger.mjs';
import { buildStatement, statementText, statementHtml, quarterRange, yearRange, rangeLabel, fmtMoney, STATEMENT_SECTIONS } from '../src/finance-statement.mjs';

function book() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'utilities', name: 'Utilities', type: 'expense' });
  addFund(b, { id: 'building', name: 'Building fund', kind: 'designated' });
  // Q1: £250 offering (general) + £600 to building fund; Q3: £100 offering + £80 utilities
  post(b, { date: '2026-02-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] });
  post(b, { date: '2026-02-12', memo: 'roof', postings: [{ account: 'bank', dir: 'dr', amount: 60000 }, { account: 'giving', fund: 'building', dir: 'cr', amount: 60000 }] });
  post(b, { date: '2026-08-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', dir: 'cr', amount: 10000 }] });
  post(b, { date: '2026-08-20', memo: 'electric', postings: [{ account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 }] });
  return b;
}

test('quarterRange / yearRange bounds', () => {
  assert.deepEqual(quarterRange(2026, 1), { from: '2026-01-01', to: '2026-03-31', label: 'Q1 2026' });
  assert.deepEqual(quarterRange(2026, 2), { from: '2026-04-01', to: '2026-06-30', label: 'Q2 2026' });
  assert.deepEqual(quarterRange(2026, 4), { from: '2026-10-01', to: '2026-12-31', label: 'Q4 2026' });
  assert.deepEqual(yearRange(2026), { from: '2026-01-01', to: '2026-12-31', label: '2026' });
  assert.equal(rangeLabel('2026-01-01', '2026-06-30'), '2026-01-01 to 2026-06-30');
});

test('period filtering — Q1 sees only Q1 activity', () => {
  const q1 = quarterRange(2026, 1);
  const m = buildStatement(book(), { ...q1, sections: ['summary'] });
  assert.equal(m.summary.income, 85000);        // 250 + 600
  assert.equal(m.summary.expenditure, 0);
  assert.equal(m.summary.surplus, 85000);
});

test('period filtering — full year sums everything', () => {
  const m = buildStatement(book(), { ...yearRange(2026), sections: ['summary'] });
  assert.equal(m.summary.income, 95000);        // 250 + 600 + 100
  assert.equal(m.summary.expenditure, 8000);
  assert.equal(m.summary.surplus, 87000);
});

test('closing fund balances respect the as-of date', () => {
  // Q1: building fund got £600 and nothing spent → closing £600 at Q1 end
  const q1 = buildStatement(book(), { ...quarterRange(2026, 1), sections: ['funds'] });
  const bq1 = q1.funds.find(f => f.fund === 'building');
  assert.equal(bq1.balance, 60000);
  assert.equal(bq1.kind, 'designated');
  // Same closing balance for the year (no further building movement)
  const yr = buildStatement(book(), { ...yearRange(2026), sections: ['funds'] });
  assert.equal(yr.funds.find(f => f.fund === 'building').balance, 60000);
});

test('income/spending split by account type, sorted desc', () => {
  const m = buildStatement(book(), { ...yearRange(2026), sections: ['income', 'spending'] });
  assert.deepEqual(m.income.map(r => r.name), ['Giving']);
  assert.equal(m.income[0].amount, 95000);       // Giving: 250 + 600 (building) + 100 = £950, totalled per account
  assert.deepEqual(m.spending.map(r => r.name), ['Utilities']);
  assert.equal(m.spending[0].amount, 8000);
});

test('only enabled sections are present', () => {
  const m = buildStatement(book(), { ...yearRange(2026), sections: ['summary'] });
  assert.ok(m.summary);
  assert.equal(m.income, undefined);
  assert.equal(m.funds, undefined);
  assert.equal(m.balance, undefined);
  // default sections (from STATEMENT_SECTIONS) when none passed
  const d = buildStatement(book(), { ...yearRange(2026) });
  const defOn = STATEMENT_SECTIONS.filter(s => s.on).map(s => s.key);
  assert.ok(defOn.includes('summary') && m.summary);
  assert.equal(!!d.balance, defOn.includes('balance'));   // balance off by default
});

test('note included only when ticked AND non-empty', () => {
  const on = buildStatement(book(), { ...yearRange(2026), sections: ['note'], note: 'Thank you' });
  assert.equal(on.note, 'Thank you');
  const blank = buildStatement(book(), { ...yearRange(2026), sections: ['note'], note: '   ' });
  assert.equal(blank.note, undefined);
  const notTicked = buildStatement(book(), { ...yearRange(2026), sections: ['summary'], note: 'hi' });
  assert.equal(notTicked.note, undefined);
});

test('balance sheet as-of period end balances', () => {
  const m = buildStatement(book(), { ...yearRange(2026), sections: ['balance'] });
  assert.equal(m.balance.assets, 87000);         // 250 + 600 + 100 − 80
  assert.equal(m.balance.liabilities, 0);
  assert.equal(m.balance.funds, 87000);
  assert.ok(m.balance.balanced);
});

test('fmtMoney formats by currency', () => {
  assert.equal(fmtMoney(123456, 'GBP', 2), '£1,234.56');
  assert.equal(fmtMoney(100000, 'USD', 2), '$1,000.00');
  assert.equal(fmtMoney(5000, 'sats', 0), '5,000 ⚡');
});

test('statementText carries the headline figures', () => {
  const m = buildStatement(book(), { ...yearRange(2026), title: 'Grace', periodLabel: '2026', sections: ['summary', 'funds'] });
  const t = statementText(m);
  assert.match(t, /Grace/);
  assert.match(t, /Total income:\s+£950\.00/);
  assert.match(t, /Building fund \(designated\) — £600\.00/);
});

test('statementHtml is self-contained and escapes user text', () => {
  const m = buildStatement(book(), { ...yearRange(2026), title: '<script>x</script>', sections: ['summary', 'note'], note: 'a & b <c>' });
  const h = statementHtml(m);
  assert.match(h, /^<!doctype html>/);
  assert.ok(!h.includes('<script>x</script>'));          // title escaped
  assert.match(h, /&lt;script&gt;/);
  assert.match(h, /a &amp; b &lt;c&gt;/);                 // note escaped
});
