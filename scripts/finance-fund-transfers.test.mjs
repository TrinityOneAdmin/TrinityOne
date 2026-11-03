// FUND TRANSFERS, AND THE COMPATIBILITY THEY MUST NOT BREAK.
//   Run: node --test scripts/finance-fund-transfers.test.mjs
//
// A fund transfer moves £X from fund A to fund B as ONE balanced journal entry on the reserved account
// `fund-transfer` — {fund:A,dir:'dr'} + {fund:B,dir:'cr'}, equal amounts. It must:
//   (i)   move both fund balances by ±X,
//   (ii)  leave income / expenditure / surplus untouched (a transfer is neither income nor spending),
//   (iii) keep check() green — the four whole-book invariants still hold.
// And the fund-projection extension must key on the reserved ID, never on type==='equity' (AUDIT-PHASE-1 F2):
// a REAL equity account carrying a fund must NOT be mistaken for a transfer, or check() invariant 3 breaks.
// Finally (AUDIT-PHASE-1 F1): a book that contains a transfer must still REBUILD on any console that has the
// reserved account doc — that doc, not a createBook auto-add, is what makes an older console load the book.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, addFund, post, fundBalances, incomeExpenditure, check, FUND_TRANSFER_ACCT } from '../src/finance-ledger.mjs';
import { bookToDocs, rebuildBook } from '../src/finance-store.mjs';
import { buildStatement } from '../src/finance-statement.mjs';

const bal = (book) => Object.fromEntries(fundBalances(book).map(f => [f.fund, f.balance]));

// A seeded book: £100 into the general fund, £40 into a restricted building fund.
function seeded() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  addFund(b, { id: 'building', name: 'Building', kind: 'restricted' });
  post(b, { date: '2026-01-01', memo: 'gift', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 10000 }] });
  post(b, { date: '2026-01-02', memo: 'gift to building', postings: [{ account: 'bank', dir: 'dr', amount: 4000 }, { account: 'giving', fund: 'building', dir: 'cr', amount: 4000 }] });
  return b;
}
const addTransferAcct = (b) => addAccount(b, { id: FUND_TRANSFER_ACCT, code: '3900', name: 'Fund transfer', type: 'equity' });
const transfer = (b, from, to, amount, date) => post(b, { date, memo: 'move', postings: [
  { account: FUND_TRANSFER_ACCT, fund: from, dir: 'dr', amount },
  { account: FUND_TRANSFER_ACCT, fund: to, dir: 'cr', amount },
] });

test('(i)(ii)(iii) a transfer moves both funds, leaves income/expenditure/surplus unchanged, keeps check() ok', () => {
  const b = seeded();
  addTransferAcct(b);
  const ie0 = incomeExpenditure(b);
  const fb0 = bal(b);
  assert.equal(fb0.general, 10000);
  assert.equal(fb0.building, 4000);

  transfer(b, 'general', 'building', 3000, '2026-01-03');

  const fb1 = bal(b);
  assert.equal(fb1.general, 7000, '(i) the source fund did not fall by the transfer amount');
  assert.equal(fb1.building, 7000, '(i) the destination fund did not rise by the transfer amount');

  const ie1 = incomeExpenditure(b);
  assert.equal(ie1.income, ie0.income, '(ii) a transfer changed income');
  assert.equal(ie1.expenditure, ie0.expenditure, '(ii) a transfer changed expenditure');
  assert.equal(ie1.surplus, ie0.surplus, '(ii) a transfer changed the surplus');

  const c = check(b);
  assert.ok(c.ok, '(iii) check() went red after a transfer: ' + c.errors.join('; '));
});

