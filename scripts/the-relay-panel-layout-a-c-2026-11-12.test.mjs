// RELAY PANEL LAYOUT, OWNER'S PICK 2026-11-12: "Dashboard A" + "Settings C" from TrinityOne-internal
// reference/MOCKUPS-relay-panel-ui-2026-11-12.html (feat/relay-panel-layout-a-c-2026-11-12).
// Run: node --test scripts/the-relay-panel-layout-a-c-2026-11-12.test.mjs
//
// Every assertion is read off the rendered DOM of relay-app/control.html in headless Chromium, against a real
// gateway with an empty data dir and three registered throwaway churches. Geometry, not markup text (CLAUDE.md
// rule 3): a layout claim is only true if the boxes are where it says. Skips without chromium.
//
//   A1  Dashboard: three headline numbers (Churches, Connected now, Sent today) on one row at the top; the other
//       four (Members, Events, Media, Traffic) as one smaller line under them, above the cards.
//   A2  Dashboard: cards on a fixed grid, so the cards sharing a row share a top AND a bottom.
//   C1  Settings: ONE Updates card holds both the relay-software half and the installer half, and is on screen.
//   C2  Settings: placed, not auto-flowed — Internet full width on top, Churches beside the Name/Serves stack,
//       Updates beside Backup (wide screens).
//   C3  Settings: Restore is folded shut (its warning still inside); the update source fold opens by itself on a
//       box with no source, because both Updates halves then point at it.
//   *   No horizontal scroll on either tab at 390 / 768 / 1280.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { freePort } from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;
let gw = null;
async function startGateway() {
  const port = await freePort('the relay-panel layout gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-panel-layout-'));
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
  const token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  for (let i = 0; i < 3; i++) {   // three churches: long npub rows, and a Churches card with real height
    const npub = npubEncode(getPublicKey(generateSecretKey()));
    const r = await fetch(base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ addChurch: { npub, name: '' } }) });
    assert.equal(r.status, 200, 'registering a church failed');
  }
  return { base, stop() { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
}

async function startChrome(width) {
  const cdp = await freePort('the relay-panel layout Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-panel-layout-chrome-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars', BLOCK_PROD,
    `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
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
  // mobile:true lets a too-wide page widen the layout viewport — which is how a phone overflow shows up
  await send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
  const evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr && rr.result && rr.result.exceptionDetails) throw new Error('the page threw: ' + JSON.stringify(rr.result.exceptionDetails).slice(0, 300));
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
  };
  const open = async (tab) => {
    await send('Page.navigate', { url: gw.base + '/relay-app/control.html' }); await sleep(600);
    await evalIn(`localStorage.setItem('to_relay_setup_seen','1'); sessionStorage.setItem('to_relay_setup_skipped','1'); localStorage.setItem('trinityone.relay.tab','${tab}')`);
    await send('Page.navigate', { url: gw.base + '/relay-app/control.html' });
  };
  return { evalIn, open, stop() { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
}
const waitFor = async (c, expr, want, ms = 15000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await c.evalIn(expr); if (want(v)) return v; await sleep(300); } return v; };

// a box's rectangle, rounded, with whether it is actually on screen
const RECT = `(sel) => { const e = typeof sel === 'string' ? (document.getElementById(sel) || document.querySelector(sel)) : sel; if (!e) return null;
  const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top + scrollY), b: Math.round(r.bottom + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; }`;
const rects = (c, ids) => c.evalIn(`(() => { const R = ${RECT}; return JSON.stringify(Object.fromEntries(${JSON.stringify(ids)}.map(i => [i, R(i)]))); })()`).then(JSON.parse);
// the "How members reach you" card has no id of its own; it is the card holding #wss
const REACH = `document.getElementById('wss').closest('.card')`;

before(async () => { if (CHROME) gw = await startGateway(); });
after(() => { if (gw) gw.stop(); });
const skip = !CHROME ? 'no chromium' : false;

for (const width of [1280, 390]) {
  test(`A1 @${width}: three headline numbers on one row at the top, the other four as one smaller line under them`, { skip, timeout: 90000 }, async () => {
    const c = await startChrome(width);
    try {
      await c.open('dash');
      await waitFor(c, `document.getElementById('s-churches').textContent`, v => v === '3');
      const R = await rects(c, ['s-churches', 's-conns', 's-today', 's-members', 's-events', 's-media', 's-traffic', 'actCard']);
      const head = ['s-churches', 's-conns', 's-today'], rest = ['s-members', 's-events', 's-media', 's-traffic'];
      for (const k of [...head, ...rest]) assert.ok(R[k] && R[k].w > 0, `#${k} is not on the Dashboard`);
      assert.ok(head.every(k => R[k].t === R['s-churches'].t),
        `the three headline numbers are not on one row: ${head.map(k => k + '@' + R[k].t).join(' ')}`);
      const headBottom = Math.max(...head.map(k => R[k].b));
      for (const k of rest) {
        assert.ok(R[k].t >= headBottom, `#${k} is not below the headline row (top ${R[k].t}, headline ends ${headBottom})`);
        assert.ok(R[k].b <= R.actCard.t, `#${k} is not above the cards (it ends ${R[k].b}, Activity starts ${R.actCard.t})`);
      }
      if (width >= 700) assert.ok(rest.every(k => R[k].t === R['s-members'].t), 'the four secondary numbers are not one line on a wide screen: ' + rest.map(k => k + '@' + R[k].t).join(' '));
      const fs = JSON.parse(await c.evalIn(`JSON.stringify(['s-churches','s-members','s-traffic'].map(i => parseFloat(getComputedStyle(document.getElementById(i)).fontSize)))`));
      assert.ok(fs[1] < fs[0] && fs[2] < fs[0], `the secondary numbers are not smaller than the headline ones (px: ${fs.join(', ')})`);
      // the tooltips the tiles carried are still there (the small-bugs fix put "relay last started" on traffic)
      assert.match(await c.evalIn(`document.getElementById('s-traffic').closest('.stat').title`), /relay last started/i);
    } finally { c.stop(); }
  });
}

