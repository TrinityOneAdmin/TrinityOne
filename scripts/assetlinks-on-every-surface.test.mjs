// Android App Links stand or fall on /.well-known/assetlinks.json: Android fetches it from EVERY host the
// manifest claims with autoVerify, and a host that fails to serve it (or serves a wrong fingerprint) keeps
// invites opening in the browser — silently, with nothing red anywhere. QR links are served from two
// surfaces (the box gateway behind app.trinityone.church / trinityone.church, and the Cloudflare Pages
// deploy built by scripts/build-pages.sh), so the SAME document must come off both, and its fingerprint
// must be the release signing certificate's — a debug or rotated cert verifies nothing.
//
// Run:  node --test scripts/assetlinks-on-every-surface.test.mjs
//
// The fingerprint below is the release keystore's SHA-256, extracted with `keytool -list` from
// android/app/release.keystore (alias trinityone) on 2026-11-24. It is PUBLIC by design — a checksum of a
// certificate every installed APK already carries. The keystore itself stays out of tests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8822;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const ROOT = new URL('..', import.meta.url).pathname;
const url = p => `http://127.0.0.1:${PORT}${p}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const RELEASE_FP = '9A:51:21:F0:9D:60:6B:83:E7:0F:19:22:06:CD:C6:17:05:2A:49:41:79:97:B8:24:C6:BB:97:97:AD:8C:A6:00';
const PACKAGE = 'com.trinityone.app';

let relay, dataDir;
before(async () => {
  await requireFreePort(PORT, 'assetlinks-on-every-surface.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-assetlinks-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '2000' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(url('/status')); if (r.ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay.kill(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

function assertAssetlinks(doc, where) {
  assert.ok(Array.isArray(doc) && doc.length >= 1, where + ': assetlinks.json must be a non-empty array');
  const member = doc.find(s => s && s.target && s.target.package_name === PACKAGE);
  assert.ok(member, where + ': no statement for ' + PACKAGE + ' — Android would verify nothing');
  assert.ok(member.relation.includes('delegate_permission/common.handle_all_urls'),
    where + ': without handle_all_urls the statement grants nothing');
  assert.equal(member.target.namespace, 'android_app', where);
  const fps = member.target.sha256_cert_fingerprints;
  assert.ok(Array.isArray(fps) && fps.length >= 1, where + ': no fingerprints');
  for (const fp of fps) {
    assert.match(fp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/,
      where + ': a fingerprint must be 32 colon-separated upper-case hex pairs, got ' + fp);
  }
  assert.ok(fps.includes(RELEASE_FP),
    where + ': the RELEASE cert fingerprint is missing — the shipped APK would never verify. ' +
    'If the release key really rotated, update RELEASE_FP here from `keytool -list -v` on the release keystore.');
}

test('the gateway serves /.well-known/assetlinks.json for the release APK', async () => {
  const r = await fetch(url('/.well-known/assetlinks.json'));
  assert.equal(r.status, 200, 'the assetlinks route is gone — Android App Link verification is dead fleet-wide');
  assert.match(r.headers.get('content-type') || '', /application\/json/);
  assertAssetlinks(await r.json(), 'gateway');
});

test('the assetlinks allow stays NARROW: other dotfiles still 404', async () => {
  for (const p of ['/.wellknown-evil', '/.git/config', '/.well-known/evil.json', '/.well-known/', '/.relay-lock']) {
    const r = await fetch(url(p));
    await r.arrayBuffer();
    assert.equal(r.status, 404, p + ' must stay denied — the dot-segment deny is a security boundary, ' +
      'the assetlinks route is the one exact exception');
  }
});

test('the tracked .well-known/assetlinks.json (the Pages copy) matches what the gateway serves', async () => {
  const tracked = JSON.parse(readFileSync(join(ROOT, '.well-known/assetlinks.json'), 'utf8'));
  assertAssetlinks(tracked, 'tracked file');
  const served = await (await fetch(url('/.well-known/assetlinks.json'))).json();
  assert.deepEqual(tracked, served,
    'the two serving surfaces disagree — gateway (scripts/gateway.mjs ANDROID_CERT_SHA256) and the tracked ' +
    '.well-known/assetlinks.json must carry the same statement or one host verifies and the other does not');
});

test('the gateway source default fingerprint is the release fingerprint', () => {
  // config extraction from server source (scripts/, not app/*.jsx): the env default is what every
  // deployment that sets nothing actually serves.
  const src = readFileSync(join(ROOT, 'scripts/gateway.mjs'), 'utf8');
  const m = src.match(/ANDROID_CERT_SHA256 \|\| '([0-9A-F:]+)'/);
  assert.ok(m, 'ANDROID_CERT_SHA256 default missing from scripts/gateway.mjs');
  assert.equal(m[1], RELEASE_FP, 'gateway default fingerprint is not the release cert — verification would fail everywhere');
});

test('when the gradle config is on disk, the applicationId is the one the statement names', () => {
  // android/app/build.gradle is untracked (it holds the signing config paths), so worktrees and fresh
  // clones do not have it; assert only where it exists rather than skipping the claim everywhere.
  const gradle = join(ROOT, 'android/app/build.gradle');
  if (!existsSync(gradle)) return;
  assert.ok(readFileSync(gradle, 'utf8').includes('applicationId "' + PACKAGE + '"'),
    'build.gradle applicationId differs from assetlinks package_name — Android would verify a package that is not installed');
});

test('the Pages build ships the same assetlinks.json (build-pages.sh keeps .well-known)', { timeout: 300000 }, () => {
  // build-pages.sh archives HEAD, so this proves the COMMITTED file survives every removal/sweep step.
  // PAGES_OUT keeps the build out of pages-dist so a concurrent release is never clobbered.
  const out = mkdtempSync(join(tmpdir(), 'trin-pages-'));
  try {
    execFileSync('bash', ['scripts/build-pages.sh'], {
      cwd: ROOT, env: { ...process.env, PAGES_OUT: join(out, 'dist') }, stdio: 'pipe', timeout: 280000,
    });
    const built = join(out, 'dist/.well-known/assetlinks.json');
    assert.ok(existsSync(built), 'pages build lost .well-known/assetlinks.json — the Pages host would fail verification');
    assert.deepEqual(JSON.parse(readFileSync(built, 'utf8')),
      JSON.parse(readFileSync(join(ROOT, '.well-known/assetlinks.json'), 'utf8')),
      'the Pages copy drifted from the tracked file');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
