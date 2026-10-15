// MESSAGE AN EVENT'S PEOPLE — console composer, sealed fan-out, member-side announcement.
//   Run: node --test scripts/message-event-attendees.test.mjs
//
// THREE HALVES, EACH TESTED AT THE POINT OF USE (CLAUDE.md rule 1, rule 3 — nothing here matches text in app/*.jsx):
//   1. ENVELOPE  — the real _dmWrap/_dmUnwrap lifted from vendor/fellowship.js and vendor/steward.js. The
//                  marker is ADDITIVE: old messages unwrap as before, an OLD build still reads the words.
//   2. CONSOLE   — the real SchEventMessage is compiled from app/stew-schedule.jsx and RENDERED; the steward's
//                  buttons are pressed and Steward.sendDM is a spy. Going-only reaches exactly the Going
//                  pubkeys; everyone reaches the audience; a half-failed fan-out never says "Sent".
//   3. MEMBER    — the real DMThread is rendered with messages that went through the REAL subscribeThread
//                  and _dmUnwrap. A no-reply message loses swipe, ⋯ menu and Reply; a normal one keeps them.
//
// Users of the code touched (rule 2):
//   _dmWrap / _dmUnwrap (member app)  : sendDM, subscribeThread (deliver), subscribeDMs (list preview).
//   _dmWrap / _dmUnwrap (console)     : Steward.sendDM, subscribeDMThread (take).
//   Fellowship.sendDM (unchanged signature): DMThread.send, ShareSheet (screens-chat.jsx) — they never pass `meta`.
//   Steward.sendDM callers            : GroupLeadersModal (stew-dashboard), StewDmWindow.send, SchEventMessage.
//   DMSwipe                           : DMThread only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact as hMiniReact, texts as hTexts, find as hFind, reads } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const FEL = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');
const STW = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const SCH = readFileSync(join(ROOT, 'app/stew-schedule.jsx'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

// ── 1. ENVELOPE ──────────────────────────────────────────────────────────────────────────────────────────
const felWrap = fnBody(FEL, '_dmWrap(text, replyTo, meta) {', '_dmWrap');
const felUnwrap = fnBody(FEL, '_dmUnwrap(body) {', '_dmUnwrap');
const fel = new Function(`return ({ ${felWrap}, ${felUnwrap} });`)();
const stwWrap = fnBody(STW, 'var _dmWrap = (text, replyTo, meta) => {', '_dmWrap');
const stwUnwrap = fnBody(STW, 'var _dmUnwrap = (body) => {', '_dmUnwrap');
const stw = new Function(`${stwWrap}\n${stwUnwrap}\nreturn { _dmWrap, _dmUnwrap };`)();
// What the build BEFORE this feature did with an envelope — the app an older member still has installed.
const oldUnwrap = (body) => {
  if (typeof body !== 'string' || body[0] !== '{') return { text: body, replyTo: null };
  try { const o = JSON.parse(body); if (o && o.v === 1 && typeof o.t === 'string') return { text: o.t, replyTo: o.r || null }; } catch (e) {}
  return { text: body, replyTo: null };
};

for (const [who, e] of [['member app', fel], ['console', stw]]) {
  test(`${who}: a plain message is still the bare string, and a reply envelope is byte-identical to before`, () => {
    assert.equal(e._dmWrap('hello'), 'hello');
    assert.equal(e._dmWrap('hello', null, {}), 'hello');
    assert.equal(e._dmWrap('hi', { id: 'abc' }), JSON.stringify({ v: 1, t: 'hi', r: 'abc' }));
  });
  test(`${who}: the no-reply marker survives a round trip, with the event id`, () => {
    const body = e._dmWrap('Doors at 6', null, { noReply: true, eventId: 'ev1' });
    const un = (e._dmUnwrap || fel._dmUnwrap)(body);
    assert.equal(un.text, 'Doors at 6');
    assert.equal(un.noReply, true);
    assert.equal(un.eventId, 'ev1');
    const open = (e._dmUnwrap || fel._dmUnwrap)(e._dmWrap('Doors at 6', null, { eventId: 'ev1' }));
    assert.equal(open.noReply, false, 'a reply-allowed event message must not be flagged');
  });
}
test('BACKWARDS COMPAT: old messages (bare, and v:1 reply) unwrap with noReply false in BOTH engines', () => {
  for (const u of [fel._dmUnwrap, stw._dmUnwrap]) {
    assert.deepEqual(u('plain words'), { text: 'plain words', replyTo: null, noReply: false, eventId: null });
    const r = u(JSON.stringify({ v: 1, t: 'old reply', r: 'xyz' }));
    assert.equal(r.text, 'old reply'); assert.equal(r.replyTo, 'xyz'); assert.equal(r.noReply, false);
    assert.equal(u('{not json').text, '{not json');
  }
});
test('BACKWARDS COMPAT: an OLDER build receiving the new envelope still shows the words', () => {
  const body = fel._dmWrap('Doors at 6', null, { noReply: true, eventId: 'ev1' });
  assert.equal(oldUnwrap(body).text, 'Doors at 6');
  assert.equal(oldUnwrap(stw._dmWrap('Doors at 6', null, { noReply: true, eventId: 'ev1' })).text, 'Doors at 6');
});
test('both engines write the SAME envelope for the same input', () => {
  const m = { noReply: true, eventId: 'ev1' };
  assert.equal(fel._dmWrap('t', { id: 'r1' }, m), stw._dmWrap('t', { id: 'r1' }, m));
});

// ── 2. CONSOLE ───────────────────────────────────────────────────────────────────────────────────────────
function compile(src, names, globals) {
  const tmp = join(tmpdir(), 'msgatt-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${names.join(', ')} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__msgatt_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
}
function miniReact() {
  const states = [], memos = [], effDeps = [];
  let queued = [], i = 0, mi = 0, ei = 0;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, n) => Object.is(v, b[n]));
  const React = {
    useState(init) { const k = i++; if (!(k in states)) states[k] = typeof init === 'function' ? init() : init;
      return [states[k], (v) => { states[k] = typeof v === 'function' ? v(states[k]) : v; }]; },
    useMemo(f, deps) { const k = mi++; if (!memos[k] || !same(memos[k].deps, deps)) memos[k] = { deps, v: f() }; return memos[k].v; },
    useEffect(fn, deps) { const k = ei++; if (!(k in effDeps) || !same(effDeps[k], deps)) { effDeps[k] = deps; queued.push(fn); } },
    useRef: () => ({ current: null }), useCallback: (f) => f,
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    Fragment: 'Fragment',
  };
  return { React, reset: () => { i = 0; mi = 0; ei = 0; }, flush: () => { const r = queued; queued = []; r.forEach(f => f()); } };
}
const find = hFind;
const texts = (n, out = []) => { if (n == null || n === false) return out; if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; } if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; } (n.kids || []).forEach(c => texts(c, out)); return out; };   // children only: the harness texts() also yields string props like className

