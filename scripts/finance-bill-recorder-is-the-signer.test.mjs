// THE BILL RECORDER IS THE SIGNER, NOT A FORGEABLE BODY FIELD (finance-audit-2026-11-02 #1).
// Run: node --test scripts/finance-bill-recorder-is-the-signer.test.mjs
//
// Shared-code half of the fix. Two pure assertions, no relay, no browser:
//   1. The SHIPPED encSubscribe (lifted from vendor/steward.js, the rebuilt bundle) surfaces `_by` = the event's
//      RELAY-AUTHENTICATED author (e.pubkey), carried from the event the relay admitted — NEVER the sealed body.
//      Even when the ciphertext itself contains a `by` (and even a `_by`) naming someone else, the emitted doc's
//      `_by` is the signer. This is the value the dual-control recorder rests on.
//   2. The SHIPPED finItemToDoc (lifted from app/stew-finance.jsx) reads the bill recorder from `_by` when it is
//      present (the relay path), falling back to the in-body `by` only when `_by` is absent (local/no-relay mode).
//
// Delete the `_by` surfacing in encSubscribe, or revert finItemToDoc to read `it.by`, and these fail. The
// point-of-use half (the rendered Approve/Mark-paid controls) is in finance-bills-ui.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FIN = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');
const NET = 'trinityone';
const cp = 'c'.repeat(64);                       // the church pubkey this console acts for
const SIGNER = 'a'.repeat(64);                   // who actually SIGNED the bill doc (the real recorder)
const FORGED = 'b'.repeat(64);                   // who the sealed body LIES that the recorder is

const KEY = Array.from(webcrypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));

// Drive the SHIPPED encSubscribe + encOpen with a fake relay pool (mirrors ledgerReader in delegated-finance.test.mjs),
// the ring already holding the key so every delivery decrypts immediately.
function reader() {
  const emitted = [];
  let onevent = null, oneose = null;
  const state = { finance: { ring: [KEY], docKeys: null, rev: 1, at: 0, checked: true } };
  const waiters = { finance: new Set() };
  const stubs = {
    _capState: state, _capWaiters: waiters,
    _capRingChanged: (k) => { for (const fn of waiters[k] || []) fn(); },
    actingChurch: cp, pub: cp, _careRoster: new Set(),
    relays: () => ['ws://x'], NET,
    pool: { subscribeMany: (_r, _f, h) => { onevent = h.onevent; oneose = h.oneose; return { close() {} }; } },
    nip44d: (c, k) => nip44.decrypt(c, k), _unhex: unhex,
    decrypt: (c, k) => nip44.decrypt(c, k),
    churchSkHeld: () => false,
    _encOpenSealedCopy: () => null,
    CAP_KEYS: { finance: { d: 'trinityone/financekey:', cap: 'finance', legacy: true } },
    window: { Steward: {} },
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b];
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', `with (scope) { return { ${[['encSubscribe(prefix, cb, kind)', 'encSubscribe'], ['encOpen(kind', 'encOpen']].map(([s, n]) => fnBody(VENDOR, s, n)).join(',\n')} }; }`)(scope);
  Object.assign(stubs.window.Steward, api);
  // subscribe with the SAME prefix the console uses ('finance/') so the emitted id is 'bill:<id>' (finItemToDoc's shape).
  const off = api.encSubscribe('finance/', (items) => emitted.push(items), 'finance');
  // deliver a bill event: SIGNED by `pubkey`, its sealed body carrying whatever `body` says (including a lying `by`).
  const deliver = (pubkey, id, body) => onevent({ pubkey, created_at: 1787280000, content: nip44.encrypt(JSON.stringify(body), unhex(KEY)), tags: [['d', 'finance/bill:' + id]] });
  return { off, emitted, deliver, eose: () => oneose(), last: () => emitted[emitted.length - 1] || [] };
}

test('encSubscribe surfaces `_by` = the SIGNER (e.pubkey), never the sealed body — even when the body forges it', () => {
  const r = reader();
  // the body lies: it names FORGED as the recorder, and even tries to smuggle its own `_by`.
  r.deliver(SIGNER, 'b1', { number: 'INV-1', supplier: 'British Gas', by: FORGED, _by: FORGED });
  r.eose();
  const doc = r.last().find(x => x.id === 'bill:b1');
  assert.ok(doc, 'the bill doc was not emitted');
  assert.equal(doc._by, SIGNER, '`_by` must be the authenticated SIGNER (e.pubkey), not the forged body field — delete the _by surfacing and this fails');
  assert.notEqual(doc._by, FORGED, 'the smuggled body `_by` must NOT win: `_by` is placed after ...obj so the signer overrides it');
  assert.equal(doc.by, FORGED, 'the in-body `by` is still carried verbatim (unchanged) — only `_by` is authoritative for the recorder');
  r.off();
});

// The SHIPPED finItemToDoc, lifted pure (it references only its `it` argument).
const finItemToDoc = new Function('it', `${fnBody(FIN, 'function finItemToDoc(it)', 'finItemToDoc')}\nreturn finItemToDoc(it);`);

test('finItemToDoc reads the bill recorder from the authenticated `_by`, not the forgeable body `by`', () => {
  // relay path: both present and disagreeing → the recorder is the signer.
  const relay = finItemToDoc({ id: 'bill:b1', number: 'INV-1', by: FORGED, _by: SIGNER });
  assert.equal(relay.t, 'bill');
  assert.equal(relay.by, SIGNER, 'the recorder must come from `_by` (the signer), not the forged body `by`');
  // local/no-relay path: `_by` absent → fall back to the in-body `by` (the single local user is both parties).
  const local = finItemToDoc({ id: 'bill:b1', number: 'INV-1', by: FORGED });
  assert.equal(local.by, FORGED, 'with no `_by` (local mode) the recorder falls back to the in-body `by`');
});
