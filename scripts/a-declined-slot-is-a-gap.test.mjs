// A SLOT WHOSE PERSON SAID NO IS A GAP — ON EVERY SCREEN THAT COUNTS COVER.
//   Run: node --test scripts/a-declined-slot-is-a-gap.test.mjs
//
// Sim round 2026-10-02 (Ruth, twice; ruth-rota7.png): Dan chose "Can't make it" for Sun 18 Oct, the slot read
// "Welcomer · Declined" with his name struck through — and the header above it said "1/1 roles filled · Fully
// covered" in green, the Welcome card "1/1 filled". A warden glancing at the page thinks the Sunday is covered.
// Coverage counted ANY assigned name; the slot's own label was the only thing that read the reply.
//
// The independent check (verify-six) found a second defect in the rule the fix leans on: slotVerdict matched every
// request for the slot when the assignee had no app key, so an OFF-APP replacement (the organist, typed in by
// name) inherited the previous person's "Declined".
//
// The REAL DashRota and DashCalendar, compiled from app/stew-schedule.jsx and rendered (rule 3: nothing here
// matches text in the jsx), with the requests and replies hooks stubbed — those are what the rule reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

const D = 'd'.repeat(64), G = 'e'.repeat(64);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const SVC_DATE = ymd(new Date(Date.now() + 2 * 86400000));   // an upcoming service, so both screens list it
const TEAM = { id: 't1', kind: 'team', name: 'Welcome', accent: 'var(--clay)' };
const ROSTER = { team: 't1', roles: [{ id: 'r1', name: 'Welcomer' }], people: [{ id: 'p1', name: 'Dan Price', pub: D }, { id: 'p2', name: 'The Organist', pub: '' }, { id: 'p3', name: 'Grace Hall', pub: G }], pods: [] };
const SERVICE = { id: 'svc1', date: SVC_DATE, time: '10:30', name: 'Sunday Gathering' };
const REQ = { id: 'q1', serviceId: 'svc1', teamId: 't1', roleId: 'r1', memberPub: D, ts: 1 };

function screens({ assign, reply, blocked = [], req = REQ }) {
  const { React, draw } = miniReact();
  const hooks = {
    useStewardGroups: () => [TEAM], useStewardRosters: () => [ROSTER], useStewardServices: () => [SERVICE],
    useStewardRotas: () => [{ service: 'svc1', published: true, assign }],
    useStewardRequests: () => [req], useStewardRequestReplies: () => (reply ? [{ id: 'q1', v: reply }] : []),
    useStewardBlocked: () => blocked, useStewardUnavail: () => ({}), useStewardRsvps: () => ({}),
    useStewardMembers: () => [], useStewardEvents: () => [], useStewardBookings: () => [], useStewardRooms: () => [],
    useStewardRunsheets: () => [], useStewardRotaSettings: () => ({ visibility: 'church' }),
    useMealsSettings: () => ({ adminGroupId: '' }),
    Steward: {}, StewardMeals: {},
  };
  const win = new Proxy(hooks, { get: (t, k) => (k in t) ? t[k] : (typeof k === 'string' && k.startsWith('useSteward') ? () => [] : undefined), has: () => true });
  const { DashRota, DashCalendar } = loadScreen('app/stew-schedule.jsx', ['DashRota', 'DashCalendar'], {
    React, window: win, Icon: () => null, useStewDialog: () => ({ current: null }), todayISO: () => ymd(new Date()),
    document: { addEventListener() {}, removeEventListener() {} },
  });
  return { rota: () => draw(DashRota, { onNewTeam() {} }), calendar: () => draw(DashCalendar, {}) };
}
const slotLabel = (tree) => {
  const b = find(tree, n => n && n.type === 'button' && /Change who’s on this slot$/.test(String((n.props || {})['aria-label'] || '')));
  assert.equal(b.length, 1, 're-anchor: expected exactly one filled slot on the board');
  return b[0].props['aria-label'];
};

test('a DECLINED slot is a gap: the header, the team card and the Calendar all say so', () => {
  const s = screens({ assign: { 't1::r1': { name: 'Dan Price', pub: D } }, reply: 'decline' });
  const r = reads(s.rota());
  assert.match(slotLabel(s.rota()), /Declined/, 'CONTROL: the slot itself no longer says Declined');
  assert.match(r, /0\/1 roles filled/, 'the header still counts the declined slot as filled: ' + r.slice(0, 200));
  assert.match(r, /1 gap to fill/, 'the header does not call the declined slot a gap');
  assert.doesNotMatch(r, /Fully covered/, 'the header still says "Fully covered" over a slot nobody is coming to');
  assert.match(r, /0\/1 filled/, 'the team card still reads 1/1 filled');
  assert.match(reads(s.calendar()), /0\/1 filled/, 'the Calendar’s upcoming services still count the declined slot as filled');
});

test('a slot whose person asked to SWAP is a gap until somebody else is on it', () => {
  const s = screens({ assign: { 't1::r1': { name: 'Dan Price', pub: D } }, reply: 'swap' });
  assert.match(reads(s.rota()), /1 gap to fill/, 'a "wants swap" slot counts as covered');
});

test('CONTROL: an accepted slot, and one only ASKED, still count as filled', () => {
  for (const reply of ['accept', null]) {
    const s = screens({ assign: { 't1::r1': { name: 'Dan Price', pub: D } }, reply });
    const r = reads(s.rota());
    assert.match(r, /1\/1 roles filled/, (reply || 'asked') + ': no longer counted as filled');
    assert.match(r, /Fully covered/, (reply || 'asked') + ': no longer "Fully covered"');
    assert.match(reads(s.calendar()), /1\/1 filled/, (reply || 'asked') + ': the Calendar no longer counts it');
  }
});

test('an OFF-APP replacement does not inherit the previous person’s "Declined"', () => {
  const s = screens({ assign: { 't1::r1': { name: 'The Organist', pub: '' } }, reply: 'decline' });
  assert.doesNotMatch(slotLabel(s.rota()), /Declined/, 'the organist, who was never asked, shows Dan’s "Declined"');
  assert.match(reads(s.rota()), /1\/1 roles filled/, 'the off-app replacement is not counted as cover');
  // …and not even from a request that names NOBODY (an older request with no memberPub matches anyone)
  const legacy = screens({ assign: { 't1::r1': { name: 'The Organist', pub: '' } }, reply: 'decline', req: { ...REQ, memberPub: '' } });
  assert.doesNotMatch(slotLabel(legacy.rota()), /Declined/, 'the organist inherits a "Declined" from a request that names nobody');
});

test('a slot held by someone the church BLOCKED says so and is a gap', () => {
  const s = screens({ assign: { 't1::r1': { name: 'Grace Hall', pub: G } }, reply: null, blocked: [G] });
  assert.match(slotLabel(s.rota()), /Blocked/, 'the slot does not say its person is blocked');
  assert.match(reads(s.rota()), /1 gap to fill/, 'a blocked person’s slot is counted as covered');
  assert.match(reads(s.calendar()), /0\/1 filled/, 'the Calendar counts a blocked person’s slot as covered');
});
