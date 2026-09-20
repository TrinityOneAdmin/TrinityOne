// The Bible reader's notes/commentary panel closes on a swipe to the right. It used to measure only the
// finger's rightward travel — so a long thumb-scroll down the notes that drifted 60px sideways slid the panel
// away mid-read (owner, on the phone, 2026-09-20). This lifts the real CommentaryPanel out of
// app/screens-read.jsx, runs it with a fake React, and puts real touch coordinates through the handlers it
// renders. Nothing here matches text in the jsx: `false && ` in front of the dominance check makes row 1 fail.
//
// MEASURED: the dominance check removed (dx > 56 only) → row 1 fails, rows 2-4 pass. Restored → 4/4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fnBody } from './test-slice.mjs';
import { fakeReact, nodes } from './console-screens.mjs';

const SRC = readFileSync(new URL('../app/screens-read.jsx', import.meta.url), 'utf8');

// The panel as the phone runs it: its function, compiled from jsx, in a scope that has React's hooks under the
// file's own aliases and the globals the panel reads on mount.
function mountPanel({ docked = false } = {}) {
  const at = SRC.indexOf('function CommentaryPanel(');
  assert.notEqual(at, -1, 're-anchor: CommentaryPanel is gone from app/screens-read.jsx');
  const code = fnBody(SRC, at, 'CommentaryPanel');   // the whole function, head and body
  const { React, reset, flush } = fakeReact();
  const closed = [];
  const ctx = { notes: {}, version: 'kjv', setNote() {} };
  const g = { React, useS: React.useState, useE: React.useEffect, useR: React.useRef, window: { Bible: { getCommentary: () => [], subscribe: () => () => {} } },
    // components the panel places; the fake React never calls children, so a name is all each needs
    Icon: () => null, IconBtn: () => null, Btn: () => null, Empty: () => null, Pill: () => null, Chip: () => null, console, Math, Object, String, parseInt, Array, JSON, Number, Date, Set, Map, Promise, setTimeout, clearTimeout };
  return { React, reset, flush, closed, ctx, g, code };
}

async function render({ docked = false } = {}) {
  const m = mountPanel({ docked });
  const out = await (await import('esbuild')).transform(m.code, { loader: 'jsx', jsx: 'transform' });
  const scope = new Proxy(m.g, { has: () => true, get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; if (typeof k === 'string' && /^[A-Z]/.test(k)) return () => null; return undefined; } });
  const fn = vm.runInNewContext('(' + out.code.trim().replace(/;$/, '') + ')', scope);
  let tree;
  const draw = () => { m.reset(); tree = fn({ loc: { book: 'John', chap: 1 }, label: 'John 1', open: true, onClose: () => m.closed.push(1), ctx: m.ctx, docked }); m.flush(); return tree; };
  draw();
  // the panel is the element carrying the touch handlers
  const panel = nodes(tree).find(n => n.props && n.props.onTouchStart && n.props.onTouchEnd);
  assert.ok(panel, 're-anchor: no element with onTouchStart/onTouchEnd in the rendered panel');
  const touch = (x0, y0, x1, y1) => {
    panel.props.onTouchStart({ touches: [{ clientX: x0, clientY: y0 }] });
    panel.props.onTouchEnd({ changedTouches: [{ clientX: x1, clientY: y1 }], touches: [] });
  };
  const cancelThenEnd = (x0, y0, x1, y1) => {
    panel.props.onTouchStart({ touches: [{ clientX: x0, clientY: y0 }] });
    if (panel.props.onTouchCancel) panel.props.onTouchCancel({});
    panel.props.onTouchEnd({ changedTouches: [{ clientX: x1, clientY: y1 }], touches: [] });
  };
  return { touch, cancelThenEnd, closed: m.closed };
}

test('1. a long scroll down the notes that drifts 70px to the right does NOT close the panel', async () => {
  const p = await render();
  p.touch(120, 100, 190, 520);   // 70px right, 420px down: a thumb scroll
  assert.equal(p.closed.length, 0, 'THE DEFECT: a mostly-vertical scroll closed the notes panel');
});

test('2. a deliberate swipe to the right still closes it', async () => {
  const p = await render();
  p.touch(120, 300, 260, 318);   // 140px right, 18px down
  assert.equal(p.closed.length, 1, 'a clear rightward swipe no longer closes the panel');
});

test('3. a short nudge (under 56px) does not close it, and a swipe to the LEFT never did', async () => {
  const p = await render();
  p.touch(120, 300, 160, 302);   // 40px right
  p.touch(260, 300, 100, 302);   // 160px left
  assert.equal(p.closed.length, 0);
});

test('4. when the panel is docked beside the text (wide screen) no swipe closes it', async () => {
  const p = await render({ docked: true });
  p.touch(120, 300, 300, 302);
  assert.equal(p.closed.length, 0, 'a docked panel closed on a swipe — it has no backdrop and nowhere to go');
});

// The two rows the audit of d004807 found missing: the RATIO itself (row 1's 6:1 scroll is too extreme to tell
// 1.7 from 0.5) and the cancelled touch.
test('5. a diagonal drag — 100px right, 80px down — is not sideways enough (ratio 1.25 < 1.7) and does not close it; 140 right / 80 down (1.75) does', async () => {
  const p = await render();
  p.touch(100, 300, 200, 380);
  assert.equal(p.closed.length, 0, 'a drag only 1.25x wider than tall closed the panel — the dominance ratio is below 1.7');
  p.touch(100, 300, 240, 380);
  assert.equal(p.closed.length, 1, 'a drag 1.75x wider than tall did not close it — the ratio is above 1.75');
});

test('6. a touch the browser cancels (a call, a notification) leaves no start behind: the end that follows closes nothing', async () => {
  const p = await render();
  p.cancelThenEnd(100, 300, 300, 302);
  assert.equal(p.closed.length, 0, 'THE GAP: after touchcancel the stale start was still used, and the next touchend closed the panel');
});