// Lift just the composer and its three helpers out of the 3,000-line schedule file.
const SLICE = ['function schEventAudience(', 'async function schSendEventMessage(', 'function schSendSummary(', 'function schEventPostGroup(', 'function SchEventMessage(']
  .map(a => fnBody(SCH, a, a)).join('\n');

const P = (c) => c.repeat(64);
const GOING1 = P('1'), GOING2 = P('2'), MAYBE = P('3'), NO = P('4'), NORSVP = P('5'), BLOCKED = P('6');
const MEMBERS = [GOING1, GOING2, MAYBE, NO, NORSVP, BLOCKED].map((pubkey, n) => ({ pubkey, name: 'Person' + (n + 1) }));
const EVENT = { id: 'ev-1', title: 'Harvest supper', date: '2026-11-01' };
const RSVPS = { 'ev-1': { [GOING1]: 'going', [GOING2]: 'going', [MAYBE]: 'maybe', [NO]: 'no', [BLOCKED]: 'going' } };

async function composer({ event = EVENT, groups = [], failFor = new Set(), queuedFor = new Set(), postResult = { id: 'post-1' } } = {}) {
  const calls = [];
  const posts = [];   // B6: every window.Steward.publishPost(content, group) the composer makes
  const timers = []; let closed = 0;   // setTimeout is faked so the auto-close can be seen and fired
  const { React, reset, flush } = miniReact();
  const Steward = {
    pubkey: P('f'),
    sendDM: async (pk, body, rt, meta) => { calls.push({ pk, body, rt, meta }); if (failFor.has(pk)) return null; return queuedFor.has(pk) ? { id: 'q', _queued: true } : { id: 'e' + calls.length }; },
    publishPost: async (content, group, replyTo) => { posts.push({ content, group, replyTo }); return typeof postResult === 'function' ? postResult() : postResult; },
  };
  const mod = await compile(SLICE, ['SchEventMessage', 'schEventAudience'], {
    React, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
    window: { Steward, useStewardRsvps: () => RSVPS, useStewardMembers: () => MEMBERS,
      useStewardPickableMembers: () => MEMBERS.filter(m => m.pubkey !== BLOCKED),
      useStewardGroups: () => groups, useStewardBlocked: () => [BLOCKED] },
  });
  const draw = () => { reset(); const t = mod.SchEventMessage({ event, onClose() { closed++; } }); flush(); return t; };
  draw();
  const btn = (label) => find(draw(), n => n.type === 'button' && texts(n).join(' ').includes(label))[0];
  const type = (v) => find(draw(), n => n.type === 'textarea')[0].props.onChange({ target: { value: v } });
  const send = async () => { const b = find(draw(), n => n.type === 'button' && /^(Send to|Retry|Post to)/.test(texts(n).join('')))[0]; await b.props.onClick(); await tick(); await tick(); };
  return { calls, posts, timers, closed: () => closed, draw, btn, type, send, mod, Steward, status: () => texts(find(draw(), n => n.props && n.props.role === 'status')[0]).join(' | ') };
}

