// A MODULE REPUBLISHED AT THE SAME URL REACHES A PHONE THAT ALREADY HAS THE OLD ONE.
// Run: node --test scripts/a-republished-module-reaches-a-phone-that-has-the-old-one.test.mjs
//
// OWNER DECISION, 2026-09-10: "fix it so the app checks against what's published."
// (reference/SCOPE-BIBLE-CONTENT-AQUIFER-2026-09-10.md, "OWNER DECISION — fix the module update path
// BEFORE slice 2".)
//
// THE DEFECT. engine.js cached a module in IndexedDB on first install and then, on every path that could
// find it there, handed the cached bytes back without ever looking at the catalogue's `sha256` again:
//
//   fetchAndCacheModule    if(cached) return loadModuleBytes(cached, …)      // pin never re-read
//   installModule (JSON)   let bytes = await cacheGet(url); if(!bytes){ …verify… }
//   restoreInstalled       await loadModuleBytes(bytes, …)                   // no verification AT ALL,
//                                                                           // on every cold boot
//
// So a phone that installed v1 of a module kept v1 for ever, silently. Republishing at the same url was a
// provable no-op for anyone who already had it. That collides with the pilot rule "add, never repurpose",
// and slice 2 publishes ten languages at ten urls that will each be rebuilt at least once — every one of
// them would have been stranded on its first build.
//
// THIS IS AN UPDATE MECHANISM, NOT A SECURITY FIX, and nothing here should be read as one. Bytes that fail
// their pin never entered the cache even before this change (verifyIntegrity runs before cachePut, and
// a-tampered-module-is-refused.test.mjs holds that order down), and on native an attacker who can write
// this IndexedDB can already patch the APK. What was broken was distribution, not defence.
//
// WHY A BROWSER TEST. The defect lives across a fetch/cache seam: IndexedDB, crypto.subtle, the real
// service worker, sql.js in WASM, and a real page reload for the cold-boot case. A stubbed cache would sit
// exactly where the hole is — the whole bug was a cache read that returned early — so the real engine.js
// runs in a real browser served by the real gateway, and "cold boot" means Page.reload, not calling
// restoreInstalled() by hand.
//
// HOW "THE PHONE HAS AN OLDER BUILD" IS MODELLED. The catalogue keeps its real pin and the CACHE is seeded
// with different bytes. That is the mechanism under test either way — cached bytes whose hash is not the
// published pin — and it has one advantage over seeding a genuine older module: bytes that cannot parse
// make "the stale copy was used" observable as zero notes on the screen, instead of quietly rendering
// content that looks almost the same. Where a test needs valid module bytes under an un-pinned url, the
// real module is copied there.
//
// MEASURED RED/GREEN, 2026-09-10, every row from a run against THIS file (scoped sabotage: the enclosing
// function sliced out of engine.js with fnBody, the anchor asserted to appear exactly ONCE inside that
// slice, then replaced only there):
//   · with the fix                                                       7 pass / 0 fail
//   · fetchAndCacheModule's cache-hit guard reverted to `if(cached)`      5 pass / 2 fail — T1 AND T4
//   · restoreInstalled's `cachedCopyIsCurrent` check made `if(false)`     6 pass / 1 fail — T4
//   · installModule's JSON cache-hit check deleted                        6 pass / 1 fail — T6
//   · cachedCopyIsCurrent's "no pin, nothing to check" made to return     5 pass / 2 fail — T3 and T5,
//     false, i.e. "treat every un-pinned module as superseded"              the un-pinned controls
//
// The first row was predicted as one failure and measured as two. The reason is worth keeping: T4's cold
// boot recovers by calling installModule, which goes through fetchAndCacheModule, so the cold-boot case
// depends on BOTH guards and reverting either one breaks it. One download-and-verify implementation rather
// than two is deliberate; it also means those two tests are not independent.
//
// ALWAYS RUN THE BASELINE ROW. The first attempt at this matrix reported 0 pass / 7 fail on every row
// INCLUDING the baseline, and including the first test below, which only reads files and never opens a
// browser. A killed earlier run had orphaned a gateway on 8808 and a Chrome on 9358, so requireFreePort
// failed in before() and took every test with it. Five identical failing rows look exactly like five
// biting sabotages; the baseline is the only thing that tells them apart.
//
// WHICH OF THESE BITE ON THE OLD CODE. T1 and T4 are the fix: both fail against engine.js as it shipped
// before this branch. T2, T3 and T5 pass against the old code too, on purpose — they are the controls that
// stop the fix from being implemented as "hash and re-download everything on every launch", which would
// slow every launch and re-download 1,290 un-pinned catalogue entries. The third sabotage above is exactly
// that mistake, and T3 and T5 catch it.
//
// WHAT THIS DOES NOT PROVE. Not a device (CLAUDE.md rule 6): a phone's CapacitorHttp path to ASSET_BASE is
// not exercised, only same-origin fetch. It does not prove the one-launch-late behaviour of catalog.json
// (sw.js:133 serves it cache-first with a background refresh, so a moved pin is seen on the launch AFTER
// republication) — that is measured on the device and recorded in engine.js's comment, not asserted here.
// It does not cover loadAsset(), which is cache-first with no pin at all and carries none by design.
//
// Skips itself when chromium is unavailable, so CI without a browser stays green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8808, CDP = 9358;   // 8807/9357 are a-tampered-module-is-refused; see scripts/test-ports.test.mjs
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MODULE_URL = 'modules/aquifer-osn-eng.cmt.mybible.zip';
// A url that exists in NO catalogue and in no KNOWN_HASHES, standing in for the 1,290 un-pinned entries in
// ebible-catalog.json. Nothing is served at it either, so a module that loads from this url can only have
// come out of the cache — a re-download would 404 and render nothing.
const UNPINNED_URL = 'modules/an-unpinned-copy-for-this-test.zip';

