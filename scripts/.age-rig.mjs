// AGEING RIG — does a member's live subscription stop delivering, and when?
// Its own relay, its own data dir, its own port. The live simulation is untouched.
//
// Holds ONE authenticated connection open, exactly as a phone left on a windowsill does, and every minute
// asks the church to change something addressed to that member personally (a clearance) and something
// addressed to the membership (a plan). Records which of the two arrives.
//
// If personally-addressed documents stop arriving while general ones keep coming, that is the defect, and
// the minute it starts is the thing worth knowing.
import { spawn } from 'node:child_process';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8124, NET = 'trinityone';
const LOG = new URL('../reference/sim/agerig/log.txt', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const say = (s) => { const line = new Date().toISOString().slice(11, 19) + '  ' + s; try { appendFileSync(LOG, line + '\n'); } catch {} console.log(line); };

const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const memberSk = generateSecretKey(), memberPub = getPublicKey(memberSk);
const dataDir = mkdtempSync(join(tmpdir(), 'agerig-'));

const relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
  cwd: ROOT, stdio: 'ignore',
  env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(churchPub), RELAY_MAX_EVENTS: '20000' },
});
process.on('exit', () => { try { relay.kill('SIGKILL'); } catch {} });
for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch {} await sleep(250); }
say('rig up on ' + PORT + ' — church ' + churchPub.slice(0, 8) + ', member ' + memberPub.slice(0, 8));

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/relay`);
const send = (m) => { try { ws.send(JSON.stringify(m)); } catch (e) { say('send failed: ' + e.message); } };
let sawClearance = false, sawPlan = false, closes = 0;

ws.on('message', (raw) => {
  const d = JSON.parse(raw);
  if (d[0] === 'AUTH') send(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
    tags: [['relay', `ws://127.0.0.1:${PORT}/relay`], ['challenge', d[1]]], content: '' }, memberSk)]);
  if (d[0] === 'CLOSED') { closes++; say('RELAY CLOSED a subscription: ' + d[1] + ' — ' + d[2]); }
  if (d[0] === 'EVENT') {
    const t = (d[2].tags.find(x => x[0] === 'd') || [])[1] || '';
    if (t.startsWith('trinityone/clearance:')) sawClearance = true;
    if (t.startsWith('trinityone/plan:')) sawPlan = true;
  }
});
ws.on('close', () => say('!! the socket CLOSED — a phone would reconnect here'));
ws.on('error', (e) => say('!! socket error: ' + e.message));

await new Promise(r => ws.on('open', r));
await sleep(500);
send(['EVENT', finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + churchPub], ['t', NET], ['church', churchPub]], content: '{}' }, memberSk)]);
send(['EVENT', finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/admitted:' + churchPub], ['t', NET]], content: JSON.stringify({ pubkeys: [memberPub] }) }, churchSk)]);
await sleep(1500);
send(['REQ', 'hub', { kinds: [30078], authors: [churchPub], '#t': [NET] }, { kinds: [30078], '#church': [churchPub], '#t': [NET] }]);
await sleep(1000);
say('subscribed, holding the connection open. one round per minute.');

let round = 0, firstFailure = null;
for (;;) {
  round++;
  sawClearance = false; sawPlan = false;
  send(['EVENT', finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', 'trinityone/clearance:' + memberPub], ['t', NET], ['p', memberPub], ['church', churchPub]],
    content: JSON.stringify({ minor: false, cleared: round % 2 === 0 }) }, churchSk)]);
  send(['EVENT', finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', 'trinityone/plan:agerig' + round], ['t', NET]], content: JSON.stringify({ id: 'agerig' + round }) }, churchSk)]);
  await sleep(4000);
  if (!sawClearance || !sawPlan) {
    if (!firstFailure) { firstFailure = round; say('*** FIRST FAILURE at round ' + round + ' (~' + round + ' min in)'); }
    say('round ' + round + ': personal=' + sawClearance + ' general=' + sawPlan + ' (closes so far: ' + closes + ')');
  } else if (round % 15 === 0) {
    say('round ' + round + ': both still arriving');
  }
  await sleep(56000);
}
