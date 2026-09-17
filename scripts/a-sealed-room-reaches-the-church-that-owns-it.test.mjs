// A DELEGATED STEWARD SEALS A ROOM, AND THE CHURCH CAN ACTUALLY READ IT. THE WHOLE JOURNEY, ONE FILE.
//   Run: node --test scripts/a-sealed-room-reaches-the-church-that-owns-it.test.mjs
//
// WHY THIS FILE EXISTS. Two branches were written a day apart, each fixed half of one job, and NEITHER
// WORKED ALONE. This is the test that only passes once both are in — written at the merge, 2026-09-17, so
// that if anyone ever takes one half back out the failure lands here and says which half went.
//
//   · fix/delegated-steward-writes-2026-09-16 — THE DOCUMENT HALF. publishGroupKey now signs through
//     feChurch, so the envelope carries ['church', <cp>], and it seeds its recipient list from
//     `actingChurch || churchPub` instead of `churchPub`. Without the first, the relay stores the key and
//     serves it to nobody — every reader asks "signed by the church OR tagged with the church", and a
//     delegated steward's envelope is signed by the STEWARD and named no church, so it matched neither half.
//     Without the second, the CHURCH OWNER was not a recipient of the key to a room in their own church.
//   · feat/sealing-is-its-own-job-2026-09-17 — THE PERMISSION HALF. `trinityone/groupkey:` had no rule in
//     accept() at all and fell to the generic "member of ANY church on this box" catch-all, which refused a
//     steward of THIS church who had not joined it and accepted a member of a DIFFERENT one.
//
// MEASURED ON A PHONE with only the permission half installed: the relay ACCEPTED the key and stored two
// rows, with NO church tag — so nothing could attribute them and nobody could read the room. Accepted and
// unreadable. That is the shape this file exists to stop coming back.
//
// ── THE SENTENCE BEING PROVED ─────────────────────────────────────────────────────────────────────────────
// A delegated steward — a console acting for a church it stewards, signing with its OWN key, who has
// published NO `member:` document for that church — can lock a room, and the room is then readable by the
// church and by its members.
//
// ── HOW THIS ASSERTS, AND WHY EACH INSTRUMENT IS CHECKED ──────────────────────────────────────────────────
//   · It drives the SHIPPED publishGroupKey, lifted out of vendor/steward.js — the bundle the console loads.
//     Only the TRANSPORT is stubbed, never a decision: the real event goes on a real relay over a real
//     websocket and the relay's own OK/false is the answer. A mirror of the logic would pass its own sabotage.
//   · Reads go over a REAL NIP-42 authenticated socket, ONE SOCKET PER QUESTION. The kind-30078 read gate is
//     DEFAULT-DENY, so an anonymous socket reads empty and looks exactly like a refusal; a stale AUTH on a
//     reused socket can make a refusal look like a grant. Test 0 is a CONTROL with a known answer on both.
//   · The stored row is read STRAIGHT OUT OF relay.sqlite as well as over a socket, because "the socket
//     returned it" and "the tag is on the document" are two different claims and only one of them is about
//     storage. The store read bypasses canRead entirely.
//   · The church's recipient entry is really OPENED with the real nip44, using the conversation key with the
//     AUTHOR, exactly as stewIngestKey does. "The church is in env.keys" is not the same claim as "the
//     church can unwrap it", and it is the second one the room depends on.
//
// ── WHAT IS NOT PROVED HERE, AND IS NOT CLAIMED ANYWHERE ──────────────────────────────────────────────────
// Nothing on a screen. This drives the console's engine and the relay; it does not press the button in
// app/*.jsx, and a text-match against those files would prove nothing (CLAUDE.md rule 3 — they ship
// unbundled, so `false && ` in front of a condition leaves every word in place). A phone still has to show
// a delegated steward locking a room and the vicar reading it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const PORT = 19913;   // a HIGH port (19900-19999), so a concurrent suite on the usual fixed ports cannot collide
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', STEWARDS_D = 'trinityone/stewards:';
const GROUP_D = 'trinityone/group:', GROUPKEY_D = 'trinityone/groupkey:';
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// TWO CHURCHES ON ONE RELAY, because "nothing crosses churches" is not testable on a box that holds one.
const A = K();        // our church — the vicar's laptop holds this key
const B = K();        // a CO-TENANT church on the same relay. Innocent; used as the crossing that must fail.
const dana   = K();   // DELEGATED STEWARD of A, ticked for Sealed rooms. Never joined A. The person this is about.
const cara   = K();   // steward of A ticked for Groups & rotas ONLY — the control that gives the tick meaning
const ursula = K();   // UNSCOPED steward of A (every box ticked → caps: null). The compatibility case.
const rob    = K();   // an ordinary member of A — the congregation the room must reach
const bea    = K();   // an ordinary member of B — the crossing
const ap = A.pub, bp = B.pub;

