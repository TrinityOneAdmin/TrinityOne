// EVERY KEY PATH GIVES THE ROOM, CARE AND SERMON KEYS TO APPROVED MEMBERS ONLY — AND, WHEN THAT CANNOT BE TOLD YET,
// REFUSES OR ROTATES TO FEWER PEOPLE, NEVER TO SOMEONE STILL WAITING TO BE LET IN.
//   Run: node --test scripts/every-key-path-gives-keys-to-approved-members-only.test.mjs
//
// Round 3a of the room-key reconcile, HIGH 1 (audit of 244a6fe). The key distributor narrowed those keys to approved
// members in 78ffad0, but five other paths still wrapped them to everyone with a member document — and since round 2
// those keys only grow, so a pending member kept them:
//   Block (rotateChurchKeys' `remaining`), removing a delegate, a new open encrypted room, sealing one room, sealing
//   all of them, and the first sermon upload (mediaEncryptor).
// They now all ask ONE filter, stewKeyRecipients (app/stew-dashboard.jsx), with the distributor's freshness rules.
//
// THE POINT OF USE (rule 1): app/stew-dashboard.jsx is loaded WHOLE and each screen is rendered and driven through its
// own buttons; the engine records what it is asked to do. Nothing here matches text in the jsx (rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts, button } from './render-jsx-screen.mjs';

const MB = 'b'.repeat(64);     // an approved member (on the admitted list)
const MP = 'c'.repeat(64);     // a member still waiting for approval (member document, not admitted)
const BOB = 'e'.repeat(64);    // the person being blocked
const ST = 'd'.repeat(64);     // a delegated steward
const CH = 'a'.repeat(64);     // the church
const tick = () => new Promise(r => setTimeout(r, 0));

// approval: true / false / null (null = no genuine read of the policy yet); fresh: the blocked/admitted lists are fresh
function world({ approval = true, fresh = true } = {}) {
  const calls = [];
  const events = [];
  const stamp = new WeakSet();
  const lists = {
    members: [MB, MP, BOB].map((pubkey, i) => ({ pubkey, name: ['Mary', 'Pat', 'Bob'][i], joined: Math.floor(Date.now() / 1000) })),
    blocked: [], admitted: [MB, BOB], stewards: [ST],
    groups: [{ id: 'g-open', name: 'Prayer', kind: 'group', encrypted: false }],
  };
  for (const k of ['blocked', 'admitted', 'stewards', 'groups']) stamp.add(lists[k]);
  const rec = (name, ret) => (...a) => { calls.push({ name, a }); return Promise.resolve(typeof ret === 'function' ? ret(...a) : ret); };
  const Steward = {
    churchPub: CH, actingChurch: '', activePub: CH, npub: 'npub1x',
    listIsCurrent: (l) => stamp.has(l), listIsFresh: (l) => fresh && stamp.has(l),
    joinPolicyFresh: () => approval, groupFresh: () => true, groupKeyDropped: () => [],
    relayAuthed: () => true, keysSettingUp: () => false, nameKeyReady: () => true,
    createEncryptedGroup: rec('createEncryptedGroup', (g) => ({ ok: true, group: { ...g, id: 'new' }, skipped: [] })),
    sealGroup: rec('sealGroup', { sealed: true, skipped: [] }),
    setBlocked: rec('setBlocked', true), setStewards: rec('setStewards', true),
    rotateCareKey: rec('rotateCareKey', true), rotateMediaKey: rec('rotateMediaKey', true),
    ensureNameKeyForMembers: rec('ensureNameKeyForMembers', { rotated: true }), publishGroupKey: rec('publishGroupKey', true),
    publishGroup: rec('publishGroup', (g) => ({ ...g, ts: 1 })), publishProfile: rec('publishProfile', true),
    mediaEncryptor: rec('mediaEncryptor', () => async (b) => b),
    stewardName: () => 'Dee Delegate', stewardLabels: () => ({}), stewardCaps: () => ({}), blockedHere: () => [], identities: () => [], photoSuppressed: () => false,
  };
  const S = new Proxy(Steward, { get: (o, k) => (k in o ? o[k] : (typeof k === 'string' ? (...a) => { calls.push({ name: k, a }); return Promise.resolve(null); } : undefined)) });
  const hooks = {
    useStewardMembers: () => lists.members, useStewardBlocked: () => lists.blocked, useStewardAdmitted: () => lists.admitted,
    useStewardJoinPolicy: () => approval === true, useStewardStewards: () => lists.stewards, useStewardGroups: () => lists.groups,
    useStewardChurch: () => ({ name: 'St Aidan', features: { encryptComms: true } }), useStewardIdv: () => 0, useStewardConn: () => 0,
    useStewardSafeguard: () => ({ minors: [], approved: [], nophoto: [], minorsKnown: true }), useStewardGuardians: () => ({ links: {}, closed: {} }),
    useMealsSettings: () => ({}), useStewardRotaSettings: () => ({ visibility: 'church' }), useStewardUnavail: () => ({}), useStewardRsvps: () => ({}),
    useStewardPickableMembers: (from) => (from || lists.members),
  };
  const win = new Proxy({ Steward: S, dispatchEvent: (e) => { events.push(e); return true; }, addEventListener() {}, removeEventListener() {}, ...hooks }, {
    get: (o, k) => (k in o ? o[k] : (typeof k === 'string' && /^use[A-Z]/.test(k) ? () => [] : undefined)),
  });
  return { calls, events, lists, win, S };
}

const Nil = () => null;
const XFILE = { useStewDialog: () => ({ current: null }), Icon: Nil, SkToggle: Nil, SkPill: Nil, SkBadge: Nil, DismissibleNote: Nil, DashMealsPanel: Nil, StewHelpLink: Nil, SK_TINT: new Proxy({}, { get: () => ({}) }) };
function load(w) {
  const { React, draw } = miniReact();
  const store = new Map();
  const mod = loadScreen('app/stew-dashboard.jsx', ['stewKeyRecipients', 'stewKeyRecipientsOrAdmitted', 'NewGroupModal', 'DashGroups', 'DashMembers', 'DashStewardsPanel', 'DashFeaturesPanel', 'DashSermons', 'EditGroupMembersModal'], {
    React, window: w.win, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', querySelector: () => null, body: {} },
    navigator: { onLine: true, clipboard: { writeText: async () => {} } }, location: { href: '', hash: '', search: '' },
    // other files' globals the screens use — stubs: what is under test is which keys go to whom, not their look
    ...XFILE,
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = (i || {}).detail; } },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, WeakSet, WeakMap, console, Promise, Error, RegExp, Intl, Symbol, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  });
  return { mod, React, draw };
}

