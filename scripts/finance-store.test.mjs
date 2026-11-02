// Persistence round-trip + fork/gap detection.  Run: node --test scripts/finance-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, addFund, post, trialBalance, fundBalances, incomeExpenditure, importedKeys } from '../src/finance-ledger.mjs';
import { bookToDocs, rebuildBook, bookDocSignature } from '../src/finance-store.mjs';

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

// ── bookDocSignature: the "skip rebuildBook on a side-doc-only delivery" guard (perf fix) ─────────────────────
// The console compares this fingerprint across finance/ deliveries and skips a full rebuildBook()+check() when
// it is unchanged. It MUST be stable for the same book docs (so a side-doc-only delivery is skipped) and MUST
// change for any real ledger change (so a true change is never wrongly skipped).
test('bookDocSignature is STABLE for identical book docs — order-independent and ignoring side docs', () => {
  const docs = bookToDocs(sampleBook());
  const sig = bookDocSignature(docs);
  // reordered delivery (the relay delivers in any order) → same signature
  assert.equal(bookDocSignature(docs.slice().reverse()), sig, 'signature must not depend on doc order');
  // a delivery that ALSO carries side docs rebuildBook ignores (invoice/bill/donor/budget/attachment) → same
  const withSide = docs.concat([
    { t: 'invoice', id: 'inv1', number: '1', lines: [], issued: '2026-01-01' },
    { t: 'bill', id: 'b1', supplier: 'X', lines: [] },
    { t: 'donor', id: 'd1', name: 'Jo' },
    { t: 'attachment', id: 'a1', data: 'data:image/png;base64,AAA' },
  ]);
  assert.equal(bookDocSignature(withSide), sig, 'side docs must not move the signature (they do not enter the book)');
  // mutating a side doc only → still same signature (this is exactly the delivery we want to SKIP rebuilding)
  withSide[withSide.length - 1] = { t: 'attachment', id: 'a1', data: 'data:image/png;base64,ZZZ' };
  assert.equal(bookDocSignature(withSide), sig, 'a side-doc-only change must leave the signature unchanged');
});

test('bookDocSignature CHANGES when a journal entry is appended, or an account is renamed / archived', () => {
  const base = bookToDocs(sampleBook());
  const sig = bookDocSignature(base);
  // append a journal entry (the common case: a new transaction)
  const b2 = sampleBook();
  post(b2, { date: '2026-02-01', memo: 'extra', postings: [ { account: 'bank', dir: 'dr', amount: 100 }, { account: 'giving', dir: 'cr', amount: 100 } ] });
  assert.notEqual(bookDocSignature(bookToDocs(b2)), sig, 'an appended journal entry must change the signature');
  // rename an account (REPLACEABLE doc, same count/seq — content must be folded in)
  const renamed = base.map(d => d.t === 'account' && d.id === 'giving' ? { ...d, name: 'Offerings' } : d);
  assert.notEqual(bookDocSignature(renamed), sig, 'an account rename must change the signature');
  // archive an account (REPLACEABLE doc, same count/seq)
  const archived = base.map(d => d.t === 'account' && d.id === 'giving' ? { ...d, archived: true } : d);
  assert.notEqual(bookDocSignature(archived), sig, 'an account archive must change the signature');
  // retype an account (chart change that re-signs projections)
  const retyped = base.map(d => d.t === 'account' && d.id === 'giving' ? { ...d, type: 'equity' } : d);
  assert.notEqual(bookDocSignature(retyped), sig, 'an account type change must change the signature');
});
