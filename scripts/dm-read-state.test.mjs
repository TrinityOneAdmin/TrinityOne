// READING ONE CONVERSATION MUST NOT SWALLOW ANOTHER.
// Run: node --test scripts/dm-read-state.test.mjs
//
// There was one "seen" time for the whole inbox. Once opening a conversation began stamping it, opening a
// chat with ALICE marked BOB's unread message as seen and cleared the dot — and Bob's message had never been
// on screen, with no per-conversation marker anywhere to surface it again. A lit dot is a nuisance; a
// silently swallowed "can you collect my prescription" is not, and members in the simulation said private
// messages were the only thing that actually worked.
//
// These run the real functions out of the shipped screen, because the previous two attempts at this class of
// fix both passed their tests while broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// a tiny localStorage, and the three read-state functions lifted whole out of app.jsx
function rig({ me = 'me', store = {} } = {}) {
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const scope = {
    localStorage,
    window: { Fellowship: { myPubkey: me } },
    dmThreadsRef: { current: [] },
    dmNewestTs: { current: 0 },
    setDmUnread: (v) => { scope._unread = v; },
    _unread: false,
  };
  const src = [
    'const dmSeenKey = ' + fnBody(APP, 'const dmSeenKey = () =>').replace(/^const dmSeenKey = /, ''),
    'const dmSeenPeerKey = ' + fnBody(APP, 'const dmSeenPeerKey = (peer) =>').replace(/^const dmSeenPeerKey = /, ''),
  ].join(';\n');
  return { scope, store, src };
}

// simpler and more honest than partial lifts: build the same three functions from the shipped TEXT of each,
// in one scope, so what runs here is what ships.
function build({ me = 'me', store = {} } = {}) {
  const code = stripComments(APP);
  const grab = (needle) => {
    const at = code.indexOf(needle);
    assert.notEqual(at, -1, needle + ' is gone from app.jsx — re-anchor this test');
    let depth = 0, started = false;
    for (let i = at; i < code.length; i++) {
      if (code[i] === '{') { depth++; started = true; }
      else if (code[i] === '}') { depth--; if (started && depth === 0) return code.slice(at, i + 1) + ';'; }
    }
    assert.fail('could not find the end of ' + needle);
  };
  const body = [grab('const dmSeenPeerKey = (peer) =>'), grab('const dmSeenFloor = () =>'),
                grab('const dmSeenFor = (peer) =>'), grab('const markDmSeenFor = (peer, ts) =>'),
                grab('const markDmSeen = () =>')].join('\n');
  let unread = false;
  const state = { store };
  const fn = new Function('localStorage', 'window', 'dmThreadsRef', 'dmNewestTs', 'setDmUnread', 'dmSeenKey',
    body + '\nreturn { dmSeenFor, markDmSeenFor, markDmSeen };');
  const api = fn(
    { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    { Fellowship: { myPubkey: me } },
    state,
    { current: 0 },
    (v) => { unread = v; },
    () => 'trinityone.dmSeen.' + me,
  );
  return { ...api, state, store, unread: () => unread };
}

test('opening Alice’s chat does not swallow Bob’s unread message', () => {
  const r = build();
  r.state.current = [
    { peer: 'alice', lastTs: 100, preview: 'hello' },
    { peer: 'bob', lastTs: 200, preview: 'can you collect my prescription' },
  ];
  r.markDmSeenFor('alice', 100);
  assert.equal(r.dmSeenFor('alice'), 100, 'Alice’s conversation was not marked read');
  assert.equal(r.dmSeenFor('bob'), 0, 'BOB’s message was marked read by opening ALICE’s chat');
  assert.equal(r.unread(), true, 'the dot went out while Bob’s message was still unread and unseen');
});

test('opening the inbox marks everything, because the inbox shows everything', () => {
  const r = build();
  r.state.current = [{ peer: 'alice', lastTs: 100, preview: 'a' }, { peer: 'bob', lastTs: 200, preview: 'b' }];
  r.markDmSeen();
  assert.equal(r.dmSeenFor('bob'), 200, 'the inbox left a conversation it had just displayed unread');
  assert.equal(r.unread(), false, 'the dot survived looking straight at the messages');
});

test('the old single marker becomes a floor, so nothing already stamped comes back', () => {
  // A member upgrading has one inbox-wide value and no per-conversation ones.
  const r = build({ store: { 'trinityone.dmSeen.me': '500' } });
  assert.equal(r.dmSeenFor('alice'), 500, 'an upgrade re-opened every conversation as unread');
  assert.equal(r.dmSeenFor('bob'), 500, 'an upgrade re-opened every conversation as unread');
});

test('a newer message still lights the dot for its own conversation', () => {
  const r = build({ store: { 'trinityone.dmSeen.me': '500' } });
  r.state.current = [{ peer: 'alice', lastTs: 900, preview: 'later' }];
  r.markDmSeenFor('bob', 600);
  assert.equal(r.unread(), true, 'a message newer than the floor did not light the dot');
});
