// A CARE THREAD DOES NOT VANISH WHEN THE CHURCH SETS THE HELP UP (sim item 24, SIM-VERIFY-2026-10-02).
//   Run: node --test scripts/care-thread-comes-back-when-they-write-again.test.mjs
//
// THE DEFECT: the console listed a request for help only while its status was 'open'. "Set up help" (or Close)
// writes a status document, the request dropped off the list, and with it went the only "Message" button its
// thread had. The member could go on writing; nobody on the console could see it.
//
// THE OWNER'S DECISIONS (2026-10-02): closed care threads come back when the person writes again, and a message
// in a set-up or closed thread counts on the Overview banner as needing attention.
//
// FOUR LAYERS, EACH RUN RATHER THAN READ (CLAUDE.md rules 1 and 3 — nothing here matches text in app/*.jsx):
//   1. the rule — careThreadAttention, imported;
//   2. the engine — subscribeCareRequests and careThreadAttention LIFTED OUT OF vendor/steward-meals.js (the
//      bundle the console loads) and fed real-shaped events;
//   3. the Care page — StewCareRequests compiled from app/stew-meals.jsx and DRAWN;
//   4. the Overview banner — DashOverview sliced out of app/stew-dashboard.jsx, compiled and DRAWN.
//
// USERS OF WHAT CHANGED — subscribeCareRequests (src/steward-meals.src.js) has exactly two callers, both
// enumerated here: StewCareRequests (app/stew-meals.jsx) and DashOverview's banner (app/stew-dashboard.jsx).
// Its new field `newMessage` is additive; both read it. The member-app twin, Fellowship.subscribeCareRequests,
// is a different function and is NOT changed (the care-team phone keeps its own list — see the commit message).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { careThreadAttention } from './care-thread-attention.mjs';
import { loadScreen, miniReact, texts as treeTexts, find as treeFind } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const VENDOR = readFileSync(join(ROOT, 'vendor/steward-meals.js'), 'utf8');
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const CHURCH = 'c'.repeat(64), ASKER = 'a'.repeat(64), STRANGER = 'e'.repeat(64);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// ── 1. THE RULE ──────────────────────────────────────────────────────────────────────────────────────────
test('RULE: open always needs attention; set up or closed only when the asker has written since and nobody answered', () => {
  assert.deepEqual(careThreadAttention({ status: 'open', statusTs: 0, askerAt: 0, teamAt: 0 }), { needs: true, returned: false });
  for (const status of ['approved', 'declined', 'handled']) {
    assert.deepEqual(careThreadAttention({ status, statusTs: 100, askerAt: 0, teamAt: 0 }), { needs: false, returned: false }, status + ' with no message');
    assert.deepEqual(careThreadAttention({ status, statusTs: 100, askerAt: 150, teamAt: 0 }), { needs: true, returned: true }, status + ' and they wrote again');
    assert.deepEqual(careThreadAttention({ status, statusTs: 100, askerAt: 150, teamAt: 160 }), { needs: false, returned: false }, status + ' and the team answered');
    assert.deepEqual(careThreadAttention({ status, statusTs: 100, askerAt: 90, teamAt: 0 }), { needs: false, returned: false }, status + ': a message BEFORE the status is not new');
    assert.deepEqual(careThreadAttention({ status, statusTs: 100, askerAt: 100, teamAt: 0 }), { needs: false, returned: false }, status + ': the same second counts as before');
    assert.deepEqual(careThreadAttention({ status, statusTs: 100, askerAt: 170, teamAt: 160 }), { needs: true, returned: true }, status + ': they wrote AFTER the team’s reply, so it is back');
  }
});