// ── the filter itself ────────────────────────────────────────────────────────────────────────────────────────────
test('the shared filter: approved only when it can tell; null when the policy, the blocklist or the admitted list is not fresh', () => {
  for (const [approval, fresh, want] of [[true, true, [MB, BOB]], [false, true, [MB, MP, BOB]], [null, true, null], [true, false, null], [false, false, null]]) {
    const w = world({ approval, fresh });
    const { mod } = load(w);
    const got = mod.stewKeyRecipients([MB, MP, BOB], w.lists.blocked, w.lists.admitted);
    assert.deepEqual(got && [...got].sort(), want && [...want].sort(), `approval=${approval} fresh=${fresh}`);
  }
  const w = world({ approval: true });
  const { mod } = load(w);
  w.lists.blocked.push(BOB);
  assert.deepEqual(mod.stewKeyRecipients([MB, MP, BOB], w.lists.blocked, w.lists.admitted), [MB], 'a blocked person passed the filter');
  const u = world({ approval: null });
  assert.deepEqual(load(u).mod.stewKeyRecipientsOrAdmitted([MB, MP, BOB], u.lists.blocked, u.lists.admitted).sort(), [MB, BOB].sort(),
    'the fallback for an action that cannot wait included someone not on the admitted list');
});

// ── 1. a new OPEN encrypted room (NewGroupModal.create) ─────────────────────────────────────────────────────────────
async function newRoom(w) {
  w.lists.groups.length = 0;                       // no unsealed room: the encrypt box starts ticked
  const { mod, draw } = load(w);
  const props = { open: true, onClose() {} };
  let tree = draw(mod.NewGroupModal, props);
  const name = find(tree, n => n.type === 'input' && n.props && n.props['aria-label'] === 'Name')[0];
  assert.ok(name, 're-anchor: the New group dialog has no Name box');
  name.props.onChange({ target: { value: 'Prayer' } });
  tree = draw(mod.NewGroupModal, props);
  const b = button(tree, 'Create group')[0];
  assert.ok(b, 're-anchor: no Create group button');
  b.props.onClick();
  for (let i = 0; i < 5; i++) await tick();
  return { tree: draw(mod.NewGroupModal, props) };
}
test('a new OPEN encrypted room is keyed to the APPROVED members only', async () => {
  const w = world({ approval: true });
  await newRoom(w);
  const c = w.calls.filter(x => x.name === 'createEncryptedGroup');
  assert.equal(c.length, 1, 'CONTROL: the room was not created');
  assert.deepEqual([...c[0].a[1]].sort(), [MB, BOB].sort(), 'A NEW OPEN ROOM\'S KEY WAS WRAPPED TO A MEMBER STILL WAITING FOR APPROVAL');
});
test('…and while approval cannot be told, nothing is created and the dialog says why', async () => {
  const w = world({ approval: null });
  const { tree } = await newRoom(w);
  assert.equal(w.calls.filter(x => x.name === 'createEncryptedGroup').length, 0, 'a room was created and keyed before the join policy was read');
  assert.match(texts(tree).join(' '), /still loading/, 'the dialog did not say why nothing was made');
});

// ── 2. sealing ONE open room (DashGroups.doSeal) ────────────────────────────────────────────────────────────────────
async function sealOne(w) {
  const { mod, draw } = load(w);
  let tree = draw(mod.DashGroups, {});
  // PHASE 1 (2026-10-19): the encrypt control moved off the row into the group-settings panel. Open the panel
  // from the row's settings gear, then flip its encryption checkbox — it runs the same toggleEncrypt → confirm.
  const gear = find(tree, n => n.type === 'button' && /^Settings for /.test((n.props || {})['aria-label'] || ''))[0];
  assert.ok(gear, 're-anchor: no settings gear on the room row to open the panel');
  gear.props.onClick();
  tree = draw(mod.DashGroups, {});
  const enc = find(tree, n => n.type === 'input' && (n.props || {}).type === 'checkbox' && /Press to seal it/.test((n.props || {})['aria-label'] || ''))[0];
  assert.ok(enc, 're-anchor: no Encrypt control in the settings panel');
  enc.props.onChange();
  tree = draw(mod.DashGroups, {});
  const ok = button(tree, 'Seal it')[0];
  assert.ok(ok, 're-anchor: the seal confirmation did not open');
  await ok.props.onClick();
  for (let i = 0; i < 5; i++) await tick();
  return draw(mod.DashGroups, {});
}
test('sealing one OPEN room keys it to the APPROVED members only', async () => {
  const w = world({ approval: true });
  await sealOne(w);
  const c = w.calls.filter(x => x.name === 'sealGroup');
  assert.equal(c.length, 1, 'CONTROL: the room was not sealed');
  assert.deepEqual([...c[0].a[1]].sort(), [MB, BOB].sort(), 'SEALING A ROOM WRAPPED ITS KEY TO A MEMBER STILL WAITING FOR APPROVAL');
});
test('…and while approval cannot be told, it is not sealed and the dialog says why', async () => {
  const w = world({ approval: null });
  const tree = await sealOne(w);
  assert.equal(w.calls.filter(x => x.name === 'sealGroup').length, 0, 'a room was sealed before the join policy was read');
  assert.match(texts(tree).join(' '), /still loading/, 'the dialog did not say why nothing was sealed');
});

