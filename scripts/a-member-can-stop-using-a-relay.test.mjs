// A MEMBER MUST BE ABLE TO STOP TALKING TO AN ADDRESS.
// Run: node --test scripts/a-member-can-stop-using-a-relay.test.mjs
//
// AUDIT 2026-09-02 #9. An address gets onto a member's relay list from an invite, and nothing ever took one
// off. It stayed, was retried, and kept receiving a signed NIP-42 AUTH and the shape of that member's
// church and groups every time it was re-checked — including an address adopted from a hostile invite
// before the C5 gate existed. `remove()` was written in RelaysSheet and never rendered, so there was no way
// in the PRODUCT to stop.
//
// Two things this must get right, and they pull against each other: the control has to exist, and it must
// not be a way to lose your church. So it is offered only on rows that have NOT proved themselves, never on
// a canonical address, and it asks first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const CANON = 'wss://app.trinityone.church/relay';
const STRANGER = 'wss://someone-elses-box.example/relay';
const PROVED = 'wss://our-church.example/relay';

function sheet({ removed = [] } = {}) {
  const { React, draw } = miniReact();
  const g = {
    React,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    BottomSheet: (p) => p.children, Sheet: (p) => p.children,
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    copyText: () => {},
    window: {
      Fellowship: {
        relays: [PROVED, STRANGER, CANON],
        // only the church's own box has proved itself; the other two have not
        relayVerified: (u) => u === PROVED,
        removeRelay: (u) => { removed.push(u); return true; },
        CANONICAL_RELAYS: [CANON],
      },
      TrinityData: { RELAYS: [] }, addEventListener() {}, removeEventListener() {},
    },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }),
                body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
  };
  const { RelaysSheet } = loadScreen('app/identity-extras.jsx', ['RelaysSheet'], g);
  let tree = draw(RelaysSheet, { open: true, onClose() {}, ctx: {} });
  const redraw = () => { tree = draw(RelaysSheet, { open: true, onClose() {}, ctx: {} }); return tree; };
  const byLabel = (re) => find(tree, n => n.type === 'button' && n.props && re.test(String(n.props['aria-label'] || '')));
  return { removed, redraw, byLabel, words: () => texts(tree).join(' ') };
}

test('CONTROL: the sheet lists the relays and says which are in use', () => {
  const s = sheet();
  assert.match(s.words(), /Connected/, 'no proved relay is shown as Connected — re-anchor this test');
  assert.match(s.words(), /Not in use/, 'no unproved relay is shown — re-anchor this test');
});

test('AN UNPROVED ADDRESS CAN BE REMOVED — that control was written and never rendered', () => {
  const s = sheet();
  const drop = s.byLabel(new RegExp('Stop using someone-elses-box'));
  assert.equal(drop.length, 1,
    'there is no way to stop using an address that has never shown it belongs to this church. It goes on ' +
    'receiving a signed AUTH and this member\'s church and group shape every time it is re-checked');
});

test('…it asks first, and only then removes', () => {
  const s = sheet();
  s.byLabel(/Stop using someone-elses-box/)[0].props.onClick();
  s.redraw();
  assert.deepEqual(s.removed, [], 'one tap removed a relay with no confirmation');
  const confirm = s.byLabel(/Confirm: stop using someone-elses-box/);
  assert.equal(confirm.length, 1, 'no confirm appeared, so the first tap did nothing at all');
  confirm[0].props.onClick();
  assert.deepEqual(s.removed, [STRANGER], 'confirming did not remove the relay');
});

test('A RELAY THAT IS CARRYING THIS CHURCH’S TRAFFIC HAS NO REMOVE', () => {
  const s = sheet();
  assert.equal(s.byLabel(/Stop using our-church/).length, 0,
    'a proved, connected relay offers a Remove button. That is how a member drops the box their church ' +
    'actually runs, by accident, from a phone');
});

test('AND A CANONICAL ADDRESS IS NEVER REMOVABLE', () => {
  const s = sheet();
  assert.equal(s.byLabel(/Stop using app\.trinityone\.church/).length, 0,
    'the shipped default can be removed from a member\'s phone. Dropping it is how a member loses their ' +
    'church rather than a stray address');
});
