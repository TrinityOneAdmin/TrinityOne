// POINT-OF-USE (CLAUDE.md 1 & 3): the account/fund/contact/donor save buttons show a BUSY state while saving
// over the thin pipe, instead of looking idle+clickable. Run: node --test scripts/finance-dialog-busy-state.test.mjs
//
// Renders the REAL dialogs through scripts/console-screens.mjs, clicks Save with an onSave that never resolves,
// and asserts the button goes disabled + "Saving…" + off the clay fill. Reads the rendered tree; revert the
// busy styling and it goes red.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook mounts these dialogs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

import * as _ledger from '../src/finance-ledger.mjs';
import * as _store from '../src/finance-store.mjs';
import * as _statement from '../src/finance-statement.mjs';
import * as _import from '../src/finance-import.mjs';
const FL = { ..._ledger, ..._store, ..._statement, ..._import };

function load(expr) {
  const fr = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward({ actingChurch: '' }) });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr });
  return { fr, mods };
}
const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes(label)));

function checkBusy(name, Comp, props, idleLabel) {
  const { fr, mods } = load('{ ' + name + ' }');
  assert.equal(typeof mods[name], 'function', `${name} is not exported from the console scope`);
  let tree;
  const draw = () => { fr.reset(); tree = mods[name](props); fr.flush(); return tree; };
  draw();
  const save = button(tree, idleLabel);
  assert.ok(save, `${name}: no "${idleLabel}" button before saving`);
  assert.ok(!(save.props.style || {}).background || save.props.style.background === 'var(--clay)', `${name}: idle Save should be the clay colour`);
  save.props.onClick();   // submit → setBusy(true), then awaits the never-resolving onSave
  draw();
  const busy = button(tree, 'Saving…');
  assert.ok(busy, `${name}: the Save button shows no "Saving…" state while saving`);
  assert.equal(busy.props.disabled, true, `${name}: the Save button is not disabled while saving`);
  assert.notEqual((busy.props.style || {}).background, 'var(--clay)', `${name}: the Save button still looks idle (clay) while saving`);
}

const PENDING = () => new Promise(() => {});   // never resolves — holds the dialog in the busy state

test('BooksAccountEdit Save shows a busy state', () => {
  checkBusy('BooksAccountEdit', null, {
    book: { accounts: new Map([['x', { id: 'x', code: '5300', name: 'Youth', type: 'expense' }]]), funds: new Map(), journal: [], decimals: 2, baseCurrency: 'GBP' },
    initial: { id: 'x', code: '5300', name: 'Youth', type: 'expense', posted: false },
    onSave: PENDING, onClose() {},
  }, 'Save changes');
});

test('BooksDonor Save shows a busy state', () => {
  checkBusy('BooksDonor', null, {
    book: { baseCurrency: 'GBP', decimals: 2 },
    initial: { id: 'd1', name: 'Jane' }, giftAidOn: false, statementOn: false, cdsOn: false, extraFields: [],
    onSave: PENDING, onClose() {},
  }, 'Save changes');
});
