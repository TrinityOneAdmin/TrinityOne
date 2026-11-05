// src/finance-bill.mjs — TrinityOne Finance, Phase 6: Bills & approvals / Accounts Payable (pure).
// No I/O, no browser, no relay, NO `Date` — so the bill model, its DERIVED status, its approval guard and its
// journal postings can be proven in node and ship inside window.FinanceLedger (added to finance-bundle.mjs).
// It MIRRORS finance-invoice.mjs (Accounts Receivable): a bill is the payable mirror of an invoice.
//
// WHAT RIDES WHERE. A bill is metadata (number, supplier, line items, dates, light-approval flag) kept in a
// REPLACEABLE finance/bill:<id> doc. The MONEY rides the append-only journal (finance-ledger.mjs), never a
// field on the bill doc — exactly as invoices do, with the ledger entries ACCRUED through a reserved Accounts-
// Payable liability account (the payable mirror of the invoice's reserved AR asset):
//   · RECEIVE  dr expense account(s)+fund(s)  / cr Accounts-Payable        — ACCRUAL: the expense (and the fund
//              it draws on) is recognised when the bill is RECORDED, not when it is paid. fundBalances() debits
//              the fund here; the later payment moves liability→asset with NO second fund posting (no double
//              count), the exact mirror of invoiceSettlementEntry's asset→asset.
//   · PAYMENT  dr Accounts-Payable            / cr bank (asset)            — the payable is cleared. GUARDED:
//              billPaymentEntry THROWS unless the bill is approved, so neither the manual Mark-paid path NOR a
//              Phase-3 bank-line auto-match can pay a bill before it is approved (AUDIT-PHASE-6 F2).
// Every entry carries the opaque bill id in the journal entry's `bill` field (threaded through all four
// serializers — post/applyEntry, bookToDocs, pubEntry, finItemToDoc), so "is THIS bill paid?" is answered by
// netting the AP postings tagged with it — the subledger link, mirroring the invoice `invoice` tag.
//
// STATUS IS DERIVED, never a trusted stored field (mirroring invoiceStatus): paid/overdue/unpaid is computed
// from (a) the journal (is the AP tagged to this bill cleared?) and (b) the due date vs an INJECTED local-day
// ISO string the caller passes (booksTodayISO()). This module NEVER calls `new Date()` — a pure module that
// read the clock would reintroduce the UTC off-by-one guarded by finance-this-year-starts-on-the-local-day.
//
// APPROVAL is a FINANCE-capability question and nothing wider (DOMAIN capability-scope note; CLAUDE.md rule 10):
// who may approve is decided at the relay by stewardCan(approver, cp, 'finance') — a care/safeguarding/members
// steward cannot. This module only decides WHETHER a bill is approved, in one of two owner-chosen modes:
//   · 'light' (default): approved iff the REPLACEABLE bill doc carries an approval field (bill.approved). Any
//     finance steward may set it — convenient, not tamper-evident (a later finance writer could overwrite it).
//   · 'dual' (opt-in, features.billApproval===true): approved iff a SEPARATE approver-SIGNED approval doc refers
//     to this bill. The relay binds the approver to the signer (d=finance/billapproval:<billId>:<approverhex>,
//     the check-in-arrival house pattern), so a writer cannot forge another steward's approval. `approvals` is
//     the list of those docs the console read back, each { bill, approver } — approver comes from the d-tag.
//
// MONEY is INTEGER minor units, matching finance-ledger.mjs. Line amounts are positive integer minor units.

// ── the reserved Accounts-Payable account (the payable mirror of finance-invoice's AR) ──────────────────────
// A RESERVED, idempotent id (the Phase-1 fund-transfer / Phase-5 AR pattern): the console publishes
// finance/account:<id> publish-if-absent and addAccount()s it locally, so an un-upgraded console can still
// rebuild a book that contains payables. It is EXEMPT from Phase-1 archive/rename/type-change (the chart panel
// hides it, like fund-transfer and AR) and must be a LIABILITY — a cr posting to an income/expense account
// would be wrong. Its id is a plain slug, so a treasurer who hand-made an account named "Accounts payable"
// would collide on the slug; the console therefore NEVER blind-addAccount()s it (addAccount throws on a
// duplicate) — it looks the reserved id up, asserts the type, and creates only if absent (assertApAccount).
export const AP_ACCT = 'accounts-payable';
export const AP_ACCOUNT = Object.freeze({ id: AP_ACCT, code: '2100', name: 'Accounts payable', type: 'liability' });

