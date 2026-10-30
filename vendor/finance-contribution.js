var FinanceContribution = (() => {
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

  // src/finance-contribution-bundle.mjs
  var finance_contribution_bundle_exports = {};
  __export(finance_contribution_bundle_exports, {
    STATEMENT_RULES: () => STATEMENT_RULES,
    contributionReportFormats: () => contributionReportFormats,
    contributionStatement: () => contributionStatement,
    contributionStatementDoc: () => contributionStatementDoc
  });

  // src/finance-pack-contribution.mjs
  var STATEMENT_RULES = {
    US: {
      label: "United States",
      requiredFields: ["orgName", "name", "total", "period"],
      // IRS Pub 1771: org name, amount, and date(s), + the statement below
      ackThreshold: 25e3,
      // $250.00 in cents — a WRITTEN ACKNOWLEDGMENT is required for any single gift ≥ $250
      statement: "No goods or services were provided in exchange for these contributions, other than intangible religious benefits.",
      source: "IRS Publication 1771 \u2014 Charitable Contributions: Substantiation and Disclosure Requirements (irs.gov)"
    },
    NZ: {
      label: "New Zealand",
      requiredFields: ["orgName", "name", "total", "period"],
      // IRD: donee org name, donor, amount, date; a receipt is required to claim
      minClaim: 500,
      // $5.00 in cents — the donation tax credit applies to gifts of $5 or more
      statement: "Donation to an approved donee organisation. No goods or services were received in return. Retain this receipt to claim your donation tax credit.",
      source: "Inland Revenue New Zealand \u2014 Tax credits for donations (ird.govt.nz)"
    }
  };
  function contributionStatement(book, { donors = [], from = "", to = "\uFFFF", givingByMember, jurisdiction = "" } = {}) {
    if (typeof givingByMember !== "function") throw new Error("contributionStatement needs the givingByMember projection injected");
    const list = Array.isArray(donors) ? donors : donors instanceof Map ? [...donors.values()] : Object.values(donors || {});
    const byId = new Map(list.map((d) => [String(d.id), d]));
    const given = /* @__PURE__ */ new Map();
    for (const r of givingByMember(book, { from, to, donors: list })) if (r.donor) given.set(r.donor, r.amount);
    const rows = [];
    for (const [id, d] of byId) {
      const total = given.get(id) || 0;
      if (total <= 0) continue;
      rows.push({ donor: id, name: d.name || id, address: d.address || "", total });
    }
    rows.sort((a, b) => b.total - a.total);
    const totalDonated = rows.reduce((s, r) => s + r.total, 0);
    const rule = STATEMENT_RULES[jurisdiction] || {};
    return {
      rows,
      totalDonated,
      from,
      to,
      jurisdiction,
      statement: rule.statement || "",
      // the fixed legal line the receipt must carry (DATA, sourced)
      source: rule.source || "",
      requiredFields: rule.requiredFields || ["name", "total"]
    };
  }
  function contributionStatementDoc(stmt, { orgName = "", disclaimer = "", money = (m) => String(m) } = {}) {
    const s = stmt || {};
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const period = (s.from || "") + (s.to && s.to !== "\uFFFF" ? " to " + s.to : "");
    const body = (s.rows || []).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.address)}</td><td style="text-align:right">${esc(money(r.total))}</td></tr>`).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><title>Annual giving statement${orgName ? " \u2014 " + esc(orgName) : ""}</title></head><body><h1>Annual giving statement</h1>` + (orgName ? `<p>${esc(orgName)}</p>` : "") + (period ? `<p>Period: ${esc(period)}</p>` : "") + `<table><thead><tr><th>Donor</th><th>Address</th><th>Total</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td></td><td style="text-align:right">Total</td><td style="text-align:right">${esc(money(s.totalDonated || 0))}</td></tr></tfoot></table>` + (s.statement ? `<p>${esc(s.statement)}</p>` : "") + (s.source ? `<p><small>Source: ${esc(s.source)}</small></p>` : "") + (disclaimer ? `<p class="tax-disclaimer"><small>${esc(disclaimer)}</small></p>` : "") + "</body></html>";
  }
  function contributionReportFormats() {
    return [
      { key: "givingStatement", label: "Annual giving statement", pack: "contributionStatement", build: contributionStatement }
    ];
  }
  return __toCommonJS(finance_contribution_bundle_exports);
})();
