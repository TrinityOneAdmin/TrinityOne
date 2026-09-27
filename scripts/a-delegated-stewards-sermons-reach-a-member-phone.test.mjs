// OPTION A, PHASE 2 — A DELEGATED STEWARD'S SERMON MUST REACH A MEMBER'S PHONE, NOT JUST THE RELAY.
//   Run: node --test scripts/a-delegated-stewards-sermons-reach-a-member-phone.test.mjs
//
// `trinityone/sermon:<id>` and `trinityone/pinsermon:<churchpub>` were granted to a content steward for one
// day (2026-09-22) and withdrawn the same day, because all four shipped readers filtered `authors:[cp]` —
// so a delegated steward's church-tagged sermon ACKed and reached nobody: not a member's Watch & Listen
// tab, not a member's Today card, not even the publishing steward's own console list. Measured 0/0/0/0.
// PLAN-delegated-steward-publishing.md calls this "option A": teach the readers to accept a rostered
// steward's signature, then re-grant the write. This file proves BOTH halves — the CONSOLE + RELAY round
// trip, and the MEMBER APP's own client-side trust decision, which is the harder half (see "THE HARD PART"
// below) and is why this package needed a member-app change and this file needed a second harness.
//
// ── HOW THIS ASSERTS ──────────────────────────────────────────────────────────────────────────────────────
// The console half drives publishSermon/subscribeSermons/pinSermon/subscribePinnedSermon out of the SHIPPED
// vendor/steward.js against a REAL relay (scripts/gateway.mjs) over a real websocket. The member half drives the SHIPPED
// _openSermons/subscribePinnedSermon out of vendor/fellowship.js with a stubbed `_onChurchDocs` (the shared
// docs-hub plumbing itself is unchanged by this fix and has its own tests) that replays whatever events the
// test hands it and lets the test fire `onroster()` on demand — so "the roster has not arrived yet" and "the
// roster just revoked someone" are both things this file can put the reader in, on purpose, rather than
// racing a real relay for them.
//
// ── THE HARD PART (from the plan doc, and why it is not just the filter) ─────────────────────────────────
// Widening `authors:[cp]` to also accept `'#church':[cp]` is one line. Deciding whether to TRUST what comes
// back on that widened filter is the package: a member's phone must not render a sermon whose author it has
// not confirmed against the church's CURRENT steward roster (`_churchVoice`) — a sermon rendered before the
// roster lands is a sermon rendered on no authority at all — and it must stop rendering one the moment that
// author is revoked, without waiting for a new event (`onroster()` re-derives every winner). Tests 5-8 below
// are that package; tests 1-4 are the relay/console half the plan calls "the cheap half".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const PORT = 19923;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', STEWARDS_D = 'trinityone/stewards:';
const SERMON_D = 'trinityone/sermon:', PINSERMON_D = 'trinityone/pinsermon:';
const STEWARD_VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FELLOWSHIP_VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => setTimeout(r, 0));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();   // the owner's laptop — holds the church key
const dana   = K();   // a DELEGATED, CONTENT steward. Her OWN key signs; `pub` is the church.
const rob    = K();   // an ordinary member — the forger
const cp = church.pub;

let _t = Math.floor(Date.now() / 1000) - 200; const now = () => ++_t;
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content) }, who.sk);
const setRelayRoster = (pubkeys, caps) => send(ws, doc(church, STEWARDS_D + cp, { pubkeys, caps }));

