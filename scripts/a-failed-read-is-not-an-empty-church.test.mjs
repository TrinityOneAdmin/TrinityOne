// A FAILED READ MUST NOT REPORT A COMPLETED READ OF AN EMPTY CHURCH — B0 of
// reference/PLAN-ENROLMENT-GAP-2026-09-02.md.
// Run: node --test scripts/a-failed-read-is-not-an-empty-church.test.mjs
//
// `_oneComplete` is the reader that fetches a church's own signed membership document. If it says
// "complete" when nobody actually answered, `enrolRelayNet` rebuilds that document FROM SCRATCH with
// created_at: now(), and newest-wins UN-ADMITS EVERY BOX THE CHURCH HAD SIGNED, on every member's phone.
// The trigger is nothing exotic — a relay being down at boot, which the documented a8 update blip is.
//
// ⚠ THIS TEST DRIVES REAL SOCKETS, AND THAT IS THE WHOLE POINT OF IT.
// The plan records why 22 green tests never saw B0: `consoleWith` INJECTS `_oneComplete` as `deps.one`, so
// the suite proves enrolment honours the flag it is GIVEN, never that the reader computes it honestly —
// the `injected-outcomes-cannot-catch-a-dead-classifier` shape. So there is a real ws server here that
// accepts the REQ and never sends EOSE, and a genuinely dead port. No stubs, no injected flags.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { fnBody } from './test-slice.mjs';
import { requireFreePort } from './test-ports.mjs';

const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const SILENT_PORT = 8971;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const DEAD_PORT = 8972;     // deliberately NEVER bound — this is the unreachable relay
await requireFreePort(SILENT_PORT, 'a-failed-read-is-not-an-empty-church.test.mjs (the silent relay)');

// A relay that ACCEPTS the subscription and then says nothing, for ever. This is the case that matters:
// a dead port is obvious, a socket that opens and stalls is what a struggling box actually does.
const wss = new WebSocketServer({ port: SILENT_PORT });
wss.on('connection', () => { /* deliberately never answers a REQ — no EVENT, no EOSE */ });
after(() => { try { wss.close(); } catch {} });

// The shipped reader, lifted, over a REAL pool.
function reader(urls) {
  const pool = new SimplePool();
  const scope = { pool, relaysRaw: () => urls, setTimeout, clearTimeout, Promise, Math, console };
  const fn = new Function('scope', 'with (scope) {' +
    // ⚠ `6e3`, NOT `6000` — esbuild rewrites the numeric literal. Anchoring on the source spelling made
    // every test here fail with "_oneComplete is missing", which reads exactly like the function having been
    // deleted. Slice the BUNDLE by what the bundle says.
    fnBody(SHIP, 'function _oneComplete(filters, ms = 6e3) {', '_oneComplete') +
    '\nreturn _oneComplete; }')(new Proxy(scope, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
        throw new ReferenceError('the shipped reader needs a stub for ' + String(k)); },
    }));
  return { fn, close: () => { try { pool.close(urls); } catch {} } };
}
const FILTER = [{ kinds: [30078], authors: ['a'.repeat(64)], '#d': ['trinityone/relaynet'] }];

