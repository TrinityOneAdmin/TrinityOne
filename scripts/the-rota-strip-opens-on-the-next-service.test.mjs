// THE ROTA'S SERVICE STRIP OPENS SCROLLED TO THE NEXT SERVICE — ON A 360px PHONE, IN THE REAL CONSOLE.
//   Run: node --test scripts/the-rota-strip-opens-on-the-next-service.test.mjs
//
// Owner decision 2026-11-13: past services stay on the strip (faded, marked "Past"), and the strip opens on the next
// service that is not past, scrolled so that chip is at the START of the strip. Once a few months of services have
// built up, a 360px phone otherwise opens showing only past chips, with the selected one off-screen to the right.
//
// WHY THIS BOOTS A BROWSER. The scroll is set from the chip's laid-out position (the strip's own scrollLeft, never
// scrollIntoView, which would also scroll the page and every ancestor). The Node harnesses attach no refs to
// elements, so nothing there can see it. Here the console is the real one, laid out by Chromium at the phone's CSS
// pixels and read back with getBoundingClientRect(); nothing matches text in app/*.jsx (CLAUDE.md rules 1 and 3).
//
// The boot, church creation and seeding are the ones scripts/the-rota-teams-are-reachable-on-the-phone.test.mjs
// uses (and explains): a private box on a free port, the church registered on it, the name key minted, then the
// team and twelve weekly past services plus next Sunday's published through the console's own Steward API.
//
// Skips itself when chromium is unavailable, so CI without a browser is green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Polls instead of sleeping a fixed time: a loaded box is slower, not broken. Returns the LAST value seen when
// the budget is spent, so the caller's own assertion still runs and still reports what it always reported.
const settles = async (probe, ok, budget = 90000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await probe();
    if (ok(v) || Date.now() - t0 > budget) return v;
    await sleep(250);
  }
};

let relay, chr, ws, prof, evalIn, send, booted = '', registered = '', seeded = null;
const errors = [];

async function setViewport(v) {
  await send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: v.mobile ? 2 : 1, mobile: v.mobile });
  await sleep(900);   // the console re-reads innerWidth on `resize` (useStewNarrow) and relays out
  const got = JSON.parse(await evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
  assert.deepEqual(got, { w: v.w, h: v.h }, `the viewport is not ${v.name}`);
}

// The Oppo CPH2477, portrait — the phone the strip overflow shows on first.
const PHONE = { name: 'portrait 360x730', w: 360, h: 730, mobile: true };

