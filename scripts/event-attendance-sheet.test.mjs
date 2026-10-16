// EVENT ATTENDANCE CARD — the steward event detail shows COUNT chips; the names live behind a tap.
//   Run: node --test scripts/event-attendance-sheet.test.mjs
//
// Point of use (CLAUDE.md rules 1 and 3): the real SchEventDetail is compiled from app/stew-schedule.jsx and
// RENDERED through a miniature React; the chips' onClick handlers are pressed and the tree is drawn again.
// Nothing here matches text in app/*.jsx.
//
// Users of the code touched (rule 2):
//   schRsvpGroups  : the Schedule list's rsvpSummary (in the Schedule page) and SchEventDetail.
//                    SchEventMessage keeps its own audience logic, untouched.
//   SchEventDetail : mounted by the Schedule page and by app/stew-dashboard.jsx (reused, call unchanged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SCH = readFileSync(join(ROOT, 'app/stew-schedule.jsx'), 'utf8');

function compile(src, names, globals) {
  const tmp = join(tmpdir(), 'evatt-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${names.join(', ')} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__evatt_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
}
function miniReact() {
  const states = []; let i = 0;
  const React = {
    useState(init) { const k = i++; if (!(k in states)) states[k] = typeof init === 'function' ? init() : init;
      return [states[k], (v) => { states[k] = typeof v === 'function' ? v(states[k]) : v; }]; },
    useMemo: (f) => f(), useEffect() {}, useRef: () => ({ current: null }), useCallback: (f) => f,
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }), Fragment: 'Fragment',
  };
  return { React, reset: () => { i = 0; } };
}
const texts = (n, out = []) => { if (n == null || n === false) return out; if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; } if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; } (n.kids || []).forEach(c => texts(c, out)); return out; };
const flat = (n) => texts(n).join(' ').replace(/\s+/g, ' ').trim();

const SRC = ['function schRsvpGroups(', 'function schAttendanceOrder(', 'function SchAttendance(', 'function SchEventDetail(']
  .map(a => fnBody(SCH, a, a)).join('\n');

const pk = (n) => String(n).padStart(2, '0').repeat(32);
const EVENT = { id: 'ev-1', title: 'Harvest supper', date: '2026-11-01' };
// 12 going + 1 going with no member record (shown as Anonymous) = 13 going.
function fixture({ going = 12, maybe = 2, no = 1, anon = true } = {}) {
  const members = []; const map = {};
  let n = 1;
  const add = (verdict, name) => { const p = pk(n++); if (name != null) members.push({ pubkey: p, name }); map[p] = verdict; };
  for (let g = 0; g < going; g++) add('going', 'Going' + g);
  if (anon) add('going', null);
  for (let m = 0; m < maybe; m++) add('maybe', 'Maybe' + m);
  for (let o = 0; o < no; o++) add('no', 'Nope' + o);
  return { members, rsvps: { 'ev-1': map } };
}
async function mount(fx, event = EVENT) {
  const { React, reset } = miniReact();
  const mod = await compile(SRC, ['SchEventDetail', 'schRsvpGroups'], {
    React, window: { useStewardRsvps: () => fx.rsvps, useStewardMembers: () => fx.members, Steward: {} },
    Icon: () => null, SchDateBlock: () => null, SchEventEdit: () => null, SchEventMessage: () => null, useStewDialog: () => null,
    schNthLabel: () => '',
  });
  const draw = () => { reset(); return mod.SchEventDetail({ event, onClose() {} }); };
  const chips = (t) => find(t, n => n.type === 'button' && n.props && /show names/.test(n.props['aria-label'] || ''));
  const dialog = (t) => find(t, n => typeof n.type === 'function' && n.type.name === 'SchAttendance');
  // The sibling overlay is a function component the mini React does not expand: call it to see what it puts up.
  const open = (t) => { const d = dialog(t)[0]; return d ? d.type(d.props) : null; };
  return { mod, draw, chips, dialog, open };
}
const chipFor = (m, t, word) => m.chips(t).find(c => c.props['aria-label'].includes(word));

test('schRsvpGroups: groups names by answer; ignores unknown answers, other events, missing data', async () => {
  const m = await mount(fixture());
  const f = m.mod.schRsvpGroups;
  const nameFor = (p) => 'N' + p;
  const r = { e1: { a: 'going', b: 'maybe', c: 'no', d: 'going', z: 'wibble' }, e2: { q: 'going' } };
  assert.deepEqual(f(r, 'e1', nameFor), { going: ['Na', 'Nd'], maybe: ['Nb'], no: ['Nc'] });
  assert.deepEqual(f(undefined, 'e1', nameFor), { going: [], maybe: [], no: [] });
  assert.deepEqual(f(r, 'missing', nameFor), { going: [], maybe: [], no: [] });
});

