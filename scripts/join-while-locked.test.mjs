// A join that was never attempted must never be described as sent — and a join attempted with no key must
// not be lost. Run: node --test scripts/join-while-locked.test.mjs
//
// Device pass 2026-09-06 (reference: /mnt/storage/tmp/trinity-scratch/round3/AUTH-DIAGNOSIS.md). A PIN-locked
// phone opened a church's follow link. announceMembership returned at `if (!sk) return;` BEFORE its "queue
// first, then attempt" block, so nothing was queued, nothing was sent, nothing ever retried — and the pending
// screen, which read "sent" from `!joinQueued && !joinFailed`, told the person their request had been sent.
// Reproduced identically in headless desktop Chromium; the PIN was the whole difference.
//
// These tests drive the SHIPPED bundle (vendor/fellowship.js), lifted by name under a scope proxy that throws
// on any identifier it was not given — a mirror of the function would pass its own sabotage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey, verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CP = getPublicKey(generateSecretKey());   // the church
const CP_NPUB = npubEncode(CP);

// A localStorage that is a Map, so the tests can read back exactly what the engine persisted.
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i], _m: m };
}

// Lift the join machinery out of the bundle: the four joinsent helpers, the intent helpers if present, and the
// three Fellowship methods, all closing over ONE scope so `_joinSent`, `pub`, `sk` and `_outbox` are shared.
function lift(overrides = {}) {
  const events = [];
  const published = [];
  const scope = {
    sk: null, pub: null, NET: 'trinityone', JOINSENT_KEY: 'trinityone.joinsent',
    // esbuild gives fellowship's nostr import the suffixed name; both are the real signer
    finalizeEvent, finalizeEvent2: finalizeEvent,
    _joinSent: {}, _outbox: [], _outboxFailed: [], _outboxSave: () => {},
    _publishAny: async (relays, evt) => { published.push(evt); if (scope.refuse) throw new Error(scope.refuse); return true; },
    toPub: (x) => (/^[0-9a-f]{64}$/.test(x) ? x : (x === CP_NPUB ? CP : null)),
    localStorage: fakeStorage(),
    window: { Fellowship: { relays: ['ws://x'], ready: Promise.resolve() }, TrinityIdentity: { lockedNpub: () => '' },
      dispatchEvent: (e) => { events.push(e.type); return true; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    console: { warn: () => {}, error: () => {}, log: () => {} },
    ...overrides,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined; throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const helpers = ['function _joinSentSave', 'function _markJoinSent', 'function _clearJoinSent', 'function _joinSentFor']
    .map(a => fnBody(VENDOR, a, a)).join('\n');
  // Full signatures as anchors: a bare 'joinSent' matches `let _joinSent = {}` first and lifts an assignment.
  const methods = ['async announceMembership(npubOrHex)', 'async leaveMembership(npubOrHex)', '  joinSent(npubOrHex)'].map(a => fnBody(VENDOR, a, a.trim())).join(',\n');
  const api = new Function('scope', `with (scope) { ${helpers}\n const api = { ${methods} }; return api; }`)(proxy);
  return { api, scope, events, published };
}

const withKey = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

test('"sent" is recorded when — and only when — a relay accepted the announce', async () => {
  const { api, scope, published } = lift(withKey());
  assert.equal(api.joinSent(CP_NPUB), false, 'nothing has been sent yet, and joinSent already says it has');
  const evt = await api.announceMembership(CP_NPUB);
  assert.ok(evt && verifyEvent(evt), 'the announce did not resolve to a signed event');
  assert.equal(published.length, 1);
  assert.equal(api.joinSent(CP_NPUB), true, 'the relay accepted the announce and joinSent does not know');
  const stored = JSON.parse(scope.localStorage.getItem('trinityone.joinsent'));
  assert.deepEqual(stored[CP], { id: evt.id, at: evt.created_at, pub: scope.pub }, 'the stamp is not persisted, so it dies with the app');
  assert.equal(scope._outbox.length, 0, 'a successful announce is still sitting in the outbox');
});

test('a refused announce is NOT recorded as sent (it is queued, which is a different claim)', async () => {
  const { api, scope } = lift({ ...withKey(), refuse: 'connection failure' });
  const r = await api.announceMembership(CP_NPUB);
  assert.equal(r, null);
  assert.equal(api.joinSent(CP_NPUB), false, 'a publish that landed nowhere was stamped as sent');
  assert.equal(scope._outbox.length, 1, 'the refused announce was not kept for retry');
  assert.equal(scope.localStorage.getItem('trinityone.joinsent'), null);
});

test('the stamp belongs to the identity that sent it — a restored identity does not inherit "sent"', async () => {
  const first = withKey();
  const { api, scope } = lift(first);
  await api.announceMembership(CP_NPUB);
  assert.equal(api.joinSent(CP_NPUB), true);
  const second = withKey();
  scope.sk = second.sk; scope.pub = second.pub;   // a 12-word restore on the same device
  assert.equal(api.joinSent(CP_NPUB), false, 'a different identity on the same device reads the previous person\'s join as its own');
});

test('leaving the church clears the stamp, so a re-follow starts from "not yet asked"', async () => {
  const { api } = lift(withKey());
  await api.announceMembership(CP_NPUB);
  assert.equal(api.joinSent(CP_NPUB), true);
  const left = await api.leaveMembership(CP_NPUB);
  assert.ok(left, 'leaveMembership did not tombstone');
  assert.equal(api.joinSent(CP_NPUB), false, 'they left, and the app still says their request to join was sent');
});

test('the screens are told when the fact changes', async () => {
  const { api, events } = lift(withKey());
  await api.announceMembership(CP_NPUB);
  assert.ok(events.includes('trinity-join-state'), 'nothing re-renders the pending copy when the stamp lands; the screen keeps saying "not sent" over a join that just did');
});
