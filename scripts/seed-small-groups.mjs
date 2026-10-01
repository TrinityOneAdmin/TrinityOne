// Give the seed church's small groups their OWN people, as a real church's are.
//
//   node scripts/seed-small-groups.mjs [relay-url]
//
// Run after seed-church.mjs, seed-members.mjs and seed-names.mjs, and BEFORE seed-chat.mjs.
//
// WHY. seed-church.mjs publishes every room open, and an open room is open to the whole church — so the steward
// console's Overview listed every one of them as "120 members" (groupLiveSub in app/stew-dashboard.jsx: an open
// group shows the church's size, because every member may join it). That is what the website's console shot
// showed on 2026-09-15, and it is not what a church looks like: notices and prayer are for everyone, but the
// Tuesday morning group is a dozen people round Margaret's table. Owner, 2026-10-01: "every group with 120
// members, we might want to fix that to look more organic".
//
// WHAT IT WRITES is what the console writes when a steward ticks people in a room's member list
// (EditGroupMembersModal -> Steward.publishGroup({ ...group, visibility: 'invite', members })): the room's own
// trinityone/group:<id> document, every field it already had kept, plus `visibility: 'invite'` and `members`
// (hex pubkeys), with the content keys in publishGroup's order. It READS the room back from the relay first and
// re-publishes that, rather than restating names and blurbs here, so it cannot drift from seed-church.mjs.
//
// THE LISTS ARE FIXED, NOT RANDOM, and every person who speaks in that room in seed-chat.mjs is on its list —
// the relay refuses a post into an invite-only room from anyone who is not (scripts/gateway.mjs, the
// GROUP_VIS === 'invite' branch of the write gate). Indices are into scripts/.seed-members.json, which is the
// NAMES list of seed-members.mjs in order; the people seed-chat names in a room are on its list (the welcome
// team's rota line names Peter, Naomi and Michael — 11, 12, 13).
//
// NEVER point this at a real church. It signs as the seed church key and nothing else.
import { existsSync, readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';

const RELAY = process.argv[2] || 'ws://127.0.0.1:8000/relay';
const NET = 'trinityone';
const GROUP_D = NET + '/group:';
const CH = new URL('./.seed-church.json', import.meta.url);
const MB = new URL('./.seed-members.json', import.meta.url);
if (!existsSync(CH) || !existsSync(MB)) { console.error('run seed-church.mjs and seed-members.mjs first'); process.exit(2); }
const church = JSON.parse(readFileSync(CH, 'utf8'));
const people = JSON.parse(readFileSync(MB, 'utf8'));
const CP = church.pub;
const CSK = Uint8Array.from(Buffer.from(church.sk, 'hex'));
const now = () => Math.floor(Date.now() / 1000);

// Sizes a parish of 120 actually has: a midweek group of a dozen, a youth group in the high teens, a welcome
// team of eight, ten musicians, a front-room life group of nine. Overlaps are deliberate — Ruth (6) is in the
// Tuesday group and on the door.
const ROOMS = {
  'tuesday':       [0, 5, 9, 14, 21, 6, 26, 31, 44, 57, 71, 88],                                  // 12
  'stm-youth':     [10, 24, 33, 38, 47, 52, 60, 64, 67, 73, 79, 84, 91, 97, 103, 110, 116],         // 17
  'welcome':       [6, 12, 16, 11, 13, 30, 41, 95],                                                 // 8
  'musicians':     [8, 17, 22, 27, 35, 49, 58, 76, 82, 99],                                         // 10
  'stm-wednesday': [1, 4, 15, 18, 29, 40, 53, 66, 85],                                              // 9
};
const need = Math.max(...Object.values(ROOMS).flat()) + 1;
if (people.length < need) { console.error(`scripts/.seed-members.json has ${people.length} people; these lists need ${need}. Run seed-members.mjs with 120.`); process.exit(2); }

const conn = () => new Promise((res, rej) => { const w = new WebSocket(RELAY); w.on('open', () => res(w)); w.on('error', rej); });
const authEvt = (challenge) => finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', RELAY], ['challenge', challenge]], content: '' }, CSK);
const publish = (w, e) => new Promise((res) => {
  const on = (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH') { w.send(JSON.stringify(['AUTH', authEvt(m[1])])); w.send(JSON.stringify(['EVENT', e])); return; }
    if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); }
  };
  w.on('message', on);
  w.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { w.off('message', on); res([false, 'timed out']); }, 12000);
});
// Read the room's current document back — the newest copy the church signed.
const fetchGroup = (w, id) => new Promise((res) => {
  const sid = 'g' + Math.random().toString(36).slice(2, 8);
  let best = null, authed = false;
  const req = () => w.send(JSON.stringify(['REQ', sid, { kinds: [30078], authors: [CP], '#d': [GROUP_D + id] }]));
  const on = (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH' && !authed) { authed = true; w.send(JSON.stringify(['AUTH', authEvt(m[1])])); setTimeout(req, 300); return; }
    if (m[0] === 'EVENT' && m[1] === sid) { if (!best || m[2].created_at > best.created_at) best = m[2]; return; }
    if (m[0] === 'EOSE' && m[1] === sid) { w.off('message', on); w.send(JSON.stringify(['CLOSE', sid])); res(best); }
  };
  w.on('message', on);
  req();
  setTimeout(() => { w.off('message', on); res(best); }, 8000);
});

const w = await conn();
const results = [];
for (const [id, idx] of Object.entries(ROOMS)) {
  const prev = await fetchGroup(w, id);
  if (!prev || !prev.content) { results.push([id, false, 'no such room on the relay — run seed-church.mjs first']); process.stdout.write('x'); continue; }
  const g = JSON.parse(prev.content);
  const members = [...new Set(idx.map(i => people[i].pub))];
  // publishGroup's content, field for field (src/steward.src.js). JSON.stringify drops the undefined ones, as
  // it does there.
  const content = JSON.stringify({
    name: g.name || 'Group', kind: g.kind || 'group', sub: g.sub || '', icon: g.icon || '', accent: g.accent || '',
    leaders: Array.isArray(g.leaders) ? g.leaders : [], order: typeof g.order === 'number' ? g.order : undefined,
    category: g.category || undefined, visibility: 'invite', members,
    encrypted: g.encrypted ? true : undefined, childsafe: g.childsafe ? true : undefined,
    eventPolicy: g.eventPolicy || undefined,
  });
  // A replaceable document only replaces an OLDER one: never sign in the same second as the copy just read.
  const evt = finalizeEvent({ kind: 30078, created_at: Math.max(now(), prev.created_at + 1), tags: [['d', GROUP_D + id], ['t', NET]], content }, CSK);
  const [ok, why] = await publish(w, evt);
  results.push([id, ok, ok ? `${g.name}: ${members.length} members, invite-only` : why]);
  process.stdout.write(ok ? '.' : 'x');
}
w.close();

console.log('\n');
for (const [id, ok, what] of results) console.log(`${ok ? '  ' : '✗ '}${id.padEnd(14)} ${what}`);
const bad = results.filter(r => !r[1]);
console.log(`\npublished : ${results.length - bad.length}/${results.length}`);
if (bad.length) process.exit(1);
