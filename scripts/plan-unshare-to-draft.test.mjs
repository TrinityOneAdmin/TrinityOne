// UNSHARING A READING PLAN MOVES IT TO DRAFTS - IT DOES NOT VANISH.   Run: node --test scripts/plan-unshare-to-draft.test.mjs
// Before: "Unshare" called Steward.removePlan (a delete marker), so a custom/uploaded plan was destroyed with no undo.
// Now: Unshare republishes the SAME plan with draft:true; only "Delete" on a draft row (after a confirm) calls removePlan.
// Renders the REAL DashPlans (sliced from app/stew-dashboard.jsx, compiled by esbuild, drawn by render-jsx-screen.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, find, texts, button } from './render-jsx-screen.mjs';
import { publicPlanFields } from './public-media.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

async function load(initial, { confirmAnswer = true, refuse = false } = {}) {
  const m0 = SRC.indexOf('\nfunction DashPlans(');
  assert.ok(m0 > 0 && SRC.indexOf('\nfunction DashPlans(', m0 + 1) < 0, 're-anchor: DashPlans');
  const body = SRC.slice(m0, SRC.indexOf('\nwindow.DashPlans =', m0));
  const tmp = join(tmpdir(), 'planunshare-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, body + '\nexport { DashPlans };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const store = { plans: initial.slice(), published: [], removed: [], confirms: [] };
  const Steward = {
    // behaves like the relay: a republish of the same id REPLACES that plan in place
    async publishPlan(p) { store.published.push(p); if (refuse) return null; store.plans = store.plans.map(x => x.id === p.id ? { ...p, ts: 9 } : x); return { ts: 9 }; },
    async removePlan(id) { store.removed.push(id); store.plans = store.plans.filter(x => x.id !== id); return {}; },
  };
  const globals = {
    React, Icon: () => null, Panel: (p) => p.children, NewPlanModal: () => null,
    confirm: (m) => { store.confirms.push(m); return confirmAnswer; },
    window: { useStewardPlans: () => store.plans, SK: { planLibrary: [] }, Steward },
  };
  const key = '__planunshare_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { DashPlans } = await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
  let tree = draw(DashPlans, {});
  return { store, redraw: () => { tree = draw(DashPlans, {}); }, tree: () => tree, btn: (l) => button(tree, l), all: () => texts(tree).join(' | ') };
}
const DAYS = [{ d: 1, ref: 'John 1', label: 'Day 1 - Word' }, { d: 2, ref: 'John 2', label: 'Day 2 - Wine' }];
const live = (over) => ({ id: 'custom-a', title: 'Easter', days: DAYS, created: 100, ts: 100, public: true, draft: false, ...over });
const tick = () => new Promise(r => setTimeout(r, 0));

test('Unshare republishes the plan as a draft (same id, days, created) and never calls removePlan; the row stays, now a draft', async () => {
  const s = await load([live(), live({ id: 'custom-b', title: 'Advent', created: 200 })]);
  assert.equal(s.btn('Unshare').length, 2, 'both live rows offer Unshare');
  s.btn('Unshare')[0].props.onClick(); await tick(); s.redraw();
  assert.equal(s.store.removed.length, 0, 'removePlan must NOT be called');
  assert.equal(s.store.published.length, 1);
  const p = s.store.published[0];
  assert.equal(p.id, 'custom-a'); assert.equal(p.draft, true);
  assert.deepEqual(p.days, DAYS); assert.equal(p.created, 100); assert.equal(p.title, 'Easter');
  assert.deepEqual(s.store.plans.map(x => x.id), ['custom-a', 'custom-b'], 'position kept');
  assert.ok(/Easter/.test(s.all()), 'still listed');
  assert.equal(s.btn('Publish').length >= 1, true, 'the drafted row now offers Publish');
  assert.equal(s.btn('Unshare').length, 1, 'only the still-live row offers Unshare');
});

test('a draft row offers Delete (confirmed) - the ONLY path to removePlan; declining keeps the plan', async () => {
  const no = await load([live({ draft: true })], { confirmAnswer: false });
  assert.equal(no.btn('Unshare').length, 0);
  no.btn('Delete')[0].props.onClick(); await tick();
  assert.equal(no.store.confirms.length, 1); assert.equal(no.store.removed.length, 0, 'declined: nothing deleted');
  const yes = await load([live({ draft: true })], { confirmAnswer: true });
  yes.btn('Delete')[0].props.onClick(); await tick(); yes.redraw();
  assert.deepEqual(yes.store.removed, ['custom-a']);
  assert.ok(!/Easter/.test(yes.all()), 'gone after a confirmed delete');
  const liveRow = await load([live()]);
  assert.equal(liveRow.btn('Delete').length, 0, 'a LIVE row has no Delete');
});

test('a refused unshare shows "Not saved" beside the row', async () => {
  const s = await load([live()], { refuse: true });
  s.btn('Unshare')[0].props.onClick(); await tick(); await tick(); s.redraw();
  assert.ok(find(s.tree(), n => n.props && n.props.role === 'alert').length === 1);
  assert.equal(s.store.removed.length, 0);
});

test('the gates already hide a draft: members (scheduleVisible, as shipped in vendor/fellowship.js) and the website feed', () => {
  const fsrc = readFileSync(join(ROOT, 'src/fellowship.src.js'), 'utf8');
  const i = fsrc.indexOf('function scheduleVisible(');
  assert.ok(i > 0 && fsrc.indexOf('function scheduleVisible(', i + 1) < 0);
  const fn = fsrc.slice(i, fsrc.indexOf('\n}\n', i) + 3);
  const scheduleVisible = new Function(fn + '; return scheduleVisible;')();
  const unshared = live({ draft: true });
  assert.deepEqual(scheduleVisible([unshared, live({ id: 'z' })]).map(x => x.id), ['z'], 'members do not see the drafted plan');
  assert.equal(publicPlanFields(unshared), null, 'the website feed omits it');
  assert.ok(publicPlanFields(live()), 'control: the live one is published');
});
