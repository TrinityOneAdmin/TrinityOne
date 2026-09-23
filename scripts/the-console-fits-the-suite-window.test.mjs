// THE CONSOLE FITS THE SUITE'S OWN WINDOW. The desktop Suite opens the console in a 900x780 window, and the
// owner walked it on 2026-09-22 with screenshots: the four Overview stat cards wrapped 3+1, the two lower
// cards sat side by side and squashed ("Noti…", the QR crammed against the code, the npub box past its card),
// and every Settings group started open. Measured at 6b6e66d before anything was changed, in this harness:
// three 195px stat columns with tops 92/92/92/238 (3+1); "Groups & rooms" 300px and "Joining code" 308px wide
// side by side, "Notices" needing 58px of a 46px box (ellipsed), the QR beside a 142px text column; all four
// Settings groups open with 16 rows and nothing stored. (The npub box running past its card's right edge did
// NOT reproduce in Chromium at this size — that one is the Suite's WebKitGTK; the stacking fixes it the same way.)
//
// Everything here is GEOMETRY and DOM STATE read out of a real Chromium at exactly that size, against a real
// gateway on a scratch dir — CLAUDE.md rule 3: app/stew-dashboard.jsx ships unbundled, so nothing here matches
// its text. The boot is the one every console browser test uses (Start a new church → PIN), with the first-run
// wizard kept off the way the-console-fits-a-360px-phone.test.mjs keeps it off.
//
// Run: node --test scripts/the-console-fits-the-suite-window.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { freePort } from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const VW = 900, VH = 780;   // the Suite's console window (relay-app/desktop), as the owner sees it
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;

let gw = null, c = null;

async function startGateway() {
  const port = await freePort('the suite-window test\'s gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-suite-window-'));
  const preload = join(dataDir, 'blackhole.mjs');
  writeFileSync(preload, BLACKHOLE);
  const proc = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(port)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', NODE_OPTIONS: '--import ' + preload },
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/status')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway never served /status');
  return { base, stop() { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
}

async function startChrome(url) {
  const cdp = await freePort('the suite-window test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-suite-window-chrome-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, `--window-size=${VW},${VH}`, url], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  const evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr && rr.result && rr.result.exceptionDetails) {
      const e = rr.result.exceptionDetails;
      throw new Error('the page threw: ' + String((e.exception && e.exception.description) || e.text || 'threw').split('\n')[0]);
    }
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
  };
  const goto = async (u) => { await send('Page.navigate', { url: u }); };
  const waitFor = async (expr, what, ms = 90000) => { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < ms) { await sleep(500); try { ok = !!(await evalIn(expr)); } catch {} } assert.ok(ok, 'timed out waiting for ' + what); };
  return { evalIn, goto, send, waitFor, stop() { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
}

// Boot a church the way a person does, with the first-run wizard kept off (see the 360px test for why refusing
// the one removeItem is the only way that is not a race).
async function bootConsole() {
  await c.goto(gw.base + '/steward.html');
  await c.waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 'the setup screen');
  await c.evalIn(`(() => { const orig = Storage.prototype.removeItem; Storage.prototype.removeItem = function (k) { if (k === 'trinityone.steward.wizard.done') return; return orig.call(this, k); };
    localStorage.setItem('trinityone.steward.wizard.done', '1'); return 'ok'; })()`);
  await c.evalIn(`[...document.querySelectorAll('button')].find(x => /Start a new church/i.test((x.textContent||'').trim())).click()`);
  await c.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 'the PIN gate', 60000);
  const type = (ph, v) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss'; const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
  assert.equal(await c.evalIn(type('At least 8', 'cedar-harbour-lamp-42')), 'ok');
  assert.equal(await c.evalIn(type('Type it again', 'cedar-harbour-lamp-42')), 'ok');
  await c.evalIn(`[...document.querySelectorAll('button')].find(x => /Set PIN/i.test((x.textContent||'').trim())).click()`);
  await c.waitFor(`!!document.querySelector('nav[aria-label="Console sections"]') && !document.querySelector('[role="dialog"]')`, 'the dashboard, with no modal over it');
  await sleep(1500);
}

