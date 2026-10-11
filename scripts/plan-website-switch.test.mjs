// THE PLAN LIST'S "SHOW ON WEBSITE" SWITCH HAS A VISIBLE LABEL AND TELLS THE TRUTH WHEN A PUBLISH FAILS.
//   Run: node --test scripts/plan-website-switch.test.mjs
// Owner 2026-10-11: "there is a toggle, but has no label and doesn't seem to do anything". Renders the REAL
// DashPlans (sliced out of app/stew-dashboard.jsx, compiled by esbuild, drawn by scripts/render-jsx-screen.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

async function load(plans, publishPlan) {
  const m0 = SRC.indexOf('\nfunction DashPlans(');
  assert.ok(m0 > 0 && SRC.indexOf('\nfunction DashPlans(', m0 + 1) < 0, 're-anchor: DashPlans');
  const body = SRC.slice(m0, SRC.indexOf('\nwindow.DashPlans =', m0));
  const tmp = join(tmpdir(), 'planrow-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, body + '\nexport { DashPlans };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const globals = {
    React, Icon: () => null, Panel: (p) => p.children, NewPlanModal: () => null, confirm: () => true,
    window: { useStewardPlans: () => plans, SK: { planLibrary: [] }, Steward: { publishPlan, removePlan() {} } },
  };
  const key = '__planrow_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { DashPlans } = await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
  let tree = draw(DashPlans, {});
  const redraw = () => { tree = draw(DashPlans, {}); };
  return {
    sw: () => find(tree, n => n.props && n.props.role === 'switch')[0],
    all: () => texts(tree).join(' | '),
    alerts: () => find(tree, n => n.props && n.props.role === 'alert').map(n => texts(n).join('')),
    redraw,
  };
}
const plan = (over) => ({ id: 'p1', title: 'Easter', days: [{ d: 1, ref: 'John 1' }], ...over });
const tick = () => new Promise(r => setTimeout(r, 0));

test('the switch has a visible "Website" label beside it', async () => {
  const s = await load([plan()], async () => ({}));
  assert.ok(s.sw(), 'switch present');
  assert.ok(/Website/.test(s.all()), 'label text is drawn: ' + s.all());
});

test('pressing the switch hands publishPlan the plan with public flipped, both ways', async () => {
  const calls = [];
  const a = await load([plan()], async (p) => { calls.push(p); return { ts: 5 }; });
  a.sw().props.onClick({ stopPropagation() {} }); await tick();
  assert.equal(calls[0].public, false);
  assert.equal(calls[0].id, 'p1');
  const b = await load([plan({ public: false })], async (p) => { calls.push(p); return { ts: 5 }; });
  b.sw().props.onClick({ stopPropagation() {} }); await tick();
  assert.equal(calls[1].public, true);
});

test('a refused publish shows "Not saved" and the switch stays where it was; a good one shows nothing', async () => {
  for (const fail of [async () => ({ id: 'p1' }) /* publish() returned false: no ts */, async () => null, async () => { throw new Error('x'); }]) {
    const s = await load([plan()], fail);
    s.sw().props.onClick({ stopPropagation() {} }); await tick(); s.redraw();
    assert.equal(s.alerts().length, 1); assert.ok(s.alerts()[0].includes('Not saved'));
    assert.equal(s.sw().props['aria-checked'], true, 'still shows the real (unchanged) state');
  }
  const ok = await load([plan()], async () => ({ ts: 9 }));
  ok.sw().props.onClick({ stopPropagation() {} }); await tick(); ok.redraw();
  assert.deepEqual(ok.alerts(), []);
});
