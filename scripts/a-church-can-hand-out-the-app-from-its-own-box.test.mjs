// A CHURCH'S OWN BOX CAN HAND OUT THE APP — AND MUST SAY HOW OLD THE COPY IT HANDS OUT IS.
// Run: node --test scripts/a-church-can-hand-out-the-app-from-its-own-box.test.mjs
//
// WHAT THIS IS FOR. A relay already pulls trinityone.apk / trinityone-steward.apk from its update origin and
// serves them, so a church where Play is blocked — or whose members pay for every megabyte — can install the
// whole congregation over the hall wifi. Nothing surfaced that to anybody: the operator got a button labelled
// "Fetch latest APK" with no statement of purpose, and the church got no link, no QR and nothing printable.
//
// AND THE TRAP THAT MADE IT A LIABILITY. `scripts/relay-update.sh:87` unpacks a new build with
// `--exclude='relay/*'`, and the APKs live in relay/apks/. So a relay's CODE updates and its INSTALLER never
// does. Measured on a8 on 2026-09-09:
//
//     a8 offered:     versionCode 206, dated 2026-09-07
//     actually built: versionCode 207, 2026-09-08
//
// and nothing anywhere said so — while the file was being installed onto real phones. The acceptance bar the
// backlog sets is exactly this: if the box cannot tell an operator it is behind, the feature is a liability.
//
// THE ONE DESIGN DECISION WORTH READING BEFORE CHANGING ANY OF THIS.
// The verdict is decided by comparing the SIZE OF THE FILE THE ORIGIN WOULD SERVE against the size of the
// file the box holds — not by comparing version numbers. apk-latest.json is hand-committed and drifts: on
// 2026-09-09 the repo's own copy said 206 while 207 existed, so a check that trusted it would have reported
// "up to date" over the very fault it exists to catch. §2 stages that precise situation — new bytes at the
// origin, apk-latest.json untouched — and it is the case that fails first if anyone "simplifies" this to a
// version comparison.
//
// The operator's half is checked by RUNNING the panel's own function (§4) and the member's half by fetching
// the page a real member gets (§3), because CLAUDE.md rule 3: relay-app/control.js and app/*.jsx both ship
// unbundled, so `false && ` in front of a condition leaves every word of it in place and a text-matching
// assertion still passes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts, button, find } from './render-jsx-screen.mjs';
import * as H from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two builds that differ ONLY in size, which is the whole point: nothing about them says "newer".
const BUILD_206 = Buffer.alloc(1_200_000, 0x61);
const BUILD_207 = Buffer.alloc(1_300_000, 0x62);

// The release host. Serves what `serving` says at the moment it is asked, so a test can move it on
// mid-run exactly as the real one does when somebody builds an APK.
const serving = { apk: BUILD_206, latest: { versionCode: 206, versionName: '0.9.99', date: '2026-09-07' } };
let origin = null, box = null, dataDir = '', token = '', base = '';

// A box is started by hand rather than through H.startRelay, because startRelay writes the `origin` file
// itself (pointing the relay at ITSELF, which is right for a sync test and wrong for this one).
async function startBox(settings) {
  const port = await H.freePort('installer-box');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-installer-'));
  writeFileSync(join(dataDir, 'origin'), origin.base);
  if (settings) writeFileSync(join(dataDir, 'relay-settings.json'), JSON.stringify(settings));
  const proc = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0' },
  });
  proc.stdout.resume(); proc.stderr.resume();
  base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { await sleep(200); try { if ((await fetch(base + '/status')).ok) break; } catch {} }
  token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || '';
  return proc;
}
const auth = () => ({ Authorization: 'Bearer ' + token });
const apkStatus = async () => (await fetch(base + '/relay-app/apk-status', { headers: auth(), cache: 'no-store' })).json();

before(async () => {
  origin = await H.startImpostor({
    name: 'release-host',
    handler: (req, res, url) => {
      if (url.pathname === '/apk-latest.json') return H.sendJson(res, serving.latest);
      if (url.pathname === '/trinityone.apk' || url.pathname === '/trinityone-steward.apk') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': serving.apk.length });
        if (req.method === 'HEAD') { res.end(); return; }   // the cheap check the box makes on a timer
        res.end(serving.apk); return;
      }
      res.writeHead(404); res.end('nothing here');
    },
  });
  box = await startBox(null);
});
after(() => {
  try { box && box.kill('SIGKILL'); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  H.stopAll();
});

// ── §1 · the box knows what it is handing out ────────────────────────────────────────────────────────────

test('a box holding no installer says so, rather than looking healthy', async () => {
  const s = await apkStatus();
  assert.equal(s.holding, 0, 'a fresh box reported holding an installer it has never fetched');
  assert.equal(s.behind, true,
    'a box that hands out NOTHING while its origin is offering a build reported itself as fine. An operator ' +
    'reading that card would believe members could install, and nobody could.');
  assert.ok(s.files.every((f) => f.present === false), 'the per-file report claims files that are not on disk');
});

test('fetching records WHAT was fetched, not merely that something was', async () => {
  const r = await fetch(base + '/relay-app/fetch-apk', { method: 'POST', headers: auth() });
  assert.equal(r.status, 200, 'the fetch button failed against an origin that is serving both APKs');
  const s = await apkStatus();
  assert.equal(s.holding, 2, 'the box did not end up holding both installers');
  const member = s.files.find((f) => f.name === 'trinityone.apk');
  assert.equal(member.versionName, '0.9.99',
    'the box cannot say WHICH build it holds. Without this the panel and the download page can report when a ' +
    'file arrived and nothing whatever about what it is — which is the half both the operator and the member need.');
  assert.equal(member.versionCode, 206, 'the build number was not recorded beside the file');
  assert.equal(member.bytes, BUILD_206.length, 'the recorded size is not the size of the file on disk');
  assert.match(member.sha256, /^[0-9a-f]{64}$/, 'no checksum was recorded, so the download page cannot offer one');
  assert.equal(s.behind, false, 'a box that has just fetched from its origin reported itself as behind');
});

// ── §2 · THE ACCEPTANCE BAR ──────────────────────────────────────────────────────────────────────────────

test('the origin ships a new build and the box says it is BEHIND — with apk-latest.json unchanged', async () => {
  // THE a8 CASE, EXACTLY. The bytes moved; the hand-committed description did not. A version comparison
  // reports "up to date" here, which is what shipped a two-day-old installer onto real phones for four days.
  serving.apk = BUILD_207;
  assert.equal(serving.latest.versionCode, 206, 'precondition: the origin is still DESCRIBING itself as 206');

  const s = await apkStatus();
  assert.equal(s.behind, true,
    'the box did not notice that its update source is offering different bytes. This is the entire feature: ' +
    'a fetched APK does not age visibly, and a box that cannot say it is behind is a liability rather than ' +
    'a feature (reference/BACKLOG.md, and measured live on a8 2026-09-09).');
  const member = s.files.find((f) => f.name === 'trinityone.apk');
  assert.equal(member.state, 'behind', 'the per-file verdict is not "behind"');
  assert.match(member.say, /BEHIND/,
    'the sentence an operator reads does not say it is behind. A machine-readable state nobody renders in ' +
    'words is how the old panel managed to print a confident version number for a file it had not looked at.');
  assert.equal(member.originBytes, BUILD_207.length, 'the box did not read the size the origin would actually serve');
});

test('an unreachable update source is "cannot tell", never "up to date" and never "behind"', async () => {
  // A box on a thin pipe, or one whose origin has moved, must not be told either comfortable lie. The
  // difference matters more here than usual: `behind` also drives the automatic refresh, and a false
  // "behind" against an unreachable host would retry a download for ever.
  const dark = await H.startImpostor({ name: 'dark-host', handler: (req, res) => { res.writeHead(500); res.end('down'); } });
  const dir = mkdtempSync(join(tmpdir(), 'trin-dark-'));
  const port = await H.freePort('dark-box');
  writeFileSync(join(dir, 'origin'), dark.base);
  const proc = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dir, RELAY_SYNC: '0' },
  });
  try {
    const b = 'http://127.0.0.1:' + port;
    for (let i = 0; i < 100; i++) { await sleep(200); try { if ((await fetch(b + '/status')).ok) break; } catch {} }
    const tok = JSON.parse(readFileSync(join(dir, 'admin.json'), 'utf8')).token;
    const s = await (await fetch(b + '/relay-app/apk-status', { headers: { Authorization: 'Bearer ' + tok } })).json();
    assert.equal(s.originReachable, false, 'precondition: the origin is supposed to be refusing');
    assert.equal(s.behind, false, 'an unreachable origin was reported as "you are behind", which is a claim nobody made');
    assert.ok(s.files.every((f) => f.state === 'unknown'), 'a file the origin could not be asked about got a confident verdict');
  } finally { try { proc.kill('SIGKILL'); } catch {} rmSync(dir, { recursive: true, force: true }); dark.stop(); }
});

