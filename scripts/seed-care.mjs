// Seed care needs on the throwaway church — meals, lifts, visits.
//
//   node scripts/seed-care.mjs [relay-url] [extra-pubkey-hex-to-key ...]
//
// Care needs are the one thing that cannot just be written as a document. Their PII is sealed field by field
// (SECURITY-AUDIT-2026-07-20 H3): `displayLabel`, `notes`, `recipient` and `dietary` are encrypted to the
// church's CARE KEY, while type/dates/meals stay clear so the slot grid, sort and live filter still work for a
// member who has not been keyed yet. So this has to mint the key ring first, or every need would land
// `_sealed` — the app would show "help needed on Tuesday" with a blank name, which is worse in a screenshot
// than nothing at all.
//
// The ring is a random 32 bytes, wrapped to each reader with nip44(churchSk, theirPub) and published as
// trinityone/carekey:<church>. Pass extra pubkeys to key a device that is not one of the seeded members —
// e.g. the phone you are photographing with, which has its own identity.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import { v2 as nip44v2 } from 'nostr-tools/nip44';

const args = process.argv.slice(2);
const RELAY = (args[0] && args[0].startsWith('ws')) ? args.shift() : 'ws://127.0.0.1:8000/relay';
const EXTRA = args.filter(a => /^[0-9a-f]{64}$/i.test(a)).map(a => a.toLowerCase());

const NET = 'trinityone';
const CH = new URL('./.seed-church.json', import.meta.url);
const MB = new URL('./.seed-members.json', import.meta.url);
const CAREFILE = new URL('./.seed-carekey.json', import.meta.url);
if (!existsSync(CH) || !existsSync(MB)) { console.error('run seed-church.mjs and seed-members.mjs first'); process.exit(2); }
const church = JSON.parse(readFileSync(CH, 'utf8'));
const people = JSON.parse(readFileSync(MB, 'utf8'));
const CP = church.pub;
const CSK = Uint8Array.from(Buffer.from(church.sk, 'hex'));
const now = () => Math.floor(Date.now() / 1000);
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

// Re-use the ring if one exists, so re-running does not orphan needs sealed by the last run.
let careKeyHex;
if (existsSync(CAREFILE)) { careKeyHex = JSON.parse(readFileSync(CAREFILE, 'utf8')).key; console.log('re-using the care key'); }
else { careKeyHex = hex(crypto.getRandomValues(new Uint8Array(32))); writeFileSync(CAREFILE, JSON.stringify({ key: careKeyHex }, null, 1)); console.log('minted a care key'); }
const RING = JSON.stringify([careKeyHex]);

const day = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };
const seal = (obj) => nip44v2.encrypt(JSON.stringify(obj), unhex(careKeyHex));

// A parish's actual care list: a new baby, someone home from hospital, a bereavement, lifts to chemo.
const NEEDS = [
  { id: 'care-achebe', type: 'meals', displayLabel: 'The Achebe family — new baby',
    dates: [day(1), day(2), day(3), day(5), day(7)], meals: ['dinner'],
    dietary: ['no nuts'], recipient: people[1].pub,
    notes: 'Ada arrived on Tuesday and everyone is well, just very tired. Leave it on the porch if nobody answers — the doorbell wakes the baby.' },

  { id: 'care-margaret', type: 'meals', displayLabel: 'Margaret — home from hospital',
    dates: [day(0), day(1), day(2), day(4)], meals: ['lunch', 'dinner'],
    dietary: ['soft food', 'low salt'], recipient: people[0].pub,
    notes: 'Back home after the hip operation and doing well. Small portions — she says everyone brings far too much. Best before 6pm.' },

  { id: 'care-lifts',   type: 'rides', displayLabel: 'Lifts to the Thursday clinic',
    dates: [day(3), day(10), day(17)], recipient: people[11].pub,
    notes: 'Appointment is at 2pm, about forty minutes each way. Happy to be dropped off and collected — no need to wait.' },

  { id: 'care-visits',  type: 'visits', displayLabel: 'Sitting with Harold',
    dates: [day(2), day(4), day(6), day(9)], recipient: people[21].pub,
    notes: 'An hour of company while Fiona gets out of the house. He likes the cricket on and does not mind if you read.' },

  { id: 'care-garden',  type: 'diy', displayLabel: 'Clearing the Prentice garden',
    dates: [day(6)], recipient: people[21].pub,
    notes: 'One Saturday morning to get on top of it before winter. Bring gloves; there are tools in the shed.' },
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

const w = await conn();
const results = [];

// 1. the ring, wrapped to every reader: the church itself, all seeded members, plus anything passed in.
const readers = [...new Set([CP, ...people.map(p => p.pub), ...EXTRA])];
const keys = {};
for (const rp of readers) {
  try { keys[rp] = nip44v2.encrypt(RING, nip44v2.utils.getConversationKey(CSK, rp)); } catch (e) {}
}
const keyDoc = finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', NET + '/carekey:' + CP], ['t', NET]], content: JSON.stringify({ keys, rev: 1 }) }, CSK);
const [okKey, whyKey] = await publish(w, keyDoc);
results.push(['carekey (' + readers.length + ' readers)', okKey, whyKey]);
process.stdout.write(okKey ? '.' : 'x');

// 2. the needs — clear fields in the open, PII sealed to the ring.
const SEALED = ['displayLabel', 'notes', 'recipient', 'dietary'];
for (const n of NEEDS) {
  const rec = {
    displayLabel: n.displayLabel || '', type: n.type, dates: n.dates,
    meals: n.type === 'meals' ? (n.meals || ['dinner']) : [], dayMeals: {},
    startDate: n.dates[0], endDate: n.dates[n.dates.length - 1],
    recipient: n.recipient || '', notes: n.notes || '', dietary: n.dietary || [],
  };
  const sealed = {}; for (const f of SEALED) sealed[f] = rec[f];
  const body = { ...rec, enc: seal(sealed) };
  for (const f of SEALED) delete body[f];            // never ship both halves
  const evt = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', NET + '/care:' + n.id], ['t', NET], ['enc', 'care1']], content: JSON.stringify(body) }, CSK);
  const [ok, why] = await publish(w, evt);
  results.push(['care:' + n.id, ok, why]);
  process.stdout.write(ok ? '.' : 'x');
}
w.close();

const bad = results.filter(r => !r[1]);
console.log('\n');
console.log(`published : ${results.length - bad.length}/${results.length}`);
console.log(`readers   : ${readers.length} (church + ${people.length} members${EXTRA.length ? ' + ' + EXTRA.length + ' extra' : ''})`);
if (bad.length) { console.log('\nrefused:'); bad.forEach(([l, , why]) => console.log('  ' + l + ' — ' + why)); }
if (!EXTRA.length) console.log('\nNB: the phone has its own identity. Re-run with its pubkey to let it open the sealed half:\n    node scripts/seed-care.mjs ' + RELAY + ' <phone-pubkey-hex>');
