// A DIALOG'S BUTTONS ARE ON SCREEN THE MOMENT IT OPENS, ON THE PHONE, WITHOUT SCROLLING — AND STAY THERE
// UNDER THE ERROR BANNER, DOCKED OR EXPANDED, AND COME BACK WHEN THE BANNER IS COLLAPSED.
//   Run: node --test scripts/dialog-footers-stay-in-reach-on-a-phone.test.mjs
//
// Measured on the Oppo CPH2477 at 360x730 on 2026-09-19 (TrinityOne-internal/UI-AUDIT-console-2026-09-19.md
// §D): New team ended at y 694 with Cancel and "Create team" below it, 0/429 and 0/442 of their pixels
// hittable; New event's buttons were at y 931; "Admit 40 people?" at y 739; Invite your church's Done at
// y 1177; the invite poster's three at y 1112–1156; Create a reading plan's three were HALF-clipped
// (134/260, 128/247, 170/325 reachable); and every wizard step in landscape hid Continue under a 258px card.
// Every one of those dialogs was a `maxHeight; overflowY: auto` box with its buttons as the LAST CHILD of
// the scrolling box, ending in a clean rounded edge that read as "that's all". The fix is one shape per
// dialog — flex column, body scrolls, footer pinned — and this file is the proof that the shape is on the
// screen, dialog by dialog.
//
// ── WHY A BROWSER, AND WHAT IS REAL ──────────────────────────────────────────────────────────────────────
// Same instrument as scripts/the-console-fits-a-360px-phone.test.mjs and scripts/the-console-sections-are-
// behind-a-menu-on-a-phone.test.mjs: the real steward.html off the real gateway, in Chromium at exactly the
// handset's CSS pixels, driven down the real "Start a new church" path, every dialog opened by the control a
// steward would press. Nothing here matches text in app/*.jsx (CLAUDE.md rule 3); a `false && ` in front of
// a pinned footer changes what elementFromPoint returns.
//
// ── THE ASSERTION, AND THE TRAP IT AVOIDS ────────────────────────────────────────────────────────────────
// getBoundingClientRect is not the hit area (reference/UI-AUDIT-PLAN-console-apk.md §3): a button scrolled
// out of its panel's viewport still reports its unscrolled rect. And elementFromPoint at one centre point
// misses the half-clipped case that Create a reading plan actually was. So every button's rect is scanned
// on a 4px grid and at least 90% of the points must return the button itself (or a descendant): a button
// below the viewport returns null everywhere, a button scrolled out of its panel returns the panel, a
// half-clipped one returns the scrim for its lower half. This is the POSITIVE claim — "the button is
// reachable" — which is exactly the claim scripts/the-error-banner-clears-a-dialog-on-the-phone.test.mjs
// explains it cannot make about "not covered" from a negative.
//
// ── THE WIZARD, AND WHY IT IS MEASURED FIRST ─────────────────────────────────────────────────────────────
// The two sibling files keep the first-run wizard OFF because ☰ does nothing under a modal. This file needs
// the wizard ON — its shell (WizShell) is one of the dialogs under test — so it is measured first, at both
// sizes, on step 0 and step 1; then `wizard.done` is set, the page is reloaded, and the console is unlocked
// with the PIN it was given, which is the ordinary lock path and leaves the wizard behind.
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
const PORT = 8866, CDP = 9367;   // 88xx: 8862 fits-a-360px-phone, 8864 sections-behind-a-menu; 93xx taken: 9350-9358, 9360-9364, 9366, 9371, 9381, 9412
const ROOT = new URL('..', import.meta.url).pathname;
const SIZES = [['360x730 upright', 360, 730], ['730x328 landscape', 730, 328]];   // the Oppo CPH2477, both ways up
const PIN = 'cedar-harbour-lamp-42';
const REACH = 0.9;   // share of a button's 4px grid points that must return the button
const sleep = ms => new Promise(r => setTimeout(r, ms));
// a message long enough to wrap to several lines when the banner is expanded, so the expanded state really
// is the taller one steward.html reserves 220px for
const LONG = 'The key was saved, and “Musicians” is now sealed on 1 of 4 relays. relay.example.org, '
  + 'other.example.net, third.example.com would not take it, so messages that go through them can still be '
  + 'read there. Trying again won’t change that if those relays don’t carry your church — see Settings → Relays.';

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
  await requireFreePort(PORT, 'dialog-footers-stay-in-reach-on-a-phone.test.mjs');
  await requireFreePort(CDP, 'dialog-footers-stay-in-reach-on-a-phone.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-footers-'));
  // a THROWAWAY church, never a real npub, and chromium is pointed at a black hole for the production hosts:
  // the console dials CANONICAL_RELAYS regardless of who served the page (see app-boots.test.mjs).
  //
  // ⚠ PINNED TO ANOTHER CHURCH ON PURPOSE, like the sibling files, and here it matters. Two other set-ups
  // were tried on 2026-09-19 and each loses a dialog:
  //   · an UNPINNED relay accepts this church, and then a console served from 127.0.0.1 reads as self-hosted
  //     on loopback: the invite card becomes "make your church reachable" and there is no poster to open;
  //   · the same relay reached by a non-loopback name (`console.test` mapped to 127.0.0.1) is not a secure
  //     context, so WebCrypto is off and no church can be created at all.
  // Pinned, the box is "not ours" and the church lives elsewhere — the state the Oppo was photographed in —
  // and every dialog is the real one. The cost: this church's writes are refused, so the console raises
  // "this relay has not accepted your church" by itself (checkDialog dismisses and records it), and the
  // settings switch that opens SkConfirm needs a remount to read its refused edit (its opener says how).
  const cp = getPublicKey(generateSecretKey());
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-footers-chr-' + process.pid);
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

  // The real path to a real dashboard, exactly as the sibling files walk it — WITH the first-run wizard left
  // up, because its shell is under test here (see the note at the top).
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

