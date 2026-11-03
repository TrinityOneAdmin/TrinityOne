// MARK-PAID IS A REVIEWED DIALOG (NOT ONE TAP), AND A PAID BILL CAN EDIT ITS PAYMENT (point-of-use, CLAUDE.md 1 & 3).
//   Run: node --test scripts/finance-bill-payment-dialog.test.mjs
//
// Owner decision 2026-11-03: "Mark paid" must confirm before money moves, and a recorded payment must be editable.
// Chosen design: one Payment dialog for both. Mark paid opens it (date + amount, pre-filled to the outstanding
// balance / today) so reviewing it IS the confirmation; a PAID bill shows "Edit payment", which reverses the
// recorded payment (append-only) and reopens the dialog pre-filled. A smaller amount is a part payment.
//
// Every assertion renders the REAL DashFinanceBook / BillPaymentDialog through console-screens.mjs and reads the
// RENDERED TREE — never the .jsx text. The harness renders ONE component at a time and does not recurse into child
// components, so: the SCREEN assertions (Mark paid opens the dialog, a paid bill offers Edit payment, nothing is
// paid in one tap, and the reverse+repost that confirmPay performs) drive DashFinanceBook and read the mounted
// <BillPaymentDialog> ELEMENT + its props; the DIALOG-CONTENTS assertions render BillPaymentDialog directly.
// Delete the dialog, the Edit-payment control, or wire Mark paid back to an instant payBill(), and a test fails.
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook, BillPaymentDialog, booksTodayISO, booksParse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reconcile = await import('../src/finance-reconcile.mjs');
const _reports = await import('../src/finance-reports.mjs');
const _invoice = await import('../src/finance-invoice.mjs');
const _budget = await import('../src/finance-budget.mjs');
const _bill = await import('../src/finance-bill.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reconcile, ..._reports, ..._invoice, ..._budget, ..._bill };

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  return d;
});
const tick = () => new Promise(r => setTimeout(r, 0));

function setup() {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '', pubkey: 'ab'.repeat(32),
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, BillPaymentDialog }' });
  window.useStewardChurch = () => ({ name: 'St Test', features: {} });   // light mode (default): any steward may approve
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const drawComp = (name, props) => { fr.reset(); const t = mods[name](props); fr.flush(); return t; };
  const all = (t = tree) => nodes(t);
  const button = (label, t) => all(t).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const goTab = (key) => { const s = all().find(n => typeof n.type === 'function' && n.type.name === 'FinTabStrip'); if (!s) throw new Error('re-anchor: FinTabStrip not rendered'); s.props.setTab(key); draw(); };
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe not wired'); encSubCb(items); draw(); };
  const payDialogEl = () => all().find(n => typeof n.type === 'function' && n.type.name === 'BillPaymentDialog');
  const statusNode = () => all().find(n => n.props && n.props['data-bill-status']);
  const inputByLabel = (t, lbl) => all(t).find(n => n.type === 'input' && n.props && n.props['aria-label'] === lbl);
  return { fr, draw, drawComp, all, button, click, goTab, feedItems, payDialogEl, statusNode, inputByLabel, get tree() { return tree; } };
}

// an approved (light-mode) bill for £95.00, optionally already paid in full.
function seed({ pay = false } = {}) {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  FL.addAccount(b, { id: FL.AP_ACCT, code: FL.AP_ACCOUNT.code, name: FL.AP_ACCOUNT.name, type: FL.AP_ACCOUNT.type });
  const bill = { id: 'b1', number: 'INV-4471', supplier: 'British Gas', received: '2026-05-01', due: '2026-06-01', lines: [{ desc: 'Gas', account: 'utilities', fund: 'general', amount: 9500 }] };
  FL.post(b, FL.billReceiveEntry(bill));
  if (pay) FL.post(b, FL.billPaymentEntry(bill, { date: '2026-05-20', amount: 9500, approved: true }));
  const docs = toItems(FL.bookToDocs(b));
  docs.push({ t: 'bill', id: 'bill:' + bill.id, number: bill.number, supplier: bill.supplier, lines: bill.lines, received: bill.received, due: bill.due, approved: { by: 'cd'.repeat(32), ts: 1 }, receiveSeq: 1 });
  return docs;
}
const book95 = () => FL.rebuildBook(seed()).book;

// ── the SCREEN: Mark paid opens the dialog (never pays in one tap); confirmPay posts; a paid bill edits ──────────

test('Mark paid opens the payment dialog in PAY mode and does NOT pay in one tap', () => {
  const h = setup(); h.draw();
  h.feedItems(seed()); h.goTab('bills');
  assert.ok(!h.payDialogEl(), 'no payment dialog before Mark paid');
  assert.ok(h.button('Mark paid'), 'the Mark paid control must be on the screen');
  h.click('Mark paid');
  const dlg = h.payDialogEl();
  assert.ok(dlg, 'Mark paid must MOUNT the payment dialog, not pay directly');
  assert.equal(dlg.props.mode, 'pay', 'Mark paid opens the dialog in pay mode');
  assert.equal(dlg.props.amount0, 9500, 'the dialog is pre-filled with the full outstanding amount (minor units)');
  assert.notEqual((h.statusNode() || {}).props['data-bill-status'], 'paid', 'opening the dialog must not have paid the bill');
});

