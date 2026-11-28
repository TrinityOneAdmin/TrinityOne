// WHAT A RELEASE WRITES ABOUT ITS APKS NAMES THE FINANCE APP — AND THE APPS / BOXES THAT READ IT ACT ON IT.
// Run: node --test scripts/apk-release-json.test.mjs
//
// T1Finance step 4 (2026-11-17). scripts/release.sh writes two files about the APKs it built, now through
// scripts/apk-release-json.sh so they can be run without building anything:
//   apk-latest.json   — read by every installed app's UpdateBanner (app/update-check.jsx). Gains financeVersionCode
//                       + financeUrl; the member and steward rows are unchanged.
//   apk-manifest.json — signed with the release key; a box refuses any listed APK whose bytes differ, and offers the
//                       finance app only once this lists it (scripts/finance-apk-is-optional-on-the-box.test.mjs).
//
// POINT OF USE: (1) the apk-latest.json the helper prints is fed to the REAL UpdateBanner (compiled from
// app/update-check.jsx, same harness as finance-update-check-offers-finance-apk.test.mjs) for all three variants and
// its Update button pressed; (2) the REAL release.sh is run in a scratch git tree with a throwaway Ed25519 key —
// --dry (must leave apk-manifest.json/.sig byte for byte as they were: audit A1), and for real with --apk --no-gw,
// where its signed apk-manifest.json is verified exactly as the gateway verifies it; (3) the helper's `sign` and
// `latest --out` on their own, including a failure, which must leave the existing files untouched (audit A1).
// FAKED: the APK bytes, the release key, the Capacitor native layer, and in the real-mode run npm (the test gate),
// gradle, the two console build scripts, sync-web.sh and build-apk-index.sh (stubs that write fake APKs). Nothing is
// built, deployed or committed outside the scratch tree.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash, generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const HELPER = join(ROOT, 'scripts/apk-release-json.sh');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const dirs = [];
after(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch {} }));
const helper = (args) => spawnSync('bash', [HELPER, ...args], { encoding: 'utf8' });

// ── apk-latest.json ────────────────────────────────────────────────────────────────────────────────────────────
async function bannerFor(variant, m) {
  const fr = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward({ hasKey: false }) });
  let answered; const ready = new Promise((r) => { answered = r; });
  window.Capacitor = { isNativePlatform: () => true, Plugins: { App: { getInfo: async () => ({ version: '0.9.50', build: '100' }) } } };
  window.fetch = async () => { answered(); return { ok: true, json: async () => m }; };
  window.Icon = (props) => fr.React.createElement('span', props);
  const mods = loadConsole({ React: fr.React, window, expr: '{ UpdateBanner }', files: ['app/update-check.jsx'] });
  fr.fresh(); fr.reset();
  const props = variant ? { variant } : {};
  mods.UpdateBanner(props); fr.flush();
  await ready; await new Promise((r) => setTimeout(r, 20));
  fr.reset();
  return { tree: mods.UpdateBanner(props), window };
}
function pressUpdate(tree, window) {
  const btn = nodes(tree).filter((n) => n.type === 'button').find((n) => (n.kids || []).some((k) => typeof k === 'string' && k.includes('Update')));
  assert.ok(btn, 'no Update button rendered');
  let opened = null; window.open = (u) => { opened = u; return null; };
  btn.props.onClick();
  return opened;
}

test('apk-latest.json from the helper: member + steward rows as before, plus financeVersionCode / financeUrl', () => {
  const r = helper(['latest', '230', '0.9.80', '2026-11-17']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j, {
    versionCode: 230, versionName: '0.9.80', url: 'trinityone.apk',
    stewardVersionCode: 230, stewardUrl: 'trinityone-steward.apk',
    financeVersionCode: 230, financeUrl: 'trinityone-finance.apk',
    date: '2026-11-17',
  });
  assert.equal(helper(['latest', 'x', '0.9.80', '2026-11-17']).status, 2, 'a non-numeric versionCode was written into the file');
});

