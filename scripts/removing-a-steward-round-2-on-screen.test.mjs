// REMOVING A STEWARD KEEPS WHAT THEY SAVED — ROUND 2, THE SCREENS (sim failures F2 and F4b of 98c7143d).
//   Run: node --test scripts/removing-a-steward-round-2-on-screen.test.mjs
//
// The sim of 98c7143d (reference/SIM-removal-save-98c7143d-2026-11-18.md) and the plan that answers it
// (reference/PLAN-removed-steward-fixes-F1-F4-2026-11-19.html, §1 and §3, as amended by 0b–0d). Owner answers (a) and
// (l) in reference/DOMAIN.md, "REMOVING A STEWARD KEEPS WHAT THEY SAVED". The real-relay half is
// removing-a-steward-round-2.test.mjs.
//
// POINT OF USE (CLAUDE.md rule 1): the real DashMembers / DashStewardsPanel / ReseatModal sliced out of
// app/stew-dashboard.jsx and rendered (dash-render-kit), their real controls pressed. window.Steward is a stand-in that
// RECORDS what the screen asks for and answers what the test says the engine answered — nothing here decides anything.
//
//   F2  NEVER SILENT. A Block that did not save (setBlocked false or null) still shows what could NOT be kept; a
//       Revoke / untick-all that did not land (refused, not landed, unknown) still shows it too. Owner answer (a): "the
//       screen says which settings could not be carried over". The all-kept line stays only for a Block that saved.
//   F4b THE RECONNECT DONE SCREEN NAMES THE PERSON. The cause, RUN here before any fix: memberName is worked out on
//       every render from the member list, and once the re-seat lands the console folds the old key OUT of that list
//       (subscribeMembers' reseatOld — reseat-fold.test.mjs "the steward console folds them out of its roster too"),
//       so the open modal's title and done screen fall back to "this member".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled, common, membersGlobals, press, find, reads, SCH } from './dash-render-kit.mjs';

const CHURCH = 'c'.repeat(64);
const DELEGATE = 'd'.repeat(64), OTHER_STEW = 'e'.repeat(64);
const M1 = 'a'.repeat(64), M2 = 'b'.repeat(64);
const BRAM = '1'.repeat(64), CLEO = '2'.repeat(64);
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const NOT_KEPT = /These couldn’t be kept and may change back: the group “Youth”/;
const ALL_KEPT = /Everything they set up stays as they left it/;
const someLost = () => ({ carried: [{ d: 'trinityone/group:a', label: 'the group “Choir”' }], notCarried: [{ d: 'trinityone/group:y', why: 'incomplete', label: 'the group “Youth”' }], superseded: [], refused: '' });
const allKept = () => ({ carried: [{ d: 'trinityone/group:a', label: 'the group “Choir”' }], notCarried: [], superseded: [], refused: '' });

// ══ F2 — Block ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// The stand-in engine offers BOTH the pre-fix calls (carryOverStewardDocs, then the screen's own setBlocked) and the
// post-fix one (blockStewardKeeping: carry → setBlocked → roster, plan 0b/0c R-M4), answering the same way either way,
// so this file measures the SCREEN's words on b98fc937 and after the fix alike.
function blockRig({ carry, blocked = true, rosterWrote = true, outcome = 'landed', rosterUnknown = false, stewards = [BRAM] }) {
  const order = [];
  const steward = {
    actingChurch: '',
    isOrWasSteward: (pk) => stewards.includes(pk),
    carryOverStewardDocs: (pk, o) => { order.push({ step: 'carry', pk, o }); return Promise.resolve(carry); },
    setBlocked: (list) => { order.push({ step: 'block', list }); return Promise.resolve(blocked); },
    blockStewardKeeping: (pk, list) => {
      order.push({ step: 'carry', pk, o: { blocked: true } }); order.push({ step: 'block', list: [...list, pk] });
      const on = stewards.includes(pk);
      if (blocked == null) return Promise.resolve({ carry, blocked, wrote: null, outcome: '', onRoster: on, rosterUnknown: false });
      if (rosterUnknown) return Promise.resolve({ carry, blocked, wrote: null, outcome: '', onRoster: on, rosterUnknown: true });
      if (on) order.push({ step: 'roster' });
      return Promise.resolve({ carry, blocked, wrote: on ? rosterWrote : null, outcome: on ? outcome : '', onRoster: on, rosterUnknown: false });
    },
    rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true),
    ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }), publishGroupKey: () => Promise.resolve({}), publishGroup: () => Promise.resolve(true),
    publishRoster: (team) => { order.push({ step: 'team', team }); return Promise.resolve({ id: team }); },
    publishRota: () => Promise.resolve({}),
  };
  const NOW = Math.floor(Date.now() / 1000);
  const members = [{ pubkey: BRAM, npub: 'npub1aa', name: 'Bram Whitlock', count: 2, lastTs: NOW - 3600, joined: NOW - 86400 },
    { pubkey: CLEO, npub: 'npub1bb', name: 'Cleo Ashby', count: 1, lastTs: NOW - 3600, joined: NOW - 86400 }];
  const g = membersGlobals({ steward, members, stewards, extraWindow: {
    useStewardRosters: () => [], useStewardRotas: () => [], useStewardServices: () => [],
    useMealsSettings: () => ({ adminGroupId: 'care' }), StewardMeals: { publishCareTeam: () => Promise.resolve(true) }, todayISO: () => '2026-10-02',
  } });
  g.todayISO = () => '2026-10-02';
  return { order, g };
}
async function blockBram(r) {
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
  await press(draw(C, {}), /Remove \/ block this member/, { which: 0 });
  await press(draw(C, {}), /Confirm — bans them/);
  await flush(30);
  return reads(draw(C, {}));
}

