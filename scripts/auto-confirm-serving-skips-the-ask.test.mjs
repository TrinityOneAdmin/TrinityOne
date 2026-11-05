// AUTO-CONFIRM SERVING: a church can turn OFF the accept step, so Publish rosters the assigned people as
// confirmed WITHOUT sending each of them a "Can you serve?" request they must accept.
// Run: node --test scripts/auto-confirm-serving-skips-the-ask.test.mjs
//
// Two halves, each at its point of use (CLAUDE.md rule 1), each driving the SHIPPED code — never matching text
// in app/*.jsx, which ships unbundled so `false && ` leaves every word in place (rule 3):
//
//   A. THE SCREEN. Render the real DashRota (app/stew-schedule.jsx) and press Publish.
//      - auto-confirm OFF (the default): sendServingRequest IS called for the assigned people (today's behaviour).
//      - auto-confirm ON: sendServingRequest is NOT called, the rota still publishes, and the slot still shows
//        its person (it renders as filled, not emptied).
//      These two are a PAIR: delete the gate and the ON test sends and fails; make the gate always-skip and the
//      OFF control sends nothing and fails. Neither passes vacuously.
//
//   B. THE SETTING. Lift publishRotaSettings + subscribeRotaSettings out of the SHIPPED bundle
//      (vendor/steward.js) and round-trip the value: the writer serialises autoConfirm into the one church
//      settings doc and carries the OTHER field forward on a partial write; the reader maps it back and
//      defaults it false for every church that never touched it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody } from './test-slice.mjs';

// ── A. THE SCREEN ─────────────────────────────────────────────────────────────────────────────────────────
const JS = transformSync(readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8'),
  { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });

const SERVICE = { id: 'svc1', date: '2026-09-13', time: '10:30', name: 'Sunday Gathering' };
const PUB = 'ab'.repeat(32);
const ROSTER = { id: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [{ id: 'p1', name: 'Ruth Bexley', pub: PUB }], pods: [] };
// A rota WITH somebody on it: `assign` is derived from the persisted rota when there is no draft, and
// sendRequestsFor iterates that map — without an assignment the OFF control would send nothing and pass for
// the wrong reason (the exact vacuous-pass trap the nobody-is-asked test warns about).
const ROTAS = [{ id: SERVICE.id, service: SERVICE.id, published: false, assign: { 't1::r1': { id: 'p1', name: 'Ruth Bexley', pub: PUB } } }];

