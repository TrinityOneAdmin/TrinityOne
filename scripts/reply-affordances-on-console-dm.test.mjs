// THE CONSOLE DM WINDOW'S REPLY AFFORDANCES ARE ON SCREEN. Run: node --test scripts/reply-affordances-on-console-dm.test.mjs
//
// Point-of-use tests (CLAUDE.md rule 1/3): the real StewDmWindow is sliced out of app/stew-dashboard.jsx,
// compiled and RENDERED through a mini React; the tests drive the handlers a finger would and read the tree.
// Nothing matches text in app/*.jsx.
//
// Users of the code touched (rule 2): StewDmWindow only. Rendered by MemberChatDock (the one place — reached
// from the members page, the inbox and every "Message privately" button via the 'steward-open-dm' event).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

function compile(src, name, globals) {
  const tmp = join(tmpdir(), 'dmaff-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__dmaff_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64')).then(m => m[name]);
}

// Hooks that PERSIST across draws (unlike the older harness), so a touchmove's state shows on the next draw.
function miniReact() {
  const states = [], memos = [], effDeps = [], refs = [];
  let queued = [], i = 0, mi = 0, ei = 0, ri = 0;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, n) => Object.is(v, b[n]));
  const React = {
    useState(init) { const k = i++; if (!(k in states)) states[k] = typeof init === 'function' ? init() : init;
      return [states[k], (v) => { states[k] = typeof v === 'function' ? v(states[k]) : v; }]; },
    useMemo(f, deps) { const k = mi++; if (!memos[k] || !same(memos[k].deps, deps)) memos[k] = { deps, v: f() }; return memos[k].v; },
    useCallback(f, deps) { return React.useMemo(() => f, deps); },
    useEffect(fn, deps) { const k = ei++; if (!(k in effDeps) || !same(effDeps[k], deps)) { effDeps[k] = deps; queued.push(fn); } },
    useRef() { const k = ri++; if (!(k in refs)) refs[k] = { current: null }; return refs[k]; },
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
    Fragment: 'Fragment',
  };
  return { React, reset: () => { i = 0; mi = 0; ei = 0; ri = 0; }, flush: () => { const r = queued; queued = []; r.forEach(f => f()); } };
}
const texts = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; }
  (n.kids || []).forEach(c => texts(c, out));
  return out;
};
const find = (n, pred, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => find(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => find(c, pred, out));
  return out;
};

const THREAD = [
  { id: 'm1', mine: false, text: 'Please pray for my mother', ts: 1 },
  { id: 'm2', mine: true, text: 'Of course, tonight', ts: 2 },
  { id: 'm3', mine: false, text: 'Thank you', ts: 3 },
];

async function win({ native = true } = {}) {
  const { React, reset, flush } = miniReact();
  const Steward = {
    subscribeDMThread: (pk, cb) => { cb(THREAD); return () => {}; },
    sendDM: async () => ({ id: 'e1' }),
    reactDM: () => {}, outboxForPeer: () => [], retryQueuedDM: () => true, dropQueuedDM: () => {},
  };
  const Comp = await compile(fnBody(STEW, 'function StewDmWindow(', 'StewDmWindow'), 'StewDmWindow', {
    React,
    window: { Steward, Capacitor: native ? { isNativePlatform: () => true } : undefined, addEventListener: () => {}, removeEventListener: () => {} },
    document: { addEventListener: () => {}, removeEventListener: () => {} },   // the ⋯-menu / picker tap-off effects listen on document
    Icon: ({ name }) => null, SkBadge: () => null, SK_TINT: { gold: { fg: '#000' } },
    nameHandle: () => '', shortNpub: () => 'npub1…',
  });
  const draw = () => { reset(); const t = Comp({ peer: { pubkey: 'peerhex', name: 'Ruth' }, offset: 0, onClose: () => {} }); flush(); return t; };
  draw();
  const rows = (t) => find(t, n => n.props && n.props.onTouchStart);
  const cues = (t) => find(t, n => n.props && n.props['data-reply-cue']);
  const barOf = (t) => find(t, n => n.props && n.props['aria-label'] === 'Stop replying')[0];
  return { draw, rows, cues, barOf };
}
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });

// ── STEP 1: the swipe shows itself ────────────────────────────────────────────────────────────────────────