// ── 2. THE ENGINE ────────────────────────────────────────────────────────────────────────────────────────
function engine() {
  const subs = [];
  const stubs = {
    S: () => ({
      churchPub: CHURCH,
      subscribeMany: (filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; },
      // A sealed body is `{ ok, body }`: openable when ok. Stands in for NIP-44 — it decides nothing about
      // who wrote a message or when; those come from the event's own pubkey and created_at.
      openSealedFromPeer: (o) => { if (!o || !o.ok) throw new Error('cannot open'); return o.body; },
    }),
    NET: 'trinityone',
    CAREREQ_D: 'trinityone/carereq:', CARESTATUS_D: 'trinityone/carereqstatus:', CARECHAT_D: 'trinityone/carechat:',
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the lifted subscribeCareRequests needs `' + String(k) + '` — add a stub'); },
  });
  const rule = fnBody(VENDOR, 'function careThreadAttention(', 'careThreadAttention');
  const sub = fnBody(VENDOR, 'function subscribeCareRequests(cb) {', 'subscribeCareRequests');
  const subscribe = new Function('scope', `with (scope) { ${rule}\n return (${sub}); }`)(scope);
  let latest = null;
  const stop = subscribe((list) => { latest = list; });
  const h = subs[subs.length - 1];
  assert.ok(h, 'the lifted subscription never reached subscribeMany — nothing below is exercised');
  const ev = (d, pubkey, created_at, content, extra = []) => ({ id: d + created_at, pubkey, created_at, kind: 30078, tags: [['d', d], ...extra], content: JSON.stringify(content) });
  return {
    filters: h.filters,
    request: (id = 'r1', at = 1000) => h.handlers.onevent(ev('trinityone/carereq:' + id, ASKER, at, { ok: true, body: { type: 'meals', note: 'a lift please', forSelf: true } })),
    status: (status, at, id = 'r1', needId = 'n1') => h.handlers.onevent(ev('trinityone/carereqstatus:' + id, CHURCH, at, { status, needId })),
    chat: (from, at, msgId, { openable = true, id = 'r1' } = {}) => h.handlers.onevent(ev('trinityone/carechat:' + id + ':' + msgId, from, at, { ok: openable, body: { text: 'hello', at } })),
    row: (id = 'r1') => (latest || []).find(r => r.id === id),
    stop,
  };
}

test('ENGINE: the subscription listens for care-chat messages as well as requests', () => {
  const e = engine();
  assert.ok(e.filters.some(f => (f['#t'] || []).includes('carechat')),
    'the console never subscribes to the thread, so it cannot know the person wrote again. Filters: ' + JSON.stringify(e.filters));
  assert.ok(e.filters.some(f => (f['#t'] || []).includes('carereq')), 're-anchor: the request filter is gone');
});

test('ENGINE: a request set up and then written to again comes back (newMessage), and says what it was', () => {
  const e = engine();
  e.request(); e.status('approved', 2000);
  assert.equal(e.row().status, 'approved', 're-anchor: the status did not apply');
  assert.equal(e.row().newMessage, false, 'a set-up request with no new message was flagged');
  e.chat(ASKER, 3000, 'm1');
  assert.equal(e.row().newMessage, true,
    'THE ASKER WROTE AFTER "SET UP HELP" AND THE CONSOLE DID NOT NOTICE — the sim finding');
  assert.equal(e.row().needId, 'n1', 'the need it was set up as is lost');
});

test('ENGINE: …and a team reply after that takes it off the list again', () => {
  const e = engine();
  e.request(); e.status('approved', 2000); e.chat(ASKER, 3000, 'm1');
  assert.equal(e.row().newMessage, true);
  e.chat(CHURCH, 4000, 'm2');
  assert.equal(e.row().newMessage, false, 'a steward replied and the same row stayed on the list');
  e.chat(ASKER, 5000, 'm3');
  assert.equal(e.row().newMessage, true, 'they wrote again after the reply and it did not come back');
});

test('ENGINE: a CLOSED request comes back too, and keeps the closed status', () => {
  const e = engine();
  e.request(); e.status('declined', 2000); e.chat(ASKER, 2500, 'm1');
  assert.equal(e.row().status, 'declined');
  assert.equal(e.row().newMessage, true, 'a closed request the person wrote to again did not come back');
});

test('ENGINE: re-writing the status ("seen") takes it off until they write again', () => {
  const e = engine();
  e.request(); e.status('approved', 2000); e.chat(ASKER, 3000, 'm1');
  e.status('approved', 3500);
  assert.equal(e.row().newMessage, false, 'marking it seen left it on the list');
  e.chat(ASKER, 4000, 'm2');
  assert.equal(e.row().newMessage, true);
});

test('ENGINE: only a message this console can OPEN counts, and only the ASKER’s own makes it come back', () => {
  const e = engine();
  e.request(); e.status('approved', 2000);
  e.chat(ASKER, 3000, 'm1', { openable: false });
  assert.equal(e.row().newMessage, false, 'a message the console cannot open made the request look unanswered');
  e.chat(STRANGER, 3100, 'm2');
  assert.equal(e.row().newMessage, false, 'somebody who is not the asker made the request come back');
});

