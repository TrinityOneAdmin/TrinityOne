// Volume simulation for the safety roll-call's multi-reader replies. NOT in `npm test` (it spawns a relay and
// pushes hundreds of events); run it directly:
//     node scripts/netsim-safety.mjs [members] [stewards]
//
// WHY: as of 2026-08-04 a safety reply is sealed to EVERY reader the steward chose plus the church key, and
// NIP-44 is one-to-one — so the event carries one ciphertext per reader. Size grows with the audience and the
// publish count grows with the congregation, at the exact moment (an emergency) when every member replies at
// once over a bad link. Both of those are new, and neither was measured.
//
// HONEST LIMIT: this builds the v2 envelope the same way src/fellowship.src.js does rather than driving the
// shipped markSafe, which lives in an object literal bound to a live relay pool and cannot be lifted. The shape
// is cross-checked against the source below, so a drift in the shipped format fails the run instead of being
// silently simulated. What IS real here: the relay, its write policy, its rate limiting, its size limits, and
// the decryption by each intended reader.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44v2 } from 'nostr-tools/nip44';

const MEMBERS = Number(process.argv[2] || 150);
const STEWARDS = Number(process.argv[3] || 8);
const PORT = 8991;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc = (sk, to, s) => nip44v2.encrypt(s, nip44v2.utils.getConversationKey(sk, to));
const dec = (sk, from, s) => nip44v2.decrypt(s, nip44v2.utils.getConversationKey(sk, from));

// Cross-check: the shipped envelope must still be { v:2, to:{pub:ct} } sealed to church + audience.
const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
for (const needle of ['v: 2', 'readers = [cp]', 'to[r] = _dmEncrypt(sk, r, body)']) {
  if (!SRC.includes(needle)) { console.error(`✗ shipped markSafe no longer matches this simulation (missing: ${needle}) — re-sync before trusting these numbers`); process.exit(2); }
}

const church = K();
const dataDir = mkdtempSync(join(tmpdir(), 'netsim-safety-'));
const relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
  env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '100000', CHURCH_NPUB: npubEncode(church.pub) },
});
const die = (c) => { try { relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} process.exit(c); };
process.on('uncaughtException', e => { console.error(e); die(1); });

const pool = new SimplePool();
const relays = [WS_URL];
const pub1 = async (evt) => { const rs = await Promise.allSettled(pool.publish(relays, evt)); const ok = rs.some(r => r.status === 'fulfilled' && !(typeof r.value === 'string' && /connection failure/.test(r.value))); const why = rs.map(r => r.status === 'rejected' ? String(r.reason && r.reason.message || r.reason) : String(r.value || '')).find(x => x && x !== 'undefined') || ''; return { ok, why }; };
const churchEvt = (o) => finalizeEvent({ ...o, tags: [...o.tags, ['church', church.pub]] }, church.sk);

