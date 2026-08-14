// ONE SOCKET MUST NOT BE ABLE TO BUY UNLIMITED RELAY CPU.
// Run: node --test scripts/relay-scan-budget.test.mjs
//
// THE DEFECT (Fable verification audit, 2026-08-10). A REQ whose filters cannot use an index falls back to
// scanning rows, synchronously, on the thread that serves every other church. Two bounds existed and both
// cap a SINGLE request: at most 32 filters, and a 300,000-row budget shared across them.
//
// Measured on a 300,000-event store (scripts/relay-scan-cost.probe.mjs):
//     32 crafted filters, 300,000-row budget ....... 1,180 ms
//     the same read a real member makes ............     2 ms
//
// The inbound rate limit is 100 messages per second, which exists because signature checking is CPU-heavy —
// it is sized for cheap messages. At ~1.2s each, one socket could ask for about two minutes of scanning per
// second, before proving who it is. The per-request bound was never the missing piece; the per-connection one
// was.
//
// So the allowance is now per CONNECTION and refills over time, and anonymous sockets get far less than
// authenticated ones: the expensive shape is reachable before anyone has identified themselves, and a member
// who has authenticated is someone we can block. A church's own members keep the generous allowance, because
// truncating their deep reads silently is data loss — event-store.mjs says so where the scan is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');

let membersSet = new Set();
function lift(members = []) {
  membersSet = new Set(members);
  const at = SRC.indexOf('function scanAllowance(ws)');
  assert.notEqual(at, -1,
    'scanAllowance() is gone from the gateway.\n\n' +
    '  If this is the first run, that IS the defect: the scan budget is minted fresh for every request, so it\n' +
    '  bounds one question and not a thousand of them.');
  let depth = 0, body;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) { body = SRC.slice(at, i + 1); break; }
  }
  const capsAt = SRC.indexOf('const SCAN_ROWS_PER_SEC_AUTHED');
  const caps = SRC.slice(capsAt, SRC.indexOf('\n', SRC.indexOf('SCAN_ROWS_PER_SEC_ANON')) + 1);
  return new Function('nowRef', 'MEMBERS', caps + '\n' + body.replace('const now = Date.now();', 'const now = nowRef.t;') +
    '\nreturn scanAllowance;')({ t: 0 }, membersSet);
}

test('a stranger gets far less scanning than a member', () => {
  const M = 'a'.repeat(64);
  const scanAllowance = lift([M]);
  const anon = scanAllowance({});
  const member = scanAllowance({ _auth: M });
  assert.ok(anon.left < member.left,
    'an unauthenticated socket is allowed as much relay CPU as a church member. The expensive request needs ' +
    'no identity, so this is the one that has to be cheap to refuse and expensive to repeat');
  assert.ok(anon.left <= 50000,
    `a stranger may scan ${anon.left} rows/second. Measured cost is roughly 1,180ms per 300,000 rows, so ` +
    'this still buys hundreds of milliseconds of freeze per second from one socket');
});

test('the allowance is shared across requests, not minted fresh for each', () => {
  const scanAllowance = lift();
  const ws = {};
  const first = scanAllowance(ws);
  first.left -= 20000;                       // a request spends part of it
  const second = scanAllowance(ws);
  assert.strictEqual(second, first,
    'each request got its own budget object, so spending one costs the next nothing — which is exactly how ' +
    '100 requests per second could each be allowed a full scan');
  assert.ok(second.left <= 5000,
    'the spend did not carry over between requests on the same connection');
});

test('a MEMBER authenticating mid-connection raises the allowance', () => {
  const M = 'b'.repeat(64);
  const scanAllowance = lift([M]);
  const ws = {};
  scanAllowance(ws);
  ws._auth = M;                              // NIP-42 completes on the same socket
  const after = scanAllowance(ws);
  assert.ok(after.cap >= 300000,
    'a member who has just proved who they are is still throttled like a stranger — the replay that runs ' +
    'right after AUTH is the one read they most need to complete');
});

test('a member who read before AUTH is not starved by the replay', () => {
  const M = 'd'.repeat(64);
  const scanAllowance = lift([M]);
  const ws = {};
  const anon = scanAllowance(ws);
  anon.left = 0;                             // pre-AUTH reads drained the anonymous bucket — see below
  ws._auth = M;                              // …and only THEN does NIP-42 complete
  const after = scanAllowance(ws);
  assert.ok(after.left >= 300000,
    `the replay starts with ${after.left} rows of budget instead of a full allowance. The relay's CHALLENGE is ` +
    'lazy, so a member\'s first reads NECESSARILY go out unauthenticated, and a #p or #t filter spends budget ' +
    'inside store.query before canRead withholds the rows. Carrying that spend across AUTH truncates the ' +
    'member\'s own DM and group history — silently, because a spent budget just returns fewer rows. Asserting ' +
    'only on .cap does not see this: the cap is right and the balance is empty.');
});

// AN OPEN WEAKNESS, RECORDED RATHER THAN GUARDED. Completing NIP-42 proves someone holds a key, not that a
// church admitted them, so an authenticated stranger gets the member-sized burst and can repeat it by
// reconnecting. The obvious repair — requiring MEMBERS.has(_auth) — was written and then REVERTED, because a
// re-audit measured it starving the steward console (which authenticates as the CHURCH key and so is not in
// MEMBERS) down to the anonymous allowance, while costing an attacker only one extra message. There is
// deliberately no test asserting the gate: a test here would pin the wrong answer in place. See the note on
// scanAllowance in gateway.mjs and AUDIT-BACKLOG.md.
test('the console and every member share the large allowance, whoever they are', () => {
  const scanAllowance = lift([]);            // MEMBERS deliberately empty
  const authed = scanAllowance({ _auth: 'e'.repeat(64) });
  assert.ok(authed.cap >= 300000,
    'the allowance is gated on something other than having authenticated. The steward console authenticates ' +
    'as the CHURCH key and publishes no member doc, so any membership-shaped gate silently drops the most ' +
    'read-heavy client in the system to the anonymous budget — measured: a quiet room went from 20 of 20 ' +
    'messages served to none');
});

test('a member is not permanently punished for one big read', () => {
  const M = 'c'.repeat(64);
  const scanAllowance = lift([M]);
  const ws = { _auth: M };
  const rl = scanAllowance(ws);
  rl.left = 0;                               // spent entirely
  rl.t -= 1000;                              // …a second ago
  const after = scanAllowance(ws);
  assert.ok(after.left > 0,
    'the allowance never refills, so one deep read locks a member out of reading for the rest of the ' +
    'connection — silently, because a spent budget just returns fewer rows');
});

test('both the REQ path and the post-AUTH replay draw on it', () => {
  assert.match(SRC, /const _scanBudget = scanAllowance\(ws\)/,
    'the REQ handler mints its own budget again');
  assert.match(SRC, /const _replayBudget = scanAllowance\(ws\)/,
    'the post-AUTH replay mints its own budget, so it is an unbounded second helping on every connection');
});