test('ENGINE: the order events arrive in does not matter', () => {
  const e = engine();
  e.chat(ASKER, 3000, 'm1'); e.status('approved', 2000); e.request();
  assert.equal(e.row().newMessage, true, 'a thread message that arrived BEFORE its request was lost');
});

test('ENGINE: an ordinary OPEN request is untouched', () => {
  const e = engine();
  e.request();
  assert.equal(e.row().status, 'open');
  assert.equal(e.row().newMessage, false, 'an open request is already listed; it must not also claim to have returned');
});

// ── 3. THE CARE PAGE ─────────────────────────────────────────────────────────────────────────────────────
const REQ = (over) => ({ id: 'r1', from: ASKER, forSelf: true, type: 'meals', note: 'a lift please', status: 'open', needId: '', newMessage: false, ...over });

function carePage(initial) {
  const { React, draw } = miniReact();
  const calls = { status: [], decline: [], emit: null, unsubscribed: 0 };
  const win = {
    StewardMeals: {
      subscribeCareRequests: (cb) => { calls.emit = cb; cb(initial); return () => { calls.unsubscribed++; }; },
      setCareRequestStatus: async (...a) => { calls.status.push(a); return { id: 'e' }; },
      declineCareRequest: async (r) => { calls.decline.push(r.id); return { id: 'e' }; },
      subscribeCareChat: (id, cb) => { cb([]); return () => {}; },
      sendCareChat: async () => ({ id: 'x' }),
    },
    useStewardChurch: () => ({ npub: 'npub1church' }), useStewardMembers: () => [], useStewardConn: () => 0,
    useStewardSafeguard: () => ({ minors: [], approved: [], minorsKnown: true }),
    addEventListener() {}, removeEventListener() {},
  };
  const globals = { React, window: win, console, Icon: ({ name }) => React.createElement('i', { 'data-icon': name }) };
  const mod = loadScreen('app/stew-meals.jsx', ['StewCareRequests'], globals);
  draw(mod.StewCareRequests, {});
  const redraw = () => draw(mod.StewCareRequests, {});
  const tree = redraw();
  return { tree, redraw, calls, win };
}
const btn = (tree, re) => treeFind(tree, n => n.type === 'button' && re.test(treeTexts(n).join(' ')));
const words = (tree) => treeTexts(tree).join(' | ');

test('PAGE: a set-up request the person wrote to again is listed, with a Message button and WITHOUT "Set up help"', () => {
  const p = carePage([REQ({ status: 'approved', needId: 'n1', newMessage: true })]);
  assert.match(words(p.tree), /Wrote again — help is already set up/,
    'the returned request is not on the Care page — the steward has no door to the thread. Page: ' + words(p.tree));
  assert.equal(btn(p.tree, /Message/).length, 1, 'no Message button on the returned request');
  assert.equal(btn(p.tree, /Set up help/).length, 0, 'a request that already has its need was offered "Set up help" a second time');
  assert.equal(btn(p.tree, /Close — not needed/).length, 0, 'a returned thread offers a "close" that would tell the asker help was cancelled');
  assert.equal(btn(p.tree, /Seen — no reply needed/).length, 1, 'no way to clear it without replying');
});

test('PAGE: a CLOSED request that returns may be set up after all', () => {
  const p = carePage([REQ({ status: 'declined', newMessage: true })]);
  assert.match(words(p.tree), /Wrote again — you had closed this request/);
  assert.equal(btn(p.tree, /Set up help/).length, 1, 'a closed request that came back cannot be set up');
  assert.equal(btn(p.tree, /Message/).length, 1);
});

test('PAGE: a set-up request with NOTHING new is not listed (the page does not fill with finished work)', () => {
  const p = carePage([REQ({ status: 'approved', needId: 'n1', newMessage: false })]);
  assert.equal(btn(p.tree, /Message/).length, 0, 'finished work is listed');
  assert.doesNotMatch(words(p.tree), /Wrote again|Asked for help/);
});

test('PAGE: an OPEN request is exactly as before — Set up help, Message, Close', () => {
  const p = carePage([REQ()]);
  assert.match(words(p.tree), /Asked for help/);
  assert.equal(btn(p.tree, /Set up help/).length, 1);
  assert.equal(btn(p.tree, /Message/).length, 1);
  assert.equal(btn(p.tree, /Close — not needed/).length, 1);
});

