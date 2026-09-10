// RED TEAM MATRIX — cross-session, cross-church, and what a helper's session tag actually binds.
// Two churches on one box. Real gateway, real signed events, real websockets.
// Run: node scripts/zz-redteam-matrix.probe.mjs      Port 9113 (checked free; not in the suite's map).
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

const PORT = 9113;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

const A = K(), B = K();              // two congregations on one relay
const sgA = K(), finA = K();          // A's safeguarding steward, and A's finance-ONLY steward
const careA = K();                    // A's care-team admin (an ordinary member, no steward seat)
const ada = K();                      // cleared helper of A, on session S1 only
const bea = K();                      // cleared helper of A, on session S2 only
const gina = K();                     // a guardian in A
const carl = K();                     // an ordinary member of A
const bhelp = K();                    // church B's cleared helper

const S1 = 'a-svc-1', S2 = 'a-svc-2', SB = 'a-svc-1';   // ⚠ B deliberately reuses A's session id
const KEY1 = '11'.repeat(32), KEY2 = '22'.repeat(32), KEYB = '33'.repeat(32);
const RING = '44'.repeat(32);         // church A's safeguarding ring key
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
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const permission = (by, cp, whoPub, opts = {}) => finalizeEvent({ kind: 30078, created_at: opts.at || now(),
  tags: [['d', D.CHECKINPERM + whoPub], ['t', NET], ['church', cp.pub], ['person', whoPub]],
  content: JSON.stringify(buildCheckinPermission({ person: whoPub, source: 'steward', lifetime: 'open',
    from: opts.from != null ? opts.from : now() - 86400, until: null })) }, by.sk);
const grant = (churchK, session, helpers, from, until, key, keepers) => {
  const { doc: body, failed } = buildHelperGrant({ session, source: GRANT_SOURCE, lifetime: 'session', from, until,
    helpers, keepers: keepers || [churchK.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(churchK.sk, p)) });
  if (failed.length) throw new Error('wrap failed for ' + failed);
  return finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINHELPER + session], ['t', NET], ['church', churchK.pub], ['session', session]],
    content: JSON.stringify(body) }, churchK.sk);
};
// A church-written record, sealed to A's ring, with the cleartext tags the shipped writer emits.
const rec = (churchK, ringKey, id, session, guardianPub, extra = []) => doc(churchK, D.CHECKIN + id,
  nip44.encrypt(JSON.stringify({ id, session, childName: 'Child ' + id, code: '4821', date: '2026-09-06' }), unhex(ringKey)),
  [['church', churchK.pub], ['enc', '1'], ['session', session], ...(guardianPub ? [['p', guardianPub]] : []), ...extra]);

async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir,
      CHURCH_NPUB: npubEncode(A.pub) + ',' + npubEncode(B.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
}

const R = [];
const row = (q, got, want) => { R.push([q, got, want, String(got) === String(want) ? '' : '  <<< UNEXPECTED']); };

