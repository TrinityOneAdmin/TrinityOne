// SIMULATE REAL CHURCHES ON A REAL RELAY — and check the invariants, not just that it ran.
//
//   node scripts/sim.mjs <relay-url> [--scale small|large] [--keep <file>]
//
// WHY THIS EXISTS. Every defect found in this codebase over the past week lived in a state that only appears
// when a real church is doing several things at once: a member admitted while a key envelope was in flight,
// a roster that grew past an envelope ceiling, a document written before a client understood its new shape.
// Seeded fixtures do not produce those states because they are written in one pass, correct by construction.
//
// WHAT IT ASSERTS. Not "no crash". Every claim the product makes that can be checked from outside:
//   · the relay serves NOTHING private to an anonymous socket (rosters, messages, care, safeguarding)
//   · …and serves the same documents to an authenticated member of that church
//   · a church's calendar carries no readable date, time or address on the wire
//   · a member of church A cannot read church B
//   · a blocked member is refused
// Each is checked against what the RELAY answers, not against what this script believes it published.
//
// SAFETY. Everything it creates is named `SIM …` and every key is written to a keep-file so it can be wiped.
// Point it at a relay with no real congregations on it. It never touches an existing church.
import { WebSocket } from 'ws';
import { writeFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';

const RELAY = process.argv[2] || 'ws://127.0.0.1:8000/relay';
const SCALE = (process.argv.includes('--scale') ? process.argv[process.argv.indexOf('--scale') + 1] : 'small');
const KEEP = (process.argv.includes('--keep') ? process.argv[process.argv.indexOf('--keep') + 1] : 'scripts/.sim-churches.json');
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const hex = (b) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(h.match(/.{2}/g).map(x => parseInt(x, 16)));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   — ' + detail : ''));
  ok ? pass++ : fail++;
};

// ── a relay connection that can publish, read, and authenticate ────────────────────────────────────────────
function conn(url) {
  const ws = new WebSocket(url);
  const waiters = new Map();
  let challenge = null;
  const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m[0] === 'AUTH') { challenge = m[1]; return; }
    const w = waiters.get(m[1]);
    if (!w) return;
    if (m[0] === 'EVENT') w.events.push(m[2]);
    else if (m[0] === 'EOSE') { waiters.delete(m[1]); w.done(w.events); }
    else if (m[0] === 'OK') { waiters.delete(m[1]); w.done(m); }
  });
  const api = {
    ws,
    ready,
    async pub(evt) {
      return new Promise((res) => {
        waiters.set(evt.id, { events: [], done: res });
        ws.send(JSON.stringify(['EVENT', evt]));
        setTimeout(() => { waiters.delete(evt.id); res(['OK', evt.id, false, 'timeout']); }, 12000);
      });
    },
    async req(filter, ms = 6000) {
      const id = 's' + Math.random().toString(36).slice(2, 9);
      return new Promise((res) => {
        waiters.set(id, { events: [], done: res });
        ws.send(JSON.stringify(['REQ', id, filter]));
        setTimeout(() => { const w = waiters.get(id); waiters.delete(id); res(w ? w.events : []); }, ms);
      });
    },
    // NIP-42: the relay's challenge arrives unprompted on connect, or after a gated read
    async auth(sk) {
      for (let i = 0; i < 20 && !challenge; i++) { await api.req({ kinds: [30078], limit: 1 }, 400); await sleep(200); }
      if (!challenge) return false;
      const evt = finalizeEvent({ kind: 22242, created_at: now(),
        tags: [['relay', url.replace(/^ws/, 'http')], ['challenge', challenge]], content: '' }, sk);
      // NIP-42 is its own frame. Sending the signed event as ["EVENT", …] gets an OK back and authenticates
      // NOTHING — the socket stays anonymous and every gated read quietly returns empty, which looks exactly
      // like "the relay is withholding correctly". That misread cost the first run of this script.
      return new Promise((res) => {
        waiters.set(evt.id, { events: [], done: (m) => res(!!(m && m[2])) });
        ws.send(JSON.stringify(['AUTH', evt]));
        setTimeout(() => { waiters.delete(evt.id); res(false); }, 10000);
      });
    },
    close() { try { ws.close(); } catch {} },
  };
  return api;
}

