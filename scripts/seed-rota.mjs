// Put the phone on a serving rota, so the Serving screen shows a rota instead of "You're not on a team yet".
//
//   node scripts/seed-rota.mjs [relay-url] [member-pubkey-hex ...]
//
// Four documents make a rota, and the member app needs all four or the screen stays empty:
//   trinityone/group:<id>      kind:'team'  — the team itself (name/icon come from here)
//   trinityone/roster:<team>   {roles, people} — who is ELIGIBLE. Being here alone already beats the empty
//                              state: "teams I'm on the roster for, even if not yet scheduled"
//   trinityone/service:<id>    {date, time, name} — a dated service to schedule against
//   trinityone/rota:<service>  {published:true, assign:{ "<team>::<role>": {pub} }} — the actual placement.
//                              `published` false and the app ignores it entirely.
//
// Pass member pubkeys to place them on the rota — the phone's own identity is not one of the seeded 120, so
// without it you get a rota of other people and an empty "you're serving" list.
import { existsSync, readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';

const args = process.argv.slice(2);
const RELAY = (args[0] && args[0].startsWith('ws')) ? args.shift() : 'ws://127.0.0.1:8000/relay';
const ME = args.filter(a => /^[0-9a-f]{64}$/i.test(a)).map(a => a.toLowerCase());

const NET = 'trinityone';
const CH = new URL('./.seed-church.json', import.meta.url);
const MB = new URL('./.seed-members.json', import.meta.url);
if (!existsSync(CH) || !existsSync(MB)) { console.error('run seed-church.mjs and seed-members.mjs first'); process.exit(2); }
const church = JSON.parse(readFileSync(CH, 'utf8'));
const people = JSON.parse(readFileSync(MB, 'utf8'));
const CP = church.pub;
const CSK = Uint8Array.from(Buffer.from(church.sk, 'hex'));
const now = () => Math.floor(Date.now() / 1000);
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };

// Sunday-morning teams, the ones every church actually runs.
const TEAMS = [
  { id: 'stm-welcome-team', name: 'Welcome team', icon: 'hand', accent: 'var(--clay)',
    roles: [{ id: 'door', name: 'On the door' }, { id: 'coffee', name: 'Coffee' }] },
  { id: 'stm-music-team',   name: 'Music',        icon: 'hand', accent: 'var(--sage)',
    roles: [{ id: 'lead', name: 'Leading' }, { id: 'keys', name: 'Keys' }] },
  { id: 'stm-reading-team', name: 'Readings',     icon: 'hand', accent: 'var(--gold)',
    roles: [{ id: 'ot', name: 'Old Testament' }, { id: 'nt', name: 'New Testament' }] },
];

// Three Sundays out.
const SERVICES = [
  { id: 'svc-1', date: day(2),  time: '10:00', name: 'Morning worship' },
  { id: 'svc-2', date: day(9),  time: '10:00', name: 'Morning worship' },
  { id: 'svc-3', date: day(16), time: '10:00', name: 'Baptism service' },
];

const conn = () => new Promise((res, rej) => { const w = new WebSocket(RELAY); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, e) => new Promise((res) => {
  const on = (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH') {
      w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', RELAY], ['challenge', m[1]]], content: '' }, CSK)]));
      w.send(JSON.stringify(['EVENT', e]));
      return;
    }
    if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); }
  };
  w.on('message', on);
  w.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { w.off('message', on); res([false, 'timed out']); }, 12000);
});
const doc = (d, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET]], content: JSON.stringify(content) }, CSK);

const w = await conn();
const results = [];
const say = async (label, e) => { const [ok, why] = await publish(w, e); results.push([label, ok, why]); process.stdout.write(ok ? '.' : 'x'); };

// A named person for a slot: the phone first where given, then seeded members.
const named = (pub, name) => ({ pub, name });
const pick = (i) => named(people[i % people.length].pub, people[i % people.length].name);

// 1. teams (a group with kind 'team' — churchTeams filters on exactly that)
for (const t of TEAMS) {
  await say('team:' + t.id, doc(NET + '/group:' + t.id, {
    name: t.name, kind: 'team', sub: '', icon: t.icon, accent: t.accent, leaders: [], order: 9,
  }));
}
// 2. rosters — who is eligible. The phone goes on Welcome team.
await say('roster:welcome', doc(NET + '/roster:stm-welcome-team', {
  roles: TEAMS[0].roles,
  people: [...ME.map(p => named(p, 'You')), pick(11), pick(12), pick(30)],
}));
await say('roster:music', doc(NET + '/roster:stm-music-team', {
  roles: TEAMS[1].roles, people: [pick(8), pick(17), pick(22)],
}));
await say('roster:reading', doc(NET + '/roster:stm-reading-team', {
  roles: TEAMS[2].roles, people: [pick(0), pick(19), pick(4)],
}));
// 3. services
for (const s of SERVICES) await say('service:' + s.id, doc(NET + '/service:' + s.id, { date: s.date, time: s.time, name: s.name }));
// 4. published rotas — the phone on the door this Sunday and again in a fortnight
const A = (team, role, who) => [team + '::' + role, who];
const rota = (svc, pairs) => doc(NET + '/rota:' + svc, { published: true, assign: Object.fromEntries(pairs) });
await say('rota:svc-1', rota('svc-1', [
  A('stm-welcome-team', 'door',   ME[0] ? named(ME[0], 'You') : pick(11)),
  A('stm-welcome-team', 'coffee', pick(12)),
  A('stm-music-team',   'lead',   pick(8)),
  A('stm-music-team',   'keys',   pick(17)),
  A('stm-reading-team', 'ot',     pick(0)),
  A('stm-reading-team', 'nt',     pick(19)),
]));
await say('rota:svc-2', rota('svc-2', [
  A('stm-welcome-team', 'door',   pick(30)),
  A('stm-welcome-team', 'coffee', ME[0] ? named(ME[0], 'You') : pick(12)),
  A('stm-music-team',   'lead',   pick(22)),
  A('stm-reading-team', 'nt',     pick(4)),
]));
await say('rota:svc-3', rota('svc-3', [
  A('stm-welcome-team', 'door',   ME[0] ? named(ME[0], 'You') : pick(11)),
  A('stm-music-team',   'lead',   pick(8)),
  A('stm-reading-team', 'ot',     pick(0)),
]));
w.close();

const bad = results.filter(r => !r[1]);
console.log('\n');
console.log(`published : ${results.length - bad.length}/${results.length}`);
console.log(`on the rota: ${ME.length ? ME[0].slice(0, 12) + '… (door, twice)' : 'nobody — pass a pubkey'}`);
if (bad.length) { console.log('\nrefused:'); bad.forEach(([l, , why]) => console.log('  ' + l + ' — ' + why)); }