test('F2: a REAL equity account carrying a fund is NOT treated as a transfer (keyed on id, not type)', () => {
  const b = seeded();
  addAccount(b, { id: 'opening', code: '3000', name: 'Opening balances', type: 'equity' });
  // An equity posting that carries a fund. If fundBalances keyed on type==='equity' it would move the general
  // fund and break invariant 3. It must be ignored (the general balance stays exactly as the giving set it).
  post(b, { date: '2026-01-03', memo: 'opening', postings: [{ account: 'bank', dir: 'dr', amount: 2000 }, { account: 'opening', fund: 'general', dir: 'cr', amount: 2000 }] });
  assert.equal(bal(b).general, 10000, 'an equity+fund posting moved a fund — the extension wrongly generalised to equity');
  const c = check(b);
  assert.ok(c.ok, 'invariant 3 (fundSum===surplus) broke on a real equity+fund account: ' + c.errors.join('; '));
  // B4: the SEPARATE closingFunds copy (via buildStatement) must not generalise to equity either.
  const model = buildStatement(b, { from: '', to: '￿', sections: ['funds'], periodLabel: 'all' });
  const byId = Object.fromEntries(model.funds.map(f => [f.fund, f.balance]));
  assert.equal(byId.general, 10000, 'the statement copy (closingFunds) mistook a real equity+fund posting for a transfer');
});

test('F1: a book containing a transfer rebuilds cleanly WHEN the reserved account doc is present', () => {
  const b = seeded();
  addTransferAcct(b);
  transfer(b, 'general', 'building', 2500, '2026-01-03');
  const docs = bookToDocs(b);
  assert.ok(docs.some(d => d.t === 'account' && d.id === FUND_TRANSFER_ACCT), 'bookToDocs did not emit the reserved account doc');
  const r = rebuildBook(docs);
  assert.ok(r.ok, 'a book with a transfer failed to rebuild: ' + r.errors.join('; '));
  assert.equal(bal(r.book).building, 6500, 'the rebuilt book lost the transfer');
});

test('F1: WITHOUT the reserved account doc the transfer entry cannot rebuild — so publish-if-absent is load-bearing', () => {
  const b = seeded();
  addTransferAcct(b);
  transfer(b, 'general', 'building', 2500, '2026-01-03');
  const docs = bookToDocs(b).filter(d => !(d.t === 'account' && d.id === FUND_TRANSFER_ACCT));
  const r = rebuildBook(docs);
  assert.equal(r.ok, false, 'a transfer rebuilt with no reserved account doc — the compat hazard F1 describes is not reproduced');
  assert.ok(r.errors.some(e => /unknown account/.test(e)), 'expected an "unknown account" error, got: ' + r.errors.join('; '));
});

test('F1 compat: an OLD console (fund sum from income/expense only) still reconciles to surplus over a transfer', () => {
  // The old fundBalances had no fund-transfer branch. A net-zero transfer contributes 0 to the trial balance
  // and leaves surplus unchanged, so even an old console's invariant-3 check (fundSum===surplus, counting ONLY
  // income/expense) still holds — which is why the book LOADS there rather than freezing.
  const b = seeded();
  addTransferAcct(b);
  transfer(b, 'general', 'building', 3000, '2026-01-03');
  const oldFundSum = (() => { let s = 0; for (const e of b.journal) for (const p of e.postings) {
    if (!p.fund) continue; const a = b.accounts.get(p.account);
    if (a.type === 'income') s += (p.dir === 'cr' ? p.amount : -p.amount);
    else if (a.type === 'expense') s += (p.dir === 'dr' ? -p.amount : p.amount);
  } return s; })();
  assert.equal(oldFundSum, incomeExpenditure(b).surplus, 'an old console would see fundSum≠surplus and reject the book');
});

test('the statement copy (closingFunds, via buildStatement) recognises the transfer too', () => {
  const b = seeded();
  addTransferAcct(b);
  transfer(b, 'general', 'building', 3000, '2026-01-03');
  const model = buildStatement(b, { from: '', to: '￿', sections: ['funds'], periodLabel: 'all' });
  const byId = Object.fromEntries(model.funds.map(f => [f.fund, f.balance]));
  assert.equal(byId.general, 7000, 'the statement did not apply the transfer to the source fund');
  assert.equal(byId.building, 7000, 'the statement did not apply the transfer to the destination fund');
});
