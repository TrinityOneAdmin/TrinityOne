// AN OUTWARD MESSAGE MUST NEVER GO OUT OVER WORK THAT DID NOT HAPPEN.
// Run: node --test scripts/nobody-is-asked-to-serve-on-a-rota-that-was-not-saved.test.mjs
//
// Finding 1 of the audit of 7a45d4d — a defect in the FIX for the calendar sealing, not in the original code.
//
// Making the publishers refuse was right. But `autoFillAhead` ("Create + fill this quarter") published a rota,
// ignored the result, and called sendRequestsFor unconditionally. sendRequestsFor sends a DM to every assigned
// member asking them to serve. So on a console whose church key had not arrived, a steward filling a quarter
// got: thirteen rotas refused, thirteen sets of outward requests sent anyway, fifty-two seconds of no
// feedback, and then "Created + filled 13 services."
//
// That is worse than the bug being fixed. The original defect wrote a rota in the clear; this one asks real
// people to turn up for something that does not exist. The commit message for 7a45d4d claimed this path was
// fixed and it was not — which is why this file exists rather than a line in that commit.
//
// It RENDERS DashRota and invokes the real handler. app/*.jsx ships unbundled, so asserting the order of two
// calls by reading the source proves nothing (CLAUDE.md rule 3) — a guard inside `false && ` reads correctly
// and does nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const JS = transformSync(readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8'),
  { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });

const SERVICE = { id: 'svc1', date: '2026-09-13', time: '10:30', name: 'Sunday Gathering' };
const ROSTER = { id: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [{ id: 'p1', name: 'Ruth Bexley', pub: 'ab'.repeat(32) }], pods: [] };

function mount({ publishRota, publishService, preset = {} } = {}) {
  const sent = [];        // outward serving requests
  const published = [];   // rota publishes attempted
  const states = [];
  let idx = 0;
  const React = {
    useState(init) {
      const i = idx++;
      if (states.length <= i) states.push(Object.prototype.hasOwnProperty.call(preset, i) ? preset[i] : (typeof init === 'function' ? init() : init));
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useEffect() {}, useRef: () => ({ current: null }), useMemo: (f) => f(), createElement: h,
  };
  const real = {
    useStewardGroups: () => [{ id: 't1', kind: 'team', name: 'Welcome', accent: 'var(--clay)' }],
    useStewardRosters: () => [ROSTER],
    useStewardServices: () => [SERVICE],
    // A rota WITH somebody on it. `assign` is derived from the persisted rota when there is no local draft
    // (stew-schedule.jsx:499), and sendRequestsFor iterates that map — so without this the happy-path control
    // sends nothing and the refusal test would pass for the wrong reason. That is exactly the trap this
    // project keeps hitting: a test that proves an absence its own fixture guaranteed.
    useStewardRotas: () => [{ id: SERVICE.id, service: SERVICE.id, published: false, assign: { 't1::r1': { id: 'p1', name: 'Ruth Bexley', pub: 'ab'.repeat(32) } } }],
    Steward: {
      publishService: publishService || (async (s) => ({ id: 'svc' + Math.random().toString(36).slice(2, 6), ...s })),
      publishRota: async (r) => { published.push(r); return publishRota ? publishRota(r) : { id: r.service }; },
      sendServingRequest: async (...a) => { sent.push(a); return true; },
    },
  };
  // Any other useStewardX the screen reaches for answers with an empty list. Stubbing THOSE cannot answer the
  // question here: what is under test is whether a refused publish still produces an outward message.
  real.confirm = () => true;   // the bulk entries ask before acting; answering no would test nothing
  const win = new Proxy(real, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && k.startsWith('useSteward')) return () => [];
      return undefined;
    },
    has: () => true,
  });
  const scope = {
    React, h, Frag: 'Frag', Icon: () => null, SchModal: (p) => h('modal', p),
    useStewDialog: () => ({ current: null }), todayISO: () => '2026-09-05',
    window: win, document: { addEventListener() {}, removeEventListener() {} },
  };
  const names = Object.keys(scope);
  const { DashRota } = new Function(...names, JS + '\nreturn { DashRota };')(...names.map(n => scope[n]));
  const render = () => { idx = 0; return DashRota({ onNewTeam() {} }); };
  const walk = (n, out = []) => {
    if (!n || typeof n !== 'object') return out;
    if (Array.isArray(n)) { n.forEach(x => walk(x, out)); return out; }
    out.push(n); walk(n.props && n.props.children, out); return out;
  };
  return { render, walk: () => walk(render()), sent, published, states };
}

