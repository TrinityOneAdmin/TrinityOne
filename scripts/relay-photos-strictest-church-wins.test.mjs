// TWO CHURCHES ON ONE RELAY, ONE OF THEM SAYS NO PHOTOGRAPHS — asked of a REAL relay, over a real socket.
//   Run: node --test scripts/relay-photos-strictest-church-wins.test.mjs
//
// The member-photo gate was shipped with the claim that "joining a second church cannot quietly undo the
// first one's decision", and NOTHING TESTED IT: every existing case runs against a single church, so
// narrowing the rule from "every church this person belongs to" to "the first church they joined" left the
// whole suite green. An audit found the one-line edit that does it.
//
// This is exactly the shape the relay already learned for safeguarding — a church may only make this
// judgement about its own people, and the strictest answer wins — so it is worth its own file rather than
// another case bolted onto the single-church one.
//
// The real congregation this protects: a member of a persecuted-church plant that publishes no faces, who
// also belongs to an open church across town. The open church must not be the hole in the strict one's wall.
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

const PORT = 8802;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const strict = K();     // "no photographs here"
const open   = K();     // ordinary church, photos allowed
const dual   = K();     // belongs to BOTH
const only   = K();     // belongs to the open church only
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const memberDoc = (who, cp) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp]], content: JSON.stringify({ joined: now() }) }, who.sk);
// A kind-0 is REPLACEABLE: two written in the same second are not "newer" and the second is refused, which
// passes alone and fails inside the suite. Strictly increasing, started in the past so none is in the future.
let _clock = now() - 600;
const stamp = () => ++_clock;
const PIC = 'data:image/gif;base64,R0lGODlhAQABAIAAAP8AAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const churchProfile = (who, features) => finalizeEvent({ kind: 0, created_at: stamp(), tags: [], content: JSON.stringify({ name: 'A church', features }) }, who.sk);
const withPhoto = who => finalizeEvent({ kind: 0, created_at: stamp(), tags: [], content: JSON.stringify({ name: 'x', av: { kind: 'photo', photo: PIC } }) }, who.sk);
const plain = who => finalizeEvent({ kind: 0, created_at: stamp(), tags: [], content: JSON.stringify({ name: 'x', av: { kind: 'symbol', symbol: 'olive' } }) }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'relay-photos-strictest-church-wins.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-twochurch-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir,
             CHURCH_NPUB: npubEncode(strict.pub) + ',' + npubEncode(open.pub), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  assert.equal((await publish(pub, churchProfile(strict, { memberPhotos: false })))[0], true, 'strict church profile');
  assert.equal((await publish(pub, churchProfile(open,   { })))[0], true, 'open church profile');
  // JOIN ORDER MATTERS TO THE BUG: the permissive church is joined FIRST, so a rule that consults only the
  // first church a member joined reads "allowed" and lets the photo through.
  assert.equal((await publish(pub, memberDoc(dual, open.pub)))[0], true, 'dual joined the open church');
  assert.equal((await publish(pub, memberDoc(dual, strict.pub)))[0], true, 'dual joined the strict church');
  assert.equal((await publish(pub, memberDoc(only, open.pub)))[0], true, 'only joined the open church');
  await sleep(250);
});

after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the permissive church does not reopen the strict church’s door', async () => {
  const [ok] = await publish(pub, withPhoto(dual));
  assert.equal(ok, false,
    'a member of a church that publishes no faces got their photograph onto the relay because they ALSO ' +
    'belong to an ordinary church — the strict church’s decision was undone by someone else’s');
});

test('…and that member can still set a name and a symbol', async () => {
  // The gate must cost them nothing else. Refusing the whole profile is the failure this rule already caused
  // once on the client side.
  const [ok, why] = await publish(pub, plain(dual));
  assert.equal(ok, true, `a member of the strict church cannot change their name at all: ${why}`);
});

test('a member of the permissive church alone is untouched', async () => {
  const [ok, why] = await publish(pub, withPhoto(only));
  assert.equal(ok, true,
    `one church's decision leaked onto another church's members: ${why}. A church may only make this ` +
    'judgement about its own people.');
});

test('when the strict church relents, the door opens for everyone', async () => {
  assert.equal((await publish(pub, churchProfile(strict, {})))[0], true, 'refused');
  await sleep(250);
  const [ok, why] = await publish(pub, withPhoto(dual));
  assert.equal(ok, true, `the church allowed photos again and the block stuck: ${why}`);
});
