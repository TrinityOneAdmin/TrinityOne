// THE INVOICING / ACCOUNTS-RECEIVABLE ENGINE (src/finance-invoice.mjs), Phase 5.
//   Run: node --test scripts/finance-invoice.test.mjs
//
// Pure module, so these are plain node tests over the real functions. The point-of-use tests that the SCREEN
// actually uses them (editor, badges, credit-note control) are in finance-invoicing-ui.test.mjs (CLAUDE.md rule 1).
//
// Covers the PHASE-5 plan + AUDIT-PHASE-5 fixes:
//   · invoice → BALANCED journal postings (dr AR total / cr income lines); accrual (income at issue) (F?).
//   · AR is a RESERVED, idempotent, type-checked account (F3): assertArAccount throws on a wrong-type collision.
//   · status is DERIVED from the journal + due date, never a stored field (F5): a faked local-day boundary (F1).
//   · settlement clears AR (dr bank / cr AR) and moves no fund a second time.
//   · a credit note REVERSES correctly in its OWN entry, leaving the original untouched (append-only) (F4).
//   · the whole-book invariant (check()) holds across the entire lifecycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, post, trialBalance, fundBalances, check } from '../src/finance-ledger.mjs';
import {
  AR_ACCT, AR_ACCOUNT, assertArAccount, invoiceTotal, invoiceIssueEntry, invoiceSettlementEntry,
  creditNoteEntry, invoiceOutstanding, invoiceStatus, invoiceStatuses, openInvoices, invoiceHtml,
} from '../src/finance-invoice.mjs';

function book({ withAr = true } = {}) {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'hire', code: '4100', name: 'Facility hire', type: 'income' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  if (withAr) addAccount(b, { id: AR_ACCT, code: AR_ACCOUNT.code, name: AR_ACCOUNT.name, type: 'asset' });
  return b;
}
const invoice = (over = {}) => ({ id: 'inv1', number: '2026-014', contact: 'Scouts', issued: '2026-05-01', due: '2026-05-15',
  lines: [{ desc: 'Hall hire', account: 'hire', fund: 'general', amount: 9500 }], ...over });

// ── the reserved AR account (AUDIT-PHASE-5 F3) ───────────────────────────────────────────────────────────
test('assertArAccount: absent → false, present-asset → true, present-but-wrong-type → throws', () => {
  const absent = book({ withAr: false });
  assert.equal(assertArAccount(absent), false, 'AR absent should report false so the caller creates it');
  const ok = book();
  assert.equal(assertArAccount(ok), true, 'a present asset AR should report true');
  const wrong = book({ withAr: false });
  addAccount(wrong, { id: AR_ACCT, code: '4999', name: 'Accounts receivable', type: 'income' });   // a hand-made clash
  assert.throws(() => assertArAccount(wrong), /must be an asset/, 'a wrong-type AR must throw, not be posted to');
  // idempotent: asserting twice over the real asset does not change the book
  assert.equal(assertArAccount(ok), true);
  assert.equal(ok.accounts.size, book().accounts.size, 'assertArAccount must not add or remove accounts');
});

// ── issue → balanced postings, accrual ───────────────────────────────────────────────────────────────────
test('invoiceIssueEntry posts dr AR (total) / cr income lines, and BALANCES', () => {
  const b = book();
  const inv = invoice({ lines: [
    { desc: 'Hall hire', account: 'hire', fund: 'general', amount: 9500 },
    { desc: 'Donation', account: 'giving', fund: 'general', amount: 500 },
  ] });
  assert.equal(invoiceTotal(inv), 10000);
  const entry = post(b, invoiceIssueEntry(inv));
  // AR debited the whole total; each income line credited
  const ar = entry.postings.find(p => p.account === AR_ACCT);
  assert.ok(ar && ar.dir === 'dr' && ar.amount === 10000, 'AR must be debited the invoice total');
  assert.equal(entry.postings.filter(p => p.dir === 'cr').reduce((s, p) => s + p.amount, 0), 10000, 'the income credits must sum to the total');
  assert.equal(entry.invoice, 'inv1', 'the entry must carry the invoice id so status can be derived');
  // accrual: the income hit the fund at ISSUE (surplus up by 10000), AR carries the receivable
  const tb = trialBalance(b);
  assert.ok(tb.balanced, 'the issue entry must leave the trial balance balanced');
  assert.equal(invoiceOutstanding('inv1', b.journal), 10000, 'the whole invoice is still outstanding');
  assert.deepEqual(check(b), { ok: true, errors: [] }, 'the book must stay whole after issue');
});

test('invoiceIssueEntry refuses an invoice with no positive line', () => {
  assert.throws(() => invoiceIssueEntry({ id: 'x', lines: [] }), /at least one line/);
  assert.throws(() => invoiceIssueEntry({ id: 'x', lines: [{ account: 'hire', amount: 0 }] }), /at least one line/);
});

