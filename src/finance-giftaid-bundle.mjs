// Browser bundle: expose the UK Gift Aid REGIONAL PACK as window.FinanceGiftAid, SEPARATELY from the core
// window.FinanceLedger bundle. This is the additive seam DOMAIN nation-neutrality requires: the core bundle
// (src/finance-bundle.mjs) does NOT import the pack, so a church with Gift Aid off never ships UK tax logic.
// steward.html loads vendor/finance-giftaid.js, and the console calls into it ONLY when
// `church.features.giftAid === true`. Built by scripts/build-finance.sh alongside the core bundle.
export * from './finance-pack-giftaid.mjs';
