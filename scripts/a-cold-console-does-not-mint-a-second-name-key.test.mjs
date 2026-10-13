// A COLD CONSOLE DOES NOT MINT A SECOND NAME KEY WHILE THE RELAY THAT HOLDS THE FIRST IS STILL BEING PROVED.
//   Run: node --test scripts/a-cold-console-does-not-mint-a-second-name-key.test.mjs
//
// The bug (on main since 267fa08): the name key's first-mint gate was `_nameKeyChecked` — "every relay in relays()
// answered". relays() holds only the relays already PROVED on this device, and a cold console proves them one at a
// time in the background. So the first relay proved, if it held no envelope, decided "this church has no name key",
// the console minted a new one over the real one on the other relay, and newest-wins made every name sealed under the
// old key unreadable. The real envelope, arriving later, was refused as older.
//
// THE POINT OF USE (CLAUDE.md rule 1): two real gateways on FREE ports, the real console in headless chromium, church A
// made by the wizard on relay 1 (so its name key is on relay 1 ONLY), relay 2 added through addRelay. Then the console
// is made COLD — its proved-relay cache and its device copy of the envelope removed — and relay 1's identity proof is
// held for ~5 s in the page (under the 6 s proof timeout, so it still succeeds), so relay 2, empty, is proved first.
// Every name-key envelope the console sends is captured off its socket and opened in node with the church key.
// Row 2: a NEW church (fresh origin, relay 2's page, relay 1 added before the wizard) still gets its first key.
// Row 3: the device copy — relay 1's proof made to FAIL outright, so nothing on the relays says a key exists; the
// console that has seen the key re-uses it rather than minting. TEST-ENV ONLY: Page.setBypassCSP (see the
// a-blocklist-held-by-one-of-two-relays header). Skips itself without chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { nip19, nip44, getPublicKey } from 'nostr-tools';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const NAMEKEY_D = 'trinityone/namekey:';

let r1, r2, chr, ws, prof, evalIn, cdpSend, churchA = '', ASK = null, K0 = '';
const errors = [];
function held(relay, d) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT raw FROM events WHERE kind = 30078 AND dtag = ?').all(d).map(r => { try { return JSON.parse(String(r.raw || '')); } catch { return {}; } }); }
  finally { db.close(); }
}
// the ring an envelope gives the church — opened with the church key, as the console opens it
const ringOf = (e, sk) => { try { const me = getPublicKey(sk); const ct = JSON.parse(e.content).keys[me]; return JSON.parse(nip44.v2.decrypt(ct, nip44.v2.utils.getConversationKey(sk, e.pubkey))); } catch { return null; } };
const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const typeInto = (sel, val) => `(() => { const i=document.querySelector(${JSON.stringify(sel)}); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
async function waitFor(expr, ms = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return true; } catch {} await sleep(400); }
  throw new Error('timed out waiting for: ' + label);
}
const press = async (re, label) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${label || re}`); await sleep(500); };
async function unlock() {
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
  await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 90000, 'the dashboard');
}
async function reload() { await evalIn(`(() => { location.reload(); return 'ok'; })()`); await sleep(3000); await unlock(); }
async function wizard(name) {
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
  await press('/Start a new church/i');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  const cp = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', name)), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  return cp;
}
// Every name-key EVENT the console sends; and relay 1's identity proof held (window.__holdMs) or failed (__failR1).
// The hold is under the proof's own 6 s timeout, so the proof still SUCCEEDS — just after relay 2's.
const hook = (port) => `(() => { if (window.__nkHooked) return; window.__nkHooked = 1; window.__nk = [];
  const os = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) { try { if (typeof d === 'string' && d.startsWith('["EVENT"')) { const e = JSON.parse(d)[1]; const dd = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
      if (dd.startsWith('trinityone/namekey:')) window.__nk.push(e); } } catch (x) {} return os.call(this, d); };
  const of = window.fetch;
  window.fetch = function (u, o) { const s = String((u && u.url) || u);
    if (s.includes(':${port}/relay-identity')) {
      let mode = ''; try { mode = sessionStorage.getItem('t1test.r1proof') || ''; } catch (x) {}
      if (mode === 'fail') return Promise.reject(new TypeError('test: relay 1 unreachable'));
      if (mode === 'hold') return new Promise(r => setTimeout(r, 5000)).then(() => of.call(this, u, o));
    }
    return of.call(this, u, o); };
})();`;

