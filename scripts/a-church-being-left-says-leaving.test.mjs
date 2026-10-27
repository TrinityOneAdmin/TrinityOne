// A CHURCH WHOSE LEAVE IS WAITING FOR SIGNAL SAYS "LEAVING…" AND OFFERS NO SECOND LEAVE (G2, owner 2026-10-27).
//   Run: node --test scripts/a-church-being-left-says-leaving.test.mjs
//
// An offline Leave is queued; the church stays on the phone until the tombstone is delivered. This renders the
// SHIPPED ChurchSwitcher (app/screens-church.jsx) and reads the drawn tree (CLAUDE.md rule 3), with ctx.leaveQueued
// answering for one church. The engine side of leaveQueued is driven in a-leave-in-flight-is-not-undone.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

function switcher(leavingId) {
  const { React, draw } = miniReact();
  const Stub = (n) => function S(p) { return React.createElement('div', { 'data-stub': n }, p && p.children); };
  const { ChurchSwitcher } = loadScreen('app/screens-church.jsx', ['ChurchSwitcher'], {
    React, console, URLSearchParams, location: { search: '' },
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: Stub('IconBtn'), ChurchBadge: Stub('ChurchBadge'), FollowChurch: Stub('FollowChurch'),
    BottomSheet: ({ children }) => React.createElement('div', { 'data-sheet': 1 }, children),
    safeImgUrl: (u) => u || '', safeCssColor: (c) => c,
    window: { makeNameDisambiguator: (_l, name) => (c) => name(c) }, document: { querySelector: () => null },
  });
  const churches = [
    { id: 'npub1leaving', npub: 'npub1leaving', name: 'Leaving Church', members: 3 },
    { id: 'npub1staying', npub: 'npub1staying', name: 'Staying Church', members: 5 },
  ];
  const ctx = { leaveQueued: (id) => id === leavingId, leaveChurch: () => {} };
  const props = { open: true, onClose: () => {}, ctx, churches, activeId: 'npub1staying', onPick: () => {}, onFollowed: () => {} };
  draw(ChurchSwitcher, props);
  return draw(ChurchSwitcher, props);   // twice: the open effect sets the list mode after the first draw
}
const rowOf = (tree, name) => find(tree, n => n && n.props && n.props.style && n.props.style.padding === 14
  && texts(n).includes(name))[0];
const leaveButtons = (row) => find(row, n => n && n.type === 'button' && n.props && n.props.title === 'Leave this church');

test('the church being left says "Leaving…" and has no Leave button; the other church is untouched', () => {
  const tree = switcher('npub1leaving');
  const leaving = rowOf(tree, 'Leaving Church'), staying = rowOf(tree, 'Staying Church');
  assert.ok(leaving && staying, 're-anchor: the church rows were not found in the drawn switcher');
  assert.ok(texts(leaving).some(t => /^Leaving…/.test(t)), 'the row of a church being left does not say so: ' + JSON.stringify(texts(leaving)));
  assert.equal(leaveButtons(leaving).length, 0, 'a church whose Leave is already waiting offers a second Leave');
  assert.ok(!texts(staying).some(t => /Leaving…/.test(t)), 'a church nobody is leaving says "Leaving…"');
  assert.equal(leaveButtons(staying).length, 1, 'CONTROL: the other church lost its Leave button');
});

test('CONTROL: with no Leave waiting, every followed church has its Leave button and its member count', () => {
  const tree = switcher(null);
  for (const name of ['Leaving Church', 'Staying Church']) {
    const row = rowOf(tree, name);
    assert.equal(leaveButtons(row).length, 1, name + ' has no Leave button');
    assert.ok(!texts(row).some(t => /Leaving…/.test(t)), name + ' says "Leaving…" with nothing queued');
  }
});
