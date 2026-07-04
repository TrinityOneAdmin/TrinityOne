// src/finance-ledger.mjs — TrinityOne Finance: the pure double-entry ledger core.
// No I/O, no browser, no relay — just the accounting engine, so it can be proven correct in isolation.
//
// INVARIANTS (see check()):
//   1. every journal entry balances: Σ debits == Σ credits
//   2. the trial balance balances: Σ all debit-balances == Σ all credit-balances
//   3. fund balances reconcile to the overall surplus (income − expenditure)
//   4. sequence numbers are contiguous 1..n (single-writer, relay-ordered upstream)
//
// MONEY is INTEGER minor units (e.g. cents / sats). Never floats — floating-point money is how ledgers rot.
// Sign convention: debits increase assets & expenses; credits increase liabilities, equity & income.

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
export const FUND_KINDS = ['general', 'designated', 'restricted'];
const DEBIT_NORMAL = new Set(['asset', 'expense']);   // credit-normal: liability, equity, income

export function createBook({ baseCurrency = 'USD', decimals = 2, fiscalYearStart = '01-01' } = {}) {
  const book = {
    baseCurrency, decimals, fiscalYearStart,
    accounts: new Map(),   // id -> { id, code, name, type }
    funds: new Map(),      // id -> { id, name, kind }
    journal: [],           // append-only: [{ seq, date, memo, postings, by, ts, reverses }]
    _seq: 0,
  };
  addFund(book, { id: 'general', name: 'General fund', kind: 'general' });   // the default, always present
  return book;
}

export function addAccount(book, { id, code, name, type }) {
  if (!ACCOUNT_TYPES.includes(type)) throw new Error('bad account type: ' + type);
  id = id || code;
  if (!id) throw new Error('account needs an id or code');
  if (book.accounts.has(id)) throw new Error('duplicate account: ' + id);
  const acc = { id, code: code || id, name: name || id, type };
  book.accounts.set(id, acc);
  return acc;
}

export function addFund(book, { id, name, kind = 'general' }) {
  if (!FUND_KINDS.includes(kind)) throw new Error('bad fund kind: ' + kind);
  id = id || name;
  if (!id) throw new Error('fund needs an id or name');
  if (book.funds.has(id)) throw new Error('duplicate fund: ' + id);
  const f = { id, name: name || id, kind };
  book.funds.set(id, f);
  return f;
}

// Post a BALANCED journal entry. postings: [{ account, fund?, dir:'dr'|'cr', amount(+int) }]
// income/expense postings default to the general fund; the cash side (asset/liability/equity) may be fund-less.
function _normalize(book, postings) {
  if (!Array.isArray(postings) || postings.length < 2) throw new Error('a journal entry needs at least two postings');
  let dr = 0, cr = 0;
  const norm = postings.map((p, i) => {
    const acc = book.accounts.get(p.account);
    if (!acc) throw new Error(`posting ${i}: unknown account "${p.account}"`);
    if (p.dir !== 'dr' && p.dir !== 'cr') throw new Error(`posting ${i}: dir must be 'dr' or 'cr'`);
    if (!Number.isSafeInteger(p.amount) || p.amount <= 0) throw new Error(`posting ${i}: amount must be a positive integer (minor units)`);
    let fund = p.fund != null ? p.fund : ((acc.type === 'income' || acc.type === 'expense') ? 'general' : null);
    if (fund != null && !book.funds.has(fund)) throw new Error(`posting ${i}: unknown fund "${fund}"`);
    if (p.dir === 'dr') dr += p.amount; else cr += p.amount;
    return { account: p.account, fund, dir: p.dir, amount: p.amount };
  });
  if (dr !== cr) throw new Error(`entry does not balance: debits ${dr} ≠ credits ${cr}`);
  return norm;
}

export function post(book, { date = '', memo = '', postings, by = '', ts = 0, reverses = null, importKey = null } = {}) {
  const norm = _normalize(book, postings);
  const entry = { seq: ++book._seq, date, memo, postings: norm, by, ts, reverses, importKey };
  book.journal.push(entry);
  return entry;
}

// Rebuild path: append an entry at its ORIGINAL seq, enforcing contiguity. This is the single-writer guard on
// the client side — a gap OR a fork (a repeated seq) throws instead of silently corrupting the ledger.
export function applyEntry(book, entry) {
  if (!entry || !Number.isSafeInteger(entry.seq)) throw new Error('entry needs an integer seq');
  if (entry.seq !== book._seq + 1) throw new Error(`sequence gap/fork: expected ${book._seq + 1}, got ${entry.seq}`);
  const norm = _normalize(book, entry.postings);
  const e = { seq: entry.seq, date: entry.date || '', memo: entry.memo || '', postings: norm, by: entry.by || '', ts: entry.ts || 0, reverses: entry.reverses ?? null, importKey: entry.importKey ?? null };
  book.journal.push(e); book._seq = entry.seq;
  return e;
}

// Reverse a prior entry by appending its mirror — the ledger is append-only, we never edit history.
export function reverse(book, seq, { date, by = '', memo } = {}) {
  const orig = book.journal.find(e => e.seq === seq);
  if (!orig) throw new Error('no entry with seq ' + seq);
  if (orig.reverses != null) throw new Error('cannot reverse a reversal');
  if (book.journal.some(e => e.reverses === seq)) throw new Error('entry #' + seq + ' is already reversed');
  const postings = orig.postings.map(p => ({ account: p.account, fund: p.fund, dir: p.dir === 'dr' ? 'cr' : 'dr', amount: p.amount }));
  return post(book, { date: date || orig.date, by, reverses: seq, memo: memo || `Reversal of #${seq}${orig.memo ? ': ' + orig.memo : ''}`, postings });
}

