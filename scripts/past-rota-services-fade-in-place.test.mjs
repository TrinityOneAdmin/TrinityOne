// A SERVICE THAT HAS PASSED IS FADED IN PLACE ON THE CONSOLE'S ROTA STRIP — NOT MOVED, NOT HIDDEN, STILL TAPPABLE.
//   Run: node --test scripts/past-rota-services-fade-in-place.test.mjs
//
// Owner decisions (2026-11-13), and what each test below pins:
//   · A chip is past at service START + 2 HOURS, compared as real timestamps — a 23:00 service is past at 01:00 the
//     next day, not at midnight. A service with no time, or a time that cannot be read, is past from local midnight
//     at the end of its day. "7:05" is a valid time.                                  -> the table test
//   · Past chips stay where they are, faded, with a small "Past" mark, and can still be selected. A selected past
//     service shows ONE line, "This service has passed"; the team cards are not restyled. -> the point-of-use tests
//   · The strip opens on the next service that is not past. That choice is made ONCE, from the moment services first
//     arrive, so the 60-second refresh can never move the service a steward is assigning to (doAssign writes to
//     whatever svcId is at the moment of the tap).                                    -> the refresh test
//   · The ENGINE's own rule (_svcHasHappened, used by removeTeam) is NOT this rule and must stay as it is: it counts a
//     service as happened from its start MINUTE, so a team removed mid-service keeps that service's rota as a record
//     and nobody serving is told they are not needed.                                 -> the divergence guard
//
// HOW THIS FILE ASSERTS (CLAUDE.md rules 1 and 3). The screen tests mount the REAL DashRota, compiled from
// app/stew-schedule.jsx by scripts/rota-board-harness.mjs, and read the tree it draws. schSvcPast is the real
// helper out of that same compiled file. _svcHasHappened is lifted out of the SHIPPED bundle (vendor/steward.js) with
// fnBody and run. Nothing here matches text in app/*.jsx.
//
// The scroll ("the strip opens scrolled to the next service") cannot be seen here — these harnesses attach no refs
// to elements — so it is measured in Chromium at 360px by scripts/the-rota-strip-opens-on-the-next-service.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { find, reads } from './render-jsx-screen.mjs';
import { loadSchedule, mountBoard } from './rota-board-harness.mjs';
import { fnBody } from './test-slice.mjs';

// A clock the board reads instead of the real one. `new Date()` with no arguments answers the fixed moment; with
// arguments it is an ordinary Date, so schSvcPast's `new Date(y, m, d, hh, mm)` is untouched. Local time, as the
// console reads it ('YYYY-MM-DDTHH:MM' with no zone parses as local).
function clockAt(iso) {
  let now = new Date(iso).getTime();
  class FixedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  return { Date: FixedDate, set(next) { now = new Date(next).getTime(); } };
}

const svc = (id, date, time, name = 'Sunday Gathering') => ({ id, date, time, name });
const ROTAS = (ids) => ids.map(id => ({ id, service: id, published: true, assign: {} }));

// Every service chip on the strip, in strip order. A chip is a button carrying data-svc-id; if none are found the
// caller's own assertions fail rather than pass over an empty list (re-anchor below).
const chipsOf = (tree) => find(tree, n => n.type === 'button' && n.props && n.props['data-svc-id'] !== undefined);
const chip = (tree, id) => {
  const c = chipsOf(tree).find(n => n.props['data-svc-id'] === id);
  assert.ok(c, `no chip for service ${id} on the strip — re-anchor this test (chips: ${chipsOf(tree).map(n => n.props['data-svc-id']).join(', ') || 'none'})`);
  return c;
};
// The lowest opacity anywhere inside a chip (1 when nothing is faded).
const fade = (node) => Math.min(1, ...find(node, n => n.props && n.props.style && n.props.style.opacity !== undefined).map(n => Number(n.props.style.opacity)));
const selected = (tree) => chipsOf(tree).filter(n => n.props['aria-pressed'] === true).map(n => n.props['data-svc-id']);
const PASSED_NOTE = 'This service has passed';

function board(clock, services, extra = {}) {
  return mountBoard({ services, rotas: ROTAS(services.map(s => s.id)), scope: { Date: clock.Date }, ...extra });
}

test('past services are faded in place with a "Past" mark; the strip keeps its order and opens on the next service', () => {
  const clock = clockAt('2026-11-13T12:00');
  const services = [svc('nov1', '2026-11-01', '10:30'), svc('nov8', '2026-11-08', '10:30'), svc('nov15', '2026-11-15', '10:30')];
  const b = board(clock, services);
  const tree = b.draw();
  const chips = chipsOf(tree);
  assert.equal(chips.length, 3, 'expected 3 service chips on the strip — re-anchor this test');

  // nothing moved: the strip is in date order, the same order it has with no clock involved at all
  assert.deepEqual(chips.map(n => n.props['data-svc-id']), ['nov1', 'nov8', 'nov15']);

  for (const id of ['nov1', 'nov8']) {
    const c = chip(tree, id);
    assert.match(reads(c), /\bPast\b/, `${id} has passed but its chip carries no "Past" mark`);
    assert.ok(fade(c) < 1, `${id} has passed but its chip is not faded (lowest opacity ${fade(c)})`);
  }
  const next = chip(tree, 'nov15');
  assert.doesNotMatch(reads(next), /\bPast\b/, 'the upcoming service is marked "Past"');
  assert.equal(fade(next), 1, 'the upcoming service is faded');

  // with nothing tapped, the board opens on the next service that is not past, and says nothing about passing
  assert.deepEqual(selected(tree), ['nov15'], 'the strip did not open on the next service');
  assert.ok(!reads(tree).includes(PASSED_NOTE), 'an upcoming service is described as passed');
});

