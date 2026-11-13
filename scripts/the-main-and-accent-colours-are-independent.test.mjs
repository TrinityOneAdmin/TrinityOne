// THE MAIN COLOUR AND THE ACCENT COLOUR ARE INDEPENDENT, AND MAIN IS OPT-IN (owner device test of 69dd2d98 and
// owner decision, 2026-11-13).
//   Run: node --test scripts/the-main-and-accent-colours-are-independent.test.mjs
//
// Owner: "when changing the accent color first, it also changes the main color to match … resetting one changes
// both … the picker on main color … also changes both of the colors."
//
// Cause (reproduced in this harness before 4c2e359e): the SAVED values were already independent, but with no main
// colour saved the Main colour control DISPLAYED the accent (`mainShown = mainCol || acc`), and its picker opened
// on the accent. Owner decision (after audit AUDIT-colour-independent-4c2e359e): Main is opt-in behind a
// "Use a separate main colour" switch — OFF by default when no mainColor is saved, ON reveals the controls and
// saves nothing until a colour is chosen, OFF clears mainColor like Reset. A picker event equal to the picker's
// starting value while Main is unset is ignored (audit finding 1).
//
// POINT OF USE (CLAUDE.md rule 1): the REAL console (steward.html, vendor/steward.js, app/*.jsx) is served by a
// REAL relay (scripts/gateway.mjs) and opened in headless Chromium. A church is made through the real wizard, the
// steward clicks to Settings -> Church identity, and drives the switch and each control: the colour picker (value
// set + input event, as a picker delivers it), the hex box (real key input, one character per CDP
// Input.insertText), the preset swatches and Reset. What was PUBLISHED is read from the relay's own database (the
// church's latest kind-0); what the screen shows is read off the DOM. Rule 3: nothing matches text in app/*.jsx.
// The tests below share one browser and one church and run in order.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const SKIP = !CHROME ? 'no chromium' : false;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const ACCENT_DEFAULT = '#c25a38';   // what the Accent control shows when no accent is set
const SWATCHES = ['#c25a38', '#3b6fb0', '#5e8c6a', '#7a4fa3', '#b0853b', '#1f2a37'];
const NAME = { accent: 'Accent', mainColor: 'Main' };
const SWITCH = 'button[role="switch"][aria-label="Use a separate main colour"]';

let relay, chr, ws, prof, send, evalIn, churchPub = '';

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

