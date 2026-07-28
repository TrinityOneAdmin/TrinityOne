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
