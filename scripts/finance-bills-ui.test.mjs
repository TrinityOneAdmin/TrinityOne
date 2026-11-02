// THE BILLS UI IS ACTUALLY ON THE SCREEN, AND AN UNAPPROVED BILL CANNOT BE PAID (Phase 6, point-of-use —
// CLAUDE.md rules 1 & 3).   Run: node --test scripts/finance-bills-ui.test.mjs
//
// Every assertion renders the REAL DashFinanceBook / BooksBillEdit through console-screens.mjs (the console
// compiled the way the phone loads it) and reads the RENDERED TREE — never the .jsx text, so a `false &&` in
// front of a control cannot satisfy it. The load-bearing one is the Mark-paid control's rendered `disabled`
// prop: it is TRUE while the bill is unapproved and FALSE once approved. Delete the bill editor, the status
// badge, the Approve control, or the disabled-until-approved wiring, and a test here fails. The engine half
// (balanced accrual, derived status, the paid-before-approved THROW) is finance-bill.test.mjs; the relay half
// (approver bound to the signer) is finance-bill-approval-rule.test.mjs.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook, BooksBillEdit, booksTodayISO).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
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

function setup(opts) {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '',
    pubkey: (opts && opts.me) || 'ab'.repeat(32),   // this console's signing pubkey (who "I" am)
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, BooksBillEdit }' });
  // DUAL mode is an opt-in the church turns on (strict features.billApproval === true). Inject it via the same
  // useStewardChurch hook DashFinanceBook reads; absent → light (the default the other tests exercise). Set it
  // AFTER loadConsole, because the console scripts define their own window.useStewardChurch and would clobber it.
  window.useStewardChurch = () => ({ name: 'St Test', features: (opts && opts.dual) ? { billApproval: true } : {} });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const drawComp = (name, props) => { fr.reset(); const t = mods[name](props); fr.flush(); return t; };
  const all = () => nodes(tree);
  const button = (label) => all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(items); draw(); };
  const statusNode = () => all().find(n => n.props && n.props['data-bill-status']);
  return { fr, draw, drawComp, all, button, click, feedItems, statusNode, get tree() { return tree; } };
}

function editorBook() {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  return b;
}

// A book carrying the reserved AP account + one RECEIVED (accrued) bill; `pay` adds a payment so it reads paid.
// `approved` adds the LIGHT-mode approval field to the fed bill doc (the default mode in this harness, where the
// church has no features — strict `features.billApproval === true` is false, so the light flow runs).
function seed({ due = '2000-01-01', approved = false, pay = false } = {}) {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  FL.addAccount(b, { id: FL.AP_ACCT, code: FL.AP_ACCOUNT.code, name: FL.AP_ACCOUNT.name, type: FL.AP_ACCOUNT.type });
  const bill = { id: 'b1', number: 'INV-4471', supplier: 'British Gas', received: '2026-05-01', due, lines: [{ desc: 'Gas', account: 'utilities', fund: 'general', amount: 9500 }] };
  FL.post(b, FL.billReceiveEntry(bill));
  if (pay) FL.post(b, FL.billPaymentEntry(bill, { date: '2026-05-20', approved: true }));
  const docs = toItems(FL.bookToDocs(b));
  const billDoc = { t: 'bill', id: 'invoice-unused', number: bill.number, supplier: bill.supplier, lines: bill.lines, received: bill.received, due: bill.due, receiveSeq: 1 };
  billDoc.id = 'bill:' + bill.id;
  if (approved) billDoc.approved = { by: 'cd'.repeat(32), ts: 1 };
  docs.push(billDoc);
  return docs;
}

// DUAL-mode seed: a received bill recorded by `recordedBy`, plus an approval doc (the d-tag suffix carries the
// approver, as the subscription delivers it) for each pubkey in `approvers`. Status derives from the journal.
function dualSeed({ recordedBy, approvers = [], due = '2000-01-01' } = {}) {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  FL.addAccount(b, { id: FL.AP_ACCT, code: FL.AP_ACCOUNT.code, name: FL.AP_ACCOUNT.name, type: FL.AP_ACCOUNT.type });
  const bill = { id: 'b1', number: 'INV-4471', supplier: 'British Gas', received: '2026-05-01', due, lines: [{ desc: 'Gas', account: 'utilities', fund: 'general', amount: 9500 }] };
  FL.post(b, FL.billReceiveEntry(bill));
  const docs = toItems(FL.bookToDocs(b));
  docs.push({ t: 'bill', id: 'bill:' + bill.id, number: bill.number, supplier: bill.supplier, lines: bill.lines, received: bill.received, due: bill.due, by: recordedBy, receiveSeq: 1 });
  for (const ap of approvers) docs.push({ t: 'billapproval', id: 'billapproval:' + bill.id + ':' + ap, bill: bill.id, approver: ap, ts: 1 });
  return docs;
}

