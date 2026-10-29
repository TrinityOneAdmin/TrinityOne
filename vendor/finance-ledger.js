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
    FUND_TRANSFER_ACCT: () => FUND_TRANSFER_ACCT,
    STATEMENT_SECTIONS: () => STATEMENT_SECTIONS,
    accentInk: () => accentInk,
    accountHasPostings: () => accountHasPostings,
    addAccount: () => addAccount,
    addFund: () => addFund,
    applyEntry: () => applyEntry,
    balanceSheet: () => balanceSheet,
    bookToDocs: () => bookToDocs,
    buildStatement: () => buildStatement,
    check: () => check,
    createBook: () => createBook,
    docFor: () => docFor,
    dropFrom: () => dropFrom,
    fmtMoney: () => fmtMoney,
    fundBalances: () => fundBalances,
    fundMovements: () => fundMovements,
    givingByFund: () => givingByFund,
    guessColumns: () => guessColumns,
    importedKeys: () => importedKeys,
    incomeExpenditure: () => incomeExpenditure,
    journalCsvRows: () => journalCsvRows,
    lineKey: () => lineKey,
    match: () => match,
    minorToMajorText: () => minorToMajorText,
    parseCsv: () => parseCsv,
    parseDate: () => parseDate,
    parseMoney: () => parseMoney,
    post: () => post,
    quarterRange: () => quarterRange,
    rangeLabel: () => rangeLabel,
    rebuildBook: () => rebuildBook,
    receiptsAndPayments: () => receiptsAndPayments,
    reportCsvRows: () => reportCsvRows,
    reverse: () => reverse,
    statementBalanceCheck: () => statementBalanceCheck,
    statementHtml: () => statementHtml,
    statementLines: () => statementLines,
    statementText: () => statementText,
    suggestCategory: () => suggestCategory,
    templateEntry: () => templateEntry,
    templateImportKey: () => templateImportKey,
    templatePost: () => templatePost,
    trialBalance: () => trialBalance,
    yearRange: () => yearRange
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
  function addAccount(book, { id, code, name, type, archived = false }) {
    if (!ACCOUNT_TYPES.includes(type)) throw new Error("bad account type: " + type);
    id = id || code;
    if (!id) throw new Error("account needs an id or code");
    if (book.accounts.has(id)) throw new Error("duplicate account: " + id);
    const acc = { id, code: code || id, name: name || id, type, archived: !!archived };
    book.accounts.set(id, acc);
    return acc;
  }
  function accountHasPostings(book, id) {
    for (const e of book.journal) for (const p of e.postings) if (p.account === id) return true;
    return false;
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
  function post(book, { date = "", memo = "", postings, by = "", ts = 0, reverses = null, importKey = null, attachmentRefs = [] } = {}) {
    const norm2 = _normalize(book, postings);
    const entry = { seq: ++book._seq, date, memo, postings: norm2, by, ts, reverses, importKey, attachmentRefs: Array.isArray(attachmentRefs) ? attachmentRefs : [] };
    book.journal.push(entry);
    return entry;
  }
  function dropFrom(book, seq) {
    if (!Number.isSafeInteger(seq)) throw new Error("dropFrom needs an integer seq");
    const before = book.journal.length;
    book.journal = book.journal.filter((e) => e.seq < seq);
    book._seq = book.journal.length ? Math.max(...book.journal.map((e) => e.seq)) : seq - 1;
    return before - book.journal.length;
  }
  function applyEntry(book, entry) {
    if (!entry || !Number.isSafeInteger(entry.seq)) throw new Error("entry needs an integer seq");
    if (entry.seq !== book._seq + 1) throw new Error(`sequence gap/fork: expected ${book._seq + 1}, got ${entry.seq}`);
    const norm2 = _normalize(book, entry.postings);
    const e = { seq: entry.seq, date: entry.date || "", memo: entry.memo || "", postings: norm2, by: entry.by || "", ts: entry.ts || 0, reverses: entry.reverses ?? null, importKey: entry.importKey ?? null, attachmentRefs: Array.isArray(entry.attachmentRefs) ? entry.attachmentRefs : [] };
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
  var FUND_TRANSFER_ACCT = "fund-transfer";
  function fundBalances(book) {
    const bal = /* @__PURE__ */ new Map();
    for (const e of book.journal) for (const p of e.postings) {
      if (!p.fund) continue;
      const a = book.accounts.get(p.account);
      if (p.account === FUND_TRANSFER_ACCT) bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === "cr" ? p.amount : -p.amount));
      else if (a && a.type === "income") bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === "cr" ? p.amount : -p.amount));
      else if (a && a.type === "expense") bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === "dr" ? -p.amount : p.amount));
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
    for (const a of book.accounts.values()) docs.push({ t: "account", id: a.id, code: a.code, name: a.name, type: a.type, archived: !!a.archived });
    for (const f of book.funds.values()) if (f.id !== "general") docs.push({ t: "fund", id: f.id, name: f.name, kind: f.kind });
    for (const e of book.journal) docs.push({ t: "journal", seq: e.seq, date: e.date, memo: e.memo, postings: e.postings, by: e.by, ts: e.ts, reverses: e.reverses, importKey: e.importKey ?? null, attachmentRefs: e.attachmentRefs ?? [] });
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

  // src/finance-reports.mjs
  var END = "\uFFFF";
  function fundDelta(book, p) {
    if (!p.fund) return 0;
    if (p.account === FUND_TRANSFER_ACCT) return p.dir === "cr" ? p.amount : -p.amount;
    const a = book.accounts.get(p.account);
    if (!a) return 0;
    if (a.type === "income") return p.dir === "cr" ? p.amount : -p.amount;
    if (a.type === "expense") return p.dir === "dr" ? -p.amount : p.amount;
    return 0;
  }
  function fundMovements(book, { from = "", to = END } = {}) {
    const acc = /* @__PURE__ */ new Map();
    const get = (id) => {
      let o = acc.get(id);
      if (!o) {
        o = { opening: 0, in: 0, out: 0 };
        acc.set(id, o);
      }
      return o;
    };
    for (const e of book.journal) {
      if (e.date > to) continue;
      const before = from && e.date < from;
      for (const p of e.postings) {
        const d = fundDelta(book, p);
        if (d === 0) continue;
        const o = get(p.fund);
        if (before) o.opening += d;
        else if (d > 0) o.in += d;
        else o.out += -d;
      }
    }
    return [...book.funds.values()].map((f) => {
      const o = acc.get(f.id) || { opening: 0, in: 0, out: 0 };
      return { fund: f.id, name: f.name, kind: f.kind, opening: o.opening, in: o.in, out: o.out, closing: o.opening + o.in - o.out };
    }).sort((a, b) => a.fund === "general" ? -1 : b.fund === "general" ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  function receiptsAndPayments(book, { from = "", to = END, cashAccounts = null } = {}) {
    const cash = cashAccounts ? new Set(cashAccounts) : new Set([...book.accounts.values()].filter((a) => a.type === "asset").map((a) => a.id));
    const nameOf = (id) => (book.accounts.get(id) || {}).name || id;
    const rec = /* @__PURE__ */ new Map(), pay = /* @__PURE__ */ new Map();
    let openingCash = 0, periodCash = 0;
    for (const e of book.journal) {
      if (e.date > to) continue;
      const cashDelta = e.postings.reduce((s, p) => cash.has(p.account) ? s + (p.dir === "dr" ? p.amount : -p.amount) : s, 0);
      if (from && e.date < from) {
        openingCash += cashDelta;
        continue;
      }
      periodCash += cashDelta;
      if (!e.postings.some((p) => cash.has(p.account))) continue;
      for (const p of e.postings) {
        const a = book.accounts.get(p.account);
        if (!a) continue;
        if (a.type === "income") {
          const v = p.dir === "cr" ? p.amount : -p.amount;
          if (v) rec.set(p.account, (rec.get(p.account) || 0) + v);
        } else if (a.type === "expense") {
          const v = p.dir === "dr" ? p.amount : -p.amount;
          if (v) pay.set(p.account, (pay.get(p.account) || 0) + v);
        }
      }
    }
    const toRows = (m) => [...m].filter(([, v]) => v !== 0).map(([account, amount]) => ({ account, name: nameOf(account), amount })).sort((a, b) => b.amount - a.amount);
    const receipts = toRows(rec), payments = toRows(pay);
    const totalReceipts = receipts.reduce((s, r) => s + r.amount, 0);
    const totalPayments = payments.reduce((s, r) => s + r.amount, 0);
    return { receipts, payments, totalReceipts, totalPayments, net: totalReceipts - totalPayments, openingCash, closingCash: openingCash + periodCash };
  }
  function givingByFund(book, { from = "", to = END } = {}) {
    const byFund = /* @__PURE__ */ new Map();
    for (const e of book.journal) {
      if (e.date < (from || "") || e.date > to) continue;
      for (const p of e.postings) {
        const a = book.accounts.get(p.account);
        if (!a || a.type !== "income") continue;
        const v = p.dir === "cr" ? p.amount : -p.amount;
        const key = p.fund || "general";
        byFund.set(key, (byFund.get(key) || 0) + v);
      }
    }
    return [...book.funds.values()].map((f) => ({ fund: f.id, name: f.name, kind: f.kind, amount: byFund.get(f.id) || 0 })).filter((r) => r.amount !== 0).sort((a, b) => b.amount - a.amount);
  }

  // src/finance-statement.mjs
  var STATEMENT_SECTIONS = [
    { key: "summary", label: "Summary \u2014 income, spending, surplus", on: true },
    { key: "income", label: "Income by category", on: true },
    { key: "spending", label: "Spending by category", on: true },
    { key: "funds", label: "Fund balances (closing)", on: true },
    { key: "balance", label: "Balance sheet", on: false },
    { key: "note", label: "Treasurer's note", on: false }
  ];
  var SYM = { GBP: "\xA3", USD: "$", EUR: "\u20AC", sats: "\u26A1" };
  function fmtMoney(minor, currency = "GBP", decimals = 2) {
    const sym = SYM[currency] || "";
    const s = (minor / Math.pow(10, decimals)).toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return currency === "sats" ? s + " " + sym : sym + s;
  }
  function minorToMajorText(minor, decimals = 2) {
    const d = Number.isInteger(decimals) && decimals >= 0 ? decimals : 2;
    return (Number(minor) / Math.pow(10, d)).toFixed(d);
  }
  function journalCsvRows(book) {
    const dec = book.decimals != null ? book.decimals : 2;
    const rows = [["seq", "date", "memo", "account", "fund", "debit", "credit"]];
    for (const e of book.journal) for (const p of e.postings) {
      rows.push([
        e.seq,
        e.date,
        e.memo,
        (book.accounts.get(p.account) || {}).name || p.account,
        p.fund || "",
        p.dir === "dr" ? minorToMajorText(p.amount, dec) : "",
        p.dir === "cr" ? minorToMajorText(p.amount, dec) : ""
      ]);
    }
    return rows;
  }
  var pad = (n) => String(n).padStart(2, "0");
  function quarterRange(year, q) {
    const startM = (q - 1) * 3 + 1, endM = startM + 2;
    const lastDay = new Date(Date.UTC(year, endM, 0)).getUTCDate();
    return { from: `${year}-${pad(startM)}-01`, to: `${year}-${pad(endM)}-${pad(lastDay)}`, label: `Q${q} ${year}` };
  }
  function yearRange(year) {
    return { from: `${year}-01-01`, to: `${year}-12-31`, label: `${year}` };
  }
  function rangeLabel(from, to) {
    return (from || "\u2026") + " to " + (to || "\u2026");
  }
  function closingFunds(book, to = "\uFFFF") {
    const bal = /* @__PURE__ */ new Map();
    for (const e of book.journal) {
      if (e.date > to) continue;
      for (const p of e.postings) {
        if (!p.fund) continue;
        const a = book.accounts.get(p.account);
        if (!a) continue;
        if (p.account === "fund-transfer") bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === "cr" ? p.amount : -p.amount));
        else if (a.type === "income") bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === "cr" ? p.amount : -p.amount));
        else if (a.type === "expense") bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === "dr" ? -p.amount : p.amount));
      }
    }
    return [...book.funds.values()].map((f) => ({ fund: f.id, name: f.name, kind: f.kind, balance: bal.get(f.id) || 0 })).sort((a, b) => a.fund === "general" ? -1 : b.fund === "general" ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  var validHex = (c) => typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()) ? c.trim() : "";
  function accentInk(hex) {
    const h = validHex(hex);
    if (!h) return "#2b2723";
    let c = h.slice(1);
    if (c.length === 3) c = c.split("").map((x) => x + x).join("");
    if (c.length >= 6) c = c.slice(0, 6);
    else return "#2b2723";
    let r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (lum > 0.62) {
      const k = 0.62 / lum;
      r = Math.round(r * k);
      g = Math.round(g * k);
      b = Math.round(b * k);
    }
    const hx = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
    return "#" + hx(r) + hx(g) + hx(b);
  }
  var validLogo = (s) => /^data:image\//i.test(String(s || "").trim()) ? String(s).trim() : "";
  function buildStatement(book, { from = "", to = "\uFFFF", title = "", note = "", sections = null, periodLabel = "", generatedAt = "", accent = "", logo = "" } = {}) {
    const enabled = sections || STATEMENT_SECTIONS.filter((s) => s.on).map((s) => s.key);
    const has = (k) => enabled.includes(k);
    const nameOf = (id) => (book.accounts.get(id) || {}).name || id;
    const ie = incomeExpenditure(book, { from: from || "", to: to || "\uFFFF" });
    const incomeRows = [], spendRows = [];
    for (const r of ie.byAccount) {
      const a = book.accounts.get(r.account);
      if (!a) continue;
      if (a.type === "income" && r.amount !== 0) incomeRows.push({ account: r.account, name: nameOf(r.account), amount: r.amount });
      else if (a.type === "expense" && r.amount !== 0) spendRows.push({ account: r.account, name: nameOf(r.account), amount: r.amount });
    }
    incomeRows.sort((a, b) => b.amount - a.amount);
    spendRows.sort((a, b) => b.amount - a.amount);
    const model = {
      title: title || "Financial statement",
      periodLabel: periodLabel || rangeLabel(from, to),
      from: from || "",
      to: to && to !== "\uFFFF" ? to : "",
      currency: book.baseCurrency,
      decimals: book.decimals,
      generatedAt,
      sections: enabled,
      accent: validHex(accent),
      // the church's brand accent (hex) — colours the statement header/rules; '' → default
      logo: validLogo(logo)
      // the church's dp/logo as a data: URI (letterhead); '' when none / not a data URI
    };
    if (has("summary")) model.summary = { income: ie.income, expenditure: ie.expenditure, surplus: ie.surplus };
    if (has("income")) model.income = incomeRows;
    if (has("spending")) model.spending = spendRows;
    if (has("funds")) model.funds = closingFunds(book, to || "\uFFFF");
    if (has("balance")) model.balance = balanceSheet(book, { asOf: to || "\uFFFF" });
    if (has("givingFund")) model.givingFund = givingByFund(book, { from: from || "", to: to || "\uFFFF" });
    if (has("fundMovements")) model.fundMovements = fundMovements(book, { from: from || "", to: to || "\uFFFF" });
    if (has("receipts")) model.receipts = receiptsAndPayments(book, { from: from || "", to: to || "\uFFFF" });
    if (has("note") && note && note.trim()) model.note = note.trim();
    return model;
  }
  var kindTag = (k) => k === "restricted" ? " (restricted)" : k === "designated" ? " (designated)" : "";
  function statementText(model) {
    const f = (m) => fmtMoney(m, model.currency, model.decimals);
    const L = [];
    L.push(model.title);
    L.push(model.periodLabel);
    L.push("=".repeat(Math.max(model.title.length, model.periodLabel.length)));
    if (model.summary) {
      L.push("");
      L.push(`Total income:    ${f(model.summary.income)}`);
      L.push(`Total spending:  ${f(model.summary.expenditure)}`);
      L.push(`${model.summary.surplus < 0 ? "Deficit" : "Surplus"}:         ${f(model.summary.surplus)}`);
    }
    if (model.income && model.income.length) {
      L.push("");
      L.push("INCOME");
      for (const r of model.income) L.push(`  ${r.name} \u2014 ${f(r.amount)}`);
    }
    if (model.spending && model.spending.length) {
      L.push("");
      L.push("SPENDING");
      for (const r of model.spending) L.push(`  ${r.name} \u2014 ${f(r.amount)}`);
    }
    if (model.givingFund && model.givingFund.length) {
      L.push("");
      L.push("GIVING BY FUND");
      for (const r of model.givingFund) L.push(`  ${r.name}${kindTag(r.kind)} \u2014 ${f(r.amount)}`);
    }
    if (model.funds && model.funds.length) {
      L.push("");
      L.push("FUNDS (closing balance)");
      for (const r of model.funds) L.push(`  ${r.name}${kindTag(r.kind)} \u2014 ${f(r.balance)}`);
    }
    if (model.fundMovements && model.fundMovements.length) {
      L.push("");
      L.push("FUND MOVEMENTS (opening \xB7 in \xB7 out \xB7 closing)");
      for (const r of model.fundMovements) L.push(`  ${r.name}${kindTag(r.kind)} \u2014 ${f(r.opening)} \xB7 +${f(r.in)} \xB7 -${f(r.out)} \xB7 ${f(r.closing)}`);
    }
    if (model.receipts) {
      const rp = model.receipts;
      L.push("");
      L.push("RECEIPTS");
      for (const r of rp.receipts) L.push(`  ${r.name} \u2014 ${f(r.amount)}`);
      L.push(`  Total receipts \u2014 ${f(rp.totalReceipts)}`);
      L.push("PAYMENTS");
      for (const r of rp.payments) L.push(`  ${r.name} \u2014 ${f(r.amount)}`);
      L.push(`  Total payments \u2014 ${f(rp.totalPayments)}`);
      L.push(`  Net cash movement \u2014 ${f(rp.net)}`);
      L.push(`  Cash: ${f(rp.openingCash)} \u2192 ${f(rp.closingCash)}`);
    }
    if (model.balance) {
      L.push("");
      L.push("BALANCE SHEET");
      L.push(`  Assets \u2014 ${f(model.balance.assets)}`);
      L.push(`  Liabilities \u2014 ${f(model.balance.liabilities)}`);
      L.push(`  Net funds \u2014 ${f(model.balance.funds)}`);
    }
    if (model.note) {
      L.push("");
      L.push("NOTE");
      L.push("  " + model.note.replace(/\n/g, "\n  "));
    }
    if (model.generatedAt) {
      L.push("");
      L.push(`Generated ${model.generatedAt} \xB7 TrinityOne`);
    }
    return L.join("\n");
  }
  var esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function statementHtml(model) {
    const f = (m) => fmtMoney(m, model.currency, model.decimals);
    const rowsTable = (rows, valKey, tag) => `<table class="t">${rows.map((r) => `<tr><td>${esc(r.name)}${tag ? esc(kindTag(r.kind)) : ""}</td><td class="n">${f(r[valKey])}</td></tr>`).join("")}</table>`;
    const S = [];
    if (model.summary) S.push(`<section><h2>Summary</h2><table class="t">
    <tr><td>Total income</td><td class="n">${f(model.summary.income)}</td></tr>
    <tr><td>Total spending</td><td class="n">${f(model.summary.expenditure)}</td></tr>
    <tr class="tot"><td>${model.summary.surplus < 0 ? "Deficit" : "Surplus"}</td><td class="n">${f(model.summary.surplus)}</td></tr>
  </table></section>`);
    if (model.income && model.income.length) S.push(`<section><h2>Income by category</h2>${rowsTable(model.income, "amount")}</section>`);
    if (model.spending && model.spending.length) S.push(`<section><h2>Spending by category</h2>${rowsTable(model.spending, "amount")}</section>`);
    if (model.givingFund && model.givingFund.length) S.push(`<section><h2>Giving by fund</h2>${rowsTable(model.givingFund, "amount", true)}</section>`);
    if (model.funds && model.funds.length) S.push(`<section><h2>Fund balances <span class="sub">(closing)</span></h2>${rowsTable(model.funds, "balance", true)}</section>`);
    if (model.fundMovements && model.fundMovements.length) S.push(`<section><h2>Fund movements</h2><table class="t">
    <tr><td></td><td class="n">Opening</td><td class="n">In</td><td class="n">Out</td><td class="n">Closing</td></tr>
    ${model.fundMovements.map((r) => `<tr><td>${esc(r.name)}${esc(kindTag(r.kind))}</td><td class="n">${f(r.opening)}</td><td class="n">${f(r.in)}</td><td class="n">${f(r.out)}</td><td class="n">${f(r.closing)}</td></tr>`).join("")}
  </table></section>`);
    if (model.receipts) {
      const rp = model.receipts;
      S.push(`<section><h2>Receipts &amp; payments</h2><table class="t">
    ${rp.receipts.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${f(r.amount)}</td></tr>`).join("")}
    <tr class="tot"><td>Total receipts</td><td class="n">${f(rp.totalReceipts)}</td></tr>
    ${rp.payments.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${f(r.amount)}</td></tr>`).join("")}
    <tr class="tot"><td>Total payments</td><td class="n">${f(rp.totalPayments)}</td></tr>
    <tr class="tot"><td>Net cash movement</td><td class="n">${f(rp.net)}</td></tr>
    <tr><td>Cash at start</td><td class="n">${f(rp.openingCash)}</td></tr>
    <tr><td>Cash at end</td><td class="n">${f(rp.closingCash)}</td></tr>
  </table></section>`);
    }
    if (model.balance) S.push(`<section><h2>Balance sheet</h2><table class="t">
    <tr><td>Assets</td><td class="n">${f(model.balance.assets)}</td></tr>
    <tr><td>Liabilities</td><td class="n">${f(model.balance.liabilities)}</td></tr>
    <tr class="tot"><td>Net funds</td><td class="n">${f(model.balance.funds)}</td></tr>
  </table></section>`);
    if (model.note) S.push(`<section><h2>Note</h2><p class="note">${esc(model.note).replace(/\n/g, "<br>")}</p></section>`);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)} \u2014 ${esc(model.periodLabel)}</title>
