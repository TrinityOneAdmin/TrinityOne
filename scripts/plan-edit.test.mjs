// A STEWARD CAN EDIT A SHARED READING PLAN.   Run: node --test scripts/plan-edit.test.mjs
// Edit reopens the plan form PRE-FILLED and republishes under the SAME id with `created` carried through (so it replaces the
// plan in place and keeps its place). Rich day labels survive; changing the days of a LIVE plan WARNS but is allowed; a live
// plan offers "Save changes" (never "Save as draft", which would silently hide it). Renders the REAL DashPlans + NewPlanModal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, find, texts, button } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const once = (a) => { const i = SRC.indexOf(a); assert.ok(i > 0 && SRC.indexOf(a, i + 1) < 0, 're-anchor: ' + a); return i; };

async function load(initial, { refuse = false } = {}) {
  const dp = once('\nfunction DashPlans('), dpEnd = SRC.indexOf('\nwindow.DashPlans =', dp);
  const nm = once('\nfunction NewPlanModal('), nmEnd = SRC.indexOf('\nvar VP_BOOKS', nm);
  const bk = once('var VP_BOOKS = ['), bkEnd = SRC.indexOf('\nfunction DashVersePrompt', bk);
  const tmp = join(tmpdir(), 'planedit-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, SRC.slice(bk, bkEnd) + '\n' + SRC.slice(nm, nmEnd) + '\n' + SRC.slice(dp, dpEnd) + '\nexport { DashPlans };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const store = { plans: initial.slice(), published: [], removed: [] };
  const Steward = {
    async publishPlan(p) { store.published.push(p); if (refuse) return null; store.plans = store.plans.map(x => x.id === p.id ? { ...p, ts: 9 } : x); return { ts: 9 }; },
    async removePlan(id) { store.removed.push(id); return {}; },
  };
  const globals = {
    React, Icon: () => null, Panel: (p) => p.children, confirm: () => true, useStewDialog: () => ({ current: null }),
    FileReader: class { readAsText() {} },
    window: { useStewardPlans: () => store.plans, SK: { planLibrary: [] }, Steward },
  };
  const key = '__planedit_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { DashPlans } = await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
  let tree = draw(DashPlans, {});
  const redraw = () => { tree = draw(DashPlans, {}); };
  const btn = (l) => button(tree, l);
  const nameInput = () => find(tree, n => n.type === 'input' && n.props.placeholder && n.props.placeholder.includes('Advent'))[0];
  const area = () => find(tree, n => n.type === 'textarea')[0];
  return { store, redraw, btn, nameInput, area, tree: () => tree, all: () => texts(tree).join(' | '),
    warning: () => find(tree, n => n.props && n.props['data-testid'] === 'plan-days-warning'),
    alerts: () => find(tree, n => n.props && n.props.role === 'alert' && n.props['data-testid'] !== 'plan-days-warning') };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const DAYS = [{ d: 1, ref: 'John 1', label: 'Day 1 - Word' }, { d: 2, ref: 'John 2', label: 'Day 2 - Wine' }, { d: 3, ref: 'John 3', label: 'Day 3 - Faith' }];
const live = (over) => ({ id: 'custom-a', title: 'Easter', sub: '3 days', tag: 'Gospels', accent: 'var(--clay)', blurb: 'B', days: DAYS, created: 100, ts: 150, public: false, draft: false, publishAt: 0, ...over });
const edit = (s, over) => { s.btn('Edit')[0].props.onClick(); s.redraw(); };

test('Edit opens the form pre-filled; changing the title and pressing Save changes republishes the SAME id, days and created', async () => {
  const s = await load([live(), live({ id: 'custom-b', title: 'Advent', created: 200 })]);
  assert.equal(s.btn('Edit').length, 2, 'every shared row has an Edit button');
  edit(s);
  assert.equal(s.nameInput().props.value, 'Easter', 'pre-filled name');
  assert.equal(s.area().props.value, 'John 1\nJohn 2\nJohn 3', 'pre-filled readings');
  s.nameInput().props.onChange({ target: { value: 'Easter Week' } }); s.redraw();
  assert.equal(s.btn('Save as draft').length, 0, 'a LIVE plan must not offer Save as draft');
  assert.equal(s.btn('Save changes').length, 1);
  s.btn('Save changes')[0].props.onClick(); await tick(); s.redraw();
  assert.equal(s.store.published.length, 1);
  const p = s.store.published[0];
  assert.equal(p.id, 'custom-a'); assert.equal(p.title, 'Easter Week'); assert.equal(p.created, 100);
  assert.deepEqual(p.days, DAYS, 'days (with their rich labels) intact');
  assert.equal(p.draft, false, 'still live'); assert.equal(p.public, false, 'website flag kept'); assert.equal(p.tag, 'Gospels');
  assert.deepEqual(s.store.plans.map(x => x.title), ['Easter Week', 'Advent'], 'replaced in place');
  assert.equal(s.nameInput(), undefined, 'the form closed after a good save');
});

test('changing the days of a LIVE plan shows a warning but still saves; labels of untouched days survive', async () => {
  const s = await load([live()]);
  edit(s);
  assert.equal(s.warning().length, 0, 'no warning before any day change');
  s.area().props.onChange({ target: { value: 'John 1\nJohn 3\nJohn 5' } }); s.redraw();
  assert.equal(s.warning().length, 1, 'warning appears');
  s.btn('Save changes')[0].props.onClick(); await tick();
  const p = s.store.published[0];
  assert.deepEqual(p.days.map(d => d.d), [1, 2, 3]);
  assert.deepEqual(p.days.map(d => d.ref), ['John 1', 'John 3', 'John 5']);
  assert.deepEqual(p.days.map(d => d.label), ['Day 1 - Word', 'Day 3 - Faith', 'John 5'], 'kept/moved labels survive; a new reading is labelled by itself');
  assert.equal(p.sub, '3 days');
});

test('a DRAFT plan edits without a warning and offers Save draft + Publish', async () => {
  const s = await load([live({ draft: true })]);
  edit(s);
  s.area().props.onChange({ target: { value: 'John 1' } }); s.redraw();
  assert.equal(s.warning().length, 0);
  assert.equal(s.btn('Save as draft').length, 1); assert.equal(s.btn('Publish now').length, 1);
  s.btn('Save as draft')[0].props.onClick(); await tick();
  assert.equal(s.store.published[0].draft, true); assert.equal(s.store.published[0].id, 'custom-a');
  assert.equal(s.store.published[0].sub, '1 day');
});

test('a refused save keeps the form open with the changes and says so', async () => {
  const s = await load([live()], { refuse: true });
  edit(s);
  s.nameInput().props.onChange({ target: { value: 'X' } }); s.redraw();
  s.btn('Save changes')[0].props.onClick(); await tick(); s.redraw();
  assert.equal(s.nameInput().props.value, 'X');
  assert.ok(/Not saved/.test(s.all()));
});
