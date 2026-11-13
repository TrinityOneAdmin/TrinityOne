// A STEWARD'S PICK LANDS ON THE SERVICE THEY WERE LOOKING AT — EVEN IF THE SERVICE LIST CHANGES UNDER THEM.
//   Run: node --test scripts/a-rota-pick-lands-on-the-service-it-was-made-for.test.mjs
//
// Audit of 4c47c063, M2 (owner decided 2026-11-13 to fix it on this branch). With no chip tapped, the rota board
// shows its OPENING service (the first not past), and every per-service action acts on whatever that is at the
// moment of the action. The opening service is recomputed from the list on every render, so when the list changes
// — a service with an earlier date syncs in from another steward, or a cached list is followed by the live one — the
// board jumped to it. Measured by the audit at 69dd2d98 and at 4c47c063: open on Sun 22, open the picker on Greeter,
// Wed 18 syncs in, choose Ruth — Ruth landed in Wed 18's draft and Publish sent publishRota({ service: 'wed18' }).
//
// The rule now (the audit's recommendation, owner-approved):
//   · the opening service is still chosen against the frozen moment services first arrived;
//   · the FIRST time the steward acts on a service, that service becomes the explicit selection, so nothing in the
//     list can move it afterwards;
//   · the assign picker writes to the service it was opened for (slot.service), whatever is selected by then.
//
// HOW THIS FILE ASSERTS (CLAUDE.md rules 1 and 3): the REAL DashRota, compiled from app/stew-schedule.jsx by
// scripts/rota-board-harness.mjs, its real buttons pressed and its real AssignModal callbacks called; the result is
// read from what Publish hands Steward.publishRota and from the board's own text. Nothing matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { find, reads } from './render-jsx-screen.mjs';
import { mountBoard, PUB_A, PUB_B } from './rota-board-harness.mjs';

function clockAt(iso) {
  const now = new Date(iso).getTime();
  return class FixedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  };
}
const RUTH = { id: 'p1', name: 'Ruth Bexley', pub: PUB_A };
const SUN22 = { id: 'sun22', date: '2026-11-22', time: '10:30', name: 'Sunday Gathering' };
const WED18 = { id: 'wed18', date: '2026-11-18', time: '19:30', name: 'Midweek' };
const SUN29 = { id: 'sun29', date: '2026-11-29', time: '10:30', name: 'Sunday Gathering' };

// Monday 16 Nov, noon: the board opens on Sun 22. `services` is the array the services hook returns, so pushing into
// it is a sync arriving.
function setup({ pods = [] } = {}) {
  const services = [SUN22];
  const rotas = [{ id: 'sun22', service: 'sun22', published: true, assign: {} }];
  const b = mountBoard({
    services, rotas, scope: { Date: clockAt('2026-11-16T12:00') },
    rosters: [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [RUTH], pods }],
  });
  return { b, services, sync: (svc) => { services.push(svc); } };
}
const chips = (tree) => find(tree, n => n.type === 'button' && n.props && n.props['data-svc-id'] !== undefined);
const selected = (tree) => chips(tree).filter(n => n.props['aria-pressed'] === true).map(n => n.props['data-svc-id']);
const btn = (tree, pred, what) => {
  const f = find(tree, n => n.type === 'button' && pred(n));
  assert.ok(f.length, `no ${what} on the rota board — re-anchor this test`);
  return f[0];
};
const openPicker = (b) => btn(b.draw(), n => n.props['aria-label'] === 'Assign someone to Greeter', '"Assign someone to Greeter" button').props.onClick();
const picker = (tree) => {
  const m = find(tree, n => typeof n.type === 'function' && n.type.name === 'AssignModal');
  assert.equal(m.length, 1, 'the assign picker is not open — re-anchor this test');
  return m[0].props;
};
const publish = (b) => btn(b.draw(), n => /^Publish/.test(reads(n)), 'Publish button').props.onClick();

test('THE AUDIT\'S CASE: picker open on Sun 22, Wed 18 syncs in, Ruth is chosen — she lands on Sun 22 and Publish publishes Sun 22', async () => {
  const { b, sync } = setup();
  assert.deepEqual(selected(b.draw()), ['sun22'], 'the fixture is wrong: the board did not open on Sun 22');
  openPicker(b);
  sync(WED18);                                   // another steward's Wednesday service arrives while the picker is open
  picker(b.draw()).onAssign(RUTH);               // the steward chooses Ruth
  const tree = b.draw();
  assert.deepEqual(selected(tree), ['sun22'], 'the board moved off Sun 22 while the steward was assigning');
  await publish(b);
  assert.equal(b.calls.publishRota.length, 1, 'Publish did not publish');
  const sent = b.calls.publishRota[0];
  assert.equal(sent.service, 'sun22', `Publish sent the rota for ${sent.service}, not Sun 22`);
  assert.equal(sent.assign['t1::r1'] && sent.assign['t1::r1'].name, 'Ruth Bexley', 'Ruth is not on Sun 22\'s published rota');
});

