// A CHILD IS NEVER A GUARDIAN — the three places on the console where the record could still say otherwise.
//   Run: node --test scripts/console-child-is-never-a-guardian.test.mjs
//
// Sim round 3, defect D2, owner's decision 2026-09-06 (reference/DOMAIN.md). The "Mark as a child" control's
// half of this lives in console-safeguarding-controls-are-wired.test.mjs. This file covers what is left:
//
//   1. A guardian REQUEST from someone marked as a child. `approveGuardian` had no minors check on the
//      requester at all — the guard `linkParent` has always had — so a request card's Confirm would have
//      linked a child as another child's parent with one press. The card must say so and Confirm must be
//      inert; and pressing it anyway must write nothing.
//   2. The member row. After the toggle fix, only data an older console wrote, or a re-seat carried across,
//      can leave a child listed as a guardian — which is exactly why the row must SHOW it: it is the only
//      place a steward learns of a historic contradiction.
//   3. Kids check-in. `guardiansOf` printed whoever the map named as the pickup contact — including a child.
//      The list a leader reads a name off at the door must only ever name adults.
//
// WHOLE PANELS ARE RENDERED (DashMembers, DashCheckin) with the same esbuild the packaged build uses and the
// repo's miniReact, so the button is found by its accessible name and what reached window.Steward is what is
// asserted. Nothing here matches text in app/*.jsx (CLAUDE.md rule 3): `false &&` in front of the guard
// leaves every word in place and would still fail these.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const NOW = Math.floor(Date.now() / 1000);

const KID_A = 'aa'.repeat(32), KID_B = 'bb'.repeat(32), ADULT = 'cc'.repeat(32);
const NAMES = { [KID_A]: 'Tom Okafor', [KID_B]: 'Ivy Okafor', [ADULT]: 'Ruth Okafor' };
const members = () => Object.keys(NAMES).map(pk => ({ pubkey: pk, npub: 'npub1' + pk.slice(0, 8), name: NAMES[pk], count: 2, lastTs: NOW - 60, joined: NOW - 9000 }));

