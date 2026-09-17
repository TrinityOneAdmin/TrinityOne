// A DELEGATED STEWARD'S CHURCH DOCUMENTS HAVE TO NAME THEIR CHURCH, OR NOBODY — INCLUDING THEM — EVER SEES THEM.
//   Run: node --test scripts/a-delegated-stewards-church-writes-are-visible.test.mjs
//
// A delegated steward acts in a church's name and signs with their OWN key. The identity switch in
// src/steward.src.js says so in as many words: "delegated: OUR key signs, church's context reads" — `sk` is
// the steward's key, `pub` is the church, `actingChurch` is set. Every reader of a church document therefore
// asks the relay the same two-part question: "signed by the church, OR carrying a ['church', <cp>] tag".
// (subscribeGroups / subscribeSafeguard / subscribeJoinPolicy in the console; the shared church-docs hub in
// src/fellowship.src.js.) `feChurch()` is the house helper that stamps that tag; three writers were calling
// a bare `finalizeEvent` instead, so their documents matched NEITHER half of that question.
//
// The relay stores them and, for two of the three, ACTS on them. That is the trap: the write succeeds, the
// console says so truthfully, and the document is then invisible to every screen in the church — including
// the screen of the steward who just wrote it. A failure you can see is a nuisance. A save that is not
// really there is something else.
//
// ── HOW THIS ASSERTS ───────────────────────────────────────────────────────────────────────────────────────
// It drives the SHIPPED functions. publishGroupKey, setJoinPolicy, setNoPhoto and feChurch are lifted out of
// vendor/steward.js — the bundle the console actually loads — and the events they produce go on a REAL relay
// over a REAL websocket, read back over a REAL NIP-42 authenticated subscription using the same filters the
// screens use. The member half lifts subscribeChurchSafeguard out of vendor/fellowship.js and runs it.
// A mirror of the logic written here would pass its own sabotage.
//
// ── EVERY NUMBER BELOW WAS MEASURED ON THIS RELAY, NOT INFERRED ────────────────────────────────────────────
//   group key    untagged: STORED, and invisible to the congregation AND to the church owner (0 documents on
//                both halves of the filter). Tagged: both see it. A steward who is not also a MEMBER of the
//                church is refused outright — there is no relay rule for `groupkey:` at all; it survives on
//                the generic "a member may write their own documents" rule. Declared gap, not fixed here.
//   join policy  untagged: STORED and ENFORCED AT ONCE, and invisible to both halves of the filter — so the
//                switch reads "off" while the relay holds new joiners pending, and pressing it again only
//                sets it on again. Also measured: with approval on, an existing member who is not on the
//                admitted list can read NOTHING of the church a moment later.
//   nophoto      the relay REPLACES the church's whole suppression list with whatever list arrives last,
//                whoever signed it — while an untagged steward copy is invisible to every reader. Measured
//                end to end: church suppresses Amy, Amy's photo is refused; a steward writes a list without
//                Amy, and AMY'S PHOTO IS ACCEPTED AGAIN, with nothing on any screen saying so.
//
// ── WHAT THE TAG COSTS, MEASURED, PER DOCUMENT ─────────────────────────────────────────────────────────────
// A church tag brings a document under the relay's revoked-steward rule (`retractionExempt` in canRead,
// scripts/gateway.mjs): when the steward leaves the roster, the relay stops serving what they wrote.
//   · group key   — IT DOES RETRACT (measured below). Right, and it costs nothing new: the member app's
//                   _ingestGroupKey already refuses an envelope from anyone who is not the church or a
//                   CURRENT roster steward, so a departed steward's envelope was already being dropped on
//                   every phone. The relay now agrees with the phones instead of contradicting them. The
//                   church re-issues by adding or removing anyone in the room.
//   · join policy — IT DOES NOT RETRACT (measured below): joinpolicy is on canRead's public allowlist and
//                   returns before the retraction rule is reached. A departing steward cannot take a
//                   church's "approval required" switch with them.
//   · nophoto     — IT DOES RETRACT (measured below). Same shape as the group key: subscribeChurchSafeguard
//                   and the console's subscribeSafeguard both already require a CURRENT roster steward, so
//                   the phones had already stopped honouring it. Worth stating plainly all the same: after
//                   a steward leaves, a suppression only they ever wrote stops being served, and the church
//                   must re-apply it from the owner's console. The relay's OWN enforcement is separate and
//                   unaffected — NOPHOTO_BY is built at ingest, so it keeps refusing the photograph.
//
// SAFE ON STORED DATA. The tag is ADDITIVE — a new tag on new writes, no field repurposed, no reader asked
// to stop understanding anything it understands today (house rule: add, never repurpose). Documents already
// on relays keep working: the church's own copies are author-matched and never needed a tag, and the relay
// rehydrates all history on every update. The one visible change for existing data is the retraction above.
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

