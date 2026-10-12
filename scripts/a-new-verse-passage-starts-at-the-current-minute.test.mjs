// A NEW VERSE-PROMPT PASSAGE'S "WHEN" STARTS AT THE CURRENT LOCAL MINUTE (owner 2026-10-12: "The set for church time
// needs to default to the current time").
//   Run: node --test scripts/a-new-verse-passage-starts-at-the-current-minute.test.mjs
//
// WHAT "EMPTY" USED TO MEAN. A row with no date/time was an IMMEDIATE passage: push() left it out of the schedule and
// published it as a plain ref (no schedule array). The member app shows a plain prompt at once.
// THE FIX. addRef() fills the row with today's local date and HH:MM. push() treats a row dated at or before now as that same
// immediate passage (no schedule entry), unless a future row or an existing schedule is present - then it is kept as a
// past schedule entry, which members show at once (screens-today: s.at <= now).
//
// Rule 1: the real DashVersePrompt is rendered and its real Add / Set for church controls pressed. Rule 3: no text-matching
// of app/*.jsx. Users of shared code (rule 2): addRef, push and the button label are used only by DashVersePrompt;
// Steward.publishVersePrompt (callers in this component: push, saveEditSch, removeSchEntry; unchanged) is not edited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled, common, press, find, said } from './dash-render-kit.mjs';

// a fixed local clock: 2026-10-12 09:07:41 local
const FIXED = new Date(2026, 9, 12, 9, 7, 41).getTime();
let clock = FIXED;
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }

async function rig({ existing = null } = {}) {
  const published = [];
  const steward = {
    publishVersePrompt: (ref, note, schedule) => { published.push({ ref, schedule }); return Promise.resolve({}); },
    removeVersePrompt: () => Promise.resolve(),
    subscribeVersePrompt: (cb) => { if (existing) cb(existing); return () => {}; },
  };
  const g = { ...common(), Date: FakeDate, VP_BOOKS: [['John', 21]], window: { Steward: steward, Bible: null } };
  const { C, draw } = await compiled('DashVersePrompt', g);
  return { C, draw, published };
}
const onChange = (tree, label, value) => find(tree, n => n.props && n.props['aria-label'] === label)[0].props.onChange({ target: { value } });
async function addJohn3(r) {
  let tree = r.draw(r.C, {});
  onChange(tree, 'Book', 'John'); tree = r.draw(r.C, {});
  onChange(tree, 'Chapter', '3'); tree = r.draw(r.C, {});
  await press(tree, /Add$/);
  return r.draw(r.C, {});
}
const inputs = (tree, type) => find(tree, n => n.props && n.props.type === type && n.props.value !== undefined && !n.props['aria-label']);
const setInput = (tree, type, v) => inputs(tree, type)[0].props.onChange({ target: { value: v } });
const sendButton = (tree) => said(find(tree, n => n.props && n.props.onClick && /Set for church|Schedule/.test(said(n)))[0]);

test('a passage just added holds today’s LOCAL date and the current minute', async () => {
  clock = FIXED;
  const r = await rig();
  const tree = await addJohn3(r);
  assert.equal(inputs(tree, 'date')[0].props.value, '2026-10-12', 'the date input did not start at today (local)');
  assert.equal(inputs(tree, 'time')[0].props.value, '09:07', 'the time input did not start at the current minute');
});

test('the date is LOCAL, not UTC, late in the evening', async () => {
  clock = new Date(2026, 9, 12, 23, 59, 30).getTime();
  const r = await rig();
  const tree = await addJohn3(r);
  assert.equal(inputs(tree, 'date')[0].props.value, '2026-10-12');
  assert.equal(inputs(tree, 'time')[0].props.value, '23:59');
});

test('Set for church, untouched, publishes an IMMEDIATE passage - no schedule - as an empty row used to', async () => {
  clock = FIXED;
  const r = await rig();
  const tree = await addJohn3(r);
  assert.match(sendButton(tree), /Set for church/, 'an untouched row should still offer "Set for church"');
  clock = FIXED + 25000;   // the steward takes a moment before pressing
  await press(tree, /Set for church/);
  assert.equal(r.published.length, 1);
  assert.equal(r.published[0].ref, 'John 3');
  assert.equal(r.published[0].schedule, undefined, 'an untouched row was scheduled instead of sent now');
});

test('a changed time is honoured: a later time is scheduled at exactly that local time and the button says Schedule', async () => {
  clock = FIXED;
  const r = await rig();
  let tree = await addJohn3(r);
  setInput(tree, 'time', '11:30'); tree = r.draw(r.C, {});
  assert.match(sendButton(tree), /Schedule/);
  await press(tree, /Schedule/);
  assert.deepEqual(r.published[0].schedule, [{ at: Math.floor(new Date(2026, 9, 12, 11, 30).getTime() / 1000), ref: 'John 3', note: '' }]);
});

test('with a schedule already on the prompt, an untouched row is kept as a past entry so members still see it', async () => {
  clock = FIXED;
  const at = Math.floor(FIXED / 1000) + 86400;
  const r = await rig({ existing: { ref: 'Psalm 1', note: '', schedule: [{ at, ref: 'Psalm 1', note: '' }], ts: 1 } });
  const tree = await addJohn3(r);
  await press(tree, /Set for church|Schedule/);
  const sch = r.published[0].schedule;
  assert.deepEqual(sch.map(s => s.ref), ['John 3', 'Psalm 1']);
  assert.equal(sch[0].at, Math.floor(new Date(2026, 9, 12, 9, 7).getTime() / 1000), 'the untouched row is not at the current minute');
});
