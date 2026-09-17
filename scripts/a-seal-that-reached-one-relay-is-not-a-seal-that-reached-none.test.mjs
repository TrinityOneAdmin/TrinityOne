// A PARTIAL WRITE IS STILL A FAILURE — AND IT IS NOT THE SAME FAILURE AS "NOTHING SAVED ANYWHERE".
//   Run: node --test scripts/a-seal-that-reached-one-relay-is-not-a-seal-that-reached-none.test.mjs
//
// Measured on the owner's DELEGATED console (the Oppo, signing with its own key fc3c0f80…, acting for church
// 3eb1f889…), 2026-09-17. The steward sealed a chat room. Read back off the live relay's own store:
//
//   trinityone/group:musicians   authored by the steward at 13:01:53   encrypted: true
//   rejected.log                 no entry for that document at all
//
// The seal WORKED. What the console showed was a failure dialog reading:
//
//   "The group's key was saved but the group could not be marked encrypted. Try again — until it succeeds,
//    messages are still readable by the relay."
//
// Both halves untrue. That console had four relays connected and exactly ONE of them carries this church, so
// `_publishToRelays` — which answers the event only when EVERY targeted relay accepted — returned false, and
// `publishGroup` mapped that to null. The room was sealed on the only relay it lives on, the sentence said it
// was readable, and "try again" can never succeed while a connected relay does not carry the church.
//
// ⚠ WHAT THIS TEST MUST NOT BE READ AS. The all-must-accept rule is NOT relaxed and must never be: a group
// rule that reached one relay of three is enforced on one of three while every member's app fans its messages
// to all of them (see the note above _publishToRelays, and scripts/safeguarding-replicates.test.mjs, which
// pins the return line character for character). A partial write is reported as NOT DONE here too. The only
// thing that changed is that the console can now tell the steward WHICH failure it was.
//
// THREE INSTRUMENTS, because the claim spans three pieces of code:
//   A. the ENGINE, lifted out of the shipped bundle and run against a pool where 1 of 3 relays accepts —
//      proves the spread is recorded and the return value is still false;
//   B. the SEAL HELPER, lifted out of the same bundle — proves it reads the spread and classifies;
//   C. the SCREEN. CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so `false && ` in front of the new branch
//      would leave every word of it in place and a text match would still pass. DashGroups is COMPILED with
//      the real esbuild and RENDERED, the lock control is pressed, the confirm is pressed, and the assertions
//      read the sentence the dialog actually put on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const ONE = 'wss://ours.example/relay', TWO = 'wss://other-a.example/relay', THREE = 'wss://other-b.example/relay';
const REFUSAL = 'blocked: not a member or not permitted for this group';

// ── A. the engine ─────────────────────────────────────────────────────────────────────────────────────────
function engine(accepting) {
  const raised = [];
  const body = [
    stmt(BUNDLE, 'var _lastSpread = ', '_lastSpread'),
    fnBody(BUNDLE, 'function _noteSpread', '_noteSpread'),
    fnBody(BUNDLE, 'function _spreadOf', '_spreadOf'),
    fnBody(BUNDLE, 'async function _publishToRelays', '_publishToRelays'),
  ].join('\n');
  // GUARDS ON THE LIFT. A slice that stopped containing the load-bearing lines would leave every assertion
  // below passing over nothing at all.
  assert.match(body, /Promise\.allSettled\(pool\.publish\(targets, evt\)/,
    'vendor/steward.js: _publishToRelays is no longer the writer — re-anchor rather than widening');
  assert.match(body, /return accepted === targets\.length \? evt : false;/,
    'vendor/steward.js: ALL-MUST-ACCEPT IS GONE. That is the rule this whole file exists beside, not a detail.');

  const targets = [ONE, TWO, THREE];
  const scope = {
    console,
    window: { dispatchEvent: (e) => { raised.push(e.type); } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = (o || {}).detail; } },
    pool: {
      relays: new Map(),
      publish: (urls) => urls.map(u => (accepting.includes(u)
        ? Promise.resolve('ok') : Promise.reject(new Error(REFUSAL)))),
    },
    _waitForRegistration: async () => {},
    _connectedRelays: () => targets.slice(),
    relays: () => targets.slice(),
    relaysRaw: () => targets.slice(),
    NO_NETWORK_RELAY: 'no relay',
  };
  const api = new Function('scope', `with (scope) { ${body}
    return { _publishToRelays, _spreadOf }; }`)(new Proxy(scope, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (k in t) return t[k];
        throw new ReferenceError('the lifted _publishToRelays needs `' + String(k) + '` — add a stub');
      },
    }));
  return { ...api, raised };
}
const EVT = { kind: 30078, tags: [['d', 'trinityone/group:musicians'], ['t', 'trinityone']], content: '{}' };

