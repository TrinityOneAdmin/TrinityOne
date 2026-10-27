// THE THREE DOTS ARE ON EVERY ROOM MESSAGE, AND THEIR MENU DOES NOT HIDE THE MESSAGE.
//   Run: node --test scripts/a-message-menu-does-not-cover-the-message.test.mjs
//
// Device report, Oppo, steward app 0.9.72, in a room ("Main chat"), with a screenshot at 411px CSS:
//   "The reply private from the three dots needs to be better placed."
// The menu opened at `top: 18, left: 0` — eighteen pixels DOWN FROM THE TOP OF THE BUBBLE, i.e. straight
// across it — so the words being answered were completely hidden behind the menu card. Somebody choosing
// between Reply and Reply privately needs to see what they are replying to. This repo has already shipped
// this exact mistake once: the Bible highlight action card covered the very verse the reader had selected.
//
// The owner also asked for "three dots on every message", so the gate on the control is checked here too —
// from the point of use, as an ORDINARY MEMBER with no moderation powers and on BOTH authors' messages,
// because that is the state in which a condition like
//   (M.onReply || M.canModerate || M.onDelete || (!me && canDM && ctx && ctx.openDM))
// would hide it. CLAUDE.md rule 3: that condition is not matched as text anywhere below — the room is
// rendered and the tree is read.
//
// WHAT THIS CANNOT PROVE. It reads the declared geometry (`top: 100%`, and which edge the card hangs from),
// not painted pixels: there is no layout engine here. "The bubble is still readable at 411px and 360px" is a
// claim only a device can settle, and nothing here makes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find, compileScreen } from './render-jsx-screen.mjs';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { requireFreePort } from './test-ports.mjs';

const GROUP = { id: 'g1', name: 'Youth', accent: 'var(--clay)', kind: 'Group' };
const THEIRS = { id: 'm-theirs', pubkey: 'themhex', kind: 1, created_at: 1756500000, tags: [], content: 'Could we talk on Sunday?' };
const MINE = { id: 'm-mine', pubkey: 'mehex', kind: 1, created_at: 1756500100, tags: [], content: 'Yes of course.' };

// A room with one message from each side, and no leadership — a plain member reading a group.
function room({ leader = false, canDM = true } = {}) {
  const { React, draw } = miniReact();
  const Fellowship = {
    myPubkey: 'mehex',
    relays: ['wss://relay.example'],
    relayReady: () => true,
    groupEncState: () => 'clear',
    pinPost: () => Promise.resolve({ ok: true }),
    unpin: () => Promise.resolve({ ok: true }),
    hideMessage: () => Promise.resolve({ ok: true }),
    react: () => {},
    requestProfiles: () => {},
    outboxFor: () => [],
    onOutbox: () => () => {},
    subscribeGroup: (_gid, add) => { add(THEIRS); add(MINE); return () => {}; },
    subscribeReactions: () => () => {},
    subscribeGroupPin: (_gid, cb) => { cb(null); return () => {}; },
    subscribeHidden: (_gid, cb) => { cb(new Set()); return () => {}; },
    subscribeMessageTags: (_np, cb) => { cb([]); return () => {}; },
    displayFor: () => ({ handle: 'sam', color: '#888' }),
    canAddGroupEvent: () => false,
  };
  const win = {
    matchMedia: () => ({ matches: !globalThis.__roomTouch }),   // pointer device unless a test sets __roomTouch (the ⋯ on a reply-only surface is pointer-only)
    Fellowship,
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
    TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
    addEventListener: () => {}, removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    confirm: () => true,
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatRoom'], {
    React,
    window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-10-13',
    Icon: () => null,
    IconBtn: ({ name }) => React.createElement('button', { title: name }),
    Overlay: ({ open, children }) => (open ? children : null),
    UserAvatar: () => null, SectionLabel: ({ children }) => children, BottomSheet: ({ children }) => children,
    safeCssColor: (c) => c,
    D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast: () => {},
    church: { npub: 'npub1church', name: 'Trinity LA', id: 'c1' },
    myLeaderGroups: leader ? [{ id: 'g1' }] : [],
    churchEvents: [],
    safeguard: {},
    myPubkey: 'mehex',
    canDMPeer: () => canDM,
    openDM: () => {},
  };
  const render = () => draw(mod.ChatRoom, { group: GROUP, open: true, onClose: () => {}, ctx, docked: true });
  render();                       // first pass: the effects deliver the messages, the pin and the hidden set
  return render;
}

