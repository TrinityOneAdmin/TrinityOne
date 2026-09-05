// A CALENDAR SAVE THAT DID NOT HAPPEN MUST NOT LOOK LIKE ONE THAT DID.
// Run: node --test scripts/a-refused-calendar-save-does-not-close-the-modal.test.mjs
//
// Companion to a-late-church-key-never-writes-a-gathering-in-the-clear.test.mjs, which proves the ENGINE
// refuses. This one proves the SCREEN says so — CLAUDE.md rule 1: a fix needs a test that fails if the
// feature is deleted from the screen, not only if the engine behind it breaks.
//
// The sequence that made this necessary: making the publishers refuse was the whole fix, but EIGHT of the
// ten call sites in app/stew-schedule.jsx dropped the return value on the floor. Shipping the refusal alone
// would have closed the modal, cleared the steward's typing, and flashed "Published — everyone assigned has
// been asked" over a rota that reached no relay. That is not a smaller bug than the one being fixed.
//
// WHY IT RENDERS INSTEAD OF GREPPING. app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition
// leaves every word of it in the file and any text-matching assertion still passes (CLAUDE.md rule 3).
// There is no React in node_modules, so there is no react-dom/server either. The fix is a ~20-line renderer:
// transpile the real file, give it a fake React whose useState is real enough to hold values, call the real
// component, walk the returned tree and invoke the real onClick. Nothing about the save path is stubbed
// except the relay itself — and the relay is the input, not the decision under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const SRC = readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8');
const JS = transformSync(SRC, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

// The refusal copy lives in the file; read it rather than restating it, so a reworded message does not
// quietly turn this test into one that asserts nothing.
const NO_KEY = (SRC.match(/const SCH_NO_KEY = '([^']+)'/) || [])[1];
assert.ok(NO_KEY, 'SCH_NO_KEY is gone — re-anchor this test rather than deleting it');

function mount(componentName, props, { steward = {}, preset = {} } = {}) {
  const states = [];
  let idx = 0;
  const React = {
    useState(init) {
      const i = idx++;
      if (states.length <= i) states.push(Object.prototype.hasOwnProperty.call(preset, i) ? preset[i] : (typeof init === 'function' ? init() : init));
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useEffect() {}, useRef: () => ({ current: null }),
  };
  const h = (type, props2, ...kids) => ({ type, props: { ...(props2 || {}), children: kids.flat() } });
  const scope = {
    React, h, Frag: 'Frag',
    Icon: () => null, SchModal: (p) => h('modal', p), useStewDialog: () => ({ current: null }),
    todayISO: () => '2026-09-05',
    window: { Steward: steward },
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, JS + `\nreturn { ${componentName} };`)(...names.map(n => scope[n]));
  const render = () => { idx = 0; return mod[componentName](props); };
  const nodes = (n, out = []) => {
    if (!n || typeof n !== 'object') return out;
    if (Array.isArray(n)) { n.forEach(x => nodes(x, out)); return out; }
    out.push(n); nodes(n.props && n.props.children, out); return out;
  };
  return { render, states, nodes: () => nodes(render()) };
}

// A steward has typed a service in and pressed Add. The relay refuses because the church key has not
// arrived — publishService resolves null.
test('a service that was refused keeps the modal open and says why', async () => {
  let closed = false;
  const m = mount('SchAddServiceModal', { onClose: () => { closed = true; } }, {
    steward: { publishService: async () => null },
    preset: { 1: '2026-09-13' },   // the date field, so save() gets past its own guard
  });
  const btn = m.nodes().find(n => n.props && typeof n.props.onClick === 'function' && n.props.disabled === false);
  assert.ok(btn, 'no enabled save button rendered — re-anchor');
  await btn.props.onClick();

  assert.equal(closed, false,
    'THE DEFECT: the modal closed over a service that was never saved. The steward saw it vanish, which is ' +
    'what a successful save looks like, and their typing went with it.');
  assert.ok(m.states.includes(NO_KEY),
    'the save was refused and the screen said nothing — no state holds the refusal message');
  const alert = m.nodes().find(n => n.type && n.type.name === 'SchNotSaved' && n.props.msg);
  assert.ok(alert, 'nothing renders the refusal: SchNotSaved got no message, so the screen is silent');
});

test('the same service saves and closes normally when the relay accepts', async () => {
  // The control. Without it, deleting the save entirely would pass the test above.
  let closed = false;
  const m = mount('SchAddServiceModal', { onClose: () => { closed = true; } }, {
    steward: { publishService: async (svc) => ({ id: 'svc1', ...svc }) },
    preset: { 1: '2026-09-13' },
  });
  const btn = m.nodes().find(n => n.props && typeof n.props.onClick === 'function' && n.props.disabled === false);
  await btn.props.onClick();
  assert.equal(closed, true, 'a service that WAS saved left the modal open — the fix broke the normal path');
  assert.ok(!m.states.includes(NO_KEY), 'a successful save still showed the "not saved" message');
});

test('a refused run sheet keeps the whole order of service on screen', async () => {
  // The run sheet is the costliest modal to lose: it is the entire order of service, typed in one sitting.
  let closed = false;
  const m = mount('RunsheetModal', { service: { id: 'svc1', name: 'Sunday Gathering' }, sheet: [{ title: 'Call to worship', time: '10:30', who: 'Ruth', ccli: '' }], onClose: () => { closed = true; } },
    { steward: { publishRunsheet: async () => null } });
  const btn = m.nodes().find(n => n.props && typeof n.props.onClick === 'function' && String(n.props.onClick).includes('publishRunsheet'));
  assert.ok(btn, 'no run-sheet save button rendered — re-anchor');
  await btn.props.onClick();
  assert.equal(closed, false, 'the run sheet modal closed over a save that never landed');
  assert.ok(m.states.includes(NO_KEY), 'the run sheet was refused and the screen said nothing');
});
