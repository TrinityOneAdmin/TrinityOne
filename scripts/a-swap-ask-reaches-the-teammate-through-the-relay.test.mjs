// A SWAP ASK MUST ACTUALLY REACH THE TEAMMATE IT NAMES — THROUGH A REAL RELAY.
//   Run: node --test scripts/a-swap-ask-reaches-the-teammate-through-the-relay.test.mjs
//
// Sim 2026-10-02, item 25: the swap sheet promised "They'll get a friendly ask", and the reply went to the church
// alone — the person named never heard. Owner decision, same day: the MEMBER'S APP asks the named teammate
// directly, and the steward confirms with one tap.
//
// This proves the transport, end to end, with the SHIPPED engine functions lifted out of vendor/fellowship.js
// (the bundle phones load) and a REAL gateway over a REAL websocket. Nothing between the call and the wire is
// this file's own copy except the transport stub that puts the signed event on the socket and reports the
// relay's OK — a stub for the pipe, not for any decision:
//
//   asker   respondToServingRequest(..., 'swap', <teammate>, <slot>)       -> relay ACCEPTS it
//   mate    subscribeSwapTraffic's OWN filter, run against the relay, authenticated as the teammate
//           -> the ask comes back, with the slot, and the mate's phone reads it as an ask
//   church  the console's filter (#p church) sees the ask AND the teammate's answer
//   asker   subscribeSwapTraffic -> sees the teammate's answer to HER ask
//   CONTROLS  a plain "ask my leader" swap (no teammate) reaches nobody but the church; an uninvolved member
//             is handed nothing; and the church-sealed path hides the words from the relay.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';
import * as nip44 from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const PORT = 9013;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone', MEMBER_D = 'trinityone/member:';
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), ruth = K(), colin = K(), rob = K();   // ruth ASKS, colin is NAMED, rob is an uninvolved member
const cp = church.pub;
let _t = Math.floor(Date.now() / 1000) - 100; const now = () => ++_t;
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET]], content: JSON.stringify(content) }, who.sk);
// One authenticated question on its own socket (NIP-42), as the engine's own subscription asks it.
const askRelay = (authSk, filter) => new Promise((res, rej) => {
  const id = 'q' + Math.random().toString(36).slice(2, 8), out = [];
  const sock = new WebSocket(WS_URL);
  sock.on('error', rej);
  sock.on('open', () => sock.send(JSON.stringify(['REQ', id, filter])));
  sock.on('message', (d) => { const m = JSON.parse(d);
    if (m[0] === 'AUTH' && authSk) sock.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)]));
    else if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]);
    else if (m[0] === 'EOSE' && m[1] === id) { sock.send(JSON.stringify(['CLOSE', id])); sock.close(); res(out); } });
});

// ── the shipped engine, lifted ───────────────────────────────────────────────────────────────────────────
// `nameKey` null = the cleartext path a phone with no key yet takes; a Uint8Array = a church name key held.
function phone(who, nameKey) {
  const sent = [];
  const lastStamp = new Map();
  const fe2 = (t) => finalizeEvent(t, who.sk);
  const nameKeys = new Map(nameKey ? [[cp, [nameKey]]] : []);
  const scope = {
    sk: who.sk, NET, _nameKeys: nameKeys, encrypt: nip44.encrypt, decrypt: nip44.decrypt,
    window: { Fellowship: { ready: Promise.resolve(), relays: [WS_URL], myPubkey: who.pub } },
    finalizeEvent2: fe2, nip19decode,
    _lastStampF: lastStamp,
    publishSetFor: () => [WS_URL],
    _publishAny: async (_r, e) => { sent.push(e); const [ok, why] = await send(ws, e); if (!ok) { const err = new Error(why); err.refused = true; throw err; } return true; },
    _pubReason: (e) => (e && e.refused ? 'refused' : 'unconfirmed'),
    _netRelays: (l) => l, _onNameKey: () => () => {},
    Date, JSON, Math, Number, String, Array, Object, Boolean, Map, Set, console, Promise,
  };
  // the shipped helpers the writers call, each lifted from the bundle and seeing the scope above
  const liftFn = (name) => new Function(...Object.keys(scope), fnBody(BUNDLE, 'function ' + name + '(', name) + '\nreturn ' + name + ';')(...Object.values(scope));
  for (const fn of ['toPub', '_monotonicF', '_sealChurchDocMember', '_openChurchDoc']) scope[fn] = liftFn(fn);
  const methods = {};
  for (const [name, anchor] of [['respondToServingRequest', 'async respondToServingRequest(churchNpub, requestId, verdict, swapTo, slot)'], ['answerSwapAsk', 'async answerSwapAsk(churchNpub, ask, yes)'], ['subscribeSwapTraffic', 'subscribeSwapTraffic(onTraffic)']]) {
    const body = fnBody(BUNDLE, anchor, name);
    const keys = Object.keys(scope);
    // a pool that records what the shipped subscription ASKS FOR, so the test can put that exact question to the relay
    const asked = [];
    const pool = { subscribeMany: (_relays, filters, handlers) => { asked.push({ filters, handlers }); return { close() {} }; } };
    methods[name] = new Function(...keys, 'pool', 'return ({ ' + body + ' })[' + JSON.stringify(name) + '];')(...keys.map(k => scope[k]), pool);
    methods[name].asked = asked;
  }
  return { ...methods, sent, pub: who.pub };
}