const dots = (tree) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === 'Message actions');
const menuCard = (tree) => find(tree, n => n.type === 'div' && n.props && n.props.style
  && n.props.style.position === 'absolute' && n.props.style.zIndex === 5 && texts(n).join(' ').includes('Reply'));

test('CONTROL: an ordinary member sees both messages in the room', () => {
  const draw = room();
  const words = texts(draw()).join(' | ');
  assert.match(words, /Could we talk on Sunday\?/, 're-anchor: the incoming message is not in the room');
  assert.match(words, /Yes of course\./, 're-anchor: my own message is not in the room');
});

test('EVERY room message carries the three-dots control — for an ordinary member, on both sides', () => {
  const draw = room();                     // not a leader: no pin, no remove
  assert.equal(dots(draw()).length, 2,
    'the three-dots control is hidden on some room messages for a plain member. Found ' + dots(draw()).length + ' for 2.');
});

test('…and it is still on every message when a private reply is not allowed (the safeguarding gate)', () => {
  // canDMPeer false removes the "Reply privately" item. The CONTROL must survive that, because Reply remains.
  const draw = room({ canDM: false });
  assert.equal(dots(draw()).length, 2, 'the safeguarding gate took the whole actions control away, not just one item');
  dots(draw())[0].props.onClick();
  const open = draw();
  assert.equal(find(open, n => n.type === 'button' && texts(n).join(' ').includes('Reply privately')).length, 0,
    're-anchor: Reply privately is offered where the relay would refuse the DM');
  assert.ok(find(open, n => n.type === 'button' && texts(n).join(' ').includes('Reply')).length >= 1,
    'Reply went with it');
});

test('THE ROOM MENU OPENS BELOW THE BUBBLE, NOT ACROSS IT', () => {
  const draw = room();
  dots(draw())[0].props.onClick();
  const card = menuCard(draw());
  assert.equal(card.length, 1, 're-anchor: the open actions menu is not a positioned card any more');
  const s = card[0].props.style;
  assert.equal(s.top, '100%',
    'the menu is laid over the message it acts on, so the words being answered are hidden. top was: ' + JSON.stringify(s.top));
  assert.notEqual(s.top, 18, 'the menu is back at the offset that covered the bubble');
});

// The DEFECT this replaces: the ⋯ button hangs off the bubble's INNER edge (style.left:-30 for my own
// message, style.right:-30 for everyone else's), but the menu used to open from the OPPOSITE edge (right:0 /
// left:0), so after you tapped the ⋯ the card dropped to the far corner and looked detached (Oppo report).
// The fix pins the menu's NEAR edge to the button's side — the bubble's inner edge, left:'100%' for the other
// person (dots at the bubble's right edge), right:'100%' for mine (dots at the left edge) — so it hangs FROM
// the ⋯. We read both the button and the card from the rendered tree and assert they land on the same
// physical side. (The viewport clamp for an almost-full-width bubble is a browser/device check — see the two
// BROWSER tests below and the note in Row; there is no layout engine here.)
//
// Which physical side a style sits on: the ⋯ uses left/right:-30; the menu pins its near edge with
// left/right:'100%' (near edge at the bubble's OPPOSITE css edge) or, in the old code, 0.
const sideOfDots = (s) => (s.right !== undefined ? 'right' : s.left !== undefined ? 'left' : null);
const sideOfMenu = (s) => (s.left === '100%' ? 'right' : s.right === '100%' ? 'left'
  : s.left === 0 ? 'left' : s.right === 0 ? 'right' : null);

