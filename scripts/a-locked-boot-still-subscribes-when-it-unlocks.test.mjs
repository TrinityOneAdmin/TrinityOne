// A PIN-LOCKED BOOT MUST NOT LEAVE CHECK-IN DEAD FOR THE WHOLE SESSION.
//   Run: node --test scripts/a-locked-boot-still-subscribes-when-it-unlocks.test.mjs
//
// A PIN-locked boot has no key, and both check-in readers begin:
//     if (!me || !sk) { cb({ ...EMPTY }); return () => {}; }
// That is a DEAD no-op — no handler registered with the church-docs hub, so nothing is fetched and no live
// event is ever delivered. Correct on its own: a reader with no key can do nothing. It only works because
// something re-runs the effect once the key arrives.
//
// USUALLY connTick does. Unlocking runs deriveFromIdentity → reconnectAll() → `trinity-reconnect` → connTick.
// But that call is CONDITIONAL: src/fellowship.src.js runs it only `if (wasKeyless && sk)` AND a church-doc
// hub is already open (`if (hub.closer)`). Unlock before any hub has opened and connTick never moves — and
// these two effects listed nothing else that changes when a key arrives, so they kept the dead no-op for the
// whole session.
//
// ⚠ THE FIRST FIX FOR THIS DEPENDED ON `idTick`, AND ITS STATED REASON WAS WRONG — corrected here rather than
// left standing, because a wrong reason in a comment is what the next reader trusts. `idTick` bumps on
// `trinity-identity`, but deriveFromIdentity IS that event's listener and it AWAITS exportMnemonic() before
// assigning `sk`, so the re-run it triggers is still keyless. The bump that actually rescued the
// subscription was the LATER `trinity-profiles` one. And `trinity-profiles` fires once per arriving kind-0
// and once per opened sealed name, so idTick made both effects tear down and re-register N times in a church
// of N members — churn this codebase has already paid for twice elsewhere.
//
// So the dependency is `keyReady` — `!!window.Fellowship.myPubkey`, read at render, flipping false→true
// exactly once. idTick is still what causes the render that observes the flip; it is no longer the thing
// depended on. Both facts are asserted below.
//
// ⚠ WHAT THIS FILE DOES NOT CLAIM. It is NOT the fix for the 2026-09-11 two-phone blocker (a parent's screen
// not updating while the app is open). That phone was showing a child correctly at step 3 — handler
// registered, guard passed — and a second child eight seconds later still never appeared, which no
// re-subscribe can explain. The blocker is still open.
//
// This file pins BOTH halves of the hole it DOES close: the reader really is inert without a key (so the dep
// is load-bearing, not decoration), and the app really does list the dep. The second assertion is STRUCTURAL
// — it reads the dependency array out of app/app.jsx rather than driving React — and that limit is stated
// rather than glossed: a dependency array is not observable from a rendered tree, and
// scripts/no-hook-after-an-early-return.test.mjs is this repo's precedent for asserting a hook's shape from
// source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// Lift a reader out of the SHIPPED bundle and run it with NO key, counting hub registrations.
function subscribeWithNoKey(fnName, sig) {
  let registrations = 0;
  const emitted = [];
  const scope = {
    toPub: (x) => x,
    pub: '', sk: null,                       // a PIN-locked boot: identity present, key not yet released
    _onChurchDocs: () => { registrations++; return () => {}; },
    _coalesce: (fn) => { const f = () => fn(); f.cancel = () => {}; return f; },
    Map, Math, String, Number, Array, Object, JSON, Boolean, console, Date,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError(fnName + ' needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { return ({ ' + fnBody(FELLOWSHIP, sig, fnName) + ' }); }')(proxy);
  const off = api[fnName]('cafebabe'.repeat(8), (s) => emitted.push(s));
  if (typeof off === 'function') off();
  return { registrations, emitted };
}

test('with no key, the PARENT reader registers nothing — so something must re-subscribe when the key arrives', () => {
  const r = subscribeWithNoKey('subscribeMyChildrenCheckins', 'subscribeMyChildrenCheckins(churchNpub, cb) {');
  assert.equal(r.registrations, 0,
    're-anchor: the reader now registers a hub handler without a key, which would make the dependency below ' +
    'unnecessary — check whether this test still describes the code');
  assert.equal(r.emitted.length, 1, 'a caller with no key was told nothing at all — the screen would spin for ever');
  assert.equal(r.emitted[0].settled, false,
    'a keyless answer claims to have SETTLED, so a screen would render "no children" as a fact rather than as ' +
    '"not yet" — the silent-blank-app shape');
});

test('with no key, the WORKER reader registers nothing either — the same trap sits under the register', () => {
  const r = subscribeWithNoKey('subscribeCheckinRegister', 'subscribeCheckinRegister(churchNpub, cb) {');
  assert.equal(r.registrations, 0, 're-anchor: see the parent reader test above');
  assert.equal(r.emitted.length, 1);
  assert.equal(r.emitted[0].settled, false);
});

// ── the other half: the app must re-subscribe when the identity arrives ──────────────────────────────────
function depsOf(callText) {
  const at = APP.indexOf(callText);
  assert.notEqual(at, -1, 're-anchor: app/app.jsx no longer contains ' + JSON.stringify(callText));
  const close = APP.indexOf('}, [', at);
  assert.notEqual(close, -1, 'no dependency array follows ' + JSON.stringify(callText));
  const end = APP.indexOf(']);', close);
  return APP.slice(close + 3, end + 1);
}

test('BOTH check-in subscriptions re-run when the key lands, or a PIN-locked boot never subscribes', () => {
  for (const [what, call] of [
    ['the parent\'s own children', 'F.subscribeMyChildrenCheckins(np, setMyChildren)'],
    ['the worker\'s register', 'F.subscribeCheckinRegister(np, setCheckinRegister)'],
  ]) {
    const deps = depsOf(call);
    assert.match(deps, /\bkeyReady\b/,
      what + ' does not re-run when the signing key arrives. On a PIN-locked boot the reader registers a dead ' +
      'no-op (the two tests above), and connTick only rescues it when a church-doc hub happened to be open at ' +
      'unlock — so without this the feature can stay empty for the whole app session. Deps: ' + deps);
    assert.doesNotMatch(deps, /\bidTick\b/,
      what + ' depends on idTick again. idTick bumps once per arriving kind-0 and once per opened sealed ' +
      'name, so in a church of N members this effect tears down and re-registers its hub handler N times — ' +
      'on a screen where a blank is a safeguarding lie. Depend on keyReady, which flips once. Deps: ' + deps);
  }
});

test('keyReady is the KEY\'s arrival, not a notification that one may be coming', () => {
  const at = APP.indexOf('const keyReady =');
  assert.notEqual(at, -1, 're-anchor: app/app.jsx no longer derives keyReady');
  const line = APP.slice(at, APP.indexOf('\n', at));
  assert.match(line, /window\.Fellowship\s*&&\s*window\.Fellowship\.myPubkey/,
    'keyReady is derived from something other than the signing key this phone actually holds, so it can flip ' +
    'true while both readers would still hit their `!me || !sk` guard. It reads: ' + line);
});

// THE FACT THE FIRST ATTEMPT GOT WRONG, pinned so it cannot be got wrong again. `trinity-identity` fires
// BEFORE the key exists — deriveFromIdentity is its listener and awaits a native SecureStorage read first —
// so a re-render driven only by that event would observe keyReady still false. The render that sees the flip
// comes from the `trinity-profiles` dispatch AFTER `sk` is assigned. Remove either half and the hole reopens.
test('a render happens AFTER the key is assigned, or keyReady flips where nobody is looking', () => {
  const at = APP.indexOf("const h = () => { forceId(");
  assert.notEqual(at, -1, 're-anchor: the identity listener no longer bumps forceId');
  const block = APP.slice(at, at + 900);
  assert.match(block, /addEventListener\('trinity-profiles', h\)/,
    'app/app.jsx no longer re-renders on `trinity-profiles`. That is the ONLY one of the identity events ' +
    'dispatched after the signing key is assigned, so without it keyReady can flip with no render to observe ' +
    'it and both check-in screens stay empty for the session.');

  const FELLOWSHIP_SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
  const d = FELLOWSHIP_SRC.indexOf('async function deriveFromIdentity');
  assert.notEqual(d, -1, 're-anchor: deriveFromIdentity is gone from src/fellowship.src.js');
  // Comments are stripped first: this repo has had an ordering assertion satisfied by the comment that
  // explained the rule, which is worth exactly nothing.
  const body = FELLOWSHIP_SRC.slice(d, d + 9000).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const assigned = body.indexOf('sk = privateKeyFromSeedWords');
  const told = body.indexOf("dispatchEvent(new CustomEvent('trinity-profiles'");
  assert.ok(assigned !== -1, 're-anchor: deriveFromIdentity no longer assigns sk that way');
  assert.ok(told !== -1,
    'deriveFromIdentity no longer dispatches `trinity-profiles`. It is the only signal fired after the key ' +
    'exists, so nothing would tell the app the key had landed and both check-in screens would stay empty.');
  assert.ok(told > assigned,
    'deriveFromIdentity announces `trinity-profiles` BEFORE it assigns the signing key, so every listener ' +
    'that re-reads myPubkey on that event reads the old answer — which is exactly the trap `trinity-identity` ' +
    'already is.');
});
