// A SERMON THE CHURCH DELETED MUST STAY DELETED, WHICHEVER ARRIVES FIRST — THE DELETE OR THE ROSTER.
//   Run: node --test scripts/a-deleted-sermon-stays-deleted-when-the-delete-beats-the-roster.test.mjs
//
// ── WHAT BROKE (audit M3), MEASURED BEFORE THE FIX ──────────────────────────────────────────────────────
// `_openSermons` (src/fellowship.src.js) read a withdrawal as `if (trusted) forget(); return;`. A delegated
// steward signs with her OWN key, so "trusted" means "on the church's signed steward roster" — and that
// roster is a document, which arrives when it arrives. A delete that landed first was DROPPED, and nothing
// ever looked at it again: `onroster()` re-derives the winner from the versions it HOLDS (`_reduceAll`), and
// a discarded tombstone is not one of them. Driving the shipped vendor/fellowship.js through the harness
// below, on the commit before this fix:
//
//     roster → sermon → delete                      cleared            (the one order that worked)
//     church's sermon → steward's delete → roster    ["Sunday"]        the deleted sermon, still listed
//     steward's sermon → delete → roster             ["Sunday"]        back on screen when the roster landed
//     no roster at all                               ["Sunday"]        (correct, and must stay so)
//
// It healed on the next app start, which is why it reads as "the sermon I removed hung around until I closed
// the app": `_docsHub()` absorbs the roster out of the persisted buffer BEFORE any handler registers, so the
// replay meets the delete with authority already in hand. Third row above with the roster pre-set = cleared.
//
// ── THE DIRECTION THAT MATTERS, AND WHY HALF THIS FILE IS ABOUT IT ──────────────────────────────────────
// The obvious repair — "remember the delete and apply it later" — is one keystroke away from a much worse
// bug than the one it fixes: a stranger (a plain member, or somebody from another church) suppressing a
// church's sermon by getting a deletion in before the phone knows who is who. That is
// `cached-paints-before-authority-arrives` pointed at a church's own content. So the note this fix keeps is
// INERT: it lives in a Map of its own, is never handed to the document store, and hides nothing until the
// church's SIGNED roster has vouched for its author. Tests 4-8 are that property, and they assert on EVERY
// callback the reader makes, not just the last one — a suppression that lasts one paint is still a
// suppression.
//
// ── HOW THIS ASSERTS (CLAUDE.md rules 1 and 3) ──────────────────────────────────────────────────────────
//   ENGINE — the REAL `_openSermons`, lifted out of the shipped vendor/fellowship.js (never a mirror of
//     it), through a stub hub that lets a test choose the arrival order and fire `onroster()` on demand.
//     Same technique and the same `with(scope)` proxy as
//     scripts/a-delegated-stewards-sermons-reach-a-member-phone.test.mjs.
//   POINT OF USE — the REAL `WatchView` out of app/screens-watch.jsx, mounted, reading that same lifted
//     engine. That is the layer that fails if the fix is deleted from the SCREEN rather than the engine.
//     Nothing here matches text in a .jsx file (rule 3); it renders the component and reads the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { miniReact, reads, loadScreen } from './render-jsx-screen.mjs';

const FELLOWSHIP_VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const SERMON_D = 'trinityone/sermon:';
const FCP = 'c'.repeat(64);        // the church's own key
const STEW = 'd'.repeat(64);       // a delegated CONTENT steward — her own key signs
const OUTSIDER = 'f'.repeat(64);   // a plain member, or somebody from another church: never vouched for

const sermonDoc = (author, id, title, at, tags = []) => ({
  id: 'x' + Math.random(), pubkey: author, created_at: at,
  content: JSON.stringify({ id, title, sha256: 'aa', hosts: ['h'], mime: 'audio/mp4', size: 1 }),
  tags: [['d', SERMON_D + id], ...tags],
});
const deleteDoc = (author, id, at, tags = []) => ({
  id: 'x' + Math.random(), pubkey: author, created_at: at, content: '',
  tags: [['d', SERMON_D + id], ['deleted', '1'], ...tags],
});

// `emit` is `_coalesce`d — a microtask, not synchronous — so every assertion waits a tick.
const settle = () => new Promise(r => setTimeout(r, 0));