before(async () => {
  await requireFreePort(PORT, 'a-delegated-stewards-sermons-reach-a-member-phone.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-deleg-sermons-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(200); }
  ws = await connect();
  assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, church.sk)))[0], true, 'church profile');
  for (const who of [dana, rob]) assert.equal((await send(ws, doc(who, MEMBER_D + cp, { joined: now() })))[0], true, 'joined');
  assert.equal((await setRelayRoster([dana.pub], { [dana.pub]: ['content'] }))[0], true, 'steward roster (Dana, content)');
  await sleep(300);
});
after(async () => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ══════════════════════════════════ HALF 1: CONSOLE + RELAY, REAL ════════════════════════════════════════

// The shipped console, lifted out of vendor/steward.js, wired to a REAL SimplePool against the REAL relay.
function consoleApi({ signer, actingChurch }) {
  const pool = new SimplePool();
  pool.automaticallyAuth = (_url) => async (authEvent) => finalizeEvent(authEvent, signer.sk);   // plumbing only: the relay asks for NIP-42 auth, this answers it
  const scope = {
    sk: signer.sk, pub: cp, actingChurch,
    pool, relays: () => [WS_URL],
    NET, SERMON_D, PINSERMON_D,
    _careRoster: new Set([dana.pub]), _careRosterKnown: true, _careRosterSeen: true,
    _stewardCaps: { [dana.pub]: ['content'] },
    _monotonic: (t) => t,
    now,
    sent: [],
    publish: async (evt) => { scope.sent.push(evt); const [ok] = await send(ws, evt); return ok; },
  };
  const feBody = fnBody(STEWARD_VENDOR, 'function feChurch(tmpl, signer) {', 'feChurch');
  const signerName = (/return\s+(finalizeEvent\w*)\s*\(/.exec(feBody) || [])[1];
  assert.ok(signerName, 'feChurch in vendor/steward.js no longer ends by calling finalizeEvent — re-anchor this fixture');
  scope[signerName] = finalizeEvent;

  const cdBody = fnBody(STEWARD_VENDOR, 'function _consoleDisplay(rec) {', '_consoleDisplay');
  const cpsBody = fnBody(STEWARD_VENDOR, 'function _capsOf(by) {', '_capsOf');
  const cvBody = fnBody(STEWARD_VENDOR, 'function _consoleChurchVoice(rec) {', '_consoleChurchVoice');
  const pwBody = fnBody(STEWARD_VENDOR, 'function _pickWinner(', '_pickWinner');
  const rvBody = fnBody(STEWARD_VENDOR, 'function _reduceVersions(', '_reduceVersions');
  const absBody = fnBody(STEWARD_VENDOR, 'function _absorbById(', '_absorbById');
  const forgetBody = fnBody(STEWARD_VENDOR, 'function _forgetById(', '_forgetById');
  const ttBody = fnBody(STEWARD_VENDOR, 'function _tombstoneTargets(e) {', '_tombstoneTargets');
  const psBody = fnBody(STEWARD_VENDOR, 'publishSermon(s) {', 'publishSermon');
  const ssBody = fnBody(STEWARD_VENDOR, 'subscribeSermons(onSermons) {', 'subscribeSermons');
  const pinBody = fnBody(STEWARD_VENDOR, 'pinSermon(s) {', 'pinSermon');
  const spsBody = fnBody(STEWARD_VENDOR, 'subscribePinnedSermon(onPinned) {', 'subscribePinnedSermon');

  Object.assign(scope, new Function('scope', `with (scope) { ${feBody}
    ${cpsBody}
    ${cdBody}
    ${cvBody}
    ${pwBody}
    ${rvBody}
    ${absBody}
    ${forgetBody}
    ${ttBody}
    return ({ ${psBody},\n ${ssBody},\n ${pinBody},\n ${spsBody} }); }`)(scope));
  return scope;
}
function settle(sub, ms = 1200) {
  return new Promise((resolve) => {
    let last;
    const unsub = sub((m) => { last = m; });
    setTimeout(() => { unsub(); resolve(last); }, ms);
  });
}

// ── THE DOOR THE BYTES GO THROUGH, WHICH IS NOT THE ONE THE DOCUMENT GOES THROUGH ───────────────────────
// Option A widened every sermon READER and re-granted `sermon:` at the relay, and a delegated steward still
// could not publish a sermon — because a sermon is a FILE plus a document, and the file goes to a host over
// HTTP with its own kind-24242 authorisation that never passed through feChurch and so never named the
// church. AUDIT-delegated-publishing-2026-09-25 H1. These two tests pin the relay half of that contract;
// the ones after them pin that the client actually satisfies it.
const blobAuth = (who, t, sha, tags = []) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 24242, created_at: now(), content: t,
  tags: [['t', t], ['x', sha], ['expiration', String(now() + 600)], ...tags],
}, who.sk))).toString('base64');
const BODY = Buffer.from('not really an mp3, but content-addressed all the same');
const BODY_SHA = createHash('sha256').update(BODY).digest('hex');

