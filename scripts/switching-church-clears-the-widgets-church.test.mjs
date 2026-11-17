// SWITCHING CHURCH IN THE REAL APP CLEARS THE HOME-SCREEN WIDGET'S CHURCH SETTINGS — THROUGH THE APP-LEVEL HOOK.
//   Run: node --test scripts/switching-church-clears-the-widgets-church.test.mjs
//
// AUDIT-phone-widget-c60c0f72-2026-11-16, F1 (re-check): app/app.jsx calls TrinityIdentity.widgetForgetChurch()
// whenever activeChurch changes — leaving, switching, a confirmed block — on ANY tab, because Today (which also
// clears) is mounted only while it is the active tab. App() cannot be rendered in isolation, so this boots the REAL
// member index.html in headless chromium, served by a real scripts/gateway.mjs, with a recording stand-in for the
// native widget plugin injected before any app script runs. The member follows two churches and picks the other one
// in the real church switcher (You -> MY CHURCH -> the other church). What is asserted is a clearPrompt call whose
// stack runs through widgetForgetChurch — Today's own clear calls the plugin directly, so it cannot satisfy this.
// Delete the hook from app/app.jsx and this goes red.
//
// Skips itself when chromium is unavailable.
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
const PORT = 19973, CDP = 19974;   // HIGH ports, unique across scripts/
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = npubEncode(getPublicKey(generateSecretKey())), B = npubEncode(getPublicKey(generateSecretKey()));
const NAME_A = 'Grace Church Widgetton', NAME_B = 'St Mark Widgetford';

// Before ANY app script: a recording TrinityWidget (the native plugin's JS surface). isNativePlatform() is false, so
// nothing else in the app believes it is on a phone.
const STUB = `(() => {
  window.__widgetCalls = [];
  const rec = (name) => (...a) => { window.__widgetCalls.push({ name, stack: String(new Error().stack || '') }); return Promise.resolve({ supported: true }); };
  window.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: { TrinityWidget: {
    status: rec('status'), clearPrompt: rec('clearPrompt'), publishVotd: rec('publishVotd'), publishPrompt: rec('publishPrompt'),
    setEnabled: rec('setEnabled'), requestPin: rec('requestPin'), probe: async () => ({ outcome: 'unreachable' }) } } };
})();`;

let gateway, dataDir, chr, prof, ws, ev;
before(async () => {
  if (!CHROME) return;
  await requireFreePort(PORT, 'switching-church-clears-the-widgets-church.test.mjs (gateway)');
  await requireFreePort(CDP, 'switching-church-clears-the-widgets-church.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-widgetsw-'));
  gateway = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: A + ',' + B, RELAY_MAX_EVENTS: '5000', TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(200); }
  prof = mkdtempSync(join(tmpdir(), 'trin-widgetsw-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=420,900', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  ev = async (expression) => { const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (rr.result?.exceptionDetails) throw new Error('in page: ' + JSON.stringify(rr.result.exceptionDetails.exception?.description || rr.result.exceptionDetails.text)); return rr.result?.result?.value; };
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  const text = () => ev('((document.body && document.body.innerText) || "").replace(/\\s+/g, " ")');
  const waitText = async (re, ms, what) => { const t0 = Date.now(); let t = ''; while (Date.now() - t0 < ms) { try { t = await text(); } catch {} if (re.test(t)) return t; await sleep(500); } assert.fail(`never saw ${what}; screen: "${t.slice(0, 200)}"`); };
  await waitText(/TrinityOne/, 40000, 'the app');
  const me = await ev(`(async () => {
    localStorage.setItem('trinityone.onboarded', 'true');
    try { await window.TrinityIdentity.ready; } catch (e) {}
    await window.TrinityIdentity.regenerate();
    localStorage.setItem('trinityone.followedChurches', JSON.stringify([
      { id: ${JSON.stringify(A)}, npub: ${JSON.stringify(A)}, name: ${JSON.stringify(NAME_A)}, initials: 'GW', sub: 'Followed' },
      { id: ${JSON.stringify(B)}, npub: ${JSON.stringify(B)}, name: ${JSON.stringify(NAME_B)}, initials: 'SW', sub: 'Followed' }]));
    localStorage.setItem('trinityone.activeChurch', JSON.stringify(${JSON.stringify(A)}));
    return (window.TrinityIdentity.current || {}).pubkey;
  })()`);
  assert.match(String(me), /^[0-9a-f]{64}$/, 'no identity was created');
  await send('Page.reload', { ignoreCache: false });
  await sleep(3000);
  await waitText(/Today/, 40000, 'the Today screen');
  globalThis.__tap = async (label, sel = 'button, [role=button], div') => {
    const hit = await ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent !== null && (e.innerText || '').trim().startsWith(${JSON.stringify(label)})); const el = els[els.length - 1]; if (!el) return false; el.click(); return true; })()`);
    assert.ok(hit, `nothing labelled "${label}" on screen`);
    await sleep(1200);
  };
  globalThis.__waitText = waitText;
});
after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { gateway && gateway.kill('SIGKILL'); } catch {}
  await sleep(300);
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

const forgets = async () => (await ev(`(window.__widgetCalls || []).filter(c => c.name === 'clearPrompt' && /widgetForgetChurch/.test(c.stack)).length`));

test('picking the other church in the real switcher clears the widget\'s church settings via the app-level hook', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  assert.equal(await ev(`JSON.parse(localStorage.getItem('trinityone.activeChurch'))`), A, 're-anchor: the member is not on church A');
  const before = await forgets();
  await globalThis.__tap('You', 'button, [role=button]');
  await globalThis.__tap(NAME_A);                       // MY CHURCH -> the switcher
  await globalThis.__waitText(new RegExp(NAME_B), 20000, 'the church switcher listing the other church');
  await globalThis.__tap(NAME_B);                       // pick the other church
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && (await ev(`JSON.parse(localStorage.getItem('trinityone.activeChurch'))`)) !== B) await sleep(300);
  assert.equal(await ev(`JSON.parse(localStorage.getItem('trinityone.activeChurch'))`), B, 're-anchor: the switcher did not switch church');
  await sleep(800);
  const after = await forgets();
  assert.ok(after > before,
    'SWITCHING CHURCH DID NOT CLEAR THE WIDGET\'S CHURCH SETTINGS through the app-level hook — the old church\'s npub and relays stay on the phone until Today is next shown');
});
