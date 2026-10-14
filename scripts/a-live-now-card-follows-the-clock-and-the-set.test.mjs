// THE CONSOLE'S VERSE-PROMPT CARD MUST FOLLOW THE CLOCK AND THE STEWARD'S OWN "SET FOR CHURCH".
// Run: node --test scripts/a-live-now-card-follows-the-clock-and-the-set.test.mjs
//
// (3a) The card said "Scheduled" for a passage whose moment had passed until something unrelated re-rendered it:
//      `nowSec` was read at render time and nothing woke the panel when the schedule came due.
// (3b) After "Set for church" the card showed the OLD prompt until the relay echoed the write back (clear() set its
//      state at once; push() did not). And the engine's guard against an older copy overwriting a newer one used `>=`,
//      which on an exact same-second tie keeps whichever copy ARRIVED first, where the relay keeps the lowest event id.
//      (Our own back-to-back writes never tie: feChurch -> _monotonic bumps a same-document write to last+1; that is
//      pinned below, so nobody "fixes" the stamping for a problem it does not have.)
//
// POINT OF USE (rule 1): the real DashVersePrompt is rendered; its real timer is fired; its real button is pressed.
// Rule 3: no text-matching of app/*.jsx. The engine half is lifted from the BUNDLE (vendor/steward.js) and run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compiled, common, press, reads, find, said } from './dash-render-kit.mjs';
import { fnBody, stmt } from './test-slice.mjs';

const T0 = new Date(2026, 9, 12, 10, 29, 0).getTime();   // 10:29:00 local
let clock = T0;
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
const sec = (ms) => Math.floor(ms / 1000);

async function rig({ existing = null, publishResult } = {}) {
  const timers = [];
  const published = [];
  const steward = {
    publishVersePrompt: (ref, note, schedule) => {
      published.push({ ref, schedule });
      return Promise.resolve(publishResult ? publishResult(ref, schedule) : { ref, note, schedule: schedule || [], ts: sec(clock) });
    },
    removeVersePrompt: () => Promise.resolve(),
    subscribeVersePrompt: (cb) => { if (existing) cb(existing); return () => {}; },
  };
  const g = { ...common(), Date: FakeDate, VP_BOOKS: [['John', 21]], window: { Steward: steward, Bible: null },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; },
    clearTimeout: (id) => { if (timers[id]) timers[id].live = false; } };
  const { C, draw } = await compiled('DashVersePrompt', g);
  return { C, draw, timers, published };
}
const cardText = (tree) => reads(tree);
const vpAt = (atSec, ref = 'John 3') => ({ ref, note: '', schedule: [{ at: atSec, ref, note: '' }], ts: sec(T0) - 5 });

test('(3a) a scheduled passage flips from Scheduled to Live now when its moment arrives, with nothing else happening', async () => {
  clock = T0;
  const r = await rig({ existing: vpAt(sec(T0) + 60) });   // due at 10:30:00
  r.draw(r.C, {});
  let tree = r.draw(r.C, {});
  assert.match(cardText(tree), /Scheduled/, 're-anchor: a future passage should read Scheduled');
  assert.doesNotMatch(cardText(tree), /Live now/);
  const armed = r.timers.filter(t => t.live);
  assert.equal(armed.length >= 1, true, 'THE DEFECT: nothing is waiting for the scheduled moment, so the card can never change by itself');
  assert.ok(armed.some(t => t.ms >= 60000 && t.ms <= 61000), 'the timer is not aimed at the scheduled moment: ' + JSON.stringify(armed.map(t => t.ms)));
  clock = T0 + 60500;   // 10:30:00.5 - the moment has passed
  armed.find(t => t.ms >= 60000).fn();
  tree = r.draw(r.C, {});
  assert.match(cardText(tree), /Live now/, 'the moment passed, the timer fired, and the card still says it is not live');
});

test('(3a) a prompt with nothing pending arms no timer at all', async () => {
  clock = T0;
  const r = await rig({ existing: { ref: 'John 3', note: '', schedule: [], ts: sec(T0) - 5 } });
  r.draw(r.C, {}); r.draw(r.C, {});
  assert.equal(r.timers.filter(t => t.live).length, 0, 'a card with no future entry still keeps a timer running');
  const r2 = await rig({ existing: vpAt(sec(T0) - 30) });   // already due
  r2.draw(r2.C, {}); r2.draw(r2.C, {});
  assert.equal(r2.timers.filter(t => t.live).length, 0, 'an already-live schedule keeps a timer running');
});