for (const [variant, apk] of [[undefined, 'trinityone.apk'], ['steward', 'trinityone-steward.apk'], ['finance', 'trinityone-finance.apk']]) {
  test(`the apk-latest.json a release writes makes the ${variant || 'member'} app offer ${apk} (the real UpdateBanner, Update pressed)`, async () => {
    const m = JSON.parse(helper(['latest', '230', '0.9.80', '2026-11-17']).stdout);
    const { tree, window } = await bannerFor(variant, m);
    assert.notEqual(tree, null, 'no update offered for a newer build');
    const url = pressUpdate(tree, window);
    assert.ok(url && new RegExp('/' + apk.replace(/\./g, '\\.') + '\\?').test(url), `the ${variant || 'member'} app opened the wrong APK: ${url}`);
  });
}

// ── apk-manifest.json ──────────────────────────────────────────────────────────────────────────────────────────
function apks(dir, which = ['trinityone.apk', 'trinityone-steward.apk', 'trinityone-finance.apk']) {
  const bytes = {};
  which.forEach((n, i) => { bytes[n] = Buffer.alloc(2000 + i, 0x41 + i); writeFileSync(join(dir, n), bytes[n]); });
  return bytes;
}

test('apk-manifest.json from the helper: sha256 + version for member, steward AND finance', () => {
  const D = mkdtempSync(join(tmpdir(), 'trin-arj-')); dirs.push(D);
  const b = apks(D);
  const r = helper(['manifest', '230', '0.9.80', '2026-11-17', D]);
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(m).sort(), ['trinityone-finance.apk', 'trinityone-steward.apk', 'trinityone.apk']);
  for (const [n, buf] of Object.entries(b)) assert.deepEqual(m[n], { sha256: sha(buf), versionCode: 230, versionName: '0.9.80', date: '2026-11-17' }, n);
});

test('apk-manifest.json: a missing finance APK FAILS, rather than signing a manifest that omits it', () => {
  const D = mkdtempSync(join(tmpdir(), 'trin-arj-')); dirs.push(D);
  apks(D, ['trinityone.apk', 'trinityone-steward.apk']);
  const r = helper(['manifest', '230', '0.9.80', '2026-11-17', D]);
  assert.notEqual(r.status, 0, 'a manifest was produced without the finance APK');
  assert.equal(r.stdout, '', 'partial manifest text was printed');
});

// ── the helper writing files: all or nothing (audit A1) ────────────────────────────────────────────────────────
const edKey = () => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { publicKey, pem: privateKey.export({ type: 'pkcs8', format: 'pem' }) }; };
const OLD_M = '{"old":"manifest"}\n', OLD_S = Buffer.from('old-signature-bytes');
const seedOld = (D) => { writeFileSync(join(D, 'apk-manifest.json'), OLD_M); writeFileSync(join(D, 'apk-manifest.sig'), OLD_S); };
const leftovers = (D) => readdirSync(D).filter((f) => f.startsWith('.apk-'));

test('helper `sign`: writes apk-manifest.json + .sig that verify, naming all three APKs, replacing the old pair', () => {
  const D = mkdtempSync(join(tmpdir(), 'trin-arj-')); dirs.push(D);
  const b = apks(D); seedOld(D);
  const k = edKey(); writeFileSync(join(D, 'key.pem'), k.pem);
  const r = helper(['sign', '230', '0.9.80', '2026-11-17', join(D, 'key.pem'), D]);
  assert.equal(r.status, 0, r.stderr);
  const m = readFileSync(join(D, 'apk-manifest.json')), sig = readFileSync(join(D, 'apk-manifest.sig'));
  assert.ok(cryptoVerify(null, m, k.publicKey, sig), 'the signature does not verify over the manifest');
  const j = JSON.parse(m.toString('utf8'));
  for (const [n, buf] of Object.entries(b)) assert.equal(j[n].sha256, sha(buf), n);
  assert.deepEqual(leftovers(D), [], 'temp files left behind');
});

