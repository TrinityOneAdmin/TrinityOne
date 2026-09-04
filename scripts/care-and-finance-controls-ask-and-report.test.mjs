// THE CONTROLS THAT CANNOT BE TAKEN BACK ASK FIRST, AND SAY WHETHER THEY WORKED.
// Run: node --test scripts/care-and-finance-controls-ask-and-report.test.mjs
//
// AUDIT 2026-09-02 #17. Three of them:
//
//   · ENDING A SAFETY CHECK is the moment a church stops looking for people. It swallowed its result and
//     closed the confirm regardless, so an "end" that reached no relay left the roll-call live on every
//     member's phone while the steward believed it was over.
//   · "CLOSE — NOT NEEDED" ended somebody's request for help on one press, with no confirmation and no
//     check that it landed.
//   · IMPORTING A BANK STATEMENT posted every line locally and fired its publishes into the void, then
//     closed — returning a treasurer to a books page they believed was reconciled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const MEALS = readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8');
const FIN = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');

test('an "end the check" that no relay accepted leaves the check live and says so', async () => {
  const body = fnBody(MEALS, 'const closeCheck = async () => {', 'closeCheck');
  const run = (result) => {
    const st = { confirmClosed: false, err: '', busy: [] };
    const fn = new Function('busy', 'setBusy', 'setSendErr', 'setConfirmEnd', 'check', 'window',
      body + '\nreturn closeCheck;')(
      false, (b) => st.busy.push(b), (e) => { st.err = e; }, (v) => { st.confirmClosed = (v === false); },
      { id: 'c1' }, { Steward: { closeSafetyCheck: async () => result } });
    return fn().then(() => st);
  };
  const failed = await run(null);
  assert.equal(failed.confirmClosed, false,
    'the confirm closed over an "end" no relay accepted — the steward believes the roll-call is over while ' +
    'it is still live on every member\'s phone');
  assert.match(failed.err, /still live/i, 'and nothing said the check is still running');

  const ok = await run({ id: 'evt' });
  assert.equal(ok.confirmClosed, true, 'CONTROL: ending a check that DID work no longer closes the confirm');
  assert.equal(ok.err, '', 'CONTROL: a successful end reported an error');
});

// THE BEHAVIOUR HALF OF THIS MOVED, and the move is the point. `app/stew-meals.jsx` ships UNBUNDLED, so
// `false && ` in front of the condition leaves every word in place and a text match still passes — the
// 2026-09-04 audit measured exactly that: restoring the one-tap close left this file 9/0 green. The two
// presses are now asserted by RUNNING the control, in
// scripts/the-console-says-which-half-of-an-approval-landed.test.mjs. What stays here is what text matching
// is legitimately for: the WORDING of the confirmation.
test('the confirm wording never implies a young person\'s request went to the rota', () => {
  const src = stripComments(MEALS);
  const i = src.indexOf('Close — not needed');
  assert.ok(i > 0, 'the close control has moved — re-anchor this test');
  const around = src.slice(Math.max(0, i - 1400), i + 200);
  assert.match(around, /Couldn’t close that request/,
    'the failure wording is gone; a close the relay refused would be indistinguishable from one it took');
  // DOMAIN.md: a young person's request is not seen by the rota, so the confirm must not imply a care team
  const confirmCopy = around.match(/Yes, close[^<']*/g) || [];
  assert.ok(confirmCopy.length, 'no confirm wording found at all');
  assert.equal(confirmCopy.some(t => /care team|rota/i.test(t)), false,
    'the confirm mentions the care team or rota. A young person\'s request is not seen by either, and copy ' +
    'that implies otherwise is exactly what this section exists to prevent');
});

test('a statement import that posted nothing keeps the modal open and names the lines', async () => {
  const body = fnBody(FIN, 'const doPost = async () => {', 'doPost');
  const run = (result) => {
    const st = { closed: false, err: '' };
    const rowState = [{ selected: true, dup: false, account: 'a', fund: 'general' },
                      { selected: true, dup: false, account: 'a', fund: 'general' }];
    const lines = [{ date: '2026-09-01', description: 'STANDING ORDER PCC', amountMinor: 1000, dir: 'in', key: 'k1' },
                   { date: '2026-09-02', description: 'GIFT', amountMinor: 2000, dir: 'in', key: 'k2' }];
    st.rows = rowState;
    const fn = new Function('lines', 'rowState', 'setErr', 'onPost', 'onClose', 'setPosting', 'setRowState',
      body + '\nreturn doPost;')(
      lines, rowState, (e) => { st.err = e; }, async () => result, () => { st.closed = true; }, () => {},
      (f) => { st.rows = typeof f === 'function' ? f(st.rows) : f; });
    return fn().then(() => st);
  };
  const failed = await run({ posted: 0, failed: [{ date: '2026-09-01', description: 'STANDING ORDER PCC', key: 'k1' },
                                                 { date: '2026-09-02', description: 'GIFT', key: 'k2' }] });
  assert.equal(failed.closed, false,
    'the import modal closed although a line never reached the relay. Closing IS the confirmation, and the ' +
    'treasurer is returned to books they believe are reconciled');
  assert.match(failed.err, /NOT in your books/,
    'the treasurer is not told which lines are missing, so they cannot re-enter them');

  const ok = await run({ posted: 2, failed: [] });
  assert.equal(ok.closed, true, 'CONTROL: an import where everything posted no longer closes');

  // AND THE RETRY MUST NOT ASK FOR THE LINES THAT LANDED. Audit 2026-09-04: the `dup` flags are worked out
  // once, when the modal opens, so after a partial failure every line the relay DID take was still ticked —
  // and "Try again" posted it a second time. The engine refuses a repeat regardless
  // (a-retried-import-does-not-post-twice.test.mjs); this is what stops the screen asking for one.
  const half = await run({ posted: 1, failed: [{ date: '2026-09-02', description: 'GIFT', key: 'k2' }] });
  assert.equal(half.rows[0].dup, true, 'the line that landed is still ticked, so "Try again" posts it again');
  assert.equal(half.rows[0].selected, false, 'the line that landed is still selected for the retry');
  assert.equal(half.rows[1].dup, false, 'the line that FAILED was marked as already imported — it never landed');
  assert.equal(half.rows[1].selected, true, 'the line that failed was deselected, so the retry does nothing');
});
