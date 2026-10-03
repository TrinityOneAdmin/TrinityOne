// A NOTIFICATION SAYS WHEN IT IS, AND BEING PUT ON THE ROTA IS ONE. Sim round 2026-10-02, finding #49.
// Run: node --test scripts/a-notification-says-when-and-the-rota-is-one.test.mjs
//
// "Four identical 'New event · ZZ Prayer breakfast' with no dates; nothing when put on the rota." A monthly event
// publishes one event per date, and the row said only how long ago it was published. And a member asked to
// serve got no notification at all.
//
// Users of the changed code (rule 2): NotifRow is rendered only by NotificationsScreen (app/screens-extras.jsx),
// opened from the bell; `ctx.notifications` is built only in app.jsx's `notifications` memo, which now also calls
// notifServingItems. Existing notification kinds are untouched; they get a date line only if they carry an
// `event` or `req`.
//
// HOW IT ASSERTS (rule 3): the real NotificationsScreen is drawn with real notification objects shaped as
// app.jsx builds them, and the text on screen is read. NOT TESTED: that app.jsx's memo really calls
// notifServingItems (the App component cannot be rendered in isolation) - that one line is covered by reading
// it and by the device pass, not by this file.
//
// NOT DONE, ON PURPOSE: a notification when a CARE NEED is set up. The sim listed it beside the rota, but the
// brief for this fix named only the rota; a care need is shown to every helper, and what its notification
// should say (and to whom) is a privacy question for the owner, not a copy fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const { React, draw } = miniReact();
const mod = loadScreen('app/screens-extras.jsx', ['NotificationsScreen', 'notifServingItems', 'notifWhen'], {
  React, Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), safeCssColor: (c) => c, UserAvatar: Stub('UserAvatar'), Sheet: Stub('Sheet'),
  Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
  window: { Fellowship: {}, addEventListener() {}, removeEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, lsGet: (k, d) => d, lsSet() {}, useTrinityAudio: () => ({}), fetch: async () => ({}),
});
const NOW = Math.floor(Date.now() / 1000);
const screen = (notifications) => texts(draw(mod.NotificationsScreen, { open: true, onClose() {}, ctx: { notifications, markNetSeen() {}, toast() {} } })).join(' | ');
const evt = (id, date, extra = {}) => ({ id: 'evt:' + id, kind: 'event', group: 'St Bride’s', text: 'New event · ZZ Prayer breakfast', ts: NOW - 60, go: 'event', event: { id, title: 'ZZ Prayer breakfast', date, time: '09:00', ...extra } });

test('four events with the same title are told apart by the day they are on', () => {
  const s = screen([evt('a', '2026-11-06'), evt('b', '2026-12-04'), evt('c', '2027-01-01'), evt('d', '2027-02-05')]);
  for (const d of ['Fri 6 Nov', 'Fri 4 Dec', 'Fri 1 Jan', 'Fri 5 Feb']) assert.match(s, new RegExp(d), `the row for ${d} does not say when it is`);
  assert.match(s, /Fri 6 Nov · 09:00/, 'the time should follow the day');
});

test('a repeating meeting does not claim the day its series started on', () => {
  const s = screen([evt('w', '2026-09-02', { recur: 'weekly', day: 3 })]);
  assert.match(s, /ZZ Prayer breakfast/, 'control: the row did not render');
  assert.doesNotMatch(s, /Wed 2 Sep/, 'a weekly meeting was dated by its first occurrence');
});

test('a notification with no event or request gets no date line', () => {
  assert.equal(mod.notifWhen({ kind: 'notice', text: 'hello' }), '');
});

test('being asked to serve is a notification, with the role, the team and the day', () => {
  const reqs = [{ id: 'r1', ts: NOW - 30, date: '2099-01-04', time: '10:30', role: 'Greeter', teamName: 'Welcome', serviceId: 's1' }];
  const items = mod.notifServingItems(reqs, '2026-10-03', 'St Bride’s');
  assert.equal(items.length, 1, 'a serving request produced no notification');
  const s = screen(items);
  assert.match(s, /Asked you to serve · Greeter · Welcome/);
  assert.match(s, /Sun 4 Jan · 10:30/);
});

test('a request that is locked, unreadable, undated or already past is not announced', () => {
  const base = { ts: NOW, date: '2099-01-04', role: 'Greeter' };
  const reqs = [
    { id: 'locked', ...base, _locked: true }, { id: 'unread', ...base, _unreadable: true },
    { id: 'nodate', ts: NOW, role: 'Greeter' }, { id: 'past', ...base, date: '2020-01-04' },
  ];
  assert.deepEqual(mod.notifServingItems(reqs, '2026-10-03', 'St Bride’s'), []);
});
