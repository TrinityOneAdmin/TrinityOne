// INSTALLING A USFM BIBLE FROM A FILE, IN REAL CHROMIUM, THROUGH THE REAL LIBRARY SCREEN: its text reads, and reads again after a relaunch.
// Run: node --test scripts/install-bible-usfm-in-browser.test.mjs
//
// The owner reported that a USFM-format Bible installed from a file "left the text unloaded". This drives the real member app
// (served by scripts/gateway.mjs, in-browser Babel and all): Library tab, the quiet "Have a Bible file? Install it" link, a real change
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
let ABBR1 = '', ABBR2 = '';   // the two Bibles the first two tests install (read by the translation-kept test)
async function installViaLibrary(name, bytes, readerNeedle) {
  const b64 = Buffer.from(bytes).toString('base64');
  return JSON.parse(await ev(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const clickText = async (re) => { for (let i = 0; i < 60; i++) { const el = [...document.querySelectorAll('button, [role=button], div')].reverse().find(x => re.test((x.textContent || '').trim()) && (x.textContent || '').length < 60); if (el) { el.click(); return true; } await wait(250); } return false; };
    const events = []; const off = window.Bible.onFileInstall(e => events.push(e));
    const tab = await clickText(/^Library$/); await wait(600);
    const store = await clickText(/^Bibles/); await wait(900);
    const btn = [...document.querySelectorAll('button')].find(x => /Have a Bible file\\? Install it/.test(x.textContent));
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

// After a relaunch, make `abbr` the active Bible and open the Read tab; if the reader says the chapter is not there, press its button.
// Returns what the READER SCREEN shows (document text), not what the engine would answer.
async function readerAfterReload(abbr) {
  return JSON.parse(await ev(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const clickText = async (re) => { for (let i = 0; i < 40; i++) { const el = [...document.querySelectorAll('button, [role=button], div')].reverse().find(x => re.test((x.textContent || '').trim()) && (x.textContent || '').length < 60); if (el) { el.click(); return true; } await wait(250); } return false; };
    window.Bible.setActive(${JSON.stringify(abbr)}); await wait(800);
    const tab = await clickText(/^Read$/); await wait(1500);
    let body = document.body.innerText; let pressed = false;
    if (/isn.t in/.test(body)) { pressed = await clickText(/^Go to /); await wait(1500); body = document.body.innerText; }
    return JSON.stringify({ tab, pressed, body });
  })()`));
}

test('a USFM ZIP installed from the Library reads in the reader at once, and again after a relaunch', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  await waitEngine(); await sleep(3000);
  const s = (await buildSamples()).find(x => x.file.startsWith('01-'));
  const r = await installViaLibrary(s.file, s.bytes, 'In the beginning was the Word');
  ABBR1 = r.result && r.result.abbr;
  assert.deepEqual([r.tab, r.store, r.btn], [true, true, true], 'the Library screen did not offer the button: ' + JSON.stringify(r));
  assert.equal(r.result && r.result.ok, true, JSON.stringify(r));
  assert.equal(r.sheet, true, 'the result sheet was not shown');
  assert.equal(r.read, true, '"Read it now" is not on the sheet');
  assert.equal(r.active, r.result.abbr, 'the new Bible is not the active one after "Read it now"');
  assert.equal(r.readerHasText, true, 'after "Read it now" the READER SCREEN shows no text of the new Bible');
  const txt = await textAfterReload(r.result.abbr, 43, 3, 16);
  assert.match(txt, /For God so loved the world/, 'after a relaunch the imported Bible has no text: ' + JSON.stringify(txt));
  const after = await readerAfterReload(r.result.abbr);
  assert.equal(after.tab, true, 'the Read tab was not found');
  assert.match(after.body, /In the beginning was the Word|For God so loved/, 'after a relaunch the READER SCREEN shows no text of the imported Bible: ' + after.body.slice(0, 400));
});

test('a single-book USFM file installed from the Library reads, and reads again after a relaunch', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  await waitEngine(); await sleep(3000);
  const s = (await buildSamples()).find(x => x.file.startsWith('02-'));
  const r = await installViaLibrary(s.file, s.bytes, 'The elder to Gaius');
  ABBR2 = r.result && r.result.abbr;
  assert.equal(r.result && r.result.ok, true, JSON.stringify(r));
  assert.equal(r.readerHasText, true, 'after "Read it now" the READER SCREEN shows no text of the single-book Bible (it should open 3 John 1)');
  const txt = await textAfterReload(r.result.abbr, 64, 1, 1);
  assert.match(txt, /The elder to Gaius the beloved/, 'after a relaunch the single-book Bible has no text: ' + JSON.stringify(txt));
  const after = await readerAfterReload(r.result.abbr);
  assert.equal(after.tab, true, 'the Read tab was not found');
  assert.match(after.body, /The elder to Gaius/, 'after a relaunch the READER SCREEN shows no text of the single-book Bible (pressed the Go to button: ' + after.pressed + '): ' + after.body.slice(0, 400));
});

// ── THE TRANSLATION A MEMBER PICKS IS THE ONE THAT OPENS AFTER A RELAUNCH (2026-11-18) ───────────────────────────────
// Round-2 device testing: "the reader returns to BSB after every restart". Everything below goes through the READER'S OWN
// controls — the translation pill in its header, the Translations sheet's row, the footer's next-chapter button — and
// reads back what the reader header and page show after a REAL reload. Nothing here calls Bible.setActive.
const HEADER = `[...document.querySelectorAll('div')].map(d => [...d.children].filter(c => c.tagName === 'BUTTON' && c.style.borderRadius === '12px')).find(bs => bs.length >= 3 && /^[A-Za-z0-9+]{2,8}$/.test(bs[2].innerText.trim()) && /^\\d+$/.test(bs[1].innerText.trim()))`;
async function openRead() {
  await ev(`(async () => { const wait = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 40; i++) { const el = [...document.querySelectorAll('button, [role=button], div')].reverse().find(x => /^Read$/.test((x.textContent || '').trim())); if (el) { el.click(); break; } await wait(250); }
    for (let i = 0; i < 60 && !(${HEADER}); i++) await wait(250); return 1; })()`);
}
const header = () => ev(`(() => { const bs = ${HEADER}; return bs ? { book: bs[0].innerText.trim(), chap: bs[1].innerText.trim(), version: bs[2].innerText.trim() } : null; })()`);
// tap the header's translation pill, then the sheet row whose abbreviation line is `abbr`
async function pickInSheet(abbr) {
  const ok = await ev(`(async () => { const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const bs = ${HEADER}; if (!bs) return 'no header'; bs[2].click(); await wait(700);
    let row = null;
    // a row of the sheet's "In your reader" list: a tappable card whose lines include the abbreviation (alone, or "ABBR · kind")
    const isRow = (d) => d.style.cursor === 'pointer' && d.style.borderRadius === '15px' && d.innerText.split('\\n').some(l => l.trim() === ${JSON.stringify(abbr)} || l.trim().startsWith(${JSON.stringify(abbr)} + ' ·'));
    for (let i = 0; i < 40 && !row; i++) { row = [...document.querySelectorAll('div')].find(isRow) || null; if (!row) await wait(250); }
    if (!row || row.style.cursor !== 'pointer') return 'no sheet row for ${abbr}; pill was ' + JSON.stringify(bs[2].innerText) + '; page: ' + document.body.innerText.slice(-900).replace(/\\s+/g, ' ');
    row.click(); await wait(1200); return 'ok'; })()`);
  assert.equal(ok, 'ok', ok);
}
async function relaunch() {
  await ev('window.__marker = 1');
  await send('Page.reload');
  for (let i = 0; i < 160; i++) { try { if (await ev('typeof window.__marker === "undefined"')) break; } catch {} await sleep(250); }
  await waitEngine();
  for (let i = 0; i < 200; i++) { try { if (await ev('window.Bible.loading === false')) break; } catch {} await sleep(250); }
  await openRead(); await sleep(1000);
}

test('the translation picked in the reader\'s own sheet is the one the reader opens after a relaunch — at its own saved place', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  assert.ok(ABBR1 && ABBR2, 'the install tests above did not run: ' + JSON.stringify([ABBR1, ABBR2]));
  await openRead();
  await pickInSheet(ABBR1);
  let h = await header();
  assert.equal(h && h.version, ABBR1, 'the sheet pick did not switch the reader: ' + JSON.stringify(h));
  // the reader was on 3 John (the single-book Bible); this one may not hold it — the reader then offers its own "Go to" button
  await ev(`(async () => { const wait = (ms) => new Promise(r => setTimeout(r, ms)); if (/isn.t in/.test(document.body.innerText)) { const el = [...document.querySelectorAll('button')].find(x => /^Go to /.test((x.textContent || '').trim())); if (el) { el.click(); await wait(1500); } } return 1; })()`);
  h = await header();
  // turn one page with the footer, so the place saved under this translation is not where it opened
  const before = h.book + ' ' + h.chap;
  const pressed = await ev(`(() => { const bs = [...document.querySelectorAll('button')].filter(b => b.style.borderRadius === '15px'); if (bs.length !== 2) return null; const b = /^End$/.test(bs[1].innerText.trim()) ? bs[0] : bs[1]; b.click(); return b.innerText.trim(); })()`);   // 3 John is the last book: then the previous one
  assert.ok(pressed, 'no footer prev/next pair'); await sleep(800);
  h = await header(); const place = h.book + ' ' + h.chap;
  assert.notEqual(place, before, 'the footer button did not turn the page: before ' + before + ', pressed ' + JSON.stringify(pressed) + ', after ' + place + ' / ' + (await ev('document.body.innerText')).slice(0, 300).replace(/\s+/g, ' '));
  await relaunch();
  h = await header();
  assert.equal(h && h.version, ABBR1, 'THE FINDING: after a relaunch the reader opened in ' + JSON.stringify(h) + ', not the translation picked');
  assert.equal(h.book + ' ' + h.chap, place, 'the reader did not reopen at the place saved in the picked translation');
  assert.equal(await ev('window.Bible.activeVersion'), ABBR1);
  // the screens that follow the active Bible: Today's verse is read in it (votdInTranslation is the shipped function, run here)
  assert.equal(await ev(`votdInTranslation({ ref: 'John 1:1', text: 'pool text' }, window.Bible).version`), ABBR1, 'Today\'s verse is not read in the picked translation');
});

test('picking BSB back is followed too, and a picked Bible whose bytes are gone opens BSB with no error', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  assert.ok(ABBR1, 'the install tests above did not run');
  await pickInSheet('BSB');
  await relaunch();
  let h = await header();
  assert.equal(h && h.version, 'BSB', 'picking BSB back was not kept: ' + JSON.stringify(h));
  // pick the file Bible again, then take its bytes away (an evicted store) and relaunch
  await pickInSheet(ABBR1);
  const url = await ev('window.Bible.activeUrl');
  assert.ok(url, 'the picked Bible has no url');
  assert.equal(await ev(`new Promise((res) => { const o = indexedDB.open('bible-modules'); o.onsuccess = () => { const tx = o.result.transaction('modules', 'readwrite'); tx.objectStore('modules').delete(${JSON.stringify(url)}); tx.oncomplete = () => res('ok'); tx.onerror = () => res('err'); }; o.onerror = () => res('open-err'); })`), 'ok');
  await relaunch();
  h = await header();
  assert.equal(h && h.version, 'BSB', 'with the picked Bible gone the reader did not fall back to BSB: ' + JSON.stringify(h));
  assert.equal(await ev('window.Bible._error'), null, 'the fallback set an error');
  assert.ok(!/Couldn.t/.test(await ev('document.body.innerText')), 'the fallback put an error on the screen');
});
