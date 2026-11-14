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
import { generateKeyPairSync, sign as cryptoSign, randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFIER = join(HERE, 'verify-suite-bundle.mjs');

// ── Lift the real slice and run it. ──────────────────────────────────────────────────────────────────────
const SRC = readFileSync(join(HERE, 'gateway.mjs'), 'utf8');
const m = SRC.match(/\/\/ SUITE-AUTOUPDATE-BEGIN[^\n]*\n([\s\S]*?)\/\/ SUITE-AUTOUPDATE-END/);
assert.ok(m, 'SUITE-AUTOUPDATE markers are gone from gateway.mjs — the check/stage logic was removed; re-anchor this test');
const api = new Function('join', 'mkdirSync', 'writeFileSync', 'readFileSync', 'renameSync', 'rmSync', 'spawnSync', 'existsSync',
  m[1] + '\nreturn { suiteAutoUpdate, suiteIsNewer, suiteUpdateBase };')(
  join, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, spawnSync, existsSync);

// ── Throwaway key + bundle bytes. ────────────────────────────────────────────────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBKEY_PATH = join(tmpdir(), 'trin-suite-stage-pub-' + process.pid + '.pem');
// A REAL Suite-shaped bundle (gzipped tar with version.txt, release-origin, scripts/gateway.mjs), because the
// verifier now reads the SIGNED identity out of it (audit be258b42 HIGH 2). A 4 KiB random pad keeps it over the
// 512-byte floor. `files` overrides let a test build a server-shaped (no release-origin) bundle.
// Stand-in gateway carrying the step-1 data-folder guard statements the verifier now requires (audit L-6).
const STEP1_GATEWAY = [
  "const DATA_DIR = process.env.TRINITY_DATA_DIR;",
  "const DATA_DIR_PINNED = /^(1|true)$/i.test(process.env.TRINITY_DATA_DIR_PINNED || '');",
  "const DATA_DIR_MOVED = join(DATA_DIR, 'MOVED-TO');",
  "function refuseDataDir() { process.exit(DATA_DIR_REFUSED); }",
  "if (!existsSync(DATA_DIR)) { if (DATA_DIR_PINNED) refuseDataDir('missing'); }",
  "if (existsSync(DATA_DIR_MOVED)) refuseDataDir('moved');",
  "",
].join('\n');
function suiteTgz(sha, date, files = {}) {
  const st = mkdtempSync(join(tmpdir(), 'trin-suite-tgz-'));
  const all = { 'version.txt': sha + '\n' + date + '\n', 'release-origin': 'https://example.invalid\n', 'scripts/gateway.mjs': STEP1_GATEWAY + '// ' + sha + '\n', 'pad.bin': randomBytes(4096), ...files };
  for (const [rel, body] of Object.entries(all)) { if (body == null) continue; mkdirSync(dirname(join(st, rel)), { recursive: true }); writeFileSync(join(st, rel), body); }
  const out = st + '.tgz';
  const r = spawnSync('tar', ['-czf', out, '-C', st, '.']);
  assert.equal(r.status, 0, 'tar failed');
  const b = readFileSync(out); rmSync(st, { recursive: true, force: true }); rmSync(out, { force: true });
  return b;
}
const signTgz = (tgz) => cryptoSign(null, tgz, privateKey);
const TGZ = suiteTgz('a'.repeat(40), '2026-06-01T00:00:00Z');   // what the default manifest (sha a…, 2026-06-01) names
const SIG = signTgz(TGZ);

const BUILD = { sha: 'b'.repeat(40), date: '2026-01-01T00:00:00Z' };   // what this box "runs"

// ── The localhost fixture: switchable manifest/tgz/sig; counts hits so case (e) can prove "never ran". ───────
let server, baseUrl, hits = 0;
let manifest = null, serveTgz = TGZ, serveSig = SIG, chunkTgz = false, sigMissing = false;
const pathHits = {};   // url path -> request count (M2: prove what is NOT downloaded)

before(async () => {
  writeFileSync(PUBKEY_PATH, publicKey.export({ type: 'spki', format: 'pem' }));
  server = createServer((req, res) => {
    hits++;
    const url = req.url.split('?')[0];
    pathHits[url] = (pathHits[url] || 0) + 1;
    if (url === '/suite-js-bundle.sig' && sigMissing) { res.writeHead(404); res.end('not yet'); return; }
    if (url === '/suite-latest.json' && manifest) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(manifest)); return; }
    if (url === '/suite-js-bundle.tgz') {
      if (chunkTgz) {
        // No Content-Length: body streams in chunks, so only the mid-stream byte-count guard can catch an
        // over-cap body here — the Content-Length pre-check cannot (there is none to read).
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked' });
        const half = serveTgz.length >> 1;
        res.write(serveTgz.subarray(0, half)); res.end(serveTgz.subarray(half));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(serveTgz); return;
    }
    if (url === '/suite-js-bundle.sig') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(serveSig); return; }
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
    // but a previously-installed bundle dated 2026-09 (state.json) must still veto it at step 6.
    mkdirSync(join(d, 'suite'), { recursive: true });
    writeFileSync(join(d, 'suite', 'state.json'), JSON.stringify({ installedDate: '2026-09-01T00:00:00Z' }));
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = SIG;
    const r = await api.suiteAutoUpdate('test', opts(d));
    assert.equal(r.reason, 'anti-rollback', 'a bundle older than the installed one must be refused: ' + JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY when anti-rollback fires');
    assert.ok(!existsSync(tgzPath(d)), 'the rolled-back bundle is discarded');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── Security-hardening fixes (independent audit, 2026-11-12). Each goes RED without its fix. ──────────────────

test('[SSRF] a manifest whose url/sig point at a FOREIGN origin is refused; the foreign host is never contacted', async () => {
  const d = freshDataDir();
  try {
    // Same sha/date as case (a) so the newness + anti-rollback gates would pass — only the origin pin stops it.
    // The foreign url is a DIFFERENT port (origin = scheme+host+port), pointed at a port we never listen on, so
    // if the code ever fetched it the test would error/hang instead of returning a clean refusal.
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2',
                 url: 'http://127.0.0.1:1/suite-js-bundle.tgz', sig: 'http://127.0.0.1:1/suite-js-bundle.tgz.sig' };
    serveTgz = TGZ; serveSig = SIG; chunkTgz = false;
    const before = hits;
    const r = await api.suiteAutoUpdate('test', opts(d));
    assert.equal(r.reason, 'url-origin-mismatch', 'a foreign download origin must be refused: ' + JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY for a foreign-origin manifest');
    assert.ok(!existsSync(tgzPath(d)), 'nothing staged for a foreign-origin manifest');
    assert.equal(hits - before, 1, 'only the manifest (1 hit) is fetched — the foreign host is never contacted');
  } finally { manifest = null; rmSync(d, { recursive: true, force: true }); }
});

test('[size cap] an over-cap Content-Length is refused before buffering — no READY', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = SIG; chunkTgz = false;   // TGZ is 2048B; cap it at 1024 via the test hook
    const r = await api.suiteAutoUpdate('test', opts(d, { maxBundleBytes: 1024 }));
    assert.equal(r.reason, 'too-large', 'a bundle over the cap must be refused: ' + JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY when the bundle exceeds the cap');
    assert.ok(!existsSync(tgzPath(d)), 'nothing staged when the bundle exceeds the cap');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('[size cap] a chunked (no Content-Length) over-cap body is aborted mid-stream — no READY', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = SIG; chunkTgz = true;    // served chunked: no Content-Length, so ONLY the stream guard can catch it
    const r = await api.suiteAutoUpdate('test', opts(d, { maxBundleBytes: 1024 }));
    assert.equal(r.reason, 'too-large', 'an over-cap streamed body must be aborted: ' + JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY when the streamed body exceeds the cap');
    assert.ok(!existsSync(tgzPath(d)), 'nothing staged when the streamed body exceeds the cap');
  } finally { chunkTgz = false; rmSync(d, { recursive: true, force: true }); }
});

test('[verify-in-.tmp] a forged newer-dated bad-sig manifest leaves a previously-good staged bundle intact', async () => {
  const d = freshDataDir();
  try {
    // 1) stage a genuinely-good bundle: READY + bundle.tgz/.sig all present and valid.
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = SIG; chunkTgz = false;
    const first = await api.suiteAutoUpdate('test', opts(d));
    assert.ok(first.ok && first.staged, 'precondition: a good bundle stages: ' + JSON.stringify(first));
    const goodTgz = readFileSync(tgzPath(d));
    const goodSig = readFileSync(sigPath(d));
    const goodReady = readFileSync(readyPath(d), 'utf8');
    // 2) a forged manifest: NEWER date (passes the pre-gate) but the signature is over the WRONG bytes.
    manifest = { sha: 'f'.repeat(40), date: '2026-07-01T00:00:00Z', version: 'v3' };
    serveTgz = TGZ;
    serveSig = cryptoSign(null, Buffer.from('forged — signed over the WRONG bytes'), privateKey);
    const r = await api.suiteAutoUpdate('test', opts(d));
    assert.equal(r.reason, 'bad-signature', 'the forged bundle must be refused at verify: ' + JSON.stringify(r));
    // 3) the ORIGINAL good staged bundle must be exactly as it was — the forged bytes never landed.
    assert.ok(existsSync(tgzPath(d)) && existsSync(sigPath(d)) && existsSync(readyPath(d)), 'the good staged bundle survives');
    assert.ok(readFileSync(tgzPath(d)).equals(goodTgz), 'bundle.tgz is unchanged by the forged attempt');
    assert.ok(readFileSync(sigPath(d)).equals(goodSig), 'bundle.sig is unchanged by the forged attempt');
    assert.equal(readFileSync(readyPath(d), 'utf8'), goodReady, 'READY still points at the good v2, not the forged v3');
    assert.ok(!existsSync(join(d, 'suite', 'staging', '.tmp')), '.tmp is cleaned up on the failure path');
  } finally { manifest = null; rmSync(d, { recursive: true, force: true }); }
});

test('[date] anti-rollback / newness decide by INSTANT, not lexicographic string (TZ offsets)', () => {
  // A later wall-clock STRING that is an EARLIER instant must NOT count as newer.
  // mine = 2026-06-01T00:00:00Z ; remote string "…T01:00:00+05:00" = 2026-05-31T20:00:00Z (earlier instant).
  const mineA = { sha: 'b'.repeat(40), date: '2026-06-01T00:00:00Z' };
  assert.equal(api.suiteIsNewer({ sha: 'a'.repeat(40), date: '2026-06-01T01:00:00+05:00' }, mineA), false,
    'a lexicographically-later but chronologically-earlier date is NOT newer');
  // An earlier wall-clock STRING that is a LATER instant MUST count as newer.
  // mine = 2026-06-01T05:00:00+05:00 = 2026-06-01T00:00:00Z ; remote "…T01:00:00Z" is a later instant but a smaller string.
  const mineB = { sha: 'b'.repeat(40), date: '2026-06-01T05:00:00+05:00' };
  assert.equal(api.suiteIsNewer({ sha: 'a'.repeat(40), date: '2026-06-01T01:00:00Z' }, mineB), true,
    'a lexicographically-smaller but chronologically-later date IS newer');
  // An unparseable remote date is refused.
  assert.equal(api.suiteIsNewer({ sha: 'a'.repeat(40), date: 'not-a-date' }, mineA), false, 'an unparseable date is refused');
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

// ── audit AUDIT-suite-autoupdate-be258b42 HIGH 2: ordering comes from the SIGNED version.txt, not the manifest ──
// suite-latest.json is unsigned. Each case below has a manifest that passes the pre-download gate; only the
// identity inside the signed bytes can (and must) refuse it. Each goes red if step 6 reads the manifest again.

const NOW = Date.parse('2026-11-13T00:00:00Z');

test('[signed date] a manifest claiming a NEW date over an OLD signed bundle is refused (forged-manifest rollback)', async () => {
  const d = freshDataDir();
  try {
    // The attacker re-points the manifest at an old genuine bundle (signed date 2025-12, older than this box's
    // 2026-01 build) and writes a fresh date so the pre-download gate passes.
    const old = suiteTgz('c'.repeat(40), '2025-12-01T00:00:00Z');
    manifest = { sha: 'c'.repeat(40), date: '2026-11-01T00:00:00Z', version: 'looks-new' };
    serveTgz = old; serveSig = signTgz(old);
    const r = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.equal(r.reason, 'anti-rollback', 'an old signed bundle under a forged new date must be refused: ' + JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY');
  } finally { manifest = null; serveTgz = TGZ; serveSig = SIG; rmSync(d, { recursive: true, force: true }); }
});

test('[signed sha] a manifest naming one sha over a bundle signed as another is refused', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'd'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };   // the bytes are sha a…
    serveTgz = TGZ; serveSig = SIG;
    const r = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.equal(r.reason, 'sha-mismatch', JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY');
  } finally { manifest = null; rmSync(d, { recursive: true, force: true }); }
});

test('[future date] a validly signed bundle dated far in the future is refused (it would freeze updates)', async () => {
  const d = freshDataDir();
  try {
    const fut = suiteTgz('e'.repeat(40), '2099-01-01T00:00:00Z');
    manifest = { sha: 'e'.repeat(40), date: '2099-01-01T00:00:00Z', version: 'v2099' };
    serveTgz = fut; serveSig = signTgz(fut);
    const r = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.equal(r.reason, 'future-date', JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY');
  } finally { manifest = null; serveTgz = TGZ; serveSig = SIG; rmSync(d, { recursive: true, force: true }); }
});

test('[clock] an installedDate beyond the clock (the clock went back) refuses rather than dropping the floor', async () => {
  const d = freshDataDir();
  try {
    mkdirSync(join(d, 'suite'), { recursive: true });
    writeFileSync(join(d, 'suite', 'state.json'), JSON.stringify({ installedDate: '2099-01-01T00:00:00Z' }));
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = SIG;
    const r = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.equal(r.reason, 'clock-looks-wrong', JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY');
  } finally { manifest = null; rmSync(d, { recursive: true, force: true }); }
});

test('[bundle kind] a validly signed SERVER-shaped bundle (no release-origin) is refused', async () => {
  const d = freshDataDir();
  try {
    const server = suiteTgz('a'.repeat(40), '2026-06-01T00:00:00Z', { 'release-origin': null });
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = server; serveSig = signTgz(server);
    const r = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.equal(r.reason, 'not-a-suite-bundle', JSON.stringify(r));
    assert.ok(!existsSync(readyPath(d)), 'no READY');
  } finally { manifest = null; serveTgz = TGZ; serveSig = SIG; rmSync(d, { recursive: true, force: true }); }
});

test('[READY] carries the SIGNED sha + date even when the manifest date differs', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'a'.repeat(40), date: '2026-10-30T00:00:00Z', version: 'v2' };   // manifest says Oct; bytes say June
    serveTgz = TGZ; serveSig = SIG;
    const r = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.ok(r.ok && r.staged, JSON.stringify(r));
    assert.deepEqual(JSON.parse(readFileSync(readyPath(d), 'utf8')), { version: 'v2', sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z' });
  } finally { manifest = null; rmSync(d, { recursive: true, force: true }); }
});

// ── audit AUDIT-suite-autoupdate-be258b42 MEDIUM 2: never re-download what is staged, quarantined or known bad;
//    fetch the small signature before the bundle. Each counts requests per path on the localhost fixture. ─────
const bundleHits = () => pathHits['/suite-js-bundle.tgz'] || 0;
const sigHits = () => pathHits['/suite-js-bundle.sig'] || 0;

test('[M2] a release already staged is not downloaded again on the next hourly check', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = SIG;
    const first = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.ok(first.ok && first.staged, JSON.stringify(first));
    const ready = readFileSync(readyPath(d), 'utf8');
    const b0 = bundleHits(), s0 = sigHits();
    const again = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.equal(again.reason, 'already-staged', JSON.stringify(again));
    assert.equal(bundleHits() - b0, 0, 'the staged bundle was downloaded again');
    assert.equal(sigHits() - s0, 0, 'the staged signature was downloaded again');
    assert.equal(readFileSync(readyPath(d), 'utf8'), ready, 'READY must be untouched');
  } finally { manifest = null; rmSync(d, { recursive: true, force: true }); }
});

test('[M2] a quarantined release (it failed an install) is never downloaded again', async () => {
  const d = freshDataDir();
  try {
    mkdirSync(join(d, 'suite'), { recursive: true });
    writeFileSync(join(d, 'suite', 'quarantine-sha'), 'a'.repeat(40) + '\n');
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = SIG;
    const b0 = bundleHits(), s0 = sigHits();
    const r = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.equal(r.reason, 'quarantined', JSON.stringify(r));
    assert.equal(bundleHits() - b0 + sigHits() - s0, 0, 'a quarantined release was downloaded');
    assert.ok(!existsSync(readyPath(d)), 'no READY');
  } finally { manifest = null; rmSync(d, { recursive: true, force: true }); }
});

test('[M2] a release refused for its signature is not re-downloaded every hour (6h back-off), then retried', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = cryptoSign(null, Buffer.from('wrong bytes'), privateKey);
    const r1 = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.equal(r1.reason, 'bad-signature', JSON.stringify(r1));
    const b0 = bundleHits();
    const r2 = await api.suiteAutoUpdate('test', opts(d, { now: NOW + 3600e3 }));
    assert.equal(r2.reason, 'bad-signature', JSON.stringify(r2));
    assert.equal(r2.skipped, 'known-bad');
    assert.equal(bundleHits() - b0, 0, 'the same bad release was downloaded again an hour later');
    // Hourly checks, as production does them: skipped up to +5 h, downloaded again once 6 h have passed since
    // the REFUSAL (not since the last skip — audit f4129a25 MEDIUM 1: the skips must not extend the back-off).
    for (let h = 2; h <= 5; h++) {
      const r = await api.suiteAutoUpdate('test', opts(d, { now: NOW + h * 3600e3 }));
      assert.equal(r.skipped, 'known-bad', 'hour ' + h + ': ' + JSON.stringify(r));
    }
    assert.equal(bundleHits() - b0, 0, 'downloaded inside the back-off');
    serveSig = SIG;   // the release is fixed meanwhile
    const r6 = await api.suiteAutoUpdate('test', opts(d, { now: NOW + 6 * 3600e3 + 1000 }));
    assert.equal(bundleHits() - b0, 1, 'after the back-off the release is checked again');
    assert.ok(r6.ok && r6.staged, 'the fixed release stages: ' + JSON.stringify(r6));
  } finally { manifest = null; serveSig = SIG; rmSync(d, { recursive: true, force: true }); }
});

test('[M2] the signature is fetched FIRST: a release whose .sig is not up yet costs no bundle download', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    serveTgz = TGZ; serveSig = SIG; sigMissing = true;
    const b0 = bundleHits(), s0 = sigHits();
    const r = await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    assert.equal(r.reason, 'signature-missing', JSON.stringify(r));
    assert.equal(sigHits() - s0, 1, 'the signature was asked for');
    assert.equal(bundleHits() - b0, 0, 'the bundle was downloaded although its signature does not exist');
    // and it is NOT a hard refusal: once the .sig is up, the next check stages it
    sigMissing = false;
    const r2 = await api.suiteAutoUpdate('test', opts(d, { now: NOW + 3600e3 }));
    assert.ok(r2.ok && r2.staged, JSON.stringify(r2));
  } finally { manifest = null; sigMissing = false; rmSync(d, { recursive: true, force: true }); }
});

test('[M7] every check past the gate records its outcome in suite/check.json for the panel', async () => {
  const d = freshDataDir();
  try {
    manifest = { sha: 'd'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };   // bytes are sha a… → mismatch
    serveTgz = TGZ; serveSig = SIG;
    await api.suiteAutoUpdate('test', opts(d, { now: NOW }));
    const rec = JSON.parse(readFileSync(join(d, 'suite', 'check.json'), 'utf8'));
    assert.deepEqual(rec, { at: new Date(NOW).toISOString(), ok: false, reason: 'sha-mismatch', sha: 'd'.repeat(40) });
    manifest = { sha: 'a'.repeat(40), date: '2026-06-01T00:00:00Z', version: 'v2' };
    await api.suiteAutoUpdate('test', opts(d, { now: NOW + 1000 }));
    const rec2 = JSON.parse(readFileSync(join(d, 'suite', 'check.json'), 'utf8'));
    assert.equal(rec2.ok, true); assert.equal(rec2.reason, 'staged'); assert.equal(rec2.sha, 'a'.repeat(40));
  } finally { manifest = null; rmSync(d, { recursive: true, force: true }); }
});
