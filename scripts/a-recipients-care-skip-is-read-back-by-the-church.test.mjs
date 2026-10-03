// A RECIPIENT'S "I'M COVERED" MUST BE FOUND AGAIN BY THE READS THAT SHOW IT.
// Run: node --test scripts/a-recipients-care-skip-is-read-back-by-the-church.test.mjs
//
// Sim 2026-10-02, item 23: the recipient pressed "I'm covered", it showed, and after a restart the day was
// "Open" again — on the phone AND on the steward's console. The relay held the row.
//
// WHY. The member app signs a skip with a THROWAWAY key derived from the need's secret (markCareSkip), so the
// relay can verify "the recipient" without learning who they are. The relay accepted it (the token is right) and
// then filed it under church '' — resolveChurch() honours a ['church', cp] tag only for the church, a steward or
// a member, and a throwaway key is none of them. The two readers that show skips both ask by CHURCH COLUMN
// (`#church: [cp]` — the member's docs hub and the console's care subscription), so neither ever matched it.
// Asked by author or d-tag it WAS there, which is why it looked fine on the relay.
//
// HOW THIS TEST IS BUILT (CLAUDE.md rules 1 and 3):
//   • THE WRITER is the shipped markCareSkip, lifted from vendor/fellowship.js and run. Its event is what is
//     published — the real throwaway signer, the real skiptok.
//   • THE READER is the shipped _docsHubOpen, lifted and run with a pool that captures the filters it opens. Those
//     filters are what is sent to the relay. Nothing about the read is typed here.
//   • THE RELAY is the real gateway on a throwaway data dir and an isolated port.
//   • Over-tightening controls: a skip that names ANOTHER church's tag is not pulled into that church, and a
//     wrong token is still refused.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { fnBody } from './test-slice.mjs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8705;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const SHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), neighbour = K(), recipient = K(), reader = K(), neighbourReader = K();
const SECRET = 'ab'.repeat(32), ISO = '2026-10-10', CARE_ID = 'need-covered';
let relay, dataDir;

const spawnRelay = () => spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
  env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: `${npubEncode(church.pub)},${npubEncode(neighbour.pub)}`, RELAY_MAX_EVENTS: '5000' },
});
async function waitUp() { for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); } throw new Error('relay did not come up'); }
const connect = (who) => new Promise((res, rej) => {
  const w = new WebSocket(WS_URL);
  w.on('open', () => { w.on('message', (d) => { const m = JSON.parse(d);
    if (m[0] === 'AUTH' && who) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); }); res(w); });
  w.on('error', rej);
});
const publish = (w, evt) => new Promise((res) => { const on = (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); });
const read = (w, filters) => new Promise((res) => {
  const out = []; const id = 'r' + Math.random().toString(36).slice(2, 7);
  const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) setTimeout(() => { w.off('message', on); res(out); }, 250); };
  w.on('message', on); w.send(JSON.stringify(['REQ', id, ...filters])); setTimeout(() => { w.off('message', on); res(out); }, 4000);
});
const dOf = (e) => (e.tags.find((t) => t[0] === 'd') || [])[1] || '';
const doc = (k, d, content, extra) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ...extra], content }, k.sk);

// ── THE SHIPPED WRITER ──────────────────────────────────────────────────────────────────────────────────────────
async function shippedSkip(forChurch) {
  const published = [];
  const scope = {
    sk: recipient.sk, NET: 'trinityone', CARESKIP_D: 'trinityone/careskip:',
    window: { Fellowship: { churchPub: forChurch, ready: Promise.resolve() } },
    // the need's skipEnc is sealed to the recipient; sealing is not under test, so "decrypt" hands back the plaintext
    decrypt: (enc) => enc, getConversationKey: () => 'k',
    _sha256hex: async (u8) => sha(Buffer.from(u8).toString()),
    finalizeEvent2: finalizeEvent,
    _publishBounded: async (_r, e) => { published.push(e); return true; },
    publishSetFor: () => ['wss://relay.test/relay'],
    TextEncoder, crypto: globalThis.crypto, Uint8Array, JSON, Math, Date, String, console, Promise,
  };
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('markCareSkip needs a stub for ' + String(k)); } });
  const fn = new Function('scope', 'with (scope) { return ({ ' + fnBody(SHIP, 'async markCareSkip(careId, iso, reason, skipEnc, needAuthor)', 'markCareSkip') + ' }); }')(proxy).markCareSkip;
  await fn(CARE_ID, ISO, '', JSON.stringify({ s: SECRET }), church.pub);
  assert.equal(published.length, 1, 'the shipped markCareSkip published nothing');
  return published[0];
}