// The real pin, read out of catalog.json rather than retyped, so a rebuilt module cannot silently turn the
// "published pin" cases into something else.
const REAL_SHA = (() => {
  const cat = JSON.parse(readFileSync(join(ROOT, 'catalog.json'), 'utf8'));
  const it = (cat.categories.find(c => c.id === 'commentaries').items || []).find(x => x.id === 'aquifer-osn-eng');
  assert.ok(it && /^[0-9a-f]{64}$/.test(it.sha256 || ''), 'catalog.json no longer pins the study notes — re-anchor this test');
  return it.sha256;
})();
// Belt and braces: the pin must actually be the hash of the file on disk, or every case below is testing
// something other than what it claims.
const DISK_SHA = createHash('sha256').update(readFileSync(join(ROOT, MODULE_URL))).digest('hex');

// The bundled lexicon, pinned in engine.js's KNOWN_HASHES rather than in any catalogue — the other half of
// where a pin can come from. Hashed from the file on disk so the test cannot drift from what is shipped.
const LEX_URL = 'modules/strongs-dict.json';
const LEX_SHA = createHash('sha256').update(readFileSync(join(ROOT, LEX_URL))).digest('hex');

let relay, dataDir, chr, ws, prof, send, reqs = [];

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  // One call per port, by name — the shape test-ports.test.mjs's structural guards can read.
  await requireFreePort(PORT, 'a-republished-module-reaches-a-phone-that-has-the-old-one.test.mjs');
  await requireFreePort(CDP, 'a-republished-module-reaches-a-phone-that-has-the-old-one.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-republish-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(getPublicKey(generateSecretKey())), RELAY_MAX_EVENTS: '2000' },
  });
  await waitReady();

  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  prof = mkdtempSync(join(tmpdir(), 'trin-republish-chr-'));
  // cwd is the throwaway profile dir, not the repo: Chromium drops a spellcheck dictionary
  // (en-US-*.bdic) into its working directory and it was landing in the source tree.
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1000,900', `http://127.0.0.1:${PORT}/`],
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
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    // Every request the page's network layer is asked to make. This is how "was it re-downloaded?" is
    // answered without trusting anything the page says about itself.
    if (m.method === 'Network.requestWillBeSent' && m.params && m.params.request) reqs.push(m.params.request.url);
  });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
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

const countModuleRequests = (needle) => reqs.filter(u => u.includes(needle)).length;
const markRequests = () => { reqs = []; };

// Helpers injected into the page. Written once here so each test reads as what it is testing.
const PAGE_HELPERS = `
  window.__t = {
    idbPut: (url, bytes) => new Promise(res => {
      const q = indexedDB.open('bible-modules', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('modules');
      q.onsuccess = () => { const tx = q.result.transaction('modules', 'readwrite');
        tx.objectStore('modules').put(bytes, url); tx.oncomplete = () => res(1); tx.onerror = () => res(0); };
      q.onerror = () => res(0);
    }),
    idbGet: (url) => new Promise(res => {
      const q = indexedDB.open('bible-modules', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('modules');
      q.onsuccess = () => { try { const g = q.result.transaction('modules', 'readonly').objectStore('modules').get(url);
        g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); } catch (e) { res(null); } };
      q.onerror = () => res(null);
    }),
    sha: async (u8) => u8 ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].map(b => b.toString(16).padStart(2, '0')).join('') : '',
    notes: () => { try { return (window.Bible.getCommentary(63, 1) || []).reduce((n, b) => n + b.rows.length, 0); } catch (e) { return -1; } },
  };
  1`;

