// A DELEGATED STEWARD SHOULD BE ABLE TO HOLD *SOME* OF A CHURCH'S KEYS, NOT ALL OF THEM.
// Run: node --test scripts/relay-steward-caps.test.mjs
//
// The pilot church has four elders and they all need access. Copying the church key four times would be the
// worst possible answer — four devices with full, irreversible authority over every sealed name in the
// congregation — so delegation is the mechanism. But the steward roster was a flat list of pubkeys and the
// relay's check was binary: a steward could do everything a steward can do. A church that wanted its
// treasurer on Finance and nobody else had no way to say so, and hiding the buttons would have been theatre:
// the delegate could do the hidden thing from any other client, because the RELAY is what actually decides.
//
// So the roster may now carry `caps` beside `pubkeys`, and the relay enforces it — on writes AND on reads,
// because a Finance restriction that still serves the ledger is decoration.
//
// COMPATIBILITY IS THE PART THAT MUST NOT BREAK. Every roster in the field today has no `caps` at all. If
// upgrading a relay stripped those delegates of their powers, this "security improvement" would take working
// churches offline — so no caps, or a steward absent from caps, means exactly what it means today: all of
// them. Saying "nothing" takes an explicit empty list.
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

const PORT = 8991;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const STEWARDS_D = 'trinityone/stewards:', CARETEAM_D = 'trinityone/careteam:', JOINPOLICY_D = 'trinityone/joinpolicy:';
const GROUP_D = 'trinityone/group:', MINORS_D = 'trinityone/minors:', FIN_D = 'finance/journal:';
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();
const treasurer = K();   // caps: ['finance']
const pastoral = K();    // caps: ['care']
const legacy = K();      // absent from caps → everything, exactly as today
const revoked = K();     // caps: [] → nothing
const safeguard = K();   // caps: ['safeguarding']
const cp = church.pub;
let relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('relay never came up');
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res({ ok: m[2], why: m[3] || '' }); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});
// read with NIP-42: the interesting reads are all auth-gated, so an unauthenticated empty answer would
// prove nothing at all.
function readAuthed(ws, subId, filter, who, window = 700) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]] , content: '' }, who.sk)]));
    };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}

// STRICTLY NEWER EACH TIME. A replaceable event ties on created_at and NIP-01 breaks the tie by event id, so
// two rosters published inside one second are a coin flip — the second was refused as "a newer version is
// already stored" and the capabilities never landed, which read exactly like the relay ignoring them.
let rosterAt = now();
const roster = (caps) => finalizeEvent({ kind: 30078, created_at: ++rosterAt, tags: [['d', STEWARDS_D + cp], ['t', NET]],
  content: JSON.stringify(caps === null ? { pubkeys: [treasurer.pub, pastoral.pub, legacy.pub, revoked.pub, safeguard.pub] }
    : { pubkeys: [treasurer.pub, pastoral.pub, legacy.pub, revoked.pub, safeguard.pub], caps }) }, church.sk);

const careTeam  = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', CARETEAM_D + cp], ['t', NET]], content: JSON.stringify({ pubs: [church.pub] }) }, who.sk);
const joinPol   = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', JOINPOLICY_D + cp], ['t', NET]], content: JSON.stringify({ approval: true }) }, who.sk);
const group     = (who, id) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GROUP_D + cp.slice(0, 16) + '-' + id], ['t', NET], ['church', cp]], content: JSON.stringify({ name: 'Test ' + id, kind: 'group' }) }, who.sk);
const minors    = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MINORS_D + cp], ['t', NET]], content: JSON.stringify({ pubkeys: [] }) }, who.sk);
// The finance journal is append-only and the relay demands EXACTLY the next sequence number, so a refused
// write must not advance the counter — otherwise the next legitimate entry is rejected for a gap and reads
// as a lost capability. Only success moves it.
let finAccepted = 0;
const finance = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', FIN_D + (finAccepted + 1)], ['t', NET], ['church', cp]], content: 'sealed' }, who.sk);
const putFinance = async (ws, who) => { const r = await publish(ws, finance(who)); if (r.ok) finAccepted++; return r; };

