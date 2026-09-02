// A CHILD MUST NOT BE SHOWN THE NAMES OF ADULTS-ONLY ROOMS.
// Run: node --test scripts/adults-only-rooms-stay-hidden.test.mjs
//
// AUDIT 2026-08-29 (member-app round), verified end to end before acting on it:
//   · the relay serves the group DEFINITION to a minor — its child-safe rule guards a group's MESSAGES
//     (gateway.mjs, the `g` branch of canRead) and not the kind-30078 that carries the name;
//   · so screens-chat.jsx's own `.filter(g => !iAmMinor || g.childsafe)` is the only thing hiding them;
//   · and `isMinor` has no cache, defaults to FALSE, and waits on a 1.2s timer plus a relay round-trip,
//     while the group list paints from its own cache immediately.
// A returning child therefore had every adults-only room on screen, by name, before the app knew who was
// reading. Transient on a good link; on a thin one, or offline, it lasts the whole session.
//
// The fix must NOT be "assume minor until clearanceKnown". That flag is set only by a member's own sealed
// clearance, and a church that has never used safeguarding publishes none for anybody — so it never becomes
// true there, and gating on it would hide every adults-only room from every member of that church for ever.
// A silent blank screen is worse than the disclosure. Hence the second question, tested below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
function lift(name) {
  const m = new RegExp('\\n  async function ' + name + '\\([\\s\\S]*?\\n  \\}').exec(SRC)
         || new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}').exec(SRC);
  assert.ok(m, `could not lift ${name} — re-anchor this test, do not delete it`);
  return m[0];
}
const CP = 'c'.repeat(64);
const ME = 'a'.repeat(64);
// The remembered answer belongs to a MEMBER at a CHURCH, not to a device — see the note at SG_ASSUME_KEY,
// and scripts/one-phone-two-members-safeguarding.test.mjs for why. `_sgMine` is lifted rather than stubbed,
// because the both-halves-must-match rule IS the fix; only "who is holding the phone" is injected.
const SLOT = (cp, me) => 'trinityone.sgassume.' + cp + '|' + me;

// `audience`: null = could not ask; [] = this church clears nobody; [..] = safeguarding is in use.
function engine({ sgSelf = { cp: '', me: '', isMinor: false, known: false }, audience = [], cached = null,
                  me = ME, store = {} } = {}) {
  if (cached !== null) store[SLOT(CP, me)] = cached;
  const scope = {
    _sgSelf: sgSelf,
    SG_ASSUME_KEY: 'trinityone.sgassume.',
    _mePub: () => me,
    _mayCache: () => true,
    _fetchChildCareAudience: async () => audience,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    },
  };
  const args = Object.keys(scope);
  const body = lift('_sgMine') + '\n' + lift('_assumeMinor') + '\nreturn _assumeMinor;';
  return new Function(...args, body)(...args.map(k => scope[k]));
}

test('a church that has told us outright is believed, either way', async () => {
  assert.equal(await engine({ sgSelf: { cp: CP, me: ME, isMinor: true, known: true } })(CP), true);
  assert.equal(await engine({ sgSelf: { cp: CP, me: ME, isMinor: false, known: true } })(CP), false);
});

test('a church that has never used safeguarding is NOT gated — this is the trap', async () => {
  // clearanceKnown is false here and will NEVER become true: no clearance document exists for anybody.
  // Gating on it would empty the room list for every member of this church, permanently, with no message.
  const f = engine({ sgSelf: { cp: '', isMinor: false, known: false }, audience: [] });
  assert.equal(await f(CP), false,
    'every member of a church that does not use safeguarding just lost their adults-only rooms, for ever');
});

test('a church that DOES use safeguarding gates until it has told us', async () => {
  const f = engine({ sgSelf: { cp: '', isMinor: false, known: false }, audience: ['someone-cleared'] });
  assert.equal(await f(CP), true,
    'a child is shown the names of adults-only rooms while their clearance is still in flight');
});

test('when we cannot ask at all, we assume rather than guess', async () => {
  const f = engine({ sgSelf: { cp: '', isMinor: false, known: false }, audience: null });
  assert.equal(await f(CP), true, 'an unanswerable relay was read as "not a child"');
});

test('a remembered answer is used, so a returning member is right immediately', async () => {
  // This is what actually closes the window: the disclosure needs CACHED groups to paint early, and cached
  // groups mean a previous session — which is exactly when a remembered answer exists.
  const adult = engine({ audience: ['someone-cleared'], cached: '0' });
  assert.equal(await adult(CP), false, 'a known adult is gated on every cold start for ever');
  const child = engine({ audience: [], cached: '1' });
  assert.equal(await child(CP), true, 'a known child is un-gated the moment the relay is slow');
});

