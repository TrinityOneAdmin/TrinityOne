// STAND UP A WHOLE CONGREGATION OF LIVE APP INSTANCES, in batches, and report what actually came up.
//
//   node scripts/sim-round.mjs <roster.json> --church <npub> --url <appUrl> --relay <wss> [--batch 8]
//
// One chromium per member is the point: the previous rounds' real findings all lived in the client's own
// judgement, and a script that publishes correct documents by construction cannot reproduce any of them.
//
// It reports FAILURES BY NAME rather than a count. A round that quietly comes up 26/30 and calls itself 30 is
// how a "nobody could see the care need" finding turns out to be four members who were never there.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const rosterPath = process.argv[2];
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const CHURCH = arg('--church', '');
const URL_ = arg('--url', 'http://127.0.0.1:8000/index.html');
const RELAY = arg('--relay', '');
const CHURCH_NAME = arg('--church-name', 'the church');
const BATCH = Number(arg('--batch', 8));
const OUT = arg('--out', '/mnt/storage/tmp/trinity-scratch/sim-cast.json');
if (!rosterPath || !CHURCH) { console.error('usage: sim-round.mjs <roster.json> --church <npub> [--url U] [--relay wss] [--batch N]'); process.exit(2); }

const roster = JSON.parse(readFileSync(rosterPath, 'utf8'));
const results = [];

function onboard(p) {
  return new Promise(resolve => {
    const a = ['scripts/sim-onboard.mjs', String(p.port), p.name, '--church', CHURCH, '--url', URL_, '--church-name', CHURCH_NAME];
    if (RELAY) a.push('--relay', RELAY);
    const c = spawn('node', a, { cwd: process.cwd() });
    let out = '';
    c.stdout.on('data', d => { out += d; });
    c.on('close', () => {
      let r = null;
      try { r = JSON.parse(out.trim().split('\n').pop()); } catch {}
      resolve(r && r.ok ? { ...p, pubkey: r.pubkey, ok: true } : { ...p, ok: false, why: (r && r.why) || 'no result' });
    });
  });
}

for (let i = 0; i < roster.length; i += BATCH) {
  const batch = roster.slice(i, i + BATCH);
  process.stderr.write(`— batch ${Math.floor(i / BATCH) + 1}: ${batch.map(b => b.name.split(' ')[0]).join(', ')}\n`);
  results.push(...await Promise.all(batch.map(onboard)));
}

const up = results.filter(r => r.ok);
const down = results.filter(r => !r.ok);
writeFileSync(OUT, JSON.stringify(up, null, 1) + '\n');
console.log(`\nUP   ${up.length}/${roster.length}`);
for (const d of down) console.log(`DOWN ${d.name} (port ${d.port}) — ${d.why}`);
console.log(`\ncast written to ${OUT}`);