test('the menu hangs from the SAME side as the ⋯ button — someone else’s message and my own', () => {
  // someone else's message (dots[0]): ⋯ at the bubble's RIGHT edge → menu must hang RIGHT too.
  const a = room();
  const theirDots = dots(a())[0];
  theirDots.props.onClick();
  const theirs = menuCard(a())[0].props.style;
  assert.equal(sideOfMenu(theirs), sideOfDots(theirDots.props.style),
    'an incoming message drops its menu to the OPPOSITE corner from its ⋯ button');
  assert.equal(theirs.left, '100%',
    'the menu is not pinned to the ⋯ button’s (inner) edge — it still opens from the far edge of the bubble');
  assert.equal(theirs.right, undefined);
  assert.equal(theirs.top, '100%', 'the menu no longer opens BELOW the bubble, so it can cover the message');

  // my own message (dots[1]): ⋯ at the bubble's LEFT edge → menu must hang LEFT too.
  const b = room();
  const myDots = dots(b())[1];
  myDots.props.onClick();
  const own = menuCard(b())[0].props.style;
  assert.equal(sideOfMenu(own), sideOfDots(myDots.props.style),
    'my own message drops its menu to the OPPOSITE corner from its ⋯ button');
  assert.equal(own.right, '100%', 'my own menu is not pinned to the ⋯ button’s (inner) edge');
  assert.equal(own.left, undefined);
  assert.equal(own.top, '100%', 'my own menu no longer opens BELOW the bubble');
});

test('the menu is bounded in width, so a long item cannot stretch it off a narrow screen', () => {
  const draw = room();
  dots(draw())[0].props.onClick();
  const s = menuCard(draw())[0].props.style;
  assert.ok(s.maxWidth && s.maxWidth <= 260, 'the actions menu has no width ceiling: maxWidth was ' + s.maxWidth);
  assert.ok(s.minWidth <= s.maxWidth, 'the menu minimum is wider than its maximum');
});

test('a room message swipes to reply, and reads the offset the finger actually reached', () => {
  // The room has had swipe-to-reply since 1408c93 — inside Row, not DMSwipe — and it carried the same
  // stale-offset defect: no redraw between the last move and the lift means onTouchEnd tested an old number.
  const draw = room();
  const s = find(draw(), n => n.type === 'div' && n.props && typeof n.props.onTouchStart === 'function')[0];
  assert.ok(s, 're-anchor: a room message is no longer wrapped in a swipe handler');
  s.props.onTouchStart({ touches: [{ clientX: 100, clientY: 300 }] });
  s.props.onTouchMove({ touches: [{ clientX: 130, clientY: 301 }] });
  s.props.onTouchMove({ touches: [{ clientX: 160, clientY: 302 }] });   // 60px, past the 48px threshold
  s.props.onTouchEnd();                                                  // …with no redraw in between
  const after = texts(draw()).join(' | ');
  assert.match(after, /Replying to/,
    'a swipe in a ROOM did not start a reply. Room read: ' + after);
});

test('…and a short drag in a room does not reply', () => {
  const draw = room();
  const s = find(draw(), n => n.type === 'div' && n.props && typeof n.props.onTouchStart === 'function')[0];
  s.props.onTouchStart({ touches: [{ clientX: 100, clientY: 300 }] });
  s.props.onTouchMove({ touches: [{ clientX: 125, clientY: 301 }] });
  s.props.onTouchEnd();
  assert.doesNotMatch(texts(draw()).join(' | '), /Replying to/, 'a 25px drag in a room started a reply');
});

test('the room swipe declares touch-action: pan-y', () => {
  const draw = room();
  const s = find(draw(), n => n.type === 'div' && n.props && typeof n.props.onTouchStart === 'function')[0];
  assert.equal(s.props.style.touchAction, 'pan-y',
    'without pan-y the compositor may hand the horizontal drag to an ancestor scroller and cancel the touch');
});

// ── TOUCH (owner 2026-10-15): the ⋯ stays where it has MORE than Reply, and goes where Reply is all it holds ──