test('the church’s own word outranks a stale remembered answer', async () => {
  const f = engine({ sgSelf: { cp: CP, me: ME, isMinor: true, known: true }, cached: '0' });
  assert.equal(await f(CP), true, 'a member newly marked as a child keeps the adult view');
});

test('the answer is remembered as soon as the church tells us', async () => {
  // Executed, not grepped. The first version of this asserted the write with a regex over the bundle, and a
  // sabotage that made the write unreachable (`if (false)`) left the text in place and the test green — the
  // exact "a regex matches an expression inside dead code" failure this round keeps rediscovering.
  const store = {};
  await engine({ sgSelf: { cp: CP, me: ME, isMinor: true, known: true }, audience: [], store })(CP);
  assert.equal(store[SLOT(CP, ME)], '1',
    'nothing remembers the answer, so every cold start reopens the window this fix exists to close');

  const store2 = {};
  await engine({ sgSelf: { cp: CP, me: ME, isMinor: false, known: true }, audience: [], store: store2 })(CP);
  assert.equal(store2[SLOT(CP, ME)], '0', 'an adult’s answer is not remembered');
});

test('the remembered answer names the MEMBER as well as the church', async () => {
  // The whole of scripts/one-phone-two-members-safeguarding.test.mjs rests on this key shape, so assert it
  // here too: a key that names only the church is an answer about a DEVICE, and a device is not a person.
  const store = {};
  await engine({ sgSelf: { cp: CP, me: ME, isMinor: false, known: true }, audience: [], store })(CP);
  assert.deepEqual(Object.keys(store), [SLOT(CP, ME)],
    'the remembered answer is not filed under this member, so the next account on this phone reads it');
});

test('the church-only key the shipped build wrote is dropped, not trusted', async () => {
  // It can no longer match a read — but it still names a congregation on the device, and outside a PIN lock
  // nothing else would ever remove it. Reading it instead would be the original defect.
  const store = { ['trinityone.sgassume.' + CP]: '0' };
  const f = engine({ sgSelf: { cp: CP, me: ME, isMinor: true, known: true }, audience: [], store });
  assert.equal(await f(CP), true, 'the legacy device-wide answer was believed over the church’s own word');
  assert.equal(store['trinityone.sgassume.' + CP], undefined, 'the legacy key was left on the device');
});

test('nothing is remembered while this device may not hold church data', async () => {
  // Every sibling cache writer asks _mayCache (see the note above it: a locked boot wipes the caches and
  // then they come straight back, which is theatre). This one did not.
  const store = {};
  const scope = {
    _sgSelf: { cp: CP, me: ME, isMinor: true, known: true },
    SG_ASSUME_KEY: 'trinityone.sgassume.',
    _mePub: () => ME,
    _mayCache: () => false,
    _fetchChildCareAudience: async () => [],
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; } },
  };
  const args = Object.keys(scope);
  const f = new Function(...args, lift('_sgMine') + '\n' + lift('_assumeMinor') + '\nreturn _assumeMinor;')(...args.map(k => scope[k]));
  assert.equal(await f(CP), true, 'the answer itself changed — only the WRITE is supposed to be withheld');
  assert.deepEqual(Object.keys(store), [], 'a wiped device wrote the church’s safeguarding answer back');
});

test('the group list actually consults it', () => {
  const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
  assert.match(CHAT, /const iAmMinor = !!\(ctx\.safeguard && ctx\.safeguard\.isMinor\) \|\| assumeMinor;/,
    'the room filter is back to trusting isMinor alone, which is false before the church has answered');
  assert.match(CHAT, /window\.Fellowship\.assumeMinor\(np\)/, 'nothing asks the engine');
  assert.match(CHAT, /\.catch\(\(\) => \{ if \(live\) setAssumeMinor\(true\); \}\)/,
    'a failure to ask is treated as "not a child"');
});


// ── AND NOW THE POINT OF USE ─────────────────────────────────────────────────────────────────────────────
// CLAUDE.md rule 1, written because of this exact file. Everything above tests the ENGINE that answers "is
// this reader a child?". Nothing above it required anything to ASK. An auditor deleted the single line in
// app/screens-chat.jsx that consumes the answer —
//     .filter(g => !iAmMinor || g.childsafe)
// — and all eight tests here stayed green, along with the rest of the suite. A well-tested engine nobody is
// required to consult is not a feature, and this one is the only thing in the product that keeps the NAMES
// of adults-only rooms off a young person's screen (the relay withholds their messages and serves their
// definitions, so the names are ours to hide).
//
// The test above it — "the group list actually consults it" — matches text in an app/*.jsx file, which
// rule 3 forbids for exactly this reason: those files ship unbundled, so `false && ` in front of a condition
// leaves every word of it in place. It is kept only as a re-anchoring aid; the tests below are the guard.
//
// So: RENDER THE SHIPPED ChatScreen. A miniature hook runtime runs its real effects — which is what makes
// window.Fellowship.assumeMinor actually get called — and then re-renders, so what we assert on is the room
// list a young person's phone would draw. Every stub below is scaffolding; the component's own logic, and
// the whole filter chain from realGroups to the rendered card, is untouched.
import { transformSync } from 'esbuild';
import { fnBody } from './test-slice.mjs';

