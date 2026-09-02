// ONE PHONE, TWO PEOPLE: THE CHILD MUST NOT INHERIT THE PARENT'S ANSWER.
// Run: node --test scripts/one-phone-two-members-safeguarding.test.mjs
//
// `_assumeMinor(cp)` answers "must this app treat me as possibly a child?" and remembers the answer in
// localStorage. The key used to name the CHURCH and nothing else:
//
//     trinityone.sgassume.<churchPub>          ->  '1' | '0'
//
// so the answer belonged to a device rather than to a person, and two accounts used on one phone shared it:
//
//     a child on a clean phone                          -> true   (gated, correct)
//     a child on a phone where the PARENT had signed in -> false   (NOT gated)
//
// That was filed as exotic when the cache went in. It is routine, and it is NOT a family-flow bug: a phone
// carries a second account after a 12-word restore or reseat, after an adopted steward seed, and after being
// passed on or sold. The family flow is only the loudest route — `createChildAccount` mints and REVEALS a
// child's twelve words on the parent's phone and ends by handing that phone to the child, so the child's
// first Community tab paints the parent's cached room list, by name, including rooms the church marked
// adults-only, and asks an engine that answers with the parent's remembered "not a child". It self-corrects
// when the child's own sealed clearance arrives from the relay; on the thin connections this product is
// built for, that can be the whole session.
//
// So the fix keys off the SIGNING KEY and nothing else. A young person joining on their own device from an
// invite link never touched the family flow and was always right; a member reseated onto this phone gets a
// clean answer for the same reason the child does.
//
// The in-memory half is the same defect: `_sgSelf` is one module variable, it was compared against the church
// alone, and nothing reset it when the identity changed. So both halves now carry the member:
//
//     trinityone.sgassume.<churchPub>|<memberPub>       — the same `cp|pub` shape as ADMITTED_OK_LS
//     _sgSelf = { cp, me, isMinor, known }              — read only through _sgMine(cp)
//
// WHAT THIS FILE DOES NOT TEST. The three-answer logic (null = could not ask -> assume; [] = this church
// clears nobody -> do not gate; non-empty = assume until told) is deliberate and is covered by
// scripts/adults-only-rooms-stay-hidden.test.mjs. Only the IDENTITY of the remembered answer is under test
// here — and it is tested where it lands: on the rendered chat screen, per CLAUDE.md rule 1. No assertion
// below matches text in app/*.jsx (rule 3); the room names are read out of the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';
import { liftSgMine } from './test-slice.mjs';

const SRC = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const ASSUME = (() => {
  const m = /\n  async function _assumeMinor\(cp\) \{[\s\S]*?\n  \}/.exec(SRC);
  assert.ok(m, 'could not lift _assumeMinor from the bundle — re-anchor this test, do not delete it');
  return m[0];
})();
const SGMINE = liftSgMine(SRC);

const CHURCH_HEX = 'c'.repeat(64);
const CHURCH_NPUB = 'npub1stmarys';           // what the screen is handed; toPub is stubbed to CHURCH_HEX
const PARENT = 'a'.repeat(64);
const CHILD = 'b'.repeat(64);

const KIDS_ROOM = { id: 'g1', name: 'Sunday Club', kind: 'group', visibility: 'open', childsafe: true };
const ADULT_ROOM = { id: 'g2', name: 'Addiction Recovery', kind: 'group', visibility: 'open', childsafe: false };
const ROOMS = [KIDS_ROOM, ADULT_ROOM];

// ── ONE DEVICE ────────────────────────────────────────────────────────────────────────────────────────────
// A single localStorage, shared by every session below, because that is the whole point: this is one phone.
function device() {
  const store = {};
  return {
    store,
    keys: () => Object.keys(store),
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  };
}

