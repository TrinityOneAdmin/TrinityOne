// A NETWORK OF REAL RELAYS, for tests that must ask "did this reach a box that is not a member?".
//
// Run nothing here directly; import it. `scripts/relay-two-box-convergence.test.mjs` is the worked example.
//
// WHY THIS EXISTS. Every relay test in this repo spins up ONE gateway and asks what it serves. That is enough
// for a read gate, and it is not enough for anything about the NETWORK:
//
//   • Two relays holding one church have never been tested. `autoSyncIfRedundant` turns mirroring on by
//     itself once a church has a second relay, and nothing anywhere asserts the two ever agree. The
//     accept-is-not-a-retention-rule incident (a write gate replayed over an import deleted a finance
//     journal) is exactly this shape — a divergence nobody could see.
//   • "The corpus did NOT reach that box" is the assertion the closed-network work turns on, and it is
//     worthless against a relay that is switched off. A test proving nothing arrived at a dead relay proves
//     nothing at all. So this harness runs the non-member relay for real, tells it where the church's
//     relays are, and makes it ASK — then asserts it still holds none of the church's documents.
//   • "New client, old relay" is the deployment risk the moment a gate merges before the fleet upgrades.
//     So one participant runs `scripts/gateway.mjs` AS IT WAS AT AN OLDER COMMIT (see startOldRelay).
//
// WHAT IT WILL NOT DO. No mocks. Every participant is a real `node scripts/gateway.mjs` process with its own
// TRINITY_DATA_DIR under the OS temp dir, and its own port obtained by BINDING one (never a fixed number —
// the fixed-port collisions in CLAUDE.md's audit brief have produced false failures here repeatedly, and a
// stray relay answering on a fixed port makes broken code report green).
//
// TEARDOWN IS THE OTHER HALF OF THE JOB. An orphaned relay from a previous run is a documented cause of false
// audit findings in this repo, so `stopAll()` is registered on process exit as well as being callable from
// after() — a test that throws mid-way still leaves nothing behind. Assert it: `leftovers()` reports any
// process or directory this module created and has not cleaned up.
// The one case it cannot cover is the test process being SIGKILLed, which runs no handler anywhere; that is
// why the extracted old build is gitignored rather than merely deleted, and why a stray relay is worth a
// glance at `ps` before believing a network finding.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
// WHERE THE HISTORY IS, which is not always where the code under test is.
//
// startOldRelay/gatewayDiffersFrom read the previous build with `git show`, and ROOT is the tree the harness
// file happens to sit in. scripts/sabotage.mjs runs the whole suite from a COPY of the working tree — src,
// app, scripts, vendor and nothing else — so in the sandbox ROOT is not a git repository at all and every
// `git -C ROOT` dies with "not a git repository". A test that uses the old build then fails in the sandbox
// BEFORE any sabotage, and every case pointed at it reports BROKEN-BASELINE, which reads exactly like a
// broken test. (Measured 2026-09-01: five cases, all five.)
//
// So: TRINITY_GIT_ROOT if something told us where the history is — scripts/sabotage.mjs sets it to the real
// checkout, the same way it symlinks the real node_modules — else walk up for a .git (which is what a git
// worktree needs), else ROOT so git produces its own error rather than us inventing a path. Only `show` and
// `rev-parse` are ever run against it, so this is read-only in every case.
export const GIT_ROOT = (() => {
  if (process.env.TRINITY_GIT_ROOT && existsSync(join(process.env.TRINITY_GIT_ROOT, '.git'))) return process.env.TRINITY_GIT_ROOT;
  for (let d = ROOT, i = 0; i < 6; i++, d = dirname(d)) if (existsSync(join(d, '.git'))) return d;
  return ROOT;
})();
export const RELAYS_D = D.RELAYS;
export const now = () => Math.floor(Date.now() / 1000);
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const key = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// ── ports ───────────────────────────────────────────────────────────────────────────────────────────────
// Ask the OS for an unused port, hand it back, and re-check it with requireFreePort so the failure message
// is the one the rest of the suite prints. `issued` stops two relays in the SAME run being handed the same
// number after the kernel recycles it — the one collision the bind-and-release dance cannot see.
const issued = new Set();
export async function freePort(what = 'a harness relay') {
  for (let attempt = 0; attempt < 40; attempt++) {
    const port = await new Promise((res, rej) => {
      const s = createServer();
      s.once('error', rej);
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    });
    if (issued.has(port)) continue;
    try { await requireFreePort(port, what); } catch { continue; }
    issued.add(port);
    return port;
  }
  throw new Error('could not find a free port for ' + what + ' after 40 attempts');
}

