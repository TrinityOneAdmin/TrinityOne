// A MODULE WHOSE BYTES DO NOT MATCH THE CATALOGUE'S PIN IS REFUSED.
// Run: node --test scripts/a-tampered-module-is-refused.test.mjs
//
// FOUND BY AUDIT, 2026-09-10, and it had been open the whole time. engine.js has carried a download-integrity
// check since SECURITY-AUDIT M3: `verifyIntegrity(url, bytes, declaredHash)` refuses bytes whose SHA-256 does
// not match either a catalogue entry's own `sha256` or one of the two hashes pinned in KNOWN_HASHES. But
// installModule only ever forwarded `item.sha256` on its `format: "JSON"` branch. The other branch — every
// Bible, every USFM zip, every commentary — called
//
//     fetchAndCacheModule(item.url, { abbr, name, category })          // no sha256
//
// so `declaredHash` arrived as `undefined`, `expected` fell back to KNOWN_HASHES, and a catalogue pin on
// anything that is not a JSON lexicon was decoration. Nobody had noticed because no entry in this repo's
// history carried a `sha256` until the Aquifer study notes did — the field was honoured on a path nothing
// used. The auditor proved it in headless Chromium: the study-notes entry with its pin replaced by zeros
// installed anyway and rendered 12 notes on 2 John 1.
//
// WHY IT MATTERS HERE AND NOT IN THE ABSTRACT. Modules come off a host over the network — our gateway, a
// church's own box, or a third-party mirror — and a commentary's HTML goes into the reader through
// dangerouslySetInnerHTML. window.sanitizeHtml stands behind that, so the pin is not the only guard, but a
// compromised or swapped mirror serving a module nobody checked is squarely inside this project's threat
// model (persecuted church, lawful compulsion, seizure). The pin is what makes "the bytes we published" a
// thing a phone can verify rather than a thing it has to trust the connection for.
//
// WHY THIS IS A BROWSER TEST. The decision under test is a real download: fetch, Response headers, an
// arrayBuffer, crypto.subtle.digest, IndexedDB, sql.js in WASM, and the cache-before-parse ordering. Lifting
// installModule into node would mean stubbing fetch and the cache, and the stub would be sitting exactly where
// the failure was — a function that received `undefined` and shrugged. So the real engine.js runs in a real
// browser, served by the real gateway, and each case is a genuine HTTP download of the real module file with
// IndexedDB emptied first.
//
// MEASURED RED/GREEN, 2026-09-10, scoped sabotage (installModule sliced out of engine.js, the anchor asserted
// to appear exactly once inside that slice, then replaced):
//   · with the fix                                                   4 pass / 0 fail
//   · `sha256: item.sha256` removed from the meta object again       2 pass / 2 fail — the tampered-pin
//     (i.e. the code exactly as it shipped before this branch)       cases, both of them; the two
//                                                                    "still installs" cases stay green,
//                                                                    which is the point of having them
//
// WHAT THIS DOES NOT PROVE. Not a device (CLAUDE.md rule 6): a phone's CapacitorHttp path to ASSET_BASE is
// not exercised, only same-origin fetch. It does not test the cache-hit path — fetchAndCacheModule returns
// cached bytes without re-verifying, which is pre-existing behaviour and out of scope here.
//
// Skips itself (rather than failing) when chromium is unavailable, so CI without a browser stays green —
// same contract as scripts/app-boots.test.mjs.
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

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8807, CDP = 9357;   // 8802-8806 and 9350-9356 are taken by the other browser/relay tests
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MODULE_URL = 'modules/aquifer-osn-eng.cmt.mybible.zip';
const ZEROS = '0'.repeat(64);
// The real pin, read out of catalog.json rather than retyped, so a rebuilt module does not silently make the
// "correct pin" case a second copy of the "no pin" case.
const REAL_SHA = (() => {
  const cat = JSON.parse(readFileSync(join(ROOT, 'catalog.json'), 'utf8'));
  const it = (cat.categories.find(c => c.id === 'commentaries').items || []).find(x => x.id === 'aquifer-osn-eng');
  assert.ok(it && /^[0-9a-f]{64}$/.test(it.sha256 || ''), 'catalog.json no longer pins the study notes — re-anchor this test');
  return it.sha256;
})();

let relay, dataDir, chr, ws, prof, send;

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  // Two singular calls rather than requireFreePorts([PORT, CDP]): test-ports.test.mjs's "every test that
  // binds a fixed port checks it first" guard matches the literal `requireFreePort(PORT` and
  // `requireFreePort(CDP`, so the plural convenience helper reads to it as no check at all. Same
  // shape as every other browser test here.
  await requireFreePort(PORT, 'a-tampered-module-is-refused.test.mjs');
  await requireFreePort(CDP, 'a-tampered-module-is-refused.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-pin-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(getPublicKey(generateSecretKey())), RELAY_MAX_EVENTS: '2000' },
  });
  await waitReady();

  // Never let a test reach production: the app dials app.trinityone.church and the funnel regardless of where
  // the page came from, so those names are resolved to a dead port (CLAUDE.md; scripts/sim-launch.mjs:51).
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  prof = mkdtempSync(join(tmpdir(), 'trin-pin-chr-'));
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1000,900', `http://127.0.0.1:${PORT}/`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
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