test('CONTROL: every relay accepting still returns the event, and records a clean spread', async () => {
  // Without this row a broken lift would make every assertion below vacuous.
  const e = engine([ONE, TWO, THREE]);
  const r = await e._publishToRelays(EVT);
  assert.equal(r, EVT, 'the happy path stopped returning the event — the lift is broken, not the code');
  assert.deepEqual(e._spreadOf('trinityone/group:musicians').missed, []);
});

test('ONE relay of three accepting is STILL a failure — the rule is untouched', async () => {
  const e = engine([ONE]);
  const r = await e._publishToRelays(EVT);
  assert.equal(r, false,
    'A PARTIAL WRITE WAS REPORTED AS SUCCESS. A group rule that reached one relay of three is enforced on ' +
    'one of three, and every member’s app fans its messages to all of them. This is the rule the whole ' +
    'all-must-accept path exists for, and nothing about telling the steward a better sentence may relax it.');
});

test('…and the console can now tell WHICH relays took it', async () => {
  const e = engine([ONE]);
  await e._publishToRelays(EVT);
  const s = e._spreadOf('trinityone/group:musicians');
  assert.ok(s, 'nothing recorded which relays accepted, so the console can only guess between two failures');
  assert.deepEqual(s.landed, [ONE], 'the relay that DID store the document is not named');
  assert.deepEqual(s.missed, [TWO, THREE], 'the relays that refused are not named');
});

test('a write no relay accepted records an empty landed list — the two failures are distinguishable', async () => {
  const e = engine([]);
  const r = await e._publishToRelays(EVT);
  assert.equal(r, false);
  const s = e._spreadOf('trinityone/group:musicians');
  assert.deepEqual(s.landed, [],
    'a total refusal is indistinguishable from a partial one, so the console is back to guessing');
  assert.deepEqual(s.missed, [ONE, TWO, THREE]);
});

test('the spread is kept PER DOCUMENT, so two writes in flight cannot swap answers', async () => {
  const e = engine([ONE]);
  await e._publishToRelays(EVT);
  await e._publishToRelays({ ...EVT, tags: [['d', 'trinityone/minors:abc']] });
  assert.deepEqual(e._spreadOf('trinityone/group:musicians').landed, [ONE],
    'one document’s result overwrote another’s — a single "last result" is exactly the bug _lastOk ' +
    'already had to avoid');
});

// ── B. the seal helper ────────────────────────────────────────────────────────────────────────────────────
// sealGroup lifted from the same bundle, with publishGroup stubbed to record a spread the way
// _publishToRelays would and then answer the way publishGroup does over a failed write (`ts: false`).
function sealRig(landed, missed, opts) {
  const body = [
    stmt(BUNDLE, 'var _lastSpread = ', '_lastSpread'),
    fnBody(BUNDLE, 'function _noteSpread', '_noteSpread'),
    fnBody(BUNDLE, 'function _spreadOf', '_spreadOf'),
    stmt(BUNDLE, 'var GROUP_D = ', 'GROUP_D'),
    'const _seal = { ' + fnBody(BUNDLE, 'async sealGroup(', 'sealGroup in the shipped bundle') + ' };',
  ].join('\n');
  assert.match(body, /_spreadOf\(GROUP_D \+ group\.id\)/,
    'vendor/steward.js: sealGroup no longer asks which relays took the flag write — rebuild the bundle');
  const make = new Function('window', 'churchSk', '_isRelayAuthed', 'LANDED', 'MISSED', 'STALE', body + `
    // STALE: record the spread BEFORE the seal is ever called, and have publishGroup answer null the way it
    // does on its own first line when there is no signing key — so nothing fresh is recorded by this write.
    if (STALE) _noteSpread({ tags: [['d', GROUP_D + 'musicians']] }, LANDED, MISSED);
    window.Steward.publishGroup = async (g) => {
      if (STALE) return null;
      // exactly what _publishToRelays does on the way past, then what publishGroup resolves over a write
      // that did not fully land: an object whose \`ts\` is false.
      _noteSpread({ tags: [['d', GROUP_D + g.id]] }, LANDED, MISSED);
      return { id: g.id, ts: false };
    };
    return _seal.sealGroup;`);
  return make({ Steward: { publishGroupKey: async () => true } }, new Uint8Array(32).fill(7), () => true,
              landed, missed, !!(opts && opts.stale));
}