// ── 3. sealing ALL rooms (DashFeaturesPanel.doEncryptAll) ───────────────────────────────────────────────────────────
async function sealAll(w) {
  const { mod, draw } = load(w);
  const props = { church: { name: 'St Aidan', features: {} } };
  let tree = draw(mod.DashFeaturesPanel, props);
  const sw = find(tree, n => n.type === 'button' && (n.props || {})['aria-label'] === 'Toggle encrypt all group chat')[0];
  assert.ok(sw, 're-anchor: no encrypt-all switch');
  sw.props.onClick({ stopPropagation() {} });
  tree = draw(mod.DashFeaturesPanel, props);
  const ok = button(tree, 'Encrypt all').filter(n => (n.props || {})['aria-label'] !== 'Toggle encrypt all group chat')[0];
  assert.ok(ok, 're-anchor: the encrypt-all confirmation did not open');
  await ok.props.onClick();
  for (let i = 0; i < 5; i++) await tick();
}
test('sealing ALL rooms keys each open room to the APPROVED members only', async () => {
  const w = world({ approval: true });
  await sealAll(w);
  const c = w.calls.filter(x => x.name === 'sealGroup');
  assert.equal(c.length, 1, 'CONTROL: the open room was not sealed');
  assert.deepEqual([...c[0].a[1]].sort(), [MB, BOB].sort(), '"ENCRYPT ALL" WRAPPED A ROOM KEY TO A MEMBER STILL WAITING FOR APPROVAL');
});
test('…and while approval cannot be told, nothing is sealed and the steward is told', async () => {
  const w = world({ approval: null });
  await sealAll(w);
  assert.equal(w.calls.filter(x => x.name === 'sealGroup').length, 0, 'rooms were sealed before the join policy was read');
  assert.ok(w.events.some(e => e.type === 'steward-write-blocked' && /still loading/.test(e.detail.message)), 'the steward was not told why nothing was sealed');
});

// ── 4. Block (DashMembers.block → rotateChurchKeys) ─────────────────────────────────────────────────────────────────
async function block(w) {
  w.lists.groups.length = 0; w.lists.groups.push({ id: 'g-open', name: 'Prayer', kind: 'group', encrypted: true });
  const { mod, draw } = load(w);
  let tree = draw(mod.DashMembers, {});
  // Bob's row: the "Remove / block" control that comes before the "Mark as a child: Bob" one
  const bs = find(tree, n => n.type === 'button');
  const bobAt = bs.findIndex(n => ((n.props || {})['aria-label'] || '') === 'Mark as a child: Bob');
  const ask = bs.slice(0, bobAt).reverse().find(n => /Remove \/ block this member/.test(texts(n).join(' ')));
  assert.ok(bobAt > 0 && ask, 're-anchor: no Remove / block control on Bob\'s row');
  ask.props.onClick();
  tree = draw(mod.DashMembers, {});
  const ok = find(tree, n => n.type === 'button' && /^Confirm/.test(texts(n).join(' ').trim()))[0];
  assert.ok(ok, 're-anchor: the Block confirmation did not appear');
  ok.props.onClick();
  for (let i = 0; i < 8; i++) await tick();
}
const rotatedTo = (w, name) => (w.calls.find(x => x.name === name) || { a: [null] }).a[0];
test('Block rotates the care, sermon and room keys to the APPROVED members — never one still waiting', async () => {
  const w = world({ approval: true });
  await block(w);
  assert.ok(w.calls.some(x => x.name === 'setBlocked'), 'CONTROL: the block was not written');
  assert.deepEqual(rotatedTo(w, 'rotateCareKey'), [MB], 'BLOCK ROTATED THE CARE KEY TO A MEMBER STILL WAITING FOR APPROVAL');
  assert.deepEqual(rotatedTo(w, 'rotateMediaKey'), [MB], 'Block rotated the sermon key to a member still waiting');
  const room = w.calls.find(x => x.name === 'publishGroupKey');
  assert.ok(room, 'CONTROL: the open room was not rotated');
  assert.ok(!room.a[1].includes(MP), 'Block rotated the ROOM key to a member still waiting');
  assert.ok(room.a[1].includes(ST), 'LOW-MED: Block rotated the open room without the steward roster — a delegate who is not a member loses it');
});
test('…and while approval cannot be told, Block still rotates — to the admitted members only (fewer, never a pending one)', async () => {
  const w = world({ approval: null });
  await block(w);
  assert.ok(w.calls.some(x => x.name === 'setBlocked'), 'a Block must not wait for a list');
  assert.deepEqual(rotatedTo(w, 'rotateCareKey'), [MB], 'with approval unknown, Block rotated the care key to someone not on the admitted list');
});

// ROUND 3c, HIGH 1 (audit of 432c676). 3a narrowed Block's whole list to the approved members, and that list also fed the
// NAME key rotation — a member waiting for approval lost the name key they need to seal their name for the queue
// (a-blocked-member-this-console-remembers-stays-blocked went red). And with approval unknown the list became the
// admitted list alone: in an open-join church that is nobody, so care, sermon and rooms were rotated to the church
// alone and every phone deleted its key. Now: the name key goes to everyone who stays; the other three keep every
// current holder who passes `keepIf`.
const optsOf = (w, name) => (w.calls.find(x => x.name === name) || { a: [] }).a[2];
test('Block: the NAME key still goes to a member waiting for approval — only the blocked person leaves it', async () => {
  for (const approval of [true, null]) {
    const w = world({ approval });
    await block(w);
    const to = rotatedTo(w, 'ensureNameKeyForMembers');
    assert.ok(to, 'CONTROL: the name key was not rotated');
    assert.ok(to.includes(MP), `approval=${approval}: BLOCK TOOK THE NAME KEY FROM A MEMBER WAITING FOR APPROVAL — they cannot seal their name for the queue`);
    assert.ok(to.includes(MB) && !to.includes(BOB), `approval=${approval}: the name key went to the blocked person, or not to an approved member`);
  }
});
test('Block: every current holder of the care, sermon and open-room keys keeps them — approval known: the approved; unknown: everyone but the blocked', async () => {
  for (const [approval, mp] of [[true, false], [null, true]]) {
    const w = world({ approval });
    await block(w);
    for (const name of ['rotateCareKey', 'rotateMediaKey', 'publishGroupKey']) {
      const o = optsOf(w, name);
      assert.ok(o && typeof o.keepIf === 'function', `approval=${approval}: ${name} WAS GIVEN NO keepIf — a rotation to a partial list takes the key off every holder it misses`);
      assert.equal(o.keepIf(MB), true, `approval=${approval}: ${name} would take the key off an APPROVED holder`);
      assert.equal(o.keepIf(BOB), false, `approval=${approval}: ${name} would keep the key for the person being BLOCKED`);
      assert.equal(o.keepIf(MP), mp, `approval=${approval}: ${name} kept=${!mp} a holder waiting for approval`);
    }
  }
});
test('Block: with approval unknown in an OPEN-JOIN church nobody admitted, the rotation is not to the church alone', async () => {
  const w = world({ approval: null });
  w.lists.admitted.length = 0;                     // an open-join church: nobody is on the admitted list
  await block(w);
  const o = optsOf(w, 'rotateCareKey');
  assert.ok(o && o.keepIf(MB) && o.keepIf(MP), 'AN OPEN-JOIN CHURCH WHOSE POLICY HAD NOT LOADED HAD EVERY MEMBER\'S CARE KEY ROTATED AWAY');
});

