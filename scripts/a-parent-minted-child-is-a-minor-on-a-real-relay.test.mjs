// THE APP HALF AND THE RELAY HALF OF "A PARENT-INVITED CHILD IS A MINOR UNTIL THE CHURCH DECIDES" MUST AGREE (SIGNUP-SAFEGUARDING-GAPS gap 1B).
//   Run: node --test scripts/a-parent-minted-child-is-a-minor-on-a-real-relay.test.mjs
//
// THE RISK THIS EXISTS FOR. The relay (scripts/gateway.mjs guardAckOk) believes a child is pending only if the parent's guardreq: carries an
// `ack` the CHILD'S key signed, in an exact shape. A relay that is handed anything else does not refuse it — it IGNORES it, so every relay test
// stays green while the feature is dead on arrival and silent. This is the ONLY test that catches an app <-> relay mismatch: it runs the SHIPPED
// createChildAccount (lifted from the rebuilt vendor/fellowship.js, as child-account-tells-the-truth.test.mjs does), takes the events it
// actually produced, publishes ALL FOUR to a REAL booted gateway, and then asks that gateway what the child may read. Only the transport
// (_publishAny) is the test's — it hands the events to the real relay instead of a pool. Nothing about the gate is stubbed.
//
// THE CHURCH IS OPEN (no joinpolicy), the child holds a membership at once, and NO steward has pressed Confirm: no minors:, no guardians:.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { privateKeyFromSeedWords, generateSeedWords } from 'nostr-tools/nip06';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { openStore } from './event-store.mjs';
import { requireFreePort } from './test-ports.mjs';

const SRC = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
function grabMethod(src, sig) {
  const at = src.indexOf(sig); assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, do not delete it');
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}
const BODY = grabMethod(SRC, 'async createChildAccount(churchNpub, childName, opts)');
const nameFor = (base) => (BODY.match(new RegExp('\\b' + base + '\\d*\\b')) || [])[0] || base;

const PORT = 9091, WS_URL = `ws://127.0.0.1:${PORT}/relay`, NET = 'trinityone';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
const church = { sk: generateSecretKey() }; church.pub = getPublicKey(church.sk);
const parentSk = generateSecretKey(), PARENT = getPublicKey(parentSk);
const ROOM_ADULTS = church.pub.slice(0, 16) + '-adults', ROOM_KIDS = church.pub.slice(0, 16) + '-kids';
const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
const doc = (who, d, content, tags = []) => finalizeEvent({ kind: 30078, created_at: nowS() - 100, tags: [['d', d], ['t', NET], ...tags], content: JSON.stringify(content) }, who.sk);
let relay, dataDir;

// the SHIPPED function, with only the transport and the local-storage / identity plumbing supplied by this world
function mint(mnemonic) {
  const events = [];
  const scope = {
    _sgMine: () => null, publishSetFor: () => ['wss://test.invalid'], sk: parentSk, pub: PARENT, toPub: () => church.pub, NET, _needAuth: false,
    _saveChildLink: () => {}, _pubReason: () => '',
    _publishAny: async (_r, e) => { events.push(e); },
    [nameFor('finalizeEvent')]: finalizeEvent, [nameFor('getPublicKey')]: getPublicKey, privateKeyFromSeedWords, npubEncode,
    [nameFor('encrypt')]: (pl, k) => nip44v2.encrypt(pl, k), [nameFor('getConversationKey')]: (a, b) => nip44v2.utils.getConversationKey(a, b),
    console: { warn() {} },
    window: { Fellowship: { relays: ['wss://test.invalid'], ready: Promise.resolve() }, TrinityIdentity: { makeInvite: () => ({ mnemonic, profile: {} }) } },
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, `return ({ ${BODY} }).createChildAccount;`)(...args.map(k => scope[k]));
  return { run: () => fn('npub1church', 'Ellie', { mnemonic }), events };
}

const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = async (evt) => { const ws = await connect(); try { return await new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); }); } finally { ws.close(); } };
const readAs = (sk, filter) => new Promise(async (res, rej) => {
  let ws; try { ws = await connect(); } catch (e) { return rej(e); }
  const seen = []; let authId = '', asked = 0; const done = () => { try { ws.close(); } catch {} res(seen); }; const t = setTimeout(done, 8000);
  const ask = () => { asked++; ws.send(JSON.stringify(['REQ', 'r' + asked, filter])); };
  ws.on('message', d => { const m = JSON.parse(d);
    if (m[0] === 'AUTH') { const evt = finalizeEvent({ kind: 22242, created_at: nowS(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk); authId = evt.id; ws.send(JSON.stringify(['AUTH', evt])); return; }
    if (m[0] === 'OK' && m[1] === authId) { if (m[2] !== true) { clearTimeout(t); return done(); } ask(); return; }
    if (m[0] === 'EVENT' && String(m[1]).startsWith('r')) seen.push(m[2]);
    if (m[0] === 'EOSE' && String(m[1]).startsWith('r') && authId) { clearTimeout(t); done(); } });
  ask();
});
const groupIdsAs = async (sk) => (await readAs(sk, { kinds: [30078], '#d': ['trinityone/group:' + ROOM_ADULTS, 'trinityone/group:' + ROOM_KIDS] })).map(e => dOf(e).replace('trinityone/group:', '')).sort();

before(async () => {
  await requireFreePort(PORT, 'a-parent-minted-child-is-a-minor-on-a-real-relay.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-1b-'));
  const store = openStore(join(dataDir, 'relay.sqlite'), { maxEvents: 5000 });
  store.put(finalizeEvent({ kind: 30078, created_at: nowS() - 900, tags: [['d', 'trinityone/member:' + church.pub], ['t', NET], ['p', church.pub]], content: JSON.stringify({ joined: 1 }) }, parentSk));   // the PARENT is a member
  store.put(doc(church, 'trinityone/group:' + ROOM_ADULTS, { name: 'Notices', kind: 'open' }, [['church', church.pub]]));                     // adults-only: childsafe absent
  store.put(doc(church, 'trinityone/group:' + ROOM_KIDS, { name: 'Prayer', kind: 'open', childsafe: true }, [['church', church.pub]]));
  store.close();
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) }, stdio: 'ignore' });
  const t0 = Date.now(); for (;;) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} if (Date.now() - t0 > 15000) throw new Error('relay never came up'); await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

