// A DELEGATED STEWARD ASKS PEOPLE TO SERVE, AND THE REQUEST MUST ACTUALLY LEAVE THE BUILDING.
//   Run: node --test scripts/a-delegated-stewards-serving-request-reaches-the-relay.test.mjs
//
// FOUND 2026-09-16, while fixing something smaller. A review of the rota-honesty fix noticed that a
// delegated steward's "can you serve?" requests are invisible to their own console, so `alreadyAsked` could
// never be true and every Publish re-asked everybody. Measured against a live relay, the truth was worse:
// the requests are REFUSED AT THE DOOR. Nothing ever left. A delegated steward's volunteers were never asked
// to serve at all, and the console said the rota had published — which it had.
//
//   church key, no church tag    ACCEPTED     (the ordinary case, and it never broke)
//   DELEGATED steward, as shipped  REFUSED    "blocked: not a member or not permitted for this group"
//   DELEGATED steward, + church tag ACCEPTED
//   an ORDINARY MEMBER, + church tag REFUSED  (so the tag grants nothing on its own)
//
// WHY. The relay's rule for church-authored CONTENT documents (`accept()` in scripts/gateway.mjs) is
// `leaderOf(ownCp()) || stewardCan(e.pubkey, namedChurch(e), 'content')`, and `namedChurch()` reads a
// ['church', <cp>] tag. In delegated mode the steward's OWN key signs while `pub` is the church — the mode
// switch in src/steward.src.js says so in as many words: "delegated: OUR key signs, church's context reads".
// So without the tag the author is not the church AND no church is named, and both halves of the rule fail.
//
// `feChurch()` is the house helper that stamps that tag, and REQUEST_D was the only one of the relay's
// twelve content prefixes not going through it — group, plan, devo, rota, roster, service, room, booking,
// runsheet, category and pinsermon all did. One missed call site, not a design gap.
//
// ── HOW THIS ASSERTS ──────────────────────────────────────────────────────────────────────────────────────
// It drives the SHIPPED function. `sendServingRequest` and `feChurch` are lifted out of vendor/steward.js —
// the bundle the console actually loads — and the event they produce is put on a REAL relay over a REAL
// websocket. A mirror of the logic written here would pass its own sabotage (see
// reference: tests-must-drive-shipped-code); nothing between the call and the wire is this file's own copy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const PORT = 8827;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone', MEMBER_D = 'trinityone/member:', STEWARDS_D = 'trinityone/stewards:';
const REQUEST_D = 'trinityone/request:';
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();   // the vicar's laptop — holds the church key
const dana   = K();   // a DELEGATED steward holding 'content'. Her OWN key signs; `pub` is the church.
const rob    = K();   // an ordinary member, no capabilities. The control that proves the tag is not a key.
const ruth   = K();   // the volunteer being asked to serve
const cp = church.pub;

let _t = Math.floor(Date.now() / 1000) - 100; const now = () => ++_t;
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET]], content: JSON.stringify(content) }, who.sk);

// Ask the relay a question the way the console's own subscribeRequests does — ON ITS OWN SOCKET, AFTER A
// REAL NIP-42 AUTH. The read gate is default-deny, so an anonymous socket gets nothing and a test that
// forgot to authenticate would read "the fix did not work" off its own omission. (It did, once, here.)
// One socket per question, so a stale AUTH can never make a refusal look like a grant.
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