test('the operator’s status is admin-gated; the member’s page is not', async () => {
  assert.equal((await fetch(base + '/relay-app/apk-status')).status, 401,
    'the status endpoint answered with no credential — it makes an outbound request to the update source on demand');
  assert.equal((await fetch(base + '/install')).status, 200,
    'the page a church shares demanded a token. Members are not operators, and a link nobody can open ' +
    'without an admin secret is not something a church can hand out.');
});

// ── §3 · the page a church shares ────────────────────────────────────────────────────────────────────────

test('the install page names the build, says how old it is, and offers the file', async () => {
  const html = await (await fetch(base + '/install')).text();
  assert.match(html, /0\.9\.99/, 'the page a member downloads from does not say which version they are about to install');
  assert.match(html, /Added to this box today/,
    'the page does not say how old the file is. That is the member-facing half of the staleness requirement: ' +
    'once a build is on phones rather than on a server, "nobody re-fetched" is no longer recoverable quietly.');
  assert.match(html, /href="\/trinityone\.apk"/, 'the page offers no way to actually download the member app');
  assert.match(html, /href="\/trinityone-steward\.apk"/, 'the steward build is missing from the page');
  assert.match(html, /sha256sum/, 'the page dropped the checksum, so nobody installing from a mirror can verify the bytes');
});

test('the install page carries no inline script and no on*= handler', async () => {
  // The gateway serves script-src 'self'. An inline handler here would be silently dead — the page would
  // look right in a review and do nothing in a browser — so the page is built to need no script at all.
  const r = await fetch(base + '/install');
  const html = await r.text();
  assert.doesNotMatch(html, /<script/i, 'the install page contains a <script> tag, which the strict CSP will refuse');
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, 'the install page contains an inline on*= handler, which the strict CSP will refuse');
  assert.match(String(r.headers.get('content-security-policy') || ''), /script-src 'self'/,
    'the page is served without the CSP the rest of this gateway sends');
});

test('an old copy tells the member it is old, in words, on the page they install from', async () => {
  // Reaching into the file's mtime is the honest way to age it: the box works out the age from what is on
  // disk, so a test that only moved a JSON field would be testing its own fixture.
  const held = JSON.parse(readFileSync(join(dataDir, 'apks', 'held.json'), 'utf8'));
  const longAgo = Date.now() - 40 * 86400000;
  for (const f of Object.keys(held.files)) held.files[f].at = longAgo;
  writeFileSync(join(dataDir, 'apks', 'held.json'), JSON.stringify(held));
  try {
    const html = await (await fetch(base + '/install')).text();
    assert.match(html, /40 days ago/, 'a 40-day-old installer did not say its age on the page members read');
    assert.match(html, /over a month old/i,
      'a copy well over a month old carried no warning at all. The member cannot fix this — the sentence ' +
      'exists so they can ask the person who can, instead of installing something old without knowing it.');
  } finally {
    for (const f of Object.keys(held.files)) held.files[f].at = Date.now();
    writeFileSync(join(dataDir, 'apks', 'held.json'), JSON.stringify(held));
  }
});

test('the QR a church shares encodes this box’s own install page', async () => {
  const r = await fetch(base + '/apks/qr.svg');
  assert.equal(r.status, 200, 'there is no QR to print, put on a poster, or show on the panel');
  assert.match(String(r.headers.get('content-type') || ''), /image\/svg/, 'the QR is not served as an image');
  assert.match(await r.text(), /^<svg/, 'the QR endpoint answered with something that is not an SVG');
});

test('the downloaded file is named for the build actually being sent', async () => {
  // It used to be named from the ROOT apk-latest.json — which describes the build this relay's CODE was
  // released alongside, not the file in relay/apks/. relay-update.sh's --exclude='relay/*' guarantees those
  // drift, so a box handing out 206 labelled every download with whatever version its code shipped beside.
  // A member then has a file on their phone whose name is a claim about it that is not true.
  const r = await fetch(base + '/trinityone.apk');
  assert.equal(r.status, 200, 'the box would not serve the installer it says it holds');
  assert.match(String(r.headers.get('content-disposition') || ''), /trinityone-0\.9\.99\.apk/,
    'the saved filename does not name the build inside the file');
  await r.arrayBuffer();
});

test('/apks reaches the same page — the address the backlog names', async () => {
  assert.equal((await fetch(base + '/apks')).status, 200, '/apks does not resolve, so every link written to it 404s');
});

// ── §4 · the operator's panel ────────────────────────────────────────────────────────────────────────────
// relay-app/control.js ships unbundled, so its behaviour is proved by RUNNING it. The function is lifted
// whole and given a DOM it can write to, a fetch that answers, and the panel's own esc/authHeaders.

const CONTROL = readFileSync(join(ROOT, 'relay-app/control.js'), 'utf8');

