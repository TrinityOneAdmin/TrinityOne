// THE BILLS / ACCOUNTS-PAYABLE ENGINE (Phase 6, pure — CLAUDE.md rule 1 engine half).
//   Run: node --test scripts/finance-bill.test.mjs
//
// The payable mirror of finance-invoice.test.mjs. Proves the pure model in node: a bill→balanced journal
// accrued through the reserved AP liability account, status DERIVED on an INJECTED local-day (never new Date),
// the approval state machine draft→approved→paid, and — the control this phase exists for — that a payment
// CANNOT be built for an unapproved bill (billPaymentEntry throws). The point-of-use half (the Pay control is
// disabled on the screen until approved) is finance-bills-ui.test.mjs; the relay half (the approver is bound to
// the signer) is finance-bill-approval-rule.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, post, check, fundBalances, trialBalance } from '../src/finance-ledger.mjs';
import {
  AP_ACCT, AP_ACCOUNT, assertApAccount, billTotal, billReceiveEntry, billPaymentEntry,
  billOutstanding, billStatus, isBillApproved, billApprovers, openBills,
} from '../src/finance-bill.mjs';

// A book with a bank asset, an expense account, a fund, and the reserved AP liability account.
function book() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  addAccount(b, { id: AP_ACCT, code: AP_ACCOUNT.code, name: AP_ACCOUNT.name, type: AP_ACCOUNT.type });
  return b;
}
const bill = (over = {}) => ({ id: 'b1', number: 'INV-4471', supplier: 'British Gas', received: '2026-05-01', due: '2026-05-31', lines: [{ desc: 'Gas', account: 'utilities', fund: 'general', amount: 9500 }], ...over });

test('the reserved AP account is a liability, and assertApAccount proves it', () => {
  assert.equal(AP_ACCOUNT.type, 'liability', 'AP must be a liability — a cr to an income/expense account would be wrong');
  const b = book();
  assert.equal(assertApAccount(b), true, 'AP present+liability should assert true');
  const empty = createBook({ baseCurrency: 'GBP', decimals: 2 });
  assert.equal(assertApAccount(empty), false, 'AP absent should be false, not a throw');
  const wrong = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(wrong, { id: AP_ACCT, code: '9', name: 'x', type: 'asset' });
  assert.throws(() => assertApAccount(wrong), /must be a liability/, 'a slug collision with the wrong type must throw, not post');
});

test('recording a bill posts a BALANCED accrual entry: dr expense/fund, cr AP', () => {
  const b = book();
  const e = post(b, billReceiveEntry(bill()));
  assert.equal(e.bill, 'b1', 'the entry carries the opaque bill id so it can be netted');
  const dr = e.postings.filter(p => p.dir === 'dr').reduce((s, p) => s + p.amount, 0);
  const cr = e.postings.filter(p => p.dir === 'cr').reduce((s, p) => s + p.amount, 0);
  assert.equal(dr, cr, 'the entry does not balance');
  assert.equal(cr, 9500, 'AP should be credited the total');
  assert.ok(e.postings.some(p => p.account === AP_ACCT && p.dir === 'cr' && p.amount === 9500), 'AP is not credited');
  assert.ok(e.postings.some(p => p.account === 'utilities' && p.dir === 'dr' && p.amount === 9500), 'the expense is not debited');
  assert.equal(check(b).ok, true, 'the whole-book invariant broke');
});

test('a bill with no positive line is refused with a clear message', () => {
  assert.throws(() => billReceiveEntry({ id: 'x', lines: [] }), /at least one line/);
  assert.throws(() => billReceiveEntry({ id: 'x', lines: [{ account: 'utilities', amount: 0 }] }), /at least one line/);
});

test('status is DERIVED on an INJECTED local day — unpaid / overdue / paid', () => {
  const b = book();
  post(b, billReceiveEntry(bill({ due: '2026-05-31' })));
  // before the due date → unpaid; on/after → overdue; the module never reads the clock
  assert.equal(billStatus(bill({ due: '2026-05-31' }), '2026-05-15', b.journal), 'unpaid', 'a bill due later is unpaid');
  assert.equal(billStatus(bill({ due: '2026-05-31' }), '2026-06-01', b.journal), 'overdue', 'a bill past its due date is overdue');
  // a bill that was never recorded is NOT "paid" just because its AP net is zero
  assert.equal(billStatus(bill({ id: 'never' }), '2026-06-01', []), 'overdue', 'an unrecorded, past-due bill is overdue, never paid');
});

