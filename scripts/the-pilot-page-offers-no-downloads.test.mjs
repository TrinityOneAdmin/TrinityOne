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
// CORRECTED THE SAME DAY, one round later: the first cut answered "download the app from this page" with
// a replacement card saying "There's nothing to download from this page right now." Owner: "remove the
// little card... that is obvious, you don't need to say it" — the card itself was the defect, not its
// wording. The whole `.sx-note` card (the download sentence AND the tamper warning, which share one
// wrapper) is now hidden as a unit and reappears as a unit at go-live; nothing replaces it.
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
// 8853, not 8850: a-churchs-public-calendar-is-served-only-when-asked.test.mjs took 8850 on 2026-09-22 and
// this file took it again on 2026-09-23 — the "checked" in the old comment was checked against a tree that
// did not yet have the other file. Under the suite runner one binds it and the other loses its fixture,
// which is not a code failure and reads exactly like one. `no two test files claim the same fixed port` in
// test-ports.test.mjs is the guard; it was red on this pair and on 8971 until both lines changed.
const PORT = 8853, CDP = 9382;   // unique across scripts/*.test.mjs and scripts/*.probe.mjs
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
//
// F6, AUDIT-pilot-page-2026-09-23.md: this used to return `undefined` when the selector matched nothing,
// and the caller's `assert.notEqual(role, 'link')` treats `undefined` as "not link" — so a selector that
// stops matching (the element renamed, removed, or its class dropped) made the test PASS, for a reason
// having nothing to do with what it claims to check. It now throws, by name, so "the element is gone" and
// "the element has no link role" can never be confused with each other again.
async function axRoleOf(selector) {
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  if (!q.nodeId) throw new Error(`axRoleOf: selector "${selector}" matched no element — fix the selector, don't read this as "no role"`);
  const ax = await send('Accessibility.getPartialAXTree', { nodeId: q.nodeId, fetchRelatives: false });
  const node = (ax.nodes || [])[0];
  if (!node) throw new Error(`axRoleOf: selector "${selector}" matched an element with no accessibility node`);
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
  // F3, AUDIT-pilot-page-2026-09-23.md: pin the explanatory sentence too, not just the two headline
  // sentences either side of it — deleting it left all 9 tests green.
  assert.match(text, /We're bringing pilot churches on by hand right now/,
    'the sentence explaining why there is no self-serve signup right now is missing from the contact CTA');
  // CORRECTED 2026-09-23 (F2, owner-approved): this sentence used to end "not from here" — a route, with
  // no word on the one route that is actually unsafe, at the exact moment the tamper warning that named
  // that risk went dormant (checked a few lines below). It now carries both the route and the caution.
  assert.match(text, /Already part of a church using TrinityOne\? Install from your church's own link — not from a file someone sends you\./,
    'the sentence that carries both the "where to install from" AND the "not from a file someone sends ' +
    'you" caution is missing — it has to do the job the hidden tamper warning used to');
  assert.doesNotMatch(text, /Install from your church's own link, not from here\./,
    'the OLD wording ("not from here") is still rendering alongside or instead of the new one — it names ' +
    'a route but not the actual risk (a file forwarded by a friend), which is the whole point of the fix');
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
  // Owner, 2026-09-23, SAME DAY as the sentence above shipped: "remove the little card that says 'there
  // is nothing to download from this page right now' — that is obvious, you don't need to say it." The
  // whole card goes, not just its wording — checked two ways, so a reinstated card fails whether or not
  // it still carries that exact sentence.
  assert.doesNotMatch(text, /There's nothing to download from this page right now/,
    'the "nothing to download" card is back — the owner asked for it to be removed entirely, not reworded');
  const noteVisible = await ev(`getComputedStyle(document.querySelector('#get .sx-note')).display !== 'none'`);
  assert.equal(noteVisible, false,
    'the .sx-note card at the foot of the section is visible — nothing should sit in that spot during the pilot');
});

test('the pilot cards are visibly tagged and the switch is the single "#get[data-pilot]" attribute', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const tagCount = await ev(`document.querySelectorAll('#get .pilot-tag').length`);
  assert.ok(tagCount >= 3, `expected at least 3 "Pilot" tags (one per card/callout), found ${tagCount}`);
  const visibleTags = await ev(
    `[].slice.call(document.querySelectorAll('#get .pilot-tag')).every(function(t){return getComputedStyle(t).display !== 'none';})`);
  assert.equal(visibleTags, true, 'a "Pilot" tag exists but is not actually visible');
  // F5, AUDIT-pilot-page-2026-09-23.md: a count check alone stays green if the label text is changed
  // ("Pilot" → "Soon") without changing the count — pin the actual word.
  const tagTexts = JSON.parse(await ev(
    `JSON.stringify([].slice.call(document.querySelectorAll('#get .pilot-tag')).map(function(t){return t.textContent.trim();}))`));
  for (const t of tagTexts) assert.equal(t, 'Pilot', `a pilot tag reads "${t}", not "Pilot"`);
  const switchAttr = await ev(`document.getElementById('get').getAttribute('data-pilot')`);
  assert.equal(switchAttr, 'on', 'the pilot switch is not the documented "on" value on <section id="get">');
});

