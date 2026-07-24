// Calendar-day handling in the care UI. A care need's days are CALENDAR dates, and the classic mistake is to
// parse "YYYY-MM-DD" as LOCAL midnight (`new Date(iso + 'T00:00:00')`) and then format it back with
// `.toISOString()`, which renders the UTC day — the PREVIOUS day for every timezone east of Greenwich (BST
// included). That shipped needs dated YESTERDAY: already expired, so they never appeared in "open needs", and
// it shifted a member's sign-up onto the wrong day.
//
// This drives the SHIPPED files (app/screens-today.jsx, app/stew-meals.jsx) rather than a copy: it extracts the
// real date-range helpers from the source and runs them under a UTC+ timezone. Run:
//   node --test scripts/care-dates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Pull a single-expression arrow helper out of a source file by name and evaluate it.
function extractHelper(src, name) {
  const line = src.split('\n').find(l => l.includes('const ' + name + ' = (') );
  assert.ok(line, 'helper ' + name + ' not found in source');
  const body = line.trim().replace(/^const\s+/, '');
  // eslint-disable-next-line no-new-func
  return new Function('"use strict"; let ' + body + '; return ' + name + ';')();
}

test('the approve sheets expand a date range as CALENDAR days (no UTC day-shift)', () => {
  for (const file of ['app/screens-today.jsx', 'app/stew-meals.jsx']) {
    const dayRange = extractHelper(read(file), 'dayRange');
    assert.deepEqual(dayRange('2026-07-24', '2026-07-24'), ['2026-07-24'], file + ': a single day is that day, not the day before');
    assert.deepEqual(dayRange('2026-07-24', '2026-07-26'), ['2026-07-24', '2026-07-25', '2026-07-26'], file + ': an inclusive range');
    assert.deepEqual(dayRange('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01'], file + ': crosses a year boundary');
    assert.equal(dayRange('2026-07-24', '2026-12-31').length, 90, file + ': capped at 90 days');
  }
});

test('careDateRange (member need day list) does not shift days', () => {
  const src = read('app/screens-today.jsx');
  const fn = src.slice(src.indexOf('function careDateRange('));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  // eslint-disable-next-line no-new-func
  const careDateRange = new Function('"use strict"; ' + body + ' return careDateRange;')();
  assert.deepEqual(careDateRange('2026-07-24', '2026-07-24'), ['2026-07-24'], 'single-day need keeps its day');
  assert.deepEqual(careDateRange('2026-07-24', '2026-07-26'), ['2026-07-24', '2026-07-25', '2026-07-26'], 'range keeps its days');
  assert.deepEqual(careDateRange('bad', ''), [], 'garbage in → empty');
});

test('the buggy local-midnight-parse pattern is gone from the care date paths', () => {
  // `new Date(x + 'T00:00:00')` (no Z) followed by toISOString is the exact defect; 'T00:00:00Z' is fine, and
  // parsing local for toLocaleDateString (display only) is fine. Guard the two care files against a relapse.
  for (const file of ['app/screens-today.jsx', 'app/stew-meals.jsx']) {
    const src = read(file);
    for (const line of src.split('\n')) {
      if (!/T00:00:00'/.test(line)) continue;            // local-midnight parse (no Z)
      assert.ok(!/toISOString/.test(line), file + ': local-midnight parse formatted as UTC → day-shift bug: ' + line.trim().slice(0, 110));
    }
  }
});
