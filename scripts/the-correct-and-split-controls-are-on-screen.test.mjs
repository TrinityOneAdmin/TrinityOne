// PHASE 2 POINT-OF-USE: the Correct / split / attachment controls are ON THE SCREEN and gated (CLAUDE.md 1 & 3).
//   Run: node --test scripts/the-correct-and-split-controls-are-on-screen.test.mjs
//
// Every assertion renders the REAL DashFinanceBook / BooksRecord through scripts/console-screens.mjs (the whole
// console compiled the way the phone loads it) and reads the RENDERED TREE — never the .jsx text, so a `false &&`
// in front of a control cannot satisfy it. Deleting the control from the screen fails the test.
//
// Covers: "Correct" is present on a normal row and ABSENT on a reversed row AND on its reversal row (the audit's
// required negative test — it reuses the existing !isReversal && !wasReversed gate); "Correct" reverses the
// original and opens a BooksRecord pre-filled with the entry's amount on the rendered tree; the split UI disables
// Save when the category rows do not sum to the total and enables it when they do; and the receipt-attachment
// control is on the record form.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook + BooksRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
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
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, BooksRecord }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const feed = (docs) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(toItems(docs)); draw(); };
  return { fr, pub, mods, draw, feed, get tree() { return tree; } };
}

// A feed row is a flex div at padding '9px 0' with a top border; return {texts, hasCorrect} for each.
const feedRows = (tree) => nodes(tree)
  .filter(n => n.type === 'div' && n.props && n.props.style && n.props.style.padding === '9px 0' && n.props.style.borderTop === '1px solid var(--line)')
  .map(row => ({
    text: texts(row).join(' '),
    hasCorrect: nodes(row).some(n => n.type === 'button' && (n.kids || []).some(k => k === 'Correct')),
    hasReverse: nodes(row).some(n => n.type === 'button' && (n.kids || []).some(k => k === '↩')),
  }));

function bookWithAReversal() {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addFund(b, { id: 'building', name: 'Building', kind: 'restricted' });
  FL.addAccount(b, { id: 'fund-transfer', code: '3900', name: 'Fund transfer', type: 'equity' });   // the reserved transfer account
  FL.post(b, { date: '2026-01-01', memo: 'keepme', postings: [{ account: 'bank', dir: 'dr', amount: 5000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 5000 }] });   // seq 1 — normal
  FL.post(b, { date: '2026-01-02', memo: 'wrongone', postings: [{ account: 'bank', dir: 'dr', amount: 3000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 3000 }] });  // seq 2 — to be reversed
  FL.reverse(b, 2, { by: 'me' });   // seq 3 — the reversal of seq 2
  FL.post(b, { date: '2026-01-03', memo: '', postings: [{ account: 'fund-transfer', fund: 'general', dir: 'dr', amount: 1000 }, { account: 'fund-transfer', fund: 'building', dir: 'cr', amount: 1000 }] });   // seq 4 — a fund transfer
  return b;
}

test('"Correct" is on a NORMAL row and ABSENT on a reversed row, its reversal row, AND a fund transfer', () => {
  const h = setup();
  h.draw();
  h.feed(FL.bookToDocs(bookWithAReversal()));
  const rows = feedRows(h.tree);
  const normal = rows.find(r => r.text.includes('keepme'));
  const reversed = rows.find(r => r.text.includes('wrongone'));
  const reversal = rows.find(r => /Reversal of #/.test(r.text));
  const transfer = rows.find(r => /Transfer:/.test(r.text));
  assert.ok(normal && reversed && reversal && transfer, 're-anchor: expected a normal, a reversed, a reversal and a transfer row; got: ' + rows.map(r => r.text).join(' | '));
  assert.ok(normal.hasCorrect, 'the NORMAL row has no "Correct" control');
  assert.ok(!reversed.hasCorrect, 'A REVERSED ROW STILL OFFERS "Correct" — the gate !isReversal && !wasReversed is not applied');
  assert.ok(!reversal.hasCorrect, 'A REVERSAL ROW STILL OFFERS "Correct" — a treasurer must not correct a reversal');
  // A FUND TRANSFER has no income/expense BooksRecord shape to pre-fill, so Correct is gated off it by the
  // !v.isTransfer half of the condition. It keeps the bare Reverse ↩ (transfers are not reversed/reversals),
  // which is exactly what distinguishes this from the reversal-pair rows above.
  assert.ok(!transfer.hasCorrect, 'A FUND TRANSFER ROW OFFERS "Correct" — the !isTransfer half of the gate is missing; the pre-fill would misread a transfer as a payment');
  assert.ok(transfer.hasReverse, 're-anchor: a fund transfer should still offer the bare Reverse ↩');
  // the same gate governs the bare Reverse ↩ on the reversal pair — both gone there, present on the normal row
  assert.ok(normal.hasReverse && !reversed.hasReverse && !reversal.hasReverse, 're-anchor: the ↩ gate diverged from the Correct gate');
});

test('"Correct" reverses the original and opens a BooksRecord pre-filled with the entry amount (rendered)', async () => {
  const h = setup();
  h.draw();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.post(b, { date: '2026-01-01', memo: 'typo', postings: [{ account: 'bank', dir: 'dr', amount: 5000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 5000 }] });
  h.feed(FL.bookToDocs(b));

  const correctBtn = nodes(h.tree).find(n => n.type === 'button' && (n.kids || []).some(k => k === 'Correct'));
  assert.ok(correctBtn, 'no "Correct" control on the normal entry');
  correctBtn.props.onClick();                                   // reverse + await, then open the pre-filled form
  await new Promise(r => setImmediate(r));                      // let undo()'s encPublish promise settle
  h.draw();

  // the reversal was appended and published (append-only correction)
  assert.ok(h.pub.some(p => /^finance\/journal:/.test(p.d) && p.body.reverses === 1), 'Correct did not publish a reversal of the original entry');

  // the pre-filled BooksRecord is mounted; its initial carries the entry's amount and direction
  const modal = nodes(h.tree).find(n => typeof n.type === 'function' && n.type.name === 'BooksRecord');
  assert.ok(modal, 'Correct did not open a BooksRecord to re-enter the fixed copy');
  assert.equal(modal.props.initial && modal.props.initial.amount, '50.00', 'the BooksRecord was not pre-filled with the original amount');
  assert.equal(modal.props.initial.dir, 'in', 'the pre-fill lost the direction of the original entry');

  // and that pre-fill reaches the RENDERED tree: the amount input shows 50.00
  h.fr.fresh();
  h.fr.reset(); const t = h.mods.BooksRecord({ book: b, onRecord() {}, onClose() {}, initial: modal.props.initial }); h.fr.flush();
  const amtInput = nodes(t).find(n => n.type === 'input' && n.props && n.props['aria-label'] === 'Amount');
  assert.ok(amtInput && amtInput.props.value === '50.00', 'the pre-filled amount is not on the rendered form; value=' + (amtInput && amtInput.props.value));
});

function renderBooksRecord(h) {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addAccount(b, { id: 'outreach', code: '5100', name: 'Outreach', type: 'expense' });
  FL.addAccount(b, { id: 'building', code: '5200', name: 'Building', type: 'expense' });
  h.fr.fresh();
  let tree = null;
  const draw = () => { h.fr.reset(); tree = h.mods.BooksRecord({ book: b, onRecord() {}, onClose() {} }); h.fr.flush(); return tree; };
  const byLabel = (label) => nodes(tree).find(n => n.type === 'input' && n.props && n.props['aria-label'] === label);
  const btn = (txt) => nodes(tree).find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes(txt)));
  const recordBtn = () => nodes(tree).find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.startsWith('Record money')));
  draw();
  return { b, draw, byLabel, btn, recordBtn, get tree() { return tree; } };
}

