// RED TEAM PROBE — the two doors (websocket accept() vs /import → note()), future stamps, and a
// closed session. Run: node scripts/zz-redteam-doors.probe.mjs      Port 9114.
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

const PORT = 9114;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const HOST = `127.0.0.1:${PORT}`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

const A = K(), sgA = K(), ada = K(), eve = K(), gina = K();
const S1 = 'a-svc-1', SOLD = 'a-svc-old';
const KEY1 = '11'.repeat(32), RING = '44'.repeat(32);
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
const permBody = (whoPub, opts = {}) => JSON.stringify(buildCheckinPermission({ person: whoPub,
  source: 'steward', lifetime: 'open', from: opts.from != null ? opts.from : now() - 86400, until: null }));
const permission = (by, cp, whoPub, opts = {}) => finalizeEvent({ kind: 30078, created_at: opts.at || now(),
  tags: [['d', (opts.d || (D.CHECKINPERM + whoPub))], ['t', NET], ['church', cp.pub], ['person', whoPub]],
  content: permBody(whoPub, opts) }, by.sk);
const grantBody = (churchK, session, helpers, from, until, key, keepers) => {
  const { doc: body, failed } = buildHelperGrant({ session, source: GRANT_SOURCE, lifetime: 'session', from, until,
    helpers, keepers: keepers || [churchK.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(churchK.sk, p)) });
  if (failed.length) throw new Error('wrap failed: ' + failed);
  return body;
};
const grant = (by, churchK, session, helpers, from, until, key, keepers, at, dOverride) =>
  finalizeEvent({ kind: 30078, created_at: at || now(),
    tags: [['d', dOverride || (D.CHECKINHELPER + session)], ['t', NET], ['church', churchK.pub], ['session', session]],
    content: JSON.stringify(grantBody(churchK, session, helpers, from, until, key, keepers)) }, by.sk);

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
async function reboot() { try { relay.kill('SIGKILL'); } catch {} await sleep(600); await boot(); await sleep(700); }

const R = [];
const row = (q, got, want) => R.push([q, got, want, String(got) === String(want) ? '' : '  <<< UNEXPECTED']);

