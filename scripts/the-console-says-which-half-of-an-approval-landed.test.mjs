// SETTING UP HELP IS TWO PUBLISHES, AND THE SECOND CAN FAIL ON ITS OWN.
// Run: node --test scripts/the-console-says-which-half-of-an-approval-landed.test.mjs
//
// "Set up help" on the steward console publishes a NEED, then marks the request approved so the person who
// asked can see what happened to them. If only the first lands, the console said "done" and closed the
// sheet: the need is live, the request still sits in the list as open — so the team works it a second time —
// and the asker goes on reading "your care team will be in touch" with no idea help was arranged.
//
// The engine half of this is in a-care-action-that-landed-nowhere-says-so.test.mjs. This is the screen half,
// which is the half CLAUDE.md rule 1 is about: the real components out of app/stew-meals.jsx, compiled with
// the same esbuild the build uses and rendered through the miniature React, with the tree read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';

const REQ = { id: 'req-1', from: 'asker-pub', forSelf: true, type: 'meals', note: 'Just had surgery', status: 'open' };

function screen(approve) {
  const { React, draw } = miniReact();
  const globals = {
    React, console, setTimeout, clearTimeout,
    Icon: function Icon() { return null; },
    document: { addEventListener() {}, removeEventListener() {} },
    window: {
      useStewardChurch: () => ({ npub: 'npub1church' }),
      useStewardMembers: () => [{ pubkey: 'asker-pub', name: 'Margaret' }],
      useStewardSafeguard: () => ({ minors: [], approved: [], minorsKnown: true }),
      StewardMeals: {
        subscribeCareRequests: (cb) => { cb([REQ]); return () => {}; },
        approveCareRequest: approve,
        declineCareRequest: async () => ({ id: 'evt' }),
      },
    },
  };
  const mod = loadScreen('app/stew-meals.jsx', ['StewApproveSheet', 'StewCareRequests'], globals);
  return { draw, ...mod };
}

const alerts = (tree) => find(tree, n => n.props && n.props.role === 'alert').map(n => texts(n).join(' ')).join(' | ');
const input = (tree, label) => find(tree, n => n.type === 'input' && n.props['aria-label'] === label)[0];

// Fill the two date boxes, then press the button that publishes.
async function openTheNeed(draw, Sheet, props) {
  let tree = draw(Sheet, props);
  for (const [label, v] of [['From', '2026-09-10'], ['To', '2026-09-10']]) {
    const el = input(tree, label);
    assert.ok(el, `no "${label}" date box on the sheet — re-anchor this test`);
    el.props.onChange({ target: { value: v } });
    tree = draw(Sheet, props);
  }
  const b = button(tree, 'Open the need')[0];
  assert.ok(b && !b.props.disabled, 'the publish button is missing or still disabled — re-anchor this test');
  await b.props.onClick({ stopPropagation() {} });
  return draw(Sheet, props);
}

test('a total failure keeps the sheet open and says so', async () => {
  const { draw, StewApproveSheet } = screen(async () => null);
  let done = 'not called';
  const tree = await openTheNeed(draw, StewApproveSheet, { req: REQ, who: 'Margaret', onClose() {}, onDone: (r) => { done = r; } });
  assert.equal(done, 'not called', 'the sheet reported success and closed when nothing was published at all');
  assert.match(alerts(tree), /didn’t reach the church/i,
    'the sheet said nothing when the need could not be published — the steward believes help is arranged');
});

test('the half-done case is reported as half done, not as success', async () => {
  const { draw, StewApproveSheet } = screen(async () => ({ id: 'care-1', stillOpen: true }));
  let done = null;
  await openTheNeed(draw, StewApproveSheet, { req: REQ, who: 'Margaret', onClose() {}, onDone: (r) => { done = r; } });
  assert.ok(done, 'the sheet must still finish — the need really was published');
  assert.equal(done.stillOpen, true,
    'the sheet swallowed the "request was never closed" flag, so nothing downstream can tell the steward');
});

test('CONTROL: a clean approval finishes with nothing flagged', async () => {
  const { draw, StewApproveSheet } = screen(async () => ({ id: 'care-1', stillOpen: false }));
  let done = null;
  const tree = await openTheNeed(draw, StewApproveSheet, { req: REQ, who: 'Margaret', onClose() {}, onDone: (r) => { done = r; } });
  assert.ok(done && !done.stillOpen, 'a clean approval must not be flagged — without this the fix could be "always warn"');
  assert.equal(alerts(tree), '', 'a clean approval shows a failure line');
});

// ── and the list must actually PUT that in front of the steward ───────────────────────────────────────────
function requestsList(approve) {
  const { draw, StewCareRequests } = screen(approve);
  const props = { church: { npub: 'npub1church' } };
  return { draw, StewCareRequests, props };
}

