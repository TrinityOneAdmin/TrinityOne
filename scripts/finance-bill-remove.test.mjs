// REMOVING A BILL IS A CONFIRMED MOMENT THAT REVERSES ITS MONEY (point-of-use, CLAUDE.md 1 & 3).
//   Run: node --test scripts/finance-bill-remove.test.mjs
//
// Owner decision 2026-11-03: a stale bill must be removable, and "Remove" must be void-&-reverse — the recorded
// payment is reversed (append-only) so the bank is restored, the bill is hidden from the list, and every entry
// stays in the ledger (a "Show removed" toggle brings it back). This also unsticks a corrupt bill whose payment
// was tagged but whose receive was not (billOutstanding then reads NEGATIVE, which used to dead-lock Mark paid).
//
// Every assertion renders the REAL DashFinanceBook / BillRemoveDialog through console-screens.mjs and reads the
// RENDERED TREE — never the .jsx text (those files ship unbundled, so a `false &&` leaves the text in place and a
// text match still passes). The harness renders ONE component and does not recurse into children, so: SCREEN
// assertions drive DashFinanceBook and read the mounted <BillRemoveDialog> ELEMENT + its props and the visible
// rows / "In the bank" figure; DIALOG-CONTENTS assertions render BillRemoveDialog directly. Delete the Remove
// button, the void-&-reverse, the hide, or the openPay negative guard, and a test here fails.
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook, BillRemoveDialog, voidBill, openPay).
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
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, BillRemoveDialog }' });
  window.useStewardChurch = () => ({ name: 'St Test', features: {} });   // light mode: any steward may approve
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const drawComp = (name, props) => { fr.reset(); const t = mods[name](props); fr.flush(); return t; };
  const all = (t = tree) => nodes(t);
  const button = (label, t) => all(t).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const goTab = (key) => { const s = all().find(n => typeof n.type === 'function' && n.type.name === 'FinTabStrip'); if (!s) throw new Error('re-anchor: FinTabStrip not rendered'); s.props.setTab(key); draw(); };
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe not wired'); encSubCb(items); draw(); };
  const removeDialogEl = () => all().find(n => typeof n.type === 'function' && n.type.name === 'BillRemoveDialog');
  const payDialogEl = () => all().find(n => typeof n.type === 'function' && n.type.name === 'BillPaymentDialog');
  const statusNode = () => all().find(n => n.props && n.props['data-bill-status']);
  const removedNode = () => all().find(n => n.props && n.props['data-bill-removed']);
  // the "In the bank" figure the treasurer sees. The stat CARD is the tightest node whose text is exactly the
  // label + its value (two strings); an ancestor would carry more, so match length === 2 to pin the card itself.
  const bankFigure = () => {
    const card = all().find(n => { const t = texts(n); return t.length === 2 && t.includes('In the bank'); });
    return card ? (texts(card).find(s => s !== 'In the bank') || '') : '';
  };
  return { fr, draw, drawComp, all, button, click, goTab, feedItems, removeDialogEl, payDialogEl, statusNode, removedNode, bankFigure, get tree() { return tree; } };
}

// an APPROVED (light-mode) £95.00 bill, optionally already PAID in full.
function seed({ pay = false } = {}) {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  FL.addAccount(b, { id: FL.AP_ACCT, code: FL.AP_ACCOUNT.code, name: FL.AP_ACCOUNT.name, type: FL.AP_ACCOUNT.type });
  const bill = { id: 'b1', number: 'INV-4471', supplier: 'British Gas', received: '2026-05-01', due: '2026-06-01', lines: [{ desc: 'Gas', account: 'utilities', fund: 'general', amount: 9500 }] };
  const rcv = FL.post(b, FL.billReceiveEntry(bill));
  if (pay) FL.post(b, FL.billPaymentEntry(bill, { date: '2026-05-20', amount: 9500, approved: true }));
  const docs = toItems(FL.bookToDocs(b));
  docs.push({ t: 'bill', id: 'bill:' + bill.id, number: bill.number, supplier: bill.supplier, lines: bill.lines, received: bill.received, due: bill.due, approved: { by: 'cd'.repeat(32), ts: 1 }, receiveSeq: rcv.seq });
  return docs;
}