(async () => {
  for (let i = 0; i < 40; i++) { try { const w = new WebSocket(WS_URL); await new Promise((res, rej) => { w.on('open', res); w.on('error', rej); }); w.close(); break; } catch { await sleep(150); } }

  const stewards = Array.from({ length: STEWARDS }, K);
  const members = Array.from({ length: MEMBERS }, K);
  console.log(`\nSAFETY ROLL-CALL VOLUME SIM — ${MEMBERS} members, ${STEWARDS} stewards, +1 church key = ${STEWARDS + 1} readers per reply\n`);

  // roster: everyone joins, church publishes the steward list
  for (const m of [...members, ...stewards]) {
    await pub1(finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [['d', 'trinityone/member:' + church.pub], ['t', NET], ['p', church.pub]], content: '{}' }, m.sk));
  }
  await pub1(churchEvt({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [['d', 'trinityone/stewards:' + church.pub], ['t', NET]], content: JSON.stringify({ pubkeys: stewards.map(s => s.pub) }) }));
  await sleep(400);

  // the check itself
  const checkId = 'sc' + Date.now();
  await pub1(churchEvt({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [['d', 'trinityone/safetycheck:' + church.pub], ['t', NET]], content: JSON.stringify({ id: checkId, message: 'Are you safe?', at: Math.floor(Date.now() / 1e3), open: true, audience: 'stewards' }) }));
  await sleep(300);

  // every member replies at once — the emergency case
  const readers = [church.pub, ...stewards.map(s => s.pub)];
  const sizes = []; let accepted = 0; const failures = new Map();
  const t0 = Date.now();
  // PACING. Real members publish from N devices over N sockets; this sim shares one, so an unbounded
  // Promise.all overstates per-connection pressure. WAVE lets us tell a relay limit from a socket limit:
  // pass a third arg to pace, e.g. `node scripts/netsim-safety.mjs 200 12 20`.
  const WAVE = Number(process.argv[4] || 0);
  const runAll = async (fn) => {
    if (!WAVE) return Promise.all(members.map(fn));
    const out = [];
    for (let i = 0; i < members.length; i += WAVE) {
      out.push(...await Promise.all(members.slice(i, i + WAVE).map((m, j) => fn(m, i + j))));
      await sleep(120);
    }
    return out;
  };
  const results = await runAll(async (m, i) => {
    const body = JSON.stringify({ status: i % 7 === 0 ? 'help' : 'safe', note: i % 7 === 0 ? 'Trapped, need someone to come.' : '', at: Math.floor(Date.now() / 1e3), checkId });
    const to = {}; for (const r of readers) { try { to[r] = enc(m.sk, r, body); } catch {} }
    const content = JSON.stringify({ v: 2, to });
    sizes.push(content.length);
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [['d', 'trinityone/safe:' + church.pub], ['t', NET], ['church', church.pub], ['p', church.pub]], content }, m.sk);
    const { ok, why } = await pub1(evt);
    if (ok) accepted++; else failures.set(why.slice(0, 80), (failures.get(why.slice(0, 80)) || 0) + 1);
    return { ok, pub: m.pub, evt };
  });
  const ms = Date.now() - t0;
  sizes.sort((a, b) => a - b);

  console.log(`envelope size   min ${sizes[0]}B · median ${sizes[sizes.length >> 1]}B · max ${sizes[sizes.length - 1]}B`);
  console.log(`publish         ${accepted}/${MEMBERS} accepted in ${ms}ms  (${(MEMBERS / (ms / 1000)).toFixed(0)}/s attempted)`);
  if (failures.size) for (const [why, n] of failures) console.log(`   ✗ ${n} × ${why}`);

  // THE READ GATE, checked first: an unauthenticated reader must get NOTHING. A safety reply names who needs
  // help; the relay serves these only to the author, the check's creator, the church and its stewards.
  await sleep(600);
  const anon = await pool.querySync(relays, [{ kinds: [30078], '#d': ['trinityone/safe:' + church.pub], limit: MEMBERS + 50 }]);
  console.log(`anon readback   ${anon.length} events served to an unauthenticated reader (must be 0)`);

  // Decryption is checked against the events as published — the relay's refusal above is correct, and
  // authenticating a synthetic steward here would test NIP-42, which has its own suite.
  const stored = results.filter(r => r.ok).map(r => r.evt);
  let churchOk = 0, stewardOk = 0, stewardTried = 0, helpFound = 0;
  for (const e of stored) {
    let env = null; try { env = JSON.parse(e.content); } catch {}
    if (!env || env.v !== 2) continue;
    try { const o = JSON.parse(dec(church.sk, e.pubkey, env.to[church.pub])); churchOk++; if (o.status === 'help') helpFound++; } catch {}
    const s = stewards[0]; stewardTried++;
    try { dec(s.sk, e.pubkey, env.to[s.pub]); stewardOk++; } catch {}
  }
  console.log(`church key      opened ${churchOk}/${stored.length}`);
  console.log(`steward #1      opened ${stewardOk}/${stewardTried}`);
  console.log(`"need help"     ${helpFound} found by the church key (expected ${Math.ceil(MEMBERS / 7)})`);

  // an OUTSIDER must not be able to open one
  const outsider = K();
  let leaked = 0;
  for (const e of stored.slice(0, 20)) { try { const env = JSON.parse(e.content); if (env.to[outsider.pub]) leaked++; } catch {} }
  console.log(`outsider        sealed-to entries: ${leaked} (must be 0)`);

  const bad = accepted !== MEMBERS || churchOk !== stored.length || stewardOk !== stewardTried || leaked !== 0 || anon.length !== 0 || helpFound !== Math.ceil(MEMBERS / 7);
  console.log(bad ? '\n✗ FAILED — see above\n' : '\n✓ every reply accepted, openable by the church and by a steward, and served to nobody else\n');
  pool.close(relays); die(bad ? 1 : 0);
})();