async function loadSlices(anchors, exportNames, globals) {
  const src = anchors.map(([anchor, what]) => fnBody(STEW, anchor, what)).join('\n');
  const tmp = join(tmpdir(), 'cing-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${exportNames.join(', ')} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__cing_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

const furniture = () => ({
  CustomEvent, setTimeout, clearTimeout, Promise, Date, Math, JSON, Set, Object, String, Array,
  location: { search: '', hostname: 'x' },
  document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
  SK_TINT: { gold: { fg: '#000' }, sage: { fg: '#000' }, clay: { fg: '#000' }, ink: { fg: '#000' } },
  nameHandle: () => '', shortNpub: (n) => String(n || '').slice(0, 12) + '…', ago: () => 'a while ago',
  Panel: (p) => (p && p.children) || null, Icon: () => null, SkPill: (p) => (p && p.children) || null,
  SkBadge: () => null, SkConfirm: () => null, DismissibleNote: (p) => (p && p.children) || null,
  useStewDialog: () => ({ current: null }), todayISO: () => '2026-09-07', stewCapState: () => ({ allowed: true }),
});

// ── the Members panel, over a church whose guardians map and minors list we set ────────────────────────────
async function membersPanel({ minors, guardians, requests = [] }) {
  const { React, draw } = miniReact();
  const calls = { minors: [], guardians: [] };
  const g = {
    React, ...furniture(),
    window: {
      Steward: {
        setBlocked: () => Promise.resolve(true), setAdmitted: () => Promise.resolve(true),
        setMinors: (l) => { calls.minors.push(l); return Promise.resolve(true); },
        setApproved: () => Promise.resolve(true),
        setGuardians: (m) => { calls.guardians.push(m); return Promise.resolve(true); },
        setNoPhoto: () => Promise.resolve(true),
      },
      useStewardGroups: () => [], useStewardStewards: () => [], useStewardChurch: () => ({}), useStewardBlocked: () => [],
      useStewardSafeguard: () => ({ loaded: true, minorsKnown: true, clearedKnown: true, cleared: {}, minors, approved: [], nophoto: [], guardians }),
      useStewardGuardians: () => guardians,
      useStewardGuardianRequests: () => requests,
      useStewardJoinPolicy: () => false, useStewardAdmitted: () => [],
      useStewardMembers: members,
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
  const mod = await loadSlices([['function DashMembers()', 'DashMembers']], ['DashMembers'], g);
  let tree = draw(mod.DashMembers, {});
  const redraw = () => { tree = draw(mod.DashMembers, {}); return tree; };
  const btn = (re) => find(tree, n => n.type === 'button' && n.props && re.test(String(n.props['aria-label'] || '') + ' ' + texts(n).join(' ')));
  return { calls, redraw, btn, words: () => texts(tree).join(' ') };
}

const tick = () => new Promise(r => setTimeout(r, 5));

// ── 1. a request from a child ──────────────────────────────────────────────────────────────────────────────
test('CONTROL: a guardian request from an ADULT still has a live Confirm that links them', async () => {
  const p = await membersPanel({ minors: [KID_B], guardians: {}, requests: [{ child: KID_B, parent: ADULT }] });
  const confirm = p.btn(/^Confirm guardian link: Ruth Okafor/);
  assert.equal(confirm.length, 1, 'the request card no longer carries exactly one Confirm naming the requester — re-anchor this test');
  assert.ok(!confirm[0].props.disabled, 'an adult’s request has a disabled Confirm — the guard is refusing everybody');
  confirm[0].props.onClick();
  await tick();
  assert.equal(p.calls.guardians.length, 1, 'confirming an adult’s request linked nobody');
  assert.deepEqual(p.calls.guardians[0], { [KID_B]: [ADULT] });
});

test('A GUARDIAN REQUEST FROM SOMEONE MARKED AS A CHILD CANNOT BE CONFIRMED', async () => {
  const p = await membersPanel({ minors: [KID_A, KID_B], guardians: {}, requests: [{ child: KID_B, parent: KID_A }] });
  const confirm = p.btn(/^Confirm guardian link: Tom Okafor/);
  assert.equal(confirm.length, 1, 'the request card is not rendered for a child requester — it must be, with the refusal on it');
  assert.ok(confirm[0].props.disabled,
    'Confirm is live on a request from someone this church has marked as a child. One press links a child as ' +
    'another child’s parent — the guard linkParent has always had, and this path did not');
  assert.match(p.words(), /is marked as a child and cannot be a guardian/,
    'the card does not say why the request cannot be confirmed');
  // and pressing it anyway — a stale render, a keyboard — writes nothing
  confirm[0].props.onClick();
  await tick();
  assert.deepEqual(p.calls.guardians, [], 'approveGuardian wrote the link despite the requester being a child');
  assert.deepEqual(p.calls.minors, [], 'approveGuardian wrote the minors list despite refusing');
  p.redraw();
  assert.match(p.words(), /cannot be confirmed as a guardian/, 'the steward was not told the press did nothing');
});

// ── 2. the member row shows a historic contradiction ───────────────────────────────────────────────────────
test('A CHILD STILL LISTED AS A GUARDIAN IS SHOWN AS SUCH ON THEIR ROW', async () => {
  const p = await membersPanel({ minors: [KID_A, KID_B], guardians: { [KID_B]: [KID_A, ADULT] } });
  assert.match(p.words(), /child · still listed as a guardian/,
    'a person marked as a child who is still named in the guardians map has nothing on their row saying so. ' +
    'After the toggle fix only an older console or a re-seat can produce this, which is exactly why the ' +
    'row is the only place a steward can learn of it');
});

test('CONTROL: an adult guardian is NOT labelled with the contradiction', async () => {
  const p = await membersPanel({ minors: [KID_B], guardians: { [KID_B]: [ADULT] } });
  assert.doesNotMatch(p.words(), /still listed as a guardian/, 'an ordinary parent account is flagged as a contradiction');
  assert.match(p.words(), /parent account/, 'the ordinary parent pill has gone');
});

// ── 3. check-in never names a child as the pickup contact ──────────────────────────────────────────────────
async function checkin({ minors, guardians, present }) {
  const { React, draw } = miniReact();
  const g = {
    React, ...furniture(),
    window: {
      Steward: { capKeyRing: () => ['k'], subscribeCapKey: () => () => {}, publishCheckin: () => Promise.resolve(true) },
      useStewardCheckins: () => present.map((child, i) => ({ id: 'r' + i, child, childName: NAMES[child], date: '2026-09-07', in: NOW - 600, code: '1234' })),
      useStewardSafeguard: () => ({ minors, minorsKnown: true }),
      useStewardGuardians: () => guardians,
      useStewardMembers: members,
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
  const mod = await loadSlices(
    [['function DashCheckin()', 'DashCheckin'], ['function CheckinPicker(', 'CheckinPicker'],
     ['function CkModal(', 'CkModal'], ['function CheckoutModal(', 'CheckoutModal']],
    ['DashCheckin'], g);
  let tree = draw(mod.DashCheckin, {});
  const redraw = () => { tree = draw(mod.DashCheckin, {}); return tree; };
  const btn = (re) => find(tree, n => n.type === 'button' && n.props && re.test(String(n.props['aria-label'] || '') + ' ' + texts(n).join(' ')));
  return { redraw, btn, words: () => texts(tree).join(' ') };
}

test('CONTROL: an adult guardian is printed as the pickup contact, on the register and in the picker', async () => {
  const c = await checkin({ minors: [KID_A, KID_B], guardians: { [KID_B]: [ADULT] }, present: [KID_B] });
  assert.match(c.words(), /pickup: Ruth Okafor/, 'the register no longer names the adult who may collect the child');
  const open = c.btn(/Check a child in/);
  assert.equal(open.length, 1, 're-anchor: the check-in button is gone');
  open[0].props.onClick();
  c.redraw();
  assert.match(c.words(), /Pickup: Ruth Okafor|No adult guardian linked|Everyone/, 'the picker did not open');
});

test('A CHILD IN ANOTHER CHILD’S GUARDIAN LIST IS NEVER PRINTED AS THE PICKUP CONTACT', async () => {
  const c = await checkin({ minors: [KID_A, KID_B], guardians: { [KID_B]: [KID_A] }, present: [KID_B] });
  assert.doesNotMatch(c.words(), /pickup: Tom Okafor/i,
    'the register told a leader at the door that Tom Okafor — a child — may collect Ivy. This is the list a ' +
    'name gets read off before a child leaves the building');
  assert.match(c.words(), /no adult guardian linked/i, 'with only a child in the list, the row must say there is no ADULT guardian');
  c.btn(/Check a child in/)[0].props.onClick();
  c.redraw();
  assert.doesNotMatch(c.words(), /Pickup: Tom Okafor/, 'the picker printed a child as the pickup contact');
  assert.match(c.words(), /No adult guardian linked/, 'the picker does not say the child has no adult guardian');
});

test('…and an adult guardian beside the child still shows — the filter drops children, not everybody', async () => {
  const c = await checkin({ minors: [KID_A, KID_B], guardians: { [KID_B]: [KID_A, ADULT] }, present: [KID_B] });
  assert.match(c.words(), /pickup: Ruth Okafor/);
  assert.doesNotMatch(c.words(), /Tom Okafor/, 'the child is still printed alongside the adult');
});
