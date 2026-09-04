// "TRY AGAIN" ON A HALF-FAILED BANK IMPORT MUST NOT POST THE LINES THAT ALREADY LANDED.
// Run: node --test scripts/a-retried-import-does-not-post-twice.test.mjs
//
// AUDIT 2026-09-04. The church's finance journal is single-writer, relay-ORDERED and append-only: the relay
// accepts a journal document only when its seq is EXACTLY the next one (gateway.mjs, `seq ===
// FINANCE_SEQ.get(cp) + 1` — it rejects gaps, forks and edits alike). Two things followed from ignoring that:
//
//   · the import fired every line at the relay together with Promise.all, so they arrived in whatever order
//     the network chose and everything out of turn was refused for a gap. The "partial failure" the modal
//     then reported was largely manufactured by the import itself.
//   · `post()` advances the local book whether or not the publish lands, and nothing rolled it back. So the
//     retry re-posted the lines the relay HAD taken (the modal's "already imported" flags are computed once,
//     when it opens) — a duplicated donation in a church's books — while the refused ones were numbered past
//     a gap the relay can never accept.
//
// This runs the SHIPPED ledger (vendor/finance-ledger.js) and the SHIPPED importStatement, lifted out of
// app/stew-finance.jsx, against a relay that enforces the real rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LEDGER_SRC = readFileSync(new URL('../vendor/finance-ledger.js', import.meta.url), 'utf8');
const FIN = new Function(LEDGER_SRC + '; return FinanceLedger;')();

const STEW = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');

