// TEST B — A RELAY THAT DOES NOT HOST THE CHURCH REFUSES THE CHURCH'S WRITES.
//   Run: node --test scripts/relay-set-write-refused-when-church-not-hosted.test.mjs
//
// VERIFICATION OF A DIAGNOSED MECHANISM, not a fix. Write-side twin of roster-read-gate-needs-a-genuine-settled-read.test.mjs.
//
// SHARED ROOT (the point of the pair): the console's relay SET contains a relay that does not serve the church.
//   · READ side  — that relay never gives a genuine, authenticated, settled answer for the church, so the token
//                  never goes fresh and rosterReadyFrom holds the screens on "Checking…" (Test A).
//   · WRITE side — that same relay refuses the church's own, validly signed writes with
//                  "blocked: not a member or not permitted for this group" (this file), which is the text behind the
//                  "a relay refused 'people must be approved'" banner and the key-write refusals.
//   Register the church on the relay and the SAME bytes are accepted: the difference is hosting, not the event.
//
// Real relay (scripts/gateway.mjs) in a throwaway TRINITY_DATA_DIR with NO church registered, a fresh disposable
// church key, NIP-42 AUTH answered as the church, then registration through POST /config { addChurch } with the
// admin token (the same door a-blocklist-held-by-one-of-two-relays.test.mjs uses). Nothing here is mocked on the
// relay side. Pattern: a-blocked-reader-gets-nothing-private.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8746;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const key = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = key();                        // disposable — never a real church
let relay = null, dataDir = null, w = null, adminToken = '';

const doc = (who, d, content) => finalizeEvent({ kind: 30078, created_at: now(), content: JSON.stringify(content), tags: [['d', d], ['t', 'trinityone']] }, who.sk);
const conn = () => new Promise((res, rej) => {
  const s = new WebSocket(WS_URL, { headers: { Host: `127.0.0.1:${PORT}` } });
  // answer NIP-42 as the church whenever the relay challenges, so a refusal is NOT "you did not log in"
  s.on('message', (d) => { let m; try { m = JSON.parse(d); } catch { return; } if (m[0] === 'AUTH') s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, church.sk)])); });
  s.on('open', () => res(s)); s.on('error', rej);
});
const publish = (s, e) => new Promise((res) => {
  const on = (m) => { const a = JSON.parse(m); if (a[0] === 'OK' && a[1] === e.id) { s.off('message', on); res({ ok: a[2], why: a[3] || '' }); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { s.off('message', on); res({ ok: null, why: 'no answer in 8s' }); }, 8000);
});

before(async () => {
  await requireFreePort(PORT, 'relay-set-write-refused-when-church-not-hosted.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-unhosted-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: '', TRINITY_TAILSCALE_BIN: '/nonexistent' },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  adminToken = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  w = await conn();
  await sleep(300);   // let the challenge/AUTH round trip finish
});
after(async () => {
  try { w && w.close(); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  await sleep(200);
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

const JOIN = () => doc(church, D.JOINPOLICY + church.pub, { approval: true });
const KEY = () => doc(church, D.NAMEKEY + church.pub, { rev: 1, keys: {} });

test('CONTROL: the relay really has no church registered (so the refusals below are about hosting)', async () => {
  const cfg = await (await fetch(`http://127.0.0.1:${PORT}/config`, { headers: { Authorization: 'Bearer ' + adminToken } })).json();
  assert.equal(cfg.configured, false);
  assert.deepEqual(cfg.churches, []);
});

test('UNHOSTED: the church\'s own signed join-policy and key documents are REFUSED ("not a member or not permitted")', async () => {
  for (const [what, ev] of [['the join policy', JOIN()], ['a name-key envelope', KEY()]]) {
    const r = await publish(w, ev);
    assert.equal(r.ok, false, what + ' was ACCEPTED by a relay that does not host the church (' + r.why + ')');
    assert.match(r.why, /not a member or not permitted/i, 'refused, but not for the hosting reason: ' + r.why);
  }
});

test('HOSTED: register the church (POST /config addChurch) and the SAME documents are ACCEPTED', async () => {
  const reg = await fetch(`http://127.0.0.1:${PORT}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
    body: JSON.stringify({ addChurch: { npub: npubEncode(church.pub), name: 'Disposable Church' } }) });
  assert.equal(reg.status, 200, 'registration failed: ' + (await reg.text()));
  await sleep(1200);   // the relay rehydrates its maps after a config change
  w.close(); w = await conn(); await sleep(300);
  for (const [what, ev] of [['the join policy', JOIN()], ['a name-key envelope', KEY()]]) {
    await sleep(1100);   // created_at is whole seconds; a same-second replacement of the same d-tag is not newer
    const r = await publish(w, ev);
    assert.equal(r.ok, true, what + ' was still refused after the church was registered (' + r.why + ')');
  }
});
