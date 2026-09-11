// A RECORD PUBLISHED WHILE A PARENT IS ALREADY WATCHING MUST REACH HER, WITHOUT HER TOUCHING ANYTHING.
//   Run: node --test scripts/a-parents-open-screen-is-told-live.test.mjs
//
// ⚠ THE GAP THIS FILE FILLS. Every check-in read test in this repo asks the relay a question and reads the
// answer — REQ, collect, close. Not one of them had a subscription ALREADY OPEN when the record was written.
// That is the entire difference between the feature working and the blocking defect measured on two phones on
// 2026-09-11 (reference/DEVICE-VERIFICATION-two-phone-2026-09-11.md): the parent's phone showed the FIRST
// child correctly after a cold start — so its REQ-time path was perfect — and a second child checked in
// eight seconds later never appeared at all. A parent stands at a door with this screen. "Correct if you
// restart the app" is not the feature.
//
// So this file opens the socket the app opens, with the FILTERS THE APP SENDS, leaves it open, and only then
// writes the record. The assertion is arrival: did the relay push it, unasked, to a subscription that was
// already listening.
//
// ── WHAT THIS COVERS AND WHAT IT CANNOT ──────────────────────────────────────────────────────────────────
// It covers relay → socket: the live fanout at gateway.mjs's EVENT branch, which re-runs canRead per event
// against that client's CURRENT auth. It does NOT cover the phone above the socket — nostr-tools' pool, the
// church-docs hub, or the React effect (that half is pinned by
// scripts/a-locked-boot-still-subscribes-when-it-unlocks.test.mjs). If this file is green and a phone is
// still blind, the fault is above the socket, and that is exactly the split the device round could not make.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE, checkinGuardianCopies } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8914;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();
const ada = K();      // the cleared worker who writes the record
const gina = K();     // the parent watching her own screen
const hank = K();     // another family's parent, watching too — she must be told NOTHING
const SESSION = 'svc-live', SESSION_KEY = '11'.repeat(32);

let relay, dataDir, w;
const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);

// THE SUBSCRIPTION THE APP ACTUALLY OPENS. Both filters, verbatim from _docsHubOpen in
// src/fellowship.src.js — a church-authored half and a member-authored half, both pinned to ['t']. The
// check-in record is written by a WORKER, so only the second filter can ever match it, and getting that
// wrong here would make this file assert nothing.
const HUB_FILTERS = (cp) => [
  { kinds: [30078], authors: [cp], '#t': [NET] },
  { kinds: [30078], '#church': [cp], '#t': [NET] },
];

// Open a socket, authenticate it, subscribe with the app's filters, and keep it open. Returns a live
// collector: `.seen` grows as the relay pushes. This is the part no other test in this repo does.
async function watching(who) {
  const s = await conn();
  const seen = [];
  const sub = 'hub' + Math.random().toString(36).slice(2, 7);
  s.on('message', d => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH') s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
      tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
    else if (m[0] === 'EVENT' && m[1] === sub) seen.push(m[2]);
  });
  // A warm REQ first, exactly as the app's own socket does: the relay's AUTH challenge is lazy, so a
  // subscription opened before authentication would be measuring an anonymous reader and would pass or fail
  // for the wrong reason. Wait until this phone is genuinely authed, then open the real one.
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  await sleep(400);
  s.send(JSON.stringify(['REQ', sub, ...HUB_FILTERS(church.pub)]));
  await sleep(300);
  seen.length = 0;   // drop the backlog: only what arrives AFTER this line is a live delivery
  return { s, seen, close: () => { try { s.close(); } catch {} } };
}

// A check-in record with the tags the relay's gates key on and one guardian copy per parent named.
function record(id, guardians) {
  const body = { id, child: 'kid-' + id, childName: 'Child ' + id, date: '2026-09-13', in: now(), code: '4821',
                 session: SESSION, guardians: guardians.map(g => g.pub) };
  // The SHARED builder, the same one both shipped writers call — it reads `body.guardians` itself and seals
  // one copy per parent, so a fixture here cannot disagree with what a phone would actually receive.
  const gk = checkinGuardianCopies(body, (plain, gp) => nip44.encrypt(plain, nip44.utils.getConversationKey(ada.sk, gp)));
  return finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKIN + id], ['t', NET], ['church', church.pub], ['session', SESSION], ['enc', '2'],
           ...guardians.map(g => ['p', g.pub]), ...gk],
    content: nip44.encrypt(JSON.stringify(body), nip44.utils.getConversationKey(ada.sk, church.pub)) }, ada.sk);
}