test('paying an APPROVED bill clears the payable and the status derives PAID — no fund double-count', () => {
  const b = book();
  post(b, billReceiveEntry(bill()));
  const fundsAfterReceive = fundBalances(b);
  const gen1 = (fundsAfterReceive.find(f => f.fund === 'general') || {}).balance;
  // the expense (and the fund it draws on) is recognised at RECEIVE
  assert.equal(billOutstanding('b1', b.journal), 9500, 'the whole bill is outstanding before payment');
  // PAYMENT: dr AP / cr bank — a liability→asset move, NO second fund posting
  post(b, billPaymentEntry(bill(), { date: '2026-05-20', approved: true }));
  assert.equal(billOutstanding('b1', b.journal), 0, 'AP should net to zero after full payment');
  assert.equal(billStatus(bill(), '2026-06-01', b.journal), 'paid', 'a fully paid bill derives PAID even past its due date');
  const gen2 = (fundBalances(b).find(f => f.fund === 'general') || {}).balance;
  assert.equal(gen2, gen1, 'the fund balance moved on PAYMENT — the expense was double-counted (payment must not touch a fund)');
  // bank fell by the payment; AP nets to zero on the trial balance
  assert.equal(check(b).ok, true, 'the book no longer balances after payment');
  const ap = trialBalance(b).rows.find(r => r.account === AP_ACCT);
  assert.equal((ap.debit - ap.credit), 0, 'the AP control account should be flat once the bill is paid');
});

test('THE GUARD: a bill cannot be paid before it is approved (engine throws)', () => {
  assert.throws(() => billPaymentEntry(bill(), { approved: false }), /cannot be paid before it is approved/,
    'billPaymentEntry must refuse an unapproved bill — this is the guard the whole phase turns on');
  assert.throws(() => billPaymentEntry(bill(), {}), /cannot be paid before it is approved/,
    'a missing approved flag is NOT approved — the guard must default to refusing');
  // the only way through is an explicit approved:true
  assert.doesNotThrow(() => billPaymentEntry(bill(), { approved: true }), 'an approved bill must be payable');
});

test('the approval state machine — LIGHT mode reads the bill field, DUAL mode reads the signed approvals', () => {
  // LIGHT (default): the bill doc carries the flag
  assert.equal(isBillApproved(bill(), { mode: 'light' }), false, 'a bill with no approval field is not approved');
  assert.equal(isBillApproved(bill({ approved: { by: 'ab'.repeat(32), ts: 1 } }), { mode: 'light' }), true, 'the light flag approves');
  // DUAL (opt-in): a separate approval doc referring to the bill id, NOT the bill field
  const approvals = [{ bill: 'b1', approver: 'cd'.repeat(32) }];
  assert.equal(isBillApproved(bill({ approved: { by: 'x', ts: 1 } }), { mode: 'dual', approvals: [] }), false,
    'DUAL mode must IGNORE the forgeable bill field — only a signed approval doc counts');
  assert.equal(isBillApproved(bill(), { mode: 'dual', approvals }), true, 'a matching signed approval approves in dual mode');
  assert.equal(isBillApproved(bill({ id: 'other' }), { mode: 'dual', approvals }), false, 'an approval for another bill does not approve this one');
  // approvers on record
  assert.deepEqual(billApprovers(bill(), { mode: 'dual', approvals }), ['cd'.repeat(32)], 'the dual approver comes from the signed doc');
  assert.deepEqual(billApprovers(bill({ approved: { by: 'ef'.repeat(32), ts: 1 } }), { mode: 'light' }), ['ef'.repeat(32)], 'the light approver comes from the bill field');
});

