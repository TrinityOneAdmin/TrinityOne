// A REFUSED OR UNCONFIRMED NIP-42 AUTH IS NEVER READ AS A REAL ZERO (pre-merge audit 2026-11-23, B4).
//   Run: node scripts/run-tests.mjs scripts/the-push-reader-keeps-the-widget-when-auth-is-refused.test.mjs
//
// The relay flushes its held EOSE after a grace EVEN WHEN it refused our AUTH (OK false -- e.g. the phone's clock
// beyond the relay's 600s limit) or never heard one back, so the reader used to end 'eose+auth-grace' with zero
// events and call that 'genuinely-0-new' -> widget 'clear' -> DirectPushWorker also CANCELS the posted
// notification. A refused or unconfirmed AUTH must KEEP instead; only a CONFIRMED (or never-challenged) zero clears.
//
// Everything is lifted from bg-entry.js and EXECUTED (CLAUDE.md rule 3): readerVerdict, widgetCountAction,
// watchAuthOutcome, and the one __dpStart statement that assigns the verdict. The last tests drive the REAL
// machinery -- a real scripts/gateway.mjs spawned on an EPHEMERAL port, a real SimplePool, the shipped
// watchAuthOutcome: the gateway really refuses a stale AUTH (OK false) and really confirms a fresh one (OK true),
// and the shipped verdict comes out KEEP / clear respectively.
// Callers of the lifted code (rule 2): readerVerdict + watchAuthOutcome only __dpStart; widgetCountAction only finish().
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { fnBody } from './test-slice.mjs';
import { D } from './trinity-doc-types.mjs';

const SRC = readFileSync(new URL('../plugins/trinity-directpush/js/bg-entry.js', import.meta.url), 'utf8');
const readerVerdict = new Function(fnBody(SRC, 'function readerVerdict(', 'readerVerdict') + '\nreturn readerVerdict;')();
const widgetCountAction = new Function(fnBody(SRC, 'function widgetCountAction(', 'widgetCountAction') + '\nreturn widgetCountAction;')();
const watchAuthOutcome = new Function(fnBody(SRC, 'function watchAuthOutcome(', 'watchAuthOutcome') + '\nreturn watchAuthOutcome;')();

const act = (v) => widgetCountAction(v, 0);
const EOSE = 'eose+auth-grace';

test('(a) AUTH refused (OK false) + zero events => NOT a real zero, widget KEEP', () => {
  const v = readerVerdict(0, 0, EOSE, false, false, { 'ws://r/': 'refused' });
  assert.notEqual(v, 'genuinely-0-new');
  assert.match(v, /auth-unconfirmed/);
  assert.deepEqual(act(v), { op: 'keep' });
  // even with old (pre-cursor) events fetched, a refusal means the zero-NEW claim is not trustworthy
  const v2 = readerVerdict(2, 0, 'eose', false, false, { 'ws://r/': 'refused' });
  assert.deepEqual(act(v2), { op: 'keep' });
  // one relay confirming does not launder another relay's refusal
  const v3 = readerVerdict(0, 0, EOSE, false, false, { 'ws://a/': 'ok', 'ws://b/': 'refused' });
  assert.deepEqual(act(v3), { op: 'keep' });
});

test('(b) AUTH challenged, signed, never confirmed + zero events => KEEP', () => {
  const v = readerVerdict(0, 0, EOSE, false, false, { 'ws://r/': 'sent' });
  assert.notEqual(v, 'genuinely-0-new');
  assert.deepEqual(act(v), { op: 'keep' });
});

test('(c) AUTH confirmed OK=true + zero events => the REAL zero still clears', () => {
  assert.equal(readerVerdict(0, 0, EOSE, false, false, { 'ws://r/': 'ok' }), 'genuinely-0-new');
  assert.deepEqual(act('genuinely-0-new'), { op: 'clear' });
  // one confirmed + one unanswered is still a legitimate zero (at least one gated relay really answered us)
  assert.equal(readerVerdict(0, 0, EOSE, false, false, { 'ws://a/': 'ok', 'ws://b/': 'sent' }), 'genuinely-0-new');
});

test('(d) no relay challenged at all + zero events => a legitimate zero, clears', () => {
  assert.equal(readerVerdict(0, 0, 'eose', false, false, {}), 'genuinely-0-new');
  assert.equal(readerVerdict(0, 0, 'eose', false, false, null), 'genuinely-0-new');
});

test('a real count still SETS, refusal or not; the pre-existing NOT-a-zero branches are unchanged', () => {
  const v = readerVerdict(3, 3, EOSE, false, false, { 'ws://r/': 'refused' });
  assert.equal(v, 'new-events');
  assert.deepEqual(widgetCountAction(v, 3), { op: 'set', n: 3 });
  assert.match(readerVerdict(0, 0, 'eose', true, false, {}), /^AUTH-FAILED-OR-CLOCK-SKEW/);
  assert.match(readerVerdict(0, 0, 'eose', false, true, {}), /^AUTH-FAILED-OR-CLOCK-SKEW/);
  assert.match(readerVerdict(0, 0, 'timeout-30s', false, false, {}), /^NO-ANSWER \(timeout-30s\)/);
});

