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

// DONATE IS DORMANT (owner, 2026-11-03): DONATE_ON is false because there is no owned Lightning address yet, and
// an unclaimed handle in a live prompt is money going to whoever registers it first. BOTH the "Support the project"
// button and the monthly auto-prompt gate on DONATE_ON, so with it off NOTHING donate-facing may render. These
// assertions are the tripwire: the code + button + monthly nudge are all merged and ready, but if a change makes
// either leak to the screen while DONATE_ON is off (or someone flips DONATE_ON on without owning the address and
// updating this test), a test turns red. When the owner supplies a real DONATE.ln and flips DONATE_ON to true,
// restore the live-UX assertions (git show c4289dbd for the originals) in the same change.

test('with donations OFF, the "Support the project" button is NOT on the Finance header', () => {
  const h = setup();
  h.ls.setItem(DUE_LS, String(Date.now() + 1000 * DAY));   // also snooze the monthly prompt, so this isolates the button
  h.draw();
  h.feedItems(seedItems());
  assert.ok(!h.button('Support the project'), 'the Support button must not render while DONATE_ON is off (no owned address yet)');
});

test('with donations OFF, the monthly prompt does NOT auto-open even when it would be due', () => {
  const h = setup();   // no next-due stored → it WOULD be due if DONATE_ON were on
  h.draw();
  h.feedItems(seedItems());
  assert.ok(!h.comp('BooksDonate'), 'the donation prompt must stay closed while DONATE_ON is off');
  // and the nudge must not have armed the monthly snooze — nothing donate-facing happened at all.
  assert.ok(!parseInt(h.ls.getItem(DUE_LS) || '0', 10), 'the off nudge must not touch the monthly-cadence gate');
});