test('CONSOLE: "Just those going" sends to exactly the Going pubkeys, not Maybe / No / blocked / no-RSVP', async () => {
  const c = await composer();
  c.btn('Just those going').props.onClick();
  c.type('Bring a dish');
  await c.send();
  assert.deepEqual(c.calls.map(x => x.pk).sort(), [GOING1, GOING2].sort());
  for (const x of c.calls) { assert.equal(x.body, 'Bring a dish'); assert.equal(x.meta.eventId, 'ev-1'); }
});
test('CONSOLE: "Everyone invited" reaches the whole audience (church members, minus the blocked)', async () => {
  const c = await composer();
  c.type('See you there');
  await c.send();
  assert.deepEqual(c.calls.map(x => x.pk).sort(), [GOING1, GOING2, MAYBE, NO, NORSVP].sort());
});
// Updated for B6 (2026-10-15): an invite-only *team* (not a chat group) still DMs its roster — the invite
// branch of schEventAudience, which drops the blocked member, is exercised here. (A plain invite-only CHAT
// group now posts to the group instead; that is the B6 behaviour change, covered below.)
test('CONSOLE: an invite-only TEAM event DMs that team\'s roster, not the whole church, and drops the blocked', async () => {
  const groups = [{ id: 'g1', kind: 'team', visibility: 'invite', members: [GOING1, NORSVP, BLOCKED] }];
  const c = await composer({ event: { ...EVENT, groupId: 'g1' }, groups });
  c.type('Group news');
  await c.send();
  assert.equal(c.posts.length, 0, 'a team is a DM fan-out, not a group post');
  assert.deepEqual(c.calls.map(x => x.pk).sort(), [GOING1, NORSVP].sort(), 'blocked roster member must be dropped');
});
test('CONSOLE: the replies toggle sets the no-reply flag on every message', async () => {
  const a = await composer();
  a.type('hello'); await a.send();
  assert.ok(a.calls.length > 0 && a.calls.every(x => x.meta.noReply === false));
  const b = await composer();
  b.btn('Announcement').props.onClick();
  b.type('hello'); await b.send();
  assert.ok(b.calls.length > 0 && b.calls.every(x => x.meta.noReply === true));
});
test('CONSOLE: a half-failed fan-out is NOT reported as sent, names the shortfall, and Retry re-sends only to the failures', async () => {
  const c = await composer({ failFor: new Set([GOING2]) });
  c.btn('Just those going').props.onClick();
  c.type('Bring a dish');
  await c.send();
  const said = c.status();
  assert.doesNotMatch(said, /^Sent to/, 'a partial failure said "Sent to…": ' + said);
  assert.match(said, /1 sent/); assert.match(said, /1 NOT sent/); assert.match(said, /Person2/);
  const retry = find(c.draw(), n => n.type === 'button' && /^Retry 1/.test(texts(n).join('')))[0];
  assert.ok(retry, 'no retry offered for the one person not reached');
  c.calls.length = 0;
  c.Steward.sendDM = async (pk, body, rt, meta) => { c.calls.push({ pk }); return { id: 'ok' }; };
  await retry.props.onClick(); await tick(); await tick();
  assert.deepEqual(c.calls.map(x => x.pk), [GOING2]);
});
test('CONSOLE: a clean fan-out says Sent to N, and a QUEUED one is not called sent', async () => {
  const a = await composer();
  a.btn('Just those going').props.onClick(); a.type('x'); await a.send();
  assert.match(a.status(), /Sent to 2 people\./);
  const b = await composer({ queuedFor: new Set([GOING1]) });
  b.btn('Just those going').props.onClick(); b.type('x'); await b.send();
  assert.doesNotMatch(b.status(), /^Sent to/); assert.match(b.status(), /waiting for signal/);
});
test('CONSOLE: the event detail offers the Message action, which opens the composer (point of use)', async () => {
  const Detail = fnBody(SCH, 'function SchEventDetail(', 'SchEventDetail');
  const { React, reset, flush } = miniReact();
  const mod = await compile(SLICE + '\n' + Detail, ['SchEventDetail'], {
    React, window: { useStewardRsvps: () => RSVPS, useStewardMembers: () => MEMBERS, Steward: {} },
    Icon: () => null, SchDateBlock: () => null, SchEventEdit: () => null, useStewDialog: () => null,
    schNthLabel: () => '',
  });
  const draw = () => { reset(); const t = mod.SchEventDetail({ event: EVENT, onClose() {} }); flush(); return t; };
  const open = find(draw(), n => n.type === 'button' && texts(n).join(' ').includes('Message'));
  assert.equal(open.length, 1, 'the event detail has no Message button');
  assert.equal(find(draw(), n => n.props && n.props['aria-label'] === 'Message attendees').length, 0);
  open[0].props.onClick();
  const after = draw();
  assert.ok(find(after, n => typeof n.type === 'function' && n.type.name === 'SchEventMessage').length === 1, 'pressing Message did not open the composer');
});

