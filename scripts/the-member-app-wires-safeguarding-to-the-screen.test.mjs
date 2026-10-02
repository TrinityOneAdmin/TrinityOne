// THE MEMBER APP WIRES SAFEGUARDING SUBSCRIPTIONS TO THE SCREEN.
// Run: node --test scripts/the-member-app-wires-safeguarding-to-the-screen.test.mjs
//
// T-3 (audit 2026-09-27). At least 13 safety features could be deleted from the app with every test still
// passing. The engine tests cover the engine and the screen tests take fixtures, but the line joining them
// — the subscriptions that App() calls in its effects — was untested. Example: deleting
// `F.subscribeChurchSafeguard(np, setSafeguard)` left all 21 related test files green; a child's phone
// would never learn they are a child, so every safeguard downstream (group filtering, DM gating) was dead.
//
// This test mounts the REAL App component (all 32 .jsx files, compiled by esbuild as the APK build does)
// with a recording Fellowship stub. It asserts each subscription is called, then drives the callback to
// verify the screen reacts.
//
// CLAUDE.md rule 1 (point of use): these tests fail if the subscription call is deleted from app.jsx.
// CLAUDE.md rule 3: no assertion matches text in app/*.jsx — the tests call the function and read the tree.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, nodes, texts } from './app-screens.mjs';

let App, window, React, reset, flush;
const calls = {};
const callbacks = {};

before(() => {
  const r = fakeReact();
  React = r.React; reset = r.reset; flush = r.flush;
  const env = appBrowser();
  window = env.window;

  window.Bible = {
    loaded: true, activeVersion: 'KJV', subscribe: () => () => {},
    books: () => ['John'], maxChapter: () => 21,
    defaultLoc: () => ({ book: 'John', chap: 1 }),
  };
  window.MyData = {
    seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) },
    count: () => 0, set: () => {},
  };
  window.TrinityData = {};

  App = loadApp({ React, window, expr: 'App' });

  const testNpub = 'npub1' + '0'.repeat(58);
  window.TrinityData.CHURCHES = [{ id: testNpub, npub: testNpub, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(testNpub));

  window.Fellowship = new Proxy(
    { myPubkey: 'deadbeef', CANONICAL_RELAYS: [], hasRelays: true },
    {
      get: (t, k) => {
        if (k in t) return t[k];
        if (k === 'then' || typeof k === 'symbol') return undefined;
        return (...args) => {
          (calls[k] = calls[k] || []).push(args);
          const cb = args.find(a => typeof a === 'function');
          if (cb) callbacks[k] = cb;
          return () => {};
        };
      },
    },
  );
});

function draw() { reset(); const tree = App(); flush(); return tree; }

// ── §1 · all four wiring points are called ───────────────────────────────────────────────────────────────

test('App calls subscribeChurchSafeguard with the church npub', async () => {
  draw();
  await new Promise(r => setTimeout(r, 1500));
  draw();
  assert.ok(calls.subscribeChurchSafeguard,
    'App never called Fellowship.subscribeChurchSafeguard — a child on this phone would never be identified as a child');
  const [np] = calls.subscribeChurchSafeguard[0];
  assert.ok(np && np.startsWith('npub1'),
    'subscribeChurchSafeguard was called without a church npub: ' + np);
});

test('App calls subscribeMyChildrenCheckins', () => {
  assert.ok(calls.subscribeMyChildrenCheckins,
    'App never called subscribeMyChildrenCheckins — a parent would never see their child\'s pickup code');
});

test('App calls subscribeCheckinRegister', () => {
  assert.ok(calls.subscribeCheckinRegister,
    'App never called subscribeCheckinRegister — a worker\'s check-in register would be empty');
});

test('App calls subscribeGuardianNotices', () => {
  assert.ok(calls.subscribeGuardianNotices,
    'App never called subscribeGuardianNotices — steward-initiated guardian links would never be processed');
});

// ── §2 · the safeguard callback drives the screen ────────────────────────────────────────────────────────

test('when the safeguard callback reports isMinor, the app marks the member as a child', () => {
  assert.ok(callbacks.subscribeChurchSafeguard,
    'no callback was captured from subscribeChurchSafeguard');
  callbacks.subscribeChurchSafeguard({
    minors: [], approved: [], guardians: {},
    isMinor: true, minorsKnown: true,
  });
  const tree = draw();
  const all = nodes(tree);
  const screen = all.find(n => n.props && n.props.ctx && 'safeguard' in n.props.ctx);
  assert.ok(screen, 'no screen component received a ctx with safeguard');
  assert.equal(screen.props.ctx.safeguard.isMinor, true,
    'the safeguard.isMinor flag did not reach the rendered tree after the callback');
});

test('CONTROL: an adult member has isMinor false', () => {
  callbacks.subscribeChurchSafeguard({
    minors: [], approved: [], guardians: {},
    isMinor: false, minorsKnown: true,
  });
  const tree = draw();
  const all = nodes(tree);
  const screen = all.find(n => n.props && n.props.ctx && 'safeguard' in n.props.ctx);
  assert.ok(screen, 'no screen component received a ctx with safeguard');
  assert.equal(screen.props.ctx.safeguard.isMinor, false,
    'an adult was marked as a child');
});
