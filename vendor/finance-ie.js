var FinanceIrishCDS = (() => {
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

  // src/finance-ie-bundle.mjs
  var finance_ie_bundle_exports = {};
  __export(finance_ie_bundle_exports, {
    CDS_ASSOCIATED_INCOME_FRACTION: () => CDS_ASSOCIATED_INCOME_FRACTION,
    CDS_MAX_ANNUAL: () => CDS_MAX_ANNUAL,
    CDS_MIN_ANNUAL: () => CDS_MIN_ANNUAL,
    CDS_SPECIFIED_RATE: () => CDS_SPECIFIED_RATE,
    cdsGrossUp: () => cdsGrossUp,
    cdsRefund: () => cdsRefund,
    cdsReportFormats: () => cdsReportFormats,
    charitableDonationClaim: () => charitableDonationClaim
  });

  // src/finance-pack-ie.mjs
  var CDS_SPECIFIED_RATE = 31;
  var CDS_MIN_ANNUAL = 25e3;
  var CDS_MAX_ANNUAL = 1e8;
  var CDS_ASSOCIATED_INCOME_FRACTION = 0.1;
  var cdsGrossUp = (minor, rate = CDS_SPECIFIED_RATE) => Math.round(minor * 100 / (100 - rate));
  var cdsRefund = (minor, rate = CDS_SPECIFIED_RATE) => cdsGrossUp(minor, rate) - minor;
  function charitableDonationClaim(book, {
    donors = [],
    from = "",
    to = "\uFFFF",
    givingByMember,
    rate = CDS_SPECIFIED_RATE,
    minAnnual = CDS_MIN_ANNUAL,
    maxAnnual = CDS_MAX_ANNUAL
  } = {}) {
    if (typeof givingByMember !== "function") throw new Error("charitableDonationClaim needs the givingByMember projection injected");
    const list = Array.isArray(donors) ? donors : donors instanceof Map ? [...donors.values()] : Object.values(donors || {});
    const byId = new Map(list.map((d) => [String(d.id), d]));
    const given = /* @__PURE__ */ new Map();
    for (const r of givingByMember(book, { from, to, donors: list })) if (r.donor) given.set(r.donor, r.amount);
    const rows = [];
    const needsReview = [];
    for (const [id, d] of byId) {
      if (!(d.eligible === true && (d.certType === "CHY3" || d.certType === "CHY4") && d.certDeclaredAt)) continue;
      const donated = given.get(id) || 0;
      if (donated < minAnnual) continue;
      let qualifying = Math.min(donated, maxAnnual);
      if (d.associated === true) {
        if (!(Number.isFinite(d.income) && d.income > 0)) {
          needsReview.push({ donor: id, name: d.name || id, donated, reason: "associated donor \u2014 needs total income to apply the 10% relief restriction" });
          continue;
        }
        qualifying = Math.min(qualifying, Math.floor(d.income * CDS_ASSOCIATED_INCOME_FRACTION));
        if (qualifying <= 0) continue;
      }
      rows.push({
        donor: id,
        name: d.name || id,
        address: d.address || "",
        certType: d.certType,
        donated: qualifying,
        refund: cdsRefund(qualifying, rate)
      });
    }
    rows.sort((a, b) => b.donated - a.donated);
    const totalDonated = rows.reduce((s, r) => s + r.donated, 0);
    const totalRefund = rows.reduce((s, r) => s + r.refund, 0);
    return { rows, needsReview, totalDonated, totalRefund, rate, from, to };
  }
  function cdsReportFormats() {
    return [
      { key: "cdsClaim", label: "Charitable Donation Scheme claim (Ireland)", pack: "charitableDonationScheme", build: charitableDonationClaim }
    ];
  }
  return __toCommonJS(finance_ie_bundle_exports);
})();
