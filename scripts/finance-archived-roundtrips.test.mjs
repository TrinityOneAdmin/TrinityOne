// AN ARCHIVED ACCOUNT ROUND-TRIPS, AND AN OLD CONSOLE IGNORES THE FLAG GRACEFULLY.
//   Run: node --test scripts/finance-archived-roundtrips.test.mjs
//
// `archived` hides an account from the category pickers while KEEPING it in the ledger and reports (an
// account with postings can never be deleted — check() requires every posting's account to exist). It must
// survive the serialize→rebuild round trip, default to false when absent (so an older console's account docs,
// and books rebuilt from them, read as not-archived), and never affect any projection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, post, check, accountHasPostings } from '../src/finance-ledger.mjs';
import { bookToDocs, rebuildBook } from '../src/finance-store.mjs';

test('addAccount stores `archived` and bookToDocs→rebuildBook preserves it', () => {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'old-appeal', code: '4500', name: 'Harvest appeal 2025', type: 'income', archived: true });
  assert.equal(b.accounts.get('old-appeal').archived, true, 'addAccount did not store archived');
  assert.equal(b.accounts.get('giving').archived, false, 'archived should default to false');

  const docs = bookToDocs(b);
  const accDoc = docs.find(d => d.t === 'account' && d.id === 'old-appeal');
  assert.equal(accDoc.archived, true, 'bookToDocs dropped the archived flag');

  const r = rebuildBook(docs);
  assert.ok(r.ok, 'rebuild failed: ' + r.errors.join('; '));
  assert.equal(r.book.accounts.get('old-appeal').archived, true, 'archived was lost on rebuild');
  assert.equal(r.book.accounts.get('giving').archived, false, 'a non-archived account came back archived');
});

test('an OLD account doc (no `archived` field) rebuilds as not-archived — back-compat', () => {
  // Shape of a doc an un-upgraded console published: the four original fields, no `archived`.
  const docs = [
    { t: 'settings', baseCurrency: 'GBP', decimals: 2, fiscalYearStart: '01-01' },
    { t: 'account', id: 'bank', code: '1000', name: 'Bank', type: 'asset' },
    { t: 'account', id: 'giving', code: '4000', name: 'Giving', type: 'income' },
  ];
  const r = rebuildBook(docs);
  assert.ok(r.ok, 'rebuild of old-shaped docs failed: ' + r.errors.join('; '));
  assert.equal(r.book.accounts.get('bank').archived, false, 'an account doc with no archived field should read as not-archived');
});

test('archiving is invisible to the ledger: a posted account stays in the book and in check()', () => {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income', archived: true });
  post(b, { date: '2026-01-01', memo: 'gift', postings: [{ account: 'bank', dir: 'dr', amount: 5000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 5000 }] });
  assert.ok(accountHasPostings(b, 'giving'), 'accountHasPostings missed a posted account');
  assert.equal(accountHasPostings(b, 'nonexistent'), false, 'accountHasPostings should be false for an unposted id');
  const c = check(b);
  assert.ok(c.ok, 'archiving a posted account broke the book: ' + c.errors.join('; '));
});
