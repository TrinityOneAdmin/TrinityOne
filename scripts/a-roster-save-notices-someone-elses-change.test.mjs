// A ROSTER SAVE MUST NOT SILENTLY REPLACE A ROSTER SOMEONE ELSE CHANGED.
// Run: node --test scripts/a-roster-save-notices-someone-elses-change.test.mjs
//
// Sim 2026-10-02, item 17. A roster is ONE document per team and Save replaces it whole, so two stewards
// editing the same team overwrote each other: whoever pressed Save second silently won (the relay held two
// authors' copies of one team's roster). The full cure is a merge; this is the floor the owner's brief asks for
// — DETECT it, and say so instead of winning silently.
//
// The form copies the roster when it opens. The console keeps showing the newest version it has seen
// (`roster.ts`). If that has moved on since the form opened, Save is withheld and the steward must choose:
// "Reload their version" or "Save mine anyway".
//
// MOUNTS the shipped RosterModal (esbuild-compiled app/stew-schedule.jsx) and presses its real buttons
// (CLAUDE.md rules 1 and 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSchedule, PUB_A, PUB_B, PUB_C } from './rota-board-harness.mjs';
import { find, texts, reads } from './render-jsx-screen.mjs';

const TEAM = { id: 't1', kind: 'team', name: 'Welcome', accent: 'var(--clay)' };
const ROLES = [{ id: 'r1', name: 'Greeter' }];
const RUTH = { id: 'p1', name: 'Ruth', pub: PUB_A };
const SAM = { id: 'p2', name: 'Sam', pub: PUB_B };
const DAN = { id: 'p3', name: 'Dan', pub: PUB_C };
const v = (ts, people) => ({ team: 't1', roles: ROLES, people, pods: [], ts });

function modal(team = TEAM) {
  const saved = [], groups = [];
  const sch = loadSchedule({}, {
    Steward: {
      publishRoster: async (id, r) => { saved.push({ id, ...JSON.parse(JSON.stringify(r)) }); return { id }; },
      publishGroup: async (g) => { groups.push(JSON.parse(JSON.stringify(g))); return g; },
    },
  }, ['RosterModal']);
  let closed = 0;
  const draw = (roster) => { sch.reset(); return sch.mod.RosterModal({ team, roster, members: [], onClose: () => { closed++; } }); };
  const button = (tree, label) => find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label))[0];
  const labelled = (tree, aria) => find(tree, n => n.type === 'button' && n.props['aria-label'] === aria)[0];
  return { draw, button, labelled, saved, groups, closed: () => closed };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

test('CONTROL: nobody else has written — Save roster saves, and replaces nothing it should not', async () => {
  const m = modal();
  const R = v(100, [RUTH, SAM]);
  let tree = m.draw(R);
  assert.ok(m.button(tree, 'Save roster'), 'no Save roster button — the fixture proves nothing');
  assert.doesNotMatch(reads(tree), /Someone else changed/, 'a warning with no change behind it');
  await m.button(tree, 'Save roster').props.onClick();
  await settle();
  assert.equal(m.saved.length, 1, 'the control did not save');
  assert.deepEqual(m.saved[0].people.map(p => p.name), ['Ruth', 'Sam']);
});

test('somebody else saved this team while the form was open: it SAYS SO and Save is withheld', async () => {
  const m = modal();
  m.draw(v(100, [RUTH, SAM]));                               // the form opens on version 100
  const tree = m.draw(v(200, [RUTH, SAM, DAN]));             // …and Dan is added by another steward
  assert.match(reads(tree), /Someone else changed this roster/, 'THE DEFECT: no warning that the roster moved on');
  assert.equal(m.button(tree, 'Save roster'), undefined, 'the plain Save button is still offered over their change');
  assert.ok(m.button(tree, 'Reload their version'), 'no way to take their version');
  assert.ok(m.button(tree, 'Save mine anyway'), 'no explicit way to keep the steward\'s own');
});

test('pressing the plain Save path with a stale form saves NOTHING', async () => {
  const m = modal();
  m.draw(v(100, [RUTH, SAM]));
  const tree = m.draw(v(200, [RUTH, SAM, DAN]));
  // the only controls left are the two explicit ones; neither was pressed
  await settle();
  assert.deepEqual(m.saved, [], 'a roster was published without the steward choosing');
  // and "Save mine anyway" is the ONLY control that writes over theirs
  await m.button(tree, 'Save mine anyway').props.onClick();
  await settle();
  assert.equal(m.saved.length, 1);
  assert.deepEqual(m.saved[0].people.map(p => p.name), ['Ruth', 'Sam'], 'mine-anyway must save what the steward built, not their version');
});

test('"Reload their version" brings their people into the form, clears the warning, and the next Save includes them', async () => {
  const m = modal();
  m.draw(v(100, [RUTH, SAM]));
  let tree = m.draw(v(200, [RUTH, SAM, DAN]));
  m.button(tree, 'Reload their version').props.onClick();
  tree = m.draw(v(200, [RUTH, SAM, DAN]));
  assert.doesNotMatch(reads(tree), /Someone else changed/, 'the warning stays after the steward reloaded');
  assert.match(reads(tree), /Dan/, 'their person did not arrive in the form');
  await m.button(tree, 'Save roster').props.onClick();
  await settle();
  assert.deepEqual(m.saved[0].people.map(p => p.name), ['Ruth', 'Sam', 'Dan']);
});

test('a form opened BEFORE the roster loaded (blank) is warned too — saving it would wipe the whole team', async () => {
  const m = modal();
  m.draw(undefined);                                          // nothing known yet: the form is blank
  const tree = m.draw(v(100, [RUTH, SAM]));                   // the real roster arrives
  assert.match(reads(tree), /Someone else changed this roster/, 'a blank form would silently replace the arrived roster');
  assert.equal(m.button(tree, 'Save roster'), undefined);
});

test('the steward\'s own edits alone do not raise the warning', async () => {
  const m = modal();
  let tree = m.draw(v(100, [RUTH, SAM]));
  m.labelled(tree, 'Remove Sam from the team').props.onClick();
  tree = m.draw(v(100, [RUTH, SAM]));
  assert.doesNotMatch(reads(tree), /Someone else changed/, 'editing raised a conflict with nobody else involved');
  await m.button(tree, 'Save roster').props.onClick();
  await settle();
  assert.deepEqual(m.saved[0].people.map(p => p.name), ['Ruth']);
});

test('reloading also resets what Save diffs the invite list against: their person is NOT promoted onto the allowlist by my save', async () => {
  // For an invite-only team Save applies the DELTA between the people the form opened with and the people it
  // saves. After a reload the baseline must be THEIR version, or Dan — whom the other steward added and handled —
  // would look like somebody this steward just added, and be admitted by a save that changed nothing.
  const m = modal({ ...TEAM, visibility: 'invite', members: [PUB_A, PUB_B, PUB_C] });
  m.draw(v(100, [RUTH, SAM]));
  let tree = m.draw(v(200, [RUTH, SAM, DAN]));
  m.button(tree, 'Reload their version').props.onClick();
  tree = m.draw(v(200, [RUTH, SAM, DAN]));
  await m.button(tree, 'Save roster').props.onClick();
  await settle();
  assert.equal(m.saved.length, 1, 'the save did not happen — the fixture is wrong');
  assert.deepEqual(m.groups, [], 'a save that changed nothing rewrote the invite allowlist (their person was treated as newly added)');
});
