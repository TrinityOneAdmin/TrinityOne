// REMOVING A DELEGATED STEWARD RE-KEYS THE CHURCH (sim finding 5).
//   Run: node --test scripts/a-removed-delegate-loses-the-church-keys.test.mjs
//
// THE DEFECT. The owner's Remove on a delegated steward wrote the shorter roster and stopped. The relay stopped
// honouring the delegate's writes, but the care, name, sermon and encrypted-room keys already wrapped to them
// stayed wrapped to them — those keys only ever gain recipients — so a removed delegate carried on reading
// everything sealed afterwards.
//
// THE FIX. remove() (app/stew-dashboard.jsx, DashStewardsPanel) rotates every church key to the members and the
// stewards who remain, through rotateChurchKeys — the same function Block uses. It does so only after the roster
// write has LANDED, and says so on screen when it did not, or when a key would not rotate.
//
// Rule 1 (point of USE): this renders the REAL DashStewardsPanel, presses its real Revoke control, and reads
// what the console would have published and what it says. Rule 3: nothing here matches text in app/*.jsx.
//
// Users of the shared code (rule 2): rotateChurchKeys is called by DashMembers.block (covered by the existing
// block tests, re-pointed at it in this commit) and DashStewardsPanel.remove (this file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled, common, press, find, reads } from './dash-render-kit.mjs';

const CHURCH = 'c'.repeat(64);
const DELEGATE = 'd'.repeat(64), OTHER_STEW = 'e'.repeat(64);
const M1 = 'a'.repeat(64), M2 = 'b'.repeat(64), BLOCKED = '9'.repeat(64);