// ── 5. removing a delegate (DashStewardsPanel.remove → rotateChurchKeys) ────────────────────────────────────────────
async function removeDelegate(w) {
  const { mod, draw } = load(w);
  const props = { church: { name: 'St Aidan', features: {} } };
  let tree = draw(mod.DashStewardsPanel, props);
  const ask = find(tree, n => n.type === 'button' && /^Revoke this steward/.test(texts(n).join(' ').trim()))[0];
  assert.ok(ask, 're-anchor: no Revoke control for the delegate');
  ask.props.onClick();
  tree = draw(mod.DashStewardsPanel, props);
  const ok = find(tree, n => n.type === 'button' && /^Confirm — revoke/.test(texts(n).join(' ').trim()))[0];
  assert.ok(ok, 're-anchor: the removal confirmation did not appear');
  ok.props.onClick();
  for (let i = 0; i < 8; i++) await tick();
}
test('removing a delegate rotates the keys to the APPROVED members — never one still waiting', async () => {
  const w = world({ approval: true });
  await removeDelegate(w);
  assert.ok(w.calls.some(x => x.name === 'setStewards'), 'CONTROL: the roster was not written');
  assert.deepEqual([...rotatedTo(w, 'rotateCareKey')].sort(), [MB, BOB].sort(), 'REMOVING A DELEGATE ROTATED THE CARE KEY TO A MEMBER STILL WAITING');
});

test('removing a delegate: the NAME key still goes to a member waiting; the removed delegate keeps no other key as a holder', async () => {
  const w = world({ approval: true });
  await removeDelegate(w);
  const to = rotatedTo(w, 'ensureNameKeyForMembers');
  assert.ok(to && to.includes(MP), 'REMOVING A DELEGATE TOOK THE NAME KEY FROM A MEMBER WAITING FOR APPROVAL');
  const o = optsOf(w, 'rotateCareKey');
  assert.ok(o && typeof o.keepIf === 'function', 'removing a delegate gave the care rotation no keepIf');
  assert.equal(o.keepIf(ST), false, 'THE REMOVED DELEGATE WOULD KEEP THE CARE KEY AS A CURRENT HOLDER');
  assert.equal(o.keepIf(MB), true, 'an approved holder would lose the care key when a delegate is removed');
});

// ── 6. the first sermon upload (DashSermons.doUpload → mediaEncryptor, which MINTS the sermon key) ──────────────────
async function upload(w) {
  const { mod, draw } = load(w);
  let tree = draw(mod.DashSermons, {});
  const input = find(tree, n => n.type === 'input' && (n.props || {}).type === 'file')[0];
  assert.ok(input, 're-anchor: no file input on the Sermons screen');
  const file = { name: 'sunday.mp3', size: 1000, type: 'audio/mpeg', lastModified: 1, arrayBuffer: async () => new ArrayBuffer(8), slice() { return this; } };
  await input.props.onChange({ target: { files: [file], value: '' } });
  for (let i = 0; i < 3; i++) await tick();
  tree = draw(mod.DashSermons, {});
  const sheet = find(tree, n => n && n.props && typeof n.props.onSave === 'function')[0];
  assert.ok(sheet, 're-anchor: the upload sheet did not open');
  try { await sheet.props.onSave({ title: 'Sunday' }); } catch (e) { /* the stubbed blob upload ends the flow; mediaEncryptor is called before it */ }
  for (let i = 0; i < 3; i++) await tick();
}
test('the first sermon upload mints the sermon key for the APPROVED members only', async () => {
  const w = world({ approval: true });
  await upload(w);
  const c = w.calls.filter(x => x.name === 'mediaEncryptor');
  assert.equal(c.length, 1, 'CONTROL: the upload did not ask for the sermon key');
  assert.deepEqual([...c[0].a[0]].sort(), [MB, BOB].sort(), 'THE SERMON KEY WAS MINTED FOR A MEMBER STILL WAITING FOR APPROVAL');
});
test('…and while approval cannot be told, only for the admitted members (fewer, never a pending one)', async () => {
  const w = world({ approval: null });
  await upload(w);
  const c = w.calls.filter(x => x.name === 'mediaEncryptor');
  assert.equal(c.length, 1, 'CONTROL: the upload did not ask for the sermon key');
  assert.ok(!c[0].a[0].includes(MP), 'with approval unknown, the sermon key was minted for someone not on the admitted list');
});