const PORT = 19411;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', STEWARDS_D = 'trinityone/stewards:';
const GROUP_D = 'trinityone/group:', GROUPKEY_D = 'trinityone/groupkey:';
const JOINPOLICY_D = 'trinityone/joinpolicy:', NOPHOTO_D = 'trinityone/nophoto:';
const MINORS_D = 'trinityone/minors:';
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();   // the vicar's laptop — holds the church key
const dana   = K();   // a DELEGATED steward. Her OWN key signs; `pub` is the church; actingChurch is set.
const rob    = K();   // an ordinary member of the congregation — the person the room goes dark for
const amy    = K();   // suppressed by the CHURCH
const ben    = K();   // suppressed later by the STEWARD
const cp = church.pub;

let _t = Math.floor(Date.now() / 1000) - 200; const now = () => ++_t;
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content) }, who.sk);
const photo = (who, url) => finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET], ['church', cp]], content: JSON.stringify({ name: 'somebody', picture: url }) }, who.sk);
const setRoster = (pubkeys, caps) => send(ws, doc(church, STEWARDS_D + cp, { pubkeys, caps }));

// Ask the relay the way a screen does — ON ITS OWN SOCKET, AFTER A REAL NIP-42 AUTH. The kind-30078 read
// gate is default-DENY, so an anonymous socket gets nothing back and a test that forgot to authenticate
// would read "the fix did not work" off its own omission. One socket per question, so a stale AUTH can
// never make a refusal look like a grant.
const askRelay = (authSk, filter) => new Promise((res, rej) => {
  const id = 'q' + Math.random().toString(36).slice(2, 8), out = [];
  const sock = new WebSocket(WS_URL);
  sock.on('error', rej);
  sock.on('open', () => sock.send(JSON.stringify(['REQ', id, filter])));
  sock.on('message', (d) => { const m = JSON.parse(d);
    if (m[0] === 'AUTH' && authSk) sock.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)]));
    else if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]);
    else if (m[0] === 'EOSE' && m[1] === id) { sock.send(JSON.stringify(['CLOSE', id]));  sock.close(); res(out); } });
});
const dTag = e => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
const churchTag = e => (e.tags.find(t => t[0] === 'church') || [])[1];

// BOTH HALVES OF THE QUESTION EVERY SCREEN ASKS. subscribeGroups, subscribeSafeguard, subscribeJoinPolicy and
// the member app's church-docs hub all use exactly this pair of filters: authored by the church, OR tagged
// with the church. Returned separately so a test can say WHICH half found a document — the fix works through
// the tag and must never quietly change who signs.
async function asScreen(authSk, dPrefix) {
  const byAuthor = (await askRelay(authSk, { kinds: [30078], authors: [cp], '#t': [NET] })).filter(e => dTag(e).startsWith(dPrefix));
  const byTag = (await askRelay(authSk, { kinds: [30078], '#church': [cp], '#t': [NET] })).filter(e => dTag(e).startsWith(dPrefix));
  return { byAuthor, byTag, all: [...byAuthor, ...byTag] };
}