function setup({ setStewardsResult = true, careResult = true, delegateIsMember = false } = {}) {
  const calls = { setStewards: [], care: [], media: [], name: [], groupKey: [], publishGroup: [] };
  const steward = {
    pubkey: CHURCH, actingChurch: '',
    setStewards: (list) => { calls.setStewards.push(list); return Promise.resolve(setStewardsResult); },
    rotateCareKey: (m, s) => { calls.care.push({ m, s }); return Promise.resolve(careResult); },
    rotateMediaKey: (m, s) => { calls.media.push({ m, s }); return Promise.resolve(true); },
    ensureNameKeyForMembers: (m, s, o) => { calls.name.push({ m, s, o }); return Promise.resolve({ rotated: true }); },
    publishGroupKey: (id, m, o) => { calls.groupKey.push({ id, m, o }); return Promise.resolve({}); },
    publishGroup: (g) => { calls.publishGroup.push(g); return Promise.resolve(true); },
    hasPinLock: () => false, verifyPin: () => Promise.resolve(true),
    stewardCaps: () => ({ [DELEGATE]: ['care'], [OTHER_STEW]: ['content'] }), stewardCapNames: () => ['care', 'content'],
    stewardLabels: () => ({ [DELEGATE]: 'Tom Ridley' }), stewardName: () => '', stewardSince: () => ({}),
    stewardCodeToPub: () => null, stewardInvitePayload: () => 'x', qrSVG: () => '',
  };
  const members = [
    { pubkey: M1, name: 'Ann', joined: 1690000000 }, { pubkey: M2, name: 'Ben', joined: 1690000000 },
    { pubkey: BLOCKED, name: 'Dov', joined: 1690000000 },
    ...(delegateIsMember ? [{ pubkey: DELEGATE, name: 'Tom', joined: 1690000000 }] : []),
  ];
  const groups = [
    { id: 'open', name: 'Everyone', encrypted: true, visibility: 'open' },
    { id: 'inv', name: 'Leaders', encrypted: true, visibility: 'invite', members: [M1, BLOCKED] },
    { id: 'plain', name: 'Plain', encrypted: false, visibility: 'open' },
  ];
  const globals = {
    ...common(), StewQRScanner: () => null,
    window: {
      Steward: steward, Capacitor: null,
      usePendingStewards: () => [], useStewardMembers: () => members, useStewardStewards: () => [DELEGATE, OTHER_STEW],
      useStewardGroups: () => groups, useStewardBlocked: () => [BLOCKED],
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
  return { calls, globals };
}

async function removeDelegate(s) {
  const { C, draw } = await compiled('DashStewardsPanel', s.globals, ['rotateChurchKeys']);
  let tree = draw(C, { church: { name: 'St Aidan' } });
  // two taps, as the owner makes them: Revoke (asks to confirm), then the confirm
  const revokes = find(tree, n => n && n.type === 'button' && n.props.title === 'Revoke this steward');
  assert.ok(revokes.length >= 1, 're-anchor: no Revoke control on the steward rows');
  await revokes[0].props.onClick();   // the first row is the delegate: stewards = [DELEGATE, OTHER_STEW]
  tree = draw(C, { church: { name: 'St Aidan' } });
  await press(tree, /Confirm — revoke this steward/);
  tree = draw(C, { church: { name: 'St Aidan' } });
  return { tree, said: reads(tree) };
}

test('removing a delegate rotates the care, sermon and name keys and every encrypted room, leaving them out', async () => {
  const s = setup();
  await removeDelegate(s);
  assert.deepEqual(s.calls.setStewards, [[OTHER_STEW]], 'CONTROL: the roster write was not the delegate being dropped');
  // care + sermon: members minus the blocked person, stewards = the roster AFTER the removal
  for (const [what, rec] of [['care', s.calls.care], ['sermon', s.calls.media]]) {
    assert.equal(rec.length, 1, `THE ${what.toUpperCase()} KEY WAS NOT ROTATED when a delegate was removed — they keep reading what is sealed from now on`);
    assert.deepEqual(rec[0].m.sort(), [M1, M2].sort(), `${what} key: recipients must be the members, without the blocked person`);
    assert.deepEqual(rec[0].s, [OTHER_STEW], `${what} key: the removed delegate is still among the stewards it is wrapped to`);
  }
  assert.equal(s.calls.name.length, 1, 'THE NAME KEY WAS NOT ROTATED when a delegate was removed');
  assert.equal(s.calls.name[0].o && s.calls.name[0].o.rotate, true, 'the name key was ensured, not ROTATED');
  assert.deepEqual(s.calls.name[0].s, [OTHER_STEW]);
  // every ENCRYPTED room, open and invite-only, and not the plain one
  const byId = Object.fromEntries(s.calls.groupKey.map(c => [c.id, c]));
  assert.deepEqual(Object.keys(byId).sort(), ['inv', 'open'], 'rooms re-keyed: ' + Object.keys(byId) + ' (every encrypted room, and only those)');
  assert.equal(byId.open.o.rotate, true); assert.equal(byId.inv.o.rotate, true);
  assert.deepEqual(byId.open.m.sort(), [M1, M2].sort(), 'an open room is keyed to the members');
  assert.deepEqual(byId.inv.m, [M1], 'an invite-only room is keyed to ITS members (minus the blocked), not the whole church');
  assert.equal(s.calls.publishGroup.length, 0, 'removing a delegate must not edit any room’s member list (that is Block’s job)');
  for (const list of [...s.calls.care, ...s.calls.media, ...s.calls.name, ...s.calls.groupKey].flatMap(c => [...(c.m || []), ...(c.s || [])]))
    assert.notEqual(list, DELEGATE, 'the removed delegate is still in a recipient list');
});

test('the owner is told what removing them did, and what it did not', async () => {
  const s = setup();
  const r = await removeDelegate(s);
  assert.match(r.said, /Tom Ridley is no longer a steward, and the church’s keys have been changed/, 'nothing on screen says the keys were changed: ' + r.said.slice(0, 300));
  assert.match(r.said, /What they could already open stays open/, 'the note claims more than rotation can do');
});

test('a delegate who is ALSO a member is told they keep member access, and is still re-keyed around', async () => {
  const s = setup({ delegateIsMember: true });
  const r = await removeDelegate(s);
  assert.match(r.said, /They are also a member[^.]*block them from Members/, 'the owner is not told removal does not put a member out of the church: ' + r.said.slice(0, 300));
  assert.equal(s.calls.care.length, 1, 'a member-delegate’s removal did not rotate');
  assert.ok(s.calls.care[0].m.includes(DELEGATE), 'a delegate who is also a member keeps member-level keys (the enrolment effect would re-add them at once otherwise)');
});

test('a removal the relay did not accept rotates NOTHING and says they are still a steward', async () => {
  const s = setup({ setStewardsResult: false });
  const r = await removeDelegate(s);
  assert.equal(s.calls.care.length + s.calls.media.length + s.calls.name.length + s.calls.groupKey.length, 0,
    'keys were rotated for a removal that never landed — re-keying around a steward the relay still honours locks out the wrong person');
  assert.match(r.said, /Couldn’t remove Tom Ridley[^.]*STILL a steward and nothing was re-keyed/, 'the owner is told nothing: ' + r.said.slice(0, 300));
});

test('a key that would not rotate is named, not reported as success', async () => {
  const s = setup({ careResult: false });
  const r = await removeDelegate(s);
  assert.match(r.said, /could not change the care key/, 'a failed care-key rotation was swallowed: ' + r.said.slice(0, 300));
  assert.doesNotMatch(r.said, /the church’s keys have been changed/, 'it says the keys were changed when one was not');
});

// ── rotateChurchKeys itself: the half that only Block uses (it had no test pinning it) ──────────────────────────
// Lifted out of the shipped file and run; `window.Steward` is the only thing faked, and it only records.
import { fnBody } from './test-slice.mjs';
import { DASH } from './dash-render-kit.mjs';
function rotator(steward) {
  return new Function('window', fnBody(DASH, 'function rotateChurchKeys(', 'rotateChurchKeys') + '\nreturn rotateChurchKeys;')({ Steward: steward });
}
function recorder() {
  const c = { groupKey: [], publishGroup: [] };
  return { c, steward: {
    rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true), ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }),
    publishGroupKey: (id, m, o) => { c.groupKey.push({ id, m, o }); return Promise.resolve({}); },
    publishGroup: (g) => { c.publishGroup.push(g); return Promise.resolve(true); },
  } };
}
const none = () => false;