// ── 2b. B6: "Everyone invited" posts into a chat-group event's group, instead of a DM fan-out ────────────────
// FEATURE PRESENCE — fails if the group-post branch is deleted from the SCREEN (CLAUDE.md rule 1): render the
// real composer with a chat-group event, press the real "Everyone invited" + Send buttons, and prove ONE
// publishPost(group, text) and ZERO sendDM.
test('B6 CONSOLE: an event from a chat group posts ONCE into that group and does NOT DM anyone', async () => {
  const groups = [{ id: 'cg1', name: 'Youth', kind: 'group' }];
  const c = await composer({ event: { ...EVENT, groupId: 'cg1' }, groups });
  c.type('Harvest supper — 6pm Saturday');
  await c.send();
  assert.equal(c.posts.length, 1, 'expected exactly one group post');
  assert.equal(c.posts[0].group, 'cg1', 'the post must carry the originating group id');
  assert.equal(c.posts[0].content, 'Harvest supper — 6pm Saturday', 'the post must carry the typed text');
  assert.equal(c.calls.length, 0, 'a chat-group post must not DM anyone');
  assert.match(c.status(), /Posted to the group/);
});
// NEGATIVE GUARDS — the DM fan-out must stay EXACTLY as today for everything that is not a postable chat group.
test('B6 CONSOLE: a church-wide event (groupId empty) still fans out by DM, never a group post', async () => {
  const c = await composer({ event: { ...EVENT, groupId: '' } });
  c.type('See you there');
  await c.send();
  assert.equal(c.posts.length, 0, 'church-wide must not post to a group');
  assert.deepEqual(c.calls.map(x => x.pk).sort(), [GOING1, GOING2, MAYBE, NO, NORSVP].sort());
});
test('B6 CONSOLE: a BROADCAST group event still fans out by DM, never a group post', async () => {
  const groups = [{ id: 'b1', name: 'Notices', kind: 'broadcast' }];
  const c = await composer({ event: { ...EVENT, groupId: 'b1' }, groups });
  c.type('Notice');
  await c.send();
  assert.equal(c.posts.length, 0, 'a one-way broadcast is not a chat-group post audience');
  assert.ok(c.calls.length > 0, 'broadcast event still DMs the church');
});
test('B6 CONSOLE: "Just those going" on a chat-group event still fans out by DM (an RSVP subset is not the group)', async () => {
  const groups = [{ id: 'cg1', name: 'Youth', kind: 'group' }];
  const c = await composer({ event: { ...EVENT, groupId: 'cg1' }, groups });
  c.btn('Just those going').props.onClick();
  c.type('Bring a dish');
  await c.send();
  assert.equal(c.posts.length, 0, '"Just those going" must never become a group post');
  assert.deepEqual(c.calls.map(x => x.pk).sort(), [GOING1, GOING2].sort());
});
// SUMMARY MAPPING — a publishPost that resolves null/false is a real failure, never "Sent"/"Posted" (CLAUDE.md
// "fix the control, not the label"; mirrors how the DM half refuses to claim a send that did not happen).
test('B6 CONSOLE: a refused group post (publishPost -> null) shows a NOT-posted state, never Sent/Posted', async () => {
  const groups = [{ id: 'cg1', name: 'Youth', kind: 'group' }];
  const c = await composer({ event: { ...EVENT, groupId: 'cg1' }, groups, postResult: null });
  c.type('Harvest supper');
  await c.send();
  assert.equal(c.posts.length, 1, 'it still attempted the post');
  const said = c.status();
  assert.doesNotMatch(said, /^Sent to/, 'a refused post said "Sent to…": ' + said);
  assert.doesNotMatch(said, /Posted to the group/, 'a refused post must not claim it posted: ' + said);
  assert.match(said, /Not posted/, 'a refused post must say so: ' + said);
  assert.doesNotMatch(said, /Closing/, 'a refused post must not enter the auto-close state');
});