function liftedEngine() {
  let handler = null;
  const stubs = {
    toPub: () => FCP,
    _churchRoster: new Map(),   // NO entry for FCP = the roster has not arrived; `_churchVoice` then trusts only the church key
    _onChurchDocs: (_cp, h) => { handler = h; return () => { handler = null; }; },
    console,
  };
  const DECLARED = new Set(['handler', '_churchVoice', '_coalesce', '_pickWinner', '_reduceVersions',
    '_absorbById', '_forgetById', '_reduceAll', '_tombstoneTargets', 'SERMON_D']);
  const scope = new Proxy(stubs, {
    has: (t, k) => !DECLARED.has(String(k)) && ((k in t) || !(String(k) in globalThis)),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it in liftedEngine()'); },
  });
  const parts = [
    fnBody(FELLOWSHIP_VENDOR, 'function _churchVoice(cp, doc) {', '_churchVoice'),
    fnBody(FELLOWSHIP_VENDOR, 'function _coalesce(fn) {', '_coalesce'),
    fnBody(FELLOWSHIP_VENDOR, 'function _pickWinner(', '_pickWinner'),
    fnBody(FELLOWSHIP_VENDOR, 'function _reduceVersions(', '_reduceVersions'),
    fnBody(FELLOWSHIP_VENDOR, 'function _absorbById(', '_absorbById'),
    fnBody(FELLOWSHIP_VENDOR, 'function _forgetById(', '_forgetById'),
    fnBody(FELLOWSHIP_VENDOR, 'function _reduceAll(', '_reduceAll'),
    fnBody(FELLOWSHIP_VENDOR, 'function _tombstoneTargets(e) {', '_tombstoneTargets'),
  ].join('\n');
  const osBody = fnBody(FELLOWSHIP_VENDOR, '_openSermons(churchNpub, onSermons) {', '_openSermons');
  const names = Object.keys(stubs);
  const built = new Function(...names, 'scope', `
    ${parts}
    let SERMON_D = ${JSON.stringify(SERMON_D)};
    with (scope) { return ({ ${osBody} })._openSermons; }
  `)(...names.map(k => stubs[k]), scope);
  return {
    open: (cb) => built('npub1c', cb),
    fire: (e) => handler.onevent(e, (e.tags.find(t => t[0] === 'd') || [])[1]),
    eose: () => handler.oneose(),
    opened: () => !!handler,
    // the roster is absorbed before any handler registers on a COLD start (`_docsHub`), and fires
    // `onroster()` when it lands mid-session (`_docsHubOpen`) — this harness can do either.
    rosterKnownBeforeOpen: (pubs) => stubs._churchRoster.set(FCP, new Set(pubs)),
    rosterArrives: (pubs) => { stubs._churchRoster.set(FCP, new Set(pubs)); handler.onroster(); },
  };
}

// Every callback this reader made, as lists of titles — so a test can say "it was never hidden", not merely
// "it is not hidden now".
function recorder() {
  const eng = liftedEngine();
  const calls = [];
  eng.open(l => calls.push(l.map(s => s.title)));
  return { eng, calls, last: () => calls[calls.length - 1] };
}

// ── 1-3: THE BUG ────────────────────────────────────────────────────────────────────────────────────────

test('ROSTER FIRST still works — the order that was never broken', async () => {
  const { eng, last } = recorder();
  eng.rosterKnownBeforeOpen([STEW]);
  eng.fire(sermonDoc(STEW, 's1', 'Sunday', 1000, [['church', FCP]]));
  eng.fire(deleteDoc(STEW, 's1', 3000, [['church', FCP]]));
  eng.eose();
  await settle();
  assert.deepEqual(last(), [], 'a steward deleting her own sermon, with the roster already known, no longer clears it — this fix broke the working order: ' + JSON.stringify(last()));
});