// ── derived status (AUDIT-PHASE-5 F5) + the local-day boundary (F1) ──────────────────────────────────────
test('status is DERIVED from the journal + due date, never a stored field', () => {
  const b = book();
  const inv = invoice({ due: '2026-05-15' });
  // before issue, nothing outstanding and not yet due → unpaid (not paid: total>0 but outstanding is 0 only when AR cleared)
  // issue it:
  post(b, invoiceIssueEntry(inv));
  assert.equal(invoiceStatus(inv, '2026-05-10', b.journal), 'unpaid', 'before the due date and unpaid → unpaid');
  assert.equal(invoiceStatus(inv, '2026-05-16', b.journal), 'overdue', 'past the due date and unpaid → overdue');
  assert.equal(invoiceStatus(inv, '2026-05-15', b.journal), 'unpaid', 'ON the due date it is not YET overdue');
  // a STORED status field must be ignored — feed a lying cache and prove the derivation wins
  assert.equal(invoiceStatus({ ...inv, status: 'paid' }, '2026-05-16', b.journal), 'overdue',
    'a stored status:"paid" must NOT be trusted — status is derived from the ledger');
});

test('the overdue boundary is the LOCAL day, not UTC (F1): due yesterday-local is overdue the moment it is today-local', () => {
  const inv = invoice({ due: '2027-04-05' });
  // local clock has ticked to 2027-04-06 while UTC is still 2027-04-05.
  assert.equal(invoiceStatus(inv, '2027-04-06', []), 'overdue', 'with the LOCAL day it is overdue');
  // CONTROL: judged by the UTC day (still the prior day), the same invoice would NOT yet be overdue.
  assert.equal(invoiceStatus(inv, '2027-04-05', []), 'unpaid', 'with the UTC day it would wrongly read not-overdue');
});

// ── settlement clears AR ─────────────────────────────────────────────────────────────────────────────────
test('settlement posts dr bank / cr AR, clears the receivable, and credits NO fund a second time', () => {
  const b = book();
  const inv = invoice();
  post(b, invoiceIssueEntry(inv));
  const fundsAfterIssue = fundBalances(b).find(f => f.fund === 'general').balance;
  const settle = post(b, invoiceSettlementEntry(inv, { date: '2026-05-20' }));
  const bank = settle.postings.find(p => p.account === 'bank'), ar = settle.postings.find(p => p.account === AR_ACCT);
  assert.ok(bank.dir === 'dr' && ar.dir === 'cr' && bank.amount === 9500 && ar.amount === 9500, 'settlement must be dr bank / cr AR for the amount');
  assert.equal(settle.postings.some(p => p.fund), false, 'settlement must touch NO fund — the income was recognised at issue');
  assert.equal(invoiceOutstanding('inv1', b.journal), 0, 'the receivable must be cleared');
  assert.equal(invoiceStatus(inv, '2026-05-30', b.journal), 'paid', 'a settled invoice is paid even past its due date');
  assert.equal(fundBalances(b).find(f => f.fund === 'general').balance, fundsAfterIssue, 'the fund balance must not change on settlement');
  assert.deepEqual(check(b), { ok: true, errors: [] });
});

test('a PART payment leaves the invoice unpaid until AR nets to zero', () => {
  const b = book();
  const inv = invoice();
  post(b, invoiceIssueEntry(inv));
  post(b, invoiceSettlementEntry(inv, { date: '2026-05-20', amount: 4000 }));   // half
  assert.equal(invoiceOutstanding('inv1', b.journal), 5500, '£55 should still be receivable');
  assert.equal(invoiceStatus(inv, '2026-05-10', b.journal), 'unpaid');
  post(b, invoiceSettlementEntry(inv, { date: '2026-05-25', amount: 5500 }));   // the rest
  assert.equal(invoiceStatus(inv, '2026-05-10', b.journal), 'paid');
});

// ── credit notes (AUDIT-PHASE-5 F4) ──────────────────────────────────────────────────────────────────────
test('a FULL credit note is its OWN entry (dr income / cr AR), nets AR to zero, and never edits the original', () => {
  const b = book();
  const inv = invoice();
  const issue = post(b, invoiceIssueEntry(inv));
  const beforeMemo = issue.memo, beforeSeq = issue.seq, beforePostings = JSON.stringify(issue.postings);
  const cn = post(b, creditNoteEntry(inv, { id: 'cn1', lines: inv.lines }, { date: '2026-05-10' }));
  // the credit entry reverses: dr the income account, cr AR
  assert.ok(cn.postings.find(p => p.account === 'hire' && p.dir === 'dr'), 'the credit note must debit the income account (take the income back)');
  assert.ok(cn.postings.find(p => p.account === AR_ACCT && p.dir === 'cr'), 'the credit note must credit AR (reduce the receivable)');
  assert.equal(cn.invoice, 'inv1', 'the credit note entry must be tagged with the ORIGINAL invoice id so it nets against it');
  assert.equal(invoiceOutstanding('inv1', b.journal), 0, 'a full credit note must net the receivable to zero');
  // the original entry is untouched — append-only
  const stillIssue = b.journal.find(e => e.seq === beforeSeq);
  assert.equal(stillIssue.memo, beforeMemo, 'the original invoice entry must not be edited');
  assert.equal(JSON.stringify(stillIssue.postings), beforePostings, 'the original postings must be unchanged');
  assert.deepEqual(check(b), { ok: true, errors: [] });
});