// ── the participants ────────────────────────────────────────────────────────────────────────────────────
const live = new Set();      // every relay this module started and has not stopped
const tempDirs = new Set();  // every directory this module created and has not removed
const impostors = new Set();  // every in-process HTTP host this module started and has not closed

// What is still standing. A test asserts on this to prove teardown actually happened, rather than trusting it.
export function leftovers() {
  return {
    processes: [...live].map(r => ({ name: r.name, pid: r.proc.pid, alive: r.alive() })).filter(p => p.alive),
    dirs: [...tempDirs].filter(d => existsSync(d)),
    impostors: [...impostors].map(h => h.base),
  };
}

function register(relay) { live.add(relay); return relay; }

// Kill everything, synchronously enough to run from an exit handler. Safe to call twice.
export function stopAll() {
  for (const r of live) { try { r.proc.kill('SIGKILL'); } catch {} }
  live.clear();
  for (const h of impostors) { try { h.server.close(); } catch {} try { h.server.closeAllConnections(); } catch {} }
  impostors.clear();
  for (const d of tempDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  tempDirs.clear();
}
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopAll(); process.exit(1); });

async function waitForStatus(port, proc, label, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (proc.exitCode !== null) throw new Error(`${label} exited with code ${proc.exitCode} before serving /status`);
    try { const r = await fetch(`http://127.0.0.1:${port}/status`); if (r.ok) return await r.json(); } catch {}
    await sleep(120);
  }
  throw new Error(`${label} never served /status on port ${port} within ${ms}ms`);
}

