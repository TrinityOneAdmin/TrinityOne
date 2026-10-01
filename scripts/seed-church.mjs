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
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';

const RELAY = process.argv[2] || 'wss://app.trinityone.church/relay';
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const KEYFILE = new URL('./.seed-church.json', import.meta.url);

// ── the church ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ MINTED FROM TWELVE WORDS (nip06), the same derivation the console's setKey() uses, so the seeded church can
// be OPENED in the steward console — `Steward.init(words)` — and photographed there. A raw hex key cannot be:
// the console only ever holds a church as a phrase. That was done by hand on 2026-09-15 for the first console
// shot (commit bea47b9) and is done here now so the shot can be taken again. A key file written before this
// change has no `words` and is still re-used as it is; it just cannot be opened in a console.
let church;
if (existsSync(KEYFILE)) {
  church = JSON.parse(readFileSync(KEYFILE, 'utf8'));
  console.log('re-using the church in scripts/.seed-church.json');
} else {
  const words = generateSeedWords();
  const sk = privateKeyFromSeedWords(words);
  church = { sk: Buffer.from(sk).toString('hex'), pub: getPublicKey(sk), words };
  church.npub = npubEncode(church.pub);
  writeFileSync(KEYFILE, JSON.stringify(church, null, 1));
  console.log('minted a new church key, from twelve words (kept in scripts/.seed-church.json)');
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

// kind: 'broadcast' | 'group' — a broadcast is the church's own voice (only the church or a steward posts,
// everyone reads); a group is a conversation. Those are the kinds the console writes and every reader knows.
// ⚠ NOTICES WAS kind:'channel' UNTIL 2026-10-01, a kind nothing in the product reads. So it was an ordinary
// open chat: any member could post in it, the console listed it as "120 members" like every other room, the
// relay never treated it as a broadcast (scripts/gateway.mjs adds a room to BROADCAST only for 'broadcast'),
// and nothing the church said there counted as an announcement. scripts/seed-chat.mjs now signs its notices
// with the church key, as the console's publishPost does — a member's post into a broadcast is refused.
//
// Every room here starts OPEN. scripts/seed-small-groups.mjs then gives the small ones their own member lists,
// as a church does — it needs the people from seed-members.mjs, which do not exist yet when this runs.
const GROUPS = [
  { id: 'notices',    name: 'Church notices',      kind: 'broadcast', sub: 'From the church office',      order: 0 },
  { id: 'prayer',     name: 'Prayer requests',     kind: 'group',   sub: 'Pray for one another',          order: 1 },
  { id: 'tuesday',    name: 'Tuesday morning group', kind: 'group', sub: 'Meets at Margaret’s, 10am',     order: 2 },
  { id: 'stm-youth',      name: 'Youth (school years 7–11)', kind: 'group', sub: 'Fridays, 7pm, the hall',    order: 3 },
  { id: 'welcome',    name: 'Welcome team',        kind: 'group',   sub: 'Sunday door duty',              order: 4 },
  { id: 'musicians',  name: 'Musicians',           kind: 'group',   sub: 'Rehearsal chat',                order: 5 },
  // The diary below already had a Wednesday life group with nowhere for its people to talk. ('stm-', like
  // 'stm-youth': a common bare id may already be claimed by another church on a shared relay, and the relay
  // rightly refuses a second church taking it — the detour recorded in commit bea47b9.)
  { id: 'stm-wednesday', name: 'Wednesday life group', kind: 'group', sub: 'Wednesdays, 7.30pm, in a front room', order: 6 },
];

// A term's worth of a real parish diary. Dates are generated relative to today so the calendar is never empty.
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };
// ⚠ A CHURCH DIARY LANDS ON REAL WEEKDAYS. `day(n)` is a fixed offset from whenever the seed is run, so the
// screenshots showed "Morning worship" on a Thursday and a "Tuesday morning group" on a Saturday — the kind
// of small wrongness any churchgoer spots instantly and nobody can un-see. `on(wd, weeks)` returns the NEXT
// given weekday (0 = Sunday), optionally some weeks further out, so the diary reads correctly whatever day
// the seed happens to be run. Added 2026-09-15 after the owner asked for a Friday youth group and a
// Wednesday life group and the existing rows turned out to be on arbitrary days.
const on = (wd, weeks = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7 || 7) + weeks * 7);
  return d.toISOString().slice(0, 10);
};
const SUN = 0, TUE = 2, WED = 3, FRI = 5, SAT = 6;
const EVENTS = [
  { id: 'ev-sun',    date: on(SUN),  time: '10:00', title: 'Morning worship',        where: 'Church',            blurb: 'All welcome. Refreshments afterwards in the hall.' },
  { id: 'ev-tue',    date: on(TUE),  time: '10:00', title: 'Tuesday morning group',  where: '14 Elm Row',        blurb: 'Coffee, Bible and a chat. Anyone welcome — no need to book.', groupId: 'tuesday' },
  // ⚠ THESE DATES ARE REAL WEEKDAYS, not arbitrary offsets. day(n) counts from today, so day(3) and
  // day(8) are the Friday and the Wednesday — a screenshot that says "Friday youth group" under a
  // Tuesday date is the kind of small wrongness a church notices immediately. Recheck if `day` moves.
  { id: 'ev-fri',    date: on(FRI),  time: '19:30', title: 'Friday youth group',     where: 'The hall',          blurb: 'Games, food and a short talk. Years 7–11.', groupId: 'stm-youth' },
  { id: 'ev-wed',    date: on(WED),  time: '19:30', title: 'Wednesday life group',  where: '14 Elm Row',        blurb: 'Midweek Bible study and prayer, in someone’s front room. Everyone welcome.' },
  { id: 'ev-lunch',  date: on(SUN, 1),  time: '12:30', title: 'Bring-and-share lunch',  where: 'The hall',          blurb: 'Bring something to share if you can — there is always plenty.' },
  { id: 'ev-pcc',    date: on(TUE, 1), time: '19:30', title: 'PCC meeting',            where: 'The vestry',        blurb: 'Agenda circulated by email on Monday.' },
  { id: 'ev-baptism',date: on(SUN, 2), time: '10:00', title: 'Baptism service',        where: 'Church',            blurb: 'We welcome the Achebe family as Ada is baptised.' },
  { id: 'ev-quiet',  date: on(SAT, 3), time: '09:30', title: 'Quiet morning',          where: 'St Bede’s retreat', blurb: 'A slower morning of prayer and silence. Lifts available.' },
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
console.log('then: node scripts/seed-names.mjs ' + RELAY + ' && node scripts/seed-small-groups.mjs ' + RELAY + ' && node scripts/seed-chat.mjs ' + RELAY);
console.log('      (seed-small-groups BEFORE seed-chat: an invite-only room refuses a post from anyone not on its list)');