test('DELETE FIRST: the church’s sermon, a steward’s delete, THEN the roster — it must go', async () => {
  // The user-visible one. The sermon is the CHURCH's, so it is on screen from the first paint; the steward
  // presses Remove in the console; her tombstone reaches the phone before the roster that vouches for her.
  const { eng, calls, last } = recorder();
  eng.fire(sermonDoc(FCP, 's1', 'Sunday', 1000, [['church', FCP]]));
  eng.fire(deleteDoc(STEW, 's1', 3000, [['church', FCP], ['for', FCP]]));
  eng.eose();
  await settle();
  assert.deepEqual(last(), ['Sunday'],
    'THE UNVOUCHED DELETE HID THE SERMON BEFORE THE ROSTER VOUCHED FOR ITS AUTHOR. Shown: ' + JSON.stringify(last()));
  const before = calls.length;
  eng.rosterArrives([STEW]);
  await settle();
  assert.ok(calls.length > before, 'the roster arriving produced no new callback at all, so nothing can have been re-decided');
  assert.deepEqual(last(), [],
    'A SERMON THE CHURCH REMOVED IS STILL LISTED ON A MEMBER’S PHONE. Its delete arrived before the ' +
    'steward roster that vouches for the author and was thrown away (audit M3). Shown: ' + JSON.stringify(last()));
});

test('DELETE FIRST: a steward’s OWN sermon, deleted, must not reappear when the roster lands', async () => {
  // Neither event is trusted while the roster is unknown, so nothing is on screen — and then the roster
  // arrives and vouches for BOTH. Before the fix the sermon appeared at that moment: the delete was gone.
  const { eng, last } = recorder();
  eng.fire(sermonDoc(STEW, 's1', 'Sunday', 1000, [['church', FCP]]));
  eng.fire(deleteDoc(STEW, 's1', 3000, [['church', FCP]]));
  eng.eose();
  await settle();
  eng.rosterArrives([STEW]);
  await settle();
  assert.deepEqual(last(), [],
    'THE DELETED SERMON APPEARED THE MOMENT THE ROSTER ARRIVED — the roster vouched for the sermon and ' +
    'not for the delete, because the delete had been discarded. Shown: ' + JSON.stringify(last()));
});

// ── 4-8: THE SAFEGUARDING HALF — AN UNVOUCHED DELETE MUST NEVER HIDE ANYTHING ───────────────────────────

test('SAFEGUARDING: a stranger cannot suppress a sermon by deleting it before the roster arrives', async () => {
  // THE test. If this one ever fails, the fix is worse than the bug: anybody on the network who can reach a
  // relay could take a church's sermon off its members' phones by racing the roster document.
  const { eng, calls, last } = recorder();
  eng.fire(deleteDoc(OUTSIDER, 's1', 3000, [['church', FCP], ['for', '*']]));
  eng.fire(sermonDoc(FCP, 's1', 'Sunday', 1000, [['church', FCP]]));
  eng.eose();
  await settle();
  eng.rosterArrives([STEW]);   // the roster lands and does NOT name the outsider
  await settle();
  assert.ok(calls.length, 'the reader never called back at all — this test cannot see what it is asserting');
  for (const c of calls) assert.deepEqual(c, ['Sunday'],
    'A STRANGER TOOK A CHURCH’S SERMON OFF ITS MEMBERS’ PHONES by sending a deletion before the phone ' +
    'knew who was who. Every paint must show it; one of them did not: ' + JSON.stringify(calls));
  assert.deepEqual(last(), ['Sunday']);
});

test('SAFEGUARDING: …and adding that stranger to the roster LATER does not revive their old delete', async () => {
  // Once the roster has answered, the refusal is final. Somebody the church makes a steward next month has
  // not thereby acquired the authority to have deleted something last month.
  const { eng, last } = recorder();
  eng.fire(deleteDoc(OUTSIDER, 's1', 3000, [['church', FCP], ['for', FCP]]));
  eng.fire(sermonDoc(FCP, 's1', 'Sunday', 1000, [['church', FCP]]));
  eng.eose();
  await settle();
  eng.rosterArrives([STEW]);          // refused
  await settle();
  eng.rosterArrives([STEW, OUTSIDER]); // the church empowers them, for unrelated reasons
  await settle();
  assert.deepEqual(last(), ['Sunday'],
    'A DELETE THE ROSTER ALREADY REFUSED WAS APPLIED RETROSPECTIVELY when its author was later made a ' +
    'steward. Shown: ' + JSON.stringify(last()));
});

