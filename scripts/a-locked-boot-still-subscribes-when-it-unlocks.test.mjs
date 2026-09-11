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
// these two effects listed neither idTick nor anything else that an unlock changes, so they kept the dead
// no-op for the whole session.
//
// `idTick` is the app's identity counter — its own comment says "bumps on identity / profile changes (also
// re-runs subs that need myPubkey)" — bumped by the `trinity-identity` listener an unlock fires
// unconditionally. Several other effects already depend on it. These two did not.
//
// ⚠ WHAT THIS FILE DOES NOT CLAIM. It is NOT the fix for the 2026-09-11 two-phone blocker (a parent's screen
// not updating while the app is open). That phone was showing a child correctly at step 3 — handler
// registered, guard passed — and a second child eight seconds later still never appeared, which no
// re-subscribe can explain. See scripts/a-parents-open-screen-is-told-live.test.mjs for the half of that
// blocker now excluded (the relay's live fanout is correct). The blocker is above the socket and still open.
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

test('BOTH check-in subscriptions re-run on the identity tick, or a PIN-locked boot never subscribes', () => {
  for (const [what, call] of [
    ['the parent\'s own children', 'F.subscribeMyChildrenCheckins(np, setMyChildren)'],
    ['the worker\'s register', 'F.subscribeCheckinRegister(np, setCheckinRegister)'],
  ]) {
    const deps = depsOf(call);
    assert.match(deps, /\bidTick\b/,
      what + ' does not re-run on the identity tick. On a PIN-locked boot the reader registers a dead no-op ' +
      '(the two tests above), and connTick only rescues it when a church-doc hub happened to be open at ' +
      'unlock — so without this the feature can stay empty for the whole app session. Deps: ' + deps);
  }
});

test('idTick is what an unlock actually bumps — the dep is wired to the right signal', () => {
  assert.match(APP, /const \[idTick, forceId\]/, 're-anchor: the identity counter is no longer called idTick');
  assert.match(APP, /forceId\(x => x \+ 1\)[\s\S]{0,400}addEventListener\('trinity-identity'/,
    'idTick is no longer bumped by the trinity-identity event, so depending on it would not survive an unlock');
});