// Empty everything a phone could be carrying, then reload into a genuinely first-run app.
async function resetAll() {
  await evalIn(`new Promise(res => { const r = indexedDB.deleteDatabase('bible-modules'); r.onsuccess = r.onerror = r.onblocked = () => res(1); })`);
  await evalIn(`(() => { localStorage.removeItem('trinityone.installed'); return 1; })()`);
  await reload();
}

// A REAL cold boot: the page reloads, engine.js re-runs, autoLoad() calls restoreInstalled() unattended.
//
// TWO WAYS THIS HARNESS CAN LIE, both found by running the same probe against the phone, where the timings
// are slow enough to expose them. Neither is hypothetical: the first version of the device probe reported
// a launch with ZERO notes, which was the instrument and not the app, and it took a third run to see it.
//   1. Polling for window.Bible straight after Page.reload is answered by the OLD page context, which
//      still has a fully settled window.Bible. The poll returns immediately and everything measured
//      afterwards belongs to the PREVIOUS launch. A marker that must vanish proves a new context.
//   2. window.Bible.loading is false BEFORE autoLoad sets it true, so "wait until loading === false"
//      is satisfied before restoreInstalled has even started. Waiting for `loaded` (a module actually
//      registered) first, and only then for loading to go false, waits for real work to have happened.
const evalSoft = async (expr) => { try { return await evalIn(expr); } catch { return undefined; } };
async function reload() {
  await evalIn('window.__marker = 1');
  await send('Page.reload', { ignoreCache: false });
  let fresh = false;
  for (let i = 0; i < 160; i++) { if (await evalSoft('typeof window.__marker === "undefined"') === true) { fresh = true; break; } await sleep(250); }
  assert.ok(fresh, 'the page never reloaded — the marker from the previous context survived');
  for (let i = 0; i < 160; i++) { if (await evalSoft('!!(window.Bible && window.Bible.installModule)')) break; await sleep(250); }
  assert.ok(await evalIn('!!(window.Bible && window.Bible.installModule)'), 'window.Bible never appeared in the page');
  await evalIn(PAGE_HELPERS);
  // a module registered — on a first run that is the bundled default, otherwise whatever was restored
  for (let i = 0; i < 200; i++) { if (await evalSoft('window.Bible.loaded === true') === true) break; await sleep(250); }
  for (let i = 0; i < 200; i++) { if (await evalSoft('window.Bible.loading === false') === true) break; await sleep(250); }
  await sleep(1500);
}

const base = { id: 'aquifer-osn-eng', name: 'Aquifer Open Study Notes', abbr: 'OSN',
  kind: 'comment', format: 'MySword', url: MODULE_URL };

const install = (item) => evalIn(`(async () => {
  const out = { ok: false, err: '' };
  try { await window.Bible.installModule(${JSON.stringify(item)}); out.ok = true; }
  catch (e) { out.err = String(e && e.message || e); }
  out.notes = window.__t.notes();
  out.cachedSha = await window.__t.sha(await window.__t.idbGet(${JSON.stringify(item.url)}));
  return out;
})()`);

// Replace the cached copy with bytes that are NOT the published build.
const seedStaleCache = (url) => evalIn(`window.__t.idbPut(${JSON.stringify(url)}, new Uint8Array(2048).fill(7)).then(r => r)`);