before(async () => {
  if (!CHROME) return;
  r1 = await H.startRelay({ name: 'namekey-cold-1', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  r2 = await H.startRelay({ name: 'namekey-cold-2', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the cold name-key test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-nkcold-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${r1.base}/steward.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  cdpSend = send;
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  // church A, by the wizard, on relay 1 — its first name key lands there
  churchA = await wizard('St Brendan Cold Console');
  const npubA = await evalIn(`window.Steward.npub || ''`);
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(r1.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'relay 1 never registered church A'); }
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
  await reload();
  await waitFor(`window.Steward.nameKeyReady()`, 90000, 'church A\'s name key (relay 1)');
  ASK = privateKeyFromSeedWords(await evalIn('window.Steward.exportMnemonic()'));
  const on1 = held(r1, NAMEKEY_D + churchA);
  assert.equal(on1.length, 1, 'CONTROL: relay 1 does not hold church A\'s name key');
  K0 = (ringOf(on1[0], ASK) || [])[0] || '';
  assert.match(K0, /^[0-9a-f]{64}$/, 'CONTROL: church A\'s name key on relay 1 does not open with the church key');
  const reg2 = await fetch(r2.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r2.adminToken },
    body: JSON.stringify({ addChurch: { npub: npubA, name: 'Church A' } }) });
  assert.equal(reg2.status, 200, 'relay 2 would not register church A');
  await evalIn(`window.Steward.addRelay(${JSON.stringify(r2.wsUrl)})`);
  await cdpSend('Page.enable');
  await cdpSend('Page.setBypassCSP', { enabled: true });   // TEST-ENV ONLY — see the header
  await cdpSend('Page.addScriptToEvaluateOnNewDocument', { source: hook(r1.port) });
  await reload();
  await waitFor(`(window.Steward.relayList() || []).length >= 2`, 90000, 'relay 2 admitted (proved)');
  await sleep(4000);
  assert.equal(held(r2, NAMEKEY_D + churchA).length, 0, 'CONTROL: relay 2 holds church A\'s name key — it must be on relay 1 ONLY');
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;
// Cold: no proved relays remembered, and (unless `keepCopy`) no device copy of the envelope — a console that has never
// seen this church's key on this device (another laptop, cleared storage).
async function goCold(mode, keepCopy) {
  await evalIn(`(() => { localStorage.removeItem('trinityone.relays.verified');
    ${keepCopy ? '' : `localStorage.removeItem('trinityone.steward.keyenv.name.' + ${JSON.stringify(churchA)});`}
    sessionStorage.setItem('t1test.r1proof', ${JSON.stringify(mode)}); return 1; })()`);
  await reload();
  await evalIn('(() => { window.__nk = window.__nk || []; return 1; })()');
}
const sentRings = async () => (await evalIn('window.__nk || []')).filter(e => ((e.tags.find(t => t[0] === 'd') || [])[1] || '') === NAMEKEY_D + churchA).map(e => ringOf(e, ASK));

test('cold console, relay 2 (empty) proved before relay 1 (holds the key): no new name key is minted, and the original is used once relay 1 answers', { skip: SKIP, timeout: 300000 }, async () => {
  await goCold('hold', false);
  assert.equal(await evalIn(`localStorage.getItem('trinityone.steward.keyenv.name.' + ${JSON.stringify(churchA)})`), null, 'CONTROL: the device copy is still there — this row is about a console that never saw the key');
  // relay 2 is proved and read first; relay 1 is proved ~5 s later; then the read re-opens over both
  // THE WINDOW: relay 2 proved and its name-key read settled ("looked"), relay 1 still being proved. The roster tick
  // would call this any moment; it is called here so the window cannot be missed (any caller reaches the same gate).
  await waitFor(`(window.Steward.relayList() || []).length === 1 && window.Steward.keysFresh('name')`, 30000, 'relay 2 alone admitted and read');
  const asked = await evalIn(`Promise.resolve(window.Steward.ensureNameKeyForMembers([], [])).then(r => r === null ? 'null' : r === false ? 'false' : 'published')`);
  assert.equal((await evalIn('window.Steward.relayList()')).length, 1, 'CONTROL: relay 1 was proved before the call — the window this row is about was missed');
  assert.notEqual(asked, 'published', 'A COLD CONSOLE MINTED A NAME KEY from relay 2\'s empty answer while relay 1, which holds the church\'s key, was still being proved');
  await waitFor(`(window.Steward.relayList() || []).length >= 2`, 60000, 'both relays admitted');
  await waitFor(`window.Steward.nameKeyReady()`, 60000, 'the console holding a name key');
  await sleep(8000);   // the enrolment ticks on; a mint would have happened by now
  const rings = await sentRings();
  const minted = rings.filter(r => !r || r[0] !== K0);
  assert.deepEqual(minted.map(r => r && r[0] && r[0].slice(0, 8)), [], `A COLD CONSOLE MINTED A NEW NAME KEY over the one relay 1 holds — it decided "no key" from relay 2 alone (sent ${rings.length} envelope(s))`);
  for (const r of [r1, r2]) for (const e of held(r, NAMEKEY_D + churchA)) assert.equal((ringOf(e, ASK) || [])[0], K0, `${r === r1 ? 'relay 1' : 'relay 2'} now holds a name key that is not the church's original`);
  // the original IS the key in use: a name sealed by a member under K0 opens on this console
  const ct = nip44.v2.encrypt(JSON.stringify({ name: 'Brendan' }), Buffer.from(K0, 'hex'));
  const opened = await evalIn(`(() => { try { return window.Steward.openMemberName(${JSON.stringify(JSON.stringify({ c: ct }))}, ${JSON.stringify('ab'.repeat(32))}); } catch (e) { return 'threw: ' + e.message; } })()`);
  assert.equal(opened, 'Brendan', 'a name sealed under the church\'s original key does not open on the console — the original is not the key in use');
});

test('the device copy: relay 1 unreachable (its proof fails), a console that has seen the key re-uses it and mints nothing', { skip: SKIP, timeout: 300000 }, async () => {
  // a warm visit first, so the copy is the one this console accepted from a relay
  await goCold('', true);
  await waitFor(`(window.Steward.relayList() || []).length >= 2 && window.Steward.nameKeyReady()`, 60000, 'both relays and the key');
  await sleep(3000);
  assert.ok(await evalIn(`!!localStorage.getItem('trinityone.steward.keyenv.name.' + ${JSON.stringify(churchA)})`), 'CONTROL: no device copy of the name-key envelope was kept');
  await evalIn('(() => { window.__nk = []; return 1; })()');
  await goCold('fail', true);
  await waitFor(`(window.Steward.relayList() || []).length >= 1`, 60000, 'relay 2 admitted');
  await sleep(15000);
  assert.ok(!(await evalIn('window.Steward.relayList()')).includes(r1.wsUrl), 'CONTROL: relay 1 was admitted — its proof was meant to fail');
  await waitFor(`window.Steward.keysFresh('name')`, 30000, 'relay 2\'s name-key read settled');
  // the roster tick's call, made here so it cannot be missed (any caller reaches the same gate)
  const asked = await evalIn(`Promise.resolve(window.Steward.ensureNameKeyForMembers([], [])).then(r => r === null ? 'null' : r === false ? 'false' : 'published')`);
  await sleep(1000);
  const minted = (await sentRings()).filter(r => !r || r[0] !== K0);
  assert.deepEqual(minted.map(r => r && r[0] && r[0].slice(0, 8)), [], `A CONSOLE THAT HAD SEEN THE NAME KEY MINTED A NEW ONE when the relay holding it was unreachable (ensureNameKeyForMembers: ${asked})`);
  assert.equal(await evalIn('window.Steward.nameKeyReady()'), true, 'the console that had seen the key does not hold it');
  for (const e of held(r2, NAMEKEY_D + churchA)) assert.equal((ringOf(e, ASK) || [])[0], K0, 'relay 2 now holds a name key that is not the church\'s original');
  await evalIn(`(() => { sessionStorage.removeItem('t1test.r1proof'); return 1; })()`);
});

test('a NEW church whose two relays both answer empty still gets its first name key', { skip: SKIP, timeout: 300000 }, async () => {
  // a fresh origin is a fresh console: relay 2's page, with relay 1 already among its relays before the wizard
  await cdpSend('Page.navigate', { url: r2.base + '/steward.html' });
  await sleep(3000);
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.extra-relays', JSON.stringify([${JSON.stringify(r1.wsUrl)}])); location.reload(); return 1; })()`);
  await sleep(3000);
  const cB = await wizard('St Ita New Church');
  assert.ok(cB && cB !== churchA, 'CONTROL: the wizard did not make a new church');
  const npubB = await evalIn(`window.Steward.npub || ''`);
  // registered on both by their operators — the wizard's own registration is not this file's subject
  for (const r of [r1, r2]) {
    const reg = await fetch(r.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r.adminToken },
      body: JSON.stringify({ addChurch: { npub: npubB, name: 'St Ita' } }) });
    assert.equal(reg.status, 200, 'CONTROL: a relay would not register the new church');
  }
  // past the wizard to the dashboard, where the enrolment runs (as church A did in before())
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
  await reload();
  await waitFor(`window.Steward.nameKeyReady()`, 90000, 'the new church\'s first name key');
  assert.ok((await evalIn('window.Steward.relayList()')).includes(r1.wsUrl), 'CONTROL: relay 1 was never proved — the two-relay case was not exercised');
  assert.ok(held(r2, NAMEKEY_D + cB).length >= 1, 'the new church\'s name key never reached its relay');
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