// ── MED (round 3a): the edit-members dialog must not rotate a room over a member list that did not save ────────────
// With the list unsaved, the relay still names the person taken out, and round 2's hold re-reads exactly that list and
// re-adds them. So: no rotation, and the dialog stays open saying so.
async function editMembers(w, saved) {
  const { mod, draw } = load(w);
  const group = { id: 'g-lead', name: 'Leaders', kind: 'group', visibility: 'invite', encrypted: true, members: [MB, BOB] };
  w.S.publishGroup = (g) => { w.calls.push({ name: 'publishGroup', a: [g] }); return Promise.resolve(saved ? { ...g, ts: 1 } : null); };
  const props = { group, getCurrent: () => group, onClose() { w.calls.push({ name: 'closed', a: [] }); } };
  let tree = draw(mod.EditGroupMembersModal, props);
  const bob = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Bob'))[0];
  assert.ok(bob, 're-anchor: Bob is not listed in the dialog');
  bob.props.onClick();                              // take Bob out
  tree = draw(mod.EditGroupMembersModal, props);
  const save = find(tree, n => n.type === 'button' && String((n.props || {}).className || '').includes('sk-btn--clay'))[0];
  await save.props.onClick();
  for (let i = 0; i < 8; i++) await tick();
  return draw(mod.EditGroupMembersModal, props);
}
test('taking someone out of a room: the key rotates only once the room\'s member list has saved', async () => {
  const ok = world({ approval: true });
  await editMembers(ok, true);
  const k = ok.calls.filter(x => x.name === 'publishGroupKey');
  assert.equal(k.length, 1, 'CONTROL: a saved removal did not rotate the room key');
  assert.equal(k[0].a[2] && k[0].a[2].rotate, true, 'CONTROL: the removal did not rotate');
  const bad = world({ approval: true });
  const tree = await editMembers(bad, false);
  assert.equal(bad.calls.filter(x => x.name === 'publishGroupKey').length, 0,
    'THE ROOM KEY WAS ROTATED OVER A MEMBER LIST THAT DID NOT SAVE — the relay still lists the person, and the hold re-adds them');
  assert.ok(!bad.calls.some(x => x.name === 'closed'), 'the dialog closed as if it had worked');
  assert.match(texts(tree).join(' '), /wasn’t saved/, 'the steward was not told the list did not save');
});

// …and the same in the team roster editor (RosterModal, app/stew-schedule.jsx), whose Save keeps an invite-only team's
// room list in step with the roster and rotates its key when someone is taken off.
async function teamSave(saved) {
  const { React, draw } = miniReact();
  const calls = [];
  const team = { id: 't-welcome', name: 'Welcome', kind: 'team', visibility: 'invite', encrypted: true, members: [MB, BOB] };
  const win = {
    useStewardBlocked: () => [], useMealsSettings: () => ({ adminGroupId: '' }), StewardMeals: {},
    Steward: {
      publishRoster: async () => true,
      publishGroup: async (g) => { calls.push({ name: 'publishGroup', a: [g] }); return saved ? { ...g, ts: 1 } : null; },
      publishGroupKey: async (...a) => { calls.push({ name: 'publishGroupKey', a }); return true; },
    },
  };
  const mod = loadScreen('app/stew-schedule.jsx', ['RosterModal'], {
    React, window: win, Icon: () => null, useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-12',
    document: { addEventListener() {}, removeEventListener() {} },
  });
  const props = { team, roster: { roles: [], people: [{ id: 'p1', name: 'Mary', pub: MB }, { id: 'p2', name: 'Bob', pub: BOB }], pods: [] },
    members: [{ pubkey: MB, name: 'Mary' }, { pubkey: BOB, name: 'Bob' }], onClose() { calls.push({ name: 'closed', a: [] }); } };
  let tree = draw(mod.RosterModal, props);
  const off = find(tree, n => n.type === 'button' && (n.props || {})['aria-label'] === 'Remove Bob from the team')[0];
  assert.ok(off, 're-anchor: no control to take Bob off the team');
  off.props.onClick();
  tree = draw(mod.RosterModal, props);
  const save = find(tree, n => n.type === 'button' && String((n.props || {}).className || '').includes('sk-btn--clay'))[0];
  await save.props.onClick();
  for (let i = 0; i < 8; i++) await tick();
  return { calls, tree: draw(mod.RosterModal, props) };
}
test('the team roster editor: the room key rotates only once the room\'s member list has saved', async () => {
  const ok = await teamSave(true);
  assert.equal(ok.calls.filter(x => x.name === 'publishGroupKey').length, 1, 'CONTROL: a saved removal did not rotate the team room\'s key');
  const bad = await teamSave(false);
  assert.equal(bad.calls.filter(x => x.name === 'publishGroupKey').length, 0, 'THE TEAM ROOM\'S KEY WAS ROTATED OVER A MEMBER LIST THAT DID NOT SAVE');
  assert.match(texts(bad.tree).join(' '), /wasn’t, so the room’s key was not changed/, 'the steward was not told');
});

// ROUND 3c, LOW iii (audit of 432c676): the lists can go stale part-way through "Encrypt all" (a reconnect closes the
// subscriptions the shared filter reads). encRecips() then answered null, and sealGroup(g, null) sealed the room to the
// church and its stewards alone — the congregation locked out of it. The sweep now stops sealing there, names what it
// did not seal, and leaves "Encrypt all" off.
test('sealing ALL rooms: if the member list goes stale part-way, the rest are NOT sealed to nobody — they are left, and named', async () => {
  const w = world({ approval: true });
  w.lists.groups.push({ id: 'g-two', name: 'Youth', kind: 'group', encrypted: false });
  const realSeal = w.S.sealGroup;
  w.S.sealGroup = (...a) => { const r = realSeal(...a); w.S.listIsFresh = () => false; return r; };   // a reconnect, just after the first room
  await sealAll(w);
  const c = w.calls.filter(x => x.name === 'sealGroup');
  assert.equal(c.length, 1, 'CONTROL: the first room was not sealed, or the second was');
  assert.ok(c.every(x => Array.isArray(x.a[1]) && x.a[1].length), 'A ROOM WAS SEALED TO NOBODY (null recipients) — the church and stewards alone');
  const said = w.events.filter(e => e.type === 'steward-write-blocked').map(e => e.detail.message).join(' ');
  assert.match(said, /still loading/, 'the steward was not told some rooms were not sealed');
  assert.match(said, /Youth/, 'the room left unsealed was not named');
  assert.ok(!w.calls.some(x => x.name === 'publishProfile'), '"Encrypt all" was switched on though a room was left unsealed');
});

