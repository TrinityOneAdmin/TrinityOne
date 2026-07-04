// Persistence round-trip + fork/gap detection.  Run: node --test scripts/finance-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, addFund, post, trialBalance, fundBalances, incomeExpenditure, importedKeys } from '../src/finance-ledger.mjs';
import { bookToDocs, rebuildBook } from '../src/finance-store.mjs';

function sampleBook() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'utilities', name: 'Utilities', type: 'expense' });
  addFund(b, { id: 'building', name: 'Building fund', kind: 'restricted' });
  post(b, { date: '2026-01-05', memo: 'offering', postings: [ { account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 } ] });
  post(b, { date: '2026-01-12', memo: 'roof appeal', postings: [ { account: 'bank', dir: 'dr', amount: 60000 }, { account: 'giving', fund: 'building', dir: 'cr', amount: 60000 } ] });
  post(b, { date: '2026-01-20', memo: 'electric', postings: [ { account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 } ] });
  return b;
}

test('bookToDocs → rebuildBook round-trips exactly', () => {
  const b = sampleBook();
  const { book: r, ok, errors } = rebuildBook(bookToDocs(b));
  assert.ok(ok, errors.join('; '));
  assert.equal(r.baseCurrency, 'GBP');
  assert.equal(r.accounts.size, b.accounts.size);
  assert.equal(r.funds.size, b.funds.size);
  assert.equal(r.journal.length, b.journal.length);
  assert.deepEqual(trialBalance(r), trialBalance(b));
  assert.deepEqual(fundBalances(r), fundBalances(b));
  assert.deepEqual(incomeExpenditure(r), incomeExpenditure(b));
});

test('rebuild works with docs in a shuffled/reversed order (events arrive out of order)', () => {
  const b = sampleBook();
  const docs = bookToDocs(b).reverse();                 // worst case: journal before accounts/settings
  const { book: r, ok, errors } = rebuildBook(docs);
  assert.ok(ok, errors.join('; '));
  assert.deepEqual(trialBalance(r), trialBalance(b));
});

test('a GAP in the journal is detected, not silently accepted', () => {
  const b = sampleBook();
  const docs = bookToDocs(b).filter(d => !(d.t === 'journal' && d.seq === 2));   // drop entry #2
  const { ok, errors } = rebuildBook(docs);
  assert.equal(ok, false);
  assert.ok(errors.some(e => /gap\/fork|expected 2/.test(e)), errors.join('; '));
});

test('a FORK (two entries sharing a seq) is detected', () => {
  const b = sampleBook();
  const docs = bookToDocs(b);
  const forged = { t: 'journal', seq: 2, date: '2026-01-99', memo: 'forged', by: 'attacker',
    postings: [ { account: 'bank', dir: 'dr', amount: 999 }, { account: 'giving', dir: 'cr', amount: 999 } ], reverses: null };
  const { ok, errors } = rebuildBook([...docs, forged]);
  assert.equal(ok, false);
  assert.ok(errors.some(e => /gap\/fork/.test(e)), errors.join('; '));
});

test('importKey round-trips through docs and importedKeys() reflects the journal', () => {
  const b = sampleBook();
  post(b, { date: '2026-02-01', memo: 'imported offering', importKey: '2026-02-01|30000|imported offering',
    postings: [ { account: 'bank', dir: 'dr', amount: 30000 }, { account: 'giving', dir: 'cr', amount: 30000 } ] });
  // the three sampleBook() entries carry no importKey (default null); the 4th does.
  const keys = importedKeys(b);
  assert.equal(keys.size, 1);
  assert.ok(keys.has('2026-02-01|30000|imported offering'));
  // survives the docs round-trip (persist → rebuild), so a re-import can dedup against a rebuilt book.
  const { book: r, ok, errors } = rebuildBook(bookToDocs(b));
  assert.ok(ok, errors.join('; '));
  assert.equal(r.journal[3].importKey, '2026-02-01|30000|imported offering');
  assert.equal(r.journal[0].importKey, null);
  assert.deepEqual([...importedKeys(r)], [...keys]);
});

test('rebuilding an empty/settings-only stream yields a valid empty book', () => {
  const { book, ok } = rebuildBook([{ t: 'settings', baseCurrency: 'USD', decimals: 2 }]);
  assert.ok(ok);
  assert.ok(book.funds.has('general'));
  assert.equal(book.journal.length, 0);
});
