// THE CONSOLE DM WINDOW CAN REPLY TO A MESSAGE. Run: node --test scripts/steward-dm-reply-ui.test.mjs
//
// The engine half (Steward.sendDM wraps a reply envelope given `{id}`; inbound messages carry `replyTo`) is
// merged and tested elsewhere. This is the SCREEN half, and per CLAUDE.md rule 1 it is tested at the point of
// use: the real StewDmWindow is sliced out of app/stew-dashboard.jsx, compiled, and RENDERED, and the tests
// read the tree and click what the user would click. Nothing here matches text in app/*.jsx (rule 3).
//
// Users of the code touched (rule 2): only StewDmWindow's own body changed. It is rendered by MemberChatDock
// (one place) and driven by a-dm-that-never-sent-is-not-sent, chat-reconnect and steward-dm-survives-too.
//
// Platform split (owner 2026-10-14): web = the ⋯ menu only; APK = swipe right AND the ⋯ menu (a swipe-only
// affordance already failed on the Oppo in the member app).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

function compile(src, name, globals) {
  const tmp = join(tmpdir(), 'dmreply-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__dmreply_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64')).then(m => m[name]);
}

function miniReact() {
  const states = [], memos = [], effDeps = [];
  let queued = [], i = 0, mi = 0, ei = 0;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, n) => Object.is(v, b[n]));
  const React = {
    useState(init) { const k = i++; if (!(k in states)) states[k] = typeof init === 'function' ? init() : init;
      return [states[k], (v) => { states[k] = typeof v === 'function' ? v(states[k]) : v; }]; },
    useMemo(f, deps) { const k = mi++; if (!memos[k] || !same(memos[k].deps, deps)) memos[k] = { deps, v: f() }; return memos[k].v; },
    useCallback(f, deps) { return React.useMemo(() => f, deps); },
    useEffect(fn, deps) { const k = ei++; if (!(k in effDeps) || !same(effDeps[k], deps)) { effDeps[k] = deps; queued.push(fn); } },
    useRef: () => ({ current: null }),
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    Fragment: 'Fragment',
  };
  return { React, reset: () => { i = 0; mi = 0; ei = 0; }, flush: () => { const r = queued; queued = []; r.forEach(f => f()); } };
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
  { id: 'm2', mine: true, text: 'Of course, tonight', ts: 2, replyTo: 'm1' },
  { id: 'm3', mine: false, text: 'Thank you', ts: 3, replyTo: 'gone-from-view' },
];

async function win({ native = false, result = { id: 'e1' }, msgs = THREAD } = {}) {
  const sent = [];
  const { React, reset, flush } = miniReact();
  const Steward = {
    subscribeDMThread: (pk, cb) => { cb(msgs); return () => {}; },
    sendDM: async (pk, body, replyTo) => { sent.push({ pk, body, replyTo }); return result; },
    reactDM: () => {}, outboxForPeer: () => [], retryQueuedDM: () => true, dropQueuedDM: () => {},
  };
  const Comp = await compile(fnBody(STEW, 'function StewDmWindow(', 'StewDmWindow'), 'StewDmWindow', {
    React,
    window: { Steward, Capacitor: native ? { isNativePlatform: () => true } : undefined,
      addEventListener: () => {}, removeEventListener: () => {} },
    document: { addEventListener: () => {}, removeEventListener: () => {} },   // the ⋯-menu / picker tap-off effects listen on document
    Icon: ({ name }) => null, SkBadge: () => null, SK_TINT: { gold: { fg: '#000' } },
    nameHandle: () => '', shortNpub: () => 'npub1…',
  });
  const draw = () => { reset(); const t = Comp({ peer: { pubkey: 'peerhex', name: 'Ruth' }, offset: 0, onClose: () => {} }); flush(); return t; };
  draw(); // mount: effects deliver the thread, which shows on the next draw
  const dots = (tree) => find(tree, n => n.type === 'button' && n.props.title === 'Message actions');
  const choose = (id) => {   // what a steward does: open that message's ⋯ then press Reply
    const idx = THREAD.findIndex(m => m.id === id);
    dots(draw())[idx].props.onClick();
    const reply = find(draw(), n => n.type === 'button' && texts(n).join('').trim() === 'Reply')[0];
    assert.ok(reply, 'opening the ⋯ menu shows no Reply button');
    reply.props.onClick();
  };
  const type = (v) => find(draw(), n => n.type === 'input')[0].props.onChange({ target: { value: v } });
  const press = () => find(draw(), n => n.type === 'button' && n.props.title === 'Send this message')[0].props.onClick();
  return { draw, sent, dots, choose, type, press };
}
const barOf = (tree) => find(tree, n => n.props && n.props['aria-label'] === 'Stop replying')[0];

