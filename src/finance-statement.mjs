// src/finance-statement.mjs — build a shareable, period-bounded church financial statement from the ledger.
// Pure: no DOM, no relay, no I/O — so the projection + the text/HTML rendering can be proven in node and
// reused by the console UI, the "copy summary" path, and the printable/PDF download.
//
// A statement is AGGREGATE (totals by category + fund) — it deliberately carries NO member names, so unlike
// the roster it is safe to share outside the church once a treasurer has reviewed and released it.
// Everything is derived from the journal; money stays INTEGER minor units until the final format.

import { incomeExpenditure, balanceSheet } from './finance-ledger.mjs';
import { fundMovements, receiptsAndPayments, givingByFund } from './finance-reports.mjs';

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
  // Unknown currency → show its CODE, never a bare number. A church may set a base currency outside the
  // built-in four in SYM above; `|| ''` used to drop the prefix entirely, so e.g. 1000.00 printed with no
  // symbol and no code — unreadable and ambiguous. Fall back to the code (code-only; no custom symbol).
  const sym = SYM[currency] || currency;
  const s = (minor / Math.pow(10, decimals)).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency === 'sats' ? (s + ' ' + sym) : (sym + s);
}

// A minor-unit integer as a plain major-unit decimal for a spreadsheet: 4500 -> "45.00" (2 decimals), 4500 -> "4500"
// (0 decimals, sats). No currency symbol and no thousands separator, so Excel/Sheets read it as a number.
export function minorToMajorText(minor, decimals = 2) {
  const d = Number.isInteger(decimals) && decimals >= 0 ? decimals : 2;
  return (Number(minor) / Math.pow(10, d)).toFixed(d);
}