const kind0 = () => {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare('SELECT raw FROM events WHERE kind = 0').all().map(r => JSON.parse(String(r.raw)))
      .filter(e => e.pubkey === churchPub).sort((a, b) => b.created_at - a.created_at);
    if (!rows[0]) return null;
    const c = JSON.parse(rows[0].content);
    return { accent: String(c.accent || '').toLowerCase(), mainColor: String(c.mainColor || '').toLowerCase(), name: c.name, id: rows[0].id };
  } finally { db.close(); }
};
const published = async (ok, label) => {
  const t0 = Date.now(); let k = kind0();
  while (!(k && ok(k)) && Date.now() - t0 < 20000) { await sleep(300); k = kind0(); }
  assert.ok(k && ok(k), `${label}: the relay's kind-0 never got there — it holds ${JSON.stringify(k)}`);
  return k;
};
const unlock = async () => {
  await waitFor(`!!document.querySelector(${JSON.stringify(byPh('Your PIN or passphrase'))})`, 'the unlock screen');
  assert.equal(await evalIn(setVal(byPh('Your PIN or passphrase'), PIN)), 'ok');
  await press('/^Unlock/');
  await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 'the dashboard');
};
const reload = async () => { await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); location.reload(); return 'ok'; })()`); await sleep(3000); await unlock(); };
const toIdentity = async () => {
  for (let i = 0; i < 60; i++) {
    await evalIn(`(() => { const b=[...document.querySelectorAll('button,[role="tab"],a')].find(x=>(x.textContent||'').trim()==='Settings'); if (b) b.click(); })()`);
    await sleep(300);
    await evalIn(`(() => { const b=[...document.querySelectorAll('button,[role="button"]')].reverse().find(x=>/^Church identity/.test((x.textContent||'').trim())); if (b) b.click(); })()`);
    await sleep(300);
    if (await evalIn(`!!document.querySelector('input[aria-label="Accent colour hex code"]') && !!document.querySelector(${JSON.stringify(SWITCH)})`)) return;
  }
  assert.fail('Settings → Church identity never showed the Accent controls and the Main colour switch');
};
// every publishProfile the screen makes (still calls the real one)
const arm = async () => assert.equal(await evalIn(`(() => { const S = window.Steward; window.__pp = []; if (S.__ppArmed) return 'armed'; const real = S.publishProfile;
  S.publishProfile = function (m) { window.__pp.push(JSON.parse(JSON.stringify(m))); return real.apply(this, arguments); }; S.__ppArmed = 1;
  return S.publishProfile !== real ? 'armed' : 'frozen'; })()`), 'armed', 'could not record publishProfile');
const calls = async () => JSON.parse(await evalIn(`JSON.stringify(window.__pp)`));
const clearCalls = () => evalIn(`(window.__pp.length = 0, 'ok')`);
const switchOn = () => evalIn(`(() => { const s = document.querySelector(${JSON.stringify(SWITCH)}); return s ? s.getAttribute('aria-checked') : 'missing'; })()`);
const flip = async () => { assert.equal(await evalIn(`(() => { const s = document.querySelector(${JSON.stringify(SWITCH)}); if (!s) return 'miss'; s.click(); return 'ok'; })()`), 'ok', 'no Main colour switch'); await sleep(300); };
const mainControlsPresent = () => evalIn(`['input[aria-label="Main colour picker"]','input[aria-label="Main colour hex code"]','button[aria-label="Main colour #3B6FB0"]'].map(s => !!document.querySelector(s))`);
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };

// what a colour's CONTROL shows: hex box + its hint, picker value, tile fill, and which swatch is ringed
const shown = async (field) => JSON.parse(await evalIn(`(() => { const p = document.querySelector('input[aria-label="${NAME[field]} colour picker"]');
  const h = document.querySelector('input[aria-label="${NAME[field]} colour hex code"]');
  if (!p || !h) return JSON.stringify({ missing: true });
  const t = getComputedStyle(p.parentElement);
  const ringed = [...document.querySelectorAll('button[aria-label^="${NAME[field]} colour #"]')].filter(b => /^3px/.test(b.style.border)).map(b => b.getAttribute('aria-label').slice(-7).toLowerCase());
  return JSON.stringify({ hex: h.value.toLowerCase(), hint: (h.placeholder || '').toLowerCase(), picker: p.value.toLowerCase(), tile: t.backgroundColor + (t.backgroundImage !== 'none' ? '|pattern' : ''), ringed }); })()`));
// what each control must show for a saved value: its own colour, or (unset) its own default — never the other's
const looksLike = (field, saved) => field === 'accent'
  ? { hex: saved ? saved.slice(1) : '', hint: ACCENT_DEFAULT.slice(1), picker: saved || ACCENT_DEFAULT, tile: rgb(saved || ACCENT_DEFAULT), ringed: SWATCHES.includes(saved) ? [saved] : [] }
  : { hex: saved ? saved.slice(1) : '', hint: 'rrggbb', picker: saved || '#c25a38', tile: saved ? rgb(saved) : 'rgba(0, 0, 0, 0)|pattern', ringed: SWATCHES.includes(saved) ? [saved] : [] };

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
const swatch = async (field, hex) => assert.equal(await evalIn(`(() => { const b = document.querySelector('button[aria-label="${NAME[field]} colour ${hex.toUpperCase()}"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', `no ${NAME[field]} swatch ${hex}`);
const reset = async (field) => assert.equal(await evalIn(`(() => { const b = document.querySelector('button[aria-label="Reset ${NAME[field].toLowerCase()} colour"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', `no Reset for ${NAME[field]}`);

// Drive one control on `field` and prove the OTHER colour did not move: on the relay, in what the screen sent,
// and in what the other control shows.
const other = (f) => f === 'accent' ? 'mainColor' : 'accent';
const drive = async (row, field, how, want) => {
  const o = other(field);
  const before = kind0();
  const otherShownBefore = await shown(o);
  await clearCalls();
  if (how === 'picker') await pick(field, want);
  else if (how === 'typed') await type(field, want.slice(1).toUpperCase());
  else if (how === 'swatch') await swatch(field, want);
  else await reset(field);
  await published(x => x[field] === want, `${row}: ${NAME[field]} ${how} -> ${want || '(unset)'}`);
  await sleep(900);   // past every 400ms debounce: catch a late second write
  const after = kind0();
  assert.equal(after[o], before[o], `${row}: ${NAME[field]} ${how} changed the PUBLISHED ${NAME[o]} colour from "${before[o]}" to "${after[o]}"`);
  assert.equal(after[field], want, `${row}: ${NAME[field]} ${how} did not stay "${want}" on the relay (now "${after[field]}")`);
  const sent = await calls();
  assert.ok(sent.length > 0 && sent.every(m => !(o in m)), `${row}: ${NAME[field]} ${how} sent ${JSON.stringify(sent)} — it must never carry ${o}`);
  assert.deepEqual(await shown(o), otherShownBefore, `${row}: ${NAME[field]} ${how} changed what the ${NAME[o]} colour control SHOWS`);
  assert.deepEqual(await shown(o), looksLike(o, after[o]), `${row}: the ${NAME[o]} control does not show its own saved colour "${after[o] || '(unset)'}"`);
  assert.deepEqual(await shown(field), looksLike(field, want), `${row}: the ${NAME[field]} control does not show what was just saved`);
};
// what the members'-header preview shows
const preview = () => evalIn(`(() => { const p = document.querySelector('[data-brand-preview]'); if (!p) return null;
  return JSON.stringify({ kind: p.getAttribute('data-brand-preview'), bg: getComputedStyle(p).backgroundColor }); })()`).then(v => v && JSON.parse(v));
const surfaceRgb = () => evalIn(`(() => { const d = document.createElement('div'); d.style.background = 'var(--surface)'; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`);

before(async () => {
  if (SKIP) return;
  relay = await H.startRelay({ name: 'colour-indep', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the colour-independence test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-colourIndep-'));
  // Never let a test reach production (scripts/no-browser-reaches-production.test.mjs).
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  // a church, by the real wizard, on the real relay
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
  churchPub = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  assert.match(churchPub, /^[0-9a-f]{64}$/, 'the wizard did not give the console a church key');
  await published(k => k.name === 'St Columba Two Colours', 'the wizard\'s name');
  await reload();
  await toIdentity();
  await sleep(2500);   // past the wizard's 1.8s timer: nothing must take the keyboard while typing
  assert.equal(await evalIn(`!!document.querySelector('input[aria-label="Church name"]')`), false, 'the first-run wizard opened over the settings page');
  await arm();
});

after(() => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { relay && relay.stop(); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

test('Main is OFF for a church with no main colour: no Main controls, a note says what members see, an accent change publishes no Main, and the preview header stays plain', { skip: SKIP, timeout: 120000 }, async () => {
  const k0 = kind0();
  assert.deepEqual([k0.accent, k0.mainColor], ['', ''], `CONTROL: the new church already has colours ${JSON.stringify(k0)}`);
  assert.equal(await switchOn(), 'false', 'a church with no main colour shows the switch ON');
  assert.deepEqual(await mainControlsPresent(), [false, false, false], 'Main controls are on screen with the switch OFF');
  assert.equal(await evalIn(`!!document.querySelector('[data-main-off-note]')`), true, 'no note says what members see with Main OFF');
  await clearCalls();
  await pick('accent', '#3b6fb0');
  await published(x => x.accent === '#3b6fb0', 'accent picked with Main OFF');
  await sleep(900);
  assert.equal(kind0().mainColor, '', 'picking an accent with Main OFF published a main colour');
  assert.ok((await calls()).every(m => !('mainColor' in m)), 'picking an accent with Main OFF sent mainColor');
  const pv = await preview();
  assert.equal(pv && pv.kind, 'compact', 'with no banner the preview is not the compact header members see');
  assert.equal(pv.bg, await surfaceRgb(), `with Main OFF the preview header is ${pv.bg}, not plain — members see a plain header`);
});

test('switching Main ON reveals the controls and publishes nothing until a colour is chosen', { skip: SKIP, timeout: 60000 }, async () => {
  const before = kind0();
  await clearCalls();
  await flip();
  assert.equal(await switchOn(), 'true');
  assert.deepEqual(await mainControlsPresent(), [true, true, true], 'switching ON did not reveal the picker, hex box and swatches');
  await sleep(1200);
  assert.deepEqual(await calls(), [], 'switching ON sent ' + JSON.stringify(await calls()));
  assert.equal(kind0().id, before.id, 'switching ON published a new kind-0');
  assert.deepEqual(await shown('mainColor'), looksLike('mainColor', ''), 'the unset Main control does not show "not set"');
});

test('audit finding 1: with Main unset, a picker event carrying the picker\'s own starting value saves nothing', { skip: SKIP, timeout: 60000 }, async () => {
  const before = kind0();
  const start = (await shown('mainColor')).picker;
  await clearCalls();
  await pick('mainColor', start);   // what a phone picker sends when it is closed on its starting colour
  await sleep(1200);
  assert.deepEqual(await calls(), [], `the picker's starting value ${start} was sent: ${JSON.stringify(await calls())}`);
  assert.equal(kind0().id, before.id, 'the picker\'s starting value published a kind-0');
  assert.equal(kind0().mainColor, '', 'the picker\'s starting value was saved as the main colour');
  assert.equal(await evalIn(`!!document.querySelector('button[aria-label="Reset main colour"]')`), false, 'the starting value made Main look set');
});

test('picking, typing, a swatch or Reset on one colour never changes the other — church with neither set, then both set (loaded back from the relay)', { skip: SKIP, timeout: 420000 }, async () => {
  await drive('neither set', 'accent', 'reset', '');
  await drive('neither set', 'accent', 'picker', '#3b6fb0');
  await drive('neither set', 'accent', 'typed', '#1f4e79');
  await drive('neither set', 'accent', 'swatch', '#5e8c6a');
  await drive('neither set', 'accent', 'reset', '');
  await drive('neither set', 'mainColor', 'picker', '#7a4fa3');
  await drive('neither set', 'mainColor', 'typed', '#5e8c6a');
  await drive('neither set', 'mainColor', 'swatch', '#b0853b');
  await drive('neither set', 'mainColor', 'reset', '');
  // the owner's exact sequence: accent first, then main, then reset each
  await drive('owner sequence', 'accent', 'picker', '#b0853b');
  await drive('owner sequence', 'mainColor', 'picker', '#1f2a37');
  await drive('owner sequence', 'mainColor', 'reset', '');
  await drive('owner sequence', 'accent', 'reset', '');

  await drive('setup', 'accent', 'picker', '#3b6fb0');
  await drive('setup', 'mainColor', 'picker', '#7a4fa3');
  await reload();
  await toIdentity();
  await waitFor(`(document.querySelector('input[aria-label="Main colour hex code"]')||{}).value === '7A4FA3' && document.querySelector('input[aria-label="Accent colour hex code"]').value.toLowerCase() === '3b6fb0'`, 'both saved colours loaded back into the controls');
  assert.equal(await switchOn(), 'true', 'a church with a saved main colour loaded with the switch OFF');
  await sleep(1500);
  await arm();
  await drive('both set', 'accent', 'picker', '#b0853b');
  await drive('both set', 'accent', 'typed', '#1f4e79');
  await drive('both set', 'accent', 'swatch', '#c25a38');
  await drive('both set', 'accent', 'reset', '');
  await drive('both set', 'accent', 'picker', '#3b6fb0');
  await drive('both set', 'mainColor', 'picker', '#5e8c6a');
  await drive('both set', 'mainColor', 'typed', '#1f2a37');
  await drive('both set', 'mainColor', 'swatch', '#7a4fa3');
  const end = kind0();
  assert.deepEqual([end.accent, end.mainColor], ['#3b6fb0', '#7a4fa3'], `the relay ended on ${JSON.stringify(end)}`);
  const pv = await preview();
  assert.equal(pv.bg, rgb('#7a4fa3'), 'with a main colour the preview header is not filled with it');
});

test('switching Main OFF publishes the removal, leaves the accent alone, hides the controls, and a reload keeps it OFF', { skip: SKIP, timeout: 120000 }, async () => {
  assert.equal(kind0().mainColor, '#7a4fa3', 'CONTROL: the previous test did not leave a main colour saved');
  await clearCalls();
  await flip();
  const k = await published(x => x.mainColor === '', 'switching Main OFF');
  assert.equal(k.accent, '#3b6fb0', 'switching Main OFF changed the accent');
  assert.deepEqual(await calls(), [{ mainColor: '' }], 'switching Main OFF sent ' + JSON.stringify(await calls()));
  assert.equal(await switchOn(), 'false');
  assert.deepEqual(await mainControlsPresent(), [false, false, false], 'the Main controls stayed on screen after switching OFF');
  await reload();
  await toIdentity();
  await sleep(2500);
  assert.equal(await switchOn(), 'false', 'after the removal, a reload showed Main ON');
  assert.deepEqual(await mainControlsPresent(), [false, false, false]);
});
