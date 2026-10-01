// THE CONSOLE'S CHURCH KEYS FOLLOW THE CHURCH IT IS RUNNING.
//   Run: node --test scripts/console-keys-follow-the-church-switch.test.mjs
//
// THE DEFECT (audit5, 2026-10-01; on main too). The dashboard's KeyDistributor opened the media, care and name
// key subscriptions ONCE, with `[]` deps, and setActiveIdentity cleared the name key but deliberately not the
// care or media key. Measured with a real console switched A → B → A through the header switcher:
//   · in church B the care key was still CHURCH A'S, and a care need opened in B was published sealed with
//     it — B's own stewards could not open it and A's could. A cross-church leak of the most sensitive record
//     the product holds;
//   · back in A the name key never came back (nameKeyReady() false for good), so nobody who joined after the
//     switch was ever given it, and their names could not be sealed or shown.
//
// THE POINT OF USE (CLAUDE.md rule 1). A real gateway on a FREE port (never 8000), the real console in
// headless chromium, a church made through the real wizard, and the switch made by clicking the real header
// switcher. Church B is made outside the console and names church A's key in its steward roster — the
// delegated case. B already has care and name key envelopes, wrapped to B only, as B's own console would have
// left them. Claims are read back from the relay's own sqlite, not from anything the console could answer from
// cache. Rule 3: nothing here matches text in app/*.jsx.
//
// What each row would catch:
//   · deps back to `[]` in KeyDistributor → back in A, the name key never returns and the new member is never
//     keyed (row 3), and A's care key never returns (row 3);
//   · the care reset removed from setActiveIdentity → in B the console still holds A's care key and the need
//     in B is published sealed with it (row 2).
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { finalizeEvent, nip19, nip44 } from 'nostr-tools';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:', NAME_D = 'trinityone/name:';
const MEMBER_D = 'trinityone/member:', NEED_D = 'trinityone/care:', STEWARDS_D = 'trinityone/stewards:';
const unhex = (h) => Uint8Array.from(String(h).match(/../g).map(b => parseInt(b, 16)));
// church B's own keys, as B's console would have minted them — wrapped to B only
const B_CARE = 'ab'.repeat(32), B_NAME = 'cd'.repeat(32);

let relay, chr, ws, prof, evalIn, churchA = '';
const B = H.key();
const errors = [];

// What the box holds, from its OWN sqlite.
function held(where, ...args) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT id, pubkey, dtag, raw FROM events WHERE kind = 30078 AND ' + where).all(...args).map(r => { let e = {}; try { e = JSON.parse(String(r.raw || '')); } catch {} return { id: String(r.id), pubkey: String(r.pubkey), dtag: String(r.dtag), e }; }); }
  finally { db.close(); }
}
const envelopeOf = (d) => { const r = held('dtag = ?', d); assert.ok(r.length <= 1, 'more than one row for ' + d); return r[0] || null; };