function fakeDom(ids) {
  const els = new Map();
  for (const id of ids) els.set(id, { id, textContent: '', innerHTML: '', checked: false, href: '', style: {} });
  return { els, document: { getElementById: (id) => els.get(id) || null } };
}

async function runPanel(reply) {
  const src = fnBody(CONTROL, 'async function loadApkStatus()', 'loadApkStatus');
  const dom = fakeDom(['apkHeld', 'installerCard', 'keepApkCurrent', 'installUrl', 'openInstall']);
  const calls = [];
  const globals = {
    document: dom.document,
    esc: (s) => String(s || '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])),
    authHeaders: () => ({ Authorization: 'Bearer t' }),
    fetch: async (url, opts) => { calls.push({ url, opts }); return reply(url); },
  };
  const key = '__panel_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map((k) => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + src + '\nexport { loadApkStatus };').toString('base64'));
  await mod.loadApkStatus();
  return { dom, calls };
}

const okReply = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('the panel asks the box what it hands out — not the relay’s own apk-latest.json', async () => {
  // THE DEFECT THIS REPLACES. The old line fetched /apk-latest.json, which describes the build the relay's
  // CODE was released alongside, and printed "latest: 0.9.71 (206)". It says nothing about the file in
  // relay/apks/ that members actually download, and the two drift apart BY DESIGN because relay-update.sh
  // excludes relay/. The panel was confidently printing a version number for a file it had not looked at.
  const { calls } = await runPanel(okReply({ files: [], holding: 0, behind: false }));
  assert.equal(calls.length, 1, 'the panel made no request, or more than one');
  assert.equal(calls[0].url, '/relay-app/apk-status',
    'the panel is not reading the endpoint that compares the file on disk with what the origin would serve');
});

test('a behind box gets a headline an operator cannot miss, and an instruction', async () => {
  const { dom } = await runPanel(okReply({
    behind: true, holding: 2, keepCurrent: false, shareUrl: 'https://grace.example/install',
    files: [{ name: 'trinityone.apk', title: 'TrinityOne', present: true, versionName: '0.9.99', versionCode: 206, ageDays: 2, state: 'behind', say: 'BEHIND — the update source is offering a different build.' }],
  }));
  const html = dom.els.get('apkHeld').innerHTML;
  assert.match(html, /handing out an installer that is behind/i,
    'a box that is behind renders no headline. An operator must not have to read three rows of version ' +
    'numbers to find out that what they are handing their congregation is out of date.');
  assert.match(html, /Update the installer now/,
    'the warning does not say what to do about it');
  assert.match(html, /0\.9\.99/, 'the card does not state which build the box currently holds');
  assert.match(html, /added 2 days ago/i, 'the card does not say how old the held copy is');
  assert.equal(dom.els.get('installUrl').textContent, 'https://grace.example/install',
    'the address a church shares is not put on screen, so there is nothing to hand out');
});

test('a box that is up to date says members can install from it, and holds no warning', async () => {
  const { dom } = await runPanel(okReply({
    behind: false, holding: 2, keepCurrent: true, shareUrl: 'https://grace.example/install',
    files: [{ name: 'trinityone.apk', title: 'TrinityOne', present: true, versionName: '0.9.72', versionCode: 207, ageDays: 0, state: 'current', say: 'Up to date.' }],
  }));
  const html = dom.els.get('apkHeld').innerHTML;
  assert.match(html, /Members can install from this box/, 'the card never states the capability in plain words');
  assert.doesNotMatch(html, /behind/i, 'an up-to-date box was warned about being behind');
  assert.equal(dom.els.get('keepApkCurrent').checked, true, 'the automatic-refresh toggle does not reflect the saved setting');
});

test('a locked panel hides the card rather than reporting an empty box', async () => {
  const { dom } = await runPanel(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  assert.equal(dom.els.get('installerCard').style.display, 'none',
    'an unauthorised panel left the installer card on screen, where it would read as "this box holds nothing"');
});

test('the panel’s markup carries every element the function writes to, and no inline handler', () => {
  // The lifted function proves the behaviour; this proves the card it writes into actually exists on the
  // page, which no amount of running the function can show.
  const html = readFileSync(join(ROOT, 'relay-app/control.html'), 'utf8');
  for (const id of ['installerCard', 'apkHeld', 'keepApkCurrent', 'installUrl', 'openInstall', 'fetchApk']) {
    assert.ok(html.includes('id="' + id + '"'), `#${id} is missing from the panel, so loadApkStatus writes into nothing`);
  }
  assert.match(html, /Let members install the app from this box/,
    'the card no longer says what the capability is FOR. It was a maintenance-shaped button for a year and ' +
    'nobody could tell from the panel that a church could install its whole congregation from its own box.');
  assert.match(html, /Update the installer now/,
    'the fetch control is gone or renamed away. It CANNOT be removed: relay-update.sh unpacks with ' +
    '--exclude=\'relay/*\' and the APKs live in relay/apks/, so this is the only thing that keeps a ' +
    'church\'s installer current.');
  assert.doesNotMatch(html.slice(html.indexOf('id="installerCard"'), html.indexOf('id="installerCard"') + 3000), /\son[a-z]+\s*=\s*["']/i,
    'the new card carries an inline on*= handler, which the panel\'s strict CSP refuses');
});

// ── §5 · the automatic refresh ───────────────────────────────────────────────────────────────────────────

test('a box nobody opted in for downloads nothing on its own', async () => {
  // The default matters as much as the behaviour. This product's first audience is a church on a thin or
  // metered pipe; two 40 MB downloads nobody asked for is the wrong thing to do to them, so they get the
  // warning instead and press the button when it suits.
  const s = await apkStatus();
  assert.equal(s.keepCurrent, false, 'the automatic refresh is on by default');
  assert.equal(s.behind, true, 'precondition: this box has been behind since §2 and nothing has fixed it');
  const member = s.files.find((f) => f.name === 'trinityone.apk');
  assert.equal(member.bytes, BUILD_206.length,
    'a box with the setting OFF fetched a new installer by itself — 80 MB nobody asked for, on a connection ' +
    'that may be metered');
});

test('with it on, the box catches up without anyone pressing anything', async () => {
  const r = await fetch(base + '/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ keepApkCurrent: true }),
  });
  assert.equal(r.status, 200, 'the setting could not be saved');
  let s = null;
  for (let i = 0; i < 60; i++) { await sleep(250); s = await apkStatus(); if (!s.behind) break; }
  assert.equal(s.behind, false,
    'turning on "keep the installer up to date" left the box behind. This is the standing answer to ' +
    'relay-update.sh never touching relay/ — with it on, a code update no longer strands the installer.');
  const member = s.files.find((f) => f.name === 'trinityone.apk');
  assert.equal(member.bytes, BUILD_207.length, 'the box reported itself current while still holding the old bytes');
});

test('a box restarting in a loop cannot re-download the installer on every boot', async () => {
  // The floor exists because the boot check is the one thing here that runs without anybody asking, and a
  // relay that crash-loops — or an origin that ever reports a Content-Length that does not match the bytes
  // it then sends, which would read as permanently behind — must not be able to spend a church's bandwidth
  // over and over. Written to DISK, not held in memory, precisely so a restart cannot clear it.
  serving.apk = BUILD_207;
  try { box.kill('SIGKILL'); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  box = await startBox({ keepApkCurrent: true });
  // hand the box a recently-refreshed record over the OLD build, so it is genuinely behind and recently checked
  const stamp = { bytes: BUILD_206.length, sha256: 'x'.repeat(64), at: Date.now(), versionCode: 206, versionName: '0.9.99', date: '2026-09-07' };
  for (let i = 0; i < 80; i++) { await sleep(250); if ((await apkStatus()).holding === 2) break; }
  try { box.kill('SIGKILL'); } catch {}
  mkdirSync(join(dataDir, 'apks'), { recursive: true });
  writeFileSync(join(dataDir, 'apks', 'held.json'), JSON.stringify({ origin: origin.base, at: Date.now(), autoAt: Date.now(), files: { 'trinityone.apk': stamp, 'trinityone-steward.apk': stamp } }));
  writeFileSync(join(dataDir, 'apks', 'trinityone.apk'), BUILD_206);
  writeFileSync(join(dataDir, 'apks', 'trinityone-steward.apk'), BUILD_206);

  const port = await H.freePort('loop-box');
  const proc = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0' },
  });
  box = proc; base = 'http://127.0.0.1:' + port;
  try {
    for (let i = 0; i < 100; i++) { await sleep(200); try { if ((await fetch(base + '/status')).ok) break; } catch {} }
    await sleep(6000);   // well past the 3s boot check
    const s = await apkStatus();
    assert.equal(s.behind, true, 'precondition: this box IS behind, so only the floor can be stopping it');
    assert.equal(s.files.find((f) => f.name === 'trinityone.apk').bytes, BUILD_206.length,
      'the box re-downloaded the installer within hours of the last automatic refresh. On a metered ' +
      'connection a restart loop would then cost 80 MB per boot.');
  } finally { try { proc.kill('SIGKILL'); } catch {} }
});

test('the boot check closes the gap a code update leaves — the installer catches up on restart', async () => {
  // The structural fault, rehearsed: a box that already holds an installer, whose origin has moved on while
  // it was down. relay-update.sh restarts the relay, so this is the moment the two can be brought back
  // together without a human being present.
  serving.apk = BUILD_206;                                    // the origin "rolls" to different bytes again
  try { box.kill('SIGKILL'); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  box = await startBox({ keepApkCurrent: true });             // a box that came back after an update
  let s = null;
  for (let i = 0; i < 80; i++) { await sleep(250); s = await apkStatus(); if (s.holding === 2 && !s.behind) break; }
  assert.equal(s.holding, 2, 'a rebooted box with the setting on never fetched an installer at all');
  assert.equal(s.behind, false, 'the boot check did not bring the installer back in step with the update source');
  assert.equal(s.files.find((f) => f.name === 'trinityone.apk').bytes, BUILD_206.length,
    'the box holds bytes that are not the ones its origin is serving');
});

// ── §6 · the printable slip, and the console control that offers it ──────────────────────────────────────
// app/*.jsx ships unbundled (rule 3), so both halves are COMPILED AND RUN: the slip is rendered and read,
// and the console card that offers it is drawn and its button pressed.

const TPL = readFileSync(join(ROOT, 'app/stew-templates.jsx'), 'utf8');
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

// Compile one construct out of an app/*.jsx file with the real esbuild — the same binary and flags
// scripts/sync-web.sh uses — and hand back the named values.
// `anchor` may be one anchor or several. Several are concatenated into ONE module, which is how a test
// gets the real decision function under the real component instead of stubbing the thing it is named
// after — see "A stub answers the question": running real code proves nothing if a stub supplies the
// answer being asserted.
function liftFromJsx(src, anchor, name, exportNames, globals) {
  const anchors = Array.isArray(anchor) ? anchor : [[anchor, name]];
  const body = anchors.map(([a, n]) => fnBody(src, a, n)).join('\n\n');
  const tmp = join(tmpdir(), 'installslip-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, body);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } finally { rmSync(tmp, { force: true }); }
  const names = Object.keys(globals);
  return new Function(...names, js + '\nreturn { ' + exportNames.join(', ') + ' };')(...names.map((k) => globals[k]));
}

test('the slip prints the address, the code to scan, and how to install', () => {
  const { installSheetHtml } = liftFromJsx(TPL, 'function installSheetHtml(', 'installSheetHtml', ['installSheetHtml'], {
    TMPL_ESC: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    HALO_SVG: () => '<svg/>',
  });
  const html = installSheetHtml({ name: 'Grace Chapel', url: 'https://grace.example/install', qrSvg: '<svg id="qr"/>', lan: false });
  assert.match(html, /Grace Chapel/, 'the slip does not name the church, so it is a generic leaflet');
  assert.match(html, /https:\/\/grace\.example\/install/, 'the slip carries no address — there is nothing to type in');
  assert.match(html, /<svg id="qr"\/>/, 'the QR was dropped, so the slip cannot be scanned');
  assert.match(html, /allow installing apps from your browser/i,
    'the slip skips the step that actually stops people: Android refuses a sideload until the browser is ' +
    'allowed to install, and a member who is not told simply gives up');
});

test('a slip carrying a wifi-only address says so on the paper', () => {
  // A box on the church network is very often reachable ONLY at a private address, and that is the normal
  // case for this feature rather than a fault — "install over the hall wifi" is the whole point. But a slip
  // that goes home in a pocket will not load, and the reader has no way to know why.
  const { installSheetHtml } = liftFromJsx(TPL, 'function installSheetHtml(', 'installSheetHtml', ['installSheetHtml'], {
    TMPL_ESC: (s) => String(s == null ? '' : s),
    HALO_SVG: () => '',
  });
  const lan = installSheetHtml({ name: 'Grace', url: 'http://192.168.1.50/install', qrSvg: '', lan: true });
  assert.match(lan, /on the church’s own wifi/i, 'a wifi-only address was printed with nothing to say so');
  assert.match(lan, /will not open from home/i, 'the slip does not say what will happen when it does not work');
  const wide = installSheetHtml({ name: 'Grace', url: 'https://grace.example/install', qrSvg: '', lan: false });
  assert.doesNotMatch(wide, /own wifi/i, 'a publicly reachable address was labelled as wifi-only, which is simply wrong');
});

test('the console works out an address worth printing, and refuses loopback', () => {
  // The same trap joinLinkIsPrivate exists for, seen from the other side. ws://127.0.0.1 on somebody else's
  // phone means THAT PHONE: the slip looks perfectly ordinary and the steward's own test of it works.
  const make = (relay) => {
    const { installPageUrl } = liftFromJsx(DASH, 'function installPageUrl()', 'installPageUrl', ['installPageUrl'], {
      window: { Steward: { joinUrl: () => 'https://app.trinityone.church/?follow=npub1x&relay=' + encodeURIComponent(relay) } },
    });
    return installPageUrl();
  };
  assert.deepEqual(make('wss://grace.example/relay'), { url: 'https://grace.example/install', lan: false, why: '' },
    'a church with a real address got no install page at all');
  assert.deepEqual(make('ws://192.168.1.50:8090/relay'), { url: 'http://192.168.1.50:8090/install', lan: true, why: '' },
    'a box on the church LAN was refused — which is the configuration this whole feature is FOR');
  // IT USED TO RETURN null HERE, and `why` is the half that was missing: the control vanished from the
  // card with no reason given, and an auditor served from 127.0.0.1 could not tell a deliberate refusal
  // from a missing feature. Correct behaviour with invisible reasoning is still a defect.
  assert.deepEqual(make('ws://127.0.0.1:8090/relay'), { url: '', lan: false, why: 'local' },
    'the console offered a loopback address, or refused it without saying why. On the reader’s phone ' +
    'that address resolves to the reader’s phone: it looks ordinary, and it works when the steward ' +
    'tests it themselves.');
  assert.deepEqual(make('ws://localhost:8090/relay'), { url: '', lan: false, why: 'local' },
    'localhost was accepted, which is the same defect spelled differently');
  assert.deepEqual(make(''), { url: '', lan: false, why: 'none' },
    'a church with no relay address at all was reported as a loopback problem, which would send its ' +
    'steward to a "go public" setting that is not what is wrong');
});

test('the console actually OFFERS the slip, and pressing it prints this church’s address', () => {
  // Rule 1: this fails if the control is deleted from the screen, not only if the template breaks.
  const { React, draw } = miniReact();
  const printed = [];
  const church = { npub: 'npub1grace', name: 'Grace Chapel', nip05: '' };
  const stub = () => null;
  const { JoinCard } = liftFromJsx(DASH,
    // The staleness check the card now runs is lifted WITH it — real code, given a relay that refuses.
    // These two cases are about the SLIP, and a failed check must leave every part of the card standing.
    [['function installerConcern(', 'installerConcern'], ['const INSTALLER_OLD_DAYS', 'INSTALLER_OLD_DAYS'],
     ['async function readInstallerConcern(', 'readInstallerConcern'], ['function JoinCard(', 'JoinCard']],
    'JoinCard', ['JoinCard'], {
    React, AbortSignal, fetch: async () => { throw new Error('ECONNREFUSED'); },
    window: {
      useStewardChurch: () => church,
      Steward: {
        npub: church.npub,
        joinUrl: () => 'https://app.trinityone.church/?follow=npub1grace&relay=' + encodeURIComponent('wss://grace.example/relay'),
        joinLinkIsPrivate: () => false,
        qrSVG: (t) => '<svg data-for="' + t + '"/>',
      },
      TrinityTemplates: { printInstallSheet: (a) => printed.push(a) },
    },
    navigator: {},
    document: { createElement: () => ({ style: {}, getContext: () => ({}) }) },
    installPageUrl: () => ({ url: 'https://grace.example/install', lan: false, why: '' }),
    useGoPublicGate: () => ({ blocking: false }),
    GoPublicPanel: stub, GoPublicNote: stub, SkQR: stub, InvitePosterModal: stub, Icon: stub,
    copyText: () => true,
    churchHandle: () => '',
    shortNpub: (s) => s,
  });

  const tree = draw(JoinCard, {});
  const btns = button(tree, 'Install slip');
  assert.equal(btns.length, 1,
    'there is no "Install slip" control on the console. The template can be perfect and the church still ' +
    'has nothing to hand anybody — which is exactly the state printInviteSheet has been in since it was ' +
    'written: a finished artefact with no caller anywhere in the repository.');
  assert.match(texts(btns[0]).join(' '), /own machine/i,
    'the button does not say what the slip is for, which is how "Fetch latest APK" ended up meaning nothing to anyone');

  btns[0].props.onClick();
  assert.equal(printed.length, 1, 'pressing the control printed nothing');
  assert.equal(printed[0].url, 'https://grace.example/install', 'the slip was printed with the wrong address');
  assert.equal(printed[0].name, 'Grace Chapel', 'the slip does not carry the church’s own name');
  assert.equal(printed[0].qrSvg, '<svg data-for="https://grace.example/install"/>',
    'the QR on the printed slip does not encode the install address');
});

test('a church with only a loopback relay is not offered a slip it cannot use', () => {
  const { React, draw } = miniReact();
  const stub = () => null;
  const { JoinCard } = liftFromJsx(DASH,
    // The staleness check the card now runs is lifted WITH it — real code, given a relay that refuses.
    // These two cases are about the SLIP, and a failed check must leave every part of the card standing.
    [['function installerConcern(', 'installerConcern'], ['const INSTALLER_OLD_DAYS', 'INSTALLER_OLD_DAYS'],
     ['async function readInstallerConcern(', 'readInstallerConcern'], ['function JoinCard(', 'JoinCard']],
    'JoinCard', ['JoinCard'], {
    React, AbortSignal, fetch: async () => { throw new Error('ECONNREFUSED'); },
    window: {
      useStewardChurch: () => ({ npub: 'npub1grace', name: 'Grace', nip05: '' }),
      Steward: { npub: 'npub1grace', joinUrl: () => 'https://app.trinityone.church/?follow=npub1grace&relay=', joinLinkIsPrivate: () => true, qrSVG: () => '' },
      TrinityTemplates: { printInstallSheet: () => {} },
    },
    navigator: {},
    document: { createElement: () => ({ style: {}, getContext: () => ({}) }) },
    installPageUrl: () => ({ url: '', lan: false, why: 'local' }),
    useGoPublicGate: () => ({ blocking: false }),
    GoPublicPanel: stub, GoPublicNote: stub, SkQR: stub, InvitePosterModal: stub, Icon: stub,
    copyText: () => true, churchHandle: () => '', shortNpub: (s) => s,
  });
  assert.equal(button(draw(JoinCard, {}), 'Install slip').length, 0,
    'the console offered a printable slip to a church whose box has no address anyone else can reach');
});

// ── §7 · the church that does NOT run the relay ──────────────────────────────────────────────────────────
// The gap this feature left behind. /relay-app/apk-status is the operator's, and most churches are not the
// operator — they are hosted on somebody else's box, they hand out the slip, and they had no way at all to
// learn that the file behind it had gone stale. Everything below reads PUBLIC data only.

test('the box states the same facts as its page, without a token, for something that is not a person', async () => {
  const r = await fetch(base + '/install.json');
  assert.equal(r.status, 200, 'a church that does not run the relay cannot ask how old the installer is');
  const j = await r.json();
  const f = j.files.find((x) => x.name === 'trinityone.apk');
  assert.ok(f, 'the machine-readable form lists nothing, so the console has nothing to read');
  assert.equal(f.versionName, '0.9.99', 'it does not say which build is on offer');
  assert.equal(typeof f.ageDays, 'number', 'it does not say how old the copy is, which is the whole point');

  // IT MUST CARRY NO MORE THAN THE PAGE. Anything about what the UPDATE SOURCE is offering costs an
  // outbound request per call, which is exactly what an unauthenticated endpoint must not be made to do —
  // and it is the operator's question besides.
  const raw = JSON.stringify(j);
  for (const leak of ['origin', 'behind', 'keepCurrent', 'shareUrl', 'originBytes', 'state']) {
    assert.ok(!raw.includes('"' + leak + '"'),
      `/install.json carries "${leak}", which the install page does not show and which belongs behind adminOK`);
  }
});

const LIFT_CONCERN = [['function installerConcern(', 'installerConcern'], ['const INSTALLER_OLD_DAYS', 'INSTALLER_OLD_DAYS']];

function concernFn() {
  const { installerConcern } = liftFromJsx(DASH, LIFT_CONCERN, 'installerConcern', ['installerConcern'], {});
  return installerConcern;
}

test('a current installer produces no sentence at all', () => {
  const say = concernFn();
  assert.equal(say({ files: [{ name: 'trinityone.apk', versionName: '0.9.72', versionCode: 207, ageDays: 2 }] }, 207), '',
    'a church whose relay is up to date was told something. The console\'s manner is to describe a ' +
    'consequence when there is one, never to fill the space.');
  assert.equal(say({ files: [] }, 207), '', 'a relay holding no installer at all produced a staleness warning about nothing');
});

test('an installer older than the page’s own threshold gets one plain sentence', () => {
  const say = concernFn();
  const out = say({ files: [{ name: 'trinityone.apk', versionName: '0.9.72', versionCode: 207, ageDays: 47 }] }, 207);
  assert.match(out, /put there/, 'a 47-day-old installer produced nothing — the majority case is still unserved');
  assert.match(out, /47 days/, 'it does not say how old, so the steward cannot judge whether it matters');
  assert.doesNotMatch(out, /must|should|please|urgent/i,
    'the sentence prescribes or nags. The console describes the consequence and leaves the decision alone.');
});

test('a relay whose CODE has moved past its installer is named as such', () => {
  // The structural drift the whole feature exists for, read off one box with no token: relay-update.sh
  // unpacks with --exclude='relay/*', so a relay updates its code and keeps handing out the old APK.
  const say = concernFn();
  const out = say({ files: [{ name: 'trinityone.apk', versionName: '0.9.71', versionCode: 206, ageDays: 3 }] }, 207);
  assert.match(out, /older version/, 'a relay running 207 while handing out 206 said nothing, because the copy was only 3 days old');
  assert.match(out, /0\.9\.71/, 'the sentence does not say which version is being handed out');
});

test('the sentence says who can fix it, and does not send a self-hosting church looking for someone else', () => {
  const say = concernFn();
  for (const out of [
    say({ files: [{ name: 'a', versionName: '0.9.72', versionCode: 207, ageDays: 47 }] }, 207),
    say({ files: [{ name: 'a', versionName: '0.9.71', versionCode: 206, ageDays: 3 }] }, 207),
  ]) {
    assert.match(out, /whoever looks after that machine/i,
      'the steward reading this usually CANNOT fix it — they do not run the relay and have no panel. A ' +
      'warning that does not say who to ask is a warning they can only worry about.');
    assert.match(out, /if your church runs its own relay, that is you/i,
      'a self-hosting church is told to go and ask somebody else, when the somebody else is them and the ' +
      'button is in their own relay panel.');
  }
});

test('an unknown relay build cannot be reported as behind', () => {
  // codeVersionCode 0 means /apk-latest.json could not be read — a relay-only box does not serve it at all.
  // Absence of an answer must never become an accusation.
  const say = concernFn();
  assert.equal(say({ files: [{ name: 'a', versionName: '0.9.71', versionCode: 206, ageDays: 3 }] }, 0), '',
    'a relay whose own version could not be read was reported as handing out an old build');
});

// ── the fetching, with every failure path driven ─────────────────────────────────────────────────────────
// readInstallerConcern is lifted WITH installerConcern, so the decision under test is the real one rather
// than a stub answering the question the test is named after.

function readerFn(fetchImpl) {
  return liftFromJsx(DASH,
    [['function installerConcern(', 'installerConcern'], ['const INSTALLER_OLD_DAYS', 'INSTALLER_OLD_DAYS'], ['async function readInstallerConcern(', 'readInstallerConcern']],
    'readInstallerConcern', ['readInstallerConcern'], { fetch: fetchImpl, AbortSignal }).readInstallerConcern;
}
const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });

test('the console reads the relay’s public facts and reaches the right conclusion', async () => {
  const asked = [];
  const read = readerFn(async (u) => {
    asked.push(u);
    if (u.endsWith('/install.json')) return jsonRes({ ok: true, files: [{ name: 'trinityone.apk', versionName: '0.9.72', versionCode: 207, ageDays: 47 }] });
    if (u.endsWith('/apk-latest.json')) return jsonRes({ versionCode: 207 });
    throw new Error('unexpected ' + u);
  });
  const out = await read('https://grace.example/install');
  assert.match(out, /47 days/, 'the console did not report an installer its own relay says is 47 days old');
  assert.deepEqual(asked, ['https://grace.example/install.json', 'https://grace.example/apk-latest.json'],
    'the console asked for something other than the two public documents');
  assert.ok(!asked.some((u) => u.includes('apk-status')),
    'the console reached for the ADMIN-GATED endpoint. It has no token, should not have one, and asking ' +
    'makes the box send an outbound request on demand.');
});

test('every way a relay can fail to answer leaves the card exactly as it was', async () => {
  // A church must never be told its installer is stale because a fetch timed out. Each of these is a real
  // relay in a real state — off, older, behind something that returns a login page, or simply slow.
  const cases = {
    'a relay that is switched off': async () => { throw new Error('ECONNREFUSED'); },
    'an older build with no /install.json': async () => ({ ok: false, status: 404, json: async () => ({}) }),
    'something that answers with HTML': async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }),
    'a body that is not the shape we expect': async () => jsonRes({ ok: true }),
    'a relay that answers with no files': async () => jsonRes({ ok: true, files: [] }),
    'a request that timed out': async () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; },
  };
  for (const [what, impl] of Object.entries(cases)) {
    const read = readerFn(impl);
    assert.equal(await read('https://grace.example/install'), '',
      `${what} produced a staleness warning. An absence of an answer is not evidence of a stale installer, ` +
      `and a church acting on it would go and ask an operator about a problem that may not exist.`);
  }
  assert.equal(await readerFn(async () => jsonRes({}))('not a url at all'), '',
    'an unparseable address produced a warning rather than silence');
});