// ROUND 3c, LOW ii (audit of 432c676): the seal dialog's and the room-member dialog's 8 s "Couldn't reach the relay"
// timer ran while the room's key publish was still waiting for a background re-key already in flight (round 3a's
// one-at-a-time queue), and said the relay was unreachable when it was not. The 8 s now starts on the publish's own
// turn (`onTurn`); a 30 s bound covers a turn that never comes. Read off the timers the dialog arms.
async function withTimers(fn) {
  const real = globalThis.setTimeout, armed = [];
  globalThis.setTimeout = (f, ms, ...a) => { armed.push(ms); return real(f, Math.min(ms || 0, 1), ...a) && 0; };
  try { await fn(); } finally { globalThis.setTimeout = real; }
  return armed;
}
test('LOW ii: the seal dialog starts its 8 s only when the key publish\'s turn comes — never while it waits', async () => {
  for (const turns of [false, true]) {
    const w = world({ approval: true });
    w.S.sealGroup = (g, rc, o) => { w.calls.push({ name: 'sealGroup', a: [g, rc, o] }); if (turns && o && o.onTurn) o.onTurn(); return Promise.resolve({ sealed: true, skipped: [] }); };   // the turn came (or did not) before it answered
    const armed = await withTimers(() => sealOne(w));
    const c = w.calls.find(x => x.name === 'sealGroup');
    assert.ok(c && c.a[2] && typeof c.a[2].onTurn === 'function', 'the seal dialog gave the key publish no onTurn');
    assert.ok(armed.includes(30000), 'CONTROL: no outer bound was armed');
    assert.equal(armed.includes(8000), turns, turns ? 'the 8 s was not armed when the turn came' : 'THE 8 s WAS ARMED WHILE THE KEY PUBLISH WAS STILL WAITING ITS TURN — "couldn\'t reach the relay" over a queue');
  }
});
test('LOW ii: the room-member dialog pauses its 8 s while the key publish waits its turn, and re-arms it on the turn', async () => {
  const w = world({ approval: true });
  let opts = null;
  w.S.publishGroupKey = (gid, recips, o) => { opts = o; w.calls.push({ name: 'publishGroupKey', a: [gid, recips, o] }); return Promise.resolve(true); };
  await withTimers(() => editMembers(w, true));
  assert.ok(opts && opts.rotate === true && typeof opts.onTurn === 'function', 'the room-member dialog gave the key publish no onTurn (or did not rotate)');
});

// ROUND 3d, LOW 1 (audit of 0f5cd2d): THE PAUSE ITSELF, RUN. The row above only checks that onTurn is handed over;
// removing keyQueued() — the line that stops the 8 s while the key publish waits its turn — left it green. This runs the
// dialog's Save under a hand-driven clock: the key publish is held, unstarted, for 9 s and the dialog must NOT say
// "Couldn't reach the relay"; then its turn comes, and 9 s later it must (the control that the clock is live).
test('LOW 1: the room-member dialog says nothing while the key publish waits its turn — and does once its turn has run 8 s', async () => {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  let now = 0, seq = 0; const due = new Map();
  globalThis.setTimeout = (fn, ms, ...a) => { if (!ms) return realSet(fn, 0, ...a); const id = 'f' + (++seq); due.set(id, { at: now + ms, fn }); return id; };
  globalThis.clearTimeout = (id) => { if (typeof id === 'string') due.delete(id); else realClear(id); };
  const advance = (ms) => { now += ms; for (const [id, t] of [...due]) if (t.at <= now) { due.delete(id); t.fn(); } };
  try {
    const w = world({ approval: true });
    const { mod, draw } = load(w);
    const group = { id: 'g-lead', name: 'Leaders', kind: 'group', visibility: 'invite', encrypted: true, members: [MB, BOB] };
    w.S.publishGroup = (g) => Promise.resolve({ ...g, ts: 1 });
    let opts = null;
    w.S.publishGroupKey = (gid, recips, o) => { opts = o; return new Promise(() => {}); };   // waiting its turn
    const props = { group, getCurrent: () => group, onClose() {} };
    let tree = draw(mod.EditGroupMembersModal, props);
    find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Bob'))[0].props.onClick();
    tree = draw(mod.EditGroupMembersModal, props);
    find(tree, n => n.type === 'button' && String((n.props || {}).className || '').includes('sk-btn--clay'))[0].props.onClick();
    for (let i = 0; i < 8; i++) await tick();
    assert.ok(opts && typeof opts.onTurn === 'function', 'CONTROL: the key publish was not reached, or was given no onTurn');
    advance(9000);
    tree = draw(mod.EditGroupMembersModal, props);
    assert.doesNotMatch(texts(tree).join(' '), /reach the relay/, 'THE DIALOG SAID "COULDN\'T REACH THE RELAY" WHILE THE KEY PUBLISH WAS ONLY WAITING ITS TURN');
    opts.onTurn();
    advance(9000);
    tree = draw(mod.EditGroupMembersModal, props);
    assert.match(texts(tree).join(' '), /reach the relay/, 'CONTROL: 9 s into its own turn, the dialog still said nothing — the clock is not driving it');
  } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
});

// ROUND 3d, LOW 2 (audit of 0f5cd2d): THE HOLDER FLOOR LETS GO OF SOMEONE WHO HAS LEFT — once the member list can say so.
// 3c kept every current holder through a Block (approval off or unknown), so someone who had LEFT the church kept every
// rotated key (DOMAIN 2026-09-30: they cannot read anything sealed after they left). With the member list FRESH, a holder
// not on it is let go; while it is not, the floor stands and a cold console loses nobody.
const LEFT = 'f'.repeat(64);   // held the keys; has since left — no longer on the member list
test('LOW 2: with the member list FRESH, Block and Remove let go of a holder who has left — and with it not fresh, keep them (the floor)', async () => {
  for (const [what, run] of [['Block', block], ['Remove', removeDelegate]]) {
    for (const approval of [false, null]) {
      for (const membersFresh of [true, false]) {
        const w = world({ approval });
        if (membersFresh) { const real = w.S.listIsFresh; w.S.listIsFresh = (l) => l === w.lists.members || real(l); }
        await run(w);
        const o = optsOf(w, 'rotateCareKey');
        assert.ok(o && typeof o.keepIf === 'function', `${what}: CONTROL — no keepIf`);
        assert.equal(o.keepIf(MB), true, `${what} approval=${approval} fresh=${membersFresh}: an approved member who stays lost the key`);
        assert.equal(o.keepIf(LEFT), !membersFresh, membersFresh
          ? `${what} approval=${approval}: SOMEONE WHO HAS LEFT KEPT THE ROTATED KEY though the member list was a genuine read without them`
          : `${what} approval=${approval}: with the member list NOT fresh, a holder was dropped — a cold console must lose nobody`);
      }
    }
  }
});