const CHAT_SRC = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
const CHURCH = 'n'.repeat(64);

// The room list draws on two module-level helpers in the same file — the room-kind label and the room icon,
// which are what tell a broadcast room apart from a conversation. The proxy below refuses an unstubbed
// global by design, and hand-writing imitations of them here would be the trap where a stub supplies the
// answer: they are LIFTED out of app/screens-chat.jsx and run, not faked. Neither touches the safeguarding
// filter this file exists to guard; they only have to be the real thing.
const ROOM_HELPERS = (() => {
  const at = CHAT_SRC.indexOf('const ROOM_KIND_LABEL');
  assert.notEqual(at, -1, 'the room-list helpers moved out of app/screens-chat.jsx — re-anchor this test');
  const end = CHAT_SRC.indexOf('function ChatScreen({ ctx })', at);
  assert.ok(end > at, 'could not find ChatScreen below the helpers — re-anchor this test');
  return new Function(CHAT_SRC.slice(at, end) + '\nreturn { ROOM_KIND_LABEL, roomKindLabel, roomIcon };')();
})();

function renderChatScreen({ isMinor = false, assumeMinor = false, groups = [] } = {}) {
  const src = transformSync(fnBody(CHAT_SRC, 'function ChatScreen({ ctx })', 'ChatScreen'),
    { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
  let nodes = [];
  // a miniature hook runtime: state cells persist across passes, and effects run between them — without
  // this the group list never leaves its empty initial state and the test would assert on nothing.
  //
  // useMemo HONOURS ITS DEPENDENCY ARRAY. It used to be `(fn) => fn()`, which recomputes every pass. That
  // gives the right value every time, and that is precisely why it was useless as a guard: the room list is
  // a memo whose deps carry `iAmMinor, assumeMinor` — the two values that decide whether a young person is
  // shown adults-only rooms — and deleting both from that array left these tests green. Real React would
  // then compute the list ONCE, while the app still believed the reader was an adult, and never recompute.
  const cells = []; let ci = 0;
  const effDeps = []; let ei = 0; let queued = [];
  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const useState_ = (v) => { const i = ci++; if (!(i in cells)) cells[i] = typeof v === 'function' ? v() : v;
    return [cells[i], (nv) => { cells[i] = typeof nv === 'function' ? nv(cells[i]) : nv; }]; };
  const useRef_ = (v) => { const i = ci++; if (!(i in cells)) cells[i] = { current: v }; return cells[i]; };
  // deps-compared, as React does: an effect re-runs only when its own deps change, so re-rendering does not
  // re-subscribe the whole screen.
  const useEffect_ = (fn, deps) => { const i = ei++; if (!(i in effDeps) || !sameDeps(effDeps[i], deps)) { effDeps[i] = deps; queued.push(fn); } };
  // one slot per call site; a missing dependency now shows up as a value that never updates.
  const useMemo_ = (fn, deps) => { const i = ci++; const c = cells[i];
    if (!c || !sameDeps(c.deps, deps)) cells[i] = { deps, v: fn() };
    return cells[i].v; };
  const useCallback_ = (fn, deps) => useMemo_(() => fn, deps);
  const h = (type, props, ...kids) => {
    const node = { type: typeof type === 'function' ? (type.name || 'fn') : type, props: props || {},
      kids: kids.flat(Infinity).filter(x => x != null) };
    nodes.push(node); return node;
  };
  const stub = (name) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: name }); return f; };
  const asked = [];
  const scope = {
    ...ROOM_HELPERS,
    h, Frag: 'Frag',
    React: { useState: useState_, useEffect: useEffect_, useRef: useRef_, useMemo: useMemo_, useCallback: useCallback_, Fragment: 'Fragment' },
    useC: useState_, useCE: useEffect_, useCR: useRef_,
    location: { search: '' },
    window: {
      TrinityData: { RELAYS: [], GROUPS: [] },
      Fellowship: {
        myPubkey: 'me', relays: [],
        subscribeGroups: () => () => {},
        subscribeChurchGroups: (np, cb) => { cb(groups); return () => {}; },
        subscribeChurchCategories: () => () => {},
        assumeMinor: async (np) => { asked.push(np); return assumeMinor; },
        displayFor: () => ({ handle: 'x' }),
      },
      addEventListener: () => {}, removeEventListener: () => {},
    },
    // the list paints from its own cache before any relay answers — this is the window the fix exists to close
    lsGet: (k, d) => (k.startsWith('trinityone.groups.') ? groups : d),
    lsSet: () => {},
    useIdentity: () => ({ handle: 'me' }),
    myAvatar: () => ({}), myName: () => 'Me', hasName: () => true, myChosenName: () => 'Me',
    readChatSeen: () => ({}), writeChatSeen: () => {},
    avOf: () => ({}), relTime: () => '', searchableText: () => '',
    safeCssColor: (c) => c,
    Icon: stub('Icon'), IconBtn: stub('IconBtn'), UserAvatar: stub('UserAvatar'),
    ChurchPill: stub('ChurchPill'), NostrSheet: stub('NostrSheet'), ServingEntry: stub('ServingEntry'),
    GivingView: stub('GivingView'), ChatRoom: stub('ChatRoom'),
    SectionLabel: function SectionLabel(p, ...k) { return h('SectionLabel', p, ...k); },
    ScreenScroll: function ScreenScroll(p, ...k) { return h('ScreenScroll', p, ...k); },
    console, Promise, Set, Map, JSON, Date, Math, Array, Object, String, Number, Boolean, RegExp,
    URLSearchParams, setTimeout, clearTimeout, CustomEvent: class {},
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  const fn = new Function('scope', `with (scope) { ${src}; return ChatScreen; }`)(proxy);
  const props = { ctx: { church: { npub: CHURCH, name: 'St Mary' }, safeguard: { isMinor },
    joinState: { loaded: true }, churchNetworks: [], dmThreads: [] } };
  const pass = () => { ci = 0; ei = 0; nodes = []; fn(props); };
  const flush = () => { const q = queued; queued = []; q.forEach(e => { try { e(); } catch (x) {} }); };
  pass();
  return {
    asked,
    // THREE PASSES, BECAUSE THE TWO THINGS ARRIVE AT DIFFERENT TIMES — and a stale memo is invisible unless
    // a draw happens with only the missed dependency changed. On the phone the cached group list lands
    // synchronously inside the effect, so React re-renders with the rooms while `assumeMinor` is still
    // false; the engine's answer arrives a promise later and re-renders again. Collapsing those into one
    // pass hid the bug this file exists to catch: `realGroups` changed in the same pass, so the room-list
    // memo recomputed for that reason alone and picked up `assumeMinor` even when it was not in its deps.
    async draw() {
      flush();                                     // mount effects: cached rooms land, the engine is asked
      pass();                                      // pass 2 — rooms on screen, answer still in flight
      await new Promise(r => setTimeout(r, 0));    // the engine answers
      flush();                                     // effects whose deps changed on pass 2
      pass();                                      // pass 3 — ONLY assumeMinor changed since pass 2
      return nodes.flatMap(n => n.kids.filter(k => typeof k === 'string')).join(' | ');
    },
  };
}