// THE STALE/CORRUPT case: an approved bill whose RECEIVE was posted UNtagged (an old build) but whose PAYMENT is
// tagged — so billOutstanding reads NEGATIVE and billStatus reads 'unpaid' for ever. receiveSeq is stored so the
// remove path can still find and reverse the untagged receive.
function seedStale() {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  FL.addAccount(b, { id: FL.AP_ACCT, code: FL.AP_ACCOUNT.code, name: FL.AP_ACCOUNT.name, type: FL.AP_ACCOUNT.type });
  const rcv = FL.post(b, { date: '2026-05-01', memo: 'Bill INV-9', postings: [{ account: 'utilities', fund: 'general', dir: 'dr', amount: 9500 }, { account: FL.AP_ACCT, dir: 'cr', amount: 9500 }] });   // UNtagged receive
  FL.post(b, { date: '2026-05-20', bill: 'b1', memo: 'Payment of bill INV-9', postings: [{ account: FL.AP_ACCT, dir: 'dr', amount: 9500 }, { account: 'bank', dir: 'cr', amount: 9500 }] });   // TAGGED payment
  const docs = toItems(FL.bookToDocs(b));
  docs.push({ t: 'bill', id: 'bill:b1', number: 'INV-9', supplier: 'British Gas', lines: [{ desc: 'Gas', account: 'utilities', fund: 'general', amount: 9500 }], received: '2026-05-01', due: '2026-06-01', approved: { by: 'cd'.repeat(32), ts: 1 }, receiveSeq: rcv.seq });
  return docs;
}
const book95 = () => FL.rebuildBook(seed()).book;

// the stale shape as a LIVE book (built with F.post, not round-tripped through relay-id docs), for the engine
// precondition — billOutstanding reads negative here, which is exactly what traps the old Mark-paid dialog.
function staleBookDirect() {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  FL.addAccount(b, { id: FL.AP_ACCT, code: FL.AP_ACCOUNT.code, name: FL.AP_ACCOUNT.name, type: FL.AP_ACCOUNT.type });
  FL.post(b, { date: '2026-05-01', memo: 'Bill INV-9', postings: [{ account: 'utilities', fund: 'general', dir: 'dr', amount: 9500 }, { account: FL.AP_ACCT, dir: 'cr', amount: 9500 }] });
  FL.post(b, { date: '2026-05-20', bill: 'b1', memo: 'Payment of bill INV-9', postings: [{ account: FL.AP_ACCT, dir: 'dr', amount: 9500 }, { account: 'bank', dir: 'cr', amount: 9500 }] });
  return b;
}

// ── the SCREEN ───────────────────────────────────────────────────────────────────────────────────────────────

test('every bill row offers a Remove control, and Remove opens a confirm dialog (does NOT void in one tap)', () => {
  const h = setup(); h.draw();
  h.feedItems(seed()); h.goTab('bills');
  assert.ok(h.statusNode(), 'the seeded bill should be on the screen');
  assert.ok(!h.removeDialogEl(), 'no remove dialog before Remove is pressed');
  assert.ok(h.button('Remove'), 'the Remove control must be on each bill row');
  h.click('Remove');
  assert.ok(h.removeDialogEl(), 'Remove must MOUNT the confirm dialog, not void directly');
  assert.ok(h.statusNode(), 'opening the confirm must not have removed the bill yet');
});

