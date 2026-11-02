// src/finance-invoice.mjs — TrinityOne Finance, Phase 5: Invoicing / Accounts Receivable (pure).
// No I/O, no browser, no relay, NO `Date` — so the invoice model, its DERIVED status and its journal
// postings can be proven in node and ship inside window.FinanceLedger (added to finance-bundle.mjs).
//
// WHAT RIDES WHERE. An invoice is metadata (number, contact, line items, dates) kept in a REPLACEABLE
// finance/invoice:<id> doc. The MONEY rides the append-only journal (finance-ledger.mjs), exactly as every
// other finance movement does — never a field on the invoice doc:
//   · ISSUE       dr Accounts-Receivable (asset)  / cr income account(s)+fund(s)   — ACCRUAL: income is
//                 recognised when the invoice is RAISED, not when it is paid; fundBalances() credits the fund
//                 here and the later settlement moves asset→asset with no second fund credit (no double count).
//   · SETTLEMENT  dr bank (asset)                 / cr Accounts-Receivable         — the receivable is cleared.
//   · CREDIT NOTE dr income account(s)+fund(s)    / cr Accounts-Receivable         — a reversing balanced entry
//                 in its OWN doc; the original invoice is NEVER edited (append-only, CONTEXT constraint 3).
// Every one of those entries carries the opaque invoice id in the journal entry's `invoice` field, so "is
// THIS invoice paid?" is answered by netting the AR postings tagged with it — the subledger link.
//
// STATUS IS DERIVED, never a trusted stored field (AUDIT-PHASE-5 F5): paid/overdue/unpaid is computed from
// (a) the journal (is the AR tagged to this invoice cleared?) and (b) the due date vs an INJECTED local-day
// ISO string the caller passes (booksTodayISO()). This module NEVER calls `new Date()` — a pure module that
// read the clock would reintroduce the UTC off-by-one guarded by
// finance-this-year-starts-on-the-local-day.test.mjs. A stored `status` on the doc is a display cache only.
//
// MONEY is INTEGER minor units, matching finance-ledger.mjs. Line amounts are positive integer minor units.

// ── the reserved Accounts-Receivable account ─────────────────────────────────────────────────────────────
// A RESERVED, idempotent id (the Phase-1 fund-transfer pattern): the console publishes finance/account:<id>
// publish-if-absent and addAccount()s it locally, so an un-upgraded console can still rebuild a book that
// contains receivables. It is EXEMPT from Phase-1 archive/rename/type-change (the chart-management panel hides
// it, like fund-transfer) and must be an ASSET — a dr posting to an income/expense account would be wrong.
// Its id is a plain slug, so a treasurer who hand-made an account literally named "Accounts receivable" would
// collide on the slug; the console therefore NEVER blind-addAccount()s it (addAccount throws on a duplicate) —
// it looks the reserved id up, asserts the type, and creates only if absent (assertArAccount below).
export const AR_ACCT = 'accounts-receivable';
export const AR_ACCOUNT = Object.freeze({ id: AR_ACCT, code: '1100', name: 'Accounts receivable', type: 'asset' });

// Is the reserved AR account present AND the right type? Returns true if present+asset, false if absent.
// THROWS if present but not an asset (a hand-made account colliding on the slug) — the caller must not post to
// it. Pure, so the console's publish-if-absent path and the node tests share one definition.
export function assertArAccount(book) {
  const a = book && book.accounts && typeof book.accounts.get === 'function' ? book.accounts.get(AR_ACCT) : null;
  if (!a) return false;
  if (a.type !== 'asset') throw new Error('reserved account ' + AR_ACCT + ' must be an asset (found ' + a.type + ')');
  return true;
}