test('PAGE: "Seen" re-writes the SAME status and need, so the row goes until they write again', async () => {
  const p = carePage([REQ({ status: 'approved', needId: 'n1', newMessage: true })]);
  btn(p.tree, /Seen — no reply needed/)[0].props.onClick();
  await flush();
  assert.deepEqual(p.calls.status, [['r1', ASKER, { status: 'approved', needId: 'n1' }]],
    'Seen did not re-write the request’s own status. Calls: ' + JSON.stringify(p.calls.status));
  assert.deepEqual(p.calls.decline, [], 'Seen CLOSED the request — the asker would be told help was cancelled');
});

test('PAGE: the conversation the steward is typing in outlives the row — replying must not close it', () => {
  const p = carePage([REQ({ status: 'approved', needId: 'n1', newMessage: true })]);
  btn(p.tree, /Message/)[0].props.onClick();
  let t = p.redraw();
  assert.match(words(t), /Care conversation/, 're-anchor: Message did not open the conversation');
  p.calls.emit([]);                       // the steward's reply lands, the row leaves the list…
  t = p.redraw();
  assert.match(words(t), /Care conversation/,
    'THE CONVERSATION VANISHED WHEN ITS ROW DID. A steward who replies to a returned thread loses the window ' +
    'mid-conversation, because the page returned nothing once the list was empty');
});

// ── 4. THE OVERVIEW BANNER ───────────────────────────────────────────────────────────────────────────────
function overview(list) {
  const src = fnBody(DASH, 'function DashOverview(', 'DashOverview');
  const tmp = join(tmpdir(), 'ovcare-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashOverview };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const stub = () => null;
  const win = new Proxy({
    innerWidth: 1400, addEventListener() {}, removeEventListener() {},
    useMealsSettings: () => ({ enabled: true }),
    useStewardJoinPolicy: () => false, useStewardConn: () => 0, useStewardIdv: () => 0, usePendingStewards: () => [],
    useStewardStats: () => ({}), Steward: { actingChurch: null },
    StewardMeals: { subscribeCareRequests: (cb) => { cb(list); return () => {}; } },
  }, { get: (t, k) => (k in t) ? t[k] : (typeof k === 'string' && k.startsWith('useSteward') ? () => [] : undefined) });
  const globals = {
    React, window: win, console, CustomEvent: class {},
    useStewNarrow: () => false, useRealMemberCount: () => 0, stewCapState: () => ({ allowed: true }),
    groupLiveSub: () => '', ago: () => '', SK_TINT: {},
  };
  const scope = new Proxy(globals, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      if (typeof k === 'string' && /^[A-Z]/.test(k)) return stub;          // components that are not under test
      throw new ReferenceError('DashOverview needs `' + String(k) + '` — add a stub'); },
  });
  const body = js.replace(/export\s*\{[^}]*\};?\s*$/m, '');
  const DashOverview = new Function('scope', `with (scope) { ${body}\n return DashOverview; }`)(scope);
  const props = { onTab: () => {}, onNewPost: () => {}, onSettings: () => {} };
  draw(DashOverview, props);
  return words(draw(DashOverview, props));
}

test('BANNER: a returned thread counts on the Overview — alone, and beside a new request', () => {
  const alone = overview([REQ({ status: 'approved', needId: 'n1', newMessage: true }), REQ({ id: 'r2', status: 'declined', newMessage: true })]);
  assert.match(alone, /2 new messages on requests you’ve already dealt with/,
    'two people wrote to requests already dealt with and the Overview says nothing. Drew: ' + alone.slice(0, 600));
  assert.doesNotMatch(alone, /asked for help/, 'the banner claims people have asked for help when only old threads have messages');
  assert.match(alone, /Open Care to read and reply/);
  const both = overview([REQ({ id: 'r1' }), REQ({ id: 'r2', status: 'approved', needId: 'n1', newMessage: true })]);
  assert.match(both, /1 person has asked for help · 1 new message on requests you’ve already dealt with/, 'both counts should show together: ' + both.slice(0, 600));
});

test('BANNER: nothing waiting means no banner; finished work does not count', () => {
  const none = overview([REQ({ status: 'approved', needId: 'n1', newMessage: false })]);
  assert.doesNotMatch(none, /asked for help|new message/, 'a finished request with nothing new raised the banner: ' + none.slice(0, 400));
  const open = overview([REQ()]);
  assert.match(open, /1 person has asked for help/, 're-anchor: an ordinary open request no longer raises the banner');
  assert.match(open, /Nobody can offer until you open it as a need/);
});
