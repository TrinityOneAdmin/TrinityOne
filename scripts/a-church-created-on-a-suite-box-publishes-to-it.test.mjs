// THE SESSION THAT CREATES A CHURCH ON A SUITE BOX MUST PUBLISH TO THAT BOX — in that same session.
// Run: node --test scripts/a-church-created-on-a-suite-box-publishes-to-it.test.mjs
//
// Measured 2026-09-04 on 42f8080, driving the real console: after "Continue" on the wizard's name step the
// box registered the church (church.json gained it, `by: "self"`), and the relay then held ZERO events.
// `boxhosts` was "0", ownRelay() was the community pool, whereChurchLives() said 'community'. A reload and
// an unlock recovered it — which is exactly the shape nobody notices, because by the time anyone looks the
// console has been reopened.
//
// THE MECHANISM. createKey() → setKey() fires _refreshBoxHostsUs(), which asks the box "do you hold this
// church?" about a church that is seconds old and registered nowhere, and honestly caches "0". Registration
// is deferred until a NAME exists (gateway H4), so it lands later, from saveName — and nothing that landed
// told the cache. relaysRaw() builds the publish set from ownRelay(), which follows the cache, so every
// founding document went to the black-holed pool and the box that had just said "yes, I'll hold you" got
// none of it.
//
// THE FIX: an ACCEPTANCE from the base that IS the serving origin is an authenticated answer to the same
// question the /config probe asks — a stronger one, since the box just wrote the church down — so
// selfRegister records it and re-proves the relay list.
//
// POINT OF USE (rule 1), and nothing else would do. The unit tests lift selfRegister and prove the cache
// flips; this drives the shipped console, in a real browser, through the real wizard, against a real relay,
// and reads the relay's own store. It fails if the wizard stops passing the opt-in, if selfRegister stops
// recording the acceptance, or if relaysRaw() stops following the recorded answer — any link, not one.
//
// NOTHING REACHES PRODUCTION: the canonical addresses resolve to a dead port.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
after(() => H.stopAll());

// What the box holds for this church, read from ITS OWN sqlite — not from a subscription the console could
// be satisfying out of its own cache. WAL mode: the -wal file sits beside the db and node:sqlite folds it in.
function heldBy(relay, churchPub) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT kind, dtag FROM events WHERE pubkey = ? ORDER BY kind, dtag').all(churchPub)
      .map(r => ({ kind: Number(r.kind), dtag: String(r.dtag || '') }));
  } finally { db.close(); }
}