test('THE BYTES: a content steward’s upload is REFUSED when it does not name the church', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/blob`, { method: 'PUT',
    headers: { Authorization: blobAuth(dana, 'upload', BODY_SHA), 'Content-Type': 'application/octet-stream' }, body: BODY });
  assert.equal(r.status, 401,
    'the relay accepted a blob from a steward who never said which church it was for — _blobUploader reads ' +
    'the `church` tag to decide, so accepting without it would mean accepting from anyone. Status: ' + r.status);
});

test('THE BYTES: …and ACCEPTED when it does — the relay was always ready, the client never said', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/blob`, { method: 'PUT',
    headers: { Authorization: blobAuth(dana, 'upload', BODY_SHA, [['church', cp]]), 'Content-Type': 'application/octet-stream' }, body: BODY });
  assert.equal(r.status, 201,
    'A CONTENT STEWARD CANNOT UPLOAD THE FILE, so every reader this branch widened has nothing to read and ' +
    'the whole feature is inert. Status: ' + r.status + ' — ' + (await r.text()).slice(0, 200));
  const j = JSON.parse(await (await fetch(`http://127.0.0.1:${PORT}/blob`, { method: 'PUT',
    headers: { Authorization: blobAuth(dana, 'upload', BODY_SHA, [['church', cp]]), 'Content-Type': 'application/octet-stream' }, body: BODY })).text());
  assert.equal(j.sha256, BODY_SHA, 'the host stored it under a different digest than the client computed');
});

test('THE BYTES: a steward’s DELETE needs the church tag too — this is why "Remove" never freed the file', async () => {
  const bare = await fetch(`http://127.0.0.1:${PORT}/blob/${BODY_SHA}`, { method: 'DELETE', headers: { Authorization: blobAuth(dana, 'delete', BODY_SHA) } });
  assert.equal(bare.status, 401, 'an unattributed delete was honoured: ' + bare.status);
  const named = await fetch(`http://127.0.0.1:${PORT}/blob/${BODY_SHA}`, { method: 'DELETE', headers: { Authorization: blobAuth(dana, 'delete', BODY_SHA, [['church', cp]]) } });
  assert.ok(named.status >= 200 && named.status < 300,
    'A CONTENT STEWARD CANNOT FREE THE BYTES. removeSermon tombstones the document and the file stays on ' +
    'every host for ever, while the confirmation sheet has already said "the stored file is deleted". ' +
    'Status: ' + named.status);
});

test('a content steward’s sermon reaches the relay, tagged with the church', async () => {
  const dc = consoleApi({ signer: dana, actingChurch: cp });
  const out = await dc.publishSermon({ id: 's1', title: 'Sunday', sha256: 'aa', host: 'https://h.example' });
  assert.ok(out && out.id === 's1', 'the relay refused a content steward’s sermon: ' + JSON.stringify(out));
  const tag = (dc.sent[0].tags.find(t => t[0] === 'church') || [])[1];
  assert.equal(tag, cp, 'the sermon does not name the church, so no reader can match it via #church');
  await sleep(300);
});

test('POINT OF USE: that steward’s OWN console reads it back — before this fix it read 0 rows', async () => {
  const dc = consoleApi({ signer: dana, actingChurch: cp });
  const list = await settle(dc.subscribeSermons);
  assert.ok(list && list.length === 1 && list[0].id === 's1',
    'the delegated console that just published the sermon cannot see it in its own list — the exact ' +
    'failure measured 2026-09-22. Got: ' + JSON.stringify(list));
});

