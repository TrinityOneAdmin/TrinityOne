// THE PUBLIC "GET THE APP" SECTION OFFERS NEITHER A DOWNLOAD NOR A WAY INTO THE APP, WHILE IT IS
// INVITATION-ONLY.
//   Run: node --test scripts/the-pilot-page-offers-no-downloads.test.mjs
//
// Owner-approved 2026-09-23 (reference/DESIGN-embeddable-church-info.md, "The pilot website"). While
// TrinityOne is in pilot, welcome.html's "Get the app" section must not hand a stranger a working link to
// any of the six builds (member APK, steward APK, Windows .exe, macOS .dmg, Linux .AppImage, Linux .deb) —
// only a pilot church's own join slip does that.
//
// WIDENED THE SAME DAY, owner: "the pilot page needs the webapps grayed out as well" — the first cut of
// this locked every download and left three WEB ROUTES live (member "iPhone & iPad" and "Computer", steward
// "Open the console"), so a stranger could still reach the running app straight from this page. All nine
// controls are locked the same way. Checked before locking them (CLAUDE.md rule 7): none is the route a
// pilot MEMBER is told to use — that is a join-slip link carrying `?follow=…` straight to their own church
// (join.js), never this page's bare app.trinityone.church entry points.
//
// The section stays VISIBLE (so a reader can still see which platforms exist) but every one of the nine
// controls becomes inert, a single "Joining the pilot? Contact us." mailto action takes over as the primary
// CTA, and one sentence has to survive the whole change: an existing pilot member reading a page that just
// closed the public route must not conclude the app is unavailable to THEM.
//
// ALSO WIDENED THE SAME DAY: two sentences that were true went false the moment the section above them
// locked (you cannot "just open it in your browser" or "download the app from this page" any more), and the
// owner asked to hide the tamper warning too ("with no download on the page there is nothing on it to be
// cautious about") — REVERSING the original brief, which said to keep it. This file asserts the reversal,
// not the original instruction.
//
// CLAUDE.md rule 1 (test at the point of use): this does not grep welcome.html's source for the six
// hostnames — a `false && ` in front of the gate would leave every character of a matched string in place.
// It renders the real, served page (scripts/gateway.mjs, the same file that serves production) in headless
// Chromium and reads the live DOM: computed hrefs, rendered innerText, the accessibility tree's role for a
// locked control vs a live one, actual layout width at phone size, and — by flipping the page's own
// `data-pilot` attribute live, no reload — that the single switch really does bring every one of those
// things back at once. Skips (does not fail) with no chromium, same contract as scripts/app-boots.test.mjs.
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

test('no download OR web-route URL is reachable from any control in "Get the app"', { skip: !CHROME ? 'no chromium' : false }, async () => {
  await openAt(1280);
  const hrefs = JSON.parse(await ev(
    `JSON.stringify([].slice.call(document.querySelectorAll('#get a')).map(function(a){return a.getAttribute('href');}).filter(Boolean))`));
  const builds = hrefs.filter((h) => /\.apk(\?|$)|\.exe(\?|$)|\.dmg(\?|$)|\.AppImage(\?|$)|\.deb(\?|$)|releases\/latest\/download/i.test(h));
  assert.deepEqual(builds, [],
    'a control in #get still carries a working link to a build. During the pilot, the general public must ' +
    'not be able to reach any of the six downloads from this page.');
  // The wider check the owner asked for: no control may still open the running app itself either — that
  // includes the member "iPhone & iPad"/"Computer" web routes and the steward "Open the console" page, all
  // of which are bare app.trinityone.church entry points with no href-based way to tell them apart from a
  // download by pattern. Only "Running your own relay" (help.html) and the mailto CTA may remain live.
  const appRoutes = hrefs.filter((h) => /^https:\/\/app\.trinityone\.church/i.test(h));
  assert.deepEqual(appRoutes, [],
    'a control in #get still links straight into the running app (app.trinityone.church). Locking every ' +
    'download and leaving the webapp routes live would still let a stranger reach the app from this page.');
});

test('exactly the nine pilot controls (six downloads, three web routes) are locked, and each keeps its real target for go-live', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const locked = JSON.parse(await ev(
    `JSON.stringify([].slice.call(document.querySelectorAll('#get [data-live-href]')).map(function(a, i){` +
    // .focus() is the behavioural check, not the .tabIndex IDL getter: Chromium reports tabIndex === 0 for
    // an <a> with no href (an IDL quirk, measured on this box 2026-09-23), but calling .focus() on it does
    // NOT move document.activeElement there — that mismatch is exactly why this checks the real outcome
    // rather than the property that looks right and isn't.
    `a.setAttribute('data-probe-idx', String(i)); a.focus(); var stuck = document.activeElement === a; document.activeElement && document.activeElement.blur && document.activeElement.blur();` +
    `return {liveHref:a.getAttribute('data-live-href'), href:a.getAttribute('href'), focusable:stuck};}))`));
  assert.equal(locked.length, 9, `expected 9 locked controls (6 downloads + 3 web routes), found ${locked.length}`);
  for (const c of locked) {
    assert.equal(c.href, null, `a locked control still has href="${c.href}" — it would still navigate`);
    assert.equal(c.focusable, false, `calling .focus() on a locked control (${c.liveHref}) actually moved keyboard focus there`);
    assert.match(c.liveHref, /^https:\/\/(app\.trinityone\.church|github\.com\/TrinityOneAdmin)/,
      'a locked control lost its real target — go-live would have nothing to restore');
  }
  // The three web routes specifically, named, so deleting the wrapper around any ONE of them fails by name
  // rather than only by a count that could hide which one went missing.
  const wantLive = ['https://app.trinityone.church/', 'https://app.trinityone.church/steward.html'];
  for (const want of wantLive) {
    assert.ok(locked.some((c) => c.liveHref === want), `no locked control names ${want} as its real target`);
  }
});