// Start ONE real gateway.
//   name      — appears in every failure message from this relay
//   churches  — array of church pubkeys (hex) this relay is configured to hold, via CHURCH_NPUB
//   entry     — which gateway.mjs to run (defaults to the working tree's; startOldRelay passes an old copy)
//   env       — extra environment
// Returns a relay handle. `relayPub` is the box's own identity key, which is what a church authorises as a
// sync peer — NOT the church key, and not the URL. Two URLs can be one box; two boxes can share a URL.
export async function startRelay({ name = 'relay', churches = [], entry = join(ROOT, 'scripts/gateway.mjs'), env = {}, dataDir: reuseDir = '' } = {}) {
  const port = await freePort(name);
  // `reuseDir` is moveRelay()'s: the SAME box coming back at a new address, so it keeps its identity key.
  const dataDir = reuseDir || mkdtempSync(join(tmpdir(), `trin-net-${name}-`));
  tempDirs.add(dataDir);
  const base = `http://127.0.0.1:${port}`;
  // ORIGIN is how syncAllChurches recognises ITSELF in a church's relay list and skips it. Without it a relay
  // pulls from its own /sync every pass — harmless, but it muddies "who asked whom" in a network test.
  writeFileSync(join(dataDir, 'origin'), base);
  const proc = spawn(process.execPath, [entry, String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, TRINITY_DATA_DIR: dataDir,
      RELAY_SYNC: '0',                       // no background timer: tests drive syncNow() so the pass is deterministic
      RELAY_MAX_EVENTS: '5000',
      ...(churches.length ? { CHURCH_NPUB: churches.map(c => npubEncode(c)).join(',') } : {}),
      ...env,
    },
  });
  const log = [];
  const cap = (s) => { for (const line of String(s).split('\n')) if (line.trim()) log.push(line); if (log.length > 400) log.splice(0, log.length - 400); };
  proc.stdout.on('data', cap); proc.stderr.on('data', cap);

  const relay = {
    // `churches` and `env` are kept on the handle so moveRelay() can bring the box back configured the same
    // way. A relay that came back holding different churches would not be the same box.
    name, port, dataDir, base, entry, churches, env,
    wsUrl: `ws://127.0.0.1:${port}/relay`,
    proc, log,
    alive: () => proc.exitCode === null && proc.signalCode === null,
    status: async () => (await fetch(`${base}/status`)).json(),
    stop() { try { proc.kill('SIGKILL'); } catch {} live.delete(relay); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} tempDirs.delete(dataDir); },
  };
  register(relay);
  const st = await waitForStatus(port, proc, name);
  relay.relayPub = st.relayPub;
  // The admin token gates POST /sync-now. The gateway mints it into the data dir on first boot, so the
  // harness reads it from the directory it owns rather than inventing one.
  try { relay.adminToken = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || ''; } catch { relay.adminToken = ''; }
  // The box's own identity SECRET. Only the harness has it (it lives in a temp dir the harness created), and
  // only one thing needs it: making a NON-member relay genuinely ask a member relay for a corpus, so that
  // "it holds none of it" is a refusal we watched happen rather than an absence we assumed.
  try { const k = JSON.parse(readFileSync(join(dataDir, 'relay-key.json'), 'utf8')); relay.relaySk = Uint8Array.from(Buffer.from(k.sk, 'hex')); } catch {}
  if (!relay.relayPub) throw new Error(`${name} served /status without a relayPub — this gateway cannot be a sync peer`);
  return relay;
}

// A TUNNEL RESTART, IN MINIATURE: the same box at a NEW address.
//
// A self-hosted church very often reaches its relay through a free tunnel, which mints a different hostname
// every time the tunnel restarts. The box is the same machine with the same identity key; only the URL moved.
// That is the case a membership rule keyed on ADDRESS silently breaks — the church's own relay drops out on
// every reboot of it — and it cannot be staged without genuinely moving a real relay, because the whole
// point is that the key stays put while the URL does not.
//
// The process is killed and a new one started on a fresh port over the SAME data directory, so it reads the
// same relay-key.json and comes back with the same relayPub. The old handle is retired (its directory is NOT
// removed — the new relay is using it) and the new one is registered for teardown as usual.
export async function moveRelay(relay) {
  const { name, dataDir, entry, churches = [], env = {} } = relay;
  try { relay.proc.kill('SIGKILL'); } catch {}
  live.delete(relay);
  tempDirs.delete(dataDir);   // the new relay re-registers it; stopAll must not race two owners of one dir
  const moved = await startRelay({ name: name + '@2', entry, churches, env, dataDir });
  if (moved.relayPub !== relay.relayPub)
    throw new Error(`moveRelay(${name}): the box came back with a DIFFERENT identity key — it did not reuse ${dataDir}`);
  if (moved.port === relay.port)
    throw new Error(`moveRelay(${name}): the box came back on the same port, so nothing about the URL moved`);
  return moved;
}

