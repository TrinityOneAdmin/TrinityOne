// REMOVING A STEWARD KEEPS WHAT THEY SAVED — THE SCREENS, PRESSED.
//   Run: node --test scripts/removing-a-steward-keeps-what-they-saved-on-screen.test.mjs
//
// Owner, 2026-11-17 (reference/DOMAIN.md, "REMOVING A STEWARD KEEPS WHAT THEY SAVED"). The engine half is
// removing-a-steward-keeps-what-they-saved.test.mjs; this is the POINT OF USE (CLAUDE.md rule 1): the real
// DashStewardsPanel and DashMembers, sliced out of app/stew-dashboard.jsx and rendered (dash-render-kit), their real
// controls pressed. window.Steward is a stand-in that RECORDS what the screen asks the engine for — nothing here decides
// anything. Delete the carry call from remove(), setCaps() or block() and these go red; that was done (scoped sabotage)
// when they were written.
//
//   T2  Revoke asks the engine to remove-and-keep (not the bare roster write); the row stays, saying so, until the
//       roster write lands; the rotation that follows uses the roster the ENGINE wrote.
//   T3  what the screen says when everything / some / nothing of theirs was kept.
//   R2  a console that has not read the roster: the removal is refused, the row comes back, and the screen says why.
//   T8  unticking the LAST capability runs the same carry (owner answer c); narrowing does not.
//   T10 Block of a current steward runs the carry (with { blocked: true }) BEFORE the block is published and before the
//       teams are rewritten; Block of an ordinary member does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled, common, membersGlobals, press, find, reads, SCH } from './dash-render-kit.mjs';

const CHURCH = 'c'.repeat(64);
const DELEGATE = 'd'.repeat(64), OTHER_STEW = 'e'.repeat(64);
const M1 = 'a'.repeat(64), M2 = 'b'.repeat(64);
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const deferred = () => { let res; const p = new Promise(r => { res = r; }); return { p, res }; };

function panelRig({ keep, caps = { [DELEGATE]: ['care'], [OTHER_STEW]: ['content'] } } = {}) {
  const calls = { keep: [], setStewards: [], groupKey: [], care: [] };
  const steward = {
    pubkey: CHURCH, actingChurch: '',
    joinPolicyFresh: () => false, listIsFresh: () => true,
    removeStewardKeeping: (pk, o) => { calls.keep.push({ pk, o: o || null }); return keep ? keep(pk, o) : Promise.resolve({ wrote: true, carry: { carried: [], notCarried: [], superseded: [] }, next: [OTHER_STEW] }); },
    setStewards: (list, c) => { calls.setStewards.push({ list, c }); return Promise.resolve(true); },
    stewardRemovalOutcome: () => Promise.resolve('unknown'),
    rotateCareKey: (m, s) => { calls.care.push({ m, s }); return Promise.resolve(true); },
    rotateMediaKey: () => Promise.resolve(true), ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }),
    publishGroupKey: (id, m, o) => { calls.groupKey.push({ id, m, o }); return Promise.resolve({}); }, publishGroup: () => Promise.resolve(true),
    hasPinLock: () => false, verifyPin: () => Promise.resolve(true),
    stewardCaps: () => caps, stewardCapNames: () => ['care', 'content'],
    stewardLabels: () => ({ [DELEGATE]: 'Tom Ridley' }), stewardName: () => '', stewardSince: () => ({}),
    stewardCodeToPub: () => null, stewardInvitePayload: () => 'x', qrSVG: () => '',
  };
  const members = [{ pubkey: M1, name: 'Ann', joined: 1690000000 }, { pubkey: M2, name: 'Ben', joined: 1690000000 }];
  const state = { roster: [DELEGATE, OTHER_STEW] };
  const globals = {
    ...common(), StewQRScanner: () => null,
    window: {
      Steward: steward, Capacitor: null,
      usePendingStewards: () => [], useStewardMembers: () => members, useStewardStewards: () => state.roster.slice(),
      useStewardGroups: () => [{ id: 'open', name: 'Everyone', encrypted: true, visibility: 'open' }], useStewardBlocked: () => [],
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
  return { calls, globals, state };
}
async function openPanel(r) {
  const { C, draw } = await compiled('DashStewardsPanel', r.globals, ['rotateChurchKeys']);
  const view = () => draw(C, { church: { name: 'St Aidan' } });
  return { view };
}
async function revokeDelegate(r) {
  const p = await openPanel(r);
  let tree = p.view();
  const x = find(tree, n => n && n.type === 'button' && n.props.title === 'Revoke this helper');
  assert.ok(x.length >= 1, 're-anchor: no Revoke control on the steward rows');
  await x[0].props.onClick();   // the first row is the delegate
  tree = p.view();
  const asked = reads(tree);
  await press(tree, /Confirm — revoke this helper/);
  return { ...p, asked };
}
const rowCount = (tree) => find(tree, n => n && n.type === 'button' && n.props.title === 'Revoke this helper').length;

// ══ T2 ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('T2 — Revoke asks the engine to REMOVE AND KEEP (never the bare roster write), and the confirm says what is kept', async () => {
  const r = panelRig();
  const p = await revokeDelegate(r);
  assert.match(p.asked, /What they set up stays as it is\./, 'the confirm does not say their settings stay');
  assert.deepEqual(r.calls.keep.map(c => c.pk), [DELEGATE], 'THE CARRY WAS NOT ASKED FOR: Remove went straight to the roster');
  assert.equal(r.calls.keep[0].o, null, 'a plain Remove is not the capabilities-only path');
  assert.equal(r.calls.setStewards.length, 0, 'the screen wrote the roster itself, from its own (stale) list');
});