// ── the instrument ────────────────────────────────────────────────────────────────────────────────────────
const setSize = async (w, h) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await sleep(900); };

// The panel under test: the topmost console dialog, which is the LAST [role=dialog] in the DOM that is not
// the sections drawer — or the wizard's panel, which carries data-stew-modal-panel instead of a role (see
// WizShell). `labels` are the footer buttons to find, by the text a steward reads on them.
const MEASURE = (panelSel, labels) => `(() => {
  const panels = [...document.querySelectorAll(${JSON.stringify(panelSel)})].filter(p => p.getAttribute('aria-label') !== 'Sections');
  const panel = panels[panels.length - 1];
  if (!panel) return JSON.stringify({ found: false });
  const pr = panel.getBoundingClientRect();
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
  const out = {};
  for (const label of ${JSON.stringify(labels)}) {
    const btn = [...panel.querySelectorAll('button')].find(b => norm(b.textContent).startsWith(label));
    if (!btn) { out[label] = { found: false }; continue; }
    const r = btn.getBoundingClientRect();
    // THE WHOLE RECT, ON A 4px GRID. A point returns the button (or a descendant, the icon inside it) or it
    // does not; what it returns instead is recorded so a failure says WHY — 'null' is off the viewport,
    // 'panel' is scrolled out inside the card, 'scrim' is the half-clipped case.
    let hit = 0, total = 0; const other = {};
    for (let y = Math.ceil(r.top) + 1; y < Math.floor(r.bottom); y += 4)
      for (let x = Math.ceil(r.left) + 1; x < Math.floor(r.right); x += 4) {
        total++;
        const e = document.elementFromPoint(x, y);
        if (e && (e === btn || btn.contains(e))) { hit++; continue; }
        let what = 'null';
        if (e) {
          if (e.closest('[role="alert"]')) what = 'banner';
          else if (e.closest('button')) what = 'BUTTON:' + norm(e.closest('button').textContent).slice(0, 24);
          else if (panel.contains(e)) what = 'panel';
          else if (getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().width >= innerWidth - 1) what = 'scrim';
          else what = 'other';
        }
        other[what] = (other[what] || 0) + 1;
      }
    out[label] = { found: true, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
      inViewport: r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.left >= 0 && r.right <= innerWidth + 0.5,
      total, hit, reach: total ? hit / total : 0, other, disabled: btn.disabled };
  }
  // which box scrolls, and was it scrolled: the assertion is about the UNSCROLLED state
  const scrollers = [...panel.querySelectorAll('*'), panel].filter(el => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1; });
  return JSON.stringify({ found: true, label: panel.getAttribute('aria-label') || '(wizard)', vw: innerWidth, vh: innerHeight,
    panel: { top: Math.round(pr.top), bottom: Math.round(pr.bottom), height: Math.round(pr.height) },
    scrolled: scrollers.some(el => el.scrollTop > 0), bodyScrolls: scrollers.length > 0,
    bannerState: document.documentElement.getAttribute('data-stew-banner'),
    buttons: out });
})()`;