// ── ONE SESSION ON IT ─────────────────────────────────────────────────────────────────────────────────────
// The SHIPPED engine, given this session's signing key and whatever `_sgSelf` is left in memory. `audience`
// is what the relay would answer: null = could not ask (a thin link — the case this fix is about), [] = this
// church clears nobody, [..] = safeguarding is in use here.
function session(dev, { me, sgSelf = { cp: '', me: '', isMinor: false, known: false }, audience = null } = {}) {
  const scope = {
    _sgSelf: sgSelf,
    SG_ASSUME_KEY: 'trinityone.sgassume.',
    _mePub: () => me,
    _mayCache: () => true,
    _fetchChildCareAudience: async () => audience,
    localStorage: dev.localStorage,
    window: {},
    pub: me,
  };
  const args = Object.keys(scope);
  const engine = new Function(...args, SGMINE + '\n' + ASSUME + '\nreturn _assumeMinor;')(...args.map(k => scope[k]));
  return (cp) => engine(cp || CHURCH_HEX);
}

// ── AND WHAT THAT SESSION'S CHAT SCREEN DRAWS ─────────────────────────────────────────────────────────────
// The real ChatScreen, compiled the way sync-web.sh compiles it, wired to the real engine above. `isMinor`
// is FALSE throughout: this is a returning member whose own sealed clearance has not arrived yet, which is
// exactly the window the remembered answer exists to cover and exactly when getting it wrong is invisible.
async function mountChat(assumeMinor, { rooms = ROOMS } = {}) {
  const { React, draw } = miniReact();
  const win = {
    Fellowship: {
      myPubkey: 'mehex',
      relays: ['wss://relay.example'],
      // the relay serves the group DEFINITION to everyone, child or not — its child-safe rule guards a
      // group's MESSAGES. The names are the client's to hide, which is why this screen is the point of use.
      subscribeChurchGroups: (_np, cb) => { cb(rooms); return () => {}; },
      subscribeChurchCategories: (_np, cb) => { cb([]); return () => {}; },
      subscribeGroups: () => () => {},
      displayFor: () => ({ handle: 'sam', color: '#888' }),
      assumeMinor,
    },
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
    TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
    addEventListener: () => {}, removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatScreen'], {
    React,
    window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {},
    todayISO: () => '2026-08-30',
    Icon: () => null,
    IconBtn: ({ name }) => React.createElement('button', { title: name }),
    Overlay: ({ open, children }) => (open ? children : null),
    BottomSheet: ({ open, children }) => (open ? children : null),
    ScreenScroll: ({ children }) => children,
    ChurchPill: () => null,
    UserAvatar: () => null,
    SectionLabel: ({ children }) => children,
    safeCssColor: (c) => c,
    relTime: () => 'now',
    D: { GROUPS: [], RELAYS: [] },
  });
  const ctxFor = (safeguard) => ({
    toast: () => {},
    church: { npub: CHURCH_NPUB, name: 'St Mary’s', id: 'c1' },
    joinState: { loaded: true, isPending: false, removed: false, offline: false, unknown: false },
    myLeaderGroups: [], churchEvents: [], myPubkey: 'mehex',
    safeguard,
    openPeople: () => {}, openDM: () => {}, openDMInbox: () => {}, openGroup: () => {},
  });
  // Redraw with whatever the church has said about this member SO FAR, and read the room names back. The
  // screen re-asks the engine when that changes — its effect lists clearanceKnown and isMinor among its
  // dependencies — which is what lets the second half of this file test a steward changing their mind.
  return async function show(safeguard = { isMinor: false, clearanceKnown: false }) {
    const ctx = ctxFor(safeguard);
    draw(mod.ChatScreen, { ctx });                    // rooms land from cache, the engine is asked
    await new Promise(r => setTimeout(r, 0));         // the engine answers
    draw(mod.ChatScreen, { ctx });                    // …and only that answer has changed since the last draw
    return texts(draw(mod.ChatScreen, { ctx })).join(' | ');
  };
}

// The common case: one state, one reading. `isMinor` is FALSE — a returning member whose own sealed
// clearance has not arrived, which is the window the remembered answer exists to cover.
async function roomsOnScreen(assumeMinor, opts) {
  return (await mountChat(assumeMinor, opts))();
}

// ══ THE DEFECT ════════════════════════════════════════════════════════════════════════════════════════════

