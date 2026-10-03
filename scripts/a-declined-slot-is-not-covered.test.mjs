// A NAME IN A SLOT IS NOT COVER IF THAT PERSON SAID NO.
// Run: node --test scripts/a-declined-slot-is-not-covered.test.mjs
//
// Sim 2026-10-02, item 26 (Ruth, steward): the rota board read "1/1 roles filled - Fully covered" over a
// struck-through "Declined" name. Both coverage counts — the rota board's headline and its per-team card, and
// the Calendar's per-service chip — counted a slot as filled the moment a name sat in it. A steward glancing at
// "Fully covered" does not go looking for the one person who is not coming.
//
// These tests MOUNT the shipped DashRota (app/stew-schedule.jsx, esbuild-compiled) and read what is on the
// board. Nothing here matches text in app/*.jsx (CLAUDE.md rule 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountBoard, loadSchedule, PUB_A, PUB_B, SERVICE } from './rota-board-harness.mjs';
import { reads, find, texts } from './render-jsx-screen.mjs';

const REQ = { id: 'req1', serviceId: 'svc1', teamId: 't1', roleId: 'r1', memberPub: PUB_A, ts: 100 };
const said = (v, id = 'req1') => ({ id, v, by: PUB_A, ts: 200 });

test('CONTROL: a person who has not answered, or said yes, counts as cover', () => {
  for (const replies of [[], [said('accept')]]) {
    const out = mountBoard({ requests: [REQ], replies }).text();
    assert.match(out, /1\/1 roles filled/, 'the fixture is wrong: a placed person is not counted, so the decline assertions below prove nothing');
    assert.match(out, /Fully covered/);
  }
});

test('a person who DECLINED does not count as cover: 0/1, a gap to fill, and never "Fully covered"', () => {
  const out = mountBoard({ requests: [REQ], replies: [said('decline')] }).text();
  assert.match(out, /0\/1 roles filled/, 'a declined slot was counted as filled');
  assert.match(out, /1 gap to fill/, 'the declined slot is not offered to the steward as a gap');
  assert.doesNotMatch(out, /Fully covered/, 'THE DEFECT: "Fully covered" over a person who said they cannot come');
  // the team card says the same thing as the headline — one rule, two readers
  assert.match(out, /0\/1 filled/, 'the Welcome team card still counts the declined person as filled');
});

test('a "wants swap" person still holds the slot until someone is confirmed in their place', () => {
  // The brief names DECLINED only. A swap ask is not a refusal: they are on the rota until a replacement is confirmed.
  const out = mountBoard({ requests: [REQ], replies: [said('swap')] }).text();
  assert.match(out, /1\/1 roles filled/);
});

test('only the NEWEST request for the slot decides, so re-asking someone who declined once is not held against them', () => {
  const older = { ...REQ, id: 'req0', ts: 50 };
  const out = mountBoard({ requests: [older, REQ], replies: [said('decline', 'req0')] }).text();
  assert.match(out, /1\/1 roles filled/, 'an answer to an OLDER request still counted against the slot');
});

test('a decline from a different person for the same slot does not empty it', () => {
  const other = { ...REQ, id: 'reqB', memberPub: PUB_B, ts: 300 };
  const out = mountBoard({ requests: [REQ, other], replies: [said('decline', 'reqB')] }).text();
  assert.match(out, /1\/1 roles filled/, 'a request sent to someone else counted against the person now on the slot');
});

// THE CALENDAR'S CHIP. DashCalendar prints `<filled>/<total> filled` for each service on its day, from its own
// copy of the count. It is rendered here by lifting the component out of the same compiled file.
test('the Calendar tab counts a declined slot as unfilled too', () => {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const svc = { ...SERVICE, date: iso };
  const mount = (replies) => {
    const sch = loadSchedule({}, {
      useStewardGroups: () => [{ id: 't1', kind: 'team', name: 'Welcome' }],
      useStewardRosters: () => [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [] }],
      useStewardServices: () => [svc],
      useStewardRotas: () => [{ service: 'svc1', published: true, assign: { 't1::r1': { name: 'Ruth Bexley', pub: PUB_A } } }],
      useStewardRequests: () => [REQ], useStewardRequestReplies: () => replies,
      useStewardEvents: () => [], useStewardRsvps: () => ({}), useStewardMembers: () => [],
      expandEvents: (e) => e,
    }, ['DashCalendar']);
    sch.reset();
    return reads(sch.mod.DashCalendar({}));
  };
  const open = mount([said('accept')]);
  assert.match(open, /1\/1/, 'the calendar fixture shows no coverage chip, so the decline assertion would prove nothing');
  const declined = mount([said('decline')]);
  assert.match(declined, /0\/1/, 'the calendar still reports a declined slot as filled');
  assert.doesNotMatch(declined, /1\/1/);
});