const hiddenDots = (b) => !!b.props.style && b.props.style.width === '1px' && b.props.style.opacity === 0 && !!b.props.style.clip && b.props.style.display !== 'none' && !b.props.disabled && b.props.tabIndex === undefined && b.props['aria-label'] === 'Message actions';
test('TOUCH: a plain member who may not DM privately has NO VISIBLE ⋯ on any room message (a hidden focusable one remains for assistive tech; swipe replies)', () => {
  globalThis.__roomTouch = true;
  try {
    const draw = room({ canDM: false });
    const tree = draw();
    assert.ok(dots(tree).length > 0 && dots(tree).every(hiddenDots), 'reply-only ⋯ still visible on touch, or the hidden assistive-tech route is gone: ' + dots(tree).length);
    assert.ok(find(tree, n => n.props && typeof n.props.onTouchStart === 'function').length >= 2, 'the swipe handlers are gone: no reply route left');
  } finally { globalThis.__roomTouch = false; }
});

test('TOUCH: the ⋯ is KEPT where there is more than Reply — Reply privately on their message, Pin/Remove for a leader', () => {
  globalThis.__roomTouch = true;
  try {
    const d1 = dots(room({ canDM: true })());
    assert.equal(d1.filter(b => !hiddenDots(b)).length, 1, 'their message (Reply privately) must keep the VISIBLE ⋯, mine (reply only) must not');
    assert.ok(d1.some(hiddenDots), 'mine (reply only) lost its hidden assistive-tech ⋯');
    assert.equal(dots(room({ leader: true, canDM: false })()).filter(b => !hiddenDots(b)).length, 2, 'a steward lost the visible ⋯ that holds Pin / Remove');
  } finally { globalThis.__roomTouch = false; }
});

// ── Z-ORDER, IN A REAL BROWSER (owner device report, 2026-10-15) ────────────────────────────────────────────
// The menu opens BELOW its message (top:100%, zIndex:5). zIndex:5 orders it only inside its own row; the NEXT
// message row is a later `position:relative` sibling and painted OVER it, so "Reply / Reply privately" sat
// behind the message underneath. The render harness above has no layout engine and cannot see that, so this
// drives the REAL Row / DMSwipe (compiled from app/screens-chat.jsx) with the REAL React in real Chromium and
// hit-tests a point inside the open menu. CLAUDE.md rule 3: nothing here matches text in app/*.jsx.
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9461;
const ROOTDIR = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PAGE_STUBS = `
  window.matchMedia = () => ({ matches: true, addEventListener(){}, removeEventListener(){} });
  const mk = (id, t, content) => ({ id, pubkey: 'themhex', kind: 1, created_at: t, tags: [], content });
  window.Fellowship = {
    myPubkey: 'mehex', relays: ['wss://relay.example'], relayReady: () => true, groupEncState: () => 'clear',
    pinPost: async () => ({ ok: true }), unpin: async () => ({ ok: true }), hideMessage: async () => ({ ok: true }),
    react() {}, requestProfiles() {}, outboxFor: () => [], onOutbox: () => () => {},
    subscribeGroup: (_g, add) => { add(mk('a1', 1756500000, 'First message, the one whose menu is open.'));
      add(mk('a2', 1756500100, 'Second message directly underneath. '.repeat(6))); add(mk('a3', 1756500200, 'Third message. '.repeat(6))); return () => {}; },
    subscribeReactions: () => () => {}, subscribeGroupPin: (_g, cb) => { cb(null); return () => {}; },
    subscribeHidden: (_g, cb) => { cb(new Set()); return () => {}; }, subscribeMessageTags: (_n, cb) => { cb([]); return () => {}; },
    displayFor: () => ({ handle: 'sam', color: '#888' }), canAddGroupEvent: () => false,
  };
  window.TrinityData = { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] };
  window.TrinityIdentity = { current: { handle: 'me', color: '#123456' } };
  window.D = { GROUPS: [], RELAYS: [] };
  window.lsGet = (_k, d) => d; window.lsSet = () => {}; window.todayISO = () => '2026-10-13';
  window.Icon = () => null;
  window.IconBtn = ({ name }) => React.createElement('button', { title: name });
  window.Overlay = ({ open, children }) => (open ? children : null);
  window.UserAvatar = () => null; window.SectionLabel = ({ children }) => children; window.BottomSheet = ({ children }) => children;
  window.safeCssColor = (c) => c;
`;

