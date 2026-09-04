// A BRAND-NEW CHURCH MUST NOT BE PERMANENTLY POINTED AWAY FROM THE BOX THAT MADE IT.
// Run: node --test scripts/a-new-church-is-not-orphaned-from-its-own-box.test.mjs
//
// Measured 2026-09-04, staging a church on a self-hosted console (SESSION-2026-09-04-END-TO-END.md, F3).
// The console published NOTHING for its whole setup — no name, no groups, no meetings — because it had
// already decided its own box was not its relay.
//
// THE SEQUENCE, and every step of it is deliberate on its own:
//   1. "Start a new church" calls createKey() -> setKey(), and setKey fires _refreshBoxHostsUs() at once.
//   2. Registration is deliberately deferred until the church has a NAME: a nameless self-registration is
//      refused on purpose (gateway H4 — one box collected 37 anonymous rows).
//   3. So the probe asks "does this box host us?" about a church that exists on no relay anywhere, gets an
//      honest "no", and writes it down.
//   4. `_boxHostsUs === false` makes ownRelay() return CANONICAL_RELAY, which makes _refreshBoxHostsUs
//      return early at its own first line — so the question can never be asked again. Permanent.
//
// Nothing in the product rewrites that key. I proved the trap by registering the church on the box for
// real and watching the console still refuse it; only clearing localStorage by hand recovered it.
//
// This drives the SHIPPED console bundle (vendor/steward.js), and it lifts the REAL _everSelfRegistered —
// stubbing that would be stubbing the decision this test is named after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function lift(anchor, name, stubs) {
  const body = fnBody(VENDOR, anchor, name);
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('scope', `with (scope) { return (${body}); }`)(scope);
}

const CANON = 'wss://app.trinityone.church/relay';

// One scope shared by both lifted functions, so _refreshBoxHostsUs calls the REAL _everSelfRegistered
// against the REAL store — the point of this test is which of those two decides.
function harness({ selfreg, hostedChurches }) {
  const store = new Map();
  if (selfreg) store.set('sr', JSON.stringify(selfreg));
  const stubs = {
    pub: 'PUB',
    SELFREG_KEY: 'sr',
    _boxHostsUs: null,
    lsGet: (k) => (store.has(k) ? store.get(k) : null),
    lsSet: (k, v) => store.set(k, v),
    _boxHostsKey: () => 'bh',
    CANONICAL_RELAY: CANON,
    ownRelay: () => 'ws://127.0.0.1:8000/relay',   // the console IS served by a relay
    localAdminToken: async () => 'tok',
    _authHdr: () => ({}),
    npubEncode: (p) => 'npub_' + p,
    fetch: async () => ({ ok: true, json: async () => ({ churches: hostedChurches }) }),
  };
  // Lift the REAL _everSelfRegistered when the bundle has it — stubbing it would stub the decision this
  // test is named after. When it is ABSENT (i.e. the pre-fix bundle) fall back to an inert stub, because
  // the old code never calls it: that lets the BEHAVIOUR assertion below fire instead of the harness
  // exploding on a missing anchor, which is the difference between proving a regression and proving a
  // rename. Verified both ways on 2026-09-04.
  stubs._everSelfRegistered = VENDOR.includes('function _everSelfRegistered()')
    ? lift('function _everSelfRegistered() {', '_everSelfRegistered', stubs)
    : () => false;
  const refresh = lift('async function _refreshBoxHostsUs() {', '_refreshBoxHostsUs', stubs);
  return { store, stubs, refresh };
}

test('THE REGRESSION: a church that exists on no relay yet is left UNKNOWN, not written off', async () => {
  const h = harness({ selfreg: null, hostedChurches: [] });   // never registered anywhere; box says "not mine"
  await h.refresh();
  assert.equal(h.store.get('bh'), undefined,
    'the console cached "this box is not ours" about a church that is seconds old and registered nowhere. ' +
    'That answer is permanent: it makes ownRelay() return the community pool, which makes this very ' +
    'function return early for ever, so a self-hosting church can never be pointed back at its own box.');
  assert.equal(h.stubs._boxHostsUs, null,
    'left as a verdict in memory rather than "not yet" — ownRelay() consults this on the next call');
});

test('CONTROL: a church that HAS registered somewhere still gets a real "no" recorded', async () => {
  const h = harness({ selfreg: { 'PUB@https://elsewhere.example': 1 }, hostedChurches: [] });
  await h.refresh();
  assert.equal(h.store.get('bh'), '0',
    'the fix must not blind the probe permanently — once the church exists on a relay, a box saying ' +
    '"not mine" is a real answer and must still be believed');
  assert.equal(h.stubs._boxHostsUs, false);
});

test('CONTROL: a box that DOES host the church records yes, registered or not', async () => {
  const h = harness({ selfreg: null, hostedChurches: [{ npub: 'npub_PUB' }] });
  await h.refresh();
  assert.equal(h.store.get('bh'), '1');
  assert.equal(h.stubs._boxHostsUs, true);
});

// FIX B, the other end of the same bug: a successful registration is new information about where this
// church lives, so the cached answer must be dropped and re-asked. Asserted against the BUNDLE, where
// esbuild strips dead code — so a match here means the line is reachable, not merely present.
test('a successful self-registration re-asks whether this box holds the church', () => {
  const body = fnBody(VENDOR, 'async selfRegister(name, opts) {', 'selfRegister');
  assert.ok(body.length > 400, 'selfRegister sliced to a stub — re-anchor rather than widening');
  assert.match(body, /if\s*\(accepted\)\s*\{[\s\S]{0,240}removeItem\(\s*_boxHostsKey\(\)\s*\)/,
    'selfRegister succeeded and left the stale "this box is not ours" answer in place. Nothing else ever ' +
    'rewrites that key, and ownRelay() cannot revisit it once it is false.');
  assert.match(body, /if\s*\(accepted\)\s*\{[\s\S]{0,320}_refreshBoxHostsUs\(\)/,
    'the answer was dropped but never re-asked, so the box stays out of the list until the next reload');
});