const ROOMS = [
  { id: 'g1', name: 'Sunday Club', childsafe: true, visibility: 'open' },
  { id: 'g2', name: 'Addiction Recovery', childsafe: false, visibility: 'open' },
];

test('POINT OF USE: a young person is not shown the NAME of an adults-only room', async () => {
  const r = renderChatScreen({ isMinor: true, groups: ROOMS });
  const shown = await r.draw();
  assert.ok(!/Addiction Recovery/.test(shown),
    'the chat list drew the name of a room the church marked adults-only to a member marked as a child. ' +
    'Rendered: ' + shown);
  assert.match(shown, /Sunday Club/,
    'the child-safe room vanished too — the filter is now hiding everything, which is a blank screen, ' +
    'the worse failure');
});

test('POINT OF USE: …and the engine’s answer alone is enough to hide it', async () => {
  // isMinor is FALSE here. This is the real-world case the whole fix is about: a returning child whose
  // clearance has not arrived yet, painting from cache. If nothing consumes assumeMinor, this passes only
  // because of luck, so assert the engine was actually consulted as well.
  const r = renderChatScreen({ isMinor: false, assumeMinor: true, groups: ROOMS });
  const shown = await r.draw();
  assert.deepEqual(r.asked, [CHURCH], 'nothing asked the engine who is reading');
  assert.ok(!/Addiction Recovery/.test(shown),
    'a child whose clearance is still in flight was shown every adults-only room, by name. Rendered: ' + shown);
  assert.match(shown, /Sunday Club/);
});

test('POINT OF USE: an adult still sees every room, so this is not a blank screen for everyone', async () => {
  const r = renderChatScreen({ isMinor: false, assumeMinor: false, groups: ROOMS });
  const shown = await r.draw();
  assert.match(shown, /Sunday Club/);
  assert.match(shown, /Addiction Recovery/,
    'the ordinary member lost their rooms — gating everybody is not a fix, it is a silent blank screen');
});