test('SAFEGUARDING: a delete that arrives AFTER the roster is not held against a later change of mind', async () => {
  // The other half of the same rule, and the one that decides WHEN a note may be taken at all. The roster
  // is already here, so the answer is already known and there is nothing to wait for — the delete is
  // refused on the spot and not filed. Remembering it "just in case" would mean that making somebody a
  // steward next month silently executes the deletion they sent last month.
  const { eng, last } = recorder();
  eng.rosterKnownBeforeOpen([STEW]);
  eng.fire(sermonDoc(FCP, 's1', 'Sunday', 1000, [['church', FCP]]));
  eng.fire(deleteDoc(OUTSIDER, 's1', 3000, [['church', FCP], ['for', FCP]]));
  eng.eose();
  await settle();
  assert.deepEqual(last(), ['Sunday'], 'fixture: an unvouched delete arriving after the roster must do nothing at once');
  eng.rosterArrives([STEW, OUTSIDER]);   // the church empowers them, for unrelated reasons
  await settle();
  assert.deepEqual(last(), ['Sunday'],
    'MAKING SOMEBODY A STEWARD EXECUTED A DELETION THEY SENT BEFORE THEY WERE ONE. Shown: ' + JSON.stringify(last()));
});

test('SAFEGUARDING: a REVOKED steward’s delete is refused the same way', async () => {
  // She was a steward when she signed it; by the time this phone can check, the church has removed her.
  const { eng, last } = recorder();
  eng.fire(sermonDoc(FCP, 's1', 'Sunday', 1000, [['church', FCP]]));
  eng.fire(deleteDoc(STEW, 's1', 3000, [['church', FCP], ['for', FCP]]));
  eng.eose();
  await settle();
  eng.rosterArrives([]);   // the roster arrives, and she is not on it
  await settle();
  assert.deepEqual(last(), ['Sunday'],
    'A REVOKED STEWARD’S DELETE WAS HONOURED. Shown: ' + JSON.stringify(last()));
});

test('THE ROSTER MAY NEVER ARRIVE — offline or unauthenticated, the sermon stays VISIBLE', async () => {
  // Fail in the direction that shows a church's own content. A phone that cannot read the roster must not
  // start hiding sermons on the word of an author it will never be able to check.
  const { eng, calls, last } = recorder();
  eng.fire(sermonDoc(FCP, 's1', 'Sunday', 1000, [['church', FCP]]));
  eng.fire(deleteDoc(STEW, 's1', 3000, [['church', FCP], ['for', FCP]]));
  eng.eose();
  await settle();
  for (const c of calls) assert.deepEqual(c, ['Sunday'],
    'a sermon vanished on a phone that has never seen this church’s steward roster: ' + JSON.stringify(calls));
  assert.deepEqual(last(), ['Sunday']);
});

test('A HOSTILE STREAM CANNOT GROW THE NOTES WITHOUT BOUND — past the cap it degrades to "still visible"', async () => {
  // The notes are in-memory and closure-local, so they die with the subscription; the cap is what stops a
  // relay serving deletes we would refuse from growing them inside one session. 500 is the cap in
  // `_openSermons`; at 600 the last hundred are not remembered, and a sermon whose delete was not
  // remembered stays on screen — the safe direction.
  const { eng, last } = recorder();
  for (let i = 0; i < 600; i++) eng.fire(deleteDoc(STEW, 's' + i, 3000, [['church', FCP]]));
  for (let i = 0; i < 600; i++) eng.fire(sermonDoc(STEW, 's' + i, 'S' + i, 1000, [['church', FCP]]));
  eng.eose();
  await settle();
  eng.rosterArrives([STEW]);
  await settle();
  assert.equal(last().length, 100,
    'the pending-delete cap is not where this test thinks it is — 600 deletes against a cap of 500 should ' +
    'leave exactly 100 sermons on screen. Shown: ' + last().length);
});

// ── 9: THE WILDCARD WITHDRAWAL ADDED IN 4a9141c IS UNCHANGED ───────────────────────────────────────────

test('THE CHURCH’S OWN `for: *` never needed the roster, and still does not', async () => {
  // `_churchVoice` trusts `by === cp` with no roster at all, so a church-signed withdrawal is honoured on
  // arrival and never becomes a pending note. Measured identical before and after this fix.
  const { eng, last } = recorder();
  eng.fire(deleteDoc(FCP, 's1', 3000, [['church', FCP], ['for', '*']]));
  eng.fire(sermonDoc(STEW, 's1', 'Sunday', 1000, [['church', FCP]]));
  eng.eose();
  await settle();
  eng.rosterArrives([STEW]);
  await settle();
  assert.deepEqual(last(), [],
    'the church’s own sticky wildcard withdrawal stopped working: ' + JSON.stringify(last()));
});

