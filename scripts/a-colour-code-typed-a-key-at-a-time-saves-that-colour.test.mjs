// A COLOUR CODE TYPED ONE KEY AT A TIME SAVES THAT COLOUR (audit AUDIT-ui-polish-a7a6bfcf-2026-11-13, MEDIUM).
//   Run: node --test scripts/a-colour-code-typed-a-key-at-a-time-saves-that-colour.test.mjs
//
// Settings → Church identity has two hex boxes, Main colour and Accent colour. Both used to treat the first
// three characters of a code as a #RGB short code: typing 1F4E79 a key at a time turned the box into 11FF44
// after the third key (the expanded colour was written back into the box), the box (maxLength 6) was then
// full, and #11ff44 was published to every member. Pasting the whole code worked, and so did every test,
// because every test set all six characters in one go.
//
// POINT OF USE (CLAUDE.md rule 1): the REAL console (steward.html + vendor/steward.js + app/*.jsx) is opened
// in headless Chromium, a church is started through the real "Start a new church" path, the steward goes to
// Settings → Church identity by clicking, and each box is typed into with real key input (CDP
// Input.insertText, one character per call — the browser applies maxLength itself). What reached
// window.Steward.publishProfile is recorded by wrapping it (it still calls through), and what the box shows
// is read off the DOM. Rule 3: nothing matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const settles = async (probe, ok, budget = 60000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await probe();
    if (ok(v) || Date.now() - t0 > budget) return v;
    await sleep(250);
  }
};
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel', '.css': 'text/css',
                '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