// ROUND 3e, MED 1 (audit of b102dc6): BLOCK DURING THE KEY READ — THE SCREEN SAYS WHAT IS TRUE, AND FINISHES THE STORY.
// A rotation waiting for its key read is not a failure: Block says the access "will be removed as soon as this console
// finishes connecting", then "Done" when the engine reports it ran. A rotation that really failed says so, with
// "Try again" — never "try blocking them again" (the person is on the Blocked list, which offers only Unblock) nor
// "grown past what one key document can hold" (almost never the cause).
// ROUND 3g: the banner reads Steward.rotationStatus(pk) and re-reads it on `steward-rotations`. The stub engine below keeps
// a status the way the real one does (a waiting rotation → "waiting"; a remembered failure → "failed"), so these rows test
// the SCREEN's words for each state; the states themselves are produced by the real runner in
// key-reads-settle-only-for-the-church-they-asked-about and in browser row J of a-room-key-reaches-….
function withStatus(w) {
  const st = {};   // pk -> { waiting, failed, done, cleared, member, gone, owner }
  const of = (pk) => (st[pk] = st[pk] || { waiting: [], failed: [], done: [], cleared: [], member: [], gone: [], owner: [] });
  w.S.rotationStatus = (pk) => of(pk);
  w.S.rememberRotation = (kind, drop, why, failed) => { w.calls.push({ name: 'rememberRotation', a: [kind, drop, why, failed] }); for (const pk of drop) { const o = of(pk); if (failed) o.failed.push(kind); else o.waiting.push(kind); } };
  const pendingFor = (kind) => (...a) => { w.calls.push({ name: kind === 'care' ? 'rotateCareKey' : 'rotateMediaKey', a }); for (const pk of (a[2] && a[2].drop) || []) of(pk).waiting.push(kind); return Promise.resolve({ pending: true }); };
  return { of, pendingFor };
}
async function blockShown(w) {
  w.lists.groups.length = 0; w.lists.groups.push({ id: 'g-open', name: 'Prayer', kind: 'group', encrypted: true });
  const listeners = {};
  w.win.addEventListener = (t, f) => { (listeners[t] = listeners[t] || []).push(f); };
  w.win.removeEventListener = () => {};
  const { mod, draw } = load(w);
  let tree = draw(mod.DashMembers, {});
  const bs = find(tree, n => n.type === 'button');
  const bobAt = bs.findIndex(n => ((n.props || {})['aria-label'] || '') === 'Mark as a child: Bob');
  bs.slice(0, bobAt).reverse().find(n => /Remove \/ block this member/.test(texts(n).join(' '))).props.onClick();
  tree = draw(mod.DashMembers, {});
  find(tree, n => n.type === 'button' && /^Confirm/.test(texts(n).join(' ').trim()))[0].props.onClick();
  for (let i = 0; i < 10; i++) await tick();
  const fire = (t, detail) => { for (const f of (listeners[t] || [])) f({ detail }); };
  return { said: () => texts(draw(mod.DashMembers, {})).join(' '), fire, tree: () => draw(mod.DashMembers, {}) };
}
test('3e MED 1: a Block whose care key is WAITING for its read says so truthfully — and then "Done" when it has run', async () => {
  const w = world({ approval: true });
  const ws = withStatus(w);
  w.S.rotateCareKey = ws.pendingFor('care');
  const v = await blockShown(w);
  assert.match(v.said(), /will be removed as soon as this console finishes connecting/, 'a WAITING rotation was not said as waiting: ' + v.said().slice(0, 300));
  assert.doesNotMatch(v.said(), /Try blocking them again|grown past/, 'THE SCREEN TOLD THE STEWARD TO BLOCK AGAIN (impossible) OR BLAMED THE CHURCH\'S SIZE');
  assert.deepEqual(rotatedTo(w, 'rotateCareKey') && w.calls.find(x => x.name === 'rotateCareKey').a[2].drop, [BOB], 'the rotation was not told whom it takes out — it could not be remembered for later');
  ws.of(BOB).waiting = []; ws.of(BOB).done = ['care'];      // the engine ran it
  v.fire('steward-rotations');
  assert.match(v.said(), /Done — they can no longer open anything sealed/, 'the screen never said the waiting rotation had run');
});
test('3g: the screen says a TRUE thing when nothing was rotated — unblocked elsewhere, still a member, or a room gone', async () => {
  const w = world({ approval: true });
  const ws = withStatus(w);
  w.S.rotateCareKey = ws.pendingFor('care');
  const v = await blockShown(w);
  ws.of(BOB).waiting = []; ws.of(BOB).cleared = ['care']; ws.of(BOB).gone = ['room:g-open'];
  v.fire('steward-rotations');
  const said = v.said();
  assert.doesNotMatch(said, /Done — they can no longer open/, 'THE SCREEN SAID "DONE — THEY CAN NO LONGER OPEN…" THOUGH NOTHING WAS ROTATED (they were unblocked elsewhere)');
  assert.match(said, /unblocked on another console, so nothing more was changed for care notes/, 'the unblock elsewhere was not said: ' + said.slice(0, 300));
  assert.match(said, /The room “Prayer” no longer exists, so there was no key left to change/, 'the room that is gone was not said');
});
test('3e MED 1: a Block whose care key truly could not change says so, with "Try again" — which retries', async () => {
  const w = world({ approval: true });
  withStatus(w);
  w.S.rotateCareKey = (...a) => { w.calls.push({ name: 'rotateCareKey', a }); return Promise.resolve(false); };
  const v = await blockShown(w);
  assert.match(v.said(), /could not change the care key yet/, 'a failed rotation was not named: ' + v.said().slice(0, 300));
  assert.doesNotMatch(v.said(), /Try blocking them again|grown past/, 'THE SCREEN TOLD THE STEWARD TO BLOCK AGAIN (impossible) OR BLAMED THE CHURCH\'S SIZE');
  assert.ok(w.calls.some(x => x.name === 'rememberRotation' && x.a[0] === 'care'), 'A FAILED ROTATION WAS NOT REMEMBERED — "Try again" would have nothing to run');
  const again = find(v.tree(), n => n.type === 'button' && /^Try again$/.test(texts(n).join(' ').trim()))[0];
  assert.ok(again, 'no "Try again" control for a rotation that failed');
  again.props.onClick();
  assert.ok(w.calls.some(x => x.name === 'retryPendingRotations'), '"Try again" did not retry the rotation');
  assert.match(v.said(), /Trying again…/, '"Try again" showed nothing while it ran');
  v.fire('steward-rotations');                                 // the runner finished (and the key still could not change)
  assert.match(v.said(), /could not change the care key yet/, 'AFTER "TRY AGAIN" ENDED THE SCREEN DID NOT SAY THE TRUE OUTCOME — it stuck or went quiet');
});
test('3e MED 1: Block waits, briefly, for the key reads — and rotates once they have settled', async () => {
  const w = world({ approval: true });
  let fresh = false;
  w.S.keysFresh = () => fresh;
  w.lists.groups.length = 0;
  const { mod, draw } = load(w);
  let tree = draw(mod.DashMembers, {});
  const bs = find(tree, n => n.type === 'button');
  const bobAt = bs.findIndex(n => ((n.props || {})['aria-label'] || '') === 'Mark as a child: Bob');
  bs.slice(0, bobAt).reverse().find(n => /Remove \/ block this member/.test(texts(n).join(' '))).props.onClick();
  tree = draw(mod.DashMembers, {});
  find(tree, n => n.type === 'button' && /^Confirm/.test(texts(n).join(' ').trim()))[0].props.onClick();
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(w.calls.some(x => x.name === 'setBlocked'), 'CONTROL: the block was not written');
  assert.ok(!w.calls.some(x => x.name === 'rotateCareKey'), 'THE ROTATION RAN BEFORE THE KEY READS HAD SETTLED — it did not wait');
  fresh = true;
  await new Promise(r => setTimeout(r, 400));
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(w.calls.some(x => x.name === 'rotateCareKey'), 'the rotation never ran once the key reads had settled');
});
test('3e MED 1: removing a delegate whose keys are WAITING says so truthfully — not "try removing them again"', async () => {
  const w = world({ approval: true });
  const ws = withStatus(w);
  w.S.rotateCareKey = ws.pendingFor('care');
  const { mod, draw } = load(w);
  const props = { church: { name: 'St Aidan', features: {} } };
  let tree = draw(mod.DashStewardsPanel, props);
  find(tree, n => n.type === 'button' && /^Revoke this steward/.test(texts(n).join(' ').trim()))[0].props.onClick();
  tree = draw(mod.DashStewardsPanel, props);
  find(tree, n => n.type === 'button' && /^Confirm — revoke/.test(texts(n).join(' ').trim()))[0].props.onClick();
  for (let i = 0; i < 10; i++) await tick();
  const said = texts(draw(mod.DashStewardsPanel, props)).join(' ');
  assert.match(said, /will be removed as soon as this console finishes connecting/, 'a WAITING rotation was not said as waiting: ' + said.slice(0, 300));
  assert.doesNotMatch(said, /Try removing them again/, 'THE SCREEN TOLD THE OWNER TO REMOVE A STEWARD WHO IS ALREADY REMOVED');
  assert.deepEqual(w.calls.find(x => x.name === 'rotateCareKey').a[2].drop, [ST], 'the rotation was not told whom it takes out');
});

