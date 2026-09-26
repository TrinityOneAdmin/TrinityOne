// THE PHONE LAYOUT BATCH (P11a): seven things a steward meets every day on a 360px console, each one a
// screenshot and a measurement in TrinityOne-internal/UI-AUDIT-console-2026-09-19.md §E, each one a row here.
//   Run: node --test scripts/console-phone-layout-batch-a.test.mjs
//
//   1. Members row — the NAME wins the width fight; the handle beside it is what truncates.
//   2. Settings → Relays row — the chips wrap; nothing in a relay row is off the right edge of the screen.
//   3. Wizard "Your regular meetings" — day / time / recurrence wrap; every select is on screen and hittable.
//   4. The error banner's Show and Collapse pills — Show is as tall as the docked strip (36px: the whole of
//      what exists without a taller strip), Collapse reaches 44 without growing or touching Dismiss.
//   5. No focus ring round a whole dialog on open; a real control inside still gets one from the keyboard.
//   6. One side margin (16px) for every dialog the audit measured, which had eight different ones.
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
  // EVERY GROUP OPEN, ONE PRESS PER ROUND TRIP. The four groups start SHUT off the phone app (DashSettings,
  // "OPEN ON THE PHONE, SHUT IN THE SUITE" — owner 2026-09-22, 362481d) and this Chromium is not Capacitor,
  // so all four are shut here however small the viewport. Until 2026-09-26 this line pressed them with a
  // single `forEach(b => b.click())`; MEASURED on this file that same day, that leaves exactly ONE open —
  // the last pressed — because all four handlers run inside one task and each closes over the same pre-click
  // `collapsed`, so the last write wins. The rows of the other three are then not rendered at all, which is
  // why this helper could still reach "Church key" (Security, pressed last) and could not reach
  // "Rules & privacy" (People). No steward can press four headers inside one task, so nothing here says the
  // screen is wrong; the HARNESS was.
  // Then ASSERT nothing is left shut, so a half-working harness can never again be read as a missing row.
  for (let i = 0; i < 8; i++) {
    const more = await evalIn(`(() => { const b = document.querySelector('nav[aria-label="Settings pages"] button.set-grp[aria-expanded="false"]'); if (!b) return 'done'; b.click(); return 'more'; })()`);
    if (more === 'done') break;
    await sleep(250);
  }
  const shut = await evalIn(`(() => [...document.querySelectorAll('nav[aria-label="Settings pages"] button.set-grp[aria-expanded="false"]')].map(b => ((b.querySelector('.set-grp-n') || {}).textContent || '')).join(', '))()`);
  assert.equal(shut, '', `the harness could not open these settings groups: ${shut}`);
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
test('1. Members: a 16-character name beside a 20-character handle shows at least 12 characters of the NAME; the handle is what gives way', SKIP, async () => {
  // Measured on the Oppo 2026-09-19 (full/portrait/07-members.png): the name ellipsed to "R…" while the handle
  // showed in full. At 360px the text column of a member row is ~128px (badge, two action buttons), so a
  // 16-character bold name does not fit whole either way; what changes is WHO shrinks. Visible characters are
  // read from the node itself: clientWidth over the per-character width of its full text (scrollWidth, which
  // an overflow-hidden span still reports in full).
  // THE MEMBER IS SEEDED through the roster cache the console paints from on mount (useStewardMembers /
  // subscribeMembers seed from `trinityone.steward.members.<church>` before the relay answers) — a harness
  // affordance; the church has no members and its writes are refused. Joined minutes ago so it is in the
  // active list, not the folded inactive one.
  const NAME = 'Persephone Wilde', HANDLE = 'persephonewilde_1234';
  assert.equal(NAME.length, 16); assert.equal(HANDLE.length, 20);
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.members.' + window.Steward.churchPub, JSON.stringify([{ pubkey: 'ab'.repeat(32), npub: 'npub1' + 'q'.repeat(58), name: ${JSON.stringify(NAME)}, nip05: ${JSON.stringify(HANDLE + '@example.org')}, picture: '', count: 0, lastTs: 0, firstTs: 0, joined: Math.floor(Date.now() / 1000) - 360 }])); return 'ok'; })()`);
  await openTab('Overview');
  await openTab('Members');
  await sleep(1500);
  const m = JSON.parse(await evalIn(`(() => {
    const name = [...document.querySelectorAll('main span')].find(s => (s.textContent || '').trim() === ${JSON.stringify(NAME)} && s.children.length === 0);
    if (!name) return JSON.stringify({ found: false });
    const line = name.parentElement;                          // name + handle, one line
    const card = line.closest('main div[style*="border-radius"], main div');   // the row card: the nearest bordered ancestor
    let el = line; while (el && el !== document.body && getComputedStyle(el).borderTopWidth === '0px') el = el.parentElement;
    const cr = el.getBoundingClientRect();
    // THE HANDLE MAY BE BENEATH THE NAME. Since P12 (2026-09-20) the phone row puts the handle on a second
    // line under the name, in the same text column; the desktop row keeps it beside the name. Look in the
    // column (the line's parent) so both shapes are found, and read each node's top/bottom to tell which.
    const col = line.parentElement;
    const handle = [...col.querySelectorAll('span')].find(s => s !== name && (s.textContent || '').includes('@' + ${JSON.stringify(HANDLE)}));
    const g = (n) => { const r = n.getBoundingClientRect(); return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), sw: n.scrollWidth, cw: n.clientWidth }; };
    const nm = g(name); const perChar = nm.sw / ${NAME.length};
    return JSON.stringify({ found: true, vw: innerWidth, card: { left: Math.round(cr.left), right: Math.round(cr.right) }, line: g(line),
      name: { ...nm, visibleChars: perChar ? Math.floor(nm.cw / perChar) : 0, whole: nm.sw <= nm.cw + 1 },
      handle: handle ? { ...g(handle), whole: handle.scrollWidth <= handle.clientWidth + 1 } : null }); })()`));
  assert.equal(m.found, true, 'the seeded member is not on the Members page — the roster cache seed did not paint');
  assert.ok(m.name.visibleChars >= 12,
    `the name shows ${m.name.visibleChars} of ${NAME.length} characters (${m.name.cw}px of ${m.name.sw}px) at ${m.vw}px — the name lost the width fight. Line ${m.line.left}→${m.line.right}, handle ${JSON.stringify(m.handle)}`);
  assert.ok(m.name.right <= m.card.right && m.name.left >= m.card.left, `the name spills past its card (${m.name.left}→${m.name.right} in ${m.card.left}→${m.card.right})`);
  assert.ok(m.handle, 're-anchor: no handle node beside the name');
  // the handle is the one that gives way: it is either truncated or has no room at all — never whole while
  // the name is not — or (the phone row since P12) it sits on its own line BENEATH the name, where there is
  // no fight to win: the name has the whole line and the handle its own.
  const beneath = m.handle.top >= m.name.bottom - 1;
  assert.ok(m.name.whole || !m.handle.whole || m.handle.w === 0 || beneath,
    `the handle is whole (${m.handle.w}px) beside the name while the name is cut (${m.name.visibleChars}/${NAME.length}) — the handle won the width fight`);
  console.log(`    measured: name ${m.name.visibleChars}/${NAME.length} chars in ${m.name.cw}px; handle ${m.handle.w}px${m.handle.whole ? ' (whole)' : ' (truncated)'}${beneath ? ', beneath the name' : ', beside it'}; line ${m.line.left}→${m.line.right} of card ${m.card.left}→${m.card.right}`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

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

for (const d of DIALOGS) {
  test(`6 + 5. ${d.name} at 360x730: ${GUTTER}px from each edge (was ${d.was}), no focus ring round the panel, and a Tab lands a ring on a real control`, SKIP, async () => {
    await closeAll(); await dismissBanners();
    assert.equal(await evalIn(`document.querySelectorAll('[role="dialog"]').length`), 0, 'a dialog is open that Escape does not close — nothing below can be measured');
    await d.open();
    await sleep(400);
    const p = JSON.parse(await evalIn(PANEL));
    assert.equal(p.found, true, `${d.name}: no dialog panel on screen`);
    // 6. the gutter — both edges, so a panel that is merely narrow and off-centre does not pass
    assert.ok(Math.abs(p.left - GUTTER) <= 1 && Math.abs((p.vw - p.right) - GUTTER) <= 1,
      `${d.name} ("${p.label}") sits ${p.left}px from the left and ${p.vw - p.right}px from the right of a ${p.vw}px screen — not the ${GUTTER}px every phone dialog gets (it was ${d.was})`);
    // 5. the ring. Dialogs whose first field takes focus itself never focus the panel; the ones that do are the
    // ones the audit photographed with a clay ring round the whole card. Asserted wherever the panel IS focused.
    if (p.focused) { focusedPanels.push(d.name); assert.ok(ringless(p), `${d.name}: the whole dialog is drawn with a ${p.outlineWidth} ${p.outlineStyle} focus ring on open`); }
    // …and the ring is still there for a keyboard: one Tab, and whatever it lands on inside the dialog shows one
    await tab();
    const f = JSON.parse(await evalIn(FOCUSED));
    assert.equal(f.inDialog, true, `${d.name}: Tab left the dialog (landed on ${f.tag} "${f.label}") — the focus trap is not the subject here but nothing below can be read`);
    assert.ok(f.outlineStyle !== 'none' && parseFloat(f.outlineWidth) >= 2,
      `${d.name}: after Tab the focused ${f.tag} "${f.label}" has no visible focus ring (${f.outlineWidth} ${f.outlineStyle}) — the panel fix took the ring off real controls too`);
    console.log(`    ${d.name}: ${p.left}px | ${p.vw - p.right}px (was ${d.was}); panel focused ${p.focused}${p.focused ? `, outline ${p.outlineStyle}` : ''}; Tab → ${f.tag} "${f.label}" ${f.outlineWidth} ${f.outlineStyle}`);
    await closeAll();
    assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
  });
}

test('5. the sections drawer takes focus on open and is drawn without a ring; the panels above that were focused numbered at least four', SKIP, async () => {
  // The drawer is a dialog too and was in the audit's list. And a control on this row: at least four of the
  // dialogs above must have focused their panel, or row 5 above asserted nothing (autoFocus fields take it
  // on the others — New team, New event, New group, Categories, Change PIN, New post).
  await closeAll();
  await openMenu();
  const p = JSON.parse(await evalIn(`(() => { const p = document.querySelector('[role="dialog"][aria-label="Sections"]'); if (!p) return JSON.stringify({ found: false }); const cs = getComputedStyle(p);
    return JSON.stringify({ found: true, focused: document.activeElement === p, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth }); })()`));
  assert.equal(p.found, true, '☰ did not open the sections drawer');
  assert.equal(p.focused, true, 'the drawer did not take focus on open — the ring claim below would be about nothing');
  assert.ok(ringless(p), `the sections drawer is drawn with a ${p.outlineWidth} ${p.outlineStyle} focus ring on open`);
  await escape();
  assert.ok(focusedPanels.length >= 4, `only ${focusedPanels.length} of the dialogs above focused their panel (${JSON.stringify(focusedPanels)}) — the no-ring claim was asserted on too few of them`);
  console.log(`    the no-ring claim was asserted on: ${focusedPanels.join(', ')}; the drawer`);
});

// ── 4. the banner's pills ─────────────────────────────────────────────────────────────────────────────────
test(`4. with a dialog up: the docked banner's Show target is the whole strip, and the expanded banner's Collapse reaches ${FLOOR}px without touching Dismiss`, SKIP, async () => {
  // Measured on this branch before the fix: Show 24px tall, Collapse 28px, against the codebase's 44px floor
  // (reference/UI-AUDIT-PLAN-console-apk.md §2 item 2 and §2b). Show cannot reach 44 without a taller strip —
  // the dialog-shortening rule in steward.html depends on the strip's height — so its claim is "every pixel of
  // the strip", and the strip's height is printed. Collapse sits in the expanded (tall) card and reaches 44
  // through an invisible ::before; the pill itself stays 28 so the sentence still wraps round it. Hit heights
  // are read with elementFromPoint down the pill's centre column, not from rects (§3 of that plan: a rect is
  // not the hit area).
  await closeAll(); await dismissBanners();
  await pressButton(`x.getAttribute('aria-label')==='New post'`, 'New post');
  assert.equal(await evalIn(`document.querySelectorAll('[role="dialog"]').length`), 1, 're-anchor: New post did not open');
  await evalIn(`(() => { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'group key', message: ${JSON.stringify(LONG)} } })); return 'ok'; })()`);
  await sleep(700);
  const HIT = (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return JSON.stringify({ found: false });
    const r = b.getBoundingClientRect(); const card = b.closest('[role="alert"]').getBoundingClientRect();
    const cx = Math.round((r.left + r.right) / 2); let top = null, bottom = null; const others = {};
    for (let y = Math.round(card.top) - 4; y <= Math.round(card.bottom) + 4; y++) { const e = document.elementFromPoint(cx, y); const mine = e && (e === b || b.contains(e)); if (mine) { if (top === null) top = y; bottom = y; } }
    // the whole extended box, for what ELSE answers there: nothing may be another button
    for (let y = Math.round(r.top) - 8; y < Math.round(r.bottom) + 8; y++) for (let x = Math.round(r.left); x < Math.round(r.right); x++) {
      const e = document.elementFromPoint(x, y); if (!e || e === b || b.contains(e)) continue; const o = e.closest('button'); if (o) { const k = 'BUTTON:' + (o.getAttribute('aria-label') || '').slice(0, 24); others[k] = (others[k] || 0) + 1; } }
    const visual = b.querySelector('span') ? Math.round(b.querySelector('span').getBoundingClientRect().height) : Math.round(r.height);
    return JSON.stringify({ found: true, rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }, hitTop: top, hitBottom: bottom, hitH: top === null ? 0 : bottom - top + 1,
      insideCard: top !== null && top >= Math.floor(card.top) && bottom <= Math.ceil(card.bottom), card: { top: Math.round(card.top), bottom: Math.round(card.bottom), h: Math.round(card.height) }, visual, others }); })()`;
  const s = JSON.parse(await evalIn(HIT('[role="alert"] button[aria-label="Show the whole message"]')));
  assert.equal(s.found, true, 'the docked banner has no Show pill');
  assert.equal(await evalIn(`document.documentElement.getAttribute("data-stew-banner")`), "clamped", 'the banner did not dock over the dialog');
  assert.ok(s.hitH >= s.card.h - 1, `Show's target is ${s.hitH}px tall down its centre (y ${s.hitTop}..${s.hitBottom}) in a ${s.card.h}px strip — not the whole strip`);
  assert.ok(s.hitH >= 36, `the docked strip is ${s.card.h}px and Show reaches ${s.hitH} — under the 36 this branch measured; the strip has shrunk`);
  assert.equal(s.insideCard, true, `Show's target leaves the painted card (y ${s.hitTop}..${s.hitBottom} vs card ${s.card.top}..${s.card.bottom}) — what answers outside it is the dialog's scrim`);
  assert.equal(s.visual, 24, `the Show pill the eye sees is ${s.visual}px — the visual grew instead of the target`);
  assert.deepEqual(s.others, {}, `another button answers inside Show's extended box: ${JSON.stringify(s.others)}`);
  await evalIn(`document.querySelector('[role="alert"] button[aria-label="Show the whole message"]').click()`);
  await sleep(700);
  const c = JSON.parse(await evalIn(HIT('[role="alert"] button[aria-label^="Collapse"]')));
  assert.equal(c.found, true, 'the expanded banner has no Collapse pill');
  assert.ok(c.hitH >= FLOOR, `Collapse's target is ${c.hitH}px tall down its centre (y ${c.hitTop}..${c.hitBottom}) — under the ${FLOOR}px floor`);
  assert.equal(c.insideCard, true, `Collapse's target leaves the painted card (y ${c.hitTop}..${c.hitBottom} vs card ${c.card.top}..${c.card.bottom})`);
  assert.equal(c.rect.h, 28, `the Collapse pill itself is ${c.rect.h}px — it grew, so the sentence wraps differently; the target was meant to grow, not the pill`);
  assert.deepEqual(c.others, {}, `another button answers inside Collapse's extended box — that is Dismiss stealing the edge: ${JSON.stringify(c.others)}`);
  console.log(`    measured: docked strip ${s.card.h}px, Show target ${s.hitH}px (pill ${s.visual}px); expanded card ${c.card.h}px, Collapse target ${c.hitH}px (pill ${c.rect.h}px)`);
  await dismissBanners();
  await closeAll();
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