const measure = async (panelSel, labels) => JSON.parse(await evalIn(MEASURE(panelSel, labels)));

// What every row asserts about a measurement, so the text of the failure is the same everywhere.
function assertReachable(m, where, labels) {
  assert.equal(m.found, true, `${where}: no dialog panel on screen`);
  // NOT asserted: whether the body has scrolled. This file scrolls nothing, but a dialog whose first field
  // carries autoFocus (New team's Name, the wizard's church name) scrolls that field into view by itself on a
  // 328px-tall screen — which is the app's behaviour, not the harness's, and a pinned footer is exactly as
  // pinned either way. `scrolled` is printed with the measurement instead.
  for (const label of labels) {
    const b = m.buttons[label];
    assert.ok(b && b.found, `${where}: no "${label}" button in the dialog reading "${m.label}" — re-anchor this test. Saw: ${JSON.stringify(m.buttons)}`);
    assert.equal(b.inViewport, true,
      `${where}: "${label}" is at y ${b.top}..${b.bottom} of a ${m.vh}px screen — NOT IN THE VIEWPORT when the dialog opens. ` +
      `The card ends at ${m.panel.bottom}; nothing says it scrolls. ${JSON.stringify(b)}`);
    assert.ok(b.reach >= REACH,
      `${where}: only ${b.hit} of ${b.total} grid points on "${label}" (${Math.round(b.reach * 100)}%) reach the button; the rest ` +
      `return ${JSON.stringify(b.other)}. 'panel' is the button scrolled out inside its own card, 'null' is off the screen, ` +
      `'scrim' is the half-clipped case. Rect ${b.top}..${b.bottom}, card ${m.panel.top}..${m.panel.bottom} at ${m.vw}x${m.vh}.`);
  }
}

// ── the banner, driven through its real controls ─────────────────────────────────────────────────────────
// `steward-write-blocked` is the event the console's own write gates fire; PublishErrorBanner listens for
// it and the message is STICKY (nothing clears it but Dismiss). Show and Collapse are the banner's own pills.
const BANNER = {
  raise: `(() => { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'group key', message: ${JSON.stringify(LONG)} } })); return 'ok'; })()`,
  show: `(() => { const b = document.querySelector('[role="alert"] button[aria-label="Show the whole message"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`,
  collapse: `(() => { const b = document.querySelector('[role="alert"] button[aria-label^="Collapse"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`,
  dismiss: `(() => { const bs = [...document.querySelectorAll('[role="alert"] button[aria-label^="Dismiss"]')]; bs.forEach(b => b.click()); return bs.length; })()`,
  state: `(() => { const a = document.querySelector('[role="alert"]'); const r = a ? a.getBoundingClientRect() : null;
    return JSON.stringify({ up: !!a, text: a ? (a.textContent || '').trim().slice(0, 120) : '', height: r ? Math.round(r.height) : 0, attr: document.documentElement.getAttribute('data-stew-banner'),
      show: !!document.querySelector('[role="alert"] button[aria-label="Show the whole message"]'),
      collapse: !!document.querySelector('[role="alert"] button[aria-label^="Collapse"]') }); })()`,
};
const bannerState = async () => JSON.parse(await evalIn(BANNER.state));

