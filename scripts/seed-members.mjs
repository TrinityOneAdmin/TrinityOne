// Seed a church with dummy members, for testing things that need a congregation — care team, rotas,
// groups, safeguarding. Test data only; never point this at a real church.
//
//   node scripts/seed-members.mjs <church-npub-or-hex> [count] [relay-url]
//   node scripts/seed-members.mjs 41bbae… 12 wss://app.trinityone.church/relay
//
// Each dummy publishes two documents, in this order and for a reason:
//   1. member:<church>   — the join. The relay will not accept a name from someone it does not yet know
//                          is a member of that church, so the reverse order fails silently.
//   2. name:<church>     — their name, in the { c, m } shape a real client uses. `c` is sealed to the
//                          CHURCH key rather than the congregation key, which is the path a member
//                          awaiting approval takes: they have no congregation key yet (and must not —
//                          it would open the whole roster before they are admitted), so the steward
//                          console opens their name with its own key instead. `m` is their own recovery
//                          copy, sealed to themselves, exactly as the app writes it.
//
// Keys are written to scripts/.seed-members.json (gitignored) so the same people can be re-used, given
// more to say, or cleaned up later. Delete that file and they become unrecoverable strangers.
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { decode as nip19decode } from 'nostr-tools/nip19';
import { v2 as nip44v2 } from 'nostr-tools/nip44';

const [, , CHURCH_ARG, COUNT_ARG, RELAY_ARG] = process.argv;
if (!CHURCH_ARG) { console.error('usage: node scripts/seed-members.mjs <church-npub-or-hex> [count] [relay-url]'); process.exit(2); }

const COUNT = Math.max(1, Math.min(200, parseInt(COUNT_ARG || '10', 10)));   // 60 -> 200 for a congregation-sized seed (2026-08-07)
const RELAY = RELAY_ARG || 'wss://app.trinityone.church/relay';
const cp = /^[0-9a-f]{64}$/i.test(CHURCH_ARG) ? CHURCH_ARG.toLowerCase() : (() => {
  const d = nip19decode(CHURCH_ARG); if (d.type !== 'npub') throw new Error('not an npub'); return d.data;
})();

const now = () => Math.floor(Date.now() / 1000);
const KEYFILE = new URL('./.seed-members.json', import.meta.url);

// Ordinary names, deliberately — a roster of "Test User 4" tells you nothing about how the UI handles
// real ones (long names, accents, an apostrophe, a double-barrel, one person who set no name at all).
const NAMES = [
  'Margaret Whitfield', 'Tom Achebe', 'Priya Raghunathan', "Sean O'Donnell", 'Grace Adeyemi',
  'David Chen', 'Ruth Blackwood-Hayes', 'Samuel Okonkwo', 'Hannah Bright', 'Josef Nowak',
  'Aisha Rahman', 'Peter Vaughan', 'Naomi Fitzgerald', 'Michael Osei', 'Elena Petrova',
  'Jonathan Reid', 'Bea Lindqvist', 'Caleb Mwangi', 'Sarah Ellison', 'Andrzej Kowalczyk',
  'Eunice Mbeki', 'Harold Prentice', 'Fiona Gallagher', 'Ibrahim Sesay', 'Clara Nkemdirim',
  'Douglas Menzies', 'Rosa Iglesias', 'Nathan Whitcombe', 'Yewande Balogun', 'Alan Trethewey',
  'Miriam Katz', 'Oliver Sandford', 'Blessing Uche', 'Katarzyna Zielinska', 'Frank Ellery',
  'Deborah Ntuli', 'Stephen Pargeter', 'Amara Chukwu', 'Louise Hammond', 'Rafael Duarte',
  'Joy Abimbola', 'Malcolm Fairweather', 'Sunita Kapoor', 'Colin Barraclough', 'Esther Danquah',
  'Patrick Neary', 'Wendy Strachan', 'Emeka Nwosu', 'Marianne Lefevre', 'Gordon Aitken',
  'Chidinma Eze', 'Roger Pemberton', 'Anneke de Vries', 'Simon Braithwaite', 'Folake Ogunleye',
  'Vera Kowalski', 'Duncan Shaw', 'Rebekah Lyle', 'Anthony Marchetti', 'Grace Wanjiru',
  'Nigel Farrow', 'Beatrice Nyong', 'Callum Rennie', 'Sofia Marchetti', 'Kwame Boateng',
  'Judith Oyelaran', 'Barry Considine', 'Lydia Chukwuma', 'Ewan MacAllister', 'Adaeze Obi',
  'Trevor Sillitoe', 'Halima Yusuf', 'Gareth Pryce', 'Ingrid Halvorsen', 'Obinna Madu',
  'Pauline Rutherford', 'Ezra Kimani', 'Bernadette Quinn', 'Lars Andersen', 'Temitope Alabi',
  'Howard Beckwith', 'Nadia Haddad', 'Iain Cruickshank', 'Chiamaka Nnaji', 'Roy Stapleton',
  'Sylvia Mensah', 'Gerald Tomlinson', 'Anita Bergstrom', 'Femi Adekunle', 'Moira Baird',
  'Clive Hartnell', 'Zainab Bello', 'Neil Ferguson', 'Cecilia Oduya', 'Martin Rowbotham',
  'Precious Ademola', 'Alistair Cummins', 'Ngozi Anyanwu', 'Gwen Treloar', 'Bartek Wysocki',
  'Lorraine Fitzsimmons', 'Kofi Asante', 'Sheila Ashworth', 'Dominik Sobczak', 'Bisi Falana',
  'Raymond Doughty', 'Mercy Wairimu', 'Angus Kerr', 'Halina Mazur', 'Chinedu Okafor',
  'Barbara Ledbetter', 'Yusuf Adamu', 'Fern Caldwell', 'Piotr Lewandowski', 'Ifeoma Nzeribe',
  'Stuart Pennington', 'Abigail Ntim', 'Leonard Fairbrother', 'Nkechi Umeh', 'Vivien Sackville',
];