test('a flag write that reached SOME relays is reported as partial, and names them', async () => {
  const sealGroup = sealRig([ONE], [TWO, THREE]);
  const r = await sealGroup({ id: 'musicians', name: 'Musicians' }, ['a'.repeat(64)]);
  assert.equal(r.sealed, false, 'a partial write must never report the room as sealed');
  assert.equal(r.reason, 'flag-partial',
    'the seal helper still collapses "landed on one relay" into "landed nowhere", so the dialog cannot tell ' +
    'the steward anything true about which relays hold the lock');
  assert.deepEqual(r.landed, [ONE]);
  assert.deepEqual(r.missed, [TWO, THREE]);
});

test('a flag write that reached NO relay keeps the old, honest flag-failed answer', async () => {
  const sealGroup = sealRig([], [ONE, TWO, THREE]);
  const r = await sealGroup({ id: 'musicians', name: 'Musicians' }, ['a'.repeat(64)]);
  assert.equal(r.sealed, false);
  assert.equal(r.reason, 'flag-failed',
    'a write that landed nowhere was reported as a partial one, which would tell the steward the room is ' +
    'sealed somewhere when it is sealed nowhere — the same lie pointing the other way');
});

test('a spread left over from an EARLIER write is never read as this one’s', async () => {
  // Found reading the fix's own diff back, before it shipped. publishGroup returns null on its FIRST line
  // when there is no signing key, without ever reaching _publishToRelays — so the map still holds whatever
  // the last write of this document did, possibly an hour ago. Reporting that as "sealed on 1 of 3 relays,
  // other-a.example would not take it" is a worse lie than the one this whole file removes, because it
  // names relays.
  const sealGroup = sealRig([ONE], [TWO, THREE], { stale: true });
  await new Promise(r => setTimeout(r, 2));   // make sure the stale record is strictly older than the call
  const r = await sealGroup({ id: 'musicians', name: 'Musicians' }, ['a'.repeat(64)]);
  assert.equal(r.sealed, false);
  assert.equal(r.reason, 'flag-failed',
    'A STALE SPREAD WAS REPORTED AS THIS WRITE’S. Nothing was published at all this time.');
  assert.deepEqual(r.landed, [], 'relays were named over a write that never reached a relay');
});

// ── C. the screen ─────────────────────────────────────────────────────────────────────────────────────────
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const GROUP = { id: 'musicians', name: 'Musicians', kind: 'group', encrypted: false };

// Render the real DashGroups, press the room's lock control, press the confirm, and read the dialog.
async function screen(sealResult) {
  const { React, draw } = miniReact();
  const win = {
    useStewardGroups: () => [GROUP],
    useStewardMembers: () => [{ pubkey: 'a'.repeat(64), name: 'Ann' }],
    useStewardRosters: () => ({}),
    useStewardCategories: () => [],
    useStewardAdmitted: () => [],
    useStewardBlocked: () => [],
    useStewardJoinPolicy: () => false,
    useStewardIdv: () => 0,
    stewardStreamLoaded: () => true,
    Steward: { sealGroup: async () => sealResult, publishGroup: async () => null },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    localStorage: { getItem: () => null, setItem() {} },
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashGroups'], {
    React, window: win,
    Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), SkPill: Stub('SkPill'), SkToggle: Stub('SkToggle'),
    Panel: ({ children }) => children, DismissibleNote: ({ children }) => children,
    useStewDialog: () => ({ current: null }),
    location: { search: '' },
    setTimeout, clearTimeout, URL, URLSearchParams,
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise,
  });
  const render = () => draw(mod.DashGroups, {});
  let tree = render();
  const press = (match, what) => {
    const hits = find(tree, n => n.type === 'button' && match(texts(n).join(' ')));
    assert.equal(hits.length, 1, `re-anchor this test: expected exactly one ${what}, found ${hits.length}`);
    const r = hits[0].props.onClick();
    tree = render();
    return r;
  };
  press(t => /encryption is off/.test(t), 'lock control on the Musicians row');
  await press(t => /Seal it/.test(t), '“Seal it” button in the confirm dialog');
  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
  tree = render();
  return find(tree, n => n.props && n.props.role === 'alert').map(n => texts(n).join(' ')).join(' | ');
}