const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const typeInto = (sel, val) => `(() => { const i=document.querySelector(${JSON.stringify(sel)}); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
async function waitFor(expr, ms = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return true; } catch {} await sleep(400); }
  throw new Error('timed out waiting for: ' + label);
}
const press = async (re, label) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${label || re}`); await sleep(500); };
// THE REAL HEADER SWITCHER: open it, then tap the row for the church we want.
async function switchTo(subtitle, label) {
  assert.equal(await evalIn(`(() => { const b=document.querySelector('button[title="Switch between your church, networks, and churches you steward"]'); if(!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'the header switcher is not on screen');
  await sleep(500);
  assert.equal(await evalIn(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes(${JSON.stringify(subtitle)}) && (x.textContent||'').includes(${JSON.stringify(label)})); if(!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', `no switcher row for ${label}`);
  await sleep(800);
}
const publishNeed = (label) => evalIn(`(async () => { try { const r = await window.StewardMeals.publishNeed({ type: 'meals', dates: ['2026-11-10'], displayLabel: ${JSON.stringify(label)}, notes: 'switch test' }); return { ok: true, id: r && r.id }; } catch (e) { return { ok: false, err: String(e && e.message || e) }; } })()`);

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'keyswitch', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the key-switch test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-keyswitch-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
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
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };

  // CHURCH A, the real way: a new church, a PIN, the wizard's name step (which registers it on this box).
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
  await press('/Start a new church/i');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  churchA = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  assert.match(churchA, /^[0-9a-f]{64}$/, 'no church key after the PIN step');
  const npubA = await evalIn(`window.Steward.npub || ''`);
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'Church A Keyswitch')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered church A'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');

  // CHURCH B, made outside the console, names church A's key as one of its stewards, and already has its own
  // care and name keys — wrapped to B only, as B's own console leaves them before it has keyed anyone.
  const reg = await fetch(relay.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relay.adminToken },
    body: JSON.stringify({ addChurch: { npub: nip19.npubEncode(B.pub), name: 'Church B' } }) });
  assert.equal(reg.status, 200, 'the box would not register church B');
  const ts = Math.floor(Date.now() / 1000);
  const ckB = nip44.v2.utils.getConversationKey(B.sk, B.pub);
  await H.publishAll(relay, [
    finalizeEvent({ kind: 0, created_at: ts, tags: [], content: JSON.stringify({ name: 'Church B Keyswitch' }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', STEWARDS_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [churchA] }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', CAREKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: { [B.pub]: nip44.v2.encrypt(JSON.stringify([B_CARE]), ckB) }, rev: 1 }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', NAMEKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: { [B.pub]: nip44.v2.encrypt(JSON.stringify([B_NAME]), ckB) }, rev: 1 }) }, B.sk),
  ]);

  // Past the wizard by the door the console uses when setup is finished, then a reload and an unlock. A brand-new
  // church cannot get its keys in the session that made it (see the report on this branch: the relay never
  // challenges a church with nothing private yet); the reload is the steward's second visit.
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
  await evalIn(`(() => { location.reload(); return 'ok'; })()`);
  await sleep(3000);
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
  await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 90000, 'the dashboard, with no wizard');
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'church A\'s own name and care keys');
  await waitFor(`(window.Steward.identities() || []).some(x => x.kind === 'steward' && x.pub === ${JSON.stringify(B.pub)})`, 60000, 'church B in the switcher');
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;
let ctA = '', careBefore = null, nameBefore = null;

test('CONTROL: in church A the console holds A\'s keys and opens a care need', { skip: SKIP, timeout: 120000 }, async () => {
  assert.equal(await evalIn(`window.Steward.activePub`), churchA);
  const r = await publishNeed('Before the switch');
  assert.ok(r.ok, 'church A could not open a care need before any switch, so the rows below prove nothing: ' + r.err);
  ctA = await evalIn(`window.Steward.careSeal({ probe: 'A' })`);
  assert.ok(ctA, 'no care seal in A');
  careBefore = envelopeOf(CAREKEY_D + B.pub); nameBefore = envelopeOf(NAMEKEY_D + B.pub);
  assert.ok(careBefore && nameBefore, 'church B\'s envelopes are not on the box');
});

test('in church B (switched through the header) a care need is NOT sealed with church A\'s key, and B\'s keys are not overwritten', { skip: SKIP, timeout: 120000 }, async () => {
  await switchTo('You steward this church', 'Church B Keyswitch');
  await waitFor(`window.Steward.actingChurch === ${JSON.stringify(B.pub)}`, 20000, 'the console to be acting for church B');
  // give the console the time the audit gave it: long enough for any stale subscription to answer
  await sleep(6000);
  assert.equal(await evalIn(`window.Steward.careOpen(${JSON.stringify(ctA)}) === null`), true,
    'IN CHURCH B THE CONSOLE STILL HOLDS CHURCH A\'S CARE KEY — it opens a record sealed in A');
  const r = await publishNeed('Opened in B');
  if (r.ok) {
    // a need that DID publish must be sealed with B's key — never A's
    const row = envelopeOf(NEED_D + r.id);
    assert.ok(row, 'publishNeed said ok but nothing reached the box');
    const enc = JSON.parse(row.e.content).enc;
    let openedWithB = false; try { nip44.v2.decrypt(enc, unhex(B_CARE)); openedWithB = true; } catch {}
    assert.ok(openedWithB, 'A CARE NEED OPENED IN CHURCH B WAS SEALED WITH A KEY THAT IS NOT CHURCH B\'S — B\'s stewards cannot open it');
  } else {
    assert.match(r.err, /care key|connecting/i, 'refused, but not for the care key: ' + r.err);
  }
  // B's envelopes must be untouched: this console holds neither key, and a fresh mint would orphan B's data
  assert.equal(envelopeOf(CAREKEY_D + B.pub).id, careBefore.id, 'THE CONSOLE REPLACED CHURCH B\'S CARE KEY ENVELOPE — every need sealed under B\'s key is now unreadable');
  assert.equal(envelopeOf(NAMEKEY_D + B.pub).id, nameBefore.id, 'THE CONSOLE REPLACED CHURCH B\'S NAME KEY ENVELOPE — every sealed name in B is now unreadable');
});

test('back in church A the keys return: a care need opens, and a member who joins now is keyed and named on screen', { skip: SKIP, timeout: 180000 }, async () => {
  // (the church row is labelled with the ACTIVE identity's profile name while delegated, so match its subtitle)
  await switchTo('Your church', '');
  await waitFor(`window.Steward.activePub === ${JSON.stringify(churchA)} && !window.Steward.actingChurch`, 20000, 'the console back in church A');
  await waitFor(`window.Steward.nameKeyReady()`, 30000, 'THE NAME KEY NEVER CAME BACK after switching to B and back (nameKeyReady() stayed false)');
  await waitFor(`!!window.Steward.careSeal({ a: 1 }) && window.Steward.careOpen(${JSON.stringify(ctA)}) !== null`, 30000, 'church A\'s care key back on the console');
  const r = await publishNeed('Back in A');
  assert.ok(r.ok, 'church A cannot open a care need after switching back: ' + r.err);

  // A NEW MEMBER JOINS NOW. The console must wrap A's name key to them (read back from the box), they seal
  // their name under it, and the Members screen shows it.
  const M = H.key();
  await H.publishAll(relay, [finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', MEMBER_D + churchA], ['t', 'trinityone'], ['p', churchA]], content: JSON.stringify({ joined: Math.floor(Date.now() / 1000) }) }, M.sk)]);
  let env = null; const t0 = Date.now();
  while (Date.now() - t0 < 60000) { env = envelopeOf(NAMEKEY_D + churchA); if (env && JSON.parse(env.e.content).keys[M.pub]) break; await sleep(500); }
  assert.ok(env && JSON.parse(env.e.content).keys[M.pub], 'A MEMBER WHO JOINED AFTER THE SWITCH WAS NEVER GIVEN THE NAME KEY — their name can never be sealed');
  const ring = JSON.parse(nip44.v2.decrypt(JSON.parse(env.e.content).keys[M.pub], nip44.v2.utils.getConversationKey(M.sk, env.pubkey)));
  const NAME = 'Miriam Okafor';
  await H.publishAll(relay, [finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', NAME_D + churchA], ['t', 'trinityone'], ['church', churchA]], content: nip44.v2.encrypt(JSON.stringify({ name: NAME }), unhex(ring[0])) }, M.sk)]);
  await press('/^Members$/', 'the Members section');
  await waitFor(`document.body.innerText.includes(${JSON.stringify(NAME)})`, 30000, 'the new member\'s sealed name on the Members screen');
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
