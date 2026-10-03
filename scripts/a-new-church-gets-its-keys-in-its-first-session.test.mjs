// A BRAND-NEW CHURCH HAS ITS KEYS IN THE SESSION THAT CREATED IT — no reload, no tab opened first.
//   Run: node --test scripts/a-new-church-gets-its-keys-in-its-first-session.test.mjs
//
// THE DEFECT (measured 2026-10-02, main at d73d8fb; full timeline in the commits of this branch). A steward makes a
// church and sets it up straight away. In that first session the console had no working church keys, so a service
// and a rota were refused after their 4 s wait, a care need said "Still connecting to your church", and the wizard's
// rooms were made without their key — until a reload, or until the steward happened to open a tab. TWO causes, and
// each alone leaves the keys missing:
//   1. the relay never challenges a church with nothing private yet (NIP-42 is lazy), so the console never signs in
//      — fixed by the console asking (src/steward.src.js _loginSoon) and by the relay challenging a key read
//      (scripts/gateway.mjs wantsKeyD);
//   2. the dashboard's list streams (church name, members, groups, stewards, blocklist) were opened over the PROVED
//      relay set, which is empty at mount on a device that has never proved one — and nothing re-opened them when
//      the relay was admitted a moment later, so the key distributor (which will not mint without the church's
//      name) never ran. Fixed in src/steward.src.js (_noteRelaySet: a relay admitted after the streams opened is a
//      reason to re-subscribe).
//
// THE POINT OF USE (CLAUDE.md rule 1). A real gateway on a FREE port, the real console in headless chromium, a church
// made through the real screens and left on the Overview — then, with no reload and no tab opened, what a steward
// does next. Everything is read back from a raw logging subscriber signed in as the church, which sees every
// envelope that was ever written (the relay keeps only the newest copy of a replaceable document), and from a
// member's own client opening what it was sent. Rule 3: nothing here matches text in app/*.jsx.
//
// WHAT EACH ROW WOULD CATCH
//   · cause 2 undone (the set growing no longer says "re-subscribe")  → the console signs in but holds no keys: row 1 red;
//   · cause 1 undone BOTH ways (the console's question AND the relay's challenge removed together) → the console is
//     never challenged: row 1 red. (Either alone leaves the other doing the job — that is the point of having both;
//     the old-relay file proves the console's half alone, relay-challenges-a-key-read the relay's.)
//   · a second key generation minted over the first → the "same ring" row.
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nip44, finalizeEvent } from 'nostr-tools';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { CHROME, openNewChurch, memberOpensRota, sleep, H } from './new-church-session.mjs';

let s, ASK, tKeys = 0;
const M = H.key();
const NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:';
const until = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(200); } return pred(); };
const unhex = (h) => Uint8Array.from(String(h).match(/../g).map(b => parseInt(b, 16)));
// every ring a key envelope on the relay ever carried for us, newest last, from the raw logger's history
const generations = (prefix) => s.events.filter(e => e.d === prefix + s.churchPub && e.kind === 30078).map(e => {
  const env = JSON.parse(e.content), mine = env.keys && env.keys[s.churchPub];
  const ring = JSON.parse(nip44.v2.decrypt(mine, nip44.v2.utils.getConversationKey(ASK, e.author)));
  return { t: e.t, ring: Array.isArray(ring) ? ring : [ring], to: Object.keys(env.keys || {}) };
});

before(async () => {
  if (!CHROME) return;
  s = await openNewChurch({ wizard: 'skip', name: 'firstsession' });
  ASK = privateKeyFromSeedWords(s.mnemonic);
  // NO RELOAD, NO TAB: just wait for what a steward would be waiting for.
  await s.waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 30000, 'the console to hold its name and care keys on the Overview');
  tKeys = Date.now() - s.t0;
});
after(() => { try { s && s.close(); } catch {} });
const SKIP = !CHROME ? 'no chromium' : false;

test('on the Overview, with no tab opened and no reload, the console holds its name key and care key within seconds, and has read its own church\'s name', { skip: SKIP, timeout: 120000 }, async () => {
  assert.ok(tKeys - s.tChurch < 20000, 'the keys took ' + (tKeys - s.tChurch) + ' ms after the church key was made');
  assert.equal(await s.ev(`window.Steward.relayAuthed()`), true);
  // the dashboard's own streams are live: the church's name came back from the relay (it reads "Your Church" until it does)
  await s.waitFor(`/First Session Church/.test(document.body.innerText)`, 15000, 'the Overview to show the church\'s own name');
  const g = { name: generations(NAMEKEY_D), care: generations(CAREKEY_D) };
  assert.ok(g.name.length >= 1 && g.care.length >= 1, 'the relay never saw a name-key or care-key envelope for the church');
  assert.deepEqual(s.errors, [], 'the console threw:\n  ' + s.errors.join('\n  '));
});