(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-rt-matrix-'));
  await boot();
  w = await conn();
  for (const who of [sgA, finA, careA, ada, bea, gina, carl]) await send(w, doc(who, D.MEMBER + A.pub, { joined: now() }));
  await send(w, doc(bhelp, D.MEMBER + B.pub, { joined: now() }));
  await send(w, doc(A, D.STEWARDS + A.pub, { pubkeys: [sgA.pub, finA.pub], caps: { [sgA.pub]: ['safeguarding'], [finA.pub]: ['finance'] } }));
  await send(w, doc(B, D.STEWARDS + B.pub, { pubkeys: [] }));
  await send(w, doc(A, D.GUARDIANS + A.pub, { links: {} }));
  // A's care team: careA is on the roster of the group A names as its care admin group.
  await send(w, doc(A, D.ROSTER + 'careteam1', { pubs: [careA.pub] }, [['church', A.pub]]));
  await send(w, doc(A, 'trinityone/meals-settings', { adminGroupId: 'careteam1' }, [['church', A.pub]]));
  await sleep(250);

  const t = now();
  await send(w, permission(A, A, ada.pub));
  await send(w, permission(A, A, bea.pub));
  await send(w, permission(B, B, bhelp.pub));
  await send(w, grant(A, S1, [ada.pub], t - 600, t + 3600, KEY1, [A.pub, sgA.pub]));
  await send(w, grant(A, S2, [bea.pub], t - 600, t + 3600, KEY2, [A.pub, sgA.pub]));
  await send(w, grant(B, SB, [bhelp.pub], t - 600, t + 3600, KEYB, [B.pub]));
  await send(w, rec(A, RING, 'r1', S1, gina.pub));      // session 1, guardian gina
  await send(w, rec(A, RING, 'r2', S2, null));           // session 2, no guardian
  await sleep(350);

  const one = (who, d) => asks(who, { kinds: [30078], '#d': [d] }).then(x => x.length);

  // ── BASELINE. Without these every refusal below is vacuous. ──────────────────────────────────────────
  row('BASELINE  ada (helper S1) reads r1 (session S1)', await one(ada, D.CHECKIN + 'r1'), 1);
  row('BASELINE  ada reads her own S1 envelope', await one(ada, D.CHECKINHELPER + S1), 1);
  row('BASELINE  church A reads r2', await one(A, D.CHECKIN + 'r2'), 1);

  // ── CROSS-SESSION ───────────────────────────────────────────────────────────────────────────────────
  row('ada (S1 only) reads r2 (session S2)', await one(ada, D.CHECKIN + 'r2'), 0);
  row('ada fetches the S2 envelope', await one(ada, D.CHECKINHELPER + S2), 0);
  row('bea (S2 only) reads r1 (session S1)', await one(bea, D.CHECKIN + 'r1'), 0);

  // ── CROSS-CHURCH, same session id on one box ────────────────────────────────────────────────────────
  row('B helper (session id "a-svc-1" in B) reads A r1', await one(bhelp, D.CHECKIN + 'r1'), 0);
  { const got = await asks(bhelp, { kinds: [30078], '#d': [D.CHECKINHELPER + S1] });
    row('B helper fetches ANY envelope at that d-tag', got.length, 1);
    row('…and it is B\'s own, not A\'s', got.map(e => e.pubkey === B.pub ? 'B' : e.pubkey === A.pub ? 'A' : '?').join(','), 'B'); }
  row('ada fetches B\'s envelope at the same session id', (await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + SB], authors: [B.pub] })).length, 0);
  row('B\'s church key reads A\'s r1', await one(B, D.CHECKIN + 'r1'), 0);

  // ── ORDINARY MEMBER / GUARDIAN / DELEGATES ──────────────────────────────────────────────────────────
  row('ordinary member carl reads r1', await one(carl, D.CHECKIN + 'r1'), 0);
  row('guardian gina reads r1 (p-tagged)', await one(gina, D.CHECKIN + 'r1'), 1);
  row('guardian gina reads r2 (not p-tagged)', await one(gina, D.CHECKIN + 'r2'), 0);
  row('FINANCE-ONLY steward reads r1', await one(finA, D.CHECKIN + 'r1'), 1);
  row('FINANCE-ONLY steward reads the S1 envelope', await one(finA, D.CHECKINHELPER + S1), 1);
  row('FINANCE-ONLY steward reads ada\'s clearance', await one(finA, D.CHECKINPERM + ada.pub), 1);
  row('CARE ADMIN (no steward seat) reads r1', await one(careA, D.CHECKIN + 'r1'), 1);
  row('CARE ADMIN reads the S1 envelope', await one(careA, D.CHECKINHELPER + S1), 1);

  // ── WHAT THE FINANCE STEWARD ACTUALLY HOLDS ─────────────────────────────────────────────────────────
  const finRec = (await asks(finA, { kinds: [30078], '#d': [D.CHECKIN + 'r1'] }))[0];
  console.log('\nFinance-only steward\'s copy of r1, cleartext tags:', JSON.stringify(finRec && finRec.tags));
  let finOpened = 'refused';
  try { finOpened = nip44.decrypt(finRec.content, nip44.utils.getConversationKey(finA.sk, A.pub)); } catch { finOpened = 'cannot open'; }
  console.log('…and opening it with their own conversation key to the church:', finOpened.slice(0, 60));
  const finEnv = (await asks(finA, { kinds: [30078], '#d': [D.CHECKINHELPER + S1] }))[0];
  const finBody = finEnv && JSON.parse(finEnv.content);
  console.log('…the S1 envelope they are served:  pubs =', finBody && finBody.pubs, ' key slots =', finBody && Object.keys(finBody.keys));
  console.log('…is a slot wrapped to the finance steward?', !!(finBody && finBody.keys[finA.pub]));
  row('CONTROL the ring key really does open r1', (() => {
    try { return JSON.parse(nip44.decrypt(finRec.content, unhex(RING))).code; } catch { return 'no'; } })(), '4821');

  // ── THE WRITE GATE: WHAT DOES A HELPER'S SESSION TAG BIND? ───────────────────────────────────────────
  // Ada is an in-window helper of S1 ONLY. Every event below carries ['session', S1] — the tag she is
  // entitled to — and differs only in WHICH RECORD it addresses.
  const adaWrite = (dtag, session, extra = []) => publishAs(ada, doc(ada, dtag,
    nip44.encrypt(JSON.stringify({ id: dtag.slice(D.CHECKIN.length), childName: 'FORGED', code: '0000', out: 'collected by A. Stranger' }), unhex(KEY1)),
    [['church', A.pub], ['enc', '2'], ['session', session], ...extra]));

  row('ada writes a NEW record in her own session', (await adaWrite(D.CHECKIN + 'ada-new', S1))[0], true);
  row('ada OVERWRITES r1 (her own session\'s record)', (await adaWrite(D.CHECKIN + 'r1', S1))[0], true);
  row('ada OVERWRITES r2 — session S2, tagged S1', (await adaWrite(D.CHECKIN + 'r2', S1))[0], false);
  row('ada writes with session S2 in the tag', (await adaWrite(D.CHECKIN + 'r2', S2))[0], false);
  row('ada writes with NO session tag', (await publishAs(ada, doc(ada, D.CHECKIN + 'x1', 'zz', [['church', A.pub]])))[0], false);
  row('ada writes with TWO session tags, hers first', (await publishAs(ada, doc(ada, D.CHECKIN + 'x2', 'zz',
    [['church', A.pub], ['session', S1], ['session', S2]])))[0], true);
  row('ada writes with TWO session tags, hers SECOND', (await publishAs(ada, doc(ada, D.CHECKIN + 'x3', 'zz',
    [['church', A.pub], ['session', S2], ['session', S1]])))[0], false);
  row('ada writes tagged to church B', (await publishAs(ada, doc(ada, D.CHECKIN + 'x4', 'zz',
    [['church', B.pub], ['session', S1]])))[0], false);
  row('ada TOMBSTONES r1 (deleted tag + her session)', (await publishAs(ada, doc(ada, D.CHECKIN + 'r1', '',
    [['church', A.pub], ['session', S1], ['deleted', '1']])))[0], false);
  row('ada mints an ENVELOPE for a new session', (await publishAs(ada, doc(ada, D.CHECKINHELPER + 'ada-svc',
    JSON.parse(grant(A, 'ada-svc', [ada.pub], t - 60, t + 600, KEY1).content), [['church', A.pub]])))[0], false);
  row('ada mints a CLEARANCE for carl', (await publishAs(ada, permission(ada, A, carl.pub)))[0], false);
  row('sgA (safeguarding steward) mints an ENVELOPE', (await publishAs(sgA, doc(sgA, D.CHECKINHELPER + 'sg-svc',
    JSON.parse(grant(A, 'sg-svc', [ada.pub], t - 60, t + 600, KEY1).content), [['church', A.pub]])))[0], false);

  await sleep(300);
  // Who now holds a copy of r1, and whose is newest?
  const both = await asks(A, { kinds: [30078], '#d': [D.CHECKIN + 'r1'] });
  console.log('\ncopies of checkin:r1 on the box, served to the church:', both.length,
    both.map(e => ({ by: e.pubkey === A.pub ? 'CHURCH' : e.pubkey === ada.pub ? 'ada(helper)' : e.pubkey.slice(0, 8), at: e.created_at, enc: (e.tags.find(x => x[0] === 'enc') || [])[1] })));

  console.log('\n%s', 'question'.padEnd(52) + 'got'.padEnd(7) + 'want');
  for (const r of R) console.log(String(r[0]).padEnd(52) + String(r[1]).padEnd(7) + String(r[2]) + r[3]);
  const bad = R.filter(r => r[3]);
  console.log('\n' + bad.length + ' row(s) did not match expectation');

  try { w.close(); } catch {}
  try { relay.kill('SIGKILL'); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error('PROBE BLEW UP', e); try { relay.kill('SIGKILL'); } catch {} process.exit(1); });