test('confirming a full payment (via the mounted dialog) posts it and the bill reads PAID', async () => {
  const h = setup(); h.draw();
  h.feedItems(seed()); h.goTab('bills');
  h.click('Mark paid');
  await h.payDialogEl().props.onConfirm({ amountMinor: 9500, dateISO: '2026-11-03' });
  h.draw();
  assert.equal(h.statusNode().props['data-bill-status'], 'paid', 'after confirming the full amount the bill must badge PAID');
});

test('confirming a PART payment leaves the bill not fully paid', async () => {
  const h = setup(); h.draw();
  h.feedItems(seed()); h.goTab('bills');
  h.click('Mark paid');
  await h.payDialogEl().props.onConfirm({ amountMinor: 4000, dateISO: '2026-11-03' });
  h.draw();
  assert.notEqual(h.statusNode().props['data-bill-status'], 'paid', 'a £40 part payment of a £95 bill must NOT read fully paid');
});

test('a PAID bill offers Edit payment, which opens the dialog in EDIT mode pre-filled with the paid total', () => {
  const h = setup(); h.draw();
  h.feedItems(seed({ pay: true })); h.goTab('bills');
  assert.equal(h.statusNode().props['data-bill-status'], 'paid', 'the seeded bill should read paid');
  assert.ok(!h.button('Mark paid'), 'a paid bill must not still offer Mark paid');
  assert.ok(h.button('Edit payment'), 'a paid bill must offer Edit payment');
  h.click('Edit payment');
  const dlg = h.payDialogEl();
  assert.ok(dlg, 'Edit payment must mount the payment dialog');
  assert.equal(dlg.props.mode, 'edit', 'Edit payment opens the dialog in edit mode');
  assert.equal(dlg.props.amount0, 9500, 'edit pre-fills with the amount that was paid');
});

test('confirming an edit to a smaller amount REVERSES the old payment and re-posts (bill no longer fully paid)', async () => {
  const h = setup(); h.draw();
  h.feedItems(seed({ pay: true })); h.goTab('bills');
  assert.equal(h.statusNode().props['data-bill-status'], 'paid', 'starts fully paid');
  h.click('Edit payment');
  await h.payDialogEl().props.onConfirm({ amountMinor: 8000, dateISO: '2026-11-03' });
  h.draw();
  // Old £95 reversed (append-only) and £80 re-posted → £15 still outstanding. If edit had NOT reversed the
  // original, £80 would be an EXTRA payment and the bill would still read paid. This asserts the reverse happened.
  assert.notEqual(h.statusNode().props['data-bill-status'], 'paid', 'after editing the payment down to £80 the bill must no longer read fully paid');
});

// ── the DIALOG CONTENTS: amount pre-fill, confirm button, and that it calls onConfirm with the parsed amount ─────

test('the payment dialog renders a pre-filled amount + date and a Record-payment button (pay mode)', async () => {
  const h = setup();
  let got = null;
  const t = h.drawComp('BillPaymentDialog', { book: book95(), bill: { id: 'b1', number: 'INV-4471', supplier: 'British Gas', lines: [{ account: 'utilities', fund: 'general', amount: 9500 }] }, mode: 'pay', amount0: 9500, date0: '2026-11-03', onConfirm: async (x) => { got = x; return true; }, onClose: () => {} });
  const amt = h.inputByLabel(t, 'Payment amount');
  assert.ok(amt, 'amount field must render');
  assert.equal(amt.props.value, '95.00', 'amount pre-fills to the passed outstanding balance in major units');
  assert.ok(h.inputByLabel(t, 'Payment date'), 'date field must render');
  const rec = h.button('Record payment', t);
  assert.ok(rec, 'a Record-payment confirm button must render in pay mode');
  await rec.props.onClick({ stopPropagation() {}, preventDefault() {} });
  assert.ok(got, 'pressing Record must call onConfirm');
  assert.equal(got.amountMinor, 9500, 'onConfirm must receive the parsed amount in minor units');
  assert.equal(got.dateISO, '2026-11-03', 'onConfirm must receive the chosen date');
});

test('the payment dialog shows an Update-payment button in edit mode', () => {
  const h = setup();
  const t = h.drawComp('BillPaymentDialog', { book: book95(), bill: { id: 'b1', number: 'INV-4471', lines: [{ account: 'utilities', fund: 'general', amount: 9500 }] }, mode: 'edit', amount0: 9500, date0: '2026-05-20', onConfirm: async () => true, onClose: () => {} });
  assert.ok(h.button('Update payment', t), 'edit mode must offer an Update-payment button');
  assert.ok(!h.button('Record payment', t), 'edit mode must not label the confirm as Record payment');
});