// ── 3. MEMBER ────────────────────────────────────────────────────────────────────────────────────────────
const ME = 'a'.repeat(64), CHURCH = 'c'.repeat(64);
const subSrc = fnBody(FEL, 'subscribeThread(peerPub, onMsg) {', 'subscribeThread');
function memberThread(bodies, churchEvents = []) {
  // The REAL subscribeThread + REAL _dmUnwrap: each body is what the church's sendDM put inside the ciphertext.
  let handler;
  const pool = { subscribeMany: (_u, _f, h) => { handler = h; return { close() {} }; } };
  const W = { Fellowship: { relays: [] } };
  const lib = new Function('pool', 'window', 'pub', 'sk', '_dmDecrypt', '_netRelays', `return ({ ${felUnwrap}, ${subSrc} });`)(
    pool, W, ME, new Uint8Array(32), async (_sk, _p, ct) => ct, (u) => u);
  W.Fellowship._dmUnwrap = lib._dmUnwrap;
  const { React, draw } = hMiniReact();
  const F = {
    myPubkey: ME, relays: ['wss://r'], ready: Promise.resolve(),
    subscribeThread: (peer, add) => lib.subscribeThread(peer, add),
    outboxForPeer: () => [], onOutbox: () => () => {}, dmPlaintextOf: () => '',
    displayFor: () => ({ handle: 'Church', av: { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' } }),
    requestProfiles: () => {}, reactDM: () => {}, sendDM: async () => ({}), requeue: () => true, dropQueued: () => {},
  };
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread', 'DMSwipe'], {
    React, window: { Fellowship: F, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-10-14',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ children }) => children, ScreenScroll: ({ children }) => children,
    ChurchPill: () => null, UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
  });
  const props = { peer: CHURCH, open: true, onClose() {}, ctx: { toast() {}, canDMPeer: () => true, connTick: 0, openDM() {}, churchEvents }, docked: false };
  const redraw = () => draw(mod.DMThread, props);
  redraw();
  return (async () => {
    let n = 0;
    for (const b of bodies) await handler.onevent({ id: 'm' + (++n), kind: 4, pubkey: CHURCH, tags: [['p', ME]], created_at: 1760000000 + n, content: b });
    await tick();
    return { redraw };
  })();
}
const dotsOf = (t) => find(t, n => n.type === 'button' && n.props && n.props['aria-label'] === 'Message actions');
const swipersOf = (t) => find(t, n => n.type === 'div' && n.props && typeof n.props.onTouchStart === 'function');
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });

test('MEMBER: a no-reply church message shows "Announcement" and offers NO dots, NO Reply, and a swipe does not start a reply', async () => {
  const t = await memberThread([fel._dmWrap('Doors at 6', null, { noReply: true, eventId: 'ev-1' })], [{ id: 'ev-1', title: 'Harvest supper' }]);
  const tree = t.redraw();
  assert.match(reads(tree), /Announcement/);
  assert.match(reads(tree), /Doors at 6/);
  assert.equal(dotsOf(tree).length, 0, 'an announcement still carries the ⋯ menu');
  const s = swipersOf(tree)[0];
  s.props.onTouchStart(touch(100, 300)); s.props.onTouchMove(touch(130, 302)); s.props.onTouchMove(touch(170, 303)); s.props.onTouchEnd();
  assert.doesNotMatch(reads(t.redraw()), /Replying to/, 'swiping an announcement started a reply');
});
test('MEMBER: a reply-allowed event message and a plain message keep the ⋯ menu, Reply and the swipe (the event one is labelled, the plain one is not)', async () => {
  const t = await memberThread([fel._dmWrap('Doors at 6', null, { eventId: 'ev-1' }), 'plain old message']);
  const tree = t.redraw();
  assert.equal((reads(tree).match(/nnouncement/g) || []).length, 1);
  assert.equal(dotsOf(tree).length, 2);
  dotsOf(tree)[0].props.onClick();
  const reply = find(t.redraw(), n => n.type === 'button' && texts(n).join(' ').includes('Reply'));
  assert.equal(reply.length, 1, 'a normal message lost its Reply');
  reply[0].props.onClick();
  assert.match(reads(t.redraw()), /Replying to Church/);
});
test('MEMBER: in a mixed thread only the announcement loses the affordances', async () => {
  const t = await memberThread(['plain', fel._dmWrap('Doors at 6', null, { noReply: true }), 'plain two']);
  const tree = t.redraw();
  assert.equal(dotsOf(tree).length, 2);
  assert.equal((reads(tree).match(/Announcement/g) || []).length, 1);
});

// ── the console engine really puts the marker INSIDE the ciphertext ─────────────────────────────────────────
test('ENGINE: Steward.sendDM wraps `meta` into the encrypted body (and a plain send is still a bare string)', async () => {
  const sendSrc = fnBody(STW, 'async sendDM(peerHex, content, replyTo, meta) {', 'sendDM');
  const fin = (sendSrc.match(/\b(finalizeEvent\d*)\(/) || [])[1];
  assert.ok(fin, 're-anchor: sendDM no longer signs an event');
  let sealed = null; const published = [];
  const scope = { sk: new Uint8Array(32).fill(7), pub: 'p'.repeat(64), NET: 'n', now: () => 5, _monotonic: (t) => t, _sOutLoad() {}, _sOutSave() {},
    _sOutbox: [], _sOutPlain: new Map(), _dmEncrypt: (_sk, _p, body) => { sealed = body; return 'ct'; }, _dmWrap: stw._dmWrap,
    publish: async (e) => { published.push(e); return true; }, [fin]: (t) => ({ ...t, id: 'id' + published.length, sig: 's' }) };
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(k in globalThis), get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined; throw new ReferenceError('stub ' + String(k)); }, set: (t, k, v) => { t[k] = v; return true; } });
  const send = new Function('scope', `with (scope) { return ({ ${sendSrc} }).sendDM; }`)(proxy);
  await send('q'.repeat(64), 'Doors at 6', null, { noReply: true, eventId: 'ev-9' });
  const un = stw._dmUnwrap(sealed);
  assert.equal(un.text, 'Doors at 6'); assert.equal(un.noReply, true); assert.equal(un.eventId, 'ev-9');
  await send('q'.repeat(64), 'plain');
  assert.equal(sealed, 'plain');
});


// ── B4: the composer confirms a REAL success and closes; anything less stays open ─────────────────────────
test('B4 CONSOLE: a fully delivered send says so, then closes the box when the timer fires (not before)', async () => {
  const c = await composer();
  c.btn('Just those going').props.onClick();
  c.type('Bring a dish'); await c.send();
  c.draw();
  assert.match(c.status(), /Sent to 2 people\./);
  assert.match(c.status(), /Closing/);
  assert.equal(c.closed(), 0, 'closed before the steward could read the confirmation');
  assert.equal(c.timers.length, 1, 'no auto-close was scheduled');
  c.timers[0]();
  assert.equal(c.closed(), 1);
});
test('B4 CONSOLE: a half-failed send keeps the box open and the words, schedules NO close, and says so', async () => {
  const c = await composer({ failFor: new Set([GOING2]) });
  c.btn('Just those going').props.onClick();
  c.type('Bring a dish'); await c.send();
  c.draw();
  assert.equal(c.timers.length, 0, 'a partly failed send scheduled a close');
  assert.equal(c.closed(), 0);
  assert.match(c.status(), /1 NOT sent/);
  assert.doesNotMatch(c.status(), /Closing/);
  assert.equal(find(c.draw(), n => n.type === 'textarea')[0].props.value, 'Bring a dish', 'the words were lost');
});
test('B4 CONSOLE: a send where nobody was reached, or everything was only queued, never closes the box', async () => {
  const none = await composer({ failFor: new Set([GOING1, GOING2]) });
  none.btn('Just those going').props.onClick(); none.type('x'); await none.send(); none.draw();
  assert.equal(none.timers.length, 0); assert.equal(none.closed(), 0);
  assert.match(none.status(), /2 NOT sent/);
  const q = await composer({ queuedFor: new Set([GOING1, GOING2]) });
  q.btn('Just those going').props.onClick(); q.type('x'); await q.send(); q.draw();
  assert.equal(q.timers.length, 0, 'saved-but-waiting was treated as delivered');
  assert.match(q.status(), /waiting for signal/);
  assert.equal(find(q.draw(), n => n.type === 'textarea')[0].props.value, 'x');
});

