// THE APP STILL MOUNTS THE "SHARE AS IMAGE" CARD, AND ctx.openShare OPENS IT WITH WHAT IT WAS GIVEN.
// Run: node --test scripts/the-app-mounts-the-share-card.test.mjs
//
// ShareCard moved from app/app.jsx to app/share-app.jsx (2026-11-16). Every other share test draws ShareCard
// directly, so deleting `<ShareCard … />` from App — or breaking the ctx.openShare that VerseShareSheet's
// "Share as image" button calls — would leave them all green while the button opened nothing (CLAUDE.md rule 1).
// This boots the REAL App (every app/*.jsx in index.html order, through scripts/app-screens.mjs), calls the
// ctx.openShare App hands its screens, and finds the real ShareCard in App's tree, open, holding that payload —
// including the thoughts ("comment") VerseShareSheet now adds. No text-matching of app/*.jsx (rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';

const NPUB = 'npub1' + '0'.repeat(58);
function boot() {
  const r = fakeReact();
  const env = appBrowser(); const window = env.window;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  const { App, ShareCard } = loadApp({ React: r.React, window, expr: '({ App, ShareCard })' });
  window.TrinityData.CHURCHES = [{ id: NPUB, npub: NPUB, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(NPUB));
  window.localStorage.setItem('trinityone.onboarded', 'true');
  window.Fellowship = new Proxy({ myPubkey: 'dd'.repeat(32), CANONICAL_RELAYS: [], hasRelays: true, toPub: (x) => x, isBlockedChurch: () => false,
    subscribeAmBlocked: (cb) => { cb(false, ''); return () => {}; } }, {
    get: (t, k) => (k in t ? t[k] : (k === 'then' || typeof k === 'symbol') ? undefined : () => () => {}),
  });
  const draw = () => { r.reset(); const tree = App(); r.flush(); return tree; };
  return { draw, ShareCard };
}
const ctxOf = (tree) => { const n = nodes(tree).find(x => x.props && x.props.ctx && typeof x.props.ctx.openShare === 'function'); assert.ok(n, 'no screen received a ctx with openShare — re-anchor this test'); return n.props.ctx; };

test('App mounts ShareCard, closed; ctx.openShare opens it with the verse and the thoughts', async () => {
  const m = boot();
  m.draw(); await new Promise(r => setTimeout(r, 300));
  let tree = m.draw();
  const cards = () => nodes(tree).filter(n => n.type === m.ShareCard);
  assert.equal(cards().length, 1, 'App does not mount <ShareCard> — "Share as image" would open nothing');
  assert.equal(cards()[0].props.open, false, 'the card is open before anything was shared');
  const payload = { type: 'verse', ref: 'John 3:16', version: 'WEB', text: 'For God so loved the world.', shareThoughts: 'This got me through March.' };
  ctxOf(tree).openShare(payload);
  m.draw(); tree = m.draw();
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].props.open, true, 'ctx.openShare did not open the card');
  assert.deepEqual(cards()[0].props.verse, payload, 'the card did not receive what ctx.openShare was given (thoughts included)');
  assert.equal(typeof cards()[0].props.ctx.shareText, 'function', 'the card was not handed the app ctx');
});
