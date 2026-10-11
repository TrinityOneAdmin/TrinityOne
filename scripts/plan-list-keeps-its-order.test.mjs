// THE "SHARED WITH CHURCH" PLAN LIST KEEPS ITS ORDER WHEN A PLAN IS RE-SAVED.
//   Run: node --test scripts/plan-list-keeps-its-order.test.mjs
// Owner 2026-10-11: the reading-plan toggles reorder the list. Cause: subscribePlans sorted by `ts` (the event's
// created_at) and publishPlan re-stamps it on every save, so toggling Website (or Publish from draft) moved the
// plan to the end. This lifts the REAL publishPlan + subscribePlans out of vendor/steward.js, runs them over a
// fake relay, and renders the REAL DashPlans (app/stew-dashboard.jsx) against that subscription. CLAUDE.md 1, 3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const BUNDLE = process.env.PLAN_ORDER_BUNDLE_OVERRIDE ? readFileSync(process.env.PLAN_ORDER_BUNDLE_OVERRIDE, 'utf8') : readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

// a relay in a box: publish() stores the event and tells every open subscription; clock ticks 100 s per event
function relay() {
  const subs = []; let clock = 1000; const events = [];
  const deliver = (e) => { events.push(e); subs.forEach(s => s.onevent(e)); };
  const lift = (name) => fnBody(BUNDLE, '\n    ' + name + '(', name).trim();
  const helpers = ['_pickWinner', '_reduceVersions', '_seedFromCache', '_absorbById', '_forgetById'].map(n => fnBody(BUNDLE, 'function ' + n + '(', n)).join('\n');
  const methods = `const api = { ${lift('publishPlan')}, ${lift('subscribePlans')} };`;
  const store = {};
  const env = {
    skFor: () => ({}), now: () => (clock += 100), PLAN_D: 'plan:', NET: 'net', pub: 'c'.repeat(64),
    feChurch: (ev) => ({ ...ev, pubkey: 'c'.repeat(64), id: 'e' + events.length }),
    publish: async (ev) => { deliver(ev); return ev; },
    pool: { subscribeMany: (_r, _f, h) => { subs.push(h); return { close() {} }; } },
    relays: () => [], localStorage: { getItem: () => null, setItem() {} },
    _consoleDisplay: () => true, _consoleChurchVoice: () => true, _tombstoneTargets: () => [],
  };
  const keys = Object.keys(env);
  const api = new Function(...keys, helpers + '\n' + methods + '\nreturn api;')(...keys.map(k => env[k]));
  let current = [];
  api.subscribePlans(arr => { current = arr; });
  // an event exactly as an OLD console wrote it: no `created` in the content
  const raw = (id, title, at, extra) => deliver({ kind: 30078, created_at: at, pubkey: 'c'.repeat(64), tags: [['d', 'plan:' + id], ['t', 'net']], content: JSON.stringify({ id, title, days: [{ d: 1, ref: 'John 1' }], ...extra }) });
  return { api, now: () => current, raw, tick: () => (clock += 100) };
}

async function screen(r) {
  const m0 = SRC.indexOf('\nfunction DashPlans(');
  assert.ok(m0 > 0 && SRC.indexOf('\nfunction DashPlans(', m0 + 1) < 0, 're-anchor: DashPlans');
  const body = SRC.slice(m0, SRC.indexOf('\nwindow.DashPlans =', m0));
  const tmp = join(tmpdir(), 'planord-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try { writeFileSync(tmp, body + '\nexport { DashPlans };\n'); js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' }); } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const globals = { React, Icon: () => null, Panel: (p) => p.children, NewPlanModal: () => null, confirm: () => true,
    window: { useStewardPlans: () => r.now(), SK: { planLibrary: [] }, Steward: { publishPlan: (p) => r.api.publishPlan(p), removePlan() {} } } };
  const key = '__planord_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { DashPlans } = await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
  let tree = draw(DashPlans, {});
  const redraw = () => { tree = draw(DashPlans, {}); };
  const order = () => { const t = texts(tree).join('|'); return ['Alpha', 'Bravo', 'Charlie'].map(n => [t.indexOf(n), n]).filter(x => x[0] >= 0).sort((a, b) => a[0] - b[0]).map(x => x[1]).join(','); };
  const click = async (label, nth) => { const bs = find(tree, n => n.props && n.props.onClick && (label === 'switch' ? n.props.role === 'switch' : texts(n).join('').includes(label))); const b = bs[nth || 0]; b.props.onClick({ stopPropagation() {} }); await new Promise(res => setTimeout(res, 0)); redraw(); };
  return { order, click, redraw };
}
const days = [{ d: 1, ref: 'John 1' }];
async function three() {
  const r = relay();
  for (const [id, t] of [['a', 'Alpha'], ['b', 'Bravo'], ['c', 'Charlie']]) await r.api.publishPlan({ id, title: t, days });
  const s = await screen(r);
  assert.equal(s.order(), 'Alpha,Bravo,Charlie', 'setup');
  return { r, s };
}

test('toggling the Website switch on the middle plan leaves the order A,B,C, both ways', async () => {
  const { r, s } = await three();
  await s.click('switch', 1);
  assert.equal(r.now().find(p => p.id === 'b').public, false, 'the toggle really saved');
  assert.equal(s.order(), 'Alpha,Bravo,Charlie', 'Bravo jumped to the end of the list');
  await s.click('switch', 1);
  assert.equal(r.now().find(p => p.id === 'b').public, true);
  assert.equal(s.order(), 'Alpha,Bravo,Charlie');
});

test('publishing a draft from the list leaves it where it was', async () => {
  const r = relay();
  await r.api.publishPlan({ id: 'a', title: 'Alpha', days });
  await r.api.publishPlan({ id: 'b', title: 'Bravo', days, draft: true });
  await r.api.publishPlan({ id: 'c', title: 'Charlie', days });
  const s = await screen(r);
  assert.equal(s.order(), 'Alpha,Bravo,Charlie', 'setup');
  await s.click('Publish', 0);
  assert.equal(r.now().find(p => p.id === 'b').draft, false, 'the draft really went live');
  assert.equal(s.order(), 'Alpha,Bravo,Charlie');
});

test('a plan saved before `created` existed keeps its place after a toggle', async () => {
  const r = relay();
  r.raw('a', 'Alpha', 1100); r.raw('b', 'Bravo', 1200); r.raw('c', 'Charlie', 1300);   // old-console events: no `created`
  r.tick(); r.tick(); r.tick(); r.tick(); r.tick(); r.tick(); r.tick(); r.tick(); r.tick(); r.tick();   // the clock is now well past them
  const s = await screen(r);
  assert.equal(s.order(), 'Alpha,Bravo,Charlie', 'setup');
  await s.click('switch', 1);
  const b = r.now().find(p => p.id === 'b');
  assert.equal(b.public, false);
  assert.equal(b.created, 1200, 'the re-save should carry the old stamp forward as `created`');
  assert.equal(s.order(), 'Alpha,Bravo,Charlie');
});

test('a brand-new plan still goes to the end, and a re-save never changes `created`', async () => {
  const { r, s } = await three();
  const c0 = r.now().find(p => p.id === 'b').created;
  await s.click('switch', 1); await s.click('switch', 1);
  assert.equal(r.now().find(p => p.id === 'b').created, c0);
  await r.api.publishPlan({ id: 'd', title: 'Delta', days }); s.redraw();
  assert.deepEqual(r.now().map(p => p.id), ['a', 'b', 'c', 'd']);
});
