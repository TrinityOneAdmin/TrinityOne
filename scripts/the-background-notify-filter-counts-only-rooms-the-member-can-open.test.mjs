// THE BACKGROUND NOTIFY FILTER COUNTS ONLY ROOMS THE MEMBER CAN OPEN.
//   Run: node scripts/run-tests.mjs the-background-notify-filter-counts-only-rooms-the-member-can-open.test.mjs
//
// plugins/trinity-directpush/js/bg-entry.js decides which rooms the Direct Mode background check counts.
// A young person must never have an adults-only room counted (a notification is a leak of its existence).
// bg-entry.js cannot be imported in node (it installs window.__dpStart and pulls in fellowship), so the REAL
// functions are lifted out of the source text and executed (CLAUDE.md rule 3: run it, never text-match it).
// The relay remains the safeguarding authority; this pins the phone-side filter so it cannot silently widen.
//
// Callers of the lifted functions: only __dpStart in bg-entry.js. No shared code is changed by this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../plugins/trinity-directpush/js/bg-entry.js', import.meta.url), 'utf8');
const visibleGroupIds = new Function(fnBody(SRC, 'function visibleGroupIds(', 'visibleGroupIds') + '\nreturn visibleGroupIds;')();
const parseBlocked = new Function(fnBody(SRC, 'function parseBlocked(', 'parseBlocked') + '\nreturn parseBlocked;')();
const isBlockDoc = new Function('return ' + SRC.match(/const isBlockDoc = (.*);\n/)[1])();
// The block-drop step is inline in __dpStart: lift exactly the statements from `const bl =` to the end of the filter.
const dropSrc = SRC.slice(SRC.indexOf('const bl = parseBlocked(blockDoc);'), SRC.indexOf('const newer = '));
assert.ok(dropSrc.includes('droppedBlocked') && dropSrc.length < 800, 'block-drop slice not found; re-anchor');
const dropBlocked = new Function('parseBlocked', 'seen', 'blockDoc', dropSrc + '\nreturn { evs, droppedBlocked };');

const ME = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const DIR = [
  { id: 'open-adult' },                                                   // open, NOT childsafe
  { id: 'open-safe', childsafe: true },
  { id: 'invite-me', visibility: 'invite', members: [ME.toUpperCase()], childsafe: false },
  { id: 'invite-me-safe', visibility: 'invite', members: [ME], childsafe: true },
  { id: 'invite-not-me', visibility: 'invite', members: [OTHER], childsafe: true },
  { id: 'invite-nomembers', visibility: 'invite', childsafe: true },
];

test('a minor is counted only for childsafe rooms: open adult rooms and invite rooms are excluded', () => {
  const ids = visibleGroupIds(DIR, ME, true);
  assert.deepEqual(ids.sort(), ['invite-me-safe', 'open-safe']);
  assert.ok(!ids.includes('open-adult'), 'an open non-childsafe room must not reach a minor');
  assert.ok(!ids.includes('invite-me'), 'an adults-only invite room must not reach a minor even if listed as a member');
});

test('an adult gets open rooms, childsafe rooms and invite rooms they belong to, never one they are not in', () => {
  const ids = visibleGroupIds(DIR, ME, false);
  assert.deepEqual(ids.sort(), ['invite-me', 'invite-me-safe', 'open-adult', 'open-safe']);
  assert.ok(!ids.includes('invite-not-me') && !ids.includes('invite-nomembers'));
});

test('a minor flag that is anything but false cannot widen: the filter is the only thing between a minor and adult rooms', () => {
  // bg-entry passes `true` when assumeMinor throws or has not heard; assert that is the narrow answer.
  assert.ok(visibleGroupIds(DIR, ME, true).length < visibleGroupIds(DIR, ME, false).length);
});

test('a missing or non-array directory means DM-only, never the full directory', () => {
  for (const bad of [undefined, null, 'x', {}, 7]) assert.deepEqual(visibleGroupIds(bad, ME, false), []);
  assert.deepEqual(visibleGroupIds([null, {}, { id: '' }, { id: 5 }], ME, false), []);
});

test('the blocklist document itself (kind 30078) is recognised so it is never counted; a lookalike is not', () => {
  const D = 'trinityone/blocked:CP';
  const doc = { kind: 30078, pubkey: 'CP', tags: [['d', D]] };
  assert.equal(isBlockDoc(doc, 'CP', D), true);
  assert.equal(isBlockDoc({ ...doc, pubkey: OTHER }, 'CP', D), false, 'only the church key may author it');
  assert.equal(isBlockDoc({ ...doc, kind: 4 }, 'CP', D), false);
});

test('a blocked author is dropped, others kept; case-insensitive', () => {
  const doc = { content: JSON.stringify({ pubkeys: [OTHER.toUpperCase()] }) };
  const seen = new Map([['1', { id: '1', pubkey: OTHER }], ['2', { id: '2', pubkey: ME }]]);
  const r = dropBlocked(parseBlocked, seen, doc);
  assert.deepEqual(r.evs.map((e) => e.id), ['2']);
  assert.equal(r.droppedBlocked, 1);
});

test('no blocklist doc means nobody blocked', () => {
  const seen = new Map([['1', { id: '1', pubkey: OTHER }]]);
  assert.equal(dropBlocked(parseBlocked, seen, null).evs.length, 1);
});

test('an unparseable blocklist returns null and the filter FAILS CLOSED: everything is dropped', () => {
  assert.equal(parseBlocked({ content: '{not json' }), null);
  const seen = new Map([['1', { id: '1', pubkey: OTHER }], ['2', { id: '2', pubkey: ME }]]);
  const r = dropBlocked(parseBlocked, seen, { content: '{not json' });
  assert.equal(r.evs.length, 0, 'null blocklist must count nothing (safe: a missed notification, never a leaked one)');
  assert.equal(r.droppedBlocked, 2);
});
