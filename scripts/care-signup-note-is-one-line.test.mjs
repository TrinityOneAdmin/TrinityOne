// A meal a member has signed up for and noted collapses to ONE line: "Dinner · ✓ You · <dish> ✎" with a quiet
// "✓ Helping" cancel — the "what are you bringing?" input is hidden until you tap the pencil (owner 2026-10-17).
// Before: the dish showed TWICE (in the status AND an always-open input) and every signed-up row carried a loud
// outlined "You're helping" pill plus a solid Save button, so a signed-up meal was much taller than an open one.
// POINT OF USE (CLAUDE.md rules 1, 3): renders the shipped CareNeedRow and reads the drawn tree; no app/*.jsx
// text match. Reverting the collapse (always showing the input) reddens the "no open input" row below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';

const ME = 'aa', RECIP = 'bb';
function row({ note = '', by = ME, saveOk = true } = {}) {
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
  const need = { id: 'n1', recipient: RECIP, displayLabel: 'The Okafors', type: 'meals', dates: ['2026-10-20'], meals: ['dinner'] };
  const slot = { needId: 'n1', isoDate: '2026-10-20', meal: 'dinner', pubkey: by, note };   // a Dinner slot I hold
  const slots = [slot];
  const care = { myPub: ME, fill() {}, clearFill() {},
    setNote: (id, iso, n) => { if (saveOk) slot.note = n; return Promise.resolve({ ok: saveOk }); }, skip() {}, clearSkip() {} };
  const props = { need, slots, skips: [], care, canManage: false, expanded: true, onToggle() {}, canVolunteer: true };
  let tree = draw(CareNeedRow, props);
  const redraw = () => (tree = draw(CareNeedRow, props));
  const input = () => find(tree, n => n.type === 'input' && /bringing/.test(String((n.props || {}).placeholder || '')));
  return { tree: () => tree, words: () => texts(tree).join(' | '), input, redraw };
}

test('a noted sign-up collapses to one line: the dish shows ONCE, with no open input', () => {
  const r = row({ note: 'Chicken pie' });
  const words = r.words();
  assert.match(words, /Chicken pie/, 're-anchor: the dish did not render on the row at all');
  assert.equal((words.match(/Chicken pie/g) || []).length, 1,
    'the dish is shown more than once (the status AND the input) — a signed-up meal must read it once');
  assert.equal(r.input().length, 0,
    'the "what are you bringing" input is still open after a dish was saved — the row stays tall (the de-clutter was lost)');
  assert.match(words, /Helping/, 'the quiet "Helping" cancel control is missing from a meal I signed up for');
  assert.doesNotMatch(words, /\bYou\b(?!['’])/, 'the redundant "✓ You" is back on my own signup row — the Helping label already says it is mine');
});

test('an un-noted sign-up still shows the input so you can say what you are bringing', () => {
  const r = row({ note: '' });
  assert.equal(r.input().length, 1,
    'a signed-up meal with no dish yet must still offer the "what are you bringing" input');
  const tick = find(r.tree(), x => x.type === 'button' && (x.props['aria-label'] === 'Save' || x.props.title === 'Save'));
  assert.ok(tick.length, 'there is no tick/Save control to submit the dish beside the input');
});

test('tapping the pencil reopens the input to edit a saved dish', () => {
  const r = row({ note: 'Chicken pie' });
  assert.equal(r.input().length, 0, 'precondition: the input starts collapsed once a dish is saved');
  const edit = find(r.tree(), n => n.props && typeof n.props.onClick === 'function' && /Chicken pie/.test(texts(n).join(' ')));
  assert.ok(edit.length, 're-anchor: no tappable dish/pencil to reopen editing');
  edit[edit.length - 1].props.onClick();
  r.redraw();
  assert.equal(r.input().length, 1, 'tapping the pencil did not reopen the "what are you bringing" input');
});

test("a meal covered by someone else shows the DISH but not the helper's name", () => {
  // Owner 2026-10-17: others' rows should read just the dish + "Covered" — no name, no leading tick. careName
  // returns "A member" for an unknown pubkey, so its absence proves the name was dropped.
  const r = row({ by: 'zz', note: 'Shepherd pie' });
  const words = r.words();
  assert.match(words, /Shepherd pie/, 'the dish a helper is bringing is not shown on a covered meal');
  assert.match(words, /Covered/, 're-anchor: the meal no longer reads as covered');
  assert.doesNotMatch(words, /A member/, "the helper's name is shown on a covered meal — the owner wants just the dish + Covered");
});

test('re-editing a saved dish and FAILING to save keeps the editor OPEN (no false confirm)', async () => {
  // Guards saveNote's `if (r && r.ok)` collapse: a failed re-save must NOT collapse the editor as if it saved.
  const r = row({ note: 'Chicken pie', saveOk: false });
  const edit = find(r.tree(), n => n.props && typeof n.props.onClick === 'function' && /Chicken pie/.test(texts(n).join(' ')));
  assert.ok(edit.length, 're-anchor: no pencil to reopen editing');
  edit[edit.length - 1].props.onClick();
  r.redraw();
  assert.equal(r.input().length, 1, 'precondition: the pencil reopened the input');
  r.input()[0].props.onChange({ target: { value: 'Beef stew' } });
  r.redraw();
  await r.input()[0].props.onBlur();
  await new Promise(res => setTimeout(res, 0));
  r.redraw();
  assert.equal(r.input().length, 1,
    'a failed re-save collapsed the editor as if it had saved — a false confirmation of a dish the church never got (collapse only on r.ok)');
});
