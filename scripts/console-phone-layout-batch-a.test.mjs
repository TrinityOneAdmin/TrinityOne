// THE PHONE LAYOUT BATCH (P11a): seven things a steward meets every day on a 360px console, each one a
// screenshot and a measurement in TrinityOne-internal/UI-AUDIT-console-2026-09-19.md §E, each one a row here.
//   Run: node --test scripts/console-phone-layout-batch-a.test.mjs
//
//   2. Settings → Relays row — the chips wrap; nothing in a relay row is off the right edge of the screen.
//   3. Wizard "Your regular meetings" — day / time / recurrence wrap; every select is on screen and hittable.
//   7. Picking "Settings" from ☰ while inside a settings page returns to the settings index.
//
// ── WHY A BROWSER, AND WHAT IS REAL ──────────────────────────────────────────────────────────────────────
// Same instrument as scripts/dialog-footers-stay-in-reach-on-a-phone.test.mjs: the real steward.html off the
// real gateway, in Chromium at exactly the Oppo CPH2477's CSS pixels (360x730, and 730x328 where it
// matters), driven down the real "Start a new church" path, every dialog opened by the control a steward
// would press. Every claim is a rect, a hit test, a computed style or a visible node — nothing here matches
// text in app/*.jsx (CLAUDE.md rule 3). Rows 1 and 2 seed what they measure through the console's own
// caches and events (a member in the roster cache; a recorded relay refusal) and each says so beside the
// seed; the fixture church has no members and its writes are refused (see before()), so the crowded rows the
// audit photographed cannot arise here by themselves.
//
// ── ORDER ────────────────────────────────────────────────────────────────────────────────────────────────
// The wizard is measured FIRST, because it is only reachable with the first-run wizard up and ☰ does nothing
// under a modal; then `wizard.done` is set, the page reloaded and unlocked with the PIN, exactly as the
// dialog-footers file does, and the dashboard rows follow.
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
const PORT = 8868, CDP = 9368;   // 88xx: 8862 fits-a-360px-phone, 8864 sections-behind-a-menu, 8866 dialog-footers; 93xx taken: 9350-9358, 9360-9364, 9366, 9367, 9371, 9381, 9412
const ROOT = new URL('..', import.meta.url).pathname;
const VW = 360, VH = 730, LW = 730, LH = 328;
const PIN = 'cedar-harbour-lamp-42';
const GUTTER = 16;      // the one side margin every phone dialog gets (steward.html, "ONE SIDE MARGIN FOR EVERY DIALOG ON A PHONE")
const FLOOR = 44;       // the codebase's touch floor
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
const setInput = (sel, val) => `(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;

before(async () => {
  if (!CHROME) return;
  await requireFreePort(PORT, 'console-phone-layout-batch-a.test.mjs');
  await requireFreePort(CDP, 'console-phone-layout-batch-a.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-batch-a-'));
  // A THROWAWAY church, never a real npub, and chromium pointed at a black hole for the production hosts: the
  // console dials CANONICAL_RELAYS regardless of who served the page (see app-boots.test.mjs). Pinned to
  // ANOTHER church on purpose, like the sibling files: that is the state the Oppo was photographed in, and the
  // one in which every dialog under test is the real one (dialog-footers' before() records the two set-ups
  // that lose a dialog). The cost: this church's writes are refused, so the console raises banners of its own
  // (dismissed and recorded where a row meets one) and nothing here can be seeded through a publish.
  const cp = getPublicKey(generateSecretKey());
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-batch-a-chr-' + process.pid);
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
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };

  // the real path to a real dashboard, with the first-run wizard left up (row 3 is inside it)
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
const SKIP = { skip: !CHROME ? 'no chromium' : false, timeout: 300000 };
const setSize = async (w, h) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await sleep(900); };
const escape = async () => { await evalIn(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(600); };
const closeAll = async () => { for (let i = 0; i < 3 && await evalIn(`document.querySelectorAll('[role="dialog"]').length`); i++) await escape(); };
const dismissBanners = async () => { await evalIn(`(() => { [...document.querySelectorAll('[role="alert"] button[aria-label^="Dismiss"]')].forEach(b => b.click()); return 'ok'; })()`); await sleep(300); };
const WIZ = '[data-stew-modal-panel]';
const DLG = `[...document.querySelectorAll('[role="dialog"]')].filter(p => p.getAttribute('aria-label') !== 'Sections').pop()`;

async function openMenu() {
  const r = await evalIn(`(() => { const b = document.querySelector('button[aria-label="Sections"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', 'no ☰ ("Sections") control in the console\'s header — re-anchor this test');
  await sleep(700);
}
async function pickSection(label) {
  const r = await evalIn(`(() => { const b=[...document.querySelectorAll('[role="dialog"][aria-label="Sections"] nav[aria-label="Console sections"] button')].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(label)})); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" row in the console's sections menu — re-anchor this test`);
  await sleep(2000);
  assert.equal(await evalIn(`!document.querySelector('[role="dialog"][aria-label="Sections"]')`), true, 'picking a section left the menu open over it');
}
async function openTab(label) { await openMenu(); await pickSection(label); }
async function openSettingsPage(name) {
  await openTab('Settings');
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
// The settings index vs. a settings page, read from the DOM: on a phone they are never on screen together,
// and the page carries the "All settings" back control (button.set-back) while the index is the named nav.
const SETTINGS_VIEW = `(() => { const nav = document.querySelector('nav[aria-label="Settings pages"]'); const back = document.querySelector('button.set-back');
  const r = nav ? nav.getBoundingClientRect() : null;
  return JSON.stringify({ index: !!nav && r.height > 1 && r.width > 1, rows: nav ? nav.querySelectorAll('button').length : 0, page: !!back }); })()`;

// ── CONTROL ───────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the console reached its dashboard at 360x730 with the first-run wizard on screen — without which nothing below proves anything', SKIP, async () => {
  assert.equal(booted, 'ok', 'the "Start a new church" button was never found');
  const v = JSON.parse(await evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
  assert.deepEqual(v, { w: VW, h: VH }, 'the viewport is not the phone we claim to be measuring');
  assert.equal(await evalIn(`!!document.querySelector('${WIZ}')`), true, 'the first-run wizard is not on screen; row 3 lives inside it');
  assert.deepEqual(errors, [], 'the console threw while reaching its dashboard:\n  ' + errors.join('\n  '));
});

// ── 3. the wizard's meetings step ─────────────────────────────────────────────────────────────────────────
test('3. wizard "Your regular meetings": every select is on screen at 360x730 and 730x328, and the first recurrence select is hittable on a 4px grid', SKIP, async () => {
  // Measured on the Oppo 2026-09-19 (p/here/01-11-wizard-meetings.png): the Weekly/Fortnightly/Monthly select
  // at x 334→460 in a 360px viewport, 0 of its 26 columns on screen. The walk: name the church → the twelve
  // words (tick the box, answer the three-word check from the phrase the console holds — a harness affordance,
  // the check itself is not under test) → the PIN step steps aside because a PIN is already set → untick the
  // three starter rooms so the step can be skipped without a publish (writes are refused here) → meetings.
  const title = () => evalIn(`(() => { const p = document.querySelector('${WIZ}'); return p ? (p.innerText || '').trim().split('\\n')[0].slice(0, 40) : ''; })()`);
  const press = async (label) => {
    const r = await evalIn(`(() => { const b = [...document.querySelector('${WIZ}').querySelectorAll('button')].find(x => (x.textContent || '').trim().startsWith(${JSON.stringify(label)})); if (!b || b.disabled) return 'miss'; b.click(); return 'ok'; })()`);
    assert.equal(r, 'ok', `no enabled "${label}" button in the wizard (on "${await title()}")`);
  };
  assert.match(await title(), /Welcome/, 're-anchor: the wizard is not on its first step');
  assert.equal(await evalIn(type('Your church’s name', 'St Aidan of the Selects')), 'ok', 're-anchor: no church-name field on step 0');
  await sleep(300); await press('Continue'); await sleep(3500);
  assert.match(await title(), /recovery key/i, 're-anchor: Continue on step 0 did not reach the recovery-key step');
  assert.equal(await evalIn(`(() => { const c = document.querySelector('${WIZ} input[type="checkbox"]'); if (!c) return 'miss'; c.click(); return 'ok'; })()`), 'ok', 're-anchor: no "I’ve written these down" box on the recovery-key step');
  await sleep(500);
  const words = String(await evalIn(`window.Steward.exportMnemonic()`) || '').trim().split(/\s+/);
  assert.equal(words.length, 12, 're-anchor: the console holds no 12-word phrase to answer the check with');
  const asks = JSON.parse(await evalIn(`JSON.stringify([...document.querySelectorAll('${WIZ} input[aria-label^="Word "]')].map(i => i.getAttribute('aria-label')))`));
  assert.equal(asks.length, 3, 're-anchor: the recovery-key check does not ask three words: ' + JSON.stringify(asks));
  for (const label of asks) { const n = parseInt(label.replace('Word ', ''), 10); assert.equal(await evalIn(setInput(`${WIZ} input[aria-label="${label}"]`, words[n - 1])), 'ok'); }
  await sleep(400); await press('Continue'); await sleep(1500);
  assert.match(await title(), /spaces/i, 're-anchor: the PIN step did not step aside (a PIN is already set) — did not reach "Create a few spaces"');
  for (const nm of ['Whole Church', 'Notices', 'Prayer']) {
    assert.equal(await evalIn(`(() => { const b = [...document.querySelectorAll('${WIZ} button')].find(x => (x.textContent||'').trim().startsWith(${JSON.stringify(nm)})); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', `re-anchor: no "${nm}" starter to untick`);
  }
  await sleep(300); await press('Skip for now'); await sleep(1500);
  assert.match(await title(), /regular meetings/i, 're-anchor: did not reach "Your regular meetings"');

  const MEASURE = `(() => { const p = document.querySelector('${WIZ}'); if (!p) return JSON.stringify({ found: false });
    const fields = [...p.querySelectorAll('select, input[type="time"]')].map(s => { const r = s.getBoundingClientRect();
      let hit = 0, total = 0;
      for (let y = Math.ceil(r.top) + 1; y < Math.floor(r.bottom); y += 4) for (let x = Math.ceil(r.left) + 1; x < Math.floor(r.right); x += 4) { total++; const e = document.elementFromPoint(x, y); if (e && (e === s || s.contains(e))) hit++; }
      // THE FIELD'S OWN WIDTH: a clone laid out off-flow at width:auto, beside the original so it inherits the
      // same font. A select narrower than this clips its longest option — "on screen" but unreadable, which
      // is the overflow defect wearing a different hat and the reason the fix wraps rather than shrinks.
      const c = s.cloneNode(true); c.style.position = 'absolute'; c.style.left = '-9999px'; c.style.width = 'auto'; c.style.flex = 'none'; c.style.minWidth = '0';
      s.parentElement.appendChild(c); const intrinsic = c.getBoundingClientRect().width; c.remove();
      return { tag: s.tagName, type: s.type, value: s.value, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), w: Math.round(r.width), intrinsic: Math.round(intrinsic), reach: total ? hit / total : 0 }; });
    return JSON.stringify({ found: true, vw: innerWidth, fields }); })()`;
  const m = JSON.parse(await evalIn(MEASURE));
  assert.equal(m.found, true);
  const recur = m.fields.filter(f => f.tag === 'SELECT' && /^(weekly|fortnightly|monthly)$/.test(f.value));
  assert.ok(recur.length >= 1, 're-anchor: no recurrence select on the meetings step: ' + JSON.stringify(m.fields));
  for (const f of m.fields) {
    assert.ok(f.right <= m.vw && f.left >= 0, `a ${f.tag} (${f.value}) on the meetings step spans x ${f.left}→${f.right} in a ${m.vw}px viewport — off the screen. ${JSON.stringify(m.fields)}`);
    assert.ok(f.w >= f.intrinsic - 1, `a ${f.tag} (${f.value}) is ${f.w}px wide against the ${f.intrinsic}px its own text needs — squeezed onto the line instead of wrapped, so its longest option is clipped`);
  }
  // the first row's recurrence select, in view when the step opens: at least 90% of a 4px grid over it returns it
  assert.ok(recur[0].reach >= 0.9, `only ${Math.round(recur[0].reach * 100)}% of the first recurrence select's grid points reach it (x ${recur[0].left}→${recur[0].right}, y ${recur[0].top})`);
  console.log(`    measured at ${m.vw}: ` + m.fields.slice(0, 3).map(f => `${f.tag.toLowerCase()} ${f.value} x ${f.left}→${f.right} y ${f.top}`).join(' | '));
  // …and in landscape, where the card is wider and nothing may fall off either
  try {
    await setSize(LW, LH);
    const l = JSON.parse(await evalIn(MEASURE));
    assert.equal(l.vw, LW);
    for (const f of l.fields) { assert.ok(f.right <= l.vw && f.left >= 0, `landscape: a ${f.tag} (${f.value}) spans x ${f.left}→${f.right} in ${l.vw}px`); assert.ok(f.w >= f.intrinsic - 1, `landscape: a ${f.tag} (${f.value}) is ${f.w}px against its own ${f.intrinsic}px`); }
    console.log(`    measured at ${l.vw}: ` + l.fields.slice(0, 3).map(f => `${f.tag.toLowerCase()} ${f.value} x ${f.left}→${f.right} y ${f.top}`).join(' | '));
  } finally { await setSize(VW, VH); }
  assert.deepEqual(errors, [], 'the console threw during the wizard:\n  ' + errors.join('\n  '));
});

// ── leave the wizard behind ───────────────────────────────────────────────────────────────────────────────
test('the wizard can be put away for the rest of this file: reload, unlock with the PIN, dashboard with no modal up', SKIP, async () => {
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
  await send('Page.reload', { ignoreCache: false });
  let locked = 'miss';   // POLL for the lock screen (dialog-footers explains why a fixed sleep is not enough under load)
  for (const t0 = Date.now(); locked !== 'ok' && Date.now() - t0 < 90000;) { await sleep(500); locked = await evalIn(type('Your PIN or passphrase', PIN)); }
  assert.equal(locked, 'ok', 'after the reload there is no PIN field within 90s — the console did not come back locked on this church');
  await evalIn(click('/^Unlock/i'));
  await sleep(12000);
  assert.equal(await evalIn(`!!document.querySelector('${WIZ}')`), false, 'the wizard is still up after the reload — the flag did not take');
  assert.equal(await evalIn(`!!document.querySelector('button[aria-label="Sections"]')`), true, 'no ☰ in the header after unlocking — this is not the phone dashboard');
  assert.equal(await evalIn(`document.querySelectorAll('[role="dialog"]').length`), 0, 'a dialog is already open on the unlocked dashboard');
  assert.deepEqual(errors, [], 'the console threw while reloading:\n  ' + errors.join('\n  '));
});

// ── 7. re-picking Settings returns to the index ───────────────────────────────────────────────────────────
test('7. inside a settings page, picking "Settings" from ☰ — and tapping the avatar — returns to the settings index', SKIP, async () => {
  // The audit's instrument lost six captures to this: on the Oppo the Settings pill did nothing while a
  // settings page was open, and only the small "All settings" link led back. Same pill, now a drawer row.
  await openSettingsPage('Church key');
  let v = JSON.parse(await evalIn(SETTINGS_VIEW));
  assert.equal(v.page, true, 're-anchor: opening "Church key" did not open a settings page (no "All settings" control)');
  assert.equal(v.index, false, 're-anchor: the settings index is on screen beside the page — this is not the phone layout');
  await openTab('Settings');
  v = JSON.parse(await evalIn(SETTINGS_VIEW));
  assert.equal(v.index, true, `picking Settings from ☰ while on a settings page did NOT return to the index: ${JSON.stringify(v)}`);
  assert.equal(v.page, false, `the settings page is still open after re-picking Settings: ${JSON.stringify(v)}`);
  assert.ok(v.rows >= 10, `the index lists ${v.rows} rows — not the settings list`);
  // the avatar in the header is the other "Settings" control on the phone
  await openSettingsPage('Relays');
  assert.equal(JSON.parse(await evalIn(SETTINGS_VIEW)).page, true, 're-anchor: "Relays" did not open a settings page');
  await pressButton(`x.getAttribute('aria-label') === 'Settings' && !x.closest('[role="dialog"]')`, 'Settings (the avatar)');
  v = JSON.parse(await evalIn(SETTINGS_VIEW));
  assert.equal(v.index && !v.page, true, `tapping the avatar while on a settings page did not return to the index: ${JSON.stringify(v)}`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── 2. the relay row ──────────────────────────────────────────────────────────────────────────────────────
test('2. Settings → Relays: with a relay marked "refused", nothing in any relay row is past the right edge of a 360px screen', SKIP, async () => {
  // Measured on the Oppo 2026-09-19 (p/here/01-17-settings-relays-refusing-fix.png): the REFUSED chip ended at
  // x 349 past a card that ends ~325, and "Answering · 118ms" sat at x 358→442 — entirely off-screen. Re-measured
  // on this branch before the fix: the chip strip ran to x 609.
  // THE REFUSAL IS SEEDED the way the console records one (noteRelayRejection: the timestamp key, the per-url
  // list, and the event DashRelaysCard listens for), for every relay it lists, so every row carries the chip
  // the audit photographed. A harness affordance for the geometry, and nothing here claims the relays refused.
  await openSettingsPage('Relays');
  await sleep(2000);
  const urls = JSON.parse(await evalIn(`window.Steward.relayStatus().then(s => JSON.stringify(s.map(r => r.url)))`));
  assert.ok(urls.length >= 1, 're-anchor: the console lists no relays');
  await evalIn(`(() => { window.dispatchEvent(new CustomEvent('steward-relay-cleared'));
    localStorage.setItem(window.REG_NEEDED_LS, String(Date.now()));
    localStorage.setItem(window.REG_REFUSED_LS, JSON.stringify(${JSON.stringify(urls)}.map(u => ({ url: u, error: 'blocked: not this relay’s church', at: Date.now() }))));
    window.dispatchEvent(new CustomEvent('steward-relay-rejected')); return 'ok'; })()`);
  await sleep(800);
  const m = JSON.parse(await evalIn(`(() => {
    // a relay row is the card whose tooltip carries the relay's own refusal — the chip's row
    const rows = [...document.querySelectorAll('main [title^="This relay refused"]')];
    return JSON.stringify({ vw: innerWidth, rows: rows.map(row => { const r = row.getBoundingClientRect();
      const kids = [...row.querySelectorAll('*')].filter(e => e.getBoundingClientRect().width > 0);
      const over = kids.filter(e => e.getBoundingClientRect().right > innerWidth - 8 || e.getBoundingClientRect().left < 0)
        .map(e => ({ tag: e.tagName, text: (e.textContent || '').trim().slice(0, 28), left: Math.round(e.getBoundingClientRect().left), right: Math.round(e.getBoundingClientRect().right) }));
      const chips = kids.filter(e => e.classList.contains('sk-pill')).map(e => (e.textContent || '').trim());
      return { left: Math.round(r.left), right: Math.round(r.right), chips, over }; }) }); })()`));
  assert.ok(m.rows.length >= 1, 'no relay row carries the refusal — the seed did not take, so there is no crowded row to measure');
  for (const row of m.rows) {
    assert.ok(row.chips.some(c => /refused/i.test(c)), `a relay row has no "refused" chip; chips: ${JSON.stringify(row.chips)} — not the crowded row the audit measured`);
    assert.deepEqual(row.over, [], `these parts of a relay row are off the ${m.vw}px screen (card ${row.left}→${row.right}): ${JSON.stringify(row.over)}`);
  }
  console.log(`    measured: ${m.rows.length} relay rows at ${m.vw}px, chips ${JSON.stringify(m.rows[0].chips)}, nothing past x ${m.vw - 8}`);
  await evalIn(`(() => { window.dispatchEvent(new CustomEvent('steward-relay-cleared')); localStorage.removeItem(window.REG_NEEDED_LS); localStorage.removeItem(window.REG_REFUSED_LS); return 'ok'; })()`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── 1. the members row ────────────────────────────────────────────────────────────────────────────────────

// ── 5 + 6. the dialogs: one gutter, no ring ───────────────────────────────────────────────────────────────
// The twelve dialogs the audit measured, by the control that opens each, with the margin it had at 360
// (§E: 13, 11, 14, 16, 30, 30, 37, 16, 16, 18, 30) — plus New post, the header's own. Group leaders needs a
// group this church cannot create (writes are refused) and is not opened here; it shares the shape.
const DIALOGS = [
  { name: 'New team', was: 13, open: async () => { await openTab('Rota'); await pressButton(`(x.textContent||'').trim()==='New team'`, 'New team'); } },
  { name: 'New event', was: 11, open: async () => { await openTab('Calendar'); await pressButton(`(x.textContent||'').trim()==='New event'`, 'New event'); } },
  { name: 'Invite your church', was: 14, open: async () => { await pressButton(`x.getAttribute('aria-label')==='Invite code'`, 'Invite your church'); } },
  { name: 'Invite poster', was: 16, open: async () => { await pressButton(`x.getAttribute('aria-label')==='Invite code'`, 'Invite your church'); await pressButton(`(x.getAttribute('title')||'').startsWith('Show the invite poster')`, 'Invite poster'); } },
  { name: 'New group', was: 30, open: async () => { await openTab('Groups'); await pressButton(`(x.textContent||'').trim()==='New group'`, 'New group'); } },
  { name: 'Categories', was: 30, open: async () => { await openTab('Groups'); await pressButton(`(x.getAttribute('title')||'').startsWith('Create named categories')`, 'Categories'); } },
  { name: 'Change PIN', was: 37, open: async () => { await openSettingsPage('Church key'); await pressButton(`(x.textContent||'').trim().startsWith('Change PIN')`, 'Change PIN'); } },
  { name: 'Record a transaction', was: 16, open: async () => { await openTab('Finance'); await pressButton(`(x.textContent||'').trim()==='Record a transaction'`, 'Record'); } },
  { name: 'Import a bank statement', was: 16, open: async () => { await openTab('Finance'); await pressButton(`(x.textContent||'').trim()==='Import statement'`, 'Import'); } },
  { name: 'Help', was: 18, open: async () => { await openMenu(); await pressButton(`x.getAttribute('aria-label')==='Help' && x.closest('[role="dialog"]')`, 'Help'); } },
  { name: 'Bulk upload', was: 30, open: async () => { await openTab('Resources'); await pressButton(`(x.textContent||'').trim()==='Bulk upload'`, 'Bulk upload'); } },
  { name: 'New post', was: 14, open: async () => { await pressButton(`x.getAttribute('aria-label')==='New post'`, 'New post'); } },
];
const PANEL = `(() => { const p = ${DLG}; if (!p) return JSON.stringify({ found: false });
  const r = p.getBoundingClientRect(); const cs = getComputedStyle(p);
  return JSON.stringify({ found: true, label: p.getAttribute('aria-label'), vw: innerWidth, left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
    focused: document.activeElement === p, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth }); })()`;
const FOCUSED = `(() => { const a = document.activeElement; const cs = getComputedStyle(a);
  return JSON.stringify({ tag: a.tagName, label: (a.getAttribute('aria-label') || (a.textContent || '').trim()).slice(0, 24), inDialog: !!a.closest('[role="dialog"]'), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, focusVisible: a.matches(':focus-visible') }); })()`;
const tab = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await sleep(150);
};
const ringless = (p) => p.outlineStyle === 'none' || parseFloat(p.outlineWidth) === 0;
const focusedPanels = [];   // which dialogs focused their panel on open — the ones row 5 was asserted on



// ── 4. the banner's pills ─────────────────────────────────────────────────────────────────────────────────
