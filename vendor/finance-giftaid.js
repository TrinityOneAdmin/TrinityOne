var FinanceGiftAid = (() => {
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

  // src/finance-giftaid-bundle.mjs
  var finance_giftaid_bundle_exports = {};
  __export(finance_giftaid_bundle_exports, {
    GASDS_ANNUAL_CAP: () => GASDS_ANNUAL_CAP,
    GASDS_MAX_PER_DONATION: () => GASDS_MAX_PER_DONATION,
    GIFT_AID_RATE: () => GIFT_AID_RATE,
    gasdsSmallDonations: () => gasdsSmallDonations,
    giftAidClaim: () => giftAidClaim,
    giftAidReportFormats: () => giftAidReportFormats
  });

  // src/finance-pack-giftaid.mjs
  var GIFT_AID_RATE = 0.25;
  var GASDS_MAX_PER_DONATION = 3e3;
  var GASDS_ANNUAL_CAP = 8e5;
  var topUp = (minor, rate) => Math.round(minor * rate);
  function giftAidClaim(book, { donors = [], from = "", to = "\uFFFF", rate = GIFT_AID_RATE, givingByMember } = {}) {
    if (typeof givingByMember !== "function") throw new Error("giftAidClaim needs the givingByMember projection injected");
    const list = Array.isArray(donors) ? donors : donors instanceof Map ? [...donors.values()] : Object.values(donors || {});
    const byId = new Map(list.map((d) => [String(d.id), d]));
    const given = /* @__PURE__ */ new Map();
    for (const r of givingByMember(book, { from, to, donors: list })) if (r.donor) given.set(r.donor, r.amount);
    const rows = [];
    for (const [id, d] of byId) {
      if (!(d.eligible === true && d.giftAidDeclaredAt)) continue;
      const donated = given.get(id) || 0;
      if (donated <= 0) continue;
      rows.push({
        donor: id,
        title: d.title || "",
        firstName: d.firstName || "",
        lastName: d.lastName || "",
        name: d.name || id,
        house: d.house || "",
        postcode: d.postcode || "",
        donated,
        giftAid: topUp(donated, rate)
      });
    }
    rows.sort((a, b) => b.donated - a.donated);
    const totalDonated = rows.reduce((s, r) => s + r.donated, 0);
    const totalGiftAid = rows.reduce((s, r) => s + r.giftAid, 0);
    return { rows, totalDonated, totalGiftAid, rate, from, to };
  }
  function gasdsSmallDonations(donations = [], { maxPerDonation = GASDS_MAX_PER_DONATION, annualCap = GASDS_ANNUAL_CAP, rate = GIFT_AID_RATE } = {}) {
    const amounts = (donations || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const eligible = amounts.filter((n) => n <= maxPerDonation);
    const tooLarge = amounts.filter((n) => n > maxPerDonation);
    const eligibleTotal = eligible.reduce((s, n) => s + n, 0);
    const cappedTotal = Math.min(eligibleTotal, annualCap);
    return {
      count: eligible.length,
      eligibleTotal,
      // small donations that qualify, before the annual cap
      cappedTotal,
      // the amount the top-up is actually claimed on
      overCap: Math.max(0, eligibleTotal - annualCap),
      excludedOverLimit: tooLarge.reduce((s, n) => s + n, 0),
      // donations too large to be "small" (declaration route instead)
      topUp: topUp(cappedTotal, rate),
      maxPerDonation,
      annualCap,
      rate
    };
  }
  function giftAidReportFormats() {
    return [
      { key: "giftaid", label: "Gift Aid claim (UK)", pack: "giftAid", build: giftAidClaim },
      { key: "gasds", label: "GASDS small donations (UK)", pack: "giftAid", build: gasdsSmallDonations }
    ];
  }
  return __toCommonJS(finance_giftaid_bundle_exports);
})();
