// A DAY SOMEONE HAS TAKEN IS COVERED, NOT OPEN — AND A REPEATING EVENT SAYS SO.
// Run: node --test scripts/care-rota-and-rsvp.test.mjs
//
// Both found by simulated members on 2026-08-18.
//
// 1. MEAL-ROTA DOUBLE-BOOK. A day already filled by someone else still offered "I'll help", so a second
//    member signed up and the recipient got two of the same meal — the exact thing the help page promises the
//    app prevents ("it shows as covered so two people don't turn up for the same slot").
// 2. RECURRING RSVP. A weekly meeting is one stored event expanded into a card per date, but the RSVP is keyed
//    on the event id alone, so an answer covers the whole series — one "Going" lit 25 future cards. Per-
//    occurrence RSVP is a data-model change; until it is built, the UI must say the answer covers every date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');
const SERV = readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8');

test('“I’ll help” is offered only on a genuinely open day', () => {
  // the day row: mine → cancel; someone else's fill → covered; nobody → I'll help
  const row = stripComments(TODAY.slice(TODAY.indexOf('!skipped && !isRecipient && (mineFilled'), TODAY.indexOf('!skipped && !isRecipient && (mineFilled') + 900));
  assert.match(row, /: fills\.length\s*\?/,
    'a day already filled by someone else must branch to a covered state, not fall straight to "I’ll help"');
  const helpAt = row.indexOf("I’ll help");
  const coveredAt = row.indexOf('Covered');
  assert.ok(coveredAt !== -1 && helpAt !== -1 && coveredAt < helpAt,
    '"Covered" must be the branch for a filled day, with "I’ll help" only after fills.length is ruled out');
});

test('a recurring event’s RSVP says the answer covers every date', () => {
  const row = stripComments(fnBody(SERV, 'function svEventRsvpRow({ e, rsvps, ctx }) {'));
  assert.match(row, /e\.recurring \|\| e\.seriesDate/,
    'the compact RSVP row must detect a recurring/expanded occurrence');
  assert.match(row, /every time/i, 'and mark it, so per-date cards do not read as per-date RSVP');

  // the detail sheet too
  const sheetAt = SERV.indexOf('Will you be there?');
  assert.notEqual(sheetAt, -1, 're-anchor: the detail RSVP heading moved');
  const sheet = SERV.slice(sheetAt, sheetAt + 400);
  assert.match(sheet, /this repeats, so your answer covers every date/i,
    'the full RSVP sheet must say the answer covers the whole series');
});
