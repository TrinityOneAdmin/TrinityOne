// Invariant + behaviour tests for the double-entry ledger core.  Run: node --test scripts/finance-ledger.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBook, addAccount, addFund, post, reverse,
  trialBalance, fundBalances, incomeExpenditure, balanceSheet, check,
} from '../src/finance-ledger.mjs';

// a small standard church chart of accounts
function churchBook() {
  const b = createBook({ baseCurrency: 'USD', decimals: 2 });
  addAccount(b, { id: 'bank', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'hall', name: 'Hall hire', type: 'income' });
  addAccount(b, { id: 'utilities', name: 'Utilities', type: 'expense' });
  addAccount(b, { id: 'outreach', name: 'Outreach', type: 'expense' });
  addAccount(b, { id: 'loan', name: 'Building loan', type: 'liability' });
  addFund(b, { id: 'building', name: 'Building fund', kind: 'restricted' });
  return b;
}

test('a new book has the general fund and no accounts', () => {
  const b = createBook();
  assert.ok(b.funds.has('general'));
  assert.equal(b.accounts.size, 0);
});

test('bad account type / fund kind / duplicates are rejected', () => {
  const b = createBook();
  assert.throws(() => addAccount(b, { id: 'x', type: 'nonsense' }));
  assert.throws(() => addFund(b, { id: 'f', kind: 'nonsense' }));
  addAccount(b, { id: 'bank', type: 'asset' });
  assert.throws(() => addAccount(b, { id: 'bank', type: 'asset' }));   // duplicate
});

test('a balanced entry posts and gets a contiguous sequence number', () => {
  const b = churchBook();
  const e1 = post(b, { date: '2026-01-05', memo: 'Sunday offering', postings: [
    { account: 'bank', dir: 'dr', amount: 25000 },
    { account: 'giving', dir: 'cr', amount: 25000 },
  ] });
  assert.equal(e1.seq, 1);
  const e2 = post(b, { date: '2026-01-06', postings: [
    { account: 'utilities', dir: 'dr', amount: 8000 },
    { account: 'bank', dir: 'cr', amount: 8000 },
  ] });
  assert.equal(e2.seq, 2);
});

test('unbalanced / bad postings are rejected', () => {
  const b = churchBook();
  assert.throws(() => post(b, { postings: [   // 100 ≠ 90
    { account: 'bank', dir: 'dr', amount: 100 }, { account: 'giving', dir: 'cr', amount: 90 } ] }), /balance/);
  assert.throws(() => post(b, { postings: [   // unknown account
    { account: 'nope', dir: 'dr', amount: 100 }, { account: 'giving', dir: 'cr', amount: 100 } ] }), /unknown account/);
  assert.throws(() => post(b, { postings: [   // float amount
    { account: 'bank', dir: 'dr', amount: 100.5 }, { account: 'giving', dir: 'cr', amount: 100.5 } ] }), /integer/);
  assert.throws(() => post(b, { postings: [   // negative
    { account: 'bank', dir: 'dr', amount: -5 }, { account: 'giving', dir: 'cr', amount: -5 } ] }), /positive/);
  assert.throws(() => post(b, { postings: [ { account: 'bank', dir: 'dr', amount: 5 } ] }), /two postings/);
});

test('income/expense postings default to the general fund; explicit funds are honoured', () => {
  const b = churchBook();
  const e = post(b, { postings: [ { account: 'bank', dir: 'dr', amount: 100 }, { account: 'giving', dir: 'cr', amount: 100 } ] });
  assert.equal(e.postings.find(p => p.account === 'giving').fund, 'general');   // defaulted
  assert.equal(e.postings.find(p => p.account === 'bank').fund, null);          // cash side, no fund
  const r = post(b, { postings: [ { account: 'bank', dir: 'dr', amount: 500 }, { account: 'giving', fund: 'building', dir: 'cr', amount: 500 } ] });
  assert.equal(r.postings.find(p => p.account === 'giving').fund, 'building');
});

test('trial balance always balances; fund balances reconcile to surplus', () => {
  const b = churchBook();
  post(b, { postings: [ { account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 } ] });
  post(b, { postings: [ { account: 'bank', dir: 'dr', amount: 60000 }, { account: 'giving', fund: 'building', dir: 'cr', amount: 60000 } ] });
  post(b, { postings: [ { account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 } ] });
  post(b, { postings: [ { account: 'outreach', fund: 'building', dir: 'dr', amount: 15000 }, { account: 'bank', dir: 'cr', amount: 15000 } ] });

  const tb = trialBalance(b);
  assert.ok(tb.balanced, 'trial balance must balance');

  const ie = incomeExpenditure(b);
  assert.equal(ie.income, 85000);
  assert.equal(ie.expenditure, 23000);
  assert.equal(ie.surplus, 62000);

  const funds = fundBalances(b);
  const general = funds.find(f => f.fund === 'general').balance;
  const building = funds.find(f => f.fund === 'building').balance;
  assert.equal(general, 25000 - 8000);     // giving 25000 − utilities 8000
  assert.equal(building, 60000 - 15000);   // giving 60000 − outreach 15000
  assert.equal(general + building, ie.surplus);   // reconcile

  const bs = balanceSheet(b);
  assert.ok(bs.balanced);
  assert.equal(bs.assets, 25000 + 60000 - 8000 - 15000);   // bank
  assert.equal(bs.funds, ie.surplus);

  assert.deepEqual(check(b), { ok: true, errors: [] });
});

test('reversing an entry nets it to zero; you cannot reverse twice or reverse a reversal', () => {
  const b = churchBook();
  const e = post(b, { date: '2026-02-01', memo: 'mistaken entry', postings: [
    { account: 'bank', dir: 'dr', amount: 5000 }, { account: 'giving', dir: 'cr', amount: 5000 } ] });
  const rev = reverse(b, e.seq, { date: '2026-02-02' });
  assert.equal(rev.reverses, e.seq);
  assert.equal(incomeExpenditure(b).income, 0);      // netted to zero
  assert.ok(trialBalance(b).balanced);
  assert.throws(() => reverse(b, e.seq), /already reversed/);
  assert.throws(() => reverse(b, rev.seq), /cannot reverse a reversal/);
  assert.ok(check(b).ok);
});

test('check() catches a corrupted journal', () => {
  const b = churchBook();
  post(b, { postings: [ { account: 'bank', dir: 'dr', amount: 100 }, { account: 'giving', dir: 'cr', amount: 100 } ] });
  b.journal[0].postings[1].amount = 90;   // tamper: unbalance it
  const r = check(b);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /unbalanced/.test(e)));
});

test('property: 2000 random balanced entries keep every invariant', () => {
  const b = churchBook();
  const accts = [...b.accounts.keys()];
  const funds = [...b.funds.keys()];
  const rnd = n => Math.floor(Math.random() * n);
  for (let i = 0; i < 2000; i++) {
    let a1 = accts[rnd(accts.length)], a2 = accts[rnd(accts.length)];
    while (a2 === a1) a2 = accts[rnd(accts.length)];
    const amount = 1 + rnd(1_000_000);
    post(b, { date: '2026-0' + (1 + rnd(9)) + '-15', postings: [
      { account: a1, fund: funds[rnd(funds.length)], dir: 'dr', amount },
      { account: a2, fund: funds[rnd(funds.length)], dir: 'cr', amount },
    ] });
    if (i % 200 === 0) assert.ok(trialBalance(b).balanced);
  }
  const r = check(b);
  assert.deepEqual(r, { ok: true, errors: [] }, r.errors.join('; '));
});
