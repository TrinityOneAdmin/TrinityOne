// RECONNECTING A MEMBER MOVES THEIR PLACE ON SERVING TEAMS, THE CARE TEAM AND THE ROTA. Sim item 21 (2026-10-02).
//   Run: node --test scripts/reconnect-moves-serving-teams-and-rota.test.mjs
//
// The defect: reseatMember moved the child marking, clearance, parent link and admission to the new key and touched
// nothing else. A team's roster names its people by PUBKEY (roster:<team>.people[].pub), so does every filled rota
// slot (rota:<service>.assign[...].pub), and the care team is a roster plus the `careteam:` document built from it.
// All kept the OLD key: the new phone's Serving tab said "not on a serving team" while the Rota tab still listed
// the person, under a key nobody held. This is a key SWAP, not a removal -- the person stays, with their name and
// their slot.
//
// HOW IT ASSERTS (the house method, as in reconnecting-a-member-keeps-removed-parents-removed.test.mjs): the dialog's
// own statements are sliced out of ReseatModal in app/stew-dashboard.jsx and RUN, so deleting the feature from the
// screen fails here; the SHIPPED reseatMember runs from vendor/steward.js; the only stubs are the church writes,
// which record what they were asked to publish. Nothing here matches the spelling of app/*.jsx (rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const OLD = 'a1'.repeat(32), NEW = 'a2'.repeat(32), OTHER = 'b1'.repeat(32), OTHER2 = 'b2'.repeat(32);

