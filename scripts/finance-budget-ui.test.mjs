// THE BUDGET EDITOR AND THE OVER-BUDGET BADGE ARE ON THE SCREEN.
//   Run: node --test scripts/finance-budget-ui.test.mjs
//
// Phase 7 point-of-use (CLAUDE.md rules 1 & 3 — assert on the RENDERED tree, never on text in app/*.jsx,
// which ships unbundled so `false &&` would leave the words in place). It slices the REAL components out of
// app/stew-finance.jsx, compiles them with the packaged esbuild, renders them, and asserts on the tree:
//   · BooksBudgetReport renders an OVER-BUDGET badge when an expense line is over plan — DELETE the badge
//     from the component and this fails (the badge is marked data-budget-badge="over");
//   · with an empty budget it shows NO badge and the "no budget set" line instead (no false alert);
//   · BooksBudgetEdit (the editor dialog) renders a category picker, an amount field and a Save control —
//     delete any and this fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { createBook, addAccount, addFund, post } from '../src/finance-ledger.mjs';
import { budgetVsActual, incomeExpenditureByFund } from '../src/finance-budget.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

async function loadComponent(file, name, anchor, globals) {
  const src = fnBody(read(file), anchor, name);
  const tmp = join(tmpdir(), 'bgui-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__bgui_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}

// A church whose outreach spend (£150) is over a £100 budget.
function book() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'outreach', code: '5100', name: 'Outreach', type: 'expense' });
  addFund(b, { id: 'building', name: 'Building fund', kind: 'restricted' });
  post(b, { date: '2026-02-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] });
  post(b, { date: '2026-03-21', memo: 'leaflets', postings: [{ account: 'outreach', dir: 'dr', amount: 15000 }, { account: 'bank', dir: 'cr', amount: 15000 }] });
  return b;
}
const F = { budgetVsActual, incomeExpenditureByFund };
const reportGlobals = (React) => ({ React, booksFmt: (m) => '£' + (m / 100).toFixed(2) });
const YEAR = { from: '2026-01-01', to: '2026-12-31' };

test('BooksBudgetReport shows an over-budget badge when an expense line is over plan', async () => {
  const { React, draw } = miniReact();
  const BooksBudgetReport = await loadComponent('app/stew-finance.jsx', 'BooksBudgetReport', 'function BooksBudgetReport(', reportGlobals(React));
  const tree = draw(BooksBudgetReport, { book: book(), F, budget: { year: '2026', lines: [{ account: 'outreach', fund: '', amount: 10000 }] }, from: YEAR.from, to: YEAR.to });
  const badges = find(tree, n => n.props && n.props['data-budget-badge'] === 'over');
  assert.equal(badges.length, 1, 'the over-budget badge is not on the screen — the variance alert is not surfaced');
  assert.ok(/over by/i.test(texts(badges[0]).join(' ')), 'the over-budget badge does not say how much it is over by');
});

test('BooksBudgetReport with an empty budget shows no badge and a "no budget set" line (no false alert)', async () => {
  const { React, draw } = miniReact();
  const BooksBudgetReport = await loadComponent('app/stew-finance.jsx', 'BooksBudgetReport', 'function BooksBudgetReport(', reportGlobals(React));
  const tree = draw(BooksBudgetReport, { book: book(), F, budget: { year: '2026', lines: [] }, from: YEAR.from, to: YEAR.to });
  assert.equal(find(tree, n => n.props && n.props['data-budget-badge'] === 'over').length, 0, 'an empty budget must raise NO over-budget badge');
  assert.ok(/no budget set/i.test(texts(tree).join(' ')), 'an empty budget should invite the steward to set one');
});

test('BooksBudgetReport does NOT badge an under-budget line', async () => {
  const { React, draw } = miniReact();
  const BooksBudgetReport = await loadComponent('app/stew-finance.jsx', 'BooksBudgetReport', 'function BooksBudgetReport(', reportGlobals(React));
  const tree = draw(BooksBudgetReport, { book: book(), F, budget: { year: '2026', lines: [{ account: 'outreach', fund: '', amount: 20000 }] }, from: YEAR.from, to: YEAR.to });
  assert.equal(find(tree, n => n.props && n.props['data-budget-badge'] === 'over').length, 0, 'a £150 spend against a £200 budget must not flag over');
});

test('BooksBudgetEdit renders a category picker, an amount field and a Save control', async () => {
  const { React, draw } = miniReact();
  const BooksBudgetEdit = await loadComponent('app/stew-finance.jsx', 'BooksBudgetEdit', 'function BooksBudgetEdit(', {
    React, useStewDialog: () => ({ current: null }),
    bkCard: {}, bkLbl: {}, bkFld: {}, CCY_SYM: { GBP: '£' },
    booksParse: (s) => Math.round(parseFloat(s || '0') * 100) || 0,
  });
  const tree = draw(BooksBudgetEdit, { book: book(), initial: { year: '2026', lines: [] }, onSave: () => true, onClose() {} });
  assert.equal(find(tree, n => n.props && n.props.role === 'dialog').length, 1, 'BooksBudgetEdit did not render a dialog');
  assert.ok(find(tree, n => n.type === 'select').length >= 1, 'the budget editor has no category picker');
  assert.ok(find(tree, n => n.type === 'input').length >= 1, 'the budget editor has no amount field');
  const buttons = find(tree, n => n.type === 'button');
  assert.ok(buttons.some(b => /save budget/i.test(texts(b).join(' '))), 'there is no Save control on the budget editor: ' + buttons.map(b => texts(b).join('')).join(', '));
});