test('POINT OF USE: the child handed the parent’s phone is not shown the adults-only room', async () => {
  const dev = device();

  // 1. The parent uses the phone. Their church has told it outright that they are not a child, so the answer
  //    is remembered — which is correct, and is what makes the parent's own next cold start instant.
  const parent = session(dev, { me: PARENT, sgSelf: { cp: CHURCH_HEX, me: PARENT, isMinor: false, known: true } });
  assert.equal(await parent(), false, 'the parent was gated — re-anchor, the rest of this test proves nothing');
  assert.equal(dev.keys().length, 1, 'expected exactly one remembered answer: ' + JSON.stringify(dev.store));

  // 2. createChildAccount mints the child's words on this same phone and it is handed over. The relay cannot
  //    be reached (a thin link, or simply the first seconds of the session), so the child's own sealed
  //    clearance has not arrived and nothing can be asked. `_sgSelf` still holds the PARENT's answer, because
  //    it is one module variable and this is one page load.
  const child = session(dev, {
    me: CHILD,
    sgSelf: { cp: CHURCH_HEX, me: PARENT, isMinor: false, known: true },
    audience: null,
  });
  assert.equal(await child(), true,
    'the child inherited the parent’s answer — from the shared key, from the in-memory copy, or from both');

  // 3. And that is only a fix if it reaches the screen.
  const shown = await roomsOnScreen(async () => child());
  assert.doesNotMatch(shown, /Addiction Recovery/,
    'a young person was shown the NAME of a room their church marked adults-only, because a parent had ' +
    'signed in on this phone first. Rendered: ' + shown);
  assert.match(shown, /Sunday Club/,
    'the child-safe room went too — that is a blank screen, which is the worse failure');
});

test('the parent is not gated on their own phone afterwards — this is not a fix by gating everybody', async () => {
  const dev = device();
  const first = session(dev, { me: PARENT, sgSelf: { cp: CHURCH_HEX, me: PARENT, isMinor: false, known: true } });
  await first();
  // A later session: the church has said nothing yet and the relay is unreachable, so the ONLY thing that can
  // answer is the remembered one. It must still be theirs.
  const again = session(dev, { me: PARENT, audience: null });
  assert.equal(await again(), false, 'the member’s own remembered answer stopped being found');
  const shown = await roomsOnScreen(async () => again());
  assert.match(shown, /Addiction Recovery/,
    'the ordinary member lost their rooms. Gating everyone is not a fix, it is a silent blank screen');
  assert.match(shown, /Sunday Club/);
});

test('the child’s own answer, once it arrives, is remembered separately and does not overwrite the parent’s', async () => {
  const dev = device();
  await session(dev, { me: PARENT, sgSelf: { cp: CHURCH_HEX, me: PARENT, isMinor: false, known: true } })();
  await session(dev, { me: CHILD, sgSelf: { cp: CHURCH_HEX, me: CHILD, isMinor: true, known: true } })();

  assert.deepEqual(dev.keys().sort(), [
    'trinityone.sgassume.' + CHURCH_HEX + '|' + CHILD,
    'trinityone.sgassume.' + CHURCH_HEX + '|' + PARENT,
  ].sort(), 'the two members are not filed separately: ' + JSON.stringify(dev.store));

  // Offline, from cache alone, each gets their own answer back.
  assert.equal(await session(dev, { me: PARENT, audience: null })(), false);
  assert.equal(await session(dev, { me: CHILD, audience: null })(), true);
});

test('a second church on the same phone still gets its own answer', async () => {
  // The church half of the key has to survive the member half being added: a member of two congregations is
  // a child in neither, one, or both, and one church's word is not evidence about the other.
  const dev = device();
  const OTHER = 'd'.repeat(64);
  await session(dev, { me: CHILD, sgSelf: { cp: CHURCH_HEX, me: CHILD, isMinor: true, known: true } })(CHURCH_HEX);
  await session(dev, { me: CHILD, sgSelf: { cp: OTHER, me: CHILD, isMinor: false, known: true } })(OTHER);
  assert.equal(await session(dev, { me: CHILD, audience: null })(CHURCH_HEX), true);
  assert.equal(await session(dev, { me: CHILD, audience: null })(OTHER), false);
});