function sliceIn(src, anchor, what) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${what} is missing from ReseatModal — re-anchor this test`);
  assert.equal(src.indexOf(anchor, at + 1), -1, `${what} appears twice`);
  return stmt(src, anchor);
}
const MODAL = fnBody(DASH, 'function ReseatModal(', 'ReseatModal');
const DIALOG = [
  sliceIn(MODAL, 'const _gdCheckin = window.useStewardGuardians', 'the dialog reading the guardian document'),
  sliceIn(MODAL, 'const guardiansNow = ', 'guardiansNow'),
  sliceIn(MODAL, 'const guardiansClosedNow = ', 'guardiansClosedNow'),
  sliceIn(MODAL, 'const rostersNow = ', 'the dialog reading the team rosters'),
  sliceIn(MODAL, 'const rotasNow = ', 'the dialog reading the rotas'),
  sliceIn(MODAL, 'const careTeamIdNow = ', 'the dialog reading which team is the care team'),
  sliceIn(MODAL, 'const r = await window.Steward.reseatMember(member, newPub, {', "the dialog's reseatMember call"),
].join('\n');
const RESEAT = (() => { const a = '    async reseatMember(oldPub, newPub, o) {'; const at = STEWARD.indexOf(a); assert.notEqual(at, -1, 'reseatMember is missing from vendor/steward.js'); return fnBody(STEWARD, at, 'reseatMember'); })();

// What the console is looking at when the steward presses Reconnect.
const roster = (team, people, extra = {}) => ({ team, roles: [{ id: 'r1', name: 'Welcome' }], people, pods: [], ...extra });
const person = (id, name, pub) => ({ id, name, pub });

// Run the dialog's statements against the shipped engine. `refuse(kind, id)` -> true makes that write come back refused.
async function reconnect({ rosters = [], rotas = [], careTeamId = '', refuse = () => false } = {}) {
  const wrote = { rosters: [], rotas: [], careTeam: [] };
  const Steward = new Proxy({}, { get: (t, k) => k in t ? t[k] : (async () => true) });
  Steward.publishRoster = async (team, r) => { if (refuse('roster', team)) return null; wrote.rosters.push({ team, ...r }); return { id: team, ...r }; };
  Steward.publishRota = async (rota) => { if (refuse('rota', rota.service)) return null; wrote.rotas.push(rota); return { id: rota.service, ...rota }; };
  const StewardMeals = { publishCareTeam: async (pubs) => { if (refuse('careteam', '')) return false; wrote.careTeam.push(pubs); return { id: 'e' }; } };
  const engine = new Function('toPubHex', 'now', 'window', `return { ${RESEAT} };`)((p) => p, () => 1000, { Steward, StewardMeals });
  Steward.reseatMember = (...a) => engine.reseatMember(...a);
  const window = {
    Steward, StewardMeals,
    useStewardRosters: () => rosters, useStewardRotas: () => rotas,
    useMealsSettings: () => ({ adminGroupId: careTeamId }),
  };
  const result = await new Function('window', 'member', 'newPub', 'realName', 'reseats', 'admittedList', 'sgNow', 'blockedNow', 'taken',
    `return (async () => { ${DIALOG}\n return r; })();`)(window, OLD, NEW, '', [], [OLD], { minors: [], approved: [] }, [], false);
  return { wrote, result };
}

test('a team roster that listed the old key lists the new one, with the same person, name and roles', async () => {
  const { wrote, result } = await reconnect({ rosters: [roster('t1', [person('p1', 'Priya', OLD), person('p2', 'Dan', OTHER)])] });
  assert.equal(wrote.rosters.length, 1, 'the roster naming the old key was not republished');
  const w = wrote.rosters[0];
  assert.equal(w.team, 't1');
  assert.deepEqual(w.people, [person('p1', 'Priya', NEW), person('p2', 'Dan', OTHER)], 'the old key was not swapped in place (id and name must survive, and nobody else may change)');
  assert.deepEqual(w.roles, [{ id: 'r1', name: 'Welcome' }]);
  assert.equal(result.teamsMoved, 1);
  assert.deepEqual(result.failed, []);
});

test('a roster that does not name the old key is left alone', async () => {
  const { wrote } = await reconnect({ rosters: [roster('t1', [person('p2', 'Dan', OTHER)]), roster('t2', [person('p3', 'Off-app volunteer', '')])] });
  assert.deepEqual(wrote.rosters, [], 'an unrelated team was rewritten');
});

test('a document this console could not open is skipped, never rewritten from an empty guess', async () => {
  const locked = { team: 't9', _locked: true };           // what _subAddr hands over for a sealed document it has no key for
  const noPeople = { team: 't8', roles: [], pods: [] };    // no people array at all
  const { wrote } = await reconnect({ rosters: [locked, noPeople], rotas: [{ service: 's9', _locked: true }] });
  assert.deepEqual(wrote.rosters, []); assert.deepEqual(wrote.rotas, []);
});

test('every rota slot that named the old key names the new one; the name, the other slots and the published flag are untouched', async () => {
  const rotas = [
    { service: 's1', published: true, assign: { 't1::r1': { name: 'Priya', pub: OLD }, 't1::r2': { name: 'Dan', pub: OTHER }, 't2::r1': { name: 'Priya', pub: OLD } } },
    { service: 's2', published: false, assign: { 't1::r1': { name: 'Dan', pub: OTHER } } },
    { service: 's3', published: true, assign: { 't1::r1': { name: 'Priya', pub: OLD } } },
  ];
  const { wrote, result } = await reconnect({ rotas });
  assert.deepEqual(wrote.rotas.map(r => r.service).sort(), ['s1', 's3'], 'the rota that does not name them was rewritten, or one that does was missed');
  const s1 = wrote.rotas.find(r => r.service === 's1');
  assert.deepEqual(s1.assign, { 't1::r1': { name: 'Priya', pub: NEW }, 't1::r2': { name: 'Dan', pub: OTHER }, 't2::r1': { name: 'Priya', pub: NEW } });
  assert.equal(s1.published, true, 'a published rota was republished as a draft');
  assert.equal(result.rotasMoved, 2);
});

test('the care team: its roster moves AND careteam:<church> is republished with the new key (not the old)', async () => {
  const { wrote } = await reconnect({
    rosters: [roster('care', [person('p1', 'Priya', OLD), person('p2', 'Dan', OTHER), person('p3', 'Walk-in', '')]), roster('t1', [person('p4', 'Priya', OLD)])],
    careTeamId: 'care',
  });
  assert.equal(wrote.rosters.length, 2);
  assert.equal(wrote.careTeam.length, 1, 'the care team roster moved but careteam:<church> -- the list "ask for help" is sealed to -- was not republished');
  assert.deepEqual([...wrote.careTeam[0]].sort(), [NEW, OTHER].sort(), 'careteam: must name the new key, keep the others, and never the old key');
});

test('a team that is not the care team does not republish careteam:', async () => {
  const { wrote } = await reconnect({ rosters: [roster('t1', [person('p4', 'Priya', OLD)])], careTeamId: 'care' });
  assert.deepEqual(wrote.careTeam, []);
});

test('if the new key is ALREADY on the team the old row is dropped (never listed twice) and pods that used it point at the survivor', async () => {
  const pods = [{ id: 'pod1', name: 'Pod A', fills: { r1: 'p1', r2: 'p2' } }];
  const { wrote } = await reconnect({ rosters: [roster('t1', [person('p1', 'Priya (old)', OLD), person('p2', 'Dan', OTHER), person('p5', 'Priya', NEW)], { pods })] });
  const w = wrote.rosters[0];
  assert.deepEqual(w.people.map(p => p.id), ['p2', 'p5'], 'the person is listed twice, or the wrong row was kept');
  assert.deepEqual(w.pods[0].fills, { r1: 'p5', r2: 'p2' }, 'a pod slot was left pointing at a row that no longer exists');
});

test('a refused write is reported, not thrown, and does not stop the other teams or the rota', async () => {
  const { wrote, result } = await reconnect({
    rosters: [roster('t1', [person('p1', 'Priya', OLD)]), roster('t2', [person('p4', 'Priya', OLD)])],
    rotas: [{ service: 's1', published: true, assign: { 't1::r1': { name: 'Priya', pub: OLD } } }],
    refuse: (kind, id) => kind === 'roster' && id === 't1',
  });
  assert.ok(result.failed.includes('team:t1'), 'a refused roster write was not reported: ' + JSON.stringify(result.failed));
  assert.deepEqual(wrote.rosters.map(r => r.team), ['t2'], 'one refused team stopped the others');
  assert.equal(wrote.rotas.length, 1, 'one refused team stopped the rota');
  assert.equal(result.teamsMoved, 1);
});

test('with no teams or rotas on screen the reconnect still works and reports nothing moved', async () => {
  const { wrote, result } = await reconnect({});
  assert.deepEqual(wrote, { rosters: [], rotas: [], careTeam: [] });
  assert.equal(result.teamsMoved, 0); assert.equal(result.rotasMoved, 0);
});
