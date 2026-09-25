// OPTION A, PHASE 1 — A DELEGATED STEWARD'S BACKUP RECORD MUST REACH EVERY CONSOLE, NOT JUST STAY ON THE RELAY.
//   Run: node --test scripts/a-delegated-stewards-backup-meta-reaches-the-console.test.mjs
//
// `trinityone/backup-meta:<churchpub>` is the church-wide "when did we last back up, and how often should we
// be nudged" record. On 2026-09-22 the relay granted it to any steward and withdrew the grant the SAME DAY,
// because subscribeBackupMeta (src/steward.src.js) filtered `authors:[pub]` — the CHURCH's pubkey — while a
// delegated console signs with the STEWARD'S own key (`feChurch()`: "we sign with OUR OWN key but read+publish
// in the church's context"). The relay ACKed the write, DashBackup printed a success sentence, and the record
// was then read back by nobody — not the congregation's other stewards, not even the console that wrote it.
// PLAN-delegated-steward-publishing.md (TrinityOne-internal/reference/) calls this "option A": teach the
// READER to accept a rostered steward's signature, then re-grant the write. This file proves the READER side
// works before the relay's re-grant (scripts/gateway.mjs, alongside this commit) can mean anything.
//
// ── HOW THIS ASSERTS ──────────────────────────────────────────────────────────────────────────────────────
// setBackupMeta, subscribeBackupMeta, feChurch, _consoleDisplay, _consoleChurchVoice, _absorbById,
// _forgetById and _tombstoneTargets are lifted OUT OF vendor/steward.js — the bundle the console actually
// loads — and wired to a REAL nostr-tools SimplePool against a REAL relay (scripts/gateway.mjs) over a real
// websocket. A mirror of this logic written into the test itself would pass its own sabotage; this drives
// the shipped code.
//
// THE CONSOLE'S OWN STEWARD-ROSTER VIEW (`_careRoster`/`_careRosterKnown`/`_stewardCaps`) is supplied as
// fixture state rather than by also running subscribeStewards: that subscription is unchanged by this fix
// and has its own tests elsewhere, and feeding it directly lets a test say precisely "given a console that
// currently believes X about the roster" — including the stale-roster case in test 3, which subscribeStewards
// could not be made to produce on demand without racing the relay. `pool.automaticallyAuth` IS wired for
// real, because every read here crosses the relay's actual NIP-42 gate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const PORT = 19919;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', STEWARDS_D = 'trinityone/stewards:';
const BACKUPMETA_D = 'trinityone/backup-meta:';
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();   // the owner's laptop — holds the church key
const dana   = K();   // a DELEGATED steward. Her OWN key signs; `pub` is the church; actingChurch is set.
const nolan  = K();   // a second delegated steward, added later than Dana
const rob    = K();   // an ordinary member — the forger
const cp = church.pub;

let _t = Math.floor(Date.now() / 1000) - 200; const now = () => ++_t;
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content) }, who.sk);
const setRelayRoster = (pubkeys, caps) => send(ws, doc(church, STEWARDS_D + cp, { pubkeys, caps }));

