// A publish must not report success when no relay accepted it.
// Run: node --test scripts/publish-offline.test.mjs
//
// AUDIT 2026-07-26. nostr-tools RESOLVES rather than rejects when a relay is unreachable — it fulfils with a
// STRING like "connection failure: connection timed out" (measured: 3ms to a dead port, 3s to a black hole).
// The app's pattern was `try { await Promise.any(pool.publish(...)); return true } catch { return false }` at
// 29 call sites, so every one of them reported SUCCESS with the radio off:
//   • markSafe told a member they were marked safe AND persisted the ack, so they were never asked again —
//     its own comment calls that the worst failure this feature can have;
//   • a care request replied "your church family knows you asked for help";
//   • the outbox marked the event delivered and dropped it, so the one mechanism built for being offline
//     never ran when offline.
// This drives the REAL _publishAny out of the shipped bundle against genuinely dead endpoints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure';

const B = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const lift = (name) => {
  const at = B.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' is gone from the shipped bundle');
  let d = 0, end = -1;
  for (let i = B.indexOf('{', at); i < B.length; i++) { const c = B[i]; if (c === '{') d++; else if (c === '}' && --d === 0) { end = i + 1; break; } }
  return B.slice(at, end);
};

// _publishAny now also SORTS each relay's answer — accepted, refused-but-talking, or silent — so the stalled-
// uplink detector can tell a dead pipe from a relay that is merely saying no. _classify comes along for the
// ride because it is part of the same decision; _noteSendResult is recorded rather than run, since hanging up
// on sockets is a different file's subject. What that recording buys us is the check at the bottom of this
// file: against a genuinely dead endpoint, the classifier must NOT report a stall.
function realPublishAny(pool, seen) {
  const m = B.match(/_PUB_FAILED = (\/\^\([^;]*?\/i);/);
  assert.ok(m, 'the failure-string pattern is gone');
  const sm = B.match(/_PUB_SILENT = (\/[^;]*?\/i);/);
  assert.ok(sm, 'the silence pattern is gone — a refusal and a dead pipe are being conflated again');
  const src = lift('_classify') + '\n' + lift('_publishAny') + '; return _publishAny;';
  return new Function('pool', '_PUB_FAILED', '_PUB_SILENT', '_noteSendResult', src)(
    pool, new RegExp(m[1].slice(1, -2), 'i'), new RegExp(sm[1].slice(1, -2), 'i'),
    (url, outcome) => { if (seen) seen.push(outcome); });
}

const evt = () => finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'probe' }, generateSecretKey());

test('a refused connection is a FAILURE, not a success', { timeout: 30000 }, async () => {
  const pool = new SimplePool();
  const seen = [];
  const pub = realPublishAny(pool, seen);
  await assert.rejects(() => pub(['wss://127.0.0.1:9/relay'], evt()), /connection failure/i,
    'a dead relay reported success — every "message sent" in the app would be a lie offline');
  // …and a door slammed in our face is not a stalled uplink. A stall is SILENCE. Classifying a refused
  // connection as silence would have an offline phone tearing down and rebuilding every socket in a loop —
  // measured here against a real closed port, not asserted from the shape of the code.
  assert.ok(!seen.includes('silent'),
    'a refused connection is being read as a stalled uplink: ' + JSON.stringify(seen));
  try { pool.close(['wss://127.0.0.1:9/relay']); } catch {}
});

test('an unroutable relay (radio off / dead 2G) is a FAILURE', { timeout: 30000 }, async () => {
  const pool = new SimplePool();
  const pub = realPublishAny(pool);
  await assert.rejects(() => pub(['wss://10.255.255.1/relay'], evt()), /connection/i);
  try { pool.close(['wss://10.255.255.1/relay']); } catch {}
});

test('the failure pattern catches every refusal prefix the relay can send', () => {
  const m = B.match(/_PUB_FAILED = (\/\^\([^;]*?\/i);/);
  const re = new RegExp(m[1].slice(1, -2), 'i');
  for (const s of ['connection failure: connection timed out', 'blocked: not a member or not permitted for this group',
                   'invalid: signature failed', 'error: timestamp is too far in the future', 'rate-limited: slow down',
                   'restricted: not allowed', 'auth-required: we cannot serve that']) {
    assert.ok(re.test(s), `"${s}" would be treated as a successful publish`);
  }
  // a genuine acceptance must NOT match
  for (const s of ['', 'duplicate', 'have newer']) assert.ok(!re.test(s), `"${s}" is an acceptance and must count as success`);
});

test('no call site still uses the raw resolve-on-failure pattern', () => {
  const src = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Promise\.any\(pool\.publish\(/,
    'a publish call site bypasses _publishAny — it will report success with no relay');
});