before(async () => {
  await requireFreePort(PORT, 'relay-steward-caps.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-caps-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore',
  });
  await waitReady();
});
after(() => { try { relay.kill(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the relay is carrying this church at all', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/status`);
  assert.ok(r.ok, 'the relay never came up, so nothing below proves anything');
});

test('a roster with NO caps leaves every steward exactly as powerful as today', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, roster(null))).ok, true, 'the church could not publish its own roster');
  await new Promise(r => setTimeout(r, 120));
  assert.equal((await publish(ws, careTeam(treasurer))).ok, true,
    'a roster written before capabilities existed has just stripped a working delegate of their powers. ' +
    'Upgrading a relay would take real churches offline.');
  assert.equal((await putFinance(ws, pastoral)).ok, true, 'same, for the other delegate');
  ws.close();
});

test('with caps, a treasurer may write Finance and NOT Care', async () => {
  const ws = await connect();
  const put = await publish(ws, roster({ [treasurer.pub]: ['finance'], [pastoral.pub]: ['care'], [revoked.pub]: [], [safeguard.pub]: ['safeguarding'] }));
  assert.equal(put.ok, true, 'the capability roster itself was refused: ' + put.why);
  await new Promise(r => setTimeout(r, 120));
  assert.equal((await putFinance(ws, treasurer)).ok, true, 'the treasurer cannot write the church books');
  const care = await publish(ws, careTeam(treasurer));
  assert.equal(care.ok, false,
    'a steward given Finance alone rewrote the care team. Scoping a delegate would then be a promise the ' +
    'relay does not keep, and the console would be hiding buttons that still work from any other client.');
  ws.close();
});

test('and the pastoral steward is the mirror image', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, careTeam(pastoral))).ok, true, 'the care lead cannot write the care team');
  assert.equal((await putFinance(ws, pastoral)).ok, false, 'a steward given Care alone wrote the ledger');
  ws.close();
});

test('a steward absent from caps keeps everything (the church has not scoped them)', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, careTeam(legacy))).ok, true, 'an unscoped steward lost Care');
  assert.equal((await putFinance(ws, legacy)).ok, true, 'an unscoped steward lost Finance');
  assert.equal((await publish(ws, joinPol(legacy))).ok, true, 'an unscoped steward lost member admission');
  ws.close();
});

test('an EXPLICIT empty list means nothing at all', async () => {
  const ws = await connect();
  for (const [what, evt] of [['care team', careTeam(revoked)], ['finance', finance(revoked)],
                             ['join policy', joinPol(revoked)], ['a group', group(revoked, 'x')]]) {
    assert.equal((await publish(ws, evt)).ok, false, `a steward with an empty capability list wrote ${what}`);
  }
  ws.close();
});

test('capabilities gate READS too — a Finance-only steward is not served the minors list', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, minors(church))).ok, true, 're-anchor: the church cannot publish its own minors list');
  await new Promise(r => setTimeout(r, 150));

  const asSafeguard = await connect();
  const seen = await readAuthed(asSafeguard, 'sg', { kinds: [30078], '#d': [MINORS_D + cp] }, safeguard);
  assert.equal(seen.length, 1,
    'the steward the church PUT on safeguarding cannot read the safeguarding list, so the capability grants nothing');
  asSafeguard.close();

  const asTreasurer = await connect();
  const denied = await readAuthed(asTreasurer, 'tr', { kinds: [30078], '#d': [MINORS_D + cp] }, treasurer);
  assert.equal(denied.length, 0,
    'a Finance-only steward was served the list of which children are in this congregation. A restriction ' +
    'that still hands over the document is decoration.');
  asTreasurer.close();
  ws.close();
});

test('NOTHING still asks the old binary question', () => {
  // The sweep touched 48 call sites. A site left on the old check keeps FULL steward authority — it fails
  // OPEN, silently, and no capability test would notice because that document simply carries on working.
  // So the old name is gone entirely: a missed site is a ReferenceError at startup, not a quiet grant.
  const src = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(src, /\bstewardOf\s*\(/,
    'a call site still asks stewardOf() — that document is delegated to EVERY steward regardless of the ' +
    'capabilities their church wrote, and nothing else here would catch it');
  assert.match(src, /const stewardCan = \(pub, cp, cap\)/, 're-anchor: the capability check has been renamed');
});