test('A SOCKET THAT OPENS AND NEVER ANSWERS IS NOT A COMPLETED READ', { timeout: 30000 }, async () => {
  // THE EXACT B0 MEASUREMENT. Before `maxWait`, nostr-tools' own EOSE timer (baseEoseTimeout 4400ms) fired
  // inside this function's 6000ms bound and reported complete:true at ~4421ms on a socket that had said
  // nothing at all. With maxWait the library's timer is pushed past our bound, so our own timeout wins and
  // reports the truth.
  // ⚠ THE DEFAULT BOUND, NOT A SHORT ONE, AND THAT IS THE WHOLE TEST. B0 only manifests when this
  // function's own timeout is LONGER than the library's EOSE timer (baseEoseTimeout 4400ms) — at the
  // shipped default of 6000ms it is. My first version passed ms=2000, so our own timeout won at 2000ms and
  // reported the truth with or without the fix: the sabotage row came back "nothing failed", which is how
  // a blind test announces itself. Call it exactly as relayNetDoc() does — with no ms at all.
  const r = reader(['ws://127.0.0.1:' + SILENT_PORT + '/']);
  const t0 = Date.now();
  const { ev, complete } = await r.fn(FILTER);
  const took = Date.now() - t0;
  r.close();
  assert.equal(ev, null, 're-anchor: the silent relay somehow produced an event');
  assert.equal(complete, false,
    'A READ THAT NOBODY ANSWERED REPORTED ITSELF COMPLETE (after ' + took + 'ms). enrolRelayNet reads this ' +
    'as "the church has no membership document", rebuilds one from scratch, and newest-wins un-admits every ' +
    'relay the church had signed — on every member\'s phone.');
  assert.ok(took >= 5900,
    'it resolved in ' + took + 'ms, well before the 6000ms bound — the library\'s own EOSE timer answered ' +
    'for a relay that never did, which IS B0');
});

test('…and the church document is never treated as absent on that basis', { timeout: 30000 }, async () => {
  // The property stated the way enrolment consumes it: `!complete` is the guard that must stop a
  // from-scratch rebuild. This is that guard's input, driven for real.
  const r = reader(['ws://127.0.0.1:' + SILENT_PORT + '/']);
  const { ev, complete } = await r.fn(FILTER);   // the default bound, for the reason in the test above
  r.close();
  const wouldRebuildFromScratch = !ev && complete;
  assert.equal(wouldRebuildFromScratch, false,
    'THIS IS THE DOC-WIPE CHAIN, ARMED: no event AND complete:true means enrolment builds the membership ' +
    'document from nothing and publishes it with created_at: now().');
});

test('A DEAD PORT IS THE RESIDUAL — measured, named, and NOT yet fixed', { timeout: 30000 }, async () => {
  // ⚠ THIS TEST RECORDS A KNOWN GAP RATHER THAN ASSERTING IT IS CLOSED, and that is deliberate honesty.
  // B0 step 2 says maxWait alone is NOT sufficient: an unreachable relay still counts as finished, because
  // `complete` means "every relay I could reach finished" — which is not the question enrolment asks.
  // Steps 2-3 (count how many relays GENUINELY answered; refuse the from-scratch path unless at least one
  // did) are still open. When they land, flip this assertion to `false` and delete this comment.
  const r = reader(['ws://127.0.0.1:' + DEAD_PORT + '/']);
  const { ev, complete } = await r.fn(FILTER, 1500);
  r.close();
  assert.equal(ev, null, 're-anchor: a port nothing is listening on produced an event');
  assert.equal(complete, true,
    'THE DEAD-PORT RESIDUAL HAS CHANGED. If it now reports false, B0 steps 2-3 have effectively landed — ' +
    'update this test and the plan. If it reports something else, measure before trusting either.');
});

test('a relay that DOES answer still reports complete, so the fix is not a blanket "never complete"', { timeout: 30000 }, async () => {
  // Re-anchor. A guard that always says "incomplete" would block enrolment for ever and look identical to
  // a fix from the outside.
  const port = 8973;
  await requireFreePort(port, 'a-failed-read-is-not-an-empty-church.test.mjs (the answering relay)');
  const ok = new WebSocketServer({ port });
  ok.on('connection', (s) => {
    s.on('message', (d) => { const m = JSON.parse(d); if (m[0] === 'REQ') s.send(JSON.stringify(['EOSE', m[1]])); });
  });
  try {
    const r = reader(['ws://127.0.0.1:' + port + '/']);
    const { complete } = await r.fn(FILTER, 4000);
    r.close();
    assert.equal(complete, true,
      'A RELAY THAT SENT A REAL EOSE WAS RECORDED AS INCOMPLETE — enrolment would never run at all.');
  } finally { try { ok.close(); } catch {} }
});
