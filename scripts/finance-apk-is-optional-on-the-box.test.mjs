// A BOX THAT KNOWS THE FINANCE APP MUST NOT BREAK ON A RELEASE THAT HAS NOT SHIPPED IT YET.
// Run: node --test scripts/finance-apk-is-optional-on-the-box.test.mjs
//
// T1Finance step 4 / audit F10 (2026-11-17). scripts/gateway.mjs lists trinityone-finance.apk in APK_NAMES so a box
// can hand the finance app out. But gateways, origins and signed apk-manifests already exist that know nothing of
// it, and the gateway refuses any APK the signed manifest does not list. So a gateway that lists finance can meet a
// manifest that does not — and then it must treat finance as NOT OFFERED: no error, nothing downloaded, no "behind",
// and the member + steward installers fetched, verified and served exactly as before.
//
// Driven through the real HTTP surface of a real gateway process (POST /relay-app/fetch-apk, GET
// /relay-app/apk-status, GET /trinityone-finance.apk, GET /install) against a fake update origin with a test
// Ed25519 release key, the same rig as apk-manifest-signature-verification.test.mjs.
// Callers of the changed code: fetchApksFromOrigin() (the fetch-apk button + apkAutoRefresh), originApkFacts()
// (apk-status + apkAutoRefresh), heldApks() (apk-status, /install, /install.json, the .apk route), the .apk route.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign as cryptoSign, createHash } from 'node:crypto';
import * as H from './relay-network-harness.mjs';

const ROOT = H.ROOT;
const sleep = H.sleep;
const MEMBER = Buffer.alloc(1_200_000, 0x41);
const STEWARD = Buffer.alloc(1_300_000, 0x42);
const FINANCE = Buffer.alloc(1_400_000, 0x43);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const { publicKey: pub, privateKey: priv } = generateKeyPairSync('ed25519');
const entry = (b) => ({ sha256: sha(b), versionCode: 300, versionName: '1.0.0', date: '2026-11-17' });
const signed = (obj) => { const buf = Buffer.from(JSON.stringify(obj)); return { m: buf, s: cryptoSign(null, buf, priv) }; };

let origin, box, dataDir, token, base, pubKeyPath;
let serveManifest = null;       // { m, s } or null
let serveFinance = null;        // Buffer or null (404)
const hits = [];                // every path the origin was asked for, with its method

before(async () => {
  pubKeyPath = join(tmpdir(), 'trin-fin-opt-pub-' + process.pid + '.pem');
  writeFileSync(pubKeyPath, pub.export({ type: 'spki', format: 'pem' }));
  origin = await H.startImpostor({
    name: 'fin-origin',
    handler: (req, res, url) => {
      hits.push(req.method + ' ' + url.pathname);
      if (url.pathname === '/apk-latest.json') return H.sendJson(res, { versionCode: 300, versionName: '1.0.0', date: '2026-11-17' });
      if (url.pathname === '/apk-manifest.json' && serveManifest) { res.writeHead(200); res.end(serveManifest.m); return; }
      if (url.pathname === '/apk-manifest.sig' && serveManifest) { res.writeHead(200); res.end(serveManifest.s); return; }
      const body = { '/trinityone.apk': MEMBER, '/trinityone-steward.apk': STEWARD, '/trinityone-finance.apk': serveFinance }[url.pathname];
      if (body) {
        res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': body.length });
        if (req.method === 'HEAD') { res.end(); return; }
        res.end(body); return;
      }
      res.writeHead(404); res.end('not found');
    },
  });
  const port = await H.freePort('fin-opt-box');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-finopt-'));
  writeFileSync(join(dataDir, 'origin'), origin.base);
  box = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELEASE_PUBKEY_PATH: pubKeyPath },
  });
  box.stdout.resume(); box.stderr.resume();
  base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { await sleep(200); try { if ((await fetch(base + '/status')).ok) break; } catch {} }
  token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || '';
});
after(() => {
  try { box && box.kill('SIGKILL'); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { rmSync(pubKeyPath); } catch {}
  H.stopAll();
});

const auth = () => ({ Authorization: 'Bearer ' + token });
const fetchApk = async () => { const r = await fetch(base + '/relay-app/fetch-apk', { method: 'POST', headers: auth() }); return { status: r.status, body: await r.json() }; };
const apkStatus = () => fetch(base + '/relay-app/apk-status', { headers: auth(), cache: 'no-store' }).then((r) => r.json());
const download = async (name) => { const r = await fetch(base + '/' + name, { cache: 'no-store' }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), cd: r.headers.get('content-disposition') || '' }; };
const held = (name) => join(dataDir, 'apks', name);

