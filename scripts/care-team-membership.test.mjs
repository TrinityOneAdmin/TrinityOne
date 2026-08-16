// A CARE TEAM HAS TO BE THE SAME TEAM WHICHEVER DOOR THE STEWARD USED.
// Run: node --test scripts/care-team-membership.test.mjs
//
// THE DEFECT THIS GUARDS. A team carries two membership lists in two documents:
//
//   group:<id>.members   the invite-only chat allowlist — the "Invite · N" button on the Groups tab
//   roster:<id>.people   who is ON the team — it fills rota slots, and for the church's care team it is
//                        what the RELAY reads to grant careAdmin (gateway.mjs ROSTER_PEOPLE), and the only
//                        source for careteam:<cp>, the list a member's "ask for help" is sealed to
//
// St Brigid's, in the 2026-08-16 simulation, staffed its care team from the Groups tab. Measured against
// relay.sqlite afterwards: group members 2, roster people 0, and no careteam: document at all. The console
// showed "Invite · 2", the save succeeded, nothing was refused — and the care team was empty to every part
// of the product that acts on one. A vicar sets up a care team after a service, checks it saved, and when
// someone comes home from hospital there is nobody attached to help.
//
// The recorded diagnosis was "the fault is in whatever assembles the roster document". It is not: driving
// the real console headless against a real relay, the roster editor publishes `people` correctly every
// time. Nothing dropped them. The steward's work went into the other document.
//
// So both doors now write both facts, and the care panel counts only people the relay can recognise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const SCHEDULE = readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8');
const DASH     = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const MEALS    = readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8');

// The REAL reconcilers, lifted from the shipped source and executed. Not re-implemented here: a test that
// hand-writes the logic it claims to check is the mirror-test shape this repo has shipped twice.
function loadReconcilers(windowStub) {
  const src = [
    fnBody(SCHEDULE, 'function memDisplay('),
    fnBody(SCHEDULE, 'function teamPeopleForAllowlist('),
    fnBody(SCHEDULE, 'function teamAllowlistForPeople('),
    fnBody(SCHEDULE, 'function publishCareTeamFor('),
  ].join('\n');
  return new Function('window', src + '\n; return { teamPeopleForAllowlist, teamAllowlistForPeople, publishCareTeamFor };')(windowStub);
}

const MEMBERS = [
  { pubkey: 'aa'.repeat(32), name: 'Martha Nkemelu' },
  { pubkey: 'bb'.repeat(32), name: 'Esther Okonjo' },
  { pubkey: 'cc'.repeat(32), name: '' },
];
const PUB = { martha: 'aa'.repeat(32), esther: 'bb'.repeat(32), unnamed: 'cc'.repeat(32) };

test('an allowlist edit fills the roster it used to leave empty', () => {
  const { teamPeopleForAllowlist } = loadReconcilers({});
  const people = teamPeopleForAllowlist([], [PUB.martha, PUB.esther], MEMBERS);
  assert.equal(people.length, 2, 'ticking two people into an invite-only team must put two people on its roster');
  assert.deepEqual(people.map(p => p.pub).sort(), [PUB.martha, PUB.esther].sort());
  assert.deepEqual(people.map(p => p.name).sort(), ['Esther Okonjo', 'Martha Nkemelu'],
    'the roster must carry their names, not raw hex — this list is read by a human building a rota');
  assert.ok(people.every(p => p.id), 'every roster person needs an id: pods reference people BY id');
});

test('off-app volunteers survive an allowlist edit', () => {
  const { teamPeopleForAllowlist } = loadReconcilers({});
  const before = [{ id: 'p1', name: 'Mrs Hendry', pub: '' }, { id: 'p2', name: 'Martha Nkemelu', pub: PUB.martha }];
  const after = teamPeopleForAllowlist(before, [PUB.martha, PUB.esther], MEMBERS);
  assert.ok(after.some(p => p.name === 'Mrs Hendry' && !p.pub),
    'someone with no app account is in no allowlist, so an allowlist edit must never remove them');
  assert.equal(after.find(p => p.pub === PUB.martha).id, 'p2',
    'a person already on the team keeps their id — a fresh one silently empties every pod slot they fill');
});

test('taking someone off the allowlist takes them off the team', () => {
  const { teamPeopleForAllowlist } = loadReconcilers({});
  const before = [{ id: 'p2', name: 'Martha Nkemelu', pub: PUB.martha }, { id: 'p3', name: 'Esther Okonjo', pub: PUB.esther }];
  const after = teamPeopleForAllowlist(before, [PUB.martha], MEMBERS);
  assert.deepEqual(after.map(p => p.pub), [PUB.martha],
    'someone locked out of the room must not keep the care-team grant the relay reads from the roster');
});

