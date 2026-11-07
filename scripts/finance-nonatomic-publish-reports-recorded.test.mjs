// A non-atomic finance write (journal entry LANDS, metadata doc FAILS) must NOT be reported as a flat failure.
// Run: node --test scripts/finance-nonatomic-publish-reports-recorded.test.mjs
//
// THE BUG (verified real, LOW): issueInvoice / creditInvoice / recordBill each post a JOURNAL entry (dr AR / cr
// income, or dr expense / cr AP) via `await pubEntry`, THEN publish a REPLACEABLE metadata doc via
// `await S.encPublish('finance/invoice|bill:<id>', body)`. If that SECOND publish fails (a transient relay drop)
// AFTER the journal already landed, the handler used to return a flat `false`. The form then told the treasurer it
// "didn't post → nothing recorded", so they re-entered it → a SECOND journal entry → income+AR (or expense+AP)
// DOUBLE-COUNTED. The fix distinguishes the two failure modes:
//   · journal REFUSED (pubEntry falsy)            → _dropIfRefused + return false   (retry is safe and correct)
//   · journal LANDED, metadata doc FAILED         → steward-write-blocked "recorded, details didn't save; don't
//                                                    re-enter it" + return the DISTINCT sentinel 'recorded-no-details'
//
// RULE 3: app/*.jsx ships UNBUNDLED, so a text-match on it is worthless (`false && …` leaves every word in place).
// So each handler is LIFTED out of the real source and EXECUTED — if the distinct recorded-but-details-missing path
// is deleted from the screen, the handler returns false / dispatches nothing and these tests go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const JSX = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');

// anchors — the DEFINITION of each lifted closure, exactly as it stands in the source.
const ANCHOR = {
  ensureAr:      'ensureAr = async () =>',
  ensureAp:      'ensureAp = async () =>',
  issueInvoice:  'issueInvoice = async ({ number, contact, lines, issued, due }) =>',
  creditInvoice: 'creditInvoice = async (inv) =>',
  recordBill:    'recordBill = async ({ number, supplier, lines, received, due }) =>',
};
const ORDER = ['ensureAr', 'ensureAp', 'issueInvoice', 'creditInvoice', 'recordBill'];

// Lift the REAL handlers into one scope. `pubEntry` is the JOURNAL write (the relay entry); `S.encPublish` is the
// REPLACEABLE metadata doc. `opts.entryLands` controls pubEntry; `opts.docOk` controls encPublish — so we can drive
// EXACTLY the gap under test: entry landed, doc failed. `dispatched` records the steward-facing UX events;
// `dropped` records _dropIfRefused (the rollback that is CORRECT for a refused entry and WRONG once it has landed).
function loadHandlers(opts = {}) {
  const encPublished = [];
  const dispatched = [];
  const dropped = [];
  const bookRef = {
    genuine: true,
    current: { accounts: new Map(), funds: new Map(), journal: [], baseCurrency: 'GBP', decimals: 2 },
  };
  const docOk = opts.docOk;                 // true | false | null
  const entryLands = opts.entryLands !== false;
  const ctx = {
    bookRef,
    book: bookRef.current,
    useRelay: true,
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    window: { dispatchEvent: (e) => { dispatched.push(e); return true; } },
    S: {
      encPublish: (d, body) => { encPublished.push({ d, body }); return Promise.resolve(docOk === undefined ? 'OK' : docOk); },
      signerPub: () => 'a'.repeat(64),
    },
    bump: () => {},
    F: {
      assertArAccount: () => true, assertApAccount: () => true, addAccount: () => {},
      AR_ACCOUNT: { id: 'ar', code: '1100', name: 'Accounts receivable', type: 'asset' },
      AP_ACCOUNT: { id: 'ap', code: '2100', name: 'Accounts payable', type: 'liability' },
      post: () => ({ seq: 7 }),
      invoiceIssueEntry: (x) => x, creditNoteEntry: () => ({}), billReceiveEntry: () => ({}),
    },
    booksRandId: () => 'RID',
    booksTodayISO: () => '2026-11-07',
    pubEntry: () => Promise.resolve(entryLands),      // the JOURNAL write — LANDS unless a test says otherwise
    _dropIfRefused: (b, entry) => { dropped.push(entry); },
    setInvoices: () => {}, setBills: () => {},
  };
  let src = '';
  for (const n of ORDER) src += 'var ' + fnBody(JSX, ANCHOR[n]) + '\n';
  src += 'return { ' + ORDER.join(', ') + ' };';
  const names = Object.keys(ctx);
  const handlers = new Function(...names, src)(...names.map(k => ctx[k]));
  return { handlers, encPublished, dispatched, dropped };
}

