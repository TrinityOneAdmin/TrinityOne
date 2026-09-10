// RED TEAM PROBE — /export is owner-only on purpose. Is /sync?
// _exportAuth: "OWNER-ONLY. /export streams the church's ENTIRE corpus … It was reachable by any steward
// holding any one capability, so a content-scoped rota helper could take the lot, including minors: and
// guardians:."   _syncAuth still admits stewardCan(pub, cp, 'any').
// Run: node scripts/zz-redteam-sync.probe.mjs      Port 9111.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { D } from './trinity-doc-types.mjs';

const PORT = 9111;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const HOST = `127.0.0.1:${PORT}`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

const A = K(), finA = K(), kid = K(), mum = K(), carl = K();
let relay, dataDir, w;
const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
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
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const nip98 = (who, path, extra = []) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235,
  created_at: now(), tags: [['u', `http://${HOST}${path}`], ['method', 'GET'], ...extra], content: '' }, who.sk))).toString('base64');
const pull = async (who, path, extra) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { headers: { Authorization: nip98(who, path.split('?')[0], extra) } });
  return [r.status, await r.text()];
};
async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(A.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
}
(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-rt-sync-'));
  await boot();
  w = await conn();
  for (const who of [finA, kid, mum, carl]) await send(w, doc(who, D.MEMBER + A.pub, { joined: now() }));
  await send(w, doc(A, D.STEWARDS + A.pub, { pubkeys: [finA.pub], caps: { [finA.pub]: ['finance'] } }));
  await send(w, doc(A, D.MINORS + A.pub, { pubkeys: [kid.pub] }));
  await send(w, doc(A, D.GUARDIANS + A.pub, { links: { [kid.pub]: [mum.pub] } }));
  await send(w, doc(A, D.CHECKIN + 'r1',
    nip44.encrypt(JSON.stringify({ id: 'r1', childName: 'A Child', code: '4821' }), unhex('44'.repeat(32))),
    [['church', A.pub], ['enc', '1'], ['session', 'svc-1'], ['p', mum.pub]]));
  await sleep(400);

  // What the WEBSOCKET read gate gives a Finance-only steward — the deliberate refusals.
  const ws = async (d) => (await asks(finA, { kinds: [30078], '#d': [d] })).length;
  console.log('over the websocket, as the FINANCE-ONLY steward:');
  console.log('   minors:        ', await ws(D.MINORS + A.pub), '(0 = correctly refused)');
  console.log('   guardians:     ', await ws(D.GUARDIANS + A.pub), '(0 = correctly refused)');
  console.log('   checkin:r1     ', await ws(D.CHECKIN + 'r1'), '(1 = served, known and accepted)');

  // /export — deliberately owner-only.
  const [xs] = await pull(finA, '/export', [['church', A.pub]]);
  console.log('\n/export as the finance steward   -> HTTP', xs, xs === 401 ? '(refused, as designed)' : '(SERVED)');
  const [xs2] = await pull(A, '/export', [['church', A.pub]]);
  console.log('/export as the church key        -> HTTP', xs2, '(control: must be 200)');

  // /sync — the same corpus, a different gate.
  const [ss, body] = await pull(finA, `/sync?church=${A.pub}&since=0`, [['church', A.pub]]);
  const lines = body.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const dOf = e => ((e.tags || []).find(t => t[0] === 'd') || [])[1] || '';
  console.log('/sync as the finance steward     -> HTTP', ss, '· events', lines.length);
  const min = lines.find(e => dOf(e) === D.MINORS + A.pub);
  const gua = lines.find(e => dOf(e) === D.GUARDIANS + A.pub);
  console.log('   minors: in the stream?   ', !!min, min ? '  content = ' + min.content : '');
  console.log('   guardians: in the stream?', !!gua, gua ? '  content = ' + gua.content : '');
  console.log('   checkin:r1 in the stream?', !!lines.find(e => dOf(e) === D.CHECKIN + 'r1'));
  const [cs] = await pull(carl, `/sync?church=${A.pub}&since=0`, [['church', A.pub]]);
  console.log('   CONTROL /sync as an ordinary member -> HTTP', cs, '(must be 401)');

  try { w.close(); } catch {}
  try { relay.kill('SIGKILL'); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error('PROBE BLEW UP', e); try { relay.kill('SIGKILL'); } catch {} process.exit(1); });
