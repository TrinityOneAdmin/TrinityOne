// THE ⋯ MENU ON THE CONSOLE CHAT CLOSES WHEN YOU TAP OFF IT (owner 2026-10-14, cosmetic #4).
// Run: node --test scripts/console-chat-menu-closes-on-tap-off.test.mjs
// Point of use (rule 1): drives the real GroupChatModal from app/stew-dashboard.jsx, opens the menu through
// the real ⋯ button, then fires the document listener the screen itself registered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

async function loadConsoleComponent(name, anchor, globals) {
  const src = fnBody(STEW, anchor, name);
  const tmp = join(tmpdir(), 'menuoff-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__mo_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

const GROUP = { id: 'g-1', name: 'Whole Church', kind: 'group' };
const REMOVED = { id: 'm-removed', by: 'aa11', mine: false, text: '', ts: 100, removed: true, reactions: [], name: 'Ruth' };
const NORMAL  = { id: 'm-normal',  by: 'bb22', mine: false, text: 'still here', ts: 101, reactions: [], name: 'Ada' };

async function chat({ msgs = [REMOVED, NORMAL], unhide = () => Promise.resolve({ ok: 1 }) } = {}) {
  const { React, draw } = miniReact();
  const unhidden = [];
  const listeners = [];
  const doc = { addEventListener: (t, f, c) => listeners.push({ t, f, c }), removeEventListener: (t, f) => { const i = listeners.findIndex(l => l.t === t && l.f === f); if (i >= 0) listeners.splice(i, 1); } };
  const win = {
    Steward: {
      subscribeGroupChat: (id, cb) => { cb(msgs); return () => {}; },
      subscribeGroupPin: (id, cb) => { cb(null); return () => {}; },
      subscribeGroupEvents: (id, cb) => { cb([]); return () => {}; },
      unhideMessage: (gid, mid) => { unhidden.push([gid, mid]); return unhide(gid, mid); },
      hideMessage: () => Promise.resolve({ ok: 1 }),
      publishPost: () => Promise.resolve({ ok: 1 }),
      reactGroup: () => Promise.resolve({ ok: 1 }),
      pinPost: () => Promise.resolve({ ok: 1 }), unpin: () => Promise.resolve({ ok: 1 }),
    },
    useStewardMembers: () => [], dispatchEvent: () => true,
    addEventListener() {}, removeEventListener() {},
  };
  const Comp = await loadConsoleComponent('GroupChatModal', 'function GroupChatModal({ group, onClose }) {', {
    React, window: win, document: doc, CustomEvent, setTimeout, clearTimeout,
    Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), SkConfirm: Stub('SkConfirm'),
    EventComposer: Stub('EventComposer'), useStewDialog: () => ({}),
    initialsFor: () => 'XX', avFor: () => '', nameFor: (pk) => (pk === 'aa11' ? 'Ruth' : 'Ada'),
    GROUP_EMOJI: ['❤️'],
  });
  // miniReact runs effects AFTER the render that queued them, exactly as React does — so the first draw
  // still has msgs = []. Draw twice: the second is the render that sees what subscribeGroupChat delivered.
  let tree = draw(Comp, { group: GROUP, onClose: () => {} });
  const redraw = () => { tree = draw(Comp, { group: GROUP, onClose: () => {} }); return tree; };
  redraw();
  return { tree: () => tree, redraw, unhidden, listeners, all: () => texts(tree).join(' | ') };
}


const MSG = 'm-normal';
const moderate = (c) => find(c.tree(), n => n.type === 'button' && n.props.title === 'Moderate')[0];
const outside = { closest: () => null };
const inside = { closest: (sel) => (sel === '[data-chat-menu]' ? {} : null) };
const press = (c, target) => c.listeners.filter(l => l.t === 'pointerdown').forEach(l => l.f({ target }));

async function opened() {
  const c = await chat({ msgs: [NORMAL] });
  moderate(c).props.onClick();
  c.redraw();
  assert.equal(moderate(c).props['aria-expanded'], true, 'the ⋯ button did not open its menu');
  return c;
}

test('pressing OFF the menu closes it', async () => {
  const c = await opened();
  assert.match(c.all(), /Remove message/, 'precondition: the open menu shows its items');
  assert.ok(c.listeners.some(l => l.t === 'pointerdown'), 'an open menu registered nothing to hear a tap elsewhere');
  press(c, outside);
  c.redraw();
  assert.equal(moderate(c).props['aria-expanded'], false, 'tapping off the menu left it open');
  assert.doesNotMatch(c.all(), /Remove message|Pin/, 'the menu items are still on screen');
});

test('pressing INSIDE the menu or on its ⋯ button does not close it by itself', async () => {
  const c = await opened();
  press(c, inside);
  c.redraw();
  assert.equal(moderate(c).props['aria-expanded'], true, 'a press inside the menu closed it before the item could act');
});

test('the [data-chat-menu] wrapper really holds the ⋯ button AND the menu items (what "inside" means)', async () => {
  const c = await opened();
  const wrap = find(c.tree(), n => n.props && n.props['data-chat-menu']);
  assert.equal(wrap.length, 1, 'expected exactly one menu wrapper for the one message');
  assert.ok(find(wrap[0], n => n.type === 'button' && n.props.title === 'Moderate').length, 'the button is outside the wrapper: its own tap would be read as "off" and re-open');
  assert.match(texts(wrap[0]).join(' '), /Remove message/, 'the menu items are outside the wrapper: tapping one would close the menu before it acted');
});