const INV_LINES  = [{ desc: 'Hall hire', account: 'inc1', fund: 'general', amount: 5000 }];
const BILL_LINES = [{ desc: 'Repairs', account: 'exp1', fund: 'general', amount: 3200 }];

// A recorded-but-details-missing message must NOT invite re-entry and must NOT claim nothing was recorded.
function saysRecordedNotLost(msg) {
  const m = String(msg || '').toLowerCase();
  return /record/.test(m) && /don.?t re-?enter|don.?t raise it again/.test(m) && !/nothing (was|has been) recorded/.test(m);
}

// ───────────── the gap: journal LANDS, metadata doc FAILS ─────────────
for (const [name, call] of [
  ['issueInvoice',  (h) => h.issueInvoice({ number: '2026-014', contact: 'Jo', lines: INV_LINES, issued: '2026-11-07', due: '' })],
  ['creditInvoice', (h) => h.creditInvoice({ id: 'inv1', number: '2026-014', contact: 'Jo', lines: INV_LINES })],
  ['recordBill',    (h) => h.recordBill({ number: 'INV-4471', supplier: 'Acme', lines: BILL_LINES, received: '2026-11-07', due: '' })],
]) {
  test(`${name}: entry lands but the doc publish fails → distinct sentinel, NOT a flat false`, async () => {
    const { handlers, encPublished, dispatched, dropped } = loadHandlers({ docOk: null });
    const ret = await call(handlers);
    assert.equal(encPublished.length, 1, `${name} must still attempt the metadata doc (the journal already landed)`);
    assert.notEqual(ret, false, `${name} returned a flat false — the form says "nothing recorded" and the treasurer re-enters → DOUBLE-COUNT`);
    assert.equal(ret, 'recorded-no-details', `${name} must return the distinct sentinel so the form closes without inviting re-entry`);
    assert.equal(dropped.length, 0, `${name} rolled the journal back with _dropIfRefused — the entry LANDED, there is nothing to drop`);
    const blocked = dispatched.find(e => e.type === 'steward-write-blocked');
    assert.ok(blocked, `${name} did not tell the treasurer anything — the recorded-but-details-missing path was deleted from the screen`);
    assert.ok(saysRecordedNotLost(blocked.detail && blocked.detail.message),
      `${name}'s message must say the money WAS recorded and NOT to re-enter it — got: ${blocked.detail && blocked.detail.message}`);
  });
}

// ───────────── control 1: full success returns true ─────────────
test('issueInvoice: journal lands AND doc publishes → true (no false alarm)', async () => {
  const { handlers, dispatched } = loadHandlers({ docOk: 'OK' });
  const ret = await handlers.issueInvoice({ number: '1', contact: 'Jo', lines: INV_LINES, issued: '2026-11-07', due: '' });
  assert.equal(ret, true, 'a fully successful issue must report true');
  assert.ok(!dispatched.some(e => e.type === 'steward-write-blocked'), 'a successful issue must not raise a write-blocked banner');
});

// ───────────── control 2: journal REFUSED stays a flat false + rolls back (the retry-safe mode is unchanged) ─────────────
test('recordBill: journal refused → flat false + _dropIfRefused, no metadata write (retry is safe)', async () => {
  const { handlers, encPublished, dropped } = loadHandlers({ entryLands: false });
  const ret = await handlers.recordBill({ number: 'B', supplier: 'Acme', lines: BILL_LINES, received: '2026-11-07', due: '' });
  assert.equal(ret, false, 'a refused journal must stay a flat false — re-entry is the correct, safe recovery');
  assert.equal(encPublished.length, 0, 'a refused journal must not publish the metadata doc');
  assert.equal(dropped.length, 1, 'a refused journal must be rolled back with _dropIfRefused');
});
