// A relay that cannot produce a release bundle must SAY SO, not answer 200 with nothing.
// Run: node --test scripts/relay-bundle-honesty.test.mjs
//
// ARCHITECTURE-AUDIT-2026-07-30 A4. Measured live on a8, three consecutive polls with /status healthy:
//
//     app.trinityone.church   /relay-app/bundle.tgz   200 —          0 bytes
//                             /relay-app/bundle.sig   404 — "no signature (this host has no release key)"
//     trinityone.tailbeaac0…  /relay-app/bundle.tgz   200 — 52,505,809 bytes
//
// The route wrote its 200 header BEFORE spawning `git archive`, and a relay box is installed by untarring a
// bundle so it has no .git. By the time the failure was known the header was already on the wire and all the
// handler could do was destroy the socket — which through a tunnel arrives as a clean, empty, successful
// response. A failure was indistinguishable from a zero-byte release.
//
// relay-app/install.sh:25 defaults SRC to that host and `curl -f` cannot catch it, because -f only fails on an
// HTTP error status and this is a 200. It does fail safe one step later (tar exits 2 on a 0-byte archive), so
// nothing half-installs — but the operator is told "couldn't unpack the code bundle", which points at the
// tarball rather than at the host.
//
// The correct shape was already in the file, four lines below the bug: /relay-app/bundle.sig asks the same
// question and refuses honestly. This is the "rule applied here and not to its neighbour" class that
// scripts/trinity-rules.mjs exists for, sitting in the release path.
//
// The test builds a tree that is NOT a git repo and has no release key — exactly a8's shape — and asserts the
// route refuses. The second half matters as much: a real release host must still serve, because breaking the
// self-host installer to fix its error message would be a worse bug than the one being fixed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8931;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const sleep = ms => new Promise(r => setTimeout(r, ms));
let relay, tree;

// A faithful stand-in for an installed relay: the gateway and its one local import, node_modules symlinked so
// the imports resolve, a stamped version.txt (so ensureSignedBundle gets a sha and reaches the fallback rather
// than bailing earlier), and NO .git and NO release key.
function buildNonGitTree() {
  const dir = mkdtempSync(join(tmpdir(), 'trin-nogit-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(ROOT, 'scripts', 'gateway.mjs'), join(dir, 'scripts', 'gateway.mjs'));
  copyFileSync(join(ROOT, 'scripts', 'event-store.mjs'), join(dir, 'scripts', 'event-store.mjs'));
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'version.txt'), 'sha: ' + '1'.repeat(40) + '\ndate: 2026-07-29T00:00:00+01:00\n');
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>stand-in</title>\n');
  // Prove the premise rather than assume it: if this ever IS a git repo the test is measuring nothing.
  const g = spawnSync('git', ['-C', dir, 'rev-parse', '--git-dir'], { encoding: 'utf8' });
  assert.notEqual(g.status, 0, 'the stand-in tree is a git repository, so it cannot stand in for an installed relay');
  return dir;
}

// Read the status AND the body length without pulling a 50 MB tarball into memory: take the first chunk, then
// hang up. A HEAD request would not do — the bug is in the body, and Content-Length is absent on the stream.
const fetchHead = (path) => new Promise((resolve) => {
  const req = httpRequest({ host: '127.0.0.1', port: PORT, path, method: 'GET' }, (res) => {
    let bytes = 0, done = false;
    const finish = () => { if (!done) { done = true; try { req.destroy(); } catch {} resolve({ status: res.statusCode, bytes }); } };
    res.on('data', (c) => { bytes += c.length; if (bytes > 0) finish(); });
    res.on('end', finish);
    res.on('error', finish);
  });
  req.on('error', () => resolve({ status: 0, bytes: 0 }));
  req.end();
});

