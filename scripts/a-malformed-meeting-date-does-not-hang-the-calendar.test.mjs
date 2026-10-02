// A MEETING WITH A MALFORMED DATE IS SKIPPED, NOT WALKED FOR EVER.
// Run: node --test scripts/a-malformed-meeting-date-does-not-hang-the-calendar.test.mjs
//
// app/recur.jsx expandEvents turns a recurring meeting into dated occurrences for the member app's calendar
// (app/app.jsx churchEvents) and the console's (DashCalendar). A weekly or fortnightly meeting whose `date` was
// not YYYY-MM-DD — "2026-10-13T19:30" — made an Invalid Date, and the walk compared NaN against the weekday
// for ever: the calendar hung. The member app's subscribeChurchEvents passes a relay document's date through
// unchecked, so one bad document was enough. A `day` no weekday can equal (7) spun the same loops, monthly too.
// (Audit of 812948b, item 3.)
//
// Executes the REAL app/recur.jsx inside a vm context with a timeout, because the failure is a loop that never
// returns: without the timeout, a regression would hang this file instead of failing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const RECUR = readFileSync(new URL('../app/recur.jsx', import.meta.url), 'utf8');

function expandInVm(events, from, days) {
  const ctx = vm.createContext({ window: {}, EVS: JSON.parse(JSON.stringify(events)) });
  vm.runInContext(RECUR, ctx, { timeout: 2000 });
  assert.equal(typeof ctx.window.expandEvents, 'function', 'app/recur.jsx did not define expandEvents — re-anchor');
  let out;
  try {
    out = vm.runInContext(`JSON.stringify(window.expandEvents(EVS, ${JSON.stringify(from)}, ${days}))`, ctx, { timeout: 2000 });
  } catch (e) {
    if (/timed out/i.test(String(e && e.message))) assert.fail('expandEvents did not return within 2 s — it loops for ever on ' + JSON.stringify(events));
    throw e;
  }
  return JSON.parse(out);
}

for (const recur of ['weekly', 'fortnightly', 'monthly']) {
  test(`${recur}: a date that is not YYYY-MM-DD is skipped, and the rest of the calendar still comes back`, () => {
    const good = { id: 'good', date: '2026-10-04', time: '10:30', recur, day: 0 };
    const out = expandInVm([{ id: 'bad', date: '2026-10-13T19:30', time: '19:30', recur, day: 2 }, good], '2026-10-01', 60);
    assert.ok(!out.some(o => o.id === 'bad'), 'the malformed meeting produced occurrences');
    assert.ok(out.some(o => o.id === 'good'), 'one bad meeting took the good one with it');
  });

  test(`${recur}: a day no weekday can equal (7) does not hang it`, () => {
    const out = expandInVm([{ id: 'odd', date: '2026-10-13', time: '19:30', recur, day: 7 }], '2026-10-01', 60);
    // falls back to the anchor's own weekday (13 Oct 2026 is a Tuesday), as scripts/public-calendar.mjs does
    assert.ok(out.length > 0, 'expected the series on its anchor weekday');
    for (const o of out) assert.equal(new Date(o.date + 'T12:00:00Z').getUTCDay(), 2, o.date + ' is not a Tuesday');
  });
}