<style>
  :root { --ink:#2b2723; --ink3:#8a8078; --line:#e7e0d5; --accent:${accentInk(model.accent)}; }
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
<header>${model.logo ? `<img class="logo" src="${esc(model.logo)}" alt="">` : ""}<h1>${esc(model.title)}</h1><div class="period">${esc(model.periodLabel)}</div></header>
${S.join("\n")}
<footer>${model.generatedAt ? "Generated " + esc(model.generatedAt) + " \xB7 " : ""}Prepared with TrinityOne \u2014 aggregate figures only.</footer>
</body></html>`;
  }
  function reportCsvRows(model) {
    const dec = model.decimals != null ? model.decimals : 2;
    const mm = (m) => minorToMajorText(m, dec);
    const rows = [[model.title || "Report"], [model.periodLabel || ""], []];
    if (model.summary) {
      rows.push(["Summary"]);
      rows.push(["Total income", mm(model.summary.income)]);
      rows.push(["Total spending", mm(model.summary.expenditure)]);
      rows.push([model.summary.surplus < 0 ? "Deficit" : "Surplus", mm(model.summary.surplus)]);
      rows.push([]);
    }
    if (model.income && model.income.length) {
      rows.push(["Income by category"]);
      for (const r of model.income) rows.push([r.name, mm(r.amount)]);
      rows.push([]);
    }
    if (model.spending && model.spending.length) {
      rows.push(["Spending by category"]);
      for (const r of model.spending) rows.push([r.name, mm(r.amount)]);
      rows.push([]);
    }
    if (model.givingFund && model.givingFund.length) {
      rows.push(["Giving by fund"]);
      for (const r of model.givingFund) rows.push([r.name + kindTag(r.kind), mm(r.amount)]);
      rows.push([]);
    }
    if (model.funds && model.funds.length) {
      rows.push(["Fund balances (closing)"]);
      for (const r of model.funds) rows.push([r.name + kindTag(r.kind), mm(r.balance)]);
      rows.push([]);
    }
    if (model.fundMovements && model.fundMovements.length) {
      rows.push(["Fund movements"]);
      rows.push(["Fund", "Opening", "In", "Out", "Closing"]);
      for (const r of model.fundMovements) rows.push([r.name + kindTag(r.kind), mm(r.opening), mm(r.in), mm(r.out), mm(r.closing)]);
      rows.push([]);
    }
    if (model.receipts) {
      const rp = model.receipts;
      rows.push(["Receipts"]);
      for (const r of rp.receipts) rows.push([r.name, mm(r.amount)]);
      rows.push(["Total receipts", mm(rp.totalReceipts)]);
      rows.push([]);
      rows.push(["Payments"]);
      for (const r of rp.payments) rows.push([r.name, mm(r.amount)]);
      rows.push(["Total payments", mm(rp.totalPayments)]);
      rows.push([]);
      rows.push(["Net cash movement", mm(rp.net)]);
      rows.push(["Cash at start", mm(rp.openingCash)]);
      rows.push(["Cash at end", mm(rp.closingCash)]);
      rows.push([]);
    }
    if (model.balance) {
      rows.push(["Balance sheet"]);
      rows.push(["Assets", mm(model.balance.assets)]);
      rows.push(["Liabilities", mm(model.balance.liabilities)]);
      rows.push(["Net funds", mm(model.balance.funds)]);
      rows.push([]);
    }
    if (model.note) {
      rows.push(["Note"]);
      rows.push([model.note]);
    }
    return rows;
  }

  // src/finance-reconcile.mjs
  var BANK = "bank";
  function dayNum(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? "" : iso));
    if (!m) return null;
    let y = +m[1];
    const mo = +m[2], d = +m[3];
    y -= mo <= 2 ? 1 : 0;
    const era = Math.floor((y >= 0 ? y : y - 399) / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (mo > 2 ? mo - 3 : mo + 9) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function bankSide(entry, account) {
    for (const p of entry && entry.postings || []) {
      if (p.account === account) return { dir: p.dir === "dr" ? "in" : "out", amount: p.amount };
    }
    return null;
  }
  function match(statementLines2, journalEntries, { windowDays = 3, account = BANK } = {}) {
    const lines = (statementLines2 || []).map((l, i) => ({ l, i }));
    const lineUsed = new Array(lines.length).fill(false);
    const cands = [];
    for (const e of journalEntries || []) {
      const bs = bankSide(e, account);
      if (bs) cands.push({ e, dir: bs.dir, amount: bs.amount, day: dayNum(e.date), importKey: e.importKey || null, used: false });
    }
    const matched = [];
    for (const { l, i } of lines) {
      if (!l || !l.key) continue;
      const c = cands.find((c2) => !c2.used && c2.importKey && c2.importKey === l.key);
      if (c) {
        c.used = true;
        lineUsed[i] = true;
        matched.push({ line: l, entry: c.e, by: "key" });
      }
    }
    for (const { l, i } of lines) {
      if (lineUsed[i] || !l) continue;
      const ld = dayNum(l.date);
      let best = null, bestDist = Infinity;
      for (const c of cands) {
        if (c.used || c.dir !== l.dir || c.amount !== l.amountMinor) continue;
        const known = ld != null && c.day != null;
        const dist = known ? Math.abs(ld - c.day) : 0;
        if ((!known || dist <= windowDays) && dist < bestDist) {
          best = c;
          bestDist = dist;
        }
      }
      if (best) {
        best.used = true;
        lineUsed[i] = true;
        matched.push({ line: l, entry: best.e, by: "amount" });
      }
    }
    const unmatchedLines = [];
    for (const { l, i } of lines) if (!lineUsed[i]) unmatchedLines.push(l);
    const unmatchedEntries = cands.filter((c) => !c.used).map((c) => c.e);
    return { matched, unmatchedLines, unmatchedEntries };
  }
  function statementBalanceCheck(book, asOfDate, closingMinor, account = BANK) {
    let balance = 0;
    for (const e of book && book.journal || []) {
      if (asOfDate && e.date && e.date > asOfDate) continue;
      for (const p of e.postings || []) if (p.account === account) balance += p.dir === "dr" ? p.amount : -p.amount;
    }
    const target = Math.round(Number(closingMinor) || 0);
    const delta = balance - target;
    return { agrees: delta === 0, delta, balance };
  }
  function templateImportKey(id, yyyymm) {
    return "template:" + id + ":" + yyyymm;
  }
  var DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function daysInMonth(y, m) {
    return m === 2 && (y % 4 === 0 && y % 100 !== 0 || y % 400 === 0) ? 29 : DIM[m - 1];
  }
  function templateEntry(template, yyyymm, { account = BANK } = {}) {
    const mm = /^(\d{4})-(\d{2})$/.exec(String(yyyymm == null ? "" : yyyymm));
    if (!mm) throw new Error("templateEntry needs a YYYY-MM month");
    const y = +mm[1], mo = +mm[2];
    if (mo < 1 || mo > 12) throw new Error("templateEntry: bad month " + yyyymm);
    const day = Math.max(1, Math.min(daysInMonth(y, mo), Math.round(Number(template.dayOfMonth) || 1)));
    const date = yyyymm + "-" + String(day).padStart(2, "0");
    const amount = template.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("templateEntry: amount must be a positive integer (minor units)");
    const fund = template.fund || "general";
    const postings = template.dir === "in" ? [{ account, dir: "dr", amount }, { account: template.account, fund, dir: "cr", amount }] : [{ account: template.account, fund, dir: "dr", amount }, { account, dir: "cr", amount }];
    return { date, memo: template.name || "", importKey: templateImportKey(template.id, yyyymm), postings };
  }
  function templatePost(book, template, yyyymm, opts = {}) {
    if (importedKeys(book).has(templateImportKey(template.id, yyyymm))) return null;
    return templateEntry(template, yyyymm, opts);
  }
  return __toCommonJS(finance_bundle_exports);
})();
