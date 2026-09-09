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
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts, button } from './render-jsx-screen.mjs';
import * as H from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two builds that differ ONLY in size, which is the whole point: nothing about them says "newer".
const BUILD_206 = Buffer.alloc(1_200_000, 0x61);
const BUILD_207 = Buffer.alloc(1_300_000, 0x62);

// The release host. Serves what `serving` says at the moment it is asked, so a test can move it on
// mid-run exactly as the real one does when somebody builds an APK.
const serving = { apk: BUILD_206, latest: { versionCode: 206, versionName: '0.9.71', date: '2026-09-07' } };
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
  assert.equal(member.versionName, '0.9.71',
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
  assert.match(html, /0\.9\.71/, 'the page a member downloads from does not say which version they are about to install');
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
    files: [{ name: 'trinityone.apk', title: 'TrinityOne', present: true, versionName: '0.9.71', versionCode: 206, ageDays: 2, state: 'behind', say: 'BEHIND — the update source is offering a different build.' }],
  }));
  const html = dom.els.get('apkHeld').innerHTML;
  assert.match(html, /handing out an installer that is behind/i,
    'a box that is behind renders no headline. An operator must not have to read three rows of version ' +
    'numbers to find out that what they are handing their congregation is out of date.');
  assert.match(html, /Update the installer now/,
    'the warning does not say what to do about it');
  assert.match(html, /0\.9\.71/, 'the card does not state which build the box currently holds');
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
function liftFromJsx(src, anchor, name, exportNames, globals) {
  const body = fnBody(src, anchor, name);
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
  assert.deepEqual(make('wss://grace.example/relay'), { url: 'https://grace.example/install', lan: false },
    'a church with a real address got no install slip at all');
  assert.deepEqual(make('ws://192.168.1.50:8090/relay'), { url: 'http://192.168.1.50:8090/install', lan: true },
    'a box on the church LAN was refused — which is the configuration this whole feature is FOR');
  assert.equal(make('ws://127.0.0.1:8090/relay'), null,
    'the console offered to print a loopback address. On the reader’s phone that resolves to the reader’s ' +
    'phone: it looks ordinary, and it works when the steward tests it themselves.');
  assert.equal(make('ws://localhost:8090/relay'), null, 'localhost was accepted, which is the same defect spelled differently');
});

test('the console actually OFFERS the slip, and pressing it prints this church’s address', () => {
  // Rule 1: this fails if the control is deleted from the screen, not only if the template breaks.
  const { React, draw } = miniReact();
  const printed = [];
  const church = { npub: 'npub1grace', name: 'Grace Chapel', nip05: '' };
  const stub = () => null;
  const { JoinCard } = liftFromJsx(DASH, 'function JoinCard(', 'JoinCard', ['JoinCard'], {
    React,
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
    installPageUrl: () => ({ url: 'https://grace.example/install', lan: false }),
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
  const { JoinCard } = liftFromJsx(DASH, 'function JoinCard(', 'JoinCard', ['JoinCard'], {
    React,
    window: {
      useStewardChurch: () => ({ npub: 'npub1grace', name: 'Grace', nip05: '' }),
      Steward: { npub: 'npub1grace', joinUrl: () => 'https://app.trinityone.church/?follow=npub1grace&relay=', joinLinkIsPrivate: () => true, qrSVG: () => '' },
      TrinityTemplates: { printInstallSheet: () => {} },
    },
    navigator: {},
    document: { createElement: () => ({ style: {}, getContext: () => ({}) }) },
    installPageUrl: () => null,
    useGoPublicGate: () => ({ blocking: false }),
    GoPublicPanel: stub, GoPublicNote: stub, SkQR: stub, InvitePosterModal: stub, Icon: stub,
    copyText: () => true, churchHandle: () => '', shortNpub: (s) => s,
  });
  assert.equal(button(draw(JoinCard, {}), 'Install slip').length, 0,
    'the console offered a printable slip to a church whose box has no address anyone else can reach');
});
