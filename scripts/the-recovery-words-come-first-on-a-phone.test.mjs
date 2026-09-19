// ON THE WIZARD'S RECOVERY-KEY STEP, THE TWELVE WORDS ARE THE FIRST THING ON THE CARD, NOT 600px DOWN.
//   Run: node --test scripts/the-recovery-words-come-first-on-a-phone.test.mjs
//
// Measured on the Oppo CPH2477 at 360x730 on 2026-09-19 (TrinityOne-internal/UI-AUDIT-console-2026-09-19.md
// §A6, p/here/01-05-wizard-words-scrolled.png): step 2 of the first-run wizard put the words at scrollTop 605
// of 1085 — a newcomer scrolled past two paragraphs of warning to reach the one thing the step exists for.
// The words now come first and the warning follows them, cut to two sentences (owner 2026-09-10).
//
// ── WHY A BROWSER, AND WHAT IS REAL ──────────────────────────────────────────────────────────────────────
// Same instrument as scripts/dialog-footers-stay-in-reach-on-a-phone.test.mjs: the real steward.html off the
// real gateway, in Chromium at the handset's CSS pixels, driven down the real "Start a new church" path to
// the real step. Nothing here matches text in app/*.jsx (CLAUDE.md rule 3): the claim is a MEASUREMENT of
// where the words block sits on the card, and whether the checkbox and Continue can be reached.
//
// ── THE ASSERTION ────────────────────────────────────────────────────────────────────────────────────────
// With the card unscrolled: the words label ("RECOVERY PHRASE — 12 WORDS", the [data-wiz-words] element) has
// its top within 400px of the card's top AND inside the viewport, and the phrase box right under it is inside
// the viewport too. Before the change the label's top was ~605px into the card. Then the acknowledgement
// checkbox is scrolled into view and elementFromPoint at its centre returns the checkbox (or its label), and
// Continue — pinned in the footer by P9 — is reachable without any scrolling at all.
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
const PORT = 8868, CDP = 9369;   // 88xx: 8862 fits-a-360px-phone, 8864 sections-behind-a-menu, 8866 dialog-footers; 93xx taken: 9350-9358, 9360-9364, 9366, 9367, 9371, 9381, 9412
const ROOT = new URL('..', import.meta.url).pathname;
const PIN = 'cedar-harbour-lamp-42';
const WORDS_WITHIN = 400;   // px from the card's top within which the words label must start
const sleep = ms => new Promise(r => setTimeout(r, ms));

let relay, chr, ws, dataDir, prof, evalIn, send, booted = '';
const errors = [];

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const type = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
  if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;

before(async () => {
  if (!CHROME) return;
  await requireFreePort(PORT, 'the-recovery-words-come-first-on-a-phone.test.mjs');
  await requireFreePort(CDP, 'the-recovery-words-come-first-on-a-phone.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-words-'));
  // a throwaway church, pinned to ANOTHER church on purpose and the production hosts black-holed — the same
  // set-up as the sibling files, for the same reasons (see dialog-footers-stay-in-reach-on-a-phone.test.mjs).
  const cp = getPublicKey(generateSecretKey());
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-words-chr-' + process.pid);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=360,730',
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
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 730, deviceScaleFactor: 2, mobile: true });
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };

  // The real path: Start a new church → the PIN gate → the wizard on step 0.
  await sleep(9000);
  booted = await evalIn(click('/Start a new church/i'));
  await sleep(2500);
  await evalIn(type('At least 8', PIN));
  await evalIn(type('Type it again', PIN));
  await evalIn(click('/Set PIN/i'));
  await sleep(13000);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

const WIZ = '[data-stew-modal-panel]';
const wizardTitle = () => evalIn(`(() => { const p = document.querySelector('${WIZ}'); return p ? (p.innerText || '').trim().split('\\n')[0].slice(0, 40) : ''; })()`);
const pressInWizard = async (label) => {
  const r = await evalIn(`(() => { const b = [...document.querySelector('${WIZ}').querySelectorAll('button')].find(x => (x.textContent || '').trim().startsWith(${JSON.stringify(label)})); if (!b || b.disabled) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no enabled "${label}" button in the wizard`);
};