test('F10: a signed manifest WITHOUT a finance entry — finance is not offered (not fetched, no error), member + steward fetched, verified and served', async () => {
  // the worst order: the origin even HAS finance bytes, but the signed manifest (made before finance) does not list them
  serveManifest = signed({ 'trinityone.apk': entry(MEMBER), 'trinityone-steward.apk': entry(STEWARD) });
  serveFinance = FINANCE;
  hits.length = 0;
  const r = await fetchApk();
  assert.equal(r.status, 200, 'fetch-apk failed outright: ' + JSON.stringify(r.body));
  const files = r.body.files || {};
  assert.deepEqual(Object.keys(files).sort(), ['trinityone-steward.apk', 'trinityone.apk'],
    'the result should name exactly member + steward; a finance entry here is printed by the panel as a failure: ' + JSON.stringify(files));
  assert.equal(files['trinityone.apk'].ok, true); assert.equal(files['trinityone.apk'].verified, true);
  assert.equal(files['trinityone-steward.apk'].ok, true); assert.equal(files['trinityone-steward.apk'].verified, true);
  assert.ok(!hits.includes('GET /trinityone-finance.apk'), 'the box downloaded a finance APK the signed manifest does not list');
  assert.ok(!existsSync(held('trinityone-finance.apk')), 'an unlisted finance APK landed on disk');
  // served: member + steward bytes; finance is not handed out
  const m = await download('trinityone.apk'); assert.equal(m.status, 200); assert.ok(m.buf.equals(MEMBER), 'member bytes not served');
  const st = await download('trinityone-steward.apk'); assert.equal(st.status, 200); assert.ok(st.buf.equals(STEWARD), 'steward bytes not served');
  const f = await download('trinityone-finance.apk');
  assert.ok(!f.buf.equals(FINANCE), 'the box handed out a finance APK it never verified');
  // status: no finance row, and NOT behind (else the auto-refresh would re-fetch the other two every six hours)
  const s = await apkStatus();
  assert.deepEqual(s.files.map((x) => x.name).sort(), ['trinityone-steward.apk', 'trinityone.apk'], 'apk-status shows a finance row for an app nobody offers');
  assert.equal(s.behind, false, 'an unlisted finance APK made the box read as behind');
  assert.equal(s.holding, 2);
});

test('F10: no manifest and no finance file on the origin — finance simply absent; member + steward fetched (unverified, as before)', async () => {
  serveManifest = null; serveFinance = null;
  const r = await fetchApk();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body.files || {}).sort(), ['trinityone-steward.apk', 'trinityone.apk'], 'a 404 for finance was reported: ' + JSON.stringify(r.body.files));
  assert.ok(Object.values(r.body.files).every((x) => x.ok), JSON.stringify(r.body.files));
  const s = await apkStatus();
  assert.ok(!s.files.some((x) => x.name === 'trinityone-finance.apk'), 'apk-status shows a finance row with nothing held or offered');
  assert.equal(s.behind, false);
});

test('a signed manifest WITH a finance entry — the box fetches, verifies, lists and serves /trinityone-finance.apk', async () => {
  serveManifest = signed({ 'trinityone.apk': entry(MEMBER), 'trinityone-steward.apk': entry(STEWARD), 'trinityone-finance.apk': entry(FINANCE) });
  serveFinance = FINANCE;
  const r = await fetchApk();
  const fin = (r.body.files || {})['trinityone-finance.apk'];
  assert.ok(fin && fin.ok && fin.verified, 'finance not fetched + verified: ' + JSON.stringify(r.body));
  const d = await download('trinityone-finance.apk');
  assert.equal(d.status, 200);
  assert.ok(d.buf.equals(FINANCE), 'GET /trinityone-finance.apk did not serve the verified bytes');
  assert.match(d.cd, /filename="trinityone-finance-1\.0\.0\.apk"/, 'the download is not named from the stamp of the file served');
  const s = await apkStatus();
  const row = s.files.find((x) => x.name === 'trinityone-finance.apk');
  assert.ok(row && row.present && row.verified && row.title === 'TrinityOne Finance', 'finance row missing or wrong: ' + JSON.stringify(row));
  assert.equal(s.behind, false);
  const page = await (await fetch(base + '/install')).text();
  assert.match(page, /href="\/trinityone-finance\.apk"/, 'the install page does not offer the finance app the box holds');
  assert.match(page, /TrinityOne Finance/);
});

