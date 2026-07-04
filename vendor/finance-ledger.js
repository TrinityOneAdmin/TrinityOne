var FinanceLedger = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/finance-bundle.mjs
  var finance_bundle_exports = {};
  __export(finance_bundle_exports, {
    ACCOUNT_TYPES: () => ACCOUNT_TYPES,
    FUND_KINDS: () => FUND_KINDS,
    addAccount: () => addAccount,
    addFund: () => addFund,
    applyEntry: () => applyEntry,
    balanceSheet: () => balanceSheet,
    bookToDocs: () => bookToDocs,
    check: () => check,
    createBook: () => createBook,
    docFor: () => docFor,
    fundBalances: () => fundBalances,
    guessColumns: () => guessColumns,
    importedKeys: () => importedKeys,
    incomeExpenditure: () => incomeExpenditure,
    lineKey: () => lineKey,
    parseCsv: () => parseCsv,
    parseDate: () => parseDate,
    parseMoney: () => parseMoney,
    post: () => post,
    rebuildBook: () => rebuildBook,
    reverse: () => reverse,
    statementLines: () => statementLines,
    suggestCategory: () => suggestCategory,
    trialBalance: () => trialBalance
  });

  // src/finance-ledger.mjs
  var ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"];
  var FUND_KINDS = ["general", "designated", "restricted"];
  function createBook({ baseCurrency = "USD", decimals = 2, fiscalYearStart = "01-01" } = {}) {
    const book = {
      baseCurrency,
      decimals,
      fiscalYearStart,
      accounts: /* @__PURE__ */ new Map(),
      // id -> { id, code, name, type }
      funds: /* @__PURE__ */ new Map(),
      // id -> { id, name, kind }
      journal: [],
      // append-only: [{ seq, date, memo, postings, by, ts, reverses }]
      _seq: 0
    };
    addFund(book, { id: "general", name: "General fund", kind: "general" });
    return book;
  }
  function addAccount(book, { id, code, name, type }) {
    if (!ACCOUNT_TYPES.includes(type)) throw new Error("bad account type: " + type);
    id = id || code;
    if (!id) throw new Error("account needs an id or code");
    if (book.accounts.has(id)) throw new Error("duplicate account: " + id);
    const acc = { id, code: code || id, name: name || id, type };
    book.accounts.set(id, acc);
    return acc;
  }
  function addFund(book, { id, name, kind = "general" }) {
    if (!FUND_KINDS.includes(kind)) throw new Error("bad fund kind: " + kind);
    id = id || name;
    if (!id) throw new Error("fund needs an id or name");
    if (book.funds.has(id)) throw new Error("duplicate fund: " + id);
    const f = { id, name: name || id, kind };
    book.funds.set(id, f);
    return f;
  }
  function _normalize(book, postings) {
    if (!Array.isArray(postings) || postings.length < 2) throw new Error("a journal entry needs at least two postings");
    let dr = 0, cr = 0;
    const norm2 = postings.map((p, i) => {
      const acc = book.accounts.get(p.account);
      if (!acc) throw new Error(`posting ${i}: unknown account "${p.account}"`);
      if (p.dir !== "dr" && p.dir !== "cr") throw new Error(`posting ${i}: dir must be 'dr' or 'cr'`);
      if (!Number.isSafeInteger(p.amount) || p.amount <= 0) throw new Error(`posting ${i}: amount must be a positive integer (minor units)`);
      let fund = p.fund != null ? p.fund : acc.type === "income" || acc.type === "expense" ? "general" : null;
      if (fund != null && !book.funds.has(fund)) throw new Error(`posting ${i}: unknown fund "${fund}"`);
      if (p.dir === "dr") dr += p.amount;
      else cr += p.amount;
      return { account: p.account, fund, dir: p.dir, amount: p.amount };
    });
    if (dr !== cr) throw new Error(`entry does not balance: debits ${dr} \u2260 credits ${cr}`);
    return norm2;
  }
  function post(book, { date = "", memo = "", postings, by = "", ts = 0, reverses = null, importKey = null } = {}) {
    const norm2 = _normalize(book, postings);
    const entry = { seq: ++book._seq, date, memo, postings: norm2, by, ts, reverses, importKey };
    book.journal.push(entry);
    return entry;
  }
  function applyEntry(book, entry) {
    if (!entry || !Number.isSafeInteger(entry.seq)) throw new Error("entry needs an integer seq");
    if (entry.seq !== book._seq + 1) throw new Error(`sequence gap/fork: expected ${book._seq + 1}, got ${entry.seq}`);
    const norm2 = _normalize(book, entry.postings);
    const e = { seq: entry.seq, date: entry.date || "", memo: entry.memo || "", postings: norm2, by: entry.by || "", ts: entry.ts || 0, reverses: entry.reverses ?? null, importKey: entry.importKey ?? null };
    book.journal.push(e);
    book._seq = entry.seq;
    return e;
  }
  function reverse(book, seq, { date, by = "", memo } = {}) {
    const orig = book.journal.find((e) => e.seq === seq);
    if (!orig) throw new Error("no entry with seq " + seq);
    if (orig.reverses != null) throw new Error("cannot reverse a reversal");
    if (book.journal.some((e) => e.reverses === seq)) throw new Error("entry #" + seq + " is already reversed");
    const postings = orig.postings.map((p) => ({ account: p.account, fund: p.fund, dir: p.dir === "dr" ? "cr" : "dr", amount: p.amount }));
    return post(book, { date: date || orig.date, by, reverses: seq, memo: memo || `Reversal of #${seq}${orig.memo ? ": " + orig.memo : ""}`, postings });
  }
  function importedKeys(book) {
    const s = /* @__PURE__ */ new Set();
    for (const e of book.journal) if (e.importKey) s.add(e.importKey);
    return s;
  }
  function accountNet(book) {
    const net = /* @__PURE__ */ new Map();
    for (const e of book.journal) for (const p of e.postings) {
      const n = net.get(p.account) || { dr: 0, cr: 0 };
      n[p.dir] += p.amount;
      net.set(p.account, n);
    }
    return net;
  }
  function trialBalance(book) {
    const net = accountNet(book);
    const rows = [...book.accounts.values()].map((a) => {
      const n = net.get(a.id) || { dr: 0, cr: 0 };
      const bal = n.dr - n.cr;
      return { account: a.id, name: a.name, type: a.type, debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0 };
    });
    rows.sort((a, b) => ACCOUNT_TYPES.indexOf(a.type) - ACCOUNT_TYPES.indexOf(b.type) || (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
  }
  function fundBalances(book) {
    const bal = /* @__PURE__ */ new Map();
    for (const e of book.journal) for (const p of e.postings) {
      if (!p.fund) continue;
      const a = book.accounts.get(p.account);
      if (a.type === "income") bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === "cr" ? p.amount : -p.amount));
      else if (a.type === "expense") bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === "dr" ? -p.amount : p.amount));
    }
    return [...book.funds.values()].map((f) => ({ fund: f.id, name: f.name, kind: f.kind, balance: bal.get(f.id) || 0 })).sort((a, b) => (a.fund === "general") - (b.fund === "general") === 0 ? a.fund < b.fund ? -1 : a.fund > b.fund ? 1 : 0 : a.fund === "general" ? -1 : 1);
  }
  function incomeExpenditure(book, { from = "", to = "\uFFFF" } = {}) {
    let income = 0, expenditure = 0;
    const byAccount = /* @__PURE__ */ new Map();
    for (const e of book.journal) {
      if (e.date < from || e.date > to) continue;
      for (const p of e.postings) {
        const a = book.accounts.get(p.account);
        if (a.type !== "income" && a.type !== "expense") continue;
        const signed = a.type === "income" ? p.dir === "cr" ? p.amount : -p.amount : p.dir === "dr" ? p.amount : -p.amount;
        if (a.type === "income") income += signed;
        else expenditure += signed;
        byAccount.set(p.account, (byAccount.get(p.account) || 0) + signed);
      }
    }
    return { income, expenditure, surplus: income - expenditure, byAccount: [...byAccount].map(([account, amount]) => ({ account, amount })) };
  }
  function balanceSheet(book, { asOf = "\uFFFF" } = {}) {
    let assets = 0, liabilities = 0, equityOpening = 0;
    for (const e of book.journal) {
      if (e.date > asOf) continue;
      for (const p of e.postings) {
        const a = book.accounts.get(p.account);
        const s = p.dir === "dr" ? p.amount : -p.amount;
        if (a.type === "asset") assets += s;
        else if (a.type === "liability") liabilities += -s;
        else if (a.type === "equity") equityOpening += -s;
      }
    }
    const { surplus } = incomeExpenditure(book, { to: asOf });
    const funds = equityOpening + surplus;
    return { assets, liabilities, funds, surplus, equityOpening, balanced: assets - liabilities === funds };
  }
  function check(book) {
    const errors = [];
    for (const e of book.journal) {
      let dr = 0, cr = 0;
      for (const p of e.postings) {
        if (p.dir === "dr") dr += p.amount;
        else cr += p.amount;
      }
      if (dr !== cr) errors.push(`entry #${e.seq} unbalanced: debits ${dr} \u2260 credits ${cr}`);
      if (e.postings.some((p) => !book.accounts.has(p.account))) errors.push(`entry #${e.seq}: references an unknown account`);
    }
    book.journal.forEach((e, i) => {
      if (e.seq !== i + 1) errors.push(`sequence break at index ${i}: expected ${i + 1}, got ${e.seq}`);
    });
    const tb = trialBalance(book);
    if (!tb.balanced) errors.push(`trial balance unbalanced: debits ${tb.totalDebit} \u2260 credits ${tb.totalCredit}`);
    const surplus = incomeExpenditure(book).surplus;
    const fundSum = fundBalances(book).reduce((s, f) => s + f.balance, 0);
    if (fundSum !== surplus) errors.push(`fund balances (${fundSum}) don't reconcile to surplus (${surplus})`);
    const bs = balanceSheet(book);
    if (!bs.balanced) errors.push(`balance sheet doesn't balance: assets\u2212liabilities (${bs.assets - bs.liabilities}) \u2260 funds (${bs.funds})`);
    return { ok: errors.length === 0, errors };
  }

  // src/finance-store.mjs
  function bookToDocs(book) {
    const docs = [{ t: "settings", baseCurrency: book.baseCurrency, decimals: book.decimals, fiscalYearStart: book.fiscalYearStart }];
    for (const a of book.accounts.values()) docs.push({ t: "account", id: a.id, code: a.code, name: a.name, type: a.type });
    for (const f of book.funds.values()) if (f.id !== "general") docs.push({ t: "fund", id: f.id, name: f.name, kind: f.kind });
    for (const e of book.journal) docs.push({ t: "journal", seq: e.seq, date: e.date, memo: e.memo, postings: e.postings, by: e.by, ts: e.ts, reverses: e.reverses, importKey: e.importKey ?? null });
    return docs;
  }
  function docFor(entryOrObj, t) {
    return { t, ...entryOrObj };
  }
  function rebuildBook(docs) {
    const errors = [];
    const settings = docs.find((d) => d && d.t === "settings") || {};
    const book = createBook(settings);
    for (const d of docs) if (d && d.t === "account") {
      try {
        addAccount(book, d);
      } catch (e) {
        errors.push("account: " + e.message);
      }
    }
    for (const d of docs) if (d && d.t === "fund") {
      try {
        addFund(book, d);
      } catch (e) {
        errors.push("fund: " + e.message);
      }
    }
    const journal = docs.filter((d) => d && d.t === "journal").slice().sort((a, b) => a.seq - b.seq);
    for (const j of journal) {
      try {
        applyEntry(book, j);
      } catch (e) {
        errors.push(e.message);
      }
    }
    const chk = check(book);
    return { book, ok: errors.length === 0 && chk.ok, errors: errors.concat(chk.errors) };
  }

  // src/finance-import.mjs
  var norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  function parseCsv(text) {
    const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const out = [];
    let row = [], cur = "", q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = false;
        } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        out.push(row);
        row = [];
        cur = "";
      } else cur += c;
    }
    if (cur !== "" || row.length) {
      row.push(cur);
      out.push(row);
    }
    const rows = out.filter((r) => r.some((c) => String(c).trim() !== ""));
    return { header: rows[0] || [], rows: rows.slice(1) };
  }
  function guessColumns(header) {
    const H = (header || []).map(norm);
    const find = (...keys) => H.findIndex((h) => keys.some((k) => h.includes(k)));
    const moneyIn = find("money in", "paid in", "amount in", "receipt", "deposit", "credit");
    const moneyOut = find("money out", "paid out", "amount out", "withdraw", "payment", "debit");
    const amount = moneyIn < 0 || moneyOut < 0 ? find("amount", "value") : -1;
    const date = find("date");
    let description = find("description", "details", "memo", "narrative", "reference", "payee", "name");
    if (description === date) description = -1;
    return {
      date: date < 0 ? 0 : date,
      description: description < 0 ? Math.min(1, Math.max(0, (header || []).length - 1)) : description,
      amount,
      moneyIn,
      moneyOut
    };
  }
  function parseMoney(str, decimals = 2) {
    let s = String(str == null ? "" : str).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) {
      neg = true;
      s = s.slice(1, -1);
    }
    if (/^-|-$|\bdr\b|\bdebit\b/i.test(s)) neg = true;
    s = s.replace(/cr|dr|debit|credit/ig, "").replace(/[£$€\s,+\-]/g, "");
    if (!/[0-9]/.test(s)) return null;
    const n = parseFloat(s);
    if (!isFinite(n)) return null;
    const minor = Math.round(n * Math.pow(10, decimals));
    return neg ? -minor : minor;
  }
  var MONTHS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  function parseDate(str, monthFirst = false) {
    const s = String(str == null ? "" : str).trim();
    let m;
    if (m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    if (m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/)) {
      let a = m[1], b = m[2], y = m[3];
      if (y.length === 2) y = "20" + y;
      const day = monthFirst ? b : a, mon = monthFirst ? a : b;
      return y + "-" + mon.padStart(2, "0") + "-" + day.padStart(2, "0");
    }
    if (m = s.match(/^(\d{1,2})[\- ]([A-Za-z]{3})[A-Za-z]*[\- ](\d{2,4})/)) {
      const mo = MONTHS[m[2].toLowerCase()];
      let y = m[3];
      if (y.length === 2) y = "20" + y;
      if (mo) return y + "-" + mo + "-" + m[1].padStart(2, "0");
    }
    return "";
  }
  function lineKey(date, signedMinor, description) {
    return (date || "") + "|" + signedMinor + "|" + norm(description).slice(0, 40);
  }
  function statementLines({ rows, mapping, decimals = 2, monthFirst = false } = {}) {
    const out = [];
    for (const r of rows || []) {
      const date = parseDate(r[mapping.date] || "", monthFirst);
      const description = String(r[mapping.description] || "").trim();
      let amountMinor = null, dir = null;
      if (mapping.amount != null && mapping.amount >= 0) {
        const v = parseMoney(r[mapping.amount], decimals);
        if (v != null && v !== 0) {
          dir = v > 0 ? "in" : "out";
          amountMinor = Math.abs(v);
        }
      } else {
        const inV = mapping.moneyIn >= 0 ? parseMoney(r[mapping.moneyIn], decimals) : null;
        const outV = mapping.moneyOut >= 0 ? parseMoney(r[mapping.moneyOut], decimals) : null;
        if (inV) {
          dir = "in";
          amountMinor = Math.abs(inV);
        } else if (outV) {
          dir = "out";
          amountMinor = Math.abs(outV);
        }
      }
      if (!amountMinor || !dir) continue;
      out.push({ date, description, amountMinor, dir, key: lineKey(date, dir === "in" ? amountMinor : -amountMinor, description) });
    }
    return out;
  }
  function suggestCategory(line, rules = []) {
    const d = norm(line && line.description);
    for (const rule of rules) {
      if (rule && rule.match && d.includes(norm(rule.match))) return { account: rule.account, fund: rule.fund || null };
    }
    return null;
  }
  return __toCommonJS(finance_bundle_exports);
})();
