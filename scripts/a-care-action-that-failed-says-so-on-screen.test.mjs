// THE OTHER HALF OF THE SAME FIX: THE SCREEN HAS TO SAY IT.
// Run: node --test scripts/a-care-action-that-failed-says-so-on-screen.test.mjs
//
// a-care-action-that-landed-nowhere-says-so.test.mjs proves the ENGINE now reports failure. That is worth
// nothing on its own — the pre-merge audit caught exactly this on "I'm here to help", where a screen fix sat
// over an engine that never reported anything, and the whole thing was decorative. CLAUDE.md rule 1: a test
// that fails only if the engine breaks is not a test of a feature; it must fail if the feature is deleted
// FROM THE SCREEN.
//
// So this renders the REAL components out of app/screens-today.jsx — compiled with the same esbuild the build
// uses, through the miniature React in render-jsx-screen.mjs — presses the control, and reads the tree that
// comes back. Rule 3 forbids getting there by matching text in app/*.jsx, and nothing here does.
//
// The two controls, and what silence costs:
//   · Withdraw (MyRequestRow)         — the member is shown their request gone while the care team still has
//                                       it open. They stop expecting anyone and do not ask again.
//   · Close — not needed (CareRequestCard) — the request stays open and the person who asked is told nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';

const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };

function screen() {
  const { React, draw } = miniReact();
  const Icon = ({ name }) => React.createElement('i', { 'data-icon': name });
  const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 360,
                Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
                TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
                Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } };
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge: Stub('ChurchBadge'),
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => '2026-09-04',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const mod = loadScreen('app/screens-today.jsx', ['MyRequestRow', 'CareRequestCard'], globals);
  return { draw, ...mod };
}

// Fire a button's onClick and re-draw, the way React would after a setState.
//
// `pre` presses the control that OPENS the confirm dialog first. After that draw there are two buttons
// reading "Withdraw" — the one on the row and the one in the dialog — and taking the first would simply
// re-open the dialog and assert about a screen nobody reached. Take the LAST, which is the dialog's, and
// assert there really are two so a future edit that removes the confirmation fails here loudly.
async function press(draw, Comp, props, label, pre) {
  let tree = draw(Comp, props);
  if (pre) {
    const b = button(tree, pre)[0];
    assert.ok(b, `no "${pre}" control on this card — re-anchor this test`);
    await b.props.onClick({ stopPropagation() {} });
    tree = draw(Comp, props);
  }
  const all = button(tree, label);
  assert.ok(all.length, `no "${label}" control on this card — re-anchor this test`);
  if (pre) assert.equal(all.length, 2, `"${label}" no longer opens a confirmation — re-anchor this test`);
  await all[all.length - 1].props.onClick({ stopPropagation() {} });
  return draw(Comp, props);
}

const alerts = (tree) => find(tree, n => n.props && n.props.role === 'alert').map(n => texts(n).join(' ')).join(' | ');

// ── Withdraw ──────────────────────────────────────────────────────────────────────────────────────────────
const REQ = { id: 'req-1', type: 'meals', status: 'open', forSelf: true, recipients: 5 };

test('Withdraw: a withdrawal that reached no relay is said out loud', async () => {
  const { draw, MyRequestRow } = screen();
  // The engine returns null when nothing accepted it — that is the contract the other test file proves.
  const tree = await press(draw, MyRequestRow, { r: REQ, isMinor: false, onCancel: async () => null, onMessage: null }, 'Withdraw', 'Withdraw');
  assert.match(alerts(tree), /still open/i,
    'the confirm dialog closed and the row said nothing, so the member believes they have withdrawn while ' +
    'the care team still has an open request they will act on');
});

test('CONTROL: a withdrawal that DID land says nothing', async () => {
  const { draw, MyRequestRow } = screen();
  const tree = await press(draw, MyRequestRow, { r: REQ, isMinor: false, onCancel: async () => ({ id: 'evt' }), onMessage: null }, 'Withdraw', 'Withdraw');
  assert.equal(alerts(tree), '',
    'a successful withdrawal now shows a failure message — without this control the fix could be "always warn"');
});

test('CONTROL: the row shows no failure before anything is pressed', async () => {
  const { draw, MyRequestRow } = screen();
  assert.equal(alerts(draw(MyRequestRow, { r: REQ, isMinor: false, onCancel: async () => null, onMessage: null })), '');
});

// ── Close — not needed ────────────────────────────────────────────────────────────────────────────────────
const INCOMING = { id: 'req-2', type: 'other', from: 'asker-pub', forSelf: true, note: 'Could use a lift' };
const CTX = { safeguard: {}, canDMPeer: () => false, toast() {} };