test('Church identity: typing a colour code a key at a time saves exactly that code, in both boxes', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  const port = await H.freePort('the colour-typing console origin');
  const cdp = await H.freePort('the colour-typing test\'s Chrome debug port');
  const srv = createServer((req, res) => {
    const p = normalize(join(ROOT, decodeURIComponent(String(req.url).split('?')[0])));
    if (!p.startsWith(ROOT) || !existsSync(p) || !extname(p)) { res.writeHead(404); res.end('not here'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  await new Promise(r => srv.listen(port, '127.0.0.1', r));
  const prof = mkdtempSync(join(tmpdir(), 'trin-colourType-'));
  // Never let a test reach production (scripts/no-browser-reaches-production.test.mjs).
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `http://127.0.0.1:${port}/steward.html`], { stdio: 'ignore' });
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
      return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
    };
    const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
    const type = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
      if(!i) return 'miss';
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;

    // ── a church, through the real path (the console refuses a plaintext seed fixture) ──
    await settles(() => evalIn(`!![...document.querySelectorAll('button')].find(x=>/Start a new church/i.test((x.textContent||'').trim()))`), v => v === true);
    assert.equal(await evalIn(click('/Start a new church/i')), 'ok', 'the console never offered "Start a new church"');
    await settles(() => evalIn(`!![...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes('At least 8'))`), v => v === true);
    assert.equal(await evalIn(type('At least 8', 'cedar-harbour-lamp-42')), 'ok', 'the PIN box was not on screen');
    assert.equal(await evalIn(type('Type it again', 'cedar-harbour-lamp-42')), 'ok', 'the confirm-PIN box was not on screen');
    // …and mark first-run setup as done in the SAME evaluation as the click, before the dashboard mounts: the
    // setup wizard otherwise opens 1.8s later with an autofocused "Church name" box that takes the keyboard
    // mid-code. (This is the state a restored / adopted church starts in; app/steward-root.jsx sets the same key.)
    assert.equal(await evalIn(`(() => { const r = ${click('/Set PIN/i')}; localStorage.setItem('trinityone.steward.wizard.done', '1'); return r; })()`), 'ok', 'the console never offered "Set PIN"');
    const nodes = await settles(() => evalIn(`document.querySelectorAll('#root *').length`), v => v > 120);
    assert.ok(nodes > 120, `#root has ${nodes} nodes — the console did not reach its dashboard`);

    // ── Settings → Church identity, by clicking ──
    const reached = await settles(async () => {
      await evalIn(`(() => { const b=[...document.querySelectorAll('button,[role="tab"],a')].find(x=>(x.textContent||'').trim()==='Settings'); if (b) b.click(); })()`);
      await sleep(300);
      await evalIn(`(() => { const b=[...document.querySelectorAll('button,[role="button"],a,li,div')].reverse().find(x=>/^Church identity/.test((x.textContent||'').trim()) && x.onclick !== undefined && (x.tagName==='BUTTON'||x.getAttribute('role')==='button')); if (b) b.click(); })()`);
      await sleep(300);
      // Main is opt-in (owner 2026-11-13): switch "Use a separate main colour" ON to reveal its hex box
      await evalIn(`(() => { const s = document.querySelector('button[role="switch"][aria-label="Use a separate main colour"]'); if (s && s.getAttribute('aria-checked') === 'false') s.click(); })()`);
      await sleep(300);
      return evalIn(`!!document.querySelector('input[aria-label="Main colour hex code"]') && !!document.querySelector('input[aria-label="Accent colour hex code"]')`);
    }, v => v === true);
    assert.equal(reached, true, 'Settings → Church identity never showed both colour hex boxes');
    await sleep(2500);   // past the wizard's 1.8s timer: prove nothing will take the keyboard while typing
    assert.equal(await evalIn(`!!document.querySelector('input[aria-label="Church name"]')`), false,
      'the first-run wizard opened over the settings page — keys typed below would go to it');

    // ── record every publishProfile the screen makes (still calls the real one) ──
    const armed = await evalIn(`(() => { const S = window.Steward; const real = S.publishProfile; window.__pp = [];
      S.publishProfile = function (m) { window.__pp.push(JSON.parse(JSON.stringify(m))); return real.apply(this, arguments); };
      return window.Steward.publishProfile !== real ? 'armed' : 'frozen'; })()`);
    assert.equal(armed, 'armed', 'could not record publishProfile — every assertion below would read nothing');
    const published = async () => JSON.parse(await evalIn(`JSON.stringify(window.__pp)`));
    const clearLog = () => evalIn(`(window.__pp.length = 0, 'ok')`);
    const box = (label) => `document.querySelector('input[aria-label=${JSON.stringify(label)}]')`;
    const shown = (label) => evalIn(`${box(label)}.value`);
    const focus = (label) => evalIn(`(${box(label)}.focus(), document.activeElement === ${box(label)})`);
    const blur = (label) => evalIn(`(${box(label)}.blur(), 'ok')`);
    const key = async (ch) => { await send('Input.insertText', { text: ch }); await sleep(120); };
    const backspaceAll = async () => {
      for (let i = 0; i < 8; i++) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await sleep(80);
      }
    };

    for (const { label, field, want, picker } of [
      { label: 'Main colour hex code', field: 'mainColor', want: '#1f4e79', picker: 'Main colour picker' },
      { label: 'Accent colour hex code', field: 'accent', want: '#1F4E79', picker: 'Accent colour picker' },
    ]) {
      await clearLog();

      // 1. ONE KEY AT A TIME. After every key the box shows exactly what was typed so far.
      assert.equal(await focus(label), true, `could not focus the ${label} box`);
      await backspaceAll();
      let typed = '';
      for (const ch of '1F4E79') {
        await key(ch); typed += ch;
        assert.equal(await shown(label), typed, `${label}: after typing "${typed}" the box shows "${await shown(label)}"`);
      }
      await sleep(700);   // past the 400ms save debounce
      const after = await published();
      assert.deepEqual(after.filter(m => field in m), [{ [field]: want }],
        `${label}: typing 1F4E79 a key at a time published ${JSON.stringify(after)} — want exactly one { ${field}: "${want}" } and nothing wrong along the way`);
      await blur(label);
      assert.equal(await shown(label), '1F4E79', `${label}: a complete saved code did not stay in the box after leaving it`);

      // 2. A SHORT / UNFINISHED ENTRY IS NOT SAVED, and leaving the box puts the saved colour back.
      await clearLog();
      await focus(label); await backspaceAll();
      for (const ch of 'ABC') await key(ch);
      assert.equal(await shown(label), 'ABC', `${label}: a 3-character entry was rewritten to "${await shown(label)}"`);
      await sleep(700);
      assert.deepEqual(await published(), [], `${label}: a 3-character entry was published: ${JSON.stringify(await published())}`);
      await blur(label);
      assert.equal(await shown(label), '1F4E79', `${label}: leaving an unfinished code in the box did not put the saved colour back`);

      // 3. CLEARING THE BOX publishes nothing (Reset is the control that unsets; it is driven below) and the
      //    saved colour comes back on leaving.
      await clearLog();
      await focus(label); await backspaceAll();
      assert.equal(await shown(label), '', `${label}: the box did not clear`);
      await sleep(700);
      assert.deepEqual(await published(), [], `${label}: clearing the box published ${JSON.stringify(await published())}`);
      await blur(label);
      assert.equal(await shown(label), '1F4E79', `${label}: leaving a cleared box did not put the saved colour back`);

      // 4. THE PICKER STILL SETS IT, and the box follows.
      await clearLog();
      const picked = await evalIn(`(() => { const i = ${box(picker)}; if (!i) return 'miss';
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, '#5e8c6a'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
      assert.equal(picked, 'ok', `there is no ${picker}`);
      await sleep(700);
      assert.deepEqual((await published()).filter(m => field in m), [{ [field]: '#5e8c6a' }], `${label}: the picker did not publish its colour: ${JSON.stringify(await published())}`);
      assert.equal(await shown(label), '5E8C6A', `${label}: the box did not follow the picker`);

      // 5. RESET unsets it, as before.
      await clearLog();
      const reset = await evalIn(`(() => { const b = document.querySelector('button[aria-label=${JSON.stringify(field === 'mainColor' ? 'Reset main colour' : 'Reset accent colour')}]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
      assert.equal(reset, 'ok', `${label}: no Reset button for a set colour`);
      await sleep(300);
      assert.deepEqual((await published()).filter(m => field in m), [{ [field]: '' }], `${label}: Reset did not publish an empty colour`);
      assert.equal(await shown(label), '', `${label}: Reset did not empty the box`);
    }
  } finally {
    try { ws && ws.close(); } catch {}
    try { chr.kill('SIGKILL'); } catch {}
    try { srv.close(); } catch {}
    try { rmSync(prof, { recursive: true, force: true }); } catch {}
  }
});