async function approveThroughTheList(approve) {
  const { draw, StewCareRequests, props } = requestsList(approve);
  // The list arrives through an effect, so the first draw is always empty — exactly as it is on a real
  // console for an instant. Draw again to get the state the steward actually looks at.
  draw(StewCareRequests, props);
  let tree = draw(StewCareRequests, props);
  const b = button(tree, 'Set up help')[0];
  assert.ok(b, 'no "Set up help" control on the request row — re-anchor this test');
  b.props.onClick({ stopPropagation() {} });
  tree = draw(StewCareRequests, props);
  const sheet = find(tree, n => typeof n.type === 'function' && n.type.name === 'StewApproveSheet')[0];
  assert.ok(sheet, 'the approve sheet did not open — re-anchor this test');
  // Drive the sheet's own contract rather than its internals: the list is what is under test here.
  sheet.props.onDone(await approve());
  return draw(StewCareRequests, props);
}

test('the list tells the steward the request is still open', async () => {
  const tree = await approveThroughTheList(async () => ({ id: 'care-1', stillOpen: true }));
  assert.match(alerts(tree), /still shows below/i,
    'the sheet closed and the list said nothing, so the steward has no way to know the request was never ' +
    'marked as dealt with — they will work it again, and the asker was told nothing');
});

test('CONTROL: a clean approval leaves the list quiet', async () => {
  const tree = await approveThroughTheList(async () => ({ id: 'care-1', stillOpen: false }));
  assert.equal(alerts(tree), '', 'a clean approval now warns the steward about nothing');
});

// ── the engine half, from the SHIPPED console bundle, with the REAL publishNeed ─────────────────────────
//
// The first version of this test stubbed `publishNeed`. The whole question is whether a REFUSED need publish
// is noticed, and the stub answered "it succeeded" — so it passed over a fix that did nothing. The audit of
// 2026-09-04 found it. Both functions are lifted now, and the only thing faked is the relay's answer.
//
// The trap underneath, worth stating because it will recur: `publish()` in steward.src.js returns **false**
// on total failure, and publishNeed used to wrap that as `{ id, ...rec, ts: false }` — TRUTHY, with an id.
// Three failure contracts in one codebase (false, a throw, a truthy wrapper) and this is the one that lies.
function consoleEngine({ needLands, statusLands }) {
  const BUNDLE = readFileSync(new URL('../vendor/steward-meals.js', import.meta.url), 'utf8');
  const lift = (decl) => {
    const i = BUNDLE.indexOf(decl);
    assert.ok(i > 0, decl + ' is not in vendor/steward-meals.js — re-anchor this test');
    let d = 0;
    for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
      if (BUNDLE[k] === '{') d++;
      else if (BUNDLE[k] === '}') { d--; if (!d) return BUNDLE.slice(i, k + 1); }
    }
    throw new Error('unbalanced braces slicing ' + decl);
  };
  const published = [];
  const S = () => ({
    churchPub: 'church-pub',
    careSeal: () => 'sealed-blob',
    careSealTo: () => null,
    careKeyChecked: () => true,
    async publishSigned(evt) {
      const d = (evt.tags.find(t => t[0] === 'd') || [])[1] || '';
      const lands = d.startsWith('finance') ? true : (d.includes('carereqstatus') ? statusLands : needLands);
      published.push({ d, lands });
      return lands ? { ...evt, id: 'evt-id', created_at: evt.created_at } : false;   // publish() returns FALSE, not null
    },
  });
  const src = '(function(){' + [lift('async function publishNeed('), lift('function setCareRequestStatus('),
                                lift('async function approveCareRequest(')].join('\n')
    + '\nreturn { publishNeed, setCareRequestStatus, approveCareRequest };})()';
  const names  = ['S', 'uid', '_normNeed', 'SEALED_FIELDS', 'NEED_D', 'CARESTATUS_D', 'NET', 'now', '_rand32',
                  '_sha256hex', 'JSON', 'String', 'Array', 'Set', 'Number', 'console'];
  const values = [S, () => 'care-NEW', (n) => ({ ...n, dates: n.dates || [] }),
                  ['displayLabel', 'recipient', 'notes', 'dietary'], 'care:', 'carereqstatus:', 'trinityone',
                  () => 1756900000, () => 'secret', async () => 'hash', JSON, String, Array, Set, Number, { warn() {} }];
  const api = new Function(...names, 'return ' + src)(...values);
  return { ...api, published };
}

const APPROVE_ARGS = [{ id: 'req-1', from: 'asker', forSelf: true, type: 'meals', note: 'x' }, { dates: ['2026-09-10'], notes: '' }];