test('CONTROL: the thread renders every message, each with a ⋯ button', async () => {
  const w = await win();
  const t = w.draw();
  for (const m of THREAD) assert.ok(texts(t).includes(m.text), 'message missing from the thread: ' + m.text);
  assert.equal(w.dots(t).length, 3);
});

test('a message that quotes another renders the quoted text; an unresolvable one says "an earlier message"', async () => {
  const w = await win();
  const t = w.draw();
  const quote = find(t, n => n.type === 'span' && texts(n).join('') === 'Please pray for my mother');
  assert.equal(quote.length, 1, 'the quoted preview above the reply bubble is not rendered');
  assert.equal(find(t, n => n.type === 'span' && texts(n).join('') === 'replying to an earlier message').length, 1,
    'a reply whose original is not loaded must fall back, not vanish');
});

test('choose Reply, send: sendDM receives {id} of the quoted message, and the bar clears', async () => {
  const w = await win();
  w.choose('m1');
  const bar = w.draw();
  assert.ok(barOf(bar), 'no "Replying to" bar with a cancel after choosing Reply');
  assert.match(texts(bar).join(" | "), /Replying to\s+\|\s*Ruth/);
  w.type('Praying now'); w.press(); await tick(); await tick();
  assert.equal(w.sent.length, 1);
  assert.deepEqual(w.sent[0].replyTo, { id: 'm1' }, 'the reply went out with no quote, or in the wrong shape');
  assert.equal(barOf(w.draw()), undefined, 'the bar stayed after a successful send');
});

test('a message sent with no reply chosen passes no replyTo', async () => {
  const w = await win();
  w.type('plain'); w.press(); await tick(); await tick();
  assert.equal(w.sent[0].replyTo, undefined);
});

test('cancel (the X) clears the reply, so the next send carries no quote', async () => {
  const w = await win();
  w.choose('m3');
  barOf(w.draw()).props.onClick();
  assert.equal(barOf(w.draw()), undefined, 'cancel did not remove the bar');
  w.type('hello'); w.press(); await tick(); await tick();
  assert.equal(w.sent[0].replyTo, undefined, 'a cancelled reply was still sent as a quote');
});

test('a reply that FAILS to send comes back with its words and its quote', async () => {
  const w = await win({ result: null });
  w.choose('m1');
  w.type('Praying now'); w.press(); await tick(); await tick();
  assert.ok(barOf(w.draw()), 'the failed reply lost its context: the bar is gone');
  assert.equal(find(w.draw(), n => n.type === 'input')[0].props.value, 'Praying now');
});

test('web console: no swipe handlers; the ⋯ menu is the way', async () => {
  const w = await win({ native: false });
  const t = w.draw();
  assert.equal(find(t, n => n.props && n.props.onTouchStart).length, 0, 'web console grew a swipe handler');
  assert.equal(w.dots(t).length, 3);
});

test('APK: swipe right replies, a short or vertical drag does not, and the ⋯ menu is still there', async () => {
  const w = await win({ native: true });
  const t = w.draw();
  const rows = find(t, n => n.props && n.props.onTouchStart);
  assert.equal(rows.length, 3, 'APK rows have no swipe handler');
  assert.equal(w.dots(t).length, 3, 'APK lost the non-swipe fallback');
  const drag = (r, dx, dy) => { r.props.onTouchStart({ touches: [{ clientX: 10, clientY: 10 }] });
    r.props.onTouchEnd({ changedTouches: [{ clientX: 10 + dx, clientY: 10 + dy }] }); };
  drag(rows[0], 20, 0);
  assert.equal(barOf(w.draw()), undefined, 'a short drag replied');
  drag(rows[0], 10, 90);
  assert.equal(barOf(w.draw()), undefined, 'a vertical scroll replied');
  drag(find(w.draw(), n => n.props && n.props.onTouchStart)[0], 80, 5);
  const bar = w.draw();
  assert.ok(barOf(bar), 'a clear rightward swipe did not start a reply');
  assert.match(texts(bar).join(' | '), /Please pray for my mother/, 'swiped the first message but quoted another');
});
