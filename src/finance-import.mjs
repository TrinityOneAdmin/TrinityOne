// src/finance-import.mjs — bank-statement import (pure, no I/O, no network — all client-side).
// Parse a CSV a bank exports → normalized statement lines ready to categorise into the double-entry ledger.
// Money is INTEGER minor units, matching finance-ledger.mjs. Designed so an Open-Banking adapter could later
// emit the same `statementLines` shape and feed the identical categorise → post → reconcile flow.

const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// RFC-4180-ish CSV parser (handles quotes, embedded commas/newlines) → { header:[], rows:[[…]] }
export function parseCsv(text) {
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  const rows = out.filter(r => r.some(c => String(c).trim() !== ''));
  return { header: rows[0] || [], rows: rows.slice(1) };
}

// Best guess at which columns are which, from the header names. Returns indices (or -1). Banks use either a
// single signed `amount` column OR separate money-in / money-out columns; we detect both shapes.
export function guessColumns(header) {
  const H = (header || []).map(norm);
  const find = (...keys) => H.findIndex(h => keys.some(k => h.includes(k)));
  const moneyIn = find('money in', 'paid in', 'amount in', 'receipt', 'deposit', 'credit');
  const moneyOut = find('money out', 'paid out', 'amount out', 'withdraw', 'payment', 'debit');
  const amount = (moneyIn < 0 || moneyOut < 0) ? find('amount', 'value') : -1;
  const date = find('date');
  const description = find('description', 'details', 'memo', 'narrative', 'reference', 'payee', 'name', 'transaction');
  return {
    date: date < 0 ? 0 : date,
    description: description < 0 ? Math.min(1, Math.max(0, (header || []).length - 1)) : description,
    amount, moneyIn, moneyOut,
  };
}

// Parse a money string → SIGNED integer minor units. Handles £/$/€, thousands commas, (parens)=negative,
// leading/trailing minus, and CR/DR suffixes. (Assumes '.'=decimal, ','=thousands — the common bank export;
// European comma-decimals are a noted future refinement.)
export function parseMoney(str, decimals = 2) {
  let s = String(str == null ? '' : str).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-|-$|\bdr\b|\bdebit\b/i.test(s)) neg = true;
  s = s.replace(/cr|dr|debit|credit/ig, '').replace(/[£$€\s,+\-]/g, '');
  if (!/[0-9]/.test(s)) return null;
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  const minor = Math.round(n * Math.pow(10, decimals));
  return neg ? -minor : minor;
}

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
// Parse a date → ISO 'YYYY-MM-DD'. Handles ISO, DD/MM/YYYY (day-first — the norm outside the US; the UI can
// offer a month-first toggle), and DD-MMM-YYYY. Returns '' when unrecognized so the UI can flag it.
export function parseDate(str, monthFirst = false) {
  const s = String(str == null ? '' : str).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/))) {
    let a = m[1], b = m[2], y = m[3]; if (y.length === 2) y = '20' + y;
    const day = monthFirst ? b : a, mon = monthFirst ? a : b;
    return y + '-' + mon.padStart(2, '0') + '-' + day.padStart(2, '0');
  }
  if ((m = s.match(/^(\d{1,2})[\- ]([A-Za-z]{3})[A-Za-z]*[\- ](\d{2,4})/))) {
    const mo = MONTHS[m[2].toLowerCase()]; let y = m[3]; if (y.length === 2) y = '20' + y;
    if (mo) return y + '-' + mo + '-' + m[1].padStart(2, '0');
  }
  return '';
}

// A stable fingerprint for de-duplication (so re-importing the same statement can't double-count).
export function lineKey(date, signedMinor, description) { return (date || '') + '|' + signedMinor + '|' + norm(description).slice(0, 40); }

// Turn parsed rows + a column mapping into normalized lines: [{ date, description, amountMinor(+), dir:'in'|'out', key }].
export function statementLines({ rows, mapping, decimals = 2, monthFirst = false } = {}) {
  const out = [];
  for (const r of (rows || [])) {
    const date = parseDate(r[mapping.date] || '', monthFirst);
    const description = String(r[mapping.description] || '').trim();
    let amountMinor = null, dir = null;
    if (mapping.amount != null && mapping.amount >= 0) {
      const v = parseMoney(r[mapping.amount], decimals);
      if (v != null && v !== 0) { dir = v > 0 ? 'in' : 'out'; amountMinor = Math.abs(v); }
    } else {
      const inV = (mapping.moneyIn >= 0) ? parseMoney(r[mapping.moneyIn], decimals) : null;
      const outV = (mapping.moneyOut >= 0) ? parseMoney(r[mapping.moneyOut], decimals) : null;
      if (inV) { dir = 'in'; amountMinor = Math.abs(inV); }
      else if (outV) { dir = 'out'; amountMinor = Math.abs(outV); }
    }
    if (!amountMinor || !dir) continue;   // skip blank / zero / unparseable rows
    out.push({ date, description, amountMinor, dir, key: lineKey(date, dir === 'in' ? amountMinor : -amountMinor, description) });
  }
  return out;
}

// Suggest a category for a line from remembered rules (keyword → account+fund). Returns null → the UI falls
// back to a default by direction. `rules`: [{ match, account, fund }].
export function suggestCategory(line, rules = []) {
  const d = norm(line && line.description);
  for (const rule of rules) { if (rule && rule.match && d.includes(norm(rule.match))) return { account: rule.account, fund: rule.fund || null }; }
  return null;
}
