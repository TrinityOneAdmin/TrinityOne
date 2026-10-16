// START CARE: a date-RANGE add + an optional per-meal DROP-OFF TIME (owner 2026-10-16).
//   Run: node --test scripts/care-start-range-and-per-meal-time.test.mjs
//
// Renders the shipped MealsNeedModal through the console harness and reads the drawn tree / the object handed
// to StewardMeals.publishNeed. Not a source-text match (rule 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const byAria = (tree, label) => nodes(tree).filter(n => n.props && n.props['aria-label'] === label);
const inputsAria = (tree, re) => nodes(tree).filter(n => n.type === 'input' && n.props && re.test(String(n.props['aria-label'] || '')));
const saveBtn = (tree) => nodes(tree).find(n => n.type === 'button' && /Save changes|Open this need/.test(texts(n).join(' ')));

function mount(need) {
  const { React, flush, fresh } = fakeReact();
  const captured = [];
  const { window } = fakeBrowser({ Steward: fakeSteward() });
  window.StewardMeals = { publishNeed: async (n) => { captured.push(n); return { id: 'n1' }; }, careTeamId: () => '' };
  const { MealsNeedModal } = loadConsole({ React, window, expr: '{ MealsNeedModal }' });
  fresh();
  const draw = () => { const t = MealsNeedModal({ need, onClose() {}, onSaved() {}, onDeleted() {} }); flush(); return t; };
  return { draw, captured };
}

// edit an existing MEALS need: one day, lunch + dinner, a dinner drop-off time already set
const NEED = { id: 'n1', type: 'meals', displayLabel: 'The Okafors', dates: ['2026-10-20'], meals: ['lunch', 'dinner'],
  dayMeals: {}, slotTimes: { '2026-10-20:dinner': '18:00' }, notes: '', recipient: '', dietary: [] };

test('a date RANGE can be added alongside single days', () => {
  const { draw } = mount(NEED);
  const tree = draw();
  assert.equal(byAria(tree, 'Range from').length, 1, 'no "from" date input for a range');
  assert.equal(byAria(tree, 'Range to').length, 1, 'no "to" date input for a range');
});

test('each meal of a day gets its own optional drop-off time input, pre-filled from the need', () => {
  const { draw } = mount(NEED);
  const tree = draw();
  const times = inputsAria(tree, /Drop-off time for (Lunch|Dinner) on 2026-10-20/);
  assert.equal(times.length, 2, 'expected a drop-off time input for Lunch and for Dinner — got ' + times.length);
  const dinner = inputsAria(tree, /Drop-off time for Dinner on 2026-10-20/)[0];
  assert.equal(dinner.props.value, '18:00', 'the Dinner drop-off time did not pre-fill from the saved need');
});

test('saving hands the per-meal drop-off times to publishNeed', () => {
  const { draw, captured } = mount(NEED);
  const tree = draw();
  const btn = saveBtn(tree);
  assert.ok(btn, 're-anchor: no Save button on the care modal');
  btn.props.onClick();
  assert.equal(captured.length, 1, 'Save did not call publishNeed');
  assert.equal(captured[0].slotTimes && captured[0].slotTimes['2026-10-20:dinner'], '18:00',
    'publishNeed was not given the per-meal drop-off time. Got: ' + JSON.stringify(captured[0].slotTimes));
});

test('a NON-meals need gets a day-level time input instead of per-meal', () => {
  const { draw } = mount({ ...NEED, type: 'rides', meals: [] });
  const tree = draw();
  assert.equal(inputsAria(tree, /Drop-off time for /).length, 0, 'a rides need still shows per-meal time inputs');
  assert.equal(inputsAria(tree, /Time on 2026-10-20/).length, 1, 'a rides need has no day-level time input');
});