test('Block (dropPk): the person leaves the invite-only rooms they were in, and rooms they were never in are not re-keyed', async () => {
  const r = recorder();
  const failed = await rotator(r.steward)({
    memberPubs: [M1, M2], stewardPubs: [], delegated: false, dropPk: DELEGATE, isBlocked: none,
    groups: [
      { id: 'in', name: 'In', encrypted: true, visibility: 'invite', members: [M1, DELEGATE] },
      { id: 'out', name: 'Out', encrypted: true, visibility: 'invite', members: [M1, M2] },
    ],
  });
  assert.deepEqual(failed, []);
  assert.deepEqual(r.c.groupKey.map(c => c.id), ['in'], 'a room the person was never in was re-keyed, or the one they were in was not');
  assert.deepEqual(r.c.groupKey[0].m, [M1], 'the room key went to the person being blocked');
  assert.deepEqual(r.c.publishGroup.map(g => [g.id, g.members]), [['in', [M1]]],
    'BLOCKING DID NOT TAKE THEM OFF THE INVITE-ONLY ROOM’S MEMBER LIST — they stay listed in a room whose key they no longer have');
});

test('a DELEGATED console re-keys no room (only the owner may), and does not report the owner-only keys as failures', async () => {
  const r = recorder();
  const steward = { ...r.steward, rotateMediaKey: () => Promise.resolve(null), ensureNameKeyForMembers: () => Promise.resolve(null) };
  const failed = await rotator(steward)({
    memberPubs: [M1], stewardPubs: [], delegated: true, dropPk: M2, isBlocked: none,
    groups: [{ id: 'g', encrypted: true, visibility: 'open' }],
  });
  assert.equal(r.c.groupKey.length, 0, 'a delegated console re-keyed an encrypted room in someone else’s church');
  assert.deepEqual(failed, [], 'the deliberate owner-only decline was reported as a failure');
});
