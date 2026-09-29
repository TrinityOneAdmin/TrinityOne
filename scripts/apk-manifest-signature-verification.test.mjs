// THE GATEWAY REFUSES AN APK WHOSE HASH DOES NOT MATCH A SIGNED MANIFEST.
// Run: node --test scripts/apk-manifest-signature-verification.test.mjs
//
// R-9 (audit 2026-09-27). The gateway pulls APKs from an origin and hands them to members. Before this fix
// it trusted whatever the origin served — a compromised origin or MITM could substitute a malicious APK and
// the box would serve it as its own. The fix: the release script signs an apk-manifest.json (sha256 of each
// APK) with the Ed25519 release key. The gateway fetches the manifest + detached signature, verifies it
// against the release pubkey baked into its own tree, and refuses any download whose hash does not match.
//
// Callers of the changed code: fetchApksFromOrigin() is called from the POST /relay-app/fetch-apk handler
// and from the automatic APK refresh timer. Both use the same function, so this test covers both paths.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, createPrivateKey, sign as cryptoSign, createHash } from 'node:crypto';
import * as H from './relay-network-harness.mjs';

const ROOT = H.ROOT;
const sleep = H.sleep;

// A fake APK — only needs to be > 1 MB (the gateway's minimum size check).
const GOOD_APK = Buffer.alloc(1_200_000, 0x41);
const TAMPERED_APK = Buffer.alloc(1_200_000, 0x42);
const sha = buf => createHash('sha256').update(buf).digest('hex');

// Generate a test Ed25519 keypair. The gateway reads the pubkey from RELEASE_PUBKEY_PATH.
const { publicKey: testPub, privateKey: testPriv } = generateKeyPairSync('ed25519');
function signManifest(manifestJson) {
  const buf = Buffer.from(manifestJson);
  const sig = cryptoSign(null, buf, testPriv);
  return { manifestBuf: buf, sigBuf: sig };
}
function goodManifest() {
  const m = JSON.stringify({
    'trinityone.apk': { sha256: sha(GOOD_APK), versionCode: 300, versionName: '1.0.0', date: '2026-09-29' },
    'trinityone-steward.apk': { sha256: sha(GOOD_APK), versionCode: 300, versionName: '1.0.0', date: '2026-09-29' },
  });
  return signManifest(m);
}

let origin, box, dataDir, token, base, pubKeyPath;

// What the origin serves — switchable mid-test.
let serveApk = GOOD_APK;
let serveManifest = null;   // { manifestBuf, sigBuf } or null (no manifest)

async function startBox() {
  const port = await H.freePort('apk-sig-box');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-apksig-'));
  writeFileSync(join(dataDir, 'origin'), origin.base);
  box = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELEASE_PUBKEY_PATH: pubKeyPath },
  });
  box.stdout.resume(); box.stderr.resume();
  base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { await sleep(200); try { if ((await fetch(base + '/status')).ok) break; } catch {} }
  token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || '';
}

const auth = () => ({ Authorization: 'Bearer ' + token });
const fetchApk = () => fetch(base + '/relay-app/fetch-apk', { method: 'POST', headers: auth() }).then(r => r.json());
const apkStatus = () => fetch(base + '/relay-app/apk-status', { headers: auth(), cache: 'no-store' }).then(r => r.json());

before(async () => {
  // Write the test public key to a temp file
  pubKeyPath = join(tmpdir(), 'trin-test-release-pubkey-' + process.pid + '.pem');
  writeFileSync(pubKeyPath, testPub.export({ type: 'spki', format: 'pem' }));

  origin = await H.startImpostor({
    name: 'apk-origin',
    handler: (req, res, url) => {
      if (url.pathname === '/apk-latest.json') return H.sendJson(res, { versionCode: 300, versionName: '1.0.0', date: '2026-09-29' });
      if (url.pathname === '/apk-manifest.json' && serveManifest) {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(serveManifest.manifestBuf); return;
      }
      if (url.pathname === '/apk-manifest.sig' && serveManifest) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(serveManifest.sigBuf); return;
      }
      if (url.pathname === '/trinityone.apk' || url.pathname === '/trinityone-steward.apk') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': serveApk.length });
        if (req.method === 'HEAD') { res.end(); return; }
        res.end(serveApk); return;
      }
      res.writeHead(404); res.end('not found');
    },
  });

  serveManifest = null;
  await startBox();
});
after(() => {
  try { box && box.kill('SIGKILL'); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { rmSync(pubKeyPath); } catch {}
  H.stopAll();
});

// ── §1 · CONTROL: without a manifest, the fetch still works (unverified) ─────────────────────────────────
test('CONTROL: an origin with no manifest serves APKs normally (unverified)', async () => {
  serveManifest = null;
  serveApk = GOOD_APK;
  const r = await fetchApk();
  assert.ok(!r.error, 'fetch failed: ' + JSON.stringify(r));
  const s = await apkStatus();
  const f = s.files && s.files.find(x => x.name === 'trinityone.apk');
  assert.ok(f && f.present, 'APK not on disk');
  assert.equal(f.verified, false, 'an unsigned APK should not be marked verified');
});

// ── §2 · a correctly signed manifest passes, and the APK is marked verified ──────────────────────────────
test('a correctly signed manifest marks the APK as verified', async () => {
  serveManifest = goodManifest();
  serveApk = GOOD_APK;
  const r = await fetchApk();
  assert.ok(!r.error, 'fetch failed: ' + JSON.stringify(r));
  const s = await apkStatus();
  const f = s.files && s.files.find(x => x.name === 'trinityone.apk');
  assert.ok(f && f.present, 'APK not on disk after verified fetch');
  assert.equal(f.verified, true,
    'the APK was not marked verified even though the manifest signature checked out and the hash matched');
});

// ── §3 · THE SECURITY PROPERTY: a hash mismatch REFUSES the APK ─────────────────────────────────────────
test('R-9: a tampered APK is REFUSED when the manifest hash does not match', async () => {
  serveManifest = goodManifest();
  serveApk = TAMPERED_APK;
  const r = await fetchApk();
  const files = r.files || {};
  const member = files['trinityone.apk'] || {};
  assert.equal(member.ok, false,
    'THE HOLE: a tampered APK was accepted even though its hash did not match the signed manifest. ' +
    'Result: ' + JSON.stringify(r));
  assert.ok((member.error || '').includes('does not match the signed manifest'),
    'the error message should say the hash does not match: ' + member.error);
});

// ── §4 · a manifest signed with the WRONG key is not trusted ─────────────────────────────────────────────
test('a manifest signed with an unknown key is treated as unsigned', async () => {
  const { privateKey: wrongPriv } = generateKeyPairSync('ed25519');
  const m = JSON.stringify({
    'trinityone.apk': { sha256: sha(GOOD_APK), versionCode: 300, versionName: '1.0.0', date: '2026-09-29' },
    'trinityone-steward.apk': { sha256: sha(GOOD_APK), versionCode: 300, versionName: '1.0.0', date: '2026-09-29' },
  });
  const badSig = cryptoSign(null, Buffer.from(m), wrongPriv);
  serveManifest = { manifestBuf: Buffer.from(m), sigBuf: badSig };
  serveApk = GOOD_APK;
  const r = await fetchApk();
  assert.ok(r.error && r.error.includes('does not trust'),
    'a manifest signed by an unknown key should be refused with a trust error, got: ' + JSON.stringify(r));
});
