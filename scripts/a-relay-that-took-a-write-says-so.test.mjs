// WHICH RELAY TOOK THE WRITE - the engine half of "a refusal ends when that relay accepts".
// Run: node --test scripts/a-relay-that-took-a-write-says-so.test.mjs
//
// The console clears a relay's "Refused our last change" when the engine says THAT relay acknowledged a write
// (steward-relay-accepted, detail.url). publish() uses Promise.any, which only says "some relay did", so the
// per-relay fact has to be raised where each acknowledgement is seen. This runs the three shipped publish
// functions out of vendor/steward.js (the bundle the console loads - not src/) against a fake pool and reads
// the events they raise. The Relays-page half is in relay-refusal-banner-and-retry-stay-together.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const A = 'wss://a.example/relay', B = 'wss://b.example/relay', C = 'wss://c.example/relay';
const EVT = { kind: 30078, created_at: 1, tags: [['d', 'x']], id: 'e1' };

// answers: url -> 'ok' | 'refuse:<words>' | 'unreachable'
function run(answers) {
  const events = [];
  const urls = Object.keys(answers);
  const pool = {
    publish: (targets) => targets.map(u => {
      const a = answers[u];
      if (a === 'ok') return Promise.resolve('');
      if (a === 'unreachable') return Promise.resolve('connection failure: connection timed out');
      return Promise.reject(new Error(a.slice(7)));
    }),
    relays: new Map(),
  };
  const scope = {
    pool, relays: () => urls, relaysRaw: () => urls, _connectedRelays: () => urls, NO_NETWORK_RELAY: 'no-network-relay',
    _waitForRegistration: async () => {}, _lastOk: new Map(), _noteSpread() {},
    window: { dispatchEvent: (e) => { events.push(e); } },
    CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    console: { warn() {}, log() {} }, Promise, Error, Map, Set, String, Array, Date, setTimeout, clearTimeout,
  };
  const names = Object.keys(scope);
  const src = fnBody(SHIP, 'async function publish(evt, opts)', 'publish') + '\n'
    + fnBody(SHIP, 'async function _publishToRelays(evt, urls)', '_publishToRelays') + '\n'
    + fnBody(SHIP, 'async function _guardTryOn(urls, ev)', '_guardTryOn')
    + '\nreturn { publish, _publishToRelays, _guardTryOn };';
  const fns = new Function(...names, src)(...names.map(k => scope[k]));
  const accepted = () => events.filter(e => e.type === 'steward-relay-accepted').map(e => e.detail.url).sort();
  return { fns, accepted, events, urls };
}

const PATHS = [
  ['publish', (r) => r.fns.publish(EVT)],
  ['_publishToRelays', (r) => r.fns._publishToRelays(EVT, r.urls)],
  ['_guardTryOn', (r) => r.fns._guardTryOn(r.urls, EVT)],
];

for (const [name, go] of PATHS) {
  test(name + ': names exactly the relays that acknowledged - not the refusing one, not the unreachable one', async () => {
    const r = run({ [A]: 'ok', [B]: 'refuse:blocked: not a member', [C]: 'unreachable' });
    await go(r);
    assert.deepEqual(r.accepted(), [A],
      name + ' raised steward-relay-accepted for ' + JSON.stringify(r.accepted()) + ', expected only ' + A);
  });
  test(name + ': when every relay accepts, every one is named', async () => {
    const r = run({ [A]: 'ok', [B]: 'ok' });
    await go(r);
    assert.deepEqual(r.accepted(), [A, B]);
  });
  test(name + ': when none accepts, none is named', async () => {
    const r = run({ [A]: 'refuse:blocked: nope', [B]: 'unreachable' });
    await go(r);
    assert.deepEqual(r.accepted(), []);
  });
}
