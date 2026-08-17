// AN EVENT OPENED FROM A GROUP CHAT MUST LAND ON TOP OF THAT CHAT.
// Run: node --test scripts/event-sheet-above-chat.test.mjs
//
// MEASURED IN A LIVE APP (2026-08-17, member admitted to St Aidan's on the funnel relay). A group chat's
// "UPCOMING IN THIS GROUP" strip renders each event as a button whose onClick calls ctx.openEvent — which
// mounts EventDetail. EventDetail is a BottomSheet and took the DEFAULT z (50). A chat room is an Overlay,
// and Overlay paints at zIndex 55. So the sheet mounted UNDERNEATH the room the member was standing in.
//
// What that looked like to the person: they tap an event with a chevron inviting the tap, and nothing happens.
// Not an error, not a flicker — nothing. `document.elementFromPoint()` at the exact centre of the "Going"
// button returned the chat composer TEXTAREA, so even a perfectly aimed finger hit the message box. A member
// could not RSVP to their own group's event by the route the app most obviously offers.
//
// It is worth stating why this survived: the same sheet works perfectly from Serving → Events, because
// nothing is stacked above it there. The defect only exists on the path through a chat room — and no test,
// and no simulation round, had ever opened an event from inside a group.
//
// The guard is a COMPARISON, not a magic number. Hard-coding "z must be 70" would pass happily on the day
// someone raises Overlay to 80.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const UI   = readFileSync(new URL('../app/ui.jsx', import.meta.url), 'utf8');
const SERV = readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8');
const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');

// The z an Overlay paints at — a chat room is one of these.
function overlayZ() {
  const body = stripComments(fnBody(UI, 'function Overlay('));
  const m = body.match(/zIndex:\s*(\d+)/);
  assert.ok(m, 'Overlay no longer sets a literal zIndex — re-anchor this test rather than deleting it');
  return Number(m[1]);
}

// The z EventDetail asks its BottomSheet for (absent → BottomSheet's default).
function eventDetailZ() {
  const body = stripComments(fnBody(SERV, 'function EventDetail({ event, open, onClose, ctx }) {'));
  const explicit = body.match(/<BottomSheet[^>]*\bz=\{(\d+)\}/);
  if (explicit) return Number(explicit[1]);
  const def = stripComments(UI).match(/function BottomSheet\([^)]*\bz\s*=\s*(\d+)/);
  assert.ok(def, 'cannot read BottomSheet’s default z');
  return Number(def[1]);
}

test('the group chat really does open events through this sheet', () => {
  // If this link is ever broken the test above stops meaning anything, so assert the route exists.
  const chat = stripComments(CHAT);
  assert.match(chat, /UPCOMING IN THIS GROUP/, 'the in-group events strip is gone — re-anchor this test');
  assert.match(chat, /ctx\.openEvent\s*\?\s*ctx\.openEvent\(e\)/,
    'tapping an event in a group must open the focused sheet');
});

test('the event sheet paints ABOVE the chat room it was opened from', () => {
  const chatZ = overlayZ(), sheetZ = eventDetailZ();
  assert.ok(sheetZ > chatZ,
    `EventDetail paints at z=${sheetZ} and a chat room at z=${chatZ} — so the sheet opens UNDERNEATH the room ` +
    'the member is standing in, and the tap does nothing at all. Measured on a live app: elementFromPoint at ' +
    'the centre of "Going" returned the chat composer.');
});

test('its RSVP controls are the ones that publish', () => {
  const body = stripComments(fnBody(SERV, 'function EventDetail({ event, open, onClose, ctx }) {'));
  assert.match(body, /ctx\.setRsvp/, 'a sheet the member can now reach must still be able to answer');
  assert.match(body, /'going'|'maybe'|'no'/, 'the three answers are the point of the sheet');
});
