// THE STEWARD CONSOLE'S SECTIONS ARE BEHIND ☰ ON A PHONE, AND THE CHROME IS ONE ROW.
//   Run: node --test scripts/the-console-sections-are-behind-a-menu-on-a-phone.test.mjs
//
// Decided by the owner 2026-09-19 (reference/UI-AUDIT-PLAN-console-apk.md §0), after the measurement on the
// Oppo CPH2477 at 360x730: a nav strip of three wrapped rows of pills (107px), with the church's own content
// starting 235px down — 32% of a portrait screen and over two-thirds of a landscape one spent on chrome. The
// cost the owner named was discoverability; the mitigation is that the CURRENT section's name stays in the
// header beside ☰. Both halves are asserted here.
//
// ── WHY A BROWSER, AND WHY A SECOND FILE ────────────────────────────────────────────────────────────────
// Same instrument as scripts/the-console-fits-a-360px-phone.test.mjs, for the same reason: every claim here
// is about what a 360px viewport LAYS OUT — a rect, a visibility, a height — and none of that is in a style
// object. Nothing here matches text in app/*.jsx (CLAUDE.md rule 3); the console is loaded off the real
// gateway and read with getBoundingClientRect.
//
// A separate file because this one needs the first-run wizard OUT OF THE WAY, and that file needs it left
// up (its dialog measurements were calibrated against the handset with it up — see the note in its before()).
// The wizard registers as a modal, and ☰ correctly does nothing while a modal is up, so with the wizard on
// screen no menu could ever open here. It is kept off by refusing the one localStorage delete the create
// path makes (`trinityone.steward.wizard.done`), which is the only reason it appears at all.
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
const PORT = 8864, CDP = 9366;   // 88xx: 8862 is the-console-fits-a-360px-phone; 93xx taken: 9350-9358, 9360-9364, 9371, 9381, 9412
const ROOT = new URL('..', import.meta.url).pathname;
const VW = 360, VH = 730;   // the Oppo CPH2477's viewport, portrait
const LW = 730, LH = 328;   // …and landscape, where the chrome was over two-thirds of the height
// THE TARGET, and the whole point of the change: content starts within this many px of the top of the
// WebView at 360x730 (the status bar is outside it). Header 44 + gutters; the plan said 108.
const MAIN_TOP_BUDGET = 108;
// Every section the console can show, in the order the desktop sidebar has always shown them. Check-in and
// Finance are capability-gated so a given church may show fewer; the ORDER of what is shown must hold.
const ALL = ['Overview', 'Groups', 'Rota', 'Calendar', 'Rooms', 'Resources', 'Members', 'Check-in', 'Finance', 'Settings'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

let relay, chr, ws, dataDir, prof, evalIn, send, booted = '';
const errors = [];

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  if (!CHROME) return;
  await requireFreePort(PORT, 'the-console-sections-are-behind-a-menu-on-a-phone.test.mjs');
  await requireFreePort(CDP, 'the-console-sections-are-behind-a-menu-on-a-phone.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-menu-'));
  // a THROWAWAY church, never a real npub, and chromium is pointed at a black hole for the production hosts:
  // the console dials CANONICAL_RELAYS regardless of who served the page (see app-boots.test.mjs).
  const cp = getPublicKey(generateSecretKey());
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-menu-chr-' + process.pid);
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
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
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
  // KEEP THE FIRST-RUN WIZARD OFF. StewDashboard shows it when `newchurch` is set and `wizard.done` is not;
  // seedNewChurch (app/steward-root.jsx) sets the first and DELETES the second, deliberately, so that a second
  // church on one device still gets setup. Setting `done` before creating the church therefore does nothing,
  // and setting it after loses a race with the dashboard's mount (both measured in the-console-fits… before()).
  // Refusing that one delete is the only way in that is not a race, and it is a harness affordance: nothing in
  // the console reads removeItem's return.
  await evalIn(`(() => { const orig = Storage.prototype.removeItem; Storage.prototype.removeItem = function (k) { if (k === 'trinityone.steward.wizard.done') return; return orig.call(this, k); };
    localStorage.setItem('trinityone.steward.wizard.done', '1'); return 'ok'; })()`);
  booted = await evalIn(click('/Start a new church/i'));
  await sleep(2500);
  await evalIn(type('At least 8', 'cedar-harbour-lamp-42'));
  await evalIn(type('Type it again', 'cedar-harbour-lamp-42'));
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
// "Visible" the way a finger and an eye agree on it: laid out (a box), and not hidden by an ancestor.
const VISIBLE = `const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false; return true; };`;
const BURGER = `document.querySelector('button[aria-label="Sections"]')`;
const MENU = `document.querySelector('[role="dialog"][aria-label="Sections"]')`;