test('the Bills panel shows a bill with a status badge, an Approve control and a Mark-paid control', () => {
  const h = setup();
  h.draw();
  h.feedItems(seed({ due: '2000-01-01' }));   // a long-overdue, unapproved bill
  h.click('Bills');                            // open the collapsible
  assert.ok(h.button('New bill'), 'the "New bill" control is not on the screen');
  const joined = texts(h.tree).join(' ');
  assert.ok(/INV-4471/.test(joined), 'the bill reference is not on the screen');
  assert.ok(/British Gas/.test(joined), 'the supplier is not on the screen');
  assert.ok(/£95\.00/.test(joined), 'the bill total is not on the screen');
  const badge = h.statusNode();
  assert.ok(badge, 'no bill status badge rendered (a data-bill-status node) — delete the badge and this fails');
  assert.equal(badge.props['data-bill-status'], 'overdue', 'a past-due, unpaid bill must badge OVERDUE');
  assert.ok(h.button('Approve'), 'the Approve control is not on the screen');
  assert.ok(h.button('Mark paid'), 'the Mark paid control is not on the screen');
});

test('an UNAPPROVED bill’s Mark-paid control is DISABLED, and it ENABLES once approved (the rendered prop)', () => {
  // Unapproved: the control is on the screen but disabled — this is the point-of-use half of the guard.
  const unapproved = setup();
  unapproved.draw();
  unapproved.feedItems(seed({ due: '2000-01-01', approved: false }));
  unapproved.click('Bills');
  const payOff = unapproved.button('Mark paid');
  assert.ok(payOff, 'the Mark paid control must render even when disabled, so its state is on the screen');
  assert.equal(payOff.props.disabled, true, 'an UNAPPROVED bill’s Mark-paid control must be DISABLED (assert the rendered disabled prop, not .jsx text)');

  // Approved (light mode: the bill doc carries the approval field): the SAME control enables.
  const approved = setup();
  approved.draw();
  approved.feedItems(seed({ due: '2000-01-01', approved: true }));
  approved.click('Bills');
  const payOn = approved.button('Mark paid');
  assert.ok(payOn, 'the Mark paid control vanished once approved — it must stay and enable');
  assert.equal(payOn.props.disabled, false, 'an APPROVED bill’s Mark-paid control must be ENABLED — the disabled-until-approved wiring is gone');
  // and once approved, the Approve control is no longer offered
  assert.ok(!approved.button('Approve'), 'an already-approved bill must not still offer Approve');
});

// ── DUAL CONTROL on the screen: you cannot approve your own bill, and a self-approval never enables payment ──
const ME = 'a'.repeat(64), OTHER = 'b'.repeat(64);

test('DUAL: the RECORDER’s own Approve control is DISABLED (you cannot approve your own bill)', () => {
  const h = setup({ me: ME, dual: true });
  h.draw();
  h.feedItems(dualSeed({ recordedBy: ME, approvers: [] }));   // I recorded it; nobody has approved
  h.click('Bills');
  const approve = h.button('Approve');
  assert.ok(approve, 'the Approve control must render so the recorder can see it is not theirs to use');
  assert.equal(approve.props.disabled, true, 'the steward who RECORDED the bill must not be able to approve it (dual control)');
  // and a self-"approval" must NOT enable payment
  const h2 = setup({ me: ME, dual: true });
  h2.draw();
  h2.feedItems(dualSeed({ recordedBy: ME, approvers: [ME] }));   // the recorder "approved" their own bill
  h2.click('Bills');
  const pay = h2.button('Mark paid');
  assert.ok(pay, 'the Mark paid control must still render');
  assert.equal(pay.props.disabled, true, 'a self-approval must NOT enable Mark paid — separation of duties is not enforced on the screen');
});