test('POINT OF USE: the OWNER’S console reads the SAME sermon', async () => {
  const owner = consoleApi({ signer: church, actingChurch: '' });
  const list = await settle(owner.subscribeSermons);
  assert.ok(list && list.some(s => s.id === 's1'), 'the church owner’s console cannot see a delegated steward’s sermon');
});

test('the content steward can FEATURE the sermon, and the OWNER console sees the pin too', async () => {
  const dc = consoleApi({ signer: dana, actingChurch: cp });
  const ok = await dc.pinSermon({ id: 's1', title: 'Sunday', sha256: 'aa', host: 'https://h.example' });
  assert.ok(ok, 'the relay refused a content steward’s pin');
  await sleep(300);
  const owner = consoleApi({ signer: church, actingChurch: '' });
  const pin = await settle(owner.subscribePinnedSermon);
  assert.ok(pin && pin.id === 's1', 'the owner’s console cannot see a delegated steward’s featured sermon: ' + JSON.stringify(pin));
});

test('the relay refuses a forged sermon from somebody who was never a steward', async () => {
  const forged = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', SERMON_D + 's-forged'], ['t', NET], ['church', cp]],
    content: JSON.stringify({ id: 's-forged', title: 'Forged', sha256: 'ff' }) }, rob.sk);
  const [ok, reason] = await send(ws, forged);
  assert.equal(ok, false, 'the relay stored a plain member’s forged sermon: ' + reason);
});

test('REVOCATION reaches the relay itself: removing the steward stops it serving her sermon at all', async () => {
  // sermon: is NOT on canRead's retractionExempt list (scripts/gateway.mjs), so this is enforced at the
  // door on top of (not instead of) the client-side trust check the member half below exercises.
  assert.equal((await setRelayRoster([], {}))[0], true, 'the church removes Dana from its steward roster');
  await sleep(400);
  const owner = consoleApi({ signer: church, actingChurch: '' });
  const list = await settle(owner.subscribeSermons);
  assert.ok(!list || !list.some(s => s.id === 's1'),
    'a revoked steward’s sermon is still served by the relay to every console: ' + JSON.stringify(list));
  // restore the roster for the member-app half below, which drives its OWN trust decision independently.
  assert.equal((await setRelayRoster([dana.pub], { [dana.pub]: ['content'] }))[0], true, 'restore Dana’s roster');
  await sleep(300);
});

// ══════════════════════════════════ HALF 2: THE MEMBER APP'S OWN TRUST DECISION ═══════════════════════════
// A stubbed `_onChurchDocs` replays exactly the events this file hands it and lets a test fire `onroster()`
// on demand — the hub itself is unchanged by this fix and is not what these tests are about.
const FCP = 'c'.repeat(64), STEW = 'd'.repeat(64), OUTSIDER = 'f'.repeat(64);
const sermonDoc = (author, id, content, at, tags = []) =>
  ({ id: 'x' + Math.random(), pubkey: author, created_at: at, content: content === null ? '' : JSON.stringify(content),
     tags: [['d', SERMON_D + id], ...(content === null ? [['deleted', '1']] : []), ...tags] });
const pinDoc = (author, content, at, tags = []) =>
  ({ id: 'x' + Math.random(), pubkey: author, created_at: at, content: content === null ? '' : JSON.stringify(content),
     tags: [['d', PINSERMON_D + FCP], ...(content === null ? [['deleted', '1']] : []), ...tags] });