const press = async (sel) => {
  const r = await evalIn(`(() => { const b = ${sel}; if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `nothing on screen matched ${sel} — re-anchor this test`);
  await sleep(700);
};
const menuState = () => evalIn(`(() => { const b = ${BURGER}; const m = ${MENU};
  return JSON.stringify({ burger: !!b, expanded: b ? b.getAttribute('aria-expanded') : null, controls: b ? b.getAttribute('aria-controls') : null, open: !!m, menuId: m ? m.id : null }); })()`).then(JSON.parse);

// Which of the ten section names are on screen OUTSIDE the content pane and outside any dialog — i.e. in the
// chrome. Overview's own cards say "Members" and "Groups" inside <main>, and that is content, not navigation.
const CHROME_NAMES = `(() => { ${VISIBLE}
  const out = {};
  for (const name of ${JSON.stringify(ALL)}) {
    const hits = [...document.querySelectorAll('h1, h2, h3, button, span, div, a')].filter(el =>
      (el.textContent || '').trim() === name && !el.closest('main') && !el.closest('[role="dialog"]') && visible(el));
    if (hits.length) out[name] = hits.map(el => el.tagName.toLowerCase());
  }
  return JSON.stringify(out);
})()`;

const MENU_ROWS = `(() => { ${VISIBLE}
  const m = ${MENU}; if (!m) return JSON.stringify({ open: false });
  const nav = m.querySelector('nav[aria-label="Console sections"]');
  const rows = nav ? [...nav.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect();
    return { label: (b.textContent || '').trim(), h: Math.round(r.height), w: Math.round(r.width), visible: visible(b), current: b.getAttribute('aria-current') }; }) : [];
  const help = [...m.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === 'Help').map(b => Math.round(b.getBoundingClientRect().height));
  const mr = m.getBoundingClientRect();
  return JSON.stringify({ open: true, modal: m.getAttribute('aria-modal'), hasNav: !!nav, rows, help, box: { top: Math.round(mr.top), bottom: Math.round(mr.bottom), left: Math.round(mr.left), w: Math.round(mr.width) } });
})()`;

const GEOMETRY = `(() => {
  const main = document.querySelector('main'); const h1 = document.querySelector('h1');
  const b = ${BURGER}; const br = b ? b.getBoundingClientRect() : null; const hr = h1 ? h1.getBoundingClientRect() : null;
  return JSON.stringify({ vw: innerWidth, vh: innerHeight,
    mainTop: main ? Math.round(main.getBoundingClientRect().top) : null,
    mainHeight: main ? Math.round(main.getBoundingClientRect().height) : null,
    burger: br ? { w: Math.round(br.width), h: Math.round(br.height), top: Math.round(br.top) } : null,
    heading: h1 ? { text: (h1.textContent || '').trim(), w: Math.round(hr.width), h: Math.round(hr.height), top: Math.round(hr.top), visible: hr.width > 1 && hr.height > 1 && hr.right <= innerWidth && hr.left >= 0 } : null });
})()`;

test('CONTROL: the console reached its dashboard at 360x730 with ☰ in the header — without which nothing below proves anything',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    assert.equal(booted, 'ok', 'the "Start a new church" button was never found');
    const v = JSON.parse(await evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
    assert.deepEqual(v, { w: VW, h: VH }, 'the viewport is not the phone we claim to be measuring');
    const st = await menuState();
    assert.equal(st.burger, true, 'no control named "Sections" in the header — this is not the phone dashboard, so every measurement below is of the wrong screen');
    assert.equal(st.open, false, 'the sections menu is open before anyone pressed ☰');
    // the wizard is off, or ☰ would (rightly) refuse to open — see the note in before()
    const wizard = await evalIn(`(() => !!document.querySelector('[data-stew-modal-panel]'))()`);
    assert.equal(wizard, false, 'the first-run wizard is on screen; this file keeps it off (see before()) because ☰ does nothing under a modal');
    assert.deepEqual(errors, [], 'the console threw while reaching its dashboard:\n  ' + errors.join('\n  '));
  });

test('before ☰ is pressed, the chrome names the CURRENT section and none of the others',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    // THE OWNER'S STATED COST OF A HAMBURGER IS DISCOVERABILITY, and this is the mitigation: you can read where
    // you are without opening anything. The other nine names are behind the menu — not merely small.
    const names = JSON.parse(await evalIn(CHROME_NAMES));
    const g = JSON.parse(await evalIn(GEOMETRY));
    // the headline first: the other nine are NOT on screen (measured red against the pills, 2026-09-19:
    // all nine listed as visible buttons)
    const others = Object.keys(names).filter(n => n !== 'Overview');
    assert.deepEqual(others, [], 'these section names are visible in the chrome with the menu closed — that is the pill strip, not a menu: ' + JSON.stringify(names));
    assert.equal(await evalIn(`!!document.querySelector('nav[aria-label="Console sections"]')`), false,
      'the section list is in the DOM with the menu closed — hidden is not the same as behind a menu');
    // …and the current one IS, as the page heading, on screen — not the 1x1 clipped heading the pills had
    assert.equal(g.heading && g.heading.text, 'Overview', 'the page heading does not name the section on screen: ' + JSON.stringify(g.heading));
    assert.equal(g.heading.visible, true, 'the section name is in the DOM but not on the screen: ' + JSON.stringify(g.heading));
    assert.ok(names.Overview && names.Overview.includes('h1'), 'the current section\'s name is not visible in the chrome: ' + JSON.stringify(names));
  });

test(`the church's content starts within ${MAIN_TOP_BUDGET}px of the top of a 360x730 phone`,
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    const g = JSON.parse(await evalIn(GEOMETRY));
    assert.ok(g.mainTop !== null, 'no <main> on screen — this is not the dashboard');
    // Measured on this branch: 57 (6px gutter + 44px row + 6px gutter + 1px rule). It was 235 on the Oppo.
    assert.ok(g.mainTop <= MAIN_TOP_BUDGET,
      `<main> starts ${g.mainTop}px down a ${VH}px phone, over the ${MAIN_TOP_BUDGET}px budget. ${g.mainHeight}px left for the church. ` +
      'The pills were 235px; the whole point of the menu is this number.');
    assert.ok(g.burger && g.burger.w >= 44 && g.burger.h >= 44, `☰ is ${JSON.stringify(g.burger)} — under the 44px a thumb needs`);
    console.log(`    measured: main.top = ${g.mainTop}px at ${VW}x${VH}; ☰ ${g.burger.w}x${g.burger.h}; heading "${g.heading.text}" ${g.heading.w}x${g.heading.h}`);
    // …and in landscape, where the pills took over two-thirds of the height
    try {
      await send('Emulation.setDeviceMetricsOverride', { width: LW, height: LH, deviceScaleFactor: 2, mobile: true });
      await sleep(1200);
      const l = JSON.parse(await evalIn(GEOMETRY));
      assert.deepEqual({ w: l.vw, h: l.vh }, { w: LW, h: LH });
      assert.ok(l.mainTop <= MAIN_TOP_BUDGET, `<main> starts ${l.mainTop}px down a ${LH}px landscape phone`);
      console.log(`    measured: main.top = ${l.mainTop}px at ${LW}x${LH}; ${l.mainHeight}px of content height`);
    } finally {
      await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
      await sleep(1200);
    }
  });