before(async () => {
  if (!CHROME) return;
  // A fresh, PRIVATE box with no churches, on a free port (no fixed-port collisions with a concurrent suite):
  // the church the console creates below registers itself on it, exactly as the wizard's name step does on a
  // Suite install (a-church-created-on-a-suite-box-publishes-to-it.test.mjs). That is what makes the
  // console's own writes — the teams, rosters and service seeded below — land somewhere it then reads them
  // back from. The gateway with a fixed CHURCH_NPUB (the-console-fits-a-360px-phone.test.mjs) is not that:
  // it holds a DIFFERENT church, so this console's writes would all be refused and the Rota would be empty.
  // Chromium is pointed at a black hole for the production hosts, as every browser test here is.
  relay = await H.startRelay({ name: 'rota-box' });
  const cdp = await H.freePort('the-rota-strip-opens-on-the-next-service.test.mjs (Chrome debug port)');
  prof = mkdtempSync(join(tmpdir(), 'trin-rota-strip-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, `--window-size=${PHONE.w},${PHONE.h}`,
    `${relay.base}/steward.html`], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      errors.push((e.exception?.description || e.text || '').split('\n')[0]);
    }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  await setViewport(PHONE);

  // ── KEEP THE FIRST-RUN WIZARD OFF THE SCREEN ──────────────────────────────────────────────────────────
  // Creating a church deliberately shows the setup wizard: a full-screen overlay with its own backdrop, and
  // step 0 has no exit (the-console-fits-a-360px-phone.test.mjs explains why it cannot cheaply be dismissed
  // and simply measures around it). This file cannot measure around it: `elementFromPoint` over an Assign
  // button would return the wizard's backdrop and every reachability claim below would be about the wizard.
  // The gate is `localStorage['trinityone.steward.wizard.done'] === '1'`, read once when the dashboard
  // mounts; the create path REMOVES that key on purpose (app/steward-root.jsx, seedNewChurch), so setting it
  // in advance is undone. This test-only shim keeps the key: `removeItem` ignores that one name inside this
  // Chromium profile. It touches nothing in the app and nothing this file asserts on — it only stops an
  // unrelated overlay from sitting on top of the thing under test.
  await evalIn(`(() => {
    localStorage.setItem('trinityone.steward.wizard.done', '1');
    const rm = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) { if (k === 'trinityone.steward.wizard.done') return; return rm.call(this, k); };
    return 'ok';
  })()`);

  // Drive the real path to a real dashboard, exactly as app-boots.test.mjs does: the console refuses to hold a
  // plaintext seed, so a seeded fixture would have to reproduce its AES-GCM format and would silently drift.
  const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
  const type = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
    if(!i) return 'miss';
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
  await settles(() => evalIn(`!![...document.querySelectorAll('button')].find(x=>/Start a new church/i.test((x.textContent||'').trim()))`), v => v === true);
  booted = await evalIn(click('/Start a new church/i'));
  await settles(() => evalIn(`!![...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes('At least 8'))`), v => v === true);
  await evalIn(type('At least 8', 'cedar-harbour-lamp-42'));
  await evalIn(type('Type it again', 'cedar-harbour-lamp-42'));
  await evalIn(click('/Set PIN/i'));
  // key generation: the church key exists once Set PIN has been through (selfRegister below needs it)
  await settles(() => evalIn(`window.Steward && window.Steward.churchPub || ''`), v => /^[0-9a-f]{64}$/.test(String(v)));

  // The wizard's name step, without the wizard: register the church on the box that serves this console
  // (`createHere` is the one opt-in that makes the serving box a registration target — the same call the
  // wizard's saveName makes, app/stew-dashboard.jsx), then give it a name. Until a box holds the church,
  // it refuses every one of the church's writes.
  registered = await evalIn(`(async () => {
    const S = window.Steward;
    try { await Promise.resolve(S.selfRegister('St Test on the Rota', { createHere: true })); } catch (e) { return 'selfRegister threw: ' + e.message; }
    const p = await Promise.resolve(S.publishProfile({ name: 'St Test on the Rota' }));
    return p ? 'ok' : 'profile not saved';
  })()`);
  await sleep(3000);

  // Then reload and unlock. The sockets this session opened were dialled BEFORE the box held the church, and
  // the name-key mint below refuses to act on a view it has not authenticated (steward.src.js, the mint gate);
  // a-church-created-on-a-suite-box-publishes-to-it.test.mjs records that "a reload and an unlock" is what
  // recovers this. The wizard flag survives the reload (only creating a church clears it), so no shim is
  // needed a second time; the PIN is the one set above.
  await send('Page.reload', { ignoreCache: false });
  // the PIN field is what a console that remembers its church shows; typing is idempotent, so probe by typing
  await settles(() => evalIn(type('Your PIN or passphrase', 'cedar-harbour-lamp-42')), v => v === 'ok');
  const unlocked = await evalIn(type('Your PIN or passphrase', 'cedar-harbour-lamp-42'));
  assert.equal(unlocked, 'ok', 'no PIN field after the reload — the console did not remember its church');
  await evalIn(click('/^Unlock$/'));
  // unlocked = the church key is back in memory
  await settles(() => evalIn(`!!(window.Steward && window.Steward.hasKey && window.Steward.churchPub)`), v => v === true);

  // ── A CHURCH WITH THREE SERVING TEAMS, ROLES ON EACH, AND ONE SERVICE ─────────────────────────────────
  // Through the console's own API — the calls the wizard's "serving team" step and the New team dialog make
  // (app/stew-dashboard.jsx, `publishGroup({ kind: 'team' })` then `publishRoster`). Each returns null when
  // the church key has not arrived or no relay accepted; the first test below refuses to go on in that case
  // rather than measure an empty Rota and call it fixed.
  // LOCAL dates, as the console reads them: next Sunday, and the twelve Sundays before today.
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const sunday = (() => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return iso(d); })();
  // two more Sundays after it, so there is room to the right and "aligned to the start" is measurable (with next
  // Sunday last, the strip's maximum scroll would stop it short of the start)
  const laterDates = [7, 14].map(n => { const d = new Date(sunday + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); });
  const pastDates = Array.from({ length: 12 }, (_, k) => { const d = new Date(); d.setDate(d.getDate() - 7 * (12 - k)); return iso(d); });
  //
  // Rosters and services are SEALED under the church's name key, and a brand-new church has none: the wizard's
  // meetings step mints it on the create path with ensureNameKeyForMembers (app/stew-dashboard.jsx says why
  // — publishRoster / publishService wait NAME_KEY_WAIT_MS for a ring and then correctly return null rather
  // than write in the clear). So the seed mints it the same way first, and retries while the relay's answer
  // (which the mint waits for) is still on its way.
  seeded = JSON.parse(await evalIn(`(async () => {
    const S = window.Steward;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const teams = [['Welcome team', ['On the door']]];
    const out = { teams: [], rosters: [], service: null, nameKey: null, authedAfterMs: null };
    // The mint acts only on an AUTHENTICATED view, and the relay's NIP-42 challenge is lazy: it challenges
    // only when a REQ asks for something it withholds from an anonymous reader. A church that is minutes old
    // has nothing to withhold, so nothing here has been challenged yet. A safety-check response list is gated
    // to the church and its stewards whether or not one exists, so subscribing to it (the console's own API)
    // draws the challenge; the console signs it the way it always does (pool.automaticallyAuth).
    const off = S.subscribeSafetyResponses('rota-test-draws-the-challenge', () => {});
    const t0 = Date.now();
    for (let i = 0; i < 40 && !S.relayAuthed(); i++) await sleep(250);
    out.authedAfterMs = S.relayAuthed() ? Date.now() - t0 : null;
    try { off(); } catch (e) {}
    for (let i = 0; i < 10 && !out.nameKey; i++) {
      try { out.nameKey = (await Promise.resolve(S.ensureNameKeyForMembers([], []))) ? 'minted' : null; } catch (e) { out.nameKey = 'threw: ' + e.message; }
      if (!out.nameKey) await sleep(1500);
    }
    for (const [name, roles] of teams) {
      const g = await S.publishGroup({ name, kind: 'team', sub: 'Serving team' });
      out.teams.push(g && g.id ? g.id : null);
      if (!g || !g.id) continue;
      const r = await S.publishRoster(g.id, { roles: roles.map(n => ({ name: n })), people: [] });
      out.rosters.push(r ? 'ok' : null);
    }
    out.past = [];
    for (const date of ${JSON.stringify(pastDates)}) { const p = await S.publishService({ name: 'Sunday Gathering', date, time: '10:30' }); out.past.push(p && p.id ? p.id : null); }
    const svc = await S.publishService({ name: 'Sunday Gathering', date: ${JSON.stringify(sunday)}, time: '10:30' });
    out.service = svc && svc.id ? svc.id : null;
    out.later = [];
    for (const date of ${JSON.stringify(laterDates)}) { const p = await S.publishService({ name: 'Sunday Gathering', date, time: '10:30' }); out.later.push(p && p.id ? p.id : null); }
    // diagnostics for the failure message only: where this console thinks its church lives
    try { out.relays = S.relayList(); out.lives = S.whereChurchLives(); out.authed = S.relayAuthed(); out.status = S.relayStatus ? await Promise.resolve(S.relayStatus()) : null; out.boxhosts = localStorage.getItem('trinityone.steward.boxhosts.' + S.churchPub); } catch (e) { out.diag = 'threw: ' + e.message; }
    return JSON.stringify(out);
  })()`));
  await sleep(2500);   // the console learns of its own documents the way it learns of anyone's: from the relay
});