test('STEP 1: dragging a row right moves it and shows the reply arrow; before the drag there is neither', async () => {
  const w = await win();
  const t0 = w.draw();
  assert.equal(w.cues(t0).length, 0, 'a reply arrow is showing with nobody touching anything');
  const row0 = w.rows(t0)[0];
  assert.equal(row0.props.style.touchAction, 'pan-y', 'the row lets the scroller claim a horizontal drag (no touch-action: pan-y)');
  row0.props.onTouchStart(touch(10, 10));
  w.rows(w.draw())[0].props.onTouchMove(touch(40, 12));
  const t1 = w.draw();
  assert.equal(w.cues(t1).length, 1, 'dragging right shows no reply arrow — the swipe is invisible');
  assert.match(w.rows(t1)[0].props.style.transform, /translateX\(30px\)/, 'the row does not follow the finger');
  assert.equal(w.rows(t1)[1].props.style.transform, '', 'a different row moved');
});

test('STEP 1: lifting past the arm replies WITH NO REDRAW between move and lift (the stale-offset race); short does not', async () => {
  const w = await win();
  let r = w.rows(w.draw())[0];
  r.props.onTouchStart(touch(10, 10));
  r.props.onTouchMove(touch(70, 12));            // 60px — no redraw before the lift, on purpose
  r.props.onTouchEnd({ changedTouches: [{ clientX: 70, clientY: 12 }] });
  assert.ok(w.barOf(w.draw()), 'a drag past the arm did not start a reply');
  assert.equal(w.cues(w.draw()).length, 0, 'the arrow stayed after letting go');

  const w2 = await win();
  r = w2.rows(w2.draw())[0];
  r.props.onTouchStart(touch(10, 10));
  r.props.onTouchMove(touch(40, 12));
  r.props.onTouchEnd({ changedTouches: [{ clientX: 40, clientY: 12 }] });
  assert.equal(w2.barOf(w2.draw()), undefined, 'a short drag replied');
});

test('STEP 1: a cancel past the arm still replies; a cancel short of it does not; a vertical drag shows nothing', async () => {
  const w = await win();
  let r = w.rows(w.draw())[0];
  r.props.onTouchStart(touch(10, 10)); r.props.onTouchMove(touch(75, 11)); r.props.onTouchCancel();
  assert.ok(w.barOf(w.draw()), 'touchcancel past the arm lost the reply');

  const w2 = await win();
  r = w2.rows(w2.draw())[0];
  r.props.onTouchStart(touch(10, 10)); r.props.onTouchMove(touch(30, 11)); r.props.onTouchCancel();
  assert.equal(w2.barOf(w2.draw()), undefined);

  const w3 = await win();
  r = w3.rows(w3.draw())[0];
  r.props.onTouchStart(touch(10, 10)); r.props.onTouchMove(touch(14, 90));
  assert.equal(w3.cues(w3.draw()).length, 0, 'a scroll drew a reply arrow');
});

test('STEP 1: web console has no swipe row at all', async () => {
  const w = await win({ native: false });
  assert.equal(w.rows(w.draw()).length, 0);
});

// ── STEP 2: an opened ⋯ menu is not left outside the scroller ─────────────────────────────────────────────
// The menu is absolutely positioned inside an overflowY:auto scroller; below the LAST message it fell outside
// the visible tile. We can't measure clipping headlessly, so the test asserts the two guards that prevent it:
// the last message opens UPWARD, and an open menu asks to be scrolled into view. THE REAL CAUSE STILL NEEDS A
// BROWSER/DEVICE REPRO — see the report.
async function openMenuOn(w, idx) {
  const dots = find(w.draw(), n => n.type === 'button' && n.props.title === 'Message actions');
  dots[idx].props.onClick();
  return find(w.draw(), n => n.props && n.props['data-reply-menu']);
}

test('STEP 2: the ⋯ on the LAST message opens its menu upward, with Reply in it', async () => {
  const w = await win({ native: false });
  const menus = await openMenuOn(w, 2);
  assert.equal(menus.length, 1, 'no menu after pressing ⋯');
  assert.equal(menus[0].props['data-reply-menu'], 'up');
  assert.equal(menus[0].props.style.bottom, '100%', 'last message menu is still anchored below, outside the scroller');
  assert.equal(menus[0].props.style.top, undefined);
  assert.ok(texts(menus[0]).join('').includes('Reply'), 'the menu has no Reply');
});

test('STEP 2: a menu on an earlier message still opens below the bubble (it must not cover the words)', async () => {
  const w = await win({ native: false });
  const menus = await openMenuOn(w, 0);
  assert.equal(menus[0].props['data-reply-menu'], 'down');
  assert.equal(menus[0].props.style.top, '100%');
});

test('STEP 2: an open menu asks to be scrolled into view', async () => {
  const w = await win({ native: false });
  const menus = await openMenuOn(w, 2);
  const ref = menus[0].props.ref;
  assert.equal(typeof ref, 'function', 'the open menu has no ref to scroll it into view');
  let asked = null;
  ref({ scrollIntoView: (o) => { asked = o; } });
  assert.deepEqual(asked, { block: 'nearest' });
});