// One dialog, one size: open → measure; raise the banner (docked) → measure; Show → measure; Collapse →
// measure and compare heights; dismiss; close. Every measurement is taken WITHOUT scrolling anything.
// `stays` is for the wizard, the one dialog with no exit: it is measured in place and not closed.
async function checkDialog(name, { open, close, panelSel, labels, sizeLabel, stays = false }) {
  const where = (state) => `${name} at ${sizeLabel}, ${state}`;
  await open();
  // THE CONSOLE RAISES BANNERS OF ITS OWN in this harness — the production relays are black-holed, so a
  // publish the wizard or a settings switch makes can come back refused — and a message that is up before
  // this row starts is the console's, not this row's. It is dismissed, and RECORDED, so a row never
  // measures the plain state under somebody else's banner and never mistakes it for the one it raises.
  const stray = await bannerState();
  if (stray.up) { console.log(`    (${where('open')}: dismissing a banner the console raised by itself: ${JSON.stringify(stray.text)})`); await evalIn(BANNER.dismiss); await sleep(600); }
  const plain = await measure(panelSel, labels);
  assertReachable(plain, where('no banner'), labels);
  assert.equal(plain.bannerState, null, `${where('no banner')}: html[data-stew-banner] is set with no banner up: ${JSON.stringify(await bannerState())}`);

  // the DOCKED banner — one line at the foot; steward.html shortens the panel by min(24vh, 62px)
  assert.equal(await evalIn(BANNER.raise), 'ok');
  await sleep(700);
  let bs = await bannerState();
  assert.equal(bs.up && bs.attr === 'clamped', true, `${where('docked banner')}: the banner did not dock over the dialog: ${JSON.stringify(bs)}`);
  const docked = await measure(panelSel, labels);
  assertReachable(docked, where('docked banner'), labels);

  // the EXPANDED banner — the steward pressed Show; the panel is capped at calc(100vh - 220px - 28px)
  assert.equal(await evalIn(BANNER.show), 'ok', `${where('expanded banner')}: no Show pill on the docked banner`);
  await sleep(700);
  bs = await bannerState();
  assert.equal(bs.attr, 'open', `${where('expanded banner')}: pressing Show did not expand the banner: ${JSON.stringify(bs)}`);
  assert.equal(bs.collapse, true, `${where('expanded banner')}: the expanded banner has no Collapse control — a steward who pressed Show has no way back while the dialog is open`);
  const expanded = await measure(panelSel, labels);
  assertReachable(expanded, where('expanded banner'), labels);

  // COLLAPSE — the inverse of Show: the dialog gets its height back and the buttons are still in reach
  assert.equal(await evalIn(BANNER.collapse), 'ok');
  await sleep(700);
  bs = await bannerState();
  assert.equal(bs.attr, 'clamped', `${where('after Collapse')}: the banner is not back to its docked line: ${JSON.stringify(bs)}`);
  assert.equal(bs.show, true, `${where('after Collapse')}: the Show pill did not come back`);
  const back = await measure(panelSel, labels);
  assertReachable(back, where('after Collapse'), labels);
  assert.ok(back.panel.height >= expanded.panel.height,
    `${where('after Collapse')}: the dialog is ${back.panel.height}px tall, SHORTER than the ${expanded.panel.height}px it was under the expanded banner`);
  assert.ok(Math.abs(back.panel.height - docked.panel.height) <= 2,
    `${where('after Collapse')}: the dialog is ${back.panel.height}px tall against ${docked.panel.height}px when the banner was first docked — Collapse did not give its height back`);

  const n = await evalIn(BANNER.dismiss);
  assert.ok(n >= 1, `${where('dismiss')}: no Dismiss control on the banner`);
  await sleep(500);
  assert.equal((await bannerState()).up, false, `${where('dismiss')}: the banner is still up after Dismiss`);
  const line = (m) => labels.map(l => `${l} ${m.buttons[l].top}..${m.buttons[l].bottom} ${Math.round(m.buttons[l].reach * 100)}%`).join(', ');
  console.log(`    ${name} @ ${sizeLabel}: card ${plain.panel.top}..${plain.panel.bottom} (${plain.panel.height}px${plain.bodyScrolls ? ', body scrolls' : ''}${plain.scrolled ? ', autofocus scrolled it' : ''}); ` +
    `plain: ${line(plain)} | docked ${docked.panel.height}px: ${line(docked)} | expanded ${expanded.panel.height}px: ${line(expanded)} | collapsed ${back.panel.height}px`);
  if (!stays) {
    await close();
    await sleep(800);
    const gone = await evalIn(`[...document.querySelectorAll(${JSON.stringify(panelSel)})].filter(p => p.getAttribute('aria-label') !== 'Sections').length`);
    assert.equal(gone, 0, `${where('close')}: the dialog did not close — the next row would measure it instead of its own`);
  }
  return { plain, docked, expanded, back };
}