test('T2 — while the carry runs the row STAYS and says so; it leaves only when the roster write lands, and the re-key uses the engine’s roster', async () => {
  const d = deferred();
  const r = panelRig({ keep: () => d.p });
  const p = await revokeDelegate(r);
  let tree = p.view();
  assert.match(reads(tree), /Removing… keeping what they set up/, 'the row does not say the removal is in progress');
  assert.ok(reads(tree).includes('Tom Ridley'), 'the row left the board before the roster write landed');
  assert.equal(find(tree, n => n && n.type === 'button' && n.props.title === 'Revoke this helper').length, 1, 'CONTROL: only the other steward’s row offers Revoke while this one is in flight');
  assert.equal(find(tree, n => n && n.type === 'button' && /Confirm — revoke/.test(String(n.props.title || ''))).length, 0, 'the spent row still offers Revoke');
  assert.equal(r.calls.groupKey.length, 0, 're-keyed before the removal landed');
  d.res({ wrote: true, carry: { carried: [{ d: 'x', label: 'a group' }], notCarried: [], superseded: [] }, next: [OTHER_STEW, 'f'.repeat(64)] });
  await flush();
  tree = p.view();
  assert.equal(rowCount(tree), 1, 'the row is still on the board after the removal landed');
  assert.equal(r.calls.care.length, 1, 'the keys were not rotated after the removal landed');
  assert.deepEqual(r.calls.care[0].s, [OTHER_STEW, 'f'.repeat(64)], 'the rotation kept the SCREEN’s roster, not the one the engine wrote');
});

test('T2 — a removal that did not land puts the row back, without "Removing…"', async () => {
  const r = panelRig({ keep: () => Promise.resolve({ wrote: false, carry: { carried: [], notCarried: [], superseded: [] }, next: [OTHER_STEW] }) });
  r.globals.window.Steward.stewardRemovalOutcome = () => Promise.resolve('not-landed');
  const p = await revokeDelegate(r);
  await flush();
  const tree = p.view();
  assert.equal(rowCount(tree), 2, 'the row did not come back');
  assert.doesNotMatch(reads(tree), /Removing…/);
  assert.match(reads(tree), /Couldn’t remove Tom Ridley/);
});

// ══ T3: what the screen says ═════════════════════════════════════════════════════════════════════════════════════════
for (const [name, carry, want, not] of [
  ['everything kept', { carried: [{ d: 'a', label: 'a group' }, { d: 'b', label: 'a photo setting' }], notCarried: [], superseded: [] },
    /Everything they set up stays as they left it, now saved under the church\./, /couldn’t be kept/],
  ['some not kept', { carried: [{ d: 'a', label: 'a group' }], notCarried: [{ d: 'g', why: 'incomplete', label: 'the group “Youth”' }, { d: 'n', why: 'time', label: 'a photo setting' }], superseded: [] },
    /The rest of what they set up stays as they left it, now saved under the church\. These couldn’t be kept and may change back: the group “Youth”, a photo setting\./, /^$/],
  ['nothing of theirs to keep', { carried: [], notCarried: [], superseded: ['x'] }, null, /stays as they left it|couldn’t be kept/],
]) {
  test('T3 — the screen after a removal: ' + name, async () => {
    const r = panelRig({ keep: () => Promise.resolve({ wrote: true, carry, next: [OTHER_STEW] }) });
    const p = await revokeDelegate(r);
    await flush();
    const said = reads(p.view());
    if (want) assert.match(said, want, said.slice(0, 400));
    if (String(not) !== '/^$/') assert.doesNotMatch(said, not, said.slice(0, 400));
  });
}

