// A BLOCKED MEMBER LEAVES EVERY TEAM, THE CARE LIST AND THE FUTURE ROTA — AND IS NEVER OFFERED FOR A SLOT (sim 14).
//   Run: node --test scripts/a-blocked-member-leaves-every-team.test.mjs
//
// THE DEFECT. Block never touched a roster. The blocked person stayed on every team (still offered when a steward
// filled a slot, still holding their future slots) and on the care team's roster — the list the relay reads to grant a
// read over every care need. Owner, 2026-10-02: blocking removes them from every team and the care list; unblocking
// does not re-add; their future rota slots are cleared silently.
//
// THE FIX. block() (DashMembers) calls takeOffEveryTeam once the blocklist write has landed: each roster listing them is
// republished with ONLY them taken out, the care team's `careteam:` list follows, and every rota for a service dated
// today or later loses their slots. The rota's pickers (DashRota's assign dialog and the roster dialog's member list) and
// the other pickers read the roster through the blocklist, so a stale or failed write still never offers them.
//
// Rule 1 (point of USE): the real DashMembers is rendered and its real Block pressed; the real DashRota is rendered and
// its real assign dialog opened. Rule 3: nothing here matches text in app/*.jsx.
//
// Users of the shared code (rule 2): takeOffEveryTeam has one caller (DashMembers.block). It calls publishRoster,
// publishRota (steward engine) and publishCareTeamFor (stew-schedule.jsx; also called by RosterModal's Save and the
// group-members editor, unchanged). rosterFor in DashRota feeds AssignModal, fillAssign, autoFillAhead, the pod counts and
// the team cards; RosterModal gets the unfiltered roster (it edits it). useStewardMembers is NOT filtered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled, membersGlobals, press, reads, SCH, find } from './dash-render-kit.mjs';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const BRAM = 'a'.repeat(64), CLEO = 'b'.repeat(64), OTHER = 'c'.repeat(64);
const NOW = Math.floor(Date.now() / 1000);
const members = [
  { pubkey: BRAM, npub: 'npub1aa', name: 'Bram Whitlock', count: 2, lastTs: NOW - 3600, joined: NOW - 86400 },
  { pubkey: CLEO, npub: 'npub1bb', name: 'Cleo Ashby', count: 1, lastTs: NOW - 3600, joined: NOW - 86400 },
];
const people = [
  { id: 'p1', name: 'Bram Whitlock', pub: BRAM }, { id: 'p2', name: 'Cleo Ashby', pub: CLEO }, { id: 'p3', name: 'Dora (off-app)', pub: '' },
];
const rosters = [
  { team: 'welcome', roles: [{ id: 'r1', name: 'Greeter' }], people, pods: [{ id: 'pod1', name: 'Pod A', fills: { r1: 'p1' } }] },
  { team: 'care', roles: [], people, pods: [] },
  { team: 'empty', roles: [], people: [{ id: 'p9', name: 'Cleo Ashby', pub: CLEO }], pods: [] },
];
const FUTURE = '2999-01-05', PAST = '2000-01-02';
const services = [{ id: 'svcF', date: FUTURE, time: '10:30', name: 'Sunday' }, { id: 'svcP', date: PAST, time: '10:30', name: 'Old Sunday' }];
const rotas = [
  { service: 'svcF', published: true, assign: { 'welcome::r1': { id: 'p1', name: 'Bram Whitlock', pub: BRAM }, 'welcome::r2': { id: 'p2', name: 'Cleo Ashby', pub: CLEO } } },
  { service: 'svcP', published: true, assign: { 'welcome::r1': { id: 'p1', name: 'Bram Whitlock', pub: BRAM } } },
];

function rig({ setBlocked, publishRoster, publishRota } = {}) {
  const calls = { roster: [], rota: [], careTeam: [] };
  const steward = {
    actingChurch: '',
    setBlocked: () => (setBlocked ? setBlocked() : Promise.resolve(true)),
    rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true),
    ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }), publishGroupKey: () => Promise.resolve({}), publishGroup: () => Promise.resolve(true),
    publishRoster: (team, doc) => { calls.roster.push({ team, doc }); return publishRoster ? publishRoster(team) : Promise.resolve({ id: team }); },
    publishRota: (r) => { calls.rota.push(r); return publishRota ? publishRota(r) : Promise.resolve({ id: r.service }); },
  };
  const g = membersGlobals({ steward, members, extraWindow: {
    useStewardRosters: () => rosters, useStewardRotas: () => rotas, useStewardServices: () => services,
    useMealsSettings: () => ({ adminGroupId: 'care' }),
    StewardMeals: { publishCareTeam: (pubs) => { calls.careTeam.push(pubs); return Promise.resolve(true); } },
    todayISO: () => '2026-10-02',
  } });
  g.todayISO = () => '2026-10-02';
  return { calls, g };
}
async function blockBram(r) {
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
  let tree = draw(C, {});
  await press(tree, /Remove \/ block this member/, { which: 0 });
  tree = draw(C, {});
  await press(tree, /Confirm — bans them/);
  return reads(draw(C, {}));
}

