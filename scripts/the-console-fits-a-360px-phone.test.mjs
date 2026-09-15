// THE STEWARD CONSOLE, MEASURED AT THE SIZE OF THE PHONE IT IS RUN ON.
//   Run: node --test scripts/the-console-fits-a-360px-phone.test.mjs
//
// The owner, on the built steward APK, 2026-09-15: *"a UI focused audit… as much of this could be compressed
// and laid out better, so as to fit without awkward scrolling"*. A screenshot audit of versionCode 214 on the
// Oppo CPH2477 (360 x 730 CSS px, dpr 2) is written up in TrinityOne-internal/UI-AUDIT-console-2026-09-15.md.
//
// ── WHY THIS BOOTS A BROWSER RATHER THAN RENDERING A COMPONENT ───────────────────────────────────────────
// Every other layout test in this repo asserts on the STYLE OBJECT a component evaluated. That is the right
// instrument for "is this backdrop `fixed`" and the wrong one for every question here, because none of these
// defects is visible in a style object:
//
//   · the Overview cards were cut off by GRID TRACK SIZING — `1fr` is `minmax(auto, 1fr)`, and CSS resolved
//     the two tracks to 205.09px and 146.64px inside a 336px box. Nothing in the JSX says 205.
//   · how much of the screen the chrome eats is the SUM of four laid-out blocks, one of which wraps onto a
//     number of rows that depends on how many nav pills a church's modules produce.
//
// So this loads the real steward.html off the real gateway in Chromium at exactly 360x730, walks the real
// "Start a new church" path to a real dashboard, and reads getBoundingClientRect(). CLAUDE.md rule 3 is
// satisfied the strongest way available: nothing here matches text in app/*.jsx, and `false && ` in front of
// any of these fixes changes what the browser measures.
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs, so CI without a browser is green.
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
const PORT = 8862, CDP = 9362;
const ROOT = new URL('..', import.meta.url).pathname;
const VW = 360, VH = 730;   // the Oppo CPH2477's viewport, the phone the owner runs the console on
const sleep = ms => new Promise(r => setTimeout(r, ms));

let relay, chr, ws, dataDir, prof, evalIn, booted = '';
const errors = [];

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  if (!CHROME) return;
  await requireFreePort(PORT, 'the-console-fits-a-360px-phone.test.mjs');
  await requireFreePort(CDP, 'the-console-fits-a-360px-phone.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-fits-'));
  // a THROWAWAY church, never a real npub, and chromium is pointed at a black hole for the production hosts:
  // the console dials CANONICAL_RELAYS regardless of who served the page (see app-boots.test.mjs).
  const cp = getPublicKey(generateSecretKey());
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-fits-chr-' + process.pid);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, `--window-size=${VW},${VH}`,
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
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  // --window-size gets the OUTER window; this pins the layout viewport to the handset's exact CSS pixels.
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };

  // Drive the real path to a real dashboard, exactly as app-boots.test.mjs does: the console refuses to hold a
  // plaintext seed, so a seeded fixture would have to reproduce its AES-GCM format and would silently drift.
  const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
  const type = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
    if(!i) return 'miss';
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
  await sleep(9000);
  booted = await evalIn(click('/Start a new church/i'));
  await sleep(2500);
  await evalIn(type('At least 8', 'cedar-harbour-lamp-42'));
  await evalIn(type('Type it again', 'cedar-harbour-lamp-42'));
  await evalIn(click('/Set PIN/i'));
  await sleep(1200);
  // The first-run wizard is a full-screen flow of its own and is not what these tests are about. Setting the
  // flag BEFORE the dashboard mounts is what keeps it shut: the dashboard reads it once, in an effect at mount.
  await evalIn(`localStorage.setItem('trinityone.steward.wizard.done','1')`);
  await sleep(13000);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// Open one of the console's sections by pressing its real nav pill, and prove we got there.
async function openTab(label) {
  const r = await evalIn(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Console sections"] button')].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(label)})); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" pill in the console's nav — re-anchor this test`);
  await sleep(2600);
}

// Everything laid out inside <main> whose right edge is past the right edge of the phone. <main> scrolls
// vertically and NOT horizontally, so anything in this list is content a steward simply cannot see.
const OFF_SCREEN_RIGHT = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('main *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > innerWidth + 0.5) {
      out.push({ right: Math.round(r.right), w: Math.round(r.width), text: (el.innerText||'').trim().replace(/\\s+/g,' ').slice(0,48) });
    }
  }
  return JSON.stringify(out.slice(0, 12));
})()`;

test('the console reached its dashboard at 360x730 — without which nothing below proves anything',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    assert.equal(booted, 'ok', 'the "Start a new church" button was never found');
    const v = JSON.parse(await evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
    assert.deepEqual(v, { w: VW, h: VH }, 'the viewport is not the phone we claim to be measuring');
    const nav = await evalIn(`(() => { const n = document.querySelector('nav[aria-label="Console sections"]'); return n ? n.querySelectorAll('button').length : 0; })()`);
    assert.ok(nav >= 6, `the console's nav has ${nav} sections — it did not reach the dashboard, so every measurement below is of the wrong screen`);
    assert.deepEqual(errors, [], 'the console threw while reaching its dashboard:\n  ' + errors.join('\n  '));
  });

test('nothing on Overview is cut off by the right edge of the phone',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    // Measured before the fix, on this exact screen: the stat grid's tracks resolved to 205.09px + 146.64px
    // inside a 336px box, so the Groups card and the Your relay card both ended at x=374 — 14px off a 360px
    // screen, with no sideways scroll to reach them. Their text wrapped to "chat rooms ·/signed" and
    // "Your/relay" in the owner's screenshot for the same reason.
    await openTab('Overview');
    const off = JSON.parse(await evalIn(OFF_SCREEN_RIGHT));
    assert.deepEqual(off, [],
      'these are laid out past the right edge of a ' + VW + 'px screen, and <main> does not scroll sideways, ' +
      'so a steward cannot see them: ' + JSON.stringify(off));

    // …and the cards must not have bought that by hiding their own labels. An ellipsised label passes the
    // assertion above while still failing the steward.
    const cut = JSON.parse(await evalIn(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('main span')) {
        const t = (el.textContent || '').trim();
        if (!/^(Members|Groups|Announcements|Your relay)$/.test(t)) continue;
        if (el.scrollWidth > el.clientWidth + 1) out.push({ label: t, needs: el.scrollWidth, has: el.clientWidth });
      }
      return JSON.stringify(out);
    })()`));
    assert.deepEqual(cut, [], 'an Overview card label is truncated rather than laid out: ' + JSON.stringify(cut));
  });