test('helper `sign` FAILING (finance APK missing; then a bad key) leaves the existing apk-manifest.json and .sig byte for byte', () => {
  for (const why of ['missing finance APK', 'unusable key']) {
    const D = mkdtempSync(join(tmpdir(), 'trin-arj-')); dirs.push(D);
    apks(D, why === 'missing finance APK' ? ['trinityone.apk', 'trinityone-steward.apk'] : undefined); seedOld(D);
    writeFileSync(join(D, 'key.pem'), why === 'unusable key' ? 'not a key\n' : edKey().pem);
    const r = helper(['sign', '230', '0.9.80', '2026-11-17', join(D, 'key.pem'), D]);
    assert.notEqual(r.status, 0, why + ': the helper reported success');
    assert.equal(readFileSync(join(D, 'apk-manifest.json'), 'utf8'), OLD_M, why + ': apk-manifest.json was changed (truncated?) by a failed run');
    assert.ok(readFileSync(join(D, 'apk-manifest.sig')).equals(OLD_S), why + ': apk-manifest.sig was changed by a failed run');
    assert.deepEqual(leftovers(D), [], why + ': temp files left behind');
  }
});

test('helper `latest --out`: writes the file on success; on failure (bad versionName) the existing apk-latest.json is untouched', () => {
  const D = mkdtempSync(join(tmpdir(), 'trin-arj-')); dirs.push(D);
  const out = join(D, 'apk-latest.json');
  writeFileSync(out, 'OLD\n');
  assert.notEqual(helper(['latest', '230', '', '2026-11-17', '--out', out]).status, 0);
  assert.equal(readFileSync(out, 'utf8'), 'OLD\n', 'a failed run changed apk-latest.json');
  const r = helper(['latest', '230', '0.9.80', '2026-11-17', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(readFileSync(out, 'utf8'), helper(['latest', '230', '0.9.80', '2026-11-17']).stdout, '--out did not write what stdout mode prints');
  assert.deepEqual(leftovers(D), []);
});

// ── the real release.sh in a scratch git tree ──────────────────────────────────────────────────────────────────
const OLD_LATEST = '{\n  "versionCode": 229,\n  "old": true\n}\n';
function releaseTree({ stubs = false, versionName = '0.9.80' } = {}) {
  const T = mkdtempSync(join(tmpdir(), 'trin-rel-')); dirs.push(T);
  const put = (rel, data, mode) => { const p = join(T, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); if (mode) chmodSync(p, mode); return p; };
  for (const s of ['release.sh', 'apk-release-json.sh', 'manifest-member-only.sh']) { mkdirSync(join(T, 'scripts'), { recursive: true }); copyFileSync(join(ROOT, 'scripts', s), join(T, 'scripts', s)); }
  put('scripts/android-env.sh', 'true\n');
  put('sw.js', "const CACHE = 'trinity-shell-v41';\n");
  put('android/app/build.gradle', 'applicationId "com.trinityone.app"\n        versionCode 229\n        versionName "' + versionName + '"\n');
  copyFileSync(join(ROOT, 'android/app/src/main/AndroidManifest.xml'), put('android/app/src/main/AndroidManifest.xml', ''));
  put('.gitignore', '*.apk\nkey.pem\napk-manifest.*\nandroid/app/build.gradle\nandroid/gradlew\nandroid/app/build/\nbin/\nrelay/\n');
  put('apk-latest.json', OLD_LATEST);   // tracked, as in the repo
  if (stubs) {
    // the real-mode run: everything release.sh shells out to that would build or test, stubbed to write fake APKs
    put('bin/npm', '#!/usr/bin/env bash\nexit 0\n', 0o755);
    put('scripts/sync-web.sh', 'true\n');
    put('scripts/build-apk-index.sh', 'true\n');
    put('scripts/build-steward-apk.sh', 'head -c 3000 /dev/zero | tr "\\0" S > trinityone-steward.apk\n');
    put('scripts/build-finance-apk.sh', 'head -c 3001 /dev/zero | tr "\\0" F > trinityone-finance.apk\n');
    put('android/gradlew', '#!/usr/bin/env bash\nmkdir -p app/build/outputs/apk/release; head -c 2999 /dev/zero | tr "\\0" M > app/build/outputs/apk/release/app-release.apk\n', 0o755);
  }
  const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...a) => execFileSync('git', ['-C', T, ...a], { encoding: 'utf8', env: { ...process.env, ...ID } });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
  const k = edKey(); put('key.pem', k.pem);
  seedOld(T);
  const run = (args, key = join(T, 'key.pem')) => spawnSync('bash', ['scripts/release.sh', ...args], { cwd: T, encoding: 'utf8', env: { ...process.env, ...ID, PATH: join(T, 'bin') + ':' + process.env.PATH, RELEASE_KEY: key } });
  return { T, git, run, put, publicKey: k.publicKey };
}

test('release.sh --dry --apk --no-gw: plans the finance build, staging and signing — and leaves apk-manifest.json/.sig BYTE FOR BYTE (audit A1)', () => {
  const R = releaseTree();
  const b = apks(R.T);
  const head = R.git('rev-parse', 'HEAD');
  const r = R.run(['--dry', '--apk', '--no-gw']);
  assert.equal(r.status, 0, 'release.sh --dry failed: ' + r.stderr.slice(-500) + r.stdout.slice(-500));
  assert.match(r.stdout, /\[dry\] bash scripts\/build-steward-apk\.sh\n/);
  assert.match(r.stdout, /\[dry\] bash scripts\/build-finance-apk\.sh\n/, 'release.sh does not build the finance APK');
  assert.match(r.stdout, /\[dry\] cp trinityone-finance\.apk relay\/apks\/trinityone-finance\.apk/, 'release.sh does not stage the finance APK where the relay serves from');
  assert.ok(r.stdout.indexOf('build-finance-apk.sh') > r.stdout.indexOf('build-steward-apk.sh'));
  assert.match(r.stdout, /\[dry\] bash scripts\/apk-release-json\.sh sign 230 0\.9\.80 /, 'the dry plan does not show the manifest signing');
  assert.equal(readFileSync(join(R.T, 'apk-manifest.json'), 'utf8'), OLD_M, 'a DRY run rewrote apk-manifest.json');
  assert.ok(readFileSync(join(R.T, 'apk-manifest.sig')).equals(OLD_S), 'a DRY run re-signed apk-manifest.sig');
  assert.equal(R.git('rev-parse', 'HEAD'), head, 'a dry run committed something');
  assert.equal(readFileSync(join(R.T, 'apk-latest.json'), 'utf8'), OLD_LATEST, 'a dry run wrote apk-latest.json');
  assert.ok(!existsSync(join(R.T, 'relay/apks')), 'a dry run staged APKs');
  assert.ok(Object.keys(b).length === 3);
});

test('release.sh for REAL (--apk --no-gw, builds stubbed): apk-latest.json committed with the finance row; a SIGNED apk-manifest.json naming all three, staged with all three APKs in relay/apks/', () => {
  const R = releaseTree({ stubs: true });
  const r = R.run(['--apk', '--no-gw']);
  assert.equal(r.status, 0, 'release.sh failed: ' + r.stderr.slice(-800) + r.stdout.slice(-500));
  const latest = JSON.parse(R.git('show', 'HEAD:apk-latest.json'));
  assert.equal(latest.versionCode, 230);
  assert.equal(latest.financeVersionCode, 230);
  assert.equal(latest.financeUrl, 'trinityone-finance.apk');
  const mBuf = readFileSync(join(R.T, 'apk-manifest.json')), sig = readFileSync(join(R.T, 'apk-manifest.sig'));
  assert.ok(cryptoVerify(null, mBuf, R.publicKey, sig), 'apk-manifest.sig does not verify over apk-manifest.json');
  const m = JSON.parse(mBuf.toString('utf8'));
  assert.deepEqual(Object.keys(m).sort(), ['trinityone-finance.apk', 'trinityone-steward.apk', 'trinityone.apk'], 'the signed manifest does not name all three APKs');
  for (const n of Object.keys(m)) {
    assert.equal(m[n].sha256, sha(readFileSync(join(R.T, n))), n + ' hash');
    assert.ok(readFileSync(join(R.T, 'relay/apks', n)).equals(readFileSync(join(R.T, n))), n + ' not staged in relay/apks/');
    assert.equal(m[n].versionCode, 230);
  }
  assert.ok(readFileSync(join(R.T, 'relay/apks/apk-manifest.json')).equals(mBuf), 'the signed manifest was not staged');
  assert.ok(readFileSync(join(R.T, 'relay/apks/apk-manifest.sig')).equals(sig), 'the signature was not staged');
  assert.deepEqual(leftovers(R.T), [], 'temp files left behind');
});

test('release.sh for REAL with a signing failure (unusable key): exits non-zero, apk-manifest.json/.sig untouched, and relay/apks/ UNCHANGED (audit A1, R4)', () => {
  const R = releaseTree({ stubs: true });
  const bad = R.put('bad-key.pem', 'not a key\n');
  // what the relay was serving before this release: old APKs + the old signed manifest that describes THEM
  const staged = { 'trinityone.apk': 'old-m', 'trinityone-steward.apk': 'old-s', 'trinityone-finance.apk': 'old-f', 'apk-manifest.json': OLD_M, 'apk-manifest.sig': 'old-sig' };
  for (const [n, v] of Object.entries(staged)) R.put('relay/apks/' + n, v);
  const r = R.run(['--apk', '--no-gw'], bad);
  assert.notEqual(r.status, 0, 'a failed signing let the release carry on');
  assert.match(r.stderr, /APK manifest signing failed — apk-manifest\.json \/ \.sig left exactly as they were/);
  assert.equal(readFileSync(join(R.T, 'apk-manifest.json'), 'utf8'), OLD_M, 'a failed signing truncated or rewrote apk-manifest.json');
  assert.ok(readFileSync(join(R.T, 'apk-manifest.sig')).equals(OLD_S), 'a failed signing changed apk-manifest.sig');
  // audit R4: SIGN FIRST, STAGE AFTER — relay/apks/ keeps the old APKs beside the old manifest that describes them
  for (const [n, v] of Object.entries(staged)) assert.equal(readFileSync(join(R.T, 'relay/apks', n), 'utf8'), v, 'relay/apks/' + n + ' was replaced although the signing failed — new bytes beside the old manifest are refused by every box');
  assert.deepEqual(leftovers(R.T), [], 'temp files left behind');
});

test('release.sh for REAL when writing apk-latest.json FAILS (a versionName that is not a version): the tracked apk-latest.json is unchanged, nothing signed or staged (audit R2)', () => {
  const R = releaseTree({ stubs: true, versionName: '0.9 "80' });
  const r = R.run(['--apk', '--no-gw']);
  assert.notEqual(r.status, 0, 'a versionName that would break the JSON was written into it');
  assert.equal(readFileSync(join(R.T, 'apk-latest.json'), 'utf8'), OLD_LATEST, 'apk-latest.json was truncated or rewritten by a failed write — release.sh must write it through `latest --out`');
  assert.equal(R.git('show', 'HEAD:apk-latest.json'), OLD_LATEST, 'a broken apk-latest.json was committed');
  assert.equal(readFileSync(join(R.T, 'apk-manifest.json'), 'utf8'), OLD_M);
  assert.ok(!existsSync(join(R.T, 'relay/apks')), 'APKs were staged by a release that failed');
  assert.deepEqual(leftovers(R.T), [], 'temp files left behind');
});

test('helper `sign`: INT, TERM and HUP delivered BETWEEN the two moves do not leave the new signature beside the old manifest (audit R1)', () => {
  const D = mkdtempSync(join(tmpdir(), 'trin-arj-')); dirs.push(D);
  apks(D); seedOld(D);
  const k = edKey(); writeFileSync(join(D, 'key.pem'), k.pem);
  // the test seam runs this between `mv sig` and `mv manifest`; $PPID is the helper itself
  const r = spawnSync('bash', [HELPER, 'sign', '230', '0.9.80', '2026-11-17', join(D, 'key.pem'), D], {
    encoding: 'utf8', env: { ...process.env, APK_RELEASE_JSON_TEST_BETWEEN_MOVES: 'kill -INT $PPID; kill -TERM $PPID; kill -HUP $PPID; sleep 0.2' },
  });
  const m = readFileSync(join(D, 'apk-manifest.json')), sig = readFileSync(join(D, 'apk-manifest.sig'));
  assert.notEqual(m.toString('utf8'), OLD_M, 'the manifest was never moved into place: the helper died between the moves (signal ' + r.signal + ')');
  assert.ok(cryptoVerify(null, m, k.publicKey, sig), 'manifest and signature do not match after the interrupted run');
  assert.equal(r.status, 0, 'the helper did not finish: ' + r.signal + ' ' + r.stderr);
  assert.deepEqual(leftovers(D), [], 'temp files left behind');
});