// ══ R2 ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('R2 — a console that has not read the roster yet: refused, the row comes back, and the screen says why', async () => {
  const r = panelRig({ keep: () => Promise.resolve({ wrote: null, carry: null, next: null, refused: 'roster-unknown' }) });
  const p = await revokeDelegate(r);
  await flush();
  const tree = p.view();
  assert.equal(rowCount(tree), 2, 'the row did not come back after a refused removal');
  assert.match(reads(tree), /hasn’t finished reading who your stewards are/);
  assert.equal(r.calls.care.length, 0, 'keys were rotated around a removal that never happened');
});

// ══ T8: unticking every capability ═══════════════════════════════════════════════════════════════════════════════════
async function untick(r, which) {
  const p = await openPanel(r);
  let tree = p.view();
  await press(tree, /What this helper may do/, { which: 0 });   // the delegate's Permissions
  tree = p.view();
  assert.match(reads(tree), /What they set up stays as it is\./, 'the editor does not say what unticking the last one does');
  const boxes = find(tree, n => n && n.type === 'input' && n.props.type === 'checkbox');
  const box = boxes[which];
  assert.ok(box, 're-anchor: no capability checkbox ' + which);
  box.props.onChange({ target: { checked: false } });
  await flush();
  return p;
}
test('T8 — unticking the LAST capability runs the carry (capabilities only), not a bare roster write', async () => {
  const r = panelRig({ caps: { [DELEGATE]: ['care'], [OTHER_STEW]: ['content'] } });
  await untick(r, 0);   // 'care' — their only one
  assert.deepEqual(r.calls.keep, [{ pk: DELEGATE, o: { capsOnly: true } }], 'unticking everything did not go through the carry');
  assert.equal(r.calls.setStewards.length, 0, 'unticking everything wrote the roster directly');
});
test('T8 — CONTROL: narrowing (one of two unticked) is unchanged — a roster write, no carry', async () => {
  const r = panelRig({ caps: { [DELEGATE]: ['care', 'content'], [OTHER_STEW]: ['content'] } });
  const p = await openPanel(r);
  let tree = p.view();
  await press(tree, /What this helper may do/, { which: 0 });
  tree = p.view();
  find(tree, n => n && n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({ target: { checked: false } });
  await flush();
  assert.equal(r.calls.keep.length, 0);
  assert.equal(r.calls.setStewards.length, 1);
  assert.deepEqual(r.calls.setStewards[0].c[DELEGATE], ['content']);
});

// ══ T10: Block ═══════════════════════════════════════════════════════════════════════════════════════════════════════
const BRAM = '1'.repeat(64), CLEO = '2'.repeat(64);
function blockRig({ stewards = [], wasSteward = false, carry } = {}) {
  const order = [];
  const people = [{ id: 'p1', name: 'Bram', pub: BRAM }, { id: 'p2', name: 'Cleo', pub: CLEO }];
  const steward = {
    actingChurch: '',
    isOrWasSteward: (pk) => (wasSteward && pk === BRAM),
    carryOverStewardDocs: (pk, o) => { order.push({ step: 'carry', pk, o }); return carry ? carry() : Promise.resolve({ carried: [{ d: 'g', label: 'a group' }], notCarried: [], superseded: [] }); },
    setBlocked: (list) => { order.push({ step: 'block', list }); return Promise.resolve(true); },
    rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true),
    ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }), publishGroupKey: () => Promise.resolve({}), publishGroup: () => Promise.resolve(true),
    publishRoster: (team) => { order.push({ step: 'roster', team }); return Promise.resolve({ id: team }); },
    publishRota: () => Promise.resolve({}),
  };
  const NOW = Math.floor(Date.now() / 1000);
  const members = [{ pubkey: BRAM, npub: 'npub1aa', name: 'Bram Whitlock', count: 2, lastTs: NOW - 3600, joined: NOW - 86400 },
    { pubkey: CLEO, npub: 'npub1bb', name: 'Cleo Ashby', count: 1, lastTs: NOW - 3600, joined: NOW - 86400 }];
  const g = membersGlobals({ steward, members, stewards, extraWindow: {
    useStewardRosters: () => [{ team: 'welcome', roles: [], people, pods: [] }], useStewardRotas: () => [], useStewardServices: () => [],
    useMealsSettings: () => ({ adminGroupId: 'care' }), StewardMeals: { publishCareTeam: () => Promise.resolve(true) }, todayISO: () => '2026-10-02',
  } });
  g.todayISO = () => '2026-10-02';
  return { order, g };
}
async function blockBram(r) {
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
  let tree = draw(C, {});
  await press(tree, /Remove \/ block this member/, { which: 0 });
  tree = draw(C, {});
  const asked = reads(tree);
  await press(tree, /Confirm — bans them/);
  await flush(20);
  return { asked, said: reads(draw(C, {})) };
}
test('T10 — Block of a CURRENT steward: the carry runs first (blocked), then the block, then the teams', async () => {
  const r = blockRig({ stewards: [BRAM] });
  const out = await blockBram(r);
  assert.match(out.asked, /What they set up stays as it is\./, 'the Block confirm does not say their settings stay');
  const steps = r.order.map(s => s.step);
  assert.equal(steps[0], 'carry', 'THE CARRY DID NOT RUN FIRST: ' + steps.join(' → '));
  assert.deepEqual(r.order[0].o, { blocked: true }, 'the Block carry must take them off leaders/members (owner answer f)');
  assert.equal(r.order[0].pk, BRAM);
  assert.ok(steps.indexOf('block') > 0, 'the block was not published after the carry: ' + steps.join(' → '));
  assert.ok(steps.indexOf('roster') > steps.indexOf('carry'), 'takeOffEveryTeam ran before the carry: ' + steps.join(' → '));
  assert.match(out.said, /Everything they set up stays as they left it, now saved under the church\./);
});
test('T10 — Block of a FORMER steward (removed earlier) runs the carry too', async () => {
  const r = blockRig({ wasSteward: true });
  await blockBram(r);
  assert.equal(r.order[0] && r.order[0].step, 'carry');
});
test('T10 — a carry that fails never stops the Block', async () => {
  const r = blockRig({ stewards: [BRAM], carry: () => Promise.reject(new Error('relay down')) });
  const out = await blockBram(r);
  assert.ok(r.order.some(s => s.step === 'block'), 'a failed carry stopped the Block');
  assert.match(out.said, /couldn’t be kept and may change back/);
});
test('T10 — CONTROL: Block of someone who was never a steward does not carry, and the confirm does not mention it', async () => {
  const r = blockRig();
  const out = await blockBram(r);
  assert.deepEqual(r.order.map(s => s.step).filter(s => s === 'carry'), []);
  assert.equal(r.order[0] && r.order[0].step, 'block');
  assert.doesNotMatch(out.asked, /What they set up stays as it is/);
});