// Every first action pins the service it acted on. Each case: a fresh board on Sun 22, one action, then Wed 18
// syncs in; the board must still be on Sun 22.
const ACTIONS = [
  ['opening the assign picker', (b) => openPicker(b)],
  ['Copy last week', (b) => btn(b.draw(), n => reads(n).includes('Copy last week'), 'Copy last week').props.onClick()],
  ['Auto-fill, this service only', (b) => {
    btn(b.draw(), n => /^Auto-fill/.test(reads(n)), 'Auto-fill').props.onClick();
    btn(b.draw(), n => reads(n).includes('This service only'), '"This service only"').props.onClick();
  }],
  ['Publish', (b) => publish(b)],
  ['applying a serving pod', (b) => {
    const sel = find(b.draw(), n => n.type === 'select' && n.props.title === 'Apply a serving pod');
    assert.equal(sel.length, 1, 'no pod menu on the team card — re-anchor this test');
    sel[0].props.onChange({ target: { value: 'podA' } });
  }],
];
for (const [what, act] of ACTIONS) {
  test(`${what} makes Sun 22 the selection, so a service syncing in afterwards cannot move the board`, async () => {
    const { b, sync } = setup({ pods: [{ id: 'podA', name: 'Pod A', fills: { r1: 'p1' } }] });
    assert.deepEqual(selected(b.draw()), ['sun22']);
    await act(b);
    sync(WED18);
    assert.deepEqual(selected(b.draw()), ['sun22'], `after ${what}, a service syncing in moved the board`);
  });
}

// CONTROL: with no action at all, a syncing service is still allowed to correct the opening choice (that is what the
// frozen moment is for: a list that arrives in parts settles on the right opening service before anyone acts).
test('CONTROL: with nothing done yet, an earlier service syncing in still becomes the opening service', () => {
  const { b, sync } = setup();
  assert.deepEqual(selected(b.draw()), ['sun22']);
  sync(WED18);
  assert.deepEqual(selected(b.draw()), ['wed18'], 'the opening choice no longer follows the list before the steward acts');
});

// The picker writes to the service it was opened for, whatever is selected by the time a person is chosen. The
// picker is a full-screen modal, so in the console nothing else can be tapped while it is open; this pins the
// contract directly (selection changed under an open picker), so it holds even if some future path moves the
// selection.
test('the assign picker writes to the service it was opened for, even if the selection changes while it is open', async () => {
  const services = [SUN22, SUN29];
  const rotas = [{ id: 'sun22', service: 'sun22', published: true, assign: {} }, { id: 'sun29', service: 'sun29', published: true, assign: {} }];
  const b = mountBoard({ services, rotas, scope: { Date: clockAt('2026-11-16T12:00') }, rosters: [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [RUTH], pods: [] }] });
  assert.deepEqual(selected(b.draw()), ['sun22']);
  openPicker(b);
  picker(b.draw());                              // the picker is open, for Sun 22
  // the selection moves to Sun 29 while the picker (opened for Sun 22) is still up
  chips(b.draw()).find(n => n.props['data-svc-id'] === 'sun29').props.onClick();
  assert.deepEqual(selected(b.draw()), ['sun29']);
  picker(b.draw()).onAssign(RUTH);
  assert.doesNotMatch(reads(b.draw()), /Ruth Bexley/, 'Ruth was put on Sun 29, the service the picker was NOT opened for');
  chips(b.draw()).find(n => n.props['data-svc-id'] === 'sun22').props.onClick();
  assert.match(reads(b.draw()), /Ruth Bexley/, 'Ruth is not on Sun 22, the service the picker was opened for');
});

// ── RE-AUDIT OF 59cd37eb ───────────────────────────────────────────────────────────────────────────────────────────
// F1: DashRota stays mounted across a church switch, so a pinned selection (any action pins) pointed at a service the
// new church does not have, and the page said "Add a service to start building a rota." above the new church's chips.
const NO_SERVICE = 'Add a service to start building a rota.';
function mutableClock(iso) {
  let now = new Date(iso).getTime();
  class FixedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  return { Date: FixedDate, set(next) { now = new Date(next).getTime(); } };
}
function twoChurches(clockIso = '2026-11-16T12:00') {
  const clock = mutableClock(clockIso);
  const services = [SUN22];
  const b = mountBoard({
    services, rotas: [{ id: 'sun22', service: 'sun22', published: true, assign: {} }], scope: { Date: clock.Date },
    rosters: [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [RUTH], pods: [] }],
    steward: { pubkey: 'church-a' },
  });
  // what the identity switcher does, as far as this board can see: window.Steward now acts for the other church, and
  // the services hook returns that church's list
  const switchTo = (pub, list) => { b.sch.win.Steward.pubkey = pub; services.length = 0; services.push(...list); };
  return { b, clock, services, switchTo };
}
const B_SUN29 = { id: 'b-sun29', date: '2026-11-29', time: '10:30', name: 'Morning Prayer' };
const B_DEC6 = { id: 'b-dec6', date: '2026-12-06', time: '10:30', name: 'Morning Prayer' };