const conn = () => new Promise((res, rej) => {
  const w = new WebSocket(RELAY);
  w.on('open', () => res(w));
  w.on('error', rej);
});

// Publish and WAIT for the relay's verdict. Fire-and-forget would report success for events the relay
// refused, which is the failure mode this codebase specialises in.
const publish = (w, e, sk) => new Promise((res) => {
  const on = (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH' && sk) {
      w.send(JSON.stringify(['AUTH', finalizeEvent({
        kind: 22242, created_at: now(),
        tags: [['relay', RELAY], ['challenge', m[1]]], content: '',
      }, sk)]));
      w.send(JSON.stringify(['EVENT', e]));   // retry once authenticated
      return;
    }
    if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); }
  };
  w.on('message', on);
  w.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { w.off('message', on); res([false, 'timed out waiting for the relay']); }, 12000);
});

const sealedName = (sk, pub, name) => {
  const body = JSON.stringify({ name });
  return JSON.stringify({
    c: nip44v2.encrypt(body, nip44v2.utils.getConversationKey(sk, cp)),    // the church can open this
    m: nip44v2.encrypt(body, nip44v2.utils.getConversationKey(sk, pub)),   // only they can open this
  });
};

const existing = existsSync(KEYFILE) ? JSON.parse(readFileSync(KEYFILE, 'utf8')) : [];
const people = [];
for (let i = 0; i < COUNT; i++) {
  if (existing[i]) { people.push(existing[i]); continue; }
  const sk = generateSecretKey();
  people.push({ sk: Buffer.from(sk).toString('hex'), pub: getPublicKey(sk), name: NAMES[i % NAMES.length] + (i >= NAMES.length ? ' ' + (1 + Math.floor(i / NAMES.length)) : '') });
}
writeFileSync(KEYFILE, JSON.stringify(people, null, 1));

const w = await conn();
let joined = 0, named = 0;
const problems = [];
for (const p of people) {
  const sk = Uint8Array.from(Buffer.from(p.sk, 'hex'));
  const join = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['p', cp]],
    content: JSON.stringify({ joined: now() }) }, sk);
  const [okJoin, whyJoin] = await publish(w, join, sk);
  if (okJoin) joined++; else problems.push(`${p.name}: join refused — ${whyJoin}`);

  if (okJoin) {
    const nm = finalizeEvent({ kind: 30078, created_at: now(),
      tags: [['d', 'trinityone/name:' + cp], ['t', 'trinityone'], ['church', cp]],
      content: sealedName(sk, p.pub, p.name) }, sk);
    const [okName, whyName] = await publish(w, nm, sk);
    if (okName) named++; else problems.push(`${p.name}: name refused — ${whyName}`);
  }
  process.stdout.write('.');
}
w.close();

console.log('\n');
console.log(`church : ${cp.slice(0, 16)}…`);
console.log(`joined : ${joined}/${people.length}`);
console.log(`named  : ${named}/${people.length}`);
if (problems.length) { console.log('\nrefused:'); problems.forEach(p => console.log('  ' + p)); }
console.log(`\nkeys kept in scripts/.seed-members.json — re-run to reuse the same people.`);
console.log(`If the church gates joins, they will sit as pending until you approve them in the console.`);