const PARTIAL = { sealed: false, keyPublished: true, reason: 'flag-partial', landed: [ONE], missed: [TWO, THREE] };
const NOWHERE = { sealed: false, keyPublished: true, reason: 'flag-failed', landed: [], missed: [ONE, TWO, THREE] };

test('THE SCREEN: a seal that reached one relay of three does not claim nothing was saved', async () => {
  const said = await screen(PARTIAL);
  assert.match(said, /\S/, 'the dialog said nothing at all after a failed seal — re-anchor this test');
  assert.doesNotMatch(said, /could not be marked encrypted/,
    'THE DIALOG STILL SAYS THE GROUP WAS NOT MARKED ENCRYPTED. On the owner’s console it was: the ' +
    'relay that carries this church stored the document with encrypted:true.');
  assert.doesNotMatch(said, /no relay accepted the lock/,
    'the partial case is being told the total-failure sentence');
  assert.match(said, /1 of 3/, 'the steward is not told how far the lock actually got');
  assert.match(said, /other-a\.example/,
    'the relays that refused are not named, so the steward cannot act on it — the console has named the ' +
    'refusing relay since 2026-09-08 everywhere else');
});

test('…and it does not assert a privacy fact that is untrue', async () => {
  const said = await screen(PARTIAL);
  assert.doesNotMatch(said, /its messages are still readable by the relay/,
    'THE LIE, VERBATIM. "Messages are still readable by the relay" is false of the one relay this church is ' +
    'on. A steward acting on it would stop using a room that is sealed.');
  assert.match(said, /Settings/,
    'the steward is left with "try again", which cannot succeed while a connected relay does not carry the ' +
    'church — the fix is in the relay list, so send them there');
});

test('…while a seal that reached NO relay is still told plainly that nothing changed', async () => {
  // The other half. Softening BOTH sentences would trade one lie for another.
  const said = await screen(NOWHERE);
  assert.match(said, /no relay accepted the lock/, 'a total failure is no longer reported as one');
  assert.match(said, /still readable by the relay/,
    'a room that was sealed nowhere must still be described as readable — that is true here, and it is the ' +
    'sentence a steward needs before they post anything sensitive in it');
  assert.doesNotMatch(said, /1 of 3|0 of 3/, 'a write that landed nowhere is being described as a partial one');
});

test('…and it never says a relay REFUSED, because it does not know that', async () => {
  // Audit finding F3 on this fix, 2026-09-17. `missed` is every relay that did not acknowledge, and
  // _publishToRelays deliberately turns a connection failure into a rejection — so an offline relay, or one
  // whose OK arrived after the 12s publish timeout, is in that list too. That function's own comment says
  // it: "a late OK is not a refusal, and the EVENT has usually been stored by then." Naming a relay as
  // having refused a document it may be holding trades a vague sentence for a checkable false one.
  const said = await screen(PARTIAL);
  assert.doesNotMatch(said, /would not take it|refused/i,
    'the dialog names a specific relay as having REFUSED the lock. It may simply have been unreachable, and ' +
    'it may be holding the document: ' + said);
  assert.match(said, /out of reach|didn’t take it/,
    'the steward is not told what actually happened to the relays that are missing the lock');
});