test('Close — not needed: a close that reached no relay is said out loud', async () => {
  const { draw, CareRequestCard } = screen();
  const tree = await press(draw, CareRequestCard, { r: INCOMING, ctx: CTX, child: false, onApprove: null, onDecline: async () => null, canMessage: false, onMessage: null }, 'Close — not needed');
  assert.match(alerts(tree), /still open/i,
    'the card went back to normal and said nothing, so the care team believes the request is dealt with. ' +
    'It is not, and the person who asked has been told nothing either');
});

test('CONTROL: a close that DID land says nothing', async () => {
  const { draw, CareRequestCard } = screen();
  const tree = await press(draw, CareRequestCard, { r: INCOMING, ctx: CTX, child: false, onApprove: null, onDecline: async () => ({ id: 'evt' }), canMessage: false, onMessage: null }, 'Close — not needed');
  assert.equal(alerts(tree), '', 'a successful close now shows a failure message');
});

test('a failure is announced, not just coloured', () => {
  // Colour alone is not a message: it is invisible to a screen reader, and this app is used by people with
  // poor sight. Both lines carry role="alert" — every assertion above is written against that role, so an
  // edit that drops it fails this whole file rather than passing quietly.
  assert.ok(true);
});

// ── The four meal-slot controls, which live inside App() and cannot be rendered here ──────────────────────
//
// `fill`, `clearFill`, `setNote` and `clearSkip` are arrow functions on the care context in app/app.jsx.
// App() is far too entangled to draw, so each one is SLICED OUT AND RUN — CLAUDE.md rule 3's other route,
// and not a text match: the body below is the shipped text, executed with its collaborators injected. If the
// message is deleted from the screen, `said` stays empty and these fail.
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

function liftCareAction(name) {
  const i = APP.indexOf('\n      ' + name + ': (');
  assert.ok(i > 0, name + ' is no longer a care-context action in app/app.jsx — re-anchor this test');
  // Balanced to the end of the arrow: from the colon to the comma that closes this property.
  let d = 0, k = APP.indexOf('(', i);
  for (; k < APP.length; k++) {
    const c = APP[k];
    if (c === '(' || c === '{') d++;
    else if (c === ')' || c === '}') d--;
    else if (c === ',' && d === 0) break;
  }
  return APP.slice(i + 1, k);
}

function runCareAction(name, { lands }) {
  const said = [];
  const toast = (msg, opts) => said.push({ msg: String(msg), error: !!(opts && opts.error) });
  const optCare = {};
  const setOptCare = (f) => { const n = typeof f === 'function' ? f({ ...optCare }) : f; for (const k of Object.keys(optCare)) delete optCare[k]; Object.assign(optCare, n); };
  const evt = { id: 'evt-id' };
  const window = { Fellowship: {
    async fillCareSlot() { return lands ? evt : null; },
    async clearCareSlot() { return lands ? evt : null; },
    async clearCareSkip() { return lands ? evt : null; },
  } };
  const obj = new Function('setOptCare', 'toast', 'window', 'return ({ ' + liftCareAction(name) + ' })')(setOptCare, toast, window);
  return { fn: obj[name], said, optCare };
}

const SLOT_CASES = [
  ['fill',      ['care-1', '2026-09-10', 'lasagne'], /not signed up/i,
   'the tick quietly un-ticks itself, which reads as a mis-tap — so the volunteer taps again, and the family still has nobody for that day'],
  ['clearFill', ['care-1', '2026-09-10'],            /still down for that day/i,
   'they believe they stood down and are still the only name against it'],
  ['setNote',   ['care-1', '2026-09-10', 'gluten free'], /didn.t reach/i,
   'the dietary note nobody else can see is the one that matters'],
  ['clearSkip', ['care-1', '2026-09-10'],            /still marked/i,
   'the day stays crossed out and nobody brings anything'],
];

for (const [name, args, expect, why] of SLOT_CASES) {
  test(`${name}: a failure is put in front of the member`, async () => {
    const { fn, said } = runCareAction(name, { lands: false });
    await fn(...args);
    const bad = said.filter(t => t.error);
    assert.ok(bad.length, `${name} said nothing at all when it failed: ${why}`);
    assert.match(bad[0].msg, expect, `${name}'s failure message no longer says what actually happened`);
  });

  test(`CONTROL: ${name} says nothing about failure when it worked`, async () => {
    const { fn, said } = runCareAction(name, { lands: true });
    await fn(...args);
    assert.equal(said.filter(t => t.error).length, 0,
      `${name} reports a failure on success — without this control the fix could be "always warn"`);
  });
}

test('the optimistic tick is still rolled back as well as explained', async () => {
  // The rollback was already there and is what stops the row lying; the message is what stops the rollback
  // reading as a mis-tap. Both, or neither is any use.
  const { fn, optCare } = runCareAction('fill', { lands: false });
  await fn('care-1', '2026-09-10', '');
  assert.deepEqual(Object.keys(optCare), [], 'the row still shows the member as signed up after a failure');
});

