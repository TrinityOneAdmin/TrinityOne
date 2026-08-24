// THREE THINGS FOUR PEOPLE HIT IN ONE AFTERNOON, each reproduced before being believed.
// Run: node --test scripts/sim-round4-fixes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const TODAY  = stripComments(readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8'));
const EXTRAS = stripComments(readFileSync(new URL('../app/screens-extras.jsx', import.meta.url), 'utf8'));

test('setting up help does not quietly pick today', () => {
  // Verity's own words: "Hospital appointment Thursday". The date box starts on today, Miriam left it, and
  // Callum is booked to drive her on SUNDAY. She could not edit it back afterwards.
  // Nothing here can know she means Thursday — so it must not pretend to. An unset date makes the steward
  // look at it, which is the whole of the fix.
  const i = TODAY.indexOf('function ApproveNeedSheet');
  const fn = TODAY.slice(i, TODAY.indexOf('\nfunction ', i + 10));
  assert.equal(/useState\(today\)/.test(fn), false,
    'the need still starts on today, whatever day the person asked for');
  assert.match(fn, /!start \|\| !end|!start/, 'nothing stops it being set up with no date at all');
});

test('you are not invited to help with your own request', () => {
  // Verity found her own name, twice, under "Someone in the church could use a hand — sign up for a day."
  // The list was filtered by date only; the recipient check ran solely on the team-only setting.
  // Slice to a real boundary, not a byte count: an explanatory comment pushed the code out of a 700-char
  // window and the assertion failed on window size, which is a mistake this file's neighbours have made twice.
  const i = TODAY.indexOf('const _split = splitCareNeeds');
  const block = TODAY.slice(i, TODAY.indexOf('return ', i));
  // TWO drafts of this were worthless. The first matched `n.recipient`, which the neighbouring line already
  // contained. The second asserted the exact line I had written — and that line was WRONG: it was gated on a
  // name that reads "is on the care team" but means "can see everything", so it never ran on the default
  // setting and emptied the recipient's screen on the other one. A source-text assertion cannot catch a
  // predicate whose name lies about what it does.
  // The behaviour is now proved by RUNNING it — see scripts/care-needs-split.test.mjs, which lifts the real
  // function and puts four people through it. All this one checks is that the screen still uses it.
  assert.match(block, /splitCareNeeds\(\{ needs: care\.needs/, 'the screen no longer uses the shared rule');
  assert.equal(/const amCareTeam/.test(TODAY), false,
    'the misleading name is back — it reads as a team test and is not one');
});

test('a long notice does not fill the notifications list as one block', () => {
  // Priyanka read the same notice twice: in the chat room it kept its shape, in Notifications it ran
  // together. The row had neither a line-break rule nor a clamp, so a whole order of service landed in it.
  const i = EXTRAS.indexOf('{n.text}');
  assert.ok(i > 0, 'the notification row no longer renders n.text — re-anchor');
  const el = EXTRAS.slice(EXTRAS.lastIndexOf('<p ', i), i);
  assert.match(el, /WebkitLineClamp/, 'the row is unclamped, so a long notice fills the list');
});

const MEALS = stripComments(readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8'));

test('and the sheet a STEWARD actually uses does not pick today either', () => {
  // There are two of these — the member app's care-team sheet and the console's. Miriam used the console's.
  // Fixing only the one I found first would have left the real path exactly as it was, which is how half a
  // defect ships; it is the third time in this project's history that a sibling caller was the whole bug.
  const i = MEALS.indexOf('function StewApproveSheet');
  const fn = MEALS.slice(i, MEALS.indexOf('\nfunction ', i + 10));
  assert.equal(/useState\(today\)/.test(fn), false, 'the console still starts the need on today');
  assert.match(fn, /if \(!dates\.length\) return/, 'the console can still open a need with no day on it');
});

const CHAT = stripComments(readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8'));

test('private conversations appear in the list of conversations', () => {
  // There has always been a route — a paper-plane button in the header, and it works. But in one afternoon
  // TWO members who had just had the most useful exchange of their day both concluded it was gone: "only
  // Whole Church and Prayer are there; to find it again I have to go People → their name → Message."
  // Neither was hunting for a button. They were looking for the thread where threads live.
  const i = CHAT.indexOf('function ChatScreen');
  const fn = CHAT.slice(i, CHAT.indexOf('\nfunction ', i + 10));
  assert.match(fn, /<SectionLabel>Private messages<\/SectionLabel>/, 'the Chat list still hides private threads');
  // It must NOT open its own subscription: the app already holds one permanently for the unread dot, and a
  // second meant replaying and decrypting up to a thousand messages twice over, again on every foregrounding.
  assert.equal(/subscribeDMs/.test(fn), false, 'the Chat list opens a second private-message subscription');
  assert.match(fn, /ctx\.dmThreads/, 'the section is not fed from the feed the app already holds');
  assert.match(fn, /ctx\.openDM\(c\.peer\)/, 'the rows do not open the conversation');
  // It must show enough to recognise: whose it is and what was last said.
  assert.match(fn, /c\.preview/, 'the row shows no hint of what the conversation was about');
});