// Is the reserved AP account present AND the right type? Returns true if present+liability, false if absent.
// THROWS if present but not a liability (a hand-made account colliding on the slug) — the caller must not post
// to it. Pure, so the console's publish-if-absent path and the node tests share one definition.
export function assertApAccount(book) {
  const a = book && book.accounts && typeof book.accounts.get === 'function' ? book.accounts.get(AP_ACCT) : null;
  if (!a) return false;
  if (a.type !== 'liability') throw new Error('reserved account ' + AP_ACCT + ' must be a liability (found ' + a.type + ')');
  return true;
}

// ── the bill model ──────────────────────────────────────────────────────────────────────────────────────────
// bill = { id, number, supplier, lines:[{ desc, amount(+int minor), account(expense id), fund? }], received, due,
//          by?, approved? }
// `id` is OPAQUE/random (the caller mints it, never the human reference — a REPLACEABLE doc, so two authorised
// writers must not collide on a shared value). `number` is the human-facing field (the supplier's invoice no.).
// `supplier` is the supplier NAME as a plain field (mirroring the invoice's `contact`), drawn from a reused
// finance/contact:<id> record; stored as the name so the bill reads correctly even if the contact is edited or
// removed. `by` is WHO recorded the bill (the recorder's pubkey, set at save) — the SEPARATION-OF-DUTIES anchor
// for dual mode: an approval only counts if its approver differs from `by` (you cannot approve your own bill).
// `approved` is the LIGHT-mode flag ({ by, ts }); in dual mode it is ignored (approvals ride the signed doc).
// STATUS never reads `approved` — approval gates PAYMENT, not the paid/unpaid/overdue display.
const posLines = (bill) => (bill && Array.isArray(bill.lines) ? bill.lines : [])
  .filter(l => l && Number.isSafeInteger(l.amount) && l.amount > 0);

export function billTotal(bill) {
  return posLines(bill).reduce((s, l) => s + l.amount, 0);
}

const memoFor = (bill, lead) => {
  const n = bill && bill.number ? ' ' + bill.number : '';
  const who = bill && bill.supplier ? ' — ' + bill.supplier : '';
  return (lead + n + who).trim();
};

// The RECEIVE journal entry: dr each line's expense account+fund / cr AP (total). Balanced Σdr==Σcr. Tagged with
// the bill id so the payment can be netted against it. Throws on a bill with no positive line (the engine's
// balance check is the backstop, but a clear message beats "needs at least two postings"). No approval needed to
// RECORD a bill — only to PAY it.
export function billReceiveEntry(bill, { date } = {}) {
  const lines = posLines(bill);
  if (!lines.length) throw new Error('a bill needs at least one line with a positive amount');
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const postings = [
    ...lines.map(l => ({ account: l.account, fund: l.fund || 'general', dir: 'dr', amount: l.amount })),
    { account: AP_ACCT, dir: 'cr', amount: total },
  ];
  return { date: date || (bill && bill.received) || '', memo: memoFor(bill, 'Bill'), bill: bill.id, postings };
}

// PAYMENT: dr AP / cr bank for `amount` (default the whole bill total). liability→asset, NO fund posting — the
// expense was recognised at receive, so paying it must not touch a fund balance again (the mirror of invoice
// settlement). Tagged with the bill id. THE APPROVAL GUARD lives here, in the one place both payment routes pass
// through: it THROWS unless `approved === true`, so the manual Mark-paid AND any Phase-3 auto-match are refused
// on an unapproved bill (AUDIT-PHASE-6 F2). The caller computes `approved` via isBillApproved() below.
export function billPaymentEntry(bill, { date, amount, account = 'bank', approved } = {}) {
  if (approved !== true) throw new Error('a bill cannot be paid before it is approved');
  const amt = Number.isSafeInteger(amount) && amount > 0 ? amount : billTotal(bill);
  if (!(amt > 0)) throw new Error('a payment needs a positive amount');
  return {
    date: date || '', memo: memoFor(bill, 'Payment of bill'), bill: bill.id,
    postings: [{ account: AP_ACCT, dir: 'dr', amount: amt }, { account, dir: 'cr', amount: amt }],
  };
}

