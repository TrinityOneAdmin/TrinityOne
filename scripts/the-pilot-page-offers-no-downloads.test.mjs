// THE PUBLIC "GET THE APP" SECTION OFFERS NO DOWNLOAD WHILE THE APP IS INVITATION-ONLY.
//   Run: node --test scripts/the-pilot-page-offers-no-downloads.test.mjs
//
// Owner-approved 2026-09-23 (reference/DESIGN-embeddable-church-info.md, "The pilot website"). While
// TrinityOne is in pilot, welcome.html's "Get the app" section must not hand a stranger a working link to
// any of the six builds (member APK, steward APK, Windows .exe, macOS .dmg, Linux .AppImage, Linux .deb) —
// only a pilot church's own join slip does that. The section stays VISIBLE (so a reader can still see which
// platforms exist) but every control that used to download something becomes inert, a single
// "Joining the pilot? Contact us." mailto action takes over as the primary CTA, and one sentence has to
// survive the whole change: an existing pilot member reading a page that just closed public downloads must
// not conclude the app is unavailable to THEM.
//
// CLAUDE.md rule 1 (test at the point of use): this does not grep welcome.html's source for the six
// hostnames — a `false && ` in front of the gate would leave every character of a matched string in place.
// It renders the real, served page (scripts/gateway.mjs, the same file that serves production) in headless
// Chromium and reads the live DOM: computed hrefs, rendered innerText, the accessibility tree's role for a
// locked control vs a live one, and actual layout width at phone size. Skips (does not fail) with no
// chromium, same contract as scripts/app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { requireFreePort } from './test-ports.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const PORT = 8850, CDP = 9382;   // unique across scripts/*.test.mjs and scripts/*.probe.mjs, checked 2026-09-23
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let gateway, chrome, ws, id = 0, dataDir, profileDir, base;
const send = (method, params) => new Promise((res, rej) => {
  const n = ++id;
  const on = (d) => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } };
  ws.on('message', on); ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
  return r.result.value;
};

before(async () => {
  if (!CHROME) return;
  await requireFreePort(PORT, 'the pilot-downloads page test');
  await requireFreePort(CDP, 'the pilot-downloads page test');

  // The real server: scripts/gateway.mjs, so the page is exercised with the SAME headers (CSP included) and
  // HTML rewriting production gets — a static file server of my own would prove something a bit different.
  dataDir = mkdtempSync(join(tmpdir(), 'trin-pilot-dl-'));
  gateway = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0' },
  });
  gateway.stdout.resume(); gateway.stderr.resume();
  base = 'http://127.0.0.1:' + PORT;
  for (let i = 0; i < 100; i++) { await sleep(200); try { if ((await fetch(base + '/status')).ok) break; } catch {} }

  profileDir = mkdtempSync(join(tmpdir(), 'trin-pilot-dl-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--no-sandbox',
    '--user-data-dir=' + profileDir, '--no-first-run', '--disable-gpu',
    // Never let this reach production — see the note in no-browser-reaches-production.test.mjs. Port 9
    // discards; this test never needs a live relay at all, it renders one static page.
    '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
    'about:blank'], { stdio: 'ignore' });

  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try { const r = await fetch(`http://127.0.0.1:${CDP}/json/list`); target = (await r.json()).find((t) => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('chromium never came up on the debug port');
  ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('DOM.enable', {});
  await send('Accessibility.enable', {});
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chrome && chrome.kill('SIGKILL'); } catch {}
  try { gateway && gateway.kill('SIGKILL'); } catch {}
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { profileDir && rmSync(profileDir, { recursive: true, force: true }); } catch {}
});

async function openAt(width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 2, mobile: width < 500 });
  await send('Page.navigate', { url: base + '/welcome.html' });
  await sleep(500);
}

// The accessibility tree's role for a CSS selector's first match — 'link' for a real, reachable anchor;
// something else (or ignored) for an <a> with no href, which has no implicit ARIA role at all.
async function axRoleOf(selector) {
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  if (!q.nodeId) return undefined;
  const ax = await send('Accessibility.getPartialAXTree', { nodeId: q.nodeId, fetchRelatives: false });
  const node = (ax.nodes || [])[0];
  if (!node) return undefined;
  if (node.ignored) return 'IGNORED';
  return node.role && node.role.value;
}

test('there is a browser to render the page in', { skip: !CHROME ? 'no chromium on this box' : false }, () => {
  assert.ok(CHROME);
});

test('no download URL is reachable from any control in "Get the app"', { skip: !CHROME ? 'no chromium' : false }, async () => {
  await openAt(1280);
  const hrefs = JSON.parse(await ev(
    `JSON.stringify([].slice.call(document.querySelectorAll('#get a')).map(function(a){return a.getAttribute('href');}).filter(Boolean))`));
  const live = hrefs.filter((h) => /\.apk(\?|$)|\.exe(\?|$)|\.dmg(\?|$)|\.AppImage(\?|$)|\.deb(\?|$)|releases\/latest\/download/i.test(h));
  assert.deepEqual(live, [],
    'a control in #get still carries a working link to a build. During the pilot, the general public must ' +
    'not be able to reach any of the six downloads from this page.');
});

