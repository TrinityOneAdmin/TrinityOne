// The unread marks (chatseen) sync only to relays that PROVED they run our software.
// Run: node --test scripts/unread-marks-sync-only-proved-relays.test.mjs
//
// RELAY-ADMISSION.md / CLAUDE.md rule 10. src/mydata.src.js used the raw candidate list
// (`Fellowship.relays`, plus a hardcoded ws://127.0.0.1:7447 fallback) for BOTH its publish and its subscribe,
// so which rooms a member reads went to relays nobody had proved. It now asks Fellowship.churchRelays().
//
// POINT OF USE: these tests run the SHIPPED bundle (vendor/mydata.js) in a vm with a recording WebSocket, and
// count which addresses it dials. Deleting the fix from src + rebuilding makes them fail; so does deleting it
// from the bundle. They do not read app/*.jsx text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const BUNDLE = readFileSync(new URL('../vendor/mydata.js', import.meta.url), 'utf8');
const FELLOW_BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PROVED = 'wss://proved.example/relay';
const UNPROVED = 'wss://unproved.example/relay';
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

function boot(fellowship, code = BUNDLE) {
  const dialled = [];
  const listeners = {};
  const store = new Map();
  class WS {
    constructor(url) {
      dialled.push(String(url)); this.readyState = 0; this.url = url;
      setTimeout(() => { try { this.onerror && this.onerror({}); this.onclose && this.onclose({}); } catch (e) {} }, 0);
    }
    send() {} close() {} addEventListener() {} removeEventListener() {}
  }
  WS.OPEN = 1; WS.CONNECTING = 0; WS.CLOSING = 2; WS.CLOSED = 3;
  const ctx = {
    console: { warn() {}, log() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: webcrypto, TextEncoder, TextDecoder, URL, WebSocket: WS, queueMicrotask, Promise,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    TrinityIdentity: { ready: Promise.resolve(), exportMnemonic: async () => MNEMONIC },
    Fellowship: fellowship,
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = (t, f) => { (listeners[t] = listeners[t] || []).push(f); };
  ctx.dispatchEvent = (e) => { (listeners[e.type] || []).forEach(f => f(e)); return true; };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { ctx, dialled };
}
const setMarks = (ctx) => ctx.MyData.backend.putDoc('data/chatseen', [{ id: 'prayer', ts: 1 }]);
const norm = (u) => u.replace(/\/$/, '');

test('the marks are pulled and published over the PROVED set only, never the raw candidate list', async () => {
  const { ctx, dialled } = boot({ relays: [UNPROVED, PROVED], churchRelays: () => [PROVED] });
  await ctx.MyData.ready;
  setMarks(ctx);
  await tick(1200);   // publish is debounced 800ms
  assert.ok(dialled.length > 0, 'nothing was dialled at all - the harness is not exercising the code');
  assert.ok(dialled.every(u => norm(u) === PROVED), 'dialled an unproved relay: ' + dialled.join(', '));
});

test('with NOTHING proved yet: nothing is dialled, nothing throws, local stays authoritative', async () => {
  const { ctx, dialled } = boot({ relays: [UNPROVED], churchRelays: () => [] });
  assert.equal(await ctx.MyData.ready, true, 'sync should report started (identity exists), not fail');
  assert.doesNotThrow(() => setMarks(ctx));
  await tick(1200);
  assert.deepEqual(dialled, [], 'dialled with no proved relay: ' + dialled.join(', '));
  assert.equal(JSON.stringify(ctx.MyData.backend.getDoc('data/chatseen')), JSON.stringify([{ id: 'prayer', ts: 1 }]), 'the local copy was lost');
});

test('a Fellowship without churchRelays does not fall back to localhost or to the raw list', async () => {
  const { ctx, dialled } = boot({ relays: [UNPROVED] });
  await ctx.MyData.ready;
  setMarks(ctx);
  await tick(1200);
  assert.deepEqual(dialled, [], 'fell back to ' + dialled.join(', '));
});

test('a sync skipped for want of a proved relay re-runs when relays are verified', async () => {
  let proved = [];
  const { ctx, dialled } = boot({ relays: [UNPROVED], churchRelays: () => proved });
  await ctx.MyData.ready;
  assert.deepEqual(dialled, []);
  proved = [PROVED];
  ctx.dispatchEvent(new ctx.CustomEvent('trinity-relays-verified'));
  await tick(200);
  assert.ok(dialled.length > 0 && dialled.every(u => norm(u) === PROVED), 'did not sync once a relay proved itself: ' + dialled.join(','));
});

test('the Fellowship bundle actually exposes the gated accessor mydata asks for', () => {
  // vendor/*.js is bundler output (dead code is removed), so a text match here is honest (rule 3).
  const at = FELLOW_BUNDLE.indexOf('window.Fellowship = {');
  assert.notEqual(at, -1);
  assert.match(FELLOW_BUNDLE.slice(at, at + 6000), /\n\s*churchRelays,\n/, 'Fellowship.churchRelays is not exported - mydata would sync nowhere');
});