test('every pin this app ships really is the hash of the file it ships', () => {
    // Not decoration. This fix makes a cache hit re-check the pin on EVERY launch, so a pin that does not
    // match the shipped file no longer fails once at install — it re-downloads the same module on every
    // single launch, for ever. Both sources of a pin are checked: the catalogue, and engine.js's
    // KNOWN_HASHES (which is where the two bundled defaults get theirs).
    assert.equal(DISK_SHA, REAL_SHA,
      `catalog.json pins ${REAL_SHA} but modules/ holds ${DISK_SHA} — rebuild the module or re-pin it; ` +
      'until they agree every other case in this file is testing the wrong thing');

    const engine = readFileSync(join(ROOT, 'engine.js'), 'utf8');
    const block = engine.slice(engine.indexOf('const KNOWN_HASHES'));
    const known = Object.fromEntries([...block.slice(0, block.indexOf('};') + 2)
      .matchAll(/"([^"]+)":\s*"([0-9a-f]{64})"/g)].map(m => [m[1], m[2]]));
    assert.ok(Object.keys(known).length >= 2, 'KNOWN_HASHES could not be read out of engine.js');
    for (const [url, pin] of Object.entries(known)) {
      const onDisk = createHash('sha256').update(readFileSync(join(ROOT, url))).digest('hex');
      assert.equal(onDisk, pin,
        `KNOWN_HASHES pins ${url} at ${pin} but the file on disk hashes to ${onDisk} — every launch would ` +
        're-download it and never be satisfied');
    }
    assert.equal(known[LEX_URL], LEX_SHA, 'the lexicon pin used by T6 is not the one engine.js ships');
  });

test('T1 · INSTALL over a cached copy that is no longer the published build re-downloads it',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
    await resetAll();
    const first = await install({ ...base, sha256: REAL_SHA });
    assert.equal(first.err, '', `the first install failed: ${first.err}`);
    assert.equal(first.cachedSha, REAL_SHA, 'the first install did not leave the published bytes in the cache');

    await seedStaleCache(MODULE_URL);
    markRequests();
    const again = await install({ ...base, sha256: REAL_SHA });

    assert.equal(again.err, '', `installing over a superseded cached copy failed: ${again.err}`);
    assert.ok(again.notes >= 5,
      `only ${again.notes} notes reached the Study panel — the stale cached copy was used instead of the published one`);
    assert.equal(again.cachedSha, REAL_SHA,
      'the cache still does not hold the published bytes, so the next launch would read the stale copy again');
    assert.ok(countModuleRequests('aquifer-osn-eng') >= 1,
      'no request was made for the module: the cache-hit branch returned the superseded bytes without checking the pin');
  });

test('T2 · a cached copy that IS the published build is served from cache, with no re-download',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
    // The regression guard. The cheap way to "fix" the bug is to download every time, which would put a
    // 2 MB fetch on every install tap and, with slice 2's ten languages, on every launch.
    await resetAll();
    const first = await install({ ...base, sha256: REAL_SHA });
    assert.equal(first.err, '', `the first install failed: ${first.err}`);

    markRequests();
    const again = await install({ ...base, sha256: REAL_SHA });
    assert.equal(again.err, '', `re-installing an up-to-date module failed: ${again.err}`);
    assert.ok(again.notes >= 5, `only ${again.notes} notes after a cache-served install`);
    assert.equal(countModuleRequests('aquifer-osn-eng'), 0,
      'the module was re-downloaded even though the cached copy matches the published pin — every install ' +
      'tap and every launch now pays for a download it does not need');
  });

test('T3 · an UN-PINNED entry is still served from the cache, exactly as before',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
    // Nothing in catalog.json except the study notes carries a sha256, and all 1,290 entries in
    // ebible-catalog.json are un-pinned. If "no pin" ever came to mean "cannot verify, so re-download",
    // the whole library would re-download on every launch.
    await resetAll();
    const first = await install({ ...base });
    assert.equal(first.err, '', `an un-pinned entry was refused: ${first.err}`);

    markRequests();
    const again = await install({ ...base });
    assert.equal(again.err, '', `re-installing an un-pinned entry failed: ${again.err}`);
    assert.ok(again.notes >= 5, `only ${again.notes} notes from an un-pinned cache-served install`);
    assert.equal(countModuleRequests('aquifer-osn-eng'), 0,
      'an un-pinned module was re-downloaded from the cache-hit path — that is 1,290 catalogue entries ' +
      'downloading again on every launch');
  });

test('T4 · COLD BOOT with a superseded cached copy does not load it, and fetches the published build',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
    // THE ONE THAT MATTERS. restoreInstalled runs on every launch with nobody watching, and verified
    // nothing whatsoever. Driven through a real Page.reload rather than by calling restoreInstalled(),
    // because "does the app do this on boot" is the claim.
    await resetAll();
    const first = await install({ ...base, sha256: REAL_SHA });
    assert.equal(first.err, '', `the first install failed: ${first.err}`);
    assert.ok(await evalIn(`window.Bible.isInstalled(${JSON.stringify(MODULE_URL)})`), 'the module was not recorded as installed');

    await seedStaleCache(MODULE_URL);
    markRequests();
    await reload();

    const out = await evalIn(`(async () => ({
      notes: window.__t.notes(),
      cachedSha: await window.__t.sha(await window.__t.idbGet(${JSON.stringify(MODULE_URL)})),
      err: window.Bible._error || '',
    }))()`);
    assert.ok(out.notes >= 5,
      `after a cold boot only ${out.notes} notes reached the Study panel — restoreInstalled loaded the ` +
      'superseded cached copy (or nothing at all) instead of fetching what is published');
    assert.equal(out.cachedSha, REAL_SHA,
      'the cache was not refreshed to the published bytes on cold boot, so the phone is still stranded');
    assert.ok(countModuleRequests('aquifer-osn-eng') >= 1,
      'cold boot made no request for the module: the pin was never compared against the cached copy');
  });

