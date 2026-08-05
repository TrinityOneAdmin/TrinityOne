// Does the SHIPPED member bundle see a safety check and seal its reply to the chosen audience?
// Run: node scripts/netsim-safety-browser.mjs
//
// netsim-safety.mjs proved the relay, the sizes and the crypto — but it BUILT the envelope the way
// fellowship.src.js does rather than running it. This runs the real thing: the member app in a headless
// browser, driving window.Fellowship.markSafe from the deployed vendor/fellowship.js.
//
// It exists because the on-device attempt on 2026-08-05 never got a reply out: the member app's
// subscribeSafetyCheck did not deliver the check within 60s and the cause was unknown. A browser makes that
// reproducible without a second handset.
//
// Fresh --user-data-dir every run: a reused Chrome profile serves the FIRST run's service-worker bundle for
// ever, which has silently invalidated browser probes in this repo before. The loaded build is reported below.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44v2 } from 'nostr-tools/nip44';

const PORT = 8993, CDP = 9444;
const NET = 'trinityone';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const church = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
const care = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();

const dataDir = mkdtempSync(join(tmpdir(), 'safebrowse-'));
const UDD = mkdtempSync(join(tmpdir(), 'safebrowse-chrome-'));
const relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
  env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) },
});
const CHROME = ['/snap/bin/chromium', 'chromium-browser', 'chromium', 'google-chrome']
  .find(c => { try { return !spawnSync(c, ['--version'], { timeout: 4000 }).error; } catch { return false; } });
let chrome = null;
const die = (c) => { try { chrome && process.kill(-chrome.pid); } catch {} try { relay.kill('SIGKILL'); } catch {} for (const d of [dataDir, UDD]) { try { rmSync(d, { recursive: true, force: true }); } catch {} } process.exit(c); };
process.on('uncaughtException', e => { console.error(e); die(1); });