// ── B5: the event id reaches the screen as "<event name> Announcement" ───────────────────────────────────────
const KNOWN = [{ id: 'ev-1', title: 'Harvest supper' }];
test('B5 MEMBER: a message sent about a known event is labelled "<event name> Announcement"', async () => {
  const t = await memberThread([fel._dmWrap('Doors at 6', null, { noReply: true, eventId: 'ev-1' })], KNOWN);
  assert.match(reads(t.redraw()), /Harvest supper Announcement/);
});
test('B5 MEMBER: an event the app does not hold falls back to "Event announcement"; no event id keeps plain "Announcement"; plain DM has none', async () => {
  const t = await memberThread([fel._dmWrap('a', null, { eventId: 'ev-gone' }), fel._dmWrap('b', null, { noReply: true }), 'plain'], KNOWN);
  const r = reads(t.redraw());
  assert.match(r, /Event announcement/);
  assert.equal((r.match(/nnouncement/g) || []).length, 2);
  assert.match(r, /(^|[^t] )Announcement/);
});

const subDM = fnBody(STW, 'subscribeDMThread(peerHex, onMsgs) {', 'subscribeDMThread');
async function consoleWindow(bodies, events) {
  const { loadComponent } = await import('./console-component-rig.mjs');
  let handler;
  const pool = { subscribeMany: (_r, _f, h) => { handler = h; return { close() {} }; } };
  const lib = new Function('pub', 'sk', 'pool', 'relays', '_dmDecrypt', '_dmUnwrap', `return ({ ${subDM} });`)(
    'a'.repeat(64), new Uint8Array(32), pool, () => [], async (_s, _o, ct) => ct, stw._dmUnwrap);
  const { React, reset, flush } = miniReact();
  const Steward = { subscribeDMThread: lib.subscribeDMThread, sendDM: async () => ({}), reactDM() {}, outboxForPeer: () => [] };
  const Comp = await loadComponent('app/stew-dashboard.jsx', ['function stewDmAnnounceLabel(', 'function StewDmWindow('], {
    React, window: { Steward, useStewardEvents: () => events, addEventListener() {}, removeEventListener() {} },
    Icon: () => null, SkBadge: () => null, SK_TINT: { gold: { fg: '#000' } }, nameHandle: () => '', shortNpub: () => 'npub1',
    TrinityReplyKit: { handlers: () => ({}), style: () => ({}), cue: () => null, quote: () => null },
  });
  const draw = () => { reset(); const t = Comp.StewDmWindow({ peer: { pubkey: 'c'.repeat(64), name: 'Ruth' }, offset: 0, onClose() {} }); flush(); return t; };
  draw();
  let n = 0;
  for (const b of bodies) await handler.onevent({ id: 'm' + (++n), kind: 4, pubkey: 'c'.repeat(64), tags: [], created_at: 1760000000 + n, content: b });
  await tick();
  return draw;
}
test('B5 CONSOLE: the steward DM window labels a message about a known event, falls back for an unknown one, leaves a plain one alone', async () => {
  const draw = await consoleWindow([stw._dmWrap('Doors at 6', null, { noReply: true, eventId: 'ev-1' }), stw._dmWrap('x', null, { eventId: 'ev-gone' }), 'plain'], KNOWN);
  const r = reads(draw());
  assert.match(r, /Harvest supper Announcement/);
  assert.match(r, /Event announcement/);
  assert.equal((r.match(/nnouncement/g) || []).length, 2);
});