test('DETAIL: no attendee name is printed inline, only the three counts', async () => {
  const m = await mount(fixture());
  const t = m.draw(); const all = flat(t);
  assert.deepEqual(m.chips(t).map(c => flat(c)), ['13 going', '2 maybe', '1 can’t make it']);
  assert.doesNotMatch(all, /Going\d|Maybe\d|Nope\d|Anonymous/);
  assert.equal(m.dialog(t).length, 0, 'the names dialog must be closed until a chip is pressed');
});

for (const [word, prefix, expected] of [['going', 'Going', 13], ['maybe', 'Maybe', 2], ['can’t make it', 'Nope', 1]]) {
  test(`DETAIL: pressing the "${word}" chip opens a dialog listing exactly those people`, async () => {
    const m = await mount(fixture());
    chipFor(m, m.draw(), word).props.onClick();
    const t = m.draw();
    assert.equal(m.dialog(t).length, 1, 'the chip did not open the attendance dialog');
    const items = find(m.open(t), n => n.type === 'li').map(li => flat(li));
    assert.equal(items.length, expected);
    for (const it of items) {
      assert.ok(it.startsWith(prefix) || (prefix === 'Going' && it === 'Anonymous'), 'foreign name in the ' + word + ' list: ' + it);
    }
    assert.equal(items.includes('Anonymous'), prefix === 'Going');
  });
}

test('ATTENDANCE: alphabetical with Anonymous last', async () => {
  const fx = { members: [{ pubkey: pk(1), name: 'Zed' }, { pubkey: pk(2), name: 'Alice' }, { pubkey: pk(4), name: 'bob' }],
    rsvps: { 'ev-1': { [pk(1)]: 'going', [pk(2)]: 'going', [pk(3)]: 'going', [pk(4)]: 'going' } } };   // pk(3): no record
  const m = await mount(fx);
  chipFor(m, m.draw(), 'going').props.onClick();
  assert.deepEqual(find(m.open(m.draw()), n => n.type === 'li').map(li => flat(li)), ['Alice', 'bob', 'Zed', 'Anonymous']);
});

test('ATTENDANCE: Close returns to the detail', async () => {
  const m = await mount(fixture());
  chipFor(m, m.draw(), 'maybe').props.onClick();
  const t = m.draw(); assert.equal(m.dialog(t).length, 1);
  const close = find(m.open(t), n => n.type === 'button' && flat(n) === 'Close');
  assert.equal(close.length, 1);
  close[0].props.onClick();
  assert.equal(m.dialog(m.draw()).length, 0);
  assert.equal(m.chips(m.draw()).length, 3);
});

test('ATTENDANCE: an empty list says so', async () => {
  const m = await mount(fixture());
  const d = m.mod.SchEventDetail;   // the dialog itself is lifted through the detail's own slice
  void d;
  const t = m.draw();
  chipFor(m, t, 'going').props.onClick();
  const dlg = m.dialog(m.draw())[0];
  const body = dlg.type({ ...dlg.props, names: [] });
  assert.match(flat(body), /Nobody yet\./);
});

test('DETAIL: no RSVPs -> no chips and "No RSVPs yet."', async () => {
  const m = await mount({ members: [], rsvps: {} });
  const t = m.draw();
  assert.equal(m.chips(t).length, 0);
  assert.match(flat(t), /No RSVPs yet\./);
});

test('DETAIL: zero-count chips hidden, but "0 going" shows when only others answered', async () => {
  const m = await mount(fixture({ going: 0, maybe: 0, no: 3, anon: false }));
  assert.deepEqual(m.chips(m.draw()).map(c => flat(c)), ['0 going', '3 can’t make it']);
  const m2 = await mount(fixture({ going: 4, maybe: 0, no: 0, anon: false }));
  assert.deepEqual(m2.chips(m2.draw()).map(c => flat(c)), ['4 going']);
});

test('DETAIL: chips carry an aria-label that says what they do', async () => {
  const m = await mount(fixture());
  assert.deepEqual(m.chips(m.draw()).map(c => c.props['aria-label']), ['13 going, show names', '2 maybe, show names', '1 can’t make it, show names']);
});

test('COMPACTNESS: 150+ guests keep the detail text bounded (no name list)', async () => {
  const sm = await mount(fixture({ going: 3, maybe: 1, no: 1 }));
  const small = flat(sm.draw());
  const m = await mount(fixture({ going: 150, maybe: 30, no: 20 }));
  const big = flat(m.draw());
  assert.ok(big.length < small.length + 40, `inline text grew with the guest list: ${small.length} -> ${big.length}`);
  assert.match(big, /151 going/);
});