test('an unreadable apk-latest.json still leaves the AGE signal working', async () => {
  // A relay-only box does not serve /apk-latest.json at all (it sits behind the serveApp gate). The weaker
  // signal must survive that, or every relay-only church is back where it started.
  const read = readerFn(async (u) => {
    if (u.endsWith('/install.json')) return jsonRes({ ok: true, files: [{ name: 'a', versionName: '0.9.72', versionCode: 207, ageDays: 61 }] });
    return { ok: false, status: 404, json: async () => ({}) };
  });
  assert.match(await read('https://grace.example/install'), /2 months ago/,
    'a relay-only box that does not publish its own version silenced the age warning as well');
});

// ── on the screen, which is the only place it counts ─────────────────────────────────────────────────────

async function joinCardWith(fetchImpl) {
  const { React, draw } = miniReact();
  const stub = () => null;
  const { JoinCard } = liftFromJsx(DASH,
    [['function installerConcern(', 'installerConcern'], ['const INSTALLER_OLD_DAYS', 'INSTALLER_OLD_DAYS'],
     ['async function readInstallerConcern(', 'readInstallerConcern'], ['function JoinCard(', 'JoinCard']],
    'JoinCard', ['JoinCard'], {
      React, fetch: fetchImpl, AbortSignal,
      window: {
        useStewardChurch: () => ({ npub: 'npub1grace', name: 'Grace Chapel', nip05: '' }),
        Steward: {
          npub: 'npub1grace',
          joinUrl: () => 'https://app.trinityone.church/?follow=npub1grace&relay=' + encodeURIComponent('wss://grace.example/relay'),
          joinLinkIsPrivate: () => false, qrSVG: () => '<svg/>',
        },
        TrinityTemplates: { printInstallSheet: () => {} },
      },
      navigator: {},
      document: { createElement: () => ({ style: {}, getContext: () => ({}) }) },
      installPageUrl: () => ({ url: 'https://grace.example/install', lan: false, why: '' }),
      useGoPublicGate: () => ({ blocking: false }),
      GoPublicPanel: stub, GoPublicNote: stub, SkQR: stub, InvitePosterModal: stub, Icon: stub,
      copyText: () => true, churchHandle: () => '', shortNpub: (s) => s,
    });
  draw(JoinCard, {});                       // first draw fires the effect
  await new Promise((r) => setTimeout(r, 30));   // let the two reads settle
  return texts(draw(JoinCard, {})).join(' ');    // second draw renders what came back
}

