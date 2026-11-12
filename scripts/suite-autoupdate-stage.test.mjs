// suiteAutoUpdate(): CHECK + DOWNLOAD + STAGE of a signed Suite JS bundle — the P3 heart.
// Run: node --test scripts/suite-autoupdate-stage.test.mjs
//
// Lifts the REAL suiteAutoUpdate / suiteIsNewer / suiteUpdateBase out of gateway.mjs (the SUITE-AUTOUPDATE
// slice) and drives it against a LOCALHOST http fixture (ephemeral port) with a THROWAWAY Ed25519 key — never
// the network, never the real release key (the relay-bundle-publish network trap). It uses the REAL
// scripts/verify-suite-bundle.mjs as its verifier, so the stage-time signature gate is executed, not mocked.
// Goes red if the slice is deleted or any of the gates break (CLAUDE.md rule 1, lifted + executed).
//
// Proven here (the plan's required cases):
//   (a) newer + valid signature → stages bundle.tgz/.sig + writes READY
//   (b) same sha                → no-op, no READY
//   (c) older date              → refused, no READY
//   (d) bad signature           → refused, staged files discarded, no READY
//   (e) not PACKAGED            → never runs: no fetch, no suite dir
//   + anti-rollback vs a recorded installedDate (step 5), even when sha+date clear the pre-download gate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, renameSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFIER = join(HERE, 'verify-suite-bundle.mjs');

// ── Lift the real slice and run it. ──────────────────────────────────────────────────────────────────────
const SRC = readFileSync(join(HERE, 'gateway.mjs'), 'utf8');
const m = SRC.match(/\/\/ SUITE-AUTOUPDATE-BEGIN[^\n]*\n([\s\S]*?)\/\/ SUITE-AUTOUPDATE-END/);
assert.ok(m, 'SUITE-AUTOUPDATE markers are gone from gateway.mjs — the check/stage logic was removed; re-anchor this test');
const api = new Function('join', 'mkdirSync', 'writeFileSync', 'readFileSync', 'renameSync', 'rmSync', 'spawnSync',
  m[1] + '\nreturn { suiteAutoUpdate, suiteIsNewer, suiteUpdateBase };')(
  join, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, spawnSync);

// ── Throwaway key + bundle bytes. ────────────────────────────────────────────────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBKEY_PATH = join(tmpdir(), 'trin-suite-stage-pub-' + process.pid + '.pem');
const TGZ = Buffer.alloc(2048, 0x42); TGZ.write('a stand-in gzipped tarball of the Suite JS layer — v2');   // >512B floor; signature is over these exact bytes
const SIG = cryptoSign(null, TGZ, privateKey);

const BUILD = { sha: 'b'.repeat(40), date: '2026-01-01T00:00:00Z' };   // what this box "runs"

// ── The localhost fixture: switchable manifest/tgz/sig; counts hits so case (e) can prove "never ran". ───────
let server, baseUrl, hits = 0;
let manifest = null, serveTgz = TGZ, serveSig = SIG;

before(async () => {
  writeFileSync(PUBKEY_PATH, publicKey.export({ type: 'spki', format: 'pem' }));
  server = createServer((req, res) => {
    hits++;
    const url = req.url.split('?')[0];
    if (url === '/suite-latest.json' && manifest) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(manifest)); return; }
    if (url === '/suite-js-bundle.tgz') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(serveTgz); return; }
    if (url === '/suite-js-bundle.tgz.sig') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(serveSig); return; }
    res.writeHead(404); res.end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});
after(() => {
  try { server && server.close(); } catch {}
  try { rmSync(PUBKEY_PATH, { force: true }); } catch {}
});

function freshDataDir() { return mkdtempSync(join(tmpdir(), 'trin-suite-stage-')); }
function opts(dataDir, over = {}) {
  return { packaged: true, settings: { autoUpdate: true }, dataDir, build: BUILD, base: baseUrl,
           verifier: VERIFIER, pubkey: PUBKEY_PATH, node: process.execPath, ...over };
}
const readyPath = (d) => join(d, 'suite', 'staging', 'READY');
const tgzPath = (d) => join(d, 'suite', 'staging', 'bundle.tgz');
const sigPath = (d) => join(d, 'suite', 'staging', 'bundle.sig');