let svcId = '';
test('a service, a rota naming a member and a care need all save at once, and the calendar documents are sealed on the relay', { skip: SKIP, timeout: 120000 }, async () => {
  const t0 = Date.now();
  const svc = await s.ev(`(async () => { const r = await window.Steward.publishService({ date: '2026-11-08', time: '10:30', name: 'Sunday Gathering' }); return r ? { id: r.id } : null; })()`);
  assert.ok(svc && svc.id, 'the service was refused in the first session (no name key)');
  svcId = svc.id;
  const rota = await s.ev(`(async () => { const r = await window.Steward.publishRota({ service: ${JSON.stringify(svc.id)}, published: true, assign: { 'team1::role1': { name: 'Member M', pub: ${JSON.stringify(M.pub)} } } }); return r ? { id: r.id } : null; })()`);
  assert.ok(rota && rota.id, 'the rota was refused in the first session (no name key)');
  const need = await s.ev(`(async () => { try { const r = await window.StewardMeals.publishNeed({ type: 'meals', dates: ['2026-11-10'], displayLabel: 'Mrs Thornton', notes: '12 Orchard Lane', recipient: '' }); return r && r.id ? { id: r.id } : { none: true }; } catch (e) { return { err: String(e.message || e) }; } })()`);
  assert.ok(need && need.id, 'the care need was refused in the first session: ' + JSON.stringify(need));
  assert.ok(Date.now() - t0 < 4000, 'three saves took ' + (Date.now() - t0) + ' ms — they waited for a key that should already be there');
  assert.ok(await until(() => s.events.some(e => e.d === 'trinityone/service:' + svc.id) && s.events.some(e => e.d === 'trinityone/rota:' + svc.id) && s.events.some(e => e.d.startsWith('trinityone/care:')), 10000), 'a document never reached the relay');
  for (const prefix of ['trinityone/service:', 'trinityone/rota:']) {
    const e = s.events.find(x => x.d === prefix + svc.id);
    assert.ok(e.sealed, prefix + ' reached the relay in the clear: ' + e.content.slice(0, 80));
    assert.ok(!/Sunday Gathering|Member M|team1/.test(e.content), prefix + ' carries a cleartext name');
  }
  const care = s.events.find(e => e.d.startsWith('trinityone/care:'));
  const body = JSON.parse(care.content);
  assert.ok(typeof body.enc === 'string' && body.enc.length > 20, 'the care need carries no sealed part');
  assert.ok(!/Thornton|Orchard/.test(care.content) && body.displayLabel === undefined && body.notes === undefined, 'the care need names the person in the clear');
});

test('a member who joins is keyed with the SAME ring (no second key is minted over the first) and opens the rota', { skip: SKIP, timeout: 120000 }, async () => {
  const ts = Math.floor(Date.now() / 1000);
  await H.publishAll(s.relay, [finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/member:' + s.churchPub], ['t', 'trinityone'], ['p', s.churchPub]], content: JSON.stringify({ joined: ts }) }, M.sk)]);
  // A new church asks its members to be approved (the wizard writes joinpolicy approval:true), and the relay serves a
  // member nothing until the steward has — the Approve tap, which writes this list.
  assert.ok(await s.ev(`(async () => !!(await window.Steward.setAdmitted([${JSON.stringify(M.pub)}])))()`), 'the console would not approve the member');
  assert.ok(await until(() => { const l = generations(NAMEKEY_D); return l.length && l[l.length - 1].to.includes(M.pub); }, 30000),
    'the member who joined was never wrapped into the name-key envelope: ' + JSON.stringify(generations(NAMEKEY_D).map(x => x.to.map(p => p.slice(0, 6)))));
  // THE SAME RING: every generation of the name key and of the care key the relay ever carried begins with the first one's head
  for (const [what, prefix] of [['name', NAMEKEY_D], ['care', CAREKEY_D]]) {
    const gens = generations(prefix);
    assert.ok(gens.every(x => x.ring[0] === gens[0].ring[0]), `a SECOND ${what} key was minted over the first — everything sealed under the first is now unreadable: ` + JSON.stringify(gens.map(x => x.ring.map(k => k.slice(0, 8)))));
  }
  const opened = await memberOpensRota(s.relay, M, s.churchPub, svcId);
  assert.deepEqual(opened, { gotEnvelope: true, gotRota: true, opened: true, assigned: true }, 'the member could not open the rota they are on: ' + JSON.stringify(opened));
});

test('an encrypted room made through the real New group dialog is flagged encrypted AND has its key envelope', { skip: SKIP, timeout: 120000 }, async () => {
  await s.press(/^Groups$/); await sleep(800);
  await s.press(/^New group$/); await sleep(500);
  await s.ev(`(() => { const i=document.querySelector('input[aria-label="Name"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, 'Leaders'); i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  const boxes = await s.ev(`[...document.querySelectorAll('[role=dialog] input[type=checkbox]')].map(i=>i.checked)`);
  assert.equal(boxes[boxes.length - 1], true, 'Encrypted is not ticked by default in a new church: ' + JSON.stringify(boxes));
  await s.press(/^Create group$/);
  assert.ok(await until(() => s.events.some(e => e.d.startsWith('trinityone/groupkey:')), 15000), 'no room-key envelope reached the relay');
  const g = s.events.filter(e => e.d.startsWith('trinityone/group:')).map(e => JSON.parse(e.content)).find(o => o.name === 'Leaders');
  assert.ok(g && g.encrypted === true, 'the room "Leaders" is not flagged encrypted: ' + JSON.stringify(g));
  const gk = s.events.find(e => e.d.startsWith('trinityone/groupkey:'));
  assert.ok(Object.keys(JSON.parse(gk.content).keys).includes(s.churchPub), 'the church is not a recipient of its own room key');
  assert.equal(await s.ev(`(window.__blocked || []).length`), 0);
});
