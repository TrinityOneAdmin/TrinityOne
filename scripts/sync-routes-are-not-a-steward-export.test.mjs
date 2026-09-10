// /sync IS RELAY-TO-RELAY INFRASTRUCTURE, NOT A SECOND /export WITH A LOOSER GATE.
// Run: node --test scripts/sync-routes-are-not-a-steward-export.test.mjs
//
// RED TEAM 2026-09-10, F2. `_exportAuth` was narrowed to OWNER-ONLY and the reason is written on it: "It was
// reachable by any steward holding any one capability, so a content-scoped rota helper could take the lot,
// including minors: and guardians:." `_syncAuth` still ended `|| stewardCan(ev.pubkey, cp, 'any')` and
// `/sync?church=<cp>&since=0` streams `exportChurchSince(cp, 0)` — the same whole corpus. Measured on a live
// relay as a steward the church had ticked for FINANCE ONLY: `/export` → 401, `/sync` → 200 with `minors:`
// and `guardians:` in the stream in cleartext. The same leak, closed on one route and left open on its
// neighbour.
//
// THE ARGUMENT THE ROUTE MAKES IS TRUE OF A RELAY AND NOT OF A STEWARD. "A trusted relay re-enforces the
// read-gate" is why a full-corpus stream is safe to hand a peer BOX: it lands behind another copy of the same
// gate. A steward's phone is an endpoint — nothing re-enforces anything once the stream arrives.
//
// SIX ROUTES, ONE GATE, so all six are driven here: /sync, /sync-media, /sync-blob/<sha>, /sync-digest,
// /sync-ids and /sync-events. Each is asked FOUR times in the same run, and the two 200s are what make the
// two 401s mean anything:
//
//   • the CHURCH KEY                → 200. The route is alive and the corpus is there to be taken.
//   • a TRUSTED PEER RELAY          → 200. The legitimate user of these routes still works. Without this row
//     the fix could have closed the door on relay-to-relay replication and every 401 below would still pass.
//   • a FINANCE-ONLY steward        → 401. The finding.
//   • a SAFEGUARDING steward        → 401. Because the old branch asked `'any'`, so this is the same hole
//     wearing the capability that sounds most entitled to it.
//   • an ORDINARY MEMBER            → 401. The control that was already correct.
//
// AND THE LEAK ITSELF IS ASSERTED, not inferred from a status code: the church's own pull is checked to
// CONTAIN minors: and guardians: in cleartext, so "the steward got 401" is a refusal of something real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8911;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const HOST = `127.0.0.1:${PORT}`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();
const treasurer = K();    // ticked for FINANCE only — the August leak, in person
const sgLead = K();       // ticked for SAFEGUARDING — the old gate asked 'any', so this is the same hole
const carl = K();         // an ordinary member: the control that was already right
const peer = K();         // a RELAY the church authorised in its trinityone/relays doc. The legitimate caller.
const kid = K(), mum = K();

const BLOB = Buffer.from('a tiny church asset, so /sync-blob has something real to refuse');
const SHA = createHash('sha256').update(BLOB).digest('hex');

