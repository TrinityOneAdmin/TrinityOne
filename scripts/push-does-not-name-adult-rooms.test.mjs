// AN ADULTS-ONLY ROOM'S NAME MUST NOT REACH A YOUNG PERSON'S LOCK SCREEN.
// Run: node --test scripts/push-does-not-name-adult-rooms.test.mjs
//
// AUDIT 2026-08-29. canRead refuses a minor the MESSAGES of a room their church has not marked child-safe
// (the `g` branch, `!GROUP_CHILDSAFE.has(g) && MINORS_BY…has(authed)`). maybePushMessage had no such rule and
// puts the ROOM'S NAME in the push title — so the relay withheld the contents of "Addiction Recovery" from a
// 14-year-old and pushed the words "Addiction Recovery" to their lock screen.
//
// It is the same disclosure the withholding exists to prevent, on a path no client-side filter can reach:
// the member app's own room-name leak was closed the same day, and fixing one without the other would have
// moved the leak rather than removed it.
//
// This lifts the shipped maybePushMessage out of scripts/gateway.mjs and runs it. There were no push tests
// of any kind before this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
function grabFn(name) {
  const at = SRC.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' is gone from the relay — re-anchor this test, do not delete it');
  let depth = 0, q = '';
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    const c = SRC[i], p = SRC[i - 1];
    if (q) { if (c === q && p !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && SRC[i + 1] === '/') { i = SRC.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return SRC.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + name);
}

const CHURCH = 'c'.repeat(64), CHILD = 'k'.repeat(64), ADULT = 'a'.repeat(64), POSTER = 'p'.repeat(64);
const GID = 'grp-recovery';

// `childsafe` = has the church marked this room safe for young people (opt-in, absent by default).
function relay({ childsafe = false, minors = [CHILD], members = [CHILD, ADULT], vis = 'church', churchKnown = true } = {}) {
  const sent = [];
  const scope = {
    gidOf: (e) => (e.tags.find(t => t[0] === 't') || [])[1] || '',
    BROADCAST: new Set([GID]),
    GROUP_NAMES: new Map([[GID, 'Addiction Recovery']]),
    GROUP_CHURCH: churchKnown ? new Map([[GID, CHURCH]]) : new Map(),
    idNamesOwner: () => (churchKnown ? '' : CHURCH),   // the relay's fallback when the map has no entry
    GROUP_VIS: new Map([[GID, vis]]),
    GROUP_MEMBERS: new Map([[GID, new Set(members)]]),
    ROSTER_PEOPLE: new Map([[GID, new Set(members)]]),
    MEMBERS: new Set(members),
    memberIn: () => true,
    GROUP_CHILDSAFE: childsafe ? new Set([GID]) : new Set(),
    MINORS_BY: new Map([[CHURCH, new Set(minors)]]),
    pushTo: (who, payload, cat) => { sent.push({ who, title: payload.title, cat }); },
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, grabFn('maybePushMessage') + '\nreturn maybePushMessage;')(...args.map(k => scope[k]));
  return {
    post: () => fn({ kind: 1, pubkey: POSTER, tags: [['t', GID]], content: 'hello' }),
    sent,
    to: (w) => sent.filter(s => s.who === w),
  };
}

test('a young person is not sent the name of a room their church has not marked child-safe', () => {
  const r = relay();
  r.post();
  assert.deepEqual(r.to(CHILD), [],
    'the words "Addiction Recovery" were pushed to a 14-year-old’s lock screen, while the relay refuses ' +
    'them the messages from that same room');
});

test('…and every adult still gets the announcement', () => {
  const r = relay();
  r.post();
  assert.equal(r.to(ADULT).length, 1, 'the fix silenced announcements for the whole church');
  assert.equal(r.to(ADULT)[0].title, 'Addiction Recovery');
});

test('a room the church HAS marked child-safe still reaches them', () => {
  // The gate is the church's own choice, not a blanket ban: a youth announcements room must still work.
  const r = relay({ childsafe: true });
  r.post();
  assert.equal(r.to(CHILD).length, 1, 'a child-safe room stopped reaching the young people it is for');
});

test('an adult in a church that marks nobody is unaffected', () => {
  const r = relay({ minors: [] });
  r.post();
  assert.equal(r.to(ADULT).length, 1);
  assert.equal(r.to(CHILD).length, 1, 'someone the church never marked as a child was treated as one');
});

test('the rule survives the relay not holding the group’s church in its map', () => {
  // canRead uses `GROUP_CHURCH.get(g) || idNamesOwner(g)`; this must use the same fallback or the gate
  // silently stops applying for exactly the documents whose ownership had to be derived.
  const r = relay({ churchKnown: false });
  r.post();
  assert.deepEqual(r.to(CHILD), [], 'the gate lapsed when the church had to be derived from the group id');
});

test('a direct message still says nothing about who sent it', () => {
  // Guard the neighbouring branch: its title is deliberately anonymous (AUDIT-2026-07-27), and this fix
  // must not have disturbed it.
  const r = relay();
  const fn = new Function('gidOf', 'BROADCAST', 'GROUP_NAMES', 'GROUP_CHURCH', 'idNamesOwner', 'GROUP_VIS',
    'GROUP_MEMBERS', 'ROSTER_PEOPLE', 'MEMBERS', 'memberIn', 'GROUP_CHILDSAFE', 'MINORS_BY', 'pushTo',
    grabFn('maybePushMessage') + '\nreturn maybePushMessage;')(
    () => '', new Set(), new Map(), new Map(), () => '', new Map(), new Map(), new Map(), new Set(), () => true,
    new Set(), new Map(), (who, payload) => r.sent.push({ who, title: payload.title, body: payload.body }));
  fn({ kind: 4, pubkey: POSTER, tags: [['p', CHILD]], content: 'x' });
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].title, 'New message');
  assert.doesNotMatch(r.sent[0].body, /[a-f0-9]{16}/, 'a pubkey leaked into a push payload');
});
