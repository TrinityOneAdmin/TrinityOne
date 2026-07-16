// src/finance-statement.mjs — build a shareable, period-bounded church financial statement from the ledger.
// Pure: no DOM, no relay, no I/O — so the projection + the text/HTML rendering can be proven in node and
// reused by the console UI, the "copy summary" path, and the printable/PDF download.
//
// A statement is AGGREGATE (totals by category + fund) — it deliberately carries NO member names, so unlike
// the roster it is safe to share outside the church once a treasurer has reviewed and released it.
// Everything is derived from the journal; money stays INTEGER minor units until the final format.

import { incomeExpenditure, balanceSheet } from './finance-ledger.mjs';

// The sections a church can tick on/off. `on` is the sensible default for a small church's report.
export const STATEMENT_SECTIONS = [
  { key: 'summary',  label: 'Summary — income, spending, surplus', on: true },
  { key: 'income',   label: 'Income by category',                 on: true },
  { key: 'spending', label: 'Spending by category',               on: true },
  { key: 'funds',    label: 'Fund balances (closing)',            on: true },
  { key: 'balance',  label: 'Balance sheet',                      on: false },
  { key: 'note',     label: "Treasurer's note",                   on: false },
];

const SYM = { GBP: '£', USD: '$', EUR: '€', sats: '⚡' };
export function fmtMoney(minor, currency = 'GBP', decimals = 2) {
  const sym = SYM[currency] || '';
  const s = (minor / Math.pow(10, decimals)).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency === 'sats' ? (s + ' ' + sym) : (sym + s);
}

// ── period helpers (ISO 'YYYY-MM-DD'; `to` is inclusive) ──
const pad = n => String(n).padStart(2, '0');
export function quarterRange(year, q) {                     // q = 1..4
  const startM = (q - 1) * 3 + 1, endM = startM + 2;
  const lastDay = new Date(Date.UTC(year, endM, 0)).getUTCDate();   // day 0 of next month = last day of endM
  return { from: `${year}-${pad(startM)}-01`, to: `${year}-${pad(endM)}-${pad(lastDay)}`, label: `Q${q} ${year}` };
}
export function yearRange(year) { return { from: `${year}-01-01`, to: `${year}-12-31`, label: `${year}` }; }
// A friendly label for an arbitrary range (used when the treasurer picks custom dates).
export function rangeLabel(from, to) { return (from || '…') + ' to ' + (to || '…'); }

// Closing fund balances AS OF a date (income to the fund − expenditure charged to it, up to and including `to`).
// The ledger's fundBalances() is all-time; a period statement needs the balance carried to the period end.
function closingFunds(book, to = '￿') {
  const bal = new Map();
  for (const e of book.journal) {
    if (e.date > to) continue;
    for (const p of e.postings) {
      if (!p.fund) continue;
      const a = book.accounts.get(p.account); if (!a) continue;
      if (a.type === 'income') bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === 'cr' ? p.amount : -p.amount));
      else if (a.type === 'expense') bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === 'dr' ? -p.amount : p.amount));
    }
  }
  return [...book.funds.values()].map(f => ({ fund: f.id, name: f.name, kind: f.kind, balance: bal.get(f.id) || 0 }))
    .sort((a, b) => (a.fund === 'general' ? -1 : b.fund === 'general' ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
}

// Build the statement MODEL (numbers only — rendering is separate). `sections` = array of enabled keys.
const validHex = c => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim())) ? c.trim() : '';
// only ever embed a data: image, never a remote URL (anti-beacon — mirrors the member app's safeImgUrl).
const validLogo = s => /^data:image\//i.test(String(s || '').trim()) ? String(s).trim() : '';
export function buildStatement(book, { from = '', to = '￿', title = '', note = '', sections = null, periodLabel = '', generatedAt = '', accent = '', logo = '' } = {}) {
  const enabled = sections || STATEMENT_SECTIONS.filter(s => s.on).map(s => s.key);
  const has = k => enabled.includes(k);
  const nameOf = id => (book.accounts.get(id) || {}).name || id;
  const ie = incomeExpenditure(book, { from: from || '', to: to || '￿' });
  const incomeRows = [], spendRows = [];
  for (const r of ie.byAccount) {
    const a = book.accounts.get(r.account); if (!a) continue;
    if (a.type === 'income' && r.amount !== 0) incomeRows.push({ account: r.account, name: nameOf(r.account), amount: r.amount });
    else if (a.type === 'expense' && r.amount !== 0) spendRows.push({ account: r.account, name: nameOf(r.account), amount: r.amount });
  }
  incomeRows.sort((a, b) => b.amount - a.amount);
  spendRows.sort((a, b) => b.amount - a.amount);

  const model = {
    title: title || 'Financial statement',
    periodLabel: periodLabel || rangeLabel(from, to),
    from: from || '', to: (to && to !== '￿') ? to : '',
    currency: book.baseCurrency, decimals: book.decimals,
    generatedAt, sections: enabled,
    accent: validHex(accent),   // the church's brand accent (hex) — colours the statement header/rules; '' → default
    logo: validLogo(logo),      // the church's dp/logo as a data: URI (letterhead); '' when none / not a data URI
  };
  if (has('summary'))  model.summary  = { income: ie.income, expenditure: ie.expenditure, surplus: ie.surplus };
  if (has('income'))   model.income   = incomeRows;
  if (has('spending')) model.spending = spendRows;
  if (has('funds'))    model.funds    = closingFunds(book, to || '￿');
  if (has('balance'))  model.balance  = balanceSheet(book, { asOf: to || '￿' });
  if (has('note') && note && note.trim()) model.note = note.trim();
  return model;
}

const kindTag = k => k === 'restricted' ? ' (restricted)' : k === 'designated' ? ' (designated)' : '';

