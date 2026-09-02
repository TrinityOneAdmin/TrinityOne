// A CHILD MUST NOT STAY ADVERTISED TO THE CONGREGATION AS SOMEONE TO CONTACT FOR HELP.
//   Run: node --test scripts/a-marked-child-is-not-listed-as-a-helper.test.mjs
//
// What a young person experiences without this. Tom, 15, tapped "I'm here to help" and wrote a line about
// being good with computers. Some weeks later a steward marks him as a child — which is the ordinary route
// into safeguarding here, not an edge case (reference/DOMAIN.md). On every ordinary member's Care tab he
// stays under "Ready to help", with his own words underneath, inviting adults he has never met to contact
// him. Nothing on any screen says why.
//
// WHY THE EXISTING PROTECTIONS BOTH MISS IT:
//
//   • The relay's WRITE gate refuses a minor's careavail: (AUDIT-2026-07-30, gateway.mjs ~:2006). It stops a
//     new one. It does not retract the one already on disk — measured: after the marking, a REFRESH is
//     refused and the ORIGINAL keeps being served, with zero kind-5 deletions on the box.
//   • The CLIENT does filter minors out of the list (CareAvailability in app/screens-today.jsx). It filters
//     from `safeguard.minors`, and this relay deliberately does not serve `minors:` to ordinary members — it
//     is the cleartext list of a congregation's children and joining an open church is one self-signed
//     publish (AUDIT-2026-07-27). So the filter is live, correct, and running on input it can never receive.
//     Back-filling that list onto member devices would undo that audit in order to fix this one.
//
// So the gate belongs where the knowledge is: the relay holds `minors:`. This file asks a REAL gateway, on a
// real socket, with real NIP-42 auth — the client half is not a boundary and text-matching it proves nothing.
//
// AND WHAT MUST NOT BREAK. The ordinary helper register is the common case and is heavily used: an adult who
// lists themselves must still be served to every member. Tom must still see his own row, or his Care tab
// silently loses his listing out from under him. And the church and its stewards must still see it — a
// steward who cannot see the row cannot explain why somebody vanished from the register, and the console is
// where the marking was made.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8803;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', AVAIL_D = 'trinityone/careavail:';
const MINORS_D = 'trinityone/minors:', STEWARDS_D = 'trinityone/stewards:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();   // the console — the vicar's laptop
const tom    = K();   // 15. Listed himself as willing to help BEFORE anyone marked him.
const dave   = K();   // an ordinary adult who is also glad to help. The common case; must not break.
const ruth   = K();   // an ordinary member, looking at her Care tab
const ray    = K();   // a steward given the Care job
const cp = church.pub;
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ...tags], content: JSON.stringify(content) }, who.sk);
const memberDoc = who => doc(who, MEMBER_D + cp, { joined: now() });
// The register is one replaceable document PER MEMBER at a SHARED d-tag (careavail:<churchpub>), keyed by
// its author — so "who is listed" is the set of authors the relay hands back, exactly as subscribeCareAvail
// reads it. Content is sealed under the church name key in the app; the relay never opens it, so an opaque
// blob here keeps the test about the gate.
const availDoc = (who, at) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', AVAIL_D + cp], ['t', 'trinityone'], ['church', cp]], content: 'SEALED-OFFER' }, who.sk);

function reqCollect(ws, subId, filter, authSk, window = 700) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)])); };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}
// WHO DOES THE RELAY LIST TO THIS PERSON? The set of authors it serves back for the register's d-tag.
let _sub = 0;
async function whoIsListed(who) {
  const ws = await connect();
  const evs = await reqCollect(ws, 'av' + (++_sub), { kinds: [30078], '#d': [AVAIL_D + cp] }, who && who.sk);
  ws.close();
  return new Set(evs.filter(e => (e.tags.find(t => t[0] === 'd') || [])[1] === AVAIL_D + cp).map(e => e.pubkey));
}