function memberApp() {
  let handler = null;
  const stubs = {
    toPub: () => FCP,
    _churchRoster: new Map(),   // cp -> Set(current stewards) — empty Map entry for FCP means "roster unknown"
    _onChurchDocs: (_cp, h) => { handler = h; return () => {}; },
    console,
  };
  // Names declared OUTSIDE the `with(scope)` block below, in the enclosing function scope (the lifted
  // store primitives, and the two d-tag constants) — the `with` proxy must let a lookup for any of these
  // fall through to that outer scope rather than treating their absence from `stubs` as a missing fixture.
  const DECLARED = new Set(['handler', '_churchVoice', '_coalesce', '_pickWinner', '_reduceVersions',
    '_absorbById', '_forgetById', '_reduceAll', '_tombstoneTargets', 'SERMON_D', 'PINSERMON_D']);
  const scope = new Proxy(stubs, {
    has: (t, k) => !DECLARED.has(String(k)) && ((k in t) || !(String(k) in globalThis)),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it in memberApp()'); },
  });
  const cvBody = fnBody(FELLOWSHIP_VENDOR, 'function _churchVoice(cp, doc) {', '_churchVoice');
  const clBody = fnBody(FELLOWSHIP_VENDOR, 'function _coalesce(fn) {', '_coalesce');
  const pwBody = fnBody(FELLOWSHIP_VENDOR, 'function _pickWinner(', '_pickWinner');
  const rvBody = fnBody(FELLOWSHIP_VENDOR, 'function _reduceVersions(', '_reduceVersions');
  const absBody = fnBody(FELLOWSHIP_VENDOR, 'function _absorbById(', '_absorbById');
  const forgetBody = fnBody(FELLOWSHIP_VENDOR, 'function _forgetById(', '_forgetById');
  const reduceAllBody = fnBody(FELLOWSHIP_VENDOR, 'function _reduceAll(', '_reduceAll');
  const ttBody = fnBody(FELLOWSHIP_VENDOR, 'function _tombstoneTargets(e) {', '_tombstoneTargets');
  const osBody = fnBody(FELLOWSHIP_VENDOR, '_openSermons(churchNpub, onSermons) {', '_openSermons');
  const spsBody = fnBody(FELLOWSHIP_VENDOR, 'subscribePinnedSermon(churchNpub, onPinned) {', 'subscribePinnedSermon');
  const names = Object.keys(stubs);
  const built = new Function(...names, 'scope', `
    ${cvBody}
    ${clBody}
    ${pwBody}
    ${rvBody}
    ${absBody}
    ${forgetBody}
    ${reduceAllBody}
    ${ttBody}
    let SERMON_D = ${JSON.stringify(SERMON_D)}, PINSERMON_D = ${JSON.stringify(PINSERMON_D)};
    with (scope) {
      return ({ _openSermons: ({ ${osBody} })._openSermons, subscribePinnedSermon: ({ ${spsBody} }).subscribePinnedSermon }); }
  `)(...names.map(k => stubs[k]), scope);
  return {
    openSermons: (cb) => built._openSermons('npub1c', cb),
    openPinned: (cb) => built.subscribePinnedSermon('npub1c', cb),
    fire: (e) => { const d = (e.tags.find(t => t[0] === 'd') || [])[1]; handler.onevent(e, d); },
    eose: () => { handler.oneose && handler.oneose(); },
    setRoster: (pubs) => { stubs._churchRoster.set(FCP, new Set(pubs)); },
    fireRosterKnown: (pubs) => { stubs._churchRoster.set(FCP, new Set(pubs)); handler.onroster && handler.onroster(); },
  };
}

test('MEMBER APP: a steward-authored sermon does NOT render before the roster is known — cached-paints-before-authority-arrives', async () => {
  const app = memberApp();
  let heard = null;
  const unsub = app.openSermons((v) => { heard = v; });
  app.fire(sermonDoc(STEW, 's1', { id: 's1', title: 'Sunday', sha256: 'aa' }, 1756900000, [['church', FCP]]));
  app.eose();
  await tick();
  assert.deepEqual(heard, [],
    'a sermon rendered before this phone has confirmed its author against the church’s roster — a sermon ' +
    'rendered on no authority at all. Heard: ' + JSON.stringify(heard));
  unsub();
});

