// THE UPDATE MUST ASK THE QUESTION A MEMBER ASKS, AND ACTUALLY GET AN ANSWER.
// Run: node --test scripts/relay-declared-address-probe.test.mjs
//
// AUDIT 2026-09-02, and this file is the second attempt at the same guard because the first one was inert.
//
// relay-update.sh grew a check meant to catch a relay that answers on loopback and refuses everywhere else.
// It read the box's public address from `/relay-names/mine` — an adminOK-gated route — and sent no
// credential. So the fetch was a 401, the address was always empty, the "no public address known" branch
// always ran, and EVERY update passed. The test covering it asserted that `/relay-identity` and
// `relay-names/mine` appeared in the script's TEXT. Both strings were there. Both assertions passed. Over a
// guard that could never run once.
//
// So nothing here reads the script for words. It LIFTS the shipped block, runs it in bash against REAL
// relays this file started, and asserts on the verdict the block reached and the lines it emitted. If the
// guard goes inert again — a credential dropped, a comparison neutered, a branch returning success on the
// path that matters — these cases go red, because a relay on the other end really did refuse.
//
// The four states a box can be in, and what the update must do about each:
//   • declares a public address, and answers there            → pass
//   • declares a public address, and does NOT answer there    → FAIL (roll back; this is the outage)
//   • declares none, and says it is loopback/LAN on purpose   → pass, and say so
//   • declares none, and never said so                        → FAIL (this is a8's state, and it was passing)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as H from './relay-network-harness.mjs';

after(() => H.stopAll());

const SCRIPT = readFileSync(new URL('../scripts/relay-update.sh', import.meta.url), 'utf8');

// Lift the block VERBATIM, so this drives the shipped script and not a copy of its idea. Both ends are
// anchored on explicit markers: relay-update-reconcile.test.mjs records what happens when the end of a lifted
// window is guessed from the last line somebody recognised — it cut a trailing `true`, and the fragment then
// reported a failure the real script never produces.
function probeBlock() {
  const from = SCRIPT.indexOf('# ── PROVE IT WHERE MEMBERS ACTUALLY REACH IT ──');
  assert.notEqual(from, -1, 'the declared-address probe block is gone from relay-update.sh');
  const to = SCRIPT.indexOf('# ── end declared-address probe ──', from);
  assert.notEqual(to, -1, 'the probe block end-marker is gone from relay-update.sh — re-anchor this test');
  const block = SCRIPT.slice(from, to);
  // The verdict has to reach `ok`, because `ok` is what the rollback below it reads. A probe that decides
  // correctly and tells nobody is the same as no probe, and is how this shipped the first time.
  assert.match(block, /probe_declared_addresses \|\| ok=0/,
    'the lifted block no longer feeds its verdict into `ok`, so nothing it decides can reach the rollback');
  return block;
}

// Run the real block against a chosen port, entering it the way the script does: the relay came back up, so
// `ok` is 1 and the only thing that can change that is the probe.
//
// ASYNCHRONOUSLY, AND THIS IS NOT A STYLE CHOICE. The first version used spawnSync, which blocks this
// process's event loop for as long as bash runs — and the tunnels below are HTTP servers living in this
// process. Every probe through one therefore timed out at the full `--max-time`, two cases went red, and the
// output said "HTTP 000" as though the address were dead. A blocked test looks exactly like a broken relay.
function runProbe(port) {
  const w = mkdtempSync(join(tmpdir(), 'trin-declared-probe-'));
  const runner = join(w, 'run.sh');
  writeFileSync(runner, `#!/usr/bin/env bash
set -uo pipefail
PORT=${Number(port)}
DIR=${JSON.stringify(w)}
ok=1
log() { printf 'LOG %s\\n' "$*"; }
${probeBlock()}
echo "VERDICT ok=$ok"
`);
  return new Promise((resolve, reject) => {
    const p = spawn('bash', [runner], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const kill = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 120000);
    p.on('error', (e) => { clearTimeout(kill); rmSync(w, { recursive: true, force: true }); reject(e); });
    p.on('close', () => {
      clearTimeout(kill);
      rmSync(w, { recursive: true, force: true });
      try {
        assert.match(out, /VERDICT ok=[01]/, 'the lifted block never reached its verdict:\n' + out);
        resolve({ ok: /VERDICT ok=1/.test(out), out });
      } catch (e) { reject(e); }
    });
  });
}

