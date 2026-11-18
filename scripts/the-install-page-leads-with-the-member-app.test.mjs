// THE INSTALL PAGE LEADS WITH THE MEMBER APP — THE STEWARD BUILD IS BEHIND A CLOSED DISCLOSURE.
// Run: node --test scripts/the-install-page-leads-with-the-member-app.test.mjs
//
// WHY. Stewards hand out their box's /install link. Members opened it and found two equal cards with two
// identical "Download and install" buttons — TrinityOne and TrinityOne Steward — and some installed the wrong
// one. The page now shows the member app as the one download and tucks the steward build into a <details>
// that starts closed.
//
// Point of use (CLAUDE.md rule 1): every assertion here is on the HTML a REAL gateway serves at /install,
// from APK files really sitting in its apks/ folder. The structure is parsed (which <details> encloses which
// link), not substring-matched, so a page that merely mentions the right words cannot pass.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = [];
let lastBase = '';

// A box with exactly these files in apks/, and no update origin (so it fetches nothing on its own).
async function boxHolding(names) {
  const dir = mkdtempSync(join(tmpdir(), 'trin-install-lead-'));
  mkdirSync(join(dir, 'apks'), { recursive: true });
  for (const n of names) writeFileSync(join(dir, 'apks', n), Buffer.alloc(200_000, 0x61));
  const port = await H.freePort('install-lead-box');
  const proc = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dir, RELAY_SYNC: '0' },
  });
  running.push({ proc, dir });
  const base = 'http://127.0.0.1:' + port;
  lastBase = base;
  for (let i = 0; i < 100; i++) { await sleep(200); try { if ((await fetch(base + '/status')).ok) break; } catch {} }
  const r = await fetch(base + '/install');
  assert.equal(r.status, 200, 'precondition: /install did not answer');
  return r.text();
}
after(() => {
  for (const { proc, dir } of running) { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  H.stopAll();
});

// For each <a href="…">, the stack of <details> elements enclosing it (outermost first), each with whether
// it carries `open`. A tiny tag walker is enough: the page is generated, well-formed, and has no comments.
function linkContainers(html) {
  const out = [];
  const stack = [];
  const re = /<(\/?)(details|a)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const [, close, tag, attrs] = m;
    if (tag.toLowerCase() === 'details') {
      if (close) stack.pop();
      else stack.push({ open: /(^|\s)open(\s|=|$)/i.test(attrs), cls: (attrs.match(/class="([^"]*)"/) || [])[1] || '' });
      continue;
    }
    if (close) continue;
    const href = (attrs.match(/href="([^"]*)"/) || [])[1];
    if (href) out.push({ href, cls: (attrs.match(/class="([^"]*)"/) || [])[1] || '', details: stack.map((d) => ({ ...d })) });
  }
  assert.equal(stack.length, 0, 'the page left a <details> unclosed, so the structure cannot be trusted');
  return out;
}
const linkTo = (links, href) => {
  const hits = links.filter((l) => l.href === href);
  assert.equal(hits.length, 1, 'expected exactly one link to ' + href + ', found ' + hits.length);
  return hits[0];
};

// Tests 1, 2 and 4 read the same page, so one box serves all three.
let _both = null;
const bothHeld = () => (_both ||= boxHolding(['trinityone.apk', 'trinityone-steward.apk']));

test('with both apps held, the member app is the one download in plain view', async () => {
  const links = linkContainers(await bothHeld());
  const member = linkTo(links, '/trinityone.apk');
  assert.equal(member.details.length, 0,
    'the member app download sits inside a <details>, so a member has to open something to find the app meant for them');
});

test('with both apps held, the steward download is behind a disclosure that starts closed', async () => {
  const html = await bothHeld();
  const steward = linkTo(linkContainers(html), '/trinityone-steward.apk');
  assert.ok(steward.details.length >= 1,
    'the steward download is in plain view beside the member app — the two-equal-buttons confusion is back');
  assert.ok(steward.details.every((d) => !d.open),
    'the steward download is inside a <details> that is already open, so it is not hidden at all');
  // It comes after the numbered steps, so the steps' "Download and install above" still points at the member app.
  assert.ok(html.indexOf('href="/trinityone-steward.apk"') > html.indexOf('</ol>'),
    'the steward disclosure was placed above the install steps');
  assert.ok(html.indexOf('href="/trinityone-steward.apk"') < html.indexOf('Pass this on'),
    'the steward disclosure was placed below the "Pass this on" box');
});

test('with both apps held, only the member app gets the solid button', async () => {
  const links = linkContainers(await bothHeld());
  const classes = (l) => l.cls.split(/\s+/);
  assert.ok(classes(linkTo(links, '/trinityone-steward.apk')).includes('quiet'),
    'the steward download has the same solid button as the member app, so the two compete again');
  assert.ok(!classes(linkTo(links, '/trinityone.apk')).includes('quiet'),
    'the member app download was given the quiet button');
});

test('a box holding only the steward app does not hide the only thing it can offer', async () => {
  const links = linkContainers(await boxHolding(['trinityone-steward.apk']));
  const steward = linkTo(links, '/trinityone-steward.apk');
  assert.equal(steward.details.length, 0,
    'with no member app on the box, the steward download was tucked away and the page showed nothing to download');
  assert.equal(links.filter((l) => l.href === '/trinityone.apk').length, 0, 'precondition: no member app on this box');
});

// ── An iPhone cannot install an .apk. During the pilot the iPhone app comes through Apple's TestFlight, so an
// iPhone visitor is shown the TestFlight steps and every .apk goes behind a closed chevron. Decided on the
// server from the User-Agent, because the page carries no script.
const TF_MEMBER = 'https://testflight.apple.com/join/u5CZnMp9';
const TF_STEWARD = 'https://testflight.apple.com/join/whHSMBEZ';
const TF_APP = 'https://apps.apple.com/app/testflight/id899247664';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
let _uaBox = null;
async function pageAs(ua) {
  if (!_uaBox) _uaBox = (async () => { await boxHolding(['trinityone.apk', 'trinityone-steward.apk']); return lastBase; })();
  const r = await fetch((await _uaBox) + '/install', { headers: { 'User-Agent': ua } });
  assert.equal(r.status, 200, 'precondition: /install did not answer');
  return { html: await r.text(), vary: String(r.headers.get('vary') || '') };
}
const closedAll = (l) => l.details.length >= 1 && l.details.every((d) => !d.open);

const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IPOD = 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
for (const [label, ua] of [['iPhone', UA_IPHONE], ['iPad (iOS UA)', UA_IPAD], ['iPod', UA_IPOD]]) test('an ' + label + ' is shown the TestFlight steps, with every .apk behind a closed chevron', async () => {
  const { html, vary } = await pageAs(ua);
  const links = linkContainers(html);
  assert.equal(linkTo(links, TF_MEMBER).details.length, 0,
    'on an iPhone the member TestFlight link is hidden inside a <details>, so the page leads with nothing it can install');
  assert.ok(!linkTo(links, TF_MEMBER).cls.split(/\s+/).includes('quiet'), 'the member TestFlight link lost its solid button');
  assert.ok(links.some((l) => l.href === TF_APP), 'the iPhone page has no link to get TestFlight itself from the App Store');
  for (const href of ['/trinityone.apk', '/trinityone-steward.apk']) {
    assert.ok(closedAll(linkTo(links, href)),
      'on an iPhone the Android file ' + href + ' is in plain view — the very button an iPhone cannot use');
  }
  const steward = linkTo(links, TF_STEWARD);
  assert.ok(closedAll(steward) && steward.details.some((d) => d.cls.split(/\s+/).includes('leaders')),
    'the steward TestFlight link is not inside the closed "For church leaders" chevron');
  assert.ok(!/mobile data/i.test(html),
    'the iPhone page repeats the no-mobile-data claim, which is not true of TestFlight');
  assert.ok(/User-Agent/i.test(vary), 'the page differs by User-Agent but does not say so in Vary, so a cache could serve the iPhone page to Android');
});

for (const [label, ua] of [['Android', UA_ANDROID], ['desktop', UA_DESKTOP]]) {
  test('a ' + label + ' visitor still gets the Android page, with the iPhone steps only behind a closed chevron', async () => {
    const { html, vary } = await pageAs(ua);
    const links = linkContainers(html);
    assert.equal(linkTo(links, '/trinityone.apk').details.length, 0, 'the member .apk is no longer in plain view for ' + label);
    assert.ok(closedAll(linkTo(links, '/trinityone-steward.apk')), 'the steward .apk is not behind a closed chevron for ' + label);
    assert.ok(closedAll(linkTo(links, TF_MEMBER)),
      'the member TestFlight link is in plain view on the ' + label + ' page, competing with the download that works there');
    assert.ok(closedAll(linkTo(links, TF_STEWARD)), 'the steward TestFlight link is in plain view on the ' + label + ' page');
    assert.ok(/User-Agent/i.test(vary), 'no Vary: User-Agent on the ' + label + ' page');
    // An iPad sends a Mac UA and lands here, so the lede must not promise it an app-store-free install.
    const lede = (html.match(/<p class="lede">([\s\S]*?)<\/p>/) || [])[1] || '';
    assert.match(lede, /^Android phones:/, 'the wifi/no-app-store promise is no longer scoped to Android phones');
    assert.match(lede, /iPhone or iPad/, 'the lede does not point an iPad (which arrives with a Mac UA) to its chevron');
  });
}
