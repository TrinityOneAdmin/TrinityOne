// THE SHARED CONTRIBUTION-STATEMENT PACK: per-donor summaries, the sourced receipt wording, the tax disclaimer
// on the generated document, and kept OUT of the nation-neutral core.
//   Run: node --test scripts/finance-pack-contribution.test.mjs
//
// Expansion wave. src/finance-pack-contribution.mjs is the SHARED engine behind taxTool:'contributionStatement'
// (US, New Zealand). Like the Gift Aid pack it is PURE (no DOM/relay/Date), works in INTEGER minor units, and is
// ADDITIVE — the core bundle must not import it. What it guards:
//   · a statement lists each NAMED donor who gave in the period, with their total (anonymous giving excluded);
//   · the country's required receipt WORDING is carried as DATA (STATEMENT_RULES), traced to the official source;
//   · the engine is CURRENCY-AGNOSTIC (a region whose suggested default is EUR runs identically on a USD book);
//   · the generated statement DOCUMENT carries the sourced wording AND the ONE shared tax disclaimer;
//   · STRUCTURAL: the pack is absent from the core bundle's and the registry's import graphs, present in its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createBook, addAccount, post, reverse } from '../src/finance-ledger.mjs';
import { givingByMember } from '../src/finance-reports.mjs';
import { TAX_DISCLAIMER } from '../src/finance-jurisdictions.mjs';
import {
  contributionStatement, contributionStatementDoc, contributionReportFormats, STATEMENT_RULES,
} from '../src/finance-pack-contribution.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

