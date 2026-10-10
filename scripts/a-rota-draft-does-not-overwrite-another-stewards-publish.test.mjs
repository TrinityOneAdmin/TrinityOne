// A ROTA DRAFT MUST NOT SILENTLY REPLACE A ROTA SOMEONE ELSE PUBLISHED.
// Run: node --test scripts/a-rota-draft-does-not-overwrite-another-stewards-publish.test.mjs
//
// A rota is ONE document per service and Publish replaces it whole (newest wins). The board copies the published
// rota into a working draft ONCE and kept it for the session, so a draft built before another steward (or this
// steward's other device) published silently erased their change when Publish, Confirm-swap, Rotate pods or
// Auto-fill ran. Same family as the roster guard (a-roster-save-notices-someone-elses-change.test.mjs).
//
// MOUNTS the shipped DashRota (esbuild-compiled app/stew-schedule.jsx, effects running) and presses its real
// buttons (CLAUDE.md rules 1 and 3). "Another steward publishes" is the console's rota subscription returning a
// newer copy (`ts` = the relay event's created_at, exactly what _subAddr hands the board).
//
// Users of the shared code changed (rule 2) are listed in the commit message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountBoard, PUB_A, PUB_B, PUB_C } from './rota-board-harness.mjs';
import { find, reads } from './render-jsx-screen.mjs';

const RUTH = { id: 'p1', name: 'Ruth Bexley', pub: PUB_A }, SAM = { id: 'p2', name: 'Sam Smith', pub: PUB_B }, TIM = { id: 'p3', name: 'Tim Tay', pub: PUB_C };
const ROLES = [{ id: 'r1', name: 'Greeter' }, { id: 'r2', name: 'Reader' }];
const ROSTERS = [{ team: 't1', roles: ROLES, people: [RUTH, SAM, TIM], pods: [
  { id: 'pa', name: 'Pod A', fills: { r1: 'p1', r2: 'p1' } }, { id: 'pb', name: 'Pod B', fills: { r1: 'p2', r2: 'p2' } }] }];
// far-future dates: the board opens on the next service from the REAL clock, so a fixed 2026 date rots into "past"
const SVC1 = { id: 'svc1', date: '2099-09-13', time: '10:30', name: 'Sunday Gathering' };
const SVC2 = { id: 'svc2', date: '2099-09-20', time: '10:30', name: 'Sunday Gathering' };
const rota = (service, ts, a) => ({ id: service, service, published: true, ts, assign: Object.fromEntries(Object.entries(a).map(([k, p]) => ['t1::' + k, { ...p }])) });
const V1 = () => [rota('svc1', 100, { r1: RUTH, r2: RUTH }), rota('svc2', 100, { r1: RUTH, r2: RUTH })];
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

const board = (over = {}) => mountBoard({ effects: true, rosters: ROSTERS, services: [SVC1, SVC2], rotas: V1(), ...over });
// the steward changes one slot through the real picker (AssignModal's own onAssign)
const edit = (m, roleName, person) => {
  const slot = find(m.draw(), n => n.type === 'button' && new RegExp('^' + roleName + ': ').test(n.props['aria-label'] || ''))[0];
  assert.ok(slot, 'no slot button for ' + roleName);
  slot.props.onClick();
  const picker = find(m.draw(), n => n.props && typeof n.props.onAssign === 'function')[0];
  assert.ok(picker, 'the picker did not open');
  picker.props.onAssign(person);
  m.draw();
};
const WARN = /Someone else published this rota/;
const publishedFor = (m, svc) => m.calls.publishRota.filter(r => r.service === svc);
const nameAt = (r, role) => r.assign['t1::' + role] && r.assign['t1::' + role].name;

test('CONTROL: nobody else has published — an edit publishes, and no warning is raised', async () => {
  const m = board();
  edit(m, 'Greeter', SAM);
  assert.doesNotMatch(m.text(), WARN, 'a warning with nobody else involved');
  await m.press('Publish changes'); await settle();
  assert.equal(publishedFor(m, 'svc1').length, 1, 'the control did not publish — the fixture proves nothing');
  assert.equal(nameAt(publishedFor(m, 'svc1')[0], 'r1'), 'Sam Smith');
});

test('(a) an UNEDITED draft follows a newer published rota, and Publish then sends THEIR version, not the stale one', async () => {
  const m = board();
  m.draw();
  m.deliver([rota('svc1', 200, { r1: SAM, r2: TIM }), rota('svc2', 100, { r1: RUTH, r2: RUTH })]);
  const out = m.text();
  assert.match(out, /Sam Smith/, 'THE DEFECT: the board still shows the rota it first loaded');
  assert.doesNotMatch(out, WARN, 'nothing of the steward is at stake, yet they were warned');
  await m.press('Published'); await settle();   // draft == published, so the button reads Published; pressing it re-sends the rota
  const sent = publishedFor(m, 'svc1');
  assert.equal(sent.length, 1);
  assert.equal(nameAt(sent[0], 'r1'), 'Sam Smith');
  assert.equal(nameAt(sent[0], 'r2'), 'Tim Tay', 'the other steward\'s Reader was replaced by the stale copy');
});

