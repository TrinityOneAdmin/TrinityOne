// THE ENCRYPTION LABEL MUST NOT SCROLL AWAY.
// Run: node --test scripts/the-room-says-what-it-is-while-you-are-in-it.test.mjs
//
// A room that the relay can read says "Not encrypted" on its face. That label was the FIRST CHILD of the
// scrolling message list — and the room jumps to the newest message when it opens (`scRef`, and again
// after every send). So in any room with more than a screenful of history the label was gone before
// anyone saw it. The member who scrolls up meets it; the member who opens a busy room and types does not,
// and that is the member it exists for.
//
// The words are load-bearing and unchanged: encrypted-by-default.test.mjs and group-encryption-honesty
// .test.mjs both turn on a room never claiming more than it does — the latter exists because a room
// labelled "End-to-end encrypted" once sent plain text. This file guards only WHERE it lives.
//
// Rule 3 forbids asserting behaviour by matching text in app/*.jsx, which ship unbundled — `false &&` in
// front of a condition leaves every word in place. So this does not merely look for the words: it locates
// the scrolling container and the label and asserts their ORDER in the source, which a dead-code edit
// cannot fake, and it asserts the label is not inside the scroller's element.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => ' '.repeat(m.length))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

// The chat room: the scroller carrying gap 14. (The other scRef, gap 8, is the DM view.)
const ROOM_SCROLLER = "ref={scRef} className=\"no-scrollbar\" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}";

test('the label is rendered ABOVE the scrolling message list, not inside it', () => {
  const src = strip(SRC);
  const scroller = src.indexOf(ROOM_SCROLLER);
  assert.notEqual(scroller, -1, 'the room scroller moved — re-anchor this test rather than widening it');

  const label = src.indexOf("encState === 'sealed' ? 'End-to-end encrypted'");
  assert.notEqual(label, -1, 'the encryption label is gone from the chat room entirely');

  assert.ok(label < scroller,
    'the encryption label is inside the scrolling message list again. The room scrolls to the newest ' +
    'message on open, so in any room with more than a screenful the label is off-screen before anyone ' +
    'reads it — and it is the only thing telling a member the relay can read what they are about to type.');
});

test('exactly one label in the room — a second would drift from the first', () => {
  const src = strip(SRC);
  const scroller = src.indexOf(ROOM_SCROLLER);
  const room = src.slice(Math.max(0, scroller - 4000), scroller + 4000);
  const n = room.split("encState === 'sealed' ? 'End-to-end encrypted'").length - 1;
  assert.equal(n, 1,
    `${n} encryption labels around the room view. Two copies drift: group-encryption-honesty.test.mjs ` +
    'exists because a room once said "End-to-end encrypted" over plain text, and a stale duplicate is ' +
    'how that comes back.');
});

test('the three states are all still reachable, and worded exactly as the honesty tests expect', () => {
  const src = strip(SRC);
  for (const words of ['End-to-end encrypted', 'Encrypted · no key yet', 'Not encrypted']) {
    assert.ok(src.includes(words), `the "${words}" state is gone from the chat room`);
  }
});