test('F1: after an action pins Sun 22, switching church opens on the other church\'s next service, not on "Add a service"', async () => {
  const { b, switchTo } = twoChurches();
  await publish(b);                                         // pins Sun 22
  assert.equal(b.calls.publishRota.length, 1);
  switchTo('church-b', [B_SUN29, B_DEC6]);
  const tree = b.draw();
  assert.ok(!reads(tree).includes(NO_SERVICE), 'after a church switch the Rota says "Add a service" above the new church\'s chips');
  assert.deepEqual(selected(tree), ['b-sun29'], 'the board did not open on the new church\'s next service');
});

test('F1: a pinned service that leaves the list falls back to the opening service (no church switch involved)', async () => {
  const { b, services } = twoChurches();
  services.push(SUN29);
  await publish(b);                                         // pins Sun 22
  services.splice(services.findIndex(s => s.id === 'sun22'), 1);
  const tree = b.draw();
  assert.ok(!reads(tree).includes(NO_SERVICE), 'a pinned service that went away left the Rota saying "Add a service"');
  assert.deepEqual(selected(tree), ['sun29']);
});

test('F1: a church switch re-takes the frozen moment, so the new church opens on what is next NOW', () => {
  const { b, clock, switchTo } = twoChurches('2026-11-16T12:00');
  assert.deepEqual(selected(b.draw()), ['sun22']);
  clock.set('2026-11-29T13:00');                            // B's 10:30 service on the 29th passed at 12:30
  switchTo('church-b', [B_SUN29, B_DEC6]);
  assert.deepEqual(selected(b.draw()), ['b-dec6'], 'the new church was judged against the old church\'s frozen moment');
});

// F2: opening the Auto-fill menu, or the pod menu, is the first step of an action; a sync while it is open must not
// change which service it acts on.
test('F2: opening the Auto-fill menu pins Sun 22 — a sync while it is open does not change the service it names', () => {
  const { b, sync } = setup();
  btn(b.draw(), n => /^Auto-fill/.test(reads(n)), 'Auto-fill').props.onClick();
  sync(WED18);
  const tree = b.draw();
  assert.deepEqual(selected(tree), ['sun22'], 'a sync with the Auto-fill menu open moved the board');
  const item = btn(tree, n => reads(n).includes('This service only'), '"This service only"');
  assert.match(reads(item), /Sun 22 Nov/, `the open menu now names another service: ${reads(item)}`);
});

for (const ev of ['onFocus', 'onMouseDown']) {
  test(`F2: the pod menu pins Sun 22 when it is opened (${ev}) — a sync before a pod is chosen does not move the board`, () => {
    const { b, sync } = setup({ pods: [{ id: 'podA', name: 'Pod A', fills: { r1: 'p1' } }] });
    const sel = find(b.draw(), n => n.type === 'select' && n.props.title === 'Apply a serving pod');
    assert.equal(sel.length, 1, 'no pod menu on the team card — re-anchor this test');
    assert.equal(typeof sel[0].props[ev], 'function', `the pod menu has no ${ev} — it does not pin when opened`);
    sel[0].props[ev]({});
    sync(WED18);
    assert.deepEqual(selected(b.draw()), ['sun22'], `a sync after the pod menu was opened (${ev}) moved the board`);
  });
}

// F3: confirmSwap publishes and messages a member from a per-slot button, so its pin gets its own test. Fixture as in
// scripts/a-steward-confirms-a-swap-with-one-tap.test.mjs: Ruth on Greeter asked to swap with Sam, and Sam said yes.
test('F3: confirming a swap pins Sun 22 — it publishes Sun 22, and a sync afterwards does not move the board', async () => {
  const SAM = { id: 'p2', name: 'Sam Smith', pub: PUB_B };
  const services = [SUN22];
  const b = mountBoard({
    services, scope: { Date: clockAt('2026-11-16T12:00') },
    rosters: [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], pods: [], people: [RUTH, SAM] }],
    rotas: [{ id: 'sun22', service: 'sun22', published: true, assign: { 't1::r1': { id: 'p1', name: 'Ruth Bexley', pub: PUB_A } } }],
    requests: [{ id: 'req1', serviceId: 'sun22', teamId: 't1', roleId: 'r1', memberPub: PUB_A, ts: 100 }],
    replies: [{ id: 'req1', v: 'swap', swapTo: PUB_B, by: PUB_A, ts: 200 }, { id: 'swapans~req1', v: 'swapyes', by: PUB_B, ts: 300 }],
  });
  assert.deepEqual(selected(b.draw()), ['sun22']);
  await btn(b.draw(), n => reads(n).includes('Confirm: Sam Smith covers'), 'swap confirm button').props.onClick();
  assert.equal(b.calls.publishRota.length, 1, 'the swap was not published');
  assert.equal(b.calls.publishRota[0].service, 'sun22');
  services.push(WED18);
  assert.deepEqual(selected(b.draw()), ['sun22'], 'after confirming a swap, a service syncing in moved the board');
});