// ── the invoice model ────────────────────────────────────────────────────────────────────────────────────
// invoice = { id, number, contact, lines:[{ desc, amount(+int minor), account(income id), fund? }], issued, due }
// `id` is OPAQUE/random (the caller mints it, never the human invoice number — a REPLACEABLE doc, so two
// authorised writers must not collide on a shared value; AUDIT-PHASE-5 F2). `number` is the human-facing field.
const posLines = (invoice) => (invoice && Array.isArray(invoice.lines) ? invoice.lines : [])
  .filter(l => l && Number.isSafeInteger(l.amount) && l.amount > 0);

export function invoiceTotal(invoice) {
  return posLines(invoice).reduce((s, l) => s + l.amount, 0);
}

const memoFor = (invoice, lead) => {
  const n = invoice && invoice.number ? ' ' + invoice.number : '';
  const who = invoice && invoice.contact ? ' — ' + invoice.contact : '';
  return (lead + n + who).trim();
};

// The ISSUE journal entry: dr AR (total) / cr each line's income account+fund. Balanced Σdr==Σcr. Tagged with
// the invoice id so the settlement/credit-note can be netted against it. Throws on an invoice with no positive
// line (the engine's balance check is the backstop, but a clear message beats "needs at least two postings").
export function invoiceIssueEntry(invoice, { date } = {}) {
  const lines = posLines(invoice);
  if (!lines.length) throw new Error('an invoice needs at least one line with a positive amount');
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const postings = [
    { account: AR_ACCT, dir: 'dr', amount: total },
    ...lines.map(l => ({ account: l.account, fund: l.fund || 'general', dir: 'cr', amount: l.amount })),
  ];
  return { date: date || (invoice && invoice.issued) || '', memo: memoFor(invoice, 'Invoice'), invoice: invoice.id, postings };
}

// SETTLEMENT: dr bank / cr AR for `amount` (default the whole invoice total). asset→asset, NO fund posting —
// the income was recognised at issue, so settling it must not touch a fund balance again. Tagged with the
// invoice id. A partial payment passes a smaller `amount`; the invoice stays unpaid until AR nets to zero.
export function invoiceSettlementEntry(invoice, { date, amount, account = 'bank' } = {}) {
  const amt = Number.isSafeInteger(amount) && amount > 0 ? amount : invoiceTotal(invoice);
  if (!(amt > 0)) throw new Error('a settlement needs a positive amount');
  return {
    date: date || '', memo: memoFor(invoice, 'Payment of invoice'), invoice: invoice.id,
    postings: [{ account, dir: 'dr', amount: amt }, { account: AR_ACCT, dir: 'cr', amount: amt }],
  };
}

// A CREDIT NOTE is its OWN doc (creditNote: { id, lines:[{ desc, amount, account, fund }] }) + its OWN balanced
// journal entry — never an edit of the original invoice (append-only). The entry REVERSES the credited lines:
// dr the income account(s)/fund(s) (take the income back out) / cr AR (reduce the receivable), tagged with the
// ORIGINAL invoice id so it nets against that invoice. A FULL credit note passes every original line; a PARTIAL
// one passes only the disputed lines — reverse() in the ledger is full-only and would not carry the invoice
// tag, so a credit note is always this hand-built entry (AUDIT-PHASE-5 F4).
export function creditNoteEntry(invoice, creditNote, { date } = {}) {
  const lines = posLines(creditNote);
  if (!lines.length) throw new Error('a credit note needs at least one line with a positive amount');
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const postings = [
    ...lines.map(l => ({ account: l.account, fund: l.fund || 'general', dir: 'dr', amount: l.amount })),
    { account: AR_ACCT, dir: 'cr', amount: total },
  ];
  return { date: date || '', memo: memoFor(invoice, 'Credit note for invoice'), invoice: invoice.id, postings };
}

// The AR still booked against an invoice: Σ (dr − cr) over postings to AR in journal entries tagged with this
// invoice id. Issue DEBITS AR (+total), settlement and credit note CREDIT it (−). <= 0 means fully cleared.
// Integer minor units. This is the subledger balance the status derives from — never a stored field.
export function invoiceOutstanding(invoiceId, journalEntries) {
  let bal = 0;
  for (const e of (journalEntries || [])) {
    if (!e || e.invoice !== invoiceId) continue;
    for (const p of (e.postings || [])) if (p.account === AR_ACCT) bal += (p.dir === 'dr' ? p.amount : -p.amount);
  }
  return bal;
}

