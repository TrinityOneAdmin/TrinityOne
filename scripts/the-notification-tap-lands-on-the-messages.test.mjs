// THE NOTIFICATION TAP LANDS ON THE MESSAGES (B6, part 2b).
//   Run: node --test scripts/the-notification-tap-lands-on-the-messages.test.mjs
//
// DirectPushWorker.postGeneric fires the app with ACTION_VIEW + https://app.trinityone.church/?push=msgs.
// This drives the REAL App() from app/app.jsx (scripts/app-screens.mjs, the install-bible house pattern)
// with a FAKED Capacitor App plugin: the launch URL goes through the real apply() machinery (host check,
// replay-dedup) and the real boot effect routes ?push=msgs onto the real DMInbox/DMThread in App's own
// tree. Rule 3: nothing matches text in app/*.jsx — what is read is the rendered tree and the navigation
// the machinery performs. The URI itself is read from DirectPushWorker.kt, so the two halves cannot drift.
//
// Users of the touched code (rule 2): apply()'s two subscribers (getLaunchUrl replay + appUrlOpen) and the
// boot-effect param block, both driven here; the deepLinked list (splash skip) is asserted directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';

const KT = readFileSync(new URL('../plugins/trinity-directpush/android/src/main/java/church/trinityone/directpush/DirectPushWorker.kt', import.meta.url), 'utf8');
const mURI = KT.match(/it\.data = Uri\.parse\("([^"]+)"\)/);
assert.ok(mURI, 'DirectPushWorker.postGeneric no longer sets a data URI on the tap intent');
const TAP_URI = mURI[1];

const NPUB = 'npub1' + '0'.repeat(58);
const CP = 'ab'.repeat(32);
const PEER = 'cd'.repeat(32);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// MERGE 2026-11-25: apply() now navigates via location.href (feat/qr-app-links carries the slip seed in the
// fragment, and a location.search assignment would drop it). The harness location is a plain object, so read
// the navigation target back out of href; an un-navigated boot still reads '' exactly as before.
const navSearch = (w) => { try { return new URL(String(w.location.href), 'https://app.example').search; } catch (e) { return w.location.search; } };

function fakeAppPlugin({ launchUrl = null } = {}) {
  const listeners = [];
  return { listeners, getLaunchUrl: async () => (launchUrl ? { url: launchUrl } : null),
    addListener: async (ev, cb) => { listeners.push([ev, cb]); return { remove() {} }; },
    fire: (ev, payload) => listeners.filter(([e]) => e === ev).forEach(([, cb]) => cb(payload)) };
}

function boot({ capApp, search = '', seedLs = {}, fellowship = {} } = {}) {
  const r = fakeReact();
  const env = appBrowser(); const window = env.window;
  for (const [k, v] of Object.entries(seedLs)) window.localStorage.setItem(k, v);
  window.location.search = search;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }), versions: () => [], installedMap: () => ({}) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  if (capApp) window.Capacitor = { isNativePlatform: () => true, Plugins: { App: capApp } };
  const App = loadApp({ React: r.React, window, expr: 'App' });   // the pre-sync cursor snapshot happens here, at script eval
  window.TrinityData.CHURCHES = [{ id: NPUB, npub: NPUB, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(NPUB));
  window.localStorage.setItem('trinityone.onboarded', 'true');
  window.Fellowship = new Proxy({ myPubkey: 'dd'.repeat(32), CANONICAL_RELAYS: [], hasRelays: true, toPub: (x) => x,
    subscribeAmBlocked: (cb) => { cb(false, ''); return () => {}; }, isBlockedChurch: () => false, ...fellowship },
    { get: (t, k) => { if (k in t) return t[k]; if (k === 'then' || typeof k === 'symbol') return undefined; return () => () => {}; } });
  const draw = () => { r.reset(); const tree = App(); r.flush(); return tree; };
  return { window, draw };
}
const settle = async (m) => { m.draw(); await sleep(80); m.draw(); return m.draw(); };
const inboxNode = (m, tree) => nodes(tree).find(x => x.type === m.window.DMInbox);
const threadNode = (m, tree) => nodes(tree).find(x => x.type === m.window.DMThread);

test('COLD START: the exact URI the Kotlin poster sends navigates the app to ?push=msgs through the real apply()', async () => {
  assert.match(TAP_URI, /^https:\/\/app\.trinityone\.church\/\?push=msgs$/, 'the Kotlin URI drifted from the route the app consumes');
  const m = boot({ capApp: fakeAppPlugin({ launchUrl: TAP_URI }) });
  await settle(m);
  assert.equal(navSearch(m.window), '?push=msgs', 'the launch URL did not navigate to the push route');
});