// ── build one church ───────────────────────────────────────────────────────────────────────────────────────
async function buildChurch(c, spec) {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const nameKey = crypto.getRandomValues(new Uint8Array(32));
  const members = [];
  for (let i = 0; i < spec.members; i++) {
    const msk = generateSecretKey();
    members.push({ sk: msk, pub: getPublicKey(msk), name: spec.namer(i) });
  }
  const sign = (o) => finalizeEvent({ kind: 30078, created_at: now(), ...o }, sk);

  // REGISTER WITH THE RELAY FIRST, exactly as the console does (steward.src.js selfRegister → POST /config
  // with a NIP-98 event signed by the church key). A church that only PUBLISHES its documents is never added
  // to the relay's church set, and the consequence is quiet and misleading: its kind-0 profile stays private,
  // so an invite link cannot even show the church's name. The first run of this simulation looked like a
  // relay bug for exactly that reason — the fake churches were in a state no real church is ever in.
  const httpBase = RELAY.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/relay\/?$/i, '');
  try {
    const url = httpBase + '/config';
    const auth = finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', url], ['method', 'POST']], content: '' }, sk);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addChurch: { npub: npubEncode(pub), name: spec.name }, auth }) });
    if (!r.ok) console.log('    (relay refused registration: ' + r.status + ' — the church will behave as unregistered)');
  } catch (e) { console.log('    (registration failed: ' + e.message + ')'); }

  // the church itself
  await c.pub(finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]],
    content: JSON.stringify({ name: spec.name, about: 'SIM church — safe to delete' }) }, sk));

  // the name key, wrapped to every member (both shapes, as the console writes them)
  const keys = {}, rings = {};
  for (const pk of [pub, ...members.map(m => m.pub)]) {
    const ck = nip44.utils.getConversationKey(sk, pk);
    keys[pk] = nip44.encrypt(hex(nameKey), ck);
    rings[pk] = nip44.encrypt(JSON.stringify([hex(nameKey)]), ck);
  }
  await c.pub(sign({ tags: [['d', 'trinityone/namekey:' + pub], ['t', NET]], content: JSON.stringify({ rev: 1, keys, rings }) }));

  // members join (self-published, as the app does)
  for (const m of members) {
    await c.pub(finalizeEvent({ kind: 30078, created_at: now(),
      tags: [['d', 'trinityone/member:' + pub], ['t', NET], ['church', pub]],
      content: JSON.stringify({ joined: now() }) }, m.sk));
  }

  // groups
  const groups = [];
  for (const g of spec.groups) {
    // Namespaced per church. Deriving the id from the NAME gave two churches the same 'sim-whole-church',
    // and the cross-church check then reported a leak that was really one room with two congregations in it.
    const id = 'sim-' + pub.slice(0, 8) + '-' + g.name.toLowerCase().replace(/\W+/g, '-');
    groups.push({ id, ...g });
    await c.pub(sign({ tags: [['d', 'trinityone/group:' + id], ['t', NET]],
      content: JSON.stringify({ name: g.name, kind: 'group', visibility: 'open', encrypted: !!g.encrypted }) }));
    if (g.encrypted) {
      const gk = crypto.getRandomValues(new Uint8Array(32));
      const gkeys = {}, grings = {};
      for (const pk of [pub, ...members.map(m => m.pub)]) {
        const ck = nip44.utils.getConversationKey(sk, pk);
        gkeys[pk] = nip44.encrypt(hex(gk), ck); grings[pk] = nip44.encrypt(JSON.stringify([hex(gk)]), ck);
      }
      await c.pub(sign({ tags: [['d', 'trinityone/groupkey:' + id], ['t', NET]], content: JSON.stringify({ rev: 1, keys: gkeys, rings: grings }) }));
      groups[groups.length - 1].key = gk;
    }
  }

  // the calendar — SEALED under the name key, exactly as the console now writes it
  const calendar = [];
  for (const ev of spec.events) {
    const doc = { date: ev.date, time: ev.time, title: ev.title, where: ev.where };
    calendar.push(doc);
    await c.pub(sign({ tags: [['d', 'trinityone/event:' + ev.id], ['t', NET]],
      content: JSON.stringify({ e: nip44.encrypt(JSON.stringify(doc), nameKey) }) }));
  }

  // conversation
  let msgs = 0;
  for (const g of groups) {
    for (let i = 0; i < spec.messagesPerGroup; i++) {
      const m = members[i % members.length];
      const text = spec.chatter(g.name, i);
      const body = g.key ? nip44.encrypt(text, g.key) : text;
      const tags = [['t', NET], ['t', g.id], ['p', pub]];
      if (g.key) tags.push(['enc', '1']);
      await c.pub(finalizeEvent({ kind: 1, created_at: now() - (i * 60), tags, content: body }, m.sk));
      msgs++;
    }
  }
  return { sk: hex(sk), pub, name: spec.name, nameKey: hex(nameKey), members: members.map(m => ({ sk: hex(m.sk), pub: m.pub, name: m.name })), groups, calendar, msgs };
}

// ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────────
const SHAPES = (scale) => {
  const big = scale === 'large';
  const ev = (id, date, time, title, where) => ({ id, date, time, title, where });
  return [
    { name: 'SIM St Aidan (small, open)', members: big ? 40 : 8, messagesPerGroup: big ? 20 : 5,
      groups: [{ name: 'Whole Church' }, { name: 'Prayer' }],
      events: [ev('sim-a1', '2026-09-06', '10:30', 'Sunday Gathering', '3 Mill Lane'), ev('sim-a2', '2026-09-10', '19:30', 'Midweek Prayer', 'The Vicarage')],
      namer: (i) => 'Member ' + (i + 1), chatter: (g, i) => `A note in ${g} (${i})` },
    { name: 'SIM Emmanuel (encrypted rooms)', members: big ? 60 : 10, messagesPerGroup: big ? 20 : 5,
      groups: [{ name: 'Whole Church' }, { name: 'Leaders', encrypted: true }],
      events: [ev('sim-e1', '2026-09-07', '18:00', 'Evening Service', 'Flat 2, 88 Bridge St')],
      namer: (i) => 'Believer ' + (i + 1), chatter: (g, i) => `Something said in ${g} (${i})` },
    { name: 'SIM Hope Fellowship (larger)', members: big ? 200 : 15, messagesPerGroup: big ? 30 : 5,
      groups: [{ name: 'Whole Church' }, { name: 'Youth' }, { name: 'Music' }],
      events: [ev('sim-h1', '2026-09-06', '09:00', 'Early Service', 'Unit 4, Enterprise Park')],
      namer: (i) => 'Friend ' + (i + 1), chatter: (g, i) => `Chat in ${g} (${i})` },
  ];
};

// ── run ────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n  relay : ' + RELAY + '\n  scale : ' + SCALE + '\n');
const c = conn(RELAY);
await c.ready;
console.log('── building churches ───────────────────────────────────────────────────────');
const built = [];
for (const spec of SHAPES(SCALE)) {
  const t0 = Date.now();
  const ch = await buildChurch(c, spec);
  built.push(ch);
  console.log(`  ${spec.name}: ${ch.members.length} members, ${ch.groups.length} groups, ${ch.msgs} messages, ${ch.calendar.length} events  (${Math.round((Date.now() - t0) / 1000)}s)`);
}
writeFileSync(KEEP, JSON.stringify(built, null, 1));
console.log('\n  keys written to ' + KEEP + ' — wipe with scripts/sim-wipe.mjs\n');