test('confirming Remove voids the bill and hides it from the list', async () => {
  const h = setup(); h.draw();
  h.feedItems(seed()); h.goTab('bills');
  h.click('Remove');
  await h.removeDialogEl().props.onConfirm();
  h.draw();
  // A voided row drops its status badge, so statusNode() alone is vacuous (absent either way); assert the whole
  // row is gone — no status badge AND no "removed" badge — which only holds if the list actually filters it out.
  assert.ok(!h.statusNode(), 'after confirming, the removed bill must be hidden from the list');
  assert.ok(!h.removedNode(), 'with Show-removed OFF, the voided row must not be rendered at all');
  assert.ok(h.button('Show removed bills'), 'a Show-removed toggle must appear once a bill is removed');
});

test('a removed bill reappears (badged "removed") when Show removed is on', async () => {
  const h = setup(); h.draw();
  h.feedItems(seed()); h.goTab('bills');
  h.click('Remove');
  await h.removeDialogEl().props.onConfirm();
  h.draw();
  h.click('Show removed bills');
  assert.ok(h.removedNode(), 'with Show removed on, the voided bill shows with a "removed" badge');
});

test('removing a PAID bill reverses the payment — the bank balance is restored', async () => {
  const h = setup(); h.draw();
  h.feedItems(seed({ pay: true })); h.goTab('bills');
  const before = h.bankFigure();
  assert.match(before, /95/, 'with the £95 bill paid, the bank reflects the £95 that went out');
  h.click('Remove');
  await h.removeDialogEl().props.onConfirm();
  h.draw();
  const after = h.bankFigure();
  assert.doesNotMatch(after, /95/, 'after removing the paid bill the £95 payment is reversed and the bank is restored');
});

// ── the STALE/CORRUPT bill: Remove unsticks it, and Mark paid is never dead-locked by a negative outstanding ───

test('a stale bill (tagged payment, untagged receive) reads negative outstanding but Remove still restores the bank', async () => {
  // Prove the precondition on the engine the screen uses: billOutstanding is negative for this shape.
  assert.ok(FL.billOutstanding('b1', staleBookDirect().journal) < 0, 'precondition: the stale bill nets to a NEGATIVE outstanding');
  const h = setup(); h.draw();
  h.feedItems(seedStale()); h.goTab('bills');
  const before = h.bankFigure();
  assert.match(before, /95/, 'the stale bill has £95 out of the bank (its tagged payment)');
  h.click('Remove');
  await h.removeDialogEl().props.onConfirm();
  h.draw();
  assert.ok(!h.statusNode(), 'the stale bill is removed from the list');
  assert.doesNotMatch(h.bankFigure(), /95/, 'removing the stale bill reverses its tagged payment and restores the bank');
});

test('openPay never pre-fills a negative amount on a stale bill (Mark paid is not dead-locked)', () => {
  const h = setup(); h.draw();
  h.feedItems(seedStale()); h.goTab('bills');
  assert.notEqual((h.statusNode() || {}).props['data-bill-status'], 'paid', 'the stale bill reads unpaid, so Mark paid is offered');
  h.click('Mark paid');
  const dlg = h.payDialogEl();
  assert.ok(dlg, 'Mark paid opens the payment dialog');
  assert.ok(dlg.props.amount0 > 0, 'the pre-filled amount must be POSITIVE (falls back to the bill total), not the negative outstanding');
});

// ── the DIALOG CONTENTS ──────────────────────────────────────────────────────────────────────────────────────

test('the remove dialog renders a Remove-bill confirm button that calls onConfirm', async () => {
  const h = setup();
  let called = false;
  const t = h.drawComp('BillRemoveDialog', { book: book95(), bill: { id: 'b1', number: 'INV-4471', supplier: 'British Gas', lines: [{ account: 'utilities', fund: 'general', amount: 9500 }] }, onConfirm: async () => { called = true; return true; }, onClose: () => {} });
  const btn = h.button('Remove bill', t);
  assert.ok(btn, 'a Remove-bill confirm button must render');
  assert.ok(h.button('Cancel', t), 'a Cancel button must render');
  await btn.props.onClick({ stopPropagation() {}, preventDefault() {} });
  assert.ok(called, 'pressing Remove bill must call onConfirm');
});