test('the allowlist a roster implies is its LINKED people, and only those', () => {
  const { teamAllowlistForPeople } = loadReconcilers({});
  const people = [
    { id: 'p1', name: 'Mrs Hendry', pub: '' },
    { id: 'p2', name: 'Martha Nkemelu', pub: PUB.martha },
    { id: 'p4', name: 'Martha again', pub: PUB.martha },
  ];
  assert.deepEqual(teamAllowlistForPeople(people), [PUB.martha],
    'an off-app name has no key to admit, and a duplicate must not be admitted twice');
  assert.deepEqual(teamAllowlistForPeople([]), []);
});

test('careteam: is republished when the CARE team changes, and only then', async () => {
  const calls = [];
  const win = { StewardMeals: { publishCareTeam: (pubs) => { calls.push(pubs); return Promise.resolve(true); } } };
  const { publishCareTeamFor } = loadReconcilers(win);
  const people = [{ id: 'p1', name: 'Mrs Hendry', pub: '' }, { id: 'p2', name: 'Martha', pub: PUB.martha }];

  await publishCareTeamFor('grp-music', 'grp-care', people);
  assert.equal(calls.length, 0, 'editing the music team must not rewrite who the church seals care requests to');

  await publishCareTeamFor('grp-care', 'grp-care', people);
  assert.deepEqual(calls, [[PUB.martha]],
    'the care team changed, so the list a member’s "ask for help" is sealed to must change with it');

  await publishCareTeamFor('grp-care', '', people);
  assert.equal(calls.length, 1, 'with no care team configured there is nothing to republish');
});

test('careteam: republishing never takes the console down', async () => {
  const { publishCareTeamFor } = loadReconcilers({ StewardMeals: { publishCareTeam: () => { throw new Error('relay down'); } } });
  assert.equal(await publishCareTeamFor('g', 'g', []), null, 'a failed republish must not reject into the save path');
  const noModule = loadReconcilers({});
  assert.equal(await noModule.publishCareTeamFor('g', 'g', []), null, 'the care module is optional — absent is not an error');
});

// ── the two save paths must actually call the reconcilers ────────────────────────────────────────────────
// Comment-stripped, because prose describing a rule has satisfied a check that the rule was followed in this
// repo before (HANDOFF-2026-08-05 §4.3), and every comment below names the very functions being matched.

test('the Groups tab’s member editor writes the roster too', () => {
  const save = stripComments(fnBody(DASH, 'function EditGroupMembersModal(')).slice(
    stripComments(fnBody(DASH, 'function EditGroupMembersModal(')).indexOf('const save = '));
  assert.match(save, /teamPeopleForAllowlist\(/, 'ticking someone into an invite-only team must reach its roster');
  assert.match(save, /window\.Steward\.publishRoster\(/, 'the reconciled people must be published, not just computed');
  assert.match(save, /publishCareTeamFor\(/, 'and the care-request audience must follow the care team');
  assert.match(save, /rosters \|\| \[\]\)\.find/,
    'reconcile against the roster we have READ — publishing one we have not would wipe the team’s roles');
});

test('the roster editor keeps the invite allowlist in step', () => {
  const save = stripComments(fnBody(SCHEDULE, 'const save = async () => {'));
  assert.match(save, /publishRoster\(/, 'the roster is still the thing this editor saves');
  assert.match(save, /teamAllowlistForPeople\(/, 'a person put on an invite-only team must be able to open its room');
  assert.match(save, /publishGroup\(/, 'the allowlist has to be published, not just derived');
  assert.match(save, /publishCareTeamFor\(/, 'and the care-request audience must follow the care team');
  assert.match(save, /rotate: removed/,
    'removing someone from an encrypted room without rotating leaves their cached key opening every future message');
  assert.match(save, /visibility === 'invite'/,
    'an ordinary team has no allowlist — only invite-only teams have a second list to keep');
});

test('the care panel counts people the relay can actually recognise', () => {
  const panel = stripComments(fnBody(MEALS, 'function DashMealsPanel('));
  assert.match(panel, /teamLinked\s*=\s*teamPeople\.filter\(p => p && p\.pub\)/,
    'careAdmin and careteam: are keyed on pubkeys — a roster of off-app names is a care team of nobody');
  assert.doesNotMatch(panel, /teamPeople\.length === 0/,
    'the empty-team warning must not be satisfied by names that carry no key');
  assert.match(panel, /selectedTeam && teamLinked\.length === 0/,
    '"Stewards + care team" is the DEFAULT for who may open a need, so an empty care team must be reported in every visibility, not only "Only the care team"');
});
