// /status MUST NOT TELL A STRANGER HOW BIG A CHURCH IS.
// Run: node --test scripts/status-hides-congregation-size.test.mjs
//
// Found by a red-team outsider on 2026-08-18 who started with ONLY the church's name. The membership list —
// the highest-value asset in the UK-pilot threat model — stayed sealed against every filter. But `/status` is
// unauthenticated and returned:
//
//     counts: { churches: 1, members: 29, broadcastGroups: 2, events: 572, connections: 59 }
//
// No identities. But "this named church is real, active, and has ~29 people" is precisely the aggregate a
// hostile party — an official, a hostile neighbour, a journalist — wants to CONFIRM about a congregation it
// has only heard the name of. The handler's own comment called these "non-sensitive counts"; the neighbouring
// token-gated /stats already treats per-church counts as seizure-sensitive, so the two disagreed.
//
// /status stays public for what a health dashboard legitimately needs — is the relay up, is the disk full,
// which build is it running. The population figures move behind the admin token, alongside /stats and /config.
//
// This boots a real gateway with a church and members in the store, then asks /status as a stranger and as
// the admin, so the assertions are about what the RUNNING relay actually serves — not what the source appears
// to say.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { openStore } from './event-store.mjs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8944;
const BASE = `http://127.0.0.1:${PORT}`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), m1 = K(), m2 = K();
let relay, dataDir, token = '';

const memberDoc = (who, cp) => finalizeEvent({ kind: 30078, created_at: now() - 500,
  tags: [['d', 'trinityone/member:' + cp], ['t', NET], ['p', cp]], content: JSON.stringify({ joined: true }) }, who.sk);

const waitReady = async (ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${BASE}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); };

before(async () => {
  await requireFreePort(PORT, 'status-hides-congregation-size.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-status-'));
  const store = openStore(join(dataDir, 'relay.sqlite'), { maxEvents: 5000 });
  store.put(memberDoc(m1, church.pub));
  store.put(memberDoc(m2, church.pub));
  store.close();
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) },
    stdio: 'ignore',
  });
  await waitReady();
  // the admin token is written to the data dir by the gateway on boot
  try { token = Object.values(JSON.parse(await (await fetch(`${BASE}/local-token`)).json().catch(() => ({})) || {}))[0] || ''; } catch {}
  if (!token) { try { const { readFileSync } = await import('node:fs'); token = Object.values(JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')))[0] || ''; } catch {} }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a stranger cannot read the congregation size from /status', async () => {
  const j = await (await fetch(`${BASE}/status`)).json();
  // the health signal a dashboard legitimately needs is still public…
  assert.equal(typeof j.ok, 'boolean', '/status must still report health, or the fleet dashboard goes dark');
  assert.ok('storage' in j, 'and the disk signal, so a full disk is visible before it is a silent outage');
  // (deliberately NOT asserting j.version — it is read from git/version.txt, which a sandboxed test tree does
  // not carry, and it has nothing to do with what this test guards. Asserting it made the test fail in the
  // sabotage sandbox for a reason unrelated to the privacy fix.)
  // …but not the population.
  assert.ok(!j.counts || j.counts.members === undefined,
    'an unauthenticated /status returned counts.members — "this named church has ~N people" is exactly the ' +
    'aggregate the UK-pilot threat model exists to deny a hostile party who has only the church name');
  assert.ok(!j.counts || j.counts.churches === undefined,
    'the number of churches on the box is also a seizure-relevant aggregate on a shared relay');
});

test('the admin token still gets the counts', async () => {
  assert.ok(token, 're-anchor: could not obtain the admin token');
  const j = await (await fetch(`${BASE}/status`, { headers: { Authorization: 'Bearer ' + token } })).json();
  assert.ok(j.counts && j.counts.members >= 2,
    'the operator dashboard legitimately needs these — they move BEHIND the token, they do not disappear');
});
