// THE "SUPPORT THE PROJECT" BUTTON + THE MONTHLY DONATION PROMPT (owner, 2026-10-30).
//   Run: node --test scripts/the-support-the-project-button-opens-the-donate-panel.test.mjs
//
// CLAUDE.md rules 1 & 3 (point of use, rendered tree). Renders the REAL DashFinanceBook through
// console-screens.mjs and reads the tree — delete the button (or its setDonate wiring), or the monthly nudge
// effect, and the matching assertion turns red. The BooksDonate panel's own body is covered by
// every-console-dialog-mounts; here it is asserted MOUNTED (its element node present).
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook → header "Support the project" button +
// the monthly nudge useEffect → BooksDonate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reports = await import('../src/finance-reports.mjs');
const _budget = await import('../src/finance-budget.mjs');
const _charts = await import('../src/finance-charts.mjs');
const _juris = await import('../src/finance-jurisdictions.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reports, ..._budget, ..._charts, ..._juris };

const DUE_LS = 'trinityone.books.donateNextDue';
const DAY = 864e5;

function setup() {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '', pubkey: 'ab'.repeat(32),
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true, relayAuthed: () => true,
  });
  const { window, localStorage } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook }' });
  window.useStewardChurch = () => ({ name: 'St Test', features: {} });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const button = (label) => all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const comp = (name) => all().find(n => typeof n.type === 'function' && n.type.name === name);
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(items); draw(); };
  return { draw, all, button, comp, feedItems, ls: localStorage };
}

function seedItems() {
  const Y = new Date().getFullYear();
  return [
    { id: 'settings', baseCurrency: 'GBP', decimals: 2, fiscalYearStart: '01-01' },
    { id: 'account:bank', code: '1000', name: 'Bank', type: 'asset' },
    { id: 'account:giving', code: '4000', name: 'Giving', type: 'income' },
    { id: 'journal:1', seq: 1, date: Y + '-02-01', memo: 'Gift', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', dir: 'cr', amount: 10000 }] },
  ];
}

test('the "Support the project" button is on the Finance header and opens the BooksDonate panel', () => {
  const h = setup();
  h.ls.setItem(DUE_LS, String(Date.now() + 1000 * DAY));   // snooze the monthly auto-prompt so we test the BUTTON alone
  h.draw();
  h.feedItems(seedItems());

  const btn = h.button('Support the project');
  assert.ok(btn, 'the "Support the project" button is not on the Finance screen');
  assert.ok(!h.comp('BooksDonate'), 'the donate panel was open before the button was pressed');

  btn.props.onClick({ stopPropagation() {}, preventDefault() {} }); h.draw();
  assert.ok(h.comp('BooksDonate'), 'pressing "Support the project" did not open the BooksDonate panel');
});

test('the monthly prompt auto-opens when due and then snoozes itself ~30 days', () => {
  const h = setup();   // no next-due stored → due now
  h.draw();            // the nudge effect runs on mount (sets donate + snoozes)
  h.feedItems(seedItems());   // a book, so the screen renders its body (where the panel mounts)
  assert.ok(h.comp('BooksDonate'), 'the monthly donation prompt did not auto-open when it was due');
  const due = parseInt(h.ls.getItem(DUE_LS) || '0', 10);
  assert.ok(due > Date.now() + 25 * DAY && due < Date.now() + 35 * DAY, 'the prompt did not snooze itself ~30 days (monthly cadence)');
});

test('the monthly prompt stays closed when it is not yet due', () => {
  const h = setup();
  h.ls.setItem(DUE_LS, String(Date.now() + 10 * DAY));   // shown recently → not due for ~3 more weeks
  h.draw();
  h.feedItems(seedItems());
  assert.ok(!h.comp('BooksDonate'), 'the monthly prompt opened before it was due again');
});
