// AN INVITE-ONLY RELAY MUST NOT REFUSE THE CHURCH IT ALREADY HOSTS.
// Run: node --test scripts/an-invited-church-is-not-told-it-was-refused.test.mjs
//
// Measured 2026-09-04 (SESSION-2026-09-04-END-TO-END.md, F4). On a relay with Invite-only ON and the
// church added by the operator, every tab of the steward console carried a red banner reading
//
//     "This relay has not accepted your church, so nothing you set up will save:
//      this relay is invite-only — ask the operator to add your church"
//
// while that console's writes were landing perfectly — group, group key, care key, name key and profile
// all reached relay.sqlite. The banner survived a reload and appeared within seconds on a brand-new
// second console, because selfRegister deliberately never marks a 403 as done, so it retries and
// re-alarms on every load, for ever.
//
// The relay could not tell the console otherwise: its invite-only branch fired BEFORE it looked at whether
// the church was already registered, so "invite-only, and you are not in" and "invite-only, and the
// operator added you last week" were the same 403. A church that is already registered is not adding
// anything, and the H4 comment beside it already contemplates the case ("an existing church re-announcing
// itself is fine").
//
// The lock itself is deliberate and must not be loosened, so the controls below matter as much as the fix.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8847;
const BASE = `http://127.0.0.1:${PORT}`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const inSk = generateSecretKey(), inPub = getPublicKey(inSk);     // the church the OPERATOR added
const outSk = generateSecretKey(), outPub = getPublicKey(outSk);  // a stranger

let relay, dataDir, token;

// A NIP-98 proof of the shape the relay demands: bound to THIS host and to /config, signed by the church.
const proof = (sk) => finalizeEvent(
  { kind: 27235, created_at: now(), tags: [['u', BASE + '/config'], ['method', 'POST']], content: '' }, sk);

const selfRegister = (sk, pub, name) => fetch(BASE + '/config', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ addChurch: { npub: npubEncode(pub), name }, auth: proof(sk) }),
});

before(async () => {
  await requireFreePort(PORT, 'an-invited-church-is-not-told-it-was-refused.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-invite-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '2000' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/status'); if (r.ok) break; } catch {} await sleep(150); }
  token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;

  // The operator adds one church, then locks the relay — the exact configuration that produced the banner.
  const add = await fetch(BASE + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ addChurch: { npub: npubEncode(inPub), name: 'St Editha of the Test' } }),
  });
  assert.equal(add.status, 200, 'the operator could not add a church — the fixture is broken, not the code');
  const lock = await fetch(BASE + '/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ inviteOnly: true }),
  });
  assert.equal((await lock.json()).settings.inviteOnly, true, 'invite-only did not take — fixture broken');
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('THE FIX: a church the operator already added is not refused when it re-announces itself', async () => {
  const r = await selfRegister(inSk, inPub, 'St Editha of the Test');
  const body = await r.json().catch(() => ({}));
  assert.equal(r.status, 200,
    'the relay refused a church it is already hosting, with the same 403 it gives a stranger. The console ' +
    'cannot tell those apart, so it tells the steward that nothing they set up will save — on every tab, ' +
    'for ever, over a console whose writes are landing. Got: ' + JSON.stringify(body));
  assert.equal(body.ok, true);
});

test('CONTROL: invite-only still refuses a church nobody invited', async () => {
  const r = await selfRegister(outSk, outPub, 'Interloper Church');
  const body = await r.json().catch(() => ({}));
  assert.equal(r.status, 403,
    'the lock is gone — any stranger with a fresh keypair can now register on a relay whose operator ' +
    'deliberately closed it. This is the control that matters more than the fix.');
  assert.match(String(body.error || ''), /invite-only/);
});

test('CONTROL: an unproven caller cannot tell a hosted church from a stranger', async () => {
  // The leak this guards is a DIFFERENTIAL, not a status code: if naming a hosted npub answers differently
  // from naming an unhosted one, anyone who can guess an npub can enumerate the congregations on this box
  // without holding a single key. GET /config is admin-only precisely so that cannot be asked.
  // Found by this very test on 2026-09-04: the first cut of the invite-only fix let a hosted key fall
  // through to the proof check (401) while a stranger's was refused earlier (403).
  const unsigned = (pub) => fetch(BASE + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addChurch: { npub: npubEncode(pub), name: 'Whoever' } }),
  });
  const hosted = await unsigned(inPub);
  const stranger = await unsigned(outPub);
  const hostedBody = await hosted.json().catch(() => ({}));
  const strangerBody = await stranger.json().catch(() => ({}));
  assert.equal(hosted.status, stranger.status,
    `naming a church this relay HOSTS answered ${hosted.status} while a stranger's key answered ` +
    `${stranger.status}. That difference is readable by anyone, with no key and no proof, so it ` +
    'enumerates the congregations on this box one npub at a time.');
  assert.deepEqual(hostedBody, strangerBody,
    'same status, different body — the body leaks the same fact the status was stopped from leaking');
  assert.equal(hosted.status, 401, 'an unproven caller should be told only that it is unauthorised');
});

test('CONTROL: a hosted church still cannot register somebody ELSE', async () => {
  // Signed by the hosted church, but naming the stranger's key: ownsKey must still fail.
  const r = await fetch(BASE + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addChurch: { npub: npubEncode(outPub), name: 'Smuggled In' }, auth: proof(inSk) }),
  });
  // 401, not 403: the proof check now runs before any policy, and `ownsKey` (a.pubkey === hex) is what
  // refuses this — a stronger answer than the invite-only rule, and it holds on an OPEN relay too.
  assert.equal(r.status, 401,
    'a church already on the relay used its own valid proof to add a DIFFERENT key — self-registration ' +
    'must only ever add the signer\'s own church');
});

test('CONTROL: re-announcing does not let a church relabel a relay the operator locked', async () => {
  // The fix above lets an already-registered church through the invite-only gate. That must not become a
  // way to overwrite the name the OPERATOR chose — the row still reads `by: "operator"`, so a relabel here
  // is one party's name under another party's attribution. Measured on 2026-09-04: it did exactly that.
  const r = await selfRegister(inSk, inPub, 'RENAMED BY THE CHURCH');
  assert.equal(r.status, 200, 're-announcing must still succeed — that is the whole point of the fix');
  const cfg = await (await fetch(BASE + '/config', { headers: { 'Authorization': 'Bearer ' + token } })).json();
  const row = cfg.churches.find(c => c.name === 'RENAMED BY THE CHURCH');
  assert.equal(row, undefined,
    'a church renamed itself on a relay whose operator deliberately locked it, and the row still says ' +
    'by: "operator". It also re-opens the whole-corpus rehydrate loop on every differing re-announce.');
  assert.ok(cfg.churches.some(c => c.name === 'St Editha of the Test'),
    'the operator\'s chosen name is gone');
});