test('a church created in the console lands on the box that made it, in the same session, with no reload',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  // A fresh, PRIVATE box: no churches yet, so the first self-registration is the bootstrap one the gateway
  // accepts (H4). This is the Suite install the owner means by "a suite box should auto register".
  const relay = await H.startRelay({ name: 'suite-box' });
  const cdp = await H.freePort('the Suite-box wizard test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-suitebox-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
  let ws = null;
  try {
    let targets = null;
    for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const page = targets.find(t => t.type === 'page') || targets[0];
    ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    const evalIn = async (expression) => {
      const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (rr && rr.result && rr.result.exceptionDetails) {
        const e = rr.result.exceptionDetails;
        throw new Error('the page threw: ' + String((e.exception && e.exception.description) || e.text || 'threw').split('\n')[0]);
      }
      return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
    };
    await sleep(9000);

    // A MARK THAT A RELOAD WOULD ERASE. The defect recovers on reload + unlock, so a harness that reloaded
    // anywhere in here would pass over the bug. Plant a value on window now and require it at the end.
    assert.equal(await evalIn(`(window.__sameSession = 'planted-' + Date.now(), 'ok')`), 'ok');

    // The real path, the way a churchwarden walks it: no seeded key, no fixture blob.
    const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
    const typeInto = (sel, val) => `(() => { const i=document.querySelector(${JSON.stringify(sel)});
      if(!i) return 'miss';
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
    const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
      if(!i) return 'miss';
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
    assert.equal(await evalIn(click('/Start a new church/i')), 'ok', 'the console never offered "Start a new church"');
    await sleep(2500);
    assert.equal(await evalIn(typePh('At least 8', 'cedar-harbour-lamp-42')), 'ok', 'the PIN box was not on screen');
    assert.equal(await evalIn(typePh('Type it again', 'cedar-harbour-lamp-42')), 'ok', 'the confirm-PIN box was not on screen');
    assert.equal(await evalIn(click('/Set PIN/i')), 'ok', 'the console never offered "Set PIN"');
    await sleep(12000);   // key generation + the first render of the whole dashboard, wizard included

    const churchPub = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
    assert.match(String(churchPub), /^[0-9a-f]{64}$/, 'no church key after the PIN step — the wizard never started');

    // THE STAGING, measured rather than assumed: the probe at setKey has by now asked the box about a
    // church that is registered nowhere and written down "0". If this does not hold, the bug is not staged
    // and a pass below proves nothing.
    const cachedBefore = await evalIn(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub)`);
    assert.equal(cachedBefore, '0',
      'boxhosts cache is ' + JSON.stringify(cachedBefore) + ' before the name step — the early "no" was not ' +
      'recorded, so this run is not staging the defect it exists to catch');

    // The name step. Its field is the only input labelled "Church name"; Continue is the button under it.
    assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'St Columba on the Box')), 'ok', 'the name field was not on screen');
    await sleep(300);
    assert.equal(await evalIn(click('/^Continue$/')), 'ok', 'the wizard never offered "Continue"');
    // selfRegister (one HTTP round trip to the box, plus two black-holed ones that fail fast) then the
    // profile and the join policy through publish(). Generous, because a slow pass here is not a defect.
    await sleep(15000);

    // Same session, still. The recovery-by-reload is precisely what this must not be satisfied by.
    const mark = await evalIn(`window.__sameSession || ''`);
    assert.match(String(mark), /^planted-/, 'the page reloaded during the wizard, so anything below is the reload recovery and not the fix');

    // 1. The box registered the church, by the church's own hand. A box that was never asked has no
    //    church.json at all (the gateway writes it on the first registration), which is the same finding.
    let cj = null;
    try { cj = JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')); } catch (e) { cj = null; }
    // BY NPUB, NOT BY NAME. The relay stopped storing a church-supplied name on 2026-09-05 (the operator's
    // label is a petname derived from the key), so a row is identified by the key it is a row FOR.
    const row = cj && (cj.churches || []).find(c => c && String(c.npub || '') !== '');
    assert.ok(row,
      'the box never registered the church — the wizard did not ask it. With the early probe\'s "0" cached, ' +
      'configBase() names the pool, so unless the wizard opts the serving box in (createHere) the one box the ' +
      'steward is sitting at is never asked. church.json holds ' + JSON.stringify(cj));
    assert.equal(row.by, 'self', 'registered, but not by the church itself');

    // 2. The console now KNOWS the box holds it — this is the cache the defect left at "0".
    const cachedAfter = await evalIn(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub)`);
    const own = await evalIn(`window.Steward.ownRelay()`);
    const where = await evalIn(`window.Steward.whereChurchLives()`);
    assert.equal(cachedAfter, '1',
      'boxhosts is still ' + JSON.stringify(cachedAfter) + ' after the box ACCEPTED the registration. The ' +
      'acceptance was an authenticated "yes, I hold you" and nothing recorded it, so the publish set still ' +
      'follows the early "no" — ownRelay()=' + own + ', whereChurchLives()=' + where);
    assert.equal(own, relay.wsUrl, 'ownRelay() still names ' + own + ' rather than the box that just accepted the church');
    assert.equal(where, 'this-computer', 'the console tells the steward the church lives at ' + JSON.stringify(where));

    // 3. THE POINT: the relay's own store holds the founding documents, in this session, with no reload.
    const held = heldBy(relay, churchPub);
    const kinds = held.map(h => h.kind + (h.dtag ? ' ' + h.dtag : ''));
    assert.ok(held.some(h => h.kind === 0),
      'the box holds NO kind-0 profile for the church it just accepted. It holds: ' + JSON.stringify(kinds) +
      '. The wizard published to the community pool, which is black-holed here and was never this ' +
      'church\'s relay — a self-hosting church whose own box got nothing.');
    assert.ok(held.some(h => h.dtag.startsWith('trinityone/joinpolicy:')),
      'the join policy did not reach the box either. It holds: ' + JSON.stringify(kinds));
  } finally {
    try { ws && ws.close(); } catch {}
    try { chr.kill('SIGKILL'); } catch {}
    try { rmSync(prof, { recursive: true, force: true }); } catch {}
  }
});