// DERIVED status — 'paid' | 'overdue' | 'unpaid'. `todayLocalISO` is an INJECTED 'YYYY-MM-DD' local-day string
// (the caller passes booksTodayISO()); this module never reads the clock. An invoice with outstanding AR of 0
// (or less) is paid; otherwise it is overdue once its due date is strictly BEFORE today (string compare of ISO
// local days, the same shape as finance-reconcile/statement), else unpaid.
export function invoiceStatus(invoice, todayLocalISO, journalEntries) {
  // Split the AR movement into the ISSUE debit and the settlement/credit-note credits, so an invoice that was
  // never issued (no AR debit at all) is NOT mistaken for paid just because its net is zero.
  let drAR = 0, crAR = 0;
  const id = invoice && invoice.id;
  for (const e of (journalEntries || [])) {
    if (!e || e.invoice !== id) continue;
    for (const p of (e.postings || [])) if (p.account === AR_ACCT) { if (p.dir === 'dr') drAR += p.amount; else crAR += p.amount; }
  }
  const issued = drAR > 0;
  if (issued && (drAR - crAR) <= 0) return 'paid';
  const due = invoice && invoice.due;
  if (due && todayLocalISO && String(due) < String(todayLocalISO)) return 'overdue';
  return 'unpaid';
}

// BATCH status for a WHOLE list of invoices in ONE journal pass — the screen renders a status badge per row
// (app/stew-finance.jsx Invoices tab), and calling invoiceStatus() per row re-walks the entire journal each
// time: O(invoices × journal). This pre-aggregates Σ AR debit/credit per invoice id in a single pass, then
// derives each status with the IDENTICAL rule as invoiceStatus — so it is O(journal + invoices). The two share
// one definition: finance-invoice.test.mjs asserts invoiceStatuses(...).get(inv.id) === invoiceStatus(inv, ...)
// over a seeded multi-entry book, so this batch path can never drift from the canonical single-item version.
// Returns Map(invoiceId -> 'paid'|'overdue'|'unpaid'). Credit-note docs get a status too (harmless — the screen
// renders 'credit' for inv.credit and never reads it).
export function invoiceStatuses(invoices, journalEntries, todayLocalISO) {
  const ar = new Map();   // invoiceId -> { dr, cr } over AR postings, from a single journal pass
  for (const e of (journalEntries || [])) {
    if (!e || e.invoice == null) continue;
    let a = ar.get(e.invoice); if (!a) { a = { dr: 0, cr: 0 }; ar.set(e.invoice, a); }
    for (const p of (e.postings || [])) if (p.account === AR_ACCT) { if (p.dir === 'dr') a.dr += p.amount; else a.cr += p.amount; }
  }
  const out = new Map();
  for (const inv of (invoices || [])) {
    if (!inv) continue;
    const a = ar.get(inv.id) || { dr: 0, cr: 0 };
    const issued = a.dr > 0;   // same split as invoiceStatus: a never-issued invoice is never "paid" on a zero net
    let status;
    if (issued && (a.dr - a.cr) <= 0) status = 'paid';
    else if (inv.due && todayLocalISO && String(inv.due) < String(todayLocalISO)) status = 'overdue';
    else status = 'unpaid';
    out.set(inv.id, status);
  }
  return out;
}

// The not-yet-paid invoices, each with its DERIVED status + outstanding minor units, for the list and for an
// auto-match pass (a bank line can only settle an OPEN invoice). Deliberately depends on nothing in Phase 3 —
// manual settlement and this list work standalone; auto-match is the only part that consults reconcile.
export function openInvoices(invoices, journalEntries, todayLocalISO) {
  return (invoices || [])
    .filter(inv => inv && !inv.credit)
    .map(inv => ({ invoice: inv, status: invoiceStatus(inv, todayLocalISO, journalEntries), outstanding: invoiceOutstanding(inv.id, journalEntries), total: invoiceTotal(inv) }))
    .filter(x => x.status !== 'paid');
}

