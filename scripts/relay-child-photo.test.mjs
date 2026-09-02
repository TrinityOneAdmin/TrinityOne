// A CHILD'S PHOTOGRAPH IS NOT A UI PREFERENCE — asked of a REAL relay, over a real socket.
//   Run: node --test scripts/relay-child-photo.test.mjs
//
// Measured on the OPPO against the live relay, 2026-08-27, with the church's "Allow children's photos"
// switched OFF:
//     a minor published av:{kind:'photo', photo:<data URI>}  ->  relay answered OK true
//     another member's STOCK app rendered it                 ->  <img alt="…'s picture"> 44px, visible
//
// `childPhotos` existed in exactly two files, app/identity.jsx and app/stew-dashboard.jsx, and in both it only
// decided whether to OFFER the control. It appeared nowhere in scripts/gateway.mjs. So the setting was a UI
// preference: an old build, a modified build, or a direct publish walked straight past it.
//
// And the vector that needs no tampering at all: a member who ALREADY has a photo and is only marked as a
// child afterwards. Nothing retracted the existing av.kind:'photo' and no renderer re-checked. That is the
// ordinary way a church finds out somebody is under 18. Confirmed on the phone: adult sets a photo, steward
// marks them a child, the photograph still renders on another member's device after a fresh unlock.
//
// This is the same shape as the child-safe-groups bug, whose own comment in this relay claimed it was "the one
// safeguarding control that wasn't relay-enforced". It was not the only one.
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

