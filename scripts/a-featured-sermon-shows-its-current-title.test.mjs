// A FEATURED SERMON SHOWS ITS CURRENT TITLE, NOT THE ONE IT HAD WHEN IT WAS PINNED.
//   Run: node --test scripts/a-featured-sermon-shows-its-current-title.test.mjs
//
// THE DEFECT (sim round 2, finding 34). `trinityone/pinsermon:` is a snapshot: it carries the title as it was
// the moment a steward pressed pin. Editing the sermon in the console republishes `trinityone/sermon:<id>`
// with the new title and leaves the pin alone, so members' Today card (and the bell entry) kept the old name.
//
// THE FIX. App overlays the title from the church's sermon list (Fellowship.subscribeSermons — the list
// Watch & Listen shows) onto the pin before it reaches the Today card or the bell.
//
// HOW THIS REACHES IT. It mounts the REAL App (every app/*.jsx, compiled as the APK build does) with a
// recording Fellowship, drives the pinned-sermon and sermon-list callbacks the way the engine would, and
// reads `ctx.pinnedSermon` off the screen App renders — the object the Today card prints `.title` from. So
// deleting either subscription from app.jsx, or the overlay, turns it red. No assertion reads app/*.jsx text.
//
// Callers of the code changed (CLAUDE.md rule 2): `pinnedSermon` in App (app/app.jsx) is read by
// the notifications memo (bell entry) and by ctx.pinnedSermon (Today's featured card, ctx.playSermon). Both
// now receive the overlaid object; the pin's id, sha256, hosts, mime and ts are untouched.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';

let App, window, reset, flush;
const calls = {};

before(() => {
  const r = fakeReact();
  reset = r.reset; flush = r.flush;
  window = appBrowser().window;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  App = loadApp({ React: r.React, window, expr: 'App' });
  const np = 'npub1' + '0'.repeat(58);
  window.TrinityData.CHURCHES = [{ id: np, npub: np, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(np));
  window.Fellowship = new Proxy({ myPubkey: 'deadbeef', CANONICAL_RELAYS: [], hasRelays: true }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return (...args) => { (calls[k] = calls[k] || []).push(args); return () => {}; };
    },
  });
});

function draw() { reset(); const tree = App(); flush(); return tree; }
// Every callback App registered for `method` — Watch and Extras subscribe to the sermon list too.
const deliver = (method, value) => (calls[method] || []).forEach(a => a.filter(x => typeof x === 'function').forEach(cb => cb(value)));
const featured = () => {
  const screen = nodes(draw()).find(n => n.props && n.props.ctx && 'pinnedSermon' in n.props.ctx);
  assert.ok(screen, 'no screen received a ctx with pinnedSermon');
  return screen.props.ctx.pinnedSermon;
};

const NOW = Math.floor(Date.now() / 1000);
const pin = { id: 's1', title: 'Old title', sha256: 'aa'.repeat(32), hosts: ['https://h'], mime: 'video/mp4', ts: NOW };

test('App subscribes to the pin and to the church sermon list', async () => {
  draw(); await new Promise(r => setTimeout(r, 1500)); draw();
  assert.ok(calls.subscribePinnedSermon, 'App never subscribed to the featured sermon');
  assert.ok(calls.subscribeSermons, 'App never subscribed to the church sermon list, so a retitled sermon cannot reach the featured card');
});

test('an edited sermon: the featured card shows the NEW title, and everything else about the pin is unchanged', () => {
  deliver('subscribePinnedSermon', pin);
  assert.equal(featured().title, 'Old title', 'fixture: with no sermon list yet the card shows the pin as pinned');
  deliver('subscribeSermons', [{ id: 's1', title: 'New title', sha256: pin.sha256, hosts: pin.hosts, mime: 'video/mp4', contentTs: NOW - 99 }]);
  const f = featured();
  assert.equal(f.title, 'New title',
    'THE FEATURED CARD KEEPS THE OLD TITLE. The sermon was renamed in the console; the pin still says "Old title" and ' +
    'nothing reads the current name from the sermon list');
  assert.equal(f.id, 's1'); assert.equal(f.sha256, pin.sha256); assert.equal(f.ts, NOW);
  assert.deepEqual(f.hosts, pin.hosts, 'the overlay changed more than the title');
});

test('CONTROL: a sermon list that does not hold the pinned sermon leaves the pin as pinned', () => {
  deliver('subscribePinnedSermon', pin);
  deliver('subscribeSermons', [{ id: 'other', title: 'Another sermon', sha256: 'bb'.repeat(32) }]);
  assert.equal(featured().title, 'Old title', 'the card took a title from a DIFFERENT sermon');
});

test('CONTROL: no pin means no card, whatever the sermon list holds', () => {
  deliver('subscribePinnedSermon', null);
  deliver('subscribeSermons', [{ id: 's1', title: 'New title', sha256: pin.sha256 }]);
  assert.equal(featured(), null);
});
