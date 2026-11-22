// C1 (PLAN-relay-autoconnect-selfhealing-sync-2026-11-20 §C1, audit finding 15 + re-audit finding 5).
// The console's kind-10002 — the one thing a member phone treats as authoritative over which relays it keeps —
// is built from the CHURCH-WIDE SIGNED relay-net document, not from this device's gated relays(), and it is
// published on every list change (Add and Remove), never over an incomplete relay-net read.
//
// Run: node --test scripts/console-publishes-relaylist-from-the-signed-doc.test.mjs
//
// POINT OF USE (CLAUDE.md rule 1): the SHIPPED vendor/steward.js is sliced and RUN — publishRelayList itself,
// and the signRelay / unsignRelay success paths that fire it. Delete the doc-sourced build and test 1 goes
// red; delete the publishRelayList() call from signRelay/unsignRelay and tests 4/5 go red. Nothing asserts
// behaviour by matching text in app/*.jsx (rule 3). The engine functions are lifted from the BUNDLE, so a
// dead-code revert disappears from the slice rather than lingering as matchable text (rule 3's vendor half).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Only the names the lifted code is allowed to reach; anything else raises a ReferenceError naming it, rather
// than arriving undefined and being swallowed by one of the many try/catch blocks (a silent dead test).
function scopeOf(stubs) {
  return new Proxy(stubs, {
    // trap a name only when it is stubbed OR is not a real global — so built-ins resolve to the genuine global
    // instead of raising (a `has: () => true` traps Boolean/String and a swallowed catch hides the failure).
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

const docOf = (pubkey, entries) => ({ pubkey, content: JSON.stringify(entries) });

// Lift publishRelayList out of the bundle and run it with scripted stubs. `relays` is DELIBERATELY provided and
// wrong (one cold-gate address): the point of finding 15 is that the published set does not come from it.
function runPublish({ ev, covers = true, viewingNetwork = false, actingChurch = false, sk = 'sk', pub = 'CHURCHPUB' }) {
  const body = fnBody(STEWARD, 'async publishRelayList()', 'publishRelayList');
  assert.match(body, /relayNetDoc\(\)/, 'vendor/steward.js: publishRelayList no longer reads the church-wide relay-net doc (finding 15 reverted)');
  assert.doesNotMatch(body, /relays\(\)\.map/, 'vendor/steward.js: publishRelayList is building the 10002 from relays() again (the per-device gated view — finding 15)');
  const published = [];
  const scope = scopeOf({
    sk, pub, actingChurch,
    _viewingNetwork: () => viewingNetwork,
    relayNetDoc: async () => ({ ev, complete: covers, answered: 1, asked: 1, askedUrls: [], answeredUrls: [] }),
    _readCovers: () => covers,
    parseRelayNet: (c) => { try { return JSON.parse(c || '[]'); } catch { return []; } },
    // esbuild dedups the imported finalizeEvent to `finalizeEvent2` in this bundle — provide both spellings so
    // neither can silently go unstubbed (the idiom a-member-learns… uses for decode/nip19decode).
    finalizeEvent: (e) => e, finalizeEvent2: (e) => e,
    _monotonic: (e) => e,
    now: () => 1000,
    relays: () => ['wss://cold-gate-only.example/relay'],   // the wrong source; must NOT appear in the output
    publish: (e) => { published.push(e); return Promise.resolve(e); },
    Promise, Set, JSON,
  });
  const fn = new Function('scope', `with (scope) { const _o = { ${body} }; return _o.publishRelayList(); }`)(scope);
  return Promise.resolve(fn).then((r) => ({ r, published }));
}

const tagUrls = (ev) => (ev.tags || []).filter(t => t[0] === 'r').map(t => t[1]);

test('1. the 10002 is built church-wide from the relay-net doc, excludes url-less entries, and ignores relays()', async () => {
  const ev = docOf('CHURCHPUB', [
    { pubkey: 'k1', url: 'wss://a.example/relay' },
    { pubkey: 'k2', url: 'wss://b.example/relay' },
    { pubkey: 'k3', url: '' },        // url-less: a pubkey with no dialable address — excluded (re-audit finding 5)
    { pubkey: 'k4' },                 // no url field at all — excluded
  ]);
  const { published } = await runPublish({ ev });
  assert.equal(published.length, 1, 'no 10002 was published from a complete doc read');
  const urls = tagUrls(published[0]);
  assert.deepEqual(urls.sort(), ['wss://a.example/relay', 'wss://b.example/relay'], 'the published set is not the doc\'s dialable wss entries');
  assert.ok(!urls.includes('wss://cold-gate-only.example/relay'), 'the published set leaked relays() (the per-device gated view)');
  assert.equal(published[0].kind, 10002);
});

test('2. two consoles reading the SAME signed doc publish the SAME set (device-independent)', async () => {
  const entries = [{ pubkey: 'k1', url: 'wss://a.example/relay' }, { pubkey: 'k2', url: 'wss://b.example/relay' }];
  const A = await runPublish({ ev: docOf('CHURCHPUB', entries), pub: 'CHURCHPUB' });
  // a second console whose gated relays() is cold (stubbed the same wrong way) — same doc, same output
  const B = await runPublish({ ev: docOf('CHURCHPUB', entries), pub: 'CHURCHPUB' });
  assert.deepEqual(tagUrls(A.published[0]).sort(), tagUrls(B.published[0]).sort());
});

test('3. an INCOMPLETE relay-net read publishes nothing (old APKs burn unconditionally from the newest 10002)', async () => {
  const ev = docOf('CHURCHPUB', [{ pubkey: 'k1', url: 'wss://a.example/relay' }]);
  const { r, published } = await runPublish({ ev, covers: false });
  assert.equal(published.length, 0, 'a 10002 was published over a partial relay-net read');
  assert.equal(r, null);
});

test('3b. a network view publishes nothing (the _viewingNetwork guard enrol/unenrol already have)', async () => {
  const ev = docOf('CHURCHPUB', [{ pubkey: 'k1', url: 'wss://a.example/relay' }]);
  const { published } = await runPublish({ ev, viewingNetwork: true });
  assert.equal(published.length, 0, 'a 10002 was published while viewing a network');
});

test('3c. no church document (doc authored by someone else) publishes nothing', async () => {
  const ev = docOf('SOMEONE-ELSE', [{ pubkey: 'k1', url: 'wss://a.example/relay' }]);
  const { published } = await runPublish({ ev });
  assert.equal(published.length, 0);
});

// ── the WIRE from the Relays card into publishRelayList (rule 1: fails if the call is deleted) ─────────────
// signRelay / unsignRelay are lifted whole and run with stubs; window.Steward.publishRelayList is a spy.
function runSign({ enrolResult }) {
  const body = fnBody(STEWARD, 'signRelay(url)', 'signRelay');
  assert.match(body, /publishRelayList\(\)/, 'vendor/steward.js: signRelay no longer publishes a 10002 on a successful Add (C1 wire removed)');
  let calls = 0;
  const scope = scopeOf({
    normRelay: (u) => u,
    enrolSerial: (fn) => Promise.resolve(fn()),
    enrolRelayNet: async () => enrolResult,
    normalizeURL: (u) => u,
    extraRelays: () => [],
    sharedRelayKeys: () => [],   // B2 (2026-11-22): signRelay never clears a shared relay key's tombstone
    _writeTombstone: async () => null,
    autoSyncHeal: () => Promise.resolve(null),
    window: { Steward: { publishRelayList: () => { calls++; return Promise.resolve(null); } } },
    Promise, Set,
  });
  const api = new Function('scope', `with (scope) { const _o = { ${body} }; return _o; }`)(scope);
  return api.signRelay('wss://new.example/relay').then(async () => { await new Promise(r => setTimeout(r, 0)); return calls; });
}

function runUnsign({ removeResult }) {
  const body = fnBody(STEWARD, 'unsignRelay(url)', 'unsignRelay');
  assert.match(body, /publishRelayList\(\)/, 'vendor/steward.js: unsignRelay no longer publishes a 10002 on a successful Remove (C1 wire removed)');
  let calls = 0;
  const scope = scopeOf({
    enrolSerial: (fn) => Promise.resolve(fn()),
    unenrolRelayNet: async () => removeResult,
    window: { Steward: { publishRelayList: () => { calls++; return Promise.resolve(null); } } },
    Promise,
  });
  const api = new Function('scope', `with (scope) { const _o = { ${body} }; return _o; }`)(scope);
  return api.unsignRelay('wss://old.example/relay').then(async () => { await new Promise(r => setTimeout(r, 0)); return calls; });
}

test('4. a successful Add/Connect publishes a 10002; an unknown/failed Add does not', async () => {
  assert.equal(await runSign({ enrolResult: { published: true, proven: [] } }), 1, 'a successful Add did not republish the relay list');
  assert.equal(await runSign({ enrolResult: { unknown: true } }), 0, 'an unknown (incomplete-read) Add published a partial list anyway');
});

test('5. a successful Remove publishes a 10002; a notListed/unknown Remove does not', async () => {
  assert.equal(await runUnsign({ removeResult: { removed: true } }), 1, 'a successful Remove did not republish the relay list');
  assert.equal(await runUnsign({ removeResult: { removed: false, notListed: true } }), 0, 'a Remove that changed nothing still republished');
  assert.equal(await runUnsign({ removeResult: { removed: false, unknown: true } }), 0, 'a Remove over an incomplete read republished anyway');
});
