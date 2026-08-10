// Make the seeded congregation's names visible TO EACH OTHER.
//
//   node scripts/seed-names.mjs [relay-url] [extra-pubkey-hex ...]
//
// seed-members.mjs seals each name twice: `m` to the member themselves, and `c` with
// nip44(memberSk, churchPub). That `c` is the PRE-ADMISSION path — the steward console opens it with the
// church key while someone is still pending. It is not what the congregation reads.
//
// After admission, every member opens `c` with the church's NAME KEY:
//     _openSealedName() -> nip44d(cipher.c, nameKey)          (src/fellowship.src.js)
// and the name key itself arrives as trinityone/namekey:<church> = { rev, keys }, where each member's copy is
// the ring wrapped with nip44(churchSk, theirPub).
//
// Without this, every message in every room renders as "Member" — which is precisely what a screenshot must
// not show. So: mint the ring, wrap it to every reader, then re-publish each member's name doc with `c`
// sealed to the ring instead.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import { v2 as nip44v2 } from 'nostr-tools/nip44';

const args = process.argv.slice(2);
const RELAY = (args[0] && args[0].startsWith('ws')) ? args.shift() : 'ws://127.0.0.1:8000/relay';
const EXTRA = args.filter(a => /^[0-9a-f]{64}$/i.test(a)).map(a => a.toLowerCase());

const NET = 'trinityone';
const CH = new URL('./.seed-church.json', import.meta.url);
const MB = new URL('./.seed-members.json', import.meta.url);
const NKFILE = new URL('./.seed-namekey.json', import.meta.url);
if (!existsSync(CH) || !existsSync(MB)) { console.error('run seed-church.mjs and seed-members.mjs first'); process.exit(2); }
const church = JSON.parse(readFileSync(CH, 'utf8'));
const people = JSON.parse(readFileSync(MB, 'utf8'));
const CP = church.pub;
const CSK = Uint8Array.from(Buffer.from(church.sk, 'hex'));
const now = () => Math.floor(Date.now() / 1000);
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

let nameKeyHex;
if (existsSync(NKFILE)) { nameKeyHex = JSON.parse(readFileSync(NKFILE, 'utf8')).key; console.log('re-using the name key'); }
else { nameKeyHex = hex(crypto.getRandomValues(new Uint8Array(32))); writeFileSync(NKFILE, JSON.stringify({ key: nameKeyHex }, null, 1)); console.log('minted a name key'); }
const RING = [nameKeyHex];
const NK = unhex(nameKeyHex);

const conn = () => new Promise((res, rej) => { const w = new WebSocket(RELAY); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, e, sk) => new Promise((res) => {
  const on = (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH' && sk) {
      w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', RELAY], ['challenge', m[1]]], content: '' }, sk)]));
      w.send(JSON.stringify(['EVENT', e]));
      return;
    }
    if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); }
  };
  w.on('message', on);
  w.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { w.off('message', on); res([false, 'timed out']); }, 12000);
});

const w = await conn();

// 1. the name key, wrapped to every reader (the phone is not one of the seeded members — pass its pubkey).
const readers = [...new Set([CP, ...people.map(p => p.pub), ...EXTRA])];
const keys = {};
const wrapped = JSON.stringify(RING);
for (const rp of readers) { try { keys[rp] = nip44v2.encrypt(wrapped, nip44v2.utils.getConversationKey(CSK, rp)); } catch (e) {} }
const keyDoc = finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', NET + '/namekey:' + CP], ['t', NET]], content: JSON.stringify({ rev: RING.length, keys }) }, CSK);
const [okKey, whyKey] = await publish(w, keyDoc, CSK);
console.log(okKey ? `namekey published to ${readers.length} readers` : 'namekey REFUSED — ' + whyKey);

// 2. every member's name doc, with `c` sealed to the ring so the congregation can read it.
let ok = 0; const bad = [];
for (const p of people) {
  const sk = Uint8Array.from(Buffer.from(p.sk, 'hex'));
  const body = JSON.stringify({ name: p.name });
  const content = JSON.stringify({
    c: nip44v2.encrypt(body, NK),                                                   // the congregation
    m: nip44v2.encrypt(body, nip44v2.utils.getConversationKey(sk, p.pub)),          // their own copy
  });
  const evt = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', NET + '/name:' + CP], ['t', NET], ['church', CP]], content }, sk);
  const [good, why] = await publish(w, evt, sk);
  if (good) ok++; else bad.push(`${p.name}: ${why}`);
  process.stdout.write(good ? '.' : 'x');
}
w.close();
console.log('\n');
console.log(`names re-sealed to the congregation : ${ok}/${people.length}`);
if (bad.length) { console.log('refused:'); bad.slice(0, 6).forEach(b => console.log('  ' + b)); }
