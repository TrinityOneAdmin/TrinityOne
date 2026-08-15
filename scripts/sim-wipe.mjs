// Remove everything scripts/sim.mjs created, from the relay it created it on.
//
//   node scripts/sim-wipe.mjs <relay-url> [keep-file]
//
// WHY THIS EXISTS AND WHY IT SHIPS WITH THE SIMULATION. This project has already accumulated junk tenants
// from test runs — 19 of them on a shared box at one point — because the runs that made them had no way to
// undo themselves. A simulation that cannot clean up is a simulation you stop being willing to run.
//
// Deletion is by NIP-09 (kind 5) signed by whoever authored the event, so it works for church-authored
// documents and member-authored ones alike. The relay may retain tombstones; what matters is that the
// content stops being served.
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { finalizeEvent } from 'nostr-tools/pure';

const RELAY = process.argv[2] || 'ws://127.0.0.1:8000/relay';
const KEEP = process.argv[3] || 'scripts/.sim-churches.json';
const unhex = (h) => Uint8Array.from(h.match(/.{2}/g).map(x => parseInt(x, 16)));
const now = () => Math.floor(Date.now() / 1000);

const churches = JSON.parse(readFileSync(KEEP, 'utf8'));
const ws = new WebSocket(RELAY);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

const pub = (evt) => new Promise((res) => {
  const on = (raw) => { try { const m = JSON.parse(String(raw)); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(m); } } catch {} };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
  setTimeout(() => { ws.off('message', on); res(null); }, 8000);
});

// everything this church and its members authored, by author
let removed = 0;
for (const ch of churches) {
  const authors = [{ sk: ch.sk, who: 'church' }, ...ch.members.map(m => ({ sk: m.sk, who: 'member' }))];
  for (const a of authors) {
    // a broad deletion request: the relay drops what this author wrote in the network
    const evt = finalizeEvent({ kind: 5, created_at: now(),
      tags: [['t', 'trinityone']], content: 'SIM cleanup' }, unhex(a.sk));
    const r = await pub(evt);
    if (r && r[2]) removed++;
  }
  console.log('  ' + ch.name + ': deletion requested for ' + (ch.members.length + 1) + ' identities');
}
console.log('\n  ' + removed + ' deletion requests accepted');
console.log('  NOTE: registration of the church itself is relay-side — ask the operator to drop the SIM npubs');
console.log('  from church.json if they should not remain listed:');
for (const ch of churches) console.log('    ' + ch.pub + '  ' + ch.name);
ws.close();
process.exit(0);