test('MEMBER APP: …and renders the moment the roster confirms the steward, with NO new event', async () => {
  const app = memberApp();
  let heard = null;
  const unsub = app.openSermons((v) => { heard = v; });
  app.fire(sermonDoc(STEW, 's1', { id: 's1', title: 'Sunday', sha256: 'aa' }, 1756900000, [['church', FCP]]));
  app.eose();
  await tick();
  app.fireRosterKnown([STEW]);   // the roster arrives — no new sermon event
  await tick();
  assert.ok(heard && heard.length === 1 && heard[0].id === 's1',
    'the roster confirmed the author and the sermon still did not render. Heard: ' + JSON.stringify(heard));
  unsub();
});

test('MEMBER APP: REVOCATION — removing the steward from the roster stops the sermon rendering, live', async () => {
  const app = memberApp();
  let heard = null;
  const unsub = app.openSermons((v) => { heard = v; });
  app.fireRosterKnown([STEW]);
  app.fire(sermonDoc(STEW, 's1', { id: 's1', title: 'Sunday', sha256: 'aa' }, 1756900000, [['church', FCP]]));
  app.eose();
  await tick();
  assert.equal(heard.length, 1, 'fixture: the sermon is not on screen before the revocation');
  app.fireRosterKnown([]);   // the church removes the steward — no new sermon event, no tombstone
  await tick();
  assert.deepEqual(heard, [],
    'A REVOKED STEWARD’S SERMON IS STILL ON SCREEN. The roster said they are no longer a steward and ' +
    'nothing re-derived the list. Heard: ' + JSON.stringify(heard));
  unsub();
});

test('MEMBER APP: a plain member’s forged sermon never renders, even though the hub delivered it', async () => {
  const app = memberApp();
  let heard = null;
  const unsub = app.openSermons((v) => { heard = v; });
  app.fireRosterKnown([STEW]);
  app.fire(sermonDoc(OUTSIDER, 's-forged', { id: 's-forged', title: 'Forged', sha256: 'ff' }, 1756900000, [['church', FCP]]));
  app.eose();
  await tick();
  assert.deepEqual(heard, [], 'a forgery from somebody NOT on the roster was rendered: ' + JSON.stringify(heard));
  unsub();
});

test('MEMBER APP: the church removing a sermon clears the STEWARD’S edit of it too', async () => {
  // AUDIT-delegated-publishing-2026-09-25 H2, at the point of use. The owner publishes s1; Dana edits it,
  // which is a second version under HER key and the one members see; the owner then presses Remove. Before
  // `for: *` the tombstone bound only the church's copy, so Dana's stayed on every phone — and the blob
  // DELETE had already run, so the sermon that remained could never play. The sheet said "It disappears
  // from members' apps and the stored file is deleted"; half of that was true and it was the wrong half.
  const app = memberApp();
  const seen = [];
  app.openSermons(l => seen.push(l.map(x => x.title)));
  app.setRoster([STEW]);
  app.fire(sermonDoc(FCP, 's1', { id: 's1', title: 'Sunday', sha256: 'aa' }, 1000, [['church', FCP]]));
  app.fire(sermonDoc(STEW, 's1', { id: 's1', title: 'Sunday (corrected)', sha256: 'aa' }, 2000, [['church', FCP]]));
  app.eose();
  await tick();
  assert.deepEqual(seen[seen.length - 1], ['Sunday (corrected)'], 'fixture: the steward’s edit should be the one shown');

  // the church's Remove, exactly as feChurch now stamps it
  app.fire(sermonDoc(FCP, 's1', null, 3000, [['church', FCP], ['for', '*']]));
  await tick();
  assert.deepEqual(seen[seen.length - 1], [],
    'THE STEWARD’S EDIT SURVIVED THE CHURCH REMOVING THE SERMON. It is still listed on every member’s ' +
    'phone and its file has already been deleted, so it can never play. Shown: ' + JSON.stringify(seen[seen.length - 1]));
});

