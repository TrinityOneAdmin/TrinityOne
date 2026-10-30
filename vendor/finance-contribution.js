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
    },
    // CANADA — an OFFICIAL DONATION RECEIPT (Income Tax Regulations s.3501). Unlike US/NZ it is NOT a single annual
    // summary: each receipt is PER DONOR and carries a UNIQUE SERIAL, the charity's CRA registration number, place +
    // date of issue, the donor's name/address, the gift amount, the eligible amount, an authorised signature line,
    // and the CRA name + website. The DONOR claims a non-refundable credit; the church reclaims nothing. The fixed
    // strings here are DATA, traced to CRA's "What information must be on an official donation receipt" (2026-10-30).
    CA: {
      label: "Canada",
      requiredFields: ["officialReceiptLine", "serial", "orgName", "orgAddress", "regNumber", "placeOfIssue", "dateGift", "dateIssued", "name", "donorAddress", "amount", "advantage", "eligibleAmount", "signature", "authorityName", "authorityUrl"],
      perDonorReceipt: true,
      // one serial-numbered OFFICIAL receipt per donor, not a single summary table
      needsReg: true,
      // the church must supply its CRA registration number (+ an authorised signatory)
      regLabel: "CRA charity registration number",
      officialReceiptLine: "Official receipt for income tax purposes",
      authorityName: "Canada Revenue Agency",
      authorityUrl: "canada.ca/charities-giving",
      amountMode: "caEligible",
      // gift · value of advantage · eligible amount (CRA)
      signature: true,
      // CRA requires an authorised signature
      certification: "",
      // CA's required wording is the officialReceiptLine heading, not a separate paragraph
      receiptDonorFields: [],
      // CA needs no extra per-donor fields beyond name/address
      statement: "",
      // CA's required wording is the officialReceiptLine on each receipt, not a summary line
      source: "Canada Revenue Agency \u2014 What information must be on an official donation receipt (Income Tax Regulations s.3501), canada.ca"
    },
    // SOUTH AFRICA — a SECTION 18A donation receipt. Per-donor, with a UNIQUE receipt number, the PBO's s18A
    // reference number, a certification under s.18A(2)(a), AND the FURTHER donor information prescribed by SARS
    // Notice 6762 of 2025 (GG 53589) under s.18A(2)(a)(vii) — IN FORCE from 1 March 2026 (verified from the
    // gazette, 2026-10-30): the donor's nature of person, identification type + country, ID/registration number,
    // income-tax reference number, contact number, email, and trading name (if different). The DONOR claims a
    // deduction (up to 10% of taxable income); the church reclaims nothing. Only an s18A-approved PBO may issue it.
    ZA: {
      label: "South Africa",
      requiredFields: ["officialReceiptLine", "serial", "orgName", "orgAddress", "regNumber", "dateIssued", "name", "donorAddress", "amount", "natureOfPerson", "idType", "idNumber", "taxRef", "contactNumber", "email", "certification"],
      perDonorReceipt: true,
      needsReg: true,
      regLabel: "SARS s18A / PBO reference number",
      officialReceiptLine: "Section 18A donation receipt",
      authorityName: "South African Revenue Service",
      authorityUrl: "sars.gov.za",
      amountMode: "nature",
      // amount of donation + nature (cash), not CA's advantage/eligible split
      signature: false,
      // s18A does not prescribe a signature line (unlike CRA)
      certification: "This receipt is issued in terms of section 18A(2)(a) of the Income Tax Act, 1962. The donation received will be used exclusively in carrying on public benefit activities in terms of section 18A.",
      // The FURTHER donor fields (SARS Notice 6762 of 2025, Schedule 2.1 + 2.3) — rendered per donor on the receipt.
      receiptDonorFields: [
        { key: "natureOfPerson", label: "Nature of person" },
        { key: "idType", label: "Identification type & country of issue" },
        { key: "idNumber", label: "Identification / registration number" },
        { key: "taxRef", label: "Income tax reference number" },
        { key: "contactNumber", label: "Contact number" },
        { key: "email", label: "Email address" },
        { key: "tradingName", label: "Trading name (if different)" }
      ],
      statement: "",
      source: "SARS Notice 6762 of 2025 (GG 53589) under s.18A(2)(a)(vii), in force 1 March 2026; s.18A(2)(a) Income Tax Act 1962 (sars.gov.za)"
    }
  };
  function contributionStatement(book, { donors = [], from = "", to = "\uFFFF", givingByMember, jurisdiction = "" } = {}) {
    if (typeof givingByMember !== "function") throw new Error("contributionStatement needs the givingByMember projection injected");
    const list = Array.isArray(donors) ? donors : donors instanceof Map ? [...donors.values()] : Object.values(donors || {});
    const byId = new Map(list.map((d) => [String(d.id), d]));
    const given = /* @__PURE__ */ new Map();
    for (const r of givingByMember(book, { from, to, donors: list })) if (r.donor) given.set(r.donor, r.amount);
    const rule = STATEMENT_RULES[jurisdiction] || {};
    const extraKeys = (rule.receiptDonorFields || []).map((f) => f.key);
    const rows = [];
    for (const [id, d] of byId) {
      const total = given.get(id) || 0;
      if (total <= 0) continue;
      const extra = {};
      for (const k of extraKeys) extra[k] = d[k] || "";
      rows.push({ donor: id, name: d.name || id, address: d.address || "", total, extra });
    }
    rows.sort((a, b) => b.total - a.total);
    const totalDonated = rows.reduce((s, r) => s + r.total, 0);
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
  function contributionStatementDoc(stmt, opts = {}) {
    const s = stmt || {};
    const {
      orgName = "",
      orgAddress = "",
      regNumber = "",
      authorizedBy = "",
      placeOfIssue = "",
      dateIssued = "",
      disclaimer = "",
      money = (m) => String(m)
    } = opts;
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const rule = STATEMENT_RULES[s.jurisdiction] || {};
    const period = (s.from || "") + (s.to && s.to !== "\uFFFF" ? " to " + s.to : "");
    const year = (s.from || dateIssued || "").slice(0, 4);
    const discP = disclaimer ? `<p class="tax-disclaimer"><small>${esc(disclaimer)}</small></p>` : "";
    if (rule.perDonorReceipt) {
      const regLine = regNumber ? `${esc(rule.regLabel || "Registration number")}: ${esc(regNumber)}` : `${esc(rule.regLabel || "Registration number")}: [REQUIRED \u2014 enter it in Tax tools]`;
      const receipts = (s.rows || []).map((r) => {
        const serial = (year ? year + "-" : "") + String(r.donor);
        const amountLine = rule.amountMode === "caEligible" ? `Amount of gift: ${esc(money(r.total))} \xB7 Value of advantage: ${esc(money(0))} \xB7 Eligible amount: ${esc(money(r.total))}` : `Amount of donation: ${esc(money(r.total))} \xB7 Nature: cash donation`;
        const extraLines = (rule.receiptDonorFields || []).map((f) => `<p>${esc(f.label)}: ${esc(r.extra && r.extra[f.key] || "[required]")}</p>`).join("");
        return `<section class="receipt" style="page-break-after:always;border:1px solid #ccc;padding:12px;margin:0 0 12px"><h2>${esc(rule.officialReceiptLine || "Official receipt")}</h2><p>Receipt no.: ${esc(serial)}</p><p>${esc(orgName)}${orgAddress ? ", " + esc(orgAddress) : ""}</p><p>${regLine}</p><p>Issued: ${esc(dateIssued || period)}${placeOfIssue ? " \xB7 " + esc(placeOfIssue) : ""}</p><p>Donor: ${esc(r.name)}${r.address ? ", " + esc(r.address) : ""}</p>` + extraLines + `<p>Gift received in: ${esc(period || year)}</p><p>${amountLine}</p>` + (rule.certification ? `<p>${esc(rule.certification)}</p>` : "") + (rule.signature ? `<p>Authorised signature: ${esc(authorizedBy)} _______________________</p>` : "") + `<p><small>${esc(rule.authorityName || "")}${rule.authorityUrl ? " \u2014 " + esc(rule.authorityUrl) : ""}</small></p>` + discP + "</section>";
      }).join("");
      return `<!doctype html><html><head><meta charset="utf-8"><title>Official donation receipts${orgName ? " \u2014 " + esc(orgName) : ""}</title></head><body><h1>Official donation receipts${orgName ? " \u2014 " + esc(orgName) : ""}</h1>` + (receipts || "<p>No attributed giving in this period.</p>") + "</body></html>";
    }
    const body = (s.rows || []).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.address)}</td><td style="text-align:right">${esc(money(r.total))}</td></tr>`).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><title>Annual giving statement${orgName ? " \u2014 " + esc(orgName) : ""}</title></head><body><h1>Annual giving statement</h1>` + (orgName ? `<p>${esc(orgName)}</p>` : "") + (period ? `<p>Period: ${esc(period)}</p>` : "") + `<table><thead><tr><th>Donor</th><th>Address</th><th>Total</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td></td><td style="text-align:right">Total</td><td style="text-align:right">${esc(money(s.totalDonated || 0))}</td></tr></tfoot></table>` + (s.statement ? `<p>${esc(s.statement)}</p>` : "") + (s.source ? `<p><small>Source: ${esc(s.source)}</small></p>` : "") + discP + "</body></html>";
  }
  function contributionReportFormats() {
    return [
      { key: "givingStatement", label: "Annual giving statement", pack: "contributionStatement", build: contributionStatement }
    ];
  }
  return __toCommonJS(finance_contribution_bundle_exports);
})();
