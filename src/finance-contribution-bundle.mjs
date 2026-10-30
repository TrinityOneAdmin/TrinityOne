// Browser bundle: expose the SHARED CONTRIBUTION-STATEMENT pack as window.FinanceContribution, SEPARATELY from
// the core window.FinanceLedger bundle. This is the same additive seam DOMAIN nation-neutrality requires for Gift
// Aid: the core bundle (src/finance-bundle.mjs) does NOT import this pack, so a church with no tax tool on never
// ships a line of it. steward.html loads vendor/finance-contribution.js, and the console calls into it ONLY when
// the resolved jurisdiction's active tax tool is 'contributionStatement'. Built by scripts/build-finance.sh
// alongside the core + Gift Aid bundles.
export * from './finance-pack-contribution.mjs';
