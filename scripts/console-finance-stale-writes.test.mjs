// Stale cache-first-seed writes in the console Finance page — finance-stale-writes 2026-11-05.
// Run: node --test scripts/console-finance-stale-writes.test.mjs
//
// Finance paints from a NIP-44-sealed on-disk SEED before the relay settles (console-finance-seed-preload). pubEntry
// already holds every JOURNAL write until a genuine post-EOSE delivery (bookRef.genuine). These tests cover the gap
// the reviewer found: the REPLACEABLE side docs (bill/donor/contact/account/fund/budget/template/reconcile/settings)
// had NO such hold, so a steward acting on the stale seed could re-publish one wholesale — e.g. approving a bill
// another steward VOIDED resurrects it (the void's journal reversal stays, so the doc then disagrees with the ledger).
//
// RULE 3: app/*.jsx ships UNBUNDLED, so a text-match on it is worthless (`false && …` leaves every word in place). So
// each handler is LIFTED out of the real source and EXECUTED — the guard either stops the write or it does not.
// The handler bodies carry no JSX (they are logic), so they compile under `new Function` with a fake component scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const JSX = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');

// anchors — the DEFINITION of each lifted closure, exactly as it stands in the source.
const ANCHOR = {
  guardWrite:        'guardWrite = (what) =>',
  saveAccount:       'saveAccount = async ({ id, code, name, type, archived }) =>',
  setAccountArchived:'setAccountArchived = (id, archived) =>',
  saveFund:          'saveFund = async ({ id, name, kind }) =>',
  setMultiCurrencyOn:'setMultiCurrencyOn = async (on) =>',
  saveBookSettings:  'saveBookSettings = async (patch) =>',
  saveTemplate:      'saveTemplate = async ({ id, name, account, fund, dir, amount, dayOfMonth }) =>',
  saveReconcile:     'saveReconcile = async ({ id, label, lines, reconciled, closing, asOf }) =>',
  saveDonor:         'saveDonor = async (patch) =>',
  saveContact:       'saveContact = async ({ id, name, email, address }) =>',
  approveBill:       'approveBill = async (bill) =>',
  voidBill:          'voidBill = async (bill) =>',
  saveBudget:        'saveBudget = async ({ id, year, lines }) =>',
};
const ORDER = ['guardWrite', 'saveAccount', 'setAccountArchived', 'saveFund', 'setMultiCurrencyOn', 'saveBookSettings',
  'saveTemplate', 'saveReconcile', 'saveDonor', 'saveContact', 'approveBill', 'voidBill', 'saveBudget'];

// Lift guardWrite + every guarded handler into ONE scope with a shared fake component context, so the REAL guardWrite
// decides whether the REAL handler reaches S.encPublish. `encPublished` records every relay write actually attempted;
// `dispatched` records the 'steward-write-blocked' UX events; `bookRef.genuine` is the live gate (flip it per case).
function loadHandlers(opts = {}) {
  const encPublished = [];
  const dispatched = [];
  const bookRef = {
    genuine: opts.genuine === true,
    current: { accounts: new Map(), funds: new Map(), journal: [], baseCurrency: 'GBP', decimals: 2, fiscalYearStart: '01-01', multiCurrency: false },
  };
  const ctx = {
    bookRef,
    useRelay: true,
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    window: { dispatchEvent: (e) => { dispatched.push(e); return true; } },
    S: { encPublish: (d, body) => { encPublished.push({ d, body }); return Promise.resolve('OK'); }, signerPub: () => 'a'.repeat(64) },
    bump: () => {},
    F: { addAccount: () => {}, addFund: () => {}, post: () => ({ seq: 1 }), isBillApproved: () => false },
    opaqueId: () => 'OPAQUE',
    booksSave: () => {},
    donors: opts.donors || [],
    billApprovalMode: opts.billApprovalMode || 'light',
    setTemplates: () => {}, setReconciles: () => {}, setDonors: () => {}, setContacts: () => {}, setBudgets: () => {},
    setBills: () => {}, setBillApprovals: () => {}, setBillFlash: () => {},
    billLiveEntries: () => [],          // voidBill: no live journal entries → the reversal loop is empty → we reach the DOC-write guard (the edge case)
    pubEntry: () => Promise.resolve(true),   // referenced only inside voidBill's (unreached) loop; defined so the name resolves
    _dropIfRefused: () => {},
  };
  let src = '';
  for (const n of ORDER) src += 'var ' + fnBody(JSX, ANCHOR[n]) + '\n';
  src += 'return { ' + ORDER.join(', ') + ' };';
  const names = Object.keys(ctx);
  const handlers = new Function(...names, src)(...names.map(k => ctx[k]));
  return { handlers, encPublished, dispatched, bookRef };
}