test('a hosted church SEES the warning on its own console when the relay’s copy is old', async () => {
  const screen = await joinCardWith(async (u) => {
    if (u.endsWith('/install.json')) return jsonRes({ ok: true, files: [{ name: 'trinityone.apk', versionName: '0.9.72', versionCode: 207, ageDays: 47 }] });
    return jsonRes({ versionCode: 207 });
  });
  assert.match(screen, /put there 47 days ago/,
    'nothing reached the screen. A church hosted on somebody else’s box hands members a slip pointing ' +
    'at a stale installer and the only way to find out is to open the page and read the date themselves — ' +
    'which is this feature’s own fault moved one party along.');
  assert.match(screen, /whoever looks after that machine/i, 'the steward is warned and not told who can act');
});

test('a hosted church whose relay is current sees nothing added to the screen', async () => {
  const screen = await joinCardWith(async (u) => {
    if (u.endsWith('/install.json')) return jsonRes({ ok: true, files: [{ name: 'trinityone.apk', versionName: '0.9.72', versionCode: 207, ageDays: 1 }] });
    return jsonRes({ versionCode: 207 });
  });
  assert.doesNotMatch(screen, /put there|older version/,
    'a church whose installer is a day old was warned about it. Every needless line here is one a steward ' +
    'learns to scroll past, and the one that matters goes with it.');
});

