// Auto-find must not trust a relay's word for it.
// Run: node --test scripts/relay-offer-probe.test.mjs
//
// AUDIT-2026-07-27. `discoverRelayOffers` kept a candidate if its own NIP-11 said `enforces: true` — a field
// that is literally `CHURCH_PUBS.size > 0`, i.e. the relay reporting on itself. Anyone could stand up a relay,
// register a dummy church, advertise an offer and be picked; a picked relay then receives everything the
// console publishes, because publish() fans out to relays(). The code comment claimed the NIP-11 probe made a
// dishonest entry impossible — true of a stale DIRECTORY entry, never of a relay lying about itself.
//
// This drives the real gateway: a compliant relay must REFUSE a stranger's church-authority writes. That is
// what the probe now tests before a relay is ever offered as somewhere to put a congregation's roster.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const PORT = 8898;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();
let relay, dataDir;

const conn = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, e) => new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', e])); });

before(async () => {
  await requireFreePort(PORT, 'relay-offer-probe.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-offer-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// exactly the two writes the shipped probe attempts
const probeWrite = (sk, d) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [] }) }, sk);

test('a compliant relay refuses a stranger’s safeguarding list — which is what the probe relies on', async () => {
  const w = await conn();
  const ghost = getPublicKey(generateSecretKey());
  const sk = generateSecretKey();
  const [okMinors] = await publish(w, probeWrite(sk, 'trinityone/minors:' + ghost));
  const [okStewards] = await publish(w, probeWrite(sk, 'trinityone/stewards:' + ghost));
  w.close();
  assert.equal(okMinors, false, 'a stranger wrote a list of children for a church this relay does not host');
  assert.equal(okStewards, false, 'a stranger wrote a steward roster for a church this relay does not host');
});

test('the probe is wired into Auto-find and its result is decisive', () => {
  const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  assert.match(STEWARD, /_probeRelayEnforces/, 'the behavioural probe is gone — Auto-find is back to trusting a self-report');
  const at = STEWARD.indexOf('discoverRelayOffers');
  const body = STEWARD.slice(at, at + 2200);
  assert.match(body, /_probeRelayEnforces/, 'discoverRelayOffers no longer probes its candidates');
  assert.match(body, /if \(!v\.ok\)/, 'a failed probe must exclude the relay, not merely be logged');
});

test('accepting either probe write disqualifies the relay', () => {
  const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const at = STEWARD.indexOf('_probeRelayEnforces');
  const body = STEWARD.slice(at, at + 2600);
  assert.match(body, /minors:/, 'the probe must try the safeguarding write');
  assert.match(body, /stewards:/, 'the probe must try the steward-roster write');
  assert.match(body, /=== true.*finish\(false/s, 'an accepted write must FAIL the probe — that is the whole test');
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// AUTO-FIND'S "FASTEST FIVE" DISPLAY LIST (owner decision 2026-10-29) MUST NOT WIDEN ADMISSION (rule 10).
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
//
// Added with the autofind-top5 change. The card now shows discovered relays fastest-first with a "Show all"
// control. The latency ranking is purely cosmetic and MUST sit strictly downstream of admission: a relay only
// reaches the list after discoverRelayOffers() has run admitRemoteRelay() (C5) and, for a non-canonical box,
// _probeRelayEnforces(). These three assertions read SOURCE (src/steward.src.js), not vendor/steward.js: this
// branch does not rebuild vendor for tests (build:vendor lore), and the point-of-use lifts from source. They
// are brace-matched slices (test-slice.fnBody), so they read the real function bodies, not a fixed window.
//
// NOTE FOR THE SERIAL RUNNER: this file spawns a real gateway on PORT 8898 in before(), so it must be run
// SERIALLY (never inside a concurrent suite) — the three source checks below do not themselves need the port,
// but the file as a whole binds one. The gateway IS used by the first test and by the ms round-trip below.
const SRC = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');

test('discoverRelayOffers builds the offer — ms and all — only AFTER both admission gates have run', () => {
  const body = fnBody(SRC, 'async function discoverRelayOffers(');
  const admit = body.indexOf('await admitRemoteRelay(url)');
  const probe = body.indexOf('await _probeRelayEnforces(url)');
  const offer = body.indexOf('ms: Number.isFinite(t.ms)');   // the attach lives on the returned offer object
  assert.ok(admit !== -1, 'discoverRelayOffers no longer calls admitRemoteRelay(url) — admission gate C5 is gone');
  assert.ok(probe !== -1, 'discoverRelayOffers no longer calls _probeRelayEnforces(url) — the behavioural gate is gone');
  assert.ok(offer !== -1, 'the offer object carries no ms — Auto-find cannot rank by latency');
  assert.ok(offer > admit && offer > probe,
    'the offer (with ms) is built BEFORE an admission gate — a relay could reach the display list unadmitted');
});

test('the display list (listRelayOffers) only re-orders already-admitted offers — it runs no gate of its own', () => {
  const body = fnBody(SRC, 'async listRelayOffers(region) {');
  assert.match(body, /discoverRelayOffers\(/, 'listRelayOffers no longer sources discoverRelayOffers — admission is bypassed');
  assert.match(body, /rankOffersByLatency\(/, 'listRelayOffers no longer ranks by latency — the "fastest first" list is gone');
  assert.doesNotMatch(body, /admitRemoteRelay\(/,
    'listRelayOffers calls admitRemoteRelay itself — admission must stay in discoverRelayOffers, upstream, not be re-decided here');
  assert.doesNotMatch(body, /_probeRelayEnforces\(/,
    'listRelayOffers calls _probeRelayEnforces itself — the display path must not re-run or stand in for the gate');
});

test('the latency the card ranks on is a real measurement against a live relay', async () => {
  // Prove the primitive _relayInfo relies on: a timed NIP-11 GET to the running gateway yields a finite,
  // non-negative ms. This is why the file needs the port and must run serially.
  const httpUrl = `http://127.0.0.1:${PORT}`;
  const t0 = Date.now();
  let reached = false;
  try { const res = await fetch(httpUrl, { headers: { Accept: 'application/nostr+json' } }); reached = !!res; } catch { reached = false; }
  const ms = Date.now() - t0;
  assert.equal(reached, true, 'the live gateway did not answer a NIP-11 GET — cannot measure latency');
  assert.ok(Number.isFinite(ms) && ms >= 0, 'the measured round-trip is not a finite, non-negative number of ms');
});