// ── plain-text render (for "copy summary" → paste into email / WhatsApp; thin-pipe friendly) ──
export function statementText(model) {
  const f = m => fmtMoney(m, model.currency, model.decimals);
  const L = [];
  L.push(model.title);
  L.push(model.periodLabel);
  L.push('='.repeat(Math.max(model.title.length, model.periodLabel.length)));
  if (model.summary) {
    L.push('');
    L.push(`Total income:    ${f(model.summary.income)}`);
    L.push(`Total spending:  ${f(model.summary.expenditure)}`);
    L.push(`${model.summary.surplus < 0 ? 'Deficit' : 'Surplus'}:         ${f(model.summary.surplus)}`);
  }
  if (model.income && model.income.length) {
    L.push(''); L.push('INCOME');
    for (const r of model.income) L.push(`  ${r.name} — ${f(r.amount)}`);
  }
  if (model.spending && model.spending.length) {
    L.push(''); L.push('SPENDING');
    for (const r of model.spending) L.push(`  ${r.name} — ${f(r.amount)}`);
  }
  if (model.funds && model.funds.length) {
    L.push(''); L.push('FUNDS (closing balance)');
    for (const r of model.funds) L.push(`  ${r.name}${kindTag(r.kind)} — ${f(r.balance)}`);
  }
  if (model.balance) {
    L.push(''); L.push('BALANCE SHEET');
    L.push(`  Assets — ${f(model.balance.assets)}`);
    L.push(`  Liabilities — ${f(model.balance.liabilities)}`);
    L.push(`  Net funds — ${f(model.balance.funds)}`);
  }
  if (model.note) { L.push(''); L.push('NOTE'); L.push('  ' + model.note.replace(/\n/g, '\n  ')); }
  if (model.generatedAt) { L.push(''); L.push(`Generated ${model.generatedAt} · TrinityOne`); }
  return L.join('\n');
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── self-contained printable HTML (for the download → open/print → PDF). No external assets, print @page. ──
export function statementHtml(model) {
  const f = m => fmtMoney(m, model.currency, model.decimals);
  const rowsTable = (rows, valKey, tag) => `<table class="t">${rows.map(r =>
    `<tr><td>${esc(r.name)}${tag ? esc(kindTag(r.kind)) : ''}</td><td class="n">${f(r[valKey])}</td></tr>`).join('')}</table>`;
  const S = [];
  if (model.summary) S.push(`<section><h2>Summary</h2><table class="t">
    <tr><td>Total income</td><td class="n">${f(model.summary.income)}</td></tr>
    <tr><td>Total spending</td><td class="n">${f(model.summary.expenditure)}</td></tr>
    <tr class="tot"><td>${model.summary.surplus < 0 ? 'Deficit' : 'Surplus'}</td><td class="n">${f(model.summary.surplus)}</td></tr>
  </table></section>`);
  if (model.income && model.income.length)   S.push(`<section><h2>Income by category</h2>${rowsTable(model.income, 'amount')}</section>`);
  if (model.spending && model.spending.length) S.push(`<section><h2>Spending by category</h2>${rowsTable(model.spending, 'amount')}</section>`);
  if (model.funds && model.funds.length)     S.push(`<section><h2>Fund balances <span class="sub">(closing)</span></h2>${rowsTable(model.funds, 'balance', true)}</section>`);
  if (model.balance) S.push(`<section><h2>Balance sheet</h2><table class="t">
    <tr><td>Assets</td><td class="n">${f(model.balance.assets)}</td></tr>
    <tr><td>Liabilities</td><td class="n">${f(model.balance.liabilities)}</td></tr>
    <tr class="tot"><td>Net funds</td><td class="n">${f(model.balance.funds)}</td></tr>
  </table></section>`);
  if (model.note) S.push(`<section><h2>Note</h2><p class="note">${esc(model.note).replace(/\n/g, '<br>')}</p></section>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)} — ${esc(model.periodLabel)}</title>
<style>
  :root { --ink:#2b2723; --ink3:#8a8078; --line:#e7e0d5; --accent:${model.accent || '#2b2723'}; }
  * { box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:var(--ink); max-width:640px; margin:0 auto; padding:40px 28px; line-height:1.5; }
  header { border-bottom:2px solid var(--accent); padding-bottom:14px; margin-bottom:8px; }
  header img.logo { height:48px; width:auto; max-width:180px; display:block; margin:0 0 12px; object-fit:contain; }
  h1 { font-size:26px; margin:0 0 2px; color:var(--accent); }
  .period { color:var(--ink3); font-size:15px; font-weight:600; }
  section { margin-top:26px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.6px; color:var(--ink3); border-bottom:1px solid var(--line); padding-bottom:6px; margin:0 0 8px; }
  h2 .sub { text-transform:none; letter-spacing:0; font-weight:400; }
  table.t { width:100%; border-collapse:collapse; font-size:15px; }
  table.t td { padding:6px 0; border-bottom:1px solid var(--line); }
  table.t td.n { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  tr.tot td { font-weight:800; border-bottom:none; border-top:2px solid var(--accent); padding-top:9px; }
  .note { white-space:pre-wrap; }
  footer { margin-top:34px; padding-top:12px; border-top:1px solid var(--line); color:var(--ink3); font-size:12px; }
  @media print { body { padding:0; } @page { margin:18mm; } }
</style></head><body>
<header>${model.logo ? `<img class="logo" src="${esc(model.logo)}" alt="">` : ''}<h1>${esc(model.title)}</h1><div class="period">${esc(model.periodLabel)}</div></header>
${S.join('\n')}
<footer>${model.generatedAt ? 'Generated ' + esc(model.generatedAt) + ' · ' : ''}Prepared with TrinityOne — aggregate figures only.</footer>
</body></html>`;
}