// ONE ATTEMPT, FROM AN EMPTY CACHE. IndexedDB is dropped and the page reloaded before each attempt, so the
// engine really downloads the file over HTTP and really hashes it — a cache hit would skip verifyIntegrity
// altogether and this file would be asserting nothing.
async function attempt(item) {
  await evalIn(`new Promise(res => { const r = indexedDB.deleteDatabase('bible-modules'); r.onsuccess = r.onerror = r.onblocked = () => res(1); })`);
  await evalIn(`(() => { localStorage.removeItem('trinityone.installed'); return 1; })()`);
  await send('Page.reload', { ignoreCache: false });
  // wait for the engine to be up (and for its own first-run defaults to settle, so nothing races us)
  for (let i = 0; i < 60; i++) { if (await evalIn('!!(window.Bible && window.Bible.installModule)')) break; await sleep(500); }
  assert.ok(await evalIn('!!(window.Bible && window.Bible.installModule)'), 'window.Bible.installModule never appeared in the page');
  await sleep(4000);
  return evalIn(`(async () => {
    const item = ${JSON.stringify(item)};
    const out = { ok: false, err: '', rows: 0, cached: false, installed: false };
    try { await window.Bible.installModule(item); out.ok = true; }
    catch (e) { out.err = String(e && e.message || e); }
    try { out.rows = (window.Bible.getCommentary(63, 1) || []).reduce((n, b) => n + b.rows.length, 0); } catch (e) {}
    out.installed = !!window.Bible.isInstalled(item.url);
    out.cached = await new Promise(res => {
      const q = indexedDB.open('bible-modules', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('modules');
      q.onsuccess = () => { try { const g = q.result.transaction('modules', 'readonly').objectStore('modules').get(item.url); g.onsuccess = () => res(!!g.result); g.onerror = () => res(false); } catch (e) { res(false); } };
      q.onerror = () => res(false);
    });
    return out;
  })()`);
}

const base = { id: 'aquifer-osn-eng', name: 'Aquifer Open Study Notes', abbr: 'OSN',
  kind: 'comment', format: 'MySword', url: MODULE_URL };

test('a module whose bytes do not match the catalogue pin is REFUSED, and never reaches the reader',
  { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
    const r = await attempt({ ...base, sha256: ZEROS });
    assert.equal(r.ok, false,
      'installModule RESOLVED for a module whose sha256 does not match the pin — the integrity check is not reached');
    assert.match(r.err, /integrity check failed/i,
      `the refusal did not come from verifyIntegrity; it said ${JSON.stringify(r.err)}`);
    assert.equal(r.rows, 0,
      `${r.rows} study notes reached the Study panel from a module that failed its pin`);
    assert.equal(r.installed, false, 'a module that failed its pin was recorded as installed');
  });

test('the refused bytes are not cached either, so a reload cannot resurrect them',
  { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
    // verifyIntegrity is called BEFORE cachePut. If that order ever flipped, the tampered bytes would sit in
    // IndexedDB and restoreInstalled/fetchAndCacheModule would serve them from the cache on the next launch
    // without hashing anything — a one-time refusal followed by permanent acceptance.
    const r = await attempt({ ...base, sha256: ZEROS });
    assert.equal(r.cached, false, 'the bytes that failed the pin were written to the module cache anyway');
  });

test('the same module with its REAL pin installs and reaches the Study panel',
  { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
    // The control that stops the test above from passing for the wrong reason (a broken URL, a 404, a module
    // that cannot parse). Same page, same URL, same download — only the pin differs.
    const r = await attempt({ ...base, sha256: REAL_SHA });
    assert.equal(r.err, '', `installing with the correct pin failed: ${r.err}`);
    assert.equal(r.ok, true, 'the module did not install even with the pin that matches its bytes');
    assert.ok(r.rows >= 5, `only ${r.rows} notes reached the Study panel for 2 John 1`);
    assert.equal(r.cached, true, 'the verified module was not cached, so it would re-download every launch');
  });

test('an entry with NO pin still installs — every other catalogue entry has none',
  { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
    // The regression this fix could most easily have caused. Nothing in catalog.json and none of the 1,290
    // entries in ebible-catalog.json carries a sha256, so if forwarding the field had turned "absent" into
    // "mismatch" the entire library would have become uninstallable. verifyIntegrity treats a falsy
    // declaredHash as "nothing pinned here" — asserted, not assumed.
    const r = await attempt({ ...base });
    assert.equal(r.err, '', `an un-pinned entry was refused: ${r.err}`);
    assert.equal(r.ok, true, 'an entry with no sha256 no longer installs — the rest of the catalogue is broken');
    assert.ok(r.rows >= 5, `only ${r.rows} notes reached the Study panel from an un-pinned install`);
  });
