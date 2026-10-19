// DEVOTIONAL DAY VIEW: SWIPE RIGHT = MARK READ + NEXT, SWIPE LEFT = PREVIOUS. (Reading plans get NO swipe.)
// Run: node --test scripts/devo-and-plan-swipe-to-turn-the-day.test.mjs
//
// Owner 2026-10-18 (revised after review): the swipe-to-turn-the-day gesture is for DEVOTIONALS only. A
// reading plan is a list of "go read the whole chapter" days and gets no swipe — that half was reverted, so
// this file now covers only DevoDayReader. CLAUDE.md rules 1 and 3: this draws the REAL DevoDayReader
// (app/screens-plans.jsx, compiled with esbuild) through scripts/render-jsx-screen.mjs and fires the real
// touch handlers on the real scroll container. ctx.toggleDevoDay is SLICED OUT of app/app.jsx and run, not
// re-implemented, so the done-list is the shipped logic.
//
// Users of the shared code (rule 2): ctx.toggleDevoDay (the devotional mark-read button AND now the devo-day
// swipe), ctx.openChurchDevoDay (the devo prev/next buttons AND now the devo swipe). DevoDayReader is the only
// renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const Passthrough = function Overlay({ children }) { return children === undefined ? null : children; };

// Slice ONE arrow method out of app.jsx's ctx literal and run it (the shipped logic, not a re-implementation).
function liftFn(name, scope) {
  const re = new RegExp('\\n    ' + name + ':\\s*(\\([^)]*\\) => \\{[\\s\\S]*?\\n    \\}),');
  const m = re.exec(APP);
  assert.ok(m, 're-anchor lift: ' + name);
  const names = Object.keys(scope);
  return new Function(...names, 'return (' + m[1] + ');')(...names.map(k => scope[k]));
}

function harness() {
  const { React, draw } = miniReact();
  const win = { innerWidth: 360, addEventListener() {}, removeEventListener() {},
    getSelection: () => ({ toString: () => '' }), localStorage: { getItem: () => null, setItem() {} },
    TrinityData: { PLANS: [], CROSSREFS: {} }, sanitizeHtml: h => h };
  const base = { React, window: win, localStorage: win.localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    history: { back() {}, pushState() {}, replaceState() {}, state: null }, fetch: async () => ({ ok: false, json: async () => ({}) }) };
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { BottomSheet, IconBtn } = loadScreen('app/ui.jsx', ['BottomSheet', 'IconBtn'], { ...base, Icon, PhoneFrame() { return null; } });
  const screen = loadScreen('app/screens-plans.jsx', ['DevoDayReader'],
    { React, window: win, Icon, IconBtn, BottomSheet, Overlay: Passthrough });
  return { React, draw, win, ...screen };
}

const swipeable = (tree) => find(tree, n => n.type === 'div' && n.props.onTouchStart);
// fire a drag of (dx,dy) starting at (100,300) on an element with onTouchStart/Move/End.
function drag(el, dx, dy, opts) {
  el.props.onTouchStart({ touches: [{ clientX: 100, clientY: 300 }] });
  if (opts && opts.second) el.props.onTouchMove({ touches: [{}, {}] });
  el.props.onTouchEnd({ changedTouches: [{ clientX: 100 + dx, clientY: 300 + dy }] });
}

function devoWorld(progress) {
  const h = harness();
  const st = { devos: progress ? { d1: progress.slice() } : {} };
  const settings = { get: (k, d) => (k === 'devos' ? st.devos : d), set: (k, v) => { if (k === 'devos') st.devos = v; } };
  const toggleDevoDay = liftFn('toggleDevoDay', { MD: { settings } });
  const opened = [];
  const ctx = { get devoProgress() { return st.devos; }, toggleDevoDay, openChurchDevoDay: (d) => opened.push(d.d), toast() {} };
  const devo = { id: 'd1', text: '' };
  const parsed = { days: [{ d: 1, title: 'One', ref: '', body: 'b1' }, { d: 2, title: 'Two', ref: '', body: 'b2' }, { d: 3, title: 'Three', ref: '', body: 'b3' }] };
  const scroll = (dayIdx) => swipeable(h.draw(h.DevoDayReader, { devo, day: parsed.days[dayIdx], parsed, open: true, onClose() {}, ctx }))[0];
  return { h, st, opened, scroll };
}

test('devo: swipe RIGHT on a middle day marks it read once and advances to the next day', () => {
  const w = devoWorld();
  drag(w.scroll(1), 80, 0);            // day 2 of 3
  assert.deepEqual(w.st.devos, { d1: [2] }, 'did not mark day 2 read');
  assert.deepEqual(w.opened, [3], 'did not advance to day 3');
});

test('devo: swipe LEFT goes to the previous day and does NOT mark anything read', () => {
  const w = devoWorld();
  drag(w.scroll(1), -80, 0);
  assert.deepEqual(w.st.devos, {}, 'a left swipe changed read status');
  assert.deepEqual(w.opened, [1], 'did not go back to day 1');
});

test('devo: swipe RIGHT on an already-read day advances but NEVER un-marks it', () => {
  const w = devoWorld([2]);            // day 2 already done
  drag(w.scroll(1), 80, 0);
  assert.deepEqual(w.st.devos, { d1: [2] }, 'un-marked a day that was already read');
  assert.deepEqual(w.opened, [3], 'did not advance');
});

test('devo: the last day marks read with no advance on a right swipe', () => {
  const w = devoWorld();
  drag(w.scroll(2), 80, 0);            // day 3 of 3
  assert.deepEqual(w.st.devos, { d1: [3] }, 'did not mark the last day read');
  assert.deepEqual(w.opened, [], 'advanced past the last day');
});

test('devo: a short, a mostly-vertical, and a text-selection drag all do nothing', () => {
  let w = devoWorld(); drag(w.scroll(1), 30, 0);
  assert.deepEqual([w.st.devos, w.opened], [{}, []], 'a short drag turned the day');
  w = devoWorld(); drag(w.scroll(1), 80, 80);
  assert.deepEqual([w.st.devos, w.opened], [{}, []], 'a mostly-vertical drag turned the day');
  w = devoWorld(); w.h.win.getSelection = () => ({ toString: () => 'copied verse' });
  drag(w.scroll(1), 80, 0);
  assert.deepEqual([w.st.devos, w.opened], [{}, []], 'a drag that left text selected turned the day');
});