test('Block takes the person off every roster that lists them, and ONLY them', async () => {
  const r = rig();
  await blockBram(r);
  const by = Object.fromEntries(r.calls.roster.map(c => [c.team, c.doc]));
  assert.deepEqual(Object.keys(by).sort(), ['care', 'welcome'], 'rosters republished: ' + Object.keys(by) + ' — every roster that listed them, and none that did not');
  for (const t of ['welcome', 'care']) {
    assert.deepEqual(by[t].people.map(p => p.name), ['Cleo Ashby', 'Dora (off-app)'],
      `${t}: the blocked person is still on the roster, or somebody else was dropped (an off-app volunteer has no key and is never touched)`);
    assert.deepEqual(by[t].roles, rosters.find(x => x.team === t).roles, `${t}: the roster's roles were not carried across`);
  }
  assert.deepEqual(by.welcome.pods, rosters[0].pods, 'the pods were not carried across');
});

test('Block takes them off the CARE TEAM’s list — the one members’ asks for help are sealed to', async () => {
  const r = rig();
  await blockBram(r);
  assert.equal(r.calls.careTeam.length, 1, 'the care team’s sealed-ask list was not republished (only the care roster triggers it)');
  assert.deepEqual(r.calls.careTeam[0], [CLEO], 'THE BLOCKED PERSON IS STILL ON THE CARE LIST — new asks for help are still sealed to them');
});

test('Block silently clears their FUTURE slots, leaves everybody else’s, and does not rewrite a past rota', async () => {
  const r = rig();
  const said = await blockBram(r);
  assert.equal(r.calls.rota.length, 1, 'rotas rewritten: ' + JSON.stringify(r.calls.rota.map(x => x.service)) + ' (the future one only — a past rota is the record of who served)');
  assert.equal(r.calls.rota[0].service, 'svcF');
  assert.deepEqual(Object.keys(r.calls.rota[0].assign), ['welcome::r2'], 'the future rota still holds the blocked person, or lost someone else');
  assert.equal(r.calls.rota[0].published, true, 'a published rota was un-published');
  assert.doesNotMatch(said, /could not take them off/, 'a clean Block raised a warning about teams: ' + said.slice(0, 300));
});

test('a roster that would not save is named, and the care list is not written from it', async () => {
  const r = rig({ publishRoster: () => Promise.resolve(null) });
  const said = await blockBram(r);
  assert.match(said, /They are blocked, but this console could not take them off a team’s roster/, 'a refused roster write was not reported: ' + said.slice(0, 400));
  assert.equal(r.calls.careTeam.length, 0, 'the care team list was written from a roster that did not save');
});

test('a Block that may be only partly saved does not touch the teams (unblocking would not put them back)', async () => {
  const r = rig({ setBlocked: () => Promise.resolve(false) });
  await blockBram(r);
  assert.equal(r.calls.roster.length + r.calls.rota.length + r.calls.careTeam.length, 0, 'teams were edited for a Block that did not land');
});

// ── THE PICKERS: the real DashRota's assign dialog ────────────────────────────────────────────────────────────
function rota({ blocked }) {
  const { React, draw } = miniReact();
  const win = new Proxy({
    useStewardGroups: () => [{ id: 'welcome', kind: 'team', name: 'Welcome', accent: 'var(--clay)' }],
    useStewardRosters: () => [{ team: 'welcome', roles: [{ id: 'r1', name: 'Greeter' }], people, pods: [] }],
    useStewardServices: () => [{ id: 'svcF', date: FUTURE, time: '10:30', name: 'Sunday' }],
    useStewardRotas: () => [],
    useStewardMembers: () => members,
    useStewardBlocked: () => blocked,
    Steward: { publishRota: async () => ({ id: 'x' }), publishService: async () => ({ id: 'y' }) },
  }, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('useSteward')) return () => []; return undefined; }, has: () => true });
  const mod = loadScreen('app/stew-schedule.jsx', ['DashRota'], {
    React, Icon: () => null, SchModal: (p) => (p && p.children) || null, useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-02',
    window: win, document: { addEventListener() {}, removeEventListener() {} }, console,
  });
  return { draw: () => draw(mod.DashRota, { onNewTeam() {} }) };
}
const offered = (tree) => find(tree, n => n && n.type === 'button' && n.props && n.props.title === 'Assign this person to the slot').map(n => texts(n).join(' '));