const PORT = 8885;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', MINORS_D = 'trinityone/minors:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();     // the console
const ellie  = K();     // 15, marked as a child
const edith  = K();     // an ordinary adult member
const cp = church.pub;
const PIC = 'data:image/gif;base64,R0lGODlhAQABAIAAAP8AAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d]], content: JSON.stringify(content) }, who.sk);
const memberDoc = who => doc(who, MEMBER_D + cp, { joined: now() });
// A kind-0 IS REPLACEABLE, so two written in the same wall-clock second are not "newer" and the relay
// correctly refuses the second — which this file does several times over. Give every profile a strictly
// increasing stamp, started in the past so none of them is ever in the future. Without this the file passes
// alone and fails inside the suite, which is the worst kind of test.
let _clock = now() - 600;
const stamp = () => ++_clock;
// the church's own profile is where features.childPhotos lives
const churchProfile = (childPhotos) => finalizeEvent({ kind: 0, created_at: stamp(), tags: [], content: JSON.stringify({ name: 'St Test', features: childPhotos ? { childPhotos: true } : {} }) }, church.sk);
const profileWithPhoto = who => finalizeEvent({ kind: 0, created_at: stamp(), tags: [], content: JSON.stringify({ name: 'x', av: { kind: 'photo', photo: PIC } }) }, who.sk);
const profileWithPicture = who => finalizeEvent({ kind: 0, created_at: stamp(), tags: [], content: JSON.stringify({ name: 'x', picture: PIC }) }, who.sk);
const profilePlain = who => finalizeEvent({ kind: 0, created_at: stamp(), tags: [], content: JSON.stringify({ name: 'x', av: { kind: 'symbol', symbol: 'olive' } }) }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'relay-child-photo.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-childphoto-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  assert.equal((await publish(pub, churchProfile(false)))[0], true, 'church profile, children’s photos OFF');
  for (const who of [ellie, edith]) assert.equal((await publish(pub, memberDoc(who)))[0], true, 'joined');
  await sleep(120);
  assert.equal((await publish(pub, doc(church, MINORS_D + cp, { pubkeys: [ellie.pub] })))[0], true, 'minors list');
  await sleep(150);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('with children’s photos OFF, the relay refuses a minor’s photograph', async () => {
  const [ok] = await publish(pub, profileWithPhoto(ellie));
  assert.equal(ok, false,
    'the relay stored a child’s photograph while the church had children’s photos switched off. Every ' +
    'member’s device then holds it, and a stock app renders it.');
});

test('…including a bare `picture`, which other Nostr clients render', async () => {
  const [ok] = await publish(pub, profileWithPicture(ellie));
  assert.equal(ok, false,
    'blocked only the shape our own renderer reads. A child’s photograph must not land whichever field ' +
    'carries it.');
});

test('the same child may still publish a profile without a photo', async () => {
  const [ok, why] = await publish(pub, profilePlain(ellie));
  assert.equal(ok, true, `a minor cannot set their name or symbol at all: ${why}`);
});

test('an adult member is untouched', async () => {
  const [ok, why] = await publish(pub, profileWithPhoto(edith));
  assert.equal(ok, true, `an ordinary adult can no longer set a photo: ${why}`);
});

test('and when the church DOES allow children’s photos, the child’s lands', async () => {
  assert.equal((await publish(pub, churchProfile(true)))[0], true, 'church profile update refused');
  await sleep(200);
  const [ok, why] = await publish(pub, profileWithPhoto(ellie));
  assert.equal(ok, true,
    `the church switched children’s photos ON and the relay still refused: ${why}. The gate must follow the ` +
    'church’s decision, not override it — different churches safeguard differently.');
});

test('THE SETTING SURVIVES A RELAY RESTART — the gate is rebuilt at boot, not just live', async () => {
  // The original fix populated CHILD_PHOTOS_OK from note() only, and hydrateMaps() replays kind 30078 alone,
  // so the set was empty after every boot. Because the gate default-denies, a church that had deliberately
  // switched children's photos ON found its teenagers' photo updates refused after any restart — and this
  // relay self-updates and restarts by itself. Caught by audit, 2026-08-27, with exactly this probe. Without
  // a restart in the test the whole class is invisible: every other assertion here passes against the bug.
  assert.equal((await publish(pub, churchProfile(true)))[0], true, 'church profile update refused');
  await sleep(200);

  pub.close();
  relay.kill('SIGKILL');
  await sleep(400);
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();

  const [ok, why] = await publish(pub, profileWithPhoto(ellie));
  assert.equal(ok, true,
    `after a restart the relay refused a photo the church had ALLOWED: ${why}. CHILD_PHOTOS_OK was not ` +
    'rebuilt at boot, so the default-deny gate silently blocked a church that had opted in.');
});

test('…and a church that DISALLOWS is still enforced after a restart', async () => {
  // The mirror. A boot that forgot the flag could equally fail open if the default were ever flipped.
  assert.equal((await publish(pub, churchProfile(false)))[0], true, 'church profile update refused');
  await sleep(200);
  pub.close();
  relay.kill('SIGKILL');
  await sleep(400);
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  const [ok] = await publish(pub, profileWithPhoto(ellie));
  assert.equal(ok, false, 'after a restart a child’s photograph landed in a church that disallows them');
});

test('switching it back off refuses again — the flag is live, not read once at boot', async () => {
  assert.equal((await publish(pub, churchProfile(false)))[0], true, 'church profile update refused');
  await sleep(200);
  const [ok] = await publish(pub, profileWithPhoto(ellie));
  assert.equal(ok, false, 'the relay kept honouring a setting the church has since turned off');
});

// ── the PARENT switch: a church that turns member photos off entirely ───────────────────────────────────────
// `features.memberPhotos === false` had exactly the bug the children's switch had before 2026-08-28: it lived
// only in the client, so a church that had switched photos off still had them accepted and served. Measured on
// the live relay, 28 Aug: with the switch off, an adult's photograph was stored without complaint.
// Polarity differs from childPhotos on purpose — photos are ON by default and a church opts OUT.
const churchProfileFull = (opts) => finalizeEvent({ kind: 0, created_at: stamp(), tags: [],
  content: JSON.stringify({ name: 'St Test', features: opts }) }, church.sk);

test('with member photos OFF, an ADULT’s photograph is refused', async () => {
  assert.equal((await publish(pub, churchProfileFull({ memberPhotos: false })))[0], true, 'church profile refused');
  await sleep(200);
  const [ok] = await publish(pub, profileWithPhoto(edith));
  assert.equal(ok, false,
    'a church switched member photos off and an adult’s photograph was stored anyway — the switch is a UI ' +
    'preference, exactly what the children’s one was before it was moved to the relay');
});

test('…and so is a minor’s, whatever the children’s setting says', async () => {
  // The parent switch wins: turning children's photos ON cannot re-enable them for a church that has turned
  // ALL photos off. Otherwise the narrower control silently overrides the broader one.
  assert.equal((await publish(pub, churchProfileFull({ memberPhotos: false, childPhotos: true })))[0], true, 'refused');
  await sleep(200);
  const [ok] = await publish(pub, profileWithPhoto(ellie));
  assert.equal(ok, false, 'children’s photos being ON re-enabled photos for a church that switched them all off');
});

test('a profile with no photo is still fine', async () => {
  const [ok, why] = await publish(pub, profilePlain(edith));
  assert.equal(ok, true, `a member cannot set their name or symbol while photos are off: ${why}`);
});

test('switching photos back ON restores them', async () => {
  assert.equal((await publish(pub, churchProfileFull({})))[0], true, 'refused');
  await sleep(200);
  const [ok, why] = await publish(pub, profileWithPhoto(edith));
  assert.equal(ok, true, `photos stayed blocked after the church allowed them again: ${why}`);
});

test('AND IT SURVIVES A RESTART — the set is rebuilt at boot', async () => {
  assert.equal((await publish(pub, churchProfileFull({ memberPhotos: false })))[0], true, 'refused');
  await sleep(200);
  pub.close(); relay.kill('SIGKILL'); await sleep(400);
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  const [ok] = await publish(pub, profileWithPhoto(edith));
  assert.equal(ok, false,
    'after a restart the church’s decision was forgotten and photos were accepted again — CHILD_PHOTOS_OK ' +
    'shipped with exactly this hole and only a restart in the test would have caught it');
});
