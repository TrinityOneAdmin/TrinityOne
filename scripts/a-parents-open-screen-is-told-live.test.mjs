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
// against that client's CURRENT auth, under the filters the app really sends — `since` included.
//
// IT DOES NOT COVER the phone above the socket: nostr-tools' pool, the church-docs hub, the reader, or the
// React effect (that last is pinned by scripts/a-locked-boot-still-subscribes-when-it-unlocks.test.mjs).
// Nor does it cover a church on MORE THAN ONE relay: `_publishAny` writes to all of `relaysForChurch`, and
// one box accepting while another refuses is a topology this single-relay harness cannot produce.
//
// So the honest reading is narrow: the fanout loop itself is correct, and the last test below marks the one
// state where a correct loop still delivers nothing. "The relay is excluded" would be too strong.
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

const PORT = 8914;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs — scripts/test-ports.test.mjs enforces BOTH since 2026-09-11 (it read only *.test.mjs before, so that comment was an honour-system claim wherever it appeared)
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

// THE SUBSCRIPTION THE APP ACTUALLY OPENS. Both filters verbatim from `_docsHubOpen` in
// src/fellowship.src.js — a church-authored half and a member-authored half, both pinned to ['t']. The
// check-in record is written by a WORKER, so only the second filter can ever match it, and getting that
// wrong here would make this file assert nothing.
//
// ⚠ `since` IS PART OF WHAT THE APP SENDS AND AN EARLIER VERSION OF THIS FILE OMITTED IT — which made the
// harness measure a first-ever open and call the result "the relay is excluded". `_docsHubOpen` does
// `if (since) for (const f of filters) f.since = since`, where `_hubSince()` returns
// `hub.since - SINCE_SLOP` (3 days) on every open EXCEPT the at-most-daily full re-sync. A returning phone —
// the state both phones in the 2026-09-11 round were in — always carries it. It is load-bearing at the
// relay: gateway.mjs pushes on `matchAny(evt, filters)`, and matchFilter drops anything older than `since`.
const HUB_FILTERS = (cp, since = 0) => {
  const f = [
    { kinds: [30078], authors: [cp], '#t': [NET] },
    { kinds: [30078], '#church': [cp], '#t': [NET] },
  ];
  if (since) for (const x of f) x.since = since;
  return f;
};
const APP_SINCE = () => now() - 3 * 86400;   // what a warm hub sends: its cursor less SINCE_SLOP

// Open a socket, authenticate it, subscribe with the app's filters, and keep it open. Returns a live
// collector: `.seen` grows as the relay pushes. This is the part no other test in this repo does.
async function watching(who, since = APP_SINCE()) {
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
  s.send(JSON.stringify(['REQ', sub, ...HUB_FILTERS(church.pub, since)]));
  await sleep(300);
  seen.length = 0;   // drop the backlog: only what arrives AFTER this line is a live delivery
  return { s, seen, close: () => { try { s.close(); } catch {} } };
}