test('A2: Dashboard cards sit on a fixed grid — the cards in a row share a top and a bottom (1280 and 768)', { skip, timeout: 120000 }, async () => {
  for (const width of [1280, 768]) {
    const c = await startChrome(width);
    try {
      await c.open('dash');
      await waitFor(c, `getComputedStyle(document.getElementById('actCard')).display`, v => v === 'block');
      const R = JSON.parse(await c.evalIn(`(() => { const R = ${RECT}; return JSON.stringify({ act: R('actCard'), reach: R(${REACH}), kind: R('kindCard'), top: R('topCard'), health: R('healthCard') }); })()`));
      const rows = width >= 1100 ? [['act', 'reach'], ['kind', 'top', 'health']] : [['reach', 'kind'], ['top', 'health']];
      for (const row of rows) {
        const tops = row.map(k => R[k].t), bots = row.map(k => R[k].b);
        assert.ok(tops.every(t => t === tops[0]), `@${width}: ${row.join(' + ')} do not start on the same row (tops ${tops.join(', ')})`);
        assert.ok(bots.every(b => b === bots[0]), `@${width}: ${row.join(' + ')} do not end level (bottoms ${bots.join(', ')})`);
      }
      if (width >= 1100) assert.ok(R.act.w > 1.8 * R.reach.w, `@1280 Activity is not the wide card beside How members reach you (${R.act.w} vs ${R.reach.w})`);
      else assert.ok(R.act.t < R.reach.t && R.act.w > 1.8 * R.reach.w, '@768 Activity does not run across both columns above the rest');
    } finally { c.stop(); }
  }
});

test('C1: Settings has ONE Updates card, holding both the relay-software half and the installer half, on screen', { skip, timeout: 90000 }, async () => {
  const c = await startChrome(1280);
  try {
    await c.open('set');
    // both halves are shown by their own loaders once the panel has the admin token (from /local-token here)
    await waitFor(c, `getComputedStyle(document.getElementById('installerCard')).display !== 'none' && getComputedStyle(document.getElementById('updateCard')).display !== 'none'`, v => v === true);
    const v = JSON.parse(await c.evalIn(`(() => { const u = document.getElementById('updateCard'), i = document.getElementById('installerCard');
      const cu = u.closest('.card'), ci = i.closest('.card'); const r = cu.getBoundingClientRect();
      return JSON.stringify({ same: !!cu && cu === ci, id: cu && cu.id, shown: r.width > 0 && r.height > 0,
        upd: u.getBoundingClientRect().height > 0, inst: i.getBoundingClientRect().height > 0,
        cards: [...document.querySelectorAll('#panel-set .card')].filter(e => e.getBoundingClientRect().height > 0 && (e.contains(u) || e.contains(i))).length }); })()`));
    assert.equal(v.same, true, 'the relay-software and installer halves are in two different cards');
    assert.equal(v.id, 'updatesCard');
    assert.equal(v.cards, 1, 'more than one visible card carries the update controls');
    assert.equal(v.shown && v.upd && v.inst, true, 'the Updates card (or one of its halves) is not on screen: ' + JSON.stringify(v));
    // the outer card follows its halves: with both halves hidden (what a 401 does to each) it goes too, and comes back
    await c.evalIn(`document.getElementById('updateCard').style.display = 'none'; document.getElementById('installerCard').style.display = 'none'`);
    assert.equal(await waitFor(c, `getComputedStyle(document.getElementById('updatesCard')).display`, x => x === 'none', 3000), 'none',
      'with both halves hidden the Updates card stays up as an empty shell');
    await c.evalIn(`document.getElementById('installerCard').style.display = 'block'`);
    assert.equal(await waitFor(c, `getComputedStyle(document.getElementById('updatesCard')).display`, x => x === 'block', 3000), 'block',
      'one half shown again but the Updates card stayed hidden');
  } finally { c.stop(); }
});