function book(ccy = 'USD') {
  const b = createBook({ baseCurrency: ccy, decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  return b;
}
const gift = (b, minor, donor, date = '2026-05-01') =>
  post(b, { date, memo: 'Gift', postings: [{ account: 'bank', dir: 'dr', amount: minor }, { account: 'giving', dir: 'cr', amount: minor, ...(donor ? { donor } : {}) }] });

// ── per-donor summary: named donors only, anonymous excluded ──────────────────────────────────────────────
test('US worked example — a statement lists each named donor who gave, excludes anonymous plate cash', () => {
  const b = book('USD');
  gift(b, 120000, 'd1');   // $1,200 — Ada
  gift(b, 30000, 'd2');    // $300 — Ben
  gift(b, 5000, null);     // anonymous plate cash → no record → off the statement
  const donors = [{ id: 'd1', name: 'Ada', address: '1 Main St' }, { id: 'd2', name: 'Ben', address: '2 Oak Ave' }];
  const s = contributionStatement(b, { donors, givingByMember, jurisdiction: 'US' });
  assert.deepEqual(s.rows.map(r => r.name), ['Ada', 'Ben'], 'the statement did not list exactly the two named donors (sorted by amount): ' + JSON.stringify(s.rows.map(r => r.name)));
  assert.equal(s.rows[0].total, 120000, 'the top donor total is wrong');
  assert.equal(s.rows[0].address, '1 Main St', 'the donor address did not ride onto the statement row');
  assert.equal(s.totalDonated, 150000, 'the statement total is not the sum of the named rows (anonymous must be excluded)');
  // the sourced US wording is carried as data (IRS Pub 1771)
  assert.equal(s.statement, STATEMENT_RULES.US.statement, 'the US statement did not carry its STATEMENT_RULES wording');
  assert.ok(/intangible religious benefits/.test(s.statement), 're-anchor: the US wording is not the Pub 1771 line');
});

test('NZ worked example — the statement carries the IRD donation-tax-credit wording', () => {
  const b = book('NZD');
  gift(b, 10000, 'd1');   // $100 — over the $5 claim floor
  const s = contributionStatement(b, { donors: [{ id: 'd1', name: 'Hemi' }], givingByMember, jurisdiction: 'NZ' });
  assert.equal(s.rows.length, 1, 'the NZ statement did not include the one donor');
  assert.equal(s.statement, STATEMENT_RULES.NZ.statement, 'the NZ statement did not carry its STATEMENT_RULES wording');
  assert.ok(/donation tax credit/.test(s.statement), 're-anchor: the NZ wording is not the IRD donation-tax-credit line');
});

test('a donor with no giving in the period is left out (an empty statement is not a statement)', () => {
  const b = book();
  gift(b, 5000, 'd1', '2025-05-01');   // last year
  const s = contributionStatement(b, { donors: [{ id: 'd1', name: 'Ada' }], from: '2026-01-01', to: '2026-12-31', givingByMember, jurisdiction: 'US' });
  assert.equal(s.rows.length, 0, 'a donor with no giving in the period produced a statement line');
  assert.equal(s.totalDonated, 0);
});

test('a reversed gift nets out of the donor\'s statement', () => {
  const b = book();
  const e = gift(b, 10000, 'd1');
  reverse(b, e.seq);
  const s = contributionStatement(b, { donors: [{ id: 'd1', name: 'Ada' }], givingByMember, jurisdiction: 'US' });
  assert.equal(s.totalDonated, 0, 'a reversed gift still produced a statement total — the donor tag did not ride the reversal');
});

// ── CURRENCY is DECOUPLED from the tax scheme ───────────────────────────────────────────────────────────
test('the engine is currency-agnostic — it sums minor units regardless of the book base currency', () => {
  // A church on a EUR book running the US statement tool (its suggested default is USD) must still reconcile.
  const b = book('EUR');
  gift(b, 50000, 'd1');
  const s = contributionStatement(b, { donors: [{ id: 'd1', name: 'Ada' }], givingByMember, jurisdiction: 'US' });
  assert.equal(s.totalDonated, 50000, 'the statement total changed with the base currency — the engine is not currency-agnostic');
});

test('contributionStatement throws without the givingByMember projection injected (one grouping rule)', () => {
  assert.throws(() => contributionStatement(book(), { donors: [{ id: 'd1', name: 'Ada' }], jurisdiction: 'US' }), /givingByMember/);
});

// ── the GENERATED DOCUMENT carries the sourced wording AND the ONE shared tax disclaimer ────────────────
test('the generated statement document embeds the donor rows, the sourced wording, and the TAX disclaimer', () => {
  const b = book('USD');
  gift(b, 120000, 'd1');
  const s = contributionStatement(b, { donors: [{ id: 'd1', name: 'Ada', address: '1 Main St' }], givingByMember, jurisdiction: 'US' });
  // The console passes the ONE shared constant (TAX_DISCLAIMER) — this proves the figures that LEAVE the app
  // carry the caveat, in the generated OUTPUT (not source text).
  const html = contributionStatementDoc(s, { orgName: 'Grace Church', disclaimer: TAX_DISCLAIMER, money: (m) => '$' + (m / 100).toFixed(2) });
  assert.ok(html.includes('Ada'), 'the generated statement does not list the donor');
  assert.ok(html.includes('$1200.00'), 'the generated statement does not show the formatted donor total');
  assert.ok(html.includes('Grace Church'), 'the generated statement does not name the church');
  assert.ok(html.includes(STATEMENT_RULES.US.statement), 'the generated statement does not carry the sourced receipt wording');
  assert.ok(html.includes(TAX_DISCLAIMER), 'the generated statement does NOT carry the shared tax disclaimer — a figure left the app without the caveat');
});

test('the document HTML-escapes a donor name (a free-text field cannot inject markup)', () => {
  const b = book();
  gift(b, 1000, 'd1');
  const s = contributionStatement(b, { donors: [{ id: 'd1', name: '<script>x</script>' }], givingByMember, jurisdiction: 'US' });
  const html = contributionStatementDoc(s, { disclaimer: TAX_DISCLAIMER });
  assert.ok(!html.includes('<script>x</script>'), 'a donor name was written into the document unescaped');
  assert.ok(html.includes('&lt;script&gt;'), 're-anchor: the name was not escaped at all');
});

test('contributionReportFormats advertises the givingStatement format (not colliding with the aggregate "statement")', () => {
  const fmts = contributionReportFormats();
  assert.ok(fmts.some(f => f.key === 'givingStatement' && f.pack === 'contributionStatement' && typeof f.build === 'function'), 'the pack does not advertise its report format');
});

// ── STRUCTURAL: the pack stays OUT of the core bundle and the registry, and INSIDE its own bundle ─────────
function importGraph(entry) {
  const dir = mkdtempSync(join(tmpdir(), 'cs-meta-'));
  try {
    execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
      [join(ROOT, entry), '--bundle', '--format=iife', '--metafile=' + join(dir, 'm.json'), '--outfile=' + join(dir, 'out.js'), '--log-level=error']);
    return Object.keys(JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')).inputs);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const leaksPack = (inputs) => inputs.filter(p => /finance-pack-contribution\.mjs$|finance-contribution-bundle\.mjs$/.test(p));

test('src/finance-bundle.mjs (the core) does NOT import the contribution pack', () => {
  const inputs = importGraph('src/finance-bundle.mjs');
  assert.ok(inputs.some(p => p.endsWith('finance-ledger.mjs')), 're-anchor: this is not the core graph');
  assert.deepEqual(leaksPack(inputs), [], 'the contribution pack is in the CORE bundle\'s import graph — a church with no tax tool would ship it. Keep it in src/finance-contribution-bundle.mjs only: ' + leaksPack(inputs).join(', '));
});

test('src/finance-jurisdictions.mjs (the registry) does NOT import the contribution pack', () => {
  const inputs = importGraph('src/finance-jurisdictions.mjs');
  assert.ok(inputs.some(p => p.endsWith('finance-jurisdictions.mjs')), 're-anchor: the registry graph does not include the registry');
  assert.deepEqual(leaksPack(inputs), [], 'the registry imports the contribution pack — it must name the tax tool by STRING only: ' + leaksPack(inputs).join(', '));
});

test('the contribution bundle DOES import the pack (re-anchor: the separate bundle is real)', () => {
  const inputs = importGraph('src/finance-contribution-bundle.mjs');
  assert.ok(inputs.some(p => p.endsWith('finance-pack-contribution.mjs')), 'the contribution bundle does not import the pack — it ships nowhere');
});