test('REPLAY-DEDUP: the remembered launch URL does not re-navigate on the next boot (no cold-start loop)', async () => {
  const m = boot({ capApp: fakeAppPlugin({ launchUrl: TAP_URI }) });
  await settle(m);
  const handled = m.window.sessionStorage.getItem('trinityone.handledLinks');
  assert.ok(handled, 'the apply machinery no longer records handled links');
  const m2 = boot({ capApp: fakeAppPlugin({ launchUrl: TAP_URI }), seedLs: { 'trinityone.handledLinks': handled } });
  await settle(m2);
  assert.equal(navSearch(m2.window), '', 'the replayed launch URL navigated again — the app would reload-loop');
});

test('WARM APP: an appUrlOpen tap (no launch URL) navigates too — the ACTION_VIEW path Capacitor actually fires', async () => {
  const cap = fakeAppPlugin();
  const m = boot({ capApp: cap });
  await settle(m);
  cap.fire('appUrlOpen', { url: TAP_URI });
  assert.equal(navSearch(m.window), '?push=msgs', 'a warm-app tap did not navigate');
});

test('INERT ELSEWHERE: a ?follow invite is byte-unchanged, and a push token from a foreign host is refused', async () => {
  const m = boot({ capApp: fakeAppPlugin({ launchUrl: 'https://app.trinityone.church/join?follow=' + NPUB + '&name=St%20B' }) });
  await settle(m);
  assert.equal(navSearch(m.window), '?follow=' + NPUB + '&name=St+B', 'the join path no longer builds the same query');
  const bad = boot({ capApp: fakeAppPlugin({ launchUrl: 'https://evil.example/?push=msgs' }) });
  await settle(bad);
  assert.equal(navSearch(bad.window), '', 'a foreign host\'s push token was honoured');
});

test('THE SURFACE: booting on ?push=msgs opens the real DMInbox in App\'s tree and skips the splash (deepLinked)', async () => {
  const m = boot({ search: '?push=msgs' });
  const tree = await settle(m);
  const inbox = inboxNode(m, tree);
  assert.ok(inbox, 'DMInbox is not in the App tree');
  assert.equal(inbox.props.open, true, 'the push route did not open the messages inbox');
  assert.ok(!nodes(tree).find(x => x.type === m.window.Splash), 'the splash swallowed the push route');
  const plain = boot({});
  const ptree = await settle(plain);
  assert.ok(!inboxNode(plain, ptree) || plain && inboxNode(plain, ptree).props.open !== true, 'control: a plain boot must not open the inbox');
});

test('ONE FRESH CONVERSATION: exactly one conversation newer than the pre-sync cursor opens as the thread itself', async () => {
  const CUR = 1700000000;
  const m = boot({
    search: '?push=msgs',
    seedLs: { ['trinityone.dmseen.' + CP]: JSON.stringify({ since: CUR }) },   // seeded BEFORE loadApp: the snapshot reads it
    fellowship: { churchPub: CP, subscribeDMs: (cb) => { cb([{ peer: PEER, lastTs: CUR + 5, preview: 'hi' }]); return () => {}; } },
  });
  await settle(m);
  assert.equal(inboxNode(m, m.draw()).props.open, true, 'the inbox is the first surface while the fresh set resolves');
  await sleep(2700);   // the in-app resolution window
  const tree = m.draw();
  const th = threadNode(m, tree);
  assert.ok(th && th.props.open === true && th.props.peer === PEER, 'the single fresh conversation did not open');
  assert.equal(inboxNode(m, tree).props.open, false, 'the inbox stayed on top of the thread');
});

test('SEVERAL fresh conversations (or none): the inbox stays, nobody is yanked into a guess', async () => {
  const CUR = 1700000000;
  const m = boot({
    search: '?push=msgs',
    seedLs: { ['trinityone.dmseen.' + CP]: JSON.stringify({ since: CUR }) },
    fellowship: { churchPub: CP, subscribeDMs: (cb) => { cb([{ peer: PEER, lastTs: CUR + 5 }, { peer: 'ef'.repeat(32), lastTs: CUR + 9 }]); return () => {}; } },
  });
  await settle(m);
  await sleep(2700);
  const tree = m.draw();
  assert.equal(inboxNode(m, tree).props.open, true, 'the inbox must stay when more than one conversation is fresh');
  assert.ok(!threadNode(m, tree) || threadNode(m, tree).props.open !== true, 'a thread opened on a guess');
});
