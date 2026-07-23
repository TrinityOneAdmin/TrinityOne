// Relay config lifecycle — RELAY-AUDIT-2026-07-20 C2 / C3 / C4 / H1.
// Run: node --test scripts/relay-config.test.mjs
//
// These pin the operator-facing behaviour of /config, all four of which were reproduced as real failures:
//   C2  the save response echoed the REQUEST, so the dashboard reported success regardless of what took
//       effect — and CHURCH_NPUB was re-applied on every reload, so an env church could never be removed
//   C3  more than the cap silently DELETED the surplus and returned ok:true
//   C4  removing the last church turned the relay into an open write-anything relay, with a green tick
//   H1  a config change never re-hydrated the derived maps, so removals didn't take effect and ADDS locked
//       the church's own congregation out ("blocked: not a member") until a process restart the dashboard
//       does not offer
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8841;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const envSk = generateSecretKey(), envPub = getPublicKey(envSk);       // seeded via CHURCH_NPUB
const aSk = generateSecretKey(), aPub = getPublicKey(aSk);             // church A
const memSk = generateSecretKey(), memPub = getPublicKey(memSk);       // a member of church A

let relay, dataDir, token;
const api = (path, opts = {}) => fetch(`http://127.0.0.1:${PORT}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, ...(opts.headers || {}) } });
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(m[2]); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const memberDoc = (cp, sk) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + cp]], content: JSON.stringify({ name: 'Mem' }) }, sk);

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-cfg-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(envPub) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(150); }
  token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('C2: the save response reports the SERVER state, and an env-seeded church can be removed', async () => {
  const seeded = await (await api('/config')).json();
  assert.equal(seeded.churches.length, 1, 'CHURCH_NPUB should seed one church on a fresh data dir');

  const body = JSON.stringify({ churches: [{ npub: npubEncode(aPub), name: 'Church A' }] });
  const saved = await (await api('/config', { method: 'POST', body })).json();
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.churches.map(c => c.name), ['Church A'], 'response must be the server state, not the request echo');

  const truth = await (await api('/config')).json();
  assert.deepEqual(truth.churches.map(c => c.name), ['Church A'], 'the env church came back — removals do not stick');
});

test('C2: duplicates collapse and the response says so rather than echoing the request', async () => {
  const dup = npubEncode(aPub);
  const body = JSON.stringify({ churches: [{ npub: dup, name: 'First' }, { npub: dup, name: 'Second' }] });
  const r = await (await api('/config', { method: 'POST', body })).json();
  assert.equal(r.churches.length, 1, 'a duplicate npub must collapse in the response, as it does on disk');
  assert.match(String(r.note || ''), /collapsed/, 'the operator should be told the list differs from what they sent');
});

test('H1: re-adding a church un-locks its EXISTING congregation without a restart', async () => {
  // The scenario that mattered: the member's `member:` doc is already in SQLite, but the church is not in
  // CHURCH_PUBS when the relay boots — so hydrateMaps() skips it and MEMBER_DOCS is empty. Adding the church
  // back through the dashboard used to leave the whole congregation locked out ("blocked: not a member")
  // while the UI said "✓ Saved — members can join now". That is where you land after a restore, a box
  // migration, or undoing a mis-click. Reproduced properly here by RESTARTING the relay with the church
  // absent, which is the only way to get a cold map.
  let ws = await connect();
  assert.equal(await publish(ws, memberDoc(aPub, memSk)), true, 'member could not join a configured church');
  ws.close();
  await sleep(200);

  // drop church A, restart the relay (cold maps), then add A back
  const other = npubEncode(getPublicKey(generateSecretKey()));
  await api('/config', { method: 'POST', body: JSON.stringify({ churches: [{ npub: other, name: 'Other' }] }) });
  await sleep(300);
  relay.kill('SIGKILL'); await sleep(400);
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000' },   // no CHURCH_NPUB: church.json governs now
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(150); }

  await api('/config', { method: 'POST', body: JSON.stringify({ churches: [{ npub: other, name: 'Other' }, { npub: npubEncode(aPub), name: 'Church A' }] }) });
  await sleep(500);   // writeChurches defers hydrateMaps to setImmediate

  ws = await connect();
  const post = finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['p', aPub]], content: 'hello again' }, memSk);
  assert.equal(await publish(ws, post), true, 'an existing member was locked out after their church was re-added — derived maps not re-hydrated');
  ws.close();
});

test('H1: removing a church takes effect immediately — its ex-members can no longer write', async () => {
  // swap church A out for a different church; A's member must lose write access without a restart
  const other = getPublicKey(generateSecretKey());
  const body = JSON.stringify({ churches: [{ npub: npubEncode(other), name: 'Other' }] });
  await api('/config', { method: 'POST', body });
  await sleep(400);   // writeChurches defers hydrateMaps to setImmediate
  const ws = await connect();
  const post = finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['p', aPub]], content: 'should be refused' }, memSk);
  assert.equal(await publish(ws, post), false, 'an ex-member of a REMOVED church could still write — stale derived maps');
  ws.close();
});

test('C4: the last church cannot be removed (that would open the relay to the internet)', async () => {
  const r = await api('/config', { method: 'POST', body: JSON.stringify({ churches: [] }) });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /anyone on the internet/, 'emptying the list must be refused with a reason');
  const truth = await (await api('/config')).json();
  assert.equal(truth.churches.length > 0, true, 'the list was emptied anyway');
});

test('C3: over the cap is REFUSED, not silently truncated', async () => {
  const many = Array.from({ length: 201 }, () => ({ npub: npubEncode(getPublicKey(generateSecretKey())), name: 'x' }));
  const r = await api('/config', { method: 'POST', body: JSON.stringify({ churches: many }) });
  assert.equal(r.status, 400, 'over-cap saves must fail loudly — silently dropping the surplus de-provisions congregations');
  const j = await r.json();
  assert.match(j.error, /nothing was changed/);
});

test('H3: a removed church’s data can be previewed and then purged', async () => {
  // seed a second church with some data, then purge it
  const bSk = generateSecretKey(), bPub = getPublicKey(bSk);
  const cur = (await (await api('/config')).json()).churches;
  await api('/config', { method: 'POST', body: JSON.stringify({ churches: [...cur, { npub: npubEncode(bPub), name: 'Doomed' }] }) });
  await sleep(300);
  const ws = await connect();
  for (let i = 0; i < 3; i++) {
    await publish(ws, finalizeEvent({ kind: 30078, created_at: now() + i, tags: [['d', 'trinityone/group:g' + i]], content: '{"name":"g"}' }, bSk));
  }
  ws.close(); await sleep(250);

  // dry run must report a count and change NOTHING
  const dry = await (await api('/config', { method: 'POST', body: JSON.stringify({ removeChurch: { npub: npubEncode(bPub) } }) })).json();
  assert.equal(dry.dryRun, true);
  assert.equal(dry.wouldDelete.events >= 3, true, `expected >=3 events, got ${dry.wouldDelete.events}`);
  const stillThere = await (await api('/config')).json();
  assert.equal(stillThere.churches.some(c => c.name === 'Doomed'), true, 'a dry run must not remove the church');

  // the real thing
  const done = await (await api('/config', { method: 'POST', body: JSON.stringify({ removeChurch: { npub: npubEncode(bPub), purge: true } }) })).json();
  assert.equal(done.ok, true);
  assert.equal(done.purged.events >= 3, true, 'events were not deleted');
  assert.equal(done.churches.some(c => c.name === 'Doomed'), false, 'the church is still configured after a purge');

  const after = await (await api('/config', { method: 'POST', body: JSON.stringify({ removeChurch: { npub: npubEncode(bPub) } }) })).json();
  assert.equal(after.wouldDelete.events, 0, 'data survived the purge');
});

test('H3: purging the only church is refused (it would open the relay)', async () => {
  const cur = (await (await api('/config')).json()).churches;
  assert.equal(cur.length >= 1, true);
  if (cur.length === 1) {
    const r = await api('/config', { method: 'POST', body: JSON.stringify({ removeChurch: { npub: cur[0].npub, purge: true } }) });
    assert.equal(r.status, 400, 'purging the last church must be refused');
  }
});

// ---- H4 applied to /import + persistChurches provenance (Fable audit 2026-07-22, #10 / #11) ----
test('#10: /import cannot self-register a fresh church on a private relay (H4 bootstrap-only)', async () => {
  // guarantee the relay is past bootstrap (has a church) regardless of prior tests
  await api('/config', { method: 'POST', body: JSON.stringify({ addChurch: { npub: npubEncode(aPub), name: 'A' } }) });
  await sleep(80);
  const fSk = generateSecretKey(), fPub = getPublicKey(fSk);
  const host = `127.0.0.1:${PORT}`;
  // NIP-98 proof by the FRESH key, claiming itself as the church, bound to /import
  const proof = finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', `http://${host}/import`], ['method', 'POST'], ['church', fPub]], content: '' }, fSk);
  const auth = 'Nostr ' + Buffer.from(JSON.stringify(proof)).toString('base64');
  const r = await fetch(`http://${host}/import`, { method: 'POST', headers: { Authorization: auth }, body: 'x\n' });
  assert.equal(r.status, 403, 'a fresh church key must not self-register through /import on a private relay that already has a church');
  const cfg = await (await api('/config?stats=1')).json();
  assert.ok(!(cfg.churches || []).some(c => c.npub === npubEncode(fPub)), 'the refused fresh church must not have been registered');
});

test('#11: persistChurches stamps envMigrated so a removed env church cannot resurrect (structural)', () => {
  // The resurrection bug is a restart-scenario, disproportionate to reproduce in-process; assert the fix at
  // the source instead — persistChurches must write envMigrated (else loadChurches re-folds CHURCH_NPUB on
  // the next boot, bringing back a church the operator removed) and keep by/at provenance.
  const src = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
  const m = src.match(/function persistChurches\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, 'persistChurches must exist');
  assert.match(m[0], /envMigrated:\s*true/, 'persistChurches must stamp envMigrated:true');
  assert.match(m[0], /m\.by/, 'persistChurches must preserve by/at provenance from CHURCH_META');
});
