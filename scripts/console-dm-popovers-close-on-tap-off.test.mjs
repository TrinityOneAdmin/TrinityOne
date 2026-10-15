// THE CONSOLE DM WINDOW'S ⋯ MENU AND REACTIONS PICKER CLOSE WHEN YOU TAP OFF THEM (owner 2026-10-15).
// Run: node --test scripts/console-dm-popovers-close-on-tap-off.test.mjs
//
// Point of use (CLAUDE.md rules 1 and 3): the REAL StewDmWindow is sliced out of app/stew-dashboard.jsx,
// compiled and rendered through a mini React. The screen registers its own `pointerdown` listener on a
// `document` stub that records it; the test fires that listener with a target that is inside or outside the
// pop-over, exactly as the capture handler would see a real press. Nothing matches text in app/*.jsx.
//
// Owner's device report: on the console, tap-off worked for the group ⋯ menu but NOT in a private message —
// its ⋯ menu and its reactions picker stayed open until tapped again.
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
  const tmp = join(tmpdir(), 'dmtap-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__dmtap_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64')).then(m => m[name]);
}

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
];

async function win() {
  const { React, reset, flush } = miniReact();
  const listeners = [];
  const doc = {
    addEventListener: (t, f, c) => listeners.push({ t, f, c }),
    removeEventListener: (t, f) => { const n = listeners.findIndex(l => l.t === t && l.f === f); if (n >= 0) listeners.splice(n, 1); },
  };
  const Steward = {
    subscribeDMThread: (pk, cb) => { cb(THREAD); return () => {}; },
    sendDM: async () => ({ id: 'e1' }), reactDM: () => {}, outboxForPeer: () => [],
    retryQueuedDM: () => true, dropQueuedDM: () => {},
  };
  const Comp = await compile(fnBody(STEW, 'function StewDmWindow(', 'StewDmWindow'), 'StewDmWindow', {
    React,
    window: { Steward, Capacitor: undefined, addEventListener: () => {}, removeEventListener: () => {} },
    document: doc,
    DM_EMOJI: ['❤️', '🙏', '👍'],
    Icon: ({ name }) => null, SkBadge: () => null, SK_TINT: { gold: { fg: '#000' } },
    nameHandle: () => '', shortNpub: () => 'npub1…',
  });
  let tree;
  const draw = () => { reset(); tree = Comp({ peer: { pubkey: 'peerhex', name: 'Ruth' }, offset: 0, onClose: () => {} }); flush(); return tree; };
  draw();
  return { draw, tree: () => tree, listeners };
}

const dots = (t) => find(t, n => n.type === 'button' && n.props.title === 'Message actions');
const bubbles = (t) => find(t, n => n.type === 'div' && n.props.title === 'Tap to react');
const menuOpen = (t) => find(t, n => n.type === 'button' && String((n.props && n.props.children && '') || '') === '' && n.props && n.props.onClick && false).length > 0;
const replyBtn = (t) => find(t, n => n.type === 'button' && find(n, x => x && x.props && x.props.name === 'reply').length > 0);
const pickerOpen = (t) => find(t, n => n.type === 'button' && /^React with/.test((n.props && n.props.title) || '')).length > 0;
const outside = { closest: () => null };
const pressAll = (w, target) => w.listeners.filter(l => l.t === 'pointerdown').forEach(l => l.f({ target }));

// ── ⋯ MENU ─────────────────────────────────────────────────────────────────────────────────────────────

test('the ⋯ menu: a press OFF it closes it, a press on [data-dm-menu] does not', async () => {
  const w = await win();
  dots(w.draw())[0].props.onClick();          // open the first message's ⋯ menu
  assert.ok(replyBtn(w.draw()).length > 0, 'precondition: the ⋯ menu opened and shows Reply');
  assert.ok(w.listeners.some(l => l.t === 'pointerdown'), 'an open menu registered nothing to hear a tap elsewhere');

  // inside first: a press on the ⋯ button / menu wrapper must NOT close it
  pressAll(w, { closest: (sel) => (sel === '[data-dm-menu]' ? {} : null) });
  assert.ok(replyBtn(w.draw()).length > 0, 'a press inside [data-dm-menu] closed the menu');

  // then off: closes
  pressAll(w, outside);
  assert.equal(replyBtn(w.draw()).length, 0, 'tapping off the ⋯ menu left it open');
});

// ── REACTIONS PICKER ───────────────────────────────────────────────────────────────────────────────────

test('the reactions picker: a press OFF it closes it, a press on [data-dm-rx] does not', async () => {
  const w = await win();
  bubbles(w.draw())[0].props.onClick();        // tap the message to open its picker
  assert.ok(pickerOpen(w.draw()), 'precondition: tapping the bubble opened the picker');

  pressAll(w, { closest: (sel) => (sel === '[data-dm-rx]' ? {} : null) });
  assert.equal(pickerOpen(w.draw()), true, 'a press inside [data-dm-rx] closed the picker');

  pressAll(w, outside);
  assert.equal(pickerOpen(w.draw()), false, 'tapping off the picker left it open');
});

test('the bubble AND the open picker both carry data-dm-rx', async () => {
  const w = await win();
  bubbles(w.draw())[0].props.onClick();
  const marked = find(w.draw(), n => n.props && n.props['data-dm-rx']);
  assert.ok(marked.length >= 2, 'expected the bubble and the picker row both marked data-dm-rx');
});