// ── printable invoice (download → open → print / save as PDF, via the console's saveConsoleFile path) ───────
// Self-contained HTML, no external assets — the same approach as finance-statement.statementHtml. Kept pure
// and here (not in the console) so it is testable and the console just hands it to saveConsoleFile.
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SYM = { GBP: '£', USD: '$', EUR: '€', sats: '⚡' };
export function invoiceMoney(minor, currency = 'GBP', decimals = 2) {
  const sym = SYM[currency] || '';
  const s = (Number(minor) / Math.pow(10, decimals)).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency === 'sats' ? (s + ' ' + sym) : (sym + s);
}

export function invoiceHtml(invoice, { churchName = '', currency = 'GBP', decimals = 2, status = '', generatedAt = '', credit = false } = {}) {
  const f = m => invoiceMoney(m, currency, decimals);
  const lines = posLines(invoice);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const title = (credit || invoice.credit) ? 'Credit note' : 'Invoice';
  const rows = lines.map(l => `<tr><td>${esc(l.desc || '')}</td><td class="n">${f(l.amount)}</td></tr>`).join('');
  const statusLine = status ? `<div class="status status-${esc(status)}">${esc(status.toUpperCase())}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}${invoice.number ? ' ' + esc(invoice.number) : ''}</title>
<style>
  :root { --ink:#2b2723; --ink3:#8a8078; --line:#e7e0d5; }
  * { box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:var(--ink); max-width:640px; margin:0 auto; padding:40px 28px; line-height:1.5; }
  header { border-bottom:2px solid var(--ink); padding-bottom:14px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
  h1 { font-size:26px; margin:0 0 2px; }
  .from { color:var(--ink3); font-size:15px; font-weight:600; }
  .meta { text-align:right; font-size:13px; color:var(--ink3); }
  .meta b { color:var(--ink); }
  .status { display:inline-block; margin-top:6px; font-size:12px; font-weight:800; letter-spacing:.6px; padding:3px 9px; border-radius:7px; border:1px solid var(--line); }
  .status-paid { color:#2f7a44; } .status-overdue { color:#b4462f; } .status-unpaid { color:var(--ink3); }
  section { margin-top:26px; }
  .bill { font-size:13px; text-transform:uppercase; letter-spacing:.6px; color:var(--ink3); margin-bottom:4px; }
  table.t { width:100%; border-collapse:collapse; font-size:15px; margin-top:6px; }
  table.t td { padding:7px 0; border-bottom:1px solid var(--line); }
  table.t td.n { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  tr.tot td { font-weight:800; border-bottom:none; border-top:2px solid var(--ink); padding-top:9px; }
  footer { margin-top:34px; padding-top:12px; border-top:1px solid var(--line); color:var(--ink3); font-size:12px; }
  @media print { body { padding:0; } @page { margin:18mm; } }
</style></head><body>
<header>
  <div><h1>${esc(title)}</h1><div class="from">${esc(churchName)}</div>${statusLine}</div>
  <div class="meta">${invoice.number ? '<div><b>No.</b> ' + esc(invoice.number) + '</div>' : ''}${invoice.issued ? '<div><b>Issued</b> ' + esc(invoice.issued) + '</div>' : ''}${invoice.due ? '<div><b>Due</b> ' + esc(invoice.due) + '</div>' : ''}</div>
</header>
${invoice.contact ? `<section><div class="bill">Billed to</div><div>${esc(invoice.contact)}</div></section>` : ''}
<section><table class="t">${rows}<tr class="tot"><td>Total</td><td class="n">${f(total)}</td></tr></table></section>
<footer>${generatedAt ? 'Generated ' + esc(generatedAt) + ' · ' : ''}Prepared with TrinityOne.</footer>
</body></html>`;
}