test('F2 — a PARTIAL block (setBlocked answered false): what could not be kept is still on the screen', async () => {
  const r = blockRig({ carry: someLost(), blocked: false });
  const said = await blockBram(r);
  assert.ok(r.order.some(s => s.step === 'carry'), 'CONTROL: the carry ran');
  assert.match(said, /Couldn’t save the block on every relay/, 'CONTROL: the partial block is said');
  assert.match(said, NOT_KEPT, 'A PARTIAL BLOCK HID THE NOT-KEPT LIST (sim F2): ' + said.slice(0, 500));
  assert.doesNotMatch(said, ALL_KEPT);
});

test('F2 — a REFUSED block (setBlocked answered null): what could not be kept is still on the screen', async () => {
  const r = blockRig({ carry: someLost(), blocked: null });
  const said = await blockBram(r);
  assert.match(said, /Couldn’t block Bram Whitlock/, 'CONTROL: the refusal is said');
  assert.match(said, NOT_KEPT, 'A REFUSED BLOCK HID THE NOT-KEPT LIST: ' + said.slice(0, 500));
});

test('F2 — CONTROL: a block that saved with everything kept says so; a partial one with everything kept does not claim it', async () => {
  assert.match(await blockBram(blockRig({ carry: allKept(), blocked: true })), ALL_KEPT);
  assert.doesNotMatch(await blockBram(blockRig({ carry: allKept(), blocked: false })), ALL_KEPT, 'a partial block claimed everything was kept (audit 2026-11-18, LOW 4)');
});

// ══ AUDIT OF 1fc01a16: what Block says about the helper list (owner answer l) ═══════════════════════════════════════
const STILL = /Blocked, but still listed as a helper — remove them from Helpers\./;
const UNCONFIRMED = /Couldn’t confirm they were taken off the helper list — check Helpers\./;
test('MED 2 — Block: the helper-list write did NOT land → "still listed as a helper"', async () => {
  const said = await blockBram(blockRig({ carry: allKept(), blocked: true, rosterWrote: false, outcome: 'not-landed' }));
  assert.match(said, STILL, said.slice(0, 500));
  assert.doesNotMatch(said, UNCONFIRMED);
});
test('MED 2 — Block: the helper list was not read yet (no write made) → "still listed as a helper"', async () => {
  const said = await blockBram(blockRig({ carry: allKept(), blocked: true, rosterUnknown: true }));
  assert.match(said, STILL, said.slice(0, 500));
});
test('MED 3 — Block: the helper-list write’s OK was lost and the re-read could not tell → "couldn’t confirm", never "still listed"', async () => {
  const said = await blockBram(blockRig({ carry: allKept(), blocked: true, rosterWrote: false, outcome: 'unknown' }));
  assert.match(said, UNCONFIRMED, said.slice(0, 500));
  assert.doesNotMatch(said, STILL, 'a lost OK was reported as a write that did not land');
});
test('MED 2/3 — CONTROLS: landed (acknowledged, or confirmed by the re-read) → neither line; a FORMER helper → neither', async () => {
  for (const o of [{ rosterWrote: true, outcome: 'landed' }, { rosterWrote: false, outcome: 'landed' }]) {
    const said = await blockBram(blockRig({ carry: allKept(), blocked: true, ...o }));
    assert.doesNotMatch(said, STILL); assert.doesNotMatch(said, UNCONFIRMED);
  }
  const r = blockRig({ carry: allKept(), blocked: true, rosterUnknown: true, stewards: [] });
  r.g.window.Steward.isOrWasSteward = (pk) => pk === BRAM;   // removed earlier: not on the roster this screen holds
  const said = await blockBram(r);
  assert.doesNotMatch(said, STILL, 'a former helper was said to be still listed');
});

