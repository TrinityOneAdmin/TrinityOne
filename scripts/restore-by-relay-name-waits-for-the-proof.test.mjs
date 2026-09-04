// "MY CHURCH RUNS ITS OWN RELAY" MUST WAIT FOR THE PROOF IT JUST ASKED FOR.
// Run: node --test scripts/restore-by-relay-name-waits-for-the-proof.test.mjs
//
// AUDIT 2026-09-02 #10. The recovery screen resolves a relay NAME to an address, calls addRelay, and then
// searches for the member's church. But addRelay only puts the address in the list — nothing is published
// to it or read from it until the gate has PROVED it belongs to this church, and adding it does not start
// that proof. So the search ran over the gated set, which did not contain the relay yet, found nothing, and
// told the member "No church found" while the address their church had given them sat there unproved.
//
// On a slow link all three of the search's passes fit inside that window, which is why this shows up on 2G
// and not on a desk. The fix is one await on a new `Fellowship.proveRelays`, and this test pins the ORDER:
// the proof has to finish before the search starts, or nothing has changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const IDENT = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// The shipped handler, lifted and run — the order of its awaits is the whole point.
function runTryChurchName({ proveDelayMs = 5 } = {}) {
  const order = [];
  const body = fnBody(IDENT, 'const tryChurchName = async', 'tryChurchName');
  // `cname` is the field's value, read from closure — the handler takes no arguments.
  const fn = new Function('window', 'setRBusy', 'setRErr', 'cname', 'finishRestore',
    body + '\nreturn tryChurchName;')(
    { Fellowship: {
        resolveRelayName: async () => { order.push('resolve'); return { url: 'wss://church.example/relay' }; },
        addRelay: () => { order.push('addRelay'); return true; },
        proveRelays: async () => { order.push('proveRelays:start');
          await new Promise(r => setTimeout(r, proveDelayMs));
          order.push('proveRelays:done'); return ['wss://church.example/relay']; },
      } },
    () => {}, () => {}, 'grace-city',
    // finishRestore IS the search — it is what goes looking for the church over the gated relay set.
    async () => { order.push('search'); },
  );
  return { fn, order };
}

test('CONTROL: the handler resolves the name and adds the relay', async () => {
  const r = runTryChurchName();
  await r.fn().catch(() => {});
  assert.ok(r.order.includes('resolve'), 'the name is no longer resolved — re-anchor this test');
  assert.ok(r.order.includes('addRelay'), 'the relay is no longer added — re-anchor this test');
});

test('THE PROOF FINISHES BEFORE THE SEARCH BEGINS', async () => {
  const r = runTryChurchName({ proveDelayMs: 20 });
  await r.fn().catch(() => {});
  const proveDone = r.order.indexOf('proveRelays:done');
  const searched = r.order.indexOf('search');
  assert.notEqual(proveDone, -1,
    'the relay this member was just handed is never proved, so the search below runs over a gated set that ' +
    'does not contain it and the member is told "No church found"');
  if (searched !== -1) {
    assert.ok(proveDone < searched,
      'the search started before the proof finished (order: ' + r.order.join(' → ') + '). On a slow link ' +
      'every pass lands inside that window, which is exactly the case this fixes');
  }
});

test('proveRelays is on the shipped Fellowship, and never throws', () => {
  assert.match(BUNDLE, /proveRelays\(urls\)/,
    'proveRelays is not in the shipped bundle, so the screen above is calling something that does not exist');
  const i = BUNDLE.indexOf('proveRelays(urls)');
  const body = BUNDLE.slice(i, i + 400);
  assert.match(stripComments(body), /catch/,
    'proveRelays can throw. A recovery screen must not die because a relay was down — the member is already ' +
    'in the worst place the app has');
});
