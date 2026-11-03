// GIVING BY MEMBER — THE ENGINE GROUPS IT, THE SCREEN SHOWS IT, AND NOTHING OFFERS TO SHARE IT.
//   Run: node --test scripts/finance-giving-by-member.test.mjs
//
// Phase 4b. Two halves, both required (AUDIT-PHASE-4 finding 5; CLAUDE.md rules 1 & 3):
//   · ENGINE — givingByMember groups income postings by the opaque `donor` id tagged on them, resolves the
//     name from the donor records, folds untagged giving into one "unattributed" row, and reconciles to the
//     period's income to the penny. The donor tag round-trips through the ledger's serialize/replay path.
//   · POINT-OF-USE — the REAL BooksGivingByMember component (sliced from app/stew-finance.jsx, compiled with
//     the packaged esbuild, rendered through the miniature React) shows member NAMES + amounts and carries NO
//     Share / Post-to-members control. A text match in the .jsx would pass over a `false &&`, so this asserts
//     on the RENDERED TREE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { createBook, addAccount, post, reverse } from '../src/finance-ledger.mjs';
import { givingByMember } from '../src/finance-reports.mjs';
import { bookToDocs, rebuildBook } from '../src/finance-store.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

function book() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  return b;
}
const gift = (b, minor, donor, date = '2026-05-01') =>
  post(b, { date, memo: 'Gift', postings: [{ account: 'bank', dir: 'dr', amount: minor }, { account: 'giving', dir: 'cr', amount: minor, ...(donor ? { donor } : {}) }] });
const donors = [{ id: 'd1', name: 'Ada Lovelace', eligible: true }, { id: 'd2', name: 'Ben Shaw', eligible: false }];

// ── ENGINE ───────────────────────────────────────────────────────────────────────────────────────────────
test('givingByMember groups by donor, names them, and folds untagged giving into "unattributed"', () => {
  const b = book();
  gift(b, 10000, 'd1'); gift(b, 2500, 'd1'); gift(b, 4000, 'd2'); gift(b, 1500, null);
  const rows = givingByMember(b, { donors });
  const by = Object.fromEntries(rows.map(r => [r.name, r.amount]));
  assert.equal(by['Ada Lovelace'], 12500, 'Ada\'s two gifts were not summed');
  assert.equal(by['Ben Shaw'], 4000, 'Ben\'s gift is wrong');
  assert.equal(by['(unattributed)'], 1500, 'untagged giving was not folded into the unattributed row');
  assert.equal(rows.find(r => r.name === 'Ada Lovelace').eligible, true, 'the Gift Aid eligibility flag was lost');
});

test('the rows reconcile to the period income to the penny', () => {
  const b = book();
  gift(b, 10000, 'd1'); gift(b, 4000, 'd2'); gift(b, 1500, null);
  const rows = givingByMember(b, { donors });
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  assert.equal(sum, 15500, 'Σ giving-by-member rows !== total income — the report does not reconcile');
});

test('the donor tag round-trips through bookToDocs → rebuildBook (it is not dropped on publish/replay)', () => {
  const b = book();
  gift(b, 10000, 'd1');
  const r = rebuildBook(bookToDocs(b));
  assert.equal((r.errors || []).length, 0, 'rebuild errored: ' + JSON.stringify(r.errors));
  const rows = givingByMember(r.book, { donors });
  assert.equal(rows.find(x => x.donor === 'd1') && rows.find(x => x.donor === 'd1').amount, 10000,
    'the donor tag did not survive serialize + replay — giving-by-member would silently lose the attribution');
});

test('a reversed gift nets the donor back to zero', () => {
  const b = book();
  const e = gift(b, 10000, 'd1');
  reverse(b, e.seq);
  const rows = givingByMember(b, { donors });
  assert.ok(!rows.some(r => r.donor === 'd1'), 'a fully-reversed donor still shows giving — the reversal did not carry the donor tag');
});

// ── POINT-OF-USE: the real component ───────────────────────────────────────────────────────────────────────
const SRC = readFileSync(join(ROOT, 'app/stew-finance.jsx'), 'utf8');
async function render(bk) {
  const src = fnBody(SRC, 'function BooksGivingByMember(', 'BooksGivingByMember');
  const tmp = join(tmpdir(), 'gbm-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { BooksGivingByMember };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  // the module-level helpers the slice leaves free: a real formatter and the real ledger surface + bkLbl token
  const globals = {
    React,
    booksFmt: (minor) => '£' + (minor / 100).toFixed(2),
    bkLbl: {},
    FinanceLedger: { givingByMember },
  };
  const key = '__gbm_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { BooksGivingByMember } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  const donorMap = new Map(donors.map(d => [d.id, d]));
  const tree = draw(BooksGivingByMember, { book: bk, F: globals.FinanceLedger, donors: donorMap });
  return { tree, words: texts(tree).join(' | ') };
}

test('the screen shows each donor\'s NAME and amount', async () => {
  const b = book();
  gift(b, 10000, 'd1'); gift(b, 4000, 'd2');
  const { words } = await render(b);
  assert.match(words, /Ada Lovelace/, 'the giving-by-member screen does not render the donor name — the feature is not on the screen (rule 1)');
  assert.match(words, /Ben Shaw/, 'a donor is missing from the screen');
  assert.match(words, /£100\.00/, 'the amount is not shown');
});

test('the screen carries NO interactive control — no button, no onClick (console-only, name-free share path intact)', async () => {
  // Structural, not a text match: a NAME-BEARING report must be a read-only list with NO Share / Post /
  // Export control of any kind, so it can never reach the broadcast path (aggregate statements are name-free).
  // Asserting on the rendered tree's controls, not on the explanatory copy, is what makes this survive rule 3.
  const b = book();
  gift(b, 10000, 'd1');
  const { tree } = await render(b);
  const buttons = find(tree, n => n.type === 'button');
  assert.equal(buttons.length, 0,
    'the giving-by-member screen has a button on it — it must be a read-only list with no share/post/export ' +
    'control. Found: ' + buttons.map(b2 => texts(b2).join('')).join(', '));
  const clickable = find(tree, n => n.props && typeof n.props.onClick === 'function');
  assert.equal(clickable.length, 0,
    'something on the giving-by-member screen is clickable — a name-bearing report must offer no action that ' +
    'could carry names off this console');
});
