// A GAPPED BOOK DISABLES RECORD AND IMPORT.
//   Run: node --test scripts/a-gapped-book-disables-record-and-import.test.mjs
//
// THE DEFECT. `rebuildBook` returns `{ ok, errors }` when the journal has gaps or forks, but both
// callers discarded them. A treasurer saw "In the bank £100" instead of £700 and could record new
// entries that the relay would refuse. Nothing said why.
//
// THE FIX. `DashFinanceBook` keeps `r.errors` in state. When errors are present, a warning banner
// shows the first error and Record + Import are disabled.
//
// Callers: DashFinanceBook's encSubscribe callback in `app/stew-finance.jsx`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

test('CONTROL: rebuildBook returns errors on a sequence gap', async () => {
  const { rebuildBook, bookToDocs } = await import('../src/finance-store.mjs');
  const { createBook, addAccount, post } = await import('../src/finance-ledger.mjs');
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank:main', code: '1000', name: 'Main', type: 'asset' });
  addAccount(b, { id: 'income:giving', code: '4000', name: 'Giving', type: 'income' });
  post(b, { date: '2026-01-01', memo: 'A', postings: [{ account: 'bank:main', dir: 'dr', amount: 100 }, { account: 'income:giving', dir: 'cr', amount: 100 }] });
  post(b, { date: '2026-01-02', memo: 'B', postings: [{ account: 'bank:main', dir: 'dr', amount: 200 }, { account: 'income:giving', dir: 'cr', amount: 200 }] });
  post(b, { date: '2026-01-03', memo: 'C', postings: [{ account: 'bank:main', dir: 'dr', amount: 400 }, { account: 'income:giving', dir: 'cr', amount: 400 }] });
  const docs = bookToDocs(b);
  const gapped = docs.filter(d => !(d.t === 'journal' && d.seq === 2));
  const r = rebuildBook(gapped);
  assert.equal(r.ok, false, 'a gapped journal should not be ok');
  assert.ok(r.errors.length > 0, 'a gapped journal should have errors');
});

test('on a gapped book, Record and Import are disabled and a warning shows', async () => {
  const { React, reset, flush, fresh, unmount } = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (prefix, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  const _store = await import('../src/finance-store.mjs');
  const _ledger = await import('../src/finance-ledger.mjs');
  window.FinanceLedger = { ..._ledger, ..._store };
  const mods = loadConsole({ React, window, expr: '{ DashFinanceBook }' });

  let tree;
  const draw = () => { reset(); tree = mods.DashFinanceBook(); flush(); return tree; };
  const allNodes = () => nodes(tree);
  const button = (label) => allNodes().find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes(label)));
  const hasText = (t) => allNodes().some(n => (n.kids || []).some(k => typeof k === 'string' && k.includes(t)));

  // Initial draw: no encSubscribe data yet, book is empty
  draw();

  // Feed a gapped journal through encSubscribe: seq 1 and seq 3 (missing seq 2)
  const F = window.FinanceLedger;
  const b = F.createBook({ baseCurrency: 'GBP', decimals: 2 });
  F.addAccount(b, { id: 'bank:main', code: '1000', name: 'Main', type: 'asset' });
  F.addAccount(b, { id: 'income:giving', code: '4000', name: 'Giving', type: 'income' });
  F.post(b, { date: '2026-01-01', memo: 'Entry one', postings: [{ account: 'bank:main', dir: 'dr', amount: 500 }, { account: 'income:giving', dir: 'cr', amount: 500 }] });
  F.post(b, { date: '2026-01-02', memo: 'Entry two', postings: [{ account: 'bank:main', dir: 'dr', amount: 300 }, { account: 'income:giving', dir: 'cr', amount: 300 }] });
  F.post(b, { date: '2026-01-03', memo: 'Entry three', postings: [{ account: 'bank:main', dir: 'dr', amount: 200 }, { account: 'income:giving', dir: 'cr', amount: 200 }] });
  const docs = F.bookToDocs(b);

  // Remove seq 2 to create a gap
  const gapped = docs.filter(d => !(d.t === 'journal' && d.seq === 2))
    .map(d => {
      if (d.t === 'settings') return { id: 'settings', ...d };
      if (d.t === 'account') return { id: 'account:' + d.id, ...d };
      if (d.t === 'fund') return { id: 'fund:' + d.id, ...d };
      if (d.t === 'journal') return { id: 'journal:' + d.seq, ...d };
      return d;
    });

  assert.ok(encSubCb, 'encSubscribe was not called');
  encSubCb(gapped);
  draw();

  const recordBtn = button('Record');
  const importBtn = button('Import');
  assert.ok(recordBtn, 're-anchor: no Record button');
  assert.ok(importBtn, 're-anchor: no Import button');
  assert.equal(recordBtn.props.disabled, true,
    'THE RECORD BUTTON IS NOT DISABLED ON A GAPPED BOOK — a treasurer can enter transactions ' +
    'that the relay will refuse because the journal has a gap');
  assert.equal(importBtn.props.disabled, true,
    'THE IMPORT BUTTON IS NOT DISABLED ON A GAPPED BOOK');
  assert.ok(hasText('incomplete'),
    'NO WARNING IS SHOWN WHEN THE BOOK HAS A GAP — the treasurer sees wrong totals with no explanation');

  unmount();
});
