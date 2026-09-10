// RED TEAM PROBE 2 — two questions the first doors probe confounded, each with a CLEAN actor who has
// never been cleared, plus an explicit negative control.
//   Q1  can /import install a clearance the websocket refuses (uppercase-hex d-tag)?
//   Q2  a clearance stamped +899s by the SAFEGUARDING STEWARD — is the CHURCH's honest withdrawal
//       (a different addressable slot, so the store cannot refuse it) actually enforced?
// Run: node scripts/zz-redteam-doors2.probe.mjs      Port 9115.
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

const PORT = 9115;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const HOST = `127.0.0.1:${PORT}`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const A = K(), sgA = K();
const zoe = K();        // Q1's actor — never cleared by anybody
const ctl = K();        // Q1's control  — never cleared either, and no document is ever written for her
const kit = K();        // Q2's actor
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
function req(s, sub, f, sk, ms = 600) {
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
const doc = (who, d, content, extra = [], at) => finalizeEvent({ kind: 30078, created_at: at || now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const permBody = (whoPub) => JSON.stringify(buildCheckinPermission({ person: whoPub,
  source: 'steward', lifetime: 'open', from: now() - 86400, until: null }));
const permAt = (by, whoPub, d, at) => finalizeEvent({ kind: 30078, created_at: at || now(),
  tags: [['d', d], ['t', NET], ['church', A.pub], ['person', whoPub]], content: permBody(whoPub) }, by.sk);
const grant = (session, helpers, from, until, key) => {
  const { doc: body, failed } = buildHelperGrant({ session, source: GRANT_SOURCE, lifetime: 'session', from, until,
    helpers, keepers: [A.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(A.sk, p)) });
  if (failed.length) throw new Error('wrap failed: ' + failed);
  return finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINHELPER + session], ['t', NET], ['church', A.pub], ['session', session]],
    content: JSON.stringify(body) }, A.sk);
};
async function importAs(who, events) {
  const proof = finalizeEvent({ kind: 27235, created_at: now(),
    tags: [['u', `http://${HOST}/import`], ['method', 'POST'], ['church', A.pub]], content: '' }, who.sk);
  const r = await fetch(`http://127.0.0.1:${PORT}/import`, { method: 'POST',
    headers: { Authorization: 'Nostr ' + Buffer.from(JSON.stringify(proof)).toString('base64') },
    body: events.map(e => JSON.stringify(e)).join('\n') });
  return [r.status, await r.text()];
}
async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(A.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
}
async function reboot() { try { relay.kill('SIGKILL'); } catch {} await sleep(600); await boot(); await sleep(800); }

const R = [];
const row = (q, got, want) => R.push([q, got, want, String(got) === String(want) ? '' : '  <<< UNEXPECTED']);

(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-rt-doors2-'));
  await boot();
  w = await conn();
  for (const who of [sgA, zoe, ctl, kit]) await send(w, doc(who, D.MEMBER + A.pub, { joined: now() }));
  await send(w, doc(A, D.STEWARDS + A.pub, { pubkeys: [sgA.pub], caps: { [sgA.pub]: ['safeguarding'] } }));
  await send(w, doc(A, D.GUARDIANS + A.pub, { links: {} }));
  await sleep(250);
  const t = now();
  // ONE envelope naming all three, so the ONLY variable in every row below is the clearance.
  await send(w, grant('svc-q', [zoe.pub, ctl.pub, kit.pub], t - 600, t + 3600, '77'.repeat(32)));
  await sleep(300);
  const holds = (who) => asks(who, { kinds: [30078], '#d': [D.CHECKINHELPER + 'svc-q'] }).then(x => x.length);

  // NEGATIVE CONTROL, and the reason every "0" below means something: named in the envelope, never cleared.
  row('CONTROL ctl is in the envelope and uncleared', await holds(ctl), 0);
  row('CONTROL zoe likewise, before anything', await holds(zoe), 0);
  // POSITIVE CONTROL: clear kit properly, so a "1" is reachable at all.
  await publishAs(A, permAt(A, kit.pub, D.CHECKINPERM + kit.pub));
  await sleep(250);
  row('CONTROL kit, cleared the ordinary way', await holds(kit), 1);

  // ── Q1. the uppercase-hex d-tag, refused at the door and pushed through /import ─────────────────────
  const upper = permAt(A, zoe.pub, D.CHECKINPERM + zoe.pub.toUpperCase());
  row('Q1 websocket refuses the uppercase d-tag', (await publishAs(A, upper))[0], false);
  console.log('Q1 /import:', await importAs(A, [upper]));
  await sleep(1200);
  row('Q1 zoe cleared after the import?', await holds(zoe), 0);
  await reboot();
  row('Q1 zoe cleared after a reboot?', await holds(zoe), 0);
  row('Q1 control ctl still uncleared', await holds(ctl), 0);
  row('Q1 control kit still cleared', await holds(kit), 1);

  // ── Q2. a +899s clearance from the STEWARD, then the CHURCH's honest withdrawal ─────────────────────
  await publishAs(A, doc(A, D.CHECKINPERM + kit.pub, '', [['church', A.pub], ['deleted', '1']]));
  await sleep(250);
  row('Q2 setup: kit withdrawn by the church', await holds(kit), 0);
  const [okFuture] = await publishAs(sgA, permAt(sgA, kit.pub, D.CHECKINPERM + kit.pub, now() + 899));
  row('Q2 the steward\'s +899s clearance is accepted', okFuture, true);
  await sleep(250);
  row('Q2 kit is cleared again', await holds(kit), 1);
  const [okRevoke] = await publishAs(A, doc(A, D.CHECKINPERM + kit.pub, '', [['church', A.pub], ['deleted', '1']]));
  row('Q2 the church\'s honest withdrawal is ACCEPTED at the door', okRevoke, true);
  await sleep(300);
  row('Q2 …and is it ENFORCED?  (0 = yes)', await holds(kit), 0);
  const [okRevoke2] = await publishAs(sgA, doc(sgA, D.CHECKINPERM + kit.pub, '', [['church', A.pub], ['deleted', '1']]));
  row('Q2 the STEWARD\'s own honest withdrawal accepted?', okRevoke2, true);
  await sleep(300);
  row('Q2 …and enforced?  (0 = yes)', await holds(kit), 0);

  console.log('\n%s', 'question'.padEnd(58) + 'got'.padEnd(9) + 'want');
  for (const r of R) console.log(String(r[0]).padEnd(58) + String(r[1]).padEnd(9) + String(r[2]) + r[3]);
  console.log('\n' + R.filter(r => r[3]).length + ' row(s) did not match expectation');

  try { w.close(); } catch {}
  try { relay.kill('SIGKILL'); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error('PROBE BLEW UP', e); try { relay.kill('SIGKILL'); } catch {} process.exit(1); });