// The health check that decides whether the probe above is even reached. Same lift, different markers.
function healthBlock() {
  const from = SCRIPT.indexOf('# ── IS IT DOING ITS JOB, NOT MERELY ANSWERING ──');
  assert.notEqual(from, -1, 'the post-restart health check is gone from relay-update.sh');
  const to = SCRIPT.indexOf('# ── end health check ──', from);
  assert.notEqual(to, -1, 'the health-check end-marker is gone from relay-update.sh — re-anchor this test');
  return SCRIPT.slice(from, to);
}

function runHealth(port) {
  const w = mkdtempSync(join(tmpdir(), 'trin-health-'));
  const runner = join(w, 'run.sh');
  writeFileSync(runner, `#!/usr/bin/env bash
set -uo pipefail
PORT=${Number(port)}
HEALTH_TRIES=2
log() { printf 'LOG %s\\n' "$*"; }
${healthBlock()}
echo "VERDICT ok=$ok"
`);
  return new Promise((resolve, reject) => {
    const p = spawn('bash', [runner], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => { rmSync(w, { recursive: true, force: true }); reject(e); });
    p.on('close', () => {
      rmSync(w, { recursive: true, force: true });
      try {
        assert.match(out, /VERDICT ok=[01]/, 'the lifted health check never reached its verdict:\n' + out);
        resolve({ ok: /VERDICT ok=1/.test(out), out });
      } catch (e) { reject(e); }
    });
  });
}

test('a relay that answers but reports itself degraded is not called healthy', async () => {
  // `ok: !STORE_DEGRADED` was written in August so that a relay refusing every write could not report health,
  // and the only thing that polls /status after an update threw the body away. So the field has been read by
  // NOTHING since the day it was added, and a box whose storage had failed would take an update, come back
  // still failing, and be recorded as a success with the rollback never firing.
  //
  // The two servers below supply the ANSWER, not the decision: which of those answers means healthy is the
  // shipped script's judgement, running here unmodified.
  const healthy = await H.startImpostor({ name: 'healthy', handler: (req, res) => H.sendJson(res, { ok: true, port: 1 }) });
  const degraded = await H.startImpostor({ name: 'degraded', handler: (req, res) => H.sendJson(res, { ok: false, port: 1, degraded: { what: 'storage' } }) });
  try {
    const good = await runHealth(healthy.port);
    assert.equal(good.ok, true,
      'a relay reporting itself healthy was rolled back. This half is the control: without it, a check that ' +
      'failed everything would satisfy the assertion below.\n' + good.out);
    const bad = await runHealth(degraded.port);
    assert.equal(bad.ok, false,
      'a relay that is up, answering, and refusing every write was recorded as a successful update. Nothing ' +
      'saves, every dashboard stays green, and the rollback never fires.\n' + bad.out);
    assert.match(bad.out, /DEGRADED/,
      'the failure does not say the relay is degraded, so the log cannot distinguish it from a box that ' +
      'never came up at all\n' + bad.out);
  } finally { healthy.stop(); degraded.stop(); }
});

