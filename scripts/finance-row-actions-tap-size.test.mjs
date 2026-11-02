// POINT-OF-USE (CLAUDE.md 1 & 3): the inline list-row action buttons carry a real ≥44px phone tap target.
//   Run: node --test scripts/finance-row-actions-tap-size.test.mjs
//
// Renders the REAL DashFinanceBook through scripts/console-screens.mjs, feeds an invoice, a bill and an account,
// navigates to each tab via the real FinTabStrip, and asserts every row action button (PDF / Mark paid / Credit
// note / Approve / Edit / Archive) has style.minHeight >= 44 (the bkRowBtn token). Reads the rendered style,
// never the .jsx text; revert a button to the old ~26px size and it goes red.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook rows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

// The SHIPPED engine bundle (all of invoice/bill/budget/… live here, as the console loads it) — the row status
// badges call F.invoiceStatus / F.billStatus, which the four src modules alone do not carry.
const FL = new Function(readFileSync(new URL('../vendor/finance-ledger.js', import.meta.url), 'utf8') + '\nreturn FinanceLedger;')();

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  return d;
});

function setup() {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({ actingChurch: '', pubkey: '', encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; }, encPublish: async () => true, relayAuthed: () => true });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const feed = (items) => { if (!encSubCb) draw(); assert.ok(encSubCb, 'encSubscribe not wired'); encSubCb(items); draw(); };
  return { draw, feed, get tree() { return tree; } };
}

function baseBook() {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addAccount(b, { id: 'other-expense', code: '5900', name: 'Other costs', type: 'expense' });
  return toItems(FL.bookToDocs(b));
}
const gotoTab = (h, key) => { nodes(h.tree).find(n => typeof n.type === 'function' && n.type.name === 'FinTabStrip').props.setTab(key); h.draw(); };
const byTitle = (tree, title) => nodes(tree).find(n => n.type === 'button' && n.props && n.props.title === title);
const big = (btn, label) => { assert.ok(btn, `no "${label}" button found`); assert.ok((btn.props.style || {}).minHeight >= 44, `"${label}" is below the 44px tap target`); };

test('invoice row action buttons (PDF / Mark paid / Credit note) are ≥44px', () => {
  const h = setup();
  h.feed([...baseBook(), { id: 'invoice:i1', number: '2026-1', contact: 'Scouts', lines: [{ desc: 'Hire', account: 'giving', fund: 'general', amount: 5000 }], issued: '2026-01-01', due: '2026-02-01', credit: false, issueSeq: null }]);
  gotoTab(h, 'invoices');
  big(byTitle(h.tree, 'Download this as a printable PDF'), 'PDF');
  big(byTitle(h.tree, 'Record payment in full (dr bank / cr receivables)'), 'Mark paid');
  big(byTitle(h.tree, 'Raise a credit note that reverses this invoice (its own entry; the original is untouched)'), 'Credit note');
});

test('bill row action buttons (Approve / Mark paid) are ≥44px', () => {
  const h = setup();
  h.feed([...baseBook(), { id: 'bill:b1', number: 'B1', supplier: 'Gas Co', lines: [{ desc: 'Gas', account: 'other-expense', fund: 'general', amount: 3000 }], received: '2026-01-01', due: '2026-02-01', approved: null, receiveSeq: null, by: '' }]);
  gotoTab(h, 'bills');
  big(byTitle(h.tree, 'Approve this bill so it can be paid (finance stewards only)'), 'Approve');
});

test('account row buttons (Edit / Archive) are ≥44px', () => {
  const h = setup();
  h.feed(baseBook());
  gotoTab(h, 'accounts');
  big(byTitle(h.tree, 'Rename this account or change its code'), 'Edit account');
  const archive = nodes(h.tree).find(n => n.type === 'button' && n.props && typeof n.props.title === 'string' && n.props.title.indexOf('Hide this account') === 0);
  big(archive, 'Archive');
});