test('(3b) after Set for church the card shows the new passage WITHOUT waiting for a relay echo', async () => {
  clock = T0;
  const r = await rig({ existing: { ref: 'Psalm 23', note: '', schedule: [], ts: sec(T0) - 5 } });
  r.draw(r.C, {});
  let tree = r.draw(r.C, {});
  assert.match(cardText(tree), /Psalm 23/, 're-anchor: the existing prompt is not on the card');
  const on = (label, value) => find(tree, n => n.props && n.props['aria-label'] === label)[0].props.onChange({ target: { value } });
  on('Book', 'John'); tree = r.draw(r.C, {});
  on('Chapter', '3'); tree = r.draw(r.C, {});
  await press(tree, /Add$/); tree = r.draw(r.C, {});
  clock = T0 + 5000;
  await press(tree, /Set for church/);
  assert.equal(r.published.length, 1, 're-anchor: nothing was published');
  tree = r.draw(r.C, {});
  assert.match(cardText(tree), /John 3/, 'THE DEFECT: the card still shows the old prompt; it depends entirely on the relay echo');
});

test('(3b) a publish that did not land (no stamp) does not repaint the card as if it had', async () => {
  clock = T0;
  const r = await rig({ publishResult: (ref, schedule) => ({ ref, note: '', schedule: schedule || [], ts: false }) });
  r.draw(r.C, {});
  let tree = r.draw(r.C, {});
  const on = (label, value) => find(tree, n => n.props && n.props['aria-label'] === label)[0].props.onChange({ target: { value } });
  on('Book', 'John'); tree = r.draw(r.C, {});
  on('Chapter', '3'); tree = r.draw(r.C, {});
  await press(tree, /Add$/); tree = r.draw(r.C, {});
  await press(tree, /Set for church/);
  tree = r.draw(r.C, {});
  assert.doesNotMatch(cardText(tree), /John 3/, 'a blocked publish painted the card as though the church had it');
});

// ── the engine half, lifted from the bundle ─────────────────────────────────────────────────────────────────
const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
function subscribeRig() {
  const src = fnBody(BUNDLE, BUNDLE.indexOf('    subscribeVersePrompt(cb) {') + 4, 'subscribeVersePrompt');
  let handlers = null;
  const pool = { subscribeMany: (_r, _f, h) => { handlers = h; return { close() {} }; } };
  const make = new Function('pool', 'relays', 'pub', 'VERSE_PROMPT_D', 'return ({ ' + src + ' });');
  const seen = [];
  make(pool, () => ['wss://x'], 'pub', 'd').subscribeVersePrompt((v) => seen.push(v && { ref: v.ref, ts: v.ts }));
  const ev = (id, ref, ts) => handlers.onevent({ id, created_at: ts, tags: [], content: JSON.stringify({ ref, note: '', schedule: [] }) });
  return { ev, seen };
}

test('(3b) engine: an OLDER copy never overwrites a newer one', () => {
  const { ev, seen } = subscribeRig();
  ev('b'.repeat(8), 'John 3', 200); ev('a'.repeat(8), 'Psalm 1', 100);
  assert.deepEqual(seen.map(s => s.ref), ['John 3'], 'an older copy replaced a newer one');
});

test('(3b) engine: a same-second tie resolves to the LOWEST event id, as the relay does - in either arrival order', () => {
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const { ev, seen } = subscribeRig();
    for (const id of order) ev(id.repeat(8), id === 'a' ? 'Lower id' : 'Higher id', 300);
    assert.equal(seen[seen.length - 1].ref, 'Lower id', 'a tie kept whichever arrived first (' + order.join('') + '), not the relay\'s lowest id');
  }
});

test('(3b) engine: the SAME event arriving again from a second relay is not repainted', () => {
  const { ev, seen } = subscribeRig();
  ev('c'.repeat(8), 'John 3', 400); ev('c'.repeat(8), 'John 3', 400);
  assert.equal(seen.length, 1);
});

test('(3b) our own two writes in one second do not tie: _monotonic bumps the second to last+1', () => {
  const body = fnBody(BUNDLE, 'function _monotonic', '_monotonic');
  const run = new Function('_lastStamp', '_skewShift', 'STAMP_CAP_SEC', 'SKEW_CAP_SEC', 'Date', body + '\nreturn _monotonic;')(
    new Map(), () => 0, 600, 900, { now: () => 1_800_000_000_500 });
  const t = { kind: 30078, tags: [['d', 'verse']], created_at: 1_800_000_000 };
  const a = run(t).created_at, b = run(t).created_at;
  assert.ok(b > a, 'two writes of one document in one second got the same stamp: ' + a + ' / ' + b);
});