test('T6 · a cached JSON lexicon that is no longer the published build is re-downloaded too',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
    // THE THIRD CACHE-HIT SITE, which the brief did not name: installModule's `format: "JSON"` branch had
    // the same shape as the other two — `let bytes = await cacheGet(url); if(!bytes){ …verify… }` — so a
    // cached dictionary was handed to loadDictJSON without the pin being looked at again. Narrower than
    // the other two in practice (removeModule deletes the cache entry, and _ensureFullLexicon returns
    // early once the lexicon is recorded as installed), but it is the same defect and it is driven
    // directly here rather than left as an assertion nobody checks.
    //
    // Strong's carries no `sha256` in any catalogue; its pin is KNOWN_HASHES['modules/strongs-dict.json'],
    // which is the other half of the same "no pin means nothing to check" rule.
    await resetAll();
    const seeded = await evalIn(`window.__t.idbPut(${JSON.stringify(LEX_URL)}, new Uint8Array(2048).fill(9))`);
    assert.equal(seeded, 1, 'could not seed a superseded lexicon into the cache');

    markRequests();
    const out = await evalIn(`(async () => {
      const o = { ok: false, err: '' };
      try { await window.Bible.installModule(${JSON.stringify({ id: 'strongs', abbr: "Strong's", name: "Strong's Greek & Hebrew Dictionary", kind: 'dict', format: 'JSON', category: 'dictionaries', url: LEX_URL })}); o.ok = true; }
      catch (e) { o.err = String(e && e.message || e); }
      o.cachedSha = await window.__t.sha(await window.__t.idbGet(${JSON.stringify(LEX_URL)}));
      const d = window.Bible.lex('G26');
      o.defined = !!(d && (d.def || d.short || d.gloss));
      return o;
    })()`);

    assert.equal(out.err, '', `installing over a superseded cached lexicon failed: ${out.err}`);
    assert.equal(out.cachedSha, LEX_SHA,
      'the cache still holds the superseded lexicon — the JSON branch returned it without checking the pin');
    assert.ok(countModuleRequests('strongs-dict') >= 1,
      'no request was made for the lexicon: the JSON cache-hit branch never compared the pin');
    assert.equal(out.defined, true, 'the re-downloaded lexicon does not resolve a Strong\'s number');
  });

test('T5 · COLD BOOT of an un-pinned module loads from the cache and asks the network for nothing',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
    await resetAll();
    // Copy the real module to a url that no catalogue pins and nothing serves, and record it as installed.
    const seeded = await evalIn(`(async () => {
      const u8 = new Uint8Array(await (await fetch(${JSON.stringify(MODULE_URL)})).arrayBuffer());
      await window.__t.idbPut(${JSON.stringify(UNPINNED_URL)}, u8);
      localStorage.setItem('trinityone.installed', JSON.stringify({ ${JSON.stringify(UNPINNED_URL)}: {
        url: ${JSON.stringify(UNPINNED_URL)}, id: 'unpinned', abbr: 'OSN', name: 'Aquifer Open Study Notes',
        kind: 'comment', format: 'MySword', category: 'commentaries' } }));
      return u8.byteLength;
    })()`);
    assert.ok(seeded > 1000000, `the un-pinned copy was not seeded (${seeded} bytes)`);

    markRequests();
    await reload();

    const notes = await evalIn('window.__t.notes()');
    assert.ok(notes >= 5,
      `an un-pinned module in the cache produced only ${notes} notes after a cold boot — nothing is served ` +
      'at its url, so this can only mean the cached copy was not used');
    assert.equal(countModuleRequests('an-unpinned-copy-for-this-test'), 0,
      'the un-pinned module was fetched over the network on cold boot; its url 404s, so this both wastes a ' +
      'request and would lose the module');
  });