test('MEMBER APP: …and a STEWARD’s `for: *` still cannot remove the church’s sermon', async () => {
  // Round 9 at the point of use: the grant is honoured only for a tombstone signed by the church key.
  const app = memberApp();
  const seen = [];
  app.openSermons(l => seen.push(l.map(x => x.title)));
  app.setRoster([STEW]);
  app.fire(sermonDoc(FCP, 's1', { id: 's1', title: 'Sunday', sha256: 'aa' }, 1000, [['church', FCP]]));
  app.eose();
  await tick();
  app.fire(sermonDoc(STEW, 's1', null, 3000, [['church', FCP], ['for', '*']]));
  await tick();
  assert.deepEqual(seen[seen.length - 1], ['Sunday'],
    'A STEWARD REMOVED THE CHURCH’S OWN SERMON by asking for every copy. Shown: ' + JSON.stringify(seen[seen.length - 1]));
});

test('MEMBER APP: NEWEST-WINS among TRUSTED authors — a late-arriving forgery never outranks the church’s own copy', async () => {
  // "newest-wins pins forgeries" (AUDIT Fable 2026-07-22): the forged copy below is dated LATER than the
  // church's, so if the pick were "newest, full stop" it would win. It must not, because its author is not
  // on the roster.
  const app = memberApp();
  let heard = null;
  const unsub = app.openSermons((v) => { heard = v; });
  app.fireRosterKnown([STEW]);
  app.fire(sermonDoc(FCP, 's1', { id: 's1', title: 'Church’s own', sha256: 'aa' }, 1756900000, [['church', FCP]]));
  app.fire(sermonDoc(OUTSIDER, 's1', { id: 's1', title: 'FORGED, newer', sha256: 'bad' }, 1756900500, [['church', FCP]]));
  app.eose();
  await tick();
  assert.equal(heard.length, 1, 'fixture: exactly one version of sermon:s1 should be on screen');
  assert.equal(heard[0].title, 'Church’s own',
    'THE NEWER FORGERY WON. A later, untrusted copy of the same sermon id outranked the church’s real one: ' +
    JSON.stringify(heard[0]));
  unsub();
});

test('MEMBER APP: …and between two TRUSTED authors, the genuinely newer one wins', async () => {
  const app = memberApp();
  let heard = null;
  const unsub = app.openSermons((v) => { heard = v; });
  app.fireRosterKnown([STEW]);
  app.fire(sermonDoc(FCP, 's1', { id: 's1', title: 'Church’s own', sha256: 'aa' }, 1756900000, [['church', FCP]]));
  app.fire(sermonDoc(STEW, 's1', { id: 's1', title: 'Steward’s edit', sha256: 'bb' }, 1756900500, [['church', FCP]]));
  app.eose();
  await tick();
  assert.equal(heard.length, 1);
  assert.equal(heard[0].title, 'Steward’s edit',
    'the newer TRUSTED copy did not win: ' + JSON.stringify(heard[0]));
  unsub();
});

test('MEMBER APP: the pinned-sermon Today card follows the same rules — gated on the roster, revoked live', async () => {
  const app = memberApp();
  let heard = 'unset';
  const unsub = app.openPinned((v) => { heard = v; });
  app.fire(pinDoc(STEW, { id: 's1', title: 'Sunday', sha256: 'aa' }, 1756900000, [['church', FCP]]));
  app.eose();
  await tick();
  assert.equal(heard, null, 'a steward-authored pin rendered before the roster confirmed the author: ' + JSON.stringify(heard));
  app.fireRosterKnown([STEW]);
  await tick();
  assert.ok(heard && heard.sha256 === 'aa', 'the pin still did not render once the roster confirmed the steward: ' + JSON.stringify(heard));
  app.fireRosterKnown([]);   // revoked
  await tick();
  assert.equal(heard, null, 'a revoked steward’s pin is still driving the Today card: ' + JSON.stringify(heard));
  unsub();
});