// ── the old build ───────────────────────────────────────────────────────────────────────────────────────
// A relay running the code from BEFORE this work, so "new client, old relay" is rehearsed rather than hoped
// for. `git show <rev>:scripts/<file>` gives us the old bytes without touching the working tree or checking
// anything out; gateway.mjs has exactly two local imports (event-store.mjs, trinity-doc-types.mjs) and we
// take those from the same commit, so the box really is that build and not a hybrid.
//
// It is written to a directory DIRECTLY UNDER THE REPO ROOT for two reasons, both load-bearing:
//   • node resolves `ws` / `nostr-tools` by walking up from the file, so anywhere outside the repo fails;
//   • gateway.mjs sets ROOT to its own parent's parent, so one level down from the repo root gives the old
//     build the same ROOT the real one has.
// It is removed by stopAll() like any other temp dir, and `.oldbuild-*/` is gitignored so a crash cannot
// leave a stray copy of an old gateway staged for commit.
const OLD_LOCALS = ['gateway.mjs', 'event-store.mjs', 'trinity-doc-types.mjs'];
export function extractOldBuild(rev) {
  const dir = mkdtempSync(join(ROOT, '.oldbuild-'));
  tempDirs.add(dir);
  const scripts = join(dir, 'scripts');
  mkdirSync(scripts, { recursive: true });
  for (const f of OLD_LOCALS) {
    const bytes = execFileSync('git', ['-C', GIT_ROOT, 'show', `${rev}:scripts/${f}`], { maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(join(scripts, f), bytes);
  }
  return { dir, entry: join(scripts, 'gateway.mjs'), rev };
}

// The commit this repo calls "the build before the closed-network work": the branch point with main.
// Override with TRINITY_OLD_GATEWAY_REV to rehearse against any other release.
// PINNED, NOT 'main' — because main is now the branch these tests were written against.
//
// This was `main`, which is right while the work under test is on a side branch: "the build before this
// work" and "the tip of main" are the same commit. The closed-network work merged to main on 2026-09-02
// (7a292ca), so `main` became identical to the working tree, `gatewayDiffersFrom` correctly refused, and
// every old-relay case failed rather than passing vacuously. That is the guard working, not a regression.
//
// 26aa696 is main's tip immediately BEFORE that merge — a genuine pre-gate relay, which is what "old" has to
// mean for a skew rehearsal. Re-pin it the next time a release lands, or override for one run with
// TRINITY_OLD_GATEWAY_REV. If you ever see "identical to the working tree" again, that is this line gone
// stale, and the answer is to move it — never to delete the assertion.
export const DEFAULT_OLD_REV = process.env.TRINITY_OLD_GATEWAY_REV || '26aa696';

export async function startOldRelay({ name = 'old', churches = [], rev = DEFAULT_OLD_REV, env = {} } = {}) {
  const build = extractOldBuild(rev);
  const relay = await startRelay({ name, churches, entry: build.entry, env });
  relay.oldBuild = build;
  relay.buildRev = execFileSync('git', ['-C', GIT_ROOT, 'rev-parse', rev], { encoding: 'utf8' }).trim();
  return relay;
}

// Is the old build genuinely a different program? A rev that happens to match the working tree makes every
// "old relay" assertion vacuous, so tests can ask instead of assuming.
export function gatewayDiffersFrom(rev) {
  // GIT_ROOT for the history, ROOT for the comparison: the question is whether the tree UNDER TEST differs
  // from `rev`, and under sabotage.mjs those are two different trees on purpose.
  const old = execFileSync('git', ['-C', GIT_ROOT, 'show', `${rev}:scripts/gateway.mjs`], { encoding: 'utf8' });
  return old !== readFileSync(join(ROOT, 'scripts/gateway.mjs'), 'utf8');
}

// ── talking to a relay ──────────────────────────────────────────────────────────────────────────────────
export function connect(relay) {
  return new Promise((res, rej) => {
    const w = new WebSocket(relay.wsUrl);
    const bail = (e) => rej(new Error(`${relay.name}: ${e && e.message || e}`));
    w.on('open', () => res(w)); w.on('error', bail);
  });
}

// Publish one event and wait for the relay's own OK/reject. Returns [accepted, message] so a test can assert
// on a REFUSAL as readily as on a success — a write the relay quietly dropped looks identical otherwise.
export function publish(w, e) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { w.off('message', on); rej(new Error('no OK for event ' + e.id.slice(0, 8))); }, 8000);
    const on = (d) => { let m; try { m = JSON.parse(d); } catch { return; }
      if (m[0] === 'OK' && m[1] === e.id) { clearTimeout(t); w.off('message', on); res([m[2], m[3] || '']); } };
    w.on('message', on);
    w.send(JSON.stringify(['EVENT', e]));
  });
}