test('a session with no signing key yet neither reads nor writes an answer', async () => {
  // A keyless or PIN-locked boot cannot say WHOSE a stored answer is. Writing one under an empty member half
  // would recreate the shared answer this change removes, and reading one would spend somebody else's.
  const dev = device();
  await session(dev, { me: PARENT, sgSelf: { cp: CHURCH_HEX, me: PARENT, isMinor: false, known: true } })();
  const keyless = session(dev, { me: '', sgSelf: { cp: CHURCH_HEX, me: PARENT, isMinor: false, known: true }, audience: null });
  assert.equal(await keyless(), true, 'a keyless session read an answer it cannot attribute to anyone');
  assert.deepEqual(dev.keys(), ['trinityone.sgassume.' + CHURCH_HEX + '|' + PARENT],
    'a keyless session wrote an answer with no member in the key: ' + JSON.stringify(dev.store));
});

// ══ THE OTHER WAY A REMEMBERED ANSWER GOES WRONG ══════════════════════════════════════════════════════════
// The member has not changed — the CHURCH's view of them has. A steward marks an existing member as a minor
// (or clears one), which is a route into a child account that has nothing to do with the family flow. A
// member-scoped key does not help here on its own: it is the same member on the same phone, and the stored
// answer still says "adult". What invalidates it is that member's own sealed clearance arriving, which sets
// `known` and makes the engine rewrite the stored value from the church's word.

const MEMBER = 'e'.repeat(64);

test('POINT OF USE: a member marked as a child mid-session stops being shown the adults-only room', async () => {
  const dev = device();
  // A live subscription's view of me, which is what subscribeChurchSafeguard keeps in `_sgSelf`. Mutated
  // rather than replaced, because on the phone it is one module variable being written in place.
  const sg = { cp: CHURCH_HEX, me: MEMBER, isMinor: false, known: true };
  const engine = session(dev, { me: MEMBER, sgSelf: sg, audience: ['someone-cleared'] });

  const show = await mountChat(async () => engine());
  const before = await show({ isMinor: false, clearanceKnown: true });
  assert.match(before, /Addiction Recovery/, 'the adult could not see their own rooms — re-anchor this test');
  assert.equal(dev.store['trinityone.sgassume.' + CHURCH_HEX + '|' + MEMBER], '0');

  // The steward marks them. The church seals them a new clearance; the subscription updates `_sgSelf` and
  // hands the screen the same news, and the screen re-asks.
  Object.assign(sg, { isMinor: true, known: true });
  const after = await show({ isMinor: true, clearanceKnown: true });
  assert.doesNotMatch(after, /Addiction Recovery/,
    'a member the church had just marked as a child was still shown the adults-only room. Rendered: ' + after);
  assert.match(after, /Sunday Club/);

  assert.equal(dev.store['trinityone.sgassume.' + CHURCH_HEX + '|' + MEMBER], '1',
    'the church’s word did not overwrite the remembered "adult" — so the NEXT launch, before the clearance ' +
    'has arrived again, would paint the adults-only rooms for them all over again');
});

test('…and the next cold start gates them from the remembered answer alone', async () => {
  // The real proof that the rewrite matters: a new session, nothing in memory, and a relay that cannot be
  // reached. The only thing that can answer is what the last session remembered.
  const dev = device();
  const sg = { cp: CHURCH_HEX, me: MEMBER, isMinor: false, known: true };
  await session(dev, { me: MEMBER, sgSelf: sg, audience: ['someone-cleared'] })();
  Object.assign(sg, { isMinor: true, known: true });
  await session(dev, { me: MEMBER, sgSelf: sg, audience: ['someone-cleared'] })();

  const cold = session(dev, { me: MEMBER, audience: null });          // no memory, no relay
  assert.equal(await cold(), true, 'the stale "adult" answer outlived the church marking them as a child');
  const shown = await roomsOnScreen(async () => cold());
  assert.doesNotMatch(shown, /Addiction Recovery/, 'Rendered: ' + shown);
});

test('the same holds in reverse: a child the church later clears is not gated for ever', async () => {
  // Gating is not free either. A young person who turns eighteen, or a member marked in error, must get
  // their rooms back on the church's word — the remembered answer must not be a one-way door.
  const dev = device();
  const sg = { cp: CHURCH_HEX, me: MEMBER, isMinor: true, known: true };
  await session(dev, { me: MEMBER, sgSelf: sg, audience: ['someone-cleared'] })();
  assert.equal(dev.store['trinityone.sgassume.' + CHURCH_HEX + '|' + MEMBER], '1');

  Object.assign(sg, { isMinor: false, known: true });
  assert.equal(await session(dev, { me: MEMBER, sgSelf: sg, audience: ['someone-cleared'] })(), false);
  assert.equal(dev.store['trinityone.sgassume.' + CHURCH_HEX + '|' + MEMBER], '0');

  const cold = session(dev, { me: MEMBER, audience: null });
  assert.equal(await cold(), false, 'a cleared member is still gated from a remembered answer nothing updates');
  assert.match(await roomsOnScreen(async () => cold()), /Addiction Recovery/);
});