test('the header\'s icon buttons are named and 44px', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  // They were 35x31 (Invite code, New post) and 32x32 (the avatar) with `title` as their only name — a
  // tooltip a touch screen never shows. Read by accessible name, measured by rect.
  const boxes = JSON.parse(await evalIn(`(() => { const out = {};
    for (const name of ['Sections', 'Invite code', 'New post', 'Settings']) {
      const bs = [...document.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === name && !b.closest('[role="dialog"]'));
      out[name] = bs.map(b => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; });
    } return JSON.stringify(out); })()`));
  for (const [name, bs] of Object.entries(boxes)) {
    assert.equal(bs.length, 1, `${bs.length} header controls named "${name}" — need exactly one: ` + JSON.stringify(boxes));
    assert.ok(bs[0].w >= 44 && bs[0].h >= 44, `"${name}" is ${bs[0].w}x${bs[0].h}px — under the 44px a thumb needs`);
  }
  // all in ONE row: the chrome budget above is bought by a single 44px row, not by stacking
  const tops = Object.values(boxes).map(b => b[0].top);
  assert.ok(Math.max(...tops) - Math.min(...tops) <= 2, 'the header controls are not on one row: ' + JSON.stringify(boxes));
});

test('pressing ☰ opens a dialog listing every section, 44px each, the current one marked; picking Members lands there and closes it',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    await press(BURGER);
    const st = await menuState();
    assert.equal(st.open, true, 'pressing ☰ opened no [role=dialog] named "Sections"');
    assert.equal(st.expanded, 'true', `☰ says aria-expanded=${st.expanded} with its menu open`);
    assert.equal(st.controls, st.menuId, `☰ aria-controls="${st.controls}" but the menu's id is "${st.menuId}"`);
    const m = JSON.parse(await evalIn(MENU_ROWS));
    assert.equal(m.modal, 'true', 'the menu is not aria-modal');
    assert.equal(m.hasNav, true, 'the menu holds no nav[aria-label="Console sections"] — the landmark went with the pills');
    const labels = m.rows.map(r => r.label.replace(/\s+/g, ' '));
    // the same sections in the same order as the sidebar has always had them (capability-gated ones may be absent)
    const expectOrder = ALL.filter(n => labels.includes(n));
    assert.ok(labels.length >= 8, `the menu lists ${labels.length} sections: ${JSON.stringify(labels)}`);
    assert.deepEqual(labels, expectOrder, 'the menu\'s sections are not in the sidebar\'s order: ' + JSON.stringify(labels));
    for (const r of m.rows) {
      assert.equal(r.visible, true, `"${r.label}" is in the menu but not visible`);
      assert.ok(r.h >= 44, `"${r.label}" is ${r.h}px tall in the menu — under the 44px a thumb needs`);
    }
    assert.deepEqual(m.rows.filter(r => r.current === 'page').map(r => r.label), ['Overview'], 'the current section is not the one marked aria-current="page"');
    assert.deepEqual(m.help, [m.help[0]], 'Help is not in the menu exactly once');
    assert.ok(m.help[0] >= 44, `Help is ${m.help[0]}px tall in the menu`);
    assert.equal(m.box.left, 0, 'the drawer does not sit against the left edge: ' + JSON.stringify(m.box));
    assert.equal(await evalIn(`!!document.querySelector('main h2') && [...document.querySelectorAll('main h2')].some(h => (h.textContent||'').trim() === 'Members')`), false,
      'a "Members" panel heading is already in <main> on Overview — the landing check below would prove nothing');

    // pick Members
    await press(`[...${MENU}.querySelectorAll('nav button')].find(b => (b.textContent || '').trim() === 'Members')`);
    await sleep(2000);
    const after = await menuState();
    assert.equal(after.open, false, 'picking a section did not close the menu');
    assert.equal(after.expanded, 'false', `☰ says aria-expanded=${after.expanded} after the menu closed`);
    const g = JSON.parse(await evalIn(GEOMETRY));
    assert.equal(g.heading.text, 'Members', 'the header does not name the section just picked: ' + JSON.stringify(g.heading));
    const landed = await evalIn(`[...document.querySelectorAll('main h2')].some(h => (h.textContent||'').trim() === 'Members')`);
    assert.equal(landed, true, 'picking Members in the menu did not render the Members pane');
    // …and the chrome now names Members, not Overview
    const names = JSON.parse(await evalIn(CHROME_NAMES));
    assert.deepEqual(Object.keys(names), ['Members'], 'the chrome names the wrong section after the pick: ' + JSON.stringify(names));
    assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
  });

