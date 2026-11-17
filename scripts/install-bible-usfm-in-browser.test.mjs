// INSTALLING A USFM BIBLE FROM A FILE, IN REAL CHROMIUM, THROUGH THE REAL LIBRARY SCREEN: its text reads, and reads again after a relaunch.
// Run: node --test scripts/install-bible-usfm-in-browser.test.mjs
//
// The owner reported that a USFM-format Bible installed from a file "left the text unloaded". This drives the real member app
// (served by scripts/gateway.mjs, in-browser Babel and all): Library tab, the "Install a Bible from a file" button, a real change
// event on the real <input type=file> with a real File, the result sheet's "Read it now", and the reader's own text. Then it
// reloads the page and asks the engine for the same text. Files: a zip of three WEB books and a single-book .usfm (public domain,
// cut from modules/eng-web.zip). FAKED: nothing but the file chooser, which a headless browser cannot open.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { requireFreePort } from './test-ports.mjs';
import { buildSamples } from './install-bible-samples.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8812, CDP = 9385;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let relay, dataDir, chr, ws, prof, send;

before(async () => {
  await requireFreePort(PORT, 'install-bible-usfm-in-browser.test.mjs');
  await requireFreePort(CDP, 'install-bible-usfm-in-browser.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-usfm-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(200); }
  prof = mkdtempSync(join(tmpdir(), 'trin-usfm-chr-'));
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
    `--user-data-dir=${prof}`, '--window-size=1000,900', `http://127.0.0.1:${PORT}/`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  ws = new WebSocket((targets.find(t => t.type === 'page') || targets[0]).webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
});
after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { relay && relay.kill('SIGKILL'); } catch {}
  try { rmSync(prof, { recursive: true, force: true }); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result.result.value;
}
async function waitEngine() { for (let i = 0; i < 150; i++) { try { if (await ev('!!(window.Bible && window.Bible.installFromBytes && window.Bible.loaded)')) return; } catch {} await sleep(300); } assert.fail('the engine never came up'); }

// install `bytes` as `name` through the Library screen's own button; returns what the sheet and the reader showed
async function installViaLibrary(name, bytes, readerNeedle) {
  const b64 = Buffer.from(bytes).toString('base64');
  return JSON.parse(await ev(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const clickText = async (re) => { for (let i = 0; i < 60; i++) { const el = [...document.querySelectorAll('button, [role=button], div')].reverse().find(x => re.test((x.textContent || '').trim()) && (x.textContent || '').length < 60); if (el) { el.click(); return true; } await wait(250); } return false; };
    const events = []; const off = window.Bible.onFileInstall(e => events.push(e));
    const tab = await clickText(/^Library$/); await wait(600);
    const store = await clickText(/^Bibles/); await wait(900);
    const btn = [...document.querySelectorAll('button')].find(x => /Install a Bible from a file/.test(x.textContent));
    if (btn) btn.click();
    const input = [...document.querySelectorAll('input[type=file]')].pop();
    const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0))], ${JSON.stringify(name)}));
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 200 && !events.some(e => e.phase === 'result'); i++) await wait(100);
    off();
    await wait(500);
    const sheet = document.body.innerText.includes('Bible installed');
    const read = await clickText(/^Read it now$/); await wait(1500);
    const body = document.body.innerText;
    return JSON.stringify({ tab, store, btn: !!btn, result: (events.find(e => e.phase === 'result') || {}).result, sheet, read, readerHasText: body.includes(${JSON.stringify(readerNeedle)}), active: window.Bible.activeVersion });
  })()`));
}
async function textAfterReload(abbr, book, chapter, verse) {
  await send('Page.reload'); await sleep(1500);
  await waitEngine();
  for (let i = 0; i < 160; i++) {                                    // the web build compiles its screens in the browser first: allow it
    const v = await ev(`JSON.stringify(window.Bible.versions().map(x => x.abbr))`);
    if (v.includes(JSON.stringify(abbr))) break; await sleep(250);
  }
  return ev(`(() => { const v = window.Bible.getVerses(${book}, ${chapter}, ${JSON.stringify(abbr)}).find(x => Number(x.v) === ${verse}); return v ? v.text : ''; })()`);
}

test('a USFM ZIP installed from the Library reads in the reader at once, and again after a relaunch', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  await waitEngine(); await sleep(3000);
  const s = (await buildSamples()).find(x => x.file.startsWith('01-'));
  const r = await installViaLibrary(s.file, s.bytes, 'For God so loved the world');
  assert.deepEqual([r.tab, r.store, r.btn], [true, true, true], 'the Library screen did not offer the button: ' + JSON.stringify(r));
  assert.equal(r.result && r.result.ok, true, JSON.stringify(r));
  assert.equal(r.sheet, true, 'the result sheet was not shown');
  assert.equal(r.read, true, '"Read it now" is not on the sheet');
  assert.equal(r.active, r.result.abbr, 'the new Bible is not the active one after "Read it now"');
  const txt = await textAfterReload(r.result.abbr, 43, 3, 16);
  assert.match(txt, /For God so loved the world/, 'after a relaunch the imported Bible has no text: ' + JSON.stringify(txt));
});

test('a single-book USFM file installed from the Library reads, and reads again after a relaunch', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  await waitEngine(); await sleep(3000);
  const s = (await buildSamples()).find(x => x.file.startsWith('02-'));
  const r = await installViaLibrary(s.file, s.bytes, 'The elder to Gaius');
  assert.equal(r.result && r.result.ok, true, JSON.stringify(r));
  const txt = await textAfterReload(r.result.abbr, 64, 1, 1);
  assert.match(txt, /The elder to Gaius the beloved/, 'after a relaunch the single-book Bible has no text: ' + JSON.stringify(txt));
});