// The rows of "Export CSV" on the Finance screen: one row per posting, debit/credit in MAJOR units (pounds, not
// pence — sim round 2 found the file carried raw minor units, so a £45.00 payment read as 4500 in the
// treasurer's spreadsheet). Header first. Cells are returned raw; quoting is the caller's job.
// Callers: exportCsv in app/stew-finance.jsx (the only one).
// `foreign` (Phase 8) is OFF by default: the debit/credit columns are ALWAYS base currency (pounds), which the
// "export is in pounds" test asserts. When ON (a multi-currency church opts in), two annotation columns are
// APPENDED — the posting's original currency and amount — leaving the base figures and every existing column
// exactly where they were, so the default call is byte-identical to the pre-Phase-8 output.
export function journalCsvRows(book, { foreign = false } = {}) {
  const dec = book.decimals != null ? book.decimals : 2;
  const head = ['seq', 'date', 'memo', 'account', 'fund', 'debit', 'credit'];
  if (foreign) head.push('currency', 'original amount');
  const rows = [head];
  for (const e of book.journal) for (const p of e.postings) {
    const row = [e.seq, e.date, e.memo, (book.accounts.get(p.account) || {}).name || p.account, p.fund || '',
      p.dir === 'dr' ? minorToMajorText(p.amount, dec) : '', p.dir === 'cr' ? minorToMajorText(p.amount, dec) : ''];
    if (foreign) row.push(p.currency || '', p.currency ? minorToMajorText(p.origAmount, dec) : '');
    rows.push(row);
  }
  return rows;
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
      // A fund transfer (reserved account 'fund-transfer') moves its fund: dr reduces, cr increases. Keyed on the
      // ID, never type==='equity' — the SAME rule as finance-ledger.fundBalances, kept identical in both copies.
      if (p.account === 'fund-transfer') bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === 'cr' ? p.amount : -p.amount));
      else if (a.type === 'income') bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === 'cr' ? p.amount : -p.amount));
      else if (a.type === 'expense') bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === 'dr' ? -p.amount : p.amount));
    }
  }
  return [...book.funds.values()].map(f => ({ fund: f.id, name: f.name, kind: f.kind, balance: bal.get(f.id) || 0 }))
    .sort((a, b) => (a.fund === 'general' ? -1 : b.fund === 'general' ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
}

// Build the statement MODEL (numbers only — rendering is separate). `sections` = array of enabled keys.
const validHex = c => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim())) ? c.trim() : '';
// Accent used as INK (title + rules) on white paper: a pale brand colour would render near-invisible, so
// darken it until it clears a legibility threshold on white. '' / invalid → the default near-black ink.
export function accentInk(hex) {
  const h = validHex(hex); if (!h) return '#2b2723';
  let c = h.slice(1);
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length >= 6) c = c.slice(0, 6); else return '#2b2723';
  let r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;   // sRGB relative luminance (0..1)
  if (lum > 0.62) { const k = 0.62 / lum; r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k); }   // only pale/pastel accents; mid-tones pass through

  const hx = n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return '#' + hx(r) + hx(g) + hx(b);
}
// only ever embed a data: image, never a remote URL (anti-beacon — mirrors the member app's safeImgUrl).
const validLogo = s => /^data:image\//i.test(String(s || '').trim()) ? String(s).trim() : '';
export function buildStatement(book, { from = '', to = '￿', title = '', note = '', sections = null, periodLabel = '', generatedAt = '', accent = '', logo = '', banner = '' } = {}) {
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
    banner: validLogo(banner),  // the church's banner as a data: URI (full-width letterhead above the logo); '' when none / not a data URI
  };
  if (has('summary'))  model.summary  = { income: ie.income, expenditure: ie.expenditure, surplus: ie.surplus };
  if (has('income'))   model.income   = incomeRows;
  if (has('spending')) model.spending = spendRows;
  if (has('funds'))    model.funds    = closingFunds(book, to || '￿');
  if (has('balance'))  model.balance  = balanceSheet(book, { asOf: to || '￿' });
  // Phase 4a aggregate report sections. They fire ONLY when a Reports-panel preset enables the key — the share-
  // to-members statement never does, so the name-free share path is unchanged. All three are nation-neutral,
  // carry no names, and reconcile to the journal to the penny (finance-reports.mjs / finance-reports.test.mjs).
  if (has('givingFund'))    model.givingFund    = givingByFund(book, { from: from || '', to: to || '￿' });
  if (has('fundMovements')) model.fundMovements = fundMovements(book, { from: from || '', to: to || '￿' });
  if (has('receipts'))      model.receipts      = receiptsAndPayments(book, { from: from || '', to: to || '￿' });
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
  if (model.givingFund && model.givingFund.length) {
    L.push(''); L.push('GIVING BY FUND');
    for (const r of model.givingFund) L.push(`  ${r.name}${kindTag(r.kind)} — ${f(r.amount)}`);
  }
  if (model.funds && model.funds.length) {
    L.push(''); L.push('FUNDS (closing balance)');
    for (const r of model.funds) L.push(`  ${r.name}${kindTag(r.kind)} — ${f(r.balance)}`);
  }
  if (model.fundMovements && model.fundMovements.length) {
    L.push(''); L.push('FUND MOVEMENTS (opening · in · out · closing)');
    for (const r of model.fundMovements) L.push(`  ${r.name}${kindTag(r.kind)} — ${f(r.opening)} · +${f(r.in)} · -${f(r.out)} · ${f(r.closing)}`);
  }
  if (model.receipts) {
    const rp = model.receipts;
    L.push(''); L.push('RECEIPTS');
    for (const r of rp.receipts) L.push(`  ${r.name} — ${f(r.amount)}`);
    L.push(`  Total receipts — ${f(rp.totalReceipts)}`);
    L.push('PAYMENTS');
    for (const r of rp.payments) L.push(`  ${r.name} — ${f(r.amount)}`);
    L.push(`  Total payments — ${f(rp.totalPayments)}`);
    L.push(`  Net cash movement — ${f(rp.net)}`);
    L.push(`  Cash: ${f(rp.openingCash)} → ${f(rp.closingCash)}`);
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
  if (model.givingFund && model.givingFund.length) S.push(`<section><h2>Giving by fund</h2>${rowsTable(model.givingFund, 'amount', true)}</section>`);
  if (model.funds && model.funds.length)     S.push(`<section><h2>Fund balances <span class="sub">(closing)</span></h2>${rowsTable(model.funds, 'balance', true)}</section>`);
  if (model.fundMovements && model.fundMovements.length) S.push(`<section><h2>Fund movements</h2><table class="t">
    <tr><td></td><td class="n">Opening</td><td class="n">In</td><td class="n">Out</td><td class="n">Closing</td></tr>
    ${model.fundMovements.map(r => `<tr><td>${esc(r.name)}${esc(kindTag(r.kind))}</td><td class="n">${f(r.opening)}</td><td class="n">${f(r.in)}</td><td class="n">${f(r.out)}</td><td class="n">${f(r.closing)}</td></tr>`).join('')}
  </table></section>`);
  if (model.receipts) { const rp = model.receipts; S.push(`<section><h2>Receipts &amp; payments</h2><table class="t">
    ${rp.receipts.map(r => `<tr><td>${esc(r.name)}</td><td class="n">${f(r.amount)}</td></tr>`).join('')}
    <tr class="tot"><td>Total receipts</td><td class="n">${f(rp.totalReceipts)}</td></tr>
    ${rp.payments.map(r => `<tr><td>${esc(r.name)}</td><td class="n">${f(r.amount)}</td></tr>`).join('')}
    <tr class="tot"><td>Total payments</td><td class="n">${f(rp.totalPayments)}</td></tr>
    <tr class="tot"><td>Net cash movement</td><td class="n">${f(rp.net)}</td></tr>
    <tr><td>Cash at start</td><td class="n">${f(rp.openingCash)}</td></tr>
    <tr><td>Cash at end</td><td class="n">${f(rp.closingCash)}</td></tr>
  </table></section>`); }
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
  :root { --ink:#2b2723; --ink3:#8a8078; --line:#e7e0d5; --accent:${accentInk(model.accent)}; }
  * { box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:var(--ink); max-width:640px; margin:0 auto; padding:40px 28px; line-height:1.5; }
  header { border-bottom:2px solid var(--accent); padding-bottom:14px; margin-bottom:8px; }
  header img.banner { width:100%; max-height:120px; object-fit:cover; border-radius:10px; margin:0 0 12px; }
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
<header>${model.banner ? `<img class="banner" src="${esc(model.banner)}" alt="">` : ''}${model.logo ? `<img class="logo" src="${esc(model.logo)}" alt="">` : ''}<h1>${esc(model.title)}</h1><div class="period">${esc(model.periodLabel)}</div></header>
${S.join('\n')}
<footer>${model.generatedAt ? 'Generated ' + esc(model.generatedAt) + ' · ' : ''}Prepared with TrinityOne — aggregate figures only.</footer>
</body></html>`;
}

// ── report CSV (the Reports panel "Export CSV", any preset) ──
// Flatten a statement/report MODEL into rows: one section at a time, money in MAJOR units (pounds, not pence —
// the same conversion journalCsvRows makes). Cells are returned RAW; quoting and the =+-@ formula-injection
// guard are the caller's job (exportReportCsv in stew-finance.jsx, as the main-screen Export CSV already does).
// Callers: reportCsv in app/stew-finance.jsx + finance-reports.test.mjs. (journalCsvRows stays the all-journal CSV.)
export function reportCsvRows(model) {
  const dec = model.decimals != null ? model.decimals : 2;
  const mm = m => minorToMajorText(m, dec);
  const rows = [[model.title || 'Report'], [model.periodLabel || ''], []];
  if (model.summary)  { rows.push(['Summary']); rows.push(['Total income', mm(model.summary.income)]); rows.push(['Total spending', mm(model.summary.expenditure)]); rows.push([model.summary.surplus < 0 ? 'Deficit' : 'Surplus', mm(model.summary.surplus)]); rows.push([]); }
  if (model.income && model.income.length)     { rows.push(['Income by category']); for (const r of model.income) rows.push([r.name, mm(r.amount)]); rows.push([]); }
  if (model.spending && model.spending.length) { rows.push(['Spending by category']); for (const r of model.spending) rows.push([r.name, mm(r.amount)]); rows.push([]); }
  if (model.givingFund && model.givingFund.length) { rows.push(['Giving by fund']); for (const r of model.givingFund) rows.push([r.name + kindTag(r.kind), mm(r.amount)]); rows.push([]); }
  if (model.funds && model.funds.length)       { rows.push(['Fund balances (closing)']); for (const r of model.funds) rows.push([r.name + kindTag(r.kind), mm(r.balance)]); rows.push([]); }
  if (model.fundMovements && model.fundMovements.length) { rows.push(['Fund movements']); rows.push(['Fund', 'Opening', 'In', 'Out', 'Closing']); for (const r of model.fundMovements) rows.push([r.name + kindTag(r.kind), mm(r.opening), mm(r.in), mm(r.out), mm(r.closing)]); rows.push([]); }
  if (model.receipts) { const rp = model.receipts;
    rows.push(['Receipts']); for (const r of rp.receipts) rows.push([r.name, mm(r.amount)]); rows.push(['Total receipts', mm(rp.totalReceipts)]); rows.push([]);
    rows.push(['Payments']); for (const r of rp.payments) rows.push([r.name, mm(r.amount)]); rows.push(['Total payments', mm(rp.totalPayments)]); rows.push([]);
    rows.push(['Net cash movement', mm(rp.net)]); rows.push(['Cash at start', mm(rp.openingCash)]); rows.push(['Cash at end', mm(rp.closingCash)]); rows.push([]); }
  if (model.balance)  { rows.push(['Balance sheet']); rows.push(['Assets', mm(model.balance.assets)]); rows.push(['Liabilities', mm(model.balance.liabilities)]); rows.push(['Net funds', mm(model.balance.funds)]); rows.push([]); }
  if (model.note)     { rows.push(['Note']); rows.push([model.note]); }
  return rows;
}