// ══ ROUND 2 (audit of 2026-11-18) ═══════════════════════════════════════════════════════════════════════════════════
test('LOW 4 — a Block that did NOT save never says their settings were kept', async () => {
  for (const answer of [false, null]) {
    const r = blockRig({ stewards: [BRAM] });
    r.g.window.Steward.setBlocked = (list) => { r.order.push({ step: 'block', list }); return Promise.resolve(answer); };
    const out = await blockBram(r);
    assert.equal(r.order[0].step, 'carry', 'CONTROL: the carry ran');
    assert.doesNotMatch(out.said, /stays as they left it/, 'a block answered ' + answer + ' still claimed their settings were kept');
  }
});
test('LOW 4 — the Block result line can be dismissed', async () => {
  const r = blockRig({ stewards: [BRAM] });
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
  let tree = draw(C, {});
  await press(tree, /Remove \/ block this member/, { which: 0 });
  await press(draw(C, {}), /Confirm — bans them/);
  await flush(20);
  tree = draw(C, {});
  assert.match(reads(tree), /Everything they set up stays as they left it/);
  await press(tree, /Dismiss/);
  assert.doesNotMatch(reads(draw(C, {})), /Everything they set up stays as they left it/, 'Dismiss did not clear the result line');
});

test('LOW 5 — unticking everything: the editor says it is working, then a failed write says so', async () => {
  const d = deferred();
  const r = panelRig({ keep: () => d.p });
  const p = await untick(r, 0);
  assert.match(reads(p.view()), /Removing their permissions… keeping what they set up/, 'no in-flight indicator while the carry and roster write run');
  d.res({ wrote: false, carry: { carried: [], notCarried: [], superseded: [] }, next: [DELEGATE, OTHER_STEW] });
  await flush();
  const said = reads(p.view());
  assert.doesNotMatch(said, /Removing their permissions…/);
  assert.match(said, /Couldn’t remove Tom Ridley’s permissions — the change didn’t save/, 'a write that did not land said nothing');
});
test('LOW 5 — the untick-all line says what is true: they keep their place, with no permissions', async () => {
  const r = panelRig();
  const p = await openPanel(r);
  let tree = p.view();
  await press(tree, /What this helper may do/, { which: 0 });
  const said = reads(p.view());
  assert.match(said, /Unticking everything removes all their permissions\. What they set up stays as it is\./);
  assert.doesNotMatch(said, /takes them off as a helper/);
});

