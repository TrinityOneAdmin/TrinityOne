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
function liftImportStatement() {
  const i = STEW.indexOf('const importStatement = async (picks) => {');
  assert.ok(i > 0, 'importStatement is not in app/stew-finance.jsx — re-anchor this test');
  let d = 0;
  for (let k = STEW.indexOf('{', i + 40); k < STEW.length; k++) {
    if (STEW[k] === '{') d++;
    else if (STEW[k] === '}') { d--; if (!d) return STEW.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced braces slicing importStatement');
}

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
  const fn = new Function(...names, liftImportStatement() + ' return importStatement;')(...values);
  // A retry is a fresh attempt, and the relay may be back — so the count restarts and the cut can be lifted.
  return { importStatement: fn, relay, book,
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