// F5, AUDIT-pilot-page-2026-09-23.md: deleting the `.pilot-locked` opacity/grayscale rules left all 9
// existing tests green while nine dead controls rendered as ordinary, clickable-looking buttons — the one
// thing the owner specified visually ("greyed out") was the one thing no test measured. This measures the
// actual computed style a person would see, not a class name (a class can be present and do nothing).
test('a locked control is visibly greyed out; a live control beside it is not', { skip: !CHROME ? 'no chromium' : false }, async () => {
  const locked = JSON.parse(await ev(`(function(){
    var a = document.querySelector('#get a[data-live-href="https://app.trinityone.church/trinityone.apk"]');
    var s = getComputedStyle(a);
    return JSON.stringify({ opacity: s.opacity, filter: s.filter, pointerEvents: s.pointerEvents });
  })()`));
  assert.ok(Number(locked.opacity) < 1,
    `a locked control's computed opacity is ${locked.opacity} — a reader would see no visual difference from a live control`);
  assert.match(locked.filter, /grayscale/,
    `a locked control's computed filter is "${locked.filter}" — it does not desaturate the control`);
  assert.equal(locked.pointerEvents, 'none',
    'a locked control still accepts pointer events per computed style');
  const live = JSON.parse(await ev(`(function(){
    var a = document.querySelector('#get .pilot-cta a[href="mailto:hello@trinityone.church"]');
    var s = getComputedStyle(a);
    return JSON.stringify({ opacity: s.opacity, filter: s.filter, pointerEvents: s.pointerEvents });
  })()`));
  assert.equal(Number(live.opacity), 1,
    `the live "Joining the pilot? Contact us." control is dimmed too (opacity ${live.opacity}) — the ` +
    'contrast between locked and live controls is what proves the greying is selective');
  assert.equal(live.filter, 'none',
    `the live control is desaturated too (filter "${live.filter}")`);
  assert.equal(live.pointerEvents, 'auto',
    'the live control does not accept pointer events per computed style');
});

test('the section has no horizontal scroll at phone width', { skip: !CHROME ? 'no chromium' : false }, async () => {
  await openAt(400);
  const widths = JSON.parse(await ev(
    `JSON.stringify({doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, inner: window.innerWidth})`));
  assert.ok(widths.doc <= widths.inner + 1, `document.documentElement.scrollWidth (${widths.doc}) exceeds the 400px viewport (${widths.inner}) — the page scrolls sideways`);
  assert.ok(widths.body <= widths.inner + 1, `document.body.scrollWidth (${widths.body}) exceeds the 400px viewport (${widths.inner})`);
});

// F1, AUDIT-pilot-page-2026-09-23.md: the lock inside #get was retruthed, but nine OTHER controls that
// point at it — nav (×2), the mobile nav button, the hero, "For churches", both "Support the project"
// cards, and the closing CTA's two buttons — still said "Download"/"Start a church"/"Get the
// Suite"/"Share the app" and landed on a page that says it is closed to the public. Deliberately NOT a
// list of the nine known strings — a list rots the moment a tenth `href="#get"` control is added with
// new wording. This is structural instead: ANY control whose href is exactly "#get" (the locked
// section's own anchor, wherever it appears on the page) must not use an inviting verb while the pilot
// lock is on. A future control that repeats this mistake with different words is still caught.
test('every control that points at the locked "Get the app" section is truthful while the pilot is on', { skip: !CHROME ? 'no chromium' : false }, async () => {
  await openAt(1280);
  const bad = JSON.parse(await ev(`(function(){
    var verbs = /\\b(download|install|get|start)\\b/i;
    var out = [];
    var els = [].slice.call(document.querySelectorAll('a[href="#get"]'));
    for (var i = 0; i < els.length; i++) {
      var text = (els[i].innerText || '').replace(/\\s+/g, ' ').trim();
      if (verbs.test(text)) out.push(text);
    }
    return JSON.stringify(out);
  })()`));
  assert.deepEqual(bad, [],
    'a control whose href is "#get" still invites a stranger to download, install, get or start while ' +
    'the section it points at is locked: ' + JSON.stringify(bad));
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
    var noteVisible = getComputedStyle(document.querySelector('#get .sx-note')).display !== 'none';
    return JSON.stringify({
      tagVisible: tagVisible, ctaVisible: ctaVisible, noteVisible: noteVisible,
      hasOldIntro: /Install it on an Android phone/.test(text),
      hasOldDownloadLine: /Download the app from this page/.test(text),
      hasCaution: /Caution: if someone sends you the app/.test(text),
      hasNewIntro: /We're not open to the public right now/.test(text),
      hasRemovedCard: /There's nothing to download from this page right now/.test(text),
    });
  })()`));
  assert.equal(after_.tagVisible, false, 'a "Pilot" tag is still visible after the switch was turned off');
  assert.equal(after_.ctaVisible, false, 'the contact CTA is still visible after the switch was turned off');
  assert.equal(after_.hasOldIntro, true, 'the pre-pilot intro sentence did not come back');
  assert.equal(after_.noteVisible, true, 'the .sx-note card (the download sentence + tamper warning) did not come back');
  assert.equal(after_.hasOldDownloadLine, true, 'the pre-pilot "download the app from this page" sentence did not come back');
  assert.equal(after_.hasCaution, true, 'the tamper warning did not come back');
  assert.equal(after_.hasNewIntro, false, 'the pilot-only intro sentence is still showing after the switch was turned off');
  assert.equal(after_.hasRemovedCard, false, 'the removed "nothing to download" card text is back — it was deleted outright, not something the switch should ever restore');
});