// Slice the shipped arrow function, balanced to its closing brace. Not a text match: it is then RUN.
function lift(anchor, what) {
  const i = STEW.indexOf(anchor);
  assert.ok(i > 0, what + ' is not in app/stew-finance.jsx — re-anchor this test');
  let d = 0;
  for (let k = STEW.indexOf('{', i + anchor.length - 1); k < STEW.length; k++) {
    if (STEW[k] === '{') d++;
    else if (STEW[k] === '}') { d--; if (!d) return STEW.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced braces slicing ' + what);
}
const liftImportStatement = () => lift('const importStatement = async (picks) => {', 'importStatement');
// record() and _dropIfRefused are lifted too, rather than stubbed. A hand-written _dropIfRefused would prove
// that dropFrom works and say nothing about whether record() CALLS it — which is the whole claim, and is the
// trap this codebase keeps falling into. Measured: with record()'s rollback deleted, the stubbed version of
// this file stayed 8/0 green.
const liftRecord = () => lift('const _dropIfRefused = (b, entry) =>', '_dropIfRefused')
                       + lift('const record = ({ dir, account, fund, amountMinor, date, memo }) => {', 'record');

// A relay that behaves like the real one: it stores a journal document only when the seq is exactly next.
function makeRelay() {
  const stored = [];
  let head = 0;
  return {
    stored,
    seqs: () => stored.map(e => e.seq),
    keys: () => stored.map(e => e.importKey),
    publish(entry) {
      if (entry.seq !== head + 1) return false;   // gap or fork — exactly what gateway.mjs refuses
      head = entry.seq; stored.push({ seq: entry.seq, importKey: entry.importKey, memo: entry.memo });
      return true;
    },
  };
}

function harness({ refuseFrom }) {
  const relay = makeRelay();
  const book = FIN.createBook({});
  FIN.addAccount(book, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FIN.addAccount(book, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  if (!book.funds.has('general')) FIN.addFund(book, { id: 'general', name: 'General' });   // createBook seeds it
  const bookRef = { current: book };
  let attempts = 0, cut = refuseFrom;
  const pubEntry = async (b, e) => {
    attempts++;
    // `cut` stands in for the relay going away from the Nth publish of THIS attempt onward.
    if (cut != null && attempts >= cut) return false;
    return relay.publish(e);
  };
  const names  = ['bookRef', 'F', 'pubEntry', 'bump'];
  const values = [bookRef, FIN, pubEntry, () => {}];
  const made = new Function(...names,
    liftRecord() + liftImportStatement() + ' return { importStatement, record, _dropIfRefused };')(...values);
  // A retry is a fresh attempt, and the relay may be back — so the count restarts and the cut can be lifted.
  return { importStatement: made.importStatement, record: made.record, relay, book,
           retry: ({ refuseFrom: r = null } = {}) => { attempts = 0; cut = r; } };
}

const LINES = ['k1', 'k2', 'k3', 'k4', 'k5'].map((key, i) => ({
  key, date: '2026-09-0' + (i + 1), description: 'Gift ' + (i + 1), amountMinor: 1000 * (i + 1), dir: 'in',
}));
const picks = (ls) => ls.map(line => ({ line, account: 'giving', fund: 'general' }));

test('a retry after a partial failure does NOT duplicate the lines that landed', async () => {
  // Two land, then the relay goes away.
  const h = harness({ refuseFrom: 3 });
  const first = await h.importStatement(picks(LINES));
  assert.equal(first.posted, 2, 'the harness did not produce the partial failure this test is about');
  assert.deepEqual(h.relay.keys(), ['k1', 'k2']);

  // The treasurer presses "Try again". The relay is back.
  h.retry();   // the relay is back
  const second = await h.importStatement(picks(LINES));
  assert.deepEqual(h.relay.keys(), ['k1', 'k2', 'k3', 'k4', 'k5'],
    'the retry posted the lines that had already landed a second time — a duplicated donation in a real ' +
    "church's books, which the treasurer would find only by reconciling by hand");
  assert.equal(second.skipped.length, 2, 'the retry did not report which lines it had skipped');
  assert.equal(second.failed.length, 0, 'the retry could not finish the statement');
});

test('the seq stays contiguous, so a refused line does not wedge the journal', async () => {
  const h = harness({ refuseFrom: 3 });
  await h.importStatement(picks(LINES));
  assert.deepEqual(h.relay.seqs(), [1, 2], 'the relay took something it should have refused');
  assert.equal(h.book._seq, 2,
    'the local book advanced past the refused line, so the retry — and every ordinary entry typed ' +
    'afterwards — is numbered past a gap the relay will never accept');
  assert.equal(h.book.journal.length, 2, 'entries the relay refused were left in the local books as though real');
});

test('the whole statement lands in one go when the relay is there', async () => {
  const h = harness({ refuseFrom: null });
  const r = await h.importStatement(picks(LINES));
  assert.equal(r.posted, 5);
  assert.deepEqual(h.relay.seqs(), [1, 2, 3, 4, 5], 'lines were sent in an order the relay refuses');
  assert.equal(r.failed.length, 0);
});

test('a second import of the SAME statement posts nothing', async () => {
  // The modal flags these before you get here; this is the layer a stale screen cannot get past.
  const h = harness({ refuseFrom: null });
  await h.importStatement(picks(LINES));
  h.retry();
  const again = await h.importStatement(picks(LINES));
  assert.equal(again.posted, 0, 'importing the same bank statement twice doubled every line in the books');
  assert.equal(again.skipped.length, 5);
  assert.deepEqual(h.relay.seqs(), [1, 2, 3, 4, 5]);
});

test('dropFrom discards only what was never accepted', () => {
  const book = FIN.createBook({});
  FIN.addAccount(book, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FIN.addAccount(book, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  const P = [{ account: 'bank', dir: 'dr', amount: 500 }, { account: 'giving', dir: 'cr', amount: 500 }];
  FIN.post(book, { memo: 'kept', postings: P });
  const doomed = FIN.post(book, { memo: 'refused', postings: P });
  FIN.post(book, { memo: 'also refused', postings: P });
  assert.equal(FIN.dropFrom(book, doomed.seq), 2, 'dropFrom did not remove the entries from the refused one on');
  assert.equal(book.journal.length, 1);
  assert.equal(book._seq, 1, 'the next entry would be numbered past a gap the relay refuses');
  assert.equal(book.journal[0].memo, 'kept', 'dropFrom removed an entry the relay HAD accepted');
});

// ── the regression the FIRST version of this fix introduced ───────────────────────────────────────────────
//
// `lineKey` is date|signedAmount|description(40) — so two IDENTICAL transactions on one day share one key.
// The first de-dup added each posted key to the guard as it went, which dropped the second of such a pair and
// then closed the modal as a clean success: a real donation missing from a church's books, with nothing on
// screen. Two card-reader settlements of the same amount, two standing orders the bank prints identically, a
// repeated cash deposit — all ordinary. The version before this branch posted both, and so must this one.
//
// Caught by the fourth audit of the branch, which measured £25 imported from a £45 statement. The test that
// shipped with the fix used five distinct keys and structurally could not see it.
test('two IDENTICAL lines in one statement are both imported', async () => {
  const h = harness({ refuseFrom: null });
  const twice = [
    { key: '2026-09-01|2000|standing order giving', date: '2026-09-01', description: 'STANDING ORDER GIVING', amountMinor: 2000, dir: 'in' },
    { key: '2026-09-01|2000|standing order giving', date: '2026-09-01', description: 'STANDING ORDER GIVING', amountMinor: 2000, dir: 'in' },
    { key: '2026-09-01|500|gift aid', date: '2026-09-01', description: 'GIFT AID', amountMinor: 500, dir: 'in' },
  ];
  const r = await h.importStatement(picks(twice));
  assert.equal(r.posted, 3,
    'the second of two identical lines was dropped, and the modal closed as though the statement had ' +
    'imported cleanly — the money is simply missing from the books');
  assert.equal(r.skipped.length, 0, 'a legitimate repeat was reported as already imported');
  assert.equal(h.relay.stored.length, 3);
});

// ── one refused MANUAL entry must not wedge every later import ────────────────────────────────────────────
//
// `dropFrom` was applied only inside the import, so a single refused entry typed by hand still advanced the
// local book past a seq the relay never took — and every later entry and import was numbered past a gap the
// relay refuses. The treasurer is told "try again" and cannot succeed until a relay delivery rebuilds the
// book. record() and undo() now roll back the same way.
const P2 = [{ account: 'bank', dir: 'dr', amount: 500 }, { account: 'giving', dir: 'cr', amount: 500 }];

test('a manual entry the relay refused does not wedge the next import', async () => {
  // The relay never saw it: post() still ran locally, which is what record() does before it publishes.
  // The SHIPPED record(), with the relay away — not a hand-written stand-in for what it is supposed to do.
  // Injecting my own _dropIfRefused would prove dropFrom works and say nothing about whether record() CALLS
  // it, which is the whole claim; measured — with record()'s rollback deleted, that version stayed green.
  const h = harness({ refuseFrom: 1 });
  const ok = await h.record({ dir: 'in', account: 'giving', fund: 'general', amountMinor: 500, date: '2026-09-01', memo: 'Cash in hand' });
  assert.equal(ok, false, 'the harness did not produce the refusal this test is about');
  assert.equal(h.book._seq, 0,
    'record() left the refused entry in the local book, so every later seq is past a gap the relay refuses');

  h.retry();                                     // the relay is back
  const r = await h.importStatement(picks(LINES));
  assert.equal(r.posted, 5, 'the import could not post at all after one refused manual entry');
  assert.deepEqual(h.relay.seqs(), [1, 2, 3, 4, 5]);
});

test('CONTROL: an entry the relay DID take stays in the books', async () => {
  const h = harness({ refuseFrom: null });
  const ok = await h.record({ dir: 'in', account: 'giving', fund: 'general', amountMinor: 500, date: '2026-09-01', memo: 'Cash in hand' });
  assert.equal(ok, true);
  assert.equal(h.book.journal.length, 1, 'record() discarded an entry the relay accepted');
  assert.equal(h.book._seq, 1);
});

test('MEASURED: without that rollback the next import posts NOTHING, twice over', async () => {
  // This is the state the branch shipped in before the fourth audit: record() left the phantom entry behind.
  const h = harness({ refuseFrom: null });
  FIN.post(h.book, { date: '2026-09-01', memo: 'Cash in hand', postings: P2 });   // refused, not rolled back
  const first = await h.importStatement(picks(LINES));
  assert.equal(first.posted, 0,
    'this control no longer reproduces the wedge — re-anchor it, or the test above proves nothing');
  h.retry();
  const second = await h.importStatement(picks(LINES));
  assert.equal(second.posted, 0, '"Try again" recovered on its own, so the rollback would not be needed');
});

// ── THE TWO CASES TOGETHER, WHICH IS WHERE THE MONEY WENT ─────────────────────────────────────────────────
//
// Audit #5. This file already had "two identical lines both import" and "a retry does not double up". Held
// apart they both passed while the combination lost a donation, and the combination is the ordinary one: two
// card-reader settlements of the same amount on one day, and the relay dropping between them.
//
// With a de-dup that asks "is this key in the book", attempt 2 finds the key (put there by the line that DID
// land) and skips BOTH rows. `failed` is then empty, so the modal closes as a clean success — £25 posted from
// a £45 statement, exactly the defect audit #4 found, one tap further on.
//
// The rule has to COUNT: two in the file and one in the book means post one more.
const TWIN = { key: '2026-09-01|2000|standing order giving', date: '2026-09-01',
               description: 'STANDING ORDER GIVING', amountMinor: 2000, dir: 'in' };
const GIFT = { key: '2026-09-01|500|gift aid', date: '2026-09-01',
               description: 'GIFT AID', amountMinor: 500, dir: 'in' };

test('the relay drops BETWEEN two identical lines, and "Try again" still posts the second', async () => {
  const h = harness({ refuseFrom: 2 });          // the first lands, then the relay goes away
  const statement = [TWIN, { ...TWIN }, GIFT];
  const first = await h.importStatement(picks(statement));
  assert.equal(first.posted, 1, 'the harness did not produce the partial failure this test is about');
  assert.equal(first.failed.length, 2);

  h.retry();                                     // the relay is back
  const second = await h.importStatement(picks(statement));
  assert.equal(h.relay.stored.length, 3,
    'the second of two identical payments was never posted. On the retry its key was already in the book — ' +
    'put there by the one that DID land — so both rows were skipped, the modal reported no failures and ' +
    'closed as a clean success. A real donation missing from a church\'s books, with nothing on screen');
  assert.equal(second.posted, 2, 'the retry did not finish the statement');
  assert.equal(second.skipped.length, 1, 'the line that had already landed should be skipped exactly once');
  assert.equal(second.failed.length, 0);
});

test('CONTROL: importing that same statement a THIRD time posts nothing', async () => {
  const h = harness({ refuseFrom: null });
  const statement = [TWIN, { ...TWIN }, GIFT];
  await h.importStatement(picks(statement));
  h.retry();
  const again = await h.importStatement(picks(statement));
  assert.equal(again.posted, 0,
    'counting instead of set-membership must not open the door to re-importing a whole statement');
  assert.equal(again.skipped.length, 3);
  assert.equal(h.relay.stored.length, 3);
});

test('CONTROL: THREE identical lines, one already in the book, posts exactly two', async () => {
  const h = harness({ refuseFrom: 2 });
  const statement = [TWIN, { ...TWIN }, { ...TWIN }];
  await h.importStatement(picks(statement));     // 1 lands
  h.retry();
  const second = await h.importStatement(picks(statement));
  assert.equal(second.posted, 2, 'the count is off when a key repeats more than twice');
  assert.equal(h.relay.stored.length, 3);
});

