// A SETTINGS PAGE OPENS AT ITS TOP — AND ARRIVING AT SETTINGS DOES NOT MOVE THE CONSOLE.
//   Run: node --test scripts/a-settings-page-opens-at-its-top.test.mjs
//
// Owner, 2026-11-16, desktop: in the steward console's Settings, the list of pages and the open page sit side
// by side, and both scroll in the console's <main>. Scroll down, pick another page, and the new page opened
// scrolled to wherever the old one was — its top, which is where its title and first card are, out of sight.
// Nothing reset <main>'s scrollTop when the open page changed.
//
// The fix (DashSettings) resets <main> to the top when the open page CHANGES AFTER MOUNT, and deliberately not
// on mount: arriving at Settings — from another section, or by a deep link — must not move the console
// (owner decision, 2026-11-16). The owner accepted that the list beside the page scrolls up too.
//
// ── WHY A BROWSER, AND WHAT IS REAL ──────────────────────────────────────────────────────────────────────
// Scroll position exists only in a real layout, so this is the real steward.html off the real gateway in
// headless Chromium, driven down the real "Start a new church" path, every page picked by clicking the row a
// steward would click. Every claim is a scrollTop or a rect read from the DOM; nothing here matches text in
// app/*.jsx (CLAUDE.md rule 3). Same instrument as scripts/console-phone-layout-batch-a.test.mjs.
//
// Desktop 900x600 is the owner's case; the phone (360x730, list then page) is measured as well.
// Owner decisions added 2026-11-16 (second round): re-picking Settings while in Settings goes to the top;
// on a phone, "All settings" returns to the list at the offset the steward left it.
// Skips itself when chromium is unavailable, so CI without a browser stays green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8919, CDP = 9399;
const ROOT = new URL('..', import.meta.url).pathname;
const DW = 900, DH = 600, PW = 360, PH = 730;
const PIN = 'cedar-harbour-lamp-42';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let relay, chr, ws, dataDir, prof, evalIn, send, booted = '';
const errors = [];
const bootTrace = [];