// A relay with no road to the outside world AT ALL, whatever machine this suite runs on.
//
// Both halves matter. RELAY_PUBLIC_URL is inherited from the environment by the harness, and
// TRINITY_TAILSCALE_BIN decides whether the box picks up a funnel address from the machine underneath it —
// this dev box has a funnel, so without this the loopback-only cases would pass here and fail on a build
// machine without tailscale. A test whose answer depends on which machine ran it reports the weather.
const NO_PUBLIC_ROAD = { RELAY_PUBLIC_URL: '', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale' };

// A TUNNEL, IN MINIATURE — which is the deployment that broke. Our own shared box is reached through a named
// cloudflared tunnel: members dial a public host, something forwards to the relay on loopback, and the relay
// never sees the public address on the socket. `forwardsHonestly` is that tunnel. `askFor` is the one knob:
// an honest forwarder passes the member's question through untouched, and a broken one substitutes an address
// of its own — which is what a proxy sitting on another host or another path does.
async function forwarder(box, { askFor = null } = {}) {
  return H.startImpostor({
    name: askFor ? 'answers-for-somebody-else' : 'forwards-honestly',
    handler: async (req, res, u) => {
      if (u.pathname !== '/relay-identity') { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
      const want = askFor || u.searchParams.get('for') || '';
      const r = await fetch(`${box.base}/relay-identity?nonce=${encodeURIComponent(u.searchParams.get('nonce') || '')}&for=${encodeURIComponent(want)}`);
      const body = await r.text();
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(body);
    },
  });
}

test('the update passes a relay reachable where it says it is, and fails one that is not', async () => {
  // CONTROL AND TREATMENT IN ONE CASE, on purpose. A probe that failed everything would satisfy the
  // treatment half on its own and prove nothing — which is the exact shape of the bug it replaces, where a
  // probe that passed everything satisfied a text assertion and proved nothing.
  const box = await H.startRelay({ name: 'behind-a-tunnel', env: { ...NO_PUBLIC_ROAD } });
  const tunnel = await forwarder(box);
  // Declared through the FILE, which is the escape hatch an operator uses when the box cannot work its own
  // address out — and the path that had never once been exercised end to end.
  writeFileSync(join(box.dataDir, 'relay-addresses.json'),
    JSON.stringify({ addresses: [`ws://127.0.0.1:${tunnel.port}/relay`] }) + '\n');

  const deadPort = await H.freePort('an address nothing listens on');
  const orphan = await H.startRelay({ name: 'declares-a-dead-road',
    env: { ...NO_PUBLIC_ROAD, RELAY_PUBLIC_URL: `ws://127.0.0.1:${deadPort}/relay` } });
  try {
    const pass = await runProbe(box.port);
    assert.equal(pass.ok, true,
      'the probe failed a relay that DOES answer the possession proof at the public address it declares. ' +
      'Every update in the fleet would now roll back, which is a worse failure than the bug this catches.\n' + pass.out);

    const fail = await runProbe(orphan.port);
    assert.equal(fail.ok, false,
      'a relay declaring a public address that answers NOTHING was passed as healthy. This is the defect: ' +
      'the box is up on loopback, /status is green, every member who dials that address is refused, and the ' +
      'rollback never fires.\n' + fail.out);
    assert.match(fail.out, /CANNOT PROVE ITSELF/,
      'the update failed the box without naming the address that could not be proved, so the operator is ' +
      'told nothing they can act on\n' + fail.out);
  } finally { box.stop(); orphan.stop(); tunnel.stop(); }
});

test('a relay that says it is loopback-only on purpose is passed, and the reason is recorded', async () => {
  // A church on one machine, or a relay on a LAN with no public road, is a real deployment and must keep
  // updating. The opt-in is what separates it from a public box nobody configured; from inside the process
  // the two are indistinguishable, which is why this is an opt-in and not a deduction.
  //
  // BOTH ROUTES, because a service unit and a hand-configured box declare it differently and an operator who
  // used the one that was never tested finds out when their relay rolls back.
  const byEnv = await H.startRelay({ name: 'lan-by-env', env: { ...NO_PUBLIC_ROAD, RELAY_LOOPBACK_ONLY: '1' } });
  const byFile = await H.startRelay({ name: 'lan-by-file', env: { ...NO_PUBLIC_ROAD } });
  writeFileSync(join(byFile.dataDir, 'relay-addresses.json'), JSON.stringify({ loopbackOnly: true }) + '\n');
  try {
    for (const [how, b] of [['RELAY_LOOPBACK_ONLY=1', byEnv], ['{"loopbackOnly":true}', byFile]]) {
      const r = await runProbe(b.port);
      assert.equal(r.ok, true,
        `a relay that declared itself loopback/LAN-only with ${how} was failed and would have been rolled ` +
        'back. Every desktop Suite box is in this state.\n' + r.out);
      assert.match(r.out, /loopback\/LAN-only on purpose/,
        `${how} passed silently, so the log cannot tell "we checked and it is fine" from "we never ` +
        'checked"\n' + r.out);
    }
  } finally { byEnv.stop(); byFile.stop(); }
});

test('a relay with no public address that never said so FAILS the update', async () => {
  // THE CASE THAT WOULD HAVE CAUGHT THE DEFECT, and our own shared box's exact state on the day this was
  // written: a named cloudflared tunnel, no RELAY_PUBLIC_URL, no relay-addresses.json — so it declares
  // loopback and nothing else, answers /status perfectly on localhost, and refuses every member.
  //
  // The precondition below is the whole point of the file: healthy and useless are the same box at the same
  // moment, so loopback health can never be evidence about the address members actually dial.
  const box = await H.startRelay({ name: 'silently-undeclared', env: { ...NO_PUBLIC_ROAD } });
  try {
    assert.equal((await (await fetch(box.base + '/status')).json()).ok, true,
      'precondition: the box reports itself perfectly healthy on loopback');
    const r = await runProbe(box.port);
    assert.equal(r.ok, false,
      'a relay that declares NO public address and never opted in was passed as healthy. That is the silent ' +
      'fleet outage: every box green, every member refused.\n' + r.out);
    assert.match(r.out, /DECLARES NO PUBLIC ADDRESS/,
      'the failure does not name the problem, so the operator cannot fix it\n' + r.out);
    assert.match(r.out, /RELAY_LOOPBACK_ONLY/,
      'the failure does not tell a genuine LAN operator how to get their box updating again\n' + r.out);
  } finally { box.stop(); }
});

test('a 200 is not enough — a proof naming a different address is refused', async () => {
  // HOST, PORT AND PATH ARE THE BOUNDARY. A proxy in front of a relay can hand back a perfectly valid proof
  // — genuinely signed by the real relay, for the REAL relay's own address — and a check that looked only at
  // the status code would call that healthy. The phone then compares the address that was signed against the
  // one it dialled, and refuses. That is the same outage, arriving one layer further out and after release.
  const box = await H.startRelay({ name: 'the-real-box', env: { ...NO_PUBLIC_ROAD } });
  const proxy = await forwarder(box, { askFor: box.wsUrl });   // asks for the relay's own loopback address, not the one dialled
  const behind = await H.startRelay({ name: 'behind-a-lying-proxy',
    env: { ...NO_PUBLIC_ROAD, RELAY_PUBLIC_URL: `ws://127.0.0.1:${proxy.port}/relay` } });
  try {
    // Precondition: that address really does answer 200 — so a status-code-only check would pass it, and the
    // assertion below is about the tag and nothing else.
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    const direct = await fetch(`${proxy.base}/relay-identity?nonce=${nonce}&for=${encodeURIComponent(`ws://127.0.0.1:${proxy.port}/relay`)}`);
    assert.equal(direct.status, 200, 'precondition: the proxy answers 200, so only the signed address can fail this');

    const r = await runProbe(behind.port);
    assert.equal(r.ok, false,
      'a 200 carrying a proof for a DIFFERENT address was accepted. Members dialling the declared address ' +
      'compare what was signed against what they dialled, and will refuse this relay.\n' + r.out);
    assert.match(r.out, /answering for it/,
      'the failure does not say that something in front of the relay answered, which is the only clue an ' +
      'operator has that they should look at their proxy\n' + r.out);
  } finally { box.stop(); behind.stop(); proxy.stop(); }
});
