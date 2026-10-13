// The unread marks (chatseen) sync only to relays that PROVED they run our software.
// Run: node --test scripts/unread-marks-sync-only-proved-relays.test.mjs
//
// RELAY-ADMISSION.md / CLAUDE.md rule 10. src/mydata.src.js used the raw candidate list
// (`Fellowship.relays`, plus a hardcoded ws://127.0.0.1:7447 fallback) for BOTH its publish and its subscribe,
// so which rooms a member reads went to relays nobody had proved. It now asks Fellowship.churchOwnProvedRelays() (the church's OWN list, gated).
//
// POINT OF USE: these tests run the SHIPPED bundle (vendor/mydata.js) in a vm with a recording WebSocket, and
// count which addresses it dials. Deleting the fix from src + rebuilding makes them fail; so does deleting it
// from the bundle. They do not read app/*.jsx text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { v2 as nip44 } from 'nostr-tools/nip44';

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
  const { ctx, dialled } = boot({ relays: [UNPROVED, PROVED], churchOwnProvedRelays: () => [PROVED] });
  await ctx.MyData.ready;
  setMarks(ctx);
  await tick(1200);   // publish is debounced 800ms
  assert.ok(dialled.length > 0, 'nothing was dialled at all - the harness is not exercising the code');
  assert.ok(dialled.every(u => norm(u) === PROVED), 'dialled an unproved relay: ' + dialled.join(', '));
});

test('with NOTHING proved yet: nothing is dialled, nothing throws, local stays authoritative', async () => {
  const { ctx, dialled } = boot({ relays: [UNPROVED], churchOwnProvedRelays: () => [] });
  assert.equal(await ctx.MyData.ready, true, 'sync should report started (identity exists), not fail');
  assert.doesNotThrow(() => setMarks(ctx));
  await tick(1200);
  assert.deepEqual(dialled, [], 'dialled with no proved relay: ' + dialled.join(', '));
  assert.equal(JSON.stringify(ctx.MyData.backend.getDoc('data/chatseen')), JSON.stringify([{ id: 'prayer', ts: 1 }]), 'the local copy was lost');
});

test('a Fellowship without the accessor does not fall back to localhost or to the raw list', async () => {
  const { ctx, dialled } = boot({ relays: [UNPROVED] });
  await ctx.MyData.ready;
  setMarks(ctx);
  await tick(1200);
  assert.deepEqual(dialled, [], 'fell back to ' + dialled.join(', '));
});

test('a sync skipped for want of a proved relay re-runs when relays are verified', async () => {
  let proved = [];
  const { ctx, dialled } = boot({ relays: [UNPROVED], churchOwnProvedRelays: () => proved });
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
  // The exported object is ~258KB, so a 6000-char window covered only its start: the accessor could be
  // dropped from the export list further down and this would still pass (scripts/test-windows.test.mjs).
  assert.match(fnBody(FELLOW_BUNDLE, 'window.Fellowship = {'), /\n\s*churchOwnProvedRelays,\n/, 'Fellowship.churchOwnProvedRelays is not exported - mydata would sync nowhere');
});


// ── FIX 1: the church's OWN list, not the shipped canonical addresses ───────────────────────────────────────
test('marks are not dialled at a proved canonical address the church does not list', async () => {
  const CANON = 'wss://canonical.example/relay';
  // churchRelays() (the wide set) would include CANON; the narrow accessor must be the one consulted.
  const { ctx, dialled } = boot({ relays: [PROVED], churchRelays: () => [PROVED, CANON], churchOwnProvedRelays: () => [PROVED] });
  await ctx.MyData.ready;
  setMarks(ctx);
  await tick(1200);
  assert.ok(dialled.length > 0, 'harness dialled nothing');
  assert.ok(!dialled.some(u => norm(u) === CANON), 'dialled a canonical address the church does not list: ' + dialled.join(', '));
});

test('the REAL accessor in the shipped bundle returns the church list and never adds CANONICAL_RELAYS', () => {
  const at = FELLOW_BUNDLE.indexOf('function churchOwnProvedRelays()');
  assert.notEqual(at, -1);
  const end = FELLOW_BUNDLE.indexOf('\n  }', at) + 4;
  const fn = FELLOW_BUNDLE.slice(at, end);
  const CANON = ['wss://canonical.example/relay'];
  const win = { Fellowship: { relays: ['wss://church.example/relay'] } };
  // _netRelays stubbed as identity: this isolates the CANDIDATE set, which is all this fix changes.
  const run = new Function('window', 'CANONICAL_RELAYS', '_netRelays', fn + '\nreturn churchOwnProvedRelays;');
  const got = run(win, CANON, (l) => l)();
  assert.deepEqual(got, ['wss://church.example/relay']);
  win.Fellowship.relays = [];
  assert.deepEqual(run(win, CANON, (l) => l)(), [], 'a church with no list of its own must get nothing, not the canonical pair');
});

