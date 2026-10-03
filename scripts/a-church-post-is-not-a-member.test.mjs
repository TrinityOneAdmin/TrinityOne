// A POST FROM THE CHURCH, OR FROM A STEWARD, IS NOT SIGNED "Member". Sim round 2026-10-02, finding #51.
// Run: node --test scripts/a-church-post-is-not-a-member.test.mjs
//
// Two screens named the church's own voice as an anonymous person:
//   MEMBER APP  displayFor() gave the church key a name only once the owner had saved a by-line (a voice
//               document). A church that never had, and a delegated steward with no member name and no
//               by-line, both read "Member".
//   CONSOLE     the group chat labelled any author missing from the members list "member …1a2b3c4d" — and the
//               church key and every delegate are exactly the authors missing from that list.
//
// Users of displayFor (CLAUDE.md rule 2) — this change alters what it returns for the church key and for a
// steward on the church-signed roster, and for nobody else. Callers found with
//     grep -n "displayFor(" app/*.jsx src/*.js
// are the chat bubbles, reply-to lines, DM headers and lists (screens-chat.jsx), the members list and the
// notice by-line. They all read `.handle` / `.name`; none branches on the literal string 'Member'. `named`
// stays false for both new cases, so "set your name" nudges still fire for an unnamed steward.
//
// HOW IT ASSERTS. The member-app half runs the SHIPPED vendor/fellowship.js whole, in a vm, and calls the real
// displayFor. The console half renders the real GroupChatModal. Neither matches text in app/*.jsx (rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFellowship } from './fellowship-vm.mjs';
import { loadComponent, Stub, settle } from './console-component-rig.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const CHURCH = 'c'.repeat(64), STEWARD = 'd'.repeat(64), SOMEONE = 'e'.repeat(64);

// ── member app ──────────────────────────────────────────────────────────────────────────────────────────────
test('a church that never wrote a by-line is still "Your church", not "Member"', () => {
  const { F } = loadFellowship();
  assert.equal(F.displayFor(CHURCH).handle, 'Member', 'control: before the church is known, a key is just a member');
  F.setChurch(CHURCH);
  const d = F.displayFor(CHURCH);
  assert.equal(d.handle, 'Your church', 'the church key is still shown as a member');
  assert.equal(d.isChurch, true);
});

test('the church is called by its own name once its profile is known', () => {
  const { F, exposed } = loadFellowship({ expose: ['_churchNames'] });
  exposed._churchNames.set(CHURCH, 'St Bride’s');   // what subscribeChurchProfile records from the church kind-0
  assert.equal(F.displayFor(CHURCH).handle, 'St Bride’s');
});

test('a delegated steward with no chosen name reads as a steward, an ordinary member still reads "Member"', () => {
  const { F, exposed } = loadFellowship({ expose: ['_churchRoster'] });
  exposed._churchRoster.set(CHURCH, new Set([STEWARD]));
  assert.equal(F.displayFor(STEWARD).handle, 'A church steward');
  assert.equal(F.displayFor(STEWARD).named, false, 'an unnamed steward must still count as unnamed');
  assert.equal(F.displayFor(SOMEONE).handle, 'Member', 'the fallback for everyone else must not move');
});

// ── console ─────────────────────────────────────────────────────────────────────────────────────────────────
async function chatShowing(messages, { labels = {}, stewards = [], church = { name: 'St Bride’s' }, members = [] } = {}) {
  const { React, draw } = miniReact();
  const win = {
    Steward: {
      pubkey: CHURCH,
      stewardLabels: () => labels,
      subscribeGroupChat: (id, cb) => { cb(messages); return () => {}; },
      subscribeGroupPin: (id, cb) => { cb(null); return () => {}; },
      subscribeGroupEvents: (id, cb) => { cb([]); return () => {}; },
    },
    useStewardMembers: () => members, useStewardChurch: () => church, useStewardStewards: () => stewards,
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  const mod = await loadComponent('app/stew-dashboard.jsx', 'function GroupChatModal({ group, onClose }) {', {
    React, window: win, CustomEvent, setTimeout, clearTimeout,
    Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), useStewDialog: () => ({}),
  });
  const props = { group: { id: 'g1', name: 'Whole Church', kind: 'group' }, onClose() {} };
  draw(mod.GroupChatModal, props);
  await settle();
  const tree = draw(mod.GroupChatModal, props);   // effects run after the draw that queued them
  return texts(tree).join(' | ');
}
const msg = (by, text) => ({ id: 'm-' + by.slice(0, 3), by, text, ts: 1 });

test('console: the church key is named, not "member …tail"', async () => {
  const screen = await chatShowing([msg(CHURCH, 'Welcome all')]);
  assert.match(screen, /St Bride’s/, 'the church’s own post is not signed with the church name');
  assert.doesNotMatch(screen, /member …/);
});

test('console: a delegated steward is named by the owner’s label, else "A steward"', async () => {
  const labelled = await chatShowing([msg(STEWARD, 'Rota is out')], { labels: { [STEWARD]: 'Tom (youth)' }, stewards: [STEWARD] });
  assert.match(labelled, /Tom \(youth\)/);
  const plain = await chatShowing([msg(STEWARD, 'Rota is out')], { stewards: [STEWARD] });
  assert.match(plain, /A steward/);
  assert.doesNotMatch(plain, /member …/);
});

test('console: a real member name still wins, and an unknown author is still the hex tail', async () => {
  const named = await chatShowing([msg(STEWARD, 'hi')], { members: [{ pubkey: STEWARD, name: 'Tom Hall' }], stewards: [STEWARD] });
  assert.match(named, /Tom Hall/);
  const stranger = await chatShowing([msg(SOMEONE, 'hi')]);
  assert.match(stranger, /member …eeeeeeee/);
});
