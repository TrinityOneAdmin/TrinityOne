// THE REST OF WHAT THE CONGREGATION FOUND — the ones that survived checking.
// Run: node --test scripts/round4-remaining.test.mjs
//
// Fourteen findings were filed unverified. Most did not survive: the broadcast room DOES name its sender
// (the church, which is right for the church's own voice), the messages ARE in date order, and the care
// cards DO carry a handler at both render sites. What follows is what held.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const CHAT  = stripComments(readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8'));
const APP   = stripComments(readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8'));
const STEWD = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('a chat room says which DAY a message was sent', () => {
  // Priyanka read the room as out of order: "1:31 PM, then 8:57 PM, then 3:18 PM". Checked against the
  // relay, the messages are in perfect order — 12:31 and 19:57 on one day, 14:18 and 14:52 on the next.
  // The room shows a clock time and never a date, so three days of conversation read as jumbled. She was
  // right that something was wrong and wrong about what; a day divider is the whole fix.
  assert.match(CHAT, /DayDivider|dayDivider/, 'a room still shows only clock times, so days run together');
});

test('uploading a sermon follows the church’s own encryption setting', () => {
  // Miriam: "Encrypt is a tick box, and it is OFF by default, which surprised me on a page that promises
  // members only." She is right to be surprised — the church itself is encrypted unless a steward decides
  // otherwise, and this one box quietly disagreed with that.
  // fnBody, not a byte count — this project's own guard caught a 1200-char window over a 17,000-char
  // function, which is how an assertion silently stops reading the thing it names.
  const fn = fnBody(STEWD, 'function DashSermons');
  assert.equal(/const \[encOn, setEncOn\] = React\.useState\(false\)/.test(fn), false,
    'the upload still starts unencrypted, whatever the church has chosen');
  assert.match(fn, /encryptComms/, 'the upload does not consult the church’s setting at all');
});

test('pressing the answer you already gave does not silently throw it away', () => {
  // Priyanka: "It already said You're going. I tapped Going to confirm — and it wiped my answer." Pressing
  // your current answer clears it, which is a deliberate toggle and a reasonable thing to want — but the
  // common press is a confirmation, and losing an answer should never be the silent outcome of one tap.
  const fn = fnBody(APP, 'setRsvp: (eventId, verdict) =>');
  // A first draft matched /cleared/ — which the variable name satisfies whether or not anything is said.
  // Proven vacuous by sabotage. Assert the guarded call itself.
  assert.match(fn, /if \(cleared\) toast\(/,
    'clearing an answer still happens with no word to the person who did it');
  assert.match(fn, /withdrawn/i, 'the message does not say what became of their answer');
});