test('DUAL: a DIFFERENT finance steward may approve, and that ENABLES Mark paid', () => {
  // I (ME) am NOT the recorder (OTHER is), and no one has approved yet → my Approve control is enabled.
  const h = setup({ me: ME, dual: true });
  h.draw();
  h.feedItems(dualSeed({ recordedBy: OTHER, approvers: [] }));
  h.click('Bills');
  const approve = h.button('Approve');
  assert.ok(approve, 'a steward who did not record the bill must see an Approve control');
  assert.equal(approve.props.disabled, false, 'a steward who did not record the bill must be able to approve it');
  assert.equal(h.button('Mark paid').props.disabled, true, 'before a different-steward approval, Mark paid stays disabled');

  // once that different steward (ME) has approved a bill recorded by OTHER → Mark paid enables.
  const h2 = setup({ me: ME, dual: true });
  h2.draw();
  h2.feedItems(dualSeed({ recordedBy: OTHER, approvers: [ME] }));
  h2.click('Bills');
  const pay = h2.button('Mark paid');
  assert.ok(pay, 'the Mark paid control must render');
  assert.equal(pay.props.disabled, false, 'a bill approved by a DIFFERENT finance steward must enable Mark paid');
  assert.ok(!h2.button('Approve'), 'an approved bill no longer offers Approve');
});

// ── THE RECORDER IS THE SIGNER, NOT A FORGEABLE BODY FIELD (finance-audit-2026-11-02 #1) ─────────────────────
// encSubscribe now surfaces `_by` = the RELAY-AUTHENTICATED author (the signer of the bill doc). finItemToDoc
// reads the recorder from `_by`, NOT the in-body `by` a crafting writer controls. These feed a bill whose
// authenticated author (_by) and forged body `by` DISAGREE — the exact attack: a lone steward records a bill but
// writes someone else into `by` so their own signed approval reads as a different person's. Revert finItemToDoc
// to read `it.by` and the first test's controls ENABLE (the recorder no longer == me) → it fails.
function forgedDualSeed({ authedBy, bodyBy, approvers = [], due = '2000-01-01' } = {}) {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  FL.addAccount(b, { id: FL.AP_ACCT, code: FL.AP_ACCOUNT.code, name: FL.AP_ACCOUNT.name, type: FL.AP_ACCOUNT.type });
  const bill = { id: 'b1', number: 'INV-4471', supplier: 'British Gas', received: '2026-05-01', due, lines: [{ desc: 'Gas', account: 'utilities', fund: 'general', amount: 9500 }] };
  FL.post(b, FL.billReceiveEntry(bill));
  const docs = toItems(FL.bookToDocs(b));
  // _by = the signer encSubscribe authenticated (what the relay bound to the event); by = the forgeable sealed field.
  docs.push({ t: 'bill', id: 'bill:' + bill.id, number: bill.number, supplier: bill.supplier, lines: bill.lines, received: bill.received, due: bill.due, by: bodyBy, _by: authedBy, receiveSeq: 1 });
  for (const ap of approvers) docs.push({ t: 'billapproval', id: 'billapproval:' + bill.id + ':' + ap, bill: bill.id, approver: ap, ts: 1 });
  return docs;
}

test('DUAL: the recorder is the SIGNER (_by), not the forgeable body `by` — a forged recorder cannot unlock a self-approval', () => {
  // ME recorded it (authenticated signer _by = ME) but wrote OTHER into the sealed `by` field, then signed their
  // OWN approval. If the recorder were read from the body `by` (= OTHER), ME ≠ OTHER and the self-approval would
  // count — the attack. With the recorder locked to the signer (_by = ME), it must not.
  const h = setup({ me: ME, dual: true });
  h.draw();
  h.feedItems(forgedDualSeed({ authedBy: ME, bodyBy: OTHER, approvers: [ME] }));
  h.click('Bills');
  const approve = h.button('Approve');
  assert.ok(approve, 'the Approve control must render');
  assert.equal(approve.props.disabled, true, 'the recorder (BY SIGNATURE) must not be able to approve — a forged body `by` must not grant it; revert finItemToDoc to read `it.by` and this ENABLES → fails');
  const pay = h.button('Mark paid');
  assert.ok(pay, 'the Mark paid control must render');
  assert.equal(pay.props.disabled, true, 'a self-approval behind a forged recorder must NOT enable Mark paid');
});