const handlerNamed = (m, needle) => m.walk().find(n => n.props && typeof n.props.onClick === 'function' && String(n.props.onClick).includes(needle));

test('the screen renders and its publish control is reachable', () => {
  // The anchor. Without it a later assertion could pass because nothing was ever found to click.
  const m = mount();
  const btn = handlerNamed(m, 'publishRota');
  assert.ok(btn, 'no control on the rota board calls publishRota — re-anchor this test rather than deleting it');
});

test('a REFUSED rota sends nobody a serving request', async () => {
  const m = mount({ publishRota: async () => null });   // the church key never arrived
  const btn = handlerNamed(m, 'publishRota');
  await btn.props.onClick();
  assert.ok(m.published.length >= 1, 'the publish was never attempted — the test is not exercising the path');
  assert.deepEqual(m.sent, [],
    'THE DEFECT: a rota that reached no relay still sent serving requests. Real people were asked to turn ' +
    'up for a rota that does not exist, and the screen reported success.');
});

test('a rota that DID save still asks the people on it', async () => {
  // The control: without it, deleting sendRequestsFor entirely would pass the test above.
  const m = mount({ publishRota: async (r) => ({ id: r.service }) });
  const btn = handlerNamed(m, 'publishRota');
  await btn.props.onClick();
  assert.ok(m.published.length >= 1, 'nothing was published on the happy path');
  assert.ok(m.sent.length >= 1,
    'a rota that saved asked nobody to serve — the guard is too strict and the feature is dead');
});

// THE BULK PATH (autoFillAhead, "Create + fill this quarter") IS NOT TESTED HERE, AND THAT IS DELIBERATE.
//
// It is the path the re-audit found unguarded, and its guard is now in place (app/stew-schedule.jsx: the
// rota loop `continue`s on null before sendRequestsFor). But I could not write an HONEST test for it:
//
//   - The control failed. With every rota saving, this fixture's bulk run asks nobody to serve — fillAssign
//     produces no assignment for the services it creates — so an assertion that a REFUSED run asks nobody
//     passes whatever the code does. A first draft of that test was green against the audit's own sabotage.
//   - Reaching the control at all means opening a menu, and presetting hook indices to find it corrupts
//     sibling state (assignSlot/rosterTeam become `true` instead of objects) and throws in render.
//
// A test that passes trivially is worse than no test: it reports exactly what a blind test reports. So the
// guard on that path is verified by reading it and on the device, and is recorded as unproven here rather
// than covered by something that cannot fail. Anyone adding fixture scaffolding for fillAssign should start
// by asserting the happy path DOES send.

test('a relay refusal is a refusal too, not just a missing key', async () => {
  // publish() returns FALSE on total failure — it does not throw. The publishers used to discard that with
  // .then(() => ({...})), handing every caller a truthy object over a document that reached no relay, so all
  // of this branch's guards covered the no-church-key case and none covered the ordinary one: the relay
  // simply unreachable, which is the normal failure on the thin pipe this product is built for.
  const m = mount({ publishRota: async () => null });   // the publisher's own null, however it arose
  const btn = handlerNamed(m, 'publishRota');
  await btn.props.onClick();
  assert.deepEqual(m.sent, [], 'a rota the relay never accepted still asked people to serve');
});