before(async () => {
  await requireFreePort(PORT, 'relay-bundle-honesty.test.mjs');
  tree = buildNonGitTree();
  relay = spawn(process.execPath, [join(tree, 'scripts', 'gateway.mjs'), String(PORT)], {
    cwd: tree, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: join(tree, 'relay') },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay.kill(); } catch {} try { rmSync(tree, { recursive: true, force: true }); } catch {} });

test('the stand-in relay is actually up (or every assertion below is vacuous)', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/status`);
  assert.equal(r.status, 200, 'the stand-in relay never came up; the refusals below would pass for the wrong reason');
});

test('a host that cannot build a bundle REFUSES, instead of answering 200 with nothing', async () => {
  const r = await fetchHead('/relay-app/bundle.tgz');
  assert.notEqual(r.status, 200,
    'the bundle route answered 200 on a host with no .git and no release key. An installer cannot tell that ' +
    'apart from a zero-byte release: `curl -f` only fails on an error STATUS, and this is a success.');
  // A refusal SHOULD carry a short explanation (see the next test) — what it must not carry is a tarball.
  // My first version of this asserted zero bytes and failed against the correct fix, which is the right way
  // round to find out.
  assert.ok(r.bytes < 4096, 'the refusal sent ' + r.bytes + ' bytes — that is a payload, not an explanation');
});

test('and it refuses the same way its neighbour already did', async () => {
  // bundle.sig has always got this right. Pinning both together is the point: they answer the same question,
  // and the whole defect was that they answered it differently.
  const sig = await fetchHead('/relay-app/bundle.sig');
  const tgz = await fetchHead('/relay-app/bundle.tgz');
  assert.equal(sig.status, 404, 'the signature route stopped refusing — it is the shape the fix copied');
  assert.equal(tgz.status, sig.status,
    'the two release routes disagree about what this host can do. That disagreement IS the bug: same file, ' +
    'same question, adjacent routes, one honest and one not.');
});

test('the refusal says which host this is, so the operator is not sent hunting the tarball', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/relay-app/bundle.tgz`);
  const body = await res.text();
  assert.match(body, /release/i,
    'the refusal does not mention the release host, so it reads as "the file is broken" rather than ' +
    '"this machine does not publish releases" — which is what sent the operator to the wrong place');
});

// ── the half that must not be broken ─────────────────────────────────────────────────────────────────────
// Over-tightening is the other way to get this wrong. A relay that refuses to serve a bundle it CAN build
// breaks `relay-update.sh` fleet-wide and the self-host installer with it — far worse than a bad error
// message. This repo IS a git checkout, so the real route must still produce bytes here.
test('a host that CAN build a bundle still serves one', async () => {
  const g = spawnSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { encoding: 'utf8' });
  assert.equal(g.status, 0, 'this checkout is not a git repo, so this guard cannot run — do not delete it, fix the environment');
  const PORT2 = PORT + 1;
  await requireFreePort(PORT2, 'relay-bundle-honesty.test.mjs (release-host half)');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-githost-'));
  const r2 = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT2)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir },
  });
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT2}/status`)).ok) break; } catch {} await sleep(150); }
    const got = await new Promise((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port: PORT2, path: '/relay-app/bundle.tgz', method: 'GET' }, (res) => {
        let bytes = 0, done = false;
        const finish = () => { if (!done) { done = true; try { req.destroy(); } catch {} resolve({ status: res.statusCode, bytes }); } };
        res.on('data', (c) => { bytes += c.length; if (bytes > 4096) finish(); });   // enough to prove real content
        res.on('end', finish); res.on('error', finish);
      });
      req.on('error', () => resolve({ status: 0, bytes: 0 }));
      req.setTimeout(120000, () => { try { req.destroy(); } catch {} resolve({ status: 0, bytes: 0 }); });
      req.end();
    });
    assert.equal(got.status, 200, 'a real release host stopped serving its bundle — this breaks every relay self-update');
    assert.ok(got.bytes > 4096, 'the release host answered 200 but sent almost nothing (' + got.bytes + ' bytes)');
  } finally {
    try { r2.kill(); } catch {}
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
});