// ROUND 3f, P1 (audit of 4bb1ed1): a ROOM key that failed to rotate offered "Try again" — and Try again found nothing to
// run, said "Trying again…" and stuck there, because only the care, sermon and name keys were remembered. Every failed key
// is remembered now, the room's with its id, so Try again runs it.
test('3f P1: a Block whose ROOM key failed offers "Try again" — and the failed room rotation is what it will run', async () => {
  const w = world({ approval: true });
  const ws = withStatus(w);
  w.S.publishGroupKey = (...a) => { w.calls.push({ name: 'publishGroupKey', a }); return Promise.resolve(false); };
  const v = await blockShown(w);
  assert.match(v.said(), /could not change the key for Prayer yet/, 'the failed room key was not named: ' + v.said().slice(0, 300));
  const r = w.calls.find(x => x.name === 'rememberRotation' && x.a[0] === 'room:g-open');
  assert.ok(r, 'THE FAILED ROOM ROTATION WAS NOT REMEMBERED — "Try again" would find nothing to run and stick at "Trying again…"');
  assert.deepEqual([r.a[1], r.a[2], r.a[3]], [[BOB], 'block', true], 'the room rotation was remembered without whom it takes out, or why, or as failed');
  const again = find(v.tree(), n => n.type === 'button' && /^Try again$/.test(texts(n).join(' ').trim()))[0];
  assert.ok(again, 'no "Try again" for the failed room key');
  again.props.onClick();
  assert.ok(w.calls.some(x => x.name === 'retryPendingRotations'), '"Try again" did not retry');
  ws.of(BOB).failed = []; ws.of(BOB).done = ['room:g-open'];   // the engine ran it (the real runner does this in browser row J)
  v.fire('steward-rotations');
  assert.match(v.said(), /Done — they can no longer open anything sealed/, 'the retry finishing never cleared "Trying again…"');
});