after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { H.stopAll(); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

// The console's section buttons, wherever this build keeps them. Before feat/console-hamburger-nav the
// phone shows a strip of pills; after it the same buttons live in a drawer behind a ☰ (`aria-label="Sections"`)
// and exist only while it is open. This test must pass on either side of that merge — an audit of the two
// branches found it red 3/4 the moment they met — so: open the drawer if there is one, then look.
const SECTIONS_JS = `(async () => {
  const burger = document.querySelector('button[aria-label="Sections"]');
  if (burger && burger.getAttribute('aria-expanded') !== 'true') { burger.click(); await new Promise(r => setTimeout(r, 400)); }
  const scope = document.querySelector('[role="dialog"][aria-label="Sections"] nav') || document.querySelector('nav[aria-label="Console sections"]');
  return scope ? [...scope.querySelectorAll('button')].map(b => (b.textContent || '').trim()) : [];
})()`;
async function sectionLabels() { return evalIn(SECTIONS_JS); }

// Open one of the console's sections by pressing its real nav button, and prove we got there.
async function openTab(label) {
  const r = await evalIn(`(async () => {
    const burger = document.querySelector('button[aria-label="Sections"]');
    if (burger && burger.getAttribute('aria-expanded') !== 'true') { burger.click(); await new Promise(r => setTimeout(r, 400)); }
    const scope = document.querySelector('[role="dialog"][aria-label="Sections"] nav') || document.querySelector('nav[aria-label="Console sections"]');
    const b = scope && [...scope.querySelectorAll('button')].find(x => (x.textContent || '').trim().startsWith(${JSON.stringify(label)}));
    if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" button in the console's nav — re-anchor this test`);
  await sleep(2600);
}


// The strip, its chips, and where each chip sits. The strip is the scroll box the chips live in: found from the
// chips (buttons carrying data-svc-id) upwards, never from text in app/*.jsx.
// (innerText applies the chip's CSS uppercase, so the mark reads PAST there: matched case-insensitively.)
const MEASURE = `(() => {
  const chips = [...document.querySelectorAll('main button[data-svc-id]')];
  if (!chips.length) return JSON.stringify({ chips: 0 });
  const strip = chips[0].parentElement, sr = strip.getBoundingClientRect();
  // EVERYTHING ELSE THAT COULD HAVE SCROLLED: the window, and every ancestor of the strip. scrollIntoView would move
  // one of these; setting the strip's own scrollLeft moves none of them.
  const moved = [];
  if (window.scrollX || window.scrollY) moved.push('window ' + window.scrollX + ',' + window.scrollY);
  for (let el = strip.parentElement; el; el = el.parentElement) if (el.scrollTop || el.scrollLeft) moved.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' ' + el.scrollLeft + ',' + el.scrollTop);
  return JSON.stringify({
    chips: chips.length, scrollLeft: strip.scrollLeft, scrollWidth: strip.scrollWidth, clientWidth: strip.clientWidth,
    strip: [Math.round(sr.left), Math.round(sr.right)], stripTop: Math.round(sr.top), viewportH: innerHeight, moved,
    list: chips.map(c => { const r = c.getBoundingClientRect(); return { id: c.getAttribute('data-svc-id'), on: c.getAttribute('aria-pressed'),
      past: /\\bpast\\b/i.test(c.innerText || ''), left: Math.round(r.left), right: Math.round(r.right),
      opacity: Math.min(...[...c.querySelectorAll('*')].map(e => Number(getComputedStyle(e).opacity))) }; }),
  });
})()`;

test('the console reached its dashboard with a team, twelve past services, next Sunday and two after it — without which nothing below proves anything',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
    assert.equal(booted, 'ok', 'the "Start a new church" button was never found');
    assert.equal(registered, 'ok', 'the church did not register on its box, so nothing it publishes is stored: ' + registered);
    assert.ok(seeded && seeded.teams.length === 1 && seeded.teams.every(Boolean), 'the team was not saved: ' + JSON.stringify(seeded));
    assert.deepEqual(seeded.rosters, ['ok'], 'the roster was not saved: ' + JSON.stringify(seeded));
    assert.ok(seeded.past.length === 12 && seeded.past.every(Boolean), 'the twelve past services were not all saved: ' + JSON.stringify(seeded));
    assert.ok(seeded.service, 'next Sunday\'s service was not saved: ' + JSON.stringify(seeded));
    assert.ok(seeded.later.length === 2 && seeded.later.every(Boolean), 'the two later Sundays were not saved: ' + JSON.stringify(seeded));
    assert.deepEqual(errors, [], 'the console threw while reaching its dashboard:\n  ' + errors.join('\n  '));
  });

