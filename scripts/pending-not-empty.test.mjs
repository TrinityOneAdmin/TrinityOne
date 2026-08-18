// A WAITING MEMBER MUST NOT BE TOLD THEIR CHURCH IS EMPTY.
// Run: node --test scripts/pending-not-empty.test.mjs
//
// Until a steward admits someone, the relay serves them none of the church's corpus — correctly, and that
// gate is not changing: a steward has always approved members, and admission stays human-only by decision.
// But the app stated the resulting blankness as a FACT ABOUT THE CHURCH:
//
//   Events   "No socials or events yet — your church will post them here."   (18 services existed)
//   Calendar "Nothing on this day."                                          (a full term of services)
//
// Only the Community tab ever admitted anyone was waiting. In the round of 2026-08-18 six independent agents
// reported the church as empty or dead, and one wrote that it read as "this church is empty, not you can't
// see this yet" — while a seventh, looking at the same parish from an admitted account, saw a working church.
//
// The distinction is the whole point: "there is nothing here" and "this isn't shared with you yet" are
// different sentences, and only one of them is true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const SERV = stripComments(readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8'));

const around = (needle, span = 700) => {
  const i = SERV.indexOf(needle);
  return i === -1 ? '' : SERV.slice(Math.max(0, i - span), i + span);
};

test('the "what\'s on" empty state distinguishes waiting from empty', () => {
  const ctx = around('No socials or events yet');
  assert.ok(ctx, 're-anchor: the events empty state has moved');
  assert.match(ctx, /joinState[\s\S]{0,40}isPending/,
    'a pending member is still told the church has posted nothing, when the church may have a full calendar ' +
    'they simply cannot see yet');
});

test('the calendar day empty state does the same', () => {
  const ctx = around('Nothing on this day');
  assert.ok(ctx, 're-anchor: the calendar empty state has moved');
  assert.match(ctx, /joinState[\s\S]{0,40}isPending/,
    'an empty day reads as a fact about the church rather than a consequence of not being approved');
});

test('pending state is read from the field that exists', () => {
  // ctx exposes `joinState`; there is no `ctx.isPending`, and reading it is always undefined — falsy, silent,
  // and permanently wrong. A first pass at this shipped exactly that.
  const bad = [...SERV.matchAll(/ctx\.isPending/g)];
  assert.equal(bad.length, 0,
    'ctx.isPending does not exist — pending state lives on ctx.joinState.isPending, and the wrong read fails ' +
    'closed and silently');
});