(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-rt-doors-'));
  await boot();
  w = await conn();
  for (const who of [sgA, ada, eve, gina]) await send(w, doc(who, D.MEMBER + A.pub, { joined: now() }));
  await send(w, doc(A, D.STEWARDS + A.pub, { pubkeys: [sgA.pub], caps: { [sgA.pub]: ['safeguarding'] } }));
  await send(w, doc(A, D.GUARDIANS + A.pub, { links: {} }));
  await sleep(250);
  const t = now();
  await send(w, permission(A, A, ada.pub));
  await send(w, grant(A, A, S1, [ada.pub], t - 600, t + 3600, KEY1, [A.pub, sgA.pub]));
  await send(w, doc(A, D.CHECKIN + 'r1',
    nip44.encrypt(JSON.stringify({ id: 'r1', session: S1, code: '4821' }), unhex(RING)),
    [['church', A.pub], ['enc', '1'], ['session', S1], ['p', gina.pub]]));
  await sleep(300);
  const envOf = (who, sid) => asks(who, { kinds: [30078], '#d': [D.CHECKINHELPER + sid] }).then(x => x.length);

  row('BASELINE  ada holds the S1 envelope', await envOf(ada, S1), 1);

  // ── A CLOSED SESSION ────────────────────────────────────────────────────────────────────────────────
  await publishAs(A, grant(A, A, SOLD, [ada.pub], t - 7200, t - 3600, '55'.repeat(32), [A.pub]));
  await sleep(250);
  row('ada fetches a CLOSED session\'s envelope', await envOf(ada, SOLD), 0);
  row('…the church can still read it', await envOf(A, SOLD), 1);

  // ── FUTURE STAMPS ───────────────────────────────────────────────────────────────────────────────────
  row('a clearance stamped now+899s is accepted', (await publishAs(A, permission(A, A, eve.pub, { at: now() + 899 })))[0], true);
  row('…and now+1200s is refused by the store', (await publishAs(A, permission(A, A, eve.pub, { at: now() + 1200 })))[0], false);
  await publishAs(A, grant(A, A, 'a-svc-eve', [eve.pub], t - 600, t + 3600, '66'.repeat(32), [A.pub]));
  await sleep(250);
  row('eve (future-stamped clearance) gets her key NOW', await envOf(eve, 'a-svc-eve'), 1);
  // Does the future stamp pin the withdrawal out? The church revokes with an HONEST timestamp.
  row('the church\'s honest withdrawal is accepted', (await publishAs(A, doc(A, D.CHECKINPERM + eve.pub, '',
    [['church', A.pub], ['deleted', '1']])))[0], true);
  await sleep(250);
  row('…and eve is refused after it', await envOf(eve, 'a-svc-eve'), 0);

  // ── THE TWO DOORS. Everything below is refused at the websocket; does /import install it? ───────────
  const refuseAtDoor = async (label, e) => {
    const [ok] = await publishAs(e.pubkey === A.pub ? A : (e.pubkey === sgA.pub ? sgA : ada), e);
    row('DOOR ' + label, ok, false);
    return e;
  };
  const upperD = D.CHECKINPERM + eve.pub.toUpperCase();
  const bad = [];
  bad.push(await refuseAtDoor('clearance with UPPERCASE hex d-tag', permission(A, A, eve.pub, { d: upperD })));
  bad.push(await refuseAtDoor('envelope whose sid contains ".."', grant(A, A, S1, [ada.pub], t - 600, t + 3600, KEY1, [A.pub], null, D.CHECKINHELPER + '../a-svc-1')));
  bad.push(await refuseAtDoor('envelope with a 300-char sid', grant(A, A, 'x'.repeat(300), [ada.pub], t - 600, t + 3600, KEY1, [A.pub])));
  bad.push(await refuseAtDoor('envelope minted by the SAFEGUARDING steward', grant(sgA, A, 'sg-svc', [ada.pub], t - 600, t + 3600, KEY1, [A.pub])));
  bad.push(await refuseAtDoor('clearance whose body names somebody else', finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINPERM + eve.pub], ['t', NET], ['church', A.pub]], content: permBody(ada.pub) }, A.sk)));
  bad.push(await refuseAtDoor('envelope whose body names another session', finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINHELPER + 'sneak'], ['t', NET], ['church', A.pub]],
    content: JSON.stringify(grantBody(A, S1, [eve.pub], t - 600, t + 3600, KEY1, [A.pub])) }, A.sk)));

  console.log('\n/import of all six:', await importAs(A, bad));
  await sleep(1200);
  row('IMPORT installed the uppercase clearance?  eve cleared', await envOf(eve, 'a-svc-eve'), 0);
  row('IMPORT installed the delegate\'s envelope?  ada on sg-svc', await envOf(ada, 'sg-svc'), 0);
  row('IMPORT installed the ".." envelope?', (await asks(A, { kinds: [30078], '#d': [D.CHECKINHELPER + '../a-svc-1'] })).length > 0 ? 'stored' : 'not stored', 'stored');
  row('IMPORT installed the 300-char envelope?  ada admitted', await envOf(ada, 'x'.repeat(300)), 0);
  row('IMPORT installed the mismatched-body envelope?  eve on sneak', await envOf(eve, 'sneak'), 0);
  await reboot();
  row('…and after a REBOOT (rehydrate): eve cleared', await envOf(eve, 'a-svc-eve'), 0);
  row('…after a REBOOT: ada on sg-svc', await envOf(ada, 'sg-svc'), 0);
  row('…after a REBOOT: eve on sneak', await envOf(eve, 'sneak'), 0);
  row('…after a REBOOT: ada still holds her real S1 envelope', await envOf(ada, S1), 1);

  console.log('\n%s', 'question'.padEnd(58) + 'got'.padEnd(9) + 'want');
  for (const r of R) console.log(String(r[0]).padEnd(58) + String(r[1]).padEnd(9) + String(r[2]) + r[3]);
  console.log('\n' + R.filter(r => r[3]).length + ' row(s) did not match expectation');

  try { w.close(); } catch {}
  try { relay.kill('SIGKILL'); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error('PROBE BLEW UP', e); try { relay.kill('SIGKILL'); } catch {} process.exit(1); });