// THE SHIPPED sendServingRequest, with the shipped feChurch behind it. `publish` is the only stub, and it
// stubs the TRANSPORT, not the decision: it puts the real event on the real relay and reports what the relay
// said. `actingChurch` is what puts the console in delegated mode.
function consoleApi({ signer, actingChurch }) {
  const scope = {
    sk: signer.sk, pub: cp, actingChurch, NET, REQUEST_D,
    now, finalizeEvent,
    _monotonic: (t) => t,   // the shipped one guards same-second replaceables; irrelevant here and it needs state
    sent: null,
    publish: async (evt) => { scope.sent = evt; const [ok] = await send(ws, evt); return ok; },
  };
  // esbuild renames the imported signer (finalizeEvent -> finalizeEvent2, and the number moves between
  // builds). Read the name the bundle ACTUALLY uses rather than hard-coding one, or a rebuild turns this
  // test red for a reason that has nothing to do with the behaviour it guards.
  const feBody = fnBody(VENDOR, 'function feChurch(tmpl, signer) {', 'feChurch');
  const signerName = (/return\s+(finalizeEvent\w*)\s*\(/.exec(feBody) || [])[1];
  assert.ok(signerName, 'feChurch in vendor/steward.js no longer ends by calling finalizeEvent — re-anchor ' +
    'this fixture rather than deleting it. Body seen:\n' + feBody.slice(0, 400));
  scope[signerName] = finalizeEvent;
  scope.feChurch = new Function('scope', `with (scope) { ${feBody} return feChurch; }`)(scope);
  const body = fnBody(VENDOR, 'sendServingRequest(req) {', 'sendServingRequest');
  scope.sendServingRequest = new Function('scope', `with (scope) { return ({ ${body} }).sendServingRequest; }`)(scope);
  return scope;
}

before(async () => {
  await requireFreePort(PORT, 'a-delegated-stewards-serving-request-reaches-the-relay.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-deleg-serve-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(200); }
  ws = await connect();
  assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, church.sk)))[0], true, 'church profile');
  for (const who of [dana, rob, ruth]) assert.equal((await send(ws, doc(who, MEMBER_D + cp, { joined: now() })))[0], true, 'joined');
  // Dana is delegated and holds 'content' — the capability the relay's rule for these documents names.
  assert.equal((await send(ws, doc(church, STEWARDS_D + cp, { pubkeys: [dana.pub], caps: { [dana.pub]: ['content'] } })))[0], true, 'steward roster');
  await sleep(250);
});
after(async () => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a DELEGATED steward’s request to serve is accepted by the relay', async () => {
  const api = consoleApi({ signer: dana, actingChurch: cp });
  const out = await api.sendServingRequest({ memberPub: ruth.pub, serviceId: 'svc1', teamId: 't1', roleId: 'r1', role: 'Greeter', teamName: 'Welcome' });
  assert.ok(api.sent, 'nothing was published at all — the fixture is not exercising the path it names');
  assert.ok(out, 'THE DEFECT: the relay refused a delegated steward’s "can you serve?" request, so the ' +
    'volunteer was never asked. The console had already said the rota published — and it had.');
  const tag = (api.sent.tags.find(t => t[0] === 'church') || [])[1];
  assert.equal(tag, cp, 'the published request does not name the church, so the relay cannot tell which ' +
    'church this steward is acting for. Tags: ' + JSON.stringify(api.sent.tags));
});

test('…and the console can then FIND it, which is what stops everyone being re-asked', async () => {
  // Point of use (CLAUDE.md rule 1). subscribeRequests asks for authors:[church] OR #church:[church]. A
  // delegated steward's request is authored by HER, so only the second filter can ever match it — and it
  // only matches because of the tag. Without this, `alreadyAsked` is permanently false and every Publish
  // asks everyone again.
  const back = await askRelay(dana.sk, { kinds: [30078], '#church': [cp], '#t': [NET] });
  const mine = back.filter(e => ((e.tags.find(t => t[0] === 'd') || [])[1] || '').startsWith(REQUEST_D));
  assert.ok(mine.length >= 1,
    'the console’s own subscription cannot see the request a delegated steward just sent, so it will ask ' +
    'the same volunteer again on every publish. Documents returned: ' + back.length);
  assert.equal(mine[0].pubkey, dana.pub, 'the request came back authored by someone other than the steward');

  // THE CONTROL FOR THIS TEST: the OTHER half of subscribeRequests — authors:[church] — cannot see it, and
  // never could. That is precisely why the tag is load-bearing rather than decorative.
  const byAuthor = await askRelay(dana.sk, { kinds: [30078], authors: [cp], '#t': [NET] });
  const authored = byAuthor.filter(e => ((e.tags.find(t => t[0] === 'd') || [])[1] || '').startsWith(REQUEST_D)
    && e.pubkey === dana.pub);
  assert.equal(authored.length, 0,
    'a delegated steward’s request came back under authors:[church], which would mean the church key signed ' +
    'it. Re-anchor this test — the fix is meant to work through the church TAG, not by changing who signs.');
});

test('CONTROL — the church’s own console is unaffected', async () => {
  // Not delegated: actingChurch is empty, feChurch adds nothing, the church key signs. This is the path
  // that always worked, and the fix must not disturb it.
  const api = consoleApi({ signer: church, actingChurch: '' });
  const out = await api.sendServingRequest({ memberPub: ruth.pub, serviceId: 'svc2', teamId: 't1', roleId: 'r1', role: 'Greeter', teamName: 'Welcome' });
  assert.ok(out, 'the church’s own console can no longer ask anyone to serve — the fix broke the ordinary case');
  assert.equal(api.sent.tags.find(t => t[0] === 'church'), undefined,
    'a church tag was stamped on the church’s OWN document. Harmless today, but it means feChurch is adding ' +
    'it unconditionally rather than only in delegated mode, and that is not what the other eleven writers do.');
});

test('CONTROL — the church tag is not a skeleton key', async () => {
  // THE CONTROL THAT MATTERS. If naming a church in a tag were enough, this fix would have opened the door
  // to every member of every church on the box. It is the CAPABILITY that decides; the tag only says which
  // church the question is about.
  const api = consoleApi({ signer: rob, actingChurch: cp });
  const out = await api.sendServingRequest({ memberPub: ruth.pub, serviceId: 'svc3', teamId: 't1', roleId: 'r1', role: 'Greeter', teamName: 'Welcome' });
  assert.equal(out, null,
    'an ORDINARY MEMBER with no capabilities published a "can you serve?" request in the church’s name. ' +
    'The church tag has become a skeleton key and anyone on this relay can summon a congregation.');
});