test('(a) newer + valid signature → stages bundle + writes READY', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = SIG;
    const r = await api.suiteAutoUpdate('test', opts(d));
    assert.ok(r.ok && r.staged, 'should stage: ' + JSON.stringify(r));
    assert.ok(existsSync(tgzPath(d)), 'bundle.tgz staged');
    assert.ok(existsSync(sigPath(d)), 'bundle.sig staged');
    assert.ok(existsSync(readyPath(d)), 'READY written');
    const ready = JSON.parse(readFileSync(readyPath(d), 'utf8'));
    assert.deepEqual(ready, { version: 'v2', sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z' });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('(b) same sha → no-op, no READY', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: BUILD.sha, date: '2026-06-01T00:00:00Z', version: 'same' };
    serveTgz = TGZ; serveSig = SIG;
    const r = await api.suiteAutoUpdate('test', opts(d));
    assert.equal(r.reason, 'not-newer', JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY for the same build');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('(c) older date → refused, no READY', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'c'.repeat(40), date: '2025-01-01T00:00:00Z', version: 'old' };
    serveTgz = TGZ; serveSig = SIG;
    const r = await api.suiteAutoUpdate('test', opts(d));
    assert.equal(r.reason, 'not-newer', 'an older-dated bundle must be refused pre-download: ' + JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY for an older bundle');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('(d) bad signature → refused, staged files discarded, no READY', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ;
    serveSig = cryptoSign(null, Buffer.from('signed over the WRONG bytes'), privateKey);   // valid sig, wrong payload
    const r = await api.suiteAutoUpdate('test', opts(d));
    assert.equal(r.reason, 'bad-signature', 'a bundle whose signature does not verify must be refused: ' + JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY for a bad signature');
    assert.ok(!existsSync(tgzPath(d)), 'the unverifiable bundle.tgz is discarded');
    assert.ok(!existsSync(sigPath(d)), 'the unverifiable bundle.sig is discarded');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('(e) not PACKAGED → never runs: no fetch, no suite dir', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    const before = hits;
    const r = await api.suiteAutoUpdate('test', opts(d, { packaged: false }));
    assert.equal(r.skipped, 'disabled', JSON.stringify(r));
    assert.equal(hits, before, 'a non-packaged box must not touch the network');
    assert.ok(!existsSync(join(d, 'suite')), 'a non-packaged box must not create the suite dir');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('toggle OFF (settings.autoUpdate !== true) → never runs', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    const before = hits;
    const r = await api.suiteAutoUpdate('test', opts(d, { settings: { autoUpdate: false } }));
    assert.equal(r.skipped, 'disabled', JSON.stringify(r));
    assert.equal(hits, before, 'the toggle being off must not touch the network');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('anti-rollback: a recorded installedDate newer than the remote is refused even past the pre-gate', async () => {
  const d = freshDataDir();
  try {
    // sha differs and date (2026-06) > BUILD.date (2026-01) so suiteIsNewer passes the pre-download gate,
    // but a previously-installed bundle dated 2026-12 (state.json) must still veto it at step 5.
    mkdirSync(join(d, 'suite'), { recursive: true });
    writeFileSync(join(d, 'suite', 'state.json'), JSON.stringify({ installedDate: '2026-12-01T00:00:00Z' }));
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = SIG;
    const r = await api.suiteAutoUpdate('test', opts(d));
    assert.equal(r.reason, 'anti-rollback', 'a bundle older than the installed one must be refused: ' + JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY when anti-rollback fires');
    assert.ok(!existsSync(tgzPath(d)), 'the rolled-back bundle is discarded');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('suiteIsNewer is a pure decision; suiteUpdateBase honours the env override', () => {
  assert.equal(api.suiteIsNewer({ sha: 'a'.repeat(40), date: '2026-02-01' }, BUILD), true);
  assert.equal(api.suiteIsNewer({ sha: BUILD.sha, date: '2026-02-01' }, BUILD), false, 'same sha → not newer');
  assert.equal(api.suiteIsNewer({ sha: 'a'.repeat(40), date: '2025-02-01' }, BUILD), false, 'older date → not newer');
  assert.equal(api.suiteIsNewer({ sha: 'nothex', date: '2026-02-01' }, BUILD), false, 'a non-sha is refused');
  const saved = process.env.SUITE_UPDATE_BASE;
  try {
    process.env.SUITE_UPDATE_BASE = 'http://127.0.0.1:9/x/';
    assert.equal(api.suiteUpdateBase(), 'http://127.0.0.1:9/x', 'env override wins, trailing slash trimmed');
    delete process.env.SUITE_UPDATE_BASE;
    assert.ok(api.suiteUpdateBase().startsWith('https://github.com/'), 'default is the GitHub release');
  } finally { if (saved === undefined) delete process.env.SUITE_UPDATE_BASE; else process.env.SUITE_UPDATE_BASE = saved; }
});