// ══ AND THE HANDOVER ITSELF ═══════════════════════════════════════════════════════════════════════════════
// Owner, 2026-08-30: a shared device that an adult stays in control of is NOT a threat model this product
// defends against, and it is not what this file is hardening. The case that matters is a device that STOPS
// being one person's and BECOMES another's — the family flow ends by handing the phone over, and a 12-word
// reseat or restore does exactly the same. There the previous member's remembered answer must not survive.
//
// `_sgMine` above already refuses to hand it over, and that is the structural guard. This is the belt to that
// braces, and it is asserted by RUNNING the shipped function rather than reading it: `deriveFromIdentity` is
// the one choke point every identity change passes through — regenerate, importMnemonic (so also
// unlockWithMnemonic and confirmTransfer), unlock, removePin, and init — because they all end in
// identity.src.js's apply(), which fires 'trinity-identity', and this is that listener.
const DERIVE = (() => {
  const m = /\n  async function deriveFromIdentity\(\) \{[\s\S]*?\n  \}/.exec(SRC);
  assert.ok(m, 'could not lift deriveFromIdentity — re-anchor this test, do not delete it');
  return m[0];
})();

function identity(startingFrom) {
  // Assignments inside the lifted function land on this object, which is what makes "what is `_sgSelf` after
  // the phone changed hands?" an executable question rather than a read of the source.
  const state = {
    sk: startingFrom.sk, pub: startingFrom.pub, _sgSelf: startingFrom.sgSelf,
    _needAuth: false, _reconnectGuard: false, _docsHubs: new Map(),
    window: {
      TrinityIdentity: { exportMnemonic: async () => startingFrom.nextMnemonic },
      Fellowship: { myPubkey: startingFrom.pub, myProfile: { av: 1 }, requestProfiles: () => {} },
      dispatchEvent: () => {},
    },
    privateKeyFromSeedWords: (m) => 'sk:' + m,
    getPublicKey: (s) => 'pub-of-' + String(s).slice(3),
    _loadChildren: () => [],
    CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
    setTimeout: () => 0,
    reconnectAll: () => {},
    console,
  };
  const scope = new Proxy(state, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('deriveFromIdentity needs `' + String(k) + '` — add a stub for it');
    },
  });
  const run = new Function('scope', `with (scope) { ${DERIVE} return deriveFromIdentity; }`)(scope);
  return { run, state };
}

test('the phone changing hands drops the previous member’s answer from memory as well', async () => {
  const held = { cp: CHURCH_HEX, me: 'pub-of-parent-words', isMinor: false, known: true };
  const { run, state } = identity({
    sk: 'sk:parent-words', pub: 'pub-of-parent-words', sgSelf: held, nextMnemonic: 'child-words',
  });
  await run();
  assert.equal(state.pub, 'pub-of-child-words', 're-anchor: the identity did not actually change');
  assert.equal(state._sgSelf.known, false,
    'the previous member’s safeguarding answer was still in memory after the phone changed hands');
  assert.equal(state._sgSelf.me, '');
  assert.equal(state._sgSelf.cp, '');
});

test('…and a plain re-derive of the SAME member keeps it, so an unlock does not throw the answer away', async () => {
  // A PIN unlock and a boot both run this. Clearing unconditionally would drop a known-good answer on every
  // unlock and reopen the very window the remembered answer exists to close.
  const held = { cp: CHURCH_HEX, me: 'pub-of-my-words', isMinor: true, known: true };
  const { run, state } = identity({
    sk: 'sk:my-words', pub: 'pub-of-my-words', sgSelf: held, nextMnemonic: 'my-words',
  });
  await run();
  assert.equal(state._sgSelf, held, 'the member’s own answer was discarded by an ordinary re-derive');
  assert.equal(state._sgSelf.known, true);
});