// ── D. the OTHER screen: "Encrypt all group chat" ─────────────────────────────────────────────────────────
// Audit finding F1 on this fix, 2026-09-17, and it is the one that would have shipped: doEncryptAll gained a
// third bucket and a whole new sentence whose only guard was a TEXT MATCH on app/stew-dashboard.jsx — which
// CLAUDE.md rule 3 forbids, because that file ships unbundled. Two sabotages proved it: deleting the routing
// left every test green, and routing a partial into the pre-existing `partial` bucket instead flipped the
// church-wide "Encrypt all" switch ON over rooms sealed on one relay of three. That is the exact false
// reassurance this whole branch exists to remove, pointing the other way.
async function sweep(sealResult) {
  const { React, draw } = miniReact();
  const events = [], profiles = [];
  const win = {
    useStewardGroups: () => [{ id: 'g1', name: 'Musicians', kind: 'group' }],
    useStewardMembers: () => [{ pubkey: 'a'.repeat(64), name: 'Ann' }],
    useStewardStewards: () => [], useStewardBlocked: () => [], useStewardAdmitted: () => [],
    useStewardJoinPolicy: () => false, useStewardIdv: () => 0, useStewardRosters: () => ({}),
    useStewardCategories: () => [], stewardStreamLoaded: () => true,
    Steward: {
      sealGroup: async () => sealResult,
      publishProfile: (pr) => { profiles.push(pr); return Promise.resolve(true); },
      setJoinPolicy() {}, setAdmitted() {},
    },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent: (e) => { events.push({ type: e.type, detail: e.detail }); },
    localStorage: { getItem: () => null, setItem() {} },
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashFeaturesPanel'], {
    React, window: win,
    Icon: Stub('Icon'), SkToggle: Stub('SkToggle'), SkPill: Stub('SkPill'), SkBadge: Stub('SkBadge'),
    Panel: ({ children }) => children, DismissibleNote: ({ children }) => children,
    DashMealsPanel: Stub('DashMealsPanel'), DashGivingPanel: Stub('DashGivingPanel'), DashChatTagsPanel: Stub('DashChatTagsPanel'),
    useStewDialog: () => ({ current: null }), useStewModalOpen: () => {},
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = (o || {}).detail; } },
    setTimeout, clearTimeout, console,
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, Promise, RegExp,
  });
  const props = { church: { name: 'St Aidan', features: {} }, show: 'rules' };
  const render = () => draw(mod.DashFeaturesPanel, props);
  let tree = render();
  const press = (label, what) => {
    const hits = find(tree, n => n.type === 'button' && (texts(n).join(' ').includes(label)
      || String((n.props || {})['aria-label'] || '').includes(label)));
    assert.equal(hits.length, 1, `re-anchor this test: expected exactly one ${what}, found ${hits.length}`);
    const r = hits[0].props.onClick({ stopPropagation() {} });
    tree = render();
    return r;
  };
  press('Toggle encrypt all group chat', 'encrypt-all switch');
  await press('Encrypt all', '“Encrypt all” button in the confirm dialog');
  for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  return { events, profiles, said: events.map(e => (e.detail && e.detail.message) || '').join(' | ') };
}

test('THE SWEEP: one room half-sealed keeps “Encrypt all” OFF', async () => {
  const w = await sweep(PARTIAL);
  assert.deepEqual(w.profiles, [],
    'THE CHURCH-WIDE SWITCH FLIPPED ON over a room sealed on one relay of three. Every member’s app fans ' +
    'its messages to all of them, so that room is sealed on one and cleartext on the others — and the ' +
    'steward has been told the whole church is encrypted.');
});

test('…and the steward is told which rooms only half-landed, not that they are unencrypted', async () => {
  const w = await sweep(PARTIAL);
  assert.match(w.said, /\S/, 'the sweep finished a partial seal in complete silence');
  assert.match(w.said, /Musicians/, 'the room that only half-landed is not named');
  assert.doesNotMatch(w.said, /could not be sealed/,
    'the partial room is reported as "could not be sealed and so stays unencrypted" — it IS sealed on the ' +
    'relay that took it, which is the lie this branch exists to remove: ' + w.said);
  assert.match(w.said, /some of your relays/, 'the steward is not told what actually happened');
});

test('CONTROL: a sweep where every room fully sealed DOES flip the switch on', async () => {
  // Without this row, a doEncryptAll that had simply stopped working would pass both rows above.
  const w = await sweep({ sealed: true, skipped: [] });
  assert.equal(w.profiles.length, 1, 'a fully successful sweep no longer turns "Encrypt all" on');
  assert.equal(w.profiles[0].features.encryptComms, true);
});

test('…and a room that sealed NOWHERE still blocks the switch and is named as unencrypted', async () => {
  const w = await sweep(NOWHERE);
  assert.deepEqual(w.profiles, [], 'the switch flipped on over a room that is sealed nowhere');
  assert.match(w.said, /could not be sealed/,
    'a room that reached no relay is no longer reported as unencrypted — softening BOTH sentences trades ' +
    'one lie for another');
});

test('CONTROL: a seal that fully worked closes the dialog and says nothing', async () => {
  const said = await screen({ sealed: true, skipped: [] });
  assert.equal(said, '',
    'a successful seal now leaves an error on screen, which would make every assertion above meaningless');
});
