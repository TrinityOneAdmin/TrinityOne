// A REVERSED ENTRY IS STRUCK THROUGH, NOT THE REVERSAL.
//   Run: node --test scripts/a-reversed-entry-is-struck-through-not-the-reversal.test.mjs
//
// THE DEFECT. `booksEntryView` set `reversed: e.reverses != null`, which marks "this IS a reversal",
// not "this WAS reversed". The rendering struck through and dimmed the REVERSAL row while the original
// gift looked normal and kept its ↩ button. Tapping ↩ threw "already reversed" and showed nothing.
//
// THE FIX. `booksEntryView` now returns `isReversal` and `wasReversed` (which looks up whether any
// journal entry targets this one). The original is struck through; the reversal is not. ↩ is hidden
// from both.
//
// Caller of booksEntryView: DashFinanceBook's `recent.map` in `app/stew-finance.jsx`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FIN = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');
const VIEW = fnBody(FIN, 'function booksEntryView(book, e) {', 'booksEntryView');
const fn = new Function('return (' + VIEW + ')')();

function makeBook(journal) {
  return {
    journal,
    accounts: new Map([
      ['income:giving', { name: 'Giving', type: 'income' }],
      ['bank:main', { name: 'Main account', type: 'asset' }],
    ]),
    funds: new Map(),
  };
}

const gift = { seq: 1, date: '2026-09-01', memo: 'Sunday', postings: [{ account: 'bank:main', amount: 500 }, { account: 'income:giving', amount: -500, fund: 'general' }] };
const reversal = { seq: 2, date: '2026-09-02', memo: 'Reversal of #1', reverses: 1, postings: [{ account: 'bank:main', amount: -500 }, { account: 'income:giving', amount: 500, fund: 'general' }] };
const normal = { seq: 3, date: '2026-09-03', memo: 'Wednesday', postings: [{ account: 'bank:main', amount: 200 }, { account: 'income:giving', amount: -200, fund: 'general' }] };

test('a reversed gift is struck through and has no undo button', () => {
  const book = makeBook([gift, reversal, normal]);
  const v = fn(book, gift);
  assert.equal(v.wasReversed, true,
    'THE ORIGINAL GIFT IS NOT MARKED AS REVERSED — a treasurer sees a live-looking £500 gift with an ↩ ' +
    'button that does nothing, and may post a manual correction that double-corrects the books');
  assert.equal(v.isReversal, false, 'the original should not be marked as a reversal');
});

test('the reversal row is NOT struck through', () => {
  const book = makeBook([gift, reversal, normal]);
  const v = fn(book, reversal);
  assert.equal(v.isReversal, true, 'the reversal should be marked as isReversal');
  assert.equal(v.wasReversed, false, 'the reversal should not be marked as wasReversed');
});

test('CONTROL: an un-reversed entry keeps its undo button', () => {
  const book = makeBook([gift, reversal, normal]);
  const v = fn(book, normal);
  assert.equal(v.isReversal, false);
  assert.equal(v.wasReversed, false);
});