test('the split UI disables Save unless the category rows sum EXACTLY to the total', () => {
  const h = setup();
  const r = renderBooksRecord(h);
  // switch to Money out so the categories are expenses, then open the split editor
  r.btn('Money out').props.onClick(); r.draw();
  r.btn('Split across categories').props.onClick(); r.draw();

  // total £100; rows seeded empty. Set the total and two rows that do NOT sum (60 + 30).
  r.byLabel('Amount').props.onChange({ target: { value: '100.00' } }); r.draw();
  r.byLabel('Split amount 1').props.onChange({ target: { value: '60.00' } }); r.draw();
  r.byLabel('Split amount 2').props.onChange({ target: { value: '30.00' } }); r.draw();
  assert.equal(r.recordBtn().props.disabled, true, 'SAVE IS ENABLED ON A SPLIT THAT DOES NOT SUM (60 + 30 ≠ 100) — the balance guard is missing');

  // correct the second row to 40 → now 60 + 40 = 100, Save enabled
  r.byLabel('Split amount 2').props.onChange({ target: { value: '40.00' } }); r.draw();
  assert.equal(r.recordBtn().props.disabled, false, 'Save is still disabled when the split rows DO sum to the total (60 + 40 = 100)');
});

test('the record form offers a receipt-attachment control', () => {
  const h = setup();
  const r = renderBooksRecord(h);
  const fileInput = nodes(r.tree).find(n => n.type === 'input' && n.props && n.props.type === 'file' && n.props['aria-label'] === 'Attach a receipt image');
  assert.ok(fileInput, 'THERE IS NO RECEIPT-ATTACHMENT CONTROL on the record form');
});

test('an entry carrying attachmentRefs shows the receipt chip (the finItemToDoc deserialize path)', () => {
  // Proves the DESERIALIZE half end to end: the entry's attachmentRefs ride the encSubscribe delivery through
  // finItemToDoc → rebuildBook → the feed row, where the 📎 chip renders. Drop attachmentRefs from finItemToDoc
  // (or the ?? []) and the ref never reaches the entry, so the chip disappears and this fails.
  const h = setup();
  h.draw();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.post(b, { date: '2026-02-01', memo: 'gift with receipt', attachmentRefs: ['att-x'], postings: [{ account: 'bank', dir: 'dr', amount: 5000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 5000 }] });
  FL.post(b, { date: '2026-02-02', memo: 'gift no receipt', postings: [{ account: 'bank', dir: 'dr', amount: 2000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 2000 }] });
  h.feed(FL.bookToDocs(b));   // round-trips through toItems → finItemToDoc → rebuildBook, exactly as the relay delivers

  const chips = nodes(h.tree).filter(n => n.type === 'button' && n.props && n.props['aria-label'] === 'View receipt');
  assert.equal(chips.length, 1, 'expected exactly ONE receipt chip — the entry with attachmentRefs should show it and the one without should not; found ' + chips.length);
  // and it is on the row for the receipted entry, not the other one
  const receiptRow = nodes(h.tree).find(n => n.type === 'div' && n.props && n.props.style && n.props.style.padding === '9px 0' && texts(n).join(' ').includes('gift with receipt') && nodes(n).some(x => x.type === 'button' && x.props && x.props['aria-label'] === 'View receipt'));
  assert.ok(receiptRow, 'the 📎 receipt chip did not render on the row of the entry that carries attachmentRefs — the deserialize path dropped the refs');
});