test('at 360px the strip opens on next Sunday, scrolled so its chip is at the start and wholly visible; the past ones are faded',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
    await setViewport(PHONE);
    await openTab('Overview');
    // ROOM FOR scrollIntoView TO GIVE ITSELF AWAY (audit of 4c47c063, L1). A test-only stylesheet pushes the Rota
    // 1600px down inside <main>, so the strip opens BELOW the viewport: scrollIntoView would have to scroll <main> or
    // the window to reach it, and the "nothing else moved" check below would see that. The strip's own scrollLeft
    // moves nothing else. It changes no app code and is removed at the end of the next test.
    await evalIn(`(() => { const st = document.createElement('style'); st.id = 'test-room-above-the-strip';
      st.textContent = 'main { padding-top: 1600px !important; }'; document.head.appendChild(st);
      window.scrollTo(0, 0); const m = document.querySelector('main'); if (m) { m.scrollTop = 0; m.scrollLeft = 0; } return 'ok'; })()`);
    await openTab('Rota');
    let m = null;
    for (let i = 0; i < 20; i++) { m = JSON.parse(await evalIn(MEASURE)); if (m.chips >= 15) break; await sleep(1000); }
    assert.ok(m.chips >= 15, `expected the 15 seeded services on the strip, found ${m.chips} — the seed did not reach the screen, or the chips lost data-svc-id (re-anchor this test)`);
    const next = m.list.find(c => c.id === seeded.service);
    assert.ok(next, 'next Sunday\'s chip is not on the strip: ' + JSON.stringify(m.list.map(c => c.id)));
    t_diag(m);

    // it is the one selected, and it is not past
    assert.equal(next.on, 'true', 'the strip did not open on next Sunday: ' + JSON.stringify(m.list.filter(c => c.on === 'true')));
    assert.equal(next.past, false, 'next Sunday is marked Past');
    // the strip really scrolled (twelve chips sit before it, far more than 360px)…
    assert.ok(m.scrollWidth > m.clientWidth, 'the strip does not overflow, so this measures nothing: ' + JSON.stringify(m));
    assert.ok(m.scrollLeft > 0, 'the strip opened at the far left, with next Sunday off-screen: ' + JSON.stringify(m));
    // …and next Sunday's chip is wholly inside the strip's visible box, at its start
    assert.ok(next.left >= m.strip[0] - 1 && next.right <= m.strip[1] + 1, `next Sunday's chip (${next.left}..${next.right}) is not inside the strip (${m.strip[0]}..${m.strip[1]})`);
    assert.ok(next.left - m.strip[0] <= 2, `next Sunday's chip is not at the start of the strip (it sits ${next.left - m.strip[0]}px in)`);
    // the page itself was not scrolled to get there. Precondition first: the strip is below the viewport, so
    // scrollIntoView WOULD have had to move something (otherwise this check could not fail)
    assert.ok(m.stripTop > m.viewportH, `the strip is on screen (top ${m.stripTop}px, viewport ${m.viewportH}px), so the no-other-scroll check below proves nothing — re-anchor the test stylesheet`);
    assert.deepEqual(m.moved, [], 'opening the Rota scrolled something other than the strip (the window or an ancestor)');

    // the past chips are faded and marked; next Sunday is neither
    const past = m.list.filter(c => seeded.past.includes(c.id));
    assert.equal(past.length, 12, 'the twelve past chips are not all on the strip');
    const later = m.list.filter(c => seeded.later.includes(c.id));
    assert.ok(later.length === 2 && later.every(c => !c.past && c.opacity === 1), 'a later Sunday is faded or marked Past: ' + JSON.stringify(later));
    assert.ok(past.every(c => c.past && c.opacity < 1), 'a past chip is not faded and marked: ' + JSON.stringify(past.filter(c => !(c.past && c.opacity < 1))));
    assert.equal(next.opacity, 1, 'next Sunday\'s chip is faded');
    assert.deepEqual(errors, [], 'the console threw on the Rota:\n  ' + errors.join('\n  '));
  });

