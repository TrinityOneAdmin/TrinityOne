// POINT-OF-USE (CLAUDE.md 1 & 3): editing a donor NEVER drops a stored field — not the jurisdiction
// cert/registry fields, and not the Gift-Aid name parts (title/firstName/lastName/house) no form captures.
//   Run: node --test scripts/finance-donor-edit-preserves-fields.test.mjs
//
// Renders the REAL DashFinanceBook through scripts/console-screens.mjs, feeds a fully-populated donor, then
// drives the rendered "Edit this donor" button (which must pass the FULL record to the form) and calls the
// wired saveDonor with only the fields the form controls (name changed, no name-parts) — exactly what a real
// submit sends. Asserts the published finance/donor doc keeps title/firstName/lastName/house + certType/
// certDeclaredAt/idNumber. Delete either half of the fix (the full-record pass OR the saveDonor merge) and the
// stored fields come back blank and this fails. Reads the rendered tree + the real publish, never .jsx text.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook — the Donors tab Edit button + saveDonor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

import * as _ledger from '../src/finance-ledger.mjs';
import * as _store from '../src/finance-store.mjs';
import * as _statement from '../src/finance-statement.mjs';
import * as _import from '../src/finance-import.mjs';
const FL = { ..._ledger, ..._store, ..._statement, ..._import };

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  return d;
});

function setup() {
  const fr = fakeReact();
  const pub = [];
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async (d, body) => { pub.push({ d, body }); return true; },
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const feed = (items) => { if (!encSubCb) draw(); assert.ok(encSubCb, 'encSubscribe not wired'); encSubCb(items); draw(); };
  return { fr, pub, draw, feed, get tree() { return tree; } };
}

function bookItems() {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  return toItems(FL.bookToDocs(b));
}

// A fully-populated donor, as stored on the relay (all fields present).
const DONOR = {
  id: 'donor:d1', name: 'Jane', title: 'Mrs', firstName: 'Jane', lastName: 'Okafor', house: '12',
  address: '12 High St', postcode: 'SW1A 1AA', eligible: true, giftAidDeclaredAt: '2026-01-01',
  certType: 'CHY3', certDeclaredAt: '2026-02-02', idNumber: 'ID-999', taxRef: 'TR-7',
};

const fnNode = (tree, name) => nodes(tree).find(n => typeof n.type === 'function' && n.type.name === name);

test('the Edit button passes the FULL record to the form (not a 6-field subset)', () => {
  const h = setup();
  h.feed([...bookItems(), DONOR]);
  fnNode(h.tree, 'FinTabStrip').props.setTab('donors'); h.draw();
  const edit = nodes(h.tree).find(n => n.type === 'button' && n.props && n.props.title === 'Edit this donor');
  assert.ok(edit, 'no "Edit this donor" button on the Donors tab');
  edit.props.onClick(); h.draw();
  const form = fnNode(h.tree, 'BooksDonor');
  assert.ok(form, 'clicking Edit did not open BooksDonor');
  for (const k of ['title', 'firstName', 'lastName', 'house', 'certType', 'certDeclaredAt', 'idNumber']) {
    assert.equal(form.props.initial[k], DONOR[k], `the form was handed a record missing "${k}" — the Edit button still passes a subset`);
  }
});

test('saveDonor MERGES over the stored doc: a partial submit keeps every unsupplied field', async () => {
  const h = setup();
  h.feed([...bookItems(), DONOR]);
  fnNode(h.tree, 'FinTabStrip').props.setTab('donors'); h.draw();
  nodes(h.tree).find(n => n.type === 'button' && n.props && n.props.title === 'Edit this donor').props.onClick(); h.draw();
  const save = fnNode(h.tree, 'BooksDonor').props.onSave;
  // What BooksDonor actually sends on a UK/none-region submit: the fields it controls, with the name edited —
  // crucially NOT title/firstName/lastName/house (no form captures them) and NOT idNumber (region not shown).
  const ok = await save({ id: 'd1', name: 'Jane Edited', eligible: true, address: '12 High St', postcode: 'SW1A 1AA', giftAidDeclaredAt: '2026-01-01', certType: '', certDeclaredAt: '' });
  assert.ok(ok, 'saveDonor did not report success');
  const doc = h.pub.filter(p => p.d === 'finance/donor:d1').pop();
  assert.ok(doc, 'saveDonor did not publish finance/donor:d1');
  assert.equal(doc.body.name, 'Jane Edited', 'the edited name was not saved');
  for (const k of ['title', 'firstName', 'lastName', 'house', 'idNumber', 'taxRef']) {
    assert.equal(doc.body[k], DONOR[k], `the saved doc blanked "${k}" — the merge did not preserve it`);
  }
});