// ── the wizard ────────────────────────────────────────────────────────────────────────────────────────────
const WIZ = '[data-stew-modal-panel]';
const wizardUp = () => evalIn(`!!document.querySelector('${WIZ}')`);
const wizardTitle = () => evalIn(`(() => { const p = document.querySelector('${WIZ}'); return p ? (p.innerText || '').trim().split('\\n')[0].slice(0, 40) : ''; })()`);
const pressInWizard = async (label) => {
  const r = await evalIn(`(() => { const b = [...document.querySelector('${WIZ}').querySelectorAll('button')].find(x => (x.textContent || '').trim().startsWith(${JSON.stringify(label)})); if (!b || b.disabled) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no enabled "${label}" button in the wizard`);
};
const noop = async () => {};

test('CONTROL: the console reached its dashboard at 360x730 with the first-run wizard on screen — without which nothing below proves anything',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    assert.equal(booted, 'ok', 'the "Start a new church" button was never found');
    const v = JSON.parse(await evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
    assert.deepEqual(v, { w: 360, h: 730 }, 'the viewport is not the phone we claim to be measuring');
    assert.equal(await wizardUp(), true, 'the first-run wizard is not on screen; this file measures its shell first (see the note at the top)');
    assert.deepEqual(errors, [], 'the console threw while reaching its dashboard:\n  ' + errors.join('\n  '));
  });

test('WizShell: step 0 (Continue) and step 1 (Back, Continue) keep their footer on screen at both sizes, banner docked, expanded and collapsed',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
    // 360x730, step 0
    assert.match(await wizardTitle(), /Welcome/, 're-anchor: the wizard is not on its first step');
    await checkDialog('WizShell step 0', { open: noop, close: noop, panelSel: WIZ, labels: ['Continue'], sizeLabel: '360x730 upright', stays: true });
    // name the church and go to step 1 — the twelve words, the tallest step
    assert.equal(await evalIn(type('Your church’s name', 'St Aidan of the Footers')), 'ok', 're-anchor: no church-name field on step 0');
    await sleep(300);
    await pressInWizard('Continue');
    await sleep(3500);
    assert.match(await wizardTitle(), /recovery key/i, 're-anchor: Continue on step 0 did not reach the recovery-key step');
    await checkDialog('WizShell step 1', { open: noop, close: noop, panelSel: WIZ, labels: ['Back', 'Continue'], sizeLabel: '360x730 upright', stays: true });
    // 730x328: the case the audit photographed — every step hid Continue under a 258px card
    await setSize(730, 328);
    await checkDialog('WizShell step 1', { open: noop, close: noop, panelSel: WIZ, labels: ['Back', 'Continue'], sizeLabel: '730x328 landscape', stays: true });
    await pressInWizard('Back');
    await sleep(800);
    assert.match(await wizardTitle(), /Welcome/, 're-anchor: Back did not return to step 0');
    await checkDialog('WizShell step 0', { open: noop, close: noop, panelSel: WIZ, labels: ['Continue'], sizeLabel: '730x328 landscape', stays: true });
    await setSize(360, 730);
    assert.deepEqual(errors, [], 'the console threw during the wizard:\n  ' + errors.join('\n  '));
  });