// The AP still booked against a bill: Σ (cr − dr) over postings to AP in journal entries tagged with this bill
// id. Receive CREDITS AP (+total owed), payment DEBITS it (−). <= 0 means fully paid. Integer minor units. This
// is the subledger balance the status derives from — never a stored field. (Sign is mirrored from
// invoiceOutstanding: AP is a liability, so a credit is "still owed", where AR is an asset and a debit is.)
export function billOutstanding(billId, journalEntries) {
  let bal = 0;
  for (const e of (journalEntries || [])) {
    if (!e || e.bill !== billId) continue;
    for (const p of (e.postings || [])) if (p.account === AP_ACCT) bal += (p.dir === 'cr' ? p.amount : -p.amount);
  }
  return bal;
}

// DERIVED status — 'paid' | 'overdue' | 'unpaid'. `todayLocalISO` is an INJECTED 'YYYY-MM-DD' local-day string
// (the caller passes booksTodayISO()); this module never reads the clock. A bill whose AP nets to zero (or less)
// AND was actually recorded (has an AP credit) is paid; otherwise it is overdue once its due date is strictly
// BEFORE today (string compare of ISO local days), else unpaid. Split so a bill that was never recorded (no AP
// credit at all) is NOT mistaken for paid just because its net is zero — the mirror of invoiceStatus.
export function billStatus(bill, todayLocalISO, journalEntries) {
  let crAP = 0, drAP = 0;
  const id = bill && bill.id;
  for (const e of (journalEntries || [])) {
    if (!e || e.bill !== id) continue;
    for (const p of (e.postings || [])) if (p.account === AP_ACCT) { if (p.dir === 'cr') crAP += p.amount; else drAP += p.amount; }
  }
  const recorded = crAP > 0;
  if (recorded && (crAP - drAP) <= 0) return 'paid';
  const due = bill && bill.due;
  if (due && todayLocalISO && String(due) < String(todayLocalISO)) return 'overdue';
  return 'unpaid';
}

// BATCH status for a WHOLE list of bills in ONE journal pass — the mirror of invoiceStatuses. The screen renders
// a status badge per row (app/stew-finance.jsx Bills tab), and calling billStatus() per row re-walks the entire
// journal each time: O(bills × journal). This pre-aggregates Σ AP credit/debit per bill id in a single pass, then
// derives each status with the IDENTICAL rule as billStatus — so it is O(journal + bills). The two share one
// definition: finance-bill.test.mjs asserts billStatuses(...).get(b.id) === billStatus(b, ...) over a seeded
// multi-entry book, so this batch path can never drift from the canonical single-item version. Returns
// Map(billId -> 'paid'|'overdue'|'unpaid').
export function billStatuses(bills, journalEntries, todayLocalISO) {
  const ap = new Map();   // billId -> { cr, dr } over AP postings, from a single journal pass
  for (const e of (journalEntries || [])) {
    if (!e || e.bill == null) continue;
    let a = ap.get(e.bill); if (!a) { a = { cr: 0, dr: 0 }; ap.set(e.bill, a); }
    for (const p of (e.postings || [])) if (p.account === AP_ACCT) { if (p.dir === 'cr') a.cr += p.amount; else a.dr += p.amount; }
  }
  const out = new Map();
  for (const b of (bills || [])) {
    if (!b) continue;
    const a = ap.get(b.id) || { cr: 0, dr: 0 };
    const recorded = a.cr > 0;   // same split as billStatus: a never-recorded bill is never "paid" on a zero net
    let status;
    if (recorded && (a.cr - a.dr) <= 0) status = 'paid';
    else if (b.due && todayLocalISO && String(b.due) < String(todayLocalISO)) status = 'overdue';
    else status = 'unpaid';
    out.set(b.id, status);
  }
  return out;
}

// ── "was this bill ever RECORDED?" — the same `recorded` split billStatus/billStatuses use, exposed PURELY ───
// A bill's money rides the journal, never the doc. An OLD bill whose RECEIVE entry is absent from the ledger (it
// was recorded on an earlier build that never posted it) has NO AP credit tagged to it, so `recorded` is false —
// and such a bill can never derive 'paid' (billStatus splits on exactly this). The screen must not offer Mark
// paid / Approve for it: a payment would post against nothing. These two expose that same `recorded = crAP > 0`
// test so the Bills tab can hide those controls and tell the truth. IDENTICAL definition to billStatus's
// `recorded` — finance-bill.test.mjs asserts billsNeedingEntry(...).has(id) === !billRecorded(b, journal) so they
// can never drift. Pure, no clock, no I/O; reach window.FinanceLedger via finance-bundle's `export *`.
export function billRecorded(bill, journalEntries) {
  let crAP = 0;
  const id = bill && bill.id;
  for (const e of (journalEntries || [])) {
    if (!e || e.bill !== id) continue;
    for (const p of (e.postings || [])) if (p.account === AP_ACCT && p.dir === 'cr') crAP += p.amount;
  }
  return crAP > 0;   // same split as billStatus: an AP credit is the mark that the bill was actually received
}