test('the need was REFUSED: approve reports total failure, and does not mark the request approved', async () => {
  const { approveCareRequest, published } = consoleEngine({ needLands: false, statusLands: true });
  const out = await approveCareRequest(...APPROVE_ARGS);
  assert.equal(out, null,
    'a need no relay accepted came back as a saved need, so the console said help was set up and marked the ' +
    "asker's request approved — pointing at a need that exists nowhere");
  assert.equal(published.filter(p => p.d.includes('carereqstatus')).length, 0,
    'the request was marked approved even though the need was refused');
});

test('BOTH refused: still a total failure, not "help is set up but…"', async () => {
  const { approveCareRequest } = consoleEngine({ needLands: false, statusLands: false });
  assert.equal(await approveCareRequest(...APPROVE_ARGS), null,
    'with nothing published at all the console said help WAS set up and only the request had not closed');
});

test('only the STATUS refused: help really is set up, so say which half', async () => {
  const { approveCareRequest } = consoleEngine({ needLands: true, statusLands: false });
  const out = await approveCareRequest(...APPROVE_ARGS);
  assert.ok(out && out.id, 'the need was published and accepted — this must not report total failure');
  assert.equal(out.stillOpen, true, 'the request was never marked approved and nothing said so');
});

test('CONTROL: everything accepted is a clean approval', async () => {
  const { approveCareRequest } = consoleEngine({ needLands: true, statusLands: true });
  const out = await approveCareRequest(...APPROVE_ARGS);
  assert.ok(out && out.id, 'a clean approval must return the need');
  assert.equal(out.stillOpen, false, 'a clean approval is flagged — without this control the fix could be "always warn"');
});

test('publishNeed itself answers null for a refused publish', async () => {
  const { publishNeed } = consoleEngine({ needLands: false, statusLands: true });
  assert.equal(await publishNeed({ type: 'meals', dates: ['2026-09-10'], displayLabel: 'A member' }), null,
    'publishNeed wrapped a FALSE publish in a truthy object carrying an id, so every caller read it as saved');
  const ok = consoleEngine({ needLands: true, statusLands: true });
  const saved = await ok.publishNeed({ type: 'meals', dates: ['2026-09-10'], displayLabel: 'A member' });
  assert.ok(saved && saved.id, 'CONTROL: a need that WAS accepted must still come back');
});

// ── the OTHER caller of publishNeed: the console's own need sheet (rule 2) ────────────────────────────────
function needSheet(publishNeedResult) {
  const { React, draw } = miniReact();
  const globals = {
    React, console, setTimeout, clearTimeout,
    Icon: function Icon() { return null; },
    todayISO: () => '2026-09-04',
    document: { addEventListener() {}, removeEventListener() {} },
    window: {
      confirm: () => false,
      useStewardChurch: () => ({ npub: 'npub1church' }),
      useStewardMembers: () => [],
      useStewardSafeguard: () => ({ minors: [], approved: [], minorsKnown: true }),
      StewardMeals: { publishNeed: async () => publishNeedResult, removeNeed: async () => true },
    },
  };
  return { draw, ...loadScreen('app/stew-meals.jsx', ['MealsNeedModal'], globals) };
}

const EXISTING = { id: 'care-1', displayLabel: 'The Ellis family', type: 'meals', dates: ['2026-09-10'],
                   notes: '', recipient: '', dietary: [], meals: ['dinner'], dayMeals: {} };

test('the need sheet does not close as saved over a refused publish', async () => {
  const { draw, MealsNeedModal } = needSheet(null);
  let saved = 'not called';
  const props = { need: EXISTING, onClose() {}, onSaved: (x) => { saved = x; }, onDeleted() {} };
  let tree = draw(MealsNeedModal, props);
  const b = button(tree, 'Save')[0];
  assert.ok(b, 'no Save control on the need sheet — re-anchor this test');
  await b.props.onClick({ stopPropagation() {} });
  tree = draw(MealsNeedModal, props);
  assert.equal(saved, 'not called',
    'the sheet reported the need saved when no relay accepted it, so a steward who had just typed a family ' +
    "name and dates was returned to a needs list that does not carry it");
  assert.match(texts(tree).join(' '), /didn.t reach the church/i, 'and nothing on screen said why');
});

test('CONTROL: a need that saved still closes the sheet', async () => {
  const { draw, MealsNeedModal } = needSheet({ id: 'care-1' });
  let saved = 'not called';
  const props = { need: EXISTING, onClose() {}, onSaved: (x) => { saved = x; }, onDeleted() {} };
  const tree = draw(MealsNeedModal, props);
  await button(tree, 'Save')[0].props.onClick({ stopPropagation() {} });
  assert.notEqual(saved, 'not called', 'a successful save no longer finishes — the fix must not close the door');
});