test('exactly the six pilot downloads are locked, and each keeps its real target for go-live', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const locked = JSON.parse(await ev(
    `JSON.stringify([].slice.call(document.querySelectorAll('#get [data-live-href]')).map(function(a, i){` +
    // .focus() is the behavioural check, not the .tabIndex IDL getter: Chromium reports tabIndex === 0 for
    // an <a> with no href (an IDL quirk, measured on this box 2026-09-23), but calling .focus() on it does
    // NOT move document.activeElement there — that mismatch is exactly why this checks the real outcome
    // rather than the property that looks right and isn't.
    `a.setAttribute('data-probe-idx', String(i)); a.focus(); var stuck = document.activeElement === a; document.activeElement && document.activeElement.blur && document.activeElement.blur();` +
    `return {liveHref:a.getAttribute('data-live-href'), href:a.getAttribute('href'), focusable:stuck};}))`));
  assert.equal(locked.length, 6, `expected 6 locked download controls, found ${locked.length}`);
  for (const c of locked) {
    assert.equal(c.href, null, `a locked control still has href="${c.href}" — it would still navigate`);
    assert.equal(c.focusable, false, `calling .focus() on a locked control (${c.liveHref}) actually moved keyboard focus there`);
    assert.match(c.liveHref, /^https:\/\/(app\.trinityone\.church|github\.com\/TrinityOneAdmin)/,
      'a locked control lost its real target — go-live would have nothing to restore');
  }
});

test('a locked control has no link role for a screen reader; a live control beside it still does', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const lockedRole = await axRoleOf('#get a[data-live-href="https://app.trinityone.church/trinityone.apk"]');
  assert.notEqual(lockedRole, 'link', `the locked Android control still exposes an accessibility role of "${lockedRole}" — a screen reader would still announce it as a link`);
  const liveRole = await axRoleOf('#get a[href="https://app.trinityone.church/steward.html"]');
  assert.equal(liveRole, 'link', '"Open the console" is not a download and must stay a real, announced link — if this fails the harness itself is broken, not the page');
});

test('the contact action points at hello@trinityone.church and nowhere else', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const mailtos = JSON.parse(await ev(
    `JSON.stringify([].slice.call(document.querySelectorAll('#get .pilot-cta a')).map(function(a){return a.getAttribute('href');}))`));
  assert.deepEqual(mailtos, ['mailto:hello@trinityone.church'],
    'the "Joining the pilot? Contact us." action must be the one live mailto in the pilot CTA, exactly that address');
  const visible = await ev(`getComputedStyle(document.querySelector('#get .pilot-cta')).display !== 'none'`);
  assert.equal(visible, true, 'the contact CTA is not actually shown — deleting it (or the pilot switch) must make this fail');
});

test('the two required sentences are in the rendered text', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const text = await ev(`document.getElementById('get').innerText`);
  assert.match(text, /Joining the pilot\? Contact us\./,
    'the primary pilot action is missing from the rendered page');
  assert.match(text, /Already part of a church using TrinityOne\? Install from your church's own link, not from here\./,
    'the sentence that stops an existing pilot member reading this page as "the app is gone" is missing');
  assert.match(text, /Caution: if someone sends you the app, even someone you trust, don't install it\./,
    'the tamper warning must survive unweakened — it matters MORE while the public route is closed');
});

test('the pilot cards are visibly tagged and the switch is the single "#get[data-pilot]" attribute', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const tagCount = await ev(`document.querySelectorAll('#get .pilot-tag').length`);
  assert.ok(tagCount >= 3, `expected at least 3 "Pilot" tags (one per card/callout), found ${tagCount}`);
  const visibleTags = await ev(
    `[].slice.call(document.querySelectorAll('#get .pilot-tag')).every(function(t){return getComputedStyle(t).display !== 'none';})`);
  assert.equal(visibleTags, true, 'a "Pilot" tag exists but is not actually visible');
  const switchAttr = await ev(`document.getElementById('get').getAttribute('data-pilot')`);
  assert.equal(switchAttr, 'on', 'the pilot switch is not the documented "on" value on <section id="get">');
});

test('the section has no horizontal scroll at phone width', { skip: !CHROME ? 'no chromium' : false }, async () => {
  await openAt(400);
  const widths = JSON.parse(await ev(
    `JSON.stringify({doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, inner: window.innerWidth})`));
  assert.ok(widths.doc <= widths.inner + 1, `document.documentElement.scrollWidth (${widths.doc}) exceeds the 400px viewport (${widths.inner}) — the page scrolls sideways`);
  assert.ok(widths.body <= widths.inner + 1, `document.body.scrollWidth (${widths.body}) exceeds the 400px viewport (${widths.inner})`);
});