// A check-in record with the tags the relay's gates key on and one guardian copy per parent named.
function record(id, guardians, createdAt = now()) {
  const body = { id, child: 'kid-' + id, childName: 'Child ' + id, date: '2026-09-13', in: now(), code: '4821',
                 session: SESSION, guardians: guardians.map(g => g.pub) };
  // The SHARED builder, the same one both shipped writers call — it reads `body.guardians` itself and seals
  // one copy per parent, so a fixture here cannot disagree with what a phone would actually receive.
  const gk = checkinGuardianCopies(body, (plain, gp) => nip44.encrypt(plain, nip44.utils.getConversationKey(ada.sk, gp)));
  return finalizeEvent({ kind: 30078, created_at: createdAt,
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
  s.send(JSON.stringify(['REQ', 'anon', ...HUB_FILTERS(church.pub, APP_SINCE())]));   // no AUTH reply, ever
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

// ── THE STATE WHERE A CORRECT FANOUT STILL DELIVERS NOTHING ───────────────────────────────────────────────
//
// Found by audit, 2026-09-11, after the first version of this file concluded too much from four green tests.
// `since` is a filter like any other, so a record whose `created_at` is older than the WATCHING phone's
// cursor is never pushed to it — and `created_at` is stamped by the WRITER's clock. The relay refuses a
// timestamp too far in the FUTURE and deliberately accepts any past one (gateway.mjs says why: created_at is
// fixed at signing, and marking the refusal permanent meant a cheap phone with no NTP failed to send every
// message instead of every message landing a minute later — "the first audience, exactly").
//
// So a worker phone whose clock is more than SINCE_SLOP (3 days) slow writes a record the relay STORES and
// SERVES on request, and never pushes to a parent already watching. The parent sees it on the next cold
// start — which is precisely the shape measured on two phones on 2026-09-11, and precisely why this file
// must not be read as clearing the relay of that blocker. Neither phone's clock was checked against 3 days;
// the parent's drift was measured at 194 seconds and the worker's was never measured at all.
//
// This test PINS THE BEHAVIOUR RATHER THAN CALLING IT A BUG. Widening it is not free — `since` is what keeps
// a returning phone from re-downloading the corpus over a thin pipe, which is this product's first audience.
test('KNOWN LIMIT: a record stamped by a slow writer clock is stored and served, but never pushed live', async () => {
  const parent = await watching(gina);
  const stale = record('live5', [gina], now() - 4 * 86400);   // a writer phone four days behind
  const [ok, msg] = await send(w, stale);
  assert.equal(ok, true, 'the relay refused a past-stamped record, which would make this test measure the door: ' + msg);
  await sleep(600);
  parent.close();
  assert.equal(parent.seen.filter(e => e.id === stale.id).length, 0,
    're-anchor: the relay now pushes records older than the subscriber\'s `since`. If that is deliberate the ' +
    'note above is stale; if it is not, a thin-pipe phone is re-downloading history it already holds.');

  // …and it IS on the box: served the moment anyone asks for it. That is the half that makes this a live-push
  // limit rather than a lost record, and it is why a cold start shows the child and an open screen does not.
  const asked = await watching(gina, 0);          // a full re-sync carries no `since` — the cold-start path
  await sleep(400);
  asked.close();
  const s2 = await conn();
  const seen = [];
  s2.on('message', d => { const m = JSON.parse(d);
    if (m[0] === 'AUTH') s2.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
      tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, gina.sk)]));
    else if (m[0] === 'EVENT' && m[1] === 'cold') seen.push(m[2]); });
  s2.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  await sleep(400);
  s2.send(JSON.stringify(['REQ', 'cold', ...HUB_FILTERS(church.pub, 0)]));
  await sleep(600);
  try { s2.close(); } catch {}
  assert.ok(seen.some(e => e.id === stale.id),
    'the record is not even served on a full re-sync, so it is lost rather than merely undelivered — a worse ' +
    'defect than the one this test was written for');
});

// CANDIDATE 1'S SHAPE, from reference/DEVICE-VERIFICATION-two-phone-2026-09-11.md: a session that began
// PIN-LOCKED subscribes before it can answer an AUTH challenge. Nothing pinned what the relay does then.
test('a socket that subscribed BEFORE it authenticated is pushed the record once it does', async () => {
  const s = await conn();
  const seen = [];
  let challenge = null;
  s.on('message', d => { const m = JSON.parse(d);
    if (m[0] === 'AUTH') challenge = m[1];
    else if (m[0] === 'EVENT' && m[1] === 'late') seen.push(m[2]); });
  s.send(JSON.stringify(['REQ', 'late', ...HUB_FILTERS(church.pub, APP_SINCE())]));   // subscribe as nobody
  await sleep(500);
  assert.ok(challenge, 're-anchor: the relay never challenged this socket, so the test below proves nothing');
  s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
    tags: [['relay', WS_URL], ['challenge', challenge]], content: '' }, gina.sk)]));   // …and only now say who we are
  await sleep(400);
  seen.length = 0;
  const ev = record('live6', [gina]);
  await send(w, ev);
  await sleep(600);
  try { s.close(); } catch {}
  assert.ok(seen.map(e => e.id).includes(ev.id),
    'A SUBSCRIPTION OPENED BEFORE AUTHENTICATION STAYS DEAF AFTER IT. Every PIN-locked boot subscribes in ' +
    'that order, so a parent who unlocks would be told nothing for the rest of the session — the blocker\'s ' +
    'exact shape. The live fanout reads `client._auth` at push time, so this should hold.');
});