before(async () => {
  await requireFreePort(PORT, 'a-marked-child-is-not-listed-as-a-helper.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-availminor-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  for (const who of [tom, dave, ruth, ray]) assert.equal((await publish(pub, memberDoc(who)))[0], true, 'joined');
  assert.equal((await publish(pub, doc(church, STEWARDS_D + cp, { pubkeys: [ray.pub], caps: { [ray.pub]: ['care'] } })))[0], true, 'steward roster');
  await sleep(150);
  // BEFORE anyone is marked: both of them sign up to help. Tom's write is accepted here, which is the whole
  // premise — the write gate cannot help with a document that already exists.
  assert.equal((await publish(pub, availDoc(tom)))[0], true, 'Tom could not list himself while nobody had marked him');
  assert.equal((await publish(pub, availDoc(dave)))[0], true, 'Dave could not list himself');
  await sleep(150);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('BEFORE the marking, the register lists both of them — the premise, not the fix', async () => {
  const listed = await whoIsListed(ruth);
  assert.equal(listed.has(tom.pub), true, 're-anchor: Tom is not on the register at all, so nothing below is a real test');
  assert.equal(listed.has(dave.pub), true, 're-anchor: the ordinary helper register is not working');
});

test('the church marks Tom as a child, and refusing his REFRESH does not retract what is stored', async () => {
  assert.equal((await publish(pub, doc(church, MINORS_D + cp, { pubkeys: [tom.pub] })))[0], true, 'minors list');
  await sleep(200);
  const [ok] = await publish(pub, availDoc(tom, now() + 1));
  assert.equal(ok, false, 're-anchor: the write gate no longer refuses a minor a NEW listing');
  // …and this is exactly why the write gate is not enough. Nothing deleted the one already on disk.
});

test('AN ORDINARY MEMBER IS NO LONGER SHOWN THE CHILD', async () => {
  const listed = await whoIsListed(ruth);
  assert.equal(listed.has(tom.pub), false,
    'Tom is 15 and his church has said so. He is still under "Ready to help" on every member\'s Care tab, ' +
    'with his own offer text, inviting adults to contact him. Refusing his refresh never retracted the ' +
    'listing already stored, and the client filter runs on `minors:`, which this relay does not serve to ' +
    'ordinary members.');
});

test('…and the ordinary adult helper is untouched', async () => {
  // The common case, and the one a fix here is most likely to break: the register is the point of the feature.
  const listed = await whoIsListed(ruth);
  assert.equal(listed.has(dave.pub), true,
    'the "Ready to help" register went dark for everyone. Dave is an adult who volunteered and nobody can see him.');
});

test('Tom still sees his own listing', async () => {
  // Decided, not inherited. His Care tab must not silently drop his own row out from under him — he is
  // reading a screen about himself, and he already knows what he wrote.
  const listed = await whoIsListed(tom);
  assert.equal(listed.has(tom.pub), true, 'his own offer disappeared from his own screen with no explanation');
});

test('THE STEWARD STILL SEES IT — or nobody can explain why he vanished', async () => {
  // The console is where the marking was made. A steward who cannot see the row has no way to understand
  // that Tom was removed from the register, or why, or that he ever offered.
  const listed = await whoIsListed(ray);
  assert.equal(listed.has(tom.pub), true,
    'a steward looking at the register cannot see the listing the church itself suppressed, so a person ' +
    'vanishing from it is unexplainable from the console that caused it');
  assert.equal(listed.has(dave.pub), true, 'and the steward lost sight of the ordinary register too');
});

test('the church’s own console still sees it', async () => {
  const listed = await whoIsListed(church);
  assert.equal(listed.has(tom.pub), true, 'the accountable adult cannot see what the congregation was being shown');
});

test('a stranger is served nothing either way', async () => {
  // Re-anchor the default-deny read gate underneath all of this: the register is members-only to begin with.
  const listed = await whoIsListed(null);
  assert.equal(listed.size, 0, 'the "here to help" register is served to an unauthenticated client');
});
