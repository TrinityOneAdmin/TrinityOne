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
//     keyed (the "back in church A" row), and A's care key never returns;
//   · the care reset removed from setActiveIdentity → in B the console still holds A's care key and the need
//     in B is published sealed with it (the "in church B" row);
//   · AND THE AUDIT OF e6a2e02 (2026-10-01): nostr-tools fires `oneose` when a subscription is CLOSED, so
//     re-entering the SAME church (setActiveIdentity twice a few ms apart, or tapping the row already active in
//     the header switcher) marked it "looked, no key" and the console minted a fresh name ring over the
//     church's real one, and left itself sealing care with a key the relay did not hold. The "same-church
//     re-entry" row loops the timings the audit measured and requires that NOTHING is republished and the
//     console's keys are the relay's; the "back in church A" row requires the SAME keys, not merely some keys;
//     the "reload into B" row requires a console restored into B to hold none of A's rings.
// Each engine-side guard is also pinned on its own in key-reads-settle-only-for-the-church-they-asked-about.
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
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
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
let ctA = '', careBefore = null, nameBefore = null, ASK = null, aName0 = null, aCare0 = null;
// CHURCH A'S OWN ENVELOPES, read from the box's sqlite and opened with church A's key — the relay's truth.
const ringOf = (d) => {
  const env = envelopeOf(d + churchA); if (!env) return null;
  const w = JSON.parse(env.e.content).keys[churchA]; if (!w) return null;
  const pl = nip44.v2.decrypt(w, nip44.v2.utils.getConversationKey(ASK, env.pubkey));
  let r; try { r = JSON.parse(pl); } catch { r = [pl]; } return { id: env.id, ring: Array.isArray(r) ? r : [r] };
};
// Does what the console seals with open under the relay's ring? (careSeal = the console's current care key)
const careSealOpensWithRelayRing = async () => {
  const ct = await evalIn(`window.Steward.careSeal({ probe: 'ring' })`);
  if (!ct) return 'no-seal';
  return ringOf(CAREKEY_D).ring.some(k => { try { nip44.v2.decrypt(ct, unhex(k)); return true; } catch { return false; } }) ? 'relay-ring' : 'NOT-THE-RELAY-RING';
};

test('CONTROL: in church A the console holds A\'s keys and opens a care need', { skip: SKIP, timeout: 120000 }, async () => {
  assert.equal(await evalIn(`window.Steward.activePub`), churchA);
  const r = await publishNeed('Before the switch');
  assert.ok(r.ok, 'church A could not open a care need before any switch, so the rows below prove nothing: ' + r.err);
  ctA = await evalIn(`window.Steward.careSeal({ probe: 'A' })`);
  assert.ok(ctA, 'no care seal in A');
  careBefore = envelopeOf(CAREKEY_D + B.pub); nameBefore = envelopeOf(NAMEKEY_D + B.pub);
  assert.ok(careBefore && nameBefore, 'church B\'s envelopes are not on the box');
  ASK = privateKeyFromSeedWords(await evalIn('window.Steward.exportMnemonic()'));
  aName0 = ringOf(NAMEKEY_D); aCare0 = ringOf(CAREKEY_D);
  assert.ok(aName0 && aName0.ring.length && aCare0 && aCare0.ring.length, 'church A\'s own name and care envelopes are not on the box');
  assert.equal(await careSealOpensWithRelayRing(), 'relay-ring', 'CONTROL: the console\'s care key is not the relay\'s');
});