test('POINT OF USE: __dpStart assigns its verdict through readerVerdict with the live authOutcomes, and both signers record the outcome', () => {
  const fn = SRC.slice(SRC.indexOf('window.__dpStart = async function'), SRC.indexOf('\nfunction finish('));
  const lines = fn.split('\n').filter((l) => l.includes('const verdict = readerVerdict('));
  assert.equal(lines.length, 1, 'exactly one verdict assignment in __dpStart');
  assert.ok(lines[0].includes('authOutcomes'), 'the verdict consults the AUTH outcomes');
  assert.equal((fn.match(/watchAuthOutcome\(pool, authOutcomes, url\)/g) || []).length, 2, 'both signers (automaticallyAuth + subscribeMany onauth) record the outcome');
  // EXECUTE the real statement: with a refused outcome it must not produce the clearing verdict
  const run = new Function('readerVerdict', 'evs', 'newer', 'stats', 'authProblem', 'skewBad', 'authOutcomes', lines[0].trim() + '\nreturn verdict;');
  assert.match(run(readerVerdict, [], [], { endedBy: EOSE, authSigned: 1 }, false, false, { 'ws://r/': 'refused' }), /auth-unconfirmed/);
  assert.equal(run(readerVerdict, [], [], { endedBy: EOSE, authSigned: 1 }, false, false, { 'ws://r/': 'ok' }), 'genuinely-0-new');
});

// ── the real thing: a spawned gateway.mjs really refusing / really confirming our AUTH ─────────────────────────
// Ephemeral port (never fixed: this file may run beside a live rig), killed by PID in after(). The REQ names a
// safetycheck d-tag, which the gateway challenges on the FILTER alone (no church config needed). The signer is the
// same shape as the reader's: sign, record via the SHIPPED watchAuthOutcome, hand back. The refused case signs a
// STALE created_at (beyond the gateway's 600s freshness window) -- the exact clock-skew shape from the audit.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let relay = null, dataDir = null, PORT = 0, URL_ = '';

before(async () => {
  PORT = await new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  URL_ = `ws://127.0.0.1:${PORT}/relay`;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-b4-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_HOST: '127.0.0.1' },
  });
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) { up = true; break; } } catch {} await sleep(150); }
  assert.ok(up, 'fixture: the spawned gateway never answered /status');
});
after(() => { try { if (relay) relay.kill(); } catch {} try { if (dataDir) rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// The reader's automatic path (pool.automaticallyAuth -> AbstractRelay._onmessage 'AUTH' -> relay.auth(signer))
// RETHROWS the OK=false rejection with no handler -- pre-existing nostr-tools behaviour, inert in the WebView but
// counted as a failure by node --test. So this calls the SAME relay.auth(signer) the automatic path calls, on the
// pool's own relay object, and holds the rejection itself; watchAuthOutcome still observes relay.authPromise
// exactly as it does in the reader.
async function liveAuthRun(mutate) {
  const sk = generateSecretKey();
  const pool = new SimplePool();
  const outcomes = {};
  let sawEose = false;
  const sub = pool.subscribeMany([URL_], [{ kinds: [30078], '#d': [D.SAFETY + 'ee'.repeat(32)] }], {
    maxWait: 15000,
    oneose() { sawEose = true; },
    onclose() {},
  });
  const relay = await pool.ensureRelay(URL_);              // the same cached relay the subscription runs on
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && !relay.challenge) await sleep(50);
  assert.ok(relay.challenge, 'the gateway challenged this REQ (safetycheck d-tag draws an AUTH)');
  relay.auth(async (ev) => { if (mutate) mutate(ev); watchAuthOutcome(pool, outcomes, relay.url); return finalizeEvent(ev, sk); }).catch(() => {});
  const t1 = Date.now();  // the gateway answers the AUTH with its OK synchronously; loopback makes this fast
  while (Date.now() - t1 < 8000 && !Object.values(outcomes).some((v) => v === 'ok' || v === 'refused')) await sleep(100);
  try { sub.close(); } catch {}
  try { pool.close([URL_]); } catch {}
  return { outcomes: { ...outcomes }, endedBy: sawEose ? 'eose+auth-grace' : 'timeout-30s' };
}

test('LIVE: the gateway REFUSES a stale AUTH with OK false, watchAuthOutcome sees it, and the shipped verdict KEEPS', async () => {
  const { outcomes } = await liveAuthRun((ev) => { ev.created_at = Math.floor(Date.now() / 1000) - 100000; });
  const vals = Object.values(outcomes);
  assert.ok(vals.length >= 1, 'the gateway challenged and we signed');
  assert.deepEqual(vals, vals.map(() => 'refused'), 'the OK=false surfaced as refused, honestly, via relay.authPromise');
  const v = readerVerdict(0, 0, 'eose+auth-grace', false, false, outcomes);
  assert.notEqual(v, 'genuinely-0-new');
  assert.deepEqual(widgetCountAction(v, 0), { op: 'keep' });
});

test('LIVE: the gateway CONFIRMS a fresh AUTH with OK true, and the shipped verdict still clears a real zero', async () => {
  const { outcomes } = await liveAuthRun(null);
  const vals = Object.values(outcomes);
  assert.ok(vals.length >= 1, 'the gateway challenged and we signed');
  assert.deepEqual(vals, vals.map(() => 'ok'), 'the OK=true surfaced as confirmed');
  const v = readerVerdict(0, 0, 'eose+auth-grace', false, false, outcomes);
  assert.equal(v, 'genuinely-0-new');
  assert.deepEqual(widgetCountAction(v, 0), { op: 'clear' });
});