let relay, dataDir, w;
const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
const doc = (who, d, content, extra = []) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra],
  content: typeof content === 'string' ? content : JSON.stringify(content),
}, who.sk);
// NIP-98, exactly the shape relayProof() mints — same kind, same tags, same church binding. What differs
// between the rows below is only WHICH KEY SIGNS, which is the whole question.
const nip98 = (who, path, method = 'GET') => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 27235, created_at: now(), tags: [['u', `http://${HOST}${path}`], ['method', method], ['church', church.pub]], content: '',
}, who.sk))).toString('base64');
// `path` is the URL path the proof binds to; `qs` the query the request carries (the gate binds the proof to
// the PATH only, so they are passed separately rather than fudged into one string).
const ask = async (who, path, qs = '', method = 'GET', body = null) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}${qs}`, {
    method, headers: { Authorization: nip98(who, path, method) }, ...(body ? { body } : {}),
  });
  return [r.status, await r.text()];
};

// The six routes, as (name, path, query, method, body). One list, so a route cannot be quietly left out of
// the matrix — every test below iterates it.
const ROUTES = [
  ['/sync', '/sync', `?church=${church.pub}&since=0`, 'GET', null],
  ['/sync-media', '/sync-media', `?church=${church.pub}`, 'GET', null],
  ['/sync-blob', '/sync-blob/' + SHA, `?church=${church.pub}`, 'GET', null],
  ['/sync-digest', '/sync-digest', `?church=${church.pub}`, 'GET', null],
  ['/sync-ids', '/sync-ids', `?church=${church.pub}&bucket=00`, 'GET', null],
  ['/sync-events', '/sync-events', '', 'POST', JSON.stringify({ ids: [] })],
];

async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error('the gateway never came up on ' + PORT);
}

before(async () => {
  await requireFreePort(PORT, 'sync-routes-are-not-a-steward-export.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-syncauth-'));
  await boot();
  w = await conn();
  for (const who of [treasurer, sgLead, carl, kid, mum]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await send(w, doc(church, D.STEWARDS + church.pub, {
    pubkeys: [treasurer.pub, sgLead.pub],
    caps: { [treasurer.pub]: ['finance'], [sgLead.pub]: ['safeguarding'] },
  }));
  // The safeguarding lists the finding is about — the whole reason /export is owner-only.
  await send(w, doc(church, D.MINORS + church.pub, { pubkeys: [kid.pub] }));
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: { [kid.pub]: [mum.pub] } }));
  // The church authorises `peer` as trusted relay infrastructure. This is the row that keeps the fix honest.
  await send(w, doc(church, D.RELAYS, [{ pubkey: peer.pub, url: 'ws://127.0.0.1:9/relay' }]));
  await sleep(300);
  // A real blob, so /sync-blob has something to serve rather than 401-ing for want of a file.
  const up = await fetch(`http://127.0.0.1:${PORT}/blob`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      Authorization: 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
        kind: 24242, created_at: now(),
        tags: [['t', 'upload'], ['expiration', String(now() + 600)], ['church', church.pub], ['x', SHA]], content: '',
      }, church.sk))).toString('base64'),
    },
    body: BLOB,
  });
  assert.equal(up.ok, true, 'the church could not upload a blob, so /sync-blob cannot be tested for a real refusal');
  await sleep(250);
});
after(async () => {
  try { w.close(); } catch {}
  try { relay.kill('SIGKILL'); } catch {}
  await sleep(300);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('BASELINE: the church key is served all six routes, and its /sync really does carry the safeguarding lists', async () => {
  for (const [name, path, qs, method, body] of ROUTES) {
    const [status] = await ask(church, path, qs, method, body);
    assert.equal(status, 200, `${name} refused the CHURCH'S OWN KEY — every refusal in this file would be vacuous`);
  }
  const [, stream] = await ask(church, '/sync', `?church=${church.pub}&since=0`, 'GET', null);
  const lines = stream.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const dOf = e => ((e.tags || []).find(t => t[0] === 'd') || [])[1] || '';
  const minors = lines.find(e => dOf(e) === D.MINORS + church.pub);
  const guardians = lines.find(e => dOf(e) === D.GUARDIANS + church.pub);
  assert.ok(minors, '/sync did not stream minors: at all — the finding is about that document being in this stream');
  assert.ok(guardians, '/sync did not stream guardians: at all');
  assert.match(minors.content, new RegExp(kid.pub), 'minors: is in the stream but not in cleartext — the leak this file guards is a CLEARTEXT one');
  assert.match(guardians.content, new RegExp(mum.pub), 'guardians: is in the stream but not in cleartext');
});

test('BASELINE: a relay the church authorised is still served all six routes', async () => {
  // The legitimate user of these routes. syncChurchFromPeer / reconcileChurchWithPeer / syncMediaFromPeer all
  // sign with RELAY_SK and are admitted here; if this row went red, the fix would have broken replication and
  // the refusals below would be measuring a closed door rather than a narrowed one.
  for (const [name, path, qs, method, body] of ROUTES) {
    const [status] = await ask(peer, path, qs, method, body);
    assert.equal(status, 200, `${name} refused a relay the church AUTHORISED — relay-to-relay replication is broken`);
  }
});

test('THE FINDING: a FINANCE-ONLY steward is refused all six sync routes', async () => {
  for (const [name, path, qs, method, body] of ROUTES) {
    const [status, text] = await ask(treasurer, path, qs, method, body);
    assert.equal(status, 401, `RED TEAM F2: ${name} served a Finance-only steward the church's corpus (${text.slice(0, 120)})`);
  }
  // And the same steward is still refused /export, which was never wrong — asserted so a future change that
  // loosens _exportAuth to "fix" the pair cannot pass this file.
  const [ex] = await ask(treasurer, '/export', `?church=${church.pub}`, 'GET', null);
  assert.equal(ex, 401, '/export is owner-only and served a Finance-only steward');
});

test('…and so is a SAFEGUARDING steward, because the old branch asked for `any` capability', async () => {
  for (const [name, path, qs, method, body] of ROUTES) {
    const [status] = await ask(sgLead, path, qs, method, body);
    assert.equal(status, 401, `${name} served a safeguarding steward the whole corpus over HTTP — a capability is not the church`);
  }
});

test('CONTROL: an ordinary member is refused all six, as they always were', async () => {
  for (const [name, path, qs, method, body] of ROUTES) {
    const [status] = await ask(carl, path, qs, method, body);
    assert.equal(status, 401, `${name} served an ordinary member the church's corpus`);
  }
});