const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const type = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
  if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  if (!CHROME) return;
  await requireFreePort(PORT, 'a-settings-page-opens-at-its-top.test.mjs');
  await requireFreePort(CDP, 'a-settings-page-opens-at-its-top.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-settop-'));
  // A throwaway church, and the production hosts pointed at a black hole (see console-phone-layout-batch-a).
  const cp = getPublicKey(generateSecretKey());
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-settop-chr-' + process.pid);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, `--window-size=${DW},${DH}`,
    `http://127.0.0.1:${PORT}/steward.html`], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
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
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: DW, height: DH, deviceScaleFactor: 1, mobile: false });
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };

  // WAIT ON STATE, NOT ON A CLOCK — the budget is a ceiling (see console-phone-layout-batch-a's before()).
  const BUDGET = 90000;
  const pollFor = async (what, expression) => {
    const t0 = Date.now();
    for (;;) {
      let last;
      try { last = await evalIn(expression); } catch (e) { last = 'the page would not evaluate: ' + String((e && e.message) || e).slice(0, 160); }
      if (last === 'ok') { bootTrace.push(`${what}: ok after ${Date.now() - t0}ms`); return 'ok'; }
      if (Date.now() - t0 > BUDGET) { const why = `${what}: NEVER ARRIVED (last saw: ${JSON.stringify(last)})`; bootTrace.push(why); return why; }
      await sleep(250);
    }
  };
  const step = async (what, expression) => { const r = await pollFor(what, expression); if (r !== 'ok' && booted === 'ok') booted = r; };

  booted = await pollFor('the "Start a new church" button', click('/Start a new church/i'));
  if (booted === 'ok') await step('both PIN boxes', `(() => { const ph = [...document.querySelectorAll('input')].map(i => i.placeholder || '');
    return (ph.some(p => p.includes('At least 8')) && ph.some(p => p.includes('Type it again'))) ? 'ok' : 'placeholders: ' + JSON.stringify(ph).slice(0, 180); })()`);
  if (booted === 'ok') {
    const a = await evalIn(type('At least 8', PIN));
    const b = await evalIn(type('Type it again', PIN));
    if (a !== 'ok' || b !== 'ok') booted = `a PIN box would not take a value (${a} / ${b})`;
    // The first-run wizard is not under test; mark it done before the dashboard mounts and reads the flag.
    await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); return 'ok'; })()`);
  }
  if (booted === 'ok') await step('an enabled "Set PIN" button', `(() => { const b = [...document.querySelectorAll('button')].find(x => /Set PIN/i.test((x.textContent || '').trim()));
    if (!b) return 'no "Set PIN" button'; if (b.disabled) return '"Set PIN" still disabled'; b.click(); return 'ok'; })()`);
  if (booted === 'ok') await step('the desktop dashboard (a <main>, the Settings avatar, no wizard)', `(() => (document.querySelector('main') && document.querySelector('button[aria-label="Settings"]') && !document.querySelector('[data-stew-modal-panel]')) ? 'ok' : 'not yet')()`);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

const SKIP = { skip: !CHROME ? 'no chromium' : false, timeout: 300000 };

// THE CONSOLE'S SCROLLER and where the open page's top sits relative to it.
const STATE = `(() => { const m = document.querySelector('main'); const s = document.querySelector('section.set-page');
  const mr = m ? m.getBoundingClientRect() : null, sr = s ? s.getBoundingClientRect() : null;
  return JSON.stringify({ main: !!m, scrollTop: m ? m.scrollTop : null, room: m ? m.scrollHeight - m.clientHeight : null,
    page: s ? s.getAttribute('aria-label') : null, pageTop: sr ? Math.round(sr.top) : null, mainTop: mr ? Math.round(mr.top) : null,
    back: !!document.querySelector('button.set-back') }); })()`;
const state = async () => JSON.parse(await evalIn(STATE));
const poll = async (ok, budget = 4000) => { const t0 = Date.now(); for (;;) { const v = await state(); if (ok(v) || Date.now() - t0 > budget) return v; await sleep(150); } };

async function goSettings() {
  const r = await evalIn(`(() => { const b = document.querySelector('button[aria-label="Settings"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', 'no Settings (avatar) control in the console header — re-anchor this test');
  await sleep(1200);
}
async function openAllGroups() {
  // One press per round trip: four presses in one task leave only the last open (console-phone-layout-batch-a).
  for (let i = 0; i < 8; i++) {
    const more = await evalIn(`(() => { const b = document.querySelector('nav[aria-label="Settings pages"] button.set-grp[aria-expanded="false"]'); if (!b) return 'done'; b.click(); return 'more'; })()`);
    if (more === 'done') break;
    await sleep(250);
  }
  const shut = await evalIn(`document.querySelectorAll('nav[aria-label="Settings pages"] button.set-grp[aria-expanded="false"]').length`);
  assert.equal(shut, 0, 'the harness could not open every settings group');
  await sleep(400);
}
// Press the LAST settings row that is not the open page; returns its name.
const pressLastOtherRow = async () => evalIn(`(() => { const rows = [...document.querySelectorAll('nav[aria-label="Settings pages"] button.set-item')].filter(b => b.getAttribute('aria-current') !== 'page');
  const b = rows.pop(); if (!b) return null; const n = (b.querySelector('.set-item-n') || b).textContent.trim(); b.click(); return n; })()`);
const scrollMainTo = async (y) => evalIn(`(() => { const m = document.querySelector('main'); m.scrollTop = ${y === 'bottom' ? 'm.scrollHeight' : y}; return m.scrollTop; })()`);

test('CONTROL: the console reached its desktop dashboard at 900x600', SKIP, async () => {
  assert.equal(booted, 'ok', 'the console never reached its dashboard:\n  ' + bootTrace.join('\n  ') + '\nthrew:\n  ' + (errors.join('\n  ') || '(nothing)'));
  assert.deepEqual(JSON.parse(await evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })')), { w: DW, h: DH });
  assert.deepEqual(errors, [], 'the console threw while booting:\n  ' + errors.join('\n  '));
});

test('desktop 900x600: picking another settings page after scrolling down opens it at its top', SKIP, async () => {
  await goSettings();
  await openAllGroups();
  const s0 = await state();
  assert.ok(s0.main && s0.page, 're-anchor: Settings shows no <main> or no open page on a desktop: ' + JSON.stringify(s0));
  assert.equal(s0.back, false, 're-anchor: a desktop Settings is showing the phone\'s "All settings" control');
  assert.ok(s0.room > 100, 'precondition: with every group open, the console has only ' + s0.room + 'px to scroll — nothing here could be scrolled out of sight');
  // NOT VACUOUS (audit 2026-11-16). Scrolled to the bottom and switched to a shorter page, the browser clamps
  // <main> to 0 with no reset at all — measured: the first version of this test did exactly that ("Help run a
  // church", 444px of room, from 670px). So the console is scrolled a modest Y, and rows are tried from the
  // bottom up until one opens a page that leaves at least Y of room: a page that, without the reset, WOULD
  // have stayed scrolled.
  const names = JSON.parse(await evalIn(`JSON.stringify([...document.querySelectorAll('nav[aria-label="Settings pages"] button.set-item')].map(b => (b.querySelector('.set-item-n') || b).textContent.trim()))`));
  const tried = [];
  for (const name of names.reverse()) {
    const cur = await state();
    if (cur.page === name) continue;
    const y = await scrollMainTo(Math.min(300, cur.room));
    await sleep(250);
    const pre = await state();
    assert.ok(pre.scrollTop > 0, 'precondition: <main> did not scroll: ' + JSON.stringify(pre));
    assert.ok(pre.pageTop < pre.mainTop, 'precondition: the open page\'s top is still in view after scrolling down: ' + JSON.stringify(pre));
    const r = await evalIn(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Settings pages"] button.set-item')].find(x => (x.querySelector('.set-item-n') || x).textContent.trim() === ${JSON.stringify(name)}); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
    assert.equal(r, 'ok', 're-anchor: the row "' + name + '" went missing');
    const opened = await poll(v => v.page === name, 3000);
    assert.equal(opened.page, name, 'pressing "' + name + '" did not open it: ' + JSON.stringify(opened));
    await sleep(500);
    const after = await state();
    tried.push(name + ' room=' + after.room + ' top=' + after.scrollTop);
    if (after.room < y) continue;   // too short to tell: a clamp alone would put it at 0
    assert.equal(after.scrollTop, 0, 'the new page "' + name + '" (room ' + after.room + 'px) opened with the console still scrolled ' + after.scrollTop + 'px down: ' + JSON.stringify(after));
    assert.ok(after.pageTop >= after.mainTop, 'the top of "' + name + '" is above the console\'s visible area: ' + JSON.stringify(after));
    assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
    return;
  }
  assert.fail('precondition: no settings page left enough room to keep the scroll, so nothing here proves a reset. Tried: ' + tried.join('; '));
});

test('desktop 900x600: arriving at Settings from another section does NOT move the console (owner decision)', SKIP, async () => {
  // Settings' groups stay open (remembered), so Settings is tall enough to keep a scroll position on arrival.
  const ov = await evalIn(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Overview'); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(ov, 'ok', 're-anchor: no "Overview" button in the desktop sidebar');
  await sleep(1200);
  const y = await scrollMainTo(120);
  assert.ok(y > 0, 'precondition: the Overview did not scroll at 900x600, so there is no position for arrival to keep (got ' + y + ')');
  await goSettings();
  const s = await poll(v => !!v.page, 3000);
  assert.ok(s.page, 're-anchor: Settings opened no page on arrival: ' + JSON.stringify(s));
  assert.ok(s.room >= y, 'precondition: Settings is too short (' + s.room + 'px of room) to hold the ' + y + 'px the console was at, so the browser clamps it either way');
  await sleep(600);
  const later = await state();
  assert.equal(later.scrollTop, y, 'arriving at Settings moved the console from ' + y + 'px to ' + later.scrollTop + 'px — the owner asked for the reset only when switching between settings pages');
});

test('desktop 900x600: re-picking Settings while in Settings puts the console back at its top (owner decision)', SKIP, async () => {
  // The avatar re-picks Settings; StewDashboard remounts DashSettings (settingsEpoch) on its first page. That
  // remount is a re-pick, not an arrival, and the owner wants it at the top.
  const s0 = await state();
  assert.ok(s0.page, 're-anchor: not on a settings page before the re-pick: ' + JSON.stringify(s0));
  await scrollMainTo('bottom');
  await sleep(300);
  const pre = await state();
  assert.ok(pre.scrollTop > 0, 'precondition: <main> did not scroll: ' + JSON.stringify(pre));
  await goSettings();
  const after = await poll(v => !!v.page && v.scrollTop === 0, 4000);
  assert.ok(after.page, 're-picking Settings opened no page: ' + JSON.stringify(after));
  assert.ok(after.room >= pre.scrollTop, 'precondition: after the re-pick the console has ' + after.room + 'px of room, less than the ' + pre.scrollTop + 'px it was at, so a clamp alone would put it at 0');
  assert.equal(after.scrollTop, 0, 're-picking Settings left the console scrolled ' + after.scrollTop + 'px down: ' + JSON.stringify(after));
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

test('desktop 900x600: re-picking Settings from the SIDEBAR while in Settings puts the console back at its top (the owner\'s case)', SKIP, async () => {
  // Owner, 2026-11-16: "scroll down a Settings page on desktop, click Settings in the sidebar again" — "yes,
  // that's the case I wanted fixed". The sidebar row, not the avatar.
  const s0 = await state();
  assert.ok(s0.page, 're-anchor: not on a settings page before the re-pick: ' + JSON.stringify(s0));
  await scrollMainTo('bottom');
  await sleep(300);
  const pre = await state();
  assert.ok(pre.scrollTop > 0, 'precondition: <main> did not scroll: ' + JSON.stringify(pre));
  const r = await evalIn(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Console sections"] button')].filter(x => (x.textContent || '').trim() === 'Settings'); if (b.length !== 1) return 'found ' + b.length; b[0].click(); return 'ok'; })()`);
  assert.equal(r, 'ok', 're-anchor: expected exactly one "Settings" row in the desktop sidebar: ' + r);
  const after = await poll(v => !!v.page && v.scrollTop === 0, 4000);
  assert.ok(after.page, 're-picking Settings from the sidebar opened no page: ' + JSON.stringify(after));
  assert.ok(after.room >= pre.scrollTop, 'precondition: after the re-pick the console has ' + after.room + 'px of room, less than the ' + pre.scrollTop + 'px it was at, so a clamp alone would put it at 0');
  assert.equal(after.scrollTop, 0, 're-picking Settings from the sidebar left the console scrolled ' + after.scrollTop + 'px down: ' + JSON.stringify(after));
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

test('desktop 900x600: after a sidebar re-pick, leaving Settings and ARRIVING again does NOT move the console', SKIP, async () => {
  // A re-pick marks the next DashSettings mount as "go to the top". That mark must be dropped when the console
  // leaves Settings, or the next plain arrival — which the owner said must not move the console — resets too.
  const side = (label) => evalIn(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Console sections"] button')].filter(x => (x.textContent || '').trim() === ${JSON.stringify(label)}); if (b.length !== 1) return 'found ' + b.length; b[0].click(); return 'ok'; })()`);
  assert.equal(await side('Settings'), 'ok', 're-anchor: expected exactly one "Settings" row in the desktop sidebar');   // a re-pick: already in Settings
  await sleep(1000);
  assert.ok((await state()).page, 're-anchor: not in Settings after the re-pick');
  assert.equal(await side('Overview'), 'ok', 're-anchor: expected exactly one "Overview" row in the desktop sidebar');
  await sleep(1200);
  const y = await scrollMainTo(120);
  await sleep(200);
  assert.ok(y > 0, 'precondition: the Overview did not scroll at 900x600 (got ' + y + ')');
  assert.equal(await side('Settings'), 'ok', 're-anchor: the sidebar "Settings" row went missing');
  const s = await poll(v => !!v.page, 3000);
  assert.ok(s.page, 're-anchor: Settings opened no page on arrival: ' + JSON.stringify(s));
  assert.ok(s.room >= y, 'precondition: Settings has only ' + s.room + 'px of room, less than the ' + y + 'px the console was at, so the browser clamps it either way');
  await sleep(600);
  const later = await state();
  assert.ok(Math.abs(later.scrollTop - y) <= 2, 'arriving at Settings after an earlier re-pick moved the console from ' + y + 'px to ' + later.scrollTop + 'px — the re-pick mark outlived leaving Settings');
  // THE CONSOLE TOUR'S SECTION TIP (triage P2). Arriving scrolled, Settings' first-visit tip is up — and it is IN
  // VIEW: inside <main>'s box, floating at the top of what is shown (not in the flow above it, where it would be
  // out of sight and, inserted above the view, would make Chromium's scroll anchoring move the console — the
  // 120 → 218 this test used to see).
  const TIP = `(() => { const t = document.querySelector('[data-stew-tour="tip"]'); const m = document.querySelector('main'); if (!t || !m) return JSON.stringify({ tip: !!t });
    const tr = t.getBoundingClientRect(), mr = m.getBoundingClientRect(), nx = t.nextElementSibling ? t.nextElementSibling.getBoundingClientRect() : null;
    return JSON.stringify({ tip: true, inMain: tr.top >= mr.top - 1 && tr.bottom <= mr.bottom + 1, float: !!t.closest('[data-stew-tour-float]'), top: Math.round(tr.top), bottom: Math.round(tr.bottom),
      nextTop: nx ? Math.round(nx.top) : null, scrollTop: m.scrollTop }); })()`;
  const tipNow = async (ok, budget = 3000) => { const t0 = Date.now(); for (;;) { const v = JSON.parse(await evalIn(TIP)); if (ok(v) || Date.now() - t0 > budget) return v; await sleep(150); } };
  const up = await tipNow(v => v.tip);
  assert.ok(up.tip, 'CONTROL: no section tip on arriving at Settings — the tip check below would prove nothing');
  assert.ok(up.inMain, 'the section tip is not inside the visible console: ' + JSON.stringify(up));
  // The floating card's room (its height + 14px margin + 8px sticky offset) is below the 120px this arrival is at,
  // so this is a real float, not the small-offset dock checked below.
  const room = up.bottom - up.top + 22;
  assert.ok(room < y, 'precondition: the tip\'s room (' + room + 'px) is not below the ' + y + 'px arrival, so this would dock, not float: ' + JSON.stringify(up));
  assert.equal(up.float, true, 'arriving scrolled, the tip is not floating: ' + JSON.stringify(up));
  // Back at the top: the tip drops into the flow, above the section — not over its first card.
  await scrollMainTo(0);
  const docked = await tipNow(v => v.tip && !v.float);
  assert.equal(docked.float, false, 'back at the top of <main>, the tip still floats over the section: ' + JSON.stringify(docked));
  assert.ok(docked.nextTop != null && docked.bottom <= docked.nextTop, 'the docked tip overlaps the section under it: ' + JSON.stringify(docked));
  // ARRIVING JUST BELOW THE TOP (stage-4 audit): at a 20px offset the section's first cards are in view under where a
  // floating tip would sit. The tip docks — <main> to its top, the tip in the flow — and covers none of the section.
  assert.equal(await side('Overview'), 'ok', 're-anchor: the sidebar "Overview" row went missing');
  await sleep(1200);
  const small = await scrollMainTo(20);
  await sleep(200);
  assert.ok(small > 0 && small < room, 'precondition: could not put the Overview at a small offset (got ' + small + ', room ' + room + ')');
  assert.equal(await side('Settings'), 'ok', 're-anchor: the sidebar "Settings" row went missing');
  const near = await tipNow(v => v.tip && !v.float && v.nextTop != null, 3000);
  assert.ok(near.tip, 'CONTROL: no section tip on arriving at Settings just below the top');
  assert.equal(near.float, false, 'arriving ' + small + 'px down, the tip floats over the top of the section: ' + JSON.stringify(near));
  assert.ok(near.bottom <= near.nextTop, 'arriving ' + small + 'px down, the tip covers the top of the section: ' + JSON.stringify(near));
  assert.equal(near.scrollTop, 0, 'docking did not put the console at its top: ' + JSON.stringify(near));
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

test('phone 360x730: a page tapped from a scrolled settings list opens at its top', SKIP, async () => {
  // THE DECISIVE CASE ONLY. A page shorter than the list's scroll position is clamped to 0 by the browser
  // whether or not the console resets it (measured: tapping the last row from the bottom of the list passed
  // with the reset sabotaged). So the list is scrolled a modest Y, and rows are tried from the bottom up until
  // one opens a page with at least Y of room — a page that, without the reset, WOULD have stayed scrolled.
  await send('Emulation.setDeviceMetricsOverride', { width: PW, height: PH, deviceScaleFactor: 2, mobile: true });
  await sleep(1500);
  await goSettings();
  const toList = async () => { if (await evalIn(`!!document.querySelector('button.set-back')`)) { await evalIn(`document.querySelector('button.set-back').click()`); await sleep(600); } };
  await toList();
  await openAllGroups();
  const names = JSON.parse(await evalIn(`JSON.stringify([...document.querySelectorAll('nav[aria-label="Settings pages"] button.set-item')].map(b => (b.querySelector('.set-item-n') || b).textContent.trim()))`));
  assert.ok(names.length >= 2, 're-anchor: the phone settings list has ' + names.length + ' rows');
  const tried = [];
  for (const name of names.reverse()) {
    await toList();
    const s0 = await state();
    assert.equal(s0.page, null, 're-anchor: a phone Settings is not showing the list on its own: ' + JSON.stringify(s0));
    const y = await scrollMainTo(Math.min(200, s0.room));
    await sleep(200);
    assert.ok(y > 0, 'precondition: the phone settings list did not scroll: ' + JSON.stringify(s0));
    const r = await evalIn(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Settings pages"] button.set-item')].find(x => (x.querySelector('.set-item-n') || x).textContent.trim() === ${JSON.stringify(name)}); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
    assert.equal(r, 'ok', 're-anchor: the row "' + name + '" went missing');
    const opened = await poll(v => v.page === name, 3000);
    assert.equal(opened.page, name, 'tapping "' + name + '" did not open it: ' + JSON.stringify(opened));
    await sleep(500);
    const after = await state();
    tried.push(name + ' room=' + after.room + ' top=' + after.scrollTop);
    if (after.room < y) continue;   // too short to tell: the browser would clamp it to 0 anyway
    assert.equal(after.scrollTop, 0, 'the page "' + name + '" (room ' + after.room + 'px) opened with the console still scrolled ' + after.scrollTop + 'px down from the list: ' + JSON.stringify(after));
    assert.ok(after.pageTop >= after.mainTop, 'the top of "' + name + '" is above the visible area: ' + JSON.stringify(after));
    assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
    return;
  }
  assert.fail('precondition: no settings page on a phone was tall enough to keep a ' + 200 + 'px scroll, so nothing here proves a reset. Tried: ' + tried.join('; '));
});

test('phone 360x730: "All settings" goes back to the list where the steward left it, not to its top (owner decision)', SKIP, async () => {
  await goSettings();                     // a re-pick on a phone shows the list
  if (await evalIn(`!!document.querySelector('button.set-back')`)) { await evalIn(`document.querySelector('button.set-back').click()`); await sleep(600); }
  const s0 = await state();
  assert.equal(s0.page, null, 're-anchor: a phone Settings is not showing the list: ' + JSON.stringify(s0));
  const y = await scrollMainTo(Math.min(250, s0.room));
  await sleep(300);
  assert.ok(y > 50, 'precondition: the phone settings list scrolled only ' + y + 'px, too little to tell a restore from a reset');
  const name = await evalIn(`(() => { const b = document.querySelector('nav[aria-label="Settings pages"] button.set-item'); if (!b) return null; const n = (b.querySelector('.set-item-n') || b).textContent.trim(); b.click(); return n; })()`);
  assert.ok(name, 're-anchor: no settings row to tap');
  const opened = await poll(v => v.page === name, 3000);
  assert.equal(opened.page, name, 'tapping "' + name + '" did not open it: ' + JSON.stringify(opened));
  await sleep(400);
  const back = await evalIn(`(() => { const b = document.querySelector('button.set-back'); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(back, 'ok', 're-anchor: no "All settings" control on a phone settings page');
  const list = await poll(v => v.page === null && Math.abs(v.scrollTop - y) <= 2, 3000);
  assert.equal(list.page, null, '"All settings" did not return to the list: ' + JSON.stringify(list));
  assert.ok(Math.abs(list.scrollTop - y) <= 2, '"All settings" put the list at ' + list.scrollTop + 'px instead of where the steward left it (' + y + 'px): ' + JSON.stringify(list));
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