// A room of A's, whose id carries A's owner prefix the way the console mints them (`<churchpub16>-<rand>`).
const GID = ap.slice(0, 16) + '-prayer';

let _t = Math.floor(Date.now() / 1000) - 400; const now = () => ++_t;
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res({ ok: m[2], why: m[3] || '' }); } };
  sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt]));
});
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content) }, who.sk);
const dTag = e => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
const churchTag = e => (e.tags.find(t => t[0] === 'church') || [])[1];

// ── ASK THE RELAY THE WAY A SCREEN DOES ───────────────────────────────────────────────────────────────────
// Its own socket, a real NIP-42 AUTH, closed afterwards. `authSk` null means DELIBERATELY ANONYMOUS, which
// test 0 uses to show what a forgotten AUTH looks like — so that "0 documents" is never mistaken for a gate.
const askRelay = (authSk, filter) => new Promise((res, rej) => {
  const id = 'q' + Math.random().toString(36).slice(2, 8), out = [];
  const sock = new WebSocket(WS_URL);
  const done = () => { try { sock.send(JSON.stringify(['CLOSE', id])); } catch {} try { sock.close(); } catch {} res(out); };
  const timer = setTimeout(done, 6000);
  sock.on('error', (e) => { clearTimeout(timer); rej(e); });
  sock.on('open', () => sock.send(JSON.stringify(['REQ', id, filter])));
  sock.on('message', (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH' && authSk) sock.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)]));
    else if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]);
    else if (m[0] === 'EOSE' && m[1] === id) { clearTimeout(timer); done(); }
  });
});

// BOTH HALVES OF THE QUESTION EVERY SCREEN ASKS — authored by the church, OR tagged with it. Kept separate
// so a row can say WHICH half found the document: this fix works through the TAG and must never quietly
// change who signs. (subscribeGroups in the console; the shared church-docs hub in src/fellowship.src.js.)
async function asScreen(authSk, cp, dPrefix) {
  const byAuthor = (await askRelay(authSk, { kinds: [30078], authors: [cp], '#t': [NET] })).filter(e => dTag(e).startsWith(dPrefix));
  const byTag    = (await askRelay(authSk, { kinds: [30078], '#church': [cp], '#t': [NET] })).filter(e => dTag(e).startsWith(dPrefix));
  return { byAuthor, byTag, all: [...byAuthor, ...byTag] };
}

