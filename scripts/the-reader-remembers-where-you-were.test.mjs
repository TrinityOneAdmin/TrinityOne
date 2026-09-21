// THE READER OPENS WHERE YOU LEFT OFF — and only where you could still be.
// Run: node --test scripts/the-reader-remembers-where-you-were.test.mjs
//
// Owner, 2026-09-21, after the member APK was updated on the Pixel: "it didn't keep my reading position". It
// never did. MEASURED at 3a8c980 in this file's own browser harness: boot → John 1; the reader's own "next"
// footer button pressed three times → John 4; reload → John 1, and localStorage held no reading place at all
// (only trinityone.readerSerif / trinityone.readerScale). The update only forced the relaunch that showed it.
//
// The fix in app/app.jsx: the place is written under trinityone.readLoc.<translation> on every change of `loc`
// (never on a scroll), and on boot resolveStartLoc() hands the reader that place back if the book is still
// in the translation that loaded, else Bible.defaultLoc() as before.
//
// TWO HALVES. The pure half slices resolveStartLoc out of app/app.jsx and RUNS it (CLAUDE.md rule 3 — app/*.jsx
// ships unbundled, so a text match would survive `false && `): the rows a browser cannot cheaply reach — a
// saved chapter past the end of the book, a saved place that is not even an object. The browser half is the
// point of use (rule 1): the real member app in headless Chromium against a throwaway gateway, with every
// production relay black-holed, driven ONLY through its own controls — the footer button, the Search overlay —
// and read back from what is on the screen after a REAL reload. Delete the restore from the boot effect and
// the pure rows stay green; `reload → John 4` goes red.
//
// MEASURED RED/GREEN, 2026-09-21 (each sabotage a scoped slice of the one function or effect it names, the
// anchor asserted to occur exactly once inside it before it is replaced — CLAUDE.md):
//   · as shipped                                                         8 pass / 0 fail
//   · boot effect restores nothing (`setLoc(Bible.defaultLoc())`, the old line)
//                                                                        6 pass / 2 fail — the reload row and the
//                                                                          cold-boot half of the Search row
//   · the persist effect's lsSet deleted                                 4 pass / 4 fail — every browser row that
//                                                                          reads the key back, and the write-count row
//   · resolveStartLoc: `installed.includes(book)` check deleted          6 pass / 2 fail — the pure "not installed"
//                                                                          row AND its browser row (chapter 1, see there)
//   · resolveStartLoc: the chapter-past-the-end check deleted            7 pass / 1 fail — its pure row alone
//
// WHAT THIS DOES NOT PROVE. Chromium is not the Android WebView and Page.reload is not a force-stop
// (CLAUDE.md rule 6). Device recipe: Pixel member app — read to Luke 3, force-stop, relaunch → Luke 3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8809, CDP = 9359;   // 8808/9358 = a-republished-module-reaches-a-phone; see scripts/test-ports.test.mjs
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// ── the pure half: resolveStartLoc, sliced out of app/app.jsx and RUN ─────────────────────────────────────
function realResolveStartLoc() {
  const src = fnBody(APP, 'function resolveStartLoc(', 'resolveStartLoc');
  return new Function(src + '; return resolveStartLoc;')();
}
const JOHN1 = { book: 43, chap: 1 };
const BOOKS = [1, 42, 43, 66];
const MAX = { 1: 50, 42: 24, 43: 21, 66: 22 };
const resolve = (saved, books = BOOKS) => realResolveStartLoc()(saved, () => books, b => MAX[b] || 1, JOHN1);

test('pure · no saved place → the default; a saved place in an installed book → that place, verse kept', () => {
  assert.deepEqual(resolve(null), JOHN1, 'nothing saved must fall back to the default');
  assert.deepEqual(resolve(undefined), JOHN1);
  assert.deepEqual(resolve({ book: 42, chap: 3 }), { book: 42, chap: 3 }, 'Luke 3 saved must open Luke 3');
  assert.deepEqual(resolve({ book: 42, chap: 3, verse: 4 }), { book: 42, chap: 3, verse: 4 }, 'a verse the reader arrived at is kept');
  assert.deepEqual(resolve({ book: '42', chap: '3' }), { book: 42, chap: 3 }, 'numbers that were stringified still resolve');
});

test('pure · a saved book the loaded translation does not hold → the default, no throw', () => {
  assert.deepEqual(resolve({ book: 42, chap: 3 }, [43, 66]), JOHN1,
    'Luke saved, but this translation has no Luke — the reader must not be stranded on a book that is gone');
  assert.deepEqual(resolve({ book: 42, chap: 3 }, []), JOHN1, 'no books at all');
  assert.deepEqual(realResolveStartLoc()({ book: 42, chap: 3 }, () => { throw new Error('boom'); }, () => 1, JOHN1), JOHN1,
    'a books() that throws must not take the reader down with it');
});