test('a past chip can still be tapped: it is selected, its rota shows, and ONE line says it has passed', async () => {
  const clock = clockAt('2026-11-13T12:00');
  const services = [svc('nov1', '2026-11-01', '10:30'), svc('nov15', '2026-11-15', '10:30')];
  const rotas = [
    { id: 'nov1', service: 'nov1', published: true, assign: { 't1::r1': { id: 'p1', name: 'Ruth Bexley', pub: 'aa'.repeat(32) } } },
    { id: 'nov15', service: 'nov15', published: true, assign: {} },
  ];
  const b = mountBoard({ services, rotas, scope: { Date: clock.Date } });
  assert.match(b.text(), /0\/1/, 'the board did not open on the empty upcoming rota');

  const past = chip(b.draw(), 'nov1');
  past.props.onClick();
  const tree = b.draw();
  assert.deepEqual(selected(tree), ['nov1'], 'tapping a past chip did not select it');
  assert.match(reads(tree), /1\/1/, 'the past service\'s own rota (Ruth on Greeter) is not what the board shows');
  assert.ok(reads(tree).includes('Ruth Bexley'), 'the person on the past rota is not shown');
  const notes = find(tree, n => n.type === 'div' && (n.kids || []).some(k => typeof k === 'string' && k.includes(PASSED_NOTE)));
  assert.equal(notes.length, 1, `expected exactly one "${PASSED_NOTE}" line, found ${notes.length}`);
  // still faded while selected, but less so (the selected border must stay easy to see)
  const c = chip(tree, 'nov1');
  assert.ok(fade(c) < 1 && fade(c) > 0.5, `a selected past chip should be faded less than an unselected one (opacity ${fade(c)})`);
});

test('on the day: a 10:30 service is not past at 12:29, is past at 12:30, and the board still opens on it at 11:00', () => {
  const services = [svc('today', '2026-11-15', '10:30'), svc('next', '2026-11-22', '10:30')];
  for (const [at, isPast] of [['2026-11-15T11:00', false], ['2026-11-15T12:29', false], ['2026-11-15T12:30', true]]) {
    const clock = clockAt(at);
    const tree = board(clock, services).draw();
    assert.equal(/\bPast\b/.test(reads(chip(tree, 'today'))), isPast, `at ${at} the 10:30 chip should ${isPast ? '' : 'not '}be Past`);
    assert.deepEqual(selected(tree), [isPast ? 'next' : 'today'], `at ${at} the board opened on the wrong service`);
  }
});

test('the 60-second refresh fades a chip in place but never moves the service the steward is on', () => {
  const clock = clockAt('2026-11-15T12:00');
  const services = [svc('today', '2026-11-15', '10:30'), svc('next', '2026-11-22', '10:30')];
  const timers = [], listeners = [];
  const win = {
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval() {},
    addEventListener: (ev, fn) => listeners.push({ ev, fn }),
    removeEventListener() {},
  };
  const b = board(clock, services, { effects: true, win });
  let tree = b.draw();
  // the effect registered its refresh (a harness swallowing an effect error would otherwise look like "no change")
  assert.equal(timers.length, 1, 'the board registered no refresh timer');
  assert.equal(timers[0].ms, 60000, 'the refresh is not once a minute');
  assert.deepEqual(listeners.map(l => l.ev).sort(), ['focus', 'visibilitychange'], 'the board does not refresh when the window comes back');
  assert.doesNotMatch(reads(chip(tree, 'today')), /\bPast\b/);
  assert.deepEqual(selected(tree), ['today']);

  // 12:31: the minute tick fires
  clock.set('2026-11-15T12:31');
  timers[0].fn();
  tree = b.draw();
  assert.match(reads(chip(tree, 'today')), /\bPast\b/, 'the minute tick did not fade the chip that just passed');
  // …but the steward is still on the service they were working on: the strip did not jump to next week
  assert.deepEqual(selected(tree), ['today'], 'the refresh moved the selected service under the steward');
  assert.ok(reads(tree).includes(PASSED_NOTE), 'the service on screen has passed but says nothing');

  // a phone woken from sleep: the visibility listener redraws too
  clock.set('2026-11-22T12:31');
  listeners.find(l => l.ev === 'visibilitychange').fn();
  tree = b.draw();
  assert.match(reads(chip(tree, 'next')), /\bPast\b/, 'coming back to the page did not refresh the chips');

  // a board opened afresh at 12:31 on the 15th opens on next week
  const fresh = board(clockAt('2026-11-15T12:31'), services).draw();
  assert.deepEqual(selected(fresh), ['next']);
});

