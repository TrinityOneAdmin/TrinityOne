// WHEN TWO PEOPLE PUBLISH THE SAME CHURCH DOCUMENT, EVERY MEMBER MUST SEE THE SAME ONE.
// Run: node --test scripts/two-authors-one-document.test.mjs
//
// A church document keyed by id — a service, a rota, a roster, a run sheet, an event — may legitimately be
// written by more than one trusted author: the church key, and any steward it has empowered. These are
// addressable events, so the relay keeps one per AUTHOR; it cannot collapse two authors into one. The choice
// falls to the client, and the client was not making one: `byId.set(id, …)` on arrival meant whichever copy
// landed last won.
//
// SIMULATION ROUND 9. The vicar published a rota for one Sunday with ten real people on it, sealed. The
// churchwarden — who could not see hers, and had been told "build your first team" — published a parallel
// rota for the same service 62 seconds later. Both valid, both signed. The second silently replaced the first
// on every phone in the parish. Four people had already pressed "Yes, I can serve"; their acceptances were
// published correctly and their phones said "No dates scheduled for you yet", because the rota with their
// names in it no longer existed anywhere they could reach.
//
// This does not decide who OUGHT to win — the app cannot know, and both writes were authorised. It guarantees
// only that every member decides the same way, and that the losing author is remembered rather than erased.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const V = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const absorb = new Function(fnBody(V, 'function _absorbById', '_absorbById') + '\nreturn _absorbById;')();

const CHURCH = 'a'.repeat(64), WARDEN = 'b'.repeat(64);
const rec = (by, ts, tag) => ({ id: 'svc1', _by: by, ts, tag });

test('the newer write wins, whichever order it arrives in', () => {
  const a = new Map(); absorb(a, 'svc1', rec(CHURCH, 100, 'church')); absorb(a, 'svc1', rec(WARDEN, 162, 'warden'));
  const b = new Map(); absorb(b, 'svc1', rec(WARDEN, 162, 'warden')); absorb(b, 'svc1', rec(CHURCH, 100, 'church'));
  assert.equal(a.get('svc1').tag, 'warden');
  assert.equal(b.get('svc1').tag, 'warden',
    'arrival order still decides the winner — two members holding different rotas for one Sunday');
});

test('THE ACTUAL ROUND-9 SEQUENCE: an older church rota is not resurrected by arriving late', () => {
  // The exact timestamps from the simulation's relay, to the second.
  const m = new Map();
  absorb(m, 'svc1787775296550', rec(WARDEN, 1787776483, 'warden'));   // arrives first on a reconnect
  absorb(m, 'svc1787775296550', rec(CHURCH, 1787776421, 'church'));   // the older one, replayed after
  assert.equal(m.get('svc1787775296550').tag, 'warden',
    'a replay of older history overwrote the current rota — the screen changes under people on reconnect');
});

test('an exact tie is broken the same way on every phone', () => {
  // Two consoles, same second. Arbitrary is fine; different-per-member is not.
  const a = new Map(); absorb(a, 'x', rec(CHURCH, 500, 'church')); absorb(a, 'x', rec(WARDEN, 500, 'warden'));
  const b = new Map(); absorb(b, 'x', rec(WARDEN, 500, 'warden')); absorb(b, 'x', rec(CHURCH, 500, 'church'));
  assert.equal(a.get('x').tag, b.get('x').tag,
    'two members disagree about what this Sunday looks like, and neither can tell why');
});

test('the same author updating their own document always wins', () => {
  // The ordinary case, and it must not regress: editing a rota you published must show your edit.
  const m = new Map();
  absorb(m, 'x', rec(CHURCH, 100, 'first draft'));
  absorb(m, 'x', rec(CHURCH, 200, 'corrected'));
  assert.equal(m.get('x').tag, 'corrected', 'a steward can no longer correct their own rota');
});

test('the losing author is remembered, not erased', () => {
  // So a screen can say "two people have published a rota for this service" instead of pretending otherwise.
  const m = new Map();
  absorb(m, 'x', rec(CHURCH, 100, 'church'));
  absorb(m, 'x', rec(WARDEN, 200, 'warden'));
  assert.equal(m.get('x')._alt, CHURCH, 'the competing copy vanished without trace, so nothing can warn anyone');
  const n = new Map();
  absorb(n, 'x', rec(WARDEN, 200, 'warden'));
  absorb(n, 'x', rec(CHURCH, 100, 'church'));
  assert.equal(n.get('x')._alt, CHURCH, 'a late-arriving competitor is not recorded either');
});

test('every church document keyed by id goes through the guard', () => {
  // _subChurchAddr feeds services, run sheets, rotas, rosters, events and networks. If one of them still
  // calls byId.set directly, that document keeps the old accident.
  const body = stripComments(fnBody(V, '_subChurchAddr(churchNpub, prefix, map, onItems)', '_subChurchAddr'));
  assert.ok(!/byId\.set\(/.test(body),
    'a raw byId.set() is back in _subChurchAddr — last-writer-wins for whichever document that is');
  assert.match(body, /_absorbById\(byId, id,[\s\S]{0,200}_absorbById\(byId, id,/,
    'both the sealed and the readable path must go through the guard');
});
