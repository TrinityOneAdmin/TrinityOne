// THE MAIN COLOUR AND THE ACCENT COLOUR ARE INDEPENDENT (owner device test of 69dd2d98, 2026-11-13).
//   Run: node --test scripts/the-main-and-accent-colours-are-independent.test.mjs
//
// Owner: "when changing the accent color first, it also changes the main color to match … resetting one changes
// both … the picker on main color … also changes both of the colors."
//
// Cause (reproduced in this harness before the fix): the SAVED values were already independent — every control
// publishes only its own field. But with no main colour saved, the Main colour control (its tile, its picker's
// value and its hex placeholder) DISPLAYED the accent (`mainShown = mainCol || acc`). So picking an accent
// visibly changed Main, resetting Main showed the accent again, and resetting the accent visibly reset Main. The
// Main picker also opened on the accent, so a picker that confirms its starting value would save the accent INTO
// mainColor. The fix gives the Main control its own fixed default; only the members'-header preview still falls
// back to the accent, because that is what members' phones paint when no main colour is set.
//
// POINT OF USE (CLAUDE.md rule 1): the REAL console (steward.html, vendor/steward.js, app/*.jsx) is served by a
// REAL relay (scripts/gateway.mjs) and opened in headless Chromium. A church is made through the real wizard, the
// steward clicks to Settings -> Church identity, and drives each control: the colour picker (value set + input
// event, as a picker delivers it), the hex box (real key input, one character per CDP Input.insertText) and Reset.
// After each, what was PUBLISHED is read from the relay's own database (the church's latest kind-0), and what the
// OTHER colour's control shows is read off the DOM. Two churches' worth of state: one with neither colour set, and
// one with BOTH set and loaded back from the relay after a reload. Rule 3: nothing matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const DEFAULT = '#c25a38';   // the stock colour each control shows when its own colour is unset