// ── THE SHIPPED CONSOLE, lifted out of vendor/steward.js ───────────────────────────────────────────────────
// `publish` is the only stub, and it stubs the TRANSPORT, not the decision: it puts the real event on the
// real relay and reports what the relay said. `actingChurch` is what puts the console in delegated mode —
// and note that `churchSk`/`churchPub` are THIS DEVICE'S OWN key in BOTH modes. setActiveIdentity's delegated
// branch leaves them alone and moves `pub`/`actingChurch` instead, which is the whole reason the recipient
// list of a group key was wrong.
function consoleApi({ signer, actingChurch }) {
  const scope = {
    sk: signer.sk, pub: cp, actingChurch,
    churchSk: signer.sk, churchPub: signer.pub,
    NET, GROUPKEY_D, JOINPOLICY_D, NOPHOTO_D, GROUP_RING_MAX: 12,
    _skeys: {}, _srev: {}, _senvTs: {}, _localBlocked: new Set(),
    _isRelayAuthed: () => true,
    _requireTrustedView: () => {},
    _monotonic: (t) => t,   // the shipped one guards same-second replaceables; it needs state and is irrelevant here
    _hex: (u) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join(''),
    toPubHex: (p) => (/^[0-9a-f]{64}$/i.test(p) ? String(p).toLowerCase() : null),
    now,
    sent: [],
    publish: async (evt) => { scope.sent.push(evt); const [ok] = await send(ws, evt); return ok; },
  };
  // esbuild renames imported bindings (finalizeEvent -> finalizeEvent2, encrypt -> encrypt3, and the numbers
  // move between builds). Read the names the bundle ACTUALLY uses rather than hard-coding them, or a rebuild
  // turns this test red for a reason that has nothing to do with the behaviour it guards.
  const feBody = fnBody(VENDOR, 'function feChurch(tmpl, signer) {', 'feChurch');
  const signerName = (/return\s+(finalizeEvent\w*)\s*\(/.exec(feBody) || [])[1];
  assert.ok(signerName, 'feChurch in vendor/steward.js no longer ends by calling finalizeEvent — re-anchor ' +
    'this fixture rather than deleting it. Body seen:\n' + feBody.slice(0, 400));
  scope[signerName] = finalizeEvent;

  const gkBody = fnBody(VENDOR, 'async publishGroupKey(', 'publishGroupKey');
  const seal = /const ck = (\w+)\(churchSk, pk\);\s*keys\[pk\] = (\w+)\(/.exec(gkBody);
  assert.ok(seal, 'publishGroupKey no longer seals with getConversationKey/encrypt in the shape this ' +
    'fixture reads — re-anchor it. Body seen:\n' + gkBody.slice(0, 600));
  scope[seal[1]] = nip44.utils.getConversationKey;   // REAL nip44, so the church owner's entry below is
  scope[seal[2]] = nip44.encrypt;                    // genuinely decrypted rather than compared to a stub

  const jpBody = fnBody(VENDOR, 'setJoinPolicy(approval) {', 'setJoinPolicy');
  const npBody = fnBody(VENDOR, 'setNoPhoto(pubkeys) {', 'setNoPhoto');
  Object.assign(scope, new Function('scope', `with (scope) { ${feBody}
    return ({ ${gkBody},\n ${jpBody},\n ${npBody} }); }`)(scope));
  return scope;
}

before(async () => {
  await requireFreePort(PORT, 'a-delegated-stewards-church-writes-are-visible.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-deleg-writes-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(200); }
  ws = await connect();
  assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, church.sk)))[0], true, 'church profile');
  for (const who of [dana, rob, amy, ben]) assert.equal((await send(ws, doc(who, MEMBER_D + cp, { joined: now() })))[0], true, 'joined');
  assert.equal((await setRoster([dana.pub], { [dana.pub]: ['content', 'members', 'safeguarding'] }))[0], true, 'steward roster');
  await sleep(300);
});
after(async () => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ══ 1. THE GROUP KEY — the worst of the three, because the room renders EMPTY rather than broken ══════════
//
// A steward with "Groups & rotas" seals a room. The console reports success and flags the group encrypted.
// The sealed key envelope is what every member's phone needs to read a single word in that room.

test('a delegated steward’s group key reaches the relay, and names the church', async () => {
  assert.equal((await send(ws, doc(dana, GROUP_D + 'prayer', { id: 'prayer', name: 'Prayer', encrypted: true }, [['church', cp]])))[0], true, 'the group document itself');
  const api = consoleApi({ signer: dana, actingChurch: cp });
  const out = await api.publishGroupKey('prayer', [rob.pub]);
  assert.ok(api.sent.length, 'nothing was published at all — the fixture is not exercising the path it names');
  assert.ok(out === true || (out && out.ok), 'the relay refused a delegated steward’s group key envelope: ' + JSON.stringify(out));
  assert.equal(churchTag(api.sent[0]), cp,
    'the key envelope does not name the church, so no reader can match it: every screen asks for "signed by ' +
    'the church OR tagged with the church", and a steward’s envelope is signed by the STEWARD. Tags: ' +
    JSON.stringify(api.sent[0].tags));
});

test('…and the congregation can then FIND it — without this the room is silently EMPTY', async () => {
  // POINT OF USE (CLAUDE.md rule 1). This is the exact pair of filters the member app's shared church-docs
  // hub uses (src/fellowship.src.js: authors:[cp] and #church:[cp]). A phone that never receives this
  // envelope cannot decrypt one message in the room and cannot post to it either — and _decEvt DROPS what it
  // cannot open, so the room draws as empty. No error, no spinner, nothing to report.
  const seen = await asScreen(rob.sk, GROUPKEY_D);
  assert.equal(seen.byTag.length, 1,
    'an ordinary member cannot see the group key a delegated steward just published, so that room is blank ' +
    'on every phone in the church and nothing says why. Documents the church authored: ' + seen.byAuthor.length);
  assert.equal(seen.byAuthor.length, 0,
    'the envelope came back under authors:[church], which would mean the church key signed it. Re-anchor ' +
    'this test — the fix is meant to work through the church TAG, not by changing who signs.');
});

test('the CHURCH OWNER is a recipient of the key to their own room — and so is the steward', async () => {
  // THE SECOND DEFECT IN THE SAME FUNCTION, and it survives fixing the first. publishGroupKey seeded its
  // recipient list from `churchPub`, which in delegated mode is the STEWARD'S OWN KEY, not the church's. So
  // the church owner was not handed the key to a room in their own church: their console's stewIngestKey
  // looks for env.keys[<the church's key>], found nothing, and they could neither read the room nor add
  // anybody to it afterwards.
  const seen = await asScreen(rob.sk, GROUPKEY_D);
  const env = JSON.parse(seen.byTag[0].content);
  assert.ok(env.keys[cp], 'the church owner is not a recipient of the key to their own room. Recipients: ' +
    Object.keys(env.keys).length);
  assert.ok(env.keys[dana.pub], 'the steward who sealed the room cannot read it — they were dropped from ' +
    'their own envelope');
  assert.ok(env.keys[rob.pub], 'an ordinary member of the room fell out of the envelope');
  // Really open it, with the real nip44, exactly as stewIngestKey does: the conversation key with the AUTHOR.
  const open = (whoSk) => nip44.decrypt(env.keys[getPublicKey(whoSk)], nip44.utils.getConversationKey(whoSk, seen.byTag[0].pubkey));
  assert.match(open(church.sk), /^[0-9a-f]{64}$/, 'the church owner’s entry does not decrypt to a key');
  assert.equal(open(church.sk), open(rob.sk), 'the owner and the member were handed DIFFERENT keys — they ' +
    'would each read a different half of the room');
});

test('CONTROL — the church’s own console is unaffected: no tag, and the same recipients as before', async () => {
  // Not delegated: actingChurch is empty, feChurch stamps nothing, and `actingChurch || churchPub` collapses
  // to churchPub, so the recipient list is what it always was. This is the path that always worked.
  assert.equal((await send(ws, doc(church, GROUP_D + 'youth', { id: 'youth', name: 'Youth', encrypted: true })))[0], true, 'the group document itself');
  const api = consoleApi({ signer: church, actingChurch: '' });
  const out = await api.publishGroupKey('youth', [rob.pub]);
  assert.ok(out === true || (out && out.ok), 'the church’s own console can no longer seal a room — the fix broke the ordinary case');
  assert.equal(churchTag(api.sent[0]), undefined,
    'a church tag was stamped on the church’s OWN document. Harmless today, but it means feChurch is adding ' +
    'it unconditionally rather than only in delegated mode.');
  const env = JSON.parse(api.sent[0].content);
  assert.deepEqual(Object.keys(env.keys).sort(), [cp, rob.pub].sort(),
    'the owner’s recipient list changed. It must be the church plus the room’s members and nothing else.');
});

// ══ 2. PHOTO SUPPRESSION — a safeguarding control that undid itself ═══════════════════════════════════════

test('the relay obeys the LAST list it was sent, whoever signed it — so an unreadable copy is not harmless', async () => {
  // MEASURED, in this order, and this is the whole finding. The relay's NOPHOTO_BY is built at ingest from
  // the d-tag alone, so a steward's write REPLACES the church's entire suppression list — while, untagged,
  // that same document is invisible to every screen. The church's console goes on showing Amy suppressed.
  const owner = consoleApi({ signer: church, actingChurch: '' });
  assert.ok(await owner.setNoPhoto([amy.pub]), 'the church could not suppress a photo at all');
  await sleep(250);
  assert.equal((await send(ws, photo(amy, 'https://example.invalid/a.jpg')))[0], false,
    'CONTROL: the relay is not enforcing photo suppression at all, so nothing below measures anything');

  // What the shipped code produced BEFORE this fix: a steward's list, signed by the steward, naming no
  // church. Hand-built here because the fixed function cannot produce it any more.
  assert.equal((await send(ws, doc(dana, NOPHOTO_D + cp, { pubkeys: [ben.pub] })))[0], true, 'the steward’s untagged write');
  await sleep(250);
  assert.equal((await send(ws, photo(amy, 'https://example.invalid/b.jpg')))[0], true,
    'the relay did not act on the steward’s list, which would mean this finding is not real — re-measure ' +
    'before deleting anything');
  const blind = await asScreen(dana.sk, NOPHOTO_D);
  assert.equal(blind.byTag.length, 0,
    'the untagged copy is visible after all — re-anchor this test, it is the premise of the whole file');
  assert.deepEqual(blind.byAuthor.map(e => e.pubkey), [cp],
    'the only suppression document any screen can see should still be the CHURCH’S — which still lists Amy, ' +
    'while the relay has just stopped protecting her. That disagreement is the defect.');
});

test('the shipped setNoPhoto now names the church, so the same write is visible to everyone it binds', async () => {
  const api = consoleApi({ signer: dana, actingChurch: cp });
  assert.ok(await api.setNoPhoto([amy.pub, ben.pub]), 'the relay refused a Safeguarding steward’s suppression list');
  assert.equal(churchTag(api.sent[0]), cp, 'the steward’s suppression list still names no church');
  await sleep(250);
  assert.equal((await send(ws, photo(amy, 'https://example.invalid/c.jpg')))[0], false, 'Amy is not protected again');
  assert.equal((await send(ws, photo(ben, 'https://example.invalid/d.jpg')))[0], false, 'Ben was never protected');
  const seen = await asScreen(rob.sk, NOPHOTO_D);
  assert.equal(seen.byTag.length, 1,
    'the congregation still cannot see the list the relay is enforcing against them');
  assert.deepEqual(JSON.parse(seen.byTag[0].content).pubkeys.sort(), [amy.pub, ben.pub].sort());
});

// ── the member's phone: the SECOND file, the SECOND caller list ────────────────────────────────────────────
// Relay enforcement only stops a NEW photograph. It cannot rewrite a kind-0 somebody already signed, so the
// picture already published goes on rendering in Chat, Groups, Today and the family view until the member's
// own app honours the list. subscribeChurchSafeguard admitted steward-signed safeguarding documents ONLY for
// `clearance:` — so it threw a steward's `nophoto:` away, and the avatar never changed.
const SUB = fnBody(FELLOWSHIP, 'subscribeChurchSafeguard(churchNpub, onLists) {', 'subscribeChurchSafeguard');
const FCP = 'c'.repeat(64), STEW = 'd'.repeat(64), OUTSIDER = 'f'.repeat(64), ME = 'e'.repeat(64);
function memberApp(docs) {
  const heard = [];
  const stubs = {
    window: { Fellowship: { myPubkey: ME } },
    pub: ME, sk: 'k',
    toPub: () => FCP,
    pubSet: (a) => new Set(a || []),
    _noPhoto: new Set(),
    _churchRoster: new Map([[FCP, new Set([STEW])]]),   // the church's CURRENT stewards
    APPROVED_D: 'trinityone/approved:',
    _relayAuthedAt: 1, _relayAuthOkAt: 1,
    _docsHub: () => ({ eosedAt: 1 }),
    _onChurchDocs: (_cp, h) => { for (const e of docs) h.onevent(e, (e.tags.find(t => t[0] === 'd') || [])[1]); if (h.oneose) h.oneose(); return () => {}; },
    decrypt: (c) => c, getConversationKey: () => 'k', nip44d: (c) => c, nip44ck: () => 'k',
    SG_ASSUME_KEY: 'trinityone.sgassume.', _mayCache: () => true,
    _fetchChildCareAudience: async () => [],
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console,
  };
  const DECLARED = new Set(['_sgSelf', 'heard']);
  const scope = new Proxy(stubs, {
    has: (t, k) => !DECLARED.has(String(k)) && ((k in t) || !(String(k) in globalThis)),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it in memberApp()'); },
  });
  const names = Object.keys(stubs);
  new Function(...names, 'scope', 'heard', `
    let _sgSelf = { cp: '', me: '', isMinor: false, known: false };
    with (scope) { ({ ${SUB} }).subscribeChurchSafeguard('npub1c', (o) => heard.push(o)); }`)
    (...names.map(k => stubs[k]), scope, heard);
  assert.ok(heard.length, 'the lifted stream emitted nothing at all — re-anchor this test');
  return heard[heard.length - 1];
}
const sgDoc = (author, d, content, at = 1756900000) =>
  ({ id: 'x' + Math.random(), pubkey: author, created_at: at, content: JSON.stringify(content), tags: [['d', d]] });

test('a member’s phone honours a STEWARD’S photo-suppression list, not only the church’s', async () => {
  // POINT OF USE, second file. Delete the widening from src/fellowship.src.js and this goes red while the
  // relay tests above stay green — which is exactly the gap: the relay refuses the new photo and every
  // avatar in the app keeps drawing the old one.
  const out = memberApp([sgDoc(STEW, 'trinityone/nophoto:' + FCP, { pubkeys: [ME, 'a'.repeat(64)] })]);
  assert.deepEqual(out.nophoto, [ME, 'a'.repeat(64)],
    'the phone threw away a current steward’s photo-suppression list, so a photograph the church has ' +
    'suppressed goes on rendering everywhere an avatar appears');
  assert.equal(out.photoBlocked, true, 'the member is not told their own photo is suppressed');
});

test('CONTROL — the widening is exactly one document, and only from a CURRENT steward', async () => {
  // minors/approved/guardians stay OWNER-ONLY: the relay refuses a steward's write of those outright
  // (gateway.mjs's MINORS_D/APPROVED_D/GUARDIANS_D branch is church-key-only), so a steward-signed copy
  // could only ever be a forgery on a relay that does not enforce.
  const forged = memberApp([sgDoc(STEW, MINORS_D + FCP, { pubkeys: ['kid'.padEnd(64, '0')] })]);
  assert.deepEqual(forged.minors, [],
    'a steward-signed list of the congregation’s children was believed. Those three documents are ' +
    'owner-only on the relay and must stay owner-only here.');
  const stranger = memberApp([sgDoc(OUTSIDER, 'trinityone/nophoto:' + FCP, { pubkeys: [ME] })]);
  assert.deepEqual(stranger.nophoto, [],
    'a photo-suppression list from somebody who is not the church and not on its steward roster was ' +
    'believed — anyone on a shared relay could then blank a member’s picture');
});

// ══ 3. THE JOIN POLICY — a switch a delegated console could never turn back off ═══════════════════════════

test('a delegated steward can turn "approval to join" on AND off, and the console can see which', async () => {
  // The relay ACCEPTS this write and ENFORCES it at once — the JOINPOLICY_D branch of accept() reads the
  // church out of the d-tag, so the tag is not what admits it. What the tag decides is whether the switch
  // can ever be READ BACK. Untagged, subscribeJoinPolicy matched neither half of its filter: the switch on
  // screen stayed OFF while the relay held every new joiner pending, pressing it again only set it on
  // again, and there was no way back. Measured separately: with approval on, an existing member who is not
  // on the admitted list can read NOTHING of the church a moment later.
  const api = consoleApi({ signer: dana, actingChurch: cp });
  assert.ok(await api.setJoinPolicy(true), 'the relay refused a Members steward’s join policy');
  assert.equal(churchTag(api.sent[0]), cp, 'the join policy still names no church');
  await sleep(250);
  let seen = await asScreen(dana.sk, JOINPOLICY_D);
  assert.equal(seen.byTag.length, 1,
    'the console cannot see the join policy it just wrote, so the switch reads "off" while the relay holds ' +
    'every new joiner pending — and pressing it again only sets it on again');
  assert.equal(JSON.parse(seen.byTag[0].content).approval, true);

  assert.ok(await api.setJoinPolicy(false), 'the relay refused to turn approval back off');
  await sleep(250);
  seen = await asScreen(dana.sk, JOINPOLICY_D);
  const newest = seen.all.sort((a, b) => b.created_at - a.created_at)[0];
  assert.equal(JSON.parse(newest.content).approval, false,
    'the newest join policy any screen can see still says approval is required — a delegated console can ' +
    'never turn it back off, and new members wait for ever with nothing saying so');
});

test('CONTROL — the church’s own join policy is unchanged and carries no tag', async () => {
  const api = consoleApi({ signer: church, actingChurch: '' });
  assert.ok(await api.setJoinPolicy(false), 'the church’s own console can no longer set its join policy');
  assert.equal(churchTag(api.sent[0]), undefined, 'a church tag was stamped on the church’s OWN document');
});

// ══ 4. WHAT THE TAG COSTS WHEN THE STEWARD LEAVES — measured, per document ════════════════════════════════
// LAST IN THE FILE, DELIBERATELY: it takes Dana off the roster, and everything above needs her on it.

test('COST, MEASURED: a revoked steward’s group key and photo list stop being served — the join policy does not', async () => {
  const before = { gk: (await asScreen(rob.sk, GROUPKEY_D)).byTag.length,
                   np: (await asScreen(rob.sk, NOPHOTO_D)).byTag.length,
                   jp: (await asScreen(rob.sk, JOINPOLICY_D)).byTag.length };
  assert.deepEqual(before, { gk: 1, np: 1, jp: 1 }, 'the fixture is not in the state this test needs');

  assert.equal((await setRoster([], {}))[0], true, 'the church removes Dana from its steward roster');
  await sleep(400);

  assert.equal((await asScreen(rob.sk, GROUPKEY_D)).byTag.length, 0,
    'a departed steward’s group key is still served. Not a security hole — the member app already refuses ' +
    'an envelope from anyone off the current roster — but it means this file’s note about what the tag ' +
    'costs is now wrong and must be rewritten.');
  assert.equal((await asScreen(rob.sk, NOPHOTO_D)).byTag.length, 0,
    'same, for the photo-suppression list');
  assert.equal((await asScreen(rob.sk, JOINPOLICY_D)).byTag.length, 1,
    'the join policy a steward set vanished when they left. joinpolicy is on canRead’s PUBLIC allowlist and ' +
    'returns before the retraction rule is reached; if that has changed, a church could lose its ' +
    '"approval required" switch the day a churchwarden stands down.');
  // AND THE RELAY GOES ON PROTECTING THE PHOTOGRAPH. Its enforcement is built at ingest (NOPHOTO_BY), not
  // from what it is willing to serve, so retraction does not quietly re-admit a suppressed picture.
  assert.equal((await send(ws, photo(amy, 'https://example.invalid/e.jpg')))[0], false,
    'removing the steward from the roster re-admitted a photograph the church had suppressed');
});