before(async () => {
  await requireFreePort(PORT, 'a-swap-ask-reaches-the-teammate-through-the-relay.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-swap-ask-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(200); }
  ws = await connect();
  assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, church.sk)))[0], true, 'church profile');
  for (const who of [ruth, colin, rob]) assert.equal((await send(ws, doc(who, MEMBER_D + cp, { joined: now() })))[0], true, 'joined');
  await sleep(250);
});
after(async () => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const SLOT = { serviceId: 'svc1', teamId: 't1', roleId: 'r1', teamName: 'Welcome', role: 'Greeter', date: '2099-10-04', time: '10:30', service: 'Sunday Gathering' };
const d = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';

// What the teammate's phone does: its shipped subscription asks the relay a question; the relay answers; the
// shipped handler turns the answer into asks. Returns what that phone would hold.
async function trafficFor(who, nameKey) {
  const p = phone(who, nameKey);
  let traffic = null;
  p.subscribeSwapTraffic((t) => { traffic = t; });
  const { filters, handlers } = p.subscribeSwapTraffic.asked[0];
  const back = await askRelay(who.sk, filters[0]);
  back.forEach(e => handlers.onevent(e));
  handlers.oneose();
  return { traffic, back };
}

for (const sealed of [false, true]) {
  const key = sealed ? nip44.getConversationKey(generateSecretKey(), getPublicKey(generateSecretKey())) : null;
  const tag = sealed ? ' [church-sealed]' : ' [no key yet, cleartext]';
  const id = sealed ? 'reqS' : 'reqC';

  test('the asker\'s swap is ACCEPTED by the relay, naming the teammate' + tag, async () => {
    const r = phone(ruth, key);
    const out = await r.respondToServingRequest(cp, id, 'swap', colin.pub, SLOT);
    assert.equal(out && out.ok, true, 'the relay refused a swap reply that names a teammate: ' + JSON.stringify(out));
    const ptags = r.sent[0].tags.filter(t => t[0] === 'p').map(t => t[1]);
    assert.deepEqual(ptags, [cp, colin.pub], 'the reply must be p-tagged to the church AND to the teammate');
    if (sealed) assert.doesNotMatch(r.sent[0].content, /Greeter|Welcome|2099|swap/, 'the slot and the verdict reached the relay in the clear although this phone holds the church key');
  });

  test('THE TEAMMATE\'S OWN SUBSCRIPTION receives it, with what is being asked' + tag, async () => {
    const { traffic } = await trafficFor(colin, key);
    assert.equal(traffic.asks.length >= 1, true, 'THE DEFECT: the named teammate\'s phone is never told. Asks held: ' + JSON.stringify(traffic.asks));
    const ask = traffic.asks.find(a => a.id === id);
    assert.ok(ask, 'the ask for ' + id + ' did not arrive');
    assert.equal(ask.from, ruth.pub, 'the ask is not attributed to the member who sent it');
    assert.equal(ask.church, cp);
    assert.deepEqual({ ...ask.slot }, SLOT, 'the slot the teammate is asked to cover did not arrive intact');
  });

  test('the teammate\'s YES reaches the church and the asker' + tag, async () => {
    const c = phone(colin, key);
    const out = await c.answerSwapAsk(cp, { id, from: ruth.pub }, true);
    assert.equal(out && out.ok, true, 'the relay refused the teammate\'s answer: ' + JSON.stringify(out));
    // the CHURCH, with the console's own filter (#p church), reads it — this is what the one-tap confirm rests on
    const churchSees = await askRelay(church.sk, { kinds: [30078], '#p': [cp], '#t': [NET] });
    const ans = churchSees.find(e => d(e) === 'trinityone/reqreply:swapans~' + id);
    assert.ok(ans, 'the church cannot see the teammate\'s answer');
    assert.equal(ans.pubkey, colin.pub, 'the answer is not authored by the teammate — the console checks the author');
    // the ASKER's phone hears it too
    const { traffic } = await trafficFor(ruth, key);
    const mine = traffic.answers[id] && traffic.answers[id][colin.pub];
    assert.ok(mine, 'the asker never receives the teammate\'s answer');
    assert.equal(mine.yes, true, 'the asker is told the wrong answer');
    assert.equal(mine.by, colin.pub);
  });

  test('CONTROL: a member who was not named is handed neither the ask nor the answer' + tag, async () => {
    const { traffic, back } = await trafficFor(rob, key);
    assert.deepEqual(traffic.asks.filter(a => a.id === id), [], 'an uninvolved member was shown somebody else\'s swap ask');
    assert.equal(traffic.answers[id], undefined, 'an uninvolved member was shown somebody else\'s answer');
    assert.ok(!back.some(e => d(e).endsWith(id)), 'the relay served an uninvolved member a document about someone else\'s swap through the teammate filter');
  });
}

test('CONTROL: a plain "ask my leader" swap (no teammate) is p-tagged to the church alone and reaches no teammate', async () => {
  const r = phone(ruth, null);
  const out = await r.respondToServingRequest(cp, 'reqLeader', 'swap', '', SLOT);
  assert.equal(out && out.ok, true);
  assert.deepEqual(r.sent[0].tags.filter(t => t[0] === 'p').map(t => t[1]), [cp], 'a swap that names nobody must not be addressed to anybody but the church');
  assert.equal(JSON.parse(r.sent[0].content).slot, undefined, 'the slot rides only on a swap that names a teammate');
  const { traffic } = await trafficFor(colin, null);
  assert.equal(traffic.asks.some(a => a.id === 'reqLeader'), false, 'a leader-only swap showed up as an ask on a member\'s phone');
});

test('CONTROL: an accept or a decline is never an ask, whatever it names', async () => {
  const r = phone(ruth, null);
  await r.respondToServingRequest(cp, 'reqPlain', 'accept', colin.pub, SLOT);
  assert.deepEqual(r.sent[0].tags.filter(t => t[0] === 'p').map(t => t[1]), [cp]);
  const { traffic } = await trafficFor(colin, null);
  assert.equal(traffic.asks.some(a => a.id === 'reqPlain'), false);
});

test('CONTROL: a forged answer — authored by someone else — sits BESIDE the teammate\'s real one, attributed to its true author', async () => {
  // rob writes a "swapno" for ruth's request, after colin has really said yes. The asker's phone holds answers per
  // AUTHOR, so the forgery can neither overwrite colin's nor pass as his; the screen and the console both read
  // only the answer authored by the person the asker named.
  const r = phone(rob, null);
  const out = await r.answerSwapAsk(cp, { id: 'reqC', from: ruth.pub }, false);
  assert.equal(out && out.ok, true);
  const { traffic } = await trafficFor(ruth, null);
  const seen = traffic.answers.reqC;
  assert.ok(seen && seen[rob.pub], 'the fixture is wrong: the forgery never reached the asker');
  assert.equal(seen[rob.pub].by, rob.pub, 'the forged answer must carry its true author');
  assert.ok(seen[colin.pub] && seen[colin.pub].yes === true, 'THE DEFECT: the forgery overwrote the teammate\'s real answer');
});

// THE SHIPPED HANDLER'S OWN DISCIPLINE — events the relay WOULD hand this phone (they are p-tagged to it) that
// are still not asks. Fed straight to the handler, because the relay's tag filter cannot be what stops these.
test('the handler treats only a swap that names THIS member as an ask, and only an answer addressed to them as an answer', async () => {
  const p = phone(colin, null);
  let traffic = null;
  p.subscribeSwapTraffic((t) => { traffic = t; });
  const { handlers } = p.subscribeSwapTraffic.asked[0];
  const mk = (author, d, body, extraP = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/reqreply:' + d], ['t', NET], ['p', cp], ['p', colin.pub], ...extraP], content: JSON.stringify(body) }, author.sk);
  handlers.onevent(mk(ruth, 'hAccept', { request: 'hAccept', v: 'accept', swapTo: colin.pub, slot: SLOT }));      // not a swap
  handlers.onevent(mk(ruth, 'hOther', { request: 'hOther', v: 'swap', swapTo: rob.pub, slot: SLOT }));            // names somebody else
  handlers.onevent(mk(ruth, 'swapans~hAns', { request: 'hAns', v: 'swapyes', for: rob.pub }));                    // an answer for somebody else
  handlers.onevent(mk(ruth, 'swapans~hJunk', { request: 'hJunk', v: 'maybe', for: colin.pub }));                  // not an answer verdict
  handlers.onevent(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/reqreply:hMine'], ['t', NET], ['p', cp]], content: JSON.stringify({ v: 'swap', swapTo: colin.pub }) }, colin.sk)); // my OWN doc
  handlers.onevent(mk(ruth, 'hReal', { request: 'hReal', v: 'swap', swapTo: colin.pub, slot: { ...SLOT, teamName: 'x'.repeat(500) } }));   // the one real ask
  handlers.oneose();
  assert.deepEqual(traffic.asks.map(a => a.id), ['hReal'], 'something that is not an ask addressed to this member was shown as one');
  assert.deepEqual(Object.keys(traffic.answers), [], 'something that is not an answer addressed to this member was shown as one');
  assert.equal(traffic.asks[0].slot.teamName.length, 80, 'the asker\'s own text was not clipped before it reached the screen');
});
