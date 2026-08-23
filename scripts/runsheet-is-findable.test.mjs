// THE ORDER OF SERVICE ALREADY EXISTED. Miriam reported that there was "nowhere to put an order of service"
// and pasted hers into a notice. TrinityOne has had a Run sheet all along — items, times, who leads each,
// CCLI numbers, reorderable — and the relay serves it to the WHOLE CHURCH by default (ROTA_VIS defaults to
// 'church', gateway.mjs), not just the rota team.
//
// Run: node --test scripts/runsheet-is-findable.test.mjs
//
// She never found it because it hangs off a SERVICE inside Rota, and someone holding an order of service goes
// looking under Resources, or at Sunday in the calendar. So the fix is not a second order-of-service feature —
// it is putting the one that exists where someone would look for it.
//
// The calendar's own event card carries the lesson in a comment: "The WHOLE card opens the event — the tap
// target used to be just the title row, so 'how do I change this?' had no obvious answer." The service card
// beside it was left with no handler at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const SCH = stripComments(readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8'));
const GATE = stripComments(readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8'));

test('the run sheet is reachable from the calendar, where Sunday is', () => {
  const i = SCH.indexOf('function DashCalendar');
  const cal = SCH.slice(i);
  assert.match(cal, /RunsheetModal/, 'the calendar cannot reach the order of service at all');
  assert.match(cal, /setSvcDetail|svcDetail/, 'a service in the calendar is still a card with nothing behind it');
});

test('a service card is a tap target, like the event card beside it', () => {
  // NOT the first `{it.services.map(` — that is the tiny pill in the month grid, whose day cell is already
  // the tap target. The one that matters is the card in the day panel, and anchoring on the first match
  // tested the wrong element entirely.
  const i = SCH.indexOf('setSvcDetail(s)');
  assert.ok(i > 0, 'nothing opens a service');
  const card = SCH.slice(SCH.lastIndexOf('<div key={s.id}', i), SCH.indexOf('>', i + 40));
  assert.match(card, /onClick=/, 'the service card still has no handler');
  assert.match(card, /role="button"/, 'the card is not announced as a control');
  assert.match(SCH.slice(i, i + 300), /onKeyDown/, 'the card is not reachable by keyboard, unlike the event card');
});

test('and the whole church can still fetch one by default', () => {
  // If this ever defaults to 'team', surfacing the run sheet in the calendar would show the congregation a
  // door that the relay refuses to open.
  assert.match(GATE, /ROTA_VIS\.get\(cp\) \|\| \{\}\)\.v \|\| 'church'/,
    'runsheet visibility no longer defaults to the whole church');
});