before(async () => {
  await requireFreePort(PORT, 'a-parents-open-screen-is-told-live.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-cklive-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  w = await conn();
  for (const who of [ada, gina, hank]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await send(w, doc(church, D.STEWARDS + church.pub, { pubkeys: [], caps: {} }));
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: {} }));
  await send(w, finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINPERM + ada.pub], ['t', NET], ['church', church.pub], ['person', ada.pub]],
    content: JSON.stringify(buildCheckinPermission({ person: ada.pub, source: 'steward', lifetime: 'open',
      from: now() - 86400, until: null })) }, church.sk));
  const t = now();
  const { doc: env } = buildHelperGrant({ session: SESSION, source: GRANT_SOURCE, lifetime: 'session',
    from: t - 600, until: t + 3600, helpers: [ada.pub], keepers: [church.pub], sessionKeyHex: SESSION_KEY,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)) });
  await send(w, finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINHELPER + SESSION], ['t', NET], ['church', church.pub], ['session', SESSION]],
    content: JSON.stringify(env) }, church.sk));
  await sleep(300);
});
after(() => { try { w && w.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('THE DEFECT MEASURED ON TWO PHONES: a child checked in while the screen is open reaches it', async () => {
  const parent = await watching(gina);
  const ev = record('live1', [gina]);
  const [ok, msg] = await send(w, ev);
  assert.equal(ok, true, 'the relay refused the record: ' + msg);
  await sleep(600);
  parent.close();
  const ids = parent.seen.map(e => e.id);
  assert.ok(ids.includes(ev.id),
    'A PARENT WATCHING HER OWN SCREEN WAS NEVER TOLD HER CHILD WAS CHECKED IN. The relay stored the record ' +
    'and pushed nothing to a subscription that was already open and already authenticated. She would stand ' +
    'at the door with an empty screen until she killed the app — the 2026-09-11 two-phone blocker, at the ' +
    'socket. Live events seen: ' + JSON.stringify(parent.seen.map(e => (e.tags.find(t => t[0] === 'd') || [])[1])));
});

test('…and a SECOND child, on the same open socket — the exact step the phones failed at', async () => {
  const parent = await watching(gina);
  const first = record('live2a', [gina]);
  await send(w, first);
  await sleep(400);
  const second = record('live2b', [gina]);
  const [ok] = await send(w, second);
  assert.equal(ok, true);
  await sleep(600);
  parent.close();
  const ids = parent.seen.map(e => e.id);
  assert.ok(ids.includes(first.id), 're-anchor: even the first record did not arrive live, so the second proves nothing');
  assert.ok(ids.includes(second.id),
    'THE FIRST CHILD ARRIVED LIVE AND THE SECOND DID NOT — step 3 of the two-phone round, reproduced. A ' +
    'subscription that has delivered once has gone deaf.');
});

test('the live push is NOT a broadcast: another family\'s parent is told nothing', async () => {
  const mine = await watching(gina);
  const theirs = await watching(hank);
  const ev = record('live3', [gina]);
  await send(w, ev);
  await sleep(600);
  mine.close(); theirs.close();
  assert.ok(mine.seen.map(e => e.id).includes(ev.id), 're-anchor: the named guardian was not served it either');
  assert.equal(theirs.seen.filter(e => e.id === ev.id).length, 0,
    'ANOTHER FAMILY\'S PARENT WAS PUSHED THIS CHILD\'S RECORD. The live fanout re-runs canRead per event ' +
    'per client; if it stops doing that, every parent in the church learns every child\'s movements.');
});

test('an unauthenticated socket is pushed nothing, however long it waits', async () => {
  const s = await conn();
  const seen = [];
  s.on('message', d => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === 'anon') seen.push(m[2]); });
  s.send(JSON.stringify(['REQ', 'anon', ...HUB_FILTERS(church.pub)]));   // no AUTH reply, ever
  await sleep(400);
  seen.length = 0;
  const ev = record('live4', [gina]);
  await send(w, ev);
  await sleep(600);
  try { s.close(); } catch {}
  assert.equal(seen.filter(e => e.id === ev.id).length, 0,
    'A SOCKET THAT NEVER AUTHENTICATED WAS PUSHED A CHILD\'S CHECK-IN RECORD live. Anyone who can reach the ' +
    'relay would learn which children are in the building.');
});