test('a locked control has no link role for a screen reader; a live control beside it still does', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const lockedRole = await axRoleOf('#get a[data-live-href="https://app.trinityone.church/trinityone.apk"]');
  assert.notEqual(lockedRole, 'link', `the locked Android control still exposes an accessibility role of "${lockedRole}" — a screen reader would still announce it as a link`);
  // Re-anchored 2026-09-23: "Open the console" (the previous live comparison) is now ITSELF locked, so it
  // can no longer be the control that proves the locking is selective — using it would make this pass for
  // the wrong reason (everything ignored, not "only the locked things ignored"). "Running your own relay"
  // (the help-guide link beside the Linux builds) was never a pilot download or web route and stays live.
  const liveRole = await axRoleOf('#get a[href="help.html#console-relay"]');
  assert.equal(liveRole, 'link', '"Running your own relay" is not part of the pilot lock and must stay a real, announced link — if this fails the harness itself is broken, not the page');
});

test('the contact action points at hello@trinityone.church and nowhere else', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const mailtos = JSON.parse(await ev(
    `JSON.stringify([].slice.call(document.querySelectorAll('#get .pilot-cta a')).map(function(a){return a.getAttribute('href');}))`));
  assert.deepEqual(mailtos, ['mailto:hello@trinityone.church'],
    'the "Joining the pilot? Contact us." action must be the one live mailto in the pilot CTA, exactly that address');
  const visible = await ev(`getComputedStyle(document.querySelector('#get .pilot-cta')).display !== 'none'`);
  assert.equal(visible, true, 'the contact CTA is not actually shown — deleting it (or the pilot switch) must make this fail');
});

test('the two required sentences are in the rendered text, and nothing on the page still claims a download or an open-in-browser', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const text = await ev(`document.getElementById('get').innerText`);
  assert.match(text, /Joining the pilot\? Contact us\./,
    'the primary pilot action is missing from the rendered page');
  assert.match(text, /Already part of a church using TrinityOne\? Install from your church's own link, not from here\./,
    'the sentence that stops an existing pilot member reading this page as "the app is gone" is missing');
  // The tamper warning is hidden, not deleted (owner reversed the original brief 2026-09-23: "Hide the
  // tamper proof line for now as well" — with no download on the page there is nothing to be cautious
  // about). It must not render now, and the next test proves the switch brings it back.
  assert.doesNotMatch(text, /Caution: if someone sends you the app/,
    'the tamper warning is rendering — it should be hidden behind the pilot switch while nothing is downloadable');
  // The two sentences that went false the moment the section locked (owner, 2026-09-23). A test that only
  // checked the NEW copy would stay green even if someone restored the OLD, now-false sentence ALONGSIDE
  // it — checking both directions closes that gap.
  assert.doesNotMatch(text, /Install it on an Android phone, or just open it in your browser on any device/,
    'the page still claims you can install or open it in your browser — you cannot, every route above is locked');
  assert.doesNotMatch(text, /Download the app from this page, or from your church's own TrinityOne address/,
    'the page still claims you can download the app from this page — you cannot, every download is locked');
  assert.match(text, /We're not open to the public right now\./,
    'the replacement sentence for the section intro is missing');
  assert.match(text, /There's nothing to download from this page right now\./,
    'the replacement sentence above the (now-hidden) caution box is missing');
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

// LAST ON PURPOSE. This is the only test that mutates the shared page (it flips `data-pilot` live, with
// no reload, to prove the switch really does govern everything at once) rather than only reading it, so
// it runs after every other test that depends on the pilot-on state — and opens its own fresh copy of the
// page first, rather than trusting whatever state an earlier test left the shared page in.
test('going live is flipping ONE attribute: it brings the tags, the CTA, the old copy and the tamper warning back together, with no reload', { skip: !CHROME ? 'no chromium' : false }, async () => {
  await openAt(1280);
  const before_ = await ev(`document.getElementById('get').getAttribute('data-pilot')`);
  assert.equal(before_, 'on', 'expected the page to load with the pilot switch on');
  await ev(`document.getElementById('get').setAttribute('data-pilot', 'off')`);
  const after_ = JSON.parse(await ev(`(function(){
    var text = document.getElementById('get').innerText;
    var tagVisible = [].slice.call(document.querySelectorAll('#get .pilot-tag')).some(function(t){return getComputedStyle(t).display !== 'none';});
    var ctaVisible = getComputedStyle(document.querySelector('#get .pilot-cta')).display !== 'none';
    return JSON.stringify({
      tagVisible: tagVisible, ctaVisible: ctaVisible,
      hasOldIntro: /Install it on an Android phone/.test(text),
      hasOldDownloadLine: /Download the app from this page/.test(text),
      hasCaution: /Caution: if someone sends you the app/.test(text),
      hasNewIntro: /We're not open to the public right now/.test(text),
    });
  })()`));
  assert.equal(after_.tagVisible, false, 'a "Pilot" tag is still visible after the switch was turned off');
  assert.equal(after_.ctaVisible, false, 'the contact CTA is still visible after the switch was turned off');
  assert.equal(after_.hasOldIntro, true, 'the pre-pilot intro sentence did not come back');
  assert.equal(after_.hasOldDownloadLine, true, 'the pre-pilot "download the app from this page" sentence did not come back');
  assert.equal(after_.hasCaution, true, 'the tamper warning did not come back');
  assert.equal(after_.hasNewIntro, false, 'the pilot-only intro sentence is still showing after the switch was turned off');
});