// ONCE, AND NEVER AFTER A TAP (audit of 4c47c063, L2). A steward scrolls the strip by hand; then the list changes (a
// service another steward added arrives, re-rendering the board). The strip must stay where the steward left it —
// first with nothing tapped (only the once-latch stops a re-scroll), then after tapping a chip.
test('the strip scrolls once: a later re-render from a new service does not move it, before or after a chip is tapped',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
    const strip = `[...document.querySelectorAll('main button[data-svc-id]')][0].parentElement`;
    const count = async () => evalIn(`document.querySelectorAll('main button[data-svc-id]').length`);
    const addSunday = async (days) => evalIn(`(async () => {
      const d = new Date(); d.setDate(d.getDate() + ${days});
      const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const r = await window.Steward.publishService({ name: 'Added later', date: iso, time: '10:30' });
      return r && r.id ? r.id : null; })()`);
    const before = await count();
    assert.ok(before >= 15, 'the strip is not on screen — run after the previous test');

    // (a) nothing tapped: hand-scroll, then a new service arrives
    await evalIn(`(${strip}).scrollLeft = 300`);
    const a = await addSunday(40);
    assert.ok(a, 'the extra service was not saved');
    const n1 = await settles(count, v => v > before, 30000);
    assert.ok(n1 > before, 'the new service never reached the strip, so nothing re-rendered and this proves nothing');
    await sleep(1200);
    assert.equal(await evalIn(`(${strip}).scrollLeft`), 300, 'with nothing tapped, a re-render scrolled the strip back');

    // (b) tap the first (past) chip, hand-scroll, then another new service arrives
    const tapped = await evalIn(`(() => { const c = document.querySelector('main button[data-svc-id]'); c.click(); return c.getAttribute('data-svc-id'); })()`);
    await sleep(600);
    await evalIn(`(${strip}).scrollLeft = 600`);
    const b = await addSunday(47);
    assert.ok(b, 'the second extra service was not saved');
    const n2 = await settles(count, v => v > n1, 30000);
    assert.ok(n2 > n1, 'the second new service never reached the strip, so nothing re-rendered and this proves nothing');
    await sleep(1200);
    assert.equal(await evalIn(`(${strip}).scrollLeft`), 600, 'after a tap, a re-render scrolled the strip');
    assert.equal(await evalIn(`document.querySelector('main button[data-svc-id="${tapped}"]').getAttribute('aria-pressed')`), 'true', 'the tapped chip is no longer selected');
    await evalIn(`(() => { const st = document.getElementById('test-room-above-the-strip'); if (st) st.remove(); return 'ok'; })()`);
    assert.deepEqual(errors, [], 'the console threw on the Rota:\n  ' + errors.join('\n  '));
  });

function t_diag(m) { try { console.log('# strip', JSON.stringify({ scrollLeft: m.scrollLeft, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, strip: m.strip })); } catch {} }
