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

test('ticking someone in puts them on the team', () => {
  const { teamPeopleForAllowlist } = loadReconcilers({});
  const people = teamPeopleForAllowlist([], [PUB.martha, PUB.esther], [], MEMBERS);
  assert.equal(people.length, 2);
  assert.deepEqual(people.map(p => p.name).sort(), ['Esther Okonjo', 'Martha Nkemelu'],
    'the roster must carry their names, not raw hex — a human builds a rota from this list');
  assert.ok(people.every(p => p.id), 'pods reference people BY id, so everyone needs one');
});

test('off-app volunteers survive an allowlist edit', () => {
  const { teamPeopleForAllowlist } = loadReconcilers({});
  const before = [{ id: 'p1', name: 'Mrs Hendry', pub: '' }, { id: 'p2', name: 'Martha Nkemelu', pub: PUB.martha }];
  const after = teamPeopleForAllowlist(before, [PUB.esther], [], MEMBERS);
  assert.ok(after.some(p => p.name === 'Mrs Hendry' && !p.pub),
    'someone with no app account is in no allowlist, so an allowlist edit must never remove them');
  assert.equal(after.find(p => p.pub === PUB.martha).id, 'p2',
    'a person already on the team keeps their id — a fresh one silently empties every pod slot they fill');

  // …and re-adding someone who is ALREADY there must not duplicate them or re-mint their id. This is the case
  // that actually exercises the dedupe: ticking a person who is on the roster already is the commonest edit.
  const again = teamPeopleForAllowlist(before, [PUB.martha], [], MEMBERS);
  assert.equal(again.filter(p => p.pub === PUB.martha).length, 1, 'nobody may appear on a team twice');
  assert.equal(again.find(p => p.pub === PUB.martha).id, 'p2', 'and their id must survive, or their pod slots empty');
  assert.equal(again.length, before.length, 'a no-op add changes nothing');
});

test('unticking someone takes them off the team', () => {
  const { teamPeopleForAllowlist } = loadReconcilers({});
  const before = [{ id: 'p2', name: 'Martha', pub: PUB.martha }, { id: 'p3', name: 'Esther', pub: PUB.esther }];
  const after = teamPeopleForAllowlist(before, [], [PUB.esther], MEMBERS);
  assert.deepEqual(after.map(p => p.pub), [PUB.martha],
    'someone locked out of the room must not keep the careAdmin grant the relay reads from the roster');
});

// ── THE TWO DEFECTS THE PRE-MERGE REVIEW FOUND. Both came from replacing one list with the other wholesale.

test('an unchanged dialog changes nothing — no silent mass promotion', () => {
  // roster:<id>.people is what the relay reads to grant careAdmin: a read grant over every care need and
  // every "ask for help" in the church. A wholesale reconcile meant that opening "Who's in <care team>" on a
  // church whose lists had drifted and pressing Save WITHOUT CHANGING ANYTHING promoted every member of that
  // chat room. That is the granting direction firing on exactly the population this work exists to repair.
  const { teamPeopleForAllowlist } = loadReconcilers({});
  const roster = [{ id: 'p1', name: 'Mrs Hendry', pub: '' }, { id: 'p2', name: 'Martha', pub: PUB.martha }];
  const after = teamPeopleForAllowlist(roster, [], [], MEMBERS);
  assert.deepEqual(after, roster, 'an empty delta must leave the roster byte-identical');
});

test('a roster edit does not evict the room — and an unloaded roster evicts nobody', () => {
  // The mirror defect: anyone in an invite-only team's CHAT who is not a rota person — a leader, a steward,
  // someone simply in the conversation — was ejected on the next roster save, and for an encrypted team the
  // key rotated away from them. Worse, a roster document that had not arrived reads as `people: []`, so Save
  // published `members: []` and locked the whole team out of their own room.
  const { teamAllowlistForPeople } = loadReconcilers({});
  const room = [PUB.martha, PUB.esther, PUB.unnamed];
  assert.deepEqual(teamAllowlistForPeople(room, [], []), room,
    'no change on the roster must mean no change to who can read the room');
  assert.deepEqual(teamAllowlistForPeople(room, [], []).length, 3,
    'an empty roster must not empty the room — that is the whole team locked out');
  assert.deepEqual(teamAllowlistForPeople(room, [], [PUB.esther]), [PUB.martha, PUB.unnamed],
    'someone actually taken off the roster does come out of the room');
  const added = teamAllowlistForPeople(room, [PUB.martha, 'dd'.repeat(32)], []);
  assert.equal(added.length, 4, 'a newly linked person is admitted');
  assert.equal(added.filter(p => p === PUB.martha).length, 1, 'and nobody is admitted twice');
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
  assert.match(save, /if \(!added\.length && !removed\.length\) return;/,
    'an unchanged dialog must write nothing — otherwise Save promotes the whole chat room to careAdmin');
  assert.match(save, /window\.Steward\.publishRoster\(/, 'the reconciled people must be published, not just computed');
  assert.match(save, /publishCareTeamFor\(/, 'and the care-request audience must follow the care team');
  assert.match(save, /rosters \|\| \[\]\)\.find/,
    'reconcile against the roster we have READ — publishing one we have not would wipe the team’s roles');
});

test('nothing stands in front of the group-key rotation', () => {
  // ADVERSARIAL REVIEW, 2026-08-16. The roster reconcile was first written INTO the promise chain, between
  // publishGroup and publishGroupKey. Anything thrown while reconciling therefore skipped to the catch and the
  // ROTATION NEVER RAN — so a member the steward had just removed from an encrypted room kept the current key
  // and went on reading everything posted afterwards, while the console showed a generic save error. That is
  // the one leak-shaped failure this save path's own comments exist to prevent.
  const save = stripComments(fnBody(DASH, 'const save = () => {'));
  const rotate = save.indexOf('publishGroupKey(group.id, newM, { rotate: removed })');
  const reconcile = save.indexOf('reconcileRoster()');
  assert.notEqual(rotate, -1, 'the key rotation is gone — re-anchor this test');
  assert.notEqual(reconcile, -1, 'the roster reconcile is gone — re-anchor this test');
  assert.ok(rotate < reconcile,
    'the rotation must be published BEFORE the roster is reconciled: removing someone without rotating leaves ' +
    'their cached key opening every future message');
  const body = fnBody(DASH, 'const reconcileRoster = () => {');
  assert.match(body, /try \{/, 'the reconcile must contain its own failure — it must never be able to break the save chain');
  assert.match(body, /\.catch\(\(\) => \{\}\)/, 'nor reject asynchronously into it');
});

test('saving a roster twice in a second is not possible', () => {
  // Same review. `save` became async and awaits up to four publishes with the modal still open and nothing on
  // screen changing, where it used to close instantly. A steward who sees no response clicks again, and
  // replaceable documents are newest-wins TO THE SECOND — so the second write is silently refused, and it can
  // interleave with the group-key rotation.
  const save = stripComments(fnBody(SCHEDULE, 'const save = async () => {'));
  assert.match(save, /if \(saving\) return;/, 'a second click must do nothing');
  assert.match(save, /setSaving\(true\)/);
  const btn = stripComments(SCHEDULE.slice(SCHEDULE.indexOf('Save roster') - 400, SCHEDULE.indexOf('Save roster') + 40));
  assert.match(btn, /disabled=\{saving\}/, 'and the button must say so, or the steward has no reason not to click again');
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