test('pure · a saved chapter past the end of the book, or garbage, → the default', () => {
  assert.deepEqual(resolve({ book: 42, chap: 25 }), JOHN1, 'Luke has 24 chapters; 25 must not be opened');
  assert.deepEqual(resolve({ book: 42, chap: 24 }), { book: 42, chap: 24 }, 'the last chapter is still a real place');
  for (const bad of ['Luke 3', 42, [42, 3], { book: 42 }, { chap: 3 }, { book: 42, chap: 0 }, { book: 42, chap: 'x' }, { book: NaN, chap: 1 }]) {
    assert.deepEqual(resolve(bad), JOHN1, 'garbage in storage must resolve to the default: ' + JSON.stringify(bad));
  }
  assert.deepEqual(resolve({ book: 42, chap: 3, verse: 0 }), { book: 42, chap: 3 }, 'a verse of 0 is no verse');
});

// ── the browser half: the real app, driven through its own controls ──────────────────────────────────────
let relay, dataDir, chr, ws, prof, send;
// Every uncaught exception the page throws, collected across boots. A saved place that the app cannot open
// must fall back quietly; a throw here is a failure even when the screen looks right.
const errors = [];


async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  await requireFreePort(PORT, 'the-reader-remembers-where-you-were.test.mjs');
  await requireFreePort(CDP, 'the-reader-remembers-where-you-were.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-readloc-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(getPublicKey(generateSecretKey())), RELAY_MAX_EVENTS: '2000' },
  });
  await waitReady();
  // Never let a test reach production: the app dials wss://app.trinityone.church and the Tailscale funnel from
  // CANONICAL_RELAYS regardless of where the page came from; resolving them to a dead port means it cannot.
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  prof = mkdtempSync(join(tmpdir(), 'trin-readloc-chr-'));
  // cwd is the throwaway profile, not the repo: Chromium drops a spellcheck dictionary into its cwd.
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
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      errors.push((e.exception?.description || e.text || '').split('\n')[0]);
    }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await settle();
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
const evalSoft = async (expr) => { try { return await evalIn(expr); } catch { return undefined; } };

// Wait for a module to actually register (Bible.loaded), then for loading to finish, then for React to paint.
// The order matters — see a-republished-module-reaches-a-phone-that-has-the-old-one.test.mjs for the two
// ways a reload harness lies when it polls the wrong thing.
async function settle() {
  for (let i = 0; i < 160; i++) { if (await evalSoft('!!(window.Bible && window.Bible.installModule)')) break; await sleep(250); }
  assert.ok(await evalIn('!!(window.Bible && window.Bible.installModule)'), 'window.Bible never appeared in the page');
  for (let i = 0; i < 200; i++) { if (await evalSoft('window.Bible.loaded === true') === true) break; await sleep(250); }
  for (let i = 0; i < 200; i++) { if (await evalSoft('window.Bible.loading === false') === true) break; await sleep(250); }
  for (let i = 0; i < 40; i++) { if (await where()) break; await sleep(250); }
  await sleep(1000);
}

// A REAL cold boot of the reader: a marker that must vanish proves a new page context, not the old one
// answering. `path` lets a test come back through a different door (the Search deep link, then the reader).
async function reboot(path = '/?tab=read') {
  await evalIn('window.__marker = 1');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${path}` });
  let fresh = false;
  for (let i = 0; i < 160; i++) { if (await evalSoft('typeof window.__marker === "undefined"') === true) { fresh = true; break; } await sleep(250); }
  assert.ok(fresh, 'the page never reloaded — the marker from the previous context survived');
  await settle();
}

// WHERE THE READER IS, read off the screen: the reader header's book and chapter buttons — the row of three
// pill buttons whose third is the translation. Nothing here asks the app what it thinks; it reads the
// header a member reads.
async function where() {
  return evalIn(`(() => {
    const rows = [...document.querySelectorAll('div')].filter(d => {
      const bs = [...d.children].filter(c => c.tagName === 'BUTTON' && c.style.borderRadius === '12px');
      return bs.length >= 3 && /^[A-Za-z0-9]{2,8}$/.test(bs[2].innerText.trim()) && /^\\d+$/.test(bs[1].innerText.trim());
    });
    if (!rows.length) return null;
    const bs = [...rows[0].children].filter(c => c.tagName === 'BUTTON');
    return bs[0].innerText.trim() + ' ' + bs[1].innerText.trim();
  })()`);
}

// The reader's own "next chapter" footer button, found by the label it renders — not by any handler.
async function pressNext() {
  const label = await evalIn(`(() => {
    const bs = [...document.querySelectorAll('button')].filter(b => b.style.borderRadius === '15px');
    if (bs.length !== 2) return null;
    bs[1].click(); return bs[1].innerText.trim();
  })()`);
  assert.ok(label, 'the reader has no prev/next footer pair to press');
  await sleep(500);
  return label;
}

const skip = () => !CHROME;
const savedKey = async () => evalIn(`'trinityone.readLoc.' + window.Bible.activeVersion`);
const saved = async () => evalIn(`(() => { try { return JSON.parse(localStorage.getItem('trinityone.readLoc.' + window.Bible.activeVersion)); } catch (e) { return 'unparseable'; } })()`);

test('with nothing saved, the reader opens at John 1', { skip: skip() }, async () => {
  await evalIn(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('trinityone.readLoc.')) localStorage.removeItem(k); return 1; })()`);
  await reboot();
  assert.equal(await where(), 'John 1', 'a first launch did not open at John 1');
  assert.deepEqual(errors, [], 'the page threw on a first launch');
});

