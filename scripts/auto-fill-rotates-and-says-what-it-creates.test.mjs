// AUTO-FILL ROTATES THE ROSTER, AND ITS MENU SAYS WHETHER IT CREATES ANYTHING.
// Run: node --test scripts/auto-fill-rotates-and-says-what-it-creates.test.mjs
//
// Sim 2026-10-02, item 33, two halves of one complaint:
//   1. fillAssign took `avail[0]` — the first person on the roster — for every empty slot, in every service. A
//      quarter of weekly services gave that person a slot every single week and left the rest of the roster idle.
//   2. "Create + fill this month/quarter" cloned whichever service was on screen into a weekly series, saying
//      only "weekly" inside a confirm box. A one-off (a Christmas service) became a quarter of weekly services.
//
// MOUNTS the shipped DashRota and presses the real menu entries (CLAUDE.md rules 1 and 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountBoard, PUB_A, PUB_B, PUB_C } from './rota-board-harness.mjs';

const PEOPLE = [{ id: 'p1', name: 'Ruth', pub: PUB_A }, { id: 'p2', name: 'Sam', pub: PUB_B }, { id: 'p3', name: 'Tim', pub: PUB_C }];
const ROSTERS = [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: PEOPLE, pods: [] }];
const svc = (id, date) => ({ id, date, time: '10:30', name: 'Sunday Gathering' });
const FOUR_WEEKS = [svc('s1', '2099-01-04'), svc('s2', '2099-01-11'), svc('s3', '2099-01-18'), svc('s4', '2099-01-25'), svc('s9', '2099-03-01')];

const settle = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setImmediate(r)); };
const who = (call) => (call.assign['t1::r1'] || {}).name;

function board(over = {}) {
  const confirms = [];
  const m = mountBoard({ rosters: ROSTERS, rotas: [], services: FOUR_WEEKS, confirm: (msg) => { confirms.push(msg); return over.confirmAnswer !== false; }, ...over });
  return { m, confirms };
}
async function chooseFill(m, label) { await m.press('Auto-fill'); await m.press(label); }

test('CONTROL: the menu opens and offers the fill entries', async () => {
  const { m } = board();
  await m.press('Auto-fill');
  assert.ok(m.has('This service only'), 'the Auto-fill menu is not on screen — the fixture proves nothing');
});

test('a bulk fill ROTATES: three people over four weeks is Ruth, Sam, Tim, Ruth — not Ruth four times', async () => {
  const { m } = board();
  await chooseFill(m, 'Fill existing services — this month');
  await settle(() => m.calls.publishRota.length >= 4);
  const order = m.calls.publishRota.slice().sort((a, b) => a.service.localeCompare(b.service)).map(who);
  assert.deepEqual(order, ['Ruth', 'Sam', 'Tim', 'Ruth'],
    'THE DEFECT: avail[0] every time. Got ' + JSON.stringify(order));
});

test('a single-service fill goes to whoever holds the FEWEST slots, not the first listed', async () => {
  // Ruth already holds the next two weeks. Filling the first week should not give her a third.
  const rotas = [
    { id: 's2', service: 's2', published: true, assign: { 't1::r1': { name: 'Ruth', pub: PUB_A } } },
    { id: 's3', service: 's3', published: true, assign: { 't1::r1': { name: 'Ruth', pub: PUB_A } } },
  ];
  const { m } = board({ rotas });
  await chooseFill(m, 'This service only');
  await m.press('Publish');
  await settle(() => m.calls.publishRota.length >= 1);
  const first = m.calls.publishRota.find(c => c.service === 's1');
  assert.ok(first, 'the first service was not published — the fixture is wrong');
  assert.equal(who(first), 'Sam', 'Ruth (two slots already) was handed a third while Sam and Tim hold none');
});

test('EVEN LEVEL, the roster order still decides: the first person listed goes first', async () => {
  const { m } = board();
  await chooseFill(m, 'This service only');
  await m.press('Publish');
  await settle(() => m.calls.publishRota.length >= 1);
  assert.equal(who(m.calls.publishRota.find(c => c.service === 's1')), 'Ruth');
});

test('"Fill existing services" creates NOTHING, and fills only the services already on the calendar in the window', async () => {
  const { m } = board();
  await chooseFill(m, 'Fill existing services — this month');
  await settle(() => m.calls.publishRota.length >= 4);
  assert.deepEqual(m.calls.publishService, [], 'a "fill existing" run created services');
  assert.deepEqual(m.calls.publishRota.map(c => c.service).sort(), ['s1', 's2', 's3', 's4'],
    'it filled the wrong set — the 1 March service is outside "this month" and must be left alone');
});

test('"Add weekly copies" creates the missing weekly services from the one on screen, and its confirm NAMES that service', async () => {
  const { m, confirms } = board({ services: [svc('s1', '2099-01-04')] });
  await chooseFill(m, 'Add weekly copies — this month');
  await settle(() => m.calls.publishService.length >= 4);
  assert.equal(m.calls.publishService.length, 4, 'five weekly dates less the one that already exists is four new services');
  assert.ok(m.calls.publishService.every(s => s.name === 'Sunday Gathering' && s.time === '10:30'));
  assert.match(confirms.join('\n'), /“Sunday Gathering”/, 'the confirm does not name the service it is about to copy');
  assert.match(confirms.join('\n'), /EVERY WEEK/, 'the confirm does not say it repeats weekly');
});

test('the menu says which entries create things and which do not', async () => {
  const { m } = board();
  await m.press('Auto-fill');
  const out = m.text();
  assert.match(out, /Creates nothing/, 'no entry says it creates nothing');
  assert.match(out, /Add weekly copies/, 'the creating entries are not labelled as copies');
  assert.match(out, /Repeats “Sunday Gathering” every week/, 'the creating entry does not name the service it repeats');
  assert.doesNotMatch(out, /Create \+ fill/, 'the old, ambiguous labels are back');
});

test('declining the confirm does nothing at all', async () => {
  const { m } = board({ confirmAnswer: false });
  await chooseFill(m, 'Add weekly copies — this month');
  await new Promise(r => setImmediate(r));
  assert.deepEqual([m.calls.publishService.length, m.calls.publishRota.length], [0, 0]);
});