// ── FIX 2: a skipped reconcile must not be followed by a destructive write ──────────────────────────────────
// A fake relay that really answers: REQ -> stored events + EOSE; EVENT -> recorded + OK.
function bootRelay(fellowship, stored) {
  let up = true;
  const sent = [];       // EVENT frames the app published
  const dialled = [];
  const listeners = {}, store = new Map();
  class WS {
    constructor(url) {
      dialled.push(String(url)); this.readyState = 0; this.url = url;
      setTimeout(() => {
        if (!up) { try { this.onerror && this.onerror({}); this.onclose && this.onclose({}); } catch (e) {} return; }
        this.readyState = 1; this.onopen && this.onopen({});
      }, 0);
    }
    send(raw) {
      const m = JSON.parse(raw);
      const reply = (x) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(x) }), 0);
      if (m[0] === 'REQ') { stored.forEach(e => reply(['EVENT', m[1], e])); reply(['EOSE', m[1]]); }
      else if (m[0] === 'EVENT') { sent.push(m[1]); reply(['OK', m[1].id, true, '']); }
    }
    close() { this.readyState = 3; } addEventListener() {} removeEventListener() {}
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
  vm.runInContext(BUNDLE, ctx);
  return { ctx, sent, dialled, setUp: (v) => { up = v; } };
}
const sk = privateKeyFromSeedWords(MNEMONIC), pk = getPublicKey(sk), ck = nip44.utils.getConversationKey(sk, pk);
const remoteMap = (settings) => finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000) - 100, tags: [['d', 'trinityone/chatseen']], content: nip44.encrypt(JSON.stringify({ settings }), ck) }, sk);
const settingsOf = (e) => JSON.parse(nip44.decrypt(e.content, ck)).settings;

test('DATA LOSS CLOSED: local empty, boot pull skipped, relay becomes proved with NO event, one room opened -> the relay copy is not replaced by that single room', async () => {
  const remote = { prayer: 9, youth: 8, life: 7 };
  let proved = [];
  const { ctx, sent } = bootRelay({ relays: [PROVED], churchOwnProvedRelays: () => proved }, [remoteMap(remote)]);
  await ctx.MyData.ready;                 // boot pull skipped: nothing proved
  proved = [PROVED];                       // proved later, and (the measured case) no trinity-relays-verified ever fires
  ctx.MyData.backend.putDoc('data/chatseen', { welcome: 5 });   // the shipped shape: screens-chat.jsx writeChatSeen writes an object MAP
  await tick(2500);
  assert.ok(sent.length > 0, 'nothing was published - the harness is not exercising the write path');
  for (const e of sent) {
    const got = settingsOf(e);
    for (const k of Object.keys(remote)) assert.equal(got[k], remote[k], 'published map lost the relay\'s "' + k + '": ' + JSON.stringify(got));
  }
  assert.equal(settingsOf(sent[sent.length - 1]).welcome, 5, 'the new read mark itself was lost');
});

test('relay unreachable at first (the pool still reports EOSE for it): an edit made then must not later replace the relay copy', async () => {
  const remote = { prayer: 9, youth: 8 };
  const { ctx, sent, setUp } = bootRelay({ relays: [PROVED], churchOwnProvedRelays: () => [PROVED] }, [remoteMap(remote)], false);
  setUp(false);
  await ctx.MyData.ready;
  ctx.MyData.backend.putDoc('data/chatseen', { welcome: 5 });
  await tick(1500);
  assert.deepEqual(sent, [], 'published while unreachable?');
  setUp(true);
  await tick(9000);   // let the failed pull's 8s cap lapse so the next edit starts a fresh reconcile
  ctx.MyData.backend.putDoc('data/chatseen', { welcome: 6 });
  await tick(2500);
  assert.ok(sent.length > 0, 'nothing published once the relay came back');
  for (const e of sent) for (const k of Object.keys(remote)) assert.equal(settingsOf(e)[k], remote[k], 'lost "' + k + '" - an offline pull was counted as a reconcile');
});