test('turn three chapters with the footer button, reload → the reader opens at John 4', { skip: skip() }, async () => {
  assert.equal(await where(), 'John 1');
  const pressed = [];
  for (let i = 0; i < 3; i++) pressed.push(await pressNext());
  assert.deepEqual(pressed, ['John 2', 'John 3', 'John 4'], 'the footer button did not turn the pages it was pressed for');
  assert.equal(await where(), 'John 4');
  assert.deepEqual(await saved(), { book: 43, chap: 4 }, `the place was not written under ${await savedKey()} when the chapter turned`);
  await reboot();
  assert.equal(await where(), 'John 4', 'THE FINDING: reload took the reader back to John 1 instead of where they were');
  assert.deepEqual(errors, [], 'the page threw while restoring the place');
});

test('a saved place in a book this translation does not hold → John 1, and nothing throws', { skip: skip() }, async () => {
  // A book number the loaded translation does not have — picked from what the page says it holds, never assumed.
  // Chapter 1, deliberately: engine.js answers maxChapter(<unknown book>) with 1, so a saved chapter 2 would be
  // refused by the chapter check alone and this row would stay green with the installed-book check deleted.
  const ghost = await evalIn(`(() => { const bs = window.Bible.books(); let n = 1; while (bs.includes(n)) n++; return n; })()`);
  await evalIn(`localStorage.setItem('trinityone.readLoc.' + window.Bible.activeVersion, JSON.stringify({ book: ${ghost}, chap: 1 }))`);
  await reboot();
  assert.equal(await where(), 'John 1', `a saved place in book ${ghost} (not installed) stranded the reader instead of falling back`);
  assert.deepEqual(errors, [], 'restoring a place in an uninstalled book threw');
  assert.deepEqual(await saved(), { book: 43, chap: 1 }, 'the fallback place was not written back over the dead one');
});

test('a Search result (gotoRef) beats the saved place — and is itself the next place remembered', { skip: skip() }, async () => {
  await evalIn(`localStorage.setItem('trinityone.readLoc.' + window.Bible.activeVersion, JSON.stringify({ book: 43, chap: 4 }))`);
  await reboot('/?tab=search');           // the Search overlay open over the app, the saved place restored beneath it
  // Type a word only one chapter holds and press Enter, exactly as a member would.
  const typed = await evalIn(`(() => {
    const inp = document.querySelector('input[placeholder^="Search verses"]'); if (!inp) return null;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'Zacchaeus');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return inp.value;
  })()`);
  assert.equal(typed, 'Zacchaeus', 'the Search overlay did not open, or its input is not the one this test knows');
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) {
    await sleep(250);
    hit = await evalIn(`(() => { const d = [...document.querySelectorAll('div')].find(x => /^Luke 19:\\d+$/.test(x.innerText.trim())); if (!d) return null; d.click(); return d.innerText.trim(); })()`);
  }
  assert.match(hit || '', /^Luke 19:\d+$/, 'searching "Zacchaeus" produced no Luke 19 result to tap');
  await sleep(800);
  assert.equal(await where(), 'Luke 19', 'tapping a Search result did not move the reader — the saved place won over gotoRef');
  assert.deepEqual((await saved()) && { book: (await saved()).book, chap: (await saved()).chap }, { book: 42, chap: 19 }, 'the place the member navigated to was not the place saved');
  await reboot();
  assert.equal(await where(), 'Luke 19', 'after navigating to Luke 19, a cold boot did not open there');
  assert.deepEqual(errors, [], 'the page threw');
});

test('the place is written once per navigation, never on a scroll', { skip: skip() }, async () => {
  // Count writes of the reading-place key while the page scrolls. A persist wired to scroll position would
  // write here; a persist wired to `loc` writes nothing.
  await evalIn(`(() => {
    window.__writes = 0; const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('trinityone.readLoc.')) window.__writes++; return orig.call(this, k, v); };
    return 1; })()`);
  await evalIn(`(() => { const sc = document.querySelector('.no-scrollbar'); if (!sc) return 0; for (let y = 0; y < 2000; y += 100) { sc.scrollTop = y; sc.dispatchEvent(new Event('scroll', { bubbles: true })); } return sc.scrollTop; })()`);
  await sleep(600);
  assert.equal(await evalIn('window.__writes'), 0, 'scrolling the chapter wrote the reading place');
  await pressNext();
  assert.equal(await evalIn('window.__writes'), 1, 'turning one chapter did not write the place exactly once');
});
