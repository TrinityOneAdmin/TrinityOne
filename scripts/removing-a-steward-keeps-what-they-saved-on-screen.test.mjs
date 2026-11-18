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