test('without window.setInterval / addEventListener (the miniReact harnesses) the board starts no timer and does not throw', () => {
  const clock = clockAt('2026-11-13T12:00');
  const b = board(clock, [svc('a', '2026-11-01', '10:30')], { effects: true });
  assert.doesNotThrow(() => b.draw());
  assert.equal(chipsOf(b.draw()).length, 1);
});

// ── THE SCREEN RULE, AS A TABLE ─────────────────────────────────────────────────────────────────────────────────
const { mod: { schSvcPast } } = loadSchedule({}, {}, ['DashRota', 'schSvcPast']);
const at = (iso) => new Date(iso);

test('schSvcPast: start + 2 hours, as timestamps; untimed is past from the midnight that ends its day', () => {
  assert.equal(typeof schSvcPast, 'function', 'schSvcPast is not in app/stew-schedule.jsx — re-anchor this test');
  const rows = [
    // service                                      now                       past?
    [svc('a', '2026-11-15', '10:30'),               '2026-11-15T12:29',       false],
    [svc('a', '2026-11-15', '10:30'),               '2026-11-15T12:30',       true],
    [svc('a', '2026-11-15', '10:30'),               '2026-11-15T10:29',       false],
    [svc('a', '2026-11-15', '10:30'),               '2026-11-15T11:30',       false],   // underway
    [svc('b', '2026-11-13', '23:00'),               '2026-11-14T00:30',       false],   // NOT at midnight
    [svc('b', '2026-11-13', '23:00'),               '2026-11-14T00:59',       false],
    [svc('b', '2026-11-13', '23:00'),               '2026-11-14T01:00',       true],
    [svc('c', '2026-11-13', ''),                    '2026-11-13T23:59',       false],   // no time
    [svc('c', '2026-11-13', ''),                    '2026-11-14T00:00',       true],
    [{ id: 'd', date: '2026-11-13' },               '2026-11-14T00:00',       true],    // no time field at all
    [svc('e', '2026-11-13', '7pm'),                 '2026-11-13T23:00',       false],   // unreadable: as untimed
    [svc('e', '2026-11-13', '7pm'),                 '2026-11-14T00:00',       true],
    [svc('f', '2026-11-13', '7:05'),                '2026-11-13T09:04',       false],   // one-digit hour is valid
    [svc('f', '2026-11-13', '7:05'),                '2026-11-13T09:05',       true],
    [svc('g', '2026-11-20', '10:30'),               '2026-11-13T12:00',       false],   // a later date
    [svc('h', '2026-11-01', '10:30'),               '2026-11-13T12:00',       true],    // an earlier date
    [{ id: 'i', time: '10:30' },                    '2026-11-13T12:00',       false],   // no date: never guessed at
  ];
  const wrong = rows.filter(([s, now, want]) => schSvcPast(s, at(now)) !== want)
    .map(([s, now, want]) => `${s.date || '(no date)'} ${JSON.stringify(s.time)} at ${now}: expected ${want}`);
  assert.deepEqual(wrong, []);
  // a clock that cannot be read shows nothing as past (this is a chip's colour, so it fails toward "not past")
  assert.equal(schSvcPast(svc('h', '2026-11-01', '10:30'), new Date('nonsense')), false);
  assert.equal(schSvcPast(svc('h', '2026-11-01', '10:30'), null), false);
});

// ── THE TWO RULES DIFFER ON PURPOSE ─────────────────────────────────────────────────────────────────────────────
// removeTeam must keep a service's rota from its start minute (the people on it are serving, not waiting to be stood
// down); the screen waits two hours before fading the chip. Anyone "unifying" the two, in either direction, turns
// one of these red.
test('one hour into a service the ENGINE says it has happened while the SCREEN says it is not past', () => {
  const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const anchor = 'function _svcHasHappened(sv, today, nowHM)';
  const i = BUNDLE.indexOf(anchor);
  assert.notEqual(i, -1, '_svcHasHappened is missing from vendor/steward.js — re-anchor this test');
  assert.equal(BUNDLE.indexOf(anchor, i + 1), -1, '_svcHasHappened appears twice in vendor/steward.js');
  const _svcHasHappened = new Function(fnBody(BUNDLE, i, anchor) + '\nreturn _svcHasHappened;')();

  const s = svc('a', '2026-11-15', '10:30');
  assert.equal(_svcHasHappened(s, '2026-11-15', '11:30'), true, 'the engine no longer counts a service as happened once it has begun');
  assert.equal(schSvcPast(s, at('2026-11-15T11:30')), false, 'the screen fades a service that is still within its two hours');
  // and at the start minute itself, the engine's own documented rule
  assert.equal(_svcHasHappened(s, '2026-11-15', '10:30'), true);
  assert.equal(schSvcPast(s, at('2026-11-15T10:30')), false);
});