before(async () => {
  await requireFreePort(PORT, 'a-delegated-stewards-backup-meta-reaches-the-console.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-deleg-backupmeta-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(200); }
  ws = await connect();
  assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, church.sk)))[0], true, 'church profile');
  for (const who of [dana, nolan, rob]) assert.equal((await send(ws, doc(who, MEMBER_D + cp, { joined: now() })))[0], true, 'joined');
  assert.equal((await setRelayRoster([dana.pub], { [dana.pub]: ['content'] }))[0], true, 'steward roster (Dana only, at first)');
  await sleep(300);
});
after(async () => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── THE SHIPPED CONSOLE, lifted out of vendor/steward.js, wired to a REAL SimplePool against the REAL relay ──
// `roster` fixes what THIS console instance currently believes about the steward roster — see file header.
function consoleApi({ signer, actingChurch, roster }) {
  const pool = new SimplePool();
  // Plumbing only — signs the relay's real NIP-42 challenge so reads cross the real gate. Not the thing
  // under test: console-relay-auth-state.test.mjs owns the console's OWN auth-bookkeeping correctness.
  pool.automaticallyAuth = (_url) => async (authEvent) => finalizeEvent(authEvent, signer.sk);
  const r = roster || {};
  const scope = {
    sk: signer.sk, pub: cp, actingChurch,
    pool, relays: () => [WS_URL],
    NET, BACKUPMETA_D,
    _careRoster: r.set || new Set(),
    _careRosterKnown: r.known !== false,
    _careRosterSeen: r.seen !== false,
    _stewardCaps: r.caps || {},
    _monotonic: (t) => t,   // the shipped one guards same-second replaceables; irrelevant here
    now,
    sent: [],
    publish: async (evt) => { scope.sent.push(evt); const [ok] = await send(ws, evt); return ok; },
  };
  const feBody = fnBody(VENDOR, 'function feChurch(tmpl, signer) {', 'feChurch');
  const signerName = (/return\s+(finalizeEvent\w*)\s*\(/.exec(feBody) || [])[1];
  assert.ok(signerName, 'feChurch in vendor/steward.js no longer ends by calling finalizeEvent — re-anchor ' +
    'this fixture rather than deleting it. Body seen:\n' + feBody.slice(0, 400));
  scope[signerName] = finalizeEvent;

  const cdBody = fnBody(VENDOR, 'function _consoleDisplay(rec) {', '_consoleDisplay');
  const cpsBody = fnBody(VENDOR, 'function _capsOf(by) {', '_capsOf');
  const cvBody = fnBody(VENDOR, 'function _consoleChurchVoice(rec) {', '_consoleChurchVoice');
  const pwBody = fnBody(VENDOR, 'function _pickWinner(', '_pickWinner');
  const rvBody = fnBody(VENDOR, 'function _reduceVersions(', '_reduceVersions');
  const absBody = fnBody(VENDOR, 'function _absorbById(', '_absorbById');
  const forgetBody = fnBody(VENDOR, 'function _forgetById(', '_forgetById');
  const ttBody = fnBody(VENDOR, 'function _tombstoneTargets(e) {', '_tombstoneTargets');
  const smBody = fnBody(VENDOR, 'setBackupMeta(at, remind) {', 'setBackupMeta');
  const sbmBody = fnBody(VENDOR, 'subscribeBackupMeta(onMeta) {', 'subscribeBackupMeta');

  Object.assign(scope, new Function('scope', `with (scope) { ${feBody}
    ${cpsBody}
    ${cdBody}
    ${cvBody}
    ${pwBody}
    ${rvBody}
    ${absBody}
    ${forgetBody}
    ${ttBody}
    return ({ ${smBody},\n ${sbmBody},\n _consoleDisplay }); }`)(scope));
  return scope;
}

// The SETTLED answer of a subscription, not its first emission. subscribeBackupMeta calls onMeta() once per
// EVENT it absorbs (the newest-wins pick can change mid-stream as competing versions arrive) AND once more at
// EOSE — so the first call can legitimately be `null` if an untrusted competitor's copy happens to be the
// first frame the relay sends, even though the trusted copy is what the subscription settles on a moment
// later. Wait out a fixed window and report the LAST value, which is what a screen bound to this callback
// would actually be showing once the relay's initial answer has fully landed.
function settle(sub, ms = 1200) {
  return new Promise((resolve) => {
    let last;
    const unsub = sub((m) => { last = m; });
    setTimeout(() => { unsub(); resolve(last); }, ms);
  });
}
const fullRoster = (set, caps) => ({ known: true, seen: true, set, caps });

// ══ 1. THE STEWARD'S OWN CONSOLE, AND THE OWNER'S, CAN READ BACK WHAT SHE JUST WROTE ═══════════════════════

test('a delegated steward’s backup record reaches the relay, tagged with the church', async () => {
  const dc = consoleApi({ signer: dana, actingChurch: cp, roster: fullRoster(new Set([dana.pub]), { [dana.pub]: ['content'] }) });
  const ok = await dc.setBackupMeta(now(), 'weekly');
  assert.notEqual(ok, false, 'the relay refused a rostered steward’s backup-meta write: ' + JSON.stringify(ok));
  assert.ok(dc.sent.length, 'nothing was published — the fixture is not exercising the path it names');
  const tag = (dc.sent[0].tags.find(t => t[0] === 'church') || [])[1];
  assert.equal(tag, cp, 'the record does not name the church, so no reader can match it via #church');
  await sleep(300);
});

test('POINT OF USE: that steward’s OWN console reads it back — before this fix it read 0 rows', async () => {
  const dc = consoleApi({ signer: dana, actingChurch: cp, roster: fullRoster(new Set([dana.pub]), { [dana.pub]: ['content'] }) });
  const m = await settle(dc.subscribeBackupMeta);
  assert.ok(m, 'the delegated console that just wrote the record cannot read it back — the exact failure ' +
    'measured 2026-09-22, ACKed write, invisible everywhere including to its own author');
  assert.equal(m.remind, 'weekly');
});

test('POINT OF USE: the OWNER’S console reads the SAME record — this is the whole ask', async () => {
  // "every steward's nudge resets when any one of them takes a backup" — the owner never wrote this record,
  // Dana did, signed with her own key. If the owner's console cannot see it, the feature does not exist.
  const owner = consoleApi({ signer: church, actingChurch: '', roster: fullRoster(new Set([dana.pub]), { [dana.pub]: ['content'] }) });
  const m = await settle(owner.subscribeBackupMeta);
  assert.ok(m, 'the church owner’s console cannot see a delegated steward’s backup record');
  assert.equal(m.remind, 'weekly');
});

// ══ 2. NEWEST-WINS AMONG TRUSTED AUTHORS — AND A STALE ROSTER MUST NOT LET A NEWER WRITE OUTRANK THE ONE ═══
//        THE READING CONSOLE ACTUALLY TRUSTS ("newest-wins pins forgeries" — AUDIT Fable 2026-07-22)

test('a second, newer steward record wins where the reading console trusts them both', async () => {
  // The relay's OWN accept() gate must also recognise Nolan as a steward before it will store his write —
  // this is the real roster, not any console's fixture view of it.
  assert.equal((await setRelayRoster([dana.pub, nolan.pub], { [dana.pub]: ['content'], [nolan.pub]: ['content'] }))[0], true, 'the church adds Nolan as a second steward');
  await sleep(300);
  const nc = consoleApi({ signer: nolan, actingChurch: cp, roster: fullRoster(new Set([dana.pub, nolan.pub]), { [dana.pub]: ['content'], [nolan.pub]: ['content'] }) });
  const ok = await nc.setBackupMeta(now(), 'monthly');
  assert.notEqual(ok, false, 'the relay refused a second rostered steward’s backup-meta write');
  await sleep(300);
  const owner = consoleApi({ signer: church, actingChurch: '', roster: fullRoster(new Set([dana.pub, nolan.pub]), { [dana.pub]: ['content'], [nolan.pub]: ['content'] }) });
  const m = await settle(owner.subscribeBackupMeta);
  assert.equal(m.remind, 'monthly', 'the newer trusted record did not win — the owner sees a stale cadence');
});

test('a console with a STALE roster view — Nolan not on it yet — does not promote his newer record', async () => {
  // The relay genuinely holds both records at this point (Dana's weekly, Nolan's newer monthly) — the
  // difference from the test above is entirely in what THIS console currently believes about the roster.
  // Newest-by-clock is Nolan's; this console must still show Dana's, because it does not yet trust Nolan.
  const lagging = consoleApi({ signer: church, actingChurch: '', roster: fullRoster(new Set([dana.pub]), { [dana.pub]: ['content'] }) });
  const m = await settle(lagging.subscribeBackupMeta);
  assert.equal(m.remind, 'weekly',
    'a console whose roster has not caught up trusted a newer record from someone it does not yet recognise ' +
    'as a steward — the exact "newest-wins pins a forgery if the roster check is late" shape');
});

// ══ 3. REAL REVOCATION: THE RELAY ITSELF STOPS SERVING A REMOVED STEWARD'S RECORD ═══════════════════════════
// backup-meta: is NOT on canRead's retractionExempt list (scripts/gateway.mjs), so this is enforced at the
// door for every reader, on top of (not instead of) the client-side trust check exercised above.

test('removing a steward from the ACTUAL roster stops the relay serving their record at all', async () => {
  assert.equal((await setRelayRoster([dana.pub], { [dana.pub]: ['content'] }))[0], true, 'the church removes Nolan');
  await sleep(400);
  // Even a console that (wrongly, now) still believes Nolan is current must not see his record — the relay
  // itself withholds it, which is the backstop this test is really pinning.
  const stillTrusting = consoleApi({ signer: church, actingChurch: '', roster: fullRoster(new Set([dana.pub, nolan.pub]), { [dana.pub]: ['content'], [nolan.pub]: ['content'] }) });
  const m = await settle(stillTrusting.subscribeBackupMeta);
  assert.equal(m.remind, 'weekly',
    'a revoked steward’s backup record is still deciding what a console shows as the church-wide cadence, ' +
    'even though the relay was asked to remove them from the roster');
});

// ══ 4. A PLAIN MEMBER'S FORGED RECORD IS REJECTED, AT THE DOOR AND ON SCREEN ═════════════════════════════════

test('the relay refuses a forged backup-meta from somebody who was never a steward', async () => {
  const forged = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', BACKUPMETA_D + cp], ['t', NET], ['church', cp]],
    content: JSON.stringify({ at: now(), remind: 'off' }) }, rob.sk);
  const [ok, reason] = await send(ws, forged);
  assert.equal(ok, false, 'the relay stored a plain member’s forged backup-meta record: ' + reason);
});

test('CONTROL — even if a forged copy reached a console another way, the roster-trust filter refuses it', async () => {
  // Belt and braces: drives _consoleDisplay directly, the same "what would the client do if a second,
  // non-enforcing relay served it anyway" question PLAN-delegated-steward-publishing.md raises about relay
  // federation in general.
  const owner = consoleApi({ signer: church, actingChurch: '', roster: fullRoster(new Set([dana.pub]), { [dana.pub]: ['content'] }) });
  const trusted = owner._consoleDisplay({ _by: rob.pub });
  assert.equal(trusted, false, 'a non-steward’s record would be shown as if it were authoritative');
});
