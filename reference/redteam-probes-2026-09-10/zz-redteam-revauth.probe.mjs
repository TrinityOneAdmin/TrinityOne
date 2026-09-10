// RED TEAM PROBE — does a WITHDRAWN clearance stay withdrawn when the steward who withdrew it
// loses the safeguarding capability? Run: node scripts/zz-redteam-revauth.probe.mjs
// Throwaway. Port 9111 — checked free at author time; not in the suite's fixed-port map.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 9111;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

const church = K(), sgLead = K(), ada = K(), gina = K();
const SESSION = 'svc-now';
const KEY = '11'.repeat(32);
let relay, dataDir, w;

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
async function publishAs(who, e) {
  const s = await conn();
  const authed = new Promise(res => {
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); } };
    s.on('message', on); setTimeout(() => res(false), 400);
  });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  await authed; await sleep(80);
  const out = await send(s, e); s.close(); return out;
}
function req(s, sub, f, sk, ms = 700) {
  return new Promise(res => { const out = [];
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk)])); };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, f]));
    setTimeout(() => { s.off('message', on); res(out); }, ms); });
}
async function asks(who, filter) {
  const s = await conn();
  await req(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 300);
  const got = await req(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who.sk);
  s.close(); return got;
}
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const permission = (by, cp, who, opts = {}) => finalizeEvent({ kind: 30078, created_at: opts.at || now(),
  tags: [['d', D.CHECKINPERM + who.pub], ['t', NET], ['church', cp.pub], ['person', who.pub]],
  content: JSON.stringify(buildCheckinPermission({ person: who.pub, source: opts.source || 'steward',
    lifetime: opts.lifetime || 'open', from: opts.from != null ? opts.from : now() - 86400,
    until: opts.until !== undefined ? opts.until : null })) }, by.sk);
const unpermission = (by, cp, who, at) => finalizeEvent({ kind: 30078, created_at: at || now(),
  tags: [['d', D.CHECKINPERM + who.pub], ['t', NET], ['church', cp.pub], ['deleted', '1']], content: '' }, by.sk);
const grant = (session, helpers, from, until, key) => {
  const { doc: body } = buildHelperGrant({ session, source: GRANT_SOURCE, lifetime: 'session', from, until,
    helpers, keepers: [church.pub, sgLead.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)) });
  return finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINHELPER + session], ['t', NET], ['church', church.pub], ['session', session]],
    content: JSON.stringify(body) }, church.sk);
};
const checkinRec = (id, guardianPub) => doc(church, D.CHECKIN + id,
  nip44.encrypt(JSON.stringify({ id, childName: 'A Child', code: '4821' }), unhex(KEY)),
  [['church', church.pub], ['session', SESSION], ...(guardianPub ? [['p', guardianPub]] : [])]);

async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
}
async function reboot() {
  try { relay.kill('SIGKILL'); } catch {}
  await sleep(600);
  await boot();
  await sleep(600);
}

// THE OBSERVABLES. Both depend on checkinPermitted(); the second is the register itself.
const adaKey = async () => (await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + SESSION] })).length;
const adaRec = async () => (await asks(ada, { kinds: [30078], '#d': [D.CHECKIN + 'r1'] })).length;
const adaWrite = async () => (await publishAs(ada, doc(ada, D.CHECKIN + 'ada1', 'x',
  [['church', church.pub], ['session', SESSION]])))[0];

const rows = [];
const step = async (label) => { rows.push([label, await adaKey(), await adaRec(), await adaWrite()]); };

(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-rt-revauth-'));
  await boot();
  w = await conn();
  for (const who of [sgLead, ada, gina]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await send(w, doc(church, D.STEWARDS + church.pub,
    { pubkeys: [sgLead.pub], caps: { [sgLead.pub]: ['safeguarding'] } }));
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: {} }));
  await sleep(250);
  const t = now();
  await send(w, grant(SESSION, [ada.pub], t - 600, t + 3600, KEY));
  await send(w, checkinRec('r1', gina.pub));
  await sleep(250);

  // A. THE CHURCH ITSELF clears Ada. Baseline positive — without this every row below is vacuous.
  console.log('church grant OK =', await publishAs(church, permission(church, church, ada, { at: now() - 60 })));
  await sleep(250);
  await step('A. church cleared Ada (BASELINE — must be 1/1/true)');

  // B. The SAFEGUARDING STEWARD withdraws it. The shipped, supported act.
  console.log('sgLead withdraw OK =', await publishAs(sgLead, unpermission(sgLead, church, ada)));
  await sleep(250);
  await step('B. safeguarding steward withdrew it (must be 0/0/false)');

  // C. Restart with the roster UNCHANGED — the withdrawal must survive a reboot.
  await reboot();
  await step('C. after a reboot, roster unchanged (must be 0/0/false)');

  // D. The church now takes safeguarding off that steward (an ordinary thing: the lead moves on,
  //    or is re-scoped). Live map first.
  console.log('roster re-save OK =', await publishAs(church, doc(church, D.STEWARDS + church.pub,
    { pubkeys: [sgLead.pub], caps: { [sgLead.pub]: ['members'] } })));
  await sleep(300);
  await step('D. steward de-capped, NO restart yet');

  // E. …and the restart this relay does to itself.
  await reboot();
  await step('E. after the restart (THE CLAIM UNDER TEST)');

  console.log('\n%-58s %6s %6s %8s', 'step', 'key', 'record', 'canWrite');
  for (const r of rows) console.log('%-58s %6s %6s %8s', r[0], r[1], r[2], r[3]);

  try { w.close(); } catch {}
  try { relay.kill('SIGKILL'); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error('PROBE BLEW UP', e); try { relay.kill('SIGKILL'); } catch {} process.exit(1); });