// THE AUDIT'S REPRODUCTION, at the timings it measured (8 of 10 minted before this fix). Church A has no admitted
// members here, which is the case it found: an empty ring, no recipient map, and a gate that only asked "is this
// still the current church?".
test('same-church re-entry (double setActiveIdentity, 0–50 ms apart, and a tap on the active row) republishes nothing and keeps the relay\'s keys', { skip: SKIP, timeout: 240000 }, async () => {
  const runs = [];
  for (const gap of [0, 1, 2, 3, 5, 8, 13, 20, 35, 50]) {
    await evalIn(`(async () => { const S = window.Steward, A = S.activePub; S.setActiveIdentity(A); await new Promise(r => setTimeout(r, ${gap})); S.setActiveIdentity(A); return 1; })()`);
    await sleep(3000);
    runs.push({ gap, name: ringOf(NAMEKEY_D), care: ringOf(CAREKEY_D), seal: await careSealOpensWithRelayRing(), nameReady: await evalIn('window.Steward.nameKeyReady()') });
  }
  // the real header switcher: open it and tap the row for the church we are already on
  await switchTo('Your church', 'Church A Keyswitch');
  await sleep(3000);
  runs.push({ gap: 'header tap', name: ringOf(NAMEKEY_D), care: ringOf(CAREKEY_D), seal: await careSealOpensWithRelayRing(), nameReady: await evalIn('window.Steward.nameKeyReady()') });
  for (const r of runs) {
    assert.equal(r.name.id, aName0.id, `gap ${r.gap}: A NEW NAME-KEY ENVELOPE WAS PUBLISHED FOR CHURCH A — a fresh ring over the church's real one`);
    assert.deepEqual(r.name.ring, aName0.ring, `gap ${r.gap}: church A's name ring changed`);
    assert.equal(r.care.id, aCare0.id, `gap ${r.gap}: a new care-key envelope was published for church A`);
    assert.notEqual(r.seal, 'NOT-THE-RELAY-RING', `gap ${r.gap}: THE CONSOLE SEALS CARE WITH A KEY THAT IS NOT IN THE RELAY'S CARE ENVELOPE — nobody else can open those needs`);
  }
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 30000, 'church A\'s keys after the re-entries');
  assert.equal(await careSealOpensWithRelayRing(), 'relay-ring');
  const need = await publishNeed('After the re-entries');
  assert.ok(need.ok, 'a care need could not be opened after the re-entries: ' + need.err);
  const enc = JSON.parse(envelopeOf(NEED_D + need.id).e.content).enc;
  assert.ok(aCare0.ring.some(k => { try { nip44.v2.decrypt(enc, unhex(k)); return true; } catch { return false; } }),
    'THE CARE NEED WAS SEALED WITH A KEY NOT IN CHURCH A\'S CARE ENVELOPE');
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

// THE SUSPECTED LEAK AFTER A RELOAD. A console reloaded while acting for B is restored into B early in boot
// (subscribeStewardedChurches), and church A's key subscriptions may already be open by then. B's envelopes are
// wrapped to B only, so a console holding ANY ring in B can only have taken church A's.
test('reload into church B: the restored console holds none of church A\'s rings', { skip: SKIP, timeout: 240000 }, async () => {
  assert.equal(await evalIn(`window.Steward.actingChurch`), B.pub, 'CONTROL: the console is acting for church B before the reload');
  await evalIn(`(() => { location.reload(); return 'ok'; })()`);
  await sleep(3000);
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
  await waitFor(`window.Steward && window.Steward.actingChurch === ${JSON.stringify(B.pub)}`, 60000, 'the console restored into church B');
  await sleep(10000);
  assert.equal(await evalIn(`window.Steward.nameKeyReady()`), false, 'AFTER A RELOAD INTO B THE CONSOLE HOLDS A NAME RING — B\'s is wrapped to B only, so it is church A\'s');
  assert.equal(await evalIn(`window.Steward.careSeal({ a: 1 })`), null, 'after a reload into B the console holds a care key — B\'s is wrapped to B only, so it is church A\'s');
  assert.equal(await evalIn(`window.Steward.careOpen(${JSON.stringify(ctA)}) === null`), true, 'after a reload into B the console opens a record sealed in church A');
  assert.equal(envelopeOf(CAREKEY_D + B.pub).id, careBefore.id, 'church B\'s care envelope was replaced');
  assert.equal(envelopeOf(NAMEKEY_D + B.pub).id, nameBefore.id, 'church B\'s name envelope was replaced');
});

test('back in church A the keys return: a care need opens, and a member who joins now is keyed and named on screen', { skip: SKIP, timeout: 180000 }, async () => {
  // (the church row is labelled with the ACTIVE identity's profile name while delegated, so match its subtitle)
  await switchTo('Your church', '');
  await waitFor(`window.Steward.activePub === ${JSON.stringify(churchA)} && !window.Steward.actingChurch`, 20000, 'the console back in church A');
  await waitFor(`window.Steward.nameKeyReady()`, 30000, 'THE NAME KEY NEVER CAME BACK after switching to B and back (nameKeyReady() stayed false)');
  await waitFor(`!!window.Steward.careSeal({ a: 1 }) && window.Steward.careOpen(${JSON.stringify(ctA)}) !== null`, 30000, 'church A\'s care key back on the console');
  const r = await publishNeed('Back in A');
  assert.ok(r.ok, 'church A cannot open a care need after switching back: ' + r.err);
  // THE SAME KEYS, NOT MERELY SOME KEYS. A fresh mint would also make nameKeyReady() true and careSeal() work.
  await sleep(3000);
  assert.equal(ringOf(NAMEKEY_D).id, aName0.id, 'A NEW NAME-KEY ENVELOPE WAS PUBLISHED FOR CHURCH A during the switch to B and back');
  assert.equal(ringOf(CAREKEY_D).id, aCare0.id, 'a new care-key envelope was published for church A during the switch to B and back');
  assert.equal(await careSealOpensWithRelayRing(), 'relay-ring', 'back in A the console seals care with a key that is not church A\'s');
  { const enc = JSON.parse(envelopeOf(NEED_D + r.id).e.content).enc;
    assert.ok(aCare0.ring.some(k => { try { nip44.v2.decrypt(enc, unhex(k)); return true; } catch { return false; } }), 'the need opened back in A is not sealed with church A\'s care key'); }

  // A NEW MEMBER JOINS NOW. The console must wrap A's name key to them (read back from the box), they seal
  // their name under it, and the Members screen shows it.
  const M = H.key();
  await H.publishAll(relay, [finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', MEMBER_D + churchA], ['t', 'trinityone'], ['p', churchA]], content: JSON.stringify({ joined: Math.floor(Date.now() / 1000) }) }, M.sk)]);
  let env = null; const t0 = Date.now();
  while (Date.now() - t0 < 60000) { env = envelopeOf(NAMEKEY_D + churchA); if (env && JSON.parse(env.e.content).keys[M.pub]) break; await sleep(500); }
  assert.ok(env && JSON.parse(env.e.content).keys[M.pub], 'A MEMBER WHO JOINED AFTER THE SWITCH WAS NEVER GIVEN THE NAME KEY — their name can never be sealed');
  const ring = JSON.parse(nip44.v2.decrypt(JSON.parse(env.e.content).keys[M.pub], nip44.v2.utils.getConversationKey(M.sk, env.pubkey)));
  assert.deepEqual(ring, aName0.ring, 'the member was given a DIFFERENT name ring from the one church A had before the switches — a fresh mint, and every name sealed before it stops opening');
  const NAME = 'Miriam Okafor';
  await H.publishAll(relay, [finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', NAME_D + churchA], ['t', 'trinityone'], ['church', churchA]], content: nip44.v2.encrypt(JSON.stringify({ name: NAME }), unhex(ring[0])) }, M.sk)]);
  await press('/^Members$/', 'the Members section');
  await waitFor(`document.body.innerText.includes(${JSON.stringify(NAME)})`, 30000, 'the new member\'s sealed name on the Members screen');
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
