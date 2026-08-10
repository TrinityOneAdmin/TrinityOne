// Create a THROWAWAY church with a full week of life in it, for screenshots.
//
//   node scripts/seed-church.mjs [relay-url]
//
// Writes scripts/.seed-church.json (gitignored) with the church key, so the same church can be topped up,
// re-used, or handed to the console. Delete that file and the church becomes unrecoverable — which is the
// point: this is disposable data, not a real congregation.
//
// WHY A SCRIPT AND NOT THE CONSOLE. A hundred and twenty people cannot be typed in. Everything below uses the
// exact document shapes src/steward.src.js publishes — church kind-0, trinityone/group:<id>,
// trinityone/event:<id> — because a screenshot of a church the app cannot actually read is worth nothing.
//
// NEVER point this at a real church. It publishes as the church key it generates, and nothing else.
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const RELAY = process.argv[2] || 'wss://app.trinityone.church/relay';
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const KEYFILE = new URL('./.seed-church.json', import.meta.url);

// ── the church ────────────────────────────────────────────────────────────────────────────────────────────
let church;
if (existsSync(KEYFILE)) {
  church = JSON.parse(readFileSync(KEYFILE, 'utf8'));
  console.log('re-using the church in scripts/.seed-church.json');
} else {
  const sk = generateSecretKey();
  church = { sk: Buffer.from(sk).toString('hex'), pub: getPublicKey(sk) };
  church.npub = npubEncode(church.pub);
  writeFileSync(KEYFILE, JSON.stringify(church, null, 1));
  console.log('minted a new church key');
}
const CSK = Uint8Array.from(Buffer.from(church.sk, 'hex'));
const CP = church.pub;

const conn = () => new Promise((res, rej) => {
  const w = new WebSocket(RELAY);
  w.on('open', () => res(w));
  w.on('error', rej);
});

// Publish and WAIT for the verdict — a fire-and-forget seeder reports a church it never actually created.
const publish = (w, e, sk) => new Promise((res) => {
  const on = (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH' && sk) {
      w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
        tags: [['relay', RELAY], ['challenge', m[1]]], content: '' }, sk)]));
      w.send(JSON.stringify(['EVENT', e]));
      return;
    }
    if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); }
  };
  w.on('message', on);
  w.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { w.off('message', on); res([false, 'timed out']); }, 12000);
});

const churchDoc = (d, content, extra = []) => finalizeEvent({
  kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content),
}, CSK);

// ── what the church looks like ────────────────────────────────────────────────────────────────────────────
const PROFILE = {
  name: 'St Mary the Virgin, Fenwick',
  about: 'A parish church on the edge of town — morning worship, midweek groups, and a lot of tea.',
  nip05: '', picture: '', banner: '', bannerFade: 16, accent: '', channel: '', audioFeed: '',
  lud16: '', giving: false,
  features: { groups: true, serving: true, events: true, care: true, library: true, finance: false },
  rules: {},
};

// kind: 'group' | 'channel' — channels are announcement-style, groups are conversations.
const GROUPS = [
  { id: 'notices',    name: 'Church notices',      kind: 'channel', sub: 'From the church office',        order: 0 },
  { id: 'prayer',     name: 'Prayer requests',     kind: 'group',   sub: 'Pray for one another',          order: 1 },
  { id: 'tuesday',    name: 'Tuesday morning group', kind: 'group', sub: 'Meets at Margaret’s, 10am',     order: 2 },
  { id: 'stm-youth',      name: 'Youth (school years 7–11)', kind: 'group', sub: 'Fridays, 7pm, the hall',    order: 3 },
  { id: 'welcome',    name: 'Welcome team',        kind: 'group',   sub: 'Sunday door duty',              order: 4 },
  { id: 'musicians',  name: 'Musicians',           kind: 'group',   sub: 'Rehearsal chat',                order: 5 },
];

// A term's worth of a real parish diary. Dates are generated relative to today so the calendar is never empty.
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };
const EVENTS = [
  { id: 'ev-sun',    date: day(2),  time: '10:00', title: 'Morning worship',        where: 'Church',            blurb: 'All welcome. Refreshments afterwards in the hall.' },
  { id: 'ev-tue',    date: day(4),  time: '10:00', title: 'Tuesday morning group',  where: '14 Elm Row',        blurb: 'Coffee, Bible and a chat. Anyone welcome — no need to book.', groupId: 'tuesday' },
  { id: 'ev-fri',    date: day(7),  time: '19:00', title: 'Youth night',            where: 'The hall',          blurb: 'Games, food and a short talk. Years 7–11.', groupId: 'stm-youth' },
  { id: 'ev-lunch',  date: day(9),  time: '12:30', title: 'Bring-and-share lunch',  where: 'The hall',          blurb: 'Bring something to share if you can — there is always plenty.' },
  { id: 'ev-pcc',    date: day(12), time: '19:30', title: 'PCC meeting',            where: 'The vestry',        blurb: 'Agenda circulated by email on Monday.' },
  { id: 'ev-baptism',date: day(16), time: '10:00', title: 'Baptism service',        where: 'Church',            blurb: 'We welcome the Achebe family as Ada is baptised.' },
  { id: 'ev-quiet',  date: day(23), time: '09:30', title: 'Quiet morning',          where: 'St Bede’s retreat', blurb: 'A slower morning of prayer and silence. Lifts available.' },
];

// ── go ────────────────────────────────────────────────────────────────────────────────────────────────────
const w = await conn();
const results = [];
const say = async (label, evt) => {
  const [ok, why] = await publish(w, evt, CSK);
  results.push([label, ok, why]);
  process.stdout.write(ok ? '.' : 'x');
};

await say('profile', finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify(PROFILE) }, CSK));
// Join policy OFF, so the 120 seeded members are admitted immediately rather than sitting as pending — a
// screenshot of a church with 120 people waiting for approval is not the picture we want.
await say('joinpolicy', churchDoc(NET + '/joinpolicy:' + CP, { approval: false }));
for (const g of GROUPS) {
  const { id, ...rest } = g;
  await say('group:' + id, churchDoc(NET + '/group:' + id, { ...rest, leaders: [], icon: '', accent: '' }));
}
for (const e of EVENTS) {
  const { id, ...rest } = e;
  await say('event:' + id, churchDoc(NET + '/event:' + id, {
    date: '', time: '', title: 'Event', where: '', blurb: '', accent: 'var(--clay)', image: '',
    groupId: '', recur: '', day: null, ...rest,
  }));
}
w.close();

const bad = results.filter(r => !r[1]);
console.log('\n');
console.log('church name : ' + PROFILE.name);
console.log('church npub : ' + church.npub);
console.log('church hex  : ' + CP);
console.log('relay       : ' + RELAY);
console.log(`published   : ${results.length - bad.length}/${results.length}`);
if (bad.length) { console.log('\nrefused:'); bad.forEach(([l, , why]) => console.log('  ' + l + ' — ' + why)); }
console.log('\nnext: node scripts/seed-members.mjs ' + church.npub + ' 120 ' + RELAY);