// BATCH form for a WHOLE list in ONE journal pass (mirroring billStatuses' aggregation): the Set of bill ids that
// were NOT recorded (no AP credit tagged to them). For every bill: has(b.id) === !billRecorded(b, journal).
export function billsNeedingEntry(bills, journalEntries) {
  const crByBill = new Map();   // billId -> Σ AP credit, from a single journal pass
  for (const e of (journalEntries || [])) {
    if (!e || e.bill == null) continue;
    for (const p of (e.postings || [])) if (p.account === AP_ACCT && p.dir === 'cr') crByBill.set(e.bill, (crByBill.get(e.bill) || 0) + p.amount);
  }
  const out = new Set();
  for (const b of (bills || [])) {
    if (!b) continue;
    if (!((crByBill.get(b.id) || 0) > 0)) out.add(b.id);   // not recorded = no AP credit > 0
  }
  return out;
}

// ── approval: the state machine draft → approved → paid, decided PURELY ─────────────────────────────────────
// WHETHER a bill is approved, in the owner's chosen mode. Shared by the screen (to enable Mark-paid) and by the
// engine guard (billPaymentEntry takes the boolean this returns). WHO MAY approve is NOT decided here — that is
// the relay's stewardCan(..., 'finance') on the approval write, proven in finance-bill-approval-rule.test.mjs;
// this module never widens the finance capability. `mode` is 'light' (default) or 'dual' (opt-in).
//
// DUAL MODE ENFORCES SEPARATION OF DUTIES: an approval counts only when its approver (from the billapproval
// d-tag, which the relay binds to the signer) is DIFFERENT from `recordedBy` — the steward who recorded the
// bill cannot also approve it. `recordedBy` defaults to the bill's own `by` field, so a caller that passes only
// the bill still gets the separation. A church with a single finance steward therefore cannot reach "approved"
// in dual mode — that is INTENDED (they use the light default); there is deliberately no fallback. LIGHT mode is
// unchanged: a convenience flag on the bill doc, no separation, no tamper-evidence.
const _lc = (s) => String(s || '').toLowerCase();
export function isBillApproved(bill, { mode = 'light', approvals = [], recordedBy } = {}) {
  if (!bill) return false;
  if (mode === 'dual') {
    const rec = _lc(recordedBy != null ? recordedBy : bill.by);
    return (approvals || []).some(a => a && a.bill === bill.id && a.approver && _lc(a.approver) !== rec);
  }
  return !!(bill.approved);
}

// The approver pubkeys on record for a bill — for display + the dual-control "a DIFFERENT person approved"
// reading. In dual mode these come from the signed approval docs (the d-tag, relay-bound to the signer), with
// the recorder's own self-approval EXCLUDED (it does not count toward approval, so it must not read as one); in
// light mode from the bill doc's approval field. A convenience over isBillApproved, never a second source of
// truth for the guard.
export function billApprovers(bill, { mode = 'light', approvals = [], recordedBy } = {}) {
  if (mode === 'dual') {
    const rec = _lc(recordedBy != null ? recordedBy : (bill && bill.by));
    return (approvals || []).filter(a => a && a.bill === (bill && bill.id) && a.approver && _lc(a.approver) !== rec).map(a => a.approver);
  }
  return (bill && bill.approved && bill.approved.by) ? [bill.approved.by] : [];
}

// The not-yet-paid bills, each with its DERIVED status + outstanding minor units, for the list and for a manual
// or auto-match pass (a bank payment can only settle an OPEN bill). Deliberately depends on NOTHING in Phase 3 —
// manual Mark-paid and this list work standalone; only auto-match would consult reconcile, and it too must route
// its settlement through billPaymentEntry so the approval guard still applies (AUDIT-PHASE-6 F2).
export function openBills(bills, journalEntries, todayLocalISO) {
  return (bills || [])
    .map(b => ({ bill: b, status: billStatus(b, todayLocalISO, journalEntries), outstanding: billOutstanding(b.id, journalEntries), total: billTotal(b) }))
    .filter(x => x.status !== 'paid');
}