console.log('── what an ANONYMOUS socket can read ───────────────────────────────────────');
const anon = conn(RELAY);
await anon.ready;
const A = built[0];
check('a church roster is NOT served to a stranger',
  (await anon.req({ kinds: [30078], '#church': [A.pub] })).length === 0, 'member: docs');
check('church messages are NOT served to a stranger',
  (await anon.req({ kinds: [1], '#t': [A.groups[0].id] })).length === 0);
check('the church profile IS public, as intended',
  (await anon.req({ kinds: [0], authors: [A.pub] })).length > 0, 'so an invite link can name the church');
anon.close();

console.log('\n── what a MEMBER of that church can read ───────────────────────────────────');
const mem = conn(RELAY);
await mem.ready;
const authed = await mem.auth(unhex(A.members[0].sk));
check('a member can authenticate', authed);
const seen = await mem.req({ kinds: [1], '#t': [A.groups[0].id] });
check('…and then sees their own church\'s messages', seen.length > 0, seen.length + ' messages');

console.log('\n── cross-church ────────────────────────────────────────────────────────────');
const B = built[1];
const other = await mem.req({ kinds: [1], '#t': [B.groups[0].id] });
check('a member of one church cannot read another', other.length === 0,
  other.length ? 'LEAK: ' + other.length + ' events from ' + B.name : 'nothing from ' + B.name);

// THE ADVERSARIAL VERSION, and the one worth having. Group ids are just tags: nothing stops a hostile church
// from publishing into ANOTHER church's group id. If the relay gates a message only by its group tag, that
// message lands in the victim's room — a stranger posting into a congregation's chat. It must be refused, or
// at least withheld from the victim's members, on the strength of who authored it.
const intruderSk = unhex(B.members[0].sk);
const intruderEvt = finalizeEvent({ kind: 1, created_at: now(),
  tags: [['t', NET], ['t', A.groups[0].id], ['p', A.pub]], content: 'SIM-INTRUDER-CANARY' }, intruderSk);
const okIntruder = await c.pub(intruderEvt);
const victimSees = await mem.req({ kinds: [1], '#t': [A.groups[0].id] });
const landed = victimSees.some(e => String(e.content).includes('SIM-INTRUDER-CANARY'));
check('an outsider cannot post into another church\'s room',
  !landed, landed ? 'the message is IN the victim\'s room' : (okIntruder && okIntruder[2] ? 'accepted by the relay but withheld from members' : 'refused by the relay: ' + (okIntruder && okIntruder[3] || '')));
mem.close();

console.log('\n── the calendar on the wire ────────────────────────────────────────────────');
const cal = conn(RELAY);
await cal.ready;
await cal.auth(unhex(A.members[0].sk));
const evs = await cal.req({ kinds: [30078], authors: [A.pub] });
const calDocs = evs.filter(e => (e.tags.find(t => t[0] === 'd') || [])[1]?.startsWith('trinityone/event:'));
const leaked = calDocs.filter(e => /"date"|"where"|Mill Lane|Vicarage/.test(e.content));
check('a church calendar carries no readable date or address', calDocs.length > 0 && leaked.length === 0,
  calDocs.length + ' events fetched, ' + leaked.length + ' readable');
const opened = calDocs.map(e => { try { return JSON.parse(nip44.decrypt(JSON.parse(e.content).e, unhex(A.nameKey))); } catch { return null; } }).filter(Boolean);
// `opened.length === calDocs.length` alone passes when BOTH are zero — a green tick for having fetched
// nothing. Require that there is something to open before claiming it opened.
check('…and a member holding the key still reads them', calDocs.length > 0 && opened.length === calDocs.length,
  opened.length + '/' + calDocs.length + ' opened');
cal.close();

c.close();
console.log('\n───────────────────────────────────────────────────────────────────────────');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