test('DUAL mode enforces SEPARATION OF DUTIES — you cannot approve your own bill (approver != recordedBy)', () => {
  const X = 'a'.repeat(64), Y = 'b'.repeat(64);
  const recordedByX = bill({ by: X });
  // X recorded it and X is the only "approver" → NOT approved (a self-approval does not count)
  assert.equal(isBillApproved(recordedByX, { mode: 'dual', approvals: [{ bill: 'b1', approver: X }] }), false,
    'a bill approved only by the steward who recorded it must NOT count as approved — self-approval defeats dual control');
  // a DIFFERENT finance steward Y approves → approved
  assert.equal(isBillApproved(recordedByX, { mode: 'dual', approvals: [{ bill: 'b1', approver: Y }] }), true,
    'an approval by a different finance steward must count');
  // X's self-approval alongside Y's real one → still approved (Y carries it); and X's self-approval is NOT listed
  assert.equal(isBillApproved(recordedByX, { mode: 'dual', approvals: [{ bill: 'b1', approver: X }, { bill: 'b1', approver: Y }] }), true, 'a real approval stands even beside a self-approval');
  assert.deepEqual(billApprovers(recordedByX, { mode: 'dual', approvals: [{ bill: 'b1', approver: X }, { bill: 'b1', approver: Y }] }), [Y], 'the recorder self-approval must be excluded from the approvers list');
  // recordedBy defaults to bill.by when the caller passes only the bill; an explicit recordedBy overrides
  assert.equal(isBillApproved(recordedByX, { mode: 'dual', approvals: [{ bill: 'b1', approver: X }], recordedBy: Y }), true,
    'an explicit recordedBy overrides bill.by — here X is no longer the recorder, so X may approve');
  // case-insensitive comparison (d-tag hex is lower-case; bill.by is too, but prove the compare is robust)
  assert.equal(isBillApproved(bill({ by: X.toUpperCase() }), { mode: 'dual', approvals: [{ bill: 'b1', approver: X }] }), false,
    'the recorder/approver comparison must be case-insensitive');
  // a single-steward church simply cannot reach approved in dual mode — intended, no fallback
  assert.equal(isBillApproved(recordedByX, { mode: 'dual', approvals: [] }), false, 'no approvals, not approved');
});

test('a payment of an unapproved bill does NOT post — the manual AND auto-match routes share the guard', () => {
  // Both Mark-paid and a Phase-3 auto-match call payBill → billPaymentEntry(…, { approved }). With isBillApproved
  // false, the entry is never built, so NOTHING is posted. Prove the journal stays at just the receive entry.
  const b = book();
  post(b, billReceiveEntry(bill()));
  const approved = isBillApproved(bill(), { mode: 'light' });   // false
  assert.throws(() => post(b, billPaymentEntry(bill(), { date: '2026-05-20', approved })), /approved/);
  assert.equal(b.journal.length, 1, 'a refused payment must leave only the receive entry in the journal');
  assert.equal(billStatus(bill(), '2026-06-01', b.journal), 'overdue', 'the bill is still unpaid (overdue), never paid');
});

test('openBills lists the unpaid/overdue bills with derived status + outstanding, standalone (no Phase 3)', () => {
  const b = book();
  post(b, billReceiveEntry(bill({ id: 'b1', due: '2026-05-31' })));
  post(b, billReceiveEntry(bill({ id: 'b2', due: '2030-01-01', lines: [{ account: 'utilities', amount: 3000 }] })));
  post(b, billPaymentEntry(bill({ id: 'b2', lines: [{ account: 'utilities', amount: 3000 }] }), { approved: true }));
  const open = openBills([bill({ id: 'b1' }), bill({ id: 'b2' })], b.journal, '2026-06-01');
  assert.equal(open.length, 1, 'only the unpaid bill is open');
  assert.equal(open[0].bill.id, 'b1');
  assert.equal(open[0].status, 'overdue');
  assert.equal(open[0].outstanding, 9500);
});

test('the bill id round-trips through the four serializers (post → bookToDocs → rebuild)', async () => {
  const { bookToDocs, rebuildBook } = await import('../src/finance-store.mjs');
  const b = book();
  post(b, billReceiveEntry(bill()));
  const docs = bookToDocs(b);
  const j = docs.find(d => d.t === 'journal');
  assert.equal(j.bill, 'b1', 'bookToDocs dropped the bill tag');
  const { book: rebuilt, ok } = rebuildBook(docs);
  assert.equal(ok, true, 'the rebuilt book did not balance');
  assert.equal(rebuilt.journal[0].bill, 'b1', 'applyEntry dropped the bill tag on rebuild');
});