// Publish a list of events to one relay on a single socket, asserting every one was accepted.
export async function publishAll(relay, events) {
  const w = await connect(relay);
  try {
    for (const e of events) {
      const [ok, msg] = await publish(w, e);
      if (!ok) throw new Error(`${relay.name} refused ${(e.tags.find(t => t[0] === 'd') || [])[1] || 'kind ' + e.kind}: ${msg}`);
    }
  } finally { try { w.close(); } catch {} }
  return events.map(e => e.id);
}

// Read from a relay AS a given key, answering the relay's NIP-42 AUTH challenge for real. Each reader gets
// its own socket: ws._auth is per-connection, so sharing one silently makes every reader the same person.
export function readAs(relay, who, filter, win = 900) {
  return new Promise(async (resolve, reject) => {
    let w; try { w = await connect(relay); } catch (e) { reject(e); return; }
    const events = [];
    w.on('message', (d) => { let m; try { m = JSON.parse(d); } catch { return; }
      if (m[0] === 'EVENT' && m[1] === 's') events.push(m[2]);
      else if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent(
        { kind: 22242, created_at: now(), tags: [['relay', relay.wsUrl], ['challenge', m[1]]], content: '' }, who.sk)])); });
    w.send(JSON.stringify(['REQ', 's', filter]));
    setTimeout(() => { try { w.close(); } catch {} resolve(events); }, win);
  });
}

// ── church documents ────────────────────────────────────────────────────────────────────────────────────
export const churchDoc = (church, d, content, at) => finalizeEvent(
  { kind: 30078, created_at: at || now(), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(content) }, church.sk);

// The church-signed trusted-relays list — the ONE document that decides who is in this church's network.
// A relay ingesting it learns two things from the same list: which relay pubkeys may pull its full corpus
// (TRUSTED_RELAYS) and which URLs it should pull from (PEER_URLS).
export const relaysDoc = (church, relays, at) => churchDoc(church, RELAYS_D,
  relays.map(r => ({ pubkey: r.relayPub, url: r.base })), at);

// ── NIP-98, the way the relay-to-relay path does it ─────────────────────────────────────────────────────
export const nip98 = (sk, url, method, churchPub) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent(
  { kind: 27235, created_at: now(), tags: [['u', url], ['method', method], ['church', churchPub]], content: '' }, sk))).toString('base64');

// A proof signed by a relay's OWN identity key — byte-identical in shape to the one gateway.mjs mints in
// relayProof() when it pulls a peer. This is how a test makes a specific box ask, and names it in the ask.
export const proofAs = (relay, url, method, churchPub) => {
  if (!relay.relaySk) throw new Error(`${relay.name} has no identity key on disk`);
  return nip98(relay.relaySk, url, method, churchPub);
};

// ── the corpus ──────────────────────────────────────────────────────────────────────────────────────────
// Everything a relay holds for a church, read over /sync as the CHURCH KEY itself. The church key is always
// entitled to its own corpus (_syncAuth accepts ev.pubkey === cp), so this measures what the box HOLDS
// rather than what it would serve to some particular member — which is what a convergence claim needs.
export async function corpus(relay, church) {
  const url = `${relay.base}/sync?church=${encodeURIComponent(church.pub)}&since=0`;
  const r = await fetch(url, { headers: { Authorization: nip98(church.sk, url, 'GET', church.pub) } });
  if (!r.ok) throw new Error(`${relay.name}: /sync answered ${r.status} to the church's own key`);
  const out = [];
  for (const line of (await r.text()).split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch {} }
  return out;
}
export const corpusIds = async (relay, church) => new Set((await corpus(relay, church)).map(e => e.id));