const cdpEval = async (ws, expr, ms = 60000) => {
  const sock = new WebSocket(ws, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { sock.on('open', res); sock.on('error', rej); });
  const out = await new Promise((res) => {
    const to = setTimeout(() => res({ __timeout: true }), ms);
    sock.on('message', d => { const m = JSON.parse(d); if (m.id === 1) { clearTimeout(to); res(m.result); } });
    sock.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  sock.close();
  if (out.__timeout) return '__TIMEOUT__';
  if (out && out.exceptionDetails) return 'THREW: ' + String(out.exceptionDetails.exception && out.exceptionDetails.exception.description || '').slice(0, 200);
  return out && out.result ? out.result.value : null;
};

(async () => {
  for (let i = 0; i < 40; i++) { try { const w = new WebSocket(`ws://127.0.0.1:${PORT}/relay`); await new Promise((res, rej) => { w.on('open', res); w.on('error', rej); }); w.close(); break; } catch { await sleep(200); } }
  const pool = new SimplePool(), relays = [`ws://127.0.0.1:${PORT}/relay`];

  // the church names a care team, so 'care' has somebody in it
  await Promise.allSettled(pool.publish(relays, finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [['d', 'trinityone/careteam:' + church.pub], ['t', NET], ['church', church.pub]], content: JSON.stringify({ pubkeys: [care.pub] }) }, church.sk)));

  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${UDD}`,
    `--remote-debugging-port=${CDP}`, `http://127.0.0.1:${PORT}/`], { stdio: 'ignore', detached: true });
  let ws = null;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP}/json`); const ts = await r.json();
      const pg = ts.find(t => t.type === 'page' && /127\.0\.0\.1/.test(t.url || '')); if (pg) { ws = pg.webSocketDebuggerUrl; break; } } catch {}
    await sleep(500);
  }
  if (!ws) { console.error('✗ could not attach to the member app in Chrome'); die(2); }

  const build = await cdpEval(ws, `(async () => { for (let i=0;i<60;i++){ if (window.Fellowship && window.TrinityIdentity) break; await new Promise(r=>setTimeout(r,500)); }
    const t = await (await fetch('/vendor/fellowship.js')).text();
    return JSON.stringify({ ready: !!window.Fellowship, markSafeV2: /v:\\s*2/.test(t), hasJoinQueued: /joinQueued/.test(t) }); })()`);
  console.log('loaded bundle  ', build);

  const CH = npubEncode(church.pub);
  const me = await cdpEval(ws, `(async () => {
    await window.TrinityIdentity.regenerate();
    localStorage.setItem('trinityone.followedChurches', JSON.stringify([{ id: '${CH}', npub: '${CH}', name: 'Test' }]));
    localStorage.setItem('trinityone.activeChurch', JSON.stringify('${CH}'));
    localStorage.setItem('trinityone.onboarded','true');
    await window.Fellowship.announceMembership('${CH}');
    return window.Fellowship.myPubkey || '';
  })()`);
  console.log('member pubkey  ', String(me).slice(0, 16) + '…');
  await sleep(1200);

  // ADMIT the member. Without this the relay may gate their reads, and a member who never receives the check
  // cannot answer it — which is indistinguishable, from the outside, from the bug this script is hunting.
  await Promise.allSettled(pool.publish(relays, finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [['d', 'trinityone/admitted:' + church.pub], ['t', NET], ['church', church.pub]], content: JSON.stringify({ pubkeys: [String(me)] }) }, church.sk)));
  await sleep(800);

  // the church starts a CARE-TEAM-only check
  const checkId = 'sc' + Date.now();
  await Promise.allSettled(pool.publish(relays, finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [['d', 'trinityone/safetycheck:' + church.pub], ['t', NET], ['church', church.pub]], content: JSON.stringify({ id: checkId, message: 'Are you safe?', at: Math.floor(Date.now() / 1e3), open: true, audience: 'care' }) }, church.sk)));
  console.log('check published', checkId, '(audience: care)');

  // NOTE: do NOT try to confirm the check exists with an anonymous query — safetycheck docs are gated to
  // members, so an anon read returns 0 whether or not the write landed. That measures the read gate, not the
  // write, and it sent me down a false trail on the first run of this script.

  // Does ANY church doc reach this app? If not, the harness never really joined and the safety result means
  // nothing; if other docs arrive and only the check does not, the defect is safety-specific.
  const wiring = await cdpEval(ws, `(() => new Promise(res => {
    const F = window.Fellowship; const got = [];
    try { F.subscribeChurchSafeguard(F.churchPub, () => got.push('safeguard')); } catch (e) { got.push('safeguard-threw'); }
    try { F.subscribeChurchGroups(F.churchPub, () => got.push('groups')); } catch (e) { got.push('groups-threw'); }
    setTimeout(() => res(JSON.stringify({ churchPub: (F.churchPub||'').slice(0,12), me: (F.myPubkey||'').slice(0,12), relays: (F.relays||[]).length, docsSeen: [...new Set(got)] })), 12000);
  }))()`, 25000);
  console.log('wiring         ', wiring);

  // THE UNPROVEN PART: does the shipped bundle see it, and does markSafe seal correctly?
  const replied = await cdpEval(ws, `(() => new Promise(res => {
    const F = window.Fellowship; let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res(JSON.stringify({ sawCheck: false })); } }, 45000);
    F.subscribeSafetyCheck(F.churchPub, async (chk) => {
      if (done || !chk || !chk.id) return; done = true; clearTimeout(t);
      let sent = null; try { sent = await F.markSafe(chk, 'help', 'browser test'); } catch (e) { sent = 'threw:' + e.message; }
      res(JSON.stringify({ sawCheck: true, id: chk.id, audience: chk.audience || '(none)', sent: !!sent }));
    });
  }))()`, 70000);
  console.log('member app     ', replied);

  await sleep(1500);
  const evs = await pool.querySync(relays, [{ kinds: [30078], '#d': ['trinityone/safe:' + church.pub], limit: 10 }]);
  let churchOk = 0, careOk = 0, readerCount = 0;
  for (const e of evs) {
    let env = null; try { env = JSON.parse(e.content); } catch {}
    if (!env || env.v !== 2 || !env.to) continue;
    readerCount = Object.keys(env.to).length;
    try { const o = JSON.parse(nip44v2.decrypt(env.to[church.pub], nip44v2.utils.getConversationKey(church.sk, e.pubkey))); if (o.status === 'help') churchOk++; } catch {}
    try { nip44v2.decrypt(env.to[care.pub], nip44v2.utils.getConversationKey(care.sk, e.pubkey)); careOk++; } catch {}
  }
  console.log(`relay          ${evs.length} reply event(s), ${readerCount} reader(s) per envelope`);
  console.log(`church key     opened "help": ${churchOk}`);
  console.log(`care team      opened:        ${careOk}`);

  const ok = evs.length === 1 && churchOk === 1 && careOk === 1 && String(replied).includes('"audience":"care"');
  console.log(ok ? '\n✓ the shipped member app saw the check and sealed its reply to the church AND the care team\n'
                 : '\n✗ FAILED — see above\n');
  pool.close(relays); die(ok ? 0 : 1);
})();
