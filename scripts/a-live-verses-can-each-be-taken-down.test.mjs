// EACH LIVE VERSE ON THE CONSOLE'S VERSE-PROMPT CARD CAN BE TAKEN DOWN ON ITS OWN.
// Run: node --test scripts/a-live-verses-can-each-be-taken-down.test.mjs
//
// (1) An unscheduled ("now") prompt was one line "A; B; C" with a single whole-card Clear. Now each verse is its own row
//     with its own X; the X republishes the (replaceable) prompt document without that verse.
// (2) Adding a SCHEDULED verse on top of a live unscheduled one made members read the schedule alone, so the live verse
//     vanished from their Today card while the console still listed it. The live verse is now carried into the schedule.
// (3) The MEMBER read of the prompt (fellowship subscribeChurchVersePrompt) kept the first-arrived copy on a same-second
//     tie; the relay keeps the lowest event id. Now the same rule as the steward copy.
//
// POINT OF USE (rule 1): the real DashVersePrompt is rendered and its real X / Add / Set buttons are pressed.
// (3) is lifted from the SHIPPED bundle vendor/fellowship.js (rule 3: no text matching of app/*.jsx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compiled, common, press, reads, find } from './dash-render-kit.mjs';
import { fnBody } from './test-slice.mjs';

const T0 = new Date(2026, 9, 19, 10, 0, 0).getTime();
const sec = (ms) => Math.floor(ms / 1000);
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(T0); } static now() { return T0; } }

async function rig(existing) {
  const published = [], removed = [];
  const steward = {
    publishVersePrompt: (ref, note, schedule) => { published.push({ ref, schedule }); return Promise.resolve({ ref, note, schedule: schedule || [], ts: sec(T0) }); },
    removeVersePrompt: () => { removed.push(1); return Promise.resolve(); },
    subscribeVersePrompt: (cb) => { if (existing) cb(existing); return () => {}; },
  };
  const g = { ...common(), Date: FakeDate, VP_BOOKS: [['John', 21]], window: { Steward: steward, Bible: null },
    setTimeout: () => 0, clearTimeout: () => {} };
  const { C, draw } = await compiled('DashVersePrompt', g);
  return { C, draw, published, removed };
}
const xFor = (tree, ref) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === 'Take down ' + ref)[0];

test('(1) every unscheduled verse has its own X; it republishes the prompt without THAT verse', async () => {
  const r = await rig({ ref: 'John 3; Psalm 23; Romans 8', note: '', schedule: [], ts: sec(T0) - 60 });
  r.draw(r.C, {});
  let tree = r.draw(r.C, {});
  for (const v of ['John 3', 'Psalm 23', 'Romans 8']) assert.ok(xFor(tree, v), 'no take-down X for ' + v);
  await xFor(tree, 'Psalm 23').props.onClick();
  assert.equal(r.published.length, 1, 'taking one verse down did not republish');
  assert.equal(r.published[0].ref, 'John 3; Romans 8');
  assert.equal(r.published[0].schedule, undefined, 'stays an unscheduled prompt');
  assert.equal(r.removed.length, 0, 'one verse down must not clear the whole prompt');
  tree = r.draw(r.C, {});
  assert.doesNotMatch(reads(tree), /Psalm 23/, 'the card still lists the verse that was taken down');
  assert.match(reads(tree), /Romans 8/);
});

test('(1) taking down the LAST live verse clears the prompt', async () => {
  const r = await rig({ ref: 'John 3', note: '', schedule: [], ts: sec(T0) - 60 });
  r.draw(r.C, {});
  const tree = r.draw(r.C, {});
  await xFor(tree, 'John 3').props.onClick();
  assert.equal(r.removed.length, 1);
  assert.equal(r.published.length, 0);
});

test('(2) adding a SCHEDULED verse keeps the live unscheduled one visible to members', async () => {
  const r = await rig({ ref: 'John 3', note: '', schedule: [], ts: sec(T0) - 60 });
  r.draw(r.C, {});
  let tree = r.draw(r.C, {});
  const on = (label, value) => find(tree, n => n.props && n.props['aria-label'] === label)[0].props.onChange({ target: { value } });
  on('Book', 'John'); tree = r.draw(r.C, {});
  on('Chapter', '5'); tree = r.draw(r.C, {});
  await press(tree, /Add$/); tree = r.draw(r.C, {});
  // make the new row a FUTURE one: the row's date/time inputs
  const inputs = find(tree, n => n.type === 'input' && n.props && (n.props.type === 'date' || n.props.type === 'time'));
  const future = new Date(T0 + 86400000), p = (x) => String(x).padStart(2, '0');
  for (const i of inputs) i.props.onChange({ target: { value: i.props.type === 'date' ? future.getFullYear() + '-' + p(future.getMonth() + 1) + '-' + p(future.getDate()) : '10:00' } });
  tree = r.draw(r.C, {});
  await press(tree, /Set for church|Schedule/);
  assert.equal(r.published.length, 1, 're-anchor: nothing published');
  const sch = r.published[0].schedule || [];
  const live = sch.filter(s => s.at <= sec(T0)).map(s => s.ref);
  assert.deepEqual(live, ['John 3'], 'THE DEFECT: the live verse is not in the schedule, so members stop seeing it: ' + JSON.stringify(sch));
  assert.ok(sch.some(s => s.ref === 'John 5' && s.at > sec(T0)), 'the new verse is not scheduled for later');
});

// ── (3) the member read, from the shipped bundle ─────────────────────────────────────────────────────────────
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
function memberRig() {
  const at = BUNDLE.indexOf('    subscribeChurchVersePrompt(churchNpub, cb) {');
  assert.ok(at > 0 && BUNDLE.indexOf('    subscribeChurchVersePrompt(churchNpub, cb) {', at + 1) === -1, 'anchor must appear exactly once');
  const src = fnBody(BUNDLE, at + 4, 'subscribeChurchVersePrompt');
  let handlers = null;
  const _onChurchDocs = (_p, h) => { handlers = h; return () => {}; };
  const make = new Function('toPub', '_churchVoice', '_onChurchDocs', 'return ({ ' + src + ' });');
  const seen = [];
  make((x) => x, () => true, _onChurchDocs).subscribeChurchVersePrompt('npub', (v) => seen.push(v && v.ref));
  const ev = (id, ref, ts) => handlers.onevent({ id, pubkey: 'k', created_at: ts, tags: [], content: JSON.stringify({ ref, note: '', schedule: [] }) }, 'trinityone/verse-prompt');
  return { ev, seen };
}
test('(3) member read: an older copy never wins; a same-second tie goes to the LOWEST event id in either arrival order', () => {
  const o = memberRig(); o.ev('b'.repeat(8), 'New', 200); o.ev('a'.repeat(8), 'Old', 100);
  assert.deepEqual(o.seen, ['New']);
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const { ev, seen } = memberRig();
    for (const id of order) ev(id.repeat(8), id === 'a' ? 'Lower' : 'Higher', 300);
    assert.equal(seen[seen.length - 1], 'Lower', 'tie kept whichever arrived first (' + order.join('') + ')');
  }
  const d = memberRig(); d.ev('c'.repeat(8), 'X', 400); d.ev('c'.repeat(8), 'X', 400);
  assert.equal(d.seen.length, 1, 'the same event from a second relay was repainted');
});