test('a finance APK that does NOT match its manifest entry is still refused (optional is not unverified)', async () => {
  serveManifest = signed({ 'trinityone.apk': entry(MEMBER), 'trinityone-steward.apk': entry(STEWARD), 'trinityone-finance.apk': entry(FINANCE) });
  serveFinance = Buffer.alloc(1_400_000, 0x44);
  const r = await fetchApk();
  const fin = (r.body.files || {})['trinityone-finance.apk'] || {};
  assert.equal(fin.ok, false, 'a tampered finance APK was accepted: ' + JSON.stringify(r.body));
  assert.match(fin.error || '', /does not match the signed manifest/);
  assert.ok(readFileSync(held('trinityone-finance.apk')).equals(FINANCE), 'the tampered bytes replaced the verified ones');
});

// ═══════════ AUDIT of e82a4754..4fa70b63 (2026-11-17): A3, A4 ═══════════

test('A3: no manifest, and the origin answers the finance name with a small 200 page (not an installer) — not "behind", and turning on the auto-refresh re-downloads nothing', async () => {
  serveManifest = null;
  serveFinance = Buffer.from('<!DOCTYPE html><html><body>index fallback</body></html>');
  // a box that never held finance (the earlier tests left a verified copy; take it away)
  rmSync(held('trinityone-finance.apk'), { force: true });
  // member + steward on disk match what the origin serves (fetched in the earlier tests)
  const s = await apkStatus();
  assert.ok(!s.files.some((x) => x.name === 'trinityone-finance.apk'), 'a small HTML answer was counted as a finance installer on offer: ' + JSON.stringify(s.files));
  assert.equal(s.behind, false, 'a small HTML answer for the finance name made the box read as behind');
  hits.length = 0;
  const r = await fetch(base + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ keepApkCurrent: true }) });
  assert.equal(r.status, 200, 'the setting could not be saved');
  await sleep(1500);   // the forced refresh runs in the background: give it time to (wrongly) download
  assert.ok(hits.some((h) => h.startsWith('HEAD ')), 'fixture: the forced refresh never asked the origin anything');
  const gets = hits.filter((h) => /^GET \/trinityone(-steward|-finance)?\.apk$/.test(h));
  assert.deepEqual(gets, [], 'the auto-refresh re-downloaded installers over a finance name the origin does not really offer');
  await fetch(base + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ keepApkCurrent: false }) });
});

test('A4: a signed manifest that LISTS finance while the origin 404s it, or sends too little — reported as a finance FAILURE; member + steward still fetched', async () => {
  serveManifest = signed({ 'trinityone.apk': entry(MEMBER), 'trinityone-steward.apk': entry(STEWARD), 'trinityone-finance.apk': entry(FINANCE) });
  for (const [what, body, re] of [['404', null, /HTTP 404/], ['too small', Buffer.from('<html>nope</html>'), /too small/]]) {
    serveFinance = body;
    const r = await fetchApk();
    assert.equal(r.status, 200, what + ': fetch-apk failed outright: ' + JSON.stringify(r.body));
    const files = r.body.files || {};
    assert.equal(files['trinityone.apk'] && files['trinityone.apk'].ok, true, what + ': member not fetched');
    assert.equal(files['trinityone-steward.apk'] && files['trinityone-steward.apk'].ok, true, what + ': steward not fetched');
    const fin = files['trinityone-finance.apk'];
    assert.ok(fin, what + ': a listed finance APK that could not be fetched was skipped silently: ' + JSON.stringify(files));
    assert.equal(fin.ok, false);
    assert.match(fin.error || '', re, what + ': ' + JSON.stringify(fin));
  }
});
