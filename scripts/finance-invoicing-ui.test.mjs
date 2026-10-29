// THE INVOICING UI IS ACTUALLY ON THE SCREEN (Phase 5, point-of-use — CLAUDE.md rules 1 & 3).
//   Run: node --test scripts/finance-invoicing-ui.test.mjs
//
// Every assertion renders the REAL DashFinanceBook / its dialogs through scripts/console-screens.mjs (the
// console compiled the way the phone loads it) and reads the RENDERED TREE — never the .jsx text, so a
// `false &&` in front of a control cannot satisfy it. Delete the invoice editor, a status badge, the
// credit-note control or the contact form from the screen and the matching test fails.
//
// The engine half (balanced postings, derived status, credit-note reversal, AR idempotency) is
// finance-invoice.test.mjs. This proves the controls are REACHABLE and that the OVERDUE badge is driven by the
// LOCAL-day clock the screen injects (booksTodayISO, sliced from the shipped source and run under a faked
// prior-day-in-UTC clock — the fiscal-year off-by-one guarded by finance-this-year-starts-on-the-local-day).
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook, BooksInvoiceEdit, BooksContact, booksTodayISO).
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
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reconcile, ..._reports, ..._invoice };

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  if (d.t === 'invoice') return { ...d, id: 'invoice:' + d.id };
  if (d.t === 'contact') return { ...d, id: 'contact:' + d.id };
  return d;
});

function setup() {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, BooksInvoiceEdit, BooksContact }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const drawComp = (name, props) => { fr.reset(); const t = mods[name](props); fr.flush(); return t; };
  const all = () => nodes(tree);
  const button = (label) => all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(items); draw(); };
  const statusNode = () => all().find(n => n.props && n.props['data-invoice-status']);
  return { fr, draw, drawComp, all, button, click, feedItems, statusNode, get tree() { return tree; } };
}

// A minimal book carrying an income account, for the dialogs rendered on their own.
function editorBook() {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'hire', code: '4100', name: 'Facility hire', type: 'income' });
  return b;
}

// A book carrying the reserved AR account + one ISSUED invoice; `settle` adds a settlement so the invoice reads paid.
function seed({ due = '2000-01-01', settle = false } = {}) {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'hire', code: '4100', name: 'Facility hire', type: 'income' });
  FL.addAccount(b, { id: FL.AR_ACCT, code: FL.AR_ACCOUNT.code, name: FL.AR_ACCOUNT.name, type: 'asset' });
  const inv = { id: 'inv1', number: '2026-014', contact: 'Scouts', issued: '2026-05-01', due, lines: [{ desc: 'Hall hire', account: 'hire', fund: 'general', amount: 9500 }] };
  FL.post(b, FL.invoiceIssueEntry(inv));
  if (settle) FL.post(b, FL.invoiceSettlementEntry(inv, { date: '2026-05-20' }));
  const docs = toItems(FL.bookToDocs(b));
  docs.push({ t: 'invoice', id: inv.id, number: inv.number, contact: inv.contact, lines: inv.lines, issued: inv.issued, due: inv.due, id: 'invoice:' + inv.id });
  return docs;
}

test('the Invoices panel shows an invoice with a status badge, a Mark paid control and a Credit note control', () => {
  const h = setup();
  h.draw();
  h.feedItems(seed({ due: '2000-01-01' }));   // a long-overdue, unpaid invoice
  h.click('Invoices');                          // open the collapsible
  assert.ok(h.button('New invoice'), 'the "New invoice" control is not on the screen');
  assert.ok(h.button('Add contact'), 'the "Add contact" control is not on the screen');
  const joined = texts(h.tree).join(' ');
  assert.ok(/2026-014/.test(joined), 'the invoice number is not on the screen');
  assert.ok(/£95\.00/.test(joined), 'the invoice total is not on the screen');
  const badge = h.statusNode();
  assert.ok(badge, 'no invoice status badge rendered (a data-invoice-status node) — delete the badge and this fails');
  assert.equal(badge.props['data-invoice-status'], 'overdue', 'a past-due, unpaid invoice must badge OVERDUE');
  assert.ok(h.button('Mark paid'), 'the Mark paid (manual settlement) control is not on the screen');
  assert.ok(h.button('Credit note'), 'the credit-note control is not on the screen');
});

