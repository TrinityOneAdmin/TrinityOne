// A calendar day must be the LOCAL day, never the UTC day. Run: node --test scripts/calendar-day.test.mjs
//
// `new Date().toISOString().slice(0, 10)` is the UTC date. For anything a human calls "today" that is wrong
// for most of the world: east of Greenwich it reads as YESTERDAY for part of every evening, and west of it as
// TOMORROW for part of every night. This has shipped real bugs, twice in one day (2026-07-24):
//
//   • an approved care need was published dated yesterday — already expired, so it never appeared in "open
//     needs" and the church never saw it;
//   • the kids check-in roll filtered on the UTC day while children were checked in against it, so in NZ/AU
//     the list of who is in the room EMPTIES mid-service and the pickup codes go with it.
//
// The earlier care-dates.test.mjs guarded one specific *parsing* idiom and caught none of the eleven sites
// that used this one. This is the general guard: it scans the shipped source, so a new occurrence anywhere
// fails the suite. Use `todayISO()` (app shells, defined in app/recur.jsx) or `_todayISO()` (steward bundle).
//
// Timestamps and export FILENAMES are legitimately UTC and are exempted by the allowlist below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BAD = /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/;
// A filename is a legitimate UTC use: a backup called …-2026-07-24.json needs no timezone opinion. `date` in an
// export/backup builder is the same case (it is stamped into the archive's name).
const FILENAME_USE = /\.json|filename|download|saveFile|backup-|export/i;
// Prose about the rule is not a violation of it — skip comment lines, or this file's own guidance trips it.
const IS_COMMENT = (l) => { const t = l.trim(); return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'); };

function scan(dir, exts) {
  const hits = [];
  for (const name of readdirSync(dir)) {
    if (!exts.some(e => name.endsWith(e))) continue;
    const path = join(dir, name);
    readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
      if (BAD.test(line) && !FILENAME_USE.test(line) && !IS_COMMENT(line)) hits.push(`${name}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
  return hits;
}

test('no UTC-day used as a calendar date in the app shells', () => {
  const hits = scan(join(ROOT, 'app'), ['.jsx']);
  assert.deepEqual(hits, [],
    'These read the UTC day where a LOCAL calendar day is meant — the date will be wrong for part of every ' +
    'day for most of the world. Use todayISO() (app/recur.jsx, loaded in both shells):\n  ' + hits.join('\n  '));
});

test('no UTC-day used as a calendar date in the engines', () => {
  const hits = scan(join(ROOT, 'src'), ['.js']);
  assert.deepEqual(hits, [],
    'Use the module-local _todayISO() instead:\n  ' + hits.join('\n  '));
});

test('the canonical helper exists and is built from LOCAL date parts', () => {
  const recur = readFileSync(join(ROOT, 'app/recur.jsx'), 'utf8');
  assert.match(recur, /window\.todayISO\s*=/, 'app/recur.jsx should export todayISO for both shells');
  assert.doesNotMatch(recur, /todayISO\s*=\s*\(\)\s*=>\s*new Date\(\)\.toISOString/, 'todayISO must not be the UTC day');
  const steward = readFileSync(join(ROOT, 'src/steward.src.js'), 'utf8');
  assert.match(steward, /_todayISO\s*=\s*\(\)\s*=>\s*\{[^}]*getFullYear/, 'steward.src.js should build its local day from date parts');
});