// Launch chromium, load real React + the compiled chat screen, run `body` (page JS that renders and returns
// a result), always tear down.
async function inBrowser(body) {
  await requireFreePort(CDP, 'a-message-menu-does-not-cover-the-message.test.mjs (Chrome debug port)');
  const prof = join(tmpdir(), 'trin-msgmenu-chr-' + process.pid + '-' + Date.now());
  // Blackhole the production relays: the app dials the canonical relays from any origin, so without this a
  // browser test could read/write live church data. no-browser-reaches-production.test.mjs enforces it.
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=411,800', 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let targets = null;
    for (let i = 0; i < 40 && !targets; i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const page = targets.find(t => t.type === 'page') || targets[0];
    ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 411, height: 800, deviceScaleFactor: 1, mobile: true });
    const run = async (expression) => {
      const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 400));
      return rr?.result?.result?.value;
    };
    await run(readFileSync(join(ROOTDIR, 'vendor/react.production.min.js'), 'utf8'));
    await run(readFileSync(join(ROOTDIR, 'vendor/react-dom.production.min.js'), 'utf8'));
    // The app's OWN entrance animation (index.html), read from the shipped file: `animation: trinityFade .3s ease both`
    // on a row is what turns each row into its own stacking context, which is the whole bug.
    const kf = /@keyframes trinityFade \{[^\n]*\}/.exec(readFileSync(join(ROOTDIR, 'index.html'), 'utf8'));
    assert.ok(kf, 're-anchor: @keyframes trinityFade is gone from index.html');
    await run(`(() => { const st = document.createElement('style'); st.textContent = ${JSON.stringify(kf[0])}; document.head.appendChild(st); })()`);
    await run(PAGE_STUBS);
    await run(compileScreen('app/reply-kit.jsx'));
    await run(compileScreen('app/screens-chat.jsx'));
    return await run(body);
  } finally {
    try { ws && ws.close(); } catch {}
    chr.kill('SIGKILL');
    await sleep(200);
    try { rmSync(prof, { recursive: true, force: true }); } catch {}
  }
}

// In-page: what is on top at the centre of the open menu?
const HIT = `
  const menu = document.querySelector('[data-msg-menu][style*="position: absolute"][style*="top: 100%"], [data-dm-menu][style*="top: 100%"]');
  if (!menu) return { menu: false };
  const r = menu.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  return { menu: true, onTop: !!(top && top.closest('[data-msg-menu],[data-dm-menu]')), h: r.height, y,
           under: top ? (top.textContent || '').slice(0, 60) : null };
`;

test('BROWSER: an OPEN room menu paints ON TOP of the message underneath it, not behind it', { skip: !CHROME && 'no chromium' }, async () => {
  const res = await inBrowser(`(async () => {
    const host = document.createElement('div'); host.style.cssText = 'width:411px;height:800px;position:relative;overflow:auto';
    document.body.style.margin = '0'; document.body.appendChild(host);
    const ctx = { toast() {}, church: { npub: 'npub1church', name: 'Trinity LA', id: 'c1' }, myLeaderGroups: [], churchEvents: [], safeguard: {},
      myPubkey: 'mehex', canDMPeer: () => true, openDM() {} };
    ReactDOM.createRoot(host).render(React.createElement(ChatRoom, { group: { id: 'g1', name: 'Youth', accent: 'var(--clay)', kind: 'Group' }, open: true, onClose() {}, ctx, docked: true }));
    await new Promise(r => setTimeout(r, 600));
    const dots = [...document.querySelectorAll('button[aria-label="Message actions"]')];
    if (dots.length < 2) return { menu: false, dots: dots.length };
    dots[0].click();
    await new Promise(r => setTimeout(r, 400));
    ${HIT.replace(/^/, '')}
  })()`);
  assert.equal(res.menu, true, 're-anchor: the open menu is not in the page: ' + JSON.stringify(res));
  assert.ok(res.h > 30, 'the menu has no height, so nothing was measured: ' + JSON.stringify(res));
  assert.equal(res.onTop, true,
    'the open actions menu is painted UNDER the message below it (Reply is covered). At its centre the page shows: ' + JSON.stringify(res.under));
});

