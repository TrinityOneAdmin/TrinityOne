// Give one room enough volume to behave like a real one.
//
//   node scripts/seed-room.mjs <church-npub-or-hex> <groupId> [count] [relay-url]
//
// Signed by the people in scripts/.seed-members.json (run seed-members.mjs first), in the exact shape
// src/fellowship.src.js sendMessage() writes: kind 1, ['t','trinityone'], ['t',<groupId>], ['p',<churchpub>].
//
// WHY VOLUME MATTERS. Several 2026-08-16 findings only appear in a BUSY room — the group-list preview going
// stale, the harness's own 1800-character truncation, the scroll anchoring. A room with four messages in it
// looks perfect under every one of them. Messages are spread backwards four minutes apart and end a minute
// ago, so the newest are unmistakably recent and "did this update?" has an obvious answer.
//
// Test data only. Never point this at a real church.
import { readFileSync, existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import { decode as nip19decode } from 'nostr-tools/nip19';

const [, , CHURCH_ARG, GID, COUNT_ARG, RELAY_ARG] = process.argv;
if (!CHURCH_ARG || !GID) { console.error('usage: node scripts/seed-room.mjs <church-npub-or-hex> <groupId> [count] [relay-url]'); process.exit(2); }
const COUNT = Math.max(1, Math.min(500, parseInt(COUNT_ARG || '60', 10)));
const RELAY = RELAY_ARG || 'ws://127.0.0.1:8000/relay';
const NET = 'trinityone';
const cp = /^[0-9a-f]{64}$/i.test(CHURCH_ARG) ? CHURCH_ARG.toLowerCase() : (() => {
  const d = nip19decode(CHURCH_ARG); if (d.type !== 'npub') { console.error('not an npub'); process.exit(2); } return d.data;
})();
const MB = new URL('./.seed-members.json', import.meta.url);
if (!existsSync(MB)) { console.error('run scripts/seed-members.mjs first — this signs as those people'); process.exit(2); }
const people = JSON.parse(readFileSync(MB, 'utf8'));

const LINES = ['Morning all', 'Can someone bring the urn on Sunday?', 'Praying for you', 'Just parked round the back',
  'Is the hall free Thursday?', 'Thank you for last night', 'I can do the 10am slot', 'Running five minutes late',
  'Lovely to see everyone', 'Does anyone have a spare key?', 'Adding it to the list', 'See you there',
  'That was such a good evening', 'Sorry — can’t make it this week', 'Count me in'];

const ws = new WebSocket(RELAY);
await new Promise(r => ws.on('open', r));
const now = Math.floor(Date.now() / 1000);
let ok = 0, no = 0;
const waiting = new Map();
ws.on('message', (d) => {
  try { const m = JSON.parse(d); if (m[0] === 'OK') { m[2] ? ok++ : no++; const f = waiting.get(m[1]); if (f) { waiting.delete(m[1]); f(); } } } catch {}
});
for (let i = 0; i < COUNT; i++) {
  const who = people[i % people.length];
  const at = now - 60 - (COUNT - 1 - i) * 240;   // oldest first, newest a minute ago
  const evt = finalizeEvent({
    kind: 1, created_at: at,
    tags: [['t', NET], ['t', GID], ['p', cp]],
    content: `${LINES[i % LINES.length]} (#${i + 1} of ${COUNT})`,
  }, Buffer.from(who.sk, 'hex'));
  // wait for each OK: the relay refuses a same-second flood from one author, and a silent refusal here is
  // indistinguishable from a client bug in whatever you go on to test.
  await new Promise((res) => { waiting.set(evt.id, res); ws.send(JSON.stringify(['EVENT', evt])); setTimeout(res, 2500); });
}
await new Promise(r => setTimeout(r, 600));
const stamp = (t) => new Date(t * 1000).toISOString().slice(11, 19);
console.log(`${GID}: ${ok} accepted, ${no} refused`);
console.log(`oldest ${stamp(now - 60 - (COUNT - 1) * 240)} UTC, newest ${stamp(now - 60)} UTC`);
if (no) console.log('check relay/rejected.log for why');
ws.close(); process.exit(0);