test('THE ROTA: the assign dialog does not offer a blocked person — and does offer them when they are not blocked', async () => {
  const open = async (blocked) => {
    const r = rota({ blocked });
    let tree = r.draw();
    await press(tree, /Assign someone to Greeter/);
    return offered(r.draw());
  };
  const control = await open([]);
  assert.ok(control.some(t => /Bram Whitlock/.test(t)) && control.some(t => /Cleo Ashby/.test(t)),
    'CONTROL: with nobody blocked the dialog should offer both — otherwise this test proves nothing: ' + JSON.stringify(control));
  const blocked = await open([BRAM]);
  assert.ok(!blocked.some(t => /Bram Whitlock/.test(t)), 'A BLOCKED PERSON IS OFFERED FOR A ROTA SLOT: ' + JSON.stringify(blocked));
  assert.ok(blocked.some(t => /Cleo Ashby/.test(t)) && blocked.some(t => /Dora/.test(t)), 'everyone else (including an off-app volunteer) must still be offered: ' + JSON.stringify(blocked));
  const upper = await open([BRAM.toUpperCase()]);
  assert.ok(!upper.some(t => /Bram Whitlock/.test(t)), 'the blocklist spells their key in another case and they are offered again');
});

// ── THE OTHER PICKERS: steward candidates, group leaders, and the care module's two pickers ───────────────────────
// Each is rendered with the same church twice — nobody blocked (CONTROL: both people are offered) and Bram blocked.
const BLOCKED_LABEL = (tree) => texts(tree).join(' ');

test('THE STEWARD PICKER: "Add a steward" does not offer a blocked member', async () => {
  const open = async (blocked) => {
    const steward = { pubkey: 'f'.repeat(64), actingChurch: '', hasPinLock: () => false, stewardCaps: () => ({}), stewardCapNames: () => ['care'],
      stewardLabels: () => ({}), stewardName: () => '', stewardSince: () => ({}), stewardCodeToPub: () => null, stewardInvitePayload: () => 'x', qrSVG: () => '' };
    const { C, draw } = await compiled('DashStewardsPanel', { ...membersGlobals({ steward, members }), StewQRScanner: () => null, shortNpub: (n) => n,
      window: { Steward: steward, Capacitor: null, usePendingStewards: () => [], useStewardMembers: () => members, useStewardStewards: () => [],
        useStewardGroups: () => [], useStewardBlocked: () => blocked, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true } });
    let tree = draw(C, { church: { name: 'St Aidan' } });
    await press(tree, /Add a steward/);
    return BLOCKED_LABEL(draw(C, { church: { name: 'St Aidan' } }));
  };
  const control = await open([]);
  assert.ok(/Bram Whitlock/.test(control) && /Cleo Ashby/.test(control), 'CONTROL: with nobody blocked both members should be offered as stewards: ' + control.slice(0, 300));
  const t = await open([BRAM]);
  assert.ok(!/Bram Whitlock/.test(t), 'A BLOCKED MEMBER IS OFFERED AS A STEWARD');
  assert.ok(/Cleo Ashby/.test(t), 'the picker lost everyone, not just the blocked person');
});

test('THE LEADER PICKER: "Group leaders" does not offer a blocked member', async () => {
  const open = async (blocked) => {
    const steward = { actingChurch: '', publishGroup: () => Promise.resolve({ id: 'g', ts: 1 }), sendDM: () => Promise.resolve(true) };
    const g = { ...membersGlobals({ steward, members }), window: { Steward: steward, useStewardMembers: () => members, useStewardBlocked: () => blocked,
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true } };
    const { C, draw } = await compiled('GroupLeadersModal', { ...g, useStewDialog: () => ({ current: null }), StewModal: (p) => (p && p.children) || null, Modal: (p) => (p && p.children) || null });
    return BLOCKED_LABEL(draw(C, { group: { id: 'g', name: 'Youth', leaders: [] }, onClose() {} }));
  };
  const control = await open([]);
  assert.ok(/Bram Whitlock/.test(control) && /Cleo Ashby/.test(control), 'CONTROL: with nobody blocked both members should be offered as leaders: ' + control.slice(0, 300));
  const t = await open([BRAM]);
  assert.ok(!/Bram Whitlock/.test(t), 'A BLOCKED MEMBER IS OFFERED AS A GROUP LEADER');
  assert.ok(/Cleo Ashby/.test(t), 'the picker lost everyone, not just the blocked person');
});
