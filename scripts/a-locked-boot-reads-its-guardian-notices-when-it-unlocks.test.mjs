// A PIN-LOCKED BOOT STARTS READING ITS GUARDIAN NOTICES WHEN IT UNLOCKS.
// Run: node --test scripts/a-locked-boot-reads-its-guardian-notices-when-it-unlocks.test.mjs
//
// Whole-branch audit of integration/2026-10-01, 5(c). The App effect that subscribes the parent's guardian
// notices depended only on [connTick, lazyReady]. With no key Fellowship.subscribeGuardianNotices registers
// nothing (`if (!pub) return () => {}`), and connTick re-runs the effect after an unlock only when the unlock's
// reconnect fires — which src/fellowship.src.js's deriveFromIdentity does only if a church-doc hub is already
// open. Unlock before one opens and the notices were never read that session; with the stamp a parent keeps
// across restarts (_noticeSeen), the Family sheet then said "Couldn't reach your church" all session. The
// check-in effects beside it already depend on `keyReady` for exactly this reason
// (scripts/a-locked-boot-still-subscribes-when-it-unlocks.test.mjs).
//
// THE REAL App, compiled from app/app.jsx and drawn through scripts/app-screens.mjs, with a Fellowship whose key
// arrives part-way through — and the assertion is on what the App actually calls, not on its source text.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp } from './app-screens.mjs';

let App, window, reset, flush;
const calls = {};
const F = { myPubkey: null, CANONICAL_RELAYS: [], hasRelays: true };   // a PIN-locked boot: no key yet

before(() => {
  const r = fakeReact();
  reset = r.reset; flush = r.flush;
  const env = appBrowser();
  window = env.window;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  App = loadApp({ React: r.React, window, expr: 'App' });
  const testNpub = 'npub1' + '0'.repeat(58);
  window.TrinityData.CHURCHES = [{ id: testNpub, npub: testNpub, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(testNpub));
  window.Fellowship = new Proxy(F, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return (...args) => { (calls[k] = calls[k] || []).push(args); return () => {}; };
    },
  });
});

const draw = () => { reset(); const tree = App(); flush(); return tree; };
const notices = () => (calls.subscribeGuardianNotices || []).length;

test('the guardian-notice subscription runs again when the key arrives — with no reconnect to prompt it', async () => {
  draw();
  await new Promise(r => setTimeout(r, 1500));   // the lazy engines settle (lazyReady)
  draw();
  const locked = notices();
  assert.ok(locked >= 1, 'CONTROL: the App never subscribed the guardian notices at all');
  draw();
  assert.equal(notices(), locked, 'CONTROL: a plain re-render re-subscribed — the effect is not keyed on its dependencies');
  F.myPubkey = 'ab'.repeat(32);                   // the PIN is entered: the key lands; no reconnect, connTick unchanged
  draw();
  assert.ok(notices() > locked,
    'THE PARENT’S GUARDIAN NOTICES WERE NEVER READ AFTER THE UNLOCK — the subscription made while locked registered ' +
    'nothing, and nothing re-ran it: the Family sheet says "Couldn’t reach your church" for the whole session');
});
