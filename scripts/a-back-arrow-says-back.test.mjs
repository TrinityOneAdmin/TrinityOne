// A BACK ARROW SAYS "Back". Sim round 2026-10-02, finding #53 ("unlabelled back arrows").
// Run: node --test scripts/a-back-arrow-says-back.test.mjs
//
// Every full-screen surface opened with a bare chevron on a 40px square; the word "Back" existed only as an
// aria-label for a screen reader. IconBtn (app/ui.jsx) now draws the word beside the arrow for the back
// chevron, and the hand-rolled square back buttons that duplicated it (Notifications, Listen, Notification
// settings, Currency, the identity sheets, three chat headers) were replaced with IconBtn so they say it too.
//
// Users of the changed code (rule 2): IconBtn is used by ~60 sites across app/*.jsx; only those passing
// name="chevL" change (about 25 - every full-screen header). `iconOnly` opts a caller out; none does. Tests
// that render screens with IconBtn stubbed are unaffected; scripts/editing-a-sermons-title-does-not-re-date-it
// needed an IconBtn stub added to its globals because ListenScreen now uses it.
//
// HOW IT ASSERTS (rule 3): the real IconBtn is compiled and drawn, and so are two real screens that carry a
// back control (NotificationsScreen, ChildrenAtChurchSheet), through the REAL IconBtn. What is read is the
// text a sighted person would see inside the button, not the aria-label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const { React, draw } = miniReact();
const Icon = function Icon() { return null; };
const ui = loadScreen('app/ui.jsx', ['IconBtn'], {
  React, window: {}, Icon, document: { addEventListener() {}, removeEventListener() {} }, PhoneFrame: Stub('PhoneFrame'),
  localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, navigator: {},
});
// what is drawn INSIDE the button, apart from its attributes — the visible words
// (an Icon's `name` prop is not a word anyone sees, so only text nodes and <span>s count)
const visible = (btn) => (btn.kids || []).filter(k => typeof k === 'string' || (k && k.type === 'span')).flatMap(k => texts(k)).join(' ').trim();

test('the back chevron draws the word, and other icons do not', () => {
  const back = find(draw(ui.IconBtn, { name: 'chevL', onClick() {} }), n => n.type === 'button')[0];
  assert.equal(visible(back), 'Back');
  assert.equal(back.props['aria-label'], 'Back', 'the accessible name must stay');
  const close = find(draw(ui.IconBtn, { name: 'x', onClick() {} }), n => n.type === 'button')[0];
  assert.equal(visible(close), '', 'only the back arrow takes a word - a close button stays an icon');
  const optOut = find(draw(ui.IconBtn, { name: 'chevL', iconOnly: true, onClick() {} }), n => n.type === 'button')[0];
  assert.equal(visible(optOut), '', 'iconOnly must still opt a caller out');
});

function backOf(file, name, props, globals) {
  const mod = loadScreen(file, [name], {
    React, Icon, IconBtn: ui.IconBtn, safeCssColor: (c) => c,
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    window: { Fellowship: {}, addEventListener() {}, removeEventListener() {} },
    NotifToggleRow: Stub('NotifToggleRow'), UserAvatar: Stub('UserAvatar'), Sheet: Stub('Sheet'),
    localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout,
    lsGet: (k, d) => d, lsSet() {}, useTrinityAudio: () => ({}), fetch: async () => ({}),
    ...globals,
  });
  const tree = draw(mod[name], { open: true, onClose() {}, ...props });
  return find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Back');
}

test('the Notifications screen has a back control that says Back', () => {
  const b = backOf('app/screens-extras.jsx', 'NotificationsScreen', { ctx: { notifications: [], markNetSeen() {}, toast() {} } });
  assert.equal(b.length, 1, 'no back control on the Notifications screen - re-anchor this test');
  assert.equal(visible(b[0]), 'Back', 'THE DEFECT: the Notifications screen shows a bare arrow');
});

test('the Children at church sheet has a back control that says Back', () => {
  const b = backOf('app/identity.jsx', 'ChildrenAtChurchSheet', { ctx: { church: { npub: 'npub1x' } } });
  assert.equal(b.length, 1, 'no back control on the Children at church sheet - re-anchor this test');
  assert.equal(visible(b[0]), 'Back');
});