// The set of import fingerprints already in the journal — so a re-imported bank statement can't double-count
// (each imported line carries its statement lineKey as entry.importKey; see finance-import.mjs).
export function importedKeys(book) {
  const s = new Set();
  for (const e of book.journal) if (e.importKey) s.add(e.importKey);
  return s;
}

// ── projections (everything is derived from the journal) ──

function accountNet(book) {
  const net = new Map();   // accountId -> { dr, cr }
  for (const e of book.journal) for (const p of e.postings) {
    const n = net.get(p.account) || { dr: 0, cr: 0 }; n[p.dir] += p.amount; net.set(p.account, n);
  }
  return net;
}

export function trialBalance(book) {
  const net = accountNet(book);
  const rows = [...book.accounts.values()].map(a => {
    const n = net.get(a.id) || { dr: 0, cr: 0 };
    const bal = n.dr - n.cr;                       // debit-positive
    return { account: a.id, name: a.name, type: a.type, debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0 };
  });
  // deterministic conventional order (asset→liability→equity→income→expense, then by id) so the rebuilt
  // book presents identically no matter what order its events arrived in.
  rows.sort((a, b) => ACCOUNT_TYPES.indexOf(a.type) - ACCOUNT_TYPES.indexOf(b.type) || (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

// Fund balance = accumulated surplus attributable to the fund (income credited − expenditure charged).
export function fundBalances(book) {
  const bal = new Map();
  for (const e of book.journal) for (const p of e.postings) {
    if (!p.fund) continue;
    const a = book.accounts.get(p.account);
    if (a.type === 'income') bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === 'cr' ? p.amount : -p.amount));
    else if (a.type === 'expense') bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === 'dr' ? -p.amount : p.amount));
  }
  return [...book.funds.values()].map(f => ({ fund: f.id, name: f.name, kind: f.kind, balance: bal.get(f.id) || 0 }))
    .sort((a, b) => (a.fund === 'general') - (b.fund === 'general') === 0 ? (a.fund < b.fund ? -1 : a.fund > b.fund ? 1 : 0) : (a.fund === 'general' ? -1 : 1));   // general first, then by id — deterministic
}

export function incomeExpenditure(book, { from = '', to = '￿' } = {}) {
  let income = 0, expenditure = 0;
  const byAccount = new Map();
  for (const e of book.journal) {
    if (e.date < from || e.date > to) continue;
    for (const p of e.postings) {
      const a = book.accounts.get(p.account);
      if (a.type !== 'income' && a.type !== 'expense') continue;
      const signed = a.type === 'income' ? (p.dir === 'cr' ? p.amount : -p.amount) : (p.dir === 'dr' ? p.amount : -p.amount);
      if (a.type === 'income') income += signed; else expenditure += signed;
      byAccount.set(p.account, (byAccount.get(p.account) || 0) + signed);
    }
  }
  return { income, expenditure, surplus: income - expenditure, byAccount: [...byAccount].map(([account, amount]) => ({ account, amount })) };
}

export function balanceSheet(book, { asOf = '￿' } = {}) {
  let assets = 0, liabilities = 0, equityOpening = 0;
  for (const e of book.journal) {
    if (e.date > asOf) continue;
    for (const p of e.postings) {
      const a = book.accounts.get(p.account); const s = p.dir === 'dr' ? p.amount : -p.amount;
      if (a.type === 'asset') assets += s;
      else if (a.type === 'liability') liabilities += -s;
      else if (a.type === 'equity') equityOpening += -s;
    }
  }
  const { surplus } = incomeExpenditure(book, { to: asOf });
  const funds = equityOpening + surplus;                 // net assets carried in the funds
  return { assets, liabilities, funds, surplus, equityOpening, balanced: assets - liabilities === funds };
}

// The whole-book integrity check. Returns { ok, errors } — run it anywhere a projection is trusted.
export function check(book) {
  const errors = [];
  for (const e of book.journal) {
    let dr = 0, cr = 0; for (const p of e.postings) { if (p.dir === 'dr') dr += p.amount; else cr += p.amount; }
    if (dr !== cr) errors.push(`entry #${e.seq} unbalanced: debits ${dr} ≠ credits ${cr}`);
    if (e.postings.some(p => !book.accounts.has(p.account))) errors.push(`entry #${e.seq}: references an unknown account`);
  }
  book.journal.forEach((e, i) => { if (e.seq !== i + 1) errors.push(`sequence break at index ${i}: expected ${i + 1}, got ${e.seq}`); });
  const tb = trialBalance(book);
  if (!tb.balanced) errors.push(`trial balance unbalanced: debits ${tb.totalDebit} ≠ credits ${tb.totalCredit}`);
  const surplus = incomeExpenditure(book).surplus;
  const fundSum = fundBalances(book).reduce((s, f) => s + f.balance, 0);
  if (fundSum !== surplus) errors.push(`fund balances (${fundSum}) don't reconcile to surplus (${surplus})`);
  const bs = balanceSheet(book);
  if (!bs.balanced) errors.push(`balance sheet doesn't balance: assets−liabilities (${bs.assets - bs.liabilities}) ≠ funds (${bs.funds})`);
  return { ok: errors.length === 0, errors };
}