test('C2: Settings cards are placed — Internet across the top, Churches beside the stack, Updates beside Backup (1280)', { skip, timeout: 90000 }, async () => {
  const c = await startChrome(1280);
  try {
    await c.open('set');
    await waitFor(c, `getComputedStyle(document.getElementById('updatesCard')).display !== 'none' && getComputedStyle(document.getElementById('backupCard')).display !== 'none' && document.querySelectorAll('#cfgList .cr-key').length >= 3`, v => v === true);
    const R = JSON.parse(await c.evalIn(`(() => { const R = ${RECT}; return JSON.stringify({ deck: R('.deck3'), pub: R('goPublic'), ch: R(document.getElementById('cfgCount').closest('.card')),
      name: R('relayNameCard'), serves: R('servesCard'), upd: R('updatesCard'), bak: R('backupCard') }); })()`));
    assert.ok(R.pub.w >= R.deck.w - 2, `Reach members from anywhere does not run the full width (${R.pub.w} of ${R.deck.w})`);
    assert.ok(R.ch.t > R.pub.b - 1 && R.name.t === R.ch.t && R.name.l > R.ch.r, 'Churches and the relay-name card are not side by side under the Internet card');
    assert.ok(R.serves.t > R.name.b - 1 && R.serves.l === R.name.l, 'What this relay serves is not stacked under the relay name');
    assert.equal(R.upd.t, R.bak.t, 'Updates and Backup do not start on the same row');
    assert.equal(R.upd.b, R.bak.b, 'Updates and Backup do not end level');
    assert.ok(R.bak.l > R.upd.r, 'Backup is not beside Updates');
    assert.ok(R.upd.t >= Math.max(R.ch.b, R.serves.b), 'Updates is not below the Churches row');
  } finally { c.stop(); }
});

test('C3: Restore is folded shut with its warning inside; the update source opens by itself on a box with none', { skip, timeout: 90000 }, async () => {
  const c = await startChrome(1280);
  try {
    await c.open('set');
    await waitFor(c, `getComputedStyle(document.getElementById('backupCard')).display !== 'none'`, v => v === true);
    const r = JSON.parse(await c.evalIn(`(() => { const b = document.getElementById('doRestore'), f = b.closest('details');
      return JSON.stringify({ fold: !!f, open: f && f.open, visible: b.checkVisibility(), warn: f ? f.querySelector('.dz-body').textContent : '' }); })()`));
    assert.equal(r.fold, true, 'the Restore button is not in a fold');
    assert.equal(r.open, false, 'Restore is open by default');
    assert.equal(r.visible, false, 'the Restore button is on screen while its fold is shut');
    assert.match(r.warn, /replaces everything/i, 'the restore warning was cut');
    assert.match(r.warn, /cannot be undone/i, 'the restore warning lost "cannot be undone"');
    await c.evalIn(`document.getElementById('restoreFold').querySelector('summary').click()`);
    assert.equal(await c.evalIn(`document.getElementById('doRestore').checkVisibility()`), true, 'opening the fold does not reveal Restore');
    // checkVisibility(), not a bounding box: Chromium lays out a shut <details>' content (content-visibility:hidden)
    // the fixture box was never given an update source; both Updates halves then say "set one below"
    const o = await waitFor(c, `(() => { const i = document.getElementById('originIn'); return JSON.stringify({ open: i.closest('details').open, shown: i.checkVisibility(), val: i.value }); })()`, v => JSON.parse(v).open, 15000);
    const ov = JSON.parse(o);
    assert.equal(ov.val, '', 're-anchor: the fixture box has an update source');
    assert.equal(ov.open && ov.shown, true, 'a box with no update source keeps the source field folded away while the card says to set it');
  } finally { c.stop(); }
});

test('no horizontal scroll on Dashboard or Settings at 390, 768 and 1280', { skip, timeout: 180000 }, async () => {
  for (const width of [390, 768, 1280]) {
    const c = await startChrome(width);
    try {
      for (const tab of ['dash', 'set']) {
        await c.open(tab);
        await waitFor(c, `document.querySelectorAll('#cfgList .cr-key').length`, v => v >= 3);
        await sleep(800);
        const m = JSON.parse(await c.evalIn(`JSON.stringify({ sw: document.documentElement.scrollWidth, iw: innerWidth })`));
        assert.equal(m.iw, width, `${tab} @${width}: the page was widened and shrunk to fit (layout viewport ${m.iw})`);
        assert.ok(m.sw <= width, `${tab} @${width}: the page is ${m.sw}px wide — it scrolls sideways`);
      }
    } finally { c.stop(); }
  }
});
