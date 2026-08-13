// Add a REAL encrypted room to the throwaway seed church, optionally keyed to a member.
//
//   node scripts/seed-encrypted-group.mjs <relay-url> [memberPubHex]
//
// WHY. The encryption label and the send path used to read two different facts (the steward's setting vs
// whether this member holds the key), and the states that mattered — "a key is held" and "this room is
// encrypted and I have none" — could only be exercised against a room that is genuinely encrypted. The seed
// church has none, so its nine rooms only ever proved the 'clear' case.
//
// Publishes exactly what src/steward.src.js publishes: the group doc (trinityone/group:<id>, encrypted:true)
// and the church-signed key envelope (trinityone/groupkey:<id>) with BOTH shapes, `keys` (current key, bare
// hex) and `rings` (the whole ring as JSON) — an envelope carrying only one of them is a shape a real app
// reads as an empty room.
//
// Omit memberPubHex and the envelope is sealed to the church alone: that is the 'nokey' case on a member's
// phone, which is the one that used to publish plaintext under an "End-to-end encrypted" label.
//
// NEVER point this at a real church. It signs as the seed church key and nothing else.
import { existsSync, readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import { nip44 } from 'nostr-tools';

const RELAY = process.argv[2] || 'ws://127.0.0.1:8000/relay';
const MEMBER = (process.argv[3] || '').trim().toLowerCase();
const NET = 'trinityone';
const GROUP_D = 'trinityone/group:';
const GROUPKEY_D = 'trinityone/groupkey:';
const GID = 'enc-test-room';
const now = () => Math.floor(Date.now() / 1000);
const hex = (b) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

const KEYFILE = new URL('./.seed-church.json', import.meta.url);
if (!existsSync(KEYFILE)) { console.error('no scripts/.seed-church.json — run scripts/seed-church.mjs first'); process.exit(1); }
const church = JSON.parse(readFileSync(KEYFILE, 'utf8'));
const sk = Uint8Array.from(Buffer.from(church.sk, 'hex'));
const pub = church.pub;

const gkey = crypto.getRandomValues(new Uint8Array(32));
const ring = [gkey];
const recips = [...new Set([pub, ...(MEMBER ? [MEMBER] : [])])];
const keys = {}, rings = {};
for (const pk of recips) {
  const ck = nip44.v2.utils.getConversationKey(sk, pk);
  keys[pk] = nip44.v2.encrypt(hex(ring[0]), ck);
  rings[pk] = nip44.v2.encrypt(JSON.stringify(ring.map(hex)), ck);
}

const groupDoc = finalizeEvent({
  kind: 30078, created_at: now(), tags: [['d', GROUP_D + GID], ['t', NET]],
  content: JSON.stringify({ name: 'Leaders (encrypted)', kind: 'group', encrypted: true, visibility: 'open', sub: 'A room that really is sealed' }),
}, sk);
const keyDoc = finalizeEvent({
  kind: 30078, created_at: now(), tags: [['d', GROUPKEY_D + GID], ['t', NET]],
  content: JSON.stringify({ rev: 1, keys, rings }),
}, sk);

const ws = new WebSocket(RELAY);
let acked = 0;
ws.on('open', () => { for (const e of [groupDoc, keyDoc]) ws.send(JSON.stringify(['EVENT', e])); });
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m[0] === 'OK') {
    console.log('  ' + (m[1] === groupDoc.id ? 'group doc ' : 'key envelope') + '  ok=' + m[2] + (m[3] ? ' ' + m[3] : ''));
    if (++acked === 2) {
      console.log('\n  church     : ' + pub.slice(0, 16) + '…');
      console.log('  group id   : ' + GID + '  ("Leaders (encrypted)")');
      console.log('  key sealed : ' + (MEMBER ? 'church + ' + MEMBER.slice(0, 16) + '…' : 'CHURCH ONLY — a member will be in the "no key yet" state'));
      console.log('  group key  : ' + hex(gkey).slice(0, 16) + '…  (for checking ciphertext on the relay)');
      ws.close(); process.exit(0);
    }
  }
});
ws.on('error', (e) => { console.error('relay error: ' + e.message); process.exit(1); });
setTimeout(() => { console.error('timed out with ' + acked + '/2 acked'); process.exit(1); }, 15000);