// ══ OWNER ANSWER (t): a kept care setting that names a team that no longer exists is said ════════════════════════════
test('answer (t) — Revoke: the carry note says the kept care setting names a care team that no longer exists, and it stays', async () => {
  const note = 'Their care setting was kept, but it names a care team that no longer exists — help requests go only to you until you choose a team.';
  const r = panelRig(() => ({ wrote: true, carry: { ...allKept(), notes: [note] }, next: [OTHER_STEW], refused: '', outcome: 'landed' }));
  const said = await revoke(r);
  assert.ok(said.includes('Tom Ridley: Everything they set up stays as they left it, now saved under the church. ' + note), said.slice(0, 600));
});

// ══ F2 — Revoke and untick-all ═══════════════════════════════════════════════════════════════════════════════════════
// removeStewardKeeping answers { wrote, carry, next, refused, outcome }; `outcome` is the engine's own landed check
// (plan 0b R-M4, after the fix) and window.Steward.stewardRemovalOutcome answers the same for the pre-fix screen.
function panelRig(answer, { outcome = 'unknown' } = {}) {
  const calls = { keep: [] };
  const steward = {
    pubkey: CHURCH, actingChurch: '',
    joinPolicyFresh: () => false, listIsFresh: () => true,
    removeStewardKeeping: (pk, o) => { calls.keep.push({ pk, o: o || null }); return Promise.resolve(answer()); },
    setStewards: () => Promise.resolve(true),
    stewardRemovalOutcome: () => Promise.resolve(outcome),
    publishStewardRevoke: () => Promise.resolve(true),
    rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true), ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }),
    publishGroupKey: () => Promise.resolve({}), publishGroup: () => Promise.resolve(true),
    hasPinLock: () => false, verifyPin: () => Promise.resolve(true),
    stewardCaps: () => ({ [DELEGATE]: ['care'], [OTHER_STEW]: ['content'] }), stewardCapNames: () => ['care', 'content'],
    stewardLabels: () => ({ [DELEGATE]: 'Tom Ridley' }), stewardName: () => '', stewardSince: () => ({}),
    stewardCodeToPub: () => null, stewardInvitePayload: () => 'x', qrSVG: () => '',
  };
  const members = [{ pubkey: M1, name: 'Ann', joined: 1690000000 }, { pubkey: M2, name: 'Ben', joined: 1690000000 }];
  const globals = {
    ...common(), StewQRScanner: () => null,
    window: {
      Steward: steward, Capacitor: null,
      usePendingStewards: () => [], useStewardMembers: () => members, useStewardStewards: () => [DELEGATE, OTHER_STEW],
      useStewardGroups: () => [], useStewardBlocked: () => [],
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
  return { calls, globals };
}
async function revoke(r) {
  const { C, draw } = await compiled('DashStewardsPanel', r.globals, ['rotateChurchKeys']);
  const view = () => draw(C, { church: { name: 'St Aidan' } });
  const x = find(view(), n => n && n.type === 'button' && n.props.title === 'Revoke this helper');
  assert.ok(x.length >= 1, 're-anchor: no Revoke control');
  await x[0].props.onClick();
  await press(view(), /Confirm — revoke this helper/);
  await flush(30);
  return reads(view());
}
async function untickAll(r) {
  const { C, draw } = await compiled('DashStewardsPanel', r.globals, ['rotateChurchKeys']);
  const view = () => draw(C, { church: { name: 'St Aidan' } });
  await press(view(), /What this helper may do/, { which: 0 });
  find(view(), n => n && n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({ target: { checked: false } });
  await flush(30);
  return reads(view());
}

test('F2 — a Revoke that did NOT land still shows what could not be kept (the carry already ran)', async () => {
  const r = panelRig(() => ({ wrote: false, carry: someLost(), next: [OTHER_STEW], refused: '', outcome: 'not-landed' }), { outcome: 'not-landed' });
  const said = await revoke(r);
  assert.match(said, /Couldn’t remove Tom Ridley — every relay still lists them/, 'CONTROL: the failure is said');
  assert.match(said, NOT_KEPT, 'A REVOKE THAT DID NOT LAND HID THE NOT-KEPT LIST: ' + said.slice(0, 500));
});

test('F2 — a Revoke whose outcome is UNKNOWN still shows what could not be kept (the sim’s offline Revoke)', async () => {
  const r = panelRig(() => ({ wrote: false, carry: someLost(), next: [OTHER_STEW], refused: '', outcome: 'unknown' }), { outcome: 'unknown' });
  const said = await revoke(r);
  assert.match(said, /Couldn’t confirm that Tom Ridley was removed/, 'CONTROL: the unknown outcome is said');
  assert.match(said, NOT_KEPT, 'AN UNCONFIRMED REVOKE HID THE NOT-KEPT LIST: ' + said.slice(0, 500));
});

test('F2 — a Revoke REFUSED after the carry ran (roster unread by then) keeps the carry and shows what could not be kept', async () => {
  const r = panelRig(() => ({ wrote: null, carry: someLost(), next: null, refused: 'roster-unknown' }));
  const said = await revoke(r);
  assert.match(said, /hasn’t finished reading who your stewards are/, 'CONTROL: the refusal is said');
  assert.match(said, NOT_KEPT, 'THE REFUSED PATH DROPPED r.carry (plan 0b R-M5): ' + said.slice(0, 500));
});

test('F2 — an untick-all whose roster write did not land still shows what could not be kept', async () => {
  const r = panelRig(() => ({ wrote: false, carry: someLost(), next: [DELEGATE, OTHER_STEW], refused: '' }));
  const said = await untickAll(r);
  assert.match(said, /Couldn’t remove Tom Ridley’s permissions/, 'CONTROL: the failure is said');
  assert.match(said, NOT_KEPT, 'AN UNTICK-ALL THAT DID NOT LAND HID THE NOT-KEPT LIST: ' + said.slice(0, 500));
});

test('F2 — CONTROL: a refusal BEFORE any carry (no carry in the answer) shows no list and nothing invented', async () => {
  const r = panelRig(() => ({ wrote: null, carry: null, next: null, refused: 'roster-unknown' }));
  const said = await revoke(r);
  assert.doesNotMatch(said, /couldn’t be kept|stays as they left it/);
});

// ══ F4b — the Reconnect done screen names the person ═════════════════════════════════════════════════════════════════
const RUTH = '3'.repeat(64), RUTH_NEW = '4'.repeat(64);
async function reconnectRuth({ fold }) {
  const NOW = Math.floor(Date.now() / 1000);
  const state = { members: [{ pubkey: RUTH, npub: 'npub1rr', name: 'Ruth Okafor', count: 2, lastTs: NOW - 3600, joined: NOW - 86400 },
    { pubkey: CLEO, npub: 'npub1bb', name: 'Cleo Ashby', count: 1, lastTs: NOW - 3600, joined: NOW - 86400 }] };
  const asked = [];
  const steward = {
    actingChurch: '', isOrWasSteward: () => false,
    parseMemberKey: (t) => (t === 'new-code' ? RUTH_NEW : null),
    reseatMember: (o, n, opts) => {
      asked.push({ o, n, opts });
      // WHAT THE CONSOLE'S MEMBER LIST DOES ONCE THE RE-SEAT DOCUMENT LANDS (subscribeMembers, reseatOld): the old key
      // leaves the list and the new key carries the vouched name. `fold: false` is the control — the list unchanged.
      if (fold) state.members = [{ pubkey: RUTH_NEW, npub: 'npub1nn', name: opts.name || '', viaReseat: true, count: 0, lastTs: NOW, joined: NOW }, ...state.members.filter(m => m.pubkey !== RUTH)];
      return Promise.resolve({ carry: null, blockedOld: false, failed: [] });
    },
    rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true),
  };
  const g = membersGlobals({ steward, members: [], extraWindow: {
    useStewardMembers: () => state.members,
    useStewardAdmitted: () => state.members.map(m => m.pubkey),
    useStewardRosters: () => [], useStewardRotas: () => [], useStewardServices: () => [], useStewardReseats: () => [],
    useMealsSettings: () => ({}),
  } });
  delete g.ReseatModal;   // the REAL modal, compiled from the same file below
  Object.assign(g, { CkModal: (p) => [p.title, p.children], StewQRScanner: () => null, stewOnPhoneApp: () => false });
  const { C, draw } = await compiled('DashMembers', g, ['ReseatModal']);
  await press(draw(C, {}), /They lost their 12 words and are back on a new phone/, { which: 0 });
  let tree = draw(C, {});
  assert.match(reads(tree), /Reconnect Ruth Okafor/, 'CONTROL: the modal opened on Ruth, by name');
  const input = find(tree, n => n && n.type === 'input' && n.props.type !== 'checkbox');
  assert.ok(input.length, 're-anchor: no code field in the Reconnect modal');
  input[0].props.onChange({ target: { value: 'new-code' } });
  await press(draw(C, {}), /Yes — this is Ruth Okafor/);
  await flush(20);
  assert.equal(asked.length, 1, 'CONTROL: the re-seat was asked for');
  assert.equal(asked[0].opts.name, 'Ruth Okafor', 'CONTROL: the vouched name went to the engine');
  return reads(draw(C, {}));
}

test('F4b — Reconnect: once the old key folds out of the member list, the done screen still names the person', async () => {
  const said = await reconnectRuth({ fold: true });
  assert.match(said, /Done\. Ruth Okafor is back in their place/, 'THE DONE SCREEN LOST THE NAME (sim: "Done. this member…"): ' + said.slice(0, 400));
  assert.doesNotMatch(said, /Reconnect this member|Done\. this member/, 'the modal fell back to "this member"');   // the page elsewhere may say "this member" (e.g. the folded row\'s controls)
});

test('F4b — CONTROL: with the member list unchanged the done screen names the person (so the fold is the cause)', async () => {
  const said = await reconnectRuth({ fold: false });
  assert.match(said, /Done\. Ruth Okafor is back in their place/, said.slice(0, 400));
});

// ══ F4 (plan rev 4 §5): the done screen never says "nothing needed" over a relay that did not answer ═══════════════════
async function reconnectDone(carry) {
  const OLD = '3'.repeat(64), NEW = '4'.repeat(64);
  const steward = { actingChurch: '', isOrWasSteward: (pk) => pk === OLD, parseMemberKey: (t) => (t === 'new-code' ? NEW : null),
    reseatMember: () => Promise.resolve({ carry, blockedOld: true, failed: [] }) };
  const g = { ...common(), CkModal: (p) => (p && p.children) || null, StewQRScanner: () => null, stewOnPhoneApp: () => false,
    window: { Steward: steward, useStewardSafeguard: () => ({ minors: [], approved: [], expiry: {}, minorsKnown: true }), useStewardGuardians: () => ({ links: {}, closed: {} }),
      useStewardBlocked: () => [], useStewardRosters: () => [], useStewardRotas: () => [], useMealsSettings: () => ({}), useStewardReseats: () => [] } };
  const { C, draw } = await compiled('ReseatModal', g);
  const props = { member: OLD, memberName: 'Ruth', realName: '', isMinor: false, admittedList: [], onClose() {} };
  let tree = draw(C, props);
  find(tree, n => n && n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
  tree = draw(C, props);
  find(tree, n => n && n.type === 'input' && n.props.type !== 'checkbox')[0].props.onChange({ target: { value: 'new-code' } });
  await press(draw(C, props), /Yes — this is Ruth/);
  await flush();
  return reads(draw(C, props));
}
test('F4 — a relay did not answer the swap read (nothing to check): "Ordinary groups need nothing" is NOT said', async () => {
  const said = await reconnectDone({ carried: [], notCarried: [], superseded: [], swapped: [], swapFailed: [], swapOther: [], swapUnchecked: [], swapAnyUnanswered: true });
  assert.doesNotMatch(said, /Ordinary groups need nothing/, 'SAID "NOTHING NEEDED" OVER A RELAY THAT DID NOT ANSWER');
  const ok = await reconnectDone({ carried: [], notCarried: [], superseded: [], swapped: [], swapFailed: [], swapOther: [], swapUnchecked: [], swapAnyUnanswered: false });
  assert.match(ok, /Ordinary groups need nothing/, 'CONTROL: the line went missing when every relay answered');
});
test('(r) — Block of a former helper: groups that could not be checked are said, with what to do', async () => {
  const r = blockRig({ carry: allKept(), blocked: true, stewards: [] });
  r.g.window.Steward.isOrWasSteward = (pk) => pk === BRAM;
  const real = r.g.window.Steward.blockStewardKeeping;
  r.g.window.Steward.blockStewardKeeping = async (pk, list) => ({ ...(await real(pk, list)), groupsOff: { swapped: [], failed: [], other: [], unchecked: ['the group “Youth”'], anyUnanswered: true } });
  const said = await blockBram(r);
  assert.match(said, /Couldn’t check the group “Youth” — open Groups and check whether they are still on it\./, said.slice(0, 600));
});

// ══ AUDIT OF 98ab7e38 — the screens ═══════════════════════════════════════════════════════════════════════════════════
// AUDIT 2: the Block screen rotates the church's keys as soon as the block has landed — never behind the group take-off,
// which may take tens of seconds on a slow relay — and adds the take-off's line when it settles.
test('AUDIT 2 — Block: the key rotation STARTS while the group take-off is still running; its line is added when it settles', async () => {
  const r = blockRig({ carry: allKept(), blocked: true, stewards: [] });
  r.g.window.Steward.isOrWasSteward = (pk) => pk === BRAM;
  const rotated = [];
  r.g.window.Steward.rotateCareKey = () => { rotated.push('care'); return Promise.resolve(true); };
  let finishOff;
  const offDone = new Promise((res) => { finishOff = res; });
  const real = r.g.window.Steward.blockStewardKeeping;
  r.g.window.Steward.blockStewardKeeping = async (pk, list) => ({ ...(await real(pk, list)), groupsOffDone: offDone });
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
  await press(draw(C, {}), /Remove \/ block this member/, { which: 0 });
  await press(draw(C, {}), /Confirm — bans them/);
  await flush(30);
  assert.deepEqual(rotated, ['care'], 'THE KEYS WERE NOT ROTATED WHILE THE GROUP TAKE-OFF WAS STILL RUNNING (audit 2)');
  finishOff({ swapped: [], failed: [], other: [], otherSomeone: [], unchecked: ['the group “Youth”'], anyUnanswered: true });
  await flush(30);
  assert.match(reads(draw(C, {})), /Couldn’t check the group “Youth” — open Groups and check whether they are still on it\./, 'the take-off’s line was not added once it settled');
});
// AUDIT 6: the words say who changed the group — "another helper" only when it was one
test('AUDIT 6 — Block: a newer copy by someone who is not a helper is NOT called "another helper"', async () => {
  const r = blockRig({ carry: allKept(), blocked: true, stewards: [] });
  r.g.window.Steward.isOrWasSteward = (pk) => pk === BRAM;
  const real = r.g.window.Steward.blockStewardKeeping;
  const off = { swapped: [], failed: [], other: [], otherSomeone: ['the group “Youth”'], unchecked: [], anyUnanswered: false };
  r.g.window.Steward.blockStewardKeeping = async (pk, list) => ({ ...(await real(pk, list)), groupsOff: off, groupsOffDone: Promise.resolve(off) });
  const said = await blockBram(r);
  assert.doesNotMatch(said, /Another helper has changed the group “Youth”/, 'CALLED SOMEONE "ANOTHER HELPER" WHO IS NOT ONE (audit 6)');
  assert.match(said, /Someone else has changed the group “Youth” since, and it still names them — check it by hand\./, said.slice(0, 600));
});
test('AUDIT 6 — Reconnect: a newer copy by someone who is not a helper is NOT called "another steward"', async () => {
  const said = await reconnectDone({ carried: [], notCarried: [], superseded: [], swapped: [], swapFailed: [], swapOther: [], swapOtherSomeone: ['the group “Youth”'], swapUnchecked: [], swapAnyUnanswered: false });
  assert.doesNotMatch(said, /Another steward has changed the group “Youth”/, 'CALLED SOMEONE "ANOTHER STEWARD" WHO IS NOT ONE (audit 6)');
  assert.match(said, /Someone else has changed the group “Youth” since, and it still names their old key — check it by hand\./, said.slice(0, 800));
  assert.doesNotMatch(said, /Ordinary groups need nothing/, 'said "nothing needed" over a group that still names the old key');
});
