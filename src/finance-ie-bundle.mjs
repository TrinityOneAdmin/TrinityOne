// Browser bundle: expose the IRELAND Charitable Donation Scheme RECLAIM pack as window.FinanceIrishCDS,
// SEPARATELY from the core window.FinanceLedger bundle. Same nation-neutral seam as Gift Aid: the core bundle
// (src/finance-bundle.mjs) does NOT import this pack, so a church with no Irish tax tool on never ships a line of
// it. steward.html loads vendor/finance-ie.js, and the console calls into it ONLY when the resolved jurisdiction's
// active tax tool is 'charitableDonationScheme'. Built by scripts/build-finance.sh alongside the other packs.
export * from './finance-pack-ie.mjs';