test('…and a STEWARD’s `for: *`, remembered and then vouched for, still cannot take the church’s copy', async () => {
  // Round 9 at the point the note is redeemed: `_forgetById` honours `'*'` only for a tombstone signed by
  // the church key, so a delete that waited for the roster gets no more authority than one that did not.
  const { eng, last } = recorder();
  eng.fire(sermonDoc(FCP, 's1', 'Sunday', 1000, [['church', FCP]]));
  eng.fire(deleteDoc(STEW, 's1', 3000, [['church', FCP], ['for', '*']]));
  eng.eose();
  await settle();
  eng.rosterArrives([STEW]);
  await settle();
  assert.deepEqual(last(), ['Sunday'],
    'A STEWARD REMOVED THE CHURCH’S OWN SERMON by asking for every copy — through the pending-delete path. ' +
    'Shown: ' + JSON.stringify(last()));
});

// ── POINT OF USE: THE REAL WATCH & LISTEN TAB ───────────────────────────────────────────────────────────
// `ctx.church.channel` is '' so the screen takes the `window.Bible.getVideos()` branch for its other gate.
// `SermonRow` is stubbed to render the title and nothing else, so `reads(tree)` says exactly which sermons
// are on the screen — this asserts on the rendered tree, never on the text of the .jsx (rule 3).
async function watchTab() {
  const { React, draw } = miniReact();
  const eng = liftedEngine();
  const win = {
    Fellowship: {
      subscribeSermons: (_npub, cb) => eng.open(cb),   // the shipped wrapper is a `_shared()` passthrough to _openSermons
      gatewayBase: () => '',
    },
    Bible: { getVideos: async () => ({ channel: null, videos: [] }) },
    TrinityAudio: { play() {} },
  };
  const globals = {
    React, window: win,
    Icon: () => null, SectionLabel: ({ children }) => children, SermonRow: ({ s }) => s.title,
    setTimeout, clearTimeout, fetch: async () => { throw new Error('the screen must not fetch a feed with no channel set'); },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp,
  };
  const mod = loadScreen('app/screens-watch.jsx', ['WatchView'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary’s', channel: '' }, toast() {}, openVideo() {} };
  const render = () => draw(mod.WatchView, { ctx });
  render();
  await settle();
  assert.ok(eng.opened(), 'the screen never subscribed to sermons at all — re-anchor this test');
  return { eng, render, said: async () => { await settle(); return reads(render()); } };
}

test('POINT OF USE: the removed sermon leaves the Watch & Listen tab when the roster lands', async () => {
  const w = await watchTab();
  w.eng.fire(sermonDoc(FCP, 's1', 'Sunday Morning', 1000, [['church', FCP]]));
  w.eng.fire(deleteDoc(STEW, 's1', 3000, [['church', FCP], ['for', FCP]]));
  w.eng.eose();
  assert.match(await w.said(), /Sunday Morning/,
    'fixture: the church’s sermon should be on the tab before the roster has ruled on the delete');
  w.eng.rosterArrives([STEW]);
  assert.doesNotMatch(await w.said(), /Sunday Morning/,
    'A SERMON THE CHURCH REMOVED IS STILL ON THE WATCH & LISTEN TAB. Its delete reached the phone before ' +
    'the steward roster and was discarded (audit M3). Screen read: ' + JSON.stringify(await w.said()));
});

test('POINT OF USE: a stranger’s early delete leaves it on the tab, before AND after the roster', async () => {
  const w = await watchTab();
  w.eng.fire(deleteDoc(OUTSIDER, 's1', 3000, [['church', FCP], ['for', '*']]));
  w.eng.fire(sermonDoc(FCP, 's1', 'Sunday Morning', 1000, [['church', FCP]]));
  w.eng.eose();
  assert.match(await w.said(), /Sunday Morning/,
    'A STRANGER TOOK A SERMON OFF THE TAB in the window before the roster arrived. Screen read: ' + JSON.stringify(await w.said()));
  w.eng.rosterArrives([STEW]);
  assert.match(await w.said(), /Sunday Morning/,
    'A STRANGER’S DELETE WAS HONOURED once the roster arrived, though the roster does not name them. ' +
    'Screen read: ' + JSON.stringify(await w.said()));
});