test('Church identity: picking, typing or resetting one church colour never changes the other — saved, published or shown', { skip: !CHROME ? 'no chromium' : false, timeout: 420000 }, async () => {
  const relay = await H.startRelay({ name: 'colour-indep', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the colour-independence test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-colourIndep-'));
  // Never let a test reach production (scripts/no-browser-reaches-production.test.mjs).
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
  let ws = null;
  try {
    let targets = null;
    for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const page = targets.find(t => t.type === 'page') || targets[0];
    ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    const evalIn = async (expression) => {
      const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
      return rr?.result?.result?.value;
    };
    const waitFor = async (expr, label, ms = 90000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return; } catch {} await sleep(400); }
      throw new Error('timed out waiting for ' + label);
    };
    const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
    const setVal = (sel, val) => `(() => { const i=document.querySelector(${JSON.stringify(sel)}); if(!i) return 'miss';
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(val)});
      i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()`;
    const byPh = (ph) => `input[placeholder*=${JSON.stringify(ph)}]`;
    const press = async (re) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${re}`); await sleep(500); };

    // ── a church, by the real wizard, on the real relay ──
    await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 'Start a new church');
    await press('/Start a new church/i');
    await waitFor(`!!document.querySelector(${JSON.stringify(byPh('At least 8'))})`, 'the PIN box');
    assert.equal(await evalIn(setVal(byPh('At least 8'), PIN)), 'ok');
    assert.equal(await evalIn(setVal(byPh('Type it again'), PIN)), 'ok');
    await press('/Set PIN/i');
    await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 'the wizard name step');
    assert.equal(await evalIn(setVal('input[aria-label="Church name"]', 'St Columba Two Colours')), 'ok');
    await sleep(300);
    await press('/^Continue$/');
    const churchPub = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
    assert.match(churchPub, /^[0-9a-f]{64}$/, 'the wizard did not give the console a church key');

    const kind0 = () => {
      const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
      try {
        const rows = db.prepare('SELECT raw FROM events WHERE kind = 0').all().map(r => JSON.parse(String(r.raw)))
          .filter(e => e.pubkey === churchPub).sort((a, b) => b.created_at - a.created_at);
        if (!rows[0]) return null;
        const c = JSON.parse(rows[0].content);
        return { accent: String(c.accent || '').toLowerCase(), mainColor: String(c.mainColor || '').toLowerCase(), name: c.name };
      } finally { db.close(); }
    };
    // wait for the church's kind-0 on the relay to satisfy `ok`
    const published = async (ok, label) => {
      const t0 = Date.now(); let k = kind0();
      while (!(k && ok(k)) && Date.now() - t0 < 20000) { await sleep(300); k = kind0(); }
      assert.ok(k && ok(k), `${label}: the relay's kind-0 never got there — it holds ${JSON.stringify(k)}`);
      return k;
    };

    // past the wizard: unlock straight into the dashboard
    const unlock = async () => {
      await waitFor(`!!document.querySelector(${JSON.stringify(byPh('Your PIN or passphrase'))})`, 'the unlock screen');
      assert.equal(await evalIn(setVal(byPh('Your PIN or passphrase'), PIN)), 'ok');
      await press('/^Unlock/');
      await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 'the dashboard');
    };
    const reload = async () => { await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); location.reload(); return 'ok'; })()`); await sleep(3000); await unlock(); };
    await published(k => k.name === 'St Columba Two Colours', 'the wizard\'s name');
    await reload();

    // ── Settings → Church identity, by clicking ──
    const toIdentity = async () => {
      for (let i = 0; i < 60; i++) {
        await evalIn(`(() => { const b=[...document.querySelectorAll('button,[role="tab"],a')].find(x=>(x.textContent||'').trim()==='Settings'); if (b) b.click(); })()`);
        await sleep(300);
        await evalIn(`(() => { const b=[...document.querySelectorAll('button,[role="button"]')].reverse().find(x=>/^Church identity/.test((x.textContent||'').trim())); if (b) b.click(); })()`);
        await sleep(300);
        if (await evalIn(`!!document.querySelector('input[aria-label="Main colour hex code"]') && !!document.querySelector('input[aria-label="Accent colour hex code"]')`)) return;
      }
      assert.fail('Settings → Church identity never showed both colour controls');
    };
    await toIdentity();
    await sleep(2500);   // past the wizard's 1.8s timer: nothing must take the keyboard while typing
    assert.equal(await evalIn(`!!document.querySelector('input[aria-label="Church name"]')`), false, 'the first-run wizard opened over the settings page');

    // every publishProfile the screen makes (still calls the real one)
    const arm = async () => assert.equal(await evalIn(`(() => { const S = window.Steward; const real = S.publishProfile; window.__pp = [];
      S.publishProfile = function (m) { window.__pp.push(JSON.parse(JSON.stringify(m))); return real.apply(this, arguments); };
      return S.publishProfile !== real ? 'armed' : 'frozen'; })()`), 'armed', 'could not record publishProfile');
    const calls = async () => JSON.parse(await evalIn(`JSON.stringify(window.__pp)`));
    await arm();

    const NAME = { accent: 'Accent', mainColor: 'Main' };
    // what a colour's CONTROL shows: its hex box, its picker's value, and its tile's fill (the picker's label)
    const shown = async (field) => JSON.parse(await evalIn(`(() => { const p = document.querySelector('input[aria-label="${NAME[field]} colour picker"]');
      const h = document.querySelector('input[aria-label="${NAME[field]} colour hex code"]');
      return JSON.stringify({ hex: h.value.toLowerCase(), picker: p.value.toLowerCase(), tile: getComputedStyle(p.parentElement).backgroundColor }); })()`));
    const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
    const looksLike = (saved) => ({ hex: saved ? saved.slice(1) : '', picker: saved || DEFAULT, tile: rgb(saved || DEFAULT) });

    const pick = async (field, hex) => assert.equal(await evalIn(setVal(`input[aria-label="${NAME[field]} colour picker"]`, hex)), 'ok', `no ${NAME[field]} picker`);
    const type = async (field, code) => {
      const sel = `input[aria-label="${NAME[field]} colour hex code"]`;
      assert.equal(await evalIn(`(document.querySelector(${JSON.stringify(sel)}).focus(), document.activeElement === document.querySelector(${JSON.stringify(sel)}))`), true, `could not focus the ${NAME[field]} hex box`);
      for (let i = 0; i < 8; i++) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await sleep(60);
      }
      for (const ch of code) { await send('Input.insertText', { text: ch }); await sleep(100); }
      await evalIn(`(document.querySelector(${JSON.stringify(sel)}).blur(), 'ok')`);
    };
    const reset = async (field) => assert.equal(await evalIn(`(() => { const b = document.querySelector('button[aria-label="Reset ${NAME[field].toLowerCase()} colour"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', `no Reset for ${NAME[field]}`);

    // Drive one control on `field` and prove the OTHER colour did not move: on the relay, in what the screen
    // sent, and in what the other control shows.
    const other = (f) => f === 'accent' ? 'mainColor' : 'accent';
    const drive = async (row, field, how, want) => {
      const o = other(field);
      const before = kind0();
      const otherShownBefore = await shown(o);
      await evalIn(`(window.__pp.length = 0, 'ok')`);
      if (how === 'picker') await pick(field, want);
      else if (how === 'typed') await type(field, want.slice(1).toUpperCase());
      else await reset(field);
      const k = await published(x => x[field] === want, `${row}: ${NAME[field]} ${how} -> ${want || '(unset)'}`);
      await sleep(900);   // past every 400ms debounce: catch a late second write
      const after = kind0();
      assert.equal(after[o], before[o], `${row}: ${NAME[field]} ${how} changed the PUBLISHED ${NAME[o]} colour from "${before[o]}" to "${after[o]}"`);
      assert.equal(after[field], want, `${row}: ${NAME[field]} ${how} did not stay "${want}" on the relay (now "${after[field]}")`);
      const sent = await calls();
      assert.ok(sent.length > 0 && sent.every(m => !(o in m)), `${row}: ${NAME[field]} ${how} sent ${JSON.stringify(sent)} — it must never carry ${o}`);
      assert.deepEqual(await shown(o), otherShownBefore, `${row}: ${NAME[field]} ${how} changed what the ${NAME[o]} colour control SHOWS`);
      assert.deepEqual(await shown(o), looksLike(after[o]), `${row}: the ${NAME[o]} control does not show its own saved colour "${after[o] || '(unset)'}"`);
      assert.deepEqual(await shown(field), looksLike(want), `${row}: the ${NAME[field]} control does not show what was just saved`);
      return k;
    };

    // ── ROW 1: a church with NEITHER colour set ──
    const k0 = kind0();
    assert.deepEqual([k0.accent, k0.mainColor], ['', ''], `CONTROL: the new church already has colours ${JSON.stringify(k0)}`);
    await drive('neither set', 'accent', 'picker', '#3b6fb0');
    await drive('neither set', 'accent', 'typed', '#1f4e79');
    await drive('neither set', 'accent', 'reset', '');
    await drive('neither set', 'mainColor', 'picker', '#7a4fa3');
    await drive('neither set', 'mainColor', 'typed', '#5e8c6a');
    await drive('neither set', 'mainColor', 'reset', '');
    // the owner's exact sequence: accent first, then main, then reset each
    await drive('owner sequence', 'accent', 'picker', '#b0853b');
    await drive('owner sequence', 'mainColor', 'picker', '#1f2a37');
    await drive('owner sequence', 'mainColor', 'reset', '');
    await drive('owner sequence', 'accent', 'reset', '');

    // ── ROW 2: a church with BOTH colours set, loaded back from the relay ──
    await drive('setup', 'accent', 'picker', '#3b6fb0');
    await drive('setup', 'mainColor', 'picker', '#7a4fa3');
    await reload();
    await toIdentity();
    await waitFor(`document.querySelector('input[aria-label="Main colour hex code"]').value.toLowerCase() === '7a4fa3' && document.querySelector('input[aria-label="Accent colour hex code"]').value.toLowerCase() === '3b6fb0'`, 'both saved colours loaded back into the controls');
    await sleep(1500);
    await arm();
    await drive('both set', 'accent', 'picker', '#b0853b');
    await drive('both set', 'accent', 'typed', '#1f4e79');
    await drive('both set', 'accent', 'reset', '');
    await drive('both set', 'accent', 'picker', '#3b6fb0');
    await drive('both set', 'mainColor', 'picker', '#5e8c6a');
    await drive('both set', 'mainColor', 'typed', '#1f2a37');
    await drive('both set', 'mainColor', 'reset', '');
    const end = kind0();
    assert.deepEqual([end.accent, end.mainColor], ['#3b6fb0', ''], `the relay ended on ${JSON.stringify(end)}`);
  } finally {
    try { ws && ws.close(); } catch {}
    try { chr.kill('SIGKILL'); } catch {}
    try { relay.stop(); } catch {}
    try { rmSync(prof, { recursive: true, force: true }); } catch {}
  }
});