test('deviation (d) — no silent fallback: a stand-in without removeStewardKeeping writes no roster at all', async () => {
  const r = panelRig();
  delete r.globals.window.Steward.removeStewardKeeping;
  await revokeDelegate(r);
  await flush();
  assert.equal(r.calls.setStewards.length, 0, 'Remove fell back to writing the screen’s roster, keeping nothing');
});

// ══ RE-SEAT (audit LOW 1): the modal says it is keeping what they set up, and then what it kept ═════════════════════
test('LOW 1 — Reconnect with "taken" on a steward’s old key shows progress, then what was kept', async () => {
  const OLD = '3'.repeat(64), NEW = '4'.repeat(64);
  const d = deferred();
  const asked = [];
  const steward = {
    actingChurch: '', isOrWasSteward: (pk) => pk === OLD, parseMemberKey: (t) => (t === 'new-code' ? NEW : null),
    reseatMember: (o, n, opts) => { asked.push({ o, n, opts }); return d.p; },
  };
  const g = { ...common(), CkModal: (p) => (p && p.children) || null, StewQRScanner: () => null, stewOnPhoneApp: () => false,
    window: { Steward: steward, useStewardSafeguard: () => ({ minors: [], approved: [], expiry: {}, minorsKnown: true }), useStewardGuardians: () => ({ links: {}, closed: {} }),
      useStewardBlocked: () => [], useStewardRosters: () => [], useStewardRotas: () => [], useMealsSettings: () => ({}), useStewardReseats: () => [] } };
  const { C, draw } = await compiled('ReseatModal', g);
  const props = { member: OLD, memberName: 'Ruth', realName: '', isMinor: false, admittedList: [], onClose() {} };
  let tree = draw(C, props);
  find(tree, n => n && n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
  tree = draw(C, props);
  find(tree, n => n && n.type === 'input' && n.props.type !== 'checkbox')[0].props.onChange({ target: { value: 'new-code' } });
  tree = draw(C, props);
  await press(tree, /Yes — this is Ruth/);
  assert.equal(asked.length, 1, 'the re-seat was not asked for');
  assert.equal(asked[0].opts.blockOld, true);
  assert.match(reads(draw(C, props)), /Reconnecting… keeping what they set up/, 'no progress shown while the carry runs (up to ~20 s)');
  d.res({ carry: { carried: [{ d: 'trinityone/group:g', label: 'the group “Youth”' }], notCarried: [{ d: 'n', why: 'time', label: 'a photo setting' }], superseded: [], swapped: ['the group “Youth”'], swapFailed: ['the group “Choir”'] }, blockedOld: true, failed: [] });
  await flush();
  const said = reads(draw(C, props));
  assert.match(said, /These couldn’t be kept and may change back: a photo setting\./, 'the result of the carry is not said');
  // round 3 (nit 6): groups they set up were moved to the new key automatically, so the hand step is only for the OTHERS
  assert.match(said, /Groups they set up now name their new key\./, 'the screen does not say the groups they set up were moved');
  assert.match(said, /Couldn’t put their new key on the group “Choir” — open Groups and add them\./, 'a group the swap could not re-save is not named');
  assert.match(said, /if they were in any other invite-only groups/, 'the hand step still reads as if no group was moved');
});

test('nit 7 — unticking a SECOND steward’s last box while the first is still clearing is queued, not dropped', async () => {
  const d1 = deferred(), d2 = deferred();
  const r = panelRig({ keep: (pk) => (pk === DELEGATE ? d1.p : d2.p), caps: { [DELEGATE]: ['care'], [OTHER_STEW]: ['content'] } });
  const p = await openPanel(r);
  let tree = p.view();
  await press(tree, /What this helper may do/, { which: 0 });
  find(p.view(), n => n && n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({ target: { checked: false } });
  await flush();
  tree = p.view();
  await press(tree, /What this helper may do/, { which: 1 });   // open the second steward's editor while the first is in flight
  const boxes = find(p.view(), n => n && n.type === 'input' && n.props.type === 'checkbox');
  boxes[boxes.length - 1].props.onChange({ target: { checked: false } });   // their only capability
  await flush();
  assert.deepEqual(r.calls.keep.map(c => c.pk), [DELEGATE, OTHER_STEW], 'the second untick-all was dropped while the first was in flight');
  d1.res({ wrote: true, carry: { carried: [], notCarried: [], superseded: [] }, next: [DELEGATE, OTHER_STEW] });
  d2.res({ wrote: true, carry: { carried: [], notCarried: [], superseded: [] }, next: [DELEGATE, OTHER_STEW] });
  await flush();
  assert.doesNotMatch(reads(p.view()), /Removing their permissions…/, 'an indicator stayed after both finished');
});

// ══ ROUND 4 (audit of round 3) ══════════════════════════════════════════════════════════════════════════════════════
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
test('N3 — "Groups they set up now name their new key" only when at least one group was actually swapped', async () => {
  const none = await reconnectDone({ carried: [{ d: 'trinityone/group:g', label: 'the group “Youth”' }], notCarried: [], superseded: [], swapped: [], swapFailed: ['the group “Youth”'] });
  assert.doesNotMatch(none, /Groups they set up now name their new key/, 'claimed the groups moved when every swap failed');
  assert.match(none, /if they were in any invite-only groups/, 'the hand step says "other" although no group was moved');
  const some = await reconnectDone({ carried: [], notCarried: [], superseded: ['trinityone/group:g'], swapped: ['the group “Youth”'], swapFailed: [] });
  assert.match(some, /Groups they set up now name their new key\./, 'a group moved on a RETRIED re-seat (superseded, not carried) is not said');
});

test('N2 — a second untick-all’s result does not wipe the first one’s "couldn’t be kept" list; each names its steward', async () => {
  const d1 = deferred(), d2 = deferred();
  const r = panelRig({ keep: (pk) => (pk === DELEGATE ? d1.p : d2.p), caps: { [DELEGATE]: ['care'], [OTHER_STEW]: ['content'] } });
  r.globals.window.Steward.stewardLabels = () => ({ [DELEGATE]: 'Tom Ridley', [OTHER_STEW]: 'Ann Other' });
  const p = await openPanel(r);
  await press(p.view(), /What this helper may do/, { which: 0 });
  find(p.view(), n => n && n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({ target: { checked: false } });
  await flush();
  await press(p.view(), /What this helper may do/, { which: 1 });
  const boxes = find(p.view(), n => n && n.type === 'input' && n.props.type === 'checkbox');
  boxes[boxes.length - 1].props.onChange({ target: { checked: false } });
  await flush();
  d1.res({ wrote: true, carry: { carried: [], notCarried: [{ d: 'x', why: 'time', label: 'a photo setting' }], superseded: [] }, next: [DELEGATE, OTHER_STEW] });
  await flush();
  d2.res({ wrote: true, carry: { carried: [{ d: 'y', label: 'a group' }], notCarried: [], superseded: [] }, next: [DELEGATE, OTHER_STEW] });
  await flush();
  const said = reads(p.view());
  assert.match(said, /Tom Ridley: These couldn’t be kept and may change back: a photo setting\./, 'THE FIRST STEWARD’S NOT-KEPT LIST WAS WIPED by the second result');
  assert.match(said, /Ann Other: Everything they set up stays as they left it/, 'the second result is not shown, or does not say whose it is');
});


// ══ ROUND 5 (audit of round 4) ══════════════════════════════════════════════════════════════════════════════════════
test('L1 — Reconnect names a group another steward changed (still naming the old key), and drops "ordinary groups need nothing"', async () => {
  const other = await reconnectDone({ carried: [], notCarried: [], superseded: ['trinityone/group:g'], swapped: [], swapFailed: [], swapOther: ['the group “Choir”'] });
  assert.match(other, /Another steward has changed the group “Choir” since, and it still names their old key — check it by hand\./, 'a group left naming the old key is not said');
  assert.doesNotMatch(other, /Ordinary groups need nothing/, 'says nothing is needed while a group still names the old key');
  const failed = await reconnectDone({ carried: [], notCarried: [], superseded: ['trinityone/group:g'], swapped: [], swapFailed: ['the group “Choir”'], swapOther: [] });
  assert.doesNotMatch(failed, /Ordinary groups need nothing/, 'says nothing is needed while a group could not be updated');
  const clean = await reconnectDone({ carried: [], notCarried: [], superseded: ['trinityone/group:g'], swapped: ['the group “Choir”'], swapFailed: [], swapOther: [] });
  assert.match(clean, /Ordinary groups need nothing — they are already back in those\./, 'CONTROL: the line went missing when it is true');
});

test('nit — each "everything kept" line has its OWN 8 s: a later note does not extend an earlier one', async () => {
  const timers = [];
  const d1 = deferred(), d2 = deferred();
  const r = panelRig({ keep: (pk) => (pk === DELEGATE ? d1.p : d2.p), caps: { [DELEGATE]: ['care'], [OTHER_STEW]: ['content'] } });
  r.globals.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  r.globals.window.Steward.stewardLabels = () => ({ [DELEGATE]: 'Tom Ridley', [OTHER_STEW]: 'Ann Other' });
  const p = await openPanel(r);
  await press(p.view(), /What this helper may do/, { which: 0 });
  find(p.view(), n => n && n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({ target: { checked: false } });
  await flush();
  await press(p.view(), /What this helper may do/, { which: 1 });
  const boxes = find(p.view(), n => n && n.type === 'input' && n.props.type === 'checkbox');
  boxes[boxes.length - 1].props.onChange({ target: { checked: false } });
  await flush();
  const kept = { carried: [{ d: 'y', label: 'a group' }], notCarried: [], superseded: [] };
  d1.res({ wrote: true, carry: kept, next: [DELEGATE, OTHER_STEW] }); await flush();
  const t1 = timers.filter(t => t.ms === 8000).length;
  d2.res({ wrote: true, carry: kept, next: [DELEGATE, OTHER_STEW] }); await flush();
  const eights = timers.filter(t => t.ms === 8000);
  assert.ok(t1 >= 1 && eights.length >= 2, 'each note did not get its own 8 s deadline: ' + eights.length);
  eights[0].fn();   // the FIRST note's deadline passes
  const said = reads(p.view());
  assert.doesNotMatch(said, /Tom Ridley: Everything they set up/, 'the first all-kept line outlived its own 8 s');
  assert.match(said, /Ann Other: Everything they set up/, 'the second line was cleared by the first one’s deadline');
});

// ══ ROUND 6 (audit of round 5) ══════════════════════════════════════════════════════════════════════════════════════
test('round 6 — Reconnect: an UNCHECKED group says "check whether they should be on it", never "add them"', async () => {
  const said = await reconnectDone({ carried: [], notCarried: [], superseded: ['trinityone/group:g'], swapped: [], swapFailed: [], swapOther: [], swapUnchecked: ['the group “Youth”'] });
  assert.match(said, /Couldn’t check the group “Youth” — open Groups and check whether they should be on it\./);
  assert.doesNotMatch(said, /Couldn’t put their new key on the group “Youth”/, 'an unchecked group was worded as one they were known to be on');
  assert.doesNotMatch(said, /Ordinary groups need nothing/);
  const failed = await reconnectDone({ carried: [], notCarried: [], superseded: ['trinityone/group:g'], swapped: [], swapFailed: ['the group “Choir”'], swapOther: [], swapUnchecked: [] });
  assert.match(failed, /Couldn’t put their new key on the group “Choir” — open Groups and add them\./, 'CONTROL: the known-needed wording changed');
});

test('round 6 — Block of a steward: the row says "Blocking… keeping what they set up" while it runs, and a second press is ignored', async () => {
  const d = deferred();
  const r = blockRig({ stewards: [BRAM], carry: () => d.p });
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
  await press(draw(C, {}), /Remove \/ block this member/, { which: 0 });
  const confirm = find(draw(C, {}), n => n && n.type === 'button' && /Confirm — bans them/.test(String(n.props.title || '')))[0];
  assert.ok(confirm, 're-anchor: no confirm');
  confirm.props.onClick(); confirm.props.onClick();   // a double press on the same (stale) control
  await flush();
  assert.equal(r.order.filter(s => s.step === 'carry').length, 1, 'a second press started a second carry');
  const said = reads(draw(C, {}));
  assert.match(said, /Blocking… keeping what they set up/, 'no in-flight state while the carry runs');
  assert.equal(find(draw(C, {}), n => n && n.type === 'button' && /Confirm — bans them/.test(String(n.props.title || ''))).length, 0, 'the confirm is still offered while the block runs');
  d.res({ carried: [{ d: 'g', label: 'a group' }], notCarried: [], superseded: [] });
  await flush(30);
  assert.equal(r.order.filter(s => s.step === 'block').length, 1, 'the block was published more than once, or not at all');
  assert.doesNotMatch(reads(draw(C, {})), /Blocking…/, 'the in-flight line stayed after the block finished');
});


// ══ ROUND 7 (audit of round 6): the Block guard survives the tab unmounting; every Block control goes through it ═════
test('LOW-2 — Block in flight, Members tab closed and reopened: the row still says "Blocking…" and a press does nothing', async () => {
  const d = deferred();
  const r = blockRig({ stewards: [BRAM], carry: () => d.p });
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }], undefined, { unmounts: true });
  const Other = () => null;
  await press(draw(C, {}), /Remove \/ block this member/, { which: 0 });
  await press(draw(C, {}), /Confirm — bans them/);
  assert.equal(r.order.filter(s => s.step === 'carry').length, 1, 'CONTROL: the Block started');
  draw(Other, {});                 // another tab: DashMembers unmounts, its hooks are forgotten
  let tree = draw(C, {});          // back to Members: a fresh mount
  await flush(); tree = draw(C, {});
  assert.match(reads(tree), /Blocking… keeping what they set up/, 'after a remount the row forgot the Block in flight');
  assert.equal(find(tree, n => n && n.type === 'button' && /Remove \/ block this member|Confirm — bans them/.test(String(n.props.title || '')) && String(n.props.title || '')).length, 1,
    'CONTROL: only the other member’s Block control is offered');
  await press(tree, /Remove \/ block this member/, { which: 0 });   // the only one offered: Cleo's
  assert.equal(r.order.filter(s => s.step === 'carry' && s.pk === BRAM).length, 1, 'a second Block of the same person started after the remount');
  d.res({ carried: [{ d: 'g', label: 'a group' }], notCarried: [], superseded: [] });
  await flush(30);
  assert.doesNotMatch(reads(draw(C, {})), /Blocking…/, 'the in-flight line stayed after the block settled');
  assert.equal(r.order.filter(s => s.step === 'block').length, 1);
});

test('LOW-1 — the WAITING-LIST confirm goes through the guard: in-flight shown, a double press makes one Block', async () => {
  const d = deferred();
  const r = blockRig({ stewards: [BRAM], carry: () => d.p });
  r.g.window.useStewardJoinPolicy = () => true;
  r.g.window.useStewardAdmitted = () => [CLEO];   // Bram is waiting to be let in
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
  const decline = find(draw(C, {}), n => n && n.type === 'button' && /^Decline Bram/.test(String(n.props['aria-label'] || '')));
  assert.equal(decline.length, 1, 're-anchor: no waiting-list Decline for Bram');
  decline[0].props.onClick();
  const confirm = find(draw(C, {}), n => n && n.type === 'button' && /^Confirm: block Bram/.test(String(n.props['aria-label'] || '')));
  assert.equal(confirm.length, 1, 're-anchor: no waiting-list confirm');
  confirm[0].props.onClick(); confirm[0].props.onClick();
  await flush();
  assert.equal(r.order.filter(s => s.step === 'carry').length, 1, 'a double press on the waiting-list confirm started two Blocks');
  assert.match(reads(draw(C, {})), /Blocking… keeping what they set up/, 'the waiting-list row does not show the Block in flight');
  d.res({ carried: [], notCarried: [], superseded: [] }); await flush(30);
});

test('LOW-1 — the PHONE SHEET’s Block goes through the guard: in-flight shown, a double press makes one Block', async () => {
  const d = deferred();
  const r = blockRig({ stewards: [BRAM], carry: () => d.p });
  let sheet = null;
  r.g.StewMemberSheet = (p) => { sheet = p; return null; };   // the sheet is another file's component: what it is handed is what this measures
  r.g.useStewNarrow = () => true;   // a phone: the row offers ⋯ More, which opens the sheet
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
  await press(draw(C, {}), /More for Bram/, { which: 0 });
  draw(C, {});
  assert.ok(sheet, 're-anchor: the member sheet did not open');
  sheet.actions.find(a => a.key === 'block').onPick();   // "Remove / block" — asks to confirm
  draw(C, {});
  const blockIt = sheet.actions.find(a => a.key === 'block');
  assert.match(blockIt.label, /^Block /, 're-anchor: the sheet is not asking to confirm');
  blockIt.onPick(); blockIt.onPick();
  await flush();
  assert.equal(r.order.filter(s => s.step === 'carry').length, 1, 'a double press in the phone sheet started two Blocks');
  draw(C, {});
  assert.match(sheet.actions.find(a => a.key === 'block').label, /Blocking… keeping what they set up/, 'the phone sheet does not show the Block in flight');
  d.res({ carried: [], notCarried: [], superseded: [] }); await flush(30);
});
