// PHASE 2 ENGINE: attachmentRefs round-trip, split entries, and the reverse/attachment decision.
//   Run: node --test scripts/finance-entry-editing.test.mjs
//
// The pure half of Phase 2 (corrections + splits + attachments). The UI half — that the "Correct" and split
// controls are actually ON THE SCREEN and gated — is scripts/the-correct-and-split-controls-are-on-screen.test.mjs
// (CLAUDE.md rules 1 & 3). These assert the ledger carries attachmentRefs through BOTH (de)serializers it owns
// (post/applyEntry and bookToDocs↔rebuildBook) and that a multi-category split balances and attributes each
// posting's fund. The console's other two serializers (pubEntry, finItemToDoc) live in app/stew-finance.jsx and
// are covered by the point-of-use test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, addFund, post, applyEntry, reverse, fundBalances, check } from '../src/finance-ledger.mjs';
import { bookToDocs, rebuildBook } from '../src/finance-store.mjs';

function seed() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'outreach', code: '5100', name: 'Outreach', type: 'expense' });
  addAccount(b, { id: 'building', code: '5200', name: 'Building', type: 'expense' });
  addFund(b, { id: 'buildfund', name: 'Building fund', kind: 'restricted' });
  return b;
}
const gift = (amount, attachmentRefs) => ({ date: '2026-01-01', memo: 'gift', attachmentRefs, postings: [{ account: 'bank', dir: 'dr', amount }, { account: 'giving', fund: 'general', dir: 'cr', amount }] });

test('post() carries attachmentRefs, and an entry posted without them defaults to []', () => {
  const b = seed();
  const withRef = post(b, gift(5000, ['att-1']));
  assert.deepEqual(withRef.attachmentRefs, ['att-1']);
  const without = post(b, { date: '2026-01-02', memo: 'plain', postings: [{ account: 'bank', dir: 'dr', amount: 1000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 1000 }] });
  assert.deepEqual(without.attachmentRefs, [], 'an entry with no attachmentRefs must default to [] (backward compat)');
});

test('applyEntry round-trips attachmentRefs (a journal doc without them replays as [])', () => {
  const b = seed();
  const e1 = applyEntry(b, { seq: 1, date: '2026-01-01', attachmentRefs: ['r1', 'r2'], postings: [{ account: 'bank', dir: 'dr', amount: 5000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 5000 }] });
  assert.deepEqual(e1.attachmentRefs, ['r1', 'r2']);
  const e2 = applyEntry(b, { seq: 2, date: '2026-01-02', postings: [{ account: 'bank', dir: 'dr', amount: 1000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 1000 }] });
  assert.deepEqual(e2.attachmentRefs, [], 'a pre-Phase-2 journal doc (no attachmentRefs) must replay as []');
});

test('a split entry balances and each category posting keeps its own fund', () => {
  const b = seed();
  // £100 spend split across two categories/funds; bank is the single balancing leg.
  const e = post(b, { date: '2026-03-01', memo: 'conference + materials', postings: [
    { account: 'outreach', fund: 'general', dir: 'dr', amount: 6000 },
    { account: 'building', fund: 'buildfund', dir: 'dr', amount: 4000 },
    { account: 'bank', dir: 'cr', amount: 10000 },
  ] });
  assert.equal(e.postings.length, 3, 'the split entry should keep all three postings');
  const chk = check(b);
  assert.ok(chk.ok, 'the split book does not pass check(): ' + chk.errors.join('; '));
  const fb = Object.fromEntries(fundBalances(b).map(f => [f.fund, f.balance]));
  // an expense DR reduces the fund it is charged to
  assert.equal(fb.general, -6000, 'the general-fund leg was not attributed to the general fund');
  assert.equal(fb.buildfund, -4000, 'the restricted-fund leg was not attributed to its own fund');
});

test('a split whose category legs do not sum to the bank leg is refused by the balance check', () => {
  const b = seed();
  assert.throws(() => post(b, { date: '2026-03-02', postings: [
    { account: 'outreach', fund: 'general', dir: 'dr', amount: 6000 },
    { account: 'building', fund: 'buildfund', dir: 'dr', amount: 4000 },
    { account: 'bank', dir: 'cr', amount: 9000 },   // 9000 ≠ 6000 + 4000
  ] }), /does not balance/, 'an unbalanced split must throw — this is the backstop behind the UI Save guard');
});

test('bookToDocs ↔ rebuildBook carry attachmentRefs through the round-trip', () => {
  const b = seed();
  post(b, gift(5000, ['A1']));
  post(b, { date: '2026-01-02', memo: 'no receipt', postings: [{ account: 'bank', dir: 'dr', amount: 1000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 1000 }] });
  const docs = bookToDocs(b);
  const jdocs = docs.filter(d => d.t === 'journal');
  assert.deepEqual(jdocs[0].attachmentRefs, ['A1'], 'bookToDocs dropped attachmentRefs from the journal doc');
  assert.deepEqual(jdocs[1].attachmentRefs, [], 'bookToDocs did not default a receiptless entry to []');
  const r = rebuildBook(docs);
  assert.ok(r.ok, 'rebuildBook failed: ' + r.errors.join('; '));
  assert.deepEqual(r.book.journal[0].attachmentRefs, ['A1'], 'rebuildBook lost attachmentRefs');
  assert.deepEqual(r.book.journal[1].attachmentRefs, []);
});

test('reverse() does NOT copy the original entry\'s attachmentRefs — the corrected replacement carries the receipt', () => {
  const b = seed();
  const orig = post(b, gift(5000, ['A1']));
  const rev = reverse(b, orig.seq, { by: 'me' });
  assert.deepEqual(rev.attachmentRefs, [], 'the reversal copied the original receipt; it should carry none (F7 decision)');
});