test('Escape, the backdrop, and the × each close the menu', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  for (const [how, close] of [
    ['Escape', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`],
    ['the backdrop', `${MENU}.parentElement.click()`],
    ['the × button', `${MENU}.querySelector('button[aria-label="Close sections"]').click()`],
  ]) {
    await press(BURGER);
    assert.equal((await menuState()).open, true, `☰ did not open the menu (before trying ${how})`);
    await evalIn(close);
    await sleep(600);
    const st = await menuState();
    assert.equal(st.open, false, `${how} did not close the menu`);
    assert.equal(st.expanded, 'false', `☰ says aria-expanded=${st.expanded} after ${how} closed the menu`);
  }
});

test('the phone\'s Back button closes the menu, and the listener goes with it', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  // A fake Capacitor App plugin, present only for this test: the menu registers a `backButton` listener on
  // mount and must remove it on unmount, or every later Back press would call into a menu that is gone.
  await evalIn(`(() => { window.__backListeners = []; window.Capacitor = { Plugins: { App: { addListener: (name, fn) => { const e = { name, fn };
    window.__backListeners.push(e); return { remove: () => { const i = window.__backListeners.indexOf(e); if (i >= 0) window.__backListeners.splice(i, 1); } }; } } } }; return 'ok'; })()`);
  try {
    await press(BURGER);
    assert.equal((await menuState()).open, true, '☰ did not open the menu');
    const listening = await evalIn(`window.__backListeners.filter(e => e.name === 'backButton').length`);
    assert.equal(listening, 1, `the open menu registered ${listening} backButton listeners — expected exactly one`);
    await evalIn(`window.__backListeners.filter(e => e.name === 'backButton').forEach(e => e.fn())`);
    await sleep(600);
    assert.equal((await menuState()).open, false, 'the Back button did not close the menu');
    const left = await evalIn(`window.__backListeners.filter(e => e.name === 'backButton').length`);
    assert.equal(left, 0, `${left} backButton listeners still registered after the menu closed — the cleanup did not run`);
  } finally {
    await evalIn(`(() => { delete window.Capacitor; delete window.__backListeners; return 'ok'; })()`);
  }
});

test('while another dialog is open, ☰ does nothing', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  // PINNED: the open dialog keeps the screen. The alternative — the menu opening underneath a fixed overlay
  // and taking the top of the Escape stack while invisible — is worse than either. On the phone a finger
  // cannot reach ☰ under a dialog anyway; this is the answer for a key, a script, or an assistive tool.
  await press(`[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'New post')`);
  await sleep(900);
  const dlg = await evalIn(`(() => { const d = [...document.querySelectorAll('[role="dialog"]')].filter(x => x.getAttribute('aria-label') !== 'Sections'); return d.length ? (d[0].innerText || '').trim().slice(0, 20) : ''; })()`);
  assert.ok(dlg.startsWith('New post'), `the New post dialog did not open (saw ${JSON.stringify(dlg)}) — the guard below would be tested against nothing`);
  await press(BURGER);
  const st = await menuState();
  assert.equal(st.open, false, 'pressing ☰ opened the sections menu on top of / under an open dialog');
  assert.equal(st.expanded, 'false', `☰ says aria-expanded=${st.expanded} while a dialog is up`);
  const still = await evalIn(`[...document.querySelectorAll('[role="dialog"]')].filter(x => x.getAttribute('aria-label') !== 'Sections').length`);
  assert.equal(still, 1, 'the New post dialog is gone — ☰ closed it instead of doing nothing');
  await evalIn(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(700);
  assert.equal(await evalIn(`document.querySelectorAll('[role="dialog"]').length`), 0, 'the New post dialog did not close on Escape — the next test starts under it');
  // and once it is closed, ☰ works again
  await press(BURGER);
  assert.equal((await menuState()).open, true, '☰ stayed dead after the dialog closed');
  await evalIn(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(600);
});

test('in landscape (730x328) every section and Help are reachable by scrolling the drawer', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  // Only four rows fit a 328px-tall screen. The first cut of the drawer scrolled the LIST inside a fixed box,
  // which ended cleanly on "Calendar" with Help pinned under it and nothing to say five sections were below;
  // now the panel itself scrolls, so the fold lands mid-row. This proves the far end is reachable, not just
  // present: scroll the dialog to its bottom and read where the last section and Help are.
  try {
    await send('Emulation.setDeviceMetricsOverride', { width: LW, height: LH, deviceScaleFactor: 2, mobile: true });
    await sleep(1200);
    await press(BURGER);
    const r = JSON.parse(await evalIn(`(() => { const m = ${MENU}; if (!m) return JSON.stringify({ open: false });
      const rows = [...m.querySelectorAll('nav button')]; const last = rows[rows.length - 1];
      const help = [...m.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Help');
      const before = { last: Math.round(last.getBoundingClientRect().bottom), help: Math.round(help.getBoundingClientRect().bottom) };
      m.scrollTop = m.scrollHeight;
      const after = { last: Math.round(last.getBoundingClientRect().bottom), help: Math.round(help.getBoundingClientRect().bottom), lastLabel: (last.textContent || '').trim() };
      return JSON.stringify({ open: true, rows: rows.length, canScroll: m.scrollHeight > m.clientHeight + 1, before, after, vh: innerHeight }); })()`));
    assert.equal(r.open, true, '☰ did not open the menu in landscape');
    assert.ok(r.rows >= 8, `the landscape menu lists ${r.rows} sections`);
    assert.equal(r.canScroll, true, `the drawer does not scroll at ${LH}px tall, so whatever is below the fold is unreachable: ` + JSON.stringify(r));
    assert.ok(r.after.last <= r.vh && r.after.help <= r.vh,
      `after scrolling the drawer to its end, "${r.after.lastLabel}" ends at y=${r.after.last} and Help at y=${r.after.help} on a ${r.vh}px screen — not reachable`);
    console.log(`    measured: landscape drawer scrolls ${r.before.help - r.after.help}px; Help bottom ${r.before.help} → ${r.after.help} of ${r.vh}`);
    await evalIn(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(600);
    assert.equal((await menuState()).open, false, 'Escape did not close the landscape menu');
  } finally {
    await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
    await sleep(1200);
  }
});

test('at 1280 wide the desktop sidebar is unchanged: no ☰, the same sections in the same order, Help in the sidebar',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    try {
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(1500);
      const d = JSON.parse(await evalIn(`(() => { ${VISIBLE}
        const nav = document.querySelector('nav[aria-label="Console sections"]');
        const rows = nav ? [...nav.querySelectorAll('button')].map(b => (b.textContent || '').trim().replace(/\\s+/g, ' ')) : null;
        const help = [...document.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === 'Help' && visible(b)).length;
        return JSON.stringify({ burger: !!${BURGER}, menu: !!${MENU}, navVisible: nav ? visible(nav) : false, rows, help }); })()`));
      assert.equal(d.burger, false, 'the desktop layout grew a ☰ — the hamburger is the phone\'s');
      assert.equal(d.menu, false);
      assert.equal(d.navVisible, true, 'the desktop sidebar\'s section list is not on screen');
      // THE SNAPSHOT. This church is an owner console with Finance granted and Check-in off, so nine sections.
      assert.deepEqual(d.rows, ['Overview', 'Groups', 'Rota', 'Calendar', 'Rooms', 'Resources', 'Members', 'Finance', 'Settings'],
        'the desktop sidebar\'s sections changed: ' + JSON.stringify(d.rows));
      assert.equal(d.help, 1, `the desktop sidebar shows ${d.help} Help controls — it has always shown one`);
    } finally {
      await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
      await sleep(1200);
    }
  });