// ── THE SHIPPED READER: the filters _docsHubOpen opens for a church ──────────────────────────────────────────
function shippedHubFilters(cp) {
  let captured = null;
  const scope = {
    _hubSince: () => 0, NET: 'trinityone', relaysForChurch: () => [],
    pool: { subscribeMany: (_relays, filters) => { captured = filters; return { close() {} }; } },
    Math, Date, JSON, console,
  };
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('_docsHubOpen needs a stub for ' + String(k)); } });
  const open = new Function('scope', 'with (scope) { return (' + fnBody(SHIP, 'function _docsHubOpen(hub)', '_docsHubOpen') + '); }')(proxy);
  open({ cp, closer: null });
  assert.ok(Array.isArray(captured) && captured.length, 'the shipped hub opened no filters');
  return captured;
}

before(async () => {
  await requireFreePort(PORT, 'a-recipients-care-skip-is-read-back-by-the-church.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-skipread-'));
  relay = spawnRelay(); await waitUp();
  const w = await connect(null); const cw = await connect(church); const nw = await connect(neighbour);
  // the recipient's church membership is NOT needed for the skip — the throwaway signer is the point — but the readers are members
  for (const [who, cp] of [[reader, church.pub], [neighbourReader, neighbour.pub]]) assert.equal((await publish(w, doc(who, 'trinityone/member:' + cp, JSON.stringify({ joined: now() }), [['p', cp]])))[0], true);
  const hashTag = ['skiphash', ISO, sha(sha(SECRET + ':' + ISO))];
  assert.equal((await publish(cw, doc(church, 'trinityone/care:' + CARE_ID, JSON.stringify({ id: CARE_ID, type: 'meals', dates: [ISO] }), [['church', church.pub], ['p', church.pub], hashTag])))[0], true, 'the need could not be published');
  w.close(); cw.close(); nw.close();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const careSkips = (events) => events.filter((e) => dOf(e).startsWith('trinityone/careskip:'));

test('the shipped skip is signed by a throwaway key, not by the recipient', async () => {
  const evt = await shippedSkip(church.pub);
  assert.notEqual(evt.pubkey, recipient.pub, 'the skip carries the recipient key — the premise of this file (an anonymous signer) is gone');
  assert.ok(evt.tags.some((t) => t[0] === 'skiptok'), 'the skip carries no token');
});

test('THE POINT OF USE: the filters the shipped hub opens return the recipient\'s skip, for the church\'s members', async () => {
  const w = await connect(null);
  const evt = await shippedSkip(church.pub);
  assert.deepEqual(await publish(w, evt), [true, ''], 'the relay refused the genuine recipient\'s skip');
  await sleep(300);
  const filters = shippedHubFilters(church.pub);
  const rw = await connect(reader);
  const got = careSkips(await read(rw, filters));
  assert.equal(got.length, 1,
    'THE SKIP IS STORED AND NOBODY CAN READ IT. The relay acknowledged it, but a read by church column — the member hub\'s and ' +
    'the console\'s — does not return it, so the day is "Open" again as soon as the phone forgets its own copy.');
  assert.equal(got[0].id, evt.id);
  // …and the church itself (the console's read)
  const cw = await connect(church);
  assert.equal(careSkips(await read(cw, filters)).length, 1, 'the church\'s own console cannot see the skip');
  w.close(); rw.close(); cw.close();
});

test('it survives a relay restart', async () => {
  relay.kill('SIGTERM'); await sleep(1500);
  relay = spawnRelay(); await waitUp();
  const rw = await connect(reader);
  assert.equal(careSkips(await read(rw, shippedHubFilters(church.pub))).length, 1, 'the skip was lost across a relay restart');
  rw.close();
});

test('a skip filed before this fix (church column empty) is repaired when the relay next starts', async () => {
  relay.kill('SIGTERM'); await sleep(1500);
  const db = new DatabaseSync(join(dataDir, 'relay.sqlite'));
  const before = db.prepare("UPDATE events SET church = '' WHERE dtag LIKE 'trinityone/careskip:%'").run().changes;
  db.close();
  assert.ok(before >= 1, 'no skip row to age — the repair test would prove nothing');
  relay = spawnRelay(); await waitUp();
  const rw = await connect(reader);
  assert.equal(careSkips(await read(rw, shippedHubFilters(church.pub))).length, 1,
    'a skip stored by the old relay stays invisible: reattribute() at boot did not file it under its church');
  rw.close();
});

test('CONTROL: a skip with the WRONG token is still refused', async () => {
  const w = await connect(null);
  const k = K();
  const bad = doc(k, 'trinityone/careskip:' + CARE_ID + ':' + ISO, JSON.stringify({ careId: CARE_ID, isoDate: ISO }), [['church', church.pub], ['skiptok', sha('wrong')]]);
  assert.equal((await publish(w, bad))[0], false, 'a forged token was accepted');
  w.close();
});


test('CONTROL: a skip row already on disk with a WRONG token is not given a church at boot', async () => {
  // accept() keeps a forged skip out of a live relay, but rows also arrive by import and peer sync, and boot
  // re-files every row whose church is empty. The token must be re-checked THERE, or the tag alone files it.
  relay.kill('SIGTERM'); await sleep(1500);
  const k = K();
  const forged = doc(k, 'trinityone/careskip:' + CARE_ID + ':' + ISO, JSON.stringify({ careId: CARE_ID, isoDate: ISO }), [['church', church.pub], ['skiptok', sha('wrong')]]);
  const db = new DatabaseSync(join(dataDir, 'relay.sqlite'));
  db.prepare('INSERT OR REPLACE INTO events (id,pubkey,kind,created_at,dtag,church,repl,structured,raw) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(forged.id, forged.pubkey, forged.kind, forged.created_at, 'trinityone/careskip:' + CARE_ID + ':' + ISO, '', forged.pubkey + ':30078:trinityone/careskip:' + CARE_ID + ':' + ISO, 1, JSON.stringify(forged));
  db.close();
  relay = spawnRelay(); await waitUp();
  const rw = await connect(reader);
  const seen = careSkips(await read(rw, shippedHubFilters(church.pub)));
  assert.equal(seen.filter((e) => e.id === forged.id).length, 0,
    'a skip with an invalid token was filed under the church at boot, so the church now reads a forged "I\'m covered"');
  assert.ok(seen.length >= 1, 're-anchor: the genuine skip is no longer read either, so this control proves nothing');
  rw.close();
});

// LAST ON PURPOSE: this skip is signed by the same throwaway key at the same d-tag as the genuine one (the key is
// derived from the need's secret and the day), so it REPLACES it. Anything that needs the genuine skip still
// there has to run before this.
test('CONTROL: a skip that CLAIMS a neighbouring church is not pulled into that church', async () => {
  // Valid token for this church's need, but tagged with the neighbour's key. accept() lets it in (the token is the
  // proof); it must NOT be attributed to the neighbour — that would let anyone with a token inject a row into
  // another congregation's bucket and backup.
  const w = await connect(null);
  const forged = await shippedSkip(neighbour.pub);
  const [ok] = await publish(w, forged);
  await sleep(300);
  const nr = await connect(neighbourReader);
  const seen = careSkips(await read(nr, shippedHubFilters(neighbour.pub)));
  assert.equal(seen.filter((e) => e.id === forged.id).length, 0,
    `the neighbour's church read returned a skip that belongs to another church's need (relay said ok=${ok})`);
  w.close(); nr.close();
});
