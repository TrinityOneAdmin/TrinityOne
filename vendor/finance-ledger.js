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
    incomeExpenditure: () => incomeExpenditure,
    post: () => post,
    rebuildBook: () => rebuildBook,
    reverse: () => reverse,
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
    const norm = postings.map((p, i) => {
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
    return norm;
  }
  function post(book, { date = "", memo = "", postings, by = "", ts = 0, reverses = null } = {}) {
    const norm = _normalize(book, postings);
    const entry = { seq: ++book._seq, date, memo, postings: norm, by, ts, reverses };
    book.journal.push(entry);
    return entry;
  }
  function applyEntry(book, entry) {
    if (!entry || !Number.isSafeInteger(entry.seq)) throw new Error("entry needs an integer seq");
    if (entry.seq !== book._seq + 1) throw new Error(`sequence gap/fork: expected ${book._seq + 1}, got ${entry.seq}`);
    const norm = _normalize(book, entry.postings);
    const e = { seq: entry.seq, date: entry.date || "", memo: entry.memo || "", postings: norm, by: entry.by || "", ts: entry.ts || 0, reverses: entry.reverses ?? null };
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
    for (const e of book.journal) docs.push({ t: "journal", seq: e.seq, date: e.date, memo: e.memo, postings: e.postings, by: e.by, ts: e.ts, reverses: e.reverses });
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
  return __toCommonJS(finance_bundle_exports);
})();