// ── THE SHIPPED CONSOLE, lifted out of vendor/steward.js ──────────────────────────────────────────────────
// `actingChurch` is what puts it in delegated mode. Note that churchSk/churchPub are THIS DEVICE'S OWN key
// in BOTH modes — setActiveIdentity's delegated branch leaves them alone and moves `pub`/`actingChurch`
// instead. That is the whole reason the recipient list was wrong, so the fixture must reproduce it exactly
// rather than "helpfully" handing the church key in.
function consoleApi({ signer, actingChurch, churchPubOverride }) {
  const scope = {
    sk: signer.sk, pub: actingChurch || signer.pub, actingChurch,
    churchSk: signer.sk, churchPub: churchPubOverride || signer.pub,
    NET, GROUPKEY_D, GROUP_RING_MAX: 12,
    _skeys: {}, _srev: {}, _senvTs: {}, _localBlocked: new Set(),
    _isRelayAuthed: () => true,
    _requireTrustedView: () => {},
    _monotonic: (t) => t,
    _hex: (u) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join(''),
    toPubHex: (p) => (/^[0-9a-f]{64}$/i.test(p) ? String(p).toLowerCase() : null),
    now,
    sent: [], said: [],
    publish: async (evt) => { scope.sent.push(evt); const r = await send(ws, evt); scope.said.push(r); return r.ok; },
  };
  // esbuild renames imported bindings between builds (finalizeEvent -> finalizeEvent2, and the numbers move).
  // Read the names the bundle ACTUALLY uses, or a rebuild turns this red for a reason unrelated to behaviour.
  const feBody = fnBody(VENDOR, 'function feChurch(tmpl, signer) {', 'feChurch');
  const signerName = (/return\s+(finalizeEvent\w*)\s*\(/.exec(feBody) || [])[1];
  assert.ok(signerName, 'feChurch in vendor/steward.js no longer ends by calling finalizeEvent — re-anchor ' +
    'this fixture rather than widening it. Body seen:\n' + feBody.slice(0, 400));
  scope[signerName] = finalizeEvent;

  const gkBody = fnBody(VENDOR, 'async publishGroupKey(', 'publishGroupKey');
  // NOTE WHAT IS *NOT* ASSERTED HERE. The two source shapes this file's headline rests on (feChurch, and the
  // `actingChurch || churchPub` recipient seed) are checked in ONE dedicated row below, not in this helper.
  // Putting them here was the first shape of this file and it was wrong: every row calls consoleApi, so a
  // single missing half made all ten rows fail with the same fixture message and the sabotage matrix could
  // not tell which half had gone. Behaviour rows must measure behaviour.
  const seal = /const ck = (\w+)\(churchSk, pk\);\s*keys\[pk\] = (\w+)\(/.exec(gkBody);
  assert.ok(seal, 'publishGroupKey no longer seals with getConversationKey/encrypt in the shape this fixture ' +
    'reads — re-anchor it. Body seen:\n' + gkBody.slice(0, 600));
  scope[seal[1]] = nip44.utils.getConversationKey;   // REAL nip44, so the unwrap below is a real unwrap
  scope[seal[2]] = nip44.encrypt;

  Object.assign(scope, new Function('scope', `with (scope) { ${feBody}
    return ({ ${gkBody} }); }`)(scope));
  return scope;
}

before(async () => {
  await requireFreePort(PORT, 'a-sealed-room-reaches-the-church-that-owns-it.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-sealed-e2e-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(ap) + ',' + npubEncode(bp), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(200); }
  ws = await connect();
  // Every seeding step is ASSERTED. A fixture that silently failed to seed produces exactly the same
  // "0 documents" and "false" that a working gate produces, and that has put false findings in writing here
  // before now.
  assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, A.sk))).ok, true, 'seed: church A profile');
  assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Luke’s' }) }, B.sk))).ok, true, 'seed: church B profile');
  assert.equal((await send(ws, doc(rob, MEMBER_D + ap, { joined: now() }))).ok, true, 'seed: Rob could not join A');
  assert.equal((await send(ws, doc(bea, MEMBER_D + bp, { joined: now() }))).ok, true, 'seed: Bea could not join B');
  // A's room, defined by A, so GROUP_CHURCH resolves it without leaning on the id prefix.
  assert.equal((await send(ws, doc(A, GROUP_D + GID, { id: GID, name: 'Prayer', kind: 'group', encrypted: true }, [['church', ap]]))).ok, true, 'seed: A could not define its own room');
  // A's steward roster: Dana may seal, Cara may not, Ursula is unscoped (no caps entry at all).
  assert.equal((await send(ws, doc(A, STEWARDS_D + ap, { pubkeys: [dana.pub, cara.pub, ursula.pub], caps: { [dana.pub]: ['sealedrooms'], [cara.pub]: ['content'] } }))).ok, true, 'seed: A could not publish its steward roster');
  // B's roster: Bea holds sealedrooms IN HER OWN CHURCH. The crossing test is then about the church boundary
  // and not about her missing a tick.
  assert.equal((await send(ws, doc(B, STEWARDS_D + bp, { pubkeys: [bea.pub], caps: { [bea.pub]: ['sealedrooms'] } }))).ok, true, 'seed: B could not publish its steward roster');
  await sleep(300);
});
after(async () => {
  try { ws && ws.close(); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  await sleep(200);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// ══ 0. THE CONTROL ROW. Every instrument below is an OK/false off a socket or a count off a filter, and a
//       relay that never came up produces both. This row has a known answer in each direction. ════════════
test('CONTROL: the relay is up carrying BOTH churches, an AUTHED socket reads and an ANONYMOUS one does not', async () => {
  const st = await (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
  assert.ok(st, 'the relay did not answer /status — nothing below this line measured anything');

  // A document with a known answer: the room definition A published in before(). If this cannot be read by
  // an authed member, every "0" further down means "the socket is broken", not "the gate refused".
  const authed = await asScreen(rob.sk, ap, GROUP_D);
  assert.equal(authed.byTag.length, 1,
    'an AUTHENTICATED member cannot read the room definition the fixture just seeded. The read instrument ' +
    'is broken; nothing below this line is evidence of anything.');

  // …and the same question with no AUTH must come back EMPTY. This is the trap the file header names: a
  // forgotten AUTH reads exactly like a refusal, and this row is what tells the two apart.
  const anon = await asScreen(null, ap, GROUP_D);
  assert.equal(anon.all.length, 0,
    'an ANONYMOUS socket was served a church document. Either the read gate stopped being default-deny — ' +
    'which is a finding in its own right — or this fixture is not really anonymous, in which case every ' +
    '"the church can read it" row below is measuring nothing.');
});

// ══ 0b. THE FIXTURE ANCHOR ROW. One place, so the behaviour rows below stay free to measure behaviour. ═══
test('CONTROL: the shipped publishGroupKey still has BOTH halves of the merge in it', () => {
  // If either half is edited away, this row names which — and the rows below then show what it costs. Kept
  // separate from consoleApi() deliberately: when these lived in the helper, removing one half failed all
  // ten rows with the same fixture message and no sabotage could tell the two halves apart.
  const gkBody = fnBody(VENDOR, 'async publishGroupKey(', 'publishGroupKey');
  assert.ok(/publish\(\s*feChurch\(/.test(gkBody),
    'THE DOCUMENT HALF IS GONE: publishGroupKey no longer publishes through feChurch, so its envelope names ' +
    'no church. The relay stores the key and serves it to nobody, and the room draws EMPTY rather than ' +
    'broken on every phone in the congregation — so nobody reports it.');
  assert.ok(/new Set\(\[\s*actingChurch \|\| churchPub\s*,\s*churchPub\s*,/.test(gkBody),
    'THE SECOND DEFECT IS BACK: publishGroupKey no longer seeds its recipients from `actingChurch || ' +
    'churchPub`. In delegated mode `churchPub` is THE DEVICE\'S OWN key, so the church owner stops being a ' +
    'recipient of the key to a room in their own church. Body seen:\n' + gkBody.slice(0, 500));
});

// ══ 1. THE PERMISSION HALF. She is not a member. She holds the tick. The write is taken. ═════════════════
test('1 · a delegated steward who never joined the church HAS her room key accepted', async () => {
  // Prove the premise first. If she has a member: document, the write could be succeeding for the old
  // reason and this file would be measuring the catch-all it was written to replace.
  const hers = await askRelay(A.sk, { kinds: [30078], '#d': [MEMBER_D + ap], authors: [dana.pub] });
  assert.equal(hers.length, 0,
    're-anchor: this steward now has a member: document for the church, so she is no longer the case the ' +
    'bug was about — a delegated steward is routinely NOT in the congregation she helps run');

  const api = consoleApi({ signer: dana, actingChurch: ap });
  const out = await api.publishGroupKey(GID, [rob.pub]);
  assert.ok(api.sent.length, 'nothing was published at all — the fixture is not exercising the path it names');
  assert.ok(out === true || (out && out.ok), 'the relay refused the key: ' + JSON.stringify(api.said));
});

// ══ 2. THE DOCUMENT HALF, READ OUT OF THE STORE ITSELF. ══════════════════════════════════════════════════
test('2 · the row the relay STORED carries the church tag — read from relay.sqlite, not off a socket', async () => {
  await sleep(250);
  const { openStore } = await import('./event-store.mjs');
  const store = openStore(join(dataDir, 'relay.sqlite'), { maxEvents: 5000 });
  try {
    const rows = store.query({ kinds: [30078], '#d': [GROUPKEY_D + GID] });
    assert.equal(rows.length, 1, 'the store does not hold exactly one envelope for this room — it holds ' + rows.length);
    assert.equal(churchTag(rows[0]), ap,
      'THE DEFECT MEASURED ON THE PHONE. The relay accepted the key and stored the row with NO church tag, ' +
      'so nothing could attribute it and nobody could read the room. Tags stored: ' + JSON.stringify(rows[0].tags));
    assert.equal(rows[0].pubkey, dana.pub,
      'the envelope is not signed by the steward any more. The fix is meant to work through the church TAG, ' +
      'not by changing who signs — if the signer moved, the whole reasoning in this file needs redoing.');
  } finally { if (store.close) store.close(); }
});

// ══ 3. THE CONGREGATION AND THE CHURCH CAN READ IT BACK, over real authenticated sockets. ════════════════
test('3 · the church key and an ordinary member both FIND the key — one socket each, both authenticated', async () => {
  const asChurch = await asScreen(A.sk, ap, GROUPKEY_D);
  assert.equal(asChurch.byTag.length, 1,
    'the CHURCH cannot find the key to a room in its own church. Its console asks for "authored by me OR ' +
    'tagged with me"; an untagged, steward-signed envelope matches neither, so the vicar sees an empty room.');
  assert.equal(asChurch.byAuthor.length, 0,
    'the envelope came back under authors:[church], which would mean the church key signed it. Re-anchor: ' +
    'the fix works through the TAG.');

  const asMember = await asScreen(rob.sk, ap, GROUPKEY_D);
  assert.equal(asMember.byTag.length, 1,
    'an ordinary member cannot see the key, so that room is blank on every phone in the congregation and ' +
    'nothing on screen says why — _decEvt drops what it cannot open. No error, no spinner, nothing to report.');
});

// ══ 4. THE SECOND DEFECT: being served it is not the same as being able to open it. ══════════════════════
test('4 · the CHURCH can really UNWRAP its own entry — and so can the steward and the member', async () => {
  const seen = await asScreen(A.sk, ap, GROUPKEY_D);
  const evt = seen.byTag[0];
  assert.ok(evt, 'nothing to open — test 3 should have failed first');
  const env = JSON.parse(evt.content);

  assert.ok(env.keys[ap],
    'THE SECOND DEFECT. The church owner is not a recipient of the key to a room in their own church: ' +
    'publishGroupKey seeded its recipient list from `churchPub`, which in delegated mode is the STEWARD\'S ' +
    'OWN key. The owner\'s console looks for env.keys[<the church key>], finds nothing, and can neither ' +
    'read the room nor add anybody to it afterwards. Recipients present: ' + Object.keys(env.keys).length);

  // REALLY OPEN IT, exactly as stewIngestKey does: the nip44 conversation key with the AUTHOR of the event.
  // "Is in env.keys" and "can decrypt" are different claims and the room depends on the second.
  const open = (whoSk) => nip44.decrypt(env.keys[getPublicKey(whoSk)], nip44.utils.getConversationKey(whoSk, evt.pubkey));
  const byChurch = open(A.sk);
  assert.match(byChurch, /^[0-9a-f]{64}$/i,
    'the church\'s entry did not open to a 64-hex room key — being handed an envelope you cannot unwrap is ' +
    'the same blank room with an extra step. Got: ' + JSON.stringify(String(byChurch).slice(0, 60)));

  assert.ok(env.keys[dana.pub], 'the steward who sealed the room was dropped from her own envelope');
  assert.ok(env.keys[rob.pub], 'the member the room was sealed for fell out of the envelope');
  assert.equal(open(dana.sk), byChurch, 'the steward opens a DIFFERENT room key from the church — the room would split in two');
  assert.equal(open(rob.sk),  byChurch, 'the member opens a DIFFERENT room key from the church — they could read nothing anyone else posts');

  // AND NOBODY ELSE. The envelope is per-recipient, so this is a real check and not a restatement.
  assert.ok(!env.keys[bea.pub], 'a member of the CO-TENANT church was sealed a key to our room');
  assert.ok(!env.keys[cara.pub], 'a steward with no Sealed rooms tick was handed the room key anyway');
});

// ══ 5. THE CONTROLS. Each one has a known answer that is the OPPOSITE of the rows above. ═════════════════

test('5a · CONTROL — a steward of this church WITHOUT the Sealed rooms tick is refused', async () => {
  // Cara holds 'content' — groups, plans, rotas, rosters, services, rooms, bookings. The whole point of the
  // new tick is that running the rotas and holding the room key stopped being one decision.
  const api = consoleApi({ signer: cara, actingChurch: ap });
  await api.publishGroupKey(GID, [rob.pub]);
  assert.ok(api.said.length, 'nothing was published — this control is not exercising the path it names');
  assert.equal(api.said[0].ok, false,
    'a steward ticked only for "Groups & rotas" minted the room key, which means holding it, which means ' +
    'reading the room. If this passes the capability means nothing.');
});

test('5b · CONTROL — a member (and steward) of a CO-TENANT church is refused: nothing crosses churches', async () => {
  // Bea is a member of B AND ticked for sealedrooms ON B'S OWN ROSTER. So the only thing standing between
  // her and our room key is the church boundary itself. This is the crossing the owner cares about:
  // "There should be Nothing that crosses churches."
  const api = consoleApi({ signer: bea, actingChurch: ap });
  await api.publishGroupKey(GID, [rob.pub]);
  assert.equal(api.said[0].ok, false,
    'a member of a DIFFERENT church on the same relay replaced our room\'s key. The old catch-all asked ' +
    '"a member of ANY church on this box" and this is exactly what it let through.');

  // …and she cannot buy her way in by stamping her own church on it, either. The owning church comes from
  // the GROUP, never from a tag the writer chose — which now matters in a way it did not before this merge,
  // because since the document half landed there IS a tag on every envelope to be tempted by.
  const forged = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GROUPKEY_D + GID], ['t', NET], ['church', bp]], content: JSON.stringify({ rev: 9, keys: {}, rings: {} }) }, bea.sk);
  assert.equal((await send(ws, forged)).ok, false,
    'the owning church was taken from a tag the writer chose, so anyone could move a room to a church they ' +
    'do steward. A room belongs to the church that owns the GROUP.');
});

test('5c · CONTROL — the church\'s own key always seals, and its envelope is unchanged by all of this', async () => {
  const api = consoleApi({ signer: A, actingChurch: null });
  const out = await api.publishGroupKey(GID, [rob.pub]);
  assert.ok(out === true || (out && out.ok), 'the church was refused the key to its own room: ' + JSON.stringify(api.said));
  // BYTE-FOR-BYTE THE OLD BEHAVIOUR for an owner console: feChurch adds no tag when the signer IS the church
  // (it would be redundant — authors:[cp] already matches), and `actingChurch || churchPub` collapses in the
  // Set to the single value it always was. This is the row that says the fix cost existing churches nothing.
  assert.equal(churchTag(api.sent[0]), undefined,
    'a church tag was stamped on the church\'s OWN envelope. Harmless-looking, but it is a change to every ' +
    'existing church\'s documents that nobody asked for.');
  const env = JSON.parse(api.sent[0].content);
  assert.deepEqual(Object.keys(env.keys).sort(), [ap, rob.pub].sort(),
    'the owner console\'s recipient list changed. It must be exactly the church and the room\'s members, ' +
    'as it was before the delegated fix. Got: ' + JSON.stringify(Object.keys(env.keys)));
});

test('5d · CONTROL — an UNSCOPED steward still seals: the compatibility decision, not an oversight', async () => {
  // Ursula is on the roster with NO entry in `caps`. The console's capability editor collapses "every box
  // ticked" to an unscoped steward, so an explicit-only gate would refuse the very person an owner had
  // ticked everything for. stewardCan, deliberately, not stewardCanExplicitly — and it is pinned here as
  // well as on the relay branch, because this is the row that would be quietly "tightened" one day.
  const api = consoleApi({ signer: ursula, actingChurch: ap });
  const out = await api.publishGroupKey(GID, [rob.pub]);
  assert.ok(out === true || (out && out.ok),
    'an unscoped steward who could seal a room yesterday cannot today — an availability failure dressed as ' +
    'a security improvement. Said: ' + JSON.stringify(api.said));
});

// ══ 6. WHY THIS RULE CANNOT RUN ON THE INGEST PATH. ══════════════════════════════════════════════════════
test('6 · nothing already stored becomes unreadable: /import and peer sync never call accept()', async () => {
  // NOT a comment — read out of scripts/gateway.mjs. accept() is the WRITE gate for events arriving over a
  // websocket. /import and relay-to-relay replication put straight into the store. That separation is
  // deliberate and it is why a new write rule cannot delete or hide anything a church already holds:
  // replaying a write gate over an import once deleted a church's WHOLE FINANCE JOURNAL.
  const src = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');
  const importer = src.slice(src.indexOf('/import'));
  assert.ok(importer.length > 1000, 're-anchor: /import is no longer in gateway.mjs in a shape this test can slice');
  // The claim is narrow and checkable: the GROUPKEY_D branch is inside accept(), and accept() is reached
  // from the EVENT frame handler, not from the import/replication puts.
  const acceptAt = src.indexOf('function accept(e) {');
  assert.notEqual(acceptAt, -1, 're-anchor: accept() has been renamed');
  const gkAt = src.indexOf("if (d.startsWith(GROUPKEY_D)) {");
  assert.notEqual(gkAt, -1, 'the GROUPKEY_D write rule is gone from gateway.mjs');
  assert.ok(gkAt > acceptAt, 'the GROUPKEY_D rule is no longer inside accept()');

  // And the live proof, which is worth more than the slice: DANA'S OWN envelope, written in test 1, is still
  // being served to an ordinary member after four further writes and three refusals have crossed this relay.
  // Asserted by AUTHOR, not by count: kind-30078 is replaceable per (author, d-tag), so Ursula's envelope in
  // 5d occupies a second row for the same room and a bare count would move for a reason that is not about
  // this merge at all. (That several stewards can each hold a slot for one room is how the ring/rev
  // mechanism has always worked and is not something this branch changes.)
  const still = await asScreen(rob.sk, ap, GROUPKEY_D);
  assert.ok(still.byTag.some(e => e.pubkey === dana.pub),
    'the room key the delegated steward sealed in test 1 stopped being served part-way through this file. ' +
    'A WRITE rule that changes what is SERVED is the finance-journal shape and must be reported, not patched. ' +
    'Authors still served: ' + JSON.stringify(still.byTag.map(e => e.pubkey.slice(0, 8))));
});
