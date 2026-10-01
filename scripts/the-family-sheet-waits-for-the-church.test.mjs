// THE FAMILY SHEET DOES NOT SAY "NO CHILDREN — MAKE ONE BELOW" WHILE THE CHURCH HAS NOT ANSWERED YET.
// Run: node --test scripts/the-family-sheet-waits-for-the-church.test.mjs
//
// Re-audit of b7624a8 (2026-10-01): after a lock the family list is empty until the church's notice is applied
// or the rebuild of the parent's own requests finishes — and in that gap the sheet told a parent whose child IS
// linked "No children linked to you yet … If they have no account, you can make one below", which invites a
// second account for a child that already has one. Nothing refreshed the sheet when the answer did arrive.
//
// The engine now says when a church has answered (Fellowship.familyAnswered — its own behaviour is driven in
// scripts/an-unlinked-child-stays-gone-after-a-lock.test.mjs) and fires `trinity-family-changed`. This file
// renders the REAL FamilySheet from app/identity.jsx (compiled with the build's esbuild, drawn through
// scripts/render-jsx-screen.mjs) and reads what it shows. Nothing matches source text (CLAUDE.md rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const ME = 'a'.repeat(64), KID = 'b'.repeat(64);

function sheet(state) {
  const rt = { cur: null };
  const listeners = {};
  const timers = [];
  const React = {
    useState: (i) => rt.cur.React.useState(i), useEffect: (f, d) => rt.cur.React.useEffect(f, d),
    useRef: (i) => rt.cur.React.useRef(i), useMemo: (f, d) => rt.cur.React.useMemo(f, d),
    useCallback: (f, d) => rt.cur.React.useCallback(f, d), createElement: (...a) => rt.cur.React.createElement(...a),
    Fragment: 'Fragment',
  };
  const win = {
    Fellowship: { myPubkey: ME, myChildren: () => state.kids, familyAnswered: () => state.answered },
    TrinityIdentity: { makeInvite: () => ({ mnemonic: 'x' }), qrSVG: () => '' },
    addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); },
    removeEventListener: (n, f) => { listeners[n] = (listeners[n] || []).filter(g => g !== f); },
    Capacitor: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { href: 'https://x/', origin: 'https://x', search: '' },
  };
  const mod = loadScreen('app/identity.jsx', ['FamilySheet'], {
    React, window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    navigator: { clipboard: null }, location: win.location,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    Overlay: ({ open, children }) => (open ? children : null), useDialogA11y: () => {},
    Icon: () => null, IconBtn: ({ name, onClick }) => React.createElement('button', { title: name, onClick }),
    Group: ({ children }) => children, Row: () => null, inviteUrlFor: () => 'https://x/#s=x', D: { RELAYS: [] },
  });
  rt.cur = miniReact();
  const ctx = { church: { npub: 'npub1church', name: 'Trinity' }, safeguard: { guardians: {} }, toast: () => {} };
  const draw = () => rt.cur.draw(mod.FamilySheet, { open: true, onClose: () => {}, ctx });
  const fire = (n) => (listeners[n] || []).forEach(f => f());
  return { draw, fire, timers, listeners };
}
const shows = (tree) => texts(tree).join(' ');

test('while the church has not answered, the empty sheet says it is checking — not "make one below"', () => {
  const s = sheet({ kids: [], answered: false });
  const t = shows(s.draw());
  assert.ok(!/No children linked to you yet/.test(t) && !/make one below/.test(t),
    'THE SHEET INVITED A NEW ACCOUNT BEFORE THE CHURCH HAD ANSWERED — a parent whose child is linked is told to make another');
  assert.match(t, /Checking with your church/, 'the sheet says nothing about waiting for the church');
});

test('when the engine says the family changed, the sheet follows — the answer, then the linked child', () => {
  const state = { kids: [], answered: false };
  const s = sheet(state);
  s.draw();
  assert.ok((s.listeners['trinity-family-changed'] || []).length, 'the sheet does not listen for trinity-family-changed, so nothing ever refreshes it');
  state.answered = true; s.fire('trinity-family-changed');
  assert.match(shows(s.draw()), /No children linked to you yet/, 'CONTROL: once the church has answered with nothing, the empty state is shown');
  state.kids = [{ child: KID, name: 'Cleo', churchPub: 'c', linked: true }]; s.fire('trinity-family-changed');
  const t = shows(s.draw());
  assert.match(t, /Cleo/, 'the linked child never appeared');
  assert.match(t, /Linked & protected/, 'a child the church’s list names is not shown as linked');
});

test('a church that never answers does not hold the sheet for ever', () => {
  const s = sheet({ kids: [], answered: false });
  s.draw();
  const wait = s.timers.find(t => t.ms > 1000);
  assert.ok(wait, 'the sheet waits on the church with no time limit');
  assert.ok(wait.ms <= 20000, 'the sheet waits too long before saying what it knows: ' + wait.ms + 'ms');
  wait.fn();
  assert.match(shows(s.draw()), /No children linked to you yet/, 'after the wait the sheet still says nothing');
});
