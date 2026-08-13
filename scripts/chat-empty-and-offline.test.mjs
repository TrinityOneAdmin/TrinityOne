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
  // THIS USED TO PIN THE EXACT LINE `relayReady() { return !!_relayAuthedAt; }` — an assertion about how the
  // answer was written rather than what it had to mean, and that spelling was itself the bug. _relayAuthedAt
  // is set once on a successful NIP-42 auth and is cleared ONLY by reconnectAll() on a PIN unlock, so after
  // one good connection this reported "reachable" for the rest of the page's life. Verified on a real phone
  // (2026-08-12): with wifi and mobile data both off, an empty room still said "Say hello".
  //
  // So the requirement is behavioural: being reachable needs a live socket, not just a memory of one.
  assert.match(FELLOW, /relayReady\(\)\s*\{\s*return\s*!!_relayAuthedAt\s*&&\s*window\.Fellowship\.relaysHealthy\(\)/,
    'relayReady() answers from _relayAuthedAt alone. That flag means "we authenticated at some point", not ' +
    '"we can reach the church now" — nothing clears it when the connection drops, so a member who loses ' +
    'signal is told their church is simply quiet, over a room they cannot actually reach');
  assert.match(FELLOW, /relaysHealthy\(\)\s*\{/,
    'relaysHealthy() is gone — that is the only thing that actually inspects live sockets, and relayReady() ' +
    'now depends on it');
  assert.match(CHAT, /Can’t reach your church/,
    'an offline member is shown the same "no messages" as a member whose church is simply quiet');
  assert.match(CHAT, /\{connected/, 'the empty state does not branch on the connection at all');
  // …BUT NOT ON THE BARE FLAG. relayReady() is `!!_relayAuthedAt`, which is 0 for the whole of a normal
  // startup until NIP-42 completes — so branching straight on it announced "Can't reach your church" on
  // EVERY cold open of an empty room, until authentication landed. A false alarm about reaching your church
  // is worse than saying nothing: a member on a thin connection cannot check it, and it teaches them to
  // distrust the true one. The claim has to wait out a grace period first.
  assert.match(CHAT, /\{connected \|\| !settled/,
    'an empty room claims "Can\'t reach your church" the instant it opens, before the relay has been given ' +
    'any chance to authenticate — which is every cold open, on a working connection');
  assert.match(CHAT, /if \(connected\) \{ setSettled\(true\); return; \}/,
    'the grace period is applied to a connection that has ALREADY worked, so a genuine drop mid-conversation ' +
    'is hidden for six seconds — the one case where the message is true and useful straight away');
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