test('DUAL: with the recorder locked to the signer, a genuinely DIFFERENT approver still enables payment', () => {
  // OTHER is the authenticated recorder (_by = OTHER); the body `by` is a red herring forged to ME. ME, a
  // different steward, approves → recorder (= _by = OTHER) ≠ ME → the approval is real and Mark paid enables.
  const h = setup({ me: ME, dual: true });
  h.draw();
  h.feedItems(forgedDualSeed({ authedBy: OTHER, bodyBy: ME, approvers: [ME] }));
  h.click('Bills');
  const pay = h.button('Mark paid');
  assert.ok(pay, 'the Mark paid control must render');
  assert.equal(pay.props.disabled, false, 'a bill approved by a steward who is NOT the signer-recorder must enable Mark paid');
  assert.ok(!h.button('Approve'), 'an approved bill no longer offers Approve');
});

test('a paid bill badges PAID and no longer offers Mark paid (derived from the journal)', () => {
  const h = setup();
  h.draw();
  h.feedItems(seed({ due: '2000-01-01', approved: true, pay: true }));
  h.click('Bills');
  const badge = h.statusNode();
  assert.ok(badge, 'no status badge rendered');
  assert.equal(badge.props['data-bill-status'], 'paid', 'a bill with a payment entry must badge PAID');
  assert.ok(!h.button('Mark paid'), 'a paid bill must not still offer Mark paid');
});

test('the New-bill editor is a real dialog with a description, an EXPENSE category, an amount and a Record control', () => {
  const h = setup();
  const dialog = h.drawComp('BooksBillEdit', { book: editorBook(), contacts: [], onSave() {}, onClose() {} });
  assert.ok(nodes(dialog).some(n => n.props && n.props.role === 'dialog'), 'the bill editor did not render a dialog');
  const inputs = nodes(dialog).filter(n => n.type === 'input');
  assert.ok(inputs.some(i => /description/i.test((i.props && i.props.placeholder) || '')), 'no line-description field on the bill editor');
  assert.ok(inputs.some(i => /0\.00/.test((i.props && i.props.placeholder) || '')), 'no amount field on the bill editor');
  const selects = nodes(dialog).filter(n => n.type === 'select');
  assert.ok(selects.length >= 1, 'no expense-category picker on the bill editor');
  const optText = selects.flatMap(s => nodes(s).filter(o => o.type === 'option').map(o => texts(o).join(''))).join(' ');
  assert.ok(/Utilities/.test(optText), 'the expense category is not offered in the editor');
  assert.ok(nodes(dialog).some(n => n.type === 'button' && /record bill/i.test(texts(n).join(' '))), 'no "Record bill" control on the editor');
});

// ── the OVERDUE badge boundary is the LOCAL day, not UTC (mirrors the invoice point-of-use clock test) ──────
// The badge reads F.billStatus(bill, booksTodayISO(), book.journal). booksTodayISO() is the console's local-day
// helper; prove the status flips to overdue on the LOCAL day even when UTC is still the day before.
const FIN = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');
const TODAY = fnBody(FIN, 'function booksTodayISO()');
function booksTodayISO(localDay) {
  const [y, mo, da] = localDay.split('-').map(Number);
  class FakeDate { getFullYear() { return y; } getMonth() { return mo - 1; } getDate() { return da; } toISOString() { return '2027-04-05T23:30:00.000Z'; } }
  return new Function('Date', `${TODAY}\nreturn booksTodayISO();`)(FakeDate);
}

test('a bill due yesterday-local badges OVERDUE the moment it is today-local, where the UTC day would not', () => {
  const bill = { id: 'b', due: '2027-04-05' };
  const received = [{ bill: 'b', postings: [{ account: FL.AP_ACCT, dir: 'cr', amount: 9500 }] }];
  assert.equal(FL.billStatus(bill, booksTodayISO('2027-04-06'), received), 'overdue', 'with the local day the badge must read overdue');
  assert.equal(FL.billStatus(bill, '2027-04-05', received), 'unpaid', 'CONTROL: judged by the UTC day it would still read unpaid');
});