// The desktop sidebar's section buttons (a <nav aria-label="Console sections"> of buttons whose text is the label).
const openSection = async (label) => {
  const r = await c.evalIn(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Console sections"] button')].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(label)})); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" section in the console's sidebar — re-anchor this test`);
  await sleep(1200);
};

// A card is a .sk-panel whose own <h2> says `title`.
const PANEL = (title) => `[...document.querySelectorAll('.sk-panel')].find(p => { const h = p.querySelector('h2'); return h && (h.textContent||'').trim() === ${JSON.stringify(title)}; })`;

before(async () => {
  if (!CHROME) return;
  gw = await startGateway();
  c = await startChrome('about:blank');
  await bootConsole();
});
after(() => { if (c) c.stop(); if (gw) gw.stop(); });

test('the console is on its Overview at 900x780 — without which nothing below proves anything',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  const v = JSON.parse(await c.evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
  assert.deepEqual(v, { w: VW, h: VH }, 'the viewport is not the Suite window we claim to be measuring');
  assert.equal(await c.evalIn(`!!${PANEL('Groups & rooms')}`), true, 'no "Groups & rooms" card — the Overview is not up');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE FOUR STAT CARDS STAY FOUR ACROSS. Owner: "at the default resolution, the four top cards need to be
//    still 4 along the top". Measured at 6b6e66d: tops 261, 261, 261, 391.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// The stat row is the one grid in <main> whose four children are all role=button; each card's label is its
// first <span>. Read back as geometry: where each card's top is, and whether its label's text fits its box.
const STAT_CARDS = `(() => {
  const grid = [...document.querySelectorAll('main div')].find(d => getComputedStyle(d).display === 'grid' && d.children.length === 4 && [...d.children].every(k => k.getAttribute('role') === 'button'));
  if (!grid) return '[]';
  return JSON.stringify([...grid.children].map(el => { const r = el.getBoundingClientRect(); const sp = el.querySelector('span');
    return { label: sp ? sp.textContent : '', top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), labelFits: sp ? sp.scrollWidth <= sp.clientWidth + 0.5 : null, need: sp ? sp.scrollWidth : 0, have: sp ? sp.clientWidth : 0 }; }));
})()`;

test('the four Overview stat cards sit on one row at 900x780',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  await openSection('Overview');
  const cards = JSON.parse(await c.evalIn(STAT_CARDS));
  console.log('    stat cards: ' + JSON.stringify(cards));
  assert.equal(cards.length, 4, 're-anchor: expected the four stat cards, found ' + cards.length);
  const tops = new Set(cards.map(x => x.top));
  assert.equal(tops.size, 1, 'THE DEFECT: the four stat cards wrap onto more than one row at the Suite\'s window width (tops ' + cards.map(x => x.top).join('/') + ')');
  // …and four across is only a fix if the labels still read. StatCard's note records "Announce…" at 960px from
  // an earlier four-column attempt; the ellipsis is a backstop that must fire nowhere at this size.
  for (const x of cards) assert.equal(x.labelFits, true, `the "${x.label}" card's label is cut short ("…") at ${x.w}px — four across at this width needs a smaller card, not a truncated one`);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. THE TWO LOWER CARDS STACK, AND NOTHING IN THEM IS SQUASHED. Measured at 6b6e66d: "Groups & rooms" 300px and
//    "Joining code" 308px side by side, "Notices" needing 58px of a 46px box, the QR beside a 142px text column.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const PIN = 'cedar-harbour-lamp-42';
// Rooms for the group list to show. A church with no NAME cannot register on its own box (gateway H4 refuses a
// nameless row), and an unregistered church's writes are refused, so the church is named and registered the way
// the wizard's name step does it (selfRegister with createHere, then the profile) before any room is published.
// The room subscription was opened before the church existed, so it is re-issued by reloading and unlocking.
async function seedRooms() {
  const reg = await c.evalIn(`(async () => { try { const r = await Promise.resolve(window.Steward.selfRegister('Grace Church', { createHere: true })); return r && r.ok ? 'ok' : JSON.stringify(r); } catch (e) { return 'err:' + e.message; } })()`);
  assert.equal(reg, 'ok', 'the church could not register on its own box: ' + reg);
  await c.evalIn(`Promise.resolve(window.Steward.publishProfile({ name: 'Grace Church' })).then(() => 'ok')`);
  const rooms = JSON.parse(await c.evalIn(`(async () => { const out = []; for (const g of [
    { name: 'Whole Church', kind: 'group', sub: 'One room for everyone' }, { name: 'Notices', kind: 'broadcast', sub: 'Dates, news and what’s on' }, { name: 'Prayer', kind: 'group', sub: 'Share and lift requests' }]) {
    const r = await Promise.resolve(window.Steward.publishGroup(g)); out.push(r ? r.name : null); } return JSON.stringify(out); })()`));
  assert.deepEqual(rooms, ['Whole Church', 'Notices', 'Prayer'], 'the three rooms were not all accepted by the relay');
  await c.goto(gw.base + '/steward.html');
  await c.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN'))`, 'the PIN unlock', 60000);
  await c.evalIn(`(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes('Your PIN')); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, ${JSON.stringify(PIN)}); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok'; })()`);
  await c.waitFor(`!!document.querySelector('nav[aria-label="Console sections"]') && !document.querySelector('[role="dialog"]')`, 'the dashboard after unlock');
  await c.waitFor(`(${PANEL('Groups & rooms')} || {textContent:''}).textContent.includes('Prayer')`, 'the rooms on the Overview', 60000);
}

// The joining card on a loopback box shows the go-public gate in place of the invite; "I'll do this later" is the
// steward's own way past it, and what the owner saw after going public is the same invite.
async function revealInvite() {
  await c.waitFor(`[...document.querySelectorAll('button')].some(b => /do this later/i.test(b.textContent||''))`, 'the go-public gate on the joining card', 30000);
  await c.evalIn(`[...document.querySelectorAll('button')].find(b => /do this later/i.test(b.textContent||'')).click()`);
  await c.waitFor(`!!(${PANEL('Joining code')} || document.body).querySelector('textarea')`, 'the invite (its npub box) on the joining card', 30000);
  await sleep(600);
}

const LOWER_CARDS = `(() => {
  const g = ${PANEL('Groups & rooms')}, j = ${PANEL('Joining code')};
  if (!g || !j) return JSON.stringify({ missing: [!g && 'Groups & rooms', !j && 'Joining code'].filter(Boolean) });
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
  const past = (card) => [...card.querySelectorAll('*')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > card.getBoundingClientRect().right + 0.5; })
    .map(el => ({ tag: el.tagName, right: Math.round(el.getBoundingClientRect().right), text: (el.innerText || el.value || '').trim().slice(0, 30) })).slice(0, 6);
  // group names: the one-line ellipsis boxes inside the groups card; ellipsed iff the text needs more than the box has
  const names = [...g.querySelectorAll('div')].filter(d => getComputedStyle(d).textOverflow === 'ellipsis' && getComputedStyle(d).whiteSpace === 'nowrap')
    .map(d => ({ name: d.textContent, ellipsed: d.scrollWidth > d.clientWidth + 0.5 }));
  const qr = j.querySelector('[role="img"]');
  const code = [...j.querySelectorAll('div')].find(d => /^Your church code$/i.test((d.textContent || '').trim()));
  return JSON.stringify({ groups: rect(g), join: rect(j), pastGroups: past(g), pastJoin: past(j), names, qr: qr ? rect(qr) : null, code: code ? rect(code) : null });
})()`;

test('at 900x780 "Groups & rooms" and "Joining code" stack, each with the pane, nothing past a card\'s edge, no room name cut short',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
  await seedRooms();
  await revealInvite();
  const m = JSON.parse(await c.evalIn(LOWER_CARDS));
  console.log('    lower cards: ' + JSON.stringify(m));
  assert.ok(!m.missing, 're-anchor: missing card(s) ' + JSON.stringify(m.missing));
  assert.ok(m.groups.w >= 380 && m.join.w >= 380, `THE DEFECT: the two lower cards are side by side and squashed (Groups & rooms ${m.groups.w}px, Joining code ${m.join.w}px) — under 1000px they stack`);
  assert.notEqual(m.groups.top, m.join.top, 'the two cards share a top edge, so they are still beside each other');
  assert.deepEqual(m.pastGroups, [], 'something inside "Groups & rooms" runs past its right edge');
  assert.deepEqual(m.pastJoin, [], 'something inside "Joining code" runs past its right edge (the npub box, in the owner\'s screenshot)');
  const short = m.names.filter(n => n.name.length <= 12 && n.ellipsed);
  assert.ok(m.names.some(n => n.name === 'Notices'), 're-anchor: the Notices room is not in the list');
  assert.deepEqual(short, [], 'a room name of 12 characters or fewer is cut short with "…": ' + JSON.stringify(short));
  // the joining card puts its QR above its text: the QR's bottom edge is above the "Your church code" label
  assert.ok(m.qr && m.code, 're-anchor: no QR (role=img) or no "Your church code" label on the joining card');
  assert.ok(m.qr.top + m.qr.h <= m.code.top + 0.5, `the QR sits beside the code text, not above it (QR bottom ${m.qr.top + m.qr.h}, label top ${m.code.top})`);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE SETTINGS GROUPS START SHUT. Owner, 2026-09-22 screenshot: "Can we have the settings groups minimized
//    like this on default?" At 6b6e66d a fresh console opened Settings with all four groups open (16 rows).
//    The mechanics are in scripts/settings-groups-collapse-and-are-remembered.test.mjs; this is the point of use.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const GROUP_HEADERS = `JSON.stringify([...document.querySelectorAll('nav[aria-label="Settings pages"] button.set-grp')].map(b => ({ g: (b.querySelector('.set-grp-n')||{}).textContent, open: b.getAttribute('aria-expanded') === 'true', count: (b.querySelector('.set-grp-c')||{textContent:''}).textContent })))`;
const unlock = async () => {
  await c.goto(gw.base + '/steward.html');
  await c.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN'))`, 'the PIN unlock', 60000);
  await c.evalIn(`(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes('Your PIN')); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, ${JSON.stringify(PIN)}); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok'; })()`);
  await c.waitFor(`!!document.querySelector('nav[aria-label="Console sections"]') && !document.querySelector('[role="dialog"]')`, 'the dashboard after unlock');
  await sleep(800);
};

test('a fresh console opens Settings with only the current page\'s group open, the rest shut with counts; a chosen group is remembered across a reload',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
  assert.equal(await c.evalIn(`Object.keys(localStorage).filter(k => k.includes('setgroups')).length`), 0, 're-anchor: a groups preference is already stored, so this is not a fresh console');
  await openSection('Settings');
  const fresh = JSON.parse(await c.evalIn(GROUP_HEADERS));
  console.log('    settings groups, fresh: ' + JSON.stringify(fresh));
  assert.deepEqual(fresh.map(h => h.g), ['Church', 'People', 'Infrastructure', 'Security'], 're-anchor: the four groups');
  assert.deepEqual(fresh.map(h => h.open), [true, false, false, false], 'THE DEFECT: a fresh console does not open Settings with only Church (the group of the open page) open');
  assert.deepEqual(fresh.slice(1).map(h => h.count), ['4', '5', '4'], 'the shut groups do not show their counts');
  // open Security by hand, then one of its pages: Security open, Church (holding nothing, never chosen) shut
  await c.evalIn(`[...document.querySelectorAll('button.set-grp')].find(b => (b.querySelector('.set-grp-n')||{}).textContent === 'Security').click()`);
  await sleep(300);
  await c.evalIn(`[...document.querySelectorAll('button.set-item')].find(b => (b.querySelector('.set-item-n')||{}).textContent === 'Church key').click()`);
  await sleep(500);
  const moved = JSON.parse(await c.evalIn(GROUP_HEADERS));
  assert.deepEqual(moved.map(h => h.open), [false, false, false, true], 'with a Security page open, Security is not the one open group: ' + JSON.stringify(moved));
  // reload: the remembered Security stays open beside the forced-open Church (Settings reopens on its first page)
  await unlock();
  await openSection('Settings');
  const after = JSON.parse(await c.evalIn(GROUP_HEADERS));
  assert.deepEqual(after.map(h => h.open), [true, false, false, true], 'after a reload the remembered choice did not win: ' + JSON.stringify(after));
});