test('a PARTIAL credit note is a hand-built balanced entry crediting only the disputed lines', () => {
  const b = book();
  const inv = invoice({ lines: [
    { desc: 'Hall hire', account: 'hire', fund: 'general', amount: 9500 },
    { desc: 'Extra cleaning', account: 'hire', fund: 'general', amount: 2000 },
  ] });
  post(b, invoiceIssueEntry(inv));   // outstanding 11500
  post(b, creditNoteEntry(inv, { id: 'cn1', lines: [{ desc: 'Extra cleaning waived', account: 'hire', fund: 'general', amount: 2000 }] }, { date: '2026-05-10' }));
  assert.equal(invoiceOutstanding('inv1', b.journal), 9500, 'only the £20 credited line should come off the receivable');
  assert.equal(invoiceStatus(inv, '2026-05-10', b.journal), 'unpaid', 'a partial credit does not pay the invoice');
  assert.deepEqual(check(b), { ok: true, errors: [] });
});

// ── openInvoices (list + a basis for auto-match) ─────────────────────────────────────────────────────────
test('openInvoices returns the not-paid invoices with their derived status + outstanding, excluding credit-note docs', () => {
  const b = book();
  const paid = invoice({ id: 'p', number: 'A', due: '2026-05-15' });
  const owing = invoice({ id: 'o', number: 'B', due: '2026-05-15' });
  post(b, invoiceIssueEntry(paid)); post(b, invoiceSettlementEntry(paid, { date: '2026-05-20' }));
  post(b, invoiceIssueEntry(owing));
  const docs = [paid, owing, { id: 'cn', number: 'B-CN', credit: true, lines: owing.lines }];
  const open = openInvoices(docs, b.journal, '2026-05-20');
  assert.equal(open.length, 1, 'only the unpaid non-credit invoice should be open');
  assert.equal(open[0].invoice.id, 'o');
  assert.equal(open[0].status, 'overdue');
  assert.equal(open[0].outstanding, 9500);
});

// ── printable invoice (reuses saveConsoleFile on the console; pure HTML here) ─────────────────────────────
test('invoiceHtml renders the lines, total and derived status into self-contained HTML', () => {
  const html = invoiceHtml(invoice(), { churchName: 'St Test', currency: 'GBP', decimals: 2, status: 'overdue', generatedAt: '2026-05-16' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Hall hire/);
  assert.match(html, /£95\.00/, 'the total/line money must render in major units with the symbol');
  assert.match(html, /OVERDUE/, 'the derived status must be stamped on the document');
  assert.match(html, /St Test/);
});

// ── invoiceStatuses (batch, one-pass) must NEVER drift from invoiceStatus (single-item) ──────────────────────
// The screen renders a status badge per invoice. invoiceStatuses() does ONE journal pass for the whole list
// instead of invoiceStatus()'s per-row walk (the perf fix); if the two ever disagree the badge lies. This seeds
// a book with every lifecycle state at once and asserts the batch Map matches the canonical single-item fn.
test('invoiceStatuses(batch) === invoiceStatus(per-invoice) for every invoice over a seeded multi-entry book', () => {
  const b = book();
  const today = '2026-06-01';
  const paid    = invoice({ id: 'ip', due: '2026-05-31', lines: [{ desc: 'Hall', account: 'hire', fund: 'general', amount: 9500 }] });
  const overdue = invoice({ id: 'io', due: '2026-05-01', lines: [{ desc: 'Hall', account: 'hire', fund: 'general', amount: 4200 }] });
  const unpaid  = invoice({ id: 'iu', due: '2026-12-31', lines: [{ desc: 'Hall', account: 'hire', fund: 'general', amount: 3100 }] });
  const unissued = invoice({ id: 'ix', due: '2026-12-31', lines: [{ desc: 'Draft', account: 'hire', fund: 'general', amount: 777 }] });   // never issued → never "paid" (future due so it reads unpaid, not overdue)
  // Issue paid + overdue + unpaid (unissued is deliberately NOT posted), then fully settle only `paid`.
  post(b, invoiceIssueEntry(paid));
  post(b, invoiceIssueEntry(overdue));
  post(b, invoiceIssueEntry(unpaid));
  post(b, invoiceSettlementEntry(paid, { amount: invoiceTotal(paid) }));
  const invoices = [paid, overdue, unpaid, unissued];
  const map = invoiceStatuses(invoices, b.journal, today);
  for (const inv of invoices) {
    assert.equal(map.get(inv.id), invoiceStatus(inv, today, b.journal), 'batch status drifted from invoiceStatus for ' + inv.id);
  }
  // and the states are the expected ones (so the test is not vacuously "both wrong the same way")
  assert.equal(map.get('ip'), 'paid');
  assert.equal(map.get('io'), 'overdue');
  assert.equal(map.get('iu'), 'unpaid');
  assert.equal(map.get('ix'), 'unpaid', 'a never-issued invoice (no AR debit) must not read as paid on a zero net');
});
