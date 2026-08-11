// AN EMPTY ROOM AND A SILENT ONE ARE NOT THE SAME THING.
// Run: node --test scripts/chat-empty-and-offline.test.mjs
//
// THE DEFECT (user-flow audit, confirmed). A group room with no messages rendered `{bubbles}` and nothing
// else — a blank area between the header and the message box. A member cannot tell "nobody has posted" from
// "it is broken" or "it has not loaded", which is the failure mode this project cares most about. The group
// list one screen earlier already says "No messages yet" on every row; inside the room it said nothing.
//
// Worse offline: the cached list still renders "No messages yet" over messages the member sent themselves,
// and no screen anywhere says the connection is down. So silence reads as "nothing is happening at my church"
// rather than "I cannot reach my church".
//
// And every group row was a bare <div> with a click handler: unreachable by keyboard or switch access. Chat
// was the only part of the app entirely closed to those members — "Serving & events" and "People" above it
// are real buttons and always worked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
const FELLOW = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

test('an empty room explains itself', () => {
  assert.match(CHAT, /\{visibleMsgs\.length \? bubbles : \(/,
    'the message list renders unconditionally, so a room with no messages is a blank screen');
  assert.match(CHAT, /No messages yet/, 'there is no empty state inside the room');
});

test('offline says so, rather than looking quiet', () => {
  assert.match(FELLOW, /relayReady\(\) \{ return !!_relayAuthedAt; \}/,
    'the app knows whether the relay is reachable but does not expose it, so no screen can tell a silent ' +
    'church from an unreachable one');
  assert.match(CHAT, /Can’t reach your church/,
    'an offline member is shown the same "no messages" as a member whose church is simply quiet');
  assert.match(CHAT, /\{connected/, 'the empty state does not branch on the connection at all');
  assert.match(CHAT, /relayReady/, 'the screen never asks whether the church is reachable');
});

test('the connection state is re-read while a room stays open', () => {
  assert.match(CHAT, /setInterval\(read, 3000\)/,
    'the connection is read once at mount, so a room open while the signal comes back keeps saying the ' +
    'church is unreachable');
});

test('every group row can be opened without a touchscreen', () => {
  const rows = CHAT.match(/onClick=\{\(\) => openGroup\(/g) || [];
  const operable = CHAT.match(/role="button" tabIndex=\{0\} onKeyDown=/g) || [];
  assert.ok(rows.length >= 3, 'the group rows moved — re-anchor this test');
  assert.equal(operable.length, rows.length,
    `${rows.length} group rows but only ${operable.length} reachable by keyboard. Chat is the only part of ` +
    'the app closed to keyboard and switch users, and it is the part with the people in it');
});

test('the shipped bundle carries the connection check', () => {
  assert.match(VENDOR, /relayReady/, 'vendor/fellowship.js predates this — run npm run build:bundles');
});