test('a settled invoice badges PAID on the screen (derived from the journal)', () => {
  const h = setup();
  h.draw();
  h.feedItems(seed({ due: '2000-01-01', settle: true }));
  h.click('Invoices');
  const badge = h.statusNode();
  assert.ok(badge, 'no status badge rendered');
  assert.equal(badge.props['data-invoice-status'], 'paid', 'an invoice with a settlement entry must badge PAID');
  assert.ok(!h.button('Mark paid'), 'a paid invoice must not still offer Mark paid');
});

test('the New-invoice editor is a real dialog with a line description, an income category, an amount and an Issue control', () => {
  const h = setup();
  const dialog = h.drawComp('BooksInvoiceEdit', { book: editorBook(), contacts: [], onIssue() {}, onClose() {} });
  assert.ok(nodes(dialog).some(n => n.props && n.props.role === 'dialog'), 'the invoice editor did not render a dialog');
  const inputs = nodes(dialog).filter(n => n.type === 'input');
  assert.ok(inputs.some(i => /description/i.test((i.props && i.props.placeholder) || '')), 'no line-description field on the invoice editor');
  assert.ok(inputs.some(i => /0\.00/.test((i.props && i.props.placeholder) || '')), 'no amount field on the invoice editor');
  const selects = nodes(dialog).filter(n => n.type === 'select');
  assert.ok(selects.length >= 1, 'no income-category picker on the invoice editor');
  const optText = selects.flatMap(s => nodes(s).filter(o => o.type === 'option').map(o => texts(o).join(''))).join(' ');
  assert.ok(/Facility hire/.test(optText), 'the income category is not offered in the editor');
  assert.ok(nodes(dialog).some(n => n.type === 'button' && /issue invoice/i.test(texts(n).join(' '))), 'no "Issue invoice" control on the editor');
});

test('the Add-contact form is a real dialog with a name field and a Save control', () => {
  const h = setup();
  const dialog = h.drawComp('BooksContact', { initial: null, onSave() {}, onClose() {} });
  assert.ok(nodes(dialog).some(n => n.props && n.props.role === 'dialog'), 'the contact form did not render a dialog');
  const inputs = nodes(dialog).filter(n => n.type === 'input');
  assert.ok(inputs.some(i => /name/i.test((i.props && i.props.placeholder) || '')), 'no contact name field on the form');
  assert.ok(nodes(dialog).some(n => n.type === 'button' && /add contact|save/i.test(texts(n).join(' '))), 'no Save/Add control on the contact form');
});

// ── the OVERDUE badge boundary is the LOCAL day, not UTC (AUDIT-PHASE-5 F1) ──────────────────────────────
// The badge reads F.invoiceStatus(inv, booksTodayISO(), book.journal). booksTodayISO() is the console's
// local-day helper; prove (a) it answers the LOCAL calendar day even when UTC is still the day before, and
// (b) the status the screen then derives flips to overdue on the local day — not a day late on the UTC day.
const FIN = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');
const TODAY = fnBody(FIN, 'function booksTodayISO()');
function booksTodayISO(localDay) {
  const [y, mo, da] = localDay.split('-').map(Number);
  // UTC is the PRIOR day; only getFullYear/getMonth/getDate (LOCAL accessors) yield today, toISOString would not.
  class FakeDate { getFullYear() { return y; } getMonth() { return mo - 1; } getDate() { return da; } toISOString() { return '2027-04-05T23:30:00.000Z'; } }
  return new Function('Date', `${TODAY}\nreturn booksTodayISO();`)(FakeDate);
}

test('booksTodayISO answers the LOCAL day (00:30 on 6 Apr, UTC still 5 Apr) — the clock the badge injects', () => {
  assert.equal(booksTodayISO('2027-04-06'), '2027-04-06', 'the injected clock read the UTC day, not the local day');
});

test('an invoice due yesterday-local badges OVERDUE the moment it is today-local, where the UTC day would not', () => {
  const inv = { id: 'i', due: '2027-04-05', lines: [{ account: 'hire', amount: 9500 }] };
  const issued = [{ invoice: 'i', postings: [{ account: FL.AR_ACCT, dir: 'dr', amount: 9500 }] }];
  assert.equal(FL.invoiceStatus(inv, booksTodayISO('2027-04-06'), issued), 'overdue', 'with the local day the badge must read overdue');
  assert.equal(FL.invoiceStatus(inv, '2027-04-05', issued), 'unpaid', 'CONTROL: judged by the UTC day it would still read unpaid');
});