// ───────────────────────── #2 — the write gate on the replaceable side docs ─────────────────────────
test('#2: NO side-doc write fires while the book is still the stale cache-first seed (genuine=false)', async () => {
  const { handlers, encPublished, dispatched, bookRef } = loadHandlers();
  assert.equal(bookRef.genuine, false, 'precondition: the book has not had a genuine post-EOSE delivery');
  await Promise.all([
    handlers.saveAccount({ id: 'a1', code: '1000', name: 'Cash', type: 'asset', archived: false }),
    handlers.saveFund({ id: 'f1', name: 'Building', kind: 'restricted' }),
    handlers.setMultiCurrencyOn(true),
    handlers.saveBookSettings({ fiscalYearStart: '04-01' }),
    handlers.saveTemplate({ name: 'Rent', account: 'x', fund: 'general', dir: 'out', amount: 100, dayOfMonth: 1 }),
    handlers.saveReconcile({ label: 'Jan', lines: [], reconciled: [], closing: 0, asOf: '2026-01-31' }),
    handlers.saveDonor({ name: 'Jo Giver' }),
    handlers.saveContact({ name: 'Hall Hire', email: '', address: '' }),
    handlers.approveBill({ id: 'b1', number: '1', voided: false, by: 'recorder' }),
    handlers.voidBill({ id: 'b1', number: '1', by: 'recorder', receiveSeq: null }),
    handlers.saveBudget({ year: '2026', lines: [] }),
  ]);
  assert.equal(encPublished.length, 0, 'a side-doc write fired from the stale seed — it would overwrite the authoritative record: ' + JSON.stringify(encPublished.map(e => e.d)));
  assert.ok(dispatched.some(e => e.type === 'steward-write-blocked'), 'the treasurer was never told the books are still loading');
});

test('#2: once the book is GENUINE, the same side-doc writes DO fire — the gate is not a no-op', async () => {
  const { handlers, encPublished, bookRef } = loadHandlers({ genuine: true });
  bookRef.current.accounts.set('a1', { id: 'a1', code: '1000', name: 'Cash', type: 'asset', archived: false });
  bookRef.current.funds.set('f1', { id: 'f1', name: 'Building', kind: 'restricted' });
  await Promise.all([
    handlers.saveAccount({ id: 'a1', code: '1000', name: 'Cash', type: 'asset', archived: true }),
    handlers.saveFund({ id: 'f1', name: 'Building', kind: 'restricted' }),
    handlers.saveDonor({ name: 'Jo Giver' }),
    handlers.saveBudget({ year: '2026', lines: [] }),
  ]);
  const ds = encPublished.map(e => e.d);
  assert.ok(ds.includes('finance/account:a1'), 'saveAccount did not publish once the book was genuine');
  assert.ok(ds.includes('finance/fund:f1'), 'saveFund did not publish once the book was genuine');
  assert.ok(ds.includes('finance/donor:OPAQUE'), 'saveDonor did not publish once the book was genuine');
  assert.ok(ds.includes('finance/budget:OPAQUE'), 'saveBudget did not publish once the book was genuine');
});

test('#2 headline: approveBill does NOT resurrect a bill another steward VOIDED — no write from the stale seed', async () => {
  const { handlers, encPublished, dispatched, bookRef } = loadHandlers({ billApprovalMode: 'light' });
  bookRef.genuine = false;                      // only the cache-first seed is on screen
  // the SEED shows the bill LIVE (voided:false), but another steward has since VOIDED it on the relay. Light-mode
  // approve re-publishes finance/bill:<id> with `voided: !!bill.voided` = false → the void would be undone.
  const ok = await handlers.approveBill({ id: 'b9', number: '42', voided: false, by: 'recorder' });
  assert.equal(ok, false, 'approveBill reported success while the book was still the stale seed');
  assert.equal(encPublished.length, 0, 'approveBill re-published finance/bill:b9 from the stale seed — a voided bill would be resurrected');
  assert.ok(dispatched.some(e => e.type === 'steward-write-blocked' && e.detail && e.detail.what === 'bill approval'), 'the treasurer was not told to wait');
});

test('#2: a GENUINE approve preserves the bill\'s voided state (voided:true is NOT flipped by the write itself)', async () => {
  const { handlers, encPublished } = loadHandlers({ genuine: true, billApprovalMode: 'light' });
  await handlers.approveBill({ id: 'b9', number: '42', voided: true, by: 'recorder' });
  const w = encPublished.find(e => e.d === 'finance/bill:b9');
  assert.ok(w, 'approveBill did not publish once the book was genuine');
  assert.equal(w.body.voided, true, 'the approve write dropped the bill\'s voided flag — it must carry the genuine state wholesale');
});

test('#2: approveBill in DUAL mode also holds the approver-signed doc until the book is genuine', async () => {
  const { handlers, encPublished, bookRef } = loadHandlers({ billApprovalMode: 'dual' });
  bookRef.genuine = false;
  await handlers.approveBill({ id: 'b1', number: '1', by: 'someone-else' });   // not self → passes the separation-of-duties checks, reaches the gate
  assert.equal(encPublished.length, 0, 'a dual-control approval was published from the stale seed');
});

// ───────────────────────── #5 — the first-paint gate on the full-page preloader ─────────────────────────
test('#5 _shouldPreload: blank before first paint and on a church switch, but NEVER on a bare reconnect', () => {
  const body = fnBody(JSX, '_shouldPreload = (painted, prevIdv, idv) =>');
  const _shouldPreload = new Function('var ' + body + ';\nreturn _shouldPreload;')();
  assert.equal(_shouldPreload(false, 1, 1), true, 'the FIRST paint must show the preloader');
  assert.equal(_shouldPreload(true, 2, 3), true, 'a church/identity switch (idv moved) must show the preloader — a different book');
  assert.equal(_shouldPreload(true, 5, 5), false, 'a bare reconnect (already painted, idv unchanged) must NOT blank to the preloader — it would unmount an open dialog and lose typed input');
});