async function mintAndPublish(transform = (e) => e) {
  const mnemonic = generateSeedWords(), childSk = privateKeyFromSeedWords(mnemonic), childPub = getPublicKey(childSk);
  const m = mint(mnemonic); const r = await m.run();
  assert.equal(r.ok, true, 'fixture: createChildAccount did not complete: ' + JSON.stringify(r));
  assert.equal(m.events.length, 4, 'fixture: expected the four documents (join, kind-0, name, request), got ' + m.events.length);
  for (const e of m.events) { const [ok, msg] = await publish(transform(e, childSk)); assert.equal(ok, true, 'fixture: the real relay refused ' + (dOf(e) || 'kind ' + e.kind) + ': ' + msg); }
  await sleep(300);
  return { childSk, childPub, events: m.events };
}

test('1 THE CONTRACT: the ack the shipped function emits has the EXACT shape the relay verifies — child-signed, embedded in the request, never standalone', async () => {
  const m = mint(generateSeedWords()); await m.run();
  const req = m.events.find(e => dOf(e).startsWith('trinityone/guardreq:'));
  assert.ok(req, 'no guardreq was produced');
  const c = JSON.parse(req.content), childPub = dOf(req).slice('trinityone/guardreq:'.length);
  assert.equal(req.pubkey, PARENT, 'the request must be signed by the parent'); assert.deepEqual(Object.keys(c).sort(), ['ack', 'child', 'parent']);
  assert.ok(req.tags.some(t => t[0] === 'p' && t[1] === church.pub), 'the request does not name the church with a ["p", churchpub] tag — the relay folds the ack per church found there');
  const a = c.ack; assert.ok(a && typeof a === 'object', 'the request carries no `ack`');
  assert.equal(a.kind, 30078); assert.equal(a.pubkey, childPub, 'the ack is not signed by the CHILD key'); assert.equal(verifyEvent(a), true, 'the ack signature does not verify');
  assert.equal((a.tags.find(t => t[0] === 'd') || [])[1], 'trinityone/guardreq:ack:' + church.pub);
  assert.equal((a.tags.find(t => t[0] === 'p') || [])[1], PARENT);
  assert.deepEqual(JSON.parse(a.content), { parent: PARENT, church: church.pub });
  assert.ok(!m.events.some(e => e === a || e.id === a.id), 'the ack was ALSO published as an event of its own');
});

test('2 END TO END: publish all four of the shipped function\'s events to a REAL relay, no Confirm -> the child reads only the child-safe room', async () => {
  const { childSk } = await mintAndPublish();
  assert.deepEqual(await groupIdsAs(parentSk), [ROOM_ADULTS, ROOM_KIDS].sort(), 'CONTROL: an adult member should see both rooms, so the child result below proves something');
  assert.deepEqual(await groupIdsAs(childSk), [ROOM_KIDS],
    'THE PARENT-INVITED CHILD WAS SERVED THE ADULTS-ONLY ROOM BEFORE ANY STEWARD CONFIRMED — the ack the app emits is not one the relay accepts (a silent app/relay mismatch)');
});

test('3 RED WITHOUT THE ACK: the same four events with `ack` stripped from the request -> the relay treats the child as an adult (this is what the test above catches)', async () => {
  const { childSk } = await mintAndPublish((e) => {
    if (!dOf(e).startsWith('trinityone/guardreq:')) return e;
    const c = JSON.parse(e.content); delete c.ack;
    return finalizeEvent({ kind: e.kind, created_at: e.created_at, tags: e.tags, content: JSON.stringify(c) }, parentSk);
  });
  assert.deepEqual(await groupIdsAs(childSk), [ROOM_ADULTS, ROOM_KIDS].sort(), 'CONTROL FAILED: an ack-less request already gated the child, so test 2 would pass without the ack');
});

test('4 an ack the app got WRONG in any one field is ignored by the relay, never accepted (so a drift in createChildAccount fails test 2, not silently)', async () => {
  for (const [label, mutate] of [
    ['wrong d-tag', (a) => ({ ...a, tags: a.tags.map(t => t[0] === 'd' ? ['d', 'trinityone/guardack:' + church.pub] : t) })],
    ['no parent tag', (a) => ({ ...a, tags: a.tags.filter(t => t[0] !== 'p') })],
  ]) {
    const { childSk, childPub } = await mintAndPublish((e, csk) => {
      if (!dOf(e).startsWith('trinityone/guardreq:')) return e;
      const c = JSON.parse(e.content); const a = mutate(c.ack);
      c.ack = finalizeEvent({ kind: a.kind, created_at: a.created_at, tags: a.tags, content: a.content }, csk);   // re-signed by the child, so only the SHAPE is wrong
      return finalizeEvent({ kind: e.kind, created_at: e.created_at, tags: e.tags, content: JSON.stringify(c) }, parentSk);
    });
    assert.deepEqual(await groupIdsAs(childSk), [ROOM_ADULTS, ROOM_KIDS].sort(), label + ': a malformed ack was believed');
  }
});
