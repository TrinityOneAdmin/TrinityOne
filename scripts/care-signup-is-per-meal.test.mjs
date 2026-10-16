// A MEALS DAY SPLITS INTO ITS MEALS — each claimable on its own, with its own note + drop-off time.
//   Run: node --test scripts/care-signup-is-per-meal.test.mjs
//
// Owner 2026-10-16 ("B — separate signup per meal, cleaner"): a day that needs Lunch AND Dinner now shows two
// rows, so one person can bring Lunch and another Dinner, each saying what they're bringing. The steward can
// attach an optional drop-off time per meal. Additive at the relay: a slot's d-tag gains ":<meal>", and a
// LEGACY slot (no meal) still covers the whole day so sign-ups written before this keep reading as covered.
//
// POINT OF USE (rules 1, 3): renders the shipped CareNeedRow and reads the drawn tree / the args passed to
// care.fill. A per-DAY regression (one row, one "I'll help") reddens the two-button assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, button } from './render-jsx-screen.mjs';

const ME = 'aa', OTHER = 'cc', RECIP = 'bb';
function row({ slots = [], canVolunteer = true, slotTimes = {} } = {}) {
  const { React, draw } = miniReact();
  const Stub = (n) => function S(p) { return React.createElement('div', { 'data-stub': n }, p && p.children); };
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    SectionLabel: Stub('SectionLabel'), todayISO: () => '2026-10-19',
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 360,
      Fellowship: { displayFor: () => null, closeMyCareNeed: async () => ({ ok: true }) } },
  };
  const { CareNeedRow } = loadScreen('app/screens-today.jsx', ['CareNeedRow'], globals);
  const filled = [], cleared = [], noted = [];
  const need = { id: 'n1', recipient: RECIP, displayLabel: 'The Okafors', type: 'meals',
    dates: ['2026-10-20'], meals: ['lunch', 'dinner'], slotTimes };
  const care = { myPub: ME, fill: (...a) => filled.push(a), clearFill: (...a) => cleared.push(a),
    setNote: (...a) => { noted.push(a); return Promise.resolve({ ok: true }); }, skip() {}, clearSkip() {} };
  const props = { need, slots, skips: [], care, canManage: false, expanded: true, onToggle() {}, canVolunteer };
  draw(CareNeedRow, props);
  const tree = draw(CareNeedRow, props);
  return { tree, words: texts(tree).join(' | '), filled, cleared, noted };
}

test('a Lunch+Dinner day shows two separately-claimable rows', () => {
  const r = row();
  assert.match(r.words, /Lunch/, 'the Lunch unit is missing');
  assert.match(r.words, /Dinner/, 'the Dinner unit is missing');
  assert.equal(button(r.tree, 'I’ll help').length, 2, 'a meals day is still one "I’ll help", not one per meal. Shown: ' + r.words);
});

test('claiming Dinner publishes a slot for that meal, not the whole day', () => {
  const r = row();
  const btns = button(r.tree, 'I’ll help');   // units render in need.meals order: lunch, dinner
  btns[1].props.onClick();
  assert.deepEqual(r.filled, [['n1', '2026-10-20', undefined, 'dinner']],
    'claiming Dinner did not pass meal="dinner" to care.fill — it would sign up for the whole day. Got: ' + JSON.stringify(r.filled));
});

test('a per-meal slot covers only its meal; the other stays open', () => {
  const r = row({ slots: [{ needId: 'n1', isoDate: '2026-10-20', pubkey: OTHER, meal: 'dinner' }] });
  assert.equal(button(r.tree, 'I’ll help').length, 1, 'Dinner taken should leave only Lunch open — got ' + button(r.tree, 'I’ll help').length + ' open. Shown: ' + r.words);
  assert.match(r.words, /Covered/, 'the taken Dinner does not read as covered');
});

test('a LEGACY whole-day slot (no meal) covers every meal of that day', () => {
  const r = row({ slots: [{ needId: 'n1', isoDate: '2026-10-20', pubkey: OTHER, meal: '' }] });
  assert.equal(button(r.tree, 'I’ll help').length, 0, 'a legacy day sign-up left meals offered as still open — old sign-ups would be double-booked. Shown: ' + r.words);
});

test("the steward's optional drop-off time shows on the meal", () => {
  const r = row({ slotTimes: { '2026-10-20:dinner': '18:00' } });
  assert.match(r.words, /6pm/, 'the per-meal drop-off time 18:00 did not render as "6pm". Shown: ' + r.words);
});

test('a confirmed child is offered no "I’ll help" on any meal', () => {
  const r = row({ canVolunteer: false });
  assert.equal(button(r.tree, 'I’ll help').length, 0, 'a child was offered a per-meal sign-up. Shown: ' + r.words);
});