// Ask a relay to run a full sync pass NOW against every peer the church authorised, instead of waiting out
// the 5-7 minute jittered timer. Returns the relay's own count of what it imported.
export async function syncNow(relay) {
  const r = await fetch(`${relay.base}/sync-now`, { method: 'POST', headers: { Authorization: 'Bearer ' + relay.adminToken } });
  if (!r.ok) throw new Error(`${relay.name}: /sync-now answered ${r.status}`);
  return r.json();
}

// ── waiting, with a bound ───────────────────────────────────────────────────────────────────────────────
export async function waitFor(pred, { timeout = 20000, every = 200, label = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { last = await pred(); if (last) return last; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error(`timed out after ${timeout}ms waiting for ${label}` + (last instanceof Error ? ` (last error: ${last.message})` : ''));
}

// Drive every relay's sync until they all hold the same set of ids for the church, or give up loudly saying
// WHICH ids are missing from WHERE. Bounded: a convergence test that hangs is a stuck suite, not a red one.
export async function waitForConvergence(relays, church, { timeout = 30000, expect = null } = {}) {
  const t0 = Date.now();
  let report = '';
  while (Date.now() - t0 < timeout) {
    for (const r of relays) { try { await syncNow(r); } catch {} }
    const sets = [];
    for (const r of relays) sets.push([r, await corpusIds(r, church)]);
    const union = new Set(); for (const [, s] of sets) for (const id of s) union.add(id);
    const short = sets.filter(([, s]) => s.size !== union.size);
    if (!short.length && (!expect || union.size === expect)) return { ids: union, ms: Date.now() - t0 };
    report = sets.map(([r, s]) => `${r.name}=${s.size}`).join(' ') + ` union=${union.size}` + (expect ? ` expected=${expect}` : '');
    await sleep(300);
  }
  throw new Error(`relays did not converge within ${timeout}ms: ${report}`);
}

// Which ids one relay holds and another does not, both ways. The message a divergence failure should print.
export async function corpusDiff(a, b, church) {
  const A = await corpusIds(a, church), B = await corpusIds(b, church);
  return { onlyOnA: [...A].filter(id => !B.has(id)), onlyOnB: [...B].filter(id => !A.has(id)) };
}

// ── an impostor ─────────────────────────────────────────────────────────────────────────────────────────
// A host that is NOT a TrinityOne relay, answering HTTP however the test tells it to.
//
// ADDED for the closed-network C2 tests, because the attack that item exists to stop cannot be staged with a
// real gateway: it is a stranger's box copying a real relay's answers and being believed. A relay handle
// cannot play that part — it holds a key, which is the whole thing the impostor lacks.
//
// It is an in-process `node:http` server rather than a spawned one, so a test that throws mid-way leaves no
// listening socket behind: it is closed by stopAll() alongside every relay, reported by leftovers() like
// every relay, and it dies with the test process no matter how the process ends. Ports come from the same
// freePort() every relay uses, so an impostor can never collide with one.
//   handler(req, res, url)  — url is the parsed URL; write whatever the case under test needs.
export async function startImpostor({ name = 'impostor', handler } = {}) {
  if (typeof handler !== 'function') throw new Error('startImpostor needs a handler');
  const port = await freePort(name);
  const server = createHttpServer((req, res) => {
    let u; try { u = new URL(req.url, 'http://127.0.0.1:' + port); } catch { u = new URL('http://127.0.0.1/'); }
    try { handler(req, res, u); } catch (e) { try { res.writeHead(500); res.end(String(e && e.message || e)); } catch {} }
  });
  await new Promise((ok, bad) => { server.once('error', bad); server.listen(port, '127.0.0.1', ok); });
  const host = { name, port, server, base: `http://127.0.0.1:${port}`,
    stop() { try { server.close(); } catch {} try { server.closeAllConnections(); } catch {} impostors.delete(host); } };
  impostors.add(host);
  return host;
}

// ── A BOX THAT IS NOT TRINITYONE SOFTWARE, BUT IS STILL A RELAY ─────────────────
//
// ADDED 2026-09-02, when admission became "does it run our software". Before that, a test could stage "a
// box this church did not choose" with a REAL gateway and assert the corpus never reached it. Under the new
// rule a real gateway is admitted by definition, so that staging tests nothing — and the nine tests that
// used it would have had to be deleted, taking the executable form of "a church document does not reach a
// box it should not" with them.
//
// This is the participant that keeps them alive. It behaves like a relay in every way a client can see —
// accepts a websocket, takes EVENTs, answers OK, and serves them back over /sync so `held()` and `corpus()`
// work against it unchanged — EXCEPT that it cannot answer `/relay-identity`, because it does not hold a
// TrinityOne relay key. Which is precisely the thing the new rule tests for.
//
// It is deliberately NOT a mock of the gate: nothing here decides admission. It is a plausible stranger's
// box, and the assertion stays what it always was — did the church's corpus arrive here or not.
export async function startFakeRelay({ name = 'not-ours' } = {}) {
  const { WebSocketServer } = await import('ws');
  const port = await freePort(name);
  const received = [];
  const server = createHttpServer((req, res) => {
    let u; try { u = new URL(req.url, 'http://127.0.0.1:' + port); } catch { u = new URL('http://127.0.0.1/'); }
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    // THE ONE THING IT CANNOT DO. A generic relay answers this with its own web page or a 404; either way it
    // cannot produce a signed proof, because it holds no TrinityOne relay key.
    if (u.pathname.startsWith('/relay-identity')) { res.writeHead(404, H); res.end('{"error":"not a trinityone relay"}'); return; }
    if (u.pathname === '/status') { res.writeHead(200, H); res.end(JSON.stringify({ ok: true, note: 'a relay, but not one of ours' })); return; }
    // NIP-11, ADVERTISING ITSELF AS WELL AS ANY REAL BOX. This is the "behaving correctly for a throwaway key
    // is not a signature" case in one object: it claims to enforce and to be open, and it still cannot answer
    // the possession proof. A membership test that believed this document would admit it.
    if (u.pathname === '/' || u.pathname === '/relay') {
      res.writeHead(200, { ...H, 'Content-Type': 'application/nostr+json' });
      res.end(JSON.stringify({ name, software: 'not-trinityone', supported_nips: [1, 42],
        trinityone: { enforces: true, open: true, churches: 0 } }));
      return;
    }
    // /sync in the shape corpus() reads: newline-delimited JSON. No auth check — this is a stranger's box and
    // the test's question is what it HOLDS, not what it would serve to whom.
    if (u.pathname === '/sync') {
      const cp = u.searchParams.get('church') || '';
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Access-Control-Allow-Origin': '*' });
      res.end(received.filter(e => !cp || e.pubkey === cp || (e.tags || []).some(t => t[0] === 'church' && t[1] === cp))
        .map(e => JSON.stringify(e)).join('\n'));
      return;
    }
    res.writeHead(404, H); res.end('{"error":"no"}');
  });
  const wss = new WebSocketServer({ server, path: '/relay' });
  wss.on('connection', (w) => {
    w.on('message', (data) => {
      let m; try { m = JSON.parse(data); } catch { return; }
      if (m[0] === 'EVENT' && m[1]) { received.push(m[1]); try { w.send(JSON.stringify(['OK', m[1].id, true, ''])); } catch {} }
      else if (m[0] === 'REQ') { try { w.send(JSON.stringify(['EOSE', m[1]])); } catch {} }
    });
  });
  await new Promise((ok, bad) => { server.once('error', bad); server.listen(port, '127.0.0.1', ok); });
  const host = {
    name, port, server, received,
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/relay`,
    stop() { try { wss.close(); } catch {} try { server.close(); } catch {} try { server.closeAllConnections(); } catch {} impostors.delete(host); },
  };
  impostors.add(host);
  return host;
}

// Reply with JSON, the shape every impostor in these tests uses.
export const sendJson = (res, body, status = 200) => {
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(s);
};