// DMSwipe needed NO elevation: its rows have no entrance animation, so no row is a stacking context and the menu's
// zIndex:5 already ranks above the rows after it. Measured: this stays green with Row's lift removed. It is a GUARD
// (it goes red if someone gives a DM row its own stacking context), not proof of the Row fix above.
test('BROWSER: an OPEN direct-message menu paints ON TOP of the message underneath it', { skip: !CHROME && 'no chromium' }, async () => {
  const res = await inBrowser(`(async () => {
    const host = document.createElement('div'); host.style.cssText = 'width:411px;height:800px;position:relative;padding:20px 40px;box-sizing:border-box';
    document.body.style.margin = '0'; document.body.appendChild(host);
    const bubble = (t) => React.createElement('div', { style: { background: '#ddd', padding: 12, borderRadius: 12, maxWidth: 300 } }, t);
    const row = (key, open) => React.createElement(DMSwipe, { key, mine: false, onReply() {}, menuOpen: open, onOpenMenu() {}, noReply: false }, bubble('DM ' + key + ' '.padEnd(1) + 'text '.repeat(14)));
    ReactDOM.createRoot(host).render(React.createElement('div', null, row('one', true), row('two', false), row('three', false)));
    await new Promise(r => setTimeout(r, 400));
    ${HIT}
  })()`);
  assert.equal(res.menu, true, 're-anchor: the open DM menu is not in the page (is Reply-only ⋯ gated off here?): ' + JSON.stringify(res));
  assert.equal(res.onTop, true,
    'the open DM actions menu is painted UNDER the message below it. At its centre the page shows: ' + JSON.stringify(res.under));
});

// ── ASSISTIVE TECH ON TOUCH (Row): the reply-only ⋯ stays reachable as a hidden, focusable, clickable node ──────
// TalkBack / Switch Access cannot swipe. On touch the reply-only ⋯ is visually hidden but still a real button a
// screen-reader cursor lands on; focusing it shows the normal pill, activating it opens the menu holding Reply.
test('TOUCH POINT OF USE: the room reply-only ⋯ is hidden but focusable and clickable; focus shows it; a click opens Reply', () => {
  globalThis.__roomTouch = true;
  try {
    const draw = room({ canDM: false });
    const b = dots(draw())[0];
    assert.ok(b, 'THE DEFECT: on touch the reply-only ⋯ is ABSENT, so TalkBack has no reply route at all');
    const st = b.props.style;
    assert.equal(st.width, '1px'); assert.equal(st.height, '1px'); assert.equal(st.opacity, 0); assert.match(String(st.clip), /rect\(0/);
    assert.notEqual(st.display, 'none'); assert.notEqual(st.pointerEvents, 'none');
    assert.ok(!b.props.disabled && b.props.tabIndex === undefined, 'the hidden ⋯ must stay focusable');
    const el = { style: {} };
    b.props.onFocus({ currentTarget: el });
    assert.equal(el.style.width, '30px'); assert.equal(el.style.opacity, '1');
    b.props.onBlur({ currentTarget: el });
    assert.equal(el.style.width, '1px'); assert.equal(el.style.opacity, '0');
    b.props.onClick();
    assert.ok(find(draw(), n => n.type === 'button' && texts(n).join(' ').includes('Reply')).length >= 1, 'the hidden ⋯ opened no Reply');
  } finally { globalThis.__roomTouch = false; }
});
test('POINTER: the room reply-only ⋯ is the normal visible pill (not the hidden one)', () => {
  globalThis.__roomTouch = false;
  const b = dots(room({ canDM: false })())[0];
  assert.equal(b.props.style.width, 30); assert.equal(b.props.style.opacity, undefined); assert.equal(b.props.onFocus, undefined);
});
