// POINT-OF-USE (CLAUDE.md 1 & 3): reversing a ledger entry ASKS FIRST, and the row action buttons are a real
// tap size. Run: node --test scripts/finance-reverse-confirms.test.mjs
//
// Renders the REAL DashFinanceBook through scripts/console-screens.mjs and drives the rendered ↩ control:
//   · with confirm() denied, clicking ↩ publishes NO reversal (the guard held);
//   · with confirm() granted, clicking ↩ publishes the reversal (the action still works);
//   · the row's Correct + ↩ buttons carry a ≥44px tap target (bkRowBtn / bkRowIconBtn).
// Reading the rendered tree, never the .jsx text, so a deleted guard or a reverted size fails the test.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

import * as _ledger from '../src/finance-ledger.mjs';
import * as _store from '../src/finance-store.mjs';
import * as _statement from '../src/finance-statement.mjs';
import * as _import from '../src/finance-import.mjs';
const FL = { ..._ledger, ..._store, ..._statement, ..._import };

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  return d;
});

function setup() {
  const fr = fakeReact();
  const pub = [];
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async (d, body) => { pub.push({ d, body }); return true; },
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const feed = (docs) => { if (!encSubCb) draw(); assert.ok(encSubCb, 'encSubscribe not wired'); encSubCb(toItems(docs)); draw(); };
  return { fr, pub, window, draw, feed, get tree() { return tree; } };
}

function bookDocs() {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.post(b, { date: '2026-01-01', memo: 'keepme', postings: [{ account: 'bank', dir: 'dr', amount: 5000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 5000 }] });
  return FL.bookToDocs(b);
}
const reversalsPublished = (pub) => pub.filter(p => /^finance\/journal:/.test(p.d) && p.body && p.body.reverses != null);
const reverseBtn = (tree) => nodes(tree).find(n => n.type === 'button' && (n.kids || []).some(k => k === '↩'));
const correctBtn = (tree) => nodes(tree).find(n => n.type === 'button' && (n.kids || []).some(k => k === 'Correct'));

test('with confirm() DENIED, clicking ↩ publishes no reversal (the guard held)', async () => {
  const h = setup(); h.feed(bookDocs());
  h.window.confirm = () => false;
  const btn = reverseBtn(h.tree);
  assert.ok(btn, 'no ↩ Reverse control on the normal row');
  btn.props.onClick();
  await new Promise(r => setImmediate(r));
  assert.equal(reversalsPublished(h.pub).length, 0, 'a reversal was published even though the treasurer cancelled the confirm');
});

test('with confirm() GRANTED, clicking ↩ publishes the reversal (the action still works)', async () => {
  const h = setup(); h.feed(bookDocs());
  h.window.confirm = () => true;
  reverseBtn(h.tree).props.onClick();
  await new Promise(r => setImmediate(r));
  const revs = reversalsPublished(h.pub);
  assert.equal(revs.length, 1, 'confirming the reverse did not publish exactly one reversal');
  assert.equal(revs[0].body.reverses, 1, 'the reversal does not point at the original entry (seq 1)');
});

test('the Correct and ↩ row buttons carry a ≥44px tap target', () => {
  const h = setup(); h.feed(bookDocs());
  assert.ok((correctBtn(h.tree).props.style || {}).minHeight >= 44, 'the "Correct" button is below the 44px tap target');
  assert.ok((reverseBtn(h.tree).props.style || {}).minHeight >= 44, 'the ↩ Reverse button is below the 44px tap target');
});
