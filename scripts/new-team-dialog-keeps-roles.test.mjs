// The New Team dialog must not lose a team's roles, or the team itself, in silence (sim 2026-11-20 D5:
// the fixture's team landed with its roster on NO relay and the dialog had already closed). Drives the
// REAL NewTeamModal sliced from app/stew-dashboard.jsx and compiled with the packaged esbuild — only
// window.Steward's two publishers are spies. Run: node --test scripts/new-team-dialog-keeps-roles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STEW = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

function loadModal({ publishGroup, publishRoster }) {
  const { React, draw } = miniReact();
  const src = fnBody(STEW, 'function NewTeamModal({ open, onClose }) {', 'NewTeamModal');
  const tmp = join(tmpdir(), 'newteam-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { NewTeamModal };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const globals = {
    React,
    Icon: () => null,
    useStewDialog: () => ({ current: null }),
    window: {
      TEAM_PRESETS: [{ id: 'welcome', name: 'Welcome', icon: 'hand', accent: '#C25A38', roles: 'Greeter\nDoor lead' }],
      Steward: { publishGroup, publishRoster },
    },
  };
  const key = '__newteam_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return { React, draw, load: import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')) };
}

const press = (tree, label) => {
  const hits = find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));
  assert.ok(hits.length, 'no button "' + label + '" on the dialog');
  return hits[0].props.onClick();
};
const typeInto = (tree, idx, value) => {
  const ins = find(tree, n => n.type === 'input' || n.type === 'textarea');
  assert.ok(ins.length > idx, 'input #' + idx + ' missing');
  ins[idx].props.onChange({ target: { value } });
};
const settle = () => new Promise(r => setTimeout(r, 0)).then(() => new Promise(r => setTimeout(r, 0)));

async function rig({ groupOk = true, rosterOk = true } = {}) {
  const log = [];
  const { draw, load } = loadModal({
    publishGroup: async (g) => { log.push(['group', g.name, g.kind]); return groupOk ? { id: 'team-1' } : null; },
    publishRoster: async (id, r) => { log.push(['roster', id, r.roles.map(x => x.name)]); return rosterOk; },
  });
  const { NewTeamModal } = await load;
  const props = { open: true, onClose: () => log.push(['close']) };
  return { draw, NewTeamModal, props, log };
}

test('an empty role list is seeded like the wizard’s: preset roles for a preset-named team', async () => {
  const { draw, NewTeamModal, props, log } = await rig();
  let tree = draw(NewTeamModal, props);
  typeInto(tree, 0, 'Welcome team');          // name field; roles left empty
  tree = draw(NewTeamModal, props);
  await press(tree, 'Create team'); await settle();
  const roster = log.find(l => l[0] === 'roster');
  assert.ok(roster, 'no roster was published at all — the 0/0-roles card is back');
  assert.deepEqual(roster[2], ['Greeter', 'Door lead'], 'the preset’s roles were not seeded');
  assert.ok(log.some(l => l[0] === 'close'), 'full success must close the dialog');
});

test('an empty role list with no matching preset seeds the plain set — no team is born empty', async () => {
  const { draw, NewTeamModal, props, log } = await rig();
  let tree = draw(NewTeamModal, props);
  typeInto(tree, 0, 'Choir');
  tree = draw(NewTeamModal, props);
  await press(tree, 'Create team'); await settle();
  assert.deepEqual(log.find(l => l[0] === 'roster')[2], ['Lead', 'Helper', 'Helper']);
});

test('typed roles pass through verbatim (control)', async () => {
  const { draw, NewTeamModal, props, log } = await rig();
  let tree = draw(NewTeamModal, props);
  typeInto(tree, 0, 'Choir');
  tree = draw(NewTeamModal, props);
  const tas = find(tree, n => n.type === 'textarea');
  assert.ok(tas.length, 'the roles textarea is gone');
  tas[tas.length - 1].props.onChange({ target: { value: 'Soprano\nBass' } });
  tree = draw(NewTeamModal, props);
  await press(tree, 'Create team'); await settle();
  assert.deepEqual(log.find(l => l[0] === 'roster')[2], ['Soprano', 'Bass']);
});

test('a refused team stays on screen and says so — it no longer vanishes in silence', async () => {
  const { draw, NewTeamModal, props, log } = await rig({ groupOk: false });
  let tree = draw(NewTeamModal, props);
  typeInto(tree, 0, 'Choir');
  tree = draw(NewTeamModal, props);
  await press(tree, 'Create team'); await settle();
  tree = draw(NewTeamModal, props);
  assert.ok(!log.some(l => l[0] === 'close'), 'the dialog closed although the relay refused the team');
  assert.ok(!log.some(l => l[0] === 'roster'), 'a roster was published for a team that does not exist');
  assert.match(texts(tree).join(' '), /didn’t accept it/, 'the refusal is not said in the dialog');
  const name = find(tree, n => n.type === 'input')[0];
  assert.equal(name.props.value, 'Choir', 'what the steward typed was thrown away on failure');
});

test('refused ROLES keep the dialog open with the wizard’s warning — the team exists, the gap is said', async () => {
  const { draw, NewTeamModal, props, log } = await rig({ rosterOk: false });
  let tree = draw(NewTeamModal, props);
  typeInto(tree, 0, 'Choir');
  tree = draw(NewTeamModal, props);
  await press(tree, 'Create team'); await settle();
  tree = draw(NewTeamModal, props);
  assert.ok(!log.some(l => l[0] === 'close'), 'the dialog closed over a team whose roles never saved');
  assert.match(texts(tree).join(' '), /roles didn’t save/, 'the roles failure is not said');
});
