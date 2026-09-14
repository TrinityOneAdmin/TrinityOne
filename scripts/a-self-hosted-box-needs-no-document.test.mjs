// A CHURCH'S OWN BOX IS ADMITTED WITHOUT ANY RELAY-NET DOCUMENT, AND THE RECORD MUST KEEP SAYING SO.
// Run: node --test scripts/a-self-hosted-box-needs-no-document.test.mjs
//
// Audit item 17, 2026-09-14. src/steward.src.js carried a comment calling `enrolRelayNet`'s zero call sites
// a "DEPLOYMENT BLOCKER … its members would find no relay they may publish to". Checked against the gate
// rather than against the comment: FALSE. `proveRelay` ends with `root: 'software'` — anything that proves
// it holds a relay identity key is admitted — so a self-hosting church's box is admitted with no document
// in existence, and root 3 (`church`) is inert because nobody authors one.
//
// That matters in two directions and this file pins both:
//  · nobody is cut off today, so the comment claiming otherwise was scaring the next reader off a change;
//  · but "admitted on proof alone" is the whole of what protects a self-hosting church, so if that last
//    line ever narrows, this test is where it is noticed — not a document nobody reads.
//
// ⚠ THE SHIPPED GATE IS LIFTED OUT OF vendor/steward.js AND RUN, with the identity proof stubbed and every
// decision left to the shipped code. Reading src/*.src.js would prove nothing about what ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CHURCH_BOX = 'wss://falgate.example.ts.net/relay';
const PROVEN = 'a1'.repeat(32);

function gate({ entries = [], origin = { protocol: 'https:', host: 'console.example' }, pins = {} } = {}) {
  const src = [
    stmt(SHIP, 'var _isHex64 =', '_isHex64'),
    fnBody(SHIP, 'async function proveRelay(cp, url, deps)', 'proveRelay'),
  ].join('\n');
  const deps = {
    verify: async () => ({ relayPub: PROVEN }),
    origin, pins,
    netEntries: async () => entries,
  };
  const scope = {
    isSharedAddress: () => false, sharedRelayKeys: () => [], canonicalPinsFor: () => [],
    sameOriginRelay: () => false,
    String, JSON, Array, Object, Boolean, Number, Math, Promise, console, RegExp,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped gate needs a stub for ' + String(k)); },
  });
  const fn = new Function('scope', 'with (scope) { ' + src + '\nreturn proveRelay; }')(proxy);
  return (cp, url) => fn(cp, url, deps);
}

test('a church’s OWN BOX is admitted with no relay-net document at all', async () => {
  const prove = gate({ entries: [] });          // no document has ever been authored — the real world today
  const r = await prove('c'.repeat(64), CHURCH_BOX);
  assert.equal(r.root, 'software',
    'A SELF-HOSTING CHURCH’S BOX IS NO LONGER ADMITTED ON PROOF ALONE. Every church running its own relay ' +
    'that has not authored a relay-net document — which is all of them, because nothing authors one — would ' +
    'find no relay it may publish to. Got: ' + JSON.stringify(r));
  assert.equal(r.pub, PROVEN, 'the admission recorded the wrong key');
});

test('…and a document, when one exists, admits it one root EARLIER', async () => {
  // Root 3. Not a widening — the same box is admitted either way; the document just records WHY.
  const prove = gate({ entries: [{ pubkey: PROVEN }] });
  const r = await prove('c'.repeat(64), CHURCH_BOX);
  assert.equal(r.root, 'church', 'a box the church has signed for is no longer recognised as such');
});

test('a box that proves NOTHING is refused, document or no document', async () => {
  // The floor. If this ever passes, "admitted on proof alone" has become "admitted".
  const src = fnBody(SHIP, 'async function proveRelay(cp, url, deps)', 'proveRelay');
  const prove = gate({ entries: [{ pubkey: PROVEN }] });
  const noProof = (cp, url) => new Function('scope', 'with (scope) { ' + stmt(SHIP, 'var _isHex64 =', '_isHex64') + '\n' + src + '\nreturn proveRelay; }')(
    new Proxy({ isSharedAddress: () => false, sharedRelayKeys: () => [], canonicalPinsFor: () => [], sameOriginRelay: () => false,
      String, JSON, Array, Object, Boolean, Number, Math, Promise, console, RegExp }, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('stub ' + String(k)); },
    }))(cp, url, { verify: async () => null, origin: {}, pins: {}, netEntries: async () => [{ pubkey: PROVEN }] });
  const r = await noProof('c'.repeat(64), CHURCH_BOX);
  assert.equal(r.root, '', 'a box that proved no relay key was admitted: ' + JSON.stringify(r));
  assert.ok(!r.pub, 'and it was recorded with a pubkey');
});
