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

// ── the engine half, from the SHIPPED console bundle ──────────────────────────────────────────────────────
test('the console engine reports which publish failed', async () => {
  const BUNDLE = readFileSync(new URL('../vendor/steward-meals.js', import.meta.url), 'utf8');
  const i = BUNDLE.indexOf('async function approveCareRequest(');
  assert.ok(i > 0, 'approveCareRequest is not in vendor/steward-meals.js — re-anchor this test');
  let d = 0, end = i;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) { end = k + 1; break; } }
  }
  const src = '(' + BUNDLE.slice(i, end).replace(/^async function/, 'async function') + ')';
  const mk = (statusLands) => new Function('publishNeed', 'setCareRequestStatus', 'Array', 'Set', 'String',
    'return ' + src)(
      async () => ({ id: 'care-1' }),
      async () => (statusLands ? { id: 'status' } : null), Array, Set, String);

  const clean = await mk(true)(REQ, { dates: ['2026-09-10'], notes: '' });
  assert.equal(clean.stillOpen, false, 'CONTROL: a clean approval must not be flagged');
  const half = await mk(false)(REQ, { dates: ['2026-09-10'], notes: '' });
  assert.ok(half && half.id, 'the need was published and accepted — approve must not report total failure');
  assert.equal(half.stillOpen, true,
    'the console engine discarded the status result again, so the screen above it cannot know');
});