function mount({ rotaSettings = {} } = {}) {
  const sent = [];        // outward serving requests (sendServingRequest)
  const published = [];   // rota publishes attempted
  const states = [];
  let idx = 0;
  const React = {
    useState(init) {
      const i = idx++;
      if (states.length <= i) states.push(typeof init === 'function' ? init() : init);
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useEffect() {}, useRef: () => ({ current: null }), useMemo: (f) => f(), createElement: h,
  };
  const real = {
    useStewardGroups: () => [{ id: 't1', kind: 'team', name: 'Welcome', accent: 'var(--clay)' }],
    useStewardRosters: () => [ROSTER],
    useStewardServices: () => [SERVICE],
    useStewardRotas: () => ROTAS,
    // The setting under test. Absent/empty ({}) reads as auto-confirm OFF — the default every church starts at.
    useStewardRotaSettings: () => rotaSettings,
    Steward: {
      publishService: async (s) => ({ id: 'svc' + Math.random().toString(36).slice(2, 6), ...s }),
      publishRota: async (r) => { published.push(r); return { id: r.service }; },   // the rota DID save
      sendServingRequest: async (...a) => { sent.push(a); return true; },
    },
  };
  real.confirm = () => true;
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
  const allText = () => {
    const out = [];
    const go = (v) => {
      if (typeof v === 'string') { out.push(v); return; }
      if (Array.isArray(v)) return v.forEach(go);
      if (v && typeof v === 'object' && v.props) go(v.props.children);
    };
    walk(render()).forEach(n => { if (n.props) go(n.props.children); });
    return out.join(' ');
  };
  return { render, walk: () => walk(render()), allText, sent, published };
}

const publishButton = (m) => m.walk().find(n => n.props && typeof n.props.onClick === 'function' && String(n.props.onClick).includes('publishRota'));

test('A0: the rota board renders and its Publish control is reachable', () => {
  // The anchor: without it a later "nobody was asked" could pass because nothing was ever clicked.
  const m = mount();
  assert.ok(publishButton(m), 'no control on the rota board calls publishRota — re-anchor rather than deleting');
});

test('A1 (control): with auto-confirm OFF, Publish asks the assigned people — today\'s behaviour is unchanged', async () => {
  const m = mount({ rotaSettings: { visibility: 'church' } });   // no autoConfirm => OFF
  await publishButton(m).props.onClick();
  assert.ok(m.published.length >= 1, 'the rota was not published, so this test is not exercising the path');
  assert.ok(m.sent.length >= 1,
    'a church that has NOT turned on auto-confirm published a rota and asked nobody to serve — the ' +
    'gate is skipping the ask unconditionally and the accept step is dead for everyone');
});

test('A2 (feature): with auto-confirm ON, Publish rosters the people WITHOUT asking them, and the rota still publishes', async () => {
  const m = mount({ rotaSettings: { visibility: 'church', autoConfirm: true } });
  await publishButton(m).props.onClick();
  assert.ok(m.published.length >= 1,
    'auto-confirm must still PUBLISH the rota — it only skips the ask. Nothing was published.');
  assert.deepEqual(m.sent, [],
    'THE FEATURE: auto-confirm is on, yet Publish still sent a "Can you serve?" request the member must ' +
    'accept. The whole point is to roster them as confirmed without asking.');
  // The slot still renders as covered/filled: rota coverage already counts an assigned-but-not-asked slot as
  // filled (rotaSlotCovers/rotaSlotVerdict), so skipping the ask does NOT leave the slot looking like a gap.
  assert.match(m.allText(), /Fully covered/,
    'after an auto-confirm publish the slot no longer renders as covered — skipping the ask must leave the ' +
    'assignment in place, not turn it into a gap');
});

// ── B. THE SETTING ROUND-TRIPS THROUGH THE SHIPPED ENGINE ───────────────────────────────────────────────────
// publishRotaSettings and subscribeRotaSettings are object methods on window.Steward; esbuild preserves their
// names, so fnBody anchors on the signature and the lift borrows the real method (same pattern as
// a-block-withdraws-clearance-and-capability-keys.test.mjs).
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const lift = (scope, anchor, name) =>
  new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, anchor, name)} }).${name}; }`)(scope);

function makeWriter(snap) {
  let captured = null;
  const scope = {
    sk: 'church-sk',                          // truthy: a configured church
    _rotaSettingsSnap: snap,                  // the last-seen settings the writer carries forward
    now: () => 1700000000,
    NET: 'trinityone',
    ROTA_SETTINGS_D: 'trinityone/rota-settings',
    feChurch: (evt) => evt,                   // pass-through; we only inspect the event it builds
    publish: (evt) => { captured = evt; return Promise.resolve(true); },
  };
  return { fn: lift(scope, 'publishRotaSettings(patch) {', 'publishRotaSettings'), scope, content: () => JSON.parse(captured.content) };
}

test('B1: publishRotaSettings serialises autoConfirm into the one settings doc', async () => {
  const w = makeWriter({ visibility: 'church', autoConfirm: false });
  const ret = await w.fn({ visibility: 'team', autoConfirm: true });
  assert.deepEqual(w.content(), { visibility: 'team', autoConfirm: true, updated: 1700000000 },
    'the church settings document does not carry autoConfirm — the member relay can store it but the write side dropped it');
  assert.deepEqual(ret, { visibility: 'team', autoConfirm: true }, 'the resolved value does not report autoConfirm back to the UI');
});

test('B2: a partial write carries the OTHER field forward (the doc is rewritten whole)', async () => {
  // Turn auto-confirm ON while the church is set to "team", writing ONLY autoConfirm.
  const w = makeWriter({ visibility: 'team', autoConfirm: false });
  await w.fn({ autoConfirm: true });
  assert.deepEqual(w.content(), { visibility: 'team', autoConfirm: true, updated: 1700000000 },
    'writing autoConfirm alone reset visibility to the default — a partial write must preserve the field it ' +
    'does not touch or the two settings clobber each other');

  // And the mirror: changing visibility alone must not silently switch auto-confirm off.
  const w2 = makeWriter({ visibility: 'church', autoConfirm: true });
  await w2.fn('team');   // legacy bare-string call (the visibility menu's historic signature)
  assert.deepEqual(w2.content(), { visibility: 'team', autoConfirm: true, updated: 1700000000 },
    'a bare visibility string dropped autoConfirm — the back-compat path must carry the snapshot forward too');
});

function readOut(mappedDocs) {
  // Borrow the real subscribeRotaSettings with a stubbed this._subAddr; capture what cb receives.
  let got = null;
  const scope = { ROTA_SETTINGS_D: 'trinityone/rota-settings', _rotaSettingsSnap: {} };
  const fn = lift(scope, 'subscribeRotaSettings(cb) {', 'subscribeRotaSettings');
  const self = { _subAddr: (_prefix, map, reducer) => { reducer(mappedDocs.map(map)); return () => {}; } };
  fn.call(self, (out) => { got = out; });
  return got;
}

test('B3: subscribeRotaSettings reads autoConfirm back, and defaults it false when the church never set it', () => {
  assert.deepEqual(readOut([{ visibility: 'team', autoConfirm: true }]), { visibility: 'team', autoConfirm: true },
    'the reader did not surface autoConfirm from the stored doc');
  assert.deepEqual(readOut([{ visibility: 'church' }]), { visibility: 'church', autoConfirm: false },
    'a doc with no autoConfirm field did not default to OFF');
  assert.deepEqual(readOut([]), { visibility: 'church', autoConfirm: false },
    'a church that has never touched the setting must read as the open default with auto-confirm OFF, not "no answer"');
});