test('a relay that cannot be reached adds nothing to the screen', async () => {
  const screen = await joinCardWith(async () => { throw new Error('ECONNREFUSED'); });
  assert.doesNotMatch(screen, /put there|older version|whoever looks after/i,
    'a relay that did not answer put a staleness warning on a steward’s screen');
  assert.match(screen, /Install slip/, 'the rest of the card did not survive a failed check');
});

// ── §8 · the install link and QR ON SCREEN, and told apart from the joining code ─────────────────────────
// The card now carries TWO QR codes and TWO links doing different jobs: one follows the church in an app
// you already have, the other downloads the app in the first place. Handing out the wrong one fails
// silently — the member scans, nothing useful happens, and neither end can see why. Everything below is
// drawn and read (rule 3), never matched in the source.

// A JoinCard with a real relay address, its real QR renderer, and the staleness check pointed at a relay
// that refuses (these cases are about what is on the card, not about staleness).
function installCard({ relay = 'wss://grace.example/relay', copied = [], saved = [], printed = [] } = {}) {
  const { React, draw } = miniReact();
  const stub = () => null;
  const { JoinCard } = liftFromJsx(DASH,
    [['function installPageUrl()', 'installPageUrl'], ['function installerConcern(', 'installerConcern'],
     ['const INSTALLER_OLD_DAYS', 'INSTALLER_OLD_DAYS'], ['async function readInstallerConcern(', 'readInstallerConcern'],
     ['function JoinCard(', 'JoinCard']],
    'JoinCard', ['JoinCard'], {
      React, AbortSignal, fetch: async () => { throw new Error('ECONNREFUSED'); },
      window: {
        useStewardChurch: () => ({ npub: 'npub1grace', name: 'Grace Chapel', nip05: '' }),
        Steward: {
          npub: 'npub1grace',
          joinUrl: () => 'https://app.trinityone.church/?follow=npub1grace&relay=' + encodeURIComponent(relay),
          joinLinkIsPrivate: () => false,
          // the console's own local renderer — the same one the joining code uses. Tagged so a test can
          // see WHICH address each code on the card actually encodes.
          qrSVG: (t) => '<svg data-encodes="' + t + '"/>',
        },
        TrinityTemplates: { printInstallSheet: (a) => printed.push(a) },
      },
      navigator: {},
      document: { createElement: () => ({ style: {}, getContext: () => ({}) }) },
      copyText: (t) => { copied.push(t); return true; },
      useGoPublicGate: () => ({ blocking: false }),
      GoPublicPanel: stub, GoPublicNote: stub, SkQR: stub, InvitePosterModal: stub, Icon: stub,
      churchHandle: () => '', shortNpub: (s) => s,
      URL: Object.assign(class extends globalThis.URL {}, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
      Blob: function () { saved.push('blob'); },
      Image: function () { this.src = ''; },
    });
  return draw(JoinCard, {});
}

const qrNodes = (tree) => find(tree, (n) => n.props && n.props.role === 'img');
const areaValues = (tree) => find(tree, (n) => n.type === 'textarea').map((n) => n.props.value);

test('the install address is ON SCREEN and selectable, not only on a printed slip', () => {
  // The owner's actual complaint. The console had this value all along — installPageUrl() computes it, and
  // its ONLY consumer was printInstallSheet. To paste the install link into WhatsApp a steward had to
  // print a slip and read it off the paper.
  const tree = installCard();
  assert.ok(areaValues(tree).includes('https://grace.example/install'),
    'the install address is nowhere on the card as selectable text. It is what somebody reads out, types ' +
    'into a phone by hand, or copies when the clipboard button cannot reach the clipboard.');
});

test('"Copy install link" copies the install address, not the joining link', () => {
  const copied = [];
  const tree = installCard({ copied });
  const btns = button(tree, 'Copy install link');
  assert.equal(btns.length, 1, 'there is no way to copy the install link — the paste into WhatsApp is how this actually gets shared');
  btns[0].props.onClick();
  assert.deepEqual(copied, ['https://grace.example/install'],
    'the button copied the wrong address. The joining link and the install link go to different places, ' +
    'and a member who gets the wrong one scans it and nothing useful happens.');
});

test('the install QR is on screen and encodes the install page', () => {
  const tree = installCard();
  const codes = qrNodes(tree);
  assert.equal(codes.length, 2, 'the card should carry exactly two QR codes — the joining one and the install one');
  const html = codes.map((n) => (n.props.dangerouslySetInnerHTML || {}).__html || '');
  assert.ok(html.some((h) => h.includes('data-encodes="https://grace.example/install"')),
    'no QR on the card encodes the install page. The only code visible was the JOINING code, which points ' +
    'somewhere else entirely.');
  assert.ok(html.some((h) => h.includes('follow=npub1grace')), 'the joining QR was lost');
});

test('the two QR codes are told apart in words, not left for the steward to guess', () => {
  const codes = qrNodes(installCard());
  const labels = codes.map((n) => String(n.props['aria-label'] || ''));
  assert.equal(new Set(labels).size, 2, 'both QR codes carry the same description, so nothing on the card says which is which');
  assert.ok(labels.some((l) => /install/i.test(l)), 'neither code is described as the install one');
  assert.ok(labels.some((l) => /join/i.test(l)), 'neither code is described as the joining one');
  // And in the body text a steward actually reads, not only to a screen reader.
  const words = texts(installCard()).join(' ');
  assert.match(words, /Getting the app/i, 'the install controls are not labelled as a group, so they read as more joining-code buttons');
  assert.match(words, /installs TrinityOne/i, 'nothing on the card says in plain words what the second code is for');
});

test('saving the install QR renders it locally and does not reach for the relay', () => {
  // The relay does serve /apks/qr.svg — and using it here would add a network dependency to something the
  // console can already draw. The joining code has rendered its own QR since the beginning; this uses the
  // same renderer and the same save mechanism rather than inventing a second one.
  const encoded = [];
  const { React, draw } = miniReact();
  const stub = () => null;
  const fetches = [];
  const { JoinCard } = liftFromJsx(DASH,
    [['function installPageUrl()', 'installPageUrl'], ['function installerConcern(', 'installerConcern'],
     ['const INSTALLER_OLD_DAYS', 'INSTALLER_OLD_DAYS'], ['async function readInstallerConcern(', 'readInstallerConcern'],
     ['function JoinCard(', 'JoinCard']],
    'JoinCard', ['JoinCard'], {
      React, AbortSignal,
      fetch: async (u) => { fetches.push(u); throw new Error('ECONNREFUSED'); },
      window: {
        useStewardChurch: () => ({ npub: 'npub1grace', name: 'Grace Chapel', nip05: '' }),
        Steward: {
          npub: 'npub1grace',
          joinUrl: () => 'https://app.trinityone.church/?follow=npub1grace&relay=' + encodeURIComponent('wss://grace.example/relay'),
          joinLinkIsPrivate: () => false,
          qrSVG: (t) => { encoded.push(t); return '<svg/>'; },
        },
        TrinityTemplates: { printInstallSheet: () => {} },
      },
      navigator: {}, document: { createElement: () => ({ style: {}, getContext: () => ({}) }) },
      copyText: () => true, useGoPublicGate: () => ({ blocking: false }),
      GoPublicPanel: stub, GoPublicNote: stub, SkQR: stub, InvitePosterModal: stub, Icon: stub,
      churchHandle: () => '', shortNpub: (s) => s,
      URL: Object.assign(class extends globalThis.URL {}, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
      Blob: function () {}, Image: function () { this.src = ''; },
    });
  const tree = draw(JoinCard, {});
  const btns = button(tree, 'Save install QR');
  assert.equal(btns.length, 1, 'there is no way to save the install QR as an image to post in a chat or on a poster');
  encoded.length = 0;
  btns[0].props.onClick();
  assert.ok(encoded.includes('https://grace.example/install'),
    'saving the install QR did not render the install address through the console\'s own QR renderer');
  assert.ok(!fetches.some((u) => String(u).includes('qr.svg')),
    'the console fetched the relay\'s /apks/qr.svg to save an image it can draw itself, adding a network ' +
    'dependency for something entirely local');
});

test('pressing Install slip still prints, from the same address that is on screen', () => {
  const printed = [];
  const tree = installCard({ printed });
  button(tree, 'Install slip')[0].props.onClick();
  assert.equal(printed.length, 1, 'the slip was lost when the controls were regrouped');
  assert.equal(printed[0].url, 'https://grace.example/install',
    'the printed slip and the address shown on screen disagree, which is worse than showing neither');
});

test('a wifi-only address says so on the card as well as on the paper', () => {
  const words = texts(installCard({ relay: 'ws://192.168.1.50:8090/relay' })).join(' ');
  assert.match(words, /on your church’s own wifi/i,
    'a LAN-only install address was put on screen with nothing to say it will not open from home');
  const wide = texts(installCard()).join(' ');
  assert.doesNotMatch(wide, /own wifi/i, 'a publicly reachable address was labelled wifi-only, which is simply wrong');
});

test('a loopback relay explains why there is no install code, instead of showing nothing', () => {
  // An auditor served from 127.0.0.1 hit exactly this: the whole install control vanished with no reason
  // given, and a deliberate refusal is indistinguishable from a missing feature.
  const words = texts(installCard({ relay: 'ws://127.0.0.1:8090/relay' })).join(' ');
  assert.doesNotMatch(words, /Copy install link/, 'a loopback address was offered for sharing — on the reader’s phone it means the reader’s phone');
  assert.match(words, /can’t install from this machine yet/i,
    'the install block disappeared in silence. Correct behaviour with invisible reasoning is still a defect.');
  assert.match(words, /go public/i, 'the explanation does not say what would make it appear');
});
