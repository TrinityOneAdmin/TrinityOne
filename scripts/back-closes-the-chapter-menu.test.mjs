// BACK CLOSES THE CHAPTER MENU IN READ — IT DOES NOT THROW THE READER OUT TO TODAY.
// Run: node --test scripts/back-closes-the-chapter-menu.test.mjs
//
// Device round 2026-10-01 (Oppo, Android 12), reproduced twice: in Read, tap the chapter pill ("119 ▾") so the
// chapter/verse menu opens, press Android Back — the app jumped to Today. The verse sheet, by contrast, closes on
// Back, because it is a <BottomSheet>, and every BottomSheet/Overlay puts its close on the back-stack
// (app/ui.jsx useBackLayer). The chapter menu (ChapterVerseMenu, app/screens-read.jsx) is hand-rolled and was
// on no back-stack, so the app's Back handler found nothing to close and fell through to "any other tab →
// Today". It now registers on the same stack.
//
// The point of use: the real member app in headless Chromium against a throwaway gateway, opened on Read, the
// menu opened by tapping the header's chapter pill, and Back pressed the way the browser presses it —
// history.back() → popstate → the app's goBack(). On the phone the Capacitor `backButton` listener calls that
// same goBack() (app/app.jsx); this rig has no Capacitor, so it exercises the popstate door. Nothing here
// matches source text (CLAUDE.md rule 3): it reads what is on the screen.
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
const PORT = 8963, CDP = 9377;   // unique across scripts/*.test.mjs and scripts/*.probe.mjs
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let relay, dataDir, chr, ws, prof, send;
const errors = [];

before(async () => {
  await requireFreePort(PORT, 'back-closes-the-chapter-menu.test.mjs');
  await requireFreePort(CDP, 'back-closes-the-chapter-menu.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-backcv-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(getPublicKey(generateSecretKey())), RELAY_MAX_EVENTS: '2000' },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(200); }
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  prof = mkdtempSync(join(tmpdir(), 'trin-backcv-chr-'));
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=420,900', `http://127.0.0.1:${PORT}/?tab=read`],
    { stdio: 'ignore', cwd: prof });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  // the Bible module registered and painted (the reader's header row exists)
  for (let i = 0; i < 160; i++) { if (await evalSoft('!!(window.Bible && window.Bible.loaded === true && window.Bible.loading === false)')) break; await sleep(250); }
  for (let i = 0; i < 60; i++) { if (await where()) break; await sleep(250); }
  await sleep(800);
});
after(() => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { rmSync(prof, { recursive: true, force: true }); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

async function evalIn(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  const d = r && r.result;
  if (d && d.exceptionDetails) throw new Error('page threw: ' + (d.exceptionDetails.exception?.description || d.exceptionDetails.text));
  return d && d.result ? d.result.value : undefined;
}
async function evalSoft(expr) { try { return await evalIn(expr); } catch { return undefined; } }
// The reader's header: the row of pill buttons whose second is the chapter and third the translation (the same
// reading the-reader-remembers-where-you-were.test.mjs uses). Returns "John 1", or null when Read is not showing.
const HEADER = `[...document.querySelectorAll('div')].filter(d => {
  const bs = [...d.children].filter(c => c.tagName === 'BUTTON' && c.style.borderRadius === '12px');
  return bs.length >= 3 && /^[A-Za-z0-9]{2,8}$/.test(bs[2].innerText.trim()) && /^\\d+$/.test(bs[1].innerText.trim());
})`;
const where = () => evalSoft(`(() => { const rows = ${HEADER}; if (!rows.length) return null; const bs = [...rows[0].children].filter(c => c.tagName === 'BUTTON'); return bs[0].innerText.trim() + ' ' + bs[1].innerText.trim(); })()`);
// the chapter/verse menu is open when its two headings are on screen
const menuOpen = () => evalIn(`(() => { const t = [...document.querySelectorAll('div')].map(d => d.childElementCount === 0 ? (d.innerText || '').trim() : ''); return t.includes('CHAPTER') && t.includes('VERSE'); })()`);
const onToday = () => evalIn(`/Continue reading|Verse of the day|VERSE OF THE DAY/i.test(document.body.innerText || '')`);
async function pressBack() { await evalIn('history.back(), true'); await sleep(900); }

test('Back with the chapter menu open closes the menu and leaves the reader where it was', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  const at = await where();
  assert.ok(at, 'CONTROL: the reader never painted its header — the Bible module did not load');
  assert.equal(await menuOpen(), false, 'CONTROL: the menu is open before it was tapped');
  // open it the way a member does: the chapter pill in the header
  const tapped = await evalIn(`(() => { const rows = ${HEADER}; if (!rows.length) return false; [...rows[0].children].filter(c => c.tagName === 'BUTTON')[1].click(); return true; })()`);
  assert.ok(tapped, 'no chapter pill to tap');
  await sleep(700);
  assert.equal(await menuOpen(), true, 'CONTROL: tapping the chapter pill did not open the chapter/verse menu');

  await pressBack();
  assert.equal(await menuOpen(), false, 'Back did not close the chapter menu');
  assert.equal(await where(), at,
    'THE FINDING: Back with the chapter menu open left Read (the phone jumped to Today) instead of closing the menu');
  assert.equal(await onToday(), false, 'Back with the chapter menu open showed Today');

  // CONTROL: the Back door is live in this rig — with nothing open, Back from Read goes to Today, as it always has.
  await pressBack();
  assert.equal(await where(), null, 'CONTROL: Back from Read with nothing open did not leave Read — the rig is not pressing Back at all');
  assert.equal(await onToday(), true, 'CONTROL: Back from Read with nothing open did not land on Today');
  assert.deepEqual(errors, [], `the app threw:\n  ${errors.join('\n  ')}`);
});