// ── leave the wizard behind: mark it done, reload, unlock with the PIN ───────────────────────────────────
test('the wizard can be put away for the rest of this file: reload, unlock with the PIN, dashboard with no modal up',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
    await send('Page.reload', { ignoreCache: false });
    await sleep(8000);
    const locked = await evalIn(type('Your PIN or passphrase', PIN));
    assert.equal(locked, 'ok', 'after the reload there is no PIN field — the console did not come back locked on this church');
    await evalIn(click('/^Unlock/i'));
    await sleep(12000);
    assert.equal(await wizardUp(), false, 'the wizard is still up after the reload — the flag did not take');
    const burger = await evalIn(`!!document.querySelector('button[aria-label="Sections"]')`);
    assert.equal(burger, true, 'no ☰ in the header after unlocking — this is not the phone dashboard');
    assert.equal(await evalIn(`document.querySelectorAll('[role="dialog"]').length`), 0, 'a dialog is already open on the unlocked dashboard');
    assert.deepEqual(errors, [], 'the console threw while reloading:\n  ' + errors.join('\n  '));
  });

// ── the dialogs, opened the way a steward opens them ─────────────────────────────────────────────────────
async function openMenu() {
  const r = await evalIn(`(() => { const b = document.querySelector('button[aria-label="Sections"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', 'no ☰ ("Sections") control in the console\'s header — re-anchor this test');
  await sleep(700);
}
async function openTab(label) {
  await openMenu();
  const r = await evalIn(`(() => { const b=[...document.querySelectorAll('[role="dialog"][aria-label="Sections"] nav[aria-label="Console sections"] button')].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(label)})); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" row in the console's sections menu — re-anchor this test`);
  await sleep(2200);
  assert.equal(await evalIn(`!document.querySelector('[role="dialog"][aria-label="Sections"]')`), true, 'picking a section left the menu open over it');
}
async function openSettingsPage(name) {
  await openTab('Settings');
  // on a phone the list and a page are never on screen together — a page left open by an earlier row hides
  // the list, and "All settings" is the way back; then the groups are collapsible and remembered, so open
  // every shut one so the row is rendered
  if (await evalIn(`!!document.querySelector('button.set-back')`)) { await evalIn(`document.querySelector('button.set-back').click()`); await sleep(600); }
  await evalIn(`(() => { [...document.querySelectorAll('nav[aria-label="Settings pages"] button.set-grp[aria-expanded="false"]')].forEach(b => b.click()); return 'ok'; })()`);
  await sleep(500);
  const r = await evalIn(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Settings pages"] button')].find(x => (x.querySelector('.set-item-n') || x).textContent.trim() === ${JSON.stringify(name)}); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${name}" row in Settings — re-anchor this test`);
  await sleep(1200);
}
const pressButton = async (find, what) => {
  const r = await evalIn(`(() => { const b = [...document.querySelectorAll('button')].find(x => ${find}); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `could not find the control that opens ${what} — re-anchor this test`);
  await sleep(1300);
};
const escape = async () => { await evalIn(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); };
const DLG = '[role="dialog"]';

// The seven dialogs the audit measured, by the control that opens each. SkConfirm is reached through the
// Settings switch that asks "Encrypt all group chat?" — the same component, at a different call site, as
// "Admit N people?" (which needs a queue of join requests this fixture has no members to make).
const DIALOGS = [
  { name: 'NewTeamModal (New team)', labels: ['Cancel', 'Create team'],
    open: async () => { await openTab('Rota'); await pressButton(`(x.getAttribute('title')||'')==='Create a new serving team'`, 'New team'); }, close: escape },
  { name: 'SchModal (New event)', labels: ['Cancel', 'Add event'],
    open: async () => { await openTab('Calendar'); await pressButton(`(x.textContent||'').trim()==='New event'`, 'New event'); }, close: escape },
  { name: 'SkConfirm (Encrypt all group chat?)', labels: ['Cancel', 'Encrypt all'],
    open: async () => {
      await openSettingsPage('Rules & privacy');
      const SW = `document.querySelector('button[aria-label="Toggle encrypt all group chat"]')`;
      // A new church has encryption ON by default and the confirm is asked when turning it ON, so it has to
      // be turned off first. MEASURED 2026-09-19 (a 180s probe): with every relay refusing (see before()) the
      // write comes back "Couldn't save to the relay" and the switch never reads off IN PLACE — but the
      // console merges the edit into its local profile regardless, and a REMOUNTED settings page reads that.
      // So: press, leave the page, come back. A harness affordance, recorded as one; nothing here claims
      // the switch persisted.
      if (await evalIn(`${SW} && ${SW}.getAttribute('aria-checked') === 'true'`)) {
        await evalIn(`${SW}.click()`);
        await sleep(2500);
        const said = await bannerState();
        if (said.up) { console.log(`    (SkConfirm opener: the console said ${JSON.stringify(said.text)} — expected here, see before())`); await evalIn(BANNER.dismiss); await sleep(400); }
        await openTab('Overview');
        await openSettingsPage('Rules & privacy');
      }
      assert.equal(await evalIn(`${SW} && ${SW}.getAttribute('aria-checked')`), 'false', 're-anchor: the encrypt-all switch never read off, so pressing it would not open the confirm');
      await evalIn(`${SW}.click()`);
      await sleep(1000);
    }, close: escape },
  { name: 'JoinModal (Invite your church)', labels: ['Done'],
    open: async () => { await pressButton(`(x.getAttribute('title')||'').startsWith('Show your church’s joining code')`, 'Invite your church'); }, close: escape },
  { name: 'InvitePosterModal (Invite poster)', labels: ['Done', 'Save PDF', 'Print'],
    open: async () => {
      await pressButton(`(x.getAttribute('title')||'').startsWith('Show your church’s joining code')`, 'Invite your church');
      await pressButton(`(x.getAttribute('title')||'').startsWith('Show the invite poster')`, 'Invite poster');
    }, close: async () => { await escape(); await sleep(600); await escape(); } },
  { name: 'StewBackupModal (Back up your church)', labels: ['Cancel', 'Download encrypted backup'],
    open: async () => { await openSettingsPage('Church key'); await pressButton(`(x.textContent||'').trim()==='Back up to a file'`, 'Back up your church'); }, close: escape },
  { name: 'NewPlanModal (Create a reading plan)', labels: ['Cancel', 'Save as draft', 'Publish now'],
    open: async () => { await openTab('Resources'); await pressButton(`(x.textContent||'').trim()==='New plan'`, 'Create a reading plan'); }, close: escape },
];

for (const [sizeLabel, W, H] of SIZES) {
  for (const d of DIALOGS) {
    test(`${d.name} at ${sizeLabel}: ${d.labels.join(' + ')} on screen when it opens, under the docked and expanded banner, and after Collapse`,
      { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
        await setSize(W, H);
        // start clean, so one row's failure does not become the next row's: close whatever a failed row left
        // open (Escape closes the topmost console dialog; twice for the poster over the invite), and clear
        // any banner the console raised by itself
        for (let i = 0; i < 3 && await evalIn(`document.querySelectorAll('${DLG}').length`); i++) { await escape(); await sleep(600); }
        await evalIn(BANNER.dismiss); await sleep(300);
        assert.equal(await evalIn(`document.querySelectorAll('${DLG}').length`), 0, 'a dialog is open that Escape does not close — nothing below can be measured');
        await checkDialog(d.name, { open: d.open, close: d.close, panelSel: DLG, labels: d.labels, sizeLabel });
        assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
      });
  }
}