// Where things are on the UNSCROLLED card, plus what elementFromPoint returns at the checkbox and Continue.
const MEASURE = `(() => {
  const panel = document.querySelector('${WIZ}');
  if (!panel) return JSON.stringify({ found: false });
  const scrollers = [...panel.querySelectorAll('*')].filter(el => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1; });
  for (const el of scrollers) el.scrollTop = 0;
  const pr = panel.getBoundingClientRect();
  const label = panel.querySelector('[data-wiz-words]');
  const box = label && label.nextElementSibling;
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
  const cb = panel.querySelector('input[type="checkbox"]');
  const cont = [...panel.querySelectorAll('button')].find(b => (b.textContent || '').trim().startsWith('Continue'));
  const hitOf = (el) => { if (!el) return 'absent'; const b = el.getBoundingClientRect(); const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return e ? (e === el || el.contains(e) || (el.closest('label') && el.closest('label').contains(e)) ? 'self' : (e.tagName + (e.className ? '.' + String(e.className).split(' ')[0] : ''))) : 'null'; };
  const continueHit = hitOf(cont);
  // the checkbox: reachable once scrolled to (the card body scrolls; that is allowed for the LAST control)
  let cbHit = 'absent', cbScrolled = null;
  if (cb) { cb.scrollIntoView({ block: 'center' }); cbHit = hitOf(cb); cbScrolled = r(cb); for (const el of scrollers) el.scrollTop = 0; }
  return JSON.stringify({ found: true, vh: innerHeight, panel: { top: Math.round(pr.top), bottom: Math.round(pr.bottom), height: Math.round(pr.height) },
    bodyScrollHeight: Math.max(0, ...scrollers.map(el => el.scrollHeight)),
    label: r(label), box: r(box), boxText: box ? (box.textContent || '').trim().split(/\\s+/).length : 0,
    checkbox: r(cb), checkboxHit: cbHit, checkboxScrolled: cbScrolled, continue: r(cont), continueHit, continueDisabled: cont ? cont.disabled : null });
})()`;

test('CONTROL: the console reached the wizard at 360x730, and Continue took it to the recovery-key step',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    assert.equal(booted, 'ok', 'the "Start a new church" button was never found');
    const v = JSON.parse(await evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
    assert.deepEqual(v, { w: 360, h: 730 }, 'the viewport is not the phone we claim to be measuring');
    assert.match(await wizardTitle(), /Welcome/, 're-anchor: the wizard is not on its first step');
    assert.equal(await evalIn(type('Your church’s name', 'St Aidan of the Words')), 'ok', 're-anchor: no church-name field on step 0');
    await sleep(300);
    await pressInWizard('Continue');
    await sleep(3500);
    assert.match(await wizardTitle(), /recovery key/i, 're-anchor: Continue on step 0 did not reach the recovery-key step');
    assert.deepEqual(errors, [], 'the console threw on the way to the step:\n  ' + errors.join('\n  '));
  });

test(`the twelve words start within ${WORDS_WITHIN}px of the card's top and are on screen unscrolled; the checkbox and Continue are reachable`,
  { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    const m = JSON.parse(await evalIn(MEASURE));
    assert.equal(m.found, true, 'the wizard panel is gone');
    assert.ok(m.label, 're-anchor: no [data-wiz-words] label on the recovery-key step');
    assert.ok(m.box && m.boxText >= 12, 're-anchor: the element under the words label does not hold twelve words (' + m.boxText + ')');
    const into = m.label.top - m.panel.top;
    console.log(`    card ${m.panel.top}..${m.panel.bottom} (${m.panel.height}px, body scrollHeight ${m.bodyScrollHeight}); words label ${into}px into the card, phrase box ${m.box.top}..${m.box.bottom}; checkbox ${JSON.stringify(m.checkbox)} → ${m.checkboxHit}; Continue ${JSON.stringify(m.continue)} → ${m.continueHit}`);
    assert.ok(into <= WORDS_WITHIN,
      `THE DEFECT: the words label starts ${into}px into the card (the audit measured ~605px) — a newcomer scrolls past the warning to reach the one thing the step is for`);
    assert.ok(m.label.top >= 0 && m.box.bottom <= m.vh,
      `the phrase box (${m.box.top}..${m.box.bottom}) is not fully inside the ${m.vh}px viewport with the card unscrolled`);
    assert.equal(m.checkboxHit, 'self', `the acknowledgement checkbox cannot be reached (elementFromPoint at its centre after scrolling to it → ${m.checkboxHit})`);
    assert.equal(m.continueHit, 'self', `Continue cannot be reached without scrolling (elementFromPoint → ${m.continueHit})`);
    assert.equal(m.continueDisabled, true, 're-anchor: Continue is enabled before the checkbox is ticked — the ceremony changed');
    assert.deepEqual(errors, [], 'the console threw on the step:\n  ' + errors.join('\n  '));
  });