test('(a) a newer rota identical to the draft raises no warning (this console\'s own publish coming back)', async () => {
  const m = board();
  edit(m, 'Greeter', SAM);
  m.deliver([rota('svc1', 200, { r1: SAM, r2: RUTH }), rota('svc2', 100, { r1: RUTH, r2: RUTH })]);
  assert.doesNotMatch(m.text(), WARN, 'the steward\'s own publish arriving back was treated as someone else\'s');
  await m.press('Published'); await settle();
  assert.equal(publishedFor(m, 'svc1').length, 1);
});

test('(b) an EDITED draft meets a newer published rota: it says so, and Publish writes NOTHING', async () => {
  const m = board();
  edit(m, 'Greeter', SAM);                                                           // my edit
  m.deliver([rota('svc1', 200, { r1: RUTH, r2: TIM }), rota('svc2', 100, { r1: RUTH, r2: RUTH })]);   // their edit
  assert.match(m.text(), WARN, 'THE DEFECT: no warning that the rota moved on');
  assert.ok(m.has('Reload their version') && m.has('Publish mine anyway'), 'the steward is not offered the two choices');
  await m.press('Publish changes'); await settle();
  assert.deepEqual(m.calls.publishRota, [], 'a stale draft was published over the other steward\'s change');
  assert.deepEqual(m.calls.sendServingRequest, [], 'people were asked to serve on a rota that was not published');
  assert.match(m.text(), /Not published/, 'the refusal was silent');
});

test('(b) "Reload their version" takes theirs, drops my edit, and clears the warning', async () => {
  const m = board();
  edit(m, 'Greeter', SAM);
  m.deliver([rota('svc1', 200, { r1: RUTH, r2: TIM }), rota('svc2', 100, { r1: RUTH, r2: RUTH })]);
  await m.press('Reload their version');
  const out = m.text();
  assert.doesNotMatch(out, WARN);
  assert.match(out, /Tim Tay/, 'their Reader did not arrive');
  assert.doesNotMatch(out, /Sam Smith/, 'my edit survived the reload');
  assert.deepEqual(m.calls.publishRota, [], 'reloading published something');
});

test('(b) "Publish mine anyway" is the one control that writes over theirs, and it sends what the steward built', async () => {
  const m = board();
  edit(m, 'Greeter', SAM);
  m.deliver([rota('svc1', 200, { r1: RUTH, r2: TIM }), rota('svc2', 100, { r1: RUTH, r2: RUTH })]);
  await m.press('Publish mine anyway'); await settle();
  const sent = publishedFor(m, 'svc1');
  assert.equal(sent.length, 1);
  assert.equal(nameAt(sent[0], 'r1'), 'Sam Smith');
  assert.doesNotMatch(m.text(), WARN, 'the warning stays after the steward chose');
});

test('(c) Rotate pods SKIPS the service someone else changed, publishes the rest, and says how many it skipped', async () => {
  const m = board();
  edit(m, 'Greeter', SAM);
  m.deliver([rota('svc1', 200, { r1: RUTH, r2: TIM }), rota('svc2', 100, { r1: RUTH, r2: RUTH })]);
  const sel = find(m.draw(), n => n.type === 'select' && /serving pod/.test(n.props.title || ''))[0];
  assert.ok(sel, 'no pod menu on the board');
  sel.props.onChange({ target: { value: '__rotate__' } }); await settle();
  assert.deepEqual(publishedFor(m, 'svc1'), [], 'THE DEFECT: rotating pods replaced the other steward\'s rota');
  assert.equal(publishedFor(m, 'svc2').length, 1, 'the untouched service was not rotated');
  assert.match(m.text(), /1 skipped/, 'the skip was silent');
});

test('(c) Auto-fill existing services SKIPS the service someone else changed, fills the rest, and says how many it skipped', async () => {
  const m = board();
  edit(m, 'Greeter', SAM);
  m.deliver([rota('svc1', 200, { r1: RUTH, r2: TIM }), rota('svc2', 100, { r1: RUTH, r2: RUTH })]);
  await m.press('Auto-fill');
  await m.press('Fill existing services'); await settle();
  assert.deepEqual(publishedFor(m, 'svc1'), [], 'THE DEFECT: auto-fill replaced the other steward\'s rota');
  assert.equal(publishedFor(m, 'svc2').length, 1, 'the untouched service was not filled');
  assert.match(m.text(), /1 skipped/, 'the skip was silent');
});

test('(c) Confirm-swap on a stale draft publishes nothing', async () => {
  const REQ = { id: 'req1', serviceId: 'svc1', teamId: 't1', roleId: 'r1', memberPub: PUB_A, ts: 100 };
  const replies = [{ id: 'req1', v: 'swap', swapTo: PUB_B, by: PUB_A, ts: 200 }, { id: 'swapans~req1', v: 'swapyes', by: PUB_B, ts: 300 }];
  const m = board({ requests: [REQ], replies });
  edit(m, 'Reader', TIM);
  m.deliver([rota('svc1', 200, { r1: RUTH, r2: SAM }), rota('svc2', 100, { r1: RUTH, r2: RUTH })]);
  await m.press('Confirm: Sam Smith covers'); await settle();
  assert.deepEqual(m.calls.publishRota, [], 'a swap was published over the other steward\'s change');
  assert.deepEqual(m.calls.sendServingRequest, []);
});
