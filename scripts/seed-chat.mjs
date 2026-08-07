// Fill the throwaway church's rooms with a week that reads like a real one.
//
//   node scripts/seed-chat.mjs [relay-url]
//
// Reads the church from scripts/.seed-church.json and the people from scripts/.seed-members.json, so it can
// only ever talk about the church this machine invented. Messages are signed by the MEMBERS, not the church —
// which is what makes a room look alive rather than broadcast.
//
// A chat message is a kind-1 carrying ['t', 'trinityone'], ['t', <groupId>] and ['p', <churchpub>] —
// the same shape src/fellowship.src.js sendMessage() writes.
//
// Timestamps are spread backwards over several days, because a room where forty messages share one second
// looks exactly like what it is.
import { existsSync, readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';

const RELAY = process.argv[2] || 'ws://127.0.0.1:8000/relay';
const NET = 'trinityone';
const CH = new URL('./.seed-church.json', import.meta.url);
const MB = new URL('./.seed-members.json', import.meta.url);
if (!existsSync(CH) || !existsSync(MB)) { console.error('run seed-church.mjs and seed-members.mjs first'); process.exit(2); }
const church = JSON.parse(readFileSync(CH, 'utf8'));
const people = JSON.parse(readFileSync(MB, 'utf8'));
const CP = church.pub;
const now = () => Math.floor(Date.now() / 1000);
const P = (n) => people[n % people.length];

// ── the week ──────────────────────────────────────────────────────────────────────────────────────────────
// `at` is hours ago. Written so each room reads in order and sounds like the people in it: notices is one
// voice, prayer is short and vulnerable, Tuesday group is chatty, welcome team is logistics.
const SCRIPT = [
  ['notices', 0, 96, 'Sunday’s service is at the usual 10am. Ada Achebe is being baptised, so the church will be busier than normal — do come early if you’d like a seat near the front.'],
  ['notices', 0, 70, 'The boiler engineer has been and gone. The hall is warm again. Thank you to everyone who put up with three cold weeks of coffee mornings.'],
  ['notices', 0, 44, 'Reminder: bring-and-share lunch a week on Sunday. Bring something if you can — there is always plenty, and nobody minds if you can’t.'],
  ['notices', 0, 18, 'The PCC papers went out by email this morning. If you’re on the PCC and haven’t had them, tell Margaret and she’ll re-send.'],

  ['prayer', 3, 92, 'Please pray for my mum. She goes in for the scan on Thursday and she’s trying very hard not to worry about it.'],
  ['prayer', 7, 90, 'Praying, Grace. Let us know how Thursday goes.'],
  ['prayer', 11, 66, 'Would value prayer for work — the redundancy consultation started on Monday and it’s a horrible atmosphere in the office.'],
  ['prayer', 4, 64, 'Thinking of you. That’s a hard thing to sit in every day.'],
  ['prayer', 19, 40, 'Thank you for the prayers last week. The results came back clear. I cried in the car park.'],
  ['prayer', 2, 38, 'Oh that’s wonderful news. Thank you for telling us.'],
  ['prayer', 25, 36, 'Praise God. So glad.'],
  ['prayer', 13, 12, 'Please pray for our neighbours — their little boy is in hospital again and they’re exhausted.'],

  ['tuesday', 0, 88, 'Morning all — we’re on Luke 15 tomorrow, the lost sheep. No prep needed, just bring yourself.'],
  ['tuesday', 5, 86, 'I’ll bring the flapjack. Someone else do the coffee, mine was universally disliked last time.'],
  ['tuesday', 9, 85, 'It was not that bad.'],
  ['tuesday', 5, 84, 'Ruth. It was.'],
  ['tuesday', 14, 62, 'Can I bring my sister? She’s staying the week and doesn’t know anyone here yet.'],
  ['tuesday', 0, 60, 'Of course — bring her. There’s always room and always cake.'],
  ['tuesday', 21, 20, 'Running ten minutes late, save me a chair.'],

  ['welcome', 6, 80, 'Rota for Sunday: Peter and Naomi on the door, Michael on coffee. Shout if that doesn’t work and we’ll swap.'],
  ['welcome', 12, 78, 'That’s fine for me. I’ll get there for 9:30 to put the urn on.'],
  ['welcome', 16, 54, 'We’re low on the little welcome cards — I’ll print more before Sunday.'],
  ['welcome', 6, 30, 'Baptism this week so expect visitors who’ve never been before. Be generous with directions to the loos — it genuinely helps.'],

  ['musicians', 8, 76, 'Set for Sunday: In Christ Alone, Be Thou My Vision, and the new one we tried last month. Key of D for the last one, it sat too high before.'],
  ['musicians', 17, 74, 'Thank you — my voice will be glad of that.'],
  ['musicians', 22, 50, 'Rehearsal Thursday 7pm as usual? I can’t do 6:30 this week.'],
  ['musicians', 8, 48, '7pm is fine. See you all Thursday.'],

  ['stm-youth', 10, 58, 'Friday is games night and we’re doing the toastie machine again. Bring a friend if you want to.'],
  ['stm-youth', 24, 56, 'Is it the good bread this time'],
  ['stm-youth', 10, 55, 'It is the good bread.'],
];

const conn = () => new Promise((res, rej) => { const w = new WebSocket(RELAY); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, e, sk) => new Promise((res) => {
  const on = (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH' && sk) {
      w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', RELAY], ['challenge', m[1]]], content: '' }, sk)]));
      w.send(JSON.stringify(['EVENT', e]));
      return;
    }
    if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); }
  };
  w.on('message', on);
  w.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { w.off('message', on); res([false, 'timed out']); }, 12000);
});

const w = await conn();
let ok = 0; const bad = [];
for (const [groupId, who, hoursAgo, text] of SCRIPT) {
  const p = P(who);
  const sk = Uint8Array.from(Buffer.from(p.sk, 'hex'));
  const evt = finalizeEvent({
    kind: 1,
    created_at: now() - Math.round(hoursAgo * 3600),
    // ['p', churchPub] — NOT ['church', …]. subscribeGroup() drops any message whose tags lack a `p` tag
    // matching the active church, so a 'church' tag publishes fine and then renders as "No messages yet".
    // Matches sendMessage() in src/fellowship.src.js.
    tags: [['t', NET], ['t', groupId], ['p', CP]],
    content: text,
  }, sk);
  const [good, why] = await publish(w, evt, sk);
  if (good) ok++; else bad.push(`${groupId} / ${p.name}: ${why}`);
  process.stdout.write(good ? '.' : 'x');
}
w.close();
console.log('\n');
console.log(`posted : ${ok}/${SCRIPT.length}`);
if (bad.length) { console.log('refused:'); bad.forEach(b => console.log('  ' + b)); }
