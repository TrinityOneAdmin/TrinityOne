// THE CONSOLE / CARE ⋯ MENU DROPS FROM THE ⋯ BUTTON, NOT OFF THE BOTTOM OF A TALL MESSAGE.
// Run: node --test scripts/console-care-menu-drops-from-the-dots.test.mjs
//
// Follow-up to the member-app fix (app/screens-chat.jsx, scripts/a-message-menu-does-not-cover-the-message.test.mjs):
// the steward-console DM window and the two care chats carried the SAME defect — their ⋯ reply menu opened at
// `top: '100%'` (the BOTTOM of the bubble), so on a tall message it rendered ~230–275px below the ⋯, detached
// from the message it acts on (owner report: "below and to the left of where they should be"). The fix drops
// the menu FROM the ⋯ button (a small fixed `top`, hugging the button) with its near edge pinned to the dots'
// side (`[mine?'right':'left']: '100%'`). This proves it at the POINT OF USE (CLAUDE.md rule 1) and without
// matching text in app/*.jsx (rule 3): each REAL component is sliced from its file, compiled, and rendered;
// we open the menu and read the menu div's actual style props — a revert to `top:'100%'` or `[…]:0`, or a
// deleted menu, fails here. Geometry (hug within ~2px, menu far above the bubble bottom) was additionally
// confirmed in a headless browser, instrument-validated against the pre-fix code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function compile(src, name, globals) {
  const tmp = join(tmpdir(), 'ccmenu-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__ccmenu_' + Math.random().toString(36).slice(2);
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

// A long received message (mine:false) that is NOT last, so the ⋯ dots are at the TOP of a tall bubble.
const LONG = 'We’ve switched on practical care in the church app. '.repeat(6);
const THREAD = [
  { id: 'm1', mine: false, from: 'peerhex', text: LONG, at: 1756500000, ts: 1 },
  { id: 'm2', mine: true, from: 'mehex', text: 'Thank you.', at: 1756500100, ts: 2 },
];
const sub = (...a) => { const cb = a[a.length - 1]; if (typeof cb === 'function') cb(THREAD); return () => {}; };
const doc = { addEventListener: () => {}, removeEventListener: () => {} };
const baseWin = (extra) => Object.assign({ matchMedia: () => ({ matches: true }), addEventListener: () => {}, removeEventListener: () => {}, Capacitor: undefined }, extra);
const common = { Icon: () => null, SkBadge: () => null, SK_TINT: { gold: { fg: '#000' }, clay: { fg: '#000' } },
  nameHandle: () => '', shortNpub: () => 'npub1…', careName: () => 'Ruth', REACTIONS: ['❤️', '🙏', '👍'], DM_EMOJI: ['❤️', '🙏', '👍'] };

// Each entry: file, fnBody anchor, component name, props, the window namespace it reads, and the expected hug `top`.
const CASES = [
  { key: 'StewDmWindow', file: 'app/stew-dashboard.jsx', anchor: 'function StewDmWindow(', name: 'StewDmWindow',
    props: { peer: { pubkey: 'peerhex', name: 'Ruth', npub: 'npub1ruth' }, offset: 0, onClose() {} },
    win: { Steward: { subscribeDMThread: sub, sendDM: async () => ({ id: 'e1' }), reactDM() {}, outboxForPeer: () => [], retryQueuedDM: () => true, dropQueuedDM() {}, actingChurch: () => null, churchPub: () => 'c' } },
    top: 20 },
  { key: 'CareChatSheet', file: 'app/screens-today.jsx', anchor: 'function CareChatSheet(', name: 'CareChatSheet',
    props: { reqId: 'r1', requesterPub: 'peerhex', title: 'A meal', onClose() {} },
    win: { Fellowship: { subscribeCareChat: sub, sendCareChat: async () => ({ ok: 1 }), reactCare() {}, myPubkey: 'mehex' } },
    top: 26 },
  { key: 'StewCareChat', file: 'app/stew-meals.jsx', anchor: 'function StewCareChat(', name: 'StewCareChat',
    props: { reqId: 'r1', requesterPub: 'peerhex', title: 'A meal', onClose() {} },
    win: { StewardMeals: { subscribeCareChat: sub, sendCareChat: async () => ({ ok: 1 }), reactCare() {}, careName: () => 'Ruth' } },
    top: 20 },
];

for (const c of CASES) {
  test(`${c.key}: the ⋯ menu drops FROM the dots (top hugs the button, near edge pinned), not off the bubble bottom`, async () => {
    const { React, reset, flush } = miniReact();
    const Comp = await compile(fnBody(read(c.file), c.anchor, c.name), c.name,
      Object.assign({ React, window: baseWin(c.win), document: doc }, common));
    let tree;
    const draw = () => { reset(); tree = Comp(c.props); flush(); return tree; };
    draw();
    const dots = find(draw(), n => n.type === 'button' && n.props && n.props['aria-label'] === 'Message actions');
    assert.ok(dots.length > 0, 'no ⋯ (Message actions) button rendered — re-anchor this test');
    dots[0].props.onClick();                                   // open the first (long, non-last) message's menu

    const menus = find(draw(), n => n.type === 'div' && n.props && n.props['data-reply-menu']);
    assert.equal(menus.length, 1, 'expected exactly one open ⋯ menu div');
    const menu = menus[0];
    assert.ok(find(menu, n => n.type === 'button' && find(n, x => x && x.props && x.props.name === 'reply').length > 0).length > 0,
      'the open menu has no Reply button — the feature is gone');

    const st = menu.props.style || {};
    // VERTICAL: a small fixed offset hugging the ⋯ button — NOT the old `top: '100%'` (bubble bottom), and no
    // bottom-anchored upward-open variant. A revert to either fails here.
    assert.equal(typeof st.top, 'number', `menu top must be a fixed hug offset, got ${JSON.stringify(st.top)} (reverted to bubble-anchored?)`);
    assert.equal(st.top, c.top, `menu should hug the ⋯ button at top: ${c.top}`);
    assert.equal(st.bottom, undefined, 'menu must not be bottom-anchored (the old last-message upward open is gone)');
    // HORIZONTAL: the near edge is pinned to the side the dots sit on. The first message is received
    // (mine:false), so the dots are on the right and the menu pins `left: '100%'` — NOT the old `left: 0`,
    // which hung it off the opposite (far-left) corner.
    assert.equal(st.left, '100%', `menu near edge must pin to the dots' side (left:'100%'), got ${JSON.stringify(st.left)}`);
  });
}
